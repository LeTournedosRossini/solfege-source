// Rendu d'une note de Scorsaire en SVG (texte), avec nos réglages. Reprend renderNoteSvg de vendor/scorsaire/src/note/render-svg.js
// (qu'on ne modifie pas) en ajoutant : pas de tempo « ♩ = 90 » dessiné au-dessus de la portée.
import { loadWork } from '../vendor/scorsaire/src/model/serialize.js';
import { createSheet } from '../vendor/scorsaire/src/model/elements.js';
import { resolveStyle } from '../vendor/scorsaire/src/model/props.js';
import { SID } from '../vendor/scorsaire/src/model/sid.js';
import { layoutSheet } from '../vendor/scorsaire/src/layout/sheetlayout.js';
import { renderSvgString } from '../vendor/scorsaire/src/render/svg.js';
import glyphs from '../vendor/scorsaire/src/glyphs/bravura-subset.json' with { type: 'json' };

const SKIP_ROLES = ['container-frame', 'container-handle', 'container-warning', 'container-readonly', 'automation', 'automation-bg'];

/** Lit une « note » de Scorsaire (texte ou objet) : un seul mouvement, sans la limite de 4 mesures de la note d'origine (les phrases importées peuvent être plus longues). */
export function readNote(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  const work = loadWork(data.work);
  if (work.movements.length !== 1) throw new Error('Un seul mouvement attendu');
  return { work, movement: work.movements[0] };
}

export function renderScore(input, { width = 600, staffSpace = null, ink = '#000', paper = 'none', label = 'Partition', showTime = true } = {}) {
  const { work, movement } = readNote(input);
  const w = Math.max(100, Math.floor(width));
  const ss = staffSpace ?? Math.max(7, Math.min(12, Math.round(w / 46)));
  const imposed = { [SID.SHOW_INSTRUMENT_NAMES]: false, [SID.ENABLE_INDENTATION_ON_FIRST_SYSTEM]: false, [SID.CHORD_START_TIMESIG]: false, [SID.SHOW_TEMPO_TEXTS]: false, [SID.HEADER_SHOW_TIMESIG]: showTime, [SID.REPEAT_BAR_TIPS]: false };
  const getStyle = (sid) => (sid === SID.SECTION_COLORS_SHOW ? false : sid in imposed ? imposed[sid] : resolveStyle(sid, [null, movement.style]));
  const laid = layoutSheet(work, createSheet({ id: 'note', name: '' }), glyphs, { device: { width: w, staffSpace: ss }, view: { mode: 'wrap', zoom: 1, margin: 0 }, getStyle, cells: [{ id: 'c0', movementId: movement.id, tracks: null }] });
  const l = laid.cells[0];
  return renderSvgString(l.layout, glyphs, { staffSpace: l.staffSpace, margin: l.margin, ink, paper, skipRoles: SKIP_ROLES, title: label });
}
