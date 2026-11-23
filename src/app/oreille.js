// Module d'oreille (lot 6) : intervalles, gammes et arpèges, phrases du répertoire. Même organisation et mêmes réglages que l'ancien module ;
// les partitions et le son viennent du moteur de Scorsaire. Il vit dans un « shadow DOM » : sa feuille de style (reprise de l'ancien module) n'agit pas sur le reste de l'application.
import STYLE from './oreille-style.txt';
import PHRASES from './data/phrases.json';
import { play, stopAll, configurePlayer } from '../music/player.js';
import { renderDesc } from '../music/describe.js';
import * as T from './oreille-theorie.js';
import { lireDocumentScorsaire } from './oreille-import.js';
import { SOUNDS_URL } from '../music/player.js';

const MIDI_MIN = 36, MIDI_MAX = 96; // Do2 → Do7
const LETTERS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const midiLabel = (m) => LETTERS[m % 12] + (Math.floor(m / 12) - 1);
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const IMPORT_KEY = 'solfege_oreille_import';
const GENRES = [{ key: 'classique', label: 'Classique' }, { key: 'moderne', label: 'Actuelle' }, { key: 'importe', label: 'Mes phrases' }];

const HTML = `
<div class="ear" id="ear" data-theme="dark"><div class="app">
  <div class="top-bar"><div class="header"><h1>Jeu d’oreille</h1><p>Reconnaissance d’intervalles, de gammes et de phrases</p>
    <div class="engine-badge" id="engineBadge" role="status"><span class="dot"></span><span id="engineLabel">Son prêt</span></div></div></div>
  <div class="tabs" id="tabs" role="tablist">
    <button class="tab-btn active" data-tab="interval" role="tab">Intervalle</button>
    <button class="tab-btn" data-tab="phrase" role="tab">Gamme / Arpège</button>
    <button class="tab-btn" data-tab="works" role="tab">Phrase</button>
  </div>

  <div class="tab-panel active" id="panelInterval">
    <div class="subtabs2" id="intervalSubtabs"><button class="subtab2-btn active" data-sub="ecoute">Écoute</button><button class="subtab2-btn" data-sub="ident">Identification</button></div>
    <div class="subpanel active" id="intervalEcoutePanel">
      <div class="panel"><div class="panel-label">Intervalle à explorer</div>
        <div class="inline-picker-row" id="ecFamilyCol"></div><div class="inline-picker-row" id="ecQualityCol"></div></div>
      <div class="panel"><div class="panel-label">Mode d’écoute</div>
        <div class="mode-group" id="ecModeGroup" style="margin-top:8px;">
          <button class="mode-btn active" data-mode="montant">↑ Montant</button><button class="mode-btn" data-mode="descendant">↓ Descendant</button><button class="mode-btn" data-mode="simultane">⇅ Simultané</button></div></div>
      <div class="panel"><div class="phrase-title" id="ecTitle"></div>
        <div class="score-host" id="ecStaffWrap"></div><button class="abc-play-btn" id="ecPlay" type="button">▶ Écouter</button>
        <div class="keyboard-container" id="keyboardInterval" style="margin-top:8px;"></div></div>
    </div>
    <div class="subpanel" id="intervalIdentPanel">
      <div class="panel"><div class="panel-header"><div class="panel-label">Mode d’écoute</div>
        <button class="hamburger-btn" id="hamburgerBtn" title="Paramètres" aria-label="Ouvrir les paramètres"><span></span><span></span><span></span></button></div>
        <div class="mode-group" id="modeGroup">
          <button class="mode-btn active" data-mode="montant"><span>↑</span> Montant</button><button class="mode-btn" data-mode="descendant"><span>↓</span> Descendant</button><button class="mode-btn" data-mode="simultane"><span>⇅</span> Simultané</button>
          <button class="reset-inline-btn" id="resetBtn">↺ Score</button></div></div>
      <div class="panel play-wrap play-panel"><button class="play-btn" id="playBtn" aria-label="Écouter l’intervalle"><span class="note-icon">♪</span></button><div class="play-label">Écouter</div>
        <div class="score-area"><span>Correct :</span><span class="score-val" id="scoreVal">0 / 0</span><span class="score-pct" id="scorePct"></span></div><div class="feedback" id="feedback" role="status"></div></div>
      <div class="panel" style="padding:20px 16px;"><div class="panel-label">Quel est cet intervalle ?</div><div class="answers-grid" id="answersGrid"></div></div>
      <div class="keyboard-container" id="keyboardIntervalIdent"></div>
    </div>
  </div>

  <div class="tab-panel" id="panelPhrase">
    <div class="subtabs2" id="gaSubtabs"><button class="subtab2-btn active" data-sub="ecoute">Écoute</button><button class="subtab2-btn" data-sub="ident">Identification</button></div>
    <div class="subpanel active" id="gaEcoutePanel">
      <div class="picker-row"><button class="phrase-picker-btn" id="phrasePickerBtn" style="flex:1;">🎵 Choisir une gamme / un arpège…</button>
        <button class="hamburger-btn" id="phraseSettingsBtn" title="Réglages" aria-label="Réglages"><span></span><span></span><span></span></button></div>
      <div class="mode-group" id="phraseDirGroup" style="margin-top:8px;"><button class="mode-btn active" data-dir="asc">↑ Ascendant</button><button class="mode-btn" data-dir="desc">↓ Descendant</button></div>
      <div class="panel" id="phrasePlayerPanel" style="display:none;"><div class="phrase-title" id="phraseTitle"></div>
        <div class="score-host" id="staffWrap"></div><button class="abc-play-btn" id="gaPlay" type="button">▶ Écouter</button>
        <div class="keyboard-container" id="keyboardGA" style="margin-top:8px;"></div>
        <div class="setting-block" style="margin-top:10px;"><label for="phraseSpeedRangeA">Vitesse : <strong id="phraseSpeedValA">0 %</strong></label>
          <input type="range" id="phraseSpeedRangeA" min="-50" max="50" step="5" value="0" class="gap-slider speed-slider"></div>
        <button class="mini-btn" id="randomRootBtn" style="margin-top:10px; padding:10px;">🎲 Autre fondamentale (aléatoire)</button></div>
    </div>
    <div class="subpanel" id="gaIdentPanel">
      <div class="panel"><div class="panel-header"><div class="panel-label">Identification — gamme ou accord</div>
        <button class="hamburger-btn" id="gaIdentSettingsBtn" title="Réglages" aria-label="Réglages"><span></span><span></span><span></span></button></div>
        <div class="mode-group" id="gaModeGroup"><button class="mode-btn active" data-mode="montant">↑ Montant</button><button class="mode-btn" data-mode="descendant">↓ Descendant</button><button class="mode-btn" data-mode="simultane">⇅ Simultané</button>
          <button class="reset-inline-btn" id="gaResetBtn">↺ Score</button></div></div>
      <div class="panel play-wrap play-panel"><button class="play-btn" id="gaPlayBtn" aria-label="Écouter la gamme ou l’accord"><span class="note-icon">♪</span></button><div class="play-label">Écouter</div>
        <div class="score-area"><span>Correct :</span><span class="score-val" id="gaScoreVal">0 / 0</span><span class="score-pct" id="gaScorePct"></span></div><div class="feedback" id="gaFeedback" role="status"></div></div>
      <div class="panel" style="padding:20px 16px;"><div class="panel-label">Quelle gamme ou quel accord ?</div><div class="answers-grid" id="gaAnswersGrid"></div></div>
      <div class="keyboard-container" id="keyboardGAIdent"></div>
    </div>
  </div>

  <div class="tab-panel" id="panelWorks">
    <div class="subtabs2" id="worksSubtabs"><button class="subtab2-btn active" data-sub="ecoute">Écoute</button><button class="subtab2-btn" data-sub="ident">Identification</button></div>
    <div class="subpanel active" id="worksEcoutePanel">
      <div class="picker-row"><button class="phrase-picker-btn" id="worksPickerBtn" style="flex:1;">🎵 Choisir une phrase…</button>
        <button class="hamburger-btn" id="createBtn" title="Créer une phrase" aria-label="Créer une phrase">➕</button>
        <button class="hamburger-btn" id="importBtn" title="Importer un document Scorsaire" aria-label="Importer un document Scorsaire">📥</button>
        <input type="file" id="importFile" accept=".scorsaire,.json,application/json" hidden></div>
      <div class="import-note" id="importNote" role="status"></div>
      <div class="panel" id="worksPlayerPanel" style="display:none;"><div class="phrase-title" id="worksTitle"></div>
        <div class="score-host" id="worksStaffWrap"></div><button class="abc-play-btn" id="worksPlay" type="button">▶ Écouter</button>
        <div class="keyboard-container" id="keyboardWorks" style="margin-top:8px;"></div>
        <div class="setting-block" style="margin-top:10px;"><label for="phraseSpeedRangeB">Vitesse : <strong id="phraseSpeedValB">0 %</strong></label>
          <input type="range" id="phraseSpeedRangeB" min="-50" max="50" step="5" value="0" class="gap-slider speed-slider"></div></div>
    </div>
    <div class="subpanel" id="worksIdentPanel">
      <div class="panel"><div class="panel-header"><div class="panel-label">Identification — phrase mélodique</div>
        <button class="hamburger-btn" id="wkIdentSettingsBtn" title="Réglages" aria-label="Réglages"><span></span><span></span><span></span></button></div>
        <button class="reset-inline-btn" id="wkResetBtn" style="width:100%;">↺ Réinitialiser le score</button></div>
      <div class="panel play-wrap play-panel"><button class="play-btn" id="wkPlayBtn" aria-label="Écouter la phrase"><span class="note-icon">♪</span></button><div class="play-label">Écouter</div>
        <div class="score-area"><span>Correct :</span><span class="score-val" id="wkScoreVal">0 / 0</span><span class="score-pct" id="wkScorePct"></span></div><div class="feedback" id="wkFeedback" role="status"></div></div>
      <div class="panel" style="padding:20px 16px;"><div class="panel-label">Quelle est cette phrase ?</div><div class="answers-grid" id="wkAnswersGrid" style="grid-template-columns:1fr;"></div></div>
      <div class="keyboard-container" id="keyboardWorksIdent"></div>
    </div>
  </div>
</div>

<div class="drawer-overlay" id="nameSheetOverlay"><div class="drawer" id="nameSheet" role="dialog" aria-label="Nom de la phrase">
  <div class="drawer-handle"></div><div class="drawer-head"><h2>Enregistrer la phrase</h2><button class="drawer-close" data-close aria-label="Fermer">✕</button></div>
  <div class="drawer-body"><div class="setting-block"><label class="drawer-section-title" for="nameInput">Nom de la phrase</label><input type="text" class="name-input" id="nameInput" maxlength="80" autocomplete="off"></div>
    <div class="import-note" id="nameNote" role="status"></div><button class="mini-btn" id="nameSave" style="padding:12px; font-weight:600; border-color:var(--gold); color:var(--gold);">✓ Enregistrer dans « Mes phrases »</button></div></div></div>
<div class="drawer-overlay" id="worksSheetOverlay"><div class="drawer" id="worksSheet" style="max-height:75vh;" role="dialog" aria-label="Choisir une phrase">
  <div class="drawer-handle"></div><div class="drawer-head"><h2>Choisir une phrase</h2><button class="drawer-close" data-close aria-label="Fermer">✕</button></div>
  <div class="drawer-body" style="gap:10px;"><div class="tabs" id="worksGenreTabs"></div><div id="worksList" style="display:flex; flex-direction:column; gap:8px;"></div></div></div></div>
<div class="drawer-overlay" id="phraseSheetOverlay"><div class="drawer" id="phraseSheet" role="dialog" aria-label="Choisir une gamme ou un arpège">
  <div class="drawer-handle"></div><div class="drawer-head"><h2>Choisir une gamme / un arpège</h2><button class="drawer-close" data-close aria-label="Fermer">✕</button></div>
  <div class="drawer-body"><div class="drawer-columns-wrap"><div class="drawer-columns" id="phraseColumns"><div class="family-col" id="rootCol"></div><div class="quality-col" id="qualityColPhrase"></div><div class="family-col" id="dirCol"></div></div></div>
    <button class="mini-btn" id="generatePhraseBtn" style="padding:12px; font-size:0.82rem; font-weight:600; border-color:var(--gold); color:var(--gold);">Afficher la gamme / l’arpège</button></div></div></div>
<div class="drawer-overlay" id="phraseSettingsOverlay"><div class="drawer" id="phraseSettingsSheet" role="dialog" aria-label="Réglages gamme et arpège">
  <div class="drawer-handle"></div><div class="drawer-head"><h2>Réglages</h2><button class="drawer-close" data-close aria-label="Fermer">✕</button></div>
  <div class="drawer-body"><div class="setting-block"><div class="drawer-section-title">Amplitude (fondamentale aléatoire)</div>
    <div class="amplitude-row"><label for="phraseNoteMin">Note la plus basse</label><select class="note-select" id="phraseNoteMin"></select></div>
    <div class="amplitude-row"><label for="phraseNoteMax">Note la plus haute</label><select class="note-select" id="phraseNoteMax"></select></div>
    <div class="amplitude-warning" id="phraseAmpWarning">Aucune fondamentale valide dans cette plage pour la gamme/l’accord choisi.</div></div>
    <div class="setting-block"><div class="drawer-section-title">Qualités actives (identification)</div><div class="inline-picker-row" id="gaQualityPool"></div></div>
    <div class="setting-block"><label for="phraseSpeedRangeC">Vitesse de lecture : <strong id="phraseSpeedValC">0 %</strong></label><input type="range" id="phraseSpeedRangeC" min="-50" max="50" step="5" value="0" class="gap-slider speed-slider"></div></div></div></div>
<div class="drawer-overlay" id="wkIdentSettingsOverlay"><div class="drawer" id="wkIdentSettingsSheet" role="dialog" aria-label="Réglages du questionnaire">
  <div class="drawer-handle"></div><div class="drawer-head"><h2>Réglages du QCM</h2><button class="drawer-close" data-close aria-label="Fermer">✕</button></div>
  <div class="drawer-body"><div class="setting-block"><div class="drawer-section-title">Nombre de choix proposés</div><label for="wkChoiceRange">Choix : <strong id="wkChoiceVal">8</strong></label>
    <input type="range" id="wkChoiceRange" min="4" max="16" step="2" value="8" class="gap-slider"></div>
    <div class="setting-block"><div class="drawer-section-title">Répertoire interrogé</div><div class="tabs" id="wkFilterTabs" style="border-bottom:none; flex-wrap:wrap;"></div></div></div></div></div>
<div class="drawer-overlay" id="drawerOverlay"><div class="drawer" id="drawer" role="dialog" aria-label="Paramètres des intervalles">
  <div class="drawer-handle"></div><div class="drawer-head"><h2>Paramètres</h2><button class="drawer-close" data-close aria-label="Fermer">✕</button></div>
  <div class="drawer-body"><div class="select-all-row"><button class="mini-btn" id="selectAllBtn">Tout sélectionner</button><button class="mini-btn" id="selectNoneBtn">Tout désélectionner</button></div>
    <div class="drawer-columns-wrap"><div class="drawer-columns"><div class="family-col" id="familyCol"></div><div class="quality-col" id="qualityCol"></div>
      <div class="settings-col">
        <div class="setting-block"><div class="drawer-section-title">Délai entre les notes</div><label for="gapRange">Temps entre les deux notes : <strong id="gapVal">0.90 s</strong></label>
          <input type="range" id="gapRange" min="0.1" max="2.0" step="0.05" value="0.90" class="gap-slider"></div>
        <div class="setting-block"><div class="drawer-section-title">Avant la question suivante</div><label for="nextDelayRange">Pause après bonne réponse : <strong id="nextDelayVal">0.80 s</strong></label>
          <input type="range" id="nextDelayRange" min="0.2" max="3.0" step="0.1" value="0.80" class="gap-slider"></div>
        <div class="setting-block"><div class="drawer-section-title">Amplitude</div>
          <div class="amplitude-row"><label for="noteMin">Note la plus basse</label><select class="note-select" id="noteMin"></select></div>
          <div class="amplitude-row"><label for="noteMax">Note la plus haute</label><select class="note-select" id="noteMax"></select></div>
          <div class="amplitude-warning" id="ampWarning">La plage est trop étroite pour certains intervalles sélectionnés.</div></div>
      </div></div></div></div></div></div>`;

