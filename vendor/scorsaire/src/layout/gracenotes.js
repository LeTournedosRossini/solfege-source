/*
 * Notes d'ornement (appogiatures, acciaccatures, ornements courts) — tranche 3. Module PUR (sans DOM).
 *
 * Un ornement est un accord enfant de l'accord principal (`chord.graceNotes`, PID.GRACE_TYPE), sans durée dans la mesure.
 * Règles portées de MuseScore (chaque règle cite le fichier et la fonction ; rien n'est deviné) :
 *  - taille `Sid::graceNoteMag` = 0,7 (`styledef.cpp`, `Chord::intrinsicMag`) : têtes, hampes, crochets, altérations, lignes
 *    supplémentaires, ligatures (épaisseur et écart des barres) ;
 *  - sens de hampe `ChordLayout::computeUp` : un ornement monte TOUJOURS (plusieurs voix : parité de la voix) ;
 *  - longueur de hampe `StemLayout::calcDefaultStemLength` (`stemlength.js`, paramètre `mag`) ;
 *  - barre d'acciaccature `TLayout::layoutStemSlash` / `TDraw::draw(StemSlash)` : un TRAIT à bout plat (pas un glyphe), UNE seule
 *    par ligature ;
 *  - ligatures `BeamLayout::beamGraceNotes` : les ornements consécutifs plus courts qu'une noire d'un même groupe sont dans UNE
 *    ligature, coupée seulement par `beamBreak` ; géométrie `BeamTremoloLayout` (beamtremolo.js, `L.isGrace`) ;
 *  - placement horizontal `TLayout::layoutGraceNotesGroup` + `HorizontalSpacing::minHorizontalDistance` / `computePadding` /
 *    `computeNotePadding` + `PaddingTable::update` (`paddingtable.cpp`) : du DERNIER ornement vers le premier, chacun à gauche de
 *    la forme déjà posée, puis le groupe à gauche de la forme du segment, avec un filet de sécurité.
 * Limites (voir CLAUDE.md) : portée standard à 5 lignes ; pas de collision avec une autre voix (`posInfo.upGrace/downGrace`) ;
 * pas de tablature ; `PaddingTable` restreinte aux éléments présents dans un groupe d'ornements.
 */
import { PID, SID, getProperty } from '../model/index.js';
import { chordYs, headGlyph, accidentalPad, headOffsets, mirrorOverlap, FLAG } from './chordgeom.js';
import { stemTipY } from './stemlength.js';
import { noteheadEdgeAtAnchor } from './glyphmetrics.js';
import { glyphItem, glyphWidth } from './header.js';
import { scoreParentheses } from './parentheses.js';
import { LEDGER_HEAD_WIDTH } from './constants.js';
import { beamGroupLine, beamItems, beamCountOf } from './beaming.js';

const isAfter = (chord) => String(getProperty(chord, PID.GRACE_TYPE) ?? '').endsWith('after');

/** Faut-il dessiner la barre d'acciaccature ? `Chord::setNoteType` : défaut = acciaccature ; propriété locale prioritaire. */
export function showsStemSlash(chord) {
  const local = getProperty(chord, PID.SHOW_STEM_SLASH);
  return local === null ? getProperty(chord, PID.GRACE_TYPE) === 'acciaccatura' : local;
}

/**
 * Ornements d'un accord principal : { before: [chords], after: [chords] } dans l'ordre temporel.
 */
export function gracesOf(chord) {
  const list = chord.graceNotes ?? [];
  return { before: list.filter((g) => !isAfter(g)), after: list.filter(isAfter) };
}

// ---------- formes (Shape) et distances ----------

