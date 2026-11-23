// Grouping for the pickers of styles, grooves, patterns and cards (`createChoiceMenu` takes the result): the built-in ones, the user's own (this device) and the project's, each under its title,
// the user's and the project's in FOLDERS (a sub-menu per `folder` name, one level) when they have been put in some. With a single origin there is no title (nothing to tell apart).
// `items` = [{ id, source: 'builtin' | 'user' | 'project', folder?, ... }].
const BROWSE_FROM = 6; // from this many items a "See all…" button is offered next to the heading of the user's (or the project's) group
const ORIGINS = [['builtin', 'menu.group.builtin'], ['user', 'menu.group.user'], ['project', 'menu.group.project']];

/**
 * @param o { text(item) → the name shown, label(key) → a text of the language catalog, head: options put first and kept out of the groups (a "none" entry),
 *   browse: the title of the "See all…" window (a button on the heading of the user's group, or the project's, once there are more than `BROWSE_FROM` items; `createChoiceMenu` opens it) }
 * @returns the structured options of `createChoiceMenu`
 */
export function groupedOptions(items, { text, label, head = [], browse = null }) {
  const present = ORIGINS.filter(([source]) => items.some((i) => i.source === source));
  const out = [...head];
  const browseAt = browse && items.length > BROWSE_FROM ? (present.find(([s]) => s === 'user') ?? present.find(([s]) => s === 'project'))?.[0] : null;
  for (const [source, key] of present) {
    const list = items.filter((i) => i.source === source);
    const more = source === browseAt ? { label: label('menu.browse'), items, text, labelOf: label, title: browse } : null;
    if (present.length > 1 || more) out.push({ heading: label(key), ...(more ? { more } : {}) });
    out.push(...list.filter((i) => !i.folder).map((i) => [i.id, text(i)]));
    for (const folder of folderNames(list)) out.push({ folder, items: list.filter((i) => i.folder === folder).map((i) => [i.id, text(i)]) });
  }
  return out;
}

/** The folders in use among `items`, sorted. */
export const folderNames = (items) => [...new Set(items.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** A text field for the folder of an item, with the folders already in use offered (`<datalist>`); `onChange(name | null)`. */
export function folderField({ value = null, folders = [], label, disabled = false, onChange, style = '' }) {
  const id = `folders-${Math.random().toString(36).slice(2, 8)}`;
  const input = document.createElement('input');
  input.type = 'text'; input.value = value ?? ''; input.placeholder = label('folder.placeholder'); input.title = label('folder.hint'); input.setAttribute('aria-label', label('folder.label'));
  input.setAttribute('list', id); input.setAttribute('data-key', 'folder'); input.disabled = disabled;
  input.style.cssText = `font-size:14px;min-height:30px;box-sizing:border-box;width:9em;${style}`;
  input.addEventListener('change', () => onChange(input.value.trim() || null));
  const list = document.createElement('datalist'); list.id = id;
  for (const f of folders) { const o = document.createElement('option'); o.value = f; list.append(o); }
  const wrap = document.createElement('span'); wrap.style.cssText = 'display:inline-flex'; wrap.append(input, list);
  return wrap;
}
