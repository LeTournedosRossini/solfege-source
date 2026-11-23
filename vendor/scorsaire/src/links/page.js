/*
 * The page `liens/` of the public reader site: from the address of a `.scorsaire` it reads the tracks of the file and writes the links to send to pupils (one for everybody, one per track), with the
 * settings of the teacher in the address (see `links.js`). Nothing is sent anywhere: the file is read by the page itself (it must be served with CORS, like for the readers).
 */
import { readWorkBytes } from '../reader/core.js';
import { movementsOf, buildLinks, absoluteFile, TRANSPOSE_RANGE, NAME_MAX, repoInfoUrl, repoTreeUrl, scorsaireFiles, rawUrl, filterFiles, reposFromAddress } from './links.js';
import { parseRepo } from '../export/githubpublish.js';

const TEXT = {
  fr: {
    title: 'Faire un lien Scorsaire', intro: "Choisissez le lecteur, indiquez où se trouve votre fichier .scorsaire, puis réglez ce que vos élèves verront : le lien (un pour tous, un par piste) est écrit à mesure.",
    reader: 'Lecteur', file: 'Adresse du fichier', load: 'Lire le fichier',
    hint: "Un chemin sans « https:// » est compté depuis la racine de ce site. Le fichier doit être publié sur un site qui autorise les lectures depuis d'autres pages (ce site, ou raw.githubusercontent.com).",
    loading: 'Lecture du fichier…', failed: 'Impossible de lire ce fichier :', empty: "Indiquez l'adresse du fichier.",
    movement: 'Morceau', transpose: 'Transposition pour tous (demi-tons)', tracks: 'Pistes', shown: 'Affichée au départ', shift: "Transposition d'affichage", who: 'Nom de la personne', whoPh: 'ex. Alice',
    noSettings: "Les réglages de pistes (pistes affichées, transposition, noms) ne s'appliquent pas au lecteur de recueils : il ouvre le fichier tel quel.",
    youtubeNote: "Pour ce lecteur, la transposition pour tous ne s'applique pas (la vidéo ne change pas de ton) ; les réglages par piste valent pour les fragments de partition.",
    syncNote: "Avec ce lecteur, la transposition pour tous change aussi le son de l'enregistrement (au plus une octave) ; elle ne s'applique pas à une vidéo YouTube.",
    links: 'Liens à envoyer', everyone: 'Pour tout le monde', forTrack: 'Seulement la piste', copy: 'Copier', copied: 'Lien copié.', manual: 'Sélectionnez le lien et copiez-le.', tryIt: 'Essayer', less: 'Moins', more: 'Plus',
    r0: 'Recueil (setlist, hors ligne) : fichiers .scorsaire-recueil ou .scorsaire', r1: 'Synchro : partition qui suit un enregistrement ou une vidéo YouTube', r2: 'YouTube : fragments de partition sur une vidéo', r3: "Feuilles : les feuilles de l'écran 3",
    placeholder: 'synchros/ma-chanson.scorsaire  ou  https://…/ma-chanson.scorsaire',
    speed: 'Vitesse de départ (%)', loop: 'Boucle au départ', loopNone: 'Aucune', loopCustom: 'Mesures choisies', loopFrom: 'De la mesure', loopTo: 'à la mesure', muteTrack: 'Coupée au départ', muteOwn: "Dans le lien de chaque piste, couper cette piste (l'élève la joue lui-même)",
    preroll: 'Décompte avant la musique', click: 'Métronome', byReader: 'Selon le lecteur', pre0: 'Aucun', pre1: '1 mesure', pre2: '2 mesures', click0: 'Coupé', click1: 'Décompte seul', click2: 'Tout le temps',
    mine: 'Mes dépôts (envoyés par l\'éditeur)', other: 'Un autre dépôt…',
    preview: 'Aperçu', previewTitle: 'Aperçu du lien', previewPick: 'Aperçu de', previewClose: "Fermer l'aperçu", previewNote: "C'est le vrai lecteur, avec le lien : l'élève verra la même chose.",
    viewer: 'Visualiseur au départ', viewerNone: 'Aucun (replié)', viewerPiano: 'Clavier de piano', viewerGuitar: 'Manche de guitare', viewerSame: 'Comme le réglage général',
    lyrics: 'Paroles', lyricsAuto: 'Selon le lecteur (en strophes)', lyricsStrophes: 'En strophes', lyricsStaff: 'Sur la portée',
    repo: 'Dépôt GitHub public (facultatif)', repoPh: 'proprietaire/depot', browse: 'Parcourir', repoHint: "Cherche les fichiers .scorsaire de ce dépôt public ; choisissez-en un, il est lu tout de suite. Un dépôt privé ne peut pas être lu.", repoLoading: 'Lecture du dépôt…',
    repoBad: "Écrivez le dépôt sous la forme proprietaire/depot (ou collez son adresse GitHub).", repoMissing: 'Dépôt introuvable (ou privé).', repoLimit: "GitHub limite les lectures sans mot de passe : réessayez dans un moment.", repoFailed: 'Lecture du dépôt impossible :',
    repoNone: 'Aucun fichier .scorsaire dans ce dépôt.', repoCount: (n, t) => `${n} fichier${n > 1 ? 's' : ''} .scorsaire${t ? ' (liste peut-être incomplète)' : ''}`, repoFilter: 'Filtrer la liste',
  },
  en: {
    title: 'Make a Scorsaire link', intro: 'Choose the reader, say where your .scorsaire file is, then set what your pupils will see: the link (one for everybody, one per track) is written as you go.',
    reader: 'Reader', file: 'Address of the file', load: 'Read the file',
    hint: 'A path without « https:// » is counted from the root of this site. The file must be published on a site that allows reads from other pages (this site, or raw.githubusercontent.com).',
    loading: 'Reading the file…', failed: 'This file cannot be read:', empty: 'Give the address of the file.',
    movement: 'Piece', transpose: 'Transposition for everybody (semitones)', tracks: 'Tracks', shown: 'Shown first', shift: 'Display transposition', who: 'Name of the player', whoPh: 'e.g. Alice',
    noSettings: 'The track settings (tracks shown, transposition, names) do not apply to the songbook reader: it opens the file as it is.',
    youtubeNote: 'With this reader the transposition for everybody does not apply (the video does not change key); the per-track settings apply to the fragments of score.',
    syncNote: 'With this reader the transposition for everybody also changes the sound of the recording (an octave at most); it does not apply to a YouTube video.',
    links: 'Links to send', everyone: 'For everybody', forTrack: 'Only the track', copy: 'Copy', copied: 'Link copied.', manual: 'Select the link and copy it.', tryIt: 'Try', less: 'Less', more: 'More',
    r0: 'Songbook (setlist, offline): .scorsaire-recueil or .scorsaire files', r1: 'Sync: a score that follows a recording or a YouTube video', r2: 'YouTube: fragments of score on a video', r3: 'Sheets: the sheets of screen 3',
    placeholder: 'synchros/my-song.scorsaire  or  https://…/my-song.scorsaire',
    speed: 'Starting speed (%)', loop: 'Loop at the start', loopNone: 'None', loopCustom: 'Chosen measures', loopFrom: 'From measure', loopTo: 'to measure', muteTrack: 'Muted at the start', muteOwn: 'In the link of each track, mute that track (the pupil plays it herself)',
    preroll: 'Count-in before the music', click: 'Metronome', byReader: 'As the reader has it', pre0: 'None', pre1: '1 measure', pre2: '2 measures', click0: 'Off', click1: 'Count-in only', click2: 'All the time',
    mine: 'My repositories (sent by the editor)', other: 'Another repository…',
    preview: 'Preview', previewTitle: 'Preview of the link', previewPick: 'Preview of', previewClose: 'Close the preview', previewNote: 'This is the real reader with the link: the pupil will see the same.',
    viewer: 'Viewer at the start', viewerNone: 'None (folded)', viewerPiano: 'Piano keyboard', viewerGuitar: 'Guitar fretboard', viewerSame: 'As the general setting',
    lyrics: 'Lyrics', lyricsAuto: 'As the reader has it (strophes)', lyricsStrophes: 'By strophes', lyricsStaff: 'On the staff',
    repo: 'Public GitHub repository (optional)', repoPh: 'owner/repository', browse: 'Browse', repoHint: 'Looks for the .scorsaire files of this public repository; pick one and it is read at once. A private repository cannot be read.', repoLoading: 'Reading the repository…',
    repoBad: 'Write the repository as owner/repository (or paste its GitHub address).', repoMissing: 'Repository not found (or private).', repoLimit: 'GitHub limits reads without a password: try again in a moment.', repoFailed: 'The repository cannot be read:',
    repoNone: 'No .scorsaire file in this repository.', repoCount: (n, t) => `${n} .scorsaire file${n > 1 ? 's' : ''}${t ? ' (the list may be incomplete)' : ''}`, repoFilter: 'Filter the list',
  },
};
const lang = /^fr/i.test(globalThis.navigator?.language ?? 'fr') ? 'fr' : 'en';
const T = TEXT[lang];

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) n.append(kid);
  return n;
};
const site = new URL('../', location.href); // this page is in a folder of the site: the root is one level up

