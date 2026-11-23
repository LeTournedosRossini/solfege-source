/*
 * Sid — identifiants de STYLE (équivalent de `Sid` dans MuseScore, style/styledef.h).
 *
 * Un style est une valeur par défaut surchargeable. Une propriété (Pid) peut être « stylée » : tant qu'elle n'a
 * pas de valeur locale, elle suit le style. Chaîne de résolution (décision validée à l'étape 2) :
 *
 *   valeur locale de l'élément  >  couches de contexte (ex. onglet de l'écran 2, plus tard)
 *                               >  style du Mouvement  >  valeur par défaut du Sid.
 *
 * Valeurs MuseScore confirmées (roadmap §6, styledef.cpp) : stemLength, shortestStem, shortStemStartLocation,
 * shortenStem, useStraightNoteFlags. Épaisseurs : Bravura `engravingDefaults`. Espacement : décision du projet
 * (roadmap §6, aligné sur LilyPond).
 */

import { CHORD_PLACEMENT_DEFAULTS as PLACED } from './chord-placement-defaults.js';

export const SID = {};
export const SID_TABLE = {};

function sid(constant, type, dflt, doc) {
  const name = constant.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  SID[constant] = name;
  SID_TABLE[name] = { name, type, default: dflt, doc };
}

// --- hampes (MuseScore) ---
sid('STEM_LENGTH', 'real', 3.5, 'longueur de hampe par défaut (espaces)');
sid('SHORTEST_STEM', 'real', 2.5, 'longueur minimale de hampe');
sid('SHORT_STEM_START_LOCATION', 'real', 1, 'position à partir de laquelle la hampe raccourcit');
sid('SHORTEN_STEM', 'bool', true, 'raccourcir les hampes des notes éloignées de la portée');
sid('USE_STRAIGHT_NOTE_FLAGS', 'bool', false, 'crochets droits au lieu de courbes');
// --- épaisseurs (Bravura engravingDefaults) ---
sid('STAFF_LINE_THICKNESS', 'real', 0.13, 'épaisseur des lignes de portée');
sid('STEM_THICKNESS', 'real', 0.12, 'épaisseur des hampes');
sid('COMBINE_VOICE', 'bool', true, 'mettre les voix en page ensemble (`combineVoice` de MuseScore : conflits, décalages, alignement des points)');
sid('CHORDLINE_THICKNESS', 'real', 0.16, 'épaisseur du trait des slides (ChordLine, `chordlineThickness`)');
sid('THIN_BARLINE_THICKNESS', 'real', 0.16, 'épaisseur d\'une barre de mesure fine');
sid('THICK_BARLINE_THICKNESS', 'real', 0.5, 'épaisseur d\'une barre de mesure épaisse');
sid('BEAM_THICKNESS', 'real', 0.5, 'épaisseur d\'une ligature');
sid('LEDGER_LINE_THICKNESS', 'real', 0.16, 'épaisseur d\'une ligne supplémentaire');
sid('LEDGER_LINE_EXTENSION', 'real', 0.4, 'dépassement d\'une ligne supplémentaire de chaque côté de la tête');
sid('LEDGER_LINE_LENGTH', 'real', 0.33, 'ledgerLineLength de MuseScore : marge utilisée par la collision de têtes entre voix');
// --- trémolos (MuseScore styledef.cpp : tremoloWidth, tremoloLineWidth, tremoloDistance, tremoloNoteSidePadding,
//     tremoloOutSidePadding ; la ligature d'un trémolo à deux notes utilise BEAM_THICKNESS) ---
sid('TREMOLO_WIDTH', 'real', 1.2, 'largeur d\'une barre de trémolo (espaces)');
sid('TREMOLO_LINE_WIDTH', 'real', 0.5, 'épaisseur d\'une barre de trémolo (espaces)');
sid('TREMOLO_DISTANCE', 'real', 0.8, 'distance entre deux barres de trémolo, de bord haut à bord haut (espaces)');
sid('TREMOLO_NOTE_SIDE_PADDING', 'real', 1.25, 'marge côté tête d\'un trémolo (hampe absente : au-dessus / au-dessous de la tête)');
sid('TREMOLO_OUT_SIDE_PADDING', 'real', 0.5, 'marge côté pointe de hampe d\'un trémolo');
// --- espacement horizontal à ressorts (MuseScore horizontalspacing.cpp/styledef.cpp) ---
sid('GLISSANDO_TYPE', 'string', 'straight', 'type de glissando par défaut : straight | wavy (Sid::glissandoType)');
sid('GLISSANDO_STYLE', 'string', 'chromatic', 'LECTURE : style de glissando par défaut : chromatic | whiteKeys | blackKeys | diatonic | portamento (Sid::glissandoStyle, défaut CHROMATIC ; la harpe n\'est pas portée)');
sid('GLISSANDO_SHOW_TEXT', 'bool', true, 'afficher le texte du glissando (Sid::glissandoShowText)');
sid('GLISSANDO_TEXT', 'string', 'gliss.', 'texte du glissando (Sid::glissandoText)');
sid('GLISSANDO_LINE_WIDTH', 'real', 0.15, 'épaisseur du trait de glissando (Sid::glissandoLineWidth)');
sid('MIN_TIE_LENGTH', 'real', 1.0, 'longueur minimale d\'un tie (Sid::minTieLength) ; en tablature, réserve aussi la place d\'un glissando devant sa note d\'arrivée (chordlayout.cpp)');
sid('TIE_ARC_LINE_CLEARANCE', 'real', 0.25, 'ÉCART Scorsaire (portée de notation/percussion) : dégagement minimal entre l\'arc d\'un tie et une ligne de portée, en sp (MuseScore `adjustY` : 0,1 si tie < 3 sp, sinon 0,15) ; 0 = comportement MuseScore');
sid('MIN_STRAIGHT_GLISSANDO_LENGTH', 'real', 1.2, 'longueur minimale d\'un glissando droit entre ses deux points d\'accroche (Sid::minStraightGlissandoLength)');
sid('MIN_WIGGLY_GLISSANDO_LENGTH', 'real', 2.0, 'longueur minimale d\'un glissando ondulé (Sid::minWigglyGlissandoLength)');
sid('DIAGRAM_LIFT', 'real', 0.5, 'hauteur (espaces de portée) d\'un diagramme posé au-dessus d\'un symbole d\'accord ; chaque diagramme peut avoir la sienne (PID.DIAGRAM_LIFT)');
sid('DIAGRAM_SCALE', 'real', 1, 'taille d\'un diagramme d\'accord posé au-dessus d\'un symbole ; chaque diagramme peut avoir la sienne (PID.DIAGRAM_SCALE)');
sid('DIAGRAM_ORIENTATION', 'string', 'horizontal', 'diagramme de piano couché (horizontal) ou debout (vertical) ; chaque diagramme peut avoir la sienne (PID.DIAGRAM_ORIENTATION)');
sid('DIAGRAM_GAUGE', 'bool', true, 'diagramme de manche : cordes plus épaisses pour les notes graves ; chaque diagramme peut avoir le sien (PID.DIAGRAM_GAUGE)');
sid('DIAGRAM_DOT_COLOR', 'string', '', 'couleur (#rrggbb) des points des diagrammes ; vide = l\'encre ; chaque diagramme peut avoir la sienne (PID.COLOR)');
sid('TAB_STRING_GAUGE', 'bool', true, 'tablature : épaisseur des lignes selon le calibre de la corde (prototype) ; faux = épaisseur uniforme de MuseScore');
// --- tablature (MuseScore 4.7.5 styledef.cpp) : liaisons de prolongation et marques masquables ---
sid('TAB_SHOW_TIED_FRET', 'string', 'tieAndFret', 'tablature : numéro d\'une note liée — tieAndFret (liaison + numéro) | tie (liaison seule, numéro masqué ou entre parenthèses) | none (ni liaison ni numéro) (Sid::tabShowTiedFret)');
sid('TAB_PARENTHESIZE_TIED_FRET', 'string', 'startOfSystem', 'tablature, mode « tie » : numéro de la note liée entre parenthèses — startOfSystem (seulement en tête de système) | startOfMeasure (en début de mesure) | never (jamais, numéro masqué) (Sid::tabParenthesizeTiedFret)');
sid('PARENTHESIZE_TIED_FRET_IF_ARTICULATION', 'bool', true, 'tablature : le numéro d\'une note liée dont l\'accord porte une articulation reste affiché (Sid::parenthesizeTiedFretIfArticulation)');
for (const name of ['SLUR', 'FERMATA', 'DYNAMICS', 'HAIRPIN', 'ACCENT', 'STACCATO', 'MORDENT', 'TURN', 'GOLPE']) {
  sid(`${name}_SHOW_TAB_COMMON`, 'bool', true, `tablature Full/Common : afficher cette marque (Sid::${name.toLowerCase()}ShowTabCommon)`);
  sid(`${name}_SHOW_TAB_SIMPLE`, 'bool', true, `tablature Simple : afficher cette marque (Sid::${name.toLowerCase()}ShowTabSimple)`);
}
// --- 4d-d : tapping et arpège (styledef.cpp 4.7.5) ---
sid('LH_TAPPING_SYMBOL_NORMAL', 'string', 'dot', 'tapping main gauche, portée : symbole (Sid::lhTappingSymbolNormalStave) — dot ; circledT non porté');
sid('LH_TAPPING_SYMBOL_TAB', 'string', 'dot', 'tapping main gauche, tablature : symbole (Sid::lhTappingSymbolTab)');
sid('LH_TAPPING_SHOW_ITEMS_NORMAL', 'string', 'halfSlur', 'tapping main gauche, portée : halfSlur | symbol | both (Sid::lhTappingShowItemsNormalStave)');
sid('LH_TAPPING_SHOW_ITEMS_TAB', 'string', 'halfSlur', 'tapping main gauche, tablature : halfSlur | symbol | both (Sid::lhTappingShowItemsTab)');
sid('LH_TAPPING_SLUR_TOP_AND_BOTTOM_NOTE_ON_TAB', 'bool', true, 'tablature : accord de plusieurs notes = une demi-liaison au-dessus ET une dessous (Sid::lhTappingSlurTopAndBottomNoteOnTab)');
sid('RH_TAPPING_SYMBOL_NORMAL', 'string', 'plus', 'tapping main droite, portée : plus | t (Sid::rhTappingSymbolNormalStave)');
sid('RH_TAPPING_SYMBOL_TAB', 'string', 't', 'tapping main droite, tablature : plus | t (Sid::rhTappingSymbolTab)');
sid('ARPEGGIO_LINE_WIDTH', 'real', 0.18, 'épaisseur du trait d\'arpège droit / crochet (Sid::arpeggioLineWidth)');
sid('ARPEGGIO_HOOK_LEN', 'real', 0.8, 'longueur des crochets de l\'arpège « bracket » (Sid::arpeggioHookLen)');
sid('ARPEGGIO_STEP_MS', 'real', 0, 'playback: delay between two notes of an arpeggio sign, in ms (0 = automatic: the length of the chord shared by its notes, at most 60 ms like MuseScore); a track and a chord may override it');
sid('ARPEGGIO_NOTE_DISTANCE', 'real', 0.4, 'distance arpège → note (Sid::arpeggioNoteDistance)');
// --- techniques de jeu (tranche 4d, MuseScore 4.7.5 styledef.cpp) ---
sid('HOPO_SHOW_ON_TAB', 'bool', true, 'afficher les hammer-on / pull-off sur une tablature (Sid::hopoShowOnTabStaves) ; PAS masqués par SLUR_SHOW_TAB_* (`shouldHideSlurSegment`)');
sid('HOPO_SHOW_ON_STANDARD', 'bool', true, 'afficher les hammer-on / pull-off sur une portée de notation (Sid::hopoShowOnStandardStaves)');
sid('HOPO_UPPER_CASE', 'bool', true, 'lettres H / P en majuscules (Sid::hopoUpperCase) ; faux : h / p');
sid('HOPO_SHOW_ALL', 'bool', true, 'une lettre pour CHAQUE paire d\'accords d\'une chaîne (Sid::hopoShowAll) ; faux : une seule lettre par série de même sens');

