/*
 * What screens 4 and 5 show while nothing is loaded: an empty page (like screens 2 and 3 it replaces screen 1, which is hidden) with a short text and ONE button
 * to load what the screen is for (a recording / a YouTube address). The real panels are only mounted once a session starts, so none of them has to cope with
 * « nothing loaded ». The work that was open stays untouched in the background: it is only replaced (after the offer to save it) when something is loaded.
 */
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); }
  n.append(...kids.flat().filter((c) => c != null && c !== false));
  return n;
};

/** @param kind 'audio' (screen 4) | 'youtube' (screen 5)   @param onLoad() opens the loading of a recording / of a YouTube address */
export function mountSyncIdle({ kind, label, onLoad, onCreate = null, onFromMusic = null }) {
  const loadBtn = el('button', { type: 'button', 'data-act': kind === 'audio' ? 'idle-load-audio' : 'idle-load-youtube', onclick: () => onLoad() }, label(kind === 'audio' ? 'syncIdle.loadAudio' : 'syncIdle.loadYoutube'));
  loadBtn.style.cssText = 'min-height:var(--ui-target,30px);padding:0 18px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif)';
  // « make the synchronisation by hand »: the score that is open + a recording, tapped measure by measure
  const createBtn = onCreate ? el('button', { type: 'button', 'data-act': 'idle-create-sync', onclick: () => onCreate() }, label('syncIdle.createSync')) : null;
  if (createBtn) createBtn.style.cssText = loadBtn.style.cssText;
  // « make the score from the music »: nothing exists yet, the taps give the measures
  const musicBtn = onFromMusic ? el('button', { type: 'button', 'data-act': 'idle-from-music', onclick: () => onFromMusic() }, label('syncIdle.fromMusic')) : null;
  if (musicBtn) musicBtn.style.cssText = loadBtn.style.cssText;
  const root = el('div', { 'data-sync-idle': kind, style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:48vh;padding:24px 16px;text-align:center' },
    el('div', { style: 'font:15px var(--ui-font,sans-serif);color:var(--ink-soft,#555);max-width:34em;line-height:1.4' }, label(kind === 'audio' ? 'syncIdle.noAudio' : 'syncIdle.youtubeHint')), loadBtn, createBtn, musicBtn);
  return { el: root, kind, destroy() { root.remove(); } };
}
