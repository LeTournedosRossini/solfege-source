/*
 * Score templates: the tracks of a kind of score (Big Band, concert band, SATB…), loaded in one gesture (step 5, "tracks and staves" panel).
 * Built-in templates = those of MuseScore 4.7.5 (`share/templates`, extracted by `tools/extract-templates.py` into `templates.json`: only the
 * parts, their instruments and the score order; no measure). User templates are captured from a movement (`templateedit.js`) and kept in the
 * preferences (section `templates`, exportable with the other preferences).
 *
 * Template = { id, name (user) | title (built-in), category?, order, parts: [{ instrument|null, name?, abbreviation?, icon?, transposition?,
 *              staves: [{ type, clef?, lineCount?, props? }] }], groups?: [{ from, to, style, label?, barlines?, groups }] }
 */
import data from './templates.json' with { type: 'json' };

const ORDER_ALIAS = { orchestral: 'orchestra', 'small-concert-band': 'concert-band' }; // ids used by MuseScore's templates but absent from `orders.xml`

/** Built-in templates: the MuseScore ones, `source: 'musescore'`, their order id mapped onto a known score order. */
export const BUILTIN_TEMPLATES = Object.freeze(data.templates.map((t) => Object.freeze({ ...t, order: t.order ? (ORDER_ALIAS[t.order] ?? t.order) : null, source: 'musescore' })));

const tr = (lang) => data.translations[lang] ?? null;

/** Categories ({ id, title }) in MuseScore's order, titled in `lang` (English when untranslated). */
export function templateCategories(lang = 'en') {
  return data.categories.map((c) => ({ id: c.id, title: tr(lang)?.categories[c.title] ?? c.title }));
}
/** Displayed title of a template: its `name` (user template) or the translated MuseScore title. */
export function templateTitle(template, lang = 'en') {
  if (template.name) return template.name;
  return tr(lang)?.templates[template.title] ?? template.title;
}
export function builtinTemplate(id) {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}
