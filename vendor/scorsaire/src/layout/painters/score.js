/*
 * Peintre « score » (portée standard à 5 lignes). Tranche 1 : clé, armure, chiffrage, têtes, hampes, silences.
 * Tranche 2a : altérations (dérivées de l'armure et des notes précédentes de la mesure), lignes supplémentaires, point
 * d'attache et longueur réelle des hampes, crochets isolés. 2b : ligatures et n-olets. 2c : têtes en seconde (règle de
 * MuseScore), plusieurs voix (hampes par voix, silences décalés). Tranche 3 : articulations (PID.ARTICULATIONS d'un
 * accord, voir ../articulations.js — port de ChordLayout::layoutArticulations/2 de MuseScore). Limites : accord :
 * toutes les altérations au même x (simplification du prototype, sans empilement) ; collisions de têtes ENTRE voix
 * (unisson, seconde) non traitées ; articulations centrées sur la colonne, pas sur une tête décalée en seconde.
 */
import { PID, SID, getProperty, isVocalInstrument, isPercussionType } from '../../model/index.js';
import { CLEF_DEFS } from '../constants.js';
import { fCmp, fAdd } from '../../model/fraction.js';
import { barlineFootprint } from '../barlines.js';
import { headGlyph, noteHeadGlyph, accidentalPad, chordYs, mirrorOverlap, headOffsets, FLAG } from '../chordgeom.js';
import { writtenChord } from '../transposed.js';
import { stemXFor } from '../glyphmetrics.js';
import { stemTipY } from '../stemlength.js';
import { buildBeamGroups, groupDirection, beamGroupLine, beamItems, beamCountOf, beamedRestShift } from '../beaming.js';
import { restInterruptions } from '../beamgroups.js';
import { tupletGroups, tupletItems } from '../tuplets.js';
import { resolveRests } from '../restclear.js';
import { scoreParentheses, hasParentheses, parenthesisOutside } from '../parentheses.js';
import { resolveAccidentals, userAccidentals } from '../accidentals.js';
import { stackAccidentals } from '../accidentalcolumns.js';
import { gracesOf, layoutGraceGroup, graceGroupItems, typedBoxes } from '../gracenotes.js';
import { ACCIDENTAL_PAD, LEDGER_HEAD_WIDTH, SHORT_REST_EXTRA, SMALL_CLEF_MAG, CLEF_CHANGE_GAP } from '../constants.js';
import { noteSpace, entrySpace } from '../spacing.js';
import { glyphItem, glyphWidth, clefChangeExtraWidth } from '../header.js';
import { articulationItems } from '../articulations.js';
import { tappingEntry } from '../tapping.js';
import { scoreArpeggio } from '../scorearpeggio.js';
import { chordLineLayout } from '../chordline.js';
import { chordDotItems, restDotItems, DOT_NOTE_DISTANCE, DOT_DOT_DISTANCE } from '../scoredots.js';
import { layoutChordGroup } from '../chordvoices.js';
import { rightHalfPolygon, tabSlurItems, adjustTieY } from '../tabspanners.js';
import { adjustEndpointY } from '../slurcollide.js';
import { hookMetrics, singleTremoloItems } from '../tremolo.js';
import { writtenBaseOfPair, pairStemUp, twoChordTremoloLayout, insetTremoloItems, computeAutoStemDirection } from '../tremolotwo.js';
import { dynamicItems } from '../dynamics.js';
import {
  resolveStaffHairpins, spannerSegmentType, hairpinY, hairpinWedgeLines, HAIRPIN_LINE_WIDTH,
} from '../hairpins.js';
import {
  resolveStaffTies, tieDirection, tieShoulderHeight, TIE_SHOULDER_W, TIE_MID_WIDTH, TIE_HORIZONTAL_INSET, TIE_VERTICAL_GAP,
} from '../ties.js';
import {
  resolveStaffSlurs, slurUp, slurEndpointY, extendByRange, slurShoulderWidth, slurShoulderHeight,
  SLUR_MID_WIDTH, SLUR_HORIZONTAL_INSET, SLUR_REST_BELOW, SLUR_STAFF_TOP, SLUR_REST_ABOVE_GAP,
} from '../slurs.js';
import { curveItem } from '../slurtie.js';
import {
  resolveStaffGlissandos, glissandoProps, boxesFromItems, glissandoAnchors, glissandoSegments, glissandoSegmentItems,
  glissandoMinPadding, LINE_END_TO_BARLINE, HEADER_TO_LINE_START,
} from '../glissandos.js';
import { lineStack, clefKeyOf, staffLineCount, sequentialEntries, restGlyphName, restGlyphAt, restX, hideIfInvisible } from './common.js';
import { systemSpan } from './systemspan.js';
import { staffRunArrivalIds, staffHasLyrics, staffAbove, staffHairpins, staffTies, staffSlurs, staffHopos, staffSlurDirections, staffGlissandos, staffRunGlissandos, staffTwoChordTremolos } from './resolved.js';
import { hopoLetter } from '../hopos.js';
import { tabTechLineItems } from '../techlines.js';
import { pedalItems } from '../pedaldisplay.js';
import { trillLineItems, signAccidentals } from '../trilllines.js';
import { cueNoteItems } from '../cuenote.js';
import { staffTextItems } from '../stafftexts.js';
import { staffTextEntryItems } from '../stafftextentries.js';
import { lyricsItems } from '../lyrics.js';
import { stickingItems, staffHasSticking } from '../sticking.js';
import { fingeringItems, staffHasFingering, lhFingeringLead } from '../fingering.js';
import { scoreBendItems, ghostGraceNoteIds } from '../scorebends.js';
import { scoreWheelItems } from '../scorewheels.js';
import { TEXT_SIZE } from '../glissandos.js';
import { crossRoutes } from '../crossstaff.js';
import { crossBeamUp } from '../crossbeam.js';

/**
 * Têtes de note : en percussion (`entry.drum`, voir ../drumpos.js) la tête vient de la percmap, note par note ; l'accord prend la plus large
 * pour ses largeurs (têtes décalées en seconde, hampe, points). Sinon : tête de la valeur écrite, ou groupe propre à la note (étouffée, harmonique).
 */
function chordHead(entry, base) {
  return entry.drum ? entry.drum.chordHead(entry.item, base) : headGlyph(base);
}
function headOf(entry, note, base) {
  return entry.drum ? entry.drum.noteHead(note, base) : noteHeadGlyph(base, note, getProperty);
}


/**
 * Décalage x de chaque tête d'un accord (relatif à l'origine de l'accord) : `entry.vx` (plusieurs voix au même instant, ../chordvoices.js) ou, pour
 * un accord seul, `headOffsets` (têtes en seconde). Avec `vx`, l'origine de l'accord (`x` passé aux fonctions de dessin) inclut déjà `vx.moveX`.
 */
function headDx(entry, ys, up, headW, base, style) {
  if (entry.vx) return entry.item.notes.map((n) => entry.vx.notes.get(n.id).x);
  return headOffsets(ys, up, headW, mirrorOverlap(base, style));
}


/**
 * Where the accidentals of a chord go (x of the glyph origin, from the chord origin, by note id): each one clears every head it overlaps and the ones that overlap each other
 * are stacked in columns (`accidentalcolumns.js`). `dx`: x of every head from the same origin. null when the chord has no accidental.
 */
function chordAccidentalOffsets(entry, ctx, ys, dx, headW) {
  const notes = [];
  entry.item.notes.forEach((note, i) => {
    const glyph = entry.accidentals.get(note.id);
    if (!glyph) return;
    const paren = hasParentheses(note, getProperty, PID) ? parenthesisOutside(1.5, false) : 0;
    notes.push({ id: note.id, glyph, y: ys[i], x: dx[i], pad: accidentalPad(ys[i], ctx.style, entry.lines ?? 5) + paren });
  });
  if (!notes.length) return null;
  const G = ctx.glyphs.glyphs;
  const head = G[chordHead(entry, notatedBase(entry))]?.bbox;
  const headHalf = head ? (head.bBoxNE[1] - head.bBoxSW[1]) / 2 : 0.5;
  return stackAccidentals({
    notes, heads: ys.map((y, i) => ({ x1: dx[i], x2: dx[i] + headW, y })), headHalf,
    box: (g) => ({ l: G[g].bbox.bBoxSW[0], r: G[g].bbox.bBoxNE[0], t: G[g].bbox.bBoxNE[1], b: G[g].bbox.bBoxSW[1] }),
  });
}

/** Valeur ÉCRITE d'un accord : sa durée réelle, sauf dans un trémolo à deux accords (le double, voir tremolotwo.js). */
function notatedBase(entry) {
  return entry.tremoloPair ? entry.tremoloPair.writtenBase : getProperty(entry.item, PID.DURATION).base;
}

// Gain approximatif entre la dernière note d'un soufflet et sa pointe (le prototype de Jean n'a pas encore de vrai
// évitement soufflet/nuance — voir hairpins.js, limites) : reprise directe du prototype (`itemWidth(...) * 0.6`),
// approximée ici par une constante fixe (~0,6 × largeur d'une tête noire) plutôt que de recalculer une largeur réelle.
const HAIRPIN_END_GAP = 0.7;
const RUN_LINE_LEAD = 2.6; // room kept on the left of the arrival of an organ glissando run: the length of its line, in staff spaces
/** Demi-hauteur (sp) de la boîte d'un silence qui sert de borne à une liaison. */
const REST_BOUND_HALF_HEIGHT = 0.9;

/** y d'un silence : ligne du milieu ; avec plusieurs voix, voix 1/3 relevé, voix 2/4 abaissé (prototype : 3 et 1). */
function restY(entry) {
  // `RestLayout::layoutRest` : ligne naturelle + décalage de voix (`computeVoiceOffset`) + décalage de ronde (`computeWholeOrBreveRestOffset`),
  // en lignes depuis le HAUT ; ici y vers le haut depuis la ligne du bas (portée de 5 lignes)
  const voiceOffset = entry.multiVoice ? (entry.voice % 2 === 0 ? -1 : 1) : 0;
  const base = entry.item.type === 'rest' && entry.item.props ? getProperty(entry.item, PID.DURATION).base : null;
  const whole = base === 'whole' || base === 'measure';
  const lines = entry.lines ?? 5;
  // `computeNaturalLine` : ligne du milieu ; 1 ligne → la ligne même, 2 lignes → la ligne du bas, 4 lignes → la 3e
  const natural = lines % 2 ? Math.floor(lines / 2) : Math.ceil(lines / 2);
  // `computeWholeOrBreveRestOffset` : une ligne plus haut (la ronde pend de la ligne), sauf sur une portée à 1 ligne seule dans sa voix
  const moveToLineAbove = lines > 5 || ((lines > 1 || voiceOffset === -1 || voiceOffset === 2) && !(voiceOffset === -2 || voiceOffset === 1));
  const wholeMove = whole && moveToLineAbove ? -1 : 0;
  return ((lines - 1) - (natural + voiceOffset + wholeMove)) + (entry.restDy ?? 0);
}

/**
 * Écarte les silences des accords et des autres silences des autres voix (`restclear.js`, port de `resolveRestVSChord` / `resolveRestVSRest`) :
 * pose `entry.restDy` (décalage vertical par pas de lignes) sur chaque silence concerné. Formes d'accord : têtes, lignes supplémentaires, hampe
 * sans ligature (comme à l'étape de MuseScore où ces conflits sont résolus).
 */
