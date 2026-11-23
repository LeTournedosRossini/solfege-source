/*
 * The links a teacher sends to pupils (page `liens/` of the public reader site): from a `.scorsaire` file, the movements and tracks it holds, and the ADDRESS of a reader that opens it with
 * the settings of the teacher (transposition, tracks shown first, display transposition of each track, the name of the pupil who plays it). Pure: no DOM, no fetch.
 * The parameters are those of `reader/startparams.js` (`file`, `m`, `tr`, `tracks`, `tt`, `who`).
 */
import { PID } from '../model/pid.js';
import { TRANSPOSE_RANGE } from '../model/sheetedit.js';
import { sectionSpans } from '../model/sections.js';
import { parseRepo } from '../export/githubpublish.js';

export { TRANSPOSE_RANGE };
export const NAME_MAX = 40;

/** The movements of a work with their tracks and sections: [{ id, title, tracks: [{ id, name }], measures: [ids], sections: [{ label, from, to }] }] (`from` / `to` = measure indexes from 0). */
export function movementsOf(work) {
  return (work?.movements ?? []).map((mv, i) => ({
    id: mv.id,
    title: String(mv.props?.[PID.TITLE] || '').trim() || `${i + 1}`,
    tracks: mv.tracks.map((t) => ({ id: t.id, name: String(t.props?.[PID.NAME] || '').trim() || t.id })),
    measures: (mv.masterbars ?? []).map((b) => b.id),
    sections: (mv.masterbars?.length ? sectionSpans(mv) : []).map((s) => ({ label: String(s.label || '').trim() || String(s.category), from: s.from, to: s.to })),
  }));
}

const clampShift = (n) => Math.max(-TRANSPOSE_RANGE, Math.min(TRANSPOSE_RANGE, Math.round(Number(n) || 0)));
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, NAME_MAX);

/**
 * The address of a reader page.
 * @param o.reader      the address of the reader page (`https://…/feuilles/`)
 * @param o.file        the ABSOLUTE address of the `.scorsaire`
 * @param o.movement    the id of the movement, or null (the first sheet of the file)
 * @param o.transpose   semitones for everything (0 = none)
 * @param o.tracks      ids of the tracks shown first, or null for all of them
 * @param o.shifts      { trackId: semitones } display transposition of single tracks (0 and absent = none)
 * @param o.who         { trackId: name } the pupils
 * @param o.only        a track id: this link shows ONLY that track first (the others stay one tap away)
 * @param o.speed       percent (25 to 200), 100 = not written
 * @param o.loop        { from, to } ids of two measures: the loop the reader starts with
 * @param o.mute        ids of the tracks that start muted (the pupil plays them); `muteOwn` adds the track of an `only` link
 * @param o.viewer      'piano' | 'guitar' | null (folded, the usual); `viewerOf` { trackId: ... } gives the link of a single track its own
 * @param o.preroll     0 to 2 measures of count-in, or null (the reader's own); o.click 'off' | 'pre' | 'always', or null
 */
export function buildLink({ reader, file, movement = null, transpose = 0, tracks = null, shifts = {}, who = {}, only = null, speed = 100, loop = null, mute = [], muteOwn = false, preroll = null, click = null, viewer = null, lyrics = null }) {
  const q = new URLSearchParams();
  q.set('file', file);
  if (movement) q.set('m', movement);
  const tr = clampShift(transpose); if (tr) q.set('tr', String(tr));
  const shown = only ? [only] : tracks;
  if (shown?.length) q.set('tracks', shown.join(','));
  const tt = Object.entries(shifts).map(([id, n]) => [id, clampShift(n)]).filter(([, n]) => n);
  if (tt.length) q.set('tt', tt.map(([id, n]) => `${id}:${n}`).join(','));
  const names = Object.entries(who).map(([id, n]) => [id, cleanName(n)]).filter(([, n]) => n);
  const v = Math.round(Number(speed) || 100); if (v !== 100 && v >= 25 && v <= 200) q.set('v', String(v));
  if (loop?.from && loop?.to) q.set('loop', `${loop.from}-${loop.to}`);
  const quiet = [...new Set([...(mute ?? []), ...(muteOwn && only ? [only] : [])])];
  if (quiet.length) q.set('mute', quiet.join(','));
  if (Number.isInteger(preroll) && preroll >= 0 && preroll <= 2) q.set('pre', String(preroll));
  if (['off', 'pre', 'always'].includes(click)) q.set('click', click);
  if (viewer === 'piano' || viewer === 'guitar') q.set('viewer', viewer);
  if (lyrics === 'strophes' || lyrics === 'staff') q.set('lyrics', lyrics); // the words as strophes (the readers' usual) or on their own staff
  if (names.length) q.set('who', names.map(([id, n]) => `${id}:${encodeURIComponent(n)}`).join(',')); // each name encoded once, the list once more by the query
  return `${reader}?${q.toString()}`;
}

