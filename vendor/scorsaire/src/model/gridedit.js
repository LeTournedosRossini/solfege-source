/*
 * Saisie « sur grille » (percussion, portée rythmique, basses d'accordéon…) : l'utilisateur ne pose que des DÉPARTS de notes sur une
 * grille choisie temps par temps ; à la sortie du mode, ce module écrit les durées.
 *
 * Règle (décidée avec Jean, 12/10/2026) :
 *   - une frappe dure jusqu'à la frappe SUIVANTE de la même voix, ou jusqu'à la fin de son TEMPS : elle ne passe jamais sur le temps
 *     suivant (les ligatures sont donc toujours par temps) ;
 *   - le début d'un temps sans frappe est un silence, un temps entièrement vide aussi (silences automatiques du moteur) ;
 *   - un temps dont la grille n'est pas binaire (triolet, quintolet, sextolet…) devient un n-olet de ce temps, sauf s'il ne contient
 *     qu'UNE frappe sur sa première case (la frappe remplit tout le temps : écriture ordinaire, sans n-olet).
 *
 * Deux parties :
 *   - PUR (aucun Document) : `beatsOf`, `beatGrid`, `fitBeatCells`, `planVoiceMeasure` — calculent, pour une voix d'une mesure, la liste
 *     des morceaux à écrire ;
 *   - `applyVoiceMeasurePlan(doc, …)` : écrit ce plan dans le Document, À APPELER DANS `doc.transaction`. Une mesure reste toujours remplie
 *     (silences automatiques, trous des voix 2-4, comme `placeChord`).
 */
import { PID } from './pid.js';
import { newId } from './ids.js';
import { createRest, createTie } from './elements.js';
import { DURATION_VALUE } from './pitch.js';
import { getProperty } from './props.js';
import {
  ZERO, frac, fAdd, fSub, fMul, fDiv, fCmp, fEq, fLt, fLe,
} from './fraction.js';
import {
  timeSigHelpers, toRhythmicDurationList, toDurationList, durationValue, TICKS_PER_WHOLE,
} from './rhythmsplit.js';
import { replaceVoiceMeasure } from './noteedit.js';

/** Grille impossible à écrire (durée non représentable, subdivision sans n-olet possible…). Le Document n'est pas modifié. */
export class GridError extends Error {}

// ---------- temps de la mesure ----------

/**
 * Temps d'une mesure : `[{ start, end }]` en fractions de ronde depuis le début du CONTENU de la mesure. Les temps suivent le
 * chiffrage (noire en 4/4, noire pointée en 6/8…) et s'alignent sur la mesure complète : une anacrouse (`offset`) commence par un temps
 * partiel.
 */
export function beatsOf(timeSig, length, offset = ZERO, grouping = null) {
  if (grouping?.length) return beatsOfGrouping(timeSig, length, offset, grouping); // an asymmetric measure: 3 + 2, 3 + 2 + 2…
  const ts = timeSigHelpers(timeSig);
  const beat = frac(ts.beatTicks, TICKS_PER_WHOLE);
  const out = [];
  let k = Math.floor((offset[0] / offset[1]) / (beat[0] / beat[1]));
  for (;; k++) {
    const rawStart = fSub(fMul(beat, frac(k)), offset);
    if (!fLt(rawStart, length)) break;
    const rawEnd = fSub(fMul(beat, frac(k + 1)), offset);
    const start = fLt(rawStart, ZERO) ? ZERO : rawStart;
    const end = fLt(length, rawEnd) ? length : rawEnd;
    if (fLt(start, end)) out.push({ start, end });
  }
  return out;
}

/** Beats of a measure written as groups of `grouping` units of the denominator (the same rules as `beatsOf`: aligned on the full measure, an anacrusis starts with a part of a beat). */
function beatsOfGrouping([, den], length, offset, grouping) {
  const out = [];
  let at = ZERO;
  for (const n of grouping) {
    const start = fSub(at, offset); const end = fSub(fAdd(at, frac(n, den)), offset);
    at = fAdd(at, frac(n, den));
    if (!fLt(ZERO, end)) continue; // before the start of the content
    const s0 = fLt(start, ZERO) ? ZERO : start; const e0 = fLt(length, end) ? length : end;
    if (fLt(s0, e0)) out.push({ start: s0, end: e0 });
  }
  return out.length ? out : [{ start: ZERO, end: length }];
}

const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/** Nom de la valeur écrite (sans point) égale à `f`, ou null. */
export function baseNameOf(f) {
  for (const [name, v] of Object.entries(DURATION_VALUE)) if (fEq(v, f)) return name;
  return null;
}

/**
 * Description de la grille d'un temps de longueur `L` découpé en `n` cases égales :
 *   - `{ tuplet: false, cell }` si la case est une durée binaire (dénominateur puissance de 2 : double croche, croche, 3/32…) ;
 *   - `{ tuplet: true, cell, written, ratio: [n, d], base }` sinon : `n` cases dans la place de `d` cases écrites de valeur `written`
 *     (triolet de croches `[3, 2]`, quintolet de doubles `[5, 4]`, sextolet `[6, 4]`…). `d` = le plus grand entier < `n` qui donne une
 *     valeur écrite binaire (MuseScore : 3:2, 5:4, 6:4, 7:4, 9:8…).
 */