/** Table de remplissage (`PaddingTable::update`, en espaces ; spatium = 1) restreinte aux éléments d'une forme d'accord. */
const NOTE_BAR_DISTANCE = 1.5; // Sid::noteBarDistance
const ACCIDENTAL_NOTE_DISTANCE = 0.25; // Sid::accidentalNoteDistance
const LEDGER_LENGTH = 0.33; // Sid::ledgerLineLength
const LEDGER_PAD = 0.25;
const NOTE_TO_ACCIDENTAL = Math.max(ACCIDENTAL_NOTE_DISTANCE, 0.35);
const NOTE_TO_NOTE = 0.1;
const MIN_PAD = 0.1;
const PADDING = {
  note: { note: NOTE_TO_NOTE, ledger: 0.35, accidental: NOTE_TO_ACCIDENTAL, rest: 0.5, barline: NOTE_BAR_DISTANCE },
  ledger: {
    note: 0.35, ledger: LEDGER_PAD, accidental: Math.max(ACCIDENTAL_NOTE_DISTANCE, NOTE_TO_ACCIDENTAL - LEDGER_LENGTH / 2), rest: 0.35,
    barline: Math.max(NOTE_BAR_DISTANCE - LEDGER_LENGTH, LEDGER_PAD),
  },
  hook: { note: 0.35, ledger: Math.max(0.35 - LEDGER_LENGTH, LEDGER_PAD), accidental: 0.35, rest: 0.35, barline: 1.0 },
  rest: { note: 0.5, ledger: Math.max(0.5 - LEDGER_LENGTH / 2, LEDGER_PAD), accidental: 0.45, rest: 0.5 },
};
const tablePadding = (t1, t2) => PADDING[t1]?.[t2] ?? MIN_PAD;

const SAME_VOICE_LIMITED = new Set(['note', 'rest', 'stem']); // `isSameVoiceKerningLimited`

/**
 * Boîtes typées de la FORME d'un accord à partir de ses éléments d'affichage (`Chord::shape` : têtes, altérations, lignes
 * supplémentaires, hampe, crochet, barre d'acciaccature ; ni ligature, ni articulations).
 * @param meta { voice, beamId?, mag } — `mag` : échelle de l'élément (ornement : 0,7)
 */
export function typedBoxes(items, glyphs, meta) {
  const boxes = [];
  const add = (type, left, right, bottom, top, extra = {}) => boxes.push({ type, left, right, bottom, top, voice: meta.voice, beamId: meta.beamId ?? null, mag: meta.mag, ...extra });
  for (const it of items) {
    if (it.kind === 'glyph') {
      const b = glyphs.glyphs[it.name]?.bbox;
      if (!b) continue;
      const m = it.mag ?? 1;
      let type = null;
      if (it.role === 'accidental') type = 'accidental';
      else if (it.role === 'flag') type = 'hook';
      else if (!it.role) type = it.name.startsWith('rest') ? 'rest' : 'note';
      if (!type) continue;
      add(type, it.x + b.bBoxSW[0] * m, it.x + b.bBoxNE[0] * m, it.y + b.bBoxSW[1] * m, it.y + b.bBoxNE[1] * m);
    } else if (it.kind === 'line') {
      const h = it.width / 2;
      const x1 = Math.min(it.x1, it.x2);
      const x2 = Math.max(it.x1, it.x2);
      const y1 = Math.min(it.y1, it.y2);
      const y2 = Math.max(it.y1, it.y2);
      if (it.role === 'stem') add('stem', x1 - h, x2 + h, y1, y2);
      else if (it.role === 'ledger') add('ledger', x1, x2, y1 - h, y2 + h);
      else if (it.role === 'slash') add('slash', x1 - h, x2 + h, y1 - h, y2 + h);
    }
  }
  return boxes;
}

const intersects = (a1, a2, b1, b2, clearance) => a1 - clearance < b2 && a2 + clearance > b1;

