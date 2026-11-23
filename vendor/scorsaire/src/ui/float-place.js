/*
 * Placement des barres flottantes (PUR, sans DOM) : au-dessus de l'ancre (élément sélectionné, mesure choisie, case active) et centrée sur son
 * milieu en X ; s'il n'y a pas la place au-dessus dans la zone visible, juste en dessous (l'élément reste visible) ; toujours bornée à gauche
 * et à droite. Toutes les coordonnées sont dans le repère de la partition (pixels du SVG).
 */

/** Rectangle englobant d'une liste de formes de sélection (`{x1,y1,x2,y2}` ou `{kind:'path', points}`) ; null si vide. */
export function boundsOfShapes(shapes) {
  const boxes = (shapes ?? []).map((s) => {
    if (s.kind === 'path' && s.points?.length) {
      const xs = s.points.map((p) => p[0]); const ys = s.points.map((p) => p[1]);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    return Number.isFinite(s.x1) ? { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 } : null;
  }).filter(Boolean);
  if (!boxes.length) return null;
  // sélection répartie sur plusieurs systèmes : on s'en tient à la bande verticale de la première forme
  const first = boxes[0];
  const same = boxes.filter((b) => b.y2 >= first.y1 && b.y1 <= first.y2);
  return {
    x1: Math.min(...same.map((b) => b.x1)), y1: Math.min(...same.map((b) => b.y1)),
    x2: Math.max(...same.map((b) => b.x2)), y2: Math.max(...same.map((b) => b.y2)),
  };
}

/**
 * Zone visible (PURE) : la zone de la fenêtre privée des barres qui la recouvrent. Une barre dans la moitié haute de la zone en grignote le
 * haut (barre de transport collante), une barre dans la moitié basse en grignote le bas (barre de saisie fixe). Une barre qui ne recouvre rien
 * (entièrement hors de la zone) est sans effet. Même repère en entrée et en sortie (le décalage éventuel vers un autre repère se fait à
 * l'appelant, `ui/dom.js`).
 * @param viewport { left, top, right, bottom }  zone de la fenêtre (sur téléphone : celle du `visualViewport`, sans le clavier virtuel)
 * @param bars     [{ top, bottom, edge? }] rectangles des barres, dans le même repère ; `edge` ('top' | 'bottom') dit quel bord la barre
 *                 grignote, sinon on le déduit de sa position (milieu dans la moitié haute ou basse de la zone)
 * @returns { left, top, right, bottom } (jamais d'aire négative : le haut ne passe pas sous le bas)
 */
export function visibleArea(viewport, bars = []) {
  const out = { left: viewport.left, top: viewport.top, right: viewport.right, bottom: viewport.bottom };
  const middle = (viewport.top + viewport.bottom) / 2;
  for (const bar of bars) {
    if (!bar || !Number.isFinite(bar.top) || !Number.isFinite(bar.bottom)) continue;
    const edge = bar.edge ?? ((bar.top + bar.bottom) / 2 < middle ? 'top' : 'bottom');
    if (edge === 'top') out.top = Math.max(out.top, bar.bottom);
    else out.bottom = Math.min(out.bottom, bar.top);
  }
  if (out.bottom < out.top) out.bottom = out.top;
  return out;
}

/**
 * @param anchor  { x1, y1, x2, y2 }
 * @param size    { w, h } taille de la barre
 * @param visible { left, right, top, bottom } zone visible (déjà privée de la barre de transport collante)
 * @param gap     espace entre la barre et l'ancre
 * @param prefer  'below' : sous l'ancre si la place le permet (sinon la règle habituelle)
 * @returns { x, y, side: 'above' | 'below' }
 */
export function placeFloating({ anchor, size, visible, gap = 8, prefer = null }) {
  // `prefer: 'below'` (a diagram sits above what is selected: the bar must not hide it): below the anchor when it fits there
  if (prefer === 'below' && anchor.y2 + gap + size.h <= visible.bottom) {
    const width0 = visible.right - visible.left;
    const cx0 = (anchor.x1 + anchor.x2) / 2;
    return { x: size.w >= width0 ? visible.left : Math.min(Math.max(cx0 - size.w / 2, visible.left), visible.right - size.w), y: anchor.y2 + gap, side: 'below' };
  }
  const cx = (anchor.x1 + anchor.x2) / 2;
  const width = visible.right - visible.left;
  let x = size.w >= width ? visible.left : Math.min(Math.max(cx - size.w / 2, visible.left), visible.right - size.w);
  let y = anchor.y1 - gap - size.h;
  let side = 'above';
  if (y < visible.top) {
    side = 'below';
    y = anchor.y2 + gap;
    // ni la place au-dessus ni en dessous : la barre reste dans la zone visible, au plus près de l'ancre
    if (y + size.h > visible.bottom) y = Math.max(visible.top, visible.bottom - size.h);
  }
  return { x, y, side };
}

/**
 * Barre FIXE en bas, immunisée contre le zoom au pincement (zoom visuel) : on la contre-transforme.
 * `vv` = { scale, offsetLeft, offsetTop, height } de `window.visualViewport` ; `barHeight` = hauteur de mise en page de la barre.
 * Renvoie la transformation (origine en haut à gauche, barre en `position:fixed; top:0; left:0`) qui la colle au bas de la zone visible à taille constante à l'écran.
 */
export function counterZoom(vv, barHeight) {
  const s = vv && vv.scale > 0 ? vv.scale : 1;
  const x = vv?.offsetLeft ?? 0;
  const y = (vv?.offsetTop ?? 0) + (vv?.height ?? 0) - barHeight / s;
  return { scale: 1 / s, x, y, transform: `translate(${x}px, ${y}px) scale(${1 / s})` };
}
