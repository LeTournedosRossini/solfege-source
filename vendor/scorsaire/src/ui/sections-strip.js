/*
 * Name cards of the sections of the form (screen 1), in the strip reserved above the staves of each system. They behave like the headers of a
 * sticky list (`view/section-cards.js`): each card sits at the start of its section, is pinned to the left edge of the visible area when that start
 * has scrolled away, and is pushed out by the next section's card. The layer never takes part in the page layout (the score never moves) and does
 * not catch the pointer.
 */
import { cardPlacements } from '../view/section-cards.js';
import { strongOf } from '../view/color.js';
import { themeIsDark } from './piano-look.js';

// on a dark theme the strong colours (dark by design, they sit on a light page) cannot be seen: every card is white, the coloured band behind the score still tells the parts apart
const WHITE = { text: '#ffffff', line: 'rgba(255,255,255,.8)', dot: '#ffffff' };

// discreet: no fill (the band shows through), outline and text in the strong version of the part's own colour, a rectangle with soft corners
const CSS = 'position:absolute;display:inline-flex;align-items:center;gap:5px;padding:0 7px;border:1px solid;border-radius:4px;font:var(--w-semi,600) 11.5px var(--ui-font,sans-serif);background:transparent;white-space:nowrap;pointer-events:none;box-sizing:border-box;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';

