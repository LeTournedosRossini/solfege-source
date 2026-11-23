/*
 * Audio engine section — DOM. Pick the engine (light oscillators / SoundFont) and the SoundFont; add a font from a file or an address; see the download
 * progress and any error. It lives in the SETTINGS panel (section « Audio »): `mountAudioSection` returns one persistent element that keeps itself up to date
 * (the engine manager notifies it) and that the settings panel places each time it is drawn. The choice is a device preference, never part of the score.
 */
import { soundTestSequence, judgeSoundTest } from '../audio/soundtest.js';
import { latencyMode, setLatencyMode } from '../audio/webaudio.js';

const STYLE_ID = 'audio-section-style';
const CSS = `
[data-audio-section] .au-section { padding: 0; }
[data-audio-section] .au-section h4 { margin: 8px 0 4px; font-size: 13px; }
[data-audio-section] .au-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap, 2px); margin: 4px 0; }
[data-audio-section] .au-grow { flex: 1 1 10em; min-width: 0; }
[data-audio-section] .au-note { font-size: 12px; color: var(--ink-soft,#555); }
[data-audio-section] button { min-width: var(--sp-target, var(--ui-target, 30px)); min-height: var(--sp-target, var(--ui-target, 30px)); padding: 0 10px; font: inherit; }
[data-audio-section] button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
[data-audio-section] input[type="text"] { font-size: 16px; min-height: var(--sp-target, var(--ui-target, 30px)); box-sizing: border-box; flex: 1 1 12em; min-width: 0; }
[data-audio-section] .au-status { min-height: 1.4em; }
[data-audio-section] .au-error { color: var(--danger-ink,#b00020); }
[data-audio-section] .au-test p { margin: 2px 0; font-size: 13px; }
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

const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} Mo`;

/**
 * @param manager engine manager (`engine-manager.js`)
 * @param label   (key, params) → text
 * @returns { el, refresh(), destroy() } — `el` is the section's content (engine, status, fonts, add a font), kept up to date
 */
