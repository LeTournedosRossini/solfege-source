/*
 * Tapping (4d-d, MuseScore `Tapping` / `TappingLayout`, v4.7.5) : entrée de pile d'articulation, commune aux peintres `tab` et `score`.
 * Main droite : « T » (tablature) ou « + » `pluckedLeftHandPizzicato` (portée) selon `RH_TAPPING_SYMBOL_*`. Main gauche : point `windClosedHole` à
 * l'échelle 0,5 si les symboles sont affichés (`LH_TAPPING_SHOW_ITEMS_*` ≠ halfSlur), sinon élément sans dessin (les demi-liaisons sont tracées à part).
 */
import { PID, SID, getProperty } from '../model/index.js';

export function tappingEntry(item, style, tab) {
  const tp = getProperty(item, PID.TAPPING);
  if (!tp) return null;
  const k = tab ? 'TAB' : 'NORMAL';
  if (tp.hand === 'right') return { id: `${item.id}-tap`, type: style(SID[`RH_TAPPING_SYMBOL_${k}`]) === 'plus' ? 'tapRhPlus' : 'tapRhT' };
  const show = style(SID[`LH_TAPPING_SHOW_ITEMS_${k}`]);
  return { id: `${item.id}-tap`, type: show === 'halfSlur' || style(SID[`LH_TAPPING_SYMBOL_${k}`]) !== 'dot' ? 'tapLhNone' : 'tapLhDot' };
}
