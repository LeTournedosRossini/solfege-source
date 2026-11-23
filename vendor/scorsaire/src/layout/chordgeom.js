/*
 * Géométrie élémentaire d'un accord de la portée « score », partagée par le peintre (`painters/score.js`) et les notes
 * d'ornement (`gracenotes.js`) : glyphe de tête, positions des notes, têtes décalées en seconde, marge des altérations.
 * Fonctions pures (pas de DOM).
 */
import { SID, PID } from '../model/index.js';
import { noteY, spellingOf } from './pitchpos.js';
import { ACCIDENTAL_PAD } from './constants.js';

export function headGlyph(base) {
  return base === 'whole' || base === 'breve' ? 'noteheadWhole' : base === 'half' ? 'noteheadHalf' : 'noteheadBlack';
}

/**
 * Tête d'UNE note selon son groupe de têtes (`TLayout::layoutNote`, 4.7.5 : note étouffée → HEAD_CROSS ; sinon harmonique → HEAD_DIAMOND ;
 * tables de `note.cpp` : ronde / blanche / noire). `getProp(note, PID)` : lecture simple. Sans effet pour les autres notes (tête de l'accord).
 */
export function noteHeadGlyph(base, note, getProp) {
  const plain = headGlyph(base);
  const kind = getProp(note, PID.MUTED) ? 'X' : getProp(note, PID.HARMONIC) ? 'Diamond' : null;
  if (!kind) return plain;
  const shape = plain === 'noteheadWhole' ? 'Whole' : plain === 'noteheadHalf' ? 'Half' : 'Black';
  return `notehead${kind}${shape}`;
}

/** Marge entre altération et tête ; plus grande sur une ligne supplémentaire pour ne jamais toucher la ligne (prototype). */
export function accidentalPad(y, style, lines = 5) {
  return y < 0 || y > lines - 1 ? style(SID.LEDGER_LINE_EXTENSION) + ACCIDENTAL_PAD : ACCIDENTAL_PAD;
}

/** Position de chaque note d'un accord, dans le contexte de la mesure. */
export function chordYs(item, clefKey, keySig) {
  // percussion : `clefKey` est le « positionneur » de la percmap (../drumpos.js), qui donne la hauteur de chaque son
  if (clefKey && typeof clefKey === 'object') return item.notes.map((note) => clefKey.noteY(note));
  return item.notes.map((note) => noteY(spellingOf(note.pitch, note.spelling, keySig), clefKey));
}

/**
 * Recouvrement des têtes en seconde (`layoutChords2` : `overlapMirror`) : la tête décalée empiète d'une largeur de hampe sur l'autre
 * (largeur de la hampe si l'accord en a une ou si c'est une ronde ; 0 pour une brève, dont la tête a des barres latérales).
 * Vérifié sur un export MuseScore Bravura (ronde en seconde : décalage = largeur de tête − 0,12).
 */
export function mirrorOverlap(base, style) {
  return base === 'breve' ? 0 : style(SID.STEM_THICKNESS);
}

/**
 * Têtes décalées d'un accord (MuseScore `ChordLayout::layoutChords2`) : on parcourt les notes de bas en haut pour une hampe
 * montante, de haut en bas pour une descendante ; deux notes voisines (écart d'une demi-ligne ou moins) sont en conflit et la 2e
 * passe de l'autre côté de la hampe ; la suivante revient du côté normal.
 * Montante : la note haute d'une seconde va à droite ; descendante : la note basse va à gauche.
 * @returns décalage x de chaque note (0, +largeur de tête ou −largeur de tête)
 */
export function headOffsets(ys, up, headW, overlap = 0) {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
  if (!up) order.reverse();
  const dx = new Array(ys.length).fill(0);
  let isLeft = up;
  let prevLine = 1000;
  for (const i of order) {
    const line = Math.round(ys[i] * 2);
    if (Math.abs(prevLine - line) < 2 || up !== isLeft) isLeft = !isLeft;
    if (up !== isLeft) dx[i] = up ? headW - overlap : -(headW - overlap);
    prevLine = line;
  }
  return dx;
}

export const FLAG = { eighth: 'flag8th', sixteenth: 'flag16th', thirtysecond: 'flag32nd' };
