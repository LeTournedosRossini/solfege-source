import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
/*
 * The instruments a scale can be shown for: what the portal passes as `instrument=` (an id, or its French name) decides the first view of a pupil.
 *   family   'guitar' | 'bass' (strings: tablature and fretboard) | 'staff' (a notation staff only: piano, strings, winds…)
 *   lib      the instrument of the scale calculator (its tunings and its positions on the neck)
 *   note     the instrument of a notation note (editmodel INSTRUMENTS): its clef, its transposition, its sound; 'none' = a clef is chosen
 *   clef     'G' | 'F' (the staff of a score view); low = the lowest MIDI the root of the scale is put on (concert pitch)
 *   views    the views that make sense for it; first = the default
 */
export const SCALE_INSTRUMENTS = Object.freeze({
  // the order is the one of the selectors: the instruments of the school first (piano, guitar, bass, voice), the others after
  piano: { family: 'staff', note: 'none', clef: 'G', low: 60, views: ['score', 'keyboard'] },
  guitar6: { family: 'guitar', lib: 'guitar6', strings: 6, note: 'none', clef: 'G', low: 52, views: ['tab', 'fretboard', 'score'] },
  bass4: { family: 'bass', lib: 'bass4', strings: 4, note: 'none', clef: 'F', low: 40, views: ['tab', 'fretboard', 'score'] },
  voice: { family: 'staff', note: 'none', clef: 'G', low: 57, views: ['score', 'keyboard'] },
  guitar7: { family: 'guitar', lib: 'guitar7', strings: 7, note: 'none', clef: 'G', low: 52, views: ['fretboard', 'score'] }, // (a note holds 6 strings at most: no tablature)
  bass5: { family: 'bass', lib: 'bass5', strings: 5, note: 'none', clef: 'F', low: 35, views: ['tab', 'fretboard', 'score'] },
  violin: { family: 'staff', note: 'violin', clef: 'G', low: 55, views: ['score', 'keyboard'] },
  viola: { family: 'staff', note: 'viola', clef: 'C3', low: 48, views: ['score', 'keyboard'] },
  cello: { family: 'staff', note: 'cello', clef: 'F', low: 36, views: ['score', 'keyboard'] },
  flute: { family: 'staff', note: 'flute', clef: 'G', low: 60, views: ['score', 'keyboard'] },
  clarinet: { family: 'staff', note: 'clarinet', clef: 'G', low: 55, views: ['score', 'keyboard'] },
  sopranoSax: { family: 'staff', note: 'sopranoSax', clef: 'G', low: 56, views: ['score', 'keyboard'] },
  altoSax: { family: 'staff', note: 'altoSax', clef: 'G', low: 55, views: ['score', 'keyboard'] },
  tenorSax: { family: 'staff', note: 'tenorSax', clef: 'G', low: 48, views: ['score', 'keyboard'] },
  baritoneSax: { family: 'staff', note: 'baritoneSax', clef: 'G', low: 41, views: ['score', 'keyboard'] },
  trumpet: { family: 'staff', note: 'trumpet', clef: 'G', low: 58, views: ['score', 'keyboard'] },
  horn: { family: 'staff', note: 'horn', clef: 'G', low: 53, views: ['score', 'keyboard'] },
  trombone: { family: 'staff', note: 'trombone', clef: 'F', low: 40, views: ['score', 'keyboard'] },
  ukulele: { family: 'staff', note: 'none', clef: 'G', low: 60, views: ['score', 'keyboard'] },
  accordion: { family: 'staff', note: 'none', clef: 'G', low: 55, views: ['score', 'keyboard'] },
  harp: { family: 'staff', note: 'none', clef: 'G', low: 48, views: ['score', 'keyboard'] },
  doubleBass: { family: 'staff', note: 'doubleBass', clef: 'F', low: 40, views: ['score', 'keyboard'] },
  oboe: { family: 'staff', note: 'oboe', clef: 'G', low: 60, views: ['score', 'keyboard'] },
  bassoon: { family: 'staff', note: 'bassoon', clef: 'F', low: 41, views: ['score', 'keyboard'] },
  tuba: { family: 'staff', note: 'tuba', clef: 'F', low: 34, views: ['score', 'keyboard'] },
  piccolo: { family: 'staff', note: 'piccolo', clef: 'G', low: 74, views: ['score', 'keyboard'] },
  bassFlute: { family: 'staff', note: 'bassFlute', clef: 'G', low: 55, views: ['score', 'keyboard'] },
  recorder: { family: 'staff', note: 'none', clef: 'G', low: 72, views: ['score', 'keyboard'] },
  ebClarinet: { family: 'staff', note: 'ebClarinet', clef: 'G', low: 60, views: ['score', 'keyboard'] },
  bassClarinet: { family: 'staff', note: 'bassClarinet', clef: 'G', low: 46, views: ['score', 'keyboard'] },
});
/**
 * The FAMILIES the portal knows (« Saxophone », « Clarinette »…): one family = one or several variants (the precise instrument, which decides the transposition); the first variant is the one used
 * when only the family is known. Published in `manifest.json › instruments` so that the portal never writes our codes by hand.
 */
