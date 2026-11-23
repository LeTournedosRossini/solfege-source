/*
 * Table des distances minimales entre types d'éléments (`PaddingTable`, MuseScore 4.7.5, `rendering/paddingtable.cpp`).
 * PORT FIDÈLE : `table[type1][type2]` = marge (en espaces) à laisser entre le bord DROIT d'un élément de type1 et le bord GAUCHE d'un
 * élément de type2 qui le suit ; tout ce qui n'est pas fixé vaut `minPadUnit` = 0,1 sp. L'ORDRE des affectations compte (certaines
 * lignes/colonnes en recopient d'autres au moment où elles sont écrites) : il est conservé tel quel.
 * `values` = réglages de style de MuseScore (clés = noms de `Sid`, en espaces) ; défauts = `styledef.cpp` 4.7.5.
 * Fonction pure, sans DOM.
 */

export const PADDING_TYPES = [
  'NOTE', 'LEDGER_LINE', 'ACCIDENTAL', 'REST', 'CLEF', 'ARPEGGIO', 'BAR_LINE', 'KEYSIG', 'TIMESIG', 'HOOK', 'NOTEDOT', 'AMBITUS',
  'CHORD_BRACKET', 'BREATH', 'HARMONY', 'FRET_DIAGRAM', 'CHORDLINE', 'BEAM', 'TREMOLO_SINGLECHORD', 'LYRICS', 'ARTICULATION', 'FERMATA',
  'LAISSEZ_VIB_SEGMENT', 'MEASURE_REPEAT', 'STEM', 'TAPPING', 'TAPPING_HALF_SLUR_SEGMENT', 'FINGERING', 'STEM_SLASH', 'PARENTHESIS',
  'GUITAR_BEND_SEGMENT',
];
const N = PADDING_TYPES.length;
const IDX = Object.fromEntries(PADDING_TYPES.map((t, i) => [t, i]));

/** Réglages de style de MuseScore 4.7.5 (`styledef.cpp`) utilisés par la table, en espaces. */
export const MUSESCORE_PADDING_STYLE = {
  accidentalNoteDistance: 0.25, noteBarDistance: 1.5, clefKeyRightMargin: 0.8, clefBarlineDistance: 0.5, clefKeyDistance: 0.75,
  clefTimesigDistance: 1.0, barNoteDistance: 1.25, barAccidentalDistance: 0.65, clefLeftMargin: 0.75, keysigLeftMargin: 0.5,
  timesigLeftMargin: 0.63, keyBarlineDistance: 1.0, keyTimesigDistance: 1.0, timesigBarlineDistance: 0.5, minNoteDistance: 0.35,
  dotNoteDistance: 0.5, dotDotDistance: 0.65, ledgerLineLength: 0.33, arpeggioNoteDistance: 0.4, arpeggioAccidentalDistance: 0.3,
  chordBracketNoteDistance: 0.15, harmonyHarmonyDistance: 0.5, lyricsMinDistance: 0.25, ambitusMargin: 0.5, lyricsMelismaPad: 0.2,
  graceToMainNoteDist: 0.45, graceToGraceNoteDist: 0.3, lyricsMelismaForce: false, lyricsMelismaMinLength: 1.0, lyricsDashForce: true, lyricsDashMinLength: 0.4, lyricsDashPad: 0.05, minTieLength: 1.0, minStraightGlissandoLength: 1.2, minWigglyGlissandoLength: 2.0,
};