function resolveRestConflicts(placed, ctx) {
  const { glyphs, style } = ctx;
  const thickness = style(SID.STEM_THICKNESS);
  if (!placed.some((p) => p.entry.item.type === 'rest' && p.entry.multiVoice)) return;
  const elements = [];
  const byId = new Map();
  for (const p of placed) {
    const e = p.entry;
    e.restDy = 0;
    const end = fAdd(e.position, e.duration);
    if (e.item.type === 'rest' && getProperty(e.item, PID.GAP) === true) continue; // un trou ne se déplace ni ne déplace rien
    if (e.item.type === 'rest') {
      const base = getProperty(e.item, PID.DURATION).base;
      const name = restGlyphName(base);
      const bb = glyphs.glyphs[name].bbox;
      const rx = restX(e, p.x, ctx, glyphWidth(glyphs, name));
      byId.set(e.item.id, e);
      const nLines = e.lines ?? 5;
      const boxOf = (gn) => { const g = glyphs.glyphs[gn].bbox; return { l: rx + g.bBoxSW[0], r: rx + g.bBoxNE[0], b: g.bBoxSW[1], t: g.bBoxNE[1] }; };
      const y0 = restY(e);
      elements.push({
        kind: 'rest', id: e.item.id, voice: e.voice, pos: e.position, y: y0,
        box: boxOf(restGlyphAt(base, y0, nLines)),
        // ronde / blanche : le glyphe (donc la boîte) change avec la ligne où le silence tombe (`updateSymbol`)
        boxAt: base === 'whole' || base === 'half' || base === 'measure' ? (y) => boxOf(restGlyphAt(base, y, nLines)) : null,
        wholeOrHalf: base === 'whole' || base === 'half', full: base === 'measure',
      });
      continue;
    }
    const ys = chordYs(e.item, e.clefKey, e.keySig);
    const base = notatedBase(e);
    const rects = [];
    const sortedHeads = e.item.notes.map((n, k) => ({ y: ys[k], head: headOf(e, n, base) }));
    for (const h of sortedHeads) {
      const bb = glyphs.glyphs[h.head].bbox;
      rects.push({ l: p.x + bb.bBoxSW[0], r: p.x + bb.bBoxNE[0], b: h.y + bb.bBoxSW[1], t: h.y + bb.bBoxNE[1] });
    }
    const headW = glyphWidth(glyphs, chordHead(e, base));
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const topLine = (e.lines ?? 5) - 1; // y de la ligne du haut
    for (let y = -1; y >= Math.round(lo) && lo <= -1; y--) rects.push({ l: p.x - 0.4, r: p.x + headW + 0.4, b: y - 0.08, t: y + 0.08 });
    for (let y = topLine + 1; y <= Math.round(hi) && hi >= topLine + 1; y++) rects.push({ l: p.x - 0.4, r: p.x + headW + 0.4, b: y - 0.08, t: y + 0.08 });
    const stem = stemInfo(ys, base, e.stemUp, null, style, e.tremoloPair ? null : getProperty(e.item, PID.TREMOLO), glyphs, stemGeom(e, ys, base, glyphs));
    if (stem) {
      const sx = stemXFor(glyphs, p.x, e.stemUp, thickness, chordHead(e, base));
      rects.push(e.stemUp ? { l: sx - thickness / 2, r: sx + thickness / 2, b: lo, t: stem.tip } : { l: sx - thickness / 2, r: sx + thickness / 2, b: stem.tip, t: hi });
    }
    const topK = ys.indexOf(hi);
    const botK = ys.indexOf(lo);
    const hb = (k) => glyphs.glyphs[sortedHeads[k].head].bbox;
    elements.push({
      kind: 'chord', voice: e.voice, pos: e.position, end, rects,
      top: { b: hi + hb(topK).bBoxSW[1], t: hi + hb(topK).bBoxNE[1] },
      bottom: { b: lo + hb(botK).bBoxSW[1], t: lo + hb(botK).bBoxNE[1] },
    });
  }
  // groupes d'alignement (`RestLayout::computeRestGroups` / `computeInterruptionPoints`) : par voix, les silences entre deux débuts de groupe
  const groups = [];
  const voices = new Map();
  for (const p of placed) {
    if (!voices.has(p.entry.voice)) voices.set(p.entry.voice, []);
    voices.get(p.entry.voice).push(p.entry);
  }
  const mi = ctx.measure.index;
  for (const list of voices.values()) {
    const flags = restInterruptions(list, ctx.timeSigs[mi], ctx.beamGroupings[mi], ctx.offsets[mi], style(SID.BEAM_BY_BEAT));
    const points = [];
    list.forEach((e, k) => {
      if (e.item.type === 'rest' && k > 0 && list[k - 1].item.type === 'rest') return; // silence qui en suit un autre : jamais un point
      if (flags[k]) points.push(e.position);
    });
    const byGroup = new Map();
    for (const e of list) {
      if (e.item.type !== 'rest') continue;
      const g = points.filter((pt) => fCmp(pt, e.position) <= 0).length;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(e.item.id);
    }
    groups.push(...byGroup.values());
  }
  const shifts = resolveRests(elements, { lines: placed[0].entry.lines ?? 5, lineDist: 1, groups });
  for (const [id, dy] of shifts) byId.get(id).restDy = dy;
}

/**
 * Sens par défaut de la hampe d'un accord seul : `ChordLayout::computeUp` → `computeAutoStemDirection` sur les distances des notes
 * à la ligne du milieu (0 : les extrêmes s'annulent jusqu'au bout → vers le bas).
 */
function defaultStemUp(ys, lines = 5) {
  const distances = ys.map((y) => Math.round(2 * (lines - 1) - 2 * y) - (lines - 1)).sort((a, b) => a - b);
  return computeAutoStemDirection(distances) > 0;
}

/**
 * Données de portée et de tête passées à `stemTipY` : nombre de lignes de la portée, et `extraHeight` de `calcDefaultStemLength` = y de
 * l'ancre `stemUpSE` / `stemDownNW` de la tête de la note HAUTE (hampe montante) ou BASSE (descendante) — 0,168 pour la tête noire,
 * davantage pour une croix ou un losange de percussion (hampe minimale plus longue).
 */
function stemGeom(entry, ys, base, glyphs) {
  const lines = entry.lines ?? 5;
  if (!glyphs || !entry.item.notes || !entry.item.notes.length) return { lines };
  const k = ys.indexOf(entry.stemUp ? Math.max(...ys) : Math.min(...ys));
  const anchors = glyphs.glyphs[headOf(entry, entry.item.notes[k], base)]?.anchors;
  const a = anchors ? anchors[entry.stemUp ? 'stemUpSE' : 'stemDownNW'] : null;
  return { lines, headExtra: a ? Math.abs(a[1]) : 0.168 };
}

/**
 * Pointe de la hampe d'un accord (`ys` : positions de ses notes) dans le sens `up` ; `beam` = { tipY } si ligaturé ; null sans hampe.
 * `tremolo` (PID.TREMOLO de l'accord, ou null) allonge la hampe minimale (`calcMinStemLength`, tremolo.js) ; `glyphs` donne les
 * métriques du crochet, nécessaires à ce calcul.
 */
function stemInfo(ys, base, up, beam, style, tremolo = null, glyphs = null, geom = {}) {
  if (base === 'whole' || base === 'breve') return null;
  const top = Math.max(...ys);
  const bottom = Math.min(...ys);
  const hook = !beam && Boolean(FLAG[base]);
  const tip = beam ? beam.tipY : stemTipY({
    up, ys, beams: 0, hook, style, tremolo, hookInfo: tremolo && hook ? hookMetrics(glyphs, base, up) : null, durationBeams: beamCountOf(base), ...geom,
  });
  return { up, tip, top, bottom };
}


/**
 * Une note d'un accord placé : x de sa tête, y, largeur/hauteur de tête, boîtes de la forme de l'accord (`boxesFromItems` sur son propre
 * dessin, sans articulations ni nuances), hauteur (pitch). Sert aux glissandos (../glissandos.js).
 */
function noteAnchorInfo(entry, x, noteId, ctx) {
  const { glyphs } = ctx;
  const { item } = entry;
  const ys = chordYs(item, entry.clefKey ?? clefKeyOf(ctx.staff), entry.keySig);
  const base = notatedBase(entry);
  const head = chordHead(entry, base);
  const headW = glyphWidth(glyphs, head);
  const dx = headDx(entry, ys, entry.stemUp, headW, base, ctx.style);
  const i = item.notes.findIndex((n) => n.id === noteId);
  if (i < 0) return null;
  // ligaturé : pas de crochet ; seule la position horizontale de la hampe compte ici (elle affleure la tête), pas sa pointe
  const beam = entry.beamed ? { tipY: entry.stemUp ? Math.max(...ys) + 3.5 : Math.min(...ys) - 3.5 } : null;
  const boxes = boxesFromItems(paintItem(entry, x, ctx, beam), glyphs, { beamed: Boolean(entry.beamed) });
  const bb = glyphs.glyphs[head].bbox;
  return {
    x: x + dx[i], y: ys[i], headW, headTop: ys[i] + bb.bBoxNE[1], headBottom: ys[i] + bb.bBoxSW[1], boxes, pitch: item.notes[i].pitch,
  };
}

/**
 * Largeur minimale d'un glissando entre deux colonnes ADJACENTES de la même voix et de la même mesure (`horizontalspacing.cpp`) :
 * ajoutée à `entry.glissandoPad` de l'accord de départ. Limite assumée : pas de réserve quand le glissando traverse une barre.
 */
function addGlissandoPadding(entries, staff, ctx) {
  const glis = staffGlissandos(ctx, staff);
  if (!glis.length) return;
  for (const g of glis) {
    const a = entries.find((e) => e.item.id === g.start.chordId);
    if (!a) continue;
    const list = entries.filter((e) => e.voice === a.voice);
    const b = list[list.indexOf(a) + 1];
    if (!b || b.item.id !== g.end.chordId) continue;
    // une autre voix attaquant entre les deux colonnes : la distance n'est plus celle de deux colonnes voisines
    if (entries.some((e) => e.voice !== a.voice && fCmp(e.position, a.position) > 0 && fCmp(e.position, b.position) < 0)) continue;
    const sInfo = noteAnchorInfo(a, 0, g.startNoteId, ctx);
    const eInfo = noteAnchorInfo(b, 0, g.endNoteId, ctx);
    if (!sInfo || !eInfo) continue;
    const sameLine = Math.abs(sInfo.y - eInfo.y) < 1e-9;
    const own = glissandoAnchors({ start: sInfo, end: eInfo, sameLine }); // chaque accroche relative à l'origine de SON accord
    // distance des origines de têtes : espace de la colonne de départ, plus la réserve à gauche de l'arrivée
    eInfo.x += noteSpace(a.duration, ctx.style) + scorePainter.lead(b, ctx);
    const anchors = glissandoAnchors({ start: sInfo, end: eInfo, sameLine });
    const { wavy } = glissandoProps(g, ctx.style);
    a.glissandoPad = Math.max(a.glissandoPad ?? 0, glissandoMinPadding(anchors, wavy, ctx.style));
    // espacement par formes : points d'accroche de la ligne (`lineAttachPoints`), x relatifs à l'origine de chaque accord
    const kind = wavy ? 'glissando-wavy' : 'glissando-straight';
    (a.lineAttach ??= new Map()).set(g.startNoteId, [...(a.lineAttach.get(g.startNoteId) ?? []), { line: g.id, kind, x: own.sx }]);
    (b.lineAttach ??= new Map()).set(g.endNoteId, [...(b.lineAttach.get(g.endNoteId) ?? []), { line: g.id, kind, x: own.ex }]);
  }
}

/**
 * Premier passage d'une ligature croisée (crossbeam.js) : fixe la hampe PROVISOIRE de chaque accord (longueur par défaut, dans le sens
 * « sous la ligature → montante ») et décrit le groupe pour le second passage (`layout/index.js`), qui connaît la distance entre les deux
 * portées. Les éléments dépendant de la pointe de hampe (articulations, nuances, liaisons) gardent cette pointe provisoire : limite connue.
 * @returns { id, members, upper, lower (rangs de portée du système), minSpace }
 */
function crossGroupRecord(group, list, ctx, beamOf) {
  const { glyphs, style } = ctx;
  const thickness = style(SID.STEM_THICKNESS);
  const beamUp = crossBeamUp(group.map((i) => list[i].entry.crossMember));
  const members = group.map((i, gk) => {
    const e = list[i].entry;
    const cm = e.crossMember;
    const base = notatedBase(e);
    const beams = beamCountOf(base);
    const common = { id: e.item.id, lower: cm.lower, move: cm.move, staffIndex: cm.staffIndex, beams, info: group.infos[gk], dflt: group.defaults[gk] };
    e.slurBeam = { first: gk === 0, last: gk === group.length - 1, up: e.item.type === 'rest' ? beamUp : cm.lower }; // relu par les liaisons
    if (e.item.type === 'rest') {
      // silence ligaturé : ancrage = bord droit du glyphe (ligature « montante ») ou gauche (`chordBeamAnchorX`, silences)
      const rn = restGlyphName(base);
      const rx = restX(e, list[i].x, ctx, glyphWidth(glyphs, rn));
      return { ...common, rest: true, x: beamUp ? rx + glyphWidth(glyphs, rn) : rx };
    }
    const ys = chordYs(e.item, e.clefKey, e.keySig);
    const up = cm.lower;
    const pairStrokes = e.tremoloPair ? e.tremoloPair.strokes : 0;
    const nLines = e.lines ?? 5;
    const tip = stemTipY({
      up, ys, beams: beams + pairStrokes, hook: false, style,
      tremolo: e.tremoloPair ? null : getProperty(e.item, PID.TREMOLO), durationBeams: beams,
      ...stemGeom({ ...e, stemUp: up }, ys, base, glyphs),
    });
    beamOf.set(i, { tipY: tip });
    const farUp = up ? Math.min(...ys) : Math.max(...ys);
    return {
      ...common, lines: nLines, x: stemXFor(glyphs, list[i].x, up, thickness, chordHead(e, base)),
      // repère de SA portée, y vers le BAS depuis sa ligne du haut (crossbeam.js)
      ms: {
        farY: nLines - 1 - farUp, len: Math.abs(tip - farUp),
        upLine: Math.round(2 * (nLines - 1) - 2 * Math.max(...ys)), downLine: Math.round(2 * (nLines - 1) - 2 * Math.min(...ys)),
        topY: nLines - 1 - Math.max(...ys), bottomY: nLines - 1 - Math.min(...ys), strokes: beams + pairStrokes,
      },
    };
  });
  const upper = members.find((m) => !m.lower)?.staffIndex;
  const lower = members.find((m) => m.lower)?.staffIndex;
  return { id: members.find((m) => !m.rest)?.id ?? members[0].id, members, upper, lower, beamUp };
}

