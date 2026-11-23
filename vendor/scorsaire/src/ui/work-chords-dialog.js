/*
 * The "Chords of the piece" window (Work tab): every distinct chord of the piece with the fingering a LAYER shows for it. The main pool is what "Use everywhere" writes in the
 * diagram editor; the other layers (an easier set, power chords…) only hold what they change and fall back to the main pool, then to the suggestions. For each chord: step through
 * the fingerings of the library (the user's repertoire first, then the computed suggestions), draw one by hand (a fret per string), or forget the layer's choice. A layer can also carry
 * a RULE (power chords) that applies to every chord it has no fingering of its own for. Every change is one undoable transaction (`Application`).
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { diagramSvg, DIAGRAM_MARGIN } from './diagram-editor.js';
import { tapCell, tapMarker, editorWindow, shiftWindow } from './diagram-intents.js';
import { confirmDialog } from './confirm-dialog.js';
import { sameVoicing, INSTRUMENT_PRESETS } from '../model/fretvoicing.js';
import glyphs from '../glyphs/bravura-subset.json' with { type: 'json' };

const INSTRUMENTS = ['guitar', 'ukulele', 'bass'];
const THUMB_SS = 20; // size of the diagrams of the cards (staff spaces in pixels)
const EDIT_SS = 26; // and of the diagram being edited

export function openWorkChordsDialog({ app, label, onDone = null, pool = 'main', instrument = 'guitar' }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const state = { pool: pool ?? 'main', instrument, drawing: null, message: '', from: null, naming: new Map() }; // `from`: the panel that makes a layer from the tablature / the diagrams of a chord staff
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-work-chords': '', 'data-zoom-lock': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(900px,96vw);max-height:${sheet ? '86vh' : '90vh'};overflow:auto;border-radius:${sheet ? '14px 14px 0 0' : '12px'};display:flex;flex-direction:column;gap:10px`, { role: 'dialog', 'aria-label': label('chords.title') });
  if (!sheet) box.setAttribute('data-resizable', 'workchords');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); onDone?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (state.drawing) { state.drawing = null; draw(); } else close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(veil);

  const btnCss = 'min-height:var(--ui-target,30px);min-width:var(--ui-target,30px);padding:0 10px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);border:1px solid var(--edge,#b9b4a8);background:var(--field,#fff);color:inherit;cursor:pointer';
  const mk = (text, act, fn, { on = false, disabled = false, title = '' } = {}) => {
    const b = el('button', btnCss + (on ? ';background:var(--btn-on,#e2e0da);border-width:2px' : '') + (disabled ? ';opacity:.45;cursor:default' : ''), { type: 'button', 'data-act': act });
    b.textContent = text; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.disabled = disabled; if (on) b.setAttribute('aria-pressed', 'true'); b.addEventListener('click', fn); return b;
  };
  const row = (css = '') => el('div', `display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center;${css}`);
  const attempt = (fn) => { try { fn(); state.message = ''; } catch (e) { state.message = e?.message ?? String(e); } draw(); };

  const poolName = (p) => (p.id === 'main' ? label('chords.main') : p.name);
  const fromText = (from) => label(`chords.from.${from}`);

  function thumb(voicing, ss = THUMB_SS) {
    const wrap = el('div', 'flex:none;min-height:150px;display:flex;align-items:center;justify-content:center');
    if (voicing) { const d = diagramSvg(glyphs, voicing, { scale: 1.8, ss, gauge: false }); wrap.innerHTML = d.svg; wrap.style.width = `${d.width}px`; wrap.style.height = `${d.height}px`; }
    else wrap.textContent = '—';
    return wrap;
  }

  /**
   * Hand editing of a fingering, ON the diagram: a tap on a fret puts a dot there (a tap on the dot lifts it), a tap above a string flips × (muted) / ○ (open)
   * — nothing happens above a string that has a dot. The arrows move the window of frets.
   */
  function drawingEditor(entry) {
    const d = state.drawing;
    const frets = d.frets;
    const preset = INSTRUMENT_PRESETS[state.instrument];
    const win = editorWindow(frets, d.first);
    d.first = win.first;
    const box2 = el('div', 'grid-column:1 / -1;border:1px solid var(--edge,#b9b4a8);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:8px;background:var(--field,#fff);align-items:center', { 'data-drawing': '' });
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555);text-align:center'); hint.textContent = label('chords.drawHint');
    const shown = diagramSvg(glyphs, { instrument: state.instrument, frets: [...frets] }, { scale: 1.7, ss: EDIT_SS, frame: win });
    const wrap = el('div', `position:relative;flex:none;width:${shown.width}px;height:${shown.height}px`, { 'data-drawing-diagram': '' });
    wrap.innerHTML = shown.svg;
    const g = shown.geometry;
    const px = (x) => DIAGRAM_MARGIN + (x + 0.2) * shown.ss; // 0.2 = the padding diagramSvg puts around the box
    const py = (y) => (shown.h - (y + 0.2)) * shown.ss;
    const zone = (x, y, w, h, act, fn, title) => {
      const z = el('button', `position:absolute;left:${px(x)}px;top:${py(y + h)}px;width:${w * shown.ss}px;height:${h * shown.ss}px;background:transparent;background-image:none;box-shadow:none;border:0;border-radius:0;padding:0;min-width:0;min-height:0;appearance:none;cursor:pointer`, { type: 'button', 'data-drawing-cell': act, 'aria-label': title });
      z.addEventListener('click', fn);
      wrap.append(z);
    };
    g.stringX.forEach((sx, i) => {
      zone(sx - g.stringGap / 2, g.nutY, g.stringGap, g.markerZone, `m:${i}`, () => { if (frets[i] > 0) return; d.frets = tapMarker(frets, i); draw(); }, label('diagram.marker'));
      for (let r = 0; r < g.rows; r++) {
        const fret = win.first + r;
        zone(sx - g.stringGap / 2, g.nutY - (r + 1) * g.rowGap, g.stringGap, g.rowGap, `${i}:${fret}`, () => { d.frets = tapCell(frets, i, fret); draw(); }, `${label('diagram.fret')} ${fret}`);
      }
    });
    const max = preset?.maxFret ?? 24;
    const stepper = el('div', 'display:flex;flex-direction:column;gap:var(--btn-gap,2px);align-items:center');
    const pos = el('output', 'font-variant-numeric:tabular-nums', { 'data-drawing-first': '' }); pos.textContent = String(win.first);
    const posLabel = el('span', 'font-size:12px'); posLabel.textContent = label('diagram.position');
    stepper.append(posLabel,
      mk('▲', 'fret-window-up', () => { d.first = shiftWindow(win, -1, max).first; draw(); }, { title: label('diagram.up') }), pos,
      mk('▼', 'fret-window-down', () => { d.first = shiftWindow(win, 1, max).first; draw(); }, { title: label('diagram.down') }));
    const main = el('div', 'display:flex;gap:16px;align-items:flex-start;justify-content:center;flex-wrap:wrap');
    main.append(wrap, stepper);
    const actions = row('justify-content:center');
    actions.append(mk(label('chords.drawOk'), 'draw-ok', () => attempt(() => { app.setPoolVoicing(state.pool, entry.chord, { instrument: state.instrument, frets: [...d.frets] }); state.drawing = null; }), { on: true }), mk(label('chords.drawCancel'), 'draw-cancel', () => { state.drawing = null; draw(); }));
    box2.append(hint, main, actions);
    return box2;
  }


  const ROOTS = [['C', 0, 'C'], ['C', 1, 'C♯'], ['D', -1, 'D♭'], ['D', 0, 'D'], ['D', 1, 'D♯'], ['E', -1, 'E♭'], ['E', 0, 'E'], ['F', 0, 'F'], ['F', 1, 'F♯'], ['G', -1, 'G♭'], ['G', 0, 'G'], ['G', 1, 'G♯'], ['A', -1, 'A♭'], ['A', 0, 'A'], ['A', 1, 'A♯'], ['B', -1, 'B♭'], ['B', 0, 'B']];
  const fingeringId = (v) => v.frets.join(',');

  /** A fingering of the tablature that has no chord name yet: the root and the quality are chosen (a proposal is filled in), then it joins the layer under that chord. */
  function namingCard(layer, u) {
    const id = fingeringId(u.voicing);
    if (!state.naming.has(id)) {
      const guess = app.suggestChordName(u.voicing);
      state.naming.set(id, { root: guess ? `${guess.root.step}${guess.root.alter}` : 'C0', quality: guess?.quality ?? '', bass: guess?.bass ?? null, guessed: !!guess });
    }
    const pick = state.naming.get(id);
    const c = el('div', 'border:1px dashed var(--edge,#b9b4a8);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px;background:var(--field,#fff)', { 'data-unnamed': id });
    const head = row('justify-content:space-between');
    const hint = el('span', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = pick.guessed ? label('chords.name.proposed') : label('chords.name.none');
    const count = el('span', 'font-size:12px;color:var(--ink-soft,#555)'); count.textContent = `×${u.count}`;
    head.append(hint, count);
    const select = (act, options, value, onChange) => { const sel = el('select', 'min-height:var(--ui-target,30px);font:inherit;max-width:48%', { 'data-act': act }); for (const [v, text] of options) { const o = el('option'); o.value = v; o.textContent = text; sel.append(o); } sel.value = value; sel.addEventListener('change', () => onChange(sel.value)); return sel; };
    const choices = app.nameChoices();
    const names = row('gap:4px;flex-wrap:wrap');
    // the bass note by hand (a slash chord): '' = the root itself; the guess made from the lowest sounding string is the starting value
    const bassKey = () => (pick.bass ? `${pick.bass.step}${pick.bass.alter}` : '');
    const bassSel = select('unnamed-bass', [['', label('chords.name.bassRoot')], ...ROOTS.map(([st, al, text]) => [`${st}${al}`, `${label('chords.name.bassOn')} ${text}`])], bassKey(), (v) => { const m = /^([A-G])(-?\d)$/.exec(v); pick.bass = m && v !== pick.root ? { step: m[1], alter: Number(m[2]) } : null; bassSel.value = bassKey(); });
    bassSel.title = label('chords.name.bassHint'); bassSel.setAttribute('aria-label', label('chords.name.bassHint'));
    names.append(
      select('unnamed-root', ROOTS.map(([st, al, text]) => [`${st}${al}`, text]), pick.root, (v) => { if (v !== pick.root) pick.bass = null; pick.root = v; bassSel.value = bassKey(); }),
      select('unnamed-quality', choices.qualities.map((q) => [q.id, q.id === '' ? label('chords.name.major') : q.text]), pick.quality, (v) => { pick.quality = v; }),
      bassSel);
    const actions = row('gap:4px;justify-content:center');
    actions.append(mk(label('chords.name.ok'), 'unnamed-ok', () => attempt(() => {
      const [, step, alter] = /^([A-G])(-?\d)$/.exec(pick.root);
      app.nameUnnamedVoicing(layer.id, id, { root: { step, alter: Number(alter) }, quality: pick.quality, bass: pick.bass ?? null });
      state.naming.delete(id);
    }), { title: label('chords.name.okHint') }), mk(label('chords.name.discard'), 'unnamed-discard', () => attempt(() => { app.discardUnnamedVoicing(layer.id, id); state.naming.delete(id); }), { title: label('chords.name.discardHint') }));
    c.append(head, thumb(u.voicing), names, actions);
    return c;
  }

  /** The labels of ONE fingering of a chord in the layer (Verse, Chorus…): chips to remove, and a field to add one (the labels already in use are offered). */
  function labelEditor(entry, vid) {
    const layer = app.voicingPools().find((p) => p.id === state.pool);
    const mine = entry.tags?.[vid] ?? [];
    const box4 = el('div', 'display:flex;flex-wrap:wrap;gap:3px;align-items:center', { 'data-labels': vid });
    for (const l of mine) box4.append(mk(`${l} ✕`, 'label-remove', () => attempt(() => app.setVariantLabels(state.pool, entry.id, vid, mine.filter((x) => x !== l))), { title: label('chords.labelRemove') }));
    const listId = `labels-${state.pool}`;
    const input = el('input', 'min-height:calc(var(--ui-target,30px) - 6px);box-sizing:border-box;padding:0 6px;border:1px solid var(--field-edge,#767676);border-radius:6px;background:var(--field,#fff);color:inherit;font:inherit;width:8.5em', { type: 'text', maxlength: '30', list: listId, placeholder: label('chords.labelAdd'), 'aria-label': label('chords.labelAdd'), 'data-act': 'label-add' });
    const dl = el('datalist', '', { id: listId }); for (const l of layer?.labelOrder ?? []) { const o = el('option'); o.value = l; dl.append(o); }
    const add = () => { const t = input.value.trim(); if (!t) return; attempt(() => app.setVariantLabels(state.pool, entry.id, vid, [...mine, t])); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); add(); } });
    input.addEventListener('change', add);
    box4.append(input, dl);
    return box4;
  }

  function card(entry, variants, layerIsMain, readOnly = false) {
    const c = el('div', 'border:1px solid var(--edge,#b9b4a8);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px;background:var(--field,#fff)', { 'data-chord': entry.id });
    const head = row('justify-content:space-between');
    const name = el('span', 'font:var(--w-bold,700) 16px var(--ui-font,sans-serif)'); name.textContent = entry.name;
    const count = el('span', 'font-size:12px;color:var(--ink-soft,#555)'); count.textContent = entry.count ? `×${entry.count}` : label('chords.notInPiece');
    head.append(name, count);
    const badge = el('div', `font-size:12px;${entry.from === 'pool' ? 'font-weight:var(--w-semi,600);color:var(--ink,#111)' : 'color:var(--ink-soft,#555)'}`); badge.textContent = layerIsMain && entry.from === 'pool' ? label('chords.from.mainSet') : fromText(entry.from);
    // the other fingerings found for this chord when the layer was made from a tablature come first, then the library and the suggestions
    if (entry.alternatives?.length) { const mine = [...(entry.from === 'pool' && entry.voicing ? [entry.voicing] : []), ...entry.alternatives]; variants = [...mine, ...variants].filter((v, i, all) => all.findIndex((w) => sameVoicing(v, w)) === i); }
    const at = entry.voicing ? variants.findIndex((v) => sameVoicing(v, entry.voicing)) : -1;
    const step = (d) => { if (!variants.length) return; const next = variants[(at < 0 ? (d > 0 ? 0 : variants.length - 1) : (at + d + variants.length) % variants.length)]; attempt(() => app.setPoolVoicing(state.pool, entry.chord, next)); };
    const controls = row('justify-content:center');
    controls.append(
      mk('◀', 'variant-prev', () => step(-1), { disabled: variants.length < 2, title: label('chords.prev') }),
      mk('▶', 'variant-next', () => step(1), { disabled: variants.length < 2, title: label('chords.next') }),
      mk('✎', 'variant-draw', () => { state.drawing = { id: entry.id, frets: entry.voicing?.frets ? [...entry.voicing.frets] : Array(INSTRUMENT_PRESETS[state.instrument].tuning.length).fill(-1) }; draw(); }, { title: label('chords.draw') }),
      mk('↺', 'variant-forget', () => attempt(() => app.clearPoolVoicing(state.pool, entry.chord, state.instrument)), { disabled: entry.from !== 'pool', title: label(layerIsMain ? 'chords.forgetMain' : 'chords.forget') }));
    if (entry.alternatives?.length) badge.textContent += ` · ${label('chords.alternatives', { n: entry.alternatives.length })}`;
    c.append(head, thumb(entry.voicing), badge, ...(readOnly ? [] : [controls]));
    if (!readOnly && !layerIsMain && entry.from === 'pool' && entry.voicing) c.append(labelEditor(entry, entry.voicing.frets ? entry.voicing.frets.join(',') : `p${(entry.voicing.notes ?? []).join(',')}`)); // the labels of the layer's main fingering of this chord
    // the other fingerings of this chord in the layer: switch each on / off (the diagram lists show the ones that are on), or make one the main fingering
    if (!readOnly && !layerIsMain && entry.alternatives?.length) {
      const box3 = el('div', 'display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--edge,#b9b4a8);padding-top:4px', { 'data-variants': entry.id });
      const t3 = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); t3.textContent = label('chords.variants'); box3.append(t3);
      for (const v of entry.alternatives) {
        const id = v.frets ? v.frets.join(',') : `p${(v.notes ?? []).join(',')}`;
        const on = !entry.hidden.includes(id);
        const r3 = row('gap:4px;align-items:center;justify-content:space-between');
        const th = thumb(v, 9); th.style.minHeight = '0';
        r3.append(th, mk(on ? label('chords.variantOn') : label('chords.variantOff'), 'variant-active', () => attempt(() => app.setVariantActive(state.pool, entry.id, id, !on)), { on, title: label('chords.variantHint') }), mk(label('chords.variantMain'), 'variant-main', () => attempt(() => app.setPoolMain(state.pool, entry.id, id)), { title: label('chords.variantMainHint') }));
        box3.append(r3, labelEditor(entry, id));
      }
      c.append(box3);
    } // a built-in layer (Easy PC) is computed: nothing to choose
    if (entry.ownCount) { const warn = el('div', 'font-size:11px;color:var(--warn-ink,#9a5b00)'); warn.textContent = label('chords.own', { n: entry.ownCount }); c.append(warn); }
    return c;
  }


  /** The panel that makes a layer from a tablature or from the diagrams shown on a chord staff: which staff, then a new layer, or complete / replace one that exists. */
  function fromPanel() {
    const f = state.from;
    const sources = app.poolSources();
    const staves = f.source === 'tab' || f.source === 'tabDiagrams' ? sources.tabs : sources.chordStaves;
    const mine = app.voicingPools().filter((p) => p.id !== 'main' && !p.builtin);
    const box2 = el('div', 'border:1px solid var(--edge,#b9b4a8);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px', { 'data-pool-from': f.source });
    const title2 = el('div', 'font-weight:var(--w-semi,600)'); title2.textContent = label(f.source === 'tab' ? 'chords.from.tabTitle' : f.source === 'tabDiagrams' ? 'chords.from.tabDiagramsTitle' : 'chords.from.staffTitle');
    const hint2 = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint2.textContent = label(f.source === 'tab' ? 'chords.from.tabHint' : f.source === 'tabDiagrams' ? 'chords.from.tabDiagramsHint' : 'chords.from.staffHint');
    const select = (act, options, value, onChange) => { const sel = el('select', 'min-height:var(--ui-target,30px);font:inherit;max-width:100%', { 'data-act': act }); for (const [v, text] of options) { const o = el('option'); o.value = v; o.textContent = text; sel.append(o); } sel.value = value; sel.addEventListener('change', () => onChange(sel.value)); return sel; };
    const staffRow = row('gap:6px');
    const lab = (key) => { const l = el('span', 'font-size:12px'); l.textContent = label(key); return l; };
    staffRow.append(lab('chords.from.staff'), select('pool-from-staff', [['', label(f.source === 'tab' ? 'chords.from.staffRead' : f.source === 'tabDiagrams' ? 'chords.from.staffFirstDiagrams' : 'chords.from.staffFirst')], ...staves.map((st) => [st.id, st.name])], f.staffId ?? '', (v) => { f.staffId = v || null; draw(); }));
    const found = app.poolFromPreview({ source: f.source, staffId: f.staffId });
    const info = el('div', 'font-size:13px', { 'data-pool-from-found': String(found.chords) });
    info.textContent = found.chords || found.unnamed ? [label('chords.from.found', { n: found.chords, m: found.withAlternatives }), found.unnamed ? label('chords.from.foundUnnamed', { n: found.unnamed }) : ''].filter(Boolean).join(' ') : label('chords.from.none');
    const targetOptions = [['new', label('chords.from.new')], ...mine.flatMap((p) => [[`complete:${p.id}`, label('chords.from.complete', { name: p.name })], [`replace:${p.id}`, label('chords.from.replace', { name: p.name })]])];
    const targetRow = row('gap:6px');
    const key = f.mode === 'new' ? 'new' : `${f.mode}:${f.poolId}`;
    targetRow.append(lab('chords.from.where'), select('pool-from-target', targetOptions, targetOptions.some(([v]) => v === key) ? key : 'new', (v) => { if (v === 'new') { f.mode = 'new'; f.poolId = null; } else { const [m, id] = v.split(':'); f.mode = m; f.poolId = id; } draw(); }));
    const nameRow = row('gap:6px');
    if (f.mode === 'new') {
      const input = el('input', 'min-height:var(--ui-target,30px);box-sizing:border-box;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:inherit;width:14em', { type: 'text', maxlength: '40', 'aria-label': label('chords.layerName'), 'data-act': 'pool-from-name' });
      input.value = f.name; input.addEventListener('input', () => { f.name = input.value; }); input.addEventListener('keydown', (e) => e.stopPropagation());
      nameRow.append(lab('chords.layerName'), input);
    }
    const actions = row('gap:6px');
    actions.append(mk(label(f.mode === 'replace' ? 'chords.from.doReplace' : f.mode === 'complete' ? 'chords.from.doComplete' : 'chords.from.doNew'), 'pool-from-apply', () => attempt(() => {
      const r = app.makePoolFrom({ source: f.source, staffId: f.staffId, target: f.mode === 'new' ? { mode: 'new', name: f.name } : { mode: f.mode, poolId: f.poolId } });
      state.pool = r.poolId; state.from = null; state.message = label('chords.from.done', { n: r.written }) + (r.waiting ? ` ${label('chords.from.doneWaiting', { n: r.waiting })}` : '');
    }), { disabled: !found.chords && !found.unnamed }), mk(label('chords.from.cancel'), 'pool-from-cancel', () => { state.from = null; draw(); }));
    box2.append(title2, hint2, staffRow, info, targetRow, ...(f.mode === 'new' ? [nameRow] : []), actions);
    return box2;
  }

  function draw() {
    const pools = app.voicingPools();
    if (!pools.some((p) => p.id === state.pool)) state.pool = 'main';
    const layer = pools.find((p) => p.id === state.pool);
    const layerIsMain = state.pool === 'main';
    const entries = app.workChords(state.pool, state.instrument);

    const title = el('div', 'display:flex;justify-content:space-between;align-items:center');
    const h = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); h.textContent = label('chords.title');
    title.append(h, mk('✕', 'close', close, { title: label('chords.close') }));
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('chords.hint');

    const tabs = row('gap:4px');
    for (const p of pools) tabs.append(mk(`${poolName(p)}${p.count ? ` (${p.count})` : ''}`, `pool-${p.id}`, () => { state.pool = p.id; state.drawing = null; draw(); }, { on: p.id === state.pool }));
    tabs.append(mk(`＋ ${label('chords.newLayer')}`, 'pool-add', () => attempt(() => { const made = app.addVoicingPool(label('chords.newLayerName', { n: pools.length })); state.pool = made.id; })));

    const fromRow = row('gap:6px');
    const startFrom = (source) => { const mine = app.voicingPools().filter((p) => p.id !== 'main' && !p.builtin); state.from = { source, staffId: null, mode: 'new', poolId: null, name: label(source === 'tab' ? 'chords.from.nameTab' : source === 'tabDiagrams' ? 'chords.from.nameTabDiagrams' : 'chords.from.nameStaff') }; if (mine.length === 0) state.from.mode = 'new'; draw(); };
    fromRow.append(mk(label('chords.from.tabButton'), 'pool-from-tab', () => startFrom('tab'), { on: state.from?.source === 'tab' }), mk(label('chords.from.tabDiagramsButton'), 'pool-from-tabdiagrams', () => startFrom('tabDiagrams'), { on: state.from?.source === 'tabDiagrams' }), mk(label('chords.from.staffButton'), 'pool-from-staff-btn', () => startFrom('chordStaff'), { on: state.from?.source === 'chordStaff' }));

    const layerRow = row('gap:6px');
    if (!layerIsMain && !layer.builtin) {
      const input = el('input', 'min-height:var(--ui-target,30px);box-sizing:border-box;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:inherit;width:12em', { type: 'text', maxlength: '40', 'aria-label': label('chords.layerName'), 'data-act': 'pool-name' });
      input.value = layer.name;
      input.addEventListener('change', () => attempt(() => app.renameVoicingPool(layer.id, input.value)));
      input.addEventListener('keydown', (e) => e.stopPropagation());
      layerRow.append(input,
        mk(label('chords.rulePower'), 'pool-rule', () => attempt(() => app.setVoicingPoolRule(layer.id, layer.rule === 'power' ? null : 'power')), { on: layer.rule === 'power', title: label('chords.rulePowerHint') }),
        mk(label('chords.removeLayer'), 'pool-remove', async () => { if (await confirmDialog({ message: label('chords.removeConfirm', { name: layer.name }), label, confirmText: label('chords.removeLayer'), cancelText: label('dialog.cancel') })) attempt(() => { app.removeVoicingPool(layer.id); state.pool = 'main'; }); }));
    }
    const instRow = row('gap:4px');
    const instLabel = el('span', 'font-size:12px;margin-right:6px'); instLabel.textContent = label('chords.instrument'); instRow.append(instLabel);
    for (const i of INSTRUMENTS) instRow.append(mk(label(`diagram.instrument.${i}`), `inst-${i}`, () => { state.instrument = i; state.drawing = null; draw(); }, { on: i === state.instrument }));

    const note = el('div', 'font-size:12px;color:var(--ink-soft,#555)');
    note.textContent = layerIsMain ? label('chords.noteMain') : layer.builtin ? label('chords.noteEasy') : layer.rule === 'power' ? label('chords.notePower') : label('chords.noteLayer');
    const msg = el('div', 'min-height:1.3em;font-size:12px;color:var(--danger-ink,#b00020)', { role: 'status' }); msg.textContent = state.message;

    const grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px');
    if (!entries.length) { const empty = el('div', 'grid-column:1 / -1;padding:12px;text-align:center;color:var(--ink-soft,#555)'); empty.textContent = label('chords.none'); grid.append(empty); }
    for (const entry of entries) {
      if (state.drawing?.id === entry.id) grid.append(drawingEditor(entry)); // the diagram being edited takes the place of its card
      else grid.append(card(entry, app.chordVariants(entry.chord, state.instrument), layerIsMain, !!layer?.builtin));
    }
    // the groups (labels) of the layer: rank the fingerings of each one (the order a list grouped by label shows them in)
    let ranking = null;
    if (layer && !layer.builtin && state.pool !== 'main' && (layer.labelOrder ?? []).length) {
      ranking = el('div', 'display:flex;flex-direction:column;gap:6px', { 'data-groups': String(layer.labelOrder.length) });
      const t5 = el('div', 'font-weight:var(--w-semi,600)'); t5.textContent = label('chords.groups'); const h5 = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); h5.textContent = label('chords.groupsHint');
      ranking.append(t5, h5);
      for (const name of layer.labelOrder) {
        const members = app.groupMembers(state.pool, name);
        const g5 = el('div', 'border:1px solid var(--edge,#b9b4a8);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px', { 'data-group': name });
        const hd = el('div', 'font:var(--w-semi,600) 13px var(--ui-font,sans-serif)'); hd.textContent = `${name} (${members.length})`;
        const strip = row('gap:6px;align-items:flex-start');
        members.forEach((m, i) => {
          const cell5 = el('div', 'display:flex;flex-direction:column;align-items:center;gap:2px');
          const nm = el('span', 'font-size:12px'); nm.textContent = entries.find((e) => e.id === m.key)?.name ?? '';
          const th5 = thumb(m.voicing, 9); th5.style.minHeight = '0';
          const mv5 = row('gap:2px');
          mv5.append(mk('◀', 'group-earlier', () => attempt(() => app.moveInGroup(state.pool, name, m.ref, -1)), { disabled: i === 0, title: label('chords.groupEarlier') }), mk('▶', 'group-later', () => attempt(() => app.moveInGroup(state.pool, name, m.ref, 1)), { disabled: i === members.length - 1, title: label('chords.groupLater') }));
          cell5.append(nm, th5, mv5); strip.append(cell5);
        });
        g5.append(hd, strip); ranking.append(g5);
      }
    }
    const waiting = layer?.unnamed ?? [];
    let toName = null;
    if (waiting.length) {
      toName = el('div', 'display:flex;flex-direction:column;gap:6px', { 'data-unnamed-list': String(waiting.length) });
      const t = el('div', 'font-weight:var(--w-semi,600)'); t.textContent = label('chords.name.title', { n: waiting.length });
      const h = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); h.textContent = label('chords.name.hint');
      const g2 = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px');
      for (const u of waiting) g2.append(namingCard(layer, u));
      toName.append(t, h, g2);
    }
    box.replaceChildren(title, hint, tabs, fromRow, ...(state.from ? [fromPanel()] : []), layerRow, instRow, note, msg, ...(ranking ? [ranking] : []), ...(toName ? [toName] : []), grid);
  }
  draw();
  return { close };
}
