/*
 * Dialog shown when an analysed song is opened: « create a staff for each stem? ». One row per stem with a menu of what to create (default from the name of the
 * stem); resolves to [{ stem, kind }] or null (nothing is created). Bottom sheet on phones / tablets, centred window on a computer. Writes nothing itself.
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { createChoiceMenu } from './choice-menu.js';
import { defaultKind, STEM_KINDS } from './sync-tracks.js';

export function askStemTracks({ stems, label = (k) => k }) {
  return new Promise((resolve) => {
    const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
    const veil = document.createElement('div');
    veil.setAttribute('data-stem-tracks', ''); veil.setAttribute('data-zoom-lock', '');
    veil.style.cssText = `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`;
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', label('syncTracks.title'));
    box.style.cssText = `background:var(--paper,#fff);color:var(--ink,#111);padding:16px;font:15px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;max-height:88vh;overflow:auto;${sheet ? 'width:100%;border-radius:12px 12px 0 0' : 'max-width:92vw;width:460px;border-radius:10px'}`;
    const title = document.createElement('div'); title.textContent = label('syncTracks.title'); title.style.cssText = 'font-weight:var(--w-bold,700);margin-bottom:4px';
    const help = document.createElement('div'); help.textContent = label('syncTracks.help'); help.style.cssText = 'font-size:13px;color:var(--ink-soft,#555);margin-bottom:10px;line-height:1.35';
    const rows = document.createElement('div'); rows.style.cssText = 'display:flex;flex-direction:column;gap:var(--btn-gap,2px)';
    const choices = stems.map((s) => ({ stem: s.name, kind: defaultKind(s.name) }));
    const options = Object.keys(STEM_KINDS).map((k) => [k, label(`syncTracks.kind.${k}`)]);
    choices.forEach((c) => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:space-between'; row.setAttribute('data-stem-row', c.stem);
      const name = document.createElement('span'); name.textContent = c.stem; name.style.cssText = 'font-weight:var(--w-semi,600);min-width:90px';
      const menu = createChoiceMenu({ options, value: c.kind, label: c.stem, act: `stem-kind-${c.stem}`, follow: true, onPick: (v) => { c.kind = v; } });
      menu.style.flex = '1 1 auto';
      row.append(name, menu); rows.append(row);
    });
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:var(--btn-gap,2px);justify-content:flex-end;margin-top:14px';
    const mk = (text, act, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('data-act', act); b.style.cssText = 'min-height:var(--ui-target,44px);padding:0 16px;font:var(--w-semi,600) 14px sans-serif;border:1px solid #888;border-radius:6px;cursor:pointer'; b.addEventListener('click', fn); return b; };
    let done = false;
    const finish = (v) => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    const ok = mk(label('syncTracks.create'), 'create', () => finish(choices.map((c) => ({ ...c }))));
    ok.style.background = 'var(--btn-on,#d6e6ff)';
    bar.append(mk(label('syncTracks.skip'), 'skip', () => finish(null)), ok);
    box.append(title, help, rows, bar); veil.append(box);
    window.addEventListener('keydown', onKey, true);
    document.body.append(veil);
  });
}
