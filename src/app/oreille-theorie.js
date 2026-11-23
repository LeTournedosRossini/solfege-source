// Théorie du module d'oreille : intervalles, gammes, arpèges, orthographe des notes, construction des descriptions de partition.
// Aucune dépendance au navigateur (testable sous Node). Les hauteurs sont des numéros MIDI (Do central = 60) ; les noms suivent describe.js ('F#4', 'Bb3').

export const FAMILIES = [
  { key: 'seconde', label: 'Seconde', steps: 1, qualities: [{ name: 'Seconde mineure', qualityLabel: 'Mineure', short: 'm2', semitones: 1 }, { name: 'Seconde majeure', qualityLabel: 'Majeure', short: 'M2', semitones: 2 }] },
  { key: 'tierce', label: 'Tierce', steps: 2, qualities: [{ name: 'Tierce mineure', qualityLabel: 'Mineure', short: 'm3', semitones: 3 }, { name: 'Tierce majeure', qualityLabel: 'Majeure', short: 'M3', semitones: 4 }] },
  { key: 'quarte', label: 'Quarte', steps: 3, qualities: [{ name: 'Quarte juste', qualityLabel: 'Juste', short: 'P4', semitones: 5 }] },
  { key: 'triton', label: 'Triton', steps: 3, qualities: [{ name: 'Triton', qualityLabel: 'Triton', short: 'A4', semitones: 6 }] },
  { key: 'quinte', label: 'Quinte', steps: 4, qualities: [{ name: 'Quinte juste', qualityLabel: 'Juste', short: 'P5', semitones: 7 }] },
  { key: 'sixte', label: 'Sixte', steps: 5, qualities: [{ name: 'Sixte mineure', qualityLabel: 'Mineure', short: 'm6', semitones: 8 }, { name: 'Sixte majeure', qualityLabel: 'Majeure', short: 'M6', semitones: 9 }] },
  { key: 'septieme', label: 'Septième', steps: 6, qualities: [{ name: 'Septième mineure', qualityLabel: 'Mineure', short: 'm7', semitones: 10 }, { name: 'Septième majeure', qualityLabel: 'Majeure', short: 'M7', semitones: 11 }] },
  { key: 'octave', label: 'Octave', steps: 7, qualities: [{ name: 'Unisson', qualityLabel: 'Unisson', short: 'P1', semitones: 0, steps: 0 }, { name: 'Octave', qualityLabel: 'Octave', short: 'P8', semitones: 12 }] },
];
export const ALL_INTERVALS = FAMILIES.flatMap((f) => f.qualities.map((q) => ({ ...q, family: f.key, steps: q.steps ?? f.steps })));

export const ROOT_NAMES = ['Do', 'Do♯ / Ré♭', 'Ré', 'Ré♯ / Mi♭', 'Mi', 'Fa', 'Fa♯ / Sol♭', 'Sol', 'Sol♯ / La♭', 'La', 'La♯ / Si♭', 'Si'];
export const ROOTS = ROOT_NAMES.map((name, pc) => ({ name, label: name, pc }));
export const QUALITIES = [
  { key: 'maj', label: 'Gamme majeure', intervals: [0, 2, 4, 5, 7, 9, 11, 12], steps: [0, 1, 2, 3, 4, 5, 6, 7] },
  { key: 'min', label: 'Gamme mineure naturelle', intervals: [0, 2, 3, 5, 7, 8, 10, 12], steps: [0, 1, 2, 3, 4, 5, 6, 7] },
  { key: 'harmin', label: 'Gamme mineure harmonique', intervals: [0, 2, 3, 5, 7, 8, 11, 12], steps: [0, 1, 2, 3, 4, 5, 6, 7] },
  { key: 'majarp', label: 'Arpège majeur', intervals: [0, 4, 7, 12], steps: [0, 2, 4, 7] },
  { key: 'minarp', label: 'Arpège mineur', intervals: [0, 3, 7, 12], steps: [0, 2, 4, 7] },
  { key: 'dimarp', label: 'Arpège diminué', intervals: [0, 3, 6, 9], steps: [0, 2, 4, 6] },
  { key: 'augarp', label: 'Arpège augmenté', intervals: [0, 4, 8, 12], steps: [0, 2, 4, 7] },
];
export const DIRECTIONS = [{ key: 'asc', label: 'Ascendant' }, { key: 'desc', label: 'Descendant' }];

const LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NAT = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: 'x' };
/** Orthographes possibles de chaque classe de hauteur : [lettre, altération], la plus courante d'abord. */
const ROOT_SPELLINGS = [[['C', 0]], [['D', -1], ['C', 1]], [['D', 0]], [['E', -1], ['D', 1]], [['E', 0]], [['F', 0]], [['F', 1], ['G', -1]], [['G', 0]], [['A', -1], ['G', 1]], [['A', 0]], [['B', -1], ['A', 1]], [['B', 0]]];

const midiOf = (li, alter, oct) => (oct + 1) * 12 + NAT[li] + alter;

