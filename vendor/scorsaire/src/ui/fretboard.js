/*
 * The on-screen fretboard (guitar, bass, ukulele…): strings and frets drawn in SVG, positions lit from the outside (`noteOn(midi, velocity, color, pos)`)
 * and played with the finger (`onNoteOn` / `onNoteOff`, one dot per pointer). Like the on-screen keyboard it makes NO sound and never touches the document.
 * Layout choices (all kept by the host on the device): horizontal or vertical neck, which side the bass strings are on, which end the nut is at (a left-handed
 * player has it on the other side). Strings are numbered from the LOWEST one (index 0); frets from the nut (0 = open string).
 * Frets are spaced like a real neck (each one closer than the last), the whole neck compressed to the width (or height) available.
 * A VIEW can show only a window of the frets (`setView({ count, start })`): the frets shown fill the whole length, so each cell is bigger for a finger. Like a
 * capo, the window's first wire acts as the nut: what is pressed before it is the fret it starts at (`start` frets from the nut, or from the capo).
 */
import { FRETBOARD_INSTRUMENTS, pitchLetter } from '../model/fretboardmap.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e); return e;
};
const SINGLE_DOTS = new Set([3, 5, 7, 9, 15, 17, 19, 21]); const DOUBLE_DOTS = new Set([12, 24]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const DEFAULT_THEME = Object.freeze({ frame: '#efece4', board: '#f7f4ec', ink: '#1c1b1a', line: '#cfc8b8', lit: '#2b6cff', fret: '#9a948a' });

export function createFretboard({ host, instrument = 'guitar', orientation = 'horizontal', flip = false, nutAtEnd = false, theme = {}, readOnly = false } = {}) {
  let tuning = { ...FRETBOARD_INSTRUMENTS[instrument] ?? FRETBOARD_INSTRUMENTS.guitar };
  let layout = { orientation, flip, nutAtEnd };
  // { fret, ignored: [string indices] }: with a capo the neck is drawn as guitarists read it — the capo's wire is the nut, frets are counted from it (1 = the
  // first fret after the capo) and a small "Capo n" mark names its real fret; the capo itself is not drawn
  let capo = null;
  // window of frets shown: `count` cells (0 = the whole neck) starting `start` frets after the nut (or the capo)
  let view = { count: 0, start: 0 };
  let onViewChange = null;
  const capoFret = () => capo?.fret ?? 0;
  const span = () => Math.max(1, tuning.frets - capoFret()); // cells between the nut (or the capo) and the last fret
  const windowCount = () => (view.count > 0 ? Math.min(view.count, span()) : span());
  const windowStart = () => clamp(view.start, 0, span() - windowCount());
  const windowed = () => windowCount() < span();
  const base = () => capoFret() + windowStart();
  const cells = () => windowCount();
  let colors = { ...DEFAULT_THEME, ...theme };
  let locked = readOnly;
  const lit = new Map(); // midi → { string, fret, color }
  const fingers = new Map(); // pointerId → { midi, string, fret }
  let onOn = null; let onOff = null;
  let menuItems = null; let menuPick = null; let pop = null;

  const root = document.createElement('div');
  root.setAttribute('data-fretboard', '');
  root.style.cssText = 'position:relative;display:flex;justify-content:center;min-width:0;width:100%;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';
  const svg = svgEl('svg', { role: 'img' }); svg.style.cssText = 'display:block;touch-action:none;max-width:100%';
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button'; menuBtn.textContent = '⋮'; menuBtn.setAttribute('data-no-icon', ''); menuBtn.hidden = true;
  menuBtn.style.cssText = 'position:absolute;top:2px;right:2px;width:30px;height:30px;border-radius:8px;border:1px solid var(--edge,#bbb);background:var(--field,#fff);color:var(--ink,#222);font-size:18px;line-height:1;cursor:pointer;padding:0;z-index:2';
  // − [from–to] +: moves the window along the neck (only while a window is shown)
  const win = document.createElement('div');
  win.style.cssText = 'position:absolute;top:2px;right:36px;display:none;align-items:center;gap:3px;z-index:2;font:600 12px system-ui,sans-serif;color:var(--ink,#222)';
  const winBtn = (text, title, dir) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.setAttribute('data-no-icon', '');
    b.style.cssText = 'width:30px;height:30px;border-radius:8px;border:1px solid var(--edge,#bbb);background:var(--field,#fff);color:var(--ink,#222);font-size:18px;line-height:1;cursor:pointer;padding:0';
    b.addEventListener('click', () => { view = { ...view, start: windowStart() + dir }; view.start = windowStart(); render(); onViewChange?.({ ...view }); });
    return b;
  };
  const winLabel = document.createElement('span'); winLabel.style.cssText = 'min-width:3.2em;text-align:center;background:var(--paper-veil,rgba(255,255,255,.85));border-radius:6px;padding:2px 4px';
  const winLow = winBtn('−', 'Lower frets', -1); const winHigh = winBtn('+', 'Higher frets', 1);
  win.append(winLow, winLabel, winHigh);
  root.append(svg, win, menuBtn);
  host.append(root);

  // ---- geometry ----
  let g = null; // { w, h, a0, L, c0, gap, openRoom, radius, … }
  const stringWeight = (open) => {
    const lo = Math.min(...tuning.strings); const hi = Math.max(...tuning.strings);
    return hi === lo ? 1.6 : 2.6 - ((open - lo) / (hi - lo)) * 1.8;
  };
  // 0 at the nut, 1 at the last fret: half real spacing (each fret closer than the last), half even, so the far frets stay big enough for a finger
  const fretPos = (f) => 0.5 * ((1 - 2 ** (-f / 12)) / (1 - 2 ** (-cells() / 12))) + 0.5 * (f / cells());
  const visualRow = (s) => {
    const n = tuning.strings.length;
    const lowFirst = layout.orientation === 'vertical' ? !layout.flip : layout.flip; // vertical default: lowest string on the left; horizontal: at the bottom
    return lowFirst ? s : n - 1 - s;
  };
  const measure = () => {
    const n = tuning.strings.length;
    const hostW = clamp(host.clientWidth || 640, 280, 1500);
    const gap = layout.orientation === 'vertical' ? clamp(Math.floor((hostW - 60) / n), 26, 42) : (n > 5 ? 22 : 24);
    const openRoom = 30; const labelRoom = 26; const end = 12; // labelRoom: the zone with the names of the open strings, beyond the open-string dots
    const c0 = Math.ceil(gap * 0.7) + 2; // first string, leaving room for the edge of the board
    const cross = c0 + (n - 1) * gap + Math.ceil(gap * 0.7) + 22; // + room for the fret numbers on the far side
    if (layout.orientation === 'horizontal') {
      g = { w: hostW, h: cross, L: hostW - openRoom - labelRoom - end, gap, openRoom, labelRoom, a0: openRoom + labelRoom, c0 };
    } else {
      const h = clamp(Math.round((window.innerHeight || 700) * 0.5), 300, 560);
      g = { w: cross, h, L: h - openRoom - labelRoom - end, gap, openRoom, labelRoom, a0: openRoom + labelRoom, c0 };
    }
    g.radius = Math.min(11, gap * 0.42);
  };
  /** Screen point of (a = distance from the nut towards the bridge in px — negative before the nut —, row across the neck). */
  const screen = (a, row) => {
    const c = g.c0 + row * g.gap;
    if (layout.orientation === 'horizontal') return { x: layout.nutAtEnd ? g.w - g.a0 - a : g.a0 + a, y: c };
    return { x: c, y: layout.nutAtEnd ? g.h - g.a0 - a : g.a0 + a };
  };
  const along = (px, py) => (layout.orientation === 'horizontal'
    ? (layout.nutAtEnd ? g.w - g.a0 - px : px - g.a0)
    : (layout.nutAtEnd ? g.h - g.a0 - py : py - g.a0));
  const across = (px, py) => (layout.orientation === 'horizontal' ? py : px);
  const dotPos = (string, fret) => {
    const rel = fret - base(); // counted from the capo: at or before it = the open position beside the nut
    const a = rel <= 0 ? -g.openRoom * 0.5 : ((fretPos(rel - 1) + fretPos(rel)) / 2) * g.L;
    return screen(a, visualRow(string));
  };

  // ---- drawing ----
  let litLayer = null;
  function drawLit() {
    if (!litLayer) return;
    litLayer.replaceChildren();
    for (const [midi, d] of lit) {
      if (d.fret - base() > cells() || (windowStart() > 0 && d.fret < base())) continue; // outside the window shown
      const { x, y } = dotPos(d.string, d.fret);
      svgEl('circle', { cx: x, cy: y, r: g.radius, fill: d.color || colors.lit, stroke: '#fff', 'stroke-width': 1.5, 'data-midi': midi }, litLayer);
    }
  }
  function updateWindowControls() {
    win.style.display = windowed() ? 'flex' : 'none';
    winLabel.textContent = `${windowStart() + 1}–${windowStart() + cells()}`;
    winLow.disabled = windowStart() <= 0; winHigh.disabled = windowStart() >= span() - cells();
    winLow.style.opacity = winLow.disabled ? '0.4' : ''; winHigh.style.opacity = winHigh.disabled ? '0.4' : '';
  }
  function render() {
    measure();
    updateWindowControls();
    svg.replaceChildren();
    svg.setAttribute('width', g.w); svg.setAttribute('height', g.h); svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
    const n = tuning.strings.length;
    // board
    const e1 = screen(0, -0.6); const e2 = screen(g.L, n - 0.4);
    svgEl('rect', { x: Math.min(e1.x, e2.x), y: Math.min(e1.y, e2.y), width: Math.abs(e2.x - e1.x), height: Math.abs(e2.y - e1.y), rx: 4, fill: colors.board, stroke: colors.line }, svg);
    // names of the open strings, in a zone beside the nut (it follows the tuning; a tap on a name plays the open string)
    const z1 = screen(-g.openRoom - g.labelRoom + 2, -0.6); const z2 = screen(-g.openRoom, n - 0.4);
    svgEl('rect', { x: Math.min(z1.x, z2.x), y: Math.min(z1.y, z2.y), width: Math.abs(z2.x - z1.x), height: Math.abs(z2.y - z1.y), rx: 6, fill: colors.frame, stroke: colors.line }, svg);
    tuning.strings.forEach((open, s) => {
      const p = screen(-g.openRoom - g.labelRoom / 2 + 1, visualRow(s));
      const label = svgEl('text', { x: p.x, y: p.y + 4.5, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600, fill: colors.ink, 'font-family': 'system-ui, sans-serif', 'pointer-events': 'none' }, svg);
      label.textContent = pitchLetter(open);
    });
    // position markers
    for (let f = base() + 1; f <= base() + cells(); f++) { // the inlays are on the real neck: their frets are absolute
      const c = f - base();
      const mid = ((fretPos(c - 1) + fretPos(c)) / 2) * g.L;
      const spots = SINGLE_DOTS.has(f) ? [(n - 1) / 2] : DOUBLE_DOTS.has(f) ? [(n - 1) / 2 - 1, (n - 1) / 2 + 1] : [];
      for (const r of spots) { const p = screen(mid, r); svgEl('circle', { cx: p.x, cy: p.y, r: Math.min(5, g.gap * 0.2), fill: colors.line }, svg); }
    }
    // frets
    for (let f = 0; f <= cells(); f++) {
      const a = fretPos(f) * g.L; const p1 = screen(a, -0.5); const p2 = screen(a, n - 0.5);
      svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: f === 0 ? colors.ink : colors.fret, 'stroke-width': f === 0 ? 5 : 1.4 }, svg);
    }
    // fret numbers, on the side beyond the strings
    const numbered = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);
    for (let c = 1; c <= cells(); c++) { // numbered from the nut, or from the capo when there is one; a window numbers each of its cells
      const f = windowStart() + c;
      if (!(numbered.has(f) || (windowed() && cells() <= 12))) continue;
      const a = ((fretPos(c - 1) + fretPos(c)) / 2) * g.L;
      const p = screen(a, n - 1 + (g.gap * 0.7 + 12) / g.gap);
      const t = svgEl('text', { x: p.x, y: p.y + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#8a847a', 'font-family': 'system-ui, sans-serif' }, svg); t.textContent = String(f);
    }
    // strings (thicker for the low ones)
    tuning.strings.forEach((open, s) => {
      const p1 = screen(-g.openRoom + 4, visualRow(s)); const p2 = screen(g.L, visualRow(s));
      svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: colors.ink, 'stroke-opacity': 0.75, 'stroke-width': stringWeight(open).toFixed(2) }, svg);
    });
    if (capo) { // "Capo 3": the real fret of the capo, in the zone of the string names (the capo is the nut)
      const p = screen(-g.openRoom - g.labelRoom / 2 + 1, n - 1 + (g.gap * 0.7 + 12) / g.gap);
      const side = layout.orientation === 'horizontal' ? (layout.nutAtEnd ? { x: g.w - 4, anchor: 'end' } : { x: 4, anchor: 'start' }) : { x: p.x, anchor: 'middle' }; // it must not run off the edge
      const t = svgEl('text', { x: side.x, y: p.y + 4, 'text-anchor': side.anchor, 'font-size': 11, 'font-weight': 700, fill: colors.ink, 'font-family': 'system-ui, sans-serif', 'pointer-events': 'none' }, svg);
      t.textContent = `Capo ${capo.fret}`;
    }
    litLayer = svgEl('g', {}, svg);
    drawLit();
  }

  // ---- pointer ----
  function hit(ev) {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (g.w / r.width); const py = (ev.clientY - r.top) * (g.h / r.height);
    const n = tuning.strings.length;
    const row = clamp(Math.round((across(px, py) - g.c0) / g.gap), 0, n - 1);
    const s = [...Array(n).keys()].find((i) => visualRow(i) === row);
    const a = along(px, py);
    if (a < -g.openRoom - g.labelRoom || a > g.L + 6) return null; // the zone of the string names counts as the open string
    // before the nut: the string open (or at the capo when it presses the string); beyond: the cell, counted from the capo
    let fret = capo?.ignored?.includes(s) ? 0 : base();
    if (a >= 0) { const u = clamp(a / g.L, 0, 0.9999); let c = 1; while (c < cells() && fretPos(c) <= u) c += 1; fret = base() + c; }
    return { string: s, fret, midi: tuning.strings[s] + fret };
  }
  svg.addEventListener('pointerdown', (ev) => {
    if (locked || ev.button > 0) return;
    const h = hit(ev); if (!h) return;
    ev.preventDefault();
    try { svg.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
    fingers.set(ev.pointerId, h);
    lit.set(h.midi, { string: h.string, fret: h.fret, color: null, finger: true }); drawLit();
    onOn?.({ midi: h.midi, velocity: 90, string: h.string, fret: h.fret });
  });
  const release = (ev) => {
    const h = fingers.get(ev.pointerId); if (!h) return;
    fingers.delete(ev.pointerId);
    if (lit.get(h.midi)?.finger) { lit.delete(h.midi); drawLit(); }
    onOff?.({ midi: h.midi, string: h.string, fret: h.fret });
  };
  svg.addEventListener('pointerup', release); svg.addEventListener('pointercancel', release);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- menu (⋮) ----
  function closeMenu() { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); }
  function outside(e) { if (pop && !pop.contains(e.target) && e.target !== menuBtn) closeMenu(); }
  menuBtn.addEventListener('click', () => {
    if (pop) { closeMenu(); return; }
    const items = typeof menuItems === 'function' ? menuItems() : menuItems;
    if (!items?.length) return;
    pop = document.createElement('div'); pop.setAttribute('data-zoom-lock', ''); pop.setAttribute('role', 'menu');
    pop.style.cssText = 'position:fixed;z-index:3500;background:var(--field,#fff);color:var(--ink,#222);border:1px solid var(--edge,#bbb);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.2);padding:4px;min-width:220px;max-width:min(360px,92vw);max-height:70vh;overflow:auto;font:14px system-ui,sans-serif';
    for (const it of items) {
      if (it.heading) { const h = document.createElement('div'); h.textContent = it.heading; h.style.cssText = 'padding:6px 10px 2px;font-size:12px;color:#777'; pop.append(h); continue; }
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', String(!!it.checked));
      b.style.cssText = 'display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:8px;cursor:pointer;color:inherit;font:inherit;min-height:36px';
      const check = document.createElement('span'); check.textContent = it.checked ? '✓' : ''; check.style.cssText = 'width:16px;flex:none';
      b.append(check, document.createTextNode(it.label));
      b.addEventListener('click', () => { closeMenu(); menuPick?.(it.id); });
      pop.append(b);
    }
    document.body.append(pop);
    const r = menuBtn.getBoundingClientRect(); const pr = pop.getBoundingClientRect();
    pop.style.left = `${clamp(r.right - pr.width, 4, window.innerWidth - pr.width - 4)}px`;
    pop.style.top = `${r.bottom + pr.height + 6 > window.innerHeight ? Math.max(4, r.top - pr.height - 6) : r.bottom + 6}px`;
    document.addEventListener('pointerdown', outside, true);
  });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (host.clientWidth && Math.abs(host.clientWidth - (g?.w ?? 0)) > 2 && layout.orientation === 'horizontal') render(); }) : null;
  ro?.observe(host);
  render();

  return {
    element: root,
    /** Instrument key of FRETBOARD_INSTRUMENTS or { strings, frets } (strings: open MIDI pitches, lowest first). */
    setTuning(next) {
      const t = typeof next === 'string' ? FRETBOARD_INSTRUMENTS[next] : next;
      if (!t?.strings?.length) return false;
      tuning = { strings: [...t.strings], frets: t.frets ?? 22 }; lit.clear(); capo = null; render(); return true;
    },
    getTuning: () => ({ strings: [...tuning.strings], frets: tuning.frets }),
    /** The capo at fret `c.fret` (string indices in `c.ignored` are not pressed): the neck then starts at it; null removes it. */
    setCapo(c) { capo = c && c.fret > 0 ? { fret: c.fret, ignored: [...(c.ignored ?? [])] } : null; render(); },
    getCapo: () => capo,
    /** Shows only `count` frets (0 = all), the first one `start` frets after the nut (or the capo): they fill the whole length, so the cells are bigger. */
    setView(next) { view = { count: Math.max(0, Math.floor(next?.count ?? 0)), start: Math.max(0, Math.floor(next?.start ?? 0)) }; render(); },
    getView: () => ({ count: windowCount(), start: windowStart(), all: !windowed() }),
    /** `fn({ count, start })` when the user moves the window with the − / + buttons. */
    onViewChange(fn) { onViewChange = fn; },
    setLayout(next) { layout = { ...layout, ...next }; render(); },
    getLayout: () => ({ ...layout }),
    /** Lights a position. `pos` = { string, fret } (string 0 = lowest); without it the lowest fitting position is used. Returns false when the note is off the neck. */
    noteOn(midi, velocity = 90, color = null, pos = null) {
      let p = pos;
      if (!p) { for (let s = tuning.strings.length - 1; s >= 0; s--) { /* highest string first = lowest fret */ const f = midi - tuning.strings[s]; if (f >= 0 && f <= tuning.frets) { p = { string: s, fret: f }; break; } } }
      if (!p) return false;
      lit.set(midi, { string: p.string, fret: p.fret, color }); drawLit(); return true;
    },
    noteOff(midi) { if (lit.delete(midi)) drawLit(); },
    allNotesOff() { if (lit.size) { lit.clear(); drawLit(); } },
    isLit: (midi) => lit.has(midi),
    setColors(next) { colors = { ...colors, ...next }; render(); },
    setReadOnly(on) { locked = !!on; },
    onNoteOn(fn) { onOn = fn; }, onNoteOff(fn) { onOff = fn; },
    /** The ⋮ button: `items` = [{ id, label, checked? } | { heading }] or a function returning them (called at each opening). */
    setMenu(items, onPick) { menuItems = items; menuPick = onPick ?? null; menuBtn.hidden = !items; closeMenu(); },
    refit() { render(); },
    destroy() { closeMenu(); ro?.disconnect(); root.remove(); },
  };
}
