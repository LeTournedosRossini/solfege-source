/*
 * Peintre « tablature » — préréglages SIMPLE / COMMON / FULL de MuseScore 4.7.5 (`dom/stafftype.cpp`, `tab6StrSimple/Common/Full`),
 * choisis par la propriété de portée `PID.TAB_STYLE` (défaut Scorsaire : 'full'). Tranche 4b : hampes, ligatures, crochets, points,
 * barres obliques des blanches, n-olets (voir `../tabstems.js`). Tranche 4a : lignes espacées de 1,5 sp, clé TAB (4 cordes si ≤ 4 lignes, sinon 6 cordes, comme
 * `Staff::clefType`) masquée après le 1er système (`hideTabClefAfterFirst`), chiffrage centré, numéros de frette en TEXTE de la
 * police « MuseScore Tab Sans » (FreeSans 9 pt : contours embarqués, `tabFret0-9`, voir tools/add-tabfont.py) centrés sur la ligne
 * de leur corde, note étouffée = « X » sans numéro, silences (`RestLayout::computeNaturalLine`).
 * Le numéro de frette est DÉRIVÉ (hauteur − corde à vide, roadmap §2) : jamais stocké. Limites (4b-4e) : pas encore de hampes/ligatures,
 * techniques et harmoniques (4d), capo et lettres d'accordage (4e), parenthèses des notes fantômes (à la suite de 4a).
 */
import { staffTextItems } from '../stafftexts.js';
import { staffTextEntryItems } from '../stafftextentries.js';
import { lyricsItems } from '../lyrics.js';
import { fingeringItems, staffHasFingering, lhFingeringLead } from '../fingering.js';
import { PID, SID, getProperty, midiFromSpelling, NO_CAPO, derivedFret } from '../../model/index.js';
import { noteSpace, entrySpace } from '../spacing.js';
import { rectsOf } from '../bounds.js';
import { glyphItem, glyphWidth } from '../header.js';
import { sequentialEntries, restGlyphName, restX, hideIfInvisible } from './common.js';
import { buildBeamGroups, beamGroupLine, beamItems, beamCountOf, beamedRestShift } from '../beaming.js';
import { tupletGroups, tupletItems } from '../tuplets.js';
import { tabThroughStemLength, tabBesideStem, tabSlashItems, TAB_SLASH_BLOCK_HEIGHT, TAB_DOT_DIST_X } from '../tabstems.js';
import { FLAG } from '../chordgeom.js';
import { BARLINE_THIN_W } from '../constants.js';
import { parenthesisPair, hasParentheses, parenthesisOutside, TAB_PAREN_PAD } from '../parentheses.js';
import { fEq } from '../../model/fraction.js';
import { staffTieBackIds, staffGlissandoStartIds, staffGlissandoEndChordIds } from './resolved.js';
import { gracesOf } from '../gracenotes.js';
import { tabMainBoxes, layoutTabGraceGroup, tabGraceGroupItems } from '../tabgrace.js';
import { fCmp, fAdd } from '../../model/fraction.js';
import { hookMetrics, singleTremoloItems, tremoloMinStemLength, tremoloStyle, tremoloBBoxHeight } from '../tremolo.js';
import { articulationItems } from '../articulations.js';
import { dynamicItems } from '../dynamics.js';
import { staffAbove, staffHairpins, staffBends, staffTwoChordTremolos, staffHasLyrics } from './resolved.js';
import { spannerSegmentType, hairpinWedgeLines, HAIRPIN_LINE_WIDTH } from '../hairpins.js';
import { scoreWheelItems } from '../scorewheels.js';
import { tabTieItems, tabSlurItems, tabGlissandoItems, tabBendItems, tabTappingItems } from '../tabspanners.js';
import { tabTechLineItems } from '../techlines.js';
import { pedalItems } from '../pedaldisplay.js';
import { trillLineItems } from '../trilllines.js';
import { writtenBaseOfPair, tabTwoChordTremoloLayout, insetTremoloItems } from '../tremolotwo.js';
import { chordLineLayout } from '../chordline.js';
import { arpeggioLayout } from '../arpeggio.js';
import { tappingEntry } from '../tapping.js';
import { layoutChordGroup } from '../chordvoices.js';

const STANDARD_TUNING = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];
const STRING_GAUGE = [0.8, 0.9, 1.0, 1.15, 1.35, 1.6]; // épaisseur relative, corde 1 (fine) → corde 6 (grosse) — prototype (MuseScore : uniforme)
export const TAB_LINE_DISTANCE = 1.5; // `lineDistance` des préréglages de tablature 4.7.5
const FRET_PAD = 0.1; // Sid::tabFretPadding : marge de la zone où les lignes sont coupées autour d'un chiffre
const NOTE_GAP = 0.6; // largeur minimale entre deux chiffres successifs d'une même voix (réglage du prototype, avant le PaddingTable)
const TAB_CLEF_MAG = 5.215 / 6.048; // MESURÉ : la clé TAB des exports (Leland, 5,215 sp de haut) rapportée à Bravura (6,048 sp)
// Boîte des chiffres : hauteur de la boîte « 0-9 » de la police, MESURÉE 1,3425 sp sur les exports (1,3247 par le calcul théorique).
const FRET_BOX_HALF_HEIGHT = 1.3425 / 2;
const TAB_REST_CLEARANCE = 0; // pas de dégagement de silence entre voix (non porté)

/** 'E4', 'F#3', 'Bb2' → hauteur MIDI. */
export function pitchFromName(name) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`Nom de hauteur invalide : ${name}`);
  return midiFromSpelling({ step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) });
}

const LETTER_SHIFT_LEFT = 0.2; // sp
const LETTER_SIZE = 0.85 * 0.9 * 9 / ((1.75 * 72) / 25.4); // 9 pt − 15 % puis − 10 % (demandes de Jean 04/10/2026)
const LETTER_GAP = 0.9; // espace entre les lettres et la clé
const tuningOf = (staff) => (getProperty(staff, PID.TUNING) ?? STANDARD_TUNING).map(pitchFromName);
const lineCount = (staff) => tuningOf(staff).length;
/** Hauteur (espaces, depuis la ligne du bas) de la ligne de la corde `string` (1 = corde la plus aiguë = ligne du haut). */
const lineY = (staff, string) => (lineCount(staff) - string) * TAB_LINE_DISTANCE;
const middleY = (staff) => ((lineCount(staff) - 1) * TAB_LINE_DISTANCE) / 2;

const advanceOf = (glyphs, name) => glyphs.glyphs[name].advance ?? glyphWidth(glyphs, name);
const FRET_CHAR = { '<': 'tabFretLess', '>': 'tabFretGreater', '.': 'tabFretPeriod', ' ': 'tabFretSpace' };
/** Texte de frette en glyphes. Harmonique (`layoutNote` 4.7.5) : naturel « <hf> », artificiel « fret <hf> » ; `hf` = frette de touche. */
const fretGlyphs = (fret, dead, display = 'none', hf = 0) => {
  let text = dead ? 'X' : String(fret);
  if (!dead && display === 'artificial') text = `${text} <${hf}>`;
  else if (!dead && display === 'natural') text = `<${hf}>`;
  return [...text].map((c) => (c === 'X' ? 'tabFretX' : FRET_CHAR[c] ?? `tabFret${c}`));
};
const fretTextWidth = (glyphs, names) => names.reduce((w, n) => w + advanceOf(glyphs, n), 0);

/** Frette affichée = hauteur stockée − corde à vide − capo (`StringData::fret`, voir `model/capo.js`) ; `capo` = capo en vigueur à la position de la note. */
/** Stem direction chosen by the user for a chord (`PID.STEM_DIRECTION`): true = up, false = down, null = automatic. */
const userStemUp = (item) => { if (item.type !== 'chord') return null; const d = getProperty(item, PID.STEM_DIRECTION); return d === 'up' ? true : d === 'down' ? false : null; };

function fretOf(note, staff, capo = NO_CAPO, tuning = null) {
  const string = getProperty(note, PID.STRING);
  return derivedFret(note.pitch, (tuning ?? tuningOf(staff))[string - 1], capo, string);
}
/** Capo en vigueur pour les notes d'ornement (celui de l'accord principal), renseigné par `entries()`. */
const GRACE_CAPO = new WeakMap();
/** Tuning in force for the ornament notes (the principal chord's), set by `entries()`; null = the staff's own tuning. */
const GRACE_TUNING = new WeakMap();

/**
 * Position verticale du texte d'une note (port de `StaffType::setFretMetrics`, repère y vers le HAUT) : `base` = ordonnée de la
 * ligne de base du texte par rapport à la ligne de la corde ; `top`/`bottom` = boîte où les lignes sont coupées (sans marge).
 * Chiffres : le « 0 » est centré sur la ligne ; X : centré sur sa hauteur de capitale, plus une demi-épaisseur de ligne vers le bas.
 */
