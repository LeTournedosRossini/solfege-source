/*
 * The diagram a chord symbol of the chord staff carries (`PID.DIAGRAM_SHOWN`): drawn ABOVE the symbol, left edge at the symbol's x, no title (the symbol is the
 * title). Diagrams of one system share one bottom line (just above whatever the staff already holds under them) and are pushed right when two would overlap.
 * The fingering is resolved like every diagram: the symbol's own voicing, else the work's preferred one, else the n-th suggestion (`model/fretdiagram.js`).
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';
import { resolveDiagram, diagramChordOf, chordDiagramVoicing, chordPathFor, playedFor, chordSymbolsInSpan, tuningOfInstrument, strumInstrumentOf, diagramLook, tabDiagramMin, tabChordVoicing, fingeringKey } from '../model/fretdiagram.js';
import { rectsOf } from './bounds.js';
import { translateItem } from './offsets.js';
import { drawDiagram } from './diagramcontainer.js';
import { chordSpecFromSymbol } from '../model/fretsuggest.js';
import { chordKey } from '../model/fretdiagram.js';
import { variantId } from '../model/voicingpools.js';

const GAP = 0.4; // between two diagrams

/**
 * The symbols of a CHORD staff that draw their diagram by themselves (`PID.CHORD_DIAGRAMS`), over the whole movement: 'all' = every symbol, 'voicing' = a chord the first time and
 * again only when its fingering (the one the diagram would show: own, played in the tablature it reads, path, preferred…) differs from the last one drawn for that chord.
 * Returns a Set of symbol ids ('off' or a staff that is not the first chord staff: empty).
 */
export function autoChordSymbols(ctx, staff, mode) {
  const out = new Set();
  const mv = ctx.movement;
  if (!mv || mode === 'off' || !mv.masterbars.length) return out;
  const first = mv.tracks.flatMap((t) => t.staves).find((s) => getProperty(s, PID.STAFF_TYPE) === 'chord');
  if (first !== staff) return out; // the symbols read by the diagrams are those of the first chord staff
  const last = new Map(); // chord key → the fingering last drawn for it
  const paths = new Map();
  const pathOf = (instrument) => { if (!paths.has(instrument)) paths.set(instrument, chordPathFor(mv, instrument, { preferred: ctx.preferredVoicings, dict: ctx.chordQualities })); return paths.get(instrument); };
  for (const e of chordSymbolsInSpan(mv, mv.masterbars[0].id, mv.masterbars.length)) {
    if (mode === 'all') { out.add(e.sym.id); continue; }
    const instrument = getProperty(e.sym, PID.DIAGRAM_INSTRUMENT);
    const spec = chordSpecFromSymbol(e.chord, ctx.chordQualities);
    const res = spec ? resolveDiagram({
      voicing: getProperty(e.sym, PID.VOICING), chord: e.chord, instrument, index: getProperty(e.sym, PID.DIAGRAM_SUGGESTION), preferred: ctx.preferredVoicings, dict: ctx.chordQualities,
      pathVoicing: pathOf(instrument).get(e.sym.id) ?? null, played: playedFor(mv, staff, e.sym, e.mi),
    }) : null;
    if (!res?.voicing) continue;
    const key = chordKey(spec, instrument ?? 'guitar', res.voicing.tuning ?? []) + (res.voicing.frets ? '' : '|p');
    const print = variantId(res.voicing);
    if (last.get(key) !== print) { out.add(e.sym.id); last.set(key, print); }
  }
  return out;
}

/** The symbols of a chord staff in the measures of `sys` that are in `ids` (the ones that draw their diagram by themselves). */
function symbolsIn(staff, sys, ids) {
  const measures = new Set(sys.measures.map((m) => m.mi));
  const out = [];
  for (const voice of staff.voices) voice.measures.forEach((m, mi) => {
    if (!measures.has(mi)) return;
    for (const it of m?.items ?? []) if (it.type === 'chordsymbol' && ids.has(it.id)) out.push({ symbol: it, mi, position: getProperty(it, PID.POSITION) ?? [0, 1] });
  });
  return out;
}

/** Two lists of { symbol, mi, position } merged (a symbol once), in playing order. */
function mergeSymbols(a, b) {
  if (!b.length) return a;
  const seen = new Set(a.map((e) => e.symbol.id));
  return [...a, ...b.filter((e) => !seen.has(e.symbol.id))].sort((x, y) => x.mi - y.mi || x.position[0] / x.position[1] - y.position[0] / y.position[1]);
}

/** The chord symbols that show a diagram in the measures of `sys`: [{ symbol, mi, position }] in playing order. */
export function shownSymbols(staff, sys) {
  const measures = new Set(sys.measures.map((m) => m.mi));
  const out = [];
  for (const voice of staff.voices) {
    voice.measures.forEach((m, mi) => {
      if (!measures.has(mi)) return;
      for (const it of m?.items ?? []) {
        if (it.type === 'chordsymbol' && getProperty(it, PID.DIAGRAM_SHOWN) && (getProperty(it, PID.CHORD_SPECIAL) ?? 'none') === 'none') out.push({ symbol: it, mi, position: getProperty(it, PID.POSITION) ?? [0, 1] });
      }
    });
  }
  return out.sort((a, b) => a.mi - b.mi || a.position[0] / a.position[1] - b.position[0] / b.position[1]);
}

