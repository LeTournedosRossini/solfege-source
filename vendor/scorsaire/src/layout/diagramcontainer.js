/*
 * A chord-diagram container (kind 'chordDiagram'): resolves the fingering shown (own voicing, the work's preferred one, or the n-th suggestion) and draws
 * it with its chord symbol as the title. The result is in a local frame (origin = bottom-left corner, y up), memoised per container in the layout context.
 *
 * Two modes: ONE diagram for the chord the container is for (`diagramLayout`), or — `PID.DIAGRAM_FOLLOW`, stacked over measures — ONE diagram per chord symbol written in
 * the measures it covers on the chord staff (`followedItems`), each placed at the x of its symbol, pushed right when two would overlap.
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';
import { resolveElementDiagram, followedDiagrams } from '../model/fretdiagram.js';
import { chordQualityDisplay, chordQualityGaps } from '../model/chordquality.js';
import { fretDiagramItems, FRET_DIAGRAM } from './fretdiagram.js';
import { pianoDiagramItems } from './pianodiagram.js';
import { isPiano } from '../model/fretvoicing.js';
import { chordSymbolLayout } from './chorddisplay.js';
import { translateItem } from './offsets.js';

const GAP = 0.4; // minimum room between two diagrams of the same container

/**
 * Draws one diagram: `res` = a resolved fingering { voicing, source }; `chord` = what to write above it (null / `title: false` = no title). `ctx` needs `glyphs`, `style`
 * and `chordQualities` (a layout context, or the pieces of one: the zones of a part have no layout context).
 * @returns { items, width, height, source, shift } in a local frame (origin bottom-left, y up); `shift` = room a title wider than the diagram takes on the left
 */
export function drawDiagram(ctx, { res, chord = null, scale = 1, gauge = true, ref, dotColor = null, orientation = 'horizontal', title: withTitle = true }) {
  if (!res) return null;
  let title = null;
  if (chord && withTitle) {
    const size = FRET_DIAGRAM.titleSize * scale;
    const style = (sid) => (sid === SID.CHORD_FONT_SIZE ? size : ctx.style(sid)); // the symbol is built at the size of the title
    const quality = chord.quality ?? '';
    const layout = chordSymbolLayout({
      root: chord.root, quality, bass: chord.bass ?? null, special: 'none',
      display: ctx.chordQualities ? chordQualityDisplay(ctx.chordQualities, quality) : null,
      gaps: ctx.chordQualities ? chordQualityGaps(ctx.chordQualities, quality) : [],
    }, style, ctx.glyphs);
    title = { layout, family: ctx.style(SID.CHORD_FONT_FAMILY), weight: ctx.style(SID.CHORD_FONT_WEIGHT) };
  }
  const d = isPiano(res.voicing) ? pianoDiagramItems(res.voicing, { x: 0, y: 0, scale, title, ref, dotColor, orientation }) : fretDiagramItems(res.voicing, { x: 0, y: 0, scale, title, ref, gauge, dotColor });
  const titleWidth = title ? title.layout.width : 0;
  const items = d.items; let width = Math.max(d.width, titleWidth);
  if (res.fallback) { // the chord staff reads a tablature but nothing is played there: the proposed fingering is shown, and a small sign says it does not come from the tablature
    items.push({ kind: 'text', text: '≈', x: width + 0.15, y: d.height / 2 - 0.5, size: 1.8, anchor: 'start', bold: true, role: 'diagram-mark', color: '#c07000', ref });
    width += 1.6;
  }
  return { items, width, height: d.height, source: res.source, shift: Math.max(0, (titleWidth - d.width) / 2), ...(res.fallback ? { fallback: true } : {}) };
}

function build(ctx, container, res, chord) {
  return drawDiagram(ctx, { res, chord, scale: getProperty(container, PID.CONTAINER_SCALE) ?? 1, gauge: getProperty(container, PID.DIAGRAM_GAUGE) !== false, dotColor: getProperty(container, PID.COLOR), orientation: getProperty(container, PID.DIAGRAM_ORIENTATION), ref: container.id });
}

/** @returns { items, width, height, source, shift } | null (nothing to show: no usable chord and no voicing) */
export function diagramLayout(ctx, container) {
  return ctx.memo.of('diagram', container, () => build(ctx, container, resolveElementDiagram(container, { preferred: ctx.preferredVoicings, dict: ctx.chordQualities }), getProperty(container, PID.DIAGRAM_CHORD)));
}

/** The diagrams of a container in follow mode: [{ key, mi, position, chord, layout }] (layout null when the chord has no fingering). */
export function followedLayouts(ctx, container) {
  return ctx.memo.of('diagramFollow', container, () => followedDiagrams(ctx.movement, container, { preferred: ctx.preferredVoicings, dict: ctx.chordQualities })
    .map((e) => ({ key: e.key, mi: e.mi, position: e.position, chord: e.chord, layout: build(ctx, container, e.res, e.chord) })));
}

/**
 * Items of a follow-mode container for the measures `visible` of one system. `xAt(mi, position)` = x of an instant; `minX` = where the first diagram may start.
 * Each diagram starts at the x of its chord symbol; if that would overlap the previous one it is pushed right.
 * @returns items (local frame: y up from the bottom of the tallest diagram) — empty when there is nothing to show
 */
export function followedItems(ctx, container, visible, xAt, minX) {
  const shown = new Set(visible.map((m) => m.mi));
  const out = [];
  let right = minX;
  for (const e of followedLayouts(ctx, container)) {
    if (!shown.has(e.mi) || !e.layout) continue;
    const x = Math.max(right, xAt(e.mi, e.position) - e.layout.shift);
    for (const it of e.layout.items) out.push(translateItem(it, x + e.layout.shift, 0));
    right = x + e.layout.width + e.layout.shift + GAP;
  }
  return out;
}
