/*
 * <scorsaire-scale>: a scale on the page, in the three views of a scale (the staff, the tablature, the fretboard), for a pupil or to be chosen by the teacher.
 *   attributes  scale (id), root ('D', 'Bb'…), alias, instrument (id or French name: `guitar6`, `guitare`, `clarinette`…; for a pupil the instrument given by the portal, for a teacher editing a PREVIEW never written;
 *               `none` or missing and no other source = a neutral « choose your instrument »), view ('score' | 'tab' | 'fretboard'), system, position, mode ('edit' = the teacher chooses the
 *               scale; else the pupil only changes the view), lang ('fr' | 'en'), sounds + no-theme-switch (passed to the staff / tablature, which are the note viewer with its ▶)
 *   properties  recipe (an object or its JSON: what the portal stores; `instrument` absent = according to the pupil), settings ({ instrument, view, system, position, cagedSpan, label }: what a pupil chooses on his device)
 *   priority    instrument of the pupil (settings) > instrument forced in the recipe by the teacher > `instrument` attribute (portal)
 *   layout      the drawing first, then ONE row of buttons (instrument, view, positions…), each showing its current value and opening a bottom sheet with its control
 *   attribute   preview (with mode="edit"): the teacher sees the scale as the pupil does, with an « Edit » button that opens the editor in full screen (« Done » → `save`, « Close » → `cancel`, then back to the preview)
 *   attribute   fullscreen (with mode="edit"): covers the window with a bar « Done » (event `save`) / « Close » (event `cancel`, nothing saved), like <scorsaire-note>
 *   CSS         --scorsaire-fullscreen-z (z-index of the full-screen editor, 2000 by default), --scale-max-height: caps the height of the component, which then scrolls inside (none by default)
 *   events      change (the teacher changed the recipe: detail.recipe = the JSON, detail.value = the same), save (fullscreen, « Done »: same detail), cancel (fullscreen, « Close »),
 *               settingschange (the pupil changed the instrument / view / position), error ({ code, message, cause })
 * The recipe is all that is stored: the notes and the frets are calculated here. Draws with the colours of the page (`--md-sys-color-*`).
 */
