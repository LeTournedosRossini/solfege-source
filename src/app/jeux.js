// Les 8 jeux de lecture, repris de l'application actuelle : mêmes règles, mêmes réservoirs de questions, mêmes textes (feedback neutre, comme décidé dans le cahier des charges).
// Les partitions sont dessinées et jouées par le moteur de Scorsaire ; le jeu de rythme garde sa propre horloge audio (précision des frappes).
import { mountScore, configurePlayer, stopAll } from '../music/player.js';
import { CATALOGUE } from './data/catalogue.js';
import { evaluateRhythm } from './rythme-eval.js';
import { FR_NOTE, TREBLE_POOL, BASS_POOL, INTERVAL_START, INTERVAL_POOL, CHORD_LABELS, CHORD_POOL, DURATION_POOL, DURATION_NOTE, DEGREE_POOL, SHARP_KEYS, FLAT_KEYS } from './jeux-donnees.js';

const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;
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
function quizShell($view, { gid, title, intro }) {
  $view.innerHTML = `
    ${crumb('#/jeux', 'Tous les jeux')}
    <div class="game-shell">
      <div class="section-head"><h2>${title}</h2></div>
      ${intro ? `<p class="game-intro">${intro}</p>` : ''}
      <div class="game-hud">
        <div class="hud-stat"><b id="${gid}-score">0</b>score</div>
        <div class="hud-stat"><b id="${gid}-total">0</b>essais</div>
      </div>
      <div class="staff-box"><div class="abc-notation" id="${gid}-staff"></div></div>
      <div class="answers" id="${gid}-answers"></div>
      <div class="feedback" id="${gid}-feedback" role="status" aria-live="polite">&nbsp;</div>
    </div>`;
  configurePlayer({ sounds: new URLSearchParams(location.search).get('sounds') || undefined, onStatus: () => {} });
  return { staff: document.getElementById(`${gid}-staff`), answers: document.getElementById(`${gid}-answers`), feedback: document.getElementById(`${gid}-feedback`), scoreEl: document.getElementById(`${gid}-score`), totalEl: document.getElementById(`${gid}-total`) };
}

/** Moteur commun : `answers` = les boutons de réponse, TOUJOURS les mêmes et dans le même ordre (le joueur prend le réflexe d'appuyer au bon endroit) ;
 *  `next(staff)` prépare une question et renvoie { label } ; `good(label)` / `bad(label)` donnent le texte de retour. */
function runQuiz($view, { gid, scoreId, title, intro, answers, next, good, bad, delay = 900 }) {
  const ui = quizShell($view, { gid, title, intro });
  ui.answers.innerHTML = answers.map((k) => `<button class="ans-btn" data-k="${k}">${k}</button>`).join('');
  let score = 0, total = 0, current = null, active = true, timer = 0;
  function round() {
    current = next(ui.staff);
    ui.answers.querySelectorAll('.ans-btn').forEach((b) => b.classList.remove('correct', 'wrong'));
    ui.feedback.innerHTML = '&nbsp;'; ui.feedback.className = 'feedback'; active = true;
  }
  ui.answers.addEventListener('click', (e) => {
    const btn = e.target.closest('.ans-btn'); if (!btn || !active) return;
    active = false; total++; ui.totalEl.textContent = total;
    if (btn.dataset.k === current.label) { score++; ui.scoreEl.textContent = score; btn.classList.add('correct'); ui.feedback.textContent = good(current.label); ui.feedback.className = 'feedback ok'; }
    else { btn.classList.add('wrong'); ui.answers.querySelectorAll('.ans-btn').forEach((b) => { if (b.dataset.k === current.label) b.classList.add('correct'); }); ui.feedback.textContent = bad(current.label); ui.feedback.className = 'feedback no'; }
    recordScore(scoreId ?? gid, score, total);
    timer = setTimeout(round, delay);
  });
  round();
  return () => { clearTimeout(timer); stopAll(); };
}

