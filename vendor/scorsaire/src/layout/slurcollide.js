/*
 * Courbe d'une liaison d'expression (slur) avec évitement de collision — port de `SlurTieLayout::computeBezier(SlurSegment*)`,
 * `adjustEndPoints`, `avoidCollisions` et leurs aides (`slurtielayout.cpp`, MuseScore v4.7.5, lu en entier : jamais deviné).
 * Utilisé par la tablature (`tabspanners.js`), où les points de départ/arrivée et les points de contrôle bougent selon les numéros,
 * hampes et silences sous la liaison (exports E5 de Jean). Le peintre `score` garde sa version simplifiée (voir slurs.js).
 *
 * REPÈRE : y vers le BAS depuis la ligne du haut de la portée (celui de MuseScore) ; 1 unité = 1 sp ; `spatium` = 1.
 * Pur : aucune dépendance au modèle ni au DOM.
 */
import { tieOrSlurThickness } from './slurtie.js';

const EPS = 1e-6; // les bords d'un accord et le départ de la courbe coïncident EXACTEMENT : l'égalité compte comme collision (`<=`), tolérance contre les arrondis
const NPOINTS = 20;
const MAX_ITER = 30;
const STEEP_LIMIT = Math.PI / 4;
const SLANT_REDUCTION_ANGLE = (5 * Math.PI) / 180;
const SLANT_REDUCTION_LENGTH = 8;
const SHAPE_PREFER_CENTER_FACTOR = 2.0;
const LONG_SLUR_LIMIT = 16.0;

/** Marges de dégagement ajoutées aux formes (`addMinClearanceToShapes`) : notes 0,4 ; articulations 0,2 ; autres 0,1. */
export const CLEARANCE = { note: 0.4, articulation: 0.2, other: 0.1 };

const rot = (a, p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k });

/** `adjustEndPoints` : écarte les extrémités des lignes de portée (distance de lignes `lw`, `lines` lignes). */
export function adjustEndpointY(y, up, { lw, lines, lineThickness }) {
  const margin = 0.175 + 0.5 * lineThickness * (1 / lw);
  const ysp = y / lw;
  if (!(ysp > -margin && ysp < (lines - 1) + margin)) return y;
  const offset = ysp - Math.floor(ysp);
  let adjust = 0;
  if (up) {
    if (offset < margin) adjust = -(offset + margin);
    else if (offset > 1 - margin) adjust = -(offset - (1 - margin));
  } else {
    if (offset < margin) adjust = margin - offset;
    if (offset > 1 - margin) adjust = (1 - offset) + margin;
  }
  return y + adjust * lw;
}

/** Largeur d'épaule (fraction de la longueur) selon la longueur en sp. */
const shoulderWidth = (d) => (d < 2 ? 0.6 : d < 10 ? 0.5 : d < 18 ? 0.6 : 0.7);

/** `computeAdjustmentStep` : NB — `std::min(step, 1,5)` ne plafonne pas un pas NÉGATIF (liaison vers le haut) : porté tel quel. */
function adjustmentStep(upSign, slurLength) {
  let step = upSign * 0.30;
  if (slurLength > LONG_SLUR_LIMIT) {
    step *= slurLength / LONG_SLUR_LIMIT;
    step = Math.min(step, 1.5);
  }
  return step;
}

const arcClearanceOf = (slurLength, angle) => Math.min(Math.max(0.04 * slurLength * Math.cos(angle) ** 2, 0.1), 0.5);

/**
 * @param pp1,pp2  extrémités {x,y} (y vers le bas)
 * @param shapes   rectangles à éviter [{ x1, x2, y1, y2 }] (y1 < y2), clearances DÉJÀ appliquées (`withClearance`)
 * @param balance  { left, right } (`computeAdjustmentBalance`)
 * @param overBeams  `isOverBeams` : épaule × 0,75
 * @returns { p1, p2, c1, c2, mid } en repère système (c1/c2 = points de contrôle de la LIGNE MÉDIANE ; `mid` = demi-épaisseur au milieu)
 */
