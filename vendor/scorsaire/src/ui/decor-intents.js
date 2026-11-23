/*
 * Masquer / afficher le décor (barres de mesure, clés, armures, chiffrages) — intentions SANS DOM. À appeler dans `doc.transaction`
 * (`Application.toggleDecorHidden`). Décision de Jean (13/10/2026) : le décor n'est pas supprimable, il est masquable, portée par portée
 * (voir model/decor.js). Même règle de bascule que jouer / couper : si au moins un élément visé est visible, tout est masqué, sinon tout
 * est ré-affiché.
 */
import { PID } from '../model/pid.js';
import { parseDecorId, isDecorHidden, isDecorHiddenEverywhere, hiddenDecorList } from '../model/decor.js';

/** Éléments de décor existants parmi `ids` : [{ id, staff, kind, measureId, hidden }]. */
export function decorTargets(doc, ids) {
  const out = [];
  for (const id of ids ?? []) {
    const d = parseDecorId(id);
    if (!d) continue;
    const staff = doc.find(d.staffId);
    if (!staff || staff.type !== 'staff') continue;
    if (!doc.movementOf(staff)?.masterbars.some((b) => b.id === d.measureId)) continue;
    out.push({ id, staff, kind: d.kind, measureId: d.measureId, hidden: isDecorHidden(staff, d.kind, d.measureId) });
  }
  return out;
}

/** Ce que ferait la bascule : true = masquer, false = ré-afficher, null = aucun décor parmi `ids`. */
export function nextDecorHidden(doc, ids) {
  const t = decorTargets(doc, ids);
  if (!t.length) return null;
  return t.some((x) => !x.hidden);
}

/** Masque (`hidden` vrai) ou ré-affiche un élément de décor. À appeler dans `doc.transaction`. */
export function setDecorHidden(doc, staff, kind, measureId, hidden) {
  const list = hiddenDecorList(staff);
  const has = isDecorHidden(staff, kind, measureId);
  if (hidden === has) return false;
  let next;
  if (hidden) next = [...list, { kind, measureId }];
  else if (isDecorHiddenEverywhere(staff, kind)) {
    // ré-afficher UN élément quand tout le genre est masqué : l'entrée « partout » est remplacée par toutes les autres mesures
    const ids = doc.movementOf(staff).masterbars.map((b) => b.id).filter((id) => id !== measureId);
    next = [...list.filter((e) => e.kind !== kind), ...ids.map((id) => ({ kind, measureId: id }))];
  } else next = list.filter((e) => !(e.kind === kind && e.measureId === measureId));
  if (next.length) doc.set(staff, PID.HIDDEN_DECOR, next); else doc.reset(staff, PID.HIDDEN_DECOR);
  return true;
}

/** Bascule le masquage de `ids` ; retourne le nombre d'éléments changés. À appeler dans `doc.transaction`. */
export function toggleDecorHidden(doc, ids) {
  const targets = decorTargets(doc, ids);
  if (!targets.length) return 0;
  const hide = targets.some((t) => !t.hidden);
  let n = 0;
  for (const t of targets) if (setDecorHidden(doc, t.staff, t.kind, t.measureId, hide)) n += 1;
  return n;
}

/** Genres de décor visés (par portée) : [{ staff, kind }] sans doublon. */
export function decorKindTargets(doc, ids) {
  const seen = new Map();
  for (const t of decorTargets(doc, ids)) seen.set(`${t.staff.id}|${t.kind}`, { staff: t.staff, kind: t.kind });
  return [...seen.values()];
}

/** Ce que ferait la bascule « toute la portée » : true = masquer partout, false = ré-afficher partout, null = aucun décor. */
export function nextDecorHiddenEverywhere(doc, ids) {
  const t = decorKindTargets(doc, ids);
  if (!t.length) return null;
  return t.some((x) => !isDecorHiddenEverywhere(x.staff, x.kind));
}

/** Masque ou ré-affiche le genre sur TOUTE la portée (retire aussi les entrées par système de ce genre). À appeler dans `doc.transaction`. */
export function setDecorHiddenEverywhere(doc, staff, kind, hidden) {
  const list = hiddenDecorList(staff);
  const rest = list.filter((e) => e.kind !== kind);
  const next = hidden ? [...rest, { kind, all: true }] : rest;
  if (next.length === list.length && next.every((e, i) => e === list[i])) return false;
  if (next.length) doc.set(staff, PID.HIDDEN_DECOR, next); else doc.reset(staff, PID.HIDDEN_DECOR);
  return true;
}

/** Bascule « toute la portée » pour les genres des éléments de `ids` ; retourne le nombre de (portée, genre) changés. */
export function toggleDecorHiddenEverywhere(doc, ids) {
  const targets = decorKindTargets(doc, ids);
  if (!targets.length) return 0;
  const hide = targets.some((x) => !isDecorHiddenEverywhere(x.staff, x.kind));
  let n = 0;
  for (const x of targets) if (setDecorHiddenEverywhere(doc, x.staff, x.kind, hide)) n += 1;
  return n;
}