/** @returns {{ at(type1, type2): number, table: Float64Array[] }} */
export function createPaddingTable(values = {}) {
  const v = { ...MUSESCORE_PADDING_STYLE, ...values };
  const unit = 0.1; // minPadUnit
  const t = Array.from({ length: N }, () => new Float64Array(N).fill(unit));
  const set = (a, b, x) => { t[IDX[a]][IDX[b]] = x; };
  const get = (a, b) => t[IDX[a]][IDX[b]];
  const fillRow = (a, x) => t[IDX[a]].fill(x);
  const fillCol = (b, x) => { for (const row of t) row[IDX[b]] = x; };
  const copyRow = (to, from) => { t[IDX[to]] = Float64Array.from(t[IDX[from]]); };
  const copyCol = (to, from) => { for (const row of t) row[IDX[to]] = row[IDX[from]]; };
  const ledgerPad = 0.25;
  const L = v.ledgerLineLength;

  set('NOTE', 'NOTE', unit);
  set('NOTE', 'LEDGER_LINE', 0.35);
  set('NOTE', 'ACCIDENTAL', Math.max(v.accidentalNoteDistance, 0.35));
  set('NOTE', 'REST', 0.5);
  set('NOTE', 'CLEF', 0.8);
  set('NOTE', 'ARPEGGIO', 0.6);
  set('NOTE', 'BAR_LINE', v.noteBarDistance);
  set('NOTE', 'KEYSIG', 0.75);
  set('NOTE', 'TIMESIG', 0.75);

  set('LEDGER_LINE', 'NOTE', get('NOTE', 'LEDGER_LINE'));
  set('LEDGER_LINE', 'LEDGER_LINE', ledgerPad);
  set('LEDGER_LINE', 'ACCIDENTAL', Math.max(v.accidentalNoteDistance, get('NOTE', 'ACCIDENTAL') - L / 2));
  set('LEDGER_LINE', 'REST', get('LEDGER_LINE', 'NOTE'));
  set('LEDGER_LINE', 'CLEF', Math.max(get('NOTE', 'CLEF') - L / 2, ledgerPad));
  set('LEDGER_LINE', 'ARPEGGIO', 0.5);
  set('LEDGER_LINE', 'BAR_LINE', Math.max(get('NOTE', 'BAR_LINE') - L, ledgerPad));
  set('LEDGER_LINE', 'KEYSIG', Math.max(get('NOTE', 'KEYSIG') - L / 2, ledgerPad));
  set('LEDGER_LINE', 'TIMESIG', Math.max(get('NOTE', 'TIMESIG') - L / 2, ledgerPad));

  set('HOOK', 'NOTE', 0.35);
  set('HOOK', 'LEDGER_LINE', Math.max(get('HOOK', 'NOTE') - L, ledgerPad));
  set('HOOK', 'ACCIDENTAL', 0.35);
  set('HOOK', 'REST', get('HOOK', 'NOTE'));
  set('HOOK', 'CLEF', 0.5);
  set('HOOK', 'ARPEGGIO', 0.35);
  set('HOOK', 'BAR_LINE', 1);
  set('HOOK', 'KEYSIG', 1.15);
  set('HOOK', 'TIMESIG', 1.15);

  set('NOTEDOT', 'NOTE', Math.max(v.dotNoteDistance, v.dotDotDistance));
  set('NOTEDOT', 'LEDGER_LINE', Math.max(get('NOTEDOT', 'NOTE') - L, ledgerPad));
  set('NOTEDOT', 'ACCIDENTAL', 0.35);
  set('NOTEDOT', 'REST', get('NOTEDOT', 'NOTE'));
  set('NOTEDOT', 'CLEF', 1.0);
  set('NOTEDOT', 'ARPEGGIO', 0.5);
  set('NOTEDOT', 'BAR_LINE', 0.8);
  set('NOTEDOT', 'KEYSIG', 1.35);
  set('NOTEDOT', 'TIMESIG', 1.35);

  set('REST', 'NOTE', get('NOTE', 'REST'));
  set('REST', 'LEDGER_LINE', Math.max(get('REST', 'NOTE') - L / 2, ledgerPad));
  set('REST', 'ACCIDENTAL', 0.45);
  set('REST', 'REST', get('REST', 'NOTE'));
  set('REST', 'CLEF', get('NOTE', 'CLEF'));
  set('REST', 'BAR_LINE', 1.65);
  set('REST', 'KEYSIG', 1.5);
  set('REST', 'TIMESIG', 1.5);

  set('CLEF', 'NOTE', v.clefKeyRightMargin);
  set('CLEF', 'LEDGER_LINE', Math.max(get('CLEF', 'NOTE') - L / 2, ledgerPad));
  set('CLEF', 'ACCIDENTAL', 0.6);
  set('CLEF', 'REST', get('CLEF', 'NOTE'));
  set('CLEF', 'CLEF', 0.75);
  set('CLEF', 'ARPEGGIO', 0.65);
  set('CLEF', 'BAR_LINE', v.clefBarlineDistance);
  set('CLEF', 'KEYSIG', v.clefKeyDistance);
  set('CLEF', 'TIMESIG', v.clefTimesigDistance);

  set('BAR_LINE', 'NOTE', v.barNoteDistance);
  set('BAR_LINE', 'LEDGER_LINE', Math.max(get('BAR_LINE', 'NOTE') - L, ledgerPad));
  set('BAR_LINE', 'ACCIDENTAL', v.barAccidentalDistance);
  set('BAR_LINE', 'REST', v.barNoteDistance);
  set('BAR_LINE', 'CLEF', v.clefLeftMargin);
  set('BAR_LINE', 'ARPEGGIO', 0.65);
  set('BAR_LINE', 'BAR_LINE', 1.35);
  set('BAR_LINE', 'KEYSIG', v.keysigLeftMargin);
  set('BAR_LINE', 'TIMESIG', v.timesigLeftMargin);

  set('KEYSIG', 'NOTE', 1.75);
  set('KEYSIG', 'LEDGER_LINE', Math.max(get('KEYSIG', 'NOTE') - L, ledgerPad));
  set('KEYSIG', 'ACCIDENTAL', 1.6);
  set('KEYSIG', 'REST', get('KEYSIG', 'NOTE'));
  set('KEYSIG', 'CLEF', 1.0);
  set('KEYSIG', 'ARPEGGIO', 1.35);
  set('KEYSIG', 'BAR_LINE', v.keyBarlineDistance);
  set('KEYSIG', 'KEYSIG', 1);
  set('KEYSIG', 'TIMESIG', v.keyTimesigDistance);

  set('TIMESIG', 'NOTE', 1.35);
  set('TIMESIG', 'LEDGER_LINE', Math.max(get('TIMESIG', 'NOTE') - L, ledgerPad));
  set('TIMESIG', 'ACCIDENTAL', 0.8);
  set('TIMESIG', 'REST', get('TIMESIG', 'NOTE'));
  set('TIMESIG', 'CLEF', 1.0);
  set('TIMESIG', 'ARPEGGIO', 1.35);
  set('TIMESIG', 'BAR_LINE', v.timesigBarlineDistance);
  set('TIMESIG', 'KEYSIG', v.keyTimesigDistance);
  set('TIMESIG', 'TIMESIG', 1.0);

  // Ambitus
  fillRow('AMBITUS', v.ambitusMargin);
  fillCol('AMBITUS', v.ambitusMargin);

  set('ARPEGGIO', 'NOTE', v.arpeggioNoteDistance);
  set('ARPEGGIO', 'LEDGER_LINE', 0.3);
  set('ARPEGGIO', 'ACCIDENTAL', v.arpeggioAccidentalDistance);

  fillRow('CHORD_BRACKET', v.chordBracketNoteDistance);
  copyCol('CHORD_BRACKET', 'ARPEGGIO');

  fillRow('BREATH', 1.0);
  fillCol('BREATH', 1.0);

  set('BAR_LINE', 'HARMONY', 0.5 * v.harmonyHarmonyDistance);
  set('HARMONY', 'HARMONY', v.harmonyHarmonyDistance);
  set('HARMONY', 'FRET_DIAGRAM', 0.3);
  set('FRET_DIAGRAM', 'HARMONY', 0.3);
  set('FRET_DIAGRAM', 'FRET_DIAGRAM', 0.25);

  fillRow('CHORDLINE', 0.35);
  fillCol('CHORDLINE', 0.35);
  set('BAR_LINE', 'CHORDLINE', 0.65);
  set('CHORDLINE', 'BAR_LINE', 0.65);

  copyCol('FINGERING', 'ACCIDENTAL'); // x → fingering = x → altération

  fillRow('BEAM', 0.35); // nécessaire pour les talons de ligature, pas les ligatures elles-mêmes
  copyRow('TREMOLO_SINGLECHORD', 'BEAM');

  fillRow('LYRICS', v.lyricsMinDistance);
  fillCol('LYRICS', v.lyricsMinDistance);
  set('NOTE', 'LYRICS', v.lyricsMelismaPad);

  set('ACCIDENTAL', 'NOTE', v.accidentalNoteDistance);
  set('ACCIDENTAL', 'LEDGER_LINE', 0.18);

  set('ARTICULATION', 'NOTE', 0.25);
  set('ARTICULATION', 'REST', 0.25);
  set('ARTICULATION', 'ACCIDENTAL', 0.25);

  set('LAISSEZ_VIB_SEGMENT', 'NOTE', 0.5);
  set('LAISSEZ_VIB_SEGMENT', 'REST', 0.5);
  set('LAISSEZ_VIB_SEGMENT', 'ACCIDENTAL', 0.35);
  set('LAISSEZ_VIB_SEGMENT', 'BAR_LINE', 0.35);

  copyRow('MEASURE_REPEAT', 'NOTE');
  copyCol('MEASURE_REPEAT', 'NOTE');

  // « STEM → * » et « * → STEM » reprennent les valeurs des notes
  copyRow('STEM', 'NOTE');
  copyCol('STEM', 'NOTE');

  set('NOTE', 'STEM', v.minNoteDistance);
  set('REST', 'STEM', get('NOTE', 'STEM'));
  set('CLEF', 'STEM', 0.75);
  set('ACCIDENTAL', 'STEM', get('ACCIDENTAL', 'NOTE'));
  set('LAISSEZ_VIB_SEGMENT', 'STEM', 0.35);
  set('STEM', 'NOTE', v.minNoteDistance);
  set('STEM', 'STEM', 0.85);
  set('STEM', 'ACCIDENTAL', 0.35);
  set('STEM', 'LEDGER_LINE', 0.35);
  set('LEDGER_LINE', 'STEM', 0.35);

  const articulationAndFermata = 0.35;
  fillRow('ARTICULATION', articulationAndFermata);
  fillCol('ARTICULATION', articulationAndFermata);
  fillRow('FERMATA', articulationAndFermata);
  fillCol('FERMATA', articulationAndFermata);

  copyRow('TAPPING', 'ARTICULATION');
  copyCol('TAPPING', 'ARTICULATION');
  copyRow('TAPPING_HALF_SLUR_SEGMENT', 'ARTICULATION');
  copyCol('TAPPING_HALF_SLUR_SEGMENT', 'ARTICULATION');

  return { at: (a, b) => t[IDX[a]][IDX[b]], table: t, values: v };
}
