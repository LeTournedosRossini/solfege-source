// Placement of the quality / bass / accidental against the root letter of a chord symbol — WITHOUT DOM.
// Two places hold the values: the PROJECT (the style of each movement of the work, travels with the file, seen by every screen and reader) and the USER
// (the `chordDisplay` preference of this device, seen by every layout through `resolveStyle`'s user layer). Project beats user beats the Scorsaire default.
import { SID, SID_TABLE, resolveStyle, chordDisplayLayer, createChordDisplay, FIRST_SIGNS, ROOT_KEYS } from '../model/index.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** Every value the editor can change: { key, sid, kind: 'real' | 'bool', min, max, step }. */
export const PLACEMENT_FIELDS = [
  { key: 'auto', sid: SID.CHORD_AUTO_PLACE, kind: 'bool' },
  { key: 'gap', sid: SID.CHORD_INK_GAP, kind: 'real', min: -0.2, max: 0.4, step: 0.005 },
  ...LETTERS.flatMap((L) => ['X', 'Y'].map((a) => ({ key: `${L}${a}`, sid: SID[`CHORD_QUAL_D${a}_${L}`], kind: 'real', min: -0.5, max: 0.5, step: 0.01 }))),
  ...['SHARP', 'FLAT'].flatMap((K) => ['X', 'Y'].map((a) => ({ key: `${K}${a}`, sid: SID[`CHORD_QUAL_D${a}_${K}`], kind: 'real', min: -0.5, max: 0.5, step: 0.01 }))),
];
const LETTERS7 = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const R = (key, sid, step = 0.01) => ({ key, sid, kind: 'real', min: -0.5, max: 0.5, step });
/** The key of a root: its letter and its accidental ('F', 'Fs' sharp, 'Ff' flat). */
export const rootKeyOf = (root) => `${root.step}${root.alter > 0 ? 's' : root.alter < 0 ? 'f' : ''}`;
// one set of values for each (root, first sign of the quality) and each (root, bass letter), the root being its letter AND its accidental (F, F♯, F♭ are three roots):
// keys `q:<root>:<sign>:<X|Y>`, `bp:<root>:<bass>:<X|Y>`, `r<root><X|Y>` (the whole bass block), and for the accidental glyph itself `ac:<letter>:<s|f>:<X|Y>`
const PAIR_FIELDS = ROOT_KEYS.flatMap((L) => [
  ...FIRST_SIGNS.flatMap((K) => ['X', 'Y'].map((a) => R(`q:${L}:${K}:${a}`, SID[`CHORD_QUAL_PAIR_D${a}_${L}_${K}`]))),
  ...LETTERS7.flatMap((B) => ['X', 'Y'].map((a) => R(`bp:${L}:${B}:${a}`, SID[`CHORD_BASS_PAIR_D${a}_${L}_${B}`]))),
  ...['X', 'Y'].map((a) => R(`r${L}${a}`, SID[`CHORD_BASS_ROOT_D${a}_${L}`])),
]);
const ACCID_FIELDS = LETTERS7.flatMap((L) => ['s', 'f'].flatMap((k) => ['X', 'Y'].map((a) => R(`ac:${L}:${k}:${a}`, SID[`CHORD_ACCID_PAIR_D${a}_${L}_${k}`]))));
PLACEMENT_FIELDS.push(...PAIR_FIELDS, ...ACCID_FIELDS,
  { key: 'sharpScale', sid: SID.CHORD_SHARP_SCALE, kind: 'real', min: 0.3, max: 1, step: 0.01 },
  { key: 'flatScale', sid: SID.CHORD_FLAT_SCALE, kind: 'real', min: 0.3, max: 1, step: 0.01 },
  { key: 'slash', sid: SID.CHORD_BASS_SLASH_GAP, kind: 'real', min: -0.3, max: 0.5, step: 0.01 },
  { key: 'bassAccid', sid: SID.CHORD_BASS_ACCID_GAP, kind: 'real', min: -0.2, max: 0.4, step: 0.01 });
const BY_SID = new Map(PLACEMENT_FIELDS.map((f) => [String(f.sid), f]));
export const placementField = (key) => PLACEMENT_FIELDS.find((f) => f.key === key);

const clamp = (f, v) => (f.kind === 'bool' ? Boolean(v) : Number(Math.min(f.max, Math.max(f.min, Math.round(v / f.step) * f.step)).toFixed(4)));

/** Values held at the user level: { sid: value } (what the `chordDisplay` preference says). */
export function userValues(app) {
  const layer = chordDisplayLayer(app.preferences.get('chordDisplay') ?? {});
  const out = {};
  for (const f of PLACEMENT_FIELDS) if (Object.hasOwn(layer, f.sid)) out[f.sid] = layer[f.sid];
  return out;
}

/** Values held by the project: { sid: value } from the style of the first movement that sets them. */
export function projectValues(app) {
  const out = {};
  for (const mv of app.doc.work.movements) for (const f of PLACEMENT_FIELDS) if (!Object.hasOwn(out, f.sid) && Object.hasOwn(mv.style ?? {}, f.sid)) out[f.sid] = mv.style[f.sid];
  return out;
}