export function layoutSlurCurve({ pp1, pp2, up, shapes, balance, lw, lines, lineThickness, overBeams = false }) {
  const upSign = up ? -1 : 1;
  const edge = { lw, lines, lineThickness };
  let P1 = { x: pp1.x, y: adjustEndpointY(pp1.y, up, edge) };
  let P2 = { x: pp2.x, y: adjustEndpointY(pp2.y, up, edge) };
  const angle = Math.atan((P2.y - P1.y) / (P2.x - P1.x));
  const toSlur = (p) => rot(-angle, sub(p, P1));
  let p2 = toSlur(P2);
  const d = p2.x;
  if (d < 0) return null;
  const W = shoulderWidth(d);
  let shoulderH = Math.sqrt(d / 4);
  if (overBeams) shoulderH *= 0.75;
  if (!up) shoulderH = -shoulderH;
  const c = p2.x;
  const c1x = (c - c * W) * 0.5;
  const c2x = c1x + c * W;
  let p3 = { x: c1x, y: -shoulderH };
  let p4 = { x: c2x, y: -shoulderH };
  let toSystem = (p) => add(P1, rot(angle, p));

  // ---- avoidCollisions ----
  if (shapes.length) {
    const slurLength = Math.abs(p2.x);
    const arcClearance = -upSign * arcClearanceOf(slurLength, angle);
    const { left: leftBalance, right: rightBalance } = balance;
    const step = adjustmentStep(upSign, slurLength);
    const bez = (a, b, cc, dd, t) => {
      const u = 1 - t;
      return {
        x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * cc.x + t * t * t * dd.x,
        y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * cc.y + t * t * t * dd.y,
      };
    };
    let iter = 0;
    let collision;
    do {
      collision = { left: false, mid: false, right: false };
      const origin = { ...P1 };
      const angleNow = angle;
      toSystem = (p) => add(origin, rot(angleNow, p));
      const cb1 = add(p3, { x: 0, y: arcClearance });
      const cb2 = add(p4, { x: 0, y: arcClearance });
      const rects = [];
      for (let i = 0; i < NPOINTS - 1; i++) {
        const a = toSystem(bez({ x: 0, y: 0 }, cb1, cb2, p2, i / NPOINTS));
        const b = toSystem(bez({ x: 0, y: 0 }, cb1, cb2, p2, (i + 1) / NPOINTS));
        rects.push({ x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) });
      }
      const n = rects.length;
      rects.forEach((r, i) => {
        const left = i < Math.floor(n / 3);
        const mid = i >= Math.floor(n / 3) && i < Math.floor((2 * n) / 3);
        const right = i >= Math.floor((2 * n) / 3);
        if ((left && collision.left) || (mid && collision.mid) || (right && collision.right)) return;
        let hit = false;
        for (const s of shapes) {
          if (s.x1 === s.x2 || r.x1 === r.x2) continue;
          if (!(s.x2 > r.x1 && s.x1 < r.x2)) continue; // `intersects` (sans marge)
          // liaison vers le haut : la forme dépasse le bas du rectangle ; vers le bas : le haut du rectangle dépasse le bas de la forme
          if (up ? s.y1 <= r.y2 + EPS : r.y1 <= s.y2 + EPS) { hit = true; break; }
        }
        if (hit) { if (left) collision.left = true; if (mid) collision.mid = true; if (right) collision.right = true; }
      });

      if (iter % 2 === 0) {
        if (collision.left) {
          const s = ((1 - leftBalance) * step) / SHAPE_PREFER_CENTER_FACTOR;
          p3 = add(p3, { x: -Math.abs(s), y: s });
          p4 = add(p4, scale({ x: Math.abs(s), y: s }, 0.5));
        }
        if (collision.mid) {
          const sl = (1 - leftBalance) * step;
          const sr = (1 - rightBalance) * step;
          p3 = add(p3, { x: 0, y: (sl + sr) / 2 });
          p4 = add(p4, { x: 0, y: (sl + sr) / 2 });
        }
        if (collision.right) {
          const s = ((1 - rightBalance) * step) / SHAPE_PREFER_CENTER_FACTOR;
          p4 = add(p4, { x: Math.abs(s), y: s });
          p3 = add(p3, scale({ x: -Math.abs(s), y: s }, 0.5));
        }
      } else {
        const p2sys = toSystem(p2);
        const curSlant = (p2sys.y - P1.y) / (p2sys.x - P1.x);
        if (collision.left || collision.mid || angle < -STEEP_LIMIT) {
          let endLeft = leftBalance * step;
          if (!collision.left && collision.mid && Math.abs(curSlant) > SLANT_REDUCTION_ANGLE && slurLength > SLANT_REDUCTION_LENGTH) {
            const ratio = Math.abs(curSlant) / SLANT_REDUCTION_ANGLE;
            const leftIsOuter = (up && curSlant > 0) || (!up && curSlant < 0);
            endLeft *= leftIsOuter ? 1 / ratio : ratio;
          }
          const delta = { x: Math.sin(angle) * endLeft, y: Math.cos(angle) * endLeft };
          P1 = add(P1, { x: 0, y: endLeft });
          p3 = add(p3, scale(delta, (p2.x - p3.x) / p2.x));
          p4 = add(p4, scale(delta, (p2.x - p4.x) / p2.x));
          p2 = sub(p2, delta); p3 = sub(p3, delta); p4 = sub(p4, delta);
        }
        if (collision.right || collision.mid || angle > STEEP_LIMIT) {
          let endRight = rightBalance * step;
          if (!collision.right && collision.mid && Math.abs(curSlant) > SLANT_REDUCTION_ANGLE && slurLength > SLANT_REDUCTION_LENGTH) {
            const ratio = Math.abs(curSlant) / SLANT_REDUCTION_ANGLE;
            const rightIsOuter = (up && curSlant < 0) || (!up && curSlant > 0);
            endRight *= rightIsOuter ? 1 / ratio : ratio;
          }
          const delta = { x: Math.sin(angle) * endRight, y: Math.cos(angle) * endRight };
          p2 = add(p2, delta);
          p3 = add(p3, scale(delta, p3.x / p2.x));
          p4 = add(p4, scale(delta, p4.x / p2.x));
        }
      }
      // règles « anti-laideur » : 1) pas plus haute que large ; 2) tangentes : points de contrôle entre les deux extrémités
      const maxRel = Math.abs(p2.x);
      p3 = { x: p3.x, y: up ? Math.max(p3.y, -maxRel) : Math.min(p3.y, maxRel) };
      p4 = { x: p4.x, y: up ? Math.max(p4.y, -maxRel) : Math.min(p4.y, maxRel) };
      const inv = (p) => rot(-angleNow, sub(p, origin));
      const p2s = toSystem(p2);
      let p3s = toSystem(p3); let p4s = toSystem(p4);
      p3s = { x: Math.min(p2s.x, Math.max(P1.x, p3s.x)), y: p3s.y };
      p4s = { x: Math.min(p2s.x, Math.max(P1.x, p4s.x)), y: p4s.y };
      p3 = inv(p3s); p4 = inv(p4s);
      iter++;
    } while ((collision.left || collision.mid || collision.right) && iter < MAX_ITER);
  }

  // ---- fin de computeBezier : réajustement des extrémités, nouveau repère ----
  const startP = { ...P1 };
  const endP = toSystem(p2);
  const newP1 = { x: startP.x, y: adjustEndpointY(startP.y, up, edge) };
  const newP2 = { x: endP.x, y: adjustEndpointY(endP.y, up, edge) };
  const difference = rot(-angle, sub(newP1, P1));
  P1 = newP1;
  const P2f = newP2;
  p3 = sub(p3, difference);
  p4 = sub(p4, difference);
  const toSlur2 = (p) => rot(-angle, sub(p, P1));
  const toSystem2 = (p) => add(P1, rot(angle, p));
  p2 = toSlur2(P2f);
  const mid = tieOrSlurThickness(p2.x);
  const thick = { x: 0, y: mid };
  return {
    p1: P1, p2: P2f,
    c1: toSystem2(p3), c2: toSystem2(p4),
    a1: toSystem2(sub(p3, thick)), a2: toSystem2(sub(p4, thick)),
    b1: toSystem2(add(p3, thick)), b2: toSystem2(add(p4, thick)),
    mid, up,
  };
}

/** Applique les marges de dégagement (`addMinClearanceToShapes`) : `kind` = 'note' | 'articulation' | 'other' ; `own` = pas de marge (accord de bornes). */
export function withClearance(shapes, up) {
  return shapes.map((s) => {
    const clearance = s.own ? 0 : CLEARANCE[s.kind ?? 'other'];
    return up ? { x1: s.x1, x2: s.x2, y1: s.y1 - clearance, y2: s.y2 } : { x1: s.x1, x2: s.x2, y1: s.y1, y2: s.y2 + clearance };
  });
}
