/*
 * « Measure entry » mode for a tablet or a phone (decision of Jean, 2026-11-08): the writing is made big enough for ONE measure to fill the width of the screen, the measure of
 * ONE staff sits at the top, the entry tools stay at the bottom (the usual entry bar, the piano, the fretboard), and a small bar at the top moves on: ◀ ▶ next / previous measure,
 * ▲ ▼ staff above / below (a guitar opens on its tablature, the notation is one ▲ away), ✕ goes back to the page as it was. It is the real page, only enlarged and scrolled
 * (`ScoreView.setStaffSpace` changes the size without laying the score out again, `focusFrame` gives where the measure is): everything that works on the page — a tap on the staff,
 * the selection, the handles — works the same. The one-system view only (a wrapped score is cut into lines by its width).
 */
import { icon } from './icons.js';
import { focusStaffSpace, pickFocusStaff, stepIndex, nextZoom, FOCUS_ZOOMS, FIT_ZOOM } from './measure-focus-model.js';

const ZOOM_KEY = 'scorsaire.focusZoom'; // kept on the device: the size of the writing a finger is comfortable with
const readZoom = () => { try { const raw = localStorage.getItem(ZOOM_KEY); const v = raw === FIT_ZOOM ? FIT_ZOOM : Number(raw); return FOCUS_ZOOMS.includes(v) ? v : 1.5; } catch { return 1.5; } };
const zoomText = (z) => (z === FIT_ZOOM ? '↔' : `×${String(z).replace('.', ',')}`);

