/*
 * READER SETTINGS of a layout for a tablet (screen 2): what the author prepares in advance for the Lecteur when it paginates by itself (no fixed page fits the screen):
 * which containers to show (by category), regular measures, measures per line. They sit under what the musician chose on the device (the person's own choice always wins).
 * Stored on the part as `PID.PART_READER`: { containers?: category[], regular?: boolean, perRow?: 1..12, cards?: 'none'|'first'|'all', spacing?: 0.2..2, cardScale?: 0.5..1.5, cardGap?: 0..2, tempo?: boolean (the tempo texts; hidden unless true) }; a missing key = no opinion. Writes go through `doc`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';

/** The categories of containers the person can switch (lecteur/containerfilter.js sorts the containers into them). */
export const CONTAINER_CATEGORIES = Object.freeze(['text', 'score', 'rhythm', 'tab', 'percussion', 'neutral', 'diagram']);
export const DEFAULT_CONTAINERS = Object.freeze(['rhythm']); // everything hidden but the rhythms: a clean page to read on stage
export const PER_ROW_MAX = 12;
export const CARD_MODES = Object.freeze(['none', 'first', 'all']);
export const SPACING_MIN = 0.2; // the room between the systems, as a factor of the usual one
export const SPACING_MAX = 2;
export const CARD_SCALE_MIN = 0.5; // the size of the cards of the structure, as a factor of the usual one
export const CARD_SCALE_MAX = 1.5;
export const CARD_GAP_MIN = 0; // the distance between a card and what it sits on (0 = glued)
export const CARD_GAP_MAX = 2;

export const readerSettingsOf = (part) => getProperty(part, PID.PART_READER) ?? {};

/** Cleans a patch into the stored shape; `null` for a key removes it. Throws on an impossible value. */
export function mergeReaderSettings(current, patch) {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) { delete next[key]; continue; }
    if (key === 'containers') {
      if (!Array.isArray(value) || !value.every((c) => CONTAINER_CATEGORIES.includes(c))) throw new Error('Unknown container category');
      next.containers = CONTAINER_CATEGORIES.filter((c) => value.includes(c));
    } else if (key === 'regular') next.regular = value === true;
    else if (key === 'tempo') next.tempo = value === true;
    else if (key === 'perRow') {
      if (!Number.isInteger(value) || value < 1 || value > PER_ROW_MAX) throw new Error(`Measures per line between 1 and ${PER_ROW_MAX}`);
      next.perRow = value;
    } else if (key === 'cards') {
      if (!CARD_MODES.includes(value)) throw new Error('Unknown card mode');
      next.cards = value;
    } else if (key === 'spacing') {
      if (!(value >= SPACING_MIN && value <= SPACING_MAX)) throw new Error(`Spacing between ${SPACING_MIN} and ${SPACING_MAX}`);
      next.spacing = Math.round(value * 100) / 100;
    } else if (key === 'cardScale') {
      if (!(value >= CARD_SCALE_MIN && value <= CARD_SCALE_MAX)) throw new Error(`Card size between ${CARD_SCALE_MIN} and ${CARD_SCALE_MAX}`);
      next.cardScale = Math.round(value * 100) / 100;
    } else if (key === 'cardGap') {
      if (!(value >= CARD_GAP_MIN && value <= CARD_GAP_MAX)) throw new Error(`Card distance between ${CARD_GAP_MIN} and ${CARD_GAP_MAX}`);
      next.cardGap = Math.round(value * 100) / 100;
    } else throw new Error(`Unknown reader setting: ${key}`);
  }
  return next;
}
