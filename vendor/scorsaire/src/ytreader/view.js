/*
 * The VIEW of a YouTube file (shared by the reader and by the editor of screen 5): the video with the fragments of score placed on it or under it, the banner, the timeline and
 * the controls of the full screen. Nothing here writes a document.
 */
import { createYouTubePlayer } from '../audio/youtubeplayer.js';
import { normalizeDisplay, sortPlacements, placementProblems, isOver, laneOf, viewOf, placementCardText } from '../audio/placements.js';
import { sanitizeItems, sanitizeStyles, onVideo } from '../audio/banner.js';
import { cardNumbers } from '../model/cardnumbers.js';
import { PID } from '../model/pid.js';
import { normalizeReader } from '../reader/options.js';
import { createZoomControls } from '../reader/zoom-controls.js';
import { createStage, createBannerView, createItemsOverlay, overlayOptions } from './stage.js';
import { mountLyricsPanel } from '../reader/lyricspanel.js';
import { createScrubPill } from '../ui/scrub-pill.js';
import { icon } from '../ui/icons.js';
import { createI18n } from '../i18n/index.js';

const lang = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2);
const t = createI18n(['fr', 'en'].includes(lang) ? lang : 'fr');
const COLORS = ['#cfe0f5', '#f5d9d4', '#d8ecd3', '#efe3c2', '#e0d6ef', '#d3ecec'];
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function el(tag, css = '', attrs = {}) {
  const e = document.createElement(tag); if (css) e.style.cssText = css;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** The data of a view, every part checked and defaulted: what a file holds (`info`) or what the editor keeps in its session. */
export function cleanData(work, info, kind = 'youtube') {
  const ids = work.movements.map((m) => m.id);
  const placements = sortPlacements((info.placements ?? []).filter((p) => ids.includes(p.movementId) && p.end > p.start));
  return { videoId: info.youtube?.videoId ?? info.videoId, placements, display: normalizeDisplay(info.display), reader: normalizeReader(info.reader, kind), notes: sanitizeItems(info.notes), styles: sanitizeStyles(info.styles), problems: placementProblems(placements, ids) };
}

/**
 * The view of a YouTube file: the video with its fragments, banner and controls. Used by the reader (static data) and by the editor (live data, `setData`).
 * @param o.data  { videoId, placements, display, reader, notes, styles } — already checked (see `cleanData`); `setData(d)` replaces it and redraws
 * @param o.embedded  null for the reader (the window is the screen); { viewportWidth() } in the editor: the view then fills `host`, reads this width instead of the window's, and
 *                    never covers the page (`position: fixed` becomes `absolute`)
 * @param o.embedded.onUpdate(state)  called at the end of each update (the editor puts its handles on the boxes there)
 * @param o.forceFull  true = behave as in full screen (our controls shown, the frame as large as the host allows): the simulation of the editor
 */
export async function mountYoutubeView(host, { work, data, player = createYouTubePlayer(), embedded = null, forceFull = false, pupils = null }) {
  const vw = () => (embedded?.viewportWidth ? embedded.viewportWidth() : window.innerWidth);
  const only = () => reader.videoOnly || forceFull;
  const ids = work.movements.map((m) => m.id);
  let placements = data.placements; let display = data.display; let reader = data.reader; let items = data.notes; let styles = data.styles;
  const numbers = new Map(cardNumbers(work).map((c) => [c.id, c.number]));
  const titleOf = (id) => { const m = work.movements.find((x) => x.id === id); return `${numbers.get(id) ?? ''} ${m?.props?.[PID.TITLE] ?? ''}`.trim(); };
  const cardOf = (p) => { const m = work.movements.find((x) => x.id === p.movementId); return placementCardText(p, { number: numbers.get(p.movementId) ?? '', title: m?.props?.[PID.TITLE] ?? '' }); }; // the own name / number of a placed fragment, else the fragment's
  const colorOf = (id) => COLORS[Math.max(0, ids.indexOf(id)) % COLORS.length];
  let lanesUsed = [...new Set(placements.map(laneOf))].sort((a, b) => a - b); // the lanes of the timeline that hold something (under the video, then on it)

  const root = el('div'); host.append(root);
  const head = el('div', 'position:sticky;top:0;z-index:5;background:var(--paper,#faf8f4);padding:6px 8px 8px;border-bottom:1px solid #e3ded2', { 'data-yr-head': '' });
  const stageEl = el('div', 'padding:8px 12px', { 'data-yr-stage': '' });
  root.append(head, stageEl);

  // the shell holds the video frame, the layer of the fragments placed ON the video and (in full screen) our own controls; the full screen is the shell's
  const shell = el('div', 'position:relative;width:min(100%,520px);margin:0 auto;background:#111;border-radius:8px;overflow:hidden', { 'data-yr-shell': '' });
  const frame = el('div', 'position:relative;width:100%;aspect-ratio:16/9;background:#111;margin:0 auto', { 'data-yr-video': '' });
  const inner = el('div', 'position:absolute;inset:0'); frame.append(inner);
  const layer = el('div', 'position:absolute;inset:0;pointer-events:none;overflow:hidden', { 'data-yr-layer': '' }); frame.append(layer);
  shell.append(frame);
  const bar = el('div', 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px;margin-top:6px');
  const btn = (text, title) => { const b = el('button', 'min-width:40px;min-height:40px;padding:0 10px', { type: 'button', title, 'aria-label': title }); b.textContent = text; return b; };
  const playBtn = btn('▶', t('sync.play')); playBtn.setAttribute('data-yr-play', '');
  const stopBtn = btn('■', t('sync.stop'));
  const ratePill = createScrubPill({ min: 25, max: 200, value: 100, step: 5, pxPerStep: 3, format: (v) => `${v} %`, title: t('player.speed'), label: { down: t('player.slower'), up: t('player.faster') }, onCommit: (v) => player.setRate(v / 100), onLong: () => player.setRate(1) });
  ratePill.el.setAttribute('data-yr-rate', '');
  const fullBtn = btn('⛶', t('reader.fullscreen')); fullBtn.setAttribute('data-yr-full', '');
  const time = el('span', 'font-variant-numeric:tabular-nums;margin:0 8px;min-width:96px;text-align:center', { 'data-yr-time': '' });
  bar.append(playBtn, stopBtn, ratePill.el, time, fullBtn);
  const zoomer = createZoomControls({ reader, label: (k) => t(k), onChange: () => { stage.redraw(); overStage.redraw(); update(player.state()); } });
  if (zoomer.el) bar.append(zoomer.el);
  // the banner above the timeline: cards (coloured labels) and annotations, placed by hand; a tap on one puts the video at its start
  const banner = el('div', 'margin-top:6px', { 'data-yr-banner': '' });
  // the timeline: the blocks of the placements (two tiers when the bottom row is used; hidden when the author chose so), the playhead; a tap or a drag puts the video there
  const tierH = 22;
  const lineH = () => (display.showBlocks ? lanesUsed.length * tierH + 4 : 14);
  const line = el('div', `position:relative;height:${lineH()}px;margin-top:6px;background:var(--field,#fff);border:1px solid var(--line,#ddd);border-radius:6px;touch-action:none;cursor:pointer;user-select:none;-webkit-user-select:none`, { 'data-yr-line': '' });
  const head0 = el('div', 'position:absolute;top:0;bottom:0;width:2px;background:#e0561b;pointer-events:none;z-index:2'); // the playhead of the video
  head.append(shell, bar, banner, line);
  let builtFor = 0;
  const build = () => {
    const d = Math.max(0.001, player.state().duration); builtFor = d;
    line.style.height = `${lineH()}px`;
    line.replaceChildren(head0);
    if (display.showBlocks) {
      for (const p of placements) {
        const b = el('div', `position:absolute;top:${2 + lanesUsed.indexOf(laneOf(p)) * tierH}px;height:${tierH - 3}px;left:${(p.start / d) * 100}%;width:${((p.end - p.start) / d) * 100}%;background:${colorOf(p.movementId)};border:1px solid #8a857a;border-radius:3px;overflow:hidden;font:11px var(--ui-font,sans-serif);padding:1px 4px;box-sizing:border-box;pointer-events:none;white-space:nowrap`, { 'data-yr-block': p.id });
        b.textContent = `${isOver(p) ? '▭ ' : ''}${cardOf(p)}`; line.append(b);
      }
    }
  };

  // the score (two rows, fades) and the banner come from the shared stage: the preview of the editor uses the same code
  // the words as STROPHES under the music (the usual) instead of a lyrics staff in the fragments; not in the editor's preview (it shows the fragments as written)
  const lyrics = embedded ? null : mountLyricsPanel({ work, lang: (typeof navigator !== 'undefined' && navigator.language?.slice(0, 2) === 'en') ? 'en' : 'fr', t: (k, p) => t(k, p), asked: pupils?.lyrics ?? null, storage: (() => { try { return window.localStorage; } catch { return null; } })(), onChange: () => { stage.redraw(); overStage.redraw(); update(player.state()); } });
  const hiddenTracks = () => (lyrics?.staffHidden() ? lyrics.trackIds() : null);
  if (lyrics) stageEl.after(lyrics.element);
  const stage = createStage({ host: stageEl, work, player, getHiddenTracks: hiddenTracks, getPlacements: () => placements, getDisplay: () => display, width: () => host.clientWidth || vw(), staffSpace: () => (vw() < 700 ? 7 : 9), getView: (p) => ({ mode: viewOf(p), zoom: zoomer.zoom() }), accept: (p) => !isOver(p), follow: true, top: () => head.getBoundingClientRect().bottom, getPupils: () => pupils });
  // the fragments placed ON the video: a stage of its own whose boxes are placed in percent of the video frame (so they grow with it)
  const frameW = () => Math.max(160, frame.clientWidth || 520);
  const overStage = createStage({ host: layer, work, player, getHiddenTracks: hiddenTracks, getPlacements: () => placements, getDisplay: () => display, getPupils: () => pupils, ...overlayOptions(frameW, () => zoomer.zoom(), (p) => viewOf(p)) });
  // the cards and annotations that sit ON the video (a layer of the frame); the others stay in the banner above the timeline
  const itemsHost = el('div', 'position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;z-index:6', { 'data-yr-items': '' }); layer.append(itemsHost);
  const itemsOverlay = createItemsOverlay({ host: itemsHost, player, getItems: () => items, getStyles: () => styles, frameW, pinned: () => embedded?.pinnedItem?.() ?? null });
  const bannerView = createBannerView({ host: banner, player, getItems: () => items.filter((x) => !onVideo(x)), getDuration: () => player.state().duration, getScale: () => (reader.zoomBanner ? zoomer.zoom() : 1), getStyles: () => styles });
  // under-the-video fragments only in the stage below (the same list, the other half)

  const update = (st) => {
    time.textContent = `${fmt(st.position)} / ${fmt(st.duration)}`;
    playBtn.textContent = st.playing ? '⏸' : '▶'; playBtn.setAttribute('aria-pressed', String(st.playing));
    ratePill.setValue(Math.round(st.rate * 100));
    if (st.duration && builtFor !== st.duration) build();
    head0.style.left = `${(st.position / Math.max(0.001, st.duration)) * 100}%`;
    bannerView.update(st);
    stage.update(st); overStage.update(st); itemsOverlay.update(st); fsBannerView?.update(st);
    { const f = st.duration ? Math.max(0, Math.min(1, st.position / st.duration)) : 0; fsFill.style.width = `${f * 100}%`; fsThumb.style.left = `${f * 100}%`; }
    embedded?.onUpdate?.(st);
    setGlyph(fsPlay, st.playing ? 'pause' : 'play'); fsRateName.textContent = t('player.speedShort'); fsRateVal.textContent = `${Math.round(st.rate * 100)} %`; fsTime.textContent = `${fmt(st.position)} / ${fmt(st.duration)}`;
  };

  playBtn.addEventListener('click', () => { if (player.state().playing) player.pause(); else player.play(); });
  stopBtn.addEventListener('click', () => player.stop());
  // our own full screen: the whole reader (video, controls, score) so that nothing is lost; YouTube's own button is off (`fs: 0`), it would show the video alone
  // full screen = the shell (the video and the fragments on it). YouTube's own controls are off then (`controls: 0`): our small bar replaces them, opened by a handle in the corner
  if (!document.fullscreenEnabled || !reader.fullscreen) fullBtn.style.display = 'none'; // only when the author offers it
  const fsBar = el('div', 'position:absolute;left:0;right:0;bottom:0;display:none;flex-direction:column;gap:2px;padding:14px 12px 8px;background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff;z-index:6', { 'data-yr-fsbar': '' });
  const fsRow = el('div', 'display:flex;align-items:center;gap:6px');
  // the timeline of our controls (YouTube's own are off): a tap or a drag puts the video there
  const fsLine = el('div', 'position:relative;height:24px;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none', { 'data-yr-fsline': '' });
  const fsTrack = el('div', 'position:absolute;left:0;right:0;top:10px;height:4px;border-radius:2px;background:rgba(255,255,255,.35)');
  const fsFill = el('div', 'position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:#e8731a;width:0');
  const fsThumb = el('div', 'position:absolute;top:-5px;width:14px;height:14px;margin-left:-7px;border-radius:7px;background:var(--field,#fff);box-shadow:0 0 3px rgba(0,0,0,.6);left:0');
  fsTrack.append(fsFill, fsThumb); fsLine.append(fsTrack);
  let fsScrub = false; let fsLast = 0;
  const fsSeek = (e, force = false) => { const r = fsTrack.getBoundingClientRect(); const d = player.state().duration; if (!d || !r.width) return; const now = performance.now(); if (!force && now - fsLast < 150) return; fsLast = now; player.seek(Math.max(0, Math.min(d, ((e.clientX - r.left) / r.width) * d))); };
  fsLine.addEventListener('pointerdown', (e) => { fsScrub = true; fsLine.setPointerCapture?.(e.pointerId); fsSeek(e, true); });
  fsLine.addEventListener('pointermove', (e) => { if (fsScrub) fsSeek(e); });
  fsLine.addEventListener('pointerup', (e) => { if (fsScrub) { fsScrub = false; fsSeek(e, true); } });
  fsLine.addEventListener('pointercancel', () => { fsScrub = false; });
  // the buttons of our controls: a glyph that fills three quarters of the button, centred
  const fsBtn = (name, title) => { const b = btn('', title); b.style.cssText += ';width:48px;height:48px;padding:0;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.4)'; setGlyph(b, name); return b; };
  const setGlyph = (b, name) => { if (b.dataset.glyph === name) return; b.dataset.glyph = name; const g = icon(name, { size: '75%' }); g.style.strokeWidth = '1.5'; b.replaceChildren(g); };
  const fsPlay = fsBtn('play', t('sync.play')); const fsTime = el('span', 'font:var(--w-semi,600) 14px var(--ui-font,sans-serif);font-variant-numeric:tabular-nums;margin:0 8px;text-shadow:0 1px 2px rgba(0,0,0,.8)'); const fsExit = fsBtn('minimize-2', t('reader.fullscreenExit'));
  fsPlay.addEventListener('click', () => { if (player.state().playing) player.pause(); else player.play(); });
  const fsSlower = fsBtn('minus', t('player.slower')); const fsFaster = fsBtn('plus', t('player.faster'));
  const fsRate = el('span', 'display:inline-flex;flex-direction:column;align-items:center;line-height:1.15;min-width:64px;font-variant-numeric:tabular-nums', { 'data-yr-fsrate': '', title: t('player.speed') });
  const fsRateName = el('span', 'font:12px var(--ui-font,sans-serif);opacity:.85'); const fsRateVal = el('span', 'font:var(--w-bold,700) 16px var(--ui-font,sans-serif)'); fsRate.append(fsRateName, fsRateVal);
  const bump = (d) => player.setRate(Math.round(player.state().rate * 20 + d) / 20);
  fsSlower.addEventListener('click', () => bump(-1)); fsFaster.addEventListener('click', () => bump(1));
  fsExit.addEventListener('click', () => document.exitFullscreen?.());
  fsRow.append(fsPlay, fsTime, el('span', 'flex:1'), fsSlower, fsRate, fsFaster, fsExit);
  // the banner (cards and annotations) inside the controls, above or below the timeline, when the author wants it
  const fsBannerEl = el('div', 'margin:2px 0', { 'data-yr-fsbanner': '' });
  const fsBannerView = reader.fsBanner !== 'off' ? createBannerView({ host: fsBannerEl, player, getItems: () => items.filter((x) => !onVideo(x)), getDuration: () => player.state().duration, getScale: () => (reader.zoomBanner ? zoomer.zoom() : 1), getStyles: () => styles }) : null;
  if (fsBannerView) fsBar.append(...(reader.fsBanner === 'above' ? [fsBannerEl, fsLine, fsRow] : [fsLine, fsBannerEl, fsRow])); else fsBar.append(fsLine, fsRow);
  // the controls may hide by themselves (the author's choice); a touch in the bottom strip of the video brings them back
  const catcher = el('div', 'position:absolute;left:0;right:0;bottom:0;height:24%;display:none;z-index:5;touch-action:manipulation', { 'data-yr-catcher': '' });
  let hideTimer = 0; let inFull = false;
  const hideBar = () => { fsBar.style.display = 'none'; catcher.style.display = 'block'; };
  const showBar = () => { if (!inFull) return; fsBar.style.display = 'flex'; catcher.style.display = 'none'; clearTimeout(hideTimer); if (reader.autoHide) hideTimer = setTimeout(() => { if (!fsScrub) hideBar(); else showBar(); }, 3500); };
  catcher.addEventListener('pointerdown', showBar); catcher.addEventListener('pointermove', showBar);
  for (const ev of ['pointerdown', 'pointermove', 'click']) fsBar.addEventListener(ev, () => { if (reader.autoHide) showBar(); });
  shell.append(fsBar, catcher);
  // the look of the shell: in the page, in full screen, or alone in the window (`videoOnly`)
  const fsFull = fsBtn('maximize-2', t('reader.fullscreen')); fsFull.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen?.(); else shell.requestFullscreen?.().catch(() => {}); });
  if (!document.fullscreenEnabled) fsFull.style.display = 'none';
  if (only()) { fsRow.insertBefore(fsFull, fsExit); fsExit.style.display = 'none'; }
  const onFull = () => {
    const full = document.fullscreenElement === shell; const on = full || only(); setGlyph(fsFull, full ? 'minimize-2' : 'maximize-2');
    shell.style.cssText = only() ? `position:${embedded ? 'absolute' : 'fixed'};inset:0;z-index:${embedded ? 1 : 20};margin:0;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden` : on ? 'position:relative;width:100%;height:100%;margin:0;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden' : 'position:relative;width:min(100%,520px);margin:0 auto;background:#111;border-radius:8px;overflow:hidden';
    frame.style.width = on ? (embedded ? `${Math.max(120, Math.min(host.clientWidth, host.clientHeight * 16 / 9))}px` : 'min(100vw, calc(100vh * 16 / 9))') : '100%';
    inFull = on; clearTimeout(hideTimer); catcher.style.display = 'none'; fsBar.style.display = on ? 'flex' : 'none'; if (on) showBar(); // our controls (YouTube's are off) are there as soon as the video is large
    setTimeout(() => { overStage.redraw(); update(player.state()); }, 60);
  };
  document.addEventListener('fullscreenchange', onFull);
  fullBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen?.(); else shell.requestFullscreen?.().catch(() => {}); });
  let scrubbing = false; let lastSeek = 0;
  const seekAt = (e, force = false) => {
    const r = line.getBoundingClientRect(); const d = player.state().duration; if (!d) return;
    const now = performance.now(); if (!force && now - lastSeek < 150) return; lastSeek = now;
    player.seek(Math.max(0, Math.min(d, ((e.clientX - r.left) / r.width) * d)));
  };
  line.addEventListener('pointerdown', (e) => { scrubbing = true; line.setPointerCapture?.(e.pointerId); seekAt(e, true); });
  line.addEventListener('pointermove', (e) => { if (scrubbing) seekAt(e); });
  const endScrub = (e) => { if (scrubbing) { scrubbing = false; seekAt(e, true); } };
  line.addEventListener('pointerup', endScrub); line.addEventListener('pointercancel', () => { scrubbing = false; });
  line.addEventListener('contextmenu', (e) => e.preventDefault());

  const msg = el('p', 'text-align:center;color:var(--ink-soft,#555);margin:6px 0 0'); msg.textContent = t('youtube.loading'); head.append(msg);
  try { await player.load(data.videoId, inner, { nativeFullscreen: false, nativeControls: !(reader.fullscreen || only()) }); } catch (e) { msg.textContent = `${t('youtube.error')} ${e?.message ?? ''}`; throw e; }
  msg.remove();
  const off = player.subscribe(update);
  // the playheads glide: the player reports its position ten times a second, the position between two reports is extrapolated, and the playheads follow it on every frame
  let raf = 0; const glide = () => { raf = requestAnimationFrame(glide); const st = player.state(); if (st.playing && !st.buffering) { stage.update(st); overStage.update(st); embedded?.onUpdate?.(st); } };
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(glide);
  if (only()) { for (const x of [bar, banner, line, stageEl, lyrics?.element]) if (x) x.style.display = 'none'; head.style.cssText = 'position:static'; onFull(); } // only the video
  update(player.state());
  let resizeTimer = 0; let lastW = host.clientWidth; let lastH = host.clientHeight;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (Math.abs(host.clientWidth - lastW) > 4 || Math.abs(host.clientHeight - lastH) > 4) { lastW = host.clientWidth; lastH = host.clientHeight; if (only()) onFull(); stage.redraw(); overStage.redraw(); update(player.state()); } }, 150); };
  window.addEventListener('resize', onResize);
  const ro = embedded && typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null; ro?.observe(host); // the editor resizes the host without the window changing
  return {
    player, frame, layer, shell,
    /** New data (the editor changed something): the timeline is rebuilt and what is on show drawn again. The structural options (`reader`) need a new view. */
    setData(d) {
      placements = d.placements; display = d.display; items = d.notes; styles = d.styles;
      lanesUsed = [...new Set(placements.map(laneOf))].sort((a, b) => a - b); builtFor = 0;
      stage.redraw(); overStage.redraw(); update(player.state());
    },
    redraw() { stage.redraw(); overStage.redraw(); update(player.state()); },
    destroy() { off(); cancelAnimationFrame(raf); stage.destroy(); overStage.destroy(); itemsOverlay.destroy(); clearTimeout(resizeTimer); clearTimeout(hideTimer); ro?.disconnect(); document.removeEventListener('fullscreenchange', onFull); window.removeEventListener('resize', onResize); player.destroy(); root.remove(); },
  };
}
