/*
 * Points d'augmentation sur portée SCORE — port de `ChordLayout::layoutChords3` (positions de points : `dotPosition`, `placeDots`,
 * `getNoteListForDots`), de `layoutNote2` (x du point : `dotPosX + dotNoteDistance`, crochet) et de `RestLayout::layoutRest` (silences),
 * MuseScore v4.7.5. Cas d'une SEULE voix (pas de `combineVoice`, notes d'autres voix/portées non prises en compte : limite assumée).
 * Lignes MuseScore : 0 = ligne du haut, y vers le bas, un demi-interligne par pas ; paire = sur une ligne, impaire = dans un interligne.
 * Décalage relatif du point (`dotRelativeLine`) en demi-interlignes : −1 = au-dessus, +1 = en dessous, 0 = même hauteur que la note.
 */
export const DOT_NOTE_DISTANCE = 0.5; // dotNoteDistance
export const DOT_DOT_DISTANCE = 0.65; // dotDotDistance

/** Ligne de silence : `Rest::getDotline` (demi-interlignes, négatif = au-dessus de l'origine du silence). */
export function restDotLine(base) {
  if (base === 'sixtyfourth' || base === 'thirtysecond') return -3;
  if (base === 'whole' || base === 'measure') return 1;
  if (base === 'onetwentyeighth') return -5;
  return -1;
}

/**
 * Décalages relatifs des points d'un accord.
 * @param lines  ligne MuseScore de chaque note, par hauteur CROISSANTE (comme `chord->notes()`)
 * @param voice  index de voix (0 = voix 1) : une voix paire met ses points vers le haut par défaut
 * @returns tableau (même ordre) de décalages en demi-interlignes
 */
export function dotRelativeLines(lines, voice = 0) {
  const n = lines.length;
  const odd = (voice & 1) === 1;
  // sens souhaité (`layoutChords3`) : de la note la plus haute à la plus basse
  const pos = new Array(n).fill('auto');
  for (let i = n - 1; i >= 0; i--) {
    const line = lines[i];
    if (n > 1 && (line & 1) === 0) {
      const above = i < n - 1 ? lines[i + 1] : null;
      const below = i > 0 ? lines[i - 1] : null;
      const intervalAbove = above === null ? 1000 : line - above;
      const intervalBelow = below === null ? 1000 : below - line;
      if (intervalAbove === 1 && intervalBelow !== 1) pos[i] = 'down';
      else if (intervalBelow === 1 && intervalAbove !== 1) pos[i] = 'up';
    }
    if (pos[i] === 'auto') pos[i] = odd ? 'down' : 'up';
  }
  // `getNoteListForDots` (une seule voix) : les notes dans un interligne ancrent leur point ; les notes sur une ligne se résolvent du haut vers le bas
  const anchored = [];
  const topDown = [];
  lines.forEach((l, i) => { if (l & 1) anchored.push(l); else topDown.push(i); });
  topDown.sort((a, b) => lines[a] - lines[b]);
  // `placeDots`
  const rel = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (lines[i] & 1) continue; // dans un interligne : même hauteur que la tête
    const already = new Map();
    for (const j of topDown) {
      let move = pos[j] === 'down' ? 1 : -1;
      const loc = lines[j] + move;
      const added = already.has(loc);
      if (!added && anchored.includes(loc)) move = -move;
      else if (added && already.get(loc) !== j) move = -move;
      if (j === i) { rel[i] = move; anchored.push(lines[i] + move); break; }
      if (!added) already.set(lines[j] + move, j);
    }
  }
  return rel;
}

/**
 * Éléments d'affichage des points d'un accord.
 * @param ys        ordonnées des notes (y haut), par hauteur croissante
 * @param lines     lignes MuseScore correspondantes
 * @param dotPosX   bord droit de la tête la plus à droite (absolu)
 * @param hook      { right, bottomY, width } crochet visible d'une hampe montante, sinon null (`d = largeur du crochet` si le point le touche)
 * @returns { items, right }
 */
export function chordDotItems({ ys, lines, voice, dots, dotPosX, hook, glyphName = 'augmentationDot', dotWidth, ref, rel: relOverride = null, hidden = null }) {
  // `relOverride` / `hidden` : décalages et notes sans points calculés avec les autres voix (chordvoices.js), même ordre que `ys`
  const rel = relOverride ?? dotRelativeLines(lines, voice);
  let d = DOT_NOTE_DISTANCE;
  if (hook) {
    const topDotY = Math.max(...ys.map((y, i) => y - rel[i] * 0.5));
    // y vers le haut : le point est « au-dessus du bas du crochet » ⇔ `dotY < hookBottom` en y vers le bas
    if (dotPosX < hook.right && topDotY > hook.bottomY) d = hook.width;
  }
  const items = [];
  ys.forEach((y, i) => {
    if (hidden && hidden[i]) return;
    for (let k = 0; k < dots; k++) items.push({ kind: 'glyph', name: glyphName, x: dotPosX + d + k * DOT_DOT_DISTANCE, y: y - rel[i] * 0.5, role: 'dot', ref });
  });
  return { items, right: dotPosX + d + (dots - 1) * DOT_DOT_DISTANCE + dotWidth };
}

/** Points d'un silence : x = largeur du glyphe + 0,5 sp, y = origine ± `dotLine` demi-interlignes. */
export function restDotItems({ x, y, width, base, dots, dotWidth, ref }) {
  const items = [];
  for (let k = 0; k < dots; k++) items.push({ kind: 'glyph', name: 'augmentationDot', x: x + width + DOT_NOTE_DISTANCE + k * DOT_DOT_DISTANCE, y: y - restDotLine(base) * 0.5, role: 'dot', ref });
  return { items, right: x + width + DOT_NOTE_DISTANCE + (dots - 1) * DOT_DOT_DISTANCE + dotWidth };
}
