// Données des jeux de lecture (reprises de l'ancienne application). Les notes sont écrites en notation scientifique, telle qu'elle est DESSINÉE (Do central = C4).
// L'ancienne application numérotait ses octaves avec un décalage d'une octave pour les jeux à réservoir : ici l'octave est celle qui s'affiche à l'écran.
export const FR_NOTE = { C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Notes naturelles de `from` à `to` incluses : noteRange('F3', 'E6') → ['F3', 'G3', …, 'E6'] */
export function noteRange(from, to) {
  const idx = (n) => Number(n.slice(1)) * 7 + LETTERS.indexOf(n[0]);
  const out = [];
  for (let i = idx(from); i <= idx(to); i++) out.push(LETTERS[((i % 7) + 7) % 7] + Math.floor(i / 7));
  return out;
}
// Étendue : toute la portée + 3 lignes supplémentaires au plus, en dessous et au-dessus.
export const TREBLE_POOL = noteRange('F3', 'E6'); // clé de Sol : de la 3e ligne supplémentaire sous la portée à la 3e au-dessus
export const BASS_POOL = noteRange('A1', 'G4');   // clé de Fa

export const INTERVAL_START = 'C5';
export const INTERVAL_POOL = [
  { label: '2de mineure', note: 'Db5' }, { label: '2de majeure', note: 'D5' },
  { label: '3ce mineure', note: 'Eb5' }, { label: '3ce majeure', note: 'E5' },
  { label: '4te juste', note: 'F5' }, { label: '4te augmentée', note: 'F#5' },
  { label: '5te juste', note: 'G5' },
  { label: '6te mineure', note: 'Ab5' }, { label: '6te majeure', note: 'A5' },
  { label: '7me mineure', note: 'Bb5' }, { label: '7me majeure', note: 'B5' },
  { label: '8ve juste', note: 'C6' },
];
export const CHORD_LABELS = ['Majeur', 'Mineur', 'Septième de dominante', 'Septième majeure', 'Septième mineure'];
export const CHORD_POOL = [
  { label: 'Majeur', notes: ['C5', 'E5', 'G5'] }, { label: 'Majeur', notes: ['F5', 'A5', 'C6'] }, { label: 'Majeur', notes: ['G5', 'B5', 'D6'] },
  { label: 'Mineur', notes: ['A4', 'C5', 'E5'] }, { label: 'Mineur', notes: ['D5', 'F5', 'A5'] }, { label: 'Mineur', notes: ['E5', 'G5', 'B5'] },
  { label: 'Septième de dominante', notes: ['G5', 'B5', 'D6', 'F6'] }, { label: 'Septième de dominante', notes: ['D5', 'F#5', 'A5', 'C6'] }, { label: 'Septième de dominante', notes: ['C5', 'E5', 'G5', 'Bb5'] },
  { label: 'Septième majeure', notes: ['C5', 'E5', 'G5', 'B5'] }, { label: 'Septième majeure', notes: ['F5', 'A5', 'C6', 'E6'] },
  { label: 'Septième mineure', notes: ['A4', 'C5', 'E5', 'G5'] }, { label: 'Septième mineure', notes: ['D5', 'F5', 'A5', 'C6'] },
];
export const DURATION_POOL = [
  { label: 'Ronde', d: 'whole' }, { label: 'Blanche', d: 'half' }, { label: 'Noire', d: 'quarter' }, { label: 'Croche', d: 'eighth' }, { label: 'Double-croche', d: 'sixteenth' },
  { label: 'Pause', d: 'whole', rest: true }, { label: 'Demi-pause', d: 'half', rest: true }, { label: 'Soupir', d: 'quarter', rest: true },
  { label: 'Demi-soupir', d: 'eighth', rest: true }, { label: 'Quart de soupir', d: 'sixteenth', rest: true },
];
export const DURATION_NOTE = 'B5';
export const DEGREE_POOL = [
  { label: 'Tonique', note: 'C5' }, { label: 'Sus-tonique', note: 'D5' }, { label: 'Médiante', note: 'E5' }, { label: 'Sous-dominante', note: 'F5' },
  { label: 'Dominante', note: 'G5' }, { label: 'Sus-dominante', note: 'A5' }, { label: 'Sensible', note: 'B5' },
];
// Tonalités majeures par armure : indice n = nombre d'altérations (0 à 7) ; l'armure est dessinée par Scorsaire (nombre de dièses > 0, de bémols < 0).
export const SHARP_KEYS = ['Do', 'Sol', 'Ré', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯'];
export const FLAT_KEYS = ['Do', 'Fa', 'Si♭', 'Mi♭', 'La♭', 'Ré♭', 'Sol♭', 'Do♭'];
