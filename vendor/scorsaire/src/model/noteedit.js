/*
 * Gestes d'édition rythmique : poser une note ou un silence, supprimer un accord, en laissant TOUJOURS les mesures remplies.
 *
 * Opérations sur le Document, À APPELER DANS `doc.transaction(nom, () => placeChord(doc, …))`. Aucune dépendance au DOM ni à la
 * vue : l'interface (étape 5) ne fait que traduire un geste en un appel de ce module.
 *
 * Port de MuseScore 4.7.5 (lu, jamais deviné) : `Score::setNoteRest` (editing/cmd.cpp) pour la pose d'une note — découpe
 * rythmique de la durée (`toRhythmicDurationList`, voir `rhythmsplit.js`), liaison vers la mesure suivante quand elle déborde ;
 * `Score::makeGap` pour le trou fait dans les éléments existants (l'élément visé devient silence, les éléments suivants
 * recouverts sont retirés et le reste du dernier est conservé) ; `Score::setRests` pour les silences qui comblent un trou.
 *
 * RÈGLES SCORSAIRE (CLAUDE.md, « Silences automatiques — règles DÉCIDÉES ») :
 *   - un trou (intervalle de voix non couvert par un accord ou un silence `explicit: true`) est comblé par des silences
 *     AUTOMATIQUES (`explicit: false`) calculés par `rhythmsplit.js` ; on dissout puis on recalcule TOUT le trou : le résultat ne
 *     dépend que du contenu de la mesure, pas de l'historique des gestes. Un silence recalculé à l'identique GARDE son
 *     identifiant (les respirations ancrées sur lui ne sont pas perdues) ;
 *   - un silence posé à la main (`explicit: true`) reste, et borne les trous ;
 *   - un trou qui couvre la mesure entière (régulière) est un silence de mesure ;
 *   - un n-olet touché par un geste hors de lui est retiré en bloc (comme MuseScore `cmdDeleteTuplet`), ses parties hors du
 *     geste redeviennent des silences ordinaires.
 *
 * Écarts / limites (documentés, pas devinés) :
 *   - SORT DES RÉFÉRENCES (port de MuseScore 4.7.5 : `deleteItem`, `removeChordRest`, `makeGap` / `deleteSlursFromRange`, voir
 *     `reanchorReferences`) : ties, glissandos, bends, trémolos de couple disparaissent avec la note ; liaison d'expression,
 *     marteau/arraché et trille sont supprimés si l'accord de DÉPART disparaît et gardés (fin recollée sur le silence du même
 *     instant) si c'est celui de FIN ; soufflets et lignes de technique sont toujours gardés, bornes recollées au même instant.
 *     MuseScore ancre ses spanners par temps, Scorsaire par identité : une borne peut donc être un SILENCE. Respirations, capos,
 *     accordages et paroles restent supprimés avec leur ancre (écart non tranché) ; en pose par-dessus, trilles / soufflets /
 *     lignes dont une borne est recouverte sont recollés au même instant (MuseScore les raccourcit : approximation) ;
 *   - le reste d'un accord recouvert (hors élément visé) est conservé comme CLONE de même hauteur sans liaison (`addClone`) ;
 *   - un silence explicite coupé par le geste perd son caractère explicite pour sa partie restante ;
 *   - les durées ne sont écrites qu'à un seul niveau de n-olet ; la pose À L'INTÉRIEUR d'un n-olet est faite par
 *     `placeChordInTuplet` (même fichier) ; la création d'un n-olet est un autre geste ;
 *   - `RESTS_USE_BEAM_GROUPING` (groupement de ligatures du masterbar pour les silences) n'est pas porté.
 *
 * VOIX 2 À 4 (port de MuseScore 4.7.5 : `Score::setRests`, `setNoteRest`, `deleteItem`, `edit.cpp` ~560 / ~2936) :
 *   - une voix absente de la portée est créée à la première note (`ensureVoice`), ses mesures sont vides (aucun élément) ;
 *   - une note posée dans une mesure VIDE d'une voix > 1 à une position > 0 est précédée d'un silence « trou » (`gap`, invisible, muet,
 *     non sélectionnable) ; ce qui la suit est comblé par des silences visibles ; une voix qui ne contiendrait que des trous
 *     redevient vide (MuseScore ne pose pas de silence de mesure dans une voix vide non nulle) ;
 *   - supprimer un silence d'une voix > 1 en fait un trou ; un trou garde son statut tant qu'aucun élément ne le recouvre. Dans la voix 1
 *     un silence ne se supprime pas (il se recalcule) ;
 *   - `shortenOverlap` (percussion, `Score::handleOverlappingChordRest`) : un accord qui dépasse la position de la nouvelle note est raccourci
 *     (`changeCRlen`) au lieu de refuser le geste ; le reste de sa durée devient un trou comblé par des silences.
 */
import { PID } from './pid.js';
import { SID } from './sid.js';
import { getProperty } from './props.js';
import { isApplicable } from './schema.js';
import { createElement, createRest, createTie, createVoice, createMeasure } from './elements.js';
import { newId } from './ids.js';
import { walk } from './store.js';
import { STAFF_LIST_KINDS } from './listindex.js';
import { isRunEntry } from './glissando.js';
import { MEASURE_DURATION } from './pitch.js';
import {
  ZERO, fAdd, fSub, fCmp, fEq, fLt, fLe, fMin,
} from './fraction.js';
import {
  measureLengthOf, isIrregularMeasure, measureOffsetOf, itemDuration,
} from './timing.js';
import { toRhythmicDurationList, durationValue } from './rhythmsplit.js';

