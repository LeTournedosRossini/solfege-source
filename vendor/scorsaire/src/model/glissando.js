// Glissandos : propriétés de LECTURE (PID.GLISSANDOS, portée) — port du modèle de `Glissando` (MuseScore 4.7.5, `glissando.cpp`, `types.h`).
// L'affichage (droit / ondulé) est dans layout/glissandos.js ; ici seulement ce qui décide du SON.
//
// GLISSANDO RUN (organ white-key run, see glissandorun.js): an entry with NO start note (only `endNoteId`, the arrival) and a `startInterval`
// (semitones, start minus arrival, usually negative): the start is not written, only a line into the arrival. It carries ONE of the optional fields `runDuration` (total length of the run) or `stepDuration` (length of each step), as fractions of a whole
// note ([n, d], model/fraction.js). The run sounds BEFORE the beat, ending exactly at the onset of the arrival note, which is not moved.
import { isFraction } from './fraction.js';

/** Styles de lecture (`GlissandoStyle`, types.h) ; la harpe (`glissandoStyleHarp`, pédales) n'est pas portée. */
export const GLISSANDO_STYLES = Object.freeze(['chromatic', 'whiteKeys', 'blackKeys', 'diatonic', 'portamento']);

/** Style de lecture effectif d'une entrée : valeur locale, sinon style (`SID.GLISSANDO_STYLE`), sinon chromatique (défaut MuseScore). */
export function glissandoStyleOf(entry, styleValue) {
  const s = entry?.glissandoStyle ?? styleValue;
  return GLISSANDO_STYLES.includes(s) ? s : 'chromatic';
}

/** Un glissando est joué sauf `play === false` (`Spanner::playSpanner`). */
export function glissandoPlays(entry) {
  return entry?.play !== false;
}

/** Is this entry a glissando RUN (grace-note start, timed by `runDuration` or `stepDuration`) ? */
export const isRunEntry = (entry) => entry?.runDuration !== undefined || entry?.stepDuration !== undefined;

const positiveFraction = (v) => isFraction(v) && v[0] > 0;

/** Erreurs de validation des propriétés de lecture (les notes de bord invalides sont ignorées par la mise en page, comme avant). */
export function validateGlissandos(list) {
  const errors = [];
  for (const g of list) {
    if (g.glissandoStyle !== undefined && !GLISSANDO_STYLES.includes(g.glissandoStyle)) errors.push(`glissando ${g.id} : style de lecture inconnu « ${g.glissandoStyle} »`);
    if (g.play !== undefined && typeof g.play !== 'boolean') errors.push(`glissando ${g.id} : play doit être un booléen`);
    if (g.runDuration !== undefined && !positiveFraction(g.runDuration)) errors.push(`glissando ${g.id} : runDuration doit être une fraction positive de ronde`);
    if (g.stepDuration !== undefined && !positiveFraction(g.stepDuration)) errors.push(`glissando ${g.id} : stepDuration doit être une fraction positive de ronde`);
    if (g.startInterval !== undefined && (!Number.isInteger(g.startInterval) || g.startInterval === 0)) errors.push(`glissando ${g.id} : startInterval doit être un entier non nul (demi-tons)`);
    if (g.runDuration !== undefined && g.stepDuration !== undefined) errors.push(`glissando ${g.id} : runDuration et stepDuration s'excluent`);
  }
  return errors;
}
