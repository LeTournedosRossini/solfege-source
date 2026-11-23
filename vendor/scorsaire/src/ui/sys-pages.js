/*
 * The « Sys » drawer (system objects) as a small tree of pages (decided with Jean, 19/10/2026; the repeats and voltas moved to the measure bar).
 * Level 1 = ten buttons (nine + the Leslie page after the techniques; see SYS_MENU): tempo group, jumps and markers, form (parts, letters, rehearsal marks), staff text, playing techniques, accompaniment cues. The container page is reached from its own button (`path` ['container']), The cue page (`path` ['cue']) is the sixth button of level 1; its keys come from `cueKeys` (dom.js reads `app.cueInfo()`).
 * The tempo group opens a second menu (tempo words, metronome, gradual changes, swing, fermatas). Every page lists the buttons Jean chose first.
 * Pure data (no DOM): a key is `group:name`; the DOM side (dom.js) turns it into a button.
 */
import { TEMPO_WORD_CHOICES, GRADUAL_CHOICES, FERMATA_CHOICES, SWING_CHOICES } from '../model/systemedit.js';
import { JUMP_TYPES, MARKER_TYPES } from '../model/repeats.js';
import { TECHNIQUES } from '../model/techniques.js';
import { LESLIE_SIGNS } from './leslie-intents.js';
import { SECTION_CATEGORIES, SECTION_LETTERS, SECTION_PALETTE } from '../model/sections.js';

export const SYS_MENU = Object.freeze(['tempo', 'jump', 'form', 'text', 'tech', 'leslie', 'cue', 'chordview', 'timesig', 'keysig']);
export const TEMPO_MENU = Object.freeze(['words', 'metro', 'gradual', 'swing', 'fermata']);

const first = (chosen, all) => [...chosen, ...all.filter((k) => !chosen.includes(k))];

const PAGES = {
  words: first(['Largo', 'Andante', 'Moderato', 'Allegro', 'Vivace', 'Presto'], TEMPO_WORD_CHOICES).map((w) => `word:${w}`),
  metro: ['metro:set', 'metro:atempo', 'metro:primo', 'metro:m10', 'metro:m1', 'metro:val', 'metro:p1', 'metro:p10'],
  gradual: first(['accelerando', 'allargando', 'rallentando', 'ritardando'], GRADUAL_CHOICES).map((g) => `grad:${g}`),
  swing: SWING_CHOICES.map((k) => `swing:${k}`),
  fermata: first(['fermata', 'fermataLong', 'fermataLongHenze', 'fermataVeryLong', 'fermataShort', 'fermataVeryShort'], FERMATA_CHOICES).map((f) => `ferm:${f}`),
  jump: first(['marker:segno', 'marker:coda', 'marker:toCoda', 'marker:fine', 'jump:dc', 'jump:dsAlCoda'], [...MARKER_TYPES.map((m) => `marker:${m.type}`), ...JUMP_TYPES.map((j) => `jump:${j.type}`)]),
  tech: first(['pizz', 'arco', 'conSord', 'senzaSord', 'colLegno', 'sulPont'], TECHNIQUES.map((t) => t.id).filter((id) => !LESLIE_SIGNS.includes(id))).map((t) => `tech:${t}`),
  leslie: LESLIE_SIGNS.map((t) => `leslie:${t}`), // rotor speed signs of an organ (audio/leslie.js)
  chordview: ['cview:original', 'cview:capo', 'cview:m1', 'cview:val', 'cview:p1', 'cview:set', 'cview:clear'],
  container: ['cwhere:above', 'cwhere:before', 'cwhere:after', 'cnew:text', 'cnew:gap', 'cnew:score', 'cnew:diagram', 'cevery:toggle', 'cpaste:paste'],
};

/**
 * Keys of the cue page (the drum cues of model/cueedit.js), from `app.cueInfo()`: the versions of the groove of the first drum track, its breaks and "no break", then the way to clear the cues
 * of the measure. Without a drum player the page only says so (`cue:nodrums`).
 */
export function cueKeys(info) {
  const t = info?.tracks?.[0];
  const players = info?.players ?? [];
  if (!t && !players.length) return ['cue:nodrums'];
  return [
    ...(t ? [...t.versions.map((v) => `cue:groove:${v.value}`), ...t.fills.map((f) => `cue:break:${f.value}`), 'cue:break:none'] : []),
    ...players.flatMap((p) => [...p.alts.map((a) => `cue:alt:${p.id}:${a.value}`), `cue:alt:${p.id}:none`]),
    'cue:clear',
  ];
}

/** Keys of the form page: parts, letters, rehearsal mark, custom name; the colours only while the measure holds a part. */
export const formKeys = (hasSection) => [
  ...SECTION_CATEGORIES.filter((c) => c !== 'letter' && c !== 'custom').map((c) => `sect:${c}`),
  ...SECTION_LETTERS.map((l) => `letter:${l}`),
  'reh:toggle', 'form:custom',
  ...(hasSection ? ['col:auto', ...SECTION_PALETTE.map((c) => `col:${c}`)] : []),
];

/**
 * What a path shows: { kind: 'menu', keys } (buttons that open another level), or { kind: 'page', keys } (buttons that act), or null for an unknown path.
 * `path` = [] (the menu of seven), ['tempo'] (the tempo menu), ['tempo', 'words'] or ['jump'] etc. (a page).
 */
export function sysLevel(path, { hasSection = false } = {}) {
  if (!path.length) return { kind: 'menu', keys: SYS_MENU.map((k) => `menu:${k}`) };
  if (path.length === 1 && path[0] === 'tempo') return { kind: 'menu', keys: TEMPO_MENU.map((k) => `menu:tempo/${k}`) };
  const id = path.at(-1);
  if (id === 'form') return { kind: 'page', keys: formKeys(hasSection) };
  if (id === 'text' || id === 'timesig' || id === 'keysig') return null; // open the in-place editor / the time signature or key signature window instead of a page
  if (PAGES[id]) return { kind: 'page', keys: PAGES[id] };
  return null;
}
