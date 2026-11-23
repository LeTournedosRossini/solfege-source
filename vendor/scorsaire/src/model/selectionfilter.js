/*
 * Filtre de sélection (PUR). Étape 5, « sélection de plage », filtres. État de VUE / d'application : jamais dans le Document.
 *
 * Reprend `SelectionFilter` de MuseScore 4.7.5 (lu : selectionfilter.h/.cpp, select.cpp `staffMimeData`, writecontext.cpp,
 * edit.cpp `deleteRange`) : trois jeux de cases INDÉPENDANTS, tout inclus par défaut.
 *   - voix 1 à 4 ;
 *   - notes d'un accord : haute, basse, 2e à 7e depuis le bas, plus « notes seules » (`includeSingleNotes`) ;
 *   - catégories d'éléments (20 chez MuseScore ; ici celles que Scorsaire possède + des catégories propres).
 * Sémantique « inclus » : une case DÉCOCHÉE exclut. Le filtre agit à la copie, au « vider » et au « couper » (= copier + vider) ; le
 * collage ne l'utilise jamais (MuseScore : filtre interne seulement).
 *
 * Représentation (sérialisable) : `{ voices: [bool×4], notes: { top, bottom, n2…n7, single }, elements: { <catégorie>: bool } }`,
 * vrai = INCLUS.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';

/** Catégories d'éléments, dans l'ordre d'affichage. `own` = propre à Scorsaire (absente de MuseScore). */
export const ELEMENT_CATEGORIES = Object.freeze([
  { id: 'dynamic' }, { id: 'hairpin' }, { id: 'fingering' }, { id: 'lyrics' }, { id: 'chordSymbol' }, { id: 'articulation' },
  { id: 'ornament' }, { id: 'slur' }, { id: 'tie' }, { id: 'pedal' }, { id: 'arpeggio' }, { id: 'glissando' }, { id: 'breath' },
  { id: 'tremolo' }, { id: 'graceNote' },
  { id: 'bend', own: true }, { id: 'techLine', own: true }, { id: 'slide', own: true }, { id: 'capoTuning', own: true },
  { id: 'staffText', own: true }, { id: 'system', own: true }, { id: 'decor', own: true },
]);
export const ELEMENT_CATEGORY_IDS = Object.freeze(ELEMENT_CATEGORIES.map((c) => c.id));

/** Notes d'un accord, de la plus haute à la plus basse (ordre d'affichage). `n2` = 2e depuis le bas. */
export const NOTE_FILTER_IDS = Object.freeze(['top', 'n7', 'n6', 'n5', 'n4', 'n3', 'n2', 'bottom']);

/** Filtre par défaut : tout est inclus. */
export function defaultFilter() {
  return {
    voices: [true, true, true, true],
    notes: { ...Object.fromEntries(NOTE_FILTER_IDS.map((k) => [k, true])), single: true },
    elements: Object.fromEntries(ELEMENT_CATEGORY_IDS.map((k) => [k, true])),
  };
}

/** Copie profonde, complétée par les valeurs par défaut (tolère un filtre partiel ou plus ancien). */
export function normalizeFilter(f) {
  const d = defaultFilter();
  if (!f) return d;
  if (Array.isArray(f.voices)) for (let i = 0; i < 4; i++) if (f.voices[i] === false) d.voices[i] = false;
  for (const k of Object.keys(d.notes)) if (f.notes?.[k] === false) d.notes[k] = false;
  for (const k of ELEMENT_CATEGORY_IDS) if (f.elements?.[k] === false) d.elements[k] = false;
  return d;
}

export const isDefaultFilter = (f) => {
  if (!f) return true;
  const n = normalizeFilter(f);
  return n.voices.every(Boolean) && Object.values(n.notes).every(Boolean) && Object.values(n.elements).every(Boolean);
};

/** Nombre de cases décochées (pastille du bouton). */
export function excludedCount(f) {
  const n = normalizeFilter(f);
  return n.voices.filter((v) => !v).length + Object.values(n.notes).filter((v) => !v).length + Object.values(n.elements).filter((v) => !v).length;
}

/** Remplace une case (immuable). `group` : 'voices' (key = 0..3), 'notes', 'elements'. */
export function setFilterFlag(f, group, key, included) {
  const n = normalizeFilter(f);
  if (group === 'voices') n.voices[key] = !!included;
  else if (group === 'notes' && key in n.notes) n.notes[key] = !!included;
  else if (group === 'elements' && key in n.elements) n.elements[key] = !!included;
  else throw new Error(`setFilterFlag : case inconnue « ${group}/${key} »`);
  return n;
}