export function renderOreille($view) {
  const host = document.createElement('div');
  $view.classList.add('compact'); // moins de marge en haut : plus de place pour la partition et le clavier
  $view.innerHTML = '<p class="crumb-row"><a class="crumb" href="#/">← Accueil</a></p>';
  $view.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>${HTML}`;
  const $ = (id) => root.getElementById(id);
  const earEl = $('ear');
  const disposers = [];

  /* ---------- thème : celui de l'application ---------- */
  const redraws = [];
  const resolveTheme = () => document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const applyTheme = () => { earEl.dataset.theme = resolveTheme(); redraws.forEach((f) => f()); };
  const mo = new MutationObserver(applyTheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', applyTheme);
  disposers.push(() => { mo.disconnect(); mq.removeEventListener('change', applyTheme); });
  earEl.dataset.theme = resolveTheme();
  const ink = () => getComputedStyle(earEl).getPropertyValue('--text').trim() || '#000';

  /* ---------- son ---------- */
  const badge = $('engineBadge'), badgeLabel = $('engineLabel');
  configurePlayer({
    sounds: new URLSearchParams(location.search).get('sounds') || undefined,
    onStatus: (t) => {
      if (/SoundFont indisponible|moteur léger/.test(t)) { badge.className = 'engine-badge synth'; badgeLabel.textContent = 'Moteur léger'; }
      else if (/SoundFont/.test(t)) { badge.className = 'engine-badge fluid'; badgeLabel.textContent = 'SoundFont'; }
    },
  });
  disposers.push(() => { stopAll(); });
  const speak = (desc, opts) => play(desc, opts).catch(() => {});
  const pulse = (btn) => { btn.classList.remove('playing'); void btn.offsetWidth; btn.classList.add('playing'); };

  /* ---------- état partagé ---------- */
  let activeIntervals = new Set([3, 4]), displayedFamilyKey = 'tierce';
  let rangeMin = 48, rangeMax = 72;
  const activeModes = new Set(['montant']);
  let noteGap = 0.9, nextDelay = 0.8, speedPct = 0;
  let phraseRangeMin = 48, phraseRangeMax = 84;
  const pickMode = () => { const a = [...activeModes]; return a[randInt(0, a.length - 1)]; };
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  disposers.push(() => timers.forEach(clearTimeout));

  /* ---------- partition + bouton ▶ ---------- */
  function draw(hostEl, desc, width = 300) {
    hostEl.innerHTML = renderDesc(desc, { width, ink: ink() });
    const svg = hostEl.querySelector('svg'); if (svg) svg.style.setProperty('--w', `${svg.getAttribute('width')}px`);
  }
  const hostWidth = (el) => Math.max(200, Math.min(520, (el.clientWidth || 320) - 8));

  /* ---------- clavier de piano ---------- */
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const KB = (() => { const keys = []; let wx = 0, last = 0; for (let m = MIDI_MIN; m <= MIDI_MAX; m++) { if (!BLACK.has(m % 12)) { keys.push({ midi: m, x: wx, w: 48, black: false }); last = wx; wx += 48; } else keys.push({ midi: m, x: last + 48 - 15, w: 30, black: true }); } return { keys, total: wx }; })();
  function playKey(midi, el) {
    speak({ clef: 'treble', time: null, bpm: 80, measures: [[{ n: [T.midiName(midi, true)], d: 'quarter' }]] });
    el.classList.add('playing'); later(() => el.classList.remove('playing'), 220);
  }
  function piano(container, onTranspose) {
    container.innerHTML = `<div class="kb-nav"><button class="kb-nav-btn" data-dir="-1" aria-label="Reculer">‹</button><div class="kb-scroll" tabindex="0" aria-label="Clavier de piano"><div class="kb-inner" style="width:${KB.total}px;"><div class="kb-buttons"></div><div class="kb-keys"></div></div></div><button class="kb-nav-btn" data-dir="1" aria-label="Avancer">›</button></div>`;
    const scroll = container.querySelector('.kb-scroll'), buttons = container.querySelector('.kb-buttons'), keysRow = container.querySelector('.kb-keys');
    let first = null;
    for (const black of [false, true]) KB.keys.filter((k) => k.black === black).forEach((k) => {
      const el = document.createElement('div'); el.className = black ? 'pkey-black' : 'pkey-white'; el.style.left = `${k.x}px`; el.style.width = `${k.w}px`;
      el.setAttribute('role', 'button'); el.setAttribute('tabindex', '-1'); el.setAttribute('aria-label', midiLabel(k.midi)); el.addEventListener('click', () => playKey(k.midi, el)); keysRow.append(el);
    });
    const btnBy = {};
    KB.keys.forEach((k) => {
      const b = document.createElement('button'); b.className = 'kb-play-btn'; b.style.left = `${k.x + k.w / 2}px`; b.textContent = '♪'; b.setAttribute('aria-label', `Jouer en partant de ${midiLabel(k.midi)}`);
      b.addEventListener('click', () => { if (first != null) onTranspose(k.midi - first); });
      buttons.append(b); btnBy[k.midi] = b;
    });
    container.querySelectorAll('.kb-nav-btn').forEach((b) => b.addEventListener('click', () => scroll.scrollBy({ left: Number(b.dataset.dir) * 144, behavior: 'smooth' })));
    scroll.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { scroll.scrollBy({ left: -96, behavior: 'smooth' }); e.preventDefault(); } if (e.key === 'ArrowRight') { scroll.scrollBy({ left: 96, behavior: 'smooth' }); e.preventDefault(); } });
    const center = (midi) => { const k = KB.keys.find((x) => x.midi === midi); if (k) scroll.scrollLeft = Math.max(0, k.x + k.w / 2 - scroll.clientWidth / 2); };
    return {
      setPhrase(firstMidi) { first = firstMidi; buttons.style.display = ''; keysRow.querySelectorAll('.kb-marker').forEach((m) => m.remove()); Object.values(btnBy).forEach((b) => b.classList.remove('origin')); btnBy[firstMidi]?.classList.add('origin'); center(firstMidi); },
      setIdentMarker(midi) { first = null; buttons.style.display = 'none'; Object.values(btnBy).forEach((b) => b.classList.remove('origin')); keysRow.querySelectorAll('.kb-marker').forEach((m) => m.remove()); const k = KB.keys.find((x) => x.midi === midi); if (k) { const m = document.createElement('div'); m.className = 'kb-marker'; m.style.left = `${k.x + k.w / 2}px`; keysRow.append(m); center(midi); } },
    };
  }

  /* ---------- briques d'interface ---------- */
  const sheet = (ovId, shId) => { const ov = $(ovId), sh = $(shId); return { ov, open() { ov.classList.add('open'); sh.classList.add('open'); ov.querySelector('[data-close]')?.focus(); }, close() { ov.classList.remove('open'); sh.classList.remove('open'); } }; };
  const sDrawer = sheet('drawerOverlay', 'drawer'), sPhrase = sheet('phraseSheetOverlay', 'phraseSheet'), sPhraseSet = sheet('phraseSettingsOverlay', 'phraseSettingsSheet'), sWorks = sheet('worksSheetOverlay', 'worksSheet'), sWk = sheet('wkIdentSettingsOverlay', 'wkIdentSettingsSheet'), sName = sheet('nameSheetOverlay', 'nameSheet');
  const sheets = [sDrawer, sPhrase, sPhraseSet, sWorks, sWk, sName];
  sheets.forEach((s) => { s.ov.addEventListener('click', (e) => { if (e.target === s.ov || e.target.closest('[data-close]')) s.close(); }); });
  const onKey = (e) => { if (e.key === 'Escape') sheets.forEach((s) => s.close()); };
  document.addEventListener('keydown', onKey); disposers.push(() => document.removeEventListener('keydown', onKey));

  const renderPicker = (container, items, selected, onPick) => {
    container.innerHTML = '';
    items.forEach((item) => { const b = document.createElement('button'); b.className = 'family-btn' + (item === selected ? ' active' : ''); b.textContent = item.label || item.name; b.setAttribute('aria-pressed', item === selected); b.onclick = () => onPick(item); container.append(b); });
  };
  const slider = (input, label, fmt, min, max, set) => { const upd = (v) => { set(parseFloat(v)); label.textContent = fmt(parseFloat(v)); const p = ((v - min) / (max - min) * 100).toFixed(1); input.style.background = `linear-gradient(to right, var(--gold) 0%, var(--gold) ${p}%, var(--border) ${p}%, var(--border) 100%)`; }; input.addEventListener('input', (e) => upd(e.target.value)); upd(input.value); return upd; };
  const modeToggle = (group) => group.addEventListener('click', (e) => {
    const b = e.target.closest('.mode-btn'); if (!b) return; const m = b.dataset.mode;
    if (activeModes.has(m) && activeModes.size === 1) return;
    if (activeModes.has(m)) activeModes.delete(m); else activeModes.add(m);
    ['ecModeGroup', 'modeGroup', 'gaModeGroup'].forEach((g) => $(g).querySelectorAll('.mode-btn').forEach((x) => { x.classList.toggle('active', activeModes.has(x.dataset.mode)); x.setAttribute('aria-pressed', activeModes.has(x.dataset.mode)); }));
  });
  ['ecModeGroup', 'modeGroup', 'gaModeGroup'].forEach((g) => { modeToggle($(g)); $(g).querySelectorAll('.mode-btn').forEach((x) => x.setAttribute('aria-pressed', activeModes.has(x.dataset.mode))); });

  // onglets
  root.querySelectorAll('#tabs .tab-btn').forEach((btn) => btn.addEventListener('click', () => {
    const map = { interval: 'panelInterval', phrase: 'panelPhrase', works: 'panelWorks' };
    root.querySelectorAll('#tabs .tab-btn').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    root.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true'); $(map[btn.dataset.tab]).classList.add('active');
    stopAll(); redraws.forEach((f) => f());
  }));
  const subtabs = (barId, mapping) => { const bar = $(barId); bar.querySelectorAll('.subtab2-btn').forEach((btn) => btn.addEventListener('click', () => {
    bar.querySelectorAll('.subtab2-btn').forEach((b) => b.classList.remove('active')); btn.classList.add('active');
    Object.values(mapping).forEach((id) => $(id).classList.remove('active')); $(mapping[btn.dataset.sub]).classList.add('active'); stopAll(); redraws.forEach((f) => f());
  })); };
  subtabs('intervalSubtabs', { ecoute: 'intervalEcoutePanel', ident: 'intervalIdentPanel' });
  subtabs('gaSubtabs', { ecoute: 'gaEcoutePanel', ident: 'gaIdentPanel' });
  subtabs('worksSubtabs', { ecoute: 'worksEcoutePanel', ident: 'worksIdentPanel' });

  const fillSelect = (sel, v) => { sel.innerHTML = ''; for (let m = MIDI_MIN; m <= MIDI_MAX; m++) { const o = document.createElement('option'); o.value = m; o.textContent = midiLabel(m); sel.append(o); } sel.value = v; };
  const bindScore = (ids) => { const st = { ok: 0, total: 0 }; return { st, update() { $(ids.val).textContent = `${st.ok} / ${st.total}`; $(ids.pct).textContent = st.total ? `${Math.round(st.ok / st.total * 100)} %` : ''; }, reset() { st.ok = st.total = 0; this.update(); } }; };
  const feedbackFor = (id) => { let t = 0; return { show(msg, type) { clearTimeout(t); const el = $(id); el.textContent = msg; el.className = `feedback visible ${type}`; }, clear() { $(id).className = 'feedback'; }, later(fn, ms) { clearTimeout(t); t = later(fn, ms); }, soon(fn, ms) { t = later(fn, ms); } }; };

  /* ======================= INTERVALLE — ÉCOUTE ======================= */
  let ecFam = 'tierce', ecIdx = 0, ecDesc = null, ecMode = 'montant';
  const ecF = () => T.FAMILIES.find((f) => f.key === ecFam), ecQ = () => ecF().qualities[ecIdx];
  const ivOf = (semi) => T.ALL_INTERVALS.find((i) => i.semitones === semi);
  const kbEc = piano($('keyboardInterval'), (off) => ecDesc && speak({ ...ecDesc, transpose: off }, { host: $('ecStaffWrap') }));
  function ecDraw(mode = ecMode) {
    ecMode = mode;
    const fam = ecF(), q = ecQ();
    $('ecTitle').textContent = `${fam.label} — ${q.qualityLabel}`;
    ecDesc = T.sequenceDesc(T.intervalNames(60, ivOf(q.semitones)), { mode, noteSec: noteGap, long: true, width: hostWidth($('ecStaffWrap')) });
    draw($('ecStaffWrap'), ecDesc, ecDesc.width); kbEc.setPhrase(60);
  }
  function ecPickers() {
    renderPicker($('ecFamilyCol'), T.FAMILIES, ecF(), (f) => { ecFam = f.key; ecIdx = 0; ecPickers(); ecDraw(); });
    renderPicker($('ecQualityCol'), ecF().qualities.map((q) => ({ ...q, label: q.qualityLabel })), { ...ecQ(), label: ecQ().qualityLabel }, () => {});
    // sélection par indice (les objets recréés ne se comparent pas)
    [...$('ecQualityCol').children].forEach((b, i) => { b.classList.toggle('active', i === ecIdx); b.setAttribute('aria-pressed', i === ecIdx); b.onclick = () => { ecIdx = i; ecPickers(); ecDraw(); }; });
  }
  $('ecPlay').onclick = () => { ecDraw(pickMode()); pulse($('ecPlay')); speak(ecDesc, { button: $('ecPlay'), host: $('ecStaffWrap') }); };
  redraws.push(() => { if ($('intervalEcoutePanel').classList.contains('active') && $('panelInterval').classList.contains('active')) ecDraw(); });

  /* ======================= INTERVALLE — IDENTIFICATION ======================= */
  const kbIv = piano($('keyboardIntervalIdent'), () => {});
  const ivScore = bindScore({ val: 'scoreVal', pct: 'scorePct' }), ivFb = feedbackFor('feedback');
  let ivCur = null, ivAnswered = false;
  const ivHas = (fam) => fam.qualities.some((q) => activeIntervals.has(q.semitones));
  function ivSync() { $('answersGrid').querySelectorAll('.ans-btn').forEach((b) => b.classList.toggle('inactive', !activeIntervals.has(Number(b.dataset.semitones)))); }
  function ivAmp() {
    const lo = Number($('noteMin').value), hi = Number($('noteMax').value), w = $('ampWarning');
    if (lo >= hi) { w.classList.add('visible'); w.textContent = 'La note basse doit être inférieure à la note haute.'; return false; }
    if (![...activeIntervals].some((s) => lo + s <= hi)) { w.classList.add('visible'); w.textContent = 'La plage est trop étroite pour les intervalles sélectionnés.'; return false; }
    w.classList.remove('visible'); return true;
  }
  function ivBuildAnswers() {
    const g = $('answersGrid'); g.innerHTML = '';
    T.ALL_INTERVALS.forEach((iv) => { const b = document.createElement('button'); b.className = 'ans-btn'; b.dataset.semitones = iv.semitones; b.innerHTML = `${iv.name}<span class="semitones">${iv.short}</span>`; b.onclick = () => ivAnswer(iv.semitones, b); g.append(b); });
    ivSync();
  }
  function ivDesc() { return T.sequenceDesc(T.intervalNames(ivCur.rootMidi, ivCur.iv), { mode: ivCur.mode, noteSec: noteGap, long: true }); }
  const ivPlay = () => { if (!ivCur) return; pulse($('playBtn')); speak(ivDesc()); };
  function ivNew(auto) {
    ivAnswered = false; ivFb.clear();
    const ok = T.ALL_INTERVALS.filter((iv) => activeIntervals.has(iv.semitones) && rangeMin <= rangeMax - iv.semitones);
    if (!ok.length) { ivFb.show('⚠ Aucun intervalle possible dans cette plage !', 'wrong'); ivCur = null; return; }
    const iv = ok[randInt(0, ok.length - 1)];
    ivCur = { iv, rootMidi: randInt(rangeMin, rangeMax - iv.semitones), mode: pickMode() };
    $('answersGrid').querySelectorAll('.ans-btn').forEach((b) => { b.classList.remove('wrong', 'correct'); b.disabled = false; });
    ivSync();
    kbIv.setIdentMarker(ivCur.mode === 'descendant' ? ivCur.rootMidi + iv.semitones : ivCur.rootMidi); // la note entendue en premier
    if (auto) later(ivPlay, 180);
  }
  function ivAnswer(semi, btn) {
    if (ivAnswered || !ivCur || btn.classList.contains('inactive')) return;
    ivScore.st.total++;
    if (semi === ivCur.iv.semitones) {
      ivAnswered = true; ivScore.st.ok++; ivScore.update(); btn.classList.add('correct');
      $('answersGrid').querySelectorAll('.ans-btn').forEach((b) => { if (b !== btn) b.disabled = true; });
      ivFb.show(`✓ Bravo !  ${ivCur.iv.name}`, 'correct'); ivFb.soon(() => { ivFb.clear(); ivNew(true); }, nextDelay * 1000);
    } else { ivScore.update(); btn.classList.add('wrong'); btn.disabled = true; ivFb.show('✗ Essaie encore…', 'wrong'); ivFb.soon(() => { if (!ivAnswered) ivFb.clear(); }, 1200); }
  }
  function drawFamilies() {
    const fc = $('familyCol'); fc.innerHTML = '';
    T.FAMILIES.forEach((fam) => {
      const row = document.createElement('div'); row.className = 'family-row' + (fam.key === displayedFamilyKey ? ' focused' : '');
      const label = document.createElement('button'); label.className = 'family-label'; label.type = 'button'; label.textContent = fam.label; label.style.cssText = 'background:none;border:0;color:inherit;text-align:left;flex:1;cursor:pointer';
      label.title = `Voir les qualités de ${fam.label}`; label.onclick = () => { displayedFamilyKey = fam.key; drawFamilies(); drawQualities(); };
      const tg = document.createElement('button'); tg.type = 'button'; tg.className = 'family-toggle' + (ivHas(fam) ? ' on' : ''); tg.setAttribute('role', 'switch'); tg.setAttribute('aria-checked', ivHas(fam)); tg.setAttribute('aria-label', `Famille ${fam.label}`); tg.style.cssText += ';padding:0;cursor:pointer';
      tg.onclick = () => {
        if (ivHas(fam)) { const rest = [...activeIntervals].filter((s) => !fam.qualities.some((q) => q.semitones === s)); if (!rest.length) return; fam.qualities.forEach((q) => activeIntervals.delete(q.semitones)); }
        else fam.qualities.forEach((q) => activeIntervals.add(q.semitones));
        displayedFamilyKey = fam.key; drawFamilies(); drawQualities(); ivSync(); ivAmp();
      };
      row.append(label, tg); fc.append(row);
    });
  }
  function drawQualities() {
    const qc = $('qualityCol'); qc.innerHTML = '';
    const fam = T.FAMILIES.find((f) => f.key === displayedFamilyKey);
    if (!fam || !ivHas(fam)) { qc.innerHTML = '<div class="quality-empty">Famille désactivée</div>'; return; }
    fam.qualities.forEach((q) => {
      const b = document.createElement('button'); b.className = 'quality-btn' + (activeIntervals.has(q.semitones) ? ' active' : ''); b.setAttribute('aria-pressed', activeIntervals.has(q.semitones));
      b.innerHTML = `${q.qualityLabel}<span class="qs">${q.short}</span>`;
      b.onclick = () => { if (activeIntervals.has(q.semitones) && activeIntervals.size === 1) return; if (activeIntervals.has(q.semitones)) activeIntervals.delete(q.semitones); else activeIntervals.add(q.semitones); drawQualities(); drawFamilies(); ivSync(); ivAmp(); };
      qc.append(b);
    });
  }
  $('selectAllBtn').onclick = () => { T.ALL_INTERVALS.forEach((i) => activeIntervals.add(i.semitones)); drawFamilies(); drawQualities(); ivSync(); ivAmp(); };
  $('selectNoneBtn').onclick = () => { activeIntervals = new Set([3]); displayedFamilyKey = 'tierce'; drawFamilies(); drawQualities(); ivSync(); ivAmp(); };
  fillSelect($('noteMin'), rangeMin); fillSelect($('noteMax'), rangeMax);
  $('noteMin').onchange = () => { if (Number($('noteMin').value) >= Number($('noteMax').value)) $('noteMax').value = Math.min(Number($('noteMin').value) + 12, MIDI_MAX); rangeMin = Number($('noteMin').value); rangeMax = Number($('noteMax').value); ivAmp(); };
  $('noteMax').onchange = () => { if (Number($('noteMax').value) <= Number($('noteMin').value)) $('noteMin').value = Math.max(Number($('noteMax').value) - 12, MIDI_MIN); rangeMin = Number($('noteMin').value); rangeMax = Number($('noteMax').value); ivAmp(); };
  slider($('gapRange'), $('gapVal'), (v) => `${v.toFixed(2)} s`, 0.1, 2.0, (v) => { noteGap = v; });
  slider($('nextDelayRange'), $('nextDelayVal'), (v) => `${v.toFixed(1)} s`, 0.2, 3.0, (v) => { nextDelay = v; });
  $('hamburgerBtn').onclick = () => sDrawer.open();
  $('playBtn').onclick = ivPlay; $('resetBtn').onclick = () => { ivScore.reset(); ivNew(false); };

  /* ======================= GAMMES ET ARPÈGES ======================= */
  let selRoot = T.ROOTS[0], selQual = T.QUALITIES[0], selDir = T.DIRECTIONS[0];
  let gaNames = null, gaStart = 60, gaMode = 'montant';
  const kbGa = piano($('keyboardGA'), (off) => gaNames && speak({ ...gaDesc(), transpose: off }, { host: $('staffWrap') }));
  const quarter = () => 0.6 / (1 + speedPct / 100);
  const gaDesc = (mode = gaMode, names = gaNames) => T.sequenceDesc(names, { mode, noteSec: quarter(), width: hostWidth($('staffWrap')) });
  const validRoots = (pc, q) => { const out = []; const span = Math.max(...q.intervals); for (let m = phraseRangeMin; m <= phraseRangeMax; m++) if (m % 12 === pc && m + span <= phraseRangeMax) out.push(m); return out; };
  function gaShow(randomOctave) {
    const title = `${selRoot.name} — ${selQual.label} — ${selDir.label}`;
    $('phrasePlayerPanel').style.display = '';
    $('phraseTitle').textContent = title;
    const ok = validRoots(selRoot.pc, selQual);
    if (!ok.length) { $('staffWrap').innerHTML = '<div class="quality-empty" style="width:100%;">Amplitude trop étroite pour cette gamme/cet accord à partir de cette fondamentale.</div>'; gaNames = null; return; }
    const rootMidi = randomOctave ? ok[randInt(0, ok.length - 1)] : ok[0];
    gaNames = T.qualityNames(rootMidi, selQual); gaMode = selDir.key === 'desc' ? 'descendant' : 'montant';
    draw($('staffWrap'), gaDesc(), gaDesc().width);
    kbGa.setPhrase(gaMode === 'descendant' ? rootMidi + Math.max(...selQual.intervals) : rootMidi);
    $('phrasePickerBtn').textContent = `🎵 ${title}`;
    $('phraseDirGroup').querySelectorAll('.mode-btn').forEach((b) => { b.classList.toggle('active', b.dataset.dir === selDir.key); b.setAttribute('aria-pressed', b.dataset.dir === selDir.key); });
  }
  function gaPickers() {
    renderPicker($('rootCol'), T.ROOTS, selRoot, (r) => { selRoot = r; gaPickers(); });
    renderPicker($('qualityColPhrase'), T.QUALITIES, selQual, (q) => { selQual = q; gaPickers(); });
    renderPicker($('dirCol'), T.DIRECTIONS, selDir, (d) => { selDir = d; gaPickers(); });
  }
  $('phrasePickerBtn').onclick = () => sPhrase.open();
  $('generatePhraseBtn').onclick = () => { sPhrase.close(); gaShow(false); };
  $('gaPlay').onclick = () => { if (!gaNames) return; pulse($('gaPlay')); speak(gaDesc(), { button: $('gaPlay'), host: $('staffWrap') }); };
  $('randomRootBtn').onclick = () => {
    const cands = T.ROOTS.filter((r) => r.pc !== selRoot.pc && validRoots(r.pc, selQual).length).sort(() => Math.random() - 0.5);
    if (cands.length) selRoot = cands[0]; gaPickers(); gaShow(true);
  };
  $('phraseDirGroup').addEventListener('click', (e) => { const b = e.target.closest('.mode-btn'); if (!b) return; const d = T.DIRECTIONS.find((x) => x.key === b.dataset.dir); if (!d || d === selDir) return; selDir = d; gaPickers(); gaShow(false); });
  $('phraseSettingsBtn').onclick = () => sPhraseSet.open(); $('gaIdentSettingsBtn').onclick = () => sPhraseSet.open();
  fillSelect($('phraseNoteMin'), phraseRangeMin); fillSelect($('phraseNoteMax'), phraseRangeMax);
  const gaAmp = () => { const lo = Number($('phraseNoteMin').value), hi = Number($('phraseNoteMax').value), w = $('phraseAmpWarning'); const bad = lo >= hi || !validRoots(selRoot.pc, selQual).length; w.classList.toggle('visible', bad); w.textContent = lo >= hi ? 'La note basse doit être inférieure à la note haute.' : 'Aucune fondamentale valide dans cette plage pour la gamme/l’accord choisi.'; };
  $('phraseNoteMin').onchange = () => { if (Number($('phraseNoteMin').value) >= Number($('phraseNoteMax').value)) $('phraseNoteMax').value = Math.min(Number($('phraseNoteMin').value) + 12, MIDI_MAX); phraseRangeMin = Number($('phraseNoteMin').value); phraseRangeMax = Number($('phraseNoteMax').value); gaAmp(); };
  $('phraseNoteMax').onchange = () => { if (Number($('phraseNoteMax').value) <= Number($('phraseNoteMin').value)) $('phraseNoteMin').value = Math.max(Number($('phraseNoteMax').value) - 12, MIDI_MIN); phraseRangeMin = Number($('phraseNoteMin').value); phraseRangeMax = Number($('phraseNoteMax').value); gaAmp(); };
  // les trois curseurs de vitesse (gamme, phrase, réglages) restent synchronisés
  const speedSliders = [['phraseSpeedRangeA', 'phraseSpeedValA'], ['phraseSpeedRangeB', 'phraseSpeedValB'], ['phraseSpeedRangeC', 'phraseSpeedValC']];
  const setSpeed = (v) => { speedPct = v; speedSliders.forEach(([r, l]) => { $(r).value = v; $(l).textContent = `${v > 0 ? '+' : ''}${v} %`; const p = ((v + 50) / 100 * 100).toFixed(1); $(r).style.background = `linear-gradient(to right, var(--gold) 0%, var(--gold) ${p}%, var(--border) ${p}%, var(--border) 100%)`; }); };
  speedSliders.forEach(([r]) => $(r).addEventListener('input', (e) => setSpeed(parseInt(e.target.value, 10)))); setSpeed(0);

  /* ======================= GAMMES — IDENTIFICATION ======================= */
  let gaActive = new Set(['maj', 'min']), gaCur = null, gaAnswered = false;
  const gaScore = bindScore({ val: 'gaScoreVal', pct: 'gaScorePct' }), gaFb = feedbackFor('gaFeedback');
  const kbGaId = piano($('keyboardGAIdent'), () => {});
  const gaSync = () => $('gaAnswersGrid').querySelectorAll('.ans-btn').forEach((b) => b.classList.toggle('inactive', !gaActive.has(b.dataset.qkey)));
  function gaBuildAnswers() { const g = $('gaAnswersGrid'); g.innerHTML = ''; T.QUALITIES.forEach((q) => { const b = document.createElement('button'); b.className = 'ans-btn'; b.dataset.qkey = q.key; b.textContent = q.label; b.onclick = () => gaAnswer(q.key, b); g.append(b); }); gaSync(); }
  function gaPool() {
    const g = $('gaQualityPool'); g.innerHTML = '';
    T.QUALITIES.forEach((q) => { const b = document.createElement('button'); b.className = 'quality-btn' + (gaActive.has(q.key) ? ' active' : ''); b.setAttribute('aria-pressed', gaActive.has(q.key)); b.textContent = q.label;
      b.onclick = () => { if (gaActive.has(q.key) && gaActive.size === 1) return; if (gaActive.has(q.key)) gaActive.delete(q.key); else gaActive.add(q.key); gaPool(); gaSync(); }; g.append(b); });
  }
  const gaCurDesc = () => T.sequenceDesc(T.qualityNames(gaCur.rootMidi, gaCur.q), { mode: gaCur.mode, noteSec: quarter(), chordSec: quarter() * 3.2 });
  const gaPlayCur = () => { if (!gaCur) return; pulse($('gaPlayBtn')); speak(gaCurDesc()); };
  function gaNew(auto) {
    gaAnswered = false; gaFb.clear();
    const pool = T.QUALITIES.filter((q) => gaActive.has(q.key));
    if (!pool.length) { gaFb.show('⚠ Aucune qualité sélectionnée !', 'wrong'); gaCur = null; return; }
    const q = pool[randInt(0, pool.length - 1)], span = Math.max(...q.intervals), lo = phraseRangeMin, hi = phraseRangeMax - span;
    if (lo > hi) { gaFb.show('⚠ Amplitude trop étroite pour cette qualité !', 'wrong'); gaCur = null; return; }
    gaCur = { q, rootMidi: randInt(lo, hi), mode: pickMode() };
    $('gaAnswersGrid').querySelectorAll('.ans-btn').forEach((b) => { b.classList.remove('wrong', 'correct'); b.disabled = false; });
    gaSync(); kbGaId.setIdentMarker(gaCur.rootMidi);
    if (auto) later(gaPlayCur, 180);
  }
  function gaAnswer(key, btn) {
    if (gaAnswered || !gaCur || btn.classList.contains('inactive')) return;
    gaScore.st.total++;
    if (key === gaCur.q.key) { gaAnswered = true; gaScore.st.ok++; gaScore.update(); btn.classList.add('correct'); $('gaAnswersGrid').querySelectorAll('.ans-btn').forEach((b) => { if (b !== btn) b.disabled = true; }); gaFb.show(`✓ Bravo !  ${gaCur.q.label}`, 'correct'); gaFb.soon(() => { gaFb.clear(); gaNew(true); }, nextDelay * 1000); }
    else { gaScore.update(); btn.classList.add('wrong'); btn.disabled = true; gaFb.show('✗ Essaie encore…', 'wrong'); gaFb.soon(() => { if (!gaAnswered) gaFb.clear(); }, 1200); }
  }
  $('gaPlayBtn').onclick = gaPlayCur; $('gaResetBtn').onclick = () => { gaScore.reset(); gaNew(false); };

  /* ======================= RÉPERTOIRE (phrases) ======================= */
  const loadImported = () => { try { return JSON.parse(localStorage.getItem(IMPORT_KEY) || '[]'); } catch { return []; } };
  const saveImported = (list) => { try { localStorage.setItem(IMPORT_KEY, JSON.stringify(list)); return true; } catch { return false; } };
  let imported = loadImported();
  const allPhrases = () => [...PHRASES.map((p, i) => ({ ...p, id: `b${i}` })), ...imported.map((p, i) => ({ genre: 'importe', title: p.title, featured: `${p.measures} mesure${p.measures > 1 ? 's' : ''} — ${p.cree ? 'phrase créée ici' : 'document Scorsaire'}`, noteDoc: p.noteDoc, id: `i${i}`, imp: i, cree: !!p.cree }))];
  const phraseDesc = (w) => (w.noteDoc ? { noteDoc: w.noteDoc, speed: 1 + speedPct / 100 } : T.withSpeed(w.desc, speedPct));
  let curWork = null, worksGenre = 'classique';
  const kbW = piano($('keyboardWorks'), (off) => curWork && speak({ ...phraseDesc(curWork), transpose: off }, { host: $('worksStaffWrap') }));
  function worksShow(w) {
    curWork = w; $('worksTitle').textContent = w.title; $('worksPlayerPanel').style.display = '';
    draw($('worksStaffWrap'), w.noteDoc ? { noteDoc: w.noteDoc } : w.desc, hostWidth($('worksStaffWrap')));
    if (w.desc) kbW.setPhrase(T.firstMidi(w.desc)); else kbW.setPhrase(60);
    $('worksPickerBtn').textContent = `🎵 ${w.title} — changer`;
  }
  const genreTabs = (container, selected, onPick, withAll) => {
    container.innerHTML = '';
    [...(withAll ? [{ key: 'mixed', label: 'Mixte' }] : []), ...GENRES].forEach((g) => {
      const n = g.key === 'mixed' ? allPhrases().length : allPhrases().filter((p) => p.genre === g.key).length;
      if (g.key === 'importe' && !n) return;
      const b = document.createElement('button'); b.className = 'tab-btn' + (g.key === selected ? ' active' : ''); b.textContent = g.label; b.setAttribute('aria-pressed', g.key === selected); b.onclick = () => onPick(g.key); container.append(b);
    });
  };
  function worksList() {
    genreTabs($('worksGenreTabs'), worksGenre, (k) => { worksGenre = k; worksList(); });
    const list = $('worksList'); list.innerHTML = '';
    allPhrases().filter((w) => w.genre === worksGenre).forEach((w) => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:stretch';
      const b = document.createElement('button'); b.className = 'phrase-item'; b.style.flex = '1'; b.innerHTML = `<span class="pi-title"></span><span class="pi-meta"></span>`; b.querySelector('.pi-title').textContent = w.title; b.querySelector('.pi-meta').textContent = w.featured;
      b.onclick = () => { worksShow(w); sWorks.close(); }; row.append(b);
      if (w.cree) { const e = document.createElement('button'); e.className = 'mini-btn'; e.textContent = '✏'; e.setAttribute('aria-label', `Modifier ${w.title}`); e.onclick = () => { sWorks.close(); editPhrase(w.imp); }; row.append(e); }
      if (w.imp != null) { const d = document.createElement('button'); d.className = 'mini-btn'; d.textContent = '🗑'; d.setAttribute('aria-label', `Retirer ${w.title}`); d.onclick = () => { imported.splice(w.imp, 1); saveImported(imported); if (curWork?.id === w.id) { curWork = null; $('worksPlayerPanel').style.display = 'none'; } if (!imported.length) worksGenre = 'classique'; worksList(); wkFilterTabs(); }; row.append(d); }
      list.append(row);
    });
  }
  $('worksPickerBtn').onclick = () => { worksList(); sWorks.open(); };
  $('worksPlay').onclick = () => { if (!curWork) return; pulse($('worksPlay')); speak(phraseDesc(curWork), { button: $('worksPlay'), host: $('worksStaffWrap') }); };
  redraws.push(() => { if (curWork && $('worksEcoutePanel').classList.contains('active') && $('panelWorks').classList.contains('active')) draw($('worksStaffWrap'), curWork.noteDoc ? { noteDoc: curWork.noteDoc } : curWork.desc, hostWidth($('worksStaffWrap'))); });
  redraws.push(() => { if (gaNames && $('panelPhrase').classList.contains('active') && $('gaEcoutePanel').classList.contains('active')) draw($('staffWrap'), gaDesc(), gaDesc().width); });

  // éditeur visuel : le composant d'édition de Scorsaire, en plein écran (chargé à l'ouverture)
  let pending = null;
  async function editPhrase(index = null) {
    $('importNote').textContent = '';
    let m;
    try { m = await import('./editeur-phrase.js'); } catch { $('importNote').textContent = 'L’éditeur n’a pas pu être chargé. Vérifiez la connexion puis réessayez.'; return; }
    stopAll();
    m.ouvrirEditeur({
      doc: index == null ? null : imported[index].noteDoc,
      sounds: new URLSearchParams(location.search).get('sounds') || SOUNDS_URL,
      theme: resolveTheme() === 'light' ? 'light' : 'dark',
      onSave: (text) => {
        if (!m.aDuContenu(text)) { $('importNote').textContent = 'La phrase est vide : placez au moins une note pour l’enregistrer.'; return; }
        pending = { index, text, measures: m.nombreDeMesures(text) };
        $('nameInput').value = index == null ? (m.titreDuDocument(text) || 'Ma phrase') : imported[index].title; // en modification, on garde le nom de la phrase
        $('nameNote').textContent = ''; sName.open(); $('nameInput').focus(); $('nameInput').select();
      },
    });
  }
  function savePending() {
    const title = $('nameInput').value.trim();
    if (!title) { $('nameNote').textContent = 'Donnez un nom à la phrase.'; return; }
    const entry = { title, measures: pending.measures, noteDoc: JSON.parse(pending.text), cree: true };
    if (pending.index == null) imported.push(entry); else imported[pending.index] = entry;
    const stored = saveImported(imported);
    const idx = pending.index ?? imported.length - 1; pending = null;
    sName.close(); worksGenre = 'importe'; wkFilterTabs();
    worksShow(allPhrases().find((w) => w.id === `i${idx}`));
    $('importNote').textContent = stored ? `Phrase « ${title} » enregistrée dans « Mes phrases ».` : 'Phrase ajoutée pour cette session seulement (espace de stockage du navigateur plein).';
  }
  $('createBtn').onclick = () => editPhrase(null);
  $('nameSave').onclick = savePending;
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePending(); });

  // import d'un document Scorsaire (un mouvement = une phrase)
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const note = $('importNote');
    try {
      const found = lireDocumentScorsaire(await f.text());
      imported = [...imported, ...found];
      if (!saveImported(imported)) { note.textContent = 'Phrases ajoutées pour cette session seulement (espace de stockage du navigateur plein).'; }
      else note.textContent = `${found.length} phrase${found.length > 1 ? 's' : ''} importée${found.length > 1 ? 's' : ''} depuis « ${f.name} » : onglet « Mes phrases » du choix de phrase.`;
      worksGenre = 'importe'; worksList(); wkFilterTabs();
    } catch (err) { note.textContent = err.message; }
  };

  /* ======================= PHRASES — IDENTIFICATION ======================= */
  let wkChoices = 8, wkFilter = 'mixed', wkCur = null, wkAnswered = false;
  const wkScore = bindScore({ val: 'wkScoreVal', pct: 'wkScorePct' }), wkFb = feedbackFor('wkFeedback');
  const kbWkId = piano($('keyboardWorksIdent'), () => {});
  const wkPool = () => (wkFilter === 'mixed' ? allPhrases() : allPhrases().filter((w) => w.genre === wkFilter));
  function wkFilterTabs() { if (wkFilter === 'importe' && !imported.length) wkFilter = 'mixed'; genreTabs($('wkFilterTabs'), wkFilter, (k) => { wkFilter = k; wkFilterTabs(); wkNew(false); }, true); }
  function wkNew(auto) {
    wkAnswered = false; wkFb.clear();
    const pool = wkPool();
    if (pool.length < 2) { wkFb.show('⚠ Pas assez de phrases dans ce répertoire !', 'wrong'); wkCur = null; $('wkAnswersGrid').innerHTML = ''; return; }
    const n = Math.min(wkChoices, pool.length), correct = pool[randInt(0, pool.length - 1)];
    const choices = [correct, ...pool.filter((w) => w !== correct).sort(() => Math.random() - 0.5).slice(0, n - 1)].sort(() => Math.random() - 0.5);
    let offset = 0, first = null;
    if (correct.desc) { const [lo, hi] = T.rangeOfDesc(correct.desc); const a = phraseRangeMin - lo, b = phraseRangeMax - hi; offset = a > b ? 0 : randInt(a, b); first = T.firstMidi(correct.desc) + offset; }
    else offset = randInt(-4, 4);
    wkCur = { work: correct, offset };
    const g = $('wkAnswersGrid'); g.innerHTML = '';
    choices.forEach((w) => { const b = document.createElement('button'); b.className = 'ans-btn'; b.style.textAlign = 'left'; b.textContent = w.title; b.onclick = () => wkAnswer(w, b); g.append(b); });
    if (first != null) kbWkId.setIdentMarker(first); else kbWkId.setIdentMarker(60 + offset);
    if (auto) later(wkPlayCur, 180);
  }
  const wkPlayCur = () => { if (!wkCur) return; pulse($('wkPlayBtn')); speak({ ...phraseDesc(wkCur.work), transpose: wkCur.offset }); };
  function wkAnswer(w, btn) {
    if (wkAnswered || !wkCur) return;
    wkScore.st.total++;
    if (w === wkCur.work || w.id === wkCur.work.id) { wkAnswered = true; wkScore.st.ok++; wkScore.update(); btn.classList.add('correct'); $('wkAnswersGrid').querySelectorAll('.ans-btn').forEach((b) => { if (b !== btn) b.disabled = true; }); wkFb.show(`✓ Bravo !  ${w.title}`, 'correct'); wkFb.soon(() => { wkFb.clear(); wkNew(true); }, nextDelay * 1000); }
    else { wkScore.update(); btn.classList.add('wrong'); btn.disabled = true; wkFb.show('✗ Essaie encore…', 'wrong'); wkFb.soon(() => { if (!wkAnswered) wkFb.clear(); }, 1200); }
  }
  $('wkPlayBtn').onclick = wkPlayCur; $('wkResetBtn').onclick = () => { wkScore.reset(); wkNew(false); };
  $('wkIdentSettingsBtn').onclick = () => { wkFilterTabs(); sWk.open(); };
  slider($('wkChoiceRange'), $('wkChoiceVal'), (v) => String(v), 4, 16, (v) => { wkChoices = v; });

  /* ---------- démarrage ---------- */
  ecPickers(); ecDraw(); drawFamilies(); drawQualities(); ivBuildAnswers(); ivAmp(); ivNew(false);
  gaPickers(); gaPool(); gaBuildAnswers(); gaNew(false); wkFilterTabs(); wkNew(false);
  // les questions d'identification se relancent quand on ouvre l'onglet (pas de question « déjà jouée » en fond)
  window.__oreille = { root, state: () => ({ ivCur, gaCur, wkCur, ecDesc, gaNames, curWork, activeModes: [...activeModes], speedPct, noteGap }) };
  return () => { disposers.forEach((d) => d()); delete window.__oreille; $view.classList.remove('compact'); };
}
