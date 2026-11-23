/*
 * Chord-diagram editor (fretted instruments). A floating window on a computer, a full-screen modal sliding up from the bottom on phone / tablet, opened from the ✎ of a selected diagram container.
 * It starts from the SUGGESTION and lets the user change it: tap the grid to put or lift a finger, tap above a string for open / muted, pick another
 * suggestion, change the chord or the instrument. Every change is one undoable transaction through `app` (the document is never written from here).
 *
 *  - the grid is the drawing itself (`fretDiagramItems`) with transparent buttons laid over it (positions from its `geometry`);
 *  - "Back to the suggestion" gives the diagram back to the computer; "Use everywhere" records this fingering as the work's preferred one for the chord,
 *    so every diagram of that chord follows it.
 */
import { dismissOnOutside } from './outside-dismiss.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { createChoiceMenu } from './choice-menu.js';
import { fretDiagramItems } from '../layout/fretdiagram.js';
import { pianoDiagramItems } from '../layout/pianodiagram.js';
import { renderSvgString } from '../render/svg.js';
import { tapCell, tapMarker, editorWindow, shiftWindow, rootOf, withFrets, tapFinger, toggleKey, tapKeyFinger } from './diagram-intents.js';
import { SWATCHES } from './swatches.js';
import { keepClear, anchorOfRefs } from './keep-clear.js';
import { INSTRUMENT_PRESETS, isPiano } from '../model/fretvoicing.js';
import { createSwitch } from './switch.js';

const MARGIN = 10;
export const DIAGRAM_MARGIN = MARGIN; // the padding `diagramSvg` leaves around the drawing (pixels): an editor laying hit areas over it needs it

/** SVG of a voicing and where it is: `{ svg, width, height, ss, geometry }` (pixels). `ink` default is dark on the white box. */
export function diagramSvg(glyphs, voicing, { scale = 1, ss = 12, frame = null, title = null, gauge = false, dotColor = null, orientation = 'horizontal' } = {}) {
  const r = isPiano(voicing) ? pianoDiagramItems(voicing, { x: 0.2, y: 0.2, scale, frame, title, dotColor, orientation }) : fretDiagramItems(voicing, { x: 0.2, y: 0.2, scale, frame, title, gauge, dotColor });
  const w = r.width + 0.4;
  const h = r.height + 0.4;
  const layout = { systems: [{ index: 0, x0: 0, top: 0, staves: [{ originY: h, items: r.items, lines: 0 }], overlays: [] }], width: w, height: h };
  const svg = renderSvgString(layout, glyphs, { staffSpace: ss, margin: MARGIN, ink: 'var(--ink, #111)', paper: 'var(--field, #fff)' });
  return { svg, width: w * ss + 2 * MARGIN, height: h * ss + MARGIN, ss, h, geometry: r.geometry };
}

/**
 * Keeps the window inside the part of the screen the bottom dock (play bar, entry bar, piano) leaves free: a sheet sits right above the dock, and the box
 * never grows taller than the visible area, so its content scrolls instead of being hidden underneath.
 */
function fitAboveDock(box, sheet, getAnchor = () => null) {
  if (typeof window === 'undefined') return Object.assign(() => {}, { refit() {} });
  const apply = () => {
    const dock = document.querySelector('[data-dock]');
    const dockH = dock ? dock.offsetHeight : 0;
    const vv = window.visualViewport;
    const visibleH = vv?.height ?? window.innerHeight;
    const room = visibleH - dockH - 16;
    box.style.maxHeight = `${Math.max(160, Math.floor(sheet ? Math.min(room, visibleH * 0.58) : room))}px`; // a sheet leaves the top of the screen to the score
    box.style.overflowY = 'auto';
    if (sheet) box.style.bottom = `${dockH}px`;
    // the sheet never moves to the top: the page scrolls instead so that the diagram being edited stays visible above it
    if (sheet) {
      const a = getAnchor();
      const free = (vv?.offsetTop ?? 0) + visibleH - dockH - box.offsetHeight - 8;
      if (a && a.y2 > free) window.scrollBy({ top: Math.ceil(a.y2 - free), behavior: 'instant' });
    }
  };
  apply();
  const dock = document.querySelector('[data-dock]');
  const ro = typeof ResizeObserver !== 'undefined' && dock ? new ResizeObserver(apply) : null;
  ro?.observe(dock);
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
  return Object.assign(() => { ro?.disconnect(); window.removeEventListener('resize', apply); window.visualViewport?.removeEventListener('resize', apply); }, { refit: apply });
}