// --- bends / dives de guitare (4d-b ; styledef.cpp 4.7.5) ---
sid('GUITAR_BEND_HEIGHT_ABOVE_TAB', 'real', 1.5, 'hauteur de la pointe d\'un bend au-dessus de la ligne du haut de la tablature, en distances de lignes (guitarBendHeightAboveTABStaff)');
sid('GUITAR_BEND_PARTIAL_HEIGHT', 'real', 1.5, 'hauteur d\'un bend partiel / d\'une libération partielle (guitarBendPartialBendHeight, sp)');
sid('GUITAR_BEND_ARROW_WIDTH', 'real', 1.0, 'largeur de la flèche d\'un bend (guitarBendArrowWidth, sp)');
sid('GUITAR_BEND_ARROW_HEIGHT', 'real', 1.0, 'hauteur de la flèche d\'un bend (guitarBendArrowHeight, sp)');
sid('GUITAR_BEND_LINE_WIDTH', 'real', 0.13, 'épaisseur du trait d\'un bend sur portée de notation (guitarBendLineWidth, sp)');
sid('GUITAR_DIVE_LINE_WIDTH', 'real', 0.13, 'épaisseur du trait d\'un dive sur portée de notation (guitarDiveLineWidth, sp)');
sid('GUITAR_BEND_LINE_WIDTH_TAB', 'real', 0.15, 'épaisseur du trait d\'un bend en tablature (guitarBendLineWidthTab, sp)');
sid('GUITAR_DIVE_LINE_WIDTH_TAB', 'real', 0.15, 'épaisseur du trait d\'un dive en tablature (guitarDiveLineWidthTab, sp)');
sid('GUITAR_BEND_USE_FULL', 'bool', false, 'écrire « full » au lieu de « 1 » (guitarBendUseFull)');
sid('SHOW_FRET_ON_FULL_BEND_RELEASE', 'bool', true, 'montrer la frette d\'arrivée d\'une libération complète (showFretOnFullBendRelease)');
sid('ALIGN_PRE_BEND_AND_PRE_DIVE_TO_GRACE_NOTE', 'bool', false, 'aligner pre-bend / pre-dive sur la note d\'ornement (alignPreBendAndPreDiveToGraceNote)');
sid('USE_FRACTION_CHARACTERS', 'bool', true, 'montant du bend en caractères ¼ ½ ¾ (useFractionCharacters) ; faux : 1/4, 1/2, 3/4');
sid('PALM_MUTE_SHOW_TAB_COMMON', 'bool', true, 'palm mute sur une tablature Common (palmMuteShowTabCommon) ; toujours visible en Full');
sid('PALM_MUTE_SHOW_TAB_SIMPLE', 'bool', true, 'palm mute sur une tablature Simple (palmMuteShowTabSimple)');
sid('LET_RING_SHOW_TAB_COMMON', 'bool', true, 'let ring sur une tablature Common (letRingShowTabCommon)');
sid('LET_RING_SHOW_TAB_SIMPLE', 'bool', true, 'let ring sur une tablature Simple (letRingShowTabSimple)');
sid('HARMONIC_MARK_SHOW_TAB_COMMON', 'bool', true, 'marque d\'harmonique sur une tablature Common (harmonicMarkShowTabCommon)');
sid('HARMONIC_MARK_SHOW_TAB_SIMPLE', 'bool', true, 'marque d\'harmonique sur une tablature Simple (harmonicMarkShowTabSimple)');
sid('CAPO_TEXT', 'string', 'Capodastre {fret}', 'texte du capo (Capo::generateText ; {fret} = position)');
sid('TAB_STRING_LETTERS', 'bool', true, 'tablature : lettre de chaque corde (accordage) devant la portée, en tête de chaque système (ajout Scorsaire, absent de MuseScore)');
sid('FINGERING_FONT_SIZE', 'real', 8, 'doigtés : corps du texte en points (fingeringFontSize / lhGuitarFingeringFontSize / rhGuitarFingeringFontSize / stringNumberFontSize : 8 pt, proportionnel à l\'espace)');
sid('FINGERING_MIN_DISTANCE', 'real', 0.5, 'doigtés : distance minimale (sp) entre le doigté et le bord de l\'accord (fingeringMinDistance)');
sid('LYRICS_PLACEMENT', 'string', 'below', "paroles : côté par défaut, 'below' | 'above' (lyricsPlacement)");
sid('LYRICS_POS_ABOVE', 'real', -2, 'paroles au-dessus : décalage de style (lyricsPosAbove, y vers le bas) — la position réelle vient de l\'empilement des couplets');
sid('LYRICS_MIN_TOP_DISTANCE', 'real', 1, 'paroles : distance minimale à la portée (lyricsMinTopDistance)');
sid('LYRICS_MIN_BOTTOM_DISTANCE', 'real', 1.5, 'paroles : distance minimale à la portée suivante (lyricsMinBottomDistance)');
sid('LYRICS_LINE_HEIGHT', 'real', 1, 'paroles : facteur de l\'interligne entre couplets (lyricsLineHeight)');
sid('VOLTA_TEXT_SIZE', 'real', 1.5, 'volta : corps du texte en espaces de portée (défaut choisi par Jean : 1,5 ; MuseScore / prototype 0,85)');
sid('VOLTA_LINE_WIDTH', 'real', 0.15, 'volta : épaisseur du trait en sp (voltaLineWidth ; défaut choisi par Jean : 0,15, MuseScore 0,11)');
sid('VOLTA_CORNER_RADIUS', 'real', 0.4, 'volta : rayon des angles du crochet en sp (défaut choisi par Jean : 0,4 ; 0 = angles droits comme MuseScore)');
sid('LYRICS_FONT_SIZE', 'real', 10, 'paroles : corps du texte en points (Edwin 10 pt, proportionnel à l\'espace)');
sid('LYRICS_DASH_MIN_LENGTH', 'real', 0.4, 'tiret de paroles : longueur minimale (lyricsDashMinLength)');
sid('LYRICS_DASH_MAX_LENGTH', 'real', 0.6, 'tiret de paroles : longueur maximale (lyricsDashMaxLength)');
sid('LYRICS_DASH_MAX_DISTANCE', 'real', 16, 'tiret de paroles : écart maximal entre deux tirets (lyricsDashMaxDistance)');
sid('LYRICS_HOLD_LINE', 'bool', false, 'paroles à événements : trait de prolongation sous une syllabe tenue sur plusieurs notes (mélisme)');
sid('LYRICS_DASH_FORCE', 'bool', true, 'tiret de paroles : toujours au moins un tiret (lyricsDashForce)');
sid('LYRICS_DASH_FIRST_LAST_GAP_HALF', 'bool', true, 'tiret de paroles : premier et dernier écart réduits de moitié (lyricsDashFirstAndLastGapAreHalf)');
sid('LYRICS_DASH_PAD', 'real', 0.05, 'tiret de paroles : vide minimal avant et après (lyricsDashPad)');
sid('LYRICS_DASH_YPOS_RATIO', 'real', 0.5, 'tiret de paroles : fraction de la hauteur d\'x au-dessus de la ligne de base (lyricsDashYposRatio)');
sid('LYRICS_LINE_THICKNESS', 'real', 0.1, 'paroles : épaisseur des tirets et du trait de mélisme (lyricsLineThickness)');
sid('LYRICS_MELISMA_PAD', 'real', 0.2, 'trait de mélisme : vide avant le trait (lyricsMelismaPad)');
sid('LYRICS_MELISMA_MIN_LENGTH', 'real', 1, 'trait de mélisme : longueur minimale (lyricsMelismaMinLength)');
sid('LYRICS_MELISMA_FORCE', 'bool', false, 'trait de mélisme : impose la longueur minimale (lyricsMelismaForce)');
sid('LYRICS_ALIGN_VERSE_NUMBER', 'bool', true, 'paroles : numéro de couplet et ponctuation exclus du centrage (lyricsAlignVerseNumber)');
sid('LYRICS_AVOID_BARLINES', 'bool', true, 'paroles : évitent les barres de mesure (lyricsAvoidBarlines)');
sid('STICKING_PLACEMENT', 'string', 'above', "sticking (mains) : côté, 'above' | 'below' — ÉCART Scorsaire : MuseScore pose en dessous par défaut (stickingPlacement = BELOW), Jean veut au-dessus");
sid('STICKING_POS_ABOVE', 'real', -1, 'sticking au-dessus : ligne de base à 1 sp au-dessus de la ligne du haut (stickingPosAbove, y vers le bas)');
sid('STICKING_POS_BELOW', 'real', 2, 'sticking en dessous : ligne de base à 2 sp sous la ligne du bas (stickingPosBelow)');
sid('STICKING_MIN_DISTANCE', 'real', 0.5, 'distance minimale du sticking aux autres éléments (stickingMinDistance)');
sid('STICKING_FONT_SIZE', 'real', 7.5, 'sticking : corps du texte en points (MuseScore : Edwin 10 pt ; Scorsaire : 75 %, demande de Jean 05/10/2026)');
sid('STICKING_SYMBOL_SIZE', 'real', 20, 'sticking : corps des symboles (carré, rond) en points (MuseScore : 10 pt ; Scorsaire : 20 pt = taille normale d un glyphe, demande de Jean 05/10/2026)');
// --- symboles d'accord (peintre `chord`, étape 5 tranche 3) : mise en forme de CCE (`LeTournedosRossini/cce-editor`, index.html : chordHTML / formatChord / CSS .chord-text), valeurs par défaut de CCE ---
sid('CHORD_FONT_SIZE', 'real', 5, "symboles d'accord : corps (1 em) en espaces ; 4 sp = la hauteur des barres de la portée d'accords (la pile qualité / basse fait 1 em)");
sid('CHORD_BAR_HEIGHT', 'real', 4, "portée d'accords (sans lignes) : hauteur des barres de mesure en espaces (décision de Jean 11/10/2026 : comme une portée à 5 lignes)");
sid('CHORD_FONT_FAMILY', 'string', "'Barlow Condensed','JetBrains Mono',monospace", "symboles d'accord : police ; Barlow Condensed (largeurs lues dans la police, src/layout/fontmetrics.js), toute autre famille est calculée à chasse fixe 0,6 em");
sid('CHORD_FONT_WEIGHT', 'int', 400, "symboles d'accord : graisse (CCE : --typo-chord-weight)");
sid('CHORD_LETTER_SPACING', 'real', 0, "symboles d'accord : espacement des lettres en em (CCE : --chord-letter-spacing)");
sid('CHORD_AUTO_PLACE', 'bool', true, "symboles d'accord : la qualité, la basse et l'altération se placent contre l'encre réelle de la lettre fondamentale (police Barlow Condensed seulement), à la hauteur où ils sont posés");
sid('CHORD_INK_GAP', 'real', 0.03, "symboles d'accord : espace entre l'encre de la fondamentale et ce qui la suit, en em du corps de la fondamentale (placement automatique)");
sid('CHORD_ACCID_SCALE', 'real', 0.578, "altération de la fondamentale : échelle par rapport au corps (CCE : --chord-accid-scale)");
sid('CHORD_ACCID_GAP', 'real', -0.02, "écart fondamentale → altération en em (CCE : --chord-accid-gap)");
sid('CHORD_ACCID_STACK_OFFSET', 'real', -0.05, "décalage de la pile qualité / basse quand la fondamentale a une altération, en em (CCE : --chord-accid-stack-offset)");
sid('CHORD_QUAL_OFFSET', 'real', 0, "décalage horizontal de la qualité en mode exposant, en em (CCE : --chord-sup-offset)");
sid('CHORD_QUAL_OFFSET_ACCID', 'real', -0.3, "idem avec altération (CCE : --chord-sup-offset-accid)");
sid('CHORD_BASS_OFFSET', 'real', -0.15, "décalage horizontal de la basse en em (CCE : margin-left de .b)");
sid('CHORD_QUAL_SCALE', 'real', 0.47, "qualité : échelle par rapport au corps (CCE : .q)");
sid('CHORD_BASS_SCALE', 'real', 0.45, "basse : échelle par rapport au corps (CCE : .b)");
// Réglage fin de la position de la qualité selon la fondamentale (demande de Jean 11/10/2026) : « A » n'a pas d'espace en haut, la qualité peut se rapprocher ; « F » en a besoin
// d'un peu plus à droite. Décalage = lettre + altération (additifs), en em du corps de la fondamentale ; x vers la droite, y vers le HAUT. Défaut 0 : rendu inchangé.
for (const L of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
  sid(`CHORD_QUAL_DX_${L}`, 'real', 0, `qualité d'un accord sur ${L} : décalage horizontal en em (s'ajoute au décalage de l'altération)`);
  sid(`CHORD_QUAL_DY_${L}`, 'real', 0, `qualité d'un accord sur ${L} : décalage vertical en em, vers le haut`);
}
for (const K of ['SHARP', 'FLAT']) {
  sid(`CHORD_QUAL_DX_${K}`, 'real', 0, `qualité d'un accord dont la fondamentale est ${K === 'SHARP' ? 'diésée' : 'bémolisée'} : décalage horizontal en em (s'ajoute à celui de la lettre)`);
  sid(`CHORD_QUAL_DY_${K}`, 'real', 0, `idem, décalage vertical en em, vers le haut`);
}
// Réglage fin de la qualité selon son PREMIER SIGNE ET la lettre de la fondamentale (demande de Jean 25/10/2026) : un jeu de réglages PROPRE à chaque couple (fondamentale, premier signe).
// Em du corps de la fondamentale, additif avec le décalage de la lettre / de l'altération. Signes : chiffres et lettres du texte (5 6 7 9, 1 = 11 / 13, s = sus, a = add / alt, M) et glyphes (MINOR, DELTA, HALFDIM, DIM, AUG).
const ROOT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
// A root is named by its letter and its accidental: `F` (natural), `Fs` (sharp), `Ff` (flat) — F, F♯ and F♭ each have their own sets of values (demande de Jean 25/10/2026).
const ROOT_KEYS = [...ROOT_LETTERS, ...ROOT_LETTERS.map((L) => `${L}s`), ...ROOT_LETTERS.map((L) => `${L}f`)];
const rootText = (k) => `${k[0]}${k[1] === 's' ? '♯' : k[1] === 'f' ? '♭' : ''}`;
for (const L of ROOT_KEYS) for (const K of ['5', '6', '7', '9', '1', 's', 'a', 'M', 'MINOR', 'DELTA', 'HALFDIM', 'DIM', 'AUG']) {
  sid(`CHORD_QUAL_PAIR_DX_${L}_${K}`, 'real', PLACED[`q:${L}:${K}:X`] ?? 0, `accord sur ${rootText(L)}, qualité commençant par « ${K} » : décalage horizontal en em`);
  sid(`CHORD_QUAL_PAIR_DY_${L}_${K}`, 'real', PLACED[`q:${L}:${K}:Y`] ?? 0, `accord sur ${rootText(L)}, qualité commençant par « ${K} » : décalage vertical en em, vers le haut`);
}
// Basse : un jeu de réglages PROPRE à chaque couple (fondamentale avec son altération, lettre de la basse) pour la LETTRE de la basse (distance à la barre oblique, hauteur) ; décalage de tout le bloc « /basse »
// selon la fondamentale (avec son altération) ; distance barre oblique → lettre (toutes basses) ; marge devant l'altération de la basse.
for (const R of ROOT_KEYS) {
  sid(`CHORD_BASS_ROOT_DX_${R}`, 'real', PLACED[`r${R}X`] ?? 0, `basse d'un accord sur ${rootText(R)} : décalage horizontal de tout le bloc « /basse », en em`);
  sid(`CHORD_BASS_ROOT_DY_${R}`, 'real', PLACED[`r${R}Y`] ?? 0, `basse d'un accord sur ${rootText(R)} : décalage vertical de tout le bloc « /basse », en em, vers le haut`);
  for (const B of ROOT_LETTERS) {
    sid(`CHORD_BASS_PAIR_DX_${R}_${B}`, 'real', 0, `accord sur ${rootText(R)}, basse « /${B} » : décalage horizontal de la lettre de la basse (distance à la barre oblique), en em`);
    sid(`CHORD_BASS_PAIR_DY_${R}_${B}`, 'real', 0, `accord sur ${rootText(R)}, basse « /${B} » : décalage vertical de la lettre de la basse et de son altération, en em, vers le haut`);
  }
}
// Altération de la fondamentale : décalage du glyphe ♯ (s) ou ♭ (f) par rapport à la lettre, PROPRE à chaque lettre (F♯ et F♭ ont chacun le leur) ; le horizontal pousse aussi ce qui suit, le vertical ne déplace que le glyphe.
for (const L of ROOT_LETTERS) for (const k of ['s', 'f']) {
  sid(`CHORD_ACCID_PAIR_DX_${L}_${k}`, 'real', PLACED[`ac:${L}:${k}:X`] ?? 0, `fondamentale ${L}${k === 's' ? '♯' : '♭'} : décalage horizontal de l'altération en em`);
  sid(`CHORD_ACCID_PAIR_DY_${L}_${k}`, 'real', PLACED[`ac:${L}:${k}:Y`] ?? 0, `fondamentale ${L}${k === 's' ? '♯' : '♭'} : décalage vertical de l'altération en em, vers le haut`);
}
sid('CHORD_SHARP_SCALE', 'real', 0.578, "dièse de la fondamentale : échelle par rapport au corps (remplace CHORD_ACCID_SCALE, jamais lu depuis le 25/10/2026)");
sid('CHORD_FLAT_SCALE', 'real', 0.578, "bémol de la fondamentale : échelle par rapport au corps");
sid('CHORD_BASS_SLASH_GAP', 'real', PLACED.slash ?? 0, "basse : distance supplémentaire entre la barre oblique et la lettre de la basse, en em du corps de la fondamentale");
sid('CHORD_BASS_ACCID_GAP', 'real', 0.04, "basse : marge à gauche de l'altération de la basse, en em du corps de la basse (CCE)");
sid('CHORD_NOTATION', 'string', 'anglo', "noms des fondamentales : 'anglo' (C D E…) | 'latin' (Do Ré Mi…) (CCE : cpNotation)");
sid('CHORD_MINOR_STYLE', 'string', 'dash', "accord mineur : 'dash' (tiret) | 'm' (CCE : cpMinorStyle)");
sid('CHORD_HALF_DIM_STYLE', 'string', 'sym', "demi-diminué : 'sym' (ø, glyphe Bravura) | 'text' (m7♭5) (CCE : cpHalfDimStyle)");
sid('CHORD_DELTA_STYLE', 'string', 'round', "septième majeure : 'round' (Δ aux coins arrondis, dérivé du glyphe Bravura) | 'sym' (Δ pointu de Bravura) | 'text' (M7) (CCE : cpDeltaStyle)");
sid('CHORD_DASH_STYLE', 'string', 'glyph', "tiret du mineur : 'glyph' (csymMinor de Bravura, défaut Scorsaire : demande de glyphes Bravura) | 'std' (-) | 'em' (–, défaut de CCE) | 'eml' (—) (CCE : cpDashStyle)");
sid('CHORD_SIMILE_SIZE', 'real', 0.8, "signes % et %% : échelle par rapport au corps (CCE : _simileSize)");
sid('CHORD_FIT', 'bool', true, "symboles d'accord : compression horizontale dans leur case (CCE : _fitChords). Vrai = écrans de rendu / lecteur (le symbole ne prend pas de largeur dans la colonne, il est comprimé s'il dépasse sa case) ; faux = édition (la colonne réserve la largeur réelle)");
sid('CHORD_FIT_MIN', 'real', 0.3, "compression minimale (CCE : Math.max(0.3, …))");
sid('CAPO_TEXT_NONE', 'string', 'Pas de capodastre', 'texte d\'un capo inactif ou à la frette 0');
sid('CAPO_TEXT_PARTIAL', 'string', 'Capodastre partiel :\nFrette {fret} sur les cordes {strings}', 'texte d\'un capo partiel (cordes ignorées)');
sid('PALM_MUTE_TEXT', 'string', 'P.M.', 'texte du palm mute (palmMuteText)');
sid('LET_RING_TEXT', 'string', 'let ring', 'texte du let ring (letRingText)');
sid('PEDAL_PLACEMENT', 'string', 'below', "pédale : côté par défaut, 'below' | 'above' (pedalPlacement = BELOW)");
sid('PEDAL_POS_BELOW', 'real', 2.5, 'pédale en dessous : ligne de base à 2,5 sp sous la ligne du bas (pedalPosBelow, y vers le bas)');
sid('PEDAL_POS_ABOVE', 'real', -1, 'pédale au-dessus : ligne de base à 1 sp au-dessus de la ligne du haut (pedalPosAbove)');
sid('PEDAL_LINE_WIDTH', 'real', 0.11, 'pédale : épaisseur de la ligne en sp (pedalLineWidth)');
sid('PEDAL_HOOK_HEIGHT', 'real', 1.2, 'pédale : hauteur des crochets en sp (pedalHookHeight)');
sid('PEDAL_MIN_DISTANCE', 'real', 0.7, 'pédale : distance minimale aux autres éléments (pedalMinDistance)');
sid('WHAMMY_BAR_TEXT', 'string', 'w/bar', 'texte de la barre de whammy (whammyBarText)');
sid('GUITAR_DIVES_ABOVE_STAFF', 'bool', false, 'dives dessinés au-dessus de la portée de tablature (guitarDivesAboveStaff)');
sid('SHAPE_SPACING', 'bool', true,
  'espacement horizontal par formes (PaddingTable de MuseScore : distances minimales entre éléments voisins) ; false : ancienne réserve par colonne (lead + largeur)');
