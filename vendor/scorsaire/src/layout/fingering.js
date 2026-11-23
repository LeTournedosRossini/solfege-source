/*
 * Doigtés (tranche 6) — port de `TLayout::layoutFingering`, `ChordLayout::layoutChordBaseFingering` / alignement des doigtés de main gauche,
 * `Fingering::calculatePlacement` / `layoutType` (MuseScore v4.7.5), recoupé sur l'export de Jean (piano, violon, guitare : portée + tablature).
 *  - Quatre styles (`PID.FINGERINGS`, `kind`) : 'fingering' (doigté ordinaire), 'rhGuitar' (main droite : italique), 'stringNumber' (numéro de corde :
 *    cercle, jamais en tablature) → posés par rapport à l'ACCORD, au-dessus ou en dessous ; 'lhGuitar' (main gauche) → posé à GAUCHE de la note,
 *    bord droit du texte à 0,5 sp de l'origine de l'accord, centré sur la hauteur de la note, sans évitement (en tablature : Common et Full seulement).
 *  - Côté (`calculatePlacement`) : plusieurs voix à cet instant → opposé au sens de la hampe ; sinon dessous si la portée est la dernière d'une piste de
 *    plusieurs portées (main gauche du piano, tablature sous sa portée de notation), dessus sinon. `placement` du doigté force le côté.
 *  - Position verticale : le bas de la boîte (dessus) = le plus haut de [skyline nord − ¼ hauteur du texte, bord extrême de l'accord + `fingeringMinDistance`]
 *    (accord ligaturé à hampe montante : bord extérieur de la ligature ; sinon sommet de la plus haute tête, ou la portée) ; symétrique en dessous.
 *    Les doigtés d'un même accord s'empilent (ordre : par hauteur de note, du bas vers le haut) avec un écart de ¼ de la hauteur du texte ; un doigté
 *    posé s'ajoute au « skyline » et écarte les doigtés des accords voisins qui le recouvrent horizontalement.
 *  - Cas « serré » (plusieurs voix, une seule note, pas de ligature) : centre du texte à 1,5 sp de la note, décalé de ∓0,8 sp s'il y a une hampe.
 *  - Centrage horizontal : milieu de la tête (score), milieu du numéro + 0,145 sp (tablature — mesuré sur l'export).
 * MESURES de l'export de Jean (4.7.5) : boîte du texte = boîte SERRÉE de l'encre (chiffre : 0,71 × corps de haut) ; chiffres et lettres de la
 * police Edwin (absente ici) : largeurs mesurées ci-dessous. ÉCARTS / limites : skyline = boîtes des éléments déjà dessinés (polygones de
 * ligature découpés, pas de skyline continue) ; les doigtés ignorent les liaisons/nuances posées après eux comme chez MuseScore, mais celles-ci ne les
 * évitent pas encore ; doigtés sur ornements non faits ; « plusieurs voix » estimé à l'instant près sur la mesure.
 */
import { PID, SID, getProperty, fingeringPieces } from '../model/index.js';
import { rectsOf } from './bounds.js';
import { fCmp, fAdd } from '../model/fraction.js';

const PT = (1.75 * 72) / 25.4; // points par espace
const LH_OFFSET_X = -0.5; // `lhGuitarFingeringOffset` (sp)
const TIGHT_Y = 1.5; // cas « serré » : distance du centre du texte à la note
const TIGHT_X = 0.8; // …et décalage horizontal quand l'accord a une hampe
const TAB_CENTER_DX = 0.145; // tablature : centre du texte − centre du numéro (mesuré sur l'export de Jean)
const CIRCLE_PADDING = 0.2; // `stringNumberFramePadding`
const CIRCLE_WIDTH = 0.1; // `stringNumberFrameWidth`

