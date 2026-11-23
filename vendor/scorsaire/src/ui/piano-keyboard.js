/*
 * Clavier de piano à l'écran (afficheur de Jean, repris de `piano-keyboard.html`), en COMPOSANT : on peut en créer plusieurs, rien n'est global.
 * Il ne fait AUCUN son : il montre des touches allumées (`noteOn` / `noteOff`) et envoie ce que l'utilisateur joue (`onNoteOn` / `onNoteOff`) ; c'est
 * l'hôte qui branche un moteur audio, le lecteur (touches allumées pendant la lecture) ou la saisie de notes.
 *
 * L'allure est celle de l'original (feuille de style `piano-keyboard-style.js`). Changements pour l'intégration :
 *  - les roues de couleur ont disparu : l'hôte règle les couleurs par l'API (`setActiveColor`, `setColors`, `setPreset`, …) ;
 *  - tous les textes passent par `t` (clés `piano.*`) ;
 *  - mode lecture seule (`setReadOnly`) : les touches ne répondent plus au doigt, mais le bandeau (nombre de touches, glisser) reste utilisable ;
 *  - `fitRange(plus grave, plus aiguë)` : ajuste le clavier à l'étendue d'un morceau (commence et finit sur une touche blanche, 25 touches au moins) ;
 *  - une API complète comme avant (couleurs, taille, nombre de touches, doigtés, vue des contrôleurs pitch bend / CC).
 * Les événements `pianokeydown`, `pianokeyup` et `pianocontrol` sont aussi envoyés sur `element` (CustomEvent).
 */
import { PIANO_KEYBOARD_CSS } from './piano-keyboard-style.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const PRESET_START = { 25: 48, 37: 36, 49: 36, 61: 36, 76: 28, 88: 21 };
const MIDI_LO = 21; // A0
const MIDI_HI = 108; // C8
const MIN_KEYS = 12;
const MAX_KEYS = 88;
export const midiToName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

const DEFAULT_WHITE = { top: '#d5d1ce', mid: '#cdc9c6', bot: '#c5c1be' };
const DEFAULT_BLACK = { top: '#3a3a3a', mid: '#2a2a2a', bot: '#181818' };
/** Présélections inspirées des claviers d'orgue UHT. */
export const PIANO_PRESETS = Object.freeze({
  pflaume: { white: { top: '#c9a57a', mid: '#b89268', bot: '#a67e55' }, black: { top: '#2a2a2a', mid: '#1a1a1a', bot: '#0c0c0c' } },
  grenadill: { white: { top: '#4a3428', mid: '#3a281c', bot: '#2a1c14' }, black: { top: '#f0e6d0', mid: '#e8dcc0', bot: '#d4c8a8' } },
  kirsche: { white: { top: '#2c2c2c', mid: '#1e1e1e', bot: '#121212' }, black: { top: '#d4a060', mid: '#c48e4a', bot: '#a87838' } },
  palisander: { white: { top: '#c9a070', mid: '#b88e5c', bot: '#a47a48' }, black: { top: '#6b3a28', mid: '#5a2e1e', bot: '#3e1e12' } },
  reset: { white: DEFAULT_WHITE, black: DEFAULT_BLACK },
});
const CC_PRESETS = [[1, 'Mod'], [11, 'Expr'], [7, 'Vol'], [74, 'Cut']];
const CC_NAME_KEYS = new Set([1, 7, 10, 11, 64, 71, 74, 91, 93]);

