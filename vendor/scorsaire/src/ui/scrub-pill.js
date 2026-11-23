/*
 * Scrub pill: a square button that shows a number; press and drag UP / DOWN to raise / lower it, tap for a small stepper (− value +).
 * Meant for one-finger use on tablets: the value is shown in a bubble BESIDE the finger (never above it, which the rising finger would
 * cover), the value is committed once, at release (`onCommit`); `onPreview` follows the drag. Keyboard: arrows ±1, Page keys ±10.
 * The pure helper `scrubValue` carries the rule (tested without DOM).
 */
const clampTo = (v, min, max) => Math.min(max, Math.max(min, v));

/** Value after dragging `dy` pixels UP (positive = up) from `start`: `pxPerStep` pixels per unit, speeding up with the distance. */
export function scrubValue({ start, dy, pxPerStep = 3, min, max, step = 1 }) {
  const eased = dy * (1 + Math.abs(dy) / 300);
  const raw = start + Math.round(eased / pxPerStep);
  return clampTo(step > 1 ? Math.round(raw / step) * step : raw, min, max); // a step bigger than 1: only multiples of it are shown while dragging
}

const DRAG_THRESHOLD = 6; // pixels before a press becomes a drag

/**
 * @param o.value initial value (null = unknown: shown with `format(null)`, a drag starts from `startAt`)
 * @param o.onCommit(v) called once at the end of a drag / at each stepper press / keyboard step
 * @param o.onTap() replaces the stepper when given (a tap without drag)
 * @param o.onLong() a press held still for `longMs` acts at once (then the release is ignored)
 * @param o.isLocked() true = refuse the gesture (`onLocked()` is called instead)
 * @returns {{ el, setValue(v), destroy() }}
 */
