/*
 * Barre de saisie de notes (DOM) : mode « saisie » (crayon), noire / croche / double croche, silence, point, liaison, puis un bouton cyclique pour les autres durées (blanche → ronde → triple → quadruple croche), la voix (cyclique 1-4), annuler / refaire, la grille, et un tiroir accordéon (Basse / Accord / 1-2 voix) qui n'existe que sur la main gauche de l'accordéon. Quand la place manque, les boutons les moins utiles passent derrière « › » (priorités ci-dessous).  (La frette d'une tablature se choisit dans la barre FLOTTANTE de `ui/dom.js`.) Elle ne fait que lire / écrire l'ÉTAT DE SAISIE de l'Application (`app.setNoteEntry`) ; le geste (clic sur la portée) est
 * dans `ui/dom.js`.
 *
 * EMPLACEMENT FACILE À CHANGER : `placement` — 'bottom' (défaut : fixée en bas de l'écran, sous le pouce sur tablette) ou 'inline' (dans le
 * flux de la page, là où se trouve son conteneur). Le bouton ⇅ de la barre bascule entre les deux ; l'emplacement est retenu dans le navigateur
 * (`localStorage`, facultatif). Pas de barre flottante pour l'instant (décision de Jean) : à reprendre après essai tactile.
 */

import { isPhone } from './device-class.js';
import { mountUndoRedo } from './undoredo-dom.js';
import { counterZoom } from './float-place.js';
import { applyIconName, applyTextIcon, icon } from './icons.js';
import { drumHeadGlyph } from '../model/drumheads.js';
import { glyphRowIcon, commonSide, drawnById } from './mark-icons.js';
import { markCyclic, markLongPress, bindShortLong } from './button-behavior.js';
import { NoteEntryError, EditError } from './noteentry-intents.js';

const NS = 'http://www.w3.org/2000/svg';
const PLACE_KEY = 'scorsaire-noteentry-bar-place';
export const DURATIONS = [
  ['sixtyfourth', 'metNote64thUp'], ['thirtysecond', 'metNote32ndUp'], ['sixteenth', 'metNote16thUp'], ['eighth', 'metNote8thUp'],
  ['quarter', 'metNoteQuarterUp'], ['half', 'metNoteHalfUp'], ['whole', 'metNoteWhole'], ['breve', 'metNoteDoubleWhole'],
];
const UNITS_PER_SPACE = 250; // chemins de glyphes en unités de police (1000 par em, 4 espaces par em)

/** Bravura glyph of the subset as a small SVG centred in a square box of `height` pixels (name kept for the other bars). */
export function glyphIcon(glyphs, name, height = 30, side0 = 0) {
  return glyphRowIcon(glyphs, [name], { side0, px: height }) ?? document.createElementNS(NS, 'svg');
}

/**
 * All the heads of a switch in ONE small cluster that fits inside a button: 2 sounds side by side, 3 in a triangle (the first on top), more in two columns.
 * The current sound is black and a little bigger, the others light brown; the name of the sound is in the button tooltip.
 */
