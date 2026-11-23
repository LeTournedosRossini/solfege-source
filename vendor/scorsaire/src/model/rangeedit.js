/*
 * Édition d'une PLAGE : vider, retirer les mesures. Étape 5, « sélection de plage », livraison 2. À APPELER DANS `doc.transaction`.
 *
 * Deux suppressions, comme MuseScore 4.7.5 (lu : `Score::deleteRange`, `NotationInteraction::removeSelectedMeasures` →
 * `cmdTimeDelete` / `deleteMeasures`) :
 *   - `clearRange`   = « Suppr » sur une plage : chaque accord de la plage est supprimé (même règle que `deleteItem` : l'espace
 *     redevient des silences automatiques, un n-olet entier devient des silences ordinaires) ; les silences posés à la main de la
 *     voix 1 sont libérés (ils se recalculent) ; la structure (barres, clés, armures, chiffrages) n'est pas touchée.
 *     Liaisons, ties, etc. : comme la suppression d'un accord (`deleteItem` → `purgeReferences`).
 *   - `removeRangeMeasures` = « Supprimer les mesures » : seulement si la plage est faite de mesures ENTIÈRES ; les mesures
 *     disparaissent de TOUTES les portées (invariant du modèle : voix alignées sur les masterbars).
 * La portée d'accords (positions explicites) : ses symboles dont la position tombe dans la plage sont retirés.
 */
import { PID } from './pid.js';
import { isRunEntry } from './glissando.js';
import { getProperty } from './props.js';
import { fCmp, ZERO } from './fraction.js';
import { STAFF_TYPES } from './schema.js';
import { deleteItem, removeNoteFromChord, EditError } from './noteedit.js';
import { hasLocalValue } from './props.js';
import { deleteMasterbarElement } from './markdelete.js';
import { canVoice, canCategory, splitChordNotes, containsMultiNoteChords, articulationCategory, LIST_CATEGORY, CHORD_MARK_CATEGORY } from './selectionfilter.js';
import { flatStaves } from './range.js';
import { deleteMeasures } from './measureedit.js';
import { resolveStaves, rangeItems, rangeMeasureSpan, rangeIsWholeMeasures } from './range.js';

const isSequential = (staff) => STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.sequential !== false;
const isExplicit = (item) => item.type === 'rest' && getProperty(item, PID.EXPLICIT) === true;

function movementOf(doc, range) {
  const bar = doc.find(range.from.measureId);
  if (!bar || bar.type !== 'masterbar') throw new EditError('Plage introuvable');
  return doc.movementOf(bar);
}

// Traits ancrés par IDENTITÉ : [pid, champ de début, champ de fin, mode]. `both` = supprimé si les DEUX bouts sont dans la plage
// (MuseScore : soufflets, trilles, lignes…) ; `either` = si UN bout y tombe (liaisons d'expression : `deleteSlursFromRange`) ;
// `start` = ancré sur un seul élément (respiration, capo…). `note` = les ancres sont des notes (retenues par le filtre de notes).
const TRAIT_LISTS = [
  [PID.HAIRPINS, 'startChordId', 'endChordId', 'both'], [PID.TRILLS, 'startChordId', 'endChordId', 'both'],
  [PID.TECH_LINES, 'startChordId', 'endChordId', 'both'], [PID.TREMOLOS, 'startChordId', 'endChordId', 'both'],
  [PID.SLURS, 'startChordId', 'endChordId', 'either'], [PID.HOPOS, 'startChordId', 'endChordId', 'either'],
  [PID.TIES, 'startNoteId', 'endNoteId', 'note'], [PID.GLISSANDOS, 'startNoteId', 'endNoteId', 'note'], [PID.BENDS, 'startNoteId', 'endNoteId', 'note'],
  [PID.WHEELS, 'startNoteId', 'endNoteId', 'note'],
  [PID.BREATHS, 'afterId', null, 'start'], [PID.CAPOS, 'itemId', null, 'start'], [PID.STRING_TUNINGS, 'itemId', null, 'start'],
  [PID.LYRIC_LINKS, 'chordId', null, 'start'],
];

/**
 * Vide la plage. Retourne le nombre d'éléments modifiés (accords, silences libérés, notes, marques, symboles d'accord).
 * `filter` (voir selectionfilter.js) : comme `Score::deleteRange` de MuseScore 4.7.5 — seules les voix cochées sont vidées ; dans un
 * accord seules les notes cochées partent (l'accord reste s'il en reste) ; les marques des catégories cochées sont retirées
 * (même sur un accord qui reste), les traits entièrement dans la plage aussi ; un n-olet touché n'est jamais supprimé en bloc (chaque
 * accord est traité, le trou se comble par un silence portant le même n-olet : `deleteItem`).
 */
