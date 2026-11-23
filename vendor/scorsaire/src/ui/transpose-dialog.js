/*
 * The "Transpose the music" window (model/transposeedit.js, applied by `app.transposeMusic`): moves the notes (of the notation, tablature and accordion staves), the chord symbols and the key
 * signatures of the movement by an interval, up or down. With measures chosen on the score (a range, a measure, a chord slot, a note) it only moves THOSE measures; with nothing chosen, the
 * whole movement. The percussion is never moved; the accompaniment players follow the chords. One undo step.
 */
import { createChoiceMenu } from './choice-menu.js';
import { createSwitch } from './switch.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

export function openTransposeDialog({ app, label, movement = 0 }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let up = true; let semitones = 2; let keys = true; let chordNames = true; let message = '';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-transpose-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(520px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px;border-radius:8px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('transpose.title') });
  if (!sheet) box.setAttribute('data-resizable', 'transpose');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { primary = false, on = false, disabled = false } = {}) => {
    const b = el('button', `min-height:30px;padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary || on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
  const lab = (text) => { const s = el('span', 'font-size:12px;margin:0 6px'); s.textContent = text; return s; };

  function draw() {
    const info = app.transposeInfo({ movement });
    const sel = info.selection;
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('transpose.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('transpose.hint');
    const where = el('div', 'font-size:13px;border:1px solid var(--edge,#bbb);border-radius:6px;padding:6px', { 'data-transpose-where': sel ? 'range' : 'whole' });
    where.textContent = sel ? (sel.from === sel.to ? label('transpose.oneMeasure', { n: sel.from + 1 }) : label('transpose.measures', { from: sel.from + 1, to: sel.to + 1 })) : label('transpose.whole');
    const how = row();
    how.append(mk(label('transpose.up'), 'transpose-up', () => { up = true; draw(); }, { on: up }), mk(label('transpose.down'), 'transpose-down', () => { up = false; draw(); }, { on: !up }),
      lab(label('transpose.interval')), createChoiceMenu({ options: Array.from({ length: 12 }, (_, i) => [String(i + 1), label(`transpose.i${i + 1}`)]), value: String(semitones), label: label('transpose.interval'), act: 'transpose-interval', follow: true, onPick: (v) => { semitones = Number(v); draw(); } }));
    const opts = row();
    opts.append(createSwitch({ checked: keys, text: label('transpose.keys'), attrs: { 'data-act': 'transpose-keys' }, onchange: (e) => { keys = e.target.checked; } }),
      createSwitch({ checked: chordNames, text: label('transpose.chords'), attrs: { 'data-act': 'transpose-chords' }, onchange: (e) => { chordNames = e.target.checked; } }));
    const actions = row();
    actions.append(mk(label('transpose.apply'), 'transpose-apply', () => {
      try {
        const r = app.transposeMusic(up ? semitones : -semitones, { movement, measures: sel, keys, chordNames });
        message = `${label('transpose.done', { notes: r.notes, chords: r.chordSymbols, keys: r.keys })}${r.failed.length ? ` ${label('transpose.failed', { n: r.failed.length })}` : ''}`;
      } catch (e) { message = e.message; }
      draw();
    }, { primary: true }), mk(label('strum.bake.close'), 'transpose-close', close));
    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-transpose-message': '' }); status.textContent = message;
    box.replaceChildren(title, hint, where, how, opts, actions, status);
  }

  document.body.append(veil);
  draw();
  return { close };
}