export const scorePainter = {
  name: 'score',
  lines: (staff, ctx) => lineStack(staffLineCount(staff), ctx.style(SID.STAFF_LINE_THICKNESS)),
  /** Clé de tête de système : celle en vigueur au tout début de `mi` (défaut : la mesure 0), changements compris. */
  clef(staff, ctx, mi = 0) {
    const key = ctx && ctx.clefAtMeasureStart ? ctx.clefAtMeasureStart(mi) : clefKeyOf(staff);
    return { glyph: CLEF_DEFS[key].glyph, y: CLEF_DEFS[key].musicY, key };
  },
  keySig: (staff, ctx, mi = 0) => ({ clefKey: ctx && ctx.clefAtMeasureStart ? ctx.clefAtMeasureStart(mi) : clefKeyOf(staff) }),
  /** Chiffrage centré sur la portée (`TimeSig` : 5 lignes → 3 et 1, 1 ligne → 1 et −1…). */
  timeSig: (staff) => { const c = (staffLineCount(staff) - 1) / 2; return { yNum: c + 1, yDen: c - 1 }; },

  /** Éléments de la mesure, chacun avec les altérations à afficher pour ses notes (`accidentals`: id de note → glyphe). */
  entries(staff, mi, ctx) {
    return buildEntries(staff, mi, ctx, null);
  },

  /** Place à gauche de la tête : petite clé insérée avant elle (si présente) + la plus large altération de l'accord + sa marge. */
  lead(entry, ctx) {
    const { item } = entry;
    const clefLead = entry.clefBefore ? clefChangeExtraWidth(ctx.glyphs, entry.clefBefore) : 0;
    const graceLead = entry.graceLayout ? -entry.graceLayout.left : 0; // groupe d'ornements à gauche de la tête (gracenotes.js)
    if (item.type !== 'chord') return Math.max(clefLead, graceLead);
    const clefKey = entry.clefKey ?? clefKeyOf(ctx.staff);
    const ys = chordYs(item, clefKey, entry.keySig);
    const headW = glyphWidth(ctx.glyphs, chordHead(entry, notatedBase(entry)));
    const moveX = entry.vx ? entry.vx.moveX : 0; // l'origine de l'accord est déjà décalée de `moveX` : la réserve à gauche en tient compte
    const dx = headDx(entry, ys, entry.stemUp, headW, notatedBase(entry), ctx.style).map((d) => d + moveX);
    let lead = Math.max(0, ...dx.map((d) => -d)); // tête décalée à gauche : elle empiète à gauche de la colonne
    const offsets = chordAccidentalOffsets(entry, ctx, ys, dx, headW);
    item.notes.forEach((note, i) => {
      const name = entry.accidentals.get(note.id);
      const paren = hasParentheses(note, getProperty, PID) ? parenthesisOutside(1.5, false) : 0; // parenthèse gauche : entre l'altération et la tête
      const placed = name ? offsets?.get(note.id) : null;
      if (typeof placed === 'number') lead = Math.max(lead, -placed);
      else if (name) lead = Math.max(lead, -Math.min(dx[i], 0) + glyphWidth(ctx.glyphs, name) + accidentalPad(ys[i], ctx.style, entry.lines ?? 5) + paren);
      else if (paren) lead = Math.max(lead, -Math.min(dx[i], 0) + paren);
    });
    const arp = chordArpeggio(entry, ctx, 0, ys, dx);
    if (arp) lead = Math.max(lead, arp.extent); // `lll + largeur de l'arpège + écart` (layoutChords3)
    if (getProperty(item, PID.CHORD_LINE)) { paintItem(entry, 0, ctx, null); if (entry.chordLineBox) lead = Math.max(lead, -entry.chordLineBox.left); } // la boîte d'une slide agrandit `spaceLw`
    lead = Math.max(lead, lhFingeringLead(item, ctx)); // doigtés de main gauche : dans la forme de la note (`fillNoteShape`)
    if (ctx.staff && ctx.memo && staffRunArrivalIds(ctx, ctx.staff).has(item.id)) lead += RUN_LINE_LEAD; // the line of an organ glissando run comes in from the left: its room is kept
    return Math.max(clefLead + lead, graceLead);
  },

  /** Room kept on the left by the SHAPE spacing (a phantom box): only the arrival of a glissando run, whose line comes in from the left. */
  leftReserve(entry, ctx) {
    return entry.item.type === 'chord' && ctx.staff && ctx.memo && staffRunArrivalIds(ctx, ctx.staff).has(entry.item.id) ? this.lead(entry, ctx) : 0;
  },

  itemWidth(entry, ctx) {
    let w = entrySpace(entry, ctx.style);
    if (entry.item.type === 'rest') {
      const base = getProperty(entry.item, PID.DURATION).base;
      if (base === 'sixteenth' || base === 'thirtysecond') w += SHORT_REST_EXTRA;
    }
    // ornements « après » en fin de mesure : le groupe se pose contre la barre, il lui faut de la place avant elle
    const trail = entry.graceTrailLayout ? -entry.graceTrailLayout.left : 0;
    const parenRight = entry.item.type === 'chord' && entry.item.notes.some((n) => hasParentheses(n, getProperty, PID)) ? parenthesisOutside(1.5, false) : 0;
    if (entry.vx) { // accord décalé vers la droite (unisson, seconde) : sa tête dépasse la largeur nominale d'une tête
      const hw = glyphWidth(ctx.glyphs, 'noteheadBlack');
      let right = 0;
      for (const n of entry.item.notes) right = Math.max(right, entry.vx.notes.get(n.id).x + glyphWidth(ctx.glyphs, headOf(entry, n, notatedBase(entry))));
      w += Math.max(0, entry.vx.moveX + right - hw);
    }
    if (getProperty(entry.item, PID.DURATION)?.dots > 0) { paintItem(entry, 0, ctx, null); if (entry.dotsRight != null) w = Math.max(w, entry.dotsRight + 0.4); } // `spaceRw` : points
    if (entry.item.type === 'chord' && getProperty(entry.item, PID.CHORD_LINE)) { paintItem(entry, 0, ctx, null); if (entry.chordLineBox) w = Math.max(w, entry.chordLineBox.right + 0.3); } // `spaceRw`
    return w + this.lead(entry, ctx) + (entry.glissandoPad ?? 0) + trail + parenRight;
  },

  /** Élément seul (sans ligature ni n-olet) : sert aux peintres qui n'ont pas de `paintMeasure`, et aux tests. */
  paintEntry(entry, x, ctx) {
    return paintItem(entry, x, ctx, null);
  },

  /**
   * Mesure entière d'une portée, une fois les x connus : ligatures et n-olets ont besoin des positions de tout le groupe.
   * @param placed  [{ entry, x }] dans l'ordre des colonnes
   */
  paintMeasure(placed, ctx) {
    const { glyphs, style } = ctx;
    const mi = ctx.measure.index;
    const thickness = style(SID.STEM_THICKNESS);
    const mainItems = [];
    resolveRestConflicts(placed.filter((p) => !p.entry.relocated), ctx);
    const crossItems = []; // dessin des accords relocalisés sur une autre portée (portées croisées) : versé dans la portée cible par index.js
    const crossBeams = []; // ligatures croisées de la mesure : enregistrées ici, posées par le second passage de `layout/index.js`
    const sinkTo = (to) => { // liste d'éléments d'une portée cible, pour les membres relocalisés d'une ligature croisée
      let sink = crossItems.find((c) => c.cross && c.to === to);
      if (!sink) { sink = { to, items: [], cross: true }; crossItems.push(sink); }
      return sink.items;
    };
    // listes à ligaturer : chaque VOIX de la portée (les accords relocalisés y restent comme séparateurs : ils coupent les ligatures de leurs voisins)
    // + chaque série d'accords relocalisés (« voie » : ils ne se ligaturent qu'avec leurs voisins relocalisés du même côté, sur la portée cible)
    const byVoice = new Map();
    const byLane = new Map();
    for (const p of placed) {
      if (!byVoice.has(p.entry.voice)) byVoice.set(p.entry.voice, []);
      byVoice.get(p.entry.voice).push(p);
      if (p.entry.lane) {
        if (!byLane.has(p.entry.lane)) byLane.set(p.entry.lane, []);
        byLane.get(p.entry.lane).push(p);
      }
    }
    const laneLists = new Set(byLane.values());
    for (const list of [...byVoice.values(), ...byLane.values()]) {
      const lane = laneLists.has(list); // série relocalisée : dessinée dans la portée cible
      let items = mainItems;
      if (lane) { const sink = { to: list[0].entry.shapeStaff, items: [] }; crossItems.push(sink); items = sink.items; }
      // dans la voix d'origine, un accord relocalisé n'est qu'un séparateur ; sauf membre d'une ligature croisée (il reste dans sa voix)
      const skip = (i) => !lane && Boolean(list[i].entry.relocated) && !list[i].entry.crossMember;
      const groups = buildBeamGroups(list.map((p) => p.entry), ctx.timeSigs[mi], ctx.beamGroupings[mi], ctx.offsets[mi], ctx.style(SID.BEAM_BY_BEAT));
      const beamOf = new Map(); // index dans la voix → { up, tipY }
      const lines = new Map();
      const insetPairs = new Set(); // indices des 1ers accords de couples de trémolo insérés dans une ligature
      for (const group of groups) {
        if (skip(group[0])) continue;
        if (group.every((i) => list[i].entry.crossMember)) {
          // ligature croisée : hampes provisoires (longueur par défaut) ; la ligature et les hampes définitives viennent du second passage
          crossBeams.push(crossGroupRecord(group, list, ctx, beamOf));
          continue;
        }
        const ysOf = (i) => chordYs(list[i].entry.item, list[i].entry.clefKey, list[i].entry.keySig);
        const isRest = (i) => list[i].entry.item.type === 'rest';
        const up = list[group.find((i) => !isRest(i))].entry.stemUp;
        const dir = up ? 'up' : 'down';
        const members = group.map((i, gk) => {
          const base = notatedBase(list[i].entry);
          const beams = beamCountOf(base);
          if (isRest(i)) {
            // silence ligaturé : ancrage = bord droit du glyphe (hampes en haut) ou gauche (`chordBeamAnchorX`, silences)
            const rn = restGlyphName(base);
            const rx = restX(list[i].entry, list[i].x, ctx, glyphWidth(glyphs, rn));
            return { x: up ? rx + glyphWidth(glyphs, rn) : rx, rest: true, beams, info: group.infos[gk], dflt: group.defaults[gk] };
          }
          const ys = ysOf(i);
          // accord d'un couple de trémolo ligaturé : ses barres comptent comme des niveaux de ligature (`strokeCount`)
          const pairStrokes = list[i].entry.tremoloPair ? list[i].entry.tremoloPair.strokes : 0;
          const nLines = list[i].entry.lines ?? 5;
          const tip = stemTipY({
            up, ys, beams: beams + pairStrokes, hook: false, style,
            tremolo: list[i].entry.tremoloPair ? null : getProperty(list[i].entry.item, PID.TREMOLO), durationBeams: beams,
            ...stemGeom({ ...list[i].entry, stemUp: up }, ys, notatedBase(list[i].entry), glyphs),
          });
          const farUp = up ? Math.min(...ys) : Math.max(...ys);
          return {
            x: stemXFor(glyphs, list[i].x, up, thickness, chordHead(list[i].entry, notatedBase(list[i].entry))), beams, tip, info: group.infos[gk], dflt: group.defaults[gk],
            // membre de BeamTremoloLayout : longueur par défaut (`Chord::defaultStemLength`) depuis la note du côté opposé
            ms: {
              x: stemXFor(glyphs, list[i].x, up, thickness, chordHead(list[i].entry, notatedBase(list[i].entry))), farY: nLines - 1 - farUp, len: Math.abs(tip - farUp),
              upLine: Math.round(2 * (nLines - 1) - 2 * Math.max(...ys)), downLine: Math.round(2 * (nLines - 1) - 2 * Math.min(...ys)), strokes: beams + pairStrokes,
              attachY: nLines - 1 - farUp - glyphs.glyphs.noteheadBlack.anchors[up ? 'stemUpSE' : 'stemDownNW'][1], ys,
            },
          };
        });
        const nl = list[0].entry.lines ?? 5;
        const line = beamGroupLine(members, up, { beamWidth: style(SID.BEAM_THICKNESS), stemWidth: thickness, staffLines: nl, staffHeight: nl - 1 });
        group.forEach((i, k) => {
          list[i].entry.slurBeam = { first: k === 0, last: k === group.length - 1, up }; // relu par les liaisons (`stemSideForBeam`, `isOverBeams`)
          if (members[k].rest) return;
          beamOf.set(i, { tipY: line.at(members[k].x) });
          lines.set(i, line);
        });
        const beamPolys = beamItems(members, line, dir, { thickness: style(SID.BEAM_THICKNESS), stemWidth: thickness }, list[group[0]].entry.item.id);
        items.push(...beamPolys);
        // silences sous la ligature : écartés des barres (`verticalAdjustBeamedRests`)
        group.forEach((i, k) => {
          if (!members[k].rest) return;
          const e = list[i].entry;
          const rn = restGlyphName(notatedBase(e));
          const g = glyphs.glyphs[rn].bbox;
          const rx = restX(e, list[i].x, ctx, glyphWidth(glyphs, rn));
          const y0 = restY(e);
          const dy = beamedRestShift({
            up, polygons: beamPolys, short: beamCountOf(notatedBase(e)) >= 3, firstRest: k === 0,
            box: { x0: rx, x1: rx + glyphWidth(glyphs, rn), top: y0 + g.bBoxNE[1], bottom: y0 + g.bBoxSW[1] },
          });
          if (dy) beamOf.set(i, { restDy: dy });
        });
        // trémolos « insérés » : couples dont les deux accords sont dans cette ligature (`BeamLayout::setTremAnchors`)
        group.forEach((i, k) => {
          const t = list[i].entry.tremoloPair;
          if (t?.role !== 'first' || group[k + 1] !== i + 1) return;
          insetPairs.add(i);
          items.push(...insetTremoloItems({
            up, strokes: t.strokes, line, x1: members[k].x, x2: members[k + 1].x, regularBeams: members[k].beams,
            beamWidth: style(SID.BEAM_THICKNESS), ref: t.id, staffHeight: nl - 1,
          }));
        });
      }
      // trémolos à deux accords : disposition du couple (ancrages, barres, pointes de hampe — tremolotwo.js)
      list.forEach((p, i) => {
        if (skip(i) || p.entry.tremoloPair?.role !== 'first' || insetPairs.has(i)) return;
        const q = list[i + 1];
        const up = p.entry.stemUp;
        const written = p.entry.tremoloPair.writtenBase;
        const hasStem = written !== 'whole' && written !== 'breve';
        const headW = glyphWidth(glyphs, chordHead(p.entry, written));
        const chordsIn = [p, q].map((c) => ({
          x: hasStem ? stemXFor(glyphs, c.x, up, thickness, chordHead(c.entry, written)) : c.x + (up ? headW : 0),
          ys: chordYs(c.entry.item, c.entry.clefKey, c.entry.keySig),
          hasStem,
        }));
        const laid = twoChordTremoloLayout({ up, strokes: p.entry.tremoloPair.strokes, chords: chordsIn, style, glyphs, ref: p.entry.tremoloPair.id, lines: p.entry.lines ?? 5 });
        items.push(...laid.items);
        laid.tips.forEach((tip, k) => { if (tip !== null) beamOf.set(i + k, { tipY: tip }); });
      });
      list.forEach((p, i) => {
        if (skip(i)) return;
        // membre relocalisé d'une ligature croisée : dessiné dans la portée où il se trouve (liste de la cible), pas dans celle de sa voix
        (p.entry.crossMember && p.entry.relocated ? sinkTo(p.entry.shapeStaff) : items).push(...paintItem(p.entry, p.x, ctx, beamOf.get(i) ?? null));
        const e = p.entry;
        if (e.graceLayout) items.push(...graceGroupItems(e.graceLayout, e.graceList, p.x, { glyphs, style, accidentals: e.accidentals, voice: e.voice, ghosts: ghostGraceNoteIds(ctx, ctx.staff) }));
        if (e.graceTrailLayout) items.push(...graceGroupItems(e.graceTrailLayout, e.graceTrail, ctx.measure.barX, { glyphs, style, accidentals: e.accidentals, voice: e.voice, ghosts: ghostGraceNoteIds(ctx, ctx.staff) }));
      });

      // n-olets : étendue verticale de chaque membre (têtes, pointe de hampe / ligature) et sens de sa hampe
      const xs = list.map((p) => p.x);
      const extents = list.map((p, i) => {
        const { item } = p.entry;
        if (item.type !== 'chord') {
          const rw = glyphWidth(glyphs, restGlyphName(getProperty(item, PID.DURATION).base));
          return { hi: restY(p.entry) + 1, lo: restY(p.entry) - 1, up: 0, geom: { left: p.x, right: p.x + rw, stemX: null, stemDir: 0, stemWidth: thickness } };
        }
        const ys = chordYs(item, p.entry.clefKey, p.entry.keySig);
        const stem = stemInfo(ys, notatedBase(p.entry), p.entry.stemUp, beamOf.get(i) ?? null, style, p.entry.tremoloPair ? null : getProperty(item, PID.TREMOLO), glyphs, stemGeom(p.entry, ys, notatedBase(p.entry), glyphs));
        const hi = Math.max(Math.max(...ys) + 0.5, stem ? stem.tip : -Infinity);
        const lo = Math.min(Math.min(...ys) - 0.5, stem ? stem.tip : Infinity);
        const head = chordHead(p.entry, notatedBase(p.entry));
        const geom = {
          left: p.x, right: p.x + glyphWidth(glyphs, head),
          stemX: stem ? stemXFor(glyphs, p.x, p.entry.stemUp, thickness, head) : null, stemDir: p.entry.stemUp ? 1 : -1, stemWidth: thickness,
        };
        return { hi, lo, up: stem ? (p.entry.stemUp ? 1 : -1) : 0, geom };
      });
      for (const g of tupletGroups(list.map((p) => p.entry))) {
        if (g.indices.every(skip)) continue;
        if (g.indices.some((i) => list[i].entry.crossMember)) continue; // n-olet dans une ligature croisée : non porté (chiffre omis)
        const sameAsBeam = groups.some((bg) => bg.length === g.indices.length && bg.every((v, k) => v === g.indices[k]));
        items.push(...tupletItems(g, xs, extents, sameAsBeam, { glyphs, thickness }));
      }
    }
    mainItems.relocated = crossItems;
    mainItems.crossBeams = crossBeams;
    return mainItems;
  },

  /**
   * Glissandos (tranche 3 — voir ../glissandos.js) : peuvent traverser un retour à la ligne, la hauteur des jonctions s'interpole sur
   * tous les segments, d'où un appel unique après tous les systèmes.
   * @param perSystem  [{ sys, placed }] pour tous les systèmes
   * @returns tableau d'éléments d'affichage par système
   */
  paintSpanners(perSystem, staff, movement, ctx, existing = []) {
    const result = perSystem.map(() => []);
    const runs = staffRunGlissandos(ctx, staff);
    const glis = runs.length ? [...staffGlissandos(ctx, staff), ...runs] : staffGlissandos(ctx, staff); // runs: glissando from an ornament to its arrival note
    // liaisons d'expression (`slurPos` de MuseScore, mêmes règles qu'en tablature : ancrage sur la hampe / la ligature) ; l'ancien chemin de
    // `paintSystemExtra` garde les liaisons partant d'un ornement et les marteaux / arrachés
    // où se trouve chaque accord : { p (placé), k (système) } (une seule table pour les liaisons et pour le reste)
    const where = new Map();
    perSystem.forEach(({ placed }, k) => { for (const p of placed) if (p.entry.item.type === 'chord' || p.entry.item.type === 'rest') where.set(p.entry.item.id, { p, k }); });
    if (staffSlurs(ctx, staff).length) {
      const nl = staffLineCount(staff);
      tabSlurItems({ perSystem, staff, ctx: { ...ctx, staff }, where, result, lines: nl, lineDist: 1, preset: { stems: true, through: true }, score: true });
    }
    // lignes de technique (palm mute, let ring, marque d'harmonique, whammy, vibrato) : mêmes règles qu'en tablature, jamais masquées sur portée
    // (`isHiddenElementOnTab` ne concerne que la tablature) ; rangées EN DERNIER (autoplace contre les éléments déjà dessinés)
    const techAfter = () => {
      if (staffHasFingering(staff)) fingeringItems({ perSystem, staff, ctx: { ...ctx, staff }, result, lines: staffLineCount(staff), lineDist: 1, existing }); // doigtés (6) : avant les lignes de technique (les spanners les évitent)
      trillLineItems({ perSystem, staff, ctx: { ...ctx, staff }, where, result, lines: staffLineCount(staff), lineDist: 1, existing }); // lignes de trille
      tabTechLineItems({ perSystem, staff, ctx: { ...ctx, staff }, where, result, lines: staffLineCount(staff), lineDist: 1, existing });
      pedalItems({ perSystem, staff, movement, ctx: { ...ctx, staff }, result, lines: staffLineCount(staff), lineDist: 1, existing }); // pédales (ancrées par instant), après les autres lignes comme `processLines` de MuseScore
      staffTextItems({ perSystem, staff, ctx: { ...ctx, staff }, result, lines: staffLineCount(staff), lineDist: 1, existing }); // texte du capo / d'accordage (4e), après les autres marques
      staffTextEntryItems({ perSystem, staff, movement, ctx: { ...ctx, staff }, result, lines: staffLineCount(staff), lineDist: 1, existing }); // textes propres à la portée
      if (isPercussionType(getProperty(staff, PID.STAFF_TYPE)) && staffHasSticking(staff)) stickingItems({ perSystem, staff, ctx: { ...ctx, staff }, result, lines: staffLineCount(staff), lineDist: 1, existing }); // sticking (5c)
      if (staffHasLyrics(ctx, staff)) lyricsItems({ perSystem, staff, ctx: { ...ctx, staff }, result, lines: staffLineCount(staff), lineDist: 1, existing }); // paroles : en dernier, sous tout ce que la portée a déjà
    };
    if (!glis.length) {
      scoreBendItems({ perSystem, staff, ctx: { ...ctx, staff }, locate: lazyLocator(() => bendNoteLocator(perSystem, { ...ctx, staff })), result, where });
      scoreWheelItems({ perSystem, staff, ctx: { ...ctx, staff }, locate: lazyLocator(() => bendNoteLocator(perSystem, { ...ctx, staff })), result });
      techAfter();
      return result;
    }
    const spanOf = (k) => systemSpan(perSystem, k);
    const graceLocate = lazyLocator(() => bendNoteLocator(perSystem, { ...ctx, staff }));
    for (const g of glis) {
      const s = where.get(g.start.chordId);
      const e = where.get(g.end.chordId);
      if (!s || !e || e.k < s.k) continue;
      let start;
      if (g.start.stub) {
        // current glissando run: no start note, only a short line leading into the arrival note, from below (the run goes up) or from above
        const arrival = noteAnchorInfo(e.p.entry, e.p.x, g.endNoteId, { ...ctx, staff });
        if (!arrival) continue;
        const dir = Math.sign(g.startInterval); // < 0: the start is below the arrival
        const y = arrival.y + dir * 1.6;
        start = { x: arrival.x - scorePainter.lead(e.p.entry, { ...ctx, staff }), // the whole room on its left (accidentals, then the line's own length)
          y, headW: 0, headTop: y, headBottom: y, boxes: [], pitch: arrival.pitch + dir };
      } else if (g.start.grace) {
        // glissando run: the start is the ornament note (placed by the grace group of the arrival chord)
        const at = graceLocate(g.startNoteId);
        start = at && { x: at.x, y: at.y, headW: at.w, headTop: at.y + at.h / 2, headBottom: at.y - at.h / 2, boxes: at.boxes, pitch: g.startPitch };
      } else start = noteAnchorInfo(s.p.entry, s.p.x, g.startNoteId, { ...ctx, staff });
      const end = noteAnchorInfo(e.p.entry, e.p.x, g.endNoteId, { ...ctx, staff });
      if (!start || !end) continue;
      const anchors = glissandoAnchors({ start, end, sameLine: Math.abs(start.y - end.y) < 1e-9 });
      const spans = [];
      for (let k = s.k; k <= e.k; k++) spans.push(k === s.k && k === e.k ? {} : k === s.k ? { right: spanOf(k).right, rawRight: spanOf(k).rawRight } : k === e.k ? { left: spanOf(k).left, rawLeft: spanOf(k).rawLeft } : spanOf(k));
      const props = glissandoProps(g, ctx.style);
      const width = ctx.style(SID.GLISSANDO_LINE_WIDTH);
      for (const seg of glissandoSegments(anchors, spans)) {
        result[s.k + (seg.system ?? 0)].push(...glissandoSegmentItems(seg, { ...props, width, ref: g.id }));
      }
    }
    scoreBendItems({ perSystem, staff, ctx: { ...ctx, staff }, locate: lazyLocator(() => bendNoteLocator(perSystem, { ...ctx, staff })), result, where });
    scoreWheelItems({ perSystem, staff, ctx: { ...ctx, staff }, locate: lazyLocator(() => bendNoteLocator(perSystem, { ...ctx, staff })), result });
    techAfter();
    return result;
  },

  /**
   * Soufflets (tranche 3, marquage en plage — voir ../hairpins.js). Appelé une fois par système, après toutes ses
   * mesures : un soufflet a besoin des x de plusieurs colonnes, potentiellement sur plusieurs mesures.
   * @param systemPlaced  [{ entry, x, mi }] pour TOUT le système (toutes voix, toutes mesures)
   */
  paintSystemExtra(systemPlaced, staff, movement, sys, ctx) {
    const items = [];
    if (!systemPlaced.length) return items;
    const resolved = staffHairpins(ctx, staff);
    const sysFirstMi = sys.measures[0].mi;
    const sysLastMi = sys.measures[sys.measures.length - 1].mi;
    const byId = new Map(systemPlaced.map((p) => [p.entry.item.id, p]));
    // ornements du système : un slur peut partir d'un ornement (`slurtielayout.cpp`) ; on les voit comme des « placés » avec
    // le centre de leur tête (`center`) et leur propre sens de hampe
    const graceById = new Map();
    for (const p of systemPlaced) {
      const reg = (layout, list, originX) => list.forEach((g, i) => {
        const geo = layout.geos[i];
        graceById.set(g.chord.id, { x: originX + layout.x[i], center: originX + layout.x[i] + geo.headW / 2, mi: p.mi, entry: { ...p.entry, item: g.chord, stemUp: geo.up } });
      });
      if (p.entry.graceLayout) reg(p.entry.graceLayout, p.entry.graceList, p.x);
      if (p.entry.graceTrailLayout) reg(p.entry.graceTrailLayout, p.entry.graceTrail, sys.measures.find((m) => m.mi === p.mi).barX);
    }
    for (const hp of resolved) {
      const startP = byId.get(hp.startChordId) ?? null;
      const endP = byId.get(hp.endChordId) ?? null;
      const hasStart = Boolean(startP);
      const hasEnd = Boolean(endP);
      const spansThrough = hp.startMi < sysFirstMi && hp.endMi > sysLastMi;
      if (!hasStart && !hasEnd && !spansThrough) continue; // ce soufflet ne concerne pas ce système
      const segType = spannerSegmentType(hasStart, hasEnd);

      // dégagement : bord le plus extrême des têtes de note (voix confondues) entre les deux bornes, DANS CE
      // SYSTÈME seulement (pas de continuité de collision entre systèmes — cohérent avec les nuances).
      let extremeTop = null;
      let extremeBottom = null;
      for (const p of systemPlaced) {
        if (p.mi < hp.startMi || p.mi > hp.endMi || p.entry.item.type !== 'chord') continue;
        const ys = chordYs(p.entry.item, p.entry.clefKey, p.entry.keySig);
        extremeTop = extremeTop === null ? Math.max(...ys) : Math.max(extremeTop, ...ys);
        extremeBottom = extremeBottom === null ? Math.min(...ys) : Math.min(extremeBottom, ...ys);
      }

      const x1 = hasStart ? startP.x : sys.measures[0].start;
      const x2 = hasEnd ? endP.x + HAIRPIN_END_GAP : sys.measures[sys.measures.length - 1].barX;
      const above = staffAbove(ctx, staff, ctx && ctx.track);
      const y = hairpinY({ above, extremeTop, extremeBottom, staffTop: staffLineCount(staff) - 1 });
      for (const line of hairpinWedgeLines({ hairpinType: hp.hairpinType, segType, x1, x2, y })) {
        items.push({ kind: 'line', role: 'hairpin', x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2, width: HAIRPIN_LINE_WIDTH, ref: hp.id });
      }
    }

    // Liaisons de prolongation (tie — voir ../ties.js). Contrairement aux soufflets, un tie relie deux notes
    // PRÉCISES (pas juste deux accords) : on retrouve la note exacte dans chaque accord pour son x/y réel (avec le
    // décalage éventuel d'une tête en seconde, `headOffsets`, déjà calculé pour le dessin des têtes elles-mêmes).
    // Limite assumée (documentée dans ties.js) : les deux accords doivent être visibles DANS CE MÊME système — un
    // tie coupé par un retour à la ligne (rare : suppose une note tenue exactement à la coupure) n'est pas dessiné.
    const ties = staffTies(ctx, staff);
    if (ties.length) {
      const byChordId = new Map(systemPlaced.map((p) => [p.entry.item.id, p]));
      for (const tie of ties) {
        const startP = byChordId.get(tie.start.chordId);
        const endP = byChordId.get(tie.end.chordId);
        if (!startP || !endP) continue;
        const startChord = startP.entry.item;
        const endChord = endP.entry.item;
        const si = startChord.notes.findIndex((n) => n.id === tie.startNoteId);
        const ei = endChord.notes.findIndex((n) => n.id === tie.endNoteId);
        if (si < 0 || ei < 0) continue;
        const startYs = chordYs(startChord, startP.entry.clefKey, startP.entry.keySig);
        const endYs = chordYs(endChord, endP.entry.clefKey, endP.entry.keySig);
        const startHeadW = glyphWidth(ctx.glyphs, chordHead(startP.entry, notatedBase(startP.entry)));
        const endHeadW = glyphWidth(ctx.glyphs, chordHead(endP.entry, notatedBase(endP.entry)));
        const startDx = headDx(startP.entry, startYs, startP.entry.stemUp, startHeadW, notatedBase(startP.entry), ctx.style);
        const endDx = headDx(endP.entry, endYs, endP.entry.stemUp, endHeadW, notatedBase(endP.entry), ctx.style);
        const tiedNoteIds = new Set(ties.map((t) => t.startNoteId));
        const up = tieDirection({
          notes: startChord.notes.map((n, k) => ({ id: n.id, y: startYs[k], pitch: n.pitch, tied: tiedNoteIds.has(n.id) })),
          noteId: tie.startNoteId, startStemUp: startP.entry.stemUp, endStemUp: endP.entry.stemUp,
          multipleVoices: startP.entry.multiVoice, startVoice: startP.entry.voice ?? 0,
          endMultipleVoices: endP.entry.multiVoice, endVoice: endP.entry.voice ?? 0,
        });
        const upSign = up ? 1 : -1;
        const headHeight = 1.0; // bbox noteheadBlack/Half/Whole : ~1 esp. de haut (bBoxNE[1]-bBoxSW[1])
        const x1 = startP.x + startDx[si] + startHeadW + TIE_HORIZONTAL_INSET;
        const y1 = startYs[si] + upSign * (headHeight / 2 + TIE_VERTICAL_GAP);
        const x2 = endP.x + endDx[ei] - TIE_HORIZONTAL_INSET;
        const y2 = endYs[ei] + upSign * (headHeight / 2 + TIE_VERTICAL_GAP);
        // `SlurTieLayout::adjustY` : bout puis arc dégagés des lignes de portée (repère y vers le BAS depuis la ligne du haut)
        const nl = staffLineCount(staff);
        const Hs = nl - 1;
        const extremeOf = (ys, k) => (up ? Math.max(...ys) : Math.min(...ys)) === ys[k];
        const adj = adjustTieY({
          x1, x2, y1: Hs - y1, y2: Hs - y2, up,
          outerStart: extremeOf(startYs, si), outerEnd: extremeOf(endYs, ei),
          inside: false, tiedSecondInside: false, endpointAboveNote: false,
        }, { lines: nl, lineDist: 1, lineThickness: ctx.style(SID.STAFF_LINE_THICKNESS), H: Hs, minArcClearance: ctx.style(SID.TIE_ARC_LINE_CLEARANCE) });
        const ay1 = Hs - adj.y1;
        const ay2 = Hs - adj.y2;
        const shoulderH = tieShoulderHeight(Math.hypot(x2 - x1, ay2 - ay1)) + adj.extraShoulder;
        items.push(curveItem({
          x1, y1: ay1, x2, y2: ay2, shoulderW: TIE_SHOULDER_W, shoulderH, up, midWidth: TIE_MID_WIDTH, role: 'tie', ref: tie.id,
        }));
      }
    }

    // Liaisons d'expression (slur — voir ../slurs.js). Même mécanisme de plage/coupure de système que les
    // soufflets (ancrage par identité des 2 accords de bornes, SpannerSegmentType).
    // hammer-on / pull-off = liaison (`HammerOnPullOff` hérite de `Slur`) + lettres H / P (`hopoShowOnStandardStaves`)
    const slurs = [...staffSlurs(ctx, staff), ...(ctx.style(SID.HOPO_SHOW_ON_STANDARD) ? staffHopos(ctx, staff).map((h) => ({ ...h, hopo: true })) : [])];
    if (slurs.length) {
      const byChordId = new Map(systemPlaced.map((p) => [p.entry.item.id, p]));
      for (const sl of slurs) {
        if (!sl.hopo && !graceById.has(sl.startChordId) && !graceById.has(sl.endChordId)) continue; // traitée par `paintSpanners` (tabSlurItems)
        const startP = byChordId.get(sl.startChordId) ?? graceById.get(sl.startChordId) ?? null;
        const endP = byChordId.get(sl.endChordId) ?? graceById.get(sl.endChordId) ?? null;
        const hasStart = Boolean(startP);
        const hasEnd = Boolean(endP);
        const spansThrough = sl.startMi < sysFirstMi && sl.endMi > sysLastMi;
        if (!hasStart && !hasEnd && !spansThrough) continue;
        const segType = spannerSegmentType(hasStart, hasEnd);

        const dirMap = staffSlurDirections(ctx, staff);
        let up;
        if (hasStart) {
          up = slurUp({ startStemUp: startP.entry.stemUp, multipleVoices: startP.entry.multiVoice, startVoice: startP.entry.voice ?? 0 });
          dirMap.set(sl.id, up);
        } else {
          up = dirMap.get(sl.id) ?? true;
        }

        // dégagement : bord le plus extrême des têtes de note entre les deux bornes, dans ce système (voir slurs.js)
        let extremeTop = null;
        let extremeBottom = null;
        for (const p of systemPlaced) {
          if (p.mi < sl.startMi || p.mi > sl.endMi || p.entry.item.type !== 'chord') continue;
          // seulement entre les deux bornes (une liaison courte, ornement→note par ex., ne bombe pas pour le reste de la mesure)
          if ((hasStart && p.x < startP.x - 1e-6) || (hasEnd && p.x > endP.x + 1e-6)) continue;
          const ys = chordYs(p.entry.item, p.entry.clefKey, p.entry.keySig);
          extremeTop = extremeTop === null ? Math.max(...ys) : Math.max(extremeTop, ...ys);
          extremeBottom = extremeBottom === null ? Math.min(...ys) : Math.min(extremeBottom, ...ys);
        }

        const openY = up ? (staffLineCount(staff) - 1) + SLUR_REST_ABOVE_GAP : SLUR_REST_BELOW;
        const extremeOf = (p) => {
          if (p.entry.item.type === 'rest') return restY(p.entry) + (up ? REST_BOUND_HALF_HEIGHT : -REST_BOUND_HALF_HEIGHT); // borne = silence
          const ys = chordYs(p.entry.item, p.entry.clefKey, p.entry.keySig);
          return up ? Math.max(...ys) : Math.min(...ys);
        };
        // borne = silence : milieu du glyphe (MuseScore : `slurPos` d'un ChordRest sans note, centre de la boîte du silence)
        const restMid = (p) => restX(p.entry, p.x, ctx, glyphWidth(ctx.glyphs, restGlyphName(getProperty(p.entry.item, PID.DURATION).base))) + glyphWidth(ctx.glyphs, restGlyphName(getProperty(p.entry.item, PID.DURATION).base)) / 2;
        const x1 = hasStart ? (startP.entry.item.type === 'rest' ? restMid(startP) : startP.center ?? startP.x + SLUR_HORIZONTAL_INSET) : sys.measures[0].start;
        const x2 = hasEnd ? (endP.entry.item.type === 'rest' ? restMid(endP) : endP.center ?? endP.x + HAIRPIN_END_GAP) : sys.measures[sys.measures.length - 1].barX;
        const y1raw = hasStart ? slurEndpointY({ up, extremeY: extremeOf(startP) }) : openY;
        const y2raw = hasEnd ? slurEndpointY({ up, extremeY: extremeOf(endP) }) : openY;
        const y1 = extendByRange(y1raw, { up, extremeTop, extremeBottom });
        const y2 = extendByRange(y2raw, { up, extremeTop, extremeBottom });
        const shoulderH = slurShoulderHeight(Math.abs(x2 - x1));
        const shoulderW = slurShoulderWidth(Math.abs(x2 - x1));
        const curve = curveItem({ x1, y1, x2, y2, up, shoulderW, shoulderH, midWidth: SLUR_MID_WIDTH, role: sl.hopo ? 'hopo' : 'slur', ref: sl.id });
        items.push(curve);
        if (sl.hopo && startP.entry.item.type !== 'rest' && endP.entry.item.type !== 'rest') items.push(...scoreHopoLetters({ sl, hasStart, hasEnd, startP, endP, systemPlaced, sys, curve, up, ctx }));
      }
    }
    items.push(...scoreTappingItems(systemPlaced, ctx));
    return items;
  },
};

