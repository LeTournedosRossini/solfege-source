/*
 * <scorsaire-note mode="edit"> — the teacher's side. Same element as the viewer (it extends it, so play / loop come for free), same document.
 * First slice: one notation staff, a palette of durations, a tap on the staff places a note (the SAME intent as the editor: `enterNote`), undo / redo,
 * add / remove the last measure (1 to 4), clef / time signature / key choice (replacing the staff asks first when something is written).
 *   properties  value (document), prefs ({ clef, timeSig, keySig }: the last choices of the teacher; the page stores them)
 *   events      change { detail: { value: <document text> } } at every gesture, save { detail: { value } } on « Done », cancel on « Close » (full screen), prefschange { detail: prefs }, error
 *   attribute   preview: the note is shown as the pupil sees it (the score and ▶, no tools) with an « Edit » button that opens the editor in full screen; « Done » (event `save`, the shown
 *               value becomes the saved one) and « Close » (event `cancel`, the shown value stays) come back to the preview. The page puts this where the teacher sees the finished note.
 */
import { ScorsaireNote } from './view.js';
import { createNoteDocument, stringifyNoteDocument, parseNoteDocument, normalizeSettings, NOTE_LIMITS } from './document.js';
import { noteText, noteError, drumName } from './i18n.js';
import { newNoteDocument, addMeasure, removeLastMeasure, measureCount, canAddMeasure, canRemoveMeasure, notePrefsOf, normalizePrefs, hasContent, noteStaff, chordsShown, setChordsShown, movementOf, hasTablature, tuningChoices, isTransposing, nextStaffChoice, cycleIndexOf, INSTRUMENT_SECTIONS, INSTRUMENTS, KINDS, CLEFS, TIME_SIGNATURES, GUITAR_SOUNDS, MAX_CAPO, NOTE_PREFS_DEFAULTS } from './editmodel.js';
import { createDocument } from '../model/document.js';
import { createScoreView } from '../view/score-view.js';
import { SID } from '../model/sid.js';
import { resolveStyle } from '../model/props.js';
import { enterNote, voiceForEntry, DEFAULT_ENTRY } from '../ui/noteentry-intents.js';
import { shiftNotes } from '../ui/noteentry-keyboard.js';
import { shiftTabNotes } from '../ui/creation-intents.js';
import { deleteItem, removeNoteFromChord } from '../model/noteedit.js';
import { getProperty } from '../model/props.js';
import { drumStaffIcon } from '../ui/mark-icons.js';
import { drumHeadGlyph } from '../model/drumheads.js';
import { setCellChord, eraseCell, setMeasureSlots, symbolAtCell, resolveCell } from '../ui/chordentry-intents.js';
import { entryRoots } from '../model/chordentry.js';
import { PID } from '../model/pid.js';
import glyphs from '../glyphs/bravura-subset.json' with { type: 'json' };

const DURATIONS = [['whole', 'metNoteWhole'], ['half', 'metNoteHalfUp'], ['quarter', 'metNoteQuarterUp'], ['eighth', 'metNote8thUp'], ['16th', 'metNote16thUp']];
const STAFF_SPACE = 14;
const MIN_STAFF_SPACE = 7;
const MARGIN = 6;
const QUALITIES = [['', 'maj'], ['m', 'm'], ['7', '7'], ['M7', 'maj7'], ['m7', 'm7'], ['6', '6'], ['m6', 'm6'], ['sus4', 'sus4'], ['sus2', 'sus2'], ['o', 'dim'], ['o7', 'dim7'], ['m7b5', 'm7♭5'], ['aug', 'aug'], ['9', '9'], ['add9', 'add9']];
const PREFS_KEY = 'scorsaire.note.prefs';
const THEME_KEY = 'scorsaire.note.theme';

/** A real Bravura glyph as an inline icon (the path is in font units, y down, 250 per staff space). */
function glyphIcon(name, h = 26) {
  const g = glyphs.glyphs[name]; const [x0, , x1] = [g.bbox.bBoxSW[0] * 250, 0, g.bbox.bBoxNE[0] * 250]; const hh = (g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1]) * 250;
  return `<svg viewBox="${x0} 0 ${x1 - x0} ${hh}" height="${h}" width="${Math.max(8, (h * (x1 - x0)) / hh)}" aria-hidden="true"><path d="${g.path}" fill="currentColor"/></svg>`;
}

