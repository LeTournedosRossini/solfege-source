/*
 * Aperçu d'un son de percussion pour l'éditeur de carte (AUCUN DOM). La portée avec la note du son est dessinée par le VRAI peintre `percussion`
 * (mêmes règles que dans la partition) : un mini-Mouvement jetable (une portée de percussion portant la carte en cours d'édition, une mesure, un accord
 * du son) passe par `layoutMovement` puis `renderSvgString`. Rien n'est écrit dans le Document.
 */
import { createMasterbar, createMovement, createTrack, createStaff, createVoice, createMeasure, createChord, createPercNote, PID } from '../model/index.js';
import { layoutMovement } from '../layout/index.js';
import { renderSvgString } from '../render/svg.js';
import { rectsOf, yExtent } from '../layout/bounds.js';

/**
 * @param glyphs  sous-ensemble Bravura
 * @param percmap carte en cours d'édition
 * @param soundId son à montrer (absent de la carte : portée vide)
 * @param lines   nombre de lignes de la portée (1 à 5) : celui de la portée éditée
 * @returns chaîne SVG
 */
export function percSoundPreviewSvg(glyphs, { percmap, soundId, lines = 5, duration = 'quarter', staffSpace = 14, widthSp = 7, margin = 0.6 } = {}) {
  const known = soundId && percmap.sounds.some((s) => s.id === soundId);
  const measure = createMeasure(known ? [createChord({ duration, notes: [createPercNote({ sound: soundId })] })] : []);
  const masterbar = createMasterbar({ barType: 'simple', timeSig: [1, 4] }); // une noire : la mesure est pleine avec la seule note
  const hidden = [{ kind: 'timeSig', measureId: masterbar.id }]; // pas de chiffrage dans l'aperçu (masqué, jamais dessiné)
  const staff = createStaff({ type: 'percussion', clef: 'G', props: { [PID.PERCMAP]: percmap, [PID.LINE_COUNT]: lines, [PID.HIDDEN_DECOR]: hidden }, voices: [createVoice([measure])] });
  const movement = createMovement({ masterbars: [masterbar], tracks: [createTrack({ staves: [staff] })] });
  const layout = layoutMovement(movement, glyphs, { width: widthSp });
  const width = widthSp * staffSpace + 20;
  const svg = renderSvgString(layout, glyphs, { staffSpace, canvasWidth: width });
  const at = /data-staff-type="percussion" transform="translate\([^,]+,(-?[\d.]+)\)"/.exec(svg);
  if (!at) return svg;
  const baseline = Number(at[1]); // ligne du bas de la portée
  // tight crop: the staff and the note (stem, ledger lines included) plus a small margin (in staff spaces)
  const ext = yExtent(rectsOf(layout.systems[0].staves[0].items, glyphs)) ?? { lo: 0, hi: 4 };
  const top = baseline - (ext.hi + margin) * staffSpace;
  const height = (ext.hi - ext.lo + 2 * margin) * staffSpace;
  return svg.replace(/width="[\d.]+" height="[\d.]+" viewBox="[^"]*"/, `width="${width}" height="${height}" viewBox="0 ${top} ${width} ${height}"`);
}
