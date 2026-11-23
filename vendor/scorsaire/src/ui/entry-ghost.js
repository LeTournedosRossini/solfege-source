/*
 * Ghost notes: a light preview of the notes typed while the real layout is deferred (burst of keyboard entry).
 * PURE (no DOM): `describeGhost` reads the model and an anchor given by the view, `ghostLayoutItems` builds display items
 * (heads, ledger lines, stems, flags, beams, dots, accidentals, fret numbers) in the staff space of a throw-away layout that
 * `renderSvgString` can draw. Approximate on purpose: positions come from the STALE layout, nothing is justified or kerned.
 */
import {
  PID, SID, getProperty, fAdd, fEq, fCmp, measureLengthOf, measureOffsetOf, itemDuration, staffSoundMap, tuningPitches, tuningPitchesAt,
  trackTransposition, intervalIsZero, writtenKey, writtenSpelling,
} from '../model/index.js';
import { clefTimeline, clefAt } from '../layout/clefchanges.js';
import { noteY, spellingOf } from '../layout/pitchpos.js';
import { keySigAlters } from '../layout/accidentals.js';
import { headGlyph } from '../layout/chordgeom.js';
import { drumHeadGlyph } from '../model/drumheads.js';
import { staffLineCount } from '../layout/painters/common.js';

export const GHOST_INK = 'rgba(40,120,255,0.85)';
const HEAD_W = 1.18;
const STEM_W = 0.12;
const STEM_LEN = 3.5;
const BEAM_THICK = 0.5;
const BEAM_GAP = 0.75;
const BEAM_COUNT = { eighth: 1, sixteenth: 2, thirtysecond: 3, sixtyfourth: 4 };
const TAB_DIST = 1.5;
const ACCIDENTAL = { '-1': 'accidentalFlat', 0: 'accidentalNatural', 1: 'accidentalSharp' };

/** Cursor-like place { staffId, voice, measureIndex, position } of a chord, or null when it is not in a staff. */
function placeOf(doc, chord) {
  const measure = doc.parentOf(chord.id);
  const voiceEl = measure && doc.parentOf(measure.id);
  const staff = voiceEl && doc.parentOf(voiceEl.id);
  if (!staff || staff.type !== 'staff') return null;
  const voice = staff.voices.indexOf(voiceEl);
  const measureIndex = voiceEl.measures.indexOf(measure);
  const movement = doc.movementOf(staff);
  const mb = movement?.masterbars[measureIndex];
  if (voice < 0 || measureIndex < 0 || !mb) return null;
  const length = measureLengthOf(mb);
  let position = [0, 1];
  for (const item of measure.items) {
    if (item === chord) return { staff, movement, mb, voice, measureIndex, position, end: fAdd(position, itemDuration(chord, length)) };
    position = fAdd(position, itemDuration(item, length));
  }
  return null;
}

/** The rests of a voice in a measure, with their span: [{ id, start, end }] (taken BEFORE a note replaces some of them, to hide them while the ghost is shown). */
export function restIntervals(doc, staffId, voice, measureIndex) {
  const staff = doc.find(staffId);
  const measure = staff?.voices?.[voice]?.measures?.[measureIndex];
  const movement = staff ? doc.movementOf(staff) : null;
  const mb = movement?.masterbars[measureIndex];
  if (!measure || !mb) return [];
  const length = measureLengthOf(mb);
  const out = [];
  let position = [0, 1];
  for (const item of measure.items) {
    const end = fAdd(position, itemDuration(item, length));
    if (item.type === 'rest') out.push({ id: item.id, start: position, end });
    position = end;
  }
  return out;
}

/**
 * Ghost of the chord `chordId` (a chord of a score, tablature or percussion staff), or null.
 * @param anchorOf  (cursor) → { x, bottom, lines, tab, systemIndex } in staff spaces from the stale layout, or null
 */
