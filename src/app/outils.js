// Les 3 outils (métronome, accordeur, piano virtuel), repris de l'application actuelle sans changement de fonctionnement :
// ils n'utilisent pas de partition ; leur son est produit directement par l'API audio du navigateur (aucun délai de chargement).
import { autoCorrelate, freqToNote } from './micro.js';
import { FR_NOTE } from './jeux-donnees.js';

const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;

/* ---------- Métronome ---------- */
function renderMetronome($view) {
  $view.innerHTML = `
    ${crumb('#/outils', 'Outils')}
    <div class="section-head"><h2>Métronome</h2></div>
    <div class="tool-shell">
      <div class="bpm-label">Tempo</div>
      <div class="bpm-display" id="bpm-val">100</div>
      <div class="bpm-label">battements / minute</div>
      <input type="range" min="40" max="220" value="100" id="bpm-range" aria-label="Tempo en battements par minute">
      <div class="pendulum-wrap"><div class="pendulum-dot" id="pendulum"></div></div>
      <div class="time-sig-row" id="sig-row"></div>
      <div class="tool-row">
        <button class="btn btn-accent" id="play-btn">▶ Démarrer</button>
        <button class="btn btn-ghost" id="tap-btn">Tap tempo</button>
      </div>
    </div>`;
  const sigs = [2, 3, 4, 6];
  const sigRow = document.getElementById('sig-row');
  let beatsPerMeasure = 4;
  sigRow.innerHTML = sigs.map((n) => `<button class="chip ${n === 4 ? 'active' : ''}" data-n="${n}">${n}/4</button>`).join('');
  sigRow.querySelectorAll('.chip').forEach((btn) => btn.addEventListener('click', () => {
    sigRow.querySelectorAll('.chip').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active'); beatsPerMeasure = parseInt(btn.dataset.n, 10);
  }));
  const bpmRange = document.getElementById('bpm-range'), bpmVal = document.getElementById('bpm-val'), playBtn = document.getElementById('play-btn'), pendulum = document.getElementById('pendulum');
  let bpm = 100, playing = false, audioCtx = null, nextNoteTime = 0, beatCount = 0, timerId = null;
  bpmRange.addEventListener('input', () => { bpm = parseInt(bpmRange.value, 10); bpmVal.textContent = bpm; });

  function click(time, accent) {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = accent ? 1400 : 900;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(time); osc.stop(time + 0.07);
  }
  function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + 0.12) {
      const accent = beatCount % beatsPerMeasure === 0;
      click(nextNoteTime, accent);
      const t = nextNoteTime, acc = accent;
      const delay = Math.max(0, (t - audioCtx.currentTime) * 1000);
      setTimeout(() => { pendulum.style.transform = 'scale(' + (acc ? 1.5 : 1.15) + ')'; setTimeout(() => { pendulum.style.transform = 'scale(1)'; }, 90); }, delay);
      nextNoteTime += 60 / bpm;
      beatCount++;
    }
    timerId = setTimeout(scheduler, 25);
  }
  playBtn.addEventListener('click', () => {
    playing = !playing;
    if (playing) {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      beatCount = 0; nextNoteTime = audioCtx.currentTime + 0.05;
      scheduler();
      playBtn.textContent = '■ Arrêter';
    } else { clearTimeout(timerId); playBtn.textContent = '▶ Démarrer'; }
  });
  const tapBtn = document.getElementById('tap-btn');
  let taps = [];
  tapBtn.addEventListener('click', () => {
    const now = performance.now();
    taps = taps.filter((t) => now - t < 2200);
    taps.push(now);
    if (taps.length >= 2) {
      const intervals = []; for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      bpm = Math.max(40, Math.min(220, Math.round(60000 / avg)));
      bpmRange.value = bpm; bpmVal.textContent = bpm;
    }
  });
  const onPause = () => { if (playing) { playing = false; clearTimeout(timerId); playBtn.textContent = '▶ Démarrer'; } }; // onglet masqué : le métronome s'arrête
  window.addEventListener('solfege-pause', onPause);
  return () => { window.removeEventListener('solfege-pause', onPause); clearTimeout(timerId); if (audioCtx) audioCtx.close(); };
}