/** Remplissage entre deux éléments (`HorizontalSpacing::computePadding` + `computeNotePadding`), `graceKind` : 'grace' | 'main'. */
function paddingBetween(r1, r2, kinds) {
  let padding = tablePadding(r1.type, r2.type);
  const scaling = (r1.mag + r2.mag) / 2;
  if (r1.type === 'note' && (r2.type === 'note' || r2.type === 'rest' || r2.type === 'stem')) {
    // `computeNotePadding` : même voix et formes qui se recoupent → `minNoteDistance` (0,35)
    if (r1.voice === r2.voice && intersects(r1.bottom, r1.top, r2.bottom, r2.top, 0) && intersects(r1.left, r1.right, r2.left, r2.right, 0)) {
      padding = Math.max(padding, 0.35);
    }
    padding *= scaling;
    if (r2.type === 'note' || r2.type === 'rest') {
      if (kinds(r1) === 'grace' && kinds(r2) === 'grace') padding = Math.max(padding, 0.3); // graceToGraceNoteDist
      else if (kinds(r1) === 'grace' || kinds(r2) === 'grace') padding = Math.max(padding, 0.45); // graceToMainNoteDist (les deux sens)
      if (r1.fret && r2.type === 'note') padding *= 1.5; // numéro de frette (tablature) : `tabFretPaddingIncrease`
    }
  } else {
    padding *= scaling;
  }
  return padding;
}

/**
 * `HorizontalSpacing::minHorizontalDistance(f, s)` : distance minimale entre la forme `f` (à gauche) et `s` (à droite), en espaces.
 * Les éléments d'une même voix de type note/silence/hampe ne se « glissent » jamais l'un sous l'autre (`NON_KERNING`) ; les
 * autres ne comptent que s'ils se recoupent verticalement (dégagement 0,2 esp., 0,1 si le 2e est une altération). La barre
 * d'acciaccature peut chevaucher les éléments de sa propre ligature (`computeStemSlashKerningType`).
 */
export function minHorizontalDistance(f, s) {
  let dist = -Infinity;
  const kinds = (r) => (r.grace ? 'grace' : 'main');
  for (const r2 of s) {
    for (const r1 of f) {
      if (r1.type === 'slash' && r1.beamId && r1.beamId === r2.beamId) continue; // ALLOW_COLLISION
      const clearance = r2.type === 'accidental' ? 0.1 : 0.2;
      const intersection = intersects(r1.bottom, r1.top, r2.bottom, r2.top, clearance);
      const padding = Math.max(paddingBetween(r1, r2, kinds), 0.1);
      const nonKerning = SAME_VOICE_LIMITED.has(r1.type) && SAME_VOICE_LIMITED.has(r2.type) && r1.voice === r2.voice;
      if (nonKerning || intersection || r1.right - r1.left === 0 || r2.right - r2.left === 0) {
        dist = Math.max(dist, r1.right - r2.left + padding);
      }
    }
  }
  return dist;
}

const translate = (boxes, dx) => boxes.map((b) => ({ ...b, left: b.left + dx, right: b.right + dx }));

// ---------- géométrie d'un ornement ----------

/** Barre d'acciaccature (`TLayout::layoutStemSlash`). Repère de portée (y vers le haut) ; `s` = +1 hampe montante, −1 descendante. */
export function stemSlashLine({ up, stemX, stemWidth, tipY, mag, noteHeadWidth, style, hookRight = null, beamAngle = null, beams = 1 }) {
  const s = up ? 1 : -1;
  const thickness = style(SID.STEM_SLASH_THICKNESS) * mag;
  const leftHang = (noteHeadWidth * mag) / 2;
  let angle = (style(SID.STEM_SLASH_ANGLE) * Math.PI) / 180;
  const straight = style(SID.USE_STRAIGHT_NOTE_FLAGS);
  const hook = hookRight !== null;
  const startX = stemX + stemWidth / 2 - leftHang;
  const startY = tipY - s * mag * style(SID.STEM_SLASH_POSITION) * (straight || !hook ? 0.66 : 1);
  let endX;
  let endY;
  if (hook) {
    if (beams >= 2 && !straight) angle *= 1.2; // polices à crochets « épais » (Bravura)
    endX = hookRight;
    endY = startY + s * (endX - startX) * Math.tan(angle);
  } else if (beamAngle !== null) {
    angle += (s * beamAngle) / 2;
    let length = 2;
    if (s * beamAngle > 0) length *= 1.1; // angle obtus : un peu plus longue
    endX = startX + length * Math.cos(angle);
    endY = startY + s * length * Math.sin(angle);
  } else {
    const rightHang = (noteHeadWidth * mag) / 2 - stemWidth;
    endX = stemX + stemWidth / 2 + rightHang;
    endY = startY + s * (endX - startX) * Math.tan(angle);
  }
  return { x1: startX, y1: startY, x2: endX, y2: endY, width: thickness };
}