// largeurs d'encre mesurées (en corps) ; hauteurs : { top = au-dessus de la ligne de base, bottom = en dessous }
const DIGIT_W = { 0: 0.471, 1: 0.397, 2: 0.471, 3: 0.453, 4: 0.496, 5: 0.459 };
const UPPER_H = 0.71; // chiffres et capitales
const X_H = 0.484; // hauteur d'x
const DESCENT = 0.19;
const ITALIC_W = { p: 0.606, i: 0.255, m: 0.82, a: 0.52, c: 0.4 };
function glyphMetrics(ch, italic) {
  if (/[0-9]/.test(ch)) return { w: DIGIT_W[ch] ?? 0.47, top: UPPER_H, bottom: 0 };
  if (ch === '-' || ch === '–') return { w: 0.33, top: 0.34, bottom: -0.25 };
  if (ch === 'i' || ch === 'j') return { w: italic ? ITALIC_W.i : 0.25, top: 0.725, bottom: ch === 'j' ? DESCENT : 0 };
  if (/[A-Z]/.test(ch)) return { w: ch === 'T' ? 0.63 : 0.66, top: UPPER_H, bottom: 0 };
  const lower = { w: ITALIC_W[ch] ?? 0.5, top: 'bdfhklt'.includes(ch) ? UPPER_H : X_H, bottom: 'gpqy'.includes(ch) ? DESCENT : 0 };
  return lower;
}

const GLYPH_DIGIT_H = 1.016; // hauteur d'un chiffre `fingering1` à l'échelle 1 (sp) : on l'amène à la hauteur d'un chiffre de texte (0,71 × corps)
const GLYPH_GAP = 0.06; // écart entre deux glyphes consécutifs (sp)

/**
 * Boîte serrée d'un doigté : { size (sp), pieces, w, fullW, up, down (sp, au-dessus / en dessous de la ligne de base), circle? }.
 * Le texte passe par la carte de doigtés de la portée (`PID.FINGERING_MAP`) : chaque caractère devient un morceau texte ou un glyphe.
 */
export function fingeringBox(f, ctx) {
  const size = ctx.style(SID.FINGERING_FONT_SIZE) / PT;
  const italic = f.kind === 'rhGuitar';
  const map = ctx.staff ? getProperty(ctx.staff, PID.FINGERING_MAP) : null;
  const pieces = fingeringPieces(map, f.text, { italic }).map((pc) => {
    if (pc.glyph && !ctx.glyphs.glyphs[pc.glyph]) {
      if (pc.text === undefined) { ctx.warnings?.push(`Doigté ${f.id} : glyphe « ${pc.glyph} » inconnu`); return { text: '?' }; }
      return { text: pc.text }; // repli du préréglage : le glyphe n'existe pas dans le jeu
    }
    return pc;
  });
  let w = 0; let top = -Infinity; let bottom = Infinity;
  const laid = pieces.map((pc) => {
    let m;
    if (pc.glyph) {
      const bb = ctx.glyphs.glyphs[pc.glyph].bbox;
      const mag = (UPPER_H * size) / GLYPH_DIGIT_H;
      m = { glyph: pc.glyph, mag, left: bb.bBoxSW[0] * mag, w: (bb.bBoxNE[0] - bb.bBoxSW[0]) * mag + GLYPH_GAP, top: bb.bBoxNE[1] * mag, bottom: -bb.bBoxSW[1] * mag };
    } else {
      let tw = 0; let tt = -Infinity; let tb = Infinity;
      for (const ch of pc.text) { const k = glyphMetrics(ch, italic); tw += k.w * size; tt = Math.max(tt, k.top * size); tb = Math.min(tb, -k.bottom * size); }
      m = { text: pc.text, w: tw, top: tt, bottom: -tb };
    }
    m.x = w;
    w += m.w;
    top = Math.max(top, m.top);
    bottom = Math.min(bottom, -m.bottom);
    return m;
  });
  const box = { size, pieces: laid, w, top, bottom: -bottom, italic, allText: laid.every((p) => p.text !== undefined) };
  box.text = box.allText ? f.text : null;
  if (f.kind === 'stringNumber') {
    // `TextBase::layoutFrame` (cercle) : diamètre = max(largeur, hauteur) + 2 × (marge + ½ trait), puis ½ trait de plus pour la boîte
    const h = top + box.bottom;
    const d = Math.max(w, h) + 2 * (CIRCLE_PADDING + CIRCLE_WIDTH / 2);
    const cy = (top - box.bottom) / 2; // centre de l'encre, au-dessus de la ligne de base
    box.circle = { r: d / 2, cy };
    box.fullW = d + CIRCLE_WIDTH;
    box.up = cy + d / 2 + CIRCLE_WIDTH / 2; // bord haut de la boîte, au-dessus de la ligne de base
    box.down = d / 2 + CIRCLE_WIDTH / 2 - cy;
  } else {
    box.fullW = w;
    box.up = top;
    box.down = box.bottom;
  }
  return box;
}

