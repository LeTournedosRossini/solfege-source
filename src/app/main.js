// Coque de l'application Solfège : navigation, thèmes, listes (accueil, cours, jeux, outils, oreille).
// Reprend le comportement et les textes de l'application actuelle ; le contenu des leçons, des jeux et des outils est porté lot par lot
// (voir l'annexe C du cahier des charges). Les pages de détail non encore portées affichent un message clair.
import { CATALOGUE } from './data/catalogue.js';
const { lessons: LESSONS, games: GAMES, tools: TOOLS } = CATALOGUE;

/* ======================================================================
   UTILITAIRES
====================================================================== */
const $view = document.getElementById('view');
const $toast = document.getElementById('toast');
function toast(msg) { $toast.textContent = msg; $toast.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => $toast.classList.remove('show'), 2200); }

/* ======================================================================
   ROUTEUR
====================================================================== */
const routes = [];
function route(pattern, render) { routes.push({ pattern, render }); }
let currentCleanup = null;
// Titre de niveau 1 de chaque page (lecteurs d'écran) : le premier titre affiché, ou le nom de l'application
const $h1 = document.getElementById('page-h1');
new MutationObserver(() => { const t = ($view.querySelector('h1, h2')?.textContent || '').trim(); $h1.textContent = t ? `${t} — Solfège` : 'Solfège — apprendre à lire la musique'; }).observe($view, { childList: true, subtree: true });
function navigate() {
  const hash = location.hash || '#/';
  let m = null;
  for (const r of routes) { const x = hash.match(r.pattern); if (x) { m = { render: r.render, params: x.slice(1) }; break; } }
  document.querySelectorAll('#mainnav a').forEach((a) => {
    a.classList.toggle('active', hash.startsWith(a.getAttribute('href')) && a.getAttribute('href') !== '#/');
  });
  window.scrollTo(0, 0);
  if (currentCleanup) { try { currentCleanup(); } catch (e) { /* ignoré */ } currentCleanup = null; }
  if (m) {
    const result = m.render(...m.params);
    if (typeof result === 'function') currentCleanup = result;
  } else {
    $view.innerHTML = '<p>Page introuvable. <a href="#/">Retour à l’accueil</a></p>';
  }
}
window.addEventListener('hashchange', navigate);

function staffRuleHTML() {
  return '<div class="staff-rule" aria-hidden="true"><svg viewBox="0 0 600 34" preserveAspectRatio="none"><line x1="0" y1="4" x2="600" y2="4"/><line x1="0" y1="11" x2="600" y2="11"/><line x1="0" y1="18" x2="600" y2="18"/><line x1="0" y1="25" x2="600" y2="25"/><line x1="0" y1="32" x2="600" y2="32"/></svg></div>';
}
const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;
const lessonCard = (l) => `<a class="card" href="#/cours/${l.id}"><div class="k">Cours · ${l.duration}</div><h3>${l.title}</h3><p>${l.summary}</p></a>`;
const gameCard = (g) => `<a class="card" href="#/jeux/${g.id}"><div class="k">Jeu</div><h3>${g.title}</h3><p>${g.summary}</p></a>`;
const toolCard = (t) => `<a class="card" href="#/outils/${t.id}"><div class="k">Outil</div><h3>${t.title}</h3><p>${t.summary}</p></a>`;
const notYet = (what, lot, back, backLabel) => `
  ${crumb(back, backLabel)}
  <div class="section-head"><h2>${what}</h2><p>Cette partie de l’application est en cours de reprise : elle sera disponible dans une prochaine étape (lot ${lot} du plan).</p></div>`;

/* ======================================================================
   VUES
====================================================================== */
route(/^#\/$/, function home() {
  $view.innerHTML = `
    <section style="padding-top:20px;">
      <div class="section-head"><h2>Par où commencer ?</h2><p>Si vous débutez totalement, ces trois étapes suffisent pour lire vos premières notes.</p></div>
      <div class="grid">
        ${lessonCard(LESSONS[0])}
        ${gameCard(GAMES.find((g) => g.id === 'clef-sol'))}
        ${gameCard(GAMES.find((g) => g.id === 'rythme'))}
      </div>
    </section>
    ${staffRuleHTML()}
    <section>
      <div class="section-head"><h2>La boîte à outils</h2><p>Trois outils toujours à portée de main pendant que vous jouez.</p></div>
      <div class="grid">${TOOLS.map(toolCard).join('')}</div>
    </section>`;
});

route(/^#\/cours$/, function coursListe() {
  $view.innerHTML = `
    ${crumb('#/', 'Accueil')}
    <div class="section-head"><h2>Cours &amp; leçons</h2><p>Les notions essentielles pour lire une partition, expliquées simplement et illustrées.</p></div>
    <div class="grid">${LESSONS.map(lessonCard).join('')}</div>`;
});
route(/^#\/cours\/([\w-]+)$/, function coursDetail(id) {
  // le texte et les partitions des leçons (et le moteur de notation) ne se chargent qu'à l'ouverture d'une leçon
  let cleanup = null, gone = false;
  $view.innerHTML = '<p style="padding:24px 0">Chargement de la leçon…</p>';
  import('./lecon.js').then((m) => { if (!gone) cleanup = m.renderLecon($view, id); }).catch(() => { $view.innerHTML = '<p>La leçon n’a pas pu être chargée. Vérifiez la connexion puis réessayez.</p>'; });
  return () => { gone = true; if (cleanup) cleanup(); };
});

