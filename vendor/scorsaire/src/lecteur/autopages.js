/*
 * The Lecteur's own pages (no fixed layout fits the screen): the movement is drawn for the width of the screen with the settings of the moment, then cut into screens of whole
 * systems. Shared by the Lecteur and by the preview of screen 2, so that the preview is EXACTLY what the Lecteur will do. DOM: the music is drawn into `holder`.
 */
import { drawCell } from '../reader/core.js';
import { shiftForDisplay, chordViewForDisplay } from '../layout/displayshift.js';
import { SID } from '../model/sid.js';
import { resolveStyle } from '../model/props.js';
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { hintsForShown } from '../model/pagehints.js';
import { filterContainers, scaleContainers, DEFAULT_CONTAINERS } from './containerfilter.js';
import { paginateSystems } from './pages.js';

export const EDGE_MARGIN = 4; // px around the music: it starts at the edge of the screen
/** Tight vertical spacing for reading on stage (staff spaces; the marks above a staff still push the lines apart when they need room): the factors tried in turn. */
const TIGHTNESS = [1, 0.7, 0.5];
const compactSpacing = (k, sp = 1) => ({
  [SID.SYSTEM_TOP_MARGIN]: Math.max(1.6 * sp, 2.8 * k * sp), [SID.SYSTEM_BOTTOM_MARGIN]: Math.max(1.2 * sp, 2.2 * k * sp), [SID.STAFF_DISTANCE]: Math.max(2.4, 4 * k), [SID.AKKOLADE_DISTANCE]: Math.max(2.4, 4 * k),
});

/**
 * @param o.tracks    ids of the tracks shown (null = all)
 * @param o.settings  { regular, musicScale (the writing alone, 0.5 to 2), musicOnly (what is not the writing keeps its size), grid ('off' | 'columns'), gridBase, gridChords, gridStretch ('off' | '2' | '3' | 'any'), perRow, containers, cards, spacing, cardScale, cardGap, tempo } as the Lecteur resolved them (defaults when missing)
 * @param o.height    height of the page area in pixels
 * @returns {{ shown, pages }} `shown.box` is the drawing (shift it with `showAutoPage`), `pages` the screens
 */
/** The sizes (in points or in spaces, proportional to the staff space) that « writing only » divides by the size of the writing. */
const WRITING_ONLY_SIDS = [SID.LYRICS_FONT_SIZE, SID.MEASURE_NUMBER_SIZE, SID.FINGERING_FONT_SIZE, SID.STICKING_FONT_SIZE, SID.STICKING_SYMBOL_SIZE];

