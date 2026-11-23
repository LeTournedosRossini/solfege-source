/*
 * Notes d'ornement en TABLATURE (tranche 4c-4). Module PUR. Les règles propres à la tablature viennent de MuseScore 4.7.5 et ont été
 * mesurées sur l'export E7 de Jean (3 préréglages : Full, Common, Simple) ; le reste (placement par `layoutGraceNotesGroup`, formes,
 * table de remplissage, ligatures d'ornements, barre d'acciaccature) est celui de la portée (`gracenotes.js`).
 *
 * Règles propres à la tablature :
 *  - taille `graceNoteMag` (0,7) : numéros de frette (boîte et glyphes), hampe, crochet, ligature, barre d'acciaccature ;
 *  - largeur de tête = `symWidth(noteheadBlack)` de Leland (1,3) × 0,7 ; hampe et numéro centrés sur la demi-tête ;
 *  - sens de hampe (`ChordLayout::computeUp`, tablature) : Simple = pas de hampe ; Common (hampes à côté) = vers le bas, ou parité de la
 *    voix si plusieurs voix ; Full (à travers) = règle ordinaire : un ornement monte (parité de la voix si plusieurs voix) ;
 *  - hampe à travers : `calcDefaultStemLength` ×1,5 avec l'échelle de l'accord (`tabThroughStemLength`, paramètre `mag`) ; départ à
 *    0,7 distance de lignes de la note extrême (indépendant de l'échelle) ; hampe à côté : départ fixe, longueur 3 × 0,7 ;
 *  - ligature d'ornements à côté de la portée : trait plat dont le CENTRE est à une demi-épaisseur NON réduite (0,25) de la pointe
 *    (mesuré : bord extérieur à 0,075 en retrait de la pointe), épaisseur 0,35 ;
 *  - espacement : le remplissage note → note entre deux numéros de frette est multiplié par 1,5 (`tabFretPaddingIncrease`,
 *    `computeNotePadding`) — ornement → principale 0,45 × 1,5, ornement → ornement 0,3 × 1,5 (mesuré : 1,532 et 1,156 sp entre axes) ;
 *  - dans la forme du segment principal, les hampes sont ignorées en tablature (`layoutGraceNotesGroup`).
 * Limites : pas de parenthèses ni de points sur un ornement ; dans le même accord principal, ornements avant ET après sont posés
 * comme en portée ; ligature d'ornements en Full : ancrages de `BeamTremoloLayout` (mêmes que les ligatures ordinaires), vérifiée
 * sur E7 (1 et 2 barres) ; barre d'acciaccature sur un groupe ligaturé non vérifiée sur export.
 */
import { PID, SID, getProperty } from '../model/index.js';
import { glyphItem, glyphWidth } from './header.js';
import { tabThroughStemLength, tabBesideStem, TAB_STEM_LEN } from './tabstems.js';
import { FLAG } from './chordgeom.js';
import { showsStemSlash, stemSlashLine, typedBoxes, minHorizontalDistance, graceBeamGroups } from './gracenotes.js';
import { beamCountOf, beamGroupLine, beamItems } from './beaming.js';
import { parenthesisPair, parenthesisOutside, TAB_PAREN_PAD } from './parentheses.js';

const STEM_CLEARANCE = 0.7; // départ de la hampe traversante, en distances de lignes
const translate = (boxes, dx) => boxes.map((b) => ({ ...b, left: b.left + dx, right: b.right + dx }));
const hasStemBase = (base) => base !== 'whole' && base !== 'breve';

