/*
 * Capo (tranche 4e) — port de `Capo`, `CapoParams`, `Staff::capo/insertCapoParams/removeCapoParams`, `StringData::pitchOffsetAt/fret/getPitch/convertPitch`,
 * `Note::ottaveCapoFret` et `EditCapo` (MuseScore v4.7.5 ; comportement des modes vérifié dans `tests/capo_tests.cpp`).
 *
 * Modèle : `PID.CAPOS` (portée) = liste datée d'entrées `{ id, itemId, fret, ignoredStrings, active, mode, text? }`, ancrées par IDENTITÉ d'un accord ou
 * d'un silence ; un capo vaut jusqu'au suivant de la portée (avant le premier : AUCUN capo, `NO_CAPO`). Numéros de cordes : 1 = la plus aiguë (comme
 * `PID.STRING`), alors que MuseScore compte à partir de 0.
 *
 * Relation hauteur ↔ frette (la frette d'une note de tablature est DÉRIVÉE : `frette = hauteur stockée − corde à vide − K`) :
 *   - `K` = position du capo si le capo est actif, que son mode n'est PAS « playback » et que la corde n'est pas ignorée ; sinon 0
 *     (`StringData::pitchOffsetAt(staff, tick, string)`).
 *   - hauteur SONNANTE = hauteur stockée + position du capo seulement en mode « playback » (corde non ignorée) (`Note::ottaveCapoFret`).
 * Donc : « playback » = frettes et hauteurs écrites inchangées, seul le son monte ; « standard » = la notation écrit la hauteur sonnante (stockée + capo),
 * les frettes ne bougent pas ; « tab » = hauteur stockée = hauteur sonnante, la tablature affiche les frettes relatives au capo (frette = hauteur − corde − capo).
 *
 * `EditCapo` (réécriture des hauteurs STOCKÉES quand un capo est posé / modifié / supprimé) : voir `insertCapo`, `changeCapo`, `removeCapo` — à appeler DANS une
 * transaction du document (`doc.transaction(nom, () => insertCapo(doc, …))`).
 *
 * Hauteur sonnante (08/10/2026) : `PID.PITCH` est la hauteur de CONCERT, et la tablature n'est pas transposée (cordes à vide = hauteurs sonnantes) ; la transposition
 * d'instrument n'intervient donc jamais dans `pitchOffsetAt` ici. Mode par défaut d'un nouveau capo : « tab » (le capo ne change que l'affichage des frettes) ;
 * « playback » garde sa règle MuseScore (la hauteur entendue = stockée + capo : `soundingPitch`, à utiliser par le code audio).
 *
 * Non porté : décalage de hauteur de portée (`staff->pitchOffset`) dans `pitchOffsetAt` ;
 * `GuitarBend::fixNotesFrettingForStandardBend` (les deux notes d'un bend sont décalées du même nombre de demi-tons : le montant dérivé ne change pas) ;
 * capo propagé aux portées liées (étape 5) ; réalisation des symboles d'accord à partir de ce capo (faite pour la LECTURE avec le capo statique `PID.CAPO` de la portée d'accords : `src/audio/chordsymbols.js`).
 */
import { PID } from './pid.js';
import { SID } from './sid.js';
import { getProperty } from './props.js';
import { isApplicable } from './schema.js';
import { measureLengthOf, measureOffsetOf, itemDuration } from './timing.js';
import { fAdd, fCmp } from './fraction.js';

/** Capo « par défaut » : inactif, mode playback, frette 0 (`static const CapoParams dummy`). */
export const NO_CAPO = Object.freeze({ active: false, fret: 0, ignoredStrings: Object.freeze([]), mode: 'playback' });

const NAME_TO_STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'E4', 'F#3', 'Bb2' → hauteur MIDI. */
export function pitchFromName(name) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`Nom de hauteur invalide : ${name}`);
  return 12 * (Number(m[3]) + 1) + NAME_TO_STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const STANDARD_TUNING = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];