const EXTRA_STYLE = `
/* the pad of frets of a tablature: opens beside the tap, like the editor's own */
.fretpop{position:fixed;z-index:30;display:flex;flex-direction:column;gap:.25rem;padding:.5rem;background:var(--md-sys-color-surface,#fff);color:var(--md-sys-color-on-surface,#1c1b1f);border:1px solid var(--md-sys-color-outline,#79747e);border-radius:.75rem;box-shadow:0 .25rem .75rem rgba(0,0,0,.3)}
.fretpop .row{display:flex;gap:.25rem}
.fretpop button{min-width:2.75rem;min-height:2.75rem;padding:0;font-weight:700}
/* the zones of the editor emptied by the preview must not leave their frames behind */
.note-text[hidden],.top[hidden],.pal[hidden],.sounds[hidden],.nav[hidden],.hint[hidden],.live[hidden]{display:none}
/* FULL SCREEN (attribute fullscreen): the editor covers the window; the score takes the room the tools leave and sits in the middle of it */
:host([fullscreen]){position:fixed;inset:0;z-index:var(--scorsaire-fullscreen-z,2000);background:var(--md-sys-color-surface,#fff)}
:host([fullscreen]) .card{height:100%;display:flex;flex-direction:column;border:0;border-radius:0}
:host([fullscreen]) .stagebox{flex:1 1 auto;min-height:0;display:flex}
:host([fullscreen]) .stage{flex:1 1 auto;min-width:0;display:flex;align-items:center}
.stagebox{position:relative}
.stage .holder{margin-inline:auto}
.note-text{display:block;width:100%;box-sizing:border-box;resize:none;border:0;border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0);background:transparent;color:var(--md-sys-color-on-surface,#1c1b1f);font:inherit;font-size:1rem;line-height:1.35;padding:.5rem .75rem;min-height:2.5rem;max-height:7rem;overflow:auto;outline-offset:-2px}
.note-text:focus{max-height:45vh}
.note-text::placeholder{color:var(--md-sys-color-on-surface-variant,#49454f);opacity:.75}
:host([mode=view]) .note-text{display:none}
/* the previous / next measure sit at the bottom corners of the score, over it, with the count between them */
.arrows{position:absolute;left:.25rem;right:.25rem;bottom:.25rem;display:flex;justify-content:space-between;align-items:center;pointer-events:none}
.arrows[hidden]{display:none}
.arrows button{pointer-events:auto;min-width:2.5rem;min-height:2.5rem;background:color-mix(in srgb,var(--md-sys-color-surface,#fff) 85%,transparent)}
.arrows .count{font-variant-numeric:tabular-nums;color:var(--md-sys-color-on-surface-variant,#49454f);font-size:.8125rem}
:host([mode=view]) .arrows{display:none}
.nav button{min-width:2.5rem;padding:0 .5rem}
.sub .grid{display:flex;flex-wrap:wrap;gap:.5rem}
.sub h4{margin:.5rem 0 .25rem;font-size:.8125rem;font-weight:600;color:var(--md-sys-color-on-surface-variant,#49454f)}
.sub .inst{display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.15;min-width:4.5rem;padding:.25rem .5rem}
.sub .inst small{font-size:.6875rem;opacity:.75}
.panel .pick{display:inline-flex;gap:.5rem;align-items:center;justify-content:space-between;min-width:6rem}
.bar button{min-width:2.5rem;padding:0 .5rem}
.bar .grp .val{min-width:1.5rem}
:host(:not([mode=view])) .bar{flex-wrap:wrap;gap:.25rem}
.bar button{white-space:nowrap}
:host(:not([mode=view])) .bar .grp{flex-wrap:nowrap;flex:none;gap:.125rem}
:host(:not([mode=view])) .bar [data-act=done]{margin-inline-start:auto}

.pal,.tools{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;padding:.5rem}
.sounds{display:flex;gap:.5rem;overflow-x:auto;padding:0 .5rem .5rem;border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0);-webkit-overflow-scrolling:touch}
.sounds{flex:none}
.sounds button{flex:none;font-size:.8125rem}
.sounds[hidden],.chords[hidden]{display:none}
.pal{border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0)}
.pal:empty{display:none}
.stage{touch-action:pan-x;cursor:crosshair;padding:.25rem 0;position:relative}
.holder{position:relative;width:max-content}
.sel{position:absolute;inset:0;pointer-events:none}
.sel i{position:absolute;border:2px solid var(--md-sys-color-primary,#6750a4);background:color-mix(in srgb,var(--md-sys-color-primary,#6750a4) 22%,transparent);border-radius:.25rem}
.nav{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;padding:.25rem .5rem .5rem}
.nav .val{min-width:6rem;text-align:center}
.panel{padding:.75rem;border-top:1px solid var(--md-sys-color-outline-variant,#cac4d0);display:flex;flex-direction:column;gap:.5rem}
.panel .row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.panel .lab{min-width:6rem;color:var(--md-sys-color-on-surface-variant,#49454f)}
.card{position:relative}
:host([mode=view]) :is(.top,.pal,.sounds,.nav,.chords,.hint){display:none}
:host([mode=view]) .stage{cursor:default;touch-action:auto;padding:.5rem}
.top{display:flex;flex-wrap:wrap;gap:.2rem;align-items:center;padding:.375rem .25rem;border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0)}
.top button{min-width:2.1rem;min-height:2.5rem;padding:0 .25rem;display:inline-flex;align-items:center;justify-content:center}
.top button.dur{width:2.1rem;padding:0}
.top button svg{max-width:1.5rem;max-height:1.8rem}
.top .kind{padding:0 .5rem;font-weight:600;min-width:3rem}
.top .sep{flex:1}
.veil{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.4);border:0;border-radius:0;min-width:0;min-height:0;padding:0}
.sheet{position:fixed;z-index:21;top:0;left:0;right:0;max-width:40rem;margin-inline:auto;max-height:88vh;max-height:88dvh;overflow:auto;padding-top:env(safe-area-inset-top);background:var(--md-sys-color-surface,#fff);color:var(--md-sys-color-on-surface,#1c1b1f);border-bottom:1px solid var(--md-sys-color-outline,#79747e);border-radius:0 0 .75rem .75rem;box-shadow:0 .5rem 1rem rgba(0,0,0,.3);animation:drop .18s ease-out}
@keyframes drop{from{transform:translateY(-100%)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.sheet{animation:none}}
.sheet .head{display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;position:sticky;top:0;background:inherit;border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0)}
.stage{overflow-y:auto}
/* A phone held sideways (about 360 px high): the tools move to the sides, the score keeps the height. */
@media (orientation:landscape) and (max-height:520px){
  :host(:not([mode=view])) .card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:auto auto auto minmax(0,1fr) auto auto auto;grid-template-areas:"top top bar" "text text text" "pal sounds sounds" "pal stage stage" "pal hint hint" "pal nav nav" "live live live";align-items:start}
  .top{grid-area:top;padding:.25rem .5rem}
  .pal{grid-area:pal;flex-direction:column;flex-wrap:wrap;max-height:calc(100dvh - 4.5rem);align-content:flex-start;border-bottom:0;border-right:1px solid var(--md-sys-color-outline-variant,#cac4d0);padding:.25rem}
  .sounds{grid-area:sounds;padding:.25rem}
  .stagebox,[data-grid-mode]{grid-area:stage}
  [data-grid-mode]{max-height:calc(100dvh - 7.5rem);overflow:auto;min-width:0}
  .note-text{grid-area:text;padding-block:.25rem}
  .stage{max-height:calc(100dvh - 7.5rem)}
  .hint{display:none}
  .nav{grid-area:nav;padding:.25rem .5rem;flex-wrap:nowrap;overflow-x:auto}
  .nav button{flex:none}
  /* sideways: the play / undo / measures / done bar joins the top bar on the same line (the screen is wide, not high) */
  :host(:not([mode=view])) .bar{grid-area:bar;align-self:stretch;flex-direction:row;flex-wrap:nowrap;align-content:normal;max-height:none;border-top:0;border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0);padding:.25rem .375rem}
  .live{grid-area:live}
  .sheet{max-height:94dvh}
  .chords{max-height:70dvh;max-width:48rem}
}
.live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.chords{position:fixed;z-index:15;left:0;right:0;bottom:0;max-width:40rem;margin-inline:auto;max-height:46vh;max-height:46dvh;overflow:auto;background:var(--md-sys-color-surface,#fff);color:var(--md-sys-color-on-surface,#1c1b1f);border-top:1px solid var(--md-sys-color-outline,#79747e);border-radius:.75rem .75rem 0 0;box-shadow:0 -.5rem 1rem rgba(0,0,0,.25);padding:.5rem .5rem calc(.5rem + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:.5rem;animation:rise .18s ease-out}
@keyframes rise{from{transform:translateY(100%)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.chords{animation:none}}
.chords .row{display:flex;flex-wrap:wrap;gap:.375rem;align-items:center}
.chords .big3{display:flex;gap:.5rem}
.chords .big3 button{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:3.5rem;line-height:1.2}
.chords .big3 small{font-size:.75rem;opacity:.75}
.chords .big3 strong{font-size:1.25rem}
.chords .lab{min-width:5.5rem;color:var(--md-sys-color-on-surface-variant,#49454f);font-size:.8125rem}
.chords button{min-width:2.75rem;padding:0 .5rem}
.hint{padding:0 .75rem .5rem;font-size:.8125rem;color:var(--md-sys-color-on-surface-variant,#49454f)}
.warn{color:var(--md-sys-color-error,#b3261e)}
`;

