/*
 * The staves of the nested notation of a STACKED container (placement 'above'): they are aligned on the measures the container covers (measure k of
 * a nested staff ↔ masterbar `anchor + k`). Since 2026-10-16 they live in a FRAGMENT (a small movement of its own, one track), so the same editor
 * can open them; a container written the older way (`staves`) is still read. A slot BETWEEN measures keeps an independent fragment: no alignment,
 * so none of its staves is returned here.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';

export function nestedStaves(container) {
  if (getProperty(container, PID.CONTAINER_PLACEMENT) === 'between') return [];
  const fragment = container.fragments?.[0];
  if (fragment) return fragment.tracks.flatMap((t) => t.staves);
  return container.staves ?? [];
}
