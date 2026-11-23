/*
 * Templates — intents without DOM (the template picker of the tracks panel).
 * The list of templates and the user's own ones (kept in the preferences, never in the document) are read here; loading a template is one
 * document transaction, saving / deleting / exporting / importing touch the preferences only.
 */
import {
  BUILTIN_TEMPLATES, builtinTemplate, templateCategories, templateTitle, templatePartNames, templateFromMovement, applyTemplate,
} from '../model/index.js';
import { exportPreferences, importPreferences } from '../model/preferences.js';

export class TemplateError extends Error {
  constructor(code, message) { super(message); this.name = 'TemplateError'; this.code = code; }
}

const userItems = (preferences) => preferences.get('templates')?.items ?? [];

/** Everything the picker shows: built-in categories with their templates, then the user's templates. */
export function templateCatalog(preferences, lang = 'en') {
  const describe = (t) => ({ id: t.id, title: templateTitle(t, lang), parts: templatePartNames(t, lang).map((p) => p.name), source: t.source ?? 'user', order: t.order ?? null });
  return {
    categories: templateCategories(lang).map((c) => ({ ...c, templates: BUILTIN_TEMPLATES.filter((t) => t.category === c.id).map(describe) })),
    user: userItems(preferences).map((t) => describe({ ...t, source: 'user' })),
  };
}

export function findTemplate(preferences, id) {
  return builtinTemplate(id) ?? userItems(preferences).find((t) => t.id === id) ?? null;
}

/** Loads the template into movement `movement` (call inside `app.edit`); returns { added, skipped }. */
export function applyTemplateIntent(doc, preferences, id, { mode = 'add', movement = 0, lang = 'en' } = {}) {
  const template = findTemplate(preferences, id);
  if (!template) throw new TemplateError('unknown', `Unknown template: ${id}`);
  const mv = doc.work.movements[movement];
  if (!mv) throw new TemplateError('unknown', `Unknown movement: ${movement}`);
  return applyTemplate(doc, mv, { ...template, source: template.source === 'musescore' ? 'musescore' : 'user' }, { mode, lang });
}

/** Saves the tracks of a movement as a user template (same name = replaced). Returns the template id. */
export function saveTemplateIntent(doc, preferences, name, { movement = 0 } = {}) {
  const mv = doc.work.movements[movement];
  if (!mv) throw new TemplateError('unknown', `Unknown movement: ${movement}`);
  if (!mv.tracks.length) throw new TemplateError('empty', 'No track to save');
  let template;
  try { template = templateFromMovement(mv, name); } catch (e) { throw new TemplateError('name', e.message); }
  const items = userItems(preferences).filter((t) => t.name.trim().toLowerCase() !== template.name.toLowerCase());
  preferences.set('templates', { items: [...items, template] });
  return template.id;
}

export function deleteTemplateIntent(preferences, id) {
  const items = userItems(preferences);
  if (!items.some((t) => t.id === id)) throw new TemplateError('unknown', `Unknown user template: ${id}`);
  const rest = items.filter((t) => t.id !== id);
  if (rest.length) preferences.set('templates', { items: rest }); else preferences.clear('templates');
}

/** Text of a file holding the user's templates (a preferences file with the `templates` section only). */
export function exportTemplatesText(preferences) {
  const items = userItems(preferences);
  if (!items.length) throw new TemplateError('empty', 'No template to export');
  return exportPreferences({ templates: { items } });
}

/** Reads a file of templates and adds them to the user's (same id = replaced). Returns the number read. */
export function importTemplatesText(preferences, text) {
  let read;
  try { read = importPreferences(text).templates; } catch (e) { throw new TemplateError('file', e.message); }
  if (!read?.items?.length) throw new TemplateError('file', 'No template in this file');
  const incoming = new Map(read.items.map((t) => [t.id, t]));
  const items = [...userItems(preferences).filter((t) => !incoming.has(t.id)), ...incoming.values()];
  preferences.set('templates', { items });
  return read.items.length;
}
