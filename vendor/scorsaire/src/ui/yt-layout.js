/*
 * The LAYOUT of the YouTube editor (screen 5) on a computer: two columns.
 *   left   the preview of the video, then the editing canvas; the timeline is a fixed full-width band at the bottom of the window of the fragment (the screen-1 work row, moved here);
 *   right  three tabs: Fragments (the cards), Fragment editor (everything about the chosen fragment) and Settings (what is common to the whole file).
 * Two handles: a vertical one between the columns (width of the left column, 50 % to start) and a horizontal one under the preview (its height).
 * Below `MIN_WIDTH` the columns stack. Nothing here knows the model: it only places elements given by the caller.
 */
import { createUnderlineTabs } from './yt-tabs.js';
const KEY_SPLIT = 'scorsaire.ytSplit';
const KEY_VIDEO_H = 'scorsaire.ytVideoH';
const MIN_WIDTH = 1000;

const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const stored = (key, def, lo, hi) => { try { const n = Number(localStorage.getItem(key)); return n ? Math.min(hi, Math.max(lo, n)) : def; } catch { return def; } };
const save = (key, v) => { try { localStorage.setItem(key, String(Math.round(v))); } catch { /* storage unavailable */ } };

/**
 * @param host      the element that gets the two columns (emptied by the caller when it is done)
 * @param o.workRow the element of the screen-1 work row (score canvas), moved under the timeline
 * @param o.onVideoHeight(px)  the person changed the height of the preview
 * @returns { viewerHost, timelineHost, tabs: { fragments, settings }, setTimelineWidth(px), adoptWorkRow(), destroy() }
 */
export function mountYtLayout(host, { workRow, label, onVideoHeight = () => {} }) {
  let pct = stored(KEY_SPLIT, 50, 20, 80); let videoH = stored(KEY_VIDEO_H, 460, 160, 900);
  const wide = window.matchMedia(`(min-width: ${MIN_WIDTH}px), (pointer: fine)`); // a computer always gets the two columns
  const left = el('div', 'min-width:0'); const right = el('div', 'min-width:0;display:flex;flex-direction:column;gap:6px');
  const viewerHost = el('div'); const timelineHost = el('div', 'position:fixed;left:0;right:0;bottom:var(--dock-h,0px);z-index:50;box-sizing:border-box;padding:4px 12px 6px;background:var(--paper,#faf8f4);border-top:1px solid var(--line,#d8d3c8);box-shadow:0 -2px 8px rgba(0,0,0,.08)', { 'data-yt-timeline-band': '' }); const editHost = el('div', 'margin-top:8px');
  const vbar = el('div', 'height:8px;margin:2px 0 4px;cursor:row-resize;border-radius:4px;background:var(--line,#d8d3c8);touch-action:none', { 'data-yt-vsplit': '', title: label('ytEditor.heightHint') });
  const bar = el('div', 'flex:none;align-self:stretch;min-height:240px;width:10px;margin:0 2px;cursor:col-resize;border-radius:5px;background:linear-gradient(var(--line,#d8d3c8),var(--line,#d8d3c8)) center/2px 100% no-repeat;touch-action:none;transition:background-color .12s', { 'data-yt-split': '', title: label('ytEditor.splitHint') });
  bar.addEventListener('pointerenter', () => { bar.style.backgroundColor = 'rgba(43,108,255,.18)'; }); bar.addEventListener('pointerleave', () => { bar.style.backgroundColor = ''; });
  left.append(viewerHost, vbar, editHost);
  document.body.append(timelineHost); // a fixed band, full width, always visible at the bottom
  const spacer = el('div'); left.append(spacer);
  const fitSpacer = () => { spacer.style.height = `calc(${timelineHost.offsetHeight + 8}px + var(--yt-entry-h, 0px))`; };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fitSpacer) : null; ro?.observe(timelineHost); fitSpacer();

  // the right column: three tabs (Fragments, Fragment editor, Settings), the look of the screen-1 sidebar tabs
  const bodies = { fragments: el('div', 'display:flex;flex-direction:column;gap:6px'), editor: el('div', 'display:flex;flex-direction:column;gap:6px'), settings: el('div') };
  let tab = 'fragments';
  const tabs = createUnderlineTabs(
    [['fragments', 'ytEditor.tabFragments'], ['editor', 'ytEditor.tabEditor'], ['settings', 'ytEditor.tabSettings']].map(([id, key]) => ({ id, text: label(key), attrs: { 'data-yt-tab-right': id } })),
    { selected: tab, onPick: (id) => show(id), css: 'border-bottom:1px solid var(--line,#d8d3c8)' },
  );
  const show = (id) => { tab = id; tabs.set(id); for (const [k, body] of Object.entries(bodies)) body.style.display = k === id ? '' : 'none'; };
  right.append(tabs.el, bodies.fragments, bodies.editor, bodies.settings); show(tab);
  host.append(left, bar, right);

  const home = { parent: workRow.parentElement, next: workRow.nextElementSibling };
  const apply = () => {
    const row = wide.matches;
    host.style.cssText = row ? 'display:flex;align-items:flex-start;gap:0' : '';
    left.style.cssText = row ? `flex:none;width:calc(${pct}% - 8px);min-width:0` : 'min-width:0';
    right.style.cssText = row ? 'flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:6px;position:sticky;top:0;max-height:100vh;overflow:auto' : 'min-width:0;display:flex;flex-direction:column;gap:6px;margin-top:8px';
    bar.style.display = row ? '' : 'none';
  };
  wide.addEventListener('change', apply); apply();
  const drag = (handle, onMove, onEnd) => {
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId); e.preventDefault();
      const move = (ev) => onMove(ev);
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); onEnd(); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
  };
  drag(bar, (ev) => { const box = host.getBoundingClientRect(); pct = Math.min(80, Math.max(20, ((ev.clientX - box.left) / box.width) * 100)); apply(); }, () => save(KEY_SPLIT, pct));
  bar.addEventListener('dblclick', () => { pct = 50; apply(); save(KEY_SPLIT, pct); });
  let top = 0;
  vbar.addEventListener('pointerdown', () => { top = viewerHost.getBoundingClientRect().top; });
  drag(vbar, (ev) => { videoH = Math.min(900, Math.max(160, ev.clientY - top)); onVideoHeight(videoH); }, () => save(KEY_VIDEO_H, videoH));
  vbar.addEventListener('dblclick', () => { videoH = 460; onVideoHeight(videoH); save(KEY_VIDEO_H, videoH); });

  return {
    viewerHost, timelineHost, tabs: bodies, show, current: () => tab, videoHeight: () => videoH,
    /** The timeline is as wide as the preview of the video. */
    /** The two columns are laid out again (the host may have lost its style when it was hidden and shown). */
    refresh: apply,
    setTimelineWidth() { /* the timeline is a full-width band now */ },
    /** The score canvas of screen 1 lives under the timeline while this screen is shown. */
    adoptWorkRow() { if (workRow.parentElement !== editHost) { editHost.append(workRow); queueMicrotask(() => window.dispatchEvent(new Event('resize'))); } },
    restoreWorkRow() { if (workRow.parentElement !== home.parent) { home.parent.insertBefore(workRow, home.next); queueMicrotask(() => window.dispatchEvent(new Event('resize'))); } },
    destroy() { wide.removeEventListener('change', apply); ro?.disconnect(); timelineHost.remove(); spacer.remove(); },
  };
}
