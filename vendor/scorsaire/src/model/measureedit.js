/*
 * Insertion et suppression de mesures (étape 5) : UNE opération globale sur le Mouvement, qui touche le masterbar ET toutes les
 * voix de toutes les portées (invariant « mesures alignées par index sur les masterbars »). À APPELER DANS
 * `doc.transaction(nom, () => insertMeasures(doc, mv, …))` : un geste = une transaction annulable.
 *
 * Port de MuseScore 4.7.5 (lu, jamais deviné) : `MasterScore::insertMeasure` (masterscore.cpp), `Score::deleteMeasures`,
 * `reconnectSlurs`, `undoRemoveMeasures`, `undoInsertTime` (edit.cpp), `Staff::insertTime` (staff.cpp), `InsertRemoveMeasures`
 * (editmeasures.cpp), `NotationInteraction::addBoxes` / `removeSelectedMeasures` (notationinteraction.cpp).
 *
 * INSERTION (`insertMeasures(doc, mv, { at, count, moveSignatures })`) — `at` = indice de la mesure AVANT laquelle on insère
 * (`count` du Mouvement = à la fin). MuseScore insère `count` fois une mesure avant la même mesure :
 *   - la nouvelle mesure est au chiffrage NOMINAL (jamais irrégulière) et se remplit de silences de mesure (une voix 1 par portée) ;
 *   - `moveSignatures` vrai (« insérer AVANT ») : chiffrage, armure, changements de clé en tête de mesure et DÉBUT DE REPRISE de la
 *     mesure suivante passent sur la 1re nouvelle mesure ; faux (« insérer APRÈS ») : la nouvelle mesure prend le chiffrage et
 *     l'armure de la mesure qui la précède, et la barre de fin (double barre, finale…) et la FIN DE REPRISE de la mesure précédente
 *     passent sur la dernière nouvelle mesure. En tête de Mouvement, les signes sont toujours déplacés (`isBeginning`) ;
 *   - une volta qui commence sur la mesure suivante est ÉLARGIE (`undoInsertTime`, cas `isVolta`), une volta qui contient le point
 *     d'insertion aussi ;
 *   - ties, liaisons, soufflets… ancrés par identité d'accord ou de note ne bougent pas (MuseScore laisse un tie reliant les deux
 *     notes d'origine à travers la mesure insérée) ;
 *   - les éléments de masterbar (tempo, saut, marqueur, point d'orgue, swing…) restent sur leur mesure.
 *   Les chiffrages et armures sont stockés sur CHAQUE masterbar (valeurs absolues) : rien à « déplacer » au sens de MuseScore, la
 *   nouvelle mesure copie la valeur voulue et le résultat visible est le même.
 *
 * SUPPRESSION (`deleteMeasures(doc, mv, { from, to })`, indices inclus) :
 *   - tout ce qui est ancré sur une mesure supprimée disparaît (voltas qui y COMMENCENT, sauts, marqueurs, tempos, points d'orgue,
 *     swings, conteneurs système, changements de clé, décor masqué, points de synchronisation) ; une volta qui commence avant et
 *     recouvre la plage est RACCOURCIE (décision de Jean, 13/10/2026) ;
 *   - les entrées de liste qui visent un élément supprimé disparaissent (`purgeReferences` : ties, soufflets, trilles, glissandos,
 *     bends, trémolos, respirations, capos, paroles…) — dont un tie qui entre dans la plage ou en sort (`preserveTies` faux) ;
 *   - LIAISONS D'EXPRESSION (`reconnectSlurs`) : deux bornes dans la plage → supprimée ; borne de DÉPART dans la plage → déplacée sur
 *     le premier accord de la même voix après la plage ; borne d'ARRIVÉE dans la plage → déplacée sur le dernier accord de la même
 *     voix avant la plage ; supprimée s'il n'y en a pas ou si la liaison deviendrait de longueur nulle ou négative ;
 *   - pédales et changements de tempo graduels (début et fin en instants) : supprimés si le début OU la fin tombe dans la plage ;
 *   - chiffrage et armure : les mesures suivantes gardent les leurs (valeurs absolues) ; MuseScore les restaure explicitement.
 *   MuseScore autorise un Mouvement sans aucune mesure : `insertMeasures` sur un Mouvement vide repart de 4/4 sans altération
 *   (`restoreInitialKeySigAndTimeSig`).
 *
 * ÉCARTS / limites (documentés) :
 *   - le sort d'un spanner dont la fin tombe EXACTEMENT sur le bord de la plage (`tick2 == tick1` chez MuseScore) n'est pas porté pour
 *     les lignes ancrées par accord (soufflets, trilles, lignes de technique : supprimées seulement si une borne est DANS la plage) ;
 *   - fin de reprise déplacée : le nombre de passages (`repeatCount`) suit la barre (MuseScore ne le déplace pas) ;
 *   - la mesure suivante une anacrouse (1re mesure irrégulière) qui devient la 2e mesure perd son décalage automatique ;
 *   - notation imbriquée (conteneurs de portée) : suit l’insertion (conteneur élargi) et la suppression (supprimé ou raccourci) ; portées « grille » sans contenu séquentiel : mesures vides.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import {
  createMasterbar, createMeasure, createVoice, createEmptyMeasure,
} from './elements.js';
import { ZERO, fAdd, fLt, fEq } from './fraction.js';
import { measureLengthOf } from './timing.js';
import { purgeReferences, measureTimeline, EditError } from './noteedit.js';
import { purgePartLayout } from './partedit.js';
import { purgeAutomation } from './automation.js';

const staffsOf = (mv) => mv.tracks.flatMap((t) => t.staves);

/** Every staff container of the movement: [{ container, owner (staff) }] — those of the staves, and those a PART hangs on one of them (screen 2). */
const containersOf = (doc, mv) => {
  const staves = staffsOf(mv);
  const own = staves.flatMap((st) => st.containers.map((c) => ({ container: c, owner: st })));
  const ids = new Map(staves.map((st) => [st.id, st]));
  const ofParts = (doc.work.parts ?? []).flatMap((part) => (part.containers ?? [])
    .filter((c) => getProperty(c, PID.CONTAINER_PLACEMENT) !== 'zone' && ids.has(getProperty(c, PID.CONTAINER_STAFF_ID)))
    .map((c) => ({ container: c, owner: ids.get(getProperty(c, PID.CONTAINER_STAFF_ID)) })));
  return [...own, ...ofParts];
};

