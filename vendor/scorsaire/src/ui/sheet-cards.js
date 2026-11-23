/*
 * The name cards of the parts of the form drawn over a laid-out SHEET cell (screen 3 preview and the reader): the same small rectangle as on screen 1
 * (a dot, the name, the text and the outline in a strong shade of the part's colour), in the strip reserved above the top staff of each system.
 * The fill of the part (the band behind the music) belongs to the layout and is shown only when the colour option is on.
 */
import { strongOf } from '../view/color.js';

const CSS = 'position:absolute;display:inline-flex;align-items:center;gap:5px;padding:0 7px;border:1px solid;border-radius:4px;font:var(--w-semi,600) 11.5px var(--ui-font,sans-serif);background:transparent;white-space:nowrap;overflow:hidden;pointer-events:none;box-sizing:border-box';


/** Adds the cards of cell layout `l` ({ layout, staffSpace, margin }) to `box` (the element that holds the cell's SVG). */
export function addSectionCards(box, l) {
  const svg = box.querySelector('svg'); const vb = svg?.viewBox.baseVal; if (!vb || !l?.layout?.systems) return;
  const ss = l.staffSpace; const host = svg.parentElement; host.style.position = 'relative';
  for (const sys of l.layout.systems) {
    const strip = sys.sectionStrip; if (!strip || !sys.sections?.length) continue;
    const own = sys.sections.filter((sg) => !sg.continues); // a card only where its part BEGINS: not repeated at the start of each following system
    own.forEach((sg, i) => {
      const next = own[i + 1]; // a card is a point: it stays where its part begins, as on screen 1, and is as wide as its name (up to the next card)
      const own1 = strip.cards?.find((c) => c.id === sg.id); // (the layout may have moved a card a little to the right to clear a volta)
      const x1 = l.margin + (sys.x0 + (own1?.x ?? sg.x1)) * ss; const x2 = l.margin + (sys.x0 + sg.x2) * ss; const y = (sys.top + (strip.cards?.find((c) => c.id === sg.id)?.y ?? strip.y)) * ss; const h = Math.max(14, strip.h * ss - 2);
      const strong = sg.color ? strongOf(sg.color) : { dot: '#888', text: '#555', line: '#999' };
      const k = strip.scale ?? 1; const plain = strip.style === 'text'; // the size and the style asked by the sheet: a plain name has no rectangle and takes the colour of the signs when they are coloured
      const card = document.createElement('div');
      card.className = 'sheet-seccard'; card.setAttribute('data-seccard', sg.label ?? ''); card.title = sg.label ?? '';
      card.style.cssText = `${CSS};left:${(x1 / vb.width) * 100}%;max-width:${(((next ? l.margin + (sys.x0 + next.x1) * ss : x2) - x1 - 3) / vb.width) * 100}%;top:${(y / vb.height) * 100}%;height:${(h / vb.height) * 100}%;font-size:${11.5 * k}px;color:${plain ? (l.layout.signsTint ?? 'var(--ink,#1c1b1a)') : strong.text};border-color:${plain ? 'transparent' : strong.line}${plain ? ';padding:0 2px' : ''}`;
      const dot = document.createElement('span'); dot.style.cssText = `width:7px;height:7px;border-radius:50%;flex:none;background:${strong.dot}`;
      const txt = document.createElement('span'); txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis'; txt.textContent = sg.label ?? '';
      if (!plain) card.append(dot);
      card.append(txt); host.append(card);
    });
  }
}