export function drawAutoPages(holder, { work, movement, tracks = null, transpose = 0, zoom = 1, width, height, settings = {} }) {
  const fifths = getProperty(movement.masterbars[0], PID.KEY_SIG) ?? 0;
  const music = Math.max(0.5, Math.min(2, settings.musicScale ?? 1)); // the size of the writing alone (staves, notes, chords…): the cards keep their own size, so their scale is divided by it
  const styles = { [SID.REGULAR_MEASURES]: settings.regular === true, [SID.MEASURE_GRID]: settings.grid === 'columns' ? 'columns' : 'off', [SID.MEASURE_GRID_BASE]: settings.gridBase ?? 'common', [SID.MEASURE_GRID_CHORDS]: settings.gridChords ?? 2, [SID.MEASURE_GRID_STRETCH]: settings.gridStretch ?? 'off', [SID.MEASURES_PER_SYSTEM]: settings.perRow ?? 0, [SID.SHOW_INSTRUMENT_NAMES]: false, [SID.ENABLE_INDENTATION_ON_FIRST_SYSTEM]: false, [SID.READER_SECTION_CARDS]: settings.cards ?? 'first', [SID.SECTION_CARD_SCALE]: (settings.cardScale ?? 1) / music, [SID.SECTION_CARD_GAP]: (settings.cardGap ?? 1) / music, [SID.SHOW_TEMPO_TEXTS]: settings.tempo === true }; // the cards of the structure as an author writes them on a part (the look of screen 2), not the strip of the interface
  // « writing only »: what is drawn at the scale of the staves but is not the writing is made smaller by as much (the lyrics under the notes, the measure numbers, the fingerings, the stickings),
  // the containers, the volta numbers, the free texts above the measures (dolce, solo) and the jump signs (segno, coda, D.S.) too (those through `READER_MARK_SCALE`)
  const writingOnly = settings.musicOnly === true && music !== 1;
  if (writingOnly) for (const sid of WRITING_ONLY_SIDS) styles[sid] = resolveStyle(sid, [null, movement.style]) / music;
  if (writingOnly) styles[SID.READER_MARK_SCALE] = 1 / music; // the free texts (dolce, solo) and the jump signs (segno, coda, D.S.) too
  const spacing = settings.spacing ?? 1;
  // the room between two systems is the margins AND the clearance kept around the marks (the cards, the chords…): the person's factor scales both
  if (spacing !== 1) styles[SID.SYSTEM_EDGE_DISTANCE] = resolveStyle(SID.MIN_VERTICAL_DISTANCE, [null, movement.style]) * spacing;
  const hints = hintsForShown(movement, tracks); // the page turns the author advised for the track shown
  let shown; let pages; let fit = 1;
  const draw = (tight) => {
    shown = drawCell(holder, { work, movement, tracks, styles: { ...styles, ...compactSpacing(tight, spacing) }, margin: EDGE_MARGIN, shown: scaleContainers(filterContainers(shiftForDisplay(chordViewForDisplay(movement, settings.chordView ?? 'author'), transpose, { fifths }), settings.containers ?? DEFAULT_CONTAINERS), writingOnly ? music : 1), width, staffSpace: Math.max(5, Math.min(11, width / 95)) * fit * music, mode: 'wrap', zoom, header: false, signsColor: settings.signsColor ?? null });
    shown.box.style.transformOrigin = '0 0';
    pages = paginateSystems(shown.laid.layout.systems, { staffSpace: shown.laid.staffSpace, margin: shown.laid.margin, pageHeight: height, hints });
  };
  // a system taller than the screen could never be read: the staves are drawn smaller until the tallest page fits (at most three tries, never under 35 %)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // a concert needs as many measures as possible on a page: tight spacing between the lines, tighter still (never touching) while a song that is almost one page can become one
    // (a tighter spacing never makes MORE pages: when the tightest still needs several, no looser one could be a single page, and the tightest is what the loop would end on — one layout instead of three)
    draw(TIGHTNESS[TIGHTNESS.length - 1]);
    if (pages.length === 1) for (const tight of TIGHTNESS) { draw(tight); if (pages.length === 1) break; }
    const tallest = Math.max(...pages.map((p) => p.y1 - p.y0));
    if (tallest <= height || fit <= 0.35) break;
    fit = Math.max(0.35, fit * (height / tallest) * 0.97);
  }
  return { shown, pages };
}

/** Puts page `p` of the drawing on the screen (the holder is as high as the page). */
export function showAutoPage(holder, shown, p, height) {
  holder.style.height = `${Math.min(height, Math.max(1, p.y1 - p.y0))}px`;
  shown.box.style.transform = `translateY(${-p.y0}px)`;
}

/**
 * What the Lecteur changes on top of an author's layout (layoutPart's `tweak`): the cards of the sections and the room between the systems. null when there is nothing to change.
 * @param o.cards    null (the author's choice) or 'none' | 'first' | 'all'
 * @param o.spacing  factor of the author's room between the systems (1 = as made)
 * @param o.tempo    true = keep the tempo texts (left out by default)
 * @param o.cardScale / o.cardGap  factors of the author's size of the cards and of their distance to what they sit on (1 = as made)
 */
export function readerTweak({ cards = null, spacing = 1, cardScale = 1, cardGap = 1, tempo = false } = {}) {
  if (!cards && spacing === 1 && cardScale === 1 && cardGap === 1 && tempo) return null;
  return (sid, value, get) => {
    if (sid === SID.SHOW_TEMPO_TEXTS && !tempo) return false; // the tempo texts stay out of the Lecteur's pages unless asked for
    if (cards && sid === SID.PART_SECTION_CARDS) return cards;
    if (cardScale !== 1 && sid === SID.SECTION_CARD_SCALE) return value * cardScale;
    if (cardGap !== 1 && sid === SID.SECTION_CARD_GAP) return value * cardGap;
    if (spacing !== 1 && sid === SID.SYSTEM_EDGE_DISTANCE) return (value >= 0 ? value : get(SID.MIN_VERTICAL_DISTANCE)) * spacing;
    if (spacing !== 1 && (sid === SID.SYSTEM_TOP_MARGIN || sid === SID.SYSTEM_BOTTOM_MARGIN)) return value * spacing;
    return value;
  };
}