/** Éléments d'affichage d'un doigté dont la ligne de base est à y, ancré au milieu (`middle`) ou à droite (`end`) de x. */
function drawFingering(box, f, x, y, anchor) {
  if (box.allText) return [{ kind: 'text', role: 'fingering', text: f.text, x, y, size: box.size, anchor, italic: box.italic, ref: f.id }];
  const x0 = anchor === 'middle' ? x - box.w / 2 : x - box.w;
  return box.pieces.map((pc) => (pc.glyph
    ? { kind: 'glyph', role: 'fingering', name: pc.glyph, x: x0 + pc.x - pc.left, y, mag: pc.mag, ref: f.id }
    : { kind: 'text', role: 'fingering', text: pc.text, x: x0 + pc.x, y, size: box.size, anchor: 'start', italic: box.italic, ref: f.id }));
}

export const isChordFingering = (f) => f.kind !== 'lhGuitar';

/** Liste des doigtés d'une note (PID.FINGERINGS). Aucun sur une portée rythmique. */
export const noteFingerings = (note) => (note.type === 'rhythmnote' ? [] : getProperty(note, PID.FINGERINGS) ?? []);

/** Vrai si la portée porte au moins un doigté (évite tout calcul sinon). */
export function staffHasFingering(staff) {
  const has = (chord) => chord.notes.some((n) => noteFingerings(n).length) || (chord.graceNotes ?? []).some(has);
  for (const v of staff.voices) for (const m of v.measures) for (const it of m.items) if (it.type === 'chord' && has(it)) return true;
  return false;
}

/** Réserve à gauche de l'origine de l'accord pour ses doigtés de main gauche (ils font partie de la forme de la note). */
export function lhFingeringLead(item, ctx, visible = true) {
  if (!visible || item.type !== 'chord') return 0;
  let lead = 0;
  for (const n of item.notes) {
    for (const f of noteFingerings(n)) if (f.kind === 'lhGuitar') lead = Math.max(lead, -LH_OFFSET_X + fingeringBox(f, ctx).fullW);
  }
  return lead;
}

// ——— skyline ———

/** Découpe un polygone à la bande verticale [x1, x2] (Sutherland–Hodgman) ; renvoie { y1, y2 } ou null. */
function slabExtent(points, x1, x2) {
  let poly = points;
  for (const [bound, keepGreater] of [[x1, true], [x2, false]]) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const ina = keepGreater ? a[0] >= bound : a[0] <= bound;
      const inb = keepGreater ? b[0] >= bound : b[0] <= bound;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (bound - a[0]) / (b[0] - a[0]);
        out.push([bound, a[1] + t * (b[1] - a[1])]);
      }
    }
    poly = out;
    if (!poly.length) return null;
  }
  return { y1: Math.min(...poly.map((q) => q[1])), y2: Math.max(...poly.map((q) => q[1])) };
}

