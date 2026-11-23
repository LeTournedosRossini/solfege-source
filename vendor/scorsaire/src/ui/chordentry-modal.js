/*
 * Fenêtre de saisie des symboles d'accord (étape 5, tranche 6) — DOM. Façon CCE : trois grilles de boutons (fondamentales | qualités du
 * dictionnaire de l'œuvre | basse « — » + 12 notes), puis N.C. / % / %% / effacer / ÷2 / rétablir. Aucun champ de texte. Chaque bouton agit
 * tout de suite par UNE intention de l'Application (donc une transaction annulable) ; ◀ ▶ déplacent seulement la case active (état de la vue).
 * Tablette d'abord : boutons ≥ 44 px ; sur téléphone (≤ 600 px) la fenêtre sort du bas de l'écran. Pas de travail d'apparence ici.
 */
import { glyphRowIcon } from './mark-icons.js';
import { isPhone } from './device-class.js';
import { markLongPress } from './button-behavior.js';
import { PID } from '../model/pid.js';
import { entryRoots, createChordEntry } from '../model/chordentry.js';
import { identifierDisplayText } from '../model/chordquality.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { keepClear } from './keep-clear.js';
import { symbolAtCell } from './chordentry-intents.js';

export function mountChordEntry(view, app, { label = (k) => k, doc = app.doc, onSettings = null, glyphs = null } = {}) {
  const panel = document.createElement('div');
  panel.setAttribute('data-chord-entry', '');
  panel.setAttribute('data-zoom-lock', '');
  panel.setAttribute('role', 'dialog');
  panel.style.cssText = 'display:none;position:fixed;z-index:50;background:var(--field,#fff);color:var(--ink,#111);border:1px solid var(--edge,#888);box-shadow:0 2px 12px rgba(0,0,0,.3);font:14px var(--ui-font,sans-serif);padding:8px;box-sizing:border-box;max-height:70vh;overflow:auto';
  let lastKey = null;
  document.body.append(panel);

  const prefs = () => createChordEntry(app.preferences.get('chordEntry'));
  const setPref = (patch) => app.preferences.set('chordEntry', { ...prefs(), ...patch });
  let message = '';

  const btn = (text, title, onClick, { on = false, wide = false } = {}) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.title = title ?? text; b.setAttribute('aria-label', title ?? text);
    b.style.cssText = `min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);margin:2px;${wide ? 'padding:0 10px;' : ''}${on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`;
    b.addEventListener('click', onClick);
    return b;
  };
  /** Note-names toggle, square: "C/do" with the system in use in bold. */
  const namingBtn = (p, title) => {
    const b = btn('', title, () => setPref({ naming: p.naming === 'latin' ? 'anglo' : 'latin' }));
    const part = (text, on) => { const sp = document.createElement('span'); sp.textContent = text; sp.style.cssText = on ? 'font-weight:800' : 'font-weight:400;opacity:.6'; return sp; };
    b.append(part('C', p.naming !== 'latin'), document.createTextNode('/'), part('do', p.naming === 'latin'));
    b.style.cssText += ';padding:0;font-size:13px;white-space:nowrap';
    return b;
  };
  let slotsOpen = false;
  const LONG_PRESS_MS = 500;
  /** Slot-count button (cells in this measure) and its row of options: a tap sets this measure, a long press sets every measure. */
  const slotsUi = (addr, count) => {
    const opener = btn(String(count), label('chordEntry.slots'), () => { slotsOpen = !slotsOpen; draw(); }, { on: slotsOpen });
    opener.setAttribute('data-slots-open', ''); opener.style.fontWeight = '700';
    const row = document.createElement('div');
    row.setAttribute('data-slots-row', '');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;align-items:center';
    if (slotsOpen) {
      const hint = document.createElement('span'); hint.textContent = label('chordEntry.slotsHint'); hint.style.cssText = 'font-size:12px;opacity:.7;margin:0 6px';
      row.append(...app.slotOptions(addr).map((n) => {
        const b = btn(String(n), label('chordEntry.slotsN', { n }), () => {}, { on: n === count });
        b.setAttribute('data-slots', String(n)); b.style.fontWeight = '700'; markLongPress(b);
        let timer = null, fired = false;
        b.addEventListener('pointerdown', () => { fired = false; timer = setTimeout(() => { fired = true; slotsOpen = false; run(() => app.setAllSlots(addr, n)); }, LONG_PRESS_MS); });
        const stop = () => { clearTimeout(timer); timer = null; };
        b.addEventListener('pointerup', stop); b.addEventListener('pointercancel', stop); b.addEventListener('pointerleave', stop);
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        b.style.cssText += ';touch-action:manipulation;-webkit-touch-callout:none;user-select:none';
        b.addEventListener('click', () => { if (fired) { fired = false; return; } slotsOpen = false; run(() => app.setMeasureSlots(addr, n)); });
        return b;
      }), hint);
    }
    return { opener, row };
  };
  const section = (title, children, cols) => {
    const box = document.createElement('div');
    // the root block keeps the width of its three columns (its share of the free width made a wide gap before the qualities, and none between the qualities and the bass)
    box.style.cssText = `flex:${cols === 0 ? '3 1 260px' : title === label('chordEntry.root') ? '0 0 max(147px, calc(var(--ui-target,44px) * 3 + 18px))' : '1 1 150px;margin-left:12px'};min-width:140px`;
    const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'font-weight:var(--w-semi,600);margin:2px';
    const grid = document.createElement('div'); grid.style.cssText = `display:flex;flex-wrap:wrap;${cols ? `max-width:${cols * 50}px` : ''}`;
    grid.append(...children);
    box.append(h, grid);
    return box;
  };

  /** Exécute une intention ; une erreur de saisie (ChordEntryError) s'affiche dans la fenêtre au lieu de planter. */
  const run = (fn) => {
    try { message = ''; fn(); } catch (e) { if (e.name === 'ChordEntryError' || e.name === 'Error') message = e.code === 'no-root' ? label('chordEntry.needRoot') : e.message; else throw e; }
    draw();
  };

  // computers: the window sits right UNDER the chord staff, centred on the active cell (above it when there is no room below, scrolling inside when
  // neither side is tall enough), so the chords are typed where they are written. The old bottom-right placement stays as a device setting.
  const isNarrow = () => isPhone();
  const underStaff = () => !isNarrow() && prefs().placement !== 'bottom';
  const activeRect = () => {
    const addr = view.activeCell(); const svg = document.querySelector('svg[role="img"]');
    if (!addr || !svg) return null;
    // the rectangle of the active cell AS DISPLAYED: the SVG is drawn larger or smaller than its own units (staff size, zoom), so zones in units cannot be added to its corner
    const shown = document.querySelector('[data-cells-overlay] rect[data-active]')?.getBoundingClientRect();
    if (shown && shown.width > 0) return { x1: shown.left, y1: shown.top, x2: shown.right, y2: shown.bottom };
    const mine = view.cellZones().find((z) => z.staffId === addr.staffId && z.measureId === addr.measureId && z.cell === addr.cell);
    if (!mine) return null;
    const o = svg.getBoundingClientRect(); const vb = svg.viewBox?.baseVal;
    const kx = vb?.width ? o.width / vb.width : 1; const ky = vb?.height ? o.height / vb.height : 1;
    return { x1: o.left + mine.x1 * kx, y1: o.top + mine.y1 * ky, x2: o.left + mine.x2 * kx, y2: o.top + mine.y2 * ky };
  };
  let kept = null; // { left, width } of the window as last placed under the staff; forgotten when it closes
  const placeUnder = () => {
    const a = activeRect(); if (!a) return false;
    const vv = window.visualViewport;
    const dock = document.querySelector('[data-dock]')?.getBoundingClientRect();
    const vis = { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0, right: (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth), bottom: Math.min((vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight), dock && dock.height > 0 ? dock.top : Infinity) };
    const width = Math.min(640, vis.right - vis.left - 16);
    panel.style.right = 'auto'; panel.style.bottom = 'auto'; panel.style.width = `${width}px`; panel.style.maxHeight = '70vh'; panel.style.borderRadius = '8px';
    // the window stays where it is while the active cell is well inside its width (stepping with ◀ ▶ must not move the buttons under the finger);
    // it is centred again under the cell only when the cell comes near an edge of the window or leaves it
    const clampLeft = (x) => Math.max(vis.left + 8, Math.min(x, vis.right - width - 8));
    const centre = (a.x1 + a.x2) / 2; const edge = Math.min(120, width / 4);
    let left = clampLeft(centre - width / 2);
    if (kept && centre > kept.left + edge && centre < kept.left + width - edge && Math.abs(kept.width - width) < 1) left = clampLeft(kept.left);
    kept = { left, width };
    panel.style.left = `${left}px`;
    const h = panel.getBoundingClientRect().height; const gap = 6;
    const below = vis.bottom - (a.y2 + gap); const above = a.y1 - gap - vis.top;
    if (h <= below) panel.style.top = `${a.y2 + gap}px`;
    else if (h <= above) panel.style.top = `${a.y1 - gap - h}px`;
    else if (below >= above) { panel.style.top = `${a.y2 + gap}px`; panel.style.maxHeight = `${Math.max(160, below)}px`; }
    else { panel.style.top = `${vis.top + 4}px`; panel.style.maxHeight = `${Math.max(160, above - 4)}px`; }
    return true;
  };
  const reposition = () => { if (panel.style.display !== 'none' && underStaff()) placeUnder(); };
  window.addEventListener('scroll', reposition, true); window.addEventListener('resize', reposition);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reposition) : null; ro?.observe(panel);
  const placePanel = () => {
    if (underStaff() && placeUnder()) return;
    const narrow = isNarrow();
    panel.style.cssText += narrow
      ? ';left:0;right:0;bottom:0;top:auto;width:auto;max-height:50vh;border-radius:12px 12px 0 0'
      : ';left:auto;right:12px;bottom:12px;top:auto;width:min(640px,calc(100vw - 24px));border-radius:8px';
  };

  // the window never hides the cell being edited nor the diagrams above the chords of its measure: it moves to the side that has room
  const cellAnchor = () => {
    if (underStaff()) return null; // placed under the staff: nothing to avoid
    const addr = view.activeCell();
    const svg = document.querySelector('svg[role="img"]');
    if (!addr || !svg) return null;
    const zones = view.cellZones().filter((z) => z.staffId === addr.staffId && z.measureId === addr.measureId);
    const mine = zones.find((z) => z.cell === addr.cell);
    if (!mine) return null;
    const o = svg.getBoundingClientRect();
    const a = { x1: o.left + mine.x1, y1: o.top + mine.y1, x2: o.left + mine.x2, y2: o.top + mine.y2 };
    const mx1 = o.left + Math.min(...zones.map((z) => z.x1)); const mx2 = o.left + Math.max(...zones.map((z) => z.x2));
    for (const node of svg.querySelectorAll('[data-role="fret-diagram"]')) {
      const r = node.getBoundingClientRect();
      if (r.right >= mx1 && r.left <= mx2 && r.bottom <= a.y2 + 4) { a.x1 = Math.min(a.x1, r.left); a.y1 = Math.min(a.y1, r.top); a.x2 = Math.max(a.x2, r.right); }
    }
    return a;
  };
  const clear = keepClear(panel, cellAnchor);

  const draw = () => {
    const addr = view.activeCell();
    if (!addr) { lastKey = null; kept = null; panel.style.display = 'none'; panel.replaceChildren(); return; }
    let ctx; let cells;
    try { cells = app.cellsOf(addr); ctx = { cells, staff: doc.find(addr.staffId) }; } catch { view.setActiveCell(null); return; }
    const movement = doc.movementOf(ctx.staff);
    const mi = movement.masterbars.findIndex((b) => b.id === addr.measureId);
    const measure = ctx.staff.voices[0].measures[mi];
    const cellInfo = cells[addr.cell];
    const symbol = symbolAtCell(measure, cellInfo);
    const special = symbol?.props[PID.CHORD_SPECIAL] ?? 'none';
    const root = special === 'none' ? symbol?.props[PID.CHORD_ROOT] : null;
    const quality = symbol?.props[PID.CHORD_QUALITY] ?? '';
    const bass = symbol?.props[PID.CHORD_BASS] ?? null;
    const p = prefs();
    const same = (a, b) => a && b && a.step === b.step && (a.alter ?? 0) === (b.alter ?? 0);

    // en-tête : position, ◀ ▶, préférences d'affichage, fermer
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:2px';
    const title = document.createElement('strong');
    title.textContent = label('chordEntry.position', { measure: mi + 1, cell: addr.cell + 1, cells: cells.length });
    title.style.cssText = 'flex:1 1 auto;margin:0 6px';
    head.append(
      btn('◀', label('chordEntry.prev'), () => { const n = app.neighbourCell(addr, -1); if (n) view.setActiveCell(n); }),
      btn('▶', label('chordEntry.next'), () => { const n = app.neighbourCell(addr, 1); if (n) view.setActiveCell(n); }),
      title,
      btn(p.accidental === 'sharp' ? '♯' : '♭', label('chordEntry.accidental'), () => setPref({ accidental: p.accidental === 'sharp' ? 'flat' : 'sharp' }), { wide: true }),
      namingBtn(p, label('chordEntry.naming')),
      onSettings ? btn('⚙', label('chordEntry.settings'), () => onSettings()) : null,
      btn('✕', label('chordEntry.close'), () => view.setActiveCell(null)),
    );

    const roots = entryRoots(p);
    const rootBtns = roots.map((r) => btn(r.label, r.label, () => run(() => app.setCellChord(addr, { root: { step: r.step, alter: r.alter } })), { on: same(root, r) }));
    const dict = app.chordQualities();
    const qualityBtns = dict.qualities.map((q) => {
      const text = (q.shown ?? identifierDisplayText(q.id)) || (q.id === '' ? 'M' : q.id);
      const b = btn(text, q.id === '' ? label('chordEntry.major') : q.id, () => run(() => app.setCellChord(addr, { quality: q.id })), { on: quality === q.id && !!symbol && special === 'none' });
      b.style.flex = '1 1 auto'; // each row stretches to the full width (justified)
      return b;
    });
    const bassBtns = [
      btn('—', label('chordEntry.noBass'), () => run(() => app.setCellChord(addr, { bass: null })), { on: !!symbol && !bass && special === 'none' }),
      ...roots.map((r) => btn(r.label, r.label, () => run(() => app.setCellChord(addr, { bass: { step: r.step, alter: r.alter } })), { on: same(bass, r) })),
    ];
    const grids = document.createElement('div');
    grids.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);margin-top:4px';
    grids.append(section(label('chordEntry.root'), rootBtns, 3), section(label('chordEntry.quality'), qualityBtns, 0), section(label('chordEntry.bass'), bassBtns, 3));

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px';
    const slots = slotsUi(addr, cells.length);
    actions.append(
      slots.opener,
      btn('N.C.', label('chordEntry.noChord'), () => run(() => app.setCellNoChord(addr)), { wide: true, on: special === 'noChord' }),
      btn('%', label('chordEntry.repeat1'), () => run(() => app.setMeasureRepeat(addr)), { wide: true, on: special === 'repeat1' }),
      btn('%%', label('chordEntry.repeat2'), () => run(() => app.setTwoMeasureRepeat(addr)), { wide: true, on: special === 'repeat2' }),
      btn(label('chordEntry.erase'), label('chordEntry.erase'), () => run(() => app.eraseCell(addr)), { wide: true }),
      btn('÷2', label('chordEntry.subdivide'), () => run(() => app.subdivideCell(addr)), { wide: true }),
      btn(label('chordEntry.restore'), label('chordEntry.restore'), () => run(() => app.restoreGrid(addr)), { wide: true }),
    );
    // play offset: the symbol keeps its written place but sounds earlier (the "Avance" row) or later (the "Retard" row). Each shift is written with the note value it moves by
    // (Bravura glyph: sixteenth, eighth, dotted eighth, quarter); the two rows together are as high as one ordinary button, the "0" button spans both
    const offsets = document.createElement('div');
    offsets.style.cssText = 'display:grid;grid-template-columns:auto repeat(4,auto) auto;grid-auto-rows:calc(var(--ui-target,44px) * 0.64);align-items:stretch;justify-content:start;gap:2px;margin:2px';
    const cur = symbol?.props[PID.PLAY_OFFSET] ?? null;
    const NOTE_OF = { '1/16': ['metNote16thUp'], '1/8': ['metNote8thUp'], '3/16': ['metNote8thUp', 'metAugmentationDot'], '1/4': ['metNoteQuarterUp'] };
    const rowLabel = (key, row) => { const l = document.createElement('span'); l.textContent = label(key); l.style.cssText = `grid-row:${row};grid-column:1;font-size:12px;align-self:center;margin:0 6px;white-space:nowrap`; return l; };
    offsets.append(rowLabel('chordEntry.offsetAdvance', 1), rowLabel('chordEntry.offsetDelay', 2));
    const small = (b) => { b.style.minWidth = 'calc(var(--ui-target,44px) * 1.35)'; b.style.minHeight = '0'; b.style.margin = '0'; b.style.padding = '0 3px'; return b; };
    [[-1, 1], [1, 2]].forEach(([sign, row]) => {
      // "Avance": the longest shift on the left, the shortest next to the 0; "Retard": the shortest next to the 0, the longest on the right
      const values = [[1, 16], [1, 8], [3, 16], [1, 4]];
      (sign < 0 ? values.slice().reverse() : values).forEach(([n, d], col) => {
        const o = [sign * n, d];
        const on = !!cur && cur[0] === o[0] && cur[1] === o[1];
        const b = small(btn('', `${label(sign < 0 ? 'chordEntry.offsetEarly' : 'chordEntry.offsetLate')} : ${n}/${d}`, () => run(() => app.setPlayOffset(addr, o)), { on: symbol ? on : false }));
        b.style.minWidth = 'calc(var(--ui-target,44px) * 1.35)'; b.style.margin = '0'; b.style.padding = '0 3px'; b.style.gridRow = String(row); b.style.gridColumn = String(col + 2);
        const icon = glyphs ? glyphRowIcon(glyphs, NOTE_OF[`${n}/${d}`], { side0: 3.6, px: 17, gap: 30 }) : null;
        if (icon) {
          const sg = document.createElement('span'); sg.textContent = sign < 0 ? '−' : '+'; sg.style.cssText = 'font-weight:var(--w-semi,600);font-size:13px;line-height:1';
          b.style.display = 'inline-flex'; b.style.alignItems = 'center'; b.style.justifyContent = 'center'; b.style.gap = '0';
          b.append(sg, icon);
        } else b.textContent = `${sign < 0 ? '−' : '+'}${n}/${d}`;
        offsets.append(b);
      });
    });
    const none = btn('0', label('chordEntry.offsetNone'), () => run(() => app.setPlayOffset(addr, null)), { on: symbol ? !cur : false });
    none.style.margin = '0'; none.style.minHeight = '0'; none.style.minWidth = 'calc(var(--ui-target,44px) * 1.35)'; none.style.padding = '0 3px'; none.style.gridRow = '1 / span 2'; none.style.gridColumn = '6';
    offsets.append(none);
    // always shown (a stable window); greyed until the cell holds a chord
    if (!symbol) { for (const b of offsets.querySelectorAll('button')) { b.disabled = true; b.style.opacity = '0.4'; } }
    const status = document.createElement('div');
    status.setAttribute('data-chord-entry-message', '');
    status.style.cssText = 'min-height:18px;color:var(--danger-ink,#b00020);margin:2px 4px';
    status.textContent = message;

    // en-tête, actions et message d'abord (toujours visibles en haut de la fenêtre), puis les grilles qui défilent
    const top = document.createElement('div');
    top.style.cssText = 'position:sticky;top:-8px;background:var(--field,#fff);z-index:1;padding-top:8px';
    top.append(head, actions, ...(special === 'none' ? [offsets] : []), ...(slotsOpen ? [slots.row] : []), status);
    panel.replaceChildren(top, grids);
    panel.style.display = 'block';
    placePanel();
    clear.apply();
    // téléphone : la fenêtre sort du bas, la case active est remontée dans la moitié haute pour rester visible (seulement quand la case change)
    const key = `${addr.staffId}:${addr.measureId}:${addr.cell}`;
    if (key !== lastKey && isPhone()) document.querySelector('[data-cells-overlay] rect[data-active]')?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
    lastKey = key;
  };

  const offCell = view.onCellChange(draw);
  const offDoc = doc.subscribe(draw);
  const offPrefs = app.preferences.subscribe(draw);
  draw();
  // a press outside the window (not on the context bar, not on another dialog) closes it: the active cell is deactivated
  const offOutside = dismissOnOutside(() => (panel.style.display !== 'none' ? panel : null), () => view.setActiveCell(null));
  return { refresh: draw, destroy() { clear.destroy(); window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); ro?.disconnect(); offCell(); offDoc(); offPrefs(); offOutside(); panel.remove(); } };
}