/**
 * Géométrie d'UN ornement (hors ligature) : positions, sens, têtes décalées, pointe de hampe par défaut.
 * @param beams  nombre de barres de ligature de la durée (0 si l'ornement n'est pas ligaturé)
 */
function graceGeometry(chord, { clefKey, keySig, style, glyphs, up, beamed, lines = 5 }) {
  const mag = style(SID.GRACE_NOTE_MAG);
  const ys = chordYs(chord, clefKey, keySig);
  const base = getProperty(chord, PID.DURATION).base;
  // percussion : tête propre à chaque son (positionneur dans `clefKey`) ; sinon tête ordinaire de la durée
  const drum = clefKey && clefKey.perc ? clefKey : null;
  const head = drum ? drum.chordHead(chord, base) : headGlyph(base);
  const headOf = drum ? (note) => drum.noteHead(note, base) : () => head;
  const headW = glyphWidth(glyphs, head) * mag;
  const dx = headOffsets(ys, up, headW, mirrorOverlap(base, style) * mag);
  const hasStem = base !== 'whole' && base !== 'breve' && !getProperty(chord, PID.NO_STEM);
  const hook = hasStem && !beamed && Boolean(FLAG[base]);
  const beamsOfBase = beamCountOf(base);
  const tip = hasStem
    ? stemTipY({ up, ys, beams: beamed ? beamsOfBase : 0, hook, style, mag, durationBeams: beamsOfBase, lines })
    : null;
  return { lines, chord, ys, base, head, headOf, headW, dx, hasStem, hook, tip, up, mag, beamed, top: Math.max(...ys), bottom: Math.min(...ys) };
}

/** x de l'axe de la hampe pour une tête posée en `x` (échelle de l'ornement). */
function graceStemX(glyphs, x, geo, thickness) {
  return geo.up
    ? x + noteheadEdgeAtAnchor(glyphs, 'noteheadBlack', 'stemUpSE') * geo.mag - thickness / 2
    : x + noteheadEdgeAtAnchor(glyphs, 'noteheadBlack', 'stemDownNW') * 0.5 * geo.mag;
}

/**
 * Éléments d'affichage d'un ornement posé en `x` (origine de sa tête). `beamTip` (ordonnée de la pointe imposée par la ligature)
 * ou null. Renvoie { items, stem: { x, endY, tipY, thickness, flagRight } | null }.
 */