export class ScorsaireNoteEdit extends ScorsaireNote {
  constructor() {
    super();
    const style = document.createElement('style'); style.textContent = EXTRA_STYLE; this._root.prepend(style);
    this._card = this._root.querySelector('.card');
    this._pal = document.createElement('div'); this._pal.className = 'pal'; this._pal.setAttribute('role', 'toolbar');
    this._top = document.createElement('div'); this._top.className = 'top';
    this._sounds = document.createElement('div'); this._sounds.className = 'sounds'; this._sounds.setAttribute('role', 'toolbar');
    this._card.prepend(this._sounds); this._card.prepend(this._pal); this._card.prepend(this._top);
    // the text above the score (a title, or an instruction of a few sentences): a plain field at the very top, empty = nothing is written
    this._text = '';
    this._textField = document.createElement('textarea'); this._textField.className = 'note-text'; this._textField.rows = 1; this._textField.maxLength = NOTE_LIMITS.maxText;
    this._textField.setAttribute('aria-label', this._t('textLabel')); this._textField.placeholder = this._t('textPlaceholder'); this._textField.spellcheck = true;
    this._textField.addEventListener('input', () => this._textInput());
    this._textField.addEventListener('focus', () => this._fitText()); this._textField.addEventListener('blur', () => this._fitText());
    this._card.prepend(this._textField);
    this._box = document.createElement('div'); this._box.className = 'stagebox'; this._stage.replaceWith(this._box); this._box.append(this._stage);
    this._arrows = document.createElement('div'); this._arrows.className = 'arrows'; this._arrows.hidden = true; this._box.append(this._arrows);
    this._hint = document.createElement('div'); this._hint.className = 'hint'; this._box.after(this._hint);
    this._nav = document.createElement('div'); this._nav.className = 'nav'; this._hint.after(this._nav);
    this._chordBox = document.createElement('div'); this._chordBox.className = 'chords'; this._chordBox.hidden = true; this._nav.after(this._chordBox);
    this._live = document.createElement('div'); this._live.className = 'live'; this._live.setAttribute('role', 'status'); this._card.append(this._live);
    this._panelBox = document.createElement('div'); this._card.append(this._panelBox);
    this._entry = { ...DEFAULT_ENTRY, duration: { base: 'quarter', dots: 0 }, rest: false, fret: 0, sound: 'snare' };
    this._open = false; this._pending = null; this._prefs = null; this._editDoc = null; this._cur = 0; this._mode = 'write'; this._selected = null; this._cell = null; this._accidental = 'sharp'; this._notice = ''; this._sub = null; this._zoom2 = false; this._chordSub = null;
    this._stage.addEventListener('click', (e) => this._tapStage(e));
    for (const zone of [this._top, this._pal, this._sounds, this._nav, this._arrows, this._chordBox, this._panelBox]) zone.addEventListener('click', (e) => this._onClick(e)); // the bar is handled by the viewer's listener
  }

  /** The viewer: `mode="view"`, or a `preview` that is not being edited (the editor opens in full screen on « Edit »). */
  get _viewMode() { return this.getAttribute('mode') === 'view' || (this.hasAttribute('preview') && !this.hasAttribute('fullscreen')); }
  static get observedAttributes() { return [...super.observedAttributes, 'preview', 'fullscreen']; }
  attributeChangedCallback(name) {
    if (this.isConnected && this.hasAttribute('preview') && (name === 'fullscreen' || name === 'preview')) { this._load(); return; } // from the preview to the editor and back: what is shown is rebuilt from `value`
    super.attributeChangedCallback(name);
  }
  /** The zones of the editor are emptied when the preview is shown. */
  _clearEditZones() {
    this._closeFretPop();
    for (const z of [this._top, this._pal, this._sounds, this._nav, this._arrows, this._chordBox, this._panelBox, this._hint, this._live]) if (z) { z.innerHTML = ''; z.hidden = true; }
    if (this._textField) this._textField.hidden = true;
  }

