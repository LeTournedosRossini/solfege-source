/*
 * « Transposer la musique » — opération d'édition (port de `Transpose::transpose`, mode par intervalle, MuseScore 4.7.5 `editing/transpose.cpp`,
 * `Note::transpose`, `Transpose::transposeKeys`) appliquée à un Mouvement entier.
 *
 * Le modèle stocke la hauteur de CONCERT (`PID.PITCH`) : transposer la musique ajoute l'intervalle à cette hauteur et à l'orthographe de concert, que la portée
 * soit celle d'un instrument transpositeur ou non (l'écrit est dérivé, voir `transpose.js`). Règles vérifiées aux sources :
 *   - la percussion n'est JAMAIS transposée (`StaffGroup::PERCUSSION` ignoré) ;
 *   - une note dont la nouvelle hauteur sort de 0..127 n'est pas transposée (`Note::transpose` renvoie faux) ;
 *   - l'orthographe de concert suit : `transposeTpc(tpc1, intervalle, useDoubleSharpsFlats)` ; l'orthographe écrite est dérivée ;
 *   - les armures de concert sont transposées (`transposeKey(clé, intervalle)`, sans préférence : −7..+7) sauf pour un intervalle d'octave pur
 *     (`fullOctave` : `trKeys = false`) ;
 *   - les symboles d'accord (racine et basse) suivent (`transposeChordNames`), sauf pour un intervalle d'octave pur.
 * L'accordéon (clavier de piano à droite, Stradella à gauche : `accnote`) est transposé comme n'importe quelle portée de notes : badge, rang, colonne
 * et nom de bouton sont DÉRIVÉS de la hauteur et de l'orthographe.
 *
 * Écart / ajout Scorsaire (non MuseScore, `Transpose::transposeNote` ne parle pas de tablature séparée) : une note de TABLATURE garde sa corde si la
 * frette reste ≥ 0, sinon elle change de corde comme `StringData::convertPitch` (capo compris) ; sans corde possible, la note n'est pas transposée.
 *
 * À appeler DANS `doc.transaction(nom, () => transposeMovement(doc, movement, intervalle))`.
 */
import { PID } from './pid.js';
import { nestedStaves } from './containerstaves.js';
import { getProperty } from './props.js';
import { defaultSpelling } from './pitch.js';
import { staffTimeline, capoTimeline, capoAt, tuningPitches, derivedFret, convertPitch } from './capo.js';
import {
  tpcOfSpelling, tpcStep, tpcAlter, tpcIsValid, transposeTpc, transposeKey, spellingFromTpc, intervalIsZero, PREFER,
} from './transpose.js';

const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Nom de note sans octave (racine et basse d'un symbole d'accord) transposé : { step, alter }. */
function transposeName(name, iv, useDoubleSharpsFlats) {
  const tpc = tpcOfSpelling(name);
  if (!tpcIsValid(tpc)) return name;
  const next = transposeTpc(tpc, iv, useDoubleSharpsFlats);
  return { step: STEP_NAMES[tpcStep(next)], alter: tpcAlter(next) };
}

/**
 * @param doc       document (`doc.set`)
 * @param movement  Mouvement à transposer
 * @param iv        intervalle { diatonic, chromatic } (positif : vers l'aigu)
 * @param options   { keys = true, chordNames = true, useDoubleSharpsFlats = true, measures = null } — `measures` { from, to } (indices, inclus) = seulement ces mesures (notes, symboles d'accord, armures) ; null = tout le Mouvement
 * @returns { notes, failed: [identifiants de notes non transposées], keys, chordSymbols }
 */
