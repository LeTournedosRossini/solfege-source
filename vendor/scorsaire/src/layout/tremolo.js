/*
 * Trémolos — port de MuseScore (`dom/tremolosinglechord.cpp`, `rendering/score/tremololayout.cpp` :
 * `layoutOneNoteTremolo`, `rendering/score/stemlayout.cpp` : `calcMinStemLength`, `tdraw.cpp`).
 * Vérifié contre un export MuseScore Studio 4.7.5 (voir tests/layout-tremolo.test.js).
 *
 * Trémolo sur UNE note (`PID.TREMOLO` d'un accord, `{ strokes }` ou `{ buzz: true }`) : `strokes` barres (1 à 6) = un
 * parallélogramme par barre, largeur `tremoloWidth`, épaisseur `tremoloLineWidth`, pas `tremoloDistance`, dont le côté
 * droit est plus haut d'une épaisseur (cisaillement `basePath`) ; ou le glyphe SMuFL `buzzRoll` (roulement).
 *
 * Unités : espaces ; ici tout est calculé dans le repère de MuseScore (y vers le BAS, 0 = ligne du haut de la portée)
 * puis converti par l'appelant : les positions d'entrée/sortie « up » sont, elles, en repère de portée (y vers le haut
 * depuis la ligne du bas). Échelle 1 (`mag` = 1), portée de 5 lignes, distance de lignes 1 (comme stemlength.js).
 */
import { SID } from '../model/index.js';

const LINES = 5;

/** Style des trémolos, lu une fois. */
export function tremoloStyle(style) {
  return {
    width: style(SID.TREMOLO_WIDTH),
    lineWidth: style(SID.TREMOLO_LINE_WIDTH),
    distance: style(SID.TREMOLO_DISTANCE),
    notePadding: style(SID.TREMOLO_NOTE_SIDE_PADDING),
    outPadding: style(SID.TREMOLO_OUT_SIDE_PADDING),
  };
}

/** Nombre de barres tracées (le roulement compte pour 1 : `m_lines` par défaut de TremoloSingleChord). */
export const tremoloLines = (t) => (t.buzz ? 1 : t.strokes);

/** `TremoloSingleChord::minHeight` : hauteur de l'empilement des barres, sans le cisaillement. */
export function tremoloMinHeight(t, s) {
  return (tremoloLines(t) - 1) * s.distance + s.lineWidth;
}

/** Hauteur de la boîte englobante : celle du glyphe (roulement) ou du chemin cisaillé (`computeShape`). */
export function tremoloBBoxHeight(t, s, glyphs) {
  if (t.buzz) {
    const bb = glyphs.glyphs.buzzRoll.bbox;
    return bb.bBoxNE[1] - bb.bBoxSW[1];
  }
  return tremoloMinHeight(t, s) + s.lineWidth; // le cisaillement ajoute lineWidth/2 de chaque côté
}

/**
 * Crochet d'une note seule (`Hook`, `TLayout::layoutHook`) : hauteur de la boîte englobante du glyphe et ancre SMuFL de la
 * hampe — `Hook::smuflAnchor` = stemUpNW (hampe montante) ou stemDownSW (descendante), y RETOURNÉ (MuseScore : y vers le
 * bas, `EngravingFont::loadGlyph` stocke -y). `anchorY` est donc déjà « y vers le bas ».
 */
export function hookMetrics(glyphs, base, up) {
  const name = { eighth: 'flag8th', sixteenth: 'flag16th', thirtysecond: 'flag32nd' }[base];
  if (!name) return null;
  const g = glyphs.glyphs[`${name}${up ? 'Up' : 'Down'}`];
  const anchor = g.anchors[up ? 'stemUpNW' : 'stemDownSW'];
  if (!anchor) throw new Error(`ancre de hampe absente du glyphe ${name}${up ? 'Up' : 'Down'}`);
  return { height: g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1], anchorY: -anchor[1] };
}

/**
 * Terme « trémolo » de `StemLayout::calcMinStemLength` (branche `tremoloSingleChord`), en quarts d'espace.
 * @param line    ligne (demi-espaces depuis la ligne du haut, y vers le bas) de la note du côté de la pointe
 *                (la plus haute si la hampe monte, la plus basse sinon)
 * @param beams   nombre de ligatures/crochets de la durée de l'accord (`Chord::beams`)
 * @param hook    métriques du crochet si l'accord en porte un ({ height, anchorY }), sinon null
 */
