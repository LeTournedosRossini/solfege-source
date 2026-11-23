// What a DRUM track plays by itself (model/player.js, model/grooves.js): the groove of the player, bar after bar, with its variations — a fill (break) that replaces the end of a bar, extra hits,
// a crash on the first bar of a section. PURE (no DOM, no document). Like `planPlayerTrack` for the chord players, the playback and the window that writes the result as notes share it.
//
// Nothing is drawn at random while playing: every chance is decided by the seed of the player, the place in the form and the user's rules (`model/variation.js`). The decisions are made for EVERY played
// measure, in order, even when only some of them are asked for (the window writes a range): that way the "not twice at the same place" rule gives the same result as the playback.
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { measureLengthOf } from '../model/timing.js';
import { fAdd, fSub, fCmp as fCompare } from '../model/fraction.js';
import { grooveHitsForMeasure, grooveVersionCount, soundForRole, fCmp } from '../model/grooves.js';
import { structureOfSlots, structureWeight, createVariationPicker, ruleFor } from '../model/variation.js';
import { resolveStrumCard, strumOptionsFor } from '../model/strumcards.js';
import { drumSound } from '../model/percmap.js';
import { cuesForTrack, MAIN_VERSION, NO_BREAK } from '../model/cueedit.js';

/** Length of a drum hit in seconds (a drum sound is sampled: it only has to ring out). */
const HIT_SECONDS = 0.2;
/** Bars per phrase when the piece has no sections: the groove changes version every phrase. */
const VERSION_PHRASE = 8;

/**
 * Which version of the groove (0 = the main one, k = its k-th variant) each played measure uses, by itself: a piece with sections gives each kind of section (its category, else its label) a version
 * in order of first appearance, so a chorus always has the same groove; a piece without sections changes version every `VERSION_PHRASE` bars. Measures are numbered in the movement, a repeat plays the same version.
 */
export function groveVersions(groove, slots, structure, phrase = VERSION_PHRASE, cues = null) {
  const n = grooveVersionCount(groove);
  if (n <= 1) return slots.map(() => 0);
  const order = [];
  return slots.map((slot, k) => {
    const st = structure[k];
    // a cue on the score (model/cueedit.js) is the author's word: the version it names, from its measure on
    const said = cues?.version(slot.measure) ?? null;
    if (said === MAIN_VERSION) return 0;
    const asked = said ? (groove.variants ?? []).findIndex((v) => v.id === said) : -1;
    if (asked >= 0) return asked + 1;
    if (st?.section == null) return Math.floor(slot.measure / phrase) % n;
    const kind = st.category ?? st.section;
    if (!order.includes(kind)) order.push(kind);
    return order.indexOf(kind) % n;
  });
}

/** The written length of a hit is the space up to the next one, at most a quarter note. */
const MAX_WRITTEN = [1, 4];

/**
 * @param p { track, mv, layout, tl, slots, onlyMeasures?, groove (a checked groove), percmap (of the track's percussion staff), cards { project, user } }
 * @returns {{ kind: 'drums', instrument: 'drums', card, items, notes } | null}
 *   `items` = one per place where something is hit (`id`, `abs`, `durFrac`, `slot`, …) and `notes` = one per drum hit (`pitch` = the MIDI number of the sound, `sound` = its id, `role`, `event` = id of the item).
 */
