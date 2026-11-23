/*
 * A scale WRITTEN in the score of the editor (the "Scales" window): into a staff of the movement from a measure (notation or tablature), or as a new SCALE MOVEMENT that also keeps the
 * recipe (`PID.SCALE_RECIPE`: what the readers use to show it for the instrument of the pupil). TO BE CALLED INSIDE `doc.transaction` (`app.edit`).
 * The notes are written with the editor's own `enterNote` (as a tap would), measure by measure, in eighths; measures are added at the end of the movement when the scale needs them.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { SID } from '../model/sid.js';
import { insertMeasures } from '../model/measureedit.js';
import { rangeFromMeasures } from '../model/range.js';
import { clearRange } from '../model/rangeedit.js';
import { addMovement } from '../model/movementedit.js';
import { addTrack, addTrackFromInstrument } from '../model/trackedit.js';
import { measureLengthOf } from '../model/timing.js';
import { tuningPitches } from '../model/capo.js';
import { EditError } from '../model/noteedit.js';
import { enterNote, DEFAULT_ENTRY } from '../ui/noteentry-intents.js';
import { createMovement, createTrack, createStaffContainer } from '../model/elements.js';
import { instrumentOfTrack } from './instruments.js';
import { scaleContent } from './display.js';
import { lib } from './index.js';
import { normalizeRecipe, scaleOf } from './recipe.js';
import { SCALE_INSTRUMENTS } from './instruments.js';
import { scaleRun, keyFifthsFor } from './document.js';
import { INSTRUMENTS, GUITAR_SOUNDS, BASS_INSTRUMENTS } from '../note/editmodel.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const at = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
/** Where the root of the scale is put on a staff, by clef (concert pitch). */
const LOW = Object.freeze({ G: 55, F: 40, C3: 48, C4: 45 });

/** The eighths a measure holds (an error when its length is not a whole number of eighths). */
function eighthsOf(masterbar) {
  const [n, d] = measureLengthOf(masterbar); const e = (n * 8) / d;
  if (!Number.isInteger(e) || e < 1) throw new EditError('This measure cannot hold eighth notes');
  return e;
}

/** The items to write on a staff: [{ pitch, spelling } | { fret, line }]. */
export function itemsFor(doc, mv, staff, recipe) {
  const type = getProperty(staff, PID.STAFF_TYPE);
  if (type === 'tab') {
    const open = tuningPitches(staff).slice().reverse(); // lowest string first, as the calculator wants it
    const lib6 = open.length === 6 ? 'guitar6' : open.length === 7 ? 'guitar7' : open.length === 5 ? 'bass5' : 'bass4';
    const sc = scaleOf(recipe);
    const systems = lib.availableSystems(sc, { instrument: lib6, tuning: open }).map((s) => s.id);
    const system = systems.includes(recipe.system) ? recipe.system : ['pentatonic', 'caged', '3nps'].find((s) => systems.includes(s)) ?? systems[0];
    const list = lib.positions(sc, recipe.root, { system, instrument: lib6, tuning: open, ...(recipe.cagedSpan ? { cagedSpan: recipe.cagedSpan } : {}) });
    const pos = list.find((p) => p.id === recipe.position) ?? list[0];
    const up = pos.strings.flatMap((s) => s.notes.map((n) => ({ fret: n.fret, line: s.number - 1 })));
    return { kind: 'tab', items: [...up, ...up.slice(0, -1).reverse()] };
  }
  if (type !== 'score') throw new EditError('A scale is written on a notation or a tablature staff');
  const clef = getProperty(staff, PID.CLEF) ?? 'G';
  const run = scaleRun(recipe, LOW[clef] ?? 55);
  return { kind: 'score', items: run.map((n) => ({ played: { pitch: n.pitch, spelling: { step: n.step, alter: n.alter, octave: n.octave } } })) };
}

/**
 * Writes the scale in `staff` from measure `start`, replacing what those measures hold on that staff. Returns { from, measures, added }.
 */
