/*
 * Visual hints of what a button does.
 *  - cyclic button (2 to 4 states): one short stretch of the button's own border per state, in a corner (2: top-left, top-right; 3: + bottom-right; 4: + bottom-left),
 *    each state with its own colour; the current state's tick is full and bright, the others are dim. The button itself shows only the current state.
 *  - two-action button (short press / long press): a short bar under the middle of the button.
 * `cornerPlan` and `STATE_COLORS` are pure data (testable without a DOM); only `markCyclic` / `markLongPress` touch the DOM.
 */
export const CORNERS = Object.freeze(['top-left', 'top-right', 'bottom-right', 'bottom-left']);
export const STATE_COLORS = Object.freeze(['var(--sel-edge,#2d78ff)', '#e8590c', '#2f9e44', '#9c36b5']);

/** Corner of each state of a cyclic button with `count` states (2..4): an array of corner names, one per state. */
export function cornerPlan(count) {
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new RangeError(`cyclic button: 2 to 4 states, got ${count}`);
  return CORNERS.slice(0, count);
}

// The tick of a state hugs the OUTER BORDER of the button, as the amber corner of the read-only containers hugs the frame: a box laid exactly over the button's
// border box (same rounded corners), with only the two sides of its corner coloured, cut to that corner so only a short L-shaped stretch of the border shows.
const SIDES = { 'top-left': ['top', 'left'], 'top-right': ['top', 'right'], 'bottom-right': ['bottom', 'right'], 'bottom-left': ['bottom', 'left'] };
const CLIP = { 'top-left': 'inset(0 58% 58% 0)', 'top-right': 'inset(0 0 58% 58%)', 'bottom-right': 'inset(58% 0 0 58%)', 'bottom-left': 'inset(58% 58% 0 0)' };

const ensureRelative = (button) => { if (!button.style.position) button.style.position = 'relative'; }; // not getComputedStyle: the button may not be attached yet
const clearHints = (button, name) => { for (const el of [...button.querySelectorAll(`[data-hint="${name}"]`)]) el.remove(); };

/** Mark `button` as cyclic: `count` states, `current` = index of the state shown now. Safe to call again after a state change. */
export function markCyclic(button, count, current) {
  const plan = cornerPlan(count);
  ensureRelative(button);
  clearHints(button, 'cyclic');
  plan.forEach((corner, i) => {
    const tick = document.createElement('span');
    tick.setAttribute('data-hint', 'cyclic'); tick.setAttribute('aria-hidden', 'true');
    const on = i === current;
    const [v, h] = SIDES[corner];
    tick.style.cssText = `position:absolute;inset:-1px;box-sizing:border-box;border-radius:inherit;border:${on ? 3 : 2}px solid transparent;border-${v}-color:${STATE_COLORS[i]};border-${h}-color:${STATE_COLORS[i]};clip-path:${CLIP[corner]};opacity:${on ? 1 : 0.4};pointer-events:none`;
    button.append(tick);
  });
  button.setAttribute('data-cyclic', `${current + 1}/${count}`);
  return button;
}

/** Mark `button` as doing one thing on a short press and another on a long press. */
export function markLongPress(button) {
  ensureRelative(button);
  clearHints(button, 'long');
  const bar = document.createElement('span');
  bar.setAttribute('data-hint', 'long'); bar.setAttribute('aria-hidden', 'true');
  bar.style.cssText = 'position:absolute;bottom:3px;left:50%;width:14px;height:3px;margin-left:-7px;border-radius:2px;background:currentColor;opacity:.55;pointer-events:none';
  button.append(bar);
  button.setAttribute('data-long-press', '');
  return button;
}

/**
 * Same hint with BOTH actions shown on a single icon: a small grey dot (short press) to the left of the grey bar (long press) under the button.
 */
export function markShortLongPress(button) {
  markLongPress(button);
  clearHints(button, 'short');
  const dot = document.createElement('span');
  dot.setAttribute('data-hint', 'short'); dot.setAttribute('aria-hidden', 'true');
  // the pair (dot, gap 4, bar 14 = 22 px) is centred on the button: from the dot's left edge to the bar's right edge
  dot.style.cssText = 'position:absolute;bottom:3px;left:50%;width:4px;height:4px;margin-left:-11px;border-radius:50%;background:currentColor;opacity:.55;pointer-events:none';
  const bar = button.querySelector('[data-hint="long"]'); if (bar) bar.style.marginLeft = '-3px';
  button.append(dot);
  return button;
}

