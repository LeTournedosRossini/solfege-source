/*
 * Registre des PEINTRES DE PORTÉE — le mécanisme de rendu par type de portée (têtes de note personnalisées comprises).
 * Ajouter un type de portée (ou le rendu d'un type existant) = enregistrer un peintre ; le moteur (colonnes de temps,
 * coupure en systèmes, justification, disposition verticale) ne change pas.
 *
 * Un peintre est un objet dont le moteur n'utilise QUE ces méthodes :
 *
 *   lines(staff, ctx)          → [{ y, thickness }]  lignes de la portée (y local : 0 = ligne du bas, vers le haut)
 *   clef(staff, ctx, mi)       → { glyph, y, mag?, key? } | null   clé de tête de ligne du système qui s'ouvre à la mesure `mi`
 *                                (null = pas de clé : tablature après le 1er système, `hideTabClefAfterFirst`)
 *   keySig(staff, ctx)         → { clefKey } | null    la portée affiche l'armure (positions selon cette clé)
 *   timeSig(staff, ctx)        → { yNum, yDen } | null la portée affiche le chiffrage
 *   entries(staff, mi, ctx)    → [{ position, duration, item, voice }]   éléments de la mesure `mi`, avec leur instant
 *                                (fraction) : les instants identiques forment une colonne commune à toutes les portées
 *   itemWidth(entry, ctx)      → largeur (espaces) demandée par l'élément dans sa colonne, avant étirement
 *   paintEntry(entry, x, ctx)  → éléments d'affichage (coordonnées locales de la portée)
 *   paintMeasure(placed, ctx)  → (facultatif) dessine la mesure entière de la portée, `placed` = [{ entry, x }] : nécessaire
 *                                quand un élément dépend de ses voisins (ligatures, n-olets) ; ctx.measure.index = mesure
 *   paintSystemExtra(systemPlaced, staff, movement, sys, ctx) → (facultatif) dessine ce qui a besoin de TOUT le système
 *                                pour cette portée (marquages en plage : soufflets — tranche 3). `systemPlaced` =
 *                                [{ entry, x, mi }] pour TOUTES les mesures du système (accumulé par le moteur), dans
 *                                l'ordre. Appelé une fois par portée, après `paintMeasure`/`paintEntry` de toutes ses
 *                                mesures de ce système.
 *   paintSpanners(perSystem, staff, movement, ctx) → (facultatif) marquages qui peuvent traverser un RETOUR À LA LIGNE et ont
 *                                besoin de la position d'éléments de plusieurs systèmes (glissandos : la hauteur des jonctions
 *                                s'interpole sur tous les segments). `perSystem` = [{ sys, placed, headerRight }] pour TOUS les
 *                                systèmes (`placed` = comme `systemPlaced` de paintSystemExtra, pour cette portée ; `headerRight` = bord
 *                                droit visible de l'en-tête de cette portée). Renvoie un tableau
 *                                d'éléments d'affichage PAR système (même indice), ajoutés à la portée. Appelé une fois par portée,
 *                                après le dessin de tous les systèmes.
 *
 * `ctx` : { glyphs, style, minDuration, staff, warnings, keySigs, timeSigs, beamGroupings, offsets (par mesure), measure: { index, x0, width }? (pendant le dessin) }.
Facultatif aussi : lead(entry, ctx) → place à gauche de la tête (altérations), comprise dans itemWidth.
 * Éléments d'affichage : { kind: 'glyph'|'line'|'rect'|'circle'|'path', role?, ref? (identifiant du modèle), … }.
 */

const painters = new Map();

export function registerStaffPainter(type, painter) {
  painters.set(type, painter);
}

export function staffPainterFor(type) {
  return painters.get(type) ?? null;
}

export function registeredStaffTypes() {
  return [...painters.keys()];
}
