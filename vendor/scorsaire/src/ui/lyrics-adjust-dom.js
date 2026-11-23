/*
 * The ADJUSTMENT window of the lyrics: the words of a verse (the whole text) and the notes of a staff, to put every syllable on the note it belongs to.
 * The staff is drawn like in the editor (a throw-away copy of the document, without its lyrics) in ONE line that scrolls; the syllables are chips: those on a note stand under it,
 * those still waiting stand in a row above. A chip is dragged onto a note (the nearest one), or tapped and then the note is tapped (a finger). The order of the words never changes
 * (a chip cannot go in front of the placed one before it; the placed ones after it are pushed on where they collide: `moveInAssignment`). Nothing is written until « Apply »
 * (one transaction), so « Cancel » leaves the score as it was. Bottom sheet on phones / tablets, centered window on desktop.
 */
import { createDocument, loadWork, serializeWork, PID } from '../model/index.js';
import { lyricAssignmentOf, moveInAssignment } from '../model/lyricsedit.js';
import { autoAssign, proposePhrase, placePhrase } from '../model/lyriceventedit.js';
import { createScoreView } from '../view/score-view.js';
import { cursorOfElement } from './noteentry-cursor.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const STAFF_SPACE = 9;
const CHIP_ROW = 30; // px between two verse rows under the staff

/** The staff alone, without lyrics, in one line: { svg, view, copy } (the view answers `entryCursorRect` for the chords). */
export function adjustPreview({ doc, glyphs, staffId }) {
  const copy = createDocument(loadWork(serializeWork(doc.work)));
  const staff = copy.find(staffId);
  const mv = copy.movementOf(staff);
  copy.transaction('preview', () => {
    for (const t of mv.tracks) {
      if (!t.staves.includes(staff)) copy.set(t, PID.VISIBLE, false);
      else for (const s of t.staves) if (s !== staff) copy.set(s, PID.VISIBLE, false); // the other staves of its track (tablature, rhythm…) are not shown either: the picture is this staff alone
    }
    copy.set(staff, PID.LYRIC_LINKS, []);
  });
  const view = createScoreView({ id: 'lyrics-adjust', doc: copy, glyphs, movement: mv, width: Math.max(60, mv.masterbars.length * 40), staffSpace: STAFF_SPACE, margin: 12 });
  return { svg: view.render().svg, view, copy };
}

/**
 * `source` (optional) makes the window work on something else than a verse of the work's texts: { title, load(): info (see `lyricAssignmentOf`), apply(assign) } — the syllables of a
 * lyrics TRACK of events put on the notes of `staffId` (the verse stepper is hidden then).
 */