/**
 * Éléments d'une mesure : instants, altérations, clé en vigueur, sens des hampes, ligatures, ornements.
 * `drum` : positionneur de percussion (../drumpos.js) pour une portée de percussion — alors pas d'altérations ni d'armure, hauteurs et têtes
 * viennent de la percmap, et le sens des hampes suit : sens imposé (accord : PID.STEM_DIRECTION, sinon son de sa 1re note : percmap.stemDirection),
 * sinon la PARITÉ de la voix (voix 1, 3 en haut ; 2, 4 en bas), même quand l'autre voix est absente de la mesure.
 */
export function buildEntries(staff, mi, ctx, drum) {
  const entries = sequentialEntries(staff, mi, ctx);
  // portées croisées : les accords / silences relocalisés se dessinent comme ceux de la portée cible (crossstaff.js) ; null = aucun dans la mesure
  const route = drum ? null : crossRoutes(ctx, staff, mi);
  if (route) for (const e of entries) { const r = route.relocated.get(e.item.id); if (r) { e.relocated = r; e.lane = r.lane; } }
  // hauteur sonnante : l'accord est remplacé par sa vue ÉCRITE (hauteurs et orthographes de l'instrument transpositeur, voir ../transposed.js)
  if (ctx.transposition && !drum) {
    const conv = { iv: ctx.transposition.iv, prefer: ctx.transposition.prefer, concertKey: ctx.transposition.concertKeys[mi] };
    for (const e of entries) if (e.item.type === 'chord') e.item = writtenChord(e.item, conv);
  }
  for (const e of entries) if (e.item.type === 'chord') e.graces = gracesOf(e.item); // ornements : altérations dans l'ordre MuseScore
  const keySig = drum ? 0 : ctx.keySigs[mi];
  const shown = drum ? (drum.rhythm ? new Map() : userAccidentals(entries, getProperty, PID)) : route ? route.shown.get(staff.id) : resolveAccidentals(entries, keySig);
  const multiVoice = entries.some((e) => e.voice > 0);
  // clé en vigueur à l'instant de CHAQUE élément (changements en cours de mesure compris) ; la petite clé insérée
  // avant lui ne se dessine que sur la voix 1 (un seul dessin par instant, même si plusieurs voix y attaquent).
  const out = entries.map((entry) => {
    // accord relocalisé : clé, lignes, armure et altérations de la portée CIBLE
    const tg = entry.relocated ? route.sibling(entry.relocated.target) : null;
    const tctx = tg ? tg.ctx : ctx;
    return {
      ...entry,
      keySig: tg ? tctx.keySigs[mi] : keySig,
      accidentals: tg ? route.shown.get(tg.staff.id) : shown,
      multiVoice,
      lines: staffLineCount(tg ? tg.staff : staff),
      drum,
      clefKey: drum ?? (tctx.clefAt ? tctx.clefAt(mi, entry.position) : clefKeyOf(tg ? tg.staff : staff)),
      clefBefore: !drum && !tg && entry.voice === 0 && ctx.clefChangeAt ? ctx.clefChangeAt(mi, entry.position) : null,
      shapeStaff: tg ? tg.index : undefined,
    };
  });
  // trémolos à deux accords : deux accords consécutifs de la MÊME voix, de même durée (`Measure::connectTremolo`)
  const pairMap = staffTwoChordTremolos(ctx, staff);
  if (pairMap.size) {
    for (const v of new Set(out.map((e) => e.lane ?? e.voice))) {
      const list = out.filter((e) => (e.lane ?? e.voice) === v);
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i];
        const b = list[i + 1];
        const info = a.item.type === 'chord' ? pairMap.get(a.item.id) : null;
        if (!info || b.item.type !== 'chord' || b.item.id !== info.endChordId) continue;
        const da = getProperty(a.item, PID.DURATION);
        const db = getProperty(b.item, PID.DURATION);
        const writtenBase = writtenBaseOfPair(da.base);
        if (!writtenBase || da.base !== db.base || (da.dots ?? 0) !== (db.dots ?? 0)) continue;
        a.tremoloPair = { id: info.id, strokes: info.strokes, role: 'first', writtenBase };
        b.tremoloPair = { id: info.id, strokes: info.strokes, role: 'second', writtenBase };
      }
    }
  }
  // sens des hampes : par voix quand il y en a plusieurs (voix 1 et 3 montent, 2 et 4 descendent, comme MuseScore) ;
  // sinon celui du groupe de ligature, à défaut celui de la note la plus éloignée de la ligne du milieu
  const forcedUp = (chord) => {
    const d = getProperty(chord, PID.STEM_DIRECTION);
    return d === 'up' ? true : d === 'down' ? false : drum ? drum.soundStem(chord.notes[0]) : null;
  };
  const forcedBeam = new Set(); // entries of a beamed group that contains a chord with a direction chosen by the user: the whole group follows it
  const voices = [...new Set(out.map((e) => e.lane ?? e.voice))];
  for (const lane of voices) {
    const list = out.filter((e) => (e.lane ?? e.voice) === lane);
    const v = list[0].voice; // numéro de voix (un accord relocalisé garde celui de sa portée d'origine)
    const ysOf = (e) => chordYs(e.item, e.clefKey, keySig);
    const byBeam = new Map(); // entrée → sens de la ligature
    // groupes : sur TOUS les éléments de la voix, y compris ceux relocalisés en « voie » sur l'autre portée (ils coupent les ligatures de leurs voisins) ;
    // une voie relocalisée ne groupe que ses propres éléments
    const full = typeof lane === 'string' ? list : out.filter((e) => e.voice === lane);
    for (const group of buildBeamGroups(full, ctx.timeSigs[mi], ctx.beamGroupings[mi], ctx.offsets[mi], ctx.style(SID.BEAM_BY_BEAT))) {
      let up;
      if (drum) {
        // percussion : sens imposé du 1er accord du groupe qui en a un (`beamlayout.cpp`), sinon parité de la voix
        const members = group.filter((i) => full[i].item.type === 'chord').map((i) => forcedUp(full[i].item));
        up = members.find((d) => d !== null) ?? v % 2 === 0;
      } else {
        // a stem direction chosen by the user (any voice, notation staves): the first chord of the group that has one decides for the whole group
        const chosen = group.filter((i) => full[i].item.type === 'chord').map((i) => forcedUp(full[i].item)).find((d) => d !== null);
        if (chosen !== undefined) { up = chosen; for (const i of group) forcedBeam.add(full[i]); }
        else up = groupDirection(group.filter((i) => full[i].item.type === 'chord').flatMap((i) => ysOf(full[i])), full[0].lines) === 'up';
      }
      for (const i of group) byBeam.set(full[i], up);
    }
    list.forEach((e) => {
      if (e.item.type !== 'chord') return;
      // accord relocalisé sur une autre portée : ligaturé → sens du groupe ; seul → vers sa portée d'origine (`computeUp` : `staffMove() > 0` → hampe montante)
      e.stemUp = e.relocated ? (byBeam.has(e) ? byBeam.get(e) : e.relocated.move > 0)
        : drum ? (byBeam.has(e) ? byBeam.get(e) : forcedUp(e.item) ?? v % 2 === 0)
        : forcedBeam.has(e) ? byBeam.get(e) : forcedUp(e.item) ?? (multiVoice ? v % 2 === 0 : byBeam.has(e) ? byBeam.get(e) : defaultStemUp(ysOf(e), e.lines));
      e.beamed = byBeam.has(e); // pas de crochet dans la forme de l'accord (glissandos)
    });
    list.forEach((e, i) => {
      if (e.tremoloPair?.role !== 'first') return;
      if (byBeam.has(e) && byBeam.has(list[i + 1])) return; // couple ligaturé : le sens est celui de la ligature (`layoutTwoNotesTremolo`)
      const up = pairStemUp(ysOf(e), ysOf(list[i + 1]), { multiVoice, voice: v });
      e.stemUp = up;
      list[i + 1].stemUp = up;
    });
  }
  // membres d'une ligature croisée portée (crossbeam.js) : hampe vers le haut s'ils sont sur la portée du BAS (`computeUpBeamCase` : accord sous
  // la ligature) ; la ligature elle-même est posée dans un second passage (`layout/index.js`)
  if (route) {
    for (const e of out) {
      const cm = route.crossMembers.get(e.item.id);
      if (!cm) continue;
      e.crossMember = { ...cm, staffIndex: route.sibling(cm.staffK).index };
      if (e.item.type === 'chord') { e.stemUp = cm.lower; e.beamed = true; }
    }
  }
  attachChordVoices(out, ctx);
  attachGraces(out, ctx, shown, multiVoice);
  addGlissandoPadding(out, staff, ctx);
  return out;
}

