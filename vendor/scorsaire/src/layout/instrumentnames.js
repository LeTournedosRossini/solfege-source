/*
 * Track names (or icons) written left of the staves (step 5, "tracks and staves" panel).
 * Rules of MuseScore 4.7.5 (`SystemLayout::layoutInstrumentNames`, `instrumentNamesWidth`, styles `firstSystemInstNameVisibility`,
 * `subsSystemInstNameVisibility`, `hideInstrumentNameIfOneInstrument`, `instrumentNameOffset`; all read):
 *   - one name per TRACK (part), drawn once, vertically centred on the track's staves, right-aligned just left of the brackets;
 *   - first system: the long name by default, the following systems: the short name (abbreviation); each can be long | short | icon | none;
 *   - nothing is written when the score has a single track (option);
 *   - the left margin of the systems makes room for the widest name.
 * Scorsaire additions: an ICON (a glyph of `model/icons.js`) can replace the text; a track without the chosen thing falls back to the text of
 * that position (long for the first system, short for the others).
 * ÉCARTS: the margin is the same on every system (MuseScore indents the first system by at least 5 sp and uses each system's own widest
 * name); text width is approximated (0.5 × size × characters, the font Edwin is not embedded).
 */
import { SID } from '../model/sid.js';
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { hasIconShape } from '../model/iconshapes.js';
import { instrumentInfo } from '../model/instruments.js';
import { instrumentIconName } from '../model/instrument-icons.js';

export const NAME_SIZE = 10 / ((1.75 * 72) / 25.4); // 10 pt in staff spaces (Sid::longInstrumentFontSize)
const ICON_MAX = 2.6; // sp, largest side of an icon
const CHAR_W = 0.5;

const textWidth = (text) => CHAR_W * NAME_SIZE * [...text].length;

function iconBox(glyphs, name) {
  // `ui:<name>`: an instrument icon of the interface (strokes on a 24 x 24 grid), drawn as a square
  if (typeof name === 'string' && name.startsWith('ui:')) return hasIconShape(name.slice(3)) ? { ui: true, natW: 1, natH: 1, w: ICON_MAX, h: ICON_MAX } : null;
  const g = glyphs.glyphs[name];
  if (!g) return null;
  const natW = g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0];
  const natH = g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1];
  const k = Math.min(1, ICON_MAX / Math.max(natW, natH));
  return { natW, natH, w: natW * k, h: natH * k };
}

/** The instrument icon of a track that has no icon of its own: the one of its catalogue instrument (`ui:<name>`), or null. */
function autoIcon(track) {
  const id = getProperty(track, PID.INSTRUMENT_ID);
  const name = id ? instrumentIconName(id, instrumentInfo(id)) : null;
  return name ? `ui:${name}` : null;
}

/** What a track shows at a position: { kind: 'text', text } | { kind: 'icon', name, box } | null. */
function contentOf(entry, mode, fallback, glyphs) {
  const text = (m) => (m === 'long' ? entry.name : m === 'short' ? entry.abbreviation : '');
  if (mode === 'none') return null;
  if (mode === 'icon') {
    const box = entry.icon ? iconBox(glyphs, entry.icon) : null;
    if (box) return { kind: 'icon', name: entry.icon, box };
    const t = text(fallback);
    return t ? { kind: 'text', text: t } : null;
  }
  const t = text(mode);
  return t ? { kind: 'text', text: t } : null;
}

/**
 * @returns {{ room: number, entries }} or null when nothing is written. `room` = width to reserve (names + offset); the entries keep their
 *          first / following system content.
 */
export function instrumentNamePlan(ctx, style, glyphs) {
  if (!style(SID.SHOW_INSTRUMENT_NAMES)) return null;
  const tracks = [];
  ctx.staves.forEach((s, i) => {
    const e = tracks.find((t) => t.track.id === s.track.id);
    if (e) e.last = i; else tracks.push({ track: s.track, first: i, last: i });
  });
  if (style(SID.HIDE_INSTRUMENT_NAME_IF_ONE) && tracks.length <= 1) return null;
  const first = style(SID.INSTRUMENT_NAME_FIRST);
  const next = style(SID.INSTRUMENT_NAME_NEXT);
  let widest = 0;
  const entries = tracks.map((t) => {
    const e = {
      ...t,
      name: getProperty(t.track, PID.NAME) ?? '',
      abbreviation: getProperty(t.track, PID.ABBREVIATION) ?? '',
      icon: getProperty(t.track, PID.ICON) ?? autoIcon(t.track),
      photo: Boolean(style(SID.SOPRANO_PHOTO)),
    };
    e.firstContent = contentOf(e, first, 'long', glyphs);
    e.nextContent = contentOf(e, next, 'short', glyphs);
    for (const c of [e.firstContent, e.nextContent]) {
      if (c) widest = Math.max(widest, c.kind === 'icon' ? c.box.w : textWidth(c.text));
    }
    return e;
  });
  if (widest === 0) return null;
  return { room: widest + style(SID.INSTRUMENT_NAME_OFFSET), offset: style(SID.INSTRUMENT_NAME_OFFSET), entries };
}

/** Overlay items of one system. `rightEdge` = x (negative) of the right end of the names; `spaced.staves[i]` = { top, originY }. */
export function instrumentNameItems(plan, { systemIndex, spaced, rightEdge }) {
  const items = [];
  for (const e of plan.entries) {
    const content = systemIndex === 0 ? e.firstContent : e.nextContent;
    const a = spaced.staves[e.first];
    const b = spaced.staves[e.last];
    if (!content || !a || !b) continue;
    const cy = (a.top + b.originY) / 2;
    if (content.kind === 'icon' && content.box.ui) {
      const { box } = content;
      items.push({ kind: 'icon-shape', role: 'instrument-icon', name: content.name.slice(3), photo: e.photo, x: rightEdge - box.w, y: cy - box.h / 2, w: box.w, h: box.h });
    } else if (content.kind === 'icon') {
      const { box } = content;
      items.push({ kind: 'glyph-stretch', role: 'instrument-icon', name: content.name, x: rightEdge - box.w, y: cy - box.h / 2, w: box.w, h: box.h, natW: box.natW, natH: box.natH });
    } else {
      items.push({ kind: 'text', role: 'instrument-name', text: content.text, size: NAME_SIZE, x: rightEdge, y: cy, anchor: 'end', central: true });
    }
  }
  return items;
}

/**
 * What the sticky header of the scrolling view writes under the metre of a track: its icon when it has one, else its short name (its full name
 * when it has no abbreviation). Same shape as the content of a name.
 */
export function stickyNameContent(entry, glyphs) {
  const icon = entry.icon ? iconBox(glyphs, entry.icon) : null;
  if (icon) return { kind: 'icon', name: entry.icon, box: icon, photo: entry.photo };
  const t = entry.abbreviation || entry.name;
  return t ? { kind: 'text', text: t } : null;
}