export function drumSwitchIcons(glyphs, heads, index) {
  const box = document.createElement('span');
  box.style.cssText = 'display:inline-grid;grid-template-columns:repeat(2,auto);justify-items:center;align-items:center;column-gap:1px;row-gap:0;line-height:0';
  heads.forEach((h, i) => {
    const on = i === index;
    const ic = glyphRowIcon(glyphs, [drumHeadGlyph(h, 'quarter')], { side0: 1.3, px: on ? 13 : 10 });
    if (!ic) return;
    const cell = document.createElement('span');
    cell.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:13px;height:12px;color:${on ? 'var(--ink,#1c1b1a)' : 'var(--edge,#b9b4a8)'}${heads.length === 3 && i === 0 ? ';grid-column:1 / span 2' : ''}`;
    cell.append(ic); box.append(cell);
  });
  return box;
}

// The choice made with the ⇅ button is kept in the browser (localStorage, optional): some people prefer the bar above the score.
const readPlace = (fallback) => { try { const v = window.localStorage?.getItem(PLACE_KEY); return v === 'inline' || v === 'bottom' ? v : fallback; } catch { return fallback; } };
const savePlace = (v) => { try { window.localStorage?.setItem(PLACE_KEY, v); } catch { /* optional */ } };

/**
 * @param host   élément qui reçoit la barre
 * @param o.dock  bottom dock (`dock-dom.js`): the bar then lives in its bottom row after the pencil and the file button, shows its buttons only while the entry is on, and the undo / redo buttons go to the dock's top row
 * @param o.app  Application ; o.glyphs : données Bravura ; o.label : (clé, params) → texte ; o.placement : 'bottom' | 'inline'; o.viewId : vue dont les gestes clavier (liaison) sont lus
 * @returns {{ message(text), destroy() }}
 */
export const DURATION_CYCLE = ['half', 'whole', 'thirtysecond', 'sixtyfourth']; // the durations behind the cyclic button
const CYCLE = DURATION_CYCLE;
const GLYPH_OF = Object.fromEntries(DURATIONS);

export function mountNoteEntryBar(host, { app, glyphs, label = (k) => k, placement = 'bottom', grid = null, viewId = 'main', dock = null, fileButton = null }) {
  const bar = document.createElement('div');
  bar.setAttribute('data-note-entry-bar', '');
  bar.setAttribute('data-dismiss-keep', ''); // the bar fixed at the bottom is not a transient panel: it keeps the open panels
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', label('noteEntry.bar'));
  const btn = (title, fn, attrs = {}) => {
    const b = document.createElement('button');
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.style.cssText = 'width:var(--ui-target,44px);height:var(--ui-target,44px);flex:none;display:inline-flex;align-items:center;justify-content:center;font:16px var(--ui-font,sans-serif);padding:0;cursor:pointer;position:relative';
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    b.addEventListener('click', fn);
    return b;
  };
  // the long-label buttons (Basse / Accord / 1 voix) are the only ones that are not square
  const wide = (b) => { b.style.width = 'auto'; b.style.minWidth = 'var(--ui-target,44px)'; b.style.padding = '2px 8px'; };
  const toggle = btn(label('noteEntry.toggleOn'), () => app.setNoteEntry({ active: !app.noteEntry().active }), { 'data-action': 'entry-toggle', 'data-dismiss-keep': '' });
  toggle.append(drawnById('entry:toggle') ?? label('noteEntry.toggle'));
  const DURATION_SIDE = commonSide(glyphs, [...DURATIONS.map(([, g]) => g), 'restQuarter']);
  const durIcon = (base) => glyphRowIcon(glyphs, [GLYPH_OF[base]], { side0: DURATION_SIDE }) ?? '';
  const setBase = (base) => { try { app.chooseEntryDuration({ base, dots: app.noteEntry().duration.dots }, viewId); } catch (e) { say(e.message); } };
  const fixedDur = ['quarter', 'eighth', 'sixteenth'].map((base) => {
    const b = btn(label(`noteEntry.dur.${base}`), () => setBase(base), { 'data-duration': base });
    b.append(durIcon(base));
    return b;
  });
  // computers: one button per duration (whole, half above the quarter; 32nd, 64th below the 16th) instead of the cyclic one
  const pcDur = (base) => { const b = btn(label(`noteEntry.dur.${base}`), () => setBase(base), { 'data-duration': base }); b.append(durIcon(base)); return b; };
  const pcTop = ['whole', 'half'].map(pcDur); const pcBottom = ['thirtysecond', 'sixtyfourth'].map(pcDur);
  const onPc = () => !!dock && dock.inHeader();
  // cyclic duration: half → whole → 32nd → 64th; the first tap selects the duration shown, the next ones advance
  let cycleIdx = 0;
  const cycle = btn(label('noteEntry.dur.cycle'), () => {
    const cur = app.noteEntry().duration.base;
    // notes or rests are selected and do not have the value shown yet: the first tap gives it to them (it must not advance past it: a half note shown, a half asked)
    const sel = app.selectionDurationBase?.(viewId);
    const pending = sel !== null && sel !== undefined && sel !== CYCLE[cycleIdx];
    if (cur === CYCLE[cycleIdx] && !pending) cycleIdx = (cycleIdx + 1) % CYCLE.length;
    setBase(CYCLE[cycleIdx]);
  }, { 'data-action': 'entry-duration-cycle' });
  const paintCycle = () => { cycle.replaceChildren(durIcon(CYCLE[cycleIdx])); cycle.setAttribute('data-duration', CYCLE[cycleIdx]); cycle.title = label(`noteEntry.dur.${CYCLE[cycleIdx]}`); cycle.setAttribute('aria-label', cycle.title); markCyclic(cycle, CYCLE.length, cycleIdx); };
  const dot = btn(label('noteEntry.dot'), () => { const d = app.noteEntry().duration; try { app.chooseEntryDuration({ base: d.base, dots: d.dots ? 0 : 1 }, viewId); } catch (e) { say(e.message); } }, { 'data-action': 'entry-dot' });
  dot.replaceChildren(glyphRowIcon(glyphs, ['metAugmentationDot'], { side0: 1.6 }) ?? '•');
  const rest = btn(label('noteEntry.rest'), () => app.setNoteEntry({ rest: !app.noteEntry().rest }), { 'data-action': 'entry-rest' });
  rest.append(glyphRowIcon(glyphs, ['restQuarter'], { side0: DURATION_SIDE }) ?? '');
  const status = document.createElement('span');
  status.setAttribute('data-entry-message', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'display:none;font:14px var(--ui-font,sans-serif);padding:0 4px 4px';
  const say = (text) => { status.textContent = text ?? ''; status.style.display = text ? 'block' : 'none'; fit(); };
  const describe = (err) => {
    if (err instanceof NoteEntryError) { const key = `noteEntry.error.${err.code}`; const text = label(key); return text === key ? label('noteEntry.error.other', { message: err.message }) : text; }
    if (err instanceof EditError) return label('noteEntry.error.other', { message: err.message });
    return null;
  };
  // tie (key T): while entering, re-places the notes of the selected chord tied; otherwise toggles the tie on the selection
  const tie = btn(label('noteEntry.tie'), () => {
    try {
      const r = app.keyboardEntry({ type: 'tie' }, viewId);
      say(['tied', 'untied', 'none'].includes(r?.action) ? label(`noteEntry.${r.action}`) : '');
    } catch (e) { const text = describe(e); if (text === null) throw e; say(text); }
  }, { 'data-action': 'entry-tie' });
  tie.append(drawnById('span:slur') ?? '⌒');
  // voice: ONE cyclic button 1 → 4 (a short press goes to the next voice, a long press to the previous one)
  const voiceText = document.createElement('span'); voiceText.style.cssText = 'font-weight:var(--w-bold,700);pointer-events:none';
  const voice = btn(label('noteEntry.voice.cycle'), () => {}, { 'data-action': 'entry-voice' });
  voice.append(voiceText);
  const stepVoice = (d) => { const v = app.noteEntry().voice ?? 0; app.setNoteEntry({ voice: (v + d + 4) % 4 }); };
  bindShortLong(voice, { onShort: () => stepVoice(1), onLong: () => stepVoice(-1) });
  markLongPress(voice);
  // computers: the four voices as buttons side by side in a small outlined group captioned « Vx » (no cyclic button)
  const voiceBtns = [0, 1, 2, 3].map((i) => {
    const b = btn(label('noteEntry.voice.n', { n: i + 1 }), () => app.setNoteEntry({ voice: i }), { 'data-action': 'entry-voice-n', 'data-voice': String(i) });
    b.textContent = String(i + 1); b.style.fontWeight = 'bold'; b.style.width = '26px'; b.style.minWidth = '0'; b.style.height = '26px'; b.style.padding = '0';
    return b;
  });
  const voiceRow = document.createElement('div'); voiceRow.style.cssText = 'display:flex;gap:2px'; voiceRow.append(...voiceBtns);
  const voiceCap = document.createElement('span'); voiceCap.textContent = 'Vx'; voiceCap.style.cssText = 'font:var(--w-semi,600) 10px var(--ui-font,sans-serif);color:var(--ink-soft,#666);text-align:center;line-height:1';
  const voiceGroup = document.createElement('div'); voiceGroup.setAttribute('data-voice-group', '');
  voiceGroup.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;padding:2px 1px;border:1px solid var(--line,#c9c4b8);border-radius:8px;flex:none';
  voiceGroup.append(voiceCap, voiceRow);
  // drum switches (percussion staff): one cyclic button per group of sounds that share a place on the staff (bass drum / pedal hi-hat / low tom, ...)
  const drumHost = document.createElement('span'); drumHost.style.cssText = 'display:inline-flex;flex-wrap:nowrap;flex:none;gap:var(--btn-gap,2px);align-items:center'; drumHost.setAttribute('data-drum-switches', '');
  const soundName = (id) => { const k = `drum.sound.${id}`; const v = label(k); return v === k ? id : v; };
  const paintDrumSwitches = (s) => {
    const groups = s.active ? app.drumSwitches() : []; // as soon as the entry cursor is on a percussion staff
    const sig = JSON.stringify(groups.map((g) => [g.id, g.index]));
    if (drumHost.getAttribute('data-sig') === sig) return;
    drumHost.setAttribute('data-sig', sig); drumHost.replaceChildren();
    for (const g of groups) {
      const b = btn(`${label('noteEntry.drumSwitch')} : ${soundName(g.sounds[g.index])}`, () => app.cycleDrumSwitch(g.id), { 'data-action': 'drum-switch', 'data-switch': g.id, 'data-sound': g.sounds[g.index] });
      // the head of the sound (not its name): the name is in the tooltip
      const icon = glyphs ? drumSwitchIcons(glyphs, g.heads, g.index) : null;
      if (icon) b.append(icon); else b.textContent = soundName(g.sounds[g.index]);
      b.style.flex = 'none'; b.style.display = 'inline-flex'; b.style.alignItems = 'center'; b.style.justifyContent = 'center'; b.setAttribute('aria-label', b.title);
      b.style.minWidth = 'var(--ui-target,30px)'; b.style.padding = '0'; // the icons show the state: no corner ticks
      drumHost.append(b);
    }
  };
  // accordion drawer (Basse / Accord / 1-2 voix): exists only on the left hand of an accordion
  const accButtons = ['bass', 'chord'].map((m) => {
    const b = btn(label(`noteEntry.accMode.${m}`), () => app.setNoteEntry({ accMode: m }), { 'data-acc-mode-value': m });
    // bass = a single note; chord = the round button of the right hand's chord rows (a disc with the note name inside, here C)
    if (m === 'chord') { const d = document.createElement('span'); d.textContent = 'C'; d.style.cssText = 'width:20px;height:20px;border-radius:50%;border:1.5px solid currentColor;display:inline-flex;align-items:center;justify-content:center;font:var(--w-bold,700) 12px var(--ui-font,sans-serif);box-sizing:border-box;pointer-events:none'; b.replaceChildren(d); }
    else b.replaceChildren(drawnById('acc:bass') ?? label('noteEntry.accMode.bass'));
    return b;
  });
  // stem direction of the NEXT notes (automatic → up → down); a chord that is selected follows too
  const stem = btn('', () => {
    const next = (['auto', 'up', 'down'].indexOf(app.noteEntry().stem ?? 'auto') + 1) % 3;
    app.setNoteEntry({ stem: ['auto', 'up', 'down'][next] });
    app.setSelectionStem?.(next);
  }, { 'data-action': 'entry-stem' });
  const paintStem = (state) => {
    stem.replaceChildren();
    if (state === 0) applyIconName(stem, 'arrow-up-down');
    else stem.append(glyphRowIcon(glyphs, ['noteQuarterUp'], { side0: 3.4, rotate: state === 2 ? 180 : 0 }) ?? (state === 1 ? '↑' : '↓'));
    stem.style.display = 'inline-flex'; stem.style.alignItems = 'center'; stem.style.justifyContent = 'center';
    stem.title = label(`noteEntry.stem.${['auto', 'up', 'down'][state]}`); stem.setAttribute('aria-label', stem.title); markCyclic(stem, 3, state);
  };
  const accVoices = btn(label('noteEntry.accVoices.title'), () => app.setNoteEntry({ accVoices: (app.noteEntry().accVoices ?? 1) === 2 ? 1 : 2 }), { 'data-action': 'acc-voices' });
  const accVoicesText = document.createElement('span'); accVoicesText.textContent = 'V'; accVoicesText.style.cssText = 'font-weight:var(--w-bold,700);pointer-events:none';
  accVoices.replaceChildren(accVoicesText);
  // special modes (drums + grid, accordion left hand): ONE button opens a small panel to switch a mode on; the mode stays on until it is switched off (cross)
  let special = null; // null | 'drum' | 'acc' (kept in the entry state of the application: the cursor and the staff taps read it)
  const accDrawer = btn(label('noteEntry.special'), () => togglePanel(accPanel, accDrawer), { 'data-action': 'special-modes' });
  const accordionIcon = () => icon('accordion');
  const paintSpecial = () => { accDrawer.replaceChildren(special === 'drum' ? icon('drum') : special === 'acc' ? accordionIcon() : icon('ellipsis')); };
  const modeBtn = (mode, title, node) => btn(title, () => { closePanels(); app.setNoteEntry({ specialMode: mode }); }, { 'data-special': mode ?? 'off' });
  const specialChoices = [
    ((b) => { b.append(icon('drum')); return b; })(modeBtn('drum', label('noteEntry.special.drum'))),
    ((b) => { applyIconName(b, 'accordion'); return b; })(modeBtn('acc', label('noteEntry.special.acc'))),
    ((b) => { b.append(icon('x')); return b; })(modeBtn(null, label('noteEntry.special.off'))),
  ];
  paintSpecial();
  // Grille : saisie sur grille (percussion, rythmique) ; grisée s'il n'y a aucune portée prise en charge
  const gridBtn = btn(label('grid.toggle.title'), () => { if (grid && (grid.isActive() || grid.canOpen())) grid.toggle(); }, { 'data-action': 'grid-toggle' });
  gridBtn.append(drawnById('entry:grid') ?? label('grid.toggle'));
  // Sequential entry on a tablature: the pad stays open and the taps only place the cursor (shown only while the cursor is on a tablature staff)
  const onTab = () => !!app.tabStaffFor?.(app.noteEntry().cursor);
  const seqBtn = btn(label('noteEntry.seq'), () => { app.setNoteEntry({ sequential: !app.noteEntry().sequential }); }, { 'data-action': 'seq-toggle' });
  seqBtn.textContent = '⏭'; seqBtn.style.fontWeight = 'bold';
  let place = readPlace(placement);
  const move = btn(label('noteEntry.place'), () => { place = place === 'bottom' ? 'inline' : 'bottom'; savePlace(place); applyPlace(); }, { 'data-action': 'entry-place' });
  applyIconName(move, 'arrow-up-down');


  // -- vertical rail (computers): the bar stands in a column at the edge of the window, left or right, next to the sidebar; 'bottom' = the dock row as before.
  // A click on its ⇄ button goes left → right → bottom. Absent (display none, no room reserved) as long as the entry is off.
  const RAIL_KEY = 'scorsaire.entryRail';
  const readRail = () => { try { const v = localStorage.getItem(RAIL_KEY); return v === 'right' || v === 'bottom' ? v : 'left'; } catch { return 'left'; } };
  let railPref = readRail();
  // screen 5 (YouTube editor): the bar lies flat, at the right of the score canvas, right above the fixed timeline band
  const ytOn = () => !!dock && dock.inHeader() && document.documentElement.hasAttribute('data-yt') && st.active;
  const ytHost = document.createElement('div'); ytHost.setAttribute('data-entry-yt', ''); ytHost.setAttribute('data-dismiss-keep', ''); ytHost.style.display = 'none';
  if (dock) document.body.append(ytHost);
  let ytWatch = null;
  const placeYt = () => {
    const band = document.querySelector('[data-yt-timeline-band]'); const col = document.getElementById('sync-host')?.firstElementChild?.firstElementChild;
    if (!band || !col) { ytHost.style.display = 'none'; return; }
    if (!ytWatch && typeof ResizeObserver === 'function') { ytWatch = new ResizeObserver(() => { if (ytOn()) { placeYt(); } }); ytWatch.observe(band); ytWatch.observe(ytHost); }
    const b = band.getBoundingClientRect(); const c = col.getBoundingClientRect();
    ytHost.style.cssText = `display:block;position:fixed;z-index:55;left:${Math.round(c.left)}px;width:${Math.round(c.width)}px;bottom:${Math.round(window.innerHeight - b.top + 4)}px;box-sizing:border-box;padding:4px;background:var(--paper,#faf8f4);border:1px solid var(--line,#d8d3c8);border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.12)`;
    document.documentElement.style.setProperty('--yt-entry-h', `${ytHost.offsetHeight + 8}px`); // the column of the score makes room for the bar
  };
  const railOn = () => !!dock && dock.inHeader() && railPref !== 'bottom' && !ytOn();
  const railBtn = btn(label('noteEntry.railSide'), () => {
    railPref = railPref === 'left' ? 'right' : railPref === 'right' ? 'bottom' : 'left';
    try { localStorage.setItem(RAIL_KEY, railPref); } catch { /* storage may be refused */ }
    update(app.noteEntry());
  }, { 'data-action': 'entry-rail-side' });
  railBtn.textContent = '⇄';
  const rail = document.createElement('div');
  rail.setAttribute('data-entry-rail', ''); rail.setAttribute('data-dismiss-keep', '');
  // in the row that holds the score (and the sidebar), between them: same outline as both (thin line, rounded corners), top level with the score's top
  if (dock) (document.getElementById('work-row') ?? document.body).append(rail);
  const placeRail = () => {
    if (ytOn()) { rail.style.display = 'none'; placeYt(); if (bar.parentNode !== ytHost) ytHost.append(bar); if (entryRailAttr(true)) dock.refresh?.(); return; }
    ytHost.style.display = 'none'; document.documentElement.style.removeProperty('--yt-entry-h');
    const on = railOn() && st.active;
    if (!on) { rail.style.display = 'none'; if (entryRailAttr(false)) dock.refresh?.(); return; }
    if (entryRailAttr(true)) dock.refresh?.();
    rail.style.cssText = `display:flex;flex-direction:column;flex:none;align-self:flex-start;position:sticky;top:8px;margin:0 -6px;order:${railPref === 'left' ? 1 : 3};box-sizing:border-box;padding:6px 3px;max-height:calc(100vh - 16px);overflow-y:auto;overflow-x:hidden;background:var(--paper,#faf8f4);border:1px solid var(--line,#d8d3c8);border-radius:10px`;
    if (bar.parentNode !== rail) rail.append(bar);
  };
  /** Marks the dock's entry row as « stands in the rail » (it then shows nothing); true when the mark changed. */
  const entryRailAttr = (on) => { if (!dock) return false; const had = dock.entryHost.hasAttribute('data-rail'); if (on === had) return false; dock.entryHost.toggleAttribute('data-rail', on); return true; };

  // annuler / refaire ↶ ↷ ; valables hors du mode saisie (jouer / couper, accords…)
  const undoHost = document.createElement('span');
  const undoUi = mountUndoRedo(undoHost, { app, label });
  const [undoBtn, redoBtn] = dock ? [null, null] : [...undoHost.childNodes];
  if (dock) dock.topRight.prepend(...undoHost.childNodes); // before the dock's back button

  // -- layout: one row; what does not fit goes behind « › » (the lowest priority first) ----------------------------------------------------------
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:nowrap;gap:var(--btn-gap,2px);align-items:center;min-width:0';
  const panelStyle = 'display:none;position:absolute;bottom:100%;z-index:8;flex-wrap:wrap;gap:var(--btn-gap,2px);padding:6px;box-sizing:border-box;background:var(--bar,var(--bg,#fff));border:1px solid rgba(0,0,0,0.25);border-radius:8px;box-shadow:0 -2px 10px rgba(0,0,0,0.25);max-width:calc(100vw - 16px)';
  const accPanel = document.createElement('div'); accPanel.setAttribute('data-acc-panel', ''); accPanel.style.cssText = panelStyle;
  accPanel.append(...specialChoices);
  const overflowPanel = document.createElement('div'); overflowPanel.setAttribute('data-overflow-panel', ''); overflowPanel.style.cssText = panelStyle;
  const more = btn(label('noteEntry.more'), () => togglePanel(overflowPanel, more), { 'data-action': 'entry-more' });
  more.textContent = '›'; more.style.fontSize = '22px';
  // a phone (≤ 600 px) has no room for the dock's piano button while the entry bar is open (CSS hides it): a copy of it is the first entry behind « › »
  const phoneEntry = () => !!dock && isPhone();
  const pianoProxy = btn(label('dock.piano'), () => dock?.bottomBase.querySelector('[data-action="piano-toggle"]')?.click(), { 'data-action': 'entry-piano' });
  pianoProxy.append(icon('piano'));
  const syncPianoProxy = () => { const on = dock?.bottomBase.querySelector('[data-action="piano-toggle"]')?.getAttribute('aria-pressed') === 'true'; pianoProxy.setAttribute('aria-pressed', String(on)); pianoProxy.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : ''; };
  const panels = [accPanel, overflowPanel];
  function togglePanel(panel, anchor) {
    const open = panel.style.display === 'none';
    syncPianoProxy();
    for (const p of panels) p.style.display = 'none';
    if (!open) return;
    // beside the rail the panel must stand above the score (the rail is a lower stacking layer): it moves to <body> while the rail is used
    if (railOn()) { if (panel.parentNode !== document.body) document.body.append(panel); panel.style.zIndex = '70'; }
    else { if (panel.parentNode !== bar) bar.append(panel); panel.style.zIndex = ''; }
    panel.style.display = 'flex';
    const br = bar.getBoundingClientRect(); const ar = anchor.getBoundingClientRect();
    if (railOn()) { // beside the rail, level with the button
      panel.style.position = 'fixed'; panel.style.bottom = 'auto'; panel.style.top = `${Math.max(4, Math.min(ar.top, window.innerHeight - panel.offsetHeight - 4))}px`;
      if (railPref === 'left') { panel.style.left = `${ar.right + 6}px`; panel.style.right = 'auto'; } else { panel.style.right = `${window.innerWidth - ar.left + 6}px`; panel.style.left = 'auto'; }
      return;
    }
    panel.style.position = 'absolute'; panel.style.bottom = '100%'; panel.style.top = ''; panel.style.right = '';
    panel.style.left = `${Math.max(0, Math.min(ar.left - br.left, br.width - panel.offsetWidth))}px`;
  }
  const closePanels = () => { for (const p of panels) p.style.display = 'none'; };
  overflowPanel.addEventListener('click', () => setTimeout(closePanels, 0));
  const onOutside = (e) => { if (!bar.contains(e.target) && !panels.some((p) => p.contains(e.target))) closePanels(); };
  document.addEventListener('pointerdown', onOutside, true);

  // items in display order; `prio` 0 = always visible, a higher number leaves the row sooner; `show()` = false hides the item altogether
  let st = app.noteEntry();
  // docked: the buttons of the entry exist only while the entry is on (the pencil deploys them); the undo / redo and the ⇅ button are not here
  const entryOn = () => true; // docked: the bar is only visible while the entry drawer is open
  const items = (dock ? [
    ...pcTop.map((el) => ({ el, prio: 0, show: () => entryOn() && onPc() })),
    { el: cycle, prio: 1, show: () => entryOn() && !onPc() },
    ...fixedDur.map((el) => ({ el, prio: 0, show: entryOn })),
    ...pcBottom.map((el) => ({ el, prio: 0, show: () => entryOn() && onPc() })),
    { el: rest, prio: 0, show: entryOn }, { el: dot, prio: 0, show: entryOn }, { el: tie, prio: 0, show: entryOn },
    { el: seqBtn, prio: 1, show: () => entryOn() && onTab() },
    { el: drumHost, prio: 2, show: () => entryOn() && special === 'drum' && drumHost.childElementCount > 0 },
    { el: voice, prio: 3, show: () => entryOn() && !onPc() },
    { el: voiceGroup, prio: 3, show: () => entryOn() && onPc() },
    { el: stem, prio: 3, show: entryOn },
    ...accButtons.map((el) => ({ el, prio: 2, show: () => entryOn() && special === 'acc' })), { el: accVoices, prio: 2, show: () => entryOn() && special === 'acc' },
    { el: gridBtn, prio: 2, show: () => entryOn() && special === 'drum' },
    { el: accDrawer, prio: 1, show: entryOn },
    { el: railBtn, prio: 6, show: () => dock.inHeader() },
  ] : [
    { el: toggle, prio: 0 },
    { el: undoBtn, prio: 2 }, { el: redoBtn, prio: 2 },
    { el: cycle, prio: 1 },
    ...fixedDur.map((el) => ({ el, prio: 0 })),
    { el: rest, prio: 0 }, { el: dot, prio: 0 }, { el: tie, prio: 0 },
    { el: seqBtn, prio: 1, show: onTab },
    { el: drumHost, prio: 2, show: () => special === 'drum' && drumHost.childElementCount > 0 },
    { el: voice, prio: 3 },
    { el: stem, prio: 3 },
    ...accButtons.map((el) => ({ el, prio: 2, show: () => special === 'acc' })), { el: accVoices, prio: 2, show: () => special === 'acc' },
    { el: gridBtn, prio: 2, show: () => special === 'drum' },
    { el: accDrawer, prio: 1 },
    { el: move, prio: 6 },
  ]).filter((it) => it.el);
  bar.append(status, row, accPanel, overflowPanel);
  if (dock) {
    dock.entryHost.append(bar); dock.bottomBase.prepend(toggle);
    dock.onBack = () => app.setNoteEntry({ active: false });
  } else host.replaceChildren(bar);

  // message floats just above the dock (over the page) so it never pushes the dock buttons around
  function placeStatus() {
    const d = dock && bar.closest('[data-dock]');
    if (!d) { status.style.cssText = status.textContent ? 'display:block;font:14px var(--ui-font,sans-serif);padding:0 4px 4px' : 'display:none'; return; }
    const r = d.getBoundingClientRect();
    status.style.cssText = status.textContent ? `display:block;position:fixed;left:${r.left + 8}px;bottom:${window.innerHeight - r.top + 6}px;max-width:min(360px,${r.width - 16}px);font:14px var(--ui-font,sans-serif);padding:6px 10px;background:var(--paper,#faf8f4);color:var(--ink,#222);border:1px solid var(--line,#d8d3c8);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:8;pointer-events:none` : 'display:none';
  }

  function fitRail() {
    const list = items.filter((it) => (it.show ? it.show() : true));
    for (const it of items) it.el.style.display = list.includes(it) ? 'inline-flex' : 'none';
    drumHost.style.flexDirection = 'column'; voiceRow.style.flexDirection = 'column';
    row.style.flexDirection = 'column'; row.style.alignItems = 'center';
    more.style.display = 'none';
    row.replaceChildren(...list.map((it) => it.el), more);
    overflowPanel.replaceChildren();
    // messages: a note next to the rail instead of a line that a 44 px column could not hold
    const rr = rail.getBoundingClientRect();
    status.style.cssText = status.textContent ? `display:block;position:fixed;top:${Math.max(8, rr.top)}px;${railPref === 'left' ? `left:${rr.right + 6}px` : `right:${window.innerWidth - rr.left + 6}px`};max-width:260px;font:14px var(--ui-font,sans-serif);padding:6px 10px;background:var(--paper,#faf8f4);border:1px solid var(--line,#d8d3c8);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:8;pointer-events:none` : 'display:none';
  }

  function fit() {
    if (!bar.isConnected) return;
    if (dock) placeRail();
    if (railOn() && st.active) { fitRail(); return; }
    drumHost.style.flexDirection = ''; voiceRow.style.flexDirection = ''; row.style.flexDirection = ''; row.style.alignItems = 'center'; row.style.justifyContent = ytOn() ? 'flex-end' : '';
    placeStatus();
    if (dock && bar.parentNode === rail) dock.entryHost.append(bar);
    if (dock && !ytOn() && bar.parentNode === ytHost) dock.entryHost.append(bar);
    const avail = bar.clientWidth - (dock ? 0 : 16);
    if (avail <= 0) return;
    const list = items.filter((it) => (it.show ? it.show() : true));
    for (const it of items) it.el.style.display = list.includes(it) ? 'inline-flex' : 'none';
    row.replaceChildren(...list.map((it) => it.el));
    more.style.display = 'none'; row.append(more);
    const widths = new Map(list.map((it) => [it, it.el.getBoundingClientRect().width + 6]));
    let total = [...widths.values()].reduce((a, b) => a + b, 0);
    const hidden = [];
    if (total > avail) {
      more.style.display = '';
      const reserve = more.getBoundingClientRect().width + 6;
      for (const it of [...list].sort((a, b) => b.prio - a.prio)) {
        if (total + reserve <= avail || it.prio === 0) break;
        hidden.push(it); total -= widths.get(it);
      }
    }
    const withPiano = phoneEntry();
    overflowPanel.replaceChildren(...(withPiano ? [pianoProxy] : []), ...list.filter((it) => hidden.includes(it)).map((it) => it.el));
    more.style.display = hidden.length || withPiano ? '' : 'none';
    if (!hidden.length && !withPiano && overflowPanel.style.display !== 'none') overflowPanel.style.display = 'none';
    row.replaceChildren(...list.filter((it) => !hidden.includes(it)).map((it) => it.el), more);
    pin();
  }

  /** Style selon l'emplacement ; en bas, la page garde une marge de la hauteur de la barre pour que rien ne reste caché dessous. */
  const applyPlace = () => {
    if (dock) { bar.setAttribute('data-place', 'dock'); bar.style.cssText = 'display:flex;flex-direction:column;position:relative;min-width:0'; fit(); dock.refit(); return; }
    bar.setAttribute('data-place', place);
    const common = 'display:flex;flex-direction:column;padding:6px 8px;box-sizing:border-box;background:var(--bar,var(--bg,#fff));border:1px solid rgba(0,0,0,0.2);';
    bar.style.cssText = place === 'bottom'
      ? `${common}position:fixed;left:0;right:0;top:0;transform-origin:0 0;will-change:transform;z-index:7;border-width:1px 0 0;box-shadow:0 -2px 8px rgba(0,0,0,0.2)`
      : `${common}position:relative;border-radius:8px`;
    fit();
    const spacer = bar.offsetHeight;
    document.body.style.paddingBottom = place === 'bottom' && spacer ? `${spacer + 8}px` : '';
    pin();
  };
  /** Colle la barre au bas de la zone VISIBLE à taille constante, quel que soit le zoom au pincement (`visualViewport`). */
  const pin = () => {
    if (dock) return;
    if (place !== 'bottom') { bar.style.transform = ''; return; }
    const vv = window.visualViewport;
    const h = bar.offsetHeight;
    // normal case (no pinch zoom): plainly fixed to the bottom of the screen, no transform — it does not depend on any `visualViewport`
    // value (some tablets report odd ones, which left the bar at the top of the page). Zoomed in: the counter-zoom transform keeps its size.
    if (!vv || Math.abs((vv.scale || 1) - 1) < 0.01) {
      bar.style.top = 'auto'; bar.style.bottom = '0'; bar.style.transform = '';
      return;
    }
    bar.style.bottom = 'auto'; bar.style.top = '0';
    bar.style.transform = counterZoom(vv, h).transform;
  };

  const update = (s) => {
    st = s;
    special = s.specialMode ?? null; paintSpecial();
    if (dock) { if (entryRailAttr(railOn())) dock.refresh?.(); if (s.active && dock.bottomMode() !== 'entry') dock.setBottom('entry'); else if (!s.active && dock.bottomMode() === 'entry') dock.setBottom(null); }
    const press = (b, on) => { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : ''; b.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; };
    press(toggle, s.active);
    for (const b of [...fixedDur, ...pcTop, ...pcBottom]) press(b, b.getAttribute('data-duration') === s.duration.base);
    const ci = CYCLE.indexOf(s.duration.base);
    if (ci >= 0) cycleIdx = ci;
    paintCycle(); press(cycle, ci >= 0);
    press(dot, s.duration.dots > 0);
    press(seqBtn, !!s.sequential);
    press(rest, s.rest);
    for (const b of [...fixedDur, ...pcTop, ...pcBottom, cycle, dot, rest, tie]) b.style.opacity = s.active ? '' : '0.55';
    const accOn = s.active && special === 'acc'; // choosing bass/chord/voices needs no arming (only placing notes does)
    for (const b of accButtons) { const m = b.getAttribute('data-acc-mode-value'); press(b, accOn && (s.accMode ?? 'bass') === m); b.disabled = !accOn; b.style.opacity = accOn ? '' : '0.45'; b.style.cursor = accOn ? 'pointer' : 'default'; }
    paintDrumSwitches(s);
    const voiceOn = s.active && s.entryStaffType !== 'accordion-left';
    voiceText.textContent = String((s.voice ?? 0) + 1); markCyclic(voice, 4, s.voice ?? 0);
    voice.title = label('noteEntry.voice.n', { n: (s.voice ?? 0) + 1 }); voice.setAttribute('aria-label', voice.title);
    voice.style.pointerEvents = voiceOn ? '' : 'none'; voice.style.opacity = voiceOn ? '' : '0.45';
    voiceBtns.forEach((b, i) => press(b, voiceOn && (s.voice ?? 0) === i)); voiceGroup.style.pointerEvents = voiceOn ? '' : 'none'; voiceGroup.style.opacity = voiceOn ? '' : '0.45';
    paintStem(Math.max(0, ['auto', 'up', 'down'].indexOf(s.stem ?? 'auto'))); stem.style.pointerEvents = voiceOn ? '' : 'none'; stem.style.opacity = voiceOn ? '' : '0.45';
    accVoices.title = label(`noteEntry.accVoices.${s.accVoices === 2 ? 2 : 1}`); accVoices.setAttribute('aria-label', accVoices.title); markCyclic(accVoices, 2, s.accVoices === 2 ? 1 : 0);
    accVoices.disabled = !accOn; accVoices.style.opacity = accOn ? '' : '0.45'; accVoices.style.cursor = accOn ? 'pointer' : 'default';
    press(accDrawer, special !== null);
    const gridOn = !!grid && (grid.isActive() || grid.canOpen());
    gridBtn.disabled = !gridOn; gridBtn.style.opacity = gridOn ? '' : '0.45'; gridBtn.style.cursor = gridOn ? 'pointer' : 'default';
    press(gridBtn, !!grid && grid.isActive());
    if (!s.active) say('');
    fit();
  };
  const off = app.onNoteEntryChange(update);
  const offDockMode = dock ? dock.onMode(({ bottom }) => { toggle.style.display = bottom && bottom !== 'entry' && !dock.inHeader() ? 'none' : ''; }) : null;
  const offFitter = dock ? dock.addFitter(fit) : null;
  applyPlace();
  update(app.noteEntry());
  const onResize = () => applyPlace();
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('scroll', pin);
  window.addEventListener('scroll', pin);
  return {
    /** Message court au-dessus des boutons (résultat d'un geste ou raison d'un refus) ; vide = efface. */
    message(text) { say(text); },
    /** À rappeler quand le mode grille s'ouvre ou se ferme (état du bouton). */
    refresh() { update(app.noteEntry()); },
    destroy() { accPanel.remove(); overflowPanel.remove(); rail.remove(); ytHost.remove(); off(); offDockMode?.(); offFitter?.(); if (dock) { toggle.remove(); if (dock.bottomMode() === 'entry') dock.setBottom(null); if (dock.onBack) dock.onBack = null; } undoUi.destroy(); document.removeEventListener('pointerdown', onOutside, true); window.removeEventListener('resize', onResize); window.visualViewport?.removeEventListener('resize', onResize); window.visualViewport?.removeEventListener('scroll', pin); window.removeEventListener('scroll', pin); if (!dock) document.body.style.paddingBottom = ''; if (dock) dock.refit(); bar.remove(); },
  };
}
