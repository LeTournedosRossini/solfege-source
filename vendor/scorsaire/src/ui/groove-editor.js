/*
 * Editor of the drum GROOVES (model/grooves.js): a window with a grid of cells — the columns are the steps of the groove (from a quarter note down to a thirty-second note, or an eighth-note triplet;
 * a groove has 1 to 4 bars of one metre), the rows are the ROLES of the kit (hi-hat, snare, kick…). Three tabs:
 *   - "Groove": a tap on a cell goes through nothing → a hit → a ghost note → an accent → nothing; "+ Groove" adds another VERSION of it (a chorus groove…), each with its own name — the player
 *     picks the version of a bar by itself (by section of the piece);
 *   - "Breaks": the fills that may replace the end of a bar — each has its own chance and starts where the header of a column says;
 *   - "Extra hits": single hits that may be added (a ghost snare, an extra kick), each with its own chance.
 * The groove can be heard alone or with its variations. Built-in grooves are read only (duplicate to change); the others are saved at once, on this device or in the project (like the cards).
 * The variations only say what MAY happen: where and how often is decided by the card, the form of the piece and the user's rules (model/variation.js).
 */
import { createChoiceMenu } from './choice-menu.js';
import { glyphRowIcon } from './mark-icons.js';
import { groovePreviewSvg } from './notation-preview.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { createBeatGrid, snapAt, BEAT_STEPS } from '../model/beatgrid.js';
import { groupedOptions, folderNames, folderField } from './menu-groups.js';
import { DRUM_ROLES, MAX_BARS, MAX_VARIANTS, cycleHit, toggleExtra, setExtraChance, newFill, fCmp } from '../model/grooves.js';

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };
const frac = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
const METRICS = [[1, 2], [3, 4], [1, 1], [5, 4], [3, 2], [7, 8], [9, 8], [2, 1]];
const metricLabel = (l) => (l[1] === 8 ? `${l[0]}/8` : `${(l[0] * 4) / l[1]}/4`);
/** The rows shown from the start, from the top down, as the keys of a MIDI drum map go up: the pedal hi-hat at the very bottom, then the kick, the snare above it and the side stick just above, then the hi-hats, the ride, the crash and the toms; the other roles show when the groove uses them (or all of them on request). */
const COMMON_ROLES = ['tomHigh', 'tomMid', 'tomFloor', 'crash', 'ride', 'hatOpen', 'hatClosed', 'sideStick', 'snare', 'kick', 'hatPedal'];
const CW = 24; const CH = 22; const LW = 96;

