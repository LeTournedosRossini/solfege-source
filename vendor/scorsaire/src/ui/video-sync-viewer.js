/*
 * The small video of screen 4 when the song is synchronised with a YouTube video (not with audio files): the video itself, a menu to choose another video of the
 * list when the song has several (the main one opens first; when it cannot be played the person is asked to choose), and a line for messages.
 * It never writes the session: it loads the video in the player it is given and asks `onChoose(videoId)` when the person picks another one.
 */
import { createChoiceMenu } from './choice-menu.js';
import { videoLabel } from '../audio/videosync.js';

function el(tag, css = '', attrs = {}) { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }

/**
 * @param o.player   the YouTube player (`load(videoId, host)`)
 * @param o.videos   [{ videoId, feature }] the videos that fit the score (the main one first)
 * @param o.videoId  the one to open
 * @param o.playerOptions  passed to `player.load` (e.g. { nativeControls: false } for a video that follows the recording)
 * @param o.soundToggle     { get(): bool, set(bool) } a button that gives the video its sound back (it follows a recording that has its own)
 * @param o.onLoaded() the video is ready ; o.onError(error) it could not be loaded ; o.onChoose(videoId) another one was picked
 */
export function mountVideoViewer(host, { player, videos, videoId, label, onLoaded = () => {}, onError = () => {}, onChoose = () => {}, playerOptions = {}, soundToggle = null }) {
  const root = el('div', 'display:flex;flex-direction:column;gap:6px;flex:none;width:min(100%,360px);border:1px solid var(--line,#d8d3c8);border-radius:10px;background:var(--module,#fcfbf8);padding:6px;margin-bottom:8px;box-sizing:border-box', { 'data-video-sync': '' });
  const frame = el('div', 'position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden', { 'data-video-frame': '' });
  const bar = el('div', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap');
  const msg = el('div', 'font:13px var(--ui-font,sans-serif);color:var(--ink-soft,#555);min-height:1.2em', { 'data-video-message': '' });
  root.append(frame, bar, msg); host.append(root);

  const names = { main: label('video.main'), alternative: label('video.alternative'), backing: label('video.backing'), solo: label('video.solo'), other: label('video.other') };
  let current = videoId; let menu = null; let destroyed = false; let token = 0;
  const options = () => videos.map((v, i) => [v.videoId, videoLabel(v, i, videos, names)]);
  let sound = null; // the button that gives the video its sound back (when asked for)
  const buildMenu = () => {
    menu?.remove(); menu = null;
    if (videos.length < 2) return;
    const title = el('span', 'font:var(--w-semi,600) 13px var(--ui-font,sans-serif)'); title.textContent = label('video.label');
    menu = createChoiceMenu({ options: options(), value: current, label: label('video.choose'), act: 'video-choose', follow: true, onPick: (id) => { if (id !== current) { current = id; onChoose(id); } } });
    menu.setAttribute('data-video-choose', ''); bar.replaceChildren(title, menu, ...(sound ? [sound] : []));
  };
  buildMenu();
  if (soundToggle) {
    sound = el('button', 'min-height:var(--ui-target,40px);min-width:var(--ui-target,40px);padding:0 10px;font:inherit', { type: 'button', 'data-video-sound': '', title: label('video.sound'), 'aria-label': label('video.sound') });
    const paint = () => { const on = soundToggle.get(); sound.setAttribute('aria-pressed', String(on)); sound.textContent = on ? '🔊' : '🔇'; sound.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; };
    sound.addEventListener('click', () => { soundToggle.set(!soundToggle.get()); paint(); });
    paint(); bar.append(sound);
  }

  /** Loads `id` in a fresh element (YouTube replaces the element it is given by its iframe). */
  async function load(id = current) {
    if (destroyed) return false;
    const my = ++token; current = id; msg.style.color = 'var(--ink-soft,#555)'; msg.textContent = label('video.loading'); menu?.setValue?.(id);
    const inner = el('div', 'position:absolute;inset:0'); frame.replaceChildren(inner);
    try {
      await player.load(id, inner, playerOptions);
      if (destroyed || my !== token) return false;
      msg.textContent = ''; onLoaded(id); return true;
    } catch (e) {
      if (destroyed || my !== token) return false;
      msg.textContent = label('video.blocked'); msg.style.color = 'var(--danger-ink,#a33)';
      onError(e); return false;
    }
  }
  return {
    load, root, current: () => current,
    setMessage: (text) => { msg.style.color = 'var(--ink-soft,#555)'; msg.textContent = text; },
    destroy() { destroyed = true; try { player.destroy(); } catch { /* already gone */ } root.remove(); },
  };
}