export function transposeMovement(doc, movement, iv, { keys = true, chordNames = true, useDoubleSharpsFlats = true, measures = null } = {}) {
  const result = { notes: 0, failed: [], keys: 0, chordSymbols: 0 };
  if (intervalIsZero(iv)) return result;
  const inRange = (mi) => !measures || (mi >= measures.from && mi <= measures.to);
  const fullOctave = iv.chromatic % 12 === 0;
  const concertKeys = movement.masterbars.map((mb) => getProperty(mb, PID.KEY_SIG));

  // portées d'une piste, y compris celles que portent les conteneurs de portée (nested notation of the STACKED containers, `containerstaves.js`; imbriquables)
  const withNested = (staves) => staves.flatMap((st) => [st, ...withNested((st.containers ?? []).filter((c) => getProperty(c, PID.CONTAINER_TRANSPOSE_FOLLOW) !== false).flatMap((c) => nestedStaves(c)))]);
  for (const track of movement.tracks) {
    for (const staff of withNested(track.staves)) {
      const type = getProperty(staff, PID.STAFF_TYPE);
      if (type === 'percussion' || type === 'rhythm' || type === 'neutral') continue; // jamais transposée (pas de hauteur)
      const isTab = type === 'tab';
      const timeline = isTab ? staffTimeline(movement, staff) : null;
      const capos = isTab ? capoTimeline(movement, staff, timeline) : null;
      const tuning = isTab ? tuningPitches(staff) : null;
      const keyOf = new Map(); // identifiant d'accord → { mi, key } (tablature : capo en vigueur)
      if (isTab) for (const t of timeline) keyOf.set(t.item.id, t);

      const transposeChord = (chord, mi) => {
        let paramsFor = null;
        let reserved = null;
        let invalid = [];
        if (isTab) {
          const at = keyOf.get(chord.id) ?? keyOf.get(chord.graceOf);
          const params = at ? capoAt(capos, at.key) : capoAt(capos, [mi, [0, 1]]);
          paramsFor = (note, next) => derivedFret(next, tuning[getProperty(note, PID.STRING) - 1], params, getProperty(note, PID.STRING));
          reserved = new Set();
          // les notes dont la frette reste valable gardent leur corde ; les autres cherchent une corde libre (ordre des notes de l'accord)
          for (const note of chord.notes) {
            const next = getProperty(note, PID.PITCH) + iv.chromatic;
            if (next >= 0 && next <= 127 && paramsFor(note, next) >= 0) reserved.add(getProperty(note, PID.STRING));
          }
          invalid = [params];
        }
        for (const note of chord.notes) {
          const pitch = getProperty(note, PID.PITCH);
          const next = pitch + iv.chromatic;
          if (!(next >= 0 && next <= 127)) { result.failed.push(note.id); continue; }
          if (note.type === 'tabnote') {
            if (paramsFor(note, next) < 0) {
              const moved = convertPitch(next, tuning, invalid[0], [...reserved]);
              if (!moved) { result.failed.push(note.id); continue; }
              doc.set(note, PID.STRING, moved.string);
              reserved.add(moved.string);
            }
            doc.set(note, PID.PITCH, next);
          } else {
            const sp = getProperty(note, PID.SPELLING) ?? defaultSpelling(pitch, concertKeys[mi]);
            const tpc = tpcOfSpelling(sp);
            if (tpcIsValid(tpc)) doc.set(note, PID.SPELLING, spellingFromTpc(transposeTpc(tpc, iv, useDoubleSharpsFlats), next));
            doc.set(note, PID.PITCH, next);
          }
          result.notes++;
        }
      };

      for (const voice of staff.voices) {
        voice.measures.forEach((measure, mi) => {
          if (!inRange(mi)) return;
          for (const item of measure?.items ?? []) {
            if (item.type === 'chord') {
              transposeChord(item, mi);
              for (const grace of item.graceNotes ?? []) transposeChord({ ...grace, graceOf: item.id }, mi);
            } else if (item.type === 'chordsymbol' && chordNames && !fullOctave) {
              const root = getProperty(item, PID.CHORD_ROOT);
              const bass = getProperty(item, PID.CHORD_BASS);
              if (root) doc.set(item, PID.CHORD_ROOT, transposeName(root, iv, useDoubleSharpsFlats));
              if (bass) doc.set(item, PID.CHORD_BASS, transposeName(bass, iv, useDoubleSharpsFlats));
              result.chordSymbols++;
            }
          }
        });
      }
    }
  }

  if (keys && !fullOctave) {
    movement.masterbars.forEach((mb, mi) => {
      if (!inRange(mi)) return;
      const next = transposeKey(concertKeys[mi], iv, PREFER.NONE);
      if (next !== concertKeys[mi]) doc.set(mb, PID.KEY_SIG, next);
      result.keys++;
    });
  }
  return result;
}
