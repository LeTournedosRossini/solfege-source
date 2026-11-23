/*
 * Contexte de mise en page d'un Mouvement : portées à plat (avec leur peintre), longueurs de mesure, éléments de chaque
 * mesure par portée, plus courte durée du morceau (référence de l'espacement logarithmique).
 */
import { projectLinkedStaff, isLinkedStaff, primaryOf } from '../model/linkedstaff.js';
import { PID, SID, getProperty, trackTransposition, intervalIsZero, writtenKey, measureLengthOf, measureOffsetOf, isMeasureRest, frac, fMin, capoTimeline, capoAt, NO_CAPO, tuningChanges, tuningAt, displayOfTrack, displaySpec } from '../model/index.js';
import { staffPainterFor, emptyPainter } from './painters/index.js';
import { resolveMeasureBreaths } from './breaths.js';
import { createLayoutMemo } from './memo.js';
import { staffHasLyrics } from './painters/resolved.js';
import { lyricBoxesFor } from './lyrics.js';
import { attachGridLyricBoxes } from './gridlyrics.js';
import { clefTimeline, clefAt, clefAtMeasureStart, clefChangeAt, clefChangeEndingMeasure } from './clefchanges.js';
import { buildSlots } from './slots.js';
import { shimStaff, nestedRefOptions } from './nestedshim.js';
import { nestedStaves } from '../model/containerstaves.js';
import { compositeStaffByMeasure, compositeById } from '../model/composite.js';

