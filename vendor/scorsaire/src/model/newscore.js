// New score: builds a complete work from the answers of the "new score" assistant (rules of MuseScore 4.7.5 `masternotation.cpp`,
// `createMeasures` / `applyOptions`). Pure: no DOM. The result is a work with a clean history (the assistant replaces the document).
import { createWork, createMovement, createMasterbar, createTempo, createSystemContainer } from './elements.js';
import { SECTION_CATEGORIES } from './sections.js';
import { createDocument } from './document.js';
import { PID } from './pid.js';
import { frac, fLt, ZERO } from './fraction.js';
import { addTrack, addTrackFromInstrument } from './trackedit.js';
import { applyTemplate } from './templateedit.js';
import { linkStaff } from './linkedstaff.js';
import { getProperty } from './props.js';
import { derivedInputGrid, equalStarts } from './inputgrid.js';
import { measureLengthOf } from './timing.js';

export const NEW_SCORE_DEFAULTS = Object.freeze({
  measures: 24, timeSig: [4, 4], timeSigStyle: 'normal', keySig: 0, pickup: null, tempo: null,
});
export const NEW_SCORE_LIMITS = Object.freeze({ minMeasures: 1, maxMeasures: 999, denominators: [1, 2, 4, 8, 16, 32, 64], maxNumerator: 99 });
/** Quick start: one staff in treble clef, 4/4, C major, default measures. */
export const QUICK_START_PARTS = Object.freeze([{ staffType: 'score', clef: 'G' }]);

export class NewScoreError extends Error {
  constructor(code, message) { super(message); this.name = 'NewScoreError'; this.code = code; }
}

const isPair = (v) => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]);

/**
 * Checks and completes the options. Throws NewScoreError(code) on the first problem.
 * options: { timeSigs: [[n, d], …] one signature per measure (optional, instead of `timeSig` alone), title, subtitle, composer, lyricist, parts, template, measures, timeSig, timeSigStyle, keySig, pickup: [n, d] | null,
 *            tempo: { bpm, beatUnit: { base, dots } } | null, lang, chordTrack: boolean (default false: the assistant asks for it by default) }
 */
export function normalizeNewScoreOptions(input = {}) {
  const o = { ...NEW_SCORE_DEFAULTS, ...input };
  if (!Number.isInteger(o.measures) || o.measures < NEW_SCORE_LIMITS.minMeasures || o.measures > NEW_SCORE_LIMITS.maxMeasures) {
    throw new NewScoreError('measures', `Number of measures must be ${NEW_SCORE_LIMITS.minMeasures}..${NEW_SCORE_LIMITS.maxMeasures}`);
  }
  if (!isPair(o.timeSig) || o.timeSig[0] < 1 || o.timeSig[0] > NEW_SCORE_LIMITS.maxNumerator || !NEW_SCORE_LIMITS.denominators.includes(o.timeSig[1])) {
    throw new NewScoreError('timeSig', 'Invalid time signature');
  }
  if (o.timeSigs != null && (!Array.isArray(o.timeSigs) || o.timeSigs.some((ts) => !isPair(ts) || ts[0] < 1 || ts[0] > NEW_SCORE_LIMITS.maxNumerator || !NEW_SCORE_LIMITS.denominators.includes(ts[1])))) {
    throw new NewScoreError('timeSig', 'Invalid time signature');
  }
  if (!['normal', 'common', 'cut'].includes(o.timeSigStyle)) throw new NewScoreError('timeSigStyle', 'Invalid time signature style');
  if (!Number.isInteger(o.keySig) || o.keySig < -7 || o.keySig > 7) throw new NewScoreError('keySig', 'Key signature must be -7..7');
  if (o.pickup !== null) {
    if (!isPair(o.pickup) || o.pickup[0] < 1 || o.pickup[1] < 1) throw new NewScoreError('pickup', 'Invalid pickup length');
    const len = frac(o.pickup[0], o.pickup[1]);
    if (!fLt(ZERO, len) || !fLt(len, frac(o.timeSig[0], o.timeSig[1]))) throw new NewScoreError('pickup', 'The pickup must be shorter than a measure');
    o.pickup = len;
  }
  if (o.tempo !== null) {
    if (!o.tempo || !(o.tempo.bpm >= 5 && o.tempo.bpm <= 999)) throw new NewScoreError('tempo', 'Tempo must be 5..999');
  }
  if (!Array.isArray(o.parts)) o.parts = QUICK_START_PARTS;
  o.chordTrack = o.chordTrack === true;
  if (typeof o.chordTrackName !== 'string' || !o.chordTrackName.trim()) o.chordTrackName = null;
  return o;
}

/**
 * Builds the work. `parts` = list of { instrumentId } | { staffType, clef? }; `template` (optional) = a template object applied after the parts.
 * With no part and no template the score is created with no track (the user adds them in the tracks panel).
 */
