// Piano accompaniment ("comping"): an interpreter that turns a rhythm of hits + the chord in force into SIMULTANEOUS notes: a bass note (left hand) and the chord
// tones (right hand) chosen by VOICE LEADING, i.e. the voicing that moves least from the previous one. PURE (no DOM, no document). Like `strum.js`, the values
// are Scorsaire's own choices (MuseScore does not lead voices: it folds every chord alone into one octave), to be tuned by ear.
//
// Chords are given as specs { rootPc, intervals: [semitones above the root], bassPc | null } (pitch classes 0-11, the shape `chordSpecFromSymbol` returns).

import { chordOwnTone, defaultTone, majorInterval } from '../model/chorddegrees.js';
import { createVariationPicker, structureWeight } from '../model/variation.js';

export const COMPING_DEFAULTS = Object.freeze({
  /** compass of the right hand (MIDI) */
  handLow: 55,
  handHigh: 76,
  /** the bass also sounds an octave lower */
  bassDouble: 0,
  /** hit velocity factors: accent (accent / marcato signs), plain, left hand */
  accentBoost: 1.25,
  bassVelocity: 1,
  handVelocity: 0.92,
  /** length of a staccato hit in seconds */
  staccatoDuration: 0.12,
  /** spread between the notes of a hit in ms (0 = together); the lowest note first */
  rollMs: 0,
  /** approach chord before a chord change: 'off' | 'dominant' (V7 of the target) | 'tritone' (♭II7) | 'chromatic' (major chord a semitone below)
   *  | 'parallel' (the target chord itself a semitone ABOVE, or below for the share `approachBelow` of them) */
  approach: 'off',
  /** with 'parallel': the share of approaches that come from below (0 = all from above, 1 = all from below, 0.5 = as often) */
  approachBelow: 0,
  /** the chance that a change gets its approach (1 = every change); the structure and the rule below act on it */
  approachChance: 1,
  /** how much likelier an approach is at the end of a section: the chance is multiplied by up to 1 + this on its last bar (1 + half of it on the one before) */
  structureBoost: 0,
  /** 1 = an approach that came at a place of a section does not come at that same place on the next pass (a repeat, the next verse) */
  approachNoRepeat: 0,
  /** an approach replaces the hits that start within this many beats before the change (never the first hit of a chord) */
  approachBeats: 1,
  /** a pattern asks for a degree the chord does not have (the 7th of a triad): 'skip' plays nothing, 'play' sounds the usual note anyway */
  absentDegree: 'skip',
  // voice-leading rules of the right hand (see `voicingCost`). Common tones that stay where they are always count; these are the other rules:
  /** how much the top note is kept from leaping (0 = not at all, 1 = usual, 2 = a lot) */
  topSmooth: 1,
  /** 1 = avoid a semitone (or a minor ninth) between two neighbouring notes, above all between the two top ones */
  avoidSeconds: 1,
  /** 1 = a major seventh may be replaced by the sixth when no placement of the notes avoids the clash */
  sixthForSeventh: 1,
  /** 1 = the top note does not move the same way as the bass */
  contrary: 0,
  /** 1 = no parallel fifths or octaves between the bass and the top note */
  noParallels: 0,
  /** 1 = the keyboard leaves the bass to the bass player: no bass note (left hand) and, in the chord, not the bass note either (the root, or the note after the slash of a slash chord) */
  skipBass: 0,
  /** the spread of the notes: 'auto' | 'close' | 'drop2' | 'drop3' (the second / third note from the top of a close voicing dropped an octave) */
  spacing: 'auto',
});
export const SPACINGS = Object.freeze(['auto', 'close', 'drop2', 'drop3']);

