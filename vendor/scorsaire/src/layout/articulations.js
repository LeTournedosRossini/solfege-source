/*
 * Articulations (tranche 3, premier complément de marque validé avec Jean). Port de `ChordLayout::layoutArticulations`
 * / `layoutArticulations2` et `Articulation::layoutCloseToNote`/`computeCategories` (MuseScore, `chordlayout.cpp` et
 * `articulation.cpp` du dépôt cloné, JAMAIS deviné) — PAS un simple relevé du prototype : celui-ci s'en réclamait mais
 * l'admettait lui-même « approximation fidèle dans l'esprit, pas un portage exact » ; vérification à la source, Jean
 * avait raison de douter (27/09/2026) — tous les signes ne suivent PAS la même règle. Voir le doc du projet
 * `claude/etape-3-suivi-et-decisions.md` pour le détail des écarts trouvés et ce qui est délibérément simplifié ici.
 *
 * Deux familles, PAS trois comme la version précédente le supposait :
 *  - CLOSE_TO_NOTE (`Articulation::layoutCloseToNote` — SEULEMENT staccato et tenuto SEULS, jamais les glyphes
 *    « doubles » comme le portato ou le staccatissimo, contrairement à ce que le prototype supposait) : position
 *    « près de la tête », calée sur la GRILLE des lignes/interlignes de la portée (démonstré équivalent à : bord fixe
 *    de 0,5×hauteur-de-tête + 0,4 esp. si la tête est sur la ligne extrême ou l'interligne voisin, sinon centré sur
 *    une cible à 1,5 esp. — tête sur une ligne — ou 1,0 esp. — tête dans un interligne). Empilées entre elles si
 *    staccato ET tenuto sont posés ensemble (rare mais permis par MuseScore).
 *  - Le reste (accent, marcato, portato, staccatissimo, sforzati composés, stress/unstress, laissezVibrer…) : ancré à
 *    la portée (`layoutArticulations2`), empilé en 2 passes au-dessus/en dessous en partant du bord de la portée (+
 *    0,4 esp.) ou du bord de l'accord (tête/hampe + 0,4 esp.) si celui-ci dépasse déjà — chaque signe suivant du même
 *    côté est repoussé au-delà du précédent (+ hauteur + 0,4 esp. de marge mini). Kerning staccato+accent (0,2 esp.).
 *
 * Sens par défaut (côté) — PAS le même pour tous (`ChordLayout::layoutArticulations`, assignation de `Articulation::up`) :
 *  - marcato, marcatoStaccato, marcatoTenuto (catégorie MARCATO) : TOUJOURS au-dessus (Gould p.117, « accents forts
 *    au-dessus de la portée »), quel que soit le sens de la hampe — pas juste « opposé à la hampe ».
 *  - mordant/gruppetto (ornements) : par PARITÉ DE VOIX (voix paire = au-dessus, impaire = en dessous), pas par
 *    hauteur de note ni « toujours au-dessus » comme le supposait la version précédente.
 *  - point d'orgue : dans MuseScore actuel ce n'est même pas un `Articulation`, c'est un élément séparé (`Fermata`),
 *    toujours ABOVE à la création (`Fermata::Fermata`) — juste au reset ça dépend de la parité de voix
 *    (`propertyDefault`). On garde « toujours au-dessus » : correct pour le cas courant (voix 1), limite documentée.
 *  - tout le reste (accent, staccato, tenuto, portato, staccatissimo, tenutoAccent, accentStaccato, stress, unstress,
 *    laissezVibrer) : opposé au sens de la hampe.
 *
 * Simplifications assumées (documentées, pas devinées en douce) :
 *  - Centrage en x toujours sur le milieu de la tête (`centerX`, cas courant à une seule note/voix) : le déport vers
 *    le côté de la hampe (`stemSideX`, utilisé par MuseScore seulement quand marque et hampe sont du MÊME côté —
 *    marcato + hampe montante, ou plusieurs voix) n'est pas porté.
 *  - `laissezVibrer` : MuseScore l'exclut explicitement de `layoutArticulations2` (`if (a->isLaissezVib()) continue`)
 *    — son vrai mécanisme de placement n'a pas été retrouvé. Traité ici comme les autres signes ancrés à la portée
 *    (repli documenté, pas une règle MuseScore).
 *  - Kerning staccato+accent : condition simplifiée (accent qui suit un staccato du même côté) — la condition réelle
 *    ajoute un test géométrique (le staccato doit déjà toucher le bord de la portée) qui n'est pas reproduit.
 *  - Nombre de lignes : le haut de la portée (`topLineY` = lignes − 1) est un paramètre fourni par le peintre ; le bas est toujours y = 0
 *    (repère de portée). Les formules « près de la tête » (grille en demi-interlignes) sont indépendantes du nombre de lignes (vérifié
 *    sur `chordlayout.cpp` : `lines = 2 × (lignes − 1)`, seuils `lines − 1` et `1` = bords haut/bas).
 */
