// Dictées simples (CON-04) : on écoute un motif (autant de fois qu'on veut), puis on choisit parmi trois partitions celle qui a été jouée. Deux jeux : rythmique et mélodique, chacun à trois niveaux.
// La réponse est suivie comme une activité d'oreille (modalité « O »), élément « dictee:rythme-<niveau> » ou « dictee:melodie-<niveau> ».
import { mountScore, play, stopAll, configurePlayer } from '../music/player.js';
import { noter } from './suivi-local.js';
import { NIVEAUX_RYTHME, NIVEAUX_MELODIE, question, descOption } from './dictee-donnees.js';

const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;
const LETTRES = ['A', 'B', 'C'];
const TEXTES = {
  rythme: { titre: 'Dictée rythmique', intro: 'Écoute le rythme (tu peux le réécouter autant de fois que tu veux), puis choisis la partition qui correspond. Tous les sons sont sur la même note : seul le rythme compte.', niveaux: NIVEAUX_RYTHME },
  melodie: { titre: 'Dictée mélodique', intro: 'Écoute la petite mélodie (tu peux la réécouter autant de fois que tu veux), puis choisis la partition qui correspond. Elle est écrite en Do majeur.', niveaux: NIVEAUX_MELODIE },
};

export function renderDictee($view, id) {
  const genre = id === 'dictee-melodie' ? 'melodie' : 'rythme', T = TEXTES[genre], gid = genre === 'rythme' ? 'drg' : 'dmg';
  const cleNiv = `solfege_niveau_${id}`;
  let niveau = 1; try { const v = parseInt(localStorage.getItem(cleNiv), 10); if (v >= 1 && v <= 3) niveau = v; } catch (e) { /* ignoré */ }
  const cfg = new URLSearchParams((location.hash.split('?')[1]) || '').get('niveau'); if (cfg === '1' || cfg === '2' || cfg === '3') niveau = Number(cfg);
  let vitesse = 0; try { const v = parseInt(localStorage.getItem('solfege_vitesse'), 10); if (v >= -50 && v <= 50) vitesse = v; } catch (e) { /* ignoré */ }
  $view.innerHTML = `
    ${crumb('#/jeux', 'Tous les jeux')}
    <div class="game-shell">
      <div class="section-head"><h2>${T.titre}</h2></div>
      <p class="game-intro">${T.intro}</p>
      <div class="mode-choix" id="${gid}-niveau" role="group" aria-label="Niveau de difficulté" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px">${[1, 2, 3].map((n) => `<button type="button" class="chip" data-niveau="${n}" aria-pressed="false">${T.niveaux[n].label}</button>`).join('')}</div>
      <div class="reglage-vitesse" style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:0 0 12px"><label for="${gid}-vit">Vitesse du son : <output id="${gid}-vitval" for="${gid}-vit">${vitesse > 0 ? '+' : ''}${vitesse} %</output></label><input type="range" id="${gid}-vit" min="-50" max="50" step="5" value="${vitesse}" style="flex:1;min-width:160px;max-width:320px"></div>
      <div class="game-hud"><div class="hud-stat"><b id="${gid}-score">0</b>score</div><div class="hud-stat"><b id="${gid}-total">0</b>essais</div></div>
      <div style="margin:14px 0"><button type="button" class="btn btn-accent" id="${gid}-ecouter" style="font-size:1.05rem;padding:12px 22px">▶ Écouter</button></div>
      <div class="dictee-grille" id="${gid}-options" role="group" aria-label="Propositions"></div>
      <div class="feedback" id="${gid}-feedback" role="status" aria-live="polite">&nbsp;</div>
    </div>`;
  configurePlayer({ sounds: new URLSearchParams(location.search).get('sounds') || undefined, onStatus: () => {} });
  const $ = (s) => document.getElementById(`${gid}-${s}`);
  let q = null, score = 0, total = 0, active = true, nQ = 0, timer = 0;
  const bpm = () => 80 * (1 + vitesse / 100);
  const jouer = (motif) => play({ ...descOption(genre, motif, bpm()), width: undefined }, { button: $('ecouter') });
  const majNiveau = () => $('niveau').querySelectorAll('.chip').forEach((b) => { const on = Number(b.dataset.niveau) === niveau; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('active', on); });
  function nouvelle() {
    clearTimeout(timer); document.getElementById(`${gid}-ok`)?.remove(); document.getElementById(`${gid}-rejouer`)?.remove(); stopAll();
    q = question(genre, niveau); active = true; nQ++;
    const grille = $('options'); grille.innerHTML = '';
    q.options.forEach((motif, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'dictee-option'; b.dataset.i = String(i); b.setAttribute('aria-label', `Proposition ${LETTRES[i]}`);
      b.innerHTML = `<span class="dictee-lettre" aria-hidden="true">${LETTRES[i]}</span><span class="dictee-portee"></span>`;
      grille.append(b); mountScore(b.querySelector('.dictee-portee'), descOption(genre, motif, bpm()), { ink: 'currentColor', label: `Partition de la proposition ${LETTRES[i]}`, withPlay: false });
    });
    $('feedback').innerHTML = '&nbsp;'; $('feedback').className = 'feedback';
    if (nQ > 1) timer = setTimeout(() => jouer(q.options[q.bonne]), 350);   // à partir de la deuxième question le son est déjà autorisé : on joue tout de suite
  }
  $('options').addEventListener('click', (e) => {
    const b = e.target.closest('.dictee-option'); if (!b || !active) return;
    active = false; total++; $('total').textContent = total;
    const choix = Number(b.dataset.i), juste = choix === q.bonne;
    noter({ j: id, e: q.id, m: 'O', ok: juste, r: LETTRES[choix] });
    $('options').querySelectorAll('.dictee-option')[q.bonne].classList.add('correct');
    if (juste) { score++; $('score').textContent = score; $('feedback').textContent = 'Exact !'; $('feedback').className = 'feedback ok'; timer = setTimeout(nouvelle, 1100); return; }
    b.classList.add('wrong');
    $('feedback').innerHTML = `Ce n’était pas celle-là : la bonne réponse est la proposition ${LETTRES[q.bonne]}. Écoute-la, puis compare avec ton choix.`; $('feedback').className = 'feedback no';
    const rejouer = document.createElement('button'); rejouer.type = 'button'; rejouer.className = 'btn'; rejouer.textContent = `▶ Écouter la proposition ${LETTRES[q.bonne]}`; rejouer.style.cssText = 'margin:10px 10px 0 0';
    rejouer.addEventListener('click', () => jouer(q.options[q.bonne]));
    const ok = document.createElement('button'); ok.type = 'button'; ok.id = `${gid}-ok`; ok.className = 'btn btn-accent'; ok.textContent = 'OK, question suivante'; ok.style.marginTop = '10px'; ok.addEventListener('click', nouvelle);
    $('feedback').after(rejouer, ok); ok.focus(); rejouer.id = `${gid}-rejouer`;
  });
  $('ecouter').addEventListener('click', (e) => { e.preventDefault(); if (q) jouer(q.options[q.bonne]); });
  $('niveau').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; niveau = Number(b.dataset.niveau); try { localStorage.setItem(cleNiv, String(niveau)); } catch (er) { /* ignoré */ } majNiveau(); document.getElementById(`${gid}-rejouer`)?.remove(); nQ = 0; nouvelle(); });
  $('vit').addEventListener('input', () => { vitesse = parseInt($('vit').value, 10); $('vitval').textContent = `${vitesse > 0 ? '+' : ''}${vitesse} %`; try { localStorage.setItem('solfege_vitesse', String(vitesse)); } catch (er) { /* ignoré */ } });
  majNiveau(); nouvelle();
  return () => { clearTimeout(timer); stopAll(); };
}
