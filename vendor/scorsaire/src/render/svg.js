/*
 * Rendu SVG — géométrie (layout) → chaîne SVG. Aucune dépendance au DOM : testable sous Node.
 *
 * Glyphes (roadmap §6) : chemins Bravura, 250 unités brutes = 1 espace de portée. L'origine y du chemin est le HAUT de sa
 * boîte englobante (bBoxNE[1]) : on place donc le glyphe à y_musique + bBoxNE[1] × échelle.
 * Lignes de portée, hampes, barres : dessinées nativement (traits), jamais par un glyphe.
 * Chaque élément lié au modèle porte `data-ref` (identifiant du modèle) : hit-test, curseur et vérifications de parité.
 */

import { itemRect } from '../layout/bounds.js';
import { iconNodes, thinNodes, INSTRUMENT_WEIGHT } from '../model/iconshapes.js';
import { photoOf } from '../model/icon-photos.js';
import { assetHref } from '../model/assets.js';

const f = (n) => Math.round(n * 1000) / 1000;

// horizontal extent (staff spaces) of each display item, for the windowed rendering: computed once per item
const XSPAN = new WeakMap();
const xSpanOf = (it, glyphs) => {
  // the most numerous items give their span without building a box nor touching the cache (same numbers as `itemRect`)
  if (it.kind === 'glyph' && !it.rotate) {
    const g = glyphs.glyphs[it.name];
    if (g) { const mag = it.mag ?? 1; const a = it.x + g.bbox.bBoxSW[0] * mag; const b = it.x + g.bbox.bBoxNE[0] * mag; return a < b ? [a, b] : [b, a]; }
  } else if (it.kind === 'line') return it.x1 < it.x2 ? [it.x1, it.x2] : [it.x2, it.x1];
  let v = XSPAN.get(it);
  if (v === undefined) { const r = itemRect(it, glyphs); v = r && Number.isFinite(r.x1 + r.x2) ? [r.x1, r.x2] : null; XSPAN.set(it, v); }
  return v;
};

/** Couleur des éléments masqués quand on les affiche (gris, comme `invisibleColor` de MuseScore). */
const INVISIBLE_INK = 'var(--invisible, #8a8a8a)';
const MUTED_INK = 'var(--muted-ink, #b3b0aa)';

/** Dégradés nommés (`circle.fill = 'gradient:<nom>'`). Bouton d'accordéon : relief radial (annexe A, notation-main-gauche §9.2). */
let insertCounter = 0;
/**
 * Makes the gradient ids of a drawing unique before it goes into the page. The drawing itself stays deterministic; but a page can hold several
 * drawings of the same score (one per screen, the others hidden), and Chrome does not find `url(#id)` in a hidden SVG: the first id of the page wins.
 */