export function clearRange(doc, range, filter = null) {
  const mv = movementOf(doc, range);
  const span = rangeMeasureSpan(mv, range);
  if (!span) throw new EditError('Plage introuvable');
  const staves = resolveStaves(mv, range.staffIds) ?? [];
  const cat = (c) => canCategory(filter, c);
  let count = 0;
  const seqStaves = staves.filter(isSequential);
  const seqIds = seqStaves.map((s) => s.id);
  if (seqIds.length) {
    const all = rangeItems(mv, { ...range, staffIds: seqIds });
    const hasMulti = containsMultiNoteChords(all.filter((e) => e.item.type === 'chord').map((e) => e.item));
    const plan = { deleteChords: [], removeNotes: [], survivors: [], freed: [] };
    const inRange = new Set(), selectable = new Set(), selNotes = new Set();
    for (const e of all) {
      inRange.add(e.item.id);
      for (const n of e.item.notes ?? []) inRange.add(n.id);
      if (!canVoice(filter, e.voiceIndex)) continue;
      selectable.add(e.item.id);
      if (e.item.type === 'chord') {
        const { kept, dropped } = splitChordNotes(filter, e.item, hasMulti);
        for (const n of kept) selNotes.add(n.id);
        if (!kept.length) plan.survivors.push(e.item.id);
        else if (!dropped.length) plan.deleteChords.push(e.item.id);
        else { plan.removeNotes.push(...kept.map((n) => n.id)); plan.survivors.push(e.item.id); }
      } else if (e.voiceIndex === 0 && isExplicit(e.item)) plan.freed.push(e.item.id);
    }
    // 1) traits entièrement dans la plage (relevés AVANT de toucher aux accords : leurs bornes changent en cours de route)
    for (const staff of seqStaves) {
      for (const [pid, a, b, mode] of TRAIT_LISTS) {
        const category = pid === PID.LYRIC_LINKS ? 'lyrics' : LIST_CATEGORY[pid];
        if (!cat(category)) continue;
        const list = getProperty(staff, pid) ?? [];
        const ok = (id, noteSet) => (noteSet ? noteSet.has(id) : selectable.has(id));
        const drop = list.filter((x) => {
          if (mode === 'both') return ok(x[a]) && inRange.has(x[b]);
          if (mode === 'either') return ok(x[a]) || ok(x[b]);
          if (mode === 'note') return (x[a] === undefined && isRunEntry(x) ? ok(x[b], selNotes) : ok(x[a], selNotes) && inRange.has(x[b]));
          return ok(x[a]);
        });
        if (!drop.length) continue;
        const keep = list.filter((x) => !drop.includes(x));
        if (keep.length) doc.set(staff, pid, keep); else doc.reset(staff, pid);
        count += drop.length;
      }
      if (cat('staffText')) {
        const list = getProperty(staff, PID.STAFF_TEXTS) ?? [];
        const inside = (e) => {
          const mi = mv.masterbars.findIndex((m) => m.id === e.measureId);
          if (mi < span.first || mi > span.last) return false;
          if (mi === span.first && fCmp(e.position, range.from.position) < 0) return false;
          return mi < span.last || fCmp(e.position, range.to.position) < 0;
        };
        const drop = list.filter(inside);
        if (drop.length) {
          const keep = list.filter((e) => !drop.includes(e));
          if (keep.length) doc.set(staff, PID.STAFF_TEXTS, keep); else doc.reset(staff, PID.STAFF_TEXTS);
          count += drop.length;
        }
      }
      if (cat('pedal')) {
        const list = getProperty(staff, PID.PEDALS) ?? [];
        const within = (id, pos, edge) => {
          const mi = mv.masterbars.findIndex((m) => m.id === id);
          if (mi < span.first || mi > span.last) return false;
          if (mi === span.first && fCmp(pos, range.from.position) < 0) return false;
          return edge === 'end' ? (mi < span.last || fCmp(pos, range.to.position) <= 0) : (mi < span.last || fCmp(pos, range.to.position) < 0);
        };
        const drop = list.filter((p) => within(p.startMeasureId, p.startPosition, 'start') && within(p.endMeasureId, p.endPosition, 'end'));
        if (drop.length) {
          const keep = list.filter((p) => !drop.includes(p));
          if (keep.length) doc.set(staff, PID.PEDALS, keep); else doc.reset(staff, PID.PEDALS);
          count += drop.length;
        }
      }
    }
    // 2) accords et silences
    for (const id of plan.deleteChords) { if (doc.find(id)) { deleteItem(doc, id); count++; } }
    for (const id of plan.removeNotes) { if (doc.find(id)) { removeNoteFromChord(doc, id); count++; } }
    for (const id of plan.freed) { if (doc.find(id)) { deleteItem(doc, id); count++; } }
    // 3) marques des accords qui restent (catégories cochées)
    for (const id of plan.survivors) {
      const chord = doc.find(id);
      if (!chord) continue;
      for (const [pid, category] of CHORD_MARK_CATEGORY) {
        if (cat(category) && hasLocalValue(chord, pid)) { doc.reset(chord, pid); count++; }
      }
      const arts = getProperty(chord, PID.ARTICULATIONS) ?? [];
      const keep = arts.filter((a) => !cat(articulationCategory(a.type)));
      if (keep.length !== arts.length) { if (keep.length) doc.set(chord, PID.ARTICULATIONS, keep); else doc.reset(chord, PID.ARTICULATIONS); count += arts.length - keep.length; }
      if (cat('fingering')) for (const n of chord.notes ?? []) if ((getProperty(n, PID.FINGERINGS) ?? []).length) { doc.reset(n, PID.FINGERINGS); count++; }
      if (cat('graceNote')) for (const g of [...(chord.graceNotes ?? [])]) { doc.remove(g); count++; }
    }
    // 4) silences des voix 2 à 4 (deviennent des trous invisibles ; une voix qui ne garde que des trous redevient vide)
    // (relevés APRÈS la suppression des accords : un accord de voix 2 supprimé laisse des silences à retirer à leur tour)
    const restIds = rangeItems(mv, { ...range, staffIds: seqIds })
      .filter((e) => e.voiceIndex > 0 && canVoice(filter, e.voiceIndex) && e.item.type === 'rest' && getProperty(e.item, PID.GAP) !== true)
      .map((e) => e.item.id);
    for (const id of restIds) { if (doc.find(id)) { deleteItem(doc, id); count++; } }
  }
  // portée d'accords : symboles de la voix cochée dont la position tombe dans la plage
  for (const staff of staves.filter((s) => !isSequential(s))) {
    (staff.voices ?? []).forEach((voice, vi) => {
      if (!canVoice(filter, vi)) return;
      for (let mi = span.first; mi <= span.last; mi++) {
        for (const item of [...(voice.measures?.[mi]?.items ?? [])]) {
          if (item.type !== 'chordsymbol' && item.type !== 'lyricevent') continue; // the symbols of a chord staff, the syllables of a lyrics staff
          if (!cat(item.type === 'lyricevent' ? 'lyrics' : 'chordSymbol')) continue;
          const pos = getProperty(item, PID.POSITION);
          if (mi === span.first && fCmp(pos, range.from.position) < 0) continue;
          if (mi === span.last && fCmp(pos, range.to.position) >= 0) continue;
          doc.remove(item);
          count++;
        }
      }
    });
  }
  // éléments de système (tempos, points d'orgue, swings, sauts, marqueurs) : seulement si la plage contient la 1re portée du Mouvement
  const first = flatStaves(mv)[0];
  if (cat('system') && first && range.staffIds.includes(first.id)) {
    for (const key of ['tempos', 'fermatas', 'swings', 'cues', 'tempoChanges', 'jumps', 'markers', 'systemContainers']) {
      for (const el of [...(mv[key] ?? [])]) {
        if (key === 'systemContainers' && getProperty(el, PID.CONTAINER_KIND) !== 'section') continue; // only the sections of the form go with the measures
        const mi = mv.masterbars.findIndex((m) => m.id === getProperty(el, PID.MEASURE_ID));
        if (mi < span.first || mi > span.last) continue;
        const pos = key === 'systemContainers' || key === 'cues' ? ZERO : getProperty(el, PID.POSITION) ?? ZERO; // a cue is anchored on a measure, at its start
        if (mi === span.first && fCmp(pos, range.from.position) < 0) continue;
        if (mi === span.last && fCmp(pos, range.to.position) >= 0) continue;
        if (key === 'systemContainers') { doc.remove(el); count++; } else if (deleteMasterbarElement(doc, el)) count++;
      }
    }
  }
  return count;
}

/** Retire les mesures de la plage (toutes les portées). Refuse une plage qui ne couvre pas des mesures entières. */
export function removeRangeMeasures(doc, range) {
  const mv = movementOf(doc, range);
  if (!rangeIsWholeMeasures(mv, range)) throw new EditError('La plage ne couvre pas des mesures entières');
  const span = rangeMeasureSpan(mv, range);
  deleteMeasures(doc, mv, { from: span.first, to: span.last });
  return span.last - span.first + 1;
}
