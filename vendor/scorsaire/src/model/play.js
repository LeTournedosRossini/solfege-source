/*
 * Jouer ou ne pas jouer (10/10/2026, demande de Jean) : `PID.PLAY` sur les symboles d'accord, les accords de notes et les notes
 * (note, tabnote, percnote, accnote, rhythmnote). C'est une propriété de LECTURE : un élément non joué reste affiché, la séquence audio l'ignore.
 *
 * Valeur LOCALE seulement (le défaut de la table, vrai, ne sert pas ici) :
 *   - vrai  = joué explicitement ; faux = muet explicitement ; absente = « suit le réglage global ».
 *   - Réglage global : accords de notes et notes = joués ; symboles d'accord = muets par défaut (`options.chordSymbols.play` de
 *     `buildSequence`, option A de Jean). Une valeur locale EXPLICITE l'emporte toujours sur le global (un seul accord audible alors
 *     que les symboles sont muets, ou l'inverse).
 *   - Un accord muet rend muettes toutes ses notes ; une note muette ne retire que sa hauteur. Les notes d'ornement sont des accords :
 *     chacune a son propre réglage.
 *   - Notes liées : c'est la note qui ATTAQUE (tête de la chaîne) qui décide ; le réglage d'une note prolongée est ignoré.
 *
 * `setPlayAll` : opération « tout jouer / tout couper / revenir au global » sur une partie de l'œuvre (œuvre, Mouvement, piste,
 * portée, voix, mesure…), limitée à des types d'éléments.
 */
import { PID } from './pid.js';
import { hasLocalValue } from './props.js';
import { walk } from './store.js';

export const PLAYABLE_TYPES = Object.freeze(['chordsymbol', 'chord', 'note', 'tabnote', 'percnote', 'accnote', 'rhythmnote']);

/** Réglage local de lecture : true | false | null (absent). */
export function localPlay(el) {
  if (!el || !PLAYABLE_TYPES.includes(el.type)) return null;
  return hasLocalValue(el, PID.PLAY) ? el.props[PID.PLAY] !== false : null;
}

/** Joue (true) / coupe (false) / revient au global (null) UN élément. À appeler dans `doc.transaction`. */
export function setPlay(doc, el, value) {
  if (!PLAYABLE_TYPES.includes(el.type)) throw new Error(`setPlay : « ${el.type} » ne se joue pas à la pièce`);
  if (value === null) { if (hasLocalValue(el, PID.PLAY)) doc.reset(el, PID.PLAY); return; }
  if (typeof value !== 'boolean') throw new Error('setPlay : true, false ou null');
  doc.set(el, PID.PLAY, value);
}

/**
 * Applique `value` (true, false ou null = effacer les réglages locaux) à tous les éléments jouables sous `root`.
 * @param options  { types = PLAYABLE_TYPES } restreint les types touchés
 * @returns nombre d'éléments modifiés
 * À appeler dans `doc.transaction(nom, () => setPlayAll(doc, root, value))`.
 */
/** Playable elements under `root` (the root included when it is playable). */
export function playableUnder(root, { types = PLAYABLE_TYPES } = {}) {
  const out = [];
  walk(root, (el) => { if (types.includes(el.type)) out.push(el); });
  return out;
}

export function setPlayAll(doc, root, value, { types = PLAYABLE_TYPES } = {}) {
  for (const t of types) if (!PLAYABLE_TYPES.includes(t)) throw new Error(`setPlayAll : type « ${t} » inconnu`);
  const targets = [];
  walk(root, (el) => { if (types.includes(el.type)) targets.push(el); });
  let changed = 0;
  for (const el of targets) {
    const before = localPlay(el);
    if (before === value) continue;
    setPlay(doc, el, value);
    changed++;
  }
  return changed;
}

/** Identifiants des accords et des notes explicitement muets dans une liste de Mouvements. */
export function collectMuted(movements) {
  const chords = new Set();
  const notes = new Set();
  for (const mv of movements) {
    walk(mv, (el) => {
      if (localPlay(el) !== false) return;
      (el.type === 'chord' ? chords : notes).add(el.id);
    });
  }
  return { chords, notes };
}
