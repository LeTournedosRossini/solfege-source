/*
 * Mode de saisie sur grille — ÉTAT et conversion, SANS DOM ni vue (voir `model/gridedit.js` pour la règle de durée).
 *
 * L'état est celui de l'APPLICATION : il n'entre jamais dans le Document tant qu'on ne quitte pas le mode. À l'entrée, `readGrid` relève les
 * frappes de la portée (début de chaque accord, son de chaque note) et choisit, temps par temps, la plus petite grille qui les contient ;
 * l'utilisateur ajoute / retire des frappes et change la grille d'un temps ; à la sortie, `commitGrid` réécrit, en UNE transaction du
 * Document (donc annulable d'un seul coup), les seules mesures dont les frappes ont changé. Les autres ne sont pas touchées (articulations,
 * nuances, liaisons… restent intactes).
 *
 * Écarts / limites : une mesure réécrite perd les durées d'origine (une frappe dure jusqu'à la suivante ou la fin du temps) ; un accord
 * dont l'instant et les sons sont inchangés GARDE son identité (donc ses articulations) mais ses liaisons de prolongation d'origine
 * peuvent viser une note disparue (elles sont alors retirées avec elle) ; un temps dont les frappes n'entrent dans aucune grille
 * proposée est VERROUILLÉ (il faut lui choisir une grille, ce qui retire les frappes qui n'y tombent pas).
 */
import {
  PID, getProperty, staffSoundMap, drumSound, createChord, createPercNote, createRhythmChord, measureTimeline, measureLengthOf,
  measureOffsetOf, GridError, beatsOf, beatGrid, fitBeatCells, cellStart, cellIndexAt, cellCountCandidates, planVoiceMeasure, applyVoiceMeasurePlan,
} from '../model/index.js';
import { GHOST_SUFFIX, isGhostSound, baseSoundOf } from '../model/percmap.js';
import { defaultGrouping, sameGrouping } from '../model/metergroups.js';
import { frac, fAdd, fSub, fMul, fDiv, fEq, fLt, fLe } from '../model/fraction.js';

/** Types de portée pris en charge par le mode grille. */
export const GRID_STAFF_TYPES = ['percussion', 'rhythm', 'neutral'];

/** Son « unique » des portées sans sons (rythmique, neutre). */
export const NO_SOUND = '_';

const keyOf = (h) => `${h.t[0]}/${h.t[1]}|${h.sound}`;

function signature(hits) {
  return hits.map(keyOf).sort().join(';');
}

/** The beats of a measure with the smallest grid that holds its hits (`cells` forces the first choice), for a grouping of the beats (null = the beat of the time signature). */
function buildBeats({ timeSig, length, offset, grouping }, hits, cells = null) {
  return beatsOf(timeSig, length, offset, grouping).map((beat) => {
    const onsets = hits.filter((h) => fLe(beat.start, h.t) && fLt(h.t, beat.end)).map((h) => h.t);
    const candidates = cells ? [cells, ...cellCountCandidates(fSub(beat.end, beat.start))] : undefined;
    const fit = fitBeatCells(beat, onsets, candidates);
    const fallback = cells ?? cellCountCandidates(fSub(beat.end, beat.start))[0];
    return { start: beat.start, end: beat.end, cells: fit ?? fallback, locked: fit === null };
  });
}

/**
 * Relève la grille d'une portée.
 * @returns {{ staffId, type, percmap, measures: Array<{ beats: Array<{start, end, cells, locked}>, hits: Array<{t, sound}>, original: string, length, offset, timeSig }> }}
 */
