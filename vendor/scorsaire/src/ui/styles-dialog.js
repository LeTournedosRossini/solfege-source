/*
 * The "Styles" window (model/styles.js): a style is a SET of automatic players by role (drums, bass, guitar, keys, strings, brass) with a swing. Pick one and apply it to the movement: the tracks of
 * each role get their player (the ones that are missing are made, hidden), and the swing is set. It is a copy: nothing stays linked to the style. The arrangement of the movement can be kept as a
 * style of your own, on this device or in the project.
 * The same window EDITS the styles that are not built in (they are saved at once, like the grooves): the name, the swing, and one line per player — role, instrument of the track to make, groove or
 * pattern, card — which can be added, removed and reordered. A built-in groove, pattern or card is DUPLICATED for the style before it is edited. A style can be heard on a progression, player by player.
 */
import { createChoiceMenu } from './choice-menu.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { cardTitle } from './strumcards-dom.js';
import { groupedOptions, folderNames, folderField } from './menu-groups.js';
import { franceIcon } from './france-icon.js';
import { STYLE_ROLES, STYLE_SWINGS, CUSTOM_SWING_RANGE, MAX_STYLE_PLAYERS, newStyle, setStylePlayer, addStylePlayer, removeStylePlayer, moveStylePlayer, instrumentsOfRole, skippedPlayers } from '../model/styles.js';
import { styleReferences } from '../model/styleedit.js';
import { instrumentDisplayName } from '../model/instruments.js';

/** The cards a role can use: the drums a drum card, the keys, strings and brass a piano card, the guitar and the bass a strumming card. */
const cardFits = (role, card) => (role === 'drums' ? card.kind === 'drums' : ['keys', 'strings', 'brass'].includes(role) ? card.kind === 'piano' : card.kind !== 'drums' && card.kind !== 'piano');

