/*
 * Staff containers (`staff.containers`): content anchored to (staff, measure) with a `span`, drawn just above the staff. Edits are pure
 * model operations, TO BE CALLED INSIDE `doc.transaction`. A nested notation owns `span` measures per voice, aligned on the masterbars
 * from its anchor (validate.js); changing the span adds or removes those measures.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createStaffContainer, createStaff, createVoice, createEmptyMeasure, createMeasure, createMovement, createMasterbar, createTrack } from './elements.js';
import { insertMeasures, deleteMeasures } from './measureedit.js';
import { nestedStaves } from './containerstaves.js';
import { EditError } from './noteedit.js';
import { fEq } from './fraction.js';
import { measureLengthOf } from './timing.js';
import { validateDiagramChord, DIAGRAM_INSTRUMENTS } from './fretdiagram.js';
import { validateVoicing } from './fretvoicing.js';

export const CONTAINER_TEXT_MAX = 120;
/** Nested staff types accepted for a rhythm container (no clef needed). */
export const NESTED_RHYTHM_TYPES = Object.freeze(['rhythm', 'neutral']);

const indexOfBar = (mv, id) => mv.masterbars.findIndex((b) => b.id === id);

function checkSpan(mv, measureId, span) {
  const at = indexOfBar(mv, measureId);
  if (at < 0) throw new EditError('Mesure inexistante');
  if (!Number.isInteger(span) || span < 1) throw new EditError('Étendue invalide');
  if (at + span > mv.masterbars.length) throw new EditError('Le conteneur dépasse la fin du Mouvement');
}

/** Adds a text container above `staff`. Returns it. */
export function addTextContainer(doc, mv, staff, { measureId, span = 1, text = '' } = {}) {
  checkSpan(mv, measureId, span);
  const clean = String(text).trim().slice(0, CONTAINER_TEXT_MAX);
  if (!clean) throw new EditError('Texte vide');
  const c = createStaffContainer({ measureId, span, kind: 'text', text: clean });
  doc.add(staff, 'containers', c);
  return c;
}

/**
 * Adds a chord-diagram container (fretted instrument) on `staff`: stacked over `span` measures from `measureId` (`placement` 'above', default) or in a slot
 * between measures (`placement` 'between', `side` 'before' | 'after'). `chord` = { root, quality, bass } is the chord the diagram is for (it follows
 * it); `voicing` fingers it by hand (omitted = the suggestion). `follow` (stacked only): no chord of its own, one diagram per chord symbol written in the measures it
 * covers on the chord staff. Returns the container.
 */
export function addDiagramContainer(doc, mv, staff, { measureId, span = 1, placement = 'above', side = 'before', chord = null, instrument = 'guitar', voicing = null, width, follow = false } = {}) {
  const at = indexOfBar(mv, measureId);
  if (at < 0) throw new EditError('Mesure inexistante');
  if (!DIAGRAM_INSTRUMENTS.includes(instrument)) throw new EditError('Instrument invalide');
  if (!chord && !voicing && !follow) throw new EditError('Un diagramme demande un accord ou un doigté');
  if (follow && placement !== 'above') throw new EditError('Un diagramme qui suit la piste d\'accords se pose au-dessus des mesures');
  const chordProblems = validateDiagramChord(chord);
  if (chordProblems.length) throw new EditError(chordProblems[0]);
  if (voicing) { const p = validateVoicing(voicing); if (p.length) throw new EditError(p[0]); }
  if (placement === 'above') checkSpan(mv, measureId, span);
  else if (placement !== 'between') throw new EditError('Placement invalide');
  let anchor = measureId;
  let where = side;
  if (placement === 'between') {
    if (side !== 'before' && side !== 'after') throw new EditError('Côté invalide');
    if (side === 'after' && at < mv.masterbars.length - 1) { anchor = mv.masterbars[at + 1].id; where = 'before'; } // canonical form
  }
  const props = {};
  if (chord) props[PID.DIAGRAM_CHORD] = { root: { step: chord.root.step, alter: chord.root.alter ?? 0 }, quality: chord.quality ?? '', bass: chord.bass ? { step: chord.bass.step, alter: chord.bass.alter ?? 0 } : null };
  if (voicing) props[PID.VOICING] = voicing;
  if (instrument !== 'guitar') props[PID.DIAGRAM_INSTRUMENT] = instrument;
  if (follow) props[PID.DIAGRAM_FOLLOW] = true;
  const c = createStaffContainer({
    measureId: anchor, span: placement === 'above' ? span : 1, kind: 'chordDiagram', placement: placement === 'above' ? undefined : 'between',
    side: placement === 'between' ? where : undefined, width: placement === 'between' ? width : undefined, props,
  });
  doc.add(staff, 'containers', c);
  return c;
}

