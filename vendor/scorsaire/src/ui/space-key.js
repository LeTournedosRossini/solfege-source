/*
 * The space bar starts and stops playback, from anywhere on the page except where a space means something else: a text field, a list or a slider, a dialog or a menu that is
 * open, a key held down (auto-repeat), a space typed with a modifier or while composing text. A button that still has the focus after a click is NOT such a place (space would
 * press it again by accident): there the space bar plays, and Enter still presses the button.
 *   spaceTogglesPlayback(event)   → true when this key event is a transport space
 *   mountSpaceKey({ toggle })     → { destroy() }   (`toggle()` does the start / stop: it knows which screen is shown)
 */
const OWN_KEYS_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

export function spaceTogglesPlayback(e, doc = typeof document !== 'undefined' ? document : null) {
  if (!(e.key === ' ' || e.code === 'Space')) return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing || e.defaultPrevented) return false;
  const t = e.target;
  if (t?.isContentEditable) return false;
  if (OWN_KEYS_TAGS.has(String(t?.tagName ?? '').toUpperCase())) return false;
  if (t?.closest?.('[role="dialog"], [role="menu"], [role="listbox"], [role="menuitem"], [role="slider"], [role="textbox"], [data-lyrics-field], [data-inline-text]')) return false;
  if (doc?.querySelector?.('[aria-modal="true"]')) return false;
  return true;
}

export function mountSpaceKey({ toggle }) {
  const onKey = (e) => {
    if (!spaceTogglesPlayback(e)) return;
    e.preventDefault(); // no page scroll, and the focused button is not pressed
    toggle();
  };
  window.addEventListener('keydown', onKey);
  // a space that was not ours must not scroll the page either when a button is focused and the key is released: nothing to do, the default is already prevented on keydown
  return { destroy: () => window.removeEventListener('keydown', onKey) };
}