export function openStylesDialog({ app, label, movement = 0, lang = 'en', onListen = null, onStop = null, onEditGroove = null, onEditPattern = null, onEditCard = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let selected = null; let message = ''; let draft = ''; let tab = 0; const lane = new Map(); // index of a player → 'mute' | 'solo' (none = heard), for the trial listening
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-styles-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(780px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px;border-radius:8px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('styles.title') });
  if (!sheet) box.setAttribute('data-resizable', 'styles');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); onStop?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { primary = false, disabled = false, title = '' } = {}) => {
    const b = el('button', `min-height:30px;padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; if (title) b.title = title; b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
  const run = (fn) => { try { fn(); } catch (e) { message = e.message; } draw(); };

  const menu = (options, value, text, act, onPick, buttonText = null) => createChoiceMenu({ options, value, label: text, act, onPick, buttonText });
  const lab = (text) => { const s = el('span', 'font-size:12px;margin:0 6px'); s.textContent = text; return s; };
  const small = (text, act, fn, { disabled = false, title = '', on = false } = {}) => {
    const b = mk(text, act, fn, { disabled, title }); b.style.minHeight = '30px'; b.style.padding = '0 8px'; if (title) b.setAttribute('aria-label', title);
    if (on) b.setAttribute('aria-pressed', 'true'); return b;
  };

  function draw() {
    const styles = app.styles();
    if (!styles.some((s) => s.id === selected)) selected = styles[0]?.id ?? null;
    const style = styles.find((s) => s.id === selected);
    const readOnly = !style || style.source === 'builtin';
    const nameOf = (s) => s.name ?? (s.source === 'builtin' ? label(`style.${s.id}`) : s.id);
    const grooves = app.grooves(); const patterns = app.chordPatterns(); const cards = app.strumCards();
    const patternTitle = (role, p) => (p.name ?? (p.source === 'builtin' ? label(role === 'drums' ? `groove.${p.id}` : `chordPattern.${p.id}`) : p.id));
    const patternName = (role, id) => { const p = (role === 'drums' ? grooves : patterns).find((x) => x.id === id); return p ? patternTitle(role, p) : id; };
    const cardName = (id) => { const c = cards.find((x) => x.id === id); return c ? cardTitle(c, label) : id; };
    const level = style?.source === 'project' ? 'project' : 'user'; // where the copies made for this style go
    const save = (next) => run(() => { message = ''; app.saveStyle(style.source, { ...next, id: style.id }); });

    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('styles.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('styles.hint');
    const head = row();
    head.append(menu(groupedOptions(styles, { text: nameOf, label, browse: label('styles.style') }), selected ?? '', label('styles.style'), 'style-pick', (id) => { selected = id; tab = 0; lane.clear(); message = ''; draw(); }));
    if (style && !readOnly) {
      const name = el('input', 'font-size:16px;min-height:30px;box-sizing:border-box;flex:1 1 9em;min-width:7em', { type: 'text', 'data-key': 'style-name', value: style.name ?? '', placeholder: label('styles.name') });
      name.addEventListener('change', () => save({ ...style, name: name.value.trim() || null }));
      head.append(name, folderField({ value: style.folder ?? null, folders: folderNames(styles.filter((s) => s.source === style.source)), label, onChange: (f) => save({ ...style, folder: f }) }));
    }
    head.append(mk(label('chordPatternEditor.new'), 'style-new', () => run(() => { selected = app.saveStyle('user', { ...newStyle(label('styles.newName')), id: '' }).id; lane.clear(); message = ''; })));

    // ---- the swing and the players
    const players = el('div', 'display:flex;flex-direction:column;gap:6px;border:1px solid var(--edge,#bbb);border-radius:6px;padding:6px');
    if (style) {
      const swingRow = row();
      const swingText = style.swing === 'custom' ? `${label('styles.swing.custom')} · ${style.swingRatio} %` : style.swing ? label(`styles.swing.${style.swing}`) : label('styles.swing.keep');
      if (readOnly) { const sw = el('div', 'font-size:13px'); sw.textContent = `${label('styles.swing')} : ${swingText}`; swingRow.append(sw); }
      else {
        swingRow.append(menu([['', label('styles.swing.keep')], ...STYLE_SWINGS.map((k) => [k, label(`styles.swing.${k}`)]), ['custom', label('styles.swing.custom')]], style.swing ?? '', `${label('styles.swing')} : ${swingText}`, 'style-swing',
          (v) => save({ ...style, swing: v || null, ...(v === 'custom' ? { swingRatio: style.swingRatio ?? CUSTOM_SWING_RANGE.dflt, swingUnit: style.swingUnit ?? 'eighth' } : {}) })));
        if (style.swing === 'custom') {
          // the percentage of the unit the first note takes: 50 = straight, 60 the usual swing, 66 = triplets, 75 = dotted
          const ratio = style.swingRatio ?? CUSTOM_SWING_RANGE.dflt;
          const pct = el('span', 'min-width:3.5em;text-align:center', { 'data-style-swing-ratio': '' }); pct.textContent = `${ratio} %`;
          swingRow.append(lab(label('styles.swing.ratio')), small('−', 'swing-ratio-less', () => save({ ...style, swingRatio: Math.max(CUSTOM_SWING_RANGE.min, ratio - 1) }), { disabled: ratio <= CUSTOM_SWING_RANGE.min, title: label('styles.swing.ratioHint') }), pct,
            small('+', 'swing-ratio-more', () => save({ ...style, swingRatio: Math.min(CUSTOM_SWING_RANGE.max, ratio + 1) }), { disabled: ratio >= CUSTOM_SWING_RANGE.max, title: label('styles.swing.ratioHint') }),
            ...['eighth', '16th'].map((u) => small(label(`styles.swing.unit.${u}`), `swing-unit-${u}`, () => save({ ...style, swingUnit: u }), { on: (style.swingUnit ?? 'eighth') === u })));
        }
      }
      players.append(swingRow);
      if (tab >= style.players.length) tab = style.players.length - 1;
      if (tab < 0) tab = 0;
      // one tab per player (Drums, Bass, Guitar…), the one being edited underlined; the last tab adds a player
      const seen = {}; const tabs = el('div', 'display:flex;flex-wrap:wrap;gap:2px;align-items:flex-end;border-bottom:1px solid var(--edge,#bbb)', { role: 'tablist' });
      style.players.forEach((p, i) => {
        seen[p.role] = (seen[p.role] ?? 0) + 1;
        const total = style.players.filter((x) => x.role === p.role).length;
        const b = el('button', `min-height:34px;padding:0 14px;border:0;border-bottom:3px solid ${i === tab ? 'var(--sel-edge,#2878ff)' : 'transparent'};margin-bottom:-1px;background:transparent;border-radius:0;font:${i === tab ? 'var(--w-bold,700)' : 'var(--w-semi,600)'} 14px var(--ui-font,sans-serif)${lane.get(i) === 'mute' ? ';opacity:.55' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(i === tab), 'data-style-tab': String(i) });
        b.textContent = `${label(`styles.role.${p.role}`)}${total > 1 ? ` ${seen[p.role]}` : ''}`;
        b.addEventListener('click', () => { tab = i; draw(); });
        tabs.append(b);
      });
      if (!readOnly) {
        const addMenu = menu(STYLE_ROLES.map((r) => [r, label(`styles.role.${r}`)]), '', label('styles.addPlayerHint'), 'style-add-player', (r) => { tab = style.players.length; save(addStylePlayer(style, r)); }, `+ ${label('styles.addPlayer')}`);
        if (style.players.length >= MAX_STYLE_PLAYERS) addMenu.disabled = true;
        tabs.append(addMenu);
      }
      players.append(tabs);
      const dupRoles = new Set(style.players.map((p) => p.role).filter((r, i, all) => all.indexOf(r) !== i));
      style.players.forEach((p, i) => {
        if (i !== tab) return;
        const line = el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center;padding-top:4px', { 'data-style-player': p.role });
        // one square button: at rest the player is heard; a press mutes it (red M), the next one solos it (yellow S), the next puts it back
        const state = lane.get(i) ?? null;
        const heard = el('button', `width:34px;height:34px;border-radius:6px;font:var(--w-bold,700) 14px var(--ui-font,sans-serif);border:1px solid var(--edge,#999);${state === 'mute' ? 'background:#d33;color:#fff;' : state === 'solo' ? 'background:#f2c200;color:#111;' : ''}`, { type: 'button', 'data-style-hear': String(i), 'data-state': state ?? 'on', title: label('styles.hearHint'), 'aria-label': label(`styles.hear.${state ?? 'on'}`) });
        heard.textContent = state === 'mute' ? 'M' : state === 'solo' ? 'S' : '♪';
        heard.addEventListener('click', () => { if (state === null) lane.set(i, 'mute'); else if (state === 'mute') lane.set(i, 'solo'); else lane.delete(i); draw(); });
        if (readOnly) {
          const t = el('div', 'font-size:13px;flex:1 1 auto'); t.textContent = `${label(`styles.role.${p.role}`)} · ${label(p.role === 'drums' ? 'player.groove' : 'chordPattern.label')} : ${patternName(p.role, p.pattern)}${p.card ? ` · ${label('player.card')} : ${cardName(p.card)}` : ''}`;
          line.append(t, heard); players.append(line); return;
        }
        // the instrument of the track a style makes: the instruments of the role, the default of the role first
        const instruments = instrumentsOfRole(p.role, lang);
        if (p.instrument && !instruments.some((x) => x.id === p.instrument)) instruments.push({ id: p.instrument, name: instrumentDisplayName(p.instrument, lang, 'trackName') ?? p.instrument });
        const instOptions = instruments.map((x, k) => [k === 0 ? '' : x.id, k === 0 ? label('styles.instrumentDefault', { name: x.name }) : x.name]);
        const instNow = p.instrument && p.instrument !== instruments[0]?.id ? p.instrument : '';
        const patternList = (p.role === 'drums' ? grooves : patterns);
        const cardList = cards.filter((c) => cardFits(p.role, c));
        const edit = (kind) => run(() => {
          // a built-in groove, pattern or card is copied for this style before it is changed; one shared with other styles is only warned about
          const list = kind === 'groove' ? grooves : kind === 'pattern' ? patterns : cards;
          const id = kind === 'card' ? p.card : p.pattern;
          const found = list.find((x) => x.id === id); if (!found) return;
          const title = kind === 'card' ? cardTitle(found, label) : patternTitle(p.role, found);
          let useId = id;
          if (found.source === 'builtin') {
            const copy = (kind === 'groove' ? app.copyGroove(id, level, { fresh: true, name: `${title} (${label('strum.copySuffix')})` }) : kind === 'pattern' ? app.copyChordPattern(id, level, { fresh: true, name: `${title} (${label('strum.copySuffix')})` })
              : app.copyStrumCard(id, level, { fresh: true, name: `${title} (${label('strum.copySuffix')})` }));
            useId = copy.id; message = label('styles.copyMade', { name: title });
            app.saveStyle(style.source, { ...setStylePlayer(style, i, kind === 'card' ? { card: copy.id } : { pattern: copy.id }), id: style.id });
          } else {
            const others = app.styles().filter((o) => o.id !== style.id && (kind === 'groove' ? styleReferences(o).grooves : kind === 'pattern' ? styleReferences(o).patterns : styleReferences(o).cards).includes(id)).length;
            if (others) message = label('styles.sharedWarn', { name: title, n: others });
          }
          // when the editor closes the style takes the new version of what it uses along (saving it again refreshes its library)
          const again = () => run(() => { const now = app.styles().find((x) => x.id === style.id); if (now) app.saveStyle(now.source, now); });
          (kind === 'groove' ? onEditGroove : kind === 'pattern' ? onEditPattern : onEditCard)?.(useId, again, { role: p.role, card: p.card });
        });
        line.append(
          menu(STYLE_ROLES.map((r) => [r, label(`styles.role.${r}`)]), p.role, label(`styles.role.${p.role}`), `style-role-${i}`, (v) => save(setStylePlayer(style, i, { role: v }))),
          menu(instOptions, instNow, label('styles.instrument'), `style-instrument-${i}`, (v) => save(setStylePlayer(style, i, { instrument: v || null }))),
          menu(groupedOptions(patternList, { text: (x) => patternTitle(p.role, x), label, browse: label(p.role === 'drums' ? 'player.groove' : 'chordPattern.label') }), p.pattern, `${label(p.role === 'drums' ? 'player.groove' : 'chordPattern.label')} : ${patternName(p.role, p.pattern)}`, `style-pattern-${i}`, (v) => save(setStylePlayer(style, i, { pattern: v }))),
          small('✎', `style-edit-pattern-${i}`, () => edit(p.role === 'drums' ? 'groove' : 'pattern'), { title: label('styles.editPattern'), disabled: !(p.role === 'drums' ? onEditGroove : onEditPattern) }),
          menu(groupedOptions(cardList, { text: (c) => cardTitle(c, label), label, head: [['', label('styles.noCard')]], browse: label('player.card') }), p.card ?? '', `${label('player.card')} : ${p.card ? cardName(p.card) : label('styles.noCard')}`, `style-card-${i}`, (v) => save(setStylePlayer(style, i, { card: v || null }))),
          (() => { const b = small('', `style-edit-card-${i}`, () => edit('card'), { title: label('styles.editCard'), disabled: !p.card || !onEditCard }); b.append(franceIcon(18)); return b; })(), // a map of France: the CARD (a card, a map), not the groove or the pattern
          ...(dupRoles.has(p.role) ? [small('▲', `style-up-${i}`, () => { tab = i - 1; save(moveStylePlayer(style, i, -1)); }, { title: label('styles.moveUp'), disabled: i === 0 }), small('▼', `style-down-${i}`, () => { tab = i + 1; save(moveStylePlayer(style, i, 1)); }, { title: label('styles.moveDown'), disabled: i === style.players.length - 1 })] : []),
          small('✕', `style-remove-${i}`, () => { lane.clear(); save(removeStylePlayer(style, i)); }, { title: style.players.length <= 1 ? label('styles.lastPlayer') : label('styles.removePlayer'), disabled: style.players.length <= 1 }), heard);
        players.append(line);
      });
      if (!readOnly) {
        const add = row();
        const carried = style.library ?? {};
        const emb = el('span', 'font-size:12px;color:var(--ink-soft,#555);margin-left:8px', { 'data-style-embeds': '' });
        emb.textContent = label('styles.embeds', { patterns: (carried.patterns ?? []).length, grooves: (carried.grooves ?? []).length, cards: (carried.cards ?? []).length });
        add.append(emb); players.append(add);
      }
    }

    const copyTo = style?.source === 'project' ? 'user' : 'project';
    const actions = row();
    actions.append(...[
      mk(label('styles.apply'), 'style-apply', () => run(() => { const r = app.applyStyle(selected, { movement }); const names = new Map(app.tracksOutline().flatMap((m) => m.tracks).map((t) => [t.id, t.name || t.id]));
      message = label('styles.applied', { list: r.players.map((p) => `${label(`styles.role.${p.role}`)} → ${names.get(p.trackId)}${p.created ? ` (${label('styles.created')})` : ''}`).join(' · ') }); }), { primary: true, disabled: !style, title: label('styles.applyHint') }),
      onListen && mk(`▶ ${label('styles.listen')}`, 'style-listen', () => onListen({ style, skip: skippedPlayers(style.players.length, lane) }), { disabled: !style, title: label('styles.listenHint') }),
      onListen && onStop && mk(`■ ${label('styles.stop')}`, 'style-stop', () => onStop(), { title: label('styles.stopHint') }),
      mk(label('strum.duplicate'), 'style-duplicate', () => run(() => { selected = app.copyStyle(selected, 'user', { fresh: true, name: `${nameOf(style)} (${label('strum.copySuffix')})` }).id; lane.clear(); message = ''; }), { disabled: !style }),
      !readOnly && mk(label(`strum.copyTo.${copyTo}`), 'style-copy', () => run(() => { selected = app.copyStyle(selected, copyTo).id; message = ''; })),
      !readOnly && mk(label('strum.delete'), 'style-delete', () => run(() => { app.removeStyle(style.source, style.id); selected = null; lane.clear(); message = ''; })),
      mk(label('strum.bake.close'), 'style-close', close)].filter(Boolean));

    // the arrangement of the movement kept as a style
    const keep = el('div', 'display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--edge,#bbb);padding-top:8px');
    const keepTitle = el('div', 'font-weight:var(--w-semi,600)'); keepTitle.textContent = label('styles.keep');
    const keepHint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); keepHint.textContent = label('styles.keepHint');
    const name = el('input', 'font-size:16px;min-height:30px;box-sizing:border-box;flex:1 1 9em;min-width:7em', { type: 'text', 'data-key': 'style-keep-name', value: draft, placeholder: label('styles.name') });
    name.addEventListener('input', () => { draft = name.value; });
    const keepRow = row();
    const keepIn = (lvl) => run(() => { const s = app.saveArrangementAsStyle(lvl, draft.trim() || label('styles.defaultName'), { movement }); selected = s.id; draft = ''; message = label('styles.kept'); });
    keepRow.append(name, mk(label('styles.saveDevice'), 'style-keep-user', () => keepIn('user')), mk(label('styles.saveProject'), 'style-keep-project', () => keepIn('project')));
    keep.append(keepTitle, keepHint, keepRow);

    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-styles-message': '' }); status.textContent = message || (readOnly && style ? label('styles.builtinHint') : '');
    box.replaceChildren(title, hint, head, players, actions, status, keep);
  }

  document.body.append(veil);
  draw();
  return { close };
}
