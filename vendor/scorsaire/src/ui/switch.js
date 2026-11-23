// A two-state button that replaces a check box: same `checked` property and `change` event, so callers keep their logic.
// The pressed look comes from the global `aria-pressed="true"` style.
export function createSwitch({ checked = false, text = '', attrs = {}, onchange = null } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-pressed', String(!!checked));
  for (const [k, v] of Object.entries(attrs)) if (v !== false && v != null) b.setAttribute(k, v === true ? '' : String(v));
  if (text) b.textContent = text;
  Object.defineProperty(b, 'checked', {
    get: () => b.getAttribute('aria-pressed') === 'true',
    set: (v) => b.setAttribute('aria-pressed', String(!!v)),
  });
  b.addEventListener('click', () => { b.checked = !b.checked; b.dispatchEvent(new Event('change', { bubbles: true })); });
  if (onchange) b.addEventListener('change', onchange);
  return b;
}