/** Géométrie d'UN ornement de tablature, origine = x de l'accord (axe de la hampe = origine + demi-tête). */
function graceGeometry(chord, { ctx, h, up, beamed }) {
  const { glyphs, style, staff } = ctx;
  const preset = h.tabPreset(staff);
  const mag = style(SID.GRACE_NOTE_MAG);
  const ci = h.chordInfo({ item: chord, position: [0, 1] }, ctx, false);
  const base = getProperty(chord, PID.DURATION).base;
  const headW = h.TAB_HEAD_WIDTH * mag;
  const lines = h.lineCount(staff);
  const lineDist = h.TAB_LINE_DISTANCE;
  const hasStem = preset.stems && hasStemBase(base) && !getProperty(chord, PID.NO_STEM);
  const beams = beamed ? beamCountOf(base) : 0;
  const hook = hasStem && !beamed && Boolean(FLAG[base]);
  let spec = null;
  if (hasStem) {
    if (!preset.through) {
      const { startY } = tabBesideStem({ up, topY: (lines - 1) * lineDist, shortHalf: false });
      const length = TAB_STEM_LEN * mag; // `tabStemLength` × échelle de l'accord
      spec = { startY, tipY: up ? startY + length : startY - length, length };
    } else {
      const { length } = tabThroughStemLength({ up, upStr: ci.upStr, downStr: ci.downStr, beams, hook, lines, lineDist, style, mag });
      const far = up ? ci.lo : ci.hi;
      spec = {
        startY: up ? ci.hi + STEM_CLEARANCE * lineDist : ci.lo - STEM_CLEARANCE * lineDist,
        tipY: up ? far + length : far - length, length, far,
      };
    }
  }
  return { chord, ci, base, mag, up, beamed, beams, hook, hasStem, spec, headW, stemX: headW / 2, preset, lines, lineDist };
}

/** Éléments d'affichage d'un ornement dont l'origine est en `x0` ; `beamEnd` : ordonnée de fin de hampe imposée par la ligature. */
function graceItems(geo, x0, { ctx, h, beamEnd = null }) {
  const { glyphs, style } = ctx;
  const { ci, mag, up, spec } = geo;
  const items = [];
  const lineThickness = style(SID.STAFF_LINE_THICKNESS);
  for (const n of ci.notes) {
    if (n.hidden) continue;
    const box = h.fretBox(glyphs, n.dead, lineThickness);
    const w = n.w * mag;
    const nx = x0 + geo.stemX - w / 2;
    const y1 = n.y + box.bottom * mag;
    const y2 = n.y + box.top * mag;
    const parens = n.parens ? parenthesisPair({ left: nx, right: nx + w, top: y2, bottom: y1, pad: TAB_PAREN_PAD * mag, tab: true, ref: n.note.id }) : [];
    const mx1 = Math.min(nx, ...parens.map((p) => p.bbox.x1));
    const mx2 = Math.max(nx + w, ...parens.map((p) => p.bbox.x2));
    items.push({ kind: 'rect', role: 'fret-box', x: mx1 - h.FRET_PAD, y: y1 - h.FRET_PAD, w: mx2 - mx1 + h.FRET_PAD * 2, h: y2 - y1 + h.FRET_PAD * 2, fill: 'paper', ref: n.note.id, grace: true });
    let gx = nx;
    for (const name of n.names) {
      items.push(glyphItem(name, gx, n.y + box.base * mag, { ref: n.note.id, mag, grace: true }));
      gx += h.advanceOf(glyphs, name) * mag;
    }
    // ghost / parenthesised grace note: parentheses scaled like the number (height of its box)
    for (const p of parens) items.push({ ...p.item, grace: true });
  }
  let stem = null;
  if (spec) {
    const axis = x0 + geo.stemX;
    const thickness = style(SID.STEM_THICKNESS) * mag;
    const flagName = geo.hook ? `${FLAG[geo.base]}${up ? 'Up' : 'Down'}` : null;
    const anchor = flagName ? glyphs.glyphs[flagName].anchors[up ? 'stemUpNW' : 'stemDownSW'] : null;
    const endY = beamEnd ?? (anchor ? spec.tipY + anchor[1] * mag : spec.tipY);
    items.push({ kind: 'line', role: 'stem', x1: axis, x2: axis, y1: spec.startY, y2: endY, width: thickness, ref: geo.chord.id, grace: true });
    let flagRight = null;
    if (flagName) {
      items.push(glyphItem(flagName, axis - thickness / 2, spec.tipY, { ref: geo.chord.id, role: 'flag', mag, grace: true }));
      flagRight = axis - thickness / 2 + glyphs.glyphs[flagName].bbox.bBoxNE[0] * mag;
    }
    stem = { x: axis, endY, tipY: spec.tipY, thickness, flagRight };
  }
  return { items, stem };
}