/** Accordage de la portée (hauteurs MIDI, corde 1 = la plus aiguë en premier). */
export function tuningPitches(staff) {
  return (getProperty(staff, PID.TUNING) ?? STANDARD_TUNING).map(pitchFromName);
}

/**
 * Staff tuning (MIDI, highest string first) in force at `key` = [measure index, nominal position]: the last tuning change written
 * at or before it, else the staff's own tuning. `timeline` lets a linked staff pass its primary staff's timeline.
 */
export function tuningPitchesAt(movement, staff, key, timeline = staffTimeline(movement, staff)) {
  const changes = tuningChanges(movement, staff, timeline);
  return (changes.length && tuningAt(changes, key)) || tuningPitches(staff);
}

/** Paramètres d'une entrée de `PID.CAPOS` (forme de `CapoParams`). */
export function capoParams(entry) {
  return { active: entry.active !== false, fret: entry.fret ?? 1, ignoredStrings: [...(entry.ignoredStrings ?? [])].sort((a, b) => a - b), mode: entry.mode ?? 'tab' };
}

const sameParams = (a, b) => a.active === b.active && a.fret === b.fret && a.mode === b.mode
  && a.ignoredStrings.length === b.ignoredStrings.length && a.ignoredStrings.every((s, i) => s === b.ignoredStrings[i]);

// ───────────────────────── temps ─────────────────────────

/** Clé de temps absolue : [index de mesure, position dans la mesure nominale (fraction)]. */
const keyCmp = (a, b) => (a[0] - b[0]) || fCmp(a[1], b[1]);

/**
 * Éléments d'une portée avec leur position : `[{ item, voice, mi, key }]` (accords, silences…), voix après voix.
 * Une note d'ornement a la position de son accord (`graceOf`).
 */
export function staffTimeline(movement, staff) {
  const out = [];
  staff.voices.forEach((voice, vi) => {
    voice.measures.forEach((measure, mi) => {
      const mb = movement.masterbars[mi];
      const len = measureLengthOf(mb);
      let pos = measureOffsetOf(mb, mi === 0);
      for (const item of measure.items) {
        out.push({ item, voice: vi, mi, key: [mi, pos] });
        pos = fAdd(pos, itemDuration(item, len));
      }
    });
  });
  return out;
}

/**
 * Capos de la portée résolus et triés dans le temps : `[{ entry, params, mi, key }]`. Une entrée dont l'ancre n'existe plus est ignorée.
 * À position égale, la dernière de la liste l'emporte (`insert_or_assign`).
 */
export function capoTimeline(movement, staff, timeline = staffTimeline(movement, staff)) {
  const byId = new Map(timeline.map((t) => [t.item.id, t]));
  const list = [];
  (getProperty(staff, PID.CAPOS) ?? []).forEach((entry, order) => {
    const t = byId.get(entry.itemId);
    if (t) list.push({ entry, params: capoParams(entry), mi: t.mi, key: t.key, order });
  });
  list.sort((a, b) => keyCmp(a.key, b.key) || a.order - b.order);
  return list;
}

/**
 * Tuning changes written on the staff (`PID.STRING_TUNINGS` entries that carry their own `tuning`), sorted in time: `[{ key, tuning }]` with the tuning as MIDI
 * pitches, HIGHEST string first like `tuningPitches`. An entry without `tuning` only displays the staff's tuning and changes nothing.
 */
export function tuningChanges(movement, staff, timeline = staffTimeline(movement, staff)) {
  const byId = new Map(timeline.map((t) => [t.item.id, t]));
  const list = [];
  (getProperty(staff, PID.STRING_TUNINGS) ?? []).forEach((entry, order) => {
    const t = byId.get(entry.itemId);
    if (t && Array.isArray(entry.tuning) && entry.tuning.length) list.push({ tuning: entry.tuning.map(pitchFromName), key: t.key, order });
  });
  list.sort((a, b) => keyCmp(a.key, b.key) || a.order - b.order);
  return list;
}

/** Tuning (MIDI, highest string first) in force at a position, or null when no change was written before it (the staff's own tuning then). */
export function tuningAt(changes, key) {
  let found = null;
  for (const c of changes) { if (keyCmp(c.key, key) <= 0) found = c; else break; }
  return found ? found.tuning : null;
}