function fretBox(glyphs, dead, lineThickness) {
  if (dead) {
    const x = glyphs.glyphs.tabFretX.bbox;
    const base = -(x.bBoxNE[1] / 2 + lineThickness / 2);
    return { base, top: base + x.bBoxNE[1], bottom: base };
  }
  const zero = glyphs.glyphs.tabFret0.bbox;
  const base = -(zero.bBoxNE[1] + zero.bBoxSW[1]) / 2;
  return { base, top: FRET_BOX_HALF_HEIGHT, bottom: -FRET_BOX_HALF_HEIGHT };
}

const PRESETS = {
  simple: { stems: false, timeSig: false, rests: false, through: false, minim: 'none', showFingering: false },
  common: { stems: true, timeSig: true, rests: true, through: false, minim: 'shorter', showFingering: true },
  full: { stems: true, timeSig: true, rests: true, through: true, minim: 'slashed', showFingering: true },
};
/** Préréglage de la portée (`PID.TAB_STYLE`, défaut 'full'). */
export const tabPreset = (staff) => PRESETS[getProperty(staff, PID.TAB_STYLE)] ?? PRESETS.full;

const STEM_CLEARANCE = 0.7; // hampe traversante : départ à 0,7 distance de lignes de la note extrême
const DOT_NOTE_DISTANCE = 0.5; // Sid::dotNoteDistance
const DOT_DOT_DISTANCE = 0.65; // Sid::dotDotDistance (hampes à côté de la portée)
const DOT_BESIDE_Y = 3.0 * 0.2; // `TDraw::draw(Stem)` : points à 0,2 × longueur de hampe par défaut du départ de la hampe

const baseOf = (item) => getProperty(item, PID.DURATION).base;
const dotsOf = (item) => getProperty(item, PID.DURATION).dots ?? 0;
/** `layoutTablature` : `headWidth = symWidth(noteheadBlack)` règle l'axe de hampe (½) et les points. Aucune tête n'est dessinée en tablature : on
 *  prend la valeur de la police de MuseScore (Leland, 1,3 sp — déduite des points de l'export de Jean : axe + 0,65 + 0,375 = 1,0251 sp), pas
 *  celle de Bravura brut (1,18). */
const TAB_HEAD_WIDTH = 1.3;
const hasStemBase = (base) => base !== 'whole' && base !== 'breve' && base !== 'measure';

/** Valeur ÉCRITE d'un accord : sa durée réelle, sauf dans un trémolo à deux accords (le double, `Chord::setTremoloTwoChord`, voir ../tremolotwo.js). */
const writtenBaseOf = (entry) => (entry.tremoloPair ? entry.tremoloPair.writtenBase : baseOf(entry.item));

/**
 * Numéro d'une note liée (`Note::shouldHideFret`, MuseScore 4.7.5) : une note qui REÇOIT un tie voit son numéro masqué ou entre parenthèses
 * selon `TAB_SHOW_TIED_FRET` / `TAB_PARENTHESIZE_TIED_FRET`. Toujours affiché (sans parenthèses générées) si l'accord porte une articulation
 * (hors point d'orgue : chez MuseScore c'est une annotation de segment) ou si la note démarre un glissando (`shouldForceShowFret`).
 * `isStartOfSystem` : inconnu pendant le calcul des largeurs (le système n'est pas encore décidé) → on le suppose vrai, c.-à-d. qu'on réserve la
 * place du numéro ; connu au dessin (`ctx.systemFirst`, 1re mesure du système).
 * @returns { hidden, generated } — `generated` : parenthèses ajoutées par le tie (`ChordLayout::layoutNote2` : `tieBackParen` = note liée, mode ≠ tieAndFret, non masquée)
 */
function tiedFretState(note, entry, ctx) {
  if (!staffTieBackIds(ctx, ctx.staff).has(note.id)) return { hidden: false, generated: false };
  const show = ctx.style(SID.TAB_SHOW_TIED_FRET);
  const force = ctx.style(SID.PARENTHESIZE_TIED_FRET_IF_ARTICULATION)
    && (getProperty(entry.item, PID.ARTICULATIONS).some((a) => !a.type.startsWith('fermata')) || staffGlissandoStartIds(ctx, ctx.staff).has(note.id));
  if (show === 'tieAndFret') return { hidden: false, generated: false };
  if (force) return { hidden: false, generated: true }; // affiché, mais entre parenthèses (`tieBackParen`)
  const mode = ctx.style(SID.TAB_PARENTHESIZE_TIED_FRET);
  const atMeasureStart = fEq(entry.position, [0, 1]);
  let hidden;
  if (mode === 'never' || !atMeasureStart) hidden = true;
  else if (mode === 'startOfMeasure') hidden = false;
  else hidden = ctx.systemFirst !== undefined && ctx.measure ? ctx.measure.index !== ctx.systemFirst : false;
  return { hidden, generated: !hidden };
}

/** Notes d'un accord : corde, ordonnée (y vers le haut), glyphes du numéro et largeur ; extrêmes de l'accord. */
function chordInfo(entry, ctx, warn) {
  const { glyphs, staff } = ctx;
  const headW = TAB_HEAD_WIDTH;
  const notes = entry.item.notes.map((note) => {
    const string = getProperty(note, PID.STRING);
    const dead = !!getProperty(note, PID.MUTED);
    const capo = entry.capo ?? GRACE_CAPO.get(entry.item) ?? NO_CAPO;
    let fret = fretOf(note, staff, capo, entry.tuning ?? GRACE_TUNING.get(entry.item) ?? null);
    if (fret < 0 && !dead) {
      if (warn) ctx.warnings.push(`Note ${note.id} : la hauteur est plus grave que la corde ${string} à vide (frette ${fret})`);
      fret = 0;
    }
    const tied = tiedFretState(note, entry, ctx);
    // bends / dives : un bend MASQUE la note d'arrivée (ou de départ d'un pre-bend) et met la libération entre parenthèses (`layoutBendTabStaff`)
    const bs = staffBends(ctx, staff)?.noteStates.get(note.id);
    const hidden = (bs && bs.hidden !== undefined ? bs.hidden : tied.hidden) || getProperty(note, PID.DISPLAY_FRET) === 'hide';
    const display = getProperty(note, PID.DISPLAY_FRET);
    const allNames = fretGlyphs(fret, dead, display, getProperty(note, PID.HARMONIC_FRET));
    const hide = display === 'hide'; // `DisplayFretOption::Hide` : la note n'est pas dessinée en tablature
    const names = hidden || hide ? [] : allNames;
    // une note harmonique dont le numéro n'est pas « naturel » n'a jamais de parenthèses générées (fantôme, note liée : `layoutChordMask`)
    const noParens = getProperty(note, PID.HARMONIC) && display !== 'natural';
    const ghost = !noParens && (hasParentheses(note, getProperty, PID) || Boolean(bs && bs.ghost));
    return {
      note, string, dead, fret, names, w: fretTextWidth(glyphs, names), fullW: fretTextWidth(glyphs, allNames), boxW: bs && bs.hidden ? fretTextWidth(glyphs, allNames) : fretTextWidth(glyphs, names), y: lineY(staff, string), hidden,
      parens: !hidden && !noParens && (ghost || tied.generated),
    };
  });
  const widest = Math.max(...notes.map((n) => n.boxW)); // une note masquée par un bend garde la largeur de son texte (`bbox().width()`)
  const strings = notes.map((n) => n.string - 1);
  return {
    headW, stemX: headW / 2, notes, widest, wide: Math.max(headW, widest),
    upStr: Math.min(...strings), downStr: Math.max(...strings),
    hi: Math.max(...notes.map((n) => n.y)), lo: Math.min(...notes.map((n) => n.y)),
  };
}

