/*
 * "Portal mode": the editor opened BY the school portal to modify one score of its library and save it back on the server (`docs/message-pour-scorsaire-editeur-portail.md`).
 * The page is the normal editor; this mode only starts when the address fragment holds a token `t` AND a save address `save`:
 *   #t=TOKEN&file=/api/…/fichier&save=/api/…/enregistrer&media=/api/…/audio/&return=/pages/portail-prof.html&fmax=57&lang=fr&m=ID
 * The token lives in MEMORY only (the address is cleaned by the page as soon as it has been read) and goes out as `Authorization: Bearer` to this origin only.
 * Reading returns the file and its `ETag` (the SHA-256 of the file); saving is a `PUT` of the whole ZIP with `If-Match: <ETag>`, and the server's answer is turned into
 * one plain result for the page to show. No DOM here: `fetch` and the location are injected, so everything runs under Node.
 */

const TOKEN = /^[A-Za-z0-9._~+/=-]{8,512}$/;
const MOVEMENT = /^[\w.-]{1,64}$/;

/** `raw` as a path on the page's own origin (`/api/…`), or null when it points somewhere else. */
export function sameOriginPath(raw, loc = globalThis.location) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw, loc.href);
    return u.origin === loc.origin ? `${u.pathname}${u.search}` : null;
  } catch { return null; }
}

/** A path of the portal to go back to: starts with one `/`, no scheme, no `//`, no backslash (never anywhere else). */
export function safeReturnPath(raw) {
  return typeof raw === 'string' && /^\/(?![/\\])[^\\\s]*$/.test(raw) && !raw.includes('://') ? raw : null;
}

/**
 * The portal address of a page, or null when this is not portal mode (a token and a save address are both needed).
 * @param params URLSearchParams of the address (`pageParams()`); @param loc for tests
 * @returns { token, file, save, media, returnTo, fmax, lang, movement } — `file`, `save`, `media` are paths of this origin
 */
export function readPortalAddress(params, loc = globalThis.location) {
  const token = params.get('t');
  const save = sameOriginPath(params.get('save'), loc);
  if (!token || !TOKEN.test(token) || !save) return null;
  const media = params.get('media'); const fmax = Number(params.get('fmax')); const lang = params.get('lang'); const m = params.get('m');
  return {
    token, save,
    file: sameOriginPath(params.get('file'), loc),
    media: media ? sameOriginPath(media, loc) : null,
    returnTo: safeReturnPath(params.get('return')),
    fmax: Number.isInteger(fmax) && fmax > 0 ? fmax : null,
    lang: lang === 'fr' || lang === 'en' ? lang : null,
    movement: m && MOVEMENT.test(m) ? m : null,
  };
}

/** The address without the token and the other portal parameters (what `history.replaceState` puts in the bar once they have been read). */
export function cleanAddress(loc = globalThis.location) {
  const search = new URLSearchParams(loc.search ?? '');
  for (const k of ['t', 'file', 'save', 'media', 'return', 'fmax', 'lang', 'm']) search.delete(k);
  const q = search.toString();
  return `${loc.pathname}${q ? `?${q}` : ''}`;
}

/** Strips the quotes of an `ETag` value that was copied as is (`"abc"` → `"abc"` stays quoted for `If-Match`; a weak or unquoted value is quoted). */
const quoted = (etag) => (/^(W\/)?".*"$/.test(etag) ? etag : `"${etag}"`);

/**
 * The session: the token, the `ETag` of the file as last read or written, and the save call.
 * @param o.address the result of `readPortalAddress`  ·  o.fetchFn  ·  o.fileVersion the format version this editor writes
 */
export function createPortalSession({ address, fetchFn = (...a) => globalThis.fetch(...a), fileVersion = null }) {
  let etag = null; let version = null;
  const headers = (extra = {}) => ({ Authorization: `Bearer ${address.token}`, ...extra });
  const remember = (h) => {
    const e = h?.get?.('ETag'); if (e) etag = e;
    const v = h?.get?.('X-Partition-Version'); if (v != null && v !== '') version = Number.isFinite(Number(v)) ? Number(v) : v;
  };
  return {
    address,
    get etag() { return etag; },
    get version() { return version; },
    /** True when this editor would write a format newer than the portal accepts (`fmax`): nothing is sent then. */
    formatTooNew() { return address.fmax != null && fileVersion != null && fileVersion > address.fmax; },
    /** The base of the audio tracks, an absolute address with a trailing slash, or null. */
    mediaBase(loc = globalThis.location) {
      if (!address.media) return null;
      const u = new URL(address.media, loc.href);
      return u.href.endsWith('/') ? u.href : `${u.href}/`;
    },
    /** `fetch` that adds the token (for the audio tracks); only for this origin. */
    fetch(url, init = {}) { return fetchFn(url, { ...init, headers: { ...(init.headers ?? {}), ...headers() } }); },
    /** GET of the file: `{ bytes }`; keeps the `ETag`. Throws an error with `.status` when the answer is not 200. */
    async fetchFile() {
      const r = await fetchFn(address.file, { headers: headers() });
      if (!r.ok) throw Object.assign(new Error(String(r.status)), { status: r.status });
      remember(r.headers);
      return { bytes: new Uint8Array(await r.arrayBuffer()) };
    },
    /**
     * PUT of the whole ZIP. `confirm` repeats the request with `?confirmer=1` (the teacher accepted that passages quoted by students' notes no longer exist).
     * @returns { ok: true, version, sha256, size, movements } | { ok: false, status, code, error, movements } | { ok: false, network: true }
     */
    async save(bytes, { confirm = false } = {}) {
      if (!etag) return { ok: false, status: 0, code: 'noEtag', error: '' }; // the file was never read from the server: nothing to compare with
      const url = confirm ? `${address.save}${address.save.includes('?') ? '&' : '?'}confirmer=1` : address.save;
      let r;
      try { r = await fetchFn(url, { method: 'PUT', headers: headers({ 'If-Match': quoted(etag), 'Content-Type': 'application/octet-stream' }), body: bytes }); } catch { return { ok: false, network: true }; }
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      if (r.ok) {
        const before = etag;
        remember(r.headers);
        if (etag === before && body?.sha256) etag = quoted(body.sha256); // the answer's own ETag first, else the fingerprint it reports
        if (body?.version != null) version = body.version;
        return { ok: true, version: body?.version ?? version, sha256: body?.sha256 ?? null, size: body?.taille ?? null, movements: body?.mouvements ?? [] };
      }
      return { ok: false, status: r.status, code: body?.code ?? null, error: typeof body?.error === 'string' ? body.error : '', movements: Array.isArray(body?.mouvements) ? body.mouvements : [] };
    },
  };
}
