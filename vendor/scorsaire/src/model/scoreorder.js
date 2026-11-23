/*
 * Automatic grouping of tracks by score order — port of `ScoreOrder::setBracketsAndBarlines` (MuseScore 4.7.5, `scoreorder.cpp`, read in full)
 * with the orders of `share/instruments/orders.xml` (extracted by `tools/extract-score-orders.py` into `score-orders.json`).
 *
 * For each track with a catalogue instrument (`PID.INSTRUMENT_ID`; tracks without one are skipped exactly like parts MuseScore cannot
 * find in its templates) the order's section decides the thick bracket (consecutive tracks of one section, only when the section has
 * brackets and at least two staves), and the thin bracket goes around consecutive tracks of the SAME instrument (only single-staff
 * instruments). Bar lines continue through a section unless the section says `barLineSpan="false"` (voices): stored as
 * `GROUP_BARLINES` on the thick group.
 *
 * ÉCART (to judge by eye): MuseScore puts the thick bracket in column 0 (nearest the staves) and the thin one in column 1; here the
 * nesting depth is the column, so a thin bracket inside a thick one sits NEARER the staves. Two groups of the same range keep the
 * MuseScore order (thick inside, thin outside). Instrument ordering of MuseScore (`instrumentSortingIndex`) is not applied.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { instrumentInfo, INSTRUMENT_COUNT, translatedOrderName } from './instruments.js';
import { groupTracks, clearGroups, EditError } from './groupedit.js';
import data from './score-orders.json' with { type: 'json' };

const UNSORTED = '<unsorted>';

/** Orders offered to the user ('custom' = by hand is not an order). */
export const SCORE_ORDERS = Object.freeze(Object.entries(data.orders).map(([id, o]) => ({ id, name: o.name })));
export const hasScoreOrder = (id) => Object.hasOwn(data.orders, id);

/** Display name of a score order in `lang` (MuseScore's own translation, English otherwise). */
export function scoreOrderName(id, lang = 'en') {
  const o = data.orders[id];
  return o ? translatedOrderName(o.name, lang) : id;
}

/**
 * `ScoreOrder::instrumentSortingIndex` (soloists not modelled): position of an instrument in the order — the index of the order's group that
 * claims it (its family, else its instrument group, else "everything else") × the number of catalogue instruments + its catalogue rank.
 * 0 for an instrument the catalogue does not know.
 */
export function instrumentSortIndex(orderId, instrumentId) {
  const order = data.orders[orderId];
  const info = instrumentInfo(instrumentId);
  if (!order || !info) return 0;
  const family = order.instruments[instrumentId] ?? info.family;
  let index = order.groups.length;
  let priority = 0; // 0 undefined, 1 unsorted, 2 unsorted group, 3 family
  order.groups.forEach((g, i) => {
    if (priority < 3 && g.family === family) { index = i; priority = 3; }
    else if (priority < 2 && g.family === UNSORTED && g.unsorted === info.group) { index = i; priority = 2; }
    else if (priority < 1 && g.family === UNSORTED && !g.unsorted) { index = i; priority = 1; }
  });
  return index * INSTRUMENT_COUNT + (info.seq ?? 0);
}

const sortKey = (orderId, track) => {
  const id = getProperty(track, PID.INSTRUMENT_ID);
  return instrumentInfo(id) ? instrumentSortIndex(orderId, id) : null;
};

/**
 * Is the list of tracks in the order of the score order? Only tracks with a catalogue instrument count (a track without one has no place
 * in the order: MuseScore would give it index 0 and push it to the top, which would shuffle hand-made tracks).
 */
export function tracksFollowOrder(tracks, orderId) {
  let prev = -1;
  for (const t of tracks) {
    const k = sortKey(orderId, t);
    if (k === null) continue;
    if (k < prev) return false;
    prev = k;
  }
  return true;
}

/**
 * Sorts the tracks of the movement by the order (stable). Tracks without a catalogue instrument keep their place; the others fill the
 * remaining places in sorted order. CALL INSIDE A TRANSACTION, with the groups already cleared (they refer to track positions).
 */
export function sortTracksByOrder(doc, mv, orderId) {
  const known = mv.tracks.map((t, i) => ({ t, i, k: sortKey(orderId, t) })).filter((x) => x.k !== null);
  const sorted = [...known].sort((a, b) => a.k - b.k || a.i - b.i);
  const target = [...mv.tracks];
  known.forEach((slot, n) => { target[slot.i] = sorted[n].t; });
  target.forEach((track, i) => {
    if (mv.tracks[i] === track) return;
    doc.remove(track);
    doc.add(mv, 'tracks', track, i);
  });
}