export function readGrid(doc, staff, { cells = null } = {}) {
  const type = getProperty(staff, PID.STAFF_TYPE);
  if (!GRID_STAFF_TYPES.includes(type)) throw new GridError('Le mode grille ne concerne pas ce type de portée');
  const mv = doc.movementOf(staff);
  const percmap = type === 'percussion' ? staffSoundMap(getProperty(staff, PID.PERCMAP)) : null;
  const measures = mv.masterbars.map((mb, mi) => {
    const length = measureLengthOf(mb);
    const offset = measureOffsetOf(mb, mi === 0);
    const timeSig = getProperty(mb, PID.TIME_SIG);
    const hits = [];
    const seen = new Set();
    staff.voices.forEach((voice) => {
      const measure = voice.measures[mi];
      if (!measure) return;
      for (const u of measureTimeline(measure, length)) {
        if (u.item.type !== 'chord') continue;
        for (const note of u.item.notes) {
          const sound = type === 'percussion' ? getProperty(note, PID.SOUND) + (getProperty(note, PID.GHOST) || getProperty(note, PID.PARENTHESES) ? GHOST_SUFFIX : '') : NO_SOUND; // (a ghost note is its own sound of the grid)
          const h = { t: u.start, sound };
          if (!seen.has(keyOf(h))) { seen.add(keyOf(h)); hits.push(h); }
        }
      }
    });
    const own = getProperty(mb, PID.BEAM_GROUPING);
    const grouping = own?.length ? own : defaultGrouping(timeSig); // asymmetric measures: 3 + 2, 3 + 2 + 2… (the author's choice, else the usual one)
    const beats = buildBeats({ timeSig, length, offset, grouping }, hits, cells);
    return { beats, hits, original: signature(hits), length, offset, timeSig, grouping, groupingOriginal: grouping };
  });
  return { staffId: staff.id, type, percmap, measures };
}

function beatIndexAt(measure, t) {
  return measure.beats.findIndex((b) => fLe(b.start, t) && fLt(t, b.end));
}

/** Case (indice dans le temps) de l'instant `t`, ou null s'il ne tombe pas sur la grille du temps. */
export function cellAt(measure, beatIndex, t) {
  const b = measure.beats[beatIndex];
  return b ? cellIndexAt(b, t) : null;
}

/** Instant de début de la case `cell` du temps `beatIndex`. */
export function cellTime(measure, beatIndex, cell) {
  return cellStart(measure.beats[beatIndex], cell);
}

/** Frappes d'une case : sons posés à cet instant. */
export function hitsAt(measure, beatIndex, cell) {
  const t = cellTime(measure, beatIndex, cell);
  return measure.hits.filter((h) => fEq(h.t, t)).map((h) => h.sound);
}

/** Pose ou retire la frappe `sound` à la case. Retourne 'added' ou 'removed'. */
export function toggleHit(state, mi, beatIndex, cell, sound) {
  const m = state.measures[mi];
  if (!m) throw new GridError('Mesure inexistante');
  const b = m.beats[beatIndex];
  if (!b) throw new GridError('Temps inexistant');
  if (b.locked) throw new GridError('Ce temps est verrouillé : choisissez-lui une grille');
  if (!Number.isInteger(cell) || cell < 0 || cell >= b.cells) throw new GridError('Case hors du temps');
  if (state.type === 'percussion' && !drumSound(state.percmap, baseSoundOf(sound))) throw new GridError('Son absent de la carte de percussion');
  const t = cellTime(m, beatIndex, cell);
  const at = m.hits.findIndex((h) => fEq(h.t, t) && h.sound === sound);
  if (at >= 0) { m.hits.splice(at, 1); return 'removed'; }
  m.hits.push({ t, sound });
  return 'added';
}

/** Change la grille d'un temps. Les frappes qui ne tombent pas sur la nouvelle grille sont retirées : leur nombre est retourné. */
export function setBeatCells(state, mi, beatIndex, n) {
  const m = state.measures[mi];
  const b = m?.beats[beatIndex];
  if (!b) throw new GridError('Temps inexistant');
  const grid = beatGrid(fSub(b.end, b.start), n); // lève si la division n'est pas écrivable
  const before = m.hits.length;
  m.hits = m.hits.filter((h) => {
    if (!(fLe(b.start, h.t) && fLt(h.t, b.end))) return true;
    return fDiv(fSub(h.t, b.start), grid.cell)[1] === 1;
  });
  b.cells = n;
  b.locked = false;
  return before - m.hits.length;
}

