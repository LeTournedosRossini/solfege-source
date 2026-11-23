/*
 * Voltas (1re/2e fin). Ancrées par identifiant de masterbar (`measureId`) sur `span` mesures ; découpées en un segment par
 * système traversé (crochet de départ sur le 1er segment, crochet de fin sur le dernier seulement si la volta est fermée,
 * texte sur le 1er segment). Valeurs de MuseScore `volta.cpp` / `styledef.cpp` (voir constants.js). Dessinées sur la portée du
 * haut du système. Coordonnées de portée (y vers le haut, 0 = ligne du bas de CETTE portée).
 * Écart à trancher : le texte (« 1. », « 1., 2. ») est un texte, pas un glyphe Bravura (MuseScore : texte Edwin gras).
 */
import { PID, getProperty } from '../model/index.js';
import { SID } from '../model/sid.js';
import {
  VOLTA_ABOVE_GAP, VOLTA_HOOK_H, VOLTA_LINE_W, VOLTA_TEXT_OFFSET_X, VOLTA_TEXT_SIZE,
} from './constants.js';

/** Éléments d'affichage des voltas pour UN système ; `topLineY` = y de la ligne du haut de la 1re portée. */
export function voltaItems(movement, sys, topLineY, getStyle = null) {
  const ids = movement.masterbars.map((mb) => mb.id);
  const items = [];
  const lineY = topLineY + VOLTA_ABOVE_GAP;
  const hookY = lineY - VOLTA_HOOK_H;
  for (const volta of movement.voltas) {
    const start = ids.indexOf(getProperty(volta, PID.MEASURE_ID));
    if (start < 0) continue;
    const end = start + getProperty(volta, PID.SPAN) - 1;
    const inSystem = sys.measures.filter((m) => m.mi >= start && m.mi <= end);
    if (!inSystem.length) continue;
    const x1 = inSystem[0].start;
    const x2 = inSystem[inSystem.length - 1].barX;
    const hasStart = inSystem[0].mi === start;
    const hasEnd = inSystem[inSystem.length - 1].mi === end;
    // the volta's own value, else the style value (settings), else MuseScore's
    const own = (pid, sid, dflt) => getProperty(volta, pid) ?? (getStyle ? getStyle(sid) : null) ?? dflt;
    const lineW = own(PID.VOLTA_LINE_WIDTH, SID.VOLTA_LINE_WIDTH, VOLTA_LINE_W);
    const textSize = own(PID.VOLTA_TEXT_SIZE, SID.VOLTA_TEXT_SIZE, VOLTA_TEXT_SIZE) * (getStyle ? getStyle(SID.READER_MARK_SCALE) ?? 1 : 1); // (the Lecteur's « writing only » keeps the volta numbers at their size)
    const radius = Math.min(own(PID.VOLTA_CORNER, SID.VOLTA_CORNER_RADIUS, 0), (x2 - x1) / 2, VOLTA_HOOK_H);
    const closed = hasEnd && !getProperty(volta, PID.VOLTA_OPEN);
    if (radius > 0.001) {
      // one polyline: left hook, rounded corner, line, rounded corner, right hook (quarter circles in 6 steps)
      const pts = [];
      const corner = (cx, cy, from, to) => { for (let i = 0; i <= 6; i++) { const a = from + (to - from) * (i / 6); pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]); } };
      if (hasStart) { pts.push([x1, hookY]); corner(x1 + radius, lineY - radius, Math.PI, Math.PI / 2); } else pts.push([x1, lineY]);
      if (closed) { corner(x2 - radius, lineY - radius, Math.PI / 2, 0); pts.push([x2, hookY]); } else pts.push([x2, lineY]);
      items.push({ kind: 'polyline', role: 'volta', points: pts, width: lineW, cap: 'butt', join: 'round', ref: volta.id });
    } else {
      const line = (ax, ay, bx, by) => items.push({ kind: 'line', role: 'volta', x1: ax, y1: ay, x2: bx, y2: by, width: lineW, ref: volta.id });
      line(x1, lineY, x2, lineY);
      if (hasStart) line(x1, lineY, x1, hookY);
      if (closed) line(x2, lineY, x2, hookY);
    }
    if (hasStart) {
      const custom = getProperty(volta, PID.VOLTA_TEXT);
      const text = custom || getProperty(volta, PID.VOLTA_NUMBERS).map((n) => `${n}.`).join(', ');
      items.push({ kind: 'text', role: 'volta-text', text, x: x1 + VOLTA_TEXT_OFFSET_X, y: lineY - textSize, size: textSize, bold: true, ref: volta.id });
    }
  }
  return items;
}
