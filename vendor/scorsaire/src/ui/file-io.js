// File handling for score documents: file names, reading and writing text files.
// The pure parts are testable under Node; the DOM parts only run in a browser gesture.
import { FILE_FORMAT, serializeWork, loadWork, ScoreFileError } from '../model/index.js';

export const FILE_EXTENSION = '.scorsaire';
/** Extensions accepted by the open dialog (`.json` too: some tablets grey out unknown extensions). */
export const OPEN_ACCEPT = `${FILE_EXTENSION},.json,application/json,.musicxml,.xml,.mxl,.gp3,.gp4,.gp5,.gpx,.gp,.html,.htm,.txt,.zip,.mid,.midi,.kar,.rmi`;
/** Extensions of the MusicXML files the open command imports. */
export const MUSICXML_EXTENSIONS = ['.musicxml', '.xml', '.mxl'];

/** True when a picked file is MusicXML (by extension, by ZIP signature, or by an XML prolog) and not a .scorsaire / JSON file. */
export function isMusicXmlFile(name, bytes) {
  if (MUSICXML_EXTENSIONS.some((e) => String(name).toLowerCase().endsWith(e))) return true;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return true; // ZIP (.mxl)
  let i = 0;
  while (i < bytes.length && (bytes[i] <= 32 || bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf)) i += 1;
  return bytes[i] === 0x3c; // '<'
}

/** Strips characters that file systems reject, collapses blanks; falls back to a neutral name. */
export function sanitizeFileStem(text, fallback = 'score') {
  const clean = String(text ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return clean.slice(0, 80).trim() || fallback;
}

/** Suggested file name: the work title (or the name of the file it was opened from), plus the extension. */
export function suggestFileName(work, openedName = null) {
  const title = work?.props?.title;
  const stem = (typeof title === 'string' && title.trim()) ? title : (openedName ? openedName.replace(/\.(scorsaire|json|musicxml|xml|mxl)$/i, '') : '');
  return sanitizeFileStem(stem) + FILE_EXTENSION;
}

/** Serializes a work to the text of a file. */
export function workToFileText(work) { return serializeWork(work); }

/** Parses the text of a file into a work. Never throws anything but `ScoreFileError`. */
export function workFromFileText(text) {
  try {
    return loadWork(text);
  } catch (e) {
    if (e instanceof ScoreFileError) throw e;
    throw new ScoreFileError(`Fichier illisible : ${e?.message ?? e}`);
  }
}

export { FILE_FORMAT, ScoreFileError };

/** Starts a download of a text file (browser only). */
export function downloadText(name, text, doc = document) {
  downloadBlob(name, new Blob([text], { type: 'application/json' }), doc);
}

/** Starts a download of any blob (browser only). */
export function downloadBlob(name, blob, doc = document) {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

/** Opens the system file picker; resolves `{ name, text }`, or null if the user cancelled. Call inside a user gesture. */
export function pickTextFile(doc = document) {
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file'; input.accept = OPEN_ACCEPT; input.style.display = 'none';
    doc.body.appendChild(input);
    const done = (v) => { input.remove(); resolve(v); };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      try { done({ name: file.name, text: await file.text() }); } catch (e) { input.remove(); reject(e); }
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Opens the system file picker; resolves `{ name, bytes }` (the raw bytes), or null if the user cancelled. Call inside a user gesture. */
export function pickFile(doc = document) {
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file'; input.accept = OPEN_ACCEPT; input.style.display = 'none';
    doc.body.appendChild(input);
    const done = (v) => { input.remove(); resolve(v); };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      try { done({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }); } catch (e) { input.remove(); reject(e); }
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Like `pickFile` for SEVERAL files at once: resolves [{ name, bytes }] (empty when the user cancelled). `accept` = the extensions offered. */
export function pickFiles({ accept = OPEN_ACCEPT, multiple = true } = {}, doc = document) {
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple; input.style.display = 'none';
    doc.body.appendChild(input);
    const done = (v) => { input.remove(); resolve(v); };
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      try { done(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))); } catch (e) { input.remove(); reject(e); }
    });
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

/** Opens the system picker for a picture; resolves `{ name, bytes }` or null. Call inside a user gesture. */
export function pickImageFile(doc = document) {
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg'; input.style.display = 'none';
    doc.body.appendChild(input);
    const done = (v) => { input.remove(); resolve(v); };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      try { done({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }); } catch (e) { input.remove(); reject(e); }
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}
