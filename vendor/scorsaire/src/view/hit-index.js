/*
 * Index de hit-test de la vue — PUR (aucun DOM), construit APRÈS `layoutMovement` à partir de sa sortie, en lecture seule :
 * il ne modifie ni les éléments d'affichage, ni le contexte, ni les mémos de la mise en page.
 *
 * Chaque élément d'affichage lié au modèle (`ref`) devient une entrée { ref, role, type, rect, rects, z, order } où `rects` est la
 * FORME de hit-test (un ensemble de rectangles) et `rect` leur boîte englobante, exprimés en PIXELS DU SVG (même repère que
 * `renderSvgString` : X = marge + (x0 du système + x) × ss ; Y = (haut du système + origine de la portée − y) × ss).
 *  - éléments du modèle : une boîte (`layout/bounds.js: itemRect`, même source que l'espacement vertical) ;
 *  - entrées de listes (liaisons, soufflets, doigtés…, tranche 2 bis) : formes de `hit-shape.js` (ports de MuseScore : rectangles le
 *    long d'une courbe, un rectangle par tronçon de ligne…). Plusieurs entrées d'index peuvent porter le même `ref` (un système = un
 *    segment) : la sélection est par `ref`, donc toute l'entrée.
 *
 * Règles reprises de MuseScore 4.7.5 (`NotationInteraction::hitElements` / `elementIsLess`, lus) :
 *  - deux phases : d'abord les éléments dont la forme CONTIENT le point ; s'il n'y en a aucun, ceux dont la forme touche un carré
 *    de tolérance autour du point ;
 *  - priorité : une note l'emporte sur une hampe ou un crochet, une hampe sur un crochet ; sinon l'empilement `z` (ordre des types
 *    d'éléments MuseScore, `hit-shape.js: zOf` : liaisons et ties SOUS les notes, soufflets, trilles, pédales… AU-DESSUS) quand les
 *    deux éléments en ont un, et à défaut l'ordre de dessin (le dernier dessiné est dessus).
 * ÉCART assumé : le carré de tolérance est centré (±t) ; MuseScore utilise un rectangle asymétrique (−w .. +2w).
 */
import { itemRect } from '../layout/bounds.js';
import { hitRectsOf, outlineOf, unionRect, zOf } from './hit-shape.js';
import { MARK_KINDS } from '../model/listindex.js';

/** Types du Document qui ne sont que du décor (lignes de portée, barres, clés…) ou des conteneurs : jamais sélectionnables. */
const NOT_SELECTABLE = new Set(['work', 'movement', 'track', 'staff', 'voice', 'measure', 'masterbar', 'group']);

/** true si l'élément du modèle (ou le descripteur d'une entrée de liste) peut être sélectionné (pas du décor ni un conteneur). */
export const isSelectableElement = (el) => !!el && !NOT_SELECTABLE.has(el.type);

const isNoteType = (t) => t === 'note' || t === 'tabnote' || t === 'percnote' || t === 'accnote' || t === 'rhythmnote';

/** Genres d'entrées dont toutes les formes d'un même système et d'une même portée n'en font qu'UNE (bbox de segment : bend). */
const UNION_KINDS = new Set(['bend', ...MARK_KINDS]);

/**
 * @param layout   sortie de layoutMovement
 * @param glyphs   données Bravura
 * @param opts.resolve   (ref) → élément du modèle | descripteur d'entrée de liste `{ listEntry: true, type, entry }` | undefined
 *                       (défaut : tout ref est accepté, de type inconnu)
 * @param opts.staffSpace, opts.margin   comme `renderSvgString` ; opts.showHidden : les éléments masqués sont sélectionnables (affichés en gris)
 */
