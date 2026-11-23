/*
 * Close a transient panel or dialog when the user presses OUTSIDE it (decided with Jean, 15/10/2026). The press is observed in the capture
 * phase, so the panel closes before the press does its own job (a tap on the score then selects normally).
 *
 * Never dismissed by a press on: the panel itself; another dialog (`role="dialog"`: a picker opened from a panel, a staff properties window
 * opened from the tracks panel…); an open choice menu (`.cm-layer`); anything marked `data-dismiss-keep` (the buttons that open the panel, the
 * context bar). The note entry bar fixed at the bottom of the screen and the transport bar are not panels and do not use this.
 */
const KEEP = '.cm-layer, [role="dialog"], [data-dismiss-keep]';

/**
 * @param getElement () => the panel element, or null when closed (a detached element counts as closed)
 * @param onDismiss  called once per outside press while the panel is open
 * @returns a function that removes the listener
 */
export function dismissOnOutside(getElement, onDismiss) {
  if (typeof document === 'undefined') return () => {};
  const handler = (e) => {
    const el = getElement();
    if (!el || !el.isConnected) return;
    const target = e.target;
    if (!(target instanceof Element) || el.contains(target)) return;
    if (target.closest(KEEP) && !el.contains(target.closest(KEEP))) {
      // a press inside ANOTHER dialog / menu / keep-zone: not outside (nested dialogs). The panel itself is also a [role=dialog].
      return;
    }
    onDismiss(e);
  };
  document.addEventListener('pointerdown', handler, true);
  return () => document.removeEventListener('pointerdown', handler, true);
}
