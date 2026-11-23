/*
 * Tempo — tables et conversions (fonctions pures, sans DOM). Port de MuseScore 4.7.5 :
 *   `tempotext.cpp` (TempoText : sortes, unités de battement, lecture du texte « ♩ = 92 », bornes 5..999),
 *   `gradualtempochange.cpp` (facteurs par défaut des changements graduels), `fermata.cpp` (étirement du temps),
 *   `palettecreator.cpp` (valeurs des mots de tempo italiens).
 * Le calcul de la ligne de temps (position → secondes) est dans tempomap.js.
 *
 * Représentation interne d'un tempo : `wps` = NOTES RONDES par seconde (nombre). MuseScore compte en noires par seconde (`BeatsPerSecond`) :
 * wps = qps / 4. Un tempo « écrit » reste `{ bpm, beatUnit }` dans le modèle (jamais converti en place) : « ♩. = 80 » reste « ♩. = 80 ».
 * Les décimaux n'apparaissent qu'ici et dans tempomap.js (les POSITIONS restent des fractions exactes).
 */
import { DURATION_VALUE } from './pitch.js';
import { frac, fAdd, fMul, fToNumber } from './fraction.js';

/** Bornes de MuseScore (`MIN_TEMPO`, `MAX_TEMPO`) : 5 à 999 noires par minute, en notes rondes par seconde. */
export const MIN_WPS = (5 / 60) / 4;
export const MAX_WPS = (999 / 60) / 4;
/** Tempo par défaut de MuseScore (`Constants::DEFAULT_TEMPO` = 2 noires par seconde = 120 bpm), en notes rondes par seconde. */
export const DEFAULT_WPS = 0.5;
/** `TEMPO_PRECISION` : arrondi à 6 décimales (en noires par seconde). */
export const roundWps = (wps) => Math.round(wps * 4 * 1e6) / 1e6 / 4;

export const TEMPO_KINDS = ['normal', 'relative', 'aTempo', 'tempoPrimo'];

/** Unité de battement par défaut : la noire. */
export const QUARTER_UNIT = Object.freeze({ base: 'quarter', dots: 0 });

/** Durée d'une unité de battement `{ base, dots }` en fraction de ronde (noire pointée = 3/8). */
export function beatUnitFraction(unit) {
  const base = DURATION_VALUE[unit.base];
  if (!base) throw new Error(`Unité de battement inconnue : ${unit.base}`);
  let f = base;
  let add = base;
  for (let i = 0; i < (unit.dots ?? 0); i++) {
    add = fMul(add, frac(1, 2));
    f = fAdd(f, add);
  }
  return f;
}

/** Tempo écrit `bpm` (battements par minute dans `unit`) → notes rondes par seconde, borné comme MuseScore. */
export function wpsFromBpm(bpm, unit = QUARTER_UNIT) {
  const wps = (bpm * fToNumber(beatUnitFraction(unit))) / 60;
  return roundWps(Math.min(MAX_WPS, Math.max(MIN_WPS, wps)));
}

/** Inverse : battements par minute dans `unit` pour un tempo en notes rondes par seconde. */
export const bpmFromWps = (wps, unit = QUARTER_UNIT) => (wps * 60) / fToNumber(beatUnitFraction(unit));

/**
 * Mots de tempo italiens de la palette de MuseScore (`palettecreator.cpp` newTempoPalette) : noires par minute.
 * (MuseScore : `valeur / 60` noires par seconde ; ici le bpm tel quel, l'unité est la noire.)
 */
export const TEMPO_WORDS = Object.freeze({
  Grave: 35, Largo: 50, Lento: 52.5, Larghetto: 63, Adagio: 71, Andante: 92, Andantino: 94, Moderato: 114,
  Allegretto: 116, Allegro: 144, Vivace: 172, Presto: 187, Prestissimo: 200,
});

/**
 * Changements graduels : facteur d'arrivée par défaut selon le type (`DEFAULT_FACTORS_MAP`, gradualtempochange.cpp) et abréviation affichée
 * (`TEMPO_CHANGE_TYPES`, typesconv.cpp). Le type 'user' n'a pas de facteur propre (MuseScore : 1,0 pour un type indéfini).
 */
export const GRADUAL_TYPES = Object.freeze({
  accelerando: { factor: 1.33, text: 'accel.' },
  allargando: { factor: 0.75, text: 'allarg.' },
  calando: { factor: 0.5, text: 'calando' },
  lentando: { factor: 0.75, text: 'lentando' },
  morendo: { factor: 0.5, text: 'morendo' },
  precipitando: { factor: 1.15, text: 'precipitando' },
  rallentando: { factor: 0.75, text: 'rall.' },
  ritardando: { factor: 0.75, text: 'rit.' },
  smorzando: { factor: 0.5, text: 'smorz.' },
  sostenuto: { factor: 0.95, text: 'sost.' },
  stringendo: { factor: 1.5, text: 'string.' },
  user: { factor: 1, text: '' },
});

