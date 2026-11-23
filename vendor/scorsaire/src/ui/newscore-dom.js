/*
 * "New score" assistant (DOM): ONE scrolling page — quick start at the top, then tracks, key, time signature, length, tempo, information.
 * A centred window on desktop, a sheet from the bottom on phones and tablets (`panel-mode.js`); it lives in <body>, so the score never moves.
 * `aria-modal="true"` keeps the note-entry shortcuts away while it is open. It is NOT dismissed by a press outside (typed text would be lost).
 * Returns { open(), close(), isOpen() }. `onCreate(options)` receives the options for `createScore` (see newscore-intents.js).
 */
import { createSwitch } from './switch.js';
import { SHEET_QUERY } from './panel-mode.js';
import { createChoiceMenu } from './choice-menu.js';
import { createInstrumentPicker } from './instrument-picker.js';
import { instrumentDisplayName } from '../model/instruments.js';
import { templatePartNames } from '../model/templateedit.js';
import { NEW_SCORE_LIMITS, QUICK_START_PARTS } from '../model/newscore.js';
import {
  KEY_CHOICES, keyCountText, TIME_PRESETS, sameTimeChoice, pickupChoices, pickupText, pickupParts, TEMPO_UNITS, initialState, optionsFromState, setTime, clampMeasures, defaultPickup,
} from './newscore-intents.js';

