// Les 8 jeux de lecture, repris de l'application actuelle : mêmes règles, mêmes réservoirs de questions, mêmes textes (feedback neutre, comme décidé dans le cahier des charges).
// Les partitions sont dessinées et jouées par le moteur de Scorsaire ; le jeu de rythme garde sa propre horloge audio (précision des frappes).
import { mountScore, configurePlayer, stopAll } from '../music/player.js';
import { CATALOGUE } from './data/catalogue.js';
import { evaluateRhythm } from './rythme-eval.js';
import { noter, etatsActuels } from './suivi-local.js';
import { choisir, apresReponse, nouvelleSeance } from './suivi-tirage.js';
import { elNote, elIntervalleLecture, elSimple, elRythme, libelle as libelleEl } from './suivi-elements.js';
import { noteDuDegre, intervalAuHasard } from './jeux-tonalites.js';
import { explication } from './explications.js';
import { ALTERATIONS, POOL_ALTERATIONS, GAMMES_LABELS, POOL_GAMMES, CLE_GAMME } from './jeux-gammes.js';
import { elGamme } from './suivi-elements.js';
import { jeuxARevoir, titreActivite } from './liens.js';
import { FR_NOTE, TREBLE_POOL, BASS_POOL, INTERVAL_START, INTERVAL_POOL, CHORD_LABELS, CHORD_POOL, DURATION_POOL, DURATION_NOTE, DEGREE_POOL, SHARP_KEYS, FLAT_KEYS } from './jeux-donnees.js';

const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;
const SERIE = 10;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Même clé de stockage que l'application actuelle
function recordScore(gameId, score, total) {
  try {
    const s = JSON.parse(localStorage.getItem('solfege_progress') || '{}');
    s.games = s.games || {};
    const g = s.games[gameId] || { best: 0, played: 0 };
    g.played += 1; if (score > g.best) g.best = score; g.last = score; g.lastTotal = total;
    s.games[gameId] = g;
    localStorage.setItem('solfege_progress', JSON.stringify(s));
  } catch (e) { /* stockage indisponible : ignoré */ }
}

const whole = (notes, extra = {}) => ({ n: notes, d: 'whole', ...extra });
/** Dessine une question dans `host` (un bouton ▶ est ajouté juste après). `scale` : agrandissement, `staffwidth` : largeur d'origine d'abcjs. */
function show(host, desc, { staffwidth, scale = 1.15, play = true } = {}) {
  stopAll();
  const d = { time: null, bpm: 200, scale, width: Math.round((staffwidth + 8) * scale), ...desc };
  mountScore(host, d, { ink: 'currentColor', label: 'Partition de la question', withPlay: play });
}