/** Note à `steps` degrés de la lettre `li` et `semis` demi-tons de la fondamentale (hauteur `rootMidi`, écrite lettre `li`, altération `alter`). */
function spellFrom(li, alter, rootMidi, steps, semis) {
  const oct0 = Math.floor((rootMidi - alter) / 12) - 1;
  const di = oct0 * 7 + li + steps;
  const l2 = ((di % 7) + 7) % 7, o2 = Math.floor(di / 7);
  const target = rootMidi + semis;
  const alter2 = target - ((o2 + 1) * 12 + NAT[l2]);
  return { name: `${LET[l2]}${ACC[alter2] ?? '?'}${o2}`, alter: alter2 };
}

/** Noms de notes d'un motif (liste de { steps, semis } à partir de la fondamentale de hauteur rootMidi), avec l'orthographe qui évite le plus les doubles altérations. */
export function spellPattern(rootMidi, pattern) {
  let best = null;
  for (const [letter, alter] of ROOT_SPELLINGS[((rootMidi % 12) + 12) % 12]) {
    const li = LET.indexOf(letter);
    const notes = pattern.map((p) => spellFrom(li, alter, rootMidi, p.steps, p.semis));
    const worst = Math.max(Math.abs(alter), ...notes.map((n) => Math.abs(n.alter)));
    if (!best || worst < best.worst) best = { worst, names: notes.map((n) => n.name) };
    if (worst <= 1) break;
  }
  return best.names;
}

/** Nom (sans contexte) d'un numéro MIDI : bémols pour Do♯, Mi♭, Sol♭ (La♭, Si♭), dièse pour Fa♯ ; `sharps` force les dièses. */
export function midiName(m, sharps = false) {
  const pc = ((m % 12) + 12) % 12, oct = Math.floor(m / 12) - 1;
  const n = (sharps ? ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] : ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'])[pc];
  return n + oct;
}
export function nameToMidi(name) {
  const m = /^([A-G])(##|bb|x|#|b)?(-?\d)$/.exec(name);
  const alt = { '': 0, '#': 1, b: -1, x: 2, '##': 2, bb: -2 }[m[2] ?? ''];
  return midiOf(LET.indexOf(m[1]), alt, Number(m[3]));
}

const DUR = { quarter: 'quarter', half: 'half' };
const clefFor = (midis) => (Math.min(...midis) < 57 && Math.max(...midis) <= 67 ? 'bass' : 'treble');

/** Description d'une suite de notes (noms), jouée en `mode` : 'montant' | 'descendant' (notes l'une après l'autre) ou 'simultane' (accord).
 *  `noteSec` : durée d'un temps (noire) en secondes pour la suite, `chordSec` : durée de l'accord. */
export function sequenceDesc(names, { mode = 'montant', noteSec = 0.6, chordSec = 1.9, long = false, width = 320 } = {}) {
  const midis = names.map(nameToMidi);
  const order = names.map((n, i) => ({ n, m: midis[i] })).sort((a, b) => a.m - b.m).map((x) => x.n);
  const clef = clefFor(midis);
  if (mode === 'simultane') {
    return { clef, key: 0, time: null, bpm: Math.round((120 / chordSec) * 10) / 10, width, scale: 1.2, measures: [[{ n: order, d: 'half', dots: 0 }]] };
  }
  const seq = mode === 'descendant' ? order.slice().reverse() : order;
  const d = long ? 'half' : 'quarter';
  const bpm = Math.round((long ? 120 : 60) / noteSec * 10) / 10;
  return { clef, key: 0, time: null, bpm, width, scale: 1.2, measures: [seq.map((n) => ({ n: [n], d, dots: 0 }))] };
}

/** Intervalle `iv` (élément de ALL_INTERVALS) au-dessus de la hauteur MIDI rootMidi : deux noms de notes [grave, aigu]. */
export function intervalNames(rootMidi, iv) {
  return spellPattern(rootMidi, [{ steps: 0, semis: 0 }, { steps: iv.steps, semis: iv.semitones }]);
}
/** Gamme ou arpège `q` (élément de QUALITIES) à partir de la fondamentale MIDI : noms des notes, de la plus grave à la plus aiguë. */
export function qualityNames(rootMidi, q) {
  return spellPattern(rootMidi, q.intervals.map((semis, i) => ({ steps: q.steps[i], semis })));
}

/** Transpose une description (notes et ornements) de `semis` demi-tons (orthographe simplifiée : bémols, ou dièses si la source en contient). */
export function transposeDesc(desc, semis) {
  const sharps = JSON.stringify(desc).includes('#');
  const tr = (n) => midiName(nameToMidi(n) + semis, sharps);
  return JSON.parse(JSON.stringify(desc), (k, v) => (k === 'n' && Array.isArray(v) ? v.map(tr) : v)); // armure supposée absente (do majeur) pour les phrases du répertoire
}
/** Plus basse et plus haute hauteur MIDI d'une description. */
export function rangeOfDesc(desc) {
  const all = desc.measures.flatMap((m) => (Array.isArray(m) ? m : m.events)).flatMap((e) => e.n ?? []).map(nameToMidi);
  return [Math.min(...all), Math.max(...all)];
}
/** Même description, jouée à une autre vitesse (pourcentage -50…+50 par rapport à 100 battements par minute) ; `width` pour le dessin. */
export function withSpeed(desc, pct, extra = {}) { return { ...desc, bpm: Math.round(100 * (1 + pct / 100) * 10) / 10, ...extra }; }
export const firstMidi = (desc) => nameToMidi(desc.measures.flatMap((m) => (Array.isArray(m) ? m : m.events)).find((e) => e.n).n[0]);
