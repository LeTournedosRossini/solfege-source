/*
 * Two optional looks of this device (never in the document): slim scrollbars and a light relief on buttons.
 * Each is a data attribute on <html> read by scoped CSS in static/index.html; both are on by default and can be cancelled.
 */
const KEYS = { scroll: 'scorsaire.slimScroll', relief: 'scorsaire.buttonRelief' };
const ATTR = { scroll: 'data-slim-scroll', relief: 'data-btn-relief' };

export function applyLooks(storage) {
  const get = (k) => { try { return storage.getItem(KEYS[k]) !== 'off'; } catch { return true; } };
  const set = (k, on) => { try { storage.setItem(KEYS[k], on ? 'on' : 'off'); } catch { /* storage unavailable */ } apply(k, on); };
  const apply = (k, on) => { if (on) document.documentElement.setAttribute(ATTR[k], ''); else document.documentElement.removeAttribute(ATTR[k]); };
  for (const k of Object.keys(KEYS)) apply(k, get(k));
  return { get, set };
}