export function createScore(input = {}) {
  const o = normalizeNewScoreOptions(input);
  const total = o.pickup ? o.measures + 1 : o.measures;
  const masterbars = [];
  for (let i = 0; i < total; i += 1) {
    const props = {};
    if (o.timeSigStyle !== 'normal') props[PID.TIME_SIG_STYLE] = o.timeSigStyle; // every measure: a change of style would be drawn as a new signature
    if (i === 0 && o.pickup) props[PID.MEASURE_LENGTH] = o.pickup;
    masterbars.push(createMasterbar({ timeSig: o.timeSigs?.[i] ?? o.timeSig, keySig: o.keySig, props }));
  }
  const movement = createMovement({ masterbars });
  const work = createWork({
    title: o.title ?? '',
    movements: [movement],
    props: Object.fromEntries([[PID.SUBTITLE, o.subtitle], [PID.COMPOSER, o.composer], [PID.LYRICIST, o.lyricist]].filter(([, v]) => typeof v === 'string' && v.trim())),
  });
  const builder = createDocument(work);
  builder.transaction('new score', () => {
    // the chord track: always the FIRST track of a movement (the model puts it on top whatever the order here), by default in a new score
    if (o.chordTrack) addTrack(builder, movement, { staves: [{ type: 'chord' }], name: o.chordTrackName ?? 'Chords', abbreviation: 'Ch' });
    for (const part of o.parts) {
      if (part.instrumentId) addTrackFromInstrument(builder, movement, part.instrumentId, { lang: o.lang ?? 'en' });
      else addTrack(builder, movement, { staves: [{ type: part.staffType ?? 'score', clef: part.clef ?? 'G' }], name: part.name ?? '' });
    }
    if (o.template) applyTemplate(builder, movement, o.template, { mode: 'add', lang: o.lang ?? 'en' });
    // the chord track of a new score has TWO cells per measure (a chord per half measure), not one per beat (decision of Jean, 2026-11-07); a measure that already has two cells or fewer, and a pickup, keep the grid of the time signature
    if (o.chordTrack) {
      movement.masterbars.forEach((bar) => {
        if (getProperty(bar, PID.MEASURE_LENGTH)) return;
        const starts = derivedInputGrid(bar).length > 2 ? equalStarts(measureLengthOf(bar), 2) : null;
        if (starts) builder.set(bar, PID.INPUT_GRID, starts);
      });
    }
    if (o.tempo) {
      builder.add(movement, 'tempos', createTempo({
        measureId: movement.masterbars[0].id, position: [0, 1], bpm: o.tempo.bpm, beatUnit: o.tempo.beatUnit ?? { base: 'quarter', dots: 0 }, followText: true,
      }));
    }
  });
  return builder.work;
}

/** A fresh document for the work, with an empty history (the assistant replaces the whole document). */
export function createNewScoreDocument(input = {}) {
  return createDocument(createScore(input));
}


const STARTER_NAMES = Object.freeze({
  fr: { guitars: [['Guitare 1', 'Guit. 1'], ['Guitare 2', 'Guit. 2']], bass: ['Basse', 'Basse'] },
  en: { guitars: [['Guitar 1', 'Gtr. 1'], ['Guitar 2', 'Gtr. 2']], bass: ['Bass', 'Bs.'] },
});

/**
 * The score the application opens on: a chord track, two guitars and a bass (each a notation staff with its tablature under it, the first guitar also a free rhythm staff) and a drum kit, over 24 empty measures.
 * Everything stays editable in the tracks panel.
 */
export function createStarterScore({ lang = 'en' } = {}) {
  const names = STARTER_NAMES[lang] ?? STARTER_NAMES.en;
  const withTab = [{ type: 'score' }, { type: 'tab' }];
  const template = {
    id: 'starter', name: 'Starter', order: null, source: 'user',
    parts: [
      ...names.guitars.map(([name, abbreviation], k) => ({ instrument: 'guitar-steel', name, abbreviation, staves: k === 0 ? [...withTab, { type: 'rhythm' }] : withTab })), // the first guitar also has a free rhythm staff (strum off)
      { instrument: 'bass-guitar', name: names.bass[0], abbreviation: names.bass[1], staves: withTab },
      { instrument: 'drum-kit-5', staves: [{ type: 'percussion', lineCount: 5, clef: 'PERC' }] },
    ],
    groups: [],
  };
  const work = createScore({ title: '', parts: [], template, chordTrack: true, chordTrackName: lang === 'fr' ? 'Accords' : 'Chords', lang });
  // the tablature of each fretted track is LINKED to its notation staff: one content, two ways to read it (the empty copy it was created with is dropped)
  const doc = createDocument(work);
  doc.transaction('link tablatures', () => {
    for (const track of work.movements[0].tracks) {
      const score = track.staves.find((s) => getProperty(s, PID.STAFF_TYPE) === 'score');
      const tab = track.staves.find((s) => getProperty(s, PID.STAFF_TYPE) === 'tab');
      if (score && tab) linkStaff(doc, work.movements[0], tab, score);
    }
  });
  return doc.work;
}

/**
 * Puts the sections marked while tapping on a freshly made score: `list` = [{ measure (index), label, category }]. One section per measure; a name is at most 40 characters; an unknown category is
 * `custom`. For a work that is not in a document yet (the score made from the music): the containers are part of its starting state, with nothing to undo.
 */
export function applyTapSections(work, list) {
  const mv = work.movements[0]; const seen = new Set();
  for (const s of list ?? []) {
    const bar = mv.masterbars[s.measure]; const text = String(s.label ?? '').trim().slice(0, 40);
    if (!bar || !text || seen.has(bar.id)) continue;
    seen.add(bar.id);
    mv.systemContainers.push(createSystemContainer({ measureId: bar.id, kind: 'section', label: text, category: SECTION_CATEGORIES.includes(s.category) ? s.category : 'custom' }));
  }
}
