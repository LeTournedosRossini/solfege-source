// Masquage du DÉCOR (barres de mesure, clés, armures, chiffrages) — PID.HIDDEN_DECOR, propriété de la PORTÉE.
//
// Décision de Jean (13/10/2026) : le décor n'est pas supprimable, il est MASQUABLE, portée par portée. Comme MuseScore 4.7.5 (lu :
// `cmdToggleVisible`, `undoChangeVisible`, `EngravingItem::collectForDrawing`, `Segment::allElementsInvisible`,
// `HorizontalSpacing::ignoreSegmentForSpacing`) :
//  - un élément masqué reste dans la partition, grisé tant qu'on choisit d'afficher les masqués, jamais montré à l'export ;
//  - la mise en page ne dépend PAS de ce choix d'affichage ;
//  - un segment dont tous les éléments sont masqués ne prend plus de place, SAUF les barres de mesure (comme les accords) ;
//  - les clés/armures d'en-tête des systèmes suivants et les armures de précaution sont GÉNÉRÉES (`addHeaderClef`, `setCourtesyKeySig`)
//    et ne portent aucun drapeau propre : ici l'en-tête d'un système se masque comme un élément à part, ancré à la mesure qui l'ouvre.
// Deux portées d'effet (demande de Jean, 13/10/2026) : « par système / par élément » = entrée { kind, measureId } ; « toute la portée, sur
// tous les systèmes » = entrée { kind, all: true } (sans measureId), qui masque chaque élément de ce genre de la portée.
// Entrée : { kind, measureId } — `kind` ∈ DECOR_KINDS, `measureId` = masterbar où l'élément est ancré (barre : fin de cette mesure ;
// clé, armure, chiffrage : début de cette mesure). Une entrée absente = élément visible.
export const DECOR_KINDS = Object.freeze(['barline', 'clef', 'keySig', 'timeSig']);

/** Identifiant de SÉLECTION d'un élément de décor (synthétique : un élément visible n'a pas d'entrée). */
export const decorId = (staffId, kind, measureId) => `decor|${staffId}|${kind}|${measureId}`;

/** Inverse de `decorId` : { staffId, kind, measureId } ou null. */
export function parseDecorId(id) {
  if (typeof id !== 'string' || !id.startsWith('decor|')) return null;
  const [, staffId, kind, measureId] = id.split('|');
  return staffId && measureId && DECOR_KINDS.includes(kind) ? { staffId, kind, measureId } : null;
}

/** Entrées de masquage d'une portée (lecture simple). */
export const hiddenDecorList = (staff) => (Array.isArray(staff?.props?.hiddenDecor) ? staff.props.hiddenDecor : []);

/** Vrai si l'élément de décor est masqué sur cette portée. */
export const isDecorHidden = (staff, kind, measureId) => hiddenDecorList(staff).some((e) => e.kind === kind && (e.all === true || e.measureId === measureId));

/** Vrai si le genre est masqué sur TOUTE la portée (entrée `all`). */
export const isDecorHiddenEverywhere = (staff, kind) => hiddenDecorList(staff).some((e) => e.kind === kind && e.all === true);

/** Erreurs de validation de PID.HIDDEN_DECOR (`barIds` : identifiants des masterbars). */
export function validateHiddenDecor(list, barIds) {
  const errors = [];
  if (!Array.isArray(list)) return ['hiddenDecor doit être une liste'];
  const seen = new Set();
  for (const e of list) {
    if (!e || !DECOR_KINDS.includes(e.kind)) { errors.push(`décor masqué : genre inconnu (${e?.kind})`); continue; }
    if (e.all === true) {
      if (e.measureId !== undefined) errors.push(`décor masqué ${e.kind} : « all » n'a pas de mesure`);
    } else if (!barIds.includes(e.measureId)) errors.push(`décor masqué ${e.kind} : mesure inconnue (${e.measureId})`);
    const key = `${e.kind}|${e.all === true ? '*' : e.measureId}`;
    if (seen.has(key)) errors.push(`décor masqué ${e.kind} : en double (${e.measureId})`);
    seen.add(key);
  }
  return errors;
}
