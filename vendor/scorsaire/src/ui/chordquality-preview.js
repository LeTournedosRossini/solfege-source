/*
 * Aperçu d'une qualité d'accord pour l'éditeur du dictionnaire (tranche 5) — AUCUN DOM. Le symbole est dessiné par le VRAI peintre `chord`
 * (mêmes règles que dans la partition) : un mini-Mouvement jetable (une portée d'accords, une mesure, un symbole) passe par `layoutMovement`
 * puis `renderSvgString`. Rien n'est écrit dans le Document ; les identifiants consommés par le mini-Mouvement n'appartiennent à aucun document.
 */
import { createMasterbar, createMovement, createTrack, createStaff, createVoice, createMeasure, createChordSymbol } from '../model/index.js';
import { layoutMovement } from '../layout/index.js';
import { renderSvgString } from '../render/svg.js';

/**
 * @param glyphs  sous-ensemble Bravura
 * @param root    { step, alter }
 * @param quality texte de qualité (identifiant ; '' = majeur)
 * @param chordQualities dictionnaire en vigueur (écriture choisie de la qualité)
 * @returns chaîne SVG
 */
export function chordSymbolPreviewSvg(glyphs, { root, quality = '', bass = null, staffSpace = 20, widthSp = 11, chordQualities, getStyle, cropLeft = false, bare = false } = {}) {
  const symbol = createChordSymbol({ root, quality, bass, position: [0, 1], duration: 'whole' });
  const staff = createStaff({ type: 'chord', voices: [createVoice([createMeasure([symbol])])] });
  const movement = createMovement({ masterbars: [createMasterbar({ barType: 'simple' })], tracks: [createTrack({ staves: [staff] })] });
  const layout = layoutMovement(movement, glyphs, { width: widthSp, chordQualities, getStyle });
  let svg = renderSvgString(layout, glyphs, { staffSpace, canvasWidth: widthSp * staffSpace + 20 });
  const barXs = [...svg.matchAll(/data-role="barline"[^>]* x1="(-?[\d.]+)"/g)].map((m) => Number(m[1])); // before the bars are left out
  // bare: only the symbol, without the bars and the time signature of the sample staff
  if (bare) svg = svg.replace(/<line data-role="barline"[^>]*\/>/g, '').replace(/<g data-glyph="timeSig\d+"[^>]*>[\s\S]*?<\/g>/g, '');
  // la page du mini-Mouvement a des marges verticales : on recadre sur la portée d'accords (barres de 4 sp + symbole)
  const at = /data-staff-type="chord" transform="translate\([^,]+,(-?[\d.]+)\)"/.exec(svg);
  if (!at) return svg;
  const top = Number(at[1]) - 5 * staffSpace;
  let width = widthSp * staffSpace + 20;
  const height = 5.8 * staffSpace;
  let left = 0;
  if (cropLeft) { // start just before the opening bar of the staff: leaves out the time signature drawn in front of it
    const sys = /data-system="0" transform="translate\((-?[\d.]+),/.exec(svg);
    if (sys && barXs.length) { left = Math.max(0, Number(sys[1]) + Math.min(...barXs) - (bare ? 0 : 0.12) * staffSpace); width -= left; }
  }
  return svg.replace(/width="[\d.]+" height="[\d.]+" viewBox="[^"]*"/, `width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}"`);
}