/** Weights of the voice-leading rules (Scorsaire's own choices, to be tuned by ear). One unit = one semitone of movement. */
export const VOICE_COSTS = Object.freeze({
  /** per semitone the notes move (each note against the previous voicing, from the lowest) */
  move: 1,
  /** a note that stays where it was (a common tone): the more the better */
  common: 2,
  /** per semitone the top note leaps, times `topSmooth` */
  top: 0.5,
  /** a semitone / minor ninth between the two top notes, between two other neighbours */
  secondTop: 40,
  second: 15,
  /** the top note moves the same way as the bass (`contrary`) */
  sameWay: 3,
  /** parallel fifths or octaves between the bass and the top note (`noParallels`) */
  parallel: 30,
  /** a voicing wider than an octave, with `spacing: 'auto'` */
  wide: 2,
  /** a voicing that is not of the spacing asked for */
  spacing: 5,
  /** the sixth played in place of a major seventh: it has to do clearly better */
  sixth: 10,
  /** the distance of the middle of the hand from the middle of the compass, per semitone */
  centre: 0.15,
});
export const APPROACH_KINDS = Object.freeze(['off', 'dominant', 'tritone', 'chromatic', 'parallel']);

const mod12 = (n) => ((n % 12) + 12) % 12;
export const BASS_LOW = 36;
export const BASS_HIGH = 52;

/**
 * Pitch classes of the chord tones played by the right hand: root and chord tones; a chord of more than 4 tones loses its fifth.
 * `skip` = a pitch class to leave out (the bass note, for a keyboard that leaves the bass to the bass player).
 */
export function chordTones(spec, { skip = null } = {}) {
  const pcs = [...new Set([spec.rootPc, ...spec.intervals.map((i) => mod12(spec.rootPc + i))])].filter((pc) => pc !== skip);
  if (pcs.length > 4) { const fifth = mod12(spec.rootPc + 7); const k = pcs.indexOf(fifth); if (k >= 0) pcs.splice(k, 1); }
  return pcs;
}

/**
 * The spread of a voicing: 'close' (inside an octave), 'drop2' / 'drop3' (the second / third note from the top of a close voicing dropped an octave), 'other'.
 * Fewer than three notes have no spread to speak of ('close').
 */
export function voicingShape(notes) {
  const n = [...notes].sort((a, b) => a - b);
  if (n.length < 3 || n[n.length - 1] - n[0] < 12) return 'close';
  const raised = n[0] + 12; const rest = n.slice(1);
  if (Math.max(...rest, raised) - Math.min(...rest, raised) >= 12) return 'other';
  const k = 1 + rest.filter((x) => x > raised).length;
  return k === 2 ? 'drop2' : k === 3 ? 'drop3' : 'other';
}

/**
 * What a right-hand voicing costs, given the one before it (the lower, the better): the movement of its notes, the common tones it keeps, the leap of its top note, a semitone
 * between neighbouring notes, the spread asked for and, with a bass, the contrary motion and the parallel fifths / octaves.
 * @param rules { topSmooth, avoidSeconds, spacing, contrary, noParallels } (the options of the card; none = only the movement)
 * @param ctx   { prev (sorted notes | null), bass, prevBass (MIDI | null), centre }
 */
export function voicingCost(notes, rules = {}, { prev = null, bass = null, prevBass = null, centre = 65.5 } = {}) {
  const C = VOICE_COSTS;
  const sorted = [...notes].sort((a, b) => a - b);
  const top = sorted[sorted.length - 1];
  let c = 0;
  if (prev?.length) {
    const before = [...prev].sort((a, b) => a - b);
    if (before.length === sorted.length) c += C.move * sorted.reduce((s, n, i) => s + Math.abs(n - before[i]), 0);
    else c += C.move * sorted.reduce((s, n) => s + Math.min(...before.map((p) => Math.abs(n - p))), 0);
    c -= C.common * sorted.filter((n) => before.includes(n)).length;
    c += C.top * (rules.topSmooth ?? 0) * Math.abs(top - before[before.length - 1]);
  }
  c += C.centre * Math.abs(sorted.reduce((s, n) => s + n, 0) / sorted.length - centre);
  if (rules.avoidSeconds) {
    for (let i = 0; i + 1 < sorted.length; i++) {
      const gap = sorted[i + 1] - sorted[i];
      if (gap === 1 || gap === 13) c += i + 2 === sorted.length ? C.secondTop : C.second;
    }
  }
  const shape = voicingShape(sorted);
  if (rules.spacing && rules.spacing !== 'auto') { if (sorted.length >= 3 && shape !== rules.spacing) c += C.spacing; } else if (shape === 'other' || sorted[sorted.length - 1] - sorted[0] > 12) c += C.wide;
  if (prev?.length && bass !== null && prevBass !== null) {
    const dBass = Math.sign(bass - prevBass); const dTop = Math.sign(top - Math.max(...prev));
    if (dBass !== 0 && dBass === dTop) {
      if (rules.contrary) c += C.sameWay;
      if (rules.noParallels) { const before = ((Math.max(...prev) - prevBass) % 12 + 12) % 12; const now = ((top - bass) % 12 + 12) % 12; if (before === now && (now === 7 || now === 0)) c += C.parallel; }
    }
  }
  return c;
}

