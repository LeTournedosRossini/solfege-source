/*
 * Sections of the form (intro, verse, chorus, bridge, coda, A, B…): the SYSTEM CONTAINERS of kind 'section' of a movement
 * (`movement.systemContainers`, `PID.CONTAINER_KIND` 'section'). A section is anchored to the START of a measure (masterbar id) and lasts until the
 * next section (or the end of the movement). It has a free label, a category (which gives its default colour: all verses share one colour, all
 * choruses another, a letter has its own) and an optional colour of its own (`PID.COLOR`). Pure data: no DOM.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';

export const SECTION_CATEGORIES = Object.freeze(['intro', 'verse', 'preChorus', 'chorus', 'bridge', 'solo', 'interlude', 'outro', 'coda', 'letter', 'custom']);
/** Names offered by the drawer, by language (the label is free text: these are only the starting points). */
export const SECTION_NAMES = Object.freeze({
  fr: { intro: 'Intro', verse: 'Couplet', preChorus: 'Pré-refrain', chorus: 'Refrain', bridge: 'Pont', solo: 'Solo', interlude: 'Interlude', outro: 'Outro', coda: 'Coda' },
  en: { intro: 'Intro', verse: 'Verse', preChorus: 'Pre-chorus', chorus: 'Chorus', bridge: 'Bridge', solo: 'Solo', interlude: 'Interlude', outro: 'Outro', coda: 'Coda' },
});
export const SECTION_LETTERS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
/** Low-saturation colours (they sit behind the music): category → colour. */
export const SECTION_COLORS = Object.freeze({
  intro: '#b8c7e6', verse: '#bfe3c0', preChorus: '#e6dcb8', chorus: '#f2c4c4', bridge: '#d9c4ec', solo: '#f7d9b0', interlude: '#c9e6e6', outro: '#cfd3d8', coda: '#cfd3d8', custom: '#e0e0e0',
});
const LETTER_COLORS = Object.freeze(['#c4d7f2', '#f2d7c4', '#d4f2c4', '#f2c4e6', '#f2f0c4', '#c4f2ea', '#dcc4f2', '#f2c4c4']);
/** Palette offered for a colour of its own (same pastel family). */
export const SECTION_PALETTE = Object.freeze([...new Set([...Object.values(SECTION_COLORS), ...LETTER_COLORS])]);

const isSectionContainer = (c) => getProperty(c, PID.CONTAINER_KIND) === 'section';

/** Default colour of a (category, label). A letter section takes the colour of its letter (A, B, C… cycle). */
export function defaultSectionColor(category, label) {
  if (category === 'letter') {
    const letter = String(label ?? 'A').trim().toUpperCase().charCodeAt(0) - 65;
    return LETTER_COLORS[((Number.isFinite(letter) ? letter : 0) % LETTER_COLORS.length + LETTER_COLORS.length) % LETTER_COLORS.length];
  }
  return SECTION_COLORS[category] ?? SECTION_COLORS.custom;
}

/** Colour of a section container: its own `PID.COLOR`, else the default of its category / label. */
export function sectionColor(container) {
  return getProperty(container, PID.COLOR) || defaultSectionColor(getProperty(container, PID.SECTION_CATEGORY) ?? 'custom', getProperty(container, PID.LABEL));
}

/**
 * Sections of a movement in measure order: [{ container, id, index (measure), measureId, label, category, color }] — a section whose measure
 * no longer exists is ignored; two sections on one measure: the last one in the list wins.
 */
export function sectionList(mv) {
  const indexOf = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  const byIndex = new Map();
  for (const c of mv.systemContainers ?? []) {
    if (!isSectionContainer(c)) continue;
    const measureId = getProperty(c, PID.MEASURE_ID);
    const index = indexOf.get(measureId);
    if (index === undefined) continue;
    byIndex.set(index, {
      container: c, id: c.id, index, measureId, label: getProperty(c, PID.LABEL) ?? '', category: getProperty(c, PID.SECTION_CATEGORY) ?? 'custom', color: sectionColor(c),
    });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** Measure ranges of the sections: [{ ...section, from, to }] (`to` inclusive). Measures before the first section belong to none. */
export function sectionSpans(mv) {
  const list = sectionList(mv);
  const last = mv.masterbars.length - 1;
  return list.map((s, i) => ({ ...s, from: s.index, to: i + 1 < list.length ? list[i + 1].index - 1 : last }));
}

/** The section span that contains measure `mi`, or null. */
export function sectionAtMeasure(mv, mi) {
  return sectionSpans(mv).find((s) => mi >= s.from && mi <= s.to) ?? null;
}

/**
 * Splits a text that may carry section cards written as `{{Label}}`, `{{Label|category}}` or `{{Label|#rrggbb}}`
 * into runs: `{ text }` or `{ card: { label, category?, color? } }`. An unclosed or empty `{{…}}` stays plain text.
 */
export function parseCardText(text) {
  const runs = [];
  const re = /\{\{([^{}|]+)(?:\|([^{}]*))?\}\}/g;
  let last = 0; let m;
  const src = String(text ?? '');
  while ((m = re.exec(src))) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index) });
    const label = m[1].trim();
    const arg = (m[2] ?? '').trim();
    const card = { label };
    if (/^#[0-9a-f]{3,8}$/i.test(arg)) card.color = arg; else if (SECTION_CATEGORIES.includes(arg)) card.category = arg;
    runs.push({ card });
    last = m.index + m[0].length;
  }
  if (last < src.length) runs.push({ text: src.slice(last) });
  return runs;
}

/** Colour of an inline card: its own colour, else the colour of a section of the work with the same label, else its category's default. */
export function inlineCardColor(card, work) {
  if (card.color) return card.color;
  for (const mv of work.movements) {
    const hit = sectionList(mv).find((s) => String(s.label).trim().toLowerCase() === card.label.toLowerCase());
    if (hit) return hit.color;
  }
  return defaultSectionColor(card.category ?? 'custom', card.label);
}
