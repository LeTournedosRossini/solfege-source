// Données des jeux « Modes grecs », « Transposition » et « Cadences » (CON-02). Pur (sans navigateur), testable sous Node.
import { notesDeGamme } from './jeux-gammes.js';
import { noteDuDegre } from './jeux-tonalites.js';
import { nameToMidi } from './oreille-theorie.js';

const DECALE = (nom, k) => nom.replace(/-?\d+$/, (o) => String(Number(o) + k));   // 'G5' → 'G4' pour k = −1

/* ---------------------------------------------------------------- modes grecs */
export const MODES_LABELS = ['Ionien', 'Dorien', 'Phrygien', 'Lydien', 'Mixolydien', 'Éolien', 'Locrien'];
export const FORMULES_MODES = {
  Ionien: [0, 2, 4, 5, 7, 9, 11, 12], Dorien: [0, 2, 3, 5, 7, 9, 10, 12], Phrygien: [0, 1, 3, 5, 7, 8, 10, 12], Lydien: [0, 2, 4, 6, 7, 9, 11, 12],
  Mixolydien: [0, 2, 4, 5, 7, 9, 10, 12], 'Éolien': [0, 2, 3, 5, 7, 8, 10, 12], Locrien: [0, 1, 3, 5, 6, 8, 10, 12],
};
const TONIQUE_BLANCHE = { Ionien: 'C', Dorien: 'D', Phrygien: 'E', Lydien: 'F', Mixolydien: 'G', 'Éolien': 'A', Locrien: 'B' };   // sur les touches blanches (leçon)
/** Gammes modales : celles des touches blanches (la tonique habituelle du mode, sans altération) comptent triple, les autres toniques ajoutent des altérations. */
export const POOL_MODES = (() => {
  const p = [];
  for (const mode of MODES_LABELS) for (const t of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) {
    const notes = notesDeGamme(t, 0, FORMULES_MODES[mode]); if (!notes) continue;
    const blanche = TONIQUE_BLANCHE[mode] === t;
    for (let i = 0; i < (blanche ? 3 : 1); i++) p.push({ label: mode, notes, tonique: t, blanche });
  }
  return p;
})();

/* ---------------------------------------------------------------- transposition */
/** Intervalles de transposition : demi-tons, armure de la tonalité d'arrivée (le motif de départ est en Do majeur). */
export const TRANSPOSITIONS = [
  { label: 'Seconde majeure vers le haut', semis: 2, n: 2 }, { label: 'Tierce mineure vers le haut', semis: 3, n: -3 }, { label: 'Tierce majeure vers le haut', semis: 4, n: 4 },
  { label: 'Quarte juste vers le haut', semis: 5, n: -1 }, { label: 'Quinte juste vers le haut', semis: 7, n: 1 },
  { label: 'Seconde majeure vers le bas', semis: -2, n: -2 }, { label: 'Tierce mineure vers le bas', semis: -3, n: 3 }, { label: 'Tierce majeure vers le bas', semis: -4, n: -4 },
  { label: 'Quarte juste vers le bas', semis: -5, n: 1 }, { label: 'Quinte juste vers le bas', semis: -7, n: -1 },
];
export const TRANSPOSITIONS_LABELS = TRANSPOSITIONS.map((t) => t.label);
const MOTIFS = [[0, 1, 2, 0], [2, 2, 3, 4], [4, 5, 4, 2], [0, 2, 4, 2], [4, 3, 2, 0], [2, 4, 5, 4]];   // degrés de la gamme de Do majeur
export const POOL_TRANSPOSITIONS = TRANSPOSITIONS.flatMap((t) => MOTIFS.map((degres) => {
  const oct = t.semis > 0 ? 0 : 1;                                                    // vers le haut on part du registre médium, vers le bas du registre aigu
  const depart = degres.map((d) => DECALE(noteDuDegre(0, d), oct - 1));
  const arrivee = degres.map((d, i) => { const nom = noteDuDegre(t.n, d), cible = nameToMidi(depart[i]) + t.semis; return DECALE(nom, Math.round((cible - nameToMidi(nom)) / 12)); });
  return { label: t.label, depart, arrivee, semis: t.semis, n: t.n };
}));

/* ---------------------------------------------------------------- cadences */
export const CADENCES_LABELS = ['Parfaite', 'Plagale', 'Demi-cadence', 'Rompue'];
// degrés (0 = I … 6 = VII) des deux accords de chaque cadence ; la demi-cadence a trois formes (I-V, IV-V, II-V), les autres comptent triple pour équilibrer le tirage
const ENCHAINEMENTS = { Parfaite: [[4, 0]], Plagale: [[3, 0]], 'Demi-cadence': [[0, 4], [3, 4], [1, 4]], Rompue: [[4, 5]] };
export const DEGRES_ROMAINS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/** Notes de l'accord de trois sons construit sur le degré `g` (0 à 6) de la tonalité d'armure `n`, registre bas pour les degrés élevés (V, VI…). */
export function accordDuDegre(n, g) {
  const notes = [0, 2, 4].map((k) => noteDuDegre(n, g + k));
  return g >= 3 ? notes.map((x) => DECALE(x, -1)) : notes;
}
export const POOL_CADENCES = Object.entries(ENCHAINEMENTS).flatMap(([label, liste]) => (liste.length === 1 ? [liste[0], liste[0], liste[0]] : liste).map((deg) => ({ label, deg })));
