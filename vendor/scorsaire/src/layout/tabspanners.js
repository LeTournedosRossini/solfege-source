/*
 * Marques en plage de la TABLATURE (tranche 4c) : liaisons de prolongation (ties), liaisons d'expression (slurs), glissandos.
 * Port de `slurtielayout.cpp` (MuseScore v4.7.5, jamais deviné) ; mesures de contrôle : exports E4 (ties), E5 (slurs), E6 (glissandos) de Jean.
 * Appelé par `paintSpanners` du peintre `tab` (tous les systèmes d'un coup : un tie ou un slur peut être coupé par un retour à la ligne,
 * et son sens se calcule depuis l'accord de DÉPART, qui peut être dans un autre système). Pur : lit `entry.tabGeom` / `entry.stemUp`
 * posés par le peintre pendant le dessin des accords (géométrie ABSOLUE du système, rectangles y vers le HAUT, origine = ligne du bas).
 *
 * ── Ties ──
 *  - Ancrage (`computeDefaultStartOrEndPoint`) : x = axe du numéro ± 0,1 sp (0,2 si le numéro est masqué — note liée —, 0,45 si une autre
 *    note est juste au-dessus/en dessous dans l'accord) ; y = ligne de la corde ± (demi-hauteur de la boîte du numéro + 0,2).
 *  - `adjustX` : une note extérieure de l'accord sans hampe du côté du tie ne bouge que si un AUTRE tie du même sens touche la note (±0,1) ;
 *    sinon (note intérieure, ou hampe du même côté) le tie dégage la forme de l'accord (autres numéros, hampe, points) à 0,2 sp près.
 *  - Coupure de système : segment de DÉPART = de la note à la dernière barre − 0,25 ; segment d'ARRIVÉE = du début du système
 *    (`firstNoteRestSegmentX(true)`) à la note.
 *  - `adjustY` : port du contrôle « bout de tie sur une ligne » et « arc sur une ligne » (les lignes de corde sont à 1,5 sp ; MuseScore
 *    mesure en `spatium`, pas en distance de lignes — quirk porté tel quel) ; bbox du tie = `fillShape` (rectangles sur la courbe).
 *  Limites : pas de résolution de collision verticale entre ties empilés d'un même accord (`resolveVerticalTieCollisions`), pas de tie
 *  « laissez vibrer » ni partiel, pas de tie inter-portées ; les deux notes doivent être dans la même voix (modèle de résolution).
 */
import { SID } from '../model/index.js';
import { tieDirection, tieShoulderHeight, TIE_SHOULDER_W, TIE_MID_WIDTH } from './ties.js';
import { curveItem, bezierControlPoints, tieOrSlurThickness } from './slurtie.js';
import { staffTies, staffGlissandos } from './painters/resolved.js';
import { glissandoProps, glissandoAnchors, glissandoSegments, glissandoSegmentItems, edgeAtHeight, GLISSANDO_NOTE_DIST } from './glissandos.js';
import { systemSpan } from './painters/systemspan.js';
import { staffSlurs, staffHopos, staffBends } from './painters/resolved.js';
import { hopoLetter } from './hopos.js';
import { TEXT_SIZE } from './glissandos.js';
import { layoutSlurCurve, withClearance, adjustEndpointY } from './slurcollide.js';
import { fCmp, fEq } from '../model/fraction.js';
import { PID, getProperty } from '../model/index.js';

const TIE_INSET = 0.1; // visualInsetSp (cas par défaut)
const TIE_INSET_HIDDEN = 0.2; // note dont le numéro est masqué
const TIE_INSET_NEIGHBOUR = 0.45; // `hasAnotherStraightAboveOrBelow`
const TIE_Y_OFFSET = 0.2; // `yOffset`
const X_PADDING = 0.2; // `padding` de adjustX
const ARC_SIDE_MARGIN = 0.3;
const POINTS_SIDE_MARGIN = 0.15;
const OTHER_TIE_SHIFT = 0.1;
const SYSTEM_BARLINE_WIDTH = 0.18; // barre de début de système : compte comme en-tête d'une tablature sans clé (mesuré sur E4)

/** Notes de l'accord triées de la plus basse (visuellement) à la plus haute. */
const sortedNotes = (geo) => [...geo.notes].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.pitch - b.pitch));

/** `Chord::upNote` / `downNote` en tablature : les notes dont le numéro est masqué ne comptent pas (sauf si toutes le sont). */
function extremeNote(geo, up) {
  const visible = geo.notes.filter((n) => !n.hidden);
  const pool = visible.length ? visible : geo.notes;
  return pool.reduce((m, n) => ((up ? n.y > m.y : n.y < m.y) ? n : m), pool[0]);
}

/** `Note::hasAnotherStraightAboveOrBelow` : une autre note de l'accord, alignée (±0,5 sp), est plus haute (`above`) / plus basse. */
function hasAnotherStraight(geo, note, above) {
  const sorted = sortedNotes(geo);
  if ((above && sorted[sorted.length - 1] === note) || (!above && sorted[0] === note)) return false;
  for (const other of sorted) {
    if (other === note) continue;
    if (Math.abs((other.rects[0]?.x1 ?? 0) - (note.rects[0]?.x1 ?? 0)) > 0.5) return false;
    if (above ? other.y > note.y : other.y < note.y) return true;
  }
  return false;
}