/** Barre d'acciaccature d'un ornement (premier de sa ligature, ou isolé). */
function slashItem(geo, stem, ctx, h, { beamTip = null, beamAngle = null } = {}) {
  const line = stemSlashLine({
    up: geo.up, stemX: stem.x, stemWidth: stem.thickness, tipY: beamTip ?? stem.endY, mag: geo.mag, noteHeadWidth: h.TAB_HEAD_WIDTH,
    style: ctx.style, hookRight: beamTip === null ? stem.flagRight : null, beamAngle, beams: beamCountOf(geo.base),
  });
  return { kind: 'line', role: 'slash', x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2, width: line.width, cap: 'butt', ref: geo.chord.id, grace: true };
}

/** Boîtes typées (origine = x de l'ornement) : numéros de frette (largeur du texte × échelle), hampe, crochet, barre. */
function graceShape(geo, ctx, h, { voice, beamId, withSlash }) {
  const { glyphs } = ctx;
  const boxes = [];
  for (const n of geo.ci.notes) {
    const box = h.fretBox(glyphs, n.dead, ctx.style(SID.STAFF_LINE_THICKNESS));
    const w = (n.boxW ?? n.w) * geo.mag; // une note masquée (bend) garde sa boîte
    // parentheses are part of the box (spacing keeps them clear of the neighbours)
    const out = n.parens && !n.hidden ? parenthesisOutside((box.top - box.bottom) * geo.mag, true) : 0;
    boxes.push({
      type: 'note', fret: true, left: geo.stemX - w / 2 - out, right: geo.stemX + w / 2 + out, bottom: n.y + box.bottom * geo.mag, top: n.y + box.top * geo.mag,
      voice, beamId, mag: geo.mag, grace: true,
    });
  }
  const { items, stem } = graceItems(geo, 0, { ctx, h });
  boxes.push(...typedBoxes(items.filter((it) => it.role === 'stem' || it.role === 'flag'), glyphs, { voice, beamId, mag: geo.mag }).map((b) => ({ ...b, grace: true })));
  if (stem && withSlash && showsStemSlash(geo.chord)) {
    boxes.push(...typedBoxes([slashItem(geo, stem, ctx, h)], glyphs, { voice, beamId, mag: geo.mag }).map((b) => ({ ...b, grace: true })));
  }
  return boxes;
}

/** Boîtes d'un accord principal (origine = son x) pour le placement d'un groupe d'ornements : numéros de frette, hors hampes. */
export function tabMainBoxes(geom, voice) {
  const out = [];
  for (const n of geom.notes) {
    if (n.hidden) continue;
    const r = n.rects[0];
    out.push({ type: 'note', fret: true, left: r.x1, right: r.x2, bottom: r.y1, top: r.y2, voice, beamId: null, mag: 1 });
  }
  return out;
}

/**
 * Met en page un groupe d'ornements de tablature rattaché à une colonne (`TLayout::layoutGraceNotesGroup`).
 * @param graces    [{ chord, groupKey }] dans l'ordre temporel
 * @param mainBoxes boîtes de la colonne (origine = x de l'accord principal)
 * @returns { x (origine de chaque ornement / origine principale), left, geos, beamGroups }
 */
