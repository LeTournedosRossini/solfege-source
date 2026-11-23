/*
 * Affichage du mode « saisie sur grille » : une portée dessinée avec des CASES ÉGALES (une case = la même largeur, qu'elle soit pleine ou
 * vide), sans la mise en page musicale — pas d'espacement par durées, pas de hampes ni de ligatures, pas de silences. Chaque frappe est
 * une tête posée au centre de sa case, à la hauteur de son son. Au-dessus de chaque temps, une POIGNÉE indique le nombre de cases du
 * temps (4 = doubles croches pour une noire, 3 = triolet de croches…) ; un temps verrouillé (frappes hors de toute grille proposée) est
 * grisé.
 *
 * PUR (aucun DOM). Sortie compatible avec `renderSvgString` (même forme que `layoutMovement` : systèmes → portées → éléments d'affichage
 * `line | rect | glyph | text`, repère de portée y vers le HAUT depuis la ligne du bas), plus `zones` : rectangles de hit-test en
 * coordonnées ABSOLUES de la mise en page (espaces de portée, avant la marge du rendu) — cases `{ kind: 'cell', measure, beat, cell }` et
 * poignées `{ kind: 'handle', measure, beat }`.
 *
 * Écart assumé avec la mise en page normale : la largeur d'une case est fixe (`cellWidth`), une mesure de 16 cases occupe donc ~38 sp ;
 * les systèmes sont coupés à la largeur disponible, sans justification.
 */
import {
  PID, getProperty, drumSound, drumLineToY, drumHeadGlyph, cellStart, cellIndexAt,
} from '../model/index.js';
import { fEq } from '../model/fraction.js';
import { baseSoundOf, isGhostSound } from '../model/percmap.js';

const HEADER_W = 4;
const MEASURE_PAD = 0.6;
const HANDLE_H = 1.5;
const GAP_BETWEEN_SYSTEMS = 2.5;
const GUIDE = '#a9a39a';
const PALE = '#f1e8d6';
const LOCKED = '#ddd6c8';
const SELECTED = '#e6c77b';

/** Hauteur (repère de portée) d'un son sur la portée. */
export function soundY(state, soundId, lineCount) {
  if (state.type !== 'percussion') return (lineCount - 1) / 2;
  const s = drumSound(state.percmap, baseSoundOf(soundId));
  return s ? drumLineToY(s.line, lineCount) : (lineCount - 1) / 2;
}

/** Son le plus proche de la hauteur `y` (repère de portée), ou null si aucun à moins de `tolerance` espaces. */
export function soundAtY(state, y, lineCount, tolerance = 0.75) {
  if (state.type !== 'percussion') return '_';
  let best = null;
  let bestD = Infinity;
  for (const s of state.percmap.sounds) {
    const d = Math.abs(drumLineToY(s.line, lineCount) - y);
    if (d < bestD) { best = s.id; bestD = d; }
  }
  return bestD <= tolerance ? best : null;
}

function lineCountOf(staff) {
  const n = getProperty(staff, PID.LINE_COUNT);
  return Math.max(1, Number.isInteger(n) ? n : 5);
}

/**
 * @param {object} o
 * @param {object} o.state     état du mode (`readGrid`)
 * @param {object} o.staff     la portée éditée
 * @param {object} o.glyphs    données Bravura
 * @param {number} [o.width]   largeur disponible en espaces de portée (défaut : une seule ligne)
 * @param {number} [o.cellWidth=2.4]
 * @param {{measure: number, beat: number}|null} [o.selected]  temps dont la poignée est sélectionnée (couleur plus marquée)
 */