/** Squelette commun d'un jeu à réponses : score, essais, partition, boutons, retour. */
function quizShell($view, { gid, title, intro, adaptive, tonalite }) {
  $view.innerHTML = `
    ${crumb('#/jeux', 'Tous les jeux')}
    <div class="game-shell">
      <div class="section-head"><h2>${title}</h2></div>
      ${intro ? `<p class="game-intro">${intro}</p>` : ''}
      ${adaptive ? `<div class="mode-choix" id="${gid}-mode" role="group" aria-label="Choix des questions" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px"><button type="button" class="chip" data-mode="libre" aria-pressed="false">Au hasard</button><button type="button" class="chip" data-mode="adapte" aria-pressed="false" title="Ce qui est à retravailler revient plus souvent, les nouveautés arrivent peu à peu">Adaptées à ma progression</button><button type="button" class="chip" data-mode="erreurs" aria-pressed="false" title="Seulement ce que tu as raté">Mes erreurs</button></div>` : ''}
      <div class="mode-choix" id="${gid}-options" role="group" aria-label="Options de la partie" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px">
        ${tonalite ? `<button type="button" class="chip" id="${gid}-ton" aria-pressed="false" title="${tonalite.aide}">${tonalite.libelle}</button>` : ''}
        <button type="button" class="chip" id="${gid}-serie" aria-pressed="false" title="Dix questions, puis un bilan : score, durée, ce qu'il reste à travailler">Série de 10 questions</button>
      </div>
      <div class="game-hud">
        <div class="hud-stat"><b id="${gid}-score">0</b>score</div>
        <div class="hud-stat"><b id="${gid}-total">0</b>essais</div>
        <div class="hud-stat" id="${gid}-avance" hidden><b id="${gid}-rang">0/10</b>série</div>
      </div>
      <div class="staff-box"><div class="abc-notation" id="${gid}-staff"></div></div>
      <div class="answers" id="${gid}-answers"></div>
      <div class="feedback" id="${gid}-feedback" role="status" aria-live="polite">&nbsp;</div>
    </div>`;
  configurePlayer({ sounds: new URLSearchParams(location.search).get('sounds') || undefined, onStatus: () => {} });
  return { staff: document.getElementById(`${gid}-staff`), answers: document.getElementById(`${gid}-answers`), feedback: document.getElementById(`${gid}-feedback`), mode: document.getElementById(`${gid}-mode`), scoreEl: document.getElementById(`${gid}-score`), totalEl: document.getElementById(`${gid}-total`), ton: document.getElementById(`${gid}-ton`), serie: document.getElementById(`${gid}-serie`), avance: document.getElementById(`${gid}-avance`), rang: document.getElementById(`${gid}-rang`), box: document.getElementById(`${gid}-staff`).closest('.game-shell') };
}

/** Moteur commun : `answers` = les boutons de réponse, TOUJOURS les mêmes et dans le même ordre (le joueur prend le réflexe d'appuyer au bon endroit) ;
 *  `next(staff)` prépare une question et renvoie { label } ; `good(label)` / `bad(label)` donnent le texte de retour. */
function runQuiz($view, { gid, scoreId, title, intro, answers, next, good, bad, delay = 900, adaptive = null, reviser = false, tonalite = null }) {
  const ui = quizShell($view, { gid, title, intro, adaptive, tonalite });
  ui.answers.innerHTML = answers.map((k) => `<button class="ans-btn" data-k="${k}">${k}</button>`).join('');
  let score = 0, total = 0, current = null, active = true, timer = 0;
  // tonalités variées (CON-01) : choix mémorisé par jeu ; série de 10 questions avec bilan (SUI-04)
  const cleTon = `solfege_tonalites_${scoreId ?? gid}`; let varie = false, serie = null;
  if (tonalite) { try { varie = localStorage.getItem(cleTon) === '1'; } catch (e) { /* ignoré */ } }
  const majTon = () => { if (ui.ton) { ui.ton.setAttribute('aria-pressed', String(varie)); ui.ton.classList.toggle('active', varie); } };
  const majSerie = () => { ui.serie.setAttribute('aria-pressed', String(!!serie)); ui.serie.classList.toggle('active', !!serie); ui.avance.hidden = !serie; if (serie) ui.rang.textContent = `${Math.min(serie.n + 1, SERIE)}/${SERIE}`; };
  // choix des questions : au hasard (comme avant), adapté à la progression (règles 7.2), ou seulement les erreurs ; le choix est mémorisé par jeu
  const cleMode = `solfege_mode_${scoreId ?? gid}`; let mode = reviser ? 'erreurs' : 'libre', seance = nouvelleSeance();
  if (!reviser) { try { const m = localStorage.getItem(cleMode); if (m === 'adapte' || m === 'erreurs') mode = m; } catch (e) { /* ignoré */ } }
  const majMode = () => ui.mode?.querySelectorAll('.chip').forEach((b) => { const on = b.dataset.mode === mode; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('active', on); });
  function question() {
    if (adaptive && mode !== 'libre') {
      const elements = [...new Set(adaptive.pool.map(adaptive.element))];
      const e = choisir({ candidats: elements, etats: etatsActuels(), m: 'L', seance, mode });
      if (e !== null) { const items = adaptive.pool.filter((it) => adaptive.element(it) === e); return adaptive.render(ui.staff, pick(items), varie); }
      ui.feedback.textContent = 'Aucune erreur à retravailler pour l’instant : questions adaptées à ta progression.'; mode = 'adapte'; try { localStorage.setItem(cleMode, mode); } catch (er) { /* ignoré */ } majMode();
      const e2 = choisir({ candidats: elements, etats: etatsActuels(), m: 'L', seance, mode });
      return adaptive.render(ui.staff, pick(adaptive.pool.filter((it) => adaptive.element(it) === e2)), varie);
    }
    return next(ui.staff, varie);
  }
  function round() {
    current = question();
    ui.answers.querySelectorAll('.ans-btn').forEach((b) => b.classList.remove('correct', 'wrong'));
    if (!ui.feedback.textContent.startsWith('Aucune erreur')) ui.feedback.innerHTML = '&nbsp;'; ui.feedback.className = 'feedback'; active = true;
  }
  ui.answers.addEventListener('click', (e) => {
    const btn = e.target.closest('.ans-btn'); if (!btn || !active) return;
    active = false; total++; ui.totalEl.textContent = total;
    noter({ j: scoreId ?? gid, e: current.element, m: 'L', ok: btn.dataset.k === current.label, r: btn.dataset.k }); // suivi : une réponse par question
    if (btn.dataset.k === current.label) { score++; ui.scoreEl.textContent = score; btn.classList.add('correct'); ui.feedback.textContent = good(current.label); ui.feedback.className = 'feedback ok'; }
    else { btn.classList.add('wrong'); ui.answers.querySelectorAll('.ans-btn').forEach((b) => { if (b.dataset.k === current.label) b.classList.add('correct'); }); ui.feedback.textContent = `${bad(current.label)} ${explication(current.element)}`.trim(); ui.feedback.className = 'feedback no'; }
    apresReponse(seance, current.element, btn.dataset.k === current.label);
    recordScore(scoreId ?? gid, score, total);
    if (serie) {
      serie.n++; if (btn.dataset.k === current.label) serie.ok++; else serie.rates.set(current.element, (serie.rates.get(current.element) ?? 0) + 1);
      if (serie.n >= SERIE) { timer = setTimeout(bilan, delay); return; }
      majSerie();
    }
    timer = setTimeout(round, delay);
  });
  function bilan() {
    const s = serie, sec = Math.round((Date.now() - s.debut) / 1000), duree = sec >= 60 ? `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s` : `${sec} s`;
    const rates = [...s.rates.entries()].sort((a, b) => b[1] - a[1]);
    const courant = (location.hash.match(/^#\/jeux\/([^?]+)/) || [])[1], suivant = reviser ? (jeuxARevoir(etatsActuels()).map(([j]) => j).find((j) => j !== courant) ?? null) : null;
    let panneau = document.getElementById(`${gid}-bilan`); panneau?.remove();
    panneau = document.createElement('section'); panneau.id = `${gid}-bilan`; panneau.className = 'card'; panneau.setAttribute('aria-label', 'Bilan de la série'); panneau.style.cssText = 'margin-top:14px;padding:16px';
    panneau.innerHTML = `<h3 style="margin:0 0 6px">Série terminée : ${s.ok} / ${SERIE}</h3><p style="margin:0 0 8px">Durée : ${duree}.</p>${rates.length ? `<p style="margin:0 0 4px">À retravailler :</p><ul style="margin:0 0 10px 18px">${rates.map(([e, n]) => `<li>${libelleEl(e)}${n > 1 ? ` (${n} erreurs)` : ''}</li>`).join('')}</ul>` : '<p style="margin:0 0 10px">Aucune erreur : bravo !</p>'}<div style="display:flex;flex-wrap:wrap;gap:8px">${suivant ? `<a class="btn btn-accent" href="#/jeux/${suivant}?reviser=1">Jeu suivant à réviser : ${titreActivite(suivant)}</a>` : ''}<button type="button" class="btn ${suivant ? '' : 'btn-accent'}" data-act="encore">Nouvelle série</button><button type="button" class="btn" data-act="libre">Continuer sans limite</button></div>`;
    ui.box.append(panneau); active = false; ui.answers.querySelectorAll('.ans-btn').forEach((b) => { b.disabled = true; });
    (panneau.querySelector('a.btn') || panneau.querySelector('[data-act=encore]')).focus();
    panneau.addEventListener('click', (e) => { const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return; panneau.remove(); ui.answers.querySelectorAll('.ans-btn').forEach((b) => { b.disabled = false; }); if (a === 'encore') demarrerSerie(); else { serie = null; majSerie(); } clearTimeout(timer); round(); });
  }
  const demarrerSerie = () => { serie = { n: 0, ok: 0, rates: new Map(), debut: Date.now() }; majSerie(); };
  ui.serie.addEventListener('click', () => { document.getElementById(`${gid}-bilan`)?.remove(); ui.answers.querySelectorAll('.ans-btn').forEach((b) => { b.disabled = false; }); if (serie) { serie = null; majSerie(); } else demarrerSerie(); clearTimeout(timer); round(); });
  ui.ton?.addEventListener('click', () => { varie = !varie; try { localStorage.setItem(cleTon, varie ? '1' : '0'); } catch (er) { /* ignoré */ } majTon(); clearTimeout(timer); round(); });
  ui.mode?.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; mode = b.dataset.mode; seance = nouvelleSeance(); try { localStorage.setItem(cleMode, mode); } catch (er) { /* ignoré */ } majMode(); clearTimeout(timer); round(); });
  if (reviser) demarrerSerie();   // une séance de révision est une série de 10 : on enchaîne ensuite avec le jeu suivant à réviser
  majMode(); majTon(); majSerie();
  round();
  return () => { clearTimeout(timer); stopAll(); };
}

/* ---------- Lecture de notes (clé de Sol, clé de Fa) ---------- */
function noteGame($view, clef, reviser) {
  const pool = clef === 'treble' ? TREBLE_POOL : BASS_POOL;
  const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((l) => FR_NOTE[l]); // Do Ré Mi Fa Sol La Si, toujours dans cet ordre
  const rendreNote = (staff, n) => { show(staff, { clef, measures: [[whole([n])]] }, { staffwidth: 260 }); return { label: FR_NOTE[n[0]], element: elNote(clef, n) }; };
  return runQuiz($view, {
    answers: names,
    gid: 'ng', scoreId: clef === 'treble' ? 'clef-sol' : 'clef-fa', title: clef === 'treble' ? 'Lecture de notes — Clé de Sol' : 'Lecture de notes — Clé de Fa',
    next(staff) { return rendreNote(staff, pick(pool)); },
    adaptive: { pool, element: (n) => elNote(clef, n), render: (staff, n) => rendreNote(staff, n) },
    reviser,
    good: (l) => `Exact : ${l}.`, bad: (l) => `C'était ${l}.`, delay: 750,
  });
}