/** Geste impossible à cet endroit (position invalide, portée non prise en charge…). Le Document n'est pas modifié. */
export class EditError extends Error {}

const SEQUENTIAL_TYPES = new Set(['score', 'tab', 'percussion', 'rhythm', 'neutral', 'accordion-left']);

// ---------- contexte d'une mesure ----------

function staffEl(doc, staff) {
  const el = typeof staff === 'string' ? doc.find(staff) : staff;
  if (!el || el.type !== 'staff') throw new EditError('Portée introuvable');
  const parent = doc.parentOf(el.id);
  if (!parent || parent.type !== 'track') throw new EditError('Portée imbriquée dans un conteneur : non prise en charge');
  const type = getProperty(el, PID.STAFF_TYPE);
  if (!SEQUENTIAL_TYPES.has(type)) throw new EditError(`Portée « ${type} » : pas de contenu séquentiel`);
  return el;
}

/** Nombre maximal de voix d'une portée (MuseScore `VOICES`). */
export const MAX_VOICES = 4;

/** Crée les voix manquantes jusqu'à `voiceIndex` (mesures vides, une par masterbar) : `Score::expandVoice` ne crée pas les silences, `setRests` les pose. */
export function ensureVoice(doc, staff, voiceIndex) {
  if (!Number.isInteger(voiceIndex) || voiceIndex < 0 || voiceIndex >= MAX_VOICES) throw new EditError('Voix inexistante (1 à 4)');
  const movement = doc.movementOf(staff);
  while (staff.voices.length <= voiceIndex) {
    const voice = createVoice(movement.masterbars.map(() => createMeasure([])));
    doc.add(staff, 'voices', voice);
  }
}

function measureContext(doc, staff, voiceIndex, mi) {
  const movement = doc.movementOf(staff);
  const masterbar = movement.masterbars[mi];
  const voice = staff.voices[voiceIndex];
  if (!masterbar || !voice) throw new EditError('Mesure ou voix inexistante');
  const measure = voice.measures[mi];
  const length = measureLengthOf(masterbar);
  return {
    doc,
    staff,
    movement,
    voiceIndex,
    mi,
    measure,
    masterbar,
    length,
    timeSig: getProperty(masterbar, PID.TIME_SIG),
    offset: measureOffsetOf(masterbar, mi === 0),
    irregular: isIrregularMeasure(masterbar),
    halfRest: doc.getStyle(movement, SID.RESTS_HALF_IN_THREE_FOUR),
    count: movement.masterbars.length,
  };
}

const tupletOf = (item) => (isApplicable(item.type, PID.TUPLET) ? getProperty(item, PID.TUPLET) : null);
const isRest = (item) => item.type === 'rest';
const isChord = (item) => item.type === 'chord';
const isExplicitRest = (item) => isRest(item) && getProperty(item, PID.EXPLICIT) === true;

/** Éléments de la mesure avec leur début et leur fin, en fractions de ronde depuis le début du contenu de la mesure. */
export function measureTimeline(measure, length) {
  const out = [];
  let t = ZERO;
  for (const item of measure.items) {
    const end = fAdd(t, itemDuration(item, length));
    out.push({ item, start: t, end });
    t = end;
  }
  return out;
}

// ---------- silences ----------

/** Silences automatiques qui comblent [start, end[ : liste `{ start, end, base, dots }`. */
function restSpecs(ctx, start, end, gap = false) {
  const list = toRhythmicDurationList(fSub(end, start), {
    isRest: true,
    start,
    timeSig: ctx.timeSig,
    measureLength: ctx.length,
    allowMeasureRest: !ctx.irregular && !gap,
    offset: ctx.offset,
    maxDots: 1,
    halfRestInThreeFour: ctx.halfRest,
  });
  const out = [];
  let t = start;
  for (const d of list) {
    const e = d.base === MEASURE_DURATION ? ctx.length : fAdd(t, durationValue(d));
    out.push({ start: t, end: e, base: d.base, dots: d.dots });
    t = e;
  }
  return out;
}

// ---------- clonage ----------

const idPrefix = (id) => String(id).replace(/[0-9]+$/, '') || 'e';

/** Propriétés copiées avec de NOUVEAUX identifiants pour les entrées de liste (doigtés, articulations…). */
function freshProps(props) {
  const out = {};
  for (const [pid, value] of Object.entries(props)) {
    if (Array.isArray(value) && value.some((e) => e && typeof e === 'object' && typeof e.id === 'string')) {
      out[pid] = value.map((e) => (e && typeof e === 'object' && typeof e.id === 'string' ? { ...e, id: newId(idPrefix(e.id)) } : e));
    } else out[pid] = value;
  }
  return out;
}

/** Copie d'un accord avec une autre durée écrite (`addClone`) : mêmes notes (nouveaux identifiants), sans ornements. */
export function cloneChord(chord, duration, { only = null, omit = [] } = {}) {
  // `only`: indices of the notes to copy (all by default); `omit`: chord properties not to copy
  const notes = chord.notes.filter((_, i) => !only || only.has(i)).map((n) => createElement(n.type, { props: freshProps(n.props) }));
  const props = { ...freshProps(chord.props), [PID.DURATION]: { base: duration.base, dots: duration.dots } };
  for (const pid of omit) delete props[pid];
  return createElement('chord', { props, children: { notes } });
}