export function openLyricsAdjust({ app, glyphs, label = (k) => k, staffId, verse = 0, source = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let current = verse;
  let info = null; let assign = []; let spans = []; let selected = null; let columns = []; let sizeBox = { w: 0, h: 0 };
  const veil = document.createElement('div');
  veil.setAttribute('data-lyrics-adjust', ''); veil.setAttribute('data-zoom-lock', '');
  veil.style.cssText = `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`;
  const box = document.createElement('div');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); if (!sheet) box.setAttribute('data-resizable', 'lyrics-adjust'); box.setAttribute('aria-label', label('lyrics.adjust.title'));
  box.style.cssText = `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:14px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;display:flex;flex-direction:column;gap:8px;${sheet ? 'width:100%;max-height:92vh;border-radius:12px 12px 0 0' : 'width:min(1000px,calc(100vw - 24px));max-height:90vh;border-radius:8px'}`;
  const mk = (text, act, fn) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('data-act', act); b.addEventListener('click', fn);
    b.style.cssText = 'min-height:var(--ui-target,30px);padding:0 14px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);border-radius:6px'; return b;
  };
  const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:6px';
  const title = document.createElement('div'); title.style.cssText = 'flex:1;font-weight:var(--w-semi,600);font-size:16px';
  const verseLabel = document.createElement('span'); verseLabel.setAttribute('data-adjust-verse', '');
  const hint = document.createElement('div'); hint.textContent = label('lyrics.adjust.hint'); hint.style.cssText = 'font-size:12px;opacity:.75';
  // phrase by phrase (the waiting text of a lyrics track): which phrase, and from / to which measure it is put; the card of the form only proposes a start
  let scopeK = 0; let fromOverride = null; let toOverride = null; let startRankOverride = null; let endRankOverride = null; // measures by the steppers, notes by the handles
  const scopeBar = document.createElement('div'); scopeBar.setAttribute('data-adjust-scope', '');
  scopeBar.style.cssText = 'display:none;flex-wrap:wrap;align-items:center;gap:6px;padding:6px;border:1px solid var(--edge,#999);border-radius:6px';
  const phraseLabel = document.createElement('span'); phraseLabel.setAttribute('data-adjust-phrase', ''); phraseLabel.style.cssText = 'flex:1 1 14em;font-weight:var(--w-semi,600)';
  const rangeLabel = document.createElement('span'); rangeLabel.setAttribute('data-adjust-range', '');
  const counter = document.createElement('span'); counter.setAttribute('data-adjust-counter', ''); counter.style.cssText = 'font-size:13px';
  const band = document.createElement('div'); band.setAttribute('data-adjust-band', ''); band.style.cssText = 'position:absolute;pointer-events:none;background:rgba(45,120,255,.10);border-left:2px solid rgba(45,120,255,.5);border-right:2px solid rgba(45,120,255,.5);display:none';
  // « Held over notes » (melisma): the chosen placed syllable covers more notes, which then take no syllable of their own
  const spanBar = document.createElement('div'); spanBar.setAttribute('data-adjust-span', ''); spanBar.style.cssText = 'display:none;align-items:center;gap:6px;padding:4px 6px;font-size:13px';
  const spanText = document.createElement('span');
  // the handles on both edges of the band: dragged along the staff, they snap onto the notes (which stand on the beats, the off-beats, the sixteenths…)
  const mkHandle = (side) => {
    const h = document.createElement('div'); h.setAttribute('data-adjust-handle', side);
    h.style.cssText = 'position:absolute;top:0;width:22px;margin-left:-11px;cursor:ew-resize;touch-action:none;display:none;align-items:center;justify-content:center;z-index:2';
    const knob = document.createElement('div'); knob.style.cssText = 'width:12px;height:44px;border-radius:6px;background:rgba(45,120,255,.85);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)'; h.append(knob);
    const tip = document.createElement('div'); tip.setAttribute('data-adjust-handle-tip', side); tip.style.cssText = 'position:absolute;top:-22px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:12px;padding:1px 6px;border-radius:8px;background:#1d4fd0;color:#fff;display:none'; h.append(tip);
    return h;
  };
  const handleL = mkHandle('start'); const handleR = mkHandle('end');
  const pool = document.createElement('div'); pool.setAttribute('data-adjust-pool', ''); pool.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;min-height:36px;padding:6px;border:1px dashed var(--edge,#999);border-radius:6px;align-items:center';
  const scroller = document.createElement('div'); scroller.style.cssText = 'overflow:auto;background:var(--score,#fff);border:1px solid var(--edge,#bbb);border-radius:6px;min-height:80px;max-height:55vh';
  const stageEl = document.createElement('div'); stageEl.style.cssText = 'position:relative';
  const holder = document.createElement('div'); holder.style.cssText = 'color:var(--ink,#111)';
  const chips = document.createElement('div'); chips.style.cssText = 'position:absolute;left:0;top:0';
  const result = document.createElement('div'); result.setAttribute('data-adjust-result-row', ''); result.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;color:var(--ink,#111)';
  let stageOffset = 0; let cropTop = 0;
  const error = document.createElement('div'); error.setAttribute('role', 'alert'); error.style.cssText = 'color:#b00020;min-height:1.2em';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap;justify-content:flex-end';
  stageEl.append(band, holder, chips, result, handleL, handleR); scroller.append(stageEl);

  let done = false;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };

  const chipEl = (i) => {
    const sy = info.syllables[i];
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-adjust-chip', String(i));
    b.textContent = sy.join === '-' ? `${sy.text}-` : sy.text;
    b.style.cssText = `padding:2px 10px;min-height:26px;border-radius:13px;font:italic 15px Georgia,serif;touch-action:none;cursor:grab;border:2px solid ${selected === i ? 'var(--sel-edge,#2d78ff)' : 'var(--edge,#999)'};background:${selected === i ? 'var(--accent-soft,#dde8ff)' : 'var(--field,#fff)'};color:var(--ink,#111)`;
    b.addEventListener('pointerdown', (e) => startDrag(e, i, b));
    return b;
  };

  /**
   * Draws the chips: the waiting ones in the pool, the placed ones just ABOVE their note (on several lines when they would touch), and under the staff the RESULT: the words
   * as they will stand under the notes, so that nothing covers it.
   */
  const drawChips = () => {
    pool.replaceChildren(); chips.replaceChildren(); result.replaceChildren();
    const scoped = !!info.phrases?.length;
    const inScope = (i) => !scoped || i < info.events.length || (i >= info.phrases[scopeK].from && i < info.phrases[scopeK].to);
    const allWaiting = info.syllables.map((_, i) => i).filter((i) => assign[i] === null);
    for (const i of allWaiting) spans[i] = 0; // a syllable off the notes holds none
    const waiting = allWaiting.filter(inScope);
    if (!waiting.length && !(scoped && allWaiting.length)) { const none = document.createElement('span'); none.textContent = label(info.syllables.length ? 'lyrics.adjust.nonePending' : 'lyrics.adjust.noSyllables'); none.style.cssText = 'font-size:12px;opacity:.6'; pool.append(none); }
    for (const i of waiting) pool.append(chipEl(i));
    if (scoped && allWaiting.length > waiting.length) { const more = document.createElement('span'); more.textContent = label('lyrics.adjust.moreWaiting', { n: String(allWaiting.length - waiting.length) }); more.style.cssText = 'font-size:12px;opacity:.6;margin-left:auto'; pool.append(more); }
    const placed = [];
    assign.forEach((p, i) => {
      if (p === null || !columns[p]) return;
      const c = chipEl(i);
      c.style.position = 'absolute'; c.style.left = `${Math.max(0, columns[p].x - 6)}px`; c.style.top = '0px';
      chips.append(c); placed.push({ c, p, i });
      const sy = info.syllables[i];
      const word = document.createElement('span'); word.textContent = sy.join === '-' ? `${sy.text}-` : sy.text; word.setAttribute('data-adjust-result', String(i));
      word.style.cssText = `position:absolute;white-space:nowrap;left:${Math.max(0, columns[p].x - 2)}px;top:0;font:italic 15px Georgia,serif`;
      result.append(word);
    });
    // a chip that would touch the one before it goes to the next line UP
    const lanes = [];
    for (const { c, p } of placed) {
      const left = Math.max(0, columns[p].x - 6);
      let lane = lanes.findIndex((right) => left >= right + 4);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = left + c.offsetWidth;
      c.dataset.lane = String(lane);
    }
    const rows = Math.max(1, lanes.length);
    const above = rows * CHIP_ROW + 4;
    for (const { c } of placed) c.style.top = `${above - (Number(c.dataset.lane) + 1) * CHIP_ROW}px`;
    holder.style.paddingTop = `${above}px`; holder.style.boxSizing = 'content-box'; // padding, not margin: a margin would collapse through the stage and move the chips with it
    chips.style.height = `${above}px`;
    for (const { p, i } of placed) {
      const w = result.querySelector(`[data-adjust-result="${i}"]`); w.style.top = `${above + sizeBox.h + 4}px`;
      const span = spans[i] ?? 0;
      if (span > 0 && columns[p]) { // a melisma: a line under the notes the syllable is held over
        const last = columns[Math.min(columns.length - 1, p + span)];
        const hold = document.createElement('span'); hold.setAttribute('data-adjust-hold', String(i));
        hold.style.cssText = `position:absolute;height:0;border-top:2px solid currentColor;opacity:.7;left:${Math.max(0, columns[p].x - 2)}px;width:${Math.max(4, last.x + last.w - columns[p].x)}px;top:${above + sizeBox.h + 4 + 21}px`;
        result.append(hold);
      }
    }
    result.style.height = `${above + sizeBox.h + 4 + 24}px`;
    stageEl.style.height = `${above + sizeBox.h + 4 + 24}px`;
    stageOffset = above;
    if (typeof drawSpan === 'function') drawSpan();
  };

  const nearestColumn = (clientX) => {
    const b = stageEl.getBoundingClientRect();
    const x = clientX - b.left;
    let best = -1; let dist = Infinity;
    columns.forEach((c, i) => { const d = Math.abs(c.x + c.w / 2 - x); if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const overStage = (e) => { const b = scroller.getBoundingClientRect(); return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom; };
  const overPool = (e) => { const b = pool.getBoundingClientRect(); return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom; };
  const apply = (i, p) => {
    try { assign = moveInAssignment(assign, i, p, info.chords.length, spans); error.textContent = ''; } catch (e) { error.textContent = String(e?.message ?? e); }
    selected = null; drawChips();
  };

  let drag = null;
  const mark = document.createElement('div'); mark.style.cssText = 'position:absolute;width:3px;background:rgba(45,120,255,.7);pointer-events:none;display:none;border-radius:2px';
  stageEl.append(mark);
  function startDrag(e, i, el) {
    if (e.button > 0) return;
    drag = { i, id: e.pointerId, x0: e.clientX, y0: e.clientY, armed: false, ghost: null, el };
    window.addEventListener('pointermove', onMove, true); window.addEventListener('pointerup', onUp, true); window.addEventListener('pointercancel', stopDrag, true);
  }
  function stopDrag() {
    if (!drag) return;
    drag.ghost?.remove(); mark.style.display = 'none';
    window.removeEventListener('pointermove', onMove, true); window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', stopDrag, true);
    drag = null;
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.armed) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) <= 5) return;
      drag.armed = true;
      const g = drag.el.cloneNode(true); g.style.cssText += ';position:fixed;z-index:3800;pointer-events:none;transform:translate(-50%,-120%);box-shadow:0 2px 8px rgba(0,0,0,.3)';
      document.body.append(g); drag.ghost = g;
    }
    e.preventDefault();
    drag.ghost.style.left = `${e.clientX}px`; drag.ghost.style.top = `${e.clientY}px`;
    const k = overStage(e) ? nearestColumn(e.clientX) : -1;
    if (k >= 0) { mark.style.display = ''; mark.style.left = `${columns[k].x + columns[k].w / 2 - 1}px`; mark.style.top = `${columns[k].y1 - cropTop + stageOffset}px`; mark.style.height = `${columns[k].y2 - columns[k].y1}px`; } else mark.style.display = 'none';
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const was = drag; const wasArmed = was.armed;
    const k = wasArmed && overStage(e) ? nearestColumn(e.clientX) : -1;
    const toPool = wasArmed && overPool(e);
    stopDrag();
    if (!wasArmed) { selected = selected === was.i ? null : was.i; drawChips(); return; } // a tap: the chip waits for a tap on a note
    if (k >= 0) apply(was.i, k); else if (toPool) apply(was.i, null);
  }
  // a tap on a note while a chip is chosen puts the chip there
  scroller.addEventListener('click', (e) => { if (selected === null || e.target.closest('[data-adjust-chip]')) return; const k = nearestColumn(e.clientX); if (k >= 0) apply(selected, k); });
  pool.addEventListener('click', (e) => { if (selected !== null && !e.target.closest('[data-adjust-chip]')) apply(selected, null); });

  function drawSpan() {
    const i = selected;
    const on = i !== null && info && assign[i] !== null && assign[i] !== undefined;
    spanBar.style.display = on ? 'flex' : 'none';
    if (!on) return;
    const n = spans[i] ?? 0;
    const change = (d) => {
      const next = Math.max(0, Math.min(info.chords.length - 1 - assign[i], n + d));
      const keep = selected;
      spans[i] = next;
      try { assign = moveInAssignment(assign, i, assign[i], info.chords.length, spans); error.textContent = ''; } catch (e) { spans[i] = n; error.textContent = String(e?.message ?? e); }
      selected = keep; drawChips(); drawSpan();
    };
    spanBar.replaceChildren(spanText, ...[['−', 'adjust-span-down', -1], ['+', 'adjust-span-up', 1]].map(([t, act, d]) => { const b = mk(t, act, () => change(d)); b.style.padding = '0 10px'; return b; }));
    spanText.textContent = label('lyrics.adjust.span', { n: String(n + 1) });
    spanBar.prepend(spanText);
  }
  const lastMeasure = () => Math.max(0, ...info.chords.map((c) => c.mi));
  const rangeOf = () => {
    const prop = proposePhrase(info, assign, scopeK, { fromMeasure: fromOverride, fromRank: startRankOverride });
    const startRank = prop?.startRank ?? 0;
    let endRank = prop?.endRank ?? startRank;
    if (endRankOverride !== null) endRank = Math.max(startRank, endRankOverride);
    else if (toOverride !== null) { const r = info.chords.map((c) => c.mi).lastIndexOf(toOverride); if (r >= startRank) endRank = r; }
    const from = info.chords[startRank]?.mi ?? 0; const to = info.chords[endRank]?.mi ?? from;
    return { prop, from, to, startRank, endRank };
  };
  function drawScope(keepScroll = false) {
    const on = !!info?.phrases?.length;
    scopeBar.style.display = on ? 'flex' : 'none';
    if (!on) { band.style.display = 'none'; return; }
    scopeK = Math.max(0, Math.min(info.phrases.length - 1, scopeK));
    const ph = info.phrases[scopeK];
    const words = info.syllables.slice(ph.from, ph.to).map((s) => s.text);
    phraseLabel.textContent = `${label('lyrics.adjust.phrase', { n: String(scopeK + 1), total: String(info.phrases.length), section: ph.section ? ` · ${ph.section}` : '' })} — ${words.slice(0, 6).join(' ')}${words.length > 6 ? '…' : ''}`;
    const { prop, from, to, startRank, endRank } = rangeOf();
    rangeLabel.replaceChildren();
    const btn = (text, act, fn) => { const b = mk(text, act, fn); b.style.padding = '0 10px'; return b; };
    const last = lastMeasure();
    const waitingN = (() => { let n = 0; for (let i = ph.from; i < ph.to; i += 1) if (assign[i] === null) n += 1; return n; })();
    // the notes of the range: from its first note to its last (the proposal ends on the note that takes the last syllable; a handle or a stepper sets them by hand)
    const inRange = info.chords.filter((c, r) => r >= startRank && r <= endRank);
    const tied = inRange.filter((c) => c.cont).length;
    const untied = inRange.length - tied;
    const txt = (t) => { const s = document.createElement('span'); s.textContent = t; return s; };
    rangeLabel.append(txt(`${label('lyrics.adjust.measures')} `), btn('−', 'adjust-from-down', () => { fromOverride = Math.max(0, from - 1); toOverride = null; startRankOverride = null; endRankOverride = null; drawScope(); drawChips(); }), txt(` ${from + 1} `), btn('+', 'adjust-from-up', () => { fromOverride = Math.min(last, from + 1); toOverride = null; startRankOverride = null; endRankOverride = null; drawScope(); drawChips(); }),
      txt(` ${label('lyrics.adjust.to')} `), btn('−', 'adjust-to-down', () => { toOverride = Math.max(from, to - 1); endRankOverride = null; drawScope(); }), txt(` ${to + 1} `), btn('+', 'adjust-to-up', () => { toOverride = Math.min(last, to + 1); endRankOverride = null; drawScope(); }));
    counter.textContent = label('lyrics.adjust.counter', { s: String(waitingN), n: String(inRange.length), t: String(tied) });
    counter.style.color = waitingN && untied !== waitingN ? 'var(--danger-ink,#b00020)' : 'inherit';
    counter.title = untied === waitingN ? '' : label(untied < waitingN ? 'lyrics.adjust.tooFew' : 'lyrics.adjust.tooMany', { d: String(Math.abs(untied - waitingN)) });
    // the band over the notes of the range, and its handles
    if (columns[startRank] && columns[endRank] && endRank >= startRank) {
      const left = Math.max(0, columns[startRank].x - 8); const right = columns[endRank].x + columns[endRank].w + 8;
      band.style.display = ''; band.style.left = `${left}px`; band.style.width = `${right - left}px`; band.style.top = '0px'; band.style.height = `${stageEl.offsetHeight || 0}px`;
      for (const [h, x, r] of [[handleL, left, startRank], [handleR, right, endRank]]) {
        h.style.display = 'flex'; h.style.left = `${x}px`; h.style.height = `${stageEl.offsetHeight || 0}px`;
        const c = info.chords[r]; const beat = c?.pos ? 1 + (c.pos[0] / c.pos[1]) * 4 : 1;
        h.firstChild.nextSibling.textContent = label('lyrics.adjust.at', { m: String((c?.mi ?? 0) + 1), b: String(Math.round(beat * 100) / 100).replace('.', ',') });
      }
      if (prop && !keepScroll) scroller.scrollLeft = Math.max(0, columns[startRank].x - 60);
    } else { band.style.display = 'none'; handleL.style.display = 'none'; handleR.style.display = 'none'; }
  }
  // dragging a handle: the nearest note edge (left edge of a note for the start, right edge for the end)
  for (const h of [handleL, handleR]) {
    const side = h.getAttribute('data-adjust-handle');
    let id = null;
    h.addEventListener('pointerdown', (e) => { id = e.pointerId; h.setPointerCapture(id); h.firstChild.nextSibling.style.display = 'block'; e.preventDefault(); e.stopPropagation(); });
    h.addEventListener('pointermove', (e) => {
      if (id !== e.pointerId) return;
      const x = e.clientX - stageEl.getBoundingClientRect().left;
      const { startRank, endRank } = rangeOf();
      let best = -1; let dist = Infinity;
      columns.forEach((c, r) => {
        if (side === 'start' ? r > endRank : r < startRank) return;
        const edge = side === 'start' ? c.x : c.x + c.w;
        const d = Math.abs(edge - x); if (d < dist) { dist = d; best = r; }
      });
      if (best < 0) return;
      if (side === 'start') { startRankOverride = best; fromOverride = null; if (endRankOverride === null) endRankOverride = endRank; }
      else { endRankOverride = best; toOverride = null; }
      drawScope(true);
    });
    const stop = (e) => { if (id !== e.pointerId) return; id = null; h.firstChild.nextSibling.style.display = 'none'; drawScope(true); };
    h.addEventListener('pointerup', stop); h.addEventListener('pointercancel', stop);
  }
  const resetRange = () => { fromOverride = null; toOverride = null; startRankOverride = null; endRankOverride = null; };
  const goPhrase = (delta) => { scopeK += delta; resetRange(); drawChips(); drawScope(); };
  const placeBtn = mk(label('lyrics.adjust.placePhrase'), 'adjust-place-phrase', () => {
    const { prop } = rangeOf();
    if (!prop) { error.textContent = label('lyrics.adjust.noRoom'); return; }
    assign = placePhrase(assign, info, scopeK, prop.startRank, spans); error.textContent = ''; selected = null;
    resetRange();
    const next = info.phrases.findIndex((p, k) => k > scopeK && assign.slice(p.from, p.to).some((x) => x === null));
    if (next >= 0) scopeK = next;
    drawChips(); drawScope();
  });
  placeBtn.title = label('lyrics.adjust.placePhraseTip');
  scopeBar.append(mk('◂', 'adjust-phrase-prev', () => goPhrase(-1)), phraseLabel, mk('▸', 'adjust-phrase-next', () => goPhrase(1)), rangeLabel, counter, placeBtn);
  const load = () => {
    error.textContent = '';
    info = source ? source.load() : lyricAssignmentOf(app.doc, staffId, current);
    verseLabel.textContent = source ? '' : label('lyrics.verse', { n: current + 1 });
    if (!info) { holder.textContent = ''; pool.replaceChildren(); chips.replaceChildren(); error.textContent = label('lyrics.adjust.noText'); okBtn.disabled = true; return; }
    okBtn.disabled = false;
    assign = [...info.assign]; spans = [...(info.spans ?? [])]; selected = null;
    scopeK = Math.max(0, (info.phrases ?? []).findIndex((p) => assign.slice(p.from, p.to).some((x) => x === null))); fromOverride = null; toOverride = null; startRankOverride = null; endRankOverride = null;
    const { svg, view, copy } = adjustPreview({ doc: app.doc, glyphs, staffId });
    holder.innerHTML = svg;
    const el = holder.querySelector('svg[role="img"]');
    const w = Number(el?.getAttribute('width')) || 0; const h = Number(el?.getAttribute('height')) || 0;
    sizeBox = { w, h };
    stageEl.style.width = `${w}px`;
    columns = info.chords.map((c) => {
      const at = cursorOfElement(copy, c.id);
      const r = at ? view.entryCursorRect(at) : null;
      return r ? { x: r.x, w: Math.max(r.w, 3), y1: r.y1, y2: r.y2 } : { x: 0, w: 3, y1: 0, y2: 0 };
    });
    // the staff alone: the empty margins of the picture above and under it are cropped, so that the chips stand right above the notes and the words right under them
    const real = columns.filter((c) => c.y2 > 0);
    let top = real.length ? Math.min(...real.map((c) => c.y1)) : 0; let bottom = real.length ? Math.max(...real.map((c) => c.y2)) : h;
    // the ink of the picture (ledger lines, notes high above or low under the staff) is never cut: the crop takes in the real extent of what is drawn
    try { const ink = el.getBBox(); if (ink.height > 0) { top = Math.min(top, ink.y); bottom = Math.max(bottom, ink.y + ink.height); } } catch { /* no layout box (a test environment): the columns are enough */ }
    const crop = Math.max(0, top - 22);
    if (el) el.style.marginTop = `${-crop}px`;
    holder.style.overflow = 'hidden'; holder.style.height = `${bottom + 12 - crop}px`;
    sizeBox = { w, h: bottom + 12 - crop }; cropTop = crop;
    drawChips(); drawScope();
  };

  // « Put in order »: every waiting syllable goes on the note that follows the one before it, up to the next syllable already placed
  const autoBtn = mk(label('lyrics.adjust.auto'), 'adjust-auto', () => {
    assign = autoAssign(assign, info.chords.length, new Set(info.chords.map((c, i) => (c.cont ? i : -1)).filter((i) => i >= 0)), spans); error.textContent = '';
    selected = null; drawChips(); drawScope();
  });
  autoBtn.title = label('lyrics.adjust.autoTip');
  const okBtn = mk(label('lyrics.adjust.apply'), 'adjust-apply', () => {
    try { if (source) source.apply(assign, spans); else app.setLyricAssignment(staffId, current, assign); close(); } catch (e) { error.textContent = String(e?.message ?? e); }
  });
  const stepBtn = (text, delta, act) => { const b = mk(text, act, () => { current = Math.max(0, current + delta); load(); }); b.style.padding = '0 10px'; return b; };
  title.textContent = source?.title ?? label('lyrics.adjust.title');
  head.append(title, ...(source ? [] : [stepBtn('−', -1, 'adjust-verse-down'), verseLabel, stepBtn('+', 1, 'adjust-verse-up')]));
  row.append(autoBtn, mk(label('lyrics.cancel'), 'adjust-cancel', close), okBtn);
  box.append(head, hint, scopeBar, pool, spanBar, scroller, error, row);
  veil.append(box);
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  load();
  return { close };
}
