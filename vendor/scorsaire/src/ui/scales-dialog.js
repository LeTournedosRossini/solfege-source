/*
 * The "Scales" window (src/scales/): choose a scale (72, by level), its root and where it goes — written in a notation or tablature staff of the movement, from the chosen measure, or as a new
 * SCALE MOVEMENT (which keeps the recipe, so that the readers can show it for the instrument of each pupil). The tablature takes the system of positions (3 notes per string, CAGED, Berklee…)
 * and the position. A small preview shows what will be written. One undo step. Credit: the Berklee and CAGED positions are checked against the diagrams of Jens Larsen.
 */
import { createChoiceMenu } from './choice-menu.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { lib, ROOTS, LEVELS } from '../scales/index.js';
import { SCALE_INSTRUMENTS } from '../scales/instruments.js';
import { normalizeRecipe, scaleOf } from '../scales/recipe.js';
import { scaleNoteDocument, positionOf } from '../scales/document.js';
import { renderNoteSvg } from '../note/render-svg.js';

export function openScalesDialog({ app, label, movement = 0, onDone = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const lang = label('scales.lang') === 'en' ? 'en' : 'fr';
  const names = { names: lang === 'fr' ? 'solfege' : 'letters' };
  const state = { scale: 'major', alias: '', root: 'C', where: 'staff', staffId: null, hostId: null, span: 6, instrument: 'guitar6', system: null, position: null, message: '' };
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-scales-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(620px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px;' + (sheet ? 'border-radius:12px 12px 0 0' : 'border-radius:10px'));
  if (!sheet) box.setAttribute('data-resizable', 'scales');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(veil);

  const mk = (text, act, fn, { primary = false, disabled = false, title = '' } = {}) => {
    const b = el('button', `min-height:30px;padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
  const lab = (text) => { const s = el('span', 'font-size:12px;margin:0 6px'); s.textContent = text; return s; };
  const toggle = (text, act, on, fn) => { const b = mk(text, act, fn); b.setAttribute('aria-pressed', String(on)); if (on) b.style.background = 'var(--btn-on,#e2e0da)'; return b; };

  const recipe = (info, staffType) => normalizeRecipe({ scale: state.scale, root: state.root, alias: state.alias || undefined, instrument: state.where === 'movement' ? state.instrument : (staffType === 'tab' ? 'guitar6' : 'piano'), view: staffType === 'tab' ? 'tab' : 'score', system: state.system || undefined, position: state.position || undefined });

  function draw() {
    const info = app.scaleInfo({ movement });
    if (!state.staffId || !info.staves.some((s) => s.id === state.staffId)) state.staffId = info.selected ?? info.staves[0]?.id ?? null;
    const staff = info.staves.find((s) => s.id === state.staffId) ?? null;
    const writingTab = state.where === 'staff' ? staff?.type === 'tab' : state.where === 'movement' ? SCALE_INSTRUMENTS[state.instrument].family !== 'staff' : false;
    const start = info.target ?? 0;
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('scales.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('scales.hint');

    const scaleRow = row();
    const options = Object.keys(LEVELS).map((lv) => ({ folder: LEVELS[lv][lang], items: lib.list({ level: Number(lv) }).map((x) => [`${x.id}|${x.alias ?? ''}`, x.name]) }));
    scaleRow.append(lab(label('scales.scale')), createChoiceMenu({ options, value: `${state.scale}|${state.alias}`, label: label('scales.scale'), act: 'scale-pick', follow: true, onPick: (v) => { const [id, alias] = v.split('|'); state.scale = id; state.alias = alias; state.position = null; draw(); } }));
    const rootRow = row();
    rootRow.append(lab(label('scales.root')), createChoiceMenu({ options: ROOTS.map((n) => [n, lib.notes('major', n, names)[0].name]), value: state.root, label: label('scales.root'), act: 'scale-root', follow: true, columns: 4, onPick: (v) => { state.root = v; state.position = null; draw(); } }));

    const whereRow = row();
    whereRow.append(lab(label('scales.where')), toggle(label('scales.inStaff'), 'where-staff', state.where === 'staff', () => { state.where = 'staff'; draw(); }), toggle(label('scales.container'), 'where-container', state.where === 'container', () => { state.where = 'container'; draw(); }), toggle(label('scales.newMovement'), 'where-movement', state.where === 'movement', () => { state.where = 'movement'; draw(); }));
    const target = row();
    if (state.where === 'staff') {
      if (!staff) { const w = el('div', 'color:var(--danger-ink,#b00020)'); w.textContent = label('scales.noStaff'); target.append(w); }
      else {
        target.append(lab(label('scales.staff')), createChoiceMenu({ options: info.staves.map((s) => [s.id, `${s.name || '—'} · ${label(`scales.type.${s.type}`)}`]), value: state.staffId, label: label('scales.staff'), act: 'scale-staff', follow: true, onPick: (v) => { state.staffId = v; state.position = null; draw(); } }));
        const from = el('span', 'font-size:13px;margin-left:8px'); from.textContent = label('scales.from', { n: start + 1 }); target.append(from);
      }
    } else if (state.where === 'container') {
      if (!state.hostId || !info.hosts.some((s) => s.id === state.hostId)) state.hostId = info.host ?? info.hosts.find((s) => s.type !== 'chord')?.id ?? info.hosts[0]?.id ?? null;
      target.append(lab(label('scales.staff')), createChoiceMenu({ options: info.hosts.map((s) => [s.id, `${s.name || '—'} · ${label(`scales.type.${s.type}`) === `scales.type.${s.type}` ? s.type : label(`scales.type.${s.type}`)}`]), value: state.hostId, label: label('scales.staff'), act: 'scale-host', follow: true, onPick: (v) => { state.hostId = v; draw(); } }));
      const n = Math.max(1, Math.min(state.span, info.measures - start));
      const num = el('span', 'min-width:7em;text-align:center'); num.textContent = label('scales.spanMeasures', { n });
      target.append(lab(label('scales.span')), mk('−', 'span-less', () => { state.span = Math.max(1, state.span - 1); draw(); }, { disabled: state.span <= 1 }), num, mk('+', 'span-more', () => { state.span = Math.min(16, state.span + 1); draw(); }, { disabled: state.span >= 16 }));
      const from = el('span', 'font-size:13px;margin-left:8px'); from.textContent = label('scales.from', { n: start + 1 }); target.append(from);
    } else {
      target.append(lab(label('scales.instrument')), createChoiceMenu({ options: Object.keys(SCALE_INSTRUMENTS).map((i) => [i, label(`scales.inst.${i}`)]), value: state.instrument, label: label('scales.instrument'), act: 'scale-instrument', follow: true, onPick: (v) => { state.instrument = v; state.position = null; draw(); } }));
    }

    // the tablature: the system of positions and the position
    const posRow = row(); let preview = ''; let r = null; let blocked = false;
    try {
      r = recipe(info, writingTab ? 'tab' : 'score');
      const sc = scaleOf(r);
      if (writingTab && (state.where === 'movement' || staff)) {
        const p = positionOf({ ...r, instrument: state.where === 'movement' ? state.instrument : 'guitar6' });
        const systems = p.systems.filter((s) => true);
        posRow.append(lab(label('scales.system')), createChoiceMenu({ options: systems.map((s) => [s, lib.availableSystems(sc, { instrument: 'guitar6' }).find((x) => x.id === s)?.[lang] ?? s]), value: p.system, label: label('scales.system'), act: 'scale-system', follow: true, onPick: (v) => { state.system = v; state.position = null; draw(); } }),
          lab(label('scales.position')), createChoiceMenu({ options: p.list.map((q) => [q.id, q.label?.[lang] ?? q.id]), value: p.position.id, label: label('scales.position'), act: 'scale-position', follow: true, onPick: (v) => { state.position = v; draw(); } }));
        r = recipe(info, 'tab'); r.system = p.system; r.position = p.position.id;
        if (sc.notes_count === 7 && !p.systems.includes('berklee')) { const w = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); w.textContent = label('scales.berkleeOnly6'); posRow.append(w); }
      }
      const doc = scaleNoteDocument(r.view === 'tab' ? { ...r, instrument: r.instrument } : r);
      preview = renderNoteSvg(doc.json, { width: 560, ink: 'currentColor', paper: 'none' }).svg;
    } catch (e) { state.message = e.message; blocked = true; }
    const pre = el('div', 'border:1px solid var(--edge,#bbb);border-radius:6px;padding:4px;overflow:auto;max-height:36vh;color:var(--ink,#111);background:var(--field,#fff)', { 'data-scales-preview': '' }); pre.innerHTML = preview;

    const actions = row();
    actions.append(mk(label('scales.write'), 'scale-write', () => {
      try {
        if (state.where === 'container') {
          const res = app.addScaleContainer(r, { movement, staffId: state.hostId, start, span: state.span });
          state.message = label('scales.containerAdded', { m: res.from + 1, n: res.span });
        } else if (state.where === 'staff') {
          const res = app.writeScale(r, { movement, staffId: state.staffId, start });
          state.message = `${label('scales.written', { n: res.measures, m: res.from + 1 })}${res.added ? ` ${label('scales.added', { n: res.added })}` : ''}`;
        } else {
          const id = app.addScaleMovement(r, { title: `${lib.notes(scaleOf(r), r.root, names)[0].name} ${String(lib.displayName(scaleOf(r).id ?? scaleOf(r), { alias: r.alias, lang })).toLowerCase()}` });
          state.message = label('scales.movementAdded'); if (onDone) onDone(id);
        }
      } catch (e) { state.message = e.message; }
      draw();
    }, { primary: true, disabled: blocked || (state.where === 'staff' && !staff) || (state.where === 'container' && !state.hostId) }), mk(label('strum.bake.close'), 'scale-close', close));
    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-scales-message': '' }); status.textContent = state.message;
    const credit = el('div', 'font-size:11px;color:var(--ink-soft,#555)'); credit.textContent = label('scales.credit');
    box.replaceChildren(title, hint, scaleRow, rootRow, whereRow, target, posRow, pre, actions, status, credit);
  }
  draw();
  return { close };
}