function graceChordItems(geo, x, { glyphs, style, accidentals, beamTip = null, lineOffsets = true, ghosts = null }) {
  const { chord, ys, head, headOf, dx, up, mag } = geo;
  const items = [];
  const ext = style(SID.LEDGER_LINE_EXTENSION) * mag;
  const ledgerWidth = style(SID.LEDGER_LINE_THICKNESS) * mag;
  const ledgers = new Map();
  chord.notes.forEach((note, i) => {
    const y = ys[i];
    const hx = x + dx[i];
    const noteHead = headOf(note);
    items.push(glyphItem(noteHead, hx, y, { ref: note.id, mag, grace: true }));
    // note fantôme (départ d'un pre-bend / pre-dive sur portée) : parenthèses à l'échelle de l'ornement
    if (ghosts && ghosts.has(note.id)) {
      const hb = glyphs.glyphs[noteHead].bbox;
      const scaled = { bbox: { bBoxNE: [hb.bBoxNE[0] * mag, hb.bBoxNE[1] * mag], bBoxSW: [hb.bBoxSW[0] * mag, hb.bBoxSW[1] * mag] } };
      for (const q of scoreParentheses({ left: hx, width: glyphWidth(glyphs, noteHead) * mag, y, glyph: scaled, ref: note.id })) items.push({ ...q.item, grace: true });
    }
    const acc = accidentals.get(note.id);
    if (acc) {
      const accX = hx - (glyphWidth(glyphs, acc) + accidentalPad(y, style, geo.lines) * 1) * mag;
      items.push(glyphItem(acc, accX, y, { ref: note.id, role: 'accidental', mag, grace: true }));
    }
    const need = [];
    if (y < 0) for (let l = -1; l >= Math.ceil(y); l--) need.push(l);
    if (y > geo.lines - 1) for (let l = geo.lines; l <= Math.floor(y); l++) need.push(l);
    for (const l of need) {
      const x1 = hx - ext;
      const x2 = hx + LEDGER_HEAD_WIDTH * mag + ext;
      const cur = ledgers.get(l);
      ledgers.set(l, cur ? { x1: Math.min(cur.x1, x1), x2: Math.max(cur.x2, x2), ref: cur.ref } : { x1, x2, ref: note.id });
    }
  });
  for (const [l, seg] of ledgers) items.push({ kind: 'line', role: 'ledger', x1: seg.x1, x2: seg.x2, y1: l, y2: l, width: ledgerWidth, ref: seg.ref, grace: true });

  let stem = null;
  if (geo.hasStem) {
    const thickness = style(SID.STEM_THICKNESS) * mag;
    const anchors = glyphs.glyphs[head].anchors;
    const stemX = graceStemX(glyphs, x, geo, thickness);
    const tipY = beamTip ?? geo.tip;
    const foot = up ? geo.bottom + anchors.stemUpSE[1] * mag : geo.top + anchors.stemDownNW[1] * mag;
    const flagName = geo.hook ? `${FLAG[geo.base]}${up ? 'Up' : 'Down'}` : null;
    const flagAnchor = flagName ? glyphs.glyphs[flagName].anchors[up ? 'stemUpNW' : 'stemDownSW'] : null;
    const endY = flagAnchor ? tipY + flagAnchor[1] * mag : tipY;
    items.push({ kind: 'line', role: 'stem', x1: stemX, x2: stemX, y1: foot, y2: endY, width: thickness, ref: chord.id, grace: true });
    let flagRight = null;
    if (flagName) {
      items.push(glyphItem(flagName, stemX, tipY, { ref: chord.id, role: 'flag', mag, grace: true }));
      flagRight = stemX + glyphs.glyphs[flagName].bbox.bBoxNE[0] * mag;
    }
    stem = { x: stemX, endY, tipY, thickness, flagRight, foot };
  }
  return { items, stem };
}

// ---------- ligatures d'un groupe d'ornements ----------

/**
 * Sous-groupes ligaturés (`BeamLayout::beamGraceNotes`) : ornements consécutifs d'un même groupe plus courts qu'une noire ; un
 * `beamBreak` commence une nouvelle ligature ; un seul ornement isolé = crochet. Renvoie des tableaux d'indices (≥ 2 éléments).
 */
export function graceBeamGroups(graces) {
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length >= 2) groups.push(cur); cur = []; };
  graces.forEach((g, i) => {
    const beamable = beamCountOf(getProperty(g.chord, PID.DURATION).base) > 0 && !getProperty(g.chord, PID.NO_STEM);
    const sameOwner = i > 0 && graces[i - 1].groupKey === g.groupKey;
    if (!beamable || !sameOwner || getProperty(g.chord, PID.BEAM_BREAK)) flush();
    if (beamable) cur.push(i);
  });
  flush();
  return groups;
}

// ---------- groupe d'ornements ----------

