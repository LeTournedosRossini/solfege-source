/*
 * Glissandos (tranche 3, voir le doc du projet `claude/tranche-3-glissandos.md` : sources lues, jamais devinées).
 * `PID.GLISSANDOS` (portée) : [{ id, startNoteId, endNoteId, glissandoType?, showText?, text? }] — un glissando MuseScore
 * relie DEUX NOTES (`Note::add` GLISSANDO : une note n'en porte qu'UN sortant) ; un accord à plusieurs notes = un glissando par
 * note de départ. Champs absents = style (`SID.GLISSANDO_*`).
 *
 * Ce module est PUR (aucune dépendance au DOM ni au peintre) : résolution, forme d'accord, points d'accroche, segmentation par
 * système, éléments d'affichage. Le peintre `score` fournit les boîtes de la forme de chaque accord (voir `boxesFromItems`).
 * Repère : espaces de portée, x vers la droite, y vers le HAUT (MuseScore : y vers le bas — signes inversés par rapport aux sources).
 *
 * Sources (dépôt MuseScore cloné) : `TLayout::layoutNoteAnchoredLine` (tlayout.cpp : points d'accroche), `TLayout::layoutLine` (coupure
 * par système), `TDraw::draw(GlissandoSegment*)` (tdraw.cpp : trait, ondulation, texte), `HorizontalSpacing` (longueurs minimales),
 * `System::endingXForOpenEndedLines` / `firstNoteRestSegmentX`, `ChordLayout::fillShape` / `TLayout::fillNoteShape` (forme d'accord).
 *
 * Écarts volontaires (choix de Jean, repris du prototype) : filets de sécurité « toujours un trait visible plutôt que rien » à cheval
 * sur un retour à la ligne. Limites documentées : largeur minimale respectée seulement entre deux colonnes adjacentes d'une MÊME
 * mesure ; points de prolongation absents (le moteur ne les dessine pas encore : ils font partie de la forme de la note chez MuseScore) ;
 * trémolo à deux accords absent de la forme ; même voix pour les deux notes ; tablature = tranche 4.
 */
import { PID, SID, getProperty, isRunEntry } from '../model/index.js';
import { noteIndexMap } from './ties.js';

export const GLISSANDO_NOTE_DIST = 0.25; // `lineNoteDist` (tlayout.cpp, « TODO: style »)
export const GLISSANDO_SAME_LINE_TILT = 0.25; // décalage de chaque bout si les deux notes sont sur la même ligne
export const LINE_END_TO_BARLINE = 0.25; // Sid::lineEndToBarlineDistance
export const HEADER_TO_LINE_START = 1.0; // Sid::headerToLineStartDistance
// `int llWidth = ledgerLineWidth × spatium` (troncature entière ; spatium interne = 1,75 mm × DPMM, DPI = 1200 — dom/mscore.h)
const SPATIUM_PX = (1.75 * 1200) / 25.4;
export const LEDGER_BAND = Math.trunc(0.16 * SPATIUM_PX) / SPATIUM_PX;
// glyphe wiggleGlissando (Bravura.otf) : avance 240/250 ; hauteur de boîte 0,444 (bbox du sous-ensemble)
export const WIGGLE_ADVANCE = 0.96;
const WIGGLE_HEIGHT = 0.444;
// Texte : Edwin italique 8 pt × spatium / spatium défaut (1,75 mm = 4,9606 pt) ; largeur de « gliss. » et descente mesurées sur l'export
// MuseScore de Jean (345,0 px et 38,95 px pour 94,49 px/sp), Edwin n'étant pas disponible ici.
export const TEXT_SIZE = 8 / ((1.75 * 72) / 25.4);
export const DEFAULT_TEXT = 'gliss.';
export const DEFAULT_TEXT_WIDTH = 345.0 / 94.49;
const TEXT_DESCENT = 38.95 / 94.49;
const TEXT_RAISE_STRAIGHT = 0.1;
const TEXT_RAISE_WAVY = 0.4;

/** `end` est-il l'élément qui suit immédiatement `start` dans la voix (même mesure, ou 1er de la mesure suivante) — et un accord ? */
function isNextChord(staff, start, end) {
  const measures = staff.voices[start.voice].measures;
  const cur = measures[start.mi];
  if (start.ii + 1 < cur.items.length) return end.mi === start.mi && end.ii === start.ii + 1;
  const next = measures[start.mi + 1];
  return Boolean(next && next.items.length && end.mi === start.mi + 1 && end.ii === 0);
}

