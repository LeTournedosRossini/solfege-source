/*
 * Editor of the chord patterns (model/chordpatterns.js): the rhythm and the notes of the piano accompaniment of a chord staff, written in chord DEGREES.
 * A window with a grid of cells: the columns are the steps of the pattern (from a whole note down to a thirty-second note, a sixteenth by default; the pattern
 * has 1 to 4 bars of one metre), the rows are what a hit sounds — the bass (B), the whole chord (C) and the degrees 1 … 13 (the octave handle moves the rows
 * an octave up or down). A touch on a cell puts or removes that note in the hit of the column; the column header selects the hit to change its length, accent
 * or staccato. The pattern can be heard on a reference chord. Built-in patterns are read only (duplicate to change); the others are saved at once, on this device
 * or in the project (like the strum cards).
 * Opened from a chord staff whose card is a strumming card, the pattern is for a FRETTED instrument: no hands and no octave (the notes are placed on the neck near the hand,
 * `model/fretriff.js`), and under the grid the strings of the reference chord show the fret each hit plays.
 */
import { createChoiceMenu } from './choice-menu.js';
import { glyphRowIcon } from './mark-icons.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { patternBarLength, patternVoices, MAX_BARS, MAX_ALTS } from '../model/chordpatterns.js';
import { patternAuditionPlan } from '../audio/patternaudition.js';
import { patternPreviewSvg } from './notation-preview.js';
import { groupedOptions, folderNames, folderField } from './menu-groups.js';
import { voicingCode, voicingTuning } from '../model/fretvoicing.js';
import { createBeatGrid, retimeHits, BEAT_STEPS } from '../model/beatgrid.js';
import { fAdd, fSub, fCmp } from '../model/fraction.js';
import { downloadText } from './file-io.js';

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };
const frac = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
const METRICS = [[1, 2], [3, 4], [1, 1], [5, 4], [3, 2], [7, 8], [9, 8], [2, 1]];
const metricLabel = (l) => (l[1] === 8 ? `${l[0]}/8` : `${(l[0] * 4) / l[1]}/4`);
const DEGREE_ROWS = ['13', 'b13', '#11', '11', '#9', '9', 'b9', '8', '7', 'b7', '6', '#5', '5', 'b5', '#4', '4', '3', 'b3', '2', 'b2', '1'];
const ROOTS = [['C', 0], ['D♭', -1], ['D', 0], ['E♭', -1], ['E', 0], ['F', 0], ['F♯', 1], ['G', 0], ['A♭', -1], ['A', 0], ['B♭', -1], ['B', 0]];
const ROOT_STEP = { C: 'C', 'D♭': 'D', D: 'D', 'E♭': 'E', E: 'E', F: 'F', 'F♯': 'F', G: 'G', 'A♭': 'A', A: 'A', 'B♭': 'B', B: 'B' };
const LEFT_ROWS = ['9', '8', '7', 'b7', '6', '5', '4', '3', 'b3', '2', '1'];
const QUALITIES = ['', 'm', '7', 'M7', 'm7', 'm7b5', 'o7', 'sus4', '9', '7b9'];

