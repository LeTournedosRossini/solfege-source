/*
 * Affichage de la pédale (PID.PEDALS, propriété de la portée) — port de MuseScore v4.7.5 : `Pedal` / `PedalSegment` (dom/pedal.cpp, `linePos`,
 * `connect45HookToNext`), `TLayout::layoutLine` (segments SINGLE / BEGIN / MIDDLE / END), `layoutPedalSegment` (rosette), `layoutTextLineBaseSegment`,
 * `TDraw::drawTextLineBaseSegment`, `SystemLayout::processLines(..., align = true)`, styles `pedal*` (styledef.cpp), préréglages de la palette
 * (palettecreator.cpp). Décisions de Jean (11/10/2026) : glyphes SMuFL, les 6 préréglages de MuseScore, dessous la portée par défaut (une seule ligne
 * pour une piste de piano, portée du bas : la pédale est dessinée sous la portée qui la porte), continuation « (Ped.) » à chaque retour à la ligne.
 *
 *  - Ancrage : INSTANTS (masterbar + fraction exacte), comme tempos et changements de clé. x d'un instant = colonne exacte, sinon interpolation du
 *    temps entre colonnes voisines (`xAt` du moteur ; MuseScore crée un segment à l'instant : écart déjà assumé pour les tempos).
 *  - `linePos` : DÉBUT = x de l'instant − 0,5 sp si le texte de début est « Ped. » ; + ½ épaisseur de ligne si crochet droit ; + ½ largeur de tête si
 *    crochet oblique (tête de Bravura brut, 1,18 sp). FIN = x de l'instant − 0,75 sp (1,25 sp devant une autre pédale qui commence au même instant) ;
 *    une fin à l'instant 0 d'une mesure s'arrête à la barre de la mesure précédente ; crochet oblique de fin devant une autre pédale qui commence là :
 *    x de l'instant + ½ tête (les deux crochets se rejoignent).
 *  - Segments : un par système. BEGIN → fin = dernière barre − 0,25 sp ; MIDDLE → début de système (`firstNoteRestSegmentX(true)`) à dernière barre − 0,25 ;
 *    END → du début de système à la fin. Texte de début « Ped. » (`keyboardPedalPed`) ou de continuation « (Ped.) » (parenthèses + « Ped. »)
 *    seulement pour les préréglages SANS crochet de début ; texte de fin « * » (`keyboardPedalUp`) seulement pour le préréglage sans ligne (rosette).
 *  - Ligne pleine 0,11 sp (bout plat, coin à onglet) : démarre à (largeur du texte + 0,5 sp) quand il y a un texte, remontée d'une demi-épaisseur pour
 *    que son bord bas repose sur la ligne de base du texte ; crochets de 1,2 sp vers la portée ; crochet oblique = incliné de 0,4 × hauteur. Pas de
 *    ligne « à l'envers » si le texte dépasse la longueur nominale.
 *  - Rosette (préréglage « Ped. … * ») : la ligne n'est pas dessinée, l'étoile a son bord DROIT à la fin de la pédale (`layoutPedalSegment` : MuseScore
 *    ne passe en mode « impression » qu'au moment de dessiner, la mise en page garde donc ce placement), jamais à gauche de la fin du « Ped. ».
 *  - Position : ligne de base à 2,5 sp sous la ligne du bas (`pedalPosBelow`) ou 1 sp au-dessus de la ligne du haut (`pedalPosAbove`), repoussée à
 *    `pedalMinDistance` (0,7 sp) des éléments déjà posés (boîtes des éléments, pas de skyline continue) ; puis TOUS les segments d'un système, d'un
 *    même côté, sont ramenés au même y — le plus grand y (`processLines(align)` : max, y vers le bas ; même règle des deux côtés, comme MuseScore).
 *
 *  Écarts / limites : boîtes d'éléments au lieu de skyline continue ; tête de crochet oblique = Bravura brut (MuseScore : tête réelle de l'accord,
 *  centre d'un silence) ; pas de déplacement manuel ; les pédales d'une piste à deux portées sont dessinées sous la portée qui les porte ; non vérifié
 *  sur export MuseScore (aucun export de référence).
 */
