/*
 * The menu of the ROLES of a layout for a tablet (model/partroles.js): a list in families (rhythm section, strings, woodwinds, brass, voices). A code that is not in the
 * presets (a free one, typed in an older file) stays selectable so that nothing is lost.
 */
import { ROLE_GROUPS, PART_ROLES } from '../model/partroles.js';

/** @returns the <select>; `onChange(code|'')` is called when the person picks. */
export function createRoleSelect({ label, value = '', onChange = null, css = '' }) {
  const select = document.createElement('select');
  if (css) select.style.cssText = css;
  select.setAttribute('data-field', 'role'); select.setAttribute('aria-label', label('parts.role')); select.title = label('parts.roleHint');
  const none = document.createElement('option'); none.value = ''; none.textContent = label('parts.roleNone'); select.append(none);
  for (const g of ROLE_GROUPS) {
    const og = document.createElement('optgroup'); og.label = label(`parts.roleGroup.${g.id}`);
    for (const r of g.roles) { const o = document.createElement('option'); o.value = r; o.textContent = `${r} — ${label(`parts.role.${r}`)}`; og.append(o); }
    select.append(og);
  }
  if (value && !PART_ROLES.includes(value)) { const o = document.createElement('option'); o.value = value; o.textContent = value; select.append(o); }
  select.value = value ?? '';
  if (onChange) select.addEventListener('change', () => onChange(select.value));
  return select;
}
