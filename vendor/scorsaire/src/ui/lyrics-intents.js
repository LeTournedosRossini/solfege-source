/*
 * Saisie des paroles depuis la mélodie : intentions SANS DOM (état du curseur de paroles + appels au moteur `model/lyricsedit.js`).
 * L'état est celui de l'APPLICATION (jamais dans le Document) : { cursor: { staffId, voice, verse, chordId }, pending: { join, chordId } | null }.
 * `pending` = séparateur tapé après la syllabe de `chordId` qui ne peut pas encore être écrit dans le texte (il n'y a pas encore de mot
 * suivant) ; il est transmis à l'écriture suivante si celle-ci tombe sur l'accord voisin.
 * Les fonctions d'écriture sont À APPELER DANS `Application.edit` (une transaction par geste).
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { cursorOfElement } from './noteentry-cursor.js';
import { chordSymbolsInSpan } from '../model/fretdiagram.js';
import { chordText } from '../lecteur/songbook.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { rangeItems, resolveStaves, rangeMeasureSpan } from '../model/range.js';
import { writeSyllable, extendMelisma, writeLyricsBlock, writeGridMeasures, attachGridToStaff, moveSyllable, setLyricAssignment, verseState, writeFreeText, gridTextOf, gridWordCount, neighbourChord, staffChords, voiceOfChord, lyricAt, verseList, parseBlock } from '../model/lyricsedit.js';

export class LyricsError extends Error {
  constructor(code, message) { super(message ?? code); this.name = 'LyricsError'; this.code = code; }
}

const LYRIC_STAFF_TYPES = new Set(['score', 'tab', 'percussion', 'rhythm', 'neutral']);

/** Accord (identifiant) désigné par un élément (accord, note) ; si c'est un silence, l'accord suivant de sa voix ; null sinon. */
function chordOfElement(doc, id) {
  const at = cursorOfElement(doc, id);
  if (!at) return null;
  const staff = doc.find(at.staffId);
  if (!staff || !LYRIC_STAFF_TYPES.has(getProperty(staff, PID.STAFF_TYPE))) return null;
  let item = doc.find(id);
  if (item && item.type !== 'chord' && item.type !== 'rest') item = doc.parentOf(item.id);
  if (item?.type === 'chord') return { staffId: at.staffId, voice: at.voice, chordId: item.id };
  // silence : premier accord de la voix qui le suit
  let seen = false;
  for (const m of staff.voices[at.voice].measures) for (const it of m.items) { if (it === item) seen = true; else if (seen && it.type === 'chord') return { staffId: at.staffId, voice: at.voice, chordId: it.id }; }
  return null;
}

/** Curseur de paroles posé sur un élément (accord, note, silence). `verse` : couplet à garder. */
export function cursorAt(doc, id, verse = 0) {
  const c = chordOfElement(doc, id);
  return c ? { ...c, verse } : null;
}

/** Curseur de départ sans sélection : premier accord de la première portée qui en porte. */
export function defaultCursor(doc, verse = 0) {
  for (const mv of doc.work.movements) for (const track of mv.tracks) for (const staff of track.staves) {
    if (!LYRIC_STAFF_TYPES.has(getProperty(staff, PID.STAFF_TYPE))) continue;
    const order = staffChords(staff, 0);
    if (order.length) return { staffId: staff.id, voice: 0, verse, chordId: order[0] };
  }
  return null;
}

/** Remet un curseur dans un état valable après un changement du Document ; null s'il n'y a plus d'accord. */
export function normalizeLyricsCursor(doc, c) {
  if (!c) return null;
  const staff = doc.find(c.staffId);
  if (!staff || staff.type !== 'staff') return null;
  const voice = voiceOfChord(staff, c.chordId);
  if (voice >= 0) return { ...c, voice };
  const first = staffChords(staff, Math.min(c.voice ?? 0, (staff.voices?.length ?? 1) - 1))[0];
  return first ? { ...c, chordId: first } : null;
}

/** `pending` seulement si son accord existe encore dans la voix du curseur. */
export function normalizePending(doc, state, cursor) {
  const staff = cursor && doc.find(cursor.staffId);
  return state?.pending && staff && staffChords(staff, cursor.voice).includes(state.pending.chordId) ? state.pending : null;
}