/** The style layer to preview a scope: the project one is `movement.style`, the user one has nothing (the user layer of `resolveStyle` applies on its own). */
export function previewLayer(app, scope) {
  return scope === 'project' ? { ...(app.doc.work.movements[0]?.style ?? {}) } : {};
}

/** Back from a flat { sid: value } to the `chordDisplay` preference shape. */
function toPreference(values) {
  const pref = {};
  const shift = (group, name, axis, v) => { pref.qualShift ??= {}; pref.qualShift[group] ??= {}; pref.qualShift[group][name] ??= {}; pref.qualShift[group][name][axis] = v; };
  for (const [sidText, v] of Object.entries(values)) {
    const f = BY_SID.get(sidText);
    if (!f) continue;
    if (f.key === 'auto') pref.autoPlace = v;
    else if (f.key === 'gap') pref.inkGap = v;
    else if (/^[A-G][XY]$/.test(f.key)) shift('letters', f.key[0], f.key[1].toLowerCase(), v);
    else if (f.key === 'slash') pref.slashGap = v;
    else if (f.key === 'bassAccid') pref.bassAccidGap = v;
    else if (f.key === 'sharpScale') pref.sharpScale = v;
    else if (f.key === 'flatScale') pref.flatScale = v;
    else if (f.key.startsWith('ac:')) { const [, L, k, axis] = f.key.split(':'); pref.accidPair ??= {}; pref.accidPair[L] ??= {}; pref.accidPair[L][k] ??= {}; pref.accidPair[L][k][axis.toLowerCase()] = v; }
    else if (/^r[A-G][sf]?[XY]$/.test(f.key)) { const root = f.key.slice(1, -1); pref.bassShift ??= {}; pref.bassShift[root] ??= {}; pref.bassShift[root][f.key.slice(-1).toLowerCase()] = v; }
    else if (f.key.startsWith('q:') || f.key.startsWith('bp:')) { const [t, root, k, axis] = f.key.split(':'); const group = t === 'q' ? 'qualPair' : 'bassPair'; pref[group] ??= {}; pref[group][root] ??= {}; pref[group][root][k] ??= {}; pref[group][root][k][axis.toLowerCase()] = v; }
    else shift('accidentals', f.key.startsWith('SHARP') ? 'sharp' : 'flat', f.key.endsWith('X') ? 'x' : 'y', v);
  }
  return pref;
}

/** Writes values (`{ key: value }`) at a scope: 'project' (every movement, one undoable transaction) or 'user' (the device preferences). A value of `null` removes it. */
export function setPlacement(app, scope, patch) {
  const entries = Object.entries(patch).map(([key, v]) => { const f = placementField(key); if (!f) throw new Error(`Unknown placement field: ${key}`); return [f, v === null ? null : clamp(f, v)]; });
  if (scope === 'project') {
    app.edit('Chord placement', () => {
      for (const mv of app.doc.work.movements) for (const [f, v] of entries) { if (v === null) app.doc.resetStyle(mv, f.sid); else app.doc.setStyle(mv, f.sid, v); }
    });
    return;
  }
  const values = userValues(app);
  for (const [f, v] of entries) { if (v === null) delete values[f.sid]; else values[f.sid] = v; }
  if (Object.keys(values).length) app.preferences.set('chordDisplay', createChordDisplay({ ...stripPlacement(app.preferences.get('chordDisplay') ?? {}), ...toPreference(values) }));
  else app.preferences.set('chordDisplay', createChordDisplay(stripPlacement(app.preferences.get('chordDisplay') ?? {})));
}

/** The preference without the placement fields (what else it holds stays). */
function stripPlacement(pref) {
  const { autoPlace, inkGap, qualShift, qualPair, bassPair, bassShift, accidPair, sharpScale, flatScale, slashGap, bassAccidGap, ...rest } = pref;
  return rest;
}

/** Removes every placement value of a scope. */
export function resetPlacement(app, scope) {
  setPlacement(app, scope, Object.fromEntries(PLACEMENT_FIELDS.map((f) => [f.key, null])));
}

/** Copies every value of one scope to the other (`from` → `to`), replacing what `to` held. */
export function copyPlacement(app, from, to) {
  const source = from === 'project' ? projectValues(app) : userValues(app);
  const patch = Object.fromEntries(PLACEMENT_FIELDS.map((f) => [f.key, Object.hasOwn(source, f.sid) ? source[f.sid] : null]));
  setPlacement(app, to, patch);
}

/** The value in force for a scope: that scope's own, else (project) the user's, else the default. */
export function effectiveValue(app, scope, f, defaults) {
  const own = (scope === 'project' ? projectValues(app) : userValues(app))[f.sid];
  if (own !== undefined) return { value: own, own: true };
  if (scope === 'project') { const u = userValues(app)[f.sid]; if (u !== undefined) return { value: u, own: false, from: 'user' }; }
  return { value: defaults[f.sid], own: false };
}