export function layoutTabGraceGroup(graces, mainBoxes, { ctx, h, voice = 0, multiVoice = false }) {
  const { style } = ctx;
  const preset = h.tabPreset(ctx.staff);
  const beamGroups = preset.stems ? graceBeamGroups(graces) : [];
  const beamIdOf = new Map();
  beamGroups.forEach((g, k) => g.forEach((i) => beamIdOf.set(i, `gb${k}`)));
  const geos = graces.map((g, i) => {
    const beamed = beamIdOf.has(i);
    let up;
    if (multiVoice) up = voice % 2 === 0;
    else if (!preset.through) up = false; // hampes à côté : `!tab->stemsDown()` (défaut : vers le bas)
    else {
      const explicit = getProperty(g.chord, PID.STEM_DIRECTION);
      up = !beamed && explicit && explicit !== 'auto' ? explicit === 'up' : true; // un ornement monte
    }
    return graceGeometry(g.chord, { ctx, h, up, beamed });
  });
  const shapes = geos.map((geo, i) => {
    const beamId = beamIdOf.get(i) ?? null;
    const firstOfBeam = beamId === null || beamGroups.find((g) => g.includes(i))[0] === i;
    return graceShape(geo, ctx, h, { voice, beamId, withSlash: firstOfBeam });
  });
  const offsets = new Array(graces.length).fill(0);
  let groupShape = [];
  for (let i = graces.length - 1; i >= 0; i--) {
    let offset = -Math.max(groupShape.length ? minHorizontalDistance(shapes[i], groupShape) : -Infinity, 0);
    if (i < graces.length - 1 && geos[i].hasStem) {
      const prev = geos[i + 1];
      if (prev.up !== geos[i].up) {
        const crossCorrection = geos[i].headW - geos[i].mag * style(SID.STEM_THICKNESS);
        offset += prev.up && !geos[i].up ? crossCorrection : -crossCorrection;
      }
    }
    offsets[i] = offset;
    groupShape = groupShape.concat(translate(shapes[i], offset));
  }
  // le groupe entier à gauche de la forme de la colonne, avec le filet de sécurité (`graceToMainNoteDist` + demi-largeur de la tête)
  const groupDist = mainBoxes.length ? minHorizontalDistance(groupShape, mainBoxes) : -Infinity;
  const last = geos[geos.length - 1];
  let xPos = -groupDist;
  xPos = Math.min(xPos, -(style(SID.GRACE_TO_MAIN_NOTE_DIST) + ((last.ci.notes[0].boxW ?? last.ci.notes[0].w) * last.mag) / 2));
  const x = offsets.map((o) => o + xPos);
  const left = Math.min(...groupShape.map((b) => b.left + xPos));
  // the boxes of the whole group, relative to the origin it is laid against (the main chord, or the bar line for trailing graces)
  const shape = groupShape.map((b) => ({ ...b, left: b.left + xPos, right: b.right + xPos }));
  return { x, left, geos, beamGroups, shape };
}