// ---------- références ----------

const REF_FIELDS = ['startChordId', 'endChordId', 'startNoteId', 'endNoteId', 'itemId', 'afterId', 'chordId'];

/**
 * Listes de la portée dont les bornes sont des ACCORDS et qui SURVIVENT à la suppression d'une borne, comme les spanners de
 * MuseScore (ancrés par temps, `Spanner::computeStartElement` / `computeEndElement` retrouvent l'élément du même instant, qui est
 * alors le silence posé à la place) :
 *   - liaison d'expression, marteau/arraché, trille (`isSlur()` / `TRILL`) : supprimés si l'accord de DÉPART est supprimé
 *     (`Score::deleteItem` / `removeChordRest` ne retire que les spanners qui COMMENCENT là), conservés si c'est l'accord de FIN ;
 *   - soufflet, ligne de technique : toujours conservés (jamais supprimés par la suppression d'une note).
 * En pose par-dessus (`Score::makeGap`), `deleteSlursFromRange` retire en plus toute liaison dont le début OU la fin tombe dans la
 * zone recouverte hors élément visé.
 * Les ties, glissandos, bends, trémolos de couple disparaissent avec la note (ou l'accord) ; respirations, capos, accordages et
 * paroles restent supprimés avec leur ancre (non repris de MuseScore, voir l'en-tête).
 */
const SLUR_LIKE = new Set([PID.SLURS, PID.HOPOS]);
const DIES_WITH_START = new Set([PID.SLURS, PID.HOPOS, PID.TRILLS]);
const KEPT_RANGES = new Set([PID.SLURS, PID.HOPOS, PID.TRILLS, PID.HAIRPINS, PID.TECH_LINES]);

/**
 * Instant (voix, mesure, début) de chaque élément retiré, à relever AVANT la modification : id → { chord, voice, mi, start }.
 * Les descendants (notes, ornements) portent l'instant de leur accord.
 */
function recordInstants(ctx, items) {
  const before = new Map();
  if (!items.length) return before;
  for (const u of measureTimeline(ctx.measure, ctx.length)) {
    if (!items.includes(u.item)) continue;
    walk(u.item, (e) => {
      before.set(e.id, { chord: e.type === 'chord', voice: ctx.voiceIndex, mi: ctx.mi, start: u.start });
    });
  }
  return before;
}

/**
 * Applique le sort des références après la modification de la mesure (les nouveaux éléments sont déjà en place) :
 * retire les entrées qui visent un élément disparu sans pouvoir survivre, recolle les autres sur l'élément qui couvre le même
 * instant (accord posé à la place, silence). `targetId` = élément visé par une pose, remplacé à son instant : ses références
 * suivent le nouvel accord. `mode` : 'delete' (suppression) ou 'overwrite' (pose par-dessus).
 */
function reanchorReferences(ctx, before, { mode = 'delete', targetId = null } = {}) {
  if (!before.size) return;
  const { doc, staff } = ctx;
  const timeline = measureTimeline(ctx.measure, ctx.length);
  const coverOf = (rec) => {
    const exact = timeline.find((u) => fEq(u.start, rec.start));
    const u = exact ?? timeline.find((u2) => fLe(u2.start, rec.start) && fLt(rec.start, u2.end));
    return u ? u.item.id : null;
  };
  // un accord disparu (hors élément visé, dont l'instant est repris) : sa disparition peut tuer l'entrée
  const lost = (id) => {
    const rec = before.get(id);
    return rec && rec.chord && id !== targetId ? rec : null;
  };
  for (const [pid] of STAFF_LIST_KINDS) {
    const list = getProperty(staff, pid);
    if (!Array.isArray(list) || !list.length) continue;
    const kept = [];
    for (const entry of list) {
      const touched = REF_FIELDS.some((f) => entry[f] !== undefined && before.has(entry[f]));
      if (!touched) { kept.push(entry); continue; }
      if (!KEPT_RANGES.has(pid)) continue; // disparaît avec son ancre
      const s = entry.startChordId;
      const e = entry.endChordId;
      if (DIES_WITH_START.has(pid) && lost(s)) continue;
      if (SLUR_LIKE.has(pid) && mode === 'overwrite' && lost(e)) continue;
      const next = { ...entry };
      let ok = true;
      for (const [field, id] of [['startChordId', s], ['endChordId', e]]) {
        const rec = before.get(id);
        if (!rec) continue;
        const cover = coverOf(rec);
        if (cover === null) { ok = false; break; }
        next[field] = cover;
      }
      if (!ok) continue;
      if (s !== e && next.startChordId === next.endChordId) continue; // bornes réduites à un même élément : plus d'étendue
      kept.push(next);
    }
    if (kept.length !== list.length || kept.some((k, i) => k !== list[i])) doc.set(staff, pid, kept);
  }
}