/* ---------- Jeux à réservoir : intervalles, accords, durées et silences, degrés ---------- */
const poolGames = {
  intervalles: { gid: 'ig', title: 'Jeu des intervalles', intro: "Do est la première note (sauf si tu choisis « Départ sur toutes les notes »). Identifie l'intervalle qui la sépare de la seconde note affichée.",
    labels: [...new Set(INTERVAL_POOL.map((p) => p.label))], staffwidth: 260, bpm: 260, element: elIntervalleLecture,
    item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[whole([INTERVAL_START]), whole([it.note])]] } }), pool: INTERVAL_POOL },
  accords: { gid: 'ag', title: 'Jeu des accords', intro: "Observe les notes empilées sur la portée et identifie la nature de l'accord.",
    labels: CHORD_LABELS, staffwidth: 220, bpm: 120, element: (l) => elSimple('accord', l),
    item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[whole(it.notes)]] } }), pool: CHORD_POOL },
  'durees-silences': { gid: 'dg', title: 'Jeu des durées et silences', intro: "Une figure de note ou un silence s'affiche : retrouve son nom. (Un silence... ne joue rien : c'est normal !)",
    labels: [...new Set(DURATION_POOL.map((p) => p.label))], staffwidth: 150, scale: 1.2, bpm: 150, element: (l) => elSimple('duree', l),
    item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[it.rest ? { rest: true, d: it.d } : { n: [DURATION_NOTE], d: it.d }]] } }), pool: DURATION_POOL },
  degres: { gid: 'gg', title: 'Jeu des degrés', intro: 'En Do majeur (ou dans la tonalité indiquée par l’armure si tu choisis « Toutes les tonalités ») : quelle est la fonction (le degré) de la note affichée ?',
    labels: DEGREE_POOL.map((p) => p.label), staffwidth: 200, bpm: 200, element: (l) => elSimple('degre', l),
    item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[whole([it.note])]] } }), pool: DEGREE_POOL },
};
poolGames.alterations = { gid: 'alg', title: 'Jeu des altérations', intro: 'Deux notes de même nom se suivent. Regarde le signe placé devant la deuxième : dièse, bémol, ou bécarre (qui annule le signe de la première note) ?',
  labels: ALTERATIONS, staffwidth: 200, bpm: 120, element: (l) => elSimple('alteration', l),
  item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[whole([it.notes[0]]), whole([it.notes[1]])]] } }), pool: POOL_ALTERATIONS };
