/*
 * The "Organ glissando" window (model/glissandorun.js, applied by `app.addGlissandoRun`): a white-key run written before the selected arrival note.
 * Fields: start pitch (stepper in semitones / octaves, shows the note name), how the run is timed (the length of the WHOLE run, or the speed of each note)
 * and its note value. A live line counts the notes and the total length BEFORE anything is written. Apply = ONE undo step; Remove when a run exists.
 * Warns rather than forbids (a black-key start is moved to the next white key); only "no white key to play" disables Apply, since there is nothing to write.
 */
import { createSwitch } from './switch.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

export const DURATION_CHOICES = Object.freeze([[1, 32], [1, 16], [1, 8], [1, 4], [1, 2]]);
export const SPEED_CHOICES = Object.freeze([[1, 64], [1, 32], [1, 16]]);
export const DEFAULT_VALUE = Object.freeze({ duration: [1, 8], speed: [1, 32] });

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Note name of a MIDI pitch (60 = C4). */
export const runPitchName = (midi) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** "1/8", "3/32", "2" for a fraction [n, d] of a whole note. */
export function fractionText([n, d]) { const g = gcd(n, d) || 1; const a = n / g; const b = d / g; return b === 1 ? String(a) : `${a}/${b}`; }
/** The note values offered for a mode: the standard ones, plus the current value when it is another (an existing run). */
export function valueChoices(mode, current) {
  const base = mode === 'speed' ? SPEED_CHOICES : DURATION_CHOICES;
  return current && !base.some((c) => same(c, current)) ? [...base, current].sort((a, b) => a[0] / a[1] - b[0] / b[1]) : [...base];
}

export function openGlissandoRunDialog({ app, label, ids = null, viewId = 'main', onDone = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const base = app.glissandoRunInfo(ids, {}, viewId);
  if (!base.allowed) return null;
  let startPitch = base.startPitch;
  let mode = base.existing?.mode ?? 'duration';
  let value = base.existing?.value ?? DEFAULT_VALUE[mode];
  let message = '';
  const remembered = {}; // the value last chosen in each mode, kept when the person switches back and forth
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-glissando-run-dialog': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(520px,100%);max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:10px;${sheet ? 'border-radius:14px 14px 0 0' : 'border-radius:10px'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('glissandoRun.title') });
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { primary = false, on = false, disabled = false, stepper = false } = {}) => {
    const b = el('button', `min-height:var(--ui-target,44px);min-width:var(--ui-target,44px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);${primary || on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}${disabled ? ';opacity:.45' : ''}`, { type: 'button', 'data-act': act });
    if (stepper) b.classList.add('stp-b');
    b.textContent = text; b.disabled = disabled; b.addEventListener('click', fn); if (on) b.setAttribute('aria-pressed', 'true'); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center');
  const caption = (text) => { const c = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); c.textContent = text; return c; };
  const setPitch = (p) => { startPitch = Math.max(0, Math.min(127, p)); draw(); };

  function draw() {
    const focusedAct = box.contains(document.activeElement) ? document.activeElement.getAttribute?.('data-act') : null;
    const live = app.glissandoRunInfo(ids, { startPitch }, viewId);
    const timing = timingOf(live.whiteKeyCount);
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('glissandoRun.title');
    const hint = caption(label('glissandoRun.hint', { note: runPitchName(live.arrivalPitch) }));

    const pitchRow = row();
    const nameEl = el('span', 'min-width:3.6em;text-align:center;font:var(--w-bold,700) 16px var(--ui-font,sans-serif)', { 'data-glissando-run-pitch': '' }); nameEl.textContent = runPitchName(startPitch);
    pitchRow.append(mk('−12', 'glissando-run-octave-down', () => setPitch(startPitch - 12), { stepper: true }), mk('−', 'glissando-run-less', () => setPitch(startPitch - 1), { stepper: true }),
      nameEl, mk('+', 'glissando-run-more', () => setPitch(startPitch + 1), { stepper: true }), mk('+12', 'glissando-run-octave-up', () => setPitch(startPitch + 12), { stepper: true }));
    const warn = [];
    if (live.whiteKeyCount && live.usedStartPitch !== startPitch) warn.push(label('glissandoRun.blackKey', { from: runPitchName(startPitch), to: runPitchName(live.usedStartPitch) }));
    if (!live.whiteKeyCount) warn.push(label('glissandoRun.noSteps'));

    const modes = row();
    const sw = (m) => { const b = createSwitch({ checked: mode === m, text: label(`glissandoRun.mode.${m}`), attrs: { 'data-act': `glissando-run-mode-${m}` } }); b.style.cssText = 'min-height:var(--ui-target,44px);padding:0 12px'; b.addEventListener('click', (e) => { e.preventDefault(); if (mode !== m) { remembered[mode] = value; mode = m; value = remembered[m] ?? DEFAULT_VALUE[m]; } draw(); }); return b; };
    modes.append(sw('duration'), sw('speed'));
    const values = row();
    for (const c of valueChoices(mode, value)) values.append(mk(fractionText(c), `glissando-run-value-${c[0]}-${c[1]}`, () => { value = [...c]; draw(); }, { on: same(c, value) }));

    const status = el('div', `font-size:13px;padding:6px;border-radius:6px;${warn.length ? 'background:var(--warn-soft,#ffe9b8)' : ''}`, { role: 'status', 'data-glissando-run-status': live.whiteKeyCount ? 'ok' : 'none' });
    status.textContent = [live.whiteKeyCount ? label('glissandoRun.summary', { n: live.whiteKeyCount, total: fractionText(timing.total), step: fractionText(timing.step) }) : '', ...warn].filter(Boolean).join(' ');

    const actions = row();
    actions.append(mk(label('glissandoRun.apply'), 'glissando-run-apply', apply, { primary: true, disabled: !live.whiteKeyCount }));
    if (base.existing) actions.append(mk(label('glissandoRun.remove'), 'glissando-run-remove', () => { try { app.removeGlissandoRun(ids, viewId); close(); onDone?.(null); } catch (e) { fail(e); } }));
    actions.append(mk(label('glissandoRun.close'), 'glissando-run-close', close));
    const msg = el('div', 'min-height:1.2em;font-size:13px;color:var(--danger-ink,#a33)', { role: 'alert' }); msg.textContent = message;
    box.replaceChildren(title, hint, caption(label('glissandoRun.start')), pitchRow, caption(label('glissandoRun.timing')), modes, values, status, actions, msg);
    // replaceChildren dropped the focused button: give the focus back to its twin (keyboard users keep their place)
    if (focusedAct) box.querySelector(`[data-act="${focusedAct}"]`)?.focus?.();
  }
  /** { step, total } as fractions of a whole note for `count` notes in the current mode (zeros when there is no note). */
  function timingOf(count) {
    if (!count) return { step: [0, 1], total: [0, 1] };
    return mode === 'speed' ? { step: value, total: [value[0] * count, value[1]] } : { step: [value[0], value[1] * count], total: value };
  }
  function fail(e) { message = (e?.code && label(`glissandoRun.err.${e.code}`) !== `glissandoRun.err.${e.code}` ? label(`glissandoRun.err.${e.code}`) : e?.message) ?? String(e); draw(); }
  function apply() {
    try { const r = app.addGlissandoRun(ids, { startPitch, mode, value }, viewId); close(); onDone?.(r); } catch (e) { fail(e); }
  }

  document.body.append(veil);
  draw();
  return { close };
}
