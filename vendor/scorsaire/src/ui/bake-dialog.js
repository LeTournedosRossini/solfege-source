/*
 * « What this staff plays » dialog of a rhythm staff (guitar strum / piano comping): shows a PREVIEW of the notes it gives over the selected measures
 * (computed on a throw-away copy of the document, nothing is written) and writes them as real notes into a new track or an empty one, on request.
 * Bottom sheet on phones/tablets, centered window on desktop.
 */
import { createDocument, loadWork, serializeWork, PID } from '../model/index.js';
import { bakeRhythmStaff } from '../model/bakeplay.js';
import { createScoreView } from '../view/score-view.js';
import { createChoiceMenu } from './choice-menu.js';
import { createSwitch } from './switch.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

/** SVG text of the notes the staff would write over `measures` (a copy of the document is built and thrown away). */
export function bakePreviewSvg({ doc, glyphs, staffId, measures, width = 70, staffSpace = 7, user }) { // width in staff spaces; staffSpace = size of the writing
  const copy = createDocument(loadWork(serializeWork(doc.work)));
  const staff = copy.find(staffId);
  const mv = copy.movementOf(staff);
  let result;
  copy.transaction('preview', () => {
    result = bakeRhythmStaff(copy, mv, staff, { measures, user });
    // the preview shows the new track and, above it, the chord track
    for (const t of mv.tracks) if (t.id !== result.trackId && !t.staves.some((st) => copy.get(st, PID.STAFF_TYPE) === 'chord')) copy.set(t, PID.VISIBLE, false);
  });
  const view = createScoreView({ id: 'bake-preview', doc: copy, glyphs, movement: mv, width, staffSpace, margin: 6 });
  return view.render().svg;
}

