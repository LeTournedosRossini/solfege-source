/*
 * <scorsaire-note mode="view" lang="fr"> — the student's side: the small score with play, loop, transposition, speed and size.
 * Shadow DOM (the portal's CSS is far too specific to let in). Colours come from the page's Material variables (`--md-sys-color-*`) with a fallback, sizes are in rem,
 * touch targets are 44 px. The component never talks to a server: the page gives it `value` (the document) and `settings`, and listens to `settingschange`.
 *   attributes  mode ('view'), lang
 *   properties  value (document, text or object), settings ({ transpose, speed, zoom, loop })
 *   events      settingschange { detail: settings }, error { detail: { code, message } }
 *   methods     play(), stop()
 */
import { parseNoteDocument, normalizeSettings, NOTE_SETTINGS, NoteDocumentError } from './document.js';
import { SID } from '../model/sid.js';
import { resolveStyle } from '../model/props.js';
import { intervalIsZero } from '../model/transpose.js';
import { trackTransposition } from '../model/instruments.js';
import { noteText, noteError } from './i18n.js';
import { drawCell } from '../reader/core.js';
import { shiftForDisplay } from '../layout/displayshift.js';
import { buildSequence } from '../audio/sequence.js';
import { createWebAudioEngine, prepareAudioSession, webAudioAvailable } from '../audio/webaudio.js';
import { NullAudioEngine } from '../audio/engine.js';
import { ensureNoteFonts } from './fonts.js';
import { transposeSequence } from './transpose.js';

const STYLE = `
:host{display:block;color:var(--md-sys-color-on-surface,#1c1b1f);font:1rem/1.4 var(--md-sys-font,system-ui,sans-serif);--ink:var(--md-sys-color-on-surface,#1c1b1f);--score:var(--md-sys-color-surface,#fff);--line:var(--md-sys-color-outline-variant,#cac4d0)}
/* a forced theme (the setting theme): the component brings its own Material palette instead of the portal's; auto sets nothing and follows the portal */
:host([data-note-theme=dark]){color-scheme:dark;--md-sys-color-surface:#1c1b1f;--md-sys-color-on-surface:#e6e1e5;--md-sys-color-surface-container:#2b2930;--md-sys-color-outline:#938f99;--md-sys-color-outline-variant:#49454f;--md-sys-color-primary:#d0bcff;--md-sys-color-on-primary:#381e72;--md-sys-color-on-surface-variant:#cac4d0;--md-sys-color-error:#f2b8b5}
:host([data-note-theme=light]){color-scheme:light;--md-sys-color-surface:#fff;--md-sys-color-on-surface:#1c1b1f;--md-sys-color-surface-container:#f3edf7;--md-sys-color-outline:#79747e;--md-sys-color-outline-variant:#cac4d0;--md-sys-color-primary:#6750a4;--md-sys-color-on-primary:#fff;--md-sys-color-on-surface-variant:#49454f;--md-sys-color-error:#b3261e}
.seg{display:inline-flex;gap:.25rem}
*{box-sizing:border-box}
.text{margin:0;padding:.625rem .75rem .125rem;font-size:1rem;line-height:1.4;color:var(--md-sys-color-on-surface,#1c1b1f);white-space:pre-line;overflow-wrap:anywhere}
.text[hidden]{display:none}
.card{background:var(--md-sys-color-surface,#fff);border:1px solid var(--md-sys-color-outline-variant,#cac4d0);border-radius:.75rem;overflow:hidden}
.stage{padding:.5rem;overflow-x:auto;-webkit-overflow-scrolling:touch}
.bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;padding:.5rem;border-top:1px solid var(--md-sys-color-outline-variant,#cac4d0);background:var(--md-sys-color-surface-container,#f3edf7)}
button{font:inherit;color:inherit;min-width:2.75rem;min-height:2.75rem;padding:0 .75rem;border-radius:.5rem;border:1px solid var(--md-sys-color-outline,#79747e);background:var(--md-sys-color-surface,#fff);touch-action:manipulation;cursor:pointer}
button:focus-visible{outline:3px solid var(--md-sys-color-primary,#6750a4);outline-offset:2px}
button[aria-pressed=true],button.on{background:var(--md-sys-color-primary,#6750a4);color:var(--md-sys-color-on-primary,#fff);border-color:var(--md-sys-color-primary,#6750a4)}
button:disabled{opacity:.45;cursor:default}
.grp{display:flex;align-items:center;gap:.25rem}
.grp .val{min-width:3.5rem;text-align:center;font-variant-numeric:tabular-nums}
.grp .lab{flex-basis:100%;font-size:.8125rem;color:var(--md-sys-color-on-surface-variant,#49454f)}
.grp{flex-wrap:wrap}
.msg{padding:1rem;color:var(--md-sys-color-on-surface-variant,#49454f)}
svg{max-width:none}
.vsheet{position:fixed;z-index:21;left:0;right:0;bottom:0;max-width:40rem;margin-inline:auto;max-height:70vh;max-height:70dvh;overflow:auto;padding:.75rem .75rem calc(.75rem + env(safe-area-inset-bottom));background:var(--md-sys-color-surface,#fff);color:var(--md-sys-color-on-surface,#1c1b1f);border-top:1px solid var(--md-sys-color-outline-variant,#cac4d0);border-radius:1rem 1rem 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:.75rem;animation:vrise .18s ease-out}
@keyframes vrise{from{transform:translateY(100%)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.vsheet{animation:none}}
.vsheet[hidden],.vveil[hidden]{display:none}
.vveil{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.4);border:0;border-radius:0;min-width:0;min-height:0;padding:0}
.vsheet .vrow{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.vsheet .vhead{display:flex;align-items:center;justify-content:space-between}
.vsheet .grp button,.vsheet .vhead button{min-width:2.75rem}
/* a phone held sideways (about 360 px high): the settings are a panel at the right edge, as high as the screen, not a sheet that would cover the score */
@media (orientation:landscape) and (max-height:520px){
  .vsheet{top:0;bottom:0;left:auto;right:0;margin:0;width:min(22rem,55vw);max-width:none;max-height:none;border-top:0;border-left:1px solid var(--md-sys-color-outline-variant,#cac4d0);border-radius:1rem 0 0 1rem;box-shadow:-4px 0 24px rgba(0,0,0,.3);padding-top:calc(.75rem + env(safe-area-inset-top));padding-right:calc(.75rem + env(safe-area-inset-right));animation:vslide .18s ease-out}
}
@keyframes vslide{from{transform:translateX(100%)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.vsheet{animation:none}}
@media (forced-colors:active){button{border:2px solid ButtonText}button[aria-pressed=true]{outline:3px solid Highlight}}
`;