import { glyphItem, glyphWidth } from './header.js';

export const ARTIC_BASE = {
  accent: 'articAccent', staccato: 'articStaccato', tenuto: 'articTenuto',
  marcato: 'articMarcato', portato: 'articTenutoStaccato', fermata: 'fermata',
  staccatissimo: 'articStaccatissimo',
  accentStaccato: 'articAccentStaccato', marcatoStaccato: 'articMarcatoStaccato',
  marcatoTenuto: 'articMarcatoTenuto', tenutoAccent: 'articTenutoAccent',
  stress: 'articStress', unstress: 'articUnstress', laissezVibrer: 'articLaissezVibrer',
  fermataShort: 'fermataShort', fermataLong: 'fermataLong',
  fermataVeryShort: 'fermataVeryShort', fermataVeryLong: 'fermataVeryLong', fermataShortHenze: 'fermataShortHenze', fermataLongHenze: 'fermataLongHenze',
  trill: 'ornamentTrill',
  mordent: 'ornamentMordent', mordentInverted: 'ornamentMordentInverted',
  turn: 'ornamentTurn', turnInverted: 'ornamentTurnInverted',
};

// `Articulation::layoutCloseToNote()` : (isStaccato() || isTenuto()) && !isDouble() — les glyphes DOUBLES (portato =
// tenutoStaccato, staccatissimo, accentStaccato…) n'en font PAS partie, contrairement à ce que supposait le prototype.
const CLOSE_TO_NOTE = new Set(['staccato', 'tenuto']);
// Catégorie MARCATO (`Articulation::computeCategories`) : toujours au-dessus (Gould p.117).
const MARCATO_FAMILY = new Set(['marcato', 'marcatoStaccato', 'marcatoTenuto']);
const ALWAYS_ABOVE = new Set(['fermata', 'fermataShort', 'fermataLong', 'fermataVeryShort', 'fermataVeryLong', 'fermataShortHenze', 'fermataLongHenze']);
const ORNAMENTS = new Set(['trill', 'mordent', 'mordentInverted', 'turn', 'turnInverted']);
// Sens du médiator (⊓ vers le bas = `stringsDownBow`, ⋁ vers le haut = `stringsUpBow`, même signe que l'archet) : glyphe fixe, ancré au-dessus de la portée comme le golpe.
// Tranche 4d-d : golpe (un seul glyphe, sans variante Above/Below — `guitarGolpe`), golpe « pouce » (même glyphe, ancre BOTTOM), slap et pop
// (`ArticulationTextType::SLAP/POP` : texte « S » / « P » du style ARTICULATION, Edwin 8 pt). Ancre TOP / BOTTOM, jamais AUTO.
// Tapping (entrées synthétisées par le peintre : `tapRhT` « T », `tapRhPlus`, `tapLhDot` point à l'échelle 0,5, `tapLhNone` = demi-liaisons seules : aucun dessin
// mais l'élément occupe sa place dans la pile, hauteur 0 → `staffTopY = y − 0 − minDist`).
const FIXED_GLYPH = { golpe: 'guitarGolpe', golpeThumb: 'guitarGolpe', pickDown: 'stringsDownBow', pickUp: 'stringsUpBow', tapRhPlus: 'pluckedLeftHandPizzicato', tapLhDot: 'windClosedHole' };
const GLYPH_MAG = { tapLhDot: 0.5 };
const TEXT_ARTIC = { slap: 'S', pop: 'P', tapRhT: 'T' };
const ANCHOR_UP = { golpe: true, golpeThumb: false, pickDown: true, pickUp: true, slap: true, pop: true, tapRhT: true, tapRhPlus: true, tapLhDot: true, tapLhNone: true };
const TEXT_SIZE = 8 / ((1.75 * 72) / 25.4); // articulationFontSize 8 pt en espaces
const TEXT_HEIGHT = 1.2 * TEXT_SIZE; // boîte de ligne (approchée : police Edwin absente)
const TEXT_WIDTH = 0.55 * TEXT_SIZE; // « S » / « P » : largeur approchée (idem)