const sample = (p0, c1, c2, p3, n = 14) => Array.from({ length: n + 1 }, (_, k) => {
  const t = k / n; const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]];
});
const quad = (x1, y1, x2, y2, h) => {
  const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * h; const ny = (dx / len) * h;
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
};
/** Contours (polygones) d'un élément courbe ou oblique : liaisons, soufflets… (une boîte englobante serait bien trop haute au milieu d'un arc). */
function outlineOf(it) {
  switch (it.kind) {
    case 'polygon': return [it.points];
    case 'curve': {
      const top = sample([it.x1, it.y1], [it.topC1x, it.topC1y], [it.topC2x, it.topC2y], [it.x2, it.y2]);
      const bot = sample([it.x1, it.y1], [it.botC1x, it.botC1y], [it.botC2x, it.botC2y], [it.x2, it.y2]);
      return [[...top, ...bot.reverse()]];
    }
    case 'bezier': {
      const h = (it.width ?? 0) / 2;
      const pts = sample([it.x1, it.y1], [it.c1x, it.c1y], [it.c2x, it.c2y], [it.x2, it.y2]);
      return [[...pts.map(([x, y]) => [x, y + h]), ...pts.reverse().map(([x, y]) => [x, y - h])]];
    }
    case 'line': return [quad(it.x1, it.y1, it.x2, it.y2, (it.width ?? 0) / 2 + 1e-4)];
    case 'polyline': return it.points.slice(1).map((q, i) => quad(it.points[i][0], it.points[i][1], q[0], q[1], (it.width ?? 0) / 2 + 1e-4));
    default: return null;
  }
}

// éléments du « skyline » au moment des doigtés : ce qui est posé AVANT eux (têtes, hampes, ligatures, articulations…) ET, à la demande de Jean
// (05/10/2026), les liaisons / ties / hopos : elles se placent d'abord, les doigtés les évitent. Les NUANCES et soufflets, eux, sont placés APRÈS
// les doigtés (correction de Jean, 05/10/2026) : voir `displaceMarksFromFingerings`.
const SKYLINE_ROLES = new Set([undefined, 'stem', 'flag', 'beam', 'accidental', 'ledger', 'ledger-line', 'articulation', 'dot', 'tremolo', 'arpeggio',
  'chord-line', 'slash', 'stem-slash', 'fret-box', 'first', 'second', 'parenthesis', 'tapping', 'staff-line', 'clef-change',
  'slur', 'tie', 'hopo']);

function buildPool(items, glyphs, H) {
  const keep = items.filter((it) => SKYLINE_ROLES.has(it.role) && it.role !== 'staff-line');
  const polys = [];
  const plain = [];
  for (const it of keep) {
    if (it.kind === 'line' && it.role === 'stem') { plain.push(it); continue; } // hampe verticale : boîte exacte
    const o = outlineOf(it);
    if (o) polys.push(...o); else plain.push(it);
  }
  const rects = rectsOf(plain, glyphs);
  rects.push({ x1: -Infinity, x2: Infinity, y1: 0, y2: H }); // corps de la portée
  return { rects, polys };
}
function northAt(pool, x1, x2) {
  let n = -Infinity;
  for (const r of pool.rects) if (r.x2 > x1 && r.x1 < x2) n = Math.max(n, r.y2);
  for (const q of pool.polys) { const e = slabExtent(q, x1, x2); if (e) n = Math.max(n, e.y2); }
  return n;
}
function southAt(pool, x1, x2) {
  let m = Infinity;
  for (const r of pool.rects) if (r.x2 > x1 && r.x1 < x2) m = Math.min(m, r.y1);
  for (const q of pool.polys) { const e = slabExtent(q, x1, x2); if (e) m = Math.min(m, e.y1); }
  return m;
}
/** Bord de ligature (haut si `up`, sinon bas) à l'abscisse x ; null si aucune ligature n'y passe. */
function beamEdgeAt(beams, x, up) {
  let edge = null;
  for (const q of beams) {
    const e = slabExtent(q, x - 1e-6, x + 1e-6);
    if (!e) continue;
    edge = edge === null ? (up ? e.y2 : e.y1) : (up ? Math.max(edge, e.y2) : Math.min(edge, e.y1));
  }
  return edge;
}

