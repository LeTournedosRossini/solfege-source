/*
 * Formes de hit-test et contours de surbrillance des ENTRÉES DE LISTE (étape 5, tranche 2 bis). PUR (aucun DOM).
 *
 * Tout est exprimé en ESPACES DE PORTÉE (repère de portée : y vers le HAUT), comme les éléments d'affichage du moteur ;
 * `hit-index.js` les convertit en pixels du SVG.
 *
 * Formes de hit-test = port de MuseScore 4.7.5 (`NotationInteraction::hitElements` → `EngravingItem::hitShapeContains/Intersects`,
 * `hitShape()` = `shape()`, un ENSEMBLE DE RECTANGLES) :
 *  - liaison, tie, hopo : `SlurTieLayout::fillShape` (lu) — 20 à 50 petits rectangles le long de la colonne vertébrale de la courbe
 *    (pas régulier en sin²), élargis verticalement jusqu'à l'épaisseur approchée ; un hopo est un `SlurSegment` (hammeronpulloff.h) ;
 *  - soufflet, ligne de technique, pédale (lignes de TextLineBase) : `TLayout::layoutTextLineBaseSegment` — un rectangle par tronçon
 *    (`TextLineBaseSegment::boundingBoxOfLine`, lu) ;
 *  - tout le reste (glissando : bbox de `layoutGlissandoSegment` ; bend : bbox du `GuitarBendSegment` + texte
 *    (`fillGuitarBendSegmentShape`) ; trille : formes des symboles ; respiration, doigté, capo, accordage, trémolo de couple :
 *    `setbbox` → `Shape(bbox)`) : la boîte englobante de l'élément d'affichage (`layout/bounds.js: itemRect`).
 *
 * Empilement (`elementIsLess`, lu) : si ni note / hampe / crochet ne tranche, `z` = type × 100 (`EngravingItem::z`) ; seul l'ORDRE
 * des types compte, donné ici par la valeur de `ElementType` dans `types/types.h` (4.7.5) du SEGMENT d'élément correspondant.
 * ÉCARTS assumés : ties — MuseScore passe `tieLengthInSp` à `fillShape` (non relu), ici la longueur de la corde, comme les liaisons ;
 * lignes pointillées (`isDottedLine`) traitées comme pleines ; la boîte d'un texte est approchée (`itemRect`).
 */
import { itemRect } from '../layout/bounds.js';

// ---------- empilement ----------

/** Valeur de `ElementType` (MuseScore 4.7.5, types/types.h) par genre d'entrée de liste ; seul l'ordre est utilisé. */
export const Z_TYPE = Object.freeze({
  slur: 14, // SLUR_SEGMENT
  tie: 16, // TIE_SEGMENT
  breath: 37, // BREATH
  fingering: 51, // FINGERING
  stafftext: 53, // STAFF_TEXT
  capo: 59, // CAPO
  stringtuning: 60, // STRING_TUNINGS
  hairpin: 73, // HAIRPIN_SEGMENT
  trill: 77, // TRILL_SEGMENT
  pedal: 97, // PEDAL_SEGMENT
  glissando: 103, // GLISSANDO_SEGMENT
  bend: 134, // GUITAR_BEND_SEGMENT
  tremolo: 138, // TREMOLO_TWOCHORD
  hopo: 143, // HAMMER_ON_PULL_OFF_SEGMENT
  // marques d'accord
  arpeggio: 22, // ARPEGGIO
  articulation: 39, // ARTICULATION
  chordline: 42, // CHORDLINE
  dynamic: 43, // DYNAMIC
  chordtremolo: 139, // TREMOLO_SINGLECHORD
  tapping: 145, // TAPPING
});
/** Lignes de technique : un type d'élément par technique (`*_SEGMENT`). */
export const Z_TECHLINE = Object.freeze({ letRing: 79, vibrato: 83, palmMute: 85, whammyBar: 87, harmonicMark: 91 });
const Z_NOTE = 28; // NOTE
const Z_STEM = 26; // STEM
const Z_HOOK = 27; // HOOK