/**
 * Plusieurs voix qui attaquent au même instant : mise en page commune des accords (`ChordLayout::layoutChords1` → `layoutChords3`, chordvoices.js) —
 * têtes centrées sur l'axe nominal, décalage d'une voix en cas d'unisson ou de seconde, partage de têtes identiques, alignement des points.
 * Résultat dans `entry.vx` ({ moveX, dotPosX, notes: id → { x, mirror, dotsHidden, dotRel } }). Un accord SEUL à son instant garde la mise en
 * page à une voix (`headOffsets`). Limites : accords d'ornement et de petite taille, portées voisines, altérations entre voix non portés.
 */
function attachChordVoices(out, ctx) {
  const { glyphs, style } = ctx;
  const groups = new Map();
  for (const e of out) {
    if (e.item.type !== 'chord' || e.stemUp === undefined || e.relocated) continue; // un accord relocalisé n'est pas sur cette portée (collisions avec la cible : non portées)
    const key = `${e.position[0]}/${e.position[1]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const end = (e) => fAdd(e.position, e.duration);
  const styleCombine = style(SID.COMBINE_VOICE) !== false;
  const nominal = glyphWidth(glyphs, 'noteheadBlack');
  const opts = {
    nominal, stemWidth: style(SID.STEM_THICKNESS), ledgerLen: style(SID.LEDGER_LINE_LENGTH), lines: out[0]?.lines ?? 5,
    straightFlags: Boolean(style(SID.USE_STRAIGHT_NOTE_FLAGS)), dotWidth: glyphWidth(glyphs, 'augmentationDot'),
    dotNoteDistance: DOT_NOTE_DISTANCE, dotDotDistance: DOT_DOT_DISTANCE,
  };
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const chords = list.map((e) => {
      const base = notatedBase(e);
      const ys = chordYs(e.item, e.clefKey ?? clefKeyOf(ctx.staff), e.keySig);
      const hasStem = base !== 'whole' && base !== 'breve';
      const flag = !e.beamed && FLAG[base] ? `${FLAG[base]}${e.stemUp ? 'Up' : 'Down'}` : null;
      const fb = flag ? glyphs.glyphs[flag].bbox : null;
      const mode = getProperty(e.item, PID.COMBINE_VOICE);
      return {
        id: e.item.id, track: e.voice, voice: e.voice, up: e.stemUp, dots: getProperty(e.item, PID.DURATION).dots ?? 0, mag: 1,
        hasStem, stemLen: 7, hook: fb ? fb.bBoxNE[0] - fb.bBoxSW[0] : null,
        headType: base === 'whole' ? 'whole' : base === 'breve' ? 'brevis' : base === 'half' ? 'half' : 'quarter',
        combine: mode === 'on' ? true : mode === 'off' ? false : styleCombine,
        hasVoices: out.some((o) => o.voice >= 1 && fCmp(o.position, end(e)) < 0 && fCmp(e.position, end(o)) < 0),
        notes: e.item.notes.map((n, i) => {
          const name = headOf(e, n, base);
          const an = glyphs.glyphs[name].anchors || {};
          const w = glyphWidth(glyphs, name);
          const sp = e.drum ? null : getProperty(n, PID.SPELLING);
          return {
            id: n.id, line: Math.round(2 * ((e.lines ?? 5) - 1) - 2 * ys[i]), right: w, body: w, headGroup: name,
            tpc: e.drum ? String(e.drum.soundKey ? e.drum.soundKey(n) : getProperty(n, PID.SOUND)) : sp ? `${sp.step}${sp.alter ?? 0}` : String(getProperty(n, PID.PITCH)),
            visible: true, stemUpX: an.stemUpSE ? an.stemUpSE[0] : null, stemDownX: an.stemDownNW ? an.stemDownNW[0] : null,
          };
        }),
      };
    });
    const res = layoutChordGroup(chords, opts);
    for (const e of list) e.vx = res.get(e.item.id);
  }
}

/**
 * Rattache les ornements aux colonnes (gracenotes.js). « Avant » : à la colonne de leur accord. « Après » : à la colonne qui SUIT
 * (premier instant suivant sur la portée, `TLayout::layoutGraceNotesGroup` sur le segment suivant), ou contre la barre de fin
 * de mesure s'il n'y en a pas (`graceTrail`). Les « après » du précédent se posent avant les « avant » de la colonne.
 */
function attachGraces(out, ctx, shown, multiVoice) {
  const { glyphs, style } = ctx;
  const lists = new Map();
  const add = (target, key, g) => { if (!lists.has(target)) lists.set(target, []); lists.get(target).push({ chord: g, groupKey: key }); };
  const trails = new Map();
  for (const e of out) {
    if (!e.graces?.after.length) continue;
    const later = out.filter((o) => fCmp(o.position, e.position) > 0);
    if (!later.length) { trails.set(e, e.graces.after.map((g) => ({ chord: g, groupKey: `a${e.item.id}` }))); continue; }
    const next = later.reduce((m, o) => (fCmp(o.position, m) < 0 ? o.position : m), later[0].position);
    const atNext = later.filter((o) => fCmp(o.position, next) === 0);
    const target = atNext.find((o) => o.voice === e.voice) ?? atNext[0];
    for (const g of e.graces.after) add(target, `a${e.item.id}`, g);
  }
  for (const e of out) for (const g of e.graces?.before ?? []) add(e, `b${e.item.id}`, g);
  const layoutOf = (e, list, mainBoxes) => layoutGraceGroup(list, mainBoxes, {
    glyphs, style, clefKey: e.clefKey, keySig: e.keySig, accidentals: shown, voice: e.voice, multiVoice, lines: e.lines ?? 5,
  });
  for (const [e, list] of lists) {
    const items = paintItem(e, 0, ctx, null).filter((it) => !(e.beamed && it.role === 'flag'));
    e.graceList = list;
    e.graceLayout = layoutOf(e, list, typedBoxes(items, glyphs, { voice: e.voice, mag: 1 }));
  }
  const bar = [{ type: 'barline', left: -0.09, right: 0.09, bottom: 0, top: (out[0]?.lines ?? 5) - 1, voice: -1, beamId: null, mag: 1 }];
  for (const [e, list] of trails) {
    e.graceTrail = list;
    e.graceTrailLayout = layoutOf(e, list, bar);
  }
}

/** Petite clé insérée en cours de mesure, juste avant `leftEdge` (bord gauche de ce qui suit : altération ou tête). */
function clefChangeItem(entry, leftEdge, glyphs) {
  const def = CLEF_DEFS[entry.clefBefore];
  const w = glyphWidth(glyphs, def.glyph) * SMALL_CLEF_MAG;
  return glyphItem(def.glyph, leftEdge - CLEF_CHANGE_GAP - w, def.musicY, { mag: SMALL_CLEF_MAG, ref: entry.item.id, role: 'clef-change' });
}

/**
 * Géométrie d'un élément pour les liaisons (`tabspanners.js: tabSlurItems`, option `score`) : relue après le dessin, d'après les éléments d'affichage de
 * l'accord. Rectangles y vers le haut. `stem.y2` = fin de la hampe dessinée (non ligaturée : ancre du crochet comprise) ; ligaturée : le CENTRE de la barre
 * (MuseScore : la hampe y va jusqu'au centre de la barre, `slurPos` ajoute ensuite la demi-épaisseur et le dégagement).
 */
function slurGeometry(entry, items, ctx, x, headW, beam) {
  const { glyphs, style } = ctx;
  const rect = (it) => { const b = glyphs.glyphs[it.name].bbox; const m = it.mag ?? 1; return { x1: it.x + b.bBoxSW[0] * m, x2: it.x + b.bBoxNE[0] * m, y1: it.y + b.bBoxSW[1] * m, y2: it.y + b.bBoxNE[1] * m }; };
  const geo = { notes: [], dots: [], others: [], stem: null, hook: null, rest: null, x0: x, headRight: x + headW, stemX: null };
  for (const note of entry.item.notes ?? []) {
    const head = items.find((i) => i.kind === 'glyph' && i.ref === note.id && !i.role);
    if (!head) continue;
    const r = rect(head);
    geo.notes.push({ id: note.id, y: head.y, rects: [r], cx: head.x + (glyphs.glyphs[head.name].bbox.bBoxNE[0] - glyphs.glyphs[head.name].bbox.bBoxSW[0]) / 2, pitch: note.pitch });
  }
  for (const it of items) {
    if (it.kind === 'glyph' && it.role === 'accidental') geo.others.push(rect(it));
    else if (it.kind === 'glyph' && it.name === 'augmentationDot') geo.dots.push(rect(it));
    else if (it.kind === 'glyph' && it.role === 'flag') geo.hook = rect(it);
    else if (it.kind === 'line' && it.role === 'stem') {
      const beamHalf = beam ? style(SID.BEAM_THICKNESS) / 2 : 0;
      const up = it.y2 > it.y1;
      geo.stem = { x: it.x1, y1: it.y1, y2: beam ? it.y2 + (up ? -beamHalf : beamHalf) : it.y2, width: it.width, up };
      geo.stemX = it.x1;
    }
  }
  return geo;
}

/** Silence, ou accord avec ses altérations, lignes supplémentaires, hampe ; `beam` = { tipY } si l'accord est ligaturé. */
function paintItem(entry, x, ctx, beam) {
  const { item } = entry;
  const { glyphs, style } = ctx;
  if (item.type === 'rest') {
    if (getProperty(item, PID.GAP) === true) { entry.dotsRight = null; return []; } // silence « trou » : ni dessiné ni mesuré (`Rest::isGap`)
    const base = getProperty(item, PID.DURATION).base;
    const plain = restGlyphName(base);
    const name = restGlyphAt(base, restY(entry) + (beam?.restDy ?? 0), entry.lines ?? 5); // variante à ligne supplémentaire hors portée
    const rx = restX(entry, x, ctx, glyphWidth(glyphs, plain)); // centrage sur la largeur SANS ligne (`symWidthNoLedgerLines`)
    const ry = restY(entry) + (beam?.restDy ?? 0);
    let items = [glyphItem(name, rx, ry, { ref: item.id })];
    { const rb = glyphs.glyphs[name].bbox; entry.slurGeom = { notes: [], dots: [], others: [], stem: null, hook: null, rest: { x1: rx + rb.bBoxSW[0], x2: rx + rb.bBoxNE[0], y1: ry + rb.bBoxSW[1], y2: ry + rb.bBoxNE[1] } }; }
    entry.dotsRight = null;
    const restDots = getProperty(item, PID.DURATION).dots ?? 0;
    if (restDots > 0) {
      const rd = restDotItems({ x: rx, y: ry, width: glyphWidth(glyphs, name), base, dots: restDots, dotWidth: glyphWidth(glyphs, 'augmentationDot'), ref: item.id });
      items.push(...rd.items);
      entry.dotsRight = rd.right - x;
    }
    items = hideIfInvisible(item, items);
    if (entry.clefBefore) items.push(clefChangeItem(entry, x, glyphs));
    return items;
  }
  if (item.type !== 'chord') return [];

  const clefKey = entry.clefKey ?? clefKeyOf(ctx.staff);
  const base = notatedBase(entry);
  const head = chordHead(entry, base);
  const ys = chordYs(item, clefKey, entry.keySig);
  const items = [];
  const ext = style(SID.LEDGER_LINE_EXTENSION);
  const ledgerWidth = style(SID.LEDGER_LINE_THICKNESS);

  const up = entry.stemUp;
  const headW = glyphWidth(glyphs, head);
  const dx = headDx(entry, ys, up, headW, base, style);
  const accOffsets = chordAccidentalOffsets(entry, ctx, ys, dx, headW);
  let leftEdge = x; // bord gauche le plus à gauche atteint par une tête ou une altération (référence de la petite clé)
  const ledgers = new Map(); // ligne supplémentaire (y) → { x1, x2, ref } : une seule ligne couvrant toutes les têtes qui la touchent
  item.notes.forEach((note, i) => {
    const y = ys[i];
    const hx = x + dx[i];
    // groupe de têtes propre à la note (étouffée = croix, harmonique = losange) : plus étroit que la tête ordinaire, il est collé du côté de la
    // hampe (montante : à droite ; descendante : à gauche), là où la hampe (x de la tête ordinaire) s'accroche à sa pointe
    const nh = headOf(entry, note, base);
    const headX = entry.vx || nh === head || !up ? hx : hx + headW - glyphWidth(glyphs, nh);
    const tint = getProperty(note, PID.COLOR); // a note may have its own colour (the root of a scale)
    items.push(glyphItem(nh, headX, y, tint ? { ref: note.id, color: tint } : { ref: note.id }));
    if (dx[i] < 0) leftEdge = Math.min(leftEdge, hx);
    const parens = hasParentheses(note, getProperty, PID);
    if (parens) for (const p of scoreParentheses({ left: hx, width: headW, y, glyph: glyphs.glyphs[head], ref: note.id })) items.push(p.item);
    const acc = entry.accidentals.get(note.id);
    if (acc) {
      const placed = accOffsets?.get(note.id);
      const accX = typeof placed === 'number' ? x + placed : hx - glyphWidth(glyphs, acc) - accidentalPad(y, style, entry.lines ?? 5) - (parens ? parenthesisOutside(1.5, false) : 0);
      items.push(glyphItem(acc, accX, y, { ref: note.id, role: 'accidental' }));
      leftEdge = Math.min(leftEdge, accX);
    }
    // lignes supplémentaires : longueur par défaut, fixe (c'est l'altération qui s'écarte, pas la ligne)
    const need = [];
    if (y < 0) for (let l = -1; l >= Math.ceil(y); l--) need.push(l);
    if (y > (entry.lines ?? 5) - 1) for (let l = (entry.lines ?? 5); l <= Math.floor(y); l++) need.push(l);
    for (const l of need) {
      const x1 = (entry.drum ? headX : hx) - ext;
      const x2 = (entry.drum ? headX + glyphWidth(glyphs, nh) : hx + LEDGER_HEAD_WIDTH) + ext;
      const cur = ledgers.get(l);
      ledgers.set(l, cur ? { x1: Math.min(cur.x1, x1), x2: Math.max(cur.x2, x2), ref: cur.ref } : { x1, x2, ref: note.id });
    }
  });
  for (const [l, seg] of ledgers) items.push({ kind: 'line', role: 'ledger', x1: seg.x1, x2: seg.x2, y1: l, y2: l, width: ledgerWidth, ref: seg.ref });
  if (entry.clefBefore) items.push(clefChangeItem(entry, leftEdge, glyphs));
  const arpeggio = chordArpeggio(entry, ctx, x, ys, dx);
  if (arpeggio) items.push(...arpeggio.items);

  const flag0 = beam || entry.beamed ? null : FLAG[base];
  const tremolo = entry.tremoloPair ? null : getProperty(item, PID.TREMOLO);
  const stem = stemInfo(ys, base, up, beam, style, tremolo, glyphs, stemGeom({ ...entry, stemUp: up }, ys, base, glyphs));
  if (stem) {
    const thickness = style(SID.STEM_THICKNESS);
    const anchors = glyphs.glyphs[head].anchors;
    const flag = beam || entry.beamed ? null : FLAG[base];
    const stemX = stemXFor(glyphs, x, up, thickness, head);
    // ancre de la tête de la note qui porte la hampe (montante : la plus basse ; descendante : la plus haute) : losange / croix ont la leur
    const footNote = item.notes[ys.indexOf(up ? Math.min(...ys) : Math.max(...ys))];
    const footAnchors = glyphs.glyphs[headOf(entry, footNote, base)].anchors || {};
    const footAnchor = (up ? footAnchors.stemUpSE : footAnchors.stemDownNW) || (up ? anchors.stemUpSE : anchors.stemDownNW);
    const foot = (up ? stem.bottom : stem.top) + footAnchor[1];
    // Avec crochet (sans ligature), la hampe dessinée s'arrête à l'ancre SMuFL du crochet (`StemLayout` : `y2 += hook->smuflAnchor().y()`,
    // stemUpNW / stemDownSW) : vérifié sur un export MuseScore Bravura (croche descendante : pointe −0,5, hampe finit à −0,368).
    const flagAnchor = flag ? glyphs.glyphs[`${flag}${up ? 'Up' : 'Down'}`].anchors[up ? 'stemUpNW' : 'stemDownSW'] : null;
    const stemEnd = flagAnchor ? stem.tip + flagAnchor[1] : stem.tip;
    items.push({ kind: 'line', role: 'stem', x1: stemX, x2: stemX, y1: foot, y2: stemEnd, width: thickness, ref: item.id });
    if (flag) items.push(glyphItem(`${flag}${up ? 'Up' : 'Down'}`, stemX, stem.tip, { ref: item.id, role: 'flag' }));
  }

  if (tremolo) {
    // Trémolo sur une note (tremolo.js). Avec hampe : axe de la hampe, ancre = note du côté opposé à la pointe ; sans hampe
    // (ronde) : au-dessus/au-dessous de la tête du côté de la pointe, centré sur elle (`TremoloLayout::layout`).
    const stemX = stem ? stemXFor(glyphs, x, up, style(SID.STEM_THICKNESS), head) : null;
    const anchorIndex = ys.indexOf(up ? Math.max(...ys) : Math.min(...ys));
    const hasMirrored = dx.some((d) => d !== 0);
    // sans hampe : centre de la tête d'ancrage, ou (têtes en seconde) `StemLayout::stemPosX` — pas d'ancre de hampe sur la ronde :
    // bord droit de la tête si la hampe monterait, bord gauche sinon (non comparé à un export MuseScore)
    const bareX = hasMirrored ? x + (up ? headW : 0) : x + dx[anchorIndex] + headW / 2;
    const placed = singleTremoloItems({
      tremolo, up, x: stem ? stemX : bareX,
      anchorY: stem ? (up ? stem.bottom : stem.top) : ys[anchorIndex],
      tipY: stem ? stem.tip : null,
      beams: beamCountOf(base), hook: Boolean(stem && !beam && FLAG[base]), style, glyphs, ref: item.id,
      straightFlags: style(SID.USE_STRAIGHT_NOTE_FLAGS),
    });
    items.push(...placed.items);
  }

  const articulations = [...getProperty(item, PID.ARTICULATIONS)];
  const tapping = tappingEntry(item, style, false);
  if (tapping) articulations.push(tapping);
  let artItems = null;
  if (articulations.length) {
    artItems = articulationItems(articulations, {
      ys, stemUp: up, stemTip: stem ? stem.tip : null, headWidth: headW, x, voice: entry.voice ?? 0, glyphs, itemId: item.id, topLineY: (entry.lines ?? 5) - 1,
      headGlyphName: entry.drum?.rhythm ? headOf(entry, item.notes[0], base) : null, // tête de barre oblique : plus haute que la tête noire
      ornamentAccidentals: (e) => signAccidentals(e, item, entry.keySig ?? 0),
    });
    items.push(...artItems);
  }

  const dynamic = getProperty(item, PID.DYNAMIC);
  if (dynamic) {
    const dyn = dynamicItems(dynamic, {
      ys, stemUp: up, stemTip: stem ? stem.tip : null, headWidth: headW, x, itemId: item.id, glyphs,
      hasLyrics: staffAbove(ctx, ctx.staff, ctx.track), chordBounds: artItems ? artItems.bounds : null, staffTop: (entry.lines ?? 5) - 1,
      text: getProperty(item, PID.DYNAMIC_TEXT),
    });
    items.push(...dyn);
  }
  // points d'augmentation (`scoredots.js`) : à droite de la tête la plus à droite, sur la ligne ou l'interligne voisin
  entry.dotsRight = null;
  const dotCount = getProperty(item, PID.DURATION).dots ?? 0;
  let dotRects = [];
  if (dotCount > 0) {
    const order = item.notes.map((_, i) => i).sort((a, b) => ys[a] - ys[b]); // hauteur croissante
    const flagName = flag0 ? `${flag0}Up` : null;
    const fb = flagName ? glyphs.glyphs[flagName].bbox : null;
    const hook = up && fb && stem
      ? { right: stemXFor(glyphs, x, true, style(SID.STEM_THICKNESS), head) + fb.bBoxNE[0], bottomY: stem.tip + fb.bBoxSW[1] - 0.25, width: fb.bBoxNE[0] - fb.bBoxSW[0] }
      : null;
    // plusieurs voix au même instant : x commun et sens des points calculés ensemble (`layoutChords3`, chordvoices.js)
    const vx = entry.vx;
    const dotPosX = vx ? x - vx.moveX + vx.dotPosX : Math.max(...dx.map((d) => x + d + headW));
    const dd = chordDotItems({
      ys: order.map((i) => ys[i]), lines: order.map((i) => Math.round(2 * ((entry.lines ?? 5) - 1) - 2 * ys[i])), voice: entry.voice ?? 0, dots: dotCount, dotPosX, hook,
      dotWidth: glyphWidth(glyphs, 'augmentationDot'), ref: item.id,
      rel: vx ? order.map((i) => vx.notes.get(item.notes[i].id).dotRel) : null,
      hidden: vx ? order.map((i) => vx.notes.get(item.notes[i].id).dotsHidden) : null,
    });
    items.push(...dd.items);
    dotRects = [{ x2: dd.right }];
    entry.dotsRight = dd.right - x;
  }
  // slide (ChordLine) : posée contre la forme de l'accord (têtes, altérations, lignes supplémentaires, hampe, crochet) — `layoutChordLine` est commune à la
  // tablature et à la portée ; les points d'augmentation ne sont pas encore dessinés sur portée score (non pris en compte)
  entry.chordLineBox = null;
  const cl = getProperty(item, PID.CHORD_LINE);
  if (cl) {
    const boxes = boxesFromItems(items.filter((i) => !i.role || ['accidental', 'flag', 'tremolo', 'stem', 'ledger'].includes(i.role)), glyphs, { beamed: Boolean(entry.beamed || beam) })
      .map((b) => ({ x1: b.left, x2: b.right, y1: b.bottom, y2: b.top }));
    const res = chordLineLayout({ spec: cl, noteY: Math.max(...ys), boxes, dots: dotRects, glyphs, thickness: style(SID.CHORDLINE_THICKNESS), ref: item.id });
    items.push(...res.items);
    entry.chordLineBox = { left: res.left - x, right: res.right - x };
  }
  entry.slurGeom = slurGeometry(entry, items, ctx, x, headW, beam);
  // articulations hors « près de la tête » (hors staccato / tenuto) de chaque côté : `hasArticulationAbove` (équilibre des liaisons)
  entry.articSides = { above: false, below: false };
  for (const it of artItems ?? []) {
    if (it.role !== 'articulation' || !it.name || /^artic(Staccato|Tenuto)(Above|Below)$/.test(it.name)) continue;
    if (it.name.endsWith('Above')) entry.articSides.above = true; else if (it.name.endsWith('Below')) entry.articSides.below = true;
  }
  entry.articItems = artItems ?? [];
  // note d'aide de l'ornement (intervalle ≠ seconde) : à droite de l'accord, dans la forme du segment (`cuenote.js`)
  items.push(...cueNoteItems({ ctx, chord: item, staff: ctx.staff, clefKey, keySig: entry.keySig ?? 0, x, parentItems: items, glyphs, style, lines: entry.lines ?? 5, voice: entry.voice ?? 0 }));
  return items;
}

/**
 * Tapping main gauche sur portée : demi-liaison au-dessus/dessous de la note (`TappingLayout::updateHalfSlurs`, 4.7.5). Sens = `computeUp` (opposé à la
 * hampe) ; extrémité d'arrivée = centre de la tête de la note du côté de la liaison, ± 0,9 sp (`slurPos`), ± 0,2 sp pour une note sur un interligne à
 * l'intérieur de la portée (`adjustForTappingHalfSlurs`) ; `p1 = p2 − 2,5 sp`, épaule 0,6 sp, largeur 0,5, moitié gauche masquée.
 * Non porté : `fixArticulations` (staccato/tenuto près de la tête), plusieurs voix (liaison du côté de la hampe).
 */
function scoreTappingItems(systemPlaced, ctx) {
  const { glyphs, style } = ctx;
  const out = [];
  if (style(SID.LH_TAPPING_SHOW_ITEMS_NORMAL) === 'symbol') return out;
  for (const p of systemPlaced) {
    const en = p.entry;
    const tp = en.item.type === 'chord' ? getProperty(en.item, PID.TAPPING) : null;
    if (!tp || tp.hand !== 'left') continue;
    const ys = chordYs(en.item, en.clefKey ?? clefKeyOf(ctx.staff), en.keySig);
    const up = !en.stemUp;
    const headW = glyphWidth(glyphs, chordHead(en, notatedBase(en)));
    const yNote = up ? Math.max(...ys) : Math.min(...ys);
    let y = yNote + (up ? 0.9 : -0.9);
    const nl = staffLineCount(ctx.staff);
    const line = Math.round(2 * (nl - 1) - 2 * yNote); // ligne MuseScore (0 = ligne du haut, demi-interlignes)
    if (line > 1 && line < 2 * (nl - 1) - 1 && line % 2 !== 0) y += up ? 0.2 : -0.2;
    y = (nl - 1) - adjustEndpointY((nl - 1) - y, up, { lw: 1, lines: nl, lineThickness: style(SID.STAFF_LINE_THICKNESS) });
    const x2 = p.x + headW / 2;
    const c = curveItem({ x1: x2 - 2.5, y1: y, x2, y2: y, shoulderW: 0.5, shoulderH: 0.6, up, role: 'tapping', ref: en.item.id });
    out.push({ kind: 'polygon', role: 'tapping', ref: en.item.id, sel: `${en.item.id}-tap`, points: rightHalfPolygon(c) });
  }
  return out;
}

/** Arpège d'un accord sur portée score (`scorearpeggio.js`) : géométrie à l'origine `x` ; `lll` = place déjà prise à gauche (têtes décalées, altérations + 0,25). */
function chordArpeggio(entry, ctx, x, ys, dx) {
  const { item } = entry;
  const spec = item.type === 'chord' ? getProperty(item, PID.ARPEGGIO) : null;
  if (!spec) return null;
  const { glyphs, style } = ctx;
  const head = chordHead(entry, notatedBase(entry));
  let lll = Math.max(0, ...dx.map((d) => -d));
  const accs = [];
  item.notes.forEach((note, i) => {
    const name = entry.accidentals.get(note.id);
    if (!name) return;
    const parens = hasParentheses(note, getProperty, PID);
    const left = dx[i] - glyphWidth(glyphs, name) - accidentalPad(ys[i], style, entry.lines ?? 5) - (parens ? parenthesisOutside(1.5, false) : 0);
    accs.push({ y: ys[i], glyph: name, left });
    lll = Math.max(lll, -left + 0.25);
  });
  return scoreArpeggio({
    spec, x, ys, dx, head, accs, lll, glyphs, lineWidth: style(SID.ARPEGGIO_LINE_WIDTH), hookLen: style(SID.ARPEGGIO_HOOK_LEN), ref: item.id, lines: entry.lines ?? 5,
  });
}

/**
 * Lettres H / P d'un hopo sur portée (`HammerOnPullOffSegment::computeHopoTextRegions` + `TLayout::layoutHammerOnPullOffSegment`, 4.7.5) : une lettre par paire
 * d'accords consécutifs de la voix (`hopoShowAll`) ou par série de même sens ; H si la hauteur monte, P sinon. Centrée entre la fin de la tête de départ et le début
 * de l'accord d'arrivée (+ ½ tête si les deux hampes montent, comme le texte est « au-dessus »), baseline à la ligne du haut + 0,5 sp, relevée à 1 sp au-dessus de
 * la plus haute note des deux accords (`yNoteLimit`). ÉCART (comme en tablature) : relevée 0,097 sp au-dessus du sommet de la liaison. Non porté : repoussement par
 * les articulations ; paire dont l'accord d'arrivée est dans le système suivant (pas de lettre) ; ties entre les notes.
 */
function scoreHopoLetters({ sl, hasStart, hasEnd, startP, endP, systemPlaced, sys, curve, up, ctx }) {
  const { glyphs, style } = ctx;
  const voice = (p) => p.entry.voice ?? 0;
  const ref = hasStart ? startP : systemPlaced.find((p) => p.entry.item.type === 'chord' && p.mi >= sl.startMi);
  if (!ref) return [];
  const v = voice(ref);
  const from = hasStart ? systemPlaced.indexOf(startP) : systemPlaced.indexOf(ref);
  const to = hasEnd ? systemPlaced.indexOf(endP) : systemPlaced.length - 1;
  const chain = systemPlaced.slice(from, to + 1).filter((p) => p.entry.item.type === 'chord' && voice(p) === v);
  const regions = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i]; const b = chain[i + 1];
    const an = a.entry.item.notes; const bn = b.entry.item.notes;
    let pair = null;
    for (let k = Math.max(an.length, bn.length) - 1; k >= 0; k--) {
      const x = an[Math.min(k, an.length - 1)]; const y = bn[Math.min(k, bn.length - 1)];
      if (x.pitch !== y.pitch) { pair = [x, y]; break; }
    }
    if (!pair) pair = [an[an.length - 1], bn[bn.length - 1]];
    const hammer = pair[1].pitch > pair[0].pitch;
    if (!regions.length || style(SID.HOPO_SHOW_ALL) || regions[regions.length - 1].hammer !== hammer) regions.push({ s: a, e: b, hammer });
    else regions[regions.length - 1].e = b;
  }
  const bez = (t) => {
    const u = 1 - t;
    const y = (a, b, c2, d) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c2 + t * t * t * d;
    return { x: y(curve.x1, curve.topC1x, curve.topC2x, curve.x2), y: y(curve.y1, curve.topC1y, curve.topC2y, curve.y2) };
  };
  const out = [];
  for (const r of regions) {
    const sEn = r.s.entry; const eEn = r.e.entry;
    const headW = glyphWidth(glyphs, chordHead(sEn, notatedBase(sEn)));
    const eHeadW = glyphWidth(glyphs, chordHead(eEn, notatedBase(eEn)));
    const startX = r.s.x + headW;
    let endX = r.e.x;
    const stems = sEn.stemUp && eEn.stemUp;
    if (stems) endX += 0.5 * eHeadW;
    const cx = (startX + endX) / 2;
    const top = (p) => Math.max(...chordYs(p.entry.item, p.entry.clefKey, p.entry.keySig));
    let y = Math.max((staffLineCount(ctx.staff) - 1) + 0.5, Math.max(top(r.s), top(r.e)) + 1);
    if (up) {
      let apex = -Infinity;
      for (let i = 0; i <= 48; i++) { const q = bez(i / 48); if (q.x >= cx - 0.5 && q.x <= cx + 0.5 && q.y > apex) apex = q.y; }
      if (apex > -Infinity) y = Math.max(y, apex + 0.097);
    }
    out.push({ kind: 'text', role: 'hopo-text', text: hopoLetter(r.hammer ? 0 : 1, r.hammer ? 1 : 0, style(SID.HOPO_UPPER_CASE)), x: cx, y, size: TEXT_SIZE, anchor: 'middle', ref: sl.id });
  }
  return out;
}

/**
 * Position de chaque note (accord ou ornement « avant ») pour les bends sur portée (scorebends.js) : x de la tête, y (repère de portée),
 * taille de tête, forme de l'accord (têtes, altérations, hampe… — `boxesFromItems`), hampe, note du haut / du bas.
 * @returns (noteId) => info | null
 */
/** The locator is built the first time a bend asks for a note (most staves have no bend: building it paints every chord a second time). */
const lazyLocator = (make) => { let f = null; return (id) => (f ??= make())(id); };

function bendNoteLocator(perSystem, ctx) {
  const { glyphs, style } = ctx;
  const map = new Map();
  perSystem.forEach(({ placed }, k) => {
    for (const p of placed) {
      const e = p.entry;
      if (e.item.type !== 'chord') continue;
      const ys = chordYs(e.item, e.clefKey ?? clefKeyOf(ctx.staff), e.keySig);
      const base = notatedBase(e);
      const head = chordHead(e, base);
      const headW = glyphWidth(glyphs, head);
      const dx = headDx(e, ys, e.stemUp, headW, base, style);
      const hb = glyphs.glyphs[head].bbox;
      const beam = e.beamed ? { tipY: e.stemUp ? Math.max(...ys) + 3.5 : Math.min(...ys) - 3.5 } : null;
      const boxes = boxesFromItems(paintItem(e, p.x, ctx, beam), glyphs, { beamed: Boolean(e.beamed) });
      const hasStem = base !== 'whole' && base !== 'breve';
      e.item.notes.forEach((n, i) => {
        map.set(n.id, {
          k, x: p.x + dx[i], y: ys[i], w: headW, h: hb.bBoxNE[1] - hb.bBoxSW[1], mag: 1, hasStem, stemUp: e.stemUp,
          isTop: ys[i] === Math.max(...ys), isBottom: ys[i] === Math.min(...ys), boxes,
        });
      });
      // grace notes: attached to their column (`graceLayout`) or, "after" ones of the last chord of a measure, to the bar line (`graceTrailLayout`)
      const graceGroups = [];
      if (e.graceLayout) graceGroups.push([e.graceLayout, e.graceList, p.x]);
      if (e.graceTrailLayout) graceGroups.push([e.graceTrailLayout, e.graceTrail, perSystem[k].sys.measures.find((m) => m.mi === p.mi).barX]);
      for (const [layout, list, originX] of graceGroups) {
        list.forEach((g, gi) => {
          const geo = layout.geos[gi];
          const gb = glyphs.glyphs[geo.head].bbox;
          const x0 = originX + layout.x[gi];
          g.chord.notes.forEach((n, ni) => {
            const gx = x0 + geo.dx[ni];
            map.set(n.id, {
              k, x: gx, y: geo.ys[ni], w: geo.headW, h: (gb.bBoxNE[1] - gb.bBoxSW[1]) * geo.mag, mag: geo.mag, hasStem: geo.hasStem, stemUp: geo.up,
              isTop: geo.ys[ni] === geo.top, isBottom: geo.ys[ni] === geo.bottom,
              boxes: [{ left: gx, right: gx + geo.headW, bottom: geo.ys[ni] + gb.bBoxSW[1] * geo.mag, top: geo.ys[ni] + gb.bBoxNE[1] * geo.mag, head: true }],
            });
          });
        });
      }
    }
  });
  return (noteId) => map.get(noteId) ?? null;
}