/** Capo en vigueur à une position (`Staff::capo(tick)`) : le dernier capo posé à cette position ou avant, sinon `NO_CAPO`. */
export function capoAt(capos, key) {
  let found = null;
  for (const c of capos) { if (keyCmp(c.key, key) <= 0) found = c; else break; }
  return found ? found.params : NO_CAPO;
}

// ───────────────────────── texte ─────────────────────────

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/** `Capo::generateText` ; `style(SID.X)` fournit les modèles de texte (traduisibles). */
export function capoText(params, stringCount, style) {
  if (!params.active || params.fret === 0) return style(SID.CAPO_TEXT_NONE);
  if (!params.ignoredStrings.length) return fill(style(SID.CAPO_TEXT), { fret: params.fret });
  const strings = [];
  for (let s = 1; s <= stringCount; s++) if (!params.ignoredStrings.includes(s)) strings.push(s);
  if (!strings.length) return style(SID.CAPO_TEXT_NONE);
  return fill(style(SID.CAPO_TEXT_PARTIAL), { fret: params.fret, strings: strings.join(', ') });
}

// ───────────────────────── hauteurs et frettes ─────────────────────────

const stringOfNote = (note) => (isApplicable(note.type, PID.STRING) ? getProperty(note, PID.STRING) : null);
const isIgnored = (params, string) => params.active && string !== null && params.ignoredStrings.includes(string);

/** Décalage K appliqué par le capo au calcul de la frette d'une corde (positif : la frette baisse) — `-pitchOffsetAt(…, string)`. */
export function capoFretShift(params, string) {
  if (!params.active || params.mode === 'playback' || isIgnored(params, string)) return 0;
  return params.fret;
}

/** Frette AFFICHÉE d'une note de tablature : hauteur stockée − corde à vide − K (`StringData::fret`). */
export function derivedFret(pitch, open, params, string) {
  return pitch - open - capoFretShift(params, string);
}

/** Hauteur stockée d'une frette : corde à vide + frette + K (`StringData::getPitch`). */
export function storedPitchOfFret(open, fret, params, string) {
  return open + fret + capoFretShift(params, string);
}

/** Hauteur SONNANTE d'une note (`Note::ottaveCapoFret`) : le capo ne s'ajoute qu'en mode « playback », sur une corde non ignorée. */
export function soundingPitch(pitch, params, string = null) {
  return pitch + (params.active && params.mode === 'playback' && !isIgnored(params, string) ? params.fret : 0);
}

/**
 * `StringData::convertPitch` : (corde, frette) d'une hauteur stockée — la corde la plus aiguë dont la corde à vide ne dépasse pas la hauteur
 * décalée ; frette corrigée du capo pour une corde ignorée. `avoid` : cordes déjà prises (autres notes de l'accord). null = hors tablature.
 */
export function convertPitch(pitch, tuning, params, avoid = []) {
  const generic = params.active && params.mode !== 'playback' ? params.fret : 0; // `pitchOffsetAt(staff, tick)` générique (hors cordes ignorées)
  const shifted = pitch - generic;
  for (let s = 1; s <= tuning.length; s++) {
    if (avoid.includes(s)) continue;
    if (shifted >= tuning[s - 1]) return { string: s, fret: shifted - tuning[s - 1] + (isIgnored(params, s) ? params.fret : 0) };
  }
  return null;
}

// ───────────────────────── EditCapo ─────────────────────────

/** Notes (et notes d'ornement) des accords d'une portée dont la position est dans [start, end[ (end null = jusqu'à la fin). */
function chordsInRange(timeline, start, end) {
  return timeline.filter((t) => t.item.type === 'chord' && keyCmp(t.key, start) >= 0 && (end === null || keyCmp(t.key, end) < 0));
}