export function layoutGrid({ state, staff, glyphs, width = Infinity, cellWidth = 2.4, selected = null }) {
  const lines = lineCountOf(staff);
  const top = lines - 1;
  const headW = (name) => glyphs.glyphs[name].bbox.bBoxNE[0];
  const headOf = (sound) => (state.type === 'percussion' ? drumHeadGlyph(drumSound(state.percmap, baseSoundOf(sound))?.head ?? 'normal', 'quarter') : 'noteheadBlack');

  // étendue verticale : portée + sons hors portée + poignées
  const sounds = state.type === 'percussion' ? state.percmap.sounds.map((s) => drumLineToY(s.line, lines)) : [top / 2];
  const minY = Math.min(0, ...sounds) - 1.2;
  const high = Math.max(top, ...sounds); // the highest line or space a hit can sit on (a ride or a crash is ABOVE the staff): the cells reach up to it, the handles sit above it
  const maxY = high + 1.2 + HANDLE_H + 1.4;
  const rowH = maxY - minY;

  // mesures : largeur = cases × largeur d'une case
  const widths = state.measures.map((m) => m.beats.reduce((n, b) => n + b.cells, 0) * cellWidth + 2 * MEASURE_PAD);
  const rows = []; // lignes de mesures
  let cur = { from: 0, to: 0, w: HEADER_W };
  widths.forEach((w, i) => {
    if (cur.to > cur.from && cur.w + w > width) { rows.push(cur); cur = { from: i, to: i, w: HEADER_W }; }
    cur.w += w;
    cur.to = i + 1;
  });
  if (cur.to > cur.from) rows.push(cur);

  const systems = [];
  const zones = [];
  rows.forEach((row, si) => {
    const sysTop = si * (rowH + GAP_BETWEEN_SYSTEMS);
    const originY = maxY; // distance du haut du système à la ligne du bas de la portée
    const abs = (x, y) => ({ x, y: sysTop + originY - y }); // repère de portée → mise en page absolue
    const items = [];
    const back = []; // fonds (cases frappées, temps verrouillés) : dessinés sous les lignes
    const rowW = row.w;
    for (let l = 0; l < lines; l++) items.push({ kind: 'line', role: 'staff-line', x1: 0, x2: rowW, y1: l, y2: l, width: 0.13, ref: staff.id });
    items.push({ kind: 'glyph', role: 'clef', name: 'unpitchedPercussionClef1', x: 0.8, y: top / 2 });
    let x = HEADER_W;
    for (let mi = row.from; mi < row.to; mi++) {
      const m = state.measures[mi];
      const mw = widths[mi];
      // fonds : cases frappées et temps verrouillés (dessinés d'abord)
      let cellX = x + MEASURE_PAD;
      m.beats.forEach((b, bi) => {
        const bw = b.cells * cellWidth;
        if (b.locked) back.push({ kind: 'rect', role: 'grid-locked', x: cellX, y: minY + 0.4, w: bw, h: high - minY + 0.4 + 0.6, fill: LOCKED });
        for (let c = 0; c < b.cells; c++) {
          const t = cellStart(b, c);
          if (m.hits.some((h) => fEq(h.t, t))) {
            back.push({ kind: 'rect', role: 'grid-cell-on', x: cellX + c * cellWidth + 0.08, y: minY + 0.4, w: cellWidth - 0.16, h: high - minY + 1.2, fill: PALE });
          }
        }
        cellX += bw;
      });
      // barre de début, guides de cases et de temps
      items.push({ kind: 'line', role: 'barline', x1: x, x2: x, y1: 0, y2: top, width: 0.16 });
      cellX = x + MEASURE_PAD;
      m.beats.forEach((b, bi) => {
        const bw = b.cells * cellWidth;
        // les traits passent par le MILIEU des cases : ce sont les instants où l'on pose les notes (début du temps = trait plein)
        for (let c = 0; c < b.cells; c++) {
          const gx = cellX + (c + 0.5) * cellWidth;
          if (c === 0) items.push({ kind: 'line', role: 'grid-beat', x1: gx, x2: gx, y1: minY + 0.4, y2: high + 0.8, width: 0.1, color: GUIDE });
          else items.push({ kind: 'line', role: 'grid-cell', x1: gx, x2: gx, y1: minY + 0.4, y2: high + 0.8, width: 0.05, color: GUIDE, dash: [0.2, 0.3] });
        }
        // poignée du temps
        const hy = high + 1.4;
        items.push({ kind: 'rect', role: 'grid-handle', x: cellX + 0.2, y: hy, w: bw - 0.4, h: HANDLE_H, fill: selected && selected.measure === mi && selected.beat === bi ? SELECTED : b.locked ? LOCKED : PALE });
        items.push({ kind: 'text', role: 'grid-handle-label', text: b.locked ? '?' : String(b.cells), x: cellX + bw / 2, y: hy + 0.35, size: 1.0, anchor: 'middle', bold: true, family: 'sans-serif' });
        const a = abs(cellX + 0.2, hy + HANDLE_H);
        zones.push({ kind: 'handle', measure: mi, beat: bi, system: si, x: a.x, y: a.y, w: bw - 0.4, h: HANDLE_H });
        // zones de cases
        for (let c = 0; c < b.cells; c++) {
          const z = abs(cellX + c * cellWidth, high + 0.8);
          zones.push({ kind: 'cell', measure: mi, beat: bi, cell: c, system: si, x: z.x, y: z.y, w: cellWidth, h: high + 0.8 - (minY + 0.4), locked: b.locked });
        }
        cellX += bw;
      });
      // numéro de mesure
      items.push({ kind: 'text', role: 'measure-number', text: String(mi + 1), x: x + 0.2, y: high + 0.5 + HANDLE_H + 1.5, size: 0.9, family: 'sans-serif' });
      // frappes
      m.beats.reduce((start, b, bi) => {
        for (const h of m.hits) {
          const c = cellIndexAt(b, h.t); // null : hors du temps ou hors grille (temps verrouillé), non dessinée
          if (c === null) continue;
          const cx = start + (c + 0.5) * cellWidth;
          const y = soundY(state, h.sound, lines);
          const name = headOf(h.sound);
          const w = headW(name);
          for (let ly = Math.floor(y); ly < 0; ly++) if (ly <= y + 0.0001 && ly < 0) items.push({ kind: 'line', role: 'ledger', x1: cx - w * 0.9, x2: cx + w * 0.9, y1: ly, y2: ly, width: 0.16 });
          for (let ly = top + 1; ly <= y + 0.0001; ly++) items.push({ kind: 'line', role: 'ledger', x1: cx - w * 0.9, x2: cx + w * 0.9, y1: ly, y2: ly, width: 0.16 });
          items.push({ kind: 'glyph', role: 'grid-hit', name, x: cx - w / 2, y, ref: undefined });
          if (isGhostSound(h.sound)) for (const [ch, px] of [['(', cx - w / 2 - 0.62], [')', cx + w / 2 + 0.12]]) items.push({ kind: 'text', role: 'grid-hit', text: ch, x: px, y: y - 0.62, size: 1.7, family: 'sans-serif' }); // a ghost note: the head in parentheses
        }
        return start + b.cells * cellWidth;
      }, x + MEASURE_PAD);
      x += mw;
    }
    items.push({ kind: 'line', role: 'barline', x1: x, x2: x, y1: 0, y2: top, width: 0.16 });
    systems.push({
      index: si, top: sysTop, height: rowH, x0: 0, width: rowW, stretch: 1, natural: rowW,
      staves: [{ ref: staff.id, trackId: null, type: getProperty(staff, PID.STAFF_TYPE), painter: 'grid', originY, items: [...back, ...items] }],
      overlays: [],
    });
  });
  const total = rows.length * rowH + Math.max(0, rows.length - 1) * GAP_BETWEEN_SYSTEMS;
  const contentW = rows.reduce((w, r) => Math.max(w, r.w), 0);
  return { width: contentW, height: total, systems, warnings: [], zones, lines, top, minY, maxY };
}