import { lib, ROOTS, LEVELS } from './index.js';
import { normalizeRecipe, scaleOf, RecipeError } from './recipe.js';
import { SCALE_INSTRUMENTS, DEFAULT_INSTRUMENT, instrumentViews, parseInstrument } from './instruments.js';
import { scaleNoteDocument, positionOf, wholeNeck } from './document.js';
import { fretboardSvg } from './fretboard-svg.js';
import { keyboardSvg } from './keyboard-svg.js';
import { TUNINGS } from './index.js';
import { scaleText } from './i18n.js';
import { defineScorsaireNote } from '../note/view.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const CSS = `
:host{display:block;max-height:var(--scale-max-height,none);overflow:auto;font:1rem/1.4 var(--ui-font,system-ui,sans-serif);color:var(--md-sys-color-on-surface,#1c1b1f);background:var(--md-sys-color-surface,#fff)}
:host([fullscreen]){position:fixed;inset:0;z-index:var(--scorsaire-fullscreen-z,2000);max-height:none;display:flex;flex-direction:column}
:host([fullscreen]) .stage{flex:1 1 auto;min-height:0}
*{box-sizing:border-box}
.head{padding:.5rem .75rem 0}
.title{font-size:1.125rem;font-weight:600}
.notes{color:var(--md-sys-color-on-surface-variant,#49454f);font-size:.9rem;overflow-wrap:anywhere}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:.375rem;padding:.375rem .75rem}
.row label{font-size:.8rem;color:var(--md-sys-color-on-surface-variant,#49454f);margin-inline-end:.125rem}
button,select,input{font:inherit;color:inherit;min-height:2.5rem;border:1px solid var(--md-sys-color-outline,#79747e);border-radius:.5rem;background:transparent;padding:0 .625rem}
select,input{background:var(--md-sys-color-surface,#fff)}
button{cursor:pointer;white-space:nowrap}
button[aria-pressed=true],button[aria-selected=true]{background:var(--md-sys-color-primary,#6750a4);color:var(--md-sys-color-on-primary,#fff);border-color:transparent}
button:disabled{opacity:.4;cursor:default}
.roots button{min-width:2.5rem;padding:0 .25rem}
.stage{padding:.25rem .5rem}
.stage svg{display:block;width:100%;height:auto;color:var(--md-sys-color-on-surface,#1c1b1f)}
.stage scorsaire-note{display:block}
.warn{margin:.25rem .75rem;padding:.5rem .75rem;border-radius:.5rem;background:var(--md-sys-color-error-container,#f9dedc);color:var(--md-sys-color-on-error-container,#410e0b);font-size:.9rem}
.bar{display:flex;gap:.375rem;padding:.375rem .75rem;overflow-x:auto;scrollbar-width:thin}
.opn{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;line-height:1.2;padding:.25rem .625rem;min-width:5rem;flex:0 0 auto}
.opn .k{font-size:.7rem;color:var(--md-sys-color-on-surface-variant,#49454f)}
.opn .v{font-weight:600;max-width:11rem;overflow:hidden;text-overflow:ellipsis}
.opn[aria-expanded=true]{border-color:var(--md-sys-color-primary,#6750a4);box-shadow:inset 0 0 0 1px var(--md-sys-color-primary,#6750a4)}
.nav{display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.125rem .75rem}
button.on{background:var(--md-sys-color-primary,#6750a4);color:var(--md-sys-color-on-primary,#fff);border-color:transparent}
.foot{display:flex;justify-content:flex-end;gap:.5rem;padding:.5rem .75rem;border-top:1px solid var(--md-sys-color-outline-variant,#cac4d0);flex:0 0 auto;background:inherit;position:sticky;bottom:0}
.veil{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.4);border:0;border-radius:0;min-width:0;min-height:0;padding:0}
.sheet{position:fixed;z-index:21;left:0;right:0;bottom:0;max-width:40rem;margin-inline:auto;max-height:60vh;max-height:60dvh;overflow:auto;padding-bottom:env(safe-area-inset-bottom);background:var(--md-sys-color-surface,#fff);color:var(--md-sys-color-on-surface,#1c1b1f);border-top:1px solid var(--md-sys-color-outline,#79747e);border-radius:.75rem .75rem 0 0;box-shadow:0 -.5rem 1rem rgba(0,0,0,.3);animation:rise .18s ease-out}
@keyframes rise{from{transform:translateY(100%)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.sheet,.sheet.drop{animation:none}}
.sheet:focus{outline:none}
.sheet.drop{top:0;bottom:auto;border-top:0;border-bottom:1px solid var(--md-sys-color-outline,#79747e);border-radius:0 0 .75rem .75rem;box-shadow:0 .5rem 1rem rgba(0,0,0,.3);padding-top:env(safe-area-inset-top);padding-bottom:0;animation:drop .18s ease-out}
@keyframes drop{from{transform:translateY(-100%)}to{transform:none}}
.bar.first{border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0)}
.sh-head{display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;position:sticky;top:0;background:inherit;border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0)}
.credit{padding:.25rem .75rem .5rem;font-size:.75rem;color:var(--md-sys-color-on-surface-variant,#49454f)}
details{padding:.25rem .75rem}
summary{cursor:pointer;min-height:2.25rem;display:flex;align-items:center}
table{border-collapse:collapse;width:100%;font-size:.9rem}
td,th{padding:.25rem .5rem;border-bottom:1px solid var(--md-sys-color-outline-variant,#cac4d0);text-align:left}
.fb{--scale-note:var(--md-sys-color-on-surface-variant,#49454f);--scale-root:var(--scale-root-color,#d32f2f);--scale-ink:var(--md-sys-color-outline,#79747e);--scale-board:var(--md-sys-color-surface-container,#f3edf7)}
.msg{padding:1rem .75rem}
`;

export class ScorsaireScale extends HTMLElement {
  static get observedAttributes() { return ['scale', 'root', 'alias', 'instrument', 'view', 'system', 'position', 'mode', 'lang', 'fullscreen', 'preview']; }
  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._local = {}; // what the pupil chose on this device: { view, system, position, cagedSpan, label }
    this._recipeObj = null;
    this._built = false;
    this._sheet = null; // the bottom sheet open: 'scale' | 'root' | 'instrument' | 'view' | 'position' | 'labels' | 'chords'
    this._focus = null; // 'sheet' (just opened) | the key of the button to give the focus back to
    this._root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._sheet) { e.stopPropagation(); this._closeSheet(); } });
  }
  get lang() { return this.getAttribute('lang') === 'en' ? 'en' : 'fr'; }
  _t(k) { return scaleText(this.lang, k); }
  /** The editor is shown: `mode="edit"`, except for a `preview` that is not open in full screen (the teacher then sees what the pupil sees). */
  get editing() { return this.getAttribute('mode') === 'edit' && !(this.hasAttribute('preview') && !this.hasAttribute('fullscreen')); }
  get _previewing() { return this.getAttribute('mode') === 'edit' && this.hasAttribute('preview') && !this.hasAttribute('fullscreen'); }

  connectedCallback() { defineScorsaireNote(); this._built = true; this._draw(); }
  attributeChangedCallback(name, was, now) {
    if (!this._built || this._silent) return;
    if (name === 'fullscreen' && this.hasAttribute('preview') && now !== null) { this._beforeEdit = JSON.stringify(this.recipe); this._sheet = null; } // the editor opens from the preview: « Close » comes back to this
    if (name !== 'instrument' && name !== 'lang' && name !== 'fullscreen' && name !== 'preview') this._recipeObj = null;
    this._draw();
  } // (the portal changes `instrument` for another pupil: the recipe given by `recipe =` stays)

  /** The recipe: the attributes, or what was given by `recipe =`. */
  get recipe() {
    if (this._recipeObj) return this._recipeObj;
    const a = (n) => this.getAttribute(n) || undefined;
    return { scale: a('scale') ?? 'major', root: a('root') ?? 'C', alias: a('alias'), view: a('view'), system: a('system'), position: a('position') };
  }
  set recipe(v) { this._recipeObj = v == null || v === '' ? null : (typeof v === 'string' ? JSON.parse(v) : { ...v }); if (this._built) this._draw(); }
  get settings() { return { ...this._local }; }
  set settings(v) { this._local = v && typeof v === 'object' ? { ...v } : {}; if (this._built) this._draw(); }

  _fail(code, cause) { this.dispatchEvent(new CustomEvent('error', { detail: { code, message: this._t('failed'), cause: String(cause ?? '') } })); }
  _emitRecipe() { const json = JSON.stringify(normalizeRecipe(this.recipe, { open: true })); // (no instrument stays « according to the pupil »)
     this.dispatchEvent(new CustomEvent('change', { detail: { recipe: json, value: json } })); }
  _emitSettings() { this.dispatchEvent(new CustomEvent('settingschange', { detail: { ...this._local } })); }

  /**
   * The instrument shown, by priority: what the pupil chose on this device (`settings`), then the one the teacher forced in the recipe, then the `instrument` attribute (set by the portal for
   * this pupil; for the teacher editing, a PREVIEW that is never written). null = none known: the component shows a neutral state.
   */
  _instrument() {
    const a = (v) => parseInstrument(v) ?? null;
    if (!this.editing && this._local.instrument === 'drums') return null; // the pupil says « drums »: no scale
    return (this.editing ? null : a(this._local.instrument)) ?? a(this.recipe.instrument) ?? a(this.getAttribute('instrument'));
  }
  /** The recipe as shown: the teacher's, with what the pupil chose on this device on top (view, position), for the instrument above (the piano when none: only to validate and to list). */
  _recipe() { return normalizeRecipe({ ...this.recipe, ...(this.editing ? {} : this._local), instrument: this._instrument() ?? DEFAULT_INSTRUMENT }); }

  _set(patch) { // the teacher changes the recipe
    this._recipeObj = { ...this.recipe, ...patch };
    this._draw(); this._emitRecipe();
  }
  _setLocal(patch) { if (this._sheet) this._focus = 'sheet'; this._local = { ...this._local, ...patch }; if (this.editing) { this._recipeObj = { ...this.recipe, ...patch }; this._draw(); this._emitRecipe(); return; } this._draw(); this._emitSettings(); }

  _closeSheet() { const k = this._sheet; this._sheet = null; this._focus = k; this._draw(); }

  _draw() {
    let r;
    try { r = this._recipe(); } catch (e) { this._root.innerHTML = `<style>${CSS}</style><p class="msg" role="alert">${esc(this._t('failed'))}</p>`; this._fail(e instanceof RecipeError ? e.code : 'recipe', e.message); return; }
    const t = (k) => this._t(k); const lang = this.lang;
    const scale = scaleOf(r); const nameStyle = { names: lang === 'fr' ? 'solfege' : 'letters' }; const notes = lib.notes(scale, r.root, nameStyle);
    const drums = !this.editing && this._local.instrument === 'drums'; // « Drums » is in the pupil's list (the school has them) but a drum kit has no scale
    const neutral = !this._instrument();
    const ins = SCALE_INSTRUMENTS[r.instrument]; const views = neutral ? [] : instrumentViews(r.instrument);
    const name = lib.displayName(scale.id ?? scale, { alias: r.alias, lang });
    const out = [`<style>${CSS}</style>`];
    // the positions: for the tablature and the fretboard (the fretboard shows the whole neck unless a position is asked for)
    let pos = null; let meta = null; let warn = '';
    if (!neutral && ins.family !== 'staff' && (r.view === 'tab' || r.view === 'fretboard')) {
      try { meta = positionOf(r); } catch (e) { this._fail('positions', e.message); }
      pos = meta && !wholeNeck(r) ? meta : null;
      if (pos && notes.length === 7 && !pos.systems.includes('berklee')) warn = t('berkleeOnly6');
      else if (pos?.position.extrapolated) warn = t('extrapolated');
    }
    const sysName = (s) => (s === 'all' ? t('allNeck') : lib.availableSystems(scaleOf(r), { instrument: ins.lib }).find((x) => x.id === s)?.[lang] ?? s);
    // the buttons: each shows its value and opens its sheet
    const btn = (key, label, value) => `<button type="button" class="opn" data-open="${key}" aria-haspopup="dialog" aria-expanded="${this._sheet === key}"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></button>`;
    const bar = [];
    if (this.editing) bar.push(btn('scale', t('scale'), String(name)), btn('root', t('root'), notes[0].name));
    bar.push(btn('instrument', t('instrument'), this.editing ? (this.recipe.instrument ? t(`inst_${parseInstrument(this.recipe.instrument)}`) : t('byPupil')) : drums ? t('inst_drums') : neutral ? t('choose') : t(`inst_${r.instrument}`)));
    if (views.length > 1) bar.push(btn('view', t('view'), t(`view_${r.view}`)));
    if (meta) bar.push(btn('position', t('system'), sysName(wholeNeck(r) ? 'all' : meta.system)));
    if (!neutral && r.view === 'fretboard') bar.push(btn('labels', t('labels'), t(`label_${this._local.label ?? 'name'}`)));
    if (!neutral && r.view === 'keyboard') bar.push(btn('labels', t('labels'), t(`label_${this._local.label ?? 'name'}`)));
    if (!neutral && notes.length === 7) bar.push(btn('chords', '', t('chordsShort')));
    if (this._previewing) bar.unshift(`<button type="button" class="on opn" data-edit><span class="v">${esc(t('edit'))}</span></button>`); // first: the row scrolls sideways on a phone and a button at its end is out of sight
    const barHtml = `<div class="bar${this.editing ? ' first' : ''}" role="group" aria-label="${esc(t('settings'))}">${bar.join('')}</div>`;
    // the teacher's selector is at the very TOP, the scale under it; the pupil's buttons are under the drawing
    if (this.editing) out.push(barHtml);
    out.push(`<div class="head"><div class="title">${esc(notes[0].name)} ${esc(String(name).toLowerCase())}</div><div class="notes" part="notes">${notes.map((n) => esc(n.name)).join(' · ')}</div></div>`);
    if (neutral) { // no instrument anywhere (a pupil without one, a class without instrument): no piano shown to a guitarist
      out.push(`<p class="msg" role="note">${esc(t(drums ? 'noScaleDrums' : this.getAttribute('mode') === 'edit' ? 'pickInstrumentTeacher' : 'pickInstrument'))}</p>`);
    } else {
      out.push('<div class="stage" part="stage"></div>');
      if (pos) {
        const i = pos.list.indexOf(pos.position);
        out.push(`<div class="nav">${this._stepRow(pos, i)}</div>`);
      }
    }
    if (!this.editing) out.push(barHtml);
    if (warn) out.push(`<div class="warn" role="note">${esc(warn)}</div>`);
    if (pos && (pos.system === 'berklee' || pos.system === 'caged')) out.push(`<div class="credit">${esc(t('credit'))}</div>`);
    if (this.hasAttribute('fullscreen') && this.editing) out.push(`<div class="foot"><button type="button" data-act="close" aria-label="${esc(t('closeAria'))}">${esc(t('close'))}</button><button type="button" class="on" data-act="done">${esc(t('done'))}</button></div>`);
    if (this._sheet) out.push(this._sheetHtml(this._sheet, r, { notes, pos, meta, sysName, views }));
    this._root.innerHTML = out.join('');
    this._wire();
    if (!neutral) this._fillStage(r, pos, notes);
    const f = this._focus; this._focus = null;
    if (f === 'sheet') this._root.querySelector('.sheet')?.focus();
    else if (f) this._root.querySelector(`[data-open="${f}"]`)?.focus();
  }

  _stepRow(pos, i) {
    const t = (k) => this._t(k); const lang = this.lang;
    return `<button type="button" data-step="-1" aria-label="${esc(t('previous'))}" ${i > 0 ? '' : 'disabled'}>◀</button><span aria-live="polite">${esc(pos.position.label?.[lang] ?? pos.position.id)} (${i + 1}/${pos.list.length})</span><button type="button" data-step="1" aria-label="${esc(t('next'))}" ${i < pos.list.length - 1 ? '' : 'disabled'}>▶</button>`;
  }

  /** The bottom sheet of one button: a veil, a title with « Close », and the control. */
  _sheetHtml(key, r, { notes, pos, meta, sysName, views }) {
    const t = (k) => this._t(k); const lang = this.lang;
    const titles = { scale: 'scale', root: 'root', instrument: 'instrument', view: 'view', position: 'system', labels: 'labels', chords: 'chords' };
    let body = '';
    if (key === 'scale') body = this._scaleSelect(r);
    else if (key === 'root') body = this._rootsRow(r);
    else if (key === 'instrument') body = this._instrumentSelect(r);
    else if (key === 'view') body = `<div class="row" role="tablist" aria-label="${esc(t('view'))}">${views.map((v) => `<button type="button" role="tab" data-view="${v}" aria-selected="${r.view === v}">${esc(t(`view_${v}`))}</button>`).join('')}</div>`;
    else if (key === 'position' && meta) {
      const whole = wholeNeck(r); const list = meta.list;
      const sysBtns = [...(r.view === 'fretboard' ? [`<button type="button" data-system="all" aria-pressed="${whole}">${esc(t('allNeck'))}</button>`] : []), ...meta.systems.map((s) => `<button type="button" data-system="${s}" aria-pressed="${!whole && meta.system === s}">${esc(sysName(s))}</button>`)];
      body = `<div class="row">${sysBtns.join('')}${notes.length === 7 && !meta.systems.includes('berklee') ? `<button type="button" disabled title="${esc(t('berkleeOnly6'))}">Berklee</button>` : ''}</div>`
        + (whole ? '' : `<div class="row">${this._stepRow(meta, list.indexOf(meta.position))}${meta.system === 'caged' ? `<span style="flex:1"></span><label>${esc(t('span'))}</label><button type="button" data-span="5" aria-pressed="${(r.cagedSpan ?? 5) === 5}">${esc(t('caged5'))}</button><button type="button" data-span="4" aria-pressed="${r.cagedSpan === 4}">${esc(t('caged4'))}</button>` : ''}</div>`);
    } else if (key === 'labels') body = `<div class="row">${['name', 'degree', 'none'].map((l) => `<button type="button" data-label="${l}" aria-pressed="${(this._local.label ?? 'name') === l}">${esc(t(`label_${l}`))}</button>`).join('')}</div>`;
    else if (key === 'chords') body = this._chords(r);
    return `<button type="button" class="veil" data-close tabindex="-1" aria-label="${esc(t('closeSheet'))}"></button><div class="sheet${this.editing ? ' drop' : ''}" role="dialog" aria-modal="true" aria-label="${esc(t(titles[key] ?? 'settings'))}" tabindex="-1"><div class="sh-head"><strong>${esc(t(titles[key] ?? 'settings'))}</strong><button type="button" data-close>${esc(t('closeSheet'))}</button></div>${body}</div>`;
  }

  _fillStage(r, pos, notes = []) {
    const stage = this._root.querySelector('.stage');
    try {
      const degrees = lib.notes(scaleOf(r), r.root, { names: this.lang === 'fr' ? 'solfege' : 'letters' });
      if (r.view === 'keyboard') {
        const label = this._local.label ?? 'name';
        stage.innerHTML = `<div class="fb">${keyboardSvg({ notes: degrees.map((n, i) => ({ pc: n.pc, name: n.name, degree: String(i + 1), isRoot: i === 0 })), label, width: 620, title: `${this._t('view_keyboard')} · ${r.root}` })}</div>`;
      } else if (r.view === 'fretboard') {
        const ins = SCALE_INSTRUMENTS[r.instrument]; const midi = TUNINGS[ins.lib].standard.midi;
        const label = this._local.label ?? 'name';
        stage.innerHTML = `<div class="fb">${fretboardSvg({ midi, position: pos ? pos.position : null, all: pos ? null : lib.fretboard(scaleOf(r), r.root, { instrument: ins.lib }).strings, label, from: pos ? null : 0, to: pos ? null : 15, title: `${this._t('view_fretboard')} · ${r.root} ${lib.displayName(scaleOf(r), { alias: r.alias, lang: this.lang })}` })}</div>`;
      } else {
        const doc = scaleNoteDocument(r);
        const el = document.createElement('scorsaire-note');
        el.setAttribute('lang', this.lang);
        el.setAttribute('mode', 'view'); // (when the page also loaded the EDITOR of the notes, `scorsaire-note` is the editor: the staff of a scale must stay a viewer)
        for (const a of ['sounds', 'sound-mode', 'no-theme-switch']) if (this.hasAttribute(a)) el.setAttribute(a, this.getAttribute(a));
        el.value = doc.json; stage.replaceChildren(el);
      }
    } catch (e) { stage.innerHTML = `<p class="msg" role="alert">${esc(this._t('failed'))}</p>`; this._fail('render', e.message); }
  }

  _scaleSelect(r) {
    const t = (k) => this._t(k); const lang = this.lang;
    const groups = Object.keys(LEVELS).map((lv) => `<optgroup label="${esc(LEVELS[lv][lang])}">${lib.list({ level: Number(lv) }).map((x) => `<option value="${esc(x.id)}|${esc(x.alias ?? '')}" ${x.id === r.scale && (x.alias ?? '') === (r.alias ?? '') ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('');
    return `<div class="row"><label for="sc">${esc(t('scale'))}</label><select id="sc" data-pick="scale" style="min-width:12rem;flex:1">${groups}</select></div>`;
  }
  _rootsRow(r) {
    const t = (k) => this._t(k); const lang = this.lang;
    return `<div class="row roots" role="group" aria-label="${esc(t('root'))}">${ROOTS.map((n) => `<button type="button" data-root="${n}" aria-pressed="${lib.notes(scaleOf(r), r.root)[0].pc === lib.notes('major', n)[0].pc}">${esc(lib.notes('major', n, { names: lang === 'fr' ? 'solfege' : 'letters' })[0].name)}</button>`).join('')}</div>`;
  }
  /** The teacher's choice (« according to the pupil » allowed) or the pupil's own, kept on his device through `settingschange`. */
  _instrumentSelect(r) {
    const t = (k) => this._t(k);
    const all = Object.keys(SCALE_INSTRUMENTS);
    if (this.editing) return `<div class="row"><label for="in">${esc(t('instrument'))}</label><select id="in" data-pick="instrument"><option value="" ${this.recipe.instrument ? '' : 'selected'}>${esc(t('byPupil'))}</option>${all.map((i) => `<option value="${i}" ${i === parseInstrument(this.recipe.instrument) ? 'selected' : ''}>${esc(t(`inst_${i}`))}</option>`).join('')}</select></div>`;
    const neutral = !this._instrument();
    const drums = this._local.instrument === 'drums'; // the drums come first in the pupil's list: no scale for them
    return `<div class="row"><label for="pin">${esc(t('instrument'))}</label><select id="pin" data-pick="pupil-instrument">${neutral && !drums ? `<option value="" selected>${esc(t('choose'))}</option>` : ''}<option value="drums" ${drums ? 'selected' : ''}>${esc(t('inst_drums'))}</option>${all.map((i) => `<option value="${i}" ${!neutral && !drums && i === r.instrument ? 'selected' : ''}>${esc(t(`inst_${i}`))}</option>`).join('')}</select></div>`;
  }

  _chords(r) {
    const t = (k) => this._t(k);
    let h; try { h = lib.harmonize(scaleOf(r), r.root, { names: this.lang === 'fr' ? 'solfege' : 'letters' }); } catch { return ''; }
    const rows = h.map((d) => `<tr><th>${esc(d.triad?.roman ?? d.degreeToken)}</th><td>${esc(d.triad?.symbol ?? '—')}</td><td>${esc(d.seventh?.symbol ?? '—')}</td></tr>`).join('');
    return `<div style="padding:.25rem .75rem .75rem"><table><thead><tr><th></th><th>${esc(t('triads'))}</th><th>${esc(t('sevenths'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  _wire() {
    const $ = (s) => this._root.querySelectorAll(s);
    const shut = () => { this._focus = this._sheet; this._sheet = null; }; // a choice that closes its sheet (the focus goes back to its button)
    for (const b of $('[data-open]')) b.addEventListener('click', () => { const k = b.dataset.open; this._sheet = this._sheet === k ? null : k; this._focus = this._sheet ? 'sheet' : k; this._draw(); });
    for (const b of $('[data-close]')) b.addEventListener('click', () => this._closeSheet());
    for (const b of $('[data-edit]')) b.addEventListener('click', () => this.setAttribute('fullscreen', ''));
    for (const b of $('[data-act]')) b.addEventListener('click', () => {
      if (b.dataset.act === 'done') {
        const json = JSON.stringify(normalizeRecipe(this.recipe, { open: true })); this.dispatchEvent(new CustomEvent('save', { detail: { recipe: json, value: json } }));
        if (this.hasAttribute('preview')) this.removeAttribute('fullscreen'); // (the preview shows what was just saved)
      } else {
        this.dispatchEvent(new CustomEvent('cancel'));
        if (this.hasAttribute('preview')) { try { this._recipeObj = JSON.parse(this._beforeEdit); } catch { /* keeps what is shown */ } this.removeAttribute('fullscreen'); }
      }
    });
    for (const b of $('[data-view]')) b.addEventListener('click', () => { shut(); this._setLocal({ view: b.dataset.view }); });
    for (const b of $('[data-system]')) b.addEventListener('click', () => this._setLocal({ system: b.dataset.system, position: undefined }));
    for (const b of $('[data-span]')) b.addEventListener('click', () => this._setLocal({ cagedSpan: Number(b.dataset.span), position: undefined }));
    for (const b of $('[data-label]')) b.addEventListener('click', () => { shut(); this._local = { ...this._local, label: b.dataset.label }; this._draw(); this._emitSettings(); });
    for (const b of $('[data-step]')) b.addEventListener('click', () => {
      const r = this._recipe(); const p = positionOf(r); const i = p.list.indexOf(p.position) + Number(b.dataset.step);
      if (p.list[i]) this._setLocal({ position: p.list[i].id });
    });
    for (const b of $('[data-root]')) b.addEventListener('click', () => { shut(); this._set({ root: b.dataset.root, position: undefined }); });
    const sc = this._root.querySelector('[data-pick=scale]'); if (sc) sc.addEventListener('change', () => { const [id, alias] = sc.value.split('|'); shut(); this._set({ scale: id, alias: alias || undefined, custom: undefined, position: undefined }); });
    const ins = this._root.querySelector('[data-pick=instrument]'); if (ins) ins.addEventListener('change', () => { shut(); this._set({ instrument: parseInstrument(ins.value) ?? undefined, view: undefined, position: undefined }); });
    const pin = this._root.querySelector('[data-pick=pupil-instrument]'); if (pin) pin.addEventListener('change', () => { if (pin.value === 'drums') { shut(); this._setLocal({ instrument: 'drums', view: undefined, position: undefined, system: undefined }); return; } const i = parseInstrument(pin.value); if (i) { shut(); this._setLocal({ instrument: i, view: undefined, position: undefined, system: undefined }); } });
  }
}
export function defineScorsaireScale(name = 'scorsaire-scale') { if (!customElements.get(name)) customElements.define(name, ScorsaireScale); }