const state = { work: null, movements: [], movementId: null, transpose: 0, shown: new Set(), shifts: {}, who: {}, loaded: '', preview: null, previewClosed: false, viewer: null, viewerOf: {}, lyrics: null, speed: 100, loopFrom: null, loopTo: null, mute: new Set(), muteOwn: false, preroll: null, click: null };

function boot() {
  document.documentElement.lang = lang;
  document.title = T.title;
  $('t-title').textContent = T.title; $('t-intro').textContent = T.intro; $('t-reader').textContent = T.reader; $('t-file').textContent = T.file; $('t-hint').textContent = T.hint;
  $('load').textContent = T.load; $('file').placeholder = T.placeholder;
  [...$('reader').options].forEach((o, i) => { o.textContent = T[`r${i}`]; });
  mountRepoBox();
  $('load').addEventListener('click', load);
  $('file').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } });
  $('reader').addEventListener('change', render);
  const params = new URLSearchParams(location.search); // a page address may bring the file (`?file=`) and the reader (`?reader=feuilles`)
  const r = params.get('reader'); if (r) { const i = [...$('reader').options].findIndex((o) => o.value === `${r.replace(/\/$/, '')}/`); if (i >= 0) $('reader').selectedIndex = i; }
  if (params.get('file')) { $('file').value = params.get('file'); load(); } else render();
}

