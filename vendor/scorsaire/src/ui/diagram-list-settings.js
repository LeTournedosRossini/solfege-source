/*
 * The settings of a DIAGRAM LIST cell (screen 2, a zone above or between the systems): what it lists (the chords of the chord staff or the fingerings written in a tablature), the
 * instrument, the whole movement or the system above, each chord once or in order, which variants of a chord, grouping (by section of the form or by the labels the user gave the
 * fingerings), the layer of fingerings, the alignment and the size of the name written over a group. A floating window (it does not hide the page while one adjusts): menus for the
 * choices, icons for the alignment, a stepper for the size. Every change goes through `run` (undoable) and the window draws itself again from the cell as it is then.
 */
import { createChoiceMenu } from './choice-menu.js';
import { icon } from './icons.js';

const LABEL_SIZES = { min: 0.5, max: 3, step: 0.1 };

/** The icon of a justified paragraph (the icon set has the three other alignments only). */
function justifyIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round');
  for (const y of [6, 12, 18]) { const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', '4'); l.setAttribute('x2', '20'); l.setAttribute('y1', String(y)); l.setAttribute('y2', String(y)); svg.append(l); }
  return svg;
}

/** @param o { app, label, partId, cellId, run, openChords } — `run(fn)` runs a change and redraws the screen; `openChords(opts)` opens the "Chords of the piece" window. */
export function openDiagramListSettings({ app, label, partId, cellId, run, openChords }) {
  document.querySelector('[data-diagram-list-settings]')?.remove();
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const box = el('div', 'position:fixed;top:84px;right:16px;z-index:3400;width:min(380px,94vw);max-height:calc(100vh - 110px);overflow:auto;box-sizing:border-box;background:var(--paper,#faf8f4);color:var(--ink,#111);border:1px solid var(--edge,#b9b4a8);border-radius:10px;padding:10px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px', { 'data-diagram-list-settings': '', 'data-zoom-lock': '', role: 'dialog' });
  document.body.append(box);
  const close = () => { window.removeEventListener('keydown', onKey, true); box.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' && box.isConnected) { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  const cell = () => app.doc.work.parts.find((q) => q.id === partId)?.containers?.find((x) => x.id === cellId) ?? null;
  const change = (options) => { run(() => app.setZoneDiagramList(partId, cellId, options)); draw(); };

  const btnCss = 'min-height:var(--ui-target,36px);min-width:var(--ui-target,36px);padding:0 10px;border-radius:8px;border:1px solid var(--edge,#b9b4a8);background:var(--btn,#fdfcfa);color:inherit;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);cursor:pointer;display:inline-flex;align-items:center;justify-content:center';
  const row = (name, control, act) => { const r = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px', act ? { 'data-row': act } : {}); const l = el('span', 'flex:1 1 auto;font-size:13px'); l.textContent = name; r.append(l, control); return r; };
  const menu = (act, options, value, onPick, text) => createChoiceMenu({ options, value, label: text, act, follow: true, onPick });

  function draw() {
    const c = cell();
    if (!c) { close(); return; }
    const p = c.props;
    const source = p.diagramListSource ?? 'symbols'; const fromTab = source === 'tab';
    const instrument = p.diagramInstrument ?? 'guitar'; const groups = p.diagramListGroups ?? 'off';
    const head = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px');
    const t = el('div', 'font-weight:var(--w-semi,600);font-size:15px'); t.textContent = label('parts.listSettings.title');
    const x = el('button', btnCss, { type: 'button', 'data-act': 'list-settings-close', 'aria-label': label('chords.close'), title: label('chords.close') }); x.textContent = '✕'; x.addEventListener('click', close);
    head.append(t, x);
    const rows = [];
    rows.push(row(label('parts.listSettings.source'), menu('list-source', [['symbols', label('parts.listSettings.src.symbols')], ['tab', label('parts.listSettings.src.tab')]], source, (v) => change({ source: v }), label('parts.listSettings.source')), 'source'));
    if (!fromTab) rows.push(row(label('diagram.instrument'), menu('list-instrument', ['guitar', 'ukulele', 'bass'].map((i) => [i, label(`diagram.instrument.${i}`)]), instrument, (v) => change({ instrument: v }), label('diagram.instrument')), 'instrument'));
    if (fromTab) {
      const tabs = app.listTabStaves(partId, cellId);
      if (tabs.length > 1) rows.push(row(label('parts.diagramListStaff'), menu('list-staff', tabs.map((s) => [s.id, s.name]), p.diagramListStaff ?? tabs[0].id, (v) => change({ staffId: v }), label('parts.diagramListStaff')), 'staff'));
    }
    rows.push(row(label('parts.listSettings.scope'), menu('list-scope', [['movement', label('parts.listSettings.scope.movement')], ['system', label('parts.listSettings.scope.system')]], p.diagramListScope ?? 'movement', (v) => change({ scope: v }), label('parts.listSettings.scope')), 'scope'));
    rows.push(row(label('parts.listSettings.unique'), menu('list-unique', [['true', label('parts.listSettings.unique.once')], ['false', label('parts.listSettings.unique.all')]], String(p.diagramListUnique !== false), (v) => change({ unique: v === 'true' }), label('parts.listSettings.unique')), 'unique'));
    if (!fromTab) {
      rows.push(row(label('parts.listSettings.variants'), menu('list-variants', ['main', 'played', 'layer'].map((v) => [v, label(`parts.listSettings.variants.${v}`)]), p.diagramListVariants ?? 'main', (v) => change({ variants: v }), label('parts.listSettings.variants')), 'variants'));
      rows.push(row(label('parts.listSettings.groups'), menu('list-groups', ['off', 'sections', 'labels'].map((v) => [v, label(`parts.listSettings.groups.${v}`)]), groups, (v) => change({ groups: v }), label('parts.listSettings.groups')), 'groups'));
    }
    const pools = app.voicingPools();
    rows.push(row(label('parts.listSettings.pool'), menu('list-pool', [['', label('parts.zonePool.part')], ...pools.map((q) => [q.id, q.id === 'main' ? label('chords.main') : q.name])], p.diagramListPool ?? '', (v) => { run(() => app.setZonePool(partId, cellId, v || null)); draw(); }, label('parts.listSettings.pool')), 'pool'));
    // alignment: four icons
    const align = p.diagramListAlign ?? 'left';
    const aligns = el('div', 'display:flex;gap:var(--btn-gap,2px)');
    for (const [id, name] of [['left', 'text-align-start'], ['center', 'text-align-center'], ['right', 'text-align-end'], ['justify', null]]) {
      const b = el('button', btnCss + (align === id ? ';background:var(--btn-on,#e2e0da);border-width:2px' : ''), { type: 'button', 'data-act': `list-align-${id}`, 'aria-pressed': String(align === id), title: label(`parts.diagramAlign.${id}`), 'aria-label': label(`parts.diagramAlign.${id}`), 'data-no-icon': '' });
      const g = name ? icon(name, { size: 18 }) : justifyIcon();
      if (g) b.append(g); else b.textContent = label(`parts.diagramAlign.short.${id}`);
      b.addEventListener('click', () => change({ align: id }));
      aligns.append(b);
    }
    rows.push(row(label('parts.listSettings.align'), aligns, 'align'));
    // the size of the name written over a group
    if (!fromTab && groups !== 'off') {
      const size = p.diagramListLabelSize ?? 1;
      const stepper = el('div', 'display:flex;align-items:center;gap:4px');
      const val = el('span', 'min-width:3em;text-align:center', { 'data-label-size': String(size) }); val.textContent = `${Math.round(size * 100)} %`;
      const set = (next) => change({ labelSize: Math.round(Math.min(LABEL_SIZES.max, Math.max(LABEL_SIZES.min, next)) * 20) / 20 });
      const less = el('button', btnCss, { type: 'button', 'data-act': 'list-label-size-less', 'aria-label': label('parts.listSettings.labelSizeLess') }); less.textContent = '−'; less.addEventListener('click', () => set(size - LABEL_SIZES.step));
      const more = el('button', btnCss, { type: 'button', 'data-act': 'list-label-size-more', 'aria-label': label('parts.listSettings.labelSizeMore') }); more.textContent = '+'; more.addEventListener('click', () => set(size + LABEL_SIZES.step));
      stepper.append(less, val, more);
      rows.push(row(label('parts.listSettings.labelSize'), stepper, 'label-size'));
    }
    const foot = el('div', 'display:flex;justify-content:flex-end');
    const chords = el('button', btnCss, { type: 'button', 'data-act': 'list-settings-chords' }); chords.textContent = label('chords.open');
    chords.addEventListener('click', () => openChords({ pool: p.diagramListPool || app.doc.work.parts.find((q) => q.id === partId)?.props.partVoicingPool || 'main', instrument }));
    foot.append(chords);
    box.replaceChildren(head, ...rows, foot);
  }
  draw();
  return { close, refresh: draw };
}
