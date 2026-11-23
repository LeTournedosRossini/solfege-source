/*
 * Intentions « saisie des symboles d'accord en grille » (étape 5, tranche 6). AUCUN DOM : fonctions sur le Document, appelées par l'Application
 * à l'intérieur de `app.edit(...)` (donc UNE transaction, annulable). Elles ne touchent que les symboles d'accord (`chordsymbol`) de la PREMIÈRE
 * voix d'une portée d'accords et la propriété `PID.INPUT_GRID` des masterbars. La qualité reste un identifiant du dictionnaire de l'œuvre :
 * jamais de texte libre (`ChordEntryError('unknown-quality')`).
 *
 * Adresse d'une case : `{ staffId, measureId, cell }` — `measureId` = identifiant du masterbar (jamais un numéro), `cell` = index dans la
 * grille de cette mesure. Règles décidées avec Jean (11/10/2026) : une case = un symbole ; une case vide prolonge le symbole précédent ;
 * `%` se pose au temps 1 et remplit la mesure ; `%%` se pose au temps 1, couvre la mesure et la suivante (laissée vide) et se dessine à
 * cheval sur la barre qui les sépare (peintre `chord`).
 */
import { PID } from '../model/pid.js';
import { createChordSymbol } from '../model/elements.js';
import { fEq, fLt, fAdd, fCmp, ZERO } from '../model/fraction.js';
import { PLAY_OFFSETS, soundingPosition } from '../model/chordoffset.js';
import { inputGridOf, hasOwnInputGrid, splitStarts, fitDuration, equalStarts, derivedInputGrid, cellsFromStarts, cellIndexAt } from '../model/inputgrid.js';
import { measureLengthOf } from '../model/timing.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { chordQualityNames } from '../model/chordquality.js';

export class ChordEntryError extends Error {
  constructor(code, message) { super(message); this.name = 'ChordEntryError'; this.code = code; }
}

const STEPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const isNote = (n) => n && STEPS.includes(n.step) && [-1, 0, 1].includes(n.alter ?? 0);

/** Contexte d'une case : { staff, movement, voice, measure, masterbar, index, first, cells, cell }. Lève si introuvable. */
export function resolveCell(doc, { staffId, measureId, cell }) {
  const staff = doc.find(staffId);
  if (!staff || staff.type !== 'staff') throw new ChordEntryError('no-staff', `portée « ${staffId} » introuvable`);
  if (doc.get(staff, PID.STAFF_TYPE) !== 'chord') throw new ChordEntryError('not-chord-staff', 'pas une portée d\'accords');
  const movement = doc.movementOf(staff);
  const index = movement.masterbars.findIndex((b) => b.id === measureId);
  if (index < 0) throw new ChordEntryError('no-measure', `mesure « ${measureId} » introuvable`);
  const voice = staff.voices[0];
  const measure = voice?.measures[index];
  if (!measure) throw new ChordEntryError('no-measure', 'la portée n\'a pas de mesure à cet endroit');
  const masterbar = movement.masterbars[index];
  const cells = inputGridOf(masterbar, index === 0);
  if (cell != null && !cells[cell]) throw new ChordEntryError('no-cell', `case ${cell} inexistante`);
  return { staff, movement, voice, measure, masterbar, index, first: index === 0, cells, cell: cell == null ? null : cells[cell] };
}

const posOf = (s) => s.props[PID.POSITION] ?? ZERO;

/**
 * Symbole d'une case : celui posé exactement à son début ; à défaut, un symbole posé À L'INTÉRIEUR de la case (un accord d'anticipation à 7/8, importé ou écrit sur une autre grille :
 * il n'est le début d'aucune case, on ne pouvait ni le modifier ni l'effacer). Undefined si rien.
 */
export const symbolAtCell = (measure, cell) => {
  const symbols = measure.items.filter((s) => s.type === 'chordsymbol');
  const end = fAdd(cell.start, cell.length);
  return symbols.find((s) => fEq(posOf(s), cell.start)) ?? symbols.find((s) => fLt(cell.start, posOf(s)) && fLt(posOf(s), end));
};

