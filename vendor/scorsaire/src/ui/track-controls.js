/*
 * Controls at the start of each track (screen 1): mute (M), solo (S) and a volume knob, drawn in the gap above the first staff of the track, on the header side
 * (they slide with the clef / key / time signature and stay with them when the header sticks, like the sticky header of the scrolling view). They only talk
 * to the Application's mixer (the same intents as the mixer panel: a drag previews the volume live, releasing writes ONE undoable transaction; the mute is
 * saved in the file, the solo is session state), so the mixer panel and these controls always agree. HTML over the score: it never changes the layout.
 *
 * Room decides the form: a gap of at least `FULL_GAP` px gets the three buttons, a narrower one a single button that opens a small panel with M, S and the
 * volume. The volume knob of the full form opens a panel with the slider alone. Only the first system is covered (the scrolling view has just one).
 */
import { toggleLanesPopup, automationIcon } from './automation-lanes-popup.js';
import { icon } from './icons.js';

const SIZE = 24; // px, the smallest touch target (WCAG 2.2 AA)
const FULL_GAP = SIZE + 6;
const STYLE_ID = 'track-controls-style';
const CSS = `
[data-track-controls] button { box-sizing: border-box; width: ${SIZE}px; height: ${SIZE}px; min-width: 0; min-height: 0; padding: 0; font: var(--w-semi,600) 11px var(--ui-font,sans-serif); line-height: 1; background: var(--field,#fff); border: 1px solid var(--edge,#b9b3a6); border-radius: 6px; color: var(--ink,#3a3730); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto; }
[data-track-controls] button[aria-pressed="true"] { background: var(--accent-soft,#cfe0ff); border-color: var(--info-ink,#2878ff); }
[data-track-controls] button[data-action="mute"][aria-pressed="true"] { background: var(--danger-soft,#ffd9d6); border-color: var(--danger-ink,#c62828); }
[data-track-controls] button[data-via-view="true"] { outline: 2px dotted #2878ff; }
[data-track-controls] .tc-panel { position: absolute; z-index: 6; display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 4px; background: var(--field,#fff); border: 1px solid var(--edge,#b9b3a6); border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.25); pointer-events: auto; }
[data-track-controls] .tc-panel input[type=range] { width: 120px; height: ${SIZE}px; touch-action: pan-y; }
[data-track-controls] .tc-panel output { min-width: 2.2em; text-align: right; color: var(--ink,#3a3730); font: 11px var(--ui-font,sans-serif); font-variant-numeric: tabular-nums; }
[data-track-controls] [data-silent="true"] { opacity: .45; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : String(v)); }
  e.append(...kids.filter((x) => x != null));
  return e;
};

/** @param o.stage the positioned box of the score; o.scroller the element that scrolls sideways; o.view the ScoreView; o.app the Application */
export function mountTrackControls({ stage, scroller, view, app, label = (k) => k, margin = 10 }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  const sticky = el('div', { 'data-track-controls': '', style: 'position:sticky;left:0;top:0;width:0;height:0;z-index:5;pointer-events:none;overflow:visible' });
  const layer = el('div', { style: 'position:absolute;left:0;top:0;pointer-events:none' });
  sticky.append(layer);
  stage.prepend(sticky);
  let enabled = true; let rows = []; let signature = ''; let open = null; let panel = null; let dragging = false; let recording = false;
  const byId = new Map(); // track id → { row, mute, solo, knob, more }

  const close = () => { panel?.remove(); panel = null; open = null; };
  const stateOf = (id) => app.mixerState().tracks.find((t) => t.id === id);

  function openPanel(id, { full, anchor }) {
    if (open?.id === id && open.full === full) { close(); return; }
    close();
    const st = stateOf(id); if (!st) return;
    const slider = el('input', { type: 'range', min: '0', max: '127', step: '1', 'aria-label': `${label('mixer.volume')} ${st.name}` });
    const out = el('output', {});
    const show = (v) => { slider.value = String(v); out.textContent = String(v); };
    show(Math.round(st.volume * 127));
    slider.addEventListener('input', () => { dragging = true; const v = Number(slider.value); out.textContent = String(v); if (app.recordSample(id, v / 127)) { recording = true; return; } app.previewVolume(id, v / 127); });
    const commit = () => { if (!dragging) return; dragging = false; if (recording) { recording = false; app.recordEnd(id); return; } app.setTrackVolume(id, Number(slider.value) / 127); };
    slider.addEventListener('dblclick', () => { show(100); app.setTrackVolume(id, 100 / 127); }); // double click: back to the default
    slider.addEventListener('change', commit); slider.addEventListener('pointerup', commit); slider.addEventListener('pointercancel', commit);
    const kids = [];
    // the automation button: the curves shown under the track (a menu of its own, over this panel)
    const automation = el('button', { type: 'button', 'data-action': 'automation', 'aria-pressed': String(st.automationShown), title: label('automation.lanes'), 'aria-label': label('automation.lanes') }, automationIcon());
    automation.addEventListener('click', (e) => { e.stopPropagation(); toggleLanesPopup({ app, label, id, anchor: automation }); });
    kids.push(automation); // the very first button, before M and S
    if (!full) {
      kids.push(el('button', { type: 'button', 'data-action': 'mute', 'aria-pressed': String(st.mute), title: label('mixer.mute'), 'aria-label': label('mixer.mute') }, 'M'),
        el('button', { type: 'button', 'data-action': 'solo', 'aria-pressed': String(st.solo || st.viewSolo), title: label('mixer.solo'), 'aria-label': label('mixer.solo') }, 'S'));
      kids[1].addEventListener('click', () => { app.setTrackMute(id, !stateOf(id).mute); });
      kids[2].addEventListener('click', () => { app.setTrackSolo(id, !stateOf(id).solo); });
    }
    panel = el('div', { class: 'tc-panel', 'data-track-panel': id, role: 'group', 'aria-label': st.name }, ...kids, slider, out);
    const x = Math.max(2, anchor.x); const y = anchor.y + SIZE + 3;
    panel.style.left = `${x}px`; panel.style.top = `${y}px`;
    layer.append(panel);
    open = { id, full };
    slider.focus({ preventScroll: true });
  }

  const makeButton = (action, content, title, onClick) => {
    const b = el('button', { type: 'button', 'data-action': action, title, 'aria-label': title }, content);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  };

  function build() {
    close(); layer.replaceChildren(); byId.clear();
    if (!enabled) return;
    for (const r of rows) {
      const full = false; // always the single button (decision of Jean, 22/10/2026): M, S and the volume open from it
      const top = Math.max(0, r.top - (full ? FULL_GAP : SIZE + 2) + (full ? 3 : 0));
      const group = el('div', { 'data-track-control': r.trackId, style: `position:absolute;left:4px;top:${Math.round(top)}px;display:flex;gap:var(--btn-gap,2px);pointer-events:none` });
      const entry = { group, full };
      if (full) {
        entry.mute = makeButton('mute', 'M', label('mixer.mute'), () => app.setTrackMute(r.trackId, !stateOf(r.trackId).mute));
        entry.solo = makeButton('solo', 'S', label('mixer.solo'), () => app.setTrackSolo(r.trackId, !stateOf(r.trackId).solo));
        entry.knob = makeButton('volume', icon('sliders-vertical'), label('mixer.volume'), () => openPanel(r.trackId, { full: true, anchor: { x: group.offsetLeft + 2 * (SIZE + 3), y: group.offsetTop } }));
        group.append(entry.mute, entry.solo, entry.knob);
      } else {
        entry.more = makeButton('more', icon('sliders-vertical'), label('mixer.volume'), () => openPanel(r.trackId, { full: false, anchor: { x: group.offsetLeft, y: group.offsetTop } }));
        group.append(entry.more);
      }
      layer.append(group); byId.set(r.trackId, entry);
    }
    sync();
  }

  /** Mirrors the mixer state on the buttons (mute, solo, audible). */
  function sync() {
    if (!enabled) return;
    const tracks = new Map(app.mixerState().tracks.map((t) => [t.id, t]));
    for (const [id, e] of byId) {
      const st = tracks.get(id); if (!st) continue;
      const silent = !st.audible;
      e.group.setAttribute('data-silent', String(silent));
      if (e.full) {
        e.mute.setAttribute('aria-pressed', String(st.mute));
        e.solo.setAttribute('aria-pressed', String(st.solo || st.viewSolo)); e.solo.setAttribute('data-via-view', String(st.viewSolo && !st.solo));
      } else e.more.setAttribute('aria-pressed', String(st.mute || st.solo || st.viewSolo));
    }
    if (panel && open) {
      const st = tracks.get(open.id);
      if (!st) { close(); return; }
      const m = panel.querySelector('[data-action="mute"]'); const s = panel.querySelector('[data-action="solo"]');
      m?.setAttribute('aria-pressed', String(st.mute)); s?.setAttribute('aria-pressed', String(st.solo || st.viewSolo));
      panel.querySelector('[data-action="automation"]')?.setAttribute('aria-pressed', String(st.automationShown));
    }
  }

  /** Same position logic as the sticky header: it slides with the score until the staff touches the left edge, then stays. */
  function place() {
    const layout = view.layout(); const sys = layout.systems[0];
    if (!sys || !enabled) { sticky.style.display = 'none'; return; }
    sticky.style.display = '';
    const ss = view.staffSpace();
    const offset = (parseFloat(getComputedStyle(scroller).paddingLeft) || 0) + margin;
    sticky.style.left = `${-offset}px`;
    sticky.style.marginLeft = `${(sys.stickyNames?.room ?? 0) * ss}px`;
  }

  const offMixer = app.onMixerChange(sync);
  const onOutside = (e) => { if (panel && !e.target.closest?.('[data-track-controls]')) close(); };
  window.addEventListener('pointerdown', onOutside, true);
  const onKey = (e) => { if (e.key === 'Escape' && panel) { close(); e.stopPropagation(); } };
  window.addEventListener('keydown', onKey, true);
  scroller.addEventListener('scroll', place, { passive: true });

  return {
    /** Called after each render: the layout (and so the rows) may have changed. */
    refresh() {
      rows = enabled ? view.trackRows() : []; place();
      // rebuilt only when the rows moved or changed form: a mute or a volume written into the document redraws the score but must not close the open panel
      const sig = `${enabled}|${rows.map((r) => `${r.trackId}:${Math.round(r.top)}:${0}`).join(',')}`;
      if (sig !== signature) { signature = sig; build(); } else sync();
    },
    setEnabled(on) { enabled = Boolean(on); this.refresh(); },
    destroy() { offMixer(); window.removeEventListener('pointerdown', onOutside, true); window.removeEventListener('keydown', onKey, true); scroller.removeEventListener('scroll', place); sticky.remove(); },
  };
}
