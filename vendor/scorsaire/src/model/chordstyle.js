/*
 * Réglages d'affichage des symboles d'accord (préférences de l'utilisateur) : les styles `SID.CHORD_*` que CCE expose (`LeTournedosRossini/cce-editor` : minorStyle, halfDimStyle,
 * deltaStyle, dashStyle, taille des signes simile, fit chords, police et espacements de `.chord-text`), avec les valeurs par défaut de CCE.
 * Un objet plat { <clé>: valeur } ; les clés absentes gardent le défaut. Exporté / importé avec toutes les préférences (section `chordDisplay`, `preferences.js`).
 * `chordDisplayLayer(valeurs)` donne la couche de style { sid: valeur } à passer devant le style du Mouvement (`resolveStyle(sid, [couche, mouvement.style])`).
 */
import { SID, SID_TABLE } from './sid.js';

const ENUMS = {
  minor: ['dash', 'm'], halfDim: ['sym', 'text'], delta: ['round', 'sym', 'text'], dash: ['glyph', 'std', 'em', 'eml'],
};

/** clé de préférence → identifiant de style. */
export const CHORD_DISPLAY_FIELDS = Object.freeze({
  minor: SID.CHORD_MINOR_STYLE, halfDim: SID.CHORD_HALF_DIM_STYLE, delta: SID.CHORD_DELTA_STYLE, dash: SID.CHORD_DASH_STYLE,
  simileSize: SID.CHORD_SIMILE_SIZE, fit: SID.CHORD_FIT, fitMin: SID.CHORD_FIT_MIN,
  autoPlace: SID.CHORD_AUTO_PLACE, inkGap: SID.CHORD_INK_GAP, slashGap: SID.CHORD_BASS_SLASH_GAP, bassAccidGap: SID.CHORD_BASS_ACCID_GAP,
  fontFamily: SID.CHORD_FONT_FAMILY, fontWeight: SID.CHORD_FONT_WEIGHT, fontSize: SID.CHORD_FONT_SIZE, barHeight: SID.CHORD_BAR_HEIGHT,
  letterSpacing: SID.CHORD_LETTER_SPACING, accidScale: SID.CHORD_ACCID_SCALE, sharpScale: SID.CHORD_SHARP_SCALE, flatScale: SID.CHORD_FLAT_SCALE, accidGap: SID.CHORD_ACCID_GAP, accidStackOffset: SID.CHORD_ACCID_STACK_OFFSET,
  qualOffset: SID.CHORD_QUAL_OFFSET, qualOffsetAccid: SID.CHORD_QUAL_OFFSET_ACCID, bassOffset: SID.CHORD_BASS_OFFSET, qualScale: SID.CHORD_QUAL_SCALE, bassScale: SID.CHORD_BASS_SCALE,
});

/**
 * Réglage fin de la qualité selon la fondamentale (préférences) : `qualShift` = { letters: { A: {x, y}, … G }, accidentals: { sharp: {x, y}, flat: {x, y} } }, en em du
 * corps de la fondamentale (x vers la droite, y vers le haut) ; les décalages de la lettre et de l'altération s'ajoutent ; tout est facultatif (défaut 0).
 */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** A root = its letter and its accidental: F (natural), Fs (sharp), Ff (flat). */
export const ROOT_KEYS = Object.freeze([...LETTERS, ...LETTERS.map((L) => `${L}s`), ...LETTERS.map((L) => `${L}f`)]);
/** First signs of a quality that have their own fine shift (`CHORD_QUAL_PAIR_DX_<root>_<key>` / `DY`): glyph names (MINOR…) and the digits / letters of the text. */
export const FIRST_SIGNS = Object.freeze(['MINOR', 'DELTA', 'HALFDIM', 'DIM', 'AUG', '5', '6', '7', '9', '1', 's', 'a', 'M']);
const ACCIDENTALS = { sharp: 'SHARP', flat: 'FLAT' };
const xy = (o) => o && typeof o === 'object' && Object.keys(o).every((k) => (k === 'x' || k === 'y') && Number.isFinite(o[k]));

/** { <root letter>: { <key>: { x, y } } } (key among `keys`). */
function validatePair(name, value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`affichage des accords : « ${name} » doit être un objet`];
  const errors = [];
  for (const [root, row] of Object.entries(value)) {
    if (!ROOT_KEYS.includes(root)) { errors.push(`affichage des accords : « ${name}.${root} » inconnu`); continue; }
    for (const [k, v] of Object.entries(row ?? {})) {
      if (!keys.includes(k)) errors.push(`affichage des accords : « ${name}.${root}.${k} » inconnu`);
      else if (!xy(v)) errors.push(`affichage des accords : « ${name}.${root}.${k} » doit être { x, y } (nombres)`);
    }
  }
  return errors;
}
/** Shift of the accidental glyph by root letter: { <letter>: { s?: {x, y}, f?: {x, y} } }. */
function validateAccidPair(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['affichage des accords : « accidPair » doit être un objet'];
  const errors = [];
  for (const [L, row] of Object.entries(value)) {
    if (!LETTERS.includes(L)) { errors.push(`affichage des accords : « accidPair.${L} » inconnu`); continue; }
    for (const [k, v] of Object.entries(row ?? {})) {
      if (k !== 's' && k !== 'f') errors.push(`affichage des accords : « accidPair.${L}.${k} » inconnu`);
      else if (!xy(v)) errors.push(`affichage des accords : « accidPair.${L}.${k} » doit être { x, y } (nombres)`);
    }
  }
  return errors;
}
/** Shift of the whole "/bass" block by root letter: { <root letter>: { x, y } }. */
function validateBassShift(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['affichage des accords : « bassShift » doit être un objet'];
  const errors = [];
  for (const [k, v] of Object.entries(value)) {
    if (!ROOT_KEYS.includes(k)) errors.push(`affichage des accords : « bassShift.${k} » inconnu`);
    else if (!xy(v)) errors.push(`affichage des accords : « bassShift.${k} » doit être { x, y } (nombres)`);
  }
  return errors;
}

