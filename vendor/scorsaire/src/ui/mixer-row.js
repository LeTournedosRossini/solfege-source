/*
 * One mixer line — a REUSABLE component: name, volume slider (0-127, default 100), mute (M) and solo (S) buttons. The same control can be placed in the mixer panel
 * or in a track menu. It only talks to the Application: dragging the slider previews the volume live (no transaction), releasing it writes ONE
 * undoable transaction; M writes the saved mute; S is session state.
 * Controls are at least `--ui-target` high.
 */

const STYLE_ID = 'mixer-row-style';
const CSS = `
.mx-row { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 2px 0; }
.mx-name { flex: 0 1 9em; min-width: 4em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mx-slider { flex: 1 1 8em; min-width: 5em; height: var(--ui-target, 30px); touch-action: pan-y; }
.mx-value { flex: 0 0 3em; text-align: right; font-variant-numeric: tabular-nums; }
.mx-row button { min-width: var(--ui-target, 30px); min-height: var(--ui-target, 30px); padding: 0; font: inherit; font-weight: var(--w-semi,600); }
.mx-row button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
.mx-row button[data-action="mute"][aria-pressed="true"] { background: var(--danger-soft,#ffd9d6); border-color: var(--danger-ink,#c62828); }
.mx-row button[data-via-view="true"] { outline: 2px dotted #2878ff; }
[data-action="automation"][aria-pressed="true"] { background: var(--accent-soft,#e3edff); border: 2px solid var(--sel-edge,#2878ff); }
[data-action="automation"][data-has-lanes="true"]::after { content: '•'; color: var(--info-ink,#2878ff); margin-left: 1px; }
[data-action="record"][aria-pressed="true"] { background: var(--danger-soft,#ffd9d6); border: 2px solid #c62828; color: var(--danger-ink,#c62828); }
[data-action="record"][data-recording="true"] { background: #c62828; color: #fff; }
.mx-col { flex-direction: column; align-items: stretch; gap: var(--btn-gap, 2px); width: 96px; flex: none; padding: 4px 6px; border-right: 1px solid #eee; }
.mx-col .mx-name { flex: none; width: 100%; min-width: 0; text-align: center; font-size: 12px; font-weight: var(--w-semi,600); height: 14px; line-height: 14px; }
.mx-col .mx-preset { width: 100%; min-height: 24px; height: 24px; box-sizing: border-box; padding: 0 4px; font: 10px var(--ui-font,sans-serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.mx-preset[disabled] { opacity: .5; }
.mx-body { display: flex; gap: var(--btn-gap, 2px); align-items: flex-start; justify-content: center; }
.mx-fader { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mx-btns { display: flex; flex-direction: column; gap: var(--btn-gap, 2px); }
.mx-col .mx-value { flex: none; text-align: center; font-size: 12px; min-width: 3ch; box-sizing: content-box; }
.mx-slider { -webkit-appearance: none; appearance: none; background: transparent; margin: 0; cursor: pointer; }
.mx-slider::-webkit-slider-runnable-track { background: #c9c4b8; border-radius: 2px; height: 3px; }
.mx-slider::-moz-range-track { background: #c9c4b8; border-radius: 2px; height: 3px; }
.mx-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5.5px; border-radius: 50%; background: #5a5750; border: 0; }
.mx-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #5a5750; border: 0; }
.mx-col .mx-slider::-webkit-slider-runnable-track { height: 100%; width: 3px; }
.mx-col .mx-slider::-webkit-slider-thumb { margin-top: 0; margin-left: -5.5px; }
.mx-col .mx-slider { writing-mode: vertical-lr; direction: rtl; width: 16px; min-width: 0; height: 150px; flex: none; touch-action: none; }
.mx-col .mx-btns button { min-width: var(--ui-target, 30px); display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
.mx-btns button svg { display: block; margin: 0; flex: none; }
.mx-col.mx-narrow { width: 74px; }
.mx-col .mx-name-wrap { white-space: normal; height: 42px; min-height: 0; line-height: 14px; overflow: visible; text-overflow: clip; }
/* stereo position: a small horizontal slider (−63 … +63, centre 0), a double click centres it */
.mx-pan { display: flex; align-items: center; gap: 4px; }
.mx-pan-slider { flex: 1 1 4em; min-width: 3em; height: 18px; margin: 0; touch-action: none; accent-color: var(--ink-soft,#777); }
.mx-pan-value { flex: 0 0 3.2ch; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; }
.mx-col .mx-pan { width: 100%; box-sizing: border-box; }
.mx-row[data-audible="false"] .mx-name { opacity: .5; text-decoration: line-through; }
`;

import { icon } from './icons.js';
import { toggleLanesPopup, automationIcon, closeLanesPopup } from './automation-lanes-popup.js';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};