function insertSorted(doc, measure, symbol) {
  let at = measure.items.findIndex((s) => s.type === 'chordsymbol' && fLt(symbol.props[PID.POSITION], posOf(s)));
  if (at < 0) at = measure.items.length;
  doc.add(measure, 'items', symbol, at);
}

const setOrReset = (doc, el, pid, value, empty) => {
  if (value === empty || value === undefined) { if (Object.hasOwn(el.props, pid)) doc.reset(el, pid); } else doc.set(el, pid, value);
};

/** Identifiant ou alias connu du dictionnaire de l'œuvre ('' = majeur). */
function checkQuality(doc, quality) {
  if (quality === '' || quality == null) return;
  const known = workChordQualities(doc.work).qualities.some((q) => chordQualityNames(q).includes(quality));
  if (!known) throw new ChordEntryError('unknown-quality', `qualité « ${quality} » absente du dictionnaire`);
}

/**
 * Pose / modifie le symbole d'une case. `patch` : { root, quality, bass } (champs absents = inchangés ; bass null = effacer).
 * Crée le symbole s'il n'existe pas ; choisir une fondamentale sur un N.C., un % ou un %% le transforme en accord ordinaire.
 */
export function setCellChord(doc, address, patch) {
  const { measure, cell } = resolveCell(doc, address);
  if (!cell) throw new ChordEntryError('no-cell', 'case manquante');
  if ('root' in patch && patch.root !== null && !isNote(patch.root)) throw new ChordEntryError('bad-root', 'fondamentale invalide');
  if ('bass' in patch && patch.bass !== null && !isNote(patch.bass)) throw new ChordEntryError('bad-bass', 'basse invalide');
  if ('quality' in patch) checkQuality(doc, patch.quality);
  let sym = symbolAtCell(measure, cell);
  const wasSpecial = sym && (sym.props[PID.CHORD_SPECIAL] ?? 'none') !== 'none';
  if (!sym) {
    if (!patch.root && !('root' in patch)) throw new ChordEntryError('no-root', 'choisir d\'abord une fondamentale');
    sym = createChordSymbol({ root: patch.root ?? undefined, position: cell.start, duration: fitDuration(cell.length).base, props: { [PID.DURATION]: fitDuration(cell.length) } });
    insertSorted(doc, measure, sym);
  } else if (wasSpecial) {
    doc.reset(sym, PID.CHORD_SPECIAL);
    for (const pid of [PID.CHORD_ROOT, PID.CHORD_QUALITY, PID.CHORD_BASS]) if (Object.hasOwn(sym.props, pid)) doc.reset(sym, pid);
  }
  if ('root' in patch && patch.root) doc.set(sym, PID.CHORD_ROOT, { step: patch.root.step, alter: patch.root.alter ?? 0 });
  if ('quality' in patch) setOrReset(doc, sym, PID.CHORD_QUALITY, patch.quality, '');
  if ('bass' in patch) setOrReset(doc, sym, PID.CHORD_BASS, patch.bass === null ? null : { step: patch.bass.step, alter: patch.bass.alter ?? 0 }, null);
  return sym;
}

/** Symbole spécial dans une case : 'noChord' (N.C.). Remplace le symbole existant de la case. */
export function setCellNoChord(doc, address) {
  const { measure, cell } = resolveCell(doc, address);
  const old = symbolAtCell(measure, cell);
  if (old) doc.remove(old);
  const sym = createChordSymbol({ special: 'noChord', position: cell.start, duration: fitDuration(cell.length).base, props: { [PID.DURATION]: fitDuration(cell.length) } });
  insertSorted(doc, measure, sym);
  return sym;
}

const clearMeasure = (doc, measure) => { for (const s of [...measure.items]) if (s.type === 'chordsymbol') doc.remove(s); };

/** `%` : remplace le contenu de la mesure par un symbole de répétition au temps 1 (refusé dans la 1re mesure : rien à répéter). */
export function setMeasureRepeat(doc, address) {
  const ctx = resolveCell(doc, { ...address, cell: null });
  if (ctx.first) throw new ChordEntryError('no-previous', 'rien à répéter dans la première mesure');
  clearMeasure(doc, ctx.measure);
  const d = fitDuration(measureLengthOf(ctx.masterbar));
  const sym = createChordSymbol({ special: 'repeat1', position: ZERO, duration: d.base, props: { [PID.DURATION]: d } });
  doc.add(ctx.measure, 'items', sym, 0);
  return sym;
}