const NOTE_TYPES = new Set(['note', 'tabnote', 'percnote', 'accnote', 'rhythmnote']);

/**
 * `z` d'un élément d'affichage (ordre d'empilement MuseScore) ou null si Scorsaire ne le connaît pas (repli : ordre de dessin).
 * @param el    élément résolu : élément du modèle, ou descripteur d'entrée de liste `{ listEntry: true, type: genre, entry }`
 * @param role  rôle de l'élément d'affichage (`stem`, `flag`…)
 */
/** Décor (valeurs `ElementType` de MuseScore 4.7.5 : BAR_LINE 10, CLEF 29, KEYSIG 30, TIMESIG 32). */
export const Z_DECOR = Object.freeze({ barline: 10, clef: 29, keySig: 30, timeSig: 32 });

export function zOf(el, role) {
  if (!el) return null;
  if (el.type === 'decor') return Z_DECOR[el.decor?.kind] ?? null;
  if (el.listEntry) return el.type === 'techline' ? (Z_TECHLINE[el.entry?.type] ?? null) : (Z_TYPE[el.type] ?? null);
  if (role === 'stem') return Z_STEM;
  if (role === 'flag') return Z_HOOK;
  return NOTE_TYPES.has(el.type) ? Z_NOTE : null;
}

// ---------- formes de hit-test ----------

const valid = (r) => r && Number.isFinite(r.x1 + r.x2 + r.y1 + r.y2);

/** Point d'une Bézier cubique. */
function bezierAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
}

/**
 * Port de `SlurTieLayout::fillShape` : rectangles entre points successifs de la colonne vertébrale, élargis (en y, symétriquement)
 * à l'épaisseur approchée (triangle : 0 aux extrémités, 2 × épaisseur au milieu).
 */
export function slurShape(it) {
  const p0 = [it.x1, it.y1], p3 = [it.x2, it.y2];
  const c1 = [it.c1x, it.c1y], c2 = [it.c2x, it.c2y];
  const lengthSp = Math.hypot(it.x2 - it.x1, it.y2 - it.y1);
  const midThickness = 2 * (it.thickness ?? 0);
  const n = Math.min(Math.max(Math.round(5 * lengthSp), 20), 50);
  const rects = [];
  let start = p0;
  for (let i = 1; i <= n; i++) {
    const percent = Math.sin(0.5 * Math.PI * (i / n)) ** 2;
    const point = bezierAt(p0, c1, c2, p3, percent);
    const r = { x1: Math.min(start[0], point[0]), x2: Math.max(start[0], point[0]), y1: Math.min(start[1], point[1]), y2: Math.max(start[1], point[1]) };
    const approx = (1 - 2 * Math.abs(0.5 - percent)) * midThickness;
    const h = r.y2 - r.y1;
    if (h < approx) { const adj = (approx - h) * 0.5; r.y1 -= adj; r.y2 += adj; }
    rects.push(r);
    start = point;
  }
  return rects;
}

/** Port de `TextLineBaseSegment::boundingBoxOfLine` (ligne pleine) : union des deux carrés de demi-côté `lw2` perpendiculaires aux extrémités. */
export function boundingBoxOfLine([ax, ay], [bx, by], lw2) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  const ux = len ? (lw2 * dx) / len : 0, uy = len ? (lw2 * dy) / len : 0;
  const px = -uy, py = ux; // b = (−a.y, a.x)
  const sq = (cx, cy) => ({ x1: Math.min(cx - px, cx + px), x2: Math.max(cx - px, cx + px), y1: Math.min(cy - py, cy + py), y2: Math.max(cy - py, cy + py) });
  const r1 = sq(ax, ay), r2 = sq(bx, by);
  return { x1: Math.min(r1.x1, r2.x1), x2: Math.max(r1.x2, r2.x2), y1: Math.min(r1.y1, r2.y1), y2: Math.max(r1.y2, r2.y2) };
}