export function buildContext(movement, glyphs, style, { chordQualities, lyricTexts, preferredVoicings, transpositionTrack, noTranspose, staffFilter, trackDisplay = null, composites = null, reuse = null } = {}) {
  const warnings = [];
  const barLengths = movement.masterbars.map(measureLengthOf);
  const keySigs = movement.masterbars.map((mb) => getProperty(mb, PID.KEY_SIG));
  // par mesure : chiffrage, groupement de ligatures, décalage d'anacrouse (les temps s'alignent sur la mesure complète)
  const timeSigs = movement.masterbars.map((mb) => getProperty(mb, PID.TIME_SIG));
  const beamGroupings = movement.masterbars.map((mb) => getProperty(mb, PID.BEAM_GROUPING));
  const offsets = movement.masterbars.map((mb, i) => measureOffsetOf(mb, i === 0));
  const base = { glyphs, style, chordQualities, lyricTexts, preferredVoicings, warnings, barLengths, keySigs, timeSigs, beamGroupings, offsets, minDuration: frac(1, 4), memo: createLayoutMemo() };

  const staves = [];
  const msig = movement.masterbars.map((b) => b.id).join('|');
  // projected linked staves (model/linkedstaff.js): those of the previous layout give the measures no change touched (same measures, same masterbars)
  const projections = new Map();
  const projectionReuse = (staff) => (reuse && reuse.msig === msig && reuse.projections?.has(staff.id) ? { prev: reuse.projections.get(staff.id), isClean: reuse.isClean } : null);
  // portées de la même piste (portées croisées) : fonction paresseuse, les portées sont toutes créées quand on s'en sert
  base.siblingsOf = (staff) => { const me = staves.find((x) => x.staff === staff); return me ? staves.filter((x) => x.track === me.track) : null; };
  const concertPitch = style(SID.CONCERT_PITCH);
  // hidden tracks / staves (`PID.VISIBLE` false): not drawn and given no room (they still play). Never hide everything: if no staff would remain, all are shown.
  // `staffFilter` (a part of screen 2): a Set of staff ids = exactly these staves, whatever screen 1 hides
  // composite staves (model/composite.js): a track drawn as ONE staff that shows, measure by measure, one of its own staves. Only the staves the composite uses are laid out.
  const anyOfTrackShown = (track) => (staffFilter ? track.staves.some((s) => staffFilter.has(s.id)) : getProperty(track, PID.VISIBLE) !== false);
  const compositeOf = new Map(); // track id → { composite, byMeasure (staff id per measure), used (Set of staff ids) }
  for (const track of movement.tracks) {
    if (anyOfTrackShown(track) === false) continue; // a track the screen hides stays hidden
    const composite = composites?.get?.(track.id) ?? (() => { const id = (trackDisplay ? trackDisplay(track) : displayOfTrack(track)).composite; return id ? compositeById(track, id) : null; })();
    if (!composite || !track.staves.length) continue;
    const byMeasure = compositeStaffByMeasure(movement, track, composite);
    compositeOf.set(track.id, { composite, byMeasure, used: new Set(byMeasure) });
  }
  const isShown = (track, staff) => (compositeOf.has(track.id) ? compositeOf.get(track.id).used.has(staff.id) : staffFilter ? staffFilter.has(staff.id) : getProperty(track, PID.VISIBLE) !== false && getProperty(staff, PID.VISIBLE) !== false);
  const anyShown = movement.tracks.some((t) => t.staves.some((s) => isShown(t, s)));
  // staff reference (painter + per-staff context): also used for nested staves of the staff containers (layout/containers.js)
  // opts (nested scores of the containers): `transpose` false = no transposition; `keySigs` / `timeSigs` / `beamGroupings` = signatures of their own
  const makeRef = (track, staff, indexInTrack = 0, opts = {}) => {
      const type = getProperty(staff, PID.STAFF_TYPE);
      let painter = staffPainterFor(type);
      if (!painter) {
        warnings.push(`Aucun peintre pour le type de portée « ${type} » : portée ${staff.id} dessinée vide`);
        painter = emptyPainter;
      }
      // clé en vigueur (changements en cours de morceau, `PID.CLEF_CHANGES` de CETTE portée) : fonctions closures sur son
      // horaire, exposées au peintre via son ctx (chaque portée a son propre horaire, contrairement à l'armure/au chiffrage).
      const timeline = clefTimeline(staff, movement, concertPitch);
      const clefCtx = {
        clefAt: (mi, position) => clefAt(timeline, mi, position),
        clefAtMeasureStart: (mi) => clefAtMeasureStart(timeline, mi),
        clefChangeAt: (mi, position) => clefChangeAt(timeline, mi, position),
        clefChangeEndingMeasure: (mi) => clefChangeEndingMeasure(timeline, mi),
      };
      // capo en vigueur (`Staff::capo(tick)`) : liste datée `PID.CAPOS` de CETTE portée (tranche 4e) ; sans capo, aucune résolution
      const hasCapos = (getProperty(staff, PID.CAPOS) ?? []).length > 0;
      const capoTl = hasCapos ? capoTimeline(movement, staff) : [];
      clefCtx.capoTimeline = capoTl;
      clefCtx.capoAtPos = (mi, position) => (capoTl.length ? capoAt(capoTl, [mi, position]) : NO_CAPO);
      // tuning changes written on the staff (`PID.STRING_TUNINGS` entries with a tuning): null = the staff's own tuning
      const tuningTl = (getProperty(staff, PID.STRING_TUNINGS) ?? []).some((e) => e.tuning?.length) ? tuningChanges(movement, staff) : [];
      clefCtx.tuningAtPos = (mi, position) => (tuningTl.length ? tuningAt(tuningTl, [mi, position]) : null);
      // `track` exposé dans le ctx (pas seulement l'entrée `staves[]`) : le peintre en a besoin pour la détection
      // « instrument vocal » (nuances/soufflets, `Sid::dynamicsHairpinsAboveForVocalStaves`, voir instruments.js).
      // hauteur sonnante : armure et notes ÉCRITES d'une portée de notation d'un instrument transpositeur (jamais en percussion, tablature
      // ni accordéon : le modèle y garde la hauteur de concert). Affichage de concert (`Sid::concertPitch`) : aucune transposition.
      const trTrack = transpositionTrack ?? track; // a free nested score follows the transposition of the staff that hosts it
      const iv = type === 'score' && !concertPitch && opts.transpose !== false && !noTranspose ? trackTransposition(trTrack) : null;
      const transposes = iv && !intervalIsZero(iv);
      const prefer = getProperty(trTrack, PID.PREFER_SHARP_FLAT);
      const ownKeys = opts.keySigs ?? keySigs;
      const keyCtx = transposes
        ? { keySigs: ownKeys.map((k) => writtenKey(k, iv, prefer)), transposition: { iv, prefer, concertKeys: ownKeys } }
        : (opts.keySigs ? { keySigs: opts.keySigs } : {});
      const sigCtx = {};
      if (opts.timeSigs) { sigCtx.timeSigs = opts.timeSigs; sigCtx.beamGroupings = opts.beamGroupings; }
      // reglages de notation propres a la piste (`PID.STYLE_OVERRIDES`) : la valeur de la piste l'emporte sur le style du Mouvement
      const overrides = getProperty(track, PID.STYLE_OVERRIDES);
      const styleOf = overrides && Object.keys(overrides).length ? (sid) => (Object.hasOwn(overrides, sid) ? overrides[sid] : style(sid)) : style;
      // display of the track on THIS screen (layers: model/trackdisplay.js): bars shown or not, size in % (applied by the painters that support it: the chord staff)
      const display = trackDisplay ? trackDisplay(track) : displayOfTrack(track);
      const scaled = type === 'chord' && display.sizePct !== 100;
      const sizeScale = type !== 'chord' && display.sizePct !== 100 ? display.sizePct / 100 : null; // every other staff is shrunk after it is drawn (layout/scaling.js)
      const staffStyle = scaled ? (sid) => (sid === SID.CHORD_BAR_HEIGHT || sid === SID.CHORD_FONT_SIZE ? styleOf(sid) * display.sizePct / 100 : styleOf(sid)) : styleOf;
      return { staff, track, indexInTrack, type, painter, ctx: { ...base, ...clefCtx, ...keyCtx, ...sigCtx, style: staffStyle, staff, track, ...(display.showBars === false || type === 'lyrics' ? { hideBars: true } : {}), ...(sizeScale ? { sizeScale } : {}), ...(displaySpec(display) ? { displaySpec: displaySpec(display) } : {}) } };
  };
  for (const track of movement.tracks) {
    track.staves.forEach((staff, indexInTrack) => {
      if (anyShown && !isShown(track, staff)) return;
      let content = staff;
      if (isLinkedStaff(staff)) { // a linked staff is drawn from its projection
        content = projectLinkedStaff(movement, staff, undefined, projectionReuse(staff));
        const primary = primaryOf(movement, staff);
        if (primary) projections.set(staff.id, { primaryId: primary.id, staff: content });
      }
      staves.push(makeRef(track, content, indexInTrack));
    });
  }

  // composite tracks: the TALLEST source staff is the carrier (the one that takes room); the others are laid out but collapsed (layout/compositestaff.js steals their
  // measures). With `equal`, every lined source is scaled so that its outer lines sit on the carrier's; the rhythm staff (no lines) is only centred on it.
  const composed = [];
  for (const [trackId, { composite, byMeasure }] of compositeOf) {
    const refs = staves.filter((r) => r.track.id === trackId);
    if (!refs.length) continue;
    const geo = refs.map((r) => {
      const ys = r.painter.lines(r.staff, r.ctx).map((l) => l.y);
      const span = !ys.length && r.painter.barSpan ? r.painter.barSpan(r.staff, r.ctx) : null;
      const lo = ys.length ? Math.min(...ys) : span ? span.lo : 0; const hi = ys.length ? Math.max(...ys) : span ? span.hi : 0;
      return { ref: r, lo, hi, height: ys.length ? hi - lo : 0 };
    });
    const tallest = geo.reduce((best, g) => (g.height > best.height ? g : best), geo[0]);
    // the reference height with `equal`: the notation staff when there is one (a tablature is drawn 1.5 spaces between its lines, much taller than 4 spaces: it is the one that
    // gives way); the tallest staff otherwise. The carrier is always the tallest, since it is the one that takes room.
    const lined = geo.filter((g) => g.height > 0);
    // `equal` = 'notation' (true: the others are fitted to the notation staff) or 'tallest' (the others are fitted to the tallest staff, the tablature)
    const mode = composite.equal === 'tallest' ? 'tallest' : composite.equal ? 'notation' : null;
    const reference = mode === 'notation' ? lined.find((g) => g.ref.type !== 'tab') ?? tallest : tallest;
    const carrierGeo = mode ? reference : tallest;
    const sources = geo.map((g) => {
      // a TABLATURE that is not the reference is squeezed or stretched VERTICALLY only (the gap between its lines): its digits keep their size; any other lined staff is scaled as a whole
      const k = mode && g.height > 0 && g !== reference ? reference.height / g.height : 1;
      let r = 1;
      if (k !== 1) { if (g.ref.type === 'tab') { g.ref.ctx.sizeVertical = k; r = k; } else g.ref.ctx.sizeScale = (g.ref.ctx.sizeScale ?? 1) * k; }
      const u = g.ref.ctx.sizeScale ?? 1;
      return { ref: g.ref, scale: u, centre: ((g.lo + g.hi) / 2) * u * r };
    });
    const tall = carrierGeo;
    const carrier = sources.find((x) => x.ref === tall.ref);
    for (const x of sources) { x.shift = carrier.centre - x.centre; if (x !== carrier) x.ref.ctx.collapsed = true; }
    const at = staves.indexOf(refs[0]);
    staves.splice(at, refs.length, carrier.ref, ...sources.filter((x) => x !== carrier).map((x) => x.ref));
    composed.push({ trackId, composite, byMeasure, carrier, sources });
  }
  staves.forEach((s, i) => { s.index = i; }); // rang dans le système (portées croisées : colonne d'espacement de la portée cible)

  // éléments de chaque mesure, par portée (calculés une fois)
  // `reuse` (incremental layout): { entries: Map(staff id → entries per measure), msig, trackSigs: Map(staff id → text), isClean(mi) } — the entries of a measure that no
  // change touched are those of the previous layout, FOR THE SAME STAFF: hiding or showing a staff keeps those of the others. A staff may only reuse them when the staves
  // of its track that are shown are the same as before (cross-staff chords read their siblings), and when no container touches the staves.
  const sig = `${staves.map((s) => s.staff.id).join('|')}#${msig}`;
  const trackSigs = new Map(staves.map((s) => [s.staff.id, staves.filter((o) => o.track === s.track).map((o) => o.staff.id).join('|')]));
  const noContainers = !staves.some((s) => (s.staff.containers ?? []).length);
  const canReuse = Boolean(reuse) && reuse.msig === msig && noContainers;
  const reusable = (s, mi) => canReuse && reuse.isClean(mi) && reuse.trackSigs.get(s.staff.id) === trackSigs.get(s.staff.id) ? reuse.entries.get(s.staff.id)?.[mi] : null;
  const entries = staves.map((s) => movement.masterbars.map((_, mi) => reusable(s, mi) ?? s.painter.entries(s.staff, mi, s.ctx)));
  const reusableStaves = new Set(staves.filter((s) => canReuse && reuse.trackSigs.get(s.staff.id) === trackSigs.get(s.staff.id)).map((s) => s.staff.id)); // staves whose clean measures come from the previous layout
  const entriesById = new Map(staves.map((s, si) => [s.staff.id, entries[si]]));

  // nested notes that TAKE PART in the spacing (stacked container, spacing 'chords', option "widen"): virtual staves for the columns only — never
  // painted nor stacked; their entries add columns and widths, so a denser nested rhythm widens the measures of the piece
  const extraRefs = []; const extraEntries = [];
  for (const s of staves) {
    for (const c of s.staff.containers ?? []) {
      if (getProperty(c, PID.CONTAINER_PLACEMENT) === 'between' || getProperty(c, PID.CONTAINER_KIND) !== 'nestedNotation') continue;
      if (getProperty(c, PID.CONTAINER_SPACING) === 'document' || !getProperty(c, PID.CONTAINER_WIDEN) || getProperty(c, PID.CONTAINER_LAYOUT) === 'free') continue;
      const first = movement.masterbars.findIndex((b) => b.id === getProperty(c, PID.MEASURE_ID));
      if (first < 0) continue;
      const span = getProperty(c, PID.SPAN) ?? 1;
      for (const nested of nestedStaves(c)) {
        const shim = shimStaff(nested, first);
        const ref = makeRef(s.track, shim, 0, nestedRefOptions(movement, c, first));
        ref.index = staves.length + extraRefs.length;
        extraRefs.push(ref);
        extraEntries.push(movement.masterbars.map((_, mi) => (mi >= first && mi < first + span ? ref.painter.entries(shim, mi, ref.ctx) : [])));
      }
    }
  }

  // paroles : boîtes des syllabes de chaque accord, pour l'espacement horizontal (formes `LYRICS`, voir lyrics.js)
  if (lyricTexts?.length) {
    staves.forEach((s, si) => {
      if (!staffHasLyrics(s.ctx, s.staff)) return;
      for (const list of entries[si]) for (const e of list) { const boxes = lyricBoxesFor(s.ctx, s.staff, e); if (boxes) e.lyricBoxes = boxes; }
    });
    attachGridLyricBoxes({ movement, lyricTexts, memo: base.memo, style, staves, entries }); // verses written on the grid of measures (no melody)
  }

  // respirations et césures (`PID.BREATHS`) : par portée, par mesure ; chacune dans son propre segment (columns.js)
  const breaths = staves.map((s, si) => entries[si].map((list) => resolveMeasureBreaths(s.staff, list)));

  // plus courte durée du morceau (hors silences de mesure, dont la durée est celle de la mesure)
  let min = null;
  for (const perStaff of entries) {
    for (const perMeasure of perStaff) {
      for (const e of perMeasure) {
        if (e.annotation || isMeasureRest(e.item)) continue; // symboles d'accord : annotations, pas des ChordRest
        min = min === null ? e.duration : fMin(min, e.duration);
      }
    }
  }
  if (min !== null) base.minDuration = min;
  for (const s of staves) s.ctx.minDuration = base.minDuration;
  for (const r of extraRefs) r.ctx.minDuration = base.minDuration;

  // containers placed between measures (take width in the line, layout/slots.js)
  const slots = buildSlots(movement, staves);
  return { composed, sig, msig, trackSigs, entriesById, projections, reusableStaves, reused: Boolean(canReuse), sameStaves: Boolean(reuse) && reuse.sig === sig, movement, glyphs, style, chordQualities, lyricTexts, preferredVoicings, memo: base.memo, warnings, barLengths, offsets, staves, entries, breaths, minDuration: base.minDuration, makeRef, slots,
    ...(extraRefs.length ? { spacingStaves: [...staves, ...extraRefs], spacingEntries: [...entries, ...extraEntries] } : {}) };
}
