/*
 * The FREE TEXT SHEET window: the words of a verse typed or pasted as plain text (one line of the text = one line of the sheet), and the chords put by hand where they sound.
 * A chord is written between square brackets right before the word, or the letters, it starts on (« [C]Le so[G]leil »): put the cursor there and tap a chord of the song (the chords
 * of the first chord track are offered, and any other chord can be typed). The preview under the text is drawn exactly as the Lecteur draws it. Nothing is written until « Apply »
 * (one transaction). A verse that is already placed on notes or on the measures is not a free text: the window says so. Bottom sheet on phones / tablets, centered window on desktop.
 */
import { freeSheetLines } from '../lecteur/freesheet.js';
import { drawSongbook } from '../lecteur/songbook-dom.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

export function openLyricsSheet({ app, label = (k) => k, verse = 0 }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let current = verse; let info = null;
  const veil = document.createElement('div');
  veil.setAttribute('data-lyrics-sheet', ''); veil.setAttribute('data-zoom-lock', '');
  veil.style.cssText = `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`;
  const box = document.createElement('div');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); if (!sheet) box.setAttribute('data-resizable', 'lyrics-sheet'); box.setAttribute('aria-label', label('lyrics.sheet.title'));
  box.style.cssText = `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:14px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;display:flex;flex-direction:column;gap:8px;${sheet ? 'width:100%;max-height:92vh;border-radius:12px 12px 0 0' : 'width:min(860px,calc(100vw - 24px));max-height:90vh;border-radius:8px'}`;
  const mk = (text, act, fn) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('data-act', act); b.addEventListener('click', fn);
    b.style.cssText = 'min-height:var(--ui-target,30px);padding:0 14px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);border-radius:6px'; return b;
  };
  const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:6px';
  const title = document.createElement('div'); title.textContent = label('lyrics.sheet.title'); title.style.cssText = 'flex:1;font-weight:var(--w-semi,600);font-size:16px';
  const verseLabel = document.createElement('span'); verseLabel.setAttribute('data-sheet-verse', '');
  const hint = document.createElement('div'); hint.textContent = label('lyrics.sheet.hint'); hint.style.cssText = 'font-size:12px;opacity:.75';
  const area = document.createElement('textarea'); area.setAttribute('data-sheet-text', ''); area.rows = 6; area.placeholder = label('lyrics.sheet.placeholder');
  for (const a of ['autocomplete', 'autocorrect']) area.setAttribute(a, 'off'); area.setAttribute('autocapitalize', 'off'); area.spellcheck = false;
  area.style.cssText = 'width:100%;box-sizing:border-box;font:16px/1.4 var(--ui-font,sans-serif);padding:8px;resize:vertical;min-height:110px;max-height:30vh;background:var(--field,#fff);color:var(--ink,#000);border:1px solid var(--field-edge,#767676);border-radius:8px';
  const chordRow = document.createElement('div'); chordRow.setAttribute('data-sheet-chords', ''); chordRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center';
  const preview = document.createElement('div'); preview.setAttribute('data-sheet-preview', ''); preview.style.cssText = 'overflow:auto;background:var(--score,#fff);border:1px solid var(--edge,#bbb);border-radius:6px;min-height:60px;max-height:34vh;color:var(--ink,#111)';
  const message = document.createElement('div'); message.setAttribute('role', 'alert'); message.style.cssText = 'min-height:1.2em;color:#b00020';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap;justify-content:flex-end';

  let done = false;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };

  /** Puts « [chord] » at the cursor of the text (a selection is replaced), and keeps the cursor after it. */
  const insertChord = (name) => {
    const n = String(name ?? '').trim();
    if (!n) return;
    const a = area.selectionStart ?? area.value.length; const b = area.selectionEnd ?? a;
    const mark = `[${n.replace(/[\[\]]/g, '')}]`;
    area.value = area.value.slice(0, a) + mark + area.value.slice(b);
    area.focus({ preventScroll: true });
    area.setSelectionRange(a + mark.length, a + mark.length);
    drawPreview();
  };
  const drawChords = () => {
    chordRow.replaceChildren();
    const lab = document.createElement('span'); lab.textContent = label('lyrics.sheet.chords'); lab.style.cssText = 'font-size:12px;opacity:.7';
    chordRow.append(lab);
    for (const name of info.chords) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-sheet-chord', name); b.textContent = name;
      b.style.cssText = "min-width:var(--ui-target,36px);min-height:var(--ui-target,36px);padding:0 10px;border-radius:6px;font:600 16px 'Barlow Condensed',var(--ui-font,sans-serif)";
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // the text keeps its cursor (and, on a tablet, its keyboard)
      b.addEventListener('click', () => insertChord(name));
      chordRow.append(b);
    }
    const other = document.createElement('input'); other.type = 'text'; other.setAttribute('data-sheet-other', ''); other.placeholder = label('lyrics.sheet.other'); other.setAttribute('autocomplete', 'off'); other.setAttribute('autocapitalize', 'off'); other.spellcheck = false;
    other.style.cssText = 'width:7em;min-height:var(--ui-target,36px);box-sizing:border-box;padding:0 8px;font:16px var(--ui-font,sans-serif);background:var(--field,#fff);color:var(--ink,#000);border:1px solid var(--field-edge,#767676);border-radius:8px';
    other.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); insertChord(other.value); other.value = ''; } });
    const add = mk(label('lyrics.sheet.put'), 'sheet-put', () => { insertChord(other.value); other.value = ''; }); add.style.padding = '0 10px';
    add.addEventListener('pointerdown', (e) => e.preventDefault());
    chordRow.append(other, add);
  };
  const drawPreview = () => {
    preview.replaceChildren();
    const lines = freeSheetLines(area.value, 0);
    if (!lines.length) { const none = document.createElement('div'); none.textContent = label('lyrics.sheet.empty'); none.style.cssText = 'padding:12px;opacity:.6'; preview.append(none); return; }
    preview.append(drawSongbook({ verses: [{ verse: current, lines }], hasLyrics: true }, { width: Math.max(280, preview.clientWidth || 600), fontPx: 18, margin: 10, chords: 'all' }).box);
  };

  const okBtn = mk(label('lyrics.adjust.apply'), 'sheet-apply', () => {
    try { app.writeFreeSheet(current, area.value); close(); } catch (e) { message.textContent = String(e?.message ?? e); }
  });
  const load = () => {
    message.textContent = '';
    info = app.freeSheetOf(current);
    verseLabel.textContent = label('lyrics.verse', { n: current + 1 });
    const blocked = info.state === 'linked' || info.state === 'grid';
    area.value = info.text; area.disabled = blocked; okBtn.disabled = blocked;
    if (blocked) message.textContent = label(info.state === 'linked' ? 'lyrics.sheet.linked' : 'lyrics.sheet.grid');
    drawChords(); drawPreview();
  };
  const stepBtn = (text, delta, act) => { const b = mk(text, act, () => { current = Math.max(0, current + delta); load(); }); b.style.padding = '0 10px'; return b; };
  area.addEventListener('input', drawPreview);
  area.addEventListener('keydown', (e) => { e.stopPropagation(); });
  head.append(title, stepBtn('−', -1, 'sheet-verse-down'), verseLabel, stepBtn('+', 1, 'sheet-verse-up'));
  row.append(mk(label('lyrics.cancel'), 'sheet-cancel', close), okBtn);
  box.append(head, hint, area, chordRow, preview, message, row);
  veil.append(box);
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  load();
  area.focus({ preventScroll: true });
  return { close };
}
