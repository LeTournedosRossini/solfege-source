/*
 * The VIEWER of the YouTube editor (screen 5): the real reader (ytreader/view.js) mounted in the editor with the live data of the session, in two tabs:
 *   Video only   what a visitor sees when the page holds only the video (with the fragments placed on it); a button puts it in the browser's real full screen;
 *   Page         the video small, the fragments placed under it, the banner and the timeline.
 * The view follows the width of its column (the editor lets the person resize it): only the scale changes, the video is not reloaded.
 * and a simulator of the device (computer, tablet, phone): the view is laid out at the true size of the device and the whole is scaled down to fit.
 * Changing tab (or device) puts a NEW view in place — the iframe of YouTube cannot be moved — and the video comes back at the same time, paused. The boxes on the video are
 * edited here (shield + handles, `overlay-editor.js`). Nothing here writes the session: it asks the callbacks.
 */
import { mountYoutubeView, cleanData } from '../ytreader/view.js';
import { mountOverlayEditor } from './overlay-editor.js';
import { normalizeReader } from '../reader/options.js';
import { createUnderlineTabs } from './yt-tabs.js';

export const DEVICES = Object.freeze({
  pc: { w: 1280, h: 720, fw: 1280, fh: 720 },
  tablet: { w: 1024, h: 768, fw: 1024, fh: 768 },
  phone: { w: 390, h: 844, fw: 844, fh: 390 }, // the phone is upright in a page, sideways in full screen
});
const KEY = 'scorsaire.ytViewer';

function el(tag, css = '', attrs = {}) { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }

/** The data a view is given from the session, and the options that depend on the tab. */
export function viewData(work, ss, tab) {
  const reader = { ...normalizeReader(ss.session.reader, 'youtube'), videoOnly: tab !== 'page' };
  return cleanData(work, { placements: ss.placements, display: ss.session.display, reader, notes: ss.session.notes, styles: ss.session.styles, videoId: ss.session.videoId }, 'youtube');
}

/** The part of the options that decides how a view is BUILT (a change makes a new view) and the part that only changes what is drawn (`setData`). */
export const structureSig = (ss, tab) => { const r = normalizeReader(ss.session.reader, 'youtube'); return JSON.stringify([tab, r.fullscreen, r.autoHide, r.fsBanner, r.layout, r.zoom, r.zoomBanner]); };
export const contentSig = (ss) => JSON.stringify([ss.placements, ss.session.notes, ss.session.display, ss.session.styles]);

/**
 * @param o.getWork()  the work now ; o.ss the session of mode B ({ player, placements, session, selectedId }) ; o.label the translator
 * @param o.setPlacements(list) / o.onSelect(p) : what the panel does for the same gestures
 * @param o.onLoaded() : the video is ready (first time)
 */