export function beatGrid(length, n) {
  if (!Number.isInteger(n) || n < 1) throw new GridError('Nombre de cases invalide');
  const cell = fDiv(length, frac(n));
  if (isPow2(cell[1])) return { tuplet: false, cell, n };
  for (let d = n - 1; d >= 1; d--) {
    const written = fDiv(length, frac(d));
    const base = baseNameOf(written);
    if (base) return { tuplet: true, cell, n, d, written, ratio: [n, d], base: { base, dots: 0 } };
  }
  throw new GridError(`Un temps de ${length[0]}/${length[1]} ne se divise pas en ${n} cases écrivables`);
}

/** Instant de début de la case `cell` d'un temps `{ start, end, cells }`. */
export function cellStart(beat, cell) {
  return fAdd(beat.start, fMul(beatGrid(fSub(beat.end, beat.start), beat.cells).cell, frac(cell)));
}

/** Indice de la case de l'instant `t` dans le temps `beat`, ou null s'il ne tombe pas sur la grille du temps (ou hors du temps). */
export function cellIndexAt(beat, t) {
  if (!(fLe(beat.start, t) && fLt(t, beat.end))) return null;
  const r = fDiv(fSub(t, beat.start), beatGrid(fSub(beat.end, beat.start), beat.cells).cell);
  return r[1] === 1 ? r[0] : null;
}

/** Nombres de cases proposés pour un temps, du préféré au moins courant (le défaut d'abord : double croche pour une noire). */
export function cellCountCandidates(length) {
  const sixteenth = frac(1, 16);
  const base = fDiv(length, sixteenth); // nombre de doubles croches dans le temps
  const per = base[1] === 1 ? base[0] : null; // 4 pour une noire, 6 pour une noire pointée
  const list = [];
  if (per) list.push(per, per / 2, per * 2, per * 4);
  list.push(3, 6, 12, 5, 7, 9, 10, 24);
  return [...new Set(list.filter((n) => Number.isInteger(n) && n >= 1))];
}

/**
 * Plus petite grille (dans l'ordre de préférence `candidates`) qui contient TOUS les instants `onsets` (fractions, depuis le début du
 * contenu de la mesure) tombant dans le temps `beat`. Retourne le nombre de cases, ou null si aucune ne convient.
 */
export function fitBeatCells(beat, onsets, candidates = null) {
  const length = fSub(beat.end, beat.start);
  const inside = onsets.filter((t) => fLe(beat.start, t) && fLt(t, beat.end));
  for (const n of candidates ?? cellCountCandidates(length)) {
    let grid;
    try { grid = beatGrid(length, n); } catch { continue; }
    if (inside.every((t) => {
      const r = fDiv(fSub(t, beat.start), grid.cell);
      return r[1] === 1;
    })) return n;
  }
  return null;
}

// ---------- plan d'écriture ----------

/** Écrit la durée `length` commençant en `start` : liste de `{ start, end, base, dots }` (exacte, sinon GridError). */
function writeNote(length, start, rhythm) {
  const list = toRhythmicDurationList(length, {
    isRest: false, start, timeSig: rhythm.timeSig, measureLength: rhythm.length, allowMeasureRest: false, offset: rhythm.offset, maxDots: 1,
  });
  const out = [];
  let t = start;
  for (const d of list) {
    const e = fAdd(t, durationValue(d));
    out.push({ start: t, end: e, base: d.base, dots: d.dots });
    t = e;
  }
  if (!fEq(t, fAdd(start, length))) throw new GridError('Durée non représentable');
  return out;
}

/**
 * Plan d'écriture d'UNE voix d'UNE mesure.
 *
 * @param {object} o
 * @param {Array<{start, end, cells: number, hits: number[]}>} o.beats  temps de la mesure : nombre de cases et cases frappées (indices triés)
 * @param {{timeSig: number[], length, offset}} o.rhythm
 * @returns {Array<object>} pièces à écrire, triées : `{ start, end, base, dots, rest, hit: {beat, cell} | null, tied, group }`
 *   - `rest` : silence d'un n-olet (les silences ordinaires ne figurent PAS dans le plan : le moteur les calcule) ;
 *   - `tied` : cette pièce prolonge la précédente (même frappe coupée en plusieurs valeurs) ;
 *   - `group` : `null` ou `{ key, ratio, base }` (n-olet ; `key` identique pour les pièces d'un même temps).
 */
