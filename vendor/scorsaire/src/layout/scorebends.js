/*
 * Bends / dives sur portée SCORE (passe d'affichage score de la tranche 4d). Port de `GuitarBendLayout::layoutStandardStaff` (MuseScore v4.7.5,
 * `guitarbendlayout.cpp`) : `layoutAngularBend` (bend, release, pre-bend, grace-note bend, dives : ligne brisée départ → sommet → arrivée,
 * SANS flèche NI texte sur portée), `computeUp`, `computeIsInside`, `avoidBadStaffLineIntersection`, `adjustX`, `layoutSlightBend` (Bézier),
 * `GuitarDiveLayout::layoutDip` (V + texte) et `layoutScoop` (glyphe). Le modèle (`PID.BENDS`, montant, texte) est celui de `bends.js`.
 * Géométrie calculée en repère MuseScore (y vers le BAS, 0 = ligne du haut, distance de lignes 1) puis émise en repère de portée (y vers le haut).
 *
 * Ligne de maintien : dip avec vibrato seulement (glyphes de vibrato). `ghostGraceNoteIds` : notes d'ornement de départ d'un pre-bend / pre-dive,
 * mises entre parenthèses (MuseScore : `setGhost(true)`).
 *
 * Limites assumées : position du scoop = bord gauche de la forme de l'accord − 0,35 sp
 * (0,25 + 0,1 de marge, comme en tablature) ; texte du dip : boîte approchée ; pas de collision avec d'autres éléments (skyline) ; non vérifié sur export.
 */
import { SID } from '../model/index.js';
import { staffBends } from './painters/resolved.js';
import { edgeAtHeight } from './glissandos.js';
import { systemSpan } from './painters/systemspan.js';
import { TEXT_SIZE } from './glissandos.js';

const TOP = 4; // y (repère de portée) de la ligne du haut
const toUp = (Y) => TOP - Y;

/**
 * @param locate  noteId → { k, x, y (repère de portée), w, h, mag, hasStem, stemUp, isTop, isBottom, boxes, chord, voice, mi } | null
 */
