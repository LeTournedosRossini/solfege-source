/*
 * Templates: capture the tracks of a movement as a template, validate user templates, load a template into a movement.
 * Pure model operations: `applyTemplate` / `removeAllTracks` MUST be called inside `doc.transaction`.
 * See templates.js for the template shape.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { instrumentInfo, instrumentDisplayName } from './instruments.js';
import { addTrack, addTrackFromInstrument, removeTrack, CREATABLE_STAFF_TYPES, EditError } from './trackedit.js';
import { chordTrackOf } from './chordtrack.js';
import { groupTracks, clearGroups, walkGroups } from './groupedit.js';
import { hasScoreOrder, applyScoreOrder, refreshAutoGroups, planScoreOrder } from './scoreorder.js';
import { isTrackIcon } from './icons.js';
import { SID_TABLE } from './sid.js';

export { EditError };

export const TEMPLATE_FORMAT = 'scorsaire-templates';
const MAX_PARTS = 80;
/** Local staff properties kept by a captured template (everything else is a property of the score's CONTENT or a derived value). */
const STAFF_PROPS = [PID.CONCERT_CLEF, PID.TUNING, PID.LINE_COUNT, PID.PERCMAP, PID.TAB_STYLE, PID.RHYTHM_HEAD, PID.RHYTHM_STEM, PID.RHYTHM_SOUND,
  PID.STICKING_SYSTEM, PID.FINGERING_MAP, PID.ACCORDION_LAYOUT, PID.CHORD_SPELLING, PID.STAFF_LINE_THICKNESS];

