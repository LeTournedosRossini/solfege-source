/*
 * Peintre « accordéon main gauche » (tranche 6 ; spécification : annexe A.2 et `notation-main-gauche-accordeon-chromatique.md` §7-9, prototype `acc*`).
 * Portée de 5 lignes (clé vectorielle, armure et chiffrage comme la clé de fa) qui porte deux familles de têtes :
 *   - BASSES (rangs 1-2) : vraies têtes Bravura à leur hauteur réelle (clé de fa), lignes supplémentaires, altérations dérivées de l'armure ;
 *     contre-basse = bleue + « 8 » italique sous la tête ; badge « rang/position » au-dessus (`SHOW_BASS_BADGES`) ;
 *   - BOUTONS D'ACCORD (rangs 3-6) : tête ronde en relief, nom de l'accord dedans (lettres = texte, ♯ ♭ ° = glyphes Bravura), posée à une hauteur
 *     NEUTRE réglable par portée (`PID.ACCORDION_LAYOUT` : au-dessus / au-dessous, hauteur), jamais à la hauteur d'une note ; la durée est
 *     codée par l'anneau (simple = noire et plus court, double = blanche, anneau noir plein = ronde, sans hampe). Plusieurs boutons simultanés
 *     (accords enrichis du jazz) s'empilent vers l'extérieur de la portée, le badge de chacun au-delà du dernier.
 * Rythme : hampes TOUJOURS vers le bas, attachées au bord GAUCHE de la tête ou du bouton ; basse + boutons au même instant = UNE hampe partagée ;
 * ligatures et crochets comme les autres portées (groupes de `beamgroups.js`). Ligne de ligature : calculée sur la basse la plus basse (un bouton seul
 * compte comme le milieu de la portée), pente bornée.
 * Décalage §7.7 : si le badge (ou la tête) d'une basse empiète horizontalement sur un bouton, TOUS les boutons de la MESURE s'éloignent de la quantité nécessaire.
 * Marques (15/10/2026) : articulations, nuances, soufflets, ties et liaisons d'expression comme sur la portée de notation, calculées autour de
 * l'ÉTENDUE de l'accord (basses, boutons et leurs badges : `entry.accExtent`). Limites : une seule main de ligature par voix, pas de collision entre voix.
 */
import { PID, SID, getProperty, resolveAccordionLayout, chordButtonName, buttonBadge, DEFAULT_ACCORDION_SYSTEM, ACC_ROW_COUNTER_BASS } from '../../model/index.js';
import { CLEF_DEFS, GLYPH_PAD } from '../constants.js';
import { entrySpace } from '../spacing.js';
import { glyphItem, glyphWidth } from '../header.js';
import { headGlyph, accidentalPad, FLAG } from '../chordgeom.js';
import { noteY, spellingOf } from '../pitchpos.js';
import { resolveAccidentals } from '../accidentals.js';
import { buildBeamGroups, beamItems, beamCountOf } from '../beaming.js';
import { beamLayoutData } from '../beamtremolo.js';
import { tupletGroups, tupletItems } from '../tuplets.js';
import { restDotItems, DOT_NOTE_DISTANCE, DOT_DOT_DISTANCE } from '../scoredots.js';
import { lineStack, sequentialEntries, restGlyphName, restX, hideIfInvisible } from './common.js';
import { articulationItems } from '../articulations.js';
import { dynamicItems } from '../dynamics.js';
import { staffHairpins, staffTies, staffSlurs, staffSlurDirections } from './resolved.js';
import { spannerSegmentType, hairpinY, hairpinWedgeLines, HAIRPIN_LINE_WIDTH } from '../hairpins.js';
import { tieDirection, tieShoulderHeight, TIE_SHOULDER_W, TIE_MID_WIDTH, TIE_HORIZONTAL_INSET, TIE_VERTICAL_GAP } from '../ties.js';
import { slurUp, slurEndpointY, extendByRange, slurShoulderWidth, slurShoulderHeight, SLUR_MID_WIDTH, SLUR_HORIZONTAL_INSET, SLUR_REST_BELOW, SLUR_REST_ABOVE_GAP } from '../slurs.js';
import { curveItem } from '../slurtie.js';
import { adjustTieY } from '../tabspanners.js';