poolGames['gammes-mineures'] = { gid: 'gmg', title: 'Jeu des gammes mineures', intro: 'Une gamme de huit notes monte sur la portée. Est-elle majeure, mineure naturelle, mineure harmonique (7e degré haussé) ou mineure mélodique (6e et 7e degrés haussés à la montée) ?',
  labels: GAMMES_LABELS, staffwidth: 330, scale: 1.05, bpm: 150, element: (l) => elGamme(CLE_GAMME[l]),
  item: (it) => ({ label: it.label, desc: { clef: 'treble', key: it.key, measures: [it.notes.map((n) => ({ n: [n], d: 'eighth', dots: 0 }))] } }), pool: POOL_GAMMES };
const TONALITES_JEU = {
  intervalles: { libelle: 'Départ sur toutes les notes', aide: 'La première note change : tu reconnais les intervalles quel que soit le point de départ' },
  degres: { libelle: 'Toutes les tonalités', aide: 'La tonalité change (armure sur la portée) : tu reconnais les degrés dans chaque tonalité majeure' },
};
const DEGRES = ['Tonique', 'Sus-tonique', 'Médiante', 'Sous-dominante', 'Dominante', 'Sus-dominante', 'Sensible'];
function poolGame($view, id, reviser) {
  const g = poolGames[id];
  const rendre = (staff, raw, varie = false) => {
    const it = g.item(raw); let desc = it.desc;
    if (varie && id === 'degres') { const n = Math.floor(Math.random() * 15) - 7; desc = { clef: 'treble', key: n, measures: [[whole([noteDuDegre(n, DEGRES.indexOf(it.label))])]] }; }
    else if (varie && id === 'intervalles') { const r = intervalAuHasard(it.label); if (r) desc = { clef: 'treble', measures: [[whole([r[0]]), whole([r[1]])]] }; }
    show(staff, { ...desc, bpm: g.bpm }, { staffwidth: g.staffwidth, scale: g.scale ?? 1.15 }); return { label: it.label, element: g.element(it.label) };
  };
  return runQuiz($view, {
    gid: g.gid, scoreId: g.gid, title: g.title, intro: g.intro, answers: g.labels,
    next(staff, varie) { return rendre(staff, pick(g.pool), varie); },
    adaptive: { pool: g.pool, element: (raw) => g.element(g.item(raw).label), render: rendre },
    reviser, tonalite: TONALITES_JEU[id],
    good: (l) => `Exact : ${l}.`, bad: (l) => `C'était : ${l}.`,
  });
}

/* ---------- Tonalités ---------- */
function keyGame($view, reviser) {
  const all = [...SHARP_KEYS, ...FLAT_KEYS.slice(1)]; // Do Sol Ré La Mi Si Fa♯ Do♯ puis Fa Si♭ Mi♭ La♭ Ré♭ Sol♭ Do♭ (Do n'apparaît qu'une fois)
  return runQuiz($view, {
    answers: all,
    gid: 'kg', scoreId: 'tonalites', title: 'Jeu des tonalités', intro: "Observe l'armure (les dièses ou les bémols en début de portée) et retrouve la tonalité majeure correspondante.",
    next(staff) {
      const sharp = Math.random() < 0.5, n = Math.floor(Math.random() * 8), label = (sharp ? SHARP_KEYS : FLAT_KEYS)[n];
      // une pause invisible (« gap ») garde la largeur de la portée tout en ne montrant que la clé et l'armure
      show(staff, { clef: 'treble', key: sharp ? n : -n, measures: [[{ gap: true, d: 'whole' }]] }, { staffwidth: 260, play: false });
      return { label, element: elSimple('tonalite', label) };
    },
    good: (l) => `Exact, ${l} majeur.`, bad: (l) => `C'était ${l} majeur.`,
    adaptive: {
      pool: [...SHARP_KEYS.map((label, n) => ({ label, n })), ...FLAT_KEYS.slice(1).map((label, i) => ({ label, n: -(i + 1) }))],
      element: (it) => elSimple('tonalite', it.label),
      render: (staff, it) => { show(staff, { clef: 'treble', key: it.n, measures: [[{ gap: true, d: 'whole' }]] }, { staffwidth: 260, play: false }); return { label: it.label, element: elSimple('tonalite', it.label) }; },
    },
    reviser,
  });
}

/* ---------- Rythme ---------- (horloge audio propre au jeu pour faire entendre le motif ; l'évaluation est dans rythme-eval.js)
   Déroulé : le joueur ÉCOUTE le motif (décompte de 4 temps, puis les notes surlignées), puis le RETAPE de mémoire, à son propre rythme, sans aucun repère
   (ni son, ni métronome, ni décompte : la latence des appareils rend toute référence trompeuse). On compare ensuite la FORME de ce qu'il a tapé (les écarts
   entre ses frappes, de la première à la dernière) à celle du motif, quelle que soit sa vitesse : voir rythme-eval.js.
   Quatre paliers : le motif commence court (4 noires) et s'allonge à mesure que la précision progresse. */