/**
 * Adds a text container BETWEEN measures: just `before` the measure `measureId`, or `after` it (only meaningful for the last measure:
 * "after measure k" is stored as "before measure k + 1"). It takes width in the line like a measure but is not one. `width` (staff spaces)
 * overrides the width taken from the content. Returns it.
 */
export function addSlotContainer(doc, mv, staff, { measureId, side = 'before', text = '', width, gap = false, separator = false } = {}) {
  const at = indexOfBar(mv, measureId);
  if (at < 0) throw new EditError('Mesure inexistante');
  if (side !== 'before' && side !== 'after') throw new EditError('Côté invalide');
  const clean = gap ? '' : String(text).trim().slice(0, CONTAINER_TEXT_MAX); // a GAP has no text: it is a blank room (and, if asked, a separator line), like a horizontal frame of MuseScore
  if (!clean && !gap) throw new EditError('Texte vide');
  if (width !== undefined && !(width > 0)) throw new EditError('Largeur invalide');
  // canonical form: "after" only on the last measure
  let anchor = measureId;
  let where = side;
  if (side === 'after' && at < mv.masterbars.length - 1) { anchor = mv.masterbars[at + 1].id; where = 'before'; }
  const c = createStaffContainer({ measureId: anchor, span: 1, kind: 'text', text: clean, placement: 'between', side: where, width: gap ? (width ?? GAP_WIDTH) : width, ...(separator ? { props: { [PID.CONTAINER_SEPARATOR]: true } } : {}) });
  doc.add(staff, 'containers', c);
  return c;
}

/** The width a new gap starts with (staff spaces). */
export const GAP_WIDTH = 6;

/** Puts the separator line of a slot between measures on or off. */
export function setSlotSeparator(doc, container, on) {
  if (getProperty(container, PID.CONTAINER_PLACEMENT) !== 'between') throw new EditError('Pas un conteneur intercalé');
  if (on) doc.set(container, PID.CONTAINER_SEPARATOR, true); else if (getProperty(container, PID.CONTAINER_SEPARATOR)) doc.reset(container, PID.CONTAINER_SEPARATOR);
}

/** Sets or clears (`null`) the manual width of a slot between measures. */
export function setSlotWidth(doc, container, width) {
  if (getProperty(container, PID.CONTAINER_PLACEMENT) !== 'between') throw new EditError('Pas un conteneur intercalé');
  if (width === null) { doc.reset(container, PID.CONTAINER_WIDTH); return; }
  if (!(width > 0)) throw new EditError('Largeur invalide');
  doc.set(container, PID.CONTAINER_WIDTH, width);
}

/**
 * A fragment for a STACKED container: a small movement whose masterbars copy the time and key signature of the main masterbars it covers
 * (`bars`), holding `staves` in one track. The copy keeps the fragment readable on its own (editor); the stacked display follows the piece.
 */
export function createFragment({ bars, staves }) {
  const masters = bars.map((b) => createMasterbar({ timeSig: getProperty(b, PID.TIME_SIG), keySig: getProperty(b, PID.KEY_SIG) }));
  return createMovement({ masterbars: masters, tracks: [createTrack({ staves })] });
}

