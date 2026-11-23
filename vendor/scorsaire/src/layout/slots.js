/*
 * Slots between measures ("intercalated" staff containers, `containerPlacement: 'between'`): a container that takes width in the line like a
 * measure but is not a measure of the music (no time, no bar number, no playback). It is the equivalent of MuseScore's horizontal frame
 * (`HBox`: a measure-base of fixed width, no staff lines).
 *
 * Rules:
 *  - the space is reserved on ALL staves of the system (the barlines of the measures must stay aligned); the content is drawn in the row of
 *    ITS staff (option A: centred on the staff), the other staves stay empty there and their staff lines are interrupted;
 *  - width: manual (`containerWidth`) or from the content (text: 0.5 × size per character + padding), never stretched by the justification;
 *  - `before` a measure: the slot belongs to that measure's unit (a line break never separates them); `after` the last measure: at the end;
 *  - several containers at the same place: on different staves they share one column (width = the largest); several on the same staff
 *    follow one another.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';

const PT = (1.75 * 72) / 25.4;
export const SLOT_TEXT_SIZE = 10 / PT;
const SLOT_PAD = 1.0;
const SLOT_MIN = 4;

/**
 * Natural width of the content of a slot (staff spaces). A nested score takes the natural width of its own layout (`fragmentWidth`, supplied by
 * the layout: one system, never stretched) plus a margin on each side.
 */
export function slotContentWidth(container, fragmentWidth = null, diagramWidth = null) {
  const manual = getProperty(container, PID.CONTAINER_WIDTH);
  if (manual > 0) return manual;
  if (getProperty(container, PID.CONTAINER_KIND) === 'chordDiagram') return Math.max(SLOT_MIN, (diagramWidth ? diagramWidth(container) : 0) + 2 * SLOT_PAD);
  if (container.fragments?.length && fragmentWidth) return fragmentWidth(container) + 2 * SLOT_PAD;
  const text = getProperty(container, PID.TEXT) ?? '';
  return Math.max(SLOT_MIN, 0.5 * SLOT_TEXT_SIZE * (getProperty(container, PID.CONTAINER_SCALE) ?? 1) * [...text].length + 2 * SLOT_PAD);
}

/**
 * @param movement
 * @param staves   ctx.staves ({ staff }) — a container of a hidden staff is not drawn and takes no room
 * @returns {{ before: Array<Array<{width, entries}>>, end: Array<{width, entries}>, widthBefore(mi), widthEnd }}
 *   columns = [{ width, entries: [{ container, staffIndex }] }]
 */
export function buildSlots(movement, staves) {
  const barIds = movement.masterbars.map((b) => b.id);
  const before = barIds.map(() => []);
  const end = [];
  const place = (columns, container, staffIndex) => {
    // column = number of containers of the same staff already placed here
    const col = columns.filter((c) => c.entries.some((e) => e.staffIndex === staffIndex)).length;
    while (columns.length <= col) columns.push({ width: 0, entries: [] });
    const target = columns[col];
    target.entries.push({ container, staffIndex });
  };
  staves.forEach((s, staffIndex) => {
    for (const c of s.staff.containers ?? []) {
      if (getProperty(c, PID.CONTAINER_PLACEMENT) !== 'between') continue;
      const i = barIds.indexOf(getProperty(c, PID.MEASURE_ID));
      if (i < 0) continue;
      if (getProperty(c, PID.CONTAINER_SIDE) === 'after') place(end, c, staffIndex);
      else place(before[i], c, staffIndex);
    }
  });
  // widths are computed on demand (a nested score needs a layout of its own, supplied by `slots.fragmentWidth` once the layout context exists)
  const slots = { before, end, fragmentWidth: null, diagramWidth: null };
  const columnWidth = (col) => Math.max(0, ...col.entries.map((e) => slotContentWidth(e.container, slots.fragmentWidth, slots.diagramWidth)));
  const finish = (cols) => { for (const col of cols) col.width = columnWidth(col); return cols.reduce((w, c) => w + c.width, 0); };
  slots.widthBefore = (mi) => finish(before[mi] ?? []);
  slots.widthEnd = () => finish(end);
  return slots;
}