/** Rectangles que le tie doit éviter : numéros des AUTRES notes (parenthèses comprises), hampe, points. */
function obstacles(geo, note, { withDots }) {
  const rects = [];
  for (const n of geo.notes) if (n !== note) rects.push(...n.rects);
  if (geo.stem) {
    const { x, y1, y2, width } = geo.stem;
    rects.push({ x1: x - width / 2, x2: x + width / 2, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
  }
  if (withDots) rects.push(...geo.dots);
  return rects;
}

/**
 * Point de départ/arrivée « par défaut » d'un tie sur une note. Repère y vers le haut.
 * @returns { x, y, note, geo }
 */
function tieAnchor(p, noteId, start, up) {
  const geo = p.entry.tabGeom;
  const note = geo.notes.find((n) => n.id === noteId);
  if (!note) return null;
  const inset = note.hidden ? TIE_INSET_HIDDEN : hasAnotherStraight(geo, note, up) ? TIE_INSET_NEIGHBOUR : TIE_INSET;
  return {
    x: geo.axis + (start ? inset : -inset),
    y: note.y + (up ? 1 : -1) * (note.halfH + TIE_Y_OFFSET),
    note, geo,
  };
}

/** `SlurTieLayout::adjustX` (ties). `otherTieUp` : sens de l'autre tie qui touche la note (fin pour un départ, départ pour une arrivée) ou null. */
function adjustTieX(anchor, { start, up, otherTieUp }) {
  const { note, geo } = anchor;
  if (note.hidden) return anchor.x;
  const sign = start ? 1 : -1;
  const padding = X_PADDING * sign;
  let x = anchor.x;
  const outer = extremeNote(geo, up) === note;
  if (outer && otherTieUp === up) x += OTHER_TIE_SHIFT * sign;
  const avoidStem = geo.stem && geo.stem.up === up;
  if (outer && !avoidStem) return x;
  // fenêtre verticale autour du point (côté de l'arc : 0,3 ; côté de la note : 0,15)
  const top = anchor.y + (up ? ARC_SIDE_MARGIN : POINTS_SIDE_MARGIN);
  const bottom = anchor.y - (up ? POINTS_SIDE_MARGIN : ARC_SIDE_MARGIN);
  let clear = null;
  for (const r of obstacles(geo, note, { withDots: !(start && outer) })) {
    if (!(r.y2 > bottom && r.y1 < top)) continue;
    const edge = start ? r.x2 : r.x1;
    clear = clear === null ? edge : start ? Math.max(clear, edge) : Math.min(clear, edge);
  }
  if (clear === null) return x;
  const target = clear + padding;
  return start ? Math.max(x, target) : Math.min(x, target);
}

/**
 * `fillShape` : la courbe (ligne médiane) est échantillonnée (sin², 20 à 50 pas) ; chaque tronçon devient un rectangle élargi à
 * l'épaisseur locale. Renvoie l'étendue verticale de l'ensemble. Repère y VERS LE BAS (celui de MuseScore).
 */
function shapeBounds({ x1, y1, x2, y2, c1, c2, mid }) {
  const L = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.min(Math.max(Math.round(5 * L), 20), 50);
  const pt = (t) => {
    const u = 1 - t;
    return {
      x: u * u * u * x1 + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * y2,
    };
  };
  let prev = { x: x1, y: y1 };
  let top = Infinity; let bottom = -Infinity; let left = Infinity; let right = -Infinity;
  for (let i = 1; i <= n; i++) {
    const pc = Math.sin(0.5 * Math.PI * (i / n)) ** 2;
    const q = pt(pc);
    let t0 = Math.min(prev.y, q.y); let b0 = Math.max(prev.y, q.y);
    const approx = (1 - 2 * Math.abs(0.5 - pc)) * mid;
    if (b0 - t0 < approx) { const adj = (approx - (b0 - t0)) / 2; t0 -= adj; b0 += adj; }
    top = Math.min(top, t0); bottom = Math.max(bottom, b0);
    left = Math.min(left, prev.x, q.x); right = Math.max(right, prev.x, q.x);
    prev = q;
  }
  return { top, bottom, width: right - left, height: bottom - top };
}

/** Points de contrôle (repère y vers le BAS, `H` = ordonnée de la ligne du haut en y vers le haut) d'un tie de hauteur d'épaule `h`. */
function tieBezierDown({ x1, y1, x2, y2, up, h }, H) {
  const { c1, c2 } = bezierControlPoints({ x1, y1: H - y1, x2, y2: H - y2, shoulderW: TIE_SHOULDER_W, shoulderH: h, up });
  return { c1: { x: c1.x, y: H - c1.y }, c2: { x: c2.x, y: H - c2.y } };
}

/**
 * `SlurTieLayout::adjustY` (ties) : (1) bout du tie trop près d'une ligne ; (2) arc trop près d'une ligne. Repère y vers le BAS depuis la ligne
 * du haut. `outerStart/outerEnd` : le tie est le tie extérieur de l'accord à ce bout. `endpointAboveNote` : `hasEndPointAboveNote`.
 * @returns { y1, y2, extraShoulder }
 */
export function adjustTieY(seg, { lines, lineDist, lineThickness, H, minArcClearance = 0 }) {
  const { up } = seg;
  const upSign = up ? -1 : 1;
  const hlc = 0.5 * lineThickness * upSign;
  let { y1, y2 } = seg;
  // 1. bout trop près d'une ligne
  const closest = up ? Math.floor(y1 / lineDist) : Math.ceil(y1 / lineDist);
  const insideStaff = closest >= 0 && closest < lines;
  const insideLedger = !insideStaff && !seg.outerStart;
  const protrusion = Math.abs(y1 - (closest * 1 - hlc));
  if (protrusion < 0.15 && (insideStaff || insideLedger)) {
    y1 = closest * 1 + hlc + 0.15 * upSign;
    y2 = y1;
  }
  const geometry = (extra = 0) => {
    const L = Math.hypot(seg.x2 - seg.x1, y2 - y1);
    const h = tieShoulderHeight(L) + extra;
    const { c1, c2 } = tieBezierDown({ x1: seg.x1, y1, x2: seg.x2, y2, up, h }, H);
    const mt = tieOrSlurThickness(L);
    return { L, h, mt, ...shapeBounds({ x1: seg.x1, y1, x2: seg.x2, y2, c1, c2, mid: 2 * mt }), mid: 2 * mt };
  };
  let g = geometry();
  // 2. arc trop près d'une ligne
  const yOuter = up ? g.top : g.bottom;
  const yInner = yOuter - g.mid * upSign;
  const yMid = 0.5 * (yOuter + yInner);
  const closestArc = Math.round(yMid / lineDist);
  if (!(closestArc >= 0 && closestArc < lines)) return { y1, y2, extraShoulder: 0 };
  const outwardMargin = -upSign * (yOuter - (closestArc * lineDist - hlc));
  const inwardMargin = upSign * (yInner - (closestArc * lineDist + hlc));
  const limit = Math.max(g.width < 3 ? 0.1 : 0.15, minArcClearance);
  const increaseArc = outwardMargin - 0.5 * limit < inwardMargin;
  let correctOutwards = inwardMargin < limit && increaseArc;
  const correctInwards = outwardMargin < limit && !increaseArc;
  if (!correctInwards && !correctOutwards) return { y1, y2, extraShoulder: 0 };
  if (g.width < 2 && g.height < 0.7) {
    if (!seg.inside && !seg.outerStart && !seg.outerEnd && !seg.tiedSecondInside && !seg.endpointAboveNote) {
      const corr = -upSign * (limit - outwardMargin);
      return { y1: y1 + corr, y2: y2 + corr, extraShoulder: 0 };
    }
    correctOutwards = true;
  }
  let arc = correctOutwards ? limit - inwardMargin : limit - outwardMargin;
  const maxArc = 0.75 * g.height;
  let rest = arc > maxArc ? arc - maxArc : 0;
  arc = Math.min(arc, maxArc);
  if (correctOutwards) {
    if (rest > 0) { rest *= upSign; y1 += rest; y2 += rest; }
    return { y1, y2, extraShoulder: arc };
  }
  return { y1, y2, extraShoulder: -arc };
}

/**
 * Ties de la portée, tous systèmes. @returns void — ajoute les éléments d'affichage dans `result[k]` (un tableau par système).
 * @param where Map accord → { p, k }
 */
export function tabTieItems({ perSystem, staff, ctx, where, result, lines, lineDist, preset }) {
  const tieSegs = new Map(); // tie.id → [{ k, x1, y1, x2, y2, up }] (y vers le haut, positions FINALES) — relu par les slurs
  if (ctx.style(SID.TAB_SHOW_TIED_FRET) === 'none') return { tieSegs, dirOf: () => null };
  const ties = staffTies(ctx, staff);
  if (!ties.length) return { tieSegs, dirOf: () => null };
  const H = (lines - 1) * lineDist;
  const lineThickness = ctx.style(SID.STAFF_LINE_THICKNESS);
  const tiedStart = new Set(ties.map((t) => t.startNoteId));
  const byStart = new Map(ties.map((t) => [t.startNoteId, t]));
  const byEnd = new Map(ties.map((t) => [t.endNoteId, t]));
  const dirCache = new Map();
  const dirOf = (tie) => {
    if (dirCache.has(tie.id)) return dirCache.get(tie.id);
    const s = where.get(tie.start.chordId);
    const e = where.get(tie.end.chordId);
    let up = true;
    if (s && e) {
      const geo = s.p.entry.tabGeom;
      up = tieDirection({
        notes: geo.notes.map((n) => ({ id: n.id, y: n.y, pitch: n.pitch, tied: tiedStart.has(n.id) })),
        noteId: tie.startNoteId,
        startStemUp: s.p.entry.stemUp, endStemUp: e.p.entry.stemUp,
        multipleVoices: s.p.entry.multiVoice, startVoice: s.p.entry.voice ?? 0,
        endMultipleVoices: e.p.entry.multiVoice, endVoice: e.p.entry.voice ?? 0,
        simpleException: !preset.stems,
      });
    }
    dirCache.set(tie.id, up);
    return up;
  };
  const toDown = (y) => H - y;

  for (const tie of ties) {
    const s = where.get(tie.start.chordId);
    const e = where.get(tie.end.chordId);
    if (!s || !e || e.k < s.k || !s.p.entry.tabGeom || !e.p.entry.tabGeom) continue;
    const up = dirOf(tie);
    const single = s.k === e.k;
    const otherOf = (note, start) => {
      const other = start ? byEnd.get(note.id) : byStart.get(note.id);
      return other ? dirOf(other) : null;
    };

    // segment de DÉPART (ou unique)
    let startAnchor = tieAnchor(s.p, tie.startNoteId, true, up);
    if (!startAnchor) continue;
    startAnchor = { ...startAnchor, x: adjustTieX(startAnchor, { start: true, up, otherTieUp: otherOf(startAnchor.note, true) }) };
    let endAnchor = tieAnchor(e.p, tie.endNoteId, false, up);
    if (!endAnchor) continue;
    endAnchor = { ...endAnchor, x: adjustTieX(endAnchor, { start: false, up, otherTieUp: otherOf(endAnchor.note, false) }) };

    const segments = [];
    if (single) {
      segments.push({ k: s.k, x1: startAnchor.x, y1: startAnchor.y, x2: endAnchor.x, y2: endAnchor.y, startA: startAnchor, endA: endAnchor });
    } else {
      const spanS = systemSpan(perSystem, s.k, { headerMin: SYSTEM_BARLINE_WIDTH });
      segments.push({ k: s.k, x1: startAnchor.x, y1: startAnchor.y, x2: spanS.right, y2: startAnchor.y, startA: startAnchor, endA: null });
      const spanE = systemSpan(perSystem, e.k, { headerMin: SYSTEM_BARLINE_WIDTH });
      segments.push({ k: e.k, x1: spanE.left, y1: endAnchor.y, x2: endAnchor.x, y2: endAnchor.y, startA: null, endA: endAnchor });
    }

    for (const seg of segments) {
      if (seg.x2 <= seg.x1) continue;
      const outer = (a) => (a ? extremeNote(a.geo, up) === a.note : false);
      const adj = adjustTieY({
        x1: seg.x1, x2: seg.x2, y1: toDown(seg.y1), y2: toDown(seg.y2), up,
        outerStart: outer(seg.startA), outerEnd: outer(seg.endA), inside: false,
        tiedSecondInside: false,
        // `hasEndPointAboveNote` : le bout du tie tombe sur le numéro lui-même (numéro visible)
        endpointAboveNote: Boolean((seg.startA && !seg.startA.note.hidden && seg.x1 < seg.startA.note.rects[0].x2)
          || (seg.endA && !seg.endA.note.hidden && seg.x2 > seg.endA.note.rects[0].x1)),
      }, { lines, lineDist, lineThickness, H });
      const y1 = toDown(adj.y1);
      const y2 = toDown(adj.y2);
      const length = Math.hypot(seg.x2 - seg.x1, y2 - y1);
      if (!tieSegs.has(tie.id)) tieSegs.set(tie.id, []);
      tieSegs.get(tie.id).push({ k: seg.k, x1: seg.x1, y1, x2: seg.x2, y2, up });
      result[seg.k].push(curveItem({
        x1: seg.x1, y1, x2: seg.x2, y2, shoulderW: TIE_SHOULDER_W, shoulderH: tieShoulderHeight(length) + adj.extraShoulder, up,
        midWidth: TIE_MID_WIDTH, role: 'tie', ref: tie.id,
      }));
    }
  }
  return { tieSegs };
}

// ───────────────────────────── Slurs (liaisons d'expression) ─────────────────────────────
/*
 * Port de `SlurTieLayout::layoutSystem(Slur*)`, `slurPos`, `computeUp`, `getSegmentShapes`, `computeAdjustmentBalance` (MuseScore v4.7.5) ;
 * la courbe elle-même = `slurcollide.js` (validée à 0,001 sp sur les segments SINGLE / BEGIN / END de E5, Full et Common, liaisons vers le HAUT
 * avec hampes vers le bas). NON vérifié sur export (aucun export de Jean) : liaisons vers le BAS ou accrochées à une hampe (plusieurs voix),
 * ligatures sous la liaison, crochet de hampe — portés d'après la source seule. Non porté : `fixArticulations` (4c-2 : articulations de tablature),
 * hampes flottantes (début/fin de sens opposé), trémolo à deux notes (4c-3), formes de ties (MuseScore les ajoute SANS les translater : défaut
 * apparent, non reproduit), slur entre portées, `avoidPreBendsOnTab` (pas de bend dans le modèle).
 * Repères : entrées en y vers le HAUT (origine = ligne du bas) ; `slurcollide` travaille en y vers le BAS depuis la ligne du haut (`H - y`).
 */
const SLUR_STEM_INSET = 0.5; // stemSideInset (× distance de lignes)
const SLUR_STEM_OFFSET_X = 0.35; // stemOffsetX
const SLUR_MIN_OFFSET = 0.2; // minOffset
const SLUR_BEAM_CLEARANCE = 0.35; // beamClearance
const SLUR_BEAM_ANCHOR_INSET = 0.15; // beamAnchorInset
const SLUR_NOTE_OFFSET_TAB = 0.75; // décalage au-dessus/au-dessous de la note en tablature (0,9 en portée normale)
const SLUR_TIE_CLEARANCE = 0.65; // tieClearance (× spatium)
const SLUR_TIE_HORIZONTAL = 0.35; // horizontalTieClearance
const SLUR_CONTINUED_Y = 0.4; // continuedSlurOffsetY
const SLUR_CONTINUED_MAX = 2.5; // continuedSlurMaxDiff
const SLUR_HANG = 0.25; // décalage d'une liaison dont la dernière/première note est aussi la seule de son segment

/** Étendue verticale (y vers le haut) de la forme d'un accord : numéros visibles, hampe, crochet, points. null si vide. */
function chordExtent(geo) {
  const rects = [];
  for (const n of geo.notes) rects.push(...n.rects);
  if (geo.stem) rects.push({ y1: Math.min(geo.stem.y1, geo.stem.y2), y2: Math.max(geo.stem.y1, geo.stem.y2) });
  if (geo.hook) rects.push(geo.hook);
  rects.push(...geo.dots);
  if (!rects.length) return null;
  return { top: Math.max(...rects.map((r) => r.y2)), bottom: Math.min(...rects.map((r) => r.y1)) };
}

/** Formes d'un élément (accord ou silence) pour la collision, en y vers le BAS. `own` : accord d'arrivée (pas de marge sur ses propres éléments). */
function slurShapesOf(geo, H, own) {
  const out = [];
  const rect = (r, kind, isOwn) => out.push({ x1: r.x1, x2: r.x2, y1: H - r.y2, y2: H - r.y1, kind, own: isOwn });
  for (const n of geo.notes) for (const r of n.rects) rect(r, 'note', own);
  if (geo.stem) {
    const { x, y1, y2, width } = geo.stem;
    rect({ x1: x - width / 2, x2: x + width / 2, y1: Math.min(y1, y2), y2: Math.max(y1, y2) }, 'other', own);
  }
  if (geo.hook) rect(geo.hook, 'other', own);
  for (const r of geo.others ?? []) rect(r, 'other', own); // altérations (portée de notation)
  for (const d of geo.dots) rect(d, 'other', false); // le parent d'un point est la NOTE (pas l'accord) : marge appliquée même à l'arrivée
  if (geo.rest) rect(geo.rest, 'other', false);
  return out;
}

/**
 * `score` (facultatif) : mêmes règles sur une portée de NOTATION (`slurPos` n'a qu'une branche `useTablature`). Géométrie lue dans `entry.slurGeom`
 * (notes avec `cx` = centre de tête, `stemX`, `headRight`, `x0` = origine de l'accord) et `entry.slurBeam`. Retourne l'ensemble des identifiants de
 * liaisons traités (les autres — départ sur un ornement, marteaux/arrachés — restent à l'appelant).
 */
export function tabSlurItems({ perSystem, staff, ctx, where, graceWhere = new Map(), result, lines, lineDist, preset, tieSegs = new Map(), score = false }) {
  const handled = new Set();
  const geomOf = (en) => (score ? en.slurGeom : en.tabGeom);
  const beamOfEntry = (en) => (score ? en.slurBeam : en.tabBeam);
  const noteOffset = score ? 0.9 : SLUR_NOTE_OFFSET_TAB; // 0,9 sur portée de notation, 0,75 en tablature (`slurPos`)
  const stemXOf = (g) => g.stemX ?? g.axis;
  // `isHiddenElementOnTab` : les liaisons d'expression suivent SLUR_SHOW_TAB_* ; un marteau/arraché n'est JAMAIS masqué (`shouldHideSlurSegment`)
  const slursShown = score || ctx.style(preset.stems ? SID.SLUR_SHOW_TAB_COMMON : SID.SLUR_SHOW_TAB_SIMPLE);
  const slurs = score ? staffSlurs(ctx, staff) : [
    ...(slursShown ? staffSlurs(ctx, staff) : []),
    ...(ctx.style(SID.HOPO_SHOW_ON_TAB) ? staffHopos(ctx, staff).map((h) => ({ ...h, hopo: true })) : []),
  ];
  if (!slurs.length) return handled;
  const H = (lines - 1) * lineDist;
  const lineThickness = ctx.style(SID.STAFF_LINE_THICKNESS);
  const beamW = ctx.style(SID.BEAM_THICKNESS);
  const stemsThrough = preset.through; // `staffHasStems = stt->stemThrough()` : hampes à côté = ne comptent pas
  const ties = staffTies(ctx, staff);
  const tieByStart = new Map(ties.map((t) => [t.startNoteId, t]));
  const tieByEnd = new Map(ties.map((t) => [t.endNoteId, t]));
  const tieSeg = (tie, first) => { const l = tie && tieSegs.get(tie.id); return l && l.length ? l[first ? 0 : l.length - 1] : null; };

  // accords/silences de chaque voix, dans l'ordre : sert à `isOverBeams`, au premier/dernier élément d'un système
  const timeCmp = (a, b) => (a.p.mi !== b.p.mi ? a.p.mi - b.p.mi : fCmp(a.p.entry.position, b.p.entry.position));
  const byVoice = new Map();
  perSystem.forEach(({ placed }, k) => {
    for (const p of placed) {
      if (p.entry.item.type !== 'chord' && p.entry.item.type !== 'rest') continue;
      const v = p.entry.voice ?? 0;
      if (!byVoice.has(v)) byVoice.set(v, []);
      byVoice.get(v).push({ p, k });
    }
  });
  // (`placed` is already in time order — systems in order, measures in order, columns in order — so the lists below need no sorting)
  // instants d'attaque de la portée (tous les éléments, toutes voix) dans l'ordre : { mi, entry (1er), voices: voix → élément }
  const segments = [];
  {
    const byKey = new Map();
    for (const { placed } of perSystem) {
      for (const p of placed) {
        if (p.entry.item.type !== 'chord' && p.entry.item.type !== 'rest') continue;
        const key = `${p.mi}|${p.entry.position[0]}/${p.entry.position[1]}`;
        let g = byKey.get(key);
        if (!g) byKey.set(key, (g = { mi: p.mi, entry: { position: p.entry.position }, voices: new Map() }));
        g.voices.set(p.entry.voice ?? 0, p.entry);
      }
    }
    segments.push(...byKey.values()); // insertion order = time order (see above)
  }

  const hasBeamOn = (entry, up) => Boolean(beamOfEntry(entry)) && entry.stemUp === up;

  for (const slur of slurs) {
    // départ sur un accord, ou sur une NOTE D'ORNEMENT « avant » (`graceWhere` : l'ornement partage l'instant de son accord principal ;
    // `scr->pos() + parentItem()->pos()` : ancré à l'ornement lui-même)
    let s = where.get(slur.startChordId);
    const gs = s ? null : graceWhere.get(slur.startChordId);
    if (gs) s = { p: gs.p, k: gs.k, grace: gs };
    // arrivée sur un accord, ou sur une NOTE D'ORNEMENT (« avant » ou « après » : l'ornement est dans la liste de l'accord de sa colonne)
    let e = where.get(slur.endChordId);
    const ge = e ? null : graceWhere.get(slur.endChordId);
    if (ge) e = { p: ge.p, k: ge.k, grace: ge };
    if (!s || !e || e.k < s.k || (!ge && !geomOf(e.p.entry)) || (!gs && !geomOf(s.p.entry))) continue;
    if (score && (gs || ge)) continue; // liaison partant d'un ornement ou y arrivant : chemin d'origine de la portée
    const se = gs
      ? { item: gs.chord, voice: gs.p.entry.voice, multiVoice: gs.p.entry.multiVoice, stemUp: gs.up, tabGeom: gs.geom, tabBeam: null, articItems: [] }
      : s.p.entry;
    const ee = ge
      ? { item: ge.chord, voice: ge.p.entry.voice, multiVoice: ge.p.entry.multiVoice, stemUp: ge.up, tabGeom: ge.geom, tabBeam: null, articItems: [] }
      : e.p.entry;
    const magE = ge ? ge.mag : 1; // `intrinsicMag` de l'accord d'arrivée
    const sg = score ? geomOf(se) : se.tabGeom; const eg = geomOf(ee);
    handled.add(slur.id);
    const magS = gs ? gs.mag : 1; // `intrinsicMag` de l'accord de départ (0,7 pour un ornement)
    if (gs || ge?.trail ? timeCmp(s, e) > 0 : timeCmp(s, e) >= 0) continue; // an "after" ornament at the bar shares its chord's instant

    // ── sens (`computeUp`) : voix multiples → du côté de la hampe (voix > 0 : en dessous) ; sinon opposé à la hampe ──
    let anyVoices = false;
    for (let k = s.k; k <= e.k && !anyVoices; k++) {
      const list = perSystem[k].placed; // in measure order: start at the first entry of the start measure instead of scanning the whole system
      let lo = 0; let hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].mi < s.p.mi) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < list.length && list[i].mi <= e.p.mi; i++) if (list[i].entry.multiVoice) { anyVoices = true; break; }
    }
    const up = anyVoices ? !((se.voice ?? 0) > 0 || (ee.voice ?? 0) > 0) : !se.stemUp;
    const o = up ? 1 : -1;
    const startVoice = se.voice ?? 0;

    // ── `isOverBeams` : TOUS les instants de la portée entre les deux bornes (toutes voix) portent, dans la voix de la liaison,
    // un élément ligaturé du côté de la liaison — un instant où cette voix n'attaque pas (autre voix seule) donne faux ──
    const seq = byVoice.get(startVoice) ?? [];
    let overBeams = false;
    if (timeCmp(s, e) !== 0 && se !== ee) {
      overBeams = true;
      // first instant not before the start (binary search: the instants are in time order)
      let lo = 0; let hi = segments.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (timeCmp({ p: segments[mid] }, s) < 0) lo = mid + 1; else hi = mid; }
      for (let si = lo; si < segments.length; si++) {
        const seg = segments[si];
        if (timeCmp({ p: seg }, e) > 0) break;
        const member = seg.voices.get(startVoice);
        if (!member || !hasBeamOn(member, up)) { overBeams = false; break; }
      }
    }
    // ── `slurPos` ──
    const stem1 = stemsThrough ? sg.stem : null;
    const stem2 = stemsThrough ? eg.stem : null;
    const stemSideForBeam = (entry, start) => hasBeamOn(entry, up) && (start ? !beamOfEntry(entry).last : !beamOfEntry(entry).first);
    let sa1 = false; let sa2 = false;
    if (stemsThrough) {
      if (sg.hook && se.stemUp === up) sa1 = true;
      if (se.stemUp === ee.stemUp && se.stemUp === up) {
        if (stem1 && !stemSideForBeam(se, true)) sa1 = true;
        if (stem2 && !stemSideForBeam(ee, false)) sa2 = true;
      } else if (e.k !== s.k) {
        if (se.stemUp === up && stem1 && !beamOfEntry(se)) sa1 = true;
        if (ee.stemUp === up && stem2 && !beamOfEntry(ee)) sa2 = true;
      }
    }
    const noteOf = (g) => (g.notes.length ? extremeNote(g, up) : null);
    const note1 = noteOf(sg); const note2 = noteOf(eg);
    const restEdge = (g) => (up ? g.rest.y2 : g.rest.y1);
    const centreX = (g, note) => (g.rest ? (g.rest.x1 + g.rest.x2) / 2 : score && note ? note.cx : g.axis);
    const tip = (g) => g.stem.y2;
    const stemOff = Math.max(SLUR_STEM_OFFSET_X, SLUR_MIN_OFFSET) * lineDist;
    let p1 = null; let p2 = null;
    let stemPos = false;
    let floatedLeft = false; let floatedRight = false; // `stemFloated` : extrémité qui glisse le long de la hampe
    if (sa1) {
      const yadj = SLUR_STEM_INSET * lineDist;
      p1 = { x: stemXOf(sg) + stemOff, y: tip(sg) - o * yadj };
      if (sg.hook && p1.x >= sg.hook.x1 && p1.x <= sg.hook.x2 && p1.y >= sg.hook.y1 && p1.y <= sg.hook.y2) {
        const fakeCutout = Math.min(0, yadj - (sg.hook.x2 - sg.hook.x1)); // pente 1,0 (Leland/Bravura)
        p1.x = stemXOf(sg) - fakeCutout;
      }
    }
    if (sa2) {
      const beamedLater = beamOfEntry(ee) && !beamOfEntry(ee).first;
      const yadj = beamedLater ? -0.75 * lineDist : SLUR_STEM_INSET * lineDist;
      p2 = { x: stemXOf(eg) - stemOff, y: tip(eg) - o * yadj };
    }
    if (!sa1 || !sa2) {
      // note du côté de la hampe d'un accord (`up() ? upNote() : downNote()`), ou centre du silence
      const stemSideY = (g, entry) => (g.notes.length ? extremeNote(g, entry.stemUp).y : g.rest ? (g.rest.y1 + g.rest.y2) / 2 : 0);
      if (!sa1) {
        p1 = { x: centreX(sg, note1), y: (note1 ? note1.y : restEdge(sg)) + o * lineDist * noteOffset * magS };
        if (stem1) {
          if (hasBeamOn(se, up) && !beamOfEntry(se).last) {
            p1 = { x: stemXOf(sg) + SLUR_BEAM_ANCHOR_INSET * lineDist - o * stem1.width / 2, y: tip(sg) + o * (beamW / 2 + SLUR_BEAM_CLEARANCE * lineDist) };
            stemPos = true;
          } else {
            if (se.stemUp && up) p1.x = score ? sg.headRight + SLUR_STEM_OFFSET_X * lineDist : p1.x + SLUR_STEM_OFFSET_X * lineDist;
            if (score && se.stemUp !== ee.stemUp && se.stemUp === up) {
              // hampes de sens opposé, liaison du côté de la hampe de départ : le départ glisse le long de la hampe (Gould p. 111)
              floatedLeft = true;
              const yd = (stemSideY(eg, ee) - stemSideY(sg, se)) * 0.5; // y vers le haut
              const sh = Math.abs(stem1.y2 - stem1.y1);
              if (up && yd > 0) p1.y = Math.min(p1.y + yd, extremeNote(sg, false).y + sh + lineDist);
              else if (!up && yd < 0) p1.y = Math.max(p1.y + yd, extremeNote(sg, true).y - sh - lineDist);
              stemPos = true;
            }
          }
        }
      }
      if (!sa2) {
        p2 = { x: centreX(eg, note2), y: (note2 ? note2.y : restEdge(eg)) + o * lineDist * noteOffset * magE };
        if (stem2) {
          if ((stemPos && se.stemUp === ee.stemUp) || (hasBeamOn(ee, up) && !beamOfEntry(ee).first)) {
            const bw = beamOfEntry(ee) ? beamW / 2 : 0;
            p2 = { x: stemXOf(eg) - o * stem2.width / 2 - SLUR_BEAM_ANCHOR_INSET * lineDist, y: tip(eg) + o * (bw + SLUR_BEAM_CLEARANCE * lineDist) };
          } else {
            if (score) { if (!ee.stemUp && !up) p2.x = eg.x0 - SLUR_STEM_OFFSET_X * lineDist; }
            else if ((!ee.stemUp && !up) || (up && ee.stemUp)) p2.x -= SLUR_STEM_OFFSET_X * lineDist;
            if (score && se.stemUp !== ee.stemUp && ee.stemUp === up) {
              floatedRight = true;
              const yd = (stemSideY(eg, ee) - stemSideY(sg, se)) * 0.5; // y vers le haut
              const mh = Math.abs(stem2.y2 - stem2.y1);
              if (up && yd < 0) p2.y = Math.min(p2.y - yd, extremeNote(eg, false).y + mh + lineDist);
              else if (!up && yd > 0) p2.y = Math.max(p2.y - yd, extremeNote(eg, true).y - mh - lineDist);
            }
          }
        }
      }
    }
    // (fixArticulations : 4c-2)

    // ── segments, système par système (`layoutSystem`) ──
    for (let k = s.k; k <= e.k; k++) {
      const type = s.k === e.k ? 'single' : k === s.k ? 'begin' : k === e.k ? 'end' : 'middle';
      const startsHere = type === 'single' || type === 'begin';
      const endsHere = type === 'single' || type === 'end';
      let a1 = { ...p1 }; let a2 = { ...p2 };
      const spanK = systemSpan(perSystem, k, { headerMin: SYSTEM_BARLINE_WIDTH });
      let seqKList = null; // only a slur that CONTINUES across a system break needs the elements of the voice in this system
      const seqK = () => (seqKList ??= (byVoice.get(startVoice) ?? []).filter((q) => q.k === k));
      const upNoteOf = (g) => extremeNote(g, true);
      let constrainLeft = false;
      const clearUp = (pt, tieY) => { if (o * (pt.y - tieY) < SLUR_TIE_CLEARANCE) { pt.y = tieY + o * SLUR_TIE_CLEARANCE; return true; } return false; };

      if (startsHere) {
        if (note1) {
          let tie = tieByStart.get(note1.id);
          let tseg = tie ? tieSeg(tie, true) : null;
          if (tie && tseg && tseg.up !== up) { tie = null; tseg = null; }
          let adjusted = false;
          if (tie && tseg) adjusted = clearUp(a1, tseg.y1);
          const back = tieByEnd.get(upNoteOf(sg).id);
          const bseg = back ? tieSeg(back, false) : null;
          if (!adjusted && back && bseg && bseg.up === up && Math.abs(bseg.y2 - a1.y) < SLUR_TIE_CLEARANCE) a1.x += SLUR_TIE_HORIZONTAL;
        }
      } else {
        // début de système : 1re note du système, dégagement du tie qui y arrive
        const first = seqK()[0];
        const fc = first && first.p.entry;
        let y = a1.y;
        if (first && first.p.entry === ee) constrainLeft = true;
        if (fc && fc.item.type === 'chord') {
          const ext = chordExtent(geomOf(fc));
          if (ext) {
            y = up ? ext.top : ext.bottom;
            if (!(geomOf(fc).stem && fc.stemUp === up)) y += o * SLUR_CONTINUED_Y;
          }
        }
        a1 = { x: spanK.left, y };
        if (fc && fc.item.type === 'chord') {
          const back = tieByEnd.get(upNoteOf(geomOf(fc)).id);
          const bseg = back ? tieSeg(back, false) : null;
          if (back && bseg && bseg.up === up) clearUp(a1, bseg.y1);
        }
      }

      if (endsHere) {
        if (note2) {
          let tie = tieByEnd.get(note2.id);
          let tseg = tie ? tieSeg(tie, true) : null;
          if (tie && tseg && tseg.up !== up) { tie = null; tseg = null; }
          let adjusted = false;
          if (tie && tseg) adjusted = clearUp(a2, tseg.y2);
          const fwd = tieByStart.get(upNoteOf(eg).id);
          const fseg = fwd ? tieSeg(fwd, true) : null;
          if (!adjusted && fwd && fseg && fseg.up === up && Math.abs(fseg.y1 - a2.y) < SLUR_TIE_CLEARANCE) a2.x -= SLUR_TIE_HORIZONTAL;
        }
      } else {
        const last = seqK()[seqK().length - 1];
        const lc = last && last.p.entry;
        let y = a1.y;
        if (lc === se) y += o * SLUR_HANG;
        else if (lc && lc.item.type === 'chord') {
          const ext = chordExtent(geomOf(lc));
          if (ext) {
            y = up ? ext.top : ext.bottom;
            if (!(geomOf(lc).stem && lc.stemUp === up)) y += o * SLUR_CONTINUED_Y;
            if (o * (a1.y - y) > SLUR_CONTINUED_MAX) y = a1.y - o * SLUR_CONTINUED_MAX;
          }
        }
        a2 = { x: spanK.right, y };
        if (lc && lc.item.type === 'chord') {
          const fwd = tieByStart.get(upNoteOf(geomOf(lc)).id);
          const fseg = fwd ? tieSeg(fwd, true) : null;
          if (fwd && fseg && fseg.up === up) clearUp(a2, fseg.y2);
        }
      }
      if (constrainLeft) a1.y = a2.y + o * SLUR_HANG;
      if (a2.x <= a1.x) continue;

      // ── formes à éviter (`getSegmentShapes`) ──
      const shapes = [];
      const lo = startsHere ? s : null;
      const hi = endsHere ? e : null;
      // `placed` is in time order: start at the first element not before `lo` (binary search) and stop after `hi`, instead of testing the whole system for every slur
      const placedK = perSystem[k].placed;
      let from = 0;
      if (lo) { let l = 0; let h = placedK.length; while (l < h) { const mid = (l + h) >> 1; if (timeCmp({ p: placedK[mid], k }, lo) < 0) l = mid + 1; else h = mid; } from = l; }
      for (let pi = from; pi < placedK.length; pi++) {
        const p = placedK[pi];
        const en = p.entry;
        if (en.item.type !== 'chord' && en.item.type !== 'rest') continue;
        const q = { p, k };
        if (hi && timeCmp(q, hi) > 0) break;
        if (en === se && startsHere) continue; // éléments de l'accord de départ
        const sameTick = (ref) => p.mi === ref.p.mi && fEq(en.position, ref.p.entry.position);
        if ((en.voice ?? 0) !== startVoice && ((startsHere && sameTick(s)) || (endsHere && sameTick(e)))) continue;
        if ((up && (en.voice ?? 0) < startVoice) || (!up && (en.voice ?? 0) > startVoice)) continue; // voix « de l'autre côté »
        if (!geomOf(en)) continue;
        shapes.push(...slurShapesOf(geomOf(en), H, en === ee && endsHere));
      }

      const artAbove = (en) => Boolean(score && en.articSides && (up ? en.articSides.above : en.articSides.below)); // `hasArticulationAbove`
      const leftBalance = startsHere && !floatedLeft ? (type === 'begin' || artAbove(se) ? 0.1 : 0.4) : 0.9;
      const rightBalance = endsHere && !floatedRight ? (type === 'end' || artAbove(ee) ? 0.1 : 0.4) : 0.9;
      const res = layoutSlurCurve({
        pp1: { x: a1.x, y: H - a1.y }, pp2: { x: a2.x, y: H - a2.y }, up,
        shapes: withClearance(shapes, up), balance: { left: leftBalance, right: rightBalance },
        lw: lineDist, lines, lineThickness, overBeams,
      });
      if (!res) continue;
      const U = (pt) => ({ x: pt.x, y: H - pt.y });
      const P1 = U(res.p1); const P2 = U(res.p2);
      const t1 = U(res.a1); const t2 = U(res.a2); const b1 = U(res.b1); const b2 = U(res.b2); const c1 = U(res.c1); const c2 = U(res.c2);
      // `ChordLayout::layoutArticulations3` : les signes du même côté que la liaison, à l'extrémité de départ ou d'arrivée, sont repoussés hors d'elle
      const edges = [[P1, t1, t2, P2], [P1, b1, b2, P2]];
      if (startsHere) pushArticulationsOutOfSlur(se.articItems, edges, up, ctx.glyphs);
      if (endsHere) pushArticulationsOutOfSlur(ee.articItems, edges, up, ctx.glyphs);
      if (slur.hopo) hopoLetters({ slur, k, seq, spanK, tieByStart, ctx, H, top: [P1, t1, t2, P2], out: result[k] });
      result[k].push({
        kind: 'curve', role: slur.hopo ? 'hopo' : 'slur', ref: slur.id, x1: P1.x, y1: P1.y, x2: P2.x, y2: P2.y,
        c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, thickness: res.mid,
        topC1x: t1.x, topC1y: t1.y, topC2x: t2.x, topC2y: t2.y, botC1x: b1.x, botC1y: b1.y, botC2x: b2.x, botC2y: b2.y,
      });
    }
  }
  return handled;
}