const REPO_KEY = 'scorsaire.liens.repo';
const store = { get() { try { return localStorage.getItem(REPO_KEY) ?? ''; } catch { return ''; } }, set(v) { try { localStorage.setItem(REPO_KEY, v); } catch { /* no storage: not kept */ } } };

/** « Browse a repository »: the `.scorsaire` files of a public GitHub repository, listed so that one can be picked instead of typing its address. */
function mountRepoBox() {
  const mine = reposFromAddress(location); // the repositories the editor handed over
  const input = el('input', { type: 'text', id: 'repo', placeholder: T.repoPh, autocomplete: 'off', spellcheck: 'false', value: mine[0] ? `${mine[0].owner}/${mine[0].repo}` : store.get() });
  const go = el('button', { type: 'button', id: 'browse' }, T.browse);
  const status = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite', id: 'repo-msg' });
  const filter = el('input', { type: 'text', id: 'repo-filter', placeholder: T.repoFilter, 'aria-label': T.repoFilter, hidden: true });
  const list = el('div', { id: 'repo-list' });
  let repo = null; let branch = ''; let files = []; let truncated = false;
  const draw = () => {
    list.replaceChildren();
    const shown = filterFiles(files, filter.value).slice(0, 300);
    for (const f of shown) {
      list.append(el('button', { type: 'button', class: 'pick', title: f.path, onclick: () => { $('file').value = rawUrl(repo, branch, f.path); load(); } },
        el('span', { class: 'nm' }, f.name), f.folder ? el('span', { class: 'fd' }, f.folder) : null));
    }
  };
  async function browse() {
    const parsed = parseRepo(input.value);
    list.replaceChildren(); filter.hidden = true; filter.value = '';
    if (!parsed) { status.textContent = T.repoBad; return; }
    status.textContent = T.repoLoading;
    try {
      const info = await fetch(repoInfoUrl(parsed));
      if (info.status === 404) throw Object.assign(new Error('missing'), { code: 'missing' });
      if (info.status === 403 || info.status === 429) throw Object.assign(new Error('limit'), { code: 'limit' });
      if (!info.ok) throw new Error(String(info.status));
      branch = (await info.json()).default_branch || 'main';
      const res = await fetch(repoTreeUrl(parsed, branch));
      if (res.status === 403 || res.status === 429) throw Object.assign(new Error('limit'), { code: 'limit' });
      if (!res.ok) throw new Error(String(res.status));
      const tree = await res.json();
      repo = parsed; files = scorsaireFiles(tree); truncated = !!tree.truncated;
      store.set(`${parsed.owner}/${parsed.repo}`);
      status.textContent = files.length ? T.repoCount(files.length, truncated) : T.repoNone;
      filter.hidden = files.length < 8; draw();
    } catch (e) { status.textContent = e.code === 'missing' ? T.repoMissing : e.code === 'limit' ? T.repoLimit : `${T.repoFailed} ${e.message}`; }
  }
  go.addEventListener('click', browse);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); browse(); } });
  filter.addEventListener('input', draw);
  const menu = mine.length ? el('select', { id: 'repo-mine', 'aria-label': T.mine }, ...mine.map((r) => el('option', { value: `${r.owner}/${r.repo}` }, `${r.owner}/${r.repo}`)), el('option', { value: '' }, T.other)) : null;
  menu?.addEventListener('change', () => { if (menu.value) { input.value = menu.value; browse(); } else { input.value = ''; input.focus(); } });
  const box = el('div', { id: 'repo-box' }, el('label', { for: 'repo' }, mine.length ? T.mine : T.repo), menu, input, el('p', { class: 'hint' }, T.repoHint), go, status, filter, list);
  $('t-file').before(box);
  if (mine.length === 1) browse(); // a single repository: its files are listed at once
}

