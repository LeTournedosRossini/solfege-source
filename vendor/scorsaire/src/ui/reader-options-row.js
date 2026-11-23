/*
 * The two choices the author makes for the readers (synchro, YouTube) in screens 4: may the reader change the size (A− / A+), and how the fragment uses the width of the screen
 * (lines / one long system that scrolls / one system as wide as the screen). They live in `session.reader` and are written in the file by `main.js` (see reader/options.js).
 */
import { normalizeReader, READER_LAYOUTS, FS_BANNER } from '../reader/options.js';
import { applyIconName } from './icons.js';

export function createReaderOptionsRow({ session, label, onChange = () => {}, kind = 'audio' }) {
  const row = document.createElement('span'); row.setAttribute('data-reader-options', ''); row.style.cssText = 'display:inline-flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)';
  const mk = (title) => { const b = document.createElement('button'); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.style.cssText = 'min-height:30px;padding:0 8px'; return b; };
  const zoomBtn = mk(label('reader.optZoomHint')); zoomBtn.setAttribute('data-reader-opt-zoom', '');
  const bannerBtn = mk(label('reader.optBannerHint')); bannerBtn.setAttribute('data-reader-opt-banner', '');
  const fullBtn = mk(label('reader.optFullHint')); fullBtn.setAttribute('data-reader-opt-full', ''); fullBtn.style.cssText += ';min-width:30px;display:inline-flex;align-items:center;justify-content:center'; applyIconName(fullBtn, 'maximize-2'); // just a frame: full screen offered or not
  const hideBtn = mk(label('reader.optHideHint')); hideBtn.setAttribute('data-reader-opt-hide', '');
  const bannerFsBtn = mk(label('reader.optFsBannerHint')); bannerFsBtn.setAttribute('data-reader-opt-fsbanner', '');
  const onlyBtn = mk(label('reader.optOnlyHint')); onlyBtn.setAttribute('data-reader-opt-only', '');
  const layoutBtn = mk(label('reader.optLayoutHint')); layoutBtn.setAttribute('data-reader-opt-layout', '');
  const cur = () => (session.reader = normalizeReader(session.reader, kind));
  const refresh = () => {
    const o = cur();
    zoomBtn.textContent = o.zoom ? label('reader.optZoomOn') : label('reader.optZoomOff'); zoomBtn.setAttribute('aria-pressed', String(o.zoom)); zoomBtn.style.background = o.zoom ? 'var(--btn-on,#e2e0da)' : '';
    bannerBtn.textContent = o.zoomBanner ? label('reader.optBannerOn') : label('reader.optBannerOff'); bannerBtn.setAttribute('aria-pressed', String(o.zoomBanner)); bannerBtn.style.background = o.zoomBanner ? 'var(--btn-on,#e2e0da)' : '';
    fullBtn.title = o.fullscreen ? label('reader.optFullOn') : label('reader.optFullOff'); fullBtn.setAttribute('aria-pressed', String(o.fullscreen)); fullBtn.style.background = o.fullscreen ? 'var(--btn-on,#e2e0da)' : '';
    hideBtn.textContent = o.autoHide ? label('reader.optHideOn') : label('reader.optHideOff'); hideBtn.setAttribute('aria-pressed', String(o.autoHide)); hideBtn.style.background = o.autoHide ? 'var(--btn-on,#e2e0da)' : '';
    bannerFsBtn.textContent = label(`reader.optFsBanner.${o.fsBanner}`); bannerFsBtn.setAttribute('aria-pressed', String(o.fsBanner !== 'off')); bannerFsBtn.style.background = o.fsBanner !== 'off' ? 'var(--btn-on,#e2e0da)' : '';
    onlyBtn.textContent = o.videoOnly ? label('reader.optOnlyOn') : label('reader.optOnlyOff'); onlyBtn.setAttribute('aria-pressed', String(o.videoOnly)); onlyBtn.style.background = o.videoOnly ? 'var(--btn-on,#e2e0da)' : '';
    layoutBtn.textContent = label(`reader.layout.${o.layout}`);
  };
  zoomBtn.addEventListener('click', () => { session.reader = { ...cur(), zoom: !cur().zoom }; refresh(); onChange(); });
  bannerBtn.addEventListener('click', () => { session.reader = { ...cur(), zoomBanner: !cur().zoomBanner }; refresh(); onChange(); });
  fullBtn.addEventListener('click', () => { session.reader = { ...cur(), fullscreen: !cur().fullscreen }; refresh(); onChange(); });
  onlyBtn.addEventListener('click', () => { session.reader = { ...cur(), videoOnly: !cur().videoOnly }; refresh(); onChange(); });
  hideBtn.addEventListener('click', () => { session.reader = { ...cur(), autoHide: !cur().autoHide }; refresh(); onChange(); });
  bannerFsBtn.addEventListener('click', () => { session.reader = { ...cur(), fsBanner: FS_BANNER[(FS_BANNER.indexOf(cur().fsBanner) + 1) % FS_BANNER.length] }; refresh(); onChange(); });
  layoutBtn.addEventListener('click', () => { const i = READER_LAYOUTS.indexOf(cur().layout); session.reader = { ...cur(), layout: READER_LAYOUTS[(i + 1) % READER_LAYOUTS.length] }; refresh(); onChange(); });
  row.append(...(kind === 'youtube' ? [zoomBtn, bannerBtn, fullBtn, hideBtn, bannerFsBtn, onlyBtn] : [zoomBtn, layoutBtn])); refresh(); // the YouTube editor sets the width mode PER FRAGMENT; the synchro reader only has the size and the width mode (cards, full screen, hidden controls and video-only are the YouTube reader's)
  return { el: row, refresh };
}
