/*
 * Scorsaire LECTEUR: the read-only application that opens a RECUEIL (songbook / setlist, model/recueil.js) — works embedded in one file — and shows it page by page on a
 * tablet or an e-reader. It changes no work: it shows them, lets the person reorder them and adjust the reading (display transposition, zoom), keeps all that on the device
 * and can write it back into a recueil. A tap on the right three quarters of the screen goes to the next page (at the end of a song: the next song), a tap on the left
 * quarter goes back; a swipe down from the top edge brings the menu. Pedals and keyboards work (arrows, page keys, space, F5 / F6, media keys).
 */
import { mountThemeToggle } from '../reader/theme-toggle.js';
import { createI18n } from '../i18n/index.js';
import { loadWork } from '../model/serialize.js';
import { registerAsset } from '../model/assets.js';
import { isScorsaireArchive, readScorsaireArchive } from '../model/container.js';
import { bytesFromParams } from '../share/sharelink.js';
import { shiftForDisplay } from '../layout/displayshift.js';
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';
import {
  createRecueil, addEntry, moveEntry, setEntrySettings, serializeRecueil, parseRecueil, isRecueilText, TRANSPOSE_MIN, TRANSPOSE_MAX, ZOOM_MIN, ZOOM_MAX,
} from '../model/recueil.js';
import { drawAutoPages, showAutoPage, readerTweak, EDGE_MARGIN } from './autopages.js';
import { pickCanvas, partForReading, AUTO, NONE } from './canvaspick.js';
import { canvasesOf, partsOfCanvas } from '../model/partedit.js';
import { readerSettingsOf, CARD_MODES, SPACING_MIN, SPACING_MAX, CARD_SCALE_MIN, CARD_SCALE_MAX, CARD_GAP_MIN, CARD_GAP_MAX } from '../model/partreader.js';
import { layoutPart } from '../layout/index.js';
import { tintSigns } from '../layout/sheetlayout.js';

const SIGNS_RED = '#c0392b'; // the colour of the structure signs (repeat bars, voltas, segno / coda, time signature) when the person asks for them, as iReal Pro does: the same red as the sheets of the editor
import { pageSvg } from '../render/pagesvg.js';
import glyphs from '../glyphs/bravura-subset.json' with { type: 'json' };
import { CONTAINER_CATEGORIES, DEFAULT_CONTAINERS } from './containerfilter.js';
import { getItem, setItem } from './store.js';
import { KINDS, ALL_TRACKS, nameOf, resolveShown, shownNames, kindsPresent, roleForKind } from './content.js';
import { buildSongbook } from './songbook.js';
import { looksLikeChordPro } from './chordpro.js';
import { chordProToWorkText, songbookToChordPro } from './chordpro-work.js';
import { drawSongbook } from './songbook-dom.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { ensureStyle, btn, choices, stepper, switchButton, row, title, note, openSheet, lockButton } from './ui.js';
import { openSongList } from './songlist.js';
import { flashPlan, flashLevel } from './metronome.js';
import { mountThemeColor } from '../ui/theme-color.js';

const lang = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2);
const t = createI18n(['fr', 'en'].includes(lang) ? lang : 'fr');
const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', 'F5', ' ', 'MediaTrackNext'];
const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'F6', 'MediaTrackPrevious'];
const LEFT_ZONE = 0.25; // the left quarter goes back, the rest goes forward
const safeStorage = () => { try { const s = window.localStorage; s.getItem('x'); return s; } catch { return null; } };

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};

const dataUriBytes = (uri) => Uint8Array.from(atob(String(uri).split(',')[1] ?? ''), (c) => c.charCodeAt(0));
const download = (name, text, mime = 'application/json') => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name }); document.body.append(a); a.click(); a.remove(); };

