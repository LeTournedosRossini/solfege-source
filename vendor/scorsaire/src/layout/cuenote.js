/*
 * Note d'aide d'un ornement (trille, mordant, gruppetto…) — port de MuseScore 4.7.5 : `Ornament::showCueNote`, `Ornament::updateCueNote`,
 * `Ornament::computeNotesAboveAndBelow`, `TLayout::layoutOrnamentCueNote`, `AccidentalsLayout::keepAccidentalsCloseToChord`.
 *
 *  - Quand : l'intervalle du DESSUS n'est pas une seconde (`step ≠ 1`), ou — signe/ligne « trille » à choix complet d'intervalle — style
 *    `trillAlwaysShowCueNote` (faux par défaut). Il faut que l'ornement ait un intervalle au-dessus (`hasIntervalAbove`).
 *    ORNAMENT_SHOW_CUE_NOTE (forçage Auto/On/Off de MuseScore) : non modélisé.
 *  - Quoi : un « accord » de la taille d'une petite note (`smallNoteMag`, 0,7), SANS durée donc sans hampe ni crochet, une tête noire de noire,
 *    entre parenthèses, posée à la hauteur de la note principale (la plus haute de l'accord) montée de `step` degrés ; altération seulement si
 *    elle diffère de l'armure (mode automatique : la note reprend l'état d'altération, rien à montrer). Les altérations de l'ornement lui-même
 *    sont alors supprimées (`updateAccidentalsAboveAndBelow`).
 *  - Où : à droite de l'accord principal, dans le même segment : origine = `minHorizontalDistance(forme de l'accord, forme de la note d'aide)`
 *    (`layoutOrnamentCueNote`) ; la note d'aide entre dans la forme du segment (espacement avec ce qui suit).
 *
 *  LIMITES (non vérifié sur export MuseScore) : état d'altération = armure seule (pas les altérations déjà posées dans la mesure) ; parenthèses
 *  dessinées autour de la tête et de son altération avec la géométrie des notes fantômes mise à l'échelle (la géométrie de MuseScore dépend de
 *  `mag` : épaisseur/épaule non rejouées) ; forme de l'accord principal = têtes, altérations, lignes supplémentaires, hampe, crochet (sans points
 *  d'augmentation) ; note d'aide sans effet sur la mise en page des autres voix.
 */
import { PID, SID, getProperty } from '../model/index.js';
import { ornamentIntervalOf } from '../model/trill.js';
import { noteY } from './pitchpos.js';
import { glyphItem, glyphWidth } from './header.js';
import { accidentalPad } from './chordgeom.js';
import { scoreParentheses } from './parentheses.js';
import { LEDGER_HEAD_WIDTH } from './constants.js';
import { typedBoxes, minHorizontalDistance } from './gracenotes.js';
import { staffTrills } from './painters/resolved.js';
import { ornamentTarget } from './trilllines.js';

// Signes dont `hasIntervalAbove` est vrai (`mordent` = glyphe sans trait = SMuFL shortTrill) ; lignes : trille, up-prall, prall-prall.
const SIGN_ABOVE = new Set(['trill', 'mordent', 'turn', 'turnInverted']);
const SIGN_TYPES = new Set(['trill', 'mordent', 'mordentInverted', 'turn', 'turnInverted']);
const LINE_ABOVE = new Set(['trill', 'upPrall', 'prallPrall']);
const FULL_CHOICE_SIGN = new Set(['trill']);
const FULL_CHOICE_LINE = new Set(['trill', 'prallPrall']);

