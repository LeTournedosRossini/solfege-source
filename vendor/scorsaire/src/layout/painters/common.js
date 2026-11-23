/* Outils partagés par les peintres. */
import { PID, getProperty, itemDuration, ZERO, fAdd } from '../../model/index.js';
import { CLEF_DEFS } from '../constants.js';

/** A rest switched off for printing (`PID.VISIBLE` false): its items keep their place but are flagged `hidden` (grey on the screen, never drawn in an export, a print or a reader). */
export function hideIfInvisible(item, items) {
  return getProperty(item, PID.VISIBLE) === false ? items.map((it) => ({ ...it, hidden: true })) : items;
}

/** Lignes régulières d'une portée à `count` lignes (espacées d'un espace). */
export function lineStack(count, thickness) {
  return Array.from({ length: count }, (_, y) => ({ y, thickness }));
}

/** Nombre de lignes de la portée (`PID.LINE_COUNT`, 5 par défaut) : portées de notation à 1, 2, 3, 4, 5 lignes. */
export function staffLineCount(staff) {
  if (staff && ['rhythm', 'neutral'].includes(getProperty(staff, PID.STAFF_TYPE))) return 1; // portée rythmique : une ligne (virtuelle à 0 ligne tracée)
  const n = staff ? getProperty(staff, PID.LINE_COUNT) : 5;
  return Number.isInteger(n) && n >= 1 ? n : 5;
}

/**
 * Clé de base de la portée. Affichage de concert (`concertPitch`) : `PID.CONCERT_CLEF` si elle existe, sinon la même clé
 * (`Staff::clef` : `concertPitch ? concertClef : transposingClef`).
 */
export function clefKeyOf(staff, concertPitch = false) {
  const key = (concertPitch && getProperty(staff, PID.CONCERT_CLEF)) || getProperty(staff, PID.CLEF);
  return CLEF_DEFS[key] ? key : 'G';
}

/**
 * Éléments d'une mesure pour les portées à contenu séquentiel : dans chaque voix, les éléments se suivent ; l'instant
 * d'un élément est la somme des durées réelles des précédents (fractions exactes, MuseScore : `Segment::rtick`).
 */
export function sequentialEntries(staff, mi, ctx) {
  const length = ctx.barLengths[mi];
  const entries = [];
  staff.voices.forEach((voice, v) => {
    const measure = voice.measures[mi];
    if (!measure) return;
    let position = ZERO;
    for (const item of measure.items) {
      const duration = itemDuration(item, length);
      entries.push({ position, duration, item, voice: v });
      position = fAdd(position, duration);
    }
  });
  return entries;
}

/** Glyphe de silence pour une valeur de note (le prototype place tous les silences sur la ligne du milieu). */
export function restGlyphName(base) {
  switch (base) {
    case 'breve': case 'whole': case 'measure': return 'restWhole';
    case 'half': return 'restHalf';
    case 'quarter': return 'restQuarter';
    case 'eighth': return 'rest8th';
    case 'sixteenth': return 'rest16th';
    case 'thirtysecond': return 'rest32nd';
    default: return 'rest64th';
  }
}

/**
 * Glyphe d'un silence à l'ordonnée `y` (y vers le haut, 0 = ligne du bas, distance de lignes 1) : un silence de ronde / de mesure / de blanche
 * qui sort de la portée prend la variante à ligne supplémentaire (`Rest::getSymbol`, `RestLayout::updateSymbol` : `line = floor(y / lineDist)`
 * depuis la ligne du HAUT, hors portée si `line < 0 || line >= lines`).
 */
export function restGlyphAt(base, y, lines = 5) {
  const name = restGlyphName(base);
  if (name !== 'restWhole' && name !== 'restHalf') return name;
  const line = Math.floor((lines - 1) - y + 1e-9);
  return line < 0 || line >= lines ? `${name}LegerLine` : name;
}

/** Silence de mesure dessiné centré dans la mesure, sinon à la position de sa colonne. */
export function restX(entry, x, ctx, glyphWidthSpaces) {
  const measure = ctx.measure;
  if (entry.item.props && getProperty(entry.item, PID.DURATION).base === 'measure' && measure) {
    return measure.x0 + (measure.width - glyphWidthSpaces) / 2;
  }
  return x;
}