/** Y a-t-il une voix 2-4 qui sonne pendant cet accord ? (`Measure::hasVoices`, à l'instant près ; en tablature : mesure entière). */
function hasVoices(entries, entry, wholeMeasure) {
  const end = fAdd(entry.position, entry.duration);
  for (const e of entries) {
    if (e.voice <= 0) continue;
    if (wholeMeasure) return true;
    if (fCmp(e.position, end) < 0 && fCmp(fAdd(e.position, e.duration), entry.position) > 0) return true;
  }
  return false;
}

/** Cibles d'un accord placé : l'accord lui-même et ses ornements (avant / après). */
function targetsOf(p, sys, tab, glyphs) {
  const { entry } = p;
  const out = [];
  const main = tab ? entry.tabGeom : entry.slurGeom;
  if (main?.notes?.length) {
    out.push({
      chord: entry.item, notes: main.notes, originX: tab ? p.x : main.x0,
      cx: tab ? main.axis + TAB_CENTER_DX : main.x0 + (main.headRight - main.x0) / 2, up: !!entry.stemUp,
    });
  }
  const graces = [[entry.graceLayout, entry.graceList, p.x], [entry.graceTrailLayout, entry.graceTrail, sys.measures?.find((m) => m.mi === p.mi)?.barX]];
  for (const [lay, list, origin] of graces) {
    if (!lay || !list) continue;
    list.forEach((g, gi) => {
      if (tab) {
        const a = lay.anchors?.get(g.chord.id);
        if (!a?.geom?.notes?.length) return;
        out.push({ chord: g.chord, notes: a.geom.notes, originX: a.geom.axis - a.geom.headW / 2, cx: a.geom.axis + TAB_CENTER_DX * a.mag, up: a.up, grace: true });
      } else {
        const geo = lay.geos?.[gi];
        if (!geo || origin === undefined) return;
        const x0 = origin + lay.x[gi];
        const hb = glyphs.glyphs[geo.head]?.bbox;
        if (!hb) return;
        const notes = g.chord.notes.map((n, ni) => ({ id: n.id, y: geo.ys[ni], rects: [{ x1: x0 + geo.dx[ni], x2: x0 + geo.dx[ni] + geo.headW, y1: geo.ys[ni] + hb.bBoxSW[1] * geo.mag, y2: geo.ys[ni] + hb.bBoxNE[1] * geo.mag }] }));
        out.push({ chord: g.chord, notes, originX: x0, cx: x0 + geo.headW / 2, up: Boolean(geo.up), grace: true });
      }
    });
  }
  return out;
}

const DYNAMIC_GAP = 0.4; // dégagement nuance / soufflet ↔ doigté (même marge que `Sid::articulationMinDistance`)

/**
 * Nuances et soufflets placés APRÈS les doigtés (Jean, 05/10/2026) : ils ont été posés avec les têtes, hampes et articulations ; s'ils touchent
 * un doigté, ils s'éloignent de la portée (vers le bas pour une marque dessous, vers le haut pour une marque dessus), sans jamais glisser
 * horizontalement. Un soufflet (2 lignes d'un même `ref`) se déplace d'un bloc.
 */
