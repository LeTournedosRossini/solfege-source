// System ("masterbar") objects — intents without DOM: where an object is placed (from a note, a range or a measure) and what is there.
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { ZERO, fEq } from '../model/fraction.js';
import { measureLengthOf } from '../model/timing.js';
import { anchorOfElement } from './noteentry-cursor.js';
import * as sys from '../model/systemedit.js';

/**
 * Target of a system-object gesture, from (in order): a range, the selected note / chord / rest, a chosen measure.
 * The staff the gesture came from is forgotten: only the masterbar id and the exact position matter.
 * → { measureId, position, endMeasureId, endPosition, span, whole } or null.
 * `span` = number of measures from the start (a range: its measures; otherwise 1); `end*` = instant where a gradual change would end.
 */
export function systemTarget(doc, mv, { ids = [], range = null, measureId = null } = {}) {
  const bars = mv.masterbars;
  const indexOf = (id) => bars.findIndex((b) => b.id === id);
  const nextStart = (i) => (i + 1 < bars.length ? { measureId: bars[i + 1].id, position: ZERO } : { measureId: bars[i].id, position: measureLengthOf(bars[i]) });
  if (range) {
    const i = indexOf(range.from.measureId); const j = indexOf(range.to.measureId);
    if (i < 0 || j < 0) return null;
    let end = { measureId: range.to.measureId, position: range.to.position };
    if (fEq(end.position, measureLengthOf(bars[j]))) end = nextStart(j);
    return { measureId: range.from.measureId, position: range.from.position, endMeasureId: end.measureId, endPosition: end.position, span: Math.max(1, j - i + 1), whole: false };
  }
  for (const id of ids) {
    const c = anchorOfElement(doc, id);
    if (c && bars[c.measureIndex]) {
      const end = nextStart(c.measureIndex);
      return { measureId: bars[c.measureIndex].id, position: c.position, endMeasureId: end.measureId, endPosition: end.position, span: 1, whole: false };
    }
  }
  if (measureId) {
    const i = indexOf(measureId);
    if (i < 0) return null;
    const end = nextStart(i);
    return { measureId, position: ZERO, endMeasureId: end.measureId, endPosition: end.position, span: 1, whole: true };
  }
  return null;
}

/** What is already at a target (for the pressed state of the drawer buttons). */
export function systemState(mv, target) {
  if (!target) return null;
  const at = { measureId: target.measureId, position: target.position };
  const tempo = sys.tempoAt(mv, at);
  const swing = sys.swingAt(mv, at);
  const fermata = sys.fermataAt(mv, at);
  const jump = sys.jumpAt(mv, target.measureId);
  const marker = sys.markerAt(mv, target.measureId);
  const volta = sys.voltaAt(mv, target.measureId);
  const mb = mv.masterbars.find((b) => b.id === target.measureId);
  const gradual = mv.tempoChanges.find((c) => getProperty(c, PID.MEASURE_ID) === target.measureId && fEq(getProperty(c, PID.POSITION) ?? ZERO, target.position));
  return {
    tempo: tempo ? { kind: getProperty(tempo, PID.TEMPO_KIND), bpm: getProperty(tempo, PID.TEMPO_BPM), text: getProperty(tempo, PID.TEXT) ?? null } : null,
    gradual: gradual ? getProperty(gradual, PID.CHANGE_TYPE) : null,
    swing: swing ? getProperty(swing, PID.SWING_KIND) : null,
    fermata: fermata ? getProperty(fermata, PID.FERMATA_TYPE) : null,
    jump: jump ? getProperty(jump, PID.JUMP_TYPE) : null,
    marker: marker ? getProperty(marker, PID.MARKER_TYPE) : null,
    repeatStart: !!getProperty(mb, PID.REPEAT_START),
    repeatEnd: !!getProperty(mb, PID.REPEAT_END),
    repeatCount: getProperty(mb, PID.REPEAT_COUNT) ?? 2,
    repeatText: getProperty(mb, PID.REPEAT_TEXT) ?? null,
    rehearsal: sys.rehearsalAt(mv, target.measureId) ? getProperty(sys.rehearsalAt(mv, target.measureId), PID.TEXT) : null,
    section: sys.sectionAt(mv, target.measureId) ? { label: getProperty(sys.sectionAt(mv, target.measureId), PID.LABEL), category: getProperty(sys.sectionAt(mv, target.measureId), PID.SECTION_CATEGORY), color: getProperty(sys.sectionAt(mv, target.measureId), PID.COLOR) ?? null } : null,
    chordView: sys.chordViewOn(mv, target.measureId),
    volta: volta ? { span: getProperty(volta, PID.SPAN), numbers: getProperty(volta, PID.VOLTA_NUMBERS) } : null,
  };
}

/** The staff a gesture comes from (range: its first staff; note / chord / rest: its staff), or null (a chosen measure has no staff). */
export function staffOfTarget(doc, { ids = [], range = null } = {}) {
  if (range?.staffIds?.length) return range.staffIds[0];
  for (const id of ids) { const c = anchorOfElement(doc, id); if (c) return c.staffId; }
  return null;
}

export { sys };
