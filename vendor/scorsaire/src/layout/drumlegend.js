/*
 * Légende de percussion — tranche 5c (AJOUT Scorsaire : MuseScore n'a pas de légende de batterie).
 * Une portée de percussion où chaque son choisi est une TÊTE NOIRE SEULE (sans hampe) à la ligne de la percmap, côte à côte, avec son NOM
 * au-dessus ; ni barre de mesure, ni armure, ni chiffrage. Les têtes viennent de la percmap (`drumHeadGlyph(head, 'quarter')`), les lignes
 * supplémentaires comme sur une portée de percussion normale. Retour à la ligne quand la largeur est dépassée (la clé est répétée).
 * Le choix des sons est à l'intégration (`options.sounds`) :
 *   'all'  tous les sons de la percmap, dans l'ordre de la percmap ;
 *   'used' seulement ceux que `usedSounds` (liste d'identifiants fournie par l'appelant) contient, dans l'ordre de la percmap ;
 *   [ids]  une liste explicite, dans CET ordre (les identifiants absents de la percmap sont ignorés).
 * Fonction pure ; sortie = disposition rendable par `renderSvgString` (même forme que `layoutMovement`).
 * Largeur des noms approchée (police absente : 0,5 × corps × caractères).
 */
import { resolvePercmapOf, soundDisplayName, drumLineToY, drumHeadGlyph, resolveStyle, SID } from '../model/index.js';
import { lineStack } from './painters/common.js';
import { glyphWidth } from './header.js';

const NAME_SIZE = 1.2; // corps des noms (espaces)
const NAME_GAP = 0.9; // du haut de la tête (ou de la portée) au bas du nom
const COLUMN_PAD = 0.8; // marge de chaque côté d'une colonne
const MIN_COLUMN = 2.4;
const CLEF_GAP = 1.2;
const ROW_GAP = 2.2; // entre deux rangées de légende

export function legendSounds(percmap, { sounds = 'all', usedSounds = [] } = {}) {
  const byId = new Map(percmap.sounds.map((s) => [s.id, s]));
  if (Array.isArray(sounds)) return sounds.map((id) => byId.get(id)).filter(Boolean);
  if (sounds === 'used') return percmap.sounds.filter((s) => usedSounds.includes(s.id));
  return [...percmap.sounds];
}

/**
 * @param percmapProp  percmap (ou null : percmap par défaut de Scorsaire)
 * @param options      { width (espaces, défaut ∞), lines (1-5, défaut 5), sounds, usedSounds, lang ('en' par défaut : noms anglais de la carte ; sinon noms personnalisés `names[lang]` puis `translate(id)`), translate: (id) → texte|undefined, name: (son) → texte (remplace tout), style: (sid) → valeur }
 * @returns {{ width, height, systems, warnings }}
 */
export function layoutDrumLegend(percmapProp, glyphs, { width = Infinity, lines = 5, sounds = 'all', usedSounds = [], lang = 'en', translate, name, style } = {}) {
  const nameOf = name ?? ((snd) => soundDisplayName(snd, { lang, translate }));
  const getStyle = style ?? ((sid) => resolveStyle(sid, []));
  const percmap = resolvePercmapOf(percmapProp);
  const list = legendSounds(percmap, { sounds, usedSounds });
  const H = lines - 1;
  const lineW = getStyle(SID.STAFF_LINE_THICKNESS);
  const ledgerW = getStyle(SID.LEDGER_LINE_THICKNESS);
  const ledgerExt = getStyle(SID.LEDGER_LINE_EXTENSION);
  const clef = 'unpitchedPercussionClef1';
  const clefW = glyphWidth(glyphs, clef);
  const x0 = clefW + CLEF_GAP;

  const cols = list.map((s) => {
    const head = drumHeadGlyph(s.head, 'quarter');
    const g = glyphs.glyphs[head];
    const hw = g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0];
    const label = String(nameOf(s));
    const w = Math.max(MIN_COLUMN, hw + 2 * COLUMN_PAD, 0.5 * NAME_SIZE * label.length + 2 * COLUMN_PAD);
    return { s, head, hw, left: g.bbox.bBoxSW[0], y: drumLineToY(s.line, lines), label, w };
  });
  // hauteurs communes à toutes les rangées (noms alignés)
  const ys = cols.map((c) => c.y);
  const topY = Math.max(H, ...ys.map((y) => y + 0.5));
  const botY = Math.min(0, ...ys.map((y) => y - 0.5));
  const above = topY - H + NAME_GAP + NAME_SIZE + 0.3; // du haut de la portée au haut des noms
  const below = -botY;

  // rangées : retour à la ligne glouton
  const rows = [];
  let cur = [], used = x0;
  for (const c of cols) {
    if (cur.length && used + c.w > width) { rows.push(cur); cur = []; used = x0; }
    cur.push(c); used += c.w;
  }
  if (cur.length || !rows.length) rows.push(cur);

  const systems = [];
  let y = 0, maxW = 0;
  rows.forEach((row, index) => {
    const items = [];
    const rowW = x0 + row.reduce((a, c) => a + c.w, 0);
    maxW = Math.max(maxW, rowW);
    for (const { y: ly, thickness } of lineStack(lines, lineW)) items.push({ kind: 'line', role: 'staff-line', x1: 0, x2: rowW, y1: ly, y2: ly, width: thickness });
    items.push({ kind: 'glyph', name: clef, x: 0, y: H / 2, role: 'clef' });
    let x = x0;
    for (const c of row) {
      const cx = x + c.w / 2;
      const hx = cx - c.left - c.hw / 2;
      // lignes supplémentaires : chaque ligne entière entre la portée et la tête
      const ledgers = [];
      if (c.y < -0.01) for (let ly = -1; ly >= c.y - 0.01; ly--) ledgers.push(ly);
      if (c.y > H + 0.01) for (let ly = H + 1; ly <= c.y + 0.01; ly++) ledgers.push(ly);
      for (const ly of ledgers) items.push({ kind: 'line', role: 'ledger-line', x1: hx + c.left - ledgerExt, x2: hx + c.left + c.hw + ledgerExt, y1: ly, y2: ly, width: ledgerW });
      items.push({ kind: 'glyph', name: c.head, x: hx, y: c.y, role: 'legend-head', ref: c.s.id });
      items.push({ kind: 'text', role: 'legend-name', text: c.label, x: cx, y: topY + NAME_GAP, size: NAME_SIZE, anchor: 'middle', ref: c.s.id });
      x += c.w;
    }
    systems.push({ index, x0: 0, top: y, overlays: [], staves: [{ ref: 'legend', type: 'percussion', originY: above + H, items }] });
    y += above + H + below + ROW_GAP;
  });
  return { width: maxW, height: y - ROW_GAP + 0.5, systems, warnings: [] };
}