/** `%%` : symbole au temps 1 de la mesure, mesure suivante vidée (refusé dans la 1re mesure ou sans mesure suivante). */
export function setTwoMeasureRepeat(doc, address) {
  const ctx = resolveCell(doc, { ...address, cell: null });
  if (ctx.first) throw new ChordEntryError('no-previous', 'rien à répéter dans la première mesure');
  const next = ctx.voice.measures[ctx.index + 1];
  if (!next || ctx.index + 1 >= ctx.movement.masterbars.length) throw new ChordEntryError('no-next', 'il faut une mesure suivante pour un %%');
  clearMeasure(doc, ctx.measure);
  clearMeasure(doc, next);
  const d = fitDuration(measureLengthOf(ctx.masterbar));
  const sym = createChordSymbol({ special: 'repeat2', position: ZERO, duration: d.base, props: { [PID.DURATION]: d } });
  doc.add(ctx.measure, 'items', sym, 0);
  return sym;
}

/** Efface le symbole d'une case (la case vide prolonge le précédent). Renvoie vrai si quelque chose a été retiré. */
export function eraseCell(doc, address) {
  const { measure, cell } = resolveCell(doc, address);
  const sym = symbolAtCell(measure, cell);
  if (!sym) return false;
  doc.remove(sym);
  return true;
}

/** Coupe la case en deux (÷2). Les symboles existants restent à leur position. Vrai si la grille a changé. */
export function subdivideCell(doc, address) {
  const ctx = resolveCell(doc, address);
  const starts = splitStarts(ctx.cells, address.cell);
  if (!starts) throw new ChordEntryError('too-small', 'case trop petite pour être subdivisée');
  doc.set(ctx.masterbar, PID.INPUT_GRID, starts);
  return true;
}

/** Rétablit la grille dérivée du chiffrage pour la mesure (les symboles ne bougent pas). Vrai si un réglage a été effacé. */
export function restoreGrid(doc, address) {
  const ctx = resolveCell(doc, { ...address, cell: null });
  if (!hasOwnInputGrid(ctx.masterbar)) return false;
  doc.reset(ctx.masterbar, PID.INPUT_GRID);
  return true;
}

/** Case voisine (sens +1 / −1), en passant à la mesure suivante / précédente ; null au bout. */
export function neighbourCell(doc, address, direction) {
  const ctx = resolveCell(doc, address);
  const bars = ctx.movement.masterbars;
  let { index } = ctx;
  let cell = address.cell + direction;
  if (cell >= ctx.cells.length) { index += 1; cell = 0; } else if (cell < 0) { index -= 1; cell = -1; }
  if (index < 0 || index >= bars.length) return null;
  if (cell === -1) cell = inputGridOf(bars[index], index === 0).length - 1;
  return { staffId: address.staffId, measureId: bars[index].id, cell };
}

/** Chord staves (voice 1) of the movement: the symbols that follow the grid of a measure. */
const chordStaves = (movement) => movement.tracks.flatMap((t) => t.staves).filter((st) => st.props[PID.STAFF_TYPE] === 'chord' && !st.props[PID.LINKED_TO]); // (a chord staff LINKED to another one is a read-only display: nothing is typed there)

/**
 * Give the measure at `index` exactly `count` EQUAL cells (the grid derived from the time signature when `count` is its own number of
 * cells: the setting is then removed). Symbols follow: each moves to the start of the new cell that contains it; when two symbols fall in
 * the same new cell the earlier one is kept and the others are removed (undo gives them back).
 */
