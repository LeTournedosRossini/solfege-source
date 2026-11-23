/*
 * Template picker (DOM): load the tracks of a kind of score (MuseScore's templates, then the user's own), save the current tracks as a
 * template, export / import the user's templates. A centred dialog on desktop, a sheet from the bottom on phones and tablets; in <body>
 * (the score never moves); `aria-modal` keeps the note-entry shortcuts away.
 * Returns { open({ movements }), close(), isOpen() }.
 */
import { SHEET_QUERY } from './panel-mode.js';
import { createChoiceMenu } from './choice-menu.js';
import { dismissOnOutside } from './outside-dismiss.js';

const STYLE_ID = 'template-picker-style';
const CSS = `
[data-template-picker] { position: fixed; z-index: 1000; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 4px 20px rgba(0,0,0,.35); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; display: flex; flex-direction: column; --tpk-target: var(--ui-target, 30px); }
[data-template-picker][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); height: min(85vh, 700px); border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom); }
[data-template-picker][data-mode="floating"] { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 560px; max-width: calc(100vw - 16px); height: min(700px, calc(100vh - 32px)); border-radius: 8px; }
[data-template-picker] .tk-head { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 6px 6px 6px 12px; background: var(--soft,#f1f1f1); border-bottom: 1px solid var(--edge,#ccc); }
[data-template-picker] .tk-title { flex: 1 1 auto; font-weight: var(--w-semi,600); }
[data-template-picker] .tk-controls { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); align-items: center; padding: 8px; border-bottom: 1px solid var(--line,#ddd); }
[data-template-picker] .tk-controls label { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tpk-target); }
[data-template-picker] button { min-width: var(--tpk-target); min-height: var(--tpk-target); padding: 0 10px; font: inherit; }
[data-template-picker] .tk-list { flex: 1 1 auto; overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); }
[data-template-picker] .tk-item { text-align: left; border: 1px solid var(--edge,#ccc); border-radius: 8px; background: var(--soft,#fafafa); display: flex; justify-content: space-between; gap: var(--btn-gap, 2px); align-items: center; }
[data-template-picker] .tk-item[aria-pressed="true"] { border-color: var(--ink,#1c1b1a); background: var(--soft,#eef0f4); font-weight: var(--w-semi,600); }
[data-template-picker] .tk-meta { color: var(--ink-soft,#666); font-size: 12px; white-space: nowrap; }
[data-template-picker] .tk-preview { padding: 8px 12px; background: var(--soft,#f7f7f7); border-top: 1px solid var(--line,#ddd); max-height: 28%; overflow: auto; font-size: 13px; }
[data-template-picker] .tk-actions, [data-template-picker] .tk-save { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); align-items: center; padding: 8px; border-top: 1px solid var(--line,#ddd); }
[data-template-picker] .tk-save input[type="text"] { flex: 1 1 10em; min-width: 0; min-height: var(--tpk-target); box-sizing: border-box; padding: 0 8px; font: 16px var(--ui-font,sans-serif); border: 1px solid var(--edge,#888); border-radius: 6px; }
[data-template-picker] .tk-status { min-height: 18px; padding: 2px 12px; color: var(--ok-ink,#1a5c1a); }
[data-template-picker] .tk-status[data-error] { color: var(--danger-ink,#b00020); }
[data-template-picker] .tk-note { color: var(--ink-soft,#666); padding: 6px 2px; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.flat().filter((x) => x != null));
  return e;
};

/**
 * @param app      Application (templateCatalog, applyTemplate, saveTemplate, deleteTemplate, exportTemplates, importTemplates)
 * @param label    (key, params) → text
 * @param onDone   called after a template was loaded (the panel redraws)
 */
export function createTemplatePicker({ app, label = (k) => k, onDone = () => {} }) {
  if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let dialog = null;
  let keyHandler = null;
  let state = null;
  let offOutside = null;

  function close() {
    offOutside?.(); offOutside = null;
    if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
    dialog?.remove();
    dialog = null;
    state = null;
  }
  const say = (text, error = false) => { const s = dialog?.querySelector('.tk-status'); if (s) { s.textContent = text; if (error) s.setAttribute('data-error', ''); else s.removeAttribute('data-error'); } };
  const errorText = (e) => (e.name === 'TemplateError' ? label(`templates.error.${e.code}`) : e.message);

  const download = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  function draw() {
    const catalog = app.templateCatalog();
    const mine = { id: '__mine', title: label('templates.mine'), templates: catalog.user };
    const groups = [...catalog.categories, mine];
    if (!groups.some((g) => g.id === state.category)) state.category = groups[0].id;
    const current = groups.find((g) => g.id === state.category);
    const selected = current.templates.find((t) => t.id === state.selected) ?? null;
    if (!selected) state.selected = null;

    const categoryButton = createChoiceMenu({ options: groups.map((g) => [g.id, `${g.title}${g.id === '__mine' ? ` (${catalog.user.length})` : ''}`]), value: state.category, label: label('templates.category'), act: 'template-category',
      onPick: (v) => { state.category = v; state.selected = null; draw(); } });
    const movementButton = state.movements.length > 1 ? createChoiceMenu({
      options: state.movements.map((m, i) => [i, m.title || label('tracks.movement', { n: i + 1 })]), value: state.movement, label: label('tracks.picker.movement'), act: 'template-movement',
      onPick: (v) => { state.movement = Number(v); draw(); } }) : null;
    const modeRadio = (value, text) => el('label', {}, el('input', { type: 'radio', name: 'template-mode', value, 'data-act': `template-mode-${value}`, checked: state.mode === value, onchange: () => { state.mode = value; } }), text);

    const list = el('div', { class: 'tk-list' },
      ...(current.templates.length ? current.templates.map((t) => el('button', { type: 'button', class: 'tk-item', 'data-template': t.id, 'aria-pressed': String(t.id === state.selected),
        onclick: () => { state.selected = t.id; draw(); } }, el('span', {}, t.title), el('span', { class: 'tk-meta' }, label('templates.tracks', { n: t.parts.length })))) : [el('div', { class: 'tk-note' }, label('templates.none'))]));
    const preview = el('div', { class: 'tk-preview' }, selected ? selected.parts.join(' · ') : label('templates.pick'));
    const actions = el('div', { class: 'tk-actions' },
      el('button', { type: 'button', 'data-act': 'template-load', disabled: !selected, onclick: () => {
        try {
          const res = app.applyTemplate(selected.id, { mode: state.mode, movement: state.movement });
          const skipped = res.skipped.length ? ` ${label('templates.skipped', { n: res.skipped.length })}` : '';
          onDone();
          close();
          void skipped;
        } catch (e) { say(errorText(e), true); }
      } }, label('templates.load')),
      selected && selected.source === 'user' ? el('button', { type: 'button', 'data-act': 'template-delete', onclick: () => {
        try { app.deleteTemplate(selected.id); state.selected = null; draw(); say(label('templates.deleted')); } catch (e) { say(errorText(e), true); }
      } }, label('templates.delete')) : null);

    const nameInput = el('input', { type: 'text', 'data-key': 'template-name', placeholder: label('templates.namePlaceholder'), 'aria-label': label('templates.namePlaceholder'), autocomplete: 'off', value: state.name, oninput: (e) => { state.name = e.target.value; } });
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-act': 'template-file', onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try { const n = app.importTemplates(await file.text()); state.category = '__mine'; draw(); say(label('templates.imported', { n })); } catch (err) { say(errorText(err), true); }
    } });
    const save = el('div', { class: 'tk-save' },
      nameInput,
      el('button', { type: 'button', 'data-act': 'template-save', onclick: () => {
        try { const id = app.saveTemplate(state.name, { movement: state.movement }); state.category = '__mine'; state.selected = id; state.name = ''; draw(); say(label('templates.saved')); } catch (e) { say(errorText(e), true); }
      } }, label('templates.save')),
      el('button', { type: 'button', 'data-act': 'template-export', onclick: () => {
        try { download(app.exportTemplates(), 'scorsaire-modeles.json'); } catch (e) { say(errorText(e), true); }
      } }, label('templates.export')),
      el('button', { type: 'button', 'data-act': 'template-import', onclick: () => fileInput.click() }, label('templates.import')),
      fileInput);

    const controls = el('div', { class: 'tk-controls' }, categoryButton, movementButton, modeRadio('add', label('templates.modeAdd')), modeRadio('replace', label('templates.modeReplace')));
    const status = el('div', { class: 'tk-status', role: 'status' });
    dialog.replaceChildren(
      el('div', { class: 'tk-head' }, el('span', { class: 'tk-title' }, label('templates.title')),
        el('button', { type: 'button', 'data-act': 'template-close', 'aria-label': label('tracks.close'), title: label('tracks.close'), onclick: close }, '✕')),
      controls, list, preview, actions, status, save);
  }

  function open({ movements = [{ title: '' }], movement = 0 } = {}) {
    close();
    state = { movements, movement, mode: 'add', category: null, selected: null, name: '' };
    const sheet = window.matchMedia ? window.matchMedia(SHEET_QUERY).matches : false;
    dialog = el('div', { 'data-template-picker': '', 'data-resizable': 'templatePicker', 'data-zoom-lock': '', 'data-mode': sheet ? 'sheet' : 'floating', role: 'dialog', 'aria-modal': 'true', 'aria-label': label('templates.title') });
    keyHandler = (e) => { if (e.key === 'Escape' && !document.querySelector('.cm-layer')) { e.stopPropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', keyHandler, true);
    document.body.append(dialog);
    offOutside = dismissOnOutside(() => dialog, close);
    draw();
  }
  return { open, close, isOpen: () => !!dialog };
}