async function load() {
  const abs = absoluteFile($('file').value, site);
  const msg = $('msg');
  if (!abs) { msg.textContent = T.empty; return; }
  msg.textContent = T.loading;
  try {
    const r = await fetch(abs);
    if (!r.ok) throw new Error(String(r.status));
    const { work } = await readWorkBytes(new Uint8Array(await r.arrayBuffer()));
    state.work = work; state.movements = movementsOf(work); state.movementId = state.movements[0]?.id ?? null;
    state.transpose = 0; state.shown = new Set(); state.shifts = {}; state.who = {}; state.loaded = abs;
    Object.assign(state, { viewer: null, viewerOf: {}, lyrics: null, speed: 100, loopFrom: null, loopTo: null, mute: new Set(), muteOwn: false, preroll: null, click: null });
    state.shown = new Set((state.movements[0]?.tracks ?? []).map((t) => t.id));
    msg.textContent = '';
  } catch (e) { state.work = null; state.loaded = ''; msg.textContent = `${T.failed} ${e?.message ?? e}`; }
  render();
}

const movement = () => state.movements.find((m) => m.id === state.movementId) ?? null;

function stepper(value, onChange, label, { step = 1, min = -TRANSPOSE_RANGE, max = TRANSPOSE_RANGE, signed = true } = {}) {
  const v = el('output', { class: 'val', 'aria-live': 'polite' }, signed && value > 0 ? `+${value}` : String(value));
  const mk = (txt, d, name) => el('button', { type: 'button', class: 'stp', 'aria-label': `${label} : ${name}`, onclick: () => onChange(Math.max(min, Math.min(max, value + d * step))) }, txt);
  return el('span', { class: 'stepper' }, mk('−', -1, T.less), v, mk('+', 1, T.more));
}