export function openGrooveEditor({ app, label, glyphs = null, startId = null, trackId = null, onListen = null, onClose = null, onStop = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let selected = startId ?? (trackId ? app.trackPlayer(trackId)?.pattern ?? null : null);
  let tab = 'groove'; let fillIndex = 0; let versionIndex = 0; let message = ''; let allRoles = false;

  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-groove-editor': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;display:flex;flex-direction:column;gap:6px;max-width:96vw;max-height:92vh;overflow:auto;border-radius:8px', { role: 'dialog', 'aria-modal': 'true', 'data-resizable': 'groove-editor', 'aria-label': label('grooveEditor.title') });
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); onStop?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { on = false, title = '', disabled = false } = {}) => {
    const b = el('button', `min-height:30px;padding:0 10px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  const lab = (text) => { const s = el('span', 'font-size:12px;margin:0 6px'); s.textContent = text; return s; };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
  const nameOf = (g) => g.name ?? (g.source === 'builtin' ? label(`groove.${g.id}`) : g.id);
  const run = (fn) => { try { message = ''; const note = fn(); if (typeof note === 'string') message = note; } catch (e) { message = e.message; } draw(); };

  function draw() {
    const grooves = app.grooves();
    if (!grooves.some((g) => g.id === selected)) selected = grooves[0]?.id ?? null;
    const g = grooves.find((x) => x.id === selected);
    if (!g) { box.replaceChildren(el('div')); return; }
    const readOnly = g.source === 'builtin';
    const bars = g.bars ?? 1; const bar = g.length;
    const save = (next, note = '') => run(() => { app.saveGroove(g.source, { ...next, id: g.id }); return note; });
    // the GRID, beat by beat (model/beatgrid.js): each beat has its own number of steps (sixteenth notes, a triplet…), kept with the groove; without it, derived from the notes
    const allAts = [...g.hits, ...(g.variants ?? []).flatMap((v) => v.hits), ...(g.extras ?? []), ...(g.fills ?? []).flatMap((f) => [{ at: f.from }, ...f.hits])].map((x) => x.at);
    let bg = createBeatGrid({ barLength: bar, bars, beats: g.beats, positions: allAts, prefer: 2 });
    if (!allAts.every((at) => bg.colOf(at) !== null)) bg = createBeatGrid({ barLength: bar, bars, beats: null, positions: allAts, prefer: 2 });
    const cols = bg.cols;
    const perBar = bg.segments.filter((x) => x.bar === 0).reduce((n, x) => n + x.steps, 0); // the columns of the first bar: where the breaks and the extra hits live
    const colOf = (at) => bg.colOf(at) ?? 0;
    const atOf = (c) => bg.atOf(c);
    const quarters = (x) => (x[0] * 4) / x[1];
    // a new cut of the beats: the hits that are not on it go to the nearest step (and the editor says how many)
    const setSteps = (steps) => {
      const next = createBeatGrid({ barLength: bar, bars, beats: steps, positions: [] });
      let moved = 0;
      const snapList = (list) => { const seen = new Set(); const out = []; for (const x of list) { const s = snapAt(next, x.at); if (s.moved) moved += 1; const key = `${x.role}|${s.at[0]}/${s.at[1]}`; if (!seen.has(key)) { seen.add(key); out.push({ ...x, at: s.at }); } } return out; };
      return save({
        ...g, beats: steps, hits: snapList(g.hits), variants: (g.variants ?? []).map((v) => ({ ...v, hits: snapList(v.hits) })), extras: snapList(g.extras ?? []),
        fills: (g.fills ?? []).map((f) => { const from = snapAt(next, f.from); if (from.moved) moved += 1; return { ...f, from: from.at, hits: snapList(f.hits) }; }),
      }, moved ? label('chordPatternEditor.moved', { n: moved }) : '');
    };
    const fill = tab === 'fill' ? (g.fills ?? [])[Math.min(fillIndex, (g.fills ?? []).length - 1)] ?? null : null;
    if (tab === 'fill' && !fill) tab = 'groove';
    const variants = g.variants ?? [];
    const version = tab === 'version' ? variants[Math.min(versionIndex, variants.length - 1)] ?? null : null;
    if (tab === 'version' && !version) tab = 'groove';
    const withVersion = (patch) => ({ variants: variants.map((v) => (v === version ? { ...v, ...patch } : v)) });

    // ---- which groove
    const menu = createChoiceMenu({
      options: groupedOptions(grooves, { text: nameOf, label, browse: label('grooveEditor.groove') }), value: selected, label: label('grooveEditor.groove'), act: 'groove-pick',
      onPick: (id) => { selected = id; tab = 'groove'; fillIndex = 0; draw(); },
    });
    const name = el('input', 'font-size:16px;min-height:30px;box-sizing:border-box;flex:1 1 9em;min-width:7em', { type: 'text', 'data-key': 'groove-name', value: g.name ?? '', placeholder: label('grooveEditor.name') });
    name.disabled = readOnly; name.addEventListener('change', () => save({ ...g, name: name.value.trim() || null }));
    const copyTo = g.source === 'project' ? 'user' : 'project';
    const head = row();
    const folder = folderField({ value: g.folder ?? null, folders: folderNames(grooves.filter((x) => x.source === g.source)), label, disabled: readOnly, onChange: (f) => save({ ...g, folder: f }) });
    head.append(...[menu, name, folder,
      mk(label('chordPatternEditor.new'), 'groove-new', () => run(() => { selected = app.saveGroove('user', { name: label('grooveEditor.newName'), length: [1, 1], hits: [{ at: [0, 1], role: 'kick' }, { at: [1, 2], role: 'snare' }] }).id; tab = 'groove'; })),
      mk(label('strum.duplicate'), 'groove-duplicate', () => run(() => { selected = app.copyGroove(g.id, 'user', { fresh: true, name: `${nameOf(g)} (${label('strum.copySuffix')})` }).id; })),
      !readOnly && mk(label(`strum.copyTo.${copyTo}`), 'groove-copy', () => run(() => { selected = app.copyGroove(g.id, copyTo).id; })),
      !readOnly && mk(label('strum.delete'), 'groove-delete', () => run(() => { app.removeGroove(g.source, g.id); selected = null; })),
      trackId && mk(label('grooveEditor.use'), 'groove-use', () => run(() => app.setTrackPlayer(trackId, { pattern: g.id })), { title: label('grooveEditor.useHint') }),
      mk(label('strum.bake.close'), 'groove-close', close)].filter(Boolean));

    // ---- metre, bars, step, tabs
    const metricMenu = createChoiceMenu({
      options: METRICS.map((l) => [metricLabel(l), metricLabel(l)]), value: metricLabel(bar), label: label('chordPatternEditor.metric'), act: 'groove-metric', follow: true,
      onPick: (v) => { if (readOnly) return; const m = METRICS.find((x) => metricLabel(x) === v); save({ ...g, length: m, hits: g.hits.filter((x) => fCmp(x.at, frac(m[0] * bars, m[1])) < 0), variants: variants.map((v) => ({ ...v, hits: v.hits.filter((x) => fCmp(x.at, frac(m[0] * bars, m[1])) < 0) })).filter((v) => v.hits.length), fills: [], extras: (g.extras ?? []).filter((x) => fCmp(x.at, m) < 0) }); },
    });
    const setBars = (n) => save({ ...g, bars: n, hits: g.hits.filter((x) => fCmp(x.at, frac(bar[0] * n, bar[1])) < 0), variants: variants.map((v) => ({ ...v, hits: v.hits.filter((x) => fCmp(x.at, frac(bar[0] * n, bar[1])) < 0) })).filter((v) => v.hits.length) });
    const less = mk('−', 'bars-less', () => setBars(bars - 1), { title: label('chordPatternEditor.barsLess'), disabled: readOnly || bars <= 1 });
    const more = mk('+', 'bars-more', () => setBars(bars + 1), { title: label('chordPatternEditor.barsMore'), disabled: readOnly || bars >= MAX_BARS });
    const barsText = el('span', 'min-width:5.5em;text-align:center'); barsText.textContent = label('chordPatternEditor.bars', { n: bars });
    const setup = row();
    setup.append(lab(label('chordPatternEditor.metric')), metricMenu, less, barsText, more);
    const tabs = row();
    tabs.append(...[mk(g.mainName ?? label(variants.length ? 'grooveEditor.mainName' : 'grooveEditor.tabGroove'), 'tab-groove', () => { tab = 'groove'; draw(); }, { on: tab === 'groove' }),
      ...variants.map((v, i) => mk(v.name ?? label('grooveEditor.versionN', { n: i + 2 }), `tab-version-${i}`, () => { tab = 'version'; versionIndex = i; draw(); }, { on: tab === 'version' && versionIndex === i })),
      !readOnly && variants.length < MAX_VARIANTS && mk(`+ ${label('grooveEditor.newVersion')}`, 'version-new', () => { tab = 'version'; versionIndex = variants.length; save({ ...g, variants: [...variants, { id: `v${Date.now().toString(36)}`, name: null, hits: g.hits.map((x) => ({ ...x })) }] }); }, { title: label('grooveEditor.newVersionHint') }),
      ...(g.fills ?? []).map((f, i) => mk(f.name ?? label('grooveEditor.breakN', { n: i + 1 }), `tab-fill-${i}`, () => { tab = 'fill'; fillIndex = i; draw(); }, { on: tab === 'fill' && fillIndex === i })),
      !readOnly && mk(`+ ${label('grooveEditor.newBreak')}`, 'fill-new', () => { const next = [...(g.fills ?? []), newFill(g.fills ?? [], bar)]; tab = 'fill'; fillIndex = next.length - 1; save({ ...g, fills: next }); }),
      mk(label('grooveEditor.tabExtras'), 'tab-extras', () => { tab = 'extras'; draw(); }, { on: tab === 'extras' })].filter(Boolean));

    // ---- the options of the tab
    const options = row();
    if (tab === 'fill' && fill && !readOnly) {
      const setFill = (patch) => save({ ...g, fills: g.fills.map((f) => (f === fill ? { ...f, ...patch } : f)) });
      const fname = el('input', 'font-size:14px;min-height:28px;box-sizing:border-box;width:9em', { type: 'text', 'data-key': 'fill-name', value: fill.name ?? '', placeholder: label('grooveEditor.breakName') });
      fname.addEventListener('change', () => setFill({ name: fname.value.trim() || null }));
      const pct = el('span', 'min-width:3.5em;text-align:center'); pct.textContent = `${Math.round(fill.chance * 100)} %`;
      options.append(fname, lab(label('grooveEditor.chance')), mk('−', 'fill-chance-less', () => setFill({ chance: Math.max(0, Math.round((fill.chance - 0.05) * 100) / 100) })), pct,
        mk('+', 'fill-chance-more', () => setFill({ chance: Math.min(1, Math.round((fill.chance + 0.05) * 100) / 100) })),
        lab(label('grooveEditor.fromHint')), mk(label('grooveEditor.removeBreak'), 'fill-delete', () => { tab = 'groove'; save({ ...g, fills: g.fills.filter((f) => f !== fill) }); }));
    } else if (tab === 'version' && version && !readOnly) {
      const vname = el('input', 'font-size:14px;min-height:28px;box-sizing:border-box;width:9em', { type: 'text', 'data-key': 'version-name', value: version.name ?? '', placeholder: label('grooveEditor.versionName') });
      vname.addEventListener('change', () => save({ ...g, ...withVersion({ name: vname.value.trim() || null }) }));
      const hint2 = el('span', 'font-size:12px;color:var(--ink-soft,#555);margin-left:6px'); hint2.textContent = label('grooveEditor.versionHint');
      options.append(vname, mk(label('grooveEditor.removeVersion'), 'version-delete', () => { tab = 'groove'; save({ ...g, variants: variants.filter((v) => v !== version) }); }), hint2);
    } else if (tab === 'groove') {
      if (!readOnly && variants.length) {
        const mname = el('input', 'font-size:14px;min-height:28px;box-sizing:border-box;width:9em', { type: 'text', 'data-key': 'main-name', value: g.mainName ?? '', placeholder: label('grooveEditor.mainName') });
        mname.addEventListener('change', () => save({ ...g, mainName: mname.value.trim() || undefined }));
        options.append(mname);
      }
      options.append(el('span', 'font-size:12px;color:var(--ink-soft,#555);margin-left:6px'));
      options.lastChild.textContent = label(variants.length ? 'grooveEditor.versionsHint' : 'grooveEditor.grooveHint');
    }

    // ---- the grid
    const used = new Set([...g.hits.map((x) => x.role), ...(g.extras ?? []).map((x) => x.role), ...(g.fills ?? []).flatMap((f) => f.hits.map((x) => x.role))]);
    const roles = allRoles ? [...DRUM_ROLES] : COMMON_ROLES.concat(DRUM_ROLES.filter((r) => used.has(r) && !COMMON_ROLES.includes(r)));
    const grid = el('div', `display:grid;grid-template-columns:${LW}px repeat(${cols},${CW}px);gap:1px;align-items:center;width:max-content`);
    grid.append(el('div'));
    const barCols = (b) => bg.segments.filter((x) => x.bar === b).reduce((n, x) => n + x.steps, 0);
    const barFirst = (b) => bg.segments.find((x) => x.bar === b).firstCol;
    for (let b = 0; b < bars; b += 1) {
      const bh = el('div', `grid-column:${barFirst(b) + 2} / span ${barCols(b)};font-size:11px;border-left:2px solid var(--ink-soft,#555);padding-left:3px;min-height:${CH}px;display:flex;align-items:center`);
      bh.textContent = label('chordPatternEditor.barN', { n: b + 1 }); grid.append(bh);
    }
    // the beats: each one says how it is cut (÷4 = sixteenth notes, ÷3 = a triplet…), and a press changes it
    grid.append(el('div'));
    for (const seg of bg.segments) {
      const options = BEAT_STEPS[seg.kind].map((k) => [String(k), label(`chordPatternEditor.k.${seg.kind === 'compound' ? 'compound' : 'simple'}.${k}`)]);
      if (!options.some(([v]) => v === String(seg.steps))) options.push([String(seg.steps), `÷${seg.steps}`]);
      // the last choice carries the cut of THIS beat to all the others (of the same kind of beat)
      options.push(['all', label('chordPatternEditor.allBeats')]);
      const bm = createChoiceMenu({ options, value: String(seg.steps), label: label('chordPatternEditor.beatSteps', { n: seg.beatInBar + 1 }), act: `beat-steps-${seg.index}`, onPick: (v) => setSteps(v === 'all' ? bg.steps.map((st, i) => (bg.segments[i].kind === seg.kind ? seg.steps : st)) : bg.steps.map((st, i) => (i === seg.index ? Number(v) : st))) });
      bm.firstChild.textContent = `${seg.beatInBar + 1} ÷${seg.steps}`;
      bm.style.cssText += `;grid-column:${seg.firstCol + 2} / span ${seg.steps};min-height:${CH}px;min-width:0;padding:0 2px;font-size:11px;justify-content:center;border-left:2px solid var(--ink-soft,#555);overflow:hidden`;
      bm.disabled = readOnly; bm.setAttribute('data-beat', String(seg.index));
      grid.append(bm);
    }
    grid.append(el('div'));
    const fromCol = fill ? colOf(fill.from) : null;
    for (let c = 0; c < cols; c += 1) {
      const h = mk('·', `groove-col-${c}`, () => { if (tab === 'fill' && fill && !readOnly && c < perBar) { save({ ...g, fills: g.fills.map((f) => (f === fill ? { ...f, from: atOf(c), hits: f.hits.filter((x) => fCmp(x.at, atOf(c)) >= 0) } : f)) }); } }, { on: fill ? c === fromCol : false, title: fill ? label('grooveEditor.fromHint') : '' });
      h.style.cssText += `;min-height:${CH}px;padding:0;font-size:11px;width:${CW}px;opacity:${fill && c >= perBar ? 0.3 : 1}`;
      h.disabled = !(fill && !readOnly && c < perBar);
      grid.append(h);
    }
    const velocityOf = (list, c, role) => list.find((x) => x.role === role && bg.colOf(x.at) === c)?.velocity ?? null;
    const cellStyle = (v, faded) => {
      const base = `width:${CW}px;height:${CH}px;padding:0;border-radius:3px;border:1px solid var(--edge,#b9b4a8);`;
      if (v == null) return `${base}background:var(--field,#fff);`;
      const ghost = v <= 0.6; const accent = v > 1.05; // a hit a little softer than written is still a normal hit
      const fillColor = ghost ? 'var(--accent-soft,#cfe0ff)' : accent ? 'var(--ink,#111)' : 'var(--sel-edge,#2878ff)';
      return `${base}background:${fillColor};${ghost ? 'box-shadow:inset 0 0 0 5px var(--field,#fff);' : ''}${faded ? 'opacity:.35;' : ''}`;
    };
    for (const role of roles) {
      const rl = el('div', 'font-size:12px;padding-right:4px;text-align:right;white-space:nowrap;position:sticky;left:0;background:var(--paper,#faf8f4);z-index:1');
      rl.textContent = label(`grooveEditor.role.${role}`); grid.append(rl);
      for (let c = 0; c < cols; c += 1) {
        const at = atOf(c);
        const bar0 = c < perBar; // a fill lives in ONE bar
        let v; let faded = false; let editable = !readOnly;
        if (tab === 'groove') v = velocityOf(g.hits, c, role);
        else if (tab === 'version') v = velocityOf(version.hits, c, role);
        else if (tab === 'extras') { v = velocityOf(g.extras ?? [], c, role); editable = !readOnly && bar0 === true; if (c >= perBar) { v = null; editable = false; } }
        else if (fill) {
          if (!bar0) { v = null; editable = false; } else if (c < fromCol) { v = velocityOf(g.hits, c, role); faded = true; editable = false; } else v = velocityOf(fill.hits, c, role);
        } else v = null;
        const cell = el('button', cellStyle(v, faded), { type: 'button', 'data-cell': `${role}:${c}`, 'aria-pressed': String(v != null), 'aria-label': `${label(`grooveEditor.role.${role}`)} ${c + 1}` });
        cell.disabled = !editable;
        cell.addEventListener('click', () => {
          if (tab === 'groove') save({ ...g, hits: cycleHit(g.hits, at, role) });
          else if (tab === 'version') save({ ...g, ...withVersion({ hits: cycleHit(version.hits, at, role) }) });
          else if (tab === 'extras') save({ ...g, extras: toggleExtra(g.extras ?? [], at, role) });
          else if (fill) save({ ...g, fills: g.fills.map((f) => (f === fill ? { ...f, hits: cycleHit(f.hits, at, role) } : f)) });
        });
        grid.append(cell);
      }
    }
    const scroller = el('div', 'overflow:auto;border:1px solid var(--edge,#bbb);border-radius:6px;background:var(--score,#fff);padding:4px;max-height:44vh');
    scroller.append(grid);

    // ---- the extra hits, with their chances
    const extras = el('div', 'display:flex;flex-direction:column;gap:2px');
    if (tab === 'extras') {
      for (const [i, e] of (g.extras ?? []).entries()) {
        const r = row();
        const t = el('span', 'min-width:16em'); t.textContent = `${label(`grooveEditor.role.${e.role}`)} · ${label('grooveEditor.atPlace', { n: Math.round(quarters(e.at) * 100) / 100 + 1 })}`;
        const pct = el('span', 'min-width:3.5em;text-align:center'); pct.textContent = `${Math.round(e.chance * 100)} %`;
        r.append(t, mk('−', `extra-less-${i}`, () => save({ ...g, extras: setExtraChance(g.extras, i, e.chance - 0.05) }), { disabled: readOnly }), pct, mk('+', `extra-more-${i}`, () => save({ ...g, extras: setExtraChance(g.extras, i, e.chance + 0.05) }), { disabled: readOnly }),
          mk('✕', `extra-remove-${i}`, () => save({ ...g, extras: g.extras.filter((_, k) => k !== i) }), { disabled: readOnly }));
        extras.append(r);
      }
      if (!(g.extras ?? []).length) { const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('grooveEditor.extrasHint'); extras.append(hint); }
    }

    // ---- crash on the first bar of a section, listening, reading all roles
    const foot = row();
    const crash = mk(label('grooveEditor.crash'), 'groove-crash', () => save({ ...g, crashOnSection: g.crashOnSection === false ? undefined : false }), { on: g.crashOnSection !== false, title: label('grooveEditor.crashHint'), disabled: readOnly });
    const listenAlone = mk(`▶ ${label('grooveEditor.listenAlone')}`, 'groove-listen', () => onListen?.({ groove: g, variations: false }), { disabled: !onListen });
    const listenVaried = mk(`▶ ${label('grooveEditor.listenVaried')}`, 'groove-listen-varied', () => onListen?.({ groove: g, variations: true }), { disabled: !onListen, title: label('grooveEditor.listenVariedHint') });
    foot.append(crash, mk(label(allRoles ? 'grooveEditor.fewRoles' : 'grooveEditor.allRoles'), 'groove-roles', () => { allRoles = !allRoles; draw(); }), listenAlone, listenVaried, ...(onStop ? [mk(`■ ${label('styles.stop')}`, 'groove-stop', () => onStop())] : []));

    const err = el('div', 'color:var(--danger-ink,#b00020);min-height:1.2em', { role: 'alert' }); err.textContent = message || (readOnly ? label('grooveEditor.builtinHint') : '');
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('grooveEditor.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('grooveEditor.hint');
    // the groove written as notes (the version of the tab, without its variations)
    const notation = el('div', 'display:flex;flex-direction:column;gap:2px');
    const svg = glyphs ? groovePreviewSvg({ glyphs, groove: version ? { ...g, hits: version.hits } : g, bars: 2 }) : '';
    if (svg) {
      const cap = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); cap.textContent = label('grooveEditor.notation');
      const view = el('div', 'overflow:auto;background:var(--score,#fff);border:1px solid var(--edge,#bbb);border-radius:6px;padding:4px;max-height:26vh', { 'data-groove-notation': '' }); view.innerHTML = svg;
      notation.append(cap, view);
    }
    box.replaceChildren(title, head, setup, tabs, options, hint, scroller, notation, extras, foot, err);
  }

  document.body.append(veil);
  draw();
  return { close, refresh: draw };
}