const ICON = {
  play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="6" y="6" width="12" height="12" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/></svg>',
  loop: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" fill="currentColor"/></svg>',
};

let defaultSoundsBase = './sounds/';
/** Called by the entry files (they sit next to the `sounds/` folder; the shared chunks do not): the folder the SoundFonts come from when the page gives no `sounds` attribute. */
export const setDefaultSoundsBase = (url) => { defaultSoundsBase = String(url); };

export class ScorsaireNote extends HTMLElement {
  static get observedAttributes() { return ['lang', 'mode']; }

  constructor() {
    super();
    ensureNoteFonts();
    this._root = this.attachShadow({ mode: 'open' });
    this._doc = null; this._settings = normalizeSettings(); this._engine = null; this._playing = false; this._starting = false; this._startToken = 0; this._timer = null; this._end = 0;
    this._root.innerHTML = `<style>${STYLE}</style><div class="card" part="card"><div class="text" part="text" hidden></div><div class="stage" role="img"></div><div class="bar" role="group"></div><button type="button" class="vveil" data-act="settings-close" tabindex="-1" hidden></button><div class="vsheet" role="dialog" aria-modal="true" hidden></div></div>`;
    this._textBox = this._root.querySelector('.text');
    this._stage = this._root.querySelector('.stage'); this._bar = this._root.querySelector('.bar'); this._vsheet = this._root.querySelector('.vsheet'); this._vveil = this._root.querySelector('.vveil'); this._settingsOpen = false;
    this._vsheet.addEventListener('click', (e) => this._viewClick(e)); this._vveil.addEventListener('click', () => this._closeSettings());
    this._bar.addEventListener('click', (e) => this._onClick(e)); // late-bound: the editor replaces the handler
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this._draw()) : null;
  }

  get lang() { return this.getAttribute('lang') || 'fr'; }
  get value() { return this._value; }
  set value(v) { this._value = v; this._load(); }
  get settings() { return { ...this._settings }; }
  set settings(s) { this._settings = normalizeSettings(s); this._refresh(); }

  connectedCallback() { this._applyTheme(); this._ro?.observe(this); this._refresh(); }
  disconnectedCallback() { this._ro?.disconnect(); this.stop(); }
  attributeChangedCallback() { if (this.isConnected) this._refresh(); }

  _t(key) { return noteText(this.lang, key); }

  _load() {
    this.stop(); this._parsed = null;
    try { if (this._value != null) this._parsed = parseNoteDocument(this._value); } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: noteError(this.lang, e instanceof NoteDocumentError ? e.code : 'unknown', e.message) }));
      this._failed = true;
    }
    if (this._parsed) this._failed = false;
    this._refresh();
  }

  _refresh() { this._applyTheme(); this._drawBar(); this._draw(); this._drawSheet(); }

  /** The theme the pupil (or the teacher) chose: forced light or dark on this element, or nothing (the portal's own theme). */
  _applyTheme() { const th = this._settings.theme; if (th === 'light' || th === 'dark') this.setAttribute('data-note-theme', th); else this.removeAttribute('data-note-theme'); }

  /** The three-way choice (auto / light / dark); not offered when the page has its own switch (`no-theme-switch`). */
  _themeRow() {
    if (this.hasAttribute('no-theme-switch')) return '';
    const t = (k) => this._t(k); const cur = this._settings.theme;
    return `<div class="vrow" role="group" aria-label="${t('theme')}"><span>${t('theme')}</span><span class="seg">${['auto', 'light', 'dark'].map((v) => `<button type="button" data-theme-set="${v}" aria-pressed="${cur === v}">${t(`theme_${v}`)}</button>`).join('')}</span></div>`;
  }
  _closeSettings() { this._settingsOpen = false; this._drawSheet(); this._bar.querySelector('[data-act=settings]')?.focus?.(); }

  /** Does a track of the note transpose (sax, clarinet, trumpet…)? Then the pupil may choose between the written part and the sounding pitch. */
  _transposes() { return Boolean(this._parsed) && this._parsed.movement.tracks.some((t) => !intervalIsZero(trackTransposition(t))); }
  _concertNow() { return this._settings.concert ?? Boolean(this._parsed && resolveStyle(SID.CONCERT_PITCH, [null, this._parsed.movement.style])); }

  _shown() { return shiftForDisplay(this._parsed.movement, this._settings.transpose); }

  /** The teacher's text above the score (plain text: set as `textContent`, never parsed as HTML). */
  _drawText() {
    const text = this._parsed?.doc?.text ?? '';
    this._textBox.textContent = text; this._textBox.hidden = !text || !this._showsText();
  }
  _showsText() { return true; } // the editor writes it in a field instead (see edit.js)

  _draw() {
    if (!this.isConnected) return;
    this._drawText();
    if (!this._parsed) { this._stage.removeAttribute('role'); this._stage.innerHTML = `<p class="msg">${this._t(this._failed ? 'error' : 'empty')}</p>`; return; }
    const width = Math.max(200, Math.floor(this._stage.clientWidth - 16 || this.clientWidth - 24 || 320));
    this._stage.setAttribute('role', 'img'); this._stage.setAttribute('aria-label', this._t('score'));
    const { work, movement } = this._parsed;
    drawCell(this._stage, { work, movement, shown: this._shown(), width, staffSpace: Math.max(7, Math.min(12, Math.round(width / 46))), mode: 'wrap', zoom: this._settings.zoom, margin: 0, label: this._t('score'), look: { ink: 'var(--ink)', paper: 'transparent' }, styles: { [SID.CHORD_START_TIMESIG]: false, ...(this._settings.concert === null ? {} : { [SID.CONCERT_PITCH]: this._settings.concert }) } });
    for (const svg of this._stage.querySelectorAll('svg[role="img"]')) if (!svg.hasAttribute('aria-label')) svg.setAttribute('aria-label', this._t('score')); // the drawing has a name for a screen reader (axe: svg-img-alt)
  }

  /** The bar keeps what is used all the time (play, loop) and ONE button for the settings: transposition, speed, size, chords and the written / sounding choice live in a sheet that rises from the bottom (like a video player's settings). */
  _drawBar() {
    const s = this._settings; const t = (k) => this._t(k);
    this._bar.innerHTML = `${this._playButton()}`
      + `<button type="button" data-act="loop" aria-pressed="${s.loop}" aria-label="${t('loop')}">${ICON.loop}</button>`
      + `<button type="button" data-act="settings" aria-haspopup="dialog" aria-expanded="${this._settingsOpen}" aria-label="${t('viewSettings')}">${ICON.gear}</button>`;
    this._bar.querySelector('[data-act=play]').disabled = !this._parsed;
  }

  _drawSheet() {
    if (this._viewMode === false || !this._vsheet) return;
    const open = this._settingsOpen && Boolean(this._parsed);
    this._vveil.hidden = !open; this._vsheet.hidden = !open;
    this._vveil.setAttribute('aria-label', this._t('close')); // (the veil is a button: it needs a name for a screen reader, hidden or not)
    if (!open) { this._vsheet.innerHTML = ''; return; }
    const s = this._settings; const t = (k) => this._t(k);
    const stepper = (id, label, text) => `<div class="vrow" role="group" aria-label="${label}"><span>${label}</span><span class="grp"><button type="button" data-step="${id}-" aria-label="${label} — ${t('less')}">−</button><span class="val" aria-live="polite">${text}</span><button type="button" data-step="${id}+" aria-label="${label} — ${t('more')}">+</button></span></div>`;
    this._vsheet.setAttribute('aria-label', t('viewSettings'));
    this._vsheet.innerHTML = `<div class="vhead"><strong>${t('viewSettings')}</strong><button type="button" data-act="settings-close" aria-label="${t('close')}">✕</button></div>`
      + this._themeRow()
      + stepper('transpose', t('transpose'), `${s.transpose > 0 ? '+' : ''}${s.transpose}`)
      + stepper('speed', t('speed'), `${s.speed} %`)
      + stepper('zoom', t('size'), `${Math.round(s.zoom * 100)} %`)
      + (this._chordsButton() ? `<div class="vrow"><span>${t('chords')}</span>${this._chordsButton()}</div>` : '')
      + (this._transposes() ? `<div class="vrow"><span>${t('display')}</span><button type="button" data-act="concert" aria-pressed="${this._concertNow()}">${t('concertPitch')}</button></div>` : '');
  }

  _change(patch) {
    const before = this._settings; this._settings = normalizeSettings({ ...before, ...patch });
    const musical = before.transpose !== this._settings.transpose || before.speed !== this._settings.speed || before.chords !== this._settings.chords;
    this._refresh();
    if (musical && this._playing) { this.stop(); this.play(); } else if (before.loop !== this._settings.loop) this._engine?.setLoop(this._settings.loop ? { start: 0, end: this._end } : null);
    this.dispatchEvent(new CustomEvent('settingschange', { detail: this.settings }));
  }

  /** The audio context is created and unlocked INSIDE the tap (browsers and iOS refuse sound otherwise), before anything is downloaded. */
  _audioContext() {
    if (!this._ctx && webAudioAvailable()) { const C = globalThis.AudioContext ?? globalThis.webkitAudioContext; this._ctx = new C(); }
    this._ctx?.resume?.();
    return this._ctx;
  }

  /** Where the small SoundFonts are: the `sounds` attribute, else the `sounds/` folder next to this file. `sound-mode`: 'family' (default, one small file per family), 'single' (one file), 'light' (no SoundFont). */
  get _soundBase() { return new URL(this.getAttribute('sounds') || defaultSoundsBase, document.baseURI); }
  get _soundMode() { const m = this.getAttribute('sound-mode'); return m === 'light' || m === 'single' ? m : 'family'; }

  _lightEngine(ctx) { return (this._light ??= webAudioAvailable() ? createWebAudioEngine({ context: ctx }) : new NullAudioEngine()); }

  /** The SoundFont engine when it can be had (downloaded on the first tap, then kept), else the light one. */
  async _pickEngine(ctx, sequence) {
    if (this._soundMode === 'light' || !ctx || typeof AudioWorkletNode === 'undefined') return this._lightEngine(ctx);
    try {
      this._sound = await (await import('./sound.js')).soundEngineFor({ context: ctx, base: this._soundBase, mode: this._soundMode, sequence, previous: this._sound ?? null });
      return this._sound.engine;
    } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: noteError(this.lang, 'sound', e?.message ?? e) }));
      return this._lightEngine(ctx);
    }
  }

  /** The sequence to play: what is shown (transposed for display), at the pupil's speed, with the chords when the pupil asks for them. */
  _sequence() {
    // `_shown()` only changes what is DRAWN (the spelling, the key signature): the sound is the original one moved by the same number of semitones (never the drums)
    const seq = buildSequence(this._parsed.movement, { speed: this._settings.speed / 100, ...(this._settings.chords ? { chordSymbols: { play: true } } : {}) });
    return transposeSequence(seq, this._settings.transpose);
  }

  /** Starts playing (call it from a tap). The first time the sound is downloaded: the light engine does not wait, the button shows « … » until the SoundFont is ready. */
  async play() {
    if (!this._parsed || this._playing || this._starting) return;
    prepareAudioSession();
    const ctx = this._audioContext();
    const token = ++this._startToken; this._starting = true; this._drawBar();
    const sequence = this._sequence();
    const engine = await this._pickEngine(ctx, sequence);
    this._starting = false;
    if (token !== this._startToken || !this.isConnected) { this._drawBar(); return; } // stopped (or removed) while the sound was loading
    this._engine = engine;
    this._end = sequence.notes.reduce((m, n) => Math.max(m, n.t + n.duration), 0);
    engine.load(sequence);
    if (this._settings.loop) engine.setLoop({ start: 0, end: this._end });
    engine.play();
    this._playing = true; this._drawBar();
    clearInterval(this._timer);
    this._timer = setInterval(() => { if (!engine.isPlaying() || (!this._settings.loop && engine.position() >= this._end + 0.3)) this.stop(); }, 150);
  }

  stop() {
    this._startToken++; this._starting = false;
    clearInterval(this._timer); this._timer = null;
    if (this._engine && this._playing) { this._engine.stop?.(); this._engine.allNotesOff?.(); }
    this._playing = false; if (this.isConnected) this._drawBar();
  }

  /** The play / stop button: « … » while the sound is loading. */
  _playButton() {
    const t = (k) => this._t(k);
    if (this._starting) return `<button type="button" data-act="play" aria-label="${t('loadingSound')}" aria-busy="true">…</button>`;
    return `<button type="button" data-act="play" aria-label="${t(this._playing ? 'stop' : 'play')}">${this._playing ? ICON.stop : ICON.play}</button>`;
  }

  /** The switch that makes the chords of the grid sound (only offered when the note has some). */
  _chordsButton() {
    const has = Boolean(this._parsed) && this._parsed.movement.tracks.some((tr) => tr.staves.some((st) => st.voices.some((v) => v.measures.some((m) => m.items.some((i) => i.type === 'chordsymbol')))));
    return has ? `<button type="button" data-act="chordsplay" aria-pressed="${this._settings.chords}" aria-label="${this._t('playChords')}">♪ ${this._t('chords')}</button>` : '';
  }

  _onClick = (e) => this._viewClick(e);

  _viewClick(e) {
    const b = e.target.closest('button'); if (!b) return undefined;
    const s = this._settings;
    if (b.dataset.act === 'play') return this._playing ? this.stop() : this.play();
    if (b.dataset.themeSet) return this._change({ theme: b.dataset.themeSet });
    if (b.dataset.act === 'loop') return this._change({ loop: !s.loop });
    if (b.dataset.act === 'settings') { this._settingsOpen = !this._settingsOpen; this._drawBar(); return this._drawSheet(); }
    if (b.dataset.act === 'settings-close') { this._settingsOpen = false; this._drawBar(); return this._drawSheet(); }
    if (b.dataset.act === 'chordsplay') return this._change({ chords: !s.chords });
    if (b.dataset.act === 'concert') return this._change({ concert: !this._concertNow() });
    const [key, sign] = [b.dataset.step.slice(0, -1), b.dataset.step.slice(-1) === '+' ? 1 : -1];
    if (key === 'transpose') this._change({ transpose: s.transpose + sign });
    else if (key === 'speed') this._change({ speed: s.speed + sign * 5 });
    else if (key === 'zoom') this._change({ zoom: Math.round((s.zoom + sign * 0.1) * 10) / 10 });
  }
}

export function defineScorsaireNote(name = 'scorsaire-note') { if (!customElements.get(name)) customElements.define(name, ScorsaireNote); }
export { NOTE_SETTINGS };
