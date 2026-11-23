/*
 * Annuler / refaire — décisions PURES (aucun DOM, testé sous Node). Le moteur est `doc.undo/redo` (via `Application.undo/redo`) ; le DOM
 * (`undoredo-dom.js`) ne fait que relier boutons et clavier à ces fonctions.
 *
 * Raccourcis (ordinateur) : Ctrl/⌘ + Z = annuler ; Ctrl/⌘ + Maj + Z = refaire ; Ctrl + Y = refaire. Jamais dans un champ de texte : le
 * navigateur y garde son propre annuler / refaire. `event.key` (et non `code`) : la touche « Z » d'un clavier AZERTY n'est pas à la place du Z
 * d'un clavier QWERTY.
 */

// types d'`<input>` qui ne sont PAS un champ de texte (le navigateur n'y a pas d'annuler de saisie)
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'image', 'color', 'file']);

/** Vrai si la cible d'un événement clavier est un champ où l'on tape du texte (`<textarea>`, `<input>` texte ou nombre, zone éditable). */
export function isTextEditingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has(String(target.type ?? 'text').toLowerCase());
  return false;
}

/** 'undo' | 'redo' | null selon un événement clavier `{ key, ctrlKey, metaKey, shiftKey, altKey, isComposing, defaultPrevented, target }`. */
export function undoRedoShortcut(event) {
  if (!event || event.defaultPrevented || event.isComposing || event.altKey) return null;
  if (isTextEditingTarget(event.target)) return null;
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = String(event.key ?? '').toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}
