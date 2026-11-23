/*
 * One-colour interface icons (Lucide, ISC licence: see LICENSES/Lucide-ISC.txt; data extracted by tools/extract-lucide.py).
 * Stroke icons on a 24 x 24 grid drawn with `currentColor`: a theme changes the colour with the button colour and the line weight with
 * the CSS variable `--icon-stroke` (default 1.5). The size follows the button (`ICON_SIZE`).
 * `icon(name)` builds the SVG; `iconForText(text)` maps the symbol a button used to show as text/emoji to an icon name (or null).
 */
import { iconNodes, hasIconShape, iconShapeNames, thinNodes, INSTRUMENT_WEIGHT } from '../model/iconshapes.js';
import { glyphRowIcon } from './mark-icons.js';
import { photoOf } from '../model/icon-photos.js';

const NS = 'http://www.w3.org/2000/svg';
export const ICON_SIZE = 'calc(var(--ui-target,44px) * 0.55)';

/** Symbols previously used as button text → Lucide name. Several names = icons side by side. */
const BY_TEXT = Object.freeze({
  '✎': ['pencil'], '🗑': ['trash'], '➕': ['plus'], '+': ['plus'], '−': ['minus'], '⌫': ['eraser'], '↺': ['rotate-ccw'], '⟲': ['rotate-ccw'],
  '🎚': ['sliders-vertical'], '🥁': ['drum'], '〰': ['spline'], '⧉': ['copy'], '⧉+': ['copy-plus'], '✂': ['scissors'], '⎘': ['clipboard-paste'], '✥': ['move'],
  '◎': ['circle-dot'], '▭': ['rectangle-horizontal'], '⚙': ['settings'], '✕': ['x'], '▽': ['funnel'], '👁': ['eye'], '🙈': ['eye-off'],
  '🙈⇉': ['eye-off', 'chevrons-right'], '👁⇉': ['eye', 'chevrons-right'], '🔇': ['volume-x'], '♪': ['volume-2'],
  '◀': ['chevron-left'], '▶': ['chevron-right'], '‹': ['chevron-left'], '…': ['ellipsis'], '↶': ['undo-2'], '↷': ['redo-2'],
  '⠿': ['grip-vertical'], '↑': ['arrow-up'], '↓': ['arrow-down'], '←': ['arrow-left'], '→': ['arrow-right'], '↕': ['arrow-up-down'], '⇕': ['arrow-up-down'],
  '⇅': ['arrow-up-down'], '⇄': ['replace'], '⇉': ['chevrons-right'], '▸': ['chevron-right'], '◂': ['chevron-left'], '▾': ['chevron-down'], '▲': ['chevron-up'], '▼': ['chevron-down'],
  '↵': ['corner-down-left'], '◫': ['columns-2'], '🔊': ['volume-2'], '⏸': ['pause'], '■': ['square'],
  '⬚': ['square-dashed'], '◱': ['minimize-2'], '⤢': ['maximize-2'], '⇤': ['text-align-start'], '↔': ['text-align-center'], '⇥': ['text-align-end'], '✗': ['x'],
  '⟋': ['ramp'], '⎍': ['step'],
  '🔒': ['lock'], '🔓': ['lock-open'], '⛓': ['link'], '⚠': ['triangle-alert'], '✓': ['check'],
});

/** Accidental symbols shown as the Bravura glyph the score draws (needs the glyph data: `installIconify(root, { glyphs })`). */
const ACCIDENTAL_GLYPH = Object.freeze({ '♯': 'accidentalSharp', '♭': 'accidentalFlat', '♮': 'accidentalNatural' });


export const iconNames = iconShapeNames;
export const hasIcon = hasIconShape;
/** Names of the icons a symbol maps to (null when the symbol has none). */
export const iconForText = (text) => BY_TEXT[text] ?? null;
/** Every name the symbol table refers to (used by a test). */
export const requiredIconNames = () => [...new Set(Object.values(BY_TEXT).flat())];

