// Éditeur visuel de phrase : le composant d'édition de note de Scorsaire (copie figée), ouvert en plein écran.
// On touche la portée pour poser une note, une palette donne la durée, des boutons annuler/rétablir, clé, chiffrage, armure, 1 à 4 mesures, écoute.
// Il ne se charge qu'à l'ouverture (module paresseux). Résultat : un document « note » de Scorsaire, que le répertoire sait lire, dessiner et jouer.
import { defineScorsaireNoteEdit } from '../../vendor/scorsaire/src/note/edit.js';
import { newNoteDocument, hasContent } from '../../vendor/scorsaire/src/note/editmodel.js';
import { createNoteDocument, stringifyNoteDocument, parseNoteDocument } from '../../vendor/scorsaire/src/note/document.js';

const TAG = 'scorsaire-note';

/** Ouvre l'éditeur en plein écran. `doc` : document « note » à modifier (texte ou objet), sinon une phrase vide (clé de sol, 4/4, une mesure).
 *  `sounds` : adresse des SoundFonts ; `theme` : 'dark' | 'light'. Renvoie { close() }. `onSave(documentTexte)` et `onCancel()` sont appelés à « Terminé » et « Fermer ». */
export function ouvrirEditeur({ doc = null, sounds, theme = 'light', onSave, onCancel } = {}) {
  defineScorsaireNoteEdit(TAG);
  const el = document.createElement(TAG);
  el.setAttribute('mode', 'edit'); el.setAttribute('lang', 'fr'); el.setAttribute('fullscreen', ''); el.setAttribute('data-note-theme', theme);
  if (sounds) el.setAttribute('sounds', sounds);
  el.style.setProperty('--scorsaire-fullscreen-z', '3000');
  const start = doc ?? createNoteDocument(newNoteDocument({}).work);
  // couleur d'accent de l'application (au lieu du violet de Scorsaire)
  el.style.setProperty('--md-sys-color-primary', theme === 'dark' ? '#f0c46a' : '#86610a'); el.style.setProperty('--md-sys-color-on-primary', theme === 'dark' ? '#16141a' : '#ffffff');
  el.settings = { theme }; // clair ou sombre, comme l'application
  el.value = start;
  // repère de page (lecteurs d'écran) autour du composant ; la partition dessinée reçoit un nom accessible à chaque redessin
  const zone = document.createElement('section'); zone.setAttribute('aria-label', 'Éditeur de phrase'); zone.append(el);
  const nommer = () => el.shadowRoot?.querySelectorAll('svg[role="img"]:not([aria-label])').forEach((g) => g.setAttribute('aria-label', 'Partition en cours d’édition'));
  const obs = new MutationObserver(nommer); obs.observe(el.shadowRoot, { childList: true, subtree: true });
  const onPause = () => el.stop?.();
  window.addEventListener('solfege-pause', onPause);
  const done = () => { window.removeEventListener('solfege-pause', onPause); obs.disconnect(); zone.remove(); document.body.style.overflow = prevOverflow; };
  const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  el.addEventListener('save', (e) => { const v = e.detail.value; done(); onSave?.(typeof v === 'string' ? v : stringifyNoteDocument(v)); });
  el.addEventListener('cancel', () => { done(); onCancel?.(); });
  document.body.append(zone); nommer();
  return { close: done, el };
}

/** Titre proposé pour un document (première ligne du texte de la note), sinon ''. */
export function titreDuDocument(texte) {
  try { return (parseNoteDocument(texte).doc.text ?? '').split('\n')[0].trim().slice(0, 80); } catch { return ''; }
}
export function nombreDeMesures(texte) {
  try { return parseNoteDocument(texte).movement.masterbars.length; } catch { return 0; }
}
/** Vrai si au moins une note est écrite (une phrase vide n'a rien à jouer). */
export function aDuContenu(texte) {
  try { return hasContent({ work: parseNoteDocument(texte).work }); } catch { return false; }
}