export function scoreBendItems({ perSystem, staff, ctx, locate, result, where = new Map() }) {
  const model = staffBends(ctx, staff);
  if (!model) return;
  const { style, glyphs } = ctx;
  const spanOf = (k) => systemSpan(perSystem, k);
  const staffLineW = style(SID.STAFF_LINE_THICKNESS);

  const infoOf = (rec) => {
    const L = locate(rec.note.id);
    return L ? { ...L, Y: TOP - L.y } : null;
  };

  // ── computeUp ──
  const bendsOfChord = (chord) => model.list.filter((o) => o.start.chord === chord);
  const hasVoices = (b) => staff.voices.length > 1 && staff.voices.some((v, i) => i > 0 && (v.measures[b.start.mi]?.items.length ?? 0) > 0);
  const computeUp = (b, S, E) => {
    if (hasVoices(b)) return b.start.voice % 2 === 1;
    if (S.stemUp !== E.stemUp) return true;
    if (b.start.chord.notes.length === 1 && S.hasStem) return !S.stemUp;
    if (b.end.chord.notes.length === 1 && E.hasStem) return !E.stemUp;
    const chord = b.start.chord.notes.length > 1 ? b.start.chord : b.end.chord;
    const list = chord.notes.flatMap((n) => model.list.filter((o) => o.start.note.id === n.id));
    const idx = Math.max(0, list.indexOf(b));
    return idx >= Math.floor(list.length / 2);
  };
  const computeIsInside = (b, S, E) => {
    if (b.start.chord.notes.length <= 2 || b.end.chord.notes.length <= 2) return false;
    return !(S.isTop || S.isBottom || E.isTop || E.isBottom);
  };

  const avoidLine = (pt, upSign) => {
    const closest = Math.round(pt.y);
    if (closest >= 0 && closest <= 4) {
      const minDist = 0.5 * staffLineW + 0.15;
      if (Math.abs(pt.y - closest) < minDist) pt.y = closest + upSign * minDist;
    }
  };
  // `Shape::rightMostEdgeAtHeight` / `leftMostEdgeAtHeight` : bande donnée en y vers le bas
  const edge = (L, y, side) => edgeAtHeight(L.boxes, toUp(y + 0.1), toUp(y - 0.1), side);

  const emit = (k, item) => result[k].push(item);

  // Ligne de maintien du dip avec vibrato (`GuitarBendLayout::layoutHoldLine`, `isDipWithVibrato`) : glyphes de vibrato répétés depuis la fin du V
  // jusqu'à 1,5 sp avant la colonne suivante (ou jusqu'à la note d'arrivée d'un bend qui suit), au moins 1 sp ; départ en y vers le bas.
  const holdLineItems = (b, S, startPos) => {
    const hold = model.holdLine(b);
    if (!hold || !b.entry.dipVibrato) return;
    const HE = locate(hold.endNote.id);
    if (!HE) return;
    let x2;
    if (hold.endBend && (hold.endBend.type === 'preBend' || hold.endBend.type === 'preDive')) {
      const n = model.startOnEndNote(hold.endBend) ? hold.endBend.end.note : hold.endBend.start.note;
      const L = locate(n.id);
      x2 = L ? L.x + 0.5 * L.w : HE.x;
    } else if (hold.endBend) x2 = HE.x;
    else {
      const next = model.nextCR(model.noteRec.get(hold.endNote.id).rec);
      const nw = next ? where.get(next.item.id) : null;
      x2 = (nw && nw.k === S.k ? nw.p.x : spanOf(S.k).right) - 1.5;
    }
    x2 = Math.max(startPos.x + 1, x2);
    const name = b.entry.dipVibrato === 'wide' ? 'guitarWideVibratoStroke' : 'guitarVibratoStroke';
    const g = glyphs.glyphs[name];
    const adv = g.advance; const gh = g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1];
    const count = Math.max(1, Math.floor((x2 - startPos.x) / adv));
    for (let i = 0; i < count; i++) emit(S.k, { kind: 'glyph', name, x: startPos.x + i * adv, y: toUp(startPos.y + 0.5 * gh), role: 'bend-hold', ref: b.id });
  };

  for (const b of model.list) {
    const S = infoOf(b.start); const E = infoOf(b.end);
    if (!S || !E || E.k < S.k) continue;
    const lw = style(b.isDive ? SID.GUITAR_DIVE_LINE_WIDTH : SID.GUITAR_BEND_LINE_WIDTH);

    // ── dip : V au-dessus de la note ──
    if (b.type === 'dip') {
      const cx = S.x + 0.5 * S.w;
      const baseY = Math.min(-1, S.Y - 0.5 * S.h - 1);
      const upwards = model.amount(b) > 0;
      const pts = [[cx - 1, upwards ? baseY : baseY - 2], [cx, upwards ? baseY - 2 : baseY], [cx + 1, upwards ? baseY : baseY - 2]];
      emit(S.k, { kind: 'polyline', points: pts.map(([x, y]) => [x, toUp(y)]), width: lw, cap: 'butt', join: 'bevel', role: 'dive', ref: b.id });
      const digit = model.digit(b);
      if (digit) emit(S.k, { kind: 'text', role: 'bend-text', text: digit, x: cx, y: toUp(Math.min(pts[0][1], pts[1][1]) - 0.35), size: TEXT_SIZE, anchor: 'middle', ref: b.id });
      holdLineItems(b, S, { x: pts[2][0], y: pts[2][1] });
      continue;
    }
    // ── scoop : glyphe à gauche de la forme de l'accord ──
    if (b.type === 'scoop') {
      const g = glyphs.glyphs.guitarVibratoBarScoop;
      const hgt = g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1]; const wid = g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0];
      const line = Math.round(8 - 2 * S.y);
      const yMove = hgt + (line % 2 ? 0 : 0.35);
      const left = edge({ boxes: S.boxes }, S.Y, 'left') ?? S.x; // bande de 0,2 sp autour de la note
      emit(S.k, { kind: 'glyph', name: 'guitarVibratoBarScoop', x: Math.min(left, S.x) - 0.35 - wid, y: toUp(S.Y + yMove), role: 'dive', ref: b.id });
      continue;
    }
    // ── slight bend : Bézier ──
    if (b.type === 'slightBend') {
      const sx = S.x + S.w + 0.25; const sy = S.Y - 0.25;
      emit(S.k, { kind: 'bezier', x1: sx, y1: toUp(sy), c1x: sx, c1y: toUp(sy), c2x: sx + 1.25, c2y: toUp(sy), x2: sx + 1.25, y2: toUp(sy - 1), width: lw, cap: 'butt', join: 'miter', role: 'bend', ref: b.id });
      continue;
    }
    // ── bend « angulaire » (bend, release, pre-bend, grace-note bend, dives) ──
    const up = computeUp(b, S, E);
    const inside = computeIsInside(b, S, E);
    const upSign = up ? -1 : 1;
    const heightDiff = E.Y - S.Y;
    const segs = S.k === E.k ? [{ k: S.k, begin: true, end: true }] : [{ k: S.k, begin: true, end: false }, { k: E.k, begin: false, end: true }];
    for (const seg of segs) {
      const span = spanOf(seg.k);
      const start = { x: 0, y: 0 }; const end = { x: 0, y: 0 };
      if (seg.begin) {
        start.x = S.x + (inside ? 1 : 0.5) * S.w + 0.2 * S.mag;
        start.y = S.Y + upSign * 0.2 * S.mag + (inside ? 0 : upSign * 0.5 * S.h);
      } else {
        start.x = span.left;
        start.y = E.Y + upSign * 0.5 * E.h - 0.5 * heightDiff;
      }
      if (seg.end) {
        end.x = E.x + (inside ? 0 : 0.5) * E.w - 0.2 * E.mag;
        end.y = E.Y + upSign * 0.2 * E.mag + (inside ? 0 : upSign * 0.5 * E.h);
      } else {
        end.x = span.right;
        end.y = S.Y + upSign * 0.5 * S.h + 0.5 * heightDiff;
      }
      avoidLine(start, upSign);
      avoidLine(end, upSign);
      // adjustX : dégager la forme de l'accord de départ / d'arrivée
      const adjustStart = seg.begin && ((S.hasStem && S.stemUp && up) || (up && !S.isTop) || (!up && !S.isBottom));
      const adjustEnd = seg.end && ((E.hasStem && !E.stemUp && !up) || (up && !E.isTop) || (!up && !E.isBottom));
      if (inside || adjustStart || adjustEnd) {
        if (seg.begin) {
          const r = edge(S, start.y, 'right');
          if (r !== null) start.x = Math.max(start.x, r + 0.2);
        }
        if (seg.end) {
          const l = edge(E, end.y, 'left');
          if (l !== null) end.x = Math.min(end.x, l - 0.2);
        }
      }
      if (b.isDive && model.overlapping(b)) {
        const yOff = up ? -1 : 1;
        start.y += yOff; end.y += yOff;
      }
      // sommet
      const rel = { x: end.x - start.x, y: end.y - start.y };
      const angle = -Math.atan(rel.y / rel.x);
      const vh = Math.min(0.75 + 0.1 * (rel.x - 1), 2.0);
      const vertex = { x: start.x + 0.5 * rel.x + upSign * vh * Math.sin(angle), y: start.y + 0.5 * rel.y + upSign * vh * Math.cos(angle) };
      avoidLine(vertex, upSign);
      emit(seg.k, { kind: 'polyline', points: [start, vertex, end].map((p) => [p.x, toUp(p.y)]), width: lw, cap: 'butt', join: 'miter', role: b.isDive ? 'dive' : 'bend', ref: b.id });
    }
  }
}

/** Identifiants des notes à dessiner entre parenthèses (fantômes) : départ d'un pre-bend / pre-dive (`layoutAngularBend` : `setGhost(true)`). */
export function ghostGraceNoteIds(ctx, staff) {
  const model = staffBends(ctx, staff);
  const ids = new Set();
  if (!model) return ids;
  for (const b of model.list) if (b.type === 'preBend' || b.type === 'preDive') ids.add(b.start.note.id);
  return ids;
}
