/*
 * The window of the MIDI import: what the file holds (parts, tempo, time signature), the three choices that decide how the notes are written (smallest value, triplets,
 * durations), and a preview of the first measures that follows every choice. Nothing is read into the piece before « Import ». PURE intentions are in `import/midi.js`;
 * this file only draws and asks.
 *
 *   openMidiImportDialog({ label, info, name, preview, insert }) → Promise of the options { grid, triplets, durations, parts, mode } or null (the user gave up)
 *
 * `insert` (optional) = { where, lyrics (the piece has a lyrics track to receive the syllables), check(partIds) → warning text or '' } when the file is brought INTO the open piece (« Import a file here… »): the window then offers
 * « Insert » (mode 'insert') next to « Open as a new piece » (mode 'open'); without it the only action is « Import » (mode 'open').
 *
 * `info` = `describeMidi(bytes)`; `preview(options)` → the result of `importMidi(bytes, { ...options, maxMeasures })` (may throw: the message is shown).
 */
import { drawCell } from '../reader/core.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const GRIDS = [8, 16, 32];
const TRIPLETS = ['auto', 'on', 'off'];
const DURATIONS = ['played', 'chained'];
const VELOCITIES = ['keep', 'off'];
const ON_OFF = ['on', 'off'];
const BIG_NOTES = 20000;

