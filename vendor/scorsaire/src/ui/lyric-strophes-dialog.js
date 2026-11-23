/*
 * The window « Lyrics by strophes » (screen 2): the strophes of a lyrics part as blocks of text the user can fix by hand. Each strophe = a card of structure (category and
 * label) and its lines in a text area, one line per line. A phrase that belongs to the next strophe is cut and pasted there; « Cut here » splits a strophe at the cursor,
 * « Join » puts a strophe at the end of the previous one. Nothing is written until « Apply » (one undoable change); the part stays AUTOMATIC (following the lyrics track) when
 * the text is the one proposed from the track, and becomes FIXED as soon as it differs.
 *
 *   openLyricStrophesDialog({ app, label, partId, onApply })
 *
 * Bottom sheet on phones and tablets, centred window on desktop. The only DOM of the feature besides the section of the part's properties.
 */
import { SECTION_CATEGORIES, SECTION_NAMES } from '../model/sections.js';
import { cleanStrophes } from '../model/lyricstrophes.js';
import { createChoiceMenu } from './choice-menu.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

export function openLyricStrophesDialog({ app, label, partId, onApply = () => {} }) {
  const info = app.lyricsPageInfo(partId);
  if (!info) return null;
  const names = SECTION_NAMES[app.lang] ?? SECTION_NAMES.fr;
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const draft = info.strophes.map((s) => ({ ...s, card: s.card ? { ...s.card } : null, lines: [...s.lines] }));
  let seq = draft.length;
  let closed = false;
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-strophes-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(760px,100vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:10px;${sheet ? 'border-radius:12px 12px 0 0' : 'border-radius:12px'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('strophes.title') });
  if (!sheet) box.setAttribute('data-resizable', 'strophes');
  veil.append(box);
  const finish = (apply) => {
    if (closed) return; closed = true;
    window.removeEventListener('keydown', onKey, true); veil.remove();
    if (apply) { app.setLyricsPageStrophes(partId, cleanStrophes(draft)); onApply(); }
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) finish(false); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, primary = false, disabled = false) => {
    const b = el('button', `min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary ? 'background:var(--primary,#1c1b1a);color:var(--primary-ink,#fff);border:1px solid var(--primary,#1c1b1a)' : 'border:1px solid var(--edge,#999);background:var(--field,#fff);color:var(--ink,#111)'};${disabled ? 'opacity:.5' : ''}`, { type: 'button', 'data-strophe-act': act });
    b.textContent = text; b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  /** The text areas hold the truth while the user types: copy them to the draft before any structural change. */
  const sync = () => box.querySelectorAll('[data-strophe-lines]').forEach((ta) => {
    const s = draft.find((x) => x.id === ta.getAttribute('data-strophe-lines'));
    if (s) s.lines = ta.value.split('\n');
  });
  const catName = (c) => names[c] ?? c;

  function draw() {
    const head = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); head.textContent = label('strophes.title');
    const intro = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); intro.textContent = label(info.hasSource ? 'strophes.intro' : 'strophes.introNone');
    const tools = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px)');
    tools.append(
      mk(label('strophes.auto'), 'auto', () => { sync(); draft.splice(0, draft.length, ...info.auto.map((s) => ({ ...s, card: s.card ? { ...s.card } : null, lines: [...s.lines] }))); seq = draft.length; draw(); }, false, !info.hasSource),
      mk(label('strophes.freeText'), 'free', () => { sync(); draft.splice(0, draft.length, ...info.free.map((s) => ({ ...s, card: s.card ? { ...s.card } : null, lines: [...s.lines] }))); seq = draft.length; draw(); }, false, !info.hasFreeText),
      mk(label('strophes.add'), 'add', () => { sync(); seq += 1; draft.push({ id: `st${seq}x`, card: { category: 'verse', label: names.verse }, lines: [''] }); draw(); }),
    );
    const list = el('div', 'display:flex;flex-direction:column;gap:10px');
    draft.forEach((s, i) => {
      const card = s.card ? el('span', `padding:2px 8px;border-radius:5px;background:${cardColor(s.card)};color:#111;font-size:12px`) : null;
      if (card) card.textContent = s.card.label || catName(s.card.category);
      const kind = createChoiceMenu({
        options: [['', label('strophes.noCard')], ...SECTION_CATEGORIES.filter((c) => c !== 'letter' && c !== 'custom').map((c) => [c, catName(c)])],
        value: s.card?.category ?? '', label: label('strophes.card'), act: 'strophe-card', follow: true,
        onPick: (c) => { sync(); s.card = c ? { category: c, label: (s.card && s.card.category === c && s.card.label) || catName(c) } : null; draw(); },
      });
      const name = el('input', 'flex:1 1 8em;min-width:6em;min-height:var(--ui-target,36px);border-radius:8px;border:1px solid var(--field-edge,#767676);padding:0 8px;font:14px var(--ui-font,sans-serif);background:var(--field,#fff);color:var(--ink,#111)', { type: 'text', 'data-strophe-name': s.id, maxlength: '40', 'aria-label': label('strophes.cardName') });
      name.value = s.card?.label ?? ''; name.disabled = !s.card;
      name.addEventListener('input', () => { if (s.card) { s.card.label = name.value; if (card) card.textContent = name.value || catName(s.card.category); } });
      const row = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center');
      row.append(el('strong', 'min-width:1.5em'), kind, name);
      row.firstChild.textContent = `${i + 1}.`;
      if (card) row.append(card);
      const move = (d) => () => { sync(); const to = i + d; if (to < 0 || to >= draft.length) return; [draft[i], draft[to]] = [draft[to], draft[i]]; draw(); };
      row.append(mk('▲', 'up', move(-1), false, i === 0), mk('▼', 'down', move(1), false, i === draft.length - 1), mk('✕', 'remove', () => { sync(); draft.splice(i, 1); draw(); }));
      const ta = el('textarea', 'width:100%;box-sizing:border-box;min-height:5.5em;border-radius:8px;border:1px solid var(--field-edge,#767676);padding:6px 8px;font:14px/1.4 var(--ui-font,sans-serif);background:var(--field,#fff);color:var(--ink,#111);resize:vertical', { 'data-strophe-lines': s.id, rows: String(Math.max(3, Math.min(10, s.lines.length + 1))), 'aria-label': label('strophes.lines') });
      ta.value = s.lines.join('\n');
      const ops = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px)');
      ops.append(
        mk(label('strophes.cut'), 'cut', () => { // splits the strophe at the start of the line holding the cursor
          sync();
          const upto = ta.value.slice(0, ta.selectionStart);
          const k = upto.split('\n').length - 1; // index of the line with the cursor
          if (k <= 0 || k >= s.lines.length) return;
          seq += 1;
          draft.splice(i + 1, 0, { id: `st${seq}x`, card: s.card ? { category: s.card.category, label: s.card.label } : null, lines: s.lines.slice(k) });
          s.lines = s.lines.slice(0, k); draw();
        }),
        mk(label('strophes.join'), 'join', () => { sync(); if (i === 0) return; draft[i - 1].lines.push(...s.lines); draft.splice(i, 1); draw(); }, false, i === 0),
      );
      list.append(el('div', 'display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--edge,#bbb);border-radius:8px', { 'data-strophe': s.id }));
      list.lastChild.append(row, ta, ops);
    });
    const empty = el('div', 'font-size:13px;color:var(--ink-soft,#555)'); empty.textContent = draft.length ? '' : label('strophes.empty');
    const actions = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);position:sticky;bottom:-12px;background:var(--paper,#faf8f4);padding:6px 0;border-top:1px solid var(--edge,#bbb)');
    actions.append(mk(label('strophes.apply'), 'apply', () => { sync(); finish(true); }, true), mk(label('strophes.cancel'), 'cancel', () => finish(false)));
    box.replaceChildren(head, intro, tools, empty, list, actions);
  }
  const cardColor = (card) => app.strophesCardColor(card);
  document.body.append(veil);
  draw();
  return { close: () => finish(false) };
}
