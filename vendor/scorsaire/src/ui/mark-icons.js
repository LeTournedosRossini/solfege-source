/*
 * Glyph icons for the marks drawer buttons (articulations, dynamics, spans, guitar techniques).
 * The glyph is the SAME Bravura glyph the score draws, at a fixed scale (pixels per staff space) so that relative sizes stay true
 * (a staccato dot stays small, a forte stays tall). Buttons with no natural glyph keep their text (see `ICON_FALLBACK`).
 * The tables are pure data; only `markIcon` touches the DOM.
 */
import { dynamicGlyphs } from '../model/dynamics.js';

const NS = 'http://www.w3.org/2000/svg';
const UNITS_PER_SPACE = 250; // glyph paths are in font units (1000 per em, 4 spaces per em)

/** Glyph names (left to right) of each articulation / ornament button. */
export const ARTICULATION_ICONS = Object.freeze({
  staccato: ['articStaccatoAbove'], tenuto: ['articTenutoAbove'], accent: ['articAccentAbove'], marcato: ['articMarcatoAbove'],
  staccatissimo: ['articStaccatissimoAbove'], portato: ['articTenutoStaccatoAbove'], tenutoAccent: ['articTenutoAccentAbove'],
  accentStaccato: ['articAccentStaccatoAbove'], fermata: ['fermataAbove'],
  mordent: ['ornamentMordent'], mordentInverted: ['ornamentMordentInverted'], turn: ['ornamentTurn'], turnInverted: ['ornamentTurnInverted'],
  trill: ['ornamentTrill'],
  golpe: ['guitarGolpe'], pickDown: ['stringsDownBow'], pickUp: ['stringsUpBow'],
});
/** Chord techniques and note flags; `rotate` in degrees (clockwise, quarter turns only). */
export const TECHNIQUE_ICONS = Object.freeze({
  'tapping-left': { names: ['windClosedHole'] },
  'tapping-right': { names: ['pluckedLeftHandPizzicato'] },
  'arpeggio-normal': { names: ['wiggleArpeggiatoUp', 'wiggleArpeggiatoUp'], rotate: -90 },
  'arpeggio-up': { names: ['wiggleArpeggiatoUp', 'wiggleArpeggiatoUp', 'wiggleArpeggiatoUpArrow'], rotate: -90 },
  'arpeggio-down': { names: ['wiggleArpeggiatoUp', 'wiggleArpeggiatoUp', 'wiggleArpeggiatoUpArrow'], rotate: 90 },
  'slide-fall': { names: ['brassFallRoughShort'] },
  'slide-doit': { names: ['brassLiftShort'] },
  muted: { names: ['noteheadXBlack'] },
  harmonic: { names: ['noteheadDiamondBlack'] },
  vibrato: { names: ['guitarVibratoStroke', 'guitarVibratoStroke', 'guitarVibratoStroke', 'guitarVibratoStroke'] },
});

/** System-object glyphs: fermata kinds and score markers (the glyphs the layout draws). */
export const SYSTEM_ICONS = Object.freeze({
  'fermata:fermataVeryShort': ['fermataVeryShortAbove'], 'fermata:fermataShort': ['fermataShortAbove'], 'fermata:fermataShortHenze': ['fermataShortHenzeAbove'],
  'fermata:fermata': ['fermataAbove'], 'fermata:fermataLong': ['fermataLongAbove'], 'fermata:fermataLongHenze': ['fermataLongHenzeAbove'],
  'fermata:fermataVeryLong': ['fermataVeryLongAbove'],
  'marker:segno': ['segno'], 'marker:varsegno': ['segnoSerpent1'], 'marker:coda': ['coda'], 'marker:varcoda': ['codaSquare'], 'marker:codetta': ['coda', 'coda'],
});

/** Glyph names of a dynamic (several for composed ones such as sff); [] when the font has none. */
export const dynamicIcon = (type) => dynamicGlyphs(type);

const glyphOf = (glyphs, name) => glyphs.glyphs?.[name] ?? null;