/**
 * Right-hand voicing of a chord that follows the previous one by the voice-leading rules (`voicingCost`): common tones stay, the others move as little as possible.
 * @param prev   previous right-hand notes (MIDI, any order) or null
 * @param pcs    pitch classes to sound, one note each
 * @param rules  the rules of the card (see `voicingCost`), none for a plain "least movement"
 * @param ctx    { bass, prevBass } the bass notes of this chord and of the previous one, for the rules between bass and top
 * @returns {{ notes: number[], cost: number }} sorted MIDI notes inside [low, high], within two octaves (relaxed when nothing fits); empty when a pitch class has no note in the compass
 */
export function voiceLeadScored(prev, pcs, { low = COMPING_DEFAULTS.handLow, high = COMPING_DEFAULTS.handHigh, rules = {}, bass = null, prevBass = null } = {}) {
  const options = pcs.map((pc) => { const out = []; for (let p = low; p <= high; p++) if (mod12(p) === pc) out.push(p); return out; });
  if (options.some((o) => !o.length)) return { notes: [], cost: Infinity };
  const centre = (low + high) / 2;
  const sortedPrev = prev ? [...prev].sort((a, b) => a - b) : null;
  for (const span of [rules.spacing === 'drop3' ? 20 : 16, 40]) { // a drop 3 voicing is wider than an octave and a half
    let best = null; let bestCost = Infinity;
    const walk = (i, acc) => {
      if (i === options.length) {
        const notes = [...acc].sort((a, b) => a - b);
        if (notes[notes.length - 1] - notes[0] > span) return;
        const c = voicingCost(notes, rules, { prev: sortedPrev, bass, prevBass, centre });
        if (c < bestCost - 1e-9 || (Math.abs(c - bestCost) < 1e-9 && best && notes.reduce((s, n) => s + n, 0) < best.reduce((s, n) => s + n, 0))) { best = notes; bestCost = c; }
        return;
      }
      for (const p of options[i]) walk(i + 1, [...acc, p]);
    };
    walk(0, []);
    if (best) return { notes: best, cost: bestCost };
  }
  return { notes: [], cost: Infinity };
}

/** Same as `voiceLeadScored`, the notes only (the left hand, and the callers that have no rules). */
export function voiceLead(prev, pcs, options = {}) { return voiceLeadScored(prev, pcs, options).notes; }

/** Bass note (MIDI) of a pitch class in the bass compass, the nearest to the previous bass note (or to the middle of the compass). */
export function bassNote(pc, prev = null) {
  const target = prev ?? Math.round((BASS_LOW + BASS_HIGH) / 2);
  let best = null;
  for (let p = BASS_LOW; p <= BASS_HIGH; p++) if (mod12(p) === pc && (best === null || Math.abs(p - target) < Math.abs(best - target))) best = p;
  return best;
}

/** The chord spec played in place of `target` as an approach: 'dominant' V7, 'tritone' ♭II7, 'chromatic' major chord a semitone below, 'above' / 'below' the target chord itself a semitone up / down (what 'parallel' draws). */
export function approachSpec(kind, target) {
  if (kind === 'dominant') return { rootPc: mod12(target.rootPc + 7), intervals: [0, 4, 7, 10], bassPc: null };
  if (kind === 'tritone') return { rootPc: mod12(target.rootPc + 1), intervals: [0, 4, 7, 10], bassPc: null };
  if (kind === 'chromatic') return { rootPc: mod12(target.rootPc - 1), intervals: [0, 4, 7], bassPc: null };
  if (kind === 'above') return { rootPc: mod12(target.rootPc + 1), intervals: target.intervals, bassPc: null };
  if (kind === 'below') return { rootPc: mod12(target.rootPc - 1), intervals: target.intervals, bassPc: null };
  return null;
}

