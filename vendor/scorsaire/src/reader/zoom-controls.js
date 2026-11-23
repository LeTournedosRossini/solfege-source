/*
 * The A− / A+ buttons of the readers that show a score beside a recording. They change the size of everything written in the fragments (the staves, and the texts and
 * pictures of the band); the size is a setting of the DEVICE (kept in the browser, never in the file). The author may lock them (`reader.zoom === false`), and with the
 * 'fit' layout the music is already as big as the screen allows, so the buttons only make it smaller.
 */
import { loadZoom, saveZoom, stepZoom } from './options.js';

/**
 * @param o.reader    the options of the file (see options.js, already normalised)
 * @param o.onChange  called with the new zoom after a press
 * @param o.label(key) the translator
 * @returns { el: the group of buttons or null when locked, zoom(): the zoom in force }
 */
export function createZoomControls({ reader, onChange, label }) {
  let zoom = reader.zoom ? loadZoom() : 1;
  if (!reader.zoom) return { el: null, zoom: () => 1 };
  const cap = () => (reader.layout === 'fit' ? 1 : Infinity);
  zoom = Math.min(zoom, cap());
  const el = document.createElement('span'); el.setAttribute('data-reader-zoom', ''); el.style.cssText = 'display:inline-flex;gap:2px';
  const mk = (text, key) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = label(key); b.setAttribute('aria-label', label(key)); b.style.cssText = 'min-width:40px;min-height:40px;padding:0 10px;font-weight:var(--w-bold,700)'; return b; };
  const down = mk('A−', 'reader.smaller'); const up = mk('A+', 'reader.bigger');
  const sync = () => { down.disabled = stepZoom(zoom, -1) === zoom; up.disabled = stepZoom(zoom, 1, cap()) === zoom; };
  const set = (next) => { if (next === zoom) return; zoom = next; saveZoom(zoom); sync(); onChange(zoom); };
  down.addEventListener('click', () => set(stepZoom(zoom, -1)));
  up.addEventListener('click', () => set(stepZoom(zoom, 1, cap())));
  el.append(down, up); sync();
  return { el, zoom: () => zoom };
}