// ---------- constantes (prototype, annexe A.2 : unités = espaces de portée) ----------
export const BUTTON_R = 1.3; // rayon du bouton
const RING_GAP = 0.24; // anneau extérieur (blanche / ronde)
const BADGE_R_CHORD = 0.85;
const BADGE_R_BASS = 0.75;
const BASS_BADGE_DY = 1.73; // centre du badge d'une basse au-dessus du centre de sa tête
const MIN_GAP = 0.8; // MIN_GAP du §7.7
const STACK_GAP = 0.15; // entre deux boutons empilés
const STEM_LEN = 3.5;
export const BLUE = '#2E6FE0';
const BUTTON_STROKE = '#3A342C';
const BUTTON_TEXT = '#2C2313';
const RING_COLOR = '#6B6156';
const RING_FILL = '#1C1C1A';
const BADGE_GAP = 0.1;
const MAX_BEAM_SLOPE = 1; // dénivelé maximal (espaces) d'une ligature
const CLEF_PATH = 'M 45 5 C 60 5 68 18 68 32 C 68 50 52 62 34 62 C 18 62 6 52 6 38 C 6 28 14 22 22 24 C 30 26 32 34 26 38 C 22 40 18 38 18 34 '
  + 'C 22 42 34 42 38 32 C 42 22 34 14 22 14 C 10 14 2 24 2 38 C 2 56 18 70 38 70 C 58 70 74 54 74 34 C 74 14 58 -4 38 -4 Z';
const CLEF_K = 0.05; // unités du tracé → espaces
const CLEF_DY = 5.2; // le repère du tracé est à 1,2 espace au-dessus de la ligne du haut
const CLEF_W = (85 - 2) * CLEF_K;

/** Clé vectorielle fournie par Jean (§9.1) : tracé + deux points de part et d'autre de la 4e ligne (fa). */
export function accordionClefItems(x, ref) {
  const X = (u) => x + CLEF_K * (u - 2);
  const Y = (v) => CLEF_DY - CLEF_K * (v + 10);
  return [
    { kind: 'path', d: CLEF_PATH, x: X(0) - CLEF_K * 0, y: CLEF_DY, scale: CLEF_K, dx: 0, dy: 10, fill: 'ink', role: 'clef', name: 'accordionClef', ref,
      bounds: { x1: X(2), x2: X(85), y1: Y(70), y2: Y(-4) } },
    { kind: 'circle', cx: X(80), cy: Y(24), r: 5 * CLEF_K, fill: 'ink', role: 'clef', ref },
    { kind: 'circle', cx: X(80), cy: Y(44), r: 5 * CLEF_K, fill: 'ink', role: 'clef', ref },
  ];
}

// ---------- éléments : notes de basse et boutons ----------
const isDotted = (item) => (getProperty(item, PID.DURATION).dots ?? 0) > 0;
const baseOf = (item) => getProperty(item, PID.DURATION).base;
const hasStemOf = (base) => base !== 'whole' && base !== 'breve' && base !== 'measure';
const ringOf = (base) => (base === 'whole' || base === 'breve' ? 'filled' : base === 'half' ? 'double' : 'single');
const outerR = (base) => BUTTON_R + (ringOf(base) === 'single' ? 0 : RING_GAP);

function classify(item, keySig) {
  const bass = [];
  const buttons = [];
  for (const note of item.notes) {
    const row = getProperty(note, PID.ACC_ROW);
    const spelling = getProperty(note, PID.SPELLING);
    if (row <= 2) {
      const sp = spellingOf(note.pitch, note.spelling, keySig);
      bass.push({ note, row, spelling, y: noteY(sp, 'F') });
    } else buttons.push({ note, row, spelling });
  }
  bass.sort((a, b) => a.y - b.y);
  buttons.sort((a, b) => a.row - b.row || a.spelling.step.localeCompare(b.spelling.step));
  return { bass, buttons };
}

/** Géométrie horizontale d'un accord, relative à l'origine de sa tête (x = 0). */
function chordGeom(entry, ctx) {
  const { glyphs, style } = ctx;
  const base = baseOf(entry.item);
  const t = style(SID.STEM_THICKNESS);
  const rOut = outerR(base);
  const headName = headGlyph(base);
  const headW = glyphWidth(glyphs, headName);
  const stemX = t / 2;
  const cx = stemX + rOut;
  const hasB = entry.buttons.length > 0;
  const hasBass = entry.bass.length > 0;
  let right = 0;
  if (hasBass) right = Math.max(right, headW);
  if (hasB) right = Math.max(right, cx + rOut);
  const dots = isDotted(entry.item) ? getProperty(entry.item, PID.DURATION).dots : 0;
  const dotW = glyphWidth(glyphs, 'augmentationDot');
  const dotsRight = dots ? right + DOT_NOTE_DISTANCE + (dots - 1) * DOT_DOT_DISTANCE + dotW : null;
  return { base, t, rOut, headName, headW, stemX, cx, hasB, hasBass, right, dots, dotsRight, bassBadgeCx: hasB ? stemX + BADGE_R_BASS + 0.05 : headW / 2 };
}

