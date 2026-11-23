/*
 * Préréglages du swing — palette de tempo et « feeling ternaire » de MuseScore 4.7.5 (`palettecreator.cpp`, `tripletfeel.h/.cpp`).
 * `unit` : unité du swing ('eighth' | '16th' | 'none' = swing désactivé) ; `ratio` : % de l'unité (`swingRatio`).
 *   - « Swing » : croche, 60 (valeurs par défaut de `StaffTextBase`) ; « Straight » : unité 0, ratio du style (60) ;
 *   - triolet 66, pointé 75, écossais 25 (`TripletFeel::tripletRatio / dottedRatio / scottishRatio`), en croches ou doubles croches ;
 *   - « aucun feeling » : unité 0, ratio 0 (`zeroRatio`).
 * `text` : texte affiché pour « Swing » et « Straight » (les feelings s'affichent en symboles de note, avec l'affichage des signes de masterbar).
 */
export const SWING_PRESETS = Object.freeze({
  swing: Object.freeze({ unit: 'eighth', ratio: 60, text: 'Swing' }),
  straight: Object.freeze({ unit: 'none', ratio: 60, text: 'Straight' }),
  tripletEighth: Object.freeze({ unit: 'eighth', ratio: 66, text: null }),
  tripletSixteenth: Object.freeze({ unit: '16th', ratio: 66, text: null }),
  dottedEighth: Object.freeze({ unit: 'eighth', ratio: 75, text: null }),
  dottedSixteenth: Object.freeze({ unit: '16th', ratio: 75, text: null }),
  scottishEighth: Object.freeze({ unit: 'eighth', ratio: 25, text: null }),
  scottishSixteenth: Object.freeze({ unit: '16th', ratio: 25, text: null }),
  none: Object.freeze({ unit: 'none', ratio: 0, text: null }),
  custom: Object.freeze({ unit: 'eighth', ratio: 60, text: null }),
});
