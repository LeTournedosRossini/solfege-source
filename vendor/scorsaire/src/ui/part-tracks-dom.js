/*
 * "Tracks and staves" of ONE part of screen 2: the same look as the structural panel of screen 1, but it only chooses which tracks / staves
 * the part shows (an eye per track and per staff, written to `PID.PART_STAVES`). No adding, removing, typing or grouping here: that is screen 1.
 * What is also chosen here, for THIS part only: the order of the tracks (a grip to drag, like screen 1) and the display transposition of each track.
 * Groups and braces are shown (read only) while the part keeps the order of the document. Its title names the screen and the part so the two panels are never confused.
 */
import { SHEET_QUERY, panelMode, clampWindow } from './panel-mode.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { ensureTracksStyle } from './tracks-dom.js';
import { PID, partStaffIds, partTrackIds } from '../model/index.js';
import { createChoiceMenu } from './choice-menu.js';
import { icon } from './icons.js';
import { bindShortLong } from './button-behavior.js';
import { trackAudioButton } from './track-audio-button.js';
import { nextVisualSolo, applyAudioSolo } from './visual-solo.js';
import { trackDisplayRow } from './track-display-dom.js';
import { resolveDisplay } from '../model/trackdisplay.js';
import { transpositionOptions, semitoneChoiceId } from './tracks-intents.js';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};

