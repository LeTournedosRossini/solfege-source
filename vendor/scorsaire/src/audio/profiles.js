/*
 * Profils d'articulations de la lecture — port de la chaîne MPE de MuseScore 4.7.5 (`framework/mpe/mpetypes.h` : `ArticulationMap::preCalculateAverageData`,
 * `events.h` : `NoteEvent::calculateActualDuration` / `calculateActualTimestamp` / `calculateExpressionCurve`, `fluidsequencer.cpp` : `noteVelocity`,
 * `symbolsmetaparser.cpp` : signe → types d'articulation). Les valeurs des profils (`general_*_articulations_profile.json`) sont extraites par
 * `tools/extract-articulation-profiles.py` dans `articulation-profiles.json` (types portés : Standard, Accent, Marcato, SoftAccent, Staccato,
 * Staccatissimo, Tenuto, LaissezVibrer, GhostNote, DiscreteGlissando, ContinuousGlissando (+ sa courbe de hauteur), Acciaccatura, PreAppoggiatura, PostAppoggiatura, Arpeggio et ses 4 variantes, Tremolo8th à 64th, TremoloBuzz).
 *
 * Règle d'un accord (les notes de l'accord partagent la même carte d'articulations) :
 *  - la carte = un motif par type d'articulation du signe ; carte vide = « Standard » ;
 *  - durée jouée = durée nominale × facteur moyen (un seul type : son facteur ; sinon somme / nombre, division entière) ;
 *  - décalage d'attaque = durée nominale × décalage moyen (somme / nombre de types qui en ont un) — nul pour tous les types portés ;
 *  - niveau de dynamique : `niveau nominal + max(écart moyen, 500) × (pic moyen − 5000) / 500` où le pic moyen d'un type seul est le pic de sa
 *    courbe, et pour plusieurs types somme des pics (de TOUS les types) / nombre de types dont le pic n'est pas « natural » (5000) ; la courbe moyenne
 *    (somme des courbes « significatives » / leur nombre) est ramenée à ce niveau, et la vélocité vient du PIC de la courbe obtenue
 *    (`expressionLevel(courbe.maxAmplitudeLevel())`). Un accent de clavier (pic 6000) ajoute donc 1000 au niveau nominal (+2 pas), un accent de cordes (7000) 2000.
 *    Aucun écart de dynamique n'est déclaré pour ces motifs (« occupiedDynamicChangesRange » = 0), d'où le 500 plancher.
 *
 * Écarts / limites : la famille (profil) d'un instrument vient de MuseSounds chez MuseScore (hors dépôt) ; ici elle est déduite du GROUPE du catalogue
 * d'instruments (claviers et anches libres → clavier, cordes frottées et pincées → cordes, bois et cuivres → vents, voix → voix, percussions → percussion,
 * sinon `general` = valeurs des vents) — choix de Scorsaire, réglable par piste (`options.profiles[idPiste]`). Un type d'articulation absent du profil prend
 * le motif Standard (`profile->pattern(type, Standard)`). Notes liées : voir `sequence.js`.
 */
import data from './articulation-profiles.json' with { type: 'json' };

const TABLES = Object.freeze({ ...data, general: data.winds });
export const PROFILE_NAMES = Object.freeze(Object.keys(TABLES));

const NATURAL = 5000;
const LEVEL_STEP = 500;

/** Groupe du catalogue d'instruments → profil. */
const GROUP_PROFILE = Object.freeze({
  keyboards: 'keyboard', 'free-reed': 'keyboard', strings: 'strings', 'plucked-strings': 'strings', woodwinds: 'winds', brass: 'winds', vocals: 'voice',
  'pitched-percussion': 'percussion', 'unpitched-percussion': 'percussion', 'marching-percussion': 'percussion', 'body-percussion': 'percussion',
});

/**
 * Nom du profil d'une piste/portée : celui demandé (`overrides[trackId]`), sinon 'percussion' pour une portée de percussion, 'keyboard' pour la main gauche
 * d'accordéon (décision de Jean, 08/10/2026), sinon celui du groupe de l'instrument, sinon 'general'.
 */