/** The chords of notes (notation / tablature staves) that show a diagram in the measures of `sys`: [{ symbol: the chord, mi, position }] — `entries` = the painter entries of the staff, per measure. */
export function shownChords(entries, sys) {
  const out = [];
  for (const m of sys.measures) {
    for (const e of entries?.[m.mi] ?? []) {
      if (e.item?.type === 'chord' && getProperty(e.item, PID.DIAGRAM_SHOWN)) out.push({ symbol: e.item, mi: m.mi, position: e.position ?? [0, 1] });
    }
  }
  return out.sort((a, b) => a.mi - b.mi || a.position[0] / a.position[1] - b.position[0] / b.position[1]);
}

/**
 * The chords of a TABLATURE staff that show a diagram in the measures of `sys` (`PID.TAB_DIAGRAMS`): the ones the user turned on by hand, plus — 'all' — every chord of at least
 * `tabDiagramMin` strings, or — 'changes' — those whose fingering differs from the previous chord's (the first of each system always shows, so a reader never starts blind).
 * A chord the user removed (`PID.DIAGRAM_HIDDEN`) never shows. `entries` = the painter entries of the staff, per measure.
 */
export function tabAutoChords(staff, entries, sys) {
  const mode = getProperty(staff, PID.TAB_DIAGRAMS) ?? 'off';
  if (mode === 'off' || !sys.measures.length) return shownChords(entries, sys);
  const min = tabDiagramMin(staff);
  let previous = null; // the fingering of the last chord written before this system
  for (let mi = sys.measures[0].mi - 1; mi >= 0 && previous === null; mi--) {
    const items = staff.voices[0]?.measures[mi]?.items ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type !== 'chord' || getProperty(items[i], PID.DIAGRAM_HIDDEN)) continue;
      const v = tabChordVoicing(staff, items[i], min);
      if (v) { previous = fingeringKey(v); break; }
    }
  }
  const out = [];
  let first = true;
  const seen = new Set(); // 'first': fingerings met before this system (and in it)
  if (mode === 'first') {
    for (let mi = 0; mi < sys.measures[0].mi; mi++) {
      for (const it of staff.voices[0]?.measures[mi]?.items ?? []) {
        if (it.type !== 'chord' || getProperty(it, PID.DIAGRAM_HIDDEN)) continue;
        const v0 = tabChordVoicing(staff, it, min);
        if (v0) seen.add(fingeringKey(v0));
      }
    }
  }
  const all = [];
  for (const m of sys.measures) for (const e of entries?.[m.mi] ?? []) if (e.item?.type === 'chord') all.push({ item: e.item, mi: m.mi, position: e.position ?? [0, 1] });
  all.sort((a, b) => a.mi - b.mi || a.position[0] / a.position[1] - b.position[0] / b.position[1]);
  for (const e of all) {
    if (getProperty(e.item, PID.DIAGRAM_HIDDEN)) continue;
    const manual = getProperty(e.item, PID.DIAGRAM_SHOWN);
    const v = tabChordVoicing(staff, e.item, min);
    let show = manual;
    if (v) {
      const key = fingeringKey(v);
      if (mode === 'first') { if (!seen.has(key)) show = true; seen.add(key); }
      else if (mode === 'all' || first || previous === null || key !== previous) show = true;
      previous = key; first = false;
    }
    if (show) out.push({ symbol: e.item, mi: e.mi, position: e.position });
  }
  return out;
}

/**
 * The chord symbols of the movement's first chord staff whose diagram a fretted strumming staff draws in the measures of `sys`: 'all' = every symbol, 'first' = a symbol the first time it appears in the movement, 'changes' = a symbol
 * that differs from the previous one (a chord lasting several bars, or written again, shows once), plus the first chord of the system so that a reader never starts blind.
 */
export function strumDiagramSymbols(mv, mode, sys) {
  const measures = new Set(sys.measures.map((m) => m.mi));
  if (!mv.masterbars.length) return [];
  const key = (e) => JSON.stringify([getProperty(e.sym, PID.CHORD_ROOT), getProperty(e.sym, PID.CHORD_QUALITY), getProperty(e.sym, PID.CHORD_BASS), getProperty(e.sym, PID.VOICING)]);
  const out = [];
  let previous = null;
  let first = true;
  const seen = new Set(); // 'first': chords already met in the movement, wherever they were drawn
  for (const e of chordSymbolsInSpan(mv, mv.masterbars[0].id, mv.masterbars.length)) {
    const here = measures.has(e.mi);
    const k = key(e);
    const isNew = !seen.has(k); seen.add(k);
    if (here && (mode === 'first' ? isNew : (mode === 'all' || first || previous === null || k !== previous))) out.push({ symbol: e.sym, mi: e.mi, position: e.position });
    if (here) first = false;
    previous = key(e);
  }
  return out;
}