export function mountSectionsStrip({ stage, scroller, view, margin = 10, inset = () => 0, onUnder = () => {}, onCards = () => {} }) {
  const layer = document.createElement('div');
  layer.setAttribute('data-sections-strip', '');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;overflow:visible;z-index:2'; // above the score: a card that sits at its place can be touched (see `section-card-edit.js`)
  // the coloured bands, BEHIND the score (the score svg is transparent and sits above this layer)
  const bandsLayer = document.createElement('div');
  bandsLayer.setAttribute('data-section-bands', '');
  bandsLayer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:-1'; // the very BACK of the stage (see `isolation` below)
  stage.prepend(bandsLayer);
  stage.append(layer);
  let bands = [];
  let cards = new Map(); // `${system}:${section id}` → element
  const place = () => {
    const layout = view.layout();
    const ss = view.staffSpace();
    // `inset`: what covers the left edge (the sticky header of the scrolling view): the cards are pinned to the right of it, never under it
    const visible = { left: scroller.scrollLeft + inset(), right: scroller.scrollLeft + scroller.clientWidth };
    const alive = new Set();
    // vertical stickiness: the cards stay at the TOP of the visible screen (below the transport bar when THAT one is stuck over the top), inside
    // their system — whatever the bar does (it is not sticky everywhere)
    const player = document.querySelector('[data-player]');
    const stageTop = stage.getBoundingClientRect().top;
    const vv = window.visualViewport;
    const windowTop = vv ? vv.offsetTop : 0;
    let coverBottom = 0;
    if (player) {
      const pos = getComputedStyle(player).position;
      if (pos === 'sticky' || pos === 'fixed') { const r = player.getBoundingClientRect(); if (r.bottom > windowTop) coverBottom = r.bottom; }
    }
    const topLimit = Math.max(windowTop, coverBottom) - stageTop;
    // bands
    for (const el of bands) el.remove();
    bands = [];
    // the bands are pastel colours: on a dark theme they would read as a lighter veil, so the theme can lower them (`--band-factor`, 1 = as chosen)
    const bandFactor = (() => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--band-factor')); return Number.isFinite(v) ? v : 1; })();
    let under = null;
    layout.systems.forEach((sys) => {
      for (const ov of sys.overlays) {
        if (ov.role !== 'section-band') continue;
        const el = document.createElement('div');
        const left = margin + (sys.x0 + ov.x) * ss;
        const width = ov.w * ss;
        el.style.cssText = `position:absolute;left:${left}px;top:${(sys.top + ov.y) * ss}px;width:${width}px;height:${ov.h * ss}px;background:${ov.fill};opacity:${ov.opacity * bandFactor}`;
        bandsLayer.append(el);
        bands.push(el);
        if (!under && left <= visible.left + 1 && left + width > visible.left) under = { color: ov.fill, opacity: ov.opacity * bandFactor, top: (sys.top + ov.y) * ss, height: ov.h * ss };
      }
    });
    let nameUnder = ''; // the part of the form under the left edge, for the sticky header
    layout.systems.forEach((sys, k) => {
      const strip = sys.sectionStrip;
      if (!strip || !sys.sections?.length) return;
      const segs = sys.sections.map((s) => ({ ...s, px1: margin + (sys.x0 + s.x1) * ss, px2: margin + (sys.x0 + s.x2) * ss }));
      if (!nameUnder) nameUnder = segs.find((s) => s.px1 <= visible.left + 1 && s.px2 > visible.left)?.label ?? '';
      const natural = new Map();
      const widthOf = (s) => {
        const el = cards.get(`${k}:${s.id}`);
        if (!el) return 70;
        if (!natural.has(s.id)) { el.style.maxWidth = 'none'; el.style.width = 'auto'; natural.set(s.id, el.offsetWidth || 70); }
        return natural.get(s.id);
      };
      const naturalTopOf = (s) => (sys.top + (strip.cards?.find((c) => c.id === s.id)?.y ?? strip.y)) * ss; // (each card sits at its own height)
      const systemBottom = (sys.top + sys.height) * ss;
      const height = Math.max(14, strip.h * ss - 2);
      for (const s of segs) {
        const key = `${k}:${s.id}`;
        let el = cards.get(key);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText = CSS;
          const dot = document.createElement('span');
          dot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex:none';
          const name = document.createElement('span');
          el.append(dot, name);
          layer.append(el);
          cards.set(key, el);
        }
        const strong = themeIsDark() ? WHITE : strongOf(s.color);
        el.firstChild.style.background = strong.dot;
        el.style.color = strong.text; el.style.borderColor = strong.line;
        if (el.lastChild.textContent !== s.label) el.lastChild.textContent = s.label;
        el.style.height = `${height}px`;
        el.style.top = `${Math.max(naturalTopOf(s), Math.min(topLimit + 2, systemBottom - height - 2)) + 1}px`;
        alive.add(key);
      }
      for (const p of cardPlacements(segs, visible, widthOf)) {
        const el = cards.get(`${k}:${p.id}`);
        el.style.display = 'inline-flex';
        el.style.left = `${p.x}px`;
        el.style.width = `${p.width}px`; el.style.maxWidth = `${p.width}px`; el.style.overflow = 'hidden';
        el.lastChild.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        el.style.padding = p.width < 40 ? '0 3px' : '0 8px';
        el.dataset.placed = '1';
        // a card is touchable only AT ITS PLACE: at the start of its section, not pinned to the edge nor squeezed away from it
        const seg = segs.find((x) => x.id === p.id);
        const here = !!seg.begins && p.x <= seg.px1 + 0.5;
        el.style.pointerEvents = here ? 'auto' : 'none';
        el.style.touchAction = here ? 'none' : '';
        el.dataset.sectionId = seg.id; el.dataset.first = String(seg.first); el.dataset.selectable = here ? '1' : '';
      }
      for (const s of segs) {
        const el = cards.get(`${k}:${s.id}`);
        if (!cardPlacements([s], visible, widthOf).length) el.style.display = 'none';
      }
    });
    for (const [key, el] of cards) if (!alive.has(key)) { el.remove(); cards.delete(key); }
    onCards(cards);
    onUnder(under || nameUnder ? { ...(under ?? {}), name: nameUnder } : null);
  };
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; place(); }); };
  scroller.addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('scroll', schedule, { passive: true, capture: true }); // the page scrolls too (the cards stay at the top of the screen)
  window.addEventListener('resize', schedule);
  const themeWatch = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null; // a change of theme changes the strength of the bands
  themeWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dark', 'data-hc'] });
  return {
    refresh() { place(); },
    destroy() { themeWatch?.disconnect(); scroller.removeEventListener('scroll', schedule); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); layer.remove(); bandsLayer.remove(); },
  };
}
