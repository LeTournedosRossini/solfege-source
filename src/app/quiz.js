// Quiz de fin de leçon (NAV-05) : quatre questions à choix unique, une explication après chaque réponse, un bilan à la fin. Chaque réponse est enregistrée dans le suivi (élément « quiz:<leçon>:<n> »).
import { QUIZ } from './data/quiz.js';
import { noter } from './suivi-local.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const melange = (liste) => { const a = liste.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Section du quiz d'une leçon ('' si la leçon n'a pas de quiz). */
export function htmlQuiz(id) {
  const q = QUIZ[id]; if (!q) return '';
  return `<section class="quiz card" id="quiz" aria-labelledby="quiz-titre" style="margin:22px 0;padding:18px">
    <h3 id="quiz-titre" style="margin:0 0 6px">Quiz de fin de leçon</h3>
    <div id="quiz-corps"><p style="margin:0 0 12px">${q.length} questions pour vérifier ce que tu as retenu. Une explication s’affiche après chaque réponse.</p>
    <button type="button" class="btn btn-accent" id="quiz-debut">Commencer le quiz</button></div></section>`;
}

/** Branche le quiz de la leçon `id` dans `racine` (la page de la leçon). */
export function brancherQuiz(racine, id) {
  const donnees = QUIZ[id]; const corps = racine.querySelector('#quiz-corps'); if (!donnees || !corps) return;
  const total = donnees.length;
  let rang = 0, bonnes = 0, ratees = [];
  const depart = () => { rang = 0; bonnes = 0; ratees = []; question(); };
  racine.querySelector('#quiz-debut').addEventListener('click', depart);
  function question() {
    const [enonce, juste, fausses, expl] = donnees[rang];
    const options = melange([juste, ...fausses]);
    corps.innerHTML = `<p class="petit" style="margin:0 0 6px;color:var(--fg-soft)">Question ${rang + 1} / ${total}</p>
      <p id="quiz-q" style="font-weight:700;margin:0 0 12px">${esc(enonce)}</p>
      <div role="group" aria-labelledby="quiz-q" id="quiz-options" style="display:flex;flex-direction:column;gap:8px">${options.map((o) => `<button type="button" class="btn quiz-option" data-v="${esc(o)}" style="text-align:left;justify-content:flex-start">${esc(o)}</button>`).join('')}</div>
      <div id="quiz-retour" role="status" aria-live="polite" style="margin-top:12px"></div>`;
    const retour = corps.querySelector('#quiz-retour');
    corps.querySelector('#quiz-options').addEventListener('click', (e) => {
      const b = e.target.closest('.quiz-option'); if (!b || b.disabled) return;
      const ok = b.dataset.v === juste;
      corps.querySelectorAll('.quiz-option').forEach((x) => { x.disabled = true; if (x.dataset.v === juste) x.classList.add('btn-accent'); });
      if (!ok) b.style.borderColor = 'var(--brick)';
      noter({ j: `quiz-${id}`, e: `quiz:${id}:${rang + 1}`, m: 'L', ok });
      if (ok) bonnes++; else ratees.push(rang);
      retour.innerHTML = `<p style="margin:0 0 8px;font-weight:700;color:${ok ? 'color-mix(in srgb, var(--sage) 55%, var(--fg))' : 'color-mix(in srgb, var(--brick) 62%, var(--fg))'}">${ok ? 'Exact !' : `Pas tout à fait. La bonne réponse : ${esc(juste)}.`}</p><p style="margin:0 0 10px">${esc(expl)}</p>`;
      const suite = document.createElement('button'); suite.type = 'button'; suite.className = 'btn btn-accent'; suite.textContent = rang + 1 < total ? 'Question suivante' : 'Voir le résultat';
      suite.addEventListener('click', () => { rang++; if (rang < total) question(); else bilan(); });
      retour.append(suite); suite.focus();
    });
  }
  function bilan() {
    corps.innerHTML = `<p style="font-size:1.2rem;font-weight:700;margin:0 0 8px" id="quiz-score">Résultat : ${bonnes} / ${total}</p>
      <p style="margin:0 0 10px">${bonnes === total ? 'Bravo, tout est juste !' : bonnes >= total - 1 ? 'Très bien : relis juste le point ci-dessous.' : 'Relis les points ci-dessous, puis refais le quiz.'}</p>
      ${ratees.length ? `<h4 style="margin:0 0 6px">À revoir</h4><ul style="margin:0 0 12px 18px">${ratees.map((i) => `<li><strong>${esc(donnees[i][0])}</strong> ${esc(donnees[i][1])}. ${esc(donnees[i][3])}</li>`).join('')}</ul>` : ''}
      <button type="button" class="btn btn-accent" id="quiz-refaire">Refaire le quiz</button>`;
    const b = corps.querySelector('#quiz-refaire'); b.addEventListener('click', depart); corps.querySelector('#quiz-score').setAttribute('tabindex', '-1'); corps.querySelector('#quiz-score').focus();
  }
}
