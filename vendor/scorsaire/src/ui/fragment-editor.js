/*
 * Editor of a nested score (fragment of a container, see model/containeredit.js): a full-screen window with a view of its own on the fragment,
 * showing ONLY its measures, with the same entry bar and gestures as the piece (the fragment is a small movement; `doc.movementOf` of its
 * notes returns it). Same Document, so one history: undo / redo work across both windows; one transaction per gesture.
 * Opened by the pencil button of a selected container (and a double tap on its frame); closed by its own button.
 * Two presentations of the SAME editor: 'full' (a full-screen window, the reference) and 'anchored' (a panel drawn exactly where the container is, at the
 * scale of the piece, the rest dimmed; it falls back to full screen when the container cannot be located). The choice is kept on the device.
 */
import { createScoreView } from '../view/score-view.js';
import { mountScoreView } from './dom.js';
import { mountNoteEntryBar } from './noteentry-dom.js';
import { applyIconName } from './icons.js';
import { mountContainerSettings } from './container-settings-dom.js';
import { referenceMovement } from './container-reference.js';

const VIEW_ID = 'fragment';
const STAFF_SPACE = 16; // comfortable for writing; independent of the size chosen for the piece
const MODE_KEY = 'scorsaire.fragmentEditorMode';
const ANCHORED_MIN_WIDTH = 60; // px: only a safeguard — the panel is the size of the container, however small
const ANCHORED_STAGE_MIN = 380; // narrower stage: full screen instead
/** The play / stop button of a container editor: listens to the score of the container alone; follows the playback state. Returns { button, off }. */
function makePlayButton(app, containerId, label, style) {
  const button = document.createElement('button');
  button.type = 'button'; button.setAttribute('data-action', 'fragment-play'); button.style.cssText = style;
  const paint = () => { const on = app.containerPlaying(containerId); button.title = button.ariaLabel = label(on ? 'container.stopListen' : 'container.listen'); applyIconName(button, on ? 'square' : 'play'); };
  button.addEventListener('click', () => { app.playContainer(containerId); paint(); });
  paint();
  return { button, off: app.onContainerPlay(paint) };
}
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'full' ? 'full' : 'anchored'; } catch { return 'anchored'; } }; // anchored on the container by default (Jean, 2026-10-20)
const saveMode = (mode) => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage unavailable: the choice is just not kept */ } };

/**
 * @param {object} o
 * @param {object} o.app      Application
 * @param {object} o.glyphs   Bravura data
 * @param {Function} o.label  (key, params) → text
 * @param {object} [o.callbacks]  onPercmap / onStaffProps / onBendGraph of the piece (same panels)
 * @returns {{ open(containerId), close(), isOpen(), destroy() }}
 */
