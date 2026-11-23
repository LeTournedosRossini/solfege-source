/*
 * Mini transport: round buttons (play, stop, and the note-entry pencil) floating at the bottom left of the window, shown ONLY when the real play / stop buttons are out of sight.
 * Why: on a computer the transport sits in the page header (screens 1 and 2) or in the sync panel (screen 4); when a long score is followed during playback the page
 * scrolls and they leave the window, so a playback could no longer be stopped without scrolling back by hand.
 * The mini buttons own no logic: they press the real buttons (`.click()` works on a hidden one too), so every rule of the real transport applies (routing to the
 * sheets, the disabled state, play / pause on screen 4). Nothing is added to the flow of the page: the layer is fixed, above the dock, and hidden otherwise.
 */
import { applyIconName } from './icons.js';

/**
 * @param o.anchors () → { play, stop, entry? } | null: the real buttons of the screen being shown (null = none, nothing to mirror); `entry` = the note-entry button (it follows the same rule: shown when the real one is out of sight)
 * @param o.label   (key) → text
 * @returns {{ refresh(), destroy() }}
 */
export function mountMiniTransport({ anchors, label = (k) => k }) {
  const box = document.createElement('div');
  box.setAttribute('data-mini-transport', ''); box.setAttribute('data-dismiss-keep', ''); box.setAttribute('data-zoom-lock', ''); box.setAttribute('role', 'group');
  box.setAttribute('aria-label', label('player.mini'));
  // the same line, height and look as the round buttons that already float at the bottom left (piano, mixer, drum map, view, concert pitch): placed right after them
  box.style.cssText = 'display:none;position:fixed;z-index:61;left:calc(var(--sb-left,0px) + 10px);bottom:calc(var(--dock-h,0px) + var(--mixer-h,0px) + 10px);gap:10px;align-items:center;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  const make = (name, key, which) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('data-mini', which); b.title = label(key); b.setAttribute('aria-label', b.title);
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);width:var(--ui-target,44px);height:var(--ui-target,44px);border-radius:50%;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.25);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation';
    applyIconName(b, name);
    b.addEventListener('click', () => { const a = anchors(); a?.[which]?.click(); setTimeout(refresh, 0); });
    return b;
  };
  const play = make('play', 'player.play', 'play');
  const stop = make('square', 'player.stop', 'stop');
  // the note-entry pencil: same look as the real button (its drawing is copied), same rule (shown when the real one left the window), it presses the real one
  const entry = make('pencil', 'player.miniEntry', 'entry');
  entry.setAttribute('data-mini', 'entry');
  box.append(play, stop, entry);
  document.body.append(box);

  /** Is any part of the button inside the window (and is it displayed at all)? */
  const inView = (b) => {
    if (!b || !b.isConnected || b.offsetParent === null && getComputedStyle(b).position !== 'fixed') return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  };
  /** Right edge of the row of round buttons already floating at the bottom left (direct children of the page, fixed, in the bottom band of the window): the row is followed while the gaps stay small. 0 when there is none. */
  function clusterRight() {
    const row = [];
    for (const e of document.body.children) {
      if (e === box || e.tagName !== 'BUTTON' || getComputedStyle(e).position !== 'fixed') continue;
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.bottom > window.innerHeight - 140) row.push(r);
    }
    row.sort((a, b) => a.left - b.left);
    let right = 0;
    for (const r of row) { if (right && r.left - right > 24) break; right = Math.max(right, r.right); }
    return right;
  }
  /** Is the real button really displayed (not hidden by its screen, drawer or media rule) but scrolled out of the window? */
  const scrolledAway = (b) => Boolean(b && b.isConnected && b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden' && !inView(b));
  function refresh() {
    const a = anchors();
    const showTransport = Boolean(a?.play) && !inView(a.play) && !inView(a.stop);
    const showEntry = scrolledAway(a?.entry);
    play.style.display = stop.style.display = showTransport ? 'inline-flex' : 'none';
    entry.style.display = showEntry ? 'inline-flex' : 'none';
    const show = showTransport || showEntry;
    box.style.display = show ? 'flex' : 'none';
    if (!show) return;
    if (showEntry) {
      if (entry.dataset.from !== 'real' || !entry.firstChild || entry.dataset.copied !== String(a.entry.childNodes.length)) { entry.replaceChildren(...[...a.entry.childNodes].map((n) => n.cloneNode(true))); entry.dataset.from = 'real'; entry.dataset.copied = String(a.entry.childNodes.length); }
      entry.setAttribute('aria-pressed', a.entry.getAttribute('aria-pressed') ?? 'false');
      entry.style.outline = entry.getAttribute('aria-pressed') === 'true' ? '2px solid var(--btn-on-line,#b9b4a8)' : '';
      entry.disabled = Boolean(a.entry.disabled);
    }
    if (!showTransport) { const right0 = clusterRight(); box.style.left = right0 ? `${Math.round(right0 + 10)}px` : 'calc(var(--sb-left,0px) + 10px)'; return; }
    const right = clusterRight(); box.style.left = right ? `${Math.round(right + 10)}px` : 'calc(var(--sb-left,0px) + 10px)';
    play.disabled = Boolean(a.play.disabled); stop.disabled = Boolean(a.stop?.disabled);
    play.setAttribute('aria-pressed', a.play.getAttribute('aria-pressed') ?? 'false');
    play.style.outline = play.getAttribute('aria-pressed') === 'true' ? '2px solid var(--btn-on-line,#b9b4a8)' : '';
  }
  let queued = false;
  const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; refresh(); }); };
  window.addEventListener('scroll', soon, { passive: true, capture: true }); // capture: the score can scroll inside its own container
  window.addEventListener('resize', soon);
  const timer = setInterval(refresh, 400); // the real buttons change state (playing, disabled, screen) without telling anyone
  refresh();
  return { refresh, destroy() { clearInterval(timer); window.removeEventListener('scroll', soon, true); window.removeEventListener('resize', soon); box.remove(); } };
}