function validateQualShift(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['affichage des accords : « qualShift » doit être un objet'];
  const errors = [];
  for (const [group, entries] of Object.entries(value)) {
    const allowed = group === 'letters' ? LETTERS : group === 'accidentals' ? Object.keys(ACCIDENTALS) : null;
    if (!allowed) { errors.push(`affichage des accords : « qualShift.${group} » inconnu`); continue; }
    for (const [k, v] of Object.entries(entries ?? {})) {
      if (!allowed.includes(k)) errors.push(`affichage des accords : « qualShift.${group}.${k} » inconnu`);
      else if (!xy(v)) errors.push(`affichage des accords : « qualShift.${group}.${k} » doit être { x, y } (nombres)`);
    }
  }
  return errors;
}

/** Erreurs de validation (liste vide = valide). */
export function validateChordDisplay(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['affichage des accords : objet attendu'];
  for (const [key, v] of Object.entries(value)) {
    if (key === 'qualShift') { errors.push(...validateQualShift(v)); continue; }
    if (key === 'bassShift') { errors.push(...validateBassShift(v)); continue; }
    if (key === 'accidPair') { errors.push(...validateAccidPair(v)); continue; }
    if (key === 'qualPair') { errors.push(...validatePair('qualPair', v, FIRST_SIGNS)); continue; }
    if (key === 'bassPair') { errors.push(...validatePair('bassPair', v, LETTERS)); continue; }
    const sid = CHORD_DISPLAY_FIELDS[key];
    if (!sid) { errors.push(`affichage des accords : réglage inconnu « ${key} »`); continue; }
    const def = SID_TABLE[sid];
    if (def.type === 'bool' ? typeof v !== 'boolean'
      : def.type === 'string' ? typeof v !== 'string' || !v
      : !Number.isFinite(v) || (def.type === 'int' && !Number.isInteger(v))) errors.push(`affichage des accords : valeur invalide pour « ${key} »`);
    else if (ENUMS[key] && !ENUMS[key].includes(v)) errors.push(`affichage des accords : « ${key} » doit être ${ENUMS[key].join(' | ')}`);
  }
  return errors;
}

/** Copie indépendante des seuls réglages donnés. */
export function createChordDisplay(value = {}) {
  const errors = validateChordDisplay(value);
  if (errors.length) throw new Error(errors[0]);
  return structuredClone(value);
}

/** Couche de style { sid: valeur } pour `resolveStyle`. */
export function chordDisplayLayer(value = {}) {
  const layer = {};
  for (const [key, v] of Object.entries(value)) if (CHORD_DISPLAY_FIELDS[key]) layer[CHORD_DISPLAY_FIELDS[key]] = v;
  for (const [k, v] of Object.entries(value.qualShift?.letters ?? {})) for (const axis of ['x', 'y']) if (v[axis] !== undefined) layer[SID[`CHORD_QUAL_D${axis.toUpperCase()}_${k}`]] = v[axis];
  for (const [k, v] of Object.entries(value.qualShift?.accidentals ?? {})) for (const axis of ['x', 'y']) if (v[axis] !== undefined) layer[SID[`CHORD_QUAL_D${axis.toUpperCase()}_${ACCIDENTALS[k]}`]] = v[axis];
  for (const [R, row] of Object.entries(value.qualPair ?? {})) for (const [K, v] of Object.entries(row)) for (const axis of ['x', 'y']) if (v[axis] !== undefined) layer[SID[`CHORD_QUAL_PAIR_D${axis.toUpperCase()}_${R}_${K}`]] = v[axis];
  for (const [R, row] of Object.entries(value.bassPair ?? {})) for (const [B, v] of Object.entries(row)) for (const axis of ['x', 'y']) if (v[axis] !== undefined) layer[SID[`CHORD_BASS_PAIR_D${axis.toUpperCase()}_${R}_${B}`]] = v[axis];
  for (const [L, row] of Object.entries(value.accidPair ?? {})) for (const [k, v] of Object.entries(row)) for (const axis of ['x', 'y']) if (v[axis] !== undefined) layer[SID[`CHORD_ACCID_PAIR_D${axis.toUpperCase()}_${L}_${k}`]] = v[axis];
  for (const [R, v] of Object.entries(value.bassShift ?? {})) for (const axis of ['x', 'y']) if (v[axis] !== undefined) layer[SID[`CHORD_BASS_ROOT_D${axis.toUpperCase()}_${R}`]] = v[axis];
  return layer;
}