export function profileFor({ trackId, staffType, group = null }, overrides = {}) {
  const wanted = overrides[trackId];
  if (wanted && TABLES[wanted]) return wanted;
  if (staffType === 'percussion' || staffType === 'rhythm' || staffType === 'neutral') return 'percussion';
  if (staffType === 'accordion-left') return 'keyboard';
  // Portée d'accords : instrument à cordes → profil cordes (guitare), sinon clavier (piano) — `resolveChordSymbolsSetupData` de MuseScore 4.7.5.
  if (staffType === 'chord') return GROUP_PROFILE[group] === 'strings' ? 'strings' : 'keyboard';
  // a tablature staff is a plucked-string staff: without a catalogued instrument it still plays like strings (bends, dives…) instead of the
  // general (winds) profile, which would play a bend as two ordinary notes
  if (staffType === 'tab') return GROUP_PROFILE[group] ?? 'strings';
  return GROUP_PROFILE[group] ?? 'general';
}

/** Signe d'articulation de Scorsaire → types d'articulation MuseScore (`SymbolsMetaParser::symbolToArticulations`). Les autres signes n'ont pas d'effet ici. */
const SCORSAIRE_TO_MPE = Object.freeze({
  accent: ['Accent'], staccato: ['Staccato'], tenuto: ['Tenuto'], marcato: ['Marcato'], staccatissimo: ['Staccatissimo'],
  portato: ['Tenuto', 'Staccato'], accentStaccato: ['Accent', 'Staccato'], marcatoStaccato: ['Marcato', 'Staccato'],
  marcatoTenuto: ['Marcato', 'Tenuto'], tenutoAccent: ['Tenuto', 'Accent'], laissezVibrer: ['LaissezVibrer'],
  // Ornements (`symbolToArticulations`) d'après le DESSIN du signe, pas son nom : « mordent » est le glyphe SANS trait (SMuFL `ornamentShortTrill`,
  // mordant supérieur, `UpperMordent`), « mordentInverted » le glyphe AVEC trait (SMuFL `ornamentMordent`, mordant inférieur, `LowerMordent`).
  // Trille (`SymId::ornamentTrill`, style par défaut → `Trill`) ; `trillBaroque` = pseudo-signe interne : `trill` avec `ornamentStyle: 'baroque'` (`TrillBaroque`).
  trill: ['Trill'], trillBaroque: ['TrillBaroque'],
  mordent: ['UpperMordent'], mordentInverted: ['LowerMordent'], turn: ['Turn'], turnInverted: ['InvertedTurn'],
});

/** Types d'ornement joués (rendus par `ornaments.js`, pas par le profil). */
export const ORNAMENT_TYPES = Object.freeze(['Trill', 'TrillBaroque', 'UpPrall', 'PrallDown', 'LinePrall', 'UpperMordent', 'LowerMordent', 'Turn', 'InvertedTurn']);

/** Type d'ornement de Scorsaire (`PID.GRACE_TYPE`) → type d'articulation (`GraceNotesMetaParser`). */
export const GRACE_TYPE_TO_MPE = Object.freeze({
  acciaccatura: 'Acciaccatura', appoggiatura: 'PreAppoggiatura', grace4: 'PreAppoggiatura', grace16: 'PreAppoggiatura', grace32: 'PreAppoggiatura',
  grace8after: 'PostAppoggiatura', grace16after: 'PostAppoggiatura', grace32after: 'PostAppoggiatura',
});

/** Arpège de Scorsaire (`PID.ARPEGGIO.type`) → type d'articulation (`ArpeggioMetaParser`) ; le crochet ne se joue pas. */
export const ARPEGGIO_TYPE_TO_MPE = Object.freeze({
  normal: 'Arpeggio', up: 'ArpeggioUp', down: 'ArpeggioDown', upStraight: 'ArpeggioStraightUp', downStraight: 'ArpeggioStraightDown',
});

/** Types MuseScore d'une liste de signes (sans doublon, ordre d'apparition). */
export function mpeTypesOf(scorsaireTypes) {
  const out = [];
  for (const t of scorsaireTypes) for (const m of SCORSAIRE_TO_MPE[t] ?? []) if (!out.includes(m)) out.push(m);
  return out;
}

/** Les signes de Scorsaire dont MuseScore tient compte en lecture. */
export const PLAYED_ARTICULATIONS = Object.freeze(Object.keys(SCORSAIRE_TO_MPE));

const truncDiv = (a, b) => Math.trunc(a / b);
const pattern = (table, type) => table[type] ?? table.Standard;

