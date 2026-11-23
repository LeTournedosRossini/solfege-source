/*
 * Soufflets (crescendo/decrescendo, tranche 3 — premier marquage EN PLAGE du projet, début+fin, voir
 * claude/etape-3-suivi-et-decisions.md). `PID.HAIRPINS` (portée) : [{ id, startChordId, endChordId, hairpinType }] —
 * ancré par IDENTITÉ des deux accords de bornes (jamais measureId+fraction comme les changements de clé : cohérent
 * avec la règle du projet « jamais se fier à la position, toujours vérifier l'identité », et plus robuste — un
 * accord inséré/supprimé avant ne déplace rien ici). `hairpinType` : 'cresc'|'decresc' (les seuls VRAIS soufflets de
 * MuseScore, `HairpinType::CRESC_HAIRPIN`/`DIM_HAIRPIN` — les variantes texte `CRESC_LINE`/`DIM_LINE` sont hors
 * scope : le roadmap les classe comme des marques PONCTUELLES dans la modale nuances, pas des plages).
 *
 * Géométrie de l'ouverture (hauteur, continuation après coupure, épaisseur) : port DIRECT des valeurs MuseScore
 * (`styledef.cpp`, dépôt cloné, jamais deviné) — ce sont des cotes de FORME, pas une position verticale calibrée par
 * Jean dans le prototype, donc aucune raison de dévier comme on l'a fait pour la position de repos des nuances :
 * `hairpinHeight` = 1,15 esp. (ouverture complète), `hairpinContHeight` = 0,5 esp. (hauteur au bord d'une coupure de
 * système), `hairpinLineWidth` = 0,12 esp.
 *
 * Position verticale de repos : la MÊME que les nuances (-2,8 esp. en dessous / portée+1 esp. au-dessus),
 * délibérément — le prototype de Jean (`HAIRPIN_P = -2.8`) aligne déjà soufflet et nuance sur la même hauteur
 * (convention de gravure : un soufflet qui touche un « f » voisin s'aligne avec lui). Bascule au-dessus si la
 * portée porte des paroles quelque part : LE MÊME réglage MuseScore que les nuances
 * (`Sid::dynamicsHairpinsAboveForVocalStaves`, partagé entre les deux — vérifié dans `engravingitem.cpp`,
 * `EngravingItem::setPlacementBasedOnVoiceAssignment`). Décision en attente sur la détection « portée vocale » —
 * voir CLAUDE.md / conversation : utilise `staffHasLyrics` comme proxy, comme pour les nuances, tant qu'un
 * catalogue d'instruments (famille vocale) n'existe pas dans le modèle.
 *
 * Dégagement vertical : contrairement à une nuance (une seule colonne), un soufflet traverse plusieurs colonnes —
 * la cascade « par accord » ne suffit pas. La position de repos est ici étendue par le bord le plus extrême des
 * TÊTES DE NOTE (pas les hampes, pas les silences — limite assumée, documentée) parmi tous les accords de la portée
 * compris entre les deux bornes, DANS CE SYSTÈME SEULEMENT (pas de continuité entre systèmes) — généralisation
 * bornée de la cascade des nuances, pas la skyline continue de MuseScore (déjà écartée pour les nuances, même
 * raison : chantier disproportionné pour le bénéfice). Ce module ne calcule PAS lui-même ces extrêmes (il n'a pas
 * accès à `chordYs`, privé au peintre `score`) : l'appelant (`painters/score.js`) les calcule et les passe à `hairpinY`.
 *
 * Coupure en cas de retour à la ligne : chaque système traversé reçoit son propre segment, comme le
 * `SpannerSegmentType` de MuseScore (SINGLE/BEGIN/MIDDLE/END). Port du VRAI mécanisme de hauteur (pas une coupure
 * simple façon voltas) : un segment qui ne contient pas la vraie extrémité s'ouvre/se referme à la hauteur RÉDUITE
 * `hairpinContHeight` à son bord coupé plutôt qu'à zéro — un soufflet coupé ne redémarre jamais à une pointe fermée
 * (`TLayout::layoutHairpinSegment`, `tlayout.cpp`). Repère : x croissant vers la droite, y CROISSANT VERS LE HAUT
 * (portée) — MuseScore utilise y vers le bas, d'où les signes du port inversés par rapport à la source.
 *
 * Limites assumées et documentées : dégagement vertical sur les têtes de note seulement (pas les hampes/silences) ;
 * pas de « pointe cerclée » (niente, `hairpinCircledTip`) ; pas de texte cresc./dim. (hors scope, voir plus haut) ;
 * pas de connecteur diagonal visuel entre les deux segments d'une coupure (`joinedHairpin` de MuseScore — signal de
 * survol/édition interactive chez eux, sans équivalent utile pour un rendu SVG statique) ; pas d'évitement
 * horizontal avec une nuance/un texte adjacent (`autoplaceHairpinDynamicsDistance`, snapping — le prototype
 * lui-même ne le fait pas encore) ; portée toujours à 5 lignes fixes ; peintres `tab`/`percussion` non câblés.
 */
import { PID, getProperty } from '../model/index.js';