export const INSTRUMENT_FAMILIES = Object.freeze([
  // the order is the one the portal shows: piano, guitar, bass and voice (the school's) first
  { id: 'piano', variants: ['piano'] }, { id: 'guitar', variants: ['guitar6', 'guitar7'] }, { id: 'bass', variants: ['bass4', 'bass5'] }, { id: 'voice', variants: ['voice'] },
  { id: 'ukulele', variants: ['ukulele'] }, { id: 'accordion', variants: ['accordion'] },
  { id: 'violin', variants: ['violin'] }, { id: 'viola', variants: ['viola'] }, { id: 'cello', variants: ['cello'] }, { id: 'doubleBass', variants: ['doubleBass'] }, { id: 'harp', variants: ['harp'] },
  { id: 'flute', variants: ['flute', 'piccolo', 'bassFlute', 'recorder'] }, { id: 'clarinet', variants: ['clarinet', 'ebClarinet', 'bassClarinet'] },
  { id: 'oboe', variants: ['oboe'] }, { id: 'bassoon', variants: ['bassoon'] }, { id: 'saxophone', variants: ['altoSax', 'sopranoSax', 'tenorSax', 'baritoneSax'] },
  { id: 'trumpet', variants: ['trumpet'] }, { id: 'horn', variants: ['horn'] }, { id: 'trombone', variants: ['trombone'] }, { id: 'tuba', variants: ['tuba'] },
]);
/** Semitones between the written note and the sounding one for the transposing instruments (published to the portal; the staff of the scale is written for it). */
export const TRANSPOSITION = Object.freeze({
  clarinet: -2, ebClarinet: 3, bassClarinet: -14, sopranoSax: -2, altoSax: -9, tenorSax: -14, baritoneSax: -21, trumpet: -2, horn: -7, piccolo: 12, bassFlute: -12, doubleBass: -12,
});
/** Instruments that exist at the school but have no scale to show (the portal sends nothing for them). */
export const NO_SCALE_INSTRUMENTS = Object.freeze(['drums', 'percussion']);
export const DEFAULT_INSTRUMENT = 'piano';

