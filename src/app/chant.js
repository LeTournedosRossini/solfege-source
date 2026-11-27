// « Chante la note » (CON-05) : une note s'affiche sur la portée ; l'élève la chante ou la joue, le micro reconnaît la hauteur (sans tenir compte de l'octave, pour toutes les voix).
// Aucun son n'est enregistré : l'analyse est faite en direct et le micro se coupe quand on quitte la page ou qu'elle est masquée. Réponse suivie comme une lecture de note (élément « chant:<note> »).
import { mountScore, play, stopAll, configurePlayer } from '../music/player.js';
import { noter } from './suivi-local.js';
import { ouvrirMicro, ecartClasse, freqToNote } from './micro.js';

const crumb = (href, label) => `<a class="crumb" href="${href}">← ${label}</a>`;
const FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const ANG = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Notes du niveau, comme numéros MIDI (octave 4). */
export const NIVEAUX_CHANT = {
  1: { label: 'Niveau 1 : Do, Mi, Sol', midis: [60, 64, 67] },
  2: { label: 'Niveau 2 : les sept notes de la gamme de Do', midis: [60, 62, 64, 65, 67, 69, 71] },
  3: { label: 'Niveau 3 : avec les altérations', midis: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71] },
};
export const nomMidi = (m) => `${ANG[m % 12]}${Math.floor(m / 12) - 1}`;
export const NOM_FR = (m) => FR[m % 12];
const TOLERANCE = 0.35;       // en demi-tons : 35 centièmes
const IMAGES_STABLES = 22;    // ≈ 0,4 s de son juste, presque ininterrompu, pour valider

