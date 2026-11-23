/*
 * Intentions « jouer / muet » (étape 5, tranche 4). AUCUN DOM : fonctions pures sur le Document, appelées par l'Application
 * à l'intérieur de `app.edit(...)`. Elles n'écrivent que par `setPlay` / `setPlayAll` (donc par `doc.transaction`).
 */
import { PLAYABLE_TYPES, localPlay, setPlay, setPlayAll, playableUnder } from '../model/play.js';

/** Portées de « tout jouer / tout couper » (décision de Jean, 11/10/2026) : jamais l'œuvre ni le Mouvement entiers. */
export const PLAY_SCOPE_TYPES = Object.freeze(['track', 'staff', 'voice', 'measure']);

/** Réglage GLOBAL d'un type : tout est joué, sauf les symboles d'accord (muets par défaut, `options.chordSymbols.play`). */
let chordSymbolsSound = true;
/** Device setting (Settings › Audio): do chord symbols sound unless they say otherwise? Default yes. */
export const setChordSymbolsSound = (on) => { chordSymbolsSound = on !== false; };
export const globalPlay = (el) => el.type !== 'chordsymbol' || chordSymbolsSound;

/** Joué ou non, d'après la valeur locale puis le réglage global (ne regarde pas l'accord parent). */
export const isAudible = (el) => localPlay(el) ?? globalPlay(el);

/** Éléments jouables parmi des identifiants (les autres — articulations, décor… — sont ignorés). */
export function playTargets(doc, ids) {
  return ids.map((id) => doc.find(id)).filter((el) => el && PLAYABLE_TYPES.includes(el.type));
}

/** Valeur que donnerait la bascule : couper si au moins un élément est joué, sinon jouer. null si rien de jouable. */
export function nextPlayValue(doc, ids) {
  const targets = playTargets(doc, ids);
  if (!targets.length) return null;
  return targets.some(isAudible) ? false : true;
}

/** Bascule jouer/muet. Une valeur égale au réglage global est effacée (retour au global) plutôt que stockée. À appeler dans une transaction. */
export function togglePlay(doc, ids) {
  const value = nextPlayValue(doc, ids);
  if (value === null) return 0;
  let changed = 0;
  for (const el of playTargets(doc, ids)) {
    const next = value === globalPlay(el) ? null : value;
    if (localPlay(el) === next) continue;
    setPlay(doc, el, next);
    changed++;
  }
  return changed;
}

/**
 * Portée / piste / voix / mesure qui contient un élément (premier ancêtre du type demandé), ou null.
 * Une entrée de liste (liaison, soufflet, doigté…) n'est pas dans l'arbre : on part de son propriétaire (la portée, ou la note).
 */
export function ownerOf(doc, id, type) {
  const owner = doc.findListEntry?.(id)?.owner ?? null; // entrée de liste : on part de son propriétaire
  if (owner?.type === type) return owner;
  let p = doc.parentOf(owner ? owner.id : id);
  while (p) {
    const el = p.el ?? p;
    if (el.type === type) return el;
    p = doc.parentOf(el.id);
  }
  return null;
}

/** « Tout jouer / tout couper / revenir au global » sous une portée, une piste, une voix ou une mesure. */
export function setPlayScope(doc, root, value) {
  if (!PLAY_SCOPE_TYPES.includes(root.type)) throw new Error(`setPlayScope : « ${root.type} » n'est pas une portée d'application (${PLAY_SCOPE_TYPES.join(', ')})`);
  return setPlayAll(doc, root, value);
}

/**
 * Value the switch of a staff / track / voice / measure would give: false (mute everything) when something under it is still played, true (play everything)
 * when everything is muted. null when there is nothing playable under it.
 */
export function nextScopeValue(root) {
  const targets = playableUnder(root);
  if (!targets.length) return null;
  return targets.some(isAudible) ? false : true;
}
