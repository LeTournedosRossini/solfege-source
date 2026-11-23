/*
 * The CHORD STRIP of the synchro reader (offered by the author at the export, `sync.chords`): the diagram of the chord that sounds now and of the next ones,
 * moving along with the video. The chords are the symbols of the first chord staff, placed on the time of the recording by the sync map (repeats included:
 * every played measure has its own time). The fingerings are the ones of the editor (`resolveDiagram`, own fingering > preferred > path of least movement >
 * suggestion), read from one layer of fingerings ("pool") of the work: the author fixes it, or leaves the choice to the reader. The chords are READ as the author tagged them (display tags), as written
 * or as capo shapes (`view`, model/chordview.js): the reader chooses when the work has a capo or tags. Nothing is ever written.
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty, resolveStyle } from '../model/props.js';
import { measureLengthOf } from '../model/timing.js';
import { fToNumber } from '../model/fraction.js';
import { chordSymbolsInSpan, chordPathFor, resolveDiagram, tuningOfInstrument, chordKey, playedFor } from '../model/fretdiagram.js';
import { chordSpecFromSymbol } from '../model/fretsuggest.js';
import { effectivePreferred, allPoolsOf, MAIN_POOL, POOL_ALTERNATIVES, POOL_SOURCE, variantId } from '../model/voicingpools.js';
import { sectionSpans } from '../model/sections.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { drawDiagram } from '../layout/diagramcontainer.js';
import { chordViewForDisplay } from '../layout/displayshift.js';
import { hasChordViews, capoFretByMeasure } from '../model/chordview.js';
import { renderSvgString } from '../render/svg.js';
import glyphs from '../glyphs/bravura-subset.json' with { type: 'json' };

export const CHORD_INSTRUMENTS = Object.freeze(['guitar', 'ukulele', 'piano']);
export const CHORD_GROUPS = Object.freeze(['off', 'sections', 'labels']); // `sync.chords.groups`: a name above the runs of chords of one section / one label
export const READER_CHOICE = 'reader'; // `sync.chords.pool`: the reader chooses the layer

/** The layers of fingerings the reader can choose from: [{ id, name }], the main one first, then the built-in ones (Easy PC) and the ones of the work. */
export const poolChoices = (work, mainName) => [{ id: MAIN_POOL, name: mainName }, ...allPoolsOf(work).map((p) => ({ id: p.id, name: p.name }))];

/**
 * The chords of the movement on the time of the recording: [{ t, end, chord, voicing }] sorted by time (`end` = the next chord, or the end of the recording).
 * `poolId` null / 'main' = the main fingerings. PURE of the DOM.
 */
export function chordTimeline(work, map, { instrument = 'guitar', poolId = null, view = 'author' } = {}) {
  const mv = chordViewForDisplay(work.movements[0], view); // the chords as the guitarist reads them (the display tags, or the capo shapes): the fingerings are found for THOSE chords
  if (!mv.masterbars.length) return [];
  const dict = workChordQualities(work);
  const preferred = effectivePreferred(work, poolId && poolId !== MAIN_POOL ? poolId : null);
  const path = chordPathFor(mv, instrument, { preferred, dict });
  const tuning = tuningOfInstrument(instrument);
  const spans = sectionSpans(mv);
  const pool = preferred?.[POOL_SOURCE];
  const out = [];
  for (let k = 0; k < map.playedCount; k++) {
    const w = map.writtenOf(k);
    const bar = mv.masterbars[w]; if (!bar) continue;
    const length = fToNumber(measureLengthOf(bar));
    for (const e of chordSymbolsInSpan(mv, bar.id, 1)) {
      const spec = chordSpecFromSymbol(e.chord, dict);
      if (!spec || !tuning) continue;
      const own = getProperty(e.sym, PID.VOICING);
      const chordStaff = mv.tracks.flatMap((tr) => tr.staves).find((st) => getProperty(st, PID.STAFF_TYPE) === 'chord');
      const res = resolveDiagram({ voicing: own && own.instrument === instrument ? own : null, chord: e.chord, instrument, index: getProperty(e.sym, PID.DIAGRAM_SUGGESTION) ?? 0, preferred, dict, pathVoicing: path.get(e.key) ?? null, played: instrument === 'piano' || !chordStaff ? undefined : playedFor(mv, chordStaff, e.sym, e.mi) }); // the fingering the tablature plays under this chord, when the chord staff reads one (the verse and the chorus may differ)
      if (!res) continue;
      const shownK = res.voicing ? variantId(res.voicing) : '';
      const alts = (preferred?.[POOL_ALTERNATIVES]?.[chordKey(spec, instrument, tuning)] ?? []).filter((v) => variantId(v) !== shownK); // the other fingerings of the layer that are switched on
      const ratio = Math.min(1, Math.max(0, (e.position[0] / e.position[1]) / length));
      const sp = spans.find((x) => w >= x.from && w <= x.to);
      const section = sp ? { label: (sp.label ?? '').trim(), category: sp.category, color: sp.color } : null; // sections with the same name make ONE group (the key), like the diagram lists
      const labels = shownK ? pool?.tags?.[chordKey(spec, instrument, tuning)]?.[shownK] ?? [] : []; // the labels the user gave THIS fingering (layer of the user only)
      out.push({ t: map.timeOfPlayed(k, ratio), chord: e.chord, res, alts, section, labels, id: `${k}:${e.key}` });
    }
  }
  out.sort((a, b) => a.t - b.t);
  const last = map.end();
  return out.map((c, i) => ({ ...c, end: i + 1 < out.length ? out[i + 1].t : last }));
}