/** SVG of icon `name`; null when unknown. */
export function icon(name, { size = ICON_SIZE, weight = 1 } = {}) {
  const found = iconNodes(name);
  if (!found) return null;
  const nodes = weight === 1 ? found : thinNodes(found, weight); // `weight` < 1: a lighter stroke (instrument icons)
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('data-icon', name);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.style.cssText = `width:${size};height:${size};flex:none;display:block;stroke-width:${weight === 1 ? 'var(--icon-stroke,1.5)' : `calc(var(--icon-stroke,1.5) * ${weight})`}`;
  for (const [tag, attrs] of nodes) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** Replace the text of `button` by the icon(s) of its symbol; the tooltip and `aria-label` stay. True when replaced. */
export function applyTextIcon(button, text) {
  const names = iconForText(text);
  if (!names) return false;
  const icons = names.map((n) => icon(n)).filter(Boolean);
  if (!icons.length) return false;
  button.replaceChildren(...icons);
  button.style.cssText += ';display:inline-flex;align-items:center;justify-content:center;gap:0';
  return true;
}

/** Replace the content of `button` by the icon `name` (tooltip and `aria-label` stay); false when unknown. */
export function applyIconName(button, name) {
  const i = icon(name);
  if (!i) return false;
  button.replaceChildren(i);
  button.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
  return true;
}

/**
 * Turn every button of `root` whose ONLY content is a mapped symbol (✕, 🗑, ⚙…) into its icon. Idempotent; buttons that already hold
 * an element (an icon, a label + icon) are left alone, as are those marked `data-no-icon`.
 */
export function iconifyButtons(root, glyphs = null) {
  if (!root || root.nodeType !== 1) return;
  const buttons = root.tagName === 'BUTTON' ? [root] : root.querySelectorAll('button');
  for (const b of buttons) {
    if (b.hasAttribute('data-no-icon') || b.children.length) continue;
    const text = b.textContent.trim();
    if (text && iconForText(text)) applyTextIcon(b, text);
    else if (glyphs && ACCIDENTAL_GLYPH[text]) {
      const g = glyphRowIcon(glyphs, [ACCIDENTAL_GLYPH[text]], { side0: 2.6 });
      if (g) { b.replaceChildren(g); b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; }
    }
  }
}

/** Watch the page: every button added or re-labelled later is iconified too (panels redraw themselves). The score itself is skipped. */
export function installIconify(root = document.body, { glyphs = null } = {}) {
  iconifyButtons(root, glyphs);
  const skip = (n) => !n || n.nodeType !== 1 || n.namespaceURI !== 'http://www.w3.org/1999/xhtml' || n.closest?.('#view-host, [data-score-svg]');
  let queued = new Set(), scheduled = false;
  const flush = () => { scheduled = false; const todo = queued; queued = new Set(); for (const n of todo) if (n.isConnected) iconifyButtons(n, glyphs); };
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      const nodes = r.type === 'childList' ? [...r.addedNodes, r.target] : [r.target.parentElement];
      for (const n of nodes) {
        const el = n?.nodeType === 3 ? n.parentElement : n;
        if (el && !skip(el)) queued.add(el.tagName === 'BUTTON' || !el.closest('button') ? el : el.closest('button'));
      }
    }
    if (queued.size && !scheduled) { scheduled = true; queueMicrotask(flush); }
  });
  obs.observe(root, { childList: true, subtree: true, characterData: true });
  return () => obs.disconnect();
}

/**
 * The icon of a catalogue instrument for the interface: the photograph for `soprano-photo` when `photo` is on (a joke, see model/icon-photos.js),
 * otherwise the stroke icon.
 */
export function instrumentIconNode(name, { photo = true, size = '1.5em' } = {}) {
  const src = photo ? photoOf(name) : null;
  if (!src) return icon(name, { size, weight: INSTRUMENT_WEIGHT });
  const img = document.createElement('img');
  img.src = src; img.alt = ''; img.setAttribute('data-instrument-photo', '');
  img.style.cssText = `width:${size};height:${size};border-radius:6px;object-fit:cover;flex:none;display:block`;
  return img;
}
