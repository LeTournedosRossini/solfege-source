/*
 * Éditeur de la carte de percussion d'une portée (étape 5) — fenêtre modale, interface DOM. Taille des cibles = réglage global `--ui-target` ; deux colonnes (liste | détail) au-dessus de 500 px.
 * Aucune logique métier ici : chaque geste est une intention de l'Application (`app.updatePercSound`, `app.renamePercSound`…), donc UNE transaction
 * annulable ; un refus (`PercMapError`) s'affiche dans la zone d'alerte et n'a rien écrit. L'identité d'un son est son NOM (identifiant anglais) ;
 * le n° MIDI est un attribut (un principal et d'autres). Aperçu = portée dessinée par le vrai peintre avec la note du son choisi.
 * Redessinée à chaque événement du Document (modification, annuler, rétablir).
 */
import { PercMapError } from '../model/percmapedit.js';
import { HEAD_GROUP_IDS, EXTRA_HEAD_GLYPHS, drumHeadGlyph } from '../model/drumheads.js';
import { glyphRowIcon } from './mark-icons.js';
import { drumSound, soundDisplayName } from '../model/percmap.js';
import { PID, getProperty, MAX_SWITCHES, MAX_SWITCH_SOUNDS } from '../model/index.js';
import { percSoundPreviewSvg } from './percmap-preview.js';
import { createChoiceMenu } from './choice-menu.js';
import { SHEET_QUERY } from './panel-mode.js';

const MIN = 'var(--ui-target, 44px)'; // global control size (button-size.js)
const STYLE_ID = 'pm-editor-style';
const CSS = `
.pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2500; display: flex; align-items: center; justify-content: center; padding: 8px; }
.pm { font: 14px var(--ui-font,sans-serif); color: var(--ink,#1c1b1a); background: var(--soft,#faf8f3); border-radius: 12px; width: min(980px, 100%); max-height: 100%; overflow: auto; padding: 12px; box-sizing: border-box; }
.pm button, .pm select, .pm input { min-height: ${MIN}; min-width: ${MIN}; font: inherit; padding: 4px 10px; box-sizing: border-box; }
.pm button { cursor: pointer; background: var(--field,#fff); border: 1px solid var(--line,#d8d3c8); border-radius: 8px; }
.pm button[disabled] { opacity: .45; cursor: default; }
.pm button[aria-pressed=true] { background: var(--accent-soft,#e8eefc); border-color: var(--info-ink,#2878ff); }
.pm button.primary { background: var(--primary,#1c1b1a); color: var(--primary-ink,#fff); }
.pm-bar { display: flex; gap: var(--btn-gap, 2px); flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
.pm-bar h2 { margin: 0 auto 0 0; font-size: 16px; }
.pm-main { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
.pm-list { flex: 1 1 100%; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); max-height: 40vh; overflow: auto; }
.pm .pm-item { display: flex; justify-content: space-between; gap: var(--btn-gap, 2px); text-align: left; align-items: center; min-height: calc(${MIN} * .75); padding: 1px 6px; line-height: 1.15; font-size: 13px; border-radius: 6px; }
.pm-item small { color: var(--ink-soft,#6b6560); white-space: nowrap; }
.pm-detail { flex: 1 1 100%; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.pm-detail section, .pm-detail details { border: 1px solid var(--line,#d8d3c8); border-radius: 10px; padding: 10px 12px; background: var(--field,#fff); }
.pm-detail details { padding: 0; }
.pm-detail summary { cursor: pointer; padding: 8px 12px; font-weight: var(--w-semi,600); font-size: 14px; list-style: none; display: flex; align-items: center; gap: 6px; user-select: none; }
.pm-detail summary::-webkit-details-marker { display: none; }
.pm-detail summary::before { content: '▸'; display: inline-block; width: 1em; transition: transform .12s; }
.pm-detail details[open] > summary::before { transform: rotate(90deg); }
.pm-detail details[open] > summary { border-bottom: 1px solid #eee; }
.pm-fold-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.pm-midi { margin-top: 8px; padding-top: 6px; border-top: 1px solid #eee; display: flex; flex-direction: column; gap: 6px; }
.pm-manage { margin-top: 8px; padding-top: 6px; border-top: 1px solid #eee; }
.pm-pair { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
.pm-pair > .pm-pair-preview { flex: 1 1 220px; min-width: 0; }
.pm-pair > .pm-pair-look { flex: 1 1 240px; min-width: 0; }
.pm-detail h3 { margin: 0 0 8px; font-size: 14px; }
.pm-row { display: flex; gap: var(--btn-gap, 2px); flex-wrap: wrap; align-items: center; }
.pm-param { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 3px 0; }
.pm-param > span:first-child { flex: 1 1 auto; }
.pm-param select { min-width: 8em; }
.pm-preview { padding: 6px 8px !important; }
.pm-preview h3 { margin-bottom: 4px !important; }
.pm-value { min-width: 3em; text-align: center; font-variant-numeric: tabular-nums; }
.pm-chip { display: inline-flex; align-items: center; gap: 2px; }
.pm-alert { color: var(--danger-ink,#a02020); min-height: 1.4em; margin: 4px 0; }
.pm-status { color: var(--ok-ink,#2a6a2a); min-height: 1.4em; margin: 4px 0; }
@media (min-width: 501px) {
  .pm-main { flex-wrap: nowrap; }
  .pm-list { flex: 0 0 14em; max-height: none; position: sticky; top: 0; align-self: flex-start; max-height: calc(100vh - 150px); }
  .pm-detail { flex: 1 1 auto; }
}
.pm-preview svg { display: block; background: var(--field,#fff); max-width: 100%; height: auto; }
@media ${SHEET_QUERY} { .pm-overlay { align-items: flex-end; padding: 0; } .pm { border-radius: 12px 12px 0 0; max-height: 92vh; width: 100%; } }
`;

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'disabled' || k === 'checked' || k === 'selected') node[k] = !!v;
    else if (k === 'value') node.value = v;
    else if (k === 'innerHTML') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
};

