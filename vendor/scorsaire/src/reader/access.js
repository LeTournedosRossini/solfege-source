/*
 * Access to a file served by the school portal. The portal puts a one-resource, short-lived token in the FRAGMENT of the page address (`#t=…`):
 * a fragment is never sent to a server nor written in its logs. The reader reads it and presents it as `Authorization: Bearer …` on each request
 * for a file, so the token is in no address (nothing to copy by mistake, no change to the address a cache keys on).
 * The token is only ever sent to the origin that served the page: a `?file=` pointing somewhere else gets the request without it.
 */

/** The parameters of the page address: the query and the fragment together (the fragment wins on a repeated name). */
export function pageParams(loc = globalThis.location) {
  const params = new URLSearchParams(loc?.search ?? '');
  for (const [k, v] of new URLSearchParams((loc?.hash ?? '').replace(/^#/, ''))) params.set(k, v);
  return params;
}

/** The token of the address, or null (only a plausible token: letters, digits and `-._~+/=`). */
export function accessToken(loc = globalThis.location) {
  const t = pageParams(loc).get('t');
  return t && /^[A-Za-z0-9._~+/=-]{8,512}$/.test(t) ? t : null;
}

/** `fetch` that adds the token for a file of the page's own origin. @param o.loc / o.fetchFn  for tests */
export function authFetch(url, init = {}, { loc = globalThis.location, fetchFn = globalThis.fetch } = {}) {
  const token = accessToken(loc);
  let same = false;
  try { same = new URL(url, loc.href).origin === loc.origin; } catch { same = false; }
  if (!token || !same) return fetchFn(url, init);
  return fetchFn(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
}
