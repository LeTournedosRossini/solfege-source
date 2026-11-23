// The BANNER above the timeline of mode B: CARDS (a coloured label over an interval, like the cards of the parts of the form) and ANNOTATIONS (a small text note),
// placed by hand at media times (nothing is analysed). Items: { id, kind: 'card' | 'note', start, end, text (several lines), color? (the fill), ink?, border?, borderWidth?,
// size?, bold?, italic?, underline?, opacity? (of the fill, 0..1), soft? (soft edge in px: a halo of the fill colour), style? (the id of a named style) }; what is missing takes the value
// of the NAMED STYLE it uses, then the default of its kind (`styleOf`). A named style is a record of the same look fields ({ id, name, color?, ink?, … }) that belongs to the
// person who makes the files (a preference of the editor, see model/preferences.js); a file carries a copy of the styles it uses. PURE: lists in, lists out.
export const KINDS = ['card', 'note', 'marker']; // a MARKER is a mark on the timeline for the person who makes the file (an instant and a name): never shown to the reader
export const DEFAULT_LENGTH = { card: 8, note: 4, marker: 0.1 };
export const isMarker = (x) => x?.kind === 'marker';
export const MIN_LENGTH = 0.5;
export const MAX_TEXT = 200;
export const MAX_LINES = 4;
export const COLORS = ['#cfe0f5', '#f5d9d4', '#d8ecd3', '#efe3c2', '#e0d6ef', '#d3ecec'];
let counter = 0;
const nextId = (list) => { let id; do { counter += 1; id = `bn${counter}`; } while (list.some((x) => x.id === id)); return id; };
const cleanText = (t) => String(t ?? '').split(/\r?\n/).slice(0, MAX_LINES).map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').trim().slice(0, MAX_TEXT);