/** A menu of choices; `value` is what is chosen now (null = the reader's own). */
function choice(label, options, value, onChange) {
  const sel = el('select', { 'aria-label': label }, ...options.map(([v, text]) => el('option', { value: v === null ? '' : String(v) }, text)));
  sel.value = value === null ? '' : String(value);
  sel.addEventListener('change', () => onChange(sel.value === '' ? null : sel.value));
  return sel;
}

function render() {
  const box = $('settings'); const outBox = $('links'); box.replaceChildren(); outBox.replaceChildren();
  if (!state.work) return;
  const readerValue = $('reader').value;
  const supports = ['feuilles/', 'synchro/', 'youtube/'].includes(readerValue);
  if (!supports) box.append(el('p', { class: 'hint warn' }, T.noSettings));
  else if (readerValue === 'youtube/') box.append(el('p', { class: 'hint warn' }, T.youtubeNote));
  else if (readerValue === 'synchro/') box.append(el('p', { class: 'hint warn' }, T.syncNote));
  if (!supports) { renderLinks(); return; }
  if (state.movements.length > 1) {
    const sel = el('select', { id: 'movement', 'aria-label': T.movement }, ...state.movements.map((m) => el('option', { value: m.id }, m.title)));
    sel.value = state.movementId;
    sel.addEventListener('change', () => { state.movementId = sel.value; state.shown = new Set(movement().tracks.map((t) => t.id)); render(); });
    box.append(el('label', { for: 'movement' }, T.movement), sel);
  }
  if (supports && readerValue !== 'youtube/') box.append(el('label', {}, T.transpose), stepper(state.transpose, (n) => { state.transpose = n; render(); }, T.transpose));
  const mv = movement();
  if (supports) box.append(el('label', {}, T.lyrics), choice(T.lyrics, [[null, T.lyricsAuto], ['strophes', T.lyricsStrophes], ['staff', T.lyricsStaff]], state.lyrics, (v) => { state.lyrics = v; renderLinks(); })); // every reader that shows words
  if (readerValue !== 'youtube/') {
    box.append(el('label', {}, T.speed), stepper(state.speed, (n) => { state.speed = n; render(); }, T.speed, { step: 5, min: 25, max: 200, signed: false }));
    // the loop: a section of the piece, or two measures of one's choice (numbers as the score counts them from 1)
    const secs = mv?.sections ?? []; const n = mv?.measures.length ?? 0;
    const cur = state.loopFrom && state.loopTo ? (secs.findIndex((s) => s.from + 1 === state.loopFrom && s.to + 1 === state.loopTo) >= 0 ? `s${secs.findIndex((s) => s.from + 1 === state.loopFrom && s.to + 1 === state.loopTo)}` : 'custom') : 'none';
    const loopSel = choice(T.loop, [['none', T.loopNone], ...secs.map((s, i) => [`s${i}`, `${s.label} (${s.from + 1}–${s.to + 1})`]), ['custom', T.loopCustom]], cur, (v) => {
      if (v === 'none') { state.loopFrom = null; state.loopTo = null; } else if (v === 'custom') { state.loopFrom = state.loopFrom ?? 1; state.loopTo = state.loopTo ?? Math.min(n, 4); } else { const s = secs[Number(v.slice(1))]; state.loopFrom = s.from + 1; state.loopTo = s.to + 1; }
      render();
    });
    box.append(el('label', {}, T.loop), loopSel);
    if (cur !== 'none') {
      const num = (value, set, name) => { const i = el('input', { type: 'number', min: '1', max: String(n), value: String(value), 'aria-label': name, style: 'width:6em' }); i.addEventListener('change', () => { set(Math.max(1, Math.min(n, Math.round(Number(i.value) || 1)))); render(); }); return i; };
      box.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, T.loopFrom), num(state.loopFrom, (x) => { state.loopFrom = x; if (state.loopTo < x) state.loopTo = x; }, T.loopFrom), el('span', { class: 'lbl' }, T.loopTo), num(state.loopTo, (x) => { state.loopTo = x; if (state.loopFrom > x) state.loopFrom = x; }, T.loopTo)));
    }
    box.append(el('label', {}, T.preroll), choice(T.preroll, [[null, T.byReader], [0, T.pre0], [1, T.pre1], [2, T.pre2]], state.preroll, (v) => { state.preroll = v === null ? null : Number(v); renderLinks(); }));
    box.append(el('label', {}, T.click), choice(T.click, [[null, T.byReader], ['off', T.click0], ['pre', T.click1], ['always', T.click2]], state.click, (v) => { state.click = v; renderLinks(); }));
    if (readerValue === 'feuilles/') { // the viewer (piano or fretboard) unfolded at the start: the same for the link of everybody, or one of its own for the link of a track
      box.append(el('label', {}, T.viewer), choice(T.viewer, [[null, T.viewerNone], ['piano', T.viewerPiano], ['guitar', T.viewerGuitar]], state.viewer, (v) => { state.viewer = v; renderLinks(); }));
    }
    if ((mv?.tracks.length ?? 0) > 1) {
      const own = el('input', { type: 'checkbox', checked: state.muteOwn, 'aria-label': T.muteOwn });
      own.addEventListener('change', () => { state.muteOwn = own.checked; renderLinks(); });
      box.append(el('label', { class: 'row' }, own, el('span', {}, T.muteOwn)));
    }
  }
  box.append(el('label', {}, T.tracks));
  for (const t of mv?.tracks ?? []) {
    const on = state.shown.has(t.id);
    const cb = el('input', { type: 'checkbox', checked: on, 'aria-label': `${T.shown} : ${t.name}` });
    cb.addEventListener('change', () => { if (cb.checked) state.shown.add(t.id); else state.shown.delete(t.id); renderLinks(); });
    const name = el('input', { type: 'text', value: state.who[t.id] ?? '', maxlength: String(NAME_MAX), placeholder: T.whoPh, 'aria-label': `${T.who} : ${t.name}` });
    name.addEventListener('input', () => { state.who[t.id] = name.value; renderLinks(); });
    const mu = readerValue === 'youtube/' ? null : el('input', { type: 'checkbox', checked: state.mute.has(t.id), 'aria-label': `${T.muteTrack} : ${t.name}` });
    mu?.addEventListener('change', () => { if (mu.checked) state.mute.add(t.id); else state.mute.delete(t.id); renderLinks(); });
    box.append(el('div', { class: 'card', 'data-track': t.id },
      el('label', { class: 'row' }, cb, el('strong', {}, t.name)),
      mu ? el('label', { class: 'row' }, mu, el('span', { class: 'lbl' }, T.muteTrack)) : null,
      readerValue === 'feuilles/' ? el('div', { class: 'row' }, el('span', { class: 'lbl' }, T.viewer), choice(`${T.viewer} : ${t.name}`, [[null, T.viewerSame], ['none', T.viewerNone], ['piano', T.viewerPiano], ['guitar', T.viewerGuitar]], state.viewerOf[t.id] ?? null, (v) => { if (v === null) delete state.viewerOf[t.id]; else state.viewerOf[t.id] = v; renderLinks(); })) : null,
      el('div', { class: 'row' }, el('span', { class: 'lbl' }, T.shift), stepper(state.shifts[t.id] ?? 0, (n) => { state.shifts[t.id] = n; render(); }, `${T.shift} ${t.name}`)),
      name));
  }
  renderLinks();
}

