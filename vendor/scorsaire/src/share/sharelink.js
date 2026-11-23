/*
 * SHARING a piece with another teacher: a LINK that carries the piece itself (`#z=<the .scorsaire archive, base64url>`), opened by the published editor (a PWA) or by the Lecteur (read only).
 * The part of an address after `#` never goes to a server, so the piece stays private. The archive is the very file the editor saves (a ZIP, already compressed): nothing else to decode on the
 * receiving side but the bytes. Long links are refused by some mailers and messengers, hence a LIMIT; above it (or when the piece carries audio) the piece is put online instead (`depositname`).
 * Pure functions, no DOM.
 */
export const EDITOR_URL = 'https://letournedosrossini.github.io/scorsaire-editeur/';
export const READER_URL = 'https://letournedosrossini.github.io/scorsaire-lecteur/';
export const LINK_LIMIT = 8000; // characters: what almost every mailer and messenger lets through
export const LINK_LIMIT_MAX = 60000;
export const SHARE_PARAM = 'z';

/** Bytes → base64url (no padding, safe in an address). */
export function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → bytes, or null when the text is not base64url. */
export function base64UrlToBytes(text) {
  const s = String(text ?? '');
  if (!s || /[^A-Za-z0-9_-]/.test(s)) return null;
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  try { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); } catch { return null; }
}

/** The address that opens `bytes` (a .scorsaire archive) in the editor (mode 'editor') or the Lecteur (mode 'reader'). */
export function buildShareLink(bytes, { mode = 'editor' } = {}) {
  return `${mode === 'reader' ? READER_URL : EDITOR_URL}#${SHARE_PARAM}=${bytesToBase64Url(bytes)}`;
}

/** The archive carried by an address (its `z` parameter, in the fragment or the search), or null. `params` = URLSearchParams. */
export function bytesFromParams(params) {
  const z = params?.get?.(SHARE_PARAM);
  return z ? base64UrlToBytes(z) : null;
}

/** Length of the link for `byteLength` bytes of archive (without building it). */
export const linkLengthFor = (byteLength, mode = 'editor') => (mode === 'reader' ? READER_URL : EDITOR_URL).length + SHARE_PARAM.length + 2 + Math.ceil((byteLength * 4) / 3);

/**
 * Which way to send: 'link' or 'deposit'. `way` = 'auto' (default) | 'link' | 'deposit' (the person's choice wins). Audio cannot ride in a link. Returns { way, reason }:
 * reason = 'chosen' | 'audio' | 'tooLong' | 'fits'.
 */
export function chooseShareWay({ way = 'auto', byteLength, hasAudio = false, mode = 'editor', limit = LINK_LIMIT }) {
  if (way === 'deposit') return { way: 'deposit', reason: 'chosen' };
  if (hasAudio) return { way: 'deposit', reason: 'audio' };
  const tooLong = linkLengthFor(byteLength, mode) > Math.min(limit, LINK_LIMIT_MAX);
  if (way === 'link') return { way: 'link', reason: tooLong ? 'tooLong' : 'chosen' }; // forced: the person is told it may be refused by a mailer, nothing is blocked
  return tooLong ? { way: 'deposit', reason: 'tooLong' } : { way: 'link', reason: 'fits' };
}

/** A file name for a piece put online: letters, digits and dashes only, with a short stamp so that two pieces of the same title never meet. */
export function depositName(title, stamp = Date.now()) {
  const stem = String(title || 'morceau').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'morceau';
  return `${stem}-${Math.floor(stamp / 1000).toString(36)}.scorsaire`;
}