// ───────────── Marteaux / arrachés : lettres H / P (`TLayout::layoutHammerOnPullOffSegment`, `computeHopoTextRegions`) ─────────────
const HOPO_PADDING = 0.5; // vertPadding = 0,5 × spatium
const HOPO_ABOVE_SLUR = 0.097; // voir `hopoLetters`
const HOPO_SKYLINE_BASE = 0.555; // ligne de base au-dessus de la ligne du haut quand rien ne gêne (mesuré sur E9A ; skyline filtré « articulations » vide)

/** `resolveStartEndNotes` : paire de notes (indices de la fin vers le début ; même corde en tablature ; hauteurs différentes). */
function hopoNotePair(sg, eg, tieByStart) {
  const sn = sg.notes; const en = eg.notes;
  const count = Math.max(sn.length, en.length);
  for (let i = count - 1; i >= 0; i--) {
    const a = sn[Math.min(i, sn.length - 1)]; const b = en[Math.min(i, en.length - 1)];
    const tie = tieByStart.get(a.id);
    if (tie && tie.endNoteId === b.id) continue;
    if (a.pitch !== b.pitch && a.string === b.string) return [a, b];
  }
  const up = (g) => g.notes.reduce((m, n) => (n.y > m.y ? n : m), g.notes[0]);
  return [up(sg), up(eg)];
}

