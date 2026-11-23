/*
 * « Send to another teacher »: the piece being worked on becomes a LINK (`share/sharelink.js`). Three choices: what is sent (the score, or with its YouTube sync; audio only goes online), what the other
 * person gets (the editor, or the Lecteur read only) and the way: automatic (a link that carries the piece while it is short enough, else an online deposit), a direct link, or an online deposit. The deposit
 * is done by the person themself on the upload page of THEIR GitHub repository (like « Publish on GitHub »: no token ever goes through here); the link then points at the file. The piece put online is PUBLIC.
 */
import { chooseShareWay, buildShareLink, depositName, linkLengthFor, EDITOR_URL, READER_URL, LINK_LIMIT, SHARE_PARAM } from '../share/sharelink.js';
import { parseRepo, cleanFolder, uploadUrl, pageUrl, WEB_UPLOAD_LIMIT } from '../export/githubpublish.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { createRepoPicker } from './github-repo-picker.js';

const DEPOSIT_FOLDER = 'envois';

/**
 * @param o.contents  [{ id, text, hasAudio }] what can be sent (the score; the score with its sync)
 * @param o.build     (contentId) → Promise<Uint8Array> the .scorsaire archive
 * @param o.title     the title of the piece (the name of the deposited file)
 * @param o.repos     the kept repositories [{ repo, folder, name? }], most recent first ; o.saved: the single older memory { repo, folder } when no list is given
 * @param o.save      ({ repo, folder }) → the new list (or nothing) ; o.forget(entry) → the new list: takes one repository off the list
 *                    (a repository kept without a folder gets the folder « envois » here: a deposit goes to a folder of its own)
 * @param o.download  (name, blob) ; o.open (url) ; o.copy (text) → Promise<boolean> ; o.share (data) → Promise (the system share sheet) or null when the device has none
 */
