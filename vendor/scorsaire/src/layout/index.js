/*
 * Mise en page — fonctions pures : Mouvement (modèle) → géométrie. Aucune dépendance au DOM.
 *
 * Toutes les cotes sont en ESPACES DE PORTÉE (1 = interligne) ; le rendu applique la taille en pixels.
 * Repère d'une portée : y vers le HAUT, origine = sa ligne du bas. Repère d'un système : y vers le BAS depuis son haut.
 *
 * Pipeline (décision d'architecture, roadmap §6 et `claude/architecture-moteur-rendu-etape-3.md`) :
 *   1. contexte        — portées à plat + peintre de chacune, éléments de chaque mesure, durée la plus courte
 *   2. colonnes        — chaque instant = une colonne commune à TOUTES les portées et voix (columns.js)
 *   3. systèmes        — retour à la ligne + justification, UNE fois par système pour toutes les portées (systems.js)
 *   4. vertical        — empilement des portées, accolades (vertical.js)
 *   5. dessin          — chaque peintre de portée dessine ses éléments dans ses colonnes (painters/)
 */
import { blockBand } from './blockband.js';
import { resolveStyle, userStyleEpoch, SID, PID, getProperty, fCmp, fAdd, fToNumber, decorId, isDecorHidden, effectiveStaffGap } from '../model/index.js';
import './painters/index.js';
import { buildContext } from './context.js';
import { measureColumns, cloneColumns } from './columns.js';
import { stretchColumns } from './springs.js';
import { breakIntoSystems, endBarType } from './systems.js';
import { stackStaves, spaceSystemStaves, braceItem } from './vertical.js';
import { embedStemsInBeams } from './stemembed.js';
import { markMuted } from './muted.js';
import { crossMinSpace, crossBeamLayout, crossBeamPolygons } from './crossbeam.js';
import { rectsOf, minStackDistance } from './bounds.js';
import { BRACE_W, CLEF_DEFS, SMALL_CLEF_MAG, CLEF_BARLINE_MARGIN } from './constants.js';
import { voltaItems } from './voltas.js';
import { jumpMarkerItems } from './jumps.js';
import { tempoDisplayItems } from './tempodisplay.js';
import { scaleHook } from './scalehook.js';
import { chordOffsetItems } from './chordoffset.js';
import { lyricHoldItems } from './lyrichold.js';
import { automationStrip } from './automationstrip.js';
import { faderOf } from '../model/automation.js';
import { measureNumberItems } from './measurenumbers.js';
import { gridLyricItems, gridLyricsStaves } from './gridlyrics.js';
import { applyPartOverrides, applyStaffOverride } from './partoverrides.js';
import { applyDisplayCategories } from './displaycats.js';
import { applySlashFill } from './slashfill.js';
import { measureNumbers } from '../model/pagetext.js';
import { rehearsalItems } from './rehearsal.js';
import { sectionCardItems } from './sectioncards.js';
import { sectionSegments, sectionOverlays, sectionStripSpaces, startingSegments, highestUnder, chordViewSegments } from './sections.js';
import { chordViewTags } from '../model/chordview.js';
import { buildHeaderVariants } from './headervariants.js';
import { glyphItem, glyphWidth, keySigItems, timeSigItems, timeSigWidth, effectiveTimeSigStyle } from './header.js';
import { barlineItems } from './barlines.js';

/** Width of the zones (cells above / between the systems of a printed part). With a grid of measures every line ends on its own last column, so a short line would give a short zone: they all take the width of the WIDEST line. */
const zoneWidthOf = (systems, own) => (systems.some((x) => x.grid) ? Math.max(own, ...systems.map((x) => x.width)) : own);
const CHORD_START_BAR_GAP = 0.25; // chord staff: the opening bar sits this far before the first column
const CHORD_START_TS_GAP = 0.5; // … and the time signature this far before that bar
import { makeXMap, scaleStaffItem, scaleItem } from './scaling.js';
import { mergeComposites } from './compositestaff.js';
import { barlinesConnect } from '../model/groupedit.js';
import { groupBracketPlan, groupBracketItems, barlineConnectorItems, trackBraceWidth } from './groupbrackets.js';
import { instrumentNamePlan, instrumentNameItems, stickyNameContent } from './instrumentnames.js';
import { translateItem, translateItemInPlace, applyOffsets } from './offsets.js';
import { translateEntries } from './entrygeom.js';
import { relativeKey, snapshotMeasure, restoreMeasure } from './paintcache.js';
import { applyGrips } from './gripoffsets.js';
import { measureBreathItems } from './breaths.js';
import { scaledLayout } from './scaling.js';
import { diagramLayout } from './diagramcontainer.js';
import { symbolDiagramItems } from './symboldiagrams.js';
import { containerItems, slotItems, fragmentSlotItems, fragmentRowItems } from './containers.js';

export { noteY, spellingOf } from './pitchpos.js';
export { CLEF_DEFS } from './constants.js';
export { layoutPart, paginateSystems, createPartCache } from './partlayout.js';
export { layoutDrumLegend, legendSounds } from './drumlegend.js';
export { layoutAccordionLegend } from './accordionlegend.js';
export { registerStaffPainter, staffPainterFor, registeredStaffTypes } from './painters/index.js';

/**
 * @param movement  Movement du modèle
 * @param glyphs    données Bravura (métriques et tracés)
 * @param options.width     largeur disponible pour un système, en espaces (accolade comprise) ; absent : un seul système
 * @param options.getStyle  (sid) → valeur ; par défaut : style du Mouvement puis défaut du Sid
 * @param options.lyricTexts  textes de couplet de l'œuvre (`PID.LYRIC_TEXTS`) : les liens de paroles des portées s'y réfèrent (model/lyrics.js)
 * @param options.chordQualities  dictionnaire de qualités d'accord (`workChordQualities(œuvre)`) pour l'écriture choisie des symboles
 * @returns {{ width, height, systems, warnings }}
 */
