/*
 * The "Key signature" window (model/keysigedit.js, applied by `app.changeKeySignature`): C major → G major on the whole piece, from the chosen measure to the next change, or over the chosen
 * measures only. The SOUND does not change (that is "Transpose"): only the signature and the way the notes are written. Chord symbols are written again only if asked (off by default).
 * The window counts what would be written again BEFORE anything is written. One undo step.
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';

/** "2♯", "3♭" or "0" for a number of fifths. */
const accidentals = (k) => (k === 0 ? '0' : k > 0 ? `${k}♯` : `${-k}♭`);

export function openKeySigDialog({ app, label, movement = 0, onDone = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const info = app.keySigInfo({ movement });
  const sel = info.selection;
  let scope = !sel ? 'whole' : sel.from === sel.to ? 'from' : 'range';
  let key = info.current(scope === 'whole' ? 0 : sel.from);
  let chordSymbols = false;
  let message = '';
  const majors = label('keysig.majors').split(','); const minors = label('keysig.minors').split(',');
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-keysig-dialog': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(520px,100%);max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:10px;${sheet ? 'border-radius:14px 14px 0 0' : 'border-radius:10px'}`);
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { primary = false, on = false } = {}) => {
    const b = el('button', `min-height:var(--ui-target,36px);min-width:var(--ui-target,36px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);${primary || on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; b.addEventListener('click', fn); if (on) b.setAttribute('aria-pressed', 'true'); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center');
  const rangeNow = () => (scope === 'whole' || !sel ? { from: 0, to: info.measures - 1 } : scope === 'from' ? { from: sel.from, to: info.spanEnd(sel.from) } : { from: sel.from, to: sel.to });

  function draw() {
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('keysig.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('keysig.hint');
    const r = rangeNow();
    const where = row();
    where.append(mk(label('timesig.whole'), 'keysig-whole', () => { scope = 'whole'; draw(); }, { on: scope === 'whole' }));
    if (sel) {
      where.append(mk(label('timesig.from', { n: sel.from + 1 }), 'keysig-from', () => { scope = 'from'; draw(); }, { on: scope === 'from' }));
      if (sel.to !== sel.from) where.append(mk(label('timesig.range', { from: sel.from + 1, to: sel.to + 1 }), 'keysig-range', () => { scope = 'range'; draw(); }, { on: scope === 'range' }));
    }
    const covers = el('div', 'font-size:13px;border:1px solid var(--edge,#bbb);border-radius:6px;padding:6px', { 'data-keysig-covers': '' });
    covers.textContent = r.from === 0 && r.to === info.measures - 1 ? label('timesig.coversAll') : label('timesig.covers', { from: r.from + 1, to: r.to + 1 });
    const keys = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:var(--btn-gap,4px)');
    for (let k = -7; k <= 7; k += 1) keys.append(mk(label('keysig.item', { acc: accidentals(k), major: majors[k + 7], minor: minors[k + 7] }), `keysig-${k}`, () => { key = k; draw(); }, { on: key === k }));
    const chords = el('label', 'display:flex;gap:8px;align-items:center;font-size:13px;min-height:var(--ui-target,36px)');
    const check = el('input', 'width:20px;height:20px', { type: 'checkbox', 'data-keysig-chords': '' }); check.checked = chordSymbols;
    check.addEventListener('change', () => { chordSymbols = check.checked; draw(); });
    chords.append(check, document.createTextNode(label('keysig.chordSymbols')));
    const plan = app.keySigPlan({ movement, from: r.from, to: r.to, keySig: key, chordSymbols });
    const status = el('div', 'font-size:13px;padding:6px;border-radius:6px', { role: 'status', 'data-keysig-plan': plan.measures ? 'change' : 'none' });
    status.textContent = !plan.measures ? label('keysig.nothing') : label('keysig.plan', { measures: plan.measures, respelled: plan.respelled, kept: plan.kept, chords: plan.chordSymbols });
    const actions = row();
    actions.append(mk(label('timesig.apply'), 'keysig-apply', () => {
      try {
        const report = app.changeKeySignature({ movement, from: r.from, to: r.to, keySig: key, chordSymbols });
        close(); onDone?.(report);
      } catch (e) { message = e.message; draw(); }
    }, { primary: true }), mk(label('timesig.close'), 'keysig-close', close));
    const msg = el('div', 'min-height:1.2em;font-size:13px;color:var(--danger-ink,#a33)', { role: 'alert' }); msg.textContent = message;
    box.replaceChildren(title, hint, where, covers, keys, chords, status, actions, msg);
  }

  document.body.append(veil);
  draw();
  return { close };
}
