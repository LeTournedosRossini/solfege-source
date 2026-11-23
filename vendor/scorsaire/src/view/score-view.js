/*
 * ScoreView — vue d'une partition (étape 5, tranche 2). AUCUN DOM : testable sous Node.
 *
 * Rôle : mise en page + rendu SVG (via le moteur existant, inchangé) + hit-test + sélection par identifiants.
 * La vue NE MODIFIE JAMAIS le Document : elle le lit, s'abonne à ses changements (`doc.subscribe`) et ne produit que des
 * lectures. La sélection est un état DE LA VUE (liste d'ids) ; les gestes d'édition (tranches suivantes) passeront par l'Application.
 *
 * Annuler / refaire : la charge utile `{ views: { <idVue>: { selection: { ids } } } }` est rangée par l'Application dans la
 * transaction (`doc.transaction(nom, fn, { before })` + `doc.setViewAfter`) ; à undo/redo, chaque vue lit SA part dans
 * `event.view` et restaure sa sélection — les ids qui n'existent plus sont ignorés.
 */
import { layoutMovement, layoutMovementSteps } from '../layout/index.js';
import { shiftForDisplay } from '../layout/displayshift.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { renderSvgString } from '../render/svg.js';
import { describeChanges, mergeDirty } from '../model/dirty.js';
import { buildHitIndex, isSelectableElement } from './hit-index.js';
import { perf } from '../perf/probe.js';
import { createSelection } from './selection.js';
import { localPlay } from '../model/play.js';
import { PID } from '../model/pid.js';
import { contentStaff } from '../model/linkedstaff.js';
import { STAFF_LIST_KINDS } from '../model/listindex.js';
import { parseDecorId, isDecorHidden } from '../model/decor.js';
import { inputGridOf } from '../model/inputgrid.js';
import { fEq, fAdd, fSub } from '../model/fraction.js';
import { measureOffsetOf, measureLengthOf, itemDuration } from '../model/timing.js';
import { normalizeRange, rangeBoundaries, resolveStaves, rangeMeasureSpan, contentLength } from '../model/range.js';
import { hitStaffPosition } from './staff-hit.js';
import { inputColumns } from './input-columns.js';
import { itemRect } from '../layout/bounds.js';
import { isApplicable } from '../model/schema.js';
import { NAME_SIZE } from '../layout/instrumentnames.js';
import { staffLineCount } from '../layout/painters/common.js';
import { tuningPitches } from '../model/capo.js';
import { GRIP_KINDS, gripOffset, gripAperture } from '../model/grips.js';
import { TAB_LINE_DISTANCE } from '../layout/painters/tab.js';

/** Tolérance de pointage en pixels (décision de Jean) : 1 px à la souris, 12 px au doigt (WCAG 2.2 SC 2.5.8 : cible ≥ 24 px). */
export const TOLERANCE = { mouse: 1, touch: 12 };

/**
 * @param o.id          identifiant de la vue, donné par l'Application ('main')
 * @param o.doc         Document (lecture seule pour la vue)
 * @param o.glyphs      données Bravura
 * @param o.movement    Mouvement affiché (défaut : le premier)
 * @param o.width       largeur d'un système en espaces de portée (défaut : 40)
 * @param o.staffSpace  pixels par espace de portée ; o.margin : marge en pixels ; o.canvasWidth : largeur du SVG en pixels
 * @param o.getStyle    surcharge de style (comme `layoutMovement`)
 * @param o.resolve     (ref) → élément | descripteur d'entrée de liste | undefined ; par défaut : `doc.find`, puis l'index de lecture des
 *                      entrées de listes du Document (`doc.findListEntry`, tranche 2 bis : liaisons, soufflets, doigtés…), exposé sous
 *                      la forme `{ id, type: genre, listEntry: true, owner, pid, entry }`
 */
/** Short name / icon of each track under the metre, as system overlays (y down, centred on `v.center`), for the sticky header. */
function stickyNameOverlays(sys, v) {
  const names = sys.stickyNames;
  if (!names) return [];
  const out = [];
  for (const e of names.entries) {
    const last = sys.staves[e.last];
    if (!e.content || !last) continue;
    // a rhythm staff has no lines (or one): its metre is drawn around the virtual line and reaches further down, so the name goes lower
    const lower = last.type === 'rhythm' || last.type === 'neutral' ? 1.5 : 0;
    if (e.content.kind === 'icon') {
      const { box } = e.content;
      const w = box.w * 0.8; const h = box.h * 0.8;
      if (box.ui) { out.push({ kind: 'icon-shape', role: 'sticky-track-icon', name: e.content.name.slice(3), photo: e.content.photo, x: v.center - w / 2, y: last.originY + 1.2 + lower, w, h }); continue; }
      out.push({ kind: 'glyph-stretch', role: 'sticky-track-icon', name: e.content.name, x: v.center - w / 2, y: last.originY + 1.2 + lower, w, h, natW: box.natW, natH: box.natH });
    } else {
      out.push({ kind: 'text', role: 'sticky-track-name', text: e.content.text, size: NAME_SIZE * 0.8, x: v.center, y: last.originY + 1.9 + lower, anchor: 'middle', central: true, color: '#555' });
    }
  }
  return out;
}

