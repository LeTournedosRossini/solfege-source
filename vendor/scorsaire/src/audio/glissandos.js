/*
 * Glissandos (lecture) — port de la chaîne MPE de MuseScore 4.7.5 : `Glissando::pitchSteps` (dom/glissando.cpp), `chromaticPitchSteps`
 * (dom/utils.cpp), `GlissandosRenderer` (playback/renderers/glissandosrenderer.cpp), `SpannersMetaParser` (cas GLISSANDO), profils
 * `general_*_articulations_profile.json` (ContinuousGlissando / DiscreteGlissando). Module PUR : l'intégration (notes, liaisons, ornements) est dans `sequence.js`.
 *
 * Un glissando relie DEUX notes (`PID.GLISSANDOS`) ; il est joué par la note de DÉPART :
 *  - style `portamento` : glissando CONTINU (`ContinuousGlissando`), UN événement avec une courbe de hauteur ;
 *  - autres styles : glissando DISCRET (`DiscreteGlissando`), un événement par pas de hauteur ; la note d'arrivée n'est PAS un pas (elle se joue
 *    par son propre accord) ; chaque pas dure la durée de la note / nombre de pas.
 *
 * Écarts assumés avec MuseScore (décisions de Jean, 10/10/2026) :
 *  - pas vides (p. ex. mi→fa en touches noires, ou deux hauteurs égales) : MuseScore rend la note MUETTE (`renderDiscreteGlissando` retourne sans rien
 *    émettre, puis `NoteRenderer::render` retourne) ; Scorsaire joue la note normalement ;
 *  - glissando continu : `NoteEvent::calculatePitchCurve` ne met pas la courbe à l'échelle quand la plage vaut 0 ou exactement +1 demi-ton (la
 *    courbe brute monte alors de 2 demi-tons) ; Scorsaire atteint toujours la hauteur d'arrivée.
 * Non porté : harpe (`glissandoStyleHarp`, pédales).
 */
import { diatonicIndex, midiFromSpelling } from '../model/pitch.js';
import { keyAlters } from './ornaments.js';

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// `whiteNotes` de Glissando::pitchSteps, indexé par (hauteur − 60 + 1200) % 12
const WHITE_NOTES = [true, false, true, false, true, true, false, true, false, true, false, true];
const MAX_DIATONIC_LOOP = 400; // garde-fou (la boucle de MuseScore se termine toujours : la hauteur se rapproche de l'arrivée)

/** Type d'articulation MPE d'un style de lecture (`SpannersMetaParser` : PORTAMENTO → ContinuousGlissando, sinon DiscreteGlissando). */
export const glissandoArticulationType = (style) => (style === 'portamento' ? 'ContinuousGlissando' : 'DiscreteGlissando');

/**
 * Demi-tons (signés) du degré diatonique `delta` (signé, 0 = la note de départ) à partir de la note de départ, avec l'armure et les altérations
 * déjà posées dans la mesure de l'accord d'ARRIVÉE (`chromaticPitchSteps` : `findAccidental` sur le segment de l'accord d'arrivée). Portée sans
 * hauteurs diatoniques (tablature) : le nombre de degrés brut.
 * @param {{ spelling: {step, octave}, keySig: number, state: Map<string, number> , pitched: boolean }} d  `spelling` = orthographe de la note de départ ;
 *   `keySig`/`state` = armure et altérations (`Map « D4 » → altération`) à l'accord d'arrivée.
 */
export function diatonicHalfSteps(pitchStart, delta, d) {
  if (delta === 0) return 0;
  if (!d.pitched) return delta;
  const index = diatonicIndex(d.spelling) + delta;
  const step = STEPS[((index % 7) + 7) % 7];
  const octave = Math.floor(index / 7);
  const alter = d.state.has(`${step}${octave}`) ? d.state.get(`${step}${octave}`) : (keyAlters(d.keySig)[step] ?? 0);
  return midiFromSpelling({ step, alter: 0, octave }) + alter - pitchStart;
}

/**
 * Pas de hauteur d'un glissando DISCRET (`Glissando::pitchSteps`) : décalages en demi-tons depuis la note de départ, note d'arrivée exclue.
 * Retourne `[]` si les hauteurs sont égales ou si aucun pas ne subsiste (touches blanches / noires, diatonique), `null` pour `portamento`
 * (pas de pas : glissando continu).
 * @param {{ style: string, pitchStart: number, pitchEnd: number, diatonic?: object }} a  `diatonic` : voir `diatonicHalfSteps` (style 'diatonic' seulement).
 */
export function glissandoPitchSteps({ style, pitchStart, pitchEnd, diatonic }) {
  if (style === 'portamento') return null;
  if (pitchEnd === pitchStart) return [];
  const direction = pitchEnd > pitchStart ? 1 : -1;
  const before = (pitch) => (direction === 1 ? pitch < pitchEnd : pitch > pitchEnd);
  const out = [];
  if (style === 'diatonic') {
    // on monte (ou descend) d'un degré à la fois ; le pas est gardé tant que sa hauteur est avant l'arrivée
    let pitch = pitchStart;
    for (let k = 0; before(pitch) && k < MAX_DIATONIC_LOOP; k++) {
      const half = diatonicHalfSteps(pitchStart, direction * k, diatonic);
      pitch = pitchStart + half;
      if (before(pitch)) out.push(half);
    }
    return out;
  }
  if (style === 'whiteKeys' || style === 'blackKeys') {
    const pick = style === 'whiteKeys';
    for (let pitch = pitchStart; pitch !== pitchEnd; pitch += direction) {
      if (WHITE_NOTES[(pitch - 60 + 1200) % 12] === pick) out.push(pitch - pitchStart);
    }
    return out;
  }
  for (let pitch = pitchStart; pitch !== pitchEnd; pitch += direction) out.push(pitch - pitchStart); // chromatic (défaut)
  return out;
}

/**
 * Pas datés d'un glissando discret (`GlissandosRenderer::renderDiscreteGlissando`) : durée d'un pas = `total / nombre de pas` ; le pas i commence à
 * `start + i × pas`. `tiedBack` (la note est la suite d'une liaison) : le premier pas est sauté (la note précédente a été prolongée d'un pas).
 * @returns {{ index: number, offset: number, duration: number }[]}  `offset` depuis `start`.
 */
export function discreteGlissandoSteps({ steps, total, tiedBack = false }) {
  if (!steps.length) return [];
  const duration = total / steps.length;
  const out = [];
  for (let i = tiedBack ? 1 : 0; i < steps.length; i++) out.push({ index: i, offset: i * duration, duration });
  return out;
}

/** Durée d'un pas (`GlissandosRenderer::discreteGlissandoStepDuration`) : 0 sans pas. */
export const discreteStepDuration = (steps, noteDuration) => (steps.length ? noteDuration / steps.length : 0);

/**
 * Courbe de hauteur d'un glissando continu : points { t, semitones } (secondes, même base que la note ; demi-tons relatifs à la hauteur de la note).
 * Profil `pitchPattern` (`pc`, 11 valeurs en centièmes de la plage, positions 0..100 % par 10 %) ; la plage vaut toujours exactement
 * `pitchEnd − pitchStart` (voir l'en-tête). La courbe court du début de l'accord de départ au début de l'accord d'arrivée (`overallDuration` du spanner).
 */
export function continuousGlissandoCurve({ pc, range, start, span }) {
  const n = pc.length - 1;
  return pc.map((value, i) => ({ t: start + (span * i) / n, semitones: (range * value) / 100 }));
}