/** Retire des listes de la portée les entrées qui visent un élément retiré (notes seules : une note ôtée d'un accord conservé). */
export function purgeReferences(doc, staff, removed) {
  const ids = new Set();
  for (const el of removed) walk(el, (e) => ids.add(e.id));
  if (!ids.size) return;
  for (const [pid] of STAFF_LIST_KINDS) {
    const list = getProperty(staff, pid);
    if (!Array.isArray(list) || !list.length) continue;
    const kept = list.filter((entry) => !REF_FIELDS.some((f) => entry[f] !== undefined && ids.has(entry[f])));
    if (kept.length !== list.length) {
      doc.set(staff, pid, kept);
      if (pid === PID.GLISSANDOS) dropRunOrnaments(doc, list.filter((e) => !kept.includes(e)), ids);
    }
  }
}

/**
 * A glissando run (grace note + entry) lives and dies with its ARRIVAL note: when the arrival note is removed but the chord stays (a note taken out of
 * a chord), the ornament that was the start of the run is removed too. `entries` = the entries just dropped, `ids` = the removed ids.
 */
function dropRunOrnaments(doc, entries, ids) {
  for (const e of entries) {
    if (!isRunEntry(e) || ids.has(e.startNoteId)) continue; // not a run, or its ornament is already gone with the removed element
    const note = doc.find(e.startNoteId);
    const grace = note ? doc.parentOf(note.id) : null;
    const chord = grace && (grace.el ?? grace);
    if (!chord || chord.type !== 'chord') continue;
    doc.remove(chord.notes.length > 1 ? note : chord);
  }
}

// ---------- application d'une disposition ----------

/**
 * Remplace le contenu de la mesure par `layout` (liste ordonnée d'éléments : existants, qui gardent leur identité, ou nouveaux).
 * Les éléments retirés disparaissent avec leur sous-arbre ; le sort des entrées de liste qui les visent est réglé par
 * `reanchorReferences` (comme MuseScore : voir plus haut).
 */
function applyLayout(ctx, layout, { mode = 'delete', targetId = null } = {}) {
  const { doc, measure } = ctx;
  const keep = new Set(layout.map((e) => e.id));
  const removed = measure.items.filter((item) => !keep.has(item.id));
  const before = recordInstants(ctx, removed);
  for (const item of removed) doc.remove(item);
  layout.forEach((el, i) => {
    if (measure.items[i] === el) return;
    doc.add(measure, 'items', el, i);
  });
  reanchorReferences(ctx, before, { mode, targetId });
  return removed;
}

// ---------- trous ----------

/**
 * Construit la disposition complète d'une mesure à partir d'« occupants » (éléments à garder : accords, silences explicites, n-olets
 * intacts, nouveaux accords…) triés par début : tout l'espace non couvert est un trou, comblé par des silences automatiques.
 * `reusable` : silences retirés, réutilisés à l'identique quand un silence recalculé a les mêmes bornes et la même valeur.
 */
function buildLayout(ctx, occupants, reusable, extraGaps = []) {
  const keyOf = (a, b, base, dots, gap) => `${a[0]}/${a[1]}|${b[0]}/${b[1]}|${base}|${dots}|${gap ? 'g' : ''}`;
  const pool = new Map();
  // intervalles « trou » : silences trou existants (dissous puis recalculés) + intervalles demandés par le geste
  const gaps = ctx.voiceIndex > 0 ? [...extraGaps] : [];
  for (const u of reusable) {
    if (!isRest(u.item) || isExplicitRest(u.item) || tupletOf(u.item)) continue;
    const d = getProperty(u.item, PID.DURATION);
    const gap = getProperty(u.item, PID.GAP) === true;
    if (gap && ctx.voiceIndex > 0) gaps.push([u.start, u.end]);
    pool.set(keyOf(u.start, u.end, d.base, d.dots ?? 0, gap), u.item);
  }
  const inGap = (a, b) => gaps.some(([x, y]) => fLe(x, a) && fLe(b, y));
  const sorted = [...occupants].sort((a, b) => fCmp(a.start, b.start));
  const layout = [];
  let t = ZERO;
  const fill = (from, to) => {
    // coupe le trou aux bornes des intervalles « trou » qui le traversent
    const cuts = [from, to];
    for (const [x, y] of gaps) for (const c of [x, y]) if (fLt(from, c) && fLt(c, to)) cuts.push(c);
    cuts.sort(fCmp);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k];
      const b = cuts[k + 1];
      if (fEq(a, b)) continue;
      const gap = inGap(a, b);
      for (const r of restSpecs(ctx, a, b, gap)) {
        const key = keyOf(r.start, r.end, r.base, r.dots, gap);
        const old = pool.get(key);
        if (old) { pool.delete(key); layout.push(old); } else layout.push(createRest({ duration: r.base, dots: r.dots, gap }));
      }
    }
  };
  for (const o of sorted) {
    if (fLt(t, o.start)) fill(t, o.start);
    if (fLt(o.start, t)) throw new EditError('Éléments qui se chevauchent');
    layout.push(o.el ?? o.item);
    t = o.end;
  }
  if (fLt(t, ctx.length)) fill(t, ctx.length);
  // voix > 1 qui ne contient que des trous : vide (pas de silence de mesure dans une voix vide non nulle)
  if (layout.length && layout.every((e) => e.type === 'rest' && getProperty(e, PID.GAP) === true)) return [];
  return layout;
}

/** Éléments de la mesure à garder tels quels (hors n-olets et silences automatiques, qui se recalculent). */
function keptUnits(timeline) {
  return timeline.filter((u) => !(isRest(u.item) && !isExplicitRest(u.item) && !tupletOf(u.item)));
}