function hopoLetters({ slur, k, seq, spanK, tieByStart, ctx, H, top, out }) {
  const first = seq.findIndex((q) => q.p.entry.item.id === slur.startChordId);
  const last = seq.findIndex((q) => q.p.entry.item.id === slur.endChordId);
  if (first < 0 || last <= first) return;
  const chords = seq.slice(first, last + 1).filter((q) => q.p.entry.item.type === 'chord' && q.p.entry.tabGeom);
  const showAll = ctx.style(SID.HOPO_SHOW_ALL);
  const regions = [];
  for (let i = 0; i + 1 < chords.length; i++) {
    const c = chords[i]; const n = chords[i + 1];
    if (c.k !== k) continue; // seul le système où la paire DÉMARRE porte la lettre
    const [a, b] = hopoNotePair(c.p.entry.tabGeom, n.p.entry.tabGeom, tieByStart);
    const hammer = b.fret > a.fret; // égales → P (comme `nextNote->fret() > curNote->fret()`)
    if (!regions.length || showAll || regions[regions.length - 1].hammer !== hammer) regions.push({ s: c, e: n, hammer });
    else regions[regions.length - 1].e = n;
  }
  const upper = ctx.style(SID.HOPO_UPPER_CASE);
  for (const r of regions) {
    const sg = r.s.p.entry.tabGeom; const eg = r.e.p.entry.tabGeom;
    const upNote = (g) => g.notes.reduce((m, n) => (n.y > m.y ? n : m), g.notes[0]);
    const sUp = upNote(sg); const eUp = upNote(eg);
    const widthOf = (n, g) => (n.rects[0] ? n.rects[0].x2 - n.rects[0].x1 : g.headW);
    const startX = sg.axis - sg.headW / 2 + widthOf(sUp, sg);
    let endX = r.e.k === k ? eg.axis - eg.headW / 2 : spanK.right;
    const stems = sg.stem && eg.stem && sg.stem.up && eg.stem.up;
    if (stems && r.e.k === k) endX += 0.5 * widthOf(eUp, eg);
    const noteAbove = Math.max(sUp.y, eUp.y) - H;
    let y = H + Math.max(HOPO_SKYLINE_BASE, noteAbove + 2 * HOPO_PADDING);
    // ÉCART assumé : la source ne tient pas compte de la liaison (skyline filtré « articulations ») ; sur l'export (chaîne de 3, liaison à 1,011 sp,
    // lettre à 1,108 sp) la lettre se pose 0,097 sp AU-DESSUS du sommet de la liaison sous elle — règle empirique, retenue pour éviter le chevauchement
    const xa = (startX + endX) / 2 - 0.5; const xb = (startX + endX) / 2 + 0.5;
    let apex = -Infinity;
    for (let i = 0; i <= 48; i++) { const q = bezierPt(top, i / 48); if (q.x >= xa && q.x <= xb && q.y > apex) apex = q.y; }
    if (apex > -Infinity) y = Math.max(y, apex + HOPO_ABOVE_SLUR);
    out.push({ kind: 'text', role: 'hopo-text', text: hopoLetter(r.hammer ? 0 : 1, r.hammer ? 1 : 0, upper), x: (startX + endX) / 2, y, size: TEXT_SIZE, anchor: 'middle', ref: slur.id });
  }
}

