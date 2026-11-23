/*
 * Making the synchronisation by hand (screen 4): the recording plays, the person taps at the start of every measure — as the recording PLAYS the score, so with a repeat the
 * measures come 1, 2, 3, 4, 3, 4, 5 — and the instants become the time map. A window over the screen: the waveform with the taps drawn on it, a big « next measure » button
 * (also the space bar), the speed (half speed taps more exactly), the hand's delay, a list of the taps to correct by ±10 ms, and « Finish ». The maths are in `audio/synctap.js`.
 * A tap is an ANCHOR: the person may skip measures (the « next » measure moves with − / +) and tap only the start of the sections of a steady piece; the measures in between are spread.
 * The tap time is the position HEARD at the moment of the press (`player.mediaAtPerf` with the event's own time stamp), not the position of the last refresh of the player.
 */
import { createSwitch } from './switch.js';
import { mountCalibration } from './sync-tap-calibrate.js';
import { createChoiceMenu } from './choice-menu.js';
import { createAnchorClicker } from '../audio/anchorclick.js';
import { TIME_PRESETS } from './newscore-intents.js';
import { completeAnchors, anchorProblem, tempoCheck, playedAfter, nextSectionPlayed, tapsToMeasures, bpmOf, MIN_GAP } from '../audio/synctap.js';

const el = (tag, css = '', attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  if (css) n.style.cssText = css;
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); }
  n.append(...kids.flat().filter((c) => c != null && c !== false));
  return n;
};
const LATENCY_KEY = 'scorsaire.syncTapLatency';
const FREE_KEY = 'scorsaire.syncTapFree';
const CLICK_KEY = 'scorsaire.syncTapClick';
const DOUBLE_MS = 400; // a second press this soon after a tap marks the start of a SECTION on that measure (score made from the music)
const SECTION_PRESETS = ['intro', 'verse', 'preChorus', 'chorus', 'bridge', 'solo', 'interlude', 'outro', 'coda'];
const fmt = (s) => { const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };

/**
 * @param o.plan      { order, lengths, labels } from `tapPlan` (the played measures)
 * @param o.player    a loaded stem player (the recording)
 * @param o.onDone    ({ times, tapped, order, lengths, measures, bpm, duration }) the person finished (`times` = the start of every played measure)
 * @param o.onCancel  the person gave up
 * @param o.pickMeasure () → { promise (the WRITTEN bar index the person touched on the score, or null), cancel() }: « choose on the score » (offered only when the score is visible)
 * @param o.open       the score does not exist yet (made from the music): `plan` holds room for many measures, every tap is the next measure, the signature can change from any measure (`plan.timeSigs`,
 *                   `plan.lengths` follow), and the result stops at the last tapped measure with its `timeSigs`
 * @param o.mountMedia  (box) → Promise: puts the VIDEO in `box` (a YouTube recording: there is no waveform, the person watches while tapping); the window waits for it
 */
