/*
 * The STAGE of the YouTube reader, shared with the preview of the editor (screen 4) so that what the editor shows is, by construction, what the reader shows:
 *   createStage(...)       the two rows of score (the fragment each row SHOWS, see `shownAt`), a fade when a fragment appears, a crossfade when a row changes its fragment,
 *                          a fade out when a row is put away, and the playhead of the fragment that is playing in each row;
 *   createBannerView(...)  the banner: a lane of cards and a lane of annotations over the time of the media (a tap puts the media at the start of the item).
 * Both read their data through getters (the editor changes it while they live) and are driven by `update(state)` (the state of the media player).
 */
import { placementMap, rowOf, shownAt, playingAt, fadeInOf, fadeOutOf, normalizeDisplay } from '../audio/placements.js';
import { buildSequence } from '../audio/sequence.js';
import { drawCell, createPlayhead } from '../reader/core.js';
import { startTracks } from '../reader/pupils.js';
import { withoutLyrics } from '../reader/lyricspanel.js';
import { styleOf, itemHeight, lookCss, cssColor, onVideo, itemOver } from '../audio/banner.js';
import { isOver, overOf, MAX_ROWS } from '../audio/placements.js';

function el(tag, css = '', attrs = {}) {
  const e = document.createElement(tag); if (css) e.style.cssText = css;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * @param o.host         the element the rows are put in
 * @param o.work         the work (read through `o.getWork()` when given: the editor's document changes in place)
 * @param o.player       the media player (`seek`)
 * @param o.getPlacements() / o.getDisplay()   the live data
 * @param o.accept(p) / o.boxCss(p) / o.sizeOf(p) / o.lookOf(p)   a stage that shows only some placements (the ones ON the video): which, the CSS of the box of a row, its { width, staffSpace }, its look ({ paper })
 * @param o.width()      pixels available for a score; o.staffSpace() the size of the staves; o.getView() = { mode, zoom } (see reader/options.js)
 * @param o.follow       scroll the window to keep the playhead in sight (the reader does, the preview does not); o.top() = the bottom of what is sticky above
 */
/** What the address asked for (`tracks=`, `tt=`, `who=`) as options of `drawCell`; nothing when it asked for nothing. */
/** The options with the tracks in `hidden` (the lyrics tracks, when the words are shown as strophes) taken out of the tracks drawn. */
function hideTracks(movement, options, hidden) {
  const rest = withoutLyrics(movement, options.tracks ?? null, hidden);
  return rest && rest !== options.tracks ? { ...options, tracks: rest } : options;
}

function pupilOptions(movement, pupils) {
  if (!pupils) return {};
  const tracks = startTracks(movement, pupils.tracks);
  return { ...(tracks ? { tracks } : {}), ...(pupils.trackShifts ? { trackShifts: pupils.trackShifts } : {}), ...(pupils.who ? { names: true } : {}) };
}

export function createStage({ host, work, getWork = () => work, player, getPlacements: getAll, getDisplay, width, staffSpace, getView = (_p) => ({ mode: 'wrap', zoom: 1 }), follow = false, top = () => 0, accept = () => true, boxCss = () => '', sizeOf = null, lookOf = null, vertical = true, pinned = () => null, getPupils = () => null, getHiddenTracks = () => null }) {
  const getPlacements = () => getAll().filter(accept); // this stage shows only the placements it accepts (under the video, or on it)
  let slots = null; // the slots of the whole work, once: the proportional map of a fragment is made from the slots of ITS movement
  const slotsOf = (index) => { slots ??= buildSequence(getWork(), { speed: 1, playRepeats: false }).slots; return slots.filter((s) => s.movement === index); };
  const rows = Array.from({ length: MAX_ROWS }, (_, r) => {
    const box = el('div', 'position:relative', { 'data-yr-row': String(r) }); host.append(box);
    return { r, box, id: null, p: null, drawn: null, playhead: createPlayhead(), timer: 0 };
  });
  const movementOf = (p) => getWork().movements.find((m) => m.id === p.movementId);
  const cellOf = (row) => row.drawn?.box ?? null;
  const fadeIn = (cell, seconds) => { cell.style.transition = 'none'; cell.style.opacity = '0'; void cell.offsetHeight; cell.style.transition = `opacity ${seconds}s ease`; cell.style.opacity = '1'; };
  const drawRow = (row, p) => {
    const movement = movementOf(p); if (!movement) return false;
    // the first track (the top one) is in FRONT of the ones under it
    row.box.style.cssText = `position:relative;${boxCss(p)}z-index:${MAX_ROWS - row.r};`; row.box.setAttribute('data-yr-pid', p.id);
    row.drawn = drawCell(row.box, {
      work: getWork(), movement, ...hideTracks(movement, pupilOptions(movement, getPupils()), getHiddenTracks()), ...(sizeOf ? sizeOf(p) : { width: Math.max(260, width()), staffSpace: staffSpace() }), ...getView(p), look: lookOf ? lookOf(p) : null,
      onMeasure: (m) => { const map = placementMap(slotsOf(getWork().movements.indexOf(movement)), p); if (map) player.seek(map.timeOf(m, 0)); }, // a tap on a measure puts the media at its start
    });
    row.playhead.reset();
    return true;
  };
  const setRow = (row, p, instant) => {
    const id = p?.id ?? null; if (id === row.id) return;
    clearTimeout(row.timer); const was = row.id; const before = row.p; row.id = id; row.p = p ?? null;
    const display = getDisplay();
    if (!p) { // put away: fade out (the fade out of the fragment that goes), then empty; at once when the person jumped elsewhere
      const secs = before ? fadeOutOf(before, display) : normalizeDisplay(display).fadeOut; const cell = cellOf(row); if (!cell) return;
      if (instant) { row.box.replaceChildren(); row.drawn = null; return; }
      cell.style.transition = `opacity ${secs}s ease`; cell.style.opacity = '0';
      row.timer = setTimeout(() => { if (row.id === null) { row.box.replaceChildren(); row.drawn = null; } }, secs * 1000 + 30);
      return;
    }
    const secs = fadeInOf(p, display);
    // the fragment that was here goes away in a crossfade: it is kept on top of the new one and fades out over ITS fade out
    const outSecs = before ? fadeOutOf(before, display) : secs;
    let ghost = null; const old = cellOf(row);
    if (old && was !== null && !instant && outSecs > 0) { ghost = el('div', 'position:absolute;left:0;top:0;width:100%;pointer-events:none;opacity:1;z-index:1'); ghost.append(old); }
    if (!drawRow(row, p)) { row.id = was; row.p = before; return; }
    const cell = cellOf(row);
    if (instant || !secs) { cell.style.transition = 'none'; cell.style.opacity = '1'; } else fadeIn(cell, secs);
    if (ghost) {
      row.box.append(ghost); void ghost.offsetHeight; ghost.style.transition = `opacity ${outSecs}s ease`; ghost.style.opacity = '0';
      setTimeout(() => ghost.remove(), outSecs * 1000 + 50);
    }
  };
  let first = true; let lastPos = null;
  const update = (st) => {
    const placements = getPlacements(); const display = getDisplay();
    // the fades belong to the PLAYBACK: when the person moves the video (paused, or a jump while it plays), what is shown changes at once
    const jumped = lastPos != null && (st.position < lastPos - 0.05 || st.position - lastPos > 0.5 + 2 * Math.max(1, st.rate)); lastPos = st.position;
    const instantNow = first || !st.playing || jumped;
    const shown = [...shownAt(placements, st.position, display)];
    const pin = pinned() && placements.find((x) => x.id === pinned()); if (pin && !shown[rowOf(pin)]) shown[rowOf(pin)] = pin; // the fragment being edited stays in sight (an aid of the editor)
    for (const row of rows) {
      setRow(row, shown[row.r] ?? null, instantNow);
      if (shown[row.r]) row.p = shown[row.r]; // the live object (its fades may have been edited)
      const playing = playingAt(placements, st.position, row.r);
      if (!playing || playing.id !== row.id || !row.drawn) { row.playhead.clear(); continue; }
      const movement = movementOf(playing); const map = movement ? placementMap(slotsOf(getWork().movements.indexOf(movement)), playing) : null;
      if (!map) { row.playhead.clear(); continue; }
      row.playhead.place(row.drawn, map.locate(st.position), { follow: follow && st.playing && (row.r === 0 || !rows[0].id), top, vertical });
    }
    first = false;
  };
  /** Draws again what is on show (the width changed, or the music of the document did): without any fade. */
  const redraw = () => {
    slots = null;
    for (const row of rows) {
      const p = getPlacements().find((x) => x.id === row.id);
      if (p && drawRow(row, p)) { const c = cellOf(row); c.style.transition = 'none'; c.style.opacity = '1'; }
      else if (row.id && !p) { row.id = null; row.box.replaceChildren(); row.drawn = null; }
    }
  };
  return { update, redraw, destroy() { for (const row of rows) { clearTimeout(row.timer); row.box.remove(); } } };
}

/** The banner: `getItems()` (cards and notes, see audio/banner.js) over the media time `getDuration()`. `update(state)` highlights what is alive; the lanes are rebuilt when the data changes. */
export function createBannerView({ host, player, getItems, getDuration, getScale = () => 1, getStyles = () => null }) {
  let sig = ''; const alive = new Map();
  const build = (items, d) => {
    host.replaceChildren(); alive.clear();
    for (const kind of ['card', 'note']) {
      const mine = items.filter((x) => x.kind === kind); if (!mine.length) continue;
      const k = getScale(); const styles = getStyles(); const h = Math.max(...mine.map((x) => itemHeight(x, styles))) * k;
      const lane = el('div', `position:relative;height:${h}px;margin-bottom:2px`, { 'data-yr-lane': kind }); host.append(lane);
      for (const x of mine) {
        const st = styleOf(x, styles);
        const css = `position:absolute;top:0;bottom:0;left:${(x.start / d) * 100}%;width:${((x.end - x.start) / d) * 100}%;${lookCss(st, k)}border-radius:4px;overflow:hidden;padding:2px 6px;box-sizing:border-box;white-space:pre-line;cursor:pointer`;
        const b = el('div', css, { 'data-yr-item': x.id, title: x.text });
        b.textContent = x.text; b.addEventListener('click', () => player.seek(x.start)); lane.append(b); alive.set(x.id, b);
      }
    }
  };
  const update = (st) => {
    const d = getDuration() || st.duration; const items = getItems();
    if (!d) return;
    const s = `${d}|${getScale()}|${JSON.stringify(items)}|${JSON.stringify(getStyles() ?? {})}`; if (s !== sig) { sig = s; build(items, d); }
    for (const [id, b] of alive) { const x = items.find((i) => i.id === id); b.style.outline = x && st.position >= x.start && st.position < x.end ? '2px solid #2b6cff' : ''; }
  };
  return { update, destroy() { host.replaceChildren(); } };
}

/** The options of a stage that shows the fragments placed ON the video: boxes placed in percent of the video frame (they grow with it), a fill with opacity and a soft edge.
 *  `frameW()` = width in pixels of the video frame; the music is drawn as if the frame were 640 px wide and scales with it. */
export function overlayOptions(frameW, getZoom = () => 1, getMode = () => 'wrap', { selected = () => null } = {}) {
  const k = () => frameW() / 640;
  return {
    accept: isOver, follow: true, vertical: false, width: frameW, staffSpace: () => 9 * k(), getView: (p) => ({ mode: getMode(p), zoom: getZoom() }), // follow sideways only (the window never scrolls for a box on the video)
    boxCss: (p) => { const o = overOf(p); // x and w are percent of the WIDTH of the frame; so is y: a margin in % is relative to the width of the containing block (`top: y%` would be relative to its HEIGHT)
    return `position:absolute;left:${o.x}%;top:0;margin-top:${o.y}%;width:${o.w}%;pointer-events:auto;scrollbar-width:none;`; },
    // a cell is drawn 24 px narrower than the width it is asked for (the padding of a sheet): ask for them back, the box has no padding of its own
    sizeOf: (p) => ({ width: Math.max(120, (overOf(p).w / 100) * frameW()) + 24, staffSpace: Math.max(2, 9 * k() * (overOf(p).size / 100)) }),
    // the selected box is only outlined; it is shown when the video is at its place in time, like the others
    lookOf: (p) => { const o = overOf(p); const fill = cssColor(o.color, o.opacity); return { paper: o.color, ink: o.ink, css: `${selected() === p.id ? 'outline:1px dashed #2b6cff;outline-offset:2px;' : ''}background:${fill};${o.soft > 0 ? `box-shadow:0 0 ${o.soft * k()}px ${(o.soft * k()) / 2}px ${fill};` : ''}` }; },
  };
}

/**
 * The cards and annotations placed ON the video: boxes in percent of the video frame (x, y = top left corner, w = width; the height comes from the text), shown while the video is
 * inside their interval. `pinned()` = id of the item being edited: it is shown at any time (outlined) so that it can be placed. The text is drawn as if the frame were 640 px wide.
 */
export function createItemsOverlay({ host, player, getItems, getStyles = () => null, frameW, pinned = () => null }) {
  let sig = '';
  const update = (st) => {
    const pin = pinned(); const styles = getStyles(); const k = frameW() / 640;
    const show = getItems().filter((x) => onVideo(x) && ((st.position >= x.start && st.position < x.end) || x.id === pin));
    const next = JSON.stringify([show, styles, Math.round(k * 100), pin, show.map((x) => st.position >= x.start && st.position < x.end)]); if (next === sig) return; sig = next;
    host.replaceChildren(...show.map((x) => {
      const o = itemOver(x); const look = styleOf(x, styles); const live = st.position >= x.start && st.position < x.end;
      const b = el('div', `position:absolute;left:${o.x}%;top:0;margin-top:${o.y}%;width:${o.w}%;box-sizing:border-box;padding:${2 * k}px ${6 * k}px;border-radius:${4 * k}px;white-space:pre-line;overflow:hidden;pointer-events:auto;${lookCss(look, k)}${x.id === pin ? `outline:${live ? 1 : 2}px dashed #2b6cff;outline-offset:2px;${live ? '' : 'opacity:.55;'}` : ''}`, { 'data-yr-item': x.id });
      b.textContent = x.text; return b;
    }));
  };
  return { update, redraw() { sig = ''; update(player.state()); }, destroy() { host.replaceChildren(); } };
}