function indexOfBar(mv, id) {
  return mv.masterbars.findIndex((b) => b.id === id);
}

// ---------------------------------------------------------------------------
// INSERTION
// ---------------------------------------------------------------------------

/**
 * Insère `count` mesures vides avant la mesure d'indice `at` (0..nombre de mesures).
 * @param opts.moveSignatures vrai = « insérer avant » (signes de la mesure suivante déplacés sur la 1re nouvelle mesure),
 *   faux = « insérer après » (barre de fin / fin de reprise de la mesure précédente déplacées sur la dernière)
 * @returns {string[]} identifiants des nouveaux masterbars, dans l'ordre
 */
export function insertMeasures(doc, mv, { at, count = 1, moveSignatures = true } = {}) {
  if (!Number.isInteger(count) || count < 1) throw new EditError('Nombre de mesures invalide');
  if (!Number.isInteger(at) || at < 0 || at > mv.masterbars.length) throw new EditError('Point d\'insertion invalide');
  const created = [];
  const staves = staffsOf(mv);
  const beginning = at === 0;

  for (let k = 0; k < count; k++) {
    const index = at + k;
    const before = mv.masterbars[index] ?? null; // mesure devant laquelle on insère (la même à chaque tour)
    const prev = index > 0 ? mv.masterbars[index - 1] : null;
    const move = (moveSignatures || beginning) && before !== null;
    // chiffrage nominal et armure de la nouvelle mesure
    const ref = move ? before : (prev ?? before);
    const bar = createMasterbar({
      timeSig: ref ? getProperty(ref, PID.TIME_SIG) : [4, 4],
      keySig: ref ? getProperty(ref, PID.KEY_SIG) : 0,
    });
    const grouping = ref ? getProperty(ref, PID.BEAM_GROUPING) : null;
    doc.add(mv, 'masterbars', bar, index);
    if (grouping) doc.set(bar, PID.BEAM_GROUPING, grouping);
    const grid = ref && !getProperty(ref, PID.MEASURE_LENGTH) ? getProperty(ref, PID.INPUT_GRID) : null; // the cells of the chord track: a new measure keeps the grid of its neighbour (a pickup has its own length)
    if (grid) doc.set(bar, PID.INPUT_GRID, grid);
    created.push(bar.id);

    // contenu : silence de mesure en voix 1, mesures vides dans les autres voix
    for (const staff of staves) {
      const type = getProperty(staff, PID.STAFF_TYPE);
      staff.voices.forEach((voice, v) => {
        doc.add(voice, 'measures', v === 0 ? createEmptyMeasure(type) : createMeasure([]), index);
      });
    }

    if (move && before) {
      // début de reprise (MuseScore : `masterMeasure->undoChangeProperty(REPEAT_START, true)` puis faux sur la mesure d'origine)
      if (getProperty(before, PID.REPEAT_START)) {
        doc.set(bar, PID.REPEAT_START, true);
        doc.reset(before, PID.REPEAT_START);
      }
      // changements de clé en tête de la mesure d'origine → nouvelle mesure
      if (k === 0) {
        for (const staff of staves) {
          const list = getProperty(staff, PID.CLEF_CHANGES);
          if (!Array.isArray(list)) continue;
          const moved = list.map((c) => (c.measureId === before.id && fEq(c.position, ZERO) ? { ...c, measureId: bar.id } : c));
          if (moved.some((c, i) => c !== list[i])) doc.set(staff, PID.CLEF_CHANGES, moved);
        }
      }
    } else if (!moveSignatures && prev) {
      // barre de fin et fin de reprise de la mesure précédente → nouvelle mesure
      const barType = getProperty(prev, PID.BAR_TYPE);
      if (barType !== 'simple') { doc.set(bar, PID.BAR_TYPE, barType); doc.reset(prev, PID.BAR_TYPE); }
      if (getProperty(prev, PID.REPEAT_END)) {
        doc.set(bar, PID.REPEAT_END, true);
        doc.set(bar, PID.REPEAT_COUNT, getProperty(prev, PID.REPEAT_COUNT));
        doc.reset(prev, PID.REPEAT_END);
        doc.reset(prev, PID.REPEAT_COUNT);
      }
    }

    // a slot "after" the previous measure (canonical only on the last one) now sits before the inserted measure: it keeps its place
    if (prev) {
      for (const { container } of containersOf(doc, mv)) {
        if (getProperty(container, PID.CONTAINER_PLACEMENT) === 'between' && getProperty(container, PID.CONTAINER_SIDE) === 'after'
          && getProperty(container, PID.MEASURE_ID) === prev.id) {
          doc.set(container, PID.MEASURE_ID, bar.id);
          doc.set(container, PID.CONTAINER_SIDE, 'before');
        }
      }
    }
    // staff containers: a container whose span contains the insertion point grows by one measure (empty measure in its nested staves)
    for (const { container } of containersOf(doc, mv)) {
      const first = indexOfBar(mv, getProperty(container, PID.MEASURE_ID));
      const span = getProperty(container, PID.SPAN);
      if (first < 0 || !(first < index && index < first + span)) continue;
      doc.set(container, PID.SPAN, span + 1);
      const fragment = container.fragments?.[0];
      if (fragment) {
        // the fragment is a movement of its own: a measure is inserted there too, with the signatures of the inserted main measure
        insertMeasures(doc, fragment, { at: index - first, count: 1, moveSignatures: true });
        const fb = fragment.masterbars[index - first];
        doc.set(fb, PID.TIME_SIG, getProperty(bar, PID.TIME_SIG));
        doc.set(fb, PID.KEY_SIG, getProperty(bar, PID.KEY_SIG));
        continue;
      }
      for (const nested of container.staves) {
        const type = getProperty(nested, PID.STAFF_TYPE);
        nested.voices.forEach((voice, v) => doc.add(voice, 'measures', v === 0 ? createEmptyMeasure(type) : createMeasure([]), index - first));
      }
    }

    // voltas : élargie si elle commence sur la mesure suivante (`isVolta`) ou contient le point d'insertion
    for (const volta of mv.voltas) {
      const start = indexOfBar(mv, getProperty(volta, PID.MEASURE_ID));
      const span = getProperty(volta, PID.SPAN);
      if (start === index + 1 && before && getProperty(volta, PID.MEASURE_ID) === before.id) {
        doc.set(volta, PID.MEASURE_ID, bar.id);
        doc.set(volta, PID.SPAN, span + 1);
      } else if (start >= 0 && start < index && index < start + span) {
        doc.set(volta, PID.SPAN, span + 1);
      }
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// SUPPRESSION
// ---------------------------------------------------------------------------

/** Accords principaux d'une portée, par voix : [{ chord, mi, abs }] (abs = instant absolu en fractions de ronde). */
function chordsByVoice(mv, staff) {
  const starts = [];
  let acc = ZERO;
  for (const b of mv.masterbars) { starts.push(acc); acc = fAdd(acc, measureLengthOf(b)); }
  return staff.voices.map((voice) => {
    const out = [];
    voice.measures.forEach((m, mi) => {
      const length = measureLengthOf(mv.masterbars[mi]);
      for (const u of measureTimeline(m, length)) {
        if (u.item.type === 'chord') out.push({ chord: u.item, mi, abs: fAdd(starts[mi], u.start) });
      }
    });
    return out;
  });
}

/** Port de `Score::reconnectSlurs` pour une portée. */
function reconnectSlurs(doc, mv, staff, from, to) {
  const list = getProperty(staff, PID.SLURS);
  if (!Array.isArray(list) || !list.length) return;
  const voices = chordsByVoice(mv, staff);
  const where = new Map(); // id d'accord (ou d'ornement) → { voice, rec }
  voices.forEach((chords, vi) => chords.forEach((rec) => {
    where.set(rec.chord.id, { voice: vi, rec });
    for (const g of rec.chord.graceNotes ?? []) where.set(g.id, { voice: vi, rec });
  }));
  const inside = (mi) => mi >= from && mi <= to;
  const next = [];
  for (const slur of list) {
    const s = where.get(slur.startChordId);
    const e = where.get(slur.endChordId);
    if (!s || !e) { next.push(slur); continue; } // introuvable : purgeReferences tranchera
    const sIn = inside(s.rec.mi);
    const eIn = inside(e.rec.mi);
    if (sIn && eIn) continue; // les deux bornes dans la plage : supprimée
    if (sIn) {
      const candidate = voices[s.voice].find((r) => r.mi > to);
      if (!candidate || candidate.chord.id === e.rec.chord.id || !fLt(candidate.abs, e.rec.abs)) continue;
      next.push({ ...slur, startChordId: candidate.chord.id });
    } else if (eIn) {
      const candidate = [...voices[e.voice]].reverse().find((r) => r.mi < from);
      if (!candidate || candidate.chord.id === s.rec.chord.id || !fLt(s.rec.abs, candidate.abs)) continue;
      next.push({ ...slur, endChordId: candidate.chord.id });
    } else next.push(slur);
  }
  if (next.length !== list.length || next.some((x, i) => x !== list[i])) doc.set(staff, PID.SLURS, next);
}

/**
 * Supprime les mesures d'indices `from` à `to` (inclus). Autorisé jusqu'à la dernière : un Mouvement peut rester sans mesure.
 */
export function deleteMeasures(doc, mv, { from, to } = {}) {
  const total = mv.masterbars.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= total) throw new EditError('Plage de mesures invalide');
  const staves = staffsOf(mv);
  const doomed = new Set(mv.masterbars.slice(from, to + 1).map((b) => b.id));
  const inRange = (id) => doomed.has(id);

  // 1. liaisons d'expression (avant que les accords ne disparaissent)
  for (const staff of staves) reconnectSlurs(doc, mv, staff, from, to);

  // 2. éléments des mesures supprimées (toutes voix, toutes portées), puis entrées de liste qui les visent
  const removed = [];
  for (const staff of staves) for (const voice of staff.voices) for (let mi = from; mi <= to; mi++) if (voice.measures[mi]) removed.push(voice.measures[mi]);
  for (const staff of staves) purgeReferences(doc, staff, removed);

  // 3. ancrages par instant et décor, par portée
  for (const staff of staves) {
    const clefs = getProperty(staff, PID.CLEF_CHANGES);
    if (Array.isArray(clefs) && clefs.some((c) => inRange(c.measureId))) doc.set(staff, PID.CLEF_CHANGES, clefs.filter((c) => !inRange(c.measureId)));
    const decor = getProperty(staff, PID.HIDDEN_DECOR);
    if (Array.isArray(decor) && decor.some((d) => d.measureId !== undefined && inRange(d.measureId))) {
      doc.set(staff, PID.HIDDEN_DECOR, decor.filter((d) => d.measureId === undefined || !inRange(d.measureId)));
    }
    const texts = getProperty(staff, PID.STAFF_TEXTS);
    if (Array.isArray(texts) && texts.some((t) => inRange(t.measureId))) doc.set(staff, PID.STAFF_TEXTS, texts.filter((t) => !inRange(t.measureId)));
    const pedals = getProperty(staff, PID.PEDALS);
    if (Array.isArray(pedals) && pedals.some((p) => inRange(p.startMeasureId) || inRange(p.endMeasureId))) {
      doc.set(staff, PID.PEDALS, pedals.filter((p) => !inRange(p.startMeasureId) && !inRange(p.endMeasureId)));
    }
  }

  // 4. contenu des voix puis masterbars
  for (const staff of staves) for (const voice of staff.voices) for (let mi = to; mi >= from; mi--) if (voice.measures[mi]) doc.remove(voice.measures[mi]);

  // 5. éléments de masterbar
  const idsBefore = mv.masterbars.map((b) => b.id);
  purgeAutomation(doc, mv, idsBefore.slice(from, to + 1));
  purgePartLayout(doc, mv, from, to); // breaks and fixed systems of the parts (needs the masterbars still in place)
  for (const volta of [...mv.voltas]) {
    const start = idsBefore.indexOf(getProperty(volta, PID.MEASURE_ID));
    const span = getProperty(volta, PID.SPAN);
    if (inRange(getProperty(volta, PID.MEASURE_ID))) { doc.remove(volta); continue; }
    if (start < from && start + span - 1 >= from) {
      const overlap = Math.min(start + span - 1, to) - from + 1;
      doc.set(volta, PID.SPAN, span - overlap);
    }
  }
  // staff containers: removed with their anchor measure; a container that runs into the range is shortened (nested measures removed too)
  for (const { container } of containersOf(doc, mv)) {
    const first = idsBefore.indexOf(getProperty(container, PID.MEASURE_ID));
    const span = getProperty(container, PID.SPAN);
    if (getProperty(container, PID.CONTAINER_PLACEMENT) === 'between') {
      // a slot between measures survives its anchor: it moves to the next surviving measure ("before"), else to the end of the piece
      if (!inRange(getProperty(container, PID.MEASURE_ID))) continue;
      const survivors = idsBefore.filter((id) => !doomed.has(id));
      const next = idsBefore.slice(to + 1).find((id) => !doomed.has(id));
      if (next) { doc.set(container, PID.MEASURE_ID, next); doc.set(container, PID.CONTAINER_SIDE, 'before'); }
      else if (survivors.length) { doc.set(container, PID.MEASURE_ID, survivors[survivors.length - 1]); doc.set(container, PID.CONTAINER_SIDE, 'after'); }
      else doc.remove(container);
      continue;
    }
    if (inRange(getProperty(container, PID.MEASURE_ID))) { doc.remove(container); continue; }
    if (first < from && first + span - 1 >= from) {
      const overlap = Math.min(first + span - 1, to) - from + 1;
      const fragment = container.fragments?.[0];
      if (fragment) deleteMeasures(doc, fragment, { from: from - first, to: from - first + overlap - 1 });
      else {
        for (const nested of container.staves) {
          for (const voice of nested.voices) for (let k = from - first + overlap - 1; k >= from - first; k--) if (voice.measures[k]) doc.remove(voice.measures[k]);
        }
      }
      doc.set(container, PID.SPAN, span - overlap);
    }
  }
  for (const key of ['jumps', 'markers', 'rehearsalMarks', 'tempos', 'fermatas', 'swings', 'cues', 'systemContainers']) {
    for (const el of [...mv[key]]) if (inRange(getProperty(el, PID.MEASURE_ID))) doc.remove(el);
  }
  for (const c of [...mv.tempoChanges]) {
    if (inRange(getProperty(c, PID.MEASURE_ID)) || inRange(getProperty(c, PID.END_MEASURE_ID))) doc.remove(c);
  }
  for (const sync of [...mv.syncs]) {
    const anchors = getProperty(sync, PID.SYNC_ANCHORS);
    const kept = anchors.filter((a) => !inRange(a.measureId));
    if (!kept.length) doc.remove(sync);
    else if (kept.length !== anchors.length) doc.set(sync, PID.SYNC_ANCHORS, kept);
  }
  for (let mi = to; mi >= from; mi--) doc.remove(mv.masterbars[mi]);
}
