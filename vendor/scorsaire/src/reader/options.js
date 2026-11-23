/*
 * The options the AUTHOR offers to the readers that show a score next to a recording (synchro reader, YouTube reader), kept in `sync.json` as `reader`:
 *   zoom    true (default) = the reader may grow / shrink what is written (A− / A+); false = locked
 *   zoomBanner  false (default) = A− / A+ leave the cards and annotations of the banner alone; true = they grow too
 *   fullscreen  false (default) = no full screen button; true = the reader offers one (made for fragments placed ON the video)
 *   videoOnly  false (default) = the page shows the video and what goes with it; true = ONLY the video (with the fragments placed on it), filling the window
 *   autoHide  false (default) = the controls of the full screen stay; true = they hide after a few seconds and come back with a touch at the bottom of the video
 *   fsBanner  'off' (default) | 'above' | 'below': the banner (cards and annotations) in the controls of the full screen, above or below the timeline
 *   layout  how the fragment uses the width of the screen:
 *             'wrap'    (default) systems of the width of the screen, a bigger size makes more lines
 *             'scroll'  one long system that leaves the screen sideways; the page turns while it plays
 *             'fit'     one system always as wide as the screen (a bigger size is not possible, a smaller one is)
 * The zoom chosen by the person is a setting of the DEVICE (never written in a file). PURE except for the two storage helpers (guarded).
 */
export const READER_LAYOUTS = Object.freeze(['wrap', 'scroll', 'fit']);
export const ZOOM_STEPS = Object.freeze([0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]);
export const FS_BANNER = Object.freeze(['off', 'above', 'below']);
export const DEFAULT_READER = Object.freeze({ zoom: true, zoomBanner: false, fullscreen: false, videoOnly: false, autoHide: false, fsBanner: 'off', layout: 'wrap' });
/** What a reader shows when the file says nothing: the YouTube reader is made to show only the video, its fragments on one line the width of the screen. */
export const DEFAULTS_BY_KIND = Object.freeze({ audio: DEFAULT_READER, youtube: Object.freeze({ ...DEFAULT_READER, videoOnly: true, layout: 'fit' }) });

/** The options of a file, with the defaults of its kind ('audio' | 'youtube') for what it does not say. */
export function normalizeReader(x, kind = 'audio') {
  const o = x && typeof x === 'object' ? x : {}; const d = DEFAULTS_BY_KIND[kind] ?? DEFAULT_READER;
  return {
    zoom: o.zoom !== false, zoomBanner: o.zoomBanner === true, fullscreen: o.fullscreen === true, videoOnly: typeof o.videoOnly === 'boolean' ? o.videoOnly : d.videoOnly,
    autoHide: o.autoHide === true, fsBanner: FS_BANNER.includes(o.fsBanner) ? o.fsBanner : 'off', layout: READER_LAYOUTS.includes(o.layout) ? o.layout : d.layout,
  };
}

/** What to write in a file: only what differs from the defaults of its kind (null when nothing does). */
export function readerToFile(x, kind = 'audio') {
  const o = normalizeReader(x, kind); const d = DEFAULTS_BY_KIND[kind] ?? DEFAULT_READER; const out = {};
  if (!o.zoom) out.zoom = false;
  if (o.zoomBanner) out.zoomBanner = true;
  if (o.fullscreen) out.fullscreen = true;
  if (o.videoOnly !== d.videoOnly) out.videoOnly = o.videoOnly;
  if (o.autoHide) out.autoHide = true;
  if (o.fsBanner !== 'off') out.fsBanner = o.fsBanner;
  if (o.layout !== d.layout) out.layout = o.layout;
  return Object.keys(out).length ? out : null;
}

/** The step next to `zoom` (dir = +1 or −1), staying inside the list; `max` caps it (the 'fit' layout cannot grow). */
export function stepZoom(zoom, dir, max = ZOOM_STEPS[ZOOM_STEPS.length - 1]) {
  const cur = ZOOM_STEPS.reduce((best, s, i) => (Math.abs(s - zoom) < Math.abs(ZOOM_STEPS[best] - zoom) ? i : best), 0);
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, cur + dir))];
  return Math.min(next, max);
}

const KEY = 'scorsaire-reader-zoom';
export function loadZoom() {
  try { const v = Number(localStorage.getItem(KEY)); return v >= ZOOM_STEPS[0] && v <= ZOOM_STEPS[ZOOM_STEPS.length - 1] ? v : 1; } catch { return 1; }
}
export function saveZoom(v) { try { localStorage.setItem(KEY, String(v)); } catch { /* storage unavailable: the zoom is not kept */ } }
