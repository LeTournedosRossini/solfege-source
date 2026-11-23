/*
 * The "Time signature" window (model/timesigedit.js, applied by `app.changeTimeSignature`): 4/4 → 12/8 on the whole piece, from the chosen measure to the next change, or over the chosen
 * measures only. The notes stay in their measures (rests fill a longer measure, a shorter one is cut); the window counts what the cut would lose BEFORE anything is written. One undo step.
 */
import { createChoiceMenu } from './choice-menu.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const PRESETS = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [2, 2], [3, 2], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8]];
const DENOMINATORS = [2, 4, 8, 16];

export function openTimeSigDialog({ app, label, movement = 0, onDone = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const info = app.timeSigInfo({ movement });
  const sel = info.selection;
  let scope = !sel ? 'whole' : sel.from === sel.to ? 'from' : 'range';
  let sig = [...info.current(scope === 'whole' ? 0 : sel.from)];
  let style = info.currentStyle ? info.currentStyle(scope === 'whole' ? 0 : sel.from) : 'normal'; // how the signature is written: digits, C or cut C
  let message = '';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-timesig-dialog': '' });
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
  /** The measures the choice covers, as indices. */
  const rangeNow = () => (scope === 'whole' || !sel ? { from: 0, to: info.measures - 1 } : scope === 'from' ? { from: sel.from, to: info.spanEnd(sel.from) } : { from: sel.from, to: sel.to });

  function draw() {
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('timesig.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('timesig.hint');
    const r = rangeNow();
    const where = row();
    where.append(mk(label('timesig.whole'), 'timesig-whole', () => { scope = 'whole'; draw(); }, { on: scope === 'whole' }));
    if (sel) {
      where.append(mk(label('timesig.from', { n: sel.from + 1 }), 'timesig-from', () => { scope = 'from'; draw(); }, { on: scope === 'from' }));
      if (sel.to !== sel.from) where.append(mk(label('timesig.range', { from: sel.from + 1, to: sel.to + 1 }), 'timesig-range', () => { scope = 'range'; draw(); }, { on: scope === 'range' }));
    }
    const covers = el('div', 'font-size:13px;border:1px solid var(--edge,#bbb);border-radius:6px;padding:6px', { 'data-timesig-covers': '' });
    covers.textContent = r.from === 0 && r.to === info.measures - 1 ? label('timesig.coversAll') : label('timesig.covers', { from: r.from + 1, to: r.to + 1 });
    const presets = row();
    for (const p of PRESETS) presets.append(mk(`${p[0]}/${p[1]}`, `timesig-${p[0]}-${p[1]}`, () => { sig = [...p]; draw(); }, { on: sig[0] === p[0] && sig[1] === p[1] }));
    const custom = row();
    const num = el('span', 'min-width:2.2em;text-align:center;font:var(--w-bold,700) 16px var(--ui-font,sans-serif)', { 'data-timesig-num': '' }); num.textContent = String(sig[0]);
    custom.append(mk('−', 'timesig-num-less', () => { sig = [Math.max(1, sig[0] - 1), sig[1]]; draw(); }), num, mk('+', 'timesig-num-more', () => { sig = [Math.min(32, sig[0] + 1), sig[1]]; draw(); }),
      createChoiceMenu({ options: DENOMINATORS.map((d) => [String(d), `/ ${d}`]), value: String(sig[1]), label: label('timesig.denominator'), act: 'timesig-den', follow: true, onPick: (v) => { sig = [sig[0], Number(v)]; draw(); } }));
    // how it is written: C only means 4/4 and cut C only 2/2, so the other choices are off for another signature
    const writable = { normal: true, common: sig[0] === 4 && sig[1] === 4, cut: sig[0] === 2 && sig[1] === 2 };
    if (!writable[style]) style = 'normal';
    const styleLabel = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); styleLabel.textContent = label('timesig.style');
    const styles = row();
    for (const k of ['normal', 'common', 'cut']) { const b = mk(label(`timesig.style.${k}`), `timesig-style-${k}`, () => { style = k; draw(); }, { on: style === k }); if (!writable[k]) { b.disabled = true; b.style.opacity = '.45'; } styles.append(b); }
    const plan = app.timeSigPlan({ movement, from: r.from, to: r.to, timeSig: sig });
    const c = plan.cut;
    const lost = c.notes + c.rests + c.tuplets + c.shortened;
    const status = el('div', `font-size:13px;padding:6px;border-radius:6px;${lost ? 'background:var(--warn-soft,#ffe9b8)' : ''}`, { role: 'status', 'data-timesig-plan': lost ? 'cut' : 'safe' });
    status.textContent = !plan.measures ? label('timesig.nothing') : lost
      ? label('timesig.cut', { measures: plan.measures, notes: c.notes, shortened: c.shortened, tuplets: c.tuplets })
      : label('timesig.safe', { measures: plan.measures });
    const actions = row();
    actions.append(mk(label('timesig.apply'), 'timesig-apply', () => {
      try {
        const report = app.changeTimeSignature({ movement, from: r.from, to: r.to, timeSig: sig, style: writable[style] ? style : 'normal' });
        close(); onDone?.(report);
      } catch (e) { message = e.message; draw(); }
    }, { primary: true }), mk(label('timesig.close'), 'timesig-close', close));
    const msg = el('div', 'min-height:1.2em;font-size:13px;color:var(--danger-ink,#a33)', { role: 'alert' }); msg.textContent = message;
    box.replaceChildren(title, hint, where, covers, presets, custom, styleLabel, styles, status, actions, msg);
  }

  document.body.append(veil);
  draw();
  return { close };
}
