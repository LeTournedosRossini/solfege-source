/*
 * « Strum cards » section of the settings panel (Audio): list the cards (built in, mine, this project's), pick one to edit its playing values, add / duplicate /
 * delete, copy between "mine" (this device) and "this project" (the file). Built-in cards are read only (duplicate to change). A persistent element that keeps
 * itself up to date (document and preferences).
 */
import { groupedOptions, folderNames, folderField } from './menu-groups.js';
import { STRUM_CARD_FIELDS, PIANO_CARD_FIELDS, DRUM_CARD_FIELDS, ALT_CARD_FIELDS, STRUM_PATTERNS, APPROACH_KINDS, ABSENT_DEGREES, SLASH_BASS, SPACINGS, PIANO_FLAG_FIELDS } from '../model/strumcards.js';
import { createChoiceMenu } from './choice-menu.js';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v === true ? '' : String(v)); }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};

export function cardTitle(card, label) { return card.name || label(`strum.card.${card.id}`); }

export function mountStrumCardsSection({ app, label, startId = 'standard' }) {
  const root = el('div', { 'data-strum-cards': '', class: 'st-strum' });
  let selected = startId;
  let message = '';
  const run = (fn) => { try { fn(); message = ''; } catch (e) { message = e.message; } draw(); };
  const PLAIN = new Set(['upStrings', 'handLow', 'handHigh']);
  const fmt = (key, v) => (key === 'delayMs' ? (v === null ? label('staffProps.strum.auto') : `${v} ms`)
    : key === 'rollMs' ? `${v} ms` : key === 'staccatoDuration' ? `${Math.round(v * 1000)} ms` : key === 'approachBeats' ? label('strum.beats', { n: v })
    : PIANO_FLAG_FIELDS.includes(key) ? label(v ? 'strum.on' : 'strum.off') : PLAIN.has(key) ? String(v) : `${Math.round(v * 100)} %`);
  const fieldRow = (card, key, readOnly) => {
    const spec = STRUM_CARD_FIELDS[key] ?? PIANO_CARD_FIELDS[key] ?? DRUM_CARD_FIELDS[key] ?? ALT_CARD_FIELDS[key];
    const round = (v) => Math.round(v * 1000) / 1000;
    const set = (v) => run(() => app.saveStrumCard(card.source, { ...card, [key]: v }));
    const cur = card[key];
    const down = () => set(Math.max(spec.min, round((cur ?? 14) - spec.step)));
    const up = () => set(Math.min(spec.max, round((cur ?? 14) + spec.step)));
    return el('div', { class: 'st-row', 'data-field': key },
      el('span', { class: 'st-label' }, label(`strum.field.${key}`)),
      el('button', { type: 'button', 'aria-label': '−', disabled: readOnly || cur === spec.min, onclick: down }, '−'),
      el('span', { class: 'sp-value', 'data-value': key }, fmt(key, cur)),
      el('button', { type: 'button', 'aria-label': '+', disabled: readOnly || cur === spec.max, onclick: up }, '+'),
      key === 'delayMs' && cur !== null && !readOnly && el('button', { type: 'button', onclick: () => set(null) }, label('staffProps.strum.auto')));
  };
  function draw() {
    const cards = app.strumCards();
    if (!cards.some((c) => c.id === selected)) selected = 'standard';
    const card = cards.find((c) => c.id === selected);
    const readOnly = card.source === 'builtin';
    const menu = createChoiceMenu({
      options: groupedOptions(cards, { text: (c) => `${cardTitle(c, label)} · ${label(`strum.kind.${c.kind}`)}`, label, browse: label('strum.cards') }), value: selected, label: label('strum.cards'), act: 'strum-card',
      onPick: (id) => { selected = id; draw(); },
    });
    const copyTo = card.source === 'project' ? 'user' : 'project';
    const kids = [
      el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label('strum.cards')), menu),
      !readOnly && el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label('strum.name')),
        el('input', { type: 'text', 'data-key': 'strum-name', value: card.name ?? '', style: 'font-size:16px;min-height:var(--sp-target,30px);box-sizing:border-box;flex:1 1 10em',
          onchange: (e) => run(() => app.saveStrumCard(card.source, { ...card, name: e.target.value.trim() || null })) })),
      !readOnly && el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label('folder.label')), folderField({ value: card.folder ?? null, folders: folderNames(cards.filter((x) => x.source === card.source)), label, onChange: (f) => run(() => app.saveStrumCard(card.source, { ...card, folder: f })) })),
      card.kind === 'piano' && el('div', { class: 'st-row', title: label('strum.spacingHint') }, el('span', { class: 'st-label' }, label('strum.spacing')),
        ...SPACINGS.map((a) => el('button', { type: 'button', 'data-key': `strum-spacing-${a}`, 'aria-pressed': String((card.spacing ?? 'auto') === a), disabled: readOnly,
          onclick: () => run(() => app.saveStrumCard(card.source, { ...card, spacing: a })) }, label(`strum.spacing.${a}`)))),
      card.kind === 'piano' && el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label('strum.approach')),
        ...APPROACH_KINDS.map((a) => el('button', { type: 'button', 'data-key': `strum-approach-${a}`, 'aria-pressed': String(card.approach === a), disabled: readOnly,
          onclick: () => run(() => app.saveStrumCard(card.source, { ...card, approach: a })) }, label(`strum.approach.${a}`)))),
      card.kind !== 'drums' && el('div', { class: 'st-row', title: label('strum.absentHint') }, el('span', { class: 'st-label' }, label('strum.absent')),
        ...ABSENT_DEGREES.map((a) => el('button', { type: 'button', 'data-key': `strum-absent-${a}`, 'aria-pressed': String((card.absentDegree ?? 'skip') === a), disabled: readOnly,
          onclick: () => run(() => app.saveStrumCard(card.source, { ...card, absentDegree: a })) }, label(`strum.absent.${a}`)))),
      card.kind === 'strum' && el('div', { class: 'st-row', title: label('strum.slashBassHint') }, el('span', { class: 'st-label' }, label('strum.slashBass')),
        ...SLASH_BASS.map((a) => el('button', { type: 'button', 'data-key': `strum-slashbass-${a}`, 'aria-pressed': String((card.slashBass ?? 'follow') === a), disabled: readOnly,
          onclick: () => run(() => app.saveStrumCard(card.source, { ...card, slashBass: a })) }, label(`strum.slashBass.${a}`)))),
      card.kind === 'strum' && el('div', { class: 'st-row', title: label('strum.bassDegreeHint') }, el('span', { class: 'st-label' }, label('strum.bassDegree')),
        ...['', '3', '5', '7'].map((d) => el('button', { type: 'button', 'data-key': `strum-bassdegree-${d || 'none'}`, 'aria-pressed': String((card.bassDegree ?? '') === d), disabled: readOnly,
          onclick: () => run(() => app.saveStrumCard(card.source, { ...card, bassDegree: d || null })) }, label(`strum.bassDegree.${d || 'none'}`)))),
      card.kind === 'strum' && el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label('strum.pattern')),
        ...STRUM_PATTERNS.map((p) => el('button', { type: 'button', 'data-key': `strum-pattern-${p}`, 'aria-pressed': String(card.pattern === p), disabled: readOnly,
          onclick: () => run(() => app.saveStrumCard(card.source, { ...card, pattern: p })) }, label(`staffProps.strum.${p === 'down' ? 'down' : 'alternate'}`)))),
      ...(card.kind === 'drums' ? [...Object.keys(DRUM_CARD_FIELDS), 'structureBoost'] : [...Object.keys(card.kind === 'piano' ? PIANO_CARD_FIELDS : STRUM_CARD_FIELDS), ...Object.keys(ALT_CARD_FIELDS)]).map((k) => fieldRow(card, k, readOnly)),
      el('div', { class: 'st-row' },
        el('button', { type: 'button', 'data-key': 'strum-new', onclick: () => run(() => { selected = app.copyStrumCard(selected, 'user', { fresh: true, name: `${cardTitle(card, label)} (${label('strum.copySuffix')})` }).id; }) }, label('strum.duplicate')),
        !readOnly && el('button', { type: 'button', 'data-key': 'strum-copy', onclick: () => run(() => { selected = app.copyStrumCard(selected, copyTo).id; }) }, label(`strum.copyTo.${copyTo}`)),
        !readOnly && el('button', { type: 'button', 'data-key': 'strum-delete', onclick: () => run(() => { app.removeStrumCard(card.source, card.id); selected = 'standard'; }) }, label('strum.delete'))),
      message && el('div', { class: 'au-error', role: 'alert' }, message),
    ];
    root.replaceChildren(el('div', {}, el('h4', {}, label('strum.title')), el('div', { class: 'au-note' }, label('strum.hint')), ...kids));
  }
  app.doc.subscribe(() => { if (root.isConnected) draw(); });
  app.preferences.subscribe(() => { if (root.isConnected) draw(); });
  draw();
  return { el: root, redraw: draw };
}

/** The card editor in its own window (from a chord staff's properties, where the card of the staff is chosen): the same section as in the settings, opened on `startId`. */
export function openStrumCardsDialog({ app, label, startId = 'standard', onClose = null }) {
  const section = mountStrumCardsSection({ app, label, startId });
  const veil = el('div', { 'data-strum-cards-dialog': '', style: 'position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:center' });
  const box = el('div', { style: 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(560px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px' });
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  box.append(section.el, el('div', {}, el('button', { type: 'button', 'data-key': 'strum-dialog-close', onclick: close }, label('strum.bake.close'))));
  box.setAttribute('data-resizable', 'strumCards');
  veil.append(box);
  document.body.append(veil);
  section.redraw();
  return { close };
}