/** @returns { open(partId), close(), isOpen(), destroy() } */
export function mountPartTracksPanel({ app, label = (k) => k, partName = () => '', sidebar = null, tabId = null }) {
  ensureTracksStyle();
  const openTracks = new Set(); // tracks with several staves: their staves are shown only when opened (like screen 1)
  let panel = null; let partId = null; let message = ''; let dragged = null; let dismissedAt = -1e9;
  const media = window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  // on a computer the panel lives in a tab of the sidebar (screen 2), never as a floating window
  const docked = () => !!(sidebar?.isEnabledForParts?.() && tabId && sidebar.tabBody(tabId));
  const mode = () => (docked() ? 'docked' : panelMode(media ? media.matches : false));
  const part = () => app.parts().find((p) => p.id === partId);

  const shownSet = () => new Set(partStaffIds(app.doc.work, part()));
  /** Writes a new set of shown staves; everything shown = no list (new staves appear by themselves). */
  const write = (set) => {
    const all = app.partStaffChoices().map((c) => c.id);
    message = '';
    try { app.setPartStaves(partId, all.every((id) => set.has(id)) ? null : all.filter((id) => set.has(id))); } catch (e) {
      if (e.name !== 'PartEditError') throw e;
      message = label('partTracks.lastStaff');
    }
    draw();
  };
  const eye = (on, key, onTitle, offTitle, fn) => {
    const title = label(on ? offTitle : onTitle);
    const b = el('button', { type: 'button', 'data-key': key, 'aria-label': title, title, 'aria-pressed': String(!on), onclick: fn }, on ? '👁' : '🙈');
    return b;
  };
  const soloMemory = new Map(); // part id → what its part showed before the visual solo (interface state)
  /** Eye of a TRACK: a press hides / shows it; a long press = the visual solo (only this track in this part; again = back). */
  const trackEye = (track, on, shown, all) => {
    const toggle = () => { const set = new Set(shown); for (const s of track.staves) { if (all) set.delete(s.id); else set.add(s.id); } write(set); };
    const b = eye(on, 'track-shown', 'partTracks.showTrack', 'partTracks.hideTrack', () => {});
    const choices = app.partStaffChoices().map((c) => c.id);
    const target = track.staves.map((s) => s.id);
    const solo = shown.size === target.length && target.every((id) => shown.has(id)) && choices.length > target.length;
    b.setAttribute('data-vsolo', String(solo)); if (solo) b.style.outline = '2px solid #2e78c8';
    b.title = `${b.title} — ${label('tracks.visualSolo')}`;
    bindShortLong(b, { onShort: toggle, onLong: () => {
      const r = nextVisualSolo({ all: choices, shown: choices.filter((id) => shown.has(id)), target, saved: soloMemory.get(partId) ?? null });
      if (r.saved) soloMemory.set(partId, r.saved); else soloMemory.delete(partId);
      write(new Set(r.shown)); applyAudioSolo(app, track.id, r.active);
    } });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return b;
  };
  const staffRow = (staff, shown) => el('div', { class: `tp-row tp-staff${shown.has(staff.id) ? '' : ' tp-hidden'}`, 'data-staff': staff.id },
    el('span', { class: 'tp-name' }, `${label(`staffType.${staff.type}`)}${staff.index ? ` · ${staff.index + 1}` : ''}`),
    eye(shown.has(staff.id), 'staff-shown', 'partTracks.showStaff', 'partTracks.hideStaff', () => { const n = new Set(shown); if (n.has(staff.id)) n.delete(staff.id); else n.add(staff.id); write(n); }));
  const transposeCell = (track) => {
    if (!track.hasNotation && !track.chord) return null; // (the chord track too: its symbols are written for the instrument that reads them)
    const own = part().props[PID.PART_TRANSPOSITIONS]?.[track.id];
    const t = own ?? track.transposition;
    const current = !own ? 'follow' : semitoneChoiceId(own);
    const options = transpositionOptions(label, { current });
    const text = t.chromatic === 0 ? '±0' : `${t.chromatic > 0 ? '+' : '−'}${Math.abs(t.chromatic)}`;
    const m = createChoiceMenu({ options, value: current, label: text, act: 'part-track-transpose', onPick: (id) => { if (id === 'custom' || id === current) return; run(() => app.setPartTransposition(partId, track.id, id === 'follow' ? null : id)); } });
    m.firstChild.textContent = text;
    m.title = `${label('tracks.transpose.title')} : ${options.find(([v]) => v === current)?.[1] ?? ''}`;
    m.setAttribute('data-transposed', String(t.chromatic !== 0));
    return m;
  };
  const run = (fn) => { message = ''; try { fn(); } catch (e) { if (e.name !== 'PartEditError') throw e; message = e.message; } draw(); };
  const grip = (track, disabled) => el('button', { type: 'button', class: 'tp-grip', 'data-grip': `track:${track.id}`, 'aria-label': label('partTracks.drag'), title: label('partTracks.drag'), disabled: disabled || null, onpointerdown: (e) => startDrag(e, track.id) }, '⠿');
  /** The name; a track with several staves is a toggle (chevron) that opens / closes its staves. */
  const nameCell = (track, n) => {
    const shownName = track.name || label('tracks.defaultName', { n });
    const isOpen = openTracks.has(track.id);
    const t = label(isOpen ? 'tracks.closeTrack' : 'tracks.open', { name: shownName });
    return el('button', { type: 'button', class: 'tp-name tp-toggle', 'data-key': `track-toggle-${track.id}`, 'aria-expanded': String(isOpen), title: t, 'aria-label': t,
      onclick: () => { if (isOpen) openTracks.delete(track.id); else openTracks.add(track.id); draw(); } }, icon(isOpen ? 'chevron-down' : 'chevron-right', { size: '1.1em' }), el('span', { class: 'tp-toggle-text' }, shownName));
  };
  /** Bars and size of the track in THIS part, over the track's own display. */
  const displayRow = (track) => {
    const d = app.partTrackDisplay(partId, track.id);
    return trackDisplayRow({ label, own: d.own, base: resolveDisplay(d.base), sizeable: track.sizeable, slashes: { ...app.slashInfo(track.id), ranges: true, explicitEmpty: true }, onSet: (patch) => run(() => app.setPartTrackDisplay(partId, track.id, patch)) });
  };
  /** The staves this part draws for the track: the real ones, or one of the track's composite staves (model/composite.js). */
  const compositeRow = (track) => {
    const current = app.partTrackDisplay(partId, track.id).shown.composite ?? '';
    const choices = [['', label('composite.real')], ...track.composites.map((c) => [c.id, c.name || label('composite.defaultName', { n: track.composites.indexOf(c) + 1 })])];
    return el('div', { class: 'tp-row tp-meta', 'data-part-composite': track.id }, el('span', { class: 'tp-meta-label' }, label('composite.pick')),
      createChoiceMenu({ options: choices, value: current, label: label('composite.pick'), act: 'part-composite', onPick: (id) => run(() => app.setPartTrackDisplay(partId, track.id, { composite: id || null })) }));
  };
  const trackBlock = (track, n, shown, count) => {
    const on = track.staves.some((s) => shown.has(s.id));
    const all = track.staves.every((s) => shown.has(s.id));
    return el('div', { class: `tp-track${on ? '' : ' tp-hidden'}`, 'data-track': track.id, 'data-movement': String(track.movementIndex ?? 0) },
      el('div', { class: 'tp-row' }, grip(track, count < 2 || track.chord),
        nameCell(track, n),
        transposeCell(track),
        trackAudioButton(app, track.id, label),
        trackEye(track, on, shown, all)),
      openTracks.has(track.id) ? displayRow(track) : null,
      openTracks.has(track.id) && track.composites?.length ? compositeRow(track) : null,
      track.staves.length > 1 && openTracks.has(track.id) ? track.staves.map((s) => staffRow(s, shown)) : null);
  };
  // ---------- drag a track (a grip) among the tracks of its movement: the order is the part's own ----------
  let drag = null;
  const clearMarks = () => panel?.querySelectorAll('.tp-drop-before, .tp-drop-after, .tp-dragging').forEach((n) => n.classList.remove('tp-drop-before', 'tp-drop-after', 'tp-dragging'));
  const slotAt = (y) => { let slot = 0; for (const row of drag.rows) { const r = row.getBoundingClientRect(); if (y > r.top + r.height / 2) slot += 1; else break; } return slot; };
  const markDrop = () => {
    clearMarks(); drag.rows[drag.from].classList.add('tp-dragging');
    const to = drag.slot > drag.from ? drag.slot - 1 : drag.slot;
    if (to === drag.from) return;
    if (drag.slot < drag.rows.length) drag.rows[drag.slot].classList.add('tp-drop-before'); else drag.rows[drag.rows.length - 1].classList.add('tp-drop-after');
  };
  const endDrag = (apply) => {
    if (!drag) return;
    const d = drag; drag = null;
    window.removeEventListener('pointermove', d.onMove, true); window.removeEventListener('pointerup', d.onUp, true); window.removeEventListener('pointercancel', d.onCancel, true);
    try { d.handle.releasePointerCapture?.(d.pointerId); } catch { /* the handle may already be gone */ }
    clearMarks();
    if (!apply) return;
    const to = d.slot > d.from ? d.slot - 1 : d.slot;
    if (to !== d.from) run(() => app.setPartTrackOrder(partId, d.id, to));
  };
  const startDrag = (e, id) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const handle = panel.querySelector(`[data-grip="track:${id}"]`);
    const item = handle?.closest('.tp-track');
    if (!item) return;
    const rows = [...panel.querySelectorAll('.tp-track')].filter((n) => n.getAttribute('data-movement') === item.getAttribute('data-movement'));
    const from = rows.indexOf(item);
    if (from < 0 || rows.length < 2) return;
    drag = { id, handle, rows, from, slot: from, pointerId: e.pointerId };
    drag.onMove = (ev) => { if (ev.pointerId === drag.pointerId) { drag.slot = slotAt(ev.clientY); markDrop(); } };
    drag.onUp = (ev) => { if (ev.pointerId === drag?.pointerId) { drag.slot = slotAt(ev.clientY); endDrag(true); } };
    drag.onCancel = (ev) => { if (ev.pointerId === drag?.pointerId) endDrag(false); };
    window.addEventListener('pointermove', drag.onMove, true); window.addEventListener('pointerup', drag.onUp, true); window.addEventListener('pointercancel', drag.onCancel, true);
    try { handle.setPointerCapture?.(e.pointerId); } catch { /* best effort */ }
    markDrop();
  };
  const range = (mv, from, to, groups, shown, count = mv.tracks.length) => {
    const out = []; let i = from;
    while (i <= to) {
      const g = groups.find((x) => x.from === i);
      if (g) { out.push(el('div', { class: 'tp-group', 'data-group': g.id }, g.label ? el('div', { class: 'tp-row' }, g.label) : null, ...range(mv, g.from, g.to, g.groups, shown, count))); i = g.to + 1; }
      else { out.push(trackBlock({ ...mv.tracks[i], movementIndex: mv.movementIndex }, i + 1, shown, count)); i += 1; }
    }
    return out;
  };

  function place() {
    const m = mode(); panel.setAttribute('data-mode', m);
    if (m === 'docked') { panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = ''; return; }
    if (m === 'sheet') { panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = ''; return; }
    const rect = panel.getBoundingClientRect(); const vw = window.innerWidth; const vh = window.innerHeight;
    const pos = clampWindow({ ...(dragged ?? { left: vw - rect.width - 12, top: 64 }), width: rect.width, height: rect.height, viewportWidth: vw, viewportHeight: vh });
    Object.assign(panel.style, { left: `${pos.left}px`, top: `${pos.top}px`, right: 'auto', bottom: 'auto' });
  }
  function enableWindowDrag(head) {
    let start = null;
    head.addEventListener('pointerdown', (e) => { if (mode() !== 'floating' || e.target.closest('button')) return; const r = panel.getBoundingClientRect(); start = { dx: e.clientX - r.left, dy: e.clientY - r.top }; head.setPointerCapture?.(e.pointerId); });
    head.addEventListener('pointermove', (e) => { if (!start) return; const r = panel.getBoundingClientRect(); dragged = clampWindow({ left: e.clientX - start.dx, top: e.clientY - start.dy, width: r.width, height: r.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }); panel.style.left = `${dragged.left}px`; panel.style.top = `${dragged.top}px`; });
    const end = () => { start = null; }; head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  }
  function draw() {
    if (!partId) return;
    if (!part()) { api.close(); return; }
    if (!panel) {
      panel = el('div', { 'data-tracks-panel': '', 'data-part-tracks': '', 'data-zoom-lock': '', role: 'dialog' });
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !docked()) { e.stopPropagation(); api.close(); } });
      (docked() ? sidebar.tabBody(tabId) : document.body).append(panel);
    }
    const index = app.parts().findIndex((p) => p.id === partId);
    const title = label('partTracks.title', { name: partName(part(), index) });
    panel.setAttribute('aria-label', title);
    const shown = shownSet();
    const head = el('div', { class: 'tp-head' }, docked() ? null : el('span', { class: 'tp-title' }, title), // docked: the tab is already named « Tracks »
      part().props[PID.PART_TRACK_ORDER] ? el('button', { type: 'button', 'data-act': 'order-reset', onclick: () => run(() => app.setPartTrackOrder(partId, null, 0)) }, label('partTracks.orderReset')) : null,
      el('button', { type: 'button', 'data-act': 'show-all', onclick: () => write(new Set(app.partStaffChoices().map((c) => c.id))) }, label('partTracks.all')),
      docked() ? null : el('button', { type: 'button', 'data-key': 'close', 'aria-label': label('tracks.close'), onclick: () => api.close() }, '✕'));
    enableWindowDrag(head);
    const blocks = [];
    app.tracksOutline().forEach((mv, mi, outline) => {
      if (outline.length > 1) blocks.push(el('div', { class: 'tp-movement' }, mv.title || label('tracks.movement', { n: mi + 1 })));
      // the part's own order of the tracks (groups are left out while the order differs from the document's: a bracket needs its tracks side by side)
      const order = partTrackIds(part(), app.doc.work.movements[mi]);
      const custom = order.some((id, i) => id !== mv.tracks[i].id);
      const ordered = { ...mv, tracks: order.map((id) => mv.tracks.find((t) => t.id === id)), groups: custom ? [] : mv.groups };
      blocks.push(...range(ordered, 0, ordered.tracks.length - 1, ordered.groups, shown));
    });
    // the whole part at once: a number of semitones added to every track (its own transposition, or its instrument's)
    const all = part().props[PID.PART_TRANSPOSE_ALL] ?? 0;
    const allText = (n) => (n === 0 ? '±0' : `${n > 0 ? '+' : '−'}${Math.abs(n)}`);
    const allOptions = []; for (let n = 12; n >= -12; n--) allOptions.push([`a:${n}`, n === 0 ? label('partTracks.masterNone') : `${allText(n)} · ${label(n > 0 ? 'partTracks.masterHigher' : 'partTracks.masterLower')}`]);
    const allMenu = createChoiceMenu({ options: allOptions, value: `a:${all}`, label: allText(all), act: 'part-transpose-all', onPick: (id) => { const n = Number(String(id).slice(2)); if (n !== all) run(() => app.setPartTransposeAll(partId, n)); } });
    allMenu.firstChild.textContent = allText(all); allMenu.title = label('partTracks.master'); allMenu.setAttribute('data-transposed', String(all !== 0));
    const master = el('div', { class: 'tp-row tp-master', 'data-part-master': '', title: label('partTracks.masterHint') }, el('span', { class: 'tp-name' }, label('partTracks.master')), allMenu);
    // how the part reads the chord symbols: as the score's display tags say, as written, or as played with the capo (a part is a « version »: the sound and the score do not change)
    const view = part().props[PID.PART_CHORD_VIEW] ?? 'author';
    const viewMenu = createChoiceMenu({ options: ['author', 'original', 'capo'].map((m) => [m, label(`parts.chordView.${m}`)]), value: view, label: label(`parts.chordView.${view}`), act: 'part-chord-view', onPick: (m) => { if (m !== view) run(() => app.setPartChordView(partId, m)); } });
    viewMenu.title = label('parts.chordView');
    const chordView = el('div', { class: 'tp-row tp-master', 'data-part-chord-view': '' }, el('span', { class: 'tp-name' }, label('parts.chordView')), viewMenu);
    // « capo shapes » need to know WHICH guitar gives the capo: say it, and let the person choose (several guitars may have different capos); say so too when no capo is written at all
    const capoInfo = view !== 'original' ? app.chordCapoInfo?.() : null;
    let capoRow = null;
    if (capoInfo && view === 'capo' && !capoInfo.staves.length) capoRow = el('div', { class: 'tp-empty', 'data-part-capo-none': '', style: 'padding:2px 12px;font-size:11.5px' }, label('parts.chordCapo.none'));
    else if (capoInfo && capoInfo.staves.length) {
      const capoMenu = createChoiceMenu({ options: [['', label('parts.chordCapo.auto', { name: capoInfo.staves[0].name })], ...capoInfo.staves.map((x) => [x.id, x.name])], value: capoInfo.chosen ?? '', label: label('parts.chordCapo.of', { name: capoInfo.used ?? '—' }), act: 'part-chord-capo', onPick: (id) => run(() => app.setChordCapoStaff(capoInfo.chordStaffId, id || null)) });
      capoMenu.title = label('parts.chordCapo.hint'); capoMenu.firstChild.textContent = label('parts.chordCapo.of', { name: capoInfo.used ?? '—' });
      capoRow = el('div', { class: 'tp-row tp-master', 'data-part-chord-capo': '' }, el('span', { class: 'tp-name' }, label('parts.chordCapo.title')), capoMenu);
    }
    panel.replaceChildren(head, master, chordView, ...(capoRow ? [capoRow] : []), el('div', { class: 'tp-empty', style: docked() ? 'font-size:11.5px;line-height:1.3;padding:2px 12px' : null }, label('partTracks.hint')), el('div', { class: 'tp-status', role: 'status', 'data-tracks-message': '' }, message), ...blocks);
    place();
  }
  const off = app.doc.subscribe(() => { if (partId) draw(); });
  const offMixer = app.onMixerChange?.(() => { if (partId) draw(); }) ?? (() => {});
  const offOutside = dismissOnOutside(() => (docked() ? null : panel), () => { dismissedAt = Date.now(); api.close(); });
  // the sidebar appears / disappears (the window crosses the computer / tablet limit): the panel changes parent
  const offSide = sidebar?.onChange?.(() => { if (panel && (panel.getAttribute('data-mode') === 'docked') !== docked()) { panel.remove(); panel = null; } if (partId) draw(); });
  const onResize = () => { if (panel) place(); };
  window.addEventListener('resize', onResize);
  const api = {
    open(id) { if (Date.now() - dismissedAt < 400 && !partId) return; partId = id; message = ''; panel?.remove(); panel = null; draw(); },
    close() { partId = null; message = ''; panel?.remove(); panel = null; },
    isOpen: () => !!partId,
    destroy() { api.close(); off(); offMixer(); offOutside(); offSide?.(); window.removeEventListener('resize', onResize); },
  };
  return api;
}
