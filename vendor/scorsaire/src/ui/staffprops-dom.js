/*
 * Staff properties panel — DOM. Opened from the context bar for a staff; shows the settings that apply to the type of the staff:
 * percussion map and sticking system (percussion), button layout (accordion left hand), spelling of chord notes (chord staff).
 *
 * Presentation: a sheet from the bottom of the screen on phones and tablets, a floating window (draggable by its title) on desktop
 * (`panel-mode.js`). The panel is fixed to the viewport and added to <body>: it never takes room in the page, so the score never moves.
 * Every control calls one intent of the Application (one undoable transaction). Control size = the global `--ui-target` variable (button-size.js: user setting per device).
 */
import { groupedOptions } from './menu-groups.js';
import { createChoiceMenu } from './choice-menu.js';
import { cardTitle } from './strumcards-dom.js';
import { trackDisplayRow } from './track-display-dom.js';
import { DEFAULT_DISPLAY } from '../model/trackdisplay.js';
import { nameOfPitch } from '../model/tuningedit.js';
import { pitchFromName } from '../model/capo.js';
import { SHEET_QUERY, panelMode, clampWindow } from './panel-mode.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { OFFSET_MIN, OFFSET_MAX, OFFSET_STEP, STRUM_INSTRUMENTS, STRUM_DELAY_MAX } from './staffprops-intents.js';
import { STICKING_PRESETS } from '../model/sticking.js';
import { BUTTON_PLACEMENTS } from '../model/accordion.js';

const STYLE_ID = 'staff-props-style';
const CSS = `
[data-staff-props] { --sp-target: var(--ui-target, 30px); position: fixed; z-index: 2500; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 2px 12px rgba(0,0,0,.3); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; overflow: auto; }
[data-staff-props][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); max-height: 60vh; border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom); }
[data-staff-props][data-mode="floating"] { width: 380px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 8px; }
[data-staff-props] .sp-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 6px 6px 6px 12px; background: var(--soft,#f1f1f1); border-bottom: 1px solid var(--edge,#ccc); }
[data-staff-props][data-mode="floating"] .sp-head { cursor: move; touch-action: none; }
[data-staff-props] .sp-title { flex: 1 1 auto; font-weight: var(--w-semi,600); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-staff-props] .sp-section { padding: 8px 12px; border-bottom: 1px solid #e4e4e4; }
[data-staff-props] .sp-section h3 { margin: 0 0 6px; font-size: 14px; }
[data-staff-props] .sp-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap, 2px); margin: 4px 0; }
[data-staff-props] .sp-label { min-width: 7em; }
[data-staff-props] button { min-width: var(--sp-target); min-height: var(--sp-target); padding: 0 10px; font: inherit; }
[data-staff-props] button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
[data-staff-props] input[type="text"] { width: 5em; min-height: var(--sp-target); font-size: 16px; padding: 0 8px; box-sizing: border-box; }
[data-staff-props] .sp-value { min-width: 3.5em; text-align: center; font-variant-numeric: tabular-nums; }
[data-staff-props] .sp-status { min-height: 20px; padding: 2px 12px; color: var(--danger-ink,#b00020); }
`;

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};

const STICKING_PRESET_TEXT = { 'letters-rl': 'R / L', 'letters-dg': 'D / G', shapes: '□ / ●' };
const symbolText = (s) => (s?.text ?? s?.glyph ?? '');

/**
 * @param app      Application
 * @param options  { label(key, params) → text, onPercmap(staffId) }
 * @returns { open(staffId), close(), isOpen(), staffId(), destroy() }
 */
