/*
 * "Select similar": from one selected thing (a dynamic, an articulation, a hairpin, a slur, a note, a chord symbol…) find the others of the same kind in a staff, a track or the
 * whole movement. PURE (reads the work, writes nothing).
 *   describeSelectable(work, id)                       → { kind, sig, scope: { staff, track, movement } } | null
 *   similarIds(work, id, { scope, match })             → ids, the selected one included;  scope 'staff' | 'track' | 'movement',  match 'same' | 'kind'
 * "same" = the same kind AND the same value (every mezzo-piano, every staccato, every "Am"); "kind" = any of its kind (every dynamic whatever it says).
 * A list entry or a mark (dynamic, articulation, hairpin, slur, tie, bend, fingering, staff text…) is found through the list index; a plain element (note, rest, chord symbol…) by its type.
 */
import { PID } from './pid.js';
import { walk, buildIndex } from './store.js';
import { buildListEntryIndex } from './listindex.js';

const NOTE_TYPES = new Set(['note', 'tabnote', 'percnote', 'accnote', 'rhythmnote']);
const SCOPES = ['staff', 'track', 'movement'];

/** What makes two entries of a kind "the same" (their value, never their anchors). */
function entrySignature(kind, entry) {
  switch (kind) {
    case 'dynamic': return JSON.stringify(entry.value);
    case 'articulation': return String(entry.type ?? '');
    case 'hairpin': return String(entry.hairpinType ?? '');
    case 'fingering': return `${entry.kind ?? ''}:${entry.text ?? ''}`;
    case 'stafftext': return String(entry.text ?? '');
    case 'glissando': return String(entry.glissandoType ?? '');
    case 'bend': return String(entry.type ?? '');
    case 'techline': case 'pedal': return String(entry.type ?? '');
    case 'arpeggio': case 'chordtremolo': case 'tapping': case 'chordline': return JSON.stringify(entry.value ?? null);
    default: return '';
  }
}

const ground = (v) => JSON.stringify(v ?? null);

/** What makes two plain elements "the same". */
function elementSignature(el) {
  if (NOTE_TYPES.has(el.type)) return String(el.props?.[PID.PITCH] ?? '');
  if (el.type === 'chord' || el.type === 'rest') return ground(el.props?.[PID.DURATION]);
  if (el.type === 'chordsymbol') return ground([el.props?.[PID.CHORD_ROOT], el.props?.[PID.CHORD_QUALITY], el.props?.[PID.CHORD_BASS]]);
  if (el.type === 'lyricevent') return String(el.props?.[PID.TEXT] ?? '');
  return '';
}

const kindOfElement = (el) => (NOTE_TYPES.has(el.type) ? 'note' : el.type);

/** Ancestors of an element: { staff, track, movement } (any may be null). */
function ancestorsOf(index, id) {
  const out = { staff: null, track: null, movement: null };
  let cur = index.get(id);
  while (cur) {
    const t = cur.el.type;
    if (t === 'staff' && !out.staff) out.staff = cur.el;
    else if (t === 'track' && !out.track) out.track = cur.el;
    else if (t === 'movement' && !out.movement) out.movement = cur.el;
    cur = cur.parent ? index.get(cur.parent.id) : null;
  }
  return out;
}

export function describeSelectable(work, id, index = buildIndex(work), entries = buildListEntryIndex(work, (i) => index.has(i))) {
  const entry = entries.byId.get(id);
  if (entry) return { kind: `mark:${entry.kind}`, sig: entrySignature(entry.kind, entry.entry), scope: ancestorsOf(index, entry.owner.id) };
  const found = index.get(id);
  if (!found) return null;
  return { kind: kindOfElement(found.el), sig: elementSignature(found.el), scope: ancestorsOf(index, id) };
}

export function similarIds(work, id, { scope = 'movement', match = 'same' } = {}) {
  if (!SCOPES.includes(scope)) throw new Error(`Unknown scope « ${scope} »`);
  const index = buildIndex(work);
  const entries = buildListEntryIndex(work, (i) => index.has(i));
  const me = describeSelectable(work, id, index, entries);
  if (!me) return [];
  const root = me.scope[scope];
  if (!root) return [id];
  const inside = new Set();
  const found = [];
  walk(root, (el) => {
    inside.add(el.id);
    if (el.type === 'work' || el.type === 'movement' || el.type === 'track' || el.type === 'staff' || el.type === 'voice' || el.type === 'measure') return;
    const sig = elementSignature(el);
    if (kindOfElement(el) === me.kind && (match === 'kind' || sig === me.sig)) found.push(el.id);
  });
  for (const [entryId, e] of entries.byId) {
    if (!inside.has(e.owner.id)) continue;
    if (`mark:${e.kind}` !== me.kind) continue;
    if (match === 'kind' || entrySignature(e.kind, e.entry) === me.sig) found.push(entryId);
  }
  return found.includes(id) ? found : [id, ...found];
}