export function mountFragmentEditor({ app, glyphs, label = (k) => k, callbacks = {}, onClose = () => {}, getStage = () => null, mainEntryMessage = () => {} }) {
  let state = null; // { overlay, view, mounted, bar, settings, reference, off, containerId }

  const close = () => {
    if (!state) return;
    if (state.anchored) { closeAnchored(); return; }
    const s = state;
    state = null;
    s.off(); s.offPlay?.(); app.stopContainer();
    s.mounted.destroy();
    s.bar.destroy();
    s.settings.destroy();
    s.reference.destroy();
    app.removeView(VIEW_ID);
    app.setNoteEntry({ active: false });
    s.overlay.remove();
    document.body.style.overflow = s.bodyOverflow;
    onClose();
  };

  const openFull = (containerId) => {
    if (state) close();
    const container = app.doc.find(containerId);
    const fragment = container?.fragments?.[0];
    if (!fragment) return false;
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('data-fragment-editor', containerId);
    overlay.setAttribute('aria-label', label('fragment.title'));
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;flex-direction:column;background:var(--paper,#faf8f4);color:var(--ink,#1c1b1a);font:15px var(--ui-font,sans-serif)';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--edge,#c8c4bc);flex:0 0 auto';
    const title = document.createElement('strong');
    title.textContent = label('fragment.title');
    const hint = document.createElement('span');
    hint.textContent = label('fragment.hint');
    hint.style.cssText = 'opacity:.7;font-size:13px;flex:1';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = label('fragment.close');
    closeBtn.setAttribute('data-action', 'fragment-close');
    closeBtn.style.cssText = 'min-height:var(--ui-target,44px);min-width:var(--ui-target,44px);padding:2px 14px;font:inherit;cursor:pointer';
    closeBtn.addEventListener('click', close);
    const anchorBtn = document.createElement('button');
    anchorBtn.type = 'button';
    anchorBtn.textContent = '◱';
    anchorBtn.title = anchorBtn.ariaLabel = label('fragment.anchored');
    anchorBtn.setAttribute('data-action', 'fragment-anchored');
    anchorBtn.style.cssText = closeBtn.style.cssText;
    anchorBtn.addEventListener('click', () => { saveMode('anchored'); open(containerId, { mode: 'anchored', keepHint: true }); });
    const play = makePlayButton(app, containerId, label, closeBtn.style.cssText);
    head.append(title, hint, play.button, anchorBtn, closeBtn);
    // settings of the container (folded by default) and, for a score aligned on the measures, the staff it sits on as a greyed reference
    const settingsHost = document.createElement('div');
    settingsHost.setAttribute('data-container-settings', '');
    settingsHost.style.cssText = 'flex:0 0 auto;border-bottom:1px solid var(--edge,#c8c4bc);max-height:45vh;overflow:auto';
    const refHost = document.createElement('div');
    refHost.setAttribute('data-container-reference', '');
    refHost.setAttribute('aria-hidden', 'true');
    refHost.style.cssText = 'flex:0 0 auto;overflow:hidden;pointer-events:none;opacity:.45;filter:grayscale(1);border-bottom:1px dashed var(--edge,#c8c4bc);padding:4px 12px';
    const entryHost = document.createElement('div');
    entryHost.style.cssText = 'flex:0 0 auto;padding:6px 12px;border-bottom:1px solid var(--edge,#c8c4bc)';
    const body = document.createElement('div');
    body.style.cssText = 'flex:1 1 auto;overflow:auto;padding:12px;position:relative';
    const viewHost = document.createElement('div');
    body.append(viewHost);
    overlay.append(head, settingsHost, refHost, entryHost, body);
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.append(overlay);

    const width = Math.max(10, (body.clientWidth - 40) / STAFF_SPACE);
    const view = app.addView(createScoreView({ id: VIEW_ID, doc: app.doc, glyphs, movement: fragment, width, staffSpace: STAFF_SPACE, margin: 10 }));
    const bar = mountNoteEntryBar(entryHost, { app, glyphs, label, placement: 'inline', grid: null, viewId: VIEW_ID });
    const mounted = mountScoreView(viewHost, view, {
      scroller: body, app, player: null, label, glyphs, entryMessage: (m) => bar.message(m), ...callbacks,
    });
    const settings = mountContainerSettings(settingsHost, { app, containerId, label, viewId: VIEW_ID, onPercmap: callbacks.onPercmap });
    const reference = mountReference({ app, glyphs, host: refHost, containerId, label, width });
    // the container (or its fragment) can disappear under the window — undo of its creation, deletion: close with it
    const off = app.doc.subscribe(() => { if (!app.doc.find(containerId)?.fragments?.[0]) queueMicrotask(close); });
    state = { overlay, view, mounted, bar, settings, reference, off, containerId, bodyOverflow, offPlay: play.off };
    // the entry bar of this window has no switch of its own (its pencil is hidden): entry is switched on for the score, the cursor at its start, as the anchored editor does
    const first = fragment.tracks.flatMap((t) => t.staves)[0];
    if (first) app.startEntryOn(first.id);
    return true;
  };


  // ---------- anchored presentation ----------
  // The panel IS the frame of the container, drawn over it (same place, same width, the scale of the piece); a small toolbar sits just above it (below
  // when there is no room) and the settings open in a sheet next to it. Notes are entered with the usual entry bar of the piece, switched on for the score.
  const closeAnchored = () => {
    if (!state) return;
    const s = state;
    state = null;
    s.off(); s.resizer?.disconnect(); s.offPlay?.(); app.stopContainer();
    s.mounted.destroy();
    s.bar.destroy();
    s.settings.destroy();
    app.removeView(VIEW_ID);
    s.panel.remove(); s.voile.remove(); s.toolbar.remove(); s.entryBox.remove(); s.sheet.remove();
    if (s.layer) { s.layer.remove(); document.body.style.overflow = s.frozenOverflow ?? ''; }
    app.setNoteEntry({ active: false });
    onClose();
  };

  /**
   * `hint` (screen 2, the pages of a part): { frameRoot, staffSpaceFor(frameNode) } — the frame of the container is looked for under `frameRoot`, the scale is the
   * one of the page it is on, and the panel lives in a fixed layer of the body (the pages are rebuilt after every note, so nothing can live inside them; the page
   * is frozen while the editor is open). Without a hint: the stage of the piece (screen 1).
   */
  const openAnchored = (containerId, hint = null) => {
    let layer = null;
    let frozenOverflow = null; // the page behind is frozen while the editor is open (it is rebuilt after every note)
    const abort = () => { layer?.remove(); if (frozenOverflow !== null) document.body.style.overflow = frozenOverflow; return false; };
    if (hint) {
      if (state) close();
      frozenOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      layer = document.createElement('div');
      layer.setAttribute('data-fragment-layer', ''); layer.setAttribute('data-zoom-lock', ''); layer.setAttribute('data-dismiss-keep', '');
      layer.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2000;pointer-events:none';
      document.body.append(layer);
    }
    const stage = hint ? layer : getStage();
    const container = app.doc.find(containerId);
    const fragment = container?.fragments?.[0];
    const main = app.view('main');
    if (!stage || !fragment || !main) return abort();
    const root = hint ? hint.frameRoot : stage;
    const frames = [...root.querySelectorAll(`[data-role="container-frame"][data-ref="${containerId}"]`)].slice(0, 4); // the 4 sides of the first segment
    const sr = stage.getBoundingClientRect();
    if (!frames.length || sr.width < ANCHORED_STAGE_MIN) return abort();
    const rects = frames.map((f) => f.getBoundingClientRect());
    const ur = { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
    if (state) close();
    // the piece behind is only a backdrop: nothing stays selected in it (its floating bars would sit above the dimmed score)
    main.select([]);
    main.setRange?.(null);
    main.setChosenMeasure?.(null);
    // frozen at opening: the piece behind is laid out again after every note, the panel must not move under the finger
    const frameW = ur.right - ur.left;
    const left = ur.left - sr.left;
    const top = ur.top - sr.top;
    const width = Math.max(frameW, ANCHORED_MIN_WIDTH);
    const frameH = ur.bottom - ur.top;
    // the container's own staff (its lines carry the container id): the editable staff is laid on top of it, line on line
    const ownLines = [...root.querySelectorAll(`[data-role="staff-line"][data-ref="${containerId}"]`)].map((l) => l.getBoundingClientRect());

    const voile = document.createElement('div');
    voile.setAttribute('data-fragment-voile', '');
    voile.style.cssText = 'position:absolute;inset:0;z-index:40;background:rgba(20,20,20,.35)';
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('data-fragment-editor', containerId);
    panel.setAttribute('data-anchored', '');
    panel.setAttribute('aria-label', label('fragment.title'));
    panel.style.cssText = `position:absolute;z-index:41;left:${left}px;top:${top}px;width:${width}px;height:${frameH}px;box-sizing:border-box;background:var(--paper,#faf8f4);color:var(--ink,#1c1b1a);box-shadow:0 0 0 2px #2d78ff,0 6px 24px rgba(0,0,0,.4)`;
    const viewHost = document.createElement('div');
    panel.append(viewHost);

    const mk = (text, act, tip, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = text; b.title = b.ariaLabel = tip; b.setAttribute('data-action', act);
      b.style.cssText = 'min-height:var(--ui-target,44px);min-width:var(--ui-target,44px);padding:0 10px;font:14px var(--ui-font,sans-serif);cursor:pointer;border:1px solid var(--edge,#bbb);border-radius:8px;background:var(--field,#fff)';
      b.addEventListener('click', fn);
      return b;
    };
    const sheet = document.createElement('div');
    sheet.setAttribute('data-container-settings', '');
    sheet.style.cssText = 'display:none;position:absolute;z-index:43;box-sizing:border-box;background:var(--paper,#faf8f4);color:var(--ink,#1c1b1a);font:14px var(--ui-font,sans-serif);border:1px solid var(--edge,#888);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.4);max-height:55vh;overflow:auto';
    const toolbar = document.createElement('div');
    toolbar.setAttribute('data-fragment-toolbar', '');
    toolbar.style.cssText = 'position:absolute;z-index:42;display:flex;gap:var(--btn-gap,2px);padding:3px;background:var(--paper,#faf8f4);border:1px solid var(--sel-edge,#2d78ff);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    const settingsBtn = mk('⚙', 'fragment-settings', label('cs.title'), () => { sheet.style.display = sheet.style.display === 'none' ? '' : 'none'; place(); });
    const fullBtn = mk('⤢', 'fragment-full', label('fragment.full'), () => { saveMode('full'); open(containerId, { mode: 'full', keepHint: true }); });
    const closeBtn = mk('✕', 'fragment-close', label('fragment.close'), closeAnchored);
    const play = makePlayButton(app, containerId, label, 'min-height:var(--ui-target,44px);min-width:var(--ui-target,44px);padding:0 10px;font:14px var(--ui-font,sans-serif);cursor:pointer;border:1px solid var(--edge,#bbb);border-radius:8px;background:var(--field,#fff)');
    toolbar.append(play.button, settingsBtn, fullBtn, closeBtn);
    // the entry bar (durations, rest, dot, tie, voice, stem, drum sounds…) of this score: a box on its own next to the toolbar, as in the full window
    const entryBox = document.createElement('div');
    entryBox.setAttribute('data-fragment-entry', '');
    entryBox.style.cssText = 'position:absolute;z-index:42;max-width:calc(100% - 8px);box-sizing:border-box;padding:3px;background:var(--paper,#faf8f4);border:1px solid var(--sel-edge,#2d78ff);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    // nothing that happens in the editor reaches the view of the piece it sits in
    for (const el of [panel, voile, toolbar, sheet, entryBox]) {
      if (hint) el.style.pointerEvents = 'auto';
      for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend']) el.addEventListener(ev, (e) => e.stopPropagation());
    }
    voile.addEventListener('pointerdown', (e) => { e.preventDefault(); closeAnchored(); });
    stage.append(voile, panel, toolbar, entryBox, sheet);

    // toolbar just above the frame (below it when there is no room above); the settings sheet on the other side of the panel
    const place = () => {
      const barH = toolbar.offsetHeight;
      const panelH = frameH;
      // the bar fits its buttons into the width it is given: a bar as wide as the room (560 px at most), more buttons go to its « … » menu
      entryBox.style.width = `${Math.max(120, Math.min(sr.width - 8, 560))}px`;
      const entryH = entryBox.offsetHeight; const entryW = entryBox.offsetWidth;
      // the entry bar goes above the toolbar when there is room, else under the panel (the settings sheet then moves down)
      const stack = barH + 6 + entryH + 6;
      const above = top - barH - 6 >= 0;
      const entryAbove = top - stack >= 0;
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${above ? top - barH - 6 : top + panelH + 6}px`;
      entryBox.style.left = `${Math.max(0, Math.min(left, sr.width - entryW - 4))}px`;
      let below = top + panelH + 6 + (above ? 0 : barH + 6);
      if (entryAbove) entryBox.style.top = `${top - stack}px`;
      else { entryBox.style.top = `${below}px`; below += entryH + 6; }
      const sheetW = Math.min(sr.width, Math.max(width, 340));
      sheet.style.width = `${sheetW}px`;
      sheet.style.left = `${Math.max(0, Math.min(left, sr.width - sheetW))}px`;
      sheet.style.top = `${below}px`;
    };

    const ss = (hint && hint.staffSpaceFor(frames[0])) || main.staffSpace();
    const view = app.addView(createScoreView({ id: VIEW_ID, doc: app.doc, glyphs, movement: fragment, width: width / ss, staffSpace: ss, margin: 0, justifyLast: true }));
    const bar = mountNoteEntryBar(entryBox, { app, glyphs, label, placement: 'inline', grid: null, viewId: VIEW_ID });
    const mounted = mountScoreView(viewHost, view, { scroller: panel, app, player: null, label, glyphs, entryMessage: (m) => { bar.message(m); mainEntryMessage(m); }, ...callbacks });
    const settings = mountContainerSettings(sheet, { app, containerId, label, viewId: VIEW_ID, startOpen: true, onPercmap: callbacks.onPercmap });
    // lay the editable staff on the container's staff: first line on first line, left edge on left edge (the panel itself keeps the exact size of the frame)
    const mine = [...viewHost.querySelectorAll('[data-role="staff-line"]')].map((l) => l.getBoundingClientRect());
    if (ownLines.length && mine.length) {
      viewHost.style.position = 'relative';
      viewHost.style.top = `${Math.min(...ownLines.map((r) => r.top)) - Math.min(...mine.map((r) => r.top))}px`;
      viewHost.style.left = `${Math.min(...ownLines.map((r) => r.left)) - Math.min(...mine.map((r) => r.left))}px`;
    }
    place();
    // the entry bar grows or shrinks (the drum sounds, a second row…) after it is placed: the stack is laid out again so that it never covers the toolbar
    const resizer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;
    resizer?.observe(entryBox);
    const off = app.doc.subscribe(() => {
      if (!app.doc.find(containerId)?.fragments?.[0]) queueMicrotask(closeAnchored);
      else queueMicrotask(place); // the panel may grow with its content
    });
    state = { panel, voile, toolbar, entryBox, bar, sheet, view, mounted, settings, off, resizer, containerId, anchored: true, layer, frozenOverflow, offPlay: play.off };
    // the usual entry bar of the piece is switched on for this score, the cursor at its start
    const first = fragment.tracks.flatMap((t) => t.staves)[0];
    if (first) app.startEntryOn(first.id);
    return true;
  };

  let lastHint = null; // the pages of a part the last editor was opened from (the ◱ / ⤢ buttons reopen it in the other presentation)
  const open = (containerId, { mode, screen2, keepHint = false } = {}) => {
    if (screen2) lastHint = screen2; else if (!keepHint) lastHint = null;
    const wanted = mode ?? readMode();
    if (state) close();
    if (wanted === 'anchored' && openAnchored(containerId, lastHint)) return true;
    return openFull(containerId);
  };

  return { open, close, isOpen: () => !!state, destroy: close };
}

/**
 * The greyed reference strip: the staff below the container, over the measures it covers (aligned scores only). Redrawn when the Document changes
 * (the strip is a throw-away layout of a derived movement: nothing in it is selectable).
 */
function mountReference({ app, glyphs, host, containerId, label, width }) {
  const doc = app.doc;
  let view = null;
  const clear = () => { if (view) { view.dispose(); view = null; } host.replaceChildren(); host.style.display = 'none'; };
  const draw = () => {
    clear();
    const c = doc.find(containerId);
    const staff = c && doc.hostStaffOf(c.id);
    const mv = staff && doc.movementOf(staff);
    const track = staff && doc.parentOf(staff.id);
    const shim = mv && referenceMovement(mv, track, staff, c);
    if (!shim) return;
    host.style.display = '';
    const caption = document.createElement('div');
    caption.textContent = label('cs.reference');
    caption.style.cssText = 'font-size:12px;opacity:.8';
    const svg = document.createElement('div');
    view = createScoreView({ id: 'fragment-ref', doc, glyphs, movement: shim, width, staffSpace: STAFF_SPACE * 0.75, margin: 6 });
    svg.innerHTML = view.render().svg;
    host.append(caption, svg);
  };
  const off = doc.subscribe(() => queueMicrotask(draw));
  draw();
  return { destroy: () => { off(); clear(); } };
}