/** Résolutions permises d'une marche de changement graduel : croche (défaut), double croche, triple croche. */
export const CHANGE_RESOLUTIONS = Object.freeze([8, 16, 32]);

/**
 * Points d'orgue : étirement du temps par défaut selon la sorte (`Fermata::propertyDefault(TIME_STRETCH)`, fermata.cpp 4.7.5).
 * Les sortes sont les types d'articulation (glyphes SMuFL `fermata*Above` / `*Below`).
 */
export const FERMATA_STRETCH = Object.freeze({
  fermataVeryShort: 1.25,
  fermataShort: 1.5,
  fermataShortHenze: 1.5,
  fermata: 2,
  fermataLong: 3,
  fermataLongHenze: 3,
  fermataVeryLong: 4,
});

/**
 * Étirement d'un point d'orgue : élément `fermata` du Mouvement ou entrée `{ type | fermataType, timeStretch?, play? }` (migration) ;
 * `timeStretch` local sinon la table. null si le point d'orgue n'est pas joué ou sans effet.
 */
export function fermataStretch(f) {
  const props = f.props ?? f;
  if ((props.play ?? true) === false) return null;
  const base = FERMATA_STRETCH[props.fermataType ?? props.type ?? 'fermata'];
  if (base === undefined) return null;
  const s = props.timeStretch ?? base;
  return s === 1 ? null : s; // MuseScore : un étirement nul ou égal à 1 n'a aucun effet
}

// ---------- lecture du texte d'un tempo (« ♩ = 92 », « ♩ = ♩. ») : port de `TempoText::updateTempo` ----------
// Caractères de notes de la police de texte de MuseScore (zone privée SMuFL, métronome) : U+ECA5 noire, U+ECB7 point, etc.
const DOT = '';
const PATTERNS = [ // « les motifs longs avant les courts » (comme `tp[]` de MuseScore)
  ['', 'quarter', 2], ['', 'quarter', 1], ['', 'quarter', 0],
  ['', 'half', 2], ['', 'half', 1], ['', 'half', 0],
  ['', 'eighth', 2], ['', 'eighth', 1], ['', 'eighth', 0],
  ['', 'whole', 1], ['', 'whole', 0],
  ['', 'sixteenth', 1], ['', 'sixteenth', 0],
  ['', 'thirtysecond', 1], ['', 'thirtysecond', 0],
  ['', 'breve', 0], ['', 'breve', 0], ['', 'sixtyfourth', 0],
].map(([glyph, base, dots]) => ({ source: glyph + `\\s*${DOT}`.repeat(dots), base, dots }));

/** Texte d'une unité de battement, tel que l'écrit MuseScore (note + points). */
export function beatUnitText(unit) {
  const p = PATTERNS.find((q) => q.base === unit.base && q.dots === (unit.dots ?? 0));
  return p ? p.source.replace(/\\s\*/g, '') : '';
}

/**
 * Lit un texte de tempo. Renvoie `{ kind: 'normal', beatUnit, bpm }` pour « unité = nombre », `{ kind: 'relative', factor }` pour
 * « unité = unité » (modulation métrique : la 2e unité vaut la 1re de l'ancien tempo → nouveau = ancien × durée(2e) / durée(1re)),
 * ou null. Prétraitement de MuseScore : « , » → « . » ; « ≒ ≈ ~ » → « = » ; « ca. », « c. », « approx. » supprimés.
 */
export function parseTempoText(text) {
  const s = text.replace(/,/g, '.').replace(/[≒≈~]/g, '=').replace(/ca\./g, '').replace(/c\./g, '').replace(/approx\./g, '');
  for (const pa of PATTERNS) {
    const m = new RegExp(`${pa.source}\\s*=\\s*(\\d+[.]{0,1}\\d*)\\s*`).exec(s);
    if (m) return { kind: 'normal', beatUnit: { base: pa.base, dots: pa.dots }, bpm: parseFloat(m[1]) };
    for (const pb of PATTERNS) {
      if (new RegExp(`${pa.source}\\s*=\\s*${pb.source}\\s*`).test(s)) {
        const lenA = fToNumber(beatUnitFraction({ base: pa.base, dots: pa.dots }));
        const lenB = fToNumber(beatUnitFraction({ base: pb.base, dots: pb.dots }));
        return { kind: 'relative', factor: lenB / lenA };
      }
    }
  }
  return null;
}