  get prefs() { return { ...(this._prefs ?? this._storedPrefs()) }; }
  set prefs(p) { this._prefs = { ...NOTE_PREFS_DEFAULTS, ...p }; }
  _storedPrefs() { try { return { ...NOTE_PREFS_DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return { ...NOTE_PREFS_DEFAULTS }; } }
  _savePrefs() {
    const p = notePrefsOf(this._editDoc); this._prefs = p;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window: the page's own store is the reliable one */ }
    this.dispatchEvent(new CustomEvent('prefschange', { detail: { ...p } }));
  }

  /** The document being written (also after `value` is set). */
  get document() { return this._editDoc; }

  _load() {
    if (this._viewMode) return super._load();
    this.stop(); this._unsub?.(); this._view = null; this._failed = false;
    try {
      if (this._value != null && this._value !== '') { const parsed = parseNoteDocument(this._value); this._editDoc = createDocument(parsed.work); this._setTextField(parsed.doc.text ?? ''); }
      else { this._editDoc = newNoteDocument(this.prefs, { lang: this.lang }); this._setTextField(''); }
    } catch (e) {
      this._editDoc = newNoteDocument(this.prefs, { lang: this.lang }); this._setTextField('');
      this.dispatchEvent(new CustomEvent('error', { detail: noteError(this.lang, e.code ?? 'unknown', e.message) }));
    }
    this._unsub = this._editDoc.subscribe(() => this._afterChange());
    this._sync(); this._refresh();
  }

  _sync() { this._parsed = { work: this._editDoc.work, movement: movementOf(this._editDoc) }; }
  _afterChange() { this._sync(); this._refresh(); }
  _emitChange() { this.dispatchEvent(new CustomEvent('change', { detail: { value: stringifyNoteDocument(createNoteDocument(this._editDoc.work, { text: this._text })) } })); }
  _showsText() { return this._viewMode; } // in the editor the text is written in its field, not shown as a paragraph
  /** The field grows with what is typed (up to a few lines, then scrolls); the document is told once the typing pauses. */
  _textInput() {
    this._fitText(); this._text = this._textField.value;
    clearTimeout(this._textTimer); this._textTimer = setTimeout(() => { if (this._editDoc) this._emitChange(); }, 300);
  }
  _setTextField(text) {
    this._text = text; const f = this._textField; if (!f) return;
    f.value = text; f.setAttribute('aria-label', this._t('textLabel')); f.placeholder = this._t('textPlaceholder');
    this._fitText(); requestAnimationFrame(() => this._fitText()); // (once more when the page has laid the field out: a long text must show its first lines at once)
  }
  /** The field grows with the text: up to 7 rem, up to 45 % of the screen while the teacher is in it (to read a long text whole before saving). It scrolls beyond. */
  _fitText() {
    const f = this._textField; if (!f) return;
    f.style.height = 'auto';
    const limit = this.shadowRoot?.activeElement === f ? Math.round((window.innerHeight || 800) * 0.45) : 112;
    f.style.height = `${Math.min(f.scrollHeight, limit)}px`;
  }
  _say(key) { this._live.textContent = ''; this._live.textContent = this._t(key); }

  _onKey = (e) => { if (e.key === 'Escape' && this._fretHit) { this._closeFretPop(); return; } if (e.key === 'Escape' && this._open) { this._open = false; this._pending = null; this._refresh(); } };

  connectedCallback() {
    if (!this._viewMode) { try { const th = localStorage.getItem(THEME_KEY); if (th) this._settings = normalizeSettings({ ...this._settings, theme: th }); } catch { /* no storage */ } } // the teacher's theme comes back on this device
    super.connectedCallback(); this.addEventListener('keydown', this._onKey); if (!this._viewMode && !this._editDoc) this._load(); }

  _refresh() { if (this._viewMode) { this._clearEditZones(); return super._refresh(); }
    for (const z of [this._top, this._pal, this._sounds, this._nav, this._hint, this._live, this._panelBox]) if (z) z.hidden = false; if (this._textField) this._textField.hidden = false; if (!this._editDoc) return; this._drawTop(); this._drawPalette(); this._drawSounds(); this._draw(); this._drawNav(); this._drawChords(); this._drawBar(); this._drawPanel(); }

  _summary() {
    const p = notePrefsOf(this._editDoc); const t = (k) => this._t(k);
    const what = p.kind === 'score' ? (p.instrument === 'none' ? `${t('kindScore')} · ${t(`clef${p.clef}`)}` : `${t(`inst_${p.instrument}`)}${p.concert ? ` · ${t('concertPitch')}` : ''}`) : t(`kind${p.kind[0].toUpperCase()}${p.kind.slice(1)}`);
    return what; // the meter is in the set-up sheet, not repeated on the top line
  }

  /** What the type button says: the clef (sol, fa, alto, ténor), the instrument, or the kind of staff. */
  _kindLabel() {
    const p = notePrefsOf(this._editDoc); const t = (k) => this._t(k);
    if (p.kind === 'score') return p.instrument === 'none' ? t(`clef${p.clef}`) : t(`inst_${p.instrument}`);
    return { piano: t('abbrPiano'), guitar: t('shortGuitar'), bass: t('shortBass'), drums: t('shortDrums') }[p.kind];
  }

  /** The top bar: the durations, the dot and the rest, then the set-up sheet (meter, key, instrument, tuning…). */
  _drawTop() {
    const t = (k) => this._t(k); const e = this._entry;
    this._top.innerHTML = DURATIONS.map(([id, glyph]) => `<button type="button" class="dur" data-dur="${id}" aria-pressed="${e.duration.base === id}" aria-label="${t(id)}">${glyphIcon(glyph, id === 'whole' ? 12 : 26)}</button>`).join('')
      + `<button type="button" class="dur" data-dot aria-pressed="${e.duration.dots === 1}" aria-label="${t('dot')}">${glyphIcon('metAugmentationDot', 8)}</button>`
      + `<button type="button" class="dur" data-rest aria-pressed="${e.rest}" aria-label="${t('rest')}">${glyphIcon('restQuarter')}</button>`
      + `<span class="sep"></span><button type="button" data-act="setup" aria-expanded="${this._open}" aria-label="${t('setup')}">⚙</button>`;
  }

  /** Under the top bar: the fret stepper of a tablature (the only thing that does not fit up there). */
  _drawPalette() {
    this._pal.innerHTML = ''; // (the frets of a tablature are chosen on the pad that opens where the staff is touched)
    this._drawTop();
  }

  /** The sounds of the drum kit as a row of chips (drums only): the teacher picks the sound, then taps WHERE in the measure it falls. */
  _drumSounds() {
    const map = getProperty(noteStaff(this._editDoc), PID.PERCMAP);
    const byId = new Map((map?.sounds ?? []).map((x) => [x.id, x]));
    return [...byId.values()]; // the map's own order (Scorsaire's: top of the staff first)
  }

  _drawSounds() {
    const drums = notePrefsOf(this._editDoc).kind === 'drums';
    this._sounds.hidden = !drums || !!this._grid?.isActive(); // the grid has its own palette: the chips would only take room (and a phone held sideways has little)
    this._sounds.setAttribute('aria-label', this._t('sounds'));
    if (!drums) { this._sounds.innerHTML = ''; return; }
    const all = this._drumSounds();
    if (!all.some((x) => x.id === this._entry.sound)) this._entry.sound = (all.find((x) => x.id === 'bassDrum1') ?? all.find((x) => x.id === 'bassDrum') ?? all[0])?.id ?? null;
    // the notehead on its place of the staff, no text: a musician knows the symbol; the name stays in the tooltip and for the screen reader
    this._sounds.replaceChildren(...all.map((x) => {
      const b = document.createElement('button'); const name = drumName(this.lang, x.id, x.name);
      b.type = 'button'; b.dataset.soundId = x.id; b.title = name; b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', String(this._entry.sound === x.id));
      const ic = drumStaffIcon(glyphs, drumHeadGlyph(x.head ?? 'normal', 'quarter'), x.line ?? 4); if (ic) b.append(ic); else b.textContent = name;
      return b;
    }));
  }

  _draw() {
    if (this._viewMode) return super._draw();
    if (!this.isConnected || !this._editDoc) return;
    // ONE system, justified: one or two measures fill the WIDTH of the screen; with three or four the system is half a screen wider per extra measure and the stage scrolls from one
    // measure to the next (the clef / key / meter stay at the left edge). The measures are equal (regular) and never wrap onto a second line.
    const mv = movementOf(this._editDoc); const n = measureCount(this._editDoc);
    const cs = getComputedStyle(this._stage); const inner = (this._stage.clientWidth || this.clientWidth || 360) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0); // the room the drawing has
    const stageWidth = Math.max(240, Math.floor(inner));
    const getStyle = (sid) => (sid === SID.REGULAR_MEASURES ? true : sid === SID.MEASURES_PER_SYSTEM ? n : sid === SID.CHORD_START_TIMESIG ? false : resolveStyle(sid, [null, mv.style])); // the chord row shows the chords and the bars only
    // the staff space is the biggest (14 px down to 7) for which everything fits on ONE line at that width (a piano or a busy measure on a narrow phone needs a smaller one)
    let ss = STAFF_SPACE;
    for (;;) {
      const width = (stageWidth * Math.max(1, n / 2) - 2 * MARGIN) / ss; // in staff spaces, like the layout wants it
      this._view = createScoreView({ id: 'note-edit', doc: this._editDoc, glyphs, movement: mv, width, staffSpace: ss, margin: MARGIN, getStyle, justifyLast: true });
      if (ss <= MIN_STAFF_SPACE || this._view.layout().systems.length === 1) break;
      ss -= 1;
    }
    this._ss = ss;
    if (this._selected) this._view.select([this._selected]);
    this._stage.setAttribute('role', 'group'); this._stage.setAttribute('aria-label', this._t('score'));
    this._stage.innerHTML = `<div class="holder">${this._view.render().svg}<div class="sel"></div></div>`;
    const svg = this._stage.querySelector('.holder svg'); if (svg) { svg.style.display = 'block'; svg.style.color = 'var(--ink)'; }
    // ×2 stretches the drawing in HEIGHT only: the measures keep the width of the screen (one measure is always seen whole), the staff gets twice as tall to touch the pitch more precisely
    this._stretch = this._zoom2 ? 2 : 1;
    if (svg && this._zoom2) { const h = svg.viewBox.baseVal.height; svg.setAttribute('preserveAspectRatio', 'none'); svg.style.height = `${h * 2}px`; const sel = this._stage.querySelector('.sel'); if (sel) { sel.style.bottom = 'auto'; sel.style.height = `${h}px`; sel.style.transformOrigin = '0 0'; sel.style.transform = 'scaleY(2)'; } }
    this._hint.textContent = this._t(this._mode === 'write' ? 'tapHint' : 'nothing');
    this._geometry();
    this._marks();
    this._scrollTo(this._cur, false);
  }

  /** Where the measures are, in pixels of the drawing: [{ x1, x2 }]. The clef, key and meter are written once, at the start of the first measure. */
  _geometry() {
    const sys = this._view.layout().systems[0]; const ss = this._ss;
    const px = (sp) => MARGIN + (sys.x0 + sp) * ss;
    this._zones = sys.measures.map((m, k) => ({ x1: k === 0 ? 0 : px(m.x ?? m.start), x2: px(m.barX ?? (m.x ?? m.start) + (m.width ?? 0)) }));
  }

  /** Highlight of the selected note (drawn over the score, never inside the engine's SVG). */
  _marks() {
    const layer = this._stage.querySelector('.sel'); if (!layer) return;
    const cell = this._cell && this._view.cellZones().find((z) => z.staffId === this._cell.staffId && z.measureId === this._cell.measureId && z.cell === this._cell.cell);
    const cellMark = cell ? `<i style="left:${cell.x1}px;top:${cell.y1}px;width:${cell.x2 - cell.x1}px;height:${cell.y2 - cell.y1}px"></i>` : '';
    layer.innerHTML = cellMark + this._view.selectionRects().map((r) => `<i style="left:${r.x1 - 3}px;top:${r.y1 - 3}px;width:${r.x2 - r.x1 + 6}px;height:${r.y2 - r.y1 + 6}px"></i>`).join('');
  }

  _scrollTo(k, smooth = true) {
    const z = this._zones?.[k]; if (!z) return;
    const left = k === 0 ? 0 : Math.max(0, z.x1 - 8);
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._stage.scrollTo({ left, behavior: smooth && !calm ? 'smooth' : 'auto' });
  }

