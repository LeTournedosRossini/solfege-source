/*
 * Mode « saisie sur grille » (DOM) : remplace l'affichage de la partition par la grille à cases égales (`layout/gridview.js`) pour UNE portée
 * (percussion, rythmique, neutre) ; la logique est dans `gridentry.js` et `model/gridedit.js`, sans DOM.
 *
 * Gestes (tablette d'abord, boutons ≥ 44 px) :
 *   - toucher une case : pose ou retire la frappe du son choisi dans la palette ;
 *   - toucher le nombre au-dessus d'un temps : choisit ce temps, la rangée « grille du temps » propose 2, 4, 8, 3, 6… cases ;
 *   - « Valider » : écrit les durées (UNE transaction `app.edit`, annulable d'un coup, seules les mesures modifiées sont réécrites) ;
 *   - « Annuler » : quitte sans rien écrire. Si le Document change autrement (annuler / refaire ailleurs), le mode se ferme sans écrire.
 * Rien dans le flux ne bouge : la zone de message a un emplacement réservé.
 */
import { PID, getProperty, GridError, beatGrid, cellCountCandidates, drumSound } from '../model/index.js';
import { fSub, fEq } from '../model/fraction.js';
import { layoutGrid, hitGrid, soundGroups, groupAtY } from '../layout/gridview.js';
import { renderSvgString } from '../render/svg.js';
import { readGrid, toggleHit, setBeatCells, setMeasureGrouping, gridSnapshot, restoreGrid, neighbourSound, moveHit, commitGrid, changedMeasures, cellTime, GRID_STAFF_TYPES, NO_SOUND } from './gridentry.js';
import { groupingChoices, groupingText, sameGrouping, defaultGrouping } from '../model/metergroups.js';
import { drumSwitchesFor, GHOST_SUFFIX, isGhostSound, baseSoundOf } from '../model/percmap.js';
import { drumSwitchIcons } from './noteentry-dom.js';
import { drumHeadGlyph } from '../model/index.js';

const MARGIN = 10;
const NUDGE_GAP = 4; // px between the top of the container and the small up / down window
const BAND_CSS = `calc(var(--ui-target,44px) + 8px + ${NUDGE_GAP}px)`; // the band reserved above the drawing for that window

/** Portée à ouvrir : celle du curseur de saisie, sinon celle de l'élément sélectionné, sinon la première portée prise en charge. */
export function gridCandidateStaff(app, viewId = 'main') {
  const doc = app.doc;
  const gridable = (el) => el && el.type === 'staff' && GRID_STAFF_TYPES.includes(getProperty(el, PID.STAFF_TYPE));
  const cursor = app.entryCursor();
  const fromCursor = cursor && doc.find(cursor.staffId);
  if (gridable(fromCursor)) return fromCursor;
  const sel = app.view(viewId)?.selection?.() ?? [];
  for (const id of sel) {
    let el = doc.find(id);
    while (el && el.type !== 'staff') el = doc.parentOf(el.id);
    if (gridable(el)) return el;
  }
  for (const mv of doc.work.movements) for (const track of mv.tracks) for (const staff of track.staves) if (gridable(staff)) return staff;
  return null;
}

/**
 * @param o.app  Application ; o.glyphs ; o.label : (clé, params) → texte ; o.scoreHost : élément qui contient la partition (masqué pendant le mode)
 * @param o.staffSpace  pixels par espace de portée ; o.headsOnly : les boutons de sons ne montrent que la tête de note (le nom reste dans l'info-bulle) ; o.stretch : 1 ou 2, hauteur du dessin (l'écran ×2 du composant de note) ; o.onChange : appelé à l'ouverture et à la fermeture (rafraîchir la partition)
 * @returns {{ toggle(), open(staff?), close(commit), isActive(), canOpen(), setStretch(n), destroy() }}
 */