export function renderChant($view) {
  const gid = 'chg', cleNiv = 'solfege_niveau_chant-note';
  let niveau = 1; try { const v = parseInt(localStorage.getItem(cleNiv), 10); if (v >= 1 && v <= 3) niveau = v; } catch (e) { /* ignoré */ }
  const rq = new URLSearchParams((location.hash.split('?')[1]) || '');
  if (['1', '2', '3'].includes(rq.get('niveau'))) niveau = Number(rq.get('niveau'));
  const imposee = /^[A-G]#?\d$/.test(rq.get('note') || '') ? rq.get('note') : null;   // lien d'un enseignant : « chante cette note »
  const midiImpose = imposee ? (Number(imposee.slice(-1)) + 1) * 12 + ANG.indexOf(imposee.slice(0, -1)) : null;
  $view.innerHTML = `
    ${crumb('#/jeux', 'Tous les jeux')}
    <div class="game-shell">
      <div class="section-head"><h2>Chante la note</h2></div>
      <p class="game-intro">Une note est écrite sur la portée : chante-la ou joue-la sur ton instrument. Le micro reconnaît la note, peu importe l’octave. Ton son n’est ni enregistré ni envoyé : il est analysé en direct.</p>
      <div class="mode-choix" id="${gid}-niveau" role="group" aria-label="Niveau de difficulté" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px">${[1, 2, 3].map((n) => `<button type="button" class="chip" data-niveau="${n}" aria-pressed="false">${NIVEAUX_CHANT[n].label}</button>`).join('')}</div>
      <div class="game-hud"><div class="hud-stat"><b id="${gid}-score">0</b>réussies</div><div class="hud-stat"><b id="${gid}-total">0</b>notes</div></div>
      <div class="staff-box"><div class="abc-notation" id="${gid}-staff"></div></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin:12px 0"><button type="button" class="btn btn-accent" id="${gid}-micro">🎤 Activer le micro</button><button type="button" class="btn" id="${gid}-ecouter">▶ Écouter la note</button><button type="button" class="btn" id="${gid}-passer">Je n’y arrive pas</button></div>
      <div class="chant-ecoute" id="${gid}-ecoute" role="status" aria-live="polite" style="min-height:3.2em"><span id="${gid}-etat">Active le micro, puis chante ou joue la note écrite.</span></div>
      <div class="feedback" id="${gid}-feedback" role="status" aria-live="polite">&nbsp;</div>
    </div>`;
  configurePlayer({ sounds: new URLSearchParams(location.search).get('sounds') || undefined, onStatus: () => {} });
  const $ = (s) => document.getElementById(`${gid}-${s}`);
  let micro = null, raf = 0, cible = null, stables = 0, trous = 0, actif = false, score = 0, total = 0, timer = 0;
  const majNiveau = () => $('niveau').querySelectorAll('.chip').forEach((b) => { const on = Number(b.dataset.niveau) === niveau; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('active', on); });
  function nouvelle() {
    clearTimeout(timer); document.getElementById(`${gid}-ok`)?.remove(); stopAll();
    const liste = NIVEAUX_CHANT[niveau].midis; let m = midiImpose ?? liste[Math.floor(Math.random() * liste.length)];
    if (midiImpose === null && cible !== null && liste.length > 1) while (m === cible) m = liste[Math.floor(Math.random() * liste.length)];
    cible = m; stables = 0; trous = 0; actif = true;
    mountScore($('staff'), { clef: 'treble', key: 0, time: null, bpm: 80, scale: 1.3, width: 200, measures: [[{ n: [nomMidi(m)], d: 'whole', dots: 0 }]] }, { ink: 'currentColor', label: 'Note à chanter', withPlay: false });
    $('feedback').innerHTML = '&nbsp;'; $('feedback').className = 'feedback';
    $('etat').textContent = micro ? 'Je t’écoute : chante ou joue la note écrite.' : 'Active le micro, puis chante ou joue la note écrite.';
  }
  function boucle() {
    if (!micro) return;
    const f = micro.lire();
    if (actif && f > 0) {
      const { name, octave } = freqToNote(f), ecart = ecartClasse(f, cible);
      $('etat').textContent = `Je t’entends : ${name}${octave}` + (Math.abs(ecart) <= TOLERANCE ? ' — c’est juste, tiens la note…' : Math.abs(ecart) > 1.2 ? ' — ce n’est pas la note demandée' : ecart > 0 ? ' — un peu trop haut' : ' — un peu trop bas');
      if (Math.abs(ecart) <= TOLERANCE) { stables++; trous = 0; } else { trous++; if (trous > 4) stables = Math.max(0, stables - 1); }
      if (stables >= IMAGES_STABLES) return reussi();
    } else if (actif) { trous++; if (trous > 6 && stables > 0) stables = Math.max(0, stables - 1); if (stables === 0) $('etat').textContent = 'Je t’écoute : chante ou joue la note écrite.'; }
    raf = requestAnimationFrame(boucle);
  }
  function reussi() {
    actif = false; total++; score++; $('total').textContent = total; $('score').textContent = score;
    noter({ j: 'chant-note', e: `chant:${ANG[cible % 12]}`, m: 'L', ok: true });
    $('feedback').textContent = `Bravo : c’est bien ${NOM_FR(cible)} !`; $('feedback').className = 'feedback ok';
    timer = setTimeout(() => { nouvelle(); if (micro) raf = requestAnimationFrame(boucle); }, 1400);
  }
  async function activer() {
    try { micro = await ouvrirMicro(); } catch (e) { $('etat').textContent = 'Micro inaccessible : vérifie les autorisations de ton navigateur, puis réessaie.'; return; }
    $('micro').hidden = true; $('etat').textContent = 'Je t’écoute : chante ou joue la note écrite.'; raf = requestAnimationFrame(boucle);
  }
  function couper() { cancelAnimationFrame(raf); raf = 0; if (micro) { micro.fermer(); micro = null; } }
  $('micro').addEventListener('click', activer);
  $('ecouter').addEventListener('click', () => { if (cible !== null) play({ clef: 'treble', key: 0, time: null, bpm: 60, measures: [[{ n: [nomMidi(cible)], d: 'half', dots: 0 }]] }, { button: $('ecouter') }); });
  $('passer').addEventListener('click', () => {
    if (!actif) return;
    actif = false; total++; $('total').textContent = total; noter({ j: 'chant-note', e: `chant:${ANG[cible % 12]}`, m: 'L', ok: false });
    $('feedback').textContent = `C’était ${NOM_FR(cible)}. Écoute-la, puis essaie de la chanter après avoir cliqué sur « OK ».`; $('feedback').className = 'feedback no';
    const ok = document.createElement('button'); ok.type = 'button'; ok.id = `${gid}-ok`; ok.className = 'btn btn-accent'; ok.textContent = 'OK, note suivante'; ok.style.marginTop = '10px';
    ok.addEventListener('click', () => { nouvelle(); if (micro && !raf) raf = requestAnimationFrame(boucle); }); $('feedback').after(ok); ok.focus();
  });
  $('niveau').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; niveau = Number(b.dataset.niveau); try { localStorage.setItem(cleNiv, String(niveau)); } catch (er) { /* ignoré */ } majNiveau(); nouvelle(); if (micro && !raf) raf = requestAnimationFrame(boucle); });
  const surPause = () => { if (!micro) return; couper(); $('micro').hidden = false; $('micro').textContent = '🎤 Réactiver le micro'; $('etat').textContent = 'Micro coupé (page masquée).'; };
  window.addEventListener('solfege-pause', surPause);
  majNiveau(); nouvelle();
  return () => { window.removeEventListener('solfege-pause', surPause); clearTimeout(timer); couper(); stopAll(); };
}