export function createScrubPill({ min, max, value = null, startAt = min, step = 1, pxPerStep = 3, format = (v) => (v === null ? '–' : String(v)), title = '', label = {},
  onCommit, onPreview = () => {}, onTap = null, onLong = null, longMs = 450, isLocked = () => false, onLocked = () => {} }) {
  let cur = value;
  const el = document.createElement('button');
  el.type = 'button'; el.title = title; el.setAttribute('aria-label', title);
  el.setAttribute('role', 'spinbutton'); el.setAttribute('aria-valuemin', String(min)); el.setAttribute('aria-valuemax', String(max));
  el.setAttribute('data-scrub-pill', '');
  el.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);padding:0 6px;font:var(--w-bold,700) 15px var(--ui-font,sans-serif);font-variant-numeric:tabular-nums;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:ns-resize';
  const show = (v) => { el.textContent = format(v); if (v !== null) el.setAttribute('aria-valuenow', String(v)); else el.removeAttribute('aria-valuenow'); };
  show(cur);

  let bubble = null, stepper = null, stopOutside = null;
  const closeStepper = () => { stepper?.remove(); stepper = null; stopOutside?.(); stopOutside = null; };
  const commit = (v) => { const next = clampTo(v, min, max); if (next !== cur || cur === null) { cur = next; show(cur); onCommit(next); } return next; };

  const placeBubble = (x, y) => {
    if (!bubble) return;
    const w = bubble.offsetWidth || 60, h = bubble.offsetHeight || 36;
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const left = x + 56 + w < vw ? x + 56 : x - 56 - w; // beside the finger: right when there is room, else left
    bubble.style.left = `${Math.max(4, left)}px`; bubble.style.top = `${Math.max(4, y - h / 2)}px`;
  };
  const showBubble = (text, x, y) => {
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.setAttribute('data-scrub-bubble', ''); bubble.setAttribute('data-zoom-lock', ''); bubble.setAttribute('aria-hidden', 'true');
      bubble.style.cssText = 'position:fixed;z-index:3500;pointer-events:none;background:#222;color:#fff;font:var(--w-bold,700) 20px var(--ui-font,sans-serif);font-variant-numeric:tabular-nums;padding:6px 12px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.35)';
      document.body.append(bubble);
    }
    bubble.textContent = text; placeBubble(x, y);
  };
  const hideBubble = () => { bubble?.remove(); bubble = null; };

  let drag = null;
  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (isLocked()) { onLocked(); e.preventDefault(); return; }
    closeStepper();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: cur ?? startAt, moved: false, v: cur, long: false };
    if (onLong) drag.timer = setTimeout(() => { if (drag && !drag.moved) { drag.long = true; setTimeout(onLong, 0); } }, longMs);
    try { el.setPointerCapture(e.pointerId); } catch { /* optional */ }
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id || drag.long) return;
    const dy = drag.y - e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, dy) < DRAG_THRESHOLD) return;
    drag.moved = true; clearTimeout(drag.timer);
    drag.v = scrubValue({ start: drag.start, dy, pxPerStep, min, max, step });
    show(drag.v); onPreview(drag.v);
    showBubble(format(drag.v), e.clientX, e.clientY);
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; clearTimeout(d.timer);
    try { el.releasePointerCapture(e.pointerId); } catch { /* optional */ }
    hideBubble();
    if (d.long) return; // the long press already acted
    // later, not now: the commit redraws the bar, and a `pointerup` still bubbling from a DETACHED button would be taken by the score as a
    // press on empty space (which clears the selection)
    if (d.moved) { if (d.v !== cur) setTimeout(() => commit(d.v), 0); else show(cur); }
    else if (onTap) setTimeout(onTap, 0); else openStepper();
  };
  const onCancel = () => { if (!drag) return; clearTimeout(drag.timer); drag = null; hideBubble(); show(cur); };

  function openStepper() {
    const r = el.getBoundingClientRect();
    stepper = document.createElement('div');
    stepper.setAttribute('data-scrub-stepper', ''); stepper.setAttribute('data-zoom-lock', ''); stepper.setAttribute('data-dismiss-keep', '');
    stepper.style.cssText = 'position:fixed;z-index:3500;display:flex;gap:var(--btn-gap,2px);align-items:center;padding:6px;background:var(--bar,var(--bg,#fff));border:1px solid rgba(0,0,0,.3);border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.3)';
    const mk = (text, t, delta) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = t; b.className = 'stp-b'; b.setAttribute('aria-label', t); b.setAttribute('data-scrub-step', delta > 0 ? 'up' : 'down'); b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px)'; b.addEventListener('click', () => { commit((cur ?? startAt) + delta); out.textContent = format(cur); }); return b; };
    const out = document.createElement('span'); out.className = 'stp-val'; out.textContent = format(cur); out.style.cssText = 'min-width:3.2em';
    stepper.append(mk('−', label.down ?? '−', -step), out, mk('+', label.up ?? '+', step));
    document.body.append(stepper);
    const w = stepper.offsetWidth, h = stepper.offsetHeight, vw = window.visualViewport?.width ?? window.innerWidth;
    stepper.style.left = `${Math.min(Math.max(4, r.left + r.width / 2 - w / 2), vw - w - 4)}px`;
    stepper.style.top = `${r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6}px`;
    const away = (ev) => { if (!stepper?.contains(ev.target) && ev.target !== el) closeStepper(); };
    const esc = (ev) => { if (ev.key === 'Escape') closeStepper(); };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc, true);
    stopOutside = () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('keydown', (e) => {
    const k = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: step * 10, PageDown: -step * 10 }[e.key];
    if (k === undefined) return;
    if (isLocked()) { onLocked(); e.preventDefault(); return; }
    e.preventDefault(); commit((cur ?? startAt) + k);
  });

  return {
    el,
    setValue(v) { if (drag && !drag.long) return; // (a long press has already acted: its result may be shown at once)
      cur = v; show(cur); if (stepper) stepper.querySelector('span').textContent = format(cur); },
    close: closeStepper,
    destroy() { closeStepper(); hideBubble(); },
  };
}