/** One link per track plus the general one: [{ id: null | trackId, link }] (the general link first). */
export function buildLinks(o) {
  const all = o.tracks ?? null;
  const ids = (o.trackList ?? []).map((t) => t.id);
  return [{ id: null, link: buildLink({ ...o, tracks: all && all.length < ids.length ? all : null, viewer: o.viewer ?? null }) }, ...ids.map((id) => ({ id, link: buildLink({ ...o, only: id, viewer: o.viewerOf?.[id] ?? o.viewer ?? null }) }))];
}

/** The absolute address of a file given by the person: a path without a scheme is counted from `site` (the root of the site that serves the page). */
export function absoluteFile(file, site) {
  const f = String(file ?? '').trim();
  if (!f) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(f) ? f : new URL(f.replace(/^\/+/, ''), site).href;
}

// ---------- browsing a public GitHub repository for `.scorsaire` files (no token: the public API, read only) ----------

export const API = 'https://api.github.com';

/** The address that tells the default branch of `{ owner, repo }`. */
export const repoInfoUrl = ({ owner, repo }) => `${API}/repos/${owner}/${repo}`;
/** The address of the whole tree of a branch (one request). */
export const repoTreeUrl = ({ owner, repo }, branch) => `${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;

/** The `.scorsaire` files of a tree answer, sorted by path: [{ path, name, folder, bytes }]. `truncated` trees are still used (the list may be incomplete: the caller says so). */
export function scorsaireFiles(tree) {
  return (Array.isArray(tree?.tree) ? tree.tree : [])
    .filter((e) => e?.type === 'blob' && /\.scorsaire$/i.test(String(e.path ?? '')))
    .map((e) => { const i = e.path.lastIndexOf('/'); return { path: e.path, name: e.path.slice(i + 1), folder: i < 0 ? '' : e.path.slice(0, i), bytes: Number(e.size) || 0 }; })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true }));
}

/** The address a reader fetches (`file=`): raw.githubusercontent.com serves files with the headers that let another page read them. */
export const rawUrl = ({ owner, repo }, branch, path) => `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** What the person typed to narrow the list: every word must be in the path (accents and case ignored). */
export function filterFiles(files, text) {
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = norm(text).split(/\s+/).filter(Boolean);
  return words.length ? files.filter((f) => words.every((w) => norm(f.path).includes(w))) : files;
}

// ---------- the editor hands its repositories to the page (in the FRAGMENT of the address: it never goes to a server) ----------

/** The address of the links page opened from the editor: the repositories of the person (`owner/name`, no folder) as `#repos=a%2Fb,c%2Fd`. */
export function linksPageUrl(base, repos) {
  const seen = new Set(); const list = [];
  for (const r of repos ?? []) { const p = parseRepo(r); if (!p) continue; const k = `${p.owner}/${p.repo}`; if (!seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); list.push(k); } }
  return `${base}liens/${list.length ? `#repos=${list.map(encodeURIComponent).join(',')}` : ''}`;
}

/** The repositories the editor handed over (`repos=` of the fragment or of the query): [{ owner, repo }], at most 20, duplicates dropped. */
export function reposFromAddress(loc) {
  const read = (text) => new URLSearchParams(String(text ?? '').replace(/^[#?]/, '')).get('repos');
  const raw = read(loc?.hash) ?? read(loc?.search) ?? '';
  const out = [];
  for (const piece of raw.split(',')) {
    let t = piece; try { t = decodeURIComponent(piece); } catch { /* as it is */ }
    const p = parseRepo(t); if (p && !out.some((x) => x.owner.toLowerCase() === p.owner.toLowerCase() && x.repo.toLowerCase() === p.repo.toLowerCase())) out.push(p);
    if (out.length >= 20) break;
  }
  return out;
}
