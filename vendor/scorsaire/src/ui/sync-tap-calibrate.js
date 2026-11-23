/*
 * Calibration of the tapping window (screen 4): three small tools that set the hand's delay.
 *  - the hand: the editor plays a regular click (Web Audio, no recording), the person taps along; the median gap is the hand's delay (kept from one piece to the next);
 *  - the first measures: the recording plays from a second before the first tap with a click at every tap; the person nudges by ±10 ms until click and music agree (all the taps move);
 *  - the sound (a recording only): the nearest clear attack of the sound to each tap gives the correction by itself.
 * The maths are in `audio/synctap.js`; this file only builds the panel and the clicks.
 */
import { handDelayFromTaps, attackCorrection, clickTimes } from '../audio/synctap.js';
import { playClick } from '../audio/anchorclick.js';

const CLICKS = 12; const CLICK_BPM = 100; const LEAD = 1.5; // seconds before the first click

/** The `performance.now()` instant (ms) at which the context time `c` is heard. */
function perfOf(ctx, c) {
  const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
  if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.performanceTime + (c - ts.contextTime) * 1000;
  return performance.now() + (c - ctx.currentTime + (ctx.outputLatency ?? ctx.baseLatency ?? 0)) * 1000;
}
const signed = (ms) => `${ms > 0 ? '+' : ''}${ms}`;

/**
 * @param o.label        i18n lookup
 * @param o.player       the stem player (or the YouTube adapter): `state()`, `seek`, `play`, `pause`, optional `attackNear`
 * @param o.getAnchors   () → [{ k, t }]
 * @param o.setLatency   (ms) the hand's delay is now this
 * @param o.shiftAll     (ms) every tap moves by this much, and the delay with it
 * @param o.mk, o.el, o.row  the window's own builders
 * @returns { node, consume(stamp) (true when the press belongs to the calibration), dispose() }
 */
