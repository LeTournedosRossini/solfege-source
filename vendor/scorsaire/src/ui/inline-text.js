/*
 * One-line text field written IN PLACE (like the lyrics and the staff text), replacing `window.prompt`.
 * The field floats in the stage (absolute position, the score never moves) above the anchor rectangle given by `anchor()`
 * ({ cx, top, bottom } in SVG pixels), with its own ✓ / ✕ buttons (they never steal the focus: the touch keyboard stays open).
 * Enter validates, Escape cancels. `open({ anchor, value, placeholder, aria, onCommit })`; `onCommit(text)` is called with the trimmed
 * non-empty text (an empty text just closes). Nothing is written here: the caller does the (undoable) edit.
 */
export function mountInlineText({ stage, label, stageVisible, afterPlace = () => {} }) {
  let active = null; // { anchor, onCommit }
  const field = document.createElement('div');
  field.setAttribute('data-inline-text', ''); field.setAttribute('role', 'group');
  field.style.cssText = 'display:none;position:absolute;left:0;top:0;z-index:9;box-sizing:border-box;background:var(--field,#fff);border:2px solid var(--sel-edge,#2d78ff);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.25);align-items:center';
  const input = document.createElement('input');
  input.type = 'text'; input.maxLength = 80; input.setAttribute('data-inline-text-input', '');
  for (const [k, v] of [['autocomplete', 'off'], ['autocapitalize', 'off'], ['autocorrect', 'off'], ['enterkeyhint', 'done']]) input.setAttribute(k, v);
  input.spellcheck = false;
  input.style.cssText = 'border:0;outline:0;background:transparent;font:16px var(--ui-font,sans-serif);height:var(--ui-target,44px);padding:0 8px;box-sizing:border-box;min-width:12ch';
  const mk = (txt, act, titleKey, fn) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.setAttribute('data-act', act); b.title = label(titleKey); b.setAttribute('aria-label', label(titleKey));
    b.style.cssText = 'width:var(--ui-target,44px);height:var(--ui-target,44px);border:0;background:transparent;font:18px var(--ui-font,sans-serif);cursor:pointer';
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the focus in the field
    b.addEventListener('click', fn); return b;
  };
  field.append(input, mk('✓', 'inline-ok', 'inline.validate', () => commit()), mk('✕', 'inline-cancel', 'inline.cancel', () => end()));
  stage.append(field);

  const fit = () => { input.style.width = `${Math.max(12, input.value.length + 2)}ch`; };
  const place = () => {
    if (!active) { field.style.display = 'none'; return; }
    const a = active.anchor();
    if (!a) { field.style.display = 'none'; return; }
    field.style.display = 'flex';
    const visible = stageVisible();
    const w = field.offsetWidth, h = field.offsetHeight;
    const above = a.top - h - 6;
    const y = above >= visible.top ? above : a.bottom + 6; // below when there is no room above
    const x = Math.min(Math.max(a.cx - w / 2, visible.left), Math.max(visible.left, visible.right - w));
    field.style.left = `${Math.round(x)}px`; field.style.top = `${Math.round(y)}px`;
    afterPlace();
  };
  const end = () => { active = null; input.value = ''; field.style.display = 'none'; };
  const commit = () => {
    if (!active) return false;
    const text = input.value.trim(); const { onCommit } = active; end();
    if (text) onCommit(text);
    return !!text;
  };
  input.addEventListener('input', () => { fit(); place(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // never a note-entry key while writing
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); end(); }
  });
  return {
    open({ anchor, value = '', placeholder = '', aria = '', onCommit }) {
      active = { anchor, onCommit };
      input.value = value; input.placeholder = placeholder; input.setAttribute('aria-label', aria || placeholder); fit(); place();
      input.focus({ preventScroll: true }); input.select(); // inside the tap that pressed the button: the touch keyboard opens
    },
    isActive: () => active !== null,
    /** Box of the field in stage pixels (for the bar to avoid it). */
    rect: () => ({ x: field.offsetLeft, y: field.offsetTop, w: field.offsetWidth, h: field.offsetHeight }), cancel: end, commit, place,
    dispose() { field.remove(); },
  };
}