/**
 * Display items of the diagrams carried by the chord symbols of a chord staff, or by the chords of notes of a notation / tablature staff, in one system
 * (staff coordinates, y up). A chord of notes shows the fingering DERIVED from its notes (`chordDiagramVoicing`).
 */
export function symbolDiagramItems({ ctx, sref, sys, xAt, existing, entries }) {
  const type = getProperty(sref.staff, PID.STAFF_TYPE);
  const isChordStaff = type === 'chord';
  const strumMode = type === 'rhythm' && getProperty(sref.staff, PID.STRUM) === true ? getProperty(sref.staff, PID.STRUM_DIAGRAMS) ?? 'off' : 'off';
  const strumInstrument = strumInstrumentOf(sref.track, sref.staff);
  const isStrum = strumMode !== 'off' && strumInstrument !== 'piano' && tuningOfInstrument(strumInstrument) !== null && !!ctx.movement;
  const list = isStrum ? strumDiagramSymbols(ctx.movement, strumMode, sys) : isChordStaff ? mergeSymbols(shownSymbols(sref.staff, sys), symbolsIn(sref.staff, sys, autoChordSymbols(ctx, sref.staff, getProperty(sref.staff, PID.CHORD_DIAGRAMS) ?? 'off'))) : type === 'tab' ? tabAutoChords(sref.staff, entries, sys) : type === 'score' ? shownChords(entries, sys) : [];
  if (!list.length) return [];
  const drawn = [];
  const paths = new Map(); // instrument → fingerings chosen with the neighbours
  const pathOf = (instrument) => { if (!paths.has(instrument)) paths.set(instrument, ctx.movement ? chordPathFor(ctx.movement, instrument, { preferred: ctx.preferredVoicings, dict: ctx.chordQualities }) : new Map()); return paths.get(instrument); };
  for (const e of list) {
    let res;
    let chord = null;
    if (isStrum) { // the fingering the staff plays: the path of the rhythm staff's instrument, else the symbol's own / suggested one
      chord = diagramChordOf(e.symbol);
      const own = getProperty(e.symbol, PID.VOICING);
      res = resolveDiagram({
        voicing: own && own.instrument === strumInstrument ? own : null, chord, instrument: strumInstrument, index: getProperty(e.symbol, PID.DIAGRAM_SUGGESTION),
        preferred: ctx.preferredVoicings, dict: ctx.chordQualities, pathVoicing: pathOf(strumInstrument).get(e.symbol.id) ?? null,
      });
    } else if (isChordStaff) {
      chord = diagramChordOf(e.symbol);
      res = resolveDiagram({
        voicing: getProperty(e.symbol, PID.VOICING), chord, instrument: getProperty(e.symbol, PID.DIAGRAM_INSTRUMENT), index: getProperty(e.symbol, PID.DIAGRAM_SUGGESTION),
        preferred: ctx.preferredVoicings, dict: ctx.chordQualities, pathVoicing: pathOf(getProperty(e.symbol, PID.DIAGRAM_INSTRUMENT)).get(e.symbol.id) ?? null,
        played: ctx.movement ? playedFor(ctx.movement, sref.staff, e.symbol, e.mi) : undefined, // the fingering the chosen tablature plays under this chord (when the chord staff reads one)
      });
    } else {
      const voicing = chordDiagramVoicing(sref.staff, e.symbol, getProperty(e.symbol, PID.DIAGRAM_INSTRUMENT));
      res = voicing ? { voicing, source: 'notes' } : null;
    }
    const look = diagramLook(e.symbol, ctx.style); // each setting: its own, else the movement's default
    // size: the symbol's own, else the staff's (all the diagrams of the track), else the movement's default
    const staffScale = getProperty(sref.staff, PID.DIAGRAM_STAFF_SCALE);
    const ownScale = Object.hasOwn(e.symbol.props, PID.DIAGRAM_SCALE) && e.symbol.props[PID.DIAGRAM_SCALE] !== null;
    if (!isChordStaff && staffScale && staffScale !== 1 && !ownScale) look.scale = staffScale;
    const d = drawDiagram(ctx, { res, chord, scale: look.scale, gauge: look.gauge, dotColor: look.color, orientation: look.orientation, ref: e.symbol.id, title: false });
    if (d) drawn.push({ ...e, d, lift: look.lift });
  }
  if (!drawn.length) return [];
  let right = -Infinity;
  const placed = drawn.map((e) => {
    const x = Math.max(right, xAt(e.mi, e.position));
    right = x + e.d.width + GAP;
    return { ...e, x };
  });
  const pool = rectsOf(existing, ctx.glyphs);
  const x1 = placed[0].x; const x2 = right;
  const under = pool.filter((r) => r.x2 > x1 && r.x1 < x2);
  const floor = under.length ? Math.max(...under.map((r) => r.y2)) : 4;
  const out = [];
  for (const e of placed) for (const it of e.d.items) out.push(translateItem(it, e.x, -(floor + e.lift)));
  return out;
}