const BAR_CSS = 'position:fixed;left:0;right:0;top:0;z-index:3300;display:flex;align-items:center;gap:var(--btn-gap,4px);padding:6px 8px;box-sizing:border-box;background:var(--paper,#faf8f4);color:var(--ink,#111);border-bottom:1px solid var(--edge,#bbb);font:14px var(--ui-font,sans-serif)';
const BTN_CSS = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid var(--edge,#bbb);background:var(--field,#fff);color:inherit;cursor:pointer;padding:0';

/**
 * @param o.view        ScoreView of the page
 * @param o.app         Application (note entry, document)
 * @param o.scroller    the element that scrolls sideways
 * @param o.svg         () → the SVG element of the page
 * @param o.stickyWidth () → width of the sticky header (clef, key, time signature) that covers the left of the visible part
 * @param o.refresh     () → draws the page again (after a change of size)
 * @param o.staves      () → [{ id, type, trackId }] in the order of the page
 * @param o.staffName   (staffId) → text for the title of the bar
 */
export function mountMeasureFocus({ view, app, scroller, svg, stickyWidth = () => 0, refresh, staves, staffName = () => '', label, message = () => {} }) {
  let open = null; // { measureId, staffId, original: { space, left, top }, frame }
  let bar = null; let title = null; let zoomBtn = null;
  let zoom = readZoom(); // 1.5 until the person chooses (a finger needs more room between the lines)

  const measureIds = () => view.movement().masterbars.map((m) => m.id);
  const barHeight = () => (bar?.getBoundingClientRect().height ?? 56);

  /** Scrolls the page so that the measure sits at the top, centred in the width that the sticky header leaves free. */
  function align() {
    if (!open) return;
    const frame = view.focusFrame(open.measureId, open.staffId);
    if (!frame) return;
    open.frame = frame;
    const room = scroller.clientWidth - stickyWidth();
    const left = frame.x1 - stickyWidth() - Math.max(8, (room - (frame.x2 - frame.x1)) / 2);
    scroller.scrollLeft = Math.max(0, left);
    // sideways the scroller scrolls, up and down the PAGE does: the staff goes just under the bar of the mode
    const el = svg();
    void document.body.offsetHeight; // (the page has just grown with the size of the writing: its height must be known before scrolling)
    const pageTop = (el?.getBoundingClientRect().top ?? 0) + (window.scrollY || 0);
    open.top = Math.max(0, pageTop + frame.y1 - barHeight() - 8);
    window.scrollTo({ top: open.top, behavior: 'instant' });
    const ids = measureIds();
    title.textContent = `${label('focus.measure', { n: ids.indexOf(open.measureId) + 1 })} · ${staffName(frame.staff)}`;
  }

  const button = (name, key, run) => {
    const b = document.createElement('button');
    b.type = 'button'; b.style.cssText = BTN_CSS; b.title = label(key); b.setAttribute('aria-label', b.title); b.setAttribute('data-focus', name);
    b.append(icon(name === 'close' ? 'x' : `chevron-${{ prev: 'left', next: 'right', up: 'up', down: 'down' }[name]}`, { size: '1.3em' }));
    b.addEventListener('pointerdown', (e) => e.stopPropagation()); // (a press outside the score must not clear what is selected)
    b.addEventListener('click', run);
    return b;
  };

  /** The size of the writing for the measure now shown: it fills the width, times the zoom. */
  function spaceFor(frame, currentSpace) {
    const available = scroller.clientWidth - stickyWidth() - 24;
    return focusStaffSpace(available, (frame.x2 - frame.x1) / currentSpace, zoom);
  }

  /** Fitted zoom: the size is worked out again for the measure now shown (a measure that is wider than the screen makes the writing smaller). */
  function refit() {
    const frame = open && view.focusFrame(open.measureId, open.staffId);
    if (frame && view.setStaffSpace(spaceFor(frame, view.staffSpace()))) refresh();
  }

  function cycleZoom() {
    if (!open) return;
    zoom = nextZoom(zoom);
    try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* optional */ }
    zoomBtn.textContent = zoomText(zoom);
    const frame = view.focusFrame(open.measureId, open.staffId);
    if (frame && view.setStaffSpace(spaceFor(frame, view.staffSpace()))) refresh();
    align();
  }

  function go(dx, dy) {
    if (!open) return;
    if (dx) {
      const ids = measureIds();
      const next = stepIndex(ids.indexOf(open.measureId), dx, ids.length);
      open.measureId = ids[next];
      view.setChosenMeasure(open.measureId);
      if (zoom === FIT_ZOOM) refit();
    }
    if (dy) {
      const order = open.frame?.staves ?? [];
      const i = stepIndex(order.indexOf(open.staffId), dy, order.length);
      if (order[i]) open.staffId = order[i];
    }
    align();
  }

  function close() {
    if (!open) return;
    const { original } = open;
    open = null;
    bar?.remove(); bar = null;
    if (view.setStaffSpace(original.space)) refresh();
    scroller.scrollLeft = original.left;
    window.scrollTo({ top: original.page, behavior: 'instant' });
    document.documentElement.removeAttribute('data-measure-focus');
    scroller.dispatchEvent(new Event('scroll')); // the sliding header comes back
  }

  return {
    isOpen: () => !!open,
    /** Starts the mode on `measureId`; `staffId` is the staff the person was on (the starting staff is chosen from it). Returns false when it cannot start. */
    start({ measureId, staffId = null }) {
      if (open) close();
      if (view.layout().systems.length !== 1) { message(label('focus.needScroll')); return false; }
      const list = staves();
      const start = pickFocusStaff(list, staffId);
      const frame0 = view.focusFrame(measureId, start);
      if (!frame0) return false;
      const original = { space: view.staffSpace(), left: scroller.scrollLeft, page: window.scrollY || 0 };
      document.documentElement.setAttribute('data-measure-focus', '');
      scroller.dispatchEvent(new Event('scroll')); // the sliding header (clef, key, time) goes away: the measure gets the whole width
      const space = spaceFor(frame0, original.space);
      bar = document.createElement('div'); bar.style.cssText = BAR_CSS; bar.setAttribute('data-measure-focus-bar', ''); bar.setAttribute('role', 'toolbar');
      title = document.createElement('div'); title.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:var(--w-semi,600);text-align:center';
      zoomBtn = document.createElement('button'); zoomBtn.type = 'button'; zoomBtn.style.cssText = `${BTN_CSS};padding:0 10px;font:var(--w-bold,700) 15px var(--ui-font,sans-serif)`;
      zoomBtn.title = label('focus.zoom'); zoomBtn.setAttribute('aria-label', zoomBtn.title); zoomBtn.setAttribute('data-focus', 'zoom'); zoomBtn.textContent = zoomText(zoom);
      zoomBtn.addEventListener('pointerdown', (e) => e.stopPropagation()); zoomBtn.addEventListener('click', cycleZoom);
      bar.append(button('close', 'focus.close', close), button('prev', 'focus.prev', () => go(-1, 0)), button('next', 'focus.next', () => go(1, 0)), title, zoomBtn, button('up', 'focus.up', () => go(0, -1)), button('down', 'focus.down', () => go(0, 1)));
      document.body.append(bar);
      open = { measureId, staffId: start, original, frame: frame0 };
      if (view.setStaffSpace(space)) refresh();
      view.setChosenMeasure(measureId);
      if (app?.setNoteEntry && !app.noteEntry?.().active) app.setNoteEntry({ active: true }); // the entry tools appear at the bottom
      align();
      // again while the page settles (on a slow device the enlarged page is drawn late, and a scroll made before it has grown stops short: the wrong staff shows)
      for (const ms of [120, 400, 1000]) setTimeout(() => { if (open && open.measureId === measureId && open.staffId === start) align(); }, ms);
      return true;
    },
    close,
    /** After the page was drawn again: if the measure moved (a note changed its width) it is put back where it was. */
    realign() {
      if (!open) return;
      const frame = view.focusFrame(open.measureId, open.staffId);
      // fitted zoom: a note added to the measure made it wider than the screen: the writing shrinks (it never grows back inside the same measure)
      if (zoom === FIT_ZOOM && frame && frame.x2 - frame.x1 > scroller.clientWidth - stickyWidth() - 24 + 1) refit();
      const lost = open.top !== undefined && Math.abs((window.scrollY || 0) - open.top) > 2;
      if (!frame || !open.frame || frame.x1 !== open.frame.x1 || frame.x2 !== open.frame.x2 || lost) align();
    },
    go,
    destroy() { close(); },
  };
}