function boot() {
  const host = document.getElementById('app');
  host.style.cssText = 'position:fixed;inset:0;overflow:hidden;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent';
  let recueil = null; let songs = []; let cur = { song: 0, page: 0 }; let pages = []; let shown = null;
  const works = new Map(); // entry id → loaded work (the pictures of its blocks registered)
  let menuOpen = false;
  let locked = true; // the order and the transposition only change after a LONG press on the padlock (never by a stray touch on stage); locked again when the menu closes
  let prefs = { kinds: [], picked: [], names: {}, regular: null, perRow: 0, lyrics: false, lyricChords: 'first', musicScale: 1, musicOnly: false, lyricScale: 1, grid: 'off', gridBase: 'common', gridChords: 2, gridStretch: 'off', lyricColumns: 'auto', lyricCards: false, lyricChorus: 'italic', lyricBreaks: 'verses', canvas: AUTO, containers: null, role: null, cards: null, spacing: null, cardScale: null, cardGap: null, tempo: null, signs: false, signsColor: SIGNS_RED, chordView: 'author', asked: false }; // what to show (kinds of track) and the remembered answers by track name: kept on THIS device
  let viewAll = false; // "see the other tracks too": for this session only, the kinds kept on the device stay as they are
  const savePrefs = () => setItem('prefs', prefs);
  const clampScale = (v) => (typeof v === 'number' && v >= 0.5 && v <= 2 ? Math.round(v * 10) / 10 : 1); // the size of the writing and of the lyrics (50 to 200 %)
  const scaleStep = (v, d) => Math.max(0.5, Math.min(2, Math.round((v + d * 0.1) * 10) / 10));
  /** Columns of the lyrics view: the person's choice ('1' | '2'), by default two on a wide screen; a phone (under 600 px) always has one. */
  const PHONE_WIDTH = 600; const WIDE_WIDTH = 900;
  const effectiveColumns = (width) => (width < PHONE_WIDTH ? 1 : prefs.lyricColumns === '2' ? 2 : prefs.lyricColumns === '1' ? 1 : width >= WIDE_WIDTH ? 2 : 1);
  /** Regular measures (a chord-grid look): the person's choice, or by default on when ONLY the chord grid is shown. */
  // the settings the author prepared for the Lecteur in the layout of screen 2 that suits this song (`cur.rs`) sit UNDER the person's own choices of this device
  const effectiveRegular = () => prefs.regular ?? cur.rs?.regular ?? (prefs.kinds.length === 1 && prefs.kinds[0] === 'grid');
  const effectivePerRow = () => (prefs.perRow > 0 ? prefs.perRow : prefs.perRow < 0 ? 0 : cur.rs?.perRow ?? 0); // (a negative value = the person asked for "auto" on purpose)
  const effectiveCards = () => prefs.cards ?? cur.rs?.cards ?? null; // (null: the author's own choice on a fixed page, none on the Lecteur's own pages)
  const effectiveSpacing = () => prefs.spacing ?? cur.rs?.spacing ?? 1;
  const effectiveCardScale = () => prefs.cardScale ?? cur.rs?.cardScale ?? 1;
  const effectiveTempo = () => prefs.tempo ?? cur.rs?.tempo ?? false; // (the tempo texts are left out of the Lecteur's pages unless asked for)
  const effectiveCardGap = () => prefs.cardGap ?? cur.rs?.cardGap ?? 1;
  const effectiveContainers = () => prefs.containers ?? cur.rs?.containers ?? DEFAULT_CONTAINERS;

  const stage = el('div', { 'data-lc-stage': '', style: 'position:absolute;inset:0;overflow:hidden;user-select:none;-webkit-user-select:none' });
  host.style.touchAction = 'none';
  const handle = el('div', { 'data-lc-handle': '', title: t('lecteur.menu'), 'aria-label': t('lecteur.menu'), style: 'position:absolute;left:0;right:0;top:0;height:14px;z-index:20;cursor:pointer;display:flex;justify-content:center' }, el('span', { style: 'margin-top:4px;width:44px;height:4px;border-radius:2px;background:var(--ink,#000);opacity:.18' }));
  const status = el('div', { 'data-lc-status': '', style: 'position:absolute;left:0;right:0;bottom:1px;z-index:10;text-align:center;font-size:12px;line-height:1.1;opacity:.45;pointer-events:none' });
  const menu = el('div', { 'data-lc-menu': '', role: 'dialog', 'aria-label': t('lecteur.menu'), style: 'position:absolute;left:0;right:0;top:0;max-height:92%;overflow:auto;z-index:30;background:var(--paper,#faf8f4);color:var(--ink,#1c1b1a);border-bottom:1px solid var(--line,#ccc);box-shadow:0 8px 24px rgba(0,0,0,.25);transform:translateY(-105%);transition:transform .18s;padding:10px 14px 14px' });
  host.append(stage, handle, status, menu);
  const theme = mountThemeToggle({ storage: safeStorage(), label: (next) => t(next === 'dark' ? 'reader.themeDark' : next === 'hc' ? 'reader.themeHc' : 'reader.themeLight') });
  mountThemeColor(); // the title bar of the installed window follows the theme
  // the button lives in the menu only (drawMenu places it); until the menu is drawn it must not sit in the page
  if (theme) { theme.style.cssText = 'position:static;width:auto;min-width:40px;height:40px;opacity:1'; theme.remove(); }

  // ---------- the songs of the recueil: one per movement of every work ----------
  const workOf = (entry) => {
    if (!works.has(entry.id)) {
      for (const [id, p] of Object.entries(entry.images ?? {})) { try { registerAsset({ id, mime: p.mime, bytes: dataUriBytes(p.data) }); } catch { /* a damaged picture: its frame stays empty */ } }
      works.set(entry.id, loadWork(entry.work));
    }
    return works.get(entry.id);
  };
  const buildSongs = () => {
    songs = [];
    recueil?.entries.forEach((entry, entryIndex) => {
      let work; try { work = workOf(entry); } catch { return; }
      work.movements.forEach((mv, movementIndex) => {
        const base = entry.title || work.props?.[PID.TITLE] || t('reader.untitled');
        const sub = getProperty(mv, PID.TITLE);
        songs.push({ entry, entryIndex, movementIndex, title: work.movements.length > 1 && sub ? `${base} — ${sub}` : base });
      });
    });
  };

  const persist = () => { if (recueil) setItem('recueil', serializeRecueil(recueil)); setItem('position', { entry: songs[cur.song]?.entry.id ?? null, movement: songs[cur.song]?.movementIndex ?? 0 }); };

  // ---------- drawing one page ----------
  const pageHeight = () => host.clientHeight - 6;
  const showPage = (index) => {
    cur.page = Math.max(0, Math.min(index, pages.length - 1));
    const p = pages[cur.page]; const box = shown?.box;
    if (p?.svg) { drawFixedPage(p); return; }
    if (!box || !p) return;
    showAutoPage(stage.firstChild, shown, p, pageHeight());
    status.textContent = `${songs[cur.song]?.title ?? ''}${cur.scope ? ` · ${cur.scope}` : ''} · ${t('lecteur.pageOf', { n: cur.page + 1, total: pages.length })} · ${cur.song + 1}/${songs.length}`;
  };
  // a page fixed by the author (a canvas layout of screen 2): one page of the part per screen, scaled to the screen; the layout of a part is kept (works never change here)
  const fixedLayouts = new Map();
  const canvasPick = (song, choice, width, height, needFit) => {
    const work = workOf(song.entry);
    return pickCanvas(work, work.movements[song.movementIndex], { screen: { width, height }, tracks: choice.tracks, choice: prefs.canvas, role: prefs.role, needFit });
  };
  const signsKey = () => (prefs.signs ? prefs.signsColor : '');
  /** The author's pages with the structure signs coloured (when asked): the layouts are kept, so the colour is part of their key. */
  const tintedPages = (res) => { if (prefs.signs) for (const p of res.pages) tintSigns(p.layout, prefs.signsColor); return res; };
  const fixedPagesOf = (song, pick) => {
    const work = workOf(song.entry);
    const transpose = song.entry.settings?.transpose ?? 0; // the display transposition of the song: the author's pages are laid out again with it (same breaks)
    const key = `${song.entry.id}|${pick.part.id}|${prefs.cards}|${prefs.spacing}|${prefs.cardScale}|${prefs.cardGap}|${prefs.tempo}|${signsKey()}|${prefs.chordView}|${transpose}`; // (what the person changes on top of the layout is part of what was laid out)
    cur.scope = [pick.canvas.name, pick.part.props[PID.NAME]].filter(Boolean).join(' · ') || cur.scope; // the layout the author made, then the tracks read when it has no name
    if (fixedLayouts.size > 24) fixedLayouts.delete(fixedLayouts.keys().next().value); // (a person who tries every transposition does not keep every layout)
    if (!fixedLayouts.has(key)) fixedLayouts.set(key, tintedPages(layoutPart(work, partForReading(pick.part, transpose, { chordView: prefs.chordView }), glyphs, { partName: pick.part.props[PID.NAME] ?? '', today: '', tweak: readerTweak({ cards: prefs.cards, spacing: prefs.spacing ?? 1, cardScale: prefs.cardScale ?? 1, cardGap: prefs.cardGap ?? 1, tempo: effectiveTempo() }) })));
    const res = fixedLayouts.get(key);
    const mine = res.pages.filter((p) => p.movementIndex === song.movementIndex);
    return mine.length ? mine.map((p) => ({ svg: pageSvg(p, res.geometry, glyphs, { dark: document.documentElement.hasAttribute('data-dark') }), widthMm: res.geometry.widthMm, heightMm: res.geometry.heightMm })) : null;
  };
  const drawFixedPage = (p) => {
    const W = host.clientWidth; const H = pageHeight();
    const k = Math.min(W / p.widthMm, H / p.heightMm);
    const holder = stage.firstChild;
    holder.style.cssText = `position:relative;margin:6px auto 0;overflow:hidden;width:${p.widthMm * k}px;height:${p.heightMm * k}px`;
    holder.innerHTML = p.svg;
    const svg = holder.firstChild; svg.setAttribute('width', String(p.widthMm * k)); svg.setAttribute('height', String(p.heightMm * k));
    status.textContent = `${songs[cur.song]?.title ?? ''}${cur.scope ? ` · ${cur.scope}` : ''} · ${t('lecteur.pageOf', { n: cur.page + 1, total: pages.length })} · ${cur.song + 1}/${songs.length}`;
  };
  const showSong = (index, page = 0) => {
    if (!songs.length) { stage.replaceChildren(el('div', { style: 'padding:60px 24px;text-align:center;font-size:16px' }, t('lecteur.empty'))); status.textContent = ''; return; }
    cur.song = Math.max(0, Math.min(index, songs.length - 1));
    beatRetime();
    const song = songs[cur.song]; const work = workOf(song.entry); const movement = work.movements[song.movementIndex];
    const { transpose = 0, zoom = 1 } = song.entry.settings ?? {};
    const fifths = getProperty(movement.masterbars[0], PID.KEY_SIG) ?? 0;
    const width = host.clientWidth;
    // the first song on a device: ask what is played here BEFORE drawing anything, so that only that part is laid out (the other tracks cost most of the opening time)
    if (!prefs.asked && !prefs.kinds.length && !prefs.picked.length && kindsPresent(movement).length > 1) { stage.replaceChildren(); status.textContent = ''; askRole(movement, page); return; }
    const choice = resolveShown(movement, viewAll ? [] : prefs.kinds, prefs.names, viewAll ? [] : prefs.picked);
    cur.scope = shownNames(movement, choice.tracks); // said, small, at the foot of the page: it confirms what is on the screen
    // the songbook view (lyrics, the chords above): when asked and the song has lyrics (else the music is drawn as usual), and always for a work that has no music (a free text sheet)
    const songbook = (prefs.lyrics || !movement.tracks.length) ? buildSongbook(work, shiftForDisplay(movement, transpose, { fifths }), workChordQualities(work), { semitones: transpose }) : null;
    const pick = canvasPick(song, choice, width, host.clientHeight, false); // the closest canvas, even when its shape is too far: its reader settings still count
    cur.rs = pick ? readerSettingsOf(pick.part) : null;
    const regular = effectiveRegular();
    const holder = el('div', { style: 'overflow:hidden;position:relative;margin-top:6px' });
    stage.replaceChildren(holder);
    // a system taller than the screen could never be read: the staves are drawn smaller until the tallest page fits (at most three tries, never under 35 %)
    if (songbook?.hasLyrics) {
      const fontPx = Math.max(17, Math.min(34, width / 38)) * zoom * prefs.lyricScale;
      const sb = drawSongbook(songbook, { width, fontPx, margin: EDGE_MARGIN, chords: prefs.lyricChords, columns: effectiveColumns(width), cards: prefs.lyricCards, cardScale: effectiveCardScale(), chorus: prefs.lyricChorus, breaks: prefs.lyricBreaks });
      holder.replaceChildren(sb.box); shown = { box: sb.box };
      const reserve = Math.round(fontPx * 1.3); // about a line of room left empty at the foot of every page: the status line and a browser bar never hide a line
      pages = sb.arrange(pageHeight(), reserve); // whole lines only, a band per page (two columns, unless the song fits one)
      showPage(page === 'last' ? pages.length - 1 : page); persist();
      return;
    }
    // the author's own pages, when a canvas of the work suits this screen (the lyrics view and a zoom keep the automatic pages; a transposition is laid out again on the same pages)
    const fixed = zoom === 1 ? (pick?.fits ? fixedPagesOf(song, pick) : null) : null;
    if (fixed) {
      shown = { box: null }; pages = fixed;
      showPage(page === 'last' ? pages.length - 1 : page); persist();
      if (choice.pending.length) askTrack(choice.pending[0]);
      return;
    }
    ({ shown, pages } = drawAutoPages(holder, { work, movement, tracks: choice.tracks, transpose, zoom, width, height: pageHeight(), settings: { regular, musicScale: prefs.musicScale, musicOnly: prefs.musicOnly, grid: prefs.grid, gridBase: prefs.gridBase, gridChords: prefs.gridChords, gridStretch: prefs.gridStretch, perRow: effectivePerRow(), containers: effectiveContainers(), cards: effectiveCards(), spacing: effectiveSpacing(), cardScale: effectiveCardScale(), cardGap: effectiveCardGap(), tempo: effectiveTempo(), signsColor: prefs.signs ? prefs.signsColor : null, chordView: prefs.chordView } }));
    showPage(page === 'last' ? pages.length - 1 : page);
    persist();
    if (choice.pending.length) askTrack(choice.pending[0]);
  };
  const next = () => { if (cur.page < pages.length - 1) showPage(cur.page + 1); else if (cur.song < songs.length - 1) showSong(cur.song + 1, 0); persist(); };
  const prev = () => { if (cur.page > 0) showPage(cur.page - 1); else if (cur.song > 0) showSong(cur.song - 1, 'last'); persist(); };

  // ---------- the menu: a slim bar (the songs, the transposition and the zoom), a sheet of reading settings, a sheet for the recueil ----------
  ensureStyle(); host.classList.add('lc-ui');
  let songList = null; let settingsSheet = null; let recueilSheet = null; let settingsTab = 'display';
  /** Redraws everything that shows the state: the bar, the sheets and the list that are open. */
  const refreshAll = () => {
    drawMenu();
    if (settingsSheet?.isOpen()) settingsSheet.refresh();
    if (recueilSheet?.isOpen()) recueilSheet.refresh();
    if (songList?.isOpen()) songList.refresh({ songs, current: cur.song, locked });
  };
  const setPrefs = (patch, { redraw = true } = {}) => { prefs = { ...prefs, ...patch }; savePrefs(); if (redraw) showSong(cur.song, 0); refreshAll(); };
  const picker = el('input', { type: 'file', multiple: true, accept: '.scorsaire-recueil,.scorsaire,.json,.cho,.chopro,.chordpro,.crd,.pro,.txt,application/json,application/zip', style: 'display:none', 'data-act': 'open-file', onchange: async (e) => { await openFiles([...e.target.files]); } });
  host.append(picker);

  const drawMenu = () => {
    const song = songs[cur.song]; const s = song?.entry.settings ?? {};
    // only the transposition (and the order) wait for the padlock: the size of the music is free
    const adjust = (patch) => { if (locked && 'transpose' in patch) return; recueil = setEntrySettings(recueil, song.entry.id, patch); buildSongs(); showSong(cur.song, 0); refreshAll(); };
    const tr = s.transpose ?? 0; const zoom = s.zoom ?? 1;
    const label = (text, gated = false) => el('span', { style: `font-size:14px;${gated && locked ? 'opacity:.4' : ''}` }, text);
    menu.replaceChildren(
      el('div', { style: 'display:flex;align-items:center;gap:8px' }, el('strong', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px' }, recueil?.title || t('lecteur.title')), btn(t('lecteur.close'), closeMenu, { act: 'close-menu' })),
      el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:8px' },
        el('button', { type: 'button', class: 'lc-btn', 'data-act': 'songs', disabled: !songs.length, onclick: openSongs, style: 'flex:1 1 240px;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, `☰  ${t('lecteur.songs')}${song ? ` · ${song.title}  ${cur.song + 1}/${songs.length}` : ''}`),
        song ? el('span', { style: 'display:inline-flex;align-items:center;gap:8px;white-space:nowrap' }, label(t('lecteur.transposeShort'), true), stepper(tr > 0 ? `+${tr}` : String(tr), (d) => adjust({ transpose: Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, tr + d)) }), { act: 'transpose', gated: locked })) : null,
        song ? el('span', { style: 'display:inline-flex;align-items:center;gap:8px;white-space:nowrap' }, label(t('lecteur.zoom')), stepper(`${Math.round(zoom * 100)} %`, (d) => adjust({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round((zoom + d * 0.1) * 100) / 100)) }), { act: 'zoom' })) : null,
        lockButton({ locked, labels: { locked: t('lecteur.locked'), unlocked: t('lecteur.unlocked') }, hint: t('lecteur.lockHint'), onToggle: () => { locked = !locked; refreshAll(); } })),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' }, btn(t('lecteur.settings'), openSettings, { act: 'settings', disabled: !songs.length }), btn(t('lecteur.recueil'), openRecueil, { act: 'recueil' })),
      note(locked ? t('lecteur.lockedHint') : t('lecteur.hint')));
  };
  /** The question of the first song on a device: what is played here. The answer is kept (the kind, and the role of the layouts that suits it); "all" shows every track as before. */
  const askRole = (movement, page = 0) => {
    host.querySelector('[data-lc-ask-role]')?.remove();
    const roles = [...new Set(canvasesOf(workOf(songs[cur.song].entry)).flatMap((c) => partsOfCanvas(workOf(songs[cur.song].entry), c.id)).map((p) => getProperty(p, PID.PART_ROLE)).filter(Boolean))];
    const answer = (kind) => {
      prefs = { ...prefs, asked: true, kinds: kind ? [kind] : [], ...(kind ? { role: roleForKind(kind, roles) ?? prefs.role } : {}) }; savePrefs(); overlay.remove(); viewAll = false; showSong(cur.song, page); refreshAll();
    };
    const overlay = el('div', { 'data-lc-ask-role': '', role: 'dialog', 'aria-label': t('lecteur.askRole'), style: 'position:absolute;inset:0;z-index:40;background:var(--paper,#faf8f4);display:flex;align-items:center;justify-content:center' },
      el('div', { style: 'color:var(--ink,#1c1b1a);border-radius:12px;padding:16px 18px;max-width:min(92%,460px)' },
        el('div', { style: 'font-size:20px;margin-bottom:6px' }, t('lecteur.askRole')),
        el('p', { style: 'margin:0 0 14px;font-size:13px;opacity:.7' }, t('lecteur.askRoleHint')),
        el('div', { style: 'display:flex;flex-direction:column;gap:8px' },
          ...kindsPresent(movement).map((k) => el('button', { type: 'button', 'data-act': 'ask-role', 'data-kind': k, class: 'lc-btn', style: 'padding:12px 14px;font-size:16px', onclick: () => answer(k) }, t(`lecteur.kind.${k}`))),
          el('button', { type: 'button', 'data-act': 'ask-role', 'data-kind': 'all', class: 'lc-btn', style: 'padding:12px 14px;font-size:16px', onclick: () => answer(null) }, t('lecteur.askRoleAll')))));
    host.append(overlay);
  };
  /** The question when a song has several tracks of a wanted kind: the answer is remembered by track name for every next song. */
  const askTrack = ({ kind, candidates }) => {
    host.querySelector('[data-lc-ask]')?.remove();
    const answer = (value) => { prefs = { ...prefs, names: { ...prefs.names, [kind]: value } }; savePrefs(); overlay.remove(); showSong(cur.song, 0); };
    const overlay = el('div', { 'data-lc-ask': '', role: 'dialog', 'aria-label': t('lecteur.askTrack', { kind: t(`lecteur.kind.${kind}`) }), style: 'position:absolute;inset:0;z-index:40;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center' },
      el('div', { style: 'background:var(--paper,#faf8f4);color:var(--ink,#1c1b1a);border-radius:12px;padding:16px 18px;max-width:min(90%,420px);box-shadow:0 10px 30px rgba(0,0,0,.35)' },
        el('div', { style: 'font-size:16px;margin-bottom:10px' }, t('lecteur.askTrack', { kind: t(`lecteur.kind.${kind}`).toLowerCase() })),
        el('div', { style: 'display:flex;flex-direction:column;gap:8px' },
          ...candidates.map((c) => el('button', { type: 'button', 'data-act': 'ask-track', 'data-name': c.name, style: 'padding:10px 14px;font-size:15px', onclick: () => answer(c.name) }, c.name)),
          el('button', { type: 'button', 'data-act': 'ask-all', style: 'padding:10px 14px;font-size:15px', onclick: () => answer(ALL_TRACKS) }, t('lecteur.allTracks'))),
        el('p', { style: 'margin:10px 0 0;font-size:12px;opacity:.6' }, t('lecteur.askHint'))));
    host.append(overlay);
  };

  // ----- the songs, on the whole screen -----
  const openSongs = () => {
    if (songList?.isOpen()) return;
    songList = openSongList(host, {
      songs, current: cur.song, locked, t,
      onPick: (i) => { songList.close(); closeMenu(); showSong(i); },
      onLock: () => { locked = !locked; refreshAll(); },
      onStep: (i, d) => moveSong(i, d),
      onDrop: (from, to, before) => dropSong(from, to, before),
      onClose: () => { songList = null; },
    });
  };
  /** A card dropped on another: the work (all its movements) moves before or after the work of the target. */
  const dropSong = (fromIndex, targetIndex, before) => {
    const ids = recueil.entries.map((x) => x.id);
    const from = ids.indexOf(songs[fromIndex].entry.id);
    let to = ids.indexOf(songs[targetIndex].entry.id) + (before ? 0 : 1);
    if (to > from) to -= 1; // the removal above shifts what follows
    if (to !== from) applyOrder(() => moveEntry(recueil, songs[fromIndex].entry.id, to));
  };
  /** The arrows (shown when unlocked, always a way to move a card even where dragging fails): a work with several movements moves as a whole. */
  const moveSong = (i, d) => {
    const ids = recueil.entries.map((e) => e.id);
    const target = ids.indexOf(songs[i].entry.id) + d;
    if (target >= 0 && target < ids.length) applyOrder(() => moveEntry(recueil, songs[i].entry.id, target));
  };
  /** Applies a new order of the recueil keeping the song that is on screen. */
  const applyOrder = (change) => {
    const keepEntry = songs[cur.song]?.entry.id; const keepMovement = songs[cur.song]?.movementIndex;
    recueil = change(); buildSongs();
    const again = songs.findIndex((x) => x.entry.id === keepEntry && x.movementIndex === keepMovement);
    cur.song = again >= 0 ? again : 0; persist(); refreshAll();
  };

  // ----- the reading settings: tabs in a sheet from the bottom, the page above stays visible and follows each change -----
  /** Does the song on screen have sections of the form (Couplet, Refrain…)? */
  const hasFormSections = () => { const song = songs[cur.song]; const work = song ? workOf(song.entry) : null; const mv = work?.movements[song?.movementIndex ?? 0]; return !!mv?.systemContainers?.length; };
  const kindsTab = () => {
    const regular = effectiveRegular(); const perRow = effectivePerRow();
    const setKinds = (kinds) => { viewAll = false; setPrefs({ kinds, picked: [], asked: true }); };
    // the tracks of the song on screen, one switch each: any combination, whatever the kind (the kinds above stay as shortcuts)
    const song = songs[cur.song]; const work = song ? workOf(song.entry) : null; const mv = work?.movements[song?.movementIndex ?? 0];
    const trackRows = () => {
      if (!mv || mv.tracks.length < 2) return [];
      const names = mv.tracks.map((tr, i) => nameOf(tr, i));
      const now = resolveShown(mv, prefs.kinds, prefs.names, prefs.picked).tracks;
      const shownNow = new Set(mv.tracks.map((tr, i) => ({ id: tr.id, n: names[i] })).filter((c) => !now || now.includes(c.id)).map((c) => c.n));
      const toggle = (name) => {
        const next = new Set(shownNow); if (next.has(name)) next.delete(name); else next.add(name);
        if (!next.size) return; // at least one track stays on
        viewAll = false;
        if (next.size === names.length) setPrefs({ kinds: [], picked: [], asked: true });
        else setPrefs({ kinds: [], picked: [...next], asked: true });
      };
      return [title(t('lecteur.pickTracks')), ...mv.tracks.map((tr, i) => row(names[i], switchButton(shownNow.has(names[i]), () => toggle(names[i]), { act: 'pick-track', label: names[i] })))];
    };
    return [
      title(t('lecteur.display')),
      el('span', { class: 'lc-seg', role: 'group' },
        btn(t('lecteur.kind.all'), () => setKinds([]), { on: prefs.kinds.length === 0 && !prefs.picked.length, act: 'kind', data: { kind: 'all' } }),
        ...KINDS.map((k) => btn(t(`lecteur.kind.${k}`), () => setKinds(prefs.kinds.includes(k) ? prefs.kinds.filter((x) => x !== k) : [...prefs.kinds, k]), { on: prefs.kinds.includes(k), act: 'kind', data: { kind: k } }))),
      ...trackRows(),
      (prefs.kinds.length || prefs.picked.length) ? row(t('lecteur.viewAll'), switchButton(viewAll, (v) => { viewAll = v; showSong(cur.song, 0); refreshAll(); }, { act: 'view-all', label: t('lecteur.viewAll') })) : null,
      (prefs.kinds.length || prefs.picked.length) ? note(t('lecteur.viewAllHint')) : null,
      title(t('lecteur.page')),
      row(t('lecteur.lyrics'), switchButton(prefs.lyrics, (v) => setPrefs({ lyrics: v }), { act: 'lyrics', label: t('lecteur.lyrics') })),
      prefs.lyrics ? (stage.clientWidth < PHONE_WIDTH ? el('p', { class: 'lc-note', 'data-act': 'lyric-columns-phone' }, t('lecteur.columnsPhone')) : row(t('lecteur.columns'), choices([['auto', t('lecteur.auto')], ['1', '1'], ['2', '2']], (v) => prefs.lyricColumns === v, (v) => setPrefs({ lyricColumns: v }), { act: 'lyric-columns' }))) : null,
      prefs.lyrics ? row(t('lecteur.lyricScale'), el('span', { style: 'display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap' },
        stepper(`${Math.round(prefs.lyricScale * 100)} %`, (d) => setPrefs({ lyricScale: scaleStep(prefs.lyricScale, d) }), { act: 'lyric-scale', disabledLess: prefs.lyricScale <= 0.5, disabledMore: prefs.lyricScale >= 2, valueData: 'data-lc-lyric-scale' }),
        btn('100 %', () => setPrefs({ lyricScale: 1 }), { on: prefs.lyricScale === 1, act: 'lyric-scale-reset', data: { value: 100 } }))) : null,
      prefs.lyrics && hasFormSections() ? row(t('lecteur.lyricCards'), switchButton(prefs.lyricCards, (v) => setPrefs({ lyricCards: v }), { act: 'lyric-cards', label: t('lecteur.lyricCards') })) : null,
      prefs.lyrics && hasFormSections() ? row(t('lecteur.lyricChorus'), choices([['normal', t('lecteur.chorus.normal')], ['italic', t('lecteur.chorus.italic')], ['bold', t('lecteur.chorus.bold')]], (v) => prefs.lyricChorus === v, (v) => setPrefs({ lyricChorus: v }), { act: 'lyric-chorus' })) : null,
      prefs.lyrics ? row(t('lecteur.lyricBreaks'), choices([['free', t('lecteur.breaks.free')], ['verses', t('lecteur.breaks.verses')], ['page', t('lecteur.breaks.page')]], (v) => prefs.lyricBreaks === v, (v) => setPrefs({ lyricBreaks: v }), { act: 'lyric-breaks' })) : null,
      prefs.lyrics ? row(t('lecteur.lyricChords'), choices([['first', t('lecteur.chords.first')], ['all', t('lecteur.chords.all')], ['none', t('lecteur.chords.none')]], (v) => prefs.lyricChords === v, (v) => setPrefs({ lyricChords: v }), { act: 'lyric-chords' })) : null,
      row(t('lecteur.grid'), choices([['off', t('lecteur.grid.off')], ['columns', t('lecteur.grid.columns')]], (v) => prefs.grid === v, (v) => setPrefs({ grid: v }), { act: 'grid' })),
      prefs.grid === 'columns' ? row(t('lecteur.gridBase'), choices([['common', t('lecteur.gridBase.common')], ['widest', t('lecteur.gridBase.widest')], ['chords', t('lecteur.gridBase.chords')]], (v) => prefs.gridBase === v, (v) => setPrefs({ gridBase: v }), { act: 'grid-base' })) : null,
      prefs.grid === 'columns' ? row(t('lecteur.gridStretch'), choices([['off', t('lecteur.gridStretch.off')], ['2', t('lecteur.gridStretch.2')], ['3', t('lecteur.gridStretch.3')], ['any', t('lecteur.gridStretch.any')]], (v) => prefs.gridStretch === v, (v) => setPrefs({ gridStretch: v }), { act: 'grid-stretch' })) : null,
      prefs.grid === 'columns' && prefs.gridBase === 'chords' ? row(t('lecteur.gridChords'), stepper(String(prefs.gridChords), (d) => setPrefs({ gridChords: Math.max(2, Math.min(4, prefs.gridChords + d)) }), { act: 'grid-chords', disabledLess: prefs.gridChords <= 2, disabledMore: prefs.gridChords >= 4, valueData: 'data-lc-grid-chords' })) : null,
      row(t('lecteur.regular'), switchButton(regular, (v) => setPrefs({ regular: v }), { act: 'regular', label: t('lecteur.regular') })),
      row(t('lecteur.perRow'), stepper(perRow ? String(perRow) : t('lecteur.auto'), (d) => setPrefs({ perRow: d < 0 ? (perRow <= 1 ? (cur.rs?.perRow ? -1 : 0) : perRow - 1) : Math.min(12, perRow + 1) }), { act: 'perrow', disabledLess: perRow <= 0, disabledMore: perRow >= 12, valueData: 'data-lc-perrow' })),
    ].filter(Boolean);
  };
  /** The layout: automatic pages, or one of the canvases (tablets) the author prepared for this work; says when the zoom keeps the automatic pages. */
  const pageTab = () => {
    const work = songs[cur.song] ? workOf(songs[cur.song].entry) : null;
    const names = work ? canvasesOf(work).map((c) => c.name) : [];
    const s = songs[cur.song]?.entry.settings ?? {};
    const sp = effectiveSpacing();
    const out = [];
    if (names.length) {
      out.push(title(t('lecteur.layout')), el('span', { class: 'lc-seg', role: 'group' },
        btn(t('lecteur.auto'), () => setPrefs({ canvas: AUTO }, { redraw: false }) || showSong(cur.song, 0), { on: prefs.canvas === AUTO, act: 'canvas', data: { canvas: AUTO } }),
        ...names.map((n) => btn(n, () => { setPrefs({ canvas: n }); }, { on: prefs.canvas === n, act: 'canvas', data: { canvas: n } })),
        btn(t('lecteur.layoutNone'), () => setPrefs({ canvas: NONE }), { on: prefs.canvas === NONE, act: 'canvas', data: { canvas: NONE } })));
      // the roles the author gave to the layouts (DRMS, GTR…): the person says once which one is always read on this device
      const roles = [...new Set(canvasesOf(work).flatMap((c) => partsOfCanvas(work, c.id)).map((p) => getProperty(p, PID.PART_ROLE)).filter(Boolean))];
      if (roles.length) out.push(row(t('lecteur.role'), el('span', { class: 'lc-seg', role: 'group' }, ...[null, ...roles].map((r) => btn(r ?? t('lecteur.roleNone'), () => setPrefs({ role: r }), { on: prefs.role === r, act: 'role', data: { role: r ?? '' } })))));
      if ((s.zoom ?? 1) !== 1) out.push(note(t('lecteur.layoutAdjusted'), { 'data-lc-canvas-note': '' }));
    }
    out.push(row(t('lecteur.spacing'),
      el('span', { style: 'display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap' },
        stepper(`${Math.round(sp * 100)} %`, (d) => setPrefs({ spacing: Math.max(SPACING_MIN, Math.min(SPACING_MAX, Math.round((sp + d * 0.1) * 100) / 100)) }), { act: 'spacing', disabledLess: sp <= SPACING_MIN, disabledMore: sp >= SPACING_MAX, valueData: 'data-lc-spacing' }),
        btn('100 %', () => setPrefs({ spacing: null }), { on: prefs.spacing === null, act: 'spacing-reset', data: { value: 100 } }))));
    out.push(row(t('lecteur.musicScale'),
      el('span', { style: 'display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap' },
        stepper(`${Math.round(prefs.musicScale * 100)} %`, (d) => setPrefs({ musicScale: scaleStep(prefs.musicScale, d) }), { act: 'music-scale', disabledLess: prefs.musicScale <= 0.5, disabledMore: prefs.musicScale >= 2, valueData: 'data-lc-music-scale' }),
        btn('100 %', () => setPrefs({ musicScale: 1 }), { on: prefs.musicScale === 1, act: 'music-scale-reset', data: { value: 100 } }))));
    out.push(row(t('lecteur.musicOnly'), switchButton(prefs.musicOnly, (v) => setPrefs({ musicOnly: v }), { act: 'music-only', label: t('lecteur.musicOnly') })), note(t('lecteur.musicOnlyHint'), { 'data-lc-music-only-note': '' }));
    return out;
  };
  /** The containers shown above the staves when the Lecteur paginates by itself (the layouts of screen 2 decide for their own): one toggle per category, kept on the device. */
  const containersTab = () => {
    const toggle = (cat) => { const now = effectiveContainers(); setPrefs({ containers: now.includes(cat) ? now.filter((c) => c !== cat) : [...now, cat] }); };
    return [title(t('lecteur.containers')), el('span', { class: 'lc-seg', role: 'group' }, ...CONTAINER_CATEGORIES.map((cat) => btn(t(`lecteur.container.${cat}`), () => toggle(cat), { on: effectiveContainers().includes(cat), act: 'container', data: { category: cat } })))];
  };
  /** The cards of the structure (when the work has sections) and the tempo texts: over what the author prepared, kept on the device. */
  const cardsTab = () => {
    const work = songs[cur.song] ? workOf(songs[cur.song].entry) : null;
    const hasSections = !!work?.movements.some((m) => m.systemContainers?.length);
    const scaleRow = (key, text, v, lo, hi) => row(t(text), stepper(`${Math.round(v * 100)} %`, (d) => setPrefs({ [key]: Math.max(lo, Math.min(hi, Math.round((v + d * 0.1) * 100) / 100)) }), { act: key, disabledLess: v <= lo, disabledMore: v >= hi, valueData: `data-lc-${key}` }));
    return [
      title(t('lecteur.chordView')),
      row(t('lecteur.chordView'), choices(['author', 'original', 'capo'].map((m) => [m, t(`lecteur.chordView.${m}`)]), (v) => prefs.chordView === v, (v) => setPrefs({ chordView: v }), { act: 'chord-view' })),
      note(t('lecteur.chordViewHint')),
      title(t('lecteur.signs')),
      row(t('lecteur.signs'), switchButton(prefs.signs, (v) => setPrefs({ signs: v }), { act: 'signs', label: t('lecteur.signs') })),
      prefs.signs ? row(t('lecteur.signsColor'), el('input', { type: 'color', value: prefs.signsColor, 'aria-label': t('lecteur.signsColor'), 'data-act': 'signs-color', style: 'min-width:48px;min-height:36px', onchange: (e) => setPrefs({ signsColor: /^#[0-9a-f]{6}$/i.test(e.target.value) ? e.target.value : SIGNS_RED }) })) : null,
      note(t('lecteur.signsHint')),
      title(t('lecteur.tempo')),
      row(t('lecteur.tempo'), choices([['yes', t('parts.reader.yes')], ['no', t('parts.reader.no')]], (v) => (v === 'yes') === effectiveTempo(), (v) => setPrefs({ tempo: v === 'yes' }), { act: 'tempo' })),
      hasSections ? title(t('lecteur.cards')) : null,
      hasSections ? el('span', { class: 'lc-seg', role: 'group' }, btn(t('lecteur.cards.default'), () => setPrefs({ cards: null }), { on: prefs.cards === null, act: 'cards', data: { value: 'default' } }), ...CARD_MODES.map((m) => btn(t(`lecteur.cards.${m}`), () => setPrefs({ cards: m }), { on: prefs.cards === m, act: 'cards', data: { value: m } }))) : null,
      hasSections ? scaleRow('cardScale', 'lecteur.cardScale', effectiveCardScale(), CARD_SCALE_MIN, CARD_SCALE_MAX) : null,
      hasSections ? scaleRow('cardGap', 'lecteur.cardGap', effectiveCardGap(), CARD_GAP_MIN, CARD_GAP_MAX) : null,
    ].filter(Boolean);
  };
  const settingsTabs = () => {
    const work = songs[cur.song] ? workOf(songs[cur.song].entry) : null;
    const hasContainers = !!work?.movements.some((m) => m.tracks.some((tr) => tr.staves.some((st) => st.containers?.length)));
    return [{ id: 'display', text: t('lecteur.tab.display'), build: kindsTab }, { id: 'layout', text: t('lecteur.tab.layout'), build: pageTab }, ...(hasContainers ? [{ id: 'containers', text: t('lecteur.tab.containers'), build: containersTab }] : []), { id: 'cards', text: t('lecteur.tab.cards'), build: cardsTab }];
  };
  const openSettings = () => {
    if (settingsSheet?.isOpen()) return;
    const tabs = settingsTabs();
    settingsSheet = openSheet(host, { title: t('lecteur.settings'), tabs, tab: tabs.some((x) => x.id === settingsTab) ? settingsTab : tabs[0].id, closeLabel: t('lecteur.close'), onClose: () => { settingsSheet = null; } });
    // the tab chosen is remembered for the next opening
    settingsSheet.setTab = ((orig) => (id) => { settingsTab = id; orig(id); })(settingsSheet.setTab);
  };

  /** The song on the screen written as a ChordPro file (its lyrics with the chords before the syllables, transposed like the page). */
  const exportChordPro = () => {
    const song = songs[cur.song]; if (!song) return;
    const work = workOf(song.entry); const movement = work.movements[song.movementIndex];
    const { transpose = 0 } = song.entry.settings ?? {};
    const fifths = getProperty(movement.masterbars[0], PID.KEY_SIG) ?? 0;
    const shifted = shiftForDisplay(movement, transpose, { fifths });
    const data = buildSongbook(work, shifted, workChordQualities(work), { semitones: transpose });
    if (!data.hasLyrics) { status.textContent = t('lecteur.noLyricsToExport'); return; }
    const major = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
    const meta = { title: song.title || getProperty(work, PID.TITLE) || '', subtitle: getProperty(work, PID.SUBTITLE) || '', composer: getProperty(work, PID.COMPOSER) || '', key: major[(getProperty(shifted.masterbars[0], PID.KEY_SIG) ?? 0) + 7] };
    download(`${(meta.title || 'song').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.cho`, songbookToChordPro(data, meta), 'text/plain');
  };
  // ----- the recueil: open, address, reload, export, theme -----
  const recueilBuild = () => [
    row(t('lecteur.open'), btn(t('lecteur.chooseFile'), () => picker.click(), { act: 'open' })),
    el('form', { class: 'lc-row', style: 'gap:8px', onsubmit: (e) => { e.preventDefault(); const a = e.target.elements.address.value.trim(); if (a) openAddress(a); } },
      el('input', { type: 'text', name: 'address', class: 'lc-input', 'data-act': 'address', placeholder: t('lecteur.addressPrompt'), 'aria-label': t('lecteur.openAddress'), value: '', autocomplete: 'off', style: 'flex:1 1 200px' }),
      btn(t('lecteur.openAddress'), () => {}, { act: 'open-address' })),
    source ? row(t('lecteur.reloadAddress'), btn(t('lecteur.reload'), () => openAddress(source), { act: 'reload-address', title: source })) : null,
    songs.length ? row(t('lecteur.export'), btn(t('lecteur.exportShort'), () => download(`${recueil.title || 'recueil'}.scorsaire-recueil`, serializeRecueil(recueil)), { act: 'export' })) : null,
    songs.length ? row(t('lecteur.exportChordPro'), btn(t('lecteur.exportShort'), () => exportChordPro(), { act: 'export-chordpro' })) : null,
    theme ? row(t('lecteur.theme'), theme) : null,
  ].filter(Boolean);
  const openRecueil = () => {
    if (recueilSheet?.isOpen()) return;
    recueilSheet = openSheet(host, { title: t('lecteur.recueil'), build: recueilBuild, closeLabel: t('lecteur.close'), onClose: () => { recueilSheet = null; } });
  };
  const closeOverlays = () => { songList?.close(); settingsSheet?.close(); recueilSheet?.close(); };
  const openMenu = () => { drawMenu(); menuOpen = true; menu.style.transform = 'translateY(0)'; if (!songs.length) openRecueil(); };
  const closeMenu = () => { closeOverlays(); menuOpen = false; locked = true; menu.style.transform = 'translateY(-105%)'; };
  const refreshAfterChange = () => { showSong(cur.song, 0); refreshAll(); };

  // ---------- opening files ----------
  const openFiles = async (files) => openBytes(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))), { source: null });
  /** The address of the recueil opened by `?file=` (kept so that the same address is not fetched again and again): null for a file picked on the device. */
  let source = null;
  /** `list` = [{ name, bytes }]: a recueil, or works (a plain recueil is made of them). `source` = the address they came from, if any. */
  const openBytes = async (list, { source: from = null } = {}) => {
    try {
      let rc = null; const loose = [];
      for (const f of list) {
        const bytes = f.bytes;
        if (isScorsaireArchive(bytes)) {
          const r = await readScorsaireArchive(bytes);
          for (const im of r.images) registerAsset(im);
          loose.push({ title: '', workText: r.scoreText, images: Object.fromEntries(r.images.map((im) => [im.id, { mime: im.mime, data: `data:${im.mime};base64,${btoa(String.fromCharCode(...im.bytes))}` }])) });
          continue;
        }
        const text = new TextDecoder().decode(bytes);
        if (looksLikeChordPro(f.name, text)) { // a ChordPro song: a work with no music, one text per stanza (opens as a songbook sheet)
          const r = chordProToWorkText(text, { lang: ['fr', 'en'].includes(lang) ? lang : 'fr' });
          loose.push({ title: r.title || String(f.name ?? '').replace(/\.[^.]+$/, ''), workText: r.workText, images: {} });
          continue;
        }
        if (isRecueilText(text)) { const parsed = parseRecueil(text); if (!rc) rc = parsed; else for (const e of parsed.entries) rc = { ...rc, entries: [...rc.entries, e] }; } else loose.push({ title: '', workText: text, images: {} });
      }
      rc = rc ?? createRecueil({ title: list.length === 1 ? list[0].name.replace(/\.[^.]+$/, '') : t('lecteur.title') });
      for (const w of loose) rc = addEntry(rc, w).recueil;
      works.clear(); recueil = rc; source = from; setItem('source', from); buildSongs(); cur = { song: 0, page: 0 }; closeMenu(); showSong(0, 0);
      return true;
    } catch (e) { status.textContent = `${t('reader.loadError')} ${e?.message ?? ''}`; return false; }
  };
  /** Fetches the file at an address (relative to this page, or absolute: the server must allow it, GitHub Pages does for its own files) and opens it. */
  const openAddress = async (address) => {
    const url = new URL(address, location.href).href;
    status.textContent = t('reader.loading');
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(String(r.status));
      return await openBytes([{ name: decodeURIComponent(url.split('/').pop().split('?')[0]) || 'recueil', bytes: new Uint8Array(await r.arrayBuffer()) }], { source: url });
    } catch (e) { status.textContent = `${t('reader.loadError')} (${e?.message ?? ''})`; return false; }
  };


  // ---------- two small buttons over the page: full screen (bottom right) and the visual metronome (top right) ----------
  const fab = (act, title, css, icon) => el('button', { type: 'button', 'data-lc-fab': act, title, 'aria-label': title, 'aria-pressed': 'false', style: `position:absolute;${css};z-index:22;width:40px;height:40px;padding:0;border-radius:8px;border:1px solid var(--line,#ccc);background:var(--paper,#faf8f4);color:var(--ink,#1c1b1a);opacity:.55;display:flex;align-items:center;justify-content:center;touch-action:manipulation` }, icon);
  const svgIcon = (d) => { const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); n.setAttribute('viewBox', '0 0 24 24'); n.setAttribute('width', '22'); n.setAttribute('height', '22'); n.setAttribute('fill', 'none'); n.setAttribute('stroke', 'currentColor'); n.setAttribute('stroke-width', '2'); n.setAttribute('stroke-linecap', 'round'); n.setAttribute('stroke-linejoin', 'round'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); n.append(path); return n; };
  const ICON_ENTER = 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'; // the four corners go out
  const ICON_LEAVE = 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'; // and come in
  const ICON_BEAT = 'M7 21 10 3h4l3 18zM12 17 17 7'; // a metronome
  // full screen: only where the browser offers it (an iPhone does not; an installed app already fills the screen), and only from a tap
  const fsRoot = document.documentElement;
  const fsRequest = fsRoot.requestFullscreen ?? fsRoot.webkitRequestFullscreen;
  const fsExit = document.exitFullscreen ?? document.webkitExitFullscreen;
  const fsActive = () => !!(document.fullscreenElement ?? document.webkitFullscreenElement);
  const alreadyFull = typeof matchMedia === 'function' && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  if (fsRequest && fsExit && !alreadyFull) {
    const fsButton = fab('fullscreen', t('lecteur.fullscreen'), 'right:8px;bottom:8px', svgIcon(ICON_ENTER));
    const fsSync = () => { const on = fsActive(); fsButton.replaceChildren(svgIcon(on ? ICON_LEAVE : ICON_ENTER)); fsButton.setAttribute('aria-pressed', String(on)); const text = t(on ? 'lecteur.fullscreenExit' : 'lecteur.fullscreen'); fsButton.title = text; fsButton.setAttribute('aria-label', text); };
    fsButton.addEventListener('click', async () => { try { if (fsActive()) await fsExit.call(document); else await fsRequest.call(fsRoot); } catch { /* refused (a frame, a policy): the button just does nothing */ } fsSync(); });
    document.addEventListener('fullscreenchange', fsSync); document.addEventListener('webkitfullscreenchange', fsSync);
    host.append(fsButton);
  }
  // visual metronome: a big rectangle at the top of the screen that flashes on every beat of the tempo of the song on screen; the clock decides the brightness, so a slow frame never shifts it
  const bar = el('div', { 'data-lc-metronome': '', 'aria-hidden': 'true', style: 'position:absolute;left:0;right:0;top:0;height:clamp(72px,16vh,150px);border-radius:0 0 18px 18px;z-index:21;pointer-events:none;background:var(--ink,#1c1b1a);opacity:0;display:none' });
  const beatButton = fab('metronome', t('lecteur.metronome'), 'right:8px;top:18px', svgIcon(ICON_BEAT));
  let beat = { on: false, start: 0, period: 0.5, every: 1, frame: 0 };
  const beatSign = el('div', { 'data-lc-metronome-sign': '', 'aria-hidden': 'true', style: 'position:absolute;right:56px;top:12px;z-index:22;display:none;padding:2px 12px;border-radius:8px;background:var(--ink,#1c1b1a);color:var(--paper,#faf8f4);outline:2px solid var(--paper,#faf8f4);font:700 34px/1.2 var(--ui-font,sans-serif);pointer-events:none' }); // "÷2": the bar flashes on every second beat of the tempo
  const beatPlan = () => { const song = songs[cur.song]; if (!song) return { period: 0.5, every: 1 }; try { return flashPlan(workOf(song.entry).movements[song.movementIndex]); } catch { return { period: 0.5, every: 1 }; } };
  const beatApply = () => { const plan = beatPlan(); beat.period = plan.period; beat.every = plan.every; beatSign.textContent = `÷${plan.every}`; beatSign.title = t('lecteur.metronomeSlow', { n: plan.every }); beatSign.style.display = beat.on && plan.every > 1 ? 'block' : 'none'; };
  const beatTick = () => { bar.style.opacity = String(0.9 * flashLevel(performance.now() / 1000, beat.start, beat.period)); beat.frame = requestAnimationFrame(beatTick); };
  const beatRetime = () => { if (beat.on) beatApply(); }; // another song: its own tempo, the pulse goes on from where it was
  const setBeat = (on) => {
    beat.on = on; cancelAnimationFrame(beat.frame);
    beatButton.setAttribute('aria-pressed', String(on)); beatButton.style.opacity = on ? '1' : '.55';
    const text = t(on ? 'lecteur.metronomeOff' : 'lecteur.metronome'); beatButton.title = text; beatButton.setAttribute('aria-label', text);
    bar.style.display = on ? 'block' : 'none'; bar.style.opacity = '0';
    if (!on) beatSign.style.display = 'none';
    if (on) { beatApply(); beat.start = performance.now() / 1000; beat.frame = requestAnimationFrame(beatTick); }
  };
  beatButton.addEventListener('click', () => setBeat(!beat.on));
  host.append(bar, beatButton, beatSign);

  // ---------- gestures and keys: tap = turn, swipe down from the top = menu ----------
  let press = null;
  const inMenu = (e) => menu.contains(e.target) || !!e.target.closest?.('[data-lc-songlist],[data-lc-sheet],[data-lc-fab],[data-lc-ask],[data-lc-ask-role]'); // the bar and what it opens are not the stage
  host.addEventListener('pointerdown', (e) => { press = inMenu(e) ? null : { x: e.clientX, y: e.clientY, at: Date.now() }; });
  host.addEventListener('pointerup', (e) => {
    if (!press) return; const p = press; press = null;
    const dx = e.clientX - p.x; const dy = e.clientY - p.y;
    const tap = Math.abs(dx) <= 14 && Math.abs(dy) <= 14 && Date.now() - p.at <= 700; // a drag or a long press is not a tap
    if (menuOpen) { if (tap || dy < -40) closeMenu(); return; }
    if (p.y < 60 && dy > 70 && Math.abs(dx) < dy) { openMenu(); return; } // a swipe down from the top edge
    if (!tap) return;
    if (p.y < 16) { openMenu(); return; } // a tap on the handle at the very top
    if (e.clientX < host.clientWidth * LEFT_ZONE) prev(); else next();
  });
  host.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
    if (e.key === 'Escape') { if (songList?.isOpen()) songList.close(); else if (settingsSheet?.isOpen() || recueilSheet?.isOpen()) { settingsSheet?.close(); recueilSheet?.close(); } else closeMenu(); return; }
    if (e.key === 'm' || e.key === 'M') { if (menuOpen) closeMenu(); else openMenu(); e.preventDefault(); return; }
    if (menuOpen) return;
    if (NEXT_KEYS.includes(e.key)) { next(); e.preventDefault(); } else if (PREV_KEYS.includes(e.key)) { prev(); e.preventDefault(); }
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (songs.length) showSong(cur.song, Math.min(cur.page, pages.length - 1)); }, 200); });

  // ---------- start: the recueil kept on the device, else the address in ?file=, else the menu ----------
  (async () => {
    const wanted = new URLSearchParams(location.search || location.hash.replace(/^#/, '')).get('file');
    const wantedUrl = wanted ? new URL(wanted, location.href).href : null;
    const shared = bytesFromParams(new URLSearchParams(location.search || location.hash.replace(/^#/, ''))); // a piece sent by link (`#z=`): it opens at once, read only
    const savedPrefs = await getItem('prefs');
    if (savedPrefs && Array.isArray(savedPrefs.kinds)) prefs = { asked: savedPrefs.asked === true || savedPrefs.kinds.length > 0 || (Array.isArray(savedPrefs.picked) && savedPrefs.picked.length > 0), signs: savedPrefs.signs === true, signsColor: /^#[0-9a-f]{6}$/i.test(savedPrefs.signsColor ?? '') ? savedPrefs.signsColor : SIGNS_RED, chordView: ['original', 'capo'].includes(savedPrefs.chordView) ? savedPrefs.chordView : 'author', kinds: savedPrefs.kinds.filter((k) => KINDS.includes(k)), picked: Array.isArray(savedPrefs.picked) ? savedPrefs.picked.filter((n) => typeof n === 'string').slice(0, 64) : [], names: savedPrefs.names && typeof savedPrefs.names === 'object' ? savedPrefs.names : {}, regular: typeof savedPrefs.regular === 'boolean' ? savedPrefs.regular : null, perRow: Number.isInteger(savedPrefs.perRow) && savedPrefs.perRow >= 0 && savedPrefs.perRow <= 12 ? savedPrefs.perRow : 0, lyrics: savedPrefs.lyrics === true, lyricChords: ['first', 'all', 'none'].includes(savedPrefs.lyricChords) ? savedPrefs.lyricChords : 'first', musicScale: clampScale(savedPrefs.musicScale), musicOnly: savedPrefs.musicOnly === true, lyricScale: clampScale(savedPrefs.lyricScale), grid: savedPrefs.grid === 'columns' ? 'columns' : 'off', gridBase: ['common', 'widest', 'chords'].includes(savedPrefs.gridBase) ? savedPrefs.gridBase : 'common', gridChords: [2, 3, 4].includes(savedPrefs.gridChords) ? savedPrefs.gridChords : 2, gridStretch: ['off', '2', '3', 'any'].includes(savedPrefs.gridStretch) ? savedPrefs.gridStretch : 'off', lyricColumns: ['auto', '1', '2'].includes(savedPrefs.lyricColumns) ? savedPrefs.lyricColumns : 'auto', lyricCards: savedPrefs.lyricCards === true, lyricChorus: ['normal', 'italic', 'bold'].includes(savedPrefs.lyricChorus) ? savedPrefs.lyricChorus : 'italic', lyricBreaks: ['free', 'verses', 'page'].includes(savedPrefs.lyricBreaks) ? savedPrefs.lyricBreaks : 'verses', canvas: typeof savedPrefs.canvas === 'string' ? savedPrefs.canvas : AUTO, containers: Array.isArray(savedPrefs.containers) ? savedPrefs.containers.filter((c) => CONTAINER_CATEGORIES.includes(c)) : null, role: typeof savedPrefs.role === 'string' && savedPrefs.role ? savedPrefs.role : null, cards: CARD_MODES.includes(savedPrefs.cards) ? savedPrefs.cards : null, spacing: savedPrefs.spacing >= SPACING_MIN && savedPrefs.spacing <= SPACING_MAX ? savedPrefs.spacing : null, cardScale: savedPrefs.cardScale >= CARD_SCALE_MIN && savedPrefs.cardScale <= CARD_SCALE_MAX ? savedPrefs.cardScale : null, cardGap: savedPrefs.cardGap >= CARD_GAP_MIN && savedPrefs.cardGap <= CARD_GAP_MAX ? savedPrefs.cardGap : null, tempo: typeof savedPrefs.tempo === 'boolean' ? savedPrefs.tempo : null };
    const saved = await getItem('recueil'); const savedSource = await getItem('source');
    if (shared && (await openBytes([{ name: 'envoi.scorsaire', bytes: shared }], { source: null }))) { try { history.replaceState(null, '', location.pathname); } catch { /* the address stays */ } return; } // (the long address is taken off: a reload would not open it again over what is kept)
    if (wantedUrl && savedSource !== wantedUrl && (await openAddress(wanted))) return; // a new address: its recueil replaces the one kept
    if (saved) {
      source = savedSource ?? null;
      try {
        recueil = parseRecueil(saved); buildSongs();
        const pos = await getItem('position'); const at = pos ? songs.findIndex((s) => s.entry.id === pos.entry && s.movementIndex === pos.movement) : 0;
        showSong(Math.max(0, at), 0); return;
      } catch { /* an unreadable copy: start empty */ }
    }
    showSong(0, 0); openMenu();
  })();
  window.__lecteur = { next, prev, openMenu, closeMenu, openAddress, source: () => source, state: () => ({ song: cur.song, page: cur.page, pages: pages.length, songs: songs.length }) }; // (read by the tests)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
