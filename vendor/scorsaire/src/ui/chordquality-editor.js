/*
 * Éditeur du dictionnaire de qualités d'accord (étape 5, tranche 5) — interface DOM. Tablette d'abord : toutes les cibles font au moins 44 px.
 * Aucune logique métier ici : chaque geste est une intention de l'Application (`app.addChordQuality`, `app.renameChordQuality`…), donc UNE transaction
 * annulable ; un refus (`ChordQualityError`) s'affiche dans la zone d'alerte et n'a rien écrit. Pas de saisie de texte brut d'accord : on édite le
 * dictionnaire (identifiant, alias, notes sur un clavier de deux octaves), jamais un symbole.
 *
 * L'éditeur se redessine à chaque événement du Document (modification, annuler, rétablir).
 */
import {
  ChordQualityError, KEYBOARD_SEMITONES, PREVIEW_ROOTS, VARIANT_BUTTONS, VARIANT_MAX, MAX_VARIANTS, isDisplayVariant,
  chordIntervalLabel, chordIntervalNote, chordIntervalHasAlternative, chordQualityNoteNames,
  defaultChordQuality, isModifiedDefaultChordQuality, missingDefaultChordQualities, isDefaultChordQualities,
} from '../model/chordquality.js';
import { qualityPieceLabels } from '../layout/chorddisplay.js';
import { GAP_MIN, GAP_MAX } from '../model/chordquality.js';
import { chordSymbolPreviewSvg } from './chordquality-preview.js';

const MIN = 44; // cible tactile minimale, px
const STYLE_ID = 'cq-editor-style';
const CSS = `
.cq { font: 14px var(--ui-font,sans-serif); color: var(--ink, var(--ink,#1c1b1a)); }
.cq button, .cq select, .cq input[type=text] { min-height: ${MIN}px; min-width: ${MIN}px; font: inherit; padding: 4px 10px; box-sizing: border-box; }
.cq button { cursor: pointer; background: var(--field,#fff); border: 1px solid var(--line, var(--line,#d8d3c8)); border-radius: 8px; }
.cq button[disabled] { opacity: .45; cursor: default; }
.cq button.primary { background: var(--primary,#1c1b1a); color: var(--primary-ink,#fff); }
.cq-bar { display: flex; gap: var(--btn-gap, 2px); flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
.cq-main { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
.cq-list { flex: 1 1 260px; max-width: 360px; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); max-height: 70vh; overflow: auto; }
.cq-item { display: flex; align-items: center; gap: var(--btn-gap, 2px); justify-content: space-between; text-align: left; }
.cq-item[aria-pressed=true] { background: var(--accent-soft,#e8eefc); border-color: var(--info-ink,#2878ff); }
.cq-item small { color: var(--ink-soft,#6b6560); }
.cq-detail { flex: 2 1 340px; min-width: 300px; display: flex; flex-direction: column; gap: 14px; }
.cq-detail section { border: 1px solid var(--line, var(--line,#d8d3c8)); border-radius: 10px; padding: 10px 12px; background: var(--field,#fff); }
.cq-detail h3 { margin: 0 0 8px; font-size: 14px; }
.cq-row { display: flex; gap: var(--btn-gap, 2px); flex-wrap: wrap; align-items: center; }
.cq-chip { display: inline-flex; align-items: center; gap: var(--btn-gap, 2px); }
.cq-piece { font-size: 20px; padding: 0 4px; }
.cq-gap { display: inline-flex; align-items: center; gap: 2px; }
.cq-gap button { min-width: var(--ui-target,44px); min-height: var(--ui-target,44px); }
.cq-gapvalue { min-width: 3em; text-align: center; font-variant-numeric: tabular-nums; }
.cq-kbd { display: flex; gap: var(--btn-gap, 2px); margin-bottom: 4px; overflow-x: auto; }
.cq-key { flex: 1 1 ${MIN}px; min-width: ${MIN}px; min-height: ${MIN + 12}px !important; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.15; padding: 2px !important; }
.cq-key b { font-size: 15px; }
.cq-key span { font-size: 11px; color: var(--ink-soft,#6b6560); }
.cq-key[aria-pressed=true] { background: #2878ff; border-color: var(--info-ink,#2878ff); color: #fff; }
.cq-key[aria-pressed=true] span { color: #dbe6ff; }
.cq-alert { color: var(--danger-ink,#a02020); min-height: 1.4em; margin: 6px 0; }
.cq-status { color: var(--ok-ink,#2a6a2a); min-height: 1.4em; margin: 6px 0; }
.cq-notes { font-size: 17px; letter-spacing: .04em; }
.cq-compose { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); margin-top: 8px; }
.cq-compose button { min-width: ${MIN}px; }
.cq-draft { font-size: 18px; min-width: 6em; padding: 6px 10px; border: 1px dashed var(--line, var(--line,#d8d3c8)); border-radius: 8px; min-height: ${MIN - 14}px; display: inline-flex; align-items: center; }
.cq-variant[aria-pressed=true] { background: var(--accent-soft,#e8eefc); border-color: var(--info-ink,#2878ff); }
.cq-preview svg { display: block; background: var(--field,#fff); }
`;

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'disabled' || k === 'checked') node[k] = !!v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
};

