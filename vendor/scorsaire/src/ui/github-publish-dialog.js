/*
 * The « Publish on GitHub » window (export/githubpublish.js), WITHOUT any token: three steps the person does themselves — download the page (the one that holds a YouTube link, never audio),
 * drop it on the upload page of THEIR repository, copy the address it will have. The repository and the folder are kept on the device (`githubPublish` preference). Nothing is sent from here:
 * the buttons download a file, open a GitHub page in a new tab and copy a text. A text for an AI assistant can be copied too, so a person who knows nothing about GitHub is guided step by step.
 */
import { parseRepo, cleanFolder, pageFileName, uploadUrl, pageUrl, helpPrompt, useTemplateUrl, templateUrl, WEB_UPLOAD_LIMIT } from '../export/githubpublish.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { createRepoPicker } from './github-repo-picker.js';

/**
 * @param o.kinds     [[id, text]]: the pages that can be published (one or two)
 * @param o.nameOf    (kindId) → the name the downloaded file would have (cleaned here)
 * @param o.build     (kindId, fileName) → Promise<Blob>: the page itself
 * @param o.repos     the kept repositories [{ repo, folder, name? }], most recent first ; o.saved: the single older memory { repo, folder } when no list is given
 * @param o.save      ({ repo, folder }) → the new list (or nothing) ; o.forget(entry) → the new list: takes one repository off the list
 * @param o.download  (name, blob) ; o.open (url) ; o.copy (text) → Promise<boolean>
 * @param o.tracks    { summary() → text, choose() → Promise } or null: the tracks the page opens on (« 5 of 8 shown » and a button that opens the chooser)
 */
