/*
 * Editor of the placement of chord symbols against their root letter (Settings › Chords). A window (a sheet from the bottom on phones and tablets) with
 * every root — naturals, sharps, flats — drawn by the REAL chord painter with a few qualities side by side, so the letters can be compared and adjusted:
 * a shift (x, y, in em of the root) per letter and per accidental, the gap between the ink of the letter and what follows, and the automatic placement itself.
 * What is edited is chosen at the top: THIS PROJECT (the style of its movements, saved in the file) or MY DEFAULT (the preferences of this device).
 * Nothing here writes outside `chordplacement-intents.js`; every change is one undoable transaction (project) or one preference write (user).
 */
import { SID, resolveStyle, FIRST_SIGNS } from '../model/index.js';
import { chordSymbolPreviewSvg } from './chordquality-preview.js';
import { PLACEMENT_FIELDS, placementField, setPlacement, resetPlacement, copyPlacement, projectValues, userValues, previewLayer, effectiveValue, schemeDefaults, extendPlacement, rootKeyOf, exportPlacement, importPlacement } from './chordplacement-intents.js';
import { downloadText, pickTextFile } from './file-io.js';
import { SHEET_QUERY } from './panel-mode.js';
import { createChoiceMenu } from './choice-menu.js';
import { dismissOnOutside } from './outside-dismiss.js';

const STYLE_ID = 'chord-placement-style';
const CSS = `
[data-chord-placement] { position: fixed; z-index: 2500; background: var(--paper, var(--paper,#faf8f4)); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 4px 18px rgba(0,0,0,.35); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; display: flex; flex-direction: column; }
[data-chord-placement][data-mode="window"] { left: 12px; top: 20px; width: min(1800px, calc(100vw - 24px)); height: calc(100vh - 40px); min-width: 520px; min-height: 360px; max-width: calc(100vw - 8px); max-height: calc(100vh - 8px); border-radius: 10px; resize: both; overflow: hidden; }
[data-chord-placement][data-mode="sheet"] { left: 0; right: 0; bottom: 0; max-height: 88vh; border-radius: 12px 12px 0 0; }
[data-chord-placement] .cp-head { display: flex; align-items: center; justify-content: space-between; gap: var(--btn-gap, 2px); padding: 8px 12px; border-bottom: 1px solid var(--edge,#ccc); flex: 0 0 auto; }
[data-chord-placement] .cp-body { flex: 1 1 auto; min-height: 0; display: flex; gap: 12px; padding: 8px 12px 12px; overflow: auto; }
[data-chord-placement][data-mode="window"] .cp-body { overflow: hidden; }
[data-chord-placement] .cp-controls { flex: 0 0 420px; max-width: 100%; overflow: auto; padding-right: 6px; }
[data-chord-placement] .cp-display { flex: 1 1 0; min-width: 0; overflow: auto; }
[data-chord-placement][data-mode="sheet"] .cp-body { flex-direction: column; }
[data-chord-placement][data-mode="sheet"] .cp-controls { flex: 0 0 auto; overflow: visible; }
[data-chord-placement] .cp-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap, 2px); margin: 4px 0; }
[data-chord-placement] .cp-row > label { flex: 0 0 9.5em; }
[data-chord-placement] .cp-hint { color: var(--ink-soft,#555); font-size: 12px; margin: 6px 0 2px; }
[data-chord-placement] h4 { margin: 10px 0 2px; font-size: 13px; }
[data-chord-placement] button { min-height: var(--ui-target, 30px); min-width: var(--ui-target, 30px); font: inherit; padding: 0 10px; box-sizing: border-box; }
[data-chord-placement] button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
[data-chord-placement] .cp-val { display: inline-block; min-width: 4.2em; text-align: center; font-variant-numeric: tabular-nums; }
[data-chord-placement] .cp-own { color: var(--info-ink,#1a5fd0); }
[data-chord-placement] .cp-strip { display: flex; flex-wrap: wrap; gap: 6px; border: 1px solid var(--edge,#ccc); background: var(--field,#fff); border-radius: 6px; padding: 4px 6px; }
[data-chord-placement] .cp-tile { display: inline-flex; flex-direction: column; align-items: center; min-height: 0; padding: 2px 4px; line-height: 0; background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer; }
[data-chord-placement] .cp-tile small { font: 11px var(--ui-font,sans-serif); line-height: 1.3; color: var(--ink-soft,#444); }
[data-chord-placement] .cp-tile[aria-pressed="true"] { background: var(--warn-soft,#fff3d6); border-color: #e0b85c; }
[data-chord-placement] .cp-grid { display: grid; gap: 2px; align-items: center; margin-top: 6px; width: max-content; }
[data-chord-placement] .cp-colhead { font-size: 12px; padding: 0 4px; }
[data-chord-placement] .cp-root { text-align: left; }
[data-chord-placement] .cp-cell { pointer-events: none; line-height: 0; }
[data-chord-placement] .cp-sel { background: var(--warn-soft,#fff3d6); }
`;
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); }
  n.append(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  return n;
};
const ROOTS = [
  { group: 'natural', list: ['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((step) => ({ step, alter: 0 })) },
  { group: 'sharp', list: ['C', 'D', 'F', 'G', 'A'].map((step) => ({ step, alter: 1 })) },
  { group: 'flat', list: ['D', 'E', 'G', 'A', 'B'].map((step) => ({ step, alter: -1 })) },
];
/** A quality that begins with each first sign, to show it. */
const SIGN_SAMPLE = { MINOR: 'm7', DELTA: 'M7', HALFDIM: 'm7b5', DIM: 'o7', AUG: 'aug', 5: '5', 6: '6', 7: '7', 9: '9', 1: '11', s: 'sus4', a: 'add9', M: 'M9' };
const BASS_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const ZOOM_KEY = 'scorsaire.chordPlacementZoom';
const MODE_KEY = 'scorsaire.chordPlacementPreview';
const readZoom = () => { try { const n = Number(localStorage.getItem(ZOOM_KEY)); return n >= 8 && n <= 40 ? n : 14; } catch { return 14; } };
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'tight' ? 'tight' : 'comfort'; } catch { return 'comfort'; } };
const rootName = (r) => `${r.step}${r.alter > 0 ? '♯' : r.alter < 0 ? '♭' : ''}`;

