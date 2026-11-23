/*
 * Display of one track, layered by screen. A layer is { showBars?: boolean, sizePct?: number, show?: { <category>: boolean }, colors?: { all?|<category>: '#rrggbb' } }
 * (absent key = follows the layer below; `show` / `colors` follow it key by key). The categories are DISPLAY_CATEGORIES; `bars` is hidden through `showBars`:
 *   screen 1  → `PID.TRACK_DISPLAY` of the track (also the fallback of the other screens)
 *   screen 2  → `PID.PART_TRACK_DISPLAY` of the part ({ trackId: layer }), then the track
 *   screen 3  → `trackSettings[trackId]` of the sheet cell (`showBars`, `sizePct`), then the track
 * A layer only stores the keys it sets; a key is removed to follow the layer below. Pure functions except the setters, which must be called inside `doc.transaction`.
 */
import { PID } from './pid.js';

export const SIZE_MIN = 25;
export const SIZE_MAX = 200;
export const DEFAULT_DISPLAY = Object.freeze({ showBars: true, sizePct: 100, show: Object.freeze({}), colors: Object.freeze({}) });
/** What the menu « Affichage » of a track can show / hide / recolour (see layout/displaycats.js). */
export const DISPLAY_CATEGORIES = Object.freeze(['lines', 'bars', 'clefs', 'signatures', 'notes', 'rests', 'autoRests', 'dynamics', 'articulations', 'slurs']);
const HEX = /^#[0-9a-f]{6}$/i;

/** Normalised layer: only the keys that are set (an explicit value may override a lower layer, even when it equals the default); throws on an invalid value. */
export function cleanDisplay(layer) {
  const out = {};
  if (!layer) return out;
  if (layer.showBars != null) {
    if (typeof layer.showBars !== 'boolean') throw new Error('showBars must be a boolean');
    out.showBars = layer.showBars;
  }
  if (layer.sizePct != null) {
    if (!Number.isFinite(layer.sizePct) || layer.sizePct < SIZE_MIN || layer.sizePct > SIZE_MAX) throw new Error(`sizePct must be between ${SIZE_MIN} and ${SIZE_MAX}`);
    out.sizePct = Math.round(layer.sizePct);
  }
  if (layer.composite != null) {
    if (typeof layer.composite !== 'string' || !layer.composite) throw new Error('composite must be an id');
    out.composite = layer.composite;
  }
  if (layer.slashes != null) {
    if (!Array.isArray(layer.slashes)) throw new Error('slashes must be a list');
    out.slashes = layer.slashes.map((r) => {
      if (!r || typeof r.staff !== 'string' || typeof r.from !== 'string' || typeof r.to !== 'string' || !r.staff || !r.from || !r.to) throw new Error('a slash range needs a staff and two measures');
      return { staff: r.staff, from: r.from, to: r.to };
    });
  }
  if (layer.show != null) {
    if (typeof layer.show !== 'object' || Array.isArray(layer.show)) throw new Error('show must be an object');
    const show = {};
    for (const [k, v] of Object.entries(layer.show)) {
      if (v == null) continue;
      if (!DISPLAY_CATEGORIES.includes(k) || k === 'bars') throw new Error(`unknown category to show: ${k}`);
      if (typeof v !== 'boolean') throw new Error(`show.${k} must be a boolean`);
      show[k] = v;
    }
    if (Object.keys(show).length) out.show = show;
  }
  if (layer.colors != null) {
    if (typeof layer.colors !== 'object' || Array.isArray(layer.colors)) throw new Error('colors must be an object');
    const colors = {};
    for (const [k, v] of Object.entries(layer.colors)) {
      if (v == null) continue;
      if (k !== 'all' && !DISPLAY_CATEGORIES.includes(k)) throw new Error(`unknown category to colour: ${k}`);
      if (typeof v !== 'string' || !HEX.test(v)) throw new Error(`colors.${k} must be #rrggbb`);
      colors[k] = v.toLowerCase();
    }
    if (Object.keys(colors).length) out.colors = colors;
  }
  return out;
}

/** Layer of a track element (screen 1). */
export const trackLayer = (track) => track?.props?.[PID.TRACK_DISPLAY] ?? null;

/** Resolved display from layers, the first one that defines a key wins. */
export function resolveDisplay(...layers) {
  const out = { showBars: true, sizePct: 100, show: {}, colors: {} };
  for (const key of ['showBars', 'sizePct', 'composite', 'slashes']) { // (`slashes`: the first layer that sets it replaces the ones below, an empty list included)
    const layer = layers.find((l) => l && l[key] != null);
    if (layer) out[key] = layer[key];
  }
  for (const key of ['show', 'colors']) for (const layer of [...layers].reverse()) if (layer?.[key]) Object.assign(out[key], layer[key]); // the first layer wins, key by key
  return out;
}

/** True when a resolved display differs from the defaults. */
export const isDefaultDisplay = (d) => d.showBars !== false && d.sizePct === 100 && !d.slashes?.length && !Object.values(d.show ?? {}).includes(false) && !Object.keys(d.colors ?? {}).length;

/** What the layout needs: the hidden categories (`bars` included) and the colours; null when the display is the default. */
export function displaySpec(d) {
  if (isDefaultDisplay(d)) return null;
  const hidden = new Set(Object.entries(d.show ?? {}).filter(([, v]) => v === false).map(([k]) => k));
  if (d.showBars === false) hidden.add('bars');
  return { hidden, colors: { ...(d.colors ?? {}) }, ...(d.slashes?.length ? { slashes: d.slashes } : {}) };
}

/** Screen 1 / fallback: the display of a track. */
export const displayOfTrack = (track) => resolveDisplay(trackLayer(track));

/** Merges a patch into a layer; a key set to null returns to "follows the layer below". Returns the cleaned layer. */
export function patchLayer(layer, patch) {
  const next = { ...(layer ?? {}) };
  for (const [k, v] of Object.entries(patch)) { if (v == null) delete next[k]; else next[k] = v; } // `show` / `colors` replace the whole sub-object
  return cleanDisplay(next);
}

function trackOf(doc, trackId) {
  for (const mv of doc.work.movements) { const t = mv.tracks.find((x) => x.id === trackId); if (t) return t; }
  throw new Error(`Unknown track: ${trackId}`);
}

/** Screen 1: sets the display of a track. `patch` = { showBars?, sizePct? }, null = default. */
export function setTrackDisplay(doc, trackId, patch) {
  const track = trackOf(doc, trackId);
  const next = patchLayer(trackLayer(track), patch);
  if (Object.keys(next).length) doc.set(track, PID.TRACK_DISPLAY, next); else if (trackLayer(track)) doc.reset(track, PID.TRACK_DISPLAY);
}

/** Screen 2: sets the display of a track in ONE part. */
export function setPartTrackDisplay(doc, partId, trackId, patch) {
  const part = doc.work.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`Unknown part: ${partId}`);
  trackOf(doc, trackId);
  const all = { ...(part.props[PID.PART_TRACK_DISPLAY] ?? {}) };
  const next = patchLayer(all[trackId], patch);
  if (Object.keys(next).length) all[trackId] = next; else delete all[trackId];
  if (Object.keys(all).length) doc.set(part, PID.PART_TRACK_DISPLAY, all); else if (part.props[PID.PART_TRACK_DISPLAY] != null) doc.reset(part, PID.PART_TRACK_DISPLAY);
}

/** Validation of the stored layers (used by validate.js): array of messages. */
export function validateTrackDisplay(layer, where) {
  try { cleanDisplay(layer); return []; } catch (e) { return [`${where} : ${e.message}`]; }
}