sid('REPEAT_TIP_SCALE', 'real', 0.6, 'taille des ailettes d\'une barre de reprise (1 = les glyphes de Bravura tels quels) ; les ailettes sont comprises dans la hauteur de la barre : la barre de reprise a la hauteur des barres normales');
sid('REPEAT_BAR_TIPS', 'bool', true,
  'ailettes (extrémités courbes) en haut et en bas des barres de reprise (repeatBarTips de MuseScore, faux chez lui ; vrai par défaut dans Scorsaire)');
sid('SYSTEM_HEADER_DISTANCE', 'real', 2.5, 'distance du bord droit de la clé/armure à la 1re colonne d\'un système (systemHeaderDistance)');
sid('SYSTEM_HEADER_TIME_SIG_DISTANCE', 'real', 2.0, 'idem après un chiffrage (systemHeaderTimeSigDistance)');
sid('BEAM_BY_BEAT', 'bool', false,
  'ligatures des mesures en X/4 et X/2 : un groupe par TEMPS (noire ; blanche en X/2) au lieu des tables de MuseScore (4 croches = 1 groupe en 4/4) — goût personnel ; le groupement propre d\'une mesure (beamGrouping) reste prioritaire');
sid('CONCERT_PITCH', 'bool', false, 'affichage en hauteur de CONCERT (Sid::concertPitch) : faux = notation écrite des instruments transpositeurs (armure et notes transposées)');
sid('SWING_UNIT', 'string', 'none', 'unité du swing par défaut quand aucun signe de swing n\'est posé : none | eighth | 16th (Sid::swingUnit, vide chez MuseScore = désactivé)');
sid('SWING_RATIO', 'int', 60, 'ratio du swing par défaut, en % de l\'unité (Sid::swingRatio)');
sid('MEASURE_SPACING', 'real', 1.5, 'pente de l\'étirement par durée : chaque doublement de durée multiplie l\'étirement par cette valeur (Sid::measureSpacing)');

