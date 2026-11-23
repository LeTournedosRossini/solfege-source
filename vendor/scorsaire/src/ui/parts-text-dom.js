/*
 * Screen 2 — the text sections of the properties of a part (DOM): metadata of the work, title block, header, footer, measure numbers.
 * Built by `parts-dom.js`; every control commits one undoable transaction through the Application (`run` redraws the screen).
 */
import { createSwitch } from './switch.js';
import { dividerRows } from './dividers-spec.js';
import { partDividers } from '../model/dividers.js';
import { SID, PID, resolveStyle, headerFooterOf, titleBlockOf, TOKEN_HELP } from '../model/index.js';
import { createChoiceMenu } from './choice-menu.js';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
};

/** @param o { app, part, label, run, style(sid) } → array of elements (sections) to append to the properties column */
export function textSections({ app, part, label, run, style, copy = () => null, stepper = null, gridColumns = () => null }) {
  const head = (key, group) => el('h3', {}, label(key), ' ', copy(group));
  const set = (patch) => run(() => app.setPartPage(part.id, patch));
  let lastInput = null; // the text field that had the focus last: the B / I buttons wrap its selection in tags
  const track = (input) => { input.addEventListener('focus', () => { lastInput = input; }); return input; };
  const text = (value, onCommit, extra = {}) => {
    const input = track(el('input', { type: 'text', value: value ?? '', maxlength: '200', ...extra }));
    input.addEventListener('change', () => run(() => onCommit(input.value)));
    return input;
  };
  const check = (checked, text2, onChange, field) => el('div', { class: 'ps-row' }, createSwitch({ checked, text: text2, attrs: { 'data-field': field }, onchange: (e) => onChange(e.target.checked) }));
  const number = (value, onCommit, { min = 0, max = 1000, step = 1 } = {}, field) => {
    const input = el('input', { type: 'number', value: String(value), min, max, step, inputmode: 'decimal', 'data-field': field });
    input.addEventListener('change', () => { const n = Number(input.value); if (Number.isFinite(n)) run(() => onCommit(n)); });
    return input;
  };
  // a − [value] + stepper (the one of the page tab) when given, else the plain number field
  const num = (labelText, value, onCommit, opts, field) => {
    if (!stepper) return number(value, onCommit, opts, field);
    const w = stepper(labelText, value, onCommit, opts); w.setAttribute('data-field', field); return w;
  };
  const tagButton = (tag, text2) => el('button', { type: 'button', 'data-act': `tag-${tag}`, title: label(`parts.tag.${tag}`),
    onmousedown: (e) => e.preventDefault(),
    onclick: () => {
      const input = lastInput; if (!input || !input.isConnected) return;
      const a = input.selectionStart ?? input.value.length; const b = input.selectionEnd ?? a;
      input.value = `${input.value.slice(0, a)}<${tag}>${input.value.slice(a, b)}</${tag}>${input.value.slice(b)}`;
      input.dispatchEvent(new Event('change'));
    } }, text2);

  // ----- metadata of the work -----
  const w = app.doc.work.props;
  const meta = (key, pid) => el('div', { class: 'ps-row' }, el('label', {}, label(`parts.meta.${key}`)), text(w[pid] ?? '', (v) => app.setWorkMeta({ [key]: v }), { 'data-field': `meta-${key}` }));
  const metaSection = el('div', { 'data-section': 'meta' }, el('h3', {}, label('parts.work')),
    meta('title', PID.TITLE), meta('subtitle', PID.SUBTITLE), meta('composer', PID.COMPOSER), meta('arranger', PID.ARRANGER), meta('lyricist', PID.LYRICIST),
    meta('album', PID.ALBUM), meta('copyright', PID.COPYRIGHT), meta('date', PID.DATE));

  // ----- title block, header, footer -----
  const scoreOnly = style(SID.PAGE_SCORE_ONLY);
  const block = titleBlockOf(part);
  const alignButtons = (line) => ['left', 'center', 'right'].map((a) => el('button', { type: 'button', 'aria-pressed': String(line.align === a), 'data-act': `line-align-${a}`, title: label(`parts.align.${a}`),
    onclick: () => run(() => setLine(line.id, { align: a })) }, a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'));
  const setLine = (id, patch) => app.setTitleBlock(part.id, { lines: block.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const titleSection = el('div', { 'data-section': 'title' }, head('parts.titleBlock', 'title'),
    check(scoreOnly, label('parts.scoreOnly'), (v) => set({ [SID.PAGE_SCORE_ONLY]: v }), 'score-only'),
    check(block.show, label('parts.titleShow'), (v) => run(() => app.setTitleBlock(part.id, { show: v })), 'title-show'),
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.titleGap')), num(label('parts.titleGap'), Math.round(style(SID.TITLE_FRAME_DISTANCE) * 10) / 10, (n) => app.setPartPage(part.id, { [SID.TITLE_FRAME_DISTANCE]: n }), { min: -8, max: 30, step: 1 }, 'title-gap')),
    ['subtitle', 'composer', 'arranger', 'lyricist', 'album'].map((k) => check(block.fields[k], label(`parts.meta.${k}`), (v) => run(() => app.setTitleBlock(part.id, { fields: { [k]: v } })), `title-field-${k}`)),
    el('div', { class: 'ps-hint' }, label('parts.freeLines')),
    block.lines.map((line) => el('div', { class: 'ps-row ps-line', 'data-line': line.id },
      text(line.text, (v) => setLine(line.id, { text: v }), { 'data-field': 'line-text' }),
      alignButtons(line),
      el('button', { type: 'button', 'aria-pressed': String(line.bold), 'data-act': 'line-bold', onclick: () => run(() => setLine(line.id, { bold: !line.bold })) }, 'B'),
      el('button', { type: 'button', 'aria-pressed': String(line.italic), 'data-act': 'line-italic', onclick: () => run(() => setLine(line.id, { italic: !line.italic })) }, 'I'),
      el('button', { type: 'button', 'data-act': 'line-remove', 'aria-label': label('parts.remove'), onclick: () => run(() => app.setTitleBlock(part.id, { lines: block.lines.filter((l) => l.id !== line.id) })) }, '✕'))),
    el('div', { class: 'ps-row' }, el('button', { type: 'button', 'data-act': 'line-add', onclick: () => run(() => app.setTitleBlock(part.id, { lines: [...block.lines, { text: '$:instrument:', align: 'center', bold: false, italic: false }] })) }, `+ ${label('parts.addLine')}`)));

  const templateRows = (kind) => {
    const cfg = headerFooterOf(part, kind);
    const row = (key, title, tpl) => el('div', { class: 'ps-tpl', 'data-template': `${kind}-${key}` }, el('div', { class: 'ps-hint' }, title),
      el('div', { class: 'ps-areas' }, ['l', 'c', 'r'].map((a) => text(tpl?.[a] ?? '', (v) => app.setHeaderFooter(part.id, kind, { [key]: { ...(tpl ?? { l: '', c: '', r: '' }), [a]: v } }), { 'data-field': `${kind}-${key}-${a}`, placeholder: label(`parts.area.${a}`), 'aria-label': `${title} — ${label(`parts.area.${a}`)}` }))));
    return [
      check(cfg.enabled, label(`parts.${kind}Show`), (v) => run(() => app.setHeaderFooter(part.id, kind, { enabled: v })), `${kind}-enabled`),
      cfg.enabled ? [
        check(cfg.first !== null, label('parts.onFirstPage'), (v) => run(() => app.setHeaderFooter(part.id, kind, { first: v ? { l: '', c: '', r: '' } : null })), `${kind}-first`),
        cfg.first !== null ? row('first', label('parts.firstPage'), cfg.first) : null,
        row('odd', cfg.twoSided ? label('parts.oddPages') : label('parts.otherPages'), cfg.odd),
        check(cfg.twoSided, label('parts.twoSided'), (v) => run(() => app.setHeaderFooter(part.id, kind, { twoSided: v })), `${kind}-two-sided`),
        cfg.twoSided ? row('even', label('parts.evenPages'), cfg.even) : null,
      ] : null,
    ];
  };
  const tokens = el('div', { class: 'ps-hint ps-tokens' }, `${label('parts.tokens')} ${TOKEN_HELP.join(' ')}`);
  const headerSection = el('div', { 'data-section': 'header' }, head('parts.header', 'header'), templateRows('header'));
  const footerSection = el('div', { 'data-section': 'footer' }, head('parts.footer', 'footer'), templateRows('footer'));
  const formatRow = el('div', { class: 'ps-row' }, el('span', { class: 'ps-hint' }, label('parts.format2')), tagButton('b', 'B'), tagButton('i', 'I'));

  // ----- measure numbers -----
  const showNumbers = style(SID.SHOW_MEASURE_NUMBERS);
  const mode = style(SID.MEASURE_NUMBER_MODE);
  const numbersSection = el('div', { 'data-section': 'numbers' }, head('parts.measureNumbers', 'numbers'),
    check(showNumbers, label('parts.numbersShow'), (v) => set({ [SID.SHOW_MEASURE_NUMBERS]: v }), 'numbers-show'),
    showNumbers ? [
      el('div', { class: 'ps-row' }, createChoiceMenu({ options: ['system', 'interval', 'every'].map((m) => [m, label(`parts.numbersMode.${m}`)]), value: mode, label: label('parts.numbersWhich'), act: 'numbers-mode', onPick: (v) => set({ [SID.MEASURE_NUMBER_MODE]: v }) })),
      mode === 'interval' ? el('div', { class: 'ps-row' }, el('label', {}, label('parts.numbersInterval')), num(label('parts.numbersInterval'), style(SID.MEASURE_NUMBER_INTERVAL), (n) => app.setPartPage(part.id, { [SID.MEASURE_NUMBER_INTERVAL]: n }), { min: 1, max: 99 }, 'numbers-interval')) : null,
      check(style(SID.MEASURE_NUMBER_SHOW_ONE), label('parts.numbersShowOne'), (v) => set({ [SID.MEASURE_NUMBER_SHOW_ONE]: v }), 'numbers-show-one'),
      check(style(SID.MEASURE_NUMBERS_CONTINUE), label('parts.numbersContinue'), (v) => set({ [SID.MEASURE_NUMBERS_CONTINUE]: v }), 'numbers-continue'),
      el('div', { class: 'ps-row' }, el('label', {}, label('parts.numbersSize')), num(label('parts.numbersSize'), style(SID.MEASURE_NUMBER_SIZE), (n) => app.setPartPage(part.id, { [SID.MEASURE_NUMBER_SIZE]: n }), { min: 4, max: 30, step: 0.5 }, 'numbers-size')),
    ] : null);

  const signsSection = el('div', { 'data-section': 'signs' }, head('parts.signs', 'signs'),
    check(style(SID.PART_SECTION_BANDS), label('parts.sectionBands'), (v) => set({ [SID.PART_SECTION_BANDS]: v }), 'section-bands'),
    check(style(SID.SHOW_TEMPO_TEXTS), label('parts.showTempo'), (v) => set({ [SID.SHOW_TEMPO_TEXTS]: v }), 'show-tempo'),
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.signsOn')), createChoiceMenu({ options: ['top', 'all'].map((m) => [m, label(`parts.signsOn.${m}`)]), value: style(SID.PART_SIGNS_ON), label: label('parts.signsOn'), act: 'signs-on', onPick: (v) => set({ [SID.PART_SIGNS_ON]: v }) })),
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.sectionCards')), createChoiceMenu({ options: ['none', 'first', 'all'].map((m) => [m, label(`parts.sectionCards.${m}`)]), value: style(SID.PART_SECTION_CARDS), label: label('parts.sectionCards'), act: 'section-cards', onPick: (v) => set({ [SID.PART_SECTION_CARDS]: v }) })),
    // the size of the cards and the distance to what they sit on, in % of the usual (10 pt text, 1.2 space above)
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.cardScale')), num(label('parts.cardScale'), Math.round(style(SID.SECTION_CARD_SCALE) * 100), (n) => app.setPartPage(part.id, { [SID.SECTION_CARD_SCALE]: n / 100 }), { min: 30, max: 150, step: 10 }, 'card-scale')),
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.cardStyle')), createChoiceMenu({ options: ['card', 'text'].map((m) => [m, label(`parts.cardStyle.${m}`)]), value: style(SID.SECTION_CARD_STYLE), label: label('parts.cardStyle'), act: 'card-style', onPick: (v) => set({ [SID.SECTION_CARD_STYLE]: v }) })),
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.cardPlace')), createChoiceMenu({ options: ['low', 'top'].map((m) => [m, label(`parts.cardPlace.${m}`)]), value: style(SID.SECTION_CARD_PLACE), label: label('parts.cardPlace'), act: 'card-place', onPick: (v) => set({ [SID.SECTION_CARD_PLACE]: v }) })),
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.cardGap')), num(label('parts.cardGap'), Math.round(style(SID.SECTION_CARD_GAP) * 100), (n) => app.setPartPage(part.id, { [SID.SECTION_CARD_GAP]: n / 100 }), { min: 0, max: 200, step: 10 }, 'card-gap')),
    // the layer of preferred fingerings the chord diagrams of this part show (an easier set, power chords…): the layers are made in the "Chords of the piece" window
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.voicingPool')), createChoiceMenu({ options: app.voicingPools().map((p) => [p.id, p.id === 'main' ? label('chords.main') : p.name]), value: part.props.partVoicingPool ?? 'main', label: label('parts.voicingPool'), act: 'voicing-pool', onPick: (v) => app.setPartPool(part.id, v === 'main' ? null : v) })));

  // "score only" hides the title block, header and footer on the pages: their settings stay (nothing is erased) but are greyed out and locked
  if (scoreOnly) {
    for (const sec of [titleSection, headerSection, footerSection]) {
      sec.style.opacity = '0.45';
      for (const c of sec.querySelectorAll('input, button, textarea, select')) if (c.getAttribute('data-field') !== 'score-only') c.disabled = true;
    }
  }
  // ----- regular measures (a chord-grid look) and measures per line -----
  // the grid: the line is cut into equal columns (a measure takes one, several or half of one), so the bar lines of all the lines fall under one another; « Measures per line » then counts COLUMNS
  const gridOn = style(SID.MEASURE_GRID) === 'columns';
  const gridBase = style(SID.MEASURE_GRID_BASE) ?? 'common';
  const gridStretch = style(SID.MEASURE_GRID_STRETCH) ?? 'off';
  const switchGrid = (v) => run(() => app.setPartPage(part.id, v
    ? { [SID.MEASURE_GRID]: 'columns', [SID.MEASURES_PER_SYSTEM]: gridColumns() ?? 0 } // the number the grid would choose, for the user to change
    : { [SID.MEASURE_GRID]: null, [SID.MEASURES_PER_SYSTEM]: null }));
  const gridRows = gridOn ? [
    el('div', { class: 'ps-row', 'data-field': 'grid-base' }, ...['common', 'widest', 'chords'].map((b) => el('button', { type: 'button', 'aria-pressed': String(gridBase === b), 'data-act': `grid-base-${b}`, title: label(`parts.gridBase.${b}.title`),
      onclick: () => set({ [SID.MEASURE_GRID_BASE]: b === 'common' ? null : b }) }, label(`parts.gridBase.${b}`)))),
    el('div', { class: 'ps-row' }, el('label', {}, label('parts.gridStretch'))),
    el('div', { class: 'ps-row', 'data-field': 'grid-stretch' }, ...['off', '2', '3', 'any'].map((b) => el('button', { type: 'button', 'aria-pressed': String(gridStretch === b), 'data-act': `grid-stretch-${b}`, title: label('parts.gridStretch.title'),
      onclick: () => set({ [SID.MEASURE_GRID_STRETCH]: b === 'off' ? null : b }) }, label(`parts.gridStretch.${b}`)))),
    ...(gridBase === 'chords' ? [el('div', { class: 'ps-row' }, el('label', {}, label('parts.gridChords')), num(label('parts.gridChords'), style(SID.MEASURE_GRID_CHORDS) ?? 2, (n) => app.setPartPage(part.id, { [SID.MEASURE_GRID_CHORDS]: n }), { min: 2, max: 4, step: 1 }, 'grid-chords'))] : []),
  ] : [];
  const measuresSection = el('div', { 'data-section': 'measures' }, head('parts.measuresLayout', 'measures'),
    check(style(SID.REGULAR_MEASURES), label('parts.regularMeasures'), (v) => set({ [SID.REGULAR_MEASURES]: v }), 'regular-measures'),
    check(gridOn, label('parts.measureGrid'), switchGrid, 'measure-grid'),
    ...gridRows,
    el('div', { class: 'ps-row' }, el('label', {}, label(gridOn ? 'parts.gridColumns' : 'parts.measuresPerSystem')), num(label(gridOn ? 'parts.gridColumns' : 'parts.measuresPerSystem'), style(SID.MEASURES_PER_SYSTEM), (n) => app.setPartPage(part.id, { [SID.MEASURES_PER_SYSTEM]: n }), { min: 0, max: 32, step: 1 }, 'measures-per-system')),
    el('div', { class: 'ps-hint' }, label(gridOn ? 'parts.gridHint' : 'parts.measuresHint')));
  // ----- system dividers: the small slashes between two systems of a page (model/dividers.js) -----
  const dividerSettings = partDividers(part);
  const setDividers = (patch) => run(() => app.setPartDividers(part.id, patch));
  const dividersSection = el('div', { 'data-section': 'dividers' }, head('dividers.title', 'dividers'),
    dividerRows(dividerSettings).map((row) => {
      if (row.kind === 'bool') return check(row.value, label(row.title), (v) => setDividers({ [row.key]: v }), `divider-${row.key}`);
      if (row.kind === 'choice') return el('div', { class: 'ps-row' }, el('label', {}, label(row.title)), createChoiceMenu({ options: row.options.map(([v, key]) => [v, label(key)]), value: row.value, label: label(row.title), act: `divider-${row.key}`, onPick: (v) => setDividers({ [row.key]: v }) }));
      return el('div', { class: 'ps-row' }, el('label', {}, label(row.title)), num(label(row.title), row.value, (n) => app.setPartDividers(part.id, { [row.key]: n }), { min: row.min, max: row.max, step: row.step }, `divider-${row.key}`));
    }));
  return [metaSection, titleSection, formatRow, headerSection, footerSection, tokens, numbersSection, measuresSection, signsSection, dividersSection];
}

/** Resolves a part style (the part's layer over the defaults). */
export const partStyleOf = (part, printDefaults = { [SID.SHOW_MEASURE_NUMBERS]: true }) => (sid) => resolveStyle(sid, [part.style, printDefaults]);
