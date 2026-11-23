// The M / S button of a track row (screens 1 to 4): one press mutes (the button turns red), a second press makes it the solo (yellow), a third puts it back.
export function trackAudioButton(app, trackId, label = (k) => k) {
  const t = app.mixerState().tracks.find((x) => x.id === trackId);
  const state = t?.solo ? 'solo' : t?.mute ? 'mute' : 'off';
  const b = document.createElement('button');
  b.type = 'button'; b.setAttribute('data-ms', state); b.setAttribute('data-no-icon', ''); b.setAttribute('data-key', `ms-${trackId}`);
  b.textContent = state === 'solo' ? 'S' : state === 'mute' ? 'M' : 'M/S';
  const title = label(`tracks.ms.${state}`); b.title = title; b.setAttribute('aria-label', title);
  b.style.cssText = `min-width:var(--ui-target,30px);min-height:var(--ui-target,30px);padding:0 4px;font:700 ${state === 'off' ? 11 : 13}px sans-serif;border-radius:6px;cursor:pointer;`
    + (state === 'mute' ? 'background:#e8604c;color:#fff;border-color:#b3392a' : state === 'solo' ? 'background:#f1d36b;color:var(--ink,#111);border-color:#b8982c' : 'color:var(--ink-faint,#777)');
  b.addEventListener('click', () => app.cycleTrackAudio(trackId));
  return b;
}
