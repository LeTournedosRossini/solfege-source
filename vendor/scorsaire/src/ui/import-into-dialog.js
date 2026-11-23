/*
 * The window that comes after "Import a file here…" (the file is already read): which staff of the file to take, whether to keep its lyrics and its chords, and a warning when the file
 * is not in the time signature of the piece at that place (the notes are cut at the bars of the piece and tied: right, but not pretty). Nothing is written before « Import ».
 * The writing itself (the paste) is `app.importPayloads`, called by the caller of this window with what `onImport` gives.
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';

/**
 * @param o.staves  [{ id, name, type, measures, notes, lyrics }] (`import/into-staff.js › importableStaves`)
 * @param o.where   { staffName, measure } the chosen staff and measure (1-based) of the piece
 * @param o.fileHasChords / o.pieceHasChords  whether the file has a chord staff / the piece has a chord staff to receive it
 * @param o.timeSig  null, or { source: [n, d], target: [n, d] }
 * @param o.onImport  ({ staffId, lyrics, chords }) → may throw: the message is shown in the window, which stays open
 */
export function openImportIntoDialog({ label, staves, where, fileHasChords = false, pieceHasChords = false, timeSig = null, onImport }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let staffId = (staves.find((s) => s.notes && s.type !== 'chord') ?? staves[0])?.id ?? null;
  let lyrics = true; let chords = false; let message = '';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-import-dialog': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(520px,100vw);max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:10px;${sheet ? 'border-radius:12px 12px 0 0' : 'border-radius:12px'}`, { role: 'dialog', 'aria-label': label('importHere.title', where) });
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  const mk = (text, act, fn, primary = false) => {
    const b = el('button', `min-height:var(--ui-target,36px);padding:0 14px;border-radius:6px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);${primary ? 'background:var(--primary,#1c1b1a);color:var(--primary-ink,#fff);border:1px solid var(--primary,#1c1b1a)' : 'border:1px solid var(--edge,#999);background:var(--field,#fff);color:var(--ink,#111)'}`, { type: 'button', 'data-import-act': act });
    b.textContent = text; b.addEventListener('click', fn); return b;
  };
  const check = (text, act, on, onChange, disabled = false) => {
    const wrap = el('label', `display:flex;gap:8px;align-items:center;min-height:var(--ui-target,36px);font-size:14px;${disabled ? 'opacity:.55' : ''}`);
    const box2 = el('input', 'width:20px;height:20px', { type: 'checkbox', 'data-import-act': act }); box2.checked = on; box2.disabled = disabled;
    box2.addEventListener('change', () => onChange(box2.checked));
    wrap.append(box2, document.createTextNode(text)); return wrap;
  };

  function draw() {
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('importHere.title', where);
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('importHere.hint');
    const parts = [title, hint];
    if (!staves.length) {
      const none = el('div', 'padding:8px;border:1px solid var(--edge,#bbb);border-radius:6px'); none.textContent = label('importHere.none');
      parts.push(none, mk(label('importHere.cancel'), 'cancel', close));
      box.replaceChildren(...parts); return;
    }
    const list = el('div', 'display:flex;flex-direction:column;gap:4px', { role: 'radiogroup', 'aria-label': label('importHere.staves') });
    for (const s of staves) {
      const row = el('label', `display:flex;gap:8px;align-items:center;min-height:var(--ui-target,36px);padding:0 8px;border-radius:6px;border:${staffId === s.id ? '2px solid var(--sel-edge,#2d78ff)' : '1px solid var(--edge,#bbb)'};background:${staffId === s.id ? 'var(--accent-soft,#d6e6ff)' : 'transparent'}`);
      const radio = el('input', 'width:20px;height:20px', { type: 'radio', name: 'import-staff', 'data-import-staff': s.id }); radio.checked = staffId === s.id;
      radio.addEventListener('change', () => { staffId = s.id; if (!s.lyrics) lyrics = false; draw(); });
      row.append(radio, document.createTextNode(label('importHere.stave', { name: s.name || label('importHere.unnamed'), type: s.type, measures: s.measures })));
      list.append(row);
    }
    const lead = el('div', 'font-size:13px;font-weight:var(--w-semi,600)'); lead.textContent = label('importHere.staves');
    parts.push(lead, list);
    const chosen = staves.find((s) => s.id === staffId);
    parts.push(check(label('importHere.lyrics'), 'lyrics', lyrics && !!chosen?.lyrics, (v) => { lyrics = v; }, !chosen?.lyrics));
    if (fileHasChords) parts.push(check(`${label('importHere.chords')}${pieceHasChords ? '' : ` ${label('importHere.noChordStaff')}`}`, 'chords', chords && pieceHasChords, (v) => { chords = v; }, !pieceHasChords));
    if (timeSig) { const w = el('div', 'font-size:13px;padding:6px;border-radius:6px;background:var(--warn-soft,#ffe9b8);color:var(--warn-ink,#6b4a00)', { role: 'status', 'data-import-warning': 'timesig' }); w.textContent = label('importHere.timeSig', { source: `${timeSig.source[0]}/${timeSig.source[1]}`, target: `${timeSig.target[0]}/${timeSig.target[1]}` }); parts.push(w); }
    const msg = el('div', 'min-height:1.2em;font-size:13px;color:var(--danger-ink,#a33)', { role: 'alert' }); msg.textContent = message;
    const actions = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px)');
    actions.append(mk(label('importHere.go'), 'go', () => {
      try { onImport({ staffId, lyrics: lyrics && !!chosen?.lyrics, chords: chords && pieceHasChords }); close(); } catch (e) { message = String(e?.message ?? e); draw(); }
    }, true), mk(label('importHere.cancel'), 'cancel', close));
    parts.push(msg, actions);
    box.replaceChildren(...parts);
  }
  document.body.append(veil);
  draw();
  return { close };
}