export function* layoutMovementSteps(movement, glyphs, { width = Infinity, getStyle, justifyLast = false, bandWidth = null, bandScale = 1, fitBand = false, chordQualities, lyricTexts, preferredVoicings, transpositionTrack, noTranspose, staffFilter, composites = null, plan, verticalPlan, cache = null, localPaint = false, probe = null, automationTracks = null, automationScale = 1, automationParams = null, masterAutomation = null, trackDisplay = null, displaySig = '', lowCards = false, chordViewCards = false } = {}) {
  const style = getStyle ?? ((sid) => resolveStyle(sid, [movement.style]));
  // INCREMENTAL layout (layout/incremental notes in CLAUDE.md): `cache` = { store, dirty }. `store` is filled by this call and given back to the next one;
  // `dirty` (model/dirty.js) says which measures changed since: { all: true } or { all: false, measures: Set }. Only what the parameters and the store allow is
  // reused, everything else is recomputed — a result must always be identical to a full layout (tests/layout-incremental.test.js).
  const useCache = Boolean(cache);
  const store = useCache ? (cache.store ??= {}) : null;
  const timings = store ? (store.timings = {}) : null; let tNow = performance.now();
  const tick = (name) => { if (timings) { const t = performance.now(); timings[name] = Math.round((t - tNow) * 10) / 10; tNow = t; } }; // diagnostic: milliseconds per phase
  const params = { composites, movement, width, justifyLast, getStyle, styleEpoch: userStyleEpoch(), glyphs, transpositionTrack, noTranspose, automationTracks, automationScale, automationParams, masterAutomation, displaySig, lowCards, chordViewCards };
  const sameParams = Boolean(store?.params) && Object.keys(params).every((k) => store.params[k] === params[k]);
  const dirty = sameParams && cache.dirty && !cache.dirty.all ? cache.dirty : null;
  if (store) store.reason = !store.params ? 'cold' : !sameParams ? `params:${Object.keys(params).filter((k) => store.params[k] !== params[k]).join(',')}` : !cache.dirty ? 'no-dirty' : cache.dirty.all ? 'dirty-all' : 'partial'; // diagnostic: why the cache was (not) used (read by the performance probe)
  const isClean = (mi) => !dirty.measures.has(mi);
  const ctx = buildContext(movement, glyphs, style, { chordQualities, lyricTexts, preferredVoicings, transpositionTrack, noTranspose, staffFilter, trackDisplay, composites, reuse: dirty && store.entries ? { entries: store.entries, sig: store.sig, msig: store.msig, trackSigs: store.trackSigs, projections: store.projections, isClean } : null }); // dictionnaire du document : écriture choisie des symboles d'accord (absent : affichage dérivé de l'identifiant)

  // measure numbers (printed parts): the numbering of the movement and the part's overrides; `plan.spaceMm` = staff space of the page
  ctx.memoEntries = useCache; ctx.memoStats = { shapeHits: 0, shapeMisses: 0 }; // the spacing remembers what it computes per entry (layout/columns.js) only when the entries will live on in the cache
  ctx.numbering = style(SID.SHOW_MEASURE_NUMBERS) ? { ...measureNumbers(movement, plan?.numberStart ?? 0), overrides: plan?.numberOverrides ?? new Map() } : null;
  ctx.spaceMm = plan?.spaceMm ?? 1.75;
  for (const sref of ctx.staves) sref.ctx.spaceMm = ctx.spaceMm; // (the painters read the staff space of the page too: texts sized in points)
  ctx.printed = !!plan;
  ctx.chordViewCards = chordViewCards; // screen 1: a small card above the measure where a display tag of the chord staff starts
  ctx.lowCards = lowCards; // the name cards of the interface sit as low as possible (readers and sheets: the cards do not slide; screen 1 pins them to the left edge, so it keeps them above everything)
  ctx.autoMaster = masterAutomation; // { label, volume } when the master volume strip is shown above the top staff (screen only), else null
  ctx.autoParams = automationParams; // trackId → the lanes its strips show (['volume'], ['pan'] or ['volume', 'pan']), a Map or null
  ctx.autoScale = automationScale; // height factor of the automation strips (screen option)
  ctx.autoTracks = automationTracks; // ids of the tracks whose automation strip is shown (screen only, a Set or null)
  ctx.localPaint = localPaint; // PROBE (incremental layout, step 0): paint each measure in coordinates local to the measure, then translate
  ctx.probe = probe;
  ctx.textStyles = plan?.textStyles ?? {};
  tick('context');
  const hasBrace = ctx.staves.some((s) => s.indexInTrack > 0);
  const groupPlan = groupBracketPlan(ctx, style, glyphs);
  // room left of the staves: the track braces, then the group brackets outside them (same extra margin as the brace alone)
  const bracketsRoom = groupPlan.groups.length ? Math.max(hasBrace ? BRACE_W : 0, groupPlan.total + (hasBrace ? BRACE_W - trackBraceWidth(glyphs, style) : 0.1)) : (hasBrace ? BRACE_W : 0);
  const namePlan = instrumentNamePlan(ctx, style, glyphs); // names / icons left of the brackets
  const x0 = bracketsRoom + (namePlan ? namePlan.room : 0);
  // nested scores of the slots between measures: a FRAGMENT (a short movement) is laid out on its own, in one system, never stretched
  const fragmentLayouts = new Map();
  const fragmentLayout = (c) => {
    if (!fragmentLayouts.has(c.id)) {
      const showTs = !!getProperty(c, PID.CONTAINER_SHOW_TIMESIG);
      const showKs = !!getProperty(c, PID.CONTAINER_SHOW_KEYSIG);
      const inner = (sid) => (sid === SID.HEADER_SHOW_TIMESIG ? showTs : sid === SID.HEADER_SHOW_KEYSIG ? showKs : sid === SID.END_BAR_FINAL || sid === SID.ENABLE_INDENTATION_ON_FIRST_SYSTEM || sid === SID.SHOW_INSTRUMENT_NAMES ? false : style(sid));
      fragmentLayouts.set(c.id, scaledLayout(layoutMovement(c.fragments[0], glyphs, { width: Infinity, getStyle: inner, chordQualities, lyricTexts, preferredVoicings }), getProperty(c, PID.CONTAINER_SCALE) ?? 1));
    }
    return fragmentLayouts.get(c.id);
  };
  // FREE nested score of a stacked container: laid out alone, spread over `width` (the room of the container). Too dense: the spacing is tightened
  // step by step; still too wide: it overflows (`overflow` true). Follows the transposition of the staff that hosts it unless told otherwise.
  const freeLayouts = new Map();
  ctx.freeFragmentLayout = (c, width) => {
    const scaleMode = getProperty(c, PID.SCALE_RECIPE) ? style(SID.READER_SCALE) : 'stored'; // a SCALE container: what a reader asks (the instrument of the track decides the rest)
    const key = `${c.id}|${Math.round(width * 100)}|${scaleMode}`;
    if (freeLayouts.has(key)) return freeLayouts.get(key);
    const showTs = !!getProperty(c, PID.CONTAINER_SHOW_TIMESIG);
    const showKs = !!getProperty(c, PID.CONTAINER_SHOW_KEYSIG);
    const host = ctx.staves.find((s) => (s.staff.containers ?? []).includes(c));
    const follow = getProperty(c, PID.CONTAINER_TRANSPOSE_FOLLOW) !== false;
    const hostTrack = host?.track;
    const fragment = (scaleMode !== 'stored' && scaleHook()?.(c, getProperty(c, PID.SCALE_RECIPE), hostTrack, scaleMode)) || c.fragments[0];
    const make = (spacing, w) => layoutMovement(fragment, glyphs, {
      width: w, justifyLast: w !== Infinity, chordQualities, lyricTexts, preferredVoicings, transpositionTrack: follow ? host?.track : null, noTranspose: !follow,
      getStyle: (sid) => (sid === SID.HEADER_SHOW_TIMESIG ? showTs : sid === SID.HEADER_SHOW_KEYSIG ? showKs : sid === SID.MEASURE_SPACING && spacing ? spacing
        : sid === SID.END_BAR_FINAL || sid === SID.ENABLE_INDENTATION_ON_FIRST_SYSTEM || sid === SID.SHOW_INSTRUMENT_NAMES ? false : style(sid)),
    });
    const k = getProperty(c, PID.CONTAINER_SCALE) ?? 1; // the score is laid out at full size in `width / k`, then reduced
    const room = width / k;
    let result = null;
    let narrowest = null;
    for (const spacing of [null, 1.3, 1.15, 1.0, 0.9, 0.8]) {
      const natural = make(spacing, Infinity);
      narrowest = natural;
      if (natural.width <= room) { result = { layout: scaledLayout(make(spacing, room), k), overflow: false }; break; }
    }
    if (!result) result = { layout: scaledLayout(narrowest, k), overflow: true };
    freeLayouts.set(key, result);
    return result;
  };
  ctx.slots.fragmentWidth = (c) => fragmentLayout(c).width;
  ctx.slots.diagramWidth = (c) => diagramLayout(ctx, c)?.width ?? 0;
  ctx.fragmentLayout = fragmentLayout;
  // columns of each measure: those of an untouched measure are the previous layout's (a pristine copy is kept per measure, the system breaking squeezes and the
  // painters write onto what they get)
  const reuseColumns = Boolean(dirty) && ctx.reused && ctx.sameStaves && Boolean(store.columns) && store.columns.length === movement.masterbars.length && !ctx.spacingStaves; // (the columns of a measure depend on EVERY shown staff)
  const pristine = [];
  const allColumns = [];
  for (let mi = 0; mi < movement.masterbars.length; mi++) {
    if (reuseColumns && isClean(mi)) { pristine[mi] = store.columns[mi]; allColumns.push(cloneColumns(store.columns[mi])); continue; }
    const cols = measureColumns(ctx, mi);
    if (useCache) pristine[mi] = cloneColumns(cols);
    allColumns.push(cols);
    yield 'columns'; // a driver may give the main thread back here (see `layoutMovement`)
  }
  // painting cache: per (staff, measure), reused for the measures that nothing touched (the entries and columns above are reused under the same condition)
  const cacheableCtx = !ctx.spacingStaves && !ctx.staves.some((s) => (s.staff.containers ?? []).length);
  ctx.paintCache = useCache && cacheableCtx ? { prev: dirty && store.paint ? store.paint : new Map(), next: new Map(), clean: (mi) => Boolean(dirty) && isClean(mi), reused: 0, painted: 0 } : null;
  if (useCache) {
    const cacheable = cacheableCtx;
    store.params = params; store.sig = ctx.sig;
    store.entries = cacheable ? ctx.entriesById : null; store.msig = ctx.msig; store.trackSigs = ctx.trackSigs; store.projections = ctx.projections; store.columns = cacheable ? pristine : null;
    store.stats = { entriesReused: ctx.reused, paintReused: 0, columnsReused: reuseColumns ? pristine.filter((_, mi) => isClean(mi)).length : 0, memo: ctx.memoStats }; // (read by the tests)
    cache.dirty = null; // consumed: the caller accumulates new changes from now on
  }
  // indentation of the first system (MuseScore `enableIndentationOnFirstSystem`): its margin is the larger of the track names and the indentation
  const indent = style(SID.ENABLE_INDENTATION_ON_FIRST_SYSTEM) ? Math.max(0, style(SID.FIRST_SYSTEM_INDENTATION_VALUE) - (namePlan ? namePlan.room : 0)) : 0;
  tick('columns');
  const systems = breakIntoSystems(ctx, allColumns, width - x0, justifyLast, indent, plan);
  tick('break');
  const vertical = stackStaves(ctx);
  ctx.systemFirsts = new Set(systems.map((sy) => sy.first));

  const collected = systems.map(() => []); // par système, par portée : éléments placés (marquages qui traversent les systèmes)
  const out = [];
  for (let index = 0; index < systems.length; index++) {
    const sys = systems[index];
    const sx0 = index === 0 ? x0 + indent : x0;
    const built = yield* paintSystem(ctx, sys, allColumns, vertical, sx0, collected[index]);
    out.push({ index, first: sys.first, last: sys.last, top: 0, height: vertical.height, x0: sx0, width: sys.width, stretch: sys.stretch, natural: sys.natural, ...(sys.pageBreak ? { pageBreak: true } : {}), ...(sys.grid ? { gridColumns: sys.grid.columns } : {}), ...built });
    yield 'paint';
  }

  tick('paint');
  if (ctx.paintCache) { store.paint = ctx.paintCache.next; store.stats.paintReused = ctx.paintCache.reused; store.stats.painted = ctx.paintCache.painted; } else if (store) store.paint = null;
  // x ranges (system coordinates) of the containers between measures: the view must not read a click there as a position in the music
  out.forEach((o, k) => Object.defineProperty(o, 'slotRanges', {
    value: systems[k].measures.flatMap((m) => [...m.slotsBefore, ...m.slotsAfter]).map((sl) => [sl.x, sl.x + sl.width]),
    enumerable: false,
  }));

  out.forEach((o) => { if (o.automation) Object.defineProperty(o, 'automation', { value: o.automation, enumerable: false, writable: true, configurable: true }); }); // geometry of the automation strips (the view reads it)

  // x d'un instant par portée : propriété NON ÉNUMÉRABLE du système (la vue s'en sert pour placer les cases de saisie d'accord ; invisible
  // pour l'empreinte JSON de la mise en page)
  out.forEach((o, k) => Object.defineProperty(o, 'xAt', { value: collected[k].find((c) => c)?.xAt ?? null, enumerable: false }));

  // marquages à cheval sur plusieurs systèmes (glissandos) : besoin de la position des deux bouts, donc après tous les systèmes
  ctx.staves.forEach((sref, si) => {
    if (!sref.painter.paintSpanners) return;
    const perSystem = systems.map((sys, k) => ({ sys, placed: collected[k][si]?.placed ?? [], headerRight: collected[k][si]?.headerRight ?? 0, xAt: collected[k][si]?.xAt }));
    const extra = sref.painter.paintSpanners(perSystem, sref.staff, ctx.movement, sref.ctx, out.map((o) => o.staves[si].items));
    extra.forEach((list, k) => { if (list && list.length) out[k].staves[si].items.push(...list); });
  });

  // size of single staves in % (`trackDisplay.sizePct`): shrunk once everything of the staff is drawn (layout/scaling.js)
  if (ctx.staves.some((s) => s.ctx.sizeScale)) {
    out.forEach((o, k) => ctx.staves.forEach((sref, si) => {
      const scale = sref.ctx.sizeScale; if (!scale) return;
      const col = collected[k][si];
      const fx = makeXMap(scale, (col?.placed ?? []).map((p) => p.x), col?.headerRight ?? 0);
      o.staves[si].items = o.staves[si].items.map((it) => scaleStaffItem(it, scale, fx));
    }));
  }
  // a source staff of a composite squeezed / stretched vertically only (`equal`): the gap between its lines changes, sizes and x positions stay
  if (ctx.staves.some((s) => s.ctx.sizeVertical)) {
    out.forEach((o) => ctx.staves.forEach((sref, si) => {
      const r = sref.ctx.sizeVertical; if (!r) return;
      o.staves[si].items = o.staves[si].items.map((it) => scaleItem(it, 1, r, 1));
    }));
  }
  mergeComposites({ out, ctx, systems }); // composite staves: the carrier takes the measures of the other sources (the lines have just been scaled)
  tick('spanners');
  // poignées utilisateur des liaisons et soufflets (grips) : sur la forme automatique, avant le déplacement d'ensemble
  applyGrips(out, movement);

  // déplacements manuels (PID.OFFSETS) : appliqués avant l'empilement des portées, pour que l'élément déplacé les écarte au besoin
  const offsets = getProperty(movement, PID.OFFSETS);
  if (offsets && Object.keys(offsets).length) for (const sys of out) for (const st of sys.staves) st.items = applyOffsets(st.items, offsets);
  // overrides of the printed part (screen 2): colour, position, visibility of single elements, on top of the movement's offsets
  if (plan?.overrides && Object.keys(plan.overrides).length) {
    const staffIds = new Set(ctx.staves.map((r) => r.staff.id)); // a staff is moved, coloured or hidden as a whole after the stacking (see below)
    const chordsOf = new Map(); // staff id -> Map(chordId -> note ids): a chord whose notes are all hidden / coloured the same hides / colours its stem, beam, dots…
    for (const r of ctx.staves) {
      const m = new Map();
      for (const v of r.staff.voices) for (const me of v.measures) for (const it of me?.items ?? []) if (it.type === 'chord') m.set(it.id, it.notes.map((n) => n.id));
      chordsOf.set(r.staff.id, m);
    }
    for (const sys of out) for (const st of sys.staves) st.items = applyPartOverrides(st.items, plan.overrides, staffIds, chordsOf.get(st.ref));
  }

  // a printed part shows the containers of screen 1 as READ ONLY: a small amber corner at the top right of their frame (screen only, never printed)
  if (ctx.printed) {
    for (const o of out) for (const st of o.staves) {
      const owned = (ctx.staves.find((r) => r.staff.id === st.ref)?.staff.containers ?? []).filter((c) => getProperty(c, PID.CONTAINER_STAFF_ID) == null);
      for (const c of owned) {
        const frame = st.items.filter((it) => it.role === 'container-frame' && it.ref === c.id && it.kind === 'line');
        if (!frame.length) continue;
        const x2 = Math.max(...frame.flatMap((l) => [l.x1, l.x2])); const top = Math.max(...frame.flatMap((l) => [l.y1, l.y2]));
        const mk = (xa, ya, xb, yb) => ({ kind: 'line', role: 'container-readonly', x1: xa, y1: ya, x2: xb, y2: yb, width: 0.3, color: '#b26a00', ref: c.id });
        st.items.push(mk(x2 - 1.5, top, x2, top), mk(x2, top, x2, top - 1.5));
      }
    }
  }
  tick('offsets');
  // the nested scores of the zones and of the slots between measures are placed once the stacking is known, after the overrides above: they get the colour
  // and the visibility of the part too (a rest switched off for ONE part, inside a container that only that part has); never a position (set below)
  const looks = {};
  for (const [k, o] of Object.entries(plan?.overrides ?? {})) if (o?.hidden || o?.color) looks[k] = { ...(o.hidden ? { hidden: true } : {}), ...(o.color ? { color: o.color } : {}) };
  const withLooks = (list) => (Object.keys(looks).length ? applyPartOverrides(list, looks, null, null) : list);
  // empilement vertical DÉFINITIF (tout est dessiné) : portées écartées si leurs éléments se touchent, puis systèmes
  const clr = style(SID.MIN_VERTICAL_DISTANCE);
  const hClr = style(SID.SKYLINE_MIN_HORIZONTAL_CLEARANCE);
  let top = 0;
  let previous = null; // { lastOrigin (absolu), lastRects, bottom }
  for (const sys of out) {
    yield 'vertical';
    const rects = sys.staves.map((st) => rectsOf(st.items, glyphs));
    const crossRecs = collected[sys.index].crossBeams ?? [];
    const vp = verticalPlan?.systems?.[sys.index]; // printed page: extra space decided by the vertical spread (layout/pagespread.js)
    // extra room between the staves of a printed part: one general gap, and the room above particular staves (model/partzones.js)
    const gapPlan = plan?.staffGap || plan?.staffGaps ? sys.staves.map((st, i) => (i > 0 ? (plan.staffGap ?? 0) + effectiveStaffGap(plan.staffGaps, st.ref, sys.measures.map((m) => m.ref)) : 0) + (vp?.staffGaps?.[i] ?? 0)) : vp?.staffGaps;
    const spaced = spaceSystemStaves(ctx, vertical, rects, crossMinDistances(crossRecs, vertical), gapPlan);
    let t = previous ? previous.top + previous.height : 0;
    if (previous && spaced.staves.length) {
      const need = minStackDistance(previous.lastRects, rects[0], hClr);
      if (Number.isFinite(need)) t = Math.max(t, previous.top + previous.lastOrigin + need + clr - spaced.staves[0].originY);
    }
    if (vp?.before) t += vp.before;
    // printed part: room above the FIRST staff = room to the previous system (the general gap counts too when the system has one staff)
    if (previous && plan && (plan.staffGap || plan.staffGaps)) t += (sys.staves.length === 1 ? (plan.staffGap ?? 0) : 0) + effectiveStaffGap(plan.staffGaps, sys.staves[0]?.ref, sys.measures.map((m) => m.ref));
    // nested scores in slots: centred on the staves of the system (option B); the system grows when the block is taller
    const blocks = [];
    for (const m of systems[sys.index].measures) {
      for (const sl of [...m.slotsBefore, ...m.slotsAfter]) {
        for (const e of sl.entries) if (e.container.fragments?.length && getProperty(e.container, PID.CONTAINER_ALIGN) !== 'row') blocks.push({ slot: sl, container: e.container, staffIndex: e.staffIndex, inner: fragmentLayout(e.container) });
      }
    }
    let blockCenter = null;
    if (blocks.length && spaced.staves.length) {
      const lastStaff = spaced.staves[spaced.staves.length - 1];
      let center = (spaced.staves[0].top + lastStaff.originY) / 2;
      const half = Math.max(...blocks.map((b) => (b.inner.systems[0]?.height ?? 0) / 2 + 0.8));
      const up = half - center;
      if (up > 0) { for (const st of spaced.staves) { st.originY += up; st.top += up; } spaced.height += up; center += up; }
      if (center + half > spaced.height) spaced.height = center + half;
      blockCenter = center;
    }
    // the band of blocks of the movement (free texts), above the first system: the staves move down by its height; its items are overlays of the system
    let band = null; // as wide as the line asked for (a short last line must not make it narrower)
    if (sys.index === 0) {
      band = blockBand(movement, { scale: bandScale, fit: fitBand && spaced.staves.length === 0, fitOverride: getProperty(movement, PID.BLOCK_FIT), left: -sys.x0, width: bandWidth ?? (Number.isFinite(width) && width < 50000 ? width : sys.x0 + sys.width) });
      if (band) {
        for (const st of spaced.staves) { st.originY += band.height; st.top += band.height; }
        spaced.height += band.height;
        if (blockCenter !== null) blockCenter += band.height;
      }
    }
    // zone above the first system of the movement (printed part): the staves move down by its height, its cells are drawn in the first staff
    let zoneBefore = null;
    if (sys.index === 0 && plan?.zoneBefore && spaced.staves.length) {
      zoneBefore = plan.zoneBefore(systems[0].first, zoneWidthOf(systems, sys.width), ctx.style(SID.SHOW_SYSTEM_OBJECTS) !== false ? sectionSegments(movement, systems[0]) : [], systems[0].last);
      if (zoneBefore) {
        for (const st of spaced.staves) { st.originY += zoneBefore.height; st.top += zoneBefore.height; }
        spaced.height += zoneBefore.height;
        if (blockCenter !== null) blockCenter += zoneBefore.height;
      }
    }
    top = t;
    sys.top = t;
    sys.height = spaced.height;
    sys.staves.forEach((st, si) => {
      st.originY = spaced.staves[si].originY;
      Object.defineProperty(st, 'top', { value: spaced.staves[si].top, enumerable: false, writable: true }); // y of the top line (system coordinates, y down): the vertical spread of a printed page measures the gaps from it
    });
    placeCrossBeams(sys, crossRecs, vertical, spaced, style);
    if (zoneBefore) {
      sys.staves[0].items.push(...withLooks(zoneBefore.place(spaced.staves[0].originY, band?.height ?? 0))); // (the zone sits under the band)
      Object.defineProperty(sys, 'zoneBefore', { value: { height: zoneBefore.height }, enumerable: false, configurable: true });
    }
    for (const b of blocks) sys.staves[b.staffIndex].items.push(...withLooks(fragmentSlotItems({ ctx, ...b, anchorOrigin: spaced.staves[b.staffIndex].originY, center: blockCenter })));
    const segs = ctx.style(SID.SHOW_SYSTEM_OBJECTS) !== false ? sectionSegments(movement, systems[sys.index]) : [];
    Object.defineProperty(sys, 'sections', { value: segs, enumerable: false, configurable: true });
    // the strip of the name cards: y (system coordinates, down) of its top and its height; and the width of the header (clef, key, time signature)
    // (one room per card when they sit as low as possible: `cards` gives the y of each, `y` is the highest)
    const spaces = sys.staves[0]?.items.filter((it) => it.role === 'section-space') ?? [];
    const yOf = (it) => spaced.staves[0].originY - (it.y + it.h);
    Object.defineProperty(sys, 'sectionStrip', { value: spaces.length && spaced.staves.length ? { y: Math.min(...spaces.map(yOf)), h: spaces[0].h, cards: spaces.filter((it) => it.ref).map((it) => ({ id: it.ref, y: yOf(it), x: it.x })), ...(ctx.lowCards ? { scale: ctx.style(SID.SECTION_CARD_SCALE), style: ctx.style(SID.SECTION_CARD_STYLE) } : {}) } : null, enumerable: false, configurable: true });
    // the track names written left of the staves (their room, and what the sticky header writes under the metre instead of them)
    Object.defineProperty(sys, 'stickyNames', { value: namePlan ? { room: namePlan.room, entries: namePlan.entries.map((e) => ({ first: e.first, last: e.last, content: stickyNameContent(e, glyphs) })) } : null, enumerable: false, configurable: true });
    Object.defineProperty(sys, 'headerVariants', { value: buildHeaderVariants(ctx, systems[sys.index], allColumns), enumerable: false, configurable: true });
    const hd = systems[sys.index].header;
    Object.defineProperty(sys, 'headerWidth', { value: hd ? hd.leftPad + hd.lettersW + hd.clefW + hd.ksW + hd.tsW + 0.8 : 0, enumerable: false, configurable: true });
    let sectionBands = [];
    if (segs.length && spaced.staves.length && ctx.style(SID.SECTION_COLORS_SHOW) !== false && (!plan || ctx.style(SID.PART_SECTION_BANDS))) {
      const highest = rects[0].length ? Math.max(...rects[0].map((r) => r.y2)) : 4;
      const lowest = rects[rects.length - 1].length ? Math.min(...rects[rects.length - 1].map((r) => r.y1)) : 0;
      sectionBands = sectionOverlays(segs, { topY: spaced.staves[0].originY - highest - 0.1, bottomY: spaced.staves[spaced.staves.length - 1].originY - lowest + 0.3, strength: ctx.style(SID.SECTION_COLOR_STRENGTH) });
    }
    sys.overlays = [
      ...sectionBands,
      ...trackBraces(ctx, spaced),
      ...groupBracketItems(groupPlan, spaced, style, glyphs),
      ...barlineConnectorItems({ ctx, sys: systems[sys.index], spaced, style, glyphs }),
      ...(namePlan ? instrumentNameItems(namePlan, { systemIndex: sys.index, spaced, rightEdge: -(bracketsRoom + namePlan.offset) }) : []),
    ];
    if (band) { sys.overlays.push(...band.items); Object.defineProperty(sys, 'band', { value: { ...band.box, left: band.box.x }, enumerable: false, configurable: true }); }
    // zone reserved under this system (printed part): the systems below move down, its cells are drawn in the last staff of this system
    const zone = plan?.zoneAfter && spaced.staves.length ? plan.zoneAfter(systems[sys.index].last, zoneWidthOf(systems, sys.width), segs, systems[sys.index].first) : null;
    if (zone) {
      const lastSt = sys.staves[sys.staves.length - 1];
      lastSt.items.push(...withLooks(zone.place(lastSt.originY, spaced.height)));
      Object.defineProperty(sys, 'zoneAfter', { value: { height: zone.height }, enumerable: false, configurable: true });
    }
    previous = { top: t, height: spaced.height + (zone ? zone.height : 0), lastOrigin: spaced.staves.length ? spaced.staves[spaced.staves.length - 1].originY : 0, lastRects: rects[rects.length - 1] ?? [] };
  }
  if (previous) top = previous.top + previous.height;
  // staves of a printed part moved, coloured or hidden by hand: the whole staff (its lines, its music and its marks) follows; braces and barlines that link staves stay
  if (plan?.overrides) for (const sys of out) for (const st of sys.staves) applyStaffOverride(st, plan.overrides[st.ref]);
  tick('vertical');
  for (const sys of out) for (const st of sys.staves) embedStemsInBeams(st.items); // hampes ligaturées enfoncées dans la barre (rendu)
  markMuted(out, movement); // notes whose play is off: drawn in grey in the editor, not drawn elsewhere
  // what the track's menu « Affichage » hides or recolours (lines, clefs, notes, rests, dynamics…): removed / tinted LAST, so nothing else moves
  ctx.staves.forEach((sref, si) => {
    const spec = sref.ctx.displaySpec; if (!spec) return;
    const autos = new Set();
    for (const v of sref.staff.voices) for (const m of v.measures) for (const it of m?.items ?? []) if (it.type === 'rest' && getProperty(it, PID.EXPLICIT) !== true) autos.add(it.id);
    // slashes: the measures of this staff the user chose to show as one slash per beat (ranges are by measure id)
    let shown = null;
    if (spec.slashes) {
      const ids = ctx.movement.masterbars.map((b) => b.id);
      shown = new Set();
      for (const r of spec.slashes) {
        if (r.staff !== sref.staff.id) continue;
        const a = ids.indexOf(r.from); const b = ids.indexOf(r.to);
        if (a >= 0 && b >= 0) for (let mi = Math.min(a, b); mi <= Math.max(a, b); mi++) shown.add(mi);
      }
      if (!shown.size) shown = null;
    }
    for (const sys of out) {
      const st = sys.staves[si]; if (!st) continue;
      let items = shown ? applySlashFill(st.items, sys.measures, shown, ctx.barLengths, glyphs, (id) => autos.has(id), { chordStaff: sref.type === 'chord' }) : st.items;
      st.items = applyDisplayCategories(items, spec, (id) => autos.has(id));
    }
  });
  tick('embed');

  // a band of blocks is as wide as the screen asked: the drawing is at least that wide (a movement with no staff has almost no width of its own)
  const contentWidth = out.reduce((w, s) => Math.max(w, s.x0 + s.width, s.band?.w ?? 0), 0);
  const layout = { width: contentWidth, height: top, systems: out, warnings: ctx.warnings };
  // what the vertical spread of a page needs to know about every staff (brace / bracket boundaries): NOT enumerable, so layouts keep their JSON shape
  Object.defineProperty(layout, 'staffMeta', { value: staffMeta(ctx, groupPlan), enumerable: false });
  return layout;
}

