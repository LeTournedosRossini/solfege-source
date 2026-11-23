/*
 * Zones between the systems of a printed part (model/partzones.js): the room reserved under a system and the cells drawn in it.
 *
 * `makeZoneBuilder` returns a function `(lastMeasureIndex, width) → { height, place(anchorOrigin, topY) → items } | null`: the height is known BEFORE the
 * next system is placed (it pushes the systems below down), the items are produced once the vertical position is known, as items of the LAST staff of the
 * system above (staff coordinates, y UP) so that pagination, overrides and rendering treat them like any other mark. On screen a thin frame
 * (role `container-frame`, never printed) shows each cell.
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';
import { zonesOf, isBeforeRow, ZONE_DEFAULT_HEIGHT } from '../model/partzones.js';
import { clefTimeline, clefAtMeasureStart } from './clefchanges.js';
import { layoutMovement } from './index.js';
import { translateItem } from './offsets.js';
import { overlayItems } from './containers.js';
import { SLOT_TEXT_SIZE } from './slots.js';
import { inlineCardColor, sectionSpans } from '../model/sections.js';
import { textWidth } from './textwidth.js';
import { richLines, textStyleOf } from '../model/pagetext.js';
import { resolveElementDiagram, resolveDiagram, chordSymbolsInSpan, chordKey, tuningOfInstrument, chordPathFor, playedFor, listTabStaff, tabPool } from '../model/fretdiagram.js';
import { chordSpecFromSymbol } from '../model/fretsuggest.js';
import { drawDiagram } from './diagramcontainer.js';
import { effectivePreferred, POOL_ALTERNATIVES, POOL_SOURCE, variantId, labelledFingerings } from '../model/voicingpools.js';

const GUTTER = 1.5; // sp between columns
const PAD = 0.6;
const HANDLE = 1.8; // sp
const HANDLE_COLOR = '#6a4bd0';
const MUTED = 'var(--muted, #8a8a8a)';

/** A read-only view of the measures `from`..`to` of a staff: a derived movement sharing the measures of the piece (lists that point outside are left out). */
function rangeView(work, c) {
  const staffId = getProperty(c, PID.RANGE_STAFF_ID);
  for (const mv of work.movements) {
    for (const track of mv.tracks) {
      const staff = track.staves.find((s) => s.id === staffId);
      if (!staff) continue;
      const first = mv.masterbars.findIndex((b) => b.id === getProperty(c, PID.RANGE_FROM));
      const last = mv.masterbars.findIndex((b) => b.id === getProperty(c, PID.RANGE_TO));
      if (first < 0 || last < first) return null;
      const props = {};
      for (const [k, v] of Object.entries(staff.props ?? {})) if (!(Array.isArray(v) && v.some((e) => e && typeof e === 'object'))) props[k] = v;
      const clef = clefAtMeasureStart(clefTimeline(staff, mv, false), first);
      if (clef) props[PID.CLEF] = clef;
      const shim = { ...staff, props, containers: [], voices: staff.voices.map((v) => ({ ...v, measures: v.measures.slice(first, last + 1) })) };
      const out = { ...mv, masterbars: mv.masterbars.slice(first, last + 1), tracks: [{ ...track, staves: [shim] }] };
      for (const [k, v] of Object.entries(mv)) if (Array.isArray(v) && k !== 'masterbars' && k !== 'tracks') out[k] = [];
      return { movement: out, header: true };
    }
  }
  return null;
}

const PT_MM = 25.4 / 72;
const WORD = /(\s+)/;

/**
 * Greedy wrap of the items of one logical line to `maxW`: returns lines of placed segments `{ item, text?, w }`.
 * Widths are approximate (the notation fonts are absent): a character is 0.55 of the size wide, 0.6 in bold.
 */
