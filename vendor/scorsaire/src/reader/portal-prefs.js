/*
 * What the school portal keeps on the device and the pages of Scorsaire (same domain, so the same localStorage) can read: the SIZE OF THE BUTTONS.
 *   key `ecole_taille_boutons_choix` = 'compact' (36 px) | 'standard' (44 px) | 'grand' (52 px); absent = "automatic": nothing is imposed, the page keeps its own size.
 * The portal itself puts the value in the CSS property `--zone-tactile`; Scorsaire's pages size their buttons with `--ui-target`, set here to the same number.
 * The setting follows a change made in another tab (the `storage` event). A page that lets the person choose a size writes the SAME key, so the portal and Scorsaire agree.
 */
export const BUTTON_KEY = 'ecole_taille_boutons_choix';
export const BUTTON_PX = Object.freeze({ compact: 36, standard: 44, grand: 52 });

/** The size in px the person chose on the portal, or null (not chosen: automatic). */
export function portalButtonPx(storage) {
  try { const v = storage?.getItem(BUTTON_KEY); return Object.hasOwn(BUTTON_PX, v) ? BUTTON_PX[v] : null; } catch { return null; }
}

/** Writes the choice under the portal's key (`name` = 'compact' | 'standard' | 'grand'); false when it cannot be kept. */
export function savePortalButtonSize(storage, name) {
  if (!storage || !Object.hasOwn(BUTTON_PX, name)) return false;
  try { storage.setItem(BUTTON_KEY, name); return true; } catch { return false; }
}

/**
 * Sets `--ui-target` on the page to the portal's size when one was chosen, and keeps it up to date.
 * @param o.storage localStorage (or null) ; o.root the element that carries the property ; o.win the window that sends `storage` events
 * @returns {{ current(): number | null, destroy() }}
 */
export function mountPortalButtonSize({ storage, root = document.documentElement, win = window } = {}) {
  const apply = () => { const px = portalButtonPx(storage); if (px) root.style.setProperty('--ui-target', `${px}px`); else root.style.removeProperty('--ui-target'); };
  const onStorage = (e) => { if (e.key === BUTTON_KEY || e.key === null) apply(); };
  apply();
  win.addEventListener('storage', onStorage);
  return { current: () => portalButtonPx(storage), destroy() { win.removeEventListener('storage', onStorage); } };
}