/** Groupes de n-olet de la mesure : `{ id, start, end, members: [unité…] }` (membres contigus de même identifiant). */
function tupletGroups(timeline) {
  const groups = [];
  for (const u of timeline) {
    const t = tupletOf(u.item);
    if (!t) continue;
    const last = groups[groups.length - 1];
    if (last && last.id === t.id) { last.members.push(u); last.end = u.end; } else groups.push({ id: t.id, start: u.start, end: u.end, members: [u] });
  }
  return groups;
}

// ---------- pose d'une durée dans UNE mesure ----------

/**
 * Pose, dans une mesure, des accords neufs couvrant [a, b[ (déjà découpés par l'appelant) et ajuste le reste.
 * @param pieces  [{ el, start, end }] accords neufs, triés, qui couvrent exactement [a, b[
 * @param target  unité de la timeline qui commence en `a` (l'élément visé), ou null
 */
function overwriteRange(ctx, timeline, a, b, pieces, { target = null, gaps = [] } = {}) {
  const groups = tupletGroups(timeline);
  const touched = new Set(); // unités retirées
  const tails = []; // restes d'accords conservés (clones)

  // les groupes de n-olet touchés sont retirés en bloc
  const groupOf = new Map();
  for (const g of groups) for (const m of g.members) groupOf.set(m.item.id, g);
  const removedGroups = new Set();

  for (const u of timeline) {
    if (fLe(u.end, a) || fLe(b, u.start)) continue; // hors du trou
    const g = groupOf.get(u.item.id);
    if (g) {
      if (!removedGroups.has(g.id)) {
        removedGroups.add(g.id);
        for (const m of g.members) touched.add(m);
      }
      continue;
    }
    touched.add(u);
    // reste d'un accord (hors élément visé) au-delà du trou : conservé en clone, comme MuseScore (`addClone`)
    if (isChord(u.item) && fLt(b, u.end) && !(target && u.item === target.item)) {
      const pieces2 = toRhythmicDurationList(fSub(u.end, b), {
        isRest: true, start: b, timeSig: ctx.timeSig, measureLength: ctx.length, allowMeasureRest: false, offset: ctx.offset, maxDots: 0,
      });
      let t = b;
      for (const d of pieces2) {
        const e = fAdd(t, durationValue(d));
        tails.push({ el: cloneChord(u.item, d), start: t, end: e });
        t = e;
      }
    }
  }

  const occupants = [];
  for (const u of keptUnits(timeline)) if (!touched.has(u)) occupants.push(u);
  // les silences automatiques non touchés se dissolvent : ils sont réutilisables
  const reusable = timeline.filter((u) => isRest(u.item) && !isExplicitRest(u.item) && !tupletOf(u.item));
  for (const p of pieces) occupants.push(p);
  for (const t of tails) occupants.push(t);
  // n-olets non touchés : ils restent, ce sont des unités gardées (membres compris)
  const layout = buildLayout(ctx, occupants, reusable, gaps);
  const removed = applyLayout(ctx, layout, { mode: 'overwrite', targetId: target ? target.item.id : null });
  return { removed, layout };
}

// ---------- API : poser un accord ----------

/**
 * Fabrique de l'accord pour une durée donnée : appelée une fois par morceau (plusieurs si la durée est coupée), elle renvoie
 * un accord NEUF (identifiants neufs) dont les notes ont toujours le même ordre — les liaisons relient la note k d'un morceau
 * à la note k du suivant.
 * @callback ChordFactory
 * @param {{base: string, dots: number}} duration
 * @returns {object} accord (`createNoteChord`, `createChord` + `createTabNote`…)
 */

/**
 * Pose un accord à une position d'une voix.
 *
 * @param doc
 * @param {object} o
 * @param {object|string} o.staff    portée (ou son identifiant)
 * @param {number} [o.voice=0]       index de voix
 * @param {number} o.measure         index de la mesure dans le mouvement
 * @param {Array}  o.position        début, en fraction de ronde depuis le début du contenu de la mesure
 * @param {object} o.duration        durée ÉCRITE choisie `{ base, dots }`
 * @param {Array}  [o.total]         durée totale (fraction) quand elle n'est pas une valeur écrite : coupée en valeurs écrites et liée (enregistrement)
 * @param {ChordFactory} o.makeChord
 * @returns {{ chords: object[], ties: object[], clipped: boolean }} accords posés (dans l'ordre), liaisons créées
 */