/**
 * @param host    élément qui reçoit l'éditeur
 * @param app     Application (intentions du dictionnaire)
 * @param options { glyphs, label(k, params) -> texte, staffSpace }
 * @returns { refresh(), select(id), destroy() }
 */
export function mountChordQualityEditor(host, app, { glyphs, label = (k) => k, staffSpace = 20 } = {}) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  const root = el('div', { class: 'cq', 'data-chord-quality-editor': '' });
  host.replaceChildren(root);

  let selected = app.chordQualities().qualities[0]?.id ?? null; // identifiant de la qualité choisie
  let previewRoot = 0; // indice dans PREVIEW_ROOTS
  let previewSpelling = 'enharmonic'; // 'enharmonic' | 'key' (aperçu seulement : l'option de la portée d'accords est une propriété du document)
  let previewFifths = 0; // armure de l'aperçu (mode 'key')
  let draft = ''; // écriture en cours de composition (boutons)
  let removing = false; // panneau de suppression ouvert
  let confirmReset = false;
  let message = { kind: 'status', text: '' };

  const show = (kind, text) => { message = { kind, text }; draw(); };
  const nameOf = (id) => (id === '' ? label('chordQuality.none') : id);

  /** Exécute une intention : un refus s'affiche, rien n'a été écrit. */
  const run = (fn, ok) => {
    try {
      const result = fn();
      message = { kind: 'status', text: ok ? ok(result) : '' };
    } catch (e) {
      if (!(e instanceof ChordQualityError)) throw e;
      message = { kind: 'error', text: describe(e) };
    }
    removing = false; confirmReset = false;
    draw();
  };
  const describe = (e) => {
    if (e.code === 'in-use') {
      const names = e.data.orphans ? e.data.orphans.map((o) => `« ${nameOf(o.text)} »`).join(', ') : `« ${nameOf(e.data.id)} »`;
      return label('chordQuality.errInUse', { count: e.data.count, names });
    }
    if (e.code === 'conflict') return label('chordQuality.errConflict', { name: nameOf(e.data.name) });
    return e.message;
  };

  const quality = () => app.chordQualities().qualities.find((x) => x.id === selected) ?? null;

  // ---------- barre du haut ----------
  const bar = () => {
    const picked = app.defaultChordQualities();
    return el('div', { class: 'cq-bar' },
      el('button', { type: 'button', 'data-act': 'undo', disabled: !app.doc.canUndo(), onclick: () => { app.undo(); fixSelection(); draw(); } }, '↶ ', label('chordQuality.undo')),
      el('button', { type: 'button', 'data-act': 'redo', disabled: !app.doc.canRedo(), onclick: () => { app.redo(); fixSelection(); draw(); } }, '↷ ', label('chordQuality.redo')),
      el('button', { type: 'button', 'data-act': 'export', onclick: doExport }, label('chordQuality.export')),
      el('button', { type: 'button', 'data-act': 'import', onclick: () => fileInput.click() }, label('chordQuality.import')),
      el('button', { type: 'button', 'data-act': 'use-default', onclick: () => { app.useChordQualitiesAsDefault(); show('status', label('chordQuality.defaultSaved')); } }, label('chordQuality.useAsDefault')),
      el('button', { type: 'button', 'data-act': 'apply-default', onclick: () => run(() => app.applyDefaultChordQualities()) }, label('chordQuality.applyDefault')),
      picked ? el('button', { type: 'button', 'data-act': 'clear-default', onclick: () => { app.clearDefaultChordQualities(); show('status', label('chordQuality.defaultCleared')); } }, label('chordQuality.clearDefault')) : null);
  };
  const fileInput = el('input', {
    type: 'file', accept: '.json,application/json', style: 'display:none', 'data-act': 'import-file',
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      const text = await file.text();
      run(() => app.importChordQualities(text));
    },
  });
  const doExport = () => {
    const blob = new Blob([app.exportChordQualities()], { type: 'application/json' });
    const link = el('a', { href: URL.createObjectURL(blob), download: 'qualites-accords.json' });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  // ---------- liste ----------
  const list = () => {
    const dict = app.chordQualities();
    const usage = app.chordQualityUsage();
    const missing = missingDefaultChordQualities(dict);
    const restoreSelect = el('select', { 'data-act': 'restore-select', 'aria-label': label('chordQuality.restore') }, missing.map((x) => el('option', { value: x.id }, nameOf(x.id))));
    return el('div', { class: 'cq-list', role: 'list', 'aria-label': label('chordQuality.list') },
      dict.qualities.map((x) => el('button', {
        type: 'button', class: 'cq-item', role: 'listitem', 'data-quality': x.id, 'aria-pressed': x.id === selected ? 'true' : 'false',
        onclick: () => { selected = x.id; removing = false; confirmReset = false; message = { kind: 'status', text: '' }; draw(); },
      }, el('span', {}, nameOf(x.id), isModifiedDefaultChordQuality(dict, x.id) ? el('small', {}, ` · ${label('chordQuality.modified')}`) : null),
      el('small', {}, usage.get(x.id) ? label('chordQuality.used', { count: usage.get(x.id) }) : ''))),
      el('div', { class: 'cq-row', 'data-section': 'add' },
        el('input', { type: 'text', 'data-act': 'add-id', maxlength: '16', placeholder: label('chordQuality.addId'), 'aria-label': label('chordQuality.addId') }),
        el('button', { type: 'button', 'data-act': 'add', onclick: doAdd }, '＋ ', label('chordQuality.addDo'))),
      missing.length ? el('div', { class: 'cq-row', 'data-section': 'restore' }, restoreSelect,
        el('button', { type: 'button', 'data-act': 'restore', onclick: () => run(() => { app.restoreChordQuality(restoreSelect.value); selected = restoreSelect.value; }) }, label('chordQuality.restoreDo'))) : null,
      confirmReset
        ? el('button', { type: 'button', class: 'primary', 'data-act': 'reset-all-confirm', onclick: () => run(() => { app.resetAllChordQualities(); fixSelection(); }) }, label('chordQuality.resetAllConfirm'))
        : el('button', { type: 'button', 'data-act': 'reset-all', disabled: isDefaultChordQualities(dict), onclick: () => { confirmReset = true; draw(); } }, label('chordQuality.resetAll')));
  };
  const doAdd = () => {
    const input = root.querySelector('[data-act=add-id]');
    const id = input.value.trim();
    if (!id) { show('error', label('chordQuality.errEmptyId')); return; }
    // nouvelle qualité : la fondamentale seule ; les notes se choisissent ensuite sur le clavier
    run(() => { app.addChordQuality({ id, intervals: [0] }); selected = id; });
  };

  // ---------- détail ----------
  const keyboard = (q) => {
    const rootNote = PREVIEW_ROOTS[previewRoot];
    const on = new Set(q.intervals);
    const alts = new Set(q.enharmonic ?? []);
    const key = (n) => {
      const alt = alts.has(n);
      const note = chordIntervalNote(rootNote, n, { alt });
      const tag = chordIntervalLabel(n, { alt });
      const base = { type: 'button', class: 'cq-key', 'data-semitones': String(n), 'aria-pressed': on.has(n) ? 'true' : 'false', 'aria-label': label('chordQuality.keyLabel', { label: tag, note: note.text, n }) };
      if (n === 0) return el('button', { ...base, disabled: true, title: label('chordQuality.rootKey') }, el('b', {}, note.text), el('span', {}, tag));
      return el('button', {
        ...base,
        onclick: () => run(() => { const next = on.has(n) ? q.intervals.filter((x) => x !== n) : [...q.intervals, n]; app.setChordQualityIntervals(q.id, next); }),
      }, el('b', {}, note.text), el('span', {}, tag));
    };
    const rows = [];
    for (let start = 0; start < KEYBOARD_SEMITONES; start += 12) rows.push(el('div', { class: 'cq-kbd' }, Array.from({ length: 12 }, (_, i) => key(start + i))));
    const beyond = q.intervals.filter((n) => n >= KEYBOARD_SEMITONES);
    return el('section', { 'data-section': 'keyboard' }, el('h3', {}, label('chordQuality.keyboard')), rows,
      beyond.length ? el('div', { class: 'cq-row', 'data-section': 'beyond' }, label('chordQuality.others'), beyond.map((n) => el('span', { class: 'cq-chip' }, String(n),
        el('button', { type: 'button', 'aria-label': label('chordQuality.otherRemove', { n }), onclick: () => run(() => app.setChordQualityIntervals(q.id, q.intervals.filter((x) => x !== n))) }, '×')))) : null);
  };

  const identifier = (q) => {
    const input = el('input', { type: 'text', 'data-act': 'rename-id', value: q.id, maxlength: '16', 'aria-label': label('chordQuality.id') });
    const use = app.chordQualityUse(q.id);
    return el('section', { 'data-section': 'identifier' }, el('h3', {}, label('chordQuality.id')),
      el('div', { class: 'cq-row' }, input,
        el('button', { type: 'button', 'data-act': 'rename', onclick: () => run(() => { const n = app.renameChordQuality(q.id, input.value.trim()); selected = input.value.trim(); return n; }, (n) => (n ? label('chordQuality.migrated', { count: n }) : '')) }, label('chordQuality.rename'))),
      use ? el('div', { class: 'caption' }, label('chordQuality.renameInfo', { count: use })) : null,
      q.id === '' ? el('div', { class: 'caption' }, label('chordQuality.noneHint')) : null);
  };

  const aliases = (q) => {
    const input = el('input', { type: 'text', 'data-act': 'alias-new', maxlength: '16', placeholder: label('chordQuality.aliasNew'), 'aria-label': label('chordQuality.aliasNew') });
    const set = (list) => run(() => app.setChordQualityAliases(q.id, list));
    return el('section', { 'data-section': 'aliases' }, el('h3', {}, label('chordQuality.aliases')),
      el('div', { class: 'cq-row' },
        (q.aliases ?? []).map((a) => el('span', { class: 'cq-chip', 'data-alias': a }, a, el('button', { type: 'button', 'aria-label': label('chordQuality.aliasRemove', { name: a }), onclick: () => set(q.aliases.filter((x) => x !== a)) }, '×'))),
        input,
        el('button', { type: 'button', 'data-act': 'alias-add', onclick: () => { const v = input.value.trim(); if (v) set([...(q.aliases ?? []), v]); } }, label('chordQuality.aliasAdd'))));
  };

  /** Écriture affichée : variantes proposées (choix), composition par boutons, jamais de saisie libre. */
  const display = (q) => {
    const variants = q.variants ?? [];
    const setVariants = (list) => run(() => app.setChordQualityVariants(q.id, list));
    const chip = (v) => el('span', { class: 'cq-chip', 'data-variant': v },
      el('button', { type: 'button', class: 'cq-variant', 'aria-pressed': q.shown === v ? 'true' : 'false', 'data-act': 'variant-pick', onclick: () => run(() => app.setChordQualityShown(q.id, v)) }, v),
      el('button', { type: 'button', 'aria-label': label('chordQuality.variantRemove', { name: v }), onclick: () => setVariants(variants.filter((x) => x !== v)) }, '×'));
    const add = () => { if (isDisplayVariant(draft) && !variants.includes(draft)) { const d = draft; draft = ''; setVariants([...variants, d]); } };
    const buttons = VARIANT_BUTTONS.map((b) => el('button', { type: 'button', 'data-btn': b, disabled: draft.length + b.length > VARIANT_MAX, onclick: () => { draft += b; draw(); } }, b));
    return el('section', { 'data-section': 'display' }, el('h3', {}, label('chordQuality.display')),
      el('div', { class: 'caption' }, label(q.id === '' ? 'chordQuality.displayMajor' : 'chordQuality.displayHint')),
      el('div', { class: 'cq-row' },
        el('button', { type: 'button', class: 'cq-variant', 'data-act': 'variant-auto', 'aria-pressed': q.shown === undefined ? 'true' : 'false', onclick: () => run(() => app.setChordQualityShown(q.id, null)) }, label('chordQuality.displayAuto')),
        variants.map(chip)),
      el('div', { class: 'cq-row', style: 'margin-top:8px' },
        el('span', { class: 'cq-draft', 'data-draft': draft }, draft || label('chordQuality.variantCompose')),
        el('button', { type: 'button', 'data-act': 'variant-back', disabled: !draft, onclick: () => { draft = Array.from(draft).slice(0, -1).join(''); draw(); } }, '⌫'),
        el('button', { type: 'button', class: 'primary', 'data-act': 'variant-add', disabled: !isDisplayVariant(draft) || variants.includes(draft) || variants.length >= MAX_VARIANTS, onclick: add }, '＋ ', label('chordQuality.variantAdd'))),
      el('div', { class: 'cq-compose' }, buttons));
  };

  /** Espacement entre les pièces de l'écriture affichée (ex. « 7 ♭ 9 ») : un réglage − / + par intervalle, en em, enregistré avec la qualité. */
  const spacing = (q) => {
    const pieces = qualityPieceLabels(q);
    if (pieces.length < 2) return null;
    const gaps = pieces.slice(1).map((_, i) => q.gaps?.[i] ?? 0);
    const set = (i, v) => { const next = [...gaps]; next[i] = Math.min(GAP_MAX, Math.max(GAP_MIN, Math.round(v * 100) / 100)); run(() => app.setChordQualityGaps(q.id, next)); };
    const cells = [];
    pieces.forEach((p, i) => {
      cells.push(el('span', { class: 'cq-piece' }, p));
      if (i < gaps.length) {
        cells.push(el('span', { class: 'cq-gap', 'data-gap': String(i) },
          el('button', { type: 'button', 'data-act': 'gap-less', 'aria-label': label('chordQuality.gapLess'), disabled: gaps[i] <= GAP_MIN, onclick: () => set(i, gaps[i] - 0.05) }, '−'),
          el('span', { class: 'cq-gapvalue' }, gaps[i].toFixed(2)),
          el('button', { type: 'button', 'data-act': 'gap-more', 'aria-label': label('chordQuality.gapMore'), disabled: gaps[i] >= GAP_MAX, onclick: () => set(i, gaps[i] + 0.05) }, '+')));
      }
    });
    return el('section', { 'data-section': 'spacing' }, el('h3', {}, label('chordQuality.spacing')),
      el('div', { class: 'caption' }, label('chordQuality.spacingHint')),
      el('div', { class: 'cq-row' }, cells,
        el('button', { type: 'button', 'data-act': 'gap-reset', disabled: !q.gaps?.length, onclick: () => run(() => app.setChordQualityGaps(q.id, [])) }, label('chordQuality.gapReset'))));
  };

  /** Énharmonie : les intervalles de la qualité qui ont une autre écriture (♭5 ↔ ♯4, ♯5 ↔ ♭6, 6 ↔ ♭♭7…). */
  const enharmonic = (q) => {
    const choices = q.intervals.filter((n) => n > 0 && chordIntervalHasAlternative(n));
    if (!choices.length) return null;
    const on = new Set(q.enharmonic ?? []);
    return el('section', { 'data-section': 'enharmonic' }, el('h3', {}, label('chordQuality.enharmonic')),
      el('div', { class: 'caption' }, label('chordQuality.enharmonicHint')),
      el('div', { class: 'cq-row' }, choices.map((n) => {
        const base = n < KEYBOARD_SEMITONES ? n : (n % 12) + 12;
        const usual = chordIntervalLabel(base), other = chordIntervalLabel(base, { alt: true });
        return el('button', { type: 'button', class: 'cq-variant', 'data-act': 'enharmonic', 'data-semitones': String(n), 'aria-pressed': on.has(n) ? 'true' : 'false',
          onclick: () => run(() => app.setChordQualityEnharmonic(q.id, on.has(n) ? [...on].filter((x) => x !== n) : [...on, n])) }, on.has(n) ? `${other}  (${usual})` : `${usual}  (${other})`);
      })));
  };

  const previews = (q) => {
    const rootNote = PREVIEW_ROOTS[previewRoot];
    const select = el('select', { 'data-act': 'preview-root', 'aria-label': label('chordQuality.previewRoot'), onchange: () => { previewRoot = Number(select.value); draw(); } },
      PREVIEW_ROOTS.map((r, i) => el('option', { value: String(i), selected: i === previewRoot }, chordIntervalNote(r, 0).text)));
    const spelling = el('select', { 'data-act': 'preview-spelling', 'aria-label': label('chordQuality.spelling'), onchange: () => { previewSpelling = spelling.value; draw(); } },
      el('option', { value: 'enharmonic', selected: previewSpelling === 'enharmonic' }, label('chordQuality.spellingEnharmonic')),
      el('option', { value: 'key', selected: previewSpelling === 'key' }, label('chordQuality.spellingKey')));
    const keySelect = previewSpelling === 'key'
      ? el('select', { 'data-act': 'preview-key', 'aria-label': label('chordQuality.previewKey'), onchange: () => { previewFifths = Number(keySelect.value); draw(); } },
        Array.from({ length: 15 }, (_, i) => i - 7).map((f) => el('option', { value: String(f), selected: f === previewFifths }, f === 0 ? '0' : f > 0 ? `${f}♯` : `${-f}♭`)))
      : null;
    const holder = el('div', { class: 'cq-preview', 'data-section': 'symbol' });
    holder.innerHTML = chordSymbolPreviewSvg(glyphs, { root: rootNote, quality: q.id, staffSpace, chordQualities: app.chordQualities() });
    const names = chordQualityNoteNames(rootNote, q.intervals, { enharmonic: q.enharmonic ?? [], spelling: previewSpelling, fifths: previewFifths });
    return el('section', { 'data-section': 'preview' }, el('h3', {}, label('chordQuality.preview')),
      el('div', { class: 'cq-row' }, label('chordQuality.previewRoot'), select, spelling, keySelect),
      el('div', { class: 'cq-notes', 'data-section': 'note-names' }, label('chordQuality.notes'), ' : ', names.join('  ')),
      holder);
  };

  const actions = (q) => {
    const dict = app.chordQualities();
    const use = app.chordQualityUse(q.id);
    const others = dict.qualities.filter((x) => x.id !== q.id);
    const canReset = !!defaultChordQuality(q.id) && isModifiedDefaultChordQuality(dict, q.id);
    if (removing) {
      const select = el('select', { 'data-act': 'replace-select', 'aria-label': label('chordQuality.replaceWith') }, others.map((x) => el('option', { value: x.id }, nameOf(x.id))));
      return el('section', { 'data-section': 'removing' },
        use ? el('div', {}, label('chordQuality.removeAsk', { count: use })) : null,
        el('div', { class: 'cq-row' },
          use ? select : null,
          el('button', { type: 'button', class: 'primary', 'data-act': 'remove-confirm', disabled: use > 0 && !others.length, onclick: () => run(() => { const n = app.removeChordQuality(q.id, use ? { replaceWith: select.value } : undefined); fixSelection(); return n; }, (n) => (n ? label('chordQuality.migrated', { count: n }) : '')) }, label('chordQuality.removeDo')),
          el('button', { type: 'button', 'data-act': 'remove-cancel', onclick: () => { removing = false; draw(); } }, label('chordQuality.cancel'))));
    }
    return el('div', { class: 'cq-row', 'data-section': 'actions' },
      canReset ? el('button', { type: 'button', 'data-act': 'reset-quality', onclick: () => run(() => app.resetChordQuality(q.id)) }, label('chordQuality.resetQuality')) : null,
      el('button', { type: 'button', 'data-act': 'remove', disabled: dict.qualities.length <= 1, onclick: () => {
        if (use) { removing = true; draw(); } else run(() => { app.removeChordQuality(q.id); fixSelection(); });
      } }, label('chordQuality.remove')));
  };

  /** Après annuler / suppression : la qualité choisie peut avoir disparu. */
  function fixSelection() {
    const ids = app.chordQualities().qualities.map((x) => x.id);
    if (!ids.includes(selected)) selected = ids[0] ?? null;
  }

  function draw() {
    const q = quality();
    root.replaceChildren(
      el('h2', { style: 'font-size:1.05rem;margin:0 0 8px' }, label('chordQuality.title')),
      bar(), fileInput,
      el('div', { class: message.kind === 'error' ? 'cq-alert' : 'cq-status', role: message.kind === 'error' ? 'alert' : 'status', 'data-message': message.kind }, message.text),
      el('div', { class: 'cq-main' }, list(),
        q ? el('div', { class: 'cq-detail', 'data-detail': q.id }, identifier(q), keyboard(q), enharmonic(q), display(q), spacing(q), aliases(q), previews(q), actions(q)) : null));
  }

  const off = app.doc.subscribe(() => { fixSelection(); draw(); });
  draw();
  return {
    refresh: () => { fixSelection(); draw(); },
    select(id) { selected = id; removing = false; draw(); },
    destroy() { off(); host.replaceChildren(); },
  };
}