let counter = 0;
const newId = () => `u${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/** Captures the tracks, staves and groups of a movement as a user template. */
export function templateFromMovement(mv, name) {
  const text = String(name ?? '').trim();
  if (!text) throw new EditError('A template needs a name');
  const parts = mv.tracks.map((track) => ({
    instrument: getProperty(track, PID.INSTRUMENT_ID) ?? null,
    name: getProperty(track, PID.NAME) ?? '',
    abbreviation: getProperty(track, PID.ABBREVIATION) ?? '',
    ...(getProperty(track, PID.ICON) ? { icon: getProperty(track, PID.ICON) } : {}),
    ...(getProperty(track, PID.TRANSPOSITION) ? { transposition: structuredClone(getProperty(track, PID.TRANSPOSITION)) } : {}),
    staves: track.staves.map((staff) => {
      const props = {};
      for (const pid of STAFF_PROPS) if (Object.hasOwn(staff.props, pid) && staff.props[pid] !== null) props[pid] = structuredClone(staff.props[pid]);
      return { type: getProperty(staff, PID.STAFF_TYPE), clef: getProperty(staff, PID.CLEF), props };
    }),
  }));
  const index = (id) => mv.tracks.findIndex((t) => t.id === id);
  const groupsOf = (list) => list.map((g) => ({
    from: index(getProperty(g, PID.START_TRACK_ID)), to: index(getProperty(g, PID.END_TRACK_ID)), style: getProperty(g, PID.BRACKET_STYLE),
    ...(getProperty(g, PID.LABEL) ? { label: getProperty(g, PID.LABEL) } : {}), barlines: getProperty(g, PID.GROUP_BARLINES), groups: groupsOf(g.groups),
  }));
  const order = getProperty(mv, PID.GROUP_ORDER);
  // the movement's own style settings (names of tracks, labels, tablature options…): applied when the template REPLACES the tracks
  const style = Object.keys(mv.style ?? {}).length ? JSON.parse(JSON.stringify(mv.style)) : undefined; // (the style is a guarded object: not structuredClone-able)
  return { id: newId(), name: text, order: order && order !== 'custom' ? order : null, parts, groups: groupsOf(mv.groups), ...(style ? { style } : {}), source: 'user' };
}

/** Validation of a user template (list of messages; empty = valid). */
export function validateTemplate(t) {
  const errs = [];
  if (!t || typeof t !== 'object') return ['template: object expected'];
  if (typeof t.id !== 'string' || !t.id) errs.push('template: id missing');
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 80) errs.push('template: name missing or too long');
  if (t.order !== null && t.order !== undefined && (typeof t.order !== 'string' || !hasScoreOrder(t.order))) errs.push(`template ${t.id}: unknown score order`);
  if (!Array.isArray(t.parts) || !t.parts.length || t.parts.length > MAX_PARTS) { errs.push(`template ${t.id}: 1 to ${MAX_PARTS} parts expected`); return errs; }
  t.parts.forEach((p, i) => {
    const where = `template ${t.id}, part ${i + 1}`;
    if (p.instrument !== null && p.instrument !== undefined && (typeof p.instrument !== 'string' || !instrumentInfo(p.instrument))) errs.push(`${where}: unknown instrument`);
    if (p.icon !== undefined && p.icon !== null && !isTrackIcon(p.icon)) errs.push(`${where}: unknown icon`);
    if (!Array.isArray(p.staves) || !p.staves.length) errs.push(`${where}: at least one staff`);
    else for (const s of p.staves) if (!CREATABLE_STAFF_TYPES.includes(s.type)) errs.push(`${where}: unknown staff type ${s.type}`);
  });
  const checkGroups = (list, lo, hi) => {
    for (const g of list ?? []) {
      if (!Number.isInteger(g.from) || !Number.isInteger(g.to) || g.from < lo || g.to > hi || g.from > g.to) { errs.push(`template ${t.id}: invalid group range`); continue; }
      checkGroups(g.groups, g.from, g.to);
    }
  };
  checkGroups(t.groups, 0, t.parts.length - 1);
  if (t.style !== undefined) {
    if (!t.style || typeof t.style !== 'object' || Array.isArray(t.style)) errs.push(`template ${t.id}: style must be an object`);
    else {
      for (const [k, v] of Object.entries(t.style)) {
        const def = SID_TABLE[k];
        if (!def) errs.push(`template ${t.id}: unknown style ${k}`);
        else if ((def.type === 'bool' && typeof v !== 'boolean') || ((def.type === 'real' || def.type === 'int') && typeof v !== 'number') || (def.type === 'string' && typeof v !== 'string')) errs.push(`template ${t.id}: style ${k} has the wrong type`);
      }
    }
  }
  return errs;
}

export function validateTemplateList(value) {
  if (!value || !Array.isArray(value.items)) return ['templates: { items: [] } expected'];
  const errs = [];
  const seen = new Set();
  for (const t of value.items) {
    errs.push(...validateTemplate(t));
    if (seen.has(t?.id)) errs.push(`templates: duplicate id ${t?.id}`);
    seen.add(t?.id);
  }
  return errs;
}

/**
 * Names of the tracks a template creates, in `lang`: [{ instrument, name, abbreviation }]. A built-in template names its tracks from the
 * catalogue and numbers an instrument that occurs several times (« Flûte 1 », « Flûte 2 »); a user template keeps the names it was saved with.
 */
/** The template without the parts whose indices are in `off` (a Set); the ranges of its brackets are remapped onto the kept parts. */
export function filterTemplate(template, off) {
  if (!off || !off.size) return template;
  const kept = []; // old index → new index (or -1)
  let n = 0;
  template.parts.forEach((_, i) => kept.push(off.has(i) ? -1 : n++));
  const remap = (list) => (list ?? []).flatMap((g) => {
    let from = -1; let to = -1;
    for (let i = g.from; i <= g.to; i++) if (kept[i] >= 0) { if (from < 0) from = kept[i]; to = kept[i]; }
    return from < 0 ? [] : [{ ...g, from, to, ...(g.groups ? { groups: remap(g.groups) } : {}) }];
  });
  return { ...template, parts: template.parts.filter((_, i) => kept[i] >= 0), ...(template.groups ? { groups: remap(template.groups) } : {}) };
}

export function templatePartNames(template, lang = 'en') {
  const builtin = template.source === 'musescore';
  const total = new Map();
  for (const p of template.parts) if (p.instrument) total.set(p.instrument, (total.get(p.instrument) ?? 0) + 1);
  const seen = new Map();
  return template.parts.map((part) => {
    const info = part.instrument ? instrumentInfo(part.instrument) : null;
    if (!info) return { instrument: part.instrument ?? null, name: part.name ?? '', abbreviation: part.abbreviation ?? '' };
    seen.set(part.instrument, (seen.get(part.instrument) ?? 0) + 1);
    const n = seen.get(part.instrument);
    const base = instrumentDisplayName(part.instrument, lang, 'trackName') ?? '';
    const short = instrumentDisplayName(part.instrument, lang, 'shortName') ?? '';
    if (!builtin) return { instrument: part.instrument, name: part.name ?? base, abbreviation: part.abbreviation ?? short };
    const numbered = total.get(part.instrument) > 1;
    return { instrument: part.instrument, name: numbered ? `${base} ${n}` : base, abbreviation: numbered && short ? `${short} ${n}` : short };
  });
}

/** Removes every track of the movement (and so its groups). CALL INSIDE A TRANSACTION. */
export function removeAllTracks(doc, mv) {
  for (const track of [...mv.tracks]) removeTrack(doc, mv, track);
}

/**
 * Loads a template into a movement. CALL INSIDE A TRANSACTION.
 * @param opts { mode: 'add' | 'replace', lang }
 * @returns {{ added: string[], skipped: string[] }} new track ids; skipped = instrument ids the catalogue does not know
 */
export function applyTemplate(doc, mv, template, { mode = 'add', lang = 'en' } = {}) {
  const wasEmpty = mv.tracks.length === 0;
  if (mode === 'replace') { clearGroups(doc, mv); removeAllTracks(doc, mv); }
  const builtin = template.source === 'musescore';
  const added = [];
  const skipped = [];
  const ids = []; // template part index → new track id (or null)
  const names = templatePartNames(template, lang);
  template.parts.forEach((part, index) => {
    const info = part.instrument ? instrumentInfo(part.instrument) : null;
    if (part.instrument && !info) { skipped.push(part.instrument); ids.push(null); return; }
    const staves = part.staves.map((s) => ({ type: s.type, clef: s.clef, lineCount: s.lineCount, props: s.props }));
    // a movement has only one chord track: a second one from a template is left out (reported as skipped); a first one lands at the top
    if (staves.some((s) => s.type === 'chord') && chordTrackOf(mv)) { skipped.push('chord'); ids.push(null); return; }
    let track;
    if (info) {
      const props = {};
      if (part.icon) props[PID.ICON] = part.icon;
      if (part.transposition) props[PID.TRANSPOSITION] = structuredClone(part.transposition);
      track = addTrackFromInstrument(doc, mv, part.instrument, {
        lang, staves, props,
        name: names[index].name, abbreviation: names[index].abbreviation,
      });
    } else {
      const props = {};
      if (part.icon) props[PID.ICON] = part.icon;
      track = addTrack(doc, mv, {
        staves: staves.map((s) => ({ type: s.type, clef: s.clef ?? 'G', props: { ...(s.lineCount !== undefined ? { [PID.LINE_COUNT]: s.lineCount } : {}), ...(s.props ?? {}) } })),
        name: names[index].name, abbreviation: names[index].abbreviation, transposition: part.transposition ? structuredClone(part.transposition) : null, props,
      });
    }
    ids.push(track.id);
    added.push(track.id);
  });

  // groups: a user template carries its own brackets; a built-in one is grouped by its score order
  const auto = getProperty(mv, PID.GROUP_ORDER);
  const movementAuto = auto && auto !== 'custom' && hasScoreOrder(auto);
  const firstNew = added.length ? mv.tracks.findIndex((t) => t.id === added[0]) : -1;
  if (template.order && builtin && mode === 'add' && !wasEmpty && !movementAuto && firstNew >= 0 && hasScoreOrder(template.order)) {
    // tracks added next to hand-made ones: bracket only the NEW tracks the way the order would; the movement stays manual
    const plan = planScoreOrder(mv, template.order).filter((s) => s.from >= firstNew);
    for (const spec of [...plan.filter((s) => s.style === 'normal'), ...plan.filter((s) => s.style === 'square')]) {
      try {
        groupTracks(doc, mv, mv.tracks.slice(spec.from, spec.to + 1).map((t) => t.id), { style: spec.style, barlines: spec.barlines, auto: true });
      } catch (e) { if (!(e instanceof EditError)) throw e; }
    }
  } else if (template.order && hasScoreOrder(template.order) && (mode === 'replace' || wasEmpty || !movementAuto) && (builtin || !template.groups?.length)) {
    if (mode === 'replace' || wasEmpty) applyScoreOrder(doc, mv, template.order, { sort: false });
  } else if (!builtin && template.groups?.length && (mode === 'replace' || wasEmpty)) {
    const make = (list) => {
      for (const g of list) {
        const members = ids.slice(g.from, g.to + 1).filter(Boolean);
        if (members.length) {
          try { groupTracks(doc, mv, members, { style: g.style, label: g.label, barlines: g.barlines, auto: true }); } catch (e) { if (!(e instanceof EditError)) throw e; }
        }
        make(g.groups ?? []);
      }
    };
    make(template.groups);
    doc.set(mv, PID.GROUP_ORDER, template.order && hasScoreOrder(template.order) ? template.order : 'custom');
  }
  if (movementAuto && mode === 'add') refreshAutoGroups(doc, mv, { sort: true });
  // style of the movement: only when the template REPLACES the tracks (or the movement was empty), never over an existing score's settings
  if (!builtin && template.style && (mode === 'replace' || wasEmpty)) {
    for (const [sid, value] of Object.entries(template.style)) if (SID_TABLE[sid]) doc.setStyle(mv, sid, value);
  }
  void walkGroups;
  return { added, skipped };
}
