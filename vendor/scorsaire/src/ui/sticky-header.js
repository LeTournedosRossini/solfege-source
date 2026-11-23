/*
 * Sticky header of the scrolling view (screen 1): in the single-system view the clef, key signature, time signature, staff lines and brace stay
 * visible at the left edge while the music scrolls — and they are the ones IN FORCE at the measure under the header (a key or time signature that
 * changed further on shows its new value, like the header of a new system would). The layout provides the variants (`system.headerVariants`),
 * the view renders the one wanted (`stickyHeaderSvg`). It never catches the pointer.
 * The header scrolls away WITH the score while there is still a margin (the padding of the scroller + the margin of the drawing) between the left edge and
 * the staff, and only sticks when the staff itself touches the edge: the margin is not kept for ever, the room is given back to the music.
 */
export function mountStickyHeader({ stage, scroller, view, margin = 10 }) {
  const sticky = document.createElement('div');
  sticky.setAttribute('data-sticky-header', '');
  sticky.style.cssText = 'position:sticky;left:0;top:0;width:0;height:0;z-index:4;pointer-events:none;overflow:visible';
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;display:none;background:transparent';
  // the colour of the section under the header's right edge (set by the name-card strip): the header takes the colour of the part it passes
  // over; its own background is the paper so that the notes that scroll under it are hidden
  const paper = document.createElement('div');
  paper.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;background:var(--score,#fff)';
  const tint = document.createElement('div');
  tint.style.cssText = 'position:absolute;left:0;width:100%;display:none;pointer-events:none';
  const content = document.createElement('div');
  content.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  const nameLabel = document.createElement('div');
  nameLabel.setAttribute('data-sticky-section-name', '');
  nameLabel.style.cssText = 'position:absolute;display:none;font:11px var(--ui-font,sans-serif);color:var(--ink-faint,#777);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none';
  box.append(paper, tint, content, nameLabel);
  let sectionName = ''; // the part of the form under the header (set by the name-card strip)
  sticky.append(box);
  stage.prepend(sticky);
  let shown = 0; // width in px of the header while it is displayed, else 0
  let current = -1; // index of the variant drawn
  /** The variant in force at the measure that is under the right edge of the header. */
  const variantAt = (sys, ss, left) => {
    const x = (left - margin) / ss - sys.x0; // sp, in the system
    let mi = 0;
    for (const m of sys.measures) { if (m.x <= x) mi = m.index; else break; }
    let idx = 0;
    sys.headerVariants.forEach((v, k) => { if (v.mi <= mi) idx = k; });
    return idx;
  };
  const update = () => {
    const holderSvg = stage.querySelector('svg[role="img"]'); // the score itself (the icons of the track controls are SVGs too)
    const layout = view.layout();
    const sys = layout.systems[0];
    // the measure entry mode shows the bare measure (only its two bar lines): the person knows where they are
    const on = !document.documentElement.hasAttribute('data-measure-focus') && scroller.dataset.viewMode === 'scroll' && holderSvg && sys && layout.systems.length === 1 && sys.headerVariants?.length && scroller.scrollLeft > 2;
    if (!on) { box.style.display = 'none'; shown = 0; return; }
    const ss = view.staffSpace();
    const first = sys.headerVariants[0];
    // distance from the content edge of the scroller to the start of the staff: the box may slide that far to the left before it sticks
    const offset = (parseFloat(getComputedStyle(scroller).paddingLeft) || 0) + margin;
    sticky.style.left = `${-offset}px`;
    // the names of the tracks (left of the brackets) are NOT part of the header: they scroll away with the score and the header starts at the
    // brackets; `skip` = their room in px
    const skip = (sys.stickyNames?.room ?? 0) * ss;
    sticky.style.marginLeft = `${skip}px`;
    content.style.left = `${-skip}px`;
    const edge = Math.max(skip, scroller.scrollLeft - offset); // where the box is, in the coordinates of the stage
    const idx = variantAt(sys, ss, edge - skip + margin + (sys.x0 + first.width) * ss);
    if (idx !== current) { content.innerHTML = view.stickyHeaderSvg(idx) ?? ''; current = idx; }
    const v = sys.headerVariants[idx];
    const w = Math.round(margin + (sys.x0 + v.width) * ss - skip);
    box.style.width = `${w}px`; box.style.height = `${holderSvg.getAttribute('height')}px`; box.style.display = '';
    shown = Math.max(0, edge + w - scroller.scrollLeft); // what it covers at the left edge of the visible content
    // stuck = a reading aid: greyed, with a faint shadow on the music, and the name of the part under it
    const stuck = scroller.scrollLeft - offset > skip + 0.5;
    content.style.opacity = stuck ? '0.55' : '1';
    box.style.boxShadow = stuck ? '3px 0 5px -2px rgba(0,0,0,0.18)' : 'none';
    const last = sys.staves[sys.staves.length - 1];
    if (stuck && sectionName && last) {
      const left = margin + (sys.x0 + 1.5) * ss - skip;
      nameLabel.textContent = sectionName; nameLabel.title = sectionName;
      nameLabel.style.left = `${left}px`; nameLabel.style.top = `${(sys.top + last.originY + (sys.stickyNames ? 3.2 : 1.3)) * ss}px`; // under the track names when there are some
      nameLabel.style.maxWidth = `${Math.max(0, w - left - 4)}px`; nameLabel.style.display = '';
    } else nameLabel.style.display = 'none';
  };
  scroller.addEventListener('scroll', update, { passive: true });
  return {
    /** Width in pixels covered at the left edge right now (0 when the header is not displayed). */
    width: () => shown,
    /** Colour of the part under the header: { color, opacity, top, height } in pixels of the score, or null. */
    setTint(t) {
      const name = t?.name ?? '';
      if (name !== sectionName) { sectionName = name; update(); }
      if (!t?.color) { tint.style.display = 'none'; return; }
      tint.style.display = ''; tint.style.background = t.color; tint.style.opacity = String(t.opacity); tint.style.top = `${t.top}px`; tint.style.height = `${t.height}px`;
    },
    /** Called after each render: the variants may have changed. */
    refresh() { current = -1; update(); },
    destroy() { scroller.removeEventListener('scroll', update); sticky.remove(); },
  };
}
