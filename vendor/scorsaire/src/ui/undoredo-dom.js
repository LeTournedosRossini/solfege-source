/*
 * Boutons ↶ ↷ et raccourcis clavier d'annuler / refaire (DOM). Les décisions (quel raccourci, dans quel champ) sont dans `undoredo.js` (pur) ;
 * le moteur est `Application.undo/redo` (la sélection des vues est restaurée par le Document, rien à faire ici).
 *
 * EMPLACEMENT RÉSERVÉ : les deux boutons sont TOUJOURS présents, de taille fixe ; seul leur état (grisé, `disabled`) change avec
 * `canUndo` / `canRedo`. Rien n'apparaît ni ne disparaît : la page, donc le SVG, ne bouge jamais.
 */
import { applyTextIcon } from './icons.js';
import { undoRedoShortcut } from './undoredo.js';

/**
 * @param host    élément qui reçoit les deux boutons (l'appelant le place où il veut)
 * @param o.app   Application ; o.label : (clé, params) → texte
 * @returns {{ destroy() }}
 */
export function mountUndoRedo(host, { app, label = (k) => k }) {
  const group = document.createElement('span');
  group.setAttribute('data-undo-redo', '');
  group.style.cssText = 'display:inline-flex;gap:var(--btn-gap,2px);align-items:center';
  const btn = (text, title, fn, action) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; applyTextIcon(b, text); b.title = title; b.setAttribute('aria-label', title); b.setAttribute('data-action', action);
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center;font:20px var(--ui-font,sans-serif);padding:2px 8px;cursor:pointer';
    b.addEventListener('click', fn);
    return b;
  };
  const undo = btn('↶', label('history.undo'), () => app.undo(), 'undo');
  const redo = btn('↷', label('history.redo'), () => app.redo(), 'redo');
  group.append(undo, redo);
  host.append(group);

  const update = ({ canUndo, canRedo }) => {
    for (const [b, on] of [[undo, canUndo], [redo, canRedo]]) { b.disabled = !on; b.style.opacity = on ? '' : '0.45'; b.style.cursor = on ? 'pointer' : 'default'; }
  };
  const off = app.onHistoryChange(update);
  update(app.historyState());

  const onKey = (e) => {
    const action = undoRedoShortcut(e);
    if (!action) return;
    e.preventDefault(); // sinon le navigateur tente son propre annuler / refaire sur la page
    if (action === 'undo') app.undo(); else app.redo();
  };
  window.addEventListener('keydown', onKey);
  return { destroy() { off(); window.removeEventListener('keydown', onKey); group.remove(); } };
}