export function buildHitIndex(layout, glyphs, { resolve, staffSpace = 14, margin = 10, showHidden = false, only = null } = {}) {
  const ss = staffSpace;
  const entries = [];
  const cache = new Map(); // ref → élément résolu | null (non sélectionnable)
  const resolved = (ref) => {
    if (cache.has(ref)) return cache.get(ref);
    let el = null;
    if (resolve) {
      const found = resolve(ref);
      el = isSelectableElement(found) ? found : null;
    } else el = { type: 'unknown' };
    cache.set(ref, el);
    return el;
  };
  let order = 0;
  const groups = new Map(); // genres « union » : clé système|portée|ref → entrées
  for (const sys of layout.systems) {
    const ox = margin + sys.x0 * ss;
    const oy = sys.top * ss;
    sys.staves.forEach((staff, staffIdx) => {
      const px = (r) => ({ x1: ox + r.x1 * ss, x2: ox + r.x2 * ss, y1: oy + (staff.originY - r.y2) * ss, y2: oy + (staff.originY - r.y1) * ss });
      for (const it of staff.items) {
        order += 1;
        if (!it.ref) continue;
        if (only && !only.has(it.ref) && !(it.sel && only.has(it.sel))) continue;
        if (it.hidden && !showHidden) continue; // décor masqué : intouchable tant qu'on ne choisit pas de l'afficher (`isInteractionAvailable`)
        // marque d'accord (nuance, articulation…) : `sel` = son identifiant propre ; repli sur l'accord si elle n'est pas résolue
        const key = it.sel && resolve && resolved(it.sel) ? it.sel : it.ref;
        const el = resolved(key);
        if (!el) continue;
        let rects;
        if (el.listEntry) rects = hitRectsOf(it, glyphs, el.type).map(px);
        else {
          const r = itemRect(it, glyphs);
          rects = r && Number.isFinite(r.x1 + r.x2 + r.y1 + r.y2) ? [px(r)] : [];
        }
        if (!rects.length) continue;
        const entry = {
          ref: key, baseRef: it.ref, role: it.role ?? null, type: el.type, order, z: zOf(el, it.role ?? null), rects, rect: unionRect(rects),
          listEntry: !!el.listEntry,
          /** Contour de surbrillance en pixels du SVG (calculé à la demande) : { kind: 'rect' | 'path', … } ou null. */
          outline() {
            // éléments du modèle : leur boîte (comme avant) ; seules les entrées de listes ont un contour propre
            const o = el.listEntry && !MARK_KINDS.includes(el.type) ? outlineOf(it, glyphs) : null;
            if (!o) return entry.rect ? { kind: 'rect', ...entry.rect } : null;
            if (o.kind === 'rect') return { kind: 'rect', ...px(o) };
            const points = o.points.map(([x, y]) => [ox + x * ss, oy + (staff.originY - y) * ss]);
            if (!points.every(([x, y]) => Number.isFinite(x + y))) return entry.rect ? { kind: 'rect', ...entry.rect } : null;
            return { kind: 'path', closed: o.closed, strokeWidth: o.width * ss, points };
          },
        };
        entries.push(entry);
        if (el.listEntry && UNION_KINDS.has(el.type)) {
          const gkey = `${sys.index}|${staffIdx}|${key}`;
          if (!groups.has(gkey)) groups.set(gkey, []);
          groups.get(gkey).push(entry);
        }
      }
    });
  }
  // bbox de segment (bend) : toutes les formes d'une même entrée dans une même portée d'un système n'en font qu'une
  for (const list of groups.values()) {
    const u = unionRect(list.flatMap((e) => e.rects));
    for (const e of list) { e.rects = [u]; e.rect = u; }
  }
  return { entries, hit: (x, y, tolerance = 1) => hitTest(entries, x, y, tolerance), size: entries.length };
}

const containsRect = (r, x, y) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
const touchesRect = (r, x, y, t) => r.x2 >= x - t && r.x1 <= x + t && r.y2 >= y - t && r.y1 <= y + t;
// forme de hit-test d'une entrée : ses rectangles (`rects`), ou à défaut sa seule boîte (`rect`, entrées simples construites à la main)
const shapeOf = (e) => e.rects ?? [e.rect];
const contains = (e, x, y) => shapeOf(e).some((r) => containsRect(r, x, y));
const touches = (e, x, y, t) => shapeOf(e).some((r) => touchesRect(r, x, y, t));

/** true si `a` est SOUS `b` (b prioritaire) — port de `elementIsLess`. */
function isBelow(a, b) {
  const an = isNoteType(a.type), bn = isNoteType(b.type);
  const as = a.role === 'stem', bs = b.role === 'stem';
  const ah = a.role === 'flag', bh = b.role === 'flag';
  if (an && (bs || bh)) return false;
  if (bn && (as || ah)) return true;
  if (as && bh) return false;
  if (bs && ah) return true;
  if (a.z != null && b.z != null && a.z !== b.z) return a.z < b.z; // empilement des types d'éléments de MuseScore
  return a.order < b.order;
}

/** @returns {{ref,role,type}|null} l'élément le plus prioritaire sous le point (pixels du SVG). */
export function hitTest(entries, x, y, tolerance = 1) {
  let cands = entries.filter((e) => contains(e, x, y));
  if (!cands.length && tolerance > 0) cands = entries.filter((e) => touches(e, x, y, tolerance));
  if (!cands.length) return null;
  let best = cands[0];
  for (const c of cands) if (isBelow(best, c)) best = c;
  return { ref: best.ref, role: best.role, type: best.type };
}