/** Résout `PID.GLISSANDOS` : { ...entrée, start, end } (voix, mi, ii, chordId) ; ignore les entrées invalides (note disparue, accords non contigus, autre voix, 2e glissando sortant d'une même note). */
export function resolveStaffGlissandos(staff) {
  const idx = noteIndexMap(staff);
  const seen = new Set();
  const out = [];
  for (const g of getProperty(staff, PID.GLISSANDOS) || []) {
    const start = idx.get(g.startNoteId);
    const end = idx.get(g.endNoteId);
    if (!start || !end || start.voice !== end.voice || seen.has(g.startNoteId)) continue;
    // un glissando relie deux accords CONTIGUS (`SLine::guessFinalNote` : segment qui suit `endTick` de l'accord de départ, même piste) :
    // jamais par-dessus une note ou un silence intermédiaire
    if (!isNextChord(staff, start, end)) continue;
    seen.add(g.startNoteId);
    out.push({ ...g, start, end });
  }
  return out;
}

/**
 * Glissando RUNS (organ white-key run, model/glissandorun.js): entries with no start note (only the arrival `endNoteId` and `startInterval`); older
 * files have a before-ornament (grace note) as start.
 * Resolved apart from `resolveStaffGlissandos` (which ignores them: an ornament is not in the note index), so that nothing that reads the ordinary glissandos
 * (ties, tablature, spacing) changes. Returns { ...entry, start: { voice, mi, ii, chordId (the ARRIVAL chord), grace: true }, end, startPitch } ;
 * an entry whose ornament or arrival has disappeared is ignored.
 */
export function resolveRunGlissandos(staff) {
  const list = (getProperty(staff, PID.GLISSANDOS) || []).filter(isRunEntry);
  if (!list.length) return [];
  const idx = noteIndexMap(staff);
  const out = [];
  const seen = new Set();
  for (const g of list) {
    const end = idx.get(g.endNoteId);
    if (!end || seen.has(g.endNoteId)) continue;
    const chord = staff.voices[end.voice].measures[end.mi].items[end.ii];
    // older files: the start is a grace note (drawn as a real glissando from it); current files: no start note, `startInterval` only
    const grace = g.startNoteId ? (chord.graceNotes ?? []).flatMap((gc) => gc.notes).find((n) => n.id === g.startNoteId) : null;
    if (g.startNoteId && !grace) continue;
    if (!grace && !Number.isInteger(g.startInterval)) continue;
    seen.add(g.endNoteId);
    out.push({ ...g, start: { ...end, grace: !!grace, stub: !grace }, end, startPitch: grace ? getProperty(grace, PID.PITCH) : null });
  }
  return out;
}

/** Type, texte et affichage du texte d'un glissando (valeur locale > style). */
export function glissandoProps(g, style) {
  return {
    wavy: (g.glissandoType ?? style(SID.GLISSANDO_TYPE)) === 'wavy',
    showText: g.showText ?? style(SID.GLISSANDO_SHOW_TEXT),
    text: g.text ?? style(SID.GLISSANDO_TEXT),
  };
}

/**
 * Boîtes { left, right, bottom, top } de la FORME d'un accord (`ChordLayout::fillShape`) à partir de ses éléments d'affichage :
 * têtes, altérations, crochet (absent si ligaturé : `beamed`), lignes supplémentaires, hampe, trémolo. Ni articulations, nuances ni paroles.
 */