/** Éléments d'affichage d'un groupe d'ornements de tablature, l'origine de l'accord principal étant en `originX`. */
export function tabGraceGroupItems(layout, graces, originX, { ctx, h, voice = 0 }) {
  const { style, glyphs } = ctx;
  const { geos, beamGroups } = layout;
  const items = [];
  const mag = geos[0].mag;
  const thickness = style(SID.STEM_THICKNESS) * mag;
  const beamOf = new Map();
  const beamGeoms = [];
  const beamWidth = style(SID.BEAM_THICKNESS);
  for (const group of beamGroups) {
    const up = geos[group[0]].up;
    const preset = geos[group[0]].preset;
    const members = group.map((i) => {
      const geo = geos[i];
      const axis = originX + layout.x[i] + geo.stemX;
      const anchors = glyphs.glyphs.noteheadBlack.anchors[up ? 'stemUpSE' : 'stemDownNW'];
      const H = (geo.lines - 1) * geo.lineDist;
      const farDown = H - (up ? geo.ci.lo : geo.ci.hi); // y vers le bas depuis la ligne du haut
      return {
        x: axis, beams: geo.beams, info: { grace: true, tupletId: null }, dflt: 'auto',
        ms: {
          x: axis, farY: farDown, len: geo.spec.length, upLine: geo.ci.upStr, downLine: geo.ci.downStr, lines: geo.ci.notes.map((n) => n.string - 1),
          strokes: geo.beams, attachY: farDown - anchors[1] * mag, ys: [], mag,
        },
      };
    });
    let line;
    if (!preset.through) {
      // à côté de la portée : ligne plate ; le centre du trait est à (épaisseur NON réduite)/2 de la pointe, le trait lui-même est réduit
      const tip = geos[group[0]].spec.tipY;
      const outer = tip + (up ? -1 : 1) * (beamWidth / 2 - (beamWidth * mag) / 2);
      line = { at: () => outer, beamDist: 0.75 * mag };
    } else {
      line = beamGroupLine(members, up, {
        beamWidth, stemWidth: thickness, grace: true, staffLines: geos[group[0]].lines, staffHeight: (geos[group[0]].lines - 1) * geos[group[0]].lineDist,
      });
    }
    const half = (beamWidth * mag) / 2;
    group.forEach((i, k) => beamOf.set(i, { endY: line.at(members[k].x) + (up ? -half : half), tipY: line.at(members[k].x), group }));
    beamGeoms.push({ group, line, members, up });
    items.push(...beamItems(
      members, line, up ? 'up' : 'down',
      { thickness: beamWidth * mag, stemWidth: thickness, beamletLen: 1.1 * mag },
      graces[group[0]].chord.id,
    ).map((it) => ({ ...it, grace: true })));
  }
  const slashDone = new Set();
  // géométrie ABSOLUE de chaque ornement (même forme que `entry.tabGeom` d'un accord, rectangles y vers le haut) : relue par les liaisons
  // (`tabSlurItems` : slur partant d'un ornement) — `layout.anchors` : accord d'ornement → { geom, up, mag }
  layout.anchors = new Map();
  graces.forEach((g, i) => {
    const geo = geos[i];
    const x0 = originX + layout.x[i];
    const axis = x0 + geo.stemX;
    const notes = [];
    for (const n of geo.ci.notes) {
      const box = h.fretBox(glyphs, n.dead, ctx.style(SID.STAFF_LINE_THICKNESS));
      // boîte du numéro, même masqué : ancrage des bends (`tabBendItems`)
      const bw = (n.boxW ?? n.w) * geo.mag;
      const noteBox = { x1: axis - bw / 2, x2: axis + bw / 2, y1: n.y + box.bottom * geo.mag, y2: n.y + box.top * geo.mag };
      if (n.hidden) { notes.push({ id: n.note.id, y: n.y, hidden: true, string: n.string, pitch: n.note.pitch, rects: [], halfH: ((box.top - box.bottom) / 2) * geo.mag, noteBox }); continue; }
      const w = n.w * geo.mag;
      const nx = axis - w / 2;
      notes.push({
        id: n.note.id, y: n.y, hidden: false, string: n.string, pitch: n.note.pitch, halfH: ((box.top - box.bottom) / 2) * geo.mag,
        rects: [{ x1: nx, x2: nx + w, y1: n.y + box.bottom * geo.mag, y2: n.y + box.top * geo.mag }], noteBox,
      });
    }
    const spec = geo.spec;
    const stem = spec ? { x: axis, y1: spec.startY, y2: spec.tipY, width: style(SID.STEM_THICKNESS) * geo.mag, up: geo.up } : null;
    layout.anchors.set(g.chord.id, { geom: { axis, headW: geo.headW, notes, dots: [], stem, hook: null, tipY: spec ? spec.tipY : null, rest: null }, up: Boolean(geo.hasStem && geo.up), mag: geo.mag });
  });
  graces.forEach((g, i) => {
    const geo = geos[i];
    const beam = beamOf.get(i) ?? null;
    const x0 = originX + layout.x[i];
    const { items: its, stem } = graceItems(geo, x0, { ctx, h, beamEnd: beam ? beam.endY : null });
    items.push(...its);
    if (!stem || !showsStemSlash(g.chord)) return;
    const first = beam ? beam.group[0] === i : true;
    if (!first || (beam && slashDone.has(beam.group))) return;
    if (beam) slashDone.add(beam.group);
    let beamAngle = null;
    if (beam) {
      const bg = beamGeoms.find((b) => b.group === beam.group);
      const xa = bg.members[0].x;
      const xb = bg.members[bg.members.length - 1].x;
      beamAngle = xb > xa ? Math.atan((bg.line.at(xb) - bg.line.at(xa)) / (xb - xa)) : 0;
    }
    items.push(slashItem(geo, stem, ctx, h, { beamTip: beam ? beam.tipY : null, beamAngle }));
  });
  return items;
}
