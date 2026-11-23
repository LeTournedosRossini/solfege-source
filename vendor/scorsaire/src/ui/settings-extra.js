/*
 * The sections of the settings panel for the options that used to sit in the page header (display, interface, demonstrations, audio). Each row reads its
 * value when the panel is drawn and writes it back through the page settings.
 * `menus`: { ctl: { get(), pick(v) }, options, titleKey }; `toggles`: { get(), set(v), labelKey }; `numbers`: { get(), set(n), min, max, step, labelKey }.
 */
import { createSwitch } from './switch.js';
import { createChoiceMenu } from './choice-menu.js';
import { cleanEntry, remember, forget, rename, entryLabel } from '../export/githubrepos.js';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v === true ? '' : String(v)); }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};

/** The user manual, published with the Lecteur (French and English in one page). */
export const MANUAL_URL = 'https://letournedosrossini.github.io/scorsaire-lecteur/manuel/';

export function buildExtraSections({ label, display, device, demos, audioEl = null, strumEl = null, audition = [], colorsEl = null, debug = null, github = null }) {
  const menuRow = (m) => el('div', { class: 'st-row', 'data-extra': m.id }, el('span', { class: 'st-label' }, label(m.titleKey)),
    createChoiceMenu({ options: m.options, value: m.ctl.get(), label: label(m.titleKey), act: `settings-${m.id}`, follow: true, onPick: (v) => m.ctl.pick(v) }));
  const toggleRow = (t) => {
    const box = createSwitch({ checked: !!t.get(), text: label(t.labelKey), attrs: { 'data-extra-toggle': t.id } });
    box.addEventListener('change', () => t.set(box.checked));
    return el('div', { class: 'st-row' }, box);
  };
  const numberRow = (n) => {
    const field = el('input', { type: 'number', 'data-extra-number': n.id, min: n.min, max: n.max, step: n.step, style: 'width:6em;font-size:16px;min-height:var(--sp-target,30px);box-sizing:border-box' });
    field.value = n.get();
    field.addEventListener('change', () => { n.set(Number(field.value)); field.value = n.get(); });
    return el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label(n.labelKey)), field);
  };
  const buttonRow = (b) => {
    const open = el('button', { type: 'button', 'data-extra-button': b.id, style: 'min-height:var(--ui-target,44px);padding:0 12px;cursor:pointer' }, label(b.textKey));
    open.addEventListener('click', b.run);
    return el('div', { class: 'st-row', 'data-extra': b.id }, el('span', { class: 'st-label' }, label(b.titleKey)), open);
  };
  const section = (id, ...rows) => el('section', { class: 'st-section', 'data-section': id }, el('h3', {}, label(`settings.section.${id}`)), ...rows);
  const out = [
    section('display', ...display.menus.map(menuRow), ...display.numbers.map(numberRow), ...display.toggles.map(toggleRow)),
    section('interface', ...device.menus.map(menuRow), ...(device.buttons ?? []).map(buttonRow)),
  ];
  if (github) out.push(githubSection({ label, ...github }));
  if (colorsEl) out.push(colorsEl);
  if (audioEl || audition.length || strumEl) {
    const rows = [];
    for (const a of audition ?? []) { // hear the notes as they are placed / selected (device settings, on by default)
      const box = createSwitch({ checked: !!a.get(), text: label(a.labelKey), attrs: { 'data-extra-toggle': a.id } });
      box.addEventListener('change', () => a.set(box.checked));
      rows.push(el('div', { class: 'st-row' }, box));
    }
    if (audioEl) rows.push(audioEl);
    if (strumEl) rows.push(strumEl);
    out.push(section('audio', ...rows));
  }
  out.push(section('demos', ...demos.menus.map(menuRow)));
  out.push(section('help', buttonRow({ id: 'manual', titleKey: 'settings.help.manual', textKey: 'settings.help.open', run: () => window.open(MANUAL_URL, '_blank', 'noopener') })));
  // credits of what is borrowed (the scale pack: the Berklee and CAGED positions are checked against the diagrams of Jens Larsen)
  out.push(section('credits', el('p', { class: 'st-hint', 'data-credit': 'scales', style: 'font-size:13px;margin:0' }, label('scales.credit'))));
  if (debug?.probe) out.push(section('debug', el('div', { class: 'st-row' }, el('button', { type: 'button', 'data-extra': 'color-probe', onclick: () => debug.probe.open() }, label('probe.open')), el('span', { style: 'font-size:12px;opacity:.75;margin-left:8px' }, label('probe.hint')))));
  return out;
}

/**
 * « GitHub repositories »: the list kept on the device for « Publish on GitHub » and « Send to another teacher » — a short name each, the address to copy, the repository page to open, a button to
 * take one off, and a row to add one. It draws itself again after every change.
 * @param o.get   () → the list [{ repo, folder, name? }]
 * @param o.save  (list) → the list kept
 * @param o.copy  (text) → void ; o.open (url) → void
 */
function githubSection({ label, get, save, copy, open }) {
  const box = el('section', { class: 'st-section', 'data-section': 'github' });
  const btn = (act, text, run) => el('button', { type: 'button', 'data-act': act, style: 'min-height:var(--ui-target,44px);padding:0 12px;cursor:pointer', onclick: run }, text);
  const input = (act, placeholder, value = '') => { const i = el('input', { type: 'text', 'data-field': act, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: 'min-height:var(--ui-target,44px);box-sizing:border-box;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:15px var(--ui-font,sans-serif);min-width:0;flex:1 1 9em' }); i.value = value; i.addEventListener('keydown', (e) => e.stopPropagation()); return i; };
  function draw() {
    const list = get();
    const rows = list.map((e) => {
      const name = input('github-name', label('settings.github.namePlaceholder'), e.name ?? '');
      name.addEventListener('change', () => { save(rename(get(), e, name.value)); draw(); });
      return el('div', { class: 'st-row', 'data-github-repo': e.repo, style: 'flex-wrap:wrap;gap:var(--btn-gap,4px)' },
        el('span', { class: 'st-label', style: 'flex:1 1 12em;word-break:break-all' }, entryLabel({ ...e, name: '' })), name,
        btn('github-copy', label('settings.github.copy'), () => copy(`https://github.com/${e.repo}`)),
        btn('github-open', label('settings.github.open'), () => open(`https://github.com/${e.repo}`)),
        btn('github-forget', label('settings.github.forget'), () => { save(forget(get(), e)); draw(); }));
    });
    const repo = input('github-new-repo', label('settings.github.repoPlaceholder'));
    const folder = input('github-new-folder', label('settings.github.folderPlaceholder'));
    const msg = el('span', { 'data-github-msg': '', style: 'font-size:12px;color:var(--danger-ink,#a33);min-height:1.2em' });
    const add = btn('github-add', label('settings.github.add'), () => {
      const e = cleanEntry({ repo: repo.value, folder: folder.value });
      if (!e) { msg.textContent = label('settings.github.bad'); return; }
      save(remember(get(), e)); draw();
    });
    box.replaceChildren(el('h3', {}, label('settings.section.github')), el('p', { class: 'st-hint', style: 'font-size:13px;margin:0 0 4px' }, label(list.length ? 'settings.github.hint' : 'settings.github.none')), ...rows,
      el('div', { class: 'st-row', style: 'flex-wrap:wrap;gap:var(--btn-gap,4px)' }, repo, folder, add), msg);
  }
  draw();
  return box;
}
