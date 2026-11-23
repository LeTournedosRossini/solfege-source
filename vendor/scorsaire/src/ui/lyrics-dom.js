/*
 * Saisie des paroles depuis la mélodie — DOM. Deux gestes (décidés avec Jean, 14/10/2026) :
 *  - B, note par note : un champ de texte EN SITUATION, posé là où la syllabe s'écrira, sous la note courante (position absolue dans `stage` : le SVG ne
 *    bouge jamais). Les boutons (◀▶ précédente / suivante, ▲▼ couplet, + nouveau couplet, retour) sont dans la barre contextuelle (tiroir « paroles » de
 *    `dom.js`, via `actions`). Le texte est lu par l'évènement `input` (clavier virtuel compris : on ne se fie jamais à `event.code`) : espace, tiret ou
 *    souligné en fin de saisie valide la syllabe ; une saisie à plusieurs syllabes (collage) est posée en bloc. Annuler / refaire : boutons généraux.
 *  - A, plage : panneau flottant « Paroles de la plage… » (zone de texte, couplet, compteur « n éléments pour m notes », Poser).
 * Tout passe par `Application` (une transaction annulable par geste) ; aucun état de paroles n'est écrit dans le Document ici.
 */
import { cursorOfElement } from './noteentry-cursor.js';

const NS = 'http://www.w3.org/2000/svg';
const BOX = 'display:none;position:absolute;left:0;top:0;z-index:9;gap:var(--btn-gap,2px);width:max-content;max-width:100%;padding:6px;font:15px var(--ui-font,sans-serif);background:var(--bar,rgba(255,255,255,0.97));border:1px solid var(--edge,rgba(0,0,0,0.25));border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.3);box-sizing:border-box;color:var(--ink,#000)';