export function wrapItems(items, size, maxW) {
  const out = [[]]; let used = 0;
  const widthOf = (it, str) => str.length * size * (it.bold ? 0.6 : 0.55);
  const push = (seg) => { out[out.length - 1].push(seg); used += seg.w; };
  for (const it of items) {
    if (it.card) {
      const w = size * 0.6 + textWidth(it.card.label, size, { bold: it.bold }) + size * 0.55; // the card ends about one letter after its label
      if (used > 0 && used + w > maxW) { out.push([]); used = 0; }
      push({ item: it, w: w + size * 0.55 * 0.5, card: true, cardW: w });
      continue;
    }
    for (const piece of it.text.split(WORD)) {
      if (!piece) continue;
      const w = widthOf(it, piece);
      const space = /^\s+$/.test(piece);
      if (space) { if (used > 0) push({ item: it, text: piece, w }); continue; } // a space never starts a line
      if (used > 0 && used + w > maxW) { // wrap: drop the trailing space of the line we leave
        const last = out[out.length - 1]; if (last.length && last[last.length - 1].text && /^\s+$/.test(last[last.length - 1].text)) last.pop();
        out.push([]); used = 0;
      }
      push({ item: it, text: piece, w });
    }
  }
  return out.map((l) => { while (l.length && l[l.length - 1].text && /^\s+$/.test(l[l.length - 1].text)) l.pop(); return l; });
}

/** The element with this id among the chord symbols of a movement (the zones read the symbol's own fingering). */
const doc_find = (mv, id) => { for (const t of mv.tracks) for (const st of t.staves) for (const v of st.voices) for (const m of v.measures) for (const it of m?.items ?? []) if (it.id === id) return it; return null; };

/**
 * `block` ({ id, first, last }: the block of a part by extracts being laid out, `first` / `last` = ids of the first and last measure of its slice) makes the zones that belong to
 * that block appear above its first system (rows before) and under its last; the zones of other blocks are left out. Without `block` (a normal part) the zones of any block are ignored.
 */
