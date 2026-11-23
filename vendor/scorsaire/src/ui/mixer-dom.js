/*
 * Mixer panel — DOM. One line per track (volume, M, S), a master volume, "no solo", "unmute all" and a search box for large scores.
 * Same presentation rules as the settings panel: a sheet from the bottom on phones and tablets, a draggable floating window on desktop (`panel-mode.js`);
 * fixed in <body>, so the score never moves. Volume and mute are saved in the file; the solo is session state. The rows are updated in place
 * (never rebuilt while a slider is dragged); the list is rebuilt only when the set of tracks changes.
 */
import { masterSide, flipMasterSide } from './master-side.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { SHEET_QUERY } from './panel-mode.js';
import { createMixerRow } from './mixer-row.js';
import { openTrackFx } from './track-fx-dialog.js';
import { DEFAULT_OUTPUT_DB } from '../audio/engine-manager.js';
import { stepsAt } from '../audio/automation.js';
import { createHeaderMenu } from './header-menu.js';

const STYLE_ID = 'mixer-panel-style';
const CSS = `
[data-mixer] { --sp-target: var(--ui-target, 30px); position: fixed; left: var(--sb-left, 0px); right: var(--sb-right, 0px); bottom: 0; z-index: 60; background: var(--paper, var(--paper,#faf8f4)); color: var(--ink,#111); border-top: 1px solid var(--edge,#c9c4b8); box-shadow: 0 -2px 12px rgba(0,0,0,.3); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; display: flex; flex-direction: column; max-height: 62vh; border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom); }
[data-mixer] .mxp-head { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 4px 6px 4px 12px; background: var(--soft,#efece4); border-bottom: 1px solid var(--line,#d8d3c8); border-radius: 12px 12px 0 0; }
[data-mixer] .mxp-title { flex: 0 0 auto; font-weight: var(--w-semi,600); }
[data-mixer] .mxp-tools { flex: 1 1 auto; display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); align-items: center; justify-content: flex-end; }
[data-mixer] .mxp-tools input { flex: 0 1 12em; min-height: var(--sp-target); font-size: 16px; box-sizing: border-box; }
[data-mixer] .mxp-strip { display: flex; gap: 2px; align-items: flex-start; overflow-x: auto; overflow-y: auto; padding: 6px 10px; flex: 1 1 auto; }
[data-mixer] .mxp-list { display: flex; gap: 2px; align-items: flex-start; }
[data-mixer] .mxp-lists { display: flex; flex-direction: column; gap: var(--btn-gap, 2px); }
[data-mixer] .mxp-groups { position: relative; }
[data-mixer] .mxp-group { position: absolute; height: 5px; box-sizing: border-box; border: 1.5px solid #7d7869; border-bottom: 0; border-radius: 3px 3px 0 0; font: 0/0 var(--ui-font,sans-serif); color: var(--ink-soft,#5a5750); text-align: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; background: var(--soft,#ece9e1); }
[data-mixer] .mxp-group[data-style="brace"] { border-radius: 10px 10px 0 0; }
[data-mixer] .mxp-group[data-style="line"] { border-radius: 0; background: transparent; }
[data-mixer] .mxp-sep { flex: none; width: 1px; align-self: stretch; background: #ddd; margin: 0 6px; }
[data-mixer] .mxp-empty { padding: 8px 12px; color: var(--ink-soft,#555); }
[data-mixer] .mxp-head button, [data-mixer] .mxp-tools button { min-width: var(--sp-target); min-height: var(--sp-target); padding: 0 10px; font: inherit; }
`;

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

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** @returns { open(), close(), toggle(), isOpen(), destroy() } */
export function mountMixerPanel({ app, label = (k) => k, output = null, playhead = null, presets = null, activity = null }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let panel = null; let opened = false;
  let rows = new Map(); let masterRow = null; let list = null; let clearSoloBtn = null; let unmuteBtn = null; let empty = null; let query = '';
  let shownIds = '';
  let ledTimer = null;
  const stopLed = () => { if (ledTimer) { clearInterval(ledTimer); ledTimer = null; } };

  /** The panel rises from the bottom, above the dock (when the dock is shown). */
  const place = () => {
    panel.setAttribute('data-mode', 'sheet');
    const dock = document.querySelector('[data-dock]');
    const r = dock && getComputedStyle(dock).display !== 'none' ? dock.getBoundingClientRect() : null;
    panel.style.bottom = r ? `${Math.max(0, window.innerHeight - r.top)}px` : '0px';
    document.documentElement.style.setProperty('--mixer-h', `${panel.offsetHeight}px`); // the floating round buttons stand above the panel
  };

  // ---- SoundFont instrument of a track: a slot above the fader that opens a searchable list of the presets of the loaded SoundFont ----
  let picker = null;
  // families of the General MIDI programs (what the SoundFont's presets are numbered after): the filter chips of the picker
  const GM_FAMILIES = [['keys', [[0, 7], [16, 23]]], ['guitars', [[24, 39]]], ['strings', [[40, 47]]], ['ensemble', [[48, 55]]], ['brass', [[56, 63]]], ['winds', [[64, 79]]], ['perc', [[8, 15], [112, 119]]], ['synth', [[80, 103]]], ['other', [[104, 111], [120, 127]]]];
  let familyFilter = null; // null = all
  const inFamily = (p, id) => GM_FAMILIES.find(([k]) => k === id)?.[1].some(([a, b]) => p.program >= a && p.program <= b);
  const presetKey = (p) => `${p.bankMSB ?? 0}:${p.bankLSB ?? 0}:${p.program}`;
  const openPicker = (button, trackId) => {
    picker?.close();
    const list = (presets?.list() ?? []).filter((p) => !p.drums);
    const current = app.mixerState().tracks.find((t) => t.id === trackId)?.preset ?? null;
    picker = createHeaderMenu({ button, above: true, build: (menu, close) => {
      menu.style.minWidth = '240px'; menu.style.maxHeight = 'min(60vh, 420px)'; menu.style.display = 'flex'; menu.style.flexDirection = 'column';
      const search = el('input', { type: 'search', placeholder: label('mixer.presetSearch'), 'aria-label': label('mixer.presetSearch'), style: 'flex:none;min-height:30px;font-size:16px;box-sizing:border-box;margin-bottom:4px' });
      const chips = el('div', { style: 'flex:none;display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);margin-bottom:4px' });
      const box = el('div', { style: 'overflow:auto;flex:1 1 auto' });
      const row = (text, hint, selected, run) => {
        const b = el('button', { type: 'button', style: 'display:flex;justify-content:space-between;gap:var(--btn-gap,2px);width:100%;min-height:28px;padding:0 8px;border:0;border-radius:6px;background:' + (selected ? '#e2e0da' : 'transparent') + ';text-align:left;cursor:pointer;font:13px var(--ui-font,sans-serif)', onclick: () => { close(); run(); } }, el('span', {}, text), hint ? el('small', { style: 'color:var(--ink-faint,#777)' }, hint) : null);
        return b;
      };
      const fill = () => {
        const q = fold(search.value.trim());
        chips.replaceChildren(...[[null, label('mixer.family.all')], ...GM_FAMILIES.map(([k]) => [k, label(`mixer.family.${k}`)])].map(([k, text]) => el('button', { type: 'button', 'aria-pressed': String(familyFilter === k), style: 'min-height:24px;padding:0 8px;font:12px var(--ui-font,sans-serif);border-radius:12px', onclick: () => { familyFilter = k; fill(); } }, text)));
        box.replaceChildren(row(label('mixer.presetDefault'), '', !current, () => presets.pick(trackId, null)),
          ...list.filter((p) => (!familyFilter || inFamily(p, familyFilter)) && (!q || fold(p.name).includes(q))).map((p) => row(p.name, p.bankMSB || p.bankLSB ? `${p.bankMSB}:${p.bankLSB}·${p.program}` : String(p.program), current && presetKey(current) === presetKey(p), () => presets.pick(trackId, p))));
      };
      search.addEventListener('input', fill); fill();
      menu.append(search, chips, box);
      setTimeout(() => search.focus(), 0);
    } });
    picker.open();
  };

  const applyFilter = () => {
    const q = fold(query.trim());
    let visible = 0;
    for (const r of rows.values()) {
      const show = !q || fold(r.name()).includes(q);
      r.element.hidden = !show;
      if (show) visible += 1;
    }
    if (empty) empty.hidden = visible > 0;
    const bars = panel?.querySelector('.mxp-groups'); if (bars) bars.style.visibility = q ? 'hidden' : '';
  };

  const withSlot = (t) => { const ready = Boolean(presets && presets.list().length); return { ...t, presetDisabled: !ready, presetTitle: ready ? label('mixer.preset') : label('mixer.presetNeedsFont') }; };

  /** Pushes the current state into the rows, in place. */
  function refresh() {
    if (!opened || !panel) return;
    const state = app.mixerState();
    const ids = state.tracks.map((t) => t.id).join('|');
    if (ids !== shownIds) { build(); return; }
    masterRow.update({ volume: state.master, masterPan: state.masterPan, masterAutomationShown: state.masterAutomationShown });
    for (const t of state.tracks) rows.get(t.id)?.update(withSlot(t));
    clearSoloBtn.disabled = !state.anySolo;
    unmuteBtn.disabled = !state.anyMuted;
    applyFilter();
  }

  function build() {
    const state = app.mixerState();
    shownIds = state.tracks.map((t) => t.id).join('|');
    rows = new Map();
    masterRow = createMixerRow({ app, id: '*', label, vertical: true });
    const search = el('input', { type: 'search', 'data-mixer-search': '', placeholder: label('mixer.search'), 'aria-label': label('mixer.search'), value: query,
      oninput: (e) => { query = e.target.value; applyFilter(); } });
    clearSoloBtn = el('button', { type: 'button', 'data-action': 'clear-solo', onclick: () => app.clearSolo() }, label('mixer.clearSolo'));
    unmuteBtn = el('button', { type: 'button', 'data-action': 'unmute-all', onclick: () => app.unmuteAll() }, label('mixer.unmuteAll'));
    empty = el('div', { class: 'mxp-empty' }, state.tracks.length ? label('mixer.noMatch') : label('mixer.empty'));
    list = el('div', { class: 'mxp-list', role: 'list' });
    for (const t of state.tracks) {
      const row = createMixerRow({ app, id: t.id, label, vertical: true, onPreset: presets ? openPicker : null, onFx: (trackId) => openTrackFx({ app, label, trackId }) });
      row.element.setAttribute('role', 'listitem');
      rows.set(t.id, row);
      list.append(row.element);
    }
    list.append(empty);
    const head = el('div', { class: 'mxp-head' }, el('span', { class: 'mxp-title' }, label('mixer.title')),
      el('div', { class: 'mxp-tools' }, search, clearSoloBtn, unmuteBtn),
      el('button', { type: 'button', 'data-action': 'master-side', 'aria-label': label('mixer.masterSide'), title: label('mixer.masterSide'), onclick: () => { flipMasterSide(); build(); } }, masterSide() === 'left' ? '⇥' : '⇤'),
      el('button', { type: 'button', 'data-action': 'close', 'aria-label': label('mixer.close'), title: label('mixer.close'), onclick: () => api.close() }, '✕'));
    // output level after the synth (-24..+12 dB): a device setting, not part of the file; can boost a quiet SoundFont
    let outputRow = null;
    if (output) {
      const db = output.outputDb();
      const fmtDb = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
      const val = el('span', { class: 'mx-value' }, fmtDb(db));
      const slider = el('input', { type: 'range', min: '-24', max: '12', step: '0.5', value: String(db), class: 'mx-slider', 'data-mixer-output': '', 'aria-label': label('mixer.output'),
        oninput: (e) => { const v = output.setOutputDb(Number(e.target.value)); val.textContent = fmtDb(v); } });
      const reset = el('button', { type: 'button', 'data-action': 'output-reset', title: label('mixer.outputReset'), 'aria-label': label('mixer.outputReset'),
        onclick: () => { const v = output.setOutputDb(DEFAULT_OUTPUT_DB); slider.value = String(v); val.textContent = fmtDb(v); } }, '↺');
      const led = el('span', { 'data-limiter-led': '', 'data-on': 'false', role: 'img', title: label('mixer.limiter'), 'aria-label': label('mixer.limiter'),
        style: 'flex:none;width:14px;height:14px;align-self:center;border-radius:50%;border:1px solid var(--edge,#888);background:#ddd' });
      outputRow = el('div', { class: 'mx-row mx-col mx-narrow', 'data-mixer-row': 'output', title: label('mixer.outputHint') }, el('span', { class: 'mx-name mx-name-wrap' }, label('mixer.output')), el('div', { class: 'mx-body' }, el('div', { class: 'mx-fader' }, val, slider), el('div', { class: 'mx-btns' }, led, reset)));
      // limiter LED: lit while the output limiter takes off more than 1 dB, and held 300 ms so that short peaks are seen
      let heldUntil = 0;
      stopLed();
      ledTimer = setInterval(() => {
        const now = Date.now();
        if (output.limiterReduction() < -1) heldUntil = now + 300;
        const on = now < heldUntil;
        if (led.dataset.on !== String(on)) { led.dataset.on = String(on); led.style.background = on ? '#ff9800' : '#ddd'; led.style.borderColor = on ? '#c66900' : '#888'; }
      }, 100);
    }
    // bar of the track groups (the brackets of the score): one row per nesting depth above the track columns; hidden while the search filters columns
    const COL = 98; // a track column (96 px) and the gap between columns
    const groupBars = el('div', { class: 'mxp-groups' });
    const mvOutline = app.tracksOutline?.()?.[0] ?? app.tracksOutline?.()?.movements?.[0];
    let maxDepth = 0;
    const placeGroup = (g, depth) => {
      if (g.from >= 0 && g.to >= g.from) {
        maxDepth = Math.max(maxDepth, depth + 1);
        groupBars.append(el('div', { class: 'mxp-group', 'data-group': g.id, 'data-style': g.style, title: g.label || '', style: `left:${g.from * COL}px;width:${(g.to - g.from + 1) * COL - 2}px;top:${depth * 6}px` }, g.label || ''));
      }
      for (const c of g.groups ?? []) placeGroup(c, depth + 1);
    };
    for (const g of mvOutline?.groups ?? []) placeGroup(g, 0);
    groupBars.style.height = `${maxDepth * 6}px`;
    if (!maxDepth) groupBars.style.display = 'none';
    const lists = el('div', { class: 'mxp-lists' }, groupBars, list);
    const shift = maxDepth ? `${maxDepth * 6 + 3}px` : '';
    masterRow.element.style.marginTop = shift; if (outputRow) outputRow.style.marginTop = shift; // keep the master and output faders level with the track faders
    const masterBox = el('div', { class: 'mxp-master', 'data-master-box': '', style: 'display:flex;gap:2px;align-items:flex-start;flex:none' }, masterRow.element, outputRow); // the master and the output level: on the left of the tracks or on their right
    const strip = el('div', { class: 'mxp-strip' }, ...(masterSide() === 'right' ? [lists, el('div', { class: 'mxp-sep' }), masterBox] : [masterBox, el('div', { class: 'mxp-sep' }), lists]));
    panel.replaceChildren(head, strip);
    const s = app.mixerState();
    masterRow.update({ volume: s.master, masterPan: s.masterPan, masterAutomationShown: s.masterAutomationShown });
    for (const t of s.tracks) rows.get(t.id)?.update(withSlot(t));
    clearSoloBtn.disabled = !s.anySolo; unmuteBtn.disabled = !s.anyMuted;
    applyFilter();
    place();
  }

  const onResize = () => { if (panel) place(); };
  window.addEventListener('resize', onResize);
  const dockEl = document.querySelector('[data-dock]');
  const dockObserver = dockEl && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  dockObserver?.observe(dockEl);
  // while playing, the faders of the tracks that have a volume lane follow the lane at the play position
  let wasLive = false;
  const onTick = (s) => {
    if (!opened || !panel) return;
    const lanes = new Map(); const panLanes = new Map(); let masterSteps = null;
    if (s.playing) for (const lane of playhead.sequence()?.automation ?? []) { if (lane.param === 'volume') lanes.set(lane.track, lane.steps); else if (lane.param === 'pan') panLanes.set(lane.track, lane.steps); else if (lane.param === 'master') masterSteps = lane; }
    if (!lanes.size && !panLanes.size && !masterSteps) { if (wasLive) { wasLive = false; refresh(); for (const r of rows.values()) { r.live(null); r.livePan?.(null); } masterRow?.live(null); } return; }
    wasLive = true;
    const state = app.mixerState();
    if (masterRow) { const v = masterSteps ? stepsAt(masterSteps.steps, s.position, 'after', null, state.master) : null; masterRow.live(v === null ? null : v); } // the master fader follows its lane
    for (const t of state.tracks) {
      const row = rows.get(t.id);
      if (!row) continue;
      const steps = lanes.get(t.id);
      if (!steps) row.live(null); else { const v = stepsAt(steps, s.position, 'after', null, t.volume); row.live(v === null ? null : v); }
      const psteps = panLanes.get(t.id);
      if (!psteps) row.livePan?.(null); else { const v = stepsAt(psteps, s.position, 'after', null, (t.pan + 1) / 2); row.livePan?.(v === null ? null : v * 2 - 1); }
    }
  };
  const offLive = playhead?.subscribe ? playhead.subscribe(onTick) : () => {};
  const offActivity = activity?.subscribe ? activity.subscribe((id, played) => rows.get(id)?.pulse?.(played)) : () => {}; // the LEDs: a note of the track reached the engine
  const offMixer = app.onMixerChange(refresh);
  const offAutoView = app.onAutomationViewChange(refresh);
  const offPresets = presets?.subscribe ? presets.subscribe(refresh) : () => {}; // the SoundFont became ready / was changed
  const offDoc = app.doc.subscribe(() => { if (opened) refresh(); });
  let dismissedAt = -1e9;
  // computers: the panel stays open until the user closes it (decided with Jean, 25/10/2026); on a touch screen a press outside still closes it
  const touchOnly = () => typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches;
  const offOutside = dismissOnOutside(() => (touchOnly() ? panel : null), () => { dismissedAt = Date.now(); api.close(); });

  const openListeners = new Set();
  const announce = () => { for (const fn of [...openListeners]) fn(opened); };
  const api = {
    onOpenChange(fn) { openListeners.add(fn); return () => openListeners.delete(fn); },
    open() {
      opened = true;
      if (!panel) {
        panel = el('div', { 'data-mixer': '', 'data-zoom-lock': '', role: 'dialog', 'aria-label': label('mixer.title') });
        panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } });
        document.body.append(panel);
      }
      build();
      announce();
    },
    close() { const was = opened; document.documentElement.style.removeProperty('--mixer-h'); picker?.close(); opened = false; stopLed(); panel?.remove(); panel = null; if (was) announce(); },
    toggle() { if (opened) api.close(); else if (Date.now() - dismissedAt > 400) api.open(); },
    isOpen: () => opened,
    destroy() { picker?.close(); offPresets(); api.close(); offLive(); offActivity(); offMixer(); offAutoView(); offDoc(); offOutside(); window.removeEventListener('resize', onResize); dockObserver?.disconnect(); },
  };
  return api;
}