/** The Scorsaire defaults of the placement values (never the user layer). */
export const schemeDefaults = () => Object.fromEntries(PLACEMENT_FIELDS.map((f) => [f.sid, SID_TABLE[f.sid].default]));

// ---------- exchange file: the values in force, to give to someone (or to keep) and to load back ----------
export const PLACEMENT_FILE_FORMAT = 'scorsaire-chord-placement';

/** The text of the exchange file: every value in force (project over user over the Scorsair default) that differs from the default, with the font it was made for. */
export function exportPlacement(app) {
  const defaults = schemeDefaults();
  const style = (sid) => resolveStyle(sid, [app.doc.work.movements[0]?.style ?? {}]);
  const values = {};
  for (const f of PLACEMENT_FIELDS) { const v = effectiveValue(app, 'project', f, defaults).value; if (v !== undefined && v !== defaults[f.sid]) values[f.key] = v; }
  const font = { family: style(SID.CHORD_FONT_FAMILY), weight: style(SID.CHORD_FONT_WEIGHT), letterSpacing: style(SID.CHORD_LETTER_SPACING) };
  return `${JSON.stringify({ format: PLACEMENT_FILE_FORMAT, version: 1, font, values }, null, 2)}\n`;
}

/** Reads an exchange file; throws a readable error when it is not one. Returns { values: { key: number|bool } }. */
export function parsePlacement(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not a chord placement file (unreadable text)'); }
  if (!data || data.format !== PLACEMENT_FILE_FORMAT) throw new Error('Not a chord placement file');
  if (data.version !== 1) throw new Error(`Unsupported chord placement file version: ${data.version}`);
  const values = {};
  for (const [key, v] of Object.entries(data.values ?? {})) {
    const f = placementField(key);
    if (!f) throw new Error(`Unknown placement value: ${key}`);
    if (f.kind === 'bool' ? typeof v !== 'boolean' : !Number.isFinite(v)) throw new Error(`Invalid value for ${key}`);
    values[key] = v;
  }
  return { values };
}

/** Loads an exchange file into a scope: what the file does not mention goes back to the default (the scope holds exactly the file). */
export function importPlacement(app, scope, text) {
  const { values } = parsePlacement(text);
  setPlacement(app, scope, Object.fromEntries(PLACEMENT_FIELDS.map((f) => [f.key, Object.hasOwn(values, f.key) ? values[f.key] : null])));
  return Object.keys(values).length;
}

// ---------- extend one value to others ----------
const PAIR_RE = /^(q|bp):([A-G][sf]?):([^:]+):([XY])$/;
const BLOCK_RE = /^r([A-G][sf]?)([XY])$/;
const ACCID_RE = /^ac:([A-G]):([sf]):([XY])$/;
const kindOfRoot = (r) => (r.length === 2 ? r[1] : 'n');
const rootsOfKind = (k) => ROOT_KEYS.filter((r) => kindOfRoot(r) === k);

/**
 * The keys a value can be extended to. 'row': the same root with every other sign / bass; 'item': the same sign / bass on every root OF THE SAME ACCIDENTAL (natural, sharp or flat);
 * 'kind': every sign / bass on every root of the same accidental; 'all': every root, whatever its accidental. The accidental glyph keys extend to the other letters of the same
 * accidental ('item') or to both ('all').
 */
export function extensionKeys(key, how) {
  const m = PAIR_RE.exec(key);
  if (m) {
    const [, kind, root, item, axis] = m;
    const items = kind === 'q' ? FIRST_SIGNS : LETTERS7;
    const roots = how === 'row' ? [root] : how === 'all' ? ROOT_KEYS : rootsOfKind(kindOfRoot(root));
    const picked = how === 'item' ? [item] : items;
    return roots.flatMap((r) => picked.map((i) => `${kind}:${r}:${i}:${axis}`));
  }
  const b = BLOCK_RE.exec(key); // the shift of the whole bass block
  if (b) return (how === 'all' ? ROOT_KEYS : how === 'row' ? [b[1]] : rootsOfKind(kindOfRoot(b[1]))).map((r) => `r${r}${b[2]}`);
  const a = ACCID_RE.exec(key);
  if (a) return LETTERS7.flatMap((L) => (how === 'all' ? ['s', 'f'] : [a[2]]).map((k) => `ac:${L}:${k}:${a[3]}`));
  return [key];
}

/** Writes the value in force of `key` (what the stepper shows) to the other keys of the extension. Returns the number of keys written. */
export function extendPlacement(app, scope, key, how) {
  const f = placementField(key);
  if (!f) throw new Error(`Unknown placement field: ${key}`);
  const value = effectiveValue(app, scope, f, schemeDefaults()).value;
  const keys = extensionKeys(key, how);
  setPlacement(app, scope, Object.fromEntries(keys.map((k) => [k, value])));
  return keys.length;
}