const LINE_COUNT = 5; // comme scorePainter.lines : pas de lecture de PID.LINE_COUNT ici (limite documentée ci-dessus)
const STAFF_TOP_5 = LINE_COUNT - 1; // 4 : y de la ligne du haut (repère à ressort, y vers le haut)
const STAFF_BOTTOM_5 = 0;
const MARGIN = 0.4; // Sid::propertyDistance / propertyDistanceStem / propertyDistanceHead (tous 0,4 par défaut)
const MIN_DIST = 0.4; // Sid::articulationMinDistance
const ORNAMENT_ACC_MAG = 0.6; // `ornamentAccidentalMag` (TLayout::layoutOrnament)
const ORNAMENT_ACC_MARGIN = 0.35; // `vertMargin` = 0,35 sp
const STAC_ACCENT_KERN = 0.2; // Sid non exposé : constante `stacAccentKern` dans ChordLayout::layoutArticulations2

const glyphHeightOf = (glyphs, name) => {
  const b = glyphs.glyphs[name].bbox;
  return b.bBoxNE[1] - b.bBoxSW[1];
};

/**
 * Position d'un signe CLOSE_TO_NOTE (staccato ou tenuto seul), calée sur la grille de la portée (équivalent démontré
 * de `layoutArticulations`, branche « headSide », cas courant à une seule voix). `notePos` : tête extrême du côté
 * concerné (la plus haute si au-dessus, la plus basse si en dessous).
 */
function closeToNoteY(above, notePos, glyphHeight, headHeight, top = STAFF_TOP_5) {
  // `line = max(downLine, -1)` / `min(upLine, lines + 1)` (ChordLayout::layoutArticulations) : tête très éloignée de la portée ramenée à une demi-ligne au-delà
  if (above) notePos = Math.max(notePos, -0.5); else notePos = Math.min(notePos, top + 0.5);
  const isEdge = above ? notePos >= top - 0.5 : notePos <= 0.5;
  if (isEdge) {
    const off = headHeight / 2 + MARGIN;
    return above ? notePos + off : notePos - off;
  }
  const onLine = notePos % 1 === 0;
  const center = above ? notePos + (onLine ? 1.5 : 1.0) : notePos - (onLine ? 1.5 : 1.0);
  return above ? center - glyphHeight / 2 : center + glyphHeight / 2;
}

