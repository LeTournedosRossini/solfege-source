/*
 * Carte de doigtés d'une portée (tranche 6b) : comment s'AFFICHE le texte d'un doigté — texte (par défaut), glyphes Bravura (`fingering0-9`,
 * lettres p i m a c e o q s x t, T, tiret de substitution ; variantes italiques des chiffres pour la main droite de guitare) ou carte
 * personnalisée. Le texte du doigté reste la donnée (« 2-3 » ne change pas) ; la carte ne touche que le dessin, caractère par caractère.
 * Même principe que le système de sticking et la percmap : propriété de PORTÉE (`PID.FINGERING_MAP`), exportable / importable
 * (`scorsaire-fingering-map`, et section `fingeringMap` du fichier de préférences). Valable aussi sur une portée de percussion (percnote).
 *   { preset: 'text' | 'glyphs' | 'custom', map?: { <texte> : { text } | { glyph } } }
 * `map` complète ou remplace le préréglage : clé = texte entier du doigté (« 2-3 ») d'abord, sinon un caractère.
 */
export const FINGERING_MAP_PRESETS = ['text', 'glyphs', 'custom'];
export const FINGERING_MAP_FORMAT = 'scorsaire-fingering-map';
export const FINGERING_MAP_VERSION = 1;
export const DEFAULT_FINGERING_PRESET = 'text';

const LOWER = { p: 'fingeringPLower', i: 'fingeringILower', m: 'fingeringMLower', a: 'fingeringALower', c: 'fingeringCLower', e: 'fingeringELower', o: 'fingeringOLower', q: 'fingeringQLower', s: 'fingeringSLower', x: 'fingeringXLower', t: 'fingeringTLower' };
/** Glyphe Bravura d'un caractère pour le préréglage « glyphes » (null si le préréglage n'en a pas). */
export function presetGlyph(ch, italic = false) {
  if (/[0-9]/.test(ch)) return `fingering${ch}${italic ? 'Italic' : ''}`;
  if (ch === 'T') return 'fingeringTUpper';
  if (ch === '-' || ch === '–') return 'fingeringSubstitutionDash';
  if (ch === '(') return `fingeringLeftParenthesis${italic ? 'Italic' : ''}`;
  if (ch === ')') return `fingeringRightParenthesis${italic ? 'Italic' : ''}`;
  if (ch === '[') return `fingeringLeftBracket${italic ? 'Italic' : ''}`;
  if (ch === ']') return `fingeringRightBracket${italic ? 'Italic' : ''}`;
  if (ch === '/') return 'fingeringSeparatorSlash';
  return LOWER[ch] ?? null;
}

const isSymbol = (s) => s && typeof s === 'object' && ((typeof s.text === 'string' && s.text.length >= 1 && s.text.length <= 12 && s.glyph === undefined)
  || (typeof s.glyph === 'string' && s.glyph.length > 0 && s.text === undefined));

export function createFingeringMap({ preset = DEFAULT_FINGERING_PRESET, map } = {}) {
  return map ? { preset, map: structuredClone(map) } : { preset };
}

export function validateFingeringMap(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['carte de doigtés absente'];
  if (!FINGERING_MAP_PRESETS.includes(m.preset)) errors.push(`carte de doigtés : préréglage inconnu (${m.preset})`);
  if (m.map !== undefined) {
    if (!m.map || typeof m.map !== 'object' || Array.isArray(m.map)) errors.push('carte de doigtés : `map` doit être un objet');
    else for (const [k, v] of Object.entries(m.map)) {
      if (k.length < 1 || k.length > 12) errors.push(`carte de doigtés : clé « ${k} » invalide (1 à 12 caractères)`);
      if (!isSymbol(v)) errors.push(`carte de doigtés : symbole de « ${k} » invalide (texte de 1 à 12 caractères OU nom de glyphe)`);
    }
  }
  return errors;
}

/**
 * Morceaux à dessiner pour un doigté : [{ text } | { glyph }] ; `italic` = style main droite (variantes italiques des chiffres).
 * Un glyphe absent du jeu de glyphes retombe sur le texte (vérifié par la mise en page, qui connaît le jeu).
 */
export function fingeringPieces(m, text, { italic = false } = {}) {
  const preset = m?.preset ?? DEFAULT_FINGERING_PRESET;
  const custom = m?.map ?? {};
  if (Object.hasOwn(custom, text)) return [custom[text]];
  const out = [];
  for (const ch of text) {
    if (Object.hasOwn(custom, ch)) { out.push(custom[ch]); continue; }
    const g = preset === 'glyphs' ? presetGlyph(ch, italic) : null;
    out.push(g ? { glyph: g, text: ch, fallback: true } : { text: ch });
  }
  return out;
}

export function exportFingeringMap(m) {
  const value = m ?? createFingeringMap();
  const errors = validateFingeringMap(value);
  if (errors.length) throw new Error(`Carte de doigtés invalide : ${errors[0]}`);
  return JSON.stringify({ format: FINGERING_MAP_FORMAT, version: FINGERING_MAP_VERSION, fingeringMap: value }, null, 2);
}

export function importFingeringMap(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error('Fichier de carte de doigtés illisible (JSON invalide)'); }
  }
  if (!data || data.format !== FINGERING_MAP_FORMAT) throw new Error('Ce fichier n\'est pas une carte de doigtés Scorsaire');
  if (data.version > FINGERING_MAP_VERSION) throw new Error(`Carte de doigtés de version ${data.version}, plus récente que celle supportée (${FINGERING_MAP_VERSION})`);
  const errors = validateFingeringMap(data.fingeringMap);
  if (errors.length) throw new Error(`Carte de doigtés invalide : ${errors[0]}`);
  return createFingeringMap(data.fingeringMap);
}