function displaceMarksFromFingerings(items, fingerRects, glyphs, H) {
  if (!fingerRects.length) return;
  const units = [];
  const byRef = new Map();
  for (const it of items) {
    // une nuance à plusieurs glyphes (sff, sfff…) ou un soufflet (2 lignes) se déplace d'un bloc
    const key = it.role === 'dynamic' && (it.kind === 'glyph' || it.kind === 'text') ? `dyn:${it.ref}` : it.role === 'hairpin' && it.kind === 'line' ? it.ref : null;
    if (key !== null) {
      if (!byRef.has(key)) { const u = { items: [] }; byRef.set(key, u); units.push(u); }
      byRef.get(key).items.push(it);
    }
  }
  const rectOf = (u) => {
    const rs = rectsOf(u.items, glyphs);
    return rs.length ? { x1: Math.min(...rs.map((r) => r.x1)), x2: Math.max(...rs.map((r) => r.x2)), y1: Math.min(...rs.map((r) => r.y1)), y2: Math.max(...rs.map((r) => r.y2)) } : null;
  };
  const shift = (u, d) => { for (const it of u.items) { if (it.kind === 'glyph') it.y += d; else { it.y1 += d; it.y2 += d; } } };
  for (const u of units) {
    let r = rectOf(u);
    if (!r) continue;
    const below = (r.y1 + r.y2) / 2 < H / 2;
    for (let n = 0; n < 6; n++) {
      const hit = fingerRects.filter((f) => f.x1 < r.x2 && f.x2 > r.x1 && f.y1 < r.y2 && f.y2 > r.y1);
      if (!hit.length) break;
      const d = below ? Math.min(...hit.map((f) => f.y1)) - DYNAMIC_GAP - r.y2 : Math.max(...hit.map((f) => f.y2)) + DYNAMIC_GAP - r.y1;
      shift(u, d);
      r = rectOf(u);
    }
  }
}

/**
 * @param perSystem  [{ sys, placed }]
 * @param staff      portée (score, percussion ou tablature)
 * @param result     éléments d'affichage par système (poussés ici)
 * @param existing   éléments déjà dessinés par système (skyline)
 * @param tab        null (portée de notation) | préréglage de tablature { showFingering }
 */
