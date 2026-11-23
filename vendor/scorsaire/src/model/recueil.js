/*
 * The RECUEIL (songbook / setlist): ONE file above the works. It EMBEDS several works (each the text of a `.scorsaire` file, with its pictures), in an order, with the
 * reading adjustments of each (display transposition, zoom). It is opened by the Lecteur (a read-only application), which never changes a work: it only shows them,
 * reorders them and keeps its own adjustments, that can be exported back into a recueil.
 *   { format: 'scorsaire-recueil', version: 1, id, title, entries: [{ id, title, work: <text of the .scorsaire>, images: { <assetId>: { mime, data } }, settings: { transpose?, zoom? } }], profiles: [] }
 * `profiles` is reserved for the named display profiles ("guitarist", "singer"…). Pure functions on plain objects (nothing is mutated: each returns the new recueil).
 */

export const RECUEIL_FORMAT = 'scorsaire-recueil';
export const RECUEIL_VERSION = 1;
export const TRANSPOSE_MIN = -11;
export const TRANSPOSE_MAX = 11;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;

// The ids of a recueil and of its entries live in the FILE, not in a document: they do not use the counter of the elements of a work (that one restarts with every work loaded)
let counter = 0;
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(counter += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class RecueilError extends Error {
  constructor(message) { super(message); this.name = 'RecueilError'; }
}

/** An empty recueil. */
export const createRecueil = ({ title = '' } = {}) => ({ format: RECUEIL_FORMAT, version: RECUEIL_VERSION, id: newId('rc'), title: String(title), entries: [], profiles: [] });

const checkSettings = (s) => {
  const out = {};
  if (s?.transpose != null) {
    if (!Number.isInteger(s.transpose) || s.transpose < TRANSPOSE_MIN || s.transpose > TRANSPOSE_MAX) throw new RecueilError('Transposition hors limites');
    if (s.transpose !== 0) out.transpose = s.transpose;
  }
  if (s?.zoom != null) {
    if (!(s.zoom >= ZOOM_MIN && s.zoom <= ZOOM_MAX)) throw new RecueilError('Zoom hors limites');
    if (s.zoom !== 1) out.zoom = Math.round(s.zoom * 100) / 100;
  }
  return out;
};

/** Adds a work at the end (or at `at`): `workText` = the text of the `.scorsaire` file, `images` = { id: { mime, data (data: URI) } }. Returns { recueil, entry }. */
export function addEntry(recueil, { title = '', workText, images = {}, settings = {} }, at = recueil.entries.length) {
  if (typeof workText !== 'string' || !workText.trim()) throw new RecueilError('Œuvre vide');
  const entry = { id: newId('re'), title: String(title), work: workText, images, settings: checkSettings(settings) };
  const entries = [...recueil.entries];
  entries.splice(Math.max(0, Math.min(at, entries.length)), 0, entry);
  return { recueil: { ...recueil, entries }, entry };
}

export const removeEntry = (recueil, entryId) => ({ ...recueil, entries: recueil.entries.filter((e) => e.id !== entryId) });

/** Moves an entry to the position `to` (clamped). */
export function moveEntry(recueil, entryId, to) {
  const from = recueil.entries.findIndex((e) => e.id === entryId);
  if (from < 0) throw new RecueilError('Œuvre introuvable dans le recueil');
  const entries = [...recueil.entries];
  const [e] = entries.splice(from, 1);
  entries.splice(Math.max(0, Math.min(to, entries.length)), 0, e);
  return { ...recueil, entries };
}

/** Moves an entry just before or after another one (drag and drop); a drop on itself changes nothing. */
export function moveEntryNear(recueil, entryId, targetId, before) {
  const ids = recueil.entries.map((e) => e.id);
  const from = ids.indexOf(entryId); const target = ids.indexOf(targetId);
  if (from < 0 || target < 0) throw new RecueilError('Œuvre introuvable dans le recueil');
  let to = target + (before ? 0 : 1);
  if (to > from) to -= 1; // the removal shifts what follows
  return to === from ? recueil : moveEntry(recueil, entryId, to);
}

/** Merges reading adjustments into an entry (`null` = back to the default); defaults are never stored. */
export function setEntrySettings(recueil, entryId, patch) {
  if (!recueil.entries.some((e) => e.id === entryId)) throw new RecueilError('Œuvre introuvable dans le recueil');
  return {
    ...recueil,
    entries: recueil.entries.map((e) => {
      if (e.id !== entryId) return e;
      const merged = { ...e.settings };
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete merged[k]; else merged[k] = v; }
      return { ...e, settings: checkSettings({ transpose: merged.transpose, zoom: merged.zoom }) };
    }),
  };
}