export function planDrumTrack({ track, mv, layout, tl, slots, onlyMeasures = null, groove, percmap, cards = { project: [], user: [] }, versionPhrase = VERSION_PHRASE }) {
  if (!groove) return null;
  const { card } = resolveStrumCard(getProperty(track, PID.PLAYER_CARD), { project: cards.project ?? [], user: cards.user ?? [], kind: 'drums' });
  const o = strumOptionsFor(card);
  const rules = getProperty(track, PID.PLAYER_RULES) ?? [];
  const structure = structureOfSlots(mv, slots);
  const picker = createVariationPicker({ seed: getProperty(track, PID.PLAYER_SEED) ?? 0 });
  const items = []; const notes = [];
  const cues = cuesForTrack(mv, track.id);
  let lastFill = -Infinity; // the played measure of the last break: `fillSpacing` bars must pass before the next one
  const versions = groveVersions(groove, slots, structure, versionPhrase, cues);
  slots.forEach((slot, k) => {
    const length = measureLengthOf(mv.masterbars[slot.measure]);
    const st = structure[k];
    let hits = grooveHitsForMeasure(groove, length, slot.measure, versions[k]);

    // a fill replaces the groove from its start to the end of the bar; never in the very first measure, unless the user asked for it
    let fillFrom = null;
    const fills = groove.fills ?? [];
    const said = cues.breakAt(slot.measure); // a break cue on this measure: that fill, or none — the author's word, outside the chances and the "not twice" rule
    const forced = said && said !== NO_BREAK ? fills.find((f) => f.id === said) ?? null : null;
    if (said === NO_BREAK) { /* no fill here */ } else if (forced) {
      fillFrom = forced.from; lastFill = k;
      hits = [...hits.filter((x) => fCmp(x.at, forced.from) < 0), ...forced.hits.filter((x) => fCmp(x.at, length) < 0)];
    } else if (fills.length) {
      const fill = fills[Math.floor(picker.pick(`fill|${k}|which`) * fills.length)];
      const rule = ruleFor(rules, 'break', st);
      // the last bar before a change of section (the real ones, else the phrases of `structureOfSlots`); never the last bar of the piece, which leads nowhere
      const beforeChange = st.barsLeft === 0 && k < slots.length - 1;
      let take = false;
      if (rule?.mode === 'never') take = false;
      else if (o.fillBeforeSection && o.variation > 0 && beforeChange && k > 0) take = true; // always there: the break is the sign of the change (the spacing does not apply)
      else if ((k > 0 || rule?.mode === 'always') && (!o.fillOnlyBeforeSection || beforeChange || rule?.mode === 'always') && (k - lastFill >= (o.fillSpacing ?? 0) || rule?.mode === 'always')) {
        take = picker.decide({ id: `fill|${k}`, key: st.key, occurrence: st.occurrence, chance: fill.chance * o.variation, weight: structureWeight(st, o.structureBoost), noRepeat: !!o.fillNoRepeat, rule });
      }
      if (take) {
        fillFrom = fill.from; lastFill = k;
        hits = [...hits.filter((x) => fCmp(x.at, fill.from) < 0), ...fill.hits.filter((x) => fCmp(x.at, length) < 0)];
      }
    }
    // extra hits (a ghost note, an added kick) that the groove allows, where the bar was not given over to a fill
    (groove.extras ?? []).forEach((e, i) => {
      const yes = picker.decide({ id: `extra|${k}|${i}`, chance: e.chance * o.variation, rule: ruleFor(rules, 'extra', st) });
      if (!yes || fCmp(e.at, length) >= 0 || (fillFrom && fCmp(e.at, fillFrom) >= 0)) return;
      if (!hits.some((x) => x.role === e.role && fCmp(x.at, e.at) === 0)) hits.push({ at: e.at, role: e.role, velocity: e.velocity });
    });
    // a crash on the first bar of a section (not at the very start of the piece)
    if (o.sectionCrash && groove.crashOnSection !== false && st.section != null && st.sectionStart && k > 0 && ruleFor(rules, 'extra', st)?.mode !== 'never' && !hits.some((x) => x.role === 'crash' && fCmp(x.at, [0, 1]) === 0)) {
      hits.push({ at: [0, 1], role: 'crash', velocity: 1.1 });
    }
    if (onlyMeasures && !onlyMeasures.has(slot.measure)) return;

    // the hits of a place make one item (one chord when written out)
    const places = [...new Set(hits.map((x) => `${x.at[0]}/${x.at[1]}`))].map((key) => key.split('/').map(Number)).sort(fCompare);
    const base = tl.secondsAt(layout.starts[slot.measure]);
    places.forEach((at, j) => {
      const next = places[j + 1] ?? length;
      let durFrac = fSub(next, at);
      if (fCmp(durFrac, MAX_WRITTEN) > 0) durFrac = [...MAX_WRITTEN];
      const abs = fAdd(layout.starts[slot.measure], at);
      const id = `${track.id}:d${k}.${j}`;
      const t = slot.t + (tl.secondsAt(abs) - base);
      items.push({ t, kind: 'chord', id, abs, durFrac, dur: tl.secondsEndAt(fAdd(abs, durFrac)) - tl.secondsAt(abs), voiceIndex: 0, slot, offbeat: false, bpm: tl.tempoAt(abs) * 240, articulations: [], muted: false });
      for (const x of hits.filter((y) => fCmp(y.at, at) === 0)) {
        const sound = soundForRole(percmap, x.role);
        if (!sound) continue; // the kit has no such sound: nothing to play for this role
        notes.push({ pitch: drumSound(percmap, sound)?.midi ?? null, sound, role: x.role, t, duration: HIT_SECONDS, velocity: x.velocity * o.velocityScale, event: id });
      }
    });
  });
  items.sort((a, b) => a.t - b.t);
  return { kind: 'drums', instrument: 'drums', card, items, notes };
}
