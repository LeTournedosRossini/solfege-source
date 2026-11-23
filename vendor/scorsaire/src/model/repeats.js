/*
 * Sauts (D.C., D.S., …) et marqueurs (segno, coda, fine…) — tables et lecture des propriétés.
 * Port des tables de MuseScore 4.7.5 (`jump.cpp` : jumpTypeTable ; `marker.cpp` : markerTypeTable).
 * Fonctions pures, sans DOM. Le déroulé (ordre de lecture) est dans repeatlist.js.
 *
 * Un saut porte trois ÉTIQUETTES qui désignent des marqueurs : où aller (`jumpTo`), jusqu'où jouer (`playUntil`), où
 * continuer (`continueAt`). Les mots « start » et « end » désignent le début et la fin du Mouvement.
 * Le texte affiché est en italien (convention), quelle que soit la langue de l'interface (décision de Jean, 08/10/2026).
 */
import { PID } from './pid.js';

/** Types de saut prédéfinis : { type, text, jumpTo, playUntil, continueAt } (étiquettes vides = aucune). */
export const JUMP_TYPES = [
  { type: 'dc', text: 'D.C.', jumpTo: 'start', playUntil: 'end', continueAt: '' },
  { type: 'dcAlFine', text: 'D.C. al Fine', jumpTo: 'start', playUntil: 'fine', continueAt: '' },
  { type: 'dcAlCoda', text: 'D.C. al Coda', jumpTo: 'start', playUntil: 'coda', continueAt: 'codab' },
  { type: 'dsAlCoda', text: 'D.S. al Coda', jumpTo: 'segno', playUntil: 'coda', continueAt: 'codab' },
  { type: 'dsAlFine', text: 'D.S. al Fine', jumpTo: 'segno', playUntil: 'fine', continueAt: '' },
  { type: 'ds', text: 'D.S.', jumpTo: 'segno', playUntil: 'end', continueAt: '' },
  { type: 'dcAlDblCoda', text: 'D.C. al Doppia Coda', jumpTo: 'start', playUntil: 'varcoda', continueAt: 'codab' },
  { type: 'dsAlDblCoda', text: 'D.S. al Doppia Coda', jumpTo: 'segno', playUntil: 'varcoda', continueAt: 'codab' },
  { type: 'dss', text: 'Dal Doppio Segno', jumpTo: 'varsegno', playUntil: 'end', continueAt: '' },
  { type: 'dssAlCoda', text: 'D.D.S. al Coda', jumpTo: 'varsegno', playUntil: 'coda', continueAt: 'codab' },
  { type: 'dssAlDblCoda', text: 'D.D.S. al Doppia Coda', jumpTo: 'varsegno', playUntil: 'varcoda', continueAt: 'codab' },
  { type: 'dssAlFine', text: 'D.D.S. al Fine', jumpTo: 'varsegno', playUntil: 'fine', continueAt: '' },
];

/**
 * Types de marqueur prédéfinis. `parts` : texte et glyphes Bravura dans l'ordre (le texte « Fine » est du texte, la dérogation
 * à la règle « glyphe Bravura » est décidée pour les mots) ; `right` : marqueur aligné à droite (fine, to coda…).
 */
export const MARKER_TYPES = [
  { type: 'segno', parts: [{ glyph: 'segno' }], label: 'segno', right: false },
  { type: 'varsegno', parts: [{ glyph: 'segnoSerpent1' }], label: 'varsegno', right: false },
  { type: 'coda', parts: [{ glyph: 'coda' }], label: 'codab', right: false },
  { type: 'varcoda', parts: [{ glyph: 'codaSquare' }], label: 'varcoda', right: false },
  { type: 'codetta', parts: [{ glyph: 'coda' }, { glyph: 'coda' }], label: 'codetta', right: false },
  { type: 'fine', parts: [{ text: 'Fine' }], label: 'fine', right: true },
  { type: 'toCoda', parts: [{ text: 'To Coda' }], label: 'coda', right: true },
  { type: 'toCodaSym', parts: [{ text: 'To ' }, { glyph: 'coda' }], label: 'coda', right: true },
  { type: 'daCoda', parts: [{ text: 'Da Coda' }], label: 'coda', right: true },
  { type: 'daDblCoda', parts: [{ text: 'Da Doppia Coda' }], label: 'coda', right: true },
];

const JUMP_BY_TYPE = new Map(JUMP_TYPES.map((t) => [t.type, t]));
const MARKER_BY_TYPE = new Map(MARKER_TYPES.map((t) => [t.type, t]));

/** Étiquettes d'un saut : `{ jumpTo, playUntil, continueAt }` (chaînes ; '' = aucune). Type prédéfini : la table ; 'user' : les propriétés. */
export function jumpLabels(jump) {
  const type = jump.props[PID.JUMP_TYPE] ?? 'ds';
  const row = JUMP_BY_TYPE.get(type);
  if (row) return { jumpTo: row.jumpTo, playUntil: row.playUntil, continueAt: row.continueAt };
  return {
    jumpTo: jump.props[PID.JUMP_TO] ?? '',
    playUntil: jump.props[PID.PLAY_UNTIL] ?? '',
    continueAt: jump.props[PID.CONTINUE_AT] ?? '',
  };
}

/** Texte d'un saut : `text` local, sinon celui du type (un type 'user' sans texte est vide). */
export function jumpText(jump) {
  const own = jump.props[PID.TEXT];
  if (own) return own;
  return JUMP_BY_TYPE.get(jump.props[PID.JUMP_TYPE] ?? 'ds')?.text ?? '';
}

export function jumpPlaysRepeats(jump) {
  return jump.props[PID.PLAY_REPEATS] === true;
}

/** Étiquette d'un marqueur : propriété locale, sinon celle du type. */
export function markerLabel(marker) {
  const own = marker.props[PID.LABEL];
  if (own) return own;
  return MARKER_BY_TYPE.get(marker.props[PID.MARKER_TYPE] ?? 'fine')?.label ?? '';
}

/** Marqueur à droite de la mesure (fine, to coda…) ? Le type 'user' est à gauche, comme les segno/coda. */
export function isRightMarker(marker) {
  return MARKER_BY_TYPE.get(marker.props[PID.MARKER_TYPE] ?? 'fine')?.right === true;
}

/** Contenu d'un marqueur : liste de `{ text }` | `{ glyph }`. `text` local remplace tout (texte simple). */
export function markerParts(marker) {
  const own = marker.props[PID.TEXT];
  if (own) return [{ text: own }];
  return MARKER_BY_TYPE.get(marker.props[PID.MARKER_TYPE] ?? 'fine')?.parts ?? [];
}