/** Interval (semitones above the root) a degree part stands for in this chord: its OWN tone (null when the chord has none and the card says 'skip'), or the exact interval of a signed one ("b9"). */
export function degreeSemis(part, spec, o = COMPING_DEFAULTS) {
  if (part.signed) return majorInterval(part.n) + part.accidental;
  const own = chordOwnTone([0, ...spec.intervals], part.n);
  if (own !== null) return own;
  return o.absentDegree === 'play' ? defaultTone(part.n) : null;
}

/**
 * LITERAL pitch (MIDI) of a degree part: the root sits at its lowest place above the bottom of its hand (the right hand's compass, or the bass compass for a left-hand part),
 * the degree above it, then the octave shift of the part. null when the chord has no such degree and the card says 'skip'.
 */
export function degreePitch(part, spec, o = COMPING_DEFAULTS) {
  let root = part.hand === 'left' ? BASS_LOW : o.handLow; while (mod12(root) !== spec.rootPc) root += 1;
  const semis = degreeSemis(part, spec, o);
  return semis === null ? null : root + semis + 12 * (part.oct ?? 0);
}

/**
 * Plan of a rhythm staff played as piano.
 * @param events [{ t, kind: 'chord' | 'rest', id?, articulations?, bpm? }] sorted by time (s)
 * @param ctx    { chordAt(t) → { spec, until, start, next: spec | null } | null, end, options, seed? (the player's), structureOf?(event) → an entry of `structureOfSlots`, ruleOf?(kind, event) → the user's rule there (`ruleFor`) }
 * @returns {{ pitch, t, duration, velocity, hand: 'left' | 'right', approach: boolean, event }[]}
 */