/**
 * @param app     Application
 * @param options { glyphs, label(k, params) → texte, translate(soundId) → nom français ou undefined, lang }
 * @returns { open(staffId), close(), isOpen(), destroy() }
 */
export function mountPercMapEditor({ app, glyphs, label = (k) => k, translate, lang = 'fr' }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let overlay = null;
  let staffId = null;
  let selected = null;
  let previewLines = 5;
  let onEsc = null;
  let removing = false;
  let presetId = null; // choice state lives here: draw() rebuilds the widgets
  let replaceId = null;
  let message = { kind: 'status', text: '' };
  let off = null;
  const folds = new Map(); // key → open? (kept across redraws; only the preview + look block is open at first)
  /** A collapsible zone: its state survives the redraws. */
  const fold = (key, title, ...body) => el('details', { 'data-fold': key, open: folds.get(key) ?? key === 'look', ontoggle: (e) => folds.set(key, e.target.open) },
    el('summary', {}, title), el('div', { class: 'pm-fold-body' }, body));

  const map = () => app.percMap(staffId);
  const nameOf = (s) => soundDisplayName(s, { lang, translate });
  const sound = () => map().sounds.find((s) => s.id === selected) ?? null;
  const fix = () => { if (!sound()) selected = map().sounds[0]?.id ?? null; };

  const run = (fn, ok) => {
    try { const r = fn(); message = { kind: 'status', text: ok ? ok(r) : '' }; }
    catch (e) {
      if (!(e instanceof PercMapError)) throw e;
      message = { kind: 'error', text: e.code === 'in-use' ? label('percmap.errInUse', { count: e.data.count ?? 0 }) : e.code === 'conflict' ? label('percmap.errConflict', { name: e.data.name }) : e.message };
    }
    removing = false;
    draw();
  };
  const change = (changes) => run(() => app.updatePercSound(staffId, selected, changes));

  const stepper = (valueText, onMinus, onPlus, act, disabledMinus = false, disabledPlus = false) => el('span', { class: 'pm-row stp', 'data-stepper': act },
    el('button', { type: 'button', 'data-act': `${act}-minus`, 'aria-label': '−', disabled: disabledMinus, onclick: onMinus }, '−'),
    el('span', { class: 'pm-value stp-val', 'data-value': act }, valueText),
    el('button', { type: 'button', 'data-act': `${act}-plus`, 'aria-label': '+', disabled: disabledPlus, onclick: onPlus }, '+'));

  // a dropdown: button that unfolds one button per option (custom menu, bottom sheet on phones/tablets)
  const dropdown = (act, options, current, onPick, aria) => createChoiceMenu({ act, options, value: current, onPick, label: aria });

  // the head: a dropdown whose list is a palette of glyphs, three per row (the quarter-note glyph of each group); the button shows the current one
  const headMenu = (sound) => {
    const ids = [...new Set([...HEAD_GROUP_IDS, ...EXTRA_HEAD_GLYPHS, sound.head])];
    const names = ids.map((h) => drumHeadGlyph(h, 'quarter'));
    const side = 1.3; // one frame for all: the glyphs keep their relative sizes (a very wide one, like the slash, shrinks to fit) and sit on the same centre line
    return createChoiceMenu({ act: 'head', label: label('percmap.head'), value: sound.head, columns: 3, follow: true, onPick: (v) => change({ head: v }),
      options: ids.map((h, i) => [h, h, null, () => (glyphs ? glyphRowIcon(glyphs, [names[i]], { side0: side, px: 30 }) : null)]) });
  };

  const topBar = () => {
    const presets = app.percPresets();
    if (!presets.some((p) => p.id === presetId)) presetId = presets[0]?.id;
    const select = dropdown('preset', presets.map((p) => [p.id, p.name]), presetId, (v) => { presetId = v; draw(); }, label('percmap.preset'));
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none', 'data-act': 'import-file', onchange: async () => {
      const f = fileInput.files[0]; fileInput.value = ''; if (!f) return;
      const text = await f.text(); run(() => app.importPercMapFile(staffId, text));
    } });
    return el('div', { class: 'pm-bar' },
      el('h2', {}, `${label('percmap.title')} — ${map().name}`),
      el('button', { type: 'button', 'data-act': 'undo', disabled: !app.doc.canUndo(), onclick: () => { app.undo(); fix(); draw(); } }, '↶'),
      el('button', { type: 'button', 'data-act': 'redo', disabled: !app.doc.canRedo(), onclick: () => { app.redo(); fix(); draw(); } }, '↷'),
      select,
      el('button', { type: 'button', 'data-act': 'apply-preset', onclick: () => run(() => { app.applyPercPreset(staffId, presetId); fix(); }, () => label('percmap.presetApplied')) }, label('percmap.applyPreset')),
      el('button', { type: 'button', 'data-act': 'reassign-voices', title: label('percmap.reassignHint'), disabled: app.percMisplaced(staffId) === 0,
        onclick: () => run(() => app.reassignPercVoices(staffId), (r) => (r.skipped ? label('percmap.voicesMovedSkipped', { moved: r.moved, skipped: r.skipped }) : label('percmap.voicesMoved', { moved: r.moved }))) }, label('percmap.reassign')),
      el('button', { type: 'button', 'data-act': 'export', onclick: () => {
        const blob = new Blob([app.exportPercMapFile(staffId)], { type: 'application/json' });
        const a = el('a', { href: URL.createObjectURL(blob), download: 'carte-percussion.json' });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } }, label('percmap.export')),
      el('button', { type: 'button', 'data-act': 'import', onclick: () => fileInput.click() }, label('percmap.import')),
      fileInput,
      el('button', { type: 'button', class: 'primary', 'data-act': 'close', onclick: () => api.close() }, label('percmap.close')));
  };

  const list = () => {
    const usage = app.percMapUsage(staffId);
    return el('div', { class: 'pm-list', role: 'list' },
      map().sounds.map((s) => el('button', { type: 'button', class: 'pm-item', role: 'listitem', 'data-sound': s.id, 'aria-pressed': String(s.id === selected),
        onclick: () => { selected = s.id; removing = false; message = { kind: 'status', text: '' }; draw(); } },
      el('span', {}, nameOf(s)), el('small', {}, `${s.midi ?? '—'}${usage.get(s.id) ? ` · ${usage.get(s.id)}×` : ''}`))),
      el('div', { class: 'pm-row', 'data-section': 'add' },
        el('input', { type: 'text', 'data-act': 'add-id', maxlength: '24', placeholder: label('percmap.addId'), 'aria-label': label('percmap.addId') }),
        el('button', { type: 'button', 'data-act': 'add', onclick: () => {
          const id = root().querySelector('[data-act=add-id]').value.trim();
          if (!id) { message = { kind: 'error', text: label('percmap.errEmptyId') }; draw(); return; }
          run(() => { app.addPercSound(staffId, { id, name: id, midi: null, head: 'normal', line: 4 }); selected = id; });
        } }, '＋ ', label('percmap.add'))));
  };

  // entry buttons: groups of sounds the drum entry toggles between (default groups until the user edits them)
  const switchesSection = () => {
    const defs = app.percSwitchDefs(staffId);
    const groups = app.percSwitchGroups(staffId).map((g) => ({ id: g.id, sounds: [...g.sounds] }));
    const save = (next) => run(() => app.setPercSwitches(staffId, next));
    const nextId = () => { let n = groups.length + 1; while (groups.some((g) => g.id === `sw${n}`)) n += 1; return `sw${n}`; };
    const rows = groups.map((g, gi) => {
      const chips = g.sounds.map((id, si) => {
        const snd = map().sounds.find((x) => x.id === id);
        return el('span', { class: 'pm-row', 'data-switch-sound': id },
          el('span', {}, snd ? nameOf(snd) : id),
          el('button', { type: 'button', 'data-act': 'switch-sound-remove', 'aria-label': label('percmap.switches.removeSound'), disabled: g.sounds.length <= 2, onclick: () => save(groups.map((x, i) => (i === gi ? { ...x, sounds: x.sounds.filter((s) => s !== id) } : x))) }, '×'));
      });
      const free = map().sounds.filter((x) => !g.sounds.includes(x.id));
      return el('div', { class: 'pm-row', 'data-switch': g.id },
        ...chips,
        g.sounds.length < MAX_SWITCH_SOUNDS && free.length ? dropdown('switch-add-sound', free.map((x) => [x.id, nameOf(x)]), null, (v) => save(groups.map((x, i) => (i === gi ? { ...x, sounds: [...x.sounds, v] } : x))), label('percmap.switches.addSound')) : null,
        el('button', { type: 'button', 'data-act': 'switch-up', disabled: gi === 0, onclick: () => { const n = [...groups]; [n[gi - 1], n[gi]] = [n[gi], n[gi - 1]]; save(n); } }, '▲'),
        el('button', { type: 'button', 'data-act': 'switch-down', disabled: gi === groups.length - 1, onclick: () => { const n = [...groups]; [n[gi + 1], n[gi]] = [n[gi], n[gi + 1]]; save(n); } }, '▼'),
        el('button', { type: 'button', 'data-act': 'switch-remove', 'aria-label': label('percmap.switches.remove'), onclick: () => save(groups.filter((_, i) => i !== gi)) }, '🗑'));
    });
    const candidates = map().sounds;
    return fold('switches', label('percmap.switches'),
      el('div', { style: 'font-size:12px;opacity:.7' }, label('percmap.switches.help')),
      ...(rows.length ? rows : [el('div', {}, label('percmap.switches.none'))]),
      el('div', { class: 'pm-row' },
        el('button', { type: 'button', 'data-act': 'switch-add', disabled: groups.length >= MAX_SWITCHES || candidates.length < 2, onclick: () => save([...groups, { id: nextId(), sounds: candidates.slice(0, 2).map((x) => x.id) }]) }, '＋ ', label('percmap.switches.add')),
        el('button', { type: 'button', 'data-act': 'switch-default', disabled: defs === null, onclick: () => save(null) }, label('percmap.switches.default'))));
  };

  const detail = () => {
    const s = sound();
    if (!s) return el('div', { class: 'pm-detail' }, label('percmap.empty'));
    const midiOptions = [s.midi, ...(s.midiAlso ?? [])];
    const idInput = el('input', { type: 'text', 'data-act': 'rename-id', maxlength: '24', value: s.id, 'aria-label': label('percmap.id') });
    const nameInput = el('input', { type: 'text', 'data-act': 'name', maxlength: '60', value: s.name, 'aria-label': label('percmap.name') });
    const alsoInput = el('input', { type: 'number', min: '0', max: '127', 'data-act': 'also-input', 'aria-label': label('percmap.midiAdd'), style: 'width:5em' });
    const usage = app.percMapUsage(staffId).get(s.id) ?? 0;
    const others = map().sounds.filter((x) => x.id !== s.id);
    if (!others.some((x) => x.id === replaceId)) replaceId = others[0]?.id;
    const replace = dropdown('replace-with', others.map((x) => [x.id, nameOf(x)]), replaceId, (v) => { replaceId = v; draw(); }, label('percmap.replaceWith'));
    const index = map().sounds.findIndex((x) => x.id === s.id);
    const midiBlock = el('div', { class: 'pm-midi', 'data-section': 'midi' }, el('h3', {}, label('percmap.midi')),
        el('div', { class: 'pm-row' }, stepper(s.midi === null ? '—' : String(s.midi),
          () => change({ midi: s.midi === null ? 127 : Math.max(0, s.midi - 1), midiAlso: (s.midiAlso ?? []).filter((m) => m !== (s.midi === null ? 127 : Math.max(0, s.midi - 1))) }),
          () => change({ midi: s.midi === null ? 0 : Math.min(127, s.midi + 1), midiAlso: (s.midiAlso ?? []).filter((m) => m !== (s.midi === null ? 0 : Math.min(127, s.midi + 1))) }), 'midi'),
        el('button', { type: 'button', 'data-act': 'midi-none', disabled: s.midi === null, onclick: () => change({ midi: null }) }, label('percmap.midiNone'))),
        el('div', { class: 'pm-row', 'data-section': 'midi-also' }, label('percmap.midiAlso'),
          (s.midiAlso ?? []).map((m) => el('span', { class: 'pm-chip' }, String(m),
            el('button', { type: 'button', 'data-act': 'also-remove', 'data-midi': String(m), 'aria-label': `${label('percmap.midiRemove')} ${m}`, onclick: () => change({ midiAlso: s.midiAlso.filter((x) => x !== m) }) }, '✕'))),
          alsoInput,
          el('button', { type: 'button', 'data-act': 'also-add', disabled: false, onclick: () => {
            const m = Number(alsoInput.value);
            if (alsoInput.value === '' || !Number.isInteger(m) || m < 0 || m > 127 || midiOptions.includes(m)) { message = { kind: 'error', text: label('percmap.errMidi') }; draw(); return; }
            change({ midiAlso: [...(s.midiAlso ?? []), m] });
          } }, '＋')));
    const manageBlock = el('div', { class: 'pm-manage', 'data-section': 'manage' },
        el('div', { class: 'pm-row' },
          el('button', { type: 'button', 'data-act': 'move-up', disabled: index <= 0, onclick: () => run(() => app.movePercSound(staffId, s.id, index - 1)) }, '▲'),
          el('button', { type: 'button', 'data-act': 'move-down', disabled: index >= map().sounds.length - 1, onclick: () => run(() => app.movePercSound(staffId, s.id, index + 1)) }, '▼'),
          removing
            ? [usage ? [el('span', {}, label('percmap.usedBy', { count: usage })), replace] : null,
              el('button', { type: 'button', class: 'primary', 'data-act': 'remove-confirm', onclick: () => run(() => { app.removePercSound(staffId, s.id, usage ? { replaceWith: replaceId } : undefined); fix(); }) }, label('percmap.removeConfirm')),
              el('button', { type: 'button', 'data-act': 'remove-cancel', onclick: () => { removing = false; draw(); } }, label('percmap.cancel'))]
            : el('button', { type: 'button', 'data-act': 'remove', disabled: others.length === 0, onclick: () => { removing = true; draw(); } }, label('percmap.remove'))));
    const identity = el('section', { 'data-section': 'identity' }, el('h3', {}, label('percmap.identity')),
      el('div', { class: 'pm-row' }, idInput,
        el('button', { type: 'button', 'data-act': 'rename', onclick: () => run(() => { app.renamePercSound(staffId, s.id, idInput.value.trim()); selected = idInput.value.trim(); }) }, label('percmap.rename')),
        nameInput,
        el('button', { type: 'button', 'data-act': 'set-name', onclick: () => change({ name: nameInput.value.trim() || s.name }) }, label('percmap.setName'))));
    const previewBlock = el('div', { class: 'pm-pair-preview', 'data-section': 'preview' }, el('h3', {}, label('percmap.preview')),
      el('div', { 'data-preview': '', innerHTML: percSoundPreviewSvg(glyphs, { percmap: map(), soundId: s.id, lines: previewLines }) }),
      manageBlock);
    const lookBlock = el('div', { class: 'pm-pair-look pm-look' }, el('h3', {}, label('percmap.look')),
      el('div', { class: 'pm-param' }, el('span', {}, label('percmap.voice')),
        dropdown('voice', [[0, '1'], [1, '2'], [2, '3'], [3, '4']], s.voice, (v) => change({ voice: Number(v) }), label('percmap.voice'))),
      el('div', { class: 'pm-param' }, el('span', {}, label('percmap.stem')),
        dropdown('stem', [['auto', label('percmap.stemAuto')], ['up', '↑'], ['down', '↓']], s.stemDirection, (v) => change({ stemDirection: v }), label('percmap.stem'))),
      el('div', { class: 'pm-param' }, el('span', {}, label('percmap.head')), headMenu(s)),
      el('div', { class: 'pm-param' }, el('span', {}, label('percmap.line')),
        stepper(String(s.line), () => change({ line: Math.max(-20, s.line - 1) }), () => change({ line: Math.min(30, s.line + 1) }), 'line', s.line <= -20, s.line >= 30)),
      el('small', {}, label('percmap.lineHelp')),
      midiBlock);
    return el('div', { class: 'pm-detail' },
      identity,
      fold('look', `${label('percmap.preview')} · ${label('percmap.look')}`, el('div', { class: 'pm-pair' }, previewBlock, lookBlock)),
      switchesSection());
  };

  const root = () => overlay.querySelector('.pm');
  const draw = () => {
    if (!overlay) return;
    fix();
    const keepScroll = root().scrollTop;
    const pane = el('div', { class: 'pm', role: 'dialog', 'aria-modal': 'true', 'aria-label': label('percmap.title'), 'data-percmap-editor': '', 'data-resizable': 'percmap' },
      topBar(),
      el('div', { class: message.kind === 'error' ? 'pm-alert' : 'pm-status', role: 'status', 'data-message': message.kind }, message.text),
      el('div', { class: 'pm-main' }, list(), detail()));
    overlay.replaceChildren(pane);
    pane.scrollTop = keepScroll;
  };

  const api = {
    open(id) {
      if (overlay) api.close();
      staffId = id;
      selected = null; removing = false; message = { kind: 'status', text: '' };
      const staff = app.doc.find(id);
      previewLines = Math.max(1, Math.min(5, getProperty(staff, PID.LINE_COUNT) ?? 5)); // the staff's own line count (chosen when the staff is created)
      overlay = el('div', { class: 'pm-overlay', 'data-percmap-overlay': '', 'data-zoom-lock': '', onclick: (e) => { if (e.target === overlay) api.close(); } });
      overlay.append(el('div', { class: 'pm' }));
      document.body.append(overlay);
      off = app.doc.subscribe(() => draw());
      onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } };
      document.addEventListener('keydown', onEsc, true);
      draw();
    },
    close() { off?.(); off = null; if (onEsc) { document.removeEventListener('keydown', onEsc, true); onEsc = null; } overlay?.remove(); overlay = null; },
    isOpen: () => !!overlay,
    destroy() { api.close(); },
  };
  return api;
}