export function placeChord(doc, { staff, voice = 0, measure, position, duration, total: wholeDuration = null, makeChord, shortenOverlap = false }) {
  const st = staffEl(doc, staff);
  ensureVoice(doc, st, voice);
  let total = wholeDuration ?? durationValue(duration); // `total` (a fraction, not a single written value) is cut into written values and tied across barlines
  const chords = [];
  const ties = [];
  let clipped = false;
  let mi = measure;
  let pos = position;
  let previous = null; // dernier accord posé (pour la liaison)

  while (fLt(ZERO, total)) {
    if (mi >= st.voices[voice].measures.length) { clipped = true; break; }
    const ctx = measureContext(doc, st, voice, mi);
    const timeline = measureTimeline(ctx.measure, ctx.length);
    if (!fLt(pos, ctx.length)) throw new EditError('Position hors de la mesure');
    const room = fSub(ctx.length, pos);
    const piece = fMin(total, room);

    const target = timeline.find((u) => fLe(u.start, pos) && fLt(pos, u.end)) ?? null;
    const inside = target && isChord(target.item) && !fEq(target.start, pos);
    if (inside && !(shortenOverlap && mi === measure)) throw new EditError("Position à l'intérieur d'un accord");

    const list = toRhythmicDurationList(piece, {
      isRest: false, start: pos, timeSig: ctx.timeSig, measureLength: ctx.length, allowMeasureRest: false, offset: ctx.offset, maxDots: 1,
    });
    if (!list.length) throw new EditError('Durée non représentable');

    const pieces = [];
    let t = pos;
    for (const d of list) {
      const e = fAdd(t, durationValue(d));
      pieces.push({ el: makeChord(d), start: t, end: e });
      t = e;
    }
    // l'accord visé est d'abord remplacé par un silence (`setNoteRest`) : son reste ne sera pas conservé comme accord
    if (inside) {
      // percussion : l'accord qui déborde est raccourci jusqu'à la nouvelle note (`handleOverlappingChordRest`, `changeCRlen`)
      const head = shortenChord(ctx, target, pos);
      overwriteRange(ctx, timeline, target.start, t, [...head.pieces, ...pieces], { target });
      ties.push(...head.ties);
    } else {
      // voix > 1 absente de la mesure : le début est un trou (`Score::setRests`, silences « trou » avant la première note)
      const leading = voice > 0 && ctx.measure.items.length === 0 && fLt(ZERO, pos) ? [[ZERO, pos]] : [];
      overwriteRange(ctx, timeline, pos, t, pieces, { target, gaps: leading });
    }

    for (const p of pieces) {
      if (previous) ties.push(...tieChords(doc, st, previous, p.el));
      chords.push(p.el);
      previous = p.el;
    }
    total = fSub(total, piece);
    pos = ZERO;
    mi += 1;
  }
  return { chords, ties, clipped };
}

/**
 * Découpe une durée (fraction) posée en `pos` dans la mesure d'indice `mi` en durées ÉCRITES, comme `placeChord` / `placeRest`
 * (accord : points simples ; silence : sans point). Sert au collage, qui coupe les éléments copiés aux barres de la destination.
 * @returns {{base: string, dots: number}[]}
 */
export function durationPieces(doc, staff, voice, mi, pos, piece, { isRest: rest = false } = {}) {
  const st = staffEl(doc, staff);
  ensureVoice(doc, st, voice);
  const ctx = measureContext(doc, st, voice, mi);
  const list = toRhythmicDurationList(piece, {
    isRest: rest, start: pos, timeSig: ctx.timeSig, measureLength: ctx.length, allowMeasureRest: false, offset: ctx.offset, maxDots: rest ? 0 : 1,
  });
  if (!list.length) throw new EditError('Durée non représentable');
  return list;
}

/**
 * Pose des éléments TOUT FAITS (accords, silences, membres de n-olet) dans [start, end[ d'une mesure d'une voix, comme `Score::makeGap` +
 * `pasteChordRest` de MuseScore : ce qui occupait la zone disparaît (les n-olets touchés en bloc), le reste d'un accord qui dépasse la
 * fin est conservé (clone), un accord qui commençait avant `start` est raccourci ; tout trou est comblé par des silences automatiques.
 * @param {{ el: object, start: Array, end: Array }[]} o.pieces  triés, dans [start, end[
 * @returns {{ ties: object[] }} liaisons créées pour raccourcir un accord
 */
export function placePieces(doc, { staff, voice = 0, measure, start, end, pieces }) {
  const st = staffEl(doc, staff);
  ensureVoice(doc, st, voice);
  const ctx = measureContext(doc, st, voice, measure);
  const timeline = measureTimeline(ctx.measure, ctx.length);
  const target = timeline.find((u) => fLe(u.start, start) && fLt(start, u.end)) ?? null;
  const inside = target && isChord(target.item) && !fEq(target.start, start);
  if (inside) {
    const head = shortenChord(ctx, target, start);
    overwriteRange(ctx, timeline, target.start, end, [...head.pieces, ...pieces]);
    return { ties: head.ties };
  }
  const leading = voice > 0 && ctx.measure.items.length === 0 && fLt(ZERO, start) ? [[ZERO, start]] : [];
  overwriteRange(ctx, timeline, start, end, pieces, { gaps: leading });
  return { ties: [] };
}

/**
 * Pose un accord À LA PLACE d'un membre (silence ou accord) d'un n-olet : même durée écrite, même n-olet. La durée ne se choisit pas ici
 * (elle est celle du membre) ; couper un membre en plus petits n'est pas pris en charge.
 * @returns l'accord posé
 */
export function placeChordInTuplet(doc, { item, makeChord }) {
  const target = typeof item === 'string' ? doc.find(item) : item;
  if (!target || !(isRest(target) || isChord(target))) throw new EditError('Membre de n-olet attendu');
  const tuplet = tupletOf(target);
  if (!tuplet) throw new EditError("Pas dans un n-olet : utiliser placeChord");
  const measure = doc.parentOf(target.id);
  const staff = staffOfItem(doc, target);
  staffEl(doc, staff);
  const duration = getProperty(target, PID.DURATION);
  const chord = makeChord({ base: duration.base, dots: duration.dots ?? 0 });
  const at = measure.items.indexOf(target);
  const ctx = contextOfItem(doc, target);
  const before = recordInstants(ctx, [target]);
  doc.remove(target);
  doc.add(measure, 'items', chord, at);
  doc.set(chord, PID.TUPLET, tuplet);
  reanchorReferences(ctx, before, { mode: 'overwrite', targetId: target.id });
  return chord;
}

