/*
 * Geste sur une CLÉ — décision PURE (aucun DOM, testée sous Node) ; `ui/dom.js` ne fait que la brancher.
 *
 * Décision de Jean (14/10/2026) : une clé n'est « cliquable » (interrupteur, éditeur) QUE pendant la saisie de notes. Hors saisie elle reste un
 * élément de décor ordinaire : un tap la SÉLECTIONNE, donc on peut la modifier ou la masquer (`model/decor.js`) comme une armure ou un chiffrage.
 *  - main gauche de l'accordéon, en saisie : la clé arme / désarme la saisie ;
 *  - portée de percussion, en saisie : la clé ouvre l'éditeur de carte de percussion (percmap).
 */

/** Première zone { x1, x2, y1, y2 } qui contient le point (x, y), ou null. */
export const zoneAt = (zones, x, y) => (zones ?? []).find((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) ?? null;

/**
 * Clé touchée en (x, y) selon le mode : { kind: 'accordion' | 'percussion', zone } ou null (= geste ordinaire : saisie d'une note, ou sélection).
 * `zonesOf(type)` = boîtes des clés des portées de ce type (`view.clefZones`) ; `percmap` = l'éditeur de carte est disponible.
 * Hors saisie (`entry` faux) : toujours null — la clé reste sélectionnable.
 */
export function clefTapAt({ entry, x, y, zonesOf, percmap = false }) {
  if (!entry) return null;
  const acc = zoneAt(zonesOf('accordion-left'), x, y);
  if (acc) return { kind: 'accordion', zone: acc };
  if (percmap) {
    const perc = zoneAt(zonesOf('percussion'), x, y);
    if (perc) return { kind: 'percussion', zone: perc };
  }
  return null;
}