export function writeScale(doc, mv, staff, { recipe: input, start = 0 } = {}) {
  const recipe = normalizeRecipe(input);
  const { items } = itemsFor(doc, mv, staff, recipe);
  // how many measures: the eighths of each measure from `start`, adding measures at the end while the scale does not fit
  let need = 0; let mi = start; let added = 0;
  while (need < items.length) {
    if (mi >= mv.masterbars.length) { insertMeasures(doc, mv, { at: mv.masterbars.length, count: 1 }); added += 1; }
    need += eighthsOf(mv.masterbars[mi]); mi += 1;
  }
  const last = mi - 1;
  const range = rangeFromMeasures(doc, mv, [staff.id], start, last);
  if (range) clearRange(doc, range);
  const type = getProperty(staff, PID.STAFF_TYPE);
  let k = 0;
  for (let m = start; m <= last && k < items.length; m += 1) {
    const slots = eighthsOf(mv.masterbars[m]);
    for (let j = 0; j < slots && k < items.length; j += 1, k += 1) {
      const hit = { staffId: staff.id, staffType: type, measureId: mv.masterbars[m].id, measureIndex: m, position: at(j, 8), voice: 0, line: items[k].line ?? 0 };
      enterNote(doc, hit, { ...DEFAULT_ENTRY, duration: { base: 'eighth', dots: 0 }, replace: true, ...(items[k].played ? { played: items[k].played } : { fret: items[k].fret }) });
    }
  }
  return { from: start, measures: last - start + 1, added };
}

/**
 * A new SCALE MOVEMENT at the end of the work: a notation track (and a tablature track for a guitar or a bass), the scale written in them, the recipe kept in the movement.
 * Returns the movement.
 */
export function createScaleMovement(doc, { recipe: input, title = '' } = {}) {
  const recipe = normalizeRecipe(input);
  const ins = SCALE_INSTRUMENTS[recipe.instrument];
  const mv = addMovement(doc, { measures: 1, title });
  doc.set(mv, PID.SCALE_RECIPE, recipe);
  const fifths = keyFifthsFor(recipe);
  if (fifths !== 0) doc.set(mv.masterbars[0], PID.KEY_SIG, fifths);
  // the staff of the scale: in the clef of the instrument, at concert pitch (a reader shows it transposed for a transposing instrument)
  const noteId = ins.note !== 'none' ? INSTRUMENTS[ins.note]?.id : null;
  const score = addTrack(doc, mv, { staves: [{ type: 'score', clef: ins.clef }], name: title || 'Scale', abbreviation: 'Sc', props: noteId ? { [PID.INSTRUMENT_ID]: noteId } : {} });
  const tracks = [score];
  if (ins.family === 'guitar' || ins.family === 'bass') {
    const tabId = ins.family === 'bass' ? BASS_INSTRUMENTS[ins.strings === 5 ? 5 : 4] : GUITAR_SOUNDS.electric;
    tracks.push(addTrackFromInstrument(doc, mv, tabId));
  }
  const results = tracks.map((t) => writeScale(doc, mv, t.staves.find((s) => ['score', 'tab'].includes(getProperty(s, PID.STAFF_TYPE))), { recipe, start: 0 }));
  void results;
  return mv;
}

/**
 * A SCALE CONTAINER above `staff`: a free nested score (never played) that carries the recipe, over `span` measures from `measureId`. The scale is written for the instrument of the track that
 * holds it (the fragment is at concert pitch: the container follows the transposition of its track). A reader recalculates it for the instrument of the pupil (`layout-hook.js`).
 */
export function addScaleContainer(doc, mv, staff, { recipe: input, measureId, span = 4 } = {}) {
  const track = mv.tracks.find((t) => t.staves.includes(staff));
  const recipe = normalizeRecipe({ ...input, instrument: track ? instrumentOfTrack(track) : input.instrument });
  const content = scaleContent(recipe, {}, { plain: true });
  const fragment = createMovement({ masterbars: content.masterbars, tracks: [createTrack({ staves: content.tracks[0].staves })] });
  const c = createStaffContainer({ measureId, span, kind: 'nestedNotation', fragments: [fragment] });
  doc.add(staff, 'containers', c);
  doc.set(c, PID.CONTAINER_LAYOUT, 'free');
  doc.set(c, PID.CONTAINER_SCALE, 0.85);
  const { instrument: _i, view: _v, position: _p, ...kept } = recipe; // (the instrument and the view come from the track and from the reader)
  doc.set(c, PID.SCALE_RECIPE, kept);
  return c;
}
