/*
 * Import report (DOM): after a file was imported, lists what the importer ignored or approximated, so nothing is lost silently.
 * A centred dialog on desktop, a sheet from the bottom on phones and tablets; in <body>, so the score never moves; `aria-modal` keeps the
 * note-entry shortcuts away. `report` = { items: [{ level, code, message, count, data }], stats } (src/import/report.js); `problems` = validation errors.
 */
import { SHEET_QUERY } from './panel-mode.js';

const STYLE_ID = 'import-report-style';
const CSS = `
[data-import-report] { position: fixed; z-index: 1000; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 4px 20px rgba(0,0,0,.35); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; padding: 12px; display: flex; flex-direction: column; gap: 10px; --ir-target: var(--ui-target, 30px); }
[data-import-report][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); max-height: 80vh; overflow: auto; border-radius: 12px 12px 0 0; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
[data-import-report][data-mode="floating"] { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 560px; max-width: calc(100vw - 16px); max-height: calc(100vh - 32px); overflow: auto; border-radius: 8px; }
[data-import-report] h2 { margin: 0; font-size: 15px; }
[data-import-report] p { margin: 0; }
[data-import-report] ul { margin: 0; padding-left: 18px; }
[data-import-report] li[data-level="warning"]::marker { color: var(--warn-ink,#b45309); }
[data-import-report] .ir-count { color: var(--ink-soft,#555); margin-left: 6px; }
[data-import-report] .ir-actions { display: flex; gap: var(--btn-gap, 2px); justify-content: flex-end; }
[data-import-report] button { min-width: var(--ir-target); min-height: var(--ir-target); padding: 0 14px; font: inherit; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
};

/** Text of one report line: a translated message for the code when the catalogue has one, else the importer's own English message. */
export function reportLineText(item, label) {
  const generic = item.data?.kind ? label('import.ignored', { name: item.data.name, kind: label(`import.kind.${item.data.kind}`) }) : null;
  const key = `import.code.${item.code}`;
  const own = label(key);
  return own !== key ? own : (generic && generic !== 'import.ignored' ? generic : item.message);
}

/** Opens the report. `label(key, params)` resolves a text. Returns { close() }. */
export function openImportReport({ report, problems = [], title, label, onClose, summaryKey = 'import.summary' }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  const sheet = window.matchMedia ? window.matchMedia(SHEET_QUERY).matches : false;
  const keyHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  function close() { window.removeEventListener('keydown', keyHandler, true); dialog.remove(); onClose?.(); }
  const stats = report.stats ?? {};
  const lines = report.items.map((item) => el('li', { 'data-level': item.level, 'data-code': item.code },
    reportLineText(item, label), item.count > 1 ? el('span', { class: 'ir-count' }, `× ${item.count}`) : null));
  const dialog = el('div', { 'data-import-report': '', 'data-resizable': 'importReport', 'data-zoom-lock': '', 'data-mode': sheet ? 'sheet' : 'floating', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('h2', {}, title),
    el('p', {}, label(summaryKey, { measures: stats.measures ?? 0, tracks: stats.tracks ?? 0 })),
    ...Object.entries(stats).filter(([k]) => label(`import.stat.${k}`) !== `import.stat.${k}`).map(([k, v]) => el('p', { 'data-stat': k }, label(`import.stat.${k}`, { n: v }))),
    problems.length ? el('p', { 'data-problems': '' }, label('import.problems', { count: problems.length })) : null,
    problems.length ? el('ul', {}, problems.slice(0, 8).map((p) => el('li', { 'data-level': 'warning' }, p))) : null,
    lines.length ? el('ul', { 'data-report-list': '' }, lines) : el('p', { 'data-report-empty': '' }, label('import.none')),
    el('div', { class: 'ir-actions' }, el('button', { type: 'button', 'data-act': 'import-close', onclick: close }, label('import.close'))));
  window.addEventListener('keydown', keyHandler, true);
  document.body.append(dialog);
  dialog.querySelector('[data-act="import-close"]').focus({ preventScroll: true });
  return { close };
}