/** Badges des basses d'un accord, empilés si leurs hauteurs se touchent. @returns [{ note entry, cx, cy }] */
function bassBadges(entry, g) {
  const out = [];
  let prevTop = -Infinity;
  for (const b of entry.bass) {
    const cy = Math.max(b.y + BASS_BADGE_DY, prevTop + BADGE_R_BASS + BADGE_GAP);
    out.push({ b, cx: g.bassBadgeCx, cy });
    prevTop = cy + BADGE_R_BASS;
  }
  return out;
}

export const accordionPainter = {
  name: 'accordion-left',
  lines: (staff, ctx) => lineStack(5, ctx.style(SID.STAFF_LINE_THICKNESS)),
  clef: (staff, ctx, mi) => ({ width: CLEF_W + GLYPH_PAD, y: 0, key: 'F', items: accordionClefItems }),
  keySig: () => ({ clefKey: 'F' }),
  timeSig: () => ({ yNum: 3, yDen: 1 }),

  /** Éléments de la mesure : basses / boutons de chaque accord, altérations des basses (dérivées de l'armure, toutes voix). */
  entries(staff, mi, ctx) {
    const entries = sequentialEntries(staff, mi, ctx);
    const keySig = ctx.keySigs[mi];
    const layout = resolveAccordionLayout(getProperty(staff, PID.ACCORDION_LAYOUT));
    const showBadges = getProperty(staff, PID.SHOW_BASS_BADGES) !== false;
    const system = getProperty(staff, PID.ACCORDION_SYSTEM) ?? DEFAULT_ACCORDION_SYSTEM;
    const out = entries.map((e) => (e.item.type === 'chord' ? { ...e, ...classify(e.item, keySig) } : { ...e, bass: [], buttons: [] }));
    // altérations : seulement les basses (un bouton d'accord n'a pas de hauteur écrite)
    const bassOnly = out.map((e) => (e.item.type === 'chord' ? { ...e, item: { ...e.item, notes: e.bass.map((b) => b.note) } } : e));
    const shown = resolveAccidentals(bassOnly, keySig);
    return out.map((e) => ({ ...e, keySig, accidentals: shown, layout, showBadges, system, lines: 5 }));
  },

  /** Place à gauche de la tête : la plus large altération d'une basse + sa marge. */
  lead(entry, ctx) {
    let lead = 0;
    for (const b of entry.bass) {
      const name = entry.accidentals.get(b.note.id);
      if (name) lead = Math.max(lead, glyphWidth(ctx.glyphs, name) + accidentalPad(b.y, ctx.style, 5));
    }
    return lead;
  },

  itemWidth(entry, ctx) {
    let w = entrySpace(entry, ctx.style);
    if (entry.item.type === 'rest') {
      const base = baseOf(entry.item);
      if (base === 'sixteenth' || base === 'thirtysecond') w += 0.9;
      return w;
    }
    const g = chordGeom(entry, ctx);
    // jamais moins large que le bouton (§9.5) : le plus grand des deux types d'éléments fixe le minimum
    if (g.hasB) w = Math.max(w, 2 * g.rOut + 0.5);
    if (g.dotsRight != null) w = Math.max(w, g.dotsRight + 0.4);
    return w + this.lead(entry, ctx);
  },

  paintEntry(entry, x, ctx) {
    return this.paintMeasure([{ entry, x }], ctx);
  },

  /**
   * Soufflets, ties et liaisons d'expression : mêmes règles que la portée de notation, sur l'étendue de chaque accord (`entry.accExtent`,
   * posée par `paintMeasure`). Hampes toujours vers le bas en voix 1 : liaison dessus, soufflet dessous.
   */
  paintSystemExtra(systemPlaced, staff, movement, sys, ctx) {
    const items = [];
    if (!systemPlaced.length) return items;
    const byId = new Map(systemPlaced.map((p) => [p.entry.item.id, p]));
    const firstMi = sys.measures[0].mi;
    const lastMi = sys.measures[sys.measures.length - 1].mi;
    const extentsBetween = (a, b) => {
      let hi = null; let lo = null;
      for (const p of systemPlaced) {
        const ex = p.entry.accExtent;
        if (!ex || p.entry.item.type !== 'chord' || p.mi < a.startMi || p.mi > a.endMi) continue;
        hi = hi === null ? ex.hi : Math.max(hi, ex.hi);
        lo = lo === null ? ex.lo : Math.min(lo, ex.lo);
      }
      return { hi, lo };
    };
    for (const hp of staffHairpins(ctx, staff)) {
      const startP = byId.get(hp.startChordId) ?? null;
      const endP = byId.get(hp.endChordId) ?? null;
      if (!startP && !endP && !(hp.startMi < firstMi && hp.endMi > lastMi)) continue;
      const { hi, lo } = extentsBetween(hp);
      const y = hairpinY({ above: false, extremeTop: hi, extremeBottom: lo, staffTop: 4 });
      const x1 = startP ? startP.x : sys.measures[0].start;
      const x2 = endP ? endP.x + (endP.entry.accExtent ? 2 * (endP.entry.accExtent.cx) : 1) + 0.3 : sys.measures[sys.measures.length - 1].barX;
      for (const line of hairpinWedgeLines({ hairpinType: hp.hairpinType, segType: spannerSegmentType(Boolean(startP), Boolean(endP)), x1, x2, y })) {
        items.push({ kind: 'line', role: 'hairpin', x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2, width: HAIRPIN_LINE_WIDTH, ref: hp.id });
      }
    }
    // ties: between two BASS notes (a button has no pitch)
    const ties = staffTies(ctx, staff);
    const tiedIds = new Set(ties.map((t) => t.startNoteId));
    for (const tie of ties) {
      const sp = byId.get(tie.start.chordId);
      const ep = byId.get(tie.end.chordId);
      if (!sp || !ep) continue;
      const sb = sp.entry.bass.find((b) => b.note.id === tie.startNoteId);
      const eb = ep.entry.bass.find((b) => b.note.id === tie.endNoteId);
      if (!sb || !eb) continue;
      const headW = glyphWidth(ctx.glyphs, headGlyph(baseOf(sp.entry.item)));
      const up = tieDirection({
        notes: sp.entry.bass.map((b) => ({ id: b.note.id, y: b.y, pitch: b.note.pitch, tied: tiedIds.has(b.note.id) })), noteId: tie.startNoteId,
        startStemUp: false, endStemUp: false, multipleVoices: sp.entry.voice > 0, startVoice: sp.entry.voice ?? 0, endMultipleVoices: ep.entry.voice > 0, endVoice: ep.entry.voice ?? 0,
      });
      const sign = up ? 1 : -1;
      const x1 = sp.x + headW + TIE_HORIZONTAL_INSET;
      const x2 = ep.x - TIE_HORIZONTAL_INSET;
      const y1 = sb.y + sign * (0.5 + TIE_VERTICAL_GAP);
      const y2 = eb.y + sign * (0.5 + TIE_VERTICAL_GAP);
      const Hs = 4;
      const adj = adjustTieY({ x1, x2, y1: Hs - y1, y2: Hs - y2, up, outerStart: true, outerEnd: true, inside: false, tiedSecondInside: false, endpointAboveNote: false },
        { lines: 5, lineDist: 1, lineThickness: ctx.style(SID.STAFF_LINE_THICKNESS), H: Hs, minArcClearance: ctx.style(SID.TIE_ARC_LINE_CLEARANCE) });
      const ay1 = Hs - adj.y1; const ay2 = Hs - adj.y2;
      items.push(curveItem({ x1, y1: ay1, x2, y2: ay2, shoulderW: TIE_SHOULDER_W, shoulderH: tieShoulderHeight(Math.hypot(x2 - x1, ay2 - ay1)) + adj.extraShoulder, up, midWidth: TIE_MID_WIDTH, role: 'tie', ref: tie.id }));
    }
    // slurs (over the whole chord extent)
    const dirMap = staffSlurDirections(ctx, staff);
    for (const sl of staffSlurs(ctx, staff)) {
      const startP = byId.get(sl.startChordId) ?? null;
      const endP = byId.get(sl.endChordId) ?? null;
      if (!startP && !endP && !(sl.startMi < firstMi && sl.endMi > lastMi)) continue;
      let up;
      if (startP) { up = slurUp({ startStemUp: !!startP.entry.accExtent?.stemUp, multipleVoices: startP.entry.voice > 0, startVoice: startP.entry.voice ?? 0 }); dirMap.set(sl.id, up); } else up = dirMap.get(sl.id) ?? true;
      const { hi, lo } = extentsBetween(sl);
      const openY = up ? 4 + SLUR_REST_ABOVE_GAP : SLUR_REST_BELOW;
      const endY = (p) => (p ? slurEndpointY({ up, extremeY: up ? (p.entry.accExtent?.hi ?? 4) : (p.entry.accExtent?.lo ?? 0) }) : openY);
      const x1 = startP ? startP.x + (startP.entry.accExtent?.cx ?? SLUR_HORIZONTAL_INSET) : sys.measures[0].start;
      const x2 = endP ? endP.x + (endP.entry.accExtent?.cx ?? 0.5) : sys.measures[sys.measures.length - 1].barX;
      const y1 = extendByRange(endY(startP), { up, extremeTop: hi, extremeBottom: lo });
      const y2 = extendByRange(endY(endP), { up, extremeTop: hi, extremeBottom: lo });
      const w = Math.abs(x2 - x1);
      items.push(curveItem({ x1, y1, x2, y2, up, shoulderW: slurShoulderWidth(w), shoulderH: slurShoulderHeight(w), midWidth: SLUR_MID_WIDTH, role: 'slur', ref: sl.id }));
    }
    return items;
  },

  paintMeasure(placed, ctx) {
    const { glyphs, style } = ctx;
    const mi = ctx.measure?.index ?? 0;
    const items = [];
    const thickness = style(SID.STEM_THICKNESS);

    // --- géométrie de chaque élément et hauteur commune des boutons de la mesure (§7.7) ---
    const geo = placed.map((p) => (p.entry.item.type === 'chord' ? { ...chordGeom(p.entry, ctx), x: p.x } : null));
    const L = placed[0]?.entry.layout ?? resolveAccordionLayout(null);
    const above = L.buttonPlacement !== 'below';
    let chordP = above ? 4 + L.buttonOffset : -L.buttonOffset;
    placed.forEach((pb, i) => {
      const gb = geo[i];
      if (!gb || !gb.hasBass) return;
      const eb = pb.entry;
      const badges = eb.showBadges ? bassBadges(eb, gb) : [];
      const top = badges.length ? Math.max(...badges.map((bd) => bd.cy + BADGE_R_BASS)) : Math.max(...eb.bass.map((b) => b.y + 0.5));
      const bottom = Math.min(...eb.bass.map((b) => b.y - 0.5));
      const bx1 = badges.length ? gb.bassBadgeCx - BADGE_R_BASS - 0.2 : 0;
      const bx2 = badges.length ? gb.bassBadgeCx + BADGE_R_BASS + 0.2 : gb.headW;
      placed.forEach((pc, j) => {
        const gc = geo[j];
        if (!gc || !gc.hasB) return;
        const cx = gc.x + gc.cx;
        const overlap = pb.x + bx2 > cx - gc.rOut && pb.x + bx1 < cx + gc.rOut;
        if (!overlap) return;
        if (above) chordP = Math.max(chordP, top + MIN_GAP + gc.rOut);
        else chordP = Math.min(chordP, bottom - MIN_GAP - gc.rOut);
      });
    });
    const buttonYs = (e, g) => e.buttons.map((_, k) => (above ? chordP + k * (2 * g.rOut + STACK_GAP) : chordP - k * (2 * g.rOut + STACK_GAP)));

    // --- hampes : pied, bas nominal, ligatures ---
    const stemOf = placed.map((p, i) => {
      const e = p.entry;
      const g = geo[i];
      if (!g || !hasStemOf(g.base)) return null;
      const ys = buttonYs(e, g);
      // deuxième voix (boutons d'accord seuls) : hampe vers le HAUT, à partir du bouton le plus haut ; les basses (voix 1) gardent la hampe vers le bas
      if (e.voice >= 1 && !e.bass.length && ys.length) return { x: p.x + g.stemX, up: true, foot: Math.max(...ys), top: Math.max(...ys) };
      const feet = [...e.bass.map((b) => b.y - 0.168), ...ys];
      const lows = [...e.bass.map((b) => b.y), ...(e.bass.length ? [] : (above ? [2] : ys))];
      return { x: p.x + g.stemX, foot: Math.max(...feet), lowP: Math.min(...lows) };
    });
    const byVoice = new Map();
    placed.forEach((p, i) => {
      if (!byVoice.has(p.entry.voice)) byVoice.set(p.entry.voice, []);
      byVoice.get(p.entry.voice).push(i);
    });
    const tipOf = new Map(); // index → ordonnée de la pointe de hampe (ligaturée : bord extérieur de la ligature)
    const beamed = new Set();
    for (const idx of byVoice.values()) {
      const groups = buildBeamGroups(idx.map((i) => placed[i].entry), ctx.timeSigs[mi], ctx.beamGroupings[mi], ctx.offsets[mi], style(SID.BEAM_BY_BEAT));
      for (const group of groups) {
        const gi = group.map((k) => idx[k]);
        const chords = gi.filter((i) => stemOf[i]);
        if (chords.length < 2) continue;
        const x0 = stemOf[chords[0]].x;
        const upGroup = !!stemOf[chords[0]].up;
        const t = chords.map((i) => (upGroup ? stemOf[i].top + STEM_LEN : stemOf[i].lowP - STEM_LEN));
        const dx = stemOf[chords[chords.length - 1]].x - x0 || 1;
        const slope = Math.max(-MAX_BEAM_SLOPE, Math.min(MAX_BEAM_SLOPE, t[t.length - 1] - t[0])) / dx;
        const along = chords.map((i, k) => t[k] - slope * (stemOf[i].x - x0));
        const c = upGroup ? Math.max(...along) : Math.min(...along); // aucune hampe plus courte que sa longueur nominale
        const lineAt = (x) => c + slope * (x - x0);
        const L2 = beamLayoutData({ up: upGroup, beamWidth: style(SID.BEAM_THICKNESS), stemWidth: thickness });
        const members = group.map((k, m) => {
          const i = idx[k];
          const e = placed[i].entry;
          const base = baseOf(e.item);
          if (e.item.type === 'rest') {
            const rn = restGlyphName(base);
            return { x: placed[i].x, rest: true, beams: beamCountOf(base), info: group.infos[m], dflt: group.defaults[m], rn };
          }
          return { x: stemOf[i].x, beams: beamCountOf(base), info: group.infos[m], dflt: group.defaults[m] };
        });
        const line = { startX: x0, endX: stemOf[chords[chords.length - 1]].x, at: lineAt, beamDist: L2.beamDist };
        items.push(...beamItems(members, line, upGroup ? 'up' : 'down', { thickness: style(SID.BEAM_THICKNESS), stemWidth: thickness }, placed[gi[0]].entry.item.id));
        for (const i of chords) { tipOf.set(i, lineAt(stemOf[i].x)); beamed.add(i); }
      }
    }

    // --- dessin élément par élément ---
    const extents = [];
    placed.forEach((p, i) => {
      const { entry: e, x } = p;
      const g = geo[i];
      if (!g) {
        if (getProperty(e.item, PID.GAP) === true) { extents.push({ hi: 0, lo: 0, up: 0, geom: { left: x, right: x, stemX: null, stemDir: 0, stemWidth: thickness } }); return; } // silence « trou » : invisible
        const base = baseOf(e.item);
        const name = restGlyphName(base);
        const w = glyphWidth(glyphs, name);
        const ry = base === 'whole' || base === 'measure' || base === 'breve' ? 3 : 2;
        const rx = restX(e, x, ctx, w);
        const restItems = [glyphItem(name, rx, ry, { ref: e.item.id })];
        const dots = getProperty(e.item, PID.DURATION).dots ?? 0;
        if (dots) restItems.push(...restDotItems({ x: rx, y: ry, width: w, base, dots, dotWidth: glyphWidth(glyphs, 'augmentationDot'), ref: e.item.id }).items);
        items.push(...hideIfInvisible(e.item, restItems));
        extents.push({ hi: ry + 1, lo: ry - 1, up: 0, geom: { left: rx, right: rx + w, stemX: null, stemDir: 0, stemWidth: thickness } });
        return;
      }
      const ys = buttonYs(e, g);
      const ref = e.item.id;
      const stem = stemOf[i];
      let tip = null;
      if (stem) {
        tip = tipOf.has(i) ? tipOf.get(i) : stem.up ? stem.top + STEM_LEN : stem.lowP - STEM_LEN;
        const flagName = !beamed.has(i) ? FLAG[g.base] : null;
        const flagGlyph = flagName ? `${flagName}${stem.up ? 'Up' : 'Down'}` : null;
        const end = flagGlyph && glyphs.glyphs[flagGlyph] ? tip + glyphs.glyphs[flagGlyph].anchors[stem.up ? 'stemUpNW' : 'stemDownSW'][1] : tip;
        const solo = !g.hasB && e.bass.length === 1 && e.bass[0].row === ACC_ROW_COUNTER_BASS && !beamed.has(i);
        items.push({ kind: 'line', role: 'stem', x1: stem.x, x2: stem.x, y1: stem.foot, y2: end, width: thickness, ref, ...(solo ? { color: BLUE } : {}) });
        if (flagGlyph && glyphs.glyphs[flagGlyph]) items.push(glyphItem(flagGlyph, stem.x, tip, { ref, role: 'flag', ...(solo ? { color: BLUE } : {}) }));
      }
      // basses : lignes supplémentaires, tête, altération, « 8 », badge
      const badges = e.showBadges ? bassBadges(e, g) : [];
      const ext = style(SID.LEDGER_LINE_EXTENSION);
      const ledgers = new Set();
      for (const b of e.bass) {
        if (b.y < 0) for (let l = -1; l >= Math.ceil(b.y); l--) ledgers.add(l);
        if (b.y > 4) for (let l = 5; l <= Math.floor(b.y); l++) ledgers.add(l);
      }
      for (const l of ledgers) items.push({ kind: 'line', role: 'ledger', x1: x - ext, x2: x + g.headW + ext, y1: l, y2: l, width: style(SID.LEDGER_LINE_THICKNESS), ref });
      for (const b of e.bass) {
        const blue = b.row === ACC_ROW_COUNTER_BASS;
        items.push(glyphItem(g.headName, x, b.y, { ref: b.note.id, role: 'notehead', ...(blue ? { color: BLUE } : {}) }));
        const acc = e.accidentals.get(b.note.id);
        if (acc) items.push(glyphItem(acc, x - glyphWidth(glyphs, acc) - accidentalPad(b.y, style, 5), b.y, { ref: b.note.id, role: 'accidental' }));
        if (blue) items.push({ kind: 'text', role: 'counterbass-mark', x: x + g.headW / 2, y: b.y - 1.1, text: '8', size: 0.95, family: 'serif', italic: true, weight: 600, anchor: 'middle', ref: b.note.id });
      }
      for (const bd of badges) {
        const hx = x + g.headW / 2;
        items.push({ kind: 'line', role: 'badge-link', x1: x + bd.cx, y1: bd.cy - BADGE_R_BASS, x2: hx, y2: bd.b.y + 0.6, width: 0.1, ref: bd.b.note.id });
        items.push(...badgeItems(x + bd.cx, bd.cy, BADGE_R_BASS, buttonBadge(bd.b.row, bd.b.spelling, e.system), bd.b.note.id));
      }
      // boutons d'accord empilés (le plus proche de la portée = rang le plus bas), badges au-delà du dernier
      e.buttons.forEach((btn, k) => {
        items.push(...buttonItems(x + g.cx, ys[k], g.rOut, ringOf(g.base), chordButtonName(btn.row, btn.spelling), glyphs, btn.note.id));
      });
      if (e.buttons.length && e.showBadges !== false) {
        const far = ys[ys.length - 1];
        e.buttons.forEach((btn, k) => {
          const d = g.rOut + BADGE_R_CHORD + k * (2 * BADGE_R_CHORD + BADGE_GAP);
          items.push(...badgeItems(x + g.cx, above ? far + d : far - d, BADGE_R_CHORD, buttonBadge(btn.row, btn.spelling, e.system), btn.note.id));
        });
      }
      // points de prolongation : à droite de ce qui dépasse le plus, à la hauteur de chaque élément
      if (g.dots) {
        const dotYs = [...e.bass.map((b) => (Number.isInteger(b.y) ? b.y + 0.5 : b.y)), ...ys];
        for (const y of dotYs) for (let d = 0; d < g.dots; d++) items.push({ kind: 'glyph', name: 'augmentationDot', x: x + g.right + DOT_NOTE_DISTANCE + d * DOT_DOT_DISTANCE, y, role: 'dot', ref });
      }
      const allY = [...e.bass.map((b) => b.y), ...ys];
      const upStem = !!stem?.up;
      // extent of the chord for the marks: the buttons and their badges reach beyond `ys` (outward from the staff)
      let hiMark = Math.max(...allY);
      let loMark = Math.min(...allY);
      if (e.buttons.length) {
        const reach = g.rOut + (e.showBadges !== false ? e.buttons.length * (2 * BADGE_R_CHORD + BADGE_GAP) : 0);
        if (above) hiMark = Math.max(hiMark, ys[ys.length - 1] + reach); else loMark = Math.min(loMark, ys[ys.length - 1] - reach);
      }
      e.accExtent = { hi: hiMark, lo: loMark, stemUp: upStem, cx: g.hasBass ? g.headW / 2 : g.cx, tip };
      const arts = [...(getProperty(e.item, PID.ARTICULATIONS) ?? [])];
      let artItems = null;
      if (arts.length) {
        artItems = articulationItems(arts, {
          ys: [hiMark, loMark], stemUp: upStem, stemTip: tip, headWidth: g.hasBass ? g.headW : 2 * g.rOut, x: g.hasBass ? x : x + g.cx - g.rOut,
          voice: e.voice ?? 0, glyphs, itemId: ref, topLineY: 4,
        });
        items.push(...artItems);
      }
      const dynamic = getProperty(e.item, PID.DYNAMIC);
      if (dynamic) {
        items.push(...dynamicItems(dynamic, {
          ys: [hiMark, loMark], stemUp: upStem, stemTip: tip, headWidth: g.hasBass ? g.headW : 2 * g.rOut, x: g.hasBass ? x : x + g.cx - g.rOut,
          itemId: ref, glyphs, hasLyrics: false, chordBounds: artItems ? artItems.bounds : null, staffTop: 4, text: getProperty(e.item, PID.DYNAMIC_TEXT),
        }));
      }
      extents.push({
        hi: Math.max(upStem ? tip : -Infinity, ...allY) + 1, lo: Math.min(upStem ? Infinity : tip ?? Infinity, ...allY) - 0.5, up: stem ? (upStem ? 1 : -1) : 0,
        geom: { left: x, right: x + g.right, stemX: stem ? stem.x : null, stemDir: upStem ? 1 : -1, stemWidth: thickness },
      });
    });

    // --- n-olets ---
    const entriesList = placed.map((p) => p.entry);
    for (const idx of byVoice.values()) {
      const list = idx.map((i) => entriesList[i]);
      for (const g of tupletGroups(list)) {
        const sameAsBeam = false;
        items.push(...tupletItems({ ...g, indices: g.indices.map((k) => k) }, idx.map((i) => placed[i].x), idx.map((i) => extents[i]), sameAsBeam, { glyphs, thickness }));
      }
    }
    return items;
  },
};