/** Déplace le curseur d'un accord (±1) sans rien écrire ; null au bord. */
export function step(doc, state, dir) {
  const next = neighbourChord(doc, state.cursor.staffId, state.cursor.chordId, dir);
  return next ? { cursor: { ...state.cursor, chordId: next }, pending: null } : null;
}

/** Couplet voisin (existant) ou, avec `create`, couplet suivant même s'il n'existe pas encore. */
export function changeVerse(doc, state, delta, create = false) {
  const target = state.cursor.verse + delta;
  if (target < 0) return null;
  if (!create && !verseList(doc).includes(target)) return null;
  return { cursor: { ...state.cursor, verse: target }, pending: null };
}

/** Ce que porte l'accord du curseur pour le couplet courant : { text, covered } (texte vide si rien). */
export function current(doc, state) {
  const c = state.cursor;
  const l = lyricAt(doc, c.staffId, c.chordId, c.verse);
  return { text: l?.text ?? '', covered: !!l?.covered, exists: !!(l && l.text), melismaEnd: l?.melismaEnd ?? null };
}

/**
 * Valide une syllabe (À APPELER DANS UNE TRANSACTION). `join` : 'space' | 'dash' | 'melisma'. Texte vide : 'space' = retire la syllabe
 * de l'accord ; 'melisma' = prolonge le mélisme ; 'dash' = refusé. Retourne le nouvel état.
 */
export function commit(doc, state, text, join) {
  const c = state.cursor;
  const w = String(text ?? '').replace(/\s+/g, '');
  if (!w && join === 'dash') throw new LyricsError('emptyDash', 'Un tiret suit une syllabe');
  if (!w && join === 'melisma') {
    const r = extendMelisma(doc, { staffId: c.staffId, chordId: c.chordId, verse: c.verse });
    if (!r.ok) throw new LyricsError('noMelisma', 'Rien à prolonger ici');
    return { cursor: { ...c, chordId: r.target }, pending: null };
  }
  const prev = neighbourChord(doc, c.staffId, c.chordId, -1);
  const prevJoin = state.pending && state.pending.chordId === prev ? state.pending.join : undefined;
  const r = writeSyllable(doc, { staffId: c.staffId, chordId: c.chordId, verse: c.verse, text: w, join, prevJoin });
  const next = neighbourChord(doc, c.staffId, c.chordId, 1);
  if (join === 'melisma') return { cursor: { ...c, chordId: r.melismaEnd ?? next ?? c.chordId }, pending: null };
  return { cursor: { ...c, chordId: next ?? c.chordId }, pending: join === 'dash' && w ? { join: 'dash', chordId: c.chordId } : null };
}

/** Accords de la voix 1 de la première portée de la plage, dans l'ordre. */
export function rangeChords(doc, range) {
  if (!range?.staffIds?.length) return { staffId: null, chordIds: [] };
  const bar = doc.find(range.from.measureId);
  const mv = bar && doc.movementOf(bar);
  const staff = mv && resolveStaves(mv, [range.staffIds[0]])?.[0];
  if (!staff) return { staffId: null, chordIds: [] };
  const ids = rangeItems(mv, { ...range, staffIds: [staff.id] }).filter((e) => e.voiceIndex === 0 && e.item.type === 'chord').map((e) => e.item.id);
  return { staffId: staff.id, chordIds: ids };
}

/** Pose un bloc de texte sur la plage (À APPELER DANS UNE TRANSACTION). Retourne { placed, left, count }. */
export function writeBlock(doc, range, verse, text) {
  const { staffId, chordIds } = rangeChords(doc, range);
  if (!staffId || !chordIds.length) throw new LyricsError('noChords', 'Aucune note dans la plage');
  const r = writeLyricsBlock(doc, { staffId, verse, text, chordIds });
  return { ...r, count: chordIds.length };
}

