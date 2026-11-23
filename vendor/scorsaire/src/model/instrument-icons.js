/*
 * Which interface icon (`ui/icons.js`: Lucide + the instrument icons drawn for Scorsaire) goes with a catalogue instrument. PURE: names only.
 * Rules, most specific first: the instrument id (alto / tenor / baritone saxophone, viola, cello…), then its MuseScore family, then its group.
 * The brass without an icon of their own (tubas, euphoniums…) take the trumpet; the woodwinds without one take the clarinet.
 */
import { RETAINED, INSTRUMENT_ICON_OVERRIDES } from './icon-library.js';

const has = (id, ...parts) => parts.some((p) => id.includes(p));

const byId = (id, family) => {
  if (family === 'saxophones') {
    if (id === 'soprano-saxophone') return 'soprano-photo'; // the photograph (device setting) or the clarinet icon
    if (has(id, 'alto')) return 'sax-alto';
    if (has(id, 'tenor')) return 'sax-tenor';
    if (has(id, 'baritone', 'bass')) return 'sax-baritone';
    return 'saxophone';
  }
  if (family === 'orchestral-strings') {
    if (has(id, 'viola')) return 'viola';
    if (has(id, 'cello', 'violoncello')) return 'cello';
    if (has(id, 'contrabass', 'double-bass')) return 'double-bass';
    return 'violin';
  }
  if (family === 'guitars') return has(id, 'electric') ? 'electric-guitar' : 'guitar-head';
  if (family === 'bass-guitars') return id === 'acoustic-bass' ? 'bass-head' : 'electric-bass'; // the electric basses carry the small amplifier like the electric guitar
  return null;
};

const BY_FAMILY = Object.freeze({
  // strings
  viols: 'cello', octobasses: 'double-bass', erhus: 'violin', nyckelharpas: 'violin',
  // plucked strings
  guitars: 'guitar-head', 'bass-guitars': 'bass-head', banjos: 'banjo', harps: 'harp',
  // woodwinds
  flutes: 'flute', 'pan-flutes': 'flute', fifes: 'flute', dizis: 'flute', shakuhachis: 'flute', recorders: 'recorder', whistles: 'recorder', flageolets: 'recorder',
  clarinets: 'clarinet', oboes: 'clarinet', bassoons: 'clarinet', saxophones: 'saxophone',
  // brass
  trumpets: 'trumpet', 'baroque-trumpets': 'trumpet', cornets: 'trumpet', flugelhorns: 'trumpet', trombones: 'trombone', sackbuts: 'trombone', horns: 'horn',
  // keys
  keyboards: 'keyboard-music', organs: 'keyboard-music', synths: 'keyboard-music', accordions: 'accordion', melodicas: 'keyboard-music',
  // voices and percussion
  voices: 'mic-vocal', 'voice-groups': 'mic-vocal', drums: 'drum', timpani: 'drum', 'unpitched-metal-percussion': 'bell', 'unpitched-wooden-percussion': 'drumstick',
  'keyboard-percussion': 'keyboard-music', 'pitched-metal-percussion': 'bell',
});

const BY_GROUP = Object.freeze({
  strings: 'violin', 'plucked-strings': 'guitar-head', woodwinds: 'clarinet', brass: 'trumpet', keyboards: 'keyboard-music', 'free-reed': 'accordion',
  vocals: 'mic-vocal', 'unpitched-percussion': 'drum', 'pitched-percussion': 'bell', 'marching-percussion': 'drum', 'body-percussion': 'drum', 'electronic-instruments': 'keyboard-music',
});

/** Icon name for a catalogue instrument (`id`, `{ family, group }`); null when nothing fits. */
export function instrumentIconName(id, info) {
  if (!info) return null;
  // the icon Jean chose for this instrument in the icon library (286 instruments); the soprano saxophone keeps its photograph / clarinet rule
  if (id !== 'soprano-saxophone' && Object.hasOwn(INSTRUMENT_ICON_OVERRIDES, id)) return INSTRUMENT_ICON_OVERRIDES[id];
  const sure = byId(id ?? '', info.family);
  if (sure) return sure;
  if (id === 'piano' || has(id ?? '', 'piano')) return 'piano';
  return BY_FAMILY[info.family] ?? BY_GROUP[info.group] ?? null;
}

/** Every icon name the rules can return (used by a test). */
export const INSTRUMENT_ICON_NAMES = Object.freeze([...new Set(['soprano-photo', 'sax-alto', 'sax-tenor', 'sax-baritone', 'saxophone', 'viola', 'cello', 'double-bass', 'violin', 'electric-guitar', 'electric-bass', 'guitar-head', 'piano', ...Object.values(BY_FAMILY), ...Object.values(BY_GROUP), ...Object.values(RETAINED)])]);
