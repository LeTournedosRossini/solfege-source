// Page « Cours » organisée en parcours thématiques, avec la progression de chaque parcours (NAV-03). Les leçons « terminées » sont celles que l'élève a marquées lui-même.
import { CATALOGUE } from './data/catalogue.js';
import { PARCOURS } from './data/parcours.js';
import { donnees } from './suivi-local.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CLE_VUE = 'solfege_vue_cours';

/** Progression d'un parcours : { total, terminees, commencees, prochaine (id de la première leçon non terminée) }. `lecons` : état des leçons du suivi. */
export function progressionParcours(p, lecons) {
  const fin = p.lecons.filter((id) => lecons[id]?.fin), debut = p.lecons.filter((id) => lecons[id]?.debut && !lecons[id]?.fin);
  return { total: p.lecons.length, terminees: fin.length, commencees: debut.length, prochaine: p.lecons.find((id) => !lecons[id]?.fin) ?? null };
}

const carte = (l, lecons) => {
  const etat = lecons[l.id]?.fin ? '<span class="niveau niveau-maitrise">Terminée</span>' : lecons[l.id]?.debut ? '<span class="niveau niveau-apprentissage">Commencée</span>' : '';
  return `<a class="card" href="#/cours/${l.id}"><div class="k">Cours · ${l.duration} ${etat}</div><h3>${l.title}</h3><p>${l.summary}</p></a>`;
};

export function htmlCours() {
  let vue = 'parcours'; try { if (localStorage.getItem(CLE_VUE) === 'ordre') vue = 'ordre'; } catch (e) { /* ignoré */ }
  const lecons = donnees().lecons, parId = new Map(CATALOGUE.lessons.map((l) => [l.id, l]));
  const choix = `<div class="mode-choix" role="group" aria-label="Organisation des leçons" style="display:flex;gap:8px;margin:0 0 14px"><button type="button" class="chip${vue === 'parcours' ? ' active' : ''}" data-vue="parcours" aria-pressed="${vue === 'parcours'}">Par parcours</button><button type="button" class="chip${vue === 'ordre' ? ' active' : ''}" data-vue="ordre" aria-pressed="${vue === 'ordre'}">Toutes les leçons</button></div>`;
  if (vue === 'ordre') return `${choix}<div class="grid">${CATALOGUE.lessons.map((l) => carte(l, lecons)).join('')}</div>`;
  return choix + PARCOURS.map((p) => {
    const g = progressionParcours(p, lecons), suite = g.prochaine ? parId.get(g.prochaine) : null;
    return `<section class="parcours" aria-labelledby="pc-${p.id}" style="margin:0 0 26px">
      <h3 id="pc-${p.id}" style="margin:0 0 4px">${esc(p.titre)}</h3>
      <p style="margin:0 0 6px">${esc(p.resume)}</p>
      <p style="margin:0 0 10px"><progress max="${g.total}" value="${g.terminees}" aria-label="Leçons terminées du parcours ${esc(p.titre)}" style="vertical-align:middle;width:140px"></progress> <strong>${g.terminees} / ${g.total}</strong> leçons terminées${suite && g.terminees < g.total ? ` · <a href="#/cours/${suite.id}">${g.terminees || g.commencees ? 'Continuer' : 'Commencer'} : ${esc(suite.title)}</a>` : g.terminees === g.total ? ' · parcours terminé' : ''}</p>
      <div class="grid">${p.lecons.map((id) => carte(parId.get(id), lecons)).join('')}</div></section>`;
  }).join('');
}

/** Branche le choix d'affichage (à appeler après avoir inséré le HTML). `rendre` redessine la page. */
export function brancherChoixCours(conteneur, rendre) {
  conteneur.querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => { try { localStorage.setItem(CLE_VUE, b.dataset.vue); } catch (e) { /* ignoré */ } rendre(); }));
}