/** Tout inclure / tout exclure dans un groupe (boutons « tout » / « rien » de MuseScore). */
export function setFilterGroup(f, group, included) {
  const n = normalizeFilter(f);
  if (group === 'voices') n.voices = [!!included, !!included, !!included, !!included];
  else if (group === 'notes') for (const k of Object.keys(n.notes)) n.notes[k] = !!included;
  else if (group === 'elements') for (const k of ELEMENT_CATEGORY_IDS) n.elements[k] = !!included;
  else throw new Error(`setFilterGroup : groupe inconnu « ${group} »`);
  return n;
}

// ── tests (lecture) ─────────────────────────────────────────────────────────────────────────────

export const canVoice = (f, voiceIndex) => normalizeFilter(f).voices[voiceIndex] !== false;
export const canCategory = (f, category) => normalizeFilter(f).elements[category] !== false;

/**
 * `SelectionFilter::canSelectNoteIdx` : la note d'index `idx` (0 = la plus basse) d'un accord de `total` notes passe-t-elle ?
 * Une note SEULE passe si « notes seules » est coché OU si la plage ne contient aucun accord de plusieurs notes.
 * La plus haute (ou au-delà de la 7e) compte comme « haute ».
 */
export function canNote(f, idx, total, rangeHasMultiNoteChords) {
  const n = normalizeFilter(f).notes;
  if (total === 1) return n.single !== false || !rangeHasMultiNoteChords;
  // La note la plus haute (ou au-delà de la 7e) ne dépend que de « haute » ; la plus basse que de « basse » ; les autres de leur rang.
  // ÉCART avec MuseScore : chez lui la plus haute passe aussi si la case de son rang est cochée (le panneau lie les deux cases selon la
  // taille de l'accord sélectionné) ; ici les cases sont fixes, donc « haute » décide seule.
  if (idx === total - 1 || idx >= 7) return n.top !== false;
  return n[idx === 0 ? 'bottom' : `n${idx + 1}`] !== false;
}

// ── classement des éléments ─────────────────────────────────────────────────────────────────────

const ORNAMENT_ARTICULATIONS = new Set(['trill', 'mordent', 'mordentInverted', 'turn', 'turnInverted']);
/** Catégorie d'une articulation (MuseScore : ORNAMENT pour trille/mordant/gruppetto, ARTICULATION pour le reste, point d'orgue compris). */
export const articulationCategory = (type) => (ORNAMENT_ARTICULATIONS.has(type) ? 'ornament' : 'articulation');

/** Catégorie d'une liste de portée (propriété), ou null si la liste n'est jamais filtrée. */
export const LIST_CATEGORY = Object.freeze({
  [PID.HAIRPINS]: 'hairpin', [PID.SLURS]: 'slur', [PID.HOPOS]: 'slur', [PID.TIES]: 'tie', [PID.GLISSANDOS]: 'glissando',
  [PID.TRILLS]: 'ornament', [PID.TREMOLOS]: 'tremolo', [PID.PEDALS]: 'pedal', [PID.BREATHS]: 'breath', [PID.BENDS]: 'bend', [PID.WHEELS]: 'bend',
  [PID.TECH_LINES]: 'techLine', [PID.CAPOS]: 'capoTuning', [PID.STRING_TUNINGS]: 'capoTuning',
});

/** Propriétés d'accord qui sont des marques filtrables : [pid, catégorie]. */
export const CHORD_MARK_CATEGORY = Object.freeze([
  [PID.DYNAMIC, 'dynamic'], [PID.ARPEGGIO, 'arpeggio'], [PID.TREMOLO, 'tremolo'], [PID.CHORD_LINE, 'slide'], [PID.TAPPING, 'articulation'],
]);

/** Notes d'un accord triées de la plus basse à la plus haute (hauteur, sinon ordre stocké) ; renvoie les éléments `note`. */
export function notesLowToHigh(chord) {
  const notes = chord.notes ?? [];
  const keyOf = (n) => {
    // `pitch` ne s'applique qu'aux notes de hauteur : percussion, rythme, etc. gardent l'ordre stocké
    let p = null;
    try { p = getProperty(n, PID.PITCH); } catch { p = null; }
    return typeof p === 'number' ? p : null;
  };
  if (notes.some((n) => keyOf(n) === null)) return [...notes];
  return notes.map((n, i) => ({ n, i, p: keyOf(n) })).sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.n);
}

/** Vrai si un accord de plusieurs notes existe parmi ces accords (`Selection::rangeContainsMultiNoteChords`). */
export const containsMultiNoteChords = (chords) => chords.some((c) => (c.notes?.length ?? 0) > 1);

/**
 * Notes d'un accord qui passent le filtre : { kept, dropped } (éléments `note`). Les accords d'ornement ne sont pas filtrés par
 * voix ni par note (ils suivent leur catégorie `graceNote`).
 */
export function splitChordNotes(f, chord, rangeHasMulti) {
  const sorted = notesLowToHigh(chord);
  const kept = [], dropped = [];
  sorted.forEach((n, idx) => (canNote(f, idx, sorted.length, rangeHasMulti) ? kept : dropped).push(n));
  return { kept, dropped };
}
