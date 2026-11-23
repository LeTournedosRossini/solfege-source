/*
 * Guitar Pro export (GP7, `.gp`). AlphaTab (MPL-2.0, the library that READS Guitar Pro for us) can also WRITE it: the score is composed as alphaTex (AlphaTab's text format), parsed by
 * AlphaTab into its score model, completed in code where alphaTex has no syntax (lyrics), and written by its GP7 exporter. The export is a LOSSY translation, on purpose: what is
 * Scorsaire's own (free positions, containers, grids, cards…) has no place in Guitar Pro and is not carried; everything that was simplified or dropped is listed in the REPORT.
 *
 *   exportGuitarPro(work, { movement, lang }) → { bytes, report, alphaTex }    (async: loads AlphaTab on the first call)
 *
 * What goes over (first movement by default): the tracks that have a tablature (the notation staff linked to it is ignored: Guitar Pro shows both from the same notes), notation staves
 * (a guitar / bass staff with NO tablature gets an automatic fingering: the lowest fret on a string that is free), drum staves, with the time signatures, key signatures, tempos, sections,
 * repeats, exact durations (dots, tuplets), rests, ties, dynamics, the chord names of the chord track (on the beat of the first melodic track that is the nearest to them) and the lyrics
 * (linked syllables on their note's beat, free ones on the nearest beat).
 */
import { loadAlphaTab } from '../import/alphatab-loader.js';
import { createReport } from '../import/report.js';
import { PID } from '../model/pid.js';
import { isRunEntry } from '../model/glissando.js';
import { getProperty } from '../model/props.js';
import { frac, fToNumber, fAdd, fSub, fCmp, fEq, ZERO } from '../model/fraction.js';
import { measureLengthOf, itemDuration } from '../model/timing.js';
import { tuningPitches } from '../model/capo.js';
import { isLinkedStaff, projectLinkedStaff, primaryOf } from '../model/linkedstaff.js';
import { instrumentInfo } from '../model/instruments.js';
import { isApplicable } from '../model/schema.js';
import { MEASURE_DURATION } from '../model/pitch.js';
import { isLyricsTrack, lyricEventsOf } from '../model/lyricevents.js';
import { staffSoundMap } from '../model/percmap.js';
import { chordSymbolsInSpan } from '../model/fretdiagram.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { chordText } from '../lecteur/songbook.js';