/** Hampe d'un accord (null si aucune) : sens, départ, pointe PLEINE (bord extérieur de la ligature), longueur. */
function stemSpec(entry, ci, ctx, beams) {
  const preset = tabPreset(ctx.staff);
  const base = writtenBaseOf(entry);
  if (!preset.stems || !hasStemBase(base)) return null;
  const up = !!entry.stemUp;
  const lines = lineCount(ctx.staff);
  if (!preset.through) {
    const shortHalf = preset.minim === 'shorter' && base === 'half';
    const { startY, tipY } = tabBesideStem({ up, topY: (lines - 1) * TAB_LINE_DISTANCE, shortHalf });
    return { up, startY, tipY, posY: startY, length: Math.abs(tipY - startY), through: false };
  }
  const hook = beams === 0 && Boolean(FLAG[base]);
  const tremolo = entry.tremoloPair ? null : getProperty(entry.item, PID.TREMOLO);
  const tremoloMin = tremolo ? tremoloMinStemLength({
    tremolo, up, line: 2, beams: beamCountOf(base), hook: hook ? hookMetrics(ctx.glyphs, base, up) : null, style: ctx.style,
    straightFlags: ctx.style(SID.USE_STRAIGHT_NOTE_FLAGS),
  }) : 0; // en tablature, pas de décalage « hors portée » (`calcMinStemLength` : seulement hors tablature)
  const { length } = tabThroughStemLength({
    up, upStr: ci.upStr, downStr: ci.downStr, beams, hook, lines, lineDist: TAB_LINE_DISTANCE, style: ctx.style, tremoloMin,
  });
  const far = up ? ci.lo : ci.hi; // note du côté opposé à la pointe = point d'attache de la hampe
  const startY = up ? ci.hi + STEM_CLEARANCE * TAB_LINE_DISTANCE : ci.lo - STEM_CLEARANCE * TAB_LINE_DISTANCE;
  let len = length;
  let slashTopY = null;
  // Blanche barrée (Full) + trémolo de 3 barres ou plus : MuseScore dessine les deux barres obliques de la blanche PAR-DESSUS les barres du
  // trémolo (même zone de la hampe) : un bloc noir illisible (retour de Jean 03/10/2026). Écart assumé : les barres obliques se posent juste
  // après le départ de la hampe et la hampe s'allonge jusqu'à ce que le trémolo les suive avec 0,25 sp de dégagement.
  if (tremolo && !tremolo.buzz && tremolo.strokes >= 3 && base === 'half' && preset.minim === 'slashed') {
    const ts = tremoloStyle(ctx.style);
    const barsH = tremoloBBoxHeight(tremolo, ts, ctx.glyphs);
    const pad = ts.outPadding; // départ des barres à `outPadding` de la pointe
    const gap = 0.25; const lead = 0.2;
    if (up) {
      slashTopY = startY + lead + TAB_SLASH_BLOCK_HEIGHT;
      const tipNeeded = slashTopY + gap + pad + barsH; // bas des barres au-dessus du bloc
      len = Math.max(len, tipNeeded - far);
    } else {
      slashTopY = startY - lead;
      const tipNeeded = slashTopY - TAB_SLASH_BLOCK_HEIGHT - gap - pad - barsH; // haut des barres sous le bloc
      len = Math.max(len, far - tipNeeded);
    }
  }
  return {
    up, through: true, posY: far, length: len,
    tipY: up ? far + len : far - len,
    startY, slashTopY,
  };
}

/**
 * Collisions de voix en tablature Full et Common (`ChordLayout::layoutChords1` : `stemThrough() || isCommonTabStaff()` ; Simple : aucun décalage) —
 * port de `chordvoices.js` avec `tab: true` : ligne d'une note = corde × 2 (`stringOrLine`), largeur = `tabHeadWidth + 2 × tabFretPadding`, axe de hampe
 * = `stemPosX`, pas de centrage ; seul le décalage de l'accord (`entry.vx.moveX`) est repris (les points restent ceux de ce peintre).
 */
function attachTabChordVoices(out, mi, ctx) {
  const preset = tabPreset(ctx.staff);
  if (!preset.stems) return; // Simple : `chordLdata->setPosX(0.0)`, aucune collision
  const { glyphs, style } = ctx;
  // crochets : seulement les accords NON ligaturés (`chord->hook()`)
  const beamed = new Set();
  for (const v of new Set(out.map((e) => e.voice))) {
    const list = out.filter((e) => e.voice === v);
    const groups = buildBeamGroups(list, ctx.timeSigs?.[mi], ctx.beamGroupings?.[mi], ctx.offsets?.[mi], style(SID.BEAM_BY_BEAT));
    for (const g of groups) for (const i of g) beamed.add(list[i]);
  }
  const byInstant = new Map();
  for (const e of out) {
    if (e.item.type !== 'chord' || !e.multiVoice) continue;
    const key = `${e.position[0]}/${e.position[1]}`;
    if (!byInstant.has(key)) byInstant.set(key, []);
    byInstant.get(key).push(e);
  }
  const end = (e) => fAdd(e.position, e.duration);
  const styleCombine = style(SID.COMBINE_VOICE) !== false;
  const opts = {
    tab: true, nominal: TAB_HEAD_WIDTH, stemWidth: style(SID.STEM_THICKNESS), ledgerLen: style(SID.LEDGER_LINE_LENGTH), lines: lineCount(ctx.staff),
    straightFlags: Boolean(style(SID.USE_STRAIGHT_NOTE_FLAGS)), dotWidth: glyphWidth(glyphs, 'augmentationDot'),
    dotNoteDistance: DOT_NOTE_DISTANCE, dotDotDistance: DOT_DOT_DISTANCE,
  };
  for (const list of byInstant.values()) {
    if (list.length < 2) continue;
    const chords = list.map((e) => {
      const base = writtenBaseOf(e);
      const ci = chordInfo(e, ctx, false);
      const spec = stemSpec(e, ci, ctx, beamed.has(e) ? beamCountOf(base) : 0);
      const flag = spec && !beamed.has(e) && FLAG[base] ? `${FLAG[base]}${e.stemUp ? 'Up' : 'Down'}` : null;
      const fb = flag ? glyphs.glyphs[flag].bbox : null;
      const mode = getProperty(e.item, PID.COMBINE_VOICE);
      return {
        id: e.item.id, track: e.voice, voice: e.voice, up: !!e.stemUp, dots: dotsOf(e.item), mag: 1, stemPosX: ci.stemX,
        hasStem: Boolean(spec), stemLen: spec ? Math.round(spec.length * 2) : 0, hook: fb ? fb.bBoxNE[0] - fb.bBoxSW[0] : null,
        headType: base === 'whole' ? 'whole' : base === 'breve' ? 'brevis' : base === 'half' ? 'half' : 'quarter',
        combine: mode === 'on' ? true : mode === 'off' ? false : styleCombine,
        hasVoices: out.some((o) => o.voice >= 1 && fCmp(o.position, end(e)) < 0 && fCmp(e.position, end(o)) < 0),
        notes: ci.notes.map((n) => ({
          id: n.note.id, line: 2 * (n.string - 1), right: n.w + 2 * FRET_PAD, body: n.w, headGroup: 'tab', tpc: String(((n.fret % 12) + 12) % 12),
          visible: true, stemUpX: null, stemDownX: null,
        })),
      };
    });
    const res = layoutChordGroup(chords, opts);
    for (const e of list) { const r = res.get(e.item.id); if (r && r.moveX) e.vx = { moveX: r.moveX, notes: new Map(), dotPosX: 0 }; }
  }
}

/** Éléments d'affichage d'un élément de la voix. `beam` = { endY } (centre de la 1re ligature à l'axe de la hampe) si ligaturé. */
/** Ordonnée naturelle d'un silence (`RestLayout::computeNaturalLine`). */
function restYOf(entry, ctx) {
  const base = baseOf(entry.item);
  const count = lineCount(ctx.staff);
  const natural = count % 2 ? Math.floor(count / 2) : Math.ceil(count / 2);
  const up = (count > 5 && (base === 'whole' || base === 'measure') ? 1 : 0) + (count - 1 - natural);
  return up * TAB_LINE_DISTANCE + TAB_REST_CLEARANCE;
}

/** Rectangle d'un glyphe posé en (x, y). */
function glyphRect(glyphs, name, x, y) {
  const bb = glyphs.glyphs[name].bbox;
  return { x1: x + bb.bBoxSW[0], x2: x + bb.bBoxNE[0], y1: y + bb.bBoxSW[1], y2: y + bb.bBoxNE[1] };
}
const dotRect = (glyphs, x, y) => glyphRect(glyphs, 'augmentationDot', x, y);