export function planComping(events, ctx) {
  const o = { ...COMPING_DEFAULTS, ...(ctx.options ?? {}) };
  const out = [];
  let prevHand = null; let prevBass = null; let prevLeft = null;
  const picker = createVariationPicker({ seed: ctx.seed ?? 0 });
  events.forEach((ev, i) => {
    if (ev.kind !== 'chord') return;
    const chord = ctx.chordAt(ev.t);
    if (!chord?.spec) return;
    let end = events[i + 1]?.t ?? ctx.end;
    if (ev.dur != null && ev.t + ev.dur < end) end = ev.t + ev.dur; // a pattern hit has its own length
    if (chord.until != null && chord.until < end) end = chord.until;
    if (!(end > ev.t)) return;
    // approach: a hit shortly before the chord changes plays the approach chord of the NEXT chord
    let spec = chord.spec; let approach = false;
    const beat = ev.bpm > 0 ? 60 / ev.bpm : 0.5;
    if (o.approach !== 'off' && chord.next && chord.until != null && chord.next.rootPc !== chord.spec.rootPc && ev.t > chord.start + 1e-6 && chord.until - ev.t <= o.approachBeats * beat + 1e-6) {
      // the approach comes with a chance that the form raises near the end of a section, and not twice at the same place from one pass to the next (`variation.js`)
      const st = ctx.structureOf?.(ev) ?? null;
      const id = `approach|${Math.round(chord.until * 1000)}`;
      if (picker.decide({ id, key: st?.key ?? id, occurrence: st?.occurrence ?? 0, chance: o.approachChance, weight: structureWeight(st, o.structureBoost), noRepeat: !!o.approachNoRepeat, rule: ctx.ruleOf?.('approach', ev) ?? null })) {
        const kind = o.approach === 'parallel' ? (picker.pick(`${id}|direction`) < o.approachBelow ? 'below' : 'above') : o.approach;
        spec = approachSpec(kind, chord.next) ?? spec; approach = true;
      }
    }
    const parts = ev.parts ?? null; // a pattern hit (chordpatterns.js): what it sounds is given by its parts, not "bass + the whole chord"
    const wants = (kind) => !parts || parts.some((q) => q.kind === kind);
    // each hand of a pattern is LITERAL (a degree sounds at the octave it is written) or LED (the degrees only give the notes; the octaves are chosen to move as little as possible from the previous hit)
    const modes = { rh: ev.voices?.rh ?? 'literal', lh: ev.voices?.lh ?? 'literal' };
    const degrees = (hand) => (parts ?? []).filter((q) => q.kind === 'degree' && (q.hand ?? 'right') === hand);
    const pcOf = (q) => { const semis = degreeSemis(q, spec, o); return semis === null ? null : mod12(spec.rootPc + semis); };
    const rightPcs = [...new Set([...(wants('chord') ? chordTones(spec, { skip: o.skipBass ? mod12(spec.bassPc ?? spec.rootPc) : null }) : []), ...(modes.rh === 'led' ? degrees('right').map(pcOf).filter((x) => x !== null) : [])])];
    const bass = wants('bass') && !o.skipBass ? bassNote(spec.bassPc ?? spec.rootPc, prevBass) : null;
    const rules = { topSmooth: o.topSmooth, avoidSeconds: !!o.avoidSeconds, spacing: o.spacing, contrary: !!o.contrary, noParallels: !!o.noParallels };
    const lead = (pcs) => voiceLeadScored(prevHand, pcs, { low: o.handLow, high: o.handHigh, rules, bass, prevBass });
    let led = rightPcs.length ? lead(rightPcs) : null;
    // a major seventh that no placement keeps from clashing (a semitone under the top note) may give way to the sixth, if that does clearly better
    if (led && o.sixthForSeventh && spec.intervals.includes(11)) {
      const seventh = mod12(spec.rootPc + 11); const sixth = mod12(spec.rootPc + 9);
      if (rightPcs.includes(seventh) && !rightPcs.includes(sixth)) {
        const alt = lead(rightPcs.map((pc) => (pc === seventh ? sixth : pc)));
        if (alt.notes.length && alt.cost + VOICE_COSTS.sixth < led.cost) led = alt;
      }
    }
    const hand = led?.notes ?? [];
    const leftPcs = modes.lh === 'led' ? [...new Set(degrees('left').map(pcOf).filter((x) => x !== null))] : [];
    const leftLed = leftPcs.length ? voiceLead(prevLeft, leftPcs, { low: BASS_LOW, high: BASS_LOW + 24 }) : [];
    if (hand.length) prevHand = hand;
    if (bass !== null) prevBass = bass;
    if (leftLed.length) prevLeft = leftLed;
    const arts = ev.articulations ?? [];
    const accent = arts.includes('accent') || arts.includes('marcato') || arts.includes('accentStaccato');
    const staccato = arts.includes('staccato') || arts.includes('staccatissimo') || arts.includes('accentStaccato');
    const length = Math.min(end - ev.t, staccato ? o.staccatoDuration : Infinity);
    const factor = accent ? o.accentBoost : 1;
    const notes = [];
    const add = (pitch, side, velocity) => { if (!notes.some((n) => n.pitch === pitch && n.hand === side)) notes.push({ pitch, hand: side, velocity: velocity * factor }); };
    if (bass !== null) { add(bass, 'left', o.bassVelocity); if (o.bassDouble && bass - 12 >= 24) add(bass - 12, 'left', o.bassVelocity); }
    for (const p of hand) add(p, 'right', o.handVelocity);
    for (const p of leftLed) add(p, 'left', o.bassVelocity);
    for (const q of parts ?? []) {
      if (q.kind !== 'degree') continue;
      const left = q.hand === 'left';
      if ((left ? modes.lh : modes.rh) === 'led') continue; // placed above by the voice leading
      const pitch = degreePitch(q, spec, o);
      if (pitch !== null) add(pitch, left ? 'left' : 'right', left ? o.bassVelocity : o.handVelocity);
    }
    notes.sort((a, b) => a.pitch - b.pitch).forEach((n, k) => {
      const roll = Math.min(k * o.rollMs / 1000, length * 0.5);
      out.push({ ...n, t: ev.t + roll, duration: length - roll, approach, event: ev.id ?? null });
    });
  });
  return out;
}
