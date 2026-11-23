/*
 * Espacement horizontal PAR FORMES — port de `HorizontalSpacing` (MuseScore 4.7.5, `rendering/score/horizontalspacing.cpp`) :
 * `minHorizontalDistance` (formes), `computePadding` / `computeNotePadding`, règles de kerning, verticalité, et le balayage
 * `spaceSegments` / `spaceAgainstPreviousSegments`. Fonctions pures, sans DOM.
 *
 * Une FORME de segment pour une portée = liste d'éléments typés (rectangles) dans le repère du segment (x vers la droite, 0 = origine
 * du segment ; y quelconque mais cohérent entre éléments) :
 *   { type (PADDING_TYPES), l, r, t, b                    rectangle (t < b ou l'inverse : normalisé)
 *     mag = 1                                             échelle (padding × (mag1 + mag2) / 2)
 *     voice                                               identifiant de piste (« track ») : même voix = kerning limité
 *     staff                                               indice de portée (silence de mesure : ignore les autres portées)
 *     rtick, endTick                                      début / fin de l'accord (fractions en nombre) : « adjacent par durée »
 *     grace, fret (chaîne de frette : note de tablature), width (largeur de la tête),
 *     attach: [{ line, x, kind: 'tie'|'glissando-straight'|'glissando-wavy'|'bend'|'noteline' }]   points d'accroche de lignes,
 *     ledgerRestLeft                                      bbox.left d'un silence à variante « ligne supplémentaire »
 *     midClef, above (chiffrage au-dessus), fullRest, articulationUp, up (sens de l'accord), kernAbove, kernBelow, offsetSecond,
 *     cy (ordonnée du centre, pour le sens du kerning d'une note), melismaEnd… }
 * Hors périmètre (étapes ultérieures) : paroles, harmonies, diagrammes d'accord (types présents dans la table, règles de paroles non portées).
 */
import { createPaddingTable } from './padding.js';

const norm = (e) => ({
  ...e,
  l: Math.min(e.l, e.r), r: Math.max(e.l, e.r), t: Math.min(e.t, e.b), b: Math.max(e.t, e.b),
});

/** `intersects(a, b, c, d, clearance)` de `shape.h` : intervalles verticaux, nuls = jamais. */
export function intervalsIntersect(a, b, c, d, clearance = 0) {
  if (a === b || c === d) return false;
  return b + clearance > c && a < d + clearance;
}

