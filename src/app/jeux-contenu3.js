// Données des jeux des huit dernières leçons : articulations, ornements, signes de reprise, nuances et tempo, notes étrangères et chromatisme, forme musicale, fonction des accords, basse chiffrée (CON-02).
// Chaque élément de réservoir est { label, desc } (une partition), { label, html } (une question écrite) ou { label, deg } (un accord, dessiné dans la tonalité choisie). Pur, testable sous Node.
import { accordDuDegre } from './jeux-contenu2.js';

const q = (n, extra = {}) => ({ n: [n], d: 'quarter', dots: 0, ...extra });
const whole = (n, extra = {}) => ({ n: Array.isArray(n) ? n : [n], d: 'whole', dots: 0, ...extra });
const treble = (measures) => ({ clef: 'treble', key: 0, measures });

/* ---------------------------------------------------------------- articulations */
export const ARTICULATIONS = ['Staccato', 'Legato', 'Tenuto', 'Accent'];
const MOTIFS_ART = [['C5', 'D5', 'E5', 'F5'], ['G5', 'F5', 'E5', 'D5'], ['E5', 'G5', 'E5', 'C5'], ['A5', 'G5', 'F5', 'E5']];
export const POOL_ARTICULATIONS = MOTIFS_ART.flatMap((m) => [
  { label: 'Staccato', desc: treble([m.map((n) => q(n, { art: ['staccato'] }))]) },
  { label: 'Legato', desc: treble([m.map((n, i) => q(n, i === 0 ? { slurStart: true } : i === m.length - 1 ? { slurEnd: true } : {}))]) },
  { label: 'Tenuto', desc: treble([m.map((n) => q(n, { art: ['tenuto'] }))]) },
  { label: 'Accent', desc: treble([m.map((n, i) => q(n, i % 2 === 0 ? { art: ['accent'] } : {}))]) },
]);

/* ---------------------------------------------------------------- ornements */
export const ORNEMENTS = ['Trille', 'Mordant', 'Mordant supérieur', 'Appoggiature'];
const AU_DESSUS = { G5: 'A5', E5: 'F5', C5: 'D5', A5: 'B5', D5: 'E5' };
export const POOL_ORNEMENTS = Object.entries(AU_DESSUS).flatMap(([n, haut]) => [
  { label: 'Trille', desc: treble([[{ n: [n], d: 'half', dots: 0, art: ['trill'] }]]) },
  { label: 'Mordant', desc: treble([[{ n: [n], d: 'half', dots: 0, art: ['mordent'] }]]) },
  { label: 'Mordant supérieur', desc: treble([[{ n: [n], d: 'half', dots: 0, art: ['mordentInverted'] }]]) },
  { label: 'Appoggiature', desc: treble([[{ n: [n], d: 'quarter', dots: 0, grace: [haut] }]]) },
]);

/* ---------------------------------------------------------------- signes de reprise */
export const REPRISES = ['Barres de reprise', 'Première et deuxième fins', 'Segno', 'Coda', 'D.C. (Da Capo)', 'D.S. (Dal Segno)'];
const mesure4 = (notes, extra = {}) => ({ events: notes.map((n) => q(n)), ...extra });
export const POOL_REPRISES = [
  { label: 'Barres de reprise', desc: treble([mesure4(['C5', 'D5', 'E5', 'F5'], { repeatStart: true }), mesure4(['G5', 'A5', 'B5', 'C6'], { repeatEnd: true })]) },
  { label: 'Barres de reprise', desc: treble([mesure4(['E5', 'E5', 'F5', 'G5'], { repeatStart: true }), mesure4(['G5', 'F5', 'E5', 'D5'], { repeatEnd: true })]) },
  { label: 'Première et deuxième fins', desc: treble([mesure4(['C5', 'D5', 'E5', 'F5'], { repeatStart: true }), { events: [{ n: ['G5'], d: 'half', dots: 0 }, { n: ['F5'], d: 'half', dots: 0 }], volta: [1], repeatEnd: true }, { events: [{ n: ['G5'], d: 'half', dots: 0 }, { n: ['C5'], d: 'half', dots: 0 }], volta: [2] }]) },
  { label: 'Première et deuxième fins', desc: treble([mesure4(['E5', 'D5', 'C5', 'D5'], { repeatStart: true }), { events: [{ n: ['E5'], d: 'half', dots: 0 }, { n: ['D5'], d: 'half', dots: 0 }], volta: [1], repeatEnd: true }, { events: [{ n: ['C5'], d: 'whole', dots: 0 }], volta: [2] }]) },
  ...['G5', 'E5'].map((n) => ({ label: 'Segno', desc: treble([[whole(n, { sign: 'segno' })]]) })),
  ...['G5', 'E5'].map((n) => ({ label: 'Coda', desc: treble([[whole(n, { sign: 'coda' })]]) })),
  ...['C5', 'G5'].map((n) => ({ label: 'D.C. (Da Capo)', desc: treble([[q('E5'), q('D5'), q('C5'), q(n, { lyric: 'D.C. al Fine' })]]) })),
  ...['C5', 'G5'].map((n) => ({ label: 'D.S. (Dal Segno)', desc: treble([[q('E5'), q('D5'), q('C5'), q(n, { lyric: 'D.S. al Coda' })]]) })),
];