export function createScoreView({ id, doc, glyphs, movement, width = 40, bandWidth = null, staffSpace = 14, margin = 10, canvasWidth, getStyle, resolve, justifyLast = false }) {
  if (!id) throw new Error('ScoreView : identifiant de vue obligatoire (donné par l\'Application)');
  const selection = createSelection();
  const changeListeners = new Set();
  const params = { width, bandWidth, staffSpace, margin, canvasWidth, getStyle, justifyLast }; // `bandWidth` (staff spaces): the width of the band of blocks (null = the width of the system)
  // élément du modèle, sinon entrée de liste (descripteur en lecture seule : `type` = genre de l'entrée, jamais confondu avec un élément)
  const listDescriptor = (le) => (le ? { id: le.id, type: le.kind, listEntry: true, owner: le.owner, pid: le.pid, entry: le.entry } : undefined);
  // élément de décor (barre, clé, armure, chiffrage) : identifiant synthétique `decor|portée|genre|mesure` (voir model/decor.js)
  const decorDescriptor = (ref) => {
    const d = parseDecorId(ref);
    const staff = d && doc.find(d.staffId);
    if (!staff || staff.type !== 'staff' || !doc.movementOf(staff)?.masterbars.some((b) => b.id === d.measureId)) return undefined;
    return { id: ref, type: 'decor', decor: d, staff, hidden: isDecorHidden(staff, d.kind, d.measureId) };
  };
  const find = resolve ?? ((ref) => doc.find(ref) ?? listDescriptor(doc.findListEntry(ref)) ?? decorDescriptor(ref));
  // afficher les éléments masqués (en gris) : ÉTAT DE VUE, jamais dans le Document ; la mise en page n'en dépend pas
  let showHidden = false;
  let showMuted = true; // muted notes drawn in grey (the editor); false = not drawn
  let current = null; // { layout, index, svg } — recalculé paresseusement
  let lastLayoutMs = 0;
  // deferred refresh (burst of keyboard entry): while frozen, `build()` serves the last computed layout instead of recomputing; the changes
  // keep accumulating in `layoutCache.dirty`, so the first `build()` after `freeze(false)` brings everything up to date at once
  let frozen = false;
  let lastBuilt = null;
  // a layout in progress (the steps of `layoutMovementSteps`): advanced in slices by `prepare()` so that the page keeps answering, finished at once by `build()` if something
  // needs the layout now. Dropped (with the layout cache, which it had started to fill) as soon as anything invalidates the layout.
  let pending = null;
  // incremental layout: what the last layout left (`store`) and what changed since (`dirty`, model/dirty.js)
  const layoutCache = { store: {}, dirty: null };
  let masterLabel = 'Master'; // the text written on the master volume strip (the interface gives it in its language)
  let masterAuto = null; // { label, volume } while the master volume strip is shown
  let autoParams = null; // Map trackId → the lane its strip shows ('volume' | 'pan')
  let autoScale = 1; // height factor of the automation strips (a screen option)
  let autoTracks = null; // Set of track ids whose automation strip is shown (a screen option, never in the Document)
  let disposed = false;
  // case de saisie d'accord active { staffId, measureId, cell } : état DE LA VUE (restauré par annuler/refaire), jamais dans le Document
  let activeCell = null;
  const cellListeners = new Set();
  // mesure choisie (identifiant du masterbar) : état DE LA VUE comme la case active (restauré par annuler/refaire), exclusive de la sélection
  // et de la case active ; sert de cible aux boutons de boucle et de lecture (tranche « A/B posés en touchant la mesure »)
  let chosenMeasure = null;
  const measureListeners = new Set();
  // plage (portées × temps, voir model/range.js) : état DE LA VUE, exclusive de la sélection, de la case active et de la mesure choisie
  let rangeState = null;
  const rangeListeners = new Set();
  const sameRange = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sameCell = (a, b) => (!a && !b) || (a && b && a.staffId === b.staffId && a.measureId === b.measureId && a.cell === b.cell);

  // the movement of the WORK shown when no movement element is given (the header tab "Movement" picks it): an id that no longer exists falls back to the first
  let shownId = null;
  const mv = () => movement ?? (shownId && doc.work.movements.find((m) => m.id === shownId)) ?? doc.work.movements[0];
  // the coloured bands of the sections are drawn by the interface in a layer BEHIND the score (the sticky header must not carry them); a file export keeps them
  const svgOpts = () => ({ staffSpace: params.staffSpace, margin: params.margin, canvasWidth: params.canvasWidth, showHidden, showMuted, skipRoles: ['section-band'], signGroups: true, showResizeHandles: true });
  // the full SVG text is made only when asked for (`render()`): the long one-system view draws a window of it (`renderWindow`) and never needs the whole
  // the full SVG text and the full hit index are made only when asked for: the long one-system view draws a window (`renderWindow`), and the selection
  // needs only the elements it holds (`partialEntries`); `hitTest` and the other whole-page readers build the full index the first time
  const renderAll = () => ({ svg: null, index: null });
  const indexOpts = () => ({ resolve: find, staffSpace: params.staffSpace, margin: params.margin, showHidden });
  const fullIndex = () => { const cur = build(); return (cur.index ??= perf.span('index:full', () => buildHitIndex(cur.layout, glyphs, indexOpts()))); };
  /** The index entries of some references: from the full index when it exists, else from a partial one (only those elements are looked at). */
  const partialEntries = (refs) => {
    if (!refs.size) return [];
    return indexEntriesOf(refs).filter((e) => refs.has(e.ref));
  };
  /** All the entries built for the display items whose `ref` / `sel` is in `refs` (entries of the marks of a chord have the chord as `baseRef`). */
  const indexEntriesOf = (refs) => {
    const cur = build();
    return cur.index ? cur.index.entries : perf.span('index:partial', () => buildHitIndex(cur.layout, glyphs, { ...indexOpts(), only: refs }).entries);
  };
  const build = () => {
    if (!current && frozen && lastBuilt) return lastBuilt;
    if (!current) {
      pending ??= beginLayout();
      advance(pending, Infinity);
    }
    return current;
  };
  /** Starts a layout (a generator, nothing is computed yet). `ms` adds up the time spent computing it (the waits between slices do not count). */
  const source = () => (params.displayShift ? shiftForDisplay(mv(), params.displayShift, { fifths: params.displayFifths ?? 0 }) : mv());
  const layoutOptions = () => ({ width: params.width, bandWidth: params.bandWidth, getStyle: params.getStyle, justifyLast: params.justifyLast, chordQualities: workChordQualities(doc.work), lyricTexts: doc.get(doc.work, PID.LYRIC_TEXTS), preferredVoicings: doc.get(doc.work, PID.PREFERRED_VOICINGS), composites: typeof params.composites === 'function' ? params.composites() : (params.composites ?? null), chordViewCards: true, automationTracks: autoTracks, automationScale: autoScale, automationParams: autoParams, masterAutomation: masterAuto ? { ...masterAuto, volume: doc.get(doc.work, PID.MASTER_VOLUME) } : null });
  const beginLayout = () => ({ ms: 0, steps: layoutMovementSteps(source(), glyphs, { ...layoutOptions(), cache: layoutCache }) });
  /** The first `n` measures only: shallow copies (same ids, same elements) so the layout of a long score can start with what is on the screen. */
  const sliceMovement = (m, n) => ({ ...m, masterbars: m.masterbars.slice(0, n), tracks: m.tracks.map((t) => ({ ...t, staves: t.staves.map((st) => ({ ...st, voices: st.voices.map((v) => ({ ...v, measures: v.measures.slice(0, n) })) })) })) });
  /** Runs the steps of `job` for about `sliceMs` (all of them for Infinity); installs the layout when they are over. Returns true when it is installed. */
  const advance = (job, sliceMs) => {
    const t0 = performance.now();
    let r;
    do { r = job.steps.next(); } while (!r.done && performance.now() - t0 < sliceMs);
    job.ms += performance.now() - t0;
    if (!r.done) return false;
    pending = null;
    layoutCache.dirty = null;
    current = { layout: r.value, ...renderAll() };
    lastBuilt = current;
    lastLayoutMs = job.ms; // layout + SVG + hit index of the last recomputation (what a layout cache would save)
    if (perf.on) { // the whole layout, then each phase it timed (layout/index.js `tick`) and what the cache reused
      perf.add('layout:total', lastLayoutMs);
      perf.add(`layout:why:${layoutCache.store.reason ?? '?'}`, 1, 'n');
      for (const [k, v] of Object.entries(layoutCache.store.timings ?? {})) perf.add(`layout:${k}`, v);
      const st = layoutCache.store.stats; if (st) { perf.add('layout:reusedEntries', st.entriesReused ?? 0, 'n'); perf.add('layout:reusedColumns', st.columnsReused ?? 0, 'n'); }
    }
    return true;
  };
  /**
   * Computes the layout in slices of `sliceMs`, giving the main thread back between them (a click, a scroll or a repaint is answered in between), then
   * resolves with true. Resolves with false when something invalidated the layout meanwhile (the next `build()` starts again). A `build()` made while it
   * waits finishes the work at once, and the next slice finds it done.
   */
  const prepare = async (sliceMs = 10) => {
    if (current || frozen || disposed) return true;
    const job = (pending ??= beginLayout());
    for (;;) {
      if (advance(job, sliceMs)) return true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (pending !== job) return Boolean(current);
    }
  };

  /** La case existe encore : portée d'accords, mesure et index dans la grille courante. */
  const cellExists = (c) => {
    if (!c) return false;
    const staff = doc.find(c.staffId);
    const movement = staff && doc.movementOf(staff);
    const index = movement ? movement.masterbars.findIndex((b) => b.id === c.measureId) : -1;
    return index >= 0 && inputGridOf(movement.masterbars[index], index === 0)[c.cell] !== undefined;
  };
  const measureExists = (id) => !!id && mv().masterbars.some((b) => b.id === id);
  function setRangeState(next) {
    if (sameRange(rangeState, next)) return false;
    rangeState = next;
    for (const fn of [...rangeListeners]) fn(rangeState ? JSON.parse(JSON.stringify(rangeState)) : null);
    return true;
  }
  function setMeasure(id) {
    const next = id || null;
    if (next === chosenMeasure) return false;
    chosenMeasure = next;
    if (next) setRangeState(null); // exclusion : une mesure choisie remplace la plage
    for (const fn of [...measureListeners]) fn(chosenMeasure);
    return true;
  }
  function setActive(c) {
    const next = c ? { staffId: c.staffId, measureId: c.measureId, cell: c.cell } : null;
    if (sameCell(activeCell, next)) return false;
    activeCell = next;
    if (next) { setMeasure(null); setRangeState(null); } // exclusion : une case active remplace la mesure choisie
    for (const fn of [...cellListeners]) fn(activeCell);
    return true;
  }

  selection.subscribe((ids) => {
    if (ids.length) { setMeasure(null); setRangeState(null); } // exclusion : une sélection d'éléments remplace la mesure choisie
    for (const fn of [...changeListeners]) fn(ids);
  });

  // un décor masqué n'est ni visible ni sélectionnable tant qu'on n'affiche pas les masqués (`isInteractionAvailable`)
  const decorAvailable = (ref) => { const d = decorDescriptor(ref); return !!d && (!d.hidden || showHidden); };
  const exists = (ref) => doc.find(ref) !== undefined || doc.findListEntry(ref) !== undefined || decorAvailable(ref);
  const unsubscribe = doc.subscribe((event) => {
    if (pending) layoutCache.store = {}; // a layout was in progress: the cache it had begun to fill is incomplete
    current = null; pending = null; // toute modification du Document invalide la mise en page
    const dirtyNow = describeChanges(doc, mv(), event.changes); // … mais on sait quelles mesures ont changé
    layoutCache.dirty = mergeDirty(layoutCache.dirty, dirtyNow);
    if (perf.on && dirtyNow.all) perf.add(`layout:dirtyAll:${event.type}:${(event.changes ?? []).slice(0, 2).map((c) => `${c?.kind}.${c?.pid ?? c?.key ?? c?.sid}`).join('+')}`, 1, 'n'); // which change forced a full recomputation
    const mine = event.view?.views?.[id];
    if ((event.type === 'undo' || event.type === 'redo') && mine?.selection) selection.replace(mine.selection.ids.filter(exists));
    else selection.prune(exists); // éléments disparus (suppression, annulation d'un ajout) : ils quittent la sélection
    if ((event.type === 'undo' || event.type === 'redo') && mine && 'activeCell' in mine) setActive(cellExists(mine.activeCell) ? mine.activeCell : null);
    else if (activeCell && !cellExists(activeCell)) setActive(null); // la mesure ou la case a disparu
    if ((event.type === 'undo' || event.type === 'redo') && mine && 'measure' in mine) setMeasure(measureExists(mine.measure) ? mine.measure : null);
    else if (chosenMeasure && !measureExists(chosenMeasure)) setMeasure(null);
    if ((event.type === 'undo' || event.type === 'redo') && mine && 'range' in mine) setRangeState(mine.range ? normalizeRange(doc, mv(), mine.range) : null);
    else if (rangeState) setRangeState(normalizeRange(doc, mv(), rangeState)); // le Document a changé : la plage suit (ancrée par identifiants) ou disparaît
  });

  return {
    id,
    /** SVG complet, identique octet pour octet à `renderSvgString` du moteur. */
    render: () => { const cur = build(); return { svg: (cur.svg ??= renderSvgString(cur.layout, glyphs, svgOpts())) }; },
    /**
     * The same SVG with only what touches the window [x1, x2] (pixels of the SVG): for the long one-system view, where the page would otherwise carry
     * tens of thousands of elements. Same size and coordinates as `render()`; hit-testing and selection do not depend on it (they read the layout).
     * `null` when the layout is not a single long system (nothing to save).
     */
    renderWindow(x1, x2) {
      const { layout } = build();
      if (layout.systems.length !== 1 || layout.width * params.staffSpace < 3000) return null;
      return { svg: renderSvgString(layout, glyphs, { ...svgOpts(), cullX: [x1, x2] }), epoch: build() };
    },
    /**
     * What `renderWindow(a, b)` did not write and `renderWindow(A, B)` would (A ≤ a, b ≤ B): the staff elements of the two side strips, as a partial SVG whose staff
     * groups the page appends to the ones it has. `epoch` is the value `renderWindow` gave: `null` when the layout or the display options changed since (the
     * page then redraws the whole window).
     */
    renderWindowExtra(narrow, wide, epoch) {
      const cur = build();
      if (cur !== epoch || cur.layout.systems.length !== 1) return null;
      return { svg: renderSvgString(cur.layout, glyphs, { ...svgOpts(), cullX: wide, exceptWithin: narrow }) };
    },
    /**
     * The SVG with only the systems that touch the vertical window [y1, y2] (pixels of the SVG): the wrapped view of a long score. `null` when the layout
     * is a single long system, or short enough that the whole SVG is cheap.
     */
    renderRows(y1, y2) {
      const { layout } = build();
      if (layout.systems.length < 4 || layout.height * params.staffSpace < 4000) return null;
      return { svg: renderSvgString(layout, glyphs, { ...svgOpts(), cullY: [y1, y2] }) };
    },
    layout: () => build().layout,
    /**
     * A quick picture of the beginning of a long score while the real layout is not ready: the first `measures` measures laid out alone (no cache, nothing kept), without
     * their last line (it may be cut short). `{ svg, width, height }` in pixels, or null when the score is short or the beginning cannot be laid out on its own.
     */
    preview(measures = 24, maxSystems = 4) {
      const m = source();
      if (m.masterbars.length <= measures * 1.5) return null;
      try {
        const layout = layoutMovement(sliceMovement(m, measures), glyphs, layoutOptions());
        if (layout.systems.length > 1) { layout.systems.pop(); layout.systems.length = Math.min(layout.systems.length, maxSystems); layout.height = layout.systems.reduce((h, s) => Math.max(h, s.top + s.height), 0); }
        return { svg: renderSvgString(layout, glyphs, svgOpts()), layout };
      } catch { return null; }
    },
    /** Computes the layout in slices (see `prepare` above); true when it is ready. */
    prepare: (sliceMs) => prepare(sliceMs),
    /** True while no layout is stored (the next read computes one from scratch or from the cache). */
    isCold: () => !current,
    /** Milliseconds the last full recomputation took (layout, SVG, hit index): the cost a layout cache would remove. */
    layoutMs: () => { build(); return lastLayoutMs; },
    /** Defers the recomputation of the layout (true) or ends the deferral (false: the next read recomputes). Ignored until a layout exists. */
    freeze(on) { frozen = !!on && !!lastBuilt; },
    isFrozen: () => frozen,
    /** Milliseconds per phase of the last layout (diagnostic, filled by `layoutMovement` through the cache store). */
    timings: () => ({ ...(layoutCache.store.timings ?? {}), ...(layoutCache.store.stats ?? {}) }),
    /**
     * Where the chord at `cursor` would be drawn, from the layout in hand (stale while frozen): { x, bottom, lines, tab, systemIndex }, in staff
     * spaces (x from the left of the SVG, bottom = y of the bottom line, downwards), or null. Used for the ghost notes of a deferred refresh.
     */
    ghostAnchor(c) {
      const r = this.entryCursorRect(c);
      if (!r) return null;
      const ss = params.staffSpace;
      const staff = doc.find(c.staffId);
      const tab = doc.get(staff, PID.STAFF_TYPE) === 'tab';
      return { x: (r.x + 0.4 * ss) / ss, bottom: r.y2 / ss - 0.5, lines: tab ? tuningPitches(staff).length : staffLineCount(staff), tab, systemIndex: r.systemIndex };
    },
    /**
     * SVG of the STICKY HEADER of the one-system view for the header variant `index` (clef, key and time signature in force at the measure under
     * the left edge): the staff lines and the brackets of the system, with the items of that variant. Same coordinates as `render()`.
     */
    stickyHeaderSvg(index = 0) {
      const { layout } = build();
      const sys = layout.systems[0];
      const v = sys?.headerVariants?.[index];
      if (!v) return null;
      const mini = {
        width: layout.width, height: layout.height,
        systems: [{
          index: 0, top: sys.top, x0: sys.x0, width: sys.width, height: sys.height,
          // the names of the tracks written left of the staves do not follow the header: they scroll away; each track's short name or icon is written
          // under its metre instead
          overlays: [...sys.overlays.filter((o) => o.role !== 'section-band' && o.role !== 'instrument-name' && o.role !== 'instrument-icon'), ...stickyNameOverlays(sys, v)],
          staves: sys.staves.map((st, si) => ({ ref: st.ref, trackId: st.trackId, type: st.type, painter: st.painter, originY: st.originY, items: [...st.items.filter((it) => it.role === 'staff-line'), ...(v.staves[si] ?? [])] })),
        }],
      };
      return renderSvgString(mini, glyphs, { staffSpace: params.staffSpace, margin: params.margin, canvasWidth: params.canvasWidth, showHidden: false });
    },
    /** Standalone SVG of the whole score for a file: plain colours (no CSS variables), white paper, hidden elements never shown. */
    exportSvg() {
      const { layout } = build();
      const svg = renderSvgString(layout, glyphs, { staffSpace: params.staffSpace, margin: params.margin, canvasWidth: params.canvasWidth, showHidden: false, inlineImages: true, ink: '#000000', paper: '#ffffff', skipRoles: ['container-frame', 'container-handle', 'automation', 'automation-bg'] });
      return svg.replace(/(<svg[^>]*>)/, '$1<rect width="100%" height="100%" fill="#ffffff"/>');
    },
    /** Réglages d'affichage (largeur, taille de portée…) : invalide la mise en page. */
    setParams(next) { Object.assign(params, next); frozen = false; current = null; pending = null; layoutCache.store = {}; layoutCache.dirty = null; },
    /** Afficher (en gris) les éléments masqués ? Sans effet sur la mise en page : rien ne bouge. Un masqué non affiché quitte la sélection. */
    setShowHidden(on) {
      const next = !!on;
      if (next === showHidden) return false;
      showHidden = next;
      if (current) current = { layout: current.layout, ...renderAll() };
      if (!showHidden) selection.prune(exists);
      return true;
    },
    showHidden: () => showHidden,
    /** Muted notes in grey (true, the editor's default) or not drawn (false). The layout does not change. */
    setShowMuted(on) {
      const next = !!on;
      if (next === showMuted) return false;
      showMuted = next;
      if (current) current = { layout: current.layout, ...renderAll() };
      return true;
    },
    showMuted: () => showMuted,

    /**
     * Élément sous un point exprimé en pixels du SVG. `tolerance` : nombre ou 'mouse' | 'touch' (défaut : mouse).
     * @returns {{ref, role, type}|null}
     */
    hitTest(x, y, { tolerance = 'mouse' } = {}) {
      const t = typeof tolerance === 'number' ? tolerance : TOLERANCE[tolerance] ?? TOLERANCE.mouse;
      return fullIndex().hit(x, y, t);
    },

    // ---------- sélection ----------
    selection: () => selection.ids(),
    /** mode 'replace' (défaut) ou 'toggle' (Ctrl + clic). */
    select(ids, { mode = 'replace' } = {}) {
      const list = ids.filter((ref) => { const el = find(ref); return isSelectableElement(el) && (el.type !== 'decor' || decorAvailable(ref)); });
      return mode === 'toggle' ? selection.toggle(list) : selection.replace(list);
    },
    clearSelection: () => selection.clear(),
    onSelectionChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); },
    /** Boîtes (pixels du SVG) des éléments sélectionnés, pour une surcouche de surbrillance SÉPARÉE du SVG du moteur. */
    selectionRects() {
      const ids = new Set(selection.ids());
      return partialEntries(ids).map((e) => ({ ref: e.ref, role: e.role, ...e.rect }));
    },

    /**
     * Contours (pixels du SVG) des éléments sélectionnés, pour la surbrillance : `{ ref, role, kind: 'rect', x1, x2, y1, y2 }` (note,
     * glyphe, texte) ou `{ ref, role, kind: 'path', points, closed, strokeWidth }` (liaison, ligne, soufflet… : la forme elle-même, pas sa
     * boîte). Une entrée répartie sur plusieurs systèmes donne un contour par segment, tous liés au même `ref`.
     */
    selectionShapes() {
      const ids = new Set(selection.ids());
      const out = [];
      for (const e of partialEntries(ids)) {
        const o = e.outline();
        if (o) out.push({ ref: e.ref, role: e.role, ...o });
      }
      return out;
    },

    /**
     * Grip handles of a slur / tie / hammer-on / hairpin entry, in SVG pixels, one set per segment (per system the entry crosses).
     * Returns null for any other element. `{ kind: 'curve' | 'hairpin', id, scale, aperture, segments: [{ seg, handles: [{ key, x, y,
     * offset: [dx, dy] (staff spaces, y down), value? }] }] }`. Read-only: the editing goes through `app.setGrip` / `app.setAperture`.
     */
    gripHandles(id) {
      const found = doc.findListEntry(id);
      const kind = found && GRIP_KINDS[found.kind];
      if (!kind) return null;
      const ss = params.staffSpace;
      const margin = params.margin ?? 10;
      const segments = [];
      let seg = 0;
      for (const sys of build().layout.systems) {
        const ox = margin + sys.x0 * ss;
        const oy = sys.top * ss;
        const handles = [];
        let present = false;
        for (const staff of sys.staves) {
          const px = (x, y) => ({ x: ox + x * ss, y: oy + (staff.originY - y) * ss });
          const mine = staff.items.filter((it) => it.ref === id);
          if (!mine.length) continue;
          present = true;
          if (kind === 'curve') {
            const c = mine.find((it) => it.kind === 'curve');
            if (!c) continue;
            for (const [key, x, y] of [['start', c.x1, c.y1], ['c1', c.c1x, c.c1y], ['c2', c.c2x, c.c2y], ['end', c.x2, c.y2]]) {
              handles.push({ key, ...px(x, y), offset: gripOffset(found.entry, seg, key) });
            }
          } else {
            const lines = mine.filter((it) => it.kind === 'line' && it.role === 'hairpin');
            if (lines.length < 2) continue;
            const [a, b] = lines;
            handles.push({ key: 'start', ...px((a.x1 + b.x1) / 2, (a.y1 + b.y1) / 2), offset: gripOffset(found.entry, seg, 'start') });
            handles.push({ key: 'end', ...px((a.x2 + b.x2) / 2, (a.y2 + b.y2) / 2), offset: gripOffset(found.entry, seg, 'end') });
            // aperture: on the OUTER side of the staff (below a hairpin that lies below the staff, above one that lies above), at its
            // horizontal middle, on the outer edge of the wedge plus a small gap. Dragging outward opens the hairpin.
            const ys = staff.items.filter((it) => it.role === 'staff-line').map((it) => it.y1 ?? it.y).filter(Number.isFinite);
            const staffMid = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 2;
            const yMid = (a.y1 + b.y1 + a.y2 + b.y2) / 4;
            const above = yMid > staffMid;
            const halfMid = ((a.y1 - b.y1) + (a.y2 - b.y2)) / 4;
            const fullOpen = Math.max(a.y1 - b.y1, a.y2 - b.y2);
            const edge = px((a.x1 + a.x2 + b.x1 + b.x2) / 4, above ? yMid + halfMid : yMid - halfMid);
            const gap = 0.7 * ss;
            handles.push({ key: 'aperture', x: edge.x, y: edge.y + (above ? -gap : gap), value: fullOpen, outward: above ? -1 : 1, offset: [0, 0] });
          }
        }
        if (!present) continue; // same ordinal rule as layout/gripoffsets.js: a system counts when the entry has any item in it
        if (handles.length) segments.push({ seg, handles });
        seg += 1;
      }
      return segments.length ? { kind, id, scale: ss, aperture: gripAperture(found.entry), segments } : null;
    },

    /**
     * Boîtes (pixels du SVG) des éléments NON JOUÉS (réglage local faux : accord, note, symbole d'accord, ou note d'un accord muet),
     * pour une surcouche SÉPARÉE, activable ; jamais dans la mise en page ni dans le modèle.
     */
    mutedRects() {
      const isMuted = (ref) => {
        const el = doc.find(ref);
        if (!el) return false;
        if (localPlay(el) === false) return true;
        const parent = doc.parentOf(ref);
        return !!parent && parent.type === 'chord' && localPlay(parent) === false;
      };
      // the muted elements are found among the display items (one test per distinct reference), then only THEIR entries are built
      const memo = new Map();
      const mutedRefs = new Set();
      for (const sys of build().layout.systems) {
        for (const st of sys.staves) {
          for (const it of st.items) {
            if (!it.ref) continue;
            let m = memo.get(it.ref);
            if (m === undefined) { m = isMuted(it.ref); memo.set(it.ref, m); }
            if (m) mutedRefs.add(it.ref);
          }
        }
      }
      if (!mutedRefs.size) return [];
      return indexEntriesOf(mutedRefs).filter((e) => isMuted(e.baseRef ?? e.ref)).map((e) => ({ ref: e.ref, role: e.role, ...e.rect }));
    },

    // ---------- saisie de notes : clic sur une portée → portée, mesure, position, ligne (tranche « saisie de notes, interface ») ----------
    /**
     * Résout un point (pixels du SVG) en position de saisie, comme `Score::getPosition` de MuseScore (voir `staff-hit.js`) :
     * `{ staffId, staffType, measureId, measureIndex, position, itemId, line, lineCount, x, y, systemIndex }` ou null.
     * `position` = fraction exacte depuis le début du CONTENU de la mesure (celle de `placeChord`) ; `itemId` = élément de la voix 1 qui
     * COMMENCE là ; `line` = demi-interligne depuis la ligne du haut (notation, percussion) ou corde depuis le haut (tablature, 0 = corde 1).
     * Lecture seule : ne sélectionne rien et n'écrit rien.
     */
    staffHit(x, y, { preferredStaffId = null, voice = 0 } = {}) {
      const { layout } = build();
      const movement = mv();
      const staffInfo = (ref) => {
        const staff = doc.find(ref);
        if (!staff) return null;
        const tab = doc.get(staff, PID.STAFF_TYPE) === 'tab';
        // tablature : une ligne par corde de l'accordage (comme le peintre `tab`), pas `PID.LINE_COUNT`
        return { lines: tab ? tuningPitches(staff).length : staffLineCount(staff), lineDist: tab ? TAB_LINE_DISTANCE : 1, tab };
      };
      const itemsOf = (measure, mb, mi) => {
        const length = measureLengthOf(mb);
        let pos = measureOffsetOf(mb, mi === 0);
        // only what lasts (chords, rests): the events of a lyrics track sit at a position of their own and have no duration (a click on a measure that held a syllable failed)
        return (measure?.items ?? []).filter((item) => isApplicable(item.type, PID.DURATION)).map((item) => { const start = pos; pos = fAdd(pos, itemDuration(item, length)); return { item, start, end: pos }; });
      };
      // colonnes valables de la voix choisie : instants de TOUTE la mesure, règle de `getNextValidInputSegment` (voir input-columns.js)
      const slots = (ref, mi, v) => {
        const found = doc.find(ref);
        const staff = found && contentStaff(movement, found); // a linked staff shows the columns of its primary staff
        const mb = movement.masterbars[mi];
        if (!mb || !staff?.voices?.[0]?.measures?.[mi]) return [];
        const own = itemsOf(staff.voices[v]?.measures?.[mi], mb, mi);
        const instants = [];
        for (const track of movement.tracks) for (const st of track.staves) {
          for (const voiceEl of st.voices ?? []) for (const u of itemsOf(voiceEl.measures?.[mi], mb, mi)) instants.push(u.start);
        }
        return inputColumns(instants, own, v).map((start) => ({ start, item: own.find((u) => fEq(u.start, start))?.item ?? null }));
      };
      const v = voice;
      // a click in a container between measures is not a position in the music
      for (const sys of layout.systems) {
        const y1 = sys.top * params.staffSpace; const y2 = (sys.top + sys.height) * params.staffSpace;
        if (y < y1 || y > y2) continue;
        for (const [a, b] of sys.slotRanges ?? []) {
          if (x >= params.margin + (sys.x0 + a) * params.staffSpace && x <= params.margin + (sys.x0 + b) * params.staffSpace) return null;
        }
      }
      const hit = hitStaffPosition(layout, { x, y }, {
        staffSpace: params.staffSpace, margin: params.margin, preferredStaffId, staffInfo,
        columnsOf: (ref, mi) => slots(ref, mi, v).map((s) => s.start),
      });
      if (!hit) return null;
      const mb = movement.masterbars[hit.measureIndex];
      const slot = slots(hit.staffRef, hit.measureIndex, v)[hit.column];
      return {
        staffId: hit.staffRef, staffType: hit.staffType, measureId: hit.measureRef, measureIndex: hit.measureIndex,
        position: fSub(hit.position, measureOffsetOf(mb, hit.measureIndex === 0)), itemId: slot?.item?.id ?? null,
        line: hit.line, lineCount: hit.lineCount, x: hit.x, cx: hit.cx, y: hit.y, systemIndex: hit.systemIndex, voice: v,
      };
    },

    /**
     * Zones des portées d'un type donné (ex. 'accordion-left'), en pixels du SVG : [{ staffId, type, systemIndex, x1, x2, y1, y2 }] — du bord
     * gauche du système à sa fin, de la ligne du haut (4 sp) à celle du bas. Lecture seule ; sert à poser des barres flottantes.
     */
    staffZones(type) {
      const { layout } = build();
      const ss = params.staffSpace;
      const out = [];
      for (const sys of layout.systems) {
        const ox = params.margin + sys.x0 * ss;
        const oy = sys.top * ss;
        for (const st of sys.staves) {
          if (st.type !== type) continue;
          const last = sys.measures[sys.measures.length - 1];
          out.push({ staffId: st.ref, type, systemIndex: sys.index, x1: ox, x2: last ? ox + last.barX * ss : ox, y1: oy + (st.originY - 4) * ss, y2: oy + st.originY * ss });
        }
      }
      return out;
    },

    /**
     * Boîtes englobantes des CLÉS (éléments d'affichage de rôle 'clef') des portées d'un type donné, en pixels du SVG, avec une marge de
     * `pad` px : [{ staffId, type, systemIndex, x1, x2, y1, y2 }]. Lecture seule ; sert à faire de la clé un interrupteur (accordéon main gauche).
     */
    /** Tracks whose automation strip is drawn under them (a new Set each time: the layout parameters are compared by identity). */
    setAutomationTracks(ids) { autoTracks = ids && ids.size ? new Set(ids) : null; current = null; pending = null; layoutCache.store = {}; layoutCache.dirty = null; },
    setAutomationScale(k) { if (k === autoScale) return; autoScale = k; current = null; pending = null; layoutCache.store = {}; layoutCache.dirty = null; },
    /** Shows the master volume strip above the top staff (`on`), with the label the interface wants on it. */
    setMasterAutomation(on, label = null) { if (label != null) masterLabel = label; const next = on ? { label: masterLabel } : null; if (JSON.stringify(next) === JSON.stringify(masterAuto)) return; masterAuto = next; current = null; pending = null; layoutCache.store = {}; layoutCache.dirty = null; },
    masterAutomation: () => masterAuto,
    setAutomationParams(map) { autoParams = map && map.size ? new Map(map) : null; current = null; pending = null; layoutCache.store = {}; layoutCache.dirty = null; },
    automationScale: () => autoScale,
    automationTracks: () => autoTracks,
    /**
     * Geometry of the automation strips in pixels of the SVG, one per system and track:
     * [{ trackId, systemIndex, x1, x2, y1, y2, yMute1, yMute2, yVol0, yVol1, grid: [{ abs, x, level }], firstAbs, lastAbs }] (y down). Read only.
     */
    automationStrips(trackId = null) {
      const { layout } = build();
      const ss = params.staffSpace;
      const out = [];
      for (const sys of layout.systems) {
        const list = sys.automation;
        if (!list) continue;
        const ox = params.margin + sys.x0 * ss;
        const oy = sys.top * ss;
        for (const s of list) {
          if (trackId && s.trackId !== trackId) continue;
          const st = sys.staves.find((x) => x.ref === s.staffRef);
          if (!st) continue;
          const py = (y) => oy + (st.originY - y) * ss;
          out.push({ trackId: s.trackId, param: s.param ?? 'volume', steps: s.steps ?? 127, systemIndex: sys.index, x1: ox + s.x1 * ss, x2: ox + s.x2 * ss, y1: py(s.top), y2: py(s.bottom), yMute1: py(s.top), yMute2: py(s.yVol1), yVol0: py(s.yVol0), yVol1: py(s.yVol1),
            grid: s.grid.map((g) => ({ abs: g.abs, x: ox + g.x * ss, level: g.level })), firstAbs: s.firstAbs, lastAbs: s.lastAbs, ...(s.range ? { range: s.range } : {}) });
        }
      }
      return out;
    },

    clefZones(type, { pad = 6 } = {}) {
      const { layout } = build();
      const ss = params.staffSpace;
      const out = [];
      for (const sys of layout.systems) {
        const ox = params.margin + sys.x0 * ss;
        const oy = sys.top * ss;
        for (const st of sys.staves) {
          if (st.type !== type) continue;
          let r = null;
          for (const it of st.items) {
            if (it.role !== 'clef' && !(typeof it.sel === 'string' && it.sel.includes('|clef|'))) continue;
            const b = itemRect(it, glyphs);
            if (!b || !Number.isFinite(b.x1 + b.x2 + b.y1 + b.y2)) continue;
            r = r ? { x1: Math.min(r.x1, b.x1), x2: Math.max(r.x2, b.x2), y1: Math.min(r.y1, b.y1), y2: Math.max(r.y2, b.y2) } : { ...b };
          }
          if (!r) continue;
          out.push({ staffId: st.ref, type, systemIndex: sys.index, x1: ox + r.x1 * ss - pad, x2: ox + r.x2 * ss + pad, y1: oy + (st.originY - r.y2) * ss - pad, y2: oy + (st.originY - r.y1) * ss + pad });
        }
      }
      return out;
    },

    // ---------- cases de saisie des symboles d'accord (tranche 6) ----------
    /**
     * Cases des portées d'accords, en pixels du SVG : [{ staffId, measureId, cell, systemIndex, x1, x2, y1, y2, symbolId, active }].
     * Chaque case va de son début (colonne du moteur, `xAt`) au début de la suivante, ou à la barre de fin de mesure.
     */
    cellZones() {
      const { layout } = build();
      const ss = params.staffSpace;
      const out = [];
      for (const sys of layout.systems) {
        const ox = params.margin + sys.x0 * ss;
        const oy = sys.top * ss;
        for (const st of sys.staves) {
          if (st.type !== 'chord') continue;
          const staff = doc.find(st.ref);
          if (!staff) continue;
          const movement = doc.movementOf(staff);
          for (const m of sys.measures) {
            const mb = movement.masterbars[m.index];
            const measure = staff.voices[0]?.measures[m.index];
            if (!mb || !measure) continue;
            const cells = inputGridOf(mb, m.index === 0);
            const lefts = cells.map((c, i) => (i === 0 ? m.x : (sys.xAt ? sys.xAt(m.index, c.start) : m.x + (m.barX - m.x) * (i / cells.length))));
            cells.forEach((c, i) => {
              const sym = measure.items.find((x) => x.type === 'chordsymbol' && fEq(x.props[PID.POSITION] ?? [0, 1], c.start));
              const zone = {
                staffId: st.ref, measureId: m.ref, cell: i, systemIndex: sys.index,
                x1: ox + lefts[i] * ss, x2: ox + (i + 1 < cells.length ? lefts[i + 1] : m.barX) * ss,
                y1: oy + (st.originY - 4.8) * ss, y2: oy + (st.originY + 0.8) * ss,
                symbolId: sym ? sym.id : null,
              };
              zone.active = sameCell(activeCell, zone);
              out.push(zone);
            });
          }
        }
      }
      return out;
    },
    /**
     * Curseur de lecture : position d'une barre fine, en pixels du SVG, pour une mesure du Mouvement affiché et une position (fraction exacte
     * depuis le début du contenu de la mesure). `{ x, y1, y2, systemIndex }`, ou null si la mesure n'est pas affichée (autre Mouvement,
     * hors mise en page). Lecture seule : ne modifie ni le Document ni la sélection.
     * @param {{ movement?: number, measure: number, position?: [number, number] }} where  `movement` = indice dans l'œuvre (défaut : celui de la vue)
     */
    /** The band of blocks of the shown movement in pixels of the SVG: { x, y, w, h, widthSp } or null (no block: no band). Read only. */
    bandRect() {
      const sys = build().layout.systems[0];
      if (!sys?.band) return null;
      const ss = params.staffSpace;
      return { x: params.margin + (sys.x0 + sys.band.x) * ss, y: sys.top * ss, w: sys.band.w * ss, h: sys.band.h * ss, fitH: (sys.band.fitH ?? sys.band.h) * ss, fitManual: !!sys.band.fitManual, widthSp: sys.band.w };
    },
    playCursor({ movement: movementIndex, measure, position = [0, 1] }) {
      const shown = doc.work.movements.indexOf(mv());
      if (movementIndex != null && movementIndex !== shown) return null;
      const { layout } = build();
      const ss = params.staffSpace;
      for (const sys of layout.systems) {
        const m = sys.measures.find((x) => x.index === measure);
        if (!m || !sys.staves.length) continue;
        const masterbar = mv().masterbars[measure];
        // le curseur compte depuis le début du CONTENU de la mesure ; les colonnes du moteur depuis la mesure nominale (anacrouse)
        const nominal = masterbar ? fAdd(position, measureOffsetOf(masterbar, measure === 0)) : position;
        const xs = sys.xAt ? sys.xAt(measure, nominal) : m.x;
        const first = sys.staves[0].originY;
        const last = sys.staves[sys.staves.length - 1].originY;
        return { x: params.margin + (sys.x0 + (Number.isFinite(xs) ? xs : m.x)) * ss, y1: (sys.top + first - 5) * ss, y2: (sys.top + last + 1) * ss, systemIndex: sys.index };
      }
      return null;
    },
    /**
     * Rectangle du CURSEUR DE SAISIE (pixels du SVG) : { x, y1, y2, w, systemIndex } ou null si la portée / la mesure n'est pas affichée.
     * `c` = { staffId, measureIndex, position } (position depuis le début du CONTENU de la mesure). x = origine de la colonne (bord gauche de la
     * tête) moins 0,4 sp ; hauteur = la portée plus une demi-interligne de chaque côté. Lecture seule.
     */
    entryCursorRect(c) {
      if (!c) return null;
      const { layout } = build();
      const ss = params.staffSpace;
      const staff = doc.find(c.staffId);
      const masterbar = mv().masterbars[c.measureIndex];
      if (!staff || !masterbar) return null;
      for (const sys of layout.systems) {
        const m = sys.measures.find((x) => x.index === c.measureIndex);
        const st = sys.staves.find((x) => x.ref === c.staffId);
        if (!m || !st) continue;
        const nominal = fAdd(c.position, measureOffsetOf(masterbar, c.measureIndex === 0));
        const xs = sys.xAt ? sys.xAt(c.measureIndex, nominal) : m.x;
        const tab = doc.get(staff, PID.STAFF_TYPE) === 'tab';
        const lines = tab ? tuningPitches(staff).length : staffLineCount(staff);
        const height = (lines - 1) * (tab ? TAB_LINE_DISTANCE : 1);
        const bottom = sys.top + st.originY;
        return {
          x: params.margin + (sys.x0 + (Number.isFinite(xs) ? xs : m.x) - 0.4) * ss, w: 0.2 * ss,
          y1: (bottom - height - 0.5) * ss, y2: (bottom + 0.5) * ss, systemIndex: sys.index,
          // y (pixels) of string n (1 = the highest) of a tablature staff
          ...(tab ? { stringY: (n) => (bottom - height + (n - 1) * TAB_LINE_DISTANCE) * ss } : {}),
        };
      }
      return null;
    },
    /** Case sous un point (pixels du SVG), ou null ; la tolérance élargit la zone (doigt : cible ≥ 44 px de haut, déjà assurée par la hauteur). */
    hitCell(x, y, { tolerance = 0 } = {}) {
      const t = typeof tolerance === 'number' ? tolerance : TOLERANCE[tolerance] ?? 0;
      const zones = this.cellZones().filter((z) => x >= z.x1 - t && x <= z.x2 + t && y >= z.y1 - t && y <= z.y2 + t);
      if (!zones.length) return null;
      // la plus proche du centre en x si plusieurs (zones qui se touchent)
      return zones.sort((a, b) => Math.abs(x - (a.x1 + a.x2) / 2) - Math.abs(x - (b.x1 + b.x2) / 2))[0];
    },
    activeCell: () => (activeCell ? { ...activeCell } : null),
    /** Active une case (adresse { staffId, measureId, cell }) ou aucune (null). N'écrit rien dans le Document. */
    setActiveCell(c) { return setActive(c && cellExists(c) ? c : null); },
    onCellChange(fn) { cellListeners.add(fn); return () => cellListeners.delete(fn); },

    // ---------- mesure choisie, zones de mesure et bande de boucle (lecteur) ----------
    /** Un espace de portée, en pixels du SVG (sert à exprimer des marges en espaces de portée, ex. le suivi de l'affichage). */
    staffSpace: () => params.staffSpace,
    /** Indice du Mouvement affiché dans l'œuvre (celui que le lecteur désigne par `movement`). */
    movementIndex: () => doc.work.movements.indexOf(mv()),
    /** The movement shown (an element: a nested fragment has no index in the work). */
    movement: () => mv(),
    /** Id of the movement shown (for a nested fragment: its own id). */
    movementId: () => mv().id,
    /** Shows another movement of the work (by id; the selection, range, active cell and chosen measure are dropped). Returns false when nothing changes. */
    setMovementId(id) {
      const target = doc.work.movements.find((m) => m.id === id) ?? doc.work.movements[0];
      if (!target || target === mv()) return false;
      shownId = target.id;
      selection.clear(); setActive(null); setMeasure(null); setRangeState(null);
      frozen = false; current = null; pending = null; layoutCache.store = {}; layoutCache.dirty = null;
      return true;
    },
    /** Indice de mesure d'un masterbar du Mouvement affiché, ou -1. */
    measureIndexOf: (measureId) => mv().masterbars.findIndex((b) => b.id === measureId),
    /**
     * Zones des mesures, en pixels du SVG : [{ measureId, index, systemIndex, x1, x2, y1, y2 }] — de la colonne d'ouverture de la mesure à sa
     * barre de fin, sur toute la hauteur du système (la boucle ne dépend que du masterbar, pas des portées).
     */
    measureZones() {
      const { layout } = build();
      const ss = params.staffSpace;
      const out = [];
      for (const sys of layout.systems) {
        if (!sys.staves.length) continue;
        const ox = params.margin + sys.x0 * ss;
        const first = sys.staves[0].originY, last = sys.staves[sys.staves.length - 1].originY;
        for (const m of sys.measures) {
          out.push({ measureId: m.ref, index: m.index, systemIndex: sys.index, x1: ox + m.x * ss, x2: ox + m.barX * ss, y1: (sys.top + first - 5) * ss, y2: (sys.top + last + 1) * ss });
        }
      }
      return out;
    },
    /**
     * Haut (pixels du SVG, 1re ligne de la portée) de la portée la plus proche d'une ordonnée de la partition, ou null — sert à poser les
     * barres flottantes AU-DESSUS de la portée de l'élément sélectionné, pas seulement au-dessus de l'élément.
     */
    /**
     * One row per track of the FIRST system (pixels of the SVG): where its first staff starts and how much room there is above it (down to the previous staff,
     * or to the section name cards for the first track). For the controls drawn at the start of each track (`ui/track-controls.js`).
     */
    trackRows() {
      const { layout } = build();
      const sys = layout.systems[0]; if (!sys) return [];
      const ss = params.staffSpace;
      const strip = sys.sectionStrip && sys.sections?.length ? (sys.top + sys.sectionStrip.y + sys.sectionStrip.h) * ss : 0;
      const rows = []; let prevBottom = null; const seen = new Set();
      for (const st of sys.staves) {
        let h = 0;
        for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
        if (!h) h = 4;
        const bottom = (sys.top + st.originY) * ss; const top = bottom - h * ss;
        if (!seen.has(st.trackId)) { seen.add(st.trackId); rows.push({ trackId: st.trackId, top, gap: top - (prevBottom ?? strip) }); }
        prevBottom = bottom;
      }
      return rows;
    },
    /**
     * Where the system signs (tempo, voltas, jumps, markers, rehearsal marks) are shown for a window whose top is `windowTop` (pixels of the SVG).
     * They keep their x; vertically they sit above the first COMPLETE staff the window shows (a staff cut by the top edge does not count), or above
     * the staff below when the gap over that staff is too small for them. Returns [{ system, dy }] (pixels, added to the signs' own position);
     * view only: nothing is written in the document and the layout is untouched.
     */
    signTargets(windowTop) {
      const { layout } = build();
      const ss = params.staffSpace;
      const out = [];
      for (const sys of layout.systems) {
        const geo = sys.staves.map((st) => {
          let h = 0;
          for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
          if (!h) h = 4;
          const bottom = (sys.top + st.originY) * ss;
          return { st, bottom, top: bottom - h * ss, h };
        });
        const home = geo.findIndex((g) => g.st.items.some((it) => it.sysSign));
        if (home < 0) continue;
        let need = 0; // height of the signs above the top line of their home staff, in staff spaces
        for (const it of geo[home].st.items) if (it.sysSign) { const r = itemRect(it, glyphs); if (r) need = Math.max(need, r.y2 - geo[home].h); }
        need = Math.max(need, 1.5) + 0.5;
        const sysBottom = geo[geo.length - 1].bottom;
        if (sysBottom < windowTop || geo[0].top > windowTop) continue; // above the window, or entirely below its top: the signs stay home
        let k = geo.findIndex((g, i) => i >= home && g.top >= windowTop);
        if (k < 0) k = geo.length - 1; // no complete staff left in this system: the last one carries them
        // not enough room over that staff: the staff below takes them (the gap over a staff is measured to the staff above it)
        // (one step only: in a dense score every gap is small, walking down further would send the signs to the bottom of the system)
        const roomOver = (i) => (i > 0 ? (geo[i].top - geo[i - 1].bottom) / ss : Infinity);
        if (k > 0 && roomOver(k) < need && k < geo.length - 1) {
          if (roomOver(k + 1) >= need || roomOver(k + 1) > roomOver(k)) k += 1;
        }
        if (k === home) continue;
        out.push({ system: sys.index, dy: geo[k].bottom - geo[home].bottom });
      }
      return out;
    },
    staffTopNear(y) { return this.staffBoundsNear(y)?.top ?? null; },
    /** { top, bottom } (pixels du SVG) de la portée la plus proche d'une ordonnée : pour poser une barre au-dessus OU en dessous de la portée de l'élément. */
    staffBoundsNear(y) {
      const { layout } = build();
      const ss = params.staffSpace;
      let best = null, bestD = Infinity;
      for (const sys of layout.systems) {
        for (const st of sys.staves) {
          // originY = ligne du BAS ; les lignes (rôle 'staff-line') ont y vers le HAUT depuis elle ; sans lignes (portée d'accords) : barres
          let h = 0;
          for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
          if (!h) h = 4;
          const bottom = (sys.top + st.originY) * ss;
          const top = bottom - h * ss;
          const d = Math.abs(y - (top + bottom) / 2);
          if (d < bestD) { bestD = d; best = { top, bottom }; }
        }
      }
      return best;
    },
    /**
     * Boîte englobante (pixels du SVG) des MARQUES (articulations, nuance, arpège, trémolo…) qui appartiennent aux accords des éléments
     * sélectionnés (accord, note d'un accord, ou marque d'un accord) — sert à poser la barre flottante AU-DESSUS d'elles pour qu'on puisse
     * les voir et les sélectionner. Lecture seule ; null si aucune marque.
     */
    selectionMarksBounds() {
      const chords = new Set();
      const selected = new Set(selection.ids());
      const entries = indexEntriesOf(selected);
      for (const id of selection.ids()) {
        if (parseDecorId(id)) continue; // décor (clé, armure, barre…) : son baseRef est la PORTÉE, pas un accord (sinon la boîte couvrirait tous les systèmes)
        const own = entries.find((e) => e.ref === id);
        if (own?.baseRef && own.baseRef !== id) { chords.add(own.baseRef); continue; }
        const el = doc.find(id);
        if (!el) continue;
        if (el.type === 'chord') chords.add(id);
        else { const p = doc.parentOf(id); if (p?.type === 'chord') chords.add(p.id); }
      }
      if (!chords.size) return null;
      // list entries (hairpin, slur, tie, hammer-on, guitar technique line, bend, glissando, trill, fingering, breath…) that START, END or sit
      // on a selected chord (or on one of its notes) also count: their marks are drawn above / below the staff like the chord's own marks.
      // They are looked for in the lists of the staves of the selected chords (and the notes' own lists), not in the whole page.
      const chordOfNote = (noteId) => { const p = doc.parentOf(noteId); return p?.type === 'chord' ? p.id : null; };
      const touching = new Set();
      const staves = new Set();
      for (const cid of chords) {
        let el = doc.find(cid);
        const chord = el;
        while (el && el.type !== 'staff') el = doc.parentOf(el.id);
        if (el) staves.add(el);
        for (const n of chord?.notes ?? []) for (const f of n.props?.[PID.FINGERINGS] ?? []) if (f?.id) touching.add(f.id);
      }
      for (const st of staves) {
        for (const [pid] of STAFF_LIST_KINDS) {
          for (const en of st.props?.[pid] ?? []) {
            if (!en?.id) continue;
            const ids = [en.startChordId, en.endChordId, en.chordId, en.afterId, en.itemId];
            for (const nid of [en.startNoteId, en.endNoteId]) if (nid) ids.push(chordOfNote(nid));
            if (ids.some((id) => id && chords.has(id))) touching.add(en.id);
          }
        }
      }
      let b = null;
      for (const e of indexEntriesOf(new Set([...chords, ...touching]))) {
        const chordMark = e.baseRef && e.baseRef !== e.ref && chords.has(e.baseRef);
        if (!chordMark && !(e.listEntry && touching.has(e.ref))) continue;
        const r = e.rect;
        if (!r) continue;
        b = b ? { x1: Math.min(b.x1, r.x1), x2: Math.max(b.x2, r.x2), y1: Math.min(b.y1, r.y1), y2: Math.max(b.y2, r.y2) } : { x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y2 };
      }
      return b;
    },
    /**
     * Changes the size of the writing (pixels per staff space) WITHOUT laying the score out again: the layout is in staff spaces, so only the SVG and the hit index are made again.
     * For the one-system view (nothing depends on the size there; a wrapped score is cut into lines by its width in spaces and needs `setParams`). Returns false when nothing changed
     * or when the layout is not a single system.
     */
    setStaffSpace(ss) {
      if (!(ss > 0) || ss === params.staffSpace) return false;
      if (current && current.layout.systems.length > 1) return false;
      params.staffSpace = ss;
      if (current) { current.svg = null; current.index = null; }
      return true;
    },
    /**
     * The frame of ONE measure on ONE staff, in pixels of the SVG: { x1, x2, y1, y2, staves } (the staff lines with a little room above and below; `staves` = the ids of the staves of
     * its system, top to bottom). A staff that is not in the system of the measure falls back to the first one; null when the measure does not exist. The measure bar of the
     * focus mode (`ui/measure-focus.js`) scrolls to it.
     */
    focusFrame(measureId, staffId) {
      const { layout } = build();
      const ss = params.staffSpace;
      for (const sys of layout.systems) {
        const m = sys.measures.find((x) => x.ref === measureId);
        if (!m || !sys.staves.length) continue;
        const st = sys.staves.find((s) => s.ref === staffId) ?? sys.staves[0];
        let h = 0;
        for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
        if (!h) h = 4;
        const bottom = (sys.top + st.originY) * ss;
        const ox = params.margin + sys.x0 * ss;
        return { x1: ox + m.x * ss, x2: ox + m.barX * ss, y1: bottom - (h + 3) * ss, y2: bottom + 3 * ss, staves: sys.staves.map((s) => s.ref), staff: st.ref, systemIndex: sys.index };
      }
      return null;
    },
    /** Mesure sous un point (pixels du SVG), ou null. */
    hitMeasure(x, y) {
      return this.measureZones().find((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) ?? null;
    },
    chosenMeasure: () => chosenMeasure,
    /** Choisit une mesure (identifiant du masterbar) ou aucune (null) ; vide la sélection et la case active. N'écrit rien dans le Document. */
    setChosenMeasure(id) {
      const next = id && measureExists(id) ? id : null;
      const changed = setMeasure(next);
      if (next) { selection.clear(); setActive(null); }
      return changed;
    },
    onMeasureChange(fn) { measureListeners.add(fn); return () => measureListeners.delete(fn); },
    // ---------- plage (portées × temps) ----------
    /** Plage courante (copie) ou null. */
    range: () => (rangeState ? JSON.parse(JSON.stringify(rangeState)) : null),
    /**
     * Pose une plage `{ staffIds, from: { measureId, position }, to: { measureId, position } }` (normalisée : bornes accrochées aux instants,
     * étendue aux n-olets / trémolos entiers) ; null l'efface. Vide la sélection, la case active et la mesure choisie. N'écrit rien dans le Document.
     */
    setRange(range) {
      const next = range ? normalizeRange(doc, mv(), range) : null;
      const changed = setRangeState(next);
      if (next) { selection.clear(); setActive(null); setMeasure(null); }
      return changed;
    },
    onRangeChange(fn) { rangeListeners.add(fn); return () => rangeListeners.delete(fn); },
    /**
     * Bandes de la plage, en pixels du SVG : une par portée et par système touché
     * `{ staffId, systemIndex, x1, x2, y1, y2, startHandle?: { x, y }, endHandle?: { x, y } }` (poignée de DÉBUT : bord gauche de la bande de la
     * 1re portée du 1er système ; de FIN : bord droit de la bande de la dernière portée du dernier système).
     */
    rangeBands(r = rangeState) {
      if (!r) return [];
      const movement = mv();
      const span = rangeMeasureSpan(movement, r);
      if (!span) return [];
      const { layout } = build();
      const ss = params.staffSpace;
      const ids = r.staffIds;
      const out = [];
      const xOf = (sys, mi, pos, isEnd) => {
        const m = sys.measures.find((q) => q.index === mi);
        if (isEnd && fEq(pos, contentLength(movement, mi))) return m.barX;
        if (!isEnd && fEq(pos, [0, 1])) return m.x;
        const xs = sys.xAt ? sys.xAt(mi, fAdd(pos, measureOffsetOf(movement.masterbars[mi], mi === 0))) : m.x;
        return Number.isFinite(xs) ? xs - (isEnd ? 0 : 0.5) : m.x;
      };
      const endIndex = span.last;
      let firstSys = null, lastSys = null;
      for (const sys of layout.systems) if (sys.measures.some((q) => q.index >= span.first && q.index <= endIndex)) { firstSys ??= sys; lastSys = sys; }
      for (const sys of layout.systems) {
        const inSys = sys.measures.filter((q) => q.index >= span.first && q.index <= endIndex);
        if (!inSys.length) continue;
        const a = inSys[0].index === span.first ? xOf(sys, span.first, r.from.position, false) : inSys[0].x;
        const z = inSys[inSys.length - 1].index === endIndex ? xOf(sys, endIndex, r.to.position, true) : inSys[inSys.length - 1].barX;
        const staves = sys.staves.filter((st) => ids.includes(st.ref));
        staves.forEach((st, k) => {
          let h = 0;
          for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
          if (!h) h = 4;
          const bottom = sys.top + st.originY;
          const band = { staffId: st.ref, systemIndex: sys.index, x1: params.margin + (sys.x0 + a) * ss, x2: params.margin + (sys.x0 + z) * ss, y1: (bottom - h - 0.5) * ss, y2: (bottom + 0.5) * ss };
          if (sys === firstSys && k === 0) band.startHandle = { x: band.x1, y: band.y1 };
          if (sys === lastSys && k === staves.length - 1) band.endHandle = { x: band.x2, y: band.y2 };
          // poignées verticales : milieu du bord haut de la 1re portée du 1er système, milieu du bord bas de la dernière du dernier
          if (sys === firstSys && k === 0) band.topHandle = { x: (band.x1 + band.x2) / 2, y: band.y1 };
          if (sys === lastSys && k === staves.length - 1) band.bottomHandle = { x: (band.x1 + band.x2) / 2, y: band.y2 };
          out.push(band);
        });
      }
      return out;
    },
    /**
     * Portée (identifiant) dont la bande est la plus proche de y (pixels du SVG) dans un système donné, parmi TOUTES les portées du système ;
     * sert à glisser les poignées haut / bas de la plage. Null si le système n'existe pas.
     */
    staffAtY(y, systemIndex) {
      const { layout } = build();
      const sys = layout.systems.find((q) => q.index === systemIndex);
      if (!sys) return null;
      const ss = params.staffSpace;
      let best = null, bestD = Infinity;
      for (const st of sys.staves) {
        let h = 0;
        for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
        if (!h) h = 4;
        const bottom = sys.top + st.originY;
        const y1 = (bottom - h) * ss, y2 = bottom * ss;
        const d = y < y1 ? y1 - y : y > y2 ? y - y2 : 0;
        const dc = Math.abs(y - (y1 + y2) / 2);
        if (d < bestD || (d === bestD && dc < Math.abs(y - best.c))) { bestD = d; best = { id: st.ref, c: (y1 + y2) / 2 }; }
      }
      return best?.id ?? null;
    },
    /**
     * Point de plage sous un point (pixels du SVG), pour glisser une poignée : `{ measureId, position }` de la borne la plus proche (en x) parmi les
     * instants des portées de la plage (ou `staffIds` donnés) dans la mesure sous le pointeur ; le système est celui dont la bande verticale est la
     * plus proche de y. Null hors de toute mesure.
     */
    rangePointAt(x, y, staffIds = rangeState?.staffIds) {
      const movement = mv();
      const staves = resolveStaves(movement, staffIds);
      if (!staves) return null;
      const zones = this.measureZones();
      if (!zones.length) return null;
      const bySystem = [...new Set(zones.map((z) => z.systemIndex))].map((si) => {
        const zs = zones.filter((z) => z.systemIndex === si);
        return { si, zs, d: y < zs[0].y1 ? zs[0].y1 - y : y > zs[0].y2 ? y - zs[0].y2 : 0 };
      }).sort((p, q) => p.d - q.d)[0];
      const zs = bySystem.zs;
      const zone = zs.find((z) => x >= z.x1 && x <= z.x2) ?? (x < zs[0].x1 ? zs[0] : zs[zs.length - 1]);
      const { layout } = build();
      const ss = params.staffSpace;
      const sys = layout.systems.find((q) => q.index === zone.systemIndex);
      const mi = zone.index;
      const m = sys.measures.find((q) => q.index === mi);
      const offset = measureOffsetOf(movement.masterbars[mi], mi === 0);
      const content = contentLength(movement, mi);
      let best = null, bestD = Infinity;
      for (const pos of rangeBoundaries(movement, staves, mi)) {
        let px;
        if (fEq(pos, content)) px = zone.x2;
        else if (fEq(pos, [0, 1])) px = zone.x1;
        else { const xs = sys.xAt ? sys.xAt(mi, fAdd(pos, offset)) : m.x; px = params.margin + (sys.x0 + (Number.isFinite(xs) ? xs : m.x)) * ss; }
        const d = Math.abs(x - px);
        if (d < bestD) { bestD = d; best = pos; }
      }
      return { measureId: movement.masterbars[mi].id, position: best };
    },

    /** Mesure visée par les boutons de boucle / de lecture : la mesure choisie, sinon celle de la case active, sinon null. */
    targetMeasureId: () => chosenMeasure ?? activeCell?.measureId ?? null,
    /**
     * Bandes de la boucle `{ from, to }` (indices de mesure du Mouvement affiché, inclus) : une par système touché
     * `{ systemIndex, x1, x2, y1, y2, start, end }` (`start` : elle porte le repère A, `end` : le repère B).
     */
    loopBands({ from, to }) {
      const zones = this.measureZones().filter((z) => z.index >= from && z.index <= to);
      const out = [];
      for (const z of zones) {
        const band = out.find((b) => b.systemIndex === z.systemIndex);
        if (band) { band.x1 = Math.min(band.x1, z.x1); band.x2 = Math.max(band.x2, z.x2); }
        else out.push({ systemIndex: z.systemIndex, x1: z.x1, x2: z.x2, y1: z.y1, y2: z.y2, start: false, end: false });
        const b = out.find((x) => x.systemIndex === z.systemIndex);
        if (z.index === from) b.start = true;
        if (z.index === to) b.end = true;
      }
      return out;
    },

    // ---------- annuler / refaire ----------
    /** État de la vue rangé dans la transaction par l'Application. */
    viewState: () => ({ selection: { ids: selection.ids() }, activeCell: activeCell ? { ...activeCell } : null, measure: chosenMeasure, range: rangeState ? JSON.parse(JSON.stringify(rangeState)) : null }),
    restoreViewState(state) {
      if (state && 'activeCell' in state) setActive(cellExists(state.activeCell) ? state.activeCell : null);
      const changed = selection.replace((state?.selection?.ids ?? []).filter(exists));
      if (state && 'measure' in state) setMeasure(measureExists(state.measure) ? state.measure : null);
      if (state && 'range' in state) setRangeState(state.range ? normalizeRange(doc, mv(), state.range) : null);
      return changed;
    },

    dispose() { if (!disposed) { disposed = true; unsubscribe(); changeListeners.clear(); cellListeners.clear(); measureListeners.clear(); rangeListeners.clear(); } },
  };
}