function renderLinks() {
  const outBox = $('links'); outBox.replaceChildren();
  const mv = movement(); if (!mv) return;
  const feuilles = ['feuilles/', 'synchro/', 'youtube/'].includes($('reader').value); // the readers that take the settings of the tracks
  const reader = new URL($('reader').value, site).href;
  const all = mv.tracks.map((t) => t.id);
  const shown = [...state.shown].filter((id) => all.includes(id));
  const opts = {
    reader, file: state.loaded, movement: state.movements.length > 1 ? mv.id : null, trackList: mv.tracks,
    ...(feuilles && $('reader').value !== 'youtube/' ? { speed: state.speed, loop: state.loopFrom && state.loopTo ? { from: mv.measures[state.loopFrom - 1], to: mv.measures[state.loopTo - 1] } : null, mute: [...state.mute].filter((id) => all.includes(id)), muteOwn: state.muteOwn, preroll: state.preroll, click: state.click, viewer: $('reader').value === 'feuilles/' ? state.viewer : null, viewerOf: $('reader').value === 'feuilles/' ? state.viewerOf : {} } : {}),
    ...(feuilles ? { lyrics: state.lyrics, transpose: $('reader').value === 'youtube/' ? 0 : state.transpose, tracks: shown.length && shown.length < all.length ? shown : null, shifts: state.shifts, who: state.who } : {}),
  };
  const list = feuilles ? buildLinks(opts) : buildLinks({ ...opts, trackList: [] });
  outBox.append(el('h2', {}, T.links));
  for (const item of list) {
    const label = item.id ? `${T.forTrack} « ${mv.tracks.find((t) => t.id === item.id)?.name} »${state.who[item.id]?.trim() ? ` · ${state.who[item.id].trim()}` : ''}` : T.everyone;
    const out = el('output', { class: 'out', tabindex: '0' }, item.link);
    outBox.append(el('div', { class: 'card', 'data-link-for': item.id ?? '' },
      el('strong', {}, label), out,
      el('div', { class: 'row' },
        el('button', { type: 'button', onclick: () => { state.preview = item.id ?? ''; state.previewClosed = false; renderLinks(); $('preview').scrollIntoView({ block: 'nearest' }); } }, T.preview),
        el('button', { type: 'button', onclick: () => copy(item.link) }, T.copy),
        el('button', { type: 'button', onclick: () => window.open(item.link, '_blank', 'noopener') }, T.tryIt))));
  }
  if (state.preview === null && !state.previewClosed && matchMedia('(min-width: 1000px)').matches) state.preview = ''; // a wide screen has room for it: shown at once, for everybody
  updatePreview(list, mv);
}

