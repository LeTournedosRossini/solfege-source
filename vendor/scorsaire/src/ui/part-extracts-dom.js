/*
 * "Extracts" of ONE part of screen 2 (model/extracts.js): a part that shows a list of blocks, each a slice of a movement chosen by section or by measures,
 * with its own tracks. A part without blocks is a normal part. This section only builds the controls; every change goes through `app` (undoable) and `run`.
 */
import { PID, getProperty, partStaffIds } from '../model/index.js';
import { extractBlocks, resolveExtracts, blockZoneCount, extractLayoutOf, EXTRACT_MAX_COLUMNS, EXTRACT_MAX_GAP, EXTRACT_MAX_ROW_GAP, MAX_EXTRACT_BLOCKS } from '../model/extracts.js';
import { sectionSpans } from '../model/sections.js';
import { createChoiceMenu } from './choice-menu.js';
import { createSwitch } from './switch.js';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};

/** The movement's own name for the lists ("1. Title"). */
const movementName = (mv, i) => `${i + 1}. ${getTitle(mv) || '…'}`;
const getTitle = (mv) => getProperty(mv, PID.TITLE) ?? '';

/** The default source of a new block: the measures chosen on screen 1 when there are some, else the first section, else the first measures. */
export function defaultBlockSpec(app, part) {
  const work = app.doc.work;
  const shown = new Set(partStaffIds(work, part));
  const index = Math.max(0, work.movements.findIndex((m) => m.tracks.some((t) => t.staves.some((st) => shown.has(st.id)))));
  const mv = work.movements[index];
  const sel = app.selectedMeasures({ movement: index });
  if (sel) return { movementId: mv.id, source: { kind: 'range', from: mv.masterbars[sel.from].id, to: mv.masterbars[sel.to].id } };
  const first = sectionSpans(mv)[0];
  if (first) return { movementId: mv.id, source: { kind: 'section', sectionId: first.id } };
  return { movementId: mv.id, source: { kind: 'range', from: mv.masterbars[0].id, to: mv.masterbars[Math.min(3, mv.masterbars.length - 1)].id } };
}

/**
 * @param o { app, label, part, run, numberField }  `run(fn)` runs a change and redraws; `numberField(label, value, onCommit, {min,max})` is the stepper of the screen
 * @returns the nodes of the section (a heading, the blocks, the add button)
 */