const CURVE_KINDS = new Set(['slur', 'tie', 'hopo']);
const TEXTLINE_KINDS = new Set(['hairpin', 'techline', 'pedal']);

/**
 * Rectangles de hit-test (espaces de portée) d'un élément d'affichage appartenant à une entrée de liste de genre `kind`.
 * @returns {{x1,x2,y1,y2}[]} y1 = bord BAS, y2 = bord HAUT
 */
export function hitRectsOf(it, glyphs, kind) {
  if (CURVE_KINDS.has(kind) && it.kind === 'curve') return slurShape(it).filter(valid);
  if (TEXTLINE_KINDS.has(kind) && (it.kind === 'line' || it.kind === 'polyline')) {
    const lw2 = (it.width ?? 0) / 2;
    const pts = it.kind === 'line' ? [[it.x1, it.y1], [it.x2, it.y2]] : it.points;
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) out.push(boundingBoxOfLine(pts[i], pts[i + 1], lw2));
    return out.filter(valid);
  }
  const r = itemRect(it, glyphs);
  return valid(r) ? [r] : [];
}

/** Boîte englobante d'un ensemble de rectangles. */
export function unionRect(rects) {
  let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
  for (const r of rects) { x1 = Math.min(x1, r.x1); x2 = Math.max(x2, r.x2); y1 = Math.min(y1, r.y1); y2 = Math.max(y2, r.y2); }
  return rects.length ? { x1, x2, y1, y2 } : null;
}

// ---------- contours de surbrillance ----------

const SAMPLES = 24;

/**
 * Contour d'un élément d'affichage pour la surbrillance (espaces de portée, y vers le haut) :
 *  - `{ kind: 'rect', x1, x2, y1, y2 }` pour un glyphe, un texte, un cercle, un rectangle ;
 *  - `{ kind: 'path', points, closed, width }` pour une courbe (contour fermé : aller par le dessus, retour par le dessous), une
 *    Bézier, une ligne, une polyligne, un polygone (`width` = épaisseur du trait en espaces, 0 pour une forme remplie).
 * @returns {object|null}
 */
export function outlineOf(it, glyphs) {
  switch (it.kind) {
    case 'curve': {
      const p0 = [it.x1, it.y1], p3 = [it.x2, it.y2];
      const side = (a, b, reverse) => {
        const pts = [];
        for (let k = 0; k <= SAMPLES; k++) pts.push(bezierAt(p0, a, b, p3, k / SAMPLES));
        return reverse ? pts.reverse() : pts;
      };
      const top = side([it.topC1x, it.topC1y], [it.topC2x, it.topC2y], false);
      const bot = side([it.botC1x, it.botC1y], [it.botC2x, it.botC2y], true);
      return { kind: 'path', points: [...top, ...bot], closed: true, width: 0 };
    }
    case 'bezier': {
      const pts = [];
      for (let k = 0; k <= SAMPLES; k++) pts.push(bezierAt([it.x1, it.y1], [it.c1x, it.c1y], [it.c2x, it.c2y], [it.x2, it.y2], k / SAMPLES));
      return { kind: 'path', points: pts, closed: false, width: it.width ?? 0 };
    }
    case 'line': return { kind: 'path', points: [[it.x1, it.y1], [it.x2, it.y2]], closed: false, width: it.width ?? 0 };
    case 'polyline': return { kind: 'path', points: it.points.map((p) => [p[0], p[1]]), closed: false, width: it.width ?? 0 };
    case 'polygon': return { kind: 'path', points: it.points.map((p) => [p[0], p[1]]), closed: true, width: 0 };
    default: {
      const r = itemRect(it, glyphs);
      return valid(r) ? { kind: 'rect', ...r } : null;
    }
  }
}