  _goto(k) {
    const n = measureCount(this._editDoc); this._cur = Math.max(0, Math.min(n - 1, k));
    this._drawNav(); this._scrollTo(this._cur);
  }

  /** Under the score: the mode (write / select), delete, the chord grid, the zoom. The measure arrows are drawn over the score, at its bottom corners. */
  _drawNav() {
    if (!this._editDoc) return;
    const t = (k) => this._t(k); const n = measureCount(this._editDoc); const w = this._mode === 'write';
    this._arrows.hidden = n < 2;
    this._arrows.innerHTML = n < 2 ? '' : `<button type="button" data-act="prev" aria-label="${t('previous')}" ${this._cur > 0 ? '' : 'disabled'}>◀</button><span class="count" aria-live="polite">${this._cur + 1} / ${n}</span><button type="button" data-act="next" aria-label="${t('next')}" ${this._cur < n - 1 ? '' : 'disabled'}>▶</button>`;
    this._nav.innerHTML = `<button type="button" data-mode="write" aria-pressed="${w}">${t('modeWrite')}</button><button type="button" data-mode="select" aria-pressed="${!w}" aria-label="${t('modeSelect')}">${t('modeSelectShort')}</button>`
      + (w ? '' : `<button type="button" data-act="up" aria-label="${t('semitoneUp')}" ${this._shiftable() ? '' : 'disabled'}>+½</button><button type="button" data-act="down" aria-label="${t('semitoneDown')}" ${this._shiftable() ? '' : 'disabled'}>−½</button>`)
      + `<button type="button" data-act="delete" aria-label="${t('delete')}" ${this._selected ? '' : 'disabled'}>${t('deleteShort')}</button>`
      + (notePrefsOf(this._editDoc).kind === 'drums' ? `<button type="button" data-act="grid" aria-pressed="${!!this._grid?.isActive()}" aria-label="${t('gridHint')}">${t('gridButton')}</button>` : '')
      + `<button type="button" data-act="chords" aria-pressed="${chordsShown(this._editDoc)}" aria-label="${t('chords')}">${t('chordsShort')}</button>`
      + `<button type="button" data-act="zoom2" aria-pressed="${this._zoom2}" aria-label="${t(this._zoom2 ? 'zoomBack' : 'zoomTwice')}">×2</button>`;
  }

  _drawBar() {
    if (this._viewMode) {
      super._drawBar();
      if (this.hasAttribute('preview')) this._bar.insertAdjacentHTML('beforeend', `<button type="button" data-act="edit" class="on">${this._t('edit')}</button>`);
      return undefined;
    }
    if (!this._editDoc) return undefined;
    const t = (k) => this._t(k); const d = this._editDoc;
    this._bar.innerHTML = `${this._playButton()}`
      + `<button type="button" data-act="undo" aria-label="${t('undo')}" ${d.canUndo() ? '' : 'disabled'}>↶</button><button type="button" data-act="redo" aria-label="${t('redo')}" ${d.canRedo?.() ? '' : 'disabled'}>↷</button>`
      + `<div class="grp" role="group" aria-label="${t('measures')}"><button type="button" data-act="rm" aria-label="${t('removeMeasure')}" ${canRemoveMeasure(d) ? '' : 'disabled'}>−</button><span class="val" aria-live="polite">${measureCount(d)}</span><button type="button" data-act="add" aria-label="${t('addMeasure')}" ${canAddMeasure(d) ? '' : 'disabled'}>+</button></div>`
      + this._chordsButton()
      + (this.hasAttribute('fullscreen') ? `<button type="button" data-act="close" aria-label="${t('closeAria')}">${t('close')}</button>` : '')
      + `<button type="button" data-act="done" class="on">${t('done')}</button>`;
  }