export function tremoloMinStemLength({ tremolo, up, line, beams, hook, style, straightFlags = false }) {
  const s = tremoloStyle(style);
  let length = Math.ceil((tremoloMinHeight(tremolo, s) * 4) * (tremolo.buzz ? 2 : 1));
  const outSide = Math.trunc(s.outPadding * 4);
  const noteSide = Math.trunc(s.notePadding * 4);
  const q = line * 2; // quarts d'espace
  let outsideStaffOffset = 0;
  if (!up && q < -2) outsideStaffOffset = -q;
  else if (up && q > LINES * 4) outsideStaffOffset = q - LINES * 4 + 4;
  length += outSide + Math.max(noteSide, outsideStaffOffset);
  if (hook) {
    const anchor = hook.anchorY * (up ? 1 : -1);
    let hookOffset = Math.floor((hook.height + anchor) * 4) - (straightFlags ? 0 : 2);
    hookOffset = Math.min(hookOffset, 11); // certaines polices ont des crochets très longs
    let cutout = up ? 5 : 7;
    if (straightFlags) cutout = 0;
    else if (beams >= 2) cutout -= 2; // au-delà de 2 ligatures elles s'étendent vers l'extérieur
    length += hookOffset - cutout;
  }
  return length;
}

/**
 * Position et dessin d'un trémolo sur une note (`TremoloLayout::layout` + `layoutOneNoteTremolo` + `TDraw`).
 * @param tremolo  { strokes } | { buzz: true }
 * @param up       hampe montante (ou, sans hampe, sens qu'aurait la hampe)
 * @param x        axe de la hampe ; sans hampe : centre de la tête de l'accord (l'appelant le calcule)
 * @param anchorY  y (repère de portée, vers le haut) de l'ancre : avec hampe, la note du côté OPPOSÉ à la pointe ; sans
 *                 hampe, la note du côté de la pointe (`anchor1`)
 * @param tipY     pointe de hampe COMPLÈTE (y vers le haut, celle de `stemTipY`), null si l'accord n'a pas de hampe
 * @param beams    nombre de ligatures/crochets de la durée ; @param hook  accord avec crochet (note seule)
 * @returns { items, top, bottom } éléments d'affichage + étendue verticale (repère de portée)
 */
export function singleTremoloItems({ tremolo, up, x, anchorY, tipY, beams, hook, style, glyphs, ref, straightFlags = false, tab = null }) {
  // `tab` (4c-3) : { lines, lineDist, simple } — repère MuseScore = ligne du haut = 0, en espaces ; en tablature la plage de portée
  // vaut (lignes − 1) × distance de lignes, mais le plafond d'une hampe montante reste `(lignes − 1) − hauteur` (non mis à l'échelle,
  // `layoutOneNoteTremolo`) ; pas de retrait par les ligatures en tablature Simple.
  const STAFF_H = tab ? (tab.lines - 1) * tab.lineDist : LINES - 1;
  const s = tremoloStyle(style);
  const upValue = up ? -1 : 1;
  const minHeight = tremoloMinHeight(tremolo, s);
  const toDown = (y) => STAFF_H - y; // repère de portée (haut) → repère MuseScore (bas, ligne du haut = 0)
  const anchorDown = toDown(anchorY);
  const h = tipY === null || tipY === undefined
    ? s.notePadding + tremoloBBoxHeight(tremolo, s, glyphs)
    : Math.abs(toDown(tipY) - anchorDown);

  let yOffset = h - s.outPadding;
  if (hook) {
    // côté crochet : place pour la courbe (crochets droits et courbes n'ont pas les mêmes besoins)
    yOffset -= straightFlags ? 0.75 : up ? 1.5 : 1.0;
    yOffset -= beams >= 2 ? (straightFlags ? 0.75 : 0.5) : 0;
  } else if (beams && !(tab && tab.simple)) {
    yOffset -= beams * 0.75 - 0.25; // (useWideBeams : 1,0 — pas géré)
  }
  yOffset -= tremolo.buzz && up ? 0.5 : 0;
  yOffset -= up ? 0 : minHeight;
  yOffset *= upValue;
  let y = anchorDown + yOffset;
  if (up) y = Math.min(y, (tab ? tab.lines - 1 : LINES - 1) - (tremolo.buzz ? 0 : minHeight));
  else y = Math.max(y, 0);
  const originUp = toDown(y); // centre-haut de la 1re barre, repère de portée

  if (tremolo.buzz) {
    const bb = glyphs.glyphs.buzzRoll.bbox;
    return {
      items: [{ kind: 'glyph', name: 'buzzRoll', x, y: originUp, ref, sel: `${ref}-trem`, role: 'tremolo' }],
      top: originUp + bb.bBoxNE[1],
      bottom: originUp + bb.bBoxSW[1],
    };
  }
  const items = [];
  const w2 = s.width / 2;
  const tilt = s.lineWidth / 2; // le côté droit est plus haut d'une épaisseur : ±lineWidth/2 autour du centre
  for (let i = 0; i < tremolo.strokes; i++) {
    const c = originUp - i * s.distance; // haut de la barre au centre
    items.push({
      kind: 'polygon', role: 'tremolo', ref, sel: `${ref}-trem`,
      points: [
        [x - w2, c - tilt], [x + w2, c + tilt], [x + w2, c + tilt - s.lineWidth], [x - w2, c - tilt - s.lineWidth],
      ],
    });
  }
  return { items, top: originUp + tilt, bottom: originUp - (tremolo.strokes - 1) * s.distance - s.lineWidth - tilt };
}