export function mountGridMode({ app, glyphs, label = (k) => k, scoreHost, staffSpace = 18, headsOnly = false, stretch: stretch0 = 1, onChange = () => {} }) {
  const doc = app.doc;
  let panel = null;
  let state = null;
  let staff = null;
  let groups = [];
  const choice = new Map(); // ligne → son choisi (groupes de plusieurs sons)
  let selected = null; // { measure, beat }
  let closing = false;
  let layout = null;
  let stretch = stretch0; // the drawing is taller, never wider: the beats keep the width of the screen
  const ui = {}; // éléments du panneau
  // undo / redo INSIDE the mode: the grid is a draft that is only written on « Valider », so the document's own undo cannot reach it (it would even close the mode without writing).
  // A snapshot of the hits and of the grid of every beat is kept before each change.
  let undoStack = []; let redoStack = [];
  let last = null; // the hit just put on a cell, for the small « up / down » window: { measure, beat, cell, sound, x, y }
  const snapshot = () => gridSnapshot(state);
  const restore = (text) => restoreGrid(state, text);
  const remember = () => { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack = []; };
  const stepHistory = (from, to) => {
    if (!from.length) return;
    to.push(snapshot()); restore(from.pop());
    last = null; hideNudge(); say(''); render();
  };
  const undo = () => stepHistory(undoStack, redoStack);
  const redo = () => stepHistory(redoStack, undoStack);

  const text = (key, params) => label(key, params);
  const soundLabel = (id) => {
    if (id === NO_SOUND) return '●';
    if (isGhostSound(id)) return `(${soundLabel(baseSoundOf(id))})`;
    const k = `drum.sound.${id}`;
    const t = text(k);
    return t && t !== k ? t : (drumSound(state.percmap, id)?.name ?? id);
  };
  const say = (msg) => { if (ui.message) ui.message.textContent = msg ?? ''; };

  const mkButton = (title, fn, attrs = {}) => {
    const b = document.createElement('button');
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center;font:15px var(--ui-font,sans-serif);padding:2px 10px;cursor:pointer';
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    b.addEventListener('click', fn);
    return b;
  };
  const press = (b, on) => { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : ''; b.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; };

  // ---------- sons : choisis par la hauteur touchée ; un bouton à états par ligne qui porte plusieurs sons ----------
  // the default sound of a line that holds several = the CURRENT sound of the entry switch that contains one of them (same preference as the normal drum entry)
  // the choices of a line: its sounds, and a GHOST version of the snare (the same sound in parentheses)
  const optionsOf = (g) => [...g.sounds, ...(g.sounds.includes('acousticSnare') ? [`acousticSnare${GHOST_SUFFIX}`] : [])];
  const chosen = (g) => {
    const own = choice.get(g.line);
    if (own) return own;
    const sw = staff ? app.drumSwitchGroups(staff.id).find((x) => x.sounds.some((id) => g.sounds.includes(id))) : null;
    const cur = sw?.sounds[sw.index];
    if (cur && g.sounds.includes(cur)) return cur;
    const first = drumSwitchesFor(state.percmap).find((x) => g.sounds.includes(x.sounds[0])); // the first sound of its switch: the bass drum (not the pedal hi-hat) for the bottom line
    return first ? first.sounds[0] : g.sounds[0];
  };
  const drawPalette = () => {
    ui.palette.replaceChildren();
    for (const g of groups.filter((x) => optionsOf(x).length > 1)) {
      const opts = optionsOf(g); const id = chosen(g);
      const b = mkButton(soundLabel(id), () => { const next = opts[(opts.indexOf(id) + 1) % opts.length]; choice.set(g.line, next); app.pickDrumSound(staff.id, baseSoundOf(next)); drawPalette(); }, { 'data-grid-group': String(g.line) });
      b.style.gap = '6px';
      // the heads of the line's sounds (the chosen one dark); a ghost shows its head between parentheses. No « turning arrow »: several heads already say that the button cycles
      const icon = drumSwitchIcons(glyphs, opts.map((sid) => drumSound(state.percmap, baseSoundOf(sid))?.head ?? 'normal'), opts.indexOf(id));
      [...icon.children].forEach((cell, i) => { if (isGhostSound(opts[i])) { cell.prepend('('); cell.append(')'); cell.style.width = 'auto'; } });
      b.replaceChildren(icon, ...(headsOnly ? [] : [document.createTextNode(soundLabel(id))]));
      ui.palette.append(b);
    }
  };

  // ---------- grille du temps choisi ----------
  const drawBeatRow = () => {
    ui.beatRow.replaceChildren();
    if (!selected) { ui.beatRow.textContent = text('grid.chooseBeat'); ui.beatRow.style.font = '14px sans-serif'; return; }
    const b = state.measures[selected.measure].beats[selected.beat];
    const title = document.createElement('span');
    title.textContent = `${text('grid.beatCells')} (${selected.measure + 1}.${selected.beat + 1}) :`;
    title.style.font = '14px sans-serif';
    ui.beatRow.append(title);
    for (const n of cellCountCandidates(fSub(b.end, b.start))) {
      try { beatGrid(fSub(b.end, b.start), n); } catch { continue; }
      const btn = mkButton(text('grid.beatCells.n', { n }), () => {
        try {
          remember(); last = null; hideNudge();
          const dropped = setBeatCells(state, selected.measure, selected.beat, n);
          say(dropped ? text('grid.dropped', { n: dropped }) : '');
        } catch (e) { say(e instanceof GridError ? e.message : String(e)); return; }
        render();
      }, { 'data-grid-cells': String(n) });
      btn.textContent = String(n);
      press(btn, !b.locked && b.cells === n);
      ui.beatRow.append(btn);
    }
    // an asymmetric measure (5/8, 7/8…): how its beats are grouped (3 + 2 or 2 + 3…), for every measure of the same signature
    const m = state.measures[selected.measure];
    const choices = groupingChoices(m.timeSig);
    if (choices.length) {
      const gt = document.createElement('span');
      gt.textContent = `${text('grid.grouping')} :`; gt.style.cssText = 'font:14px sans-serif;margin-left:12px';
      ui.beatRow.append(gt);
      const current = m.grouping ?? defaultGrouping(m.timeSig);
      for (const g of choices) {
        const gb = mkButton(groupingText(g), () => {
          remember(); last = null; hideNudge();
          setMeasureGrouping(state, selected.measure, g);
          selected = { ...selected, beat: Math.min(selected.beat, state.measures[selected.measure].beats.length - 1) };
          render();
        }, { 'data-grid-grouping': groupingText(g) });
        gb.textContent = groupingText(g);
        press(gb, sameGrouping(g, current));
        ui.beatRow.append(gb);
      }
    }
  };

  // ---------- the hit just put: a small window to move it up or down ON THE STAFF ----------
  // (a wrong sound — a ride instead of the hi-hat — is moved to the sound drawn on the next line / space, whatever its MIDI number is: the groups are the lines of the staff)
  const groupOf = (sound) => groups.findIndex((g) => g.sounds.includes(baseSoundOf(sound)));
  const nudge = (dir) => {
    if (!last) return;
    const next = neighbourSound(groups, last.sound, dir, chosen);
    if (!next) return;
    const m = state.measures[last.measure];
    remember();
    moveHit(state, last.measure, cellTime(m, last.beat, last.cell), last.sound, next);
    last = { ...last, sound: next };
    render();
    showNudge();
  };
  const hideNudge = () => { if (ui.nudge) ui.nudge.style.display = 'none'; };
  const showNudge = () => {
    if (!last || groups.length < 2) { hideNudge(); return; }
    const gi = groupOf(last.sound);
    ui.nudgeUp.disabled = !groups[gi - 1]; ui.nudgeDown.disabled = !groups[gi + 1];
    ui.nudge.title = soundLabel(last.sound); // no text in the window: the sound is named in the tooltip
    ui.nudge.style.display = 'flex';
    const host = ui.stage.getBoundingClientRect(); const w = ui.nudge.offsetWidth; const h = ui.nudge.offsetHeight;
    const left = Math.min(Math.max(last.x - host.left + ui.stage.scrollLeft - w / 2, 4), Math.max(4, ui.stage.scrollWidth - w - 4));
    ui.nudge.style.left = `${Math.round(left)}px`; ui.nudge.style.top = `${NUDGE_GAP}px`; // always in the band reserved at the top of the container, never over the staff
  };

  // ---------- rendu et gestes ----------
  const render = () => {
    const w = Math.max(240, ui.stage.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800));
    layout = layoutGrid({ state, staff, glyphs, width: (w - 2 * MARGIN) / staffSpace, selected });
    ui.stage.innerHTML = renderSvgString(layout, glyphs, { staffSpace, margin: MARGIN });
    const svg = ui.stage.querySelector('svg');
    ui.holder.style.paddingTop = BAND_CSS;
    if (svg && stretch > 1 && svg.viewBox?.baseVal?.height) {
      svg.setAttribute('preserveAspectRatio', 'none'); svg.style.height = `${svg.viewBox.baseVal.height * stretch}px`;
      // the taller drawing grows UP into the band reserved for the small window (the window then rests on the top of the drawing, over the beat handles) instead of pushing everything below it down
      const band = parseFloat(getComputedStyle(ui.holder).paddingTop) || 0; const growth = svg.viewBox.baseVal.height * (stretch - 1);
      ui.holder.style.paddingTop = `${Math.max(0, Math.round(band - growth))}px`;
    }
    drawPalette();
    drawBeatRow();
    if (ui.undo) { ui.undo.disabled = !undoStack.length; ui.redo.disabled = !redoStack.length; }
  };

  const onStageClick = (e) => {
    const svg = ui.stage.querySelector('svg');
    if (!svg || !layout) return;
    const r = svg.getBoundingClientRect();
    const sx = svg.width.baseVal.value / r.width;
    const sy = svg.height.baseVal.value / r.height;
    const x = ((e.clientX - r.left) * sx - MARGIN) / staffSpace;
    const y = ((e.clientY - r.top) * sy) / staffSpace;
    const hit = hitGrid(layout, x, y);
    if (!hit) { say(''); return; }
    const z = hit.zone;
    if (z.kind === 'handle') {
      hideNudge();
      selected = selected && selected.measure === z.measure && selected.beat === z.beat ? null : { measure: z.measure, beat: z.beat };
      say('');
      render();
      return;
    }
    if (z.locked) { hideNudge(); say(text('grid.locked')); selected = { measure: z.measure, beat: z.beat }; render(); return; }
    const g = groupAtY(groups, hit.staffY);
    if (!g) { say(''); return; }
    try {
      // un son du groupe déjà posé à cet instant : on le retire (quel qu'il soit) ; sinon on pose le son choisi pour la ligne
      const m = state.measures[z.measure];
      const t = cellTime(m, z.beat, z.cell);
      const present = optionsOf(g).filter((id) => m.hits.some((h) => h.sound === id && fEq(h.t, t)));
      const before = snapshot();
      let added = null;
      if (present.length) for (const id of present) toggleHit(state, z.measure, z.beat, z.cell, id);
      else { added = chosen(g); toggleHit(state, z.measure, z.beat, z.cell, added); }
      undoStack.push(before); if (undoStack.length > 200) undoStack.shift(); redoStack = [];
      last = added ? { measure: z.measure, beat: z.beat, cell: z.cell, sound: added, x: e.clientX, y: e.clientY } : null;
      say('');
    } catch (err) { say(err instanceof GridError ? err.message : String(err)); return; }
    render();
    showNudge();
  };

  // ---------- ouverture / fermeture ----------
  const build = () => {
    panel = document.createElement('div');
    panel.setAttribute('data-grid-mode', ''); panel.setAttribute('data-dismiss-keep', ''); // a press in the grid is not outside the score: it must not switch the entry mode off (the layout shifted)
    panel.style.cssText = 'display:block;padding:6px 8px;box-sizing:border-box';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center;margin-bottom:6px';
    const title = document.createElement('strong'); title.textContent = text('grid.title'); title.style.font = '16px sans-serif';
    ui.commit = mkButton(text('grid.commit'), () => close(true), { 'data-grid-action': 'commit' }); ui.commit.textContent = `✓ ${text('grid.commit')}`;
    ui.cancel = mkButton(text('grid.cancel'), () => close(false), { 'data-grid-action': 'cancel' }); ui.cancel.textContent = `✕ ${text('grid.cancel')}`;
    ui.undo = mkButton(text('grid.undo'), undo, { 'data-grid-action': 'undo' }); ui.undo.textContent = '↶';
    ui.redo = mkButton(text('grid.redo'), redo, { 'data-grid-action': 'redo' }); ui.redo.textContent = '↷';
    bar.append(title, ui.undo, ui.redo, ui.commit, ui.cancel);
    ui.palette = document.createElement('div'); ui.palette.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center;margin-bottom:6px';
    ui.beatRow = document.createElement('div'); ui.beatRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center;margin-bottom:6px;min-height:var(--ui-target,44px)';
    ui.message = document.createElement('div'); ui.message.setAttribute('role', 'status'); ui.message.setAttribute('aria-live', 'polite');
    ui.message.style.cssText = 'min-height:1.4em;font:14px var(--ui-font,sans-serif);margin-bottom:4px';
    ui.stage = document.createElement('div'); ui.stage.setAttribute('data-grid-stage', ''); ui.stage.style.cssText = 'overflow-x:auto;touch-action:manipulation;-webkit-user-select:none;user-select:none';
    ui.stage.addEventListener('click', onStageClick);
    ui.nudge = document.createElement('div'); ui.nudge.setAttribute('data-grid-nudge', ''); ui.nudge.setAttribute('role', 'group'); ui.nudge.setAttribute('aria-label', text('grid.nudge'));
    ui.nudge.style.cssText = 'display:none;position:absolute;z-index:5;align-items:center;gap:var(--btn-gap,2px);padding:4px;background:var(--bar,#fff);border:1px solid var(--edge,#999);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3)';
    ui.nudgeUp = mkButton(text('grid.nudgeUp'), () => nudge(-1), { 'data-grid-action': 'nudge-up' }); ui.nudgeUp.textContent = '▲';
    ui.nudgeDown = mkButton(text('grid.nudgeDown'), () => nudge(1), { 'data-grid-action': 'nudge-down' }); ui.nudgeDown.textContent = '▼';
    const nudgeClose = mkButton(text('grid.nudgeClose'), () => { last = null; hideNudge(); }, { 'data-grid-action': 'nudge-close' }); nudgeClose.textContent = '✕';
    ui.nudge.append(ui.nudgeDown, ui.nudgeUp, nudgeClose);
    ui.holder = document.createElement('div'); ui.holder.style.cssText = `position:relative;padding-top:${BAND_CSS}`; // the band of the small window: it never covers the staff
    ui.holder.append(ui.stage, ui.nudge);
    panel.append(bar, ui.palette, ui.beatRow, ui.message, ui.holder);
    scoreHost.parentNode.insertBefore(panel, scoreHost.nextSibling);
    scoreHost.style.display = 'none';
  };

  function open(target = null) {
    if (panel) return;
    const st = target ?? gridCandidateStaff(app);
    if (!st) return;
    staff = st;
    state = readGrid(doc, staff);
    groups = soundGroups(state, getProperty(staff, PID.LINE_COUNT) || 5);
    choice.clear();
    selected = null;
    undoStack = []; redoStack = []; last = null;
    closing = false;
    build();
    render();
    onChange(true);
  }

  function close(commit) {
    if (!panel) return null;
    let result = null;
    if (commit && changedMeasures(state).length) {
      closing = true;
      try {
        result = app.edit(text('grid.title'), () => commitGrid(doc, staff, state));
      } catch (err) {
        closing = false;
        say(text('grid.error', { msg: err?.message ?? String(err) }));
        return null; // reste dans le mode : l'utilisateur peut corriger (le Document n'a pas été modifié)
      }
    }
    closing = true;
    panel.remove();
    panel = null; state = null; staff = null; layout = null;
    scoreHost.style.display = '';
    closing = false;
    onChange(false);
    return result;
  }

  // le Document change autrement (annuler / refaire, autre geste) : l'état de la grille serait périmé → fermeture sans écrire
  const unsubscribe = doc.subscribe(() => { if (panel && !closing) { close(false); } });
  const onResize = () => { if (panel) render(); };
  // while the mode is open the undo / redo of the interface (buttons and keys) act on the grid draft, not on the document
  const onClickCapture = (e) => {
    if (!panel) return;
    const b = e.target.closest?.('[data-action="undo"], [data-action="redo"]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.getAttribute('data-action') === 'undo') undo(); else redo();
  };
  const onKeyCapture = (e) => {
    if (panel && e.key === 'Escape' && last) { last = null; hideNudge(); return; } // the small window closes first; a second Escape does what it did before
    if (!panel || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = String(e.key).toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
  };
  if (typeof window !== 'undefined') { window.addEventListener('click', onClickCapture, true); window.addEventListener('keydown', onKeyCapture, true); }
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);

  return {
    toggle() { if (panel) close(false); else open(); },
    open,
    close,
    setStretch(n) { stretch = n > 1 ? 2 : 1; if (panel) render(); },
    isActive: () => !!panel,
    canOpen: () => gridCandidateStaff(app) !== null,
    destroy() { unsubscribe(); if (typeof window !== 'undefined') { window.removeEventListener('resize', onResize); window.removeEventListener('click', onClickCapture, true); window.removeEventListener('keydown', onKeyCapture, true); } if (panel) { panel.remove(); panel = null; scoreHost.style.display = ''; } },
  };
}