// ───────────── Articulations repoussées hors d'une liaison (`ChordLayout::layoutArticulations3`) ─────────────
const ARTIC_MIN_DIST = 0.4; // Sid::articulationMinDistance
const bezierPt = (c, t) => {
  const u = 1 - t;
  return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y };
};
/**
 * Pour chaque signe (dans l'ordre) du même côté que la liaison : si l'écart vertical à la liaison (sur l'étendue en x du signe) est < 0,4 sp,
 * lui et tous les suivants sont déplacés de 0,4 + (recouvrement éventuel) du côté opposé à la liaison. Valeur exacte du code MuseScore :
 * `minDist += max(aShape.minVerticalDistance(sShape), 0)`, appliqué même si l'écart était positif mais < 0,4 ; contrôlé sur l'export de Jean
 * (staccato +0,538 sp sous une liaison qui démarre à 8,625).
 * @param items   éléments d'affichage `glyph` des signes de l'accord (repère de portée, y vers le haut), mutés
 * @param edges   les deux contours de la liaison (courbes de Bézier à 4 points)
 */
function pushArticulationsOutOfSlur(items, edges, up, glyphs) {
  if (!items || !items.length) return;
  const pts = [];
  for (const c of edges) for (let i = 0; i <= 64; i++) pts.push(bezierPt(c, i / 64));
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const bb = glyphs.glyphs[it.name]?.bbox;
    if (!bb) continue;
    const above = it.name.endsWith('Above');
    if (above !== up) continue; // seul le cas « signe et liaison du même côté » est traité
    const x1 = it.x + bb.bBoxSW[0]; const x2 = it.x + bb.bBoxNE[0];
    const inRange = pts.filter((q) => q.x >= x1 && q.x <= x2);
    if (!inRange.length) continue;
    const bottom = it.y + bb.bBoxSW[1]; const top = it.y + bb.bBoxNE[1];
    const slurEdge = up ? Math.max(...inRange.map((q) => q.y)) : Math.min(...inRange.map((q) => q.y));
    const clearance = up ? bottom - slurEdge : slurEdge - top;
    if (clearance >= ARTIC_MIN_DIST) continue;
    const overlap = up ? slurEdge - bottom : top - slurEdge;
    const dy = (ARTIC_MIN_DIST + Math.max(overlap, 0)) * (up ? 1 : -1);
    for (let j = i; j < items.length; j++) items[j].y += dy;
    // les signes suivants ont été déplacés : on continue avec leurs nouvelles positions (comme la boucle de MuseScore)
  }
}

