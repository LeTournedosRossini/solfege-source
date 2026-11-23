/*
 * Altérations accidentelles d'une mesure, dérivées de l'armure et des notes précédentes (jamais stockées : « rien n'est
 * figé dans les données quand c'est dérivable »). Règle de MuseScore (`AccidentalState`) : l'état est tenu PAR LIGNE
 * (nom de note + octave), toutes voix confondues dans l'ordre du temps, et remis à l'armure à chaque barre de mesure.
 * Une altération est affichée quand celle de la note diffère de l'état courant de sa ligne (bécarre si l'état était altéré).
 * Pas encore : notes liées (une note liée qui traverse la barre n'est pas réaffichée), altérations de précaution.
 */
import { fCmp } from '../model/index.js';
import { SHARP_ORDER, FLAT_ORDER } from './constants.js';
import { spellingOf } from './pitchpos.js';

const ALTER_TO_GLYPH = { '-2': 'accidentalDoubleFlat', '-1': 'accidentalFlat', 0: 'accidentalNatural', 1: 'accidentalSharp', 2: 'accidentalDoubleSharp' };

/** Altération de chaque nom de note dans l'armure `keySig` (entier : dièses > 0, bémols < 0). */
export function keySigAlters(keySig) {
  const alters = {};
  const order = keySig < 0 ? FLAT_ORDER : SHARP_ORDER;
  for (const step of order.slice(0, Math.abs(keySig))) alters[step] = keySig < 0 ? -1 : 1;
  return alters;
}

/**
 * @param entries  éléments de la mesure d'UNE portée (avec `position`, `voice`, `item`)
 * @returns Map identifiant de note → nom du glyphe d'altération (les notes sans altération à afficher sont absentes)
 */
export function resolveAccidentals(entries, keySig) {
  const shown = new Map();
  const state = new Map(); // « E4 » → altération courante
  const base = keySigAlters(keySig);
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => fCmp(a.entry.position, b.entry.position) || a.entry.voice - b.entry.voice || a.index - b.index);
  for (const { entry } of ordered) {
    const { item } = entry;
    if (item.type !== 'chord') continue;
    // ordre MuseScore : ornements « avant », accord principal, ornements « après » (`entry.graces`, voir gracenotes.js)
    const chords = [...(entry.graces?.before ?? []), item, ...(entry.graces?.after ?? [])];
    for (const chord of chords) {
      for (const note of chord.notes) {
        const sp = spellingOf(note.pitch, note.spelling, keySig);
        const line = `${sp.step}${sp.octave}`;
        const current = state.has(line) ? state.get(line) : (base[sp.step] ?? 0);
        if (sp.alter !== current) {
          shown.set(note.id, ALTER_TO_GLYPH[sp.alter]);
          state.set(line, sp.alter);
        }
      }
    }
  }
  return shown;
}

/**
 * Altérations posées À LA MAIN (`PID.ACCIDENTAL_DISPLAY`) : percussion, où rien n'est dérivé de la hauteur. Id de note → glyphe.
 * @param entries  éléments d'une mesure ({ item })
 */
export function userAccidentals(entries, getProperty, PID) {
  const map = new Map();
  for (const e of entries) {
    if (e.item.type !== 'chord') continue;
    for (const note of e.item.notes) {
      const v = getProperty(note, PID.ACCIDENTAL_DISPLAY);
      if (v && v !== 'none') map.set(note.id, `accidental${v[0].toUpperCase()}${v.slice(1)}`);
    }
  }
  return map;
}