/** The title shown for an entry in a list: its own, else the title written in the work, else a number. */
export function entryTitle(entry, index = 0) {
  if (entry.title?.trim()) return entry.title.trim();
  try { const t = JSON.parse(entry.work)?.props?.title ?? JSON.parse(entry.work)?.work?.props?.title; if (typeof t === 'string' && t.trim()) return t.trim(); } catch { /* an unreadable work keeps its number */ }
  return String(index + 1);
}

export function setEntryTitle(recueil, entryId, title) {
  if (!recueil.entries.some((e) => e.id === entryId)) throw new RecueilError('Œuvre introuvable dans le recueil');
  return { ...recueil, entries: recueil.entries.map((e) => (e.id === entryId ? { ...e, title: String(title) } : e)) };
}

/** Puts another version of the work in an entry (same place, same title, same reading adjustments). */
export function replaceEntryWork(recueil, entryId, { workText, images = {} }) {
  if (typeof workText !== 'string' || !workText.trim()) throw new RecueilError('Œuvre vide');
  if (!recueil.entries.some((e) => e.id === entryId)) throw new RecueilError('Œuvre introuvable dans le recueil');
  return { ...recueil, entries: recueil.entries.map((e) => (e.id === entryId ? { ...e, work: workText, images } : e)) };
}

export const renameRecueil = (recueil, title) => ({ ...recueil, title: String(title) });

/** The text of the file. */
export const serializeRecueil = (recueil) => JSON.stringify(recueil);

/** True when `text` looks like a recueil (cheap test before a full parse). */
export const isRecueilText = (text) => typeof text === 'string' && text.slice(0, 200).includes(`"${RECUEIL_FORMAT}"`);

/** Reads and checks the text of a recueil file. Throws `RecueilError`. */
export function parseRecueil(text) {
  let r;
  try { r = JSON.parse(text); } catch { throw new RecueilError('Fichier de recueil illisible'); }
  if (!r || r.format !== RECUEIL_FORMAT) throw new RecueilError('Ce n\'est pas un recueil Scorsaire');
  if (!Number.isInteger(r.version) || r.version > RECUEIL_VERSION) throw new RecueilError('Recueil écrit par une version plus récente');
  if (!Array.isArray(r.entries)) throw new RecueilError('Recueil sans liste d\'œuvres');
  const ids = new Set();
  const entries = r.entries.map((e) => {
    if (!e || typeof e.work !== 'string' || !e.work.trim()) throw new RecueilError('Une œuvre du recueil est vide');
    const id = typeof e.id === 'string' && e.id && !ids.has(e.id) ? e.id : newId('re');
    ids.add(id);
    return { id, title: String(e.title ?? ''), work: e.work, images: e.images && typeof e.images === 'object' ? e.images : {}, settings: (() => { try { return checkSettings(e.settings); } catch { return {}; } })() };
  });
  return { format: RECUEIL_FORMAT, version: RECUEIL_VERSION, id: typeof r.id === 'string' ? r.id : newId('rc'), title: String(r.title ?? ''), entries, profiles: Array.isArray(r.profiles) ? r.profiles : [] };
}