  /** Grid entry for the drums (the editor's own mode, see ui/grid-dom.js): the score gives way to a grid of beats, the hits are put on it, « Apply » writes the durations in ONE undoable step. Loaded on the first tap. */
  async _toggleGrid() {
    if (this._grid?.isActive()) { this._grid.close(false); return undefined; }
    const d = this._editDoc; const staff = noteStaff(d); if (!staff) return undefined;
    const { mountGridMode } = await import('../ui/grid-dom.js');
    const app = { doc: d, entryCursor: () => null, view: () => null, drumSwitchGroups: () => [], pickDrumSound: () => {}, edit: (name, fn) => { const r = d.transaction(name, fn); this._emitChange(); return r; } };
    const label = (key, params) => { if (key.startsWith('drum.sound.')) return drumName(this.lang, key.slice(11), key); let s = this._t(key); if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, v); return s; };
    this._grid?.destroy();
    this._grid = mountGridMode({ app, glyphs, label, scoreHost: this._box, staffSpace: 14, headsOnly: true, stretch: this._zoom2 ? 2 : 1, onChange: (active) => { if (!active) { this._grid?.destroy(); this._grid = null; } if (this._editDoc === d) this._refresh(); } });
    this._grid.open(staff);
    this._drawNav();
    return undefined;
  }

  /** The set-up sheet. The choices with a long list (the instrument, the time signature) are BUTTONS that open a sheet of their own (`this._sub`), a back arrow returns to the first one. */
  _drawPanel() {
    if (!this._open) { this._panelBox.innerHTML = ''; return; }
    const t = (k) => this._t(k); const pend = this._pending; const eff = pend ?? notePrefsOf(this._editDoc);
    const pick = (attr, value, label, on, extra = '') => `<button type="button" data-${attr}="${value}" aria-pressed="${on}" ${extra}>${label}</button>`;
    const row = (label, inner) => `<div class="row"><span class="lab">${label}</span>${inner}</div>`;
    const cap = (k) => k[0].toUpperCase() + k.slice(1);
    const kindLabel = (k) => ({ score: t('kindScore'), piano: t('abbrPiano'), guitar: t('abbrGuitar'), bass: t('abbrBass'), drums: t('abbrDrums') })[k];
    let title = t('setup'); let rows = '';
    if (this._sub === 'instrument') {
      title = t('pickInstrument');
      const inst = (k) => `<button type="button" class="inst" data-instrument="${k}" aria-pressed="${eff.instrument === k}" aria-label="${t(`inst_${k}`)}"><span>${t(`abbr_${k}`)}</span><small>${k === 'none' ? '' : t(`inst_${k}`)}</small></button>`;
      rows = `<div class="sub"><div class="grid">${inst('none')}</div>${INSTRUMENT_SECTIONS.map(([sec, list]) => `<h4>${t(`section${cap(sec)}`)}</h4><div class="grid">${list.map(inst).join('')}</div>`).join('')}</div>`;
    } else if (this._sub === 'timeSig') {
      title = t('pickTimeSig');
      rows = `<div class="sub"><div class="grid">${TIME_SIGNATURES.map(([n, d]) => pick('sig', `${n}/${d}`, `${n}/${d}`, eff.timeSig[0] === n && eff.timeSig[1] === d)).join('')}</div></div>`;
    } else {
      rows = row(t('type'), KINDS.map((k) => pick('kind', k, kindLabel(k), eff.kind === k)).join(''));
      if (eff.kind === 'score') {
        rows += row(t('instrument'), `<button type="button" class="pick" data-sub="instrument" aria-haspopup="dialog">${t(`abbr_${eff.instrument}`)} <span aria-hidden="true">▸</span></button>`);
        if (eff.instrument === 'none') rows += row(t('clef'), CLEFS.map((c) => pick('clef', c, t(`clef${c}`), eff.clef === c)).join(''));
        if (isTransposing(eff)) rows += row(t('writing'), [['false', 'written', !eff.concert], ['true', 'concertPitch', eff.concert]].map(([v, k, on]) => pick('concert', v, t(k), on)).join(''));
      }
      if (eff.kind === 'guitar') rows += row(t('sound'), Object.keys(GUITAR_SOUNDS).map((k) => pick('sound', k, t(`sound${cap(k)}`), eff.sound === k)).join(''));
      if (eff.kind === 'bass') rows += row(t('strings'), [4, 5].map((n) => pick('strings', n, String(n), Number(eff.strings) === n)).join(''));
      if (hasTablature(eff.kind)) {
        rows += row(t('tuning'), tuningChoices(eff).map((k) => pick('tuning', k, t(`tuning${cap(k)}`), eff.tuning === k)).join(''));
        rows += row(t('capo'), `<button type="button" data-capo="-1" aria-label="${t('capo')} −">−</button><span class="val">${eff.capo ? eff.capo : t('none')}</span><button type="button" data-capo="1" aria-label="${t('capo')} +">+</button>`);
      }
      rows += row(t('timeSig'), `<button type="button" class="pick" data-sub="timeSig" aria-haspopup="dialog">${eff.timeSig[0]}/${eff.timeSig[1]} <span aria-hidden="true">▸</span></button>`);
      rows += row(t('key'), `<button type="button" data-key="-1" aria-label="${t('key')} ♭">♭</button><span class="val">${eff.keySig === 0 ? '♮' : `${Math.abs(eff.keySig)}${eff.keySig > 0 ? '♯' : '♭'}`}</span><button type="button" data-key="1" aria-label="${t('key')} ♯">♯</button>`);
    }
    const ask = pend ? `<div class="row"><span class="warn" role="alert">${t('confirmReset')}</span><button type="button" data-act="confirm" class="on">${t('confirm')}</button><button type="button" data-act="cancel">${t('cancel')}</button></div>` : '';
    const back = this._sub ? `<button type="button" data-act="subback" aria-label="${t('back')}">◂</button>` : '';
    if (!this._sub) rows += this._themeRow().replace('class="vrow"', 'class="row"').replace('<span>', '<span class="lab">'); // the theme: a choice of the device, last row of the main sheet
    this._panelBox.innerHTML = `<button type="button" class="veil" data-act="setup" tabindex="-1" aria-label="${t('close')}"></button><div class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="head"><span style="display:flex;gap:.5rem;align-items:center">${back}<strong>${title}</strong></span><button type="button" data-act="setup" class="on">${t('close')}</button></div><div class="panel">${rows}${ask}</div></div>`;
  }

  /** A change of the choices replaces the staff: at once when nothing is written, after a confirmation otherwise. */
  /** The key signature steps (♭ ♭ ♭ for three flats): the number shown follows each tap at once, the score is redrawn once the taps stop (300 ms). */
  _stepKey(delta) {
    const base = (this._pending ?? notePrefsOf(this._editDoc)).keySig;
    this._keyWanted = Math.max(-7, Math.min(7, (this._keyWanted ?? base) + delta));
    const val = this._root.querySelector('[data-key="-1"] + .val');
    if (val) val.textContent = this._keyWanted === 0 ? '♮' : `${Math.abs(this._keyWanted)}${this._keyWanted > 0 ? '♯' : '♭'}`;
    clearTimeout(this._keyTimer);
    this._keyTimer = setTimeout(() => { const k = this._keyWanted; this._keyWanted = null; if (k !== null && k !== (this._pending ?? notePrefsOf(this._editDoc)).keySig) this._chooseSetup({ keySig: k }); }, 300);
  }

  _chooseSetup(patch) {
    const base = this._pending ?? notePrefsOf(this._editDoc);
    const next = normalizePrefs({ ...base, ...patch });
    if (!hasContent(this._editDoc)) return this._replaceWith(next);
    this._pending = next; this._open = true; this._refresh(); // the question is in the sheet: it opens by itself when the change came from the top bar
  }

  _replaceWith(prefs) {
    this._pending = null; this._prefs = { ...prefs };
    this._unsub?.(); this._editDoc = newNoteDocument(prefs, { lang: this.lang });
    this._unsub = this._editDoc.subscribe(() => this._afterChange());
    this._entry.fret = 0; this._cell = null;
    this._sync(); this._savePrefs(); this._refresh(); this._emitChange();
  }

  /** The cell being written (its zone, in pixels of the drawing) is outlined; the panel under the score lets the teacher pick a root and a quality. */
  /**
   * The chord sheet: THREE big buttons (root, quality, bass) that show the chord as it is; one of them opens the choices of its own (`this._chordSub`), choosing returns to the three,
   * and a NEW chord goes on to its quality by itself after the root (the back arrow undoes a tap that came too fast). Under them the number of cells of the measure.
   */
  _drawChords() {
    const box = this._chordBox; const d = this._editDoc;
    if (!this._cell || !chordsShown(d)) { box.hidden = true; box.innerHTML = ''; this._cell = null; return; }
    let ctx; try { ctx = resolveCell(d, this._cell); } catch { this._cell = null; box.hidden = true; return; }
    const t = (k) => this._t(k); const sym = ctx.cell ? symbolAtCell(ctx.measure, ctx.cell) : null;
    const root = sym && getProperty(sym, PID.CHORD_ROOT); const quality = sym ? getProperty(sym, PID.CHORD_QUALITY) ?? '' : null; const bass = sym && getProperty(sym, PID.CHORD_BASS);
    // letters (C D E…) are the default; the teacher can switch the whole note to do ré mi, and the buttons then show that name first
    const solfege = resolveStyle(SID.CHORD_NOTATION, [null, movementOf(d).style]) === 'latin';
    const latin = entryRoots({ accidental: this._accidental, naming: 'latin' });
    const SOLFEGE = { C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
    const noteName = (n) => `${solfege ? SOLFEGE[n.step] : n.step}${n.alter === 1 ? '♯' : n.alter === -1 ? '♭' : ''}`;
    const qualityName = (q) => (q === '' ? t('maj') : (QUALITIES.find(([id]) => id === q)?.[1] ?? q));
    const noteButtons = (attr, current) => entryRoots({ accidental: this._accidental, naming: 'anglo' }).map((r, i) => {
      const [big, small] = solfege ? [latin[i].label, r.label] : [r.label, latin[i].label];
      return `<button type="button" data-${attr}="${r.step}:${r.alter}" aria-label="${latin[i].label}" aria-pressed="${Boolean(current) && current.step === r.step && (current.alter ?? 0) === r.alter}">${big}<small style="display:block;font-size:.6875rem;opacity:.7">${small}</small></button>`;
    }).join('');
    const sub = this._chordSub;
    let head; let body;
    if (sub) {
      const titles = { root: t('root'), quality: t('quality'), bass: t('bass') };
      const tools = sub === 'quality' ? '' : `<button type="button" data-accidental="${this._accidental === 'sharp' ? 'flat' : 'sharp'}" aria-label="${t(this._accidental === 'sharp' ? 'flats' : 'sharps')}">${this._accidental === 'sharp' ? '♯ → ♭' : '♭ → ♯'}</button><button type="button" data-notation="${solfege ? 'anglo' : 'latin'}" aria-label="${t(solfege ? 'namesLetters' : 'namesSolfege')}">${solfege ? 'C D E' : 'Do Ré Mi'}</button>`;
      head = `<div class="row"><button type="button" data-csub="" aria-label="${t('back')}">◂</button><strong>${titles[sub]}</strong>${tools}</div>`;
      body = sub === 'root' ? `<div class="row">${noteButtons('root', root)}</div>`
        : sub === 'quality' ? `<div class="row">${QUALITIES.map(([id, label]) => `<button type="button" data-quality="${id}" aria-pressed="${quality === id}">${id === '' ? t('maj') : label}</button>`).join('')}</div>`
          : `<div class="row"><button type="button" data-bass="none" aria-pressed="${!bass}" aria-label="${t('noBass')}">–</button>${noteButtons('bass', bass)}</div>`;
    } else {
      const three = (key, label, value) => `<button type="button" data-csub="${key}" aria-haspopup="dialog"><small>${label}</small><strong>${value}</strong></button>`;
      head = `<div class="row"><strong>${t('chord')} · ${t('measure')} ${ctx.index + 1}</strong><button type="button" data-chord-erase>${t('erase')}</button><button type="button" data-chord-close>${t('close')}</button></div>`;
      body = `<div class="big3">${three('root', t('root'), root ? noteName(root) : '–')}${three('quality', t('quality'), quality === null ? '–' : qualityName(quality))}${three('bass', t('bass'), bass ? `/${noteName(bass)}` : '–')}</div>`
        + `<div class="row"><span class="lab">${t('cells')}</span>${[1, 2, 4].map((n) => `<button type="button" data-slots="${n}" aria-pressed="${ctx.cells.length === n}">${n}</button>`).join('')}</div>`;
    }
    box.innerHTML = head + body + (this._notice ? `<div class="warn" role="alert">${this._notice}</div>` : '');
    box.hidden = false;
  }

  _openCell(zone) {
    this._cell = { staffId: zone.staffId, measureId: zone.measureId, cell: zone.cell }; this._notice = ''; this._chordSub = null;
    this._cur = this._view.measureIndexOf(zone.measureId);
    this._drawNav(); this._drawChords(); this._marks(); this._scrollTo(this._cur);
  }

  _writeChord(fn) {
    this._notice = '';
    try { this._editDoc.transaction('chord', fn); this._emitChange(); } catch (e) { this._notice = e.code === 'no-root' ? this._t('chooseRoot') : this._t('cannot'); this._drawChords(); }
  }

  _tapStage(e) {
    const svg = this._stage.querySelector('.holder svg'); if (!svg || !this._view) return;
    const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
    const x = ((e.clientX - r.left) / r.width) * vb.width; const y = ((e.clientY - r.top) / r.height) * vb.height;
    const cellZone = chordsShown(this._editDoc) ? this._view.hitCell(x, y, { tolerance: 'touch' }) : null; // a tap on a chord cell opens it in both modes (write and select): the cells are not on the staff
    if (cellZone) { this._openCell(cellZone); return; }
    if (this._mode === 'select') {
      const hit = this._view.hitTest(x, y, { tolerance: 'touch' });
      this._selected = hit && ['note', 'tabnote', 'percnote', 'chord'].includes(hit.type) ? hit.ref : null;
      this._view.clearSelection(); if (this._selected) this._view.select([this._selected]);
      if (this._selected && !this._view.selection().length) this._selected = null;
      this._marks(); this._drawNav(); this._say(this._selected ? 'selected' : 'nothing');
      return;
    }
    let hit = this._view.staffHit(x, y);
    if (!hit || hit.staffType === 'chord') return;
    if (hit.staffType === 'percussion' && !this._entry.rest) { // the chosen sound decides the line, the tap decides the moment
      const sound = this._drumSounds().find((v) => v.id === this._entry.sound);
      if (sound) hit = { ...hit, line: sound.line };
      // a drum note goes into the voice of its SOUND (bass drum, snare: voice 2): the columns that can be tapped are those of THAT voice (else only the beats voice 1 already holds)
      const v = voiceForEntry(this._editDoc, hit, this._entry);
      if (Number.isInteger(v) && v !== hit.voice) { const again = this._view.staffHit(x, y, { voice: v }); if (again) hit = { ...again, line: hit.line }; }
    }
    if (hit.staffType === 'tab' && !this._entry.rest) { this._openFretPop(hit, e); return; } // a string was touched: the pad of frets asks which one
    this._enter(hit, this._entry);
  }

  _enter(hit, entry) {
    try {
      this._cur = hit.measureIndex; // set first: the document change redraws and keeps this measure in view
      this._editDoc.transaction('enter note', () => enterNote(this._editDoc, hit, entry));
      this._say('placed'); this._emitChange();
    } catch (err) { this._say('cannot'); this.dispatchEvent(new CustomEvent('error', { detail: noteError(this.lang, err.code ?? 'entry', err.message) })); }
  }

  /** The pad of frets (0-12, then › for 13-24) beside the touched string: a tap on a number puts the note there, with the duration chosen above. */
  _openFretPop(hit, e) { this._fretHit = hit; this._fretPage = 0; this._fretAt = { x: e.clientX, y: e.clientY }; this._drawFretPop(); }
  _closeFretPop() { this._fretHit = null; this._fretPop?.remove(); this._fretPop = null; }
  _drawFretPop() {
    if (!this._fretHit) return;
    const t = (k) => this._t(k); const MAX = 24; const base = this._fretPage ? 13 : 0;
    const pop = this._fretPop ?? (this._fretPop = document.createElement('div'));
    pop.className = 'fretpop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', t('fret'));
    const cells = [];
    for (let n = base; n <= Math.min(MAX, base + 12); n += 1) cells.push(`<button type="button" data-fretn="${n}" aria-label="${t('fret')} ${n}">${n}</button>`);
    cells.push(`<button type="button" data-fretpage aria-label="${t('fretPage')}">${this._fretPage ? '‹' : '›'}</button>`);
    const rows = []; for (let i = 0; i < cells.length; i += 5) rows.push(`<div class="row">${cells.slice(i, i + 5).join('')}</div>`);
    pop.innerHTML = `${rows.join('')}<div class="row"><button type="button" data-fretclose aria-label="${t('close')}">✕</button></div>`;
    pop.onclick = (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.fretn !== undefined) { const hit = this._fretHit; this._closeFretPop(); this._enter(hit, { ...this._entry, fret: Number(b.dataset.fretn) }); return; }
      if (b.dataset.fretpage !== undefined) { this._fretPage = this._fretPage ? 0 : 1; this._drawFretPop(); return; }
      this._closeFretPop();
    };
    if (!pop.isConnected) this._card.append(pop);
    const w = pop.offsetWidth; const h = pop.offsetHeight; const { x, y } = this._fretAt; const vw = window.innerWidth || 390;
    pop.style.left = `${Math.round(Math.min(Math.max(x - w / 2, 4), Math.max(4, vw - w - 4)))}px`;
    pop.style.top = `${Math.round(y - h - 24 >= 4 ? y - h - 24 : y + 24)}px`; // above the finger, below it when there is no room
  }

  /** The notes a semitone can move: the selected note, or every note of the selected chord (a drum note has no pitch). */
  _selectedNotes() {
    const el = this._selected && this._editDoc.find(this._selected); if (!el) return [];
    return (el.type === 'chord' ? el.notes ?? [] : [el]).filter((n) => n.type === 'note' || n.type === 'tabnote');
  }
  _shiftable() { return this._selectedNotes().length > 0; }

  /** Moves the selected note(s) a semitone up or down (one undoable step; the selection stays on them). */
  _shiftSelected(up) {
    const notes = this._selectedNotes(); if (!notes.length) return;
    const d = this._editDoc; let changed = 0;
    d.transaction('semitone', () => {
      const plain = notes.filter((n) => n.type === 'note'); const tab = notes.filter((n) => n.type === 'tabnote');
      if (plain.length) changed += shiftNotes(d, plain, up, false);
      if (tab.length) changed += shiftTabNotes(d, tab, up, false);
    });
    if (changed) this._emitChange(); else this._say('cannot');
  }

  /** Deletes the selected note (the whole chord when it is the last note of it): the room becomes a rest. */
  _deleteSelected() {
    const d = this._editDoc; const id = this._selected; const el = id && d.find(id); if (!el) return;
    const chord = el.type === 'chord' ? el : d.parentOf(id);
    const notes = chord.notes ?? chord.children?.notes ?? [];
    this._selected = null;
    d.transaction('delete note', () => (el.type !== 'chord' && notes.length > 1 ? removeNoteFromChord(d, id) : deleteItem(d, chord)));
    this._emitChange();
  }

  _onClick = (e) => {
    if (this._viewMode) { if (e.target.closest('button')?.dataset.act === 'edit') { this.setAttribute('fullscreen', ''); return undefined; } return this._viewClick(e); }
    const b = e.target.closest('button'); if (!b) return undefined;
    this._closeFretPop(); // a touch on the tools puts the pad away
    const d = this._editDoc;
    if (b.dataset.dur) { this._entry.duration = { base: b.dataset.dur, dots: this._entry.duration.dots }; return this._drawPalette(); }
    if ('dot' in b.dataset) { this._entry.duration = { ...this._entry.duration, dots: this._entry.duration.dots ? 0 : 1 }; return this._drawPalette(); }
    if ('rest' in b.dataset) { this._entry.rest = !this._entry.rest; return this._drawPalette(); }
    if (b.dataset.csub !== undefined && this._cell) { this._chordSub = b.dataset.csub || null; this._notice = ''; return this._drawChords(); }
    if (b.dataset.root && this._cell) {
      const [step, alter] = b.dataset.root.split(':');
      let fresh = true; try { const c = resolveCell(d, this._cell); const s = c.cell ? symbolAtCell(c.measure, c.cell) : null; fresh = !(s && getProperty(s, PID.CHORD_ROOT)); } catch { /* no cell */ }
      this._chordSub = fresh ? 'quality' : null; // a new chord goes on to its quality by itself (the back arrow is there for a tap that came too fast)
      return this._writeChord(() => setCellChord(d, this._cell, { root: { step, alter: Number(alter) } }));
    }
    if (b.dataset.bass && this._cell) { // the bass of a slash chord (C/E): a note, or `none` to take it off; it needs a chord to hang on
      const bassPatch = b.dataset.bass === 'none' ? null : (([step, alter]) => ({ step, alter: Number(alter) }))(b.dataset.bass.split(':'));
      this._chordSub = null;
      return this._writeChord(() => setCellChord(d, this._cell, { bass: bassPatch }));
    }
    if (b.dataset.quality !== undefined && this._cell) { this._chordSub = null; return this._writeChord(() => setCellChord(d, this._cell, { quality: b.dataset.quality })); }
    if (b.dataset.slots && this._cell) return this._writeChord(() => setMeasureSlots(d, this._cell, Number(b.dataset.slots)));
    if (b.dataset.notation) { d.transaction('chord names', () => d.setStyle(movementOf(d), SID.CHORD_NOTATION, b.dataset.notation)); return this._emitChange(); }
    if (b.dataset.accidental) { this._accidental = b.dataset.accidental; return this._drawChords(); }
    if ('chordErase' in b.dataset && this._cell) return this._writeChord(() => eraseCell(d, this._cell));
    if ('chordClose' in b.dataset) { this._cell = null; this._chordSub = null; return this._refresh(); }
    if (b.dataset.soundId) { this._entry.sound = b.dataset.soundId; return this._drawSounds(); }
    if (b.dataset.mode) { this._mode = b.dataset.mode; if (this._mode === 'write') this._selected = null; return this._refresh(); }
    if (b.dataset.kind) return this._chooseSetup({ kind: b.dataset.kind });
    if (b.dataset.clef) return this._chooseSetup({ clef: b.dataset.clef });
    if (b.dataset.themeSet) { this._settings = normalizeSettings({ ...this._settings, theme: b.dataset.themeSet }); try { localStorage.setItem(THEME_KEY, this._settings.theme); } catch { /* private window */ } this._applyTheme(); this.dispatchEvent(new CustomEvent('settingschange', { detail: this.settings })); return this._drawPanel(); }
    if (b.dataset.sub) { this._sub = b.dataset.sub; return this._drawPanel(); }
    if (b.dataset.instrument) { this._sub = null; return this._chooseSetup({ instrument: b.dataset.instrument, concert: false }); }
    if (b.dataset.concert) return this._chooseSetup({ concert: b.dataset.concert === 'true' });
    if (b.dataset.sound) return this._chooseSetup({ sound: b.dataset.sound });
    if (b.dataset.strings) return this._chooseSetup({ strings: Number(b.dataset.strings) });
    if (b.dataset.tuning) return this._chooseSetup({ tuning: b.dataset.tuning });
    if (b.dataset.capo) return this._chooseSetup({ capo: Math.max(0, Math.min(MAX_CAPO, (this._pending ?? notePrefsOf(d)).capo + Number(b.dataset.capo))) });
    if (b.dataset.sig) { this._sub = null; return this._chooseSetup({ timeSig: b.dataset.sig.split('/').map(Number) }); }
    if (b.dataset.key) return this._stepKey(Number(b.dataset.key));
    switch (b.dataset.act) {
      case 'play': return this._playing ? this.stop() : this.play();
      case 'chordsplay': this._settings = normalizeSettings({ ...this._settings, chords: !this._settings.chords }); this._drawBar(); if (this._playing) { this.stop(); this.play(); } return undefined;
      case 'undo': if (d.undo()) this._emitChange(); return undefined;
      case 'redo': if (d.redo()) this._emitChange(); return undefined;
      case 'add': if (addMeasure(d)) { this._goto(measureCount(d) - 1); this._emitChange(); } return undefined;
      case 'rm': if (removeLastMeasure(d)) { this._goto(Math.min(this._cur, measureCount(d) - 1)); this._emitChange(); } return undefined;
      case 'chords': { const on = !chordsShown(d); this._cell = null; d.transaction('chords', () => setChordsShown(d, on, { lang: this.lang })); this._emitChange(); return undefined; }
      case 'prev': return this._goto(this._cur - 1);
      case 'next': return this._goto(this._cur + 1);
      case 'delete': return this._deleteSelected();
      case 'up': return this._shiftSelected(true);
      case 'down': return this._shiftSelected(false);
      case 'grid': return this._toggleGrid();
      case 'zoom2': this._zoom2 = !this._zoom2; this._grid?.setStretch(this._zoom2 ? 2 : 1); return this._refresh();
      case 'subback': this._sub = null; return this._drawPanel();
      case 'setup': this._open = !this._open; this._pending = null; this._sub = null; return this._refresh();
      case 'close': clearTimeout(this._textTimer); clearTimeout(this._keyTimer); this.dispatchEvent(new CustomEvent('cancel')); if (this.hasAttribute('preview')) this.removeAttribute('fullscreen'); return undefined; // leaves without saving: the page decides what to do with the changes already announced by `change`
      case 'confirm': return this._replaceWith(this._pending);
      case 'cancel': this._pending = null; return this._drawPanel();
      case 'done': {
        clearTimeout(this._textTimer); const value = stringifyNoteDocument(createNoteDocument(d.work, { text: this._text }));
        this.dispatchEvent(new CustomEvent('save', { detail: { value } }));
        if (this.hasAttribute('preview')) { this._value = value; this.removeAttribute('fullscreen'); } // (the preview shows what was just saved)
        return undefined;
      }
      default: return undefined;
    }
  };
}
export function defineScorsaireNoteEdit(name = 'scorsaire-note') { if (!customElements.get(name)) customElements.define(name, ScorsaireNoteEdit); }
