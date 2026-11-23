/*
 * Sticking (mains) — tranche 5c.
 * MuseScore 4.7.5 : un `Sticking` est un TEXTE posé sur un segment (pas de propriété de note, pas dans la palette). Scorsaire (décision de
 * Jean, 05/10/2026) : le sticking est une propriété de NOTE de percussion (`PID.STICKING` = 'right' | 'left' | null) ; le SYMBOLE affiché
 * dépend d'un système de sticking de la portée (`PID.STICKING_SYSTEM`), sans effet sur le fichier des notes :
 *   { preset: 'letters-rl' | 'letters-dg' | 'shapes' | 'custom', placement?: 'above' | 'below', right?: symbole, left?: symbole }
 *   symbole = { text: 'R' } (lettre) ou { glyph: 'noteheadSquareWhite' } (glyphe SMuFL de Bravura).
 *   `right` / `left` ne servent qu'au préréglage 'custom'. Carré blanc = main droite, rond noir = main gauche (choix de Jean).
 * Sans système : lettres R / L. Le côté par défaut vient du style `SID.STICKING_PLACEMENT` (au-dessus).
 * Les symboles choisis par l'utilisateur sont des PRÉFÉRENCES : export / import JSON `scorsaire-sticking` (comme la percmap).
 */
export const STICKING_HANDS = ['right', 'left'];
export const STICKING_PRESETS = ['letters-rl', 'letters-dg', 'shapes', 'custom'];
export const STICKING_PLACEMENTS = ['above', 'below'];
export const STICKING_FORMAT = 'scorsaire-sticking';
export const STICKING_VERSION = 1;
export const DEFAULT_STICKING_PRESET = 'letters-rl';

/** Symboles des préréglages (chaque préréglage fixe les deux mains). */
export const STICKING_PRESET_SYMBOLS = {
  'letters-rl': { right: { text: 'R' }, left: { text: 'L' } },
  'letters-dg': { right: { text: 'D' }, left: { text: 'G' } },
  shapes: { right: { glyph: 'noteheadSquareWhite' }, left: { glyph: 'noteheadRoundBlack' } },
};

const GLYPH_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

export function isStickingSymbol(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const keys = Object.keys(s);
  if (keys.length !== 1) return false;
  if (keys[0] === 'text') return typeof s.text === 'string' && s.text.length >= 1 && s.text.length <= 4;
  if (keys[0] === 'glyph') return typeof s.glyph === 'string' && GLYPH_NAME.test(s.glyph);
  return false;
}

export function createStickingSystem({ preset = DEFAULT_STICKING_PRESET, placement, right, left } = {}) {
  const sys = { preset };
  if (placement) sys.placement = placement;
  if (preset === 'custom') { sys.right = right; sys.left = left; }
  return sys;
}

/** Problèmes d'un système de sticking (vide = valide). `null` / absent = système par défaut, valide. */
export function validateStickingSystem(sys) {
  if (sys == null) return [];
  if (typeof sys !== 'object' || Array.isArray(sys)) return ['sticking : objet attendu'];
  const errors = [];
  if (!STICKING_PRESETS.includes(sys.preset)) errors.push(`sticking : préréglage inconnu « ${sys.preset} »`);
  if (sys.placement !== undefined && !STICKING_PLACEMENTS.includes(sys.placement)) errors.push(`sticking : côté invalide « ${sys.placement} » (above, below)`);
  if (sys.preset === 'custom') {
    for (const hand of STICKING_HANDS) if (!isStickingSymbol(sys[hand])) errors.push(`sticking : symbole de la main « ${hand} » invalide ({ text } de 1 à 4 caractères ou { glyph })`);
  }
  return errors;
}

/**
 * Système résolu : { preset, placement, symbols: { right, left } }.
 * @param sys    valeur de PID.STICKING_SYSTEM (ou null)
 * @param style  getStyle(SID) pour le côté par défaut (facultatif : 'above')
 */
export function resolveStickingSystem(sys, style) {
  const preset = sys && STICKING_PRESETS.includes(sys.preset) ? sys.preset : DEFAULT_STICKING_PRESET;
  const symbols = preset === 'custom' && sys ? { right: sys.right, left: sys.left } : STICKING_PRESET_SYMBOLS[preset];
  const placement = sys && STICKING_PLACEMENTS.includes(sys.placement) ? sys.placement : (style ? style('stickingPlacement') : 'above');
  return { preset, placement, symbols };
}

/** Symbole d'une main d'après le système résolu ({ text } | { glyph }), ou null (main inconnue). */
export function stickingSymbol(resolved, hand) {
  return resolved.symbols[hand] ?? null;
}

/** Fichier de préférences de sticking à échanger. */
export function exportStickingSystem(sys) {
  const errors = validateStickingSystem(sys ?? createStickingSystem());
  if (errors.length) throw new Error(`Sticking invalide : ${errors[0]}`);
  return JSON.stringify({ format: STICKING_FORMAT, version: STICKING_VERSION, sticking: sys ?? createStickingSystem() }, null, 2);
}

export function importStickingSystem(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error('Fichier de sticking illisible (JSON invalide)'); }
  }
  if (!data || data.format !== STICKING_FORMAT) throw new Error('Ce fichier n\'est pas un réglage de sticking Scorsaire');
  if (data.version > STICKING_VERSION) throw new Error(`Sticking de version ${data.version}, plus récente que celle supportée (${STICKING_VERSION})`);
  const errors = validateStickingSystem(data.sticking);
  if (errors.length) throw new Error(`Sticking invalide : ${errors[0]}`);
  return createStickingSystem(data.sticking);
}