/** Aligns the signatures of the fragment of a stacked container on the main measures it covers (after any change of its span or of the piece). */
export function syncFragmentBars(doc, mv, container) {
  const fragment = container.fragments?.[0];
  if (!fragment) return;
  if (getProperty(container, PID.CONTAINER_LAYOUT) === 'free' || getProperty(container, PID.CONTAINER_PLACEMENT) === 'between') return; // independent of the piece
  const first = indexOfBar(mv, getProperty(container, PID.MEASURE_ID));
  const own = { [PID.TIME_SIG]: getProperty(container, PID.CONTAINER_SHOW_TIMESIG), [PID.KEY_SIG]: getProperty(container, PID.CONTAINER_SHOW_KEYSIG) };
  fragment.masterbars.forEach((fb, k) => {
    const main = mv.masterbars[first + k];
    if (!main) return;
    for (const pid of [PID.TIME_SIG, PID.KEY_SIG]) {
      if (own[pid]) continue; // own signature: kept as written
      const want = getProperty(main, pid);
      if (JSON.stringify(getProperty(fb, pid)) !== JSON.stringify(want)) doc.set(fb, pid, want);
    }
  });
}

/**
 * Adds a STACKED container with one nested staff (simplified rhythm by default) over `span` measures; the staff holds `span` empty measures in
 * a fragment aligned on them. Returns it. `clef`: the clef of a notation staff.
 */
export function addNestedContainer(doc, mv, staff, { measureId, span = 1, staffType = 'rhythm', clef } = {}) {
  checkSpan(mv, measureId, span);
  const nested = createStaff({ type: staffType, ...(clef ? { clef } : {}), voices: [createVoice(Array.from({ length: span }, () => createEmptyMeasure(staffType)))] });
  const at = indexOfBar(mv, measureId);
  const fragment = createFragment({ bars: mv.masterbars.slice(at, at + span), staves: [nested] });
  const c = createStaffContainer({ measureId, span, kind: 'nestedNotation', fragments: [fragment] });
  doc.add(staff, 'containers', c);
  return c;
}

/** Changes the number of measures covered; the nested staves gain empty measures or lose their last ones. */
export function setContainerSpan(doc, mv, container, span) {
  const measureId = getProperty(container, PID.MEASURE_ID);
  checkSpan(mv, measureId, span);
  const current = getProperty(container, PID.SPAN);
  if (span === current) return;
  const fragment = container.fragments?.[0];
  if (fragment) {
    if (span > current) insertMeasures(doc, fragment, { at: current, count: span - current, moveSignatures: false });
    else deleteMeasures(doc, fragment, { from: span, to: current - 1 });
    doc.set(container, PID.SPAN, span);
    syncFragmentBars(doc, mv, container);
    return;
  }
  for (const nested of container.staves) {
    const type = getProperty(nested, PID.STAFF_TYPE);
    nested.voices.forEach((voice, v) => {
      for (let k = voice.measures.length; k < span; k++) doc.add(voice, 'measures', v === 0 ? createEmptyMeasure(type) : createMeasure([]));
      for (let k = voice.measures.length - 1; k >= span; k--) doc.remove(voice.measures[k]);
    });
  }
  doc.set(container, PID.SPAN, span);
}

export function setContainerText(doc, container, text) {
  const clean = String(text).trim().slice(0, CONTAINER_TEXT_MAX);
  if (!clean) throw new EditError('Texte vide');
  doc.set(container, PID.TEXT, clean);
}

/** Moves a container one place in the stack of its staff (the first is nearest the staff). `delta` ±1; refused at the ends. */
export function moveContainer(doc, staff, container, delta) {
  const list = staff.containers;
  const at = list.findIndex((c) => c.id === container.id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= list.length) throw new EditError('Déplacement impossible');
  doc.remove(container);
  doc.add(staff, 'containers', container, to);
}

// ---------------------------------------------------------------------------
// Partition (fragment) in a slot between measures
// ---------------------------------------------------------------------------

export const FRAGMENT_MAX_MEASURES = 32;
/** Staff types a fragment can start with (the type of each nested staff can change later like any staff). */
export const FRAGMENT_STAFF_TYPES = Object.freeze(['score', 'rhythm', 'tab', 'percussion', 'neutral']);

