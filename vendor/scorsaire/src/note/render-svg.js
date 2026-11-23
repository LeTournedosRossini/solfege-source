/*
 * A note drawn as an SVG TEXT, with no browser: what the school portal puts in an exported note (an HTML file cannot hold the component). PURE: the document in, a string out;
 * it runs in Node (the portal's backend) and in the page alike. It lays the note out like the viewer does (same spacing rules, no staff names), in black on white by default.
 *   renderNoteSvg(json, { width, staffSpace, ink, paper, transpose, zoom, concert }) → { svg, width, height, text, measures }
 * `text` = what the teacher wrote above the score (to write as a paragraph of the page, escaped: it is plain text).
 */
import { parseNoteDocument } from './document.js';
import { shiftForDisplay } from '../layout/displayshift.js';
import { createSheet } from '../model/elements.js';
import { resolveStyle } from '../model/props.js';
import { SID } from '../model/sid.js';
import { layoutSheet } from '../layout/sheetlayout.js';
import { renderSvgString } from '../render/svg.js';
import glyphs from '../glyphs/bravura-subset.json' with { type: 'json' };

/** Editor-only roles a reader never draws. */
const SKIP_ROLES = ['container-frame', 'container-handle', 'container-warning', 'container-readonly', 'automation', 'automation-bg'];

/** @param input the document (text or object) ; @param o.width px ; o.staffSpace px (default: the viewer's rule, width / 46 between 7 and 12) ; o.transpose semitones ; o.concert true / false / null */
export function renderNoteSvg(input, { width = 600, staffSpace = null, ink = '#000', paper = '#fff', transpose = 0, zoom = 1, concert = null, lang = 'fr', label = null } = {}) {
  const { doc, work, movement } = parseNoteDocument(input);
  const w = Math.max(200, Math.floor(width));
  const ss = staffSpace ?? Math.max(7, Math.min(12, Math.round(w / 46)));
  const shown = shiftForDisplay(movement, transpose);
  const imposed = { [SID.SHOW_INSTRUMENT_NAMES]: false, [SID.ENABLE_INDENTATION_ON_FIRST_SYSTEM]: false, [SID.CHORD_START_TIMESIG]: false, ...(concert === null ? {} : { [SID.CONCERT_PITCH]: concert }) };
  const getStyle = (sid) => (sid === SID.SECTION_COLORS_SHOW ? false : sid in imposed ? imposed[sid] : resolveStyle(sid, [null, movement.style]));
  const shownWork = Object.create(work, { movements: { value: work.movements.map((m) => (m === movement ? shown : m)) } });
  const laid = layoutSheet(shownWork, createSheet({ id: 'note', name: '' }), glyphs, { device: { width: w, staffSpace: ss }, view: { mode: 'wrap', zoom, margin: 0 }, getStyle, cells: [{ id: 'c0', movementId: movement.id, tracks: null }] });
  const l = laid.cells[0];
  const svg = renderSvgString(l.layout, glyphs, { staffSpace: l.staffSpace, margin: l.margin, ink, paper, skipRoles: SKIP_ROLES, title: label ?? (lang === 'en' ? 'Score' : 'Partition') }); // (the drawing has an accessible name)
  const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return { svg, width: size ? Number(size[1]) : w, height: size ? Number(size[2]) : 0, text: doc.text ?? '', measures: movement.masterbars.length };
}