const shadeHex = (hex, percent) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.min(255, Math.max(0, Math.round(v + (percent / 100) * 255)));
  return `#${((1 << 24) + (f((n >> 16) & 255) << 16) + (f((n >> 8) & 255) << 8) + f(n & 255)).toString(16).slice(1)}`;
};
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const restColor = (input) => {
  if (!input) return null;
  if (typeof input === 'string') return { top: shadeHex(input, 8), mid: input, bot: shadeHex(input, -8) };
  if (input.mid || input.top) { const mid = input.mid || input.top || input.bot; return { top: input.top || shadeHex(mid, 8), mid, bot: input.bot || shadeHex(mid, -8) }; }
  return null;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function injectStyle() {
  if (document.getElementById('pkb-style')) return;
  const st = document.createElement('style'); st.id = 'pkb-style'; st.textContent = PIANO_KEYBOARD_CSS; document.head.append(st);
}

/**
 * @param {object} options
 * @param {HTMLElement} options.host      où le clavier est monté
 * @param {(key: string, params?: object) => string} [options.t]  traduction
 * @param {number} [options.count=37] @param {number} [options.start=36]
 * @param {boolean} [options.readOnly=false]
 */
export function createPianoKeyboard({ host, t = (k) => k, count = 37, start = 36, readOnly = false } = {}) {
  injectStyle();
  const root = document.createElement('div');
  root.className = 'pkb';
  root.innerHTML = `
    <div class="top-bar">
      <div class="top-left">
        <button type="button" class="icon-btn keys-btn">⌨</button>
        <button type="button" class="icon-btn view-toggle">🎛</button>
      </div>
      <div class="pan-handle"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="play-labels"></div>
      <div class="top-right"><button type="button" class="icon-btn menu-btn" hidden>⋮</button></div>
    </div>
    <div class="keyboard">
      <div class="keys-area"><div class="white-keys"></div><div class="black-keys"></div></div>
      <div class="controls-panel" hidden>
        <div class="ctrl-top">
          <div class="ctrl-menu"></div>
          <div class="ctrl-drawer">
            <div class="ctrl-drawer-head"><div class="ctrl-drawer-display"></div><button type="button" class="ctrl-drawer-clear" data-action="clear">⌫</button></div>
            <div class="ctrl-numpad"></div>
          </div>
        </div>
        <div class="ctrl-strip-wrap">
          <div class="ctrl-strip-label"><span class="ctrl-name"></span><span class="ctrl-value">0</span></div>
          <div class="ctrl-strip" role="slider"><div class="ctrl-center"></div><div class="ctrl-fill"></div><div class="ctrl-thumb"></div></div>
        </div>
      </div>
    </div>`;
  host.append(root);
  const $ = (sel) => root.querySelector(sel);
  const whiteKeysEl = $('.white-keys'); const blackKeysEl = $('.black-keys'); const keysArea = $('.keys-area');
  const playLabels = $('.play-labels'); const topBar = $('.top-bar'); const keyboardEl = $('.keyboard');

  let startMidi = start; let totalKeys = count; let isReadOnly = !!readOnly;
  let baseColor = '#b1915e'; let noteNameColor = '#c4c5c7'; let frameColor = '#252628';
  let fingerMap = Object.create(null);
  const activeLabels = new Map();
  const listeners = { noteOn: null, noteOff: null, control: null };
  const style = (name, value) => root.style.setProperty(name, value);

  const clampStart = (s, n) => { n = clamp(n || totalKeys, MIN_KEYS, MAX_KEYS); return Math.max(MIDI_LO, Math.min(MIDI_HI - n + 1, s)); };

  // ----- notes et doigtés -----
  const keyEl = (midi) => root.querySelector(`[data-midi="${midi}"]`);
  function emitNote(type, el, velocity) {
    const midi = parseInt(el.dataset.midi, 10);
    const vel = velocity != null ? velocity : (parseInt(el.dataset.velocity, 10) || 100);
    const detail = { midi, name: midiToName(midi), isBlack: IS_BLACK[midi % 12], velocity: vel, velocityNorm: vel / 127 };
    root.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
    const fn = type === 'pianokeydown' ? listeners.noteOn : listeners.noteOff;
    if (fn) fn(detail);
  }
  function showNoteLabel(el) {
    const midi = parseInt(el.dataset.midi, 10);
    if (activeLabels.has(midi)) return;
    const label = document.createElement('span');
    label.className = 'play-label-item'; label.textContent = midiToName(midi);
    const keyRect = el.getBoundingClientRect(); const barRect = topBar.getBoundingClientRect();
    label.style.left = `${keyRect.left + keyRect.width / 2 - barRect.left}px`;
    playLabels.append(label); activeLabels.set(midi, label);
  }
  function hideNoteLabel(el) {
    const midi = parseInt(el.dataset.midi, 10); const label = activeLabels.get(midi);
    if (label) { label.remove(); activeLabels.delete(midi); }
  }
  const applyVelocity = (el, velocity) => { el.style.setProperty('--vel', String(clamp(velocity / 127, 0, 1))); el.dataset.velocity = String(velocity); };
  function pointerDown(e) {
    if (isReadOnly) return;
    const el = e.currentTarget;
    e.preventDefault(); e.stopPropagation();
    if (e.pointerId != null) { try { el.setPointerCapture(e.pointerId); } catch { /* ignored */ } }
    const rect = el.getBoundingClientRect();
    const vel = Math.round(1 + clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1) * 126);
    applyVelocity(el, vel); el.classList.add('active'); showNoteLabel(el);
    emitNote('pianokeydown', el, vel);
  }
  function pointerUp(e) {
    const el = e.currentTarget;
    if (!el.classList.contains('active')) return;
    const vel = parseInt(el.dataset.velocity, 10) || 100;
    el.classList.remove('active'); el.style.removeProperty('--vel'); hideNoteLabel(el);
    emitNote('pianokeyup', el, vel);
  }
  function applyFingerBadges() {
    root.querySelectorAll('.finger-badge').forEach((b) => b.remove());
    for (const [midiStr, num] of Object.entries(fingerMap)) {
      const el = keyEl(parseInt(midiStr, 10));
      if (!el || num == null || num === '') continue;
      const badge = document.createElement('span');
      badge.className = 'finger-badge'; badge.textContent = String(num); badge.setAttribute('aria-hidden', 'true');
      el.append(badge);
    }
  }

  // ----- construction du clavier -----
  function syncStartUI() { if (modal) { modal.start.value = String(startMidi); modal.note.textContent = midiToName(startMidi); } }
  function buildKeyboard(numKeys, startNote) {
    numKeys = clamp(numKeys, MIN_KEYS, MAX_KEYS);
    const first = clampStart(startNote != null ? startNote : startMidi, numKeys);
    startMidi = first; totalKeys = numKeys;
    const lit = [...root.querySelectorAll('.white-key.active, .black-key.active')].map((e) => ({ midi: parseInt(e.dataset.midi, 10), vel: parseInt(e.dataset.velocity, 10) || 100 }));
    activeLabels.clear(); playLabels.replaceChildren();
    const notes = Array.from({ length: numKeys }, (_, i) => first + i);
    const whites = notes.filter((m) => !IS_BLACK[m % 12]); const blacks = notes.filter((m) => IS_BLACK[m % 12]);
    whiteKeysEl.replaceChildren(); blackKeysEl.replaceChildren();
    const attach = (el) => {
      el.addEventListener('pointerdown', pointerDown); el.addEventListener('pointerup', pointerUp);
      el.addEventListener('pointercancel', pointerUp); el.addEventListener('lostpointercapture', pointerUp);
    };
    for (const midi of whites) {
      const el = document.createElement('div'); el.className = 'white-key'; el.dataset.midi = String(midi);
      if (midi % 12 === 0) { const s = document.createElement('span'); s.className = 'key-name'; s.textContent = midiToName(midi); el.append(s); }
      attach(el); whiteKeysEl.append(el);
    }
    // les noires sont centrées sur la jointure entre deux blanches, largeur = 62 % d'une blanche, dans le même repère que les blanches
    const wPct = 100 / whites.length; const bPct = wPct * 0.62;
    for (const midi of blacks) {
      const before = notes.filter((m) => m < midi && !IS_BLACK[m % 12]).length;
      const el = document.createElement('div'); el.className = 'black-key'; el.dataset.midi = String(midi);
      el.style.left = `${before * wPct - bPct / 2}%`; el.style.width = `${bPct}%`;
      attach(el); blackKeysEl.append(el);
    }
    syncStartUI();
    modal?.presets.forEach((b) => b.classList.toggle('active', parseInt(b.dataset.keys, 10) === numKeys));
    if (modal) modal.count.value = String(numKeys);
    applyFingerBadges();
    for (const { midi, vel } of lit) { const el = keyEl(midi); if (el) { applyVelocity(el, vel); el.classList.add('active'); showNoteLabel(el); } }
  }

  /** The window and the menu live in <body>: they get the colours of the keyboard's frame and buttons (set by the host). */
  const THEME_VARS = ['--frame-color', '--btn-bg', '--btn-border', '--btn-icon', '--btn-hover-bg', '--btn-hover-icon', '--note-name-color'];
  const copyTheme = (el) => { const cs = getComputedStyle(root); for (const v of THEME_VARS) { const val = cs.getPropertyValue(v).trim(); if (val) el.style.setProperty(v, val); } };

  // ----- nombre de touches (fenêtre) -----
  let modal = null;
  function openKeysModal() {
    if (modal?.overlay.isConnected) return;
    const overlay = document.createElement('div'); overlay.className = 'pkb-overlay'; overlay.setAttribute('data-zoom-lock', ''); overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class="pkb-modal"><h3></h3>
      <div class="pkb-row"><label class="l-total"></label><div class="pkb-stepper"><button type="button" class="k-minus">−</button><input type="text" class="k-count" maxlength="2" inputmode="numeric"><button type="button" class="k-plus">+</button></div></div>
      <div class="pkb-row"><label class="l-first"></label><div class="pkb-stepper"><button type="button" class="s-minus">−</button><input type="text" class="s-midi" maxlength="3" inputmode="numeric"><button type="button" class="s-plus">+</button></div></div>
      <div class="pkb-note"></div>
      <div class="pkb-presets">${Object.keys(PRESET_START).map((n) => `<button type="button" data-keys="${n}">${n}</button>`).join('')}</div>
      <p class="pkb-hint"></p><button type="button" class="pkb-close"></button></div>`;
    const q = (s) => overlay.querySelector(s);
    q('h3').textContent = t('piano.keys'); q('.l-total').textContent = t('piano.total'); q('.l-first').textContent = t('piano.firstNote');
    q('.pkb-hint').textContent = t('piano.hint'); q('.pkb-close').textContent = t('piano.close'); q('.s-midi').title = t('piano.firstNoteTip');
    copyTheme(overlay);
    modal = { overlay, count: q('.k-count'), start: q('.s-midi'), note: q('.pkb-note'), presets: [...overlay.querySelectorAll('.pkb-presets button')] };
    const close = () => { overlay.remove(); modal = null; };
    q('.pkb-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    q('.k-minus').addEventListener('click', () => api.setKeys(totalKeys - 1, startMidi));
    q('.k-plus').addEventListener('click', () => api.setKeys(totalKeys + 1, startMidi));
    modal.count.addEventListener('change', () => api.setKeys(parseInt(modal.count.value, 10) || 25, startMidi));
    q('.s-minus').addEventListener('click', () => api.setKeys(totalKeys, startMidi - 1));
    q('.s-plus').addEventListener('click', () => api.setKeys(totalKeys, startMidi + 1));
    modal.start.addEventListener('change', () => { const s = parseInt(modal.start.value, 10); api.setKeys(totalKeys, Number.isNaN(s) ? startMidi : s); });
    modal.presets.forEach((b) => b.addEventListener('click', () => { const n = parseInt(b.dataset.keys, 10); api.setKeys(n, PRESET_START[n] || 36); }));
    document.body.append(overlay);
    syncStartUI(); modal.count.value = String(totalKeys);
    modal.presets.forEach((b) => b.classList.toggle('active', parseInt(b.dataset.keys, 10) === totalKeys));
  }

  // ----- glisser le bandeau pour décaler le clavier -----
  (function setupPan() {
    const handle = $('.pan-handle');
    const OVERSCAN = 18;
    let dragging = false; let pointerId = null; let startX = 0; let originMidi = 36; let lastDx = 0; let avgKeyPx = 12; let leftExt = null; let rightExt = null;
    const clearExt = () => { leftExt?.remove(); rightExt?.remove(); leftExt = rightExt = null; };
    function buildExt(from, to, whitePx, side) {
      if (to <= from || whitePx <= 0) return null;
      const notes = []; for (let m = from; m < to; m++) notes.push(m);
      const ws = notes.filter((m) => !IS_BLACK[m % 12]); const bs = notes.filter((m) => IS_BLACK[m % 12]);
      if (!ws.length) return null;
      const wrap = document.createElement('div'); wrap.className = `pan-ext ${side}`;
      const whites = document.createElement('div'); whites.className = 'white-keys';
      const blacks = document.createElement('div'); blacks.className = 'black-keys';
      for (const midi of ws) {
        const el = document.createElement('div'); el.className = 'white-key'; el.style.flex = 'none'; el.style.width = `${whitePx}px`;
        if (midi % 12 === 0) { const lab = document.createElement('span'); lab.className = 'key-name'; lab.textContent = midiToName(midi); el.append(lab); }
        whites.append(el);
      }
      const wPct = 100 / ws.length; const bW = wPct * 0.62;
      for (const midi of bs) {
        const wb = notes.filter((m) => m < midi && !IS_BLACK[m % 12]).length;
        const el = document.createElement('div'); el.className = 'black-key'; el.style.left = `${wb * wPct - bW / 2}%`; el.style.width = `${bW}%`; blacks.append(el);
      }
      wrap.style.width = `${ws.length * whitePx}px`; wrap.append(whites, blacks);
      return wrap;
    }
    function prepareExt() {
      clearExt();
      const firstWhite = whiteKeysEl.querySelector('.white-key');
      const whitePx = firstWhite ? firstWhite.getBoundingClientRect().width : 20;
      avgKeyPx = keysArea.clientWidth / Math.max(1, totalKeys);
      leftExt = buildExt(Math.max(MIDI_LO, originMidi - OVERSCAN), originMidi, whitePx, 'left'); if (leftExt) keysArea.append(leftExt);
      const rightFrom = originMidi + totalKeys;
      rightExt = buildExt(rightFrom, Math.min(MIDI_HI + 1, rightFrom + OVERSCAN), whitePx, 'right'); if (rightExt) keysArea.append(rightExt);
    }
    const reset = () => { clearExt(); keysArea.style.transform = 'translate3d(0,0,0)'; keysArea.style.willChange = 'auto'; handle.style.cursor = ''; pointerId = null; };
    handle.addEventListener('pointerdown', (e) => {
      dragging = true; pointerId = e.pointerId; startX = e.clientX; originMidi = startMidi; lastDx = 0;
      keysArea.style.transition = 'none'; keysArea.style.willChange = 'transform'; handle.style.cursor = 'grabbing';
      prepareExt(); try { handle.setPointerCapture(e.pointerId); } catch { /* ignored */ }
      e.preventDefault(); e.stopPropagation();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
      lastDx = e.clientX - startX; keysArea.style.transform = `translate3d(${lastDx}px,0,0)`;
    });
    const end = (e) => {
      if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
      dragging = false;
      const dx = e.clientX != null ? e.clientX - startX : lastDx;
      const next = clampStart(originMidi + Math.round(-dx / Math.max(6, avgKeyPx)), totalKeys);
      reset();
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignored */ }
      if (next !== originMidi) { responsive.internal = true; buildKeyboard(totalKeys, next); responsive.internal = false; }
    };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', () => { if (dragging) { dragging = false; reset(); } });
  })();

  // ----- nombre de touches selon la largeur (facultatif) -----
  const responsive = {
    enabled: false, locked: false, internal: false,
    /** pixels per WHITE key: when set, the number of keys follows the width (from 25 up to 88 keys), the keyboard stays centred on middle C */
    keyWidth: 0, fitted: null,
    breakpoints: [{ max: 420, keys: 25 }, { max: 700, keys: 37 }, { max: 1000, keys: 49 }, { max: 1400, keys: 61 }, { max: Infinity, keys: 76 }],
    starts: { 25: 48, 37: 36, 49: 36, 61: 36, 76: 28, 88: 21 },
  };
  const snapWhiteDown = (m) => { while (IS_BLACK[m % 12] && m > MIDI_LO) m -= 1; return m; };
  /** The window starting at `a` (a white key) that holds exactly `whites` white keys and ends on a white key, moved down if it would pass the top of the piano. */
  function windowFrom(a, whites) {
    a = snapWhiteDown(clamp(a, MIDI_LO, MIDI_HI));
    for (let guard = 0; guard < 40; guard++) {
      let w = 0; let m = a;
      for (; m <= MIDI_HI && w < whites; m++) if (!IS_BLACK[m % 12]) w += 1;
      if (w === whites) return { a, n: m - a };
      a = snapWhiteDown(a - 1);
    }
    return { a: MIDI_LO, n: MAX_KEYS };
  }
  /** Window for a width: as many white keys as fit (`keyWidth` px each, 15 to 52), centred on middle C, widened to hold the fitted piece. */
  function layoutForWidth(width) {
    const whites = clamp(Math.floor((width - 8) / responsive.keyWidth), 15, 52);
    const base = windowFrom(60 - Math.round((whites * 12) / 7 / 2), whites);
    const f = responsive.fitted;
    if (!f || (f.lo >= base.a && f.hi <= base.a + base.n - 1)) return base;
    const centred = windowFrom(Math.round((f.lo + f.hi) / 2 - base.n / 2), whites);
    if (f.lo >= centred.a && f.hi <= centred.a + centred.n - 1) return centred;
    // the piece is wider than the window: show all of it (keys narrower than `keyWidth`)
    const a = snapWhiteDown(Math.max(MIDI_LO, f.lo - 1)); let b = Math.min(MIDI_HI, f.hi + 1); while (IS_BLACK[b % 12] && b < MIDI_HI) b += 1;
    return { a, n: clamp(b - a + 1, MIN_KEYS, MAX_KEYS) };
  }
  function applyResponsive(force = false) {
    if (!responsive.enabled || responsive.locked) return;
    const w = root.getBoundingClientRect().width || window.innerWidth;
    if (responsive.keyWidth) {
      const { a, n } = layoutForWidth(w);
      if (!force && n === totalKeys && a === startMidi) return;
      if (!force && n === totalKeys) return; // the same count: keep the place the user dragged the keyboard to
      responsive.internal = true; buildKeyboard(n, a); responsive.internal = false;
      return;
    }
    let keys = totalKeys;
    for (const bp of responsive.breakpoints) if (w <= bp.max) { keys = bp.keys; break; }
    keys = clamp(keys, MIN_KEYS, MAX_KEYS);
    if (keys === totalKeys) return;
    responsive.internal = true; buildKeyboard(keys, responsive.starts[keys] ?? PRESET_START[keys] ?? startMidi); responsive.internal = false;
  }
  let resizeTimer = null;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (responsive.enabled && !responsive.locked) { clearTimeout(resizeTimer); resizeTimer = setTimeout(applyResponsive, 80); } }) : null;
  ro?.observe(root);

  // ----- vue des contrôleurs (pitch bend, CC) -----
  let currentView = 'keys'; let ctrlMode = 'bend'; let ctrlCC = 1; let ctrlBend = 0; let ctrlCCValue = 0; let bendSpring = true; let ccDigits = ''; let ctrlLabel = '';
  const controlsPanel = $('.controls-panel'); const strip = $('.ctrl-strip'); const thumb = $('.ctrl-thumb'); const fill = $('.ctrl-fill');
  const nameEl = $('.ctrl-name'); const valueEl = $('.ctrl-value'); const viewBtn = $('.view-toggle'); const drawer = $('.ctrl-drawer'); const drawerDisplay = $('.ctrl-drawer-display');
  const menu = $('.ctrl-menu');
  const menuButtons = [];
  const mkMenu = (text, attrs) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ctrl-menu-item'; b.textContent = text; Object.assign(b.dataset, attrs); menu.append(b); menuButtons.push(b); return b; };
  mkMenu('Bend', { ctrl: 'bend' }).classList.add('active');
  for (const [cc, name] of CC_PRESETS) mkMenu(name, { ctrl: 'cc', cc: String(cc) });
  const freeBtn = mkMenu('CC…', { ctrl: 'cc-free' }); freeBtn.classList.add('cc-free');
  const numpad = $('.ctrl-numpad');
  for (const d of ['1', '2', '3', '4', '5']) numpad.insertAdjacentHTML('beforeend', `<button type="button" data-digit="${d}">${d}</button>`);
  numpad.insertAdjacentHTML('beforeend', '<button type="button" class="ok" data-action="ok">OK</button>');
  for (const d of ['6', '7', '8', '9', '0']) numpad.insertAdjacentHTML('beforeend', `<button type="button" data-digit="${d}">${d}</button>`);
  const ccName = (cc) => (CC_NAME_KEYS.has(cc) ? t(`piano.cc.${cc}`) : '');
  function emitControl(detail) {
    root.dispatchEvent(new CustomEvent('pianocontrol', { detail, bubbles: true }));
    if (listeners.control) listeners.control(detail);
  }
  function updateDrawerDisplay() { if (ccDigits) drawerDisplay.textContent = ccDigits; else drawerDisplay.innerHTML = '<span class="placeholder">–––</span>'; }
  function closeDrawer() { drawer.classList.remove('open'); controlsPanel.classList.remove('drawer-open'); ccDigits = ''; updateDrawerDisplay(); }
  function openDrawer() {
    ccDigits = ''; updateDrawerDisplay(); drawer.classList.add('open'); controlsPanel.classList.add('drawer-open');
    menuButtons.forEach((b) => b.classList.toggle('active', b === freeBtn));
  }
  function updateCtrlUI() {
    if (ctrlMode === 'bend') {
      strip.classList.remove('unipolar'); nameEl.textContent = t('piano.pitchBend');
      const pct = Math.round(ctrlBend * 100); valueEl.textContent = `${pct > 0 ? '+' : ''}${pct}`;
      const pos = (ctrlBend + 1) / 2; thumb.style.left = `${pos * 100}%`;
      if (ctrlBend >= 0) { fill.style.left = '50%'; fill.style.width = `${ctrlBend * 50}%`; } else { fill.style.left = `${pos * 100}%`; fill.style.width = `${(0.5 - pos) * 100}%`; }
      strip.setAttribute('aria-valuemin', '-8192'); strip.setAttribute('aria-valuemax', '8191'); strip.setAttribute('aria-valuenow', String(Math.round(ctrlBend * 8192)));
    } else {
      strip.classList.add('unipolar');
      const nm = ccName(ctrlCC);
      nameEl.textContent = ctrlLabel ? `${ctrlLabel} · CC${ctrlCC}` : nm ? `CC${ctrlCC} · ${nm}` : `CC${ctrlCC}`;
      valueEl.textContent = String(ctrlCCValue);
      const p = ctrlCCValue / 127; thumb.style.left = `${p * 100}%`; fill.style.left = '0'; fill.style.width = `${p * 100}%`;
      strip.setAttribute('aria-valuemin', '0'); strip.setAttribute('aria-valuemax', '127'); strip.setAttribute('aria-valuenow', String(ctrlCCValue));
    }
  }
  function setView(view) {
    currentView = view === 'controls' ? 'controls' : 'keys';
    const controls = currentView === 'controls';
    keyboardEl.classList.toggle('view-controls', controls); root.classList.toggle('view-controls', controls); controlsPanel.hidden = !controls;
    viewBtn.textContent = controls ? '🎹' : '🎛'; viewBtn.title = t(controls ? 'piano.showKeys' : 'piano.showControls'); viewBtn.setAttribute('aria-label', viewBtn.title);
    if (controls) updateCtrlUI();
  }
  function selectCtrl(mode, cc, label) {
    closeDrawer(); ctrlMode = mode;
    if (mode === 'cc' && cc != null) ctrlCC = clamp(parseInt(cc, 10) || 0, 0, 127);
    if (label !== undefined) ctrlLabel = label ? String(label) : ''; else if (mode !== 'cc') ctrlLabel = '';
    const presetMatch = CC_PRESETS.some(([n]) => n === ctrlCC);
    for (const b of menuButtons) {
      let active = (mode === 'bend' && b.dataset.ctrl === 'bend') || (mode === 'cc' && b.dataset.ctrl === 'cc' && parseInt(b.dataset.cc, 10) === ctrlCC);
      if (b === freeBtn) {
        if (mode === 'cc') { active = !presetMatch; b.textContent = ctrlLabel || `CC${ctrlCC}`; b.title = ctrlLabel ? `CC${ctrlCC} · ${ctrlLabel}` : `CC${ctrlCC}`; }
        else { b.textContent = 'CC…'; b.title = t('piano.chooseCC'); }
      }
      b.classList.toggle('active', !!active);
    }
    updateCtrlUI();
  }
  function setBend(v, emit) { ctrlBend = clamp(v, -1, 1); updateCtrlUI(); if (emit !== false) emitControl({ type: 'bend', value: ctrlBend, midi14: Math.round((ctrlBend + 1) * 8191.5) }); }
  function setCC(v, emit) { ctrlCCValue = clamp(Math.round(v), 0, 127); updateCtrlUI(); if (emit !== false) emitControl({ type: 'cc', controller: ctrlCC, value: ctrlCCValue }); }
  const stripValue = (clientX) => { const r = strip.getBoundingClientRect(); const x = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1); return ctrlMode === 'bend' ? x * 2 - 1 : x * 127; };
  (function bindStrip() {
    let dragging = false; let pid = null;
    const apply = (e) => { const v = stripValue(e.clientX); if (ctrlMode === 'bend') setBend(v); else setCC(v); };
    strip.addEventListener('pointerdown', (e) => { dragging = true; pid = e.pointerId; try { strip.setPointerCapture(e.pointerId); } catch { /* ignored */ } apply(e); e.preventDefault(); });
    strip.addEventListener('pointermove', (e) => { if (dragging && (pid == null || e.pointerId === pid)) apply(e); });
    const end = (e) => {
      if (!dragging || (pid != null && e.pointerId !== pid)) return;
      dragging = false; pid = null;
      if (ctrlMode === 'bend' && bendSpring) setBend(0);
      try { strip.releasePointerCapture(e.pointerId); } catch { /* ignored */ }
    };
    strip.addEventListener('pointerup', end); strip.addEventListener('pointercancel', end);
  })();
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ctrl === 'bend') selectCtrl('bend', null, '');
    else if (b === freeBtn) openDrawer();
    else selectCtrl('cc', parseInt(b.dataset.cc, 10), '');
  });
  const padClick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.digit != null) { const next = ccDigits + b.dataset.digit; if (ccDigits.length >= 3 || parseInt(next, 10) > 127) return; ccDigits = next; updateDrawerDisplay(); return; }
    if (b.dataset.action === 'clear') { ccDigits = ccDigits.slice(0, -1); updateDrawerDisplay(); return; }
    if (b.dataset.action === 'ok') { if (!ccDigits.length) { closeDrawer(); return; } selectCtrl('cc', clamp(parseInt(ccDigits, 10) || 0, 0, 127), ''); }
  };
  numpad.addEventListener('click', padClick); $('.ctrl-drawer-clear').addEventListener('click', padClick);
  viewBtn.addEventListener('click', () => setView(currentView === 'keys' ? 'controls' : 'keys'));
  $('.keys-btn').addEventListener('click', openKeysModal);

  // ----- textes (i18n) -----
  const retext = () => {
    $('.keys-btn').title = t('piano.keys'); $('.keys-btn').setAttribute('aria-label', t('piano.keys'));
    $('.pan-handle').title = t('piano.pan'); $('.ctrl-drawer-clear').title = t('piano.erase');
    setView(currentView);
  };

  // ----- menu of the bar (the host decides what it holds) -----
  const menuBtn = $('.menu-btn'); let menuItems = null; let menuPick = null; let pop = null;
  function closeMenu() { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outsideMenu, true); }
  function outsideMenu(e) { if (pop && !pop.contains(e.target) && e.target !== menuBtn) closeMenu(); }
  menuBtn.addEventListener('click', () => {
    if (pop) { closeMenu(); return; }
    if (!menuItems) return;
    pop = document.createElement('div'); pop.className = 'pkb-pop'; pop.setAttribute('data-zoom-lock', ''); pop.setAttribute('role', 'menu'); copyTheme(pop);
    for (const it of menuItems) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', String(!!it.checked));
      const check = document.createElement('span'); check.className = 'pkb-check'; check.textContent = it.checked ? '✓' : '';
      b.append(check, document.createTextNode(it.label));
      b.addEventListener('click', () => { closeMenu(); menuPick?.(it.id); });
      pop.append(b);
    }
    document.body.append(pop);
    const r = menuBtn.getBoundingClientRect(); const pr = pop.getBoundingClientRect();
    pop.style.left = `${clamp(r.right - pr.width, 4, window.innerWidth - pr.width - 4)}px`;
    pop.style.top = `${r.bottom + pr.height + 6 > window.innerHeight ? Math.max(4, r.top - pr.height - 6) : r.bottom + 6}px`;
    document.addEventListener('pointerdown', outsideMenu, true);
  });

  // ----- API -----
  const api = {
    element: root,
    // couleurs
    setActiveColor(hex) { if (!hex) return; baseColor = hex; style('--base-color', hex); },
    setNoteNameColor(hex) { if (!hex) return; noteNameColor = hex; style('--note-name-color', hex); },
    setFrameColor(hex) { if (!hex) return; frameColor = hex; style('--frame-color', hex); },
    setButtonColors(o) {
      if (!o) return;
      if (o.bg) style('--btn-bg', o.bg); if (o.border) style('--btn-border', o.border); if (o.icon) style('--btn-icon', o.icon);
      if (o.hoverBg) style('--btn-hover-bg', o.hoverBg); if (o.hoverIcon) style('--btn-hover-icon', o.hoverIcon);
    },
    setColors(o) {
      if (!o) return;
      if (o.active) api.setActiveColor(o.active); if (o.frame) api.setFrameColor(o.frame); if (o.noteName) api.setNoteNameColor(o.noteName);
      const map = { btnBg: '--btn-bg', btnBorder: '--btn-border', btnIcon: '--btn-icon', btnHoverBg: '--btn-hover-bg', btnHoverIcon: '--btn-hover-icon', sliderBg: '--slider-bg', sliderBorder: '--slider-border', sliderFill: '--slider-fill', sliderThumb: '--slider-thumb', sliderCenter: '--slider-center', keyName: '--key-name-color', keyBorder: '--key-border', topBarLine: '--top-bar-line' };
      for (const [k, v] of Object.entries(map)) if (o[k]) style(v, o[k]);
    },
    setKeyBorder(hex) { if (hex) style('--key-border', hex); },
    setTopBarLine(hex) { if (hex) style('--top-bar-line', hex); },
    setWhiteRest(input) {
      const c = restColor(input); if (!c) return;
      style('--white-rest-top', c.top); style('--white-rest', c.mid); style('--white-rest-bot', c.bot);
      style('--key-name-color', luminance(c.mid) < 0.45 ? '#c8c8c8' : '#555555'); // contraste des repères C selon la luminosité des marches
    },
    setBlackRest(input) { const c = restColor(input); if (c) { style('--black-rest-top', c.top); style('--black-rest-mid', c.mid); style('--black-rest-bot', c.bot); } },
    setPreset(id) { const p = PIANO_PRESETS[id]; if (!p) return false; api.setWhiteRest(p.white); api.setBlackRest(p.black); return true; },
    listPresets: () => Object.keys(PIANO_PRESETS),
    getColors() {
      const cs = getComputedStyle(root); const g = (n) => cs.getPropertyValue(n).trim();
      return { active: baseColor, noteName: noteNameColor, frame: frameColor, whiteRest: { top: g('--white-rest-top'), mid: g('--white-rest'), bot: g('--white-rest-bot') }, blackRest: { top: g('--black-rest-top'), mid: g('--black-rest-mid'), bot: g('--black-rest-bot') }, keyBorder: g('--key-border'), topBarLine: g('--top-bar-line') };
    },
    // clavier
    setKeys(n, startNote) {
      if (responsive.enabled && !responsive.internal) { responsive.locked = true; responsive.fitted = null; }
      buildKeyboard(clamp(parseInt(n, 10) || 25, MIN_KEYS, MAX_KEYS), startNote != null ? parseInt(startNote, 10) : startMidi);
    },
    getKeys: () => ({ count: totalKeys, startMidi }),
    /** Ajuste le clavier à l'étendue d'un morceau (plus grave et plus aiguë notes MIDI) : une touche de marge de chaque côté, début et fin sur une touche blanche, `min` touches au moins. */
    fitRange(lo, hi, { min = 25, margin = 1 } = {}) {
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return api.getKeys();
      if (responsive.enabled && responsive.keyWidth && !responsive.locked) { responsive.fitted = { lo: Math.floor(lo), hi: Math.ceil(hi) }; applyResponsive(true); return api.getKeys(); }
      let a = Math.max(MIDI_LO, Math.floor(lo) - margin); let b = Math.min(MIDI_HI, Math.ceil(hi) + margin);
      while (IS_BLACK[a % 12] && a > MIDI_LO) a -= 1;
      while (IS_BLACK[b % 12] && b < MIDI_HI) b += 1;
      let n = b - a + 1;
      if (n < min) { a -= Math.floor((min - n) / 2); n = min; }
      n = clamp(n, MIN_KEYS, MAX_KEYS);
      api.setKeys(n, clampStart(a, n));
      return api.getKeys();
    },
    setResponsiveKeys(opts) {
      if (opts === false || opts === null) { responsive.enabled = false; responsive.locked = false; return; }
      if (opts === true) opts = {};
      if (typeof opts !== 'object') return;
      responsive.enabled = opts.enabled !== false; responsive.locked = false;
      if (opts.keyWidth > 0) responsive.keyWidth = opts.keyWidth;
      if (Array.isArray(opts.breakpoints) && opts.breakpoints.length) responsive.breakpoints = opts.breakpoints.slice().sort((x, y) => (x.max || 0) - (y.max || 0));
      if (opts.starts && typeof opts.starts === 'object') responsive.starts = { ...responsive.starts, ...opts.starts };
      applyResponsive(true);
    },
    // taille
    setWidth(w) { if (w == null) return; const v = typeof w === 'number' ? `${w}px` : String(w); style('--kb-width', v); root.style.width = v; requestAnimationFrame(() => applyResponsive(true)); },
    setHeight(h) { if (h != null) style('--kb-height', typeof h === 'number' ? `${h}px` : String(h)); },
    setBlackHeightRatio(r) { if (r != null) style('--black-height', typeof r === 'number' ? `${clamp(r, 0.35, 0.85) * 100}%` : String(r)); },
    setSize(a, b) {
      if (a && typeof a === 'object') { if (a.width != null) api.setWidth(a.width); if (a.height != null) api.setHeight(a.height); if (a.blackRatio != null) api.setBlackHeightRatio(a.blackRatio); return; }
      if (a != null) api.setWidth(a); if (b != null) api.setHeight(b);
    },
    /** Lecture seule : les touches ne répondent plus au doigt (le bandeau reste utilisable) ; les touches peuvent toujours être allumées par l'hôte. */
    setReadOnly(on) { isReadOnly = !!on; root.classList.toggle('pkb-readonly', isReadOnly); },
    isReadOnly: () => isReadOnly,
    // notes
    onNoteOn(fn) { listeners.noteOn = typeof fn === 'function' ? fn : null; },
    onNoteOff(fn) { listeners.noteOff = typeof fn === 'function' ? fn : null; },
    /** Allume une touche (vélocité 1-127 : intensité de la couleur). Rend faux si la touche n'est pas sur le clavier affiché. */
    noteOn(midi, velocity, color) {
      const el = keyEl(midi); if (!el) return false;
      applyVelocity(el, velocity != null ? clamp(Math.round(velocity), 1, 127) : 100);
      if (color) el.style.setProperty('--base-color', color); // a colour for this key only (e.g. one per track)
      el.classList.add('active'); showNoteLabel(el); return true;
    },
    noteOff(midi) {
      const el = keyEl(midi); if (!el || !el.classList.contains('active')) return;
      el.classList.remove('active'); el.style.removeProperty('--vel'); el.style.removeProperty('--base-color'); hideNoteLabel(el);
    },
    allNotesOff() { root.querySelectorAll('.white-key.active, .black-key.active').forEach((el) => { el.classList.remove('active'); el.style.removeProperty('--vel'); el.style.removeProperty('--base-color'); hideNoteLabel(el); }); },
    /**
     * A small menu (the ⋮ button of the bar): `items` = [{ id, label, checked? }] ; `onPick(id)` is called when one is chosen (the host then calls `setMenu` again
     * with the new states). No items: the button is hidden.
     */
    setMenu(items, onPick) { menuItems = items?.length ? items : null; menuPick = onPick ?? null; menuBtn.hidden = !menuItems; closeMenu(); },
    // contrôleurs
    setView, getView: () => currentView,
    setBend, getBend: () => ctrlBend,
    setCC(value, controller, emit) { if (controller != null) selectCtrl('cc', controller); setCC(value, emit); },
    getCC: () => ({ controller: ctrlCC, value: ctrlCCValue }),
    selectControl(mode, cc, label) { if (mode === 'bend') selectCtrl('bend', null, ''); else selectCtrl('cc', cc != null ? cc : ctrlCC, label != null ? label : ''); },
    openCC(n, label) { setView('controls'); selectCtrl('cc', n, label != null ? label : ''); },
    openBend() { setView('controls'); selectCtrl('bend', null, ''); },
    setBendSpring(on) { bendSpring = !!on; },
    onControl(fn) { listeners.control = typeof fn === 'function' ? fn : null; },
    // doigtés
    setFinger(midi, number) { midi = parseInt(midi, 10); if (Number.isNaN(midi)) return; if (number == null || number === '' || number === false) delete fingerMap[midi]; else fingerMap[midi] = number; applyFingerBadges(); },
    setFingers(map) { if (!map || typeof map !== 'object') return; for (const [k, v] of Object.entries(map)) { const m = parseInt(k, 10); if (Number.isNaN(m)) continue; if (v == null || v === '' || v === false) delete fingerMap[m]; else fingerMap[m] = v; } applyFingerBadges(); },
    clearFingers() { fingerMap = Object.create(null); applyFingerBadges(); },
    getFingers: () => ({ ...fingerMap }),
    setFingerStyle(o) {
      if (!o) return;
      if (o.bgWhite) style('--finger-bg-white', o.bgWhite); if (o.fgWhite) style('--finger-fg-white', o.fgWhite);
      if (o.bgBlack) style('--finger-bg-black', o.bgBlack); if (o.fgBlack) style('--finger-fg-black', o.fgBlack);
      if (o.bg) { style('--finger-bg-white', o.bg); style('--finger-bg-black', o.bg); }
      if (o.fg) { style('--finger-fg-white', o.fg); style('--finger-fg-black', o.fg); }
      if (o.size != null) style('--finger-size', typeof o.size === 'number' ? `${o.size}px` : String(o.size));
    },
    /** Retraduit les textes (changement de langue). */
    retext,
    destroy() { ro?.disconnect(); clearTimeout(resizeTimer); closeMenu(); modal?.overlay.remove(); root.remove(); },
  };
  retext(); updateDrawerDisplay(); updateCtrlUI(); api.setReadOnly(isReadOnly);
  buildKeyboard(totalKeys, startMidi);
  return api;
}