/**
 * Adds a container BETWEEN measures holding a short score: a FRAGMENT = a small movement of its own (own measures, own staves), which the
 * same view can show and edit alone. Its measures copy the time and key signature of the anchor measure (they are hidden by default:
 * `containerShowTimeSig` / `containerShowKeySig`, the clef is shown). Returns the container.
 */
export function addFragmentContainer(doc, mv, staff, { measureId, side = 'before', staffType = 'score', measures = 1, clef, align = 'system', grand = false } = {}) {
  const at = indexOfBar(mv, measureId);
  if (at < 0) throw new EditError('Mesure inexistante');
  if (side !== 'before' && side !== 'after') throw new EditError('Côté invalide');
  if (!FRAGMENT_STAFF_TYPES.includes(staffType)) throw new EditError(`Type de portée non pris en charge : ${staffType}`);
  if (!Number.isInteger(measures) || measures < 1 || measures > FRAGMENT_MAX_MEASURES) throw new EditError('Nombre de mesures invalide');
  const anchor = mv.masterbars[at];
  const timeSig = getProperty(anchor, PID.TIME_SIG);
  const keySig = getProperty(anchor, PID.KEY_SIG);
  const bars = Array.from({ length: measures }, () => createMasterbar({ timeSig, keySig }));
  const make = (type, c) => createStaff({ type, ...(c ? { clef: c } : {}), voices: [createVoice(bars.map(() => createEmptyMeasure(type)))] });
  // `grand`: a piano-like pair (treble + bass) in ONE track, joined by a brace
  const staves = grand ? [make('score', 'G'), make('score', 'F')] : [make(staffType, clef)];
  const fragment = createMovement({ masterbars: bars, tracks: [createTrack({ staves })] });
  let target = measureId;
  let where = side;
  if (side === 'after' && at < mv.masterbars.length - 1) { target = mv.masterbars[at + 1].id; where = 'before'; }
  const c = createStaffContainer({ measureId: target, span: 1, kind: 'nestedNotation', placement: 'between', side: where, fragments: [fragment], props: align === 'row' ? { [PID.CONTAINER_ALIGN]: 'row' } : {} });
  doc.add(staff, 'containers', c);
  return c;
}

/**
 * Number of measures of the fragment of a container (≥ 1): measures are added or removed at the END. With `mv` (the movement that holds the container): a FREE score is
 * spread over the width of its container, so when it gets more measures than the container covers the container grows to cover as many (as far as the piece goes);
 * it never gets narrower by itself (a short score may be spread wide on purpose).
 */
export function setFragmentMeasures(doc, container, count, mv = null) {
  const fragment = container.fragments?.[0];
  if (!fragment) throw new EditError('Pas de partition dans ce conteneur');
  if (!Number.isInteger(count) || count < 1 || count > FRAGMENT_MAX_MEASURES) throw new EditError('Nombre de mesures invalide');
  const n = fragment.masterbars.length;
  if (count > n) insertMeasures(doc, fragment, { at: n, count: count - n, moveSignatures: false });
  else if (count < n) deleteMeasures(doc, fragment, { from: count, to: n - 1 });
  const stacked = getProperty(container, PID.CONTAINER_LAYOUT) === 'free' && !['between', 'zone'].includes(getProperty(container, PID.CONTAINER_PLACEMENT));
  if (mv && stacked) {
    const room = mv.masterbars.length - indexOfBar(mv, getProperty(container, PID.MEASURE_ID));
    if (room > 0 && count > (getProperty(container, PID.SPAN) ?? 1)) doc.set(container, PID.SPAN, Math.min(count, room));
  }
}

/** Shows or hides the time / key signature of a nested score (hidden by default: they depend on the staves of the piece). */
export function setFragmentHeader(doc, container, { timeSig, keySig } = {}) {
  if (timeSig !== undefined) doc.set(container, PID.CONTAINER_SHOW_TIMESIG, !!timeSig);
  if (keySig !== undefined) doc.set(container, PID.CONTAINER_SHOW_KEYSIG, !!keySig);
}

/**
 * Sets the OWN time and / or key signature of measure `index` of the fragment of a nested score (shown only while the matching
 * `containerShow*` flag is on). In an aligned layout the time signature must keep the length of the measure of the piece it covers.
 */
