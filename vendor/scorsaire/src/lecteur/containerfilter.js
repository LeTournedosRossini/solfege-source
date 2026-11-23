/*
 * Which containers (the content hung above the staves on screen 1) the Lecteur shows when it paginates by itself. The author's own layouts of screen 2 decide
 * for themselves; here the person picks, by CATEGORY, on this device. Pure: a movement goes in, a movement without the unwanted containers comes out (their room goes with them).
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { CONTAINER_CATEGORIES, DEFAULT_CONTAINERS } from '../model/partreader.js';

export { CONTAINER_CATEGORIES, DEFAULT_CONTAINERS };

const NESTED_TYPES = new Set(['score', 'rhythm', 'tab', 'percussion', 'neutral']);

/** The category of a container, or null when it is not one the person can switch. */
export function containerCategory(container) {
  const kind = getProperty(container, PID.CONTAINER_KIND);
  if (kind === 'text' || kind === 'annotation') return 'text';
  if (kind === 'chordDiagram' || kind === 'chordDiagramList') return 'diagram';
  if (kind === 'nestedNotation') {
    const staves = container.fragments?.[0]?.tracks.flatMap((t) => t.staves) ?? container.staves ?? [];
    const type = staves.length ? getProperty(staves[0], PID.STAFF_TYPE) : 'score';
    return NESTED_TYPES.has(type) ? type : 'score';
  }
  return null;
}

/** A copy keeps the non-enumerable readers of the elements (`staff.clef`…), which a plain spread would drop. */
const copy = (el, key, value) => {
  const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(el));
  Object.defineProperty(c, key, { value, enumerable: true, writable: true, configurable: true });
  return c;
};

/** The movement without the containers whose category is not in `allowed` (the same object when nothing is removed). */
export function filterContainers(movement, allowed = DEFAULT_CONTAINERS) {
  const keep = new Set(allowed);
  const wanted = (c) => { const cat = containerCategory(c); return cat === null || keep.has(cat); };
  if (!movement.tracks.some((t) => t.staves.some((s) => (s.containers ?? []).some((c) => !wanted(c))))) return movement;
  return copy(movement, 'tracks', movement.tracks.map((t) => copy(t, 'staves', t.staves.map((s) => ((s.containers ?? []).some((c) => !wanted(c)) ? copy(s, 'containers', s.containers.filter(wanted)) : s)))));
}

const CONTAINER_SCALE_MIN = 0.4;

/**
 * The movement with every container's own scale divided by `factor` (the writing is drawn `factor` times bigger and the containers keep their size). A nested score can only shrink
 * (to 1 at most), a text or a diagram can grow to 3: where the scale would leave its range it stops at the edge. The same object when nothing changes.
 */
export function scaleContainers(movement, factor) {
  if (!(factor > 0) || Math.abs(factor - 1) < 1e-9) return movement;
  let changed = false;
  const scaled = (c) => {
    const cur = getProperty(c, PID.CONTAINER_SCALE) ?? 1;
    const next = Math.max(CONTAINER_SCALE_MIN, Math.min(getProperty(c, PID.CONTAINER_KIND) === 'nestedNotation' ? 1 : 3, cur / factor));
    if (Math.abs(next - cur) < 1e-9) return c;
    changed = true;
    const out = Object.defineProperties({}, Object.getOwnPropertyDescriptors(c));
    Object.defineProperty(out, 'props', { value: { ...c.props, [PID.CONTAINER_SCALE]: next }, enumerable: true, writable: true, configurable: true });
    return out;
  };
  const tracks = movement.tracks.map((t) => copy(t, 'staves', t.staves.map((s) => ((s.containers ?? []).length ? copy(s, 'containers', s.containers.map(scaled)) : s))));
  return changed ? copy(movement, 'tracks', tracks) : movement;
}
