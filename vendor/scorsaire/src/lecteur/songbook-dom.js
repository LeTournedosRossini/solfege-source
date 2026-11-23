/*
 * Draws the songbook view (songbook.js) as text in a box: one line per phrase, each syllable a small column (the chords above, the syllable under), so that a chord stays
 * above the syllable it belongs to whatever the size. Returns the box and the height of every line, to cut the song into pages (pages.js).
 */
import { packColumns } from './columns.js';

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; n.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};

/**
 * @param data    the result of `buildSongbook`
 * @param o       { width, fontPx, margin, chords: 'first' | 'all' | 'none', columns: 1 | 2, cards: the card of each section of the form before its first line, cardScale, chorus: 'normal' | 'italic' | 'bold' (the lines of a chorus),
 *                  breaks: 'free' | 'verses' (a verse is kept whole when it fits) | 'page' (every verse starts a page) }
 * @returns {{ box, arrange(pageHeight, reserve), measure() }}  `arrange` (once the box is in the page) packs the lines into pages (columns.js): one band of exactly `pageHeight` per page, with whole lines only, in one or two columns
 *          (two when asked and the columns are wide enough; the lines are then laid out at the width of a column, and a song that fits one column is drawn on the whole width); it returns the pages.
 *          `reserve`: room left empty at the foot of each page. `measure()`: the lines of the box as it is (the editor's preview).
 */
export function drawSongbook(data, { width, fontPx, margin = 8, chords = 'first', columns = 1, cards = false, cardScale = 1, chorus = 'normal', breaks = 'free' }) {
  const gap = Math.round(fontPx * 1.2);
  const colWidth = Math.floor((width - 2 * margin - gap) / 2);
  const twoColumns = columns === 2 && colWidth >= fontPx * 10; // a column narrower than ten characters wide is useless: one column then
  const box = el('div', { 'data-songbook': '', style: `width:${width}px;box-sizing:border-box;padding:${margin}px;font-size:${fontPx}px;line-height:1.1;font-family:var(--ui-font);color:var(--ink,#1c1b1a);transform-origin:0 0` });
  const lines = twoColumns ? el('div', { style: `width:${colWidth}px` }) : box; // (two columns: the lines are measured at the width of a column)
  if (twoColumns) box.append(lines);
  const showVerseLabel = data.verses.length > 1 && !data.verses.some((v) => v.label); // (a stanza that has a name shows it as a card instead of a number)
  let prev = null; // the last line written that sits in a section: { id, time, verse }
  data.verses.forEach((v, vi) => {
    const withChords = chords === 'all' || (chords === 'first' && (vi === 0 || v.ownChords)); // (a stanza that carries its own chords, written by hand, always shows them)
    v.lines.forEach((line, li) => {
      const row = el('div', { 'data-line': '', 'data-verse': v.group ?? String(v.verse), style: `display:flex;flex-wrap:wrap;align-items:flex-end;margin-bottom:${withChords ? 0.55 : 0.3}em` });
      if (showVerseLabel && li === 0) row.append(el('span', { style: `align-self:flex-end;min-width:1.6em;opacity:.55;font-size:.8em` }, `${v.verse + 1}.`));
      else if (showVerseLabel) row.append(el('span', { style: 'min-width:1.6em' }));
      if (line.type === 'chords') {
        if (withChords) row.append(...line.chords.map((c) => el('span', { class: 'lc-chord', style: `font-family:'Barlow Condensed',var(--ui-font);font-weight:600;font-style:normal;margin-right:.9em` }, c)));
        else return;
      } else {
        for (const cell of line.cells) {
          const col = el('span', { style: `display:inline-flex;flex-direction:column;align-items:flex-start;margin-right:${cell.join === '-' || cell.join === '' ? 0 : 0.3}em` });
          if (withChords) col.append(el('span', { class: 'lc-chord', style: `font-family:'Barlow Condensed',var(--ui-font);font-weight:600;font-style:normal;font-size:.95em;min-height:1.15em;white-space:nowrap;margin-right:.35em` }, cell.chords.join(' ')));
          col.append(el('span', { style: 'white-space:nowrap' }, cell.join === '-' ? `${cell.text}-` : cell.text));
          row.append(col);
        }
      }
      const info = v.info?.[li]; const sec = info?.section ?? null;
      if (sec) {
        // the card of a section: where the section changes, and where the music starts again (the next verse sung on the same measures)
        if ((cards || v.label) && (!prev || prev.id !== sec.id || (prev.verse !== v.verse && info.time < prev.time))) row.prepend(el('div', { 'data-section-card': '', style: 'flex:0 0 100%;margin-bottom:.12em' }, el('span', { style: `display:inline-block;background:${sec.color ?? '#ddd'};color:#1c1b1a;font:600 ${(0.62 * cardScale).toFixed(3)}em/1.35 var(--ui-font);padding:0 .6em;border-radius:.35em` }, sec.label)));
        prev = { id: sec.id, time: info.time, verse: v.verse };
        if (chorus !== 'normal' && sec.category === 'chorus') row.style.cssText += chorus === 'italic' ? ';font-style:italic' : ';font-weight:700';
      }
      lines.append(row);
    });
  });
  const arrange = (pageHeight, reserve = 0) => {
    const rows = [...lines.querySelectorAll('[data-line]')];
    const items = () => rows.map((r) => ({ height: r.offsetHeight + parseFloat(getComputedStyle(r).marginBottom || '0'), group: r.getAttribute('data-verse') }));
    const capacity = Math.max(1, pageHeight - 2 * margin - reserve); // `reserve`: a line's room kept empty at the foot of the page (the status line, a browser bar)
    let perPage = twoColumns ? 2 : 1;
    const pack = (n) => packColumns(items(), capacity, n, { keepGroups: n === 2 || breaks !== 'free', pagePerGroup: breaks === 'page' }); // (two columns keep a verse whole when it fits, whatever the choice)
    let packed = pack(perPage);
    if (perPage === 2 && packed.length <= 1 && (packed[0]?.length ?? 0) <= 1) { lines.style.width = ''; perPage = 1; packed = pack(1); } // all of it fits one column: it keeps the whole width instead
    // every page is a band of exactly the height of the screen that holds whole lines only: nothing of the next page can show below it
    const bands = packed.map((page) => {
      const band = el('div', { 'data-songbook-page': '', style: `display:flex;gap:${gap}px;height:${pageHeight}px;box-sizing:border-box;padding:${margin}px 0;overflow:hidden` });
      for (const col of page) { const c = el('div', { style: 'flex:1 1 0;min-width:0' }); c.append(...col.map((i) => rows[i])); band.append(c); }
      return band;
    });
    box.style.padding = `0 ${margin}px`;
    box.replaceChildren(...bands);
    return bands.map((_, k) => ({ y0: k * pageHeight, y1: (k + 1) * pageHeight, first: k, last: k }));
  };
  return { box, arrange, measure: () => [...box.querySelectorAll('[data-line]')].map((r) => ({ top: r.offsetTop, height: r.offsetHeight + parseFloat(getComputedStyle(r).marginBottom || '0') })) };
}
