// Variété des tonalités dans les jeux de lecture (CON-01) : degrés dans n'importe quelle tonalité majeure, intervalles à partir de n'importe quelle note. Pur, testable sous Node.
import { intervalNames, nameToMidi } from './oreille-theorie.js';
import { INTERVALLES } from './suivi-elements.js';

const LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const DIESES = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], BEMOLS = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
/** Lettre de la tonique d'une tonalité majeure selon son armure (n > 0 dièses, n < 0 bémols). */
export const toniqueDe = (n) => (n >= 0 ? ['C', 'G', 'D', 'A', 'E', 'B', 'F', 'C'][n] : ['C', 'F', 'B', 'E', 'A', 'D', 'G', 'C'][-n]);

/** Note du degré `d` (0 = tonique … 6 = sensible) de la tonalité majeure d'armure `n`, écrite dans le registre aigu habituel du jeu (la tonique vers le Do5). */
export function noteDuDegre(n, d) {
  const t = LET.indexOf(toniqueDe(n)), idx = t + d, lettre = LET[idx % 7];
  const alt = n > 0 ? (DIESES.slice(0, n).includes(lettre) ? '#' : '') : n < 0 ? (BEMOLS.slice(0, -n).includes(lettre) ? 'b' : '') : '';
  const base = t >= 5 ? 4 : 5;                       // la tonique La ou Si reste dans la portée
  return `${lettre}${alt}${base + Math.floor(idx / 7)}`;
}

/** Les départs possibles pour les intervalles : Sol4 à Fa♯5, sans Do♯ ni Sol♯ (orthographes plus lisibles). */
export const DEPARTS = [67, 69, 70, 71, 72, 74, 75, 76, 77, 78];

/** Intervalle du jeu de lecture (libellé « 3ce majeure ») au-dessus de la note `depart` (MIDI) : [note de départ, seconde note]. Renvoie null pour un libellé inconnu. */
export function intervalDepuis(libelle, depart) {
  const it = INTERVALLES.find((i) => i.abr === libelle);
  if (!it) return null;
  const pas = Number(it.code.slice(1)) - 1;                       // seconde = 1 degré, … octave = 7
  const semis = { m2: 1, M2: 2, m3: 3, M3: 4, P4: 5, A4: 6, P5: 7, m6: 8, M6: 9, m7: 10, M7: 11, P8: 12 }[it.code];
  return intervalNames(depart, { steps: pas, semitones: semis });
}
export { nameToMidi };

const double = (n) => /^[A-G](x|bb|##)/.test(n);
/** Départ pris au hasard parmi ceux qui n'obligent à aucune double altération (repli : Do5). `rnd` : générateur dans [0,1[. */
export function intervalAuHasard(libelle, rnd = Math.random, departs = DEPARTS) {
  const ordre = departs.slice().sort(() => rnd() - 0.5);
  for (const d of ordre) { const r = intervalDepuis(libelle, d); if (r && !double(r[0]) && !double(r[1])) return r; }
  return intervalDepuis(libelle, departs[0] ?? 72);
}