/* ---------------------------------------------------------------- nuances et tempo */
export const NUANCES_TEMPO = ['Très doux', 'Doux', 'Assez doux', 'Assez fort', 'Fort', 'Très fort', 'Crescendo', 'Decrescendo', 'Très lent', 'Lent', 'Modéré', 'Vif', 'Très rapide'];
const mot = (t) => `<span class="invite-texte" style="font:italic 700 2rem/1.2 'Fraunces',Georgia,serif">${t}</span>`;
const soufflet = (ouvre) => `<svg viewBox="0 0 120 40" width="150" height="50" role="img" aria-label="Soufflet ${ouvre ? 'qui s’ouvre' : 'qui se referme'}" style="color:currentColor"><path d="${ouvre ? 'M4 20 L116 6 M4 20 L116 34' : 'M4 6 L116 20 M4 34 L116 20'}" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
export const POOL_NUANCES_TEMPO = [
  { label: 'Très doux', html: mot('pp'), type: 'nuance' }, { label: 'Doux', html: mot('p'), type: 'nuance' }, { label: 'Assez doux', html: mot('mp'), type: 'nuance' },
  { label: 'Assez fort', html: mot('mf'), type: 'nuance' }, { label: 'Fort', html: mot('f'), type: 'nuance' }, { label: 'Très fort', html: mot('ff'), type: 'nuance' },
  { label: 'Crescendo', html: mot('cresc.'), type: 'nuance' }, { label: 'Crescendo', html: soufflet(true), type: 'nuance' },
  { label: 'Decrescendo', html: mot('dim.'), type: 'nuance' }, { label: 'Decrescendo', html: soufflet(false), type: 'nuance' },
  { label: 'Très lent', html: mot('Largo'), type: 'tempo' }, { label: 'Lent', html: mot('Adagio'), type: 'tempo' }, { label: 'Modéré', html: mot('Andante'), type: 'tempo' },
  { label: 'Modéré', html: mot('Moderato'), type: 'tempo' }, { label: 'Vif', html: mot('Allegro'), type: 'tempo' }, { label: 'Très rapide', html: mot('Presto'), type: 'tempo' },
];

/* ---------------------------------------------------------------- notes étrangères et chromatisme */
export const NOTES_ETRANGERES = ['Note de passage', 'Note voisine', 'Note de l’accord', 'Gamme chromatique'];
const sur = (notes, accord) => treble([notes.map((n, i) => q(n, i === 0 && accord ? { lyric: `${accord} majeur` } : {}))]);
export const POOL_NOTES_ETRANGERES = [
  ...[['C5', 'D5', 'E5', 'Do'], ['E5', 'F5', 'G5', 'Do'], ['G5', 'F5', 'E5', 'Do'], ['E5', 'D5', 'C5', 'Do'], ['F5', 'G5', 'A5', 'Fa'], ['A5', 'G5', 'F5', 'Fa'], ['G5', 'A5', 'B5', 'Sol'], ['B5', 'A5', 'G5', 'Sol']]
    .map(([a, b, c, acc]) => ({ label: 'Note de passage', desc: sur([a, b, c], acc) })),
  ...[['C5', 'D5', 'C5', 'Do'], ['E5', 'F5', 'E5', 'Do'], ['G5', 'A5', 'G5', 'Do'], ['E5', 'D5', 'E5', 'Do'], ['F5', 'G5', 'F5', 'Fa'], ['A5', 'G5', 'A5', 'Fa'], ['G5', 'A5', 'G5', 'Sol'], ['B5', 'A5', 'B5', 'Sol']]
    .map(([a, b, c, acc]) => ({ label: 'Note voisine', desc: sur([a, b, c], acc) })),
  ...[['C5', 'E5', 'G5', 'Do'], ['G5', 'E5', 'C5', 'Do'], ['F5', 'A5', 'C6', 'Fa'], ['C6', 'A5', 'F5', 'Fa'], ['G5', 'B5', 'D6', 'Sol'], ['D6', 'B5', 'G5', 'Sol'], ['E5', 'G5', 'E5', 'Do'], ['A5', 'F5', 'C6', 'Fa']]
    .map(([a, b, c, acc]) => ({ label: 'Note de l’accord', desc: sur([a, b, c], acc) })),
  ...[['C5', 'C#5', 'D5', 'D#5'], ['E5', 'F5', 'F#5', 'G5'], ['G5', 'F#5', 'F5', 'E5'], ['A5', 'Bb5', 'B5', 'C6'], ['D6', 'C#6', 'C6', 'B5'], ['F5', 'F#5', 'G5', 'G#5'], ['B5', 'Bb5', 'A5', 'Ab5'], ['D5', 'D#5', 'E5', 'F5']]
    .map((nn) => ({ label: 'Gamme chromatique', desc: sur(nn, null) })),
];

/* ---------------------------------------------------------------- forme musicale */
export const FORMES = ['Binaire (A B)', 'Ternaire (A B A)', 'Thème et variations'];
const schema = (t) => `<span class="invite-texte" style="font:700 1.6rem/1.3 'Fraunces',Georgia,serif;letter-spacing:.04em">${t}</span>`;
const phrase = (t) => `<span class="invite-texte" style="font:600 1.1rem/1.4 Inter,system-ui,sans-serif">${t}</span>`;
export const POOL_FORMES = [
  { label: 'Binaire (A B)', html: schema('A &nbsp;B') }, { label: 'Binaire (A B)', html: schema('A A &nbsp;B B') }, { label: 'Binaire (A B)', html: phrase('Deux sections contrastées, l’une après l’autre, sans retour à la première.') },
  { label: 'Ternaire (A B A)', html: schema('A &nbsp;B &nbsp;A') }, { label: 'Ternaire (A B A)', html: schema('Menuet &nbsp;·&nbsp; Trio &nbsp;·&nbsp; Menuet') }, { label: 'Ternaire (A B A)', html: phrase('Après une section contrastante, la première section revient.') },
  { label: 'Thème et variations', html: schema('Thème &nbsp;Var. 1 &nbsp;Var. 2 &nbsp;Var. 3') }, { label: 'Thème et variations', html: schema('A &nbsp;A’ &nbsp;A’’ &nbsp;A’’’') }, { label: 'Thème et variations', html: phrase('Une mélodie simple est reprise plusieurs fois, chaque fois transformée (rythme, ornements, harmonie, mode) mais reconnaissable.') },
];

/* ---------------------------------------------------------------- fonction des accords (substitution) */
export const FONCTIONS = ['Tonique', 'Sous-dominante', 'Dominante'];
export const NOMS_DEGRES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export const POOL_FONCTIONS = [
  ...[0, 5, 2].map((deg) => ({ label: 'Tonique', deg })), ...[3, 1, 3].map((deg) => ({ label: 'Sous-dominante', deg })), ...[4, 6, 4].map((deg) => ({ label: 'Dominante', deg })),
];

/* ---------------------------------------------------------------- basse chiffrée */
export const CHIFFRAGES = ['Position fondamentale', 'Premier renversement (6)', 'Second renversement (6/4)'];
const OCT = (nom, k) => nom.replace(/-?\d+$/, (o) => String(Number(o) + k));
/** Triade du degré `g` de Do majeur dans la position `pos` (0 fondamentale, 1 premier renversement, 2 second), dans le grave pour la clé de Fa : de la basse vers l'aigu. */
export function triadeBasse(g, pos) {
  const base = accordDuDegre(0, g).map((n) => OCT(n, -2));
  if (pos === 0) return base;
  if (pos === 1) return [base[1], base[2], OCT(base[0], 1)];
  return [base[2], OCT(base[0], 1), OCT(base[1], 1)];
}
export const POOL_CHIFFRAGES = [0, 3, 4, 1, 5, 2].flatMap((g) => CHIFFRAGES.map((label, pos) => ({ label, desc: { clef: 'bass', key: 0, measures: [[whole(triadeBasse(g, pos))]] } })));