export function mountCalibration({ label, player, getAnchors, setLatency, shiftAll, mk, el, row }) {
  let ctx = null; let run = null; let verifyTimer = null; let verifyShift = 0;
  const getCtx = () => { if (!ctx) { const C = globalThis.AudioContext ?? globalThis.webkitAudioContext; ctx = new C(); } if (ctx.state === 'suspended') ctx.resume?.(); return ctx; };
  const soft = 'font-size:12px;color:var(--ink-soft,#555)';
  const status = () => el('div', `${soft};min-height:1.3em`, { role: 'status' });
  const section = (title, help, ...kids) => el('div', 'display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--edge,#b9b4a8);border-radius:8px', {}, el('strong', '', {}, title), el('div', soft, {}, help), ...kids);

  // 1 — the hand
  const handOut = status();
  const handApply = mk(label('syncTap.calibApply'), 'sync-tap-cal-hand-apply', () => { if (handResult) { setLatency(handResult.correctionMs); handOut.textContent = label('syncTap.calibApplied', { ms: signed(handResult.correctionMs) }); handApply.style.display = 'none'; } });
  handApply.style.display = 'none';
  let handResult = null;
  const handStart = mk(label('syncTap.calibStart'), 'sync-tap-cal-hand-start', () => startHand());
  function startHand() {
    stopAll(); handResult = null; handApply.style.display = 'none';
    const c = getCtx(); const first = c.currentTime + LEAD;
    const times = clickTimes(first, CLICK_BPM, CLICKS);
    times.forEach((t, i) => playClick(c, t, i % 4 === 0));
    run = { clicks: times.map((t) => perfOf(c, t) / 1000), taps: [], end: perfOf(c, times[times.length - 1]) + 600 };
    handOut.textContent = label('syncTap.calibTapNow', { n: 0, total: CLICKS });
    run.timer = setTimeout(finishHand, run.end - performance.now());
  }
  function finishHand() {
    if (!run) return;
    const r = handDelayFromTaps(run.taps, run.clicks); run = null;
    if (!r) { handOut.textContent = label('syncTap.calibTooFew'); return; }
    handResult = r;
    handOut.textContent = label('syncTap.calibHandResult', { delay: signed(r.delayMs), spread: r.spreadMs, n: r.n });
    handApply.style.display = '';
  }

  // 2 — the first measures
  const verOut = status();
  const verShiftOut = el('output', 'min-width:5em;text-align:center;font-variant-numeric:tabular-nums');
  const verPlay = mk(label('syncTap.calibVerifyPlay'), 'sync-tap-cal-verify-play', () => startVerify());
  const showShift = () => { verShiftOut.textContent = `${signed(verifyShift)} ms`; };
  const nudgeBy = (d) => { verifyShift += d; shiftAll(d); showShift(); startVerify(); };
  function startVerify() {
    stopAll();
    const a = getAnchors();
    if (a.length < 2) { verOut.textContent = label('syncTap.calibVerifyNeed'); return; }
    const c = getCtx();
    const marks = a.slice(0, 3).map((x) => x.t); const pending = new Set(marks.map((_, i) => i));
    verOut.textContent = label('syncTap.calibVerifyOn');
    player.seek(Math.max(0, marks[0] - 1)); player.play();
    verifyTimer = setInterval(() => {
      const st = player.state(); if (!st.playing) return;
      const rate = st.rate || 1;
      for (const i of [...pending]) {
        const d = (marks[i] - st.position) / rate;
        if (d < -0.05) pending.delete(i); // already past
        else if (d < 0.3) { playClick(c, c.currentTime + Math.max(0, d), i === 0); pending.delete(i); }
      }
      if (!pending.size) { clearInterval(verifyTimer); verifyTimer = null; }
    }, 30);
  }

  // 3 — the sound
  const audOut = status(); let audResult = null;
  const audApply = mk(label('syncTap.calibApply'), 'sync-tap-cal-audio-apply', () => { if (audResult) { shiftAll(audResult.correctionMs); audOut.textContent = label('syncTap.calibApplied', { ms: signed(audResult.correctionMs) }); audApply.style.display = 'none'; audResult = null; } });
  audApply.style.display = 'none';
  const audRun = mk(label('syncTap.calibAudioRun'), 'sync-tap-cal-audio-run', () => {
    audResult = attackCorrection(getAnchors(), player.attackNear);
    if (!audResult) { audOut.textContent = label('syncTap.calibAudioNone'); audApply.style.display = 'none'; return; }
    audOut.textContent = label('syncTap.calibAudioResult', { ms: signed(audResult.correctionMs), spread: audResult.spreadMs, n: audResult.n });
    audApply.style.display = '';
  });

  const node = el('div', 'display:flex;flex-direction:column;gap:8px', { 'data-sync-tap-calibration': '' });
  node.append(
    section(label('syncTap.calibHand'), label('syncTap.calibHandHelp'), row('gap:6px'), handOut),
    section(label('syncTap.calibVerify'), label('syncTap.calibVerifyHelp'), row('gap:6px'), verOut),
    ...(typeof player.attackNear === 'function' ? [section(label('syncTap.calibAudio'), label('syncTap.calibAudioHelp'), row('gap:6px'), audOut)] : []));
  const fill = (r, ...kids) => { r.append(...kids); };
  const buttonRows = [...node.children].map((s) => s.children[2]);
  fill(buttonRows[0], handStart, handApply);
  fill(buttonRows[1], verPlay, mk('−10 ms', 'sync-tap-cal-verify-less', () => nudgeBy(-10), label('syncTap.calibEarlier')), verShiftOut, mk('+10 ms', 'sync-tap-cal-verify-more', () => nudgeBy(10), label('syncTap.calibLater')));
  if (buttonRows[2]) fill(buttonRows[2], audRun, audApply);
  showShift();

  function stopAll() { if (run) { clearTimeout(run.timer); run = null; } if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; } }
  return {
    node,
    consume(stamp) {
      if (!run) return false;
      run.taps.push(stamp / 1000);
      handOut.textContent = label('syncTap.calibTapNow', { n: run.taps.length, total: CLICKS });
      return true;
    },
    dispose() { stopAll(); try { ctx?.close?.(); } catch { /* already closed */ } ctx = null; },
  };
}