export function mountStaffProperties({ app, label = (k) => k, onPercmap = null, onBake = null, onPatterns = null, onCards = null }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let panel = null;
  let staffId = null;
  let message = '';
  let dragged = null; // { left, top } once the user has moved the floating window
  const media = window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  const mode = () => panelMode(media ? media.matches : false);

  /** Runs an intent; a refused value is shown in the panel instead of crashing. */
  const run = (fn) => {
    try { message = ''; fn(); } catch (e) { if (e.name !== 'StaffPropertyError') throw e; message = e.message; }
    draw();
  };

  const group = (text, ...children) => el('div', { class: 'sp-row' }, el('span', { class: 'sp-label' }, text), ...children);
  const segmented = (key, options, current, onPick) => el('span', { class: 'sp-row', role: 'group', 'data-seg': key },
    options.map(([value, text]) => el('button', { type: 'button', 'data-key': `${key}-${value}`, 'aria-pressed': String(value === current), onclick: () => onPick(value) }, text)));
  const section = (key, title, ...children) => el('section', { class: 'sp-section', 'data-section': key }, el('h3', {}, title), ...children);
  const placementOptions = () => BUTTON_PLACEMENTS.map((p) => [p, label(`staffProps.${p}`)]);

  const percmapSection = (info) => section('percmap', label('percmap.title'),
    el('div', { class: 'sp-row' }, el('span', {}, label('staffProps.percmap.current', { name: info.percmap.name, count: info.percmap.soundCount }))),
    onPercmap && el('div', { class: 'sp-row' }, el('button', { type: 'button', 'data-key': 'open-percmap', onclick: () => onPercmap(staffId) }, label('staffProps.percmap.edit'))));

  const stickingSection = (info) => {
    const s = info.sticking;
    const symbolInput = (hand) => el('input', {
      type: 'text', maxlength: '4', value: s[hand].text ?? '', placeholder: s[hand].glyph ?? '', 'data-key': `sticking-${hand}`,
      'aria-label': label(`staffProps.sticking.${hand}`), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      onchange: (e) => { const text = e.target.value; if (text) run(() => app.setStickingSystem(staffId, { preset: 'custom', [hand]: { text } })); else draw(); },
    });
    return section('sticking', label('staffProps.sticking.title'),
      group(label('staffProps.sticking.preset'), segmented('sticking-preset', STICKING_PRESETS.map((p) => [p, p === 'custom' ? label('staffProps.sticking.custom') : STICKING_PRESET_TEXT[p]]), s.preset,
        (preset) => run(() => app.setStickingSystem(staffId, { preset })))),
      group(label('staffProps.sticking.placement'), segmented('sticking-placement', placementOptions(), s.placement,
        (placement) => run(() => app.setStickingSystem(staffId, { placement })))),
      s.preset === 'custom' && group(label('staffProps.sticking.right'), symbolInput('right')),
      s.preset === 'custom' && group(label('staffProps.sticking.left'), symbolInput('left')),
      s.preset !== 'custom' && el('div', { class: 'sp-row' }, el('span', {}, `${symbolText(s.right)} / ${symbolText(s.left)}`)));
  };

  const accordionSection = (info) => {
    const a = info.accordion;
    const step = (delta) => run(() => app.setAccordionLayout(staffId, { buttonOffset: a.buttonOffset + delta }));
    return section('accordion', label('staffProps.accordion.title'),
      group(label('staffProps.accordion.placement'), segmented('accordion-placement', placementOptions(), a.buttonPlacement,
        (buttonPlacement) => run(() => app.setAccordionLayout(staffId, { buttonPlacement })))),
      group(label('staffProps.accordion.offset'),
        el('button', { type: 'button', 'data-key': 'accordion-offset-minus', 'aria-label': '−', disabled: a.buttonOffset <= OFFSET_MIN, onclick: () => step(-OFFSET_STEP) }, '−'),
        el('span', { class: 'sp-value', 'data-value': 'accordion-offset' }, String(a.buttonOffset)),
        el('button', { type: 'button', 'data-key': 'accordion-offset-plus', 'aria-label': '+', disabled: a.buttonOffset >= OFFSET_MAX, onclick: () => step(OFFSET_STEP) }, '+')));
  };

  const strumSection = (info) => {
    const st = info.strum;
    const delay = st.delayMs;
    const stepDelay = (d) => run(() => app.setStrum(staffId, { delayMs: Math.max(0, Math.min(STRUM_DELAY_MAX, (delay ?? 14) + d)) }));
    return section('strum', label('staffProps.strum.title'),
      el('div', { class: 'sp-row' }, el('span', {}, label('staffProps.strum.hint'))),
      group(label('staffProps.strum.enabled'), segmented('strum-enabled', [['off', label('staffProps.strum.off')], ['on', label('staffProps.strum.on')]], st.enabled ? 'on' : 'off',
        (v) => run(() => app.setStrum(staffId, { enabled: v === 'on' })))),
      st.enabled && onBake && el('div', { class: 'sp-row' }, el('button', { type: 'button', 'data-key': 'strum-bake', onclick: () => onBake(staffId) }, label('strum.bake.open'))),
      st.enabled && group(label('strum.cardOfStaff'), createChoiceMenu({
        options: groupedOptions(app.strumCards().filter((c) => c.kind === (st.resolved === 'piano' ? 'piano' : 'strum')), { text: (c) => cardTitle(c, label), label, browse: label('strum.cardOfStaff') }), value: st.card ?? (st.resolved === 'piano' ? 'piano' : 'standard'), label: label('strum.cardOfStaff'), act: 'strum-card',
        onPick: (card) => run(() => app.setStrum(staffId, { card })),
      })),
      st.enabled && st.resolved !== 'piano' && group(label('staffProps.strum.pattern'), segmented('strum-pattern', [['card', label('strum.fromCard')], ['down', label('staffProps.strum.down')], ['alternate', label('staffProps.strum.alternate')]], st.pattern ?? 'card',
        (pattern) => run(() => app.setStrum(staffId, { pattern: pattern === 'card' ? null : pattern })))),
      st.enabled && st.resolved !== 'piano' && group(label('staffProps.strum.path'), segmented('strum-path', [['off', label('staffProps.strum.path.off')], ['easy', label('staffProps.strum.path.easy')], ['balanced', label('staffProps.strum.path.balanced')], ['close', label('staffProps.strum.path.close')]], st.path ?? 'balanced',
        (path) => run(() => app.setStrum(staffId, { path })))),
      st.enabled && st.resolved !== 'piano' && el('div', { class: 'sp-row', style: 'font-size:12px;opacity:.75' }, label('staffProps.strum.pathHint')),
      st.enabled && st.resolved !== 'piano' && group(label('staffProps.strum.diagrams'), segmented('strum-diagrams', [['off', label('staffProps.strum.diagrams.off')], ['changes', label('staffProps.strum.diagrams.changes')], ['first', label('staffProps.strum.diagrams.first')], ['all', label('staffProps.strum.diagrams.all')]], st.diagrams ?? 'off',
        (diagrams) => run(() => app.setStrum(staffId, { diagrams })))),
      st.enabled && st.resolved !== 'piano' && st.diagrams !== 'off' && diagramSizeRow(st.diagramScale ?? 1, (diagramScale) => run(() => app.setStrum(staffId, { diagramScale })), 'strum-diagrams'),
      st.enabled && st.resolved !== 'piano' && st.diagrams !== 'off' && el('div', { class: 'sp-row', style: 'font-size:12px;opacity:.75' }, label('staffProps.strum.diagramsHint')),
      st.enabled && group(label('staffProps.strum.instrument'), segmented('strum-instrument', ['auto', ...STRUM_INSTRUMENTS].map((i) => [i, i === 'auto' ? `${label('staffProps.strum.instrument.auto')} : ${label(`staffProps.strum.instrument.${st.resolved}`)}` : label(`staffProps.strum.instrument.${i}`)]), st.instrument ?? 'auto',
        (instrument) => run(() => app.setStrum(staffId, { instrument })))),
      st.enabled && st.resolved !== 'piano' && group(label('staffProps.strum.delay'),
        el('button', { type: 'button', 'data-key': 'strum-delay-minus', 'aria-label': '−', disabled: delay === 0, onclick: () => stepDelay(-2) }, '−'),
        el('span', { class: 'sp-value', 'data-value': 'strum-delay' }, delay === null ? label('strum.fromCard') : `${delay} ms`),
        el('button', { type: 'button', 'data-key': 'strum-delay-plus', 'aria-label': '+', disabled: delay === STRUM_DELAY_MAX, onclick: () => stepDelay(2) }, '+'),
        delay !== null && el('button', { type: 'button', 'data-key': 'strum-delay-auto', onclick: () => run(() => app.setStrum(staffId, { delayMs: null })) }, label('strum.fromCard'))));
  };

  const spellingSection = (info) => section('chordSpelling', label('staffProps.chordSpelling.title'),
    el('div', { class: 'sp-row' }, segmented('spelling', [['enharmonic', label('staffProps.chordSpelling.enharmonic')], ['key', label('staffProps.chordSpelling.key')]], info.chordSpelling,
      (mode) => run(() => app.setChordSpelling(staffId, mode)))));

  const playedSection = (info) => {
    const cp = info.chordPlayed; const patterns = app.chordPatterns();
    const cards = app.strumCards().filter((c) => c.kind !== 'drums'); const fretted = (cards.find((c) => c.id === (cp.card ?? 'piano'))?.kind ?? 'piano') === 'strum';
    const nameOf = (p) => p.name ?? (p.source === 'builtin' ? label(`chordPattern.${p.id}`) : p.id);
    return section('chordPlayed', label('staffProps.chordPlayed.title'),
      el('div', { class: 'sp-row' }, el('span', {}, label('staffProps.chordPlayed.hint'))),
      group(label('chordPattern.label'), createChoiceMenu({
        options: groupedOptions(patterns, { text: nameOf, label, head: [['', label('chordPattern.none')]], browse: label('chordPattern.label') }), value: cp.pattern ?? '', label: label('chordPattern.label'), act: 'chord-pattern', follow: true,
        onPick: (id) => run(() => app.setChordPattern(staffId, { pattern: id || null })),
      })),
      cp.pattern && group(label('strum.cardOfStaff'), createChoiceMenu({
        options: groupedOptions(cards, { text: (c) => cardTitle(c, label), label, browse: label('strum.cardOfStaff') }), value: cp.card ?? 'piano', label: label('strum.cardOfStaff'), act: 'chord-card', follow: true,
        onPick: (card) => run(() => app.setChordPattern(staffId, { card })),
      })),
      cp.pattern && fretted && group(label('staffProps.strum.instrument'), segmented('chord-instrument', ['auto', ...STRUM_INSTRUMENTS.filter((i) => i !== 'piano')].map((i) => [i, label(`staffProps.strum.instrument.${i}`)]), cp.instrument === 'piano' ? 'auto' : cp.instrument,
        (instrument) => run(() => app.setChordPattern(staffId, { instrument })))),
      el('div', { class: 'sp-row' },
        onPatterns && el('button', { type: 'button', 'data-key': 'chord-patterns', onclick: () => onPatterns(staffId) }, label('chordPatternEditor.open')),
        onCards && el('button', { type: 'button', 'data-key': 'chord-cards', onclick: () => onCards(cp.card ?? 'piano') }, label('strum.cardsOpen')),
        onBake && el('button', { type: 'button', 'data-key': 'chord-bake', onclick: () => onBake(staffId) }, label('strum.bake.open'))));
  };

  const displaySection = (info) => section('display', label('trackDisplay.label'),
    trackDisplayRow({ label, own: info.display.own, base: DEFAULT_DISPLAY, sizeable: true, className: 'sp-row', onSet: (patch) => run(() => app.setTrackDisplay(info.display.trackId, patch)) }));

  const tuningSection = (info) => {
    const t = info.tuning; const n = t.names.length;
    const change = (names) => run(() => { const r = app.setStaffTuning(staffId, names); if (r?.failed) message = label('staffProps.tuning.failed', { n: r.failed }); });
    const shift = (i, d) => { const next = t.names.slice(); next[i] = nameOfPitch(pitchFromName(next[i]) + d); change(next); };
    return section('tuning', label('staffProps.tuning.title'),
      el('div', { class: 'sp-row', role: 'group', 'data-seg': 'tuning-preset' }, t.presets.map((p) => el('button', {
        type: 'button', 'data-key': `tuning-preset-${p.id}`, 'aria-pressed': String(p.names.every((x, i) => x === t.names[i])), onclick: () => change(p.names),
      }, label(`guitar.tuning.${p.id}`)))),
      t.names.map((name, i) => group(label('staffProps.tuning.string', { n: i + 1 }),
        el('button', { type: 'button', 'data-key': `tuning-${i + 1}-minus`, 'aria-label': '−', onclick: () => shift(i, -1) }, '−'),
        el('span', { class: 'sp-value', 'data-value': `tuning-${i + 1}` }, name.replace('#', '♯')),
        el('button', { type: 'button', 'data-key': `tuning-${i + 1}-plus`, 'aria-label': '+', onclick: () => shift(i, 1) }, '+'))),
      el('div', { class: 'sp-row' }, el('span', { style: 'font-size:12px;color:var(--ink-faint,#777)' }, label('staffProps.tuning.note', { n }))));
  };

  // a second display of the chord track (a linked chord staff): the chords read as played with the capo, as the author tagged them, or shifted; nothing written changes
  const chordReadingSection = (info) => {
    const r = info.chordReading;
    return section('chordReading', label('staffProps.chordReading.title'),
      el('div', { class: 'sp-row' }, el('span', {}, label('staffProps.chordReading.hint'))),
      segmented('chord-reading', [['capo', label('chordView.capo')], ['author', label('staffProps.chordReading.author')], ['shift', label('chordView.setShift')]], r.view, (view) => run(() => app.setChordReading(staffId, { view }))),
      r.view === 'shift' && group(label('staffProps.chordReading.semitones'),
        el('button', { type: 'button', 'data-key': 'chord-reading-minus', 'aria-label': '−', disabled: r.shift <= -11, onclick: () => run(() => app.setChordReading(staffId, { shift: r.shift - 1 })) }, '−'),
        el('span', { class: 'sp-value', 'data-value': 'chord-reading-shift' }, `${r.shift > 0 ? '+' : ''}${r.shift}`),
        el('button', { type: 'button', 'data-key': 'chord-reading-plus', 'aria-label': '+', disabled: r.shift >= 11, onclick: () => run(() => app.setChordReading(staffId, { shift: r.shift + 1 })) }, '+')));
  };

  // the guitar whose capo gives the « capo shapes » of the chords (several tablatures may have different capos)
  const chordCapoSection = (info) => {
    const c = info.chordCapo; if (!c.staves.length) return null;
    return section('chordCapo', label('staffProps.chordCapo.title'),
      el('div', { class: 'sp-row' }, el('span', {}, label('staffProps.chordCapo.hint'))),
      group(label('staffProps.chordCapo.staff'), createChoiceMenu({
        options: [['', label('staffProps.chordCapo.auto')], ...c.staves.map((x) => [x.id, x.name])], value: c.chosen ?? '', label: label('staffProps.chordCapo.staff'), act: 'chord-capo-staff',
        onPick: (id) => run(() => app.setChordCapoStaff(staffId, id || null)),
      })));
  };

  const diagramsSection = (info) => {
    const d = info.chordDiagrams;
    return section('chordDiagrams', label('staffProps.chordDiagrams.title'),
      el('div', { class: 'sp-row' }, el('span', {}, label('staffProps.chordDiagrams.hint'))),
      group(label('staffProps.chordDiagrams.fingering'), createChoiceMenu({
        options: [['', label('staffProps.chordDiagrams.proposed')], ...d.tabs.map((x) => [x.id, label('staffProps.chordDiagrams.played', { name: x.name })])], value: d.tabStaff ?? '', label: label('staffProps.chordDiagrams.fingering'), act: 'diagram-tab-staff', follow: true,
        onPick: (id) => run(() => app.setDiagramTabStaff(staffId, id || null)),
      })),
      group(label('staffProps.chordDiagrams.auto'), createChoiceMenu({
        options: [['off', label('staffProps.chordDiagrams.auto.off')], ['voicing', label('staffProps.chordDiagrams.auto.voicing')], ['all', label('staffProps.chordDiagrams.auto.all')]], value: d.mode ?? 'off', label: label('staffProps.chordDiagrams.auto'), act: 'chord-diagrams-auto', follow: true,
        onPick: (mode) => run(() => app.setChordDiagramsMode(staffId, mode)),
      })));
  };


  const diagramSizeRow = (scale, apply, key) => group(label('staffProps.diagramSize'),
    el('button', { type: 'button', 'data-key': `${key}-size-minus`, 'aria-label': '−', disabled: scale <= 0.5 + 1e-9, onclick: () => apply(Math.max(0.5, Math.round((scale - 0.1) * 100) / 100)) }, '−'),
    el('span', { class: 'sp-value', 'data-value': `${key}-size` }, `${Math.round(scale * 100)} %`),
    el('button', { type: 'button', 'data-key': `${key}-size-plus`, 'aria-label': '+', disabled: scale >= 2 - 1e-9, onclick: () => apply(Math.min(2, Math.round((scale + 0.1) * 100) / 100)) }, '+'),
    el('button', { type: 'button', 'data-key': `${key}-size-reset`, title: label('settings.reset'), 'aria-label': label('settings.reset'), disabled: scale === 1, onclick: () => apply(1) }, '↺'));
  const tabDiagramsSection = (info) => {
    const d = info.tabDiagrams;
    return section('tabDiagrams', label('staffProps.tabDiagrams.title'),
      group(label('staffProps.tabDiagrams.mode'), segmented('tab-diagrams', [['off', label('staffProps.tabDiagrams.off')], ['changes', label('staffProps.tabDiagrams.changes')], ['first', label('staffProps.tabDiagrams.first')], ['all', label('staffProps.tabDiagrams.all')]], d.mode,
        (mode) => run(() => app.setTabDiagrams(staffId, { mode })))),
      d.mode !== 'off' && diagramSizeRow(d.scale, (scale) => run(() => app.setTabDiagrams(staffId, { scale })), 'tab-diagrams'),
      d.mode !== 'off' && group(label('staffProps.tabDiagrams.min'),
        el('button', { type: 'button', 'data-key': 'tab-diagrams-min-minus', 'aria-label': '−', disabled: d.min <= 2, onclick: () => run(() => app.setTabDiagrams(staffId, { min: d.min - 1 })) }, '−'),
        el('span', { class: 'sp-value', 'data-value': 'tab-diagrams-min' }, String(d.min)),
        el('button', { type: 'button', 'data-key': 'tab-diagrams-min-plus', 'aria-label': '+', disabled: d.min >= 6, onclick: () => run(() => app.setTabDiagrams(staffId, { min: d.min + 1 })) }, '+')),
      el('div', { class: 'sp-row', style: 'font-size:12px;opacity:.75' }, label(d.mode === 'off' ? 'staffProps.tabDiagrams.hint' : 'staffProps.tabDiagrams.hintOn')));
  };

  // arpeggio signs on the chords of this track: the delay between two notes (a setting of the track, also found in Settings › track options); empty = follows the movement
  const arpeggioSection = (info) => {
    const a = info.arpeggio; if (!a) return null;
    const now = a.stepMs ?? a.inherited, text = (v) => (v > 0 ? `${v} ms` : label('settings.auto'));
    const set = (v) => run(() => app.setTrackSetting(a.trackId, 'ARPEGGIO_STEP_MS', v));
    return section('arpeggio', label('staffProps.arpeggio.title'),
      group(label('staffProps.arpeggio.step'),
        el('button', { type: 'button', 'data-key': 'arpeggio-step-minus', 'aria-label': '−', disabled: now <= 0, onclick: () => set(Math.max(0, now - 5)) }, '−'),
        el('span', { class: 'sp-value', 'data-value': 'arpeggio-step' }, a.stepMs === null ? `${label('settings.follow')} (${text(a.inherited)})` : text(a.stepMs)),
        el('button', { type: 'button', 'data-key': 'arpeggio-step-plus', 'aria-label': '+', disabled: now >= 250, onclick: () => set(Math.min(250, now + 5)) }, '+'),
        el('button', { type: 'button', 'data-key': 'arpeggio-step-reset', title: label('settings.reset'), 'aria-label': label('settings.reset'), disabled: a.stepMs === null, onclick: () => set(null) }, '↺')),
      el('div', { class: 'sp-row', style: 'font-size:12px;opacity:.75' }, label('staffProps.arpeggio.hint')));
  };

  const gridLyricsSection = (info) => section('gridLyrics', label('staffProps.gridLyrics.title'),
    el('div', { class: 'sp-row' }, el('span', {}, label('staffProps.gridLyrics.hint'))),
    group(label('staffProps.gridLyrics.show'), segmented('grid-lyrics', [['auto', label('staffProps.gridLyrics.auto')], ['on', label('staffProps.gridLyrics.on')], ['off', label('staffProps.gridLyrics.off')]], info.gridLyrics ?? 'auto',
      (mode) => run(() => app.setGridLyrics(staffId, mode)))));

  const builders = { chordCapo: chordCapoSection, chordReading: chordReadingSection, gridLyrics: gridLyricsSection, tuning: tuningSection, percmap: percmapSection, sticking: stickingSection, accordion: accordionSection, chordSpelling: spellingSection, chordPlayed: playedSection, chordDiagrams: diagramsSection, tabDiagrams: tabDiagramsSection, arpeggio: arpeggioSection, strum: strumSection, display: displaySection };

  /** Puts the panel where its presentation says: bottom sheet, or floating window (default bottom-right, or where the user dragged it). */
  const place = () => {
    const m = mode();
    panel.setAttribute('data-mode', m);
    if (m === 'sheet') { panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.bottom = ''; return; }
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const start = dragged ?? { left: vw - rect.width - 12, top: vh - rect.height - 12 };
    const pos = clampWindow({ ...start, width: rect.width, height: rect.height, viewportWidth: vw, viewportHeight: vh });
    panel.style.left = `${pos.left}px`; panel.style.top = `${pos.top}px`; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  };

  const enableDrag = (head) => {
    let start = null;
    head.addEventListener('pointerdown', (e) => {
      if (mode() !== 'floating' || e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      start = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      head.setPointerCapture?.(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!start) return;
      const rect = panel.getBoundingClientRect();
      dragged = clampWindow({ left: e.clientX - start.dx, top: e.clientY - start.dy, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
      panel.style.left = `${dragged.left}px`; panel.style.top = `${dragged.top}px`;
    });
    const end = () => { start = null; };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  };

  function draw() {
    if (staffId == null) return;
    const info = app.staffProperties(staffId);
    if (!info || !info.sections.length) { api.close(); return; }
    const focusKey = document.activeElement?.closest?.('[data-staff-props]') ? document.activeElement.getAttribute('data-key') : null;
    if (!panel) {
      panel = el('div', { 'data-staff-props': '', 'data-resizable': 'staffProps', 'data-zoom-lock': '', role: 'dialog', 'aria-label': label('staffProps.title') });
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } });
      panel.addEventListener('panelmoved', (e) => { dragged = { left: e.detail.left, top: e.detail.top }; });
      document.body.append(panel);
    }
    const head = el('div', { class: 'sp-head' },
      el('span', { class: 'sp-title' }, info.trackName ? `${label('staffProps.title')} — ${info.trackName}` : label('staffProps.title')),
      el('button', { type: 'button', 'data-key': 'close', 'aria-label': label('staffProps.close'), title: label('staffProps.close'), onclick: () => api.close() }, '✕'));
    enableDrag(head);
    const status = el('div', { class: 'sp-status', role: 'status', 'data-staff-props-message': '' }, message);
    panel.replaceChildren(head, status, ...info.sections.map((s) => builders[s](info)));
    place();
    if (focusKey) panel.querySelector(`[data-key="${focusKey}"]`)?.focus?.({ preventScroll: true });
  }

  const onResize = () => { if (panel) place(); };
  window.addEventListener('resize', onResize);
  media?.addEventListener?.('change', onResize);
  const off = app.doc.subscribe(() => { if (staffId != null) draw(); });
  const offOutside = dismissOnOutside(() => panel, () => api.close());

  const api = {
    open(id) { staffId = id; message = ''; draw(); },
    close() { staffId = null; message = ''; panel?.remove(); panel = null; },
    isOpen: () => staffId != null,
    staffId: () => staffId,
    destroy() { api.close(); off(); offOutside(); window.removeEventListener('resize', onResize); media?.removeEventListener?.('change', onResize); },
  };
  return api;
}