/** Schéma qui superpose le motif et les frappes du joueur remises à l'échelle du motif (commun aux deux jeux de rythme). */
function compareSvg(expected, taps, res) {
  const m = Math.min(taps.length, expected.length), W = 400, x0 = 20, span = W - 2 * x0;
  const exp = expected.map((t) => x0 + ((t - expected[0]) / (expected[expected.length - 1] - expected[0])) * span);
  const usr = taps.slice(0, m).map((t) => x0 + ((t - taps[0]) / Math.max(1e-6, taps[m - 1] - taps[0])) * span);
  const col = (i) => (i === 0 ? 'var(--fg)' : res.intervals[i - 1]?.grade === 'good' ? 'var(--sage)' : res.intervals[i - 1]?.grade === 'mid' ? 'var(--accent-deep)' : 'var(--brick)');
  return `<svg viewBox="0 0 ${W} 84" style="width:100%;max-width:420px;display:block;margin:14px auto 0" role="img" aria-label="Comparaison du motif et de tes frappes">
    <text x="${x0}" y="12" font-size="11" fill="var(--fg-soft)">Motif</text>${exp.map((x) => `<circle cx="${x.toFixed(1)}" cy="28" r="6" fill="var(--fg)"/>`).join('')}
    <text x="${x0}" y="60" font-size="11" fill="var(--fg-soft)">Toi (remis à l'échelle du motif)</text>${usr.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="76" r="6" fill="${col(i)}"/>`).join('')}</svg>`;
}

const LEVELS = [
  { beats: 4, minPairs: 0, maxPairs: 0, label: 'Niveau 1 : 4 temps, des noires' },
  { beats: 4, minPairs: 1, maxPairs: 2, label: 'Niveau 2 : 4 temps, avec des croches (6 notes au plus)' },
  { beats: 6, minPairs: 1, maxPairs: 3, label: 'Niveau 3 : 6 temps (9 notes au plus)' },
  { beats: 8, minPairs: 2, maxPairs: 4, label: 'Niveau 4 : 8 temps (12 notes au plus)' },
];
function rhythmGame($view) {
  let level = 1;
  try { level = Math.min(LEVELS.length, Math.max(1, Number(localStorage.getItem('solfege_rythme_niveau')) || 1)); } catch (e) { /* ignoré */ }
  $view.innerHTML = `
    ${crumb('#/jeux', 'Tous les jeux')}
    <div class="game-shell">
      <div class="section-head"><h2>Rythme à l'oreille</h2></div>
      <p class="game-intro">Écoute le motif (un décompte de 4 temps, puis les notes surlignées), puis retape-le de mémoire, à ton propre rythme, sans repère ni métronome. On compare la forme de ce que tu as tapé, de ta première à ta dernière frappe, à celle du motif, quelle que soit ta vitesse. Appuie sur le pavé (ou la barre espace) à chaque note.</p>
      <div class="game-hud">
        <div class="hud-stat"><b id="rg-level">1</b>niveau</div>
        <div class="hud-stat"><b id="rg-score">—</b>précision</div>
        <div class="hud-stat"><b id="rg-bpm">—</b>ton tempo</div>
      </div>
      <div class="answers" id="rg-levels" role="group" aria-label="Niveau de difficulté">${LEVELS.map((l, i) => `<button class="ans-btn" data-l="${i + 1}" title="${l.label}" aria-pressed="false">Niveau ${i + 1}</button>`).join('')}</div>
      <div class="beat-row" id="rg-beats"></div>
      <button class="tap-pad" id="rg-tap">Écouter le motif</button>
      <div class="hit-row" id="rg-hits"></div>
      <div id="rg-compare" aria-hidden="true"></div>
      <div class="answers" style="margin-top:14px"><button class="ans-btn" id="rg-replay" hidden>Réécouter ce motif</button></div>
      <div class="feedback" id="rg-feedback" role="status" aria-live="polite">&nbsp;</div>
    </div>`;
  const $ = (id) => document.getElementById(id);
  const beatsEl = $('rg-beats'), tapBtn = $('rg-tap'), hitsEl = $('rg-hits'), compareEl = $('rg-compare'), replayBtn = $('rg-replay');
  const feedback = $('rg-feedback'), scoreEl = $('rg-score'), levelEl = $('rg-level'), levelsEl = $('rg-levels'), tempoEl = $('rg-bpm');
  const BPM = 88, beatDur = 60 / BPM;
  let pattern = [], expected = [], taps = [], phase = 'idle', audioCtx = null, timeouts = [], idleTimer = 0, sources = [];

  const setLevel = (l) => {
    level = l; levelEl.textContent = String(l);
    levelsEl.querySelectorAll('.ans-btn').forEach((b) => { const on = Number(b.dataset.l) === l; b.setAttribute('aria-pressed', String(on)); b.style.borderColor = on ? 'var(--accent-deep)' : ''; b.style.fontWeight = on ? '700' : ''; });
    try { localStorage.setItem('solfege_rythme_niveau', String(l)); } catch (e) { /* ignoré */ }
  };
  const later = (fn, ms) => timeouts.push(setTimeout(fn, Math.max(0, ms)));
  const clearAll = () => { timeouts.forEach(clearTimeout); timeouts = []; clearTimeout(idleTimer); sources.forEach((o) => { try { o.stop(); } catch (e) { /* déjà arrêté */ } }); sources = []; };
  const wait = (t) => (t - audioCtx.currentTime) * 1000; // millisecondes jusqu'à l'instant t de l'horloge audio
  const setPad = (text, disabled = false) => { tapBtn.textContent = text; tapBtn.disabled = disabled; };

  function genPattern() {
    const L = LEVELS[level - 1], pairs = L.minPairs + Math.floor(Math.random() * (L.maxPairs - L.minPairs + 1));
    const idx = [...Array(L.beats).keys()].sort(() => Math.random() - 0.5).slice(0, pairs);
    pattern = Array.from({ length: L.beats }, (_, i) => (idx.includes(i) ? 'p' : 'q')); // q : une noire, p : deux croches dans le temps
  }
  function drawPattern() {
    beatsEl.innerHTML = ''; expected = []; let t = 0;
    pattern.forEach((kind) => {
      const div = document.createElement('div'); div.className = 'beat-note';
      div.innerHTML = `<svg viewBox="0 0 20 40"><text x="10" y="30" text-anchor="middle" font-size="26" fill="var(--fg)">${kind === 'p' ? '♫' : '♩'}</text></svg>`;
      beatsEl.appendChild(div); expected.push(t);
      if (kind === 'p') expected.push(t + beatDur / 2);
      t += beatDur;
    });
    hitsEl.innerHTML = expected.map(() => '<div class="hit"></div>').join(''); compareEl.innerHTML = '';
  }
  function beep(time, freq, vol = 0.25) {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, time); gain.gain.exponentialRampToValueAtTime(vol, time + 0.002); gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain); gain.connect(audioCtx.destination); osc.start(time); osc.stop(time + 0.06); sources.push(osc);
  }

  function start(samePattern) {
    clearAll();
    if (!samePattern) genPattern();
    drawPattern();
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    taps = []; replayBtn.hidden = true; feedback.innerHTML = '&nbsp;'; feedback.className = 'feedback';
    // ÉCOUTE : décompte de 4 temps (sons graves), puis le motif (sons aigus) ; les notes se surlignent. Le joueur ne peut pas taper pendant ce temps.
    phase = 'listen'; setPad('Écoute…', true);
    const countStart = audioCtx.currentTime + 0.3, patStart = countStart + 4 * beatDur, listenEnd = patStart + pattern.length * beatDur;
    for (let i = 0; i < 4; i++) beep(countStart + i * beatDur, i === 0 ? 800 : 600, 0.2);
    expected.forEach((t) => beep(patStart + t, 1000));
    pattern.forEach((_, i) => later(() => { const n = beatsEl.children[i]; n.classList.add('active'); setTimeout(() => n.classList.remove('active'), 140); }, wait(patStart + i * beatDur)));
    // FRAPPE LIBRE : aucun son, aucun repère ; la manche se termine quand toutes les notes sont tapées, ou après un temps sans frappe
    later(() => { phase = 'tap'; setPad(`À toi : retape le motif (${expected.length} notes)`, false); }, wait(listenEnd));
  }
  function registerTap(timeStamp) {
    if (phase !== 'tap') return;
    taps.push(timeStamp / 1000);
    const i = taps.length - 1;
    hitsEl.children[Math.min(i, hitsEl.children.length - 1)].classList.add('mid'); // trace de la frappe, sans jugement avant la fin
    hitsEl.children[Math.min(i, hitsEl.children.length - 1)].style.background = 'var(--rule-strong)';
    clearTimeout(idleTimer);
    if (taps.length >= expected.length) { setTimeout(endRound, 250); phase = 'wait'; }
    else idleTimer = setTimeout(endRound, 2600);
  }
  function endRound() {
    clearTimeout(idleTimer);
    if (phase === 'done') return;
    phase = 'done'; setPad('Nouveau motif'); replayBtn.hidden = false;
    const beat = beatDur, res = evaluateRhythm(expected, taps, beat);
    hitsEl.querySelectorAll('.hit').forEach((h, i) => { h.classList.remove('mid'); h.style.background = ''; h.classList.add(i === 0 ? 'good' : res.intervals[i - 1].grade); });
    compareEl.innerHTML = compareSvg(expected, taps, res);
    scoreEl.textContent = res.pct + '%';
    noter({ j: 'rythme', e: elRythme('oreille', level), m: 'O', ok: res.pct >= 70, r: res.pct }); // suivi : précision du motif
    tempoEl.textContent = res.tempo ? Math.round(BPM * res.tempo) : '—';
    const parts = [];
    if (!res.complete) parts.push(`Il manquait ${expected.length - taps.length} frappe${expected.length - taps.length > 1 ? 's' : ''}.`);
    parts.push(res.pct >= 85 ? 'Excellent, le motif est bien reproduit.' : res.pct >= 60 ? "Pas mal, continue à t'entraîner." : 'Compare tes frappes au motif, puis réécoute-le.');
    if (res.regularity != null && res.complete) parts.push(res.regularity < 0.1 ? 'Frappes bien régulières.' : res.regularity < 0.2 ? 'Régularité moyenne.' : 'Frappes irrégulières.');
    if (res.pct >= 85 && level < LEVELS.length) { setLevel(level + 1); parts.push(`Niveau suivant : ${level}.`); }
    feedback.className = 'feedback ' + (res.pct >= 70 ? 'ok' : 'no'); feedback.textContent = parts.join(' ');
    recordScore('rythme', res.pct, 100);
  }
  // Appui sur le pavé : « pointerdown » (au contact, sans attendre le relâchement) pour réduire le retard ; le clic ne sert qu'à lancer un motif ou à la saisie au clavier.
  tapBtn.addEventListener('pointerdown', (e) => { if (phase === 'tap') { e.preventDefault(); registerTap(e.timeStamp); } });
  tapBtn.addEventListener('click', (e) => { if (phase === 'idle' || phase === 'done') start(false); else if (phase === 'tap' && e.detail === 0) registerTap(e.timeStamp); });
  replayBtn.addEventListener('click', () => start(true));
  levelsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.ans-btn'); if (!b || phase === 'listen' || phase === 'tap' || phase === 'wait') return;
    clearAll(); setLevel(Number(b.dataset.l)); genPattern(); drawPattern(); phase = 'idle'; setPad('Écouter le motif'); replayBtn.hidden = true; feedback.innerHTML = '&nbsp;';
  });
  const onSpace = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (phase === 'tap') registerTap(e.timeStamp); else if (phase === 'idle' || phase === 'done') start(false); } };
  window.addEventListener('keydown', onSpace);
  // onglet masqué : la manche en cours est abandonnée (sons programmés arrêtés), le même motif est prêt à être réécouté
  const onPause = () => { if (phase === 'listen' || phase === 'tap' || phase === 'wait') { clearAll(); phase = 'idle'; setPad('Écouter le motif'); replayBtn.hidden = true; taps = []; drawPattern(); feedback.innerHTML = '&nbsp;'; } };
  window.addEventListener('solfege-pause', onPause);
  setLevel(level); genPattern(); drawPattern();
  return () => { window.removeEventListener('solfege-pause', onPause); clearAll(); window.removeEventListener('keydown', onSpace); if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; } }; // quitter la page coupe aussi les sons déjà programmés
}

/* ---------- Rythme à vue ---------- (le motif est écrit en notation, jamais joué avant la frappe : le joueur le lit, puis le tape à son rythme, sans repère)
   Même évaluation que le jeu à l'oreille (forme des écarts entre frappes, vitesse libre : rythme-eval.js). Après la manche, on peut écouter le motif pour comparer. */
const SIGHT_LEVELS = [
  { measures: 1, pool: ['q', 'q', 'h'], label: 'Niveau 1 : une mesure, noires et blanches' },
  { measures: 1, pool: ['q', 'ee', 'h'], label: 'Niveau 2 : une mesure, avec des croches' },
  { measures: 1, pool: ['q', 'ee', 'qr', 'dqe', 'h'], label: 'Niveau 3 : une mesure, avec silences et rythmes pointés' },
  { measures: 2, pool: ['q', 'ee', 'qr', 'dqe', 'ssss', 'h'], label: 'Niveau 4 : deux mesures, avec doubles croches' },
];
// morceaux d'une mesure à 4 temps : longueur en temps, événements de la partition (une note sur le Si 4 : seul le rythme compte), instants des frappes dans le morceau
const NOTE = (d, dots = 0) => ({ n: ['B4'], d, dots });
const PIECES = {
  q: { len: 1, ev: () => [NOTE('quarter')], on: [0] },
  h: { len: 2, ev: () => [NOTE('half')], on: [0] },
  ee: { len: 1, ev: () => [NOTE('eighth'), NOTE('eighth')], on: [0, 0.5] },
  qr: { len: 1, ev: () => [{ rest: true, d: 'quarter', dots: 0 }], on: [] },
  dqe: { len: 3, ev: () => [NOTE('quarter', 1), NOTE('eighth'), NOTE('quarter')], on: [0, 1.5, 2] }, // noire pointée + croche + noire : 3 temps
  ssss: { len: 1, ev: () => [NOTE('sixteenth'), NOTE('sixteenth'), NOTE('sixteenth'), NOTE('sixteenth')], on: [0, 0.25, 0.5, 0.75] },
};
/** Un motif au hasard : { desc (partition), expected (instants des frappes, en temps), measures }. Au moins 3 notes à taper (5 pour deux mesures). */
export function sightPattern(levelIndex, rnd = Math.random) {
  const L = SIGHT_LEVELS[levelIndex], names = [...new Set(L.pool)];
  for (let essai = 0; essai < 200; essai++) {
    const measures = []; const expected = []; let t = 0;
    for (let m = 0; m < L.measures; m++) {
      const events = []; let left = 4;
      while (left > 0) {
        const ok = names.filter((k) => PIECES[k].len <= left), k = ok[Math.floor(rnd() * ok.length)], pc = PIECES[k];
        events.push(...pc.ev()); pc.on.forEach((o) => expected.push(t + (4 - left) + o)); left -= pc.len;
      }
      measures.push(events); t += 4;
    }
    if (expected.length >= (L.measures === 1 ? 3 : 5)) return { desc: { clef: 'treble', key: 0, time: [4, 4], bpm: 88, scale: 1.15, measures }, expected, measures: L.measures };
  }
  throw new Error('Aucun motif trouvé');
}

function rhythmSightGame($view) {
  let level = 1;
  try { level = Math.min(SIGHT_LEVELS.length, Math.max(1, Number(localStorage.getItem('solfege_rythme_vue_niveau')) || 1)); } catch (e) { /* ignoré */ }
  $view.innerHTML = `
    ${crumb('#/jeux', 'Tous les jeux')}
    <div class="game-shell">
      <div class="section-head"><h2>Rythme à vue</h2></div>
      <p class="game-intro">Lis le rythme écrit, puis tape-le à ton rythme, sans l'entendre avant : commence quand tu veux, sans repère ni métronome. On compare la forme de ce que tu as tapé (les durées les unes par rapport aux autres), pas la vitesse. Un silence se « tape » en n'appuyant pas. Après la manche, tu peux écouter le motif.</p>
      <div class="game-hud">
        <div class="hud-stat"><b id="rv-level">1</b>niveau</div>
        <div class="hud-stat"><b id="rv-score">—</b>précision</div>
        <div class="hud-stat"><b id="rv-bpm">—</b>ton tempo</div>
      </div>
      <div class="answers" id="rv-levels" role="group" aria-label="Niveau de difficulté">${SIGHT_LEVELS.map((l, i) => `<button class="ans-btn" data-l="${i + 1}" title="${l.label}" aria-pressed="false">Niveau ${i + 1}</button>`).join('')}</div>
      <div class="staff-box"><div class="abc-notation" id="rv-score-host"></div></div>
      <button class="tap-pad" id="rv-tap">Tape le rythme (6 notes)</button>
      <div class="hit-row" id="rv-hits"></div>
      <div id="rv-compare" aria-hidden="true"></div>
      <div class="answers" style="margin-top:14px"><button class="ans-btn" id="rv-listen" hidden>▶ Écouter le motif</button></div>
      <div class="feedback" id="rv-feedback" role="status" aria-live="polite">&nbsp;</div>
    </div>`;
  configurePlayer({ sounds: new URLSearchParams(location.search).get('sounds') || undefined, onStatus: () => {} });
  const $ = (id) => document.getElementById(id);
  const tapBtn = $('rv-tap'), hitsEl = $('rv-hits'), compareEl = $('rv-compare'), listenBtn = $('rv-listen'), feedback = $('rv-feedback'), scoreEl = $('rv-score'), levelEl = $('rv-level'), levelsEl = $('rv-levels'), tempoEl = $('rv-bpm'), host = $('rv-score-host');
  let cur = null, taps = [], phase = 'tap', idleTimer = 0;

  const setLevel = (l) => {
    level = l; levelEl.textContent = String(l);
    levelsEl.querySelectorAll('.ans-btn').forEach((b) => { const on = Number(b.dataset.l) === l; b.setAttribute('aria-pressed', String(on)); b.style.borderColor = on ? 'var(--accent-deep)' : ''; b.style.fontWeight = on ? '700' : ''; });
    try { localStorage.setItem('solfege_rythme_vue_niveau', String(l)); } catch (e) { /* ignoré */ }
  };
  function newPattern() {
    stopAll(); clearTimeout(idleTimer);
    cur = sightPattern(level - 1); taps = []; phase = 'tap';
    const w = Math.min(520, Math.max(240, ($view.clientWidth || 360) - 40));
    mountScore(host, { ...cur.desc, width: w }, { ink: 'currentColor', label: 'Rythme à taper', withPlay: false });
    hitsEl.innerHTML = cur.expected.map(() => '<div class="hit"></div>').join(''); compareEl.innerHTML = '';
    listenBtn.hidden = true; feedback.innerHTML = '&nbsp;'; feedback.className = 'feedback';
    tapBtn.textContent = `Tape le rythme (${cur.expected.length} notes)`; tapBtn.disabled = false;
  }
  // temps d'attente avant de conclure une manche : assez long pour un silence ou une blanche, même si le joueur tape lentement
  function patience() {
    const m = taps.length, exp = cur.expected; let longest = 1; for (let i = 1; i < exp.length; i++) longest = Math.max(longest, exp[i] - exp[i - 1]);
    const perBeat = m >= 2 ? (taps[m - 1] - taps[0]) / Math.max(1e-6, exp[m - 1] - exp[0]) : 1.5;
    return Math.max(2600, longest * perBeat * 1000 * 1.8);
  }
  function registerTap(timeStamp) {
    if (phase !== 'tap') return;
    taps.push(timeStamp / 1000);
    const i = Math.min(taps.length - 1, hitsEl.children.length - 1);
    hitsEl.children[i].classList.add('mid'); hitsEl.children[i].style.background = 'var(--rule-strong)';
    clearTimeout(idleTimer);
    if (taps.length >= cur.expected.length) { phase = 'wait'; idleTimer = setTimeout(endRound, 250); }
    else idleTimer = setTimeout(endRound, patience());
  }
  function endRound() {
    clearTimeout(idleTimer);
    if (phase === 'done') return;
    phase = 'done'; tapBtn.textContent = 'Nouveau motif'; listenBtn.hidden = false;
    const expected = cur.expected, res = evaluateRhythm(expected, taps, 1);
    hitsEl.querySelectorAll('.hit').forEach((h, i) => { h.classList.remove('mid'); h.style.background = ''; h.classList.add(i === 0 ? 'good' : res.intervals[i - 1].grade); });
    compareEl.innerHTML = compareSvg(expected, taps, res);
    scoreEl.textContent = res.pct + '%';
    noter({ j: 'rythme-vue', e: elRythme('vue', level), m: 'L', ok: res.pct >= 70, r: res.pct });
    tempoEl.textContent = res.tempo ? Math.round(60 * res.tempo) : '—'; // frappes par minute au rythme du joueur : un temps = une noire
    const parts = [];
    if (!res.complete) parts.push(`Il manquait ${expected.length - taps.length} frappe${expected.length - taps.length > 1 ? 's' : ''}.`);
    parts.push(res.pct >= 85 ? 'Excellent, le rythme est bien lu.' : res.pct >= 60 ? "Pas mal, continue à t'entraîner." : 'Compare tes frappes au motif, puis écoute-le.');
    if (res.regularity != null && res.complete) parts.push(res.regularity < 0.1 ? 'Frappes bien régulières.' : res.regularity < 0.2 ? 'Régularité moyenne.' : 'Frappes irrégulières.');
    if (res.pct >= 85 && level < SIGHT_LEVELS.length) { setLevel(level + 1); parts.push(`Niveau suivant : ${level}.`); }
    feedback.className = 'feedback ' + (res.pct >= 70 ? 'ok' : 'no'); feedback.textContent = parts.join(' ');
    recordScore('rythme-vue', res.pct, 100);
  }
  tapBtn.addEventListener('pointerdown', (e) => { if (phase === 'tap') { e.preventDefault(); registerTap(e.timeStamp); } });
  tapBtn.addEventListener('click', (e) => { if (phase === 'done') newPattern(); else if (phase === 'tap' && e.detail === 0) registerTap(e.timeStamp); });
  listenBtn.addEventListener('click', () => { import('../music/player.js').then((m) => m.play({ ...cur.desc, width: undefined }, { button: listenBtn, host })); });
  levelsEl.addEventListener('click', (e) => { const b = e.target.closest('.ans-btn'); if (!b || phase === 'wait') return; setLevel(Number(b.dataset.l)); newPattern(); });
  const onSpace = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (phase === 'tap') registerTap(e.timeStamp); else if (phase === 'done') newPattern(); } };
  window.addEventListener('keydown', onSpace);
  const onPause = () => { if (phase === 'tap' || phase === 'wait') newPattern(); }; // onglet masqué : manche abandonnée, nouveau motif
  window.addEventListener('solfege-pause', onPause);
  setLevel(level); newPattern();
  return () => { window.removeEventListener('solfege-pause', onPause); clearTimeout(idleTimer); stopAll(); window.removeEventListener('keydown', onSpace); };
}

export function renderJeu($view, id, reviser = false) {
  if (id === 'clef-sol') return noteGame($view, 'treble', reviser);
  if (id === 'clef-fa') return noteGame($view, 'bass', reviser);
  if (id === 'rythme') return rhythmGame($view);
  if (id === 'rythme-vue') return rhythmSightGame($view);
  if (id === 'tonalites') return keyGame($view, reviser);
  if (poolGames[id]) return poolGame($view, id, reviser);
  $view.innerHTML = '<p>Jeu introuvable.</p>'; return null;
}