/** Every glyph name the tables ask for (used by a test to check the subset has them). */
export function requiredGlyphNames(dynamicTypes = []) {
  const out = new Set();
  for (const list of Object.values(ARTICULATION_ICONS)) for (const n of list) out.add(n);
  for (const e of Object.values(TECHNIQUE_ICONS)) for (const n of e.names) out.add(n);
  for (const list of Object.values(SYSTEM_ICONS)) for (const n of list) out.add(n);
  for (const t of dynamicTypes) for (const n of dynamicIcon(t)) out.add(n);
  return [...out];
}

/** CSS size of an icon box inside a square button: the button side minus a margin. */
export const ICON_BOX = 'calc(var(--ui-target,44px) - 8px)';

/**
 * Small SVG showing `names` in a row, centred in a SQUARE frame. The frame side is max(glyph width, glyph height, `side0` staff spaces):
 * glyphs smaller than `side0` keep their true relative size (a staccato dot stays small), bigger ones shrink to fit.
 * Size on screen: `px` (fixed box, pixels) or the button-relative `ICON_BOX`. Null when a glyph is missing.
 */
export function glyphRowIcon(glyphs, names, { side0 = 0, rotate = 0, gap = 0, px = null } = {}) {
  if (!names.length) return null;
  const parts = [];
  let x = 0, y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const name of names) {
    const g = glyphOf(glyphs, name);
    if (!g) return null;
    const [ne, sw] = [g.bbox.bBoxNE, g.bbox.bBoxSW];
    x0 = Math.min(x0, x + sw[0] * UNITS_PER_SPACE); x1 = Math.max(x1, x + ne[0] * UNITS_PER_SPACE);
    y0 = Math.min(y0, -ne[1] * UNITS_PER_SPACE); y1 = Math.max(y1, -sw[1] * UNITS_PER_SPACE); // glyph paths are y-down with their origin at the TOP of the bbox: shift each by -top so the baseline sits at y = 0
    parts.push({ d: g.path, x, y: -ne[1] * UNITS_PER_SPACE });
    x += (g.advance ?? ne[0]) * UNITS_PER_SPACE + gap;
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-mark-icon', names.join(' '));
  const turned = Math.abs(rotate) % 180 === 90;
  const w = x1 - x0, h = y1 - y0;
  const side = Math.max(turned ? h : w, turned ? w : h, side0 * UNITS_PER_SPACE) * 1.05;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  svg.setAttribute('viewBox', `${-side / 2} ${-side / 2} ${side} ${side}`);
  svg.style.cssText = `width:${px ? `${px}px` : ICON_BOX};height:${px ? `${px}px` : ICON_BOX};overflow:visible;flex:none;display:block`;
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `${rotate ? `rotate(${rotate}) ` : ''}translate(${-cx},${-cy})`);
  for (const p of parts) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('transform', `translate(${p.x},${p.y})`);
    path.setAttribute('fill', 'currentColor');
    g.append(path);
  }
  svg.append(g);
  return svg;
}

/**
 * A drum sound as a musician reads it: its notehead on its own place of a five-line staff (`line` = half-spaces from the top line, like the percussion map).
 * Several sounds share one head (closed hi-hat, ride, crash are all crosses), so the height is what tells them apart. Null when the glyph is missing.
 */
export function drumStaffIcon(glyphs, glyphName, line, { px = 24 } = {}) {
  const g = glyphOf(glyphs, glyphName);
  if (!g) return null;
  const U = UNITS_PER_SPACE, H = U / 2, W = 7 * U; // one half-space = H; the frame runs from half-space -4 to 10
  const yOf = (l) => (l + 4) * H;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-drum-icon', glyphName);
  svg.setAttribute('viewBox', `0 0 ${W} ${14 * H}`);
  svg.style.cssText = `width:${px}px;height:${px * 2}px;overflow:visible;flex:none;display:block`;
  const stroke = (x1, x2, l, o) => {
    const e = document.createElementNS(NS, 'line');
    e.setAttribute('x1', x1); e.setAttribute('x2', x2); e.setAttribute('y1', yOf(l)); e.setAttribute('y2', yOf(l));
    e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', 34); e.setAttribute('opacity', o);
    svg.append(e);
  };
  for (const l of [0, 2, 4, 6, 8]) stroke(0, W, l, 0.35);
  const ledger = [];
  for (let l = -2; l >= line; l -= 2) ledger.push(l);
  for (let l = 10; l <= line; l += 2) ledger.push(l);
  for (const l of ledger) stroke(W / 2 - 1.1 * U, W / 2 + 1.1 * U, l, 0.35);
  const [ne, sw] = [g.bbox.bBoxNE, g.bbox.bBoxSW];
  const cx = ((sw[0] + ne[0]) / 2) * U, cy = ((-ne[1] - sw[1]) / 2) * U;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', g.path);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('transform', `translate(${W / 2 - cx},${yOf(line) - cy}) translate(0,${-ne[1] * U})`);
  svg.append(path);
  return svg;
}

