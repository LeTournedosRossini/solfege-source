/*
 * The list of the person's GitHub repositories, as a small control for the two windows that publish (« Publish on GitHub », « Send to another teacher »): a menu of the repositories
 * kept on the device (export/githubrepos.js) and a button that takes the chosen one off the list. Choosing one fills the repository and folder fields; typing another repository leaves
 * the menu on « another repository ». Nothing is sent from here.
 */
import { entryLabel, sameTarget, cleanEntry } from '../export/githubrepos.js';

/**
 * @param o.label    (key) → text
 * @param o.repos    the kept repositories [{ repo, folder, name? }]
 * @param o.current  () → { repo, folder } as typed in the fields now (strings)
 * @param o.folderOf  (entry) → the folder the window would use for that entry (default: the entry's own)
 * @param o.onPick   (entry) → void: fill the fields
 * @param o.onForget (entry) → void: take the entry off the list (the owner redraws)
 * @returns an element, or null when the list is empty
 */
export function createRepoPicker({ label, repos, current, onPick, onForget, folderOf = (e) => e.folder ?? '' }) {
  if (!repos?.length) return null;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center';
  wrap.setAttribute('data-github-repos', '');
  const name = document.createElement('span'); name.style.cssText = 'font-size:13px'; name.textContent = label('githubRepos.pick');
  const select = document.createElement('select');
  select.setAttribute('data-act', 'github-repo-pick');
  select.style.cssText = 'min-height:var(--ui-target,36px);max-width:100%;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:14px var(--ui-font,sans-serif)';
  repos.forEach((e, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = entryLabel(e); select.append(o); });
  const other = document.createElement('option'); other.value = ''; other.textContent = label('githubRepos.other'); select.append(other);
  const now = current();
  const typed = cleanEntry({ repo: now.repo, folder: now.folder }); // however the repository was written (address, .git, github.io…)
  const at = typed ? repos.findIndex((e) => sameTarget({ repo: e.repo, folder: folderOf(e) }, typed)) : -1;
  select.value = at >= 0 ? String(at) : '';
  const forget = document.createElement('button');
  forget.type = 'button'; forget.setAttribute('data-act', 'github-repo-forget');
  forget.style.cssText = 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif)';
  forget.textContent = label('githubRepos.forget');
  forget.style.display = at >= 0 ? '' : 'none';
  select.addEventListener('keydown', (e) => e.stopPropagation());
  select.addEventListener('change', () => { const e = repos[Number(select.value)]; forget.style.display = e ? '' : 'none'; if (e) onPick(e); });
  forget.addEventListener('click', () => { const e = repos[Number(select.value)]; if (e) onForget(e); });
  wrap.append(name, select, forget);
  return wrap;
}
