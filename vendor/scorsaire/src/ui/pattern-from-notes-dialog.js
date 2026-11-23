/*
 * The "Make a pattern" window (model/patternfromnotes.js): what you have WRITTEN on the staves chosen on the score (a range of measures, up to 16) becomes a chord pattern in degrees, read against the
 * chord track — so that a part you wrote (the horns, a bass line, a keyboard comping) can be played again by a player, on any grid and in any key. By default the voicing is left to the solver of the
 * player; the exact voicing (the octaves of every note) is an option. The pattern is saved on this device or in the project, then it can be put in a style of yours, or in a new style.
 */
import { groupedOptions } from './menu-groups.js';
import { createChoiceMenu } from './choice-menu.js';
import { createSwitch } from './switch.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { MAX_BARS } from '../model/chordpatterns.js';

export function openPatternFromNotesDialog({ app, label, movement = 0 }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let name = ''; let level = 'user'; let exact = false; let message = ''; let made = null; let styleId = ''; let styleName = '';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-pattern-from-notes': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(560px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px;border-radius:8px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('patternFromNotes.title') });
  if (!sheet) box.setAttribute('data-resizable', 'patternFromNotes');
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
  const run = (fn) => { try { fn(); } catch (e) { message = e.message; } draw(); };

  function draw() {
    const info = app.patternFromNotesInfo({ movement });
    const sel = info.selection; const bars = sel ? sel.to - sel.from + 1 : 0;
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('patternFromNotes.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('patternFromNotes.hint');
    const where = el('div', 'font-size:13px;border:1px solid var(--edge,#bbb);border-radius:6px;padding:6px', { 'data-pattern-where': sel ? 'range' : 'none' });
    where.textContent = !sel ? label('patternFromNotes.none') : bars > MAX_BARS ? label('patternFromNotes.tooLong', { n: bars, max: MAX_BARS })
      : label('patternFromNotes.from', { from: sel.from + 1, to: sel.to + 1, n: bars, staves: [...new Set(info.staves.map((s) => s.name))].join(', ') });
    const nameRow = row();
    const input = el('input', 'font-size:16px;min-height:30px;box-sizing:border-box;flex:1 1 9em;min-width:7em', { type: 'text', 'data-key': 'pattern-name', value: name, placeholder: label('patternFromNotes.name') });
    input.addEventListener('input', () => { name = input.value; });
    nameRow.append(input, mk(label('styles.saveDevice'), 'pfn-user', () => { level = 'user'; draw(); }, { on: level === 'user' }), mk(label('styles.saveProject'), 'pfn-project', () => { level = 'project'; draw(); }, { on: level === 'project' }));
    const opts = row();
    opts.append(createSwitch({ checked: exact, text: label('patternFromNotes.exact'), attrs: { 'data-act': 'pfn-exact', title: label('patternFromNotes.exactHint') }, onchange: (e) => { exact = e.target.checked; } }));
    const actions = row();
    actions.append(mk(label('patternFromNotes.make'), 'pfn-make', () => run(() => {
      made = app.makePatternFromNotes(level, { name: name.trim() || label('patternFromNotes.defaultName'), exact, movement });
      message = `${label('patternFromNotes.made', { name: made.pattern.name, n: made.hits })}${made.skipped ? ` ${label('patternFromNotes.skipped', { n: made.skipped })}` : ''}`;
      styleName = made.pattern.name;
    }), { primary: true, disabled: !sel || bars > MAX_BARS }), mk(label('strum.bake.close'), 'pfn-close', close));
    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-pfn-message': '' }); status.textContent = message;

    const parts = [title, hint, where, nameRow, opts, actions, status];
    if (made) {
      // what next: into a style of yours (a new player), or a new style with this player alone
      const own = app.styles().filter((s) => s.source !== 'builtin');
      const next = el('div', 'display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--edge,#bbb);padding-top:8px', { 'data-pfn-next': '' });
      const cap = el('div', 'font-weight:var(--w-semi,600)'); cap.textContent = label('patternFromNotes.next', { role: made.role ? label(`styles.role.${made.role}`) : '' });
      const intoRow = row();
      intoRow.append(createChoiceMenu({ options: groupedOptions(own, { text: (s) => s.name ?? s.id, label, head: [['', label('patternFromNotes.pickStyle')]], browse: label('patternFromNotes.pickStyle') }), value: styleId, label: label('patternFromNotes.pickStyle'), act: 'pfn-style', follow: true, onPick: (v) => { styleId = v; } }),
        mk(label('patternFromNotes.addToStyle'), 'pfn-add', () => run(() => { if (!styleId) throw new Error(label('patternFromNotes.pickStyle')); const s = app.addPatternToStyle(styleId, made.pattern.id, { role: made.role ?? 'keys', instrument: made.instrument }); message = label('patternFromNotes.added', { name: s.name ?? s.id }); })));
      const newRow = row();
      const sname = el('input', 'font-size:16px;min-height:30px;box-sizing:border-box;flex:1 1 9em;min-width:7em', { type: 'text', 'data-key': 'pfn-style-name', value: styleName, placeholder: label('styles.name') });
      sname.addEventListener('input', () => { styleName = sname.value; });
      newRow.append(sname, mk(label('patternFromNotes.newStyle'), 'pfn-new-style', () => run(() => { const s = app.addPatternToStyle(null, made.pattern.id, { role: made.role ?? 'keys', instrument: made.instrument, name: styleName.trim() || label('styles.defaultName'), level }); message = label('patternFromNotes.styleMade', { name: s.name ?? s.id }); })));
      next.append(cap, intoRow, newRow);
      parts.push(next);
    }
    box.replaceChildren(...parts);
  }

  document.body.append(veil);
  draw();
  return { close };
}
