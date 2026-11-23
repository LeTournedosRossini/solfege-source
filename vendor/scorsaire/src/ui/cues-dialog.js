/*
 * The "Cues" window (model/cueedit.js): signs on the score that tell the automatic drum players what to do on a measure. Everything is automatic (the groove changes version by section, the breaks
 * fall by chance and by the form of the piece); a cue is the author's word, wherever he wants it: "from this measure on, play THIS version of the groove" or "on this measure, play THIS break (or none)".
 * Pick the measure, the drum track (or all of them) — or, for an alternative phrase, the player —, what the cue says, and place it; the cues already on the score are listed and can be removed. They are written above the first staff.
 */
import { createChoiceMenu } from './choice-menu.js';
import { createSwitch } from './switch.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

export function openCuesDialog({ app, label, movement = 0 }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let measure = null; let trackId = ''; let kind = 'groove'; let value = ''; let message = '';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-cues-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(560px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px;border-radius:8px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('cues.title') });
  if (!sheet) box.setAttribute('data-resizable', 'cues');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { primary = false, disabled = false, title = '', on = false } = {}) => {
    const b = el('button', `min-height:30px;padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary || on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
  const run = (fn) => { try { fn(); } catch (e) { message = e.message; } draw(); };
  const lab = (text) => { const s = el('span', 'font-size:12px;margin:0 6px'); s.textContent = text; return s; };

  function draw() {
    const info = app.cueInfo({ movement });
    if (measure == null) measure = info.target ?? 0;
    measure = Math.max(0, Math.min(info.measures - 1, measure));
    // a groove or a break is for the drum players (every one, or one); a phrase is for ONE of the other players
    const pool = kind === 'alt' ? info.players : info.tracks;
    if (trackId && !pool.some((t) => t.id === trackId)) trackId = '';
    if (kind === 'alt' && !trackId) trackId = pool[0]?.id ?? '';
    const ref = pool.find((t) => t.id === trackId) ?? pool[0] ?? null;
    const versionName = (v) => v.name ?? label(v.index === 0 ? 'grooveEditor.mainName' : 'grooveEditor.versionN', { n: v.index + 1 });
    const fillName = (f) => f.name ?? label('grooveEditor.breakN', { n: f.index });
    const altName = (a) => a.name ?? label('cues.altN', { n: a.index });
    const choices = !ref ? [] : kind === 'groove' ? ref.versions.map((v) => [v.value, versionName(v)]) : kind === 'alt' ? [...ref.alts.map((a) => [a.value, altName(a)]), ['none', label('cues.noAlt')]] : [...ref.fills.map((f) => [f.value, fillName(f)]), ['none', label('cues.noBreak')]];
    if (!choices.some(([v]) => v === value)) value = choices[0]?.[0] ?? '';

    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('cues.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('cues.hint');
    const where = row();
    const barsText = el('span', 'min-width:6em;text-align:center'); barsText.textContent = label('cues.measure', { n: measure + 1 });
    where.append(lab(label('cues.at')), mk('−', 'cue-less', () => { measure -= 1; draw(); }, { disabled: measure <= 0 }), barsText, mk('+', 'cue-more', () => { measure += 1; draw(); }, { disabled: measure >= info.measures - 1 }),
      lab(label('cues.for')), createChoiceMenu({ options: [...(kind === 'alt' ? [] : [['', label('cues.forAll')]]), ...pool.map((t) => [t.id, t.name])], value: trackId, label: label('cues.for'), act: 'cue-track', follow: true, onPick: (v) => { trackId = v; draw(); } }));
    const what = row();
    what.append(mk(label('cues.kind.groove'), 'cue-kind-groove', () => { kind = 'groove'; value = ''; draw(); }, { on: kind === 'groove', title: label('cues.kind.grooveHint') }),
      mk(label('cues.kind.break'), 'cue-kind-break', () => { kind = 'break'; value = ''; draw(); }, { on: kind === 'break', title: label('cues.kind.breakHint') }),
      mk(label('cues.kind.alt'), 'cue-kind-alt', () => { kind = 'alt'; value = ''; draw(); }, { on: kind === 'alt', title: label('cues.kind.altHint'), disabled: !info.players.length }));
    if (choices.length) what.append(createChoiceMenu({ options: choices, value, label: label(`cues.kind.${kind}`), act: 'cue-value', follow: true, onPick: (v) => { value = v; draw(); } }));
    const place = row();
    place.append(mk(label('cues.place'), 'cue-place', () => run(() => {
      const name = choices.find(([v]) => v === value)?.[1] ?? value;
      app.setCue(measure, { kind, value, text: `[${name}]`, trackId: trackId || null }, { movement });
      message = label('cues.placed', { n: measure + 1 });
    }), { primary: true, disabled: !choices.length }));

    const list = el('div', 'display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--edge,#bbb);padding-top:6px');
    const cap = el('div', 'font-weight:var(--w-semi,600)'); cap.textContent = label('cues.list'); list.append(cap);
    for (const c of info.cues) {
      const r = row(); r.setAttribute('data-cue', c.id);
      const t = el('span', 'flex:1 1 auto;font-size:13px');
      t.textContent = `${label('cues.measure', { n: c.measureIndex + 1 })} · ${label(`cues.kind.${c.kind}`)} ${c.text}${c.trackName ? ` · ${c.trackName}` : ''}`;
      r.append(t, mk('✕', `cue-remove-${c.id}`, () => run(() => { app.removeCue(c.id, { movement }); message = ''; }), { title: label('cues.remove') }));
      list.append(r);
    }
    if (!info.cues.length) { const none = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); none.textContent = label('cues.none'); list.append(none); }

    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-cues-message': '' }); status.textContent = message || (!info.tracks.length && !info.players.length ? label('cues.noDrums') : '');
    const foot = row();
    foot.append(createSwitch({ checked: info.shown, text: label('cues.show'), attrs: { 'data-act': 'cue-show', title: label('cues.showHint') }, onchange: (e) => run(() => { app.setCuesShown(e.target.checked, { movement }); }) }), mk(label('strum.bake.close'), 'cue-close', close));
    box.replaceChildren(title, hint, ...(info.tracks.length || info.players.length ? [where, what, place] : []), status, list, foot);
  }

  document.body.append(veil);
  draw();
  return { close };
}