import { PID, SID, getProperty } from '../model/index.js';
import { pedalSpec } from '../model/pedal.js';
import { measureLengthOf } from '../model/timing.js';
import { fEq, ZERO } from '../model/fraction.js';
import { systemSpan } from './painters/systemspan.js';
import { rectsOf } from './bounds.js';

const TEXT_LINE_GAP = 0.5; // gapBetweenTextAndLine (textlinebase.cpp, espaces)
const HEAD_HALF = 0.59; // ½ tête de note (Bravura brut 1,18 sp)
const START_PED_SHIFT = 0.5; // linePos : début avec « Ped. »
const END_SHIFT = 0.75; // linePos : fin ordinaire
const END_SHIFT_NEXT = 1.25; // linePos : fin devant une autre pédale qui commence au même instant (segment d'accord)
const HOOK_45_SLOPE = 0.4;

/** Texte (suite de glyphes SMuFL) : positions d'origine relatives et largeur de la boîte (dernier glyphe : bord droit de sa boîte). */
function runOf(names, glyphs) {
  let x = 0;
  const parts = [];
  let right = 0;
  let top = -Infinity; let bottom = Infinity;
  for (const name of names) {
    const g = glyphs.glyphs[name];
    if (!g) continue;
    parts.push({ name, dx: x });
    right = x + g.bbox.bBoxNE[0];
    top = Math.max(top, g.bbox.bBoxNE[1]);
    bottom = Math.min(bottom, g.bbox.bBoxSW[1]);
    x += g.advance;
  }
  return { parts, width: right, top: parts.length ? top : 0, bottom: parts.length ? bottom : 0 };
}

const PED = ['keyboardPedalPed'];
const CONTINUE = ['keyboardPedalParensLeft', 'keyboardPedalPed', 'keyboardPedalParensRight'];
const STAR = ['keyboardPedalUp'];

/**
 * @param opts { perSystem, staff, movement, ctx, result, lines, lineDist, existing }
 *   `perSystem[k].xAt(mi, position)` : x d'un instant (fourni par le moteur) ; `result[k]` : éléments d'affichage ajoutés.
 */