/**
 * Raccourcit un accord (non membre d'un n-olet) pour qu'il finisse en `pos` : sa durée écrite est découpée comme une pose ordinaire ; le
 * 1er morceau reste l'accord d'origine (même identité), les suivants sont des clones liés. Les liaisons qui PARTAIENT de l'accord sont
 * retirées (elles visaient ce qui suivait l'ancienne fin). Retourne `{ pieces, ties }` pour `overwriteRange`.
 */
function shortenChord(ctx, unit, pos) {
  const { doc, staff } = ctx;
  const chord = unit.item;
  if (tupletOf(chord)) throw new EditError("Raccourcir un accord de n-olet n'est pas pris en charge");
  const list = toRhythmicDurationList(fSub(pos, unit.start), {
    isRest: false, start: unit.start, timeSig: ctx.timeSig, measureLength: ctx.length, allowMeasureRest: false, offset: ctx.offset, maxDots: 1,
  });
  if (!list.length) throw new EditError('Durée non représentable');
  const own = new Set(chord.notes.map((n) => n.id));
  const ties = getProperty(staff, PID.TIES);
  if (ties.some((x) => own.has(x.startNoteId))) doc.set(staff, PID.TIES, ties.filter((x) => !own.has(x.startNoteId)));
  const pieces = [];
  const created = [];
  let t = unit.start;
  list.forEach((d, k) => {
    const e = fAdd(t, durationValue(d));
    let el = chord;
    if (k === 0) doc.set(chord, PID.DURATION, { base: d.base, dots: d.dots });
    else { el = cloneChord(chord, d); created.push(el); }
    pieces.push({ el, start: t, end: e });
    t = e;
  });
  const tiesOut = [];
  for (let k = 1; k < pieces.length; k++) tiesOut.push(...tieChords(doc, staff, pieces[k - 1].el, pieces[k].el));
  return { pieces, ties: tiesOut };
}

/** Lie chaque note de `a` à la note de même rang de `b` (prolongation). */
export function tieChords(doc, staff, a, b) {
  const entries = [];
  const n = Math.min(a.notes.length, b.notes.length);
  for (let k = 0; k < n; k++) entries.push(createTie(a.notes[k].id, b.notes[k].id));
  if (entries.length) doc.set(staff, PID.TIES, [...getProperty(staff, PID.TIES), ...entries]);
  return entries;
}

// ---------- API : supprimer, silence explicite ----------

/**
 * Supprime un accord (ou un silence explicite) : l'espace redevient un trou comblé par des silences automatiques.
 * Les accords d'un n-olet intact sont remplacés par un silence de la même durée dans le même n-olet (le groupe reste) ; si tout le
 * groupe devient silence, il est remplacé par des silences ordinaires.
 */
export function deleteItem(doc, itemOrId) {
  const item = typeof itemOrId === 'string' ? doc.find(itemOrId) : itemOrId;
  if (!item || (!isChord(item) && !isRest(item))) throw new EditError('Accord ou silence attendu');
  const measure = doc.parentOf(item.id);
  const voice = doc.parentOf(measure.id);
  const staff = doc.parentOf(voice.id);
  const st = staffEl(doc, staff);
  const voiceIndex = st.voices.indexOf(voice);
  const mi = voice.measures.indexOf(measure);
  const ctx = measureContext(doc, st, voiceIndex, mi);
  const timeline = measureTimeline(ctx.measure, ctx.length);
  const u = timeline.find((x) => x.item === item);
  const groups = tupletGroups(timeline);
  const g = groups.find((gr) => gr.members.includes(u));
  if (g) return deleteInTuplet(ctx, timeline, g, u);
  const occupants = keptUnits(timeline).filter((x) => x !== u);
  const reusable = timeline.filter((x) => isRest(x.item) && !isExplicitRest(x.item) && !tupletOf(x.item));
  // voix > 1 : supprimer un silence en fait un trou invisible (`Score::deleteItem`, silence d'une voix non nulle → `setGap`) ; voix 1 : il se recalcule
  const gaps = isRest(item) && voiceIndex > 0 ? [[u.start, u.end]] : [];
  const layout = buildLayout(ctx, occupants, reusable, gaps);
  applyLayout(ctx, layout);
  return layout;
}

function deleteInTuplet(ctx, timeline, group, unit) {
  // le membre est remplacé par un silence du même n-olet et de la même durée écrite ; s'il ne reste plus aucun accord dans le
  // groupe, le groupe entier devient des silences ordinaires
  const others = group.members.filter((m) => m !== unit && isChord(m.item));
  const doc = ctx.doc;
  if (!others.length) {
    const occupants = keptUnits(timeline).filter((x) => !group.members.includes(x));
    const reusable = timeline.filter((x) => isRest(x.item) && !isExplicitRest(x.item) && !tupletOf(x.item));
    const layout = buildLayout(ctx, occupants, reusable);
    applyLayout(ctx, layout);
    return layout;
  }
  if (!isChord(unit.item)) return null; // un silence d'un n-olet reste : il comble déjà le groupe
  const duration = getProperty(unit.item, PID.DURATION);
  const rest = createRest({ duration: duration.base, dots: duration.dots ?? 0, props: { [PID.TUPLET]: getProperty(unit.item, PID.TUPLET) } });
  const at = ctx.measure.items.indexOf(unit.item);
  const before = recordInstants(ctx, [unit.item]);
  doc.remove(unit.item);
  doc.add(ctx.measure, 'items', rest, at);
  reanchorReferences(ctx, before, { mode: 'delete' });
  return [rest];
}

