/*
 * « Lyrics by strophes » of ONE part of screen 2 (model/lyricstrophes.js): a part that shows only the words of the lyrics track, written as blocks of text under their cards
 * of structure. A part without it is a normal part. This section only builds the controls; every change goes through `app` (undoable) and `run`.
 */
import { PID } from '../model/index.js';
import { isExtractPart } from '../model/extracts.js';
import { isLyricsPart } from '../model/lyricstrophes.js';
import { createChoiceMenu } from './choice-menu.js';
import { createSwitch } from './switch.js';
import { openLyricStrophesDialog } from './lyric-strophes-dialog.js';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};

/** @param o { app, label, part, run, numberField } — `run(fn)` runs a change and redraws; returns the nodes of the section. */
export function lyricsPageSection({ app, label, part, run, numberField }) {
  const info = app.lyricsPageInfo(part.id);
  const nodes = [el('h3', { 'data-lyrics-page-title': '' }, label('lyricsPage.title'))];
  if (!isLyricsPart(part)) {
    const blocked = isExtractPart(part);
    nodes.push(el('div', { class: 'ps-hint' }, label(blocked ? 'lyricsPage.blocked' : info.hasSource ? 'lyricsPage.hint' : 'lyricsPage.noSource')),
      el('div', { class: 'ps-row' }, el('button', { type: 'button', 'data-act': 'lyrics-page-on', disabled: blocked || !info.hasSource, onclick: () => run(() => app.enableLyricsPage(part.id)) }, label('lyricsPage.enable'))));
    return nodes;
  }
  const set = info.settings;
  nodes.push(el('div', { class: 'ps-hint', 'data-lyrics-page-state': '' }, label(info.fixed ? 'lyricsPage.fixed' : 'lyricsPage.auto')));
  const cols = createChoiceMenu({
    options: [['1', label('lyricsPage.col1')], ['2', label('lyricsPage.col2')]], value: String(set.columns), label: label('lyricsPage.columns'), act: 'lyrics-page-columns', follow: true,
    onPick: (v) => run(() => app.setLyricsPageSettings(part.id, { columns: Number(v) })),
  });
  const size = numberField(label('lyricsPage.size'), set.size, (n) => run(() => app.setLyricsPageSettings(part.id, { size: n })), { min: 6, max: 30 });
  size.setAttribute('data-field', 'lyrics-page-size');
  nodes.push(el('div', { class: 'ps-row' }, el('label', {}, label('lyricsPage.columns')), cols),
    el('div', { class: 'ps-row' }, el('label', {}, label('lyricsPage.size')), size),
    el('div', { class: 'ps-row' }, createSwitch({ checked: set.cards, text: label('lyricsPage.cards'), attrs: { 'data-field': 'lyrics-page-cards' }, onchange: (e) => run(() => app.setLyricsPageSettings(part.id, { cards: e.target.checked })) })),
    el('div', { class: 'ps-row' },
      el('button', { type: 'button', 'data-act': 'lyrics-page-edit', onclick: () => openLyricStrophesDialog({ app, label, partId: part.id, onApply: () => run(() => {}) }) }, label('lyricsPage.edit')),
      info.fixed ? el('button', { type: 'button', 'data-act': 'lyrics-page-auto', onclick: () => run(() => app.setLyricsPageStrophes(part.id, null)) }, label('lyricsPage.backAuto')) : null,
      el('button', { type: 'button', 'data-act': 'lyrics-page-off', onclick: () => run(() => app.disableLyricsPage(part.id)) }, label('lyricsPage.disable'))));
  return nodes;
}
