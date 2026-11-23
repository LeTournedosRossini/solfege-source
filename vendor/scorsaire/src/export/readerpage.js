/*
 * The reader as a file. PURE (the template is passed in; the editor's build embeds it as `__READER_PAGE__`, see tools/build.js).
 *   readerPageHtml(template, workText, { title }) → a COMPLETE page: the reader and the work inside it (one file, opens anywhere, needs no server).
 *   readerOnlyHtml(template)                      → the reader alone: it loads a `.scorsaire` by address (`?file=…`) or from a file the person opens.
 * The work is embedded as a JSON script; `<` is escaped so the file can never close the script tag by accident.
 */
const escapeJson = (text) => text.replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function readerPageHtml(template, workText, { title = '', images = {}, theme = null } = {}) {
  if (!template || !template.includes('<!--WORK-->')) throw new Error('Reader template unavailable');
  JSON.parse(workText); // refuses a text that is not a file
  const pics = Object.keys(images).length ? `<script type="application/json" id="scorsaire-images">${escapeJson(JSON.stringify(images))}</script>` : ''; // { id: { mime, data: data: URI } }
  const themed = theme === 'dark' || theme === 'hc' ? `<script>window.__SCORSAIRE_THEME__="${theme}";</script>` : ''; // the preview of the editor opens in the theme of the editor
  const page = template.replace('<!--WORK-->', () => `${pics}${themed}<script type="application/json" id="scorsaire-work">${escapeJson(workText)}</script>`);
  return title ? page.replace('<title>Scorsaire</title>', () => `<title>${escapeHtml(title)}</title>`) : page;
}

export function readerOnlyHtml(template) {
  if (!template) throw new Error('Reader template unavailable');
  return template.replace('<!--WORK-->', '');
}

/** The template embedded in the editor's build (null under Node). */
export const embeddedReaderTemplate = () => (typeof __READER_PAGE__ !== 'undefined' ? __READER_PAGE__ : null);