/**
 * Icons drawn here (24 x 24, currentColor): no glyph exists for them. `d` = stroked path, `fill` = filled shape (arrow heads, dots).
 * MuseScore's palette uses icon-font images for the bends and dives (not reusable); these are our own, simple versions.
 */
const DRAWN = Object.freeze({
  'span:cresc': [{ d: 'M2 12 L22 5 M2 12 L22 19' }],
  'span:decresc': [{ d: 'M2 5 L22 12 M2 19 L22 12' }],
  'span:slur': [{ d: 'M3 17 C8 5 16 5 21 17' }],
  'flag:ghost': [{ d: 'M9 4 C5 9 5 15 9 20 M15 4 C19 9 19 15 15 20' }],
  'chord:arpeggio-bracket': [{ d: 'M16 3 H8 V21 H16' }],
  'bend:bend': [{ d: 'M3 19 L9 19 L19 7' }, { fill: 'M20 4 L15 8 L21 10 Z' }],
  'bend:preBend': [{ d: 'M5 21 V8 M5 6 H20' }, { fill: 'M5 3 L2 9 L8 9 Z' }],
  'bend:graceNoteBend': [{ d: 'M5 19 L19 7' }, { fill: 'M2 19 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M20 4 L15 8 L21 10 Z' }],
  'bend:slightBend': [{ d: 'M3 16 L20 9' }],
  'bend:dive': [{ d: 'M3 5 L9 5 L19 17' }, { fill: 'M20 21 L15 16 L21 14 Z' }],
  'bend:preDive': [{ d: 'M5 3 V16 M5 18 H20' }, { fill: 'M5 21 L2 15 L8 15 Z' }],
  'bend:dip': [{ d: 'M3 5 L11 19 L19 5' }],
  'bend:scoop': [{ d: 'M3 19 C10 19 16 14 21 5' }],
  'bend:wheel': [{ d: 'M3 18 C8 18 9 7 14 7 C18 7 18 12 21 12' }, { d: 'M3 21 H21' }],
  // repeat bars: thick bar + thin bar + two dots (the score draws the bars natively; Bravura only has the dots)
  'acc:bass': [{ fill: 'M6.2 19.2 a3.6 2.5 -25 1 0 7.2 0 a3.6 2.5 -25 1 0 -7.2 0' }, { d: 'M12.9 18.2 V4.5' }],
  'acc:chord': [{ fill: 'M6.2 20 a3.6 2.5 -25 1 0 7.2 0 a3.6 2.5 -25 1 0 -7.2 0 M6.2 15.4 a3.6 2.5 -25 1 0 7.2 0 a3.6 2.5 -25 1 0 -7.2 0 M6.2 10.8 a3.6 2.5 -25 1 0 7.2 0 a3.6 2.5 -25 1 0 -7.2 0' }, { d: 'M12.9 9.8 V3.5' }],
  'view:wrap': [{ d: 'M4 7H20 M4 12H20 M4 17H14' }],
  'view:scroll': [{ d: 'M3 12H21 M16 7L21 12L16 17' }],
  'repeat:start': [{ fill: 'M3 3 H7 V21 H3 Z M9 3 H10.6 V21 H9 Z M14 8 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 M14 16 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0' }],
  'repeat:end': [{ fill: 'M17 3 H21 V21 H17 Z M13.4 3 H15 V21 H13.4 Z M6.8 8 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 M6.8 16 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0' }],
  'entry:toggle': [{ d: 'M3 17 L4 12 L13 3 L17 7 L8 16 Z M11 5 L15 9 M11 21 H22' }],
  'creation:semitone': [{ fill: 'M12 2.5 L19 10.5 H5 Z M12 21.5 L19 13.5 H5 Z' }],
  'retouch:length': [{ d: 'M3 12 H21 M3 7 V17 M21 7 V17' }],
  'entry:grid': [{ d: 'M3 3 H21 V21 H3 Z M3 12 H21 M12 3 V21' }],
  'bend:release': [{ d: 'M3 19 L10 6 L19 17' }, { fill: 'M20 21 L15 16 L21 14 Z' }],
});

