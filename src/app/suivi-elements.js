// Éléments musicaux suivis : identifiants stables (« intervalle:M3 », « note:treble:G4 ») communs aux jeux de lecture et au jeu d'oreille, et libellés d'affichage.
// Un identifiant désigne la nature musicale de ce qui est travaillé, jamais son rendu (SUI-02).
import { FR_NOTE } from './jeux-donnees.js';
import { CATALOGUE } from './data/catalogue.js';

/** Les 13 intervalles : code (celui du jeu d'oreille), nom complet, nom abrégé du jeu de lecture. */
export const INTERVALLES = [
  { code: 'P1', nom: 'Unisson', abr: null }, { code: 'm2', nom: 'Seconde mineure', abr: '2de mineure' }, { code: 'M2', nom: 'Seconde majeure', abr: '2de majeure' },
  { code: 'm3', nom: 'Tierce mineure', abr: '3ce mineure' }, { code: 'M3', nom: 'Tierce majeure', abr: '3ce majeure' }, { code: 'P4', nom: 'Quarte juste', abr: '4te juste' },
  { code: 'A4', nom: 'Triton', abr: '4te augmentée' }, { code: 'P5', nom: 'Quinte juste', abr: '5te juste' }, { code: 'm6', nom: 'Sixte mineure', abr: '6te mineure' },
  { code: 'M6', nom: 'Sixte majeure', abr: '6te majeure' }, { code: 'm7', nom: 'Septième mineure', abr: '7me mineure' }, { code: 'M7', nom: 'Septième majeure', abr: '7me majeure' },
  { code: 'P8', nom: 'Octave', abr: '8ve juste' },
];
const parAbr = new Map(INTERVALLES.filter((i) => i.abr).map((i) => [i.abr, i.code]));
const parCode = new Map(INTERVALLES.map((i) => [i.code, i]));

export const elIntervalle = (code) => `intervalle:${code}`;
/** Élément « intervalle » d'après le libellé du jeu de lecture (« 3ce majeure »). */
export const elIntervalleLecture = (libelle) => elIntervalle(parAbr.get(libelle) ?? libelle);
export const elNote = (clef, note) => `note:${clef}:${note}`;                // note:treble:G4
export const elSimple = (type, libelle) => `${type}:${libelle}`;              // accord:Majeur, duree:Ronde, degre:Tonique, tonalite:Fa♯
export const elGamme = (cle) => `gamme:${cle}`;                               // gamme:maj, gamme:dimarp
export const elRythme = (mode, niveau) => `rythme:${mode}-${niveau}`; // mode : 'oreille' ou 'vue'
export const slug = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const elPhrase = (titre) => `phrase:${slug(titre)}`;

const GAMMES = { maj: 'Gamme majeure', min: 'Gamme mineure naturelle', harmin: 'Gamme mineure harmonique', melmin: 'Gamme mineure mélodique', majarp: 'Arpège majeur', minarp: 'Arpège mineur', dimarp: 'Arpège diminué', augarp: 'Arpège augmenté' };
const TYPES = { intervalle: 'Intervalle', note: 'Note', accord: 'Accord', duree: 'Durée', degre: 'Degré', tonalite: 'Tonalité', gamme: 'Gamme / arpège', alteration: 'Altération', mode: 'Mode', transposition: 'Transposition', cadence: 'Cadence', articulation: 'Articulation', ornement: 'Ornement', reprise: 'Signe de reprise', nuance: 'Nuance', tempo: 'Tempo', 'note-etrangere': 'Note étrangère', forme: 'Forme', fonction: 'Fonction d’accord', chiffrage: 'Chiffrage', quiz: 'Quiz', dictee: 'Dictée', chant: 'Chant', rythme: 'Rythme', phrase: 'Phrase' };
export const typeDe = (e) => e.split(':')[0];
export const typeLibelle = (e) => TYPES[typeDe(e)] ?? typeDe(e);

/** Libellé lisible d'un élément ; `phrases` (facultatif) : titres du répertoire, pour retrouver le nom d'une phrase d'après son identifiant. */
export function libelle(e, phrases = []) {
  const [type, ...reste] = e.split(':'), v = reste.join(':');
  if (type === 'intervalle') return parCode.get(v)?.nom ?? v;
  if (type === 'note') { const [clef, n] = [reste[0], reste[1]]; const m = /^([A-G])(\d)$/.exec(n ?? ''); return m ? `${FR_NOTE[m[1]] ?? m[1]} ${m[2]} (clé de ${clef === 'bass' ? 'Fa' : 'Sol'})` : v; }
  if (type === 'gamme') return GAMMES[v] ?? v;
  if (type === 'rythme') { const [mode, n] = v.split('-'); return `Rythme ${mode === 'vue' ? 'à vue' : 'à l’oreille'}, niveau ${n}`; }
  if (type === 'phrase') return v === 'perso' ? 'Phrase personnelle' : (phrases.find((p) => slug(p.title) === v)?.title ?? v);
  if (type === 'tonalite') return `${v} majeur`;
  if (type === 'chant') { const m = /^([A-G])(#?)$/.exec(v); const FRN = { C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' }; return m ? `Chanter ${FRN[m[1]]}${m[2] ? '♯' : ''}` : `Chanter ${v}`; }
  if (type === 'dictee') { const [g, n] = v.split('-'); return `Dictée ${g === 'melodie' ? 'mélodique' : 'rythmique'}, niveau ${n}`; }
  if (type === 'quiz') { const [l, n] = v.split(':'); return `Quiz « ${CATALOGUE.lessons.find((x) => x.id === l)?.title ?? l} », question ${n}`; }
  if (type === 'degre' || type === 'accord' || type === 'duree' || type === 'alteration' || type === 'mode' || type === 'transposition' || type === 'cadence' || ['articulation', 'ornement', 'reprise', 'nuance', 'tempo', 'note-etrangere', 'forme', 'fonction', 'chiffrage'].includes(type)) return v;
  return v || e;
}
