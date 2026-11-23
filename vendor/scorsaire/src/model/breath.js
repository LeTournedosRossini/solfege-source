/*
 * Respirations et césures — port de MuseScore 4.7.5 (`dom/breath.cpp`/`.h` : `Breath::BREATH_LIST`, `Score::rebuildTempoAndTimeSigMaps`,
 * `TempoMap::setPause`, `TLayout::layoutBreath`).
 *
 * Écriture : `PID.BREATHS` (PORTÉE, liste) = `{ id, afterId, breathType, pause? }` (`createBreath`). Une respiration se pose APRÈS un accord ou un
 * silence de la portée (`afterId`, ancrage par IDENTITÉ) : elle est placée à l'instant de fin de cet élément (chez MuseScore : un segment « Breath » entre
 * deux segments d'accord, de même `tick` que le suivant ; à la fin d'une mesure, il reste dans cette mesure, avant la barre). `breathType` = nom du
 * glyphe SMuFL (`BREATH_TYPES`). 4 respirations sans pause (virgule, tick, Salzedo, archet) et 6 césures (pause de 2 s).
 * `pause` (secondes) : facultative ; sans valeur locale, celle du type (MuseScore l'écrit à la création depuis la table ; ici dérivée).
 *
 * Lecture : à chaque instant où une respiration finit un élément, le temps s'arrête `pause` secondes avant l'attaque suivante ; la plus longue pause
 * de l'instant l'emporte, toutes portées confondues (`rebuildTempoAndTimeSigMaps` : « find longest pause » → `setPause(tick, longueur)`). Le calcul
 * est dans `tempomap.js` (`breathPauses`).
 */
export const BREATH_TYPES = Object.freeze({
  breathMarkComma: Object.freeze({ caesura: false, pause: 0 }),
  breathMarkTick: Object.freeze({ caesura: false, pause: 0 }),
  breathMarkSalzedo: Object.freeze({ caesura: false, pause: 0 }),
  breathMarkUpbow: Object.freeze({ caesura: false, pause: 0 }),
  caesuraCurved: Object.freeze({ caesura: true, pause: 2 }),
  caesura: Object.freeze({ caesura: true, pause: 2 }),
  caesuraShort: Object.freeze({ caesura: true, pause: 2 }),
  caesuraThick: Object.freeze({ caesura: true, pause: 2 }),
  chantCaesura: Object.freeze({ caesura: true, pause: 2 }),
  caesuraSingleStroke: Object.freeze({ caesura: true, pause: 2 }),
});

/** Pause en secondes d'une entrée de `PID.BREATHS` : valeur locale, sinon celle du type. 0 pour un type inconnu. */
export function breathPause(entry) {
  if (typeof entry.pause === 'number') return entry.pause;
  return BREATH_TYPES[entry.breathType]?.pause ?? 0;
}

/** Validation d'une entrée de `PID.BREATHS` : liste de messages. `known(id)` dit si l'élément visé existe dans la portée. */
export function validateBreaths(list, known) {
  const errors = [];
  const after = new Set();
  for (const b of list) {
    if (!BREATH_TYPES[b.breathType]) errors.push(`respiration ${b.id} : type inconnu (${b.breathType})`);
    if (!known(b.afterId)) errors.push(`respiration ${b.id} : élément visé inexistant dans la portée (${b.afterId})`);
    if (b.pause !== undefined && !(typeof b.pause === 'number' && b.pause >= 0)) errors.push(`respiration ${b.id} : pause négative ou invalide`);
    if (after.has(b.afterId)) errors.push(`respiration ${b.id} : deux respirations après le même élément (${b.afterId})`);
    after.add(b.afterId);
  }
  return errors;
}