/**
 * Met en page un groupe d'ornements rattaché à UNE colonne (`TLayout::layoutGraceNotesGroup`).
 * @param graces    [{ chord, groupKey }] dans l'ordre temporel (groupKey : même valeur pour les ornements d'une même liste avant/après)
 * @param mainBoxes formes (boîtes typées) des éléments de la colonne sur cette portée, origine = origine de la tête principale
 * @param opts      { glyphs, style, clefKey, keySig, accidentals (Map note → glyphe), voice, multiVoice, noteHeadWidth }
 * @returns { x: [décalage de la tête de chaque ornement / tête principale], left, geo, groups (ligatures), boxes }
 */
export function layoutGraceGroup(graces, mainBoxes, opts) {
  const { glyphs, style, clefKey, keySig, voice = 0, multiVoice = false, lines = 5 } = opts;
  const beamGroups = graceBeamGroups(graces);
  const beamIdOf = new Map();
  beamGroups.forEach((g, k) => g.forEach((i) => beamIdOf.set(i, `gb${k}`)));
  const groupUp = multiVoice ? voice % 2 === 0 : true; // `BeamLayout::layout1` / `computeUp` : ornement → haut, ou parité de la voix
  const geos = graces.map((g, i) => {
    const explicit = getProperty(g.chord, PID.STEM_DIRECTION);
    const beamed = beamIdOf.has(i);
    // ligature : le sens vient de la ligature (`Beam::direction`, posé par l'utilisateur) ; on le lit sur le 1er membre qui en a un
    let dir = explicit;
    if (beamed) {
      const grp = beamGroups.find((gr) => gr.includes(i));
      const first = grp.map((k) => getProperty(graces[k].chord, PID.STEM_DIRECTION)).find((d) => d !== 'auto');
      dir = first ?? 'auto';
    }
    const up = dir !== 'auto' ? dir === 'up' : groupUp;
    return graceGeometry(g.chord, { clefKey, keySig, style, glyphs, up, beamed, lines });
  });

  // forme de chaque ornement seul (origine de la tête = 0) ; la barre d'acciaccature (1re d'une ligature) est incluse
  const shapes = geos.map((geo, i) => {
    const { items, stem } = graceChordItems(geo, 0, { glyphs, style, accidentals: opts.accidentals });
    const beamId = beamIdOf.get(i) ?? null;
    const boxes = typedBoxes(items, glyphs, { voice, beamId, mag: geo.mag }).map((b) => ({ ...b, grace: true }));
    const firstOfBeam = beamId === null || beamGroups.find((g) => g.includes(i))[0] === i;
    if (stem && firstOfBeam && showsStemSlash(graces[i].chord)) {
      const slash = stemSlashLine({
        up: geo.up, stemX: stem.x, stemWidth: stem.thickness, tipY: stem.endY, mag: geo.mag, noteHeadWidth: glyphWidth(glyphs, 'noteheadBlack'),
        style, hookRight: stem.flagRight, beams: beamCountOf(geo.base),
      });
      boxes.push(...typedBoxes([{ kind: 'line', role: 'slash', x1: slash.x1, y1: slash.y1, x2: slash.x2, y2: slash.y2, width: slash.width }], glyphs, { voice, beamId, mag: geo.mag })
        .map((b) => ({ ...b, grace: true })));
    }
    return boxes;
  });

  // du DERNIER ornement vers le premier : chacun à gauche de la forme déjà posée
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
  // le groupe entier, à gauche de la forme de la colonne, avec un filet de sécurité (`graceToMainNoteDist` + demi-tête)
  const groupDist = mainBoxes.length ? minHorizontalDistance(groupShape, mainBoxes) : -Infinity;
  const lastHeadW = geos[geos.length - 1].headW;
  let xPos = -groupDist;
  xPos = Math.min(xPos, -(style(SID.GRACE_TO_MAIN_NOTE_DIST) + lastHeadW / 2));
  const x = offsets.map((o) => o + xPos);
  const boxes = groupShape.map((b) => ({ ...b, left: b.left + xPos, right: b.right + xPos }));
  const left = Math.min(...boxes.map((b) => b.left));
  return { x, left, geos, beamGroups, boxes };
}