/**
 * Pose un silence explicite (`explicit: true`) de la durée écrite donnée, qui recouvre ce qui s'y trouve. Il reste figé jusqu'à
 * suppression et borne les silences automatiques voisins.
 */
export function placeRest(doc, { staff, voice = 0, measure, position, duration }) {
  const st = staffEl(doc, staff);
  ensureVoice(doc, st, voice);
  const ctx = measureContext(doc, st, voice, measure);
  const timeline = measureTimeline(ctx.measure, ctx.length);
  const end = fAdd(position, durationValue(duration));
  if (fLt(ctx.length, end)) throw new EditError('Un silence explicite ne déborde pas de la mesure');
  const rest = createRest({ duration: duration.base, dots: duration.dots ?? 0, explicit: true });
  const target = timeline.find((u) => fLe(u.start, position) && fLt(position, u.end)) ?? null;
  const leading = voice > 0 && ctx.measure.items.length === 0 && fLt(ZERO, position) ? [[ZERO, position]] : [];
  overwriteRange(ctx, timeline, position, end, [{ el: rest, start: position, end }], { target, gaps: leading });
  return rest;
}

/** Ajoute une note à un accord existant (même instant, même durée). La validité (corde / son déjà pris…) est vérifiée par la transaction. */
export function addNoteToChord(doc, chordOrId, note) {
  const chord = typeof chordOrId === 'string' ? doc.find(chordOrId) : chordOrId;
  if (!chord || !isChord(chord)) throw new EditError('Accord attendu');
  doc.add(chord, 'notes', note);
  return note;
}

/** Retire une note d'un accord ; si c'était la dernière, l'accord est supprimé (silences automatiques). */
export function removeNoteFromChord(doc, noteOrId) {
  const note = typeof noteOrId === 'string' ? doc.find(noteOrId) : noteOrId;
  const chord = note && doc.parentOf(note.id);
  if (!chord || !isChord(chord)) throw new EditError('Note attendue');
  if (chord.notes.length > 1) {
    doc.remove(note);
    purgeReferences(doc, staffOfItem(doc, chord), [note]);
    return null;
  }
  return deleteItem(doc, chord);
}

/**
 * Remplace TOUT le contenu d'une voix d'une mesure par `occupants` (`[{ el, start, end }]`, éléments neufs ou existants qui gardent leur
 * identité) : tout ce qui n'est pas couvert est comblé par des silences automatiques. Les silences explicites et les éléments absents de
 * `occupants` disparaissent (références réglées comme une suppression). Voix 2-4 : le début vide d'une mesure vide est un trou ; sans
 * occupant la mesure redevient vide. Sert à la saisie sur grille (`gridedit.js`).
 */
export function replaceVoiceMeasure(doc, { staff, voice = 0, measure, occupants }) {
  const st = staffEl(doc, staff);
  ensureVoice(doc, st, voice);
  const ctx = measureContext(doc, st, voice, measure);
  const timeline = measureTimeline(ctx.measure, ctx.length);
  const sorted = [...occupants].sort((a, b) => fCmp(a.start, b.start));
  const reusable = timeline.filter((x) => isRest(x.item) && !isExplicitRest(x.item) && !tupletOf(x.item));
  let layout;
  if (voice > 0 && !sorted.length) layout = [];
  else {
    const leading = voice > 0 && ctx.measure.items.length === 0 && fLt(ZERO, sorted[0].start) ? [[ZERO, sorted[0].start]] : [];
    layout = buildLayout(ctx, sorted, reusable, leading);
  }
  return applyLayout(ctx, layout);
}

/** Contexte de mesure de l'accord ou du silence `item`. */
function contextOfItem(doc, item) {
  const measure = doc.parentOf(item.id);
  const voice = doc.parentOf(measure.id);
  const st = staffEl(doc, doc.parentOf(voice.id));
  return measureContext(doc, st, st.voices.indexOf(voice), voice.measures.indexOf(measure));
}

function staffOfItem(doc, item) {
  const measure = doc.parentOf(item.id);
  const voice = doc.parentOf(measure.id);
  return doc.parentOf(voice.id);
}

/**
 * Recalcule tous les silences automatiques d'une mesure (commande « recalculer les silences automatiques » après un changement
 * d'option). Les silences explicites et les accords ne bougent pas.
 */
export function recomputeAutoRests(doc, { staff, voice = 0, measure }) {
  const st = staffEl(doc, staff);
  const ctx = measureContext(doc, st, voice, measure);
  const timeline = measureTimeline(ctx.measure, ctx.length);
  const occupants = keptUnits(timeline);
  const reusable = timeline.filter((x) => isRest(x.item) && !isExplicitRest(x.item) && !tupletOf(x.item));
  const layout = buildLayout(ctx, occupants, reusable);
  return applyLayout(ctx, layout);
}
