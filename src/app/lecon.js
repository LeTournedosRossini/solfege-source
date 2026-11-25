// Page d'une leçon : le texte (repris tel quel de l'application actuelle) et ses partitions, dessinées et jouées par le moteur de Scorsaire.
import { CATALOGUE } from './data/catalogue.js';
import LECONS from './data/lecons.json';
import { mountScore, configurePlayer, stopAll } from '../music/player.js';
import { noterLecon, donnees } from './suivi-local.js';
import { liensExercices } from './liens.js';

const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;

export function renderLecon($view, id) {
  const meta = CATALOGUE.lessons.find((x) => x.id === id);
  const lecon = LECONS.find((x) => x.id === id);
  if (!meta || !lecon) { $view.innerHTML = '<p>Cours introuvable.</p>'; return null; }
  const idx = CATALOGUE.lessons.indexOf(meta);
  const next = CATALOGUE.lessons[idx + 1];
  $view.innerHTML = `
    ${crumb('#/cours', 'Tous les cours')}
    <article class="lesson-head"><div class="k" style="color:var(--accent-deep); font-weight:700; font-size:.78rem; text-transform:uppercase; letter-spacing:.06em;">Cours · ${meta.duration} de lecture</div><h2>${meta.title}</h2></article>
    <div class="lesson-body">${lecon.html}</div>
    <p id="sndstatus" role="status" style="font-size:.8rem;opacity:.65;min-height:1.2em"></p>
    ${liensExercices(id)}
    <div class="lesson-done" style="margin:18px 0"><button type="button" class="btn btn-ghost" id="lecon-fin" aria-pressed="false">Leçon terminée</button> <span id="lecon-date" role="status" style="font-size:.85rem;color:var(--fg-soft)"></span></div>
    ${next ? `<a class="btn btn-accent" href="#/cours/${next.id}">Cours suivant : ${next.title} →</a>` : `<a class="btn btn-primary" href="#/jeux">Passer à la pratique : les jeux →</a>`}`;
  // suivi : leçon commencée à l'ouverture ; « terminée » seulement par une action volontaire (règle 7.3), qu'on peut annuler
  noterLecon(id, 'debut');
  const btnFin = document.getElementById('lecon-fin'), dateFin = document.getElementById('lecon-date');
  const majFin = () => { const l = donnees().lecons[id] || {}; btnFin.setAttribute('aria-pressed', String(!!l.fin)); btnFin.textContent = l.fin ? '✓ Leçon terminée (annuler)' : 'Leçon terminée'; dateFin.textContent = l.fin ? `le ${new Date(l.fin).toLocaleDateString('fr-FR')}` : ''; };
  btnFin.addEventListener('click', () => { noterLecon(id, btnFin.getAttribute('aria-pressed') === 'true' ? 'rouvrir' : 'fin'); majFin(); });
  majFin();
  configurePlayer({ sounds: new URLSearchParams(location.search).get('sounds') || undefined, onStatus: (t) => { const el = document.getElementById('sndstatus'); if (el) el.textContent = t; } });
  $view.querySelectorAll('[data-abc]').forEach((host) => {
    const s = lecon.scores[Number(host.dataset.abc)];
    if (!s?.desc) { host.textContent = 'Partition indisponible.'; return; }
    mountScore(host, s.desc, { ink: 'currentColor', withPlay: s.play, label: 'Partition d’exemple' });
  });
  // une figure plus large que l'écran défile : on la rend accessible au clavier
  $view.querySelectorAll('.figure-wrap').forEach((f) => { if (f.scrollWidth > f.clientWidth + 1) { f.tabIndex = 0; f.setAttribute('role', 'group'); f.setAttribute('aria-label', 'Figure (défile horizontalement)'); } });
  return () => stopAll();
}
