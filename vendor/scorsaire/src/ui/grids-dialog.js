/*
 * The "Typical grids" window (model/gridtemplates.js): choose a grid (a blues, rhythm changes, a pop-rock loop), its key and how many times it is played in a row, and it is written in the
 * chord track — so that the accompaniment of a style can be heard at once. With no measure chosen on the score the grid REPLACES the whole chord track (and its sections) of the movement;
 * with a measure chosen it is put FROM that measure, over as many measures as it needs. When there is already something on those measures the window says so and asks before replacing it.
 * One undo step. Changing the key later = putting the grid again (a global transposition of the movement is another tool).
 */
import { createChoiceMenu } from './choice-menu.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { GRID_TEMPLATES, GRID_FAMILIES, gridById, gridKeys } from '../model/gridtemplates.js';
import { MAX_CHORUSES } from '../model/chordgridedit.js';
import { noteLabel } from '../model/chordentry.js';

export function openGridsDialog({ app, label, movement = 0 }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let gridId = 'blues12'; let tonicPc = 0; let choruses = 1; let message = ''; let pending = null; // pending = what would be replaced, waiting for the answer
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-grids-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(560px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px;border-radius:8px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('grids.title') });
  if (!sheet) box.setAttribute('data-resizable', 'grids');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { primary = false, disabled = false, title = '' } = {}) => {
    const b = el('button', `min-height:30px;padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
  const lab = (text) => { const s = el('span', 'font-size:12px;margin:0 6px'); s.textContent = text; return s; };
  const run = (fn) => { try { fn(); } catch (e) { message = e.message; } draw(); };

  function draw() {
    const info = app.gridInfo({ movement });
    const grid = gridById(gridId);
    const start = info.target; // null = no measure chosen: the grid replaces the whole chord track
    const count = grid.bars.length * choruses;
    const apply = () => run(() => {
      const r = app.applyGrid(gridId, { movement, start, tonicPc, choruses, labelOf: (s) => s.label ?? label(`section.${s.category}`) });
      pending = null;
      message = `${label('grids.applied', { n: r.count, m: r.from + 1 })}${r.added ? ` ${label('grids.added', { n: r.added })}` : ''}`;
    });
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('grids.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('grids.hint');

    const pick = row();
    pick.append(lab(label('grids.grid')), createChoiceMenu({
      options: GRID_FAMILIES.flatMap((f) => GRID_TEMPLATES.filter((g) => g.family === f).map((g) => [g.id, `${label(`grids.family.${f}`)} · ${label(`grids.${g.id}`)}`])), value: gridId, label: label('grids.grid'), act: 'grid-pick', follow: true,
      onPick: (id) => { gridId = id; if (gridById(id).minor !== grid.minor) tonicPc = 9; pending = null; draw(); },
    }));
    const keyRow = row();
    keyRow.append(lab(label('grids.key')), createChoiceMenu({
      options: gridKeys(grid.minor).map((k) => [String(k.pc), `${noteLabel(k.root)}${grid.minor ? 'm' : ''}`]), value: String(tonicPc), label: label('grids.key'), act: 'grid-key', follow: true,
      onPick: (v) => { tonicPc = Number(v); pending = null; draw(); },
    }));
    const times = el('span', 'min-width:9em;text-align:center'); times.textContent = label('grids.times', { n: choruses, m: count });
    keyRow.append(lab(label('grids.choruses')), mk('−', 'grid-less', () => { choruses -= 1; pending = null; draw(); }, { disabled: choruses <= 1 }), times, mk('+', 'grid-more', () => { choruses += 1; pending = null; draw(); }, { disabled: choruses >= MAX_CHORUSES }));

    const where = el('div', 'font-size:13px;border:1px solid var(--edge,#bbb);border-radius:6px;padding:6px', { 'data-grids-where': start === null ? 'whole' : 'from' });
    where.textContent = start === null ? label('grids.whole') : label('grids.from', { n: start + 1 });

    const actions = row();
    const ask = el('div', 'display:flex;flex-direction:column;gap:4px;border:2px solid var(--danger-ink,#b00020);border-radius:6px;padding:6px', { role: 'alert', 'data-grids-confirm': '' });
    if (pending) {
      const t = el('div'); t.textContent = label('grids.confirm', { chords: pending.chords, sections: pending.sections ? label('grids.confirmSections', { n: pending.sections }) : '' });
      const r = row(); r.append(mk(label('grids.replace'), 'grid-replace', apply, { primary: true }), mk(label('grids.cancel'), 'grid-cancel', () => { pending = null; draw(); }));
      ask.append(t, r);
    } else {
      actions.append(mk(label('grids.apply'), 'grid-apply', () => run(() => {
        const found = app.gridConflicts(count, { movement, start });
        if (found.chords > 0 || found.sections > 0) { pending = found; return; }
        apply();
      }), { primary: true, disabled: !info.hasChordTrack, title: info.hasChordTrack ? '' : label('player.needsChords') }));
    }
    actions.append(mk(label('strum.bake.close'), 'grid-close', close));
    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-grids-message': '' }); status.textContent = message;
    box.replaceChildren(...[title, hint, pick, keyRow, where, pending ? ask : null, actions, status].filter(Boolean));
  }

  document.body.append(veil);
  draw();
  return { close };
}
