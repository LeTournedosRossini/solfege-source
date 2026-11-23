/*
 * Constantes de mise en page, en ESPACES DE PORTÉE (1 = interligne). Valeurs reprises du prototype
 * (`reference/prototype-rendu.html`, qui fait foi) ; celles qui viennent de MuseScore sont vérifiées dans son code
 * (le commentaire indique le `Sid` correspondant).
 */

export const DEFAULT_QUARTER_NOTE_SPACE = 3.5; // Sid::spacing… largeur naturelle d'une noire avant étirement (MuseScore)

export const LEFT_PAD = 0.6; // marge avant la clé, en début de système
export const GLYPH_PAD = 0.675; // espace clé → armure / chiffrage / note
export const TIMESIG_PAD = 1.8; // espace après le chiffrage (toujours réservé, même sans chiffrage)
export const BARLINE_GAP = 1.35; // espace après une barre de mesure (jamais avant la 1re mesure d'une ligne)
export const BRACE_W = 1.8; // place de l'accolade, à gauche du système

export const KEY_SIG_GAP = 0.12; // entre deux altérations d'une armure
export const KEY_SIG_END_PAD = 0.35; // respiration après une armure

// Barres de mesure (Sid::barWidth, endBarWidth, doubleBarDistance, repeatBarlineDotSeparation…)
export const BARLINE_THIN_W = 0.18;
export const BARLINE_THICK_W = 0.55;
export const BARLINE_LINE_GAP = 0.37;
export const BARLINE_DOT_GAP = 0.37; // Sid::repeatBarlineDotSeparation
export const BARLINE_DOT_W = 0.4; // largeur du point de reprise (glyphe repeatDot)
export const BARLINE_DASH_LEN = 0.6; // Sid::dashBarDash
export const BARLINE_DASH_GAP = 0.57; // Sid::dashBarGap

// Volta (MuseScore `styledef.cpp`, prototype)
export const VOLTA_ABOVE_GAP = 3.0; // au-dessus de la ligne du haut (voltaPosAbove)
export const VOLTA_HOOK_H = 2.2; // voltaHook
export const VOLTA_LINE_W = 0.11; // voltaLineWidth
export const VOLTA_TEXT_OFFSET_X = 0.6; // voltaOffset.x
export const VOLTA_TEXT_SIZE = 0.85; // corps du texte, en espaces (prototype)

export const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/**
 * Clés : glyphe, position verticale du repère (0 = ligne du bas, 4 = ligne du haut), positions des altérations d'armure
 * (extraites de `ClefInfo::clefTable`, MuseScore `dom/clef.cpp`), et indice diatonique de la note de la ligne du bas
 * (sert à placer une note : `noteY`).
 */
export const CLEF_DEFS = {
  // clé de percussion (`ClefType::PERC`, `clef.cpp`) : centrée sur la portée, aucune hauteur ni altération d'armure (portée sans armure) ;
  // `musicY` = milieu d'une portée à 5 lignes (le peintre `percussion` le recalcule pour 1, 2, 3 lignes)
  PERC: { glyph: 'unpitchedPercussionClef1', musicY: 2, bottomLine: null, sharpPos: {}, flatPos: {} },
  G: {
    glyph: 'gClef', musicY: 1, bottomLine: { step: 'E', octave: 4 },
    sharpPos: { F: 4, C: 2.5, G: 4.5, D: 3, A: 1.5, E: 3.5, B: 2 },
    flatPos: { B: 2, E: 3.5, A: 1.5, D: 3, G: 1, C: 2.5, F: 0.5 },
  },
  F: {
    glyph: 'fClef', musicY: 3, bottomLine: { step: 'G', octave: 2 },
    sharpPos: { F: 3, C: 1.5, G: 3.5, D: 2, A: 0.5, E: 2.5, B: 1 },
    flatPos: { B: 1, E: 2.5, A: 0.5, D: 2, G: 0, C: 1.5, F: -0.5 },
  },
  C3: {
    glyph: 'cClef', musicY: 2, bottomLine: { step: 'F', octave: 3 },
    sharpPos: { F: 3.5, C: 2, G: 4, D: 2.5, A: 1, E: 3, B: 1.5 },
    flatPos: { B: 1.5, E: 3, A: 1, D: 2.5, G: 0.5, C: 2, F: 0 },
  },
  C4: {
    glyph: 'cClef', musicY: 3, bottomLine: { step: 'D', octave: 3 },
    sharpPos: { F: 1, C: 3, G: 1.5, D: 3.5, A: 2, E: 4, B: 2.5 },
    flatPos: { B: 2.5, E: 4, A: 2, D: 3.5, G: 1.5, C: 3, F: 1 },
  },
  // Les trois autres clés d'ut (`ClefType::C1`, `C2`, `C5`, `clef.cpp`) : la ligne de la clé (colonne « line » de la table : 1, 2, 5)
  // porte le do central, donc la ligne du bas est une tierce plus bas par ligne qui la sépare de lui ; positions d'armure = colonnes
  // « lines for sharps / flats » de la table, en demi-interlignes depuis la ligne du haut (4 − valeur / 2 depuis celle du bas — même
  // conversion que pour C3 et C4, dont les valeurs de la table redonnent exactement celles ci-dessus).
  C1: { // ut 1re ligne (soprano)
    glyph: 'cClef', musicY: 0, bottomLine: { step: 'C', octave: 4 },
    sharpPos: { F: 1.5, C: 3.5, G: 2, D: 4, A: 2.5, E: 4.5, B: 3 },
    flatPos: { B: 3, E: 1, A: 2.5, D: 0.5, G: 2, C: 0, F: 1.5 },
  },
  C2: { // ut 2e ligne (mezzo-soprano)
    glyph: 'cClef', musicY: 1, bottomLine: { step: 'A', octave: 3 },
    sharpPos: { F: 2.5, C: 1, G: 3, D: 1.5, A: 3.5, E: 2, B: 4 },
    flatPos: { B: 4, E: 2, A: 3.5, D: 1.5, G: 3, C: 1, F: 2.5 },
  },
  C5: { // ut 5e ligne (baryton)
    glyph: 'cClef', musicY: 4, bottomLine: { step: 'B', octave: 2 },
    sharpPos: { F: 2, C: 4, G: 2.5, D: 4.5, A: 3, E: 1.5, B: 3.5 },
    flatPos: { B: 3.5, E: 1.5, A: 3, D: 1, G: 2.5, C: 0.5, F: 2 },
  },
};