export function mountChordPlacementEditor(app, { glyphs, label = (k) => k } = {}) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let message = ''; let box = null; let scope = 'project'; let sel = { step: 'F', alter: 0 }; let sign = 'MINOR'; let bassSel = 'E'; let zoom = readZoom(); let mode = readMode();
  let stopDismiss = null; let off = null;
  const cache = new Map();
  const media = window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  const defaults = schemeDefaults();
  const layerFor = () => previewLayer(app, scope);
  // "comfort": the chord keeps its real width in its slot; "tight": it is compressed into a narrow slot (as on a crowded measure)
  const styleFn = () => { const layer = layerFor(); return (sid) => (sid === SID.CHORD_FIT ? mode === 'tight' : resolveStyle(sid, [layer])); };
  const slotSp = () => (mode === 'tight' ? 6 : 9);
  const sigOf = (root) => {
    const style = styleFn();
    const rk = rootKeyOf(root);
    const keys = [SID.CHORD_AUTO_PLACE, SID.CHORD_INK_GAP, SID.CHORD_FONT_FAMILY, SID.CHORD_FONT_WEIGHT, SID.CHORD_LETTER_SPACING, SID.CHORD_BASS_SLASH_GAP, SID.CHORD_BASS_ACCID_GAP,
      SID[`CHORD_QUAL_DX_${root.step}`], SID[`CHORD_QUAL_DY_${root.step}`], SID[`CHORD_BASS_ROOT_DX_${rk}`], SID[`CHORD_BASS_ROOT_DY_${rk}`],
      ...FIRST_SIGNS.flatMap((k) => [SID[`CHORD_QUAL_PAIR_DX_${rk}_${k}`], SID[`CHORD_QUAL_PAIR_DY_${rk}_${k}`]]),
      ...BASS_LETTERS.flatMap((b) => [SID[`CHORD_BASS_PAIR_DX_${rk}_${b}`], SID[`CHORD_BASS_PAIR_DY_${rk}_${b}`]])];
    if (root.alter) { const k = root.alter > 0 ? 's' : 'f'; keys.push(SID[`CHORD_ACCID_PAIR_DX_${root.step}_${k}`], SID[`CHORD_ACCID_PAIR_DY_${root.step}_${k}`], SID.CHORD_SHARP_SCALE, SID.CHORD_FLAT_SCALE); }
    return keys.map((k) => style(k)).join('|');
  };
  const cellSvg = (root, q, space = zoom) => {
    const key = `${rootName(root)}|${q.q}|${q.bass?.step ?? ''}|${space}|${mode}|${sigOf(root)}`;
    if (!cache.has(key)) { if (cache.size > 600) cache.clear(); cache.set(key, chordSymbolPreviewSvg(glyphs, { root, quality: q.q, bass: q.bass ?? null, staffSpace: space, widthSp: slotSp(), getStyle: styleFn(), cropLeft: true, bare: true })); }
    return cache.get(key);
  };
  const svgNode = (root, q, space) => { const d = document.createElement('div'); d.innerHTML = cellSvg(root, q, space); return d; };

  const num = (v) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  /** The menu that copies the value of a pair key to others: the same root (every sign / bass), the same sign / bass (every root), or all. */
  const extendMenu = (key) => {
    const bass = key.startsWith('bp:'); const block = /^r[A-G][sf]?[XY]$/.test(key); const accid = key.startsWith('ac:');
    const options = accid ? [['item', label('chordPlacement.extendAccidLetters')], ['all', label('chordPlacement.extendAccidBoth')]]
      : block ? [['kind', label('chordPlacement.extendBlockKind')], ['all', label('chordPlacement.extendAllRoots')]]
      : [['row', label(bass ? 'chordPlacement.extendRowBass' : 'chordPlacement.extendRowSign')], ['item', label(bass ? 'chordPlacement.extendItemBass' : 'chordPlacement.extendItemSign')],
        ['kind', label('chordPlacement.extendKind')], ['all', label('chordPlacement.extendAll')]];
    return createChoiceMenu({ options, label: label('chordPlacement.extend'), act: `cp-extend-${key}`, onPick: (how) => { const n = extendPlacement(app, scope, key, how); message = label('chordPlacement.extended', { n }); draw(); } });
  };
  const stepper = (key, text) => {
    const f = placementField(key); const cur = effectiveValue(app, scope, f, defaults);
    const set = (v) => { setPlacement(app, scope, { [key]: v }); draw(); };
    return el('div', { class: 'cp-row' }, el('label', {}, text),
      el('button', { type: 'button', class: 'stp-b', 'data-act': `cp-${key}-less`, 'aria-label': '−', onclick: () => set(cur.value - f.step) }, '−'),
      el('span', { class: `cp-val stp-val${cur.own ? ' cp-own' : ''}`, 'data-value': key }, num(cur.value)),
      el('button', { type: 'button', class: 'stp-b', 'data-act': `cp-${key}-more`, 'aria-label': '+', onclick: () => set(cur.value + f.step) }, '+'),
      cur.own ? el('button', { type: 'button', 'data-act': `cp-${key}-reset`, title: label('chordPlacement.resetOne'), 'aria-label': label('chordPlacement.resetOne'), onclick: () => set(null) }, '↺') : null,
      /^(q|bp|ac):/.test(key) || /^r[A-G][sf]?[XY]$/.test(key) ? extendMenu(key) : null);
  };
  const setZoom = (v) => { zoom = Math.max(8, Math.min(40, v)); try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* kept for this page only */ } draw(); };
  const setMode = (m) => { mode = m; try { localStorage.setItem(MODE_KEY, m); } catch { /* kept for this page only */ } draw(); };

  function draw() {
    if (!box) return;
    const f = placementField('auto'); const auto = effectiveValue(app, scope, f, defaults);
    const accKey = sel.alter > 0 ? 'SHARP' : sel.alter < 0 ? 'FLAT' : null;
    const accKind = sel.alter > 0 ? 's' : 'f';
    const rkey = rootKeyOf(sel);
    const rn = rootName(sel);
    const btn = (act, text, pressed, on, extra = {}) => el('button', { type: 'button', 'data-act': act, 'aria-pressed': pressed === null ? null : String(pressed), onclick: on, ...extra }, text);
    const keepScroll = (fn) => { const c = box.querySelector('.cp-controls'); const d = box.querySelector('.cp-display'); const sc = [c?.scrollTop ?? 0, d?.scrollTop ?? 0, d?.scrollLeft ?? 0]; fn(); const c2 = box.querySelector('.cp-controls'); const d2 = box.querySelector('.cp-display'); if (c2) c2.scrollTop = sc[0]; if (d2) { d2.scrollTop = sc[1]; d2.scrollLeft = sc[2]; } };

    // ----- the display: the strips of the chosen root, then every root against the signs -----
    const big = Math.round(zoom * 1.6);
    const signStrip = el('div', { class: 'cp-strip', 'data-cp-signs-strip': '' }, FIRST_SIGNS.map((k) => el('button', { type: 'button', class: 'cp-tile', 'data-act': 'cp-sign', 'data-sign': k, 'aria-pressed': String(sign === k), onclick: () => { sign = k; draw(); } },
      svgNode(sel, { q: SIGN_SAMPLE[k] }, big), el('small', {}, label(`chordPlacement.sign.${k}`)))));
    const bassStrip = el('div', { class: 'cp-strip', 'data-cp-bass-strip': '' }, BASS_LETTERS.map((L) => el('button', { type: 'button', class: 'cp-tile', 'data-act': 'cp-bass', 'data-bass': L, 'aria-pressed': String(bassSel === L), onclick: () => { bassSel = L; draw(); } },
      svgNode(sel, { q: '', bass: { step: L, alter: 0 } }, big), el('small', {}, `/${L}`))));
    const grid = el('div', { class: 'cp-grid', 'data-cp-grid': '', style: `grid-template-columns: 4.2em repeat(${FIRST_SIGNS.length + 1}, max-content)` });
    grid.append(el('span', {}), ...FIRST_SIGNS.map((k) => el('button', { type: 'button', class: 'cp-colhead', 'data-act': 'cp-sign-col', 'data-sign': k, 'aria-pressed': String(sign === k), onclick: () => { sign = k; draw(); } }, label(`chordPlacement.sign.${k}`))),
      el('button', { type: 'button', class: 'cp-colhead', 'data-act': 'cp-bass-col', 'aria-pressed': 'false', onclick: () => {} }, `/${bassSel}`));
    for (const g of ROOTS) {
      grid.append(el('h4', { style: 'grid-column: 1 / -1' }, label(`chordPlacement.group.${g.group}`)));
      for (const r of g.list) {
        const on = r.step === sel.step && r.alter === sel.alter;
        grid.append(btn('cp-root', rootName(r), on, () => { sel = r; draw(); }, { class: `cp-root${on ? ' cp-sel' : ''}`, 'data-root': rootName(r) }));
        for (const k of FIRST_SIGNS) grid.append(el('div', { class: `cp-cell${on ? ' cp-sel' : ''}` }, svgNode(r, { q: SIGN_SAMPLE[k] })));
        grid.append(el('div', { class: `cp-cell${on ? ' cp-sel' : ''}` }, svgNode(r, { q: '', bass: { step: bassSel, alter: 0 } })));
      }
    }
    const display = el('div', { class: 'cp-display' },
      el('h4', {}, label('chordPlacement.stripSigns', { root: rn })), signStrip,
      el('h4', {}, label('chordPlacement.stripBass', { root: rn })), bassStrip,
      el('h4', {}, label('chordPlacement.gridTitle')), grid);

    // ----- the controls -----
    const controls = el('div', { class: 'cp-controls' },
      el('div', { class: 'cp-row' }, btn('cp-scope-project', label('chordPlacement.project'), scope === 'project', () => { scope = 'project'; draw(); }), btn('cp-scope-user', label('chordPlacement.user'), scope === 'user', () => { scope = 'user'; draw(); })),
      el('div', { class: 'cp-hint' }, label(scope === 'project' ? 'chordPlacement.projectHint' : 'chordPlacement.userHint')),
      el('div', { class: 'cp-row' }, el('label', {}, label('chordPlacement.auto')),
        btn('cp-auto', auto.value ? label('settings.on') : label('settings.off'), auto.value === true, () => { setPlacement(app, scope, { auto: !auto.value }); draw(); })),
      stepper('gap', label('chordPlacement.gap')),
      el('div', { class: 'cp-row' }, el('label', {}, label('chordPlacement.preview')),
        btn('cp-mode-comfort', label('chordPlacement.comfort'), mode === 'comfort', () => setMode('comfort')), btn('cp-mode-tight', label('chordPlacement.tight'), mode === 'tight', () => setMode('tight'))),
      el('div', { class: 'cp-row' }, el('label', {}, label('chordPlacement.zoom')),
        btn('cp-zoom-less', '−', null, () => setZoom(zoom - 2), { 'aria-label': '−' }), el('span', { class: 'cp-val', 'data-value': 'zoom' }, String(zoom)), btn('cp-zoom-more', '+', null, () => setZoom(zoom + 2), { 'aria-label': '+' })),
      el('h4', {}, label('chordPlacement.qualityTitle', { root: rn, sign: label(`chordPlacement.sign.${sign}`) })),
      stepper(`q:${rkey}:${sign}:X`, label('chordPlacement.pairX')), stepper(`q:${rkey}:${sign}:Y`, label('chordPlacement.pairY')),
      accKey ? [el('h4', {}, label('chordPlacement.accidentalTitle', { root: rn })), stepper(`ac:${sel.step}:${accKind}:X`, label('chordPlacement.accidX')), stepper(`ac:${sel.step}:${accKind}:Y`, label('chordPlacement.accidY'))] : null,
      el('h4', {}, label('chordPlacement.accidSizeTitle')), stepper('sharpScale', label('chordPlacement.sharpScale')), stepper('flatScale', label('chordPlacement.flatScale')),
      el('h4', {}, label('chordPlacement.bassTitle', { root: rn, bass: bassSel })),
      stepper(`bp:${rkey}:${bassSel}:X`, label('chordPlacement.bassPairX')), stepper(`bp:${rkey}:${bassSel}:Y`, label('chordPlacement.bassPairY')),
      el('h4', {}, label('chordPlacement.bassBlockTitle', { letter: rn })),
      stepper(`r${rkey}X`, label('chordPlacement.bassRootX')), stepper(`r${rkey}Y`, label('chordPlacement.bassRootY')),
      el('h4', {}, label('chordPlacement.commonTitle')),
      stepper('slash', label('chordPlacement.slash')), stepper('bassAccid', label('chordPlacement.bassAccid')),
      el('div', { class: 'cp-row' },
        btn('cp-reset', label('chordPlacement.reset'), null, () => { resetPlacement(app, scope); draw(); }),
        btn('cp-export', label('chordPlacement.export'), null, () => exportFile(app), { title: label('chordPlacement.exportHint') }),
        btn('cp-import', label('chordPlacement.import'), null, async () => { message = await importFile(app, scope, label); draw(); }),
        scope === 'project'
          ? btn('cp-from-user', label('chordPlacement.fromUser'), null, () => { copyPlacement(app, 'user', 'project'); draw(); })
          : btn('cp-from-project', label('chordPlacement.fromProject'), null, () => { copyPlacement(app, 'project', 'user'); draw(); })),
      el('div', { class: 'cp-hint', 'data-cp-message': '', role: 'status' }, message));

    const head = el('div', { class: 'cp-head' }, el('strong', {}, label('chordPlacement.title')), el('button', { type: 'button', 'data-act': 'cp-close', 'aria-label': 'close', onclick: () => api.close() }, '✕'));
    keepScroll(() => { box.replaceChildren(head, el('div', { class: 'cp-body' }, controls, display)); });
    box.dataset.mode = media?.matches ? 'sheet' : 'window';
  }

  const api = {
    open() {
      if (box) return;
      box = el('div', { 'data-chord-placement': '', 'data-resizable': 'chordPlacement', 'data-zoom-lock': '', role: 'dialog', 'aria-label': label('chordPlacement.title') });
      document.body.append(box);
      draw();
      off = app.doc.subscribe?.(() => draw());
      stopDismiss = dismissOnOutside(() => box, () => api.close());
      window.addEventListener('keydown', onKey, true);
    },
    close() { stopDismiss?.(); stopDismiss = null; off?.(); off = null; window.removeEventListener('keydown', onKey, true); box?.remove(); box = null; },
    isOpen: () => Boolean(box),
    destroy() { api.close(); },
  };
  const onKey = (e) => { if (e.key === 'Escape' && box) { e.stopPropagation(); api.close(); } };
  return api;
}

/** Downloads the values in force as an exchange file. */
export function exportFile(app) { downloadText('scorsaire-chord-placement.json', exportPlacement(app)); }
/** Asks for an exchange file and loads it into a scope; returns the message to show. */
export async function importFile(app, scope, label = (k) => k) {
  let file;
  try { file = await pickTextFile(); } catch (e) { return String(e?.message ?? e); }
  if (!file) return '';
  try { const n = importPlacement(app, scope, file.text); return label('chordPlacement.imported', { n }); } catch (e) { return String(e?.message ?? e); }
}