export function openMidiImportDialog({ label, info, name = '', preview, insert = null }) {
  return new Promise((resolve) => {
    const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
    const chosen = new Set(info.parts.filter((p) => p.notes > 0).map((p) => p.id));
    const o = { grid: 16, triplets: 'auto', durations: 'played', velocities: 'keep', lyrics: 'on', markers: 'on' };
    let message = ''; let timer = 0; let closed = false; let previewBox = null; let status = null;
    const totalNotes = info.parts.reduce((s, p) => s + p.notes, 0);
    const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-midi-dialog': '', 'data-zoom-lock': '' });
    const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(720px,100vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:10px;${sheet ? 'border-radius:12px 12px 0 0' : 'border-radius:12px'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('midi.title') });
    if (!sheet) box.setAttribute('data-resizable', 'midi');
    veil.append(box);
    const finish = (value) => { if (closed) return; closed = true; clearTimeout(timer); window.removeEventListener('keydown', onKey, true); veil.remove(); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) finish(null); });
    window.addEventListener('keydown', onKey, true);

    const options = () => ({ ...o, parts: info.parts.filter((p) => chosen.has(p.id)).map((p) => p.id) });
    const mk = (text, act, fn, primary = false, disabled = false) => {
      const b = el('button', `min-height:var(--ui-target,36px);padding:0 14px;border-radius:6px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);${primary ? 'background:var(--primary,#1c1b1a);color:var(--primary-ink,#fff);border:1px solid var(--primary,#1c1b1a)' : 'border:1px solid var(--edge,#999);background:var(--field,#fff);color:var(--ink,#111)'};${disabled ? 'opacity:.5' : ''}`, { type: 'button', 'data-midi-act': act });
      b.textContent = text; b.disabled = disabled; b.addEventListener('click', fn); return b;
    };
    /** A row of exclusive choices; the chosen one is marked. */
    const choices = (title, key, values, text, hint) => {
      const wrap = el('div', 'display:flex;flex-direction:column;gap:4px');
      const head = el('div', 'font-size:13px;font-weight:var(--w-semi,600)'); head.textContent = title;
      const row = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px)', { role: 'radiogroup', 'aria-label': title });
      for (const v of values) {
        const on = o[key] === v;
        const b = el('button', `min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);color:var(--ink,#111);${on ? 'background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)' : 'background:var(--field,#fff);border:1px solid var(--edge,#999)'}`, { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-midi-choice': `${key}:${v}` });
        b.textContent = text(v); b.addEventListener('click', () => { o[key] = v; draw(); });
        row.append(b);
      }
      wrap.append(head, row);
      if (hint) { const h = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); h.textContent = hint; wrap.append(h); }
      return wrap;
    };

    function drawPreview() {
      if (!previewBox) return;
      status.textContent = ''; message = '';
      if (!chosen.size) { previewBox.replaceChildren(); status.textContent = label('midi.noParts'); return; }
      try {
        const r = preview(options());
        const stage = el('div');
        const mv = r.work.movements[0];
        const width = Math.max(240, Math.min(640, (previewBox.clientWidth || 640) - 4));
        const cell = drawCell(stage, { work: r.work, movement: mv, width, staffSpace: 4, mode: 'wrap', margin: 6, header: false });
        previewBox.replaceChildren(cell.box);
        const trip = r.report.items.find((i) => i.code === 'triplets.found');
        const warns = r.report.items.filter((i) => i.level === 'warning').length;
        status.textContent = [trip ? label('midi.tripletsFound', { n: trip.data?.windows ?? trip.count }) : '', warns ? label('midi.warnings', { n: warns }) : ''].filter(Boolean).join(' ');
      } catch (e) {
        previewBox.replaceChildren();
        status.textContent = String(e?.message ?? e);
      }
    }
    const schedulePreview = () => { clearTimeout(timer); timer = setTimeout(drawPreview, 120); };

    function draw() {
      const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = name ? `${label('midi.title')} · ${name}` : label('midi.title');
      const intro = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); intro.textContent = label('midi.intro');
      const summary = el('div', 'font-size:13px');
      summary.textContent = label('midi.summary', { measures: info.measures, time: `${info.timeSig[0]}/${info.timeSig[1]}`, bpm: info.bpm, notes: totalNotes });
      const parts = [title, intro, summary];
      const changes = info.timeSigChanges + info.tempoChanges;
      if (changes) { const c = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); c.textContent = label('midi.summaryChanges', { n: changes }); parts.push(c); }
      if (totalNotes > BIG_NOTES) { const big = el('div', 'font-size:13px;padding:6px;border-radius:6px;background:var(--warn-soft,#ffe9b8);color:var(--warn-ink,#6b4a00)', { role: 'status' }); big.textContent = label('midi.big'); parts.push(big); }

      const pv = el('div', 'font-size:13px;font-weight:var(--w-semi,600)'); pv.textContent = label('midi.preview');
      previewBox = el('div', 'max-height:26vh;overflow:auto;border-radius:6px', { 'data-midi-preview': '' });
      status = el('div', 'min-height:1.2em;font-size:13px;color:var(--ink-soft,#555)', { role: 'status' });
      // the preview stays in view while the choices below are scrolled
      const sticky = el('div', 'position:sticky;top:-12px;z-index:2;background:var(--paper,#faf8f4);padding:6px 0;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--edge,#bbb)');
      sticky.append(pv, previewBox, status);
      parts.push(sticky);

      const head = el('div', 'font-size:13px;font-weight:var(--w-semi,600)'); head.textContent = label('midi.parts');
      const list = el('div', 'display:flex;flex-direction:column;gap:4px');
      for (const p of info.parts) {
        const row = el('label', `display:flex;gap:8px;align-items:center;min-height:var(--ui-target,36px);padding:0 8px;border-radius:6px;border:1px solid var(--edge,#bbb);background:${chosen.has(p.id) ? 'var(--accent-soft,#d6e6ff)' : 'transparent'}`);
        const cb = el('input', 'width:20px;height:20px', { type: 'checkbox', 'data-midi-part': p.id }); cb.checked = chosen.has(p.id);
        cb.addEventListener('change', () => { if (cb.checked) chosen.add(p.id); else chosen.delete(p.id); draw(); });
        row.append(cb, document.createTextNode(p.drums ? label('midi.partDrums', { name: p.name, notes: p.notes }) : label('midi.partLine', { name: p.name, notes: p.notes, low: p.lowest, high: p.highest })));
        list.append(row);
      }
      parts.push(head, list);
      parts.push(choices(label('midi.grid'), 'grid', GRIDS, (v) => label(`midi.grid.${v}`)));
      parts.push(choices(label('midi.triplets'), 'triplets', TRIPLETS, (v) => label(`midi.triplets.${v}`), label('midi.triplets.hint')));
      parts.push(choices(label('midi.durations'), 'durations', DURATIONS, (v) => label(`midi.durations.${v}`), label('midi.durations.hint')));
      if (info.varied) parts.push(choices(label('midi.velocities'), 'velocities', VELOCITIES, (v) => label(`midi.velocities.${v}`), label('midi.velocities.hint')));
      if (info.lyrics && (!insert || insert.lyrics)) parts.push(choices(label('midi.lyrics', { n: info.lyrics }), 'lyrics', ON_OFF, (v) => label(`midi.lyrics.${v}`), label('midi.lyrics.hint')));
      if (info.markers && !insert) parts.push(choices(label('midi.markers', { n: info.markers }), 'markers', ON_OFF, (v) => label(`midi.markers.${v}`), label('midi.markers.hint')));

      const warning = insert ? insert.check(options().parts) : '';
      if (warning) { const w = el('div', 'font-size:13px;padding:6px;border-radius:6px;background:var(--warn-soft,#ffe9b8);color:var(--warn-ink,#6b4a00)', { role: 'status', 'data-midi-warning': '' }); w.textContent = warning; parts.push(w); }
      const actions = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);position:sticky;bottom:-12px;background:var(--paper,#faf8f4);padding:6px 0;border-top:1px solid var(--edge,#bbb)');
      if (insert) {
        actions.append(mk(label('midi.insert', { where: insert.where }), 'insert', () => finish({ ...options(), mode: 'insert' }), true, !chosen.size),
          mk(label('midi.openNew'), 'go', () => finish({ ...options(), mode: 'open' }), false, !chosen.size));
      } else actions.append(mk(label('midi.go'), 'go', () => finish({ ...options(), mode: 'open' }), true, !chosen.size));
      actions.append(mk(label('midi.cancel'), 'cancel', () => finish(null)));
      parts.push(actions);
      box.replaceChildren(...parts);
      schedulePreview();
    }
    document.body.append(veil);
    draw();
    box.querySelector(insert ? '[data-midi-act="insert"]' : '[data-midi-act="go"]')?.focus?.();
  });
}
