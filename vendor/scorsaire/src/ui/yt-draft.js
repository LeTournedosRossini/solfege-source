/*
 * A light safeguard for the YouTube editor: the session (placements, banner, options) is copied to the browser's storage as the person works, keyed by the video.
 * It is NOT the real saving (that is the file); it only lets a closed tab or a crash be forgiven. Storage may be missing or full: every access is guarded.
 */
const key = (videoId) => `scorsaire.ytDraft.${videoId}`;

export function saveDraft(videoId, state, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage?.setItem(key(videoId), JSON.stringify({ savedAt: Date.now(), ...state })); return true; } catch { return false; }
}
export function loadDraft(videoId, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { const raw = storage?.getItem(key(videoId)); if (!raw) return null; const d = JSON.parse(raw); return d && Array.isArray(d.placements) ? d : null; } catch { return null; }
}
export function clearDraft(videoId, storage = typeof localStorage !== 'undefined' ? localStorage : null) { try { storage?.removeItem(key(videoId)); } catch { /* ignore */ } }