const STYLE_ID = 'newscore-style';
const CSS = `
[data-newscore] { position: fixed; z-index: 1000; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 4px 20px rgba(0,0,0,.35); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; display: flex; flex-direction: column; --ns-target: var(--ui-target, 30px); }
[data-newscore][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); height: min(90vh, 760px); border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom); }
[data-newscore][data-mode="floating"] { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 560px; max-width: calc(100vw - 16px); height: min(760px, calc(100vh - 32px)); border-radius: 8px; }
[data-newscore] .ns-head { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 6px 6px 6px 12px; background: var(--soft,#f1f1f1); border-bottom: 1px solid var(--edge,#ccc); }
[data-newscore] .ns-title { flex: 1 1 auto; font-weight: var(--w-semi,600); }
[data-newscore] .ns-body { flex: 1 1 auto; overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 14px; }
[data-newscore] .ns-foot { display: flex; gap: var(--btn-gap, 2px); justify-content: flex-end; padding: 8px 12px; border-top: 1px solid var(--edge,#ccc); background: var(--soft,#f7f7f7); }
[data-newscore] h3 { margin: 0 0 6px; font-size: 14px; color: var(--ink-soft,#444); }
[data-newscore] .ns-row { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); align-items: center; }
[data-newscore] button, [data-newscore] .cm-button { min-width: var(--ns-target); min-height: var(--ns-target); padding: 0 10px; font: inherit; }
[data-newscore] button[aria-pressed="true"] { border: 2px solid var(--tab-active,#1c1b1a); font-weight: var(--w-bold,700); }
[data-newscore] input[type="text"], [data-newscore] input[type="number"] { min-height: var(--ns-target); box-sizing: border-box; padding: 0 8px; font: 16px var(--ui-font,sans-serif); border: 1px solid var(--edge,#888); border-radius: 6px; }
[data-newscore] input[type="text"] { flex: 1 1 200px; min-width: 0; }
[data-newscore] .ns-value { min-width: 3em; text-align: center; font-weight: var(--w-semi,600); }
[data-newscore] .ns-chips { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); margin-top: 2px; }
[data-newscore] .ns-chip[aria-pressed="false"] { opacity: .45; text-decoration: line-through; }
[data-newscore] .ns-chip { cursor: pointer; min-height: 0; min-width: 0; border: 1px solid #d6d2c8; border-radius: 6px; padding: 1px 7px; font-size: 12px; line-height: 1.5; background: var(--module,#fcfbf8); }
[data-newscore] .ns-part { display: flex; gap: var(--btn-gap, 2px); align-items: center; justify-content: space-between; border: 1px solid var(--edge,#ccc); border-radius: 8px; padding: 0 0 0 10px; background: var(--soft,#fafafa); }
[data-newscore] .ns-note { color: var(--ink-soft,#666); font-size: 12px; }
[data-newscore] .ns-error { color: var(--danger-ink,#a00); }
[data-newscore] .ns-quick { font-weight: var(--w-bold,700); background: var(--primary,#1c1b1a); color: var(--primary-ink,#fff); border-radius: 8px; border: 0; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.flat().filter((x) => x != null));
  return e;
};

export function createNewScoreAssistant({ music = false, label = (k) => k, lang = 'en', templates = () => ({ categories: [], user: [] }), findTemplate = () => null, onCreate }) {
  if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let dialog = null; let state = null; let keyHandler = null; let counter = 0; let errorText = '';
  const picker = createInstrumentPicker({
    label, lang, staffTypes: ['score', 'tab', 'percussion', 'rhythm'],
    onInstrument: (id) => { addPart({ instrumentId: id }, instrumentDisplayName(id, lang, 'trackName') || id); },
    onStaffType: (type) => { addPart({ staffType: type, clef: 'G' }, label(`staffType.${type}`)); },
  });

  const addPart = (spec, text) => { if (!state) return; counter += 1; state.parts.push({ key: `p${counter}`, text, spec }); draw(); };

  function close() {
    picker.close();
    if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
    keyHandler = null; dialog?.remove(); dialog = null; state = null; errorText = '';
  }

  const create = (options) => {
    errorText = '';
    try { onCreate(options); close(); } catch (e) { errorText = e?.code ? label(`newScore.error.${e.code}`) : String(e?.message ?? e); draw(); }
  };

  const stepper = (value, { min, max, step = 1, onChange, act }) => el('span', { class: 'ns-row stp' },
    el('button', { type: 'button', 'data-act': `${act}-dec`, 'aria-label': label('newScore.less'), disabled: value <= min, onclick: () => onChange(Math.max(min, value - step)) }, '−'),
    el('span', { class: 'ns-value stp-val', 'data-key': act }, String(value)),
    el('button', { type: 'button', 'data-act': `${act}-inc`, 'aria-label': label('newScore.more'), disabled: value >= max, onclick: () => onChange(Math.min(max, value + step)) }, '+'));

  // pickup length as musicians say it: beats and eighths (or sixteenths), e.g. "1 beat · 2 eighths"
  const pickupLabel = (pair, timeSig) => {
    const { beats, eighths, sixteenths } = pickupParts(pair, timeSig);
    const beatText = label('newScore.beats', { n: beats[1] === 1 ? String(beats[0]) : `${beats[0]}/${beats[1]}` });
    const small = eighths !== null ? label('newScore.eighths', { n: eighths }) : sixteenths !== null ? label('newScore.sixteenths', { n: sixteenths }) : '';
    return small ? `${beatText} · ${small}` : beatText;
  };
  const keyName = (n) => (n === 0 ? label('newScore.keyName.0') : `${label(`newScore.keyName.${n}`)} (${keyCountText(n)})`);
  const textInput = (name, prop) => el('input', { type: 'text', 'data-key': name, placeholder: label(name === 'title' ? 'newScore.titlePlaceholder' : `newScore.${name}`), 'aria-label': label(name === 'title' ? 'newScore.titlePlaceholder' : `newScore.${name}`), value: state[prop], autocomplete: 'off',
    oninput: (e) => { state[prop] = e.target.value; } });

  function draw() {
    if (!dialog) return;
    const body = dialog.querySelector('.ns-body');
    const scroll = body.scrollTop;
    const [num, den] = state.time;
    const cat = templates();
    const templateOptions = [['', '—'], ...cat.categories.flatMap((c) => c.templates.map((t) => [t.id, `${c.title} — ${t.title}`])), ...cat.user.map((t) => [t.id, `${label('templates.mine')} — ${t.title}`])];
    const sections = [
      // tracks
      el('section', { 'data-section': 'parts' }, el('h3', {}, label('newScore.parts')),
        el('label', { class: 'ns-row', style: 'display:flex;align-items:center;gap:8px;min-height:var(--ui-target,44px)' },
          createSwitch({ checked: state.chordTrack !== false, text: label('newScore.chordTrack'), attrs: { 'data-act': 'chord-track' }, onchange: (e) => { state.chordTrack = e.target.checked; draw(); } })),
        el('div', { class: 'ns-row' },
          el('button', { type: 'button', 'data-act': 'add-treble', onclick: () => addPart({ staffType: 'score', clef: 'G' }, label('newScore.treble')) }, `+ ${label('newScore.treble')}`),
          el('button', { type: 'button', 'data-act': 'add-piano', onclick: () => addPart({ instrumentId: 'piano' }, instrumentDisplayName('piano', lang, 'trackName') || 'Piano') }, `+ ${instrumentDisplayName('piano', lang, 'trackName') || 'Piano'}`),
          el('button', { type: 'button', 'data-act': 'add-guitar-tab', onclick: () => addPart({ instrumentId: 'guitar-steel-tablature' }, instrumentDisplayName('guitar-steel-tablature', lang, 'trackName') || 'Guitar') }, `+ ${label('newScore.guitarTab')}`),
          el('button', { type: 'button', 'data-act': 'add-instrument', onclick: () => picker.open({}) }, `+ ${label('newScore.instrument')}`)),
        el('div', { class: 'ns-row', style: 'margin-top:6px' }, el('span', {}, label('newScore.template')),
          createChoiceMenu({ options: templateOptions, value: state.template ? state.template.id : '', label: label('newScore.template'), act: 'template',
            onPick: (id) => { state.template = id ? findTemplate(id) : null; state.templateOff = new Set(); draw(); } })),
        el('div', { class: 'ns-parts', style: 'display:flex;flex-direction:column;gap:var(--btn-gap,2px);margin-top:6px' },
          ...state.parts.map((p, i) => el('div', { class: 'ns-part', 'data-part': p.key }, el('span', {}, p.text),
            el('button', { type: 'button', 'data-act': 'remove-part', 'aria-label': label('newScore.remove'), title: label('newScore.remove'), onclick: () => { state.parts.splice(i, 1); draw(); } }, '✕'))),
          state.template ? el('div', { class: 'ns-part', 'data-template': state.template.id }, el('span', {}, `${label('newScore.template')} : ${templateOptions.find(([v]) => v === state.template.id)?.[1] ?? ''}`)) : null,
          state.template ? el('div', { class: 'ns-chips', 'data-template-parts': '' }, ...templatePartNames(state.template, lang).map((p, i) => el('button', { type: 'button', class: 'ns-chip', 'data-template-part': String(i), 'aria-pressed': String(!state.templateOff.has(i)), title: label('newScore.templatePart'), onclick: () => { if (state.templateOff.has(i)) state.templateOff.delete(i); else state.templateOff.add(i); draw(); } }, p.name || p.instrument || '—'))) : null,
          !state.parts.length && !state.template ? el('div', { class: 'ns-note' }, label('newScore.noParts')) : null)),
      // key
      el('section', { 'data-section': 'key' }, el('h3', {}, label('newScore.key')),
        createChoiceMenu({ options: [...KEY_CHOICES].reverse().map((n) => [n, keyName(n)]), value: state.keySig, label: label('newScore.key'), act: 'key',
          onPick: (v) => { state.keySig = Number(v); draw(); } })),
      // time signature
      el('section', { 'data-section': 'time' }, el('h3', {}, label('newScore.time')),
        el('div', { class: 'ns-row' }, ...TIME_PRESETS.map((t) => {
          const text = t[2] === 'common' ? 'C' : t[2] === 'cut' ? '𝄵' : `${t[0]}/${t[1]}`;
          const aria = t[2] === 'common' ? label('newScore.common') : t[2] === 'cut' ? label('newScore.cut') : `${t[0]}/${t[1]}`;
          return el('button', { type: 'button', 'data-time': `${t[0]}/${t[1]}${t[2] === 'normal' ? '' : `-${t[2]}`}`, 'aria-label': aria, title: aria, 'aria-pressed': sameTimeChoice(state.time, t) ? 'true' : 'false',
            onclick: () => { setTime(state, [...t]); draw(); } }, text);
        })),
        el('div', { class: 'ns-row', style: 'margin-top:6px' }, el('span', { class: 'ns-note' }, label('newScore.custom')),
          stepper(num, { min: 1, max: NEW_SCORE_LIMITS.maxNumerator, act: 'num', onChange: (v) => { setTime(state, [v, den, 'normal']); draw(); } }),
          el('span', {}, '/'),
          createChoiceMenu({ options: NEW_SCORE_LIMITS.denominators.map((d) => [d, String(d)]), value: den, label: label('newScore.denominator'), act: 'den',
            onPick: (v) => { setTime(state, [num, Number(v), 'normal']); draw(); } }))),
      // length + pickup (not for a score made from music: the taps give the measures)
      ...(music ? [] : [el('section', { 'data-section': 'length' }, el('h3', {}, label('newScore.length')),
        el('div', { class: 'ns-row' }, el('span', {}, label('newScore.measures')),
          stepper(state.measures, { min: NEW_SCORE_LIMITS.minMeasures, max: NEW_SCORE_LIMITS.maxMeasures, act: 'measures', onChange: (v) => { state.measures = clampMeasures(v); draw(); } }),
          el('button', { type: 'button', 'data-act': 'measures-ten', onclick: () => { state.measures = clampMeasures(state.measures + 10); draw(); } }, '+10')),
        el('div', { class: 'ns-row', style: 'margin-top:6px' },
          el('button', { type: 'button', 'data-act': 'pickup', 'aria-pressed': state.pickupOn ? 'true' : 'false', onclick: () => { state.pickupOn = !state.pickupOn; if (!pickupChoices([num, den]).some((p) => p[0] === state.pickup[0] && p[1] === state.pickup[1])) state.pickup = defaultPickup([num, den]) ?? [1, 4]; draw(); } }, label('newScore.pickup')),
          state.pickupOn ? createChoiceMenu({ options: pickupChoices([num, den]).map((p) => [pickupText(p), pickupLabel(p, [num, den])]), value: pickupText(state.pickup), label: label('newScore.pickupLength'), act: 'pickup-length',
            onPick: (v) => { state.pickup = v.split('/').map(Number); draw(); } }) : null,
          state.pickupOn ? el('span', { class: 'ns-note' }, label('newScore.pickupNote')) : null))]),
      // tempo (from music: the taps give it)
      ...(music ? [] : [el('section', { 'data-section': 'tempo' }, el('h3', {}, label('newScore.tempo')),
        el('div', { class: 'ns-row' },
          el('button', { type: 'button', 'data-act': 'tempo', 'aria-pressed': state.tempoOn ? 'true' : 'false', onclick: () => { state.tempoOn = !state.tempoOn; draw(); } }, label('newScore.tempoOn')),
          state.tempoOn ? createChoiceMenu({ options: TEMPO_UNITS.map((u) => [u.id, label(`newScore.unit.${u.id}`)]), value: state.tempoUnit, label: label('newScore.tempoUnit'), act: 'tempo-unit',
            onPick: (v) => { state.tempoUnit = v; draw(); } }) : null,
          state.tempoOn ? stepper(state.bpm, { min: 20, max: 300, act: 'bpm', onChange: (v) => { state.bpm = v; draw(); } }) : null,
          state.tempoOn ? el('button', { type: 'button', 'data-act': 'bpm-ten', onclick: () => { state.bpm = Math.min(300, state.bpm + 10); draw(); } }, '+10') : null))]),
      // information
      el('section', { 'data-section': 'info' }, el('h3', {}, label('newScore.info')),
        el('div', { class: 'ns-row' }, textInput('title', 'title'), textInput('subtitle', 'subtitle')),
        el('div', { class: 'ns-row', style: 'margin-top:6px' }, textInput('composer', 'composer'), textInput('lyricist', 'lyricist'))),
    ];
    body.replaceChildren(...sections, el('div', { class: 'ns-error', 'data-key': 'error', role: 'alert' }, errorText));
    body.scrollTop = scroll;
  }

  function open() {
    close();
    state = initialState(); counter = 0; errorText = '';
    const sheet = window.matchMedia ? window.matchMedia(SHEET_QUERY).matches : false;
    dialog = el('div', { 'data-newscore': '', 'data-resizable': 'newScore', 'data-zoom-lock': '', 'data-mode': sheet ? 'sheet' : 'floating', role: 'dialog', 'aria-modal': 'true', 'aria-label': label(music ? 'newScore.musicTitle' : 'newScore.title') },
      el('div', { class: 'ns-head' }, el('span', { class: 'ns-title' }, label(music ? 'newScore.musicTitle' : 'newScore.title')),
        music ? null : el('button', { type: 'button', 'data-act': 'quick', class: 'ns-quick', onclick: () => create({ parts: [...QUICK_START_PARTS], chordTrack: true, lang }) }, label('newScore.quick')),
        el('button', { type: 'button', 'data-act': 'close', 'aria-label': label('tracks.close'), title: label('tracks.close'), onclick: close }, '✕')),
      el('div', { class: 'ns-body' }),
      el('div', { class: 'ns-foot' },
        el('button', { type: 'button', 'data-act': 'cancel', onclick: close }, label('newScore.cancel')),
        el('button', { type: 'button', 'data-act': 'create', class: 'ns-quick', onclick: () => create(optionsFromState(state, { lang })) }, label(music ? 'newScore.musicCreate' : 'newScore.create'))));
    keyHandler = (e) => { if (e.key === 'Escape' && !document.querySelector('.cm-layer, [data-instrument-picker]')) { e.stopPropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', keyHandler, true);
    document.body.append(dialog);
    draw();
  }

  return { open, close, isOpen: () => !!dialog };
}