export function openGithubPublish({ label, lang = 'fr', kinds, nameOf, build, saved = null, repos = null, save = () => {}, forget = () => {}, download, open, copy, tracks = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-github-publish': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(560px,98vw);max-height:${sheet ? '90vh' : '92vh'};overflow:auto;display:flex;flex-direction:column;gap:10px;border-radius:${sheet ? '12px 12px 0 0' : '8px'}`);
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; commit(); done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { primary = false } = {}) => {
    const b = el('button', `min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);${primary ? 'background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center');
  const note = (text, css = '') => { const d = el('div', `font-size:12px;color:var(--ink-soft,#555);${css}`); d.textContent = text; return d; };
  const field = (text, act, value, placeholder) => {
    const wrap = el('label', 'display:flex;flex-direction:column;gap:2px;font-size:13px');
    const input = el('input', 'min-height:var(--ui-target,36px);box-sizing:border-box;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:15px var(--ui-font,sans-serif)', { type: 'text', 'data-field': act, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    input.value = value; input.addEventListener('keydown', (e) => e.stopPropagation());
    wrap.append(text, input); return { wrap, input };
  };

  let list = repos ?? (saved ? [saved] : []);
  saved = list[0] ?? null;
  let kind = kinds[0][0];
  const repoField = field(label('githubPublish.repo'), 'repo', saved?.repo ?? '', label('githubPublish.repoPlaceholder'));
  const folderField = field(label('githubPublish.folder'), 'folder', saved?.folder ?? '', label('githubPublish.folderPlaceholder'));
  const fileField = field(label('githubPublish.file'), 'file', pageFileName(nameOf(kind)), 'page.html');
  let fileTouched = false;
  fileField.input.addEventListener('input', () => { fileTouched = true; refresh(); });
  const repoNote = note(''); const folderNote = note(''); const stepMsg = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-github-status': '' });
  const address = el('output', 'display:block;word-break:break-all;font:13px ui-monospace,monospace;padding:6px;border:1px solid var(--edge,#bbb);border-radius:6px;background:var(--field,#fff)', { 'data-github-address': '' });
  const helpBox = el('textarea', 'display:none;width:100%;box-sizing:border-box;min-height:120px;font:13px var(--ui-font,sans-serif)', { readonly: '', 'data-github-help': '' });
  let kindRow = null;
  if (kinds.length > 1) {
    kindRow = row();
    const draw = () => { kindRow.replaceChildren(...kinds.map(([id, text]) => { const b = mk(text, `kind-${id}`, () => { kind = id; if (!fileTouched) fileField.input.value = pageFileName(nameOf(kind)); draw(); refresh(); }); if (id === kind) { b.setAttribute('aria-pressed', 'true'); b.style.background = 'var(--btn-on,#e2e0da)'; b.style.outline = '1px solid var(--btn-on-line,#b9b4a8)'; } return b; })); };
    draw();
  }

  const state = () => {
    const repo = parseRepo(repoField.input.value); const folder = cleanFolder(folderField.input.value);
    const file = pageFileName(fileField.input.value);
    return { repo, folder, file, ok: !!repo && folder !== null };
  };
  const bad = (n, text) => { n.textContent = text; n.style.color = text ? 'var(--danger-ink,#a33)' : ''; };
  const step2 = mk(`② ${label('githubPublish.step2')}`, 'github-open', () => { const s = state(); if (s.ok) { commit(); open(uploadUrl({ ...s.repo, folder: s.folder })); } }, { primary: true });
  const copyAddress = mk(`③ ${label('githubPublish.step3')}`, 'github-copy-address', async () => { const s = state(); if (!s.ok) return; commit(); say(await copy(pageUrl({ ...s.repo, folder: s.folder, file: s.file })) ? label('githubPublish.copied') : label('githubPublish.copyFailed')); });
  const say = (text) => { stepMsg.textContent = text; };
  function refresh() {
    const s = state();
    bad(repoNote, repoField.input.value.trim() && !s.repo ? label('githubPublish.repoBad') : '');
    bad(folderNote, s.folder === null ? label('githubPublish.folderBad') : '');
    step2.disabled = !s.ok; copyAddress.disabled = !s.ok; step2.style.opacity = copyAddress.style.opacity = s.ok ? '' : '.5';
    address.textContent = s.ok ? pageUrl({ ...s.repo, folder: s.folder, file: s.file }) : label('githubPublish.addressWaiting');
    if (tracksRow) tracksRow.style.display = tracks.appliesTo?.(kind) === false ? 'none' : '';
    drawPicker(); // (the menu follows what is typed: the entry matching it, or « another repository »)
  }
  // a repository is kept when a step is used, when one is picked, and when the window closes (never while typing: « owner/a », then « owner/ab »… would be kept on the way)
  function commit() { const s = state(); if (!s.ok) return; const next = save({ repo: `${s.repo.owner}/${s.repo.repo}`, folder: s.folder }); if (Array.isArray(next)) { list = next; drawPicker(); } }
  repoField.input.addEventListener('input', refresh); folderField.input.addEventListener('input', refresh);
  const pickerSlot = el('div');
  function drawPicker() {
    const picker = createRepoPicker({
      label, repos: list, current: () => ({ repo: repoField.input.value, folder: folderField.input.value }),
      onPick: (e) => { repoField.input.value = e.repo; folderField.input.value = e.folder ?? ''; refresh(); commit(); },
      onForget: (e) => { const next = forget(e); list = Array.isArray(next) ? next : list.filter((x) => x !== e); repoField.input.value = ''; folderField.input.value = ''; refresh(); },
    });
    pickerSlot.replaceChildren(...(picker ? [picker] : []));
  }

  let building = false;
  const step1 = mk(`① ${label('githubPublish.step1')}`, 'github-download', async () => {
    if (building) return;
    const s = state(); commit(); building = true; step1.disabled = true; say(label('githubPublish.building'));
    try {
      const blob = await build(kind, s.file);
      download(s.file, blob);
      const mb = (blob.size / (1024 * 1024)).toFixed(1);
      say(blob.size > WEB_UPLOAD_LIMIT ? label('githubPublish.tooBig', { name: s.file, mb }) : label('githubPublish.downloaded', { name: s.file, mb }));
    } catch (e) { say(label('githubPublish.error', { message: e?.message ?? String(e) })); }
    building = false; step1.disabled = false;
  }, { primary: true });

  const helpBtn = mk(label('githubPublish.help'), 'github-help', async () => {
    const s = state(); const text = helpPrompt({ lang, repo: s.repo, folder: s.folder ?? '', file: s.file });
    if (await copy(text)) { helpBox.style.display = 'none'; say(label('githubPublish.helpCopied')); } else { helpBox.value = text; helpBox.style.display = 'block'; helpBox.focus(); helpBox.select(); say(label('githubPublish.copyFailed')); }
  });
  const templateBtn = mk(label('githubPublish.useTemplate'), 'github-template', () => open(useTemplateUrl()));
  const seeTemplate = mk(label('githubPublish.seeTemplate'), 'github-see-template', () => open(templateUrl()));

  const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('githubPublish.title');
  const steps = row(); steps.append(step1, step2, copyAddress);
  let tracksRow = null;
  if (tracks) {
    tracksRow = row(); const sum = el('span', 'font-size:13px', { 'data-github-tracks': '' }); const paint = () => { sum.textContent = tracks.summary(); }; paint();
    tracksRow.append(sum, mk(label('githubPublish.tracks'), 'github-tracks', async () => { await tracks.choose(); paint(); }));
  }
  const closeRow = row(); closeRow.append(mk(label('githubPublish.close'), 'github-close', close));
  box.append(title, note(label('githubPublish.intro')), ...(kindRow ? [note(label('githubPublish.which')), kindRow] : []),
    pickerSlot, repoField.wrap, repoNote, folderField.wrap, folderNote, fileField.wrap, ...(tracksRow ? [tracksRow] : []), steps, stepMsg, note(label('githubPublish.addressIs')), address,
    note(label('githubPublish.noRepo'), 'margin-top:4px'), (() => { const r = row(); r.append(templateBtn, seeTemplate); return r; })(),
    note(label('githubPublish.helpHint')), helpBtn, helpBox, closeRow);
  document.body.append(veil);
  drawPicker();
  refresh();
  repoField.input.focus();
  return { close };
}
