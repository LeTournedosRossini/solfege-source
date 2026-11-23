/*
 * The LYRICS BY STROPHES of the readers (sheets, sync, YouTube): the words of the « Paroles » track written as blocks of text, each under its card of structure, as a singer reads them.
 * This is the DEFAULT: the lyrics track is then left off the staves and the strophes are shown under the music; one button gives the usual display back (the words under the notes, on
 * their own staff) and another brings the strophes again. The choice is kept on the device (`scorsaire.reader.lyrics`) and an address may ask for one (`lyrics=strophes|staff`).
 * The strophes are those of screen 2 (`model/lyricstrophes.js › autoStrophes`, or the free texts of the verses when there is no track). Only text is drawn here: no layout engine.
 */
import { autoStrophes, freeTextStrophes } from '../model/lyricstrophes.js';
import { inlineCardColor } from '../model/sections.js';
import { isLyricsTrack } from '../model/lyricevents.js';

export const LYRICS_KEY = 'scorsaire.reader.lyrics';
export const LYRICS_MODES = Object.freeze(['strophes', 'staff']);

/** The ids of the « Paroles » tracks of the work. */
export const lyricTrackIds = (work) => new Set((work?.movements ?? []).flatMap((m) => m.tracks.filter((t) => isLyricsTrack(t)).map((t) => t.id)));

/** The strophes of a work: from its Paroles track, else from the free texts of its verses; [] when there are no words. */
export function strophesOfWork(work, lang = 'fr') {
  const auto = autoStrophes(work, { lang });
  return auto.length ? auto : freeTextStrophes(work, { lang });
}

/** `tracks` (ids, or null for every track of `movement`) without the lyrics tracks; the list unchanged when nothing would be left or nothing is taken out. */
export function withoutLyrics(movement, tracks, ids) {
  if (!ids?.size) return tracks;
  const base = tracks ?? movement.tracks.map((t) => t.id);
  const rest = base.filter((id) => !ids.has(id));
  return rest.length && rest.length < base.length ? rest : tracks;
}

const CSS = `
.lp { margin: 14px 12px 90px; padding: 10px 14px 14px; border: 1px solid var(--line,#d8d3c8); border-radius: 12px; background: var(--card,transparent); color: var(--ink,#1c1b1a); font: 16px/1.5 var(--ui-font,sans-serif); }
.lp-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.lp-head h3 { margin: 0; font-size: 17px; flex: 1; }
.lp-head button { min-height: var(--ui-target,40px); padding: 0 14px; font: inherit; background: var(--field,#fff); color: inherit; border: 1px solid var(--edge,#bbb); border-radius: 8px; cursor: pointer; }
.lp-body { margin-top: 10px; column-width: 20em; column-gap: 32px; font-size: clamp(18px, 2.2vw, 26px); line-height: 1.45; }
.lp-st { break-inside: avoid; margin: 0 0 1.1em; }
.lp-card { display: inline-block; padding: 1px 10px; margin: 0 0 .25em; border-radius: 6px; font-size: .72em; font-weight: 700; color: #1c1b1a; }
.lp-line { margin: 0; }
`;

/**
 * @param o.work     the loaded work
 * @param o.lang     'fr' | 'en'
 * @param o.t        the translator of the reader (keys `reader.lyrics*`)
 * @param o.asked    'strophes' | 'staff' from the address, or null
 * @param o.storage  a Storage-like object (localStorage), or null
 * @param o.onChange (mode) → void: the reader draws its staves again (with or without the lyrics track)
 * @returns { element, available, mode, staffHidden, trackIds, setMode }
 */
export function mountLyricsPanel({ work, lang = 'fr', t, asked = null, storage = null, onChange = () => {} }) {
  if (typeof document !== 'undefined' && !document.getElementById('lp-style')) { const st = document.createElement('style'); st.id = 'lp-style'; st.textContent = CSS; document.head.append(st); }
  const strophes = strophesOfWork(work, lang);
  const ids = lyricTrackIds(work);
  const read = () => { try { const v = storage?.getItem(LYRICS_KEY); return LYRICS_MODES.includes(v) ? v : null; } catch { return null; } };
  let mode = LYRICS_MODES.includes(asked) ? asked : (read() ?? 'strophes'); // strophes unless a person or an address chose otherwise
  const element = document.createElement('section'); element.className = 'lp'; element.setAttribute('data-lyrics-panel', '');
  const draw = () => {
    element.replaceChildren();
    element.hidden = !strophes.length;
    element.setAttribute('data-mode', mode);
    const head = document.createElement('div'); head.className = 'lp-head';
    const title = document.createElement('h3'); title.textContent = t('reader.lyrics');
    const btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute('data-lyrics-mode', mode === 'strophes' ? 'staff' : 'strophes');
    btn.textContent = t(mode === 'strophes' ? 'reader.lyricsToStaff' : 'reader.lyricsToStrophes');
    btn.addEventListener('click', () => setMode(mode === 'strophes' ? 'staff' : 'strophes'));
    head.append(title, btn); element.append(head);
    if (mode !== 'strophes') return;
    const body = document.createElement('div'); body.className = 'lp-body';
    for (const s of strophes) {
      const block = document.createElement('div'); block.className = 'lp-st';
      if (s.card?.label) { const c = document.createElement('span'); c.className = 'lp-card'; c.textContent = s.card.label; c.style.background = inlineCardColor(s.card, work); block.append(c); }
      for (const line of s.lines) { if (!line.trim()) continue; const p = document.createElement('p'); p.className = 'lp-line'; p.textContent = line; block.append(p); }
      body.append(block);
    }
    element.append(body);
  };
  function setMode(next) {
    if (!LYRICS_MODES.includes(next) || next === mode) return;
    mode = next; try { storage?.setItem(LYRICS_KEY, mode); } catch { /* kept for this page */ }
    draw(); onChange(mode);
  }
  draw();
  return {
    element,
    available: () => strophes.length > 0,
    mode: () => mode,
    /** True while the lyrics track must stay off the staves (the strophes are shown instead). */
    staffHidden: () => strophes.length > 0 && ids.size > 0 && mode === 'strophes',
    trackIds: () => ids,
    setMode,
  };
}
