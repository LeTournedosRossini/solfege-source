/*
 * Changing the KEY SIGNATURE of measures that already hold music (C major → G major). CALL IT INSIDE `doc.transaction(name, () => …)`: one gesture = one undoable step.
 *
 * Rule (decided with Jean, 04/11/2026): the SOUND does not change — no pitch moves (that is what “Transpose” is for), only the signature and the way the notes are written.
 *   - a note whose stored spelling is the one the OLD key would give is written again as the NEW key gives it (F♯ → F♯ in G, G♭ in D♭);
 *   - a note spelled by hand (a different name than the old key would give) keeps its spelling;
 *   - chord symbols are written again the same way only when `chordSymbols` is true (off by default: they keep the names they have).
 * Nothing else moves (positions, lengths, marks), so no mark can be left outside its measure. `planKeySignature` counts, without touching anything, to say it first.
 *
 *   planKeySignature(mv, { from, to, keySig, chordSymbols }) → { measures, respelled, kept, chordSymbols }
 *   changeKeySignature(doc, mv, { from, to, keySig, chordSymbols }) → the same report
 *   keySignatureSpanFrom(mv, from) → index of the last measure that shares the key of measure `from` (“from this measure to the next change”)
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { isApplicable } from './schema.js';
import { defaultSpelling, midiFromSpelling } from './pitch.js';
import { EditError } from './noteedit.js';

export const KEY_SIG_MIN = -7;
export const KEY_SIG_MAX = 7;

const staffsOf = (mv) => mv.tracks.flatMap((t) => t.staves);
const same = (a, b) => a.step === b.step && (a.alter ?? 0) === (b.alter ?? 0);
const pitchClass = (name) => ((midiFromSpelling({ ...name, octave: 4 }) % 12) + 12) % 12;
/** The name the key gives to a pitch class (chord roots have no octave). */
const nameIn = (pc, key) => { const { step, alter } = defaultSpelling(60 + pc, key); return { step, alter }; };

export function keySignatureSpanFrom(mv, from) {
  const key = getProperty(mv.masterbars[from], PID.KEY_SIG);
  let last = from;
  while (last + 1 < mv.masterbars.length && getProperty(mv.masterbars[last + 1], PID.KEY_SIG) === key) last += 1;
  return last;
}

function check(mv, { from, to, keySig }) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= mv.masterbars.length) throw new EditError('Invalid range of measures');
  if (!Number.isInteger(keySig) || keySig < KEY_SIG_MIN || keySig > KEY_SIG_MAX) throw new EditError('Invalid key signature');
}

/** What each affected note / chord symbol becomes, read from the measures AS THEY ARE. */
function planAll(mv, o) {
  check(mv, o);
  const writes = []; const report = { measures: 0, respelled: 0, kept: 0, chordSymbols: 0 };
  for (let mi = o.from; mi <= o.to; mi += 1) {
    const oldKey = getProperty(mv.masterbars[mi], PID.KEY_SIG);
    if (oldKey === o.keySig) continue;
    report.measures += 1;
    for (const staff of staffsOf(mv)) {
      for (const voice of staff.voices) {
        for (const item of voice.measures[mi]?.items ?? []) {
          if (item.type === 'chordsymbol') {
            if (!o.chordSymbols) continue;
            for (const pid of [PID.CHORD_ROOT, PID.CHORD_BASS]) {
              const name = getProperty(item, pid);
              if (!name) continue;
              const pc = pitchClass(name);
              if (!same(name, nameIn(pc, oldKey))) continue; // chosen by hand: kept
              const next = nameIn(pc, o.keySig);
              if (!same(name, next)) { writes.push({ el: item, pid, value: next }); report.chordSymbols += 1; }
            }
            continue;
          }
          if (item.type !== 'chord') continue;
          for (const note of [...item.notes, ...(item.graceNotes ?? []).flatMap((g) => g.notes ?? [])]) {
            if (!isApplicable(note.type, PID.SPELLING)) continue;
            const sp = getProperty(note, PID.SPELLING);
            if (!sp) continue;
            const pitch = getProperty(note, PID.PITCH);
            if (!same(sp, defaultSpelling(pitch, oldKey))) { report.kept += 1; continue; }
            const next = defaultSpelling(pitch, o.keySig);
            if (!same(sp, next)) { writes.push({ el: note, pid: PID.SPELLING, value: next }); report.respelled += 1; }
          }
        }
      }
    }
  }
  return { writes, report };
}

/** What changing the key of measures `from`…`to` would do, without changing anything. */
export function planKeySignature(mv, o) { return planAll(mv, o).report; }

export function changeKeySignature(doc, mv, o) {
  const { writes, report } = planAll(mv, o);
  for (let mi = o.from; mi <= o.to; mi += 1) if (getProperty(mv.masterbars[mi], PID.KEY_SIG) !== o.keySig) doc.set(mv.masterbars[mi], PID.KEY_SIG, o.keySig);
  for (const w of writes) doc.set(w.el, w.pid, w.value);
  followContainers(doc, mv, o);
  return report;
}

/** The nested scores aligned on the measures that changed (above a staff, on screen 1 or hung by a part) follow the new key, unless they have their own. */
function followContainers(doc, mv, o) {
  const hung = (doc.work.parts ?? []).flatMap((p) => p.containers ?? []).filter((c) => getProperty(c, PID.CONTAINER_PLACEMENT) !== 'zone');
  for (const staff of staffsOf(mv)) {
    for (const c of [...(staff.containers ?? []), ...hung.filter((h) => getProperty(h, PID.CONTAINER_STAFF_ID) === staff.id)]) {
      const fragment = c.fragments?.[0];
      if (!fragment || getProperty(c, PID.CONTAINER_LAYOUT) === 'free' || getProperty(c, PID.CONTAINER_PLACEMENT) === 'between') continue; // independent of the piece
      if (getProperty(c, PID.CONTAINER_SHOW_KEYSIG)) continue; // an own key is kept as written
      const first = mv.masterbars.findIndex((b) => b.id === getProperty(c, PID.MEASURE_ID));
      if (first < 0) continue;
      for (let k = Math.max(0, o.from - first); k < fragment.masterbars.length && first + k <= o.to; k += 1) {
        changeKeySignature(doc, fragment, { from: k, to: k, keySig: o.keySig, chordSymbols: o.chordSymbols });
      }
    }
  }
}