/* ---------- Accordeur ---------- */
function renderTuner($view) {
  $view.innerHTML = `
    ${crumb('#/outils', 'Outils')}
    <div class="section-head"><h2>Accordeur</h2></div>
    <div class="tool-shell">
      <p>Autorisez le micro puis jouez ou chantez une note tenue : le nom le plus proche et l'écart en centièmes de ton s'affichent en direct.</p>
      <div class="tuner-note" id="t-note" role="status" aria-live="polite">—</div>
      <div class="tuner-cents" id="t-cents">en attente du micro…</div>
      <div class="tuner-bar-wrap"><div class="tuner-bar-mid"></div><div class="tuner-needle" id="t-needle"></div></div>
      <div class="tool-row"><button class="btn btn-accent" id="mic-btn">🎤 Activer le micro</button></div>
    </div>`;
  const noteEl = document.getElementById('t-note'), centsEl = document.getElementById('t-cents'), needle = document.getElementById('t-needle'), micBtn = document.getElementById('mic-btn');
  let audioCtx = null, analyser = null, stream = null, rafId = null;
  function loop() {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const freq = autoCorrelate(buf, audioCtx.sampleRate);
    if (freq > 0 && freq < 2000) {
      const { name, octave, cents } = freqToNote(freq);
      noteEl.textContent = name + octave;
      centsEl.textContent = (cents > 0 ? '+' : '') + cents + ' cents · ' + freq.toFixed(1) + ' Hz';
      const pct = Math.max(-50, Math.min(50, cents));
      needle.style.left = (50 + pct) + '%';
      needle.style.background = Math.abs(cents) <= 5 ? 'var(--sage)' : (Math.abs(cents) <= 15 ? 'var(--accent-deep)' : 'var(--brick)');
    }
    rafId = requestAnimationFrame(loop);
  }
  micBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      micBtn.style.display = 'none';
      centsEl.textContent = 'écoute en cours…';
      loop();
    } catch (e) { centsEl.textContent = 'Micro inaccessible — vérifiez les autorisations de votre navigateur.'; }
  });
  const release = () => { if (rafId) cancelAnimationFrame(rafId); rafId = null; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; if (audioCtx) audioCtx.close(); audioCtx = null; analyser = null; };
  // onglet masqué : le micro est coupé (vie privée, batterie) ; on le réactive d'un appui
  const onPause = () => { if (!stream) return; release(); micBtn.style.display = ''; micBtn.textContent = '🎤 Réactiver le micro'; centsEl.textContent = 'micro coupé (page masquée)'; noteEl.textContent = '—'; };
  window.addEventListener('solfege-pause', onPause);
  return () => { window.removeEventListener('solfege-pause', onPause); release(); };
}