export function mountYoutubeViewer(host, { getWork, ss, label, setPlacements, onSelect, items = null, onLoaded = () => {}, onError = () => {}, onFit = () => {}, maxHeight = 460 }) {
  let MAX_H = maxHeight; // px: the tallest the viewer gets (the page tab scrolls inside)
  let prefs = { tab: 'video', device: 'pc' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { /* storage unavailable */ }
  if (!['video', 'page'].includes(prefs.tab)) prefs.tab = 'video';
  if (!DEVICES[prefs.device]) prefs.device = 'pc';
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ } };

  const root = el('div', 'border:1px solid var(--line,#d8d3c8);border-radius:10px;background:var(--module,#fcfbf8);padding:6px;margin-bottom:8px', { 'data-yt-viewer': '' });
  const bar = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px);margin-bottom:6px');
  const tabsUi = createUnderlineTabs([['video', 'ytEditor.tabVideo'], ['page', 'ytEditor.tabPage']].map(([id, key]) => ({ id, text: label(key), title: label(`${key}Hint`), attrs: { 'data-yt-tab': id } })),
    { selected: prefs.tab, onPick: (id) => { if (prefs.tab !== id) { prefs.tab = id; save(); remount(); } } });
  const devUi = createUnderlineTabs([['pc', 'ytEditor.devicePc'], ['tablet', 'ytEditor.deviceTablet'], ['phone', 'ytEditor.devicePhone']].map(([id, key]) => ({ id, text: label(key), title: label('ytEditor.deviceHint'), attrs: { 'data-yt-device': id } })),
    { kind: 'toggle', selected: prefs.device, onPick: (id) => { if (prefs.device !== id) { prefs.device = id; save(); remount(); } }, css: 'margin-left:12px' });
  const tabs = tabsUi.el; const devices = devUi.el;
  const mkBtn = (text, title, extra = '') => { const b = el('button', `min-height:30px;padding:0 10px;${extra}`, { type: 'button', title, 'aria-label': title }); b.textContent = text; return b; };
  const realFull = mkBtn(label('ytEditor.realFull'), label('ytEditor.realFullHint'), 'margin-left:auto'); realFull.setAttribute('data-yt-realfull', '');
  realFull.addEventListener('click', () => { view?.shell?.requestFullscreen?.().catch(() => {}); });
  bar.append(tabs, devices, realFull);
  const area = el('div', 'width:100%;display:flex;justify-content:center;overflow:hidden;position:relative;background:var(--score,#fff);border-radius:8px;min-height:120px', { 'data-yt-area': '' });
  const msg = el('div', 'font:13px var(--ui-font,sans-serif);color:var(--danger-ink,#a33);min-height:1.2em;margin-top:4px', { 'data-yt-message': '' });
  root.append(bar, area, msg); host.append(root);

  let fitDevice = () => {}; let view = null; let overlayEd = null; let current = { sig: '', content: '' }; let token = 0; let destroyed = false; let loadedOnce = false;
  const paintTabs = () => { tabsUi.set(prefs.tab); devUi.set(prefs.device); };

  function unmount() {
    overlayEd?.destroy(); overlayEd = null;
    if (view) { const v = view; view = null; v.destroy(); }
    area.replaceChildren();
  }
  async function remount() {
    if (destroyed) return;
    const my = ++token; const work = getWork(); const dev = DEVICES[prefs.device];
    const pos = view ? ss.player.state().position : (ss.player.state().position || 0);
    unmount(); paintTabs(); msg.textContent = '';
    const tab = prefs.tab; const upright = tab === 'page';
    const W = dev.w; const H = dev.h;
    const outer = el('div', 'position:relative;flex:none;overflow:hidden;border-radius:6px;box-shadow:0 0 0 1px rgba(0,0,0,.2)');
    const device = el('div', `position:absolute;left:0;top:0;transform-origin:0 0;overflow:${upright ? 'auto' : 'hidden'};background:${upright ? '#faf8f4' : '#000'}`, { 'data-yt-device-screen': '' });
    outer.append(device); area.append(outer);
    fitDevice = () => { // the device is laid out at its true size and scaled down to the width of the column
      const availW = Math.max(200, area.clientWidth || root.clientWidth || 600);
      const scale = Math.min(1, availW / W, tab === 'page' ? 1 : MAX_H / H);
      const visibleH = tab === 'page' ? Math.min(H, MAX_H / scale) : H; // the page tab scrolls inside the device
      outer.style.width = `${Math.round(W * scale)}px`; outer.style.height = `${Math.round(visibleH * scale)}px`;
      device.style.width = `${W}px`; device.style.height = `${visibleH}px`; device.style.transform = `scale(${scale})`;
      onFit(Math.round(W * scale));
    };
    fitDevice();
    try {
      const v = await mountYoutubeView(device, {
        work, data: viewData(work, ss, tab), player: ss.player,         embedded: { viewportWidth: () => W, onUpdate: () => overlayEd?.placeHandles(), pinnedItem: () => items?.selected?.() ?? null },
      });
      if (my !== token || destroyed) { v.destroy(); return; }
      view = v; v.layer.style.pointerEvents = 'auto'; v.layer.style.touchAction = 'none'; // a shield over the video: the pointer never reaches the iframe
      overlayEd = mountOverlayEditor({ frame: v.frame, layer: v.layer, label, getPlacements: () => ss.placements, setPlacements, selected: () => ss.selectedId, onSelect, refresh: () => api.changed(), items });
      current = { sig: structureSig(ss, tab), content: contentSig(ss) };
      if (pos > 0.05) ss.player.seek(pos); // the video comes back where it was (paused)
      v.redraw();
      if (!loadedOnce) { loadedOnce = true; onLoaded(); }
    } catch (e) {
      if (my !== token) return;
      // YouTube answers « error 153 / player configuration » to a page that is not served over http(s) (a file opened from the disk or from the file manager of a tablet): say so in plain words
      const embed = /YouTube error (153|150|101)/.test(String(e?.message ?? '')) || !/^https?:$/.test(location.protocol);
      msg.textContent = embed ? label('youtube.needsHttp') : `${label('youtube.error')} ${e?.message ?? ''}`;
      onError(e);
    }
  }

  let fitTimer = 0; const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { fitDevice(); view?.redraw(); overlayEd?.placeHandles(); }, 60); }) : null; ro?.observe(area);
  const api = {
    /** The session changed: a change of structure makes a new view, a change of content only redraws. */
    changed() {
      if (destroyed || !view) return;
      const sig = structureSig(ss, prefs.tab);
      if (sig !== current.sig) { remount(); return; }
      const content = contentSig(ss);
      if (content !== current.content) { current.content = content; view.setData(viewData(getWork(), ss, prefs.tab)); }
      overlayEd?.placeHandles();
    },
    /** The music of a movement changed: what is on show is drawn again. */
    redraw() { view?.redraw(); overlayEd?.placeHandles(); },
    destroy() { destroyed = true; ro?.disconnect(); clearTimeout(fitTimer); unmount(); root.remove(); },
    start: remount,
    /** The person changed the height of the preview. */
    setMaxHeight(px) { MAX_H = px; fitDevice(); view?.redraw(); overlayEd?.placeHandles(); },
  };
  return api;
}