/**
 * Regroups the beats of a measure (5/8 as 3 + 2 or 2 + 3…): the beats are rebuilt from the hits, each with the smallest grid that holds them (a beat whose hits fit no grid is locked,
 * like at the first reading). With `sameSignature` every measure of the draft that has the same time signature is regrouped too. Written to the masterbars with the hits (`commitGrid`).
 */
export function setMeasureGrouping(state, mi, grouping, { sameSignature = true } = {}) {
  const m = state.measures[mi];
  if (!m) throw new GridError('Mesure inexistante');
  const sig = m.timeSig;
  for (const x of state.measures) {
    if (x !== m && !(sameSignature && x.timeSig[0] === sig[0] && x.timeSig[1] === sig[1])) continue;
    x.grouping = grouping?.length ? [...grouping] : null;
    x.beats = buildBeats({ timeSig: x.timeSig, length: x.length, offset: x.offset, grouping: x.grouping }, x.hits);
  }
}

/** Index des mesures dont les frappes ont changé depuis la lecture. */
export function changedMeasures(state) {
  return state.measures.map((m, i) => (signature(m.hits) === m.original ? -1 : i)).filter((i) => i >= 0);
}

/**
 * Écrit les mesures modifiées dans le Document, À APPELER DANS `doc.transaction`. Retourne les index de mesures réécrites.
 * Lève GridError (le Document n'est alors modifié que partiellement : la transaction doit être annulée par l'appelant, ce que fait
 * `doc.transaction` quand la fonction lève) si un temps verrouillé contient des frappes hors grille.
 */
export function commitGrid(doc, staff, state) {
  const rewritten = [];
  const mv = doc.movementOf(staff);
  state.measures.forEach((m, mi) => { // a grouping chosen in the mode goes to the masterbar (the notation follows); the usual grouping is no choice at all
    if (sameGrouping(m.grouping, m.groupingOriginal)) return;
    const bar = mv.masterbars[mi];
    if (m.grouping?.length && !sameGrouping(m.grouping, defaultGrouping(m.timeSig))) doc.set(bar, PID.BEAM_GROUPING, m.grouping);
    else if (getProperty(bar, PID.BEAM_GROUPING) !== null) doc.reset(bar, PID.BEAM_GROUPING);
  });
  for (const mi of changedMeasures(state)) {
    const m = state.measures[mi];
    // chaque frappe → (voix, temps, case)
    const cellsByVoice = new Map(); // voix → Map("beat:cell" → sons)
    for (const h of m.hits) {
      const bi = beatIndexAt(m, h.t);
      const cell = bi >= 0 ? cellAt(m, bi, h.t) : null;
      if (cell === null) throw new GridError(`Mesure ${mi + 1} : une frappe ne tombe sur aucune grille (temps verrouillé)`);
      const voice = state.type === 'percussion' ? (drumSound(state.percmap, baseSoundOf(h.sound))?.voice ?? 0) : 0;
      if (!cellsByVoice.has(voice)) cellsByVoice.set(voice, new Map());
      const cmap = cellsByVoice.get(voice);
      const key = `${bi}:${cell}`;
      if (!cmap.has(key)) cmap.set(key, []);
      cmap.get(key).push(h.sound);
    }
    const voices = new Set([...cellsByVoice.keys()]);
    for (let v = 0; v < staff.voices.length; v++) voices.add(v);
    for (const v of [...voices].sort((a, b) => a - b)) {
      const cmap = cellsByVoice.get(v) ?? new Map();
      const beats = m.beats.map((b, bi) => ({
        start: b.start,
        end: b.end,
        cells: b.cells,
        hits: [...cmap.keys()].filter((k) => k.startsWith(`${bi}:`)).map((k) => Number(k.split(':')[1])),
      }));
      const plan = planVoiceMeasure({ beats, rhythm: { timeSig: m.timeSig, length: m.length, offset: m.offset } });
      const order = (sounds) => (state.type === 'percussion'
        ? [...new Set(sounds)].sort()
        : [NO_SOUND]);
      const oldMeasure = staff.voices[v]?.measures[mi];
      const oldChords = oldMeasure ? measureTimeline(oldMeasure, m.length).filter((u) => u.item.type === 'chord') : [];
      const soundsOf = (hit) => cmap.get(`${hit.beat}:${hit.cell}`) ?? [];
      const reuse = (hit) => {
        const t = cellTime(m, hit.beat, hit.cell);
        const u = oldChords.find((c) => fEq(c.start, t));
        if (!u) return null;
        const have = u.item.notes.map((n) => (state.type === 'percussion' ? getProperty(n, PID.SOUND) + (getProperty(n, PID.GHOST) || getProperty(n, PID.PARENTHESES) ? GHOST_SUFFIX : '') : NO_SOUND)).sort();
        const want = order(soundsOf(hit));
        return have.length === want.length && have.every((s, i) => s === want[i]) ? u.item : null;
      };
      const makeChord = (d, hit) => {
        if (state.type !== 'percussion') return createRhythmChord(d.base, { dots: d.dots ?? 0 });
        const notes = order(soundsOf(hit)).map((sound) => createPercNote({ sound: baseSoundOf(sound), props: isGhostSound(sound) ? { [PID.GHOST]: true } : {} }));
        return createChord({ duration: d.base, dots: d.dots ?? 0, notes });
      };
      if (v >= staff.voices.length && !plan.length) continue;
      applyVoiceMeasurePlan(doc, { staff, voice: v, measure: mi, plan, makeChord, reuse });
    }
    rewritten.push(mi);
  }
  return rewritten;
}

