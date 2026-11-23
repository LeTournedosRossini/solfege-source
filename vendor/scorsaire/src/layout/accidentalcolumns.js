/*
 * Placement of the accidentals of ONE chord in columns to the left of its noteheads — a port of MuseScore 4.7.5 `AccidentalsLayout` (rendering/score/accidentalslayout.cpp)
 * with the DEFAULT style (accidentalDistance 0.25 sp, no "order follows note displacement", no "keep seconds together", no octave alignment across sub-chords).
 * PURE: the caller gives the geometry (staff spaces, y DOWNWARDS from the top line, x from the origin of the chord).
 *
 * What it fixes: an accidental used to sit at the left of ITS OWN head, so in a cluster (D♯ and E♯ a second apart, the upper head pushed to the right of the stem) the
 * accidental of the upper note landed on the head of the lower one. Now every accidental clears every head it overlaps vertically, and accidentals that overlap each
 * other are stacked in columns (top one nearest, then the bottom one, alternating).
 * Simplifications: an accidental is its glyph's bounding box (MuseScore also uses the cut-outs of the sharp / flat to interlock them); the stem and the ledger lines are not
 * obstacles (the stem is at the edge of a head, the ledger-line room is part of the caller's `pad`); chords of several voices are laid out one chord at a time.
 */

const SMALL_GROUP = 3;
const LARGE_GROUP = 6;
const VERTICAL_ACC_TO_CHORD = 0.10;
const VERTICAL_ACC_TO_ACC = 0.15;
const VERTICAL_SHARP_TO_SHARP = 0.05;
const ADDITIONAL_PAD_VERTICALS = 0.1;
const X_SPLIT_THRESHOLD = 0.5;
const X_ALIGN_THRESHOLD = 0.75;
const FLAT_KERNING_OF_FOURTH = -0.15;
const NATURAL_KERNING_OF_FOURTH = -0.05;
const ACC_ACC_DISTANCE = 0.25;

const isFlat = (t) => t === 'flat' || t === 'doubleFlat';
const TYPES = { accidentalSharp: 'sharp', accidentalNatural: 'natural', accidentalFlat: 'flat', accidentalDoubleFlat: 'doubleFlat', accidentalDoubleSharp: 'doubleSharp' };
const intersects = (a1, a2, b1, b2, pad) => a2 + pad > b1 && a1 - pad < b2;

/**
 * @param o.notes   [{ id, glyph (accidental glyph name), y (staff spaces, down), x (head left, from the chord origin), pad (gap to a head, sp) }] — only the notes WITH an accidental
 * @param o.heads   [{ x1, x2, y }] every notehead of the chord (box left / right, centre y), `headHalf` its half height
 * @param o.box     (glyph) => { l, r, t, b } bounding box of the accidental glyph (SMuFL: right / top positive; t, b UP from the baseline)
 * @returns Map id → x of the ORIGIN of the accidental glyph, from the chord origin (draw the glyph there)
 */
