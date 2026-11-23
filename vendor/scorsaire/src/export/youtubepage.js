/*
 * The YouTube reader as a file. PURE (the template is passed in; the editor's build embeds it as `__YOUTUBE_PAGE__`, see tools/build.js).
 *   youtubePageHtml(template, archiveBytes, { title }) -> a COMPLETE page: the reader with the `.scorsaire` of mode B inside it (base64, one file).
 * The page still has to be SERVED over http(s): YouTube refuses to show its player in a file opened from the disk.
 */
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export function youtubePageHtml(template, archiveBytes, { title = '' } = {}) {
  if (!template || !template.includes('<!--FILE-->')) throw new Error('YouTube reader template unavailable');
  const page = template.replace('<!--FILE-->', () => `<script type="application/octet-stream" id="scorsaire-file">${toBase64(archiveBytes)}</script>`);
  return title ? page.replace('<title>Scorsaire — YouTube</title>', () => `<title>${escapeHtml(title)}</title>`) : page;
}

/** The template embedded in the editor's build (null under Node). */
export const embeddedYoutubeTemplate = () => (typeof __YOUTUBE_PAGE__ !== 'undefined' ? __YOUTUBE_PAGE__ : null);