// --- mise en page verticale (valeurs du prototype validées par Jean ; MuseScore : akkoladeDistance/staffDistance 6,5,
//     minSystemDistance 8,5 — les valeurs ci-dessous restent celles du prototype, qui fait foi) ---
sid('SYSTEM_TOP_MARGIN', 'real', 5, 'espace au-dessus de la 1re portée d\'un système (marques, voltas…)');
sid('SYSTEM_BOTTOM_MARGIN', 'real', 6, 'espace sous la dernière portée d\'un système');
sid('STAFF_DISTANCE', 'real', 6, 'distance entre la ligne du bas d\'une portée et la ligne du haut de la suivante (pistes différentes)');
sid('MIN_VERTICAL_DISTANCE', 'real', 1,
  'distance minimale entre les éléments de deux portées voisines (ou de deux systèmes) qui se recouvrent horizontalement ; les portées sont écartées automatiquement au besoin (MuseScore minVerticalDistance = 0,5 ; 1 sp = demande de Jean 03/10/2026)');
sid('SYSTEM_EDGE_DISTANCE', 'real', -1, 'room kept between the marks of a system and its top and bottom edges (the room between two systems is made of it and of the system margins); -1 = the same as MIN_VERTICAL_DISTANCE')
sid('SKYLINE_MIN_HORIZONTAL_CLEARANCE', 'real', 0.25, 'deux éléments sont « au même endroit » s\'ils se recouvrent à cette marge près horizontalement (Sid::skylineMinHorizontalClearance)');
sid('GEN_COURTESY_KEYSIG', 'bool', true, 'armure de précaution en fin de ligne avant un changement d\'armure (MuseScore genCourtesyKeysig)');
sid('GEN_COURTESY_TIMESIG', 'bool', true, 'chiffrage de précaution en fin de ligne avant un changement de chiffrage (genCourtesyTimesig)');
sid('AKKOLADE_BAR_DISTANCE', 'real', 0.35, 'espace entre l\'accolade et la 1re portée (MuseScore akkoladeBarDistance)');
sid('BRACKET_WIDTH', 'real', 0.45, 'épaisseur du trait d\'un crochet de groupe (MuseScore bracketWidth)');
sid('BRACKET_DISTANCE', 'real', 0.45, 'espace entre un crochet de groupe et ce qui le suit vers les portées (MuseScore bracketDistance)');
sid('START_BARLINE_MULTIPLE', 'bool', true, 'barre de mesure au début de chaque système quand il a plusieurs portées (MuseScore startBarlineMultiple)');
sid('ENABLE_INDENTATION_ON_FIRST_SYSTEM', 'bool', false, 'indenter le premier système (MuseScore enableIndentationOnFirstSystem ; désactivé ici par défaut)');
sid('FIRST_SYSTEM_INDENTATION_VALUE', 'real', 5, 'retrait du premier système, en espaces ; la marge est le plus grand de ce retrait et des noms de pistes (MuseScore firstSystemIndentationValue)');
sid('MUTED_NOTE_DURATION', 'real', 0.2, 'lecture : durée d\'une note étouffée, en fraction de sa durée (écart Scorsaire : le profil cordes de MuseScore la joue comme une note normale)');
sid('MUTED_NOTE_VELOCITY', 'real', -20, 'lecture : décalage de vélocité d\'une note étouffée (−20 = plus douce, 0 = comme une note normale)');
sid('SHOW_SYSTEM_OBJECTS', 'bool', true, 'afficher les objets système (tempos, sauts, marqueurs, voltas, points d\'orgue, swings, repères de répétition) ; faux = masqués à l\'écran sans rien supprimer (option Scorsaire, écran 1)');
sid('SHOW_TEMPO_TEXTS', 'bool', true, 'draw the tempo texts (♩ = 90, Allegro…) of the top staff; false = left out of the drawing, nothing erased (the Lecteur turns it off unless the person or the author asks for them)');
sid('SHOW_CUES', 'bool', true, 'afficher les repères d\'accompagnement (groove et break forcés, model/cueedit.js) au-dessus de la partition ; faux = masqués à l\'écran sans rien supprimer');
sid('END_BAR_FINAL', 'bool', true, 'la dernière mesure du Mouvement prend la barre finale (faux : barre simple ; notation imbriquée d\'un conteneur)');
sid('HEADER_SHOW_KEYSIG', 'bool', true, 'montrer l\'armure en tête de système (faux : jamais dessinée ni réservée ; utilisé pour la notation imbriquée d\'un conteneur, qui suit l\'armure des portées de la pièce)');
sid('CHORD_START_TIMESIG', 'bool', true, 'montrer le chiffrage au début de la portée d\'accords (faux : seulement les accords et les barres de mesure ; le bloc-notes)');
sid('HEADER_SHOW_TIMESIG', 'bool', true, 'montrer le chiffrage en tête du 1er système (faux : jamais dessiné ni réservé ; notation imbriquée d\'un conteneur)');
sid('SECTION_COLORS_SHOW', 'bool', true, 'afficher les bandes colorées des parties de la forme (faux : la carte flottante les nomme encore)');
sid('SECTION_COLOR_STRENGTH', 'real', 0.22, 'intensité des bandes colorées des parties (0,05 = à peine suggérées … 0,6 = franches)');
sid('SOPRANO_PHOTO', 'bool', false, "le saxophone soprano montre la photographie (blague demandée par Jean) au lieu de l'icône de clarinette ; réglage de l'appareil, forcé par la page");
sid('SHOW_INSTRUMENT_NAMES', 'bool', true, 'écrire le nom des pistes à gauche des portées (MuseScore : isShowInstrumentNames ; désactivé ici par défaut)');
sid('INSTRUMENT_NAME_FIRST', 'string', 'short', 'ce qui est écrit à gauche du 1er système : long (nom de la piste) | short (abréviation) | icon (icône) | none (Sid::firstSystemInstNameVisibility)');
sid('INSTRUMENT_NAME_NEXT', 'string', 'icon', 'idem pour les systèmes suivants : long | short | icon | none (Sid::subsSystemInstNameVisibility)');
sid('HIDE_INSTRUMENT_NAME_IF_ONE', 'bool', true, 'rien d\'écrit quand la partition n\'a qu\'une piste (Sid::hideInstrumentNameIfOneInstrument)');
sid('INSTRUMENT_NAME_OFFSET', 'real', 1, 'espace entre le nom et ce qui le suit vers les portées (Sid::instrumentNameOffset)');
sid('GROUP_LABELS', 'bool', false, 'dessiner le texte (étiquette) d\'un groupe à gauche de son crochet (option Scorsaire ; MuseScore n\'a pas d\'étiquette de crochet)');
sid('AKKOLADE_DISTANCE', 'real', 6, 'idem, entre deux portées de la MÊME piste (grand staff, accolade)');