export function boxesFromItems(items, glyphs, { beamed = false } = {}) {
  const boxes = [];
  for (const it of items) {
    if (it.cue) continue; // note d'aide d'un ornement : pas dans la forme de l'accord
    if (it.kind === 'glyph') {
      if (it.role && it.role !== 'accidental' && it.role !== 'flag' && it.role !== 'tremolo') continue;
      if (it.role === 'flag' && beamed) continue;
      const b = glyphs.glyphs[it.name].bbox;
      const m = it.mag ?? 1;
      boxes.push({ left: it.x + b.bBoxSW[0] * m, right: it.x + b.bBoxNE[0] * m, bottom: it.y + b.bBoxSW[1] * m, top: it.y + b.bBoxNE[1] * m, head: !it.role });
    } else if (it.kind === 'line' && (it.role === 'stem' || it.role === 'ledger')) {
      const h = it.width / 2;
      let left = Math.min(it.x1, it.x2) - (it.role === 'stem' ? h : 0);
      let right = Math.max(it.x1, it.x2) + (it.role === 'stem' ? h : 0);
      if (it.role === 'stem') {
        // MuseScore : la hampe affleure le bord de la tête (`StemLayout::stemPosX`) ; la nôtre déborde de ~0,04 sp (position du prototype) :
        // on la ramène dans l'étendue des têtes pour que la forme soit celle de MuseScore
        const heads = boxes.filter((b) => b.head);
        if (heads.length) {
          left = Math.max(left, Math.min(...heads.map((b) => b.left)));
          right = Math.min(right, Math.max(...heads.map((b) => b.right)));
        }
      }
      boxes.push({ left, right, bottom: Math.min(it.y1, it.y2) - (it.role === 'ledger' ? h : 0), top: Math.max(it.y1, it.y2) + (it.role === 'ledger' ? h : 0) });
    } else if (it.kind === 'polygon' && it.role === 'tremolo') {
      const xs = it.points.map((p) => p[0]);
      const ys = it.points.map((p) => p[1]);
      boxes.push({ left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) });
    }
  }
  return boxes;
}

/** `Shape::rightMostEdgeAtHeight` / `leftMostEdgeAtHeight` : bord extrême des boîtes qui recoupent STRICTEMENT la bande [lo, hi]. */
export function edgeAtHeight(boxes, lo, hi, side) {
  let edge = null;
  for (const b of boxes) {
    if (!(b.top > lo && b.bottom < hi)) continue;
    if (side === 'right') edge = edge === null ? b.right : Math.max(edge, b.right);
    else edge = edge === null ? b.left : Math.min(edge, b.left);
  }
  return edge;
}

/**
 * Points d'accroche d'un glissando (étape « centres de têtes » puis raccourcissement au bord de la forme, `layoutNoteAnchoredLine`).
 * `start`/`end` : { x (origine de la tête), y, headW, headTop, headBottom (espaces, absolus), boxes, pitch } ; `sameLine` : même
 * position sur la portée. Renvoie { ax, ay, bx, by (centres, y incliné si même ligne), sx, ex (x raccourcis), upDown }.
 */
export function glissandoAnchors({ start, end, sameLine }) {
  const upDown = Math.sign(end.pitch - start.pitch);
  const ax = start.x + start.headW / 2;
  const bx = end.x + end.headW / 2;
  let ay = start.y;
  let by = end.y;
  if (sameLine) {
    ay -= GLISSANDO_SAME_LINE_TILT * upDown;
    by += GLISSANDO_SAME_LINE_TILT * upDown;
  }
  const rightEdge = edgeAtHeight(start.boxes, start.headBottom, start.headTop, 'right') ?? start.x + start.headW;
  // arrivée : seule la moitié de tête du côté d'où arrive la ligne (+ épaisseur de ligne supplémentaire tronquée)
  const mid = (end.headBottom + end.headTop) / 2;
  let lo = end.headBottom;
  let hi = end.headTop;
  if (upDown === 1) hi = mid + LEDGER_BAND;
  else if (upDown === -1) lo = mid - LEDGER_BAND;
  const leftEdge = edgeAtHeight(end.boxes, lo, hi, 'left') ?? end.x;
  return { ax, ay, bx, by, sx: rightEdge + GLISSANDO_NOTE_DIST, ex: leftEdge - GLISSANDO_NOTE_DIST, rightEdge, leftEdge, upDown };
}

/**
 * Segments par système. `spans` : un élément par système traversé, du système de départ à celui d'arrivée :
 * { right, rawRight } pour le système de départ (`endingXForOpenEndedLines` et bord réel), { left, rawLeft } pour celui d'arrivée
 * (`firstNoteRestSegmentX(true)` et début réel de la musique), les deux pour un système intermédiaire. Un seul élément = même système.
 * La hauteur des jonctions est interpolée sur la SOMME des largeurs des segments (`xTot = Σ ipos2.x`), pas sur les systèmes bout à bout.
 * @returns [{ x1, y1, x2, y2, type: 'SINGLE'|'BEGIN'|'MIDDLE'|'END' }]
 */