export function extractsSection({ app, label, part, run, numberField, getWarnings = () => [] }) {
  const work = app.doc.work;
  const blocks = extractBlocks(part);
  const resolved = resolveExtracts(work, part);
  const shown = new Set(partStaffIds(work, part));
  const nodes = [el('h3', { 'data-extracts-title': '' }, label('extracts.title')),
    el('details', { class: 'ps-hint', 'data-extracts-help': '' }, el('summary', {}, label('extracts.help')), label(blocks.length ? 'extracts.hint' : 'extracts.hintEmpty'))];

  // how the blocks are set on the page: columns, the space between them, how a row / a column goes down, blocks per page, numbers
  if (blocks.length) {
    const ex = extractLayoutOf(part);
    const set = (patch) => run(() => app.setExtractLayout(part.id, patch));
    const field = (name, value, key, opts) => { const f = numberField(label(name), value, (n) => set({ [key]: n }), opts); f.setAttribute('data-field', `extract-${key}`); return f; };
    nodes.push(el('h4', { 'data-extract-layout-title': '' }, label('extracts.layout')),
      el('div', { class: 'ps-row', 'data-extract-layout': '' }, el('label', {}, label('extracts.columns')), field('extracts.columns', ex.columns, 'columns', { min: 1, max: EXTRACT_MAX_COLUMNS }),
        ex.columns > 1 ? [el('label', {}, label('extracts.gap')), field('extracts.gap', ex.gap, 'gap', { min: 0, max: EXTRACT_MAX_GAP, step: 0.5 })] : null),
      el('div', { class: 'ps-row' }, el('label', {}, label('extracts.rowGap')), field('extracts.rowGap', ex.rowGap ?? 6, 'rowGap', { min: 0, max: EXTRACT_MAX_ROW_GAP, step: 0.5 }), ex.rowGap === null ? el('span', { class: 'ps-hint' }, label('extracts.rowGapAuto')) : el('button', { type: 'button', 'data-act': 'extract-rowgap-auto', onclick: () => set({ rowGap: null }) }, label('extracts.rowGapReset'))),
      el('div', { class: 'ps-row' }, el('label', {}, label('extracts.perPage')), field('extracts.perPage', ex.perPage, 'perPage', { min: 0, max: MAX_EXTRACT_BLOCKS }), el('span', { class: 'ps-hint' }, ex.perPage ? '' : label('extracts.perPageAuto'))),
      el('div', { class: 'ps-row' },
        ex.columns > 1 ? createSwitch({ checked: ex.flow === 'free', text: label('extracts.flowFree'), attrs: { 'data-field': 'extract-flow', title: label('extracts.flowHint') }, onchange: (e) => set({ flow: e.target.checked ? 'free' : 'grid' }) }) : null,
        createSwitch({ checked: ex.numbers, text: label('extracts.numbers'), attrs: { 'data-field': 'extract-numbers' }, onchange: (e) => set({ numbers: e.target.checked }) })));
    // what does not fit is kept and said (never cut, never shrunk)
    const shownCodes = new Set();
    for (const w of getWarnings()) {
      if (w.code !== 'extractOverflow' && w.code !== 'extractColumnNarrow') continue;
      const key = `${w.code}:${w.page ?? w.blockId}`; if (shownCodes.has(key)) continue; shownCodes.add(key);
      const nth = blocks.findIndex((b) => b.id === w.blockId) + 1;
      nodes.push(el('div', { class: 'ps-hint', role: 'note', 'data-extract-warning': '' }, '⚠ ', label(`extracts.warn.${w.code}`, { n: nth, page: w.page ?? '' })));
    }
  }

  blocks.forEach((block, bi) => {
    const info = resolved[bi];
    const mv = work.movements.find((m) => m.id === block.movementId);
    const update = (patch) => run(() => app.updateExtractBlock(part.id, block.id, patch));
    const mvIndex = work.movements.indexOf(mv);
    const spans = mv ? sectionSpans(mv) : [];
    const kind = block.source.kind;
    const setRange = (from, to) => { const a = Math.min(from, to); const b = Math.max(from, to); update({ source: { kind: 'range', from: mv.masterbars[a].id, to: mv.masterbars[b].id } }); };
    // "Sél écran 1": the measures chosen on screen 1 become the block (a block by section turns into a block by measures)
    const takeSelection = () => { const sel = mv ? app.selectedMeasures({ movement: mvIndex }) : null; if (sel) setRange(sel.from, sel.to); else run(() => { throw new Error(label('extracts.noSelection')); }); };

    const kinds = [['range', label('extracts.byMeasures')], ...(spans.length || kind === 'section' ? [['section', label('extracts.bySection')]] : [])];
    const kindMenu = createChoiceMenu({
      options: kinds, value: kind, label: label('extracts.source'), act: 'extract-kind', follow: true,
      onPick: (k) => {
        if (!mv || k === kind) return;
        if (k === 'section') update({ source: { kind: 'section', sectionId: spans[0].id } });
        else { const r = info.range ?? { from: 0, to: Math.min(3, mv.masterbars.length - 1) }; update({ source: { kind: 'range', from: mv.masterbars[r.from].id, to: mv.masterbars[r.to].id } }); }
      },
    });
    const head = el('div', { class: 'ps-row', 'data-extract-head': '' },
      el('strong', {}, `${bi + 1}.`), kindMenu,
      bi > 0 ? el('button', { type: 'button', 'data-act': 'extract-up', title: label('extracts.up'), 'aria-label': label('extracts.up'), onclick: () => run(() => app.moveExtractBlock(part.id, block.id, bi - 1)) }, '▲') : null,
      bi < blocks.length - 1 ? el('button', { type: 'button', 'data-act': 'extract-down', title: label('extracts.down'), 'aria-label': label('extracts.down'), onclick: () => run(() => app.moveExtractBlock(part.id, block.id, bi + 1)) }, '▼') : null,
      el('button', { type: 'button', 'data-act': 'extract-remove', title: label('extracts.remove'), 'aria-label': label('extracts.remove'), onclick: () => run(() => app.removeExtractBlock(part.id, block.id)) }, '✕'));

    const rows = [head];
    if (work.movements.length > 1) {
      rows.push(el('div', { class: 'ps-row' }, createChoiceMenu({
        options: work.movements.map((m, i) => [m.id, movementName(m, i)]), value: block.movementId, label: label('extracts.movement'), act: 'extract-movement', follow: true,
        onPick: (id) => { const m = work.movements.find((q) => q.id === id); if (m) update({ movementId: id, source: { kind: 'range', from: m.masterbars[0].id, to: m.masterbars[Math.min(3, m.masterbars.length - 1)].id } }); },
      })));
    }
    if (mv && kind === 'section') {
      rows.push(el('div', { class: 'ps-row' }, createChoiceMenu({
        options: spans.map((s) => [s.id, `${s.label || label('extracts.unnamed')} (${s.from + 1}–${s.to + 1})`]), value: block.source.sectionId, label: label('extracts.section'), act: 'extract-section', follow: true,
        onPick: (id) => update({ source: { kind: 'section', sectionId: id } }),
      })));
    } else if (mv) {
      const total = mv.masterbars.length;
      const r = info.range ?? { from: 0, to: 0 };
      const fromField = numberField(label('extracts.from'), r.from + 1, (n) => setRange(Math.min(Math.max(n, 1), total) - 1, r.to), { min: 1, max: total });
      const toField = numberField(label('extracts.to'), r.to + 1, (n) => setRange(r.from, Math.min(Math.max(n, 1), total) - 1), { min: 1, max: total });
      fromField.setAttribute('data-field', 'extract-from'); toField.setAttribute('data-field', 'extract-to');
      rows.push(el('div', { class: 'ps-row' }, el('label', {}, label('extracts.from')), fromField, el('label', {}, label('extracts.to')), toField));
    }
    // the tracks of THIS block: all the tracks the part shows, or only some
    if (mv) {
      const tracks = mv.tracks.filter((t) => t.staves.some((st) => shown.has(st.id)));
      const wanted = block.staffIds ? new Set(block.staffIds) : null;
      const isOn = (t) => t.staves.some((st) => shown.has(st.id) && (!wanted || wanted.has(st.id)));
      const onTracks = tracks.filter(isOn);
      rows.push(el('div', { class: 'ps-row', 'data-extract-tracks': '' }, createChoiceMenu({
        options: [{ action: 'screen1', text: label('extracts.screen1'), title: label('extracts.takeSelectionHint'), run: () => takeSelection() }, ...tracks.map((t) => [t.id, getProperty(t, PID.NAME) || '?'])], value: onTracks.map((t) => t.id), multi: true, label: label('extracts.tracks'), act: 'extract-tracks',
        buttonText: label('extracts.tracksButton', { n: onTracks.length, total: tracks.length }),
        onPick: (ids) => {
          if (!ids.length) return; // a block keeps at least one track
          const chosen = new Set(ids);
          const all = tracks.every((t) => chosen.has(t.id));
          update({ staffIds: all ? null : tracks.filter((t) => chosen.has(t.id)).flatMap((t) => t.staves).filter((st) => shown.has(st.id)).map((st) => st.id) });
        },
      })));
    }
    // how this block reads the chords (a block of the same part may differ: the verse as capo shapes, the solo with the real chords)
    rows.push(el('div', { class: 'ps-row', 'data-extract-chordview': '' }, el('span', {}, label('parts.chordView')), createChoiceMenu({
      options: [['', label('extracts.chordView.part')], ...['author', 'original', 'capo'].map((m) => [m, label(`parts.chordView.${m}`)])], value: block.chordView ?? '', label: label('parts.chordView'), act: 'extract-chord-view',
      onPick: (m) => update({ chordView: m || null }),
    })));
    // page rules of the block
    rows.push(el('div', { class: 'ps-row', 'data-extract-pages': '' },
      createSwitch({ checked: !!block.keepTogether, text: label('extracts.keepTogether'), attrs: { 'data-field': 'extract-keep' }, onchange: (e) => update({ keepTogether: e.target.checked }) })));
    // zones attached to the block: above its first system and under its last (written, picked and sized on the page like the zones between systems)
    const titleText = () => (kind === 'section' && spans.find((sp) => sp.id === block.source.sectionId)?.label ? `{{${spans.find((sp) => sp.id === block.source.sectionId).label}}}` : info.range ? label('extracts.titleMeasures', { from: info.range.from + 1, to: info.range.to + 1 }) : '');
    const nAbove = blockZoneCount(part, block.id, 'above'); const nBelow = blockZoneCount(part, block.id, 'below');
    const adders = {
      title: () => app.addBlockZone(part.id, block.id, 'above', { kind: 'text', text: titleText(), height: 3 }),
      above: () => app.addBlockZone(part.id, block.id, 'above'),
      below: () => app.addBlockZone(part.id, block.id, 'below'),
      text: () => app.addBlockContainer(part.id, block.id, { kind: 'text', text: '…' }),
      notation: () => app.addBlockContainer(part.id, block.id, { kind: 'nestedNotation' }),
      page: () => app.updateExtractBlock(part.id, block.id, { breakBefore: !block.breakBefore }),
    };
    rows.push(el('div', { class: 'ps-row', 'data-extract-add': '' }, createChoiceMenu({
      options: [['title', label('extracts.add.title')], ['above', label('extracts.add.above')], ['below', label('extracts.add.below')], ['text', label('extracts.add.text')], ['notation', label('extracts.add.notation')], ['page', `${block.breakBefore ? '✓ ' : ''}${label('extracts.breakBefore')}`]],
      value: null, label: label('extracts.add.label'), act: 'extract-add-menu', buttonText: label('extracts.add.label'), onPick: (k) => run(adders[k]),
    }), nAbove + nBelow ? el('span', { class: 'ps-hint' }, label('extracts.zone.countBoth', { above: nAbove, below: nBelow })) : null));
    // what cannot be kept at the edges of the block
    const notes = info.missing ? [label('extracts.warn.missing')] : info.warnings.map((w) => label(`extracts.warn.${w.code}`, { n: w.count ?? 1 }));
    for (const text of notes) rows.push(el('div', { class: 'ps-hint', role: 'note', 'data-extract-warning': '' }, '⚠ ', text));
    nodes.push(el('div', { class: 'ps-extract', 'data-extract': block.id }, ...rows));
  });

  nodes.push(el('div', { class: 'ps-row' },
    el('button', { type: 'button', 'data-act': 'extract-add', onclick: () => run(() => app.addExtractBlock(part.id, defaultBlockSpec(app, part))) }, label('extracts.add')),
    work.movements.length > 1 ? el('button', { type: 'button', 'data-act': 'extract-add-all', title: label('extracts.addAllHint'), onclick: () => run(() => app.addBlockPerMovement(part.id)) }, label('extracts.addAll')) : null));
  return nodes;
}