// ---------- the preview: the REAL reader in a frame, at the address of the link (so it cannot differ from what the pupil gets) ----------
let previewTimer = 0;
function updatePreview(list, mv) {
  const box = $('preview');
  if (state.preview === null || !list.length) { box.replaceChildren(); clearTimeout(previewTimer); return; }
  if (!list.some((l) => (l.id ?? '') === state.preview)) state.preview = ''; // the track is gone (another piece): the whole piece
  const item = list.find((l) => (l.id ?? '') === state.preview);
  let frame = box.querySelector('iframe');
  if (!frame) {
    const pick = el('select', { 'aria-label': T.previewPick });
    pick.addEventListener('change', () => { state.preview = pick.value; renderLinks(); });
    box.replaceChildren(
      el('h2', {}, T.previewTitle),
      el('div', { class: 'row' }, pick, el('button', { type: 'button', onclick: () => { state.preview = null; state.previewClosed = true; renderLinks(); } }, T.previewClose)),
      el('p', { class: 'hint' }, T.previewNote),
      el('iframe', { title: T.previewTitle, allow: 'autoplay; fullscreen', referrerpolicy: 'no-referrer', class: 'frame' }));
    frame = box.querySelector('iframe');
  }
  const pick = box.querySelector('select');
  pick.replaceChildren(...list.map((l) => el('option', { value: l.id ?? '' }, l.id ? (mv.tracks.find((t) => t.id === l.id)?.name ?? l.id) : T.everyone)));
  pick.value = state.preview;
  if (frame.dataset.link === item.link) return;
  clearTimeout(previewTimer); // the settings change one key at a time: the heavy page is loaded once the person pauses
  previewTimer = setTimeout(() => { frame.dataset.link = item.link; frame.src = item.link; }, frame.dataset.link ? 600 : 0);
}

function copy(text) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { $('msg').textContent = T.copied; }, () => { $('msg').textContent = T.manual; });
}

boot();
