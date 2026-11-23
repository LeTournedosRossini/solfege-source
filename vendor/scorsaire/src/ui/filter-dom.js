/*
 * Feuille du filtre de sélection (DOM). Trois sections comme le panneau « Filtre de sélection » de MuseScore 4.7.5 (voix, notes d'un
 * accord, éléments), chacune avec « tout / rien ». Cases = boutons à bascule de 44 px (tablette). L'élément est posé par `dom.js` en
 * position absolue dans la partition (flottant : le SVG ne bouge jamais).
 */
import { ELEMENT_CATEGORIES, NOTE_FILTER_IDS, normalizeFilter, setFilterFlag, setFilterGroup } from '../model/selectionfilter.js';

/**
 * Construit la feuille. `onChange(nouveauFiltre)` est appelé à chaque case ; `onClose()` pour la croix. `contents` (facultatif, `rangeContents`) : ce que la plage
 * contient ; une case dont la catégorie est PRÉSENTE porte un « ● », une catégorie absente est estompée (elle reste réglable).
 */
export function buildFilterSheet({ filter, label, onChange, onClose, contents = null }) {
  const f = normalizeFilter(filter);
  const sheet = document.createElement('div');
  sheet.setAttribute('data-filter-sheet', '');
  sheet.setAttribute('data-zoom-lock-inline', '');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', label('filter.title'));
  sheet.style.cssText = 'position:absolute;left:0;top:0;z-index:60;display:flex;flex-direction:column;gap:8px;width:max-content;max-width:100%;max-height:70vh;overflow:auto;padding:8px 10px;font:14px var(--ui-font,sans-serif);background:var(--field,#fff);border:1px solid rgba(0,0,0,0.25);border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.3);box-sizing:border-box';
  const btn = (text, title, fn, extra = {}) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);padding:0 10px';
    b.addEventListener('click', fn);
    for (const [k, v] of Object.entries(extra)) b.setAttribute(k, v);
    return b;
  };
  const presentOf = (group, key) => (contents ? Boolean(group === 'voices' ? contents.voices[key] : contents[group]?.[key]) : null);
  const toggle = (text, title, group, key, included) => {
    const present = presentOf(group, key);
    const shown = present ? `● ${text}` : text;
    const b = btn(shown, present === null ? title : `${title} — ${label(present ? 'filter.present' : 'filter.absent')}`, () => onChange(setFilterFlag(f, group, key, !included)), { 'data-filter': `${group}/${key}`, 'aria-pressed': String(included), ...(present === null ? {} : { 'data-present': String(present) }) });
    if (present === false) b.style.cssText += ';border-style:dashed;color:var(--ink-soft,#666)';
    if (included) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid #2a6fd6;font-weight:var(--w-bold,700)';
    else b.style.cssText += ';opacity:0.55;text-decoration:line-through';
    return b;
  };
  const section = (titleKey, group, buttons) => {
    const box = document.createElement('div');
    box.setAttribute('data-filter-section', group);
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:var(--btn-gap,2px);align-items:center;flex-wrap:wrap;margin-bottom:4px';
    const t = document.createElement('strong'); t.textContent = label(titleKey); t.style.flex = '1';
    head.append(t,
      btn('✓', label('filter.all'), () => onChange(setFilterGroup(f, group, true)), { 'data-filter-all': group }),
      btn('✗', label('filter.none'), () => onChange(setFilterGroup(f, group, false)), { 'data-filter-none': group }));
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap';
    row.append(...buttons);
    box.append(head, row);
    return box;
  };
  const top = document.createElement('div');
  top.style.cssText = 'display:flex;align-items:center;gap:var(--btn-gap,2px)';
  const title = document.createElement('strong'); title.textContent = label('filter.title'); title.style.flex = '1';
  const legend = contents ? Object.assign(document.createElement('div'), { textContent: label('filter.legend') }) : null;
  if (legend) legend.style.cssText = 'font-size:12px;color:var(--ink-soft,#555)';
  top.append(title, btn('✕', label('filter.close'), onClose, { 'data-filter-close': '' }));
  sheet.append(top, ...(legend ? [legend] : []),
    section('filter.voices', 'voices', [0, 1, 2, 3].map((i) => toggle(String(i + 1), label('filter.voice', { n: i + 1 }), 'voices', i, f.voices[i]))),
    section('filter.notes', 'notes', [
      ...NOTE_FILTER_IDS.map((k) => toggle(label(`filter.note.${k}`), label(`filter.note.${k}.title`), 'notes', k, f.notes[k])),
      toggle(label('filter.note.single'), label('filter.note.single.title'), 'notes', 'single', f.notes.single),
    ]),
    section('filter.elements', 'elements', ELEMENT_CATEGORIES.map((c) => toggle(label(`filter.cat.${c.id}`), label(`filter.cat.${c.id}`), 'elements', c.id, f.elements[c.id]))));
  return sheet;
}