// ---------- history inside the mode, and moving a hit along the staff ----------

/** The draft as text (the hits and the grid of every beat): what the undo / redo of the mode keeps. */
export const gridSnapshot = (state) => JSON.stringify(state.measures.map((m) => ({ grouping: m.grouping, hits: m.hits, beats: m.beats.map((b) => [b.cells, b.locked]) })));

/** Puts a draft back as `gridSnapshot` kept it (the beats are rebuilt first when the grouping of a measure was changed since). */
export function restoreGrid(state, text) {
  JSON.parse(text).forEach((d, i) => {
    const m = state.measures[i];
    if (!sameGrouping(d.grouping, m.grouping)) { m.grouping = d.grouping; m.beats = buildBeats({ timeSig: m.timeSig, length: m.length, offset: m.offset, grouping: m.grouping }, d.hits); }
    m.hits = d.hits; m.beats.forEach((b, j) => { [b.cells, b.locked] = d.beats[j]; });
  });
}

/**
 * The sound drawn one position above (`dir` −1) or below (+1) the sound `sound` on the staff: `groups` are the lines / spaces of the sounds, from the top (`soundGroups`),
 * `pick(group)` the sound chosen for a group that holds several. The MIDI number plays no part: only where the sound is written. null at the top / bottom.
 */
export function neighbourSound(groups, sound, dir, pick) {
  const gi = groups.findIndex((g) => g.sounds.includes(baseSoundOf(sound)));
  const target = gi < 0 ? null : groups[gi + dir];
  return target ? pick(target) : null;
}

/** Replaces the hit `sound` at time `t` of a measure by `next` (nothing is doubled when `next` is already there). */
export function moveHit(state, mi, t, sound, next) {
  const m = state.measures[mi];
  m.hits = m.hits.filter((h) => !(fEq(h.t, t) && h.sound === sound));
  if (!m.hits.some((h) => fEq(h.t, t) && h.sound === next)) m.hits.push({ t, sound: next });
}
