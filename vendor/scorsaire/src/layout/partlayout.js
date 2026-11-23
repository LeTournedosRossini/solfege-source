/*
 * Layout of a PART (screen 2, print): every movement shown by the part is laid out with the part's style layer over the movement's, in
 * the printable width of the page, then its systems are cut into pages. Pure (no DOM): the output is a list of page layouts that
 * `renderSvgString` can draw, plus the page geometry.
 *
 * Page filling (MuseScore `PageLayout::collectPage`): systems are poured from the top; a system that would not fit under the page (with the
 * lower border) starts the next page, and a system that carries a page break ends its page. Breaks and fixed systems of the part
 * (`PID.PART_BREAKS`, `PID.PART_LOCKS`) are anchored by measure id and turned into measure indices here. With the vertical spread on, the space
 * left on each page is shared between the gaps (layout/pagespread.js) and the movement is laid out a second time with that extra space.
 * Each movement starts on a new page.
 */
import { trackTransposition } from '../model/instruments.js';
import { intervalOfSemitones } from '../model/transpose.js';
import { shiftChordTrack, shiftedFifths } from './displayshift.js';
import { chordViewShifts, hasChordViews } from '../model/chordview.js';
import { effectivePreferred } from '../model/voicingpools.js';
import { partTextsByStaff } from '../model/partstafftext.js';
import { PID, SID, getProperty, resolveStyle, pageGeometry, partStaffIds, partTrackIds, measureNumbers, resolveDisplay, trackLayer } from '../model/index.js';
import { makePageChrome, partTags } from './pagechrome.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { layoutMovement } from './index.js';
import { partContainersOf } from '../model/partcontainers.js';
import { planVerticalSpread } from './pagespread.js';
import { rectsOf, yExtent } from './bounds.js';
import { makeZoneBuilder } from './partzones.js';
import { describeChanges, mergeDirty } from '../model/dirty.js';
import { addSystemDividers } from './systemdividers.js';
import { partDividers } from '../model/dividers.js';
import { isExtractPart, resolveExtracts, extractLayoutOf } from '../model/extracts.js';
import { isLyricsPart } from '../model/lyricstrophes.js';
import { layoutLyricsPages } from './lyricspage.js';

// a printed part numbers its measures by default and keeps its systems close (3 staff spaces between two systems instead of the 11 of MuseScore: the same top / bottom /
// edge proportions as the setting « Espace entre les systèmes » of screen 2 writes); the style layers of the part and of the movement can say otherwise
export const PRINT_DEFAULTS = Object.freeze({ [SID.SHOW_MEASURE_NUMBERS]: true, [SID.SYSTEM_TOP_MARGIN]: 1.4, [SID.SYSTEM_BOTTOM_MARGIN]: 1.6, [SID.SYSTEM_EDGE_DISTANCE]: 0.27 });

/**
 * Incremental layout of the parts (screen 2): one record per (part, movement) holding what `layoutMovement` keeps between two layouts (`store`), what changed since
 * (`dirty`, accumulated from the events of the Document) and a STABLE style function (the cache compares it by identity; it reads the live style layers, so it is always
 * right at the time it is called, and a style change reports `all`). Create it once per document and give it to `layoutPart({ cache })`.
 * @returns {{ record(part, movementIndex, movement), dispose() }}
 */
export function createPartCache(doc) {
  const records = new Map();
  let revision = 0; // counts the events of the document: the same revision means the same document
  const off = doc.subscribe((event) => {
    revision++;
    for (const rec of records.values()) rec.dirty = mergeDirty(rec.dirty, describeChanges(doc, rec.movement, event.changes));
  });
  return {
    /** Changes whenever the document does (any commit, undo or redo). */
    revision: () => revision,
    record(part, movementIndex, movement) {
      const key = `${part.id}|${movementIndex}`;
      let rec = records.get(key);
      if (!rec || rec.movement !== movement) {
        rec = { movement, store: {}, dirty: null, getStyle: (sid) => resolveStyle(sid, [part.style, movement.style, PRINT_DEFAULTS]) };
        records.set(key, rec);
      }
      return rec;
    },
    dispose() { off?.(); records.clear(); },
  };
}

// display items that exist only on screen (never printed, never part of the music's ink)
const SCREEN_ONLY_ROLES = new Set(['chord-view-card', 'chord-view-card-text', 'section-band', 'section-strip', 'container-frame', 'container-handle', 'container-warning', 'container-readonly']);