export function planVoiceMeasure({ beats, rhythm }) {
  const out = [];
  beats.forEach((beat, b) => {
    const hits = [...new Set(beat.hits)].sort((x, y) => x - y);
    if (!hits.length) return;
    const length = fSub(beat.end, beat.start);
    const grid = beatGrid(length, beat.cells);
    for (const h of hits) if (!Number.isInteger(h) || h < 0 || h >= beat.cells) throw new GridError('Case hors du temps');
    if (!grid.tuplet || (hits.length === 1 && hits[0] === 0)) {
      // écriture ordinaire : la frappe dure jusqu'à la suivante, ou jusqu'à la fin du temps
      hits.forEach((h, i) => {
        const a = fAdd(beat.start, fMul(grid.cell, frac(h)));
        const z = i + 1 < hits.length ? fAdd(beat.start, fMul(grid.cell, frac(hits[i + 1]))) : beat.end;
        writeNote(fSub(z, a), a, rhythm).forEach((p, k) => out.push({ ...p, rest: false, hit: { beat: b, cell: h }, tied: k > 0, group: null }));
      });
      return;
    }
    // n-olet : les cases comptent en valeurs ÉCRITES (`written`), le temps réel s'obtient en multipliant par d/n
    const key = `${b}`;
    const group = { key, ratio: grid.ratio, base: grid.base };
    const toReal = frac(grid.d, grid.n);
    let writtenAt = ZERO; // longueur écrite déjà posée dans le groupe
    const push = (writtenLength, rest, hit) => {
      toDurationList(writtenLength, 1).forEach((d, k) => {
        const w = durationValue(d);
        const start = fAdd(beat.start, fMul(writtenAt, toReal));
        writtenAt = fAdd(writtenAt, w);
        const end = fAdd(beat.start, fMul(writtenAt, toReal));
        out.push({ start, end, base: d.base, dots: d.dots, rest, hit: rest ? null : hit, tied: !rest && k > 0, group });
      });
    };
    const cells = (j) => fMul(grid.written, frac(j));
    if (hits[0] > 0) push(cells(hits[0]), true, null);
    hits.forEach((h, i) => {
      const next = i + 1 < hits.length ? hits[i + 1] : grid.n;
      push(cells(next - h), false, { beat: b, cell: h });
    });
    if (!fEq(writtenAt, cells(grid.n))) throw new GridError('Durée non représentable dans le n-olet');
  });
  return out;
}

// ---------- écriture dans le Document ----------

/**
 * Écrit le plan d'une voix d'une mesure, À APPELER DANS `doc.transaction`.
 *
 * @param doc
 * @param {object} o
 * @param {object|string} o.staff
 * @param {number} o.voice
 * @param {number} o.measure           index de la mesure
 * @param {Array} o.plan               résultat de `planVoiceMeasure`
 * @param {(duration, hit) => object} o.makeChord  fabrique d'un accord NEUF pour la frappe `hit` (`{beat, cell}`)
 * @param {(hit) => object|null} [o.reuse]  accord EXISTANT qui reste tel quel pour cette frappe (même instant, mêmes notes) : il garde son
 *   identité (articulations, nuances…) ; sa durée, son n-olet et ses liaisons sont réécrits
 * @returns {{ chords: object[], ties: object[] }}
 */
export function applyVoiceMeasurePlan(doc, { staff, voice, measure, plan, makeChord, reuse = () => null }) {
  const groupIds = new Map();
  const tupletOf = (p) => {
    if (!p.group) return null;
    if (!groupIds.has(p.group.key)) groupIds.set(p.group.key, newId('tuplet'));
    return { id: groupIds.get(p.group.key), ratio: [...p.group.ratio], base: { ...p.group.base } };
  };
  const occupants = [];
  const chords = [];
  const pending = []; // éléments à compléter après leur ajout (n-olet) : { el, tuplet, reused }
  const used = new Set();
  let previous = null;
  const tiePairs = [];
  for (const p of plan) {
    let el;
    const tuplet = tupletOf(p);
    if (p.rest) {
      el = createRest({ duration: p.base, dots: p.dots, props: { [PID.TUPLET]: tuplet } });
      pending.push({ el, tuplet: null, reused: false });
    } else {
      const old = !p.tied ? reuse(p.hit) : null;
      if (old && !used.has(old.id)) {
        used.add(old.id);
        el = old;
        pending.push({ el, tuplet, reused: true, duration: { base: p.base, dots: p.dots } });
      } else {
        el = makeChord({ base: p.base, dots: p.dots }, p.hit);
        pending.push({ el, tuplet, reused: false });
      }
      chords.push(el);
      if (p.tied && previous) tiePairs.push([previous, el]);
      previous = el;
    }
    occupants.push({ el, start: p.start, end: p.end });
  }
  replaceVoiceMeasure(doc, { staff, voice, measure, occupants });
  for (const q of pending) {
    if (q.reused) {
      doc.set(q.el, PID.DURATION, q.duration);
      if (q.tuplet) doc.set(q.el, PID.TUPLET, q.tuplet);
      else if (getProperty(q.el, PID.TUPLET)) doc.reset(q.el, PID.TUPLET);
    } else if (q.tuplet) doc.set(q.el, PID.TUPLET, q.tuplet);
  }
  const st = typeof staff === 'string' ? doc.find(staff) : staff;
  const ties = [];
  for (const [a, b] of tiePairs) {
    const n = Math.min(a.notes.length, b.notes.length);
    for (let k = 0; k < n; k++) ties.push(createTie(a.notes[k].id, b.notes[k].id));
  }
  if (ties.length) doc.set(st, PID.TIES, [...getProperty(st, PID.TIES), ...ties]);
  return { chords, ties };
}