/** Badge « rang/position » : cercle blanc à contour noir et texte noir (lisible en monochrome). */
export function badgeItems(cx, cy, r, text, ref) {
  return [
    { kind: 'circle', role: 'badge', cx, cy, r, fill: '#ffffff', stroke: 'ink', strokeWidth: 0.12, ref },
    { kind: 'text', role: 'badge', x: cx, y: cy, text, size: r * 0.8, family: 'sans-serif', weight: 700, anchor: 'middle', central: true, color: BUTTON_TEXT, ref }, // the disc is always white: the text keeps a dark colour on the dark theme too
  ];
}

/** Bouton d'accord : anneau selon la durée, corps en relief, nom (lettres en texte, ♯ ♭ ° en glyphes Bravura). */
export function buttonItems(cx, cy, rOut, ring, name, glyphs, ref) {
  const items = [];
  if (ring === 'filled') items.push({ kind: 'circle', role: 'accordion-ring', cx, cy, r: rOut, fill: RING_FILL, ref });
  else if (ring === 'double') items.push({ kind: 'circle', role: 'accordion-ring', cx, cy, r: rOut, fill: 'none', stroke: RING_COLOR, strokeWidth: 0.13, ref });
  items.push({ kind: 'circle', role: 'accordion-button', cx, cy, r: BUTTON_R, fill: 'gradient:accButtonShine', stroke: BUTTON_STROKE, strokeWidth: 0.15, ref });
  // nom : suite de morceaux centrée sur le bouton
  const len = name.letter.length + (name.accidental ? 1 : 0) + name.suffix.length + (name.diminished ? 1 : 0);
  const size = len <= 2 ? 1.1 : len === 3 ? 0.95 : 0.85;
  const capW = 0.76 * size;
  const accMag = size * 0.45;
  const pieces = [{ text: name.letter, w: capW }];
  if (name.accidental) pieces.push({ glyph: name.accidental, mag: accMag, w: glyphWidth(glyphs, name.accidental) * accMag + 0.06 });
  if (name.suffix) pieces.push({ text: name.suffix, w: (name.suffix === 'm' ? 0.95 : 0.62) * size });
  if (name.diminished) pieces.push({ glyph: 'csymDiminished', mag: size * 0.3, w: glyphWidth(glyphs, 'csymDiminished') * size * 0.3 });
  const total = pieces.reduce((s, p) => s + p.w, 0);
  let x = cx - total / 2;
  const baseline = cy - 0.36 * size; // pied des capitales (centrées sur cy)
  for (const p of pieces) {
    if (p.text) items.push({ kind: 'text', role: 'accordion-name', x, y: cy, text: p.text, size, family: 'sans-serif', weight: 700, anchor: 'start', central: true, color: BUTTON_TEXT, ref });
    else if (p.glyph === 'csymDiminished') items.push({ kind: 'glyph', name: p.glyph, x, y: baseline + 0.72 * size - 1.892 * p.mag, mag: p.mag, role: 'accordion-name', color: BUTTON_TEXT, ref });
    else items.push({ kind: 'glyph', name: p.glyph, x, y: baseline + 0.4 * size, mag: p.mag, role: 'accordion-name', color: BUTTON_TEXT, ref });
    x += p.w;
  }
  return items;
}