/**
 * Wire a short press / long press button. A short press acts on release; a long press acts as soon as `delay` ms are over, then the button is ignored until
 * it is released. The action of a long press may redraw the bar under the finger: the release that follows is swallowed so it cannot reach the score
 * (it would clear the selection). Returns nothing; the button should be marked with `markLongPress` or `markTwoActions`.
 */
export function bindShortLong(button, { onShort, onLong, delay = 450 }) {
  let timer = null; let down = false; let fired = false;
  const swallowRelease = () => {
    const stop = (ev) => { ev.stopPropagation(); };
    const onUp = (ev) => { stop(ev); setTimeout(off, 300); };
    const onClick = (ev) => { stop(ev); off(); };
    function off() { window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onUp, true); window.removeEventListener('click', onClick, true); }
    // the click that follows the release arrives right after it (and may never come when the bar was redrawn): the swallowing stops 300 ms after the release,
    // so a pending listener can never eat the NEXT tap
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('click', onClick, true);
    setTimeout(off, 15000);
  };
  button.style.touchAction = 'none'; button.style.userSelect = 'none'; button.style.webkitTouchCallout = 'none';
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  button.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    down = true; fired = false;
    timer = setTimeout(() => { timer = null; fired = true; swallowRelease(); onLong(); }, delay);
  });
  const end = (e) => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (!down) return;
    down = false;
    if (e.type === 'pointerup' && !fired) setTimeout(onShort, 0);
  };
  button.addEventListener('pointerup', end); button.addEventListener('pointerleave', end); button.addEventListener('pointercancel', end);
}

/**
 * Mark a button that shows TWO icons side by side: a dot under the first (short press) and a bar under the second (long press).
 * `first` and `second` are the two icon elements already in the button.
 */
export function markTwoActions(button, first, second) {
  ensureRelative(button);
  clearHints(button, 'two');
  const under = (el, css) => { const m = document.createElement('span'); m.setAttribute('data-hint', 'two'); m.setAttribute('aria-hidden', 'true'); m.style.cssText = `position:absolute;bottom:3px;pointer-events:none;${css}`; button.append(m); return m; };
  const place = () => {
    const b = button.getBoundingClientRect();
    for (const [el, css] of [[first, 'width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.7'], [second, 'width:14px;height:3px;border-radius:2px;background:currentColor;opacity:.55']]) {
      const r = el.getBoundingClientRect(); const m = under(el, css);
      const w = parseFloat(m.style.width);
      m.style.left = `${r.left - b.left + r.width / 2 - w / 2}px`;
    }
  };
  // positions need the layout: place once the button is in the page
  requestAnimationFrame(() => { if (button.isConnected) { clearHints(button, 'two'); place(); } });
  button.setAttribute('data-two-actions', '');
  return button;
}

/**
 * Marks the DEPTH of a drawer on its bar (the bar, not a button): a filet in the top-left corner while the buttons open a deeper level (a menu), a filet in the
 * bottom-left corner on the last level (the buttons act). `level` = 'menu' | 'page' | null (no mark).
 */
export function markDrawerLevel(bar, level) {
  for (const el of [...bar.querySelectorAll('[data-hint="drawer"]')]) el.remove();
  bar.removeAttribute('data-drawer-level');
  if (!level) return bar;
  // a bar positioned by a style sheet (fixed, absolute) keeps its position: only a static bar becomes the anchor of the filets
  const pos = bar.style.position || getComputedStyle(bar).position;
  if (!pos || pos === 'static') bar.style.position = 'relative';
  const menu = level === 'menu';
  // two filets: both top corners (blue) on a menu, both bottom corners (green) on the last level: one stays visible wherever the bar is placed
  const corners = menu ? ['top:-1px;left:-1px;border-top:3px solid var(--sel-edge,#2d78ff);border-left:3px solid var(--sel-edge,#2d78ff);border-radius:8px 0 0 0', 'top:-1px;right:-1px;border-top:3px solid var(--sel-edge,#2d78ff);border-right:3px solid var(--sel-edge,#2d78ff);border-radius:0 8px 0 0']
    : ['bottom:-1px;left:-1px;border-bottom:3px solid #2f9e44;border-left:3px solid #2f9e44;border-radius:0 0 0 8px', 'bottom:-1px;right:-1px;border-bottom:3px solid #2f9e44;border-right:3px solid #2f9e44;border-radius:0 0 8px 0'];
  for (const css of corners) {
    const tick = document.createElement('span');
    tick.setAttribute('data-hint', 'drawer'); tick.setAttribute('aria-hidden', 'true');
    tick.style.cssText = `position:absolute;${css};width:12px;height:12px;pointer-events:none`;
    bar.append(tick);
  }
  bar.setAttribute('data-drawer-level', level);
  return bar;
}