function paintItem(entry, x, ctx, beam) {
  const { item } = entry;
  const { glyphs, staff, style } = ctx;
  const preset = tabPreset(staff);
  if (item.type === 'rest') {
    if (!preset.rests || getProperty(item, PID.GAP) === true) return [];
    const base = baseOf(item);
    const name = restGlyphName(base);
    // `RestLayout::computeNaturalLine` : ligne du milieu, la plus basse des deux du milieu si le nombre de lignes est pair
    // (6 cordes : 4e ligne depuis le haut) ; silence d'une ronde : une ligne plus haut si plus de 5 lignes.
    const rx = restX(entry, x, ctx, glyphWidth(glyphs, name));
    const ry = restYOf(entry, ctx) + (beam?.restDy ?? 0);
    entry.tabGeom = { notes: [], dots: [], stem: null, hook: null, rest: glyphRect(glyphs, name, rx, ry) }; // relue par les slurs (forme du silence)
    return hideIfInvisible(item, [glyphItem(name, rx, ry, { ref: item.id })]);
  }
  if (item.type !== 'chord') return [];
  const items = [];
  const lineThickness = style(SID.STAFF_LINE_THICKNESS);
  const ci = chordInfo(entry, ctx, true);
  const parenItems = [];
  // géométrie ABSOLUE de l'accord, relue par les marques en plage (ties, slurs, glissandos : `paintSpanners`) — rectangles y vers le haut
  const geom = { axis: x + ci.stemX, headW: ci.headW, notes: [], dots: [], stem: null, hook: null, tipY: null, rest: null };
  entry.tabGeom = geom;
  for (const n of ci.notes) {
    const box = fretBox(glyphs, n.dead, lineThickness);
    const bx = x + ci.stemX - n.boxW / 2; // boîte du numéro, même masqué (ancrage des bends)
    const noteBox = { x1: bx, x2: bx + n.boxW, y1: n.y + box.bottom, y2: n.y + box.top };
    if (n.hidden) { geom.notes.push({ id: n.note.id, y: n.y, hidden: true, string: n.string, fret: n.fret, pitch: n.note.pitch, rects: [], halfH: (box.top - box.bottom) / 2, noteBox }); continue; }
    const nx = x + ci.stemX - n.w / 2; // numéro centré sur l'axe de la hampe (`layoutTablature` : x = stemX − largeur / 2)
    // zone où les lignes sont coupées : le numéro, et les parenthèses éventuelles (`maskTABStringLinesForFrets`), + tabFretPadding
    let x1 = nx; let x2 = nx + n.w; let y1 = n.y + box.bottom; let y2 = n.y + box.top;
    const rects = [{ x1: nx, x2: nx + n.w, y1, y2 }];
    if (n.parens) {
      for (const p of parenthesisPair({ left: nx, right: nx + n.w, top: n.y + box.top, bottom: n.y + box.bottom, pad: TAB_PAREN_PAD, tab: true, ref: n.note.id })) {
        parenItems.push(p.item);
        x1 = Math.min(x1, p.bbox.x1); x2 = Math.max(x2, p.bbox.x2);
        rects.push({ x1: p.bbox.x1, x2: p.bbox.x2, y1, y2 });
      }
    }
    geom.notes.push({ id: n.note.id, y: n.y, hidden: false, string: n.string, fret: n.fret, pitch: n.note.pitch, rects, halfH: (box.top - box.bottom) / 2, noteBox });
    items.push({
      kind: 'rect', role: 'fret-box', x: x1 - FRET_PAD, y: y1 - FRET_PAD, w: x2 - x1 + FRET_PAD * 2,
      h: y2 - y1 + FRET_PAD * 2, fill: 'paper', ref: n.note.id,
    });
    let gx = nx;
    for (const name of n.names) {
      // chevrons d'harmonique : centrés sur la ligne de corde (la pointe sur la ligne), comme le centre d'un chiffre — ÉCART avec MuseScore
      // (même police : les chevrons y sont ~0,2 sp trop bas), demande de Jean 04/10/2026
      const gb = glyphs.glyphs[name].bbox; const zb = glyphs.glyphs.tabFret0.bbox;
      const lift = name === 'tabFretLess' || name === 'tabFretGreater' ? (zb.bBoxNE[1] + zb.bBoxSW[1]) / 2 - (gb.bBoxNE[1] + gb.bBoxSW[1]) / 2 : 0;
      const tint = getProperty(n.note, PID.COLOR); // (the root of a scale has its own colour)
      items.push(glyphItem(name, gx, n.y + box.base + lift, tint ? { ref: n.note.id, color: tint } : { ref: n.note.id }));
      gx += advanceOf(glyphs, name);
    }
  }
  items.push(...parenItems); // après tous les masques : un masque voisin ne doit pas couper une parenthèse

  const base = writtenBaseOf(entry);
  const thickness = style(SID.STEM_THICKNESS);
  const axis = x + ci.stemX;
  const spec = stemSpec(entry, ci, ctx, beam ? (beam.beams ?? beamCountOf(base)) : 0);
  const flag = spec && !beam ? FLAG[base] : null;
  if (spec) {
    const flagName = flag ? `${flag}${spec.up ? 'Up' : 'Down'}` : null;
    const anchor = flagName ? glyphs.glyphs[flagName].anchors[spec.up ? 'stemUpNW' : 'stemDownSW'] : null;
    const endY = beam ? beam.endY : anchor ? spec.tipY + anchor[1] : spec.tipY;
    items.push({ kind: 'line', role: 'stem', x1: axis, x2: axis, y1: spec.startY, y2: endY, width: thickness, ref: item.id });
    geom.stem = { x: axis, y1: spec.startY, y2: endY, up: spec.up, width: thickness };
    if (flagName) {
      items.push(glyphItem(flagName, axis - thickness / 2, spec.tipY, { ref: item.id, role: 'flag' }));
      geom.hook = glyphRect(glyphs, flagName, axis - thickness / 2, spec.tipY);
    }
    if (base === 'half' && preset.minim === 'slashed') {
      items.push(...tabSlashItems({
        up: spec.up, axisX: axis, posY: spec.posY, length: spec.length, through: spec.through, lineDist: TAB_LINE_DISTANCE, ref: item.id,
        topY: spec.slashTopY ?? null,
      }));
    }
  }

  // trémolo sur une note (4c-3) : x = axe du numéro (`layoutOneNoteTremolo`, `centerX`), y depuis la hampe ou, sans hampe, la note
  const tremolo = entry.tremoloPair ? null : getProperty(item, PID.TREMOLO);
  if (tremolo) {
    const up = spec ? spec.up : !!entry.stemUp;
    const anchorNote = up ? ci.notes.reduce((a, n) => (n.y > a.y ? n : a)) : ci.notes.reduce((a, n) => (n.y < a.y ? n : a));
    const placed = singleTremoloItems({
      tremolo, up, x: axis, anchorY: spec ? spec.startY : anchorNote.y, tipY: spec ? spec.tipY : null, beams: beamCountOf(base),
      hook: Boolean(spec && !beam && FLAG[base]), style, glyphs, ref: item.id, straightFlags: style(SID.USE_STRAIGHT_NOTE_FLAGS),
      tab: { lines: lineCount(staff), lineDist: TAB_LINE_DISTANCE, simple: !preset.stems },
    });
    items.push(...placed.items);
  }

  // points : près de la hampe (hampes à côté de la portée), sinon après le plus large numéro, à la hauteur de chaque note
  const dots = dotsOf(item);
  if (dots && preset.stems) {
    const dotName = 'augmentationDot';
    if (!preset.through && spec) {
      const dotW = glyphWidth(glyphs, dotName);
      const hookW = flag ? glyphWidth(glyphs, `${flag}${spec.up ? 'Up' : 'Down'}`) : 0;
      let dx = axis + (flag ? hookW + DOT_NOTE_DISTANCE : TAB_DOT_DIST_X);
      const dy = spec.startY + (spec.up ? DOT_BESIDE_Y : -DOT_BESIDE_Y);
      for (let k = 0; k < dots; k++, dx += DOT_DOT_DISTANCE) { items.push(glyphItem(dotName, dx, dy, { ref: item.id, role: 'dot' })); geom.dots.push(dotRect(glyphs, dx, dy)); }
    } else if (preset.through) {
      // `Note::setDotRelativeLine` (tablature, hampes à travers) : le point n'est JAMAIS sur la ligne de la corde — toujours sur
      // l'interligne voisin, à ½ distance de lignes : au-dessus pour une voix paire (index 0, 2), en dessous pour une voix impaire
      const dotDy = entry.voice % 2 === 1 ? -0.5 * TAB_LINE_DISTANCE : 0.5 * TAB_LINE_DISTANCE;
      for (const n of ci.notes) {
        let dx = x + ci.wide + TAB_DOT_DIST_X * 0.5;
        for (let k = 0; k < dots; k++, dx += TAB_DOT_DIST_X) { items.push(glyphItem(dotName, dx, n.y + dotDy, { ref: n.note.id, role: 'dot' })); geom.dots.push(dotRect(glyphs, dx, n.y + dotDy)); }
      }
    }
  }
  items.push(...tabMarkItems(entry, ci, geom, x, ctx));
  // slide (ChordLine) : accrochée à la note la plus haute, hors de la forme de l'accord (numéros, hampe, crochet, points)
  const cl = getProperty(item, PID.CHORD_LINE);
  entry.chordLineBox = null;
  if (cl && ci.notes.length) {
    const boxes = geom.notes.flatMap((n) => n.rects);
    if (geom.stem) boxes.push({ x1: geom.stem.x - geom.stem.width / 2, x2: geom.stem.x + geom.stem.width / 2, y1: Math.min(geom.stem.y1, geom.stem.y2), y2: Math.max(geom.stem.y1, geom.stem.y2) });
    if (geom.hook) boxes.push(geom.hook);
    boxes.push(...geom.dots);
    const up = ci.notes.reduce((a, n) => (n.y > a.y ? n : a));
    const res = chordLineLayout({ spec: cl, noteY: up.y, boxes, dots: geom.dots, glyphs, thickness: style(SID.CHORDLINE_THICKNESS) * 1, ref: item.id });
    items.push(...res.items);
    entry.chordLineBox = { left: res.left - x, right: res.right - x }; // relatif à l'origine de l'accord : lu par `lead` / `itemWidth`
  }
  // arpège (4d-d) : à gauche de l'origine de l'accord, de la boîte de la note la plus haute à celle de la plus basse (`layoutArpeggio`)
  const ap = getProperty(item, PID.ARPEGGIO);
  entry.arpeggioBox = null;
  if (ap && geom.notes.length) {
    const up = geom.notes.reduce((a, n) => (n.y > a.y ? n : a)); const down = geom.notes.reduce((a, n) => (n.y < a.y ? n : a));
    const lll = Math.max(0, x - Math.min(...geom.notes.flatMap((n) => n.rects.map((r) => r.x1)), x));
    const res = arpeggioLayout({ spec: ap, x, top: up.y + up.halfH, bottom: down.y - down.halfH, lll, glyphs, lineWidth: style(SID.ARPEGGIO_LINE_WIDTH), hookLen: style(SID.ARPEGGIO_HOOK_LEN), ref: item.id });
    items.push(...res.items);
    entry.arpeggioBox = { left: res.left - x }; // `lll += width + 0,5 sp` : lu par `lead`
  }
  return items;
}