export function openBakeDialog({ app, glyphs, label = (k) => k, staffId }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const count = app.doc.movementOf(app.doc.find(staffId))?.masterbars.length ?? 1;
  // the staff of a track with a player is often hidden (nothing to select): with no measure chosen, the whole arrangement of the movement is shown
  let measures = app.bakeMeasures() ?? (app.playerOfStaff(staffId) ? { from: 0, to: count - 1 } : null);
  let size = 7; // staff space of the preview, in px
  const veil = document.createElement('div');
  veil.setAttribute('data-bake-dialog', ''); veil.setAttribute('data-zoom-lock', '');
  veil.style.cssText = `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`;
  const box = document.createElement('div');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); if (!sheet) box.setAttribute('data-resizable', 'bake'); box.setAttribute('aria-label', label('strum.bake.title'));
  box.style.cssText = `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:14px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;display:flex;flex-direction:column;gap:var(--btn-gap,2px);${sheet ? 'width:100%;max-height:92vh;border-radius:12px 12px 0 0' : 'width:min(900px,calc(100vw - 24px));max-height:90vh;border-radius:8px'}`;
  const mk = (text, act, fn) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('data-act', act); b.addEventListener('click', fn);
    b.style.cssText = 'min-height:var(--ui-target,30px);padding:0 14px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);border-radius:6px'; return b;
  };
  const title = document.createElement('div'); title.textContent = label('strum.bake.title'); title.style.cssText = 'font-weight:var(--w-semi,600);font-size:16px';
  const info = document.createElement('div');
  const preview = document.createElement('div'); preview.style.cssText = 'overflow:auto;background:var(--score,#fff);border:1px solid var(--edge,#bbb);border-radius:6px;min-height:60px;max-height:42vh;padding:4px';
  const error = document.createElement('div'); error.setAttribute('role', 'alert'); error.style.cssText = 'color:#b00020;min-height:1.2em';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap;align-items:center;margin-top:6px';
  box.append(title, info);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };

  if (!measures) {
    info.textContent = label('strum.bake.none');
    row.append(mk(label('strum.bake.close'), 'bake-close', close));
    box.append(row);
  } else {
    const previewLabel = document.createElement('div'); previewLabel.textContent = label('strum.bake.preview'); previewLabel.style.cssText = 'font-size:12px;color:var(--ink-soft,#555);margin-top:4px';
    // the preview is computed once the dialog is on screen (a big score can take a moment); again when the measures or the size change
    let timer = 0;
    const draw = () => {
      info.textContent = label('strum.bake.measures', { from: measures.from + 1, to: measures.to + 1 });
      error.textContent = ''; preview.textContent = label('strum.bake.computing');
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { preview.innerHTML = bakePreviewSvg({ doc: app.doc, glyphs, staffId, measures, staffSpace: size, user: app.userPlayLists() }); } catch (e) { preview.textContent = ''; error.textContent = label('strum.bake.error', { message: e.message }); }
      }, 30);
    };
    const step = (text, hint, act, fn) => { const b = mk(text, act, fn); b.title = hint; b.setAttribute('aria-label', hint); b.style.padding = '0 10px'; return b; };
    const span = (text) => { const e = document.createElement('span'); e.textContent = text; e.style.cssText = 'margin:0 4px'; return e; };
    const moveFrom = (d) => { measures = { from: Math.max(0, Math.min(measures.from + d, measures.to)), to: measures.to }; draw(); };
    const moveTo = (d) => { measures = { from: measures.from, to: Math.min(count - 1, Math.max(measures.to + d, measures.from)) }; draw(); };
    const resize = (d) => { size = Math.max(4, Math.min(16, size + d)); draw(); };
    const controls = document.createElement('div'); controls.style.cssText = 'display:flex;gap:var(--btn-gap,2px);align-items:center;flex-wrap:wrap';
    controls.append(span(label('strum.bake.from')), step('−', label('strum.bake.fromLess'), 'bake-from-less', () => moveFrom(-1)), step('+', label('strum.bake.fromMore'), 'bake-from-more', () => moveFrom(1)),
      span(label('strum.bake.to')), step('−', label('strum.bake.toLess'), 'bake-to-less', () => moveTo(-1)), step('+', label('strum.bake.toMore'), 'bake-to-more', () => moveTo(1)),
      span(label('strum.bake.size')), step('A−', label('strum.bake.smaller'), 'bake-smaller', () => resize(-1)), step('A+', label('strum.bake.bigger'), 'bake-bigger', () => resize(1)));
    draw();
    const targets = app.bakeTargets(staffId);
    let target = 'new';
    const menu = createChoiceMenu({ options: [['new', label('strum.bake.newTrack')], ...targets.map((t) => [t.id, t.name])], value: target, label: label('strum.bake.target'), act: 'bake-target', onPick: (v) => { target = v; } });
    const targetRow = document.createElement('div'); targetRow.style.cssText = 'display:flex;gap:var(--btn-gap,2px);align-items:center;flex-wrap:wrap;margin-top:6px';
    const targetLabel = document.createElement('span'); targetLabel.textContent = label('strum.bake.target');
    targetRow.append(targetLabel, menu);
    const off = createSwitch({ checked: false, text: label('strum.bake.deactivate'), attrs: { 'data-bake-deactivate': '' } });
    row.append(mk(label('strum.bake.write'), 'bake-write', () => {
      error.textContent = '';
      try { app.bakeRhythm(staffId, { measures, target: target === 'new' ? { kind: 'new' } : { kind: 'track', trackId: target }, deactivate: off.checked }); close(); } catch (e) { error.textContent = label('strum.bake.error', { message: e.message }); }
    }), mk(label('strum.bake.close'), 'bake-close', close));
    const isChordStaff = app.doc.get(app.doc.find(staffId), PID.STAFF_TYPE) === 'chord' && !app.playerOfStaff(staffId); // nothing to switch off: the chord symbols keep their own sound setting
    box.append(controls, previewLabel, preview, targetRow, ...(isChordStaff ? [] : [off]), error, row);
  }
  veil.append(box);
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(veil);
}