/* ---------- Lecture de notes (clé de Sol, clé de Fa) ---------- */
function noteGame($view, clef) {
  const pool = clef === 'treble' ? TREBLE_POOL : BASS_POOL;
  const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((l) => FR_NOTE[l]); // Do Ré Mi Fa Sol La Si, toujours dans cet ordre
  return runQuiz($view, {
    answers: names,
    gid: 'ng', scoreId: clef === 'treble' ? 'clef-sol' : 'clef-fa', title: clef === 'treble' ? 'Lecture de notes — Clé de Sol' : 'Lecture de notes — Clé de Fa',
    next(staff) { const n = pick(pool); show(staff, { clef, measures: [[whole([n])]] }, { staffwidth: 260 }); return { label: FR_NOTE[n[0]] }; },
    good: (l) => `Exact : ${l}.`, bad: (l) => `C'était ${l}.`, delay: 750,
  });
}

/* ---------- Jeux à réservoir : intervalles, accords, durées et silences, degrés ---------- */
const poolGames = {
  intervalles: { gid: 'ig', title: 'Jeu des intervalles', intro: "Do est toujours la première note. Identifie l'intervalle qui la sépare de la seconde note affichée.",
    labels: [...new Set(INTERVAL_POOL.map((p) => p.label))], staffwidth: 260, bpm: 260,
    item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[whole([INTERVAL_START]), whole([it.note])]] } }), pool: INTERVAL_POOL },
  accords: { gid: 'ag', title: 'Jeu des accords', intro: "Observe les notes empilées sur la portée et identifie la nature de l'accord.",
    labels: CHORD_LABELS, staffwidth: 220, bpm: 120,
    item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[whole(it.notes)]] } }), pool: CHORD_POOL },
  'durees-silences': { gid: 'dg', title: 'Jeu des durées et silences', intro: "Une figure de note ou un silence s'affiche : retrouve son nom. (Un silence... ne joue rien : c'est normal !)",
    labels: [...new Set(DURATION_POOL.map((p) => p.label))], staffwidth: 150, scale: 1.2, bpm: 150,
    item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[it.rest ? { rest: true, d: it.d } : { n: [DURATION_NOTE], d: it.d }]] } }), pool: DURATION_POOL },
  degres: { gid: 'gg', title: 'Jeu des degrés', intro: 'Toujours en Do majeur : quelle est la fonction (le degré) de la note affichée ?',
    labels: DEGREE_POOL.map((p) => p.label), staffwidth: 200, bpm: 200,
    item: (it) => ({ label: it.label, desc: { clef: 'treble', measures: [[whole([it.note])]] } }), pool: DEGREE_POOL },
};
function poolGame($view, id) {
  const g = poolGames[id];
  return runQuiz($view, {
    gid: g.gid, scoreId: g.gid, title: g.title, intro: g.intro, answers: g.labels,
    next(staff) { const it = g.item(pick(g.pool)); show(staff, { ...it.desc, bpm: g.bpm }, { staffwidth: g.staffwidth, scale: g.scale ?? 1.15 }); return { label: it.label }; },
    good: (l) => `Exact : ${l}.`, bad: (l) => `C'était : ${l}.`,
  });
}

/* ---------- Tonalités ---------- */
function keyGame($view) {
  const all = [...SHARP_KEYS, ...FLAT_KEYS.slice(1)]; // Do Sol Ré La Mi Si Fa♯ Do♯ puis Fa Si♭ Mi♭ La♭ Ré♭ Sol♭ Do♭ (Do n'apparaît qu'une fois)
  return runQuiz($view, {
    answers: all,
    gid: 'kg', scoreId: 'tonalites', title: 'Jeu des tonalités', intro: "Observe l'armure (les dièses ou les bémols en début de portée) et retrouve la tonalité majeure correspondante.",
    next(staff) {
      const sharp = Math.random() < 0.5, n = Math.floor(Math.random() * 8), label = (sharp ? SHARP_KEYS : FLAT_KEYS)[n];
      // une pause invisible (« gap ») garde la largeur de la portée tout en ne montrant que la clé et l'armure
      show(staff, { clef: 'treble', key: sharp ? n : -n, measures: [[{ gap: true, d: 'whole' }]] }, { staffwidth: 260, play: false });
      return { label };
    },
    good: (l) => `Exact, ${l} majeur.`, bad: (l) => `C'était ${l} majeur.`,
  });
}

