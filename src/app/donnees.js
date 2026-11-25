// Page « Mes données » (DON-01 à 05) : ce qui est enregistré et où, protection du stockage, sauvegarde et restauration par fichier, remise à zéro avec confirmation.
import { exporter, analyser, appliquer, remettreAZero } from './suivi-donnees.js';
import { donnees } from './suivi-local.js';

const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;
const stock = () => { try { return window.localStorage; } catch { return null; } };

export function renderDonnees($view) {
  const nEvts = donnees().evts.length;
  $view.innerHTML = `
    ${crumb('#/progression', 'Ma progression')}
    <div class="section-head"><h2>Mes données</h2><p>Tout ce qui concerne votre progression reste sur cet appareil. Aucun compte, aucun serveur.</p></div>
    <section class="prog-bloc" aria-labelledby="d-info"><h3 id="d-info">Ce qui est enregistré</h3>
      <ul class="d-liste">
        <li>Chaque réponse aux jeux : le jeu, l’élément travaillé (par exemple « tierce majeure »), juste ou faux, la réponse donnée et la date.</li>
        <li>Les leçons commencées et terminées, avec leur date.</li>
        <li>Les meilleurs scores par jeu, le niveau des jeux de rythme et le choix du mode de questions.</li>
        <li>Les phrases que vous créez ou importez dans le jeu d’oreille, et le thème d’affichage (ce ne sont pas des données de progression).</li>
      </ul>
      <p>Rien d’autre : ni nom, ni adresse, ni texte libre. Ces données sont gardées dans la mémoire de votre navigateur, sur cet appareil ; personne d’autre n’y a accès. <span id="d-compte">${nEvts} réponse${nEvts > 1 ? 's' : ''} enregistrée${nEvts > 1 ? 's' : ''}.</span></p>
      <p id="d-stockage" class="petit" role="status"></p>
      <p><button type="button" class="btn btn-ghost" id="d-persist" hidden>Demander la protection du stockage</button></p>
    </section>
    <section class="prog-bloc" aria-labelledby="d-sauve"><h3 id="d-sauve">Sauvegarder et restaurer</h3>
      <p>Pour garder votre progression en changeant d’appareil ou de navigateur, ou en cas d’effacement des données du navigateur : téléchargez un fichier, puis rechargez-le plus tard.</p>
      <p style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" class="btn btn-accent" id="d-export">Télécharger ma progression</button>
        <button type="button" class="btn btn-ghost" id="d-import">Charger un fichier…</button><input type="file" id="d-fichier" accept=".json,application/json" hidden></p>
      <div id="d-choix" hidden></div>
      <p id="d-message" role="status" aria-live="polite"></p>
    </section>
    <section class="prog-bloc" aria-labelledby="d-zero"><h3 id="d-zero">Effacer ma progression</h3>
      <p>Supprime les réponses, les leçons terminées, les scores et les réglages de jeu de cet appareil. Les phrases du jeu d’oreille et le thème sont conservés. On ne peut pas revenir en arrière : pensez à télécharger une sauvegarde avant.</p>
      <p><button type="button" class="btn btn-ghost" id="d-effacer">Effacer ma progression…</button></p>
      <div id="d-confirme" hidden role="alertdialog" aria-labelledby="d-confirme-t"><p id="d-confirme-t"><strong>Effacer définitivement toute la progression de cet appareil ?</strong></p>
        <p style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" class="btn btn-accent" id="d-oui">Oui, tout effacer</button><button type="button" class="btn btn-ghost" id="d-non">Annuler</button></p></div>
    </section>`;
  const $ = (id) => document.getElementById(id);
  const msg = (t) => { $('d-message').textContent = t; };
  const majCompte = () => { const n = donnees().evts.length; $('d-compte').textContent = `${n} réponse${n > 1 ? 's' : ''} enregistrée${n > 1 ? 's' : ''}.`; };

  // DON-03 : protection du stockage (empêche le navigateur d'effacer les données quand l'appareil manque de place)
  (async () => {
    const st = navigator.storage; if (!st?.persisted) { $('d-stockage').textContent = 'Ce navigateur ne permet pas de demander la protection du stockage : pensez à la sauvegarde par fichier.'; return; }
    const maj = async () => { const p = await st.persisted(); $('d-stockage').textContent = p ? 'Stockage protégé : le navigateur ne l’effacera pas de lui-même.' : 'Stockage non protégé : le navigateur peut l’effacer si l’appareil manque de place.'; $('d-persist').hidden = p || !st.persist; };
    await maj(); $('d-persist').addEventListener('click', async () => { try { await st.persist(); } catch (e) { /* ignoré */ } await maj(); if ($('d-persist').hidden === false) msg('Le navigateur n’a pas accordé la protection : la sauvegarde par fichier reste le meilleur moyen de ne rien perdre.'); });
  })();

  // DON-01 : sauvegarde
  $('d-export').addEventListener('click', () => {
    const s = stock(); if (!s) { msg('Le stockage de ce navigateur n’est pas disponible.'); return; }
    const blob = new Blob([exporter(s)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `solfege-progression-${new Date().toLocaleDateString('sv-SE')}.json`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); msg(`Fichier « ${a.download} » téléchargé.`);
  });
  // DON-01 : restauration (le fichier est analysé, résumé, puis l'élève choisit d'ajouter ou de remplacer)
  $('d-import').addEventListener('click', () => $('d-fichier').click());
  $('d-fichier').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const r = analyser(await f.text()); const choix = $('d-choix');
    if (!r.ok) { choix.hidden = true; msg(r.erreur); return; }
    choix.hidden = false; msg('');
    choix.innerHTML = `<p>Le fichier « ${f.name.replace(/[<>&"]/g, '')} » contient ${r.resume.reponses} réponse${r.resume.reponses > 1 ? 's' : ''}, ${r.resume.lecons} leçon${r.resume.lecons > 1 ? 's' : ''} et les scores de ${r.resume.jeux} jeu${r.resume.jeux > 1 ? 'x' : ''}.</p>
      <p style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" class="btn btn-accent" data-mode="fusion">Ajouter à ma progression</button><button type="button" class="btn btn-ghost" data-mode="remplace">Remplacer ma progression</button><button type="button" class="btn btn-ghost" data-mode="annuler">Annuler</button></p>`;
    choix.onclick = (ev) => {
      const b = ev.target.closest('button'); if (!b) return; choix.hidden = true;
      if (b.dataset.mode === 'annuler') { msg('Rien n’a été changé.'); return; }
      const s = stock(); if (!s) { msg('Le stockage de ce navigateur n’est pas disponible.'); return; }
      try { const res = appliquer(s, r.donnees, b.dataset.mode); majCompte(); msg(`Progression ${b.dataset.mode === 'fusion' ? 'complétée' : 'remplacée'} : ${res.reponses} réponse${res.reponses > 1 ? 's' : ''} et ${res.lecons} leçon${res.lecons > 1 ? 's' : ''} au total.`); }
      catch (er) { msg('La restauration a échoué (stockage plein ou indisponible).'); }
    };
  });
  // DON-02 : remise à zéro, en deux temps
  $('d-effacer').addEventListener('click', () => { $('d-confirme').hidden = false; $('d-oui').focus(); });
  $('d-non').addEventListener('click', () => { $('d-confirme').hidden = true; $('d-effacer').focus(); });
  $('d-oui').addEventListener('click', () => { const s = stock(); if (s) remettreAZero(s); $('d-confirme').hidden = true; majCompte(); msg('Progression effacée.'); });
  return null;
}
