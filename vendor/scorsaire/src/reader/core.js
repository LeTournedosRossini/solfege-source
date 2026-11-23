/*
 * The CORE shared by the read-only readers that show a laid-out score (synchro reader, YouTube reader): reading a `.scorsaire` (plain text or ZIP, pictures included),
 * loading it from an address or from a file the person picks, laying out ONE movement as a sheet cell, drawing it (cards of the parts of the form, tap on a measure) and
 * placing a playhead on it. Nothing here writes a document. The sheet reader (`reader.js`) has its own page logic and does not use this file.
 */
import { loadWork } from '../model/serialize.js';
import { createSheet } from '../model/elements.js';
import { PID } from '../model/pid.js';
import { resolveStyle } from '../model/props.js';
import { SID } from '../model/sid.js';
import { registerAsset } from '../model/assets.js';
import { isScorsaireArchive, readScorsaireArchive } from '../model/container.js';
import { pageParams, authFetch } from './access.js';
import { frac, fMul } from '../model/fraction.js';
import { measureLengthOf } from '../model/timing.js';
import { layoutSheet, displayShifted } from '../layout/sheetlayout.js';
import { inkExtent } from '../layout/partlayout.js';
import { playheadRect, measureAt } from '../layout/sheetcursor.js';
import { renderSvgString } from '../render/svg.js';
import { addSectionCards } from '../ui/sheet-cards.js';
import { computePageTurn } from '../ui/follow-scroll.js';
import { mountReaderHeader } from './sticky.js';
import glyphs from '../glyphs/bravura-subset.json' with { type: 'json' };
import { installScaleLayoutHook } from '../scales/layout-hook.js';
installScaleLayoutHook(); // the scale containers of a score are recalculated for the instrument of their track

/** Editor-only roles that a reader never draws. */
export const SKIP_ROLES = ['container-frame', 'container-handle', 'container-warning', 'container-readonly', 'automation', 'automation-bg'];

/**
 * The bytes of a `.scorsaire` file: plain text, or the ZIP form. Registers the pictures of the blocks.
 * @returns {Promise<{ work: object, sync: null | { info, media, analysis }, text: string }>}
 */
export async function readWorkBytes(bytes) {
  if (isScorsaireArchive(bytes)) {
    const r = await readScorsaireArchive(bytes);
    for (const im of r.images) registerAsset(im);
    return { work: loadWork(r.scoreText), sync: r.sync, text: r.scoreText };
  }
  const text = new TextDecoder().decode(bytes);
  return { work: loadWork(text), sync: null, text };
}

/** The address given in `?file=` or `#file=`, or null. */
export const fileParam = () => pageParams().get('file');

/** The bytes embedded in the page as base64 in `<script id="...">` (a page exported by the editor), or null. */
export function embeddedBytes(id) {
  const node = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (!node?.textContent?.trim()) return null;
  return Uint8Array.from(atob(node.textContent.trim()), (c) => c.charCodeAt(0));
}