/** Carte d'articulations d'un accord : motifs des types (carte vide → Standard). */
function mapOf(profile, mpeTypes) {
  const table = TABLES[profile] ?? TABLES.general;
  const types = mpeTypes.length ? mpeTypes : ['Standard'];
  return types.map((type) => pattern(table, type));
}

/** Facteur de durée moyen d'une carte (fraction, 1 = durée nominale). */
function averageDuration(entries) {
  const d = entries.length === 1 ? entries[0].d : truncDiv(entries.reduce((s, e) => s + e.d, 0), entries.length);
  return d / 10000;
}

/**
 * Effet des articulations d'un accord.
 * @param profile      nom du profil
 * @param mpeTypes     types MuseScore (`mpeTypesOf`), vide = Standard
 * @param nominalLevel niveau de nuance nominal (0-10000)
 * @returns {{ durationFactor: number, timestampFactor: number, level: number }}
 *   `level` = niveau de dynamique final dont on tire la vélocité (`velocityFromLevel`).
 */
export function articulationEffect(profile, mpeTypes, nominalLevel) {
  const entries = mapOf(profile, mpeTypes);
  const n = entries.length;
  const durationFactor = averageDuration(entries);

  let timestampOffset = 0;
  if (n === 1) timestampOffset = entries[0].s;
  else {
    const withOffset = entries.filter((e) => e.s !== 0);
    if (withOffset.length) timestampOffset = truncDiv(withOffset.reduce((s, e) => s + e.s, 0), withOffset.length);
  }

  // Dynamique
  const meaningful = entries.filter((e) => e.peak !== NATURAL);
  let articulationLevel;
  let curve;
  if (n === 1) {
    articulationLevel = entries[0].peak;
    curve = entries[0].c ?? null;
  } else if (meaningful.length) {
    articulationLevel = truncDiv(entries.reduce((s, e) => s + e.peak, 0), meaningful.length);
    const sum = new Array(11).fill(0);
    for (const e of meaningful) e.c.forEach((v, i) => { sum[i] += v; });
    curve = sum.map((v) => truncDiv(v, meaningful.length));
  } else {
    articulationLevel = entries[0].peak;
    curve = entries[0].c ?? null;
  }

  const peakOf = (c) => c.reduce((best, v) => (Math.abs(best) < Math.abs(v) ? v : best), c[0]);
  const factor = (articulationLevel - NATURAL) / LEVEL_STEP;
  const amplification = Math.trunc(Math.fround(LEVEL_STEP * factor)); // écart moyen déclaré : 0 → plancher 500
  const actual = nominalLevel + amplification;
  let level;
  if (!curve || actual === articulationLevel || articulationLevel === 0) level = curve ? peakOf(curve) : actual;
  else level = Math.round(Math.fround(peakOf(curve) * Math.fround(actual / articulationLevel)));
  // Carte « Standard » (courbe plate à 5000 non conservée) : le pic suit le niveau nominal.
  if (!curve) level = actual;
  return { durationFactor, timestampFactor: timestampOffset / 10000, level };
}

/** Facteur de durée moyen d'une carte (note liée : sa durée est ajoutée au facteur près si elle porte une articulation autre que Standard). */
export function averageDurationFactor(profile, mpeTypes) {
  return averageDuration(mapOf(profile, mpeTypes));
}

/** Type d'articulation MuseScore d'un trémolo à `strokes` barres (`TremoloMetaParser` : R8…R64) ; 5 et 6 barres reprennent le motif du 64e (extension de Scorsaire). */
export function tremoloTypeOfStrokes(strokes) {
  return ['Tremolo8th', 'Tremolo16th', 'Tremolo32nd', 'Tremolo64th'][Math.min(Math.max(strokes, 1), 4) - 1];
}

/** Le profil a-t-il un motif pour ce type ? (`TremoloBuzz` n'existe que dans le profil de percussion : ailleurs la note reste « Standard ».) */
export function profileHas(profile, type) {
  return Boolean((TABLES[profile] ?? TABLES.general)[type]);
}

/** Courbe de HAUTEUR du glissando continu du profil (`pitchPattern` : 11 valeurs en centièmes de la plage, 0..100 % par 10 %), ou null sans motif. */
export function glissandoPitchPattern(profile) {
  return (TABLES[profile] ?? TABLES.general).ContinuousGlissando?.pc ?? null;
}