export function mountDiagramEditor({ app, glyphs, label, sidebar = null }) {
  let state = null; // { id, viewId, first (editor window), mode ('dots' | 'fingers'), box, off, unsub, clear }

  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    e.append(...kids.flat().filter((x) => x != null));
    return e;
  };
  const btn = (text, title, fn, extra = {}) => {
    const b = el('button', { type: 'button', title, 'aria-label': title, style: 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);font:var(--w-semi,600) 15px system-ui,sans-serif', ...extra }, text);
    b.addEventListener('click', fn);
    return b;
  };

  function close() {
    if (!state) return;
    state.off();
    state.unsub();
    state.unfit?.();
    state.clear?.destroy();
    state.box.remove();
    state = null;
    if (sidebar?.tabBody('diagram')) { sidebar.setTabVisible('diagram', false); if (sidebar.isEnabled()) sidebar.show('tracks'); }
  }

  function run(fn, keepWindow = false) {
    if (!keepWindow && state) state.first = null; // another suggestion / chord / instrument: the window follows the new fingering
    try { fn(); } catch (e) { note(String(e?.message ?? e)); } // a successful edit redraws through the document subscription
  }
  let noteEl = null;
  const note = (text) => { if (noteEl) noteEl.textContent = text; };

  function draw() {
    if (!state) return;
    const { id, viewId } = state;
    const info = app.diagramInfo(id, { key: state.key });
    if (!info) { close(); return; }
    if (info.follow) state.key = info.key;
    const key = info.follow ? info.key : null; // the chord symbol being edited (follow mode)
    const { box } = state;
    const removeBtn = btn('🗑', label('diagram.remove'), () => { const target = id; const vid = viewId; close(); try { app.removeDiagram(target, vid); } catch (e) { /* nothing left to remove */ } }, { 'data-act': 'diagram-remove' });
    const head = el('div', { style: 'display:flex;align-items:center;gap:var(--btn-gap,2px)' }, el('strong', { style: 'flex:1' }, label('diagram.title')), removeBtn, btn('✕', label('diagram.close'), close, { 'data-act': 'diagram-close' }));
    const row = (name, ...kids) => el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center' }, el('span', { style: 'min-width:6.5em;font-size:13px' }, name), ...kids);

    // instrument
    const instrRow = info.derived && info.onTab ? [] : [row(label('diagram.instrument'), ...['guitar', 'ukulele', 'bass', 'bass5', 'piano'].map((k) => {
      const b = btn(label(`diagram.instrument.${k}`), label(`diagram.instrument.${k}`), () => run(() => app.setDiagramInstrument(id, k, viewId)), { 'data-act': `diagram-instrument-${k}`, 'aria-pressed': String(info.instrument === k) });
      if (info.instrument === k) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
      return b;
    }))];

    // chord: root letter, accidental, quality, bass
    const chord = info.chord;
    const accidental = chord?.root.alter > 0 ? '♯' : chord?.root.alter < 0 ? '♭' : '';
    const withChord = (patch) => run(() => app.setDiagramChord(id, { root: patch.root ?? chord.root, quality: patch.quality ?? chord.quality, bass: patch.bass === undefined ? chord.bass : patch.bass }, viewId));
    const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((L) => {
      const b = btn(L, L, () => withChord({ root: rootOf(L, accidental) }), { 'data-act': `diagram-root-${L}` });
      if (chord?.root.step === L) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
      return b;
    });
    const accid = ['♭', '♯'].map((a) => {
      const b = btn(a, a, () => withChord({ root: rootOf(chord.root.step, accidental === a ? '' : a) }), { 'data-act': `diagram-accidental-${a === '♭' ? 'flat' : 'sharp'}` });
      if (accidental === a) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
      return b;
    });
    const qualityMenu = createChoiceMenu({
      options: info.qualities.map((q) => [q, q === '' ? 'maj' : q]), value: chord?.quality ?? '', label: label('diagram.quality'), act: 'diagram-quality', follow: true,
      onPick: (q) => withChord({ quality: q }),
    });
    const bassMenu = createChoiceMenu({
      options: [['', label('diagram.noBass')], ...['C', 'D', 'E', 'F', 'G', 'A', 'B'].flatMap((L) => [[L, L], [`${L}♭`, `${L}♭`], [`${L}♯`, `${L}♯`]])],
      value: chord?.bass ? `${chord.bass.step}${chord.bass.alter > 0 ? '♯' : chord.bass.alter < 0 ? '♭' : ''}` : '', label: label('diagram.bass'), act: 'diagram-bass', follow: true,
      onPick: (v) => withChord({ bass: v ? rootOf(v[0], v[1] ?? '') : null }),
    });
    const chordText = (ch) => `${ch.root.step}${ch.root.alter > 0 ? '♯' : ch.root.alter < 0 ? '♭' : ''}${ch.quality ?? ''}${ch.bass ? `/${ch.bass.step}${ch.bass.alter > 0 ? '♯' : ch.bass.alter < 0 ? '♭' : ''}` : ''}`;
    const symbolNote = info.symbol && chord ? [el('div', { style: 'font-size:12px;opacity:.7' }, `${chordText(chord)} — ${label('diagram.symbolNote')}`)] : [];
    const chips = info.follow ? [row(label('diagram.chord'), ...(info.entries.length ? info.entries.map((e) => {
      const b = btn(chordText(e.chord), chordText(e.chord), () => { state.key = e.key; state.first = null; draw(); }, { 'data-diagram-chip': e.key, 'aria-pressed': String(e.key === info.key) });
      if (e.key === info.key) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
      return b;
    }) : [el('span', { style: 'font-size:13px' }, label('diagram.noChords'))])), el('div', { style: 'font-size:12px;opacity:.7' }, label('diagram.followNote'))] : [];
    const chordRows = chord && !info.follow && !info.symbol ? [row(label('diagram.chord'), ...letters, ...accid), row(label('diagram.quality'), qualityMenu, el('span', { style: 'font-size:13px;margin-left:8px' }, label('diagram.bass')), bassMenu)] : [];

    // the grid
    let grid = el('div', { style: 'font-size:13px;opacity:.8' }, label(info.derived ? 'diagram.noNotes' : 'diagram.noFingering'));
    if (info.voicing && info.derived) {
      const d = diagramSvg(glyphs, info.voicing, { scale: 1.7, ss: 20, gauge: info.gauge, dotColor: info.color });
      const wrap = el('div', { style: `width:${d.width}px;height:${d.height}px;flex:none` }); wrap.innerHTML = d.svg;
      grid = el('div', { style: 'display:flex;gap:12px;align-items:center' }, wrap, el('div', { style: 'font-size:12px;opacity:.7;max-width:22em' }, label('diagram.derivedNote')));
    } else if (info.voicing && isPiano(info.voicing)) {
      // piano: the keys are the grid — a tap puts or lifts a note; the keyboard shows three octaves from `state.first` (a C), moved by octaves
      const v = info.voicing;
      const lo = Math.min(...v.notes); const hi = Math.max(...v.notes);
      const start = Math.min(96, Math.max(0, state.first ?? lo - (lo % 12)));
      const octaves = Math.max(3, Math.ceil((hi - start + 1) / 12));
      const frame = { start, octaves };
      const d = diagramSvg(glyphs, v, { scale: 1.5, ss: 20, frame, dotColor: info.color, orientation: info.orientation });
      const wrap = el('div', { style: `position:relative;width:${d.width}px;height:${d.height}px;flex:none` });
      wrap.innerHTML = d.svg;
      const px = (x) => MARGIN + (x + 0.2) * d.ss; const py = (y) => (d.h - (y + 0.2)) * d.ss;
      for (const kd of d.geometry.keys) { // white keys come first in the list, black keys last: the black ones are on top
        const z = el('button', { type: 'button', 'data-diagram-key': String(kd.midi), 'aria-label': String(kd.midi), style: `position:absolute;left:${px(kd.x1)}px;top:${py(kd.y2)}px;width:${(kd.x2 - kd.x1) * d.ss}px;height:${(kd.y2 - kd.y1) * d.ss}px;background:transparent;border:0;padding:0;cursor:pointer` });
        z.addEventListener('click', () => {
          const next = state.mode === 'fingers' ? tapKeyFinger(v, kd.midi) : toggleKey(v, kd.midi); // fingers: a lit key's number turns; else a key is put / lifted (one at least stays)
          if (next === v) return;
          state.first = start;
          run(() => app.setDiagramVoicing(id, next, viewId, key), true);
        });
        wrap.append(z);
      }
      const stepper = el('div', { style: 'display:flex;flex-direction:column;gap:var(--btn-gap,2px);align-items:center' },
        el('span', { style: 'font-size:13px' }, label('diagram.octave')),
        btn('▲', label('diagram.octaveUp'), () => { state.first = Math.min(96, start + 12); draw(); }, { 'data-act': 'diagram-window-up' }),
        el('output', { 'data-diagram-first': '', style: 'font-variant-numeric:tabular-nums' }, `C${start / 12 - 1}`),
        btn('▼', label('diagram.octaveDown'), () => { state.first = Math.max(0, start - 12); draw(); }, { 'data-act': 'diagram-window-down' }));
      grid = el('div', { style: 'display:flex;gap:12px;align-items:flex-start' }, wrap, stepper);
    } else if (info.voicing) {
      const v = info.voicing;
      const max = INSTRUMENT_PRESETS[v.instrument]?.maxFret ?? 24;
      const win = editorWindow(v.frets, state.first);
      const d = diagramSvg(glyphs, v, { scale: 1.7, ss: 20, frame: win, gauge: info.gauge, dotColor: info.color });
      const wrap = el('div', { style: `position:relative;width:${d.width}px;height:${d.height}px;flex:none` });
      wrap.innerHTML = d.svg;
      const g = d.geometry;
      const px = (x) => MARGIN + (x + 0.2) * d.ss; // 0.2 = the padding diagramSvg puts around the box
      const py = (y) => (d.h - (y + 0.2)) * d.ss;
      const zone = (x, y, w, h, act, fn, title) => {
        const z = el('button', { type: 'button', 'data-diagram-cell': act, 'aria-label': title, style: `position:absolute;left:${px(x)}px;top:${py(y + h)}px;width:${w * d.ss}px;height:${h * d.ss}px;background:transparent;border:0;padding:0;cursor:pointer` });
        z.addEventListener('click', fn);
        wrap.append(z);
      };
      const commit = (next) => { state.first = win.first; run(() => app.setDiagramVoicing(id, next, viewId, key), true); };
      // what a tap on a fret does depends on the mode: put / lift a finger, write a finger number in the dot
      const onFret = (i, fret) => () => {
        if (state.mode === 'fingers') { const next = tapFinger(v, i, fret); if (next !== v) commit(next); } else commit(withFrets(v, tapCell(v.frets, i, fret)));
      };
      g.stringX.forEach((sx, i) => {
        zone(sx - g.stringGap / 2, g.nutY, g.stringGap, g.markerZone, `m:${i}`, () => commit(withFrets(v, tapMarker(v.frets, i))), label('diagram.marker'));
        for (let r = 0; r < g.rows; r++) zone(sx - g.stringGap / 2, g.nutY - (r + 1) * g.rowGap, g.stringGap, g.rowGap, `${i}:${win.first + r}`, onFret(i, win.first + r), `${label('diagram.fret')} ${win.first + r}`);
      });
      const stepper = el('div', { style: 'display:flex;flex-direction:column;gap:var(--btn-gap,2px);align-items:center' },
        el('span', { style: 'font-size:13px' }, label('diagram.position')),
        btn('▲', label('diagram.up'), () => { state.first = shiftWindow(win, -1, max).first; draw(); }, { 'data-act': 'diagram-window-up' }),
        el('output', { 'data-diagram-first': '', style: 'font-variant-numeric:tabular-nums' }, String(win.first)),
        btn('▼', label('diagram.down'), () => { state.first = shiftWindow(win, 1, max).first; draw(); }, { 'data-act': 'diagram-window-down' }));
      grid = el('div', { style: 'display:flex;gap:12px;align-items:flex-start' }, wrap, stepper);
    }

    // suggestions
    const sug = el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px)', 'data-diagram-suggestions': '' });
    info.suggestions.forEach((s, i) => {
      const thumb = diagramSvg(glyphs, s, { scale: 1, ss: 9, gauge: info.gauge, dotColor: info.color });
      const current = info.source === 'suggestion' && info.index === i;
      const b = el('button', { type: 'button', 'data-diagram-suggestion': String(i), 'aria-label': `${label('diagram.suggestion')} ${i + 1}`, 'aria-pressed': String(current), style: `flex:none;padding:2px;background:var(--field,#fff);border:${current ? '2px solid var(--sel-edge,#2d78ff)' : '1px solid #bbb'};border-radius:6px;cursor:pointer` });
      b.innerHTML = thumb.svg;
      b.addEventListener('click', () => run(() => app.setDiagramSuggestion(id, i, viewId, key)));
      sug.append(b);
    });

    // what a tap on the grid does: put the dots / write the finger numbers
    const modeRow = row(label('diagram.mode'), ...['dots', 'fingers'].map((m) => {
      const b = btn(label(`diagram.mode.${m}`), label(`diagram.mode.${m}.title`), () => { state.mode = m; draw(); }, { 'data-act': `diagram-mode-${m}`, 'aria-pressed': String(state.mode === m), style: 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif' });
      if (state.mode === m) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
      return b;
    }));
    // colour of ALL the dots of the diagram (the same swatches as everywhere else): one choice, every dot follows, those added later too
    const current = info.color ?? null;
    const paintRow = [row(label('diagram.paint'),
      ...SWATCHES.map((c) => el('button', { type: 'button', 'data-diagram-color': c, 'aria-label': c, 'aria-pressed': String(current === c), style: `width:var(--ui-target,44px);height:var(--ui-target,44px);background:${c};border:${current === c ? '3px solid var(--sel-edge,#2d78ff)' : '1px solid #888'};border-radius:6px;cursor:pointer`, onclick: () => run(() => app.setDiagramColor(id, c, viewId)) })),
      el('input', { type: 'color', 'data-diagram-color-custom': '', 'aria-label': label('diagram.paint.custom'), value: current ?? '#c62828', style: 'width:var(--ui-target,44px);height:var(--ui-target,44px);padding:0;border:1px solid var(--edge,#888);border-radius:6px', onchange: (e) => run(() => app.setDiagramColor(id, e.target.value, viewId)) }),
      btn(label('diagram.paint.clear'), label('diagram.paint.clear.title'), () => run(() => app.setDiagramColor(id, null, viewId)), { 'data-act': 'diagram-paint-clear', 'aria-pressed': String(current === null), style: 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif' }))];
    // height above the chord symbol (the diagram of a chord symbol only): its own, else the movement's setting
    const liftNow = info.lift ?? info.liftDefault;
    const liftRow = info.symbol || info.derived ? [row(label('diagram.lift'),
      btn('−', label('diagram.lift.less'), () => run(() => app.setDiagramLift(id, Math.max(0, Math.round((liftNow - 0.25) * 100) / 100), viewId)), { 'data-act': 'diagram-lift-less' }),
      el('output', { 'data-diagram-lift': '', style: `min-width:3.6em;text-align:center;font-variant-numeric:tabular-nums;${info.lift === null ? 'opacity:.7' : 'font-weight:var(--w-bold,700)'}` }, `${liftNow.toFixed(2)} sp`),
      btn('+', label('diagram.lift.more'), () => run(() => app.setDiagramLift(id, Math.min(20, Math.round((liftNow + 0.25) * 100) / 100), viewId)), { 'data-act': 'diagram-lift-more' }),
      btn('↺', label('diagram.lift.default'), () => run(() => app.setDiagramLift(id, null, viewId)), { 'data-act': 'diagram-lift-default', disabled: info.lift === null ? 'disabled' : null }))] : [];
    // a piano diagram lies or stands (to save width)
    const orientRow = info.voicing && isPiano(info.voicing) ? [row(label('diagram.orientation'), ...['horizontal', 'vertical'].map((o) => {
      const b = btn(label(`diagram.orientation.${o}`), label(`diagram.orientation.${o}`), () => run(() => app.setDiagramOrientation(id, o, viewId)), { 'data-act': `diagram-orientation-${o}`, 'aria-pressed': String(info.orientation === o), style: 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif' });
      if (info.orientation === o) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
      return b;
    }))] : [];
    // look of the diagram in the score: string thickness (on by default) and size
    const gaugeBtn = info.voicing && isPiano(info.voicing) ? null : btn(label('diagram.gauge'), label('diagram.gauge.title'), () => run(() => app.setDiagramGauge(id, !info.gauge, viewId)), { 'data-act': 'diagram-gauge', 'aria-pressed': String(info.gauge), style: 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif' });
    if (info.gauge && gaugeBtn) gaugeBtn.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
    const zoomRow = row(label('diagram.zoom'), btn('−', label('container.zoomOut'), () => run(() => app.zoomContainer(id, -1, viewId)), { 'data-act': 'diagram-zoom-out' }),
      el('output', { 'data-diagram-zoom': '', style: 'min-width:3.2em;text-align:center;font-variant-numeric:tabular-nums' }, `${Math.round(info.zoom * 100)} %`),
      btn('+', label('container.zoomIn'), () => run(() => app.zoomContainer(id, 1, viewId)), { 'data-act': 'diagram-zoom-in' }), ...(gaugeBtn ? [gaugeBtn] : []));
    // "apply to all": the look of this diagram (size, height, orientation, string thickness, colour) for the others; the whole movement makes it the DEFAULT of the movement
    const applyBlock = (() => {
      if (!(info.symbol || info.derived)) return [];
      const opts = state.apply ?? (state.apply = { keys: new Set(['scale', 'lift', 'orientation', 'gauge', 'color']), scope: 'movement', same: false });
      const targets = app.diagramLookTargets(id, { scope: opts.scope, sameInstrument: opts.same });
      if (!targets) return [];
      const pill = 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif';
      const accent = ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
      const sw = (text, checked, onchange, attrs = {}) => { const b = createSwitch({ text, checked, onchange, attrs }); b.style.cssText = pill + (checked ? accent : ''); return b; };
      const keyRow = row(label('diagram.apply.what'), ...['scale', 'lift', 'orientation', 'gauge', 'color'].map((k) => sw(label(`diagram.apply.${k}`), opts.keys.has(k), (e) => { if (e.target.checked) opts.keys.add(k); else opts.keys.delete(k); draw(); }, { 'data-apply-key': k })));
      const scopeRow = row(label('diagram.apply.where'), ...['movement', 'staff'].map((sc) => {
        const b = btn(label(`diagram.apply.scope.${sc}`), label(`diagram.apply.scope.${sc}.title`), () => { opts.scope = sc; draw(); }, { 'data-act': `diagram-apply-scope-${sc}`, 'aria-pressed': String(opts.scope === sc), style: pill });
        if (opts.scope === sc) b.style.cssText += accent;
        return b;
      }), sw(label('diagram.apply.sameInstrument'), opts.same, (e) => { opts.same = e.target.checked; draw(); }, { 'data-apply-same': '' }));
      const asDefault = opts.scope === 'movement' && !opts.same;
      const go = btn(label(asDefault ? 'diagram.apply.defaultGo' : 'diagram.apply.go').replace('{n}', String(targets.count)), label(asDefault ? 'diagram.apply.defaultGo.title' : 'diagram.apply.go.title'), () => {
        if (!opts.keys.size) { note(label('diagram.apply.none')); return; }
        run(() => { const n = app.applyDiagramLookToAll(id, { keys: [...opts.keys], scope: opts.scope, sameInstrument: opts.same }, viewId); note(label('diagram.apply.done').replace('{n}', String(n))); }, true);
      }, { 'data-act': 'diagram-apply-go', style: pill });
      const reset = targets.hasDefault ? btn(label('diagram.apply.reset'), label('diagram.apply.reset.title'), () => run(() => app.resetDiagramDefaults(id, viewId), true), { 'data-act': 'diagram-apply-reset', style: pill }) : null;
      const details = el('details', { 'data-diagram-apply': '', style: 'display:flex;flex-direction:column;gap:6px;border:1px solid var(--edge,#c9c4b8);border-radius:8px;padding:6px 8px' },
        el('summary', { style: 'cursor:pointer;font:var(--w-semi,600) 14px system-ui,sans-serif;min-height:var(--ui-target,44px);display:flex;align-items:center' }, label('diagram.apply.title')),
        keyRow, scopeRow, el('div', { style: 'font-size:12px;opacity:.75' }, label(asDefault ? 'diagram.apply.defaultNote' : 'diagram.apply.note')),
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center' }, go, ...(reset ? [reset] : [])));
      if (state.applyOpen) details.setAttribute('open', '');
      details.addEventListener('toggle', () => { state.applyOpen = details.open; });
      return [details];
    })();
    // the user's personal repertoire for this chord: offered before the computed suggestions; a tap adopts one
    const mine = el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px)', 'data-diagram-library': '' });
    info.library.forEach((v, i) => {
      const thumb = diagramSvg(glyphs, v, { scale: 1, ss: 9, gauge: info.gauge, dotColor: info.color });
      const b = el('button', { type: 'button', 'data-diagram-mine': String(i), 'aria-label': `${label('diagram.mine')} ${i + 1}`, style: 'flex:none;padding:2px;background:var(--field,#fff);border:1px solid var(--sel-edge,#2d78ff);border-radius:6px;cursor:pointer' });
      b.innerHTML = thumb.svg;
      b.addEventListener('click', () => run(() => app.setDiagramVoicing(id, v, viewId, key)));
      mine.append(b);
    });
    const libButton = info.chord && info.voicing ? btn(label(info.inLibrary ? 'diagram.library.remove' : 'diagram.library.add'), label(info.inLibrary ? 'diagram.library.remove.title' : 'diagram.library.add.title'), () => { run(() => app.saveDiagramToLibrary(id, { key, remove: info.inLibrary })); draw(); }, { 'data-act': info.inLibrary ? 'diagram-library-remove' : 'diagram-library-add', style: 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif' }) : null;
    // actions
    const sourceText = info.source ? label(`diagram.source.${info.source}`) : '';
    const actions = el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center' },
      btn(label('diagram.reset'), label('diagram.reset'), () => run(() => app.resetDiagramVoicing(id, viewId, key)), { 'data-act': 'diagram-reset', style: 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif' }),
      info.canSolve ? btn(label(info.solver ? 'diagram.solver.on' : 'diagram.solver.off'), label('diagram.solver.title'), () => run(() => app.setDiagramSolver(id, !info.solver, viewId, key)), { 'data-act': 'diagram-solver', 'aria-pressed': String(info.solver), style: `min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif${info.solver ? ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}` }) : null,
      btn(label('diagram.everywhere'), label('diagram.everywhere.title'), () => run(() => app.useDiagramEverywhere(id, viewId, key)), { 'data-act': 'diagram-everywhere', style: 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif' }),
      info.hasPreferred ? btn(label('diagram.forget'), label('diagram.forget'), () => run(() => app.forgetPreferredDiagram(id, viewId, key)), { 'data-act': 'diagram-forget', style: 'min-height:var(--ui-target,44px);padding:0 10px;font:var(--w-semi,600) 14px system-ui,sans-serif' }) : null,
      el('span', { style: 'font-size:12px;opacity:.7', 'data-diagram-source': info.source ?? '' }, sourceText));
    noteEl = el('div', { style: 'font-size:12px;color:var(--danger-ink,#b3261e);min-height:1em', role: 'status' });
    // the big diagram on the left, the suggestions as a matrix on its right (they drop below when the width is short)
    const side = el('div', { style: 'flex:1 1 260px;min-width:240px;display:flex;flex-direction:column;gap:8px' },
      ...(info.library.length ? [el('div', { style: 'font-size:13px' }, label('diagram.mine.title')), mine] : []),
      ...(info.derived ? [] : [el('div', { style: 'font-size:13px' }, label('diagram.suggestions')), sug, actions, libButton]));
    const body = el('div', { style: 'display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start' }, el('div', { style: 'flex:none;max-width:100%' }, grid), ...(side.children.length ? [side] : []));
    box.replaceChildren(head, ...instrRow, ...symbolNote, ...chips, ...chordRows, zoomRow, ...orientRow, ...liftRow, ...paintRow, ...(info.derived ? [] : [modeRow]), ...applyBlock, body, noteEl);
  }

  function open(id, viewId = 'main') {
    close();
    if (!app.diagramInfo(id)) return null;
    const sheet = panelMode(typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(SHEET_QUERY).matches : false) === 'sheet';
    // computer: the editor lives in the "Diagram" tab of the sidebar (no window, nothing covers the score)
    if (sidebar?.isEnabled()) {
      const body = sidebar.addTab('diagram', label('sidebar.tab.diagram'), { visible: true });
      const box = el('div', { 'data-diagram-editor': '', role: 'region', 'aria-label': label('diagram.title'), 'data-mode': 'docked', style: 'padding:10px 12px;color:var(--ink,#111);font:15px system-ui,sans-serif;display:flex;flex-direction:column;gap:8px' });
      body.replaceChildren(box);
      state = { id, viewId, first: null, key: null, mode: 'dots', box, off: () => {}, unsub: () => {} };
      state.unsub = app.doc.subscribe((event) => { if (state && (event.type === 'commit' || event.type === 'undo' || event.type === 'redo')) draw(); });
      box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
      draw();
      sidebar.show('diagram');
      return { close };
    }
    const common = 'font:15px system-ui,sans-serif;color:var(--ink,#111);background:var(--field,#fff);display:flex;flex-direction:column;gap:8px;';
    // phone / tablet: a true modal that slides up from the bottom and covers the whole screen; computer: a floating window kept clear of the diagram
    const box = el('div', { 'data-diagram-editor': '', 'data-resizable': sheet ? null : 'diagram', 'data-zoom-lock': '', 'data-dismiss-keep': sheet ? '' : null, role: 'dialog', 'aria-modal': sheet ? 'true' : null, 'aria-label': label('diagram.title'), 'data-mode': sheet ? 'modal' : 'floating',
      style: sheet
        ? `position:fixed;z-index:3500;left:0;right:0;top:0;bottom:0;overflow-y:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box;padding:10px max(12px,calc((100vw - 900px) / 2)) calc(16px + env(safe-area-inset-bottom));transform:translateY(100%);transition:transform .22s ease-out;${common}`
        : `position:fixed;z-index:3000;left:50%;bottom:calc(var(--ui-target,44px) * 3);max-height:80vh;overflow:auto;border-radius:10px;max-width:calc(100vw - 16px);transform:translateX(-50%);padding:10px 12px;border:1px solid rgba(0,0,0,0.3);box-shadow:0 6px 24px rgba(0,0,0,0.3);${common}` });
    state = { id, viewId, first: null, key: null, mode: 'dots', box, off: () => {}, unsub: () => {} };
    state.unsub = app.doc.subscribe((event) => { if (state && (event.type === 'commit' || event.type === 'undo' || event.type === 'redo')) { draw(); if (!sheet) requestAnimationFrame(() => state?.unfit?.refit()); } });
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    draw();
    document.body.append(box);
    if (sheet) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => { if (state?.box === box) box.style.transform = 'translateY(0)'; }));
      else box.style.transform = 'translateY(0)';
    } else {
      state.unfit = fitAboveDock(box, false, () => anchorOfRefs([id]));
      state.off = dismissOnOutside(() => box, close);
      state.clear = keepClear(box, () => anchorOfRefs([id])); state.clear.apply();
    }
    return { close };
  }
  return { open, close, destroy: close, isOpen: () => state !== null };
}
