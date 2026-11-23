/*
 * Positionneur de percussion : relie une portée de percussion à sa percmap (`model/percmap.js`) pour la mise en page.
 * Dans `entry.clefKey` d'une portée de percussion (à la place d'une clé), il fournit à `chordYs` la hauteur de chaque note (port de
 * `SegmentLayout::layoutChordDrumset` : `posY = (line + stepOffset·2)·spatium·½·lineDistance` ; ici repère de portée y vers le haut, 0 = ligne du bas)
 * et à la mise en page la tête de chaque son. Un son absent de la percmap (jamais pour un fichier valide : `validate.js`) est posé sur la ligne du milieu
 * avec une tête ordinaire.
 */
import { PID, getProperty, staffSoundMap, drumIndex, drumLineToY, drumHeadGlyph } from '../model/index.js';
import { headGlyph } from './chordgeom.js';

export function drumPositioner(staff, glyphs, lineCount = 5) {
  const percmap = staffSoundMap(getProperty(staff, PID.PERCMAP));
  const index = drumIndex(percmap);
  const soundOf = (note) => index.get(getProperty(note, PID.SOUND)) ?? null;
  const widthOf = (name) => glyphs.glyphs[name].bbox.bBoxNE[0];
  return {
    perc: true,
    percmap,
    lineCount,
    soundOf,
    noteY: (note) => {
      const s = soundOf(note);
      return s ? drumLineToY(s.line, lineCount) : (lineCount - 1) / 2;
    },
    /** Glyphe de tête de la note pour une valeur écrite. */
    noteHead(note, base) {
      const s = soundOf(note);
      return s ? drumHeadGlyph(s.head, base) : headGlyph(base);
    },
    /** Tête la plus large de l'accord (largeurs de colonne, têtes en seconde, hampe). */
    chordHead(chord, base) {
      let best = null;
      for (const n of chord.notes) {
        const g = this.noteHead(n, base);
        if (!best || widthOf(g) > widthOf(best)) best = g;
      }
      return best ?? headGlyph(base);
    },
    /** Sens de hampe imposé par le son de la note (`percmap.stemDirection`) : true (haut), false (bas) ou null (auto). */
    soundStem(note) {
      const s = soundOf(note);
      return s && s.stemDirection !== 'auto' ? s.stemDirection === 'up' : null;
    },
  };
}