export const HAIRPIN_HEIGHT = 1.15; // Sid::hairpinHeight (ouverture complète, port direct — cote de forme)
export const HAIRPIN_CONT_HEIGHT = 0.5; // Sid::hairpinContHeight (hauteur au bord coupé, après un retour à la ligne)
export const HAIRPIN_LINE_WIDTH = 0.12; // Sid::hairpinLineWidth

const REST_BELOW = -2.8; // même valeur que dynamics.js (DYN_BASE_BELOW, calibrée par Jean) — aligné avec les nuances
const REST_ABOVE_GAP = 1; // portée + 1 esp. (Sid::dynamicsPosAbove, même règle que les nuances)
const STAFF_TOP = 4; // ligne du haut (portée à 5 lignes fixes, cohérent avec articulations.js/dynamics.js)
const MARGIN = 0.4; // marge tête↔soufflet, cohérente avec dynamics.js

/**
 * Table id d'accord/silence → index de mesure (mi) pour TOUTE la portée (toutes voix, toutes mesures). Sert à
 * résoudre les bornes d'un soufflet sans dépendre de sa position dans une collection (règle du projet). Coût O(n)
 * sur le nombre total d'éléments de la portée — à appeler une fois par portée et memoïser (voir `painters/score.js`).
 */
export function itemMeasureIndexMap(staff) {
  const map = new Map();
  for (const voice of staff.voices) {
    voice.measures.forEach((measure, mi) => {
      for (const item of measure.items) {
        map.set(item.id, mi);
        for (const g of item.graceNotes ?? []) map.set(g.id, mi); // ornements : ancrage possible d'un slur
      }
    });
  }
  return map;
}

/**
 * Résout `PID.HAIRPINS` d'une portée : ajoute `startMi`/`endMi` (index de mesure) via `itemMeasureIndexMap`. Une
 * entrée dont une des deux bornes n'est plus trouvée (accord supprimé depuis) ou dont l'ordre est incohérent est
 * silencieusement ignorée (donnée invalide plutôt qu'une erreur de rendu).
 */
export function resolveStaffHairpins(staff) {
  const idx = itemMeasureIndexMap(staff);
  const raw = getProperty(staff, PID.HAIRPINS) || [];
  return raw
    .map((h) => ({ ...h, startMi: idx.get(h.startChordId), endMi: idx.get(h.endChordId) }))
    .filter((h) => h.startMi !== undefined && h.endMi !== undefined && h.startMi <= h.endMi);
}

/** Type de segment de CE système (comme `SpannerSegmentType` de MuseScore), selon que le début/la fin tombe ici. */
export function spannerSegmentType(hasStart, hasEnd) {
  if (hasStart && hasEnd) return 'SINGLE';
  if (hasStart) return 'BEGIN';
  if (hasEnd) return 'END';
  return 'MIDDLE';
}

/**
 * Position verticale finale du segment pour CE système : position de repos (même convention que les nuances),
 * étendue par le bord le plus extrême des têtes de note rencontrées entre les deux bornes dans ce système
 * (`extremeTop`/`extremeBottom`, espaces — `null` si aucun accord dans la plage visible ici, ex. un segment MIDDLE
 * qui ne fait que traverser un système sans note dans cette portée : cas improbable mais possible en grand staff).
 */
export function hairpinY({ above, extremeTop = null, extremeBottom = null, staffTop = STAFF_TOP }) {
  let y = above ? staffTop + REST_ABOVE_GAP : REST_BELOW;
  if (above && extremeTop !== null) y = Math.max(y, extremeTop + MARGIN);
  if (!above && extremeBottom !== null) y = Math.min(y, extremeBottom - MARGIN);
  return y;
}

/**
 * Points des deux traits du soufflet (port de `TLayout::layoutHairpinSegment`, cas sans texte ni pointe cerclée —
 * hors scope). `y` = ligne centrale déjà placée par `hairpinY`. Règle vérifiée dans la source : pour un crescendo,
 * le bord DROIT est TOUJOURS pleinement ouvert (h1) — seul le bord GAUCHE varie (fermé à 0 si ce segment contient
 * la vraie extrémité de départ, sinon à la hauteur de continuation h2, si le soufflet a été coupé par un retour à
 * la ligne avant lui). Decrescendo : l'inverse exact (bord GAUCHE toujours ouvert à h1, bord DROIT qui varie).
 * Retourne deux segments `{ x1, y1, x2, y2 }` (branche du haut, branche du bas).
 */
export function hairpinWedgeLines({ hairpinType, segType, x1, x2, y }) {
  const h1 = HAIRPIN_HEIGHT / 2;
  const h2 = HAIRPIN_CONT_HEIGHT / 2;
  const hasStart = segType === 'SINGLE' || segType === 'BEGIN';
  const hasEnd = segType === 'SINGLE' || segType === 'END';
  const hLeft = hairpinType === 'cresc' ? (hasStart ? 0 : h2) : h1;
  const hRight = hairpinType === 'cresc' ? h1 : (hasEnd ? 0 : h2);
  return [
    { x1, y1: y + hLeft, x2, y2: y + hRight },
    { x1, y1: y - hLeft, x2, y2: y - hRight },
  ];
}