/** Where the ink of a system really starts and ends (system coordinates, y down): the page margin is measured from it, not from the room kept for marks. */
export function inkExtent(sys, glyphs) {
  let top = Infinity; let bottom = -Infinity;
  for (const st of sys.staves) {
    const ext = yExtent(rectsOf(st.items.filter((it) => !SCREEN_ONLY_ROLES.has(it.role)), glyphs));
    if (!ext) continue;
    top = Math.min(top, st.originY - ext.hi);
    bottom = Math.max(bottom, st.originY - ext.lo);
  }
  for (const ov of sys.overlays ?? []) if (ov.role === 'extract-number') top = Math.min(top, ov.y - ov.size * 0.8); // the number written above a block of an extract part
  if ((sys.zoneBefore || sys.band) && Number.isFinite(top)) top = Math.min(top, 0); // the room kept above the first system starts at the top of the system
  const zone = sys.zoneAfter?.height ?? 0; // the room reserved under the system belongs to it: a page must hold it
  return Number.isFinite(top) ? { top, bottom: zone ? Math.max(bottom, sys.height + zone - 2) : bottom } : { top: 0, bottom: sys.height + zone };
}

/**
 * Cuts systems into pages.
 * @param systems        systems of one movement layout (each: `top`, `height`, maybe `pageBreak`)
 * @param contentHeight  printable height, in staff spaces
 * @param o              { upper, lower }: borders (staff spaces) above the first and below the last system of a page
 * @returns [{ indices: [system index…], systems: [system copy with `top` relative to the page (first system at `upper`)], height }]
 */
/** A copy of a system with some members replaced, keeping its non-enumerable members (xAt, the zones…): a plain spread would drop them. */
function withHidden(sys, patch) {
  const copy = { ...sys, ...patch };
  for (const k of Object.getOwnPropertyNames(sys)) if (!Object.hasOwn(copy, k)) Object.defineProperty(copy, k, Object.getOwnPropertyDescriptor(sys, k));
  return copy;
}

export function paginateSystems(systems, contentHeight, { upper = 0, lower = 0, inks, limits = () => ({ top: 0, bottom: 0 }), pageBase = 0 } = {}) {
  const inkOf = (i) => inks?.[i] ?? { top: 0, bottom: systems[i].height };
  const pages = [];
  let current = null;
  let first = null;
  systems.forEach((sys, index) => {
    // page y of a system: the INK of the first system of the page starts at `upper`; the ink of the last must end `lower` above the bottom
    const y = first === null ? 0 : sys.top - systems[first].top - inkOf(first).top + upper + current.top;
    const startsPage = !current || systems[index - 1].pageBreak || y + inkOf(index).bottom + lower > current.limitBottom + 1e-9;
    if (startsPage) {
      const lim = limits(pages.length);
      current = { indices: [], systems: [], height: contentHeight, top: lim.top, limitBottom: contentHeight - lim.bottom };
      pages.push(current);
      first = index;
    }
    current.indices.push(index);
    current.systems.push(withHidden(sys, { top: sys.top - systems[first].top - inkOf(first).top + upper + current.top }));
  });
  return pages;
}

/** Breaks and fixed systems of a part, as measure indices of a movement: { breaks: Map(index → kind), locks: [{ from, to }] }. */
export function partPlanFor(part, movement) {
  const index = new Map(movement.masterbars.map((b, i) => [b.id, i]));
  const breaks = new Map();
  for (const b of part.props[PID.PART_BREAKS] ?? []) if (index.has(b.measureId)) breaks.set(index.get(b.measureId), b.breakKind);
  const locks = [];
  for (const l of part.props[PID.PART_LOCKS] ?? []) if (index.has(l.from) && index.has(l.to)) locks.push({ from: index.get(l.from), to: index.get(l.to) });
  return { breaks, locks };
}

/**
 * @param work    the work (document.work)
 * @param part    a part element
 * @param glyphs  Bravura data
 * @returns { geometry, pages: [{ number, movementIndex, layout: { width, height, systems } }], warnings }
 */
/**
 * The movement as the part sees it: the containers the part hangs on its staves (model/partcontainers.js) are added, in a COPY of the staves that carry
 * them, to the containers those staves already have — the layout then treats them like any staff container. The document is never touched, and without
 * such containers the movement itself is returned (so the incremental layout keeps working as before).
 */
/**
 * The movement with the free texts of THIS part (`PID.PART_STAFF_TEXTS`, model/partstafftext.js) added to the texts of the staves they sit on, so that the usual staff-text layout draws
 * them (and their lines). The same object when the part has none for this movement.
 */
function withPartStaffTexts(mv, part) {
  const byStaff = partTextsByStaff(part, mv);
  if (!Object.keys(byStaff).length) return mv;
  const copy = (el, key, value) => {
    const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(el));
    Object.defineProperty(c, key, { value, enumerable: true, writable: true, configurable: true });
    return c;
  };
  return copy(mv, 'tracks', mv.tracks.map((t) => (t.staves.some((st) => byStaff[st.id])
    ? copy(t, 'staves', t.staves.map((st) => (byStaff[st.id] ? copy(st, 'props', { ...st.props, [PID.STAFF_TEXTS]: [...(getProperty(st, PID.STAFF_TEXTS) ?? []), ...byStaff[st.id]] }) : st)))
    : t)));
}