/** The measures of the range with what the verse says in each: [{ id, number (1-based), text }] (the fields of the grid panel). */
export function gridMeasures(doc, range, verse) {
  const bar = doc.find(range?.from?.measureId);
  const mv = bar && doc.movementOf(bar);
  const span = mv && rangeMeasureSpan(mv, range);
  if (!span) return [];
  const said = gridTextOf(doc, mv, verse);
  const out = [];
  for (let i = span.first; i <= span.last; i += 1) out.push({ id: mv.masterbars[i].id, number: i + 1, text: said.get(i) ?? '' });
  return out;
}

/** « Attacher aux notes » : the grid verse goes on the notes of the first staff of the range (TO CALL INSIDE A TRANSACTION). Returns { linked, unlinked }. */
export function attachGrid(doc, range, verse) {
  const { staffId } = rangeChords(doc, range);
  if (!staffId) throw new LyricsError('noChords', 'Aucune portée');
  return attachGridToStaff(doc, { verse, staffId });
}

/** Writes the fields of the grid panel: [{ id, text }] for the verse (TO CALL INSIDE A TRANSACTION). */
export function writeGrid(doc, verse, measures) {
  return writeGridMeasures(doc, { verse, measures });
}

/** Texte collé/tapé en plusieurs syllabes au curseur : successives à partir de l'accord courant. Retourne { state, left }. */
export function writeFromCursor(doc, state, text) {
  const c = state.cursor;
  const staff = doc.find(c.staffId);
  const order = staffChords(staff, c.voice);
  const chordIds = order.slice(order.indexOf(c.chordId));
  const r = writeLyricsBlock(doc, { staffId: c.staffId, verse: c.verse, text, chordIds });
  const used = Math.min(chordIds.length, r.placed);
  const lastIdx = Math.min(order.indexOf(c.chordId) + used, order.length - 1);
  return { state: { cursor: { ...c, chordId: order[lastIdx] }, pending: null }, left: r.left };
}

/** Compte « mots / notes » pour le panneau : syllabes + souligné d'un texte, et nombre d'accords de la plage. */
export function blockCounts(doc, range, text) {
  return { words: parseBlock(text).length, notes: rangeChords(doc, range).chordIds.length };
}

/** The chord an element stands for, for a dropped syllable: { staffId, chordId } or null. */
export function dropTarget(doc, id) {
  const c = chordOfElement(doc, id);
  return c ? { staffId: c.staffId, chordId: c.chordId } : null;
}

/** Moves a syllable (a lyric link) onto the chord under `targetId` (TO CALL INSIDE A TRANSACTION). */
export function moveLyric(doc, linkId, targetId) {
  const entry = doc.findListEntry(linkId);
  if (!entry || entry.kind !== 'lyric') throw new LyricsError('noSyllable', 'Syllabe introuvable');
  const target = dropTarget(doc, targetId);
  if (!target || target.staffId !== entry.owner.id) throw new LyricsError('otherStaff', 'Une syllabe reste sur sa portée');
  return moveSyllable(doc, { staffId: entry.owner.id, linkId, chordId: target.chordId });
}

/** Writes the placement of a verse on the notes of a staff, from the adjustment window (TO CALL INSIDE A TRANSACTION). */
export function setAssignment(doc, staffId, verse, assign) {
  return setLyricAssignment(doc, { staffId, verse, assign });
}

/** The free text sheet of a verse for its window: { state, text, chords (the distinct chords of the first chord track, written as the Lecteur writes them) }. */
export function freeSheetOf(doc, verse) {
  const lt = (getProperty(doc.work, PID.LYRIC_TEXTS) ?? []).find((t) => t.verse === verse);
  const state = verseState(doc, verse);
  const mv = doc.work.movements[0];
  const dict = workChordQualities(doc.work);
  const names = [];
  if (mv?.masterbars.length) for (const e of chordSymbolsInSpan(mv, mv.masterbars[0].id, mv.masterbars.length)) { const n = chordText(e.sym, dict); if (n && !names.includes(n)) names.push(n); }
  return { state, text: state === 'free' ? lt.text : '', chords: names };
}

/** Writes the free text sheet (TO CALL INSIDE A TRANSACTION). */
export function writeFreeSheet(doc, verse, text) {
  return writeFreeText(doc, { verse, text });
}