/** Pour chaque note : `update` (décalage) ou `updateString` (cordes ignorées modifiées), puis nouvelle corde si la frette devient négative. */
function applyCapoTranspose(doc, staff, timeline, start, end, ctx) {
  const isTab = getProperty(staff, PID.STAFF_TYPE) === 'tab';
  const tuning = isTab ? tuningPitches(staff) : null;
  const openOf = (string) => (isTab && string !== null ? tuning[string - 1] : null);
  const setPitch = (note, pitch) => {
    if (getProperty(note, PID.PITCH) === pitch) return;
    doc.set(note, PID.PITCH, pitch);
    // `setTpcFromPitch` : l'orthographe est redérivée de la hauteur (et de l'armure) par la mise en page
    if (isApplicable(note.type, PID.SPELLING) && getProperty(note, PID.SPELLING)) doc.set(note, PID.SPELLING, null);
  };
  // frette stockée par MuseScore = frette affichée AVANT le changement (calculée avec les anciens paramètres)
  const fretBefore = (note, string, oldParams) => {
    const open = openOf(string);
    return open === null ? null : derivedFret(getProperty(note, PID.PITCH), open, oldParams, string);
  };
  const update = (note, oldParams) => { // `EditCapo::update`
    const string = stringOfNote(note);
    if (isIgnored(ctx.params, string)) {
      const f = fretBefore(note, string, oldParams);
      if (f !== null) setPitch(note, openOf(string) + f);
    } else setPitch(note, getProperty(note, PID.PITCH) + ctx.noteOffset);
  };
  const updateString = (note, oldParams) => { // `EditCapo::updateString`
    const string = stringOfNote(note);
    const open = openOf(string);
    if (ctx.params.mode === 'playback' || open === null) return;
    const f = fretBefore(note, string, oldParams);
    const pitch = getProperty(note, PID.PITCH);
    if (isIgnored(ctx.params, string)) {
      if (pitch === open + f) return;
      if (ctx.params.mode === 'standard') setPitch(note, open + f);
      return;
    }
    if (pitch !== open + f + ctx.params.fret && ctx.params.mode === 'standard') setPitch(note, open + f + ctx.params.fret);
  };
  for (const t of chordsInRange(timeline, start, end)) {
    const chords = [t.item, ...(t.item.graceNotes ?? [])];
    for (const chord of chords) {
      // paramètres d'avant : ceux d'avant le changement pour cette position (fournis par l'appelant)
      for (const note of chord.notes) {
        if (ctx.updateIgnoredStrings) updateString(note, ctx.oldParams); else update(note, ctx.oldParams);
      }
      // frette négative → autre corde (`StringData::fretChords`, simplifié : pas de résolution globale des conflits d'accord)
      if (isTab) {
        const used = chord.notes.map(stringOfNote);
        for (const note of chord.notes) {
          const string = stringOfNote(note);
          if (string === null) continue;
          const f = derivedFret(getProperty(note, PID.PITCH), tuning[string - 1], ctx.params, string);
          if (f >= 0) continue;
          const others = used.filter((s) => s !== string);
          const c = convertPitch(getProperty(note, PID.PITCH), tuning, ctx.params, others);
          if (c) { doc.set(note, PID.STRING, c.string); used[chord.notes.indexOf(note)] = c.string; }
        }
      }
    }
  }
}

/** `EditCapo::updateNotationForCapoChange` : réécrit les hauteurs stockées de la portée entre `start` et `end` (clés de temps). */
export function updateNotationForCapoChange(doc, movement, staff, oldParams, newParams, start, end) {
  const timeline = staffTimeline(movement, staff);
  const ctx = { params: newParams, oldParams, noteOffset: 0, updateIgnoredStrings: false };
  const run = () => applyCapoTranspose(doc, staff, timeline, start, end, ctx);
  if (oldParams.mode !== newParams.mode) { // handleModeChange
    const o = oldParams.mode; const n = newParams.mode;
    if (o === 'playback' && n === 'standard') ctx.noteOffset = newParams.fret;
    else if (o === 'standard' && (n === 'playback' || n === 'tab')) ctx.noteOffset = -oldParams.fret;
    else if (o === 'tab' && n === 'standard') ctx.noteOffset = newParams.fret;
    run();
  } else if (oldParams.fret !== newParams.fret) { // handleFretChange
    if (newParams.mode === 'standard') { ctx.noteOffset = newParams.fret - oldParams.fret; run(); }
  } else if (oldParams.ignoredStrings.join() !== newParams.ignoredStrings.join()) { // handleStringChanged
    ctx.updateIgnoredStrings = true;
    if (newParams.mode === 'standard') { ctx.noteOffset = newParams.fret; run(); }
  } else if (oldParams.active !== newParams.active) { // handleActiveChanged
    if (newParams.mode === 'standard') ctx.noteOffset = newParams.active ? newParams.fret : -newParams.fret;
    run();
  }
}