// --- silences automatiques (options de l'utilisateur ; lues par l'édition quand elle comble un trou) ---
sid('RESTS_COMPOUND_BEAT_DOTTED', 'bool', true,
  'mesure composée (6/8, 9/8, 12/8) : le temps est un silence de noire pointée (sinon : noire + croche)');
sid('RESTS_USE_BEAM_GROUPING', 'bool', true,
  'le groupement personnalisé des ligatures (mesures asymétriques) s\'applique aussi aux silences');
sid('RESTS_HALF_IN_THREE_FOUR', 'bool', true,
  'en 3/4 : une demi-pause est permise sur les temps 1-2 (sinon : deux soupirs)');

export function isSid(name) {
  return Object.hasOwn(SID_TABLE, name);
}

const TYPE_CHECK = {
  real: (v) => typeof v === 'number' && Number.isFinite(v),
  int: (v) => Number.isInteger(v),
  bool: (v) => typeof v === 'boolean',
  string: (v) => typeof v === 'string',
};

/** Lève une erreur claire si la valeur n'est pas du bon type pour ce style. */
export function validateStyleValue(name, value) {
  const def = SID_TABLE[name];
  if (!def) throw new Error(`Style inconnu : ${name}`);
  if (!TYPE_CHECK[def.type](value)) {
    throw new Error(`Valeur invalide pour le style « ${name} » (${def.type} attendu) : ${JSON.stringify(value)}`);
  }
}
sid('SMALL_NOTE_MAG', 'real', 0.7, 'échelle d\'une petite note, dont la note d\'aide d\'un ornement (Sid::smallNoteMag)');
sid('TRILL_ALWAYS_SHOW_CUE_NOTE', 'bool', false, 'montrer la note d\'aide d\'un trille même pour une seconde (Sid::trillAlwaysShowCueNote)');
// --- notes d'ornement (MuseScore styledef.cpp l.284-286 et l.521-523) ---
sid('GRACE_NOTE_MAG', 'real', 0.7, 'échelle d\'un ornement (Sid::graceNoteMag)');
sid('GRACE_TO_MAIN_NOTE_DIST', 'real', 0.45, 'distance minimale ornement → note principale (espaces, Sid::graceToMainNoteDist)');
sid('GRACE_TO_GRACE_NOTE_DIST', 'real', 0.3, 'distance minimale ornement → ornement (espaces, Sid::graceToGraceNoteDist)');
sid('STEM_SLASH_POSITION', 'real', 2.0, 'hauteur de la barre d\'acciaccature sous la pointe de hampe (espaces, Sid::stemSlashPosition)');
sid('STEM_SLASH_ANGLE', 'real', 40, 'angle de la barre d\'acciaccature (degrés, Sid::stemSlashAngle)');
sid('STEM_SLASH_THICKNESS', 'real', 0.125, 'épaisseur de la barre d\'acciaccature (espaces, Sid::stemSlashThickness)');