/** The style of an item: its own values over the defaults of its kind. */
export const STYLE_DEFAULTS = {
  card: { fill: COLORS[0], ink: '#222222', border: '#8a857a', borderWidth: 1, size: 11.5, bold: true, italic: false, underline: false },
  note: { fill: '#ffffff', ink: '#222222', border: '#8a857a', borderWidth: 1, size: 11.5, bold: false, italic: true, underline: false },
  marker: { fill: '#e0a000', ink: '#222222', border: '#8a857a', borderWidth: 1, size: 11.5, bold: false, italic: false, underline: false },
};
export const LOOK_KEYS = ['color', 'ink', 'border', 'borderWidth', 'size', 'bold', 'italic', 'underline', 'opacity', 'soft'];
export const MAX_SOFT = 24;
/** The look of an item. `styles` = the named styles in force ({ id: record }). Own values win over the named style, which wins over the defaults of the kind. */
export function styleOf(x, styles = null) {
  const d = STYLE_DEFAULTS[x.kind] ?? STYLE_DEFAULTS.card;
  const s = (x.style && styles?.[x.style]) || {};
  const pick = (k) => x[k] ?? s[k];
  return {
    fill: pick('color') ?? d.fill, ink: pick('ink') ?? d.ink, border: pick('border') ?? d.border,
    borderWidth: Number.isFinite(pick('borderWidth')) ? pick('borderWidth') : d.borderWidth, size: Number.isFinite(pick('size')) ? pick('size') : d.size,
    bold: pick('bold') ?? d.bold, italic: pick('italic') ?? d.italic, underline: pick('underline') ?? d.underline,
    opacity: Number.isFinite(pick('opacity')) ? pick('opacity') : 1, soft: Number.isFinite(pick('soft')) ? pick('soft') : 0,
  };
}
/** `#rrggbb` + an opacity as a CSS colour. */
export function cssColor(hex, alpha = 1) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? ''); if (!m || alpha >= 1) return hex;
  const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, alpha)})`;
}
/** The CSS of the look of an item that does not depend on where it is placed: fill (with opacity), text, outline, writing, soft edge. */
export function lookCss(st, scale = 1) {
  const fill = cssColor(st.fill, st.opacity);
  const halo = st.soft > 0 ? `box-shadow:0 0 ${st.soft * scale}px ${(st.soft * scale) / 2}px ${fill};` : '';
  return `background:${fill};color:${st.ink};border:${st.borderWidth}px solid ${st.border};font:${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : '400 '}${st.size * scale}px/1.25 sans-serif;${st.underline ? 'text-decoration:underline;' : ''}${halo}`;
}
/** A named style: { id, name, color?, ink?, … } (the same look fields as an item). Problems of one record. */
export function styleProblems(s) {
  const out = [];
  if (typeof s?.id !== 'string' || !s.id) out.push('bad id');
  if (typeof s?.name !== 'string' || !s.name || s.name.length > 40) out.push(`${s?.id}: bad name`);
  out.push(...itemProblems([{ id: 'x', kind: 'card', start: 0, end: 1, text: '', ...Object.fromEntries(LOOK_KEYS.filter((k) => s?.[k] != null).map((k) => [k, s[k]])) }]).map((p) => `${s?.id}: ${p}`));
  return out;
}
/** Keeps the valid named styles of a map read from a file: { id: record }. */
export function sanitizeStyles(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [id, s] of Object.entries(map)) if (s && s.id === id && styleProblems(s).length === 0) out[id] = pickStyle(s);
  return out;
}
/** The record of a named style (id, name and the look fields it sets only). */
export const pickStyle = (s) => ({ id: s.id, name: s.name, ...Object.fromEntries(LOOK_KEYS.filter((k) => s[k] != null).map((k) => [k, s[k]])) });
/** The ids of the styles the items use. */
export const usedStyleIds = (list) => [...new Set(list.map((x) => x.style).filter(Boolean))];
export const lineCount = (x) => Math.max(1, String(x.text ?? '').split('\n').length);
/** The height in pixels of an item: its lines at its size, plus its padding. */
export const itemHeight = (x, styles = null) => Math.round(lineCount(x) * styleOf(x, styles).size * 1.25 + 8);

// Where an item is SHOWN: in the banner above the timeline ('banner', what a file without the field means) or ON the video ('video', a box placed in percent of the video frame:
// x, y = top left corner, w = width; the height comes from the text; the same units as the fragments placed on the video).
export const PLACES = ['video', 'banner'];
export const ITEM_OVER_DEFAULTS = Object.freeze({ x: 5, y: 4, w: 40 });
export const ITEM_OVER_LIMITS = Object.freeze({ x: [0, 95], y: [0, 50], w: [8, 100] });
export const itemPlace = (x) => (x?.place === 'video' ? 'video' : 'banner');
export const onVideo = (x) => x?.place === 'video';
const clampOver = (v, [lo, hi], d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
export const itemOver = (x) => { const o = x?.over ?? {}; return { x: clampOver(o.x, ITEM_OVER_LIMITS.x, ITEM_OVER_DEFAULTS.x), y: clampOver(o.y, ITEM_OVER_LIMITS.y, ITEM_OVER_DEFAULTS.y), w: clampOver(o.w, ITEM_OVER_LIMITS.w, ITEM_OVER_DEFAULTS.w) }; };

/** Adds an item at `start` (clipped to the media). Returns the new list and the item. */
export function addItem(list, { kind = 'card', start, text = '', duration, color, place }) {
  const k = KINDS.includes(kind) ? kind : 'card';
  const s = Math.max(0, Math.min(start, Math.max(0, duration - MIN_LENGTH)));
  const item = { id: nextId(list), kind: k, start: s, end: Math.min(duration, s + DEFAULT_LENGTH[k]), text: cleanText(text), ...(color || k === 'card' ? { color: color ?? COLORS[list.filter((x) => x.kind === k).length % COLORS.length] } : {}), ...(place === 'video' ? { place: 'video' } : {}) };
  return { list: [...list, item], item };
}
export const updateItem = (list, id, patch) => list.map((x) => {
  if (x.id !== id) return x;
  const n = { ...x, ...patch, ...(patch.text != null ? { text: cleanText(patch.text) } : {}), ...(KINDS.includes(patch.kind) ? {} : { kind: x.kind }) };
  for (const k of Object.keys(patch)) if (patch[k] == null) delete n[k]; // null gives the default back
  return n;
});
export const removeItem = (list, id) => list.filter((x) => x.id !== id);
/** Slides an item (same length) inside [0, duration]. */
export function moveItem(list, id, start, duration) {
  const x = list.find((i) => i.id === id); if (!x) return list;
  const len = x.end - x.start; const s = Math.max(0, Math.min(start, duration - len));
  return list.map((i) => (i.id === id ? { ...i, start: s, end: s + len } : i));
}
/** Moves one edge ('start' | 'end'), keeping at least MIN_LENGTH. */
export function resizeItem(list, id, edge, time, duration) {
  const x = list.find((i) => i.id === id); if (!x) return list;
  if (edge === 'start') return list.map((i) => (i.id === id ? { ...i, start: Math.max(0, Math.min(time, i.end - MIN_LENGTH)) } : i));
  return list.map((i) => (i.id === id ? { ...i, end: Math.min(duration, Math.max(time, i.start + MIN_LENGTH)) } : i));
}
/** The items alive at `t`, in start order. */
export const itemsAt = (list, t) => list.filter((x) => t >= x.start && t < x.end).sort((a, b) => a.start - b.start);
/** The items of one kind ('card' | 'note') in start order. */
export const itemsOf = (list, kind) => list.filter((x) => x.kind === kind).sort((a, b) => a.start - b.start);
/** Problems of a hand-made list (a file can hold anything). */
export function itemProblems(list) {
  const out = [];
  const ids = new Set();
  for (const x of list) {
    if (typeof x?.id !== 'string' || ids.has(x.id)) out.push(`${x?.id}: bad id`); else ids.add(x.id);
    if (!KINDS.includes(x?.kind)) out.push(`${x?.id}: bad kind`);
    if (!(x?.start >= 0 && x?.end > x?.start)) out.push(`${x?.id}: bad times`);
    if (typeof x?.text !== 'string' || x.text.length > MAX_TEXT || x.text.split('\n').length > MAX_LINES) out.push(`${x?.id}: bad text`);
    for (const k of ['color', 'ink', 'border']) if (x?.[k] != null && !/^#[0-9a-fA-F]{6}$/.test(x[k])) out.push(`${x?.id}: bad ${k}`);
    if (x?.borderWidth != null && !(x.borderWidth >= 0 && x.borderWidth <= 6)) out.push(`${x?.id}: bad borderWidth`);
    if (x?.size != null && !(x.size >= 8 && x.size <= 40)) out.push(`${x?.id}: bad size`);
    if (x?.opacity != null && !(x.opacity >= 0 && x.opacity <= 1)) out.push(`${x?.id}: bad opacity`);
    if (x?.soft != null && !(x.soft >= 0 && x.soft <= MAX_SOFT)) out.push(`${x?.id}: bad soft`);
    if (x?.place != null && !PLACES.includes(x.place)) out.push(`${x?.id}: bad place`);
    if (x?.over != null) { if (typeof x.over !== 'object') out.push(`${x?.id}: bad over`); else for (const k of ['x', 'y', 'w']) if (x.over[k] != null && !(Number.isFinite(x.over[k]) && x.over[k] >= ITEM_OVER_LIMITS[k][0] && x.over[k] <= (k === 'y' ? 100 : ITEM_OVER_LIMITS[k][1]))) out.push(`${x?.id}: bad over.${k}`); }
    if (x?.style != null && (typeof x.style !== 'string' || x.style.length > 40)) out.push(`${x?.id}: bad style`);
    for (const k of ['bold', 'italic', 'underline']) if (x?.[k] != null && typeof x[k] !== 'boolean') out.push(`${x?.id}: bad ${k}`);
  }
  return out;
}
/** Keeps what is valid in a list read from a file. */
export const sanitizeItems = (list) => (Array.isArray(list) ? list.filter((x) => itemProblems([x]).length === 0) : []);

/** The records of the styles that `list` uses, taken from `styles` ({ id: record }); null when there is none (nothing to write in a file). */
export function usedStylesOf(list, styles) {
  const out = {};
  for (const id of usedStyleIds(list ?? [])) if (styles?.[id]) out[id] = pickStyle(styles[id]);
  return Object.keys(out).length ? out : null;
}
/** The look fields (keys of an item / of a style) of the look `st` given by `styleOf`. */
export const lookRecord = (st) => ({ color: st.fill, ink: st.ink, border: st.border, borderWidth: st.borderWidth, size: st.size, bold: st.bold, italic: st.italic, underline: st.underline, opacity: st.opacity, soft: st.soft });
export const clearLook = () => Object.fromEntries(LOOK_KEYS.map((k) => [k, null]));