export function stackAccidentals({ notes, heads, headHalf = 0.5, box }) {
  const out = new Map();
  if (!notes.length) return out;
  const accs = notes.map((n) => {
    const bb = box(n.glyph);
    return { id: n.id, type: TYPES[n.glyph] ?? 'sharp', line: Math.round(n.y * 2), y: n.y, noteX: n.x, pad: n.pad, l: bb.l, r: bb.r, top: n.y - bb.t, bottom: n.y - bb.b, width: bb.r - bb.l, column: 0, sub: 0, x: 0 };
  });
  const sortTopDown = (list) => list.sort((a, b) => (a.line === b.line ? b.noteX - a.noteX : a.line - b.line));
  sortTopDown(accs);
  // octaves (same sign, a whole number of octaves apart)
  for (const a of accs) a.octaves = accs.filter((o) => o !== a && o.type === a.type && Math.abs(o.line - a.line) % 7 === 0);

  const dropRedundant = []; // two identical accidentals on the same line (same note in two voices): the second one is not drawn
  const seen = new Set();
  const list = accs.filter((a) => { const k = `${a.type}|${a.line}`; if (seen.has(k)) { dropRedundant.push(a); return false; } seen.add(k); return true; });
  for (const a of dropRedundant) out.set(a.id, null);

  // distance of an accidental's box (origin at 0) to the chord: how far its origin must go to the left to clear every overlapping head
  const chordDistance = (a, top, bottom) => {
    let dist = -Infinity;
    for (const h of heads) {
      if (!intersects(top, bottom, h.y - headHalf, h.y + headHalf, VERTICAL_ACC_TO_CHORD)) continue;
      dist = Math.max(dist, a.r - h.x1 + a.pad);
    }
    return dist;
  };

  // sub-chords: split at a seventh, then merge small neighbours
  let subChords = [[list[0]]];
  for (let i = 1; i < list.length; i += 1) {
    if (list[i].line - list[i - 1].line >= 6) subChords.push([list[i]]); else subChords[subChords.length - 1].push(list[i]);
  }
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < subChords.length - 1; i += 1) {
      const small = subChords[i].length + subChords[i + 1].length <= SMALL_GROUP;
      const offsetNote = subChords[i + 1][0].noteX > 0.5;
      if (small && !offsetNote) { subChords[i].push(...subChords[i + 1]); subChords.splice(i + 1, 1); again = true; break; }
    }
  }

  const stacked = []; // placed accidentals: boxes in chord coordinates
  const verticalPad = (a, b) => (a.type === 'sharp' && b.type === 'sharp' ? VERTICAL_SHARP_TO_SHARP : VERTICAL_ACC_TO_ACC);
  const canFitInSameColumn = (a, b) => (a.type === 'natural' && b.type === 'natural' && Math.abs(a.line - b.line) === 5) || !intersects(a.top, a.bottom, b.top, b.bottom, verticalPad(a, b));
  const exceptionOfFourth = (a, b) => isFlat(a.type) && (isFlat(b.type) || b.type === 'natural') && a.line - b.line === 3;
  const naturalsSixth = (a, b) => a.type === 'natural' && b.type === 'natural' && Math.abs(b.line - a.line) === 5;

  const standardOrdering = (group) => {
    const toPlace = group.slice(); const placed = []; let fromTop = true;
    while (toPlace.length) {
      const a = fromTop ? toPlace.shift() : toPlace.pop();
      placed.push(a);
      let foundOctave = false;
      for (const o of a.octaves) {
        const i = toPlace.indexOf(o);
        if (i >= 0 && o.line > a.line) { toPlace.splice(i, 1); placed.push(o); foundOctave = true; }
      }
      fromTop = foundOctave ? true : !fromTop;
    }
    return placed;
  };
  const compactOrdering = (group) => {
    const bottom = group[group.length - 1]; const toPlace = group.slice(); const placed = []; let fromTop = true;
    while (toPlace.length) {
      let a = fromTop ? toPlace.shift() : toPlace.pop();
      placed.push(a);
      let fit = false; let hitBottom = a === bottom;
      for (const o of a.octaves) {
        const i = toPlace.indexOf(o);
        if (i >= 0 && ((fromTop && o.line > a.line) || (!fromTop && o.line < a.line))) { toPlace.splice(i, 1); placed.push(o); a = o; fit = true; if (o === bottom) hitBottom = true; }
      }
      const order = fromTop ? toPlace.slice() : toPlace.slice().reverse();
      for (const b of order) {
        if ((fromTop && b.line < a.line) || (!fromTop && b.line > a.line)) continue;
        if (canFitInSameColumn(a, b) && b.octaves.length === 0) { toPlace.splice(toPlace.indexOf(b), 1); placed.push(b); a = b; fit = true; if (b === bottom) hitBottom = true; }
      }
      fromTop = hitBottom || (fit && group.length <= LARGE_GROUP) ? true : !fromTop;
    }
    return placed;
  };
  const columnsOf = (ordered) => {
    const col = new Map([[ordered[0], 0]]); let max = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      const a = ordered[i]; col.set(a, max);
      for (let j = i - 1; j >= 0; j -= 1) {
        const b = ordered[j];
        if (col.get(b) < max) continue;
        if (!canFitInSameColumn(a, b)) { max += 1; col.set(a, max); }
      }
    }
    return max;
  };
  const stackingOrder = (group) => {
    if (group.length <= SMALL_GROUP) return standardOrdering(group);
    if (group.length > LARGE_GROUP) return compactOrdering(group);
    const std = standardOrdering(group); const compact = compactOrdering(group);
    return columnsOf(compact) < columnsOf(std) ? compact : std;
  };

  // gap of an accidental (at its current x) to the ones already placed: how much further left it must go
  const groupDistance = (a, x0) => {
    let dist = 0; let column = a.column;
    let box = { l: a.l - x0, r: a.r - x0, top: a.top, bottom: a.bottom };
    for (let iter = 0, collision = true; collision && iter < 50; iter += 1) {
      collision = false; let cur = 0;
      for (const g of stacked) {
        if (exceptionOfFourth(a, g)) {
          const k = box.r - g.box.l + (g.type === 'natural' ? NATURAL_KERNING_OF_FOURTH : FLAT_KERNING_OF_FOURTH);
          if (Math.abs(k) > 1e-9 && k > cur) { collision = true; cur = k; }
          column = Math.max(column, g.column + 1);
          continue;
        }
        const vp = verticalPad(a, g); const hp = ACC_ACC_DISTANCE; const hpT = 0.999 * hp;
        const hit = box.l < g.box.r + hpT && box.r > g.box.l - hpT && box.top < g.box.bottom + vp && box.bottom > g.box.top - vp;
        if (!hit) continue;
        collision = true;
        if (!naturalsSixth(a, g)) column = Math.max(column, g.column + 1);
        if (intersects(box.top, box.bottom, g.box.top, g.box.bottom, vp)) {
          let min = box.r - g.box.l + hp;
          if (a.type === 'natural' && (g.type === 'natural' || isFlat(g.type)) && g.line - a.line >= -2 && g.line - a.line <= 5) min += ADDITIONAL_PAD_VERTICALS;
          cur = Math.max(cur, min);
        }
      }
      box = { ...box, l: box.l - cur, r: box.r - cur };
      dist += cur;
    }
    a.column = column;
    return dist;
  };

  const stack = (a) => {
    const x = chordDistance(a, a.top, a.bottom);
    const originX = -x; // origin of the glyph, from the chord origin
    a.x = originX;
    a.box = { l: a.l + originX, r: a.r + originX, top: a.top, bottom: a.bottom };
    const d = groupDistance(a, x); // further left, past the accidentals already placed (the box sits at originX = -x)
    a.x = originX - d;
    a.box = { l: a.l + a.x, r: a.r + a.x, top: a.top, bottom: a.bottom };
    // a column that is placed to the left of an earlier one counts as a new column
    if (a.column === 0) for (const g of stacked) if (a.box.r < g.box.l) a.column = Math.max(a.column, g.column + 1);
    stacked.push(a);
  };

  for (const sub of subChords) {
    // priority groups: the accidentals that can sit close to the chord first, the ones pushed out by a displaced head after
    const keyed = new Map();
    for (const a of sub) {
      const x = Math.round((-chordDistance(a, a.top, a.bottom) + a.width) * 10) / 10;
      if (!keyed.has(x)) keyed.set(x, []);
      keyed.get(x).push(a);
    }
    const xs = [...keyed.keys()].sort((p, q) => p - q);
    let split = Infinity; let prev = xs[0];
    for (const x of xs) { if (x - prev > X_SPLIT_THRESHOLD) { split = x; break; } prev = x; }
    let groups = [[], []];
    for (const x of xs) for (const a of keyed.get(x)) { const g = x >= split ? 0 : 1; groups[g].push(a); a.sub = g; }
    groups = groups.filter((g) => g.length);
    if (groups.length > 1 && groups[0].length > 1) { // octaves of the second group stay with it
      for (const a of groups[0].slice()) if (a.octaves.some((o) => groups[1].includes(o))) { groups[0].splice(groups[0].indexOf(a), 1); groups[1].push(a); a.sub = 1; }
    }
    for (const g of groups) sortTopDown(g);
    for (const g of groups.filter((q) => q.length)) for (const a of stackingOrder(g)) stack(a);
  }

  // vertical alignment of the same accidentals (same column, same sub-group, nearly the same x): their right edges line up
  const grouped = new Set(); const sets = [];
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i]; if (grouped.has(a)) continue;
    let set = null;
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      if (b.type !== a.type || grouped.has(b)) continue;
      if (a.column === b.column && a.sub === b.sub && Math.abs(a.x - b.x) < X_ALIGN_THRESHOLD) { if (!set) set = [a]; set.push(b); grouped.add(a); grouped.add(b); }
    }
    if (set) sets.push(set);
  }
  sets.sort((p, q) => p[0].column - q[0].column);
  for (const set of sets) {
    const edge = Math.min(...set.map((a) => a.r + a.x));
    for (const a of set) a.x = edge - a.r;
    for (const a of list) a.box = { l: a.l + a.x, r: a.r + a.x, top: a.top, bottom: a.bottom };
  }

  for (const a of list) out.set(a.id, a.x);
  return out;
}
