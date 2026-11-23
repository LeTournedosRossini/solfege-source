/*
 * The user's PERSONAL REPERTOIRE of chord fingerings (a device preference, exported with the others: section `diagramLibrary` of the preferences file).
 * It is a list of fingerings per chord and instrument — { chords: { <chord key>: [voicing…] } }, the key being the one of the work's preferred fingerings
 * (`chordKey`: instrument, tuning, root, pitch classes, bass), so it does not depend on how the chord is spelled or named.
 * The repertoire only OFFERS fingerings: the editor shows them first among the suggestions; choosing one writes it into the diagram. A document never reads
 * it when it is drawn, so a file looks the same on every device.
 */
import { validateVoicing, sameVoicing, createVoicing } from './fretvoicing.js';

export const LIBRARY_MAX_PER_CHORD = 12;

export function validateDiagramLibrary(lib) {
  if (!lib || typeof lib !== 'object' || typeof lib.chords !== 'object' || lib.chords === null || Array.isArray(lib.chords)) return ['diagramLibrary: { chords: { key: [voicing…] } } expected'];
  const errors = [];
  for (const [key, list] of Object.entries(lib.chords)) {
    if (!Array.isArray(list) || list.length > LIBRARY_MAX_PER_CHORD) { errors.push(`diagramLibrary ${key}: at most ${LIBRARY_MAX_PER_CHORD} fingerings`); continue; }
    for (const v of list) errors.push(...validateVoicing(v).map((p) => `diagramLibrary ${key}: ${p}`));
  }
  return errors;
}

export const createDiagramLibrary = (lib = { chords: {} }) => ({ chords: Object.fromEntries(Object.entries(lib.chords ?? {}).map(([k, list]) => [k, list.map((v) => createVoicing(v))])) });

/** The fingerings kept for a chord key (a list, possibly empty). */
export const libraryFor = (lib, key) => lib?.chords?.[key] ?? [];

/** A new library with `voicing` kept for `key` (nothing changes when it is already there; the oldest goes when the list is full). */
export function addToLibrary(lib, key, voicing) {
  const v = createVoicing(voicing);
  const list = libraryFor(lib, key);
  if (list.some((x) => sameVoicing(x, v))) return createDiagramLibrary(lib ?? undefined);
  const next = [v, ...list].slice(0, LIBRARY_MAX_PER_CHORD);
  return { chords: { ...(lib?.chords ?? {}), [key]: next } };
}

/** A new library without `voicing` for `key` (an emptied chord disappears). */
export function removeFromLibrary(lib, key, voicing) {
  const rest = libraryFor(lib, key).filter((x) => !sameVoicing(x, voicing));
  const chords = { ...(lib?.chords ?? {}) };
  if (rest.length) chords[key] = rest; else delete chords[key];
  return { chords };
}

export const inLibrary = (lib, key, voicing) => libraryFor(lib, key).some((x) => sameVoicing(x, voicing));