/** The whole layout in one go: the same steps as `layoutMovementSteps`, run to the end without pausing. */
export function layoutMovement(movement, glyphs, options) {
  const steps = layoutMovementSteps(movement, glyphs, options);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Per staff: { braceStart, braceInside, bracketBoundary } (MuseScore `distributeStaves`: gaps around brackets and inside braces spread differently). */
function staffMeta(ctx, groupPlan) {
  const st = ctx.staves;
  const brackets = groupPlan.groups.filter((g) => g.kind !== 'brace');
  return st.map((s, i) => {
    const prev = st[i - 1];
    const sameTrackAsPrev = Boolean(prev) && prev.track === s.track;
    const multi = (x) => st.filter((o) => o.track === x.track).length > 1;
    return {
      braceInside: sameTrackAsPrev,
      braceStart: !sameTrackAsPrev && (multi(s) || (Boolean(prev) && multi(prev))),
      bracketBoundary: brackets.some((g) => i === g.first || i === g.last + 1),
    };
  });
}

/**
 * Distance minimale entre les ORIGINES de deux portées voisines imposée par les ligatures croisées (`minVertSpaceForCrossStaffBeams` :
 * distance entre les lignes du HAUT des deux portées ≥ `minSpace`) ; tableau indexé par rang de portée (le rang i = distance à la portée i − 1).
 */
function crossMinDistances(records, vertical) {
  const out = [];
  const topOf = (si) => (vertical.staves[si].lines.length ? Math.max(...vertical.staves[si].lines.map((l) => l.y)) : 4);
  for (const rec of records) {
    if (rec.upper == null || rec.lower == null || rec.lower !== rec.upper + 1) continue;
    const { minSpace, limitingAbove } = crossMinSpace(rec.members, { beamUp: rec.beamUp });
    if (limitingAbove === null || !Number.isFinite(minSpace)) continue;
    const need = minSpace + topOf(rec.lower) - topOf(rec.upper); // top_L − top_U : lignes y vers le haut depuis la ligne du bas de chacune
    out[rec.lower] = Math.max(out[rec.lower] ?? -Infinity, need);
  }
  return out;
}

/**
 * Second passage (`SystemLayout::updateCrossBeams`) : la distance entre les portées est connue ; chaque ligature croisée est disposée,
 * son dessin ajouté à la portée du HAUT et les hampes de ses accords raccourcies / rallongées jusqu'à la ligature.
 * Repère commun de crossbeam.js : y vers le bas, 0 = ligne du haut de la portée du haut.
 */
function placeCrossBeams(sys, records, vertical, spaced, style) {
  const topOf = (si) => (vertical.staves[si].lines.length ? Math.max(...vertical.staves[si].lines.map((l) => l.y)) : 4);
  for (const rec of records) {
    if (rec.upper == null || rec.lower == null || rec.lower !== rec.upper + 1) continue;
    const topLineU = spaced.staves[rec.upper].originY - topOf(rec.upper); // y système (vers le bas) de la ligne du haut de chaque portée
    const topLineL = spaced.staves[rec.lower].originY - topOf(rec.lower);
    const D = topLineL - topLineU;
    const beamWidth = style(SID.BEAM_THICKNESS);
    const res = crossBeamLayout(rec.members, D, { stemWidth: style(SID.STEM_THICKNESS), beamWidth });
    const toUpperUp = (c) => topOf(rec.upper) - c; // repère commun → repère de la portée du haut (y vers le haut depuis sa ligne du bas)
    const toLowerUp = (c) => topOf(rec.lower) - (c - D);
    for (const pts of crossBeamPolygons(res.segs, beamWidth)) {
      sys.staves[rec.upper].items.push({ kind: 'polygon', role: 'beam', points: pts.map(([x, y]) => [x, toUpperUp(y)]), ref: rec.id });
    }
    rec.members.forEach((m, k) => {
      if (m.rest || !res.stemEnds.has(k)) return;
      const stem = sys.staves[m.staffIndex].items.find((it) => it.role === 'stem' && it.ref === m.id && !it.grace);
      if (!stem) return;
      const c = res.stemEnds.get(k);
      stem.y2 = m.staffIndex === rec.lower ? toLowerUp(c) : toUpperUp(c);
    });
  }
}

function* paintSystem(ctx, sys, allColumns, vertical, x0, collect) {
  const { glyphs, style } = ctx;
  const barIds = ctx.movement.masterbars.map((b) => b.id);
  /** Éléments de décor : `sel` (identifiant de sélection) et, si masqué sur cette portée, `hidden` (jamais montré à l'export, gris si on affiche les masqués). */
  const decor = (list, staff, kind, mi) => {
    const hidden = isDecorHidden(staff, kind, barIds[mi]);
    const sel = decorId(staff.id, kind, barIds[mi]);
    return list.map((it) => ({ ...it, ref: it.ref ?? staff.id, sel, ...(hidden ? { hidden: true } : {}) }));
  };
  const colMap = new Map(); // mi → { positions, origins } : x de chaque colonne (éléments de la piste système : tempos, lignes rit.)
  // What does not depend on the staff, computed ONCE per measure (it was recomputed for every staff: with many staves the loops over the entries of all
  // the staves of every column were the main own cost of this function): final column widths (springs), x of each column, the entries placed per staff.
  const slotRanges = sys.measures.flatMap((m) => [...m.slotsBefore, ...m.slotsAfter]).map((sl) => [sl.x, sl.x + sl.width]).sort((p, q) => p[0] - q[0]);
  const measureInfo = new Map();
  for (const m of sys.measures) {
    const widths = stretchColumns(allColumns[m.mi], m.content);
    const origins = []; // x de l'origine de chaque colonne (les respirations s'y collent)
    const perStaff = ctx.staves.map(() => []);
    let colX = m.start;
    for (const col of allColumns[m.mi]) {
      const w = widths.get(col);
      const ratio = col.width > 0 ? w / col.width : 1; // même proportion lead/espace qu'à l'état naturel
      origins.push(colX + col.lead * ratio);
      for (const entry of col.entries) perStaff[entry.staffIndex]?.push({ entry, x: colX + col.lead * ratio + (entry.vx ? entry.vx.moveX : 0), mi: m.mi }); // `vx.moveX` : décalage de voix (unisson, seconde)
      colX += w;
    }
    colMap.set(m.mi, { positions: allColumns[m.mi].map((c) => c.position), origins });
    measureInfo.set(m.mi, { origins, perStaff });
  }
  const crossOut = []; // dessin d'accords relocalisés (portées croisées), à verser dans leur portée cible
  const paintStaff = (sref, si) => {
    const placement = vertical.staves[si];
    const { painter, staff } = sref;
    const items = [];
    const systemPlaced = []; // { entry, x, mi } accumulé sur TOUT le système (marquages en plage : soufflets, tranche 3)

    // lignes de portée (interrompues dans les conteneurs intercalés : l'espace est vide sur toutes les portées)
    for (const line of placement.lines) {
      let from = 0;
      for (const [sx1, sx2] of [...slotRanges, [sys.width, sys.width]]) {
        if (sx1 > from + 1e-6) items.push({ kind: 'line', role: 'staff-line', x1: from, x2: sx1, y1: line.y, y2: line.y, width: line.thickness, ref: staff.id });
        from = Math.max(from, sx2);
      }
    }

    // en-tête : clé, armure, chiffrage (mêmes x sur toutes les portées)
    const h = sys.header;
    const letters = h.lettersW > 0 && painter.stringLetters ? painter.stringLetters(staff, sref.ctx, { barline: ctx.staves.length > 1 && Boolean(style(SID.START_BARLINE_MULTIPLE)) }) : null;
    if (letters) items.push(...letters.items(h.leftPad));
    const clef = painter.clef(staff, sref.ctx, sys.first);
    if (clef) items.push(...decor(clef.items ? clef.items(h.leftPad + h.lettersW, staff.id) : [glyphItem(clef.glyph, h.leftPad + h.lettersW, clef.y, { mag: clef.mag ?? 1, ref: staff.id })], staff, 'clef', sys.first));
    const ks = painter.keySig(staff, sref.ctx, sys.first);
    // une armure/un chiffrage masqués sur TOUTES les portées ne prennent plus de place (ksW/tsW = 0) mais restent dessinés (gris) à leur place
    const ksHere = ks && (h.ksW > 0 || isDecorHidden(staff, 'keySig', barIds[sys.first]));
    if (ksHere) items.push(...decor(keySigItems(glyphs, h.leftPad + h.lettersW + h.clefW, ks.clefKey, h.ksByStaff[si], h.ksByStaff[si]), staff, 'keySig', sys.first));
    const ts = painter.timeSig(staff, sref.ctx);
    if (ts && (h.tsW > 0 || (h.showTs && isDecorHidden(staff, 'timeSig', barIds[sys.first])))) items.push(...decor(timeSigItems(glyphs, h.leftPad + h.lettersW + h.clefW + h.ksW, h.ts, ts.yNum, ts.yDen, h.tsStyle), staff, 'timeSig', sys.first));

    // bord droit VISIBLE de l'en-tête (dernier glyphe de clé/armure/chiffrage de cette portée) : début des lignes d'accroche (glissandos)
    const headerRight = Math.max(0, ...items.filter((i) => i.kind === 'glyph').map((i) => i.x + glyphs.glyphs[i.name].bbox.bBoxNE[0] * (i.mag ?? 1)));

    // mesures : éléments dans leurs colonnes, puis barre de fin
    const half = style(SID.STAFF_LINE_THICKNESS) / 2;
    const ys = placement.lines.map((l) => l.y);
    // portée sans lignes mais avec barres (portée d'accords) : étendue fournie par le peintre
    const span = !ys.length && painter.barSpan ? painter.barSpan(staff, sref.ctx) : null;
    const hasBars = !sref.ctx.hideBars && (ys.length > 0 || Boolean(span));
    const bottom = (span ? span.lo : ys.length ? Math.min(...ys) : 0) - half;
    const topBar = (span ? span.hi : ys.length ? Math.max(...ys) : 0) + half;
    // display size of the chord staff (track size in %): its time signature digits shrink with it, around their left edge
    const chordK = sref.type === 'chord' && sref.ctx.style ? (sref.ctx.style(SID.CHORD_BAR_HEIGHT) / ctx.style(SID.CHORD_BAR_HEIGHT)) || 1 : 1;
    const shrinkTs = (list, ax) => (chordK === 1 ? list : list.map((it) => (it.kind === 'glyph' ? { ...it, x: ax + (it.x - ax) * chordK, mag: (it.mag ?? 1) * chordK } : it)));
    // repeat dots: two interspaces around the middle of the staff (MuseScore `drawDots`); centred on the bar for a staff without lines (rhythm, chords)
    const dotYs = (() => {
      const n = ys.length;
      if (!n) { const c = ((span ? span.lo : 0) + (span ? span.hi : 0)) / 2; return [c - 0.5, c + 0.5]; }
      const base = Math.min(...ys);
      const ld = n > 1 ? (Math.max(...ys) - base) / (n - 1) : 1;
      return [base + (Math.floor((n - 1) / 2) - 0.5) * ld, base + (Math.floor(n / 2) + 0.5) * ld];
    })();
    // tips only where the bar is not joined to a neighbouring staff (the joined ones carry them at the outer ends only)
    const joined = (a, b) => a >= 0 && b < ctx.staves.length && (ctx.staves[a].track.id === ctx.staves[b].track.id || barlinesConnect(ctx.movement, ctx.staves[a].track, ctx.staves[b].track));
    const tipOpts = style(SID.REPEAT_BAR_TIPS) ? { dotYs, ...(sref.type === 'chord' ? { compact: true, tipScale: style(SID.REPEAT_TIP_SCALE) } : {}), tips: { top: !joined(si - 1, si), bottom: !joined(si, si + 1) } } : { dotYs };
    // ouverture de reprise redessinée en tête de système : c'est la barre de fin de la mesure précédente (la 1re mesure du Mouvement n'en a pas : non masquable)
    if (sys.leadRepeat && hasBars) {
      const lead = barlineItems(sys.repeatX, 'startRepeat', bottom, topBar, staff.id, glyphs, tipOpts);
      items.push(...(sys.first > 0 ? decor(lead, staff, 'barline', sys.first - 1) : lead));
    }
    for (const m of sys.measures) {
      // armure / chiffrage qui changent à l'ouverture de la mesure, puis de précaution avant la barre de fin de système
      for (const block of [m.change, m.courtesy]) {
        // seul le bloc d'ouverture de la mesure (`m.change`) est un élément réel et maskable ; la précaution de fin de ligne est générée
        const real = block === m.change;
        if (block.ks && ks) {
          const kc = block.ks.byStaff?.[si] ?? block.ks; // armure propre à cette portée (instrument transpositeur)
          const list = keySigItems(glyphs, block.ks.x, ks.clefKey, kc.new, kc.prev);
          items.push(...(real ? decor(list, staff, 'keySig', m.mi) : list));
        }
        const tsPos = ts ?? (sref.type === 'chord' ? { yNum: (bottom + topBar) / 2 + (topBar - bottom) / 4, yDen: (bottom + topBar) / 2 - (topBar - bottom) / 4 } : null); // the chord staff shows its changes too
        if (block.ts && tsPos) {
          const list = shrinkTs(timeSigItems(glyphs, block.ts.x, block.ts.ts, tsPos.yNum, tsPos.yDen, block.ts.style), block.ts.x);
          items.push(...(real ? decor(list, staff, 'timeSig', m.mi) : list));
        }
      }
      // (built only when something is painted: a re-used measure does not need it)
      const mctxOf = (x0, barX) => ({ ...sref.ctx, systemFirst: sys.first, measure: { index: m.mi, x0, width: m.content, barX } });
      const { origins, perStaff } = measureInfo.get(m.mi);
      const placed = perStaff[si];
      systemPlaced.push(...placed);
      // respirations et césures de cette portée : segments propres, alignés à droite contre ce qui les suit
      items.push(...measureBreathItems(allColumns[m.mi], (i) => origins[i], m.start + m.content, si));
      // un peintre peut dessiner la mesure entière (ligatures, n-olets : il faut les x de tout un groupe)
      if (painter.paintMeasure) {
        // The measure is painted in coordinates LOCAL to it (x from its start) and translated: a measure that nothing touched is not painted again, its
        // previous painting is re-used (layout/paintcache.js). Measures with cross-staff chords stay absolute and uncached.
        const pc = ctx.paintCache;
        const crossStaff = placed.some((p) => p.entry.relocated || p.entry.crossMember);
        const local = (ctx.localPaint || pc) && m.start !== 0 && !crossStaff;
        const off = local ? m.start : 0;
        let painted;
        const cacheKey = `${staff.id}|${m.mi}`;
        const rel = pc && local ? relativeKey(placed, m, sys) : null;
        const hit = rel !== null && pc.clean(m.mi) && ctx.reusableStaves.has(staff.id) ? pc.prev.get(cacheKey) : null;
        if (hit && hit.rel === rel) {
          const back = restoreMeasure(hit.record, off);
          back.apply(placed);
          painted = back.items;
          pc.next.set(cacheKey, hit);
          pc.reused++;
        } else {
          const placedP = local ? placed.map((p) => ({ ...p, x: p.x - off })) : placed;
          const mctxP = local ? mctxOf(0, m.barX - off) : mctxOf(m.start, m.barX);
          const pre = ctx.probe || (pc && local) ? placed.map((p) => ({ ...p.entry })) : null;
          const paintedRaw = painter.paintMeasure(placedP, mctxP);
          if (ctx.probe) ctx.probe({ si, mi: m.mi, off, placed, pre });
          if (pc && local && !paintedRaw.relocated?.length && !paintedRaw.crossBeams?.length) {
            pc.next.set(cacheKey, { rel, record: snapshotMeasure({ placed, pre, items: paintedRaw }) }); // still local: saved before translating
          }
          if (local) for (const it of paintedRaw) translateItemInPlace(it, off); // in place: some of these objects are also kept on the entries
          painted = paintedRaw;
          if (local) translateEntries(placed.map((p) => p.entry), off);
          if (pc) pc.painted++;
        }
        items.push(...painted);
        for (const r of painted.relocated ?? []) crossOut.push(r); // accords relocalisés : { to (rang de la portée cible), items }
        for (const r of painted.crossBeams ?? []) (collect.crossBeams ??= []).push(r); // ligatures croisées : posées au second passage
      }
      else for (const p of placed) items.push(...painter.paintEntry(p.entry, p.x, mctxOf(m.start, m.barX)));
      // petite clé de courtoisie juste avant CETTE barre, si CETTE portée change de clé au tout début de la mesure suivante
      // (jamais après la barre, contrairement à l'armure/au chiffrage — vérifié sur un export MuseScore de Jean).
      const trailingClef = sref.ctx.clefChangeEndingMeasure ? sref.ctx.clefChangeEndingMeasure(m.mi) : null;
      if (trailingClef) {
        const def = CLEF_DEFS[trailingClef];
        const w = glyphWidth(glyphs, def.glyph) * SMALL_CLEF_MAG;
        items.push(glyphItem(def.glyph, m.barX - CLEF_BARLINE_MARGIN * sys.stretch - w, def.musicY, { mag: SMALL_CLEF_MAG, ref: staff.id, role: 'clef-change' }));
      }
      if (hasBars) items.push(...decor(barlineItems(m.barX, m.endType, bottom, topBar, staff.id, glyphs, tipOpts), staff, 'barline', m.mi));
    }
    // containers between measures that belong to THIS staff: content in the row of the staff (option A), centred in the slot
    for (const m of sys.measures) {
      for (const sl of [...m.slotsBefore, ...m.slotsAfter]) {
        for (const e of sl.entries) {
          if (e.staffIndex !== si) continue;
          if (!e.container.fragments?.length) items.push(...slotItems({ ctx, container: e.container, x: sl.x, width: sl.width, ys, span, half }));
          // nested score in the ROW of its staff (option A, a container on every staff): before the vertical stacking, so it pushes the staves apart
          else if (getProperty(e.container, PID.CONTAINER_ALIGN) === 'row') items.push(...fragmentRowItems({ ctx, container: e.container, slot: sl, inner: ctx.fragmentLayout(e.container), ys, span }));
        }
      }
    }
    // chord staff: it has no header of its own, so it gets, as if it stood in the body of the piece, a measure bar right before the first chord of EVERY system
    // and the time signature at the start of the piece and when it changes, like the other staves (not aligned with their header, on purpose)
    if (sref.type === 'chord' && sys.measures.length) {
      const m0 = sys.measures[0];
      const xb = m0.start - CHORD_START_BAR_GAP;
      if (!sref.ctx.hideBars && !sys.leadRepeat) items.push(...barlineItems(xb, 'simple', bottom, topBar, staff.id, glyphs, {})); // (a start repeat at the head of the system is that bar: no second one behind it)
      const ts = sref.ctx.timeSigs?.[m0.mi];
      if (ts && sys.header.showTs && style(SID.CHORD_START_TIMESIG) !== false) { // like the other staves: at the start of the piece, then only when it changes
        const tsStyle = effectiveTimeSigStyle(ts, getProperty(ctx.movement.masterbars[m0.mi], PID.TIME_SIG_STYLE));
        const mid = (bottom + topBar) / 2; const q = (topBar - bottom) / 4;
        const right = sys.leadRepeat ? sys.repeatX : xb; // a start repeat at the head of the system is the bar the time signature stands before
        const x = Math.max(0, right - CHORD_START_TS_GAP - timeSigWidth(glyphs, ts, tsStyle) * chordK);
        // a real, maskable element like the others (menu « Armure et chiffrage » of the track, hide / colour of the element)
        items.push(...decor(shrinkTs(timeSigItems(glyphs, x, ts, mid + q, mid - q, tsStyle), x).map((it) => ({ ...it, ref: staff.id })), staff, 'timeSig', m0.mi));
      }
    }
    // marquages en plage (soufflets, tranche 3) : besoin des x de TOUT le système, pas d'une seule mesure
    collect[si] = { placed: systemPlaced, headerRight };
    if (painter.paintSystemExtra) items.push(...painter.paintSystemExtra(systemPlaced, staff, ctx.movement, sys, sref.ctx));
    return { ref: staff.id, trackId: sref.track.id, type: sref.type, painter: painter.name, originY: placement.originY, items };
  };
  const staves = [];
  for (let si = 0; si < ctx.staves.length; si++) { staves.push(paintStaff(ctx.staves[si], si)); yield 'staff'; } // a driver may give the main thread back between two staves

  for (const r of crossOut) if (staves[r.to]) staves[r.to].items.push(...r.items);

  // voltas : sur la portée du haut du système
  const showSystem = ctx.style(SID.SHOW_SYSTEM_OBJECTS) !== false;
  // printed part: the signs of the structure on the top staff only (MuseScore), or on every staff of the system when the part asks for it
  const flagSigns = (items, from) => { for (let i = from; i < items.length; i++) items[i].sysSign = true; }; // read by a view that moves the signs with the window
  const signStaves = staves.length ? (ctx.style(SID.PART_SIGNS_ON) === 'all' ? staves.map((_, k) => k) : [0]) : [];
  if (showSystem && ctx.movement.voltas.length) for (const k of signStaves) {
    const ys = vertical.staves[k].lines.map((l) => l.y);
    const n0 = staves[k].items.length;
    staves[k].items.push(...voltaItems(ctx.movement, sys, ys.length ? Math.max(...ys) : 4, ctx.style));
    flagSigns(staves[k].items, n0);
  }
  // sauts et marqueurs (segno, coda, Fine, D.S. al Coda…) : sur la portée du haut, au-dessus de tout ce qui est déjà dessiné (voltas comprises)
  if (showSystem && (ctx.movement.jumps.length || ctx.movement.markers.length)) for (const k of signStaves) {
    const ys = vertical.staves[k].lines.map((l) => l.y);
    const n0 = staves[k].items.length;
    staves[k].items.push(...jumpMarkerItems(ctx.movement, sys, ys.length ? Math.max(...ys) : 4, staves[k].items, ctx.glyphs, ctx.style(SID.READER_MARK_SCALE) ?? 1));
    flagSigns(staves[k].items, n0);
  }
  // repères de répétition : cadre au-dessus de la portée du haut (après les sauts, avant les tempos)
  if (showSystem && ctx.movement.rehearsalMarks.length) for (const k of signStaves) {
    const ys = vertical.staves[k].lines.map((l) => l.y);
    const hd = sys.header;
    const n0 = staves[k].items.length;
    staves[k].items.push(...rehearsalItems(ctx.movement, sys, ys.length ? Math.max(...ys) : 4, staves[k].items, ctx.glyphs, hd.leftPad + hd.lettersW + hd.clefW + hd.ksW + hd.tsW));
    flagSigns(staves[k].items, n0);
  }

  // x d'un instant (mesure + fraction) dans ce système : pour la piste système (tempos…) ET les marquages en plage ancrés par instant (pédales)
  const byMi = new Map(sys.measures.map((m) => [m.mi, m]));
  const xAt = (mi, position) => {
    const m = byMi.get(mi), cm = colMap.get(mi);
    if (!m || !cm || !cm.positions.length) return m ? m.start : 0;
    const { positions: ps, origins: os } = cm;
    let i = 0;
    while (i < ps.length && fCmp(ps[i], position) < 0) i += 1;
    if (i < ps.length && fCmp(ps[i], position) === 0) return os[i];
    if (i === 0) return os[0];
    const t0 = fToNumber(ps[i - 1]), x0c = os[i - 1];
    const t1 = i < ps.length ? fToNumber(ps[i]) : fToNumber(fAdd(ctx.offsets?.[mi] ?? [0, 1], ctx.barLengths[mi]));
    const x1c = i < ps.length ? os[i] : m.barX;
    const k = t1 > t0 ? Math.min(1, Math.max(0, (fToNumber(position) - t0) / (t1 - t0))) : 0;
    return x0c + (x1c - x0c) * k;
  };
  for (const c of collect) if (c) c.xAt = xAt;

  // staff containers (text, nested notation…): above each anchor staff, before the system objects that stack on the top staff
  ctx.staves.forEach((sref, si) => {
    staves[si].items.push(...symbolDiagramItems({ ctx, sref, sys, xAt, existing: staves[si].items, entries: ctx.entries?.[si] })); // the diagrams the chord symbols carry, just above them
    staves[si].items.push(...chordOffsetItems({ ctx, sref, sys, xAt, existing: staves[si].items })); // play-offset arrows of the chord symbols
    staves[si].items.push(...lyricHoldItems({ ctx, sref, sys, xAt, existing: staves[si].items })); // the line under a syllable held over several notes (when the style asks for it)
    if (sref.staff.containers?.length) staves[si].items.push(...containerItems({ ctx, sref, sys, xAt, existing: staves[si].items }));
  });

  // tempos et lignes rit./accel. (piste système) : sur la portée du haut, au-dessus de tout (sauts compris)
  const showCues = ctx.style(SID.SHOW_CUES) !== false;
  const topTempo = (ctx.printed || ctx.lowCards) && ctx.style(SID.TEMPO_START_TOP) !== false; // the tempo of the very beginning goes above everything, once the cards are placed
  const tempoPlumbing = (k) => {
    const ys = vertical.staves[k].lines.map((l) => l.y);
    const h = sys.header;
    const timeSigX = (mi) => {
      const m = byMi.get(mi);
      if (!m) return null;
      if (mi === 0 && h.tsW > 0) return h.leftPad + h.lettersW + h.clefW + h.ksW;
      return m.change?.ts ? m.change.ts.x : null;
    };
    const firstColumnX = (mi) => colMap.get(mi)?.origins[0] ?? byMi.get(mi)?.start ?? 0;
    return { xAt, timeSigX, firstColumnX, topLineY: ys.length ? Math.max(...ys) : 4, glyphs, showCues, showTempoText: ctx.style(SID.SHOW_TEMPO_TEXTS) !== false };
  };
  if (showSystem && (ctx.movement.tempos.length || ctx.movement.tempoChanges.length || ctx.movement.fermatas?.length || ctx.movement.swings?.length || (showCues && ctx.movement.cues?.length))) for (const k of signStaves) {
    const ys = vertical.staves[k].lines.map((l) => l.y);
    const h = sys.header;
    const timeSigX = (mi) => {
      const m = byMi.get(mi);
      if (!m) return null;
      if (mi === 0 && h.tsW > 0) return h.leftPad + h.lettersW + h.clefW + h.ksW;
      return m.change?.ts ? m.change.ts.x : null;
    };
    const firstColumnX = (mi) => colMap.get(mi)?.origins[0] ?? byMi.get(mi)?.start ?? 0;
    const n0 = staves[k].items.length;
    staves[k].items.push(...tempoDisplayItems(ctx.movement, sys, {
      xAt, timeSigX, firstColumnX, topLineY: ys.length ? Math.max(...ys) : 4, existing: staves[k].items, glyphs, showCues, showTempoText: ctx.style(SID.SHOW_TEMPO_TEXTS) !== false, skipStart: topTempo,
    }));
    flagSigns(staves[k].items, n0);
  }

  // cards of the sections of the form as a staff text (printed part): on the top staff or on every staff, above what the staff already carries
  const cardMode = ctx.style(ctx.printed ? SID.PART_SECTION_CARDS : SID.READER_SECTION_CARDS); // (a printed part has its own; the Lecteur's own pages ask for them by READER_SECTION_CARDS)
  if (showSystem && (cardMode === 'first' || cardMode === 'all') && staves.length && ctx.movement.systemContainers.length) {
    const cardSegs = startingSegments(sectionSegments(ctx.movement, sys));
    if (cardSegs.length) for (const k of (cardMode === 'all' ? staves.map((_, i) => i) : [0])) {
      const ys = vertical.staves[k].lines.map((l) => l.y);
      const rs = rectsOf(staves[k].items, ctx.glyphs);
      const gap = ctx.style(SID.SECTION_CARD_GAP); // 1 = the usual room between a card and what it sits on
      const top = Math.max(ys.length ? Math.max(...ys) + 1.2 * gap : 4 + 1.2 * gap, rs.length ? Math.max(...rs.map((r) => r.y2)) + 0.3 * gap : 0);
      // as low as possible: just above what lies under the width of each card (a card with no volta under it sits beside the volta, not above it)
      const floor = ys.length ? Math.max(...ys) + 1.2 * gap : 4 + 1.2 * gap;
      const place = ctx.style(SID.SECTION_CARD_PLACE) === 'top' ? null : (x1, x2) => Math.max(floor, highestUnder(rs, x1, x2) + 0.3 * gap);
      const voltas = rectsOf(staves[k].items.filter((it) => it.role === 'volta'), ctx.glyphs);
      staves[k].items.push(...sectionCardItems(cardSegs, top, ctx.style(SID.SECTION_CARD_SCALE), place, ctx.style(SID.SECTION_CARD_STYLE), voltas));
    }
  }

  if (ctx.chordViewCards && staves.length) { // the display tags of the chord staves (how the chords are read from there: model/chordview.js): a card on the staff, screen 1 only
    ctx.staves.forEach((sref, k) => {
      if (sref.type !== 'chord' || !staves[k]) return;
      const segs = chordViewSegments(chordViewTags(ctx.movement, sref.staff), sys); if (!segs.length) return;
      const ys = vertical.staves[k].lines.map((l) => l.y);
      const rs = rectsOf(staves[k].items, ctx.glyphs);
      const top = Math.max(ys.length ? Math.max(...ys) + 1.2 : 5.2, rs.length ? Math.max(...rs.map((r) => r.y2)) + 0.3 : 0);
      const cards = sectionCardItems(segs, top, 0.85, null, 'card', []);
      staves[k].items.push(...(ctx.printed ? cards.map((it) => ({ ...it, role: `chord-view-${it.role.replace('section-', '')}` })) : cards)); // on a printed part the cards are SCREEN ONLY (roles 'chord-view-card' / 'chord-view-card-text': never printed)
    });
  }

  let autoMetas = null;
  // strip of the mixer automation under each track the interface shows (screen only): below everything the last staff of the track carries
  if (ctx.autoTracks?.size && !ctx.printed) {
    const metas = [];
    for (const trackId of ctx.autoTracks) {
      let k = -1;
      ctx.staves.forEach((sref, i) => { if (sref.track.id === trackId) k = i; });
      if (k < 0) continue;
      const ys = vertical.staves[k].lines.map((l) => l.y);
      const rs = rectsOf(staves[k].items, ctx.glyphs);
      const bottom = Math.min(ys.length ? Math.min(...ys) - 0.3 : -0.3, rs.length ? Math.min(...rs.map((r) => r.y1)) : 0);
      const track = ctx.staves[k].track;
      // one strip per lane shown (volume first, then pan), stacked under the track
      let below = bottom;
      (ctx.autoParams?.get(trackId) ?? ['volume']).forEach((param, n) => {
        const { items, strip } = automationStrip({ movement: ctx.movement, track, sys, xAt, bottom: below, gap: n === 0 ? undefined : 0.3, param, fader: faderOf(track, param), name: getProperty(track, PID.NAME) ?? '', scale: ctx.autoScale ?? 1 });
        if (!strip) return;
        staves[k].items.push(...items);
        metas.push({ ...strip, staffRef: ctx.staves[k].staff.id });
        below = strip.bottom;
      });
    }
    autoMetas = metas.length ? metas : null;
  }

  // measure numbers (printed parts): above the top staff, after the other marks so that they stay clear of them
  if (ctx.numbering && staves.length) {
    const ys = vertical.staves[0].lines.map((l) => l.y);
    staves[0].items.push(...measureNumberItems(ctx, sys, ys.length ? Math.max(...ys) : 4, staves[0].items, ctx.glyphs, ctx.spaceMm));
  }

  // lyrics written on the grid of measures (no melody): under the first chord staff, before anything that is placed from the rects of the staves
  if (staves.length) {
    for (const gk of gridLyricsStaves(ctx.staves)) if (staves[gk]) staves[gk].items.push(...gridLyricItems({ ctx, sys, type: getProperty(ctx.staves[gk].staff, PID.STAFF_TYPE) }));
  }

  // sections of the form: room for the name cards of the interface above everything on the top staff
  // (a printed part that already writes its cards on the staff needs no second room for the interface's cards: it would only be dead space above them)
  const cardsWritten = ctx.printed && (cardMode === 'first' || cardMode === 'all');
  if (showSystem && !cardsWritten && (ctx.printed || ctx.style(SID.READER_SECTION_CARDS) === 'strip') && staves.length && ctx.movement.systemContainers.length && startingSegments(sectionSegments(ctx.movement, sys)).length) {
    const rs = rectsOf(staves[0].items, ctx.glyphs);
    const ys = vertical.staves[0].lines.map((l) => l.y);
    const top = rs.length ? Math.max(...rs.map((r) => r.y2)) : (ys.length ? Math.max(...ys) : 4);
    staves[0].items.push(...sectionStripSpaces(startingSegments(sectionSegments(ctx.movement, sys)), rs, { top, width: sys.width, low: ctx.lowCards && ctx.style(SID.SECTION_CARD_PLACE) !== 'top', scale: ctx.lowCards ? ctx.style(SID.SECTION_CARD_SCALE) : 1, voltas: rectsOf(staves[0].items.filter((it) => it.role === 'volta'), ctx.glyphs) }));
  }

  // the tempo of the very beginning, above everything the staff carries (voltas, name cards…)
  if (topTempo && showSystem && ctx.movement.tempos.length) for (const k of signStaves) {
    const n0 = staves[k].items.length;
    staves[k].items.push(...tempoDisplayItems(ctx.movement, sys, { ...tempoPlumbing(k), existing: staves[k].items, startOnly: true }));
    flagSigns(staves[k].items, n0);
  }

  // the strip of the master volume: above everything the top staff carries (the section name cards included)
  if (ctx.autoMaster && !ctx.printed && staves.length) {
    const ys = vertical.staves[0].lines.map((l) => l.y);
    const rs = rectsOf(staves[0].items, ctx.glyphs);
    const base = Math.max(ys.length ? Math.max(...ys) + 0.3 : 4.3, rs.length ? Math.max(...rs.map((r) => r.y2)) + 0.2 : 0);
    const { items, strip } = automationStrip({ movement: ctx.movement, track: ctx.movement, sys, xAt, bottom: base, above: true, gap: 0.4, param: 'master', fader: ctx.autoMaster.volume ?? 100 / 127, name: ctx.autoMaster.label ?? 'Master', scale: ctx.autoScale ?? 1 });
    if (strip) { staves[0].items.push(...items); autoMetas = [...(autoMetas ?? []), { ...strip, staffRef: ctx.staves[0].staff.id }]; }
  }

  const measures = sys.measures.map((m) => ({ index: m.mi, ref: ctx.movement.masterbars[m.mi].id, x: m.start, width: m.content, barX: m.barX }));
  return { staves, overlays: [], measures, ...(autoMetas ? { automation: autoMetas } : {}) };
}

/** Accolades : une par piste qui a plusieurs portées, d'après l'empilement définitif. */
function trackBraces(ctx, vertical) {
  const overlays = [];
  const trackIds = [...new Set(ctx.staves.map((s) => s.track.id))];
  for (const tid of trackIds) {
    const idx = ctx.staves.map((s, i) => (s.track.id === tid && !s.ctx.collapsed ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) continue;
    const first = vertical.staves[idx[0]];
    const last = vertical.staves[idx[idx.length - 1]];
    overlays.push({ ...braceItem(first.top, last.originY, idx.length, ctx.glyphs, ctx.style), ref: tid });
  }
  return overlays;
}