/** The movement as one part shows its tracks: in the part's order and with its display transpositions (a copy; the movement itself when the part changes nothing). */
function withPartTracks(mv, part, { view: viewOverride = null, source = null } = {}) {
  // `source` = the WHOLE movement when `mv` is a slice of it (a block of a part by extracts): the capos and the display tags are read there, so that a capo written before the block still counts
  const order = partTrackIds(part, mv);
  const reordered = order.some((id, i) => id !== mv.tracks[i].id);
  const trans = part.props[PID.PART_TRANSPOSITIONS] ?? {};
  const master = part.props[PID.PART_TRANSPOSE_ALL] ?? 0; // semitones, everything written higher; on top of each track's own
  const whole = source ?? mv; const wholeIndex = source ? new Map(source.masterbars.map((b, i) => [b.id, i])) : null;
  const view = viewOverride ?? part.props[PID.PART_CHORD_VIEW] ?? 'author'; // how the chord symbols are read: the display tags of the chord staff, as written, or as played with the capo (model/chordview.js)
  const viewOn = view === 'capo' || (view === 'author' && hasChordViews(whole));
  const changed = Boolean(master) || viewOn || mv.tracks.some((t) => Object.hasOwn(trans, t.id));
  if (!reordered && !changed) return mv;
  const copy = (el, key, value) => {
    const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(el));
    Object.defineProperty(c, key, { value, enumerable: true, writable: true, configurable: true });
    return c;
  };
  const byId = new Map(mv.tracks.map((t) => [t.id, t]));
  const key = getProperty(mv.masterbars[0], PID.KEY_SIG) ?? 0; // (the chord symbols are spelled for the key the piece starts in)
  const tracks = order.map((id) => {
    const t = byId.get(id); const own = trans[id];
    const base = own ?? trackTransposition(t) ?? { diatonic: 0, chromatic: 0 }; // WRITTEN → SOUNDING, like an instrument: the written music is `chromatic` semitones above what sounds, negated
    if (t.staves.some((s) => getProperty(s, PID.STAFF_TYPE) === 'chord')) { // the chord symbols follow: written = concert − chromatic, and the whole part's shift on top
      const n = master - base.chromatic;
      const chordStaff = t.staves.find((s) => getProperty(s, PID.STAFF_TYPE) === 'chord');
      const viewShifts = viewOn ? chordViewShifts(whole, whole.tracks.flatMap((x) => x.staves).find((s) => s.id === chordStaff.id) ?? chordStaff, { view }) : null; // per measure of the movement
      const shiftAt = (mi) => (wholeIndex ? viewShifts[wholeIndex.get(mv.masterbars[mi]?.id)] : viewShifts[mi]) ?? 0;
      if (viewShifts) return shiftChordTrack(t, (mi) => n + shiftAt(mi), (k) => shiftedFifths(key, k));
      return n ? shiftChordTrack(t, n, shiftedFifths(key, n)) : t;
    }
    if (!own && !master) return t;
    const iv = master ? intervalOfSemitones(base.chromatic - master) : own;
    return copy(t, 'props', { ...t.props, [PID.TRANSPOSITION]: iv });
  });
  let out = copy(mv, 'tracks', tracks);
  // a bracket needs its tracks side by side: when the part's order splits a group, the group is left out of this part
  if (reordered && mv.groups?.length) {
    const pos = new Map(order.map((id, i) => [id, i]));
    const keep = (g) => { const a = pos.get(g.props[PID.START_TRACK_ID]); const b = pos.get(g.props[PID.END_TRACK_ID]); const orig = mv.tracks.map((t) => t.id); return a !== undefined && b !== undefined && b - a === orig.indexOf(g.props[PID.END_TRACK_ID]) - orig.indexOf(g.props[PID.START_TRACK_ID]) && order.slice(a, b + 1).every((id) => { const o = orig.indexOf(id); return o >= orig.indexOf(g.props[PID.START_TRACK_ID]) && o <= orig.indexOf(g.props[PID.END_TRACK_ID]); }); };
    out = copy(out, 'groups', mv.groups.filter(keep));
  }
  return out;
}