/**
 * Clés d'octave (`ClefInfo::clefTable`, MuseScore `dom/clef.cpp` : G15_MB, G8_VB, G8_VA, G15_MA, F15_MB, F8_VB, F_8VA, F_15MA) : même ligne que la clé de
 * base et MÊMES positions d'armure (listes identiques dans la table), glyphe propre ; seule la hauteur de la note de la ligne du bas change
 * (`pitchOffset` de la table : 8vb = −7, 15mb = −14, 8va = +7, 15ma = +14 degrés par rapport à la clé de base).
 */
for (const [key, base, glyph, octaves] of [
  ['G15mb', 'G', 'gClef15mb', -2], ['G8vb', 'G', 'gClef8vb', -1], ['G8va', 'G', 'gClef8va', 1], ['G15ma', 'G', 'gClef15ma', 2],
  ['F15mb', 'F', 'fClef15mb', -2], ['F8vb', 'F', 'fClef8vb', -1], ['F8va', 'F', 'fClef8va', 1], ['F15ma', 'F', 'fClef15ma', 2],
]) {
  const b = CLEF_DEFS[base];
  CLEF_DEFS[key] = { ...b, glyph, bottomLine: { step: b.bottomLine.step, octave: b.bottomLine.octave + octaves } };
}

// Altérations : respiration après le glyphe, avant la tête (prototype : ACCIDENTAL_PAD) ; espace ajouté en tête de mesure
// quand la 1re note n'a pas d'altération (prototype : EXTRA_NO_ACC_GAP) ; largeur de tête utilisée pour les lignes supplémentaires
export const ACCIDENTAL_PAD = 0.15;
export const EXTRA_NO_ACC_GAP = 0.6;
export const LEDGER_HEAD_WIDTH = 1.18;
// silences de double et triple croche : espace ajouté (glyphes plus chargés que leur boîte, prototype `itemWidth`)
export const SHORT_REST_EXTRA = 0.9;

// Changements d'armure / de chiffrage en cours de ligne et courtoisies (MuseScore `styledef.cpp`, prototype)
export const KEYSIG_LEFT_MARGIN = 0.5; // keysigLeftMargin : entre la barre et l'armure qui suit
export const KEYSIG_TRAILER_MARGIN = 0.5; // systemTrailerRightMargin : entre l'armure de précaution et la barre
export const TIMESIG_LEFT_MARGIN = 0.63; // timesigLeftMargin
export const TIMESIG_BARLINE_MARGIN = 0.5; // timesigBarlineDistance : entre un chiffrage de précaution et la barre
// marge ajoutée entre une armure qui change et la 1re note, SEULEMENT si celle-ci porte une altération visible (demande de Jean) —
// moitié de la valeur initiale (0,5 sp), comme demandé
export const KEYSIG_ACCIDENTAL_MARGIN = 0.25;

// Changement de clé en cours de mesure (prototype, Sid vérifiés dans MuseScore — voir clefchanges.js)
export const SMALL_CLEF_MAG = 0.8; // Sid::smallClefMag
export const CLEF_LEFT_MARGIN = 0.75; // Sid::clefLeftMargin — marge avant une clé insérée en cours de ligne
export const CLEF_BARLINE_MARGIN = 0.5; // Sid::clefBarlineDistance — marge entre une clé de courtoisie et la barre qui suit (pas encore utilisé)
export const CLEF_CHANGE_GAP = 0.35; // espace après une clé insérée en cours de ligne, avant la note suivante (approximation, comme EXTRA_NO_ACC_GAP)

export const ABSOLUTE_MIN_HEADER_DISTANCE = 1.5; // `absoluteMinHeaderDist` de MuseScore : écart mini bord d'en-tête → élément le plus à gauche de la 1re colonne
