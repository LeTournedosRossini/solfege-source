// Page « Ma progression » (PRO-01) : leçons terminées, éléments par niveau de maîtrise, liste « à retravailler », précision par activité, oreille et lecture côte à côte, activité récente.
// Tout est calculé à partir du journal d'événements (suivi.js) ; ton neutre, aucune pression (pas de série de jours, pas d'objectif quotidien : décision Q9).
import { CATALOGUE } from './data/catalogue.js';
import PHRASES from './data/phrases.json';
import { donnees } from './suivi-local.js';
import { etats, LIBELLES, JOUR } from './suivi.js';
import { libelle, typeLibelle, INTERVALLES, elIntervalle } from './suivi-elements.js';
import { activite, titreLecon, titreActivite, jeuDeLecture, jeuxARevoir } from './liens.js';

const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const date = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const modalite = (m) => (m === 'O' ? 'Oreille' : 'Lecture');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');
/** Tableau qui défile horizontalement sur écran étroit : la zone reçoit le focus clavier et un nom. */
const defile = (nom, html) => `<div class="table-scroll" tabindex="0" role="region" aria-label="${nom}">${html}</div>`;
const chip = (niveau) => `<span class="niveau niveau-${niveau}">${LIBELLES[niveau]}</span>`;

export function renderProgression($view) {
  const d = donnees(), maintenant = Date.now(), et = etats(d.evts, maintenant), liste = [...et.values()];
  const lecons = CATALOGUE.lessons, terminees = lecons.filter((l) => d.lecons[l.id]?.fin), commencees = lecons.filter((l) => d.lecons[l.id]?.debut && !d.lecons[l.id]?.fin);
  const parNiveau = (n) => liste.filter((x) => x.niveau === n).length;
  const aRevoir = liste.filter((x) => x.niveau === 'a_retravailler' || x.niveau === 'a_revoir').sort((a, b) => a.dernier - b.dernier);

  // précision par activité
  const act = new Map();
  for (const ev of d.evts) { const a = act.get(ev.j) || { n: 0, ok: 0, dernier: 0 }; a.n++; a.ok += ev.ok; a.dernier = Math.max(a.dernier, ev.t); act.set(ev.j, a); }
  const lignesActivites = [...act.entries()].sort((a, b) => b[1].dernier - a[1].dernier).map(([j, a]) => { const { titre, route } = activite(j); return `<tr><th scope="row"><a href="${route}">${esc(titre)}</a></th><td>${a.n}</td><td>${pct(a.ok, a.n)}</td><td>${date(a.dernier)}</td></tr>`; }).join('');

  // oreille et lecture côte à côte pour les intervalles
  // à l'oreille, le sens dans lequel l'intervalle a été joué (montant, descendant, simultané) est enregistré avec chaque réponse : on le détaille par intervalle (SUI-06)
  const SENS = [['montant', '↑ montant'], ['descendant', '↓ descendant'], ['simultane', '⇅ simultané']], parSens = new Map();
  for (const ev of d.evts) { if (ev.j !== 'oreille-intervalles' || !SENS.some(([k]) => k === ev.c)) continue; const k = `${ev.e}|${ev.c}`, x = parSens.get(k) || { n: 0, ok: 0 }; x.n++; x.ok += ev.ok; parSens.set(k, x); }
  const detailSens = (el) => { const l = SENS.filter(([k]) => parSens.has(`${el}|${k}`)).map(([k, nom]) => { const x = parSens.get(`${el}|${k}`); return `<span class="sens-detail"><span class="sr-only">Sens </span>${nom} : ${x.ok}/${x.n}</span>`; }); return l.length ? `<br><span class="petit">${l.join(' · ')}</span>` : ''; };
  const ligneInterv = INTERVALLES.map((iv) => {
    const L = et.get(`L|${elIntervalle(iv.code)}`), O = et.get(`O|${elIntervalle(iv.code)}`);
    if (!L && !O) return '';
    const cell = (x) => (x ? `${chip(x.niveau)} <span class="petit">${x.reussites}/${x.essais}</span>` : '<span class="petit">pas encore travaillé</span>');
    const rattrape = (L?.niveau === 'maitrise' && !O) ? 'À l’oreille' : (O?.niveau === 'maitrise' && !L) ? 'En lecture' : '';
    return `<tr><th scope="row">${esc(iv.nom)}</th><td>${cell(L)}</td><td>${cell(O)}${O ? detailSens(elIntervalle(iv.code)) : ''}</td><td>${rattrape ? `<span class="petit">à essayer : ${rattrape}</span>` : ''}</td></tr>`;
  }).join('');

  // activité récente : les sept derniers jours, par jour et par activité
  const jours = new Map();
  for (const ev of d.evts) { if (maintenant - ev.t > 7 * JOUR) continue; const k = Math.floor(ev.t / JOUR); const m = jours.get(k) || new Map(); const a = m.get(ev.j) || { n: 0, ok: 0 }; a.n++; a.ok += ev.ok; m.set(ev.j, a); jours.set(k, m); }
  const recent = [...jours.entries()].sort((a, b) => b[0] - a[0]).map(([k, m]) => `<li><strong>${date(k * JOUR + 12 * 3600e3)}</strong> : ${[...m.entries()].map(([j, a]) => `${esc(activite(j).titre)} (${a.n} réponse${a.n > 1 ? 's' : ''}, ${pct(a.ok, a.n)})`).join(' ; ')}</li>`).join('');

  // « Réviser maintenant » : une séance ciblée par jeu de lecture (les éléments à retravailler y reviennent), et le jeu d'oreille pour les éléments entendus
  const parJeu = new Map(); let nOreille = 0;
  for (const x of aRevoir) { if (x.e.startsWith('dictee:')) { const j = x.e.startsWith('dictee:melodie') ? 'dictee-melodie' : 'dictee-rythme'; parJeu.set(j, (parJeu.get(j) || 0) + 1); continue; } if (x.m === 'O') { nOreille++; continue; } const j = jeuDeLecture(x.e); if (j) parJeu.set(j, (parJeu.get(j) || 0) + 1); }
  const tout = jeuxARevoir(et), boutonToutReviser = tout.length > 1 ? `<a class="btn btn-accent" href="#/jeux/${tout[0][0]}?reviser=1">Tout réviser (${tout.length} jeux à la suite)</a> ` : '';
  const boutonsRevision = boutonToutReviser + [...parJeu.entries()].map(([j, n]) => `<a class="btn btn-accent" href="#/jeux/${j}?reviser=1">Réviser : ${esc(titreActivite(j))} (${n})</a>`).join(' ') + (nOreille ? ` <a class="btn btn-ghost" href="#/oreille">Retravailler à l’oreille (${nOreille})</a>` : '');

  const vide = !d.evts.length && !terminees.length && !commencees.length;
  $view.innerHTML = `
    ${crumb('#/', 'Accueil')}
    <div class="section-head"><h2>Ma progression</h2><p>Calculée à partir de vos réponses, enregistrées sur cet appareil seulement.</p></div>
    ${vide ? '<p class="prog-vide">Rien d’enregistré pour l’instant. Ouvrez une leçon ou lancez un jeu : vos réponses apparaîtront ici.</p>' : ''}
    <section class="prog-bloc" aria-labelledby="p-lecons"><h3 id="p-lecons">Leçons</h3>
      <p><strong>${terminees.length} sur ${lecons.length}</strong> terminées${commencees.length ? `, ${commencees.length} commencée${commencees.length > 1 ? 's' : ''}` : ''}.</p>
      <progress max="${lecons.length}" value="${terminees.length}" aria-label="Leçons terminées">${terminees.length} / ${lecons.length}</progress>
      ${commencees.length ? `<p class="petit">À reprendre : ${commencees.slice(0, 5).map((l) => `<a href="#/cours/${l.id}">${esc(titreLecon(l.id))}</a>`).join(' · ')}</p>` : ''}
    </section>
    <section class="prog-bloc" aria-labelledby="p-elements"><h3 id="p-elements">Éléments travaillés</h3>
      <p>${liste.length ? `${liste.length} élément${liste.length > 1 ? 's' : ''} rencontré${liste.length > 1 ? 's' : ''} : ${['maitrise', 'apprentissage', 'a_retravailler', 'a_revoir'].map((n) => `${chip(n)} ${parNiveau(n)}`).join(' &nbsp; ')}` : 'Aucun élément rencontré pour l’instant.'}</p>
    </section>
    <section class="prog-bloc" aria-labelledby="p-retravailler"><h3 id="p-retravailler">À retravailler</h3>
      ${aRevoir.length ? `${defile('Tableau des éléments à retravailler', `<table class="prog-table"><thead><tr><th scope="col">Élément</th><th scope="col">Type</th><th scope="col">Modalité</th><th scope="col">Réussite</th><th scope="col">Dernier essai</th></tr></thead><tbody>${aRevoir.map((x) => `<tr><th scope="row">${esc(libelle(x.e, PHRASES))} ${chip(x.niveau)}</th><td>${esc(typeLibelle(x.e))}</td><td>${modalite(x.m)}</td><td>${x.reussites}/${x.essais} (${pct(x.reussites, x.essais)})</td><td>${date(x.dernier)}</td></tr>`).join('')}</tbody></table>`)}<p class="prog-actions" style="margin-top:14px;display:flex;flex-wrap:wrap;gap:10px">${boutonsRevision}</p>` : '<p>Rien à retravailler pour le moment.</p>'}
    </section>
    <section class="prog-bloc" aria-labelledby="p-activites"><h3 id="p-activites">Réussite par activité</h3>
      ${lignesActivites ? `${defile('Tableau de réussite par activité', `<table class="prog-table"><thead><tr><th scope="col">Activité</th><th scope="col">Réponses</th><th scope="col">Réussite</th><th scope="col">Dernière fois</th></tr></thead><tbody>${lignesActivites}</tbody></table>`)}` : '<p>Aucune réponse enregistrée.</p>'}
    </section>
    <section class="prog-bloc" aria-labelledby="p-interv"><h3 id="p-interv">Intervalles : lecture et oreille</h3>
      ${ligneInterv ? `<p class="petit">Les deux manières de travailler un intervalle sont suivies séparément : on peut n’en travailler qu’une et rattraper l’autre plus tard.</p>${defile('Tableau des intervalles en lecture et à l’oreille', `<table class="prog-table"><thead><tr><th scope="col">Intervalle</th><th scope="col">Lecture</th><th scope="col">Oreille</th><th scope="col"><span class="sr-only">Suggestion</span></th></tr></thead><tbody>${ligneInterv}</tbody></table>`)}` : '<p>Pas encore d’intervalle travaillé.</p>'}
    </section>
    <section class="prog-bloc" aria-labelledby="p-recent"><h3 id="p-recent">Activité des sept derniers jours</h3>
      ${recent ? `<ul class="prog-recent">${recent}</ul>` : '<p>Aucune activité récente.</p>'}
    </section>
    <p class="prog-bloc"><a href="#/donnees">Mes données : ce qui est enregistré, sauvegarder, restaurer ou effacer</a></p>`;
  return null;
}
