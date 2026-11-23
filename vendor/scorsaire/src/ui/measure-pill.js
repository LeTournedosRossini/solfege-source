/*
 * The MEASURE PILL: on a tablet or a phone the readout of the top bar ("0:02 / 0:48 · measure 2") is the first thing to leave the bar when there is no room, so the
 * number of the measure the user points at is shown in a small pill pinned to the top left of the screen: it does not scroll with the score, it never takes the
 * touch, it costs no room in the layout. It shows the measure being PLAYED while the music plays, else the chosen measure / range (a selected note, the caret of the
 * writing mode…), else the measure under the playhead. Computers keep the top bar only.
 */
import { SHEET_QUERY } from './panel-mode.js';

/**
 * What the pill says. `where` = the playback position { movement, measure } or null ; `selection` = { from, to } (0-based) or null ; `movement` = the one the view shows.
 * @returns {string|null}
 */
export function measurePillText({ playing = false, where = null, selection = null, movement = 0, label }) {
  const here = where && where.movement === movement ? where.measure : null;
  if (playing && here !== null) return label('player.measure', { measure: here + 1 });
  if (selection) return selection.to > selection.from ? label('measurePill.range', { from: selection.from + 1, to: selection.to + 1 }) : label('player.measure', { measure: selection.from + 1 });
  return here !== null ? label('player.measure', { measure: here + 1 }) : null;
}

export function mountMeasurePill({ app, player = null, label = (k) => k, doc = document, win = window }) {
  const view = () => app.view('main');
  const el = doc.createElement('div');
  el.setAttribute('data-measure-pill', ''); el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:calc(var(--sb-left,0px) + 8px);top:max(8px,env(safe-area-inset-top));z-index:6;display:none;pointer-events:none;padding:2px 9px;border-radius:8px;border:1px solid var(--edge,#c9c4b8);background:var(--field,#fff);color:var(--ink,#1c1b1a);opacity:0.92;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);font-variant-numeric:tabular-nums;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.18)';
  doc.body.append(el);
  const media = typeof win.matchMedia === 'function' ? win.matchMedia(SHEET_QUERY) : null;
  let pending = false; let disposed = false;
  const draw = () => {
    pending = false;
    if (disposed) return;
    const v = view();
    if (!v || (media && !media.matches)) { el.style.display = 'none'; return; }
    const movement = v.movementIndex?.() ?? 0;
    const st = player?.state?.() ?? {};
    const text = measurePillText({ playing: !!st.playing, where: st.where ?? null, selection: app.selectedMeasures({ movement }), movement, label });
    el.textContent = text ?? '';
    el.style.display = text ? 'block' : 'none';
  };
  const refresh = () => { if (!pending && !disposed) { pending = true; queueMicrotask(draw); } };
  const offs = [];
  const v0 = view();
  if (v0) for (const sub of ['onSelectionChange', 'onRangeChange', 'onMeasureChange', 'onCellChange']) { const off = v0[sub]?.(refresh); if (off) offs.push(off); }
  const offEntry = app.onNoteEntryChange?.(refresh); if (offEntry) offs.push(offEntry);
  const offDoc = app.doc.subscribe(refresh); if (typeof offDoc === 'function') offs.push(offDoc);
  const offPlayer = player?.subscribe?.(refresh); if (typeof offPlayer === 'function') offs.push(offPlayer);
  media?.addEventListener?.('change', refresh);
  draw();
  return { refresh, destroy() { disposed = true; for (const off of offs) off(); media?.removeEventListener?.('change', refresh); el.remove(); } };
}