/** French names and short forms accepted for `instrument=` (lower case, no accents, no spaces). */
const ALIASES = Object.freeze({
  guitare: 'guitar6', guitare6: 'guitar6', guitar: 'guitar6', guitare7: 'guitar7', basse: 'bass4', basse4: 'bass4', basse5: 'bass5', bass: 'bass4',
  piano: 'piano', clavier: 'piano', violon: 'violin', alto: 'viola', violoncelle: 'cello', flute: 'flute', clarinette: 'clarinet',
  saxsoprano: 'sopranoSax', saxophonesoprano: 'sopranoSax', saxalto: 'altoSax', saxophonealto: 'altoSax', saxtenor: 'tenorSax', saxophonetenor: 'tenorSax',
  saxbaryton: 'baritoneSax', saxophonebaryton: 'baritoneSax', trompette: 'trumpet', cor: 'horn', trombone: 'trombone',
  saxophone: 'altoSax', sax: 'altoSax', ukulele: 'ukulele', accordeon: 'accordion', harpe: 'harp', chant: 'voice', voix: 'voice', contrebasse: 'doubleBass', hautbois: 'oboe', basson: 'bassoon',
  piccolo: 'piccolo', flutepiccolo: 'piccolo', flutebasse: 'bassFlute', flutetraversiere: 'flute', flutearbec: 'recorder', flutebec: 'recorder', clarinettemib: 'ebClarinet', clarinettebasse: 'bassClarinet',
});
const key = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_KEY = new Map(Object.keys(SCALE_INSTRUMENTS).map((id) => [key(id), id]));

/** An instrument id from what a page gave (`guitar6`, `Guitare`, `saxophone alto`…); null when it is not known. */
export function parseInstrument(value) {
  const k = key(value); if (!k) return null;
  return BY_KEY.get(k) ?? ALIASES[k] ?? null;
}
/** The view a pupil sees first: the first one of the instrument (tablature for a guitar, the staff for the others). */
export const defaultView = (instrument) => (SCALE_INSTRUMENTS[instrument] ?? SCALE_INSTRUMENTS[DEFAULT_INSTRUMENT]).views[0];
export const instrumentViews = (instrument) => (SCALE_INSTRUMENTS[instrument] ?? SCALE_INSTRUMENTS[DEFAULT_INSTRUMENT]).views;

/**
 * The scale instrument of a TRACK of a score (a scale container follows the track that holds it): from the catalogue instrument of the track, else from its tablature (6 / 7 strings = a
 * guitar, 4 / 5 = a bass), else the piano. Pure; the instrument ids are those of the catalogue.
 */
const TRACK_INSTRUMENTS = Object.freeze({
  violin: 'violin', viola: 'viola', violoncello: 'cello', cello: 'cello', flute: 'flute', 'bb-clarinet': 'clarinet', clarinet: 'clarinet', 'soprano-saxophone': 'sopranoSax', 'alto-saxophone': 'altoSax',
  'tenor-saxophone': 'tenorSax', 'baritone-saxophone': 'baritoneSax', 'bb-trumpet': 'trumpet', trumpet: 'trumpet', horn: 'horn', trombone: 'trombone', piano: 'piano',
  oboe: 'oboe', bassoon: 'bassoon', tuba: 'tuba', contrabass: 'doubleBass', 'double-bass': 'doubleBass', harp: 'harp', piccolo: 'piccolo', 'bass-flute': 'bassFlute', recorder: 'recorder',
  'eb-clarinet': 'ebClarinet', 'bass-clarinet': 'bassClarinet', accordion: 'accordion', voice: 'voice',
});
export function instrumentOfTrack(track) {
  const id = String(getProperty(track, PID.INSTRUMENT_ID) ?? '');
  if (TRACK_INSTRUMENTS[id]) return TRACK_INSTRUMENTS[id];
  const tab = (track.staves ?? []).find((s) => getProperty(s, PID.STAFF_TYPE) === 'tab');
  const strings = tab ? (getProperty(tab, PID.TUNING) ?? []).length : 0;
  if (/bass/.test(id)) return strings >= 5 ? 'bass5' : 'bass4';
  if (/guitar|ukulele|banjo|mandolin/.test(id) || strings) return strings >= 7 ? 'guitar7' : strings && strings <= 4 ? 'bass4' : strings === 5 ? 'bass5' : 'guitar6';
  return TRACK_INSTRUMENTS[id] ?? DEFAULT_INSTRUMENT;
}