route(/^#\/jeux$/, function jeuxListe() {
  $view.innerHTML = `
    ${crumb('#/', 'Accueil')}
    <div class="section-head"><h2>Jeux de solfège</h2><p>Huit façons de s'entraîner, du plus calme au plus rapide.</p></div>
    <div class="grid">${GAMES.map(gameCard).join('')}</div>`;
});
route(/^#\/jeux\/([\w-]+)$/, function jeuDetail(id) {
  // les jeux (et le moteur de notation) ne se chargent qu'à l'ouverture d'un jeu
  let cleanup = null, gone = false;
  $view.innerHTML = '<p style="padding:24px 0">Chargement du jeu…</p>';
  import('./jeux.js').then((m) => { if (!gone) cleanup = m.renderJeu($view, id); }).catch(() => { $view.innerHTML = '<p>Le jeu n’a pas pu être chargé. Vérifiez la connexion puis réessayez.</p>'; });
  return () => { gone = true; if (cleanup) cleanup(); };
});

route(/^#\/outils$/, function outilsListe() {
  $view.innerHTML = `
    ${crumb('#/', 'Accueil')}
    <div class="section-head"><h2>La boîte à outils du musicien</h2><p>Trois utilitaires simples, à garder ouverts pendant que vous répétez.</p></div>
    <div class="grid">${TOOLS.map(toolCard).join('')}</div>`;
});
route(/^#\/outils\/([\w-]+)$/, function outilDetail(id) {
  // chaque outil se charge à l'ouverture
  let cleanup = null, gone = false;
  import('./outils.js').then((m) => { if (!gone) cleanup = m.renderOutil($view, id); }).catch(() => { $view.innerHTML = '<p>L’outil n’a pas pu être chargé. Vérifiez la connexion puis réessayez.</p>'; });
  return () => { gone = true; if (cleanup) cleanup(); };
});

route(/^#\/controle$/, function controle() {
  let cleanup = null, gone = false;
  import('./controle.js').then((m) => { if (!gone) cleanup = m.renderControle($view); });
  return () => { gone = true; if (cleanup) cleanup(); };
});

route(/^#\/oreille$/, function oreille() {
  let cleanup = null, gone = false;
  import('./oreille.js').then((m) => { if (!gone) cleanup = m.renderOreille($view); }).catch(() => { $view.innerHTML = '<p>Le module d’oreille n’a pas pu être chargé. Vérifiez la connexion puis réessayez.</p>'; });
  return () => { gone = true; if (cleanup) cleanup(); };
});

/* ======================================================================
   THÈMES (mêmes clés de stockage que l'application actuelle : les choix existants sont conservés)
====================================================================== */
const themeBtn = document.getElementById('theme-toggle');
const THEME_CYCLE = ['', 'light', 'dark', 'contrast'];
const THEME_META = {
  '': { icon: '◐', label: 'Thème automatique (suit votre appareil)' },
  light: { icon: '☀', label: 'Thème clair' },
  dark: { icon: '☾', label: 'Thème sombre' },
  contrast: { icon: '◧', label: 'Thème contraste élevé, pour malvoyants' },
};
function applyThemeIcon() {
  const meta = THEME_META[document.documentElement.getAttribute('data-theme') || ''];
  themeBtn.textContent = meta.icon;
  themeBtn.setAttribute('aria-label', meta.label + ' — cliquer pour changer de thème');
  themeBtn.setAttribute('title', meta.label);
}
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || '';
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length];
  if (next) { document.documentElement.setAttribute('data-theme', next); try { localStorage.setItem('solfege_theme', next); } catch (e) { /* ignoré */ } }
  else { document.documentElement.removeAttribute('data-theme'); try { localStorage.removeItem('solfege_theme'); } catch (e) { /* ignoré */ } }
  applyThemeIcon();
  toast(THEME_META[next].label);
});
try { const saved = localStorage.getItem('solfege_theme'); if (saved) document.documentElement.setAttribute('data-theme', saved); } catch (e) { /* ignoré */ }
applyThemeIcon();

/* ======================================================================
   HORS-LIGNE
====================================================================== */
if ('serviceWorker' in navigator) {
  // Mise à jour automatique : quand une nouvelle version prend la main, la page se recharge d'elle-même (sinon, l'ancienne version resterait affichée jusqu'au
  // chargement suivant, ce qui trompe les essais sur tablette). Pas de rechargement à la toute première installation.
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let rechargee = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (avaitUneVersion && !rechargee) { rechargee = true; location.reload(); } });
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').then((reg) => reg.update()).catch(() => { /* pas de service worker en prévisualisation locale non sécurisée */ }); });
}

navigate();
