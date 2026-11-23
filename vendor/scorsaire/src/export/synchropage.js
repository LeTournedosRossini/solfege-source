/*
 * The SYNCHRO reader as a file. PURE (the template is passed in; the editor's build embeds it as `__SYNCHRO_PAGE__`, see tools/build.js).
 *   synchroPageHtml(template, archiveBytes, { title }) -> a COMPLETE page: the reader with a `.scorsaire` of screen 4 inside it (base64, one file).
 * Meant for a song synchronised with a YouTube VIDEO (the file holds no media: it stays small). The page still has to be SERVED over http(s): YouTube refuses to show
 * its player in a file opened from the disk.
 */
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export function synchroPageHtml(template, archiveBytes, { title = '' } = {}) {
  if (!template || !template.includes('<!--FILE-->')) throw new Error('Synchro reader template unavailable');
  const page = template.replace('<!--FILE-->', () => `<script type="application/octet-stream" id="scorsaire-file">${toBase64(archiveBytes)}</script>`);
  return title ? page.replace('<title>Scorsaire — synchro</title>', () => `<title>${escapeHtml(title)}</title>`) : page;
}

/** The template embedded in the editor's build (null under Node). */
export const embeddedSynchroTemplate = () => (typeof __SYNCHRO_PAGE__ !== 'undefined' ? __SYNCHRO_PAGE__ : null);
