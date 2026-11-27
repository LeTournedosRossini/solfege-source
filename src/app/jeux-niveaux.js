// Niveaux de difficulté des jeux de lecture (CON-03) : le niveau 1 ne pose que l'essentiel, le niveau 2 élargit, « tous les niveaux » est le jeu complet.
// Pur (sans navigateur), testable sous Node. `garde(item)` dit si un élément du réservoir est posé à ce niveau.
import { noteRange } from './jeux-donnees.js';

const dans = (liste) => { const s = new Set(liste); return (x) => s.has(x); };
const note = (garde) => (n) => garde(n);
const niv = (id, label, garde) => ({ id, label, garde });

const INTERVALLES_1 = ['2de majeure', '3ce mineure', '3ce majeure', '4te juste', '5te juste'];
const INTERVALLES_2 = [...INTERVALLES_1, '2de mineure', '6te mineure', '6te majeure', '8ve juste'];

/** Pour chaque jeu : liste des niveaux { id: '1' | '2', label, garde } ; sans niveau choisi, tout le réservoir est posé. */
export const NIVEAUX = {
  'clef-sol': { liste: [niv('1', 'Niveau 1 : sur la portée', note(dans(noteRange('E4', 'F5')))), niv('2', 'Niveau 2 : avec une ligne supplémentaire', note(dans(noteRange('C4', 'A5'))))] },
  'clef-fa': { liste: [niv('1', 'Niveau 1 : sur la portée', note(dans(noteRange('G2', 'A3')))), niv('2', 'Niveau 2 : avec une ligne supplémentaire', note(dans(noteRange('E2', 'C4'))))] },
  intervalles: { liste: [niv('1', 'Niveau 1 : secondes, tierces, quarte, quinte', (it) => INTERVALLES_1.includes(it.label)), niv('2', 'Niveau 2 : avec sixtes et octave', (it) => INTERVALLES_2.includes(it.label))] },
  accords: { liste: [niv('1', 'Niveau 1 : majeur et mineur', (it) => it.label === 'Majeur' || it.label === 'Mineur'), niv('2', 'Niveau 2 : avec la septième de dominante', (it) => ['Majeur', 'Mineur', 'Septième de dominante'].includes(it.label))] },
  'durees-silences': { liste: [niv('1', 'Niveau 1 : les notes', (it) => !it.rest), niv('2', 'Niveau 2 : avec pause, demi-pause, soupir', (it) => !it.rest || ['whole', 'half', 'quarter'].includes(it.d))] },
  'gammes-mineures': { liste: [niv('1', 'Niveau 1 : majeure et mineure naturelle', (it) => it.label === 'Majeure' || it.label === 'Mineure naturelle'), niv('2', 'Niveau 2 : avec la mineure harmonique', (it) => it.label !== 'Mineure mélodique')] },
};

/** Réservoir filtré au niveau `id` ('1', '2' ou null = tous) du jeu `jeu` ; si le filtre ne laissait rien, tout le réservoir est rendu. */
export function filtrerNiveau(jeu, reservoir, id) {
  const n = id ? NIVEAUX[jeu]?.liste.find((x) => x.id === id) : null;
  if (!n) return reservoir;
  const r = reservoir.filter(n.garde);
  return r.length ? r : reservoir;
}
