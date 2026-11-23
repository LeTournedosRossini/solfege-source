/*
 * The window of the LYRICS TRACK made of events (staff type 'lyrics', see model/lyricevents.js): the list of its syllables, each on its measure, at its exact instant and on its
 * line. A syllable's text is corrected where it stands (Enter goes to the next one); ◂ ▸ move it by a sixteenth, ◂◂ ▸▸ by a beat, across the bar lines; the measure and the line
 * can be changed; « + » adds a syllable right after the chosen one; « Paste a text » puts the words of a pasted text on the following syllables (to correct a transcription).
 * Every change is ONE edit that can be undone; the window follows the document (undo, redo, the score) and never keeps its own copy. Bottom sheet on phones / tablets,
 * centered window on desktop.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { fToNumber, fCmp, fSub, frac } from '../model/fraction.js';
import { lyricEventsOf } from '../model/lyricevents.js';
import { measureLengthOf } from '../model/timing.js';
import { addLyricEvent, setLyricEventText, setLyricEventLine, moveLyricEvent, shiftLyricEvent, removeLyricEvent, assignWords, unassignAll, appendReserve, setReserve, reserveOf, reserveText, wordsOf, slotFrom, lyricLinkInfo, applyLyricLinks, realignLyricEvents, MAX_LINE, STEP } from '../model/lyriceventedit.js';
import { openLyricsAdjust } from './lyrics-adjust-dom.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { createChoiceMenu } from './choice-menu.js';
import { parseLyricText, normalizeLyricText, insertMarker, insertMarkerBeforePhrase, removeMarker, lyricBlocks, numberedName, toggleBreakBefore, suggestPhrases, tailAfter, LYRIC_SECTION_KINDS } from '../model/lyrictext.js';
import { defaultSectionColor } from '../model/sections.js';

const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const BEAT_STEPS = 4; // four sixteenths = a beat (a quarter)

/** @param o.app the application ; o.trackId the lyrics track ; o.focusMeasure the measure to show first (0-based) ; o.focusId a syllable (its element id) to choose at once ; o.glyphs for the window that links to notes */
export function openLyricEvents({ app, label = (k) => k, trackId, focusMeasure = 0, focusId = null, glyphs = null }) {
  const find = () => { for (const mv of app.doc.work.movements) { const track = mv.tracks.find((t) => t.id === trackId); if (track) return { mv, track, staff: track.staves.find((s) => getProperty(s, PID.STAFF_TYPE) === 'lyrics') }; } return null; };
  if (!find()?.staff) return null;
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let selected = focusId; let lineFilter = -1; let pasting = false; let done = false; let startAt = focusMeasure; // `startAt`: scroll to this measure once, at the first drawing

  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-lyric-events': '', 'data-zoom-lock': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:14px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;display:flex;flex-direction:column;gap:8px;${sheet ? 'width:100%;max-height:88vh;border-radius:14px 14px 0 0' : 'width:min(760px,96vw);max-height:84vh;border-radius:12px'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('lyricEvents.title') });
  const mk = (text, act, fn, title = '') => { const b = el('button', 'min-height:var(--ui-target,30px);min-width:var(--ui-target,30px);padding:0 10px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);border-radius:6px', { type: 'button', 'data-act': act, title: title || text, 'aria-label': title || text }); b.textContent = text; b.addEventListener('click', fn); return b; };

  const title = el('div', 'flex:1;font-weight:var(--w-semi,600);font-size:16px');
  const head = el('div', 'display:flex;align-items:center;gap:6px'); head.append(title);
  const tools = el('div', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap');
  const filter = el('select', 'min-height:var(--ui-target,30px);font:inherit', { 'data-lyric-filter': '', 'aria-label': label('lyricEvents.lines') });
  filter.addEventListener('change', () => { lineFilter = Number(filter.value); draw(); });
  const pasteBox = el('div', 'display:none;flex-direction:column;gap:6px');
  const area = el('textarea', 'width:100%;max-width:100%;resize:vertical;box-sizing:border-box;font:15px/1.4 var(--ui-font,sans-serif);padding:8px;min-height:90px;background:var(--field,#fff);color:var(--ink,#111);border:1px solid var(--edge,#bbb);border-radius:6px', { 'data-lyric-paste': '', placeholder: label('lyricEvents.pastePlaceholder') });
  area.spellcheck = false;
  const pasteHint = el('div', 'font-size:12px;opacity:.75'); pasteHint.textContent = label('lyricEvents.pasteHint');
  pasteBox.append(pasteHint, area, mk(label('lyricEvents.pasteApply'), 'lyric-paste-apply', () => applyPaste()),
    mk(label('lyricEvents.pasteKeep'), 'lyric-paste-keep', () => { // the whole text waits, no syllable is touched
      const words = parseLyricText(area.value).words; if (!words.length) { message.textContent = label('lyricEvents.pasteEmpty'); return; }
      run('Paroles : texte en attente', (mv, staff) => { appendReserve(app.doc, staff, normalizeLyricText(area.value)); return null; }, { focus: false });
      message.textContent = label('lyricEvents.kept', { n: String(words.length) }); area.value = ''; pasting = false; pasteBox.style.display = 'none'; drawReserve();
    }, label('lyricEvents.pasteKeepTip')));
  const list = el('div', 'overflow:auto;border:1px solid var(--edge,#bbb);border-radius:8px;background:var(--score,#fff);flex:1;min-height:160px', { 'data-lyric-list': '' });
  const message = el('div', 'min-height:1.2em;font-size:13px;opacity:.85', { role: 'status' });
  const close = () => { if (done) return; done = true; off?.(); window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  head.append(mk('✕', 'lyric-close', close, label('lyricEvents.close')));

  // ---- the document → rows
  const events = () => { const f = find(); return f?.staff ? lyricEventsOf(f.staff) : []; };
  const shown = () => events().filter((e) => lineFilter < 0 || e.line === lineFilter);
  const beatText = (position) => { const b = 1 + fToNumber(position) * 4; return `${Math.round(b * 100) / 100}`; };

  /** Runs one edit; the result (the event now, if any) becomes the chosen one and its text takes the focus. */
  function run(name, fn, { focus = true } = {}) {
    const f = find(); if (!f) return null;
    let result = null;
    try { result = app.edit(name, () => fn(f.mv, f.staff)) ?? null; message.textContent = ''; } catch (e) { message.textContent = e?.message ?? String(e); return null; }
    if (result?.id) selected = result.id;
    draw();
    if (focus && selected) list.querySelector(`[data-lyric-id="${selected}"] input[data-lyric-text]`)?.focus();
    return result;
  }
  const eventOf = (id) => events().find((e) => e.item.id === id);

  function row(e, i, all) {
    const r = el('div', `display:flex;align-items:center;gap:4px;padding:3px 6px;border-bottom:1px solid var(--line,#e6e1d6);${selected === e.item.id ? 'background:var(--soft,#efece4)' : ''}`, { 'data-lyric-id': e.item.id });
    r.addEventListener('focusin', () => { if (selected !== e.item.id) { selected = e.item.id; for (const x of list.children) x.style.background = x.getAttribute('data-lyric-id') === selected ? 'var(--soft,#efece4)' : ''; } });
    const f = find();
    const count = f.staff.voices[0].measures.length;
    const measure = el('input', 'width:4.2em;min-height:var(--ui-target,30px);font:inherit;text-align:center', { type: 'number', min: '1', max: String(count), step: '1', value: String(e.measure + 1), 'data-lyric-measure': '', 'aria-label': label('lyricEvents.measure') });
    measure.addEventListener('change', () => {
      const m = Math.min(count, Math.max(1, Math.trunc(Number(measure.value) || 1))) - 1;
      const length = measureLengthOf(f.mv.masterbars[m]);
      const pos = fCmp(e.position, length) < 0 ? e.position : fSub(length, STEP); // a shorter measure: the last sixteenth of it
      run('Paroles : mesure', (mv, staff) => moveLyricEvent(app.doc, mv, staff, eventOf(e.item.id), { measure: m, position: pos }));
    });
    const beat = el('span', 'width:3.6em;text-align:center;font-variant-numeric:tabular-nums', { title: label('lyricEvents.beat') }); beat.textContent = beatText(e.position);
    const step = (text, steps, tip) => mk(text, 'lyric-move', () => { if (run('Paroles : déplacer', (mv, staff) => shiftLyricEvent(app.doc, mv, staff, eventOf(e.item.id), steps), { focus: false }) === null) message.textContent = label('lyricEvents.cannotMove'); }, tip);
    const lineSel = el('select', 'min-height:var(--ui-target,30px);font:inherit', { 'data-lyric-line': '', 'aria-label': label('lyricEvents.line') });
    const used = Math.max(2, Math.min(MAX_LINE + 1, Math.max(...all.map((x) => x.line)) + 2));
    for (let n = 0; n < used; n += 1) { const o = el('option'); o.value = String(n); o.textContent = String(n + 1); if (n === e.line) o.selected = true; lineSel.append(o); }
    lineSel.addEventListener('change', () => run('Paroles : ligne', () => { setLyricEventLine(app.doc, e.item, Number(lineSel.value)); return e.item; }));
    const text = el('input', 'flex:1;min-width:6em;min-height:var(--ui-target,30px);font:16px var(--ui-font,sans-serif);padding:0 6px;background:var(--field,#fff);color:var(--ink,#111);border:1px solid var(--edge,#bbb);border-radius:4px', { type: 'text', value: e.text, 'data-lyric-text': '', 'aria-label': label('lyricEvents.text'), autocomplete: 'off' });
    text.spellcheck = false;
    text.addEventListener('change', () => { app.edit('Paroles : texte', () => setLyricEventText(app.doc, e.item, text.value)); });
    text.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      if (text.value !== e.text) app.edit('Paroles : texte', () => setLyricEventText(app.doc, e.item, text.value));
      const next = list.children[i + 1]?.querySelector('input[data-lyric-text]'); if (next) next.focus(); else addAfter(e.item.id);
    });
    const linked = el('span', 'width:1.2em;text-align:center;opacity:.8', e.target ? { title: label('lyricEvents.linked'), 'data-lyric-linked': '' } : {}); linked.textContent = e.target ? '♪' : '';
    r.append(measure, beat, linked, step('◂◂', -BEAT_STEPS, label('lyricEvents.beatEarlier')), step('◂', -1, label('lyricEvents.earlier')), step('▸', 1, label('lyricEvents.later')), step('▸▸', BEAT_STEPS, label('lyricEvents.beatLater')), lineSel, text,
      mk('✕', 'lyric-remove', () => { const next = all[i + 1] ?? all[i - 1]; selected = next?.item.id ?? null; run('Paroles : supprimer', () => { removeLyricEvent(app.doc, e.item); return null; }); }, label('lyricEvents.remove')));
    return r;
  }

  function draw() {
    const f = find(); if (!f) { close(); return; }
    const all = events(); const rows = shown();
    title.textContent = `${label('lyricEvents.title')} — ${getProperty(f.track, PID.NAME) || ''}`;
    const lines = Math.max(1, ...all.map((x) => x.line + 1));
    filter.replaceChildren(...[[-1, label('lyricEvents.allLines')], ...Array.from({ length: lines }, (_, n) => [n, label('lyricEvents.lineN', { n: String(n + 1) })])].map(([v, t]) => { const o = el('option'); o.value = String(v); o.textContent = t; if (v === lineFilter) o.selected = true; return o; }));
    const keep = list.scrollTop;
    list.replaceChildren(...(rows.length ? rows.map((e, i) => row(e, i, all)) : [Object.assign(el('div', 'padding:14px;opacity:.75'), { textContent: label('lyricEvents.empty') })]));
    if (startAt != null) { // the first drawing: the chosen syllable (a click on the score) or the first one of the measure asked for
      const own = focusId ? list.querySelector(`[data-lyric-id="${focusId}"]`) : null;
      const first = rows.findIndex((e) => e.measure >= startAt);
      const at = own ?? list.children[Math.max(0, first)];
      if (at && at.offsetTop) list.scrollTop = Math.max(0, at.offsetTop - list.offsetTop - 40);
      if (own) own.querySelector('input[data-lyric-text]')?.focus();
      startAt = null;
    } else list.scrollTop = keep;
  }

  /** A new syllable right after the chosen one (a sixteenth later), or at the start of the first measure of the song when there is none. */
  function addAfter(id) {
    const f = find(); if (!f) return;
    const base = (id && eventOf(id)) ?? events().filter((e) => lineFilter < 0 || e.line === lineFilter).at(-1) ?? null;
    const place = (base ? slotFrom(f.mv, f.staff, base, 1) : null) ?? { measure: Math.max(0, Math.min(focusMeasure, f.staff.voices[0].measures.length - 1)), position: frac(0, 1) };
    run('Paroles : ajouter', (mv, staff) => addLyricEvent(app.doc, mv, staff, { measure: place.measure, position: place.position, text: '', line: base ? base.line : Math.max(0, lineFilter) }));
  }

  function applyPaste() {
    const words = parseLyricText(area.value).words; if (!words.length) { message.textContent = label('lyricEvents.pasteEmpty'); return; } // (the markers are not syllables)
    const base = selected ? eventOf(selected) : null;
    const line = base ? base.line : Math.max(0, lineFilter);
    const startIndex = base ? events().filter((e) => e.line === line).findIndex((e) => e.item.id === base.item.id) : 0;
    let r = { replaced: 0, left: 0 };
    let kept = 0;
    run('Paroles : coller un texte', (mv, staff) => {
      r = assignWords(app.doc, staff, { line, startIndex: Math.max(0, startIndex), words });
      if (r.left) { kept = r.left; appendReserve(app.doc, staff, tailAfter(area.value, r.replaced)); } // the words that found no syllable wait (put on the notes later with « Link to notes »)
      return null;
    }, { focus: false });
    r = { replaced: r.replaced, left: 0 };
    message.textContent = kept ? label('lyricEvents.pasteWaiting', { n: String(r.replaced), kept: String(kept) }) : label('lyricEvents.pasteDone', { n: String(r.replaced), left: '0' });
    drawReserve();
    if (!r.left) { area.value = ''; pasting = false; pasteBox.style.display = 'none'; }
  }

  // the notes the syllables are put on: any staff of the movement that holds notes (the melody)
  const melodyStaves = () => { const f = find(); if (!f) return []; return f.mv.tracks.flatMap((t) => t.staves.map((s) => ({ staff: s, name: `${getProperty(t, PID.NAME) || ''} · ${getProperty(s, PID.STAFF_TYPE)}` }))).filter(({ staff }) => !['lyrics', 'chord'].includes(getProperty(staff, PID.STAFF_TYPE)) && !getProperty(staff, PID.LINKED_TO) && (staff.voices?.[0]?.measures ?? []).some((m) => m.items.some((it) => it.type === 'chord'))); };
  const melodySel = el('select', 'min-height:var(--ui-target,30px);font:inherit;max-width:14em', { 'data-lyric-melody': '', 'aria-label': label('lyricEvents.notesOf'), title: label('lyricEvents.notesOf') });
  const fillMelody = () => { const keep = melodySel.value; melodySel.replaceChildren(...melodyStaves().map(({ staff, name }) => { const o = el('option'); o.value = staff.id; o.textContent = name; return o; })); if (keep) melodySel.value = keep; };
  const linkBtn = mk(label('lyricEvents.link'), 'lyric-link', () => {
    const f = find(); const melody = melodyStaves().find((m) => m.staff.id === melodySel.value)?.staff; if (!f || !melody) { message.textContent = label('lyricEvents.noNotes'); return; }
    if (!glyphs) { message.textContent = label('lyricEvents.noNotes'); return; }
    const line = Math.max(0, lineFilter);
    openLyricsAdjust({ app, glyphs, label, staffId: melody.id, source: {
      title: label('lyricEvents.linkTitle', { n: String(line + 1) }),
      load: () => { const g = find(); return lyricLinkInfo(g.mv, g.staff, melody, line); },
      apply: (assign, spans) => { const g = find(); app.edit('Paroles : lier aux notes', () => applyLyricLinks(app.doc, g.mv, g.staff, melody, line, assign, spans)); },
    } });
  }, label('lyricEvents.linkTip'));
  const realignBtn = mk(label('lyricEvents.realign'), 'lyric-realign', () => { let r = { moved: 0, unlinked: 0 }; run('Paroles : réaligner', (mv, staff) => { r = realignLyricEvents(app.doc, mv, staff); return null; }, { focus: false }); message.textContent = label('lyricEvents.realigned', { moved: String(r.moved), unlinked: String(r.unlinked) }); }, label('lyricEvents.realignTip'));
  // the text kept waiting: a small EDITOR (phrases = lines, markers = sections) whose words « Link to notes » puts on the notes
  const reserveBox = el('div', 'display:none;flex-direction:column;gap:6px', { 'data-lyric-reserve-box': '' });
  const reserveArea = el('textarea', 'width:100%;max-width:100%;resize:vertical;box-sizing:border-box;font:15px/1.4 var(--ui-font,sans-serif);padding:8px;min-height:110px;background:var(--field,#fff);color:var(--ink,#111);border:1px solid var(--edge,#bbb);border-radius:6px', { 'data-lyric-reserve': '', 'aria-label': label('lyricEvents.reserve') });
  reserveArea.spellcheck = false;
  const reserveHint = el('div', 'font-size:12px;opacity:.75'); reserveHint.textContent = label('lyricEvents.reserveHint');
  const reserveCount = el('div', 'font-size:12px;opacity:.75', { 'data-lyric-reserve-count': '' });
  const phraseView = el('div', 'display:none;flex-direction:column;gap:6px;max-height:40vh;overflow:auto;padding:6px;border:1px solid var(--edge,#bbb);border-radius:6px;background:var(--field,#fff)', { 'data-lyric-phrases': '' });
  let phraseMode = true; // the structure view (sections as coloured blocks) is the default; the plain text is one touch away
  const saveReserve = (text) => { run('Paroles : texte en attente', (mv, staff) => { setReserve(app.doc, staff, text); return null; }, { focus: false }); drawReserve(); };
  reserveArea.addEventListener('change', () => saveReserve(reserveArea.value));
  // « Mark as… »: a marker line (`[Verse 2]`) before the line of the selection
  const kinds = LYRIC_SECTION_KINDS.map((k) => [k, label(`lyricEvents.kind.${k}`)]);
  const markMenu = createChoiceMenu({ options: kinds, value: '', label: label('lyricEvents.mark'), act: 'lyric-mark', columns: 3,
    onPick: (kind) => { const base = label(`lyricEvents.kind.${kind}`); const name = kind === 'custom' ? base : numberedName(reserveArea.value, base); saveReserve(insertMarker(reserveArea.value, reserveArea.selectionStart ?? 0, name)); } });
  markMenu.firstChild.textContent = label('lyricEvents.mark'); markMenu.title = label('lyricEvents.markTip');
  const phraseBtn = mk(label('lyricEvents.editRaw'), 'lyric-phrase-mode', () => { phraseMode = !phraseMode; drawReserve(); }, label('lyricEvents.phraseTip'));
  const autoPhrasesBtn = mk(label('lyricEvents.autoPhrases'), 'lyric-auto-phrases', () => saveReserve(suggestPhrases(reserveArea.value)), label('lyricEvents.autoPhrasesTip'));
  const reserveTools = el('div', 'display:flex;gap:6px;flex-wrap:wrap;align-items:center');
  reserveTools.append(markMenu, phraseBtn, autoPhrasesBtn, mk(label('lyricEvents.reserveLink'), 'lyric-reserve-link', () => linkBtn.click()));
  reserveBox.append(reserveHint, reserveTools, reserveArea, phraseView, reserveCount);
  let reserveOpen = false;
  const reserveBtn = mk('', 'lyric-reserve-toggle', () => { reserveOpen = !reserveOpen; drawReserve(); }, label('lyricEvents.reserveTip'));
  /**
   * The structure view: each section is a BLOCK with a coloured rule on its left (the colour of its kind, as on the cards of the form), so the start AND the end of a verse or a chorus show;
   * the words are buttons (a touch on a word starts a phrase there, or joins it to the previous one); « ¶ » before a phrase starts a section there; « ✕ » on a section name removes its marker.
   */
  function drawPhraseView(text) {
    const blocks = lyricBlocks(text);
    let markerNo = 0;
    phraseView.replaceChildren(...blocks.map((block) => {
      const color = block.marker ? defaultSectionColor(block.marker.kind, block.marker.name) : '#b8b4aa';
      const rule = `color-mix(in srgb, ${color} 100%, black 38%)`;
      const wrap = el('div', `display:flex;flex-direction:column;gap:5px;padding:6px 8px 8px;border-left:6px solid ${rule};border-radius:4px 8px 8px 4px;background:color-mix(in srgb, ${color} 22%, transparent)`, { 'data-lyric-block': block.marker?.name ?? '' });
      const head = el('div', 'display:flex;align-items:center;gap:6px');
      const pill = el('span', `font:var(--w-semi,600) 13px var(--ui-font,sans-serif);padding:1px 8px;border-radius:10px;background:${color};color:#222`, { 'data-lyric-marker': block.marker?.name ?? '' });
      pill.textContent = block.marker ? block.marker.name : label('lyricEvents.noSection');
      head.append(pill);
      if (block.marker) {
        const no = markerNo; markerNo += 1;
        const rm = mk('✕', 'lyric-marker-remove', () => saveReserve(removeMarker(text, no)), label('lyricEvents.removeMarker'));
        rm.style.minHeight = '24px'; rm.style.minWidth = '24px'; rm.style.padding = '0 6px';
        head.append(rm);
      }
      wrap.append(head);
      for (const ph of block.phrases) {
        const line = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:4px');
        const sec = createChoiceMenu({ options: kinds, value: '', label: '¶', act: 'lyric-section-here', columns: 3,
          onPick: (kind) => { const base = label(`lyricEvents.kind.${kind}`); saveReserve(insertMarkerBeforePhrase(text, ph.phrase, kind === 'custom' ? base : numberedName(text, base))); } });
        sec.firstChild.textContent = '¶'; sec.title = label('lyricEvents.sectionHere');
        line.append(sec);
        ph.words.forEach((w, k) => {
          const idx = ph.from + k;
          const b = el('button', `min-height:30px;padding:0 8px;border-radius:6px;font:15px var(--ui-font,sans-serif);${k === 0 ? 'border:2px solid var(--sel-edge,#2d78ff)' : ''}`, { type: 'button', 'data-lyric-word': String(idx) });
          b.textContent = w; b.addEventListener('click', () => { if (idx > 0) saveReserve(toggleBreakBefore(text, idx)); });
          line.append(b);
        });
        wrap.append(line);
      }
      return wrap;
    }));
  }
  function drawReserve() {
    const f = find(); const text = f?.staff ? reserveText(f.staff) : ''; const parsed = parseLyricText(text);
    reserveBtn.textContent = label('lyricEvents.reserveBtn', { n: String(parsed.words.length) });
    reserveBtn.style.display = parsed.words.length || reserveOpen ? '' : 'none';
    reserveBox.style.display = reserveOpen ? 'flex' : 'none';
    reserveArea.style.display = phraseMode ? 'none' : ''; phraseView.style.display = phraseMode ? 'flex' : 'none';
    phraseBtn.textContent = label(phraseMode ? 'lyricEvents.editRaw' : 'lyricEvents.showBlocks');
    markMenu.style.display = phraseMode ? 'none' : ''; // « Mark as… » follows the cursor of the plain text; the structure view has its own « ¶ »
    if (phraseMode) drawPhraseView(text);
    reserveCount.textContent = label('lyricEvents.reserveCount', { words: String(parsed.words.length), phrases: String(parsed.phrases.length), sections: String(parsed.sections.filter((x) => x.name).length) });
    if (document.activeElement !== reserveArea) reserveArea.value = text;
  }
  fillMelody();
  // « Unassign all »: the syllables of the line go back to the waiting text (in order), off the score; undoable
  const unassignBtn = mk(label('lyricEvents.unassign'), 'lyric-unassign', () => {
    const line = Math.max(0, lineFilter); let r = { moved: 0 };
    run('Paroles : tout désassigner', (mv, staff) => { r = unassignAll(app.doc, staff, { line }); return null; }, { focus: false });
    message.textContent = r.moved ? label('lyricEvents.unassigned', { n: String(r.moved), line: String(line + 1) }) : label('lyricEvents.unassignNone');
    drawReserve();
  }, label('lyricEvents.unassignTip'));
  tools.append(mk('＋', 'lyric-add', () => addAfter(selected), label('lyricEvents.add')), filter, melodySel, linkBtn, realignBtn, unassignBtn, reserveBtn,
    mk(label('lyricEvents.paste'), 'lyric-paste', () => { pasting = !pasting; pasteBox.style.display = pasting ? 'flex' : 'none'; if (pasting) area.focus(); }));
  box.append(head, tools, pasteBox, reserveBox, list, message);
  veil.append(box); document.body.append(veil);
  veil.addEventListener('mousedown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  const off = app.doc.subscribe(() => { if (!done && !list.contains(document.activeElement)) { draw(); drawReserve(); } }); // an undo / the score changed it: the list follows (never while a field is being typed in)
  draw(); drawReserve();
  return { close, refresh: draw, element: veil };
}