/* ---------- Rythme ---------- (horloge audio propre au jeu pour faire entendre le motif ; l'évaluation est dans rythme-eval.js)
   Déroulé : le joueur ÉCOUTE le motif (décompte de 4 temps, puis les notes surlignées), puis le RETAPE de mémoire, à son propre rythme, sans aucun repère
   (ni son, ni métronome, ni décompte : la latence des appareils rend toute référence trompeuse). On compare ensuite la FORME de ce qu'il a tapé (les écarts
   entre ses frappes, de la première à la dernière) à celle du motif, quelle que soit sa vitesse : voir rythme-eval.js.
   Quatre paliers : le motif commence court (4 noires) et s'allonge à mesure que la précision progresse. */
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
      <div class="section-head"><h2>Jeu de rythme</h2></div>
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
  let pattern = [], expected = [], taps = [], phase = 'idle', audioCtx = null, timeouts = [], idleTimer = 0;

  const setLevel = (l) => {
    level = l; levelEl.textContent = String(l);
    levelsEl.querySelectorAll('.ans-btn').forEach((b) => { const on = Number(b.dataset.l) === l; b.setAttribute('aria-pressed', String(on)); b.style.borderColor = on ? 'var(--accent-deep)' : ''; b.style.fontWeight = on ? '700' : ''; });
    try { localStorage.setItem('solfege_rythme_niveau', String(l)); } catch (e) { /* ignoré */ }
  };
  const later = (fn, ms) => timeouts.push(setTimeout(fn, Math.max(0, ms)));
  const clearAll = () => { timeouts.forEach(clearTimeout); timeouts = []; clearTimeout(idleTimer); };
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
    osc.connect(gain); gain.connect(audioCtx.destination); osc.start(time); osc.stop(time + 0.06);
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
  function compareSvg(res) {
    const m = Math.min(taps.length, expected.length), W = 400, x0 = 20, span = W - 2 * x0;
    const exp = expected.map((t) => x0 + (t / expected[expected.length - 1]) * span);
    const usr = taps.slice(0, m).map((t) => x0 + ((t - taps[0]) / Math.max(1e-6, taps[m - 1] - taps[0])) * span);
    const col = (i) => (i === 0 ? 'var(--fg)' : res.intervals[i - 1]?.grade === 'good' ? 'var(--sage)' : res.intervals[i - 1]?.grade === 'mid' ? 'var(--accent-deep)' : 'var(--brick)');
    return `<svg viewBox="0 0 ${W} 84" style="width:100%;max-width:420px;display:block;margin:14px auto 0" role="img" aria-label="Comparaison du motif et de tes frappes">
      <text x="${x0}" y="12" font-size="11" fill="var(--fg-soft)">Motif</text>${exp.map((x) => `<circle cx="${x.toFixed(1)}" cy="28" r="6" fill="var(--fg)"/>`).join('')}
      <text x="${x0}" y="60" font-size="11" fill="var(--fg-soft)">Toi (remis à l'échelle du motif)</text>${usr.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="76" r="6" fill="${col(i)}"/>`).join('')}</svg>`;
  }
  function endRound() {
    clearTimeout(idleTimer);
    if (phase === 'done') return;
    phase = 'done'; setPad('Nouveau motif'); replayBtn.hidden = false;
    const beat = beatDur, res = evaluateRhythm(expected, taps, beat);
    hitsEl.querySelectorAll('.hit').forEach((h, i) => { h.classList.remove('mid'); h.style.background = ''; h.classList.add(i === 0 ? 'good' : res.intervals[i - 1].grade); });
    compareEl.innerHTML = compareSvg(res);
    scoreEl.textContent = res.pct + '%';
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
  setLevel(level); genPattern(); drawPattern();
  return () => { clearAll(); window.removeEventListener('keydown', onSpace); };
}

export function renderJeu($view, id) {
  if (id === 'clef-sol') return noteGame($view, 'treble');
  if (id === 'clef-fa') return noteGame($view, 'bass');
  if (id === 'rythme') return rhythmGame($view);
  if (id === 'tonalites') return keyGame($view);
  if (poolGames[id]) return poolGame($view, id);
  $view.innerHTML = '<p>Jeu introuvable.</p>'; return null;
}