/** `ScoreOrder::getGroup`. */
function groupFor(order, family, instrumentGroup) {
  let unsorted = order.groups.find((g) => g.family === UNSORTED && !g.unsorted) ?? null;
  if (!family) return unsorted;
  for (const g of order.groups) {
    if (g.family === family) return g;
    if (g.family === UNSORTED && g.unsorted === instrumentGroup) unsorted = g;
  }
  return unsorted;
}

/**
 * The brackets MuseScore would create: [{ style: 'normal' | 'square', from, to (track indices), barlines }]. Pure; reads the tracks only.
 */
export function planScoreOrder(mv, orderId) {
  const order = data.orders[orderId];
  if (!order) throw new EditError(`Unknown score order: ${orderId}`);
  const out = [];
  let prevSection = '';
  let prevInstrument = null;
  let prevThin = false;
  let thk = null; // { from, to, span, barlines }
  let thn = null;
  const flushThick = () => { if (thk && thk.span > 1) out.push({ style: 'normal', from: thk.from, to: thk.to, barlines: thk.barlines }); };
  const flushThin = () => { if (thn && thn.span > 1) out.push({ style: 'square', from: thn.from, to: thn.to, barlines: true }); };

  mv.tracks.forEach((track, ti) => {
    const id = getProperty(track, PID.INSTRUMENT_ID);
    const info = instrumentInfo(id);
    if (!info) return;
    const family = order.instruments[id] ?? info.family ?? UNSORTED;
    const sg = groupFor(order, family, info.group);
    if (!sg) return;
    const nstaves = track.staves.length;
    let staffIdx = 0;
    let blockThin = false;
    for (let s = 0; s < nstaves; s += 1) {
      if ((!prevSection || sg.section !== prevSection) && mv.tracks.length > 1) {
        flushThick();
        if (!staffIdx) thk = sg.bracket ? { from: ti, to: ti, span: 0, barlines: sg.barLineSpan } : null;
      }
      if (sg.bracket && !staffIdx && thk) { thk.span += nstaves; thk.to = ti; }

      if (prevInstrument === null || id !== prevInstrument) {
        flushThin();
        if (id !== prevInstrument) thn = sg.thinBracket && !blockThin ? { from: ti, to: ti, span: 0 } : null;
      }
      if (info.staves > 1) {
        blockThin = true;
        if (staffIdx < info.staves) staffIdx += 1;
      } else {
        if (sg.thinBracket && !staffIdx && thn) { thn.span += nstaves; thn.to = ti; }
        staffIdx += 1;
      }
      prevSection = sg.section;
      prevThin = sg.thinBracket;
    }
    prevInstrument = id;
  });
  flushThick();
  if (thn && thn.span > 1 && prevThin) out.push({ style: 'square', from: thn.from, to: thn.to, barlines: true });
  return out;
}

/**
 * Replaces the groups of the movement by the ones of the order and remembers the order (the groups then follow the tracks).
 * CALL INSIDE A TRANSACTION.
 */
export function applyScoreOrder(doc, mv, orderId, { sort = false } = {}) {
  clearGroups(doc, mv);
  if (sort) sortTracksByOrder(doc, mv, orderId);
  const plan = planScoreOrder(mv, orderId);
  // thick brackets first, so a thin bracket of the same range wraps it (MuseScore: thick nearest the staves)
  for (const spec of [...plan.filter((p) => p.style === 'normal'), ...plan.filter((p) => p.style === 'square')]) {
    try {
      groupTracks(doc, mv, mv.tracks.slice(spec.from, spec.to + 1).map((t) => t.id), { style: spec.style, barlines: spec.barlines, auto: true });
    } catch (e) {
      if (!(e instanceof EditError)) throw e; // a range that cannot nest (tracks without instrument between) is skipped
    }
  }
  doc.set(mv, PID.GROUP_ORDER, orderId);
  return plan;
}

/** Re-applies the movement's automatic order after a change of tracks (no-op for 'custom'). CALL INSIDE A TRANSACTION. */
export function refreshAutoGroups(doc, mv, { sort = false } = {}) {
  const id = getProperty(mv, PID.GROUP_ORDER);
  if (id && id !== 'custom' && hasScoreOrder(id)) applyScoreOrder(doc, mv, id, { sort });
}
