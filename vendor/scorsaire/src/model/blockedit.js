// Writing the blocks of a movement (inside `doc.transaction`): the list is replaced as a whole, so one call is one undoable step.
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { addBlock, updateBlockIn, removeBlockIn, createTextBlock, createImageBlock, blockProblems, ASPECT_RANGE, DEFAULT_ASPECT } from './blocks.js';
import { EditError } from './noteedit.js';

export const blocksOf = (mv) => getProperty(mv, PID.BLOCKS) ?? [];
export const aspectOf = (mv) => getProperty(mv, PID.BLOCK_ASPECT) ?? DEFAULT_ASPECT;

function put(doc, mv, list) {
  const bad = blockProblems(list, aspectOf(mv));
  if (bad.length) throw new EditError(bad[0]);
  if (list.length) doc.set(mv, PID.BLOCKS, list); else doc.reset(mv, PID.BLOCKS);
}

/** Adds a text block; → its id. */
export const ALONE_TEXT_SIZE = 6.5; // percent of the width of the band: the size of the first text of a movement that has no staff (a text alone in a box)
export function addTextBlock(doc, mv, spec = {}) {
  const alone = spec.size == null && !mv.tracks?.some((t) => t.staves?.length);
  const first = alone && !blocksOf(mv).length; // the first text of a movement with no staff fills the width of its box (what the box on the video shows is the box itself)
  const block = createTextBlock(alone ? { ...(first ? { x: 0, y: 2, w: 100, h: 16 } : {}), ...spec, size: ALONE_TEXT_SIZE } : spec);
  put(doc, mv, addBlock(blocksOf(mv), block, aspectOf(mv)));
  return block.id;
}
/** Adds an image block (the picture is already in the registry); → its id. The box keeps the proportions of the picture. */
export function addImageBlock(doc, mv, spec = {}) {
  const block = createImageBlock(spec);
  put(doc, mv, addBlock(blocksOf(mv), block, aspectOf(mv)));
  return block.id;
}
export function updateBlock(doc, mv, id, patch) {
  if (!blocksOf(mv).some((b) => b.id === id)) throw new EditError(`Unknown block: ${id}`);
  put(doc, mv, updateBlockIn(blocksOf(mv), id, patch, aspectOf(mv)));
}
export function removeBlock(doc, mv, id) { put(doc, mv, removeBlockIn(blocksOf(mv), id)); }
/** The height of the box a movement with no staff makes on the video, as a fraction of its width; null = it follows the content again. */
export function setBlockFit(doc, mv, fit) {
  if (fit == null) { doc.reset(mv, PID.BLOCK_FIT); return; }
  if (!(fit >= 0.03 && fit <= 2)) throw new EditError('Bad fit height');
  doc.set(mv, PID.BLOCK_FIT, Math.round(fit * 1000) / 1000);
}
/** The height of the band relative to its width; the blocks are kept inside. */
export function setBlockAspect(doc, mv, aspect) {
  if (!(aspect >= ASPECT_RANGE[0] && aspect <= ASPECT_RANGE[1])) throw new EditError('Bad aspect');
  if (Math.abs(aspect - DEFAULT_ASPECT) < 1e-9) doc.reset(mv, PID.BLOCK_ASPECT); else doc.set(mv, PID.BLOCK_ASPECT, aspect);
  const list = blocksOf(mv).map((b) => updateBlockIn([b], b.id, {}, aspect)[0]);
  if (list.length) doc.set(mv, PID.BLOCKS, list);
}