export function uniqueSvgIds(markup) {
  if (!markup.includes('<defs>')) return markup;
  const n = (insertCounter += 1);
  return markup.replace(/\bid="(accButtonShine)"/g, `id="$1-${n}"`).replace(/url\(#(accButtonShine)\)/g, `url(#$1-${n})`);
}
const GRADIENTS = {
  accButtonShine: '<radialGradient id="accButtonShine" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#f1efe9"/><stop offset="100%" stop-color="#d9d5c9"/></radialGradient>',
};

/**
 * @param layout            résultat de layoutMovement()
 * @param glyphs            données Bravura
 * @param opts.staffSpace   taille d'un espace de portée en pixels
 * @param opts.canvasWidth  largeur du canevas en pixels (défaut : celle du contenu + marges)
 * @param opts.margin       marge en pixels autour du contenu
 * @param opts.cullY        [y1, y2] en pixels du SVG : seuls les systèmes qui touchent cette fenêtre verticale sont écrits (vue en lignes d'une longue partition)
 * @param opts.exceptWithin [x1, x2] (avec `cullX`) : seuls les éléments de portée qu'un rendu fait avec `cullX = exceptWithin` n'écrit PAS sont écrits, sans les éléments de système (la vue défilante élargit sa fenêtre en ajoutant ces éléments au lieu de tout remplacer)
 * @param opts.cullX        [x1, x2] en pixels du SVG : seuls les éléments de portée qui touchent cette fenêtre sont écrits (vue défilante, voir ui/dom.js) ; ceux dont l'étendue est inconnue sont gardés
 * @param opts.inlineImages les images des blocs sont écrites en `data:` (ce qui quitte la page : export SVG, page imprimée) ; sinon une adresse d'objet courte
 * @param opts.ink          couleur du trait (défaut : variable CSS --ink) ; opts.paper : couleur du fond
 * @param opts.title        nom accessible du dessin (`aria-label` du `<svg role="img">`) ; sans lui l'image n'a pas de nom pour un lecteur d'écran
 */
export function renderSvgString(layout, glyphs, {
  title = null, staffSpace = 14, canvasWidth, margin = 10, ink = 'var(--ink, #1c1b1a)', paper = 'var(--paper, #faf8f4)', showHidden = false, showMuted = false, signGroups = false, showResizeHandles = false, skipRoles: skipGiven = [], cullX = null, cullY = null, exceptWithin = null, inlineImages = false, mono = false,
} = {}) {
  // `mono`: print as if everything were black: no element colour (track menu, part overrides, tinted marks), no coloured bands
  const skipRoles = [...skipGiven, ...(mono ? ['section-band'] : []), ...(showResizeHandles ? [] : ['container-resize'])]; // (the corner that resizes a slot is for the screens that edit it)
  const ss = staffSpace;
  const W = f(canvasWidth ?? layout.width * ss + 2 * margin);
  const H = f(layout.height * ss + margin);
  const color = (c) => (c === 'ink' ? ink : c === 'paper' ? paper : c ?? ink);
  const attrRef = (it) => (it.ref ? ` data-ref="${it.ref}"` : '') + (it.sel ? ` data-sel="${it.sel}"` : '');
  const attrRole = (it) => (it.role ? ` data-role="${it.role}"` : '');

  const parts = [];
  const usedGradients = new Set();
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"${title ? ` aria-label="${String(title).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"` : ''}>`);

  const renderItem = (it) => {
    switch (it.kind) {
      case 'glyph': {
        const g = glyphs.glyphs[it.name];
        if (!g) throw new Error(`Glyphe inconnu : ${it.name}`);
        const mag = it.mag ?? 1;
        const k = (ss * mag) / 250;
        const tx = f(it.x * ss);
        const ty = f(-it.y * ss - g.bbox.bBoxNE[1] * ss * mag);
        if (it.rotate) {
          // glyphe tourné (glissando ondulé) : rotation autour de l'ORIGINE musicale (x, y) du glyphe ; `rotate` en degrés, sens
          // trigonométrique (y vers le haut) → l'angle SVG (y vers le bas) est opposé
          const oy = f(-it.y * ss);
          const dy = f(-g.bbox.bBoxNE[1] * ss * mag);
          return `<g data-glyph="${it.name}"${attrRole(it)}${attrRef(it)} transform="translate(${tx},${oy}) rotate(${f(-it.rotate)}) translate(0,${dy}) scale(${f(k)})"><path d="${g.path}" fill="${color(it.color)}" fill-rule="evenodd"/></g>`;
        }
        // `sx` : compression / étirement HORIZONTAL (symboles d'accord comprimés dans leur case) ; absent = proportionnel
        const scale = it.sx !== undefined && it.sx !== 1 ? `${f(k * it.sx)},${f(k)}` : f(k);
        return `<g data-glyph="${it.name}"${attrRole(it)}${attrRef(it)} transform="translate(${tx},${ty}) scale(${scale})"><path d="${g.path}" fill="${color(it.color)}" fill-rule="evenodd"/></g>`;
      }
      case 'line': {
        const dash = it.dash ? ` stroke-dasharray="${it.dash.map((v) => f(v * ss)).join(',')}"` : '';
        // `into` : hampe ligaturée enfoncée dans la barre (rendu seul, voir layout/stemembed.js) — le bout recule vers les têtes
        const y2 = it.into ? it.y2 - Math.sign(it.y2 - it.y1) * it.into : it.y2;
        // Hampe ligaturée : dessinée AVEC sa barre (voir le cas `polygon`), pas ici.
        if (it.merged) return '';
        return `<line${attrRole(it)}${attrRef(it)} x1="${f(it.x1 * ss)}" y1="${f(-it.y1 * ss)}" x2="${f(it.x2 * ss)}" y2="${f(-y2 * ss)}" stroke="${color(it.color)}" stroke-width="${f(it.width * ss)}"${dash}${it.cap ? ` stroke-linecap="${it.cap}"` : ''}/>`;
      }
      case 'glyph-stretch': {
        // stretched glyph as a staff item (braces of a nested score): `y` = its TOP edge, y up; the outline is in font units, y down from the top
        const g = glyphs.glyphs[it.name];
        if (!g) throw new Error(`Glyphe inconnu : ${it.name}`);
        const sx = f((it.w * ss) / (it.natW * 250));
        const sy = f((it.h * ss) / (it.natH * 250));
        return `<g data-glyph="${it.name}" data-role="${it.role ?? ''}"${attrRef(it)} transform="translate(${f((it.x - g.bbox.bBoxSW[0] * it.w / it.natW) * ss)},${f(-it.y * ss)}) scale(${sx},${sy})"><path d="${g.path}" fill="${ink}"/></g>`;
      }
      case 'bezier': {
        // trait plein suivant une Bézier cubique (ChordLine courbe : `PainterPath::cubicTo`, bout carré, jonction biseautée)
        const q = (v, neg) => f((neg ? -v : v) * ss);
        return `<path${attrRole(it)}${attrRef(it)} d="M${q(it.x1)},${q(it.y1, 1)} C${q(it.c1x)},${q(it.c1y, 1)} ${q(it.c2x)},${q(it.c2y, 1)} ${q(it.x2)},${q(it.y2, 1)}" fill="none" stroke="${ink}" stroke-width="${f(it.width * ss)}" stroke-linecap="${it.cap ?? 'square'}" stroke-linejoin="${it.join ?? 'bevel'}"/>`;
      }
      case 'polyline':
        return `<polyline${attrRole(it)}${attrRef(it)} points="${it.points.map(([px, py]) => `${f(px * ss)},${f(-py * ss)}`).join(' ')}" fill="none" stroke="${ink}" stroke-width="${f(it.width * ss)}" stroke-linecap="${it.cap ?? 'butt'}" stroke-linejoin="${it.join ?? 'miter'}"/>`;
      case 'curve': {
        // Liaisons (tie/slur, tranche 3 — voir layout/slurtie.js) : contour fuselé REMPLI, port de
        // `SlurTieLayout::computeBezier` — deux Béziers cubiques aller (topC1/topC2) puis retour (botC2/botC1)
        // partageant les mêmes extrémités, refermées en un seul chemin rempli (pas de trait uniforme). y inversé
        // comme partout ailleurs (repère de portée : y vers le haut → SVG : y vers le bas).
        const x1 = f(it.x1 * ss);
        const y1 = f(-it.y1 * ss);
        const x2 = f(it.x2 * ss);
        const y2 = f(-it.y2 * ss);
        const topC1x = f(it.topC1x * ss);
        const topC1y = f(-it.topC1y * ss);
        const topC2x = f(it.topC2x * ss);
        const topC2y = f(-it.topC2y * ss);
        const botC1x = f(it.botC1x * ss);
        const botC1y = f(-it.botC1y * ss);
        const botC2x = f(it.botC2x * ss);
        const botC2y = f(-it.botC2y * ss);
        const d = `M${x1},${y1} C${topC1x},${topC1y} ${topC2x},${topC2y} ${x2},${y2} `
          + `C${botC2x},${botC2y} ${botC1x},${botC1y} ${x1},${y1} Z`;
        return `<path${attrRole(it)}${attrRef(it)} d="${d}" fill="${ink}" fill-rule="evenodd" stroke="${ink}" stroke-width="${f((it.strokeWidth ?? 0.02) * ss)}" stroke-linejoin="round"${it.strokeWidth ? ' stroke-linecap="round"' : ''}/>`;
      }
      case 'text': {
        const tx = f(it.x * ss);
        const ty = f(-it.y * ss);
        // `sx` : compression horizontale autour de l'origine du texte (symboles d'accord) ; `letterSpacing` en espaces
        const rot = it.rotate ? ` transform="rotate(${f(-it.rotate)} ${tx} ${ty})"`
          : it.sx !== undefined && it.sx !== 1 ? ` transform="translate(${tx},${ty}) scale(${f(it.sx)},1) translate(${-tx},${-ty})"` : '';
        const spacing = it.letterSpacing ? ` letter-spacing="${f(it.letterSpacing * ss)}"` : '';
        // `family` (défaut serif), `weight` numérique, `central` : centrage vertical sur y (badges, noms de boutons d'accordéon), `color`
        return `<text${attrRole(it)}${attrRef(it)} x="${tx}" y="${ty}" font-family="${it.family ?? 'serif'}" font-size="${f(it.size * ss)}"${it.weight ? ` font-weight="${it.weight}"` : it.bold ? ' font-weight="bold"' : ''}${it.italic ? ' font-style="italic"' : ''}${it.underline ? ' text-decoration="underline"' : ''}${it.anchor ? ` text-anchor="${it.anchor}"` : ''}${spacing}${it.central ? ' dominant-baseline="central"' : ''}${rot} fill="${color(it.color)}">${it.text}</text>`;
      }
      case 'polygon': {
        // Barre portant des hampes enfoncées (`stems`, layout/stemembed.js) : UN SEUL chemin (barre + rectangles de hampes, même
        // orientation, remplissage non nul) → la couverture des pixels de bord est calculée sur l'union. Dessinées à part, la barre et la
        // hampe se superposent aux pixels de bord communs (premier et dernier bout de la ligature) et leur double couverture
        // assombrit ces pixels seulement sur la partie où la hampe recouvre la barre : la hampe semblait décalée et s'arrêter au milieu
        // de la barre (mesuré dans Chromium, 12/10/2026).
        if (it.stems?.length) {
          const pts = it.points.map(([px, py]) => [px * ss, -py * ss]);
          const area = pts.reduce((a, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return a + x * y2 - x2 * y; }, 0);
          const sub = (list) => `M${list.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')} Z`;
          const parts = [sub(pts)];
          for (const st of it.stems) {
            const yEnd = st.y2 - Math.sign(st.y2 - st.y1) * (st.into ?? 0);
            const hw = st.width / 2;
            const xl = (st.x1 - hw) * ss, xr = (st.x1 + hw) * ss, ya = -st.y1 * ss, yb = -yEnd * ss;
            // même sens que la barre : (xl,ya) → (xr,ya) → (xr,yb) → (xl,yb) a l'aire (yb − ya) × (xr − xl) (en y vers le bas)
            const rect = [[xl, ya], [xr, ya], [xr, yb], [xl, yb]];
            const rectArea = (xr - xl) * (yb - ya) * 2;
            parts.push(sub(Math.sign(rectArea) === Math.sign(area) ? rect : rect.slice().reverse()));
          }
          return `<path${attrRole(it)}${attrRef(it)} d="${parts.join(' ')}" fill="${ink}" fill-rule="nonzero"/>`;
        }
        // (a polygon may have its own fill and an outline: the hollow lozenge of a junction bar)
        return `<polygon${attrRole(it)}${attrRef(it)} points="${it.points.map(([px, py]) => `${f(px * ss)},${f(-py * ss)}`).join(' ')}" fill="${it.fill ? color(it.fill) : ink}"${it.stroke ? ` stroke="${color(it.stroke)}" stroke-width="${f((it.strokeWidth ?? 0.1) * ss)}" stroke-linejoin="miter"` : ''}/>`;
      }
      case 'rect':
        return `<rect${attrRole(it)}${attrRef(it)} x="${f(it.x * ss)}" y="${f(-(it.y + it.h) * ss)}" width="${f(it.w * ss)}" height="${f(it.h * ss)}" fill="${color(it.fill)}"/>`;
      case 'circle': {
        const stroke = it.stroke ? ` stroke="${color(it.stroke)}" stroke-width="${f((it.strokeWidth ?? 0.1) * ss)}"` : '';
        // `fill: 'gradient:<nom>'` : dégradé défini dans <defs> (bouton d'accordéon) ; 'none' : sans remplissage
        const fill = typeof it.fill === 'string' && it.fill.startsWith('gradient:') ? `url(#${it.fill.slice(9)})` : it.fill === 'none' ? 'none' : color(it.fill);
        if (fill.startsWith('url(#')) usedGradients.add(it.fill.slice(9));
        return `<circle${attrRole(it)}${attrRef(it)} cx="${f(it.cx * ss)}" cy="${f(-it.cy * ss)}" r="${f(it.r * ss)}" fill="${fill}"${stroke}/>`;
      }
      case 'path': {
        // tracé vectoriel en unités propres (y vers le BAS), placé à (x, y) de la portée : point (u, v) → X = x + scale·(u + dx), Y = y − scale·(v + dy)
        return `<path${attrRole(it)}${attrRef(it)} d="${it.d}" transform="translate(${f(it.x * ss)},${f(-it.y * ss)}) scale(${Math.round(it.scale * ss * 10000) / 10000}) translate(${it.dx ?? 0},${it.dy ?? 0})" fill="${color(it.fill)}"${it.stroke ? ` stroke="${color(it.stroke)}" stroke-width="${it.strokeWidth ?? 0.06}" stroke-linejoin="round"` : ''}/>`;
      }
      default:
        throw new Error(`Élément d'affichage inconnu : ${it.kind}`);
    }
  };

  for (const sys of layout.systems) {
    if (cullY) { // a system far above or below the window is not written at all (its marks may reach a few spaces beyond its box)
      const y0 = (sys.top - 8) * ss; const y1 = (sys.top + sys.height + (sys.zoneAfter?.height ?? 0) + 8) * ss;
      if (y1 < cullY[0] || y0 > cullY[1]) continue;
    }
    parts.push(`<g data-system="${sys.index}" transform="translate(${f(margin + sys.x0 * ss)},${f(sys.top * ss)})">`);
    for (const ov of exceptWithin ? [] : sys.overlays) {
      if (skipRoles.length && skipRoles.includes(ov.role)) continue;
      if (ov.kind === 'glyph-stretch') {
        const g = glyphs.glyphs[ov.name];
        if (!g) throw new Error(`Glyphe inconnu : ${ov.name}`);
        // le tracé est en unités de police (250 par espace), y vers le bas depuis le sommet : on l'étire à w × h
        const sx = f((ov.w * ss) / (ov.natW * 250));
        const sy = f((ov.h * ss) / (ov.natH * 250));
        parts.push(`<g data-glyph="${ov.name}" data-role="${ov.role ?? ''}"${attrRef(ov)} transform="translate(${f((ov.x - g.bbox.bBoxSW[0] * ov.w / ov.natW) * ss)},${f(ov.y * ss)}) scale(${sx},${sy})"><path d="${g.path}" fill="${ink}"/></g>`);
        continue;
      }
      if (ov.kind === 'image') {
        const href = assetHref(ov.image, { inline: inlineImages });
        if (!href) { parts.push(`<rect${attrRole(ov)}${attrRef(ov)} x="${f(ov.x * ss)}" y="${f(ov.y * ss)}" width="${f(ov.w * ss)}" height="${f(ov.h * ss)}" fill="none" stroke="${ink}" stroke-dasharray="4 3" stroke-width="1"/>`); continue; } // a missing picture: an empty frame
        const par = ov.fit === 'stretch' ? 'none' : ov.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
        const box = `x="${f(ov.x * ss)}" y="${f(ov.y * ss)}" width="${f(ov.w * ss)}" height="${f(ov.h * ss)}"`;
        if (ov.crop) { // a part of the picture: the picture lives in a virtual space of the right shape (ratio × 1000 by 1000), the window looks at the crop
          const RW = f((ov.ratio > 0 ? ov.ratio : 1) * 1000); const c = ov.crop;
          parts.push(`<svg${attrRole(ov)}${attrRef(ov)} ${box} viewBox="${f(c.x * RW)} ${f(c.y * 1000)} ${f(c.w * RW)} ${f(c.h * 1000)}" preserveAspectRatio="${par}" overflow="hidden"><image href="${href}" width="${RW}" height="1000" preserveAspectRatio="none"/></svg>`);
        } else parts.push(`<svg${attrRole(ov)}${attrRef(ov)} ${box} overflow="hidden"><image href="${href}" width="100%" height="100%" preserveAspectRatio="${par}"/></svg>`);
        continue;
      }
      if (ov.kind === 'icon-shape') {
        // an instrument icon (strokes on a 24 x 24 grid) or, for the soprano saxophone with the device setting on, the photograph
        const photo = ov.photo ? photoOf(ov.name) : null;
        if (photo) {
          parts.push(`<image${attrRole(ov)} href="${photo}" x="${f(ov.x * ss)}" y="${f(ov.y * ss)}" width="${f(ov.w * ss)}" height="${f(ov.h * ss)}" preserveAspectRatio="xMidYMid slice"/>`);
          continue;
        }
        const nodes = thinNodes(iconNodes(ov.name) ?? []); // instrument icons are drawn a little lighter
        const body = nodes.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v === 'currentColor' ? ink : v}"`).join(' ')}/>`).join('');
        parts.push(`<g${attrRole(ov)} transform="translate(${f(ov.x * ss)},${f(ov.y * ss)}) scale(${f((ov.w * ss) / 24)})" fill="none" stroke="${ink}" stroke-width="${f(2 * INSTRUMENT_WEIGHT)}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`);
        continue;
      }
      if (ov.kind === 'rect') {
        parts.push(`<rect${attrRole(ov)} x="${f(ov.x * ss)}" y="${f(ov.y * ss)}" width="${f(ov.w * ss)}" height="${f(ov.h * ss)}" fill="${color(ov.fill)}"${ov.opacity !== undefined ? ` fill-opacity="${ov.opacity}"` : ''}/>`);
        continue;
      }
      if (ov.kind === 'text') {
        // group label: rotated text centred on (x, y), system coordinates (y down)
        const tx = f(ov.x * ss);
        const ty = f(ov.y * ss);
        parts.push(`<text${attrRole(ov)} x="${tx}" y="${ty}" font-family="${ov.family ?? 'serif'}" font-size="${f(ov.size * ss)}"${ov.bold ? ' font-weight="bold"' : ''}${ov.italic ? ' font-style="italic"' : ''}${ov.underline ? ' text-decoration="underline"' : ''} text-anchor="${ov.anchor ?? 'middle'}" ${ov.central ? ' dominant-baseline="central"' : ''}${ov.rotate ? ` transform="rotate(${-ov.rotate} ${tx} ${ty})"` : ''} fill="${color(ov.color)}">${ov.text}</text>`);
        continue;
      }
      if (ov.kind !== 'path') throw new Error(`Élément de système inconnu : ${ov.kind}`);
      parts.push(
        `<g transform="scale(${ss})"><path${attrRole(ov)}${attrRef(ov)} d="${ov.d}" fill="none" stroke="${!mono && ov.tint && ov.stroke === 'ink' ? ov.tint : color(ov.stroke)}" stroke-width="${ov.strokeWidth}" stroke-linecap="${ov.cap ?? 'butt'}"${ov.dash ? ` stroke-dasharray="${ov.dash.join(' ')}"` : ''}/></g>`
      );
    }
    for (const staff of sys.staves) {
      parts.push(`<g data-staff="${staff.ref}" data-staff-type="${staff.type}" transform="translate(0,${f(staff.originY * ss)})">`);
      const wx1 = cullX ? (cullX[0] - margin) / ss - sys.x0 : 0; const wx2 = cullX ? (cullX[1] - margin) / ss - sys.x0 : 0; // the window in staff spaces, relative to this system
      let inSign = false; // consecutive system-sign items share one group, so that a view can move them to another staff
      const closeSign = () => { if (inSign) { parts.push('</g>'); inSign = false; } };
      const nx1 = exceptWithin ? (exceptWithin[0] - margin) / ss - sys.x0 : 0; const nx2 = exceptWithin ? (exceptWithin[1] - margin) / ss - sys.x0 : 0; // the window already in the page
      for (const it of staff.items) {
        if (exceptWithin) { // a known extent inside the new window and clear of the old one (an element of unknown extent is written by every window)
          const span = cullX ? xSpanOf(it, glyphs) : null;
          if (!span || span[1] < wx1 || span[0] > wx2 || (span[1] >= nx1 && span[0] <= nx2)) continue;
        }
        if (signGroups) {
          const want = !!it.sysSign;
          if (want !== inSign && !(skipRoles.length && skipRoles.includes(it.role))) { closeSign(); if (want) { parts.push(`<g data-syssign data-sys="${sys.index}">`); inSign = true; } }
        }
        if (skipRoles.length && skipRoles.includes(it.role)) continue;
        if (cullX) { const span = xSpanOf(it, glyphs); if (span && (span[1] < wx1 || span[0] > wx2)) continue; }
        if (it.muted && !it.hidden) { // muted notes: grey in the editor, not drawn anywhere else (exports, printed parts, a reader)
          if (!showMuted) continue;
          const keepInk = ink; ink = MUTED_INK; parts.push(renderItem(it)); ink = keepInk; continue;
        }
        if (it.tint && !it.hidden && !mono) { const keepInk = ink; ink = it.tint; parts.push(renderItem(it)); ink = keepInk; continue; } // colour chosen for this element in a printed part
        if (!it.hidden) { parts.push(renderItem(it)); continue; }
        // élément masqué (décor) : jamais montré par défaut (export, impression) ; gris quand on choisit d'afficher les masqués
        if (!showHidden) continue;
        const keepInk = ink;
        ink = INVISIBLE_INK;
        parts.push(renderItem(it));
        ink = keepInk;
      }
      closeSign();
      parts.push('</g>');
    }
    parts.push('</g>');
  }
  if (usedGradients.size) parts.splice(1, 0, `<defs>${[...usedGradients].map((n) => GRADIENTS[n]).join('')}</defs>`);
  parts.push('</svg>');
  return parts.join('');
}
