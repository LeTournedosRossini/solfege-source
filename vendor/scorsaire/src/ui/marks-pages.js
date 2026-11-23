/*
 * The "marks" drawer is a small menu of six categories; each category is a page of buttons: the six chosen by Jean (19/10/2026, docs/organisation-barres-
 * contextuelles.md) and, behind a "+" button, the others. Pure data (no DOM): a key is `group:name` (the same groups as `mark-icons.js`).
 */
import { ARTICULATION_CHOICES, ALL_DYNAMICS, GUITAR_ARTICULATIONS, TECH_LINE_CHOICES, CHORD_PROP_CHOICES, NOTE_FLAG_CHOICES } from './marks-intents.js';

export const BEND_TYPES = Object.freeze(['bend', 'preBend', 'graceNoteBend', 'slightBend', 'dive', 'preDive', 'dip', 'scoop']);

const all = {
  artic: ARTICULATION_CHOICES.map((t) => `artic:${t}`),
  dyn: ALL_DYNAMICS.map((t) => `dyn:${t}`),
  span: ['span:cresc', 'span:decresc', 'span:slur', 'span:hopo'],
  guitar: ['capo:open', ...GUITAR_ARTICULATIONS.map((t) => `artic:${t}`), ...TECH_LINE_CHOICES.map((t) => `tech:${t}`), ...Object.keys(CHORD_PROP_CHOICES).filter((t) => !t.startsWith('slide-')).map((t) => `chord:${t}`), 'chord:arpeggio-slower', 'chord:arpeggio-faster', ...Object.keys(NOTE_FLAG_CHOICES).map((t) => `flag:${t}`)],
  brass: ['chord:slide-fall', 'chord:slide-doit', 'chord:slide-plop', 'chord:slide-scoop'],
  bend: ['bend:wheel', ...BEND_TYPES.map((t) => `bend:${t}`), 'bend:release'],
};
const visible = {
  artic: ['artic:staccato', 'artic:accent', 'artic:marcato', 'artic:tenuto', 'artic:accentStaccato', 'artic:tenutoAccent'],
  dyn: ['dyn:pp', 'dyn:p', 'dyn:mp', 'dyn:mf', 'dyn:f', 'dyn:ff'],
  span: all.span,
  guitar: ['capo:open', 'artic:pickDown', 'artic:pickUp', 'tech:palmMute', 'tech:letRing', 'chord:arpeggio-up', 'chord:arpeggio-down'],
  brass: all.brass,
  bend: ['bend:bend', 'bend:preBend', 'bend:dive', 'bend:dip', 'bend:scoop', 'bend:release'],
};

/** The six categories of the menu, in order. `icon` = [group, key] of the glyph shown on the menu button. */
export const MARK_CATEGORIES = Object.freeze([
  { id: 'artic', icon: ['artic', 'accentStaccato'], titleKey: 'marks.articulations' },
  { id: 'dyn', icon: ['dyn', 'f'], titleKey: 'marks.dynamics' },
  { id: 'span', icon: ['span', 'decresc'], titleKey: 'marks.spans' },
  { id: 'guitar', icon: ['artic', 'pickDown'], titleKey: 'marks.guitar' },
  { id: 'brass', icon: ['chord', 'slide-fall'], titleKey: 'marks.brass' },
  { id: 'bend', icon: ['bend', 'bend'], titleKey: 'marks.bends' },
].map((c) => Object.freeze({ ...c, visible: visible[c.id], rest: [...(c.id === 'dyn' ? ['dyn:clear'] : []), ...all[c.id].filter((k) => !visible[c.id].includes(k))] })));

/** Keys shown on a page: the chosen ones, or the others when `more`. */
export const pageKeys = (category, more) => (more ? category.rest : category.visible);
/** Does the category have a "+" button? */
export const hasMore = (category) => category.rest.length > 0;
export const categoryOf = (id) => MARK_CATEGORIES.find((c) => c.id === id) ?? null;
/** Every key of a category in the order of Jean's choice: the chosen ones first, then the others. The bar cuts it into pages by its real width (`bar-capacity.js`). */
export const allKeys = (category) => [...category.visible, ...category.rest];