export function setFragmentBarSignature(doc, mv, container, index, { timeSig, keySig } = {}) {
  const fragment = container.fragments?.[0];
  const bar = fragment?.masterbars[index];
  if (!bar) throw new EditError('Mesure inconnue dans la partition imbriquée');
  if (timeSig !== undefined && getProperty(container, PID.CONTAINER_LAYOUT) !== 'free' && getProperty(container, PID.CONTAINER_PLACEMENT) !== 'between') {
    const main = mv.masterbars[indexOfBar(mv, getProperty(container, PID.MEASURE_ID)) + index];
    const probe = { ...bar, props: { ...bar.props, [PID.TIME_SIG]: timeSig } };
    if (main && !fEq(measureLengthOf(probe), measureLengthOf(main))) throw new EditError('Un chiffrage propre doit garder la longueur de la mesure de la pièce (3/4 et 6/8, 2/2 et 4/4) : utilisez le placement libre pour un autre chiffrage');
  }
  if (timeSig !== undefined) doc.set(bar, PID.TIME_SIG, timeSig);
  if (keySig !== undefined) doc.set(bar, PID.KEY_SIG, keySig);
}

/**
 * Switches the OWN key / time signature of a nested score on or off (`which` 'key' | 'time'). Off: the score follows the piece again (hidden,
 * values copied back from the measures it covers). On: it keeps what it has (a copy of the piece) and may be edited.
 */
export function setContainerOwnSignature(doc, mv, container, which, on) {
  const pid = which === 'key' ? PID.CONTAINER_SHOW_KEYSIG : PID.CONTAINER_SHOW_TIMESIG;
  if (on) doc.set(container, pid, true); else { doc.reset(container, pid); syncFragmentBars(doc, mv, container); } // (a score between measures is never synced)
}

/** Sets the key and / or time signature of EVERY measure of the nested score (own signature; same rules as `setFragmentBarSignature`). */
export function setFragmentSignature(doc, mv, container, { timeSig, keySig } = {}) {
  const n = container.fragments?.[0]?.masterbars.length ?? 0;
  for (let i = 0; i < n; i += 1) setFragmentBarSignature(doc, mv, container, i, { timeSig, keySig });
}

/** Layout of a stacked nested score: 'aligned' (on the measures of the piece) or 'free' (independent, never played). */
export function setContainerLayout(doc, mv, container, layout) {
  if (getProperty(container, PID.CONTAINER_PLACEMENT) === 'between') throw new EditError('Le placement libre ne concerne que les partitions empilées');
  if (layout === 'free') {
    if (getProperty(container, PID.CONTAINER_PLAY) !== 'none') doc.reset(container, PID.CONTAINER_PLAY);
    doc.set(container, PID.CONTAINER_LAYOUT, 'free');
  } else {
    doc.reset(container, PID.CONTAINER_LAYOUT);
    // back on the piece: as many measures as covered, same lengths (signatures re-synced unless own)
    const fragment = container.fragments?.[0];
    const span = getProperty(container, PID.SPAN);
    if (fragment) {
      const n = fragment.masterbars.length;
      if (n < span) insertMeasures(doc, fragment, { at: n, count: span - n, moveSignatures: false });
      else if (n > span) deleteMeasures(doc, fragment, { from: span, to: n - 1 });
      for (const pid of [PID.CONTAINER_SHOW_TIMESIG, PID.CONTAINER_SHOW_KEYSIG]) if (getProperty(container, pid)) doc.reset(container, pid);
      syncFragmentBars(doc, mv, container);
    }
  }
}

/** Whether the nested notes follow the real score's transposition (true) or stay as entered (false). */
export function setContainerTransposeFollow(doc, container, follow) {
  if (follow) doc.reset(container, PID.CONTAINER_TRANSPOSE_FOLLOW); else doc.set(container, PID.CONTAINER_TRANSPOSE_FOLLOW, false);
}