// ───────────────────────────── Glissandos ─────────────────────────────
/*
 * Port de `TLayout::layoutNoteAnchoredLine` (branche tablature, MuseScore v4.7.5) ; recoupé sur l'export E6 de Jean :
 *  - point de départ initial = bord droit du numéro de la note (`bbox().right()`), décalé de 0,4 × distance de lignes (0,6 sp) du côté opposé au
 *    mouvement (une tablature est sur UNE corde : la ligne serait horizontale) ; point d'arrivée initial = origine du numéro + demi-largeur de tête
 *    (0,65 sp, `headWidth` de Leland) décalé de 0,6 sp vers le mouvement ;
 *  - raccourcissement : départ = bord droit de la FORME de l'accord (numéros, parenthèses, hampe, crochet, points) à la hauteur du numéro + 0,25 sp ;
 *    arrivée = origine du numéro − 0,25 sp (aucun dégagement de forme en tablature) ; y interpolé sur la droite initiale (vérifié : 2,428 / 4,999 sp) ;
 *  - retour à la ligne, texte, ondulation : comme la portée (`glissandos.js`).
 */
export function tabGlissandoItems({ perSystem, staff, ctx, where, result, lineDist }) {
  const glis = staffGlissandos(ctx, staff);
  if (!glis.length) return;
  const yOff = lineDist * 0.4;
  const toBox = (r) => ({ left: r.x1, right: r.x2, bottom: r.y1, top: r.y2 });
  const boxesOf = (geo) => {
    const boxes = [];
    for (const n of geo.notes) boxes.push(...n.rects.map(toBox));
    if (geo.stem) boxes.push(toBox({ x1: geo.stem.x - geo.stem.width / 2, x2: geo.stem.x + geo.stem.width / 2, y1: Math.min(geo.stem.y1, geo.stem.y2), y2: Math.max(geo.stem.y1, geo.stem.y2) }));
    if (geo.hook) boxes.push(toBox(geo.hook));
    boxes.push(...geo.dots.map(toBox));
    return boxes;
  };
  const spanOf = (k) => systemSpan(perSystem, k, { headerMin: SYSTEM_BARLINE_WIDTH });
  for (const g of glis) {
    const s = where.get(g.start.chordId);
    const e = where.get(g.end.chordId);
    if (!s || !e || e.k < s.k || !s.p.entry.tabGeom || !e.p.entry.tabGeom) continue;
    const sg = s.p.entry.tabGeom; const eg = e.p.entry.tabGeom;
    const sn = sg.notes.find((n) => n.id === g.startNoteId);
    const en = eg.notes.find((n) => n.id === g.endNoteId);
    if (!sn || !en) continue;
    const upDown = Math.sign(en.pitch - sn.pitch);
    const sr = sn.rects[0] ?? { x1: sg.axis, x2: sg.axis, y1: sn.y - sn.halfH, y2: sn.y + sn.halfH };
    const er = en.rects[0] ?? { x1: eg.axis, x2: eg.axis, y1: en.y - en.halfH, y2: en.y + en.halfH };
    const edge = edgeAtHeight(boxesOf(sg), sr.y1, sr.y2, 'right') ?? sr.x2;
    const anchors = {
      ax: sr.x2, ay: sn.y - yOff * upDown,
      bx: er.x1 + eg.headW / 2, by: en.y + yOff * upDown,
      sx: edge + GLISSANDO_NOTE_DIST, ex: er.x1 - GLISSANDO_NOTE_DIST,
      rightEdge: edge, leftEdge: er.x1, upDown,
    };
    const spans = [];
    for (let k = s.k; k <= e.k; k++) {
      const sp = spanOf(k);
      spans.push(k === s.k && k === e.k ? {} : k === s.k ? { right: sp.right, rawRight: sp.rawRight } : k === e.k ? { left: sp.left, rawLeft: sp.rawLeft } : sp);
    }
    const props = glissandoProps(g, ctx.style);
    const width = ctx.style(SID.GLISSANDO_LINE_WIDTH);
    for (const seg of glissandoSegments(anchors, spans)) {
      result[s.k + (seg.system ?? 0)].push(...glissandoSegmentItems(seg, { ...props, width, ref: g.id }));
    }
  }
}


// ───────────────────────────── Bends de guitare (4d-b) ─────────────────────────────
/*
 * Port de `GuitarBendLayout::layoutBendTabStaff` / `computeStartPos` / `computeEndPos` / `layoutHoldLine` / `checkConflictWithOtherBends`
 * (MuseScore v4.7.5) ; mesures de contrôle : export E9A de Jean (bend standard « 2 », pre-bend, bend « 1 », slight bend ¼, sur 3 préréglages).
 * Repère interne : y vers le BAS depuis la ligne du haut (celui de MuseScore), converti en y vers le haut à l'émission (`H − y`).
 * Non porté ici : dives / dip / scoop (4d-b, étape suivante), grace-note bend dont la note de départ est une note d'ornement VISIBLE, slack.
 */
const BEND_VERTICAL_PAD = 0.25;
const BEND_INDENT = 0.25;
const BEND_TEXT_PAD = 0.2;
const BEND_DIGIT_HEIGHT = 1.132; // hauteur d'encre d'un chiffre Edwin 8 pt (mesurée sur l'export : 93,6 unités)
const BEND_SLIGHT_WIDTH = 1.25;
const BEND_MIN_WIDTH = 0.75;
const BEND_DASH = 3; // `GuitarBendHold::dashLength`