export function glissandoSegments(a, spans) {
  const n = spans.length;
  if (n === 1) {
    if (a.ex <= a.sx) return [];
    const slope = a.bx !== a.ax ? (a.by - a.ay) / (a.bx - a.ax) : 0;
    return [{ x1: a.sx, y1: a.ay + slope * (a.sx - a.ax), x2: a.ex, y2: a.ay + slope * (a.ex - a.ax), type: 'SINGLE' }];
  }
  // étape « centres de têtes » : étendue de chaque segment, et cumul des largeurs
  const ranges = spans.map((s, k) => ({ from: k === 0 ? a.ax : s.left, to: k === n - 1 ? a.bx : s.right }));
  const xTot = ranges.reduce((t, r) => t + (r.to - r.from), 0);
  const slope = xTot !== 0 ? (a.by - a.ay) / xTot : 0;
  const segs = [];
  let cum = 0;
  ranges.forEach((r, k) => {
    const yAt = (x) => a.ay + slope * (cum + (x - r.from));
    let x1 = r.from;
    let x2 = r.to;
    if (k === 0) x1 = a.sx;
    if (k === n - 1) x2 = a.ex;
    // filets de sécurité (choix de Jean, prototype) : jamais rien de dessiné à cheval sur un retour à la ligne
    if (x2 <= x1) {
      if (k === 0) { x1 = a.rightEdge; x2 = spans[k].rawRight; }
      else if (k === n - 1) { x1 = spans[k].rawLeft; x2 = a.leftEdge; }
      else { x1 = spans[k].rawLeft; x2 = spans[k].rawRight; }
    }
    if (x2 <= x1) x2 = x1 + 0.3;
    segs.push({ x1, y1: yAt(x1), x2, y2: yAt(x2), type: k === 0 ? 'BEGIN' : k === n - 1 ? 'END' : 'MIDDLE', system: k });
    cum += r.to - r.from;
  });
  return segs;
}

/** Éléments d'affichage d'UN segment (`TDraw::draw(GlissandoSegment*)`) : trait ou rangée de `wiggleGlissando`, puis texte. */
export function glissandoSegmentItems(seg, { wavy, showText, text, width, ref }) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const l = Math.hypot(dx, dy);
  if (dx <= 0 || l <= 0) return [];
  const ux = dx / l;
  const uy = dy / l;
  const vx = -uy; // normale, vers le « haut » du repère tourné
  const vy = ux;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const at = (d, h) => ({ x: seg.x1 + ux * d + vx * h, y: seg.y1 + uy * d + vy * h });
  const items = [];
  if (!wavy) {
    items.push({ kind: 'line', role: 'glissando', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, width, cap: 'butt', ref });
  } else {
    const n = Math.floor(l / WIGGLE_ADVANCE); // arrondi à l'inférieur : jamais de chevauchement
    const x0 = (l - n * WIGGLE_ADVANCE) / 2;
    for (let i = 0; i < n; i++) {
      const p = at(x0 + i * WIGGLE_ADVANCE, -WIGGLE_HEIGHT / 2); // boîte du glyphe centrée sur la ligne
      items.push({ kind: 'glyph', name: 'wiggleGlissando', x: p.x, y: p.y, rotate: angle, role: 'glissando', ref });
    }
  }
  // texte : sur CHAQUE segment où il tient (`r.width() < l`) ; largeur mesurée seulement pour le texte par défaut (sinon : toujours dessiné)
  if (showText && (text !== DEFAULT_TEXT || DEFAULT_TEXT_WIDTH < l)) {
    const p = at(l / 2, TEXT_DESCENT + (wavy ? TEXT_RAISE_WAVY : TEXT_RAISE_STRAIGHT));
    items.push({ kind: 'text', role: 'glissando-text', text, x: p.x, y: p.y, size: TEXT_SIZE, anchor: 'middle', italic: true, rotate: angle, ref });
  }
  return items;
}

/**
 * Largeur SUPPLÉMENTAIRE à réserver entre deux colonnes adjacentes pour respecter la longueur minimale entre les deux points d'accroche
 * (`horizontalspacing.cpp`, `computeNotePadding`). `a` : ancres calculées avec l'origine de la tête de départ à 0 et celle d'arrivée à
 * la distance naturelle des deux colonnes.
 */
export function glissandoMinPadding(a, wavy, style) {
  const min = wavy ? style(SID.MIN_WIGGLY_GLISSANDO_LENGTH) : style(SID.MIN_STRAIGHT_GLISSANDO_LENGTH);
  return Math.max(0, min - (a.ex - a.sx));
}
