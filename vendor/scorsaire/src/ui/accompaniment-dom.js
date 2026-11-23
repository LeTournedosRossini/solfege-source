/*
 * The "Accompagnement" block of a track, in the tracks panel: the automatic PLAYER of the track (model/player.js) — a chord pattern and a card that play the chords of the
 * movement's chord track on the instrument of THIS track (its sound, its mixer strip). The chord track is the table of truth; each instrument track has its own player.
 * `track` is an entry of `app.tracksOutline()` (plain values: `track.player`); `run(fn)` performs an Application call and redraws the panel.
 */
import { groupedOptions } from './menu-groups.js';
import { createChoiceMenu } from './choice-menu.js';
import { createSwitch } from './switch.js';
import { cardTitle } from './strumcards-dom.js';
import { PLAYER_INSTRUMENTS } from '../model/player.js';

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};

/** `onPatterns(trackId)` / `onGrooves(trackId)`, `onCards(cardId)` and `onBake(staffId)` open the pattern editor (chords) or the groove editor (drums), the card editor and the "what this staff plays" window (all optional). */
export function playerSection({ app, track, label, run, onPatterns = null, onGrooves = null, onCards = null, onBake = null }) {
  const p = track.player;
  const drums = p.kind === 'drums'; // a track with a percussion staff plays a GROOVE (model/grooves.js) with a drum card
  const patterns = drums ? app.grooves() : app.chordPatterns();
  const cards = app.strumCards().filter((c) => (drums ? c.kind === 'drums' : c.kind !== 'drums'));
  const nameOf = (x) => x.name ?? (x.source === 'builtin' ? label(drums ? `groove.${x.id}` : `chordPattern.${x.id}`) : x.id);
  const defaultCard = drums ? 'drums' : 'piano';
  const cardId = p.card ?? defaultCard;
  const fretted = !drums && (cards.find((c) => c.id === cardId)?.kind ?? 'piano') === 'strum';
  const set = (patch) => run(() => app.setTrackPlayer(track.id, patch));
  const set2 = (fn) => run(fn);
  const row = (...kids) => el('div', { class: 'tp-row tp-meta' }, ...kids);
  const text = (t, cls = 'tp-meta-label') => el('span', { class: cls }, t);

  const patternMenu = createChoiceMenu({
    options: groupedOptions(patterns, { text: nameOf, label, head: [['', label(drums ? 'groove.none' : 'chordPattern.none')]], browse: label(drums ? 'player.groove' : 'chordPattern.label') }), value: p.pattern ?? '', label: label(drums ? 'player.groove' : 'chordPattern.label'), act: 'player-pattern', follow: true,
    onPick: (id) => set({ pattern: id || null }),
  });
  const kids = [
    el('div', { class: 'tp-player-title', title: label('player.hint') }, label('player.title')),
    row(text(label(drums ? 'player.groove' : 'chordPattern.label')), patternMenu),
  ];
  if (!p.pattern) kids.push(el('div', { class: 'tp-hint', style: 'font-size:12px;opacity:.75;padding:2px 4px' }, label(drums ? 'player.hintDrums' : 'player.hint')));
  else {
    kids.push(row(text(label('player.card')), createChoiceMenu({
      options: groupedOptions(cards, { text: (c) => cardTitle(c, label), label, browse: label('player.card') }), value: cardId, label: label('player.card'), act: 'player-card', follow: true,
      onPick: (id) => set({ card: id === defaultCard ? null : id }),
    })));
    if (fretted) {
      kids.push(row(text(label('staffProps.strum.instrument')), ...['auto', ...PLAYER_INSTRUMENTS.filter((i) => i !== 'piano')].map((i) => el('button', {
        type: 'button', 'data-key': `player-instrument-${i}`, 'aria-pressed': String((p.instrument === 'piano' ? 'auto' : p.instrument) === i), onclick: () => set({ instrument: i }),
      }, i === 'auto' ? `${label('staffProps.strum.instrument.auto')} : ${label(`staffProps.strum.instrument.${p.auto}`)}` : label(`staffProps.strum.instrument.${i}`)))));
    }
    kids.push(row(
      createSwitch({ checked: p.active, text: label('player.active'), attrs: { 'data-player-active': track.id }, onchange: (e) => set({ active: e.target.checked }) }),
      // the chances (approach chords, breaks…) come from a seed saved in the player: the same seed plays the same variations; this draws a new one
      el('button', { type: 'button', 'data-key': 'player-reroll', title: label('player.rerollHint'), onclick: () => set({ seed: 1 + Math.floor(Math.random() * 2147483646) }) }, label('player.reroll'))));
    // where the variations may come, in THIS work (not in the card): on the selected measures, and by section
    const rules = p.rules ?? [];
    const onSelection = (mode) => run(() => app.setPlayerRulesOnSelection(track.id, mode)); // no selection: the panel says so (a refusal of the tracks panel)
    kids.push(row(text(label('player.rules'), 'tp-meta-label'), text(label('player.rulesOnSelection')),
      ...['never', 'always', 'normal'].map((m) => el('button', { type: 'button', 'data-key': `player-rule-${m}`, title: label('player.rulesHint'), onclick: () => onSelection(m) }, label(`player.rule.${m}`)))));
    for (const name of p.sections ?? []) {
      const r = rules.find((x) => x.kind === 'all' && x.where.section === name);
      const current = !r ? 'normal' : r.mode === 'never' ? 'never' : r.mode === 'factor' && r.factor === 0.5 ? 'half' : r.mode === 'factor' && r.factor === 2 ? 'double' : 'normal';
      kids.push(row(text(name), createChoiceMenu({
        options: ['normal', 'half', 'double', 'never'].map((c) => [c, label(`player.ruleSection.${c}`)]), value: current, label: name, act: 'player-section-rule', follow: true,
        onPick: (choice) => set2(() => app.setPlayerSectionRule(track.id, name, choice)),
      })));
    }
    if (rules.length) {
      kids.push(row(text(label('player.rulesSummary', { measures: rules.filter((x) => x.where.measureId).length, sections: rules.filter((x) => x.where.section).length })),
        el('button', { type: 'button', 'data-key': 'player-rules-clear', onclick: () => set({ rules: [] }) }, label('player.rulesClear'))));
    }
    if (p.silent) kids.push(el('div', { class: 'tp-hint', role: 'status', 'data-player-silent': '', style: 'font-size:12px;color:var(--warn-ink,#8a5a00);padding:2px 4px' }, label(p.written ? 'player.silentNotes' : 'player.silentOff')));
    kids.push(row(
      onGrooves && drums ? el('button', { type: 'button', 'data-key': 'player-grooves', onclick: () => onGrooves(track.id) }, label('grooveEditor.open')) : null,
      onPatterns && !drums ? el('button', { type: 'button', 'data-key': 'player-patterns', onclick: () => onPatterns(track.id) }, label('chordPatternEditor.open')) : null,
      onCards ? el('button', { type: 'button', 'data-key': 'player-cards', onclick: () => onCards(cardId) }, label('strum.cardsOpen')) : null,
      onBake && track.staves.length ? el('button', { type: 'button', 'data-key': 'player-bake', onclick: () => onBake(track.staves[0].id) }, label('strum.bake.open')) : null));
  }
  return el('div', { class: 'tp-player', 'data-player': track.id }, ...kids);
}