export function describeGhost(doc, chordId, anchorOf) {
  const chord = doc.find(chordId);
  if (!chord || chord.type !== 'chord') return null;
  const place = placeOf(doc, chord);
  if (!place) return null;
  const { staff, movement, mb, measureIndex, voice, position } = place;
  const type = getProperty(staff, PID.STAFF_TYPE);
  if (type !== 'score' && type !== 'tab' && type !== 'percussion') return null;
  const anchor = anchorOf({ staffId: staff.id, measureIndex, position, voice });
  if (!anchor) return null;
  const duration = getProperty(chord, PID.DURATION);
  const base = duration.base;
  const dots = duration.dots ?? 0;
  const nominal = fAdd(position, measureOffsetOf(mb, measureIndex === 0));
  const heads = [];
  let stemUpGiven = null; // percussion: the direction is decided by the voice / the sound, not by the position of the heads
  let lines = anchor.lines;
  if (type === 'score') {
    const concertPitch = Boolean(doc.getStyle(movement, SID.CONCERT_PITCH));
    const clefKey = clefAt(clefTimeline(staff, movement, concertPitch), measureIndex, nominal);
    // an instrument that transposes (the guitar sounds an octave lower than it is written) is drawn at its WRITTEN pitch, like the layout does
    const track = doc.parentOf(staff.id);
    const iv = !concertPitch && track ? trackTransposition(track) : null;
    const transposes = Boolean(iv) && !intervalIsZero(iv);
    const prefer = track ? getProperty(track, PID.PREFER_SHARP_FLAT) : undefined;
    const concertKey = getProperty(mb, PID.KEY_SIG) ?? 0;
    const key = transposes ? writtenKey(concertKey, iv, prefer) : concertKey;
    const keyAlters = keySigAlters(key);
    lines = staffLineCount(staff);
    for (const note of chord.notes) {
      const pitchOf = getProperty(note, PID.PITCH);
      const concert = spellingOf(pitchOf, getProperty(note, PID.SPELLING), concertKey);
      const spelling = transposes ? writtenSpelling(pitchOf, concert, iv, concertKey, prefer) : concert;
      const y = noteY(spelling, clefKey);
      const alter = spelling.alter ?? 0;
      heads.push({ y, accidental: alter !== (keyAlters[spelling.step] ?? 0) ? ACCIDENTAL[Math.max(-1, Math.min(1, alter))] : null });
    }
  } else if (type === 'tab') {
    const open = tuningPitchesAt(movement, staff, [measureIndex, nominal]);
    for (const note of chord.notes) {
      const string = getProperty(note, PID.STRING);
      heads.push({ y: (open.length - string) * TAB_DIST, text: String(getProperty(note, PID.PITCH) - open[string - 1]) });
    }
  } else {
    const sounds = staffSoundMap(getProperty(staff, PID.PERCMAP)).sounds;
    for (const note of chord.notes) {
      const sound = sounds.find((s) => s.id === getProperty(note, PID.SOUND));
      // the head of the sound in the map (a cross for a cymbal…), as the staff will draw it
      if (sound) heads.push({ y: (lines - 1) - sound.line / 2, glyph: drumHeadGlyph(sound.head, base) });
    }
    // stem direction as the percussion layout decides it: the one forced on the chord, else the one of the sound of its first note, else the parity of the voice (voice 1 up, voice 2 down)
    const forced = getProperty(chord, PID.STEM_DIRECTION);
    const first = sounds.find((s) => s.id === getProperty(chord.notes[0], PID.SOUND));
    const dir = forced === 'up' || forced === 'down' ? forced : first?.stemDirection === 'up' || first?.stemDirection === 'down' ? first.stemDirection : (voice % 2 === 0 ? 'up' : 'down');
    stemUpGiven = dir === 'up';
  }
  if (!heads.length) return null;
  return { id: chord.id, staffId: staff.id, voice, measureIndex, start: position, end: place.end, type, base, dots, lines, anchor, heads, ...(stemUpGiven !== null ? { stemUp: stemUpGiven } : {}) };
}

/** Stem direction by the farthest head from the middle line (down when equal). */
function stemUp(g) {
  const middle = (g.lines - 1) / 2;
  const far = g.heads.reduce((m, h) => (Math.abs(h.y - middle) > Math.abs(m - middle) ? h.y : m), g.heads[0].y);
  return far < middle;
}

/** Groups of ghosts to beam: consecutive in time, same staff / voice / measure, eighth or shorter, no tablature. */
function beamGroups(ghosts) {
  const sorted = [...ghosts].filter((g) => g.type !== 'tab' && BEAM_COUNT[g.base]).sort((a, b) => a.staffId.localeCompare(b.staffId) || a.voice - b.voice || a.measureIndex - b.measureIndex || fCmp(a.start, b.start));
  const groups = [];
  for (const g of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.staffId === g.staffId && prev.voice === g.voice && prev.measureIndex === g.measureIndex && fEq(prev.end, g.start)) last.push(g);
    else groups.push([g]);
  }
  return groups.filter((grp) => grp.length > 1);
}

/**
 * Display items of all ghosts, grouped by staff: [{ key, bottom, items }] where `items` are in staff spaces, y up from the bottom line,
 * x in spaces from the left of the SVG. `bottom` is the y (spaces, down) of the bottom line.
 */
