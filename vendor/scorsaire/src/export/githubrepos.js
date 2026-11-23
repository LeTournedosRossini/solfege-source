/*
 * The GitHub repositories of the person (« Publish on GitHub », « Send to another teacher »): a short list kept on the device, most recent first, shared by both windows and shown in the
 * settings. An entry is { repo: 'owner/name', folder: '' | 'a/b', name?: short label }. PURE: no DOM, no storage (the preference section `githubRepos` holds the list).
 * The two older single-entry memories (`githubPublish`, and `shareDeposit` which was never registered, so it never kept anything) are read once as the first entries.
 */
import { parseRepo, cleanFolder } from './githubpublish.js';

export const MAX_REPOS = 20;
const NAME_MAX = 40;

/** An entry as it is kept, or null when it does not name a usable repository. */
export function cleanEntry(raw) {
  const parsed = parseRepo(raw?.repo);
  const folder = cleanFolder(raw?.folder ?? '');
  if (!parsed || folder === null) return null;
  const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, NAME_MAX) : '';
  return { repo: `${parsed.owner}/${parsed.repo}`, folder: folder ?? '', ...(name ? { name } : {}) };
}

/** The same repository and folder (a repository name is not case sensitive on GitHub). */
export const sameTarget = (a, b) => !!a && !!b && a.repo.toLowerCase() === b.repo.toLowerCase() && (a.folder ?? '') === (b.folder ?? '');

/** A clean list: invalid entries dropped, duplicates merged (the first one stays), at most MAX_REPOS. */
export function cleanList(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const e = cleanEntry(raw);
    if (e && !out.some((x) => sameTarget(x, e))) out.push(e);
    if (out.length >= MAX_REPOS) break;
  }
  return out;
}

/** The list with `entry` put first (the one just used); an existing entry keeps its name unless a new one is given. */
export function remember(list, entry) {
  const e = cleanEntry(entry);
  if (!e) return cleanList(list);
  const old = cleanList(list).find((x) => sameTarget(x, e));
  return cleanList([{ ...e, ...(e.name || !old?.name ? {} : { name: old.name }) }, ...list]);
}

/** The list without that repository and folder. */
export const forget = (list, entry) => cleanList(list).filter((x) => !sameTarget(x, entry));

/** The list with the short name of one entry changed ('' removes it). */
export const rename = (list, entry, name) => cleanList(list).map((x) => (sameTarget(x, entry) ? cleanEntry({ ...x, name }) : x));

/**
 * What to show for an entry: its short name when it has one, else `owner/name`, then the folder.
 * @returns {string}
 */
export const entryLabel = (e) => `${e.name ? `${e.name} · ` : ''}${e.repo}${e.folder ? ` / ${e.folder}` : ''}`;

/** The list at the start: the saved one, or the older memories (the one of « Publish on GitHub » first) when no list was ever kept. */
export function initialList(saved, ...legacy) {
  if (Array.isArray(saved)) return cleanList(saved);
  return cleanList(legacy.filter(Boolean));
}

/** The preference section: { repos: [...] }. */
export const reposSection = {
  validate: (v) => (v && typeof v === 'object' && Array.isArray(v.repos) && v.repos.length <= MAX_REPOS * 2 && v.repos.every((x) => x && typeof x === 'object' && typeof x.repo === 'string' && x.repo.length <= 200) ? [] : ['githubRepos: { repos: [{ repo, folder?, name? }] } expected']),
  create: (v) => ({ repos: cleanList(v.repos) }),
};