/** Fetches `url` as bytes (throws with the HTTP status). */
export async function fetchBytes(url) {
  const r = await authFetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * The page shell of a reader: a message line, a file picker when there is no address, and the load from `?file=`.
 * @param o.open(bytes)  called with the bytes to show; it may throw (the message is shown)
 * @param o.t            the translator
 * @param o.pickerKey    i18n key of the sentence above the file picker
 * @param o.embedded()   the bytes of a file embedded in the page, or null
 */
export function bootReader(host, { open, t, pickerKey, embedded = null }) {
  const message = (text) => {
    host.querySelector('[data-sr-msg]')?.remove();
    if (text) { const p = document.createElement('p'); p.setAttribute('data-sr-msg', ''); p.style.cssText = 'padding:40px;text-align:center;color:#555'; p.textContent = text; host.prepend(p); }
  };
  const run = async (bytes) => {
    try { message(t('reader.loading')); await open(bytes); message(''); } catch (e) { message(`${t('reader.loadError')} ${e?.message ?? ''}`); }
  };
  const picker = () => {
    const wrap = document.createElement('div'); wrap.style.cssText = 'padding:40px;text-align:center';
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.scorsaire,application/zip'; input.setAttribute('aria-label', t(pickerKey));
    input.addEventListener('change', async () => { const f = input.files?.[0]; if (f) { wrap.remove(); run(new Uint8Array(await f.arrayBuffer())); } });
    wrap.append(t(pickerKey), document.createElement('br'), input); host.prepend(wrap);
  };
  const own = embedded ? embedded() : null; // a page exported with its file inside
  if (own) { run(own); return { message }; }
  const url = fileParam();
  if (!url) { picker(); return { message }; }
  message(t('reader.loading'));
  fetchBytes(url).then(run).catch((e) => message(`${t('reader.loadError')} (${e.message})`));
  return { message };
}

/**
 * ONE movement of a work as a sheet cell in `stage`: layout, SVG, cards of the parts of the form, a tap on a measure → `onMeasure(index)`.
 * `shown` is the movement to draw (e.g. transposed for display); it must keep the masterbars of `movement`.
 * @returns {{ laid, box, shown }} `laid` = the laid-out cell ({ layout, staffSpace, margin }) for the playhead
 */
export function drawCell(stage, { work, movement, shown = movement, tracks = null, width, staffSpace, onMeasure = null, mode = 'wrap', zoom = 1, header = null, look = null, styles = null, margin = null, label = null, signsColor = null, trackShifts = null, names = false }) {
  const sheet = createSheet({ id: 'reader', name: '' });
  // these readers never write the NAMES of the staves (nor indent the first system for them): the room is for the music. `styles` = values the reader imposes on top (regular measures…)
  const imposed = { [SID.SHOW_INSTRUMENT_NAMES]: false, [SID.ENABLE_INDENTATION_ON_FIRST_SYSTEM]: false, [SID.READER_SCALE]: 'auto', ...(names ? { [SID.SHOW_INSTRUMENT_NAMES]: true, [SID.HIDE_INSTRUMENT_NAME_IF_ONE]: false } : {}), ...(styles ?? {}) }; // `names`: the address gave the name of a player, which must be seen
  const getStyle = (sid) => (sid === SID.SECTION_COLORS_SHOW ? false : sid in imposed ? imposed[sid] : resolveStyle(sid, [null, movement.style]));
  if (trackShifts && Object.keys(trackShifts).length) shown = displayShifted(shown, (t) => trackShifts[t.id] ?? 0); // the display transposition of single tracks asked for by the address
  const shownWork = Object.create(work, { movements: { value: work.movements.map((m) => (m === movement ? shown : m)) } });
  const laid = layoutSheet(shownWork, sheet, glyphs, { device: { width, staffSpace }, view: { mode, zoom, ...(look && !movement.tracks.some((t) => t.staves.length) ? { margin: 0 } : margin != null ? { margin } : {}) }, getStyle, signsColor, cells: [{ id: 'c0', movementId: movement.id, tracks }] });
  const l = laid.cells[0];
  const box = document.createElement('div'); box.setAttribute('data-cell', ''); box.style.cssText = `position:relative;${mode === 'scroll' ? 'width:max-content;' : ''}${look ? `background:transparent;border:0;${look.css ?? ''}` : 'background:var(--score,#fff);border:1px solid var(--line,#ddd);'}user-select:none;-webkit-user-select:none;-webkit-touch-callout:none`;
  box.innerHTML = renderSvgString(l.layout, glyphs, { staffSpace: l.staffSpace, margin: l.margin, ink: look?.ink ?? 'var(--ink,#000)', paper: look?.paper ?? 'var(--score,#fff)', skipRoles: SKIP_ROLES });
  if (look && mode !== 'scroll') { // a box on the video: the room under the last staff is trimmed so that the bottom margin is no bigger than the top one
    const svgEl = box.querySelector('svg'); const sys = l.layout.systems[l.layout.systems.length - 1];
    if (svgEl && sys) {
      const ink = sys.staves.length ? inkExtent(sys, glyphs) : { bottom: sys.band?.h ?? sys.height }; // no staff: the band (fitted to its content) is all there is
      const h = Math.ceil(Math.min(l.layout.height * l.staffSpace + l.margin, (sys.top + ink.bottom) * l.staffSpace + l.margin * 0.6));
      const w = svgEl.viewBox.baseVal.width; svgEl.setAttribute('height', String(h)); svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
  }
  // the drawing has a name for a screen reader (axe `svg-img-alt`): `label` when given (the note component passes its own, in its language), else the movement's title, else the work's, else « Score » (the page's language, as the readers choose it)
  const svgOfCell = box.querySelector('svg[role="img"]');
  if (svgOfCell && !svgOfCell.hasAttribute('aria-label')) {
    const en = (typeof navigator !== 'undefined' ? navigator.language ?? 'fr' : 'fr').slice(0, 2) === 'en';
    svgOfCell.setAttribute('aria-label', String(label || movement.props?.[PID.TITLE] || work.props?.[PID.TITLE] || (en ? 'Score' : 'Partition')).trim() || (en ? 'Score' : 'Partition'));
  }
  addSectionCards(box, l);
  box.addEventListener('click', (e) => {
    if (!onMeasure) return;
    const svg = box.querySelector('svg'); const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
    const m = measureAt(l, ((e.clientX - r.left) / r.width) * vb.width, ((e.clientY - r.top) / r.height) * vb.height);
    if (m != null) onMeasure(m);
  });
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.replaceChildren(box);
  if (mode === 'scroll') stage.setAttribute('data-hscroll', ''); else stage.removeAttribute('data-hscroll');
  stage.style.overflowX = mode === 'scroll' ? 'auto' : '';
  // the sticky header only exists where the music scrolls sideways
  let hdr = null;
  if (mode === 'scroll' && header !== false) { hdr = mountReaderHeader({ box, scroller: stage, glyphs, paper: look?.paper ?? 'var(--score,#fff)' }); hdr.refresh(l); }
  return { laid: l, box, shown, header: hdr, scroller: mode === 'scroll' ? stage : null };
}

/** The title-less name of a track: its name, or its number. */
export const trackName = (tr, i) => tr.props?.[PID.NAME] || `${i + 1}`;

/**
 * A playhead drawn over a cell. `place(cell, at, { follow, top })` puts it at `at` = { measure, ratio } (ratio 0..1 of the measure); `clear()` removes it.
 * With `follow`, when the measure changes the window scrolls to keep the playhead below `top()` (the bottom of a sticky panel) and above the bottom of the window.
 */
export function createPlayhead() {
  let el = null; let lastMeasure = -1;
  const clear = () => { el?.remove(); el = null; };
  const reset = () => { el = null; lastMeasure = -1; }; // the box was replaced: the old element is gone with it
  const place = (cell, at, { follow = false, top = () => 0, vertical = true } = {}) => {
    if (!cell || !at) { clear(); return; }
    const { laid, box, shown } = cell; const mb = shown.masterbars[at.measure]; if (!mb) { clear(); return; }
    const r = playheadRect(laid, shown, { measure: at.measure, position: fMul(measureLengthOf(mb), frac(Math.round(at.ratio * 1920), 1920)) });
    const svg = box.querySelector('svg'); const vb = svg?.viewBox.baseVal; if (!r || !vb) return;
    if (!el || !el.isConnected) { el = document.createElement('div'); el.style.cssText = 'position:absolute;width:2px;background:#e8731a;pointer-events:none'; box.append(el); }
    el.style.left = `${(r.x / vb.width) * 100}%`; el.style.top = `${(r.y1 / vb.height) * 100}%`; el.style.height = `${((r.y2 - r.y1) / vb.height) * 100}%`;
    // sideways: when the playhead gets near the right edge the music turns like a page (the playhead lands near the left edge, right of the sticky header)
    if (follow && cell.scroller) {
      const sc = cell.scroller.getBoundingClientRect(); const x = el.getBoundingClientRect().left;
      const dx = computePageTurn({ x, left: Math.max(sc.left, 0) + (cell.header?.width() ?? 0), right: Math.min(sc.right, window.innerWidth || sc.right) });
      if (dx) cell.scroller.scrollLeft += dx;
    }
    if (follow && vertical && at.measure !== lastMeasure) {
      lastMeasure = at.measure; const b = el.getBoundingClientRect(); const limit = top();
      if (b.top < limit + 10 || b.bottom > window.innerHeight - 20) window.scrollBy({ top: b.top - limit - 40, behavior: 'instant' });
    }
  };
  return { place, clear, reset };
}