/** Drapeau « afficher en tablature » d'une articulation (`m_showOnTabStyles` : accent, staccato, mordant, tour, point d'orgue). */
const ARTIC_TAB_FLAG = {
  accent: 'ACCENT', staccato: 'STACCATO', mordent: 'MORDENT', mordentInverted: 'MORDENT', turn: 'TURN', turnInverted: 'TURN',
  fermata: 'FERMATA', fermataShort: 'FERMATA', fermataLong: 'FERMATA', fermataVeryShort: 'FERMATA', fermataVeryLong: 'FERMATA', fermataShortHenze: 'FERMATA', fermataLongHenze: 'FERMATA',
  golpe: 'GOLPE', golpeThumb: 'GOLPE',
};
const tabShown = (style, preset, name) => !name || style(SID[`${name}_SHOW_TAB_${preset.stems ? 'COMMON' : 'SIMPLE'}`]);

/**
 * Articulations, point d'orgue et nuance d'un accord de tablature (tranche 4c-2) : mêmes fonctions que la portée, réglées par
 * `tab` (bords de portée = lignes extrêmes ± demi-épaisseur, hauteur de tête = boîte du numéro). Règles lues dans
 * `chordlayout.cpp` 4.7.5 et mesurées sur l'export E8.
 */
// `ChordLayout::centerX` en tablature : `STAFFTYPE_TAB_DEFAULTSTEMPOSX` = 0,75 sp depuis l'origine de l'accord (l'axe de hampe, lui, est à ½ largeur de tête = 0,65) ;
// mesuré sur E8 et l'export de Jean : articulations à +0,1 sp de l'axe de hampe.
const TAB_ARTIC_CENTER_X = 0.75;
function tabMarkItems(entry, ci, geom, x, ctx) {
  const { item } = entry;
  const { glyphs, staff, style } = ctx;
  const preset = tabPreset(staff);
  const articulations = getProperty(item, PID.ARTICULATIONS).filter((a) => tabShown(style, preset, ARTIC_TAB_FLAG[a.type]));
  const tapping = tappingEntry(item, style, true); // 4d-d : le tapping est une articulation (sous-classe) : même pile
  if (tapping) articulations.push(tapping);
  const dynamic = getProperty(item, PID.DYNAMIC);
  const showDyn = dynamic && tabShown(style, preset, 'DYNAMICS');
  if (!articulations.length && !showDyn) return [];
  const half = style(SID.STAFF_LINE_THICKNESS) / 2;
  const tab = {
    top: (lineCount(staff) - 1) * TAB_LINE_DISTANCE + half, bottom: -half, headHeight: 2 * FRET_BOX_HALF_HEIGHT,
    hasVoices: !!entry.multiVoice, fermataMargin: 0.5,
  };
  const ys = ci.notes.map((n) => n.y);
  const stem = geom.stem;
  const stemUp = stem ? stem.up : !!entry.stemUp;
  const stemTip = stem ? stem.y2 : null;
  const args = { ys, stemUp, stemTip, headWidth: ci.headW, x: geom.axis - ci.headW / 2, glyphs, itemId: item.id, tab };
  const out = [];
  let artItems = null;
  if (articulations.length) { artItems = articulationItems(articulations, { ...args, x: geom.axis - ci.stemX, headWidth: 2 * TAB_ARTIC_CENTER_X, voice: entry.voice ?? 0 }); out.push(...artItems); entry.articItems = artItems.filter((i) => i.role === 'articulation'); }
  if (showDyn) {
    out.push(...dynamicItems(dynamic, { ...args, hasLyrics: staffAbove(ctx, staff, ctx.track), chordBounds: artItems ? artItems.bounds : null, text: getProperty(item, PID.DYNAMIC_TEXT) }));
  }
  return out;
}

/** Fonctions de ce fichier prêtées au module des ornements (`tabgrace.js`), pour éviter une importation circulaire. */
const graceHelpers = {
  chordInfo, fretBox, advanceOf, FRET_PAD, TAB_HEAD_WIDTH, TAB_LINE_DISTANCE, lineCount, tabPreset,
};

/**
 * Rattache les ornements aux colonnes (comme `attachGraces` de la portée) : « avant » à la colonne de leur accord ; « après » à la colonne
 * qui SUIT sur la portée, ou contre la barre de fin de mesure (`graceTrail`).
 */
function attachTabGraces(out, ctx, multiVoice) {
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
  // un silence compte comme boîte (MuseScore : espacement note → silence 0,5 × grandeur)
  const mainBoxesOf = (e) => {
    if (e.item.type === 'chord') return tabMainBoxes(e.tabGeom, e.voice);
    const r = e.tabGeom?.rest;
    return r ? [{ type: 'rest', left: r.x1, right: r.x2, bottom: r.y1, top: r.y2, voice: e.voice, beamId: null, mag: 1 }] : [];
  };
  const layoutOf = (e, list, mainBoxes) => layoutTabGraceGroup(list, mainBoxes, { ctx, h: graceHelpers, voice: e.voice, multiVoice });
  for (const [e, list] of lists) {
    paintItem(e, 0, ctx, null); // renseigne `entry.tabGeom` (boîtes des numéros)
    e.graceList = list;
    e.graceLayout = layoutOf(e, list, mainBoxesOf(e));
  }
  for (const [e, list] of trails) {
    e.graceTrail = list;
    e.graceTrailLayout = layoutOf(e, list, [{ type: 'barline', left: -0.09, right: 0.09, bottom: 0, top: 7.5, voice: -1, beamId: null, mag: 1 }]);
    // the trailing group is part of the shape of the bar line, so the spacing keeps it clear of the last chord (like the notation staff)
    e.graceTrailLayout.boxes = e.graceTrailLayout.shape;
  }
}

/**
 * Couple de trémolo en tablature : membres calés sur la tablature (`BeamTremoloLayout::chordBeamAnchorY` : hampes à côté = départ et longueur fixes ;
 * sinon `defaultStemLength` du chord, calculée même sans hampe) ; sans hampe (Simple, ou valeur écrite ronde) l'abscisse des ancrages est celle du
 * bord de la tête (`stemPosX` : bord droit si le sens est vers le haut) — mesuré sur E7 (début des barres à origine du chord + 1 sp).
 */
/**
 * Barres d'un trémolo à deux notes : JAMAIS à cheval sur une ligne de la portée (choix de Jean, 03/10/2026 — lisibilité ; MuseScore, lui,
 * les laisse tomber où son calcul les met, parfois sur la ligne du bas, ex. deux doubles croches). Si les barres entrent dans la bande
 * de la portée (± `TREMOLO_STAFF_CLEARANCE`), tout le groupe est décalé vers l'extérieur — vers le bas pour des hampes descendantes, vers
 * le haut sinon. @returns décalage vertical (repère de portée, y vers le haut ; 0 si rien à faire).
 */
const TREMOLO_STAFF_CLEARANCE = 0.3;
function staffClearShift(items, up, height) {
  const rs = rectsOf(items.filter((it) => it.role === 'tremolo'), { glyphs: {} });
  if (!rs.length) return 0;
  if (!up) {
    const top = Math.max(...rs.map((r) => r.y2));
    return top > -TREMOLO_STAFF_CLEARANCE ? -(top + TREMOLO_STAFF_CLEARANCE) : 0;
  }
  const bottom = Math.min(...rs.map((r) => r.y1));
  return bottom < height + TREMOLO_STAFF_CLEARANCE ? height + TREMOLO_STAFF_CLEARANCE - bottom : 0;
}

function tabPairLayout(p, q, t, ctx) {
  const { staff, style } = ctx;
  const preset = tabPreset(staff);
  const lines = lineCount(staff);
  const H = (lines - 1) * TAB_LINE_DISTANCE;
  const up = !!p.entry.stemUp;
  const hasStem = preset.stems && hasStemBase(t.writtenBase);
  const members = [p, q].map(({ entry, x }) => {
    const ci = chordInfo(entry, ctx, false);
    const spec = hasStem ? stemSpec(entry, ci, ctx, t.strokes) : null;
    let startY; let len; let ax;
    if (spec) {
      ax = x + ci.stemX;
      startY = spec.through ? spec.posY : spec.startY;
      len = spec.length;
    } else {
      ax = x + (up ? ci.headW : 0);
      if (preset.stems && !preset.through) { // hampes à côté, accord sans hampe : mêmes position et longueur fixes
        const b = tabBesideStem({ up, topY: H, shortHalf: preset.minim === 'shorter' && t.writtenBase === 'half' });
        startY = b.startY; len = Math.abs(b.tipY - b.startY);
      } else {
        startY = up ? ci.lo : ci.hi;
        len = tabThroughStemLength({ up, upStr: ci.upStr, downStr: ci.downStr, beams: t.strokes, hook: false, lines, lineDist: TAB_LINE_DISTANCE, style }).length;
      }
    }
    return {
      x: ax, stemless: !spec, farY: H - startY, len, upLine: ci.upStr, downLine: ci.downStr, strings: ci.notes.map((n) => n.string - 1),
      strokes: t.strokes, attachY: 0,
    };
  });
  return tabTwoChordTremoloLayout({ up, strokes: t.strokes, members, staffLines: lines, staffHeight: H, style, ref: t.id });
}