/**
 * The group a chord of the timeline belongs to, for the mode 'sections' | 'labels': { key, name, color } or null (no name to show). `sectionName(category)` gives the name of a
 * section that has no label of its own. PURE.
 */
export function chordGroupOf(c, mode, sectionName = () => '') {
  if (mode === 'sections') { const s = c.section; const name = s ? s.label || sectionName(s.category) : ''; return name ? { key: name.toLowerCase(), name, color: s.color } : null; }
  if (mode === 'labels') { const name = c.labels?.[0]; return name ? { key: name.toLowerCase(), name, color: null } : null; }
  return null;
}

/** Index of the chord sounding at `time` (the last one that started), -1 before the first. */
export function chordIndexAt(timeline, time) {
  let lo = 0; let hi = timeline.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (timeline[mid].t <= time) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

const CARD_SS = 13; // pixels per staff space of a card

/** The SVG of one diagram card (the chord symbol above, the fingering below). */
function cardSvg(work, res, chord) {
  const movement = work.movements[0];
  const ctx = { glyphs, style: (sid) => resolveStyle(sid, [null, movement.style]), chordQualities: workChordQualities(work) };
  const d = drawDiagram(ctx, { res, chord, scale: 1, gauge: false, orientation: 'horizontal' });
  if (!d) return null;
  const w = d.width + d.shift * 2 + 0.4; const h = d.height + 0.4;
  const items = d.shift ? d.items.map((it) => ({ ...it, x: (it.x ?? 0) + d.shift })) : d.items;
  const layout = { systems: [{ index: 0, x0: 0, top: 0, staves: [{ originY: h - 0.2, items, lines: 0 }], overlays: [] }], width: w, height: h };
  return { svg: renderSvgString(layout, glyphs, { staffSpace: CARD_SS, margin: 2, ink: 'var(--ink, #111)', paper: 'var(--paper, #faf8f4)' }), width: w * CARD_SS + 4, height: h * CARD_SS + 4 };
}

/**
 * @param host the element the strip goes into · o.work · o.getMap() · o.player (`subscribe`, `state`) · o.t i18n lookup
 * @param o.pool the author's choice: a layer id ('main' included) or READER_CHOICE · o.upcoming how many chords follow the current one (default 3)
 * @param o.variants 'all' = a chord is drawn with ALL its active variants of the layer side by side (the author's choice), else its fingering only
 * @returns { el, destroy() }
 */
export function mountChordStrip(host, { work, getMap, player, t, pool = READER_CHOICE, upcoming = 3, variants = 'main', groups = 'off' }) {
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const KEY = 'scorsaire.sync.chords';
  let saved = {}; try { saved = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { /* no storage */ }
  const state = { instrument: CHORD_INSTRUMENTS.includes(saved.instrument) ? saved.instrument : 'guitar', pool: pool === READER_CHOICE ? saved.pool ?? MAIN_POOL : pool, view: ['original', 'capo'].includes(saved.view) ? saved.view : 'author' };
  const keep = () => { try { window.localStorage.setItem(KEY, JSON.stringify({ instrument: state.instrument, view: state.view, ...(pool === READER_CHOICE ? { pool: state.pool } : {}) })); } catch { /* kept for this page */ } };
  const root = el('div', 'margin-bottom:4px', { 'data-sr-chords': '' });
  const bar = el('div', 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:4px');
  const selCss = 'min-height:30px;font:inherit;max-width:48%';
  const instSel = el('select', selCss, { 'data-sr-chords-instrument': '', 'aria-label': t('syncreader.chordsInstrument') });
  for (const [id, key] of [['guitar', 'syncreader.instrumentGuitar'], ['ukulele', 'syncreader.chordsUkulele'], ['piano', 'syncreader.instrumentPiano']]) { const o = el('option'); o.value = id; o.textContent = t(key); instSel.append(o); }
  instSel.value = state.instrument;
  bar.append(instSel);
  const wholeMovement = work.movements[0]; // (a work with a capo or display tags: the reader may read the chords another way)
  let viewSel = null;
  if (hasChordViews(wholeMovement) || capoFretByMeasure(wholeMovement).some((f) => f > 0)) {
    viewSel = el('select', selCss, { 'data-sr-chords-view': '', 'aria-label': t('lecteur.chordView') });
    for (const m of ['author', 'original', 'capo']) { const o = el('option'); o.value = m; o.textContent = t(`lecteur.chordView.${m}`); viewSel.append(o); }
    viewSel.value = state.view; bar.append(viewSel);
  } else state.view = 'author';
  const layers = poolChoices(work, t('syncreader.chordsMainPool'));
  let poolSel = null;
  if (pool === READER_CHOICE && layers.length > 1) { // the reader chooses among the layers of fingerings of the song
    poolSel = el('select', selCss, { 'data-sr-chords-pool': '', 'aria-label': t('syncreader.chordsPool') });
    for (const l of layers) { const o = el('option'); o.value = l.id; o.textContent = l.name; poolSel.append(o); }
    if (!layers.some((l) => l.id === state.pool)) state.pool = MAIN_POOL;
    poolSel.value = state.pool; bar.append(poolSel);
  }
  const cards = el('div', 'display:flex;gap:6px;align-items:flex-end;overflow:hidden;min-height:60px', { 'data-sr-chords-cards': '' });
  root.append(bar, cards); host.append(root);

  let timeline = []; let builtFor = null; let shownKey = '';
  const rebuild = () => { const map = getMap(); const key = `${state.instrument}|${state.pool}|${state.view}`; if (builtFor?.map === map && builtFor.key === key) return; builtFor = { map, key }; timeline = chordTimeline(work, map, { instrument: state.instrument, poolId: state.pool, view: state.view }); shownKey = ''; };
  function paint(position) {
    rebuild();
    if (!timeline.length) { if (shownKey !== 'none') { cards.textContent = t('syncreader.chordsNone'); shownKey = 'none'; } return; }
    const now = Math.max(0, chordIndexAt(timeline, position));
    const key = `${builtFor.key}|${now}`; if (key === shownKey) return;
    shownKey = key;
    const runs = []; // the cards, in runs of one group (a run = a name, a rule in the colour of the section, the cards)
    const sectionName = (cat) => { const k = `syncreader.sec.${cat}`; const v = t(k); return v === k ? '' : v; };
    timeline.slice(now, now + 1 + upcoming).forEach((c, i) => {
      const card = cardSvg(work, c.res, c.chord); if (!card) return;
      const g = chordGroupOf(c, groups, sectionName);
      const prev = runs[runs.length - 1];
      let run = prev && (prev.g?.key ?? '') === (g?.key ?? '') ? prev : null;
      if (!run) { run = { g, parts: [] }; runs.push(run); }
      const parts = run.parts;
      const extra = variants === 'all' ? c.alts.map((v) => cardSvg(work, { voicing: v, source: 'preferred' }, null)).filter(Boolean) : []; // the other fingerings of the chord, without its name again
      parts.push(`<div data-sr-chord-card="${i === 0 ? 'now' : 'next'}" data-sr-variants="${extra.length}" style="flex:none;display:flex;gap:2px;align-items:flex-end;opacity:${i === 0 ? 1 : 0.55};${i === 0 ? 'outline:2px solid var(--sel-edge,#2d78ff);border-radius:6px' : ''}">${card.svg}${extra.map((x) => x.svg).join('')}</div>`);
    });
    const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    cards.innerHTML = groups === 'off' ? runs.flatMap((r) => r.parts).join('') : runs.map((r, i) => `<div data-sr-chord-group="${esc(r.g?.name ?? '')}" style="flex:none;display:flex;flex-direction:column;gap:2px;${i ? 'padding-left:6px;border-left:1px dashed var(--ink-soft,#888)' : ''}"><div style="height:16px;font:var(--w-semi,600) 12px var(--ui-font,sans-serif);white-space:nowrap;border-bottom:3px solid ${r.g?.color ?? 'transparent'};line-height:13px">${esc(r.g?.name ?? '')}</div><div style="display:flex;gap:6px;align-items:flex-end">${r.parts.join('')}</div></div>`).join('');
  }
  const off = player.subscribe((st) => paint(st.position));
  instSel.addEventListener('change', () => { state.instrument = instSel.value; keep(); paint(player.state().position); });
  viewSel?.addEventListener('change', () => { state.view = viewSel.value; keep(); paint(player.state().position); });
  poolSel?.addEventListener('change', () => { state.pool = poolSel.value; keep(); paint(player.state().position); });
  paint(player.state().position);
  return { el: root, destroy() { off(); root.remove(); } };
}
