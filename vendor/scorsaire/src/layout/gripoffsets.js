/*
 * User grips of slurs, ties, hammer-ons/pull-offs and hairpins (see model/grips.js), applied to the display items AFTER the automatic
 * placement and BEFORE the manual displacement and the vertical spacing. MuseScore keeps one set of offsets per segment (per system the
 * spanner crosses); the segment of an item here = the ordinal of its system among the systems where the entry has items.
 *
 * Items are in staff coordinates (x right, y UP); model offsets are y DOWN, hence the sign flip.
 *  - `curve` (slur, tie, hopo): the end points and the two control points move; the filled contour is rebuilt around the new spine with
 *    the item's own thickness (the thickness is NOT recomputed from the new length: MuseScore keeps the shape, we keep the pen).
 *  - hairpin (two `line` items per segment): `start` / `end` move that end of both branches; `aperture` replaces the full opening at the
 *    ends that are fully open (not a closed tip, not the half-height of a continuation).
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { gripOffset, gripAperture, hasGrips } from '../model/grips.js';
import { HAIRPIN_HEIGHT } from './hairpins.js';

const LIST_PIDS = [PID.SLURS, PID.TIES, PID.HOPOS, PID.HAIRPINS];

/** Map(entry id → entry) of the entries of the movement that carry grips. */
export function entriesWithGrips(movement) {
  const out = new Map();
  for (const track of movement.tracks ?? []) {
    for (const staff of track.staves ?? []) {
      for (const pid of LIST_PIDS) {
        for (const e of getProperty(staff, pid) ?? []) if (e?.id && hasGrips(e)) out.set(e.id, e);
      }
    }
  }
  return out;
}

/** Curve with moved end points and control points; contour rebuilt perpendicular to the new chord. */
export function moveCurve(it, offs) {
  const f = (k) => [offs[k]?.[0] ?? 0, -(offs[k]?.[1] ?? 0)];
  const [sx, sy] = f('start');
  const [ex, ey] = f('end');
  const [c1x, c1y] = f('c1');
  const [c2x, c2y] = f('c2');
  const x1 = it.x1 + sx; const y1 = it.y1 + sy;
  const x2 = it.x2 + ex; const y2 = it.y2 + ey;
  const nc1x = it.c1x + c1x; const nc1y = it.c1y + c1y;
  const nc2x = it.c2x + c2x; const nc2y = it.c2y + c2y;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const sin = Math.sin(angle); const cos = Math.cos(angle);
  const t = it.thickness ?? 0;
  // local-frame offset (ly = −t) → global: (+t·sin, −t·cos); (ly = +t) → (−t·sin, +t·cos)
  return {
    ...it, x1, y1, x2, y2, c1x: nc1x, c1y: nc1y, c2x: nc2x, c2y: nc2y,
    topC1x: nc1x + t * sin, topC1y: nc1y - t * cos, topC2x: nc2x + t * sin, topC2y: nc2y - t * cos,
    botC1x: nc1x - t * sin, botC1y: nc1y + t * cos, botC2x: nc2x - t * sin, botC2y: nc2y + t * cos,
  };
}

/** The two branches of a hairpin with grips applied. `lines` = [upper branch, lower branch] (as produced by `hairpinWedgeLines`). */
export function moveHairpin(lines, offs, aperture) {
  let [a, b] = lines.map((l) => ({ ...l }));
  if (aperture !== null) {
    const h1 = HAIRPIN_HEIGHT / 2;
    for (const end of ['1', '2']) {
      const ya = a[`y${end}`]; const yb = b[`y${end}`];
      const half = (ya - yb) / 2;
      if (Math.abs(half - h1) > 1e-6) continue; // a closed tip or a continuation height: left alone
      const mid = (ya + yb) / 2;
      a[`y${end}`] = mid + aperture / 2;
      b[`y${end}`] = mid - aperture / 2;
    }
  }
  // a hairpin stays level: only the horizontal part of the start / end offsets applies (vertical moves = the whole-mark move)
  const sx = offs.start?.[0] ?? 0;
  const ex = offs.end?.[0] ?? 0;
  for (const l of [a, b]) { l.x1 += sx; l.x2 += ex; }
  return [a, b];
}

/**
 * Applies the grips to the staves of every system (mutates `systems[k].staves[si].items` with copies). `systems` = layout output.
 */
export function applyGrips(systems, movement) {
  const entries = entriesWithGrips(movement);
  if (!entries.size) return;
  const segmentCount = new Map(); // id → number of systems already met
  for (const sys of systems) {
    const segOf = new Map(); // id → segment ordinal in THIS system
    for (const st of sys.staves) {
      for (const it of st.items) {
        if (!it.ref || !entries.has(it.ref) || segOf.has(it.ref)) continue;
        const n = segmentCount.get(it.ref) ?? 0;
        segOf.set(it.ref, n);
        segmentCount.set(it.ref, n + 1);
      }
    }
    for (const st of sys.staves) {
      const hair = new Map(); // id → indices of its hairpin lines in this staff
      st.items.forEach((it, i) => {
        if (!it.ref || !segOf.has(it.ref)) return;
        if (it.kind === 'line' && it.role === 'hairpin') {
          if (!hair.has(it.ref)) hair.set(it.ref, []);
          hair.get(it.ref).push(i);
        }
      });
      let items = st.items;
      let copied = false;
      const own = () => { if (!copied) { items = items.slice(); copied = true; } };
      items.forEach((it, i) => {
        if (it.kind !== 'curve' || !segOf.has(it.ref)) return;
        const entry = entries.get(it.ref);
        const seg = String(segOf.get(it.ref));
        const offs = entry.grips?.segments?.[seg];
        if (!offs) return;
        own();
        items[i] = moveCurve(it, offs);
      });
      for (const [id, idx] of hair) {
        if (idx.length < 2) continue;
        const entry = entries.get(id);
        const offs = entry.grips?.segments?.[String(segOf.get(id))] ?? {};
        const [a, b] = moveHairpin([st.items[idx[0]], st.items[idx[1]]], offs, gripAperture(entry));
        own();
        items[idx[0]] = a; items[idx[1]] = b;
      }
      st.items = items;
    }
  }
}

export { gripOffset };