/** Ornement qui fixe la note d'aide de l'accord (`Chord::findOrnament`) : le 1er signe d'ornement, sinon la ligne qui COMMENCE ici. */
export function cueOrnamentOf(ctx, chord, staff, style) {
  const sign = (getProperty(chord, PID.ARTICULATIONS) ?? []).find((a) => SIGN_TYPES.has(a.type));
  let entry = null;
  let fullChoice = false;
  let hasAbove = false;
  if (sign) {
    entry = sign; fullChoice = FULL_CHOICE_SIGN.has(sign.type); hasAbove = SIGN_ABOVE.has(sign.type);
  } else {
    const line = staffTrills(ctx, staff).find((l) => l.startChordId === chord.id);
    if (!line) return null;
    entry = line; fullChoice = FULL_CHOICE_LINE.has(line.trillType); hasAbove = LINE_ABOVE.has(line.trillType);
  }
  if (!hasAbove) return null;
  const show = ornamentIntervalOf(entry, true).step !== 1 || (fullChoice && style(SID.TRILL_ALWAYS_SHOW_CUE_NOTE));
  return show ? entry : null;
}

/**
 * Éléments d'affichage de la note d'aide d'un accord posé en `x` (origine de la tête principale) ; `parentItems` = éléments déjà dessinés pour
 * l'accord principal (sa forme). Renvoie [] si l'accord n'a pas de note d'aide.
 */
export function cueNoteItems({ ctx, chord, staff, clefKey, keySig, x, parentItems, glyphs, style, lines = 5, voice = 0 }) {
  if (clefKey && typeof clefKey === 'object') return []; // percussion : pas d'ornement à hauteur
  const orn = cueOrnamentOf(ctx, chord, staff, style);
  if (!orn) return [];
  const target = ornamentTarget(orn, chord, keySig, false);
  if (!target) return [];
  const mag = style(SID.SMALL_NOTE_MAG);
  const y = noteY({ step: target.step, alter: target.alter, octave: target.octave }, clefKey);
  const head = 'noteheadBlack';
  const hw = glyphWidth(glyphs, head) * mag;
  const accName = target.glyph;
  const accW = accName ? (glyphWidth(glyphs, accName) + accidentalPad(y, style, lines)) * mag : 0;
  const ref = chord.id;
  // forme de la note d'aide en repère local (tête en 0)
  const build = (hx) => {
    const items = [];
    items.push({ ...glyphItem(head, hx, y, { ref, mag }), cue: true });
    if (accName) items.push({ ...glyphItem(accName, hx - accW, y, { ref, role: 'accidental', mag }), cue: true });
    const ext = style(SID.LEDGER_LINE_EXTENSION) * mag;
    const need = [];
    if (y < 0) for (let l = -1; l >= Math.ceil(y); l--) need.push(l);
    if (y > lines - 1) for (let l = lines; l <= Math.floor(y); l++) need.push(l);
    for (const l of need) {
      items.push({ kind: 'line', role: 'ledger', x1: hx - ext, x2: hx + LEDGER_HEAD_WIDTH * mag + ext, y1: l, y2: l, width: style(SID.LEDGER_LINE_THICKNESS) * mag, ref, cue: true });
    }
    const hb = glyphs.glyphs[head].bbox;
    const scaled = { bbox: { bBoxNE: [hb.bBoxNE[0] * mag, hb.bBoxNE[1] * mag], bBoxSW: [hb.bBoxSW[0] * mag, hb.bBoxSW[1] * mag] } };
    const left = hx - accW;
    for (const p of scoreParentheses({ left, width: hx + hw - left, y, glyph: scaled, ref })) items.push({ ...p.item, cue: true });
    return items;
  };
  const local = build(0);
  // `layoutOrnamentCueNote` : distance minimale entre la forme de l'accord principal et celle de la note d'aide
  const parentBoxes = typedBoxes(parentItems.filter((i) => !i.cue).map((i) => ({ ...i, x: i.x - x, x1: i.x1 - x, x2: i.x2 - x })), glyphs, { voice, mag: 1 });
  const cueBoxes = typedBoxes(local, glyphs, { voice, mag });
  const parens = local.filter((i) => i.kind === 'curve').map((i) => {
    const xs = [i.x1, i.topC1x, i.topC2x, i.botC1x, i.botC2x];
    return { type: 'note', left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(i.y1, i.y2), top: Math.max(i.y1, i.y2), voice, beamId: null, mag };
  });
  const dist = minHorizontalDistance(parentBoxes, [...cueBoxes, ...parens]);
  if (!Number.isFinite(dist)) return [];
  return build(x + dist);
}
