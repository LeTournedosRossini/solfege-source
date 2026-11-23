/*
 * Positionneur de portée rythmique (`rhythm`, `neutral`) : même rôle que drumpos.js pour la percussion. Toutes les notes sont posées sur la ligne
 * du milieu (portée à 0 ou 1 ligne : une ligne virtuelle à y = 0), sans hauteur ni altération. Tête : `PID.RHYTHM_HEAD` de la portée —
 * 'slash' = têtes de barre oblique comme MuseScore (`Note::noteHead`, HEAD_SLASH : ronde `noteheadSlashWhiteWhole`, blanche `noteheadSlashWhiteHalf`,
 * noire et plus courtes `noteheadSlashHorizontalEnds`), 'normal' = tête ordinaire. Sens des hampes : `PID.RHYTHM_STEM` de la portée
 * (MuseScore : vers le bas, `Chord::setSlash`), surchargé par `PID.STEM_DIRECTION` de l'accord (traité par le peintre `score`).
 */
import { PID, getProperty } from '../model/index.js';
import { headGlyph } from './chordgeom.js';

const SLASH_HEADS = { breve: 'noteheadSlashWhiteWhole', whole: 'noteheadSlashWhiteWhole', half: 'noteheadSlashWhiteHalf' };

export function rhythmPositioner(staff, glyphs) {
  const slash = getProperty(staff, PID.RHYTHM_HEAD) === 'slash';
  const stemUp = getProperty(staff, PID.RHYTHM_STEM) === 'up';
  const widthOf = (name) => glyphs.glyphs[name].bbox.bBoxNE[0];
  const head = (base) => (slash ? (SLASH_HEADS[base] ?? 'noteheadSlashHorizontalEnds') : headGlyph(base));
  return {
    perc: true,
    rhythm: true,
    percmap: null,
    lineCount: 1,
    soundOf: () => null,
    soundKey: () => 'rhythm',
    noteY: () => 0,
    noteHead: (note, base) => head(base),
    chordHead: (chord, base) => head(base),
    /** Sens de hampe par défaut de la portée (true = haut). */
    soundStem: () => stemUp,
  };
}
