/*
 * Staff text written IN PLACE (decided with Jean, 19/10/2026), like the lyrics: a small text field posed where the text will be drawn, above or below the staff at the
 * instant of the selection (a note / chord, or the start of the range). The buttons (above / below, normal / italic / bold, validate, cancel) are in the context bar
 * (`dom.js`, via `state()` / `set()` / `commit()` / `cancel()`); Enter validates, Escape cancels. One undoable transaction (`app.addStaffText`).
 * The field floats in the stage (absolute position): the score never moves.
 */
import { cursorOfElement } from './noteentry-cursor.js';

export function mountStaffTextEditor({ stage, view, app, label, stageVisible, entryMessage = () => {} }) {
  let active = null; // { sysTarget, staffId, ids, range, placement, style, line (null | 'solid' | 'dashed'), hook, span (measures covered by the line) }
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) fn(); };

  const field = document.createElement('div');
  field.setAttribute('data-stafftext-field', ''); field.setAttribute('role', 'group');
  field.style.cssText = 'display:none;position:absolute;left:0;top:0;z-index:9;box-sizing:border-box;background:var(--field,#fff);border:2px solid var(--sel-edge,#2d78ff);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.25)';
  const input = document.createElement('input');
  input.type = 'text'; input.maxLength = 60; input.setAttribute('data-stafftext-input', '');
  input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off'); input.spellcheck = false;
  input.setAttribute('enterkeyhint', 'done'); input.setAttribute('aria-label', label('system.staffTextFree')); input.placeholder = label('stafftext.placeholder');
  field.append(input);
  stage.append(field);

  const fit = () => {
    const px = Math.max(16, Math.round(2 * view.staffSpace()));
    const st = active?.style ?? 'normal';
    input.style.cssText = `border:0;outline:0;background:transparent;text-align:center;font:${st === 'italic' ? 'italic' : st === 'bold' ? 'bold' : 'normal'} ${px}px Georgia,'Times New Roman',serif;height:${Math.round(px * 1.6)}px;padding:0 6px;box-sizing:border-box;width:${Math.max(8, input.value.length + 2)}ch;min-width:8ch`;
  };

  const anchor = () => {
    if (!active) return null;
    if (active.ids?.length) {
      const el = app.doc.find(active.ids[0]);
      const chord = el && el.type !== 'chord' && el.type !== 'rest' ? app.doc.parentOf(el.id) : el;
      const at = chord ? cursorOfElement(app.doc, chord.id) : null;
      const r = at ? view.entryCursorRect(at) : null;
      if (r) return { cx: r.x + r.w / 2, top: r.y1, bottom: r.y2 };
    }
    const bands = view.rangeBands();
    if (bands.length) return { cx: bands[0].x1 + 8, top: bands[0].y1, bottom: bands[0].y2 };
    return null;
  };
  const place = () => {
    if (!active) { field.style.display = 'none'; return; }
    const a = anchor();
    if (!a) { field.style.display = 'none'; return; }
    field.style.display = 'block';
    const ss = view.staffSpace();
    const visible = stageVisible();
    const w = field.offsetWidth, h = field.offsetHeight;
    const yc = active.placement === 'above' ? a.top - 2.4 * ss : a.bottom + 2.6 * ss;
    const x = Math.min(Math.max(a.cx - w / 2, visible.left), Math.max(visible.left, visible.right - w));
    field.style.left = `${Math.round(x)}px`; field.style.top = `${Math.round(yc - h / 2)}px`;
  };

  const end = () => { active = null; input.value = ''; field.style.display = 'none'; changed(); };
  const commit = () => {
    if (!active) return false;
    const text = input.value.trim();
    if (!text) { end(); return false; }
    const { sysTarget, staffId, placement, style, line, hook, span } = active;
    try { app.addStaffText(sysTarget, staffId, { text, style, placement, ...(line ? { line, hook, lineSpan: span } : {}) }, view.id); entryMessage(''); } catch (e) { entryMessage(String(e?.message ?? e)); }
    end();
    return true;
  };
  input.addEventListener('input', () => { fit(); place(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // never a note-entry key while writing a text
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); end(); }
  });

  return {
    /** Starts the editor for `{ sysTarget, staffId, ids, range }`; text above the staff, normal style by default. */
    start(spec) {
      // the line covers the measures of the range at first (one without a range); the user changes it with the − / + of the bar
      const covered = app.bakeMeasures?.();
      active = { ...spec, placement: 'above', style: 'normal', line: null, hook: false, span: covered ? covered.to - covered.from + 1 : 1 };
      input.value = ''; fit(); changed(); place();
      input.focus({ preventScroll: true }); // inside the tap that pressed the button: the touch keyboard opens
    },
    set(patch) { if (!active) return; active = { ...active, ...patch }; fit(); place(); input.focus({ preventScroll: true }); changed(); },
    state: () => (active ? { placement: active.placement, style: active.style, line: active.line, hook: active.hook, span: active.span } : null),
    isActive: () => active !== null,
    commit, cancel: end, place,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { field.remove(); listeners.clear(); },
  };
}