/**
 * @param o.app        Application
 * @param o.id         track id, or '*' for the master volume (no M / S buttons)
 * @param o.label      (key, params) → text
 * @param o.vertical   a column (name, value, vertical fader, buttons) instead of a line: the bottom mixer panel
 * @returns {{ element: HTMLElement, update(state), name(): string }}  `state` = a track entry of `app.mixerState().tracks`, or `{ name, volume }` for '*'
 */
export function createMixerRow({ app, id, label = (k) => k, vertical = false, onPreset = null, onFx = null }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  const master = id === '*';
  let dragging = false;
  let current = { name: '', volume: 1, mute: false, solo: false, viewSolo: false, audible: true };

  // an armed track that is being played: the fader move is RECORDED into the automation instead of changing the saved fader
  let recording = false;
  let holdTimer = null; // while an armed fader is held still, its value is sampled so that holding it records a flat stretch
  const stopHold = () => { if (holdTimer !== null) { clearInterval(holdTimer); holdTimer = null; } };
  const commit = (v) => {
    dragging = false;
    stopHold();
    if (recording) { recording = false; app.recordEnd(id); return; }
    if (master) app.setMasterVolume(v / 127); else app.setTrackVolume(id, v / 127);
  };
  const slider = el('input', { type: 'range', min: '0', max: '127', step: '1', class: 'mx-slider', 'data-mixer-volume': id,
    oninput: (e) => { dragging = true; const v = Number(e.target.value); value.textContent = String(v); if (!master && app.recordSample(id, v / 127)) { recording = true; return; } app.previewVolume(id, v / 127); },
    onpointerdown: () => {
      if (master || !current.armed) return;
      dragging = true;
      stopHold();
      holdTimer = setInterval(() => { if (app.recordSample(id, Number(slider.value) / 127)) recording = true; }, 80);
    },
    onpointercancel: () => { if (dragging) commit(Number(slider.value)); },
    onchange: (e) => commit(Number(e.target.value)),
    ondblclick: () => { slider.value = '100'; value.textContent = '100'; commit(100); }, // a double click puts the volume back to its default (100)
    onpointerup: (e) => { if (dragging) commit(Number(e.currentTarget.value)); },
  });
  const value = el('span', { class: 'mx-value' });
  // the pan (tracks only): live while dragged, ONE undoable write when released
  let panDragging = false;
  const panText = (v) => (v === 0 ? 'C' : v < 0 ? `L${-v}` : `R${v}`);
  const panValue = el('span', { class: 'mx-pan-value' }, 'C');
  const setPan = (v) => (master ? app.setMasterPan(v) : app.setTrackPan(id, v));
  const panSlider = el('input', { type: 'range', min: '-63', max: '63', step: '1', value: '0', class: 'mx-pan-slider', 'data-mixer-pan': id,
    oninput: (e) => { panDragging = true; const v = Number(e.target.value); panValue.textContent = panText(v); if (master) app.previewMasterPan(v / 63); else app.previewPan(id, v / 63); },
    onchange: (e) => { panDragging = false; setPan(Number(e.target.value) / 63); },
    onpointercancel: () => { if (panDragging) { panDragging = false; setPan(Number(panSlider.value) / 63); } },
    ondblclick: () => { panSlider.value = '0'; panValue.textContent = 'C'; panDragging = false; setPan(0); },
  });
  const pan = el('div', { class: 'mx-pan' }, panSlider, panValue); // the master has one too: the balance of the whole mix
  // activity LED: green = a note of this track just reached the engine and sounds, amber = received but the track is muted (or another is soloed)
  const led = master ? null : el('span', { 'data-activity-led': id, 'data-state': 'off', role: 'img', style: 'flex:none;width:9px;height:9px;border-radius:50%;border:1px solid var(--edge,#888);background:#ddd;display:inline-block;margin:0 4px' });
  let ledTimer = null;
  const pulse = (played) => {
    if (!led) return;
    led.setAttribute('data-state', played ? 'on' : 'muted');
    led.style.background = played ? '#2ea05a' : '#e0a030'; led.style.borderColor = played ? '#1f7a43' : '#a87419';
    clearTimeout(ledTimer);
    ledTimer = setTimeout(() => { led.setAttribute('data-state', 'off'); led.style.background = '#ddd'; led.style.borderColor = '#888'; }, 140);
  };
  const name = el('span', { class: master ? 'mx-name mx-name-wrap' : 'mx-name' });
  const mute = master ? null : el('button', { type: 'button', 'data-action': 'mute', onclick: () => app.setTrackMute(id, !current.mute) }, 'M');
  const solo = master ? null : el('button', { type: 'button', 'data-action': 'solo', onclick: () => app.setTrackSolo(id, !current.solo) }, 'S');
  const rec = master ? null : el('button', { type: 'button', 'data-action': 'record', onclick: () => app.setRecordArmed(id, !current.armed) }, icon('record'));
  // the automation button (a small curve with points): opens a little menu to choose the curves shown under the track (volume, pan, expression, reverb…)
  const openLanes = () => toggleLanesPopup({ app, label, id, anchor: auto });
  const auto = master ? null : el('button', { type: 'button', 'data-action': 'automation', onclick: openLanes }, automationIcon());
  // the master column has its own automation button: a simple switch for the strip of the master volume above the top staff
  const autoMaster = master ? el('button', { type: 'button', 'data-action': 'automation', onclick: () => app.setMasterAutomationShown(!current.masterAutomationShown) }, automationIcon()) : null;
  // the processing window of the track (MIDI dynamics now; equalizer and compressor next)
  const fx = master || !onFx ? null : el('button', { type: 'button', 'data-action': 'track-fx', onclick: () => onFx(id) }, icon('sliders-vertical'));
  const preset = vertical && !master && onPreset ? el('button', { type: 'button', class: 'mx-preset', 'data-action': 'preset', onclick: (e) => onPreset(e.currentTarget, id) }) : null;
  const element = vertical
    ? el('div', { class: master ? 'mx-row mx-col mx-narrow' : 'mx-row mx-col', 'data-mixer-row': id }, ...(led ? [led] : []), name, preset, pan, el('div', { class: 'mx-body' }, el('div', { class: 'mx-fader' }, value, slider), el('div', { class: 'mx-btns' }, mute, solo, rec, auto, autoMaster, ...(fx ? [fx] : []))))
    : el('div', { class: 'mx-row', 'data-mixer-row': id }, ...(led ? [led] : []), name, slider, value, pan, mute, solo, rec, auto, ...(fx ? [fx] : []));

  function update(state) {
    current = { ...current, ...state };
    name.textContent = master ? label('mixer.master') : current.name;
    name.title = name.textContent;
    slider.setAttribute('aria-label', `${label('mixer.volume')} ${name.textContent}`);
    if (!dragging) {
      const v = Math.round(current.volume * 127);
      slider.value = String(v);
      value.textContent = String(v);
    }
    if (master) {
      autoMaster.setAttribute('aria-pressed', String(Boolean(current.masterAutomationShown)));
      autoMaster.title = label('automation.masterToggle'); autoMaster.setAttribute('aria-label', autoMaster.title);
      if (!panDragging) { const v = Math.round((current.masterPan ?? 0) * 63); panSlider.value = String(v); panValue.textContent = panText(v); }
      panSlider.title = label('mixer.masterPan'); panSlider.setAttribute('aria-label', label('mixer.masterPan'));
      return;
    }
    if (!panDragging) { const v = Math.round((current.pan ?? 0) * 63); panSlider.value = String(v); panValue.textContent = panText(v); }
    panSlider.title = label('mixer.pan'); panSlider.setAttribute('aria-label', `${label('mixer.pan')} ${name.textContent}`);
    element.setAttribute('data-audible', String(current.audible));
    if (preset) { preset.textContent = current.preset?.name || label('mixer.presetSlot'); preset.title = current.presetTitle ?? label('mixer.preset'); preset.disabled = Boolean(current.presetDisabled); preset.setAttribute('aria-label', `${label('mixer.preset')} ${current.name}`); }
    mute.setAttribute('aria-pressed', String(current.mute)); mute.title = label('mixer.mute'); mute.setAttribute('aria-label', label('mixer.mute'));
    solo.setAttribute('aria-pressed', String(current.solo || current.viewSolo));
    solo.setAttribute('data-via-view', String(current.viewSolo && !current.solo));
    solo.title = current.viewSolo && !current.solo ? label('mixer.soloView') : label('mixer.solo');
    solo.setAttribute('aria-label', solo.title);
    rec.setAttribute('aria-pressed', String(Boolean(current.armed))); rec.setAttribute('data-recording', String(Boolean(current.recording)));
    rec.title = current.armed ? label('automation.disarm') : label('automation.arm'); rec.setAttribute('aria-label', rec.title);
    auto.setAttribute('aria-pressed', String(Boolean(current.automationShown)));
    auto.setAttribute('data-has-lanes', String(Boolean(current.hasLanes)));
    auto.title = label('automation.lanes'); auto.setAttribute('aria-label', auto.title);
    if (fx) { fx.setAttribute('aria-pressed', String(Boolean(current.hasFx))); fx.title = label('mixer.fx'); fx.setAttribute('aria-label', `${label('mixer.fx')} ${name.textContent}`); }
  }
  /** While playing: shows the value an automation lane gives at the play position (0..1), or goes back to the fader's own value with null. */
  function live(volume) {
    element.setAttribute('data-live', String(volume !== null));
    if (dragging) return;
    const v = Math.round((volume ?? current.volume) * 127);
    slider.value = String(v);
    value.textContent = String(v);
  }
  /** While playing: the pan a lane gives at the play position (−1 … +1), or the pan of the track itself with null. */
  function livePan(pan) {
    if (master || panDragging) return;
    const v = Math.round((pan ?? current.pan ?? 0) * 63);
    panSlider.value = String(v); panValue.textContent = panText(v);
  }
  return { element, update, live, livePan, pulse, name: () => current.name, close: closeLanesPopup };
}
