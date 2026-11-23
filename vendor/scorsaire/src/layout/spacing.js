/*
 * Espacement horizontal à ressorts (MuseScore `HorizontalSpacing::durationStretchForTicks` +
 * `chordRestSegmentNaturalWidth`, `horizontalspacing.cpp`) : chaque durée reçoit un facteur d'ÉTIREMENT relatif à la
 * NOIRE (pas à la durée la plus courte du morceau, contrairement à l'ancienne loi du prototype) —
 *
 *   étirement(durée) = pente ^ log2(durée / noire)        (pente = Sid::measureSpacing, 1,5 par défaut)
 *
 * — chaque doublement de durée multiplie l'étirement par la pente, jamais par 2 : une ronde n'occupe pas 16× la place
 * d'une double-croche. La largeur naturelle est cet étirement multiplié par DEFAULT_QUARTER_NOTE_SPACE (la place d'une
 * noire). Ce même facteur d'étirement sert aussi de RAIDEUR INVERSE au ressort de la colonne à la justification
 * (`springs.js` : raideur = 1 / étirement) : une colonne de durée courte est plus raide, elle absorbe moins que sa part
 * uniforme de l'espace supplémentaire — c'est ce qui garde des notes de même durée visuellement régulières.
 */
import { SID } from '../model/index.js';
import { fToNumber } from '../model/fraction.js';
import { DEFAULT_QUARTER_NOTE_SPACE } from './constants.js';

const QUARTER = 1 / 4;

/** Facteur d'étirement (sans unité) d'une durée par rapport à la noire — aussi la raideur inverse d'un ressort. */
export function durationStretch(duration, style) {
  const slope = style(SID.MEASURE_SPACING);
  const ratio = fToNumber(duration) / QUARTER;
  return slope ** Math.log2(ratio);
}

/** Largeur naturelle (espaces de portée) associée à une durée : DEFAULT_QUARTER_NOTE_SPACE × son étirement. */
export function noteSpace(duration, style) {
  return DEFAULT_QUARTER_NOTE_SPACE * durationStretch(duration, style);
}

/**
 * Place naturelle d'une colonne pour un élément : celle de la durée du SEGMENT (`entry.spaceStretch`, posé par `columns.js`), pas de
 * la durée propre de l'élément — MuseScore `chordRestSegmentNaturalWidth`. Sans colonne (appel direct), repli sur la durée de l'élément.
 */
export function entrySpace(entry, style) {
  return DEFAULT_QUARTER_NOTE_SPACE * (entry.spaceStretch ?? durationStretch(entry.duration, style));
}

/**
 * Étirement d'un segment, port de `HorizontalSpacing::computeSegmentDurationStretch` : `segTicks` = temps jusqu'au prochain instant
 * (sur N'IMPORTE QUELLE portée), `shortest` = plus courte durée d'un élément qui y attaque ; `prev` = { segTicks, shortest } du segment
 * précédent (ou null). Quand le plus court élément remplit le segment : étirement de cette durée ; sinon (polyrythmie) proportionnel.
 */
export function segmentStretch(segTicks, shortest, prev, style) {
  const t = fToNumber(segTicks), sh = fToNumber(shortest);
  const hasAdjacent = sh === t;
  if (hasAdjacent) return durationStretch(segTicks, style);
  const prevHasAdjacent = prev && fToNumber(prev.shortest) === fToNumber(prev.segTicks);
  if (prev && !prevHasAdjacent && fToNumber(prev.shortest) < sh) {
    return durationStretch(prev.shortest, style) * (t / fToNumber(prev.shortest));
  }
  return durationStretch(shortest, style) * (t / sh);
}