export function makeZoneBuilder({ glyphs, work, part, getStyle, chordQualities, lyricTexts, spaceMm = 1.75, textStyles = {}, tokens = {}, block = null }) {
  const zones = new Map(); // measure id → the stacked zones (rows) under the system that ends with it
  const beforeZones = new Map(); // first measure id of a movement → the zones above its first system
  for (const z of zonesOf(part)) {
    const owner = getProperty(z.cells[0], PID.CONTAINER_BLOCK_ID) ?? null;
    if (owner && owner !== block?.id) continue; // a zone of another block (or of a block when the part is a normal one)
    const m = isBeforeRow(z.row) ? beforeZones : zones;
    const at = owner ? (isBeforeRow(z.row) ? block.first : block.last) : z.measureId; // a block's zone sits at the edges of its own block, whatever measure it is anchored to
    if (!m.has(at)) m.set(at, []);
    m.get(at).push(z);
  }
  if (!zones.size && !beforeZones.size) return null;
  // a text cell: rich text (tags <b> <i> <u>, section cards, static tokens), wrapped to the width of the cell, styled by `cell:<id>` in the part's text styles
  const textCell = (c, x, cellW) => {
    const st = textStyleOf(textStyles, `cell:${c.id}`, { size: 10, align: 'left' });
    const size = (st.size * PT_MM) / spaceMm; // staff spaces
    const lh = size * 1.25;
    const maxW = Math.max(size, cellW - 2 * PAD);
    const rows = [];
    for (const items of richLines(getProperty(c, PID.TEXT), tokens)) {
      if (!items.length) rows.push([]); else rows.push(...wrapItems(items, size, maxW));
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    while (rows.length && !rows[0].length) rows.shift();
    return { c, x, height: rows.length ? rows.length * lh + 2 * PAD : 0, draw: (A, top) => {
      const out = [];
      rows.forEach((row, k) => {
        const base = A - (top + PAD + (k + 0.85) * lh);
        // a row is drawn as RUNS: the pieces of one styled item (words AND the spaces between them) are ONE text, so the spaces are the real ones of the font. Placing every word at an
        // ESTIMATED x (the fonts are absent) made the gaps uneven: a word of narrow letters (« clarinette ») left a wide gap after it, a word of wide letters (« piano ») a tight one.
        const runs = [];
        for (const seg of row) {
          const last = runs[runs.length - 1];
          if (!seg.card && last && !last.seg.card && last.seg.item === seg.item) last.text += seg.text;
          else runs.push({ seg, text: seg.card ? '' : seg.text });
        }
        const boldOf = (it) => !!(it.bold || st.bold);
        const widthOf = (r) => (r.seg.card ? r.seg.w : textWidth(r.text, size, { bold: boldOf(r.seg.item) }));
        const textOf = (r, cx, anchor) => ({ kind: 'text', text: r.text.trim(), x: cx, y: base, size, anchor, family: st.family, bold: boldOf(r.seg.item), italic: r.seg.item.italic || st.italic, underline: r.seg.item.underline || st.underline, ...(st.color ? { color: st.color } : {}), role: 'zone-text', ref: c.id, sel: c.id });
        if (runs.length === 1 && !runs[0].seg.card) { // one run: the alignment is the browser's (anchor), exact whatever the widths
          if (runs[0].text.trim()) out.push(textOf(runs[0], st.align === 'center' ? x + cellW / 2 : st.align === 'right' ? x + cellW - PAD : x + PAD, st.align === 'center' ? 'middle' : st.align === 'right' ? 'end' : 'start'));
          return;
        }
        const width = runs.reduce((w, r) => w + widthOf(r), 0);
        let cx = st.align === 'center' ? x + (cellW - width) / 2 : st.align === 'right' ? x + cellW - PAD - width : x + PAD;
        for (const r of runs) {
          const it = r.seg.item;
          if (r.seg.card) {
            out.push({ kind: 'rect', role: 'section-card', x: cx, y: base - size * 0.3, w: r.seg.cardW, h: size * 1.2, fill: inlineCardColor(it.card, work), ref: c.id, sel: c.id });
            out.push({ kind: 'text', text: it.card.label, x: cx + size * 0.55 * 1.1, y: base, size, anchor: 'start', family: st.family, bold: it.bold || st.bold, italic: it.italic || st.italic, underline: it.underline || st.underline, role: 'zone-text', ref: c.id, sel: c.id });
          } else if (r.text.trim()) {
            const lead = textWidth(r.text.slice(0, r.text.length - r.text.trimStart().length), size, { bold: boldOf(it) }); // a leading space (after a card or another style) is not drawn by the browser: skip it here
            out.push(textOf(r, cx + lead, 'start'));
          }
          cx += widthOf(r);
        }
      });
      return out;
    } };
  };
  // one zone (a row of columns): { height, place(anchorOrigin, top) }
  // diagram cells: ONE diagram of a chord, or the diagrams of every chord of the chord staff (once each, or in the order they come) for the movement / the system
  const partPool = getProperty(part, PID.PART_VOICING_POOL);
  const preferredFor = (c) => effectivePreferred(work, getProperty(c, PID.DIAGRAM_LIST_POOL) ?? partPool); // a zone cell can force its own layer; else the part's
  const dctx = { glyphs, style: getStyle, chordQualities };
  const diagramCell = (c, x, cellW, kind, range) => {
    const preferred = preferredFor(c);
    const scale = getProperty(c, PID.CONTAINER_SCALE) ?? 1;
    const gauge = getProperty(c, PID.DIAGRAM_GAUGE) !== false;
    const dotColor = getProperty(c, PID.COLOR);
    const orientation = getProperty(c, PID.DIAGRAM_ORIENTATION);
    let drawn = [];
    if (kind === 'chordDiagram') {
      const d = drawDiagram(dctx, { res: resolveElementDiagram(c, { preferred, dict: chordQualities }), chord: getProperty(c, PID.DIAGRAM_CHORD), scale, gauge, dotColor, orientation, ref: c.id });
      if (d) drawn = [d];
    } else {
      const mv = work.movements.find((m) => m.masterbars.some((b) => b.id === getProperty(c, PID.MEASURE_ID)));
      if (mv) {
        const instrument = getProperty(c, PID.DIAGRAM_INSTRUMENT);
        const system = getProperty(c, PID.DIAGRAM_LIST_SCOPE) === 'system' && range;
        const first = system ? range.first : 0;
        const last = system ? range.last : mv.masterbars.length - 1;
        const unique = getProperty(c, PID.DIAGRAM_LIST_UNIQUE) !== false;
        const variants = getProperty(c, PID.DIAGRAM_LIST_VARIANTS) ?? 'main';
        const groupMode = getProperty(c, PID.DIAGRAM_LIST_GROUPS) ?? 'off';
        const grouped = groupMode === 'sections';
        const spans = grouped ? sectionSpans(mv) : [];
        // a diagram belongs to the section its chord is written in; the sections with the same name (Verse 1, Verse 2…) make ONE group, in the order they first appear
        const groupOf = (mi) => { const sp = spans.find((x) => mi >= x.from && mi <= x.to); const label = (sp?.label || sp?.category || '').trim(); return { key: label.toLowerCase(), label }; };
        const seen = new Set();
        if (getProperty(c, PID.DIAGRAM_LIST_SOURCE) === 'tab') { // the pool of the fingerings WRITTEN in a tablature: each distinct one once (or every one, in order)
          const staff = listTabStaff(mv, c);
          for (const e of staff ? tabPool(staff, { first, last, unique, mv }) : []) {
            const d = drawDiagram(dctx, { res: { voicing: e.voicing, source: 'notes' }, chord: null, scale, gauge, dotColor, orientation, ref: c.id });
            if (d) drawn.push(d);
          }
        } else {
        const path = chordPathFor(mv, instrument, { preferred, dict: chordQualities });
        const chordStaffOf = mv.tracks.flatMap((t) => t.staves).find((st) => getProperty(st, PID.STAFF_TYPE) === 'chord'); // (the fingering a tablature plays, when the chord staff reads one)
        if (groupMode === 'labels') { // the groups are the labels the user gave the fingerings of the layer: only the labelled ones are listed, each group under its label
          const pool = preferred?.[POOL_SOURCE];
          const tuning = tuningOfInstrument(instrument);
          const inPiece = new Map(); // chord key → { order, chord } (the order the chords are written in)
          for (const e of chordSymbolsInSpan(mv, mv.masterbars[0].id, mv.masterbars.length)) { const sp = chordSpecFromSymbol(e.chord, chordQualities); if (!sp) continue; const k = chordKey(sp, instrument, tuning); if (!inPiece.has(k)) inPiece.set(k, { order: inPiece.size, chord: e.chord }); }
          const rank = (label) => { const at = (pool?.labelOrder ?? []).findIndex((l) => l.toLowerCase() === label.toLowerCase()); return at < 0 ? 1e6 : at; };
          const items = [];
          for (const t of pool ? labelledFingerings(pool) : []) {
            if (!t.key.startsWith(`${instrument}|`)) continue;
            const chord = pool.names?.[t.key] ?? inPiece.get(t.key)?.chord;
            if (!chord) continue;
            for (const label of t.labels) items.push({ label, chord, voicing: t.voicing, main: t.main, ref: `${t.key}|${t.vid}`, order: inPiece.get(t.key)?.order ?? 1e6 });
          }
          const place = (it) => { const list = pool?.rank?.[it.label.toLowerCase()] ?? []; const at = list.indexOf(it.ref); return at < 0 ? 1e6 : at; }; // the user's ranking inside the group, else the order of the piece
          items.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label) || place(a) - place(b) || a.order - b.order || (a.main === b.main ? 0 : a.main ? -1 : 1));
          for (const it of items) {
            const d = drawDiagram(dctx, { res: { voicing: it.voicing, source: 'preferred' }, chord: it.chord, scale, gauge, dotColor, orientation, ref: c.id });
            if (d) { d.group = { key: it.label.toLowerCase(), label: it.label }; drawn.push(d); }
          }
        } else
        for (const e of chordSymbolsInSpan(mv, mv.masterbars[first].id, last - first + 1)) {
          const spec = chordSpecFromSymbol(e.chord, chordQualities);
          if (!spec) continue;
          const grp = grouped ? groupOf(e.mi) : { key: '', label: '' };
          const chordK = chordKey(spec, instrument, tuningOfInstrument(instrument));
          const onceK = `${grp.key}#${chordK}`; // (uniqueness is per group when the list is grouped)
          if (variants === 'main' && unique) { if (seen.has(onceK)) continue; seen.add(onceK); }
          if (variants === 'layer') { if (seen.has(onceK)) continue; seen.add(onceK); } // the layer's variants are drawn next to the first one
          const sym = doc_find(mv, e.key);
          const own = sym ? getProperty(sym, PID.VOICING) : null;
          const res = resolveDiagram({ voicing: own && own.instrument === instrument ? own : null, chord: e.chord, instrument, index: sym ? getProperty(sym, PID.DIAGRAM_SUGGESTION) : 0, preferred, dict: chordQualities, pathVoicing: path.get(e.key) ?? null, played: sym && chordStaffOf ? playedFor(mv, chordStaffOf, sym, e.mi) : undefined });
          if (variants === 'played') { // one diagram per chord and per fingering: a chord comes again only when its fingering changes (the verse and the chorus)
            const mark = `${grp.key}#${chordK}|${res?.voicing ? variantId(res.voicing) : ''}`;
            if (seen.has(mark)) continue; seen.add(mark);
          }
          const d = drawDiagram(dctx, { res, chord: e.chord, scale, gauge, dotColor, orientation, ref: c.id });
          if (d) { d.group = grp; drawn.push(d); }
          if (variants === 'layer') for (const v of preferred?.[POOL_ALTERNATIVES]?.[chordK] ?? []) { // the other fingerings of the layer that are switched on, side by side
            const alt = drawDiagram(dctx, { res: { voicing: v, source: 'preferred' }, chord: e.chord, scale, gauge, dotColor, orientation, ref: c.id });
            if (alt) { alt.group = grp; drawn.push(alt); }
          }
        }
        }
      }
    }
    // grouped by section: the diagrams of a group sit together (the groups in the order they first appear), under the name of the section and a rule
    const groupKeys = [...new Set(drawn.map((d) => d.group?.key ?? ''))];
    const isGrouped = drawn.some((d) => d.group?.key);
    if (isGrouped) drawn.sort((a, b) => groupKeys.indexOf(a.group?.key ?? '') - groupKeys.indexOf(b.group?.key ?? '')); // (a stable sort: the order inside a group is kept)
    // flow left to right, a new row when the next one does not fit
    const GAP_X = 0.6; const GAP_Y = 0.5; const labelSize = getProperty(c, PID.DIAGRAM_LIST_LABEL_SIZE) ?? 1; const GROUP_GAP = 1.8; const HEADER_H = 1.35 + 1.35 * labelSize; const maxW = Math.max(1, cellW - 2 * PAD);
    const rows = [[]]; let used = 0; let prevKey = null;
    for (const d of drawn) {
      const w = d.width + d.shift;
      const key = d.group?.key ?? '';
      if (used > 0 && prevKey !== null && key !== prevKey) used += GROUP_GAP - GAP_X;
      if (used > 0 && used + w > maxW) { rows.push([]); used = 0; }
      rows[rows.length - 1].push({ d, x: used, key }); used += w + GAP_X; prevKey = key;
    }
    // alignment along the cell (the diagrams of a kind of cell that lists them): left as they flow, centred, right, or justified (equal gaps, edge to edge)
    const align = kind === 'chordDiagramList' ? getProperty(c, PID.DIAGRAM_LIST_ALIGN) : 'left';
    if (align !== 'left') {
      const widest = Math.max(...rows.map((r) => r.length));
      rows.forEach((r, k) => {
        if (!r.length) return;
        const natural = r[r.length - 1].x + r[r.length - 1].d.width + r[r.length - 1].d.shift; // the width the row takes as it flows
        const room = maxW - natural;
        if (align === 'center') for (const e of r) e.x += room / 2;
        else if (align === 'right') for (const e of r) e.x += room;
        else if (align === 'justify' && r.length > 1 && !(k === rows.length - 1 && rows.length > 1 && r.length < widest)) { // (a short last row of several stays on the left, like the last line of a paragraph)
          const extra = room / (r.length - 1);
          r.forEach((e, i) => { e.x += extra * i; });
        }
      });
    }
    const named = (e) => e.key !== '';
    const heights = rows.map((r) => Math.max(0, ...r.map((e) => e.d.height)));
    const headers = rows.map((r) => (isGrouped && r.some(named) ? HEADER_H : 0));
    const total = drawn.length ? heights.reduce((a, h, k) => a + h + headers[k], 0) + GAP_Y * (rows.length - 1) + 2 * PAD : 0;
    return { c, x, height: total, draw: (A, top) => {
      const out = []; let y = top + PAD; const titled = new Set();
      rows.forEach((r, k) => {
        const bottom = A - (y + headers[k] + heights[k]); // staff y (up) of the bottom of this row of diagrams
        for (const e of r) for (const it of e.d.items) out.push(translateItem(it, x + PAD + e.x + e.d.shift, -bottom));
        if (headers[k]) { // above each run of one group: its name, then a rule over all of its diagrams (the name once, a rule on every row the group spans)
          const ruleY = bottom + heights[k] + 0.45;
          for (let i = 0; i < r.length;) {
            let j = i; while (j + 1 < r.length && r[j + 1].key === r[i].key) j += 1;
            if (named(r[i])) {
              const x1 = x + PAD + r[i].x + r[i].d.shift; const x2 = x + PAD + r[j].x + r[j].d.shift + r[j].d.width;
              out.push({ kind: 'line', x1, x2, y1: ruleY, y2: ruleY, width: 0.12, role: 'diagram-group', ref: c.id });
              for (const ex of [x1, x2]) out.push({ kind: 'line', x1: ex, x2: ex, y1: ruleY, y2: ruleY - 0.5, width: 0.12, role: 'diagram-group', ref: c.id }); // short ticks at both ends, like a bracket
              if (!titled.has(r[i].key)) { titled.add(r[i].key); out.push({ kind: 'text', text: r[i].d.group.label, x: x1, y: ruleY + 0.5, size: 1.35 * labelSize, anchor: 'start', family: 'sans-serif', weight: 600, role: 'diagram-group', ref: c.id }); }
            }
            i = j + 1;
          }
        }
        y += headers[k] + heights[k] + GAP_Y;
      });
      return out;
    } };
  };
  const buildRow = (zone, width, sections, range) => {
    const n = zone.columns;
    const cellW = (width - GUTTER * (n - 1)) / n;
    // lay each cell out once: { x, items(anchor, top) , height }
    const cells = zone.cells.map((c) => {
      const col = getProperty(c, PID.CONTAINER_ZONE_COLUMN);
      const x = col * (cellW + GUTTER);
      const kind = getProperty(c, PID.CONTAINER_KIND);
      if (kind === 'text') return textCell(c, x, cellW);
      if (kind === 'chordDiagram' || kind === 'chordDiagramList') return diagramCell(c, x, cellW, kind, range);
      if (kind === 'structure') {
        // the section cards of the system: one coloured card per section the system crosses, left to right (a section begun in an earlier system is not repeated)
        const cards = (sections ?? []).filter((sg) => !sg.continues).map((sg) => ({ text: sg.label ?? '', color: sg.color })); // only the sections that BEGIN in this system
        const ch = SLOT_TEXT_SIZE * 1.5;
        return {
          c, x, height: cards.length ? ch + 2 * PAD : 0,
          draw: (A, top) => {
            const out = []; let cx = x + PAD;
            for (const cd of cards) {
              const w = Math.min(cellW - 2 * PAD, SLOT_TEXT_SIZE * 0.62 * (cd.text.length + 2)); // approximate width of the text (Edwin is absent)
              out.push({ kind: 'rect', role: 'section-card', x: cx, y: A - (top + PAD + ch), w, h: ch, fill: cd.color ?? '#ddd', ref: c.id, sel: c.id });
              out.push({ kind: 'text', text: cd.text, x: cx + SLOT_TEXT_SIZE * 0.6, y: A - (top + PAD + ch * 0.7), size: SLOT_TEXT_SIZE, anchor: 'start', role: 'zone-text', ref: c.id, sel: c.id });
              cx += w + 0.5;
            }
            return out;
          },
        };
      }
      let inner = null;
      if (kind === 'nestedNotation' && c.fragments[0]) inner = { movement: c.fragments[0], header: false };
      else if (kind === 'syncRange') inner = rangeView(work, c);
      if (!inner) return { c, x, height: 0, draw: () => [] };
      const style = (sid) => (sid === SID.END_BAR_FINAL || sid === SID.ENABLE_INDENTATION_ON_FIRST_SYSTEM || sid === SID.SHOW_INSTRUMENT_NAMES || sid === SID.SHOW_MEASURE_NUMBERS ? false
        : sid === SID.HEADER_SHOW_TIMESIG || sid === SID.HEADER_SHOW_KEYSIG ? inner.header : getStyle(sid));
      const lay = layoutMovement(inner.movement, glyphs, { width: Math.max(10, cellW - 2 * PAD), getStyle: style, justifyLast: true, chordQualities, lyricTexts });
      return {
        c, x, height: lay.height + 2 * PAD,
        draw: (A, top) => {
          const out = [];
          for (const sys of lay.systems) {
            const sysTop = top + PAD + sys.top;
            for (const st of sys.staves) {
              const dyUp = A - (sysTop + st.originY);
              for (const it of st.items) out.push(translateItem(it, x + PAD + sys.x0, -dyUp));
            }
            out.push(...overlayItems(sys.overlays, A - sysTop, x + PAD + sys.x0));
          }
          return out;
        },
      };
    });
    const height = Math.max(zone.height ?? ZONE_DEFAULT_HEIGHT, ...cells.map((k) => k.height));
    return {
      height,
      width: cellW,
      place(anchorOrigin, top) {
        const out = [];
        for (const k of cells) {
          out.push(...k.draw(anchorOrigin, top));
          const x1 = k.x; const x2 = k.x + cellW; const yTop = anchorOrigin - top; const yBot = anchorOrigin - (top + height);
          const frame = (xa, ya, xb, yb) => ({ kind: 'line', role: 'container-frame', x1: xa, y1: ya, x2: xb, y2: yb, width: 0.05, color: MUTED, dash: [0.4, 0.4], ref: k.c.id, sel: k.c.id });
          out.push({ kind: 'rect', role: 'container-frame', x: x1, y: yBot, w: x2 - x1, h: yTop - yBot, fill: 'transparent', ref: k.c.id, sel: k.c.id }); // lets the whole cell be picked
          out.push(frame(x1, yBot, x2, yBot), frame(x1, yTop, x2, yTop), frame(x1, yBot, x1, yTop), frame(x2, yBot, x2, yTop));
          // a handle at the top left (screen only): easy to catch with a finger, violet like the height handle of the zone
          out.push({ kind: 'rect', role: 'container-handle', x: x1 + 0.2, y: yTop - 0.2 - HANDLE, w: HANDLE, h: HANDLE, fill: HANDLE_COLOR, ref: k.c.id, sel: k.c.id });
        }
        return out;
      },
    };
  };
  const stack = (source) => (measureId, width, sections, range) => {
    const rows = (source.get(measureId) ?? []).map((z) => buildRow(z, width, sections, range));
    if (!rows.length) return null;
    const ROW_GAP = 0.4;
    const height = rows.reduce((h, r) => h + r.height, 0) + ROW_GAP * (rows.length - 1);
    return {
      height,
      place(anchorOrigin, top) {
        let y = top; const out = [];
        for (const r of rows) { out.push(...r.place(anchorOrigin, y)); y += r.height + ROW_GAP; }
        return out;
      },
    };
  };
  const builder = stack(zones);
  builder.before = stack(beforeZones); // the zones above the first system of the movement whose first measure is `measureId`
  return builder;
}