/** Les deux rectangles se recouvrent-ils (surface non nulle) ? Sert au test « formes qui s'intersectent » de `computeNotePadding`. */
export function rectsIntersect(a, b) {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

// ─── Types d'éléments aux règles de kerning ────────────────────────────────────────────────────────────────────────────────────
const SAME_VOICE_LIMITED = new Set(['NOTE', 'NOTEDOT', 'REST', 'STEM', 'CHORDLINE', 'BREATH']);
const isNeverKernable = (e) => {
  switch (e.type) {
    case 'CLEF': return !e.midClef;
    case 'KEYSIG': case 'BAR_LINE': return true;
    case 'TIMESIG': return !e.above;
    default: return false;
  }
};
const isAlwaysKernable = (e) => ['CHORDLINE', 'PARENTHESIS', 'FRET_DIAGRAM'].includes(e.type) || e.text === true;
const isArticulationOrFermata = (e) => e.type === 'ARTICULATION' || e.type === 'FERMATA';

export const KERNING = Object.freeze({
  KERNING: 'KERNING', NON_KERNING: 'NON_KERNING', ALLOW_COLLISION: 'ALLOW_COLLISION',
  KERN_UNTIL_LEFT_EDGE: 'KERN_UNTIL_LEFT_EDGE', KERN_UNTIL_CENTER: 'KERN_UNTIL_CENTER', KERN_UNTIL_RIGHT_EDGE: 'KERN_UNTIL_RIGHT_EDGE',
});

function noteKerning(note, item2) {
  if (item2.type === 'CLEF') return KERNING.KERN_UNTIL_RIGHT_EDGE;
  const above = note.kernAbove !== false, below = note.kernBelow !== false; // `Chord::allowKerningAbove/Below`
  if (above && below) return KERNING.KERNING;
  if (note.up && note.offsetSecond) return KERNING.KERNING; // une seconde décalée peut toujours être « mordue »
  const kerningAbove = (item2.cy ?? 0) < (note.cy ?? 0);
  if (kerningAbove && !above) return KERNING.NON_KERNING;
  if (!kerningAbove && !below) return KERNING.NON_KERNING;
  return KERNING.KERNING;
}

function baseKerningType(item1, item2) {
  switch (item1.type) {
    case 'BAR_LINE': return KERNING.NON_KERNING; // (paroles/harmonies : hors périmètre)
    case 'CHORDLINE': return item2.type === 'BAR_LINE' ? KERNING.ALLOW_COLLISION : KERNING.KERNING;
    case 'HARMONY': case 'FRET_DIAGRAM':
      return item2.type === 'HARMONY' || item2.type === 'FRET_DIAGRAM' ? KERNING.NON_KERNING : KERNING.KERNING;
    case 'NOTE': return noteKerning(item1, item2);
    case 'CLEF': return item2.type === 'NOTE' ? KERNING.KERN_UNTIL_RIGHT_EDGE : KERNING.KERNING;
    case 'STEM_SLASH':
      return item2.beamId != null && item2.beamId === item1.beamId ? KERNING.ALLOW_COLLISION : KERNING.KERNING;
    case 'PARENTHESIS': return item2.type === 'BAR_LINE' ? KERNING.NON_KERNING : KERNING.KERNING;
    case 'GUITAR_BEND_SEGMENT': return item2.type === 'NOTE' || item2.type === 'REST' ? KERNING.NON_KERNING : KERNING.KERNING;
    default: return KERNING.KERNING;
  }
}

/** `HorizontalSpacing::computeKerning`. */
export function computeKerning(item1, item2) {
  if (isArticulationOrFermata(item1) || isArticulationOrFermata(item2)) {
    if (isArticulationOrFermata(item1) && isArticulationOrFermata(item2) && !!item1.articulationUp === !!item2.articulationUp) {
      return KERNING.NON_KERNING;
    }
    return KERNING.KERNING;
  }
  if (item1.type === 'REST' && item1.fullRest && item1.staff !== item2.staff) return KERNING.ALLOW_COLLISION; // `ignoreItems`
  if (SAME_VOICE_LIMITED.has(item1.type) && SAME_VOICE_LIMITED.has(item2.type) && item1.voice === item2.voice) return KERNING.NON_KERNING;
  if ((isNeverKernable(item1) || isNeverKernable(item2)) && !(isAlwaysKernable(item1) || isAlwaysKernable(item2))) {
    return KERNING.NON_KERNING;
  }
  return baseKerningType(item1, item2);
}

/** `computeVerticalClearance` : 0,1 sp devant une altération ou une parenthèse, 0,2 sp sinon. */
export function verticalClearance(item1, item2) {
  if (item2?.type === 'ACCIDENTAL') return 0.1;
  if (item1?.type === 'PARENTHESIS' || item2?.type === 'PARENTHESIS') return 0.1;
  return 0.2;
}

const isSpecialNotePaddingType = (t) => t === 'NOTE' || t === 'REST' || t === 'STEM';

/** `computeNotePadding` : la valeur modifiée remplace `padding` (retournée). */
function notePadding(note, item2, padding, scaling, table, style) {
  const sameVoiceNoteOrStem = (item2.type === 'NOTE' || item2.type === 'STEM') && note.voice === item2.voice;
  const adjacentByDuration = note.endTick != null && note.endTick === item2.rtick;
  if (sameVoiceNoteOrStem || adjacentByDuration) {
    if (rectsIntersect(note, item2)) padding = Math.max(padding, style.minNoteDistance);
  }
  padding *= scaling;
  if (!(item2.type === 'NOTE' || item2.type === 'REST')) return padding;

  if (note.grace && item2.type === 'NOTE' && item2.grace) padding = Math.max(padding, style.graceToGraceNoteDist);
  else if (note.grace && (item2.type === 'REST' || (item2.type === 'NOTE' && !item2.grace))) padding = Math.max(padding, style.graceToMainNoteDist);
  else if (!note.grace && item2.type === 'NOTE' && item2.grace) padding = Math.max(padding, style.graceToMainNoteDist);

  if (note.fret && item2.type === 'NOTE') padding *= 1.5; // `tabFretPaddingIncrease`

  if (item2.type !== 'NOTE' || !note.attach?.length || !item2.attach?.length) return padding;
  for (const a1 of note.attach) {
    for (const a2 of item2.attach) {
      if (a1.line !== a2.line) continue;
      let minEnd = 0;
      switch (a1.kind) {
        case 'tie': minEnd = style.minTieLength; break;
        case 'glissando-straight': minEnd = style.minStraightGlissandoLength; break;
        case 'glissando-wavy': minEnd = style.minWigglyGlissandoLength; break;
        case 'bend': minEnd = 2; break;
        case 'noteline': minEnd = style.minStraightGlissandoLength; break;
        default: break;
      }
      const lap = ((a1.x - (note.width ?? 0)) + minEnd - a2.x) * scaling;
      padding = Math.max(padding, lap);
    }
  }
  return padding;
}

/**
 * `HorizontalSpacing::computeLyricsPadding` : une syllabe suivie d'un mélisme (si `lyricsMelismaForce`) garde la place du trait (longueur minimale +
 * 2 × vide), une syllabe BEGIN / MIDDLE suivie d'une syllabe garde la place d'un tiret (`lyricsDashForce`).
 */
function lyricsPadding(item1, item2, padding, style) {
  if (item1.lyric.melisma && style.lyricsMelismaForce) return Math.max(padding, style.lyricsMelismaMinLength + 2 * style.lyricsMelismaPad);
  if (item2.type === 'LYRICS' && (item1.lyric.syllabic === 'begin' || item1.lyric.syllabic === 'middle') && style.lyricsDashForce) {
    return Math.max(padding, style.lyricsDashMinLength + 2 * style.lyricsDashPad);
  }
  return padding;
}

/** `HorizontalSpacing::computePadding` (parenthèses : voir `parentheses`, non spécialisé ici — valeur de table). */
export function computePadding(item1, item2, table, style) {
  let padding = table.at(item1.type, item2.type);
  const lyricsOnly = item1.type === 'LYRICS' && (item2.type === 'NOTE' || item2.type === 'REST' || item2.type === 'LYRICS');
  const scaling = ((item1.mag ?? 1) + (item2.mag ?? 1)) / 2;
  if (item1.type === 'NOTE' && isSpecialNotePaddingType(item2.type)) padding = notePadding(item1, item2, padding, scaling, table, style);
  else padding *= scaling;
  if (lyricsOnly && item1.lyric) padding = lyricsPadding(item1, item2, padding, style);
  if (item1.type !== 'LEDGER_LINE' && item2.type === 'REST' && item2.ledgerRestLeft != null) padding += item2.ledgerRestLeft;
  return padding;
}

/**
 * `minHorizontalDistance(const Shape& f, const Shape& s, spatium, squeezeFactor)` : plus petite distance entre l'origine de `f` et
 * celle de `s` pour qu'aucune paire d'éléments ne se chevauche. Formes vides → -Infinity.
 */
export function shapeMinDistance(f, s, { table, style, squeeze = 1 }) {
  let dist = -Infinity;
  const minPad = 0.1 * squeeze;
  const F = f.map(norm), S = s.map(norm);
  for (const r2 of S) {
    for (const r1 of F) {
      const clearance = verticalClearance(r1, r2) * squeeze;
      const intersection = intervalsIntersect(r1.t, r1.b, r2.t, r2.b, clearance);
      let padding = computePadding(r1, r2, table, style) * squeeze;
      padding = Math.max(padding, minPad);
      const kerning = computeKerning(r1, r2);
      if (kerning === KERNING.ALLOW_COLLISION) continue;
      if (kerning === KERNING.NON_KERNING || intersection || r1.r - r1.l === 0 || r2.r - r2.l === 0) {
        dist = Math.max(dist, r1.r - r2.l + padding);
        continue;
      }
      if (kerning === KERNING.KERN_UNTIL_LEFT_EDGE) dist = Math.max(dist, r1.l - r2.l);
      else if (kerning === KERNING.KERN_UNTIL_CENTER) dist = Math.max(dist, r1.l + 0.5 * (r1.r - r1.l) - r2.l);
      else if (kerning === KERNING.KERN_UNTIL_RIGHT_EDGE) dist = Math.max(dist, r1.r - r2.l);
    }
  }
  return dist;
}

/** Distance minimale entre deux segments = max sur les portées (jamais négative), `minHorizontalDistance(Segment, Segment)`. */
export function segmentMinDistance(f, ns, opts) {
  let ww = -Infinity;
  const n = Math.max(f.shapes.length, ns.shapes.length);
  for (let si = 0; si < n; si += 1) {
    const d = shapeMinDistance(f.shapes[si] ?? [], ns.shapes[si] ?? [], opts);
    ww = Math.max(ww, d);
  }
  return Math.max(ww, 0);
}

/** `Segment::minRight` : bord droit le plus à droite des formes (≥ 0 comme `Shape::right`, -∞ si vide → 0). */
export function segmentMinRight(seg) {
  let r = 0;
  for (const sh of seg.shapes) for (const e of sh) r = Math.max(r, Math.max(e.l, e.r));
  return r;
}
/** `Segment::minLeft` calculé contre une paroi à x = 0 : -bord gauche le plus à gauche (≥ 0). */
export function segmentMinLeft(seg) {
  let l = 0;
  for (const sh of seg.shapes) for (const e of sh) l = Math.max(l, -Math.min(e.l, e.r));
  return l;
}

/** `stopCheckingPreviousSegments` (sans paroles/harmonies). */
function stopChecking(prev, cur, xCur) {
  if (prev.endTick >= cur.tick) return false;
  if (!cur.isCR) return true;
  let curMinLeft = Infinity, prevMinRight = -Infinity;
  for (const sh of cur.shapes) for (const e of sh) curMinLeft = Math.min(curMinLeft, e.l, e.r);
  for (const sh of prev.shapes) for (const e of sh) prevMinRight = Math.max(prevMinRight, e.l, e.r);
  return curMinLeft + xCur > prevMinRight + prev.x;
}

/**
 * Balayage de `spaceSegments`. `segs` = [{ shapes: [items par portée], isCR, tick, endTick (instants en nombres comparables),
 * naturalWidth (segments ChordRest : largeur naturelle ajoutée à `xCur` après le placement), firstX? (x du 1er segment : par défaut 0),
 * leadingSpace? }]. Retourne `xs` (un x par segment, dans le repère de `xStart`).
 */
export function spaceSegments(segs, opts, xStart = 0) {
  const placed = [];
  let xCur = xStart;
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    const record = (x) => ({ seg, x, endTick: seg.endTick, tick: seg.tick, isCR: seg.isCR, shapes: seg.shapes, rightAligned: Boolean(seg.rightAligned) });
    if (!placed.length) {
      xCur += seg.firstX ?? 0;
      placed.push(record(xCur));
    } else {
      let x = -Infinity;
      let prevCR = 0;
      for (let k = placed.length; k > 0; k -= 1) {
        const prev = placed[k - 1];
        if (prev.isCR) prevCR += 1;
        const minDist = segmentMinDistance({ shapes: prev.shapes }, seg, opts);
        x = Math.max(x, prev.x + minDist);
        if (x > xCur) {
          if (prevCR > 0) {
            const inc = (x - xCur) / prevCR;
            let move = inc;
            for (let j = k; j < placed.length; j += 1) {
              placed[j].x += move;
              if (placed[j].isCR) move += inc;
            }
          }
          xCur = x;
        }
        if (stopChecking(prev, { tick: seg.tick, isCR: seg.isCR, shapes: seg.shapes }, xCur)) break;
      }
      // segment aligné à droite (clé, respiration) : posé à `x` (juste après ce qui précède), pas à `xCur` (`spaceAgainstPreviousSegments`)
      placed.push(record(seg.rightAligned ? x : xCur));
    }
    placed[placed.length - 1].x += seg.leadingSpace ?? 0;
    if (seg.isCR) xCur += seg.naturalWidth ?? 0;
  }
  moveRightAlignedSegments(placed, opts);
  const xs = placed.map((p) => p.x);
  xs.links = placed.map((p) => p.links ?? null);
  return xs;
}

/**
 * `HorizontalSpacing::moveRightAlignedSegments` : un segment aligné à droite est ramené contre les segments qui le SUIVENT, à leur distance
 * minimale (le plus proche l'emporte). `links[i]` = `[{ index, dist }]` des segments suivants considérés : après un étirement ultérieur de la
 * mesure, la position est `min(x[index] − dist)` (la respiration reste collée à ce qui la suit).
 */
function moveRightAlignedSegments(placed, opts) {
  for (let i = 0; i < placed.length; i += 1) {
    if (!placed[i].rightAligned) continue;
    let x = Infinity;
    const links = [];
    for (let j = i + 1; j < placed.length; j += 1) {
      const following = placed[j];
      const minDist = segmentMinDistance({ shapes: placed[i].shapes }, following, opts);
      if (following.rightAligned && minDist === 0) continue;
      links.push({ index: j, dist: minDist });
      x = Math.min(x, following.x - minDist);
    }
    if (x !== Infinity) { placed[i].x = x; placed[i].links = links; }
  }
}

export { createPaddingTable };