function withPartContainers(mv, part, { keepHidden = false, block = null } = {}) {
  // a container that belongs to a block (model/extracts.js) shows in that block only, and in no normal part
  const hung = partContainersOf(part).filter((c) => { const owner = getProperty(c, PID.CONTAINER_BLOCK_ID) ?? null; return owner === null || owner === block; });
  // the containers of screen 1 this part hides (an override `hidden` on the container) are left out, with the room they take — unless `keepHidden` (the screen
  // where elements are picked still shows them, greyed, so that they can be shown again)
  const overrides = part.props[PID.PART_OVERRIDES] ?? {};
  const hiddenHere = keepHidden ? new Set() : new Set(Object.keys(overrides).filter((id) => overrides[id]?.hidden));
  const hasHidden = hiddenHere.size && mv.tracks.some((t) => t.staves.some((st) => (st.containers ?? []).some((c) => hiddenHere.has(c.id))));
  if (!hung.length && !hasHidden) return mv;
  const byStaff = new Map();
  for (const c of hung) {
    const id = c.props[PID.CONTAINER_STAFF_ID];
    if (!byStaff.has(id)) byStaff.set(id, []);
    byStaff.get(id).push(c);
  }
  if (!hasHidden && !mv.tracks.some((t) => t.staves.some((st) => byStaff.has(st.id)))) return mv;
  // a copy keeps the non-enumerable readers of the elements (`staff.clef`…), which a plain spread would drop
  const copy = (el, key, value) => {
    const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(el));
    Object.defineProperty(c, key, { value, enumerable: true, writable: true, configurable: true });
    return c;
  };
  return copy(mv, 'tracks', mv.tracks.map((t) => copy(t, 'staves', t.staves.map((st) => (byStaff.has(st.id) || (st.containers ?? []).some((c) => hiddenHere.has(c.id)) ? copy(st, 'containers', [...(st.containers ?? []).filter((c) => !hiddenHere.has(c.id)), ...(byStaff.get(st.id) ?? [])]) : st)))));
}

/**
 * A part by EXTRACTS (model/extracts.js): each block is laid out as its own slice of a movement with the part's settings (tracks, transpositions, display,
 * containers, breaks, zones), then the systems of all the blocks follow each other and are cut into pages together — a block does not start a new page. The zones of a block
 * (model/extracts.js `addBlockZone`) sit above its first system and under its last. No cache, no vertical spread; the playback and the cursor do not apply to such a part (the pages carry `extract: true`, and each system the
 * `block` it belongs to).
 */