export function tabBendItems({ perSystem, staff, ctx, where, graceWhere = new Map(), result, lines, lineDist }) {
  const model = staffBends(ctx, staff);
  if (!model) return;
  const H = (lines - 1) * lineDist;
  const D = (y) => H - y; // y haut → y bas
  const U = (y) => H - y;
  const st = (k) => ctx.style(SID[k]);
  const distAbove = st('GUITAR_BEND_HEIGHT_ABOVE_TAB') * lineDist;
  const arrowW = st('GUITAR_BEND_ARROW_WIDTH'); const arrowH = st('GUITAR_BEND_ARROW_HEIGHT');
  const partial = st('GUITAR_BEND_PARTIAL_HEIGHT');
  const spanOf = (k) => systemSpan(perSystem, k, { headerMin: SYSTEM_BARLINE_WIDTH });
  const placedBy = { }; // bend.id → { k, tip:{x,y}, release, holdEnd }
  const locate = (rec) => {
    const w = where.get(rec.chord.id) ?? graceWhere.get(rec.chord.id);
    if (!w) return null;
    const geo = w.geom ?? w.p.entry.tabGeom;
    const g = geo?.notes.find((n) => n.id === rec.note.id);
    if (!g) return null;
    return { k: w.k, geo, g, b: g.noteBox, yd: D(g.y), h: 2 * g.halfH };
  };
  const out = (k, item) => result[k].push(item);
  // ligne de maintien (`layoutHoldLine`) : `last` = dernier segment dessiné ({ k }), `startPos` = départ (y vers le bas)
  const drawHold = (b, last, startPos, lw) => {
    const hold = model.holdLine(b);
    if (!hold || !last) return;
    const HE = locate({ chord: model.noteRec.get(hold.endNote.id).chord, note: hold.endNote });
    if (!HE) return;
    let x2;
    if (hold.endBend && (hold.endBend.type === 'preBend' || hold.endBend.type === 'preDive')) {
      const n = model.startOnEndNote(hold.endBend) ? hold.endBend.end.note : hold.endBend.start.note;
      const L = locate({ chord: model.noteRec.get(n.id).chord, note: n });
      x2 = L ? L.b.x1 + 0.5 * (L.b.x2 - L.b.x1) : HE.b.x1;
    } else if (hold.endBend) x2 = HE.b.x1;
    else {
      // `endNotePos.x + segment()->width() - 1.5 sp` : jusqu'à 1,5 sp avant la colonne suivante
      const next = model.nextCR(model.noteRec.get(hold.endNote.id).rec);
      const nw = next ? where.get(next.item.id) : null;
      const nx = nw ? nw.p.x : spanOf(HE.k).right;
      x2 = nx - 1.5;
    }
    x2 = Math.max(startPos.x + 1, x2);
    const len = x2 - startPos.x;
    // dip avec vibrato : glyphes répétés à la place du trait (`layoutHoldLine`, `dipVibratoType`)
    if (b.type === 'dip' && b.entry.dipVibrato) {
      const name = b.entry.dipVibrato === 'wide' ? 'guitarWideVibratoStroke' : 'guitarVibratoStroke';
      const g = ctx.glyphs.glyphs[name];
      const adv = g.advance; const gh = g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1];
      const count = Math.max(1, Math.floor(len / adv));
      for (let i = 0; i < count; i++) out(last.k, { kind: 'glyph', name, x: startPos.x + i * adv, y: U(startPos.y + 0.5 * gh), role: 'bend-hold', ref: b.id });
      placedBy[b.id].holdEnd = { x: x2, y: startPos.y, k: last.k };
      return;
    }
    const pairs = Math.max(1, Math.floor(len / lw / (2 * BEND_DASH)));
    const gap = (len / lw - BEND_DASH * (pairs + 1)) / pairs;
    out(last.k, { kind: 'line', role: 'bend-hold', x1: startPos.x, y1: U(startPos.y), x2, y2: U(startPos.y), width: lw, cap: 'butt', dash: [BEND_DASH * lw, gap * lw], ref: b.id });
    placedBy[b.id].holdEnd = { x: x2, y: startPos.y, k: last.k };
  };
  // `side` : 'below' | 'above' → le texte d'un dive est écarté des hampes qui le traversent (ÉCART avec MuseScore, demande de Jean 04/10/2026 :
  // en Common les hampes descendent sous la portée et recouvraient le « -1 »)
  const digitText = (b, k, x, baseline, side = null) => {
    const digit = model.digit(b);
    if (!digit) return;
    if (side) {
      const halfW = 0.25 * TEXT_SIZE * String(digit).length;
      for (const { entry } of perSystem[k].placed) {
        const st_ = entry.tabGeom?.stem;
        if (!st_ || Math.abs(st_.x - x) > halfW + 0.15) continue;
        if (side === 'below') {
          const tip = D(Math.min(st_.y1, st_.y2)); // bout le plus bas (y vers le bas)
          if (tip + 0.2 > baseline - BEND_DIGIT_HEIGHT) baseline = tip + 0.2 + BEND_DIGIT_HEIGHT;
        } else {
          const tip = D(Math.max(st_.y1, st_.y2)); // bout le plus haut
          if (tip - 0.2 < baseline) baseline = tip - 0.2;
        }
      }
    }
    out(k, { kind: 'text', role: 'bend-text', text: digit, x, y: U(baseline), size: TEXT_SIZE, anchor: 'middle', ref: b.id });
  };
  // ── dives, dip, scoop (`GuitarDiveLayout`) ──
  const strOf = (n) => getProperty(n, PID.STRING);
  const diveInfo = new Map(); // b.id → { levels (croissants), above }
  {
    const dives = model.list.filter((d) => d.type === 'dive' || d.type === 'preDive');
    for (let i = dives.length - 1; i >= 0; i--) {
      const d = dives[i];
      if (diveInfo.has(d.id)) continue;
      let tabPos = d.entry.diveTabPos ?? 'auto';
      const levels = new Set([model.tot(d)]); const seq = [d];
      for (let p = model.preceding(d); p; p = model.preceding(p)) {
        levels.add(model.tot(p)); seq.push(p);
        if ((p.entry.diveTabPos ?? 'auto') !== 'auto') tabPos = p.entry.diveTabPos;
      }
      const above = tabPos === 'up' || (tabPos === 'auto' && st('GUITAR_DIVES_ABOVE_STAFF'));
      const sorted = [...levels].sort((x, y) => x - y);
      for (const m of seq) diveInfo.set(m.id, { levels: sorted, above });
    }
  }
  // dernier segment posé d'un dive précédent sur le système k : ligne de maintien d'abord, sinon fin du dive (`findPrevHoldOrBendSegment`)
  const prevSegmentEnd = (b, k, excludeFullReleaseDive) => {
    const prev = model.preceding(b);
    const info = prev ? placedBy[prev.id] : null;
    if (!prev || !info) return null;
    const hold = model.holdLine(prev);
    if (hold && info.holdEnd && prev.end.note.id !== b.start.note.id && info.holdEnd.k === k) return { ...info.holdEnd, isHold: true };
    if (info.end && !(excludeFullReleaseDive && model.isFullReleaseDive(prev)) && info.endK === k) return { ...info.end, isHold: false };
    return null;
  };
  const diveItems = (b) => {
    const lw = st('GUITAR_DIVE_LINE_WIDTH_TAB');
    const S = locate(b.start);
    if (!S) return;
    const amount = model.amount(b);
    if (b.type === 'dip') {
      // `layoutDip` : V au-dessus de la note, sommet sous la ligne de base
      const cx = 0.5 * (S.b.x1 + S.b.x2);
      const baseY = Math.min(-1, S.yd - 0.5 * S.h - 1);
      const up = amount > 0;
      const pts = [[cx - 1, up ? baseY : baseY - 2], [cx, up ? baseY - 2 : baseY], [cx + 1, up ? baseY : baseY - 2]];
      out(S.k, { kind: 'polyline', points: pts.map(([x, y]) => [x, U(y)]), width: lw, cap: 'butt', join: 'bevel', role: 'dive', ref: b.id });
      digitText(b, S.k, cx, baseY - 2 - 0.35, 'above');
      placedBy[b.id] = { k: S.k, tip: null, lw };
      drawHold(b, { k: S.k }, { x: pts[2][0], y: pts[2][1] }, lw);
      return;
    }
    if (b.type === 'scoop') {
      // `layoutScoop` : glyphe à gauche de la forme de l'accord (0,35 sp), le haut aligné sur le haut de la note
      const g = ctx.glyphs.glyphs.guitarVibratoBarScoop;
      const hgt = g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1]; const wid = g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0];
      out(S.k, { kind: 'glyph', name: 'guitarVibratoBarScoop', x: S.b.x1 - 0.35 - wid, y: U(S.yd + hgt - 0.5 * S.h), role: 'dive', ref: b.id });
      return;
    }
    const E = locate(b.end); const info = diveInfo.get(b.id);
    if (!E || E.k < S.k || !info) return;
    // une seule ligne de dive en tablature, depuis la note du haut de l'accord
    if (strOf(b.start.note) !== model.upString(b.start.chord) || strOf(b.end.note) !== model.upString(b.end.chord)) return;
    const align = st('ALIGN_PRE_BEND_AND_PRE_DIVE_TO_GRACE_NOTE');
    const lines_ = lines; const ld = lineDist; const sp = 1;
    const fullRel = model.isFullReleaseDive(b);
    const levelsAbove = info.levels.filter((l) => l > 0); const levelsBelow = info.levels.filter((l) => l < 0).reverse();
    const withZero = [...new Set([...info.levels, 0])].sort((x, y) => x - y);
    const tot = model.tot(b);
    const segs = S.k === E.k ? [{ k: S.k, begin: true, end: true }] : [{ k: S.k, begin: true, end: false }, { k: E.k, begin: false, end: true }];
    let first = null; let last = null;
    for (const seg of segs) {
      const span = spanOf(seg.k);
      const prevEnd = prevSegmentEnd(b, seg.k, !info.above);
      // ── départ ──
      let sx; let sy;
      if (!info.above) {
        if (b.type === 'preDive') {
          const base = align ? b.start : b.end;
          const notes = base.chord.notes;
          const pick = amount > 0 ? notes.reduce((m, n) => (strOf(n) < strOf(m) ? n : m)) : notes.reduce((m, n) => (strOf(n) > strOf(m) ? n : m));
          const L = locate({ chord: base.chord, note: pick }) ?? (base === b.start ? S : E);
          sx = 0.5 * (L.b.x1 + L.b.x2); sy = amount > 0 ? L.yd - 0.5 * L.h - 0.25 : L.yd + 0.5 * L.h + 0.25;
        } else if (prevEnd) { sx = prevEnd.x; sy = prevEnd.y; }
        else if (seg.begin) { sx = S.b.x2 + 0.25; sy = S.yd - 0.5 * S.h + 0.5 * lw; }
        else { sx = span.left; sy = first.ey; }
      } else if (prevEnd) { sx = prevEnd.x; sy = prevEnd.y; }
      else if (seg.begin) {
        const note = S;
        sx = 0.5 * (note.b.x1 + note.b.x2); sy = -1.5 * ld - sp * withZero.indexOf(0);
      } else { sx = span.left; sy = first.sy; }
      // ── arrivée ──
      let ex; let ey;
      const holdPrev = b.type === 'preDive' && prevEnd && prevEnd.isHold;
      if (!info.above) {
        if (seg.end) {
          if (fullRel) { ex = E.b.x1 - 0.25; ey = E.yd - 0.5 * E.h + 0.5 * lw; }
          else {
            ex = b.type === 'preDive' ? sx : 0.5 * (E.b.x1 + E.b.x2);
            if (holdPrev) ey = prevEnd.y;
            else {
              const above = tot > 0; const list = above ? levelsAbove : levelsBelow;
              const idx = list.indexOf(tot);
              const zero = above ? -1.5 * ld : ld * (lines_ + 0.5);
              ey = zero + (above ? -1 : 1) * sp * Math.max(0, idx);
            }
          }
        } else {
          ex = span.right;
          if (fullRel) ey = S.yd - 0.5 * S.h + 0.5 * lw;
          else ey = tot > 0 ? -ld : lines_ * ld;
        }
      } else {
        ex = seg.end ? (b.type === 'preDive' ? sx : 0.5 * (E.b.x1 + E.b.x2)) : span.right;
        if (holdPrev) ey = prevEnd.y;
        else {
          const startingLevel = tot - amount;
          const steps = withZero.indexOf(tot) - withZero.indexOf(startingLevel);
          ey = sy - steps * sp;
        }
      }
      const dash = b.type === 'preDive';
      let dashArr = null;
      if (dash) {
        const L = Math.abs(ey - sy) / lw; const pairs = Math.max(1, Math.floor(L / 6)); const gap = (L - 3 * (pairs + 1)) / pairs;
        dashArr = [3 * lw, gap * lw];
      }
      out(seg.k, { kind: 'line', role: 'dive', x1: sx, y1: U(sy), x2: ex, y2: U(ey), width: lw, cap: 'butt', ...(dashArr ? { dash: dashArr } : {}), ref: b.id });
      // texte : au-dessus ou au-dessous de l'arrivée (0,35 sp)
      if (seg.end) {
        if (info.above) {
          const base = b.type === 'preDive' && amount < 0 ? { x: sx, y: sy } : { x: ex, y: ey };
          digitText(b, seg.k, base.x, base.y - 0.35, 'above');
        } else digitText(b, seg.k, ex, ey > 0 ? ey + 0.35 + BEND_DIGIT_HEIGHT : ey - 0.35, ey > 0 ? 'below' : 'above');
      }
      if (!first) first = { sx, sy, ex, ey };
      last = { k: seg.k, ex, ey };
    }
    placedBy[b.id] = { k: last.k, tip: null, lw, end: { x: last.ex, y: last.ey }, endK: last.k };
    // maintien : part de la fin du dive, sans écart
    drawHold(b, last, { x: last.ex, y: last.ey }, lw);
  };
  for (const b of model.list) {
    if (b.isDive) { diveItems(b); continue; }
    const lw = st('GUITAR_BEND_LINE_WIDTH_TAB');
    const S = locate(b.start); const E = locate(b.end);
    if (!S || !E || E.k < S.k) continue;
    const sw = S.b.x2 - S.b.x1; const ew = E.b.x2 - E.b.x1;
    const release = model.isRelease(b); const fullRelease = model.isFullRelease(b);
    const startOnEnd = model.startOnEndNote(b);
    const angled = model.angledPreBend(b);
    const prev = model.preceding(b);
    const prevInfo = prev ? placedBy[prev.id] : null;
    // point d'arrivée du bend précédent (`prevEndPoint`) : ligne de maintien du précédent, sinon sa pointe de flèche
    let prevEnd = null;
    if (prev && prevInfo && prevInfo.k === S.k) {
      const hold = model.holdLine(prev);
      if (hold && prevInfo.holdEnd && prev.end.note.id !== b.start.note.id) prevEnd = prevInfo.holdEnd;
      else if (!model.isFullRelease(prev) && prevInfo.tip) prevEnd = { x: prevInfo.tip.x, y: prevInfo.tip.y + (prevInfo.release ? -0.5 : 0.5) * prevInfo.lw };
    }
    const segs = [];
    if (S.k === E.k) segs.push({ k: S.k, begin: true, end: true });
    else { segs.push({ k: S.k, begin: true, end: false }); segs.push({ k: E.k, begin: false, end: true }); }
    let last = null;
    for (const seg of segs) {
      const span = spanOf(seg.k);
      // ── départ ──
      let sx; let sy;
      if (seg.begin && b.type !== 'preBend' && prevEnd) { sx = prevEnd.x; sy = prevEnd.y; }
      else if (startOnEnd) {
        const side = b.type === 'graceNoteBend' || (b.end.chord.notes.length > 1 && model.upString(b.end.chord) < E.g.string);
        if (side) { sx = E.b.x1 + ew + BEND_INDENT; sy = E.yd - 0.5 * E.h + 0.5 * lw; } else { sx = E.b.x1 + 0.5 * ew; sy = E.yd - 0.5 * E.h - BEND_VERTICAL_PAD; }
      } else if (b.type === 'preBend') { sx = S.b.x1 + 0.5 * sw; sy = S.yd - 0.5 * S.h - BEND_VERTICAL_PAD; }
      else if (release) {
        if (seg.begin) { sx = S.b.x1; sy = -distAbove - arrowH + 0.5 * lw; } else { sx = span.left; sy = -distAbove; }
      } else if (seg.begin) { sx = S.b.x1 + sw + BEND_INDENT; sy = S.yd - 0.5 * S.h + 0.5 * lw; } else { sx = span.left; sy = 0.5; }
      // ── arrivée ──
      let ex; let ey;
      const hadPrev = Boolean(prevEnd);
      if (b.type === 'preBend' && !angled) { ex = sx; ey = -distAbove; }
      else if (release) {
        if (seg.end) {
          ex = E.b.x1 + 0.5 * ew;
          ey = fullRelease ? E.yd - 0.5 * E.h - arrowH - BEND_VERTICAL_PAD : sy + partial;
        } else { ex = span.right - 0.5 * arrowW; ey = -arrowH; }
      } else {
        if (b.type === 'slightBend') ex = sx + BEND_SLIGHT_WIDTH;
        else if (seg.end) ex = E.b.x1 + 0.5 * ew;
        else ex = span.right - 0.5 * arrowW;
        ey = hadPrev ? sy - partial : -distAbove;
        ex = Math.max(ex, sx + BEND_MIN_WIDTH);
      }
      ex = Math.max(sx, ex);
      // arrête de flèche : pointe vers le bas pour une libération
      const vx = b.type === 'preBend' && !angled ? 0.5 * (sx + ex) : ex;
      const vy = b.type === 'preBend' && !angled ? 0.5 * (sy + ey) : sy;
      // conflit avec un autre bend d'un accord (`checkConflictWithOtherBends`)
      let cx = ex; let cy = ey; let vxx = vx;
      let other = null;
      for (const n of b.start.chord.notes) {
        if (getProperty(n, PID.STRING) >= getProperty(b.start.note, PID.STRING)) continue;
        const ob = model.bendFor(n.id);
        if (ob) { other = ob; break; }
      }
      let textDx = 0;
      if (other && model.digit(other) !== model.digit(b) && b.type !== 'preBend') { cx += 1; cy += 1; vxx += 1; textDx = 1; }
      const tip = { x: cx, y: cy + (release ? arrowH : -arrowH) };
      // ── émission (y vers le haut) ──
      const stroke = { width: lw, cap: 'butt', join: 'miter', role: 'bend', ref: b.id };
      if (angled) out(seg.k, { kind: 'polyline', points: [[sx, U(sy)], [vxx, U(vy)], [cx, U(cy)]], ...stroke });
      else out(seg.k, { kind: 'bezier', x1: sx, y1: U(sy), c1x: sx, c1y: U(sy), c2x: vxx, c2y: U(vy), x2: cx, y2: U(cy), ...stroke });
      const pts = release
        ? [[cx, cy + arrowH], [cx + arrowW / 2, cy], [cx - arrowW / 2, cy]]
        : [[cx, cy - arrowH], [cx + arrowW / 2, cy], [cx - arrowW / 2, cy]];
      out(seg.k, { kind: 'polygon', points: pts.map(([x, y]) => [x, U(y)]), role: 'bend-arrow', ref: b.id });
      const digit = model.digit(b);
      if (digit && seg.end) {
        const baseline = release ? tip.y + BEND_TEXT_PAD + BEND_DIGIT_HEIGHT : tip.y - BEND_TEXT_PAD;
        // en cas de conflit avec un autre bend : texte décalé de 0,35 × sa largeur en plus (`checkConflictWithOtherBends`)
        out(seg.k, { kind: 'text', role: 'bend-text', text: digit, x: tip.x + (textDx ? 0.35 * 0.5 * TEXT_SIZE * String(digit).length : 0), y: U(baseline), size: TEXT_SIZE, anchor: 'middle', ref: b.id });
      }
      last = { k: seg.k, tip, release, lw, sx, sy, ex: cx, ey: cy };
    }
    placedBy[b.id] = { k: last.k, tip: last.tip, release, lw, end: { x: last.ex, y: last.ey }, endK: last.k };
    // ── ligne de maintien (`layoutHoldLine`, tablature) ──
    drawHold(b, last, { x: last.tip.x + BEND_DASH * lw, y: last.tip.y + (release ? -0.5 : 0.5) * lw }, lw);
  }
}