/** Buttons whose label is a SHORT text (the very text MuseScore shows for the same sign), kept in a square button. */
const SHORT_TEXT = Object.freeze({
  'tech:palmMute': 'P.M.', 'tech:letRing': 'let ring', 'tech:whammyBar': 'w/bar', 'tech:harmonicMark': 'Harm.',
  'volta:1': '1.', 'volta:2': '2.', 'volta:1-2': '1, 2.', 'volta:3': '3.',
  'artic:golpeThumb': 'golpe pouce', 'artic:slap': 'S', 'artic:pop': 'P', 'span:hopo': 'H/P', 'chord:arpeggio-slower': 'Arp +', 'chord:arpeggio-faster': 'Arp −', 'chord:slide-plop': 'plop', 'chord:slide-scoop': 'scoop',
});

/** True when `group:key` has an icon or a short text (used by tests). */
export const hasMarkIcon = (group, key) => Boolean(DRAWN[`${group}:${key}`] || SHORT_TEXT[`${group}:${key}`] || SYSTEM_ICONS[`${group}:${key}`]);

/** Make `button` a square of the interface target size (keeps the tooltip and the accessible name). */
export function squareButton(button) {
  button.style.cssText += ';width:var(--ui-target,44px);height:var(--ui-target,44px);padding:0;display:inline-flex;align-items:center;justify-content:center;flex:none';
}

/** A drawn icon by id (`group:key`), or null. */
export const drawnById = (id) => (DRAWN[id] ? drawnIcon(DRAWN[id]) : null);

/** Largest side, in staff spaces, of the glyphs in `names`: a common frame so that a family of icons keeps one scale. */
export function commonSide(glyphs, names) {
  let side = 0;
  for (const n of names) {
    const g = glyphOf(glyphs, n);
    if (g) side = Math.max(side, g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0], g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1]);
  }
  return side;
}

function drawnIcon(shapes) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.style.cssText = `width:${ICON_BOX};height:${ICON_BOX};flex:none;display:block`;
  for (const sh of shapes) {
    const p = document.createElementNS(NS, 'path');
    if (sh.d) { p.setAttribute('d', sh.d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.4'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); }
    else { p.setAttribute('d', sh.fill); p.setAttribute('fill', 'currentColor'); }
    svg.append(p);
  }
  return svg;
}

/**
 * Put the icon of `group:key` in `button` (replacing its text) and make the button square; the text stays as tooltip and accessible
 * name (set by the caller). `group`: artic | dyn | tech | chord | flag | span | bend. Returns true when something was placed.
 */
export function markIcon(button, glyphs, group, key) {
  if (!glyphs) return false;
  const id = `${group}:${key}`;
  let icon = null;
  if (DRAWN[id]) icon = drawnIcon(DRAWN[id]);
  else if (group === 'artic') icon = glyphRowIcon(glyphs, ARTICULATION_ICONS[key] ?? [], { side0: 1.8 });
  else if (SYSTEM_ICONS[id]) icon = glyphRowIcon(glyphs, SYSTEM_ICONS[id], { side0: 2.4 });
  else if (group === 'dyn') icon = glyphRowIcon(glyphs, dynamicIcon(key), { side0: 2.9 });
  else if (group === 'tech' || group === 'chord' || group === 'flag') { const e = TECHNIQUE_ICONS[key]; icon = e ? glyphRowIcon(glyphs, e.names, { side0: 2.0, rotate: e.rotate ?? 0, gap: key === 'vibrato' ? 0 : 0 }) : null; }
  if (icon) { button.replaceChildren(icon); button.style.fontStyle = 'normal'; squareButton(button); return true; }
  if (SHORT_TEXT[id]) {
    button.textContent = SHORT_TEXT[id];
    button.style.cssText += ';font:var(--w-semi,600) 10px/1.05 var(--ui-font,sans-serif);font-style:normal;overflow:hidden;text-align:center';
    squareButton(button);
    return true;
  }
  return false;
}