/**
 * Éléments d'affichage d'un groupe déjà mis en page, la tête principale étant en `originX`.
 * @param accidentals Map note → glyphe d'altération
 */
export function graceGroupItems(layout, graces, originX, { glyphs, style, accidentals, voice = 0, ghosts = null }) {
  const items = [];
  const { geos, beamGroups } = layout;
  const beamOf = new Map(); // indice d'ornement → { tipY, group }
  const beamGeoms = [];
  const thickness = style(SID.STEM_THICKNESS) * geos[0].mag;
  for (const group of beamGroups) {
    const up = geos[group[0]].up;
    const members = group.map((i) => {
      const geo = geos[i];
      const x = originX + layout.x[i];
      const stemX = graceStemX(glyphs, x, geo, thickness);
      const beams = beamCountOf(geo.base);
      const farUp = up ? Math.min(...geo.ys) : Math.max(...geo.ys);
      const attach = glyphs.glyphs.noteheadBlack.anchors[up ? 'stemUpSE' : 'stemDownNW'][1] * geo.mag;
      return {
        x: stemX, beams, info: { grace: true, tupletId: null }, dflt: 'auto',
        ms: {
          x: stemX, farY: (geo.lines - 1) - farUp, len: Math.abs(geo.tip - farUp), upLine: Math.round(2 * (geo.lines - 1) - 2 * geo.top), downLine: Math.round(2 * (geo.lines - 1) - 2 * geo.bottom),
          strokes: beams, attachY: (geo.lines - 1) - farUp - attach, ys: geo.ys, mag: geo.mag,
        },
      };
    });
    const line = beamGroupLine(members, up, { beamWidth: style(SID.BEAM_THICKNESS), stemWidth: thickness, grace: true, staffLines: geos[0].lines, staffHeight: geos[0].lines - 1 });
    group.forEach((i, k) => beamOf.set(i, { tipY: line.at(members[k].x), group }));
    beamGeoms.push({ group, line, members, up });
    items.push(...beamItems(
      members, line, up ? 'up' : 'down',
      { thickness: style(SID.BEAM_THICKNESS) * geos[0].mag, stemWidth: thickness, beamletLen: 1.1 * geos[0].mag },
      graces[group[0]].chord.id,
    ).map((it) => ({ ...it, grace: true })));
  }
  const slashDone = new Set();
  graces.forEach((g, i) => {
    const geo = geos[i];
    const beam = beamOf.get(i) ?? null;
    const x = originX + layout.x[i];
    const { items: its, stem } = graceChordItems(geo, x, { glyphs, style, accidentals, beamTip: beam ? beam.tipY : null, ghosts });
    items.push(...its);
    if (!stem || !showsStemSlash(g.chord)) return;
    const first = beam ? beam.group[0] === i : true;
    if (!first || (beam && slashDone.has(beam.group))) return;
    if (beam) slashDone.add(beam.group);
    let beamAngle = null;
    if (beam) {
      const bg = beamGeoms.find((b) => b.group === beam.group);
      const x1 = bg.members[0].x;
      const x2 = bg.members[bg.members.length - 1].x;
      beamAngle = x2 > x1 ? Math.atan((bg.line.at(x2) - bg.line.at(x1)) / (x2 - x1)) : 0;
    }
    const slash = stemSlashLine({
      up: geo.up, stemX: stem.x, stemWidth: stem.thickness, tipY: beam ? beam.tipY : stem.endY, mag: geo.mag,
      noteHeadWidth: glyphWidth(glyphs, 'noteheadBlack'), style, hookRight: beam ? null : stem.flagRight, beamAngle, beams: beamCountOf(geo.base),
    });
    items.push({ kind: 'line', role: 'slash', x1: slash.x1, y1: slash.y1, x2: slash.x2, y2: slash.y2, width: slash.width, cap: 'butt', ref: g.chord.id, grace: true });
  });
  return items;
}