export function pedalItems({ perSystem, staff, movement, ctx, result, lines, lineDist, existing = [] }) {
  const entries = getProperty(staff, PID.PEDALS) || [];
  if (!entries.length) return;
  const glyphs = ctx.glyphs;
  const st = (k) => ctx.style(SID[k]);
  const H = (lines - 1) * lineDist;
  const U = (y) => H - y; // y bas (depuis la ligne du haut) → repère de portée (y vers le haut)
  const lw = st('PEDAL_LINE_WIDTH');
  const hookH = st('PEDAL_HOOK_HEIGHT');
  const minDist = st('PEDAL_MIN_DISTANCE');
  const barIds = movement.masterbars.map((b) => b.id);

  // instant canonique : une fin à la longueur de la mesure = début de la mesure suivante (même tick)
  const canon = (measureId, position) => {
    const mi = barIds.indexOf(measureId);
    if (mi < 0) return null;
    if (mi + 1 < barIds.length && fEq(position, measureLengthOf(movement.masterbars[mi]))) return { mi: mi + 1, pos: ZERO };
    return { mi, pos: position };
  };
  const systemOf = (mi) => perSystem.findIndex((s) => s.sys.measures.some((m) => m.mi === mi));
  const barXOf = (mi) => { const k = systemOf(mi); return k < 0 ? null : { k, x: perSystem[k].sys.measures.find((m) => m.mi === mi).barX }; };

  const model = entries
    .map((e) => ({ e, spec: pedalSpec(e), s: canon(e.startMeasureId, e.startPosition), t: canon(e.endMeasureId, e.endPosition) }))
    .filter((r) => r.s && r.t);
  const sameInstant = (a, b) => a.mi === b.mi && fEq(a.pos, b.pos);
  const nextOf = (r) => model.find((o) => o !== r && sameInstant(o.s, r.t));

  // « skyline » par système : boîtes (repère y BAS) des éléments déjà dessinés, corps de la portée compris
  const pool = perSystem.map((_, k) => {
    const rs = rectsOf([...(existing[k] ?? []), ...(result[k] ?? [])], glyphs).map((r) => ({ x1: r.x1, x2: r.x2, top: H - r.y2, bottom: H - r.y1 }));
    rs.push({ x1: -Infinity, x2: Infinity, top: -0.05, bottom: H + 0.05 });
    return rs;
  });

  const segments = []; // { k, below, base0, base, shape, draw }
  for (const r of model) {
    const { e, spec } = r;
    const below = (e.placement ?? st('PEDAL_PLACEMENT')) !== 'above';
    const sgn = below ? -1 : 1; // sens des crochets (y vers le bas) : vers la portée
    const sk = systemOf(r.s.mi);
    if (sk < 0) continue;
    // ---- linePos START
    let startX = perSystem[sk].xAt(r.s.mi, r.s.pos);
    if (spec.beginHook === 'none') startX -= START_PED_SHIFT;
    else if (spec.beginHook === '90') startX += 0.5 * lw;
    else if (spec.beginHook === '45') startX += HEAD_HALF;
    // ---- linePos END
    const next = nextOf(r);
    let ek; let endX;
    if (next && spec.endHook === '45') {
      ek = systemOf(r.t.mi);
      if (ek < 0) continue;
      endX = perSystem[ek].xAt(r.t.mi, r.t.pos) + HEAD_HALF;
    } else if (r.t.pos[0] === 0 && r.t.mi > 0) { // fin à l'instant 0 d'une mesure : barre de la mesure précédente
      const b = barXOf(r.t.mi - 1);
      if (!b) continue;
      ek = b.k; endX = b.x - END_SHIFT;
    } else {
      ek = systemOf(r.t.mi);
      if (ek < 0) continue;
      endX = perSystem[ek].xAt(r.t.mi, r.t.pos) - (next ? END_SHIFT_NEXT : END_SHIFT);
    }
    if (ek < sk) continue;

    for (let k = sk; k <= ek; k++) {
      const isBegin = k === sk; const isEnd = k === ek;
      const span = systemSpan(perSystem, k);
      let x1; let x2;
      if (isBegin && isEnd) { x1 = startX; x2 = endX; }
      else if (isBegin) { x1 = startX; x2 = span.right; }
      else if (isEnd) { x1 = Math.min(span.left, endX); x2 = endX; }
      else { x1 = span.left; x2 = span.right; }
      const len = x2 - x1;

      const textNames = spec.beginHook !== 'none' ? [] : isBegin ? PED : CONTINUE;
      const endNames = isEnd && !spec.line ? STAR : [];
      const text = runOf(textNames, glyphs);
      const end = runOf(endNames, glyphs);
      const parts = []; // éléments, relatifs à (x1, ligne de base) ; y vers le BAS
      const box = []; // boîtes pour l'autoplace : { x1, x2, top, bottom } relatives
      if (text.parts.length) {
        for (const p of text.parts) parts.push({ kind: 'glyph', name: p.name, x: p.dx, y: 0 });
        box.push({ x1: 0, x2: text.width, top: -text.top, bottom: -text.bottom });
      }
      if (end.parts.length) {
        // layoutTextLineBaseSegment : x ≥ bord droit du texte de début + écart ; layoutPedalSegment (rosette) : bord droit à la fin, jamais avant le texte de début
        const endTextX = Math.max(len - end.width, text.width);
        for (const p of end.parts) parts.push({ kind: 'glyph', name: p.name, x: endTextX + p.dx, y: 0 });
        box.push({ x1: endTextX, x2: endTextX + end.width, top: -end.top, bottom: -end.bottom });
      }
      // ---- ligne et crochets
      const hasBeginHook = isBegin && (spec.beginHook === '90' || spec.beginHook === '45');
      const hasEndHook = isEnd && (spec.endHook === '90' || spec.endHook === '45');
      if (spec.line) {
        let p1 = 0; let p2 = len; let py = 0;
        if (text.parts.length) p1 += TEXT_LINE_GAP + text.width;
        if (text.parts.length) py -= lw / 2; // le bord bas de la ligne repose sur la ligne de base du texte
        const bh = sgn * hookH;
        const bw = isBegin && spec.beginHook === '45' ? Math.abs(bh * HOOK_45_SLOPE) : 0;
        const ew = isEnd && spec.endHook === '45' ? Math.abs(bh * HOOK_45_SLOPE) : 0;
        p1 += bw; p2 -= ew;
        if (!(text.parts.length && p1 > p2)) { // pas de ligne ni de crochet « à l'envers »
          const pts = [];
          if (hasBeginHook) pts.push([p1 - bw, py + bh]);
          pts.push([p1, py], [p2, py]);
          if (hasEndHook) pts.push([p2 + ew, py + bh]);
          if (pts.length >= 2) {
            parts.push({ kind: 'polyline', points: pts, width: lw });
            const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
            box.push({ x1: Math.min(...xs), x2: Math.max(...xs), top: Math.min(...ys) - lw / 2, bottom: Math.max(...ys) + lw / 2 });
          }
        }
      }
      if (!box.length) continue;
      const shape = { x1: x1 + Math.min(...box.map((b) => b.x1)), x2: x1 + Math.max(...box.map((b) => b.x2)), top: Math.min(...box.map((b) => b.top)), bottom: Math.max(...box.map((b) => b.bottom)) };

      // ---- autoplace : position de style, repoussée à `minDist` du « skyline »
      const base0 = below ? H + st('PEDAL_POS_BELOW') : st('PEDAL_POS_ABOVE');
      let yd = 0;
      const overl = pool[k].filter((q) => q.x2 > shape.x1 && q.x1 < shape.x2);
      if (overl.length) {
        if (below) yd = Math.max(0, Math.max(...overl.map((q) => q.bottom)) + minDist - (base0 + shape.top));
        else yd = Math.min(0, Math.min(...overl.map((q) => q.top)) - minDist - (base0 + shape.bottom));
      }
      segments.push({ k, below, base: base0 + yd, x1, shape, parts, id: e.id });
    }
  }

  // ---- alignement (processLines align) : même y pour tous les segments d'un système et d'un côté (le plus grand y)
  for (const side of [true, false]) {
    const byK = new Map();
    for (const sg of segments) if (sg.below === side) byK.set(sg.k, Math.max(byK.get(sg.k) ?? -Infinity, sg.base));
    for (const sg of segments) if (sg.below === side) sg.base = byK.get(sg.k);
  }

  for (const sg of segments) {
    for (const p of sg.parts) {
      if (p.kind === 'glyph') result[sg.k].push({ kind: 'glyph', name: p.name, x: sg.x1 + p.x, y: U(sg.base + p.y), role: 'pedal', ref: sg.id });
      else result[sg.k].push({ kind: 'polyline', points: p.points.map(([x, y]) => [sg.x1 + x, U(sg.base + y)]), width: p.width, cap: 'butt', join: 'miter', role: 'pedal', ref: sg.id });
    }
    pool[sg.k].push({ x1: sg.shape.x1, x2: sg.shape.x2, top: sg.base + sg.shape.top, bottom: sg.base + sg.shape.bottom });
  }
}