/**
 * @param list        PID.ARTICULATIONS d'un accord : [{ id, type, pos? }]
 * @param opts.ys     positions (espaces) des têtes de l'accord
 * @param opts.stemUp sens de la hampe de l'accord
 * @param opts.stemTip position (espaces) de la pointe de la hampe, ou null si l'accord n'en a pas (ronde, silence…)
 * @param opts.headWidth largeur (bBoxNE[0]) de la tête, pour centrer le symbole sur son milieu (pas son bord gauche)
 * @param opts.x      x (espaces) de la tête
 * @param opts.voice  index de voix (0 = voix 1…), pour le sens des ornements (parité)
 * @param opts.glyphs données Bravura
 * @param opts.itemId identifiant du modèle (ref)
 * @param opts.ornamentAccidentals (entrée) → { above, below } : noms de glyphes d'altération d'un signe d'ornement (`TLayout::layoutOrnament`)
 * @returns éléments d'affichage `glyph`, un par entrée reconnue
 */
export function articulationItems(list, { ys, stemUp, stemTip, headWidth, x, voice = 0, glyphs, itemId, tab = null, topLineY = STAFF_TOP_5, ornamentAccidentals = null, headGlyphName = null }) {
  // `tab` (4c-2) : { top, bottom, headHeight, hasVoices, fermataMargin } — portée de tablature : jamais « près de la tête »
  // (`Articulation::layoutCloseToNote` est faux en tablature), bords de portée = lignes extrêmes ± demi-épaisseur, hauteur de
  // tête = boîte du numéro de frette ; plusieurs voix : côté de la hampe (`ChordLayout::layoutArticulations`, `hasVoices`).
  const headHeight = tab ? tab.headHeight : glyphHeightOf(glyphs, headGlyphName ?? 'noteheadBlack');
  const STAFF_TOP = tab ? tab.top : topLineY; // portée de notation à N lignes : y de la ligne du haut = N − 1
  const STAFF_BOTTOM = tab ? tab.bottom : STAFF_BOTTOM_5;
  const top = Math.max(...ys);
  const bottom = Math.min(...ys);

  // 1) résolution : glyphe + côté (sens), pour chaque entrée reconnue — AVANT de savoir si elle est « près de la
  // tête » ou « ancrée à la portée » (comme MuseScore : l'assignation du sens est commune aux deux familles).
  const resolved = [];
  for (const entry of list) {
    if (entry.type in ANCHOR_UP) {
      const text = TEXT_ARTIC[entry.type];
      const glyphName = FIXED_GLYPH[entry.type];
      if (glyphName && !glyphs.glyphs[glyphName]) continue;
      const mag = GLYPH_MAG[entry.type] ?? 1;
      resolved.push({
        entry, above: ANCHOR_UP[entry.type], glyphName, text, closeToNote: false, mag,
        // ÉCART avec MuseScore (retour de Jean 04/10/2026) : le glyphe du golpe pouce a son origine EN BAS ; MuseScore le pose à `staffBotY` tel quel, il
        // remonte donc sur la portée / la hampe. On pose son bord HAUT à la limite réservée (la boîte s'étend vers le bas).
        hangs: entry.type === 'golpeThumb',
        glyphHeight: text ? TEXT_HEIGHT : glyphName ? glyphHeightOf(glyphs, glyphName) * mag : 0,
        width: text ? TEXT_WIDTH : glyphName ? glyphWidth(glyphs, glyphName) * mag : 0,
      });
      continue;
    }
    const base = ARTIC_BASE[entry.type];
    if (!base) continue;
    const isOrnament = ORNAMENTS.has(entry.type);
    let above;
    if (MARCATO_FAMILY.has(entry.type) || ALWAYS_ABOVE.has(entry.type)) above = true;
    else if (isOrnament) above = voice % 2 === 0;
    else above = tab && tab.hasVoices ? stemUp : !stemUp;
    const glyphName = isOrnament ? base : `${base}${above ? 'Above' : 'Below'}`;
    if (!glyphs.glyphs[glyphName]) continue;
    resolved.push({
      entry, above, glyphName, closeToNote: !tab && CLOSE_TO_NOTE.has(entry.type), glyphHeight: glyphHeightOf(glyphs, glyphName),
    });
  }

  const items = [];
  const articX = (glyphName) => x + headWidth / 2 - glyphWidth(glyphs, glyphName) / 2;
  const push = (r, articY) => {
    if (r.text) { // texte : x = centre − largeur/2 (aligné à gauche), ordonnée = ligne de base (`setPos(x, y)` du texte enfant)
      items.push({ kind: 'text', text: r.text, x: x + headWidth / 2 - r.width / 2, y: articY, size: TEXT_SIZE, ref: itemId, sel: r.entry.id, role: 'articulation' });
    } else if (r.mag !== undefined && r.mag !== 1) {
      items.push(glyphItem(r.glyphName, x + headWidth / 2 - r.width / 2, articY, { ref: itemId, sel: r.entry.id, role: 'articulation', mag: r.mag }));
    } else if (r.glyphName) items.push(glyphItem(r.glyphName, articX(r.glyphName), articY, { ref: itemId, sel: r.entry.id, role: 'articulation' }));
    if (ornamentAccidentals && ORNAMENTS.has(r.entry.type)) pushOrnamentAccidentals(r, articY);
  };
  // `TLayout::layoutOrnament` : altération à l'échelle 0,6, centrée sur la boîte du signe, à 0,35 sp de son bord haut (dessus) ou bas (dessous).
  // La pile des signes ne s'en occupe pas (`layoutArticulations2` ne compte que la boîte du signe) ; la forme composite pousse les marques posées ensuite.
  let accTop = -Infinity;
  let accBottom = Infinity;
  const pushOrnamentAccidentals = (r, articY) => {
    const acc = ornamentAccidentals(r.entry);
    const o = glyphs.glyphs[r.glyphName].bbox;
    const ownTop = articY + o.bBoxNE[1];
    const ownBottom = articY + o.bBoxSW[1];
    for (const side of ['above', 'below']) {
      const g = acc?.[side] && glyphs.glyphs[acc[side]];
      if (!g) continue;
      const w = (g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0]) * ORNAMENT_ACC_MAG;
      const gx = articX(r.glyphName) + o.bBoxSW[0] + ((o.bBoxNE[0] - o.bBoxSW[0]) - w) / 2 - g.bbox.bBoxSW[0] * ORNAMENT_ACC_MAG;
      const y = side === 'above' ? ownTop + ORNAMENT_ACC_MARGIN - g.bbox.bBoxSW[1] * ORNAMENT_ACC_MAG : ownBottom - ORNAMENT_ACC_MARGIN - g.bbox.bBoxNE[1] * ORNAMENT_ACC_MAG;
      items.push(glyphItem(acc[side], gx, y, { ref: itemId, sel: r.entry.id, role: 'ornament-accidental', mag: ORNAMENT_ACC_MAG }));
      if (side === 'above') accTop = Math.max(accTop, y + g.bbox.bBoxNE[1] * ORNAMENT_ACC_MAG);
      else accBottom = Math.min(accBottom, y + g.bbox.bBoxSW[1] * ORNAMENT_ACC_MAG);
    }
  };

  // 2) « près de la tête » (staccato/tenuto seuls) : empilés entre eux si les deux sont présents du même côté.
  let closeAbove = null; // { y, height } du dernier signe placé au-dessus, pour l'empilement
  let closeBelow = null;
  let lastStaccatoEdge = null; // bord extérieur du DERNIER staccato posé (même famille ou non), pour le kerning accent
  for (const r of resolved) {
    if (!r.closeToNote) continue;
    let articY;
    if (typeof r.entry.pos === 'number') {
      articY = r.entry.pos;
    } else {
      const notePos = r.above ? top : bottom;
      articY = closeToNoteY(r.above, notePos, r.glyphHeight, headHeight, STAFF_TOP);
      const prev = r.above ? closeAbove : closeBelow;
      if (prev) {
        // MuseScore : repousse d'un espace entier si la tête reste loin du bord de la portée, sinon de la hauteur du
        // signe précédent + la marge mini (`ChordLayout::layoutArticulations`, ajustement `prevVisibleArticulation`).
        const clearOfEdge = r.above ? top < STAFF_TOP - 1 : bottom > 1; // `upLine > 2` / `downLine < (lines − 2) × 2`
        const shifted = clearOfEdge ? (r.above ? prev.y + 1 : prev.y - 1) : (r.above ? prev.y + prev.height + MIN_DIST : prev.y - prev.height - MIN_DIST);
        articY = r.above ? Math.max(articY, shifted) : Math.min(articY, shifted);
      }
    }
    push(r, articY);
    if (r.above) closeAbove = { y: articY, height: r.glyphHeight }; else closeBelow = { y: articY, height: r.glyphHeight };
    if (r.entry.type === 'staccato') lastStaccatoEdge = { above: r.above, y: articY, edge: r.above ? articY + r.glyphHeight : articY - r.glyphHeight };
  }

  // 3) ancrés à la portée : bornes de départ = bord de l'accord (tête ou hampe, selon ce qui dépasse) + marge, jamais
  // plus proche que le bord de la portée + marge ; étendues par les signes « près de la tête » déjà posés.
  let chordTop = top + headHeight / 2 + MARGIN;
  let chordBot = bottom - headHeight / 2 - MARGIN;
  if (stemTip !== null) {
    if (stemUp) chordTop = stemTip + MARGIN; else chordBot = stemTip - MARGIN;
  }
  if (closeAbove) chordTop = Math.max(chordTop, closeAbove.y + closeAbove.height + MIN_DIST);
  if (closeBelow) chordBot = Math.min(chordBot, closeBelow.y - closeBelow.height - MIN_DIST);
  let staffTop = Math.max(STAFF_TOP + MARGIN, chordTop);
  let staffBot = Math.min(STAFF_BOTTOM - MARGIN, chordBot);

  for (const r of resolved) {
    if (r.closeToNote) continue;
    let articY;
    let kern = 0;
    // `layoutArticulations2` : le kerning ne joue que si le staccato précédent est HORS de la portée (`pos.y <= 0` ou `>= staffHeight`) ;
    // `setPos(x, staffTopY + kearnHeight)` en y vers le bas : l'accent est RAPPROCHÉ du staccato (0,2 sp), pas éloigné (vérifié sur export de Jean 03/10/2026).
    if (r.entry.type === 'accent' && lastStaccatoEdge && lastStaccatoEdge.above === r.above
      && (r.above ? lastStaccatoEdge.y >= STAFF_TOP : lastStaccatoEdge.y <= STAFF_BOTTOM)) kern = STAC_ACCENT_KERN;
    if (typeof r.entry.pos === 'number') {
      articY = r.entry.pos;
    } else if (r.above) {
      if (tab && ALWAYS_ABOVE.has(r.entry.type)) staffTop = Math.max(staffTop, STAFF_TOP + (tab.fermataMargin ?? MARGIN));
      articY = staffTop - kern;
      staffTop = articY + r.glyphHeight + MIN_DIST;
    } else {
      articY = staffBot + kern - (r.hangs ? r.glyphHeight : 0);
      staffBot = articY - (r.hangs ? 0 : r.glyphHeight) - MIN_DIST;
    }
    push(r, articY);
    lastStaccatoEdge = (r.entry.type === 'staccato' || r.entry.type === 'staccatissimo')
      ? { above: r.above, y: articY, edge: r.above ? articY + r.glyphHeight : articY - r.glyphHeight }
      : null;
  }

  // Bornes finales (portée + accord + tout ce qui a été empilé), exposées pour que les nuances (tranche 3, suivant)
  // puissent démarrer leur propre empilement au-delà — cascade partagée, mais seulement entre marques du MÊME accord
  // (pas entre voix différentes attaquant la même colonne : limite assumée, cf. dynamics.js et le doc du projet).
  items.bounds = { top: Math.max(staffTop, accTop + MIN_DIST), bottom: Math.min(staffBot, accBottom - MIN_DIST) };
  return items;
}