export function mountLyrics({ stage, view, app, label, entryMessage = () => {}, stageVisible }) {
  // ---------- repère de la note courante (calque SVG séparé) ----------
  const layer = document.createElementNS(NS, 'svg');
  layer.setAttribute('data-lyrics-layer', '');
  layer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  const mark = document.createElementNS(NS, 'rect');
  mark.setAttribute('data-lyrics-cursor', '');
  mark.setAttribute('fill', 'rgba(230,130,0,0.85)'); mark.setAttribute('rx', '1.5');
  mark.style.display = 'none';
  layer.append(mark);

  // ---------- geste B : champ en situation ----------
  const field = document.createElement('div');
  field.setAttribute('data-lyrics-field', ''); field.setAttribute('role', 'group');
  field.style.cssText = 'display:none;position:absolute;left:0;top:0;z-index:9;box-sizing:border-box;background:var(--field,#fff);border:2px solid var(--sel-edge,#2d78ff);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.25)';
  const input = document.createElement('input');
  input.type = 'text'; input.setAttribute('data-lyrics-input', '');
  input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off');
  input.spellcheck = false; input.setAttribute('enterkeyhint', 'next');
  input.setAttribute('aria-label', label('lyrics.input')); input.placeholder = label('lyrics.placeholder');
  // 16 px at least (no automatic zoom on iPad); the size follows the staff space (a lyric is 2 staff spaces tall)
  const fit = () => {
    const px = Math.max(16, Math.round(2 * view.staffSpace()));
    input.style.cssText = `border:0;outline:0;background:transparent;text-align:center;font:italic ${px}px Georgia,'Times New Roman',serif;height:${Math.round(px * 1.6)}px;padding:0 6px;box-sizing:border-box;width:${Math.max(4, input.value.length + 2)}ch;min-width:4ch`;
  };
  const btn = (text, key, action, fn) => { // buttons of the range panel (gesture A)
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.title = label(key); b.setAttribute('aria-label', label(key)); b.setAttribute('data-action', action);
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);font:16px var(--ui-font,sans-serif)';
    b.addEventListener('click', fn);
    return b;
  };
  let original = '';
  const say = (key, params) => entryMessage(key ? label(key, params) : '');
  const fail = (e) => {
    if (e?.name === 'LyricsError') say({ emptyDash: 'lyrics.errEmptyDash', noMelisma: 'lyrics.errNoMelisma' }[e.code] ?? 'lyrics.errNoMelisma');
    else entryMessage(String(e?.message ?? e));
  };
  const go = (dir) => { if (!app.stepLyrics(dir)) say('lyrics.atEnd'); else say(''); };
  const commit = (join) => {
    const text = input.value.trim();
    try {
      // syllabe existante laissée telle quelle + espace : on passe simplement à la note suivante (rien n'est réécrit)
      if (join === 'space' && text === original) { go(1); return; }
      app.commitLyrics(text, join);
      say('');
    } catch (e) { fail(e); }
  };
  field.append(input);

  input.addEventListener('input', () => {
    fit();
    const v = input.value;
    const core = v.trim();
    if (!core) { if (/\s/.test(v)) { input.value = ''; commit('space'); } return; }
    // plusieurs syllabes dans le champ (collage) : posées en bloc à partir de la note courante
    if (/[^\s_-][\s_-]+[^\s_-]/.test(core) || (/^[_-]/.test(core) && core.length > 1 && /[^\s_-]/.test(core))) {
      try { const r = app.pasteLyricsAtCursor(v); input.value = ''; original = ''; say(r.left ? 'lyrics.leftover' : '', { n: r.left.split(/\s+/).filter(Boolean).length }); } catch (e) { fail(e); }
      return;
    }
    const last = v.slice(-1);
    if (last === ' ' || /\s/.test(last)) { input.value = core; commit('space'); }
    else if (last === '-') { input.value = core.replace(/-+$/, ''); commit('dash'); }
    else if (last === '_') { input.value = core.replace(/_+$/, ''); commit('melisma'); }
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // jamais une touche de saisie de notes pendant qu'on écrit une syllabe
    if (e.isComposing) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && String(k).toLowerCase() === 'z') {
      // brouillon intact : Ctrl+Z annule la dernière syllabe validée (le Document), sinon l'annulation du champ reste celle du navigateur
      if (input.value === original) { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); app.stopLyrics(); return; }
    if (k === 'Enter') { e.preventDefault(); app.changeLyricsVerse(1, true); return; }
    if (k === 'ArrowDown') { e.preventDefault(); app.changeLyricsVerse(1); return; }
    if (k === 'ArrowUp') { e.preventDefault(); app.changeLyricsVerse(-1); return; }
    const all = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    if (k === 'ArrowRight' && (input.selectionStart === input.value.length || (all && input.value === original))) { e.preventDefault(); go(1); return; }
    if (k === 'ArrowLeft' && (input.selectionEnd === 0 || (all && input.value === original && original === ''))) { e.preventDefault(); go(-1); return; }
    if (k === 'Backspace' && input.value === '' && original === '') { e.preventDefault(); go(-1); return; }
    if (k === ' ' && e.shiftKey) { e.preventDefault(); go(-1); }
  });

  // ---------- placement : sous la note courante, sinon au-dessus ----------
  const placeNear = (el, anchor) => {
    if (el.style.display === 'none' || !anchor) return;
    const visible = stageVisible();
    el.style.maxWidth = `${Math.min(visible.right - visible.left, 560)}px`;
    const w = el.offsetWidth, h = el.offsetHeight;
    const cx = (anchor.x1 + anchor.x2) / 2;
    const x = w >= visible.right - visible.left ? visible.left : Math.min(Math.max(cx - w / 2, visible.left), visible.right - w);
    let y = anchor.y2 + 8;
    if (y + h > visible.bottom) y = Math.max(visible.top, anchor.y1 - 8 - h);
    el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`;
  };
  const cursorGeometry = () => {
    const st = app.lyricsEntry();
    if (!st.active || !st.cursor) return null;
    const at = cursorOfElement(app.doc, st.cursor.chordId);
    return at ? view.entryCursorRect(at) : null;
  };
  const place = () => {
    const r = cursorGeometry();
    if (r && field.style.display !== 'none') {
      // centred on the note column, on the line of the verse under the staff (a lyric line is 2 staff spaces tall, the first one 1.2 lines under the staff)
      const ss = view.staffSpace();
      const visible = stageVisible();
      const w = field.offsetWidth, h = field.offsetHeight;
      const cx = r.x + r.w / 2;
      const yc = r.y2 + (app.lyricsEntry().cursor.verse + 1.2) * 2 * ss;
      const x = Math.min(Math.max(cx - w / 2, visible.left), Math.max(visible.left, visible.right - w));
      field.style.left = `${Math.round(x)}px`; field.style.top = `${Math.round(yc - h / 2)}px`;
    }
    placePanel();
  };
  /** Dessin du repère + du champ (après chaque rendu de la partition et chaque changement d'état). */
  const draw = (svgSize) => {
    if (svgSize) { for (const a of ['width', 'height', 'viewBox']) if (svgSize.getAttribute(a)) layer.setAttribute(a, svgSize.getAttribute(a)); }
    const st = app.lyricsEntry();
    const r = st.active ? cursorGeometry() : null;
    if (!st.active || !r) { mark.style.display = 'none'; field.style.display = 'none'; return; }
    mark.setAttribute('x', r.x); mark.setAttribute('y', r.y1); mark.setAttribute('width', r.w); mark.setAttribute('height', r.y2 - r.y1);
    mark.style.display = '';
    field.style.display = 'flex';
    place();
  };
  let lastKey = '';
  const syncField = ({ focus = true } = {}) => {
    const st = app.lyricsEntry();
    if (!st.active) { field.style.display = 'none'; mark.style.display = 'none'; lastKey = ''; return; }
    const cur = app.lyricsCurrent();
    const key = `${st.cursor.chordId}|${st.cursor.verse}|${cur.text}`;
    if (key !== lastKey) {
      lastKey = key;
      original = cur.text;
      input.value = cur.text; fit();
      input.placeholder = cur.covered ? label('lyrics.covered') : label('lyrics.placeholder');
    }
    draw();
    if (focus) {
      input.focus({ preventScroll: true });
      input.select();
      // la note courante doit rester visible (défilement minimal, jamais de recentrage)
      const r = cursorGeometry();
      if (r && typeof field.scrollIntoView === 'function') field.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  };
  const offLyrics = app.onLyricsChange(() => { syncField(); });
  // un clic sur une note déplace le curseur de paroles (au lieu de seulement la sélectionner)
  const offSelection = view.onSelectionChange((ids) => {
    if (app.lyricsEntry().active && ids.length === 1) app.moveLyricsTo(ids[0]);
  });

  // ---------- geste A : panneau pour une plage ----------
  const panel = document.createElement('div');
  panel.setAttribute('data-lyrics-panel', ''); panel.setAttribute('role', 'dialog');
  panel.style.cssText = `${BOX};flex-direction:column;width:min(420px,100%)`;
  const ptitle = document.createElement('div');
  ptitle.style.cssText = 'display:flex;align-items:center;gap:var(--btn-gap,2px)';
  const pVerse = document.createElement('span');
  pVerse.setAttribute('data-lyrics-panel-verse', ''); pVerse.style.cssText = 'flex:1;font-weight:var(--w-bold,700)';
  const area = document.createElement('textarea');
  area.setAttribute('data-lyrics-text', ''); area.rows = 3; area.placeholder = label('lyrics.blockPlaceholder');
  area.setAttribute('autocomplete', 'off'); area.setAttribute('autocapitalize', 'off'); area.setAttribute('autocorrect', 'off'); area.spellcheck = false;
  area.style.cssText = 'width:100%;font:16px var(--ui-font,sans-serif);box-sizing:border-box;padding:6px;resize:vertical;min-height:80px;background:var(--field,#fff);color:var(--ink,#000);border:1px solid var(--field-edge,#767676);border-radius:8px';
  const info = document.createElement('div');
  info.setAttribute('data-lyrics-count', ''); info.style.cssText = 'font-size:13px;min-height:18px';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:var(--btn-gap,2px);justify-content:flex-end';
  let panelRange = null; let panelVerse = 0; let panelLeft = '';
  const pbtn = (text, key, action, fn) => { const b = btn(text, key, action, fn); b.textContent = text; return b; };
  const refreshPanel = () => {
    const range = view.range() ?? panelRange;
    if (!range) return;
    panelRange = range;
    const text = area.value;
    const c = app.lyricsRangeInfo(range, text);
    pVerse.textContent = label('lyrics.verse', { n: panelVerse + 1 });
    info.textContent = panelLeft || label('lyrics.count', { words: c.words, notes: c.notes });
    apply.disabled = !c.chordIds.length || !c.words;
    adjust.disabled = !c.staffId || !c.chordIds.length;
    if (gridMode) { info.textContent = label('lyrics.gridInfo', { n: gridFields.length }); attach.disabled = !c.chordIds.length; }
  };
  const closePanel = () => { panel.style.display = 'none'; panelRange = null; panelLeft = ''; if (gridMode) setGridMode(false); };
  const apply = pbtn(label('lyrics.apply'), 'lyrics.apply', 'lyrics-apply', () => {
    const range = view.range() ?? panelRange;
    if (!range) return;
    try {
      const r = app.writeLyricsBlock(range, panelVerse, area.value, view.id);
      if (r.left) { area.value = r.left; panelLeft = label('lyrics.leftover', { n: r.left.split(/\s+/).filter(Boolean).length }); refreshPanel(); info.textContent = panelLeft; }
      else { area.value = ''; closePanel(); say(''); }
    } catch (e) { entryMessage(e?.code === 'noChords' ? label('lyrics.noChords') : String(e?.message ?? e)); }
  });
  apply.textContent = label('lyrics.apply'); apply.style.cssText += ';padding:0 14px';
  // « Sur la grille » : one field per measure of the range, holding what the verse says there (no bar line to type); Enter goes to the next measure
  const gridBox = document.createElement('div');
  gridBox.setAttribute('data-lyrics-grid', ''); gridBox.style.cssText = 'display:none;flex-direction:column;gap:6px;max-height:50vh;overflow:auto';
  let gridMode = false; let gridFields = [];
  const buildGrid = () => {
    gridBox.replaceChildren(); gridFields = [];
    const range = view.range() ?? panelRange;
    if (!range) return;
    const ms = app.lyricsGridMeasures(range, panelVerse);
    ms.forEach((m, k) => {
      const rowEl = document.createElement('label');
      rowEl.style.cssText = 'display:flex;align-items:center;gap:8px';
      const lab = document.createElement('span'); lab.textContent = label('lyrics.measure', { n: m.number }); lab.style.cssText = 'min-width:3.4em;font-size:13px;opacity:.7';
      const input = document.createElement('input');
      input.type = 'text'; input.value = m.text; input.setAttribute('data-lyrics-measure', String(m.number)); input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off'); input.spellcheck = false;
      input.style.cssText = 'flex:1;min-width:0;font:16px var(--ui-font,sans-serif);padding:6px 8px;box-sizing:border-box;min-height:var(--ui-target,44px);background:var(--field,#fff);color:var(--ink,#000);border:1px solid var(--field-edge,#767676);border-radius:8px';
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (gridFields[k + 1]) gridFields[k + 1].input.focus(); else gridApply.click(); }
      });
      rowEl.append(lab, input); gridBox.append(rowEl); gridFields.push({ id: m.id, input });
    });
  };
  const setGridMode = (on) => {
    gridMode = on;
    area.style.display = on ? 'none' : ''; gridBox.style.display = on ? 'flex' : 'none';
    apply.style.display = on ? 'none' : ''; gridApply.style.display = on ? '' : 'none'; attach.style.display = on ? '' : 'none';
    grid.textContent = label(on ? 'lyrics.onNotes' : 'lyrics.grid');
    if (on) { buildGrid(); gridFields[0]?.input.focus({ preventScroll: true }); }
    refreshPanel();
  };
  const grid = pbtn(label('lyrics.grid'), 'lyrics.gridTip', 'lyrics-grid', () => setGridMode(!gridMode));
  grid.textContent = label('lyrics.grid'); grid.style.cssText += ';padding:0 14px';
  const gridApply = pbtn(label('lyrics.apply'), 'lyrics.gridTip', 'lyrics-grid-apply', () => {
    try { app.writeLyricsGrid(panelVerse, gridFields.map((f) => ({ id: f.id, text: f.input.value })), view.id); closePanel(); say(''); } catch (e) { entryMessage(String(e?.message ?? e)); }
  });
  gridApply.textContent = label('lyrics.apply'); gridApply.style.cssText += ';padding:0 14px;display:none';
  // the rhythm is entered afterwards: the words of the grid go on the notes of the staff of the range, measure by measure
  const attach = pbtn(label('lyrics.attach'), 'lyrics.attachTip', 'lyrics-attach', () => {
    const range = view.range() ?? panelRange;
    if (!range) return;
    try {
      app.writeLyricsGrid(panelVerse, gridFields.map((f) => ({ id: f.id, text: f.input.value })), view.id);
      const r = app.attachLyricsGrid(range, panelVerse, view.id);
      closePanel(); say(r.unlinked ? 'lyrics.attached' : '', { linked: r.linked, unlinked: r.unlinked });
    } catch (e) { entryMessage(String(e?.message ?? e)); }
  });
  attach.textContent = label('lyrics.attach'); attach.style.cssText += ';padding:0 14px;display:none';
  // the whole text and the notes of the staff, to put every syllable on its note (a window of its own: ui/lyrics-adjust-dom.js)
  const adjust = pbtn(label('lyrics.adjust'), 'lyrics.adjustTip', 'lyrics-adjust', () => {
    const range = view.range() ?? panelRange;
    if (!range) return;
    try {
      if (gridMode) app.writeLyricsGrid(panelVerse, gridFields.map((f) => ({ id: f.id, text: f.input.value })), view.id);
      const { staffId } = app.lyricsRangeInfo(range, '');
      const verse = panelVerse;
      closePanel();
      window.dispatchEvent(new CustomEvent('scorsaire:lyrics-adjust', { detail: { staffId, verse } }));
    } catch (e) { entryMessage(String(e?.message ?? e)); }
  });
  adjust.textContent = label('lyrics.adjust'); adjust.style.cssText += ';padding:0 14px';
  // a text with no notes at all: typed or pasted, the chords put by hand (a window of its own: ui/lyrics-sheet-dom.js)
  const freeSheet = pbtn(label('lyrics.sheet'), 'lyrics.sheetTip', 'lyrics-sheet', () => {
    const verse = panelVerse;
    closePanel();
    window.dispatchEvent(new CustomEvent('scorsaire:lyrics-sheet', { detail: { verse } }));
  });
  freeSheet.textContent = label('lyrics.sheet'); freeSheet.style.cssText += ';padding:0 14px';
  const cancel = pbtn(label('lyrics.cancel'), 'lyrics.cancel', 'lyrics-cancel', closePanel);
  cancel.textContent = label('lyrics.cancel'); cancel.style.cssText += ';padding:0 14px';
  const verseMinus = pbtn('−', 'lyrics.verseUp', 'lyrics-panel-verse-down', () => { panelVerse = Math.max(0, panelVerse - 1); panelLeft = ''; if (gridMode) buildGrid(); refreshPanel(); });
  const versePlus = pbtn('+', 'lyrics.verseDown', 'lyrics-panel-verse-up', () => { panelVerse = Math.min(app.verseCount(), panelVerse + 1); panelLeft = ''; if (gridMode) buildGrid(); refreshPanel(); });
  // le panneau écrit dans une zone de texte : les boutons ne volent pas le focus de cette zone seulement s'il y est déjà
  ptitle.append(pVerse, verseMinus, versePlus);
  row.append(cancel, freeSheet, adjust, grid, apply, attach, gridApply);
  panel.append(ptitle, area, gridBox, info, row);
  area.addEventListener('input', () => { panelLeft = ''; refreshPanel(); });
  area.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closePanel(); } });
  const placePanel = () => {
    if (panel.style.display === 'none') return;
    const bands = view.rangeBands();
    if (!bands.length) return;
    placeNear(panel, { x1: Math.min(...bands.map((b) => b.x1)), x2: Math.max(...bands.map((b) => b.x2)), y1: bands[0].y1, y2: Math.max(...bands.map((b) => b.y2)) });
  };
  const offRange = view.onRangeChange((r) => { if (!r) closePanel(); else if (panel.style.display !== 'none') { refreshPanel(); placePanel(); } });
  stage.append(layer, field, panel);

  // ---------- drag a syllable of the score onto another note (mouse: after a few pixels; finger or pen: after a short press) ----------
  const dropMark = document.createElementNS(NS, 'rect');
  dropMark.setAttribute('data-lyrics-drop', ''); dropMark.setAttribute('fill', 'rgba(45,120,255,0.55)'); dropMark.setAttribute('rx', '1.5'); dropMark.style.display = 'none';
  layer.append(dropMark);
  let drag = null;
  const scorePoint = (e) => {
    const svg = stage.querySelector('svg[role="img"]');
    if (!svg) return null;
    const b = svg.getBoundingClientRect(); const k = svg.viewBox.baseVal.width / b.width;
    return { x: (e.clientX - b.left) * k, y: (e.clientY - b.top) * k, k };
  };
  const targetUnder = (e) => {
    const p = scorePoint(e);
    const hit = p ? view.hitTest(p.x, p.y, { tolerance: 10 * p.k }) : null;
    return hit ? app.lyricDropTarget(hit.ref) && { ref: hit.ref, ...app.lyricDropTarget(hit.ref) } : null;
  };
  const endDrag = () => {
    if (!drag) return;
    clearTimeout(drag.timer); drag.ghost?.remove(); dropMark.style.display = 'none';
    window.removeEventListener('pointermove', onDragMove, true); window.removeEventListener('pointerup', onDragUp, true); window.removeEventListener('pointercancel', endDrag, true);
    drag = null;
  };
  const arm = () => {
    if (!drag || drag.armed) return;
    drag.armed = true;
    const g = document.createElement('div');
    g.textContent = drag.text; g.setAttribute('data-lyrics-ghost', '');
    g.style.cssText = 'position:fixed;z-index:3800;pointer-events:none;padding:2px 8px;border-radius:6px;font:italic 18px Georgia,serif;background:var(--field,#fff);color:var(--ink,#000);border:2px solid var(--sel-edge,#2d78ff);box-shadow:0 2px 8px rgba(0,0,0,0.3);transform:translate(-50%,-140%)';
    document.body.append(g); drag.ghost = g;
  };
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.armed) {
      const far = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5;
      if (e.pointerType === 'mouse' && far) arm(); else if (far && e.pointerType !== 'mouse') { endDrag(); return; } // a finger that moves before the press is a scroll, not a drag
      if (!drag?.armed) return;
    }
    e.preventDefault();
    drag.ghost.style.left = `${e.clientX}px`; drag.ghost.style.top = `${e.clientY}px`;
    const t = targetUnder(e);
    const r = t ? view.entryCursorRect(cursorOfElement(app.doc, t.chordId)) : null;
    if (r) { dropMark.setAttribute('x', r.x); dropMark.setAttribute('y', r.y1); dropMark.setAttribute('width', Math.max(r.w, 3)); dropMark.setAttribute('height', r.y2 - r.y1); dropMark.style.display = ''; } else dropMark.style.display = 'none';
  }
  function onDragUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const was = drag; const t = was.armed ? targetUnder(e) : null;
    endDrag();
    if (!was.armed) return; // a plain tap: the editor treats it as usual
    e.stopPropagation(); e.preventDefault();
    if (!t) return;
    try { app.moveLyric(was.ref, t.ref, view.id); } catch (err) { entryMessage(String(err?.message ?? err)); }
  }
  const onLyricDown = (e) => {
    if (e.button > 0 || drag) return;
    const g = e.target.closest?.('[data-role="lyric"]');
    const ref = g?.getAttribute('data-ref');
    if (!ref || !app.doc.findListEntry?.(ref)) return;
    drag = { ref, id: e.pointerId, x0: e.clientX, y0: e.clientY, armed: false, ghost: null, text: g.textContent || '·', timer: null };
    if (e.pointerType !== 'mouse') drag.timer = setTimeout(() => { arm(); if (drag?.ghost) { drag.ghost.style.left = `${drag.x0}px`; drag.ghost.style.top = `${drag.y0}px`; } }, 350);
    window.addEventListener('pointermove', onDragMove, true); window.addEventListener('pointerup', onDragUp, true); window.addEventListener('pointercancel', endDrag, true);
  };
  stage.addEventListener('pointerdown', onLyricDown, true);

  return {
    /** Geste B : démarre sur l'élément désigné (accord, note, silence) ou sur le premier accord. */
    start(id = null) {
      closePanel();
      const ok = app.startLyrics(id, app.lyricsEntry().cursor?.verse ?? 0);
      if (!ok) entryMessage(label('lyrics.noChords'));
      return ok;
    },
    /** Geste A : ouvre le panneau pour la plage. */
    openBlock(range) {
      app.stopLyrics();
      panelRange = range; panelLeft = '';
      panelVerse = app.lyricsEntry().cursor?.verse ?? 0;
      panel.style.display = 'flex';
      refreshPanel();
      placePanel();
      area.focus({ preventScroll: true });
    },
    close() { app.stopLyrics(); closePanel(); },
    /** Actions of the lyrics drawer (the buttons live in the context bar, see dom.js). */
    actions: {
      go,
      verse: (delta) => app.changeLyricsVerse(delta),
      newVerse: () => app.changeLyricsVerse(1, true),
      close: () => app.stopLyrics(),
    },
    draw, place,
    isActive: () => app.lyricsEntry().active,
    dispose() { endDrag(); stage.removeEventListener('pointerdown', onLyricDown, true); offLyrics(); offSelection(); offRange(); layer.remove(); field.remove(); panel.remove(); },
  };
}
