/*
 * The STICKY HEADER of a reader whose score is one long system that scrolls sideways ('scroll' layout): the clef, key signature, time signature, staff lines and brace stay at the
 * left edge while the music goes by, and they show what is IN FORCE at the measure under them (a key or a time signature that changes further on shows its new value).
 * Same idea as the editor's (`ui/sticky-header.js`) but driven by a laid-out cell, without track names or section colours. It never catches the pointer.
 * The header slides away with the score while there is still a margin between the edge and the staff, and only sticks when the staff touches the edge.
 */
import { renderSvgString } from '../render/svg.js';

/** The SVG of the header variant `index` of the single system of `laid` (same coordinates as the whole score), or null. */
export function headerVariantSvg(laid, glyphs, index) {
  const { layout } = laid; const sys = layout.systems[0]; const v = sys?.headerVariants?.[index]; if (!v) return null;
  const mini = {
    width: layout.width, height: layout.height,
    systems: [{
      index: 0, top: sys.top, x0: sys.x0, width: sys.width, height: sys.height,
      overlays: sys.overlays.filter((o) => o.role !== 'section-band' && o.role !== 'instrument-name' && o.role !== 'instrument-icon' && !String(o.role ?? '').startsWith('block-')),
      staves: sys.staves.map((st, si) => ({ ref: st.ref, trackId: st.trackId, type: st.type, painter: st.painter, originY: st.originY, items: [...st.items.filter((it) => it.role === 'staff-line'), ...(v.staves[si] ?? [])] })),
    }],
  };
  return renderSvgString(mini, glyphs, { staffSpace: laid.staffSpace, margin: laid.margin, showHidden: false, ink: 'var(--ink,#000)', paper: 'var(--score,#fff)' });
}

/** The index of the variant in force at the measure under `x` (sp in the system). */
export function variantAtX(sys, x) {
  let mi = 0;
  for (const m of sys.measures) { if (m.x <= x) mi = m.index; else break; }
  let idx = 0;
  sys.headerVariants.forEach((v, k) => { if (v.mi <= mi) idx = k; });
  return idx;
}

/**
 * @param o.box       the element that holds the score (position: relative, as wide as the score)
 * @param o.scroller  the element that scrolls sideways
 * @returns { width() (px covered at the left edge now), refresh(laid) after a new drawing, destroy() }
 */
export function mountReaderHeader({ box, scroller, glyphs, paper = 'var(--score,#fff)' }) {
  const sticky = document.createElement('div'); sticky.setAttribute('data-reader-header', '');
  sticky.style.cssText = 'position:sticky;left:0;top:0;width:0;height:0;z-index:4;pointer-events:none;overflow:visible';
  const frame = document.createElement('div'); frame.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;display:none;background:' + paper;
  const content = document.createElement('div'); content.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  frame.append(content); sticky.append(frame); box.prepend(sticky);
  let laid = null; let current = -1; let shown = 0;
  const update = () => {
    const sys = laid?.layout.systems[0]; const svg = box.querySelector('svg[role="img"]') ?? box.querySelector('svg');
    if (!sys?.headerVariants?.length || !svg || scroller.scrollLeft <= 2) { frame.style.display = 'none'; shown = 0; return; }
    const ss = laid.staffSpace; const margin = laid.margin;
    const offset = (parseFloat(getComputedStyle(scroller).paddingLeft) || 0) + margin + 1; // padding of the scroller + margin of the drawing + border of the box
    sticky.style.left = `${-offset}px`;
    const first = sys.headerVariants[0];
    const edge = Math.max(0, scroller.scrollLeft - offset);
    const idx = variantAtX(sys, (edge + margin + (sys.x0 + first.width) * ss - margin) / ss - sys.x0);
    if (idx !== current) { content.innerHTML = headerVariantSvg(laid, glyphs, idx) ?? ''; current = idx; }
    const v = sys.headerVariants[idx];
    const w = Math.round(margin + (sys.x0 + v.width) * ss);
    frame.style.width = `${w}px`; frame.style.height = `${svg.getAttribute('height')}px`; frame.style.display = '';
    shown = Math.max(0, edge + w - scroller.scrollLeft);
    const stuck = scroller.scrollLeft - offset > 0.5;
    content.style.opacity = stuck ? '0.55' : '1'; frame.style.boxShadow = stuck ? '3px 0 5px -2px rgba(0,0,0,0.18)' : 'none';
  };
  scroller.addEventListener('scroll', update, { passive: true });
  return {
    width: () => shown,
    refresh(next) { laid = next; current = -1; update(); },
    destroy() { scroller.removeEventListener('scroll', update); sticky.remove(); },
  };
}