export function fingeringItems({ perSystem, staff, ctx, result, lines, lineDist = 1, existing = [], tab = null }) {
  if (tab && !tab.showFingering) return; // tablature « Simple » : aucun doigté (`StaffType::showTabFingering`)
  const H = (lines - 1) * lineDist;
  const md = ctx.style(SID.FINGERING_MIN_DISTANCE);
  const nstaves = ctx.track?.staves?.length ?? 1;
  const rstaff = Math.max(0, ctx.track?.staves?.indexOf(staff) ?? 0);
  const off = (f) => (f.offset ? [f.offset[0], -f.offset[1]] : [0, 0]); // déplacement manuel : y MuseScore (vers le bas) → y vers le haut

  perSystem.forEach(({ sys, placed }, k) => {
    const sysItems = [...(existing[k] ?? []), ...(result[k] ?? [])];
    const pool = buildPool(sysItems, ctx.glyphs, H);
    const beams = sysItems.filter((it) => it.kind === 'polygon' && it.role === 'beam').map((it) => it.points);
    const entriesByMeasure = new Map();
    for (const p of placed) {
      if (!entriesByMeasure.has(p.mi)) entriesByMeasure.set(p.mi, []);
      entriesByMeasure.get(p.mi).push(p.entry);
    }
    const out = result[k];

    for (const p of placed) {
      const { entry } = p;
      if (entry.item.type !== 'chord') continue;
      for (const tg of targetsOf(p, sys, tab, ctx.glyphs)) {
        // notes de la cible de la plus basse à la plus haute, avec leur modèle
        const notes = tg.notes
          .map((gn) => ({ gn, note: tg.chord.notes.find((n) => n.id === gn.id) }))
          .filter((o) => o.note)
          .sort((a, b) => a.gn.y - b.gn.y);
        if (!notes.some((o) => noteFingerings(o.note).length)) continue;
        const chordRects = notes.flatMap((o) => (o.gn.rects?.length ? o.gn.rects : [{ y1: o.gn.y - 0.5, y2: o.gn.y + 0.5 }]));
        const topNote = Math.max(...chordRects.map((r) => r.y2));
        const bottomNote = Math.min(...chordRects.map((r) => r.y1));
        const stemItem = sysItems.find((it) => it.kind === 'line' && it.role === 'stem' && it.ref === tg.chord.id);
        const stemUp = stemItem ? stemItem.y2 > stemItem.y1 : tg.up;
        const beamEdge = stemItem ? beamEdgeAt(beams, stemItem.x1, stemUp) : null;
        const beamed = beamEdge !== null;
        const voices = hasVoices(entriesByMeasure.get(p.mi) ?? [], entry, Boolean(tab));
        const autoBelow = voices ? !stemUp : nstaves > 1 && rstaff === nstaves - 1;

        // main gauche : à gauche de la note, sans évitement
        for (const o of notes) {
          for (const f of noteFingerings(o.note)) {
            if (f.kind !== 'lhGuitar') continue;
            const b = fingeringBox(f, { ...ctx, staff });
            const [dx, dy] = off(f);
            const baseline = o.gn.y - (b.top - b.bottom) / 2 + dy; // boîte serrée centrée sur la hauteur de la note
            const xr = tg.originX + LH_OFFSET_X + dx;
            out.push(...drawFingering(b, f, xr, baseline, 'end'));
            pool.rects.push({ x1: xr - b.w, x2: xr, y1: baseline - b.bottom, y2: baseline + b.top });
          }
        }

        // doigtés posés par rapport à l'accord
        const above = []; const below = [];
        for (const o of notes) {
          for (const f of noteFingerings(o.note)) {
            if (!isChordFingering(f)) continue;
            if (tab && f.kind === 'stringNumber') continue; // jamais en tablature
            ((f.placement ?? (autoBelow ? 'below' : 'above')) === 'below' ? below : above).push({ f, o });
          }
        }
        below.reverse(); // dessous : le dernier (note la plus haute) est le plus proche de la portée
        const single = notes.length === 1;
        const place = (list, isAbove) => {
          for (const { f, o } of list) {
            const b = fingeringBox(f, { ...ctx, staff });
            const tight = voices && single && !beamed && f.kind !== 'stringNumber';
            const w = b.fullW;
            let cxf = tg.cx;
            let boxBottom; // y du bas (dessus) ou du haut (dessous) de la boîte
            if (tight) {
              if (stemItem) cxf += isAbove ? -TIGHT_X : TIGHT_X;
              const center = o.gn.y + (isAbove ? TIGHT_Y : -TIGHT_Y);
              boxBottom = isAbove ? center - (b.up + b.down) / 2 : center + (b.up + b.down) / 2;
            } else {
              const x1 = cxf - w / 2; const x2 = cxf + w / 2;
              const quarter = 0.25 * (b.up + b.down);
              if (isAbove) {
                const limit = (stemUp && beamed && stemItem ? beamEdge : Math.max(H, topNote)) + md;
                boxBottom = Math.max(northAt(pool, x1, x2) + quarter, limit);
              } else {
                const limit = (!stemUp && beamed && stemItem ? beamEdge : Math.min(0, bottomNote)) - md;
                boxBottom = Math.min(southAt(pool, x1, x2) - quarter, limit); // = haut de la boîte
              }
            }
            const [dx, dy] = off(f);
            cxf += dx;
            const baseline = (isAbove ? boxBottom + b.down : boxBottom - b.up) + dy;
            out.push(...drawFingering(b, f, cxf, baseline, 'middle'));
            if (b.circle) out.push({ kind: 'circle', role: 'fingering-circle', cx: cxf, cy: baseline + b.circle.cy, r: b.circle.r, fill: 'none', stroke: 'ink', strokeWidth: CIRCLE_WIDTH, ref: f.id });
            pool.rects.push({ x1: cxf - w / 2, x2: cxf + w / 2, y1: baseline - b.down, y2: baseline + b.up });
          }
        };
        place(above, true);
        place(below, false);
      }
    }
    displaceMarksFromFingerings(existing[k] ?? [], rectsOf(out.filter((it) => it.role === 'fingering' || it.role === 'fingering-circle'), ctx.glyphs), ctx.glyphs, H);
  });
}