export function openShareDialog({ label, contents, build, title = '', saved = null, repos = null, save = () => {}, forget = () => {}, download, open, copy, share = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-share-dialog': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(560px,98vw);max-height:${sheet ? '92vh' : '90vh'};overflow:auto;display:flex;flex-direction:column;gap:8px;border-radius:${sheet ? '12px 12px 0 0' : '8px'}`);
  box.setAttribute('data-resizable', 'shareDialog');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; commit(); done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { primary = false, on = false, disabled = false } = {}) => {
    const b = el('button', `min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);${primary || on ? 'background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; b.disabled = disabled; if (on) b.setAttribute('aria-pressed', 'true'); b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center');
  const note = (text, css = '') => { const d = el('div', `font-size:12px;color:var(--ink-soft,#555);${css}`); d.textContent = text; return d; };
  const field = (text, act, value, placeholder) => {
    const wrap = el('label', 'display:flex;flex-direction:column;gap:2px;font-size:13px');
    const input = el('input', 'min-height:var(--ui-target,36px);box-sizing:border-box;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:15px var(--ui-font,sans-serif)', { type: 'text', 'data-field': act, placeholder, autocomplete: 'off' });
    input.value = value; input.addEventListener('keydown', (e) => e.stopPropagation());
    wrap.append(text, input); return { wrap, input };
  };

  let list = repos ?? (saved ? [saved] : []);
  saved = list[0] ?? null;
  let content = contents[0].id; let mode = 'editor'; let way = 'auto';
  const bytesOf = new Map(); let busy = false; let problem = '';
  const repoField = field(label('share.repo'), 'repo', saved?.repo ?? '', label('share.repoPlaceholder'));
  const folderField = field(label('share.folder'), 'folder', saved?.folder || DEPOSIT_FOLDER, DEPOSIT_FOLDER);
  const fileName = depositName(title);
  const stepMsg = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-share-status': '' });
  const linkBox = el('textarea', 'width:100%;box-sizing:border-box;min-height:74px;font:12px ui-monospace,monospace;word-break:break-all', { readonly: '', 'data-share-link': '' });
  const info = el('div', 'font-size:13px;min-height:1.3em', { 'data-share-info': '' });
  const body = el('div', 'display:flex;flex-direction:column;gap:8px');
  const tell = (text) => { stepMsg.textContent = text; };

  const current = () => contents.find((c) => c.id === content);
  async function ensureBytes() {
    if (bytesOf.has(content)) return bytesOf.get(content);
    busy = true; problem = ''; draw();
    try { const bytes = await build(content); bytesOf.set(content, bytes); return bytes; } catch (e) { problem = String(e?.message ?? e); return null; } finally { busy = false; }
  }

  function draw() {
    const kids = [];
    kids.push(el('div', 'font-weight:var(--w-semi,600);font-size:16px', {}), note(label('share.hint')));
    kids[0].textContent = label('share.title');
    if (contents.length > 1) { const r = row(); for (const c of contents) r.append(mk(c.text, `share-content-${c.id}`, () => { content = c.id; refresh(); }, { on: content === c.id })); kids.push(note(label('share.what'), 'margin-top:2px'), r); }
    const modeRow = row();
    modeRow.append(mk(label('share.modeEditor'), 'share-mode-editor', () => { mode = 'editor'; draw(); }, { on: mode === 'editor' }), mk(label('share.modeReader'), 'share-mode-reader', () => { mode = 'reader'; draw(); }, { on: mode === 'reader' }));
    kids.push(note(label('share.mode'), 'margin-top:2px'), modeRow, note(label(mode === 'editor' ? 'share.modeEditorHint' : 'share.modeReaderHint')));
    const wayRow = row();
    for (const w of ['auto', 'link', 'deposit']) wayRow.append(mk(label(`share.way.${w}`), `share-way-${w}`, () => { way = w; draw(); }, { on: way === w }));
    kids.push(note(label('share.wayTitle'), 'margin-top:2px'), wayRow);
    const bytes = bytesOf.get(content);
    kids.push(info);
    if (busy) { info.textContent = label('share.preparing'); } else if (problem) { info.textContent = label('share.error', { message: problem }); } else if (bytes) {
      const c = current(); const pick = chooseShareWay({ way, byteLength: bytes.length, hasAudio: c.hasAudio, mode });
      const len = linkLengthFor(bytes.length, mode);
      info.textContent = label(pick.way === 'deposit' && pick.reason === 'chosen' ? 'share.reason.depositChosen' : `share.reason.${pick.reason}`, { n: len.toLocaleString(), limit: LINK_LIMIT.toLocaleString() });
      info.style.color = pick.reason === 'tooLong' && pick.way === 'link' ? 'var(--warn-ink,#9a5b00)' : '';
      kids.push(pick.way === 'link' ? linkPart(bytes) : depositPart(bytes));
    }
    kids.push(stepMsg);
    const foot = row(); foot.style.justifyContent = 'flex-end'; foot.append(mk(label('share.close'), 'share-close', close)); kids.push(foot);
    box.replaceChildren(...kids);
  }

  function linkPart(bytes) {
    const link = buildShareLink(bytes, { mode });
    linkBox.value = link;
    const r = row();
    r.append(mk(label('share.copy'), 'share-copy', async () => tell(label((await copy(link)) ? 'share.copied' : 'share.copyFailed'))), ...(share ? [mk(label('share.share'), 'share-share', async () => { try { await share({ title: title || 'Scorsaire', text: label('share.shareText'), url: link }); } catch { /* cancelled */ } })] : []), mk(label('share.test'), 'share-test', () => open(link)));
    const d = el('div', 'display:flex;flex-direction:column;gap:6px'); d.append(linkBox, r); return d;
  }

  /** Keeps the repository typed in the fields (once it is usable): when the upload page is opened and when the window closes — never while typing. */
  function commit() {
    const repo = parseRepo(repoField.input.value); const folder = cleanFolder(folderField.input.value);
    if (!repo || folder === null) return;
    const next = save({ repo: `${repo.owner}/${repo.repo}`, folder });
    if (Array.isArray(next)) list = next;
  }

  function depositPart(bytes) {
    const d = el('div', 'display:flex;flex-direction:column;gap:6px');
    const picker = createRepoPicker({
      label, repos: list, current: () => ({ repo: repoField.input.value, folder: folderField.input.value }),
      onPick: (e) => { repoField.input.value = e.repo; folderField.input.value = e.folder || DEPOSIT_FOLDER; draw(); },
      onForget: (e) => { const next = forget(e); list = Array.isArray(next) ? next : list.filter((x) => x !== e); repoField.input.value = ''; folderField.input.value = DEPOSIT_FOLDER; draw(); },
      folderOf: (e) => e.folder || DEPOSIT_FOLDER,
    });
    d.append(note(label('share.depositPublic'), 'color:var(--warn-ink,#9a5b00)'), ...(picker ? [picker] : []), repoField.wrap, folderField.wrap);
    const repo = parseRepo(repoField.input.value); const folder = cleanFolder(folderField.input.value);
    const ready = !!repo && folder !== null;
    const tooBig = bytes.length > WEB_UPLOAD_LIMIT;
    const address = el('output', 'display:block;word-break:break-all;font:13px ui-monospace,monospace;padding:6px;border:1px solid var(--edge,#bbb);border-radius:6px;background:var(--field,#fff);min-height:1.4em', { 'data-share-address': '' });
    const finalLink = ready ? `${mode === 'reader' ? READER_URL : EDITOR_URL}#file=${pageUrl({ owner: repo.owner, repo: repo.repo, folder: folder ?? '', file: fileName })}` : '';
    address.textContent = ready ? finalLink : label('share.needRepo');
    const steps = row();
    steps.append(
      mk(label('share.step1'), 'share-download', () => { download(fileName, new Blob([bytes], { type: 'application/zip' })); tell(label('share.downloaded', { name: fileName })); }, { disabled: tooBig }),
      mk(label('share.step2'), 'share-upload', () => { if (!ready) { tell(label('share.needRepo')); return; } commit(); open(uploadUrl({ owner: repo.owner, repo: repo.repo, folder: folder ?? '' })); }, { disabled: !ready }),
      mk(label('share.step3'), 'share-copy-address', async () => { if (ready) tell(label((await copy(finalLink)) ? 'share.copied' : 'share.copyFailed')); }, { disabled: !ready }));
    d.append(steps, note(label('share.stepsHint', { name: fileName })), address, ...(tooBig ? [note(label('share.tooBig'), 'color:var(--danger-ink,#a33)')] : []), note(label('share.wait')));
    for (const f of [repoField, folderField]) f.input.onchange = () => draw(); // (on leaving the field: redrawing at every key would take the focus away)
    return d;
  }

  async function refresh() { draw(); await ensureBytes(); draw(); }
  document.body.append(veil);
  refresh();
  return { close };
}