function setSlotsAt(doc, movement, index, count) {
  const masterbar = movement.masterbars[index];
  const length = measureLengthOf(masterbar);
  const derived = derivedInputGrid(masterbar, index === 0);
  const starts = count === derived.length ? derived.map((c) => c.start) : equalStarts(length, count);
  if (!starts) throw new ChordEntryError('too-small', 'cases trop petites');
  const sameAsDerived = count === derived.length && starts.every((x, i) => fEq(x, derived[i].start));
  const cells = cellsFromStarts(starts, length);
  for (const staff of chordStaves(movement)) {
    const measure = staff.voices[0]?.measures[index];
    if (!measure) continue;
    const kept = new Set();
    for (const sym of measure.items.filter((x) => x.type === 'chordsymbol')) {
      const c = cells[cellIndexAt(cells, posOf(sym))] ?? cells[0];
      const key = `${c.start[0]}/${c.start[1]}`;
      if (kept.has(key)) { doc.remove(sym); continue; }
      kept.add(key);
      if (!fEq(posOf(sym), c.start)) doc.set(sym, PID.POSITION, c.start);
    }
  }
  if (sameAsDerived) { if (hasOwnInputGrid(masterbar)) doc.reset(masterbar, PID.INPUT_GRID); } else doc.set(masterbar, PID.INPUT_GRID, starts);
}

/** Number of slots (cells) of ONE measure (`address.measureId`). */
export function setMeasureSlots(doc, address, count) {
  const ctx = resolveCell(doc, { ...address, cell: null });
  setSlotsAt(doc, ctx.movement, ctx.index, count);
  return true;
}

/** The same number of slots for EVERY measure of the movement (each can be overridden afterwards); measures that cannot hold it keep their grid. */
export function setAllSlots(doc, address, count) {
  const ctx = resolveCell(doc, { ...address, cell: null });
  for (let i = 0; i < ctx.movement.masterbars.length; i++) {
    if (!equalStarts(measureLengthOf(ctx.movement.masterbars[i]), count)) continue;
    setSlotsAt(doc, ctx.movement, i, count);
  }
  return true;
}

/**
 * Play offset of the symbol written in a cell (`offset` = a signed fraction from `PLAY_OFFSETS`, null = none). The symbol keeps its written place; the sounding point
 * must stay strictly after the previous symbol's sounding point and before the next one's, and inside the movement (else a ChordEntryError, nothing written).
 */
export function setPlayOffset(doc, address, offset) {
  const { staff, movement, measure, cell, index } = resolveCell(doc, address);
  const sym = symbolAtCell(measure, cell);
  if (!sym || sym.props[PID.CHORD_SPECIAL] === 'repeat1' || sym.props[PID.CHORD_SPECIAL] === 'repeat2') throw new ChordEntryError('no-symbol', 'pas de symbole d\'accord à décaler');
  if (offset && !PLAY_OFFSETS.some((o) => fEq(o, offset))) throw new ChordEntryError('bad-offset', 'décalage non admis');
  if (offset) {
    const starts = [];
    let acc = ZERO;
    for (const mb of movement.masterbars) { starts.push(acc); acc = fAdd(acc, measureLengthOf(mb)); }
    const all = [];
    staff.voices[0].measures.forEach((m, mi) => { for (const it of m?.items ?? []) if (it.type === 'chordsymbol' && it.props[PID.POSITION]) all.push({ it, abs: fAdd(starts[mi], it.props[PID.POSITION]) }); });
    all.sort((a, b) => fCmp(a.abs, b.abs));
    const k = all.findIndex((e) => e.it === sym);
    const target = fAdd(starts[index], soundingPosition(posOf(sym), offset));
    const soundOf = (e) => fAdd(e.abs, e.it.props[PID.PLAY_OFFSET] ?? ZERO);
    if (fCmp(target, ZERO) < 0 || fCmp(target, acc) >= 0) throw new ChordEntryError('out', 'le décalage sort du morceau');
    if (k > 0 && fCmp(target, soundOf(all[k - 1])) <= 0) throw new ChordEntryError('room', 'pas assez de place : l\'accord précédent n\'aurait pas le temps de sonner');
    if (k < all.length - 1 && fCmp(target, soundOf(all[k + 1])) >= 0) throw new ChordEntryError('room', 'pas assez de place avant l\'accord suivant');
  }
  setOrReset(doc, sym, PID.PLAY_OFFSET, offset ?? null, null);
  return sym;
}
