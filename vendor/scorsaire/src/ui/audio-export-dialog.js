/*
 * The « Export audio » window (audio/audioexport.js): the full mix as it is played, one file per track, or one file for a GROUP of tracks, as WAV (16 or 24 bits) or Opus. Several files come in one
 * `.zip`. Nothing is rendered before « Export »; a progress line and « Cancel » while it runs.
 */
import { createSwitch } from './switch.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { AUDIO_FORMATS, planTargets, audioFormat } from '../audio/audioexport.js';

/**
 * @param o.tracks   [{ id, name }] the tracks of the piece
 * @param o.canOpus  whether the browser can encode Opus
 * @param o.run      async ({ targets, format, signal, onProgress }) → void : renders, encodes and writes (the page downloads); throws on failure, `code: 'aborted'` when cancelled
 */
export function openAudioExportDialog({ tracks, canOpus = false, label, run, onDone = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const state = { full: true, separate: new Set(), groups: [], format: 'wav16', busy: false, message: '', progress: null };
  let ctl = null; let done = false;
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-audio-export': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(560px,100%);max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:10px;border-radius:${sheet ? '12px 12px 0 0' : '10px'}`, { 'data-resizable': 'audio-export' });
  veil.append(box);
  const close = () => { if (done) return; done = true; ctl?.abort(); window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil && !state.busy) close(); });
  window.addEventListener('keydown', onKey, true);

  const BTN = 'min-height:var(--ui-target,36px);min-width:var(--ui-target,36px);padding:0 12px;border-radius:6px;border:1px solid var(--edge,#bbb);background:var(--field,#fff);color:inherit;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);cursor:pointer';
  const mk = (text, fn, { primary = false, on = false, disabled = false, act = '' } = {}) => {
    const b = el('button', `${BTN}${primary || on ? ';background:var(--accent-soft,#cfe3ff)' : ''}${disabled ? ';opacity:.45;cursor:default' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; b.disabled = disabled; if (on) b.setAttribute('aria-pressed', 'true'); b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center');
  const heading = (text) => { const h = el('div', 'font-weight:var(--w-semi,600);margin-top:2px'); h.textContent = text; return h; };
  const trackToggle = (t, set) => {
    const sw = createSwitch({ checked: set.has(t.id), text: t.name || t.id, attrs: { 'data-track': t.id }, onchange: () => { if (sw.checked) set.add(t.id); else set.delete(t.id); draw(); } });
    sw.style.cssText = BTN; return sw;
  };
  const targetsNow = () => planTargets({ tracks, full: state.full, separate: [...state.separate], groups: state.groups.map((g) => ({ name: g.name, trackIds: [...g.ids] })) });

  function draw() {
    const targets = targetsNow();
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('audioExport.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('audioExport.hint');
    const full = createSwitch({ checked: state.full, text: label('audioExport.full'), attrs: { 'data-act': 'audio-full' }, onchange: () => { state.full = full.checked; draw(); } }); full.style.cssText = BTN;
    const sepRow = row();
    sepRow.append(mk(label('audioExport.all'), () => { tracks.forEach((t) => state.separate.add(t.id)); draw(); }, { act: 'audio-all' }), mk(label('audioExport.none'), () => { state.separate.clear(); draw(); }, { act: 'audio-none' }));
    const sepTracks = row(); for (const t of tracks) sepTracks.append(trackToggle(t, state.separate));
    const groups = el('div', 'display:flex;flex-direction:column;gap:8px');
    state.groups.forEach((g, gi) => {
      const box1 = el('div', 'border:1px solid var(--edge,#bbb);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:6px', { 'data-group': String(gi) });
      const head = row();
      const name = el('input', 'flex:1 1 140px;min-height:var(--ui-target,36px);box-sizing:border-box;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:14px var(--ui-font,sans-serif)', { type: 'text', value: g.name, 'aria-label': label('audioExport.groupName'), 'data-act': 'audio-group-name' });
      name.addEventListener('input', () => { g.name = name.value; });
      head.append(name, mk('✕', () => { state.groups.splice(gi, 1); draw(); }, { act: 'audio-group-remove' }));
      const members = row(); for (const t of tracks) members.append(trackToggle(t, g.ids));
      box1.append(head, members); groups.append(box1);
    });
    const addGroup = mk(label('audioExport.addGroup'), () => { state.groups.push({ name: label('audioExport.groupDefault', { n: state.groups.length + 1 }), ids: new Set() }); draw(); }, { act: 'audio-add-group' });
    const formats = row();
    for (const f of AUDIO_FORMATS) {
      const off = f.ext === 'opus' && !canOpus;
      formats.append(mk(label(`audioExport.fmt.${f.id}`), () => { state.format = f.id; draw(); }, { on: state.format === f.id, disabled: off, act: `audio-fmt-${f.id}` }));
    }
    const note = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); note.textContent = canOpus ? label('audioExport.noteOpus') : label('audioExport.noOpus');
    const count = el('div', 'font-size:13px;padding:6px;border-radius:6px;border:1px solid var(--edge,#bbb)', { role: 'status', 'data-audio-count': String(targets.length) });
    count.textContent = !targets.length ? label('audioExport.nothing') : targets.length === 1 ? label('audioExport.one', { name: `${targets[0].name}.${audioFormat(state.format).ext}` }) : label('audioExport.many', { n: targets.length });
    const caveat = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); caveat.textContent = label('audioExport.caveat');
    const actions = row();
    if (state.busy) actions.append(mk(label('audioExport.cancel'), () => { ctl?.abort(); }, { act: 'audio-cancel' }));
    else actions.append(mk(label('audioExport.export'), start, { primary: true, disabled: !targets.length, act: 'audio-export' }), mk(label('audioExport.close'), close, { act: 'audio-close' }));
    const msg = el('div', `min-height:1.2em;font-size:13px;${state.progress ? '' : 'color:var(--danger-ink,#a33)'}`, { role: 'status', 'data-audio-message': '' });
    msg.textContent = state.progress ? label('audioExport.progress', { n: state.progress.file + 1, total: state.progress.files, name: state.progress.name, percent: Math.round(state.progress.fraction * 100) }) : state.message;
    box.replaceChildren(title, hint, heading(label('audioExport.what')), full, heading(label('audioExport.apart')), sepRow, sepTracks, heading(label('audioExport.groups')), groups, addGroup, heading(label('audioExport.format')), formats, note, count, caveat, actions, msg);
  }

  async function start() {
    const targets = targetsNow(); if (!targets.length || state.busy) return;
    state.busy = true; state.message = ''; state.progress = { file: 0, files: targets.length, name: targets[0].name, fraction: 0 }; ctl = new AbortController(); draw();
    try {
      await run({ targets, format: audioFormat(state.format), signal: ctl.signal, onProgress: (p) => { state.progress = p; const m = box.querySelector('[data-audio-message]'); if (m) m.textContent = label('audioExport.progress', { n: p.file + 1, total: p.files, name: p.name, percent: Math.round(p.fraction * 100) }); } });
      state.message = label('audioExport.done'); state.progress = null; state.busy = false; draw(); onDone?.();
    } catch (e) {
      state.busy = false; state.progress = null;
      state.message = e?.code === 'aborted' ? label('audioExport.cancelled') : label('audioExport.error', { message: e?.message ?? String(e) });
      if (!done) draw();
    }
  }
  draw();
  document.body.append(veil);
  return { close, element: veil };
}