/** Playback of a nested score: 'none' | 'replace' (the staff below is silent on the measures covered) | 'add'. Refused in free layout. */
export function setContainerPlay(doc, container, mode) {
  if (mode !== 'none' && (getProperty(container, PID.CONTAINER_LAYOUT) === 'free' || getProperty(container, PID.CONTAINER_PLACEMENT) === 'between')) {
    throw new EditError('Seule une partition empilée alignée sur les mesures peut être jouée');
  }
  if (mode === 'none') doc.reset(container, PID.CONTAINER_PLAY); else doc.set(container, PID.CONTAINER_PLAY, mode);
}

/** Reduced size of a nested score: 1 (full size, the default) down to 0.4. */
export function setContainerScale(doc, container, scale) {
  const max = ['text', 'chordDiagram', 'chordDiagramList'].includes(getProperty(container, PID.CONTAINER_KIND)) ? 3 : 1;
  if (!(scale >= 0.4 && scale <= max)) throw new EditError(`Échelle du conteneur : de 40 % à ${max * 100} %`);
  if (scale === 1) doc.reset(container, PID.CONTAINER_SCALE); else doc.set(container, PID.CONTAINER_SCALE, scale);
}

/** Steps of the zoom of a text or a diagram (and the sizes a nested score offers up to 1). */
export const CONTAINER_ZOOM_STEPS = Object.freeze([0.4, 0.5, 0.65, 0.75, 0.85, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);

/** Moves a stacked container away from (+) or toward (−) the staff by changing its extra distance; never closer than the default position. */
export function setContainerGap(doc, container, gap) {
  if (!(gap >= 0 && gap <= 40)) throw new EditError('Distance : de 0 à 40 espaces');
  if (gap === 0) { if (doc.get(container, PID.CONTAINER_GAP)) doc.reset(container, PID.CONTAINER_GAP); } else doc.set(container, PID.CONTAINER_GAP, Math.round(gap * 100) / 100);
}

/** Staff type given to the nested score of a staff that cannot hold one itself (chords, accordion…): a simplified rhythm. */
const nestedTypeFor = (type) => (FRAGMENT_STAFF_TYPES.includes(type) ? type : 'rhythm');

/**
 * Creates one container BETWEEN measures on EVERY visible staff of the movement (same place, they share one column): each one in the row of its
 * own staff (option A). `kind` 'text' (the same `text` on each) or 'fragment' (a nested score of the staff's own type and clef).
 * Returns the containers, in staff order.
 */
export function addSlotContainersEveryStaff(doc, mv, { measureId, side = 'before', kind = 'fragment', text = '', measures = 1, staffType, gap = false } = {}) {
  const out = [];
  for (const track of mv.tracks) {
    if (getProperty(track, PID.VISIBLE) === false) continue;
    for (const staff of track.staves) {
      if (getProperty(staff, PID.VISIBLE) === false) continue;
      if (kind === 'text') out.push(addSlotContainer(doc, mv, staff, { measureId, side, text, gap }));
      else {
        const own = nestedTypeFor(getProperty(staff, PID.STAFF_TYPE));
        out.push(addFragmentContainer(doc, mv, staff, { measureId, side, staffType: staffType === 'rhythm' ? 'rhythm' : own, measures, clef: getProperty(staff, PID.CLEF), align: 'row' }));
      }
    }
  }
  if (!out.length) throw new EditError('Aucune portée visible');
  return out;
}

/**
 * Spacing of the notes of a nested score in a STACKED container: `spacing` 'chords' (the times follow the columns of the anchor staff) or
 * 'document' (spaced on its own, like the rest of the document, inside the measures it covers); `widen` (only with 'chords'): the nested notes take
 * part in the spacing of the piece, a denser rhythm widens the measures (default off: tight).
 */
export function setContainerSpacing(doc, container, { spacing, widen } = {}) {
  if (getProperty(container, PID.CONTAINER_PLACEMENT) === 'between' || !nestedStaves(container).length) throw new EditError('Réservé aux partitions des conteneurs empilés');
  if (spacing !== undefined) {
    if (spacing !== 'chords' && spacing !== 'document') throw new EditError('Espacement inconnu');
    doc.set(container, PID.CONTAINER_SPACING, spacing);
  }
  if (widen !== undefined) doc.set(container, PID.CONTAINER_WIDEN, !!widen);
}