function layoutExtractPart(work, part, glyphs, { lyricTexts, partName, today, keepHiddenContainers, tweak }) {
  const layered = (layers) => { const get = (sid) => resolveStyle(sid, layers); return tweak ? (sid) => tweak(sid, get(sid), get) : get; };
  const partStyle = layered([part.style, PRINT_DEFAULTS]);
  const geometry = pageGeometry(partStyle);
  const ids = new Set(partStaffIds(work, part));
  const dividers = partDividers(part);
  const chrome = makePageChrome({ work, part, geometry, getStyle: partStyle, partName, today });
  const warnings = [];
  const ex = extractLayoutOf(part);
  const columnar = ex.columns > 1;
  let colWidth = (geometry.contentWidth - ex.gap * (ex.columns - 1)) / ex.columns; // a block is laid out at the width of its column (made exact below, once the left room of a system is known)
  let x0Base = null; // the room a system keeps on its left (brackets): the space between two columns is counted from the end of one to the left edge of the next
  const cells = []; // columns: the blocks laid out, to be set on the pages afterwards
  let blockNumber = 0;
  const systems = []; const owner = []; // owner[i] = { block, movementIndex } of systems[i]
  const spans = []; // the systems of each laid out block: { block, from, to }
  let offset = 0; let gap = null;
  resolveExtracts(work, part).forEach(({ block, movement, range, slice, warnings: edge, missing }) => {
    if (missing) { warnings.push({ code: 'extractMissing', blockId: block.id }); return; }
    for (const w of edge) warnings.push({ ...w, blockId: block.id });
    const wanted = block.staffIds ? new Set(block.staffIds) : null;
    const own = slice.tracks.flatMap((t) => t.staves).filter((st) => ids.has(st.id) && (!wanted || wanted.has(st.id)));
    if (!own.length) { warnings.push({ code: 'extractEmpty', blockId: block.id }); return; }
    const getStyle = layered([part.style, slice.style, PRINT_DEFAULTS]);
    const { breaks, locks } = partPlanFor(part, slice);
    const overrides = new Map((part.props[PID.PART_MEASURE_NUMBERS] ?? []).map((o) => [o.measureId, o.mode]));
    const numberOverrides = new Map(slice.masterbars.flatMap((b, i) => (overrides.has(b.id) ? [[i, overrides.get(b.id)]] : [])));
    const shown = withPartStaffTexts(withPartContainers(withPartTracks(slice, part, { view: block.chordView ?? null, source: movement }), part, { keepHidden: keepHiddenContainers, block: block.id }), part);
    const movementIndex = work.movements.findIndex((m) => m.id === movement.id);
    // the zones of the part (between the systems, by measure) and those of THIS block (above its first system, under its last)
    const zoneBuild = makeZoneBuilder({ glyphs, work, part, getStyle, spaceMm: geometry.spaceMm, textStyles: part.props[PID.PART_TEXT_STYLES] ?? {}, tokens: { tags: partTags(work, part, { partName, movementIndex }), today, partName }, chordQualities: workChordQualities(work), lyricTexts: lyricTexts ?? work.props[PID.LYRIC_TEXTS], block: { id: block.id, first: slice.masterbars[0].id, last: slice.masterbars[slice.masterbars.length - 1].id } });
    const zoneAfter = zoneBuild ? (mi, width, sections, first) => (slice.masterbars[mi] ? zoneBuild(slice.masterbars[mi].id, width, sections, { first, last: mi }) : null) : null;
    const zoneBefore = zoneBuild ? (mi, width, sections, last) => (slice.masterbars[mi] ? zoneBuild.before(slice.masterbars[mi].id, width, sections, { first: mi, last }) : null) : null;
    const showViewCards = (block.chordView ?? part.props[PID.PART_CHORD_VIEW] ?? 'author') === 'author'; // the display tags are in force: their cards are shown on screen 2 (never printed)
    const runBlock = (width) => layoutMovement(shown, glyphs, {
      width,
      getStyle,
      chordViewCards: showViewCards,
      chordQualities: workChordQualities(work),
      lyricTexts: lyricTexts ?? work.props[PID.LYRIC_TEXTS],
      preferredVoicings: effectivePreferred(work, getProperty(part, PID.PART_VOICING_POOL)),
      staffFilter: new Set(own.map((s) => s.id)),
      trackDisplay: (t) => resolveDisplay(part.props[PID.PART_TRACK_DISPLAY]?.[t.id], trackLayer(t)),
      displaySig: JSON.stringify(part.props[PID.PART_TRACK_DISPLAY] ?? null),
      plan: { zoneAfter, zoneBefore, staffGap: part.props[PID.PART_STAFF_GAP], staffGaps: part.props[PID.PART_STAFF_GAPS], breaks, locks, lastFill: columnar ? 0 : null, numberStart: range.from, numberOverrides, spaceMm: geometry.spaceMm, overrides: part.props[PID.PART_OVERRIDES], textStyles: part.props[PID.PART_TEXT_STYLES] },
    });
    let layout = runBlock(colWidth);
    if (columnar && x0Base === null && layout.systems.length) { // the drawn width of a column is colWidth − x0: choose colWidth so that the columns end at the right edge of the page with exactly `gap` between them
      x0Base = layout.systems[0].x0 ?? 0;
      colWidth = (geometry.contentWidth - x0Base - ex.gap * (ex.columns - 1)) / ex.columns + x0Base;
      layout = runBlock(colWidth);
    }
    warnings.push(...layout.warnings);
    if (!layout.systems.length) return;
    if (gap === null && layout.systems.length > 1) gap = layout.systems[1].top - (layout.systems[0].top + layout.systems[0].height);
    const base = layout.systems[0].top;
    blockNumber += 1;
    // the number of the block (an option of the part): written above its first system, in the room the ink extent keeps for it
    const numbered = (sys, k) => (ex.numbers && k === 0 ? withHidden(sys, { overlays: [...(sys.overlays ?? []), { kind: 'text', role: 'extract-number', text: String(blockNumber), x: 0, y: inkExtent(sys, glyphs).top - 0.6, size: 2.2, anchor: 'start', bold: true }] }) : sys);
    if (columnar) { cells.push({ block, movementIndex, systems: layout.systems.map((sys, k) => numbered(withHidden(sys, { top: sys.top - base }), k)) }); return; }
    if (block.breakBefore && systems.length) systems[systems.length - 1] = withHidden(systems[systems.length - 1], { pageBreak: true }); // this block starts a new page
    const firstIndex = systems.length;
    layout.systems.forEach((sys, k) => {
      systems.push(numbered(withHidden(sys, { top: sys.top - base + offset + (ex.numbers && k === 0 ? 3 : 0) }), k));
      owner.push({ block: block.id, movementIndex });
    });
    spans.push({ block, from: firstIndex, to: systems.length - 1 });
    const last = systems[systems.length - 1];
    offset = last.top + last.height + (ex.rowGap ?? Math.max(gap ?? 0, 6));
  });
  if (columnar) return layoutExtractColumns({ cells, ex, colWidth, x0Base: x0Base ?? 0, geometry, chrome, partStyle, glyphs, warnings, gap });
  const inks = systems.map((sys) => inkExtent(sys, glyphs));
  const upper = partStyle(SID.PAGE_UPPER_BORDER); const lower = partStyle(SID.PAGE_LOWER_BORDER);
  const paginate = () => (systems.length ? paginateSystems(systems, geometry.contentHeight, { upper, lower, inks, limits: (k) => chrome.limits(k, owner[0].movementIndex) }) : []);
  let cut = paginate();
  // a block to keep together that would be split between two pages starts a new page instead — if it fits on one (otherwise it is left to flow)
  for (const sp of spans) {
    if (!sp.block.keepTogether || sp.from === 0 || systems[sp.from - 1].pageBreak) continue;
    const pageOf = (i) => cut.findIndex((p) => p.indices.includes(i));
    if (pageOf(sp.from) === pageOf(sp.to)) continue;
    const alone = paginateSystems(systems.slice(sp.from, sp.to + 1), geometry.contentHeight, { upper, lower, inks: inks.slice(sp.from, sp.to + 1) });
    if (alone.length !== 1) continue;
    systems[sp.from - 1] = withHidden(systems[sp.from - 1], { pageBreak: true });
    cut = paginate();
  }
  const pages = cut.map((p, k) => ({
    number: k + 1, movementIndex: owner[p.indices[0]].movementIndex, extract: true,
    layout: { width: geometry.contentWidth, height: p.height, systems: addSystemDividers(p.systems.map((sys, j) => Object.defineProperty(sys, 'block', { value: owner[p.indices[j]].block, enumerable: false, configurable: true })), dividers, glyphs) },
  }));
  pages.forEach((p, i) => { p.chrome = chrome.items(i, pages.length, p.movementIndex); });
  return { geometry, pages, warnings, extract: true };
}