/** Styles that a TRACK may override (`PID.STYLE_OVERRIDES`): options that only concern the notation of one staff. The others shape the system shared by all tracks (spacing, page, courtesy signatures) and stay per movement. */
export const TRACK_STYLE_SIDS = Object.freeze(['BEAM_BY_BEAT', 'TAB_STRING_GAUGE', 'TAB_STRING_LETTERS', 'ARPEGGIO_STEP_MS']);
// --- page of a PART (screen 2, print layout): millimetres ; a part's style layer holds them (MuseScore pageWidth, pageHeight, margins, spatium) ---
sid('PAGE_FORMAT', 'string', 'a4', 'paper format id of a part (see model/page.js: a3, a4, a5, letter, legal, tabloid, screen-tablet, screen-phone, tablet-4-3, tablet-16-10, tablet-5-3, tablet-16-9, custom)');
sid('PAGE_LANDSCAPE', 'bool', false, 'landscape page (width and height swapped)');
sid('PAGE_WIDTH_MM', 'real', 210, 'page width in mm, used only when PAGE_FORMAT is "custom"');
sid('PAGE_HEIGHT_MM', 'real', 297, 'page height in mm, used only when PAGE_FORMAT is "custom"');
sid('PAGE_MARGIN_LEFT', 'real', 10, 'left margin in mm (decision of Jean, 2026-10-16: 10 mm everywhere by default)');
sid('PAGE_MARGIN_RIGHT', 'real', 10, 'right margin in mm');
sid('PAGE_MARGIN_TOP', 'real', 10, 'top margin in mm');
sid('PAGE_MARGIN_BOTTOM', 'real', 10, 'bottom margin in mm');
sid('PAGE_STAFF_SPACE_MM', 'real', 1.75, 'staff space (distance between two staff lines) in mm: the scale of the printed score (MuseScore spatium, about 1.76 mm)');
sid('PAGE_UPPER_BORDER', 'real', 0, 'extra space (staff spaces) between the top margin and the first system of a page (MuseScore staffUpperBorder is 7; here 0 so that the margin is the real limit of the music)');
sid('PAGE_LOWER_BORDER', 'real', 0, 'extra space (staff spaces) between the last system of a page and the bottom margin (MuseScore staffLowerBorder is 7)');
sid('PAGE_VERTICAL_SPREAD', 'bool', false, 'spread the staves and systems over the height of each page (MuseScore enableVerticalSpread)');
sid('PAGE_MAX_FILL_SPREAD', 'real', 6, 'maximum space (staff spaces) added to each gap by the last pass of the vertical spread (MuseScore maxPageFillSpread)');
sid('LAST_SYSTEM_JUSTIFY', 'bool', true, 'justify the last system of a movement on the printed page when it is full enough (see LAST_SYSTEM_FILL_LIMIT); off = it keeps its natural width');
sid('LAST_SYSTEM_FILL_LIMIT', 'real', 0.3, 'fraction (0 to 1) of the width the last system must fill to be justified (MuseScore lastSystemFillLimit 0.3), when LAST_SYSTEM_JUSTIFY is on');
// --- title block, headers, footers, measure numbers of a PART (screen 2) ---
sid('PAGE_SCORE_ONLY', 'bool', false, '"score only" reading mode: no title block, no header, no footer (tablet)');
sid('TITLE_SIZE', 'real', 22, 'size of the title (pt, MuseScore titleFontSize)');
sid('SUBTITLE_SIZE', 'real', 14, 'size of the subtitle (pt)');
sid('CREDITS_SIZE', 'real', 10, 'size of the composer, arranger, lyricist, album lines and of the free lines (pt)');
sid('HEADER_SIZE', 'real', 9, 'size of the header text (pt)');
sid('FOOTER_SIZE', 'real', 9, 'size of the footer text (pt)');
sid('TITLE_FRAME_DISTANCE', 'real', 4, 'space (staff spaces) between the title block and the first system (MuseScore frameSystemDistance is 7)');
sid('PAGE_HEADER_MARGIN', 'real', 5, 'distance (mm) from the top edge of the paper to the header text');
sid('PAGE_FOOTER_MARGIN', 'real', 5, 'distance (mm) from the bottom edge of the paper to the footer text');
sid('PAGE_NUMBER_OFFSET', 'int', 0, 'added to the page numbers (first page = 1 + offset)');
sid('SHOW_MEASURE_NUMBERS', 'bool', false, 'draw measure numbers above the top staff of every system (a part turns it on, see layout/partlayout.js)');
sid('MEASURE_NUMBER_MODE', 'string', 'system', 'which measures are numbered: system (the first of every system), interval (every N-th), every (all)');
sid('PART_SIGNS_ON', 'string', 'top', 'printed part: the signs of the structure (voltas, jumps, markers, rehearsal marks, tempos, fermatas) are drawn on the top staff of each system (top) or on every staff (all)');
sid('REGULAR_MEASURES', 'bool', false, 'regular measures: every measure of a movement gets the same width (the widest natural one), the line is broken accordingly and the measures of a line are equal, as in a chord grid (a lead-sheet look)');
sid('MEASURES_PER_SYSTEM', 'int', 0, 'a system holds at most this many measures (0 = as many as fit); with regular measures, a grid of N measures per line');
sid('MEASURE_GRID', 'string', 'off', 'measure grid: off | columns (the line is cut into equal columns, a measure takes one, two or half a column, so that the bar lines of every line fall under one another)');
sid('MEASURE_GRID_BASE', 'string', 'common', 'width of a column of the measure grid: common (what most measures ask for) | widest | chords (a measure of MEASURE_GRID_CHORDS chords)');
sid('MEASURE_GRID_STRETCH', 'string', 'off', 'measure grid: the last measure of a line takes the empty columns after it (end bars on the right edge): off | 2 | 3 (only when it then spans at most that many columns) | any');
sid('MEASURE_GRID_CHORDS', 'int', 2, 'with the chords base of the measure grid, a column is as wide as a measure holding this many chords');
sid('READER_MARK_SCALE', 'real', 1, "size of the free texts above the staves (dolce, solo…) and of the jump signs and their texts (segno, coda, D.S.): 1 = as written ; the Lecteur's « writing only » sets it to keep them at their size when the writing is drawn bigger");
sid('PART_SECTION_BANDS', 'bool', false, 'printed part: the coloured bands of the sections of the form are drawn behind the systems (the cards alone are the landmark by default)');
sid('READER_SCALE', 'string', 'stored', "gammes en encart au-dessus d'une portée (conteneur de gamme, PID.SCALE_RECIPE) : stored = le fragment écrit dans le fichier ; auto = recalculé pour l'instrument de la piste (portée ou tablature) ; score | tab = vue imposée ; hidden = pas d'encart. Imposé par les lecteurs");
sid('READER_SECTION_CARDS', 'string', 'strip', 'pages hors parties imprimées : les cartes des parties de la forme. strip = la bande des cartes de l\'interface (écrans 1 et 3) ; none = rien, sans réserver de place ; first / all = cartes écrites au-dessus de la portée du haut / de toutes les portées, comme dans une partie imprimée (le Lecteur)');
sid('SECTION_CARD_SCALE', 'real', 1, 'cartes de structure écrites au-dessus des portées (parties imprimées, Lecteur) : échelle de leur texte et de leur hauteur, 1 = 10 points');
sid('TEMPO_START_TOP', 'bool', true, 'pages imprimées et lecteurs : le tempo de DÉPART (♩ = 90) se pose tout en haut du premier système, au-dessus des voltas et des cartes de structure, au lieu d\'être repoussé par eux ; un changement de tempo en cours de morceau reste au-dessus de la portée');
sid('SECTION_CARD_STYLE', 'string', 'card', 'cartes de structure : card = un rectangle coloré avec le nom ; text = le nom seul, en texte (noir, ou de la couleur des signes quand ils sont colorés)');
sid('SECTION_CARD_PLACE', 'string', 'low', 'cartes de structure : où se posent-elles ? low = au plus bas, juste au-dessus de ce qui se trouve sous leur largeur (volta, repères…) ; top = au-dessus de tout ce que porte la portée du haut');
sid('SECTION_CARD_GAP', 'real', 1, 'cartes de structure : distance entre la carte et ce qu\'elle surmonte, en facteur de l\'usage (1 = 1,2 espace au-dessus de la portée ou de la grille ; 0 = collée)');
sid('PART_SECTION_CARDS', 'string', 'first', 'printed part: the cards of the sections of the form written as a staff text: none, first (top staff of each system) or all (every staff)');
sid('MEASURE_NUMBER_INTERVAL', 'int', 5, 'interval of the numbers when MEASURE_NUMBER_MODE is "interval" (MuseScore measureNumberInterval)');
sid('MEASURE_NUMBER_SHOW_ONE', 'bool', false, 'number the first measure of a movement (MuseScore showMeasureNumberOne)');
sid('MEASURE_NUMBER_SIZE', 'real', 8, 'size of the measure numbers (pt)');
sid('MEASURE_NUMBERS_CONTINUE', 'bool', false, 'keep counting measures from one movement to the next (otherwise each movement restarts at 1)');