const NUMBER = { whole: 1, half: 2, quarter: 4, eighth: 8, sixteenth: 16, thirtysecond: 32, sixtyfourth: 64 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']; // fifths −7 … +7
const GP_TUPLET = { 3: 2, 5: 4, 6: 4, 7: 4, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8 }; // what AlphaTab takes `{tu n}` to mean (n notes in the time of …)
const DYNAMICS = new Set(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']);
const MAX_FRET = 24;
/** A property of a note, or undefined when that kind of note has none. */
const prop = (el, pid) => (isApplicable(el.type, pid) ? getProperty(el, pid) : undefined);
const esc = (text) => String(text ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Splits a length (fraction of a whole note) into rests that Guitar Pro can write: [{ number, dots }]. */
function restsFor(length) {
  const out = []; let rest = length;
  for (const [number, value] of [[1, frac(1, 1)], [2, frac(1, 2)], [4, frac(1, 4)], [8, frac(1, 8)], [16, frac(1, 16)], [32, frac(1, 32)], [64, frac(1, 64)]]) {
    while (fCmp(rest, value) >= 0) { out.push({ number, dots: 0 }); rest = fSub(rest, value); }
  }
  return out;
}

/** The content of voice 1 of a staff for measure `mi`, as beats: [{ start, number, dots, tuplet, rest, notes: [{ pitch, string, fret?, tieEnd, ... }], item }]. */
function beatsOfMeasure(movement, staff, mi, ctx) {
  const length = measureLengthOf(movement.masterbars[mi]);
  const measure = staff.voices?.[0]?.measures?.[mi];
  const out = []; let position = ZERO;
  for (const item of measure?.items ?? []) {
    if (item.type !== 'chord' && item.type !== 'rest') continue;
    const duration = getProperty(item, PID.DURATION);
    const actual = itemDuration(item, length);
    const start = position; position = fAdd(position, actual);
    if (duration.base === MEASURE_DURATION) { for (const r of restsFor(length)) out.push({ start, number: r.number, dots: 0, tuplet: null, rest: true, notes: [], item }); continue; }
    const tuplet = getProperty(item, PID.TUPLET);
    const beat = { start, number: NUMBER[duration.base], dots: duration.dots ?? 0, tuplet: tuplet?.ratio ?? null, rest: item.type === 'rest', notes: [], item };
    if (item.type === 'chord') {
      for (const n of item.notes) beat.notes.push({ el: n, pitch: prop(n, PID.PITCH), string: prop(n, PID.STRING), sound: prop(n, PID.SOUND), dead: prop(n, PID.MUTED) === true, ghost: prop(n, PID.GHOST) === true });
      if (item.graceNotes?.length) ctx.report.warn('gp.grace', 'Grace notes are not exported');
      beat.dynamic = getProperty(item, PID.DYNAMIC);
      beat.rest = beat.notes.length === 0;
    }
    out.push(beat);
  }
  if (!out.length) for (const r of restsFor(length)) out.push({ start: ZERO, number: r.number, dots: 0, tuplet: null, rest: true, notes: [], item: null });
  return out;
}

/** Automatic fingering of the notes of one beat on a tuned staff: assigns `string` (1 = highest) and `fret` to each note, avoiding a string used twice; false when a note cannot be played. */
function fingerBeat(notes, tuning, report) {
  const taken = new Set(); let ok = true;
  for (const n of [...notes].sort((a, b) => b.pitch - a.pitch)) {
    let best = null;
    tuning.forEach((open, i) => { const fret = n.pitch - open; if (fret >= 0 && fret <= MAX_FRET && !taken.has(i + 1) && (!best || fret < best.fret)) best = { string: i + 1, fret }; });
    if (!best) { ok = false; n.drop = true; continue; }
    n.string = best.string; n.fret = best.fret; taken.add(best.string);
  }
  if (!ok) report.warn('gp.unplayable', 'A note that cannot be played on the strings of its instrument was left out');
  return ok;
}

/** Every note of a staff by id (grace notes included), for the pitches a bend or a slide leads to. */
function pitchesById(staffs) {
  const out = new Map();
  for (const staff of staffs) for (const voice of staff?.voices ?? []) for (const m of voice.measures) for (const it of m.items) {
    if (it.type !== 'chord') continue;
    for (const n of [...it.notes, ...(it.graceNotes ?? []).flatMap((g) => g.notes)]) { const pitch = prop(n, PID.PITCH); if (pitch !== undefined) out.set(n.id, pitch); }
  }
  return out;
}

/** The tracks to write and what each is: { track, kind: 'tab' | 'score' | 'percussion', staff (with the content), tuning (highest string first) | null, instrument }. */
function planTracks(movement, ctx) {
  const plans = [];
  for (const track of movement.tracks) {
    if (isLyricsTrack(track) || track.staves.every((s) => getProperty(s, PID.STAFF_TYPE) === 'chord')) continue;
    const typed = (type) => track.staves.find((s) => getProperty(s, PID.STAFF_TYPE) === type);
    const instrumentId = getProperty(track, PID.INSTRUMENT_ID);
    const info = instrumentId ? instrumentInfo(instrumentId) : null;
    const name = getProperty(track, PID.NAME) || info?.name || '';
    const base = { track, name, abbreviation: getProperty(track, PID.ABBREVIATION) ?? '', program: Number.isInteger(info?.program) ? info.program : null, voice: false };
    const perc = typed('percussion');
    const tab = typed('tab');
    const score = typed('score');
    if (perc) plans.push({ ...base, kind: 'percussion', staff: perc, source: perc, tuning: null });
    else if (tab) {
      const staff = isLinkedStaff(tab) ? projectLinkedStaff(movement, tab) : tab;
      if (track.staves.some((s) => s !== tab && getProperty(s, PID.STAFF_TYPE) === 'score')) ctx.report.info('gp.notation', `"${name}": the notation staff linked to the tablature is not exported (Guitar Pro shows both from the tablature notes)`);
      plans.push({ ...base, kind: 'tab', staff, source: tab, tuning: tuningPitches(tab) });
    } else if (score) {
      const strings = info?.strings?.length ? [...info.strings].sort((a, b) => b - a) : null; // the catalogue lists the open strings from the lowest
      if (strings && strings.length >= 4) { ctx.report.info('gp.fingered', `"${name}": automatic fingering`); plans.push({ ...base, kind: 'tab', staff: score, source: score, tuning: strings, fingered: true }); }
      else plans.push({ ...base, kind: 'score', staff: score, source: score, tuning: null, voice: info?.group === 'vocals' || instrumentId === 'voice' });
    } else ctx.report.warn('gp.staffType', `The track "${name}" has no tablature, notation or drum staff: it is not exported`);
  }
  return plans;
}

/** Composes the alphaTex of the whole score; returns { text, perTrack: [{ plan, beats: [bar][beat] }] } (the beats in the order they are written, to attach what alphaTex cannot say). */
function composeAlphaTex(work, movement, plans, ctx) {
  const bars = movement.masterbars;
  const tempoAt = new Map(); // measure → bpm
  for (const t of movement.tempos ?? []) {
    const mi = bars.findIndex((b) => b.id === getProperty(t, PID.MEASURE_ID));
    if (mi < 0) continue;
    if (!fEq(getProperty(t, PID.POSITION) ?? ZERO, ZERO)) ctx.report.info('gp.tempoPosition', 'A tempo written inside a measure is moved to the start of that measure');
    tempoAt.set(mi, Math.round(getProperty(t, PID.TEMPO_BPM)));
  }
  const sectionAt = new Map();
  for (const c of movement.systemContainers ?? []) if ((getProperty(c, PID.CONTAINER_KIND) ?? 'section') === 'section') { const mi = bars.findIndex((b) => b.id === getProperty(c, PID.MEASURE_ID)); const label = getProperty(c, PID.LABEL); if (mi >= 0 && label) sectionAt.set(mi, label); }
  const head = [];
  const title = getProperty(work, PID.TITLE); const composer = getProperty(work, PID.COMPOSER) ?? getProperty(work, PID.SUBTITLE);
  if (title) head.push(`\\title "${esc(title)}"`);
  if (composer) head.push(`\\artist "${esc(composer)}"`);
  head.push(`\\tempo ${tempoAt.get(0) ?? 120}`);
  // the chord names go on the first melodic track, each on the beat that starts nearest to the symbol (a symbol a beat early or late lands on the right beat; the rest are attached to the closest)
  const chordTarget = plans.findIndex((p) => p.kind !== 'percussion');
  const symbols = chordTarget >= 0 && bars.length ? chordSymbolsInSpan(movement, bars[0].id, bars.length) : [];
  const dict = symbols.length ? workChordQualities(work) : null;
  const perTrack = []; const tracksText = [];
  plans.forEach((plan, ti) => {
    const lines = [`\\track "${esc(plan.name)}" "${esc(plan.abbreviation || plan.name.slice(0, 4))}"`];
    if (plan.program !== null && plan.kind !== 'percussion') lines.push(`\\instrument ${plan.program}`);
    if (plan.kind === 'percussion') lines.push('\\instrument percussion', '\\staff {score}');
    else if (plan.kind === 'score') lines.push('\\staff {score}');
    if (plan.tuning) lines.push(`\\tuning ${plan.tuning.map(midiName).join(' ')} .`);
    const ties = new Map(); // the notes that END a tie (a linked tablature has no ties of its own: they are its primary staff's)
    for (const owner of [plan.staff, plan.source, plan.source && primaryOf(movement, plan.source)]) for (const t of (owner && getProperty(owner, PID.TIES)) ?? []) ties.set(t.endNoteId, t.startNoteId);
    const owners = [plan.staff, plan.source, plan.source && primaryOf(movement, plan.source)].filter(Boolean);
    const pitchOf = pitchesById(owners);
    const bendsFrom = new Map(); const slidesFrom = new Set();
    for (const owner of owners) {
      for (const b of getProperty(owner, PID.BENDS) ?? []) { if (b.type === 'bend' && b.startNoteId !== b.endNoteId) bendsFrom.set(b.startNoteId, b.endNoteId); else if (b.type !== 'bend' || b.startNoteId === b.endNoteId) ctx.report.warn('gp.bend', 'A pre-bend, a small bend or a dip is not exported'); }
      for (const g of getProperty(owner, PID.GLISSANDOS) ?? []) { if (isRunEntry(g)) ctx.report.warn('gp.glissandoRun', 'An organ glissando run is not exported (it starts on a grace note)'); else slidesFrom.add(g.startNoteId); }
    }
    /** What a note carries in braces: its bend (up to the pitch the chain of bends ends on, in quarter tones) and its slide. */
    const noteEffects = (n) => {
      const fx = [];
      let end = bendsFrom.get(n.el.id); let hops = 0; let last = null;
      while (end && hops < 8) { last = end; end = bendsFrom.get(end); hops += 1; }
      if (hops > 1) ctx.report.info('gp.bendChain', 'A bend made of several steps is exported as one bend to its last pitch');
      if (last && pitchOf.has(last) && n.pitch !== undefined) { const value = (pitchOf.get(last) - n.pitch) * 2; if (value > 0 && value <= 12) fx.push(`b (0 ${value})`); }
      if (slidesFrom.has(n.el.id)) fx.push('ss');
      if (n.dead) fx.push('x');
      return fx.length ? `{${fx.join(' ')}}` : '';
    };
    const sounds = plan.kind === 'percussion' ? staffSoundMap(getProperty(plan.staff, PID.PERCMAP)) : null;
    const trackBars = []; let ts = null; let ks = null; let open = false;
    bars.forEach((bar, mi) => {
      const meta = [];
      if (ti === 0) {
        const sig = getProperty(bar, PID.TIME_SIG);
        if (!ts || ts[0] !== sig[0] || ts[1] !== sig[1]) { meta.push(`\\ts ${sig[0]} ${sig[1]}`); ts = sig; }
        const key = getProperty(bar, PID.KEY_SIG);
        if (key !== ks && KEY_NAMES[key + 7]) { meta.push(`\\ks ${KEY_NAMES[key + 7]}`); ks = key; }
        if (mi > 0 && tempoAt.has(mi)) meta.push(`\\tempo ${tempoAt.get(mi)}`);
        if (sectionAt.has(mi)) meta.push(`\\section "${esc(sectionAt.get(mi))}"`);
        if (getProperty(bar, PID.REPEAT_START)) { meta.push('\\ro'); open = true; }
        if (getProperty(bar, PID.REPEAT_END)) { meta.push(`\\rc ${Math.max(2, getProperty(bar, PID.REPEAT_COUNT) ?? 2)}`); open = false; }
      }
      const beats = beatsOfMeasure(movement, plan.staff, mi, ctx);
      const names = new Map();
      if (ti === chordTarget) for (const e of symbols) if (e.mi === mi) { const at = nearestBeat([beats], 0, e.position); const name = chordText(e.sym, dict); if (at && name) { names.set(at.beat, name); ctx.report.stat('chords'); } }
      const text = beats.map((b, bi) => {
        const effects = [];
        if (names.has(bi)) effects.push(`ch "${esc(names.get(bi))}"`);
        if (b.dots) effects.push(b.dots === 2 ? 'dd' : 'd');
        if (b.tuplet) { const [a, n] = b.tuplet; if (GP_TUPLET[a] === n) effects.push(`tu ${a}`); else ctx.report.warn('gp.tuplet', `A ${a}:${n} tuplet is written as ordinary notes`); }
        if (b.dynamic && DYNAMICS.has(b.dynamic)) effects.push(`dy ${b.dynamic}`);
        const fx = effects.length ? ` {${effects.join(' ')}}` : '';
        if (b.rest) return plan.kind === 'percussion' ? `:${b.number} r${fx}` : `r.${b.number}${fx}`;
        const tokens = [];
        for (const n of b.notes) {
          if (plan.kind === 'percussion') {
            const midi = sounds?.sounds?.find((s) => s.id === n.sound)?.midi;
            if (Number.isInteger(midi)) tokens.push(String(midi)); else ctx.report.warn('gp.drum', 'A drum note without a General MIDI number was left out');
          } else if (plan.kind === 'score') tokens.push(midiName(n.pitch));
          else if (!plan.fingered) { const string = n.string; const fret = n.pitch - plan.tuning[string - 1]; n.fret = fret; if (fret < 0) { n.drop = true; continue; } tokens.push(ties.has(n.el.id) ? `-.${string}` : `${fret}.${string}${noteEffects(n)}`); }
        }
        if (plan.fingered) { fingerBeat(b.notes, plan.tuning, ctx.report); for (const n of b.notes) if (!n.drop) tokens.push(ties.has(n.el.id) ? `-.${n.string}` : `${n.fret}.${n.string}${noteEffects(n)}`); }
        if (!tokens.length) return `r.${b.number}${fx}`;
        if (plan.kind === 'percussion') return `:${b.number} ${tokens.length > 1 ? `(${tokens.join(' ')})` : tokens[0]}${fx}`; // a number with a dot would be read as fret.string
        return `${tokens.length > 1 ? `(${tokens.join(' ')})` : tokens[0]}.${b.number}${fx}`;
      }).join(' ');
      trackBars.push(beats);
      lines.push(`${meta.join(' ')} ${text} |`.trim());
    });
    if (open) ctx.report.warn('gp.repeat', 'A repeat that is never closed');
    tracksText.push(lines.join('\n'));
    perTrack.push({ plan, beats: trackBars });
  });
  return { text: `${head.join('\n')}\n${tracksText.join('\n')}`, perTrack };
}

/** The nearest beat of `bars` to (measure, position): { bar, beat } — the beat that starts closest to it in that measure. */
function nearestBeat(perTrackBeats, measure, position) {
  const beats = perTrackBeats[measure]; if (!beats?.length) return null;
  let best = 0; let bestD = Infinity;
  beats.forEach((b, i) => { const d = Math.abs(fToNumber(b.start) - fToNumber(position)); if (d < bestD - 1e-9) { bestD = d; best = i; } });
  return { bar: measure, beat: best };
}

export async function exportGuitarPro(work, { movement = 0, lang = 'en' } = {}) {
  const report = createReport(); const ctx = { report, lang };
  const mv = work.movements[movement];
  if (!mv) throw new Error('No movement to export');
  const plans = planTracks(mv, ctx);
  if (!plans.length) throw new Error('Nothing to export: no track with a tablature, a notation staff or a drum staff');
  const { text, perTrack } = composeAlphaTex(work, mv, plans, ctx);
  const at = await loadAlphaTab();
  if (!at.exporter?.Gp7Exporter) throw new Error('This build of AlphaTab cannot write Guitar Pro files');
  const settings = new at.Settings();
  const importer = new at.importer.AlphaTexImporter();
  importer.initFromString(text, settings);
  let score;
  try { score = importer.readScore(); } catch (e) { throw new Error(`The Guitar Pro score could not be composed: ${e?.message ?? e}${importer.lexerDiagnostics?.hasErrors || importer.parserDiagnostics?.hasErrors ? ` (${[importer.lexerDiagnostics, importer.parserDiagnostics, importer.semanticDiagnostics].filter(Boolean).map((d) => String(d)).join('; ')})` : ''}`); }
  attachExtras(work, mv, perTrack, score, ctx);
  report.stat('tracks', plans.length); report.stat('measures', mv.masterbars.length);
  const bytes = new at.exporter.Gp7Exporter().export(score, settings);
  return { bytes, report: report.result(), alphaTex: text };
}

/** What alphaTex cannot say: chord names (on the nearest beat of the first melodic track) and lyrics (on the beat of the linked note, or the nearest beat), set on the parsed score. */
function attachExtras(work, movement, perTrack, score, ctx) {
  const melodic = perTrack.findIndex((p) => p.plan.kind !== 'percussion');
  if (melodic < 0) return;
  const vocal = perTrack.findIndex((p) => p.plan.voice);
  const chordTrackStaves = movement.tracks.flatMap((t) => t.staves).filter((s) => getProperty(s, PID.STAFF_TYPE) === 'chord');
  const staffOf = (ti) => score.tracks[ti].staves[0];
  // lyrics
  const lyricTarget = vocal >= 0 ? vocal : melodic;
  const beatOfChordId = new Map(); // chord element id → { bar, beat } in the lyric track
  perTrack[lyricTarget].beats.forEach((beats, mi) => beats.forEach((b, k) => { if (b.item) beatOfChordId.set(b.item.id, { bar: mi, beat: k }); }));
  let placed = 0; let lost = 0;
  for (const track of movement.tracks) for (const staff of track.staves) {
    if (getProperty(staff, PID.STAFF_TYPE) !== 'lyrics') continue;
    for (const e of lyricEventsOf(staff)) {
      if (!e.text) continue;
      const at = (e.target && beatOfChordId.get(e.target)) || nearestBeat(perTrack[lyricTarget].beats, e.measure, e.position);
      const beat = at && staffOf(lyricTarget).bars[at.bar]?.voices[0]?.beats[at.beat];
      if (!beat || beat.isRest) { lost += 1; continue; }
      const lines = beat.lyrics ?? []; lines[e.line] = [lines[e.line], e.text].filter(Boolean).join(' '); beat.lyrics = lines.map((l) => l ?? ''); placed += 1;
    }
  }
  if (lost) ctx.report.warn('gp.lyricsLost', `${lost} lyric syllable(s) had no note to stand on and were left out`);
  if (placed) ctx.report.stat('lyrics', placed);
  void chordTrackStaves; void work;
}