/**
 * The blocks of an extract part in COLUMNS (screen 2): each block was laid out at the width of a column; here they are set on the pages, left to right then down
 * (block 1 top left, 2 top right, 3 under 1…). `ex.flow` 'grid': the blocks of a row share its height (the tallest decides); 'free': each column goes down at its own pace.
 * `ex.perPage` (0 = as many as fit) is the number of blocks of a page. Nothing is ever cut or shrunk: a block that does not fit is kept and a warning is returned
 * (`extractOverflow`: a page that runs out of room; `extractColumnNarrow`: a block wider than its column). A block is never split between two pages.
 */
function layoutExtractColumns({ cells, ex, colWidth, x0Base, geometry, chrome, partStyle, glyphs, warnings, gap }) {
  const upper = partStyle(SID.PAGE_UPPER_BORDER); const lower = partStyle(SID.PAGE_LOWER_BORDER);
  const rowGap = ex.rowGap ?? Math.max(gap ?? 0, 6); // the space between two rows: the author's, else the room between two systems (6 staff spaces at least)
  const placed = []; // { page, col, cell, y (page y of the ink top of the cell) }
  const metrics = cells.map((cell) => {
    const first = cell.systems[0]; const last = cell.systems[cell.systems.length - 1];
    const inkFirst = inkExtent(first, glyphs).top;
    return { inkFirst, height: last.top + inkExtent(last, glyphs).bottom - (first.top + inkFirst), width: Math.max(...cell.systems.map((sys) => sys.x0 + sys.width)) };
  });
  cells.forEach((cell, i) => { if (metrics[i].width > colWidth + (cell.systems[0].x0 ?? 0) + 0.5) warnings.push({ code: 'extractColumnNarrow', blockId: cell.block.id }); });
  const pageLimits = (k, movementIndex) => { const lim = chrome.limits(k, movementIndex); return { top: upper + lim.top, bottom: geometry.contentHeight - lim.bottom - lower }; };
  let page = 0; let count = 0; let used = null; let colUsed = null; let col = 0; let rowCells = [];
  const room = () => pageLimits(page, cells[0].movementIndex);
  const startPage = () => { page += 1; count = 0; used = null; colUsed = Array(ex.columns).fill(null); };
  colUsed = Array(ex.columns).fill(null);
  const overflowed = new Set();
  const fits = (y, h) => y + h <= room().bottom + 1e-9;
  const flushRow = () => {
    if (!rowCells.length) return;
    const h = Math.max(...rowCells.map((r) => metrics[r].height));
    const limit = room();
    const top = used === null ? limit.top : used + rowGap;
    const full = ex.perPage > 0 ? count + rowCells.length > ex.perPage : !fits(top, h);
    let y = top;
    if (full && count > 0) { startPage(); y = room().top; }
    if (!fits(y, h) && !overflowed.has(page)) { overflowed.add(page); warnings.push({ code: 'extractOverflow', blockId: cells[rowCells[0]].block.id, page: page + 1 }); }
    rowCells.forEach((r, c) => placed.push({ page, col: c, cell: cells[r], m: metrics[r], y }));
    count += rowCells.length; used = y + h; rowCells = [];
  };
  cells.forEach((cell, i) => {
    if (cell.block.breakBefore && (count > 0 || rowCells.length)) { flushRow(); if (count > 0) startPage(); }
    if (ex.flow === 'free') {
      const c = i % ex.columns; // each column goes down at its own pace; the blocks keep the reading order
      const h = metrics[i].height;
      let y = colUsed[c] === null ? room().top : colUsed[c] + rowGap;
      if (ex.perPage > 0 ? count >= ex.perPage : !fits(y, h) && count > 0) { startPage(); y = room().top; }
      if (!fits(y, h) && !overflowed.has(page)) { overflowed.add(page); warnings.push({ code: 'extractOverflow', blockId: cell.block.id, page: page + 1 }); }
      placed.push({ page, col: c, cell, m: metrics[i], y }); colUsed[c] = y + h; count += 1;
      return;
    }
    rowCells.push(i);
    if (rowCells.length === ex.columns) flushRow();
  });
  flushRow();
  const total = (placed.length ? Math.max(...placed.map((p) => p.page)) : 0) + 1;
  const pages = Array.from({ length: total }, (_, k) => {
    const mine = placed.filter((p) => p.page === k);
    const systems = [];
    for (const p of mine) {
      const first = p.cell.systems[0];
      for (const sys of p.cell.systems) {
        const moved = withHidden(sys, { top: p.y - p.m.inkFirst + (sys.top - first.top), x0: sys.x0 + p.col * (colWidth - x0Base + ex.gap) });
        Object.defineProperty(moved, 'block', { value: p.cell.block.id, enumerable: false, configurable: true });
        systems.push(moved);
      }
    }
    const movementIndex = mine[0]?.cell.movementIndex ?? 0;
    return { number: k + 1, movementIndex, extract: true, layout: { width: geometry.contentWidth, height: geometry.contentHeight, systems } };
  });
  pages.forEach((p, i) => { p.chrome = chrome.items(i, pages.length, p.movementIndex); });
  return { geometry, pages, warnings, extract: true };
}