/* ---------- Piano virtuel ---------- */
function renderPiano($view) {
  $view.innerHTML = `
    ${crumb('#/outils', 'Outils')}
    <div class="section-head"><h2>Piano virtuel</h2></div>
    <div class="tool-shell">
      <p>Cliquez, touchez, ou jouez au clavier : <b>A S D F G H J</b> pour les touches blanches, <b>W E T Y U</b> pour les noires.</p>
      <div class="tool-row">
        <button class="btn btn-ghost" id="oct-down">Octave −</button>
        <span class="bpm-label" style="align-self:center;" id="oct-label">Octave 4</span>
        <button class="btn btn-ghost" id="oct-up">Octave +</button>
      </div>
    </div>
    <div class="piano-wrap" id="piano-wrap"><div class="piano" id="piano"></div></div>`;
  const whiteSeq = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const blackAfter = { C: 'C♯', D: 'D♯', F: 'F♯', G: 'G♯', A: 'A♯' };
  const keyMapWhite = { a: 'C', s: 'D', d: 'E', f: 'F', g: 'G', h: 'A', j: 'B' };
  const keyMapBlack = { w: 'C', e: 'D', t: 'F', y: 'G', u: 'A' };
  const WHITE_W = 46, SIDE_MARGIN = 16;
  let octave = null;
  const pianoEl = document.getElementById('piano'), pianoWrap = document.getElementById('piano-wrap'), octLabel = document.getElementById('oct-label');
  let audioCtx = null;
  function ensureCtx() { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); return audioCtx; }
  function freqOf(letter, oct, sharp) { const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter] + (sharp ? 1 : 0); return 440 * Math.pow(2, ((oct + 1) * 12 + semis - 69) / 12); }
  function play(letter, oct, sharp, el) {
    const ctx = ensureCtx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = freqOf(letter, oct, sharp);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.4, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(now); osc.stop(now + 1.15);
    if (el) { el.classList.add('active'); setTimeout(() => el.classList.remove('active'), 160); }
  }
  function buildKeyboard() {
    // le clavier occupe toute la largeur de la fenêtre : il sort de la mise en page centrée
    pianoWrap.style.marginLeft = '0px'; pianoWrap.style.width = 'auto';
    const viewW = document.documentElement.clientWidth, left = pianoWrap.getBoundingClientRect().left;
    pianoWrap.style.marginLeft = (-left) + 'px'; pianoWrap.style.width = viewW + 'px';
    const avail = Math.max(WHITE_W * 7, viewW - 2 * SIDE_MARGIN), whiteCount = Math.max(7, Math.floor(avail / WHITE_W));
    pianoEl.style.setProperty('--wk', (avail / whiteCount) + 'px');
    const octSpan = Math.ceil(whiteCount / 7), maxStart = Math.max(1, 8 - octSpan);
    if (octave === null) octave = Math.max(1, Math.min(maxStart, 4 - Math.floor(octSpan / 2)));
    octave = Math.max(1, Math.min(maxStart, octave));
    pianoEl.innerHTML = '';
    for (let i = 0; i < whiteCount; i++) {
      const letter = whiteSeq[i % 7], oct = octave + Math.floor(i / 7);
      const w = document.createElement('div');
      w.className = 'pkey white'; w.dataset.letter = letter; w.dataset.oct = oct;
      w.innerHTML = `<span class="lbl">${FR_NOTE[letter]}</span>`;
      w.addEventListener('pointerdown', () => play(letter, oct, false, w));
      pianoEl.appendChild(w);
      if (blackAfter[letter] && i < whiteCount - 1) { // pas de touche noire après la dernière touche blanche
        const b = document.createElement('div');
        b.className = 'pkey black'; b.dataset.letter = letter; b.dataset.oct = oct;
        b.addEventListener('pointerdown', (e) => { e.stopPropagation(); play(letter, oct, true, b); });
        pianoEl.appendChild(b);
      }
    }
    const lastOct = octave + Math.floor((whiteCount - 1) / 7);
    octLabel.textContent = lastOct > octave ? ('Octaves ' + octave + ' – ' + lastOct) : ('Octave ' + octave);
  }
  buildKeyboard();
  document.getElementById('oct-up').addEventListener('click', () => { octave += 1; buildKeyboard(); });
  document.getElementById('oct-down').addEventListener('click', () => { octave -= 1; buildKeyboard(); });
  function onKey(e) { const k = e.key.toLowerCase(); if (keyMapWhite[k]) play(keyMapWhite[k], octave, false); else if (keyMapBlack[k]) play(keyMapBlack[k], octave, true); }
  window.addEventListener('keydown', onKey);
  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(buildKeyboard, 150); };
  window.addEventListener('resize', onResize);
  return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); clearTimeout(resizeTimer); if (audioCtx) audioCtx.close(); };
}

export function renderOutil($view, id) {
  if (id === 'metronome') return renderMetronome($view);
  if (id === 'accordeur') return renderTuner($view);
  if (id === 'piano') return renderPiano($view);
  $view.innerHTML = '<p>Outil introuvable.</p>'; return null;
}