// ───────────── Tapping main gauche : demi-liaisons (`TappingLayout::updateHalfSlurs` / `layoutHalfSlur`, 4d-d) ─────────────
const HALF_SLUR_LENGTH = 2.5; // `p1 = p2 − 2,5 sp` (`layoutSystem`, TappingHalfSlur)
const HALF_SLUR_SHOULDER_TAB = 1.0; // `computeShoulderHeight` : 1,0 sp en tablature (0,6 en portée)
const HALF_SLUR_SHOULDER_W = 0.5; // 2 ≤ longueur < 10 sp
const SAMPLES = 24;

const cubicPt = (a, b, c, d, t) => {
  const u = 1 - t;
  return [u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y];
};

/** Contour (polygone) d'un item `curve`, échantillonné, ramené à sa moitié DROITE : `mask.setWidth(0,5 × largeur)` — la moitié gauche est masquée. */
export function rightHalfPolygon(c) {
  const P1 = { x: c.x1, y: c.y1 }; const P2 = { x: c.x2, y: c.y2 };
  const pts = [];
  for (let i = 0; i <= SAMPLES; i++) pts.push(cubicPt(P1, { x: c.topC1x, y: c.topC1y }, { x: c.topC2x, y: c.topC2y }, P2, i / SAMPLES));
  for (let i = 1; i <= SAMPLES; i++) pts.push(cubicPt(P2, { x: c.botC2x, y: c.botC2y }, { x: c.botC1x, y: c.botC1y }, P1, i / SAMPLES));
  const xs = pts.map((p) => p[0]);
  const cut = Math.min(...xs) + 0.5 * (Math.max(...xs) - Math.min(...xs));
  // Sutherland–Hodgman contre le demi-plan x ≥ cut
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const ina = a[0] >= cut; const inb = b[0] >= cut;
    if (ina) out.push(a);
    if (ina !== inb) { const t = (cut - a[0]) / (b[0] - a[0]); out.push([cut, a[1] + t * (b[1] - a[1])]); }
  }
  return out;
}

export function tabTappingItems({ perSystem, staff, ctx, result, lines, lineDist, preset }) {
  const show = ctx.style(SID.LH_TAPPING_SHOW_ITEMS_TAB);
  if (show === 'symbol') return;
  const H = (lines - 1) * lineDist;
  const lineThickness = ctx.style(SID.STAFF_LINE_THICKNESS);
  const beamW = ctx.style(SID.BEAM_THICKNESS);
  const stemsThrough = preset.through;
  const stemOff = Math.max(SLUR_STEM_OFFSET_X, SLUR_MIN_OFFSET) * lineDist;
  perSystem.forEach(({ placed }, k) => {
    for (const p of placed) {
      const en = p.entry;
      const tp = en.item.type === 'chord' ? getProperty(en.item, PID.TAPPING) : null;
      if (!tp || tp.hand !== 'left' || !en.tabGeom) continue;
      const eg = en.tabGeom;
      const both = ctx.style(SID.LH_TAPPING_SLUR_TOP_AND_BOTTOM_NOTE_ON_TAB) && eg.notes.length > 1;
      for (const up of both ? [true, false] : [true]) {
        const o = up ? 1 : -1;
        const hasBeam = Boolean(en.tabBeam) && en.stemUp === up;
        const stem = stemsThrough ? eg.stem : null;
        const note = eg.notes.length ? extremeNote(eg, up) : null;
        if (!note) continue;
        // extrémité d'arrivée (`slurPos`, accord de départ = accord d'arrivée)
        let p2;
        const sa2 = stemsThrough && en.stemUp === up && stem && !(hasBeam && !en.tabBeam.first);
        if (sa2) {
          const beamedLater = en.tabBeam && !en.tabBeam.first;
          const yadj = beamedLater ? -0.75 * lineDist : SLUR_STEM_INSET * lineDist;
          p2 = { x: eg.axis - stemOff, y: eg.stem.y2 - o * yadj };
        } else {
          p2 = { x: eg.axis, y: note.y + o * lineDist * SLUR_NOTE_OFFSET_TAB };
          if (stem) {
            if (hasBeam && !en.tabBeam.first) {
              p2 = { x: eg.axis - o * stem.width / 2 - SLUR_BEAM_ANCHOR_INSET * lineDist, y: eg.stem.y2 + o * (beamW / 2 + SLUR_BEAM_CLEARANCE * lineDist) };
            } else if ((!en.stemUp && !up) || (up && en.stemUp)) p2.x -= SLUR_STEM_OFFSET_X * lineDist;
          }
        }
        p2.y = H - adjustEndpointY(H - p2.y, up, { lw: lineDist, lines, lineThickness }); // `adjustEndPoints` (lignes de portée)
        const p1 = { x: p2.x - HALF_SLUR_LENGTH, y: p2.y };
        const c = curveItem({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, shoulderW: HALF_SLUR_SHOULDER_W, shoulderH: HALF_SLUR_SHOULDER_TAB, up, role: 'tapping', ref: en.item.id });
        result[k].push({ kind: 'polygon', role: 'tapping', ref: en.item.id, sel: `${en.item.id}-tap`, points: rightHalfPolygon(c) });
      }
    }
  });
}
