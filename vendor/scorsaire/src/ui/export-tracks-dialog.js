/*
 * « Tracks shown in the page »: before a page is exported, the author chooses which tracks it opens on (the others are hidden, the reader can still show them with the chips). A promise: resolves
 * with the ids of the tracks to show, or null when the person cancels. Starts from `tracks[i].shown` (what the editor shows) unless `chosen` (ids) is given — the choice made earlier in the session.
 */
import { createSwitch } from './switch.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

/** @param o.tracks [{ id, name, shown }] ; o.chosen ids | null ; o.label i18n lookup ; o.instruments null = the option is not offered, else its starting value (a keyboard / fretboard in the page). o.chords null = not offered, else { on, pool, pools: [{ id, name }] } (the chord strip, with the layer of fingerings the author fixes or 'reader'). Resolves { ids, instruments, chords: null | { pool } } or null. */
export function chooseExportTracks({ tracks, chosen = null, label, instruments = null, chords = null }) {
  return new Promise((resolve) => {
    const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
    const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    const veil = el('div', `position:fixed;inset:0;z-index:3600;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-export-tracks': '' });
    const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(460px,98vw);max-height:${sheet ? '90vh' : '92vh'};overflow:auto;display:flex;flex-direction:column;gap:8px;border-radius:${sheet ? '12px 12px 0 0' : '8px'}`);
    veil.append(box);
    const on = new Set(chosen ?? tracks.filter((t) => t.shown).map((t) => t.id));
    let wantInstruments = instruments === true; let wantChords = chords?.on === true; let chordPool = chords?.pool ?? 'reader'; let chordVariants = chords?.variants === 'all'; let chordGroups = ['sections', 'labels'].includes(chords?.groups) ? chords.groups : 'off';
    let finished = false;
    const finish = (value) => { if (finished) return; finished = true; window.removeEventListener('keydown', onKey, true); veil.remove(); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    window.addEventListener('keydown', onKey, true);
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) finish(null); });
    const btnCss = 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif)';
    const mk = (text, act, fn, primary = false) => { const b = el('button', `${btnCss}${primary ? ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}`, { type: 'button', 'data-act': act }); b.textContent = text; b.addEventListener('click', fn); return b; };
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('exportTracks.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('exportTracks.hint');
    const list = el('div', 'display:flex;flex-direction:column;gap:4px');
    const msg = el('div', 'min-height:1.2em;font-size:12px;color:var(--danger-ink,#a33)', { role: 'status' });
    const switches = tracks.map((t) => {
      const s = createSwitch({ checked: on.has(t.id), text: t.name, attrs: { 'data-export-track': t.id }, onchange: () => { if (s.checked) on.add(t.id); else on.delete(t.id); msg.textContent = ''; } });
      s.style.cssText = `${btnCss};justify-content:flex-start;text-align:left`; list.append(s); return s;
    });
    const setAll = (v) => { for (const [i, t] of tracks.entries()) { switches[i].checked = v; if (v) on.add(t.id); else on.delete(t.id); } msg.textContent = ''; };
    const quick = el('div', 'display:flex;gap:var(--btn-gap,4px);flex-wrap:wrap'); quick.append(mk(label('exportTracks.all'), 'export-tracks-all', () => setAll(true)), mk(label('exportTracks.none'), 'export-tracks-none', () => setAll(false)));
    const foot = el('div', 'display:flex;gap:var(--btn-gap,4px);justify-content:flex-end;flex-wrap:wrap');
    foot.append(mk(label('exportTracks.cancel'), 'export-tracks-cancel', () => finish(null)), mk(label('exportTracks.ok'), 'export-tracks-ok', () => { if (!on.size) { msg.textContent = label('exportTracks.needOne'); return; } finish({ ids: tracks.filter((t) => on.has(t.id)).map((t) => t.id), instruments: wantInstruments, chords: chords && wantChords ? { pool: chordPool, variants: chordVariants ? 'all' : 'main', groups: chordGroups } : null }); }, true));
    const extra = instruments === null ? null : createSwitch({ checked: wantInstruments, text: label('exportTracks.instruments'), attrs: { 'data-export-instruments': '' }, onchange: () => { wantInstruments = extra.checked; } });
    if (extra) extra.style.cssText = `${btnCss};justify-content:flex-start;text-align:left`;
    let chordsRow = null;
    if (chords) {
      const poolSel = el('select', `${btnCss};max-width:100%`, { 'data-export-chords-pool': '', 'aria-label': label('exportTracks.chordsPool') });
      for (const [id, name] of [['reader', label('exportTracks.chordsReader')], ...chords.pools.map((p) => [p.id, p.name])]) { const o = el('option'); o.value = id; o.textContent = name; poolSel.append(o); }
      poolSel.value = chords.pools.some((p) => p.id === chordPool) || chordPool === 'reader' ? chordPool : 'reader';
      poolSel.addEventListener('change', () => { chordPool = poolSel.value; });
      const sw = createSwitch({ checked: wantChords, text: label('exportTracks.chords'), attrs: { 'data-export-chords': '' }, onchange: () => { wantChords = sw.checked; poolSel.style.display = wantChords && chords.pools.length ? '' : 'none'; } });
      sw.style.cssText = `${btnCss};justify-content:flex-start;text-align:left`;
      poolSel.style.display = wantChords && chords.pools.length ? '' : 'none';
      const swVar = createSwitch({ checked: chordVariants, text: label('exportTracks.chordsVariants'), attrs: { 'data-export-chords-variants': '' }, onchange: () => { chordVariants = swVar.checked; } });
      swVar.style.cssText = `${btnCss};justify-content:flex-start;text-align:left`;
      chordsRow = el('div', 'display:flex;flex-direction:column;gap:4px'); const grpSel = el('select', `${btnCss};max-width:100%`, { 'data-export-chords-groups': '', 'aria-label': label('exportTracks.chordsGroups') });
      for (const g of ['off', 'sections', 'labels']) { const o = el('option'); o.value = g; o.textContent = label(`exportTracks.chordsGroups.${g}`); grpSel.append(o); }
      grpSel.value = chordGroups; grpSel.addEventListener('change', () => { chordGroups = grpSel.value; });
      chordsRow.append(sw, poolSel, swVar, grpSel);
    }
    box.append(title, hint, quick, list, ...(extra ? [extra] : []), ...(chordsRow ? [chordsRow] : []), msg, foot);
    document.body.append(veil);
  });
}
