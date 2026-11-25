// Courte explication affichée après une erreur dans les jeux de lecture (REV-05) : une phrase qui dit POURQUOI, pas seulement la bonne réponse. Pur, testable sous Node.
import { FR_NOTE, SHARP_KEYS, FLAT_KEYS } from './jeux-donnees.js';

const LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ORDINAL = (n, masc = false) => (n === 1 ? (masc ? '1er' : '1re') : `${n}e`);

/** Où se trouve une note sur la portée : « sur la 2e ligne », « dans le 3e interligne », « sur la 1re ligne supplémentaire »… */
export function placeSurPortee(clef, nom) {
  const m = /^([A-G])(\d)$/.exec(nom); if (!m) return '';
  const base = clef === 'bass' ? 2 * 7 + 4 : 4 * 7 + 2;                 // ligne du bas : Mi4 en clé de Sol, Sol2 en clé de Fa
  const pas = Number(m[2]) * 7 + LET.indexOf(m[1]) - base;                // pair = ligne, impair = interligne (0 = ligne du bas)
  const note = FR_NOTE[m[1]];
  if (pas >= 0 && pas <= 8) return pas % 2 === 0 ? `${note} est sur la ${ORDINAL(pas / 2 + 1)} ligne (en comptant depuis le bas).` : `${note} est dans le ${ORDINAL((pas + 1) / 2, true)} interligne (en comptant depuis le bas).`;
  const dessous = pas < 0, k = dessous ? -pas : pas - 8, sens = dessous ? 'sous' : 'au-dessus de';
  if (k % 2 === 0) return `${note} est sur la ${ORDINAL(k / 2)} ligne supplémentaire ${dessous ? 'sous' : 'au-dessus de'} la portée.`;
  return k === 1 ? `${note} est dans l’espace juste ${sens} la portée.` : `${note} est dans l’espace ${sens} la ${ORDINAL((k - 1) / 2)} ligne supplémentaire.`;
}

const INTERVALLES = {
  m2: ['Seconde mineure', 2, 1], M2: ['Seconde majeure', 2, 2], m3: ['Tierce mineure', 3, 3], M3: ['Tierce majeure', 3, 4], P4: ['Quarte juste', 4, 5], A4: ['Quarte augmentée (triton)', 4, 6],
  P5: ['Quinte juste', 5, 7], m6: ['Sixte mineure', 6, 8], M6: ['Sixte majeure', 6, 9], m7: ['Septième mineure', 7, 10], M7: ['Septième majeure', 7, 11], P8: ['Octave', 8, 12],
};
const ACCORDS = {
  'Majeur': 'Accord majeur : une tierce majeure puis une tierce mineure (fondamentale, tierce, quinte).',
  'Mineur': 'Accord mineur : une tierce mineure puis une tierce majeure.',
  'Septième de dominante': 'Septième de dominante : un accord majeur auquel on ajoute une septième mineure (4 notes).',
  'Septième majeure': 'Septième majeure : un accord majeur auquel on ajoute une septième majeure (4 notes).',
  'Septième mineure': 'Septième mineure : un accord mineur auquel on ajoute une septième mineure (4 notes).',
};
const DUREES = {
  'Ronde': 'La ronde vaut 4 temps : tête vide, sans hampe.', 'Blanche': 'La blanche vaut 2 temps : tête vide, avec une hampe.', 'Noire': 'La noire vaut 1 temps : tête pleine, avec une hampe.',
  'Croche': 'La croche vaut un demi-temps : tête pleine, hampe et un crochet.', 'Double-croche': 'La double-croche vaut un quart de temps : tête pleine, hampe et deux crochets.',
  'Pause': 'La pause dure 4 temps (une mesure à 4 temps) : un petit rectangle qui pend sous la 4e ligne.', 'Demi-pause': 'La demi-pause dure 2 temps : un petit rectangle posé sur la 3e ligne.',
  'Soupir': 'Le soupir dure 1 temps.', 'Demi-soupir': 'Le demi-soupir dure un demi-temps.', 'Quart de soupir': 'Le quart de soupir dure un quart de temps.',
};
const DEGRES = {
  'Tonique': '1er degré : la note qui donne son nom à la tonalité, la note de repos.', 'Sus-tonique': '2e degré : juste au-dessus de la tonique.', 'Médiante': '3e degré : au milieu entre la tonique et la dominante.',
  'Sous-dominante': '4e degré : juste au-dessous de la dominante.', 'Dominante': '5e degré : la note la plus importante après la tonique.', 'Sus-dominante': '6e degré : juste au-dessus de la dominante.',
  'Sensible': '7e degré : un demi-ton sous la tonique, elle « veut » monter vers elle.',
};
const DIESES = ['Fa', 'Do', 'Sol', 'Ré', 'La', 'Mi', 'Si'], BEMOLS = ['Si', 'Mi', 'La', 'Ré', 'Sol', 'Do', 'Fa'];

/** Explication d'un élément suivi (identifiant « intervalle:M3 », « note:treble:G4 », « accord:Majeur »…), ou '' si on n'en a pas. */
export function explication(e) {
  const [type, ...r] = e.split(':'), v = r.join(':');
  if (type === 'note') return placeSurPortee(r[0], r[1]);
  if (type === 'intervalle') { const i = INTERVALLES[v]; return i ? `${i[0]} : ${i[1]} notes en comptant les deux extrémités (${i[1] - 1} degré${i[1] > 2 ? 's' : ''}), ${i[2]} demi-ton${i[2] > 1 ? 's' : ''}.` : ''; }
  if (type === 'accord') return ACCORDS[v] ?? '';
  if (type === 'duree') return DUREES[v] ?? '';
  if (type === 'degre') return DEGRES[v] ?? '';
  if (type === 'tonalite') {
    const d = SHARP_KEYS.indexOf(v), b = FLAT_KEYS.indexOf(v);
    if (v === 'Do') return 'Do majeur : aucune altération à l’armure.';
    if (d > 0) return `${v} majeur : ${d} dièse${d > 1 ? 's' : ''} à l’armure (${DIESES.slice(0, d).join(', ')}).`;
    if (b > 0) return `${v} majeur : ${b} bémol${b > 1 ? 's' : ''} à l’armure (${BEMOLS.slice(0, b).join(', ')}).`;
  }
  return '';
}