export function ghostLayoutItems(ghosts) {
  const byStaff = new Map();
  const itemsOf = (g) => {
    const key = `${g.staffId}|${g.anchor.systemIndex}`;
    if (!byStaff.has(key)) byStaff.set(key, { key, bottom: g.anchor.bottom, items: [] });
    return byStaff.get(key).items;
  };
  const geom = new Map();
  for (const g of ghosts) {
    const items = itemsOf(g);
    const x = g.anchor.x;
    const up = g.type === 'tab' ? false : (g.stemUp ?? stemUp(g));
    const ys = g.heads.map((h) => h.y);
    const top = Math.max(...ys); const low = Math.min(...ys);
    for (const h of g.heads) {
      if (g.type === 'tab') {
        items.push({ kind: 'text', x: x + HEAD_W / 2, y: h.y, text: h.text, size: 1.1, anchor: 'middle', central: true, bold: true, family: 'sans-serif' });
        continue;
      }
      items.push({ kind: 'glyph', name: h.glyph ?? headGlyph(g.base), x, y: h.y });
      if (h.accidental) items.push({ kind: 'glyph', name: h.accidental, x: x - 1.1, y: h.y });
      if (g.dots) for (let d = 0; d < g.dots; d++) items.push({ kind: 'circle', cx: x + HEAD_W + 0.5 + d * 0.65, cy: Number.isInteger(h.y) ? h.y + 0.5 : h.y, r: 0.2, fill: 'ink' });
    }
    if (g.type === 'tab') continue;
    // ledger lines beyond the staff
    const ledgers = [];
    for (let l = -1; l >= Math.floor(low); l--) ledgers.push(l);
    for (let l = g.lines; l <= Math.ceil(top); l++) ledgers.push(l);
    for (const l of ledgers) if ((l < 0 && low <= l) || (l > g.lines - 1 && top >= l)) items.push({ kind: 'line', x1: x - 0.33, y1: l, x2: x + HEAD_W + 0.33, y2: l, width: 0.16, cap: 'butt' });
    const needStem = g.base !== 'whole' && g.base !== 'breve';
    const sx = up ? x + HEAD_W - STEM_W / 2 : x + STEM_W / 2;
    const y1 = up ? low : top;
    geom.set(g.id, { g, up, sx, y1, tip: up ? top + STEM_LEN : low - STEM_LEN, needStem });
  }
  const beamed = new Set();
  for (const grp of beamGroups(ghosts)) {
    const infos = grp.map((g) => geom.get(g.id)).filter(Boolean);
    if (infos.length < 2) continue;
    // one direction for the whole group: the farthest head of all of them
    const middle = (infos[0].g.lines - 1) / 2;
    const all = infos.flatMap((i) => i.g.heads.map((h) => h.y));
    const far = all.reduce((m, y) => (Math.abs(y - middle) > Math.abs(m - middle) ? y : m), all[0]);
    const up = infos[0].g.stemUp ?? (far < middle);
    const sx = (i) => (up ? i.g.anchor.x + HEAD_W - STEM_W / 2 : i.g.anchor.x + STEM_W / 2);
    const beamY = up ? Math.max(...infos.map((i) => Math.max(...i.g.heads.map((h) => h.y)) + STEM_LEN)) : Math.min(...infos.map((i) => Math.min(...i.g.heads.map((h) => h.y)) - STEM_LEN));
    const items = itemsOf(infos[0].g);
    for (const i of infos) {
      const y1 = up ? Math.min(...i.g.heads.map((h) => h.y)) : Math.max(...i.g.heads.map((h) => h.y));
      items.push({ kind: 'line', x1: sx(i), y1, x2: sx(i), y2: beamY, width: STEM_W, cap: 'butt' });
      beamed.add(i.g.id);
    }
    const maxLevel = Math.max(...infos.map((i) => BEAM_COUNT[i.g.base]));
    for (let level = 1; level <= maxLevel; level++) {
      const dy = (up ? -1 : 1) * (level - 1) * BEAM_GAP;
      const yc = beamY + dy + (up ? -BEAM_THICK / 2 : BEAM_THICK / 2);
      let run = [];
      const flush = () => {
        if (!run.length) return;
        let a = sx(run[0]); let b = sx(run[run.length - 1]);
        if (run.length === 1) { const idx = infos.indexOf(run[0]); if (idx > 0) a -= 1.1; else b += 1.1; } // a lone short beam: a stub towards a neighbour
        items.push({ kind: 'rect', x: a - STEM_W / 2, y: yc - BEAM_THICK / 2, w: b - a + STEM_W, h: BEAM_THICK, fill: 'ink' });
        run = [];
      };
      for (const i of infos) { if (BEAM_COUNT[i.g.base] >= level) run.push(i); else flush(); }
      flush();
    }
  }
  // lone stems (with a flag for eighths and shorter)
  for (const [id, i] of geom) {
    if (beamed.has(id) || !i.needStem) continue;
    const items = itemsOf(i.g);
    items.push({ kind: 'line', x1: i.sx, y1: i.y1, x2: i.sx, y2: i.tip, width: STEM_W, cap: 'butt' });
    if (BEAM_COUNT[i.g.base] && i.g.base === 'eighth') items.push({ kind: 'glyph', name: i.up ? 'flag8thUp' : 'flag8thDown', x: i.sx - STEM_W / 2, y: i.tip });
    else if (BEAM_COUNT[i.g.base]) items.push({ kind: 'glyph', name: i.up ? 'flag16thUp' : 'flag8thDown', x: i.sx - STEM_W / 2, y: i.tip });
  }
  return [...byStaff.values()];
}

/** A throw-away layout for `renderSvgString` (margin 0, staffSpace = ss): the groups of `ghostLayoutItems` as staves of one system. */
export function ghostLayout(groups, width, height, ss) {
  return {
    width: width / ss, height: height / ss,
    systems: [{ index: 0, x0: 0, top: 0, overlays: [], measures: [], staves: groups.map((g) => ({ ref: g.key, type: 'ghost', originY: g.bottom, items: g.items })) }],
  };
}