/**
 * Zone sous le point (x, y) en coordonnées de mise en page (espaces de portée, SANS la marge du rendu). Poignée avant case.
 * @returns {{ zone, staffY: number } | null} `staffY` : hauteur dans le repère de portée du système touché (0 = ligne du bas)
 */
export function hitGrid(layout, x, y) {
  const inside = (z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
  const handle = layout.zones.find((z) => z.kind === 'handle' && inside(z));
  if (handle) return { zone: handle, staffY: null };
  const cell = layout.zones.find((z) => z.kind === 'cell' && inside(z));
  if (!cell) return null;
  const sys = layout.systems[cell.system];
  return { zone: cell, staffY: sys.top + sys.staves[0].originY - y };
}

/** Sons regroupés par hauteur : `[{ line, y, sounds: [id…] }]` du haut vers le bas. Une portée sans sons : un seul groupe `['_']`. */
export function soundGroups(state, lineCount) {
  if (state.type !== 'percussion') return [{ line: 0, y: (lineCount - 1) / 2, sounds: ['_'] }];
  const by = new Map();
  for (const s of state.percmap.sounds) {
    if (!by.has(s.line)) by.set(s.line, { line: s.line, y: drumLineToY(s.line, lineCount), sounds: [] });
    by.get(s.line).sounds.push(s.id);
  }
  return [...by.values()].sort((a, b) => b.y - a.y);
}

/** Groupe de sons touché à la hauteur `y` (repère de portée), ou null s'il est à plus de `tolerance` espaces de toute ligne de son. */
export function groupAtY(groups, y, tolerance = 0.75) {
  let best = null;
  let bestD = Infinity;
  for (const g of groups) { const d = Math.abs(g.y - y); if (d < bestD) { best = g; bestD = d; } }
  return bestD <= tolerance ? best : null;
}