export function openChordPatternEditor({ app, label, glyphs = null, startId = null, onListen = null, staffId = null, trackId = null, onClose = null, onStop = null, forInstrument = null, forCard = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  // the player this editor serves: the one of a track (the tracks panel) or the one of the track of a chord staff (its properties)
  const playerNow = () => (trackId ? app.trackPlayer(trackId) : staffId ? app.staffProperties(staffId)?.chordPlayed : null);
  let selected = startId ?? playerNow()?.pattern ?? null; let hit = null; let lengthChoice = 'cell'; let message = ''; let octave = 0; let refRoot = 'C'; let refQuality = ''; let tab = 'main'; let altIndex = 0;

  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-pattern-editor': '', 'data-zoom-lock': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;display:flex;flex-direction:column;gap:6px;${sheet ? 'width:100%;max-height:94vh;border-radius:12px 12px 0 0' : 'width:min(1000px,calc(100vw - 24px));max-height:94vh;border-radius:10px'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('chordPatternEditor.title'), ...(sheet ? {} : { 'data-resizable': 'patternEditor' }) });
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); onStop?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { on = false, title = '' } = {}) => {
    const b = el('button', `min-height:30px;padding:0 10px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.addEventListener('click', fn); return b;
  };
  const lab = (text) => { const s = el('span', 'font-size:12px;margin:0 6px'); s.textContent = text; return s; };
  const nameOf = (p) => p.name ?? (p.source === 'builtin' ? label(`chordPattern.${p.id}`) : p.id);
  const run = (fn) => { try { message = ''; const note = fn(); if (typeof note === 'string') message = note; } catch (e) { message = e.message; } draw(); };

  // exchange with another tool (model/patternfile.js): the pattern chosen, or all of the user's, written as a file; a file read back adds its patterns to this device
  const fileInput = el('input', '', { type: 'file', accept: '.json,application/json', style: 'display:none', 'data-act': 'pattern-import-file' });
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; fileInput.value = '';
    if (!file) return;
    const text = await file.text();
    run(() => {
      try {
        const r = app.importChordPatterns(text); selected = r.ids[0] ?? selected; hit = null;
        return label(r.skipped ? 'chordPatternEditor.importedSkipped' : 'chordPatternEditor.imported', { added: r.added, skipped: r.skipped });
      } catch (e) { return e?.code ? label(`patternFile.${e.code}`) : e.message; }
    });
  });
  veil.append(fileInput);

  function draw() {
    const patterns = app.chordPatterns();
    if (!patterns.some((p) => p.id === selected)) selected = patterns[0]?.id ?? null;
    const real = patterns.find((p) => p.id === selected);
    if (!real) { box.replaceChildren(el('div')); return; }
    // an ALTERNATIVE PHRASE (a variation of the pattern that replaces the end of a bar: a bass fill, a keyboard stop…) is edited in the same grid, as a pattern of ONE bar of its own
    const alts = real.alts ?? [];
    const alt = tab === 'alt' ? alts[Math.min(altIndex, alts.length - 1)] ?? null : null;
    if (tab === 'alt' && !alt) tab = 'main';
    const barOfReal = patternBarLength(real);
    const pat = alt ? { ...real, length: barOfReal, bars: 1, hits: alt.hits } : real;
    const readOnly = pat.source === 'builtin';
    // a chord staff with a strumming card plays its patterns on a fretted instrument
    const played = playerNow();
    // `forInstrument` ('piano' | 'guitar' | 'bass' …) = opened for a role (the styles window) instead of from a track: the fingering is then known without a track
    const cardId = forInstrument ? (forCard ?? (forInstrument === 'piano' ? 'piano' : null)) : played ? (played.card ?? 'piano') : 'piano';
    const fretted = forInstrument ? forInstrument !== 'piano' : !!played && (app.strumCards().find((c) => c.id === cardId)?.kind ?? 'piano') === 'strum';
    const instrument = forInstrument ?? (!fretted ? 'piano' : (played.instrument && played.instrument !== 'auto' && played.instrument !== 'piano' ? played.instrument : (played.auto ?? 'guitar')));
    const saveReal = (next, note = '') => run(() => { app.saveChordPattern(real.source, { ...next, id: real.id }); return note; });
    const save = alt ? (next, note = '') => saveReal({ ...real, alts: alts.map((a) => (a === alt ? { ...a, hits: next.hits ?? a.hits, ...(next.beats ? { beats: next.beats } : {}) } : a)) }, note) : saveReal; // in a phrase only its hits and its cut change here
    const setAlt = (patch) => saveReal({ ...real, alts: alts.map((a) => (a === alt ? { ...a, ...patch } : a)) });
    const structureLocked = readOnly || !!alt; // the metre and the number of bars belong to the pattern
    const bars = pat.bars ?? 1; const barLen = patternBarLength(pat);
    // the GRID, beat by beat (model/beatgrid.js): each beat has its own number of steps (sixteenth notes, a triplet…), kept with the pattern; without it, derived from the notes
    let bg = createBeatGrid({ barLength: barLen, bars, beats: alt ? alt.beats : real.beats, positions: pat.hits.map((x) => x.at) });
    if (!pat.hits.every((x) => bg.colOf(x.at) !== null)) bg = createBeatGrid({ barLength: barLen, bars, beats: null, positions: pat.hits.map((x) => x.at) }); // a note off the stored grid: derive it
    const cols = bg.cols;
    const colOf = (h) => bg.colOf(h.at) ?? 0;
    const lenOf = (h) => bg.cellsCovered(colOf(h), h.dur);
    const hitAt = (c) => pat.hits.find((h) => bg.colOf(h.at) === c) ?? null;
    const fromCol = alt ? bg.colOf(alt.from) ?? 0 : 0; // the first column an alternative phrase may write
    if (hit != null && !hitAt(hit)) hit = null;
    // the length of the hit being put: one step, or a note value chosen in the palette (kept for the next hits until it is changed); never past the end of the pattern
    const LENGTHS = [['1/32', [1, 32], ['metNote32ndUp']], ['1/16', [1, 16], ['metNote16thUp']], ['3/32', [3, 32], ['metNote16thUp', 'metAugmentationDot']], ['1/8', [1, 8], ['metNote8thUp']], ['3/16', [3, 16], ['metNote8thUp', 'metAugmentationDot']],
      ['1/4', [1, 4], ['metNoteQuarterUp']], ['3/8', [3, 8], ['metNoteQuarterUp', 'metAugmentationDot']], ['1/2', [1, 2], ['metNoteHalfUp']], ['3/4', [3, 4], ['metNoteHalfUp', 'metAugmentationDot']], ['1/1', [1, 1], ['metNoteWhole']]];
    const clampDur = (at, dur) => { const room = fSub(bg.total, at); return fCmp(dur, room) > 0 ? room : dur; };
    const lengthFor = (c) => (lengthChoice === 'cell' ? bg.cellLen(c) : clampDur(bg.atOf(c), LENGTHS.find((x) => x[0] === lengthChoice)?.[1] ?? bg.cellLen(c)));
    // a new cut of the beats: the notes that are not on it go to the nearest step (and the editor says how many)
    const setSteps = (steps) => {
      const next = createBeatGrid({ barLength: barLen, bars, beats: steps, positions: [] });
      const { hits, moved } = retimeHits(pat.hits, next);
      return save({ ...pat, hits, beats: steps }, moved ? label('chordPatternEditor.moved', { n: moved }) : '');
    };
    const lengthOf = (metric, n) => frac(metric[0] * n, metric[1]);
    const within = (hits, length) => hits.filter((h) => h.at[0] * length[1] < length[0] * h.at[1]);

    // ---- which pattern
    const menu = createChoiceMenu({
      options: groupedOptions(patterns, { text: nameOf, label, browse: label('chordPatternEditor.pattern') }), value: selected, label: label('chordPatternEditor.pattern'), act: 'pattern-pick',
      onPick: (id) => { selected = id; hit = null; tab = 'main'; draw(); },
    });
    const name = el('input', 'font-size:16px;min-height:30px;box-sizing:border-box;flex:1 1 9em;min-width:7em', { type: 'text', 'data-key': 'pattern-name', value: pat.name ?? '', placeholder: label('chordPatternEditor.name') });
    name.disabled = readOnly;
    name.addEventListener('change', () => saveReal({ ...real, name: name.value.trim() || null }));
    const copyTo = pat.source === 'project' ? 'user' : 'project';
    const head = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
    const folder = folderField({ value: real.folder ?? null, folders: folderNames(patterns.filter((x) => x.source === real.source)), label, disabled: readOnly, onChange: (f) => saveReal({ ...real, folder: f }) });
    head.append(...[menu, name, folder,
      mk(label('chordPatternEditor.new'), 'pattern-new', () => run(() => { selected = app.saveChordPattern('user', { name: label('chordPatternEditor.newName'), length: [1, 1], voices: { rh: 'led', lh: 'literal' }, hits: [{ at: [0, 1], dur: [1, 4], parts: ['B', 'C'] }] }).id; hit = null; })),
      mk(label('strum.duplicate'), 'pattern-duplicate', () => run(() => { selected = app.copyChordPattern(pat.id, 'user', { fresh: true, name: `${nameOf(pat)} (${label('strum.copySuffix')})` }).id; hit = null; })),
      !readOnly && mk(label(`strum.copyTo.${copyTo}`), 'pattern-copy', () => run(() => { selected = app.copyChordPattern(pat.id, copyTo).id; })),
      !readOnly && mk(label('strum.delete'), 'pattern-delete', () => run(() => { app.removeChordPattern(pat.source, pat.id); selected = null; hit = null; })),
      mk(label('chordPatternEditor.export'), 'pattern-export', () => downloadText(`${pat.id}.json`, app.exportChordPatterns({ id: pat.id }))),
      mk(label('chordPatternEditor.exportAll'), 'pattern-export-all', () => run(() => (patterns.some((x) => x.source !== 'builtin') ? downloadText('motifs.json', app.exportChordPatterns()) : label('chordPatternEditor.exportNone')))),
      mk(label('chordPatternEditor.import'), 'pattern-import', () => fileInput.click()),
      mk(label('strum.bake.close'), 'pattern-close', close)].filter(Boolean));

    // ---- metre, bars, step, octave
    const metricMenu = createChoiceMenu({
      options: METRICS.map((l) => [metricLabel(l), metricLabel(l)]), value: metricLabel(barLen), label: label('chordPatternEditor.metric'), act: 'pattern-metric', follow: true,
      onPick: (v) => { if (structureLocked) return; const m = METRICS.find((x) => metricLabel(x) === v); const length = lengthOf(m, bars); save({ ...pat, length, hits: within(pat.hits, length) }); },
    });
    const setBars = (n) => { const length = lengthOf(barLen, n); save({ ...pat, bars: n, length, hits: within(pat.hits, length) }); };
    const barsMinus = mk('−', 'bars-less', () => setBars(bars - 1), { title: label('chordPatternEditor.barsLess') }); barsMinus.disabled = structureLocked || bars <= 1;
    const barsPlus = mk('+', 'bars-more', () => setBars(bars + 1), { title: label('chordPatternEditor.barsMore') }); barsPlus.disabled = structureLocked || bars >= MAX_BARS;
    const barsText = el('span', 'min-width:5.5em;text-align:center'); barsText.textContent = label('chordPatternEditor.bars', { n: bars });
    const setupRow = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
    setupRow.append(lab(label('chordPatternEditor.metric')), metricMenu, barsMinus, barsText, barsPlus);
    const octDown = mk('▼', 'octave-down', () => { octave -= 1; draw(); }, { title: label('chordPatternEditor.octaveDown') }); octDown.disabled = octave <= -2 || (patternVoices(pat).rh === 'led' && patternVoices(pat).lh === 'led');
    const octUp = mk('▲', 'octave-up', () => { octave += 1; draw(); }, { title: label('chordPatternEditor.octaveUp') }); octUp.disabled = octave >= 2 || (patternVoices(pat).rh === 'led' && patternVoices(pat).lh === 'led');
    const octText = el('span', 'min-width:2.6em;text-align:center'); octText.textContent = octave > 0 ? `+${octave}` : String(octave);
    if (!fretted) setupRow.append(lab(label('chordPatternEditor.octave')), octDown, octText, octUp);
    if (fretted) {
      setupRow.append(lab(label('chordPatternEditor.bassDegree')));
      for (const d of ['', '1', '3', '5', '7']) {
        const b = mk(label(`chordPatternEditor.bassDegree.${d || 'card'}`), `bass-degree-${d || 'card'}`, () => save({ ...pat, bassDegree: d || undefined }), { on: (pat.bassDegree ?? '') === d, title: label('chordPatternEditor.bassDegreeHint') });
        b.disabled = structureLocked; setupRow.append(b);
      }
    }

    // ---- listening on a reference chord
    const rootMenu = createChoiceMenu({ options: ROOTS.map(([n]) => [n, n]), value: refRoot, label: label('chordPatternEditor.refRoot'), act: 'ref-root', follow: true, onPick: (v) => { refRoot = v; draw(); } });
    const qualityMenu = createChoiceMenu({ options: QUALITIES.map((q) => [q, q === '' ? label('chordPatternEditor.major') : q]), value: refQuality, label: label('chordPatternEditor.refQuality'), act: 'ref-quality', follow: true, onPick: (v) => { refQuality = v; draw(); } });
    const listenRow = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
    const alter = ROOTS.find(([n]) => n === refRoot)?.[1] ?? 0;
    const listen = mk(`▶ ${label('chordPatternEditor.listen')}`, 'pattern-listen', () => { if (onListen) onListen({ pattern: pat, root: { step: ROOT_STEP[refRoot], alter }, quality: refQuality, instrument, cardId: fretted ? cardId : null }); });
    listen.disabled = !onListen;
    listenRow.append(lab(label('chordPatternEditor.refChord')), rootMenu, qualityMenu, listen, ...(onStop ? [mk(`■ ${label('styles.stop')}`, 'pattern-stop', () => onStop())] : []));

    // ---- the grid
    const voices = patternVoices(pat);
    const degreeToken = (d, hand) => { const o = fretted || voices[hand === 'left' ? 'lh' : 'rh'] === 'led' ? 0 : octave; return `${hand === 'left' ? 'L' : ''}${d}${o === 0 ? '' : `${o > 0 ? '+' : '-'}${Math.abs(o)}`}`; };
    const rightRows = DEGREE_ROWS.map((d) => degreeToken(d, 'right')); const leftRows = LEFT_ROWS.map((d) => degreeToken(d, 'left'));
    const shown = new Set(['B', 'C', ...rightRows, ...leftRows]);
    const extra = [...new Set(pat.hits.flatMap((h) => h.parts))].filter((q) => !shown.has(q));
    const chordRow = { part: 'C', text: label(fretted && instrument !== 'bass' && instrument !== 'bass5' ? 'chordPatternEditor.rowStrum' : 'chordPatternEditor.rowChord'), strong: true, hint: label(fretted ? 'chordPatternEditor.rowChordHintFretted' : 'chordPatternEditor.rowChordHint') };
    const bassRow = { part: 'B', text: label('chordPatternEditor.rowBass'), strong: true, hint: label(fretted ? 'chordPatternEditor.rowBassHintFretted' : 'chordPatternEditor.rowBassHint') };
    const rows = fretted
      ? [...(instrument === 'bass' || instrument === 'bass5' ? [] : [{ header: 'degrees' }]), chordRow, bassRow, ...rightRows.map((q) => ({ part: q, text: q })), ...extra.map((q) => ({ part: q, text: q, extra: true }))]
      : [{ header: 'right' }, chordRow, ...rightRows.map((q) => ({ part: q, text: q })), { header: 'left' }, bassRow, ...leftRows.map((q) => ({ part: q, text: q })), ...extra.map((q) => ({ part: q, text: q, extra: true }))];
    const CW = 24; const CH = 22; const LW = 78;
    const grid = el('div', `display:grid;grid-template-columns:${LW}px repeat(${cols},${CW}px);gap:1px;align-items:center;width:max-content`);
    // bar headers: "Bar n", with a button to copy the previous bar into it
    grid.append(el('div'));
    const barCols = (b) => bg.segments.filter((x) => x.bar === b).reduce((n, x) => n + x.steps, 0);
    const barFirst = (b) => bg.segments.find((x) => x.bar === b).firstCol;
    for (let b = 0; b < bars; b += 1) {
      const bh = el('div', `grid-column:${barFirst(b) + 2} / span ${barCols(b)};display:flex;align-items:center;gap:4px;font-size:11px;border-left:2px solid var(--ink-soft,#555);padding-left:3px;min-height:${CH}px`);
      const t = el('span'); t.textContent = label('chordPatternEditor.barN', { n: b + 1 }); bh.append(t);
      if (b > 0 && !readOnly) {
        const cp = mk('⧉', `bar-copy-${b}`, () => {
          const at = (k) => frac(barLen[0] * k, barLen[1]);
          const lt = (x, y) => x[0] * y[1] < y[0] * x[1];
          const inBar = (h, k) => !lt(h.at, at(k)) && lt(h.at, at(k + 1));
          const copied = pat.hits.filter((h) => inBar(h, b - 1)).map((h) => ({ ...h, parts: [...h.parts], at: frac(h.at[0] * barLen[1] + barLen[0] * h.at[1], h.at[1] * barLen[1]) }));
          // the beats of the bar copied are cut like the beats of the bar before it
          const per = bg.segments.filter((x) => x.bar === b - 1).length;
          const steps = bg.steps.map((st, i) => (bg.segments[i].bar === b ? bg.steps[i - per] : st));
          save({ ...pat, hits: [...pat.hits.filter((h) => !inBar(h, b)), ...copied], beats: steps });
        }, { title: label('chordPatternEditor.copyBar', { n: b }) });
        cp.style.cssText += ';min-height:18px;padding:0 6px;font-size:11px'; bh.append(cp);
      }
      grid.append(bh);
    }
    // the beats: each one says how it is cut (÷4 = sixteenth notes, ÷3 = a triplet…), and a press changes it
    grid.append(el('div'));
    for (const s of bg.segments) {
      const options = BEAT_STEPS[s.kind].map((k) => [String(k), label(`chordPatternEditor.k.${s.kind === 'compound' ? 'compound' : 'simple'}.${k}`)]);
      if (!options.some(([v]) => v === String(s.steps))) options.push([String(s.steps), `÷${s.steps}`]);
      // the last choice carries the cut of THIS beat to all the others (of the same kind of beat)
      options.push(['all', label('chordPatternEditor.allBeats')]);
      const bm = createChoiceMenu({ options, value: String(s.steps), label: label('chordPatternEditor.beatSteps', { n: s.beatInBar + 1 }), act: `beat-steps-${s.index}`, onPick: (v) => setSteps(v === 'all' ? bg.steps.map((st, i) => (bg.segments[i].kind === s.kind ? s.steps : st)) : bg.steps.map((st, i) => (i === s.index ? Number(v) : st))) });
      bm.firstChild.textContent = `${s.beatInBar + 1} ÷${s.steps}`;
      bm.style.cssText += `;grid-column:${s.firstCol + 2} / span ${s.steps};min-height:${CH}px;min-width:0;padding:0 2px;font-size:11px;justify-content:center;border-left:2px solid var(--ink-soft,#555);overflow:hidden`;
      bm.disabled = readOnly; bm.setAttribute('data-beat', String(s.index));
      grid.append(bm);
    }
    grid.append(el('div'));
    for (let c = 0; c < cols; c += 1) {
      const h = hitAt(c);
      const head2 = mk('·', `pattern-col-${c}`, () => { hit = h ? (hit === c ? null : c) : hit; draw(); }, { on: hit === c });
      head2.style.cssText += `;min-height:${CH}px;padding:0;font-size:11px;width:${CW}px;opacity:${h ? 1 : 0.55}`;
      if (!h) head2.disabled = true;
      grid.append(head2);
    }
    if (fretted && instrument !== 'bass' && instrument !== 'bass5') {
      // the direction of the strum of each hit, under the numbers of the beats: empty = the card decides (down, or alternating), ↓ down, ↑ up; a press goes to the next
      const sl = el('div', 'font-size:12px;font-weight:var(--w-semi,600);padding-right:4px;text-align:right;white-space:nowrap;position:sticky;left:0;background:var(--paper,#faf8f4);z-index:1', { title: label('chordPatternEditor.strokeHint') });
      sl.textContent = '↓↑'; grid.append(sl);
      const NEXT = { '': 'down', down: 'up', up: '' };
      for (let c = 0; c < cols; c += 1) {
        const h = hitAt(c); const v = h?.stroke ?? '';
        const b = mk(v === 'up' ? '↑' : v === 'down' ? '↓' : '', `hit-stroke-${c}`, () => save({ ...pat, hits: pat.hits.map((x) => (x === h ? { ...x, stroke: NEXT[v] || undefined } : x)) }), { on: !!v, title: label('chordPatternEditor.strokeHint') });
        b.style.cssText += `;min-height:${CH}px;padding:0;font-size:13px;width:${CW}px;opacity:${h ? 1 : 0.3}`;
        b.disabled = !h || readOnly; grid.append(b);
      }
    }
    for (const row of rows) {
      if (row.header) {
        const hand = row.header; const key = hand === 'left' ? 'lh' : 'rh';
        const hh = el('div', 'grid-column:1 / -1;display:flex;align-items:center;gap:var(--btn-gap,2px);position:sticky;left:0;margin-top:4px;font-weight:var(--w-semi,600);font-size:13px;border-bottom:1px solid var(--edge,#b9b4a8)');
        const t = el('span', 'margin-right:6px'); t.textContent = label(hand === 'left' ? 'chordPatternEditor.handLeft' : hand === 'degrees' ? 'chordPatternEditor.degrees' : 'chordPatternEditor.handRight'); hh.append(t);
        for (const mode of hand === 'degrees' ? [] : ['led', 'literal']) {
          const b = mk(label(mode === 'led' ? 'chordPatternEditor.modeLed' : 'chordPatternEditor.modeLiteral'), `mode-${key}-${mode}`, () => save({ ...pat, voices: { ...voices, [key]: mode } }), { on: voices[key] === mode, title: label(mode === 'led' ? 'chordPatternEditor.modeLedHint' : 'chordPatternEditor.modeLiteralHint') });
          b.style.cssText += ';min-height:22px;padding:0 8px;font-size:12px'; b.disabled = readOnly; hh.append(b);
        }
        grid.append(hh); continue;
      }
      const rl = el('div', `font-size:12px;${row.strong ? 'font-weight:var(--w-semi,600);' : ''}${row.extra ? 'font-style:italic;' : ''}padding-right:4px;text-align:right;white-space:nowrap;position:sticky;left:0;background:var(--paper,#faf8f4);z-index:1`);
      rl.textContent = row.text; if (row.hint) rl.title = row.hint; grid.append(rl);
      for (let c = 0; c < cols; c += 1) {
        const h = hitAt(c);
        const on = !!h && h.parts.includes(row.part);
        const tail = !on && pat.hits.some((o) => { const oc = colOf(o); return oc < c && c < oc + lenOf(o) && o.parts.includes(row.part); });
        const seg = bg.segmentOfCol(c); const edge = c === seg.firstCol ? (seg.beatInBar === 0 ? 'border-left:2px solid var(--ink-soft,#555);' : 'border-left-width:2px;') : '';
        const cell = el('button', `width:${CW}px;height:${CH}px;padding:0;border-radius:3px;border:1px solid var(--edge,#b9b4a8);${edge}background:${on ? 'var(--sel-edge,#2878ff)' : tail ? 'var(--accent-soft,#cfe0ff)' : 'var(--field,#fff)'}`, { type: 'button', 'data-cell': `${row.part}:${c}`, 'aria-pressed': String(on), 'aria-label': `${row.text} ${c + 1}` });
        cell.disabled = readOnly || (!!alt && c < fromCol); if (alt && c < fromCol) cell.style.opacity = '0.35';
        cell.addEventListener('click', () => {
          const hits = pat.hits.map((x) => ({ ...x, parts: [...x.parts] }));
          const here = hits.find((x) => bg.colOf(x.at) === c);
          if (here) {
            here.parts = here.parts.includes(row.part) ? here.parts.filter((q) => q !== row.part) : [...here.parts, row.part];
            if (!here.parts.length) hits.splice(hits.indexOf(here), 1);
          } else hits.push({ at: bg.atOf(c), dur: lengthFor(c), parts: [row.part] });
          if (!hits.length) { message = label('chordPatternEditor.lastHit'); draw(); return; }
          hit = hits.some((x) => bg.colOf(x.at) === c) ? c : null;
          save({ ...pat, hits });
        });
        grid.append(cell);
      }
    }
    // ---- fretted: the strings of the reference chord, the fret each hit plays (the same planner as the playback)
    if (fretted) {
      let preview = null;
      try { preview = patternAuditionPlan({ pattern: pat, root: { step: ROOT_STEP[refRoot], alter }, quality: refQuality, cardId, cards: app.strumCards().filter((c) => c.source !== 'builtin'), instrument, cycles: 1 }); } catch { preview = null; }
      const th = el('div', 'grid-column:1 / -1;display:flex;align-items:center;gap:8px;position:sticky;left:0;margin-top:6px;font-weight:var(--w-semi,600);font-size:13px;border-bottom:1px solid var(--edge,#b9b4a8)');
      const tt = el('span'); tt.textContent = label('chordPatternEditor.tab'); th.append(tt);
      const code = el('span', 'font-weight:normal;font-size:12px'); code.textContent = preview?.voicing ? label('chordPatternEditor.tabFingering', { code: voicingCode(preview.voicing.frets) }) : label('chordPatternEditor.tabNoFingering'); th.append(code);
      grid.append(th);
      const tuning = preview?.voicing ? voicingTuning(preview.voicing) : [];
      const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
      const cells = new Map(); const off = new Map();
      for (const ev of preview?.events ?? []) {
        const c = bg.colOf(fAdd(frac(barLen[0] * ev.measure, barLen[1]), ev.position)) ?? 0;
        for (const n of ev.notes) {
          if (n.string === null || n.string === undefined) { off.set(c, [...(off.get(c) ?? []), { text: NAMES[((n.pitch % 12) + 12) % 12] }]); continue; }
          const key = `${n.string}:${c}`; cells.set(key, { text: n.fret == null ? '·' : String(n.fret), source: n.source });
        }
      }
      const tabRow = (text, at, title = '') => {
        const rl = el('div', 'font-size:12px;padding-right:4px;text-align:right;white-space:nowrap;position:sticky;left:0;background:var(--paper,#faf8f4);z-index:1'); rl.textContent = text; if (title) rl.title = title; grid.append(rl);
        for (let c = 0; c < cols; c += 1) {
          const v = at(c);
          const cell = el('div', `width:${CW}px;height:${CH}px;display:flex;align-items:center;justify-content:center;font-size:12px;border-bottom:1px solid var(--edge,#b9b4a8);${c === bg.segmentOfCol(c).firstCol && bg.segmentOfCol(c).beatInBar === 0 ? 'border-left:2px solid var(--ink-soft,#555);' : ''}${v?.source === 'free' ? 'font-style:italic;' : ''}${v?.danger ? 'color:var(--danger-ink,#b00020);' : ''}`, { 'data-tab': '' });
          if (v) cell.textContent = v.text; grid.append(cell);
        }
      };
      for (let s2 = tuning.length - 1; s2 >= 0; s2 -= 1) tabRow(NAMES[tuning[s2] % 12], (c) => cells.get(`${s2}:${c}`));
      if (off.size) tabRow(label('chordPatternEditor.tabOff'), (c) => (off.get(c) ? { text: off.get(c).map((x) => x.text).join(' '), danger: true } : null), label('chordPatternEditor.tabOffHint'));
    }
    const scroller = el('div', 'overflow:auto;border:1px solid var(--edge,#bbb);border-radius:6px;background:var(--score,#fff);padding:4px;max-height:44vh');
    scroller.append(grid);

    // ---- the length of the hits: the note value the next hits get (kept until it is changed), and of the selected hit
    const lengthRow = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
    const picked = hit != null ? hitAt(hit) : null;
    lengthRow.append(lab(label('chordPatternEditor.length')), mk(label('chordPatternEditor.lengthCell'), 'length-cell', () => { lengthChoice = 'cell'; if (picked && !readOnly) { save({ ...pat, hits: pat.hits.map((x) => (x === picked ? { ...x, dur: bg.cellLen(colOf(picked)) } : x)) }); } else draw(); }, { on: lengthChoice === 'cell', title: label('chordPatternEditor.lengthHint') }));
    for (const [key, value, glyphNames] of [...LENGTHS].reverse()) { // the long values on the left (whole note first), the short ones on the right
      const b = mk('', `length-${key.replace('/', '-')}`, () => { lengthChoice = key; if (picked && !readOnly) { save({ ...pat, hits: pat.hits.map((x) => (x === picked ? { ...x, dur: clampDur(x.at, value) } : x)) }); } else draw(); }, { on: lengthChoice === key, title: label(`chordPatternEditor.len.${key.replace('/', '-')}`) });
      const icon = glyphs ? glyphRowIcon(glyphs, glyphNames, { side0: 3.6, px: 20 }) : null;
      if (icon) { b.append(icon); b.style.padding = '0 6px'; } else b.textContent = key;
      b.disabled = readOnly && false; lengthRow.append(b);
    }
    // ---- the selected hit
    const h = hit != null ? hitAt(hit) : null;
    const hitRow = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center;min-height:34px');
    if (h && !readOnly) {
      const k = lenOf(h); const max = cols - colOf(h);
      const setHit = (patch) => save({ ...pat, hits: pat.hits.map((x) => (x === h ? { ...x, ...patch } : x)) });
      const durText = el('span', 'min-width:5.5em;text-align:center'); durText.textContent = label('chordPatternEditor.cells', { n: k });
      const minus = mk('−', 'hit-shorter', () => setHit({ dur: fSub(bg.atOf(colOf(h) + k - 1), h.at) }), { title: label('chordPatternEditor.shorter') }); minus.disabled = k <= 1;
      const plus = mk('+', 'hit-longer', () => setHit({ dur: fSub(bg.atOf(colOf(h) + k + 1), h.at) }), { title: label('chordPatternEditor.longer') }); plus.disabled = k >= max;
      hitRow.append(lab(label('chordPatternEditor.hit', { n: colOf(h) + 1 })), minus, durText, plus,
        mk(label('chordPatternEditor.accent'), 'hit-accent', () => setHit(h.accent ? { accent: false } : { accent: true }), { on: !!h.accent }),
        mk(label('chordPatternEditor.staccato'), 'hit-staccato', () => setHit(h.staccato ? { staccato: false } : { staccato: true }), { on: !!h.staccato }));
    } else hitRow.append(lab(label(readOnly ? 'chordPatternEditor.builtinHint' : 'chordPatternEditor.selectHint')));

    const err = el('div', 'color:var(--danger-ink,#b00020);min-height:1.2em', { role: 'alert' }); err.textContent = message;
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('chordPatternEditor.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label(fretted ? 'chordPatternEditor.hintFretted' : 'chordPatternEditor.hint');
    // the pattern written as notes on the reference chord (piano; a fretted instrument shows the strings of the chord instead)
    const notation = el('div', 'display:flex;flex-direction:column;gap:2px');
    if (!fretted && glyphs) {
      const svg = patternPreviewSvg({ glyphs, pattern: pat, root: { step: ROOT_STEP[refRoot], alter }, quality: refQuality, cardId, cards: app.strumCards().filter((c) => c.source !== 'builtin'), instrument: 'piano', bars: 2 });
      if (svg) {
        const cap = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); cap.textContent = label('chordPatternEditor.notation');
        const view = el('div', 'overflow:auto;background:var(--score,#fff);border:1px solid var(--edge,#bbb);border-radius:6px;padding:4px;max-height:30vh', { 'data-pattern-notation': '' }); view.innerHTML = svg;
        notation.append(cap, view);
      }
    }
    // ---- the pattern and its alternative phrases (tabs), and what a phrase says about itself
    const altTabs = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
    altTabs.append(mk(label('chordPatternEditor.tabMain'), 'tab-main', () => { tab = 'main'; hit = null; draw(); }, { on: tab === 'main' }),
      ...alts.map((a, i) => mk(a.name ?? label('cues.altN', { n: i + 1 }), `tab-alt-${i}`, () => { tab = 'alt'; altIndex = i; hit = null; draw(); }, { on: tab === 'alt' && altIndex === i })),
      ...(!readOnly && alts.length < MAX_ALTS ? [mk(`+ ${label('chordPatternEditor.newAlt')}`, 'alt-new', () => {
        const from = barOfReal[0] * 4 > barOfReal[1] * 3 ? [3, 4] : [1, 2]; // the last beat of a bar longer than 3/4, else its second half
        const mainBar = real.hits.filter((h) => h.at[0] * barOfReal[1] < barOfReal[0] * h.at[1]); // the hits of the first bar
        const start = mainBar.filter((h) => h.at[0] * from[1] >= from[0] * h.at[1]).map((h) => ({ ...h, parts: [...h.parts] }));
        const first = start.length ? start : [{ at: from, dur: [1, 8], parts: ['B'] }];
        tab = 'alt'; altIndex = alts.length;
        saveReal({ ...real, alts: [...alts, { id: `alt${Date.now().toString(36)}`, name: null, chance: 0, from, hits: first }] });
      }, { title: label('chordPatternEditor.newAltHint') })] : []));
    const altRow = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
    if (alt && !readOnly) {
      const aname = el('input', 'font-size:14px;min-height:28px;box-sizing:border-box;width:9em', { type: 'text', 'data-key': 'alt-name', value: alt.name ?? '', placeholder: label('chordPatternEditor.altName') });
      aname.addEventListener('change', () => setAlt({ name: aname.value.trim() || null }));
      const pct = el('span', 'min-width:3.5em;text-align:center'); pct.textContent = `${Math.round(alt.chance * 100)} %`;
      const fromText = el('span', 'min-width:4.5em;text-align:center'); fromText.textContent = label('chordPatternEditor.altFromStep', { n: fromCol + 1 });
      const moveFrom = (d) => { const c = Math.max(0, Math.min(cols - 1, fromCol + d)); const at = bg.atOf(c); setAlt({ from: at, hits: alt.hits.filter((h) => h.at[0] * at[1] >= at[0] * h.at[1]) }); };
      altRow.append(aname, lab(label('chordPatternEditor.altChance')), mk('−', 'alt-chance-less', () => setAlt({ chance: Math.max(0, Math.round((alt.chance - 0.05) * 100) / 100) })), pct,
        mk('+', 'alt-chance-more', () => setAlt({ chance: Math.min(1, Math.round((alt.chance + 0.05) * 100) / 100) })),
        lab(label('chordPatternEditor.altFrom')), mk('−', 'alt-from-less', () => moveFrom(-1), { title: label('chordPatternEditor.altFromHint') }), fromText, mk('+', 'alt-from-more', () => moveFrom(1), { title: label('chordPatternEditor.altFromHint') }),
        mk(label('chordPatternEditor.altRemove'), 'alt-delete', () => { tab = 'main'; saveReal({ ...real, alts: alts.filter((a) => a !== alt) }); }));
      const ah = el('div', 'font-size:12px;color:var(--ink-soft,#555);flex-basis:100%'); ah.textContent = label('chordPatternEditor.altHint'); altRow.append(ah);
    }
    box.replaceChildren(title, head, altTabs, altRow, setupRow, listenRow, hint, lengthRow, scroller, hitRow, notation, err);
  }

  document.body.append(veil);
  draw();
  return { close, refresh: draw };
}