export function openSyncTap({ label, plan, player, onDone, onCancel, mountMedia = null, pickMeasure = null, open = false }) {
  const total = plan.order.length;
  let anchors = []; // [{ k, t }]: the k-th played measure starts at second t
  let nextK = 0; // the measure the next tap is for
  let latencyMs = 0; try { latencyMs = Math.max(-500, Math.min(500, Number(localStorage.getItem(LATENCY_KEY)) || 0)); } catch { /* none */ }
  let selected = -1; let closed = false; let picking = false;
  const sections = new Map(); // score made from the music: k (the measure) → { label: string | null (a name still to give), category }
  let lastTapStamp = null; // the time stamp of the last press that PLACED a measure (the second press of a double press marks a section)
  let free = true; if (!open) try { free = localStorage.getItem(FREE_KEY) !== '0'; } catch { /* none */ } // free entry: no measure number to choose, every tap is the next measure, the person stops when they want
  const sheet = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 900px)').matches;
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.4);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-sync-tap': '', 'data-zoom-lock': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(760px,98vw);max-height:${sheet ? '94vh' : '92vh'};overflow:auto;border-radius:${sheet ? '14px 14px 0 0' : '12px'};display:flex;flex-direction:column;gap:10px`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('syncTap.title') });
  veil.append(box);
  const btnCss = 'min-height:var(--ui-target,36px);min-width:var(--ui-target,36px);padding:0 10px;border-radius:8px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);border:1px solid var(--edge,#b9b4a8);background:var(--field,#fff);color:inherit;cursor:pointer';
  const mk = (text, act, fn, title = '') => { const b = el('button', btnCss, { type: 'button', 'data-act': act, title: title || null, 'aria-label': title || null }, text); b.addEventListener('click', fn); return b; };
  const row = (css = '') => el('div', `display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center;${css}`);

  const title = el('div', 'display:flex;justify-content:space-between;align-items:center', {}, el('strong', 'font-size:16px', {}, label('syncTap.title')), mk('✕', 'sync-tap-close', () => cancel(), label('syncTap.cancel')));
  const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)', {}, label('syncTap.hint'));
  const canvas = el('canvas', 'width:100%;height:96px;display:block;border:1px solid var(--edge,#b9b4a8);border-radius:8px;background:var(--field,#fff);touch-action:none;cursor:pointer', { 'data-sync-tap-wave': '' });
  const timeOut = el('output', 'font-variant-numeric:tabular-nums;min-width:9em;text-align:center', { 'data-sync-tap-time': '' });
  const playBtn = mk('▶', 'sync-tap-play', () => { if (player.state().playing) player.pause(); else player.play(); }, label('syncTap.play'));
  const rateBtns = [0.5, 0.75, 1].map((r) => mk(r === 1 ? '1×' : `${r}×`, `sync-tap-rate-${r}`, () => player.setRate(r), label('syncTap.speed')));
  const transport = row('gap:6px');
  transport.append(mk('⏮', 'sync-tap-start', () => player.seek(0), label('syncTap.toStart')), mk('−5 s', 'sync-tap-back', () => player.seek(player.state().position - 5)), playBtn, mk('+5 s', 'sync-tap-fwd', () => player.seek(player.state().position + 5)), timeOut, el('span', 'flex:1'), el('span', 'font-size:12px', {}, label('syncTap.speed')), ...rateBtns);

  const nextText = el('div', 'font:var(--w-bold,700) 20px var(--ui-font,sans-serif)');
  const nextSub = el('div', 'font-size:12px;opacity:.8');
  const tapBtn = el('button', 'min-height:84px;width:100%;border-radius:12px;border:2px solid var(--sel-edge,#2d78ff);background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;touch-action:manipulation', { type: 'button', 'data-act': 'sync-tap-tap' }, nextText, nextSub);
  // sections marked while tapping (a score made from the music): a double press of the tap button, or this button, marks the measure just tapped; the names are given in the list below
  const sectionBtn2 = mk(`◆ ${label('syncTap.markSection')}`, 'sync-tap-mark-section', () => markSection(), label('syncTap.markSectionHint'));
  const sectionRow = row('gap:6px;justify-content:center');
  sectionRow.append(sectionBtn2, el('span', 'font-size:12px;color:var(--ink-soft,#555)', {}, label('syncTap.sectionHelp')));
  const skipLess = mk('−', 'sync-tap-skip-less', () => { nextK = Math.max(lastK() + 1, nextK - 1); refresh(); }, label('syncTap.skipLess'));
  const skipMore = mk('+', 'sync-tap-skip-more', () => { nextK = Math.min(total - 1, nextK + 1); refresh(); }, label('syncTap.skipMore'));
  const skipMore4 = mk('+4', 'sync-tap-skip-more4', () => { nextK = Math.min(total - 1, nextK + 4); refresh(); }, label('syncTap.skipMore'));
  const writtenCount = Math.max(...plan.order) + 1;
  const numberField = el('input', 'width:4.5em;min-height:var(--ui-target,36px);box-sizing:border-box;padding:0 6px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:15px var(--ui-font,sans-serif);text-align:center', { type: 'number', min: 1, max: writtenCount, step: 1, 'data-sync-tap-number': '', 'aria-label': label('syncTap.skip') });
  numberField.addEventListener('keydown', (e) => e.stopPropagation()); // typing a number is not tapping
  numberField.addEventListener('change', () => goToWritten(Number(numberField.value) - 1));
  const lastBtn = mk(label('syncTap.lastMeasure'), 'sync-tap-last', () => { if (total - 1 > lastK()) { nextK = total - 1; refresh(); } }, label('syncTap.lastMeasureHint'));
  const sectionBtn = mk(label('syncTap.nextSection'), 'sync-tap-section', () => { const k = nextSectionPlayed(plan, Math.max(nextK, lastK())); if (k >= 0) { nextK = k; refresh(); } }, label('syncTap.nextSectionHint'));
  const pickBtn = pickMeasure ? mk(label('syncTap.pickOnScore'), 'sync-tap-pick', () => startPick(), label('syncTap.pickOnScoreHint')) : null;
  const skipRow = row('gap:6px;justify-content:center');
  skipRow.append(el('span', 'font-size:12px', {}, label('syncTap.skip')), skipLess, numberField, skipMore, skipMore4, lastBtn, sectionBtn, ...(pickBtn ? [pickBtn] : []));
  const freeSwitch = createSwitch({ checked: free, text: label('syncTap.free'), attrs: { 'data-sync-tap-free': '', title: label('syncTap.freeHint') }, onchange: () => { free = freeSwitch.checked; try { localStorage.setItem(FREE_KEY, free ? '1' : '0'); } catch { /* none */ } refresh(); } });
  freeSwitch.style.cssText = btnCss;
  // a click on every measure already placed: while the recording plays again, it sounds at the instant of each one, so the ear tells whether the taps are on the beat (it can be switched off)
  let clickOn = true; try { clickOn = localStorage.getItem(CLICK_KEY) !== '0'; } catch { /* none */ }
  let clickCtx = null;
  const clicker = createAnchorClicker({
    player, times: () => anchors.map((a) => a.t), enabled: () => clickOn,
    getCtx: () => { if (!clickCtx) { const C = globalThis.AudioContext ?? globalThis.webkitAudioContext; clickCtx = new C(); } if (clickCtx.state === 'suspended') clickCtx.resume?.(); return clickCtx; },
  });
  const clickSwitch = createSwitch({ checked: clickOn, text: label('syncTap.click'), attrs: { 'data-sync-tap-click': '', title: label('syncTap.clickHint') }, onchange: () => { clickOn = clickSwitch.checked; try { localStorage.setItem(CLICK_KEY, clickOn ? '1' : '0'); } catch { /* none */ } } });
  clickSwitch.style.cssText = btnCss;
  const clickRow = row('gap:6px;justify-content:center'); clickRow.append(clickSwitch);
  const freeRow = row('gap:6px;justify-content:center');
  freeRow.append(freeSwitch, el('span', 'font-size:12px;color:var(--ink-soft,#555)', { 'data-sync-tap-freehint': '' }));
  // a score made from the music: the signature changes from a measure (the number field starts at the next one)
  const sigRow = row('gap:6px;justify-content:center'); let sigFrom = null; let sigText = plan.timeSigs?.[0]?.join('/') ?? ''; // sigFrom: null = the measure being tapped (`plan.timeSigs` only exists for a score made from the music: a plan of an existing score has none)
  const sigField = el('input', 'width:4.5em;min-height:var(--ui-target,36px);box-sizing:border-box;padding:0 6px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:15px var(--ui-font,sans-serif);text-align:center', { type: 'number', min: 1, step: 1, 'data-sync-tap-sigfrom': '', 'aria-label': label('syncTap.sigFrom') });
  sigField.addEventListener('keydown', (e) => e.stopPropagation());
  sigField.addEventListener('change', () => { sigFrom = Math.min(plan.timeSigs.length, Math.max(1, Math.round(Number(sigField.value) || 1))); });
  const sigSummary = el('div', 'font-size:12px;color:var(--ink-soft,#555);text-align:center', { 'data-sync-tap-sigsummary': '' });
  if (open) {
    const apply = (text) => {
      const [n, d] = text.split('/').map(Number);
      const from = (sigFrom ?? Math.min(plan.timeSigs.length, nextK + 1)) - 1;
      for (let k = from; k < plan.timeSigs.length; k += 1) { plan.timeSigs[k] = [n, d]; plan.lengths[k] = n / d; }
      sigText = text; sigFrom = null; refresh();
    };
    const choices = TIME_PRESETS.filter((t) => t[2] === 'normal').map((t) => [`${t[0]}/${t[1]}`, `${t[0]}/${t[1]}`]);
    sigRow.append(el('span', 'font-size:12px', {}, label('syncTap.sig')), createChoiceMenu({ options: choices, value: sigText, label: label('syncTap.sig'), act: 'sync-tap-sig', onPick: (v) => apply(v) }), el('span', 'font-size:12px', {}, label('syncTap.sigFrom')), sigField);
  }
  const warn = el('div', 'min-height:1.2em;font-size:12px;color:var(--warn-ink,#9a5b00)', { role: 'status', 'data-sync-tap-warn': '' });
  const message = el('div', 'min-height:1.3em;font-size:12px;color:var(--ink-soft,#555)', { role: 'status' });
  const latOut = el('output', 'min-width:4.5em;text-align:center;font-variant-numeric:tabular-nums', { 'data-sync-tap-latency': '' });
  const setLatency = (v) => { latencyMs = Math.max(-500, Math.min(500, Math.round(v))); try { localStorage.setItem(LATENCY_KEY, String(latencyMs)); } catch { /* none */ } refresh(); };
  const tools = row('gap:6px');
  tools.append(
    mk('⌫', 'sync-tap-undo', () => undo(), label('syncTap.undo')),
    mk(label('syncTap.eraseFrom'), 'sync-tap-erase', () => { const p = player.state().position; anchors = anchors.filter((a) => a.t < p - 0.01); nextK = lastK() + 1; selected = -1; for (const k of [...sections.keys()]) if (k > lastK()) sections.delete(k); refresh(); }),
    mk(label('syncTap.calib'), 'sync-tap-calibrate', () => toggleCalibration(), label('syncTap.calibHint')),
    el('span', 'flex:1'), el('span', 'font-size:12px', {}, label('syncTap.delay')),
    mk('−', 'sync-tap-lat-less', () => setLatency(latencyMs - 10), label('syncTap.delayLess')), latOut, mk('+', 'sync-tap-lat-more', () => setLatency(latencyMs + 10), label('syncTap.delayMore')));
  /** Every tap moves by `ms` and the hand's delay with it: what the calibration finds applies to the taps already made and to the next ones. */
  const shiftAll = (ms) => { anchors = anchors.map((a) => ({ ...a, t: Math.max(0, a.t + ms / 1000) })); setLatency(latencyMs + ms); };
  let calibration = null;
  const calibBox = el('div', 'display:none', { 'data-sync-tap-calib-box': '' });
  function toggleCalibration() {
    if (calibration) { calibration.dispose(); calibration = null; calibBox.replaceChildren(); calibBox.style.display = 'none'; return; }
    calibration = mountCalibration({ label, player, getAnchors: () => anchors, setLatency, shiftAll, mk, el, row });
    calibBox.replaceChildren(calibration.node); calibBox.style.display = '';
  }
  const list = el('div', 'display:flex;flex-direction:column;gap:2px;max-height:200px;overflow:auto;border:1px solid var(--edge,#b9b4a8);border-radius:8px;padding:4px', { 'data-sync-tap-list': '' });
  const finish = mk(label('syncTap.finish'), 'sync-tap-finish', () => done(), '');
  finish.style.fontWeight = '700';
  const footer = row('justify-content:flex-end');
  footer.append(mk(label('syncTap.cancel'), 'sync-tap-cancel', () => cancel()), finish);
  const mediaBox = mountMedia ? el('div', 'position:relative;width:min(100%,420px);aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;align-self:center', { 'data-sync-tap-media': '' }) : null;
  box.append(title, hint, ...(mediaBox ? [mediaBox] : []), canvas, transport, tapBtn, ...(open ? [sectionRow] : []), clickRow, ...(open ? [sigRow, sigSummary] : [freeRow]), skipRow, warn, message, tools, calibBox, list, footer);
  document.body.append(veil);

  const labelOf = (k) => { const l = plan.labels[k]; return l.passes > 1 ? label('syncTap.measurePass', { n: l.measure + 1, pass: l.pass + 1 }) : label('syncTap.measure', { n: l.measure + 1 }); };

  function drawWave() {
    const w = canvas.clientWidth; const h = canvas.clientHeight; if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const st = player.state(); const D = Math.max(0.001, st.duration); const X = (t) => (t / D) * w;
    const peaks = player.peaks?.() ?? null; // (a video has no waveform: only the taps and the playhead are drawn)
    if (peaks) { g.fillStyle = '#9aa3b2'; const mid = h / 2; for (let i = 0; i < peaks.length; i += 1) { const a = peaks[i] * (h - 8) / 2; g.fillRect((i / peaks.length) * w, mid - a, Math.max(1, w / peaks.length), Math.max(1, 2 * a)); } }
    anchors.forEach((a, i) => { if (sections.has(a.k)) { g.fillStyle = '#2e7d32'; g.fillRect(X(a.t) - 1, 0, 3, h); g.fillText('◆', X(a.t) + 3, 10); } g.strokeStyle = i === selected ? '#c62828' : 'rgba(180,90,20,.85)'; g.lineWidth = i === selected ? 2 : 1; g.beginPath(); g.moveTo(X(a.t) + 0.5, 0); g.lineTo(X(a.t) + 0.5, h); g.stroke(); if (w / total > 14 || i % 4 === 0) { g.fillStyle = '#7a3b00'; g.font = '10px sans-serif'; g.fillText(String(plan.labels[a.k].measure + 1), X(a.t) + 3, 11); } });
    g.fillStyle = '#e0561b'; g.fillRect(X(st.position) - 1, 0, 2, h);
  }
  const lastK = () => (anchors.length ? anchors[anchors.length - 1].k : -1);
  const sectionRank = (k) => [...sections.keys()].filter((x) => x <= k).length; // « Section 2 » = the second one marked, in measure order
  const sectionName = (k) => sections.get(k)?.label ?? label('syncTap.sectionDefault', { n: sectionRank(k) });
  /** Marks the measure just tapped as the start of a section (marking it again takes the mark off). */
  function markSection() {
    if (!open || !anchors.length) return;
    const k = lastK();
    if (sections.has(k)) { sections.delete(k); message.textContent = label('syncTap.sectionRemoved', { m: k + 1 }); }
    else { sections.set(k, { label: null, category: 'custom' }); message.textContent = label('syncTap.sectionMarked', { name: sectionName(k), m: k + 1 }); }
    lastTapStamp = null; refresh();
  }
  const undo = () => { const gone = anchors.pop(); if (gone) { nextK = gone.k; sections.delete(gone.k); } selected = -1; refresh(); };
  /** One anchor moved by `delta` seconds, never past its neighbours. */
  const move = (i, delta) => {
    const lo = i > 0 ? anchors[i - 1].t + MIN_GAP : 0; const hi = i + 1 < anchors.length ? anchors[i + 1].t - MIN_GAP : Infinity;
    anchors[i] = { ...anchors[i], t: Math.min(hi, Math.max(lo, anchors[i].t + delta)) };
  };
  function drawList() {
    list.replaceChildren(...anchors.map((a, i) => {
      const r = row('gap:4px;padding:2px 4px;border-radius:6px;' + (i === selected ? 'background:var(--accent-soft,#d6e6ff)' : ''));
      r.setAttribute('data-sync-tap-row', String(i));
      const sec = sections.get(a.k);
      const secBits = !sec ? [] : [
        (() => { const m = createChoiceMenu({
          options: [...SECTION_PRESETS.map((c) => [`p:${c}`, label(`section.${c}`)]), ...['A', 'B', 'C', 'D', 'E', 'F'].map((x) => [`l:${x}`, x]), { action: 'remove', text: label('syncTap.sectionRemove'), run: () => { sections.delete(a.k); refresh(); } }],
          value: '', label: `◆ ${sectionName(a.k)}`, act: `sync-tap-section-${i}`,
          onPick: (v) => { const [kind, x] = String(v).split(':'); sections.set(a.k, kind === 'l' ? { label: x, category: 'letter' } : { label: label(`section.${x}`), category: x }); refresh(); },
        }); if (m.firstChild) m.firstChild.textContent = '◆'; m.title = sectionName(a.k); return m; })(),
        (() => { const f = el('input', 'width:8em;min-height:var(--ui-target,36px);box-sizing:border-box;padding:0 6px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:14px var(--ui-font,sans-serif)', { type: 'text', maxlength: '40', 'data-sync-tap-section-name': String(i), 'aria-label': label('syncTap.sectionName'), placeholder: sectionName(a.k) }); f.value = sec.label ?? ''; f.addEventListener('keydown', (e) => e.stopPropagation()); f.addEventListener('change', () => { sections.set(a.k, { label: f.value.trim() || null, category: f.value.trim() ? 'custom' : 'custom' }); refresh(); }); return f; })(),
      ];
      r.append(el('span', 'min-width:9em;font-weight:600', {}, labelOf(a.k)), el('span', 'font-variant-numeric:tabular-nums;min-width:5.5em', {}, fmt(a.t)), ...secBits,
        mk('−10 ms', `sync-tap-n-less-${i}`, () => { move(i, -0.01); selected = i; refresh(); }), mk('+10 ms', `sync-tap-n-more-${i}`, () => { move(i, 0.01); selected = i; refresh(); }),
        mk('▶', `sync-tap-listen-${i}`, () => { selected = i; player.seek(Math.max(0, a.t - 1)); player.play(); refresh(); }, label('syncTap.listen')));
      return r;
    }));
    list.style.display = anchors.length ? '' : 'none';
    if (selected >= 0) list.children[selected]?.scrollIntoView?.({ block: 'nearest' });
  }
  function refresh() {
    const st = player.state();
    timeOut.textContent = `${fmt(st.position)} / ${fmt(st.duration)}`;
    playBtn.textContent = st.playing ? '⏸' : '▶';
    latOut.textContent = `${latencyMs > 0 ? '+' : ''}${latencyMs} ms`;
    nextK = Math.max(nextK, lastK() + 1);
    const more = lastK() < total - 1; // measures still to tap (`open`, the parameter, is the score made from the music)
    if (more) { nextText.textContent = `${label('syncTap.tap')} · ${labelOf(nextK)}`; nextSub.textContent = more ? label('syncTap.progressOpen', { done: anchors.length }) : free ? label('syncTap.progressFree', { done: anchors.length }) : label('syncTap.progress', { done: anchors.length, total }); tapBtn.disabled = false; tapBtn.style.opacity = ''; }
    else { nextText.textContent = label(anchors.length < total ? 'syncTap.lastPlaced' : 'syncTap.allDone'); nextSub.textContent = label('syncTap.progress', { done: anchors.length, total }); tapBtn.disabled = true; tapBtn.style.opacity = '.6'; }
    skipRow.style.display = free ? 'none' : '';
    freeRow.lastChild.textContent = free ? label('syncTap.freeOn') : '';
    skipLess.disabled = !more || nextK <= lastK() + 1; skipMore.disabled = skipMore4.disabled = !more || nextK >= total - 1;
    numberField.value = String(plan.order[Math.min(nextK, total - 1)] + 1); numberField.disabled = !more;
    lastBtn.disabled = !more || total - 1 <= lastK(); sectionBtn.disabled = !more || nextSectionPlayed(plan, Math.max(nextK, lastK())) < 0;
    finish.disabled = anchorProblem(anchors, plan.lengths, plan.pace) !== null && !(total === 1 && anchors.length === 1); finish.style.opacity = finish.disabled ? '.5' : '';
    // the pace of the anchors against the tempo of the score: far from it is usually half or double time, or a measure counted twice
    const check = tempoCheck(anchors, plan.lengths, plan.bpm);
    warn.textContent = check?.warn ? label('syncTap.tempoWarn', { bpm: check.bpm, score: plan.bpm }) : '';
    if (open) {
      if (document.activeElement !== sigField) sigField.value = String(sigFrom ?? Math.min(plan.timeSigs.length, nextK + 1));
      sigSummary.textContent = sigRuns().map((r) => label('syncTap.sigRun', { sig: r.sig, from: r.from })).join(' · ');
    }
    drawList(); drawWave();
  }
  /** The signature changes over the measures made so far and the next one: [{ sig, from }] (measure numbers from 1). */
  function sigRuns() {
    const upTo = Math.min(plan.timeSigs.length, Math.max(1, nextK + 1)); const runs = [];
    for (let k = 0; k < upTo; k += 1) { const sig = plan.timeSigs[k].join('/'); if (!runs.length || runs[runs.length - 1].sig !== sig) runs.push({ sig, from: k + 1 }); }
    return runs;
  }

  /** The next tap is for the written bar `w` (its first pass after the last anchor). */
  function goToWritten(w) {
    if (!(w >= 0 && w < writtenCount)) { refresh(); return; }
    const k = playedAfter(plan.order, w, lastK());
    if (k < 0) { message.textContent = label('syncTap.notPlayedAfter', { n: w + 1 }); refresh(); return; }
    message.textContent = ''; nextK = k; refresh();
  }
  /** « Choose on the score »: the window folds into a small bar, the person touches a measure of the score, the window comes back with the next tap set on it. */
  const pickBar = el('div', 'display:none;position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:3600;background:var(--paper,#faf8f4);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff);border-radius:12px;padding:8px 12px;box-shadow:0 4px 20px rgba(0,0,0,.4);font:14px var(--ui-font,sans-serif);align-items:center;gap:10px', { 'data-sync-tap-pickbar': '', 'data-zoom-lock': '' });
  document.body.append(pickBar);
  function startPick() {
    if (!pickMeasure || picking) return;
    const pick = pickMeasure(); if (!pick) { message.textContent = label('syncTap.pickUnavailable'); return; }
    picking = true; veil.style.display = 'none';
    const back = (w) => { if (!picking) return; picking = false; pickBar.style.display = 'none'; pickBar.replaceChildren(); veil.style.display = 'flex'; if (w != null && w >= 0) goToWritten(w); else refresh(); };
    pickBar.replaceChildren(el('span', '', {}, label('syncTap.pickHint')), mk(label('syncTap.cancel'), 'sync-tap-pick-cancel', () => { pick.cancel?.(); back(null); }));
    pickBar.style.display = 'flex';
    pick.promise.then((w) => back(w));
  }
  /** A tap at the event's time: the position HEARD then, moved by the hand's delay. */
  function tap(stamp) {
    if (calibration?.consume(stamp)) return; // a press of the hand's calibration is not a tap
    if (open && lastTapStamp !== null && stamp - lastTapStamp < DOUBLE_MS && anchors.length) { markSection(); return; } // a double press: the measure just tapped begins a section
    if (picking || lastK() >= total - 1) return;
    // the position HEARD at the moment of the press: exact for a recording; for a video the position of its player (extrapolated between two readings), taken back by the time the press waited
    const st = player.state();
    const heard = player.mediaAtPerf ? player.mediaAtPerf(stamp) : (st.playing && !st.buffering ? st.position - ((performance.now() - stamp) / 1000) * st.rate : null);
    if (heard == null) { message.textContent = label('syncTap.needPlay'); return; }
    message.textContent = '';
    const t = Math.max(0, heard + latencyMs / 1000);
    if (anchors.length && t <= anchors[anchors.length - 1].t + MIN_GAP) return; // a double press
    anchors.push({ k: nextK, t }); selected = anchors.length - 1; nextK += 1; lastTapStamp = stamp; refresh();
  }
  tapBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(e.timeStamp); });
  tapBtn.addEventListener('keydown', (e) => e.stopPropagation());
  const onKey = (e) => {
    if (closed || picking) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) tap(e.timeStamp); return; }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); e.stopPropagation(); playBtn.click(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); undo(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); player.seek(player.state().position - 2); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); player.seek(player.state().position + 2); }
  };
  window.addEventListener('keydown', onKey, true);
  clicker.start();
  const onCanvas = (e) => { const r = canvas.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width * player.state().duration); };
  canvas.addEventListener('pointerdown', onCanvas);
  const off = player.subscribe(() => { if (!closed) { timeOut.textContent = `${fmt(player.state().position)} / ${fmt(player.state().duration)}`; playBtn.textContent = player.state().playing ? '⏸' : '▶'; drawWave(); } });

  function close() { if (closed) return; closed = true; clicker.stop(); try { clickCtx?.close?.(); } catch { /* already closed */ } clickCtx = null; calibration?.dispose(); pickBar.remove(); window.removeEventListener('keydown', onKey, true); off(); try { player.pause(); } catch { /* a video that is not loaded */ } veil.remove(); }
  function cancel() { close(); onCancel?.(); }
  function done() {
    const full = completeAnchors(anchors, plan.lengths, plan.pace);
    if (!full) { const why = anchorProblem(anchors, plan.lengths, plan.pace); message.textContent = label(why === 'before' ? 'syncTap.needBefore' : why === 'order' ? 'syncTap.badOrder' : 'syncTap.needTwo'); return; }
    const duration = player.state().duration;
    const n = open ? lastK() + 1 : full.times.length; // made from the music: the last tap begins the last measure
    const times = full.times.slice(0, n); const lengths = plan.lengths.slice(0, n); const order = plan.order.slice(0, n);
    const measures = tapsToMeasures(times, lengths, duration);
    const result = { times, tapped: full.tapped, order, lengths, measures, bpm: bpmOf(times, lengths), duration, ...(open ? { timeSigs: plan.timeSigs.slice(0, n).map((x) => [...x]), sections: [...sections.entries()].filter(([k]) => k < n).sort((a, b) => a[0] - b[0]).map(([k, s], i) => ({ measure: k, label: s.label ?? label('syncTap.sectionDefault', { n: i + 1 }), category: s.category })) } : {}) };
    close(); onDone(result);
  }
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) { /* the window is not closed by a stray press: taps must never be lost */ } });
  if (mediaBox) { message.textContent = label('syncTap.videoLoading'); Promise.resolve(mountMedia(mediaBox)).then(() => { if (!closed) { message.textContent = ''; player.setRate?.(1); refresh(); } }).catch(() => { if (!closed) message.textContent = label('video.blocked'); }); }
  else { player.seek(0); player.setRate(1); }
  refresh();
  return { close, taps: () => anchors.map((a) => ({ ...a })), tap: (stamp = performance.now()) => tap(stamp) };
}