const endOfRange = (capos, cap) => { // clé du capo suivant (fin de la plage d'effet), null = fin de la portée
  const i = capos.indexOf(cap);
  return capos[i + 1] ? capos[i + 1].key : null;
};

/**
 * Pose un capo (`Staff::insertCapoParams`) : ajoute l'entrée à `PID.CAPOS` et réécrit les hauteurs de la plage concernée. DANS une transaction.
 * Si une entrée existe déjà à la même position, elle est remplacée (`insert_or_assign`).
 */
export function insertCapo(doc, movement, staff, entry) {
  const timeline = staffTimeline(movement, staff);
  const before = capoTimeline(movement, staff, timeline);
  const anchor = timeline.find((t) => t.item.id === entry.itemId);
  if (!anchor) throw new Error(`Capo : ancre introuvable (${entry.itemId})`);
  const same = before.find((c) => keyCmp(c.key, anchor.key) === 0);
  const list = (getProperty(staff, PID.CAPOS) ?? []).filter((e) => !same || e.id !== same.entry.id);
  list.push(entry);
  doc.set(staff, PID.CAPOS, list);
  const after = capoTimeline(movement, staff, timeline);
  const cur = after.find((c) => c.entry.id === entry.id);
  const params = cur.params; const end = endOfRange(after, cur);
  if (same) {
    if (!sameParams(same.params, params)) updateNotationForCapoChange(doc, movement, staff, same.params, params, anchor.key, end);
    return;
  }
  const prev = after[after.indexOf(cur) - 1];
  if (prev) {
    if (prev.params.active) updateNotationForCapoChange(doc, movement, staff, prev.params, params, anchor.key, end);
  } else if (params.mode !== 'playback' && params.active) {
    updateNotationForCapoChange(doc, movement, staff, { ...params, mode: 'playback' }, params, anchor.key, end);
  }
}

/** Modifie un capo existant (paramètres) — même effet que `insertCapo` sur la même position. DANS une transaction. */
export function changeCapo(doc, movement, staff, entryId, patch) {
  const entry = (getProperty(staff, PID.CAPOS) ?? []).find((e) => e.id === entryId);
  if (!entry) throw new Error(`Capo introuvable : ${entryId}`);
  insertCapo(doc, movement, staff, { ...entry, ...patch });
}

/** Supprime un capo (`Staff::removeCapoParams`) : les hauteurs reviennent à ce que dictait le capo précédent. DANS une transaction. */
export function removeCapo(doc, movement, staff, entryId) {
  const timeline = staffTimeline(movement, staff);
  const capos = capoTimeline(movement, staff, timeline);
  const cur = capos.find((c) => c.entry.id === entryId);
  const list = (getProperty(staff, PID.CAPOS) ?? []).filter((e) => e.id !== entryId);
  if (!cur) { doc.set(staff, PID.CAPOS, list); return; }
  const end = endOfRange(capos, cur);
  const prev = capos[capos.indexOf(cur) - 1];
  let revert = { active: false, fret: cur.params.fret, ignoredStrings: [], mode: 'playback' };
  if (prev) revert = prev.params.active ? prev.params : { ...prev.params, mode: 'playback' };
  const oldParams = cur.params.active ? cur.params : { ...cur.params, mode: 'playback' };
  updateNotationForCapoChange(doc, movement, staff, oldParams, revert, cur.key, end);
  doc.set(staff, PID.CAPOS, list);
}