/** A LYRICS part (model/lyricstrophes.js): the strophes as blocks of text; no music, no cache, no spread. */
function layoutLyricsPart(work, part, glyphs, { partName, today, tweak, lang }) {
  const get = (sid) => resolveStyle(sid, [part.style, PRINT_DEFAULTS]);
  const partStyle = tweak ? (sid) => tweak(sid, get(sid), get) : get;
  const geometry = pageGeometry(partStyle);
  const chrome = makePageChrome({ work, part, geometry, getStyle: partStyle, partName, today });
  return { geometry, pages: layoutLyricsPages({ work, part, geometry, getStyle: partStyle, chrome, lang }), warnings: [], lyrics: true };
}

export function layoutPart(work, part, glyphs, { lyricTexts, partName = '', today = '', cache = null, keepHiddenContainers = false, tweak = null, lang = 'fr' } = {}) {
  if (isLyricsPart(part)) return layoutLyricsPart(work, part, glyphs, { partName, today, tweak, lang });
  if (isExtractPart(part)) return layoutExtractPart(work, part, glyphs, { lyricTexts, partName, today, keepHiddenContainers, tweak });
  const printDefaults = PRINT_DEFAULTS;
  // `tweak(sid, value, get)` (`get` reads any other style of the same layers): what the Lecteur changes on top of the author's layout (the cards of the sections, the room between the systems); never together with `cache`
  const layered = (layers) => { const get = (sid) => resolveStyle(sid, layers); return tweak ? (sid) => tweak(sid, get(sid), get) : get; };
  const partStyle = layered([part.style, printDefaults]);
  const geometry = pageGeometry(partStyle);
  const ids = new Set(partStaffIds(work, part)); // a part never depends on what screen 1 hides: no list = every staff of the work
  const pages = [];
  const warnings = [];
  const dividers = partDividers(part);
  const chrome = makePageChrome({ work, part, geometry, getStyle: partStyle, partName, today });
  const overrides = new Map((part.props[PID.PART_MEASURE_NUMBERS] ?? []).map((o) => [o.measureId, o.mode]));
  let numberNext = 0; // measure number the next movement starts with (when the part keeps counting)
  const movementPages = [];
  work.movements.forEach((mv, movementIndex) => {
    const own = mv.tracks.flatMap((t) => t.staves).filter((s) => ids.has(s.id));
    if (!own.length) return; // none of the part's staves lives in this movement
    const rec = cache ? cache.record(part, movementIndex, mv) : null;
    const getStyle = rec ? rec.getStyle : layered([part.style, mv.style, printDefaults]);
    const upper = getStyle(SID.PAGE_UPPER_BORDER);
    const lower = getStyle(SID.PAGE_LOWER_BORDER);
    const { breaks, locks } = partPlanFor(part, mv);
    const lastFill = getStyle(SID.LAST_SYSTEM_JUSTIFY) ? getStyle(SID.LAST_SYSTEM_FILL_LIMIT) : null;
    const numberStart = getStyle(SID.MEASURE_NUMBERS_CONTINUE) ? numberNext : 0;
    const numberOverrides = new Map(mv.masterbars.flatMap((b, i) => (overrides.has(b.id) ? [[i, overrides.get(b.id)]] : [])));
    const zoneBuild = makeZoneBuilder({ glyphs, work, part, getStyle, spaceMm: geometry.spaceMm, textStyles: part.props[PID.PART_TEXT_STYLES] ?? {}, tokens: { tags: partTags(work, part, { partName, movementIndex }), today, partName }, chordQualities: workChordQualities(work), lyricTexts: lyricTexts ?? work.props[PID.LYRIC_TEXTS] });
    const zoneAfter = zoneBuild ? (mi, width, sections, first) => (mv.masterbars[mi] ? zoneBuild(mv.masterbars[mi].id, width, sections, { first, last: mi }) : null) : null;
    const shown = withPartStaffTexts(withPartContainers(withPartTracks(mv, part), part, { keepHidden: keepHiddenContainers }), part); // the movement with the containers of the part (the same object when it has none)
    const run = (verticalPlan) => layoutMovement(shown, glyphs, {
      width: geometry.contentWidth,
      getStyle,
      chordViewCards: (part.props[PID.PART_CHORD_VIEW] ?? 'author') === 'author',
      chordQualities: workChordQualities(work),
      lyricTexts: lyricTexts ?? work.props[PID.LYRIC_TEXTS],
      preferredVoicings: effectivePreferred(work, getProperty(part, PID.PART_VOICING_POOL)),
      staffFilter: new Set(own.map((s) => s.id)),
      trackDisplay: (t) => resolveDisplay(part.props[PID.PART_TRACK_DISPLAY]?.[t.id], trackLayer(t)), // screen 2: the part's layer over the track's
      displaySig: JSON.stringify(part.props[PID.PART_TRACK_DISPLAY] ?? null),
      plan: { zoneAfter, zoneBefore: zoneBuild ? (mi, width, sections, last) => (mv.masterbars[mi] ? zoneBuild.before(mv.masterbars[mi].id, width, sections, { first: mi, last }) : null) : null, staffGap: part.props[PID.PART_STAFF_GAP], staffGaps: part.props[PID.PART_STAFF_GAPS], breaks, locks, lastFill, numberStart, numberOverrides, spaceMm: geometry.spaceMm, overrides: part.props[PID.PART_OVERRIDES], textStyles: part.props[PID.PART_TEXT_STYLES] },
      verticalPlan,
      cache: rec,
    });
    numberNext = measureNumbers(mv, numberStart).next;
    let layout = run();
    warnings.push(...layout.warnings);
    let inks = layout.systems.map((sys) => inkExtent(sys, glyphs));
    const pageBase = pages.length;
    const limits = (k) => chrome.limits(pageBase + k, movementIndex);
    const cut = paginateSystems(layout.systems, geometry.contentHeight, { upper, lower, inks, limits });
    // vertical spread (or plain distribution between systems): decided on the first layout, applied by laying the movement out again
    const plan = planVerticalSpread(layout, cut, {
      contentHeight: geometry.contentHeight, upper, lower, inks, spread: getStyle(SID.PAGE_VERTICAL_SPREAD), maxFill: getStyle(SID.PAGE_MAX_FILL_SPREAD),
    });
    let final = cut;
    if (plan.any) {
      if (rec) rec.dirty = { all: false, measures: new Set(), paintAll: false, staffSet: false }; // the second pass lays out the same content: only the vertical spacing differs
      layout = run(plan);
      inks = layout.systems.map((sys) => inkExtent(sys, glyphs));
      final = cut.map((p) => {
        const base = layout.systems[p.indices[0]].top + inks[p.indices[0]].top - (upper + p.top);
        return { ...p, systems: p.indices.map((i) => withHidden(layout.systems[i], { top: layout.systems[i].top - base })) };
      });
    }
    // everything is cached now: from here on only the changes the document reports are dirty (a later layout with no change reuses it all)
    if (rec) rec.dirty = { all: false, measures: new Set(), paintAll: false, staffSet: false };
    for (const p of final) {
      pages.push({ number: pages.length + 1, movementIndex, layout: { width: geometry.contentWidth, height: p.height, systems: addSystemDividers(p.systems, dividers, glyphs) } }); // (the dividers of the part: between two systems of the same page)
    }
  });
  // header, footer and title block: now that the number of pages is known
  pages.forEach((p, i) => { p.chrome = chrome.items(i, pages.length, p.movementIndex); });
  return { geometry, pages, warnings };
}