export const tabPainter = {
  name: 'tab',
  lines(staff, ctx) {
    const count = lineCount(staff);
    const base = ctx.style(SID.STAFF_LINE_THICKNESS);
    const gauge = ctx.style(SID.TAB_STRING_GAUGE); // faux : épaisseur uniforme comme MuseScore
    return Array.from({ length: count }, (_, i) => {
      const string = count - i; // corde 1 = ligne du haut
      return { y: i * TAB_LINE_DISTANCE, thickness: gauge ? base * (STRING_GAUGE[string - 1] ?? 1) : base };
    });
  },
  /** Clé TAB : seulement sur le 1er système du mouvement (`Sid::hideTabClefAfterFirst`, vrai par défaut). */
  clef(staff, ctx, mi = 0) {
    if (mi !== 0) return null; // `mi` = mesure qui ouvre le système : 0 = 1er système
    const glyph = lineCount(staff) <= 4 ? '4stringTabClef' : '6stringTabClef';
    return { glyph, y: middleY(staff), mag: TAB_CLEF_MAG };
  },
  /**
   * Lettres des cordes devant la portée (ajout Scorsaire, demande de Jean 04/10/2026 ; `SID.TAB_STRING_LETTERS`) : lettre (+ altération) de la corde à vide,
   * posée sur sa ligne dont elle coupe le tracé. Largeur = la plus large des lettres + marge. @returns { width, items(x) } | null
   */
  stringLetters(staff, ctx, { barline = false } = {}) {
    if (!ctx.style(SID.TAB_STRING_LETTERS)) return null;
    const size = LETTER_SIZE;
    const names = (getProperty(staff, PID.TUNING) ?? STANDARD_TUNING).map((n) => /^([A-G])([#b]?)/.exec(n).slice(1, 3).join(''));
    const w = (t) => 0.55 * size * [...t].length;
    const width = Math.max(...names.map(w)) + LETTER_GAP;
    const from = barline ? BARLINE_THIN_W : 0; // la barre de début de système (multi-portées) occupe 0 → 0,18 sp
    return {
      width,
      items: (x0) => names.flatMap((t, i) => {
        const y = lineY(staff, i + 1);
        const cx = x0 + (width - LETTER_GAP) / 2 - LETTER_SHIFT_LEFT; // retour de Jean 13/10/2026 : lettres un peu plus à gauche
        return [
          // le masque part du bord gauche (pas de bout de ligne devant la lettre) mais JAMAIS sur la barre de début de système (retour de Jean 15/10/2026)
          { kind: 'rect', role: 'string-letter-mask', x: from, y: y - 0.4 * size, w: cx + w(t) / 2 + 0.15 - from,
            h: 0.8 * size, fill: 'paper', ref: staff.id },
          { kind: 'text', role: 'string-letter', text: t, x: cx, y: y - 0.33 * size, size, anchor: 'middle', ref: staff.id },
        ];
      }),
    };
  },
  keySig: () => null,
  /** Chiffrage centré sur la portée (`TLayout::layoutTimeSig` : yoff = (lignes − 1) · ½ · distance de lignes) ; absent en Simple. */
  timeSig(staff) {
    if (!tabPreset(staff).timeSig) return null;
    const mid = middleY(staff);
    return { yNum: mid + 1, yDen: mid - 1 };
  },
  /** Éléments de la mesure + sens des hampes : vers le bas, sauf plusieurs voix (voix 1 et 3 en haut, `computeUp`). */
  entries(staff, mi, ctx) {
    const list = sequentialEntries(staff, mi, ctx);
    const multiVoice = list.some((e) => e.voice > 0);
    const out = list.map((e) => ({ ...e, multiVoice, stemUp: userStemUp(e.item) ?? (multiVoice && e.voice % 2 === 0), capo: ctx.capoAtPos ? ctx.capoAtPos(mi, e.position) : NO_CAPO, tuning: ctx.tuningAtPos ? ctx.tuningAtPos(mi, e.position) : null }));
    for (const e of out) if (e.item.type === 'chord') e.graces = gracesOf(e.item);
    for (const e of out) if (e.graces) for (const g of [...e.graces.before, ...e.graces.after]) { GRACE_CAPO.set(g, e.capo); GRACE_TUNING.set(g, e.tuning); }
    // trémolos à deux accords : deux accords consécutifs de la MÊME voix, de même durée (`Measure::connectTremolo`) ; hampes dans le sens de la voix
    // (en tablature `calcIsUp` ne donne jamais « vers le haut » avec une seule voix : distances corde − ligne du milieu ≤ 0)
    const pairMap = staffTwoChordTremolos(ctx, staff);
    if (pairMap.size) {
      for (const v of new Set(out.map((e) => e.voice))) {
        const list = out.filter((e) => e.voice === v);
        for (let i = 0; i + 1 < list.length; i++) {
          const a = list[i];
          const info = a.item.type === 'chord' ? pairMap.get(a.item.id) : null;
          if (!info) continue;
          // l'accord suivant de la voix, silences sautés (`Measure::connectTremolo` : « cannot connect tremolo » puis `continue`)
          const b = list.slice(i + 1).find((e) => e.item.type === 'chord');
          if (!b || b.item.id !== info.endChordId) continue;
          const da = getProperty(a.item, PID.DURATION); const db = getProperty(b.item, PID.DURATION);
          const writtenBase = writtenBaseOfPair(da.base);
          if (!writtenBase || da.base !== db.base || (da.dots ?? 0) !== (db.dots ?? 0)) continue;
          a.tremoloPair = { id: info.id, strokes: info.strokes, role: 'first', writtenBase };
          b.tremoloPair = { id: info.id, strokes: info.strokes, role: 'second', writtenBase };
        }
      }
    }
    attachTabGraces(out, ctx, multiVoice);
    attachTabChordVoices(out, mi, ctx);
    return out;
  },
  /** Place à gauche du numéro pour une parenthèse (pointe, bombement) qui dépasse du bord gauche de la colonne. */
  lead(entry, ctx) {
    if (entry.item.type !== 'chord') return entry.graceLayout ? -entry.graceLayout.left : 0;
    const ci = chordInfo(entry, ctx, false);
    let lead = entry.graceLayout ? -entry.graceLayout.left : 0; // ornements à gauche (tabgrace.js)
    for (const n of ci.notes) if (n.parens) lead = Math.max(lead, parenthesisOutside(1.3425, true) - (ci.stemX - n.w / 2));
    // harmonique « <12> » / « 5 <17> » : le numéro, très large, déborde à gauche de l'origine de l'accord (`note->setPos(stemX − largeur / 2)`) ; MuseScore
    // espace les colonnes sur leurs FORMES (débordement compris) — approché ici par une réserve à gauche, limitée aux notes harmoniques (non vérifié sur export)
    for (const n of ci.notes) {
      const d = getProperty(n.note, PID.DISPLAY_FRET);
      if (d === 'natural' || d === 'artificial') lead = Math.max(lead, n.boxW / 2 - ci.stemX);
    }
    // `ChordLayout::layoutTablature` : la boîte de la slide agrandit `spaceLw` / `spaceRw`
    if (getProperty(entry.item, PID.CHORD_LINE)) { paintItem(entry, 0, ctx, null); if (entry.chordLineBox) lead = Math.max(lead, -entry.chordLineBox.left); }
    if (getProperty(entry.item, PID.ARPEGGIO)) { paintItem(entry, 0, ctx, null); if (entry.arpeggioBox) lead = Math.max(lead, -entry.arpeggioBox.left); }
    // `ChordLayout::layoutTablature` : un accord qui termine un glissando, hors début de mesure, réserve 0,5 sp + minTieLength à gauche
    if (staffGlissandoEndChordIds(ctx, ctx.staff).has(entry.item.id) && !fEq(entry.position, [0, 1])) lead += 0.5 + ctx.style(SID.MIN_TIE_LENGTH);
    lead = Math.max(lead, lhFingeringLead(entry.item, ctx, tabPreset(ctx.staff).showFingering)); // doigtés de main gauche (Common et Full)
    return lead;
  },
  /** Réserve à gauche de l'origine de l'accord pour l'espacement par formes (harmonique large, slide, arpège, glissando d'arrivée, doigté). */
  leftReserve(entry, ctx) { return tabPainter.lead(entry, ctx); },
  itemWidth(entry, ctx) {
    let w = entrySpace(entry, ctx.style);
    if (entry.item.type === 'chord') {
      const ci = chordInfo(entry, ctx, false);
      let right = ci.stemX + ci.wide / 2; // `spaceRw` : un demi-numéro de part et d'autre de la hampe
      if (entry.vx) right += entry.vx.moveX; // collisions de voix : l'accord est décalé (`attachTabChordVoices`)
      for (const n of ci.notes) if (n.parens) right = Math.max(right, ci.stemX + n.w / 2 + parenthesisOutside(1.3425, true));
      const dots = dotsOf(entry.item);
      if (dots && tabPreset(ctx.staff).stems) {
        const through = tabPreset(ctx.staff).through;
        const dotW = glyphWidth(ctx.glyphs, 'augmentationDot');
        right = Math.max(right, through
          ? ci.wide + TAB_DOT_DIST_X * 0.5 + (dots - 1) * TAB_DOT_DIST_X + dotW
          : ci.stemX + TAB_DOT_DIST_X + (dots - 1) * DOT_DOT_DISTANCE + dotW);
      }
      if (getProperty(entry.item, PID.CHORD_LINE)) { paintItem(entry, 0, ctx, null); if (entry.chordLineBox) right = Math.max(right, entry.chordLineBox.right); }
      w = Math.max(w, right + NOTE_GAP);
    }
    if (entry.graceTrailLayout) w += -entry.graceTrailLayout.left; // ornements « après » en fin de mesure : place avant la barre
    return w + tabPainter.lead(entry, ctx);
  },
  /**
   * Soufflets en tablature (4c-2) : mêmes segments que la portée (`hairpinWedgeLines`) ; position de repos mesurée sur E8
   * (au-dessus : ligne du haut + 2,25 ; en dessous : ligne du bas − 2,0), repoussée à `hairpinMinDistance` (0,7) + demi-ouverture
   * au-delà des numéros et des hampes de la plage, dans le système courant. Non vérifié sur export : plusieurs voix, soufflet
   * à cheval sur un retour à la ligne.
   */
  paintSystemExtra(systemPlaced, staff, movement, sys, ctx) {
    const items = [];
    const preset = tabPreset(staff);
    if (!systemPlaced.length || !tabShown(ctx.style, preset, 'HAIRPIN')) return items;
    const resolved = staffHairpins(ctx, staff);
    if (!resolved.length) return items;
    const top = (lineCount(staff) - 1) * TAB_LINE_DISTANCE;
    const byId = new Map(systemPlaced.map((p) => [p.entry.item.id, p]));
    const sysFirstMi = sys.measures[0].mi;
    const sysLastMi = sys.measures[sys.measures.length - 1].mi;
    const above = staffAbove(ctx, staff, ctx && ctx.track);
    for (const hp of resolved) {
      const startP = byId.get(hp.startChordId) ?? null;
      const endP = byId.get(hp.endChordId) ?? null;
      if (!startP && !endP && !(hp.startMi < sysFirstMi && hp.endMi > sysLastMi)) continue;
      const segType = spannerSegmentType(Boolean(startP), Boolean(endP));
      let ext = null;
      for (const p of systemPlaced) {
        const g = p.entry.tabGeom;
        if (p.mi < hp.startMi || p.mi > hp.endMi || !g || !g.notes.length) continue;
        const ys = g.notes.flatMap((n) => [n.y + n.halfH, n.y - n.halfH]);
        if (g.stem) ys.push(g.stem.y1, g.stem.y2);
        const hi = Math.max(...ys); const lo = Math.min(...ys);
        ext = ext ? { hi: Math.max(ext.hi, hi), lo: Math.min(ext.lo, lo) } : { hi, lo };
      }
      const half = 1.15 / 2 + 0.7;
      let y = above ? top + 2.25 : -2.0;
      if (ext) y = above ? Math.max(y, ext.hi + half) : Math.min(y, ext.lo - half);
      const x1 = startP ? startP.x : sys.measures[0].start;
      const x2 = endP ? endP.x + 0.7 : sys.measures[sys.measures.length - 1].barX;
      for (const l of hairpinWedgeLines({ hairpinType: hp.hairpinType, segType, x1, x2, y })) {
        items.push({ kind: 'line', role: 'hairpin', x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: HAIRPIN_LINE_WIDTH, ref: hp.id });
      }
    }
    return items;
  },
  /**
   * Marques en plage (tranche 4c) : ties (E4), slurs (E5), glissandos (E6) — voir ../tabspanners.js. Appelé une fois après tous les systèmes.
   * @returns tableau d'éléments d'affichage par système
   */
  paintSpanners(perSystem, staff, movement, ctx, existing = []) {
    const result = perSystem.map(() => []);
    const where = new Map(); // accord → { p, k }
    perSystem.forEach(({ placed }, k) => { for (const p of placed) if (p.entry.item.type === 'chord' || p.entry.item.type === 'rest') where.set(p.entry.item.id, { p, k }); });
    // notes d'ornement « avant » : { p (accord principal), k, geom, up, mag, chord }, pour les liaisons qui en partent
    const graceWhere = new Map();
    perSystem.forEach(({ placed }, k) => {
      for (const p of placed) {
        const lay = p.entry.graceLayout;
        if (!lay || !lay.anchors || !p.entry.graceList) continue;
        for (const g of p.entry.graceList) {
          const a = lay.anchors.get(g.chord.id);
          if (a) graceWhere.set(g.chord.id, { p, k, geom: a.geom, up: a.up, mag: a.mag, chord: g.chord });
        }
      }
      // « après » ornements de fin de mesure (contre la barre) : mêmes ancrages, portés par l'accord qui les précède
      for (const p of placed) {
        const lay = p.entry.graceTrailLayout;
        if (!lay || !lay.anchors || !p.entry.graceTrail) continue;
        for (const g of p.entry.graceTrail) {
          const a = lay.anchors.get(g.chord.id);
          if (a) graceWhere.set(g.chord.id, { p, k, geom: a.geom, up: a.up, mag: a.mag, chord: g.chord, trail: true });
        }
      }
    });
    const common = { perSystem, staff, ctx: { ...ctx, staff }, where, graceWhere, result, lines: lineCount(staff), lineDist: TAB_LINE_DISTANCE, preset: tabPreset(staff) };
    const { tieSegs } = tabTieItems(common);
    tabSlurItems({ ...common, tieSegs });
    tabGlissandoItems(common);
    tabBendItems(common);
    if ((getProperty(staff, PID.WHEELS) ?? []).length) { // the wheel ("Molette"): the same small curve as on a score staff, above the first string
      const chordOfNote = new Map();
      for (const vo of staff.voices) for (const m of vo.measures) for (const it of m.items) if (it.type === 'chord') for (const n of it.notes) chordOfNote.set(n.id, it.id);
      scoreWheelItems({
        perSystem, staff, ctx: { ...ctx, staff }, result, staffTop: (lineCount(staff) - 1) * TAB_LINE_DISTANCE,
        locate: (id) => {
          const w = where.get(chordOfNote.get(id)); const geo = w && (w.geom ?? w.p.entry.tabGeom); const g = geo?.notes.find((n) => n.id === id);
          return g ? { k: w.k, x: g.noteBox.x1, w: g.noteBox.x2 - g.noteBox.x1, y: g.y, h: 2 * g.halfH, boxes: [{ top: g.y + g.halfH }] } : null;
        },
      });
    }
    tabTappingItems(common);
    if (staffHasFingering(staff)) fingeringItems({ perSystem, staff, ctx: { ...ctx, staff }, result, lines: lineCount(staff), lineDist: TAB_LINE_DISTANCE, existing, tab: tabPreset(staff) }); // doigtés (6)
    trillLineItems({ ...common, existing });
    tabTechLineItems({ ...common, existing });
    pedalItems({ perSystem, staff, movement, ctx: { ...ctx, staff }, result, lines: lineCount(staff), lineDist: TAB_LINE_DISTANCE, existing }); // pédales (ancrées par instant)
    staffTextItems({ perSystem, staff, ctx: { ...ctx, staff }, result, lines: lineCount(staff), lineDist: TAB_LINE_DISTANCE, existing }); // texte du capo / d'accordage (4e)
    staffTextEntryItems({ perSystem, staff, movement, ctx: { ...ctx, staff }, result, lines: lineCount(staff), lineDist: TAB_LINE_DISTANCE, existing }); // textes propres à la portée
    if (staffHasLyrics(ctx, staff)) lyricsItems({ perSystem, staff, ctx: { ...ctx, staff }, result, lines: lineCount(staff), lineDist: TAB_LINE_DISTANCE, existing }); // paroles (en dernier)
    return result;
  },
  /** Élément seul (sans ligature) : sert aux tests et aux appels sans `paintMeasure`. */
  paintEntry(entry, x, ctx) {
    return paintItem(entry, x, ctx, null);
  },
  /** Mesure entière : ligatures et n-olets ont besoin des x de tout un groupe. @param placed [{ entry, x }] */
  paintMeasure(placed, ctx) {
    const { style, staff } = ctx;
    const preset = tabPreset(staff);
    const mi = ctx.measure.index;
    const thickness = style(SID.STEM_THICKNESS);
    const beamWidth = style(SID.BEAM_THICKNESS);
    const lines = lineCount(staff);
    const items = [];
    const byVoice = new Map();
    for (const p of placed) {
      if (!byVoice.has(p.entry.voice)) byVoice.set(p.entry.voice, []);
      byVoice.get(p.entry.voice).push(p);
    }
    for (const list of byVoice.values()) {
      const groups = preset.stems
        ? buildBeamGroups(list.map((p) => p.entry), ctx.timeSigs[mi], ctx.beamGroupings[mi], ctx.offsets[mi], style(SID.BEAM_BY_BEAT))
        : [];
      // a direction chosen by the user for one chord of a beamed group is the direction of the whole group
      for (const group of groups) {
        const chosen = group.map((i) => userStemUp(list[i].entry.item)).find((d) => d !== null);
        if (chosen !== undefined) for (const i of group) list[i].entry.stemUp = chosen;
      }
      const beamOf = new Map();
      for (const group of groups) {
        const isRest = (i) => list[i].entry.item.type === 'rest';
        const up = !!list[group.find((i) => !isRest(i))].entry.stemUp;
        const members = group.map((i, gk) => {
          const { entry, x } = list[i];
          const beams = beamCountOf(writtenBaseOf(entry));
          // `strokeCount` / `calcBeamCount` : un couple de trémolo « inséré » compte ses barres de trémolo EN PLUS des barres de la ligature
          // (longueur de hampe, ancrages) ; `beams` seul reste le nombre de niveaux dessinés par la ligature
          const strokes = beams + (entry.tremoloPair?.strokes ?? 0);
          if (isRest(i)) {
            // silence ligaturé : ancrage = bord droit du glyphe (hampes en haut) ou gauche (`chordBeamAnchorX`)
            const rw = glyphWidth(ctx.glyphs, restGlyphName(baseOf(entry.item)));
            const rx = restX(entry, x, ctx, rw);
            return { x: up ? rx + rw : rx, rest: true, beams, info: group.infos[gk], dflt: group.defaults[gk] };
          }
          const ci = chordInfo(entry, ctx, false);
          const spec = stemSpec(entry, ci, ctx, strokes);
          const axis = x + ci.stemX;
          const farYdown = (lines - 1) * TAB_LINE_DISTANCE - spec.posY; // y vers le bas depuis la ligne du haut
          const anchors = ctx.glyphs.glyphs.noteheadBlack.anchors[up ? 'stemUpSE' : 'stemDownNW'];
          return {
            x: axis, beams, spec, info: group.infos[gk], dflt: group.defaults[gk],
            ms: {
              x: axis, farY: farYdown, len: spec.length, upLine: ci.upStr, downLine: ci.downStr, lines: ci.notes.map((n) => n.string - 1),
              strokes, attachY: farYdown - anchors[1], ys: [],
            },
          };
        });
        const firstChordMember = members.find((m) => !m.rest);
        let line;
        if (!preset.through) {
          const tip = firstChordMember.spec.tipY; // hampes à côté : ligature plate, bord extérieur à la pointe
          line = { at: () => tip, beamDist: 0.75 };
        } else {
          line = beamGroupLine(members, up, { beamWidth, stemWidth: thickness, staffLines: lines, staffHeight: (lines - 1) * TAB_LINE_DISTANCE });
        }
        const H = (lines - 1) * TAB_LINE_DISTANCE;
        const buildBeams = (ln) => {
          const polys = beamItems(members, ln, up ? 'up' : 'down', { thickness: beamWidth, stemWidth: thickness }, list[group[0]].entry.item.id);
          // trémolo à deux accords « inséré » dans la ligature (`BeamLayout::setTremAnchors`) : barres à la suite des niveaux de la ligature
          const inset = [];
          group.forEach((i, k) => {
            const t = list[i].entry.tremoloPair;
            if (t?.role !== 'first' || members[k].rest) return;
            const kk = group.findIndex((g) => list[g].entry.tremoloPair?.id === t.id && list[g].entry.tremoloPair.role === 'second');
            if (kk <= k) return;
            inset.push(...insetTremoloItems({
              up, strokes: t.strokes, line: ln, x1: members[k].x, x2: members[kk].x, regularBeams: members[k].beams,
              beamWidth, ref: t.id, staffHeight: H,
            }));
          });
          return { polys, inset };
        };
        let built = buildBeams(line);
        const shift = staffClearShift(built.inset, up, H);
        if (shift) { // barres de trémolo sur une ligne de la portée : tout le groupe (ligature, hampes) glisse vers l'extérieur
          const base = line;
          line = { ...base, at: (x) => base.at(x) + shift };
          built = buildBeams(line);
        }
        const beamPolys = built.polys;
        items.push(...beamPolys, ...built.inset);
        group.forEach((i, k) => {
          const m = members[k];
          list[i].entry.tabBeam = { first: k === 0, last: k === group.length - 1, up }; // relu par les slurs (`stemSideForBeam`, `isOverBeams`)
          if (!m.rest) {
            beamOf.set(i, { endY: line.at(m.x) + (up ? -beamWidth / 2 : beamWidth / 2) });
            return;
          }
          if (!preset.rests) return;
          // silence sous la ligature : écarté des barres (`verticalAdjustBeamedRests`, distance de lignes de la tablature)
          const e = list[i].entry;
          const rn = restGlyphName(baseOf(e.item));
          const rw = glyphWidth(ctx.glyphs, rn);
          const bb = ctx.glyphs.glyphs[rn].bbox;
          const rx = restX(e, list[i].x, ctx, rw);
          const y0 = restYOf(e, ctx);
          const dy = beamedRestShift({
            up, polygons: beamPolys, short: beamCountOf(baseOf(e.item)) >= 3, firstRest: k === 0, lineDist: TAB_LINE_DISTANCE,
            box: { x0: rx, x1: rx + rw, top: y0 + bb.bBoxNE[1], bottom: y0 + bb.bBoxSW[1] },
          });
          if (dy) beamOf.set(i, { restDy: dy });
        });
      }
      // trémolos à deux accords hors ligature : barres + hampes prolongées jusqu'au bord extérieur de la 1re barre (tremolotwo.js)
      list.forEach((p, i) => {
        const t = p.entry.tremoloPair;
        if (t?.role !== 'first') return;
        const j = list.findIndex((c) => c.entry.tremoloPair?.id === t.id && c.entry.tremoloPair.role === 'second');
        if (j < 0 || (beamOf.has(i) && beamOf.has(j))) return;
        const laid = tabPairLayout(p, list[j], t, ctx);
        const H = (lines - 1) * TAB_LINE_DISTANCE;
        const shift = staffClearShift(laid.items, !!p.entry.stemUp, H);
        const moved = shift ? laid.items.map((it) => (it.kind === 'polygon' ? { ...it, points: it.points.map(([px, py]) => [px, py + shift]) } : it)) : laid.items;
        items.push(...moved);
        laid.tips.forEach((tip, k) => { if (tip !== null) beamOf.set(k === 0 ? i : j, { endY: tip + shift, beams: t.strokes }); });
      });
      list.forEach((p, i) => {
        items.push(...paintItem(p.entry, p.x, ctx, beamOf.get(i) ?? null));
        const e = p.entry;
        if (e.graceLayout) items.push(...tabGraceGroupItems(e.graceLayout, e.graceList, p.x, { ctx, h: graceHelpers, voice: e.voice }));
        if (e.graceTrailLayout) items.push(...tabGraceGroupItems(e.graceTrailLayout, e.graceTrail, ctx.measure.barX, { ctx, h: graceHelpers, voice: e.voice }));
      });

      // n-olets (absents en Simple, `TupletLayout::layout` : tablature sans hampes)
      if (!preset.stems) continue;
      const xs = list.map((p) => p.x);
      const extents = list.map((p, i) => {
        const { item } = p.entry;
        if (item.type !== 'chord') return { hi: 0.5 * (lines - 1) * TAB_LINE_DISTANCE + 1, lo: 0.5 * (lines - 1) * TAB_LINE_DISTANCE - 1, up: 0 };
        const ci = chordInfo(p.entry, ctx, false);
        const spec = stemSpec(p.entry, ci, ctx, beamOf.has(i) ? (beamOf.get(i).beams ?? beamCountOf(writtenBaseOf(p.entry))) : 0);
        const tip = spec ? (beamOf.has(i) ? beamOf.get(i).endY : spec.tipY) : null;
        return {
          hi: Math.max(ci.hi + 0.5, tip ?? -Infinity), lo: Math.min(ci.lo - 0.5, tip ?? Infinity), up: spec ? (spec.up ? 1 : -1) : 0,
        };
      });
      for (const g of tupletGroups(list.map((p) => p.entry))) {
        const sameAsBeam = groups.some((bg) => bg.length === g.indices.length && bg.every((v, k) => v === g.indices[k]));
        items.push(...tupletItems(g, xs.map((v, i) => v + chordOffset(list[i].entry, ctx)), extents, sameAsBeam, {
          glyphs: ctx.glyphs, thickness,
          avoidLines: preset.through ? { lines, lineDist: TAB_LINE_DISTANCE } : null,
        }));
      }
    }
    return items;
  },
};

/** Abscisse de l'axe de la hampe par rapport au x de la colonne (centre des numéros) ; 0 pour un silence. */
function chordOffset(entry, ctx) {
  return entry.item.type === 'chord' ? glyphWidth(ctx.glyphs, 'noteheadBlack') / 2 : 0;
}
