// Display categories of a staff: what the user may show / hide / recolour as a group (menu « Affichage » of a track). PURE.
// A category is decided from the display item alone (role, glyph name, `sel` / `ref`), plus for rests whether the rest is automatic.
// Hidden items are REMOVED after everything is placed (so every other element keeps its place); a colour sets `tint` (the renderer draws the item in it).
import { parseDecorId } from '../model/decor.js';
export { DISPLAY_CATEGORIES } from '../model/trackdisplay.js'; // `bars` is hidden through the track's `showBars` (kept for the files that already use it)

const NOTE_ROLES = new Set(['stem', 'stem-slash', 'beam', 'flag', 'dot', 'accidental', 'ledger', 'tuplet-number', 'tremolo', 'parenthesis', 'fret-box', 'slash']);
const SLUR_ROLES = new Set(['slur', 'tie', 'hopo', 'hopo-text']);
const DYNAMIC_ROLES = new Set(['dynamic', 'hairpin']);
const ARTIC_ROLES = new Set(['articulation', 'arpeggio', 'chord-line']);
const BAR_ROLES = new Set(['barline', 'repeat-dot', 'repeat-tip']);
const isNoteGlyph = (name) => /^(notehead|noteShape|tabFret)/.test(name ?? '');
const isRestGlyph = (name) => /^rest/.test(name ?? '');
const isClefGlyph = (name) => /Clef/.test(name ?? '');

/**
 * Category of a display item, or null when it belongs to none (text of a mark, tempo, volta…: left alone).
 * @param isAutoRest (id) => boolean : the rest with this id is an automatic rest
 */
export function categoryOf(item, isAutoRest = () => false) {
  const role = item.role;
  if (role === 'staff-line') return 'lines';
  if (BAR_ROLES.has(role)) return 'bars';
  if (role === 'clef') return 'clefs';
  if (SLUR_ROLES.has(role)) return 'slurs';
  if (DYNAMIC_ROLES.has(role)) return 'dynamics';
  if (ARTIC_ROLES.has(role)) return 'articulations';
  if (typeof item.sel === 'string' && item.sel.startsWith('decor|')) {
    const kind = parseDecorId(item.sel)?.kind;
    if (kind === 'clef') return 'clefs';
    if (kind === 'keySig' || kind === 'timeSig') return 'signatures';
    if (kind === 'barline') return 'bars';
  }
  if (!role && isClefGlyph(item.name ?? item.glyph)) return 'clefs';
  const ref = item.ref;
  if (isRestGlyph(item.name ?? item.glyph) || (typeof ref === 'string' && /^r\d/.test(ref) && (role === 'dot' || !role))) return isAutoRest(ref) ? 'autoRests' : 'rests';
  if (NOTE_ROLES.has(role)) return 'notes';
  if (!role && isNoteGlyph(item.name ?? item.glyph)) return 'notes';
  return null;
}

/**
 * Applies the show / colour settings of a track to the items of one staff.
 * @param spec { hidden: Set<category>, colors: { all?: hex, <category>: hex } }
 * @returns the items (the same array when nothing changes)
 */
export function applyDisplayCategories(items, spec, isAutoRest) {
  const hidden = spec.hidden;
  const colors = spec.colors ?? {};
  if (!hidden?.size && !Object.keys(colors).length) return items;
  const out = [];
  let changed = false;
  for (const it of items) {
    const cat = categoryOf(it, isAutoRest);
    if (cat && hidden?.has(cat)) { changed = true; continue; }
    const color = (cat && colors[cat]) || colors.all;
    if (color && !it.tint) { out.push({ ...it, tint: color }); changed = true; } else out.push(it);
  }
  return changed ? out : items;
}
