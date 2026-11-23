/*
 * Préférences de la fenêtre de saisie des symboles d'accord (étape 5, tranche 6) : ♯ ou ♭ pour les 5 notes altérées, noms de notes latins
 * (Do Ré Mi…) ou anglo-saxons (C D E…). Section `chordEntry` des préférences ; AUCUN texte libre : la fenêtre ne propose que des boutons.
 * Fonctions pures, sans DOM.
 */
export const CHORD_ENTRY_DEFAULTS = Object.freeze({ accidental: 'sharp', naming: 'anglo', placement: 'under' }); // placement (computers): 'under' = right under the chord staff, 'bottom' = fixed at the bottom right

const ACCIDENTALS = ['sharp', 'flat'];
const NAMINGS = ['latin', 'anglo'];
const PLACEMENTS = ['under', 'bottom'];

export function validateChordEntry(v) {
  if (!v || typeof v !== 'object') return ['chordEntry : objet attendu'];
  const errors = [];
  if (!ACCIDENTALS.includes(v.accidental)) errors.push('chordEntry.accidental : sharp | flat');
  if (!NAMINGS.includes(v.naming)) errors.push('chordEntry.naming : latin | anglo');
  if (!PLACEMENTS.includes(v.placement ?? 'under')) errors.push('chordEntry.placement : under | bottom');
  return errors;
}

export const createChordEntry = (v = {}) => ({ ...CHORD_ENTRY_DEFAULTS, ...v });

const LATIN = { C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
const SHARP_ROOTS = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_ROOTS = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** Texte d'une note `{ step, alter }` : « C♯ » ou « Do♯ ». */
export const noteLabel = ({ step, alter = 0 }, naming = 'anglo') => `${naming === 'latin' ? LATIN[step] : step}${alter === 1 ? '♯' : alter === -1 ? '♭' : ''}`;

/** Les 12 fondamentales de la grille, dans l'ordre chromatique : [{ step, alter, label }]. */
export function entryRoots(prefs = CHORD_ENTRY_DEFAULTS) {
  const { accidental, naming } = createChordEntry(prefs);
  return (accidental === 'flat' ? FLAT_ROOTS : SHARP_ROOTS).map(([step, alter]) => ({ step, alter, label: noteLabel({ step, alter }, naming) }));
}