export function mountAudioSection({ manager, label = (k) => k }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  const root = el('div', { 'data-audio-section': '' });
  let cache = new Map(); let lastError = ''; let testing = false; let testLines = []; let testLevel = null;

  const guard = async (fn) => {
    try { lastError = ''; await fn(); } catch (e) { lastError = label(`audio.error.${e?.code ?? 'failed'}`) + (e?.code ? '' : ` (${e?.message ?? e})`); }
    await refresh();
  };

  const pickFile = () => new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: '.sf2,.sf3,audio/x-soundfont', style: 'position:fixed;left:-1000px' });
    input.addEventListener('change', () => { const f = input.files?.[0] ?? null; input.remove(); resolve(f); });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    document.body.append(input);
    input.click();
  });

  function statusText(s) {
    if (s.status === 'loading') return s.progress != null ? label('audio.loadingPercent', { n: Math.round(s.progress * 100) }) : label('audio.loading');
    if (s.status === 'ready') return label('audio.ready');
    if (s.status === 'error') return label(`audio.error.${s.error}`) + (['network', 'format', 'nofile', 'unsupported', 'url', 'inuse'].includes(s.error) ? '' : ` (${s.message ?? ''})`);
    return s.active === 'light' ? label('audio.lightActive') : '';
  }

  /** Plays four notes and watches the level that leaves the engine for about two seconds; the result stays on screen until the next test. */
  async function runSoundTest() {
    if (testing) return;
    testing = true; testLines = [label('audio.test.running')]; testLevel = null; draw();
    const engine = manager.current();
    let peak = 0;
    try {
      engine.audition?.(soundTestSequence());
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 50)); peak = Math.max(peak, manager.outputPeak()); }
    } catch (e) { lastError = label('audio.test.failed', { message: e?.message ?? String(e) }); }
    const s = manager.state(); const outputDb = manager.outputDb();
    const verdict = judgeSoundTest({ peak, contextState: manager.contextState(), active: s.active, status: s.status, outputDb });
    const ctxState = manager.contextState();
    testLines = [
      label('audio.test.engine', { engine: s.active === 'soundfont' ? label('audio.soundfont') : label('audio.light') }),
      label('audio.test.context', { state: label(`audio.test.state.${ctxState}`) }),
      label('audio.test.gain', { db: String(outputDb) }),
      latencyLine(),
      Number.isFinite(verdict.db) ? label('audio.test.level', { db: verdict.db.toFixed(0) }) : label('audio.test.levelNone'),
      label(`audio.test.${verdict.level}`),
      ...(verdict.cause ? [label(`audio.test.cause.${verdict.cause}`, { status: s.status })] : []),
    ];
    testLevel = verdict.level; testing = false; draw();
  }

  /** The delay the browser reports for this context (output buffer + device), in one line; the mode in use is the one the context was made with. */
  function latencyLine() {
    const info = manager.current()?.latencyInfo?.();
    if (!info || info.outputMs == null && info.baseMs == null) return label('audio.latency.unknown');
    const total = (info.baseMs ?? 0) + (info.outputMs ?? 0);
    const line = label('audio.latency.measured', { ms: String(Math.round(total)), base: String(Math.round(info.baseMs ?? 0)), output: String(Math.round(info.outputMs ?? 0)) });
    return info.synthLagMs > 0 ? `${line} ${label('audio.latency.synthLag', { ms: String(info.synthLagMs) })}` : line;
  }

  function draw() {
    const s = manager.state();
    const prefFont = s.fontId;
    const engines = el('div', { class: 'au-section' }, el('h4', {}, label('audio.engine')),
      el('div', { class: 'au-row' },
        el('button', { type: 'button', 'data-engine': 'light', 'aria-pressed': String(s.requested === 'light'), onclick: () => guard(() => manager.select({ engine: 'light' })) }, label('audio.light')),
        el('button', { type: 'button', 'data-engine': 'soundfont', 'aria-pressed': String(s.requested === 'soundfont'), onclick: () => guard(() => manager.select({ engine: 'soundfont' })) }, label('audio.soundfont'))),
      el('p', { class: 'au-note' }, label('audio.engineHint')));
    const status = el('div', { class: `au-status${s.status === 'error' || lastError ? ' au-error' : ''}`, role: 'status', 'data-audio-status': '' }, lastError || statusText(s));
    const fonts = manager.fonts();
    const list = el('div', { class: 'au-section' }, el('h4', {}, label('audio.fonts')),
      ...fonts.map((f) => {
        const inCache = cache.get(f.id) === true;
        const chosen = prefFont === f.id;
        const size = f.sizeMB ? `${f.sizeMB} Mo` : f.size ? mb(f.size) : '';
        return el('div', { class: 'au-row', 'data-font': f.id },
          el('span', { class: 'au-grow' }, el('strong', {}, f.name), el('span', { class: 'au-note' }, ` ${size} · ${inCache ? label('audio.cached') : f.url ? label('audio.toDownload') : label('audio.needsFile')}`)),
          el('button', { type: 'button', 'data-font-use': f.id, 'aria-pressed': String(chosen && s.requested === 'soundfont'), onclick: () => guard(() => manager.select({ engine: 'soundfont', fontId: f.id })) }, label('audio.use')),
          el('button', { type: 'button', 'data-font-remove': f.id, title: label('audio.remove'), 'aria-label': label('audio.remove'), disabled: !inCache && f.builtin, onclick: () => guard(() => manager.remove(f.id)) }, '🗑'));
      }),
      el('p', { class: 'au-note' }, label('audio.licenseHint')));
    const urlInput = el('input', { type: 'text', 'data-audio-url': '', placeholder: 'https://…/font.sf2', 'aria-label': label('audio.addUrl'), inputmode: 'url' });
    const add = el('div', { class: 'au-section' }, el('h4', {}, label('audio.add')),
      el('div', { class: 'au-row' }, el('button', { type: 'button', 'data-audio-act': 'add-file', onclick: () => guard(async () => { const f = await pickFile(); if (f) { const id = await manager.addFile(f.name, await f.arrayBuffer()); await manager.select({ engine: 'soundfont', fontId: id }); } }) }, label('audio.addFile'))),
      el('div', { class: 'au-row' }, urlInput,
        el('button', { type: 'button', 'data-audio-act': 'add-url', onclick: () => guard(async () => { const id = await manager.addUrl(urlInput.value); await manager.select({ engine: 'soundfont', fontId: id }); }) }, label('audio.addUrl'))));
    const test = el('div', { class: 'au-section au-test' }, el('h4', {}, label('audio.test')),
      el('div', { class: 'au-row' }, el('button', { type: 'button', 'data-audio-act': 'sound-test', disabled: testing, onclick: () => { runSoundTest(); } }, label('audio.test'))),
      el('p', { class: 'au-note' }, label('audio.test.hint')),
      el('div', { role: 'status', 'data-audio-test': testLevel ?? '', class: testLevel === 'silent' ? 'au-error' : '' }, ...testLines.map((t) => el('p', {}, t))));
    const mode = latencyMode();
    const latency = el('div', { class: 'au-section' }, el('h4', {}, label('audio.latency')),
      el('div', { class: 'au-row' }, ...['standard', 'minimal'].map((m) => el('button', { type: 'button', 'data-latency': m, 'aria-pressed': String(mode === m), onclick: () => { setLatencyMode(m); draw(); } }, label(`audio.latency.${m}`)))),
      el('p', { class: 'au-note' }, label('audio.latency.hint')),
      el('p', { class: 'au-note', 'data-latency-now': '' }, latencyLine()));
    root.replaceChildren(engines, latency, status, test, list, add);
  }

  async function refresh() { cache = await manager.cached(); draw(); }
  const off = manager.subscribe(() => { refresh(); });
  refresh();
  return { el: root, refresh, destroy() { off(); root.remove(); } };
}
