/*
 * Pid — identifiants de PROPRIÉTÉ (équivalent de `Pid` + `propertyList[]` dans MuseScore, dom/property.h).
 *
 * Chaque Pid a : un type (validation), une valeur par défaut, un éventuel Sid (propriété « stylée »),
 * un groupe (pour construire un inspecteur générique) et un nom (= la clé écrite dans le fichier).
 * Toute propriété modifiable d'un élément est ici : « tout est modifiable » = tout passe par cette table.
 * Quels Pid s'appliquent à quel type d'élément : voir schema.js.
 *
 * Valeurs toujours JSON pures (sérialisables), gelées une fois stockées.
 */
import { SID, isSid } from './sid.js';
import { DURATION_BASES, MEASURE_DURATION } from './pitch.js';
import { isFraction } from './fraction.js';
import { DYNAMIC_TYPES, VOICE_ASSIGNMENTS } from './dynamics.js';

export const PID = {};
export const PID_TABLE = {};

/**
 * @param constant  nom de la constante (PID.PITCH)
 * @param name      nom stable de la propriété (clé de fichier) — ne jamais le changer sans migration
 * @param type      bool | int | real | string | color | id | enum | list | object | spelling | interval | duration | timesig | tuplet | fraction
 * @param dflt      valeur par défaut (ignorée si `sid` : le style fournit alors la valeur)
 * @param opts      { sid, group, values (enum), nullable }
 */
function def(constant, name, type, dflt, opts = {}) {
  if (opts.sid && !isSid(opts.sid)) throw new Error(`Sid inconnu pour ${name} : ${opts.sid}`);
  PID[constant] = name;
  PID_TABLE[name] = { name, type, default: dflt, group: 'none', ...opts };
}

// ---------- généralités ----------
def('VISIBLE', 'visible', 'bool', true, { group: 'appearance' });
// Track variant (an alternative of the same part, see model/variants.js): { group, label }; optional, no migration
def('TRACK_VARIANT', 'trackVariant', 'object', null, { group: 'metadata', nullable: true });
def('COLOR', 'color', 'color', null, { group: 'appearance', nullable: true });

// ---------- œuvre (écran de création, roadmap §4 étape 1) ----------
for (const [c, n] of [['SUBTITLE', 'subtitle'], ['COMPOSER', 'composer'], ['ARRANGER', 'arranger'],
  ['LYRICIST', 'lyricist'], ['COPYRIGHT', 'copyright'], ['DATE', 'date']]) {
  def(c, n, 'string', null, { group: 'metadata', nullable: true });
}
def('TITLE', 'title', 'string', '', { group: 'metadata' });
def('ALBUM', 'album', 'string', null, { group: 'metadata', nullable: true });
def('DESCRIPTION', 'description', 'string', null, { group: 'metadata', nullable: true });
// Card number of a movement (sheet of exercises): null = automatic (rank in the work, written with CARD_NUMBER_FORMAT); a string forces it ("3b").
def('CARD_NUMBER', 'cardNumber', 'string', null, { group: 'metadata', nullable: true });
// How automatic card numbers are written: `{n}` = 1, 2, 3… and `{a}` = A, B, C… ("Pattern {n}", "{n}.", "{a})").
def('CARD_NUMBER_FORMAT', 'cardNumberFormat', 'string', '{n}', { group: 'metadata' });

// ---------- masterbar ----------
def('TIME_SIG', 'timeSig', 'timesig', [4, 4], { group: 'measure' });
// Écriture du chiffrage : 'normal' (chiffres), 'common' (C, seulement pour 4/4), 'cut' (C barré, seulement pour 2/2). Affichage seul.
def('TIME_SIG_STYLE', 'timeSigStyle', 'enum', 'normal', { group: 'measure', values: ['normal', 'common', 'cut'] });
def('KEY_SIG', 'keySig', 'int', 0, { group: 'measure' });
def('BAR_TYPE', 'barType', 'enum', 'simple', {
  group: 'measure',
  values: ['simple', 'double', 'final', 'reverseFinal', 'heavy', 'heavyHeavy', 'dashed', 'dotted', 'short', 'tick'],
});
def('REPEAT_START', 'repeatStart', 'bool', false, { group: 'measure' });
def('REPEAT_END', 'repeatEnd', 'bool', false, { group: 'measure' });
// Nombre de passages d'une reprise : porté par le masterbar de la barre de reprise de fin (MuseScore `Measure::repeatCount`, 2 par défaut).
def('REPEAT_COUNT', 'repeatCount', 'int', 2, { group: 'measure' });
// Texte écrit au-dessus de la barre de reprise de fin (« x4 »…) : propre au masterbar de la barre de fin ; null = aucun texte. Libre ; l'interface le tient
// à jour (« x » + nombre de passages) tant qu'il a la forme « xN ».
def('REPEAT_TEXT', 'repeatText', 'string', null, { group: 'measure', nullable: true });
// anacrouse : durée réduite de la mesure (fraction de ronde) ; null = durée du chiffrage
def('MEASURE_LENGTH', 'measureLength', 'fraction', null, { group: 'measure', nullable: true });
def('BEAM_GROUPING', 'beamGrouping', 'list', null, { group: 'measure', nullable: true }); // mesures asymétriques
// Grille de saisie des symboles d'accord (étape 5, tranche 6) : débuts des cases, en fractions exactes depuis le début de la mesure
// (le 1er vaut [0, 1], strictement croissants, tous < longueur de la mesure). null = dérivée du chiffrage (`model/inputgrid.js`).
def('INPUT_GRID', 'inputGrid', 'list', null, { group: 'measure', nullable: true });
// Décalage : position, dans la mesure NOMINALE (celle du chiffrage), où commence le contenu de cette mesure. null =
// automatique : (chiffrage − longueur) pour l'anacrouse (1re mesure du mouvement plus courte que le chiffrage), sinon 0.
// Sert à aligner sur les temps de la mesure complète les silences automatiques et les ligatures (MuseScore : anacrusisOffset).
def('MEASURE_OFFSET', 'measureOffset', 'fraction', null, { group: 'measure', nullable: true });

// ---------- piste ----------
def('NAME', 'name', 'string', '', { group: 'instrument' });
def('ABBREVIATION', 'abbreviation', 'string', '', { group: 'instrument' });
// Transposition de l'instrument de la piste = `Instrument::transpose()` de MuseScore : intervalle ÉCRIT → SONNANT { diatonic, chromatic }
// (clarinette si♭ = { diatonic: -1, chromatic: -2 }). null = celui du catalogue (PID.INSTRUMENT_ID), sinon aucun. Voir transpose.js.
def('TRANSPOSITION', 'transposition', 'interval', null, { group: 'instrument', nullable: true });
// Préférence d'armure écrite de la partie (`Part::preferSharpFlat`, AUTO par défaut) : borne l'armure écrite d'un instrument transpositeur.
def('PREFER_SHARP_FLAT', 'preferSharpFlat', 'enum', 'auto', { group: 'instrument', values: ['auto', 'sharps', 'flats', 'none'] });
// Réglages de notation PROPRES À UNE PISTE (15/10/2026, demande de Jean) : { <SID>: valeur } — surcharge le style du Mouvement pour les portées de cette piste
// seulement (voir `TRACK_STYLE_SIDS` dans model/sid.js pour ce qui peut être surchargé). Absent = le style du Mouvement.
def('STYLE_OVERRIDES', 'styleOverrides', 'object', null, { group: 'instrument', nullable: true });
def('INSTRUMENT_ID', 'instrumentId', 'string', null, { group: 'instrument', nullable: true });
// Icon shown instead of the name on the score (option `INSTRUMENT_NAME_*`): a glyph name of `model/icons.js`; null = none.
def('ICON', 'icon', 'string', null, { group: 'instrument', nullable: true });
// Mixer (track): playback volume 0..1 in steps of 1/127 (the default is 100/127, leaving headroom up to 127/127) and mute. Saved in the file; the session solo is NOT (see ui/mixer-intents.js).
def('MIXER_VOLUME', 'mixerVolume', 'real', 100 / 127, { group: 'instrument' });
def('MUTE', 'mute', 'bool', false, { group: 'instrument' });
// Mixer (track): stereo position −1 (left) … 0 (centre) … +1 (right) in steps of 1/63; saved in the file, automatable (lane 'pan', 0..1 with 0.5 = centre).
def('MIXER_PAN', 'mixerPan', 'real', 0, { group: 'instrument' });
/** The SoundFont instrument the track plays with in the SoundFont engine: { name, program, bankMSB, bankLSB } (null = the one of its catalogue instrument). */
def('SF_PRESET', 'sfPreset', 'object', null, { group: 'instrument', nullable: true });
/** The MIDI dynamics of a track: a transfer curve applied to every note velocity before the synthesizer { x0, y0, x1, y1, bend } (audio/velocity.js `cleanDynamics`); null = untouched. */
def('MIDI_DYNAMICS', 'midiDynamics', 'object', null, { group: 'instrument', nullable: true });
/** The compressor of a track (audio/compressor.js): { on, threshold, ratio, knee, attack, release, makeup, mix, detector }; null = the default one (off). */
def('COMPRESSOR', 'compressor', 'object', null, { group: 'instrument', nullable: true });
/** The equalizer of a track (audio/eq.js): { on, hp, lowF, lowG, m1F, m1G, m1Q, m2F, m2G, m2Q, highF, highG }; null = the default one (off, flat). */
def('EQUALIZER', 'equalizer', 'object', null, { group: 'instrument', nullable: true });
/** The rotary speaker (Leslie) of a track (audio/leslie.js): { mode, vibrato, rate, depth }; null = the default one (a chorale without added effect, only the signs of the score change it). */
def('LESLIE', 'leslie', 'object', null, { group: 'instrument', nullable: true });
// Automation lanes of a track (see model/automation.js): [{ id, param, points: [{ id, measureId, position, value, ramp }] }]
def('AUTOMATION', 'automation', 'list', null, { group: 'instrument', nullable: true });
// range of the pitch-bend automation lane of a track, in semitones each way (the lane's centre = no bend); see model/automation.js PITCH_BEND_RANGES
def('PITCH_BEND_RANGE', 'pitchBendRange', 'int', 2, { group: 'instrument' });
// MASTER_AUTOMATION (movement): the lane of the master volume (same shape as AUTOMATION, one lane with param 'master'): it raises or lowers the whole mix over time.
def('MASTER_AUTOMATION', 'masterAutomation', 'list', null, { group: 'movement', nullable: true });
// Master volume of the work, 0..1 in steps of 1/127 (default 100/127: above it the tracks get louder, up to their own maximum), saved in the file.
def('MASTER_VOLUME', 'masterVolume', 'real', 100 / 127, { group: 'instrument' });
def('MASTER_PAN', 'masterPan', 'real', 0, { group: 'instrument' }); // balance of the whole mix, −1 (left) … +1 (right), 0 = centre

// ---------- portée ----------
def('STAFF_TYPE', 'staffType', 'enum', 'score', {
  group: 'staff',
  values: ['score', 'tab', 'percussion', 'chord', 'rhythm', 'accordion-left', 'numbered', 'neutral', 'lyrics'],
});
def('CLEF', 'clef', 'string', 'G', { group: 'staff' }); // clé de base de la portée ('G'|'F'|'C1'…'C5'|clés d'octave, CLEF_DEFS)
// Changements de clé en cours de morceau : [{ id, measureId, position, clef }] — ancrés comme les voltas (measureId =
// identifiant du masterbar), à une fraction exacte [n,d] depuis le début de cette mesure ; voir layout/clefchanges.js.
// Clé de l'affichage de CONCERT (`ClefTypeList::concertClef` ; `PID.CLEF` = clé écrite, `transposingClef`). null = la même.
def('CONCERT_CLEF', 'concertClef', 'string', null, { group: 'staff', nullable: true });
def('CLEF_CHANGES', 'clefChanges', 'list', [], { group: 'staff' });
// Soufflets (tranche 3, marquage en PLAGE — premier du genre, voir claude/etape-3-suivi-et-decisions.md) :
// [{ id, startChordId, endChordId, hairpinType }], hairpinType: 'cresc'|'decresc'. Ancré par IDENTITÉ des deux accords
// de bornes (pas par measureId+fraction comme les changements de clé) — cohérent avec la règle du projet « jamais se
// fier à la position, toujours vérifier l'identité » : un accord inséré/supprimé avant ne déplace rien ici. Résolu en
// (mi, voix) par layout/hairpins.js (résolution paresseuse, memoïsée par portée, pas stockée).
def('HAIRPINS', 'hairpins', 'list', [], { group: 'staff' });
// Lignes de trille : [{ id, startChordId, endChordId, trillType, play? }] (model/trill.js), ancrées par identité des deux accords de bornes (inclus).
def('TRILLS', 'trills', 'list', [], { group: 'staff' });
// Respirations / césures de la portée : { id, afterId, breathType, pause? } (voir model/breath.js), ancrées APRÈS un accord ou un silence (identité).
def('BREATHS', 'breaths', 'list', [], { group: 'staff' });
// Textes propres à UNE portée (texte de portée de MuseScore) : { id, measureId, position, text, style: 'normal'|'italic'|'bold', placement: 'above'|'below', technique? } (model/stafftextedit.js) ; `technique` (model/techniques.js) atteint aussi le lecteur.
def('STAFF_TEXTS', 'staffTexts', 'list', [], { group: 'staff' });
// Liaisons (tranche 3, marquages en plage — voir claude/etape-3-suivi-et-decisions.md) :
// - Liaisons de PROLONGATION (tie, même hauteur) : [{ id, startNoteId, endNoteId }] — remplace l'ancien PID.TIED
//   (booléen sur la note, jamais rendu, insuffisant dès qu'un accord porte plusieurs ties simultanés : il faut savoir
//   PRÉCISÉMENT quelle note se lie à quelle note suivante). Ancré par identité des deux NOTES de bornes (pas des
//   accords) : résolu en (voix, mi, index dans la mesure) par layout/ties.js (résolution paresseuse, memoïsée).
def('TIES', 'ties', 'list', [], { group: 'staff' });
def('PAGE_HINTS', 'pageHints', 'list', [], { group: 'staff' }); // advised page turns of a staff: [{ id, measureId }], a page is advised to START at that measure (the Lecteur's automatic pages prefer them)
// - Liaisons D'EXPRESSION (slur, plage sur accords, distincte du tie) : [{ id, startChordId, endChordId }] — même
//   mécanisme d'ancrage par identité que PID.HAIRPINS. Résolu par layout/slurs.js.
def('SLURS', 'slurs', 'list', [], { group: 'staff' });
// - Trémolos entre DEUX accords consécutifs d'une même voix et d'une même mesure (MuseScore TremoloTwoChord, C8..C256) :
//   [{ id, startChordId, endChordId, strokes }] — ancrage par identité comme PID.SLURS. Les deux accords portent des
//   durées RÉELLES égales ; la valeur ÉCRITE affichée est le double (les deux notes forment une seule « note »
//   trémolée) — voir layout/tremolo.js. Résolu par layout/tremolo.js.
def('TREMOLOS', 'tremolos', 'list', [], { group: 'staff' });
// - Glissandos (tranche 3) : [{ id, startNoteId, endNoteId, glissandoType?, showText?, text? }] — un glissando MuseScore relie
//   DEUX NOTES (`Note::add` GLISSANDO : une note n'en porte qu'un sortant) ; un accord à plusieurs notes = un glissando par note de
//   départ. Champs facultatifs absents = valeurs de style (SID.GLISSANDO_*). Résolu par layout/glissandos.js.
//   Glissando RUN (organ white-key run, model/glissandorun.js): optional `runDuration` | `stepDuration` (fraction [n, d] of a whole note); the start note is then
//   a before-ornament of the arrival chord and the run sounds before the beat (no FILE_VERSION change: optional fields).
def('GLISSANDOS', 'glissandos', 'list', [], { group: 'staff' });
// Pédales : [{ id, startMeasureId, startPosition, endMeasureId, endPosition, play? }] (model/pedal.js), ancrées par INSTANT (comme PID.CLEF_CHANGES) ; lecture : CC64.
def('PEDALS', 'pedals', 'list', [], { group: 'staff' });
def('HIDDEN_DECOR', 'hiddenDecor', 'list', [], { group: 'staff' }); // décor masqué (barres, clés, armures, chiffrages) : voir decor.js
// - Hammer-on / pull-off (tranche 4d, MuseScore `HammerOnPullOff`, une sous-classe de Slur) : [{ id, startChordId, endChordId }] — ancré par
//   IDENTITÉ de deux accords comme PID.SLURS ; une chaîne de 3 accords ou plus = UNE entrée. La lettre (H si la frette monte, P sinon) est
//   DÉRIVÉE des frettes de chaque paire d'accords consécutifs (`computeHopoTextRegions`), jamais stockée. Résolu par layout/hopos.js.
def('HOPOS', 'hopos', 'list', [], { group: 'staff' });
// bends / dives de guitare (4d-b) : entrées {id, type, startNoteId, endNoteId, showHoldLine?, dipVibrato?, diveTabPos?, slack?} ; montant dérivé des hauteurs
def('BENDS', 'bends', 'list', [], { group: 'staff' });
// molette (pitch bend écrit, hors guitare) : entrées {id, type: 'wheel', startNoteId, endNoteId (= startNoteId), scope: 'chord'|'note', curve?} ; voir model/wheel.js
def('WHEELS', 'wheels', 'list', [], { group: 'staff' });
// lignes de technique de jeu (4d-c) : entrées {id, type: 'palmMute'|'letRing'|'harmonicMark'|'whammyBar'|'vibrato', startChordId, endChordId, text?, vibratoType?, placement?} ancrées par IDENTITÉ des accords de bornes
def('TECH_LINES', 'techLines', 'list', [], { group: 'staff' });
def('LINE_COUNT', 'lineCount', 'int', 5, { group: 'staff' });
def('LINE_COUNT_CHANGES', 'lineCountChanges', 'list', [], { group: 'staff' });
// Portée rythmique / neutre (`rhythm`, `neutral`) : notes sans hauteur (`rhythmnote`) posées sur la ligne du milieu.
//  - RHYTHM_HEAD : 'slash' (barre oblique, groupe `slash` de MuseScore : bouts horizontaux, blanche et ronde en contour) | 'normal' (têtes ordinaires)
//  - RHYTHM_STEM : sens de hampe par défaut de la portée ('down' = MuseScore `Chord::setSlash`, voix 1-2 ; 'up') ; PID.STEM_DIRECTION d'un accord l'emporte
//  - RHYTHM_SOUND : lecture au choix — null (muet) ou numéro MIDI d'un son de percussion (General MIDI) joué à chaque attaque
def('RHYTHM_HEAD', 'rhythmHead', 'enum', 'slash', { group: 'rhythmStaff', values: ['slash', 'normal'] });
def('RHYTHM_STEM', 'rhythmStem', 'enum', 'down', { group: 'rhythmStaff', values: ['down', 'up'] });
def('RHYTHM_SOUND', 'rhythmSound', 'int', null, { group: 'rhythmStaff', nullable: true });
// Grattage (lecture seulement, ajout de Scorsaire) : la portée rythmique joue les accords de la PREMIÈRE portée d'accords du Mouvement, un coup par accord de rythme.
//  - STRUM : vrai = grattage (remplace RHYTHM_SOUND) ; STRUM_PATTERN : coup sans signe 'down' | 'alternate' ; STRUM_DELAY : ms entre cordes (null = d'après le tempo)
//  - STRUM_INSTRUMENT : instrument du DOIGTÉ ('guitar', 'ukulele', 'bass', 'bass5', 'piano') ; le SON vient de la piste, donc il est indépendant (mode ouvert)
def('STRUM', 'strum', 'bool', false, { group: 'rhythmStaff' });
def('STRUM_PATTERN', 'strumPattern', 'enum', null, { group: 'rhythmStaff', nullable: true, values: ['down', 'alternate'] });
// STRUM_CARD: id of the strum card (model/strumcards.js) the staff plays with, null = the standard card; STRUM_CARDS (work) = the project's own cards
def('STRUM_CARD', 'strumCard', 'string', null, { group: 'rhythmStaff', nullable: true });
def('STRUM_CARDS', 'strumCards', 'list', [], { group: 'chord' });
// CHORD_PATTERNS (work) = the project's own chord patterns (model/chordpatterns.js)
def('CHORD_PATTERNS', 'chordPatterns', 'list', [], { group: 'chord' });
// GROOVES (work) = the project's own drum grooves (model/grooves.js)
def('GROOVES', 'grooves', 'list', [], { group: 'chord' });
// STYLES (work) = the project's own styles (model/styles.js): sets of players by role, with a swing
def('STYLES', 'styles', 'list', [], { group: 'chord' });
// The AUTOMATIC PLAYER of a TRACK (model/player.js): an accompaniment that plays the chords of the movement's first chord staff (the table of truth for every track) with a chord pattern
// and a card (model/strumcards.js), on the instrument of the track. The sound, the mixer and the automation are the track's own.
//  - PLAYER_PATTERN: id of the chord pattern, null = no player ; PLAYER_CARD: id of the card, null = the default card of its kind (piano or standard)
//  - PLAYER_INSTRUMENT: the instrument of the FINGERING ('auto' = the one the track suggests, the guitar for a track that suggests the piano when the card is a strumming card)
//  - PLAYER_ACTIVE: false = the player is switched off ; it also stays silent when the track holds written notes (see `playerIsSilent`)
def('PLAYER_PATTERN', 'playerPattern', 'string', null, { group: 'instrument', nullable: true });
def('PLAYER_CARD', 'playerCard', 'string', null, { group: 'instrument', nullable: true });
def('PLAYER_INSTRUMENT', 'playerInstrument', 'enum', 'auto', { group: 'instrument', values: ['auto', 'guitar', 'ukulele', 'bass', 'bass5', 'piano'] });
def('PLAYER_ACTIVE', 'playerActive', 'bool', true, { group: 'instrument' });
//  - PLAYER_SEED: the seed of the chances of the player (model/variation.js): the same seed always plays the same variations; "draw again" gives it a new value
def('PLAYER_SEED', 'playerSeed', 'int', 0, { group: 'instrument' });
//  - PLAYER_RULES: where the variations may come in THIS work (model/variation.js): [{ kind: 'all' | 'approach' | 'break' | 'extra', where: { measureId } | { section }, mode: 'never' | 'always' | 'factor', factor? }]
def('PLAYER_RULES', 'playerRules', 'list', [], { group: 'instrument' });
def('STRUM_DELAY', 'strumDelay', 'real', null, { group: 'rhythmStaff', nullable: true });
// STRUM_PATH: how the fingerings of a guitar rhythm staff follow one another ('off' = each chord alone; the others choose the whole progression at once: model/fretpath.js)
// GRID_LYRICS: whether the verses written ON THE GRID of measures (model/lyrics.js) are drawn under this staff: 'auto' = under the first chord staff when no staff says 'on'
def('GRID_LYRICS', 'gridLyrics', 'enum', 'auto', { group: 'staff', values: ['auto', 'on', 'off'] });
def('STRUM_PATH', 'strumPath', 'enum', 'balanced', { group: 'rhythmStaff', values: ['off', 'easy', 'balanced', 'close'] });
// DIAGRAM_TAB_STAFF (a CHORD staff): the id of a tablature staff whose PLAYED fingering the diagrams of the chord symbols take (null = the proposed fingering); a diagram with no fingering played there falls back on the proposed one and says so
def('DIAGRAM_TAB_STAFF', 'diagramTabStaff', 'string', null, { group: 'chord', nullable: true });
// TAB_DIAGRAMS (a TABLATURE staff): draws the diagram of the fingering written there above its chords — 'off', 'changes' (when the fingering differs from the previous one; the first of each system is always drawn) or 'all' (every chord);
// TAB_DIAGRAMS_MIN: how many strings a chord of the staff needs to count as a chord (2 = power chords). A diagram the user removed on a chord is `DIAGRAM_HIDDEN`.
def('TAB_DIAGRAMS', 'tabDiagrams', 'enum', 'off', { group: 'staff', values: ['off', 'changes', 'first', 'all'] });
def('TAB_DIAGRAMS_MIN', 'tabDiagramsMin', 'int', 2, { group: 'staff' });
// DIAGRAM_STAFF_SCALE: size of the chord diagrams a rhythm / tablature staff draws (1 = follows the movement's default; a chord symbol's own size still wins)
def('DIAGRAM_STAFF_SCALE', 'diagramStaffScale', 'real', 1, { group: 'staff' });
def('DIAGRAM_HIDDEN', 'diagramHidden', 'bool', false, { group: 'chord' });
// STRUM_DIAGRAMS: the chord diagrams drawn above a fretted strumming staff — 'off', 'changes' (when the chord of the chord staff changes) 'first' (a chord is drawn only the first time it appears in the movement) or 'all' (every chord symbol)
def('STRUM_DIAGRAMS', 'strumDiagrams', 'enum', 'off', { group: 'rhythmStaff', values: ['off', 'changes', 'first', 'all'] });
// CHORD_DIAGRAMS: the diagrams a CHORD staff draws above its symbols by itself — 'off' (only the symbols whose diagram was turned on by hand), 'voicing' (a chord the first time, then again only when its FINGERING changes: the verse and the chorus may play it differently), 'all' (every symbol)
def('CHORD_DIAGRAMS', 'chordDiagrams', 'enum', 'off', { group: 'chord', values: ['off', 'voicing', 'all'] });
// 'auto' (default) = the instrument of the track decides (model/fretdiagram.js `strumInstrumentOf`: guitar, ukulele, bass, bass5, or piano for keyboards and organs)
def('STRUM_INSTRUMENT', 'strumInstrument', 'enum', 'auto', { group: 'rhythmStaff', values: ['auto', 'guitar', 'ukulele', 'bass', 'bass5', 'piano'] });
def('STAFF_LINE_THICKNESS', 'staffLineThickness', 'real', null, { group: 'appearance', sid: SID.STAFF_LINE_THICKNESS });
// Linked staves (MuseScore `Staff::linkedStaves`): `LINKED_TO` (staff) = id of the PRIMARY staff whose content this staff shows; a linked staff stores no
// measures (its voices stay empty), the content is projected from the primary one when read (src/model/linkedstaff.js).
// `TAB_STRING` (note of a notation staff) = string a linked tablature gives this note; absent = automatic (`StringData::convertPitch`).
def('LINKED_TO', 'linkedTo', 'id', null, { group: 'tab', nullable: true });
def('TAB_STRING', 'tabString', 'int', null, { group: 'tab', nullable: true });
def('TUNING', 'tuning', 'list', null, { group: 'tab', nullable: true });
def('CAPO', 'capo', 'int', 0, { group: 'tab' }); // capo STATIQUE de la portée accord (forme à jouer, indépendant — roadmap) ; le capo des portées notation/tablature = PID.CAPOS
// capos datés (4e, port de `Capo` / `CapoParams` MuseScore 4.7.5) : entrées {id, itemId, fret, ignoredStrings (numéros de cordes, 1 = la plus aiguë), active, mode: 'playback'|'standard'|'tab', text?}
// ancrées par IDENTITÉ d'un accord ou d'un silence de la portée (le capo vaut jusqu'au suivant) ; `text` absent = texte généré
def('CAPOS', 'capos', 'list', [], { group: 'tab' });
// CHORD_VIEWS (CHORD staff, model/chordview.js): « display tags » = how the chord symbols are READ from a measure on, until the next tag: { id, measureId, mode: 'original' | 'capo' | 'shift', shift (semitones, mode 'shift') }.
// Only the display changes (parts of screen 2, the Lecteur): the sound stays the concert one. No tag = the written chords.
def('CHORD_VIEWS', 'chordViews', 'list', [], { group: 'tab' });
// CHORD_STAFF_VIEW / CHORD_STAFF_SHIFT (a chord staff LINKED to another chord staff, model/linkedstaff.js): the second display of the chord track, READ ONLY: 'capo' (the chords as played with the capo in force),
// 'author' (the display tags of the primary chord staff) or 'shift' (CHORD_STAFF_SHIFT semitones, -11..11). The sound and the written chords never change.
def('CHORD_STAFF_VIEW', 'chordStaffView', 'enum', 'capo', { group: 'tab', values: ['capo', 'author', 'shift'] });
def('CHORD_STAFF_SHIFT', 'chordStaffShift', 'int', 0, { group: 'tab' });
// CHORD_CAPO_STAFF (CHORD staff): the notation / tablature staff whose capos give the « capo shapes » of the chords (several guitars may have different capos); absent = the first staff that has some
def('CHORD_CAPO_STAFF', 'chordCapoStaff', 'id', null, { group: 'tab', nullable: true });
// textes d'accordage affichés (4e, `StringTunings`) : entrées {id, itemId, visibleStrings (numéros de cordes ; absent = toutes), tuning? (accordage porté par l'élément, absent = celui de la portée)}
def('STRING_TUNINGS', 'stringTunings', 'list', [], { group: 'tab' });
// Préréglage de tablature de MuseScore 4.7.5 : 'simple' (sans hampes) | 'common' (hampes sous la portée) | 'full' (hampes à travers la portée). Défaut Scorsaire : full.
def('TAB_STYLE', 'tabStyle', 'string', 'full', { group: 'tab' });
// Percmap de la portée de percussion (UNIQUE pour toute percussion à son indéterminé : batterie, percussions à main, d'orchestre… ; unification du 05/10/2026,
// fichiers migrés en v13) : objet complet { name, sounds: [{ id, name, midi, head, line, voice, stemDirection, names? }] } — voir percmap.js ; nul = DEFAULT_PERCMAP (Scorsaire Drum Kit)
def('PERCMAP', 'percmap', 'object', null, { group: 'percussion', nullable: true });
def('STICKING_SYSTEM', 'stickingSystem', 'object', null, { group: 'percussion', nullable: true });
def('ACCORDION_SYSTEM', 'accordionSystem', 'string', 'stradella-2-4-italian', { group: 'accordion' });
def('ACCORDION_LAYOUT', 'accordionLayout', 'object', null, { group: 'accordion', nullable: true }); // réglages de la portée accordéon (model/accordion.js) ; absent = valeurs par défaut
def('SHOW_BASS_BADGES', 'showBassBadges', 'bool', true, { group: 'accordion' });
def('INSTRUMENT_PROFILE', 'instrumentProfile', 'object', null, { group: 'accordion', nullable: true });
def('LOCKS', 'locks', 'object', null, { group: 'staff', nullable: true }); // verrou de protection (§4 étape 10)

// ---------- notes et silences ----------
def('PITCH', 'pitch', 'int', 60, { group: 'pitch' });
def('SPELLING', 'spelling', 'spelling', null, { group: 'pitch', nullable: true });
def('DURATION', 'duration', 'duration', { base: 'quarter', dots: 0 }, { group: 'rhythm' });
def('TUPLET', 'tuplet', 'tuplet', null, { group: 'rhythm', nullable: true });
def('EXPLICIT', 'explicit', 'bool', false, { group: 'rhythm' }); // silence posé à la main (§4 étape 4)
// Silence « trou » (MuseScore `Rest::isGap`) : silence d'une voix 2-4, ni dessiné, ni joué, ni sélectionnable, qui garde la mesure remplie. Jamais en voix 1.
def('GAP', 'gap', 'bool', false, { group: 'rhythm' });
def('BEAM_BREAK', 'beamBreak', 'bool', false, { group: 'rhythm' });
// Silence ligaturé : la ligature de ses voisins PASSE par lui (MuseScore : mode de ligature MID posé sur un silence ; par défaut un
// silence coupe toujours la ligature, `Groups::actualBeamMode`). Propriété du SILENCE.
def('BEAM_THROUGH', 'beamThrough', 'bool', false, { group: 'rhythm' });
// Ornement (tranche 3, notes d'ornement) : un ornement est un ACCORD enfant (`chord.graceNotes`, liste d'éléments, ordre
// temporel : indice 0 = le plus tôt ; les « avant » d'abord puis les « après »), qui ne consomme aucun temps dans la
// mesure. `graceType` (MuseScore NoteType) : null = accord normal ; sinon 'acciaccatura' | 'appoggiatura' | 'grace4' |
// 'grace16' | 'grace32' (AVANT l'accord principal) ou 'grace8after' | 'grace16after' | 'grace32after' (APRÈS).
// `showStemSlash` : null = défaut du type (barre seulement pour l'acciaccature, Chord::setNoteType) ; booléen = forcé.
def('GRACE_TYPE', 'graceType', 'enum', null, {
  group: 'rhythm', nullable: true,
  values: ['acciaccatura', 'appoggiatura', 'grace4', 'grace16', 'grace32', 'grace8after', 'grace16after', 'grace32after'],
});
def('SHOW_STEM_SLASH', 'showStemSlash', 'bool', null, { group: 'appearance', nullable: true });
def('ARTICULATIONS', 'articulations', 'list', [], { group: 'marking' });
// Trémolo sur UNE note (MuseScore TremoloSingleChord) : null | { strokes: 1..6 } | { buzz: true } (roulement, glyphe
// `buzzRoll`). Le trémolo entre DEUX accords est une propriété de portée (PID.TREMOLOS, ancrage par identité).
def('TREMOLO', 'tremolo', 'tremolo', null, { group: 'marking', nullable: true });
// Nuance de l'accord (tranche « nuances », vocabulaire complet de MuseScore : voir dynamics.js) : étiquette parmi DYNAMIC_TYPES, 'other' = texte libre (DYNAMIC_TEXT).
def('DYNAMIC', 'dynamic', 'enum', null, { group: 'marking', nullable: true, values: [...DYNAMIC_TYPES] });
def('DYNAMIC_TEXT', 'dynamicText', 'string', null, { group: 'marking', nullable: true });
// Portée d'application d'une nuance (accord) ou d'un soufflet : MuseScore `Pid::VOICE_ASSIGNMENT`, défaut = tout l'instrument.
def('VOICE_ASSIGNMENT', 'voiceAssignment', 'enum', 'instrument', { group: 'marking', values: [...VOICE_ASSIGNMENTS] });
// Doigtés d'une NOTE (tranche 6) : liste ordonnée { id, text, kind, placement? }. `kind` : 'fingering' (doigté ordinaire : piano, violon… au-dessus ou
// en dessous de l'accord), 'lhGuitar' (main gauche : à gauche de la note), 'rhGuitar' (main droite, italique : au-dessus ou en dessous), 'stringNumber'
// (numéro de corde, cerclé). `text` = texte libre (« 3 », « 2-3 », « 3-1 », « p »…) comme MuseScore ; `placement` ('above' | 'below') force le côté.
// Ordre de la liste = ordre de création = du BAS vers le HAUT (au-dessus : le 1er est le plus proche de la portée ; en dessous : le dernier) — layout/fingering.js.
// Carte de doigtés de la PORTÉE (tranche 6b) : { preset: 'text'|'glyphs'|'custom', map? } — voir fingeringmap.js ; absente = texte
def('FINGERING_MAP', 'fingeringMap', 'object', null, { group: 'marking', nullable: true });
def('FINGERINGS', 'fingerings', 'list', [], { group: 'marking' });
// Paroles (voir model/lyrics.js) : textes des couplets sur l'ŒUVRE, liens syllabe → accord sur la PORTÉE.
def('LYRIC_TEXTS', 'lyricTexts', 'list', [], { group: 'text' });
def('LYRIC_LINKS', 'lyricLinks', 'list', [], { group: 'staff' });
// Piste « Paroles » (staffType 'lyrics', élément `lyricevent`) : une syllabe posée à un INSTANT (POSITION dans la mesure, fraction exacte), sur la ligne `LYRIC_LINE` (0 = la première,
// empilées sous la même ligne de base) ; `LYRIC_TARGET` = identifiant de l'accord (ou de la note) auquel elle est liée, facultatif.
def('LYRIC_LINE', 'lyricLine', 'int', 0, { group: 'text' });
def('LYRIC_TARGET', 'lyricTarget', 'string', null, { group: 'text', nullable: true });
// LYRIC_RESERVE (on a lyrics STAFF): the words of a text kept WAITING, not yet put on notes (one text, blanks between words); optional, no migration
// LYRIC_HOLD (on a lyrics EVENT): how long the syllable is held past its start, up to the end of the last note it covers (a melisma: one syllable on several notes); optional
def('LYRIC_HOLD', 'lyricHold', 'fraction', null, { group: 'text', nullable: true });
def('LYRIC_RESERVE', 'lyricReserve', 'string', null, { group: 'text', nullable: true });
def('GHOST', 'ghost', 'bool', false, { group: 'marking' });
def('MUTED', 'muted', 'bool', false, { group: 'marking' });
// Parenthèses autour de la note, sur tout type de portée (indépendant de `ghost`, qui en produit aussi)
// harmonique (4d-c, `Note::harmonic` / `displayFret` / `harmonicFret`) : PROPRIÉTÉS DE NOTE ; DISPLAY_FRET : 'none' | 'natural' (« <12> ») | 'artificial' (« 5 <12> ») | 'hide' ; HARMONIC_FRET : frette de touche (nombre, ex. 12 ou 2.4)
def('HARMONIC', 'harmonic', 'bool', false, { group: 'marking' });
def('DISPLAY_FRET', 'displayFret', 'enum', 'none', { group: 'marking', values: ['none', 'natural', 'artificial', 'hide'] });
def('HARMONIC_FRET', 'harmonicFret', 'real', 0, { group: 'marking' });
def('PARENTHESES', 'parentheses', 'bool', false, { group: 'marking' });
// altération AFFICHÉE à la main (percussion : pas d'altération dérivée, mais on peut en poser une graphiquement ; MuseScore : `Accidental` de rôle USER)
def('ACCIDENTAL_DISPLAY', 'accidentalDisplay', 'enum', 'none', { group: 'marking', values: ['none', 'doubleFlat', 'flat', 'natural', 'sharp', 'doubleSharp'] });
// `noStem` de MuseScore (Chord::setNoStem), used for the landing notes of imported bends: a grace chord drawn without stem, flag or beam
def('NO_STEM', 'noStem', 'bool', false, { group: 'appearance' });
def('STEM_DIRECTION', 'stemDirection', 'enum', 'auto', { group: 'appearance', values: ['auto', 'up', 'down'] });
// `combineVoice` de MuseScore (AutoOnOff) : 'auto' = style COMBINE_VOICE ; décide si les voix sont mises en page ENSEMBLE (layoutChords3), pas une fusion de têtes
// `staffMove` de MuseScore (ChordRest) : l'accord / le silence est DESSINÉ sur la portée voisine de la même piste (−1 = au-dessus, +1 = en dessous) ;
// la voix, la durée et la lecture restent celles de sa portée d'origine. Portées de notation (`score`) seulement.
def('STAFF_MOVE', 'staffMove', 'int', 0, { group: 'rhythm' });
def('COMBINE_VOICE', 'combineVoice', 'enum', 'auto', { group: 'appearance', values: ['auto', 'on', 'off'] });
def('STEM_LENGTH', 'stemLength', 'real', null, { group: 'appearance', sid: SID.STEM_LENGTH });
def('STEM_THICKNESS', 'stemThickness', 'real', null, { group: 'appearance', sid: SID.STEM_THICKNESS });
// position dans la mesure (portée accord), en fraction de ronde depuis le début de la mesure
def('POSITION', 'position', 'fraction', null, { group: 'rhythm', nullable: true });
// tablature
def('STRING', 'string', 'int', 1, { group: 'tab' });
def('TECHNIQUES', 'techniques', 'list', [], { group: 'tab' });
// Ligne d'accord (tranche 4d, MuseScore `ChordLine`, « slide » devant ou derrière le numéro) : { type: 'fall'|'doit'|'plop'|'scoop', straight, wavy } sur l'accord.
// Noms MuseScore : droit = Slide out down / Slide out up / Slide in above / Slide in below ; ondulé = « (rough) » ; courbe = Fall / Doit / Plop / Scoop.
def('CHORD_LINE', 'chordLine', 'object', null, { group: 'marking', nullable: true });
// Tapping (4d-d, MuseScore `Tapping`, sous-classe d'Articulation) : { hand: 'left'|'right' } sur l'accord — main gauche = demi-liaison(s) (+ point), main droite = « T » (tablature) / « + » (portée).
def('TAPPING', 'tapping', 'object', null, { group: 'marking', nullable: true });
// Arpège (4d-d, MuseScore `Arpeggio`) : { type: 'normal'|'up'|'down'|'bracket'|'upStraight'|'downStraight' } sur l'accord (étendue = ses notes seulement ; pas d'arpège sur plusieurs portées).
def('ARPEGGIO', 'arpeggio', 'object', null, { group: 'marking', nullable: true });
// percussion (la voix d'un son est la voix qui contient son accord : pas de propriété dédiée)
// son d'une note de percussion : IDENTIFIANT anglais du son dans la percmap de la portée (ex. 'closedHiHat'), jamais un nom français ; le roulement = PID.TREMOLO de l'accord (MuseScore)
def('SOUND', 'sound', 'string', '', { group: 'percussion' });
def('STICKING', 'sticking', 'enum', null, { group: 'percussion', nullable: true, values: ['right', 'left'] });
// portée accord
def('CHORD_ROOT', 'chordRoot', 'object', null, { group: 'chord', nullable: true });
def('CHORD_QUALITY', 'chordQuality', 'string', '', { group: 'chord' });
// dictionnaire de qualités d'accord DU DOCUMENT (étape 5, tranche 5) : { qualities: [{ id, intervals, aliases? }] } — voir chordquality.js ; absent = les 31 qualités intégrées (DEFAULT_CHORD_QUALITIES)
def('CHORD_QUALITIES', 'chordQualities', 'object', null, { group: 'chord', nullable: true });
// orthographe des NOTES d'un accord affichées pour une portée d'accords : 'enharmonic' (depuis la fondamentale, énharmonie mémorisée par qualité ; défaut) | 'key' (selon l'armure)
def('CHORD_SPELLING', 'chordSpelling', 'enum', 'enharmonic', { group: 'chord', values: ['enharmonic', 'key'] });
def('CHORD_BASS', 'chordBass', 'object', null, { group: 'chord', nullable: true });
// play offset of a chord symbol (signed fraction of a whole note: negative = sounds earlier, positive = later); the written position never moves
def('PLAY_OFFSET', 'playOffset', 'sfraction', null, { group: 'chord', nullable: true });
def('CHORD_SPECIAL', 'chordSpecial', 'enum', 'none', { group: 'chord', values: ['none', 'noChord', 'repeat1', 'repeat2'] });
// accordéon main gauche (annexe A.1)
def('ACC_ROW', 'accRow', 'int', 2, { group: 'accordion' }); // rang du bouton (1 contre-basse … 6 diminué) : note de portée « accordéon main gauche »

// ---------- conteneurs (§2) ----------
def('MEASURE_ID', 'measureId', 'id', null, { group: 'anchor', nullable: true }); // identifiant du masterbar d'ancrage
def('SPAN', 'span', 'int', 1, { group: 'anchor' });
def('CONTAINER_KIND', 'containerKind', 'enum', 'text', {
  group: 'container',
  values: ['section', 'symbol', 'annotation', 'nestedNotation', 'text', 'freeSymbol', 'image', 'chordObject',
    'chordDiagram', 'chordDiagramList', 'legend', 'syncRange', 'structure'],
});
def('LABEL', 'label', 'string', null, { group: 'container', nullable: true });
def('SECTION_CATEGORY', 'sectionCategory', 'string', null, { group: 'container', nullable: true });
def('SYMBOL', 'symbol', 'string', null, { group: 'container', nullable: true });
def('TEXT', 'text', 'string', null, { group: 'container', nullable: true });
def('STORAGE', 'storage', 'enum', 'piece', { group: 'container', values: ['piece', 'tab'] });
def('TAB_ID', 'tabId', 'id', null, { group: 'container', nullable: true });
def('CONTENT', 'content', 'object', null, { group: 'container', nullable: true });
def('MIRROR_REF', 'mirrorRef', 'object', null, { group: 'container', nullable: true });
// placement of a staff container: 'above' = stacked over measures (measureId + span); 'between' = a slot in the line between two measures
// (occupies width like a measure, is not a measure): `containerSide` 'before' = just before measureId, 'after' = after it (the end of the piece)
def('CONTAINER_PLACEMENT', 'containerPlacement', 'enum', 'above', { group: 'container', values: ['above', 'between', 'zone'] });
def('CONTAINER_SIDE', 'containerSide', 'enum', 'before', { group: 'container', values: ['before', 'after'] });
def('CONTAINER_SEPARATOR', 'containerSeparator', 'bool', false, { group: 'container' }); // a container between two measures draws a thin vertical line in the middle of its width (a separator; printed too)
def('CONTAINER_WIDTH', 'containerWidth', 'real', null, { group: 'container', nullable: true }); // manual width of a 'between' slot, in staff spaces (absent = from the content)
def('CONTAINER_ALIGN', 'containerAlign', 'enum', 'system', { group: 'container', values: ['system', 'row'] }); // partition intercalée : centrée sur le système (option B) ou dans la rangée de sa portée (option A)
// notes of a nested score in a STACKED container: 'chords' = the times follow the columns of the anchor staff (beats start where the chords start),
// 'document' (default) = the nested staff is spaced on its own, like the rest of the document, inside the measures it covers
def('CONTAINER_SPACING', 'containerSpacing', 'enum', 'document', { group: 'container', values: ['chords', 'document'] });
// 'chords' only: true = the nested notes take part in the spacing of the piece (a denser rhythm widens the measures); false (default) = tight
def('CONTAINER_WIDEN', 'containerWiden', 'bool', false, { group: 'container' });
def('CONTAINER_SHOW_TIMESIG', 'containerShowTimeSig', 'bool', false, { group: 'container' }); // partition imbriquée : chiffrage affiché ? (par défaut non : il dépend des portées de la pièce)
def('CONTAINER_SHOW_KEYSIG', 'containerShowKeySig', 'bool', false, { group: 'container' });
// Nested score settings (an "ossia" is just a nested score with its own settings).
// Signatures: SHOW_TIMESIG / SHOW_KEYSIG false = the score follows the piece (hidden, kept in sync); true = its OWN signature, shown and editable.
// 'aligned' (default) = the fragment's measures sit on the measures of the piece the container covers; 'free' = independent of them (its own
// number of measures and time signature, spread over the width of the container); stacked containers only; never played.
def('CONTAINER_LAYOUT', 'containerLayout', 'enum', 'aligned', { group: 'container', values: ['aligned', 'free'] });
// true (default) = the nested notes follow the real score (instrument and piece transposition apply); false = shown exactly as entered
def('CONTAINER_TRANSPOSE_FOLLOW', 'containerTransposeFollow', 'bool', true, { group: 'container' });
// reduced size of a nested score (every element scaled; 1 = full size)
def('CONTAINER_SCALE', 'containerScale', 'real', 1, { group: 'container' }); // 0.4-1 for a nested score (it can only shrink), 0.4-3 for a text or a diagram (zoom)
// extra distance (staff spaces, >= 0) between a stacked container and what lies under it: the user lifts it away from the staff / brings it back
def('CONTAINER_GAP', 'containerGap', 'real', 0, { group: 'container' });
// playback of a nested score: 'none' (default), 'replace' (the staff below is silent on the measures covered) or 'add' (played in addition)
def('CONTAINER_PLAY', 'containerPlay', 'enum', 'none', { group: 'container', values: ['none', 'replace', 'add'] });

// ---------- groupe / volta / synchronisation ----------
def('START_TRACK_ID', 'startTrackId', 'id', null, { group: 'group', nullable: true });
def('END_TRACK_ID', 'endTrackId', 'id', null, { group: 'group', nullable: true });
// Brackets of MuseScore (`BracketType`): normal = thick line with curled ends, square = thin line with square ends, line = thin line,
// brace = curly brace stretched over the tracks (the automatic brace of a multi-staff track stays automatic).
def('BRACKET_STYLE', 'bracketStyle', 'enum', 'normal', { group: 'group', values: ['normal', 'square', 'line', 'brace'] });
// Bar lines continue through the tracks of the group (MuseScore: staff `barLineSpan`, set per section of the score order; voices: off).
def('GROUP_BARLINES', 'groupBarlines', 'bool', true, { group: 'group' });
// How the groups of a movement are made: 'custom' = by hand; any other value = id of a score order (model/scoreorder.js), the groups
// follow the tracks automatically until the user edits a group by hand (which switches to 'custom').
// Manual displacement: { <identifier of a selectable element>: [dx, dy] } in staff spaces, y down; see layout/offsets.js. null = none.
def('OFFSETS', 'offsets', 'object', null, { group: 'metadata', nullable: true });
// Staves a PART shows (screen 2): list of staff ids ; null = every staff of the movements
def('PART_STAVES', 'partStaves', 'list', null, { group: 'metadata', nullable: true });
def('PART_CANVAS', 'partCanvas', 'string', null, { group: 'metadata', nullable: true }); // the canvas (a tablet) a part is the layout of; none = a PAPER part
def('PART_ROLE', 'partRole', 'string', null, { group: 'metadata', nullable: true }); // what a tablet layout is FOR (DRMS, GTR, BSS…, model/partroles.js): the Lecteur picks it by role, whatever the name
def('SCALE_RECIPE', 'scaleRecipe', 'object', null, { group: 'movement', nullable: true }); // a SCALE MOVEMENT: the recipe of the scale it shows { scale, root, instrument, view, system, position… } (scales/recipe.js)
def('PART_READER', 'partReader', 'object', null, { group: 'metadata', nullable: true }); // settings prepared for the Lecteur by this tablet layout (model/partreader.js)
def('CANVASES', 'canvases', 'list', [], { group: 'metadata' }); // the DESTINATIONS of the work for screens: [{ id, name, format, landscape, widthMm?, heightMm? }]
// Forced breaks of a PART (screen 2): [{ id, measureId, breakKind: 'system' | 'page' }] = a break AFTER that measure (MuseScore LayoutBreak LINE / PAGE)
def('PART_BREAKS', 'partBreaks', 'list', null, { group: 'metadata', nullable: true });
// Fixed systems of a PART: [{ id, from, to }] (masterbar ids, same movement) = those measures form exactly ONE system (MuseScore SystemLock)
def('PART_LOCKS', 'partLocks', 'list', null, { group: 'metadata', nullable: true });
// Header / footer / title block / measure-number overrides of a PART (screen 2), see model/pagetext.js
def('PART_HEADER', 'partHeader', 'object', null, { group: 'metadata', nullable: true });
def('PART_FOOTER', 'partFooter', 'object', null, { group: 'metadata', nullable: true });
def('PART_TITLE', 'partTitle', 'object', null, { group: 'metadata', nullable: true });
// Overrides of single elements in ONE part (screen 2): { <element id (the one it is selected by)>: { color?: '#rrggbb', offset?: [dx, dy] (staff spaces, y down), hidden?: true } }
// Zone between two systems of a PART (screen 2): its cells are staff containers owned by the part, 'zone' placement, anchored to the LAST measure of the system above.
def('CONTAINER_ZONE_COLUMN', 'containerZoneColumn', 'int', 0, { group: 'container' }); // column of the cell (0-3)
def('CONTAINER_ZONE_ROW', 'containerZoneRow', 'int', 0, { group: 'container' }); // several zones can be stacked under one system: row 0 is the first
// A zone cell that belongs to ONE BLOCK of a part by extracts (model/extracts.js): it shows only in that block (rows 10-15 above its first system, rows 0-5 under its last), whatever measure it is anchored to
def('CONTAINER_BLOCK_ID', 'containerBlockId', 'id', null, { group: 'container', nullable: true });
def('CONTAINER_ZONE_HEIGHT', 'containerZoneHeight', 'real', null, { group: 'container', nullable: true }); // room reserved by the zone, staff spaces (the largest of its cells wins)
// A container owned by a PART that sits above / between the measures of ONE staff (screen 2 only): the staff it is anchored to (the measure is `measureId`)
def('CONTAINER_STAFF_ID', 'containerStaffId', 'id', null, { group: 'container', nullable: true });
// chord diagram of a fretted instrument (container kind 'chordDiagram', later also a chord symbol or a chord): the chord it is for ({ root, quality, bass }),
// the instrument, which suggestion to show (0 = the best) and, when the user fingered it by hand, THE VOICING (null = follow the suggestion). See model/fretdiagram.js.
def('VOICING', 'voicing', 'object', null, { group: 'chord', nullable: true });
def('DIAGRAM_CHORD', 'diagramChord', 'object', null, { group: 'chord', nullable: true });
def('DIAGRAM_INSTRUMENT', 'diagramInstrument', 'enum', 'guitar', { group: 'chord', values: ['guitar', 'ukulele', 'bass', 'bass5', 'piano'] });
// a piano diagram can lie horizontally or stand vertically (to save width)
def('DIAGRAM_ORIENTATION', 'diagramOrientation', 'enum', 'horizontal', { group: 'chord', values: ['horizontal', 'vertical'] });
def('DIAGRAM_SUGGESTION', 'diagramSuggestion', 'int', 0, { group: 'chord' });
// DIAGRAM_SOLVER (chord symbol): false = this chord keeps the fingering it would have on its own instead of the one chosen with its neighbours (model/fretpath.js)
def('DIAGRAM_SOLVER', 'diagramSolver', 'bool', true, { group: 'chord' });
// 'follow' mode of a diagram container stacked over measures: it shows ONE diagram per chord symbol written in those measures on the chord staff (they come and go with the
// symbols); `diagramOverrides` = what the user changed for one of them { <chord symbol id>: { voicing?, suggestion? } }
// thickness of the strings of a diagram by string (thick = low), like the tablature option: default on, stored only when switched off
def('DIAGRAM_GAUGE', 'diagramGauge', 'bool', true, { group: 'chord' });
// a chord symbol of the chord staff can carry its own diagram (shown above it, `diagramShown`); size of that diagram
// height of the diagram of a chord symbol above it (staff spaces); null = the movement's style `DIAGRAM_LIFT`
def('DIAGRAM_LIFT', 'diagramLift', 'real', null, { group: 'chord', nullable: true });
def('DIAGRAM_SHOWN', 'diagramShown', 'bool', false, { group: 'chord' });
def('DIAGRAM_SCALE', 'diagramScale', 'real', 1, { group: 'chord' });
// zone cell 'chordDiagramList': one diagram per chord of the chord staff — each chord once ('unique', a dictionary) or in the order they come, repeats included
// (voice leading) — for the whole movement or for the system the zone sits under
def('DIAGRAM_LIST_UNIQUE', 'diagramListUnique', 'bool', true, { group: 'chord' });
def('DIAGRAM_LIST_SCOPE', 'diagramListScope', 'enum', 'movement', { group: 'chord', values: ['movement', 'system'] });
// DIAGRAM_LIST_SOURCE (zone cell 'chordDiagramList'): where the chords come from — 'symbols' (the chord staff) or 'tab' (the fingerings written in a tablature staff, `DIAGRAM_LIST_STAFF`; null = the first tablature of the movement)
def('DIAGRAM_LIST_SOURCE', 'diagramListSource', 'enum', 'symbols', { group: 'chord', values: ['symbols', 'tab'] });
// DIAGRAM_LIST_ALIGN (zone cell 'chordDiagramList'): how the diagrams sit along the cell — 'left' (default), 'center', 'right', or 'justify' (equal gaps, the first diagram at the left edge and the last at the right edge; a last row with fewer diagrams than the others stays on the left)
def('DIAGRAM_LIST_ALIGN', 'diagramListAlign', 'enum', 'left', { group: 'chord', values: ['left', 'center', 'right', 'justify'] });
def('DIAGRAM_LIST_STAFF', 'diagramListStaff', 'string', null, { group: 'chord', nullable: true });
// DIAGRAM_LIST_VARIANTS (zone cell 'chordDiagramList', chords from the chord staff): which fingerings of a chord are drawn — 'main' (one per chord: the first one met, or every symbol when not `unique`), 'played' (one per chord AND fingering as it is played at each occurrence: the verse and the chorus may have a different one, a diagram only when the fingering changes), 'layer' (the main fingering and the active alternatives of the layer, side by side)
def('DIAGRAM_LIST_VARIANTS', 'diagramListVariants', 'enum', 'main', { group: 'chord', values: ['main', 'played', 'layer'] });
// DIAGRAM_LIST_GROUPS (zone cell 'chordDiagramList', chords from the chord staff): 'sections' = the diagrams are grouped by the SECTION of the form their chord is in (the verse on the left, the chorus on the right…), each group under its name and a rule; the uniqueness is then per group
def('DIAGRAM_LIST_GROUPS', 'diagramListGroups', 'enum', 'off', { group: 'chord', values: ['off', 'sections', 'labels'] }); // 'labels' = the groups are the LABELS the user gave the fingerings of the layer (Chords of the piece window): only the labelled fingerings are listed
// DIAGRAM_LIST_LABEL_SIZE (zone cell 'chordDiagramList'): the size of the name written over a group (× 1 = the default size)
def('DIAGRAM_LIST_LABEL_SIZE', 'diagramListLabelSize', 'real', 1, { group: 'chord' });
def('DIAGRAM_FOLLOW', 'diagramFollow', 'bool', false, { group: 'chord' });
def('DIAGRAM_OVERRIDES', 'diagramOverrides', 'object', null, { group: 'chord', nullable: true });
// the work's preferred fingering per chord and instrument { <key>: voicing }: wins over the suggestion everywhere that chord is shown (model/fretdiagram.js)
def('PREFERRED_VOICINGS', 'preferredVoicings', 'object', null, { group: 'chord', nullable: true });
// the work's OTHER layers of preferred fingerings ("pools": an easier set, power chords…): [{ id, name, voicings: { <key>: voicing }, rule: null | 'power' }] (model/voicingpools.js).
// The main pool is PREFERRED_VOICINGS. A layer only holds what it changes: the rest falls back to the main pool, then to the suggestions.
def('VOICING_POOLS', 'voicingPools', 'list', null, { group: 'chord', nullable: true });
// a printed part / a diagram-list zone cell shows the fingerings of this layer (null = the main pool)
// free texts of ONE printed part, above / below a staff, with an optional line (model/partstafftext.js): [{ id, staffId, measureId, position, text, style, placement, line?, lineSpan?, toEnd?, hook? }]
def('PART_STAFF_TEXTS', 'partStaffTexts', 'list', null, { group: 'metadata', nullable: true });
def('PART_VOICING_POOL', 'partVoicingPool', 'string', null, { group: 'metadata', nullable: true });
def('DIAGRAM_LIST_POOL', 'diagramListPool', 'string', null, { group: 'chord', nullable: true });
def('RANGE_STAFF_ID', 'rangeStaffId', 'id', null, { group: 'container', nullable: true }); // 'syncRange' cell: the staff it shows…
def('RANGE_FROM', 'rangeFrom', 'id', null, { group: 'container', nullable: true }); // …from this measure (masterbar id)…
def('RANGE_TO', 'rangeTo', 'id', null, { group: 'container', nullable: true }); // …to this one, read-only, always in step with the piece
// Extra room between the staves of every system of a part (staff spaces), and for one staff (the room above it)
def('PART_STAFF_GAP', 'partStaffGap', 'real', null, { group: 'metadata', nullable: true });
def('PART_STAFF_GAPS', 'partStaffGaps', 'object', null, { group: 'metadata', nullable: true });
// How ONE part shows the tracks (screen 2): the order of the tracks (ids, the whole list) and a display transposition per track ({ <track id>: { diatonic, chromatic } }; absent = the track's own)
def('PART_TRACK_ORDER', 'partTrackOrder', 'list', null, { group: 'metadata', nullable: true });
def('PART_TRANSPOSITIONS', 'partTranspositions', 'object', null, { group: 'metadata', nullable: true });
// PART_TRANSPOSE_ALL: a display transposition of the WHOLE part, in semitones (positive = everything is written higher), added to what each track has (its own or its instrument's)
def('PART_TRANSPOSE_ALL', 'partTransposeAll', 'int', 0, { group: 'metadata' });
// PART_CHORD_VIEW: how a part (or the Lecteur) reads the chord symbols: 'author' (the display tags of the chord staff; default), 'original' (as written) or 'capo' (the chords as played with the capo in force)
def('PART_CHORD_VIEW', 'partChordView', 'enum', 'author', { group: 'metadata', values: ['author', 'original', 'capo'] });
// Display of ONE track per screen layer (model/trackdisplay.js): { showBars?: false, sizePct?: 25..200 }; on the track = screen 1 (and the fallback of the others),
// on a part = { <track id>: { showBars?, sizePct? } } (screen 2). Defaults are never stored.
// COMPOSITES (a track): composite staves = one staff that shows, measure by measure, one of the track's own staves (notation, tablature, rhythm…); a display only, the
// staves stay as they are. [{ id, name, base: staff id (shown where no range says otherwise), ranges: [{ from: masterbar id, to: masterbar id, staff: staff id }], equal?: bool }]
// (model/composite.js). A screen shows one through the `composite` key of its display layer (model/trackdisplay.js).
def('COMPOSITES', 'composites', 'list', null, { group: 'instrument', nullable: true });
def('TRACK_DISPLAY', 'trackDisplay', 'object', null, { group: 'instrument', nullable: true });
def('PART_TRACK_DISPLAY', 'partTrackDisplay', 'object', null, { group: 'metadata', nullable: true });
def('PART_OVERRIDES', 'partOverrides', 'object', null, { group: 'metadata', nullable: true });
// Text styles of the printed texts of a PART (title, subtitle, credits, free lines, header and footer areas, measure numbers): { <key>: { family?, size? (pt), bold?, italic?, underline?, align?, color? } }, see model/pagetext.js
// System dividers of a printed part / of a sheet: only the values that differ from the defaults (model/dividers.js)
def('PART_DIVIDERS', 'partDividers', 'object', null, { group: 'metadata', nullable: true });
// Parts by extracts (model/extracts.js): when set (a non-empty list), the part shows only its blocks, each a slice of a movement chosen by section or by measures
def('PART_EXTRACTS', 'partExtracts', 'list', null, { group: 'metadata', nullable: true });
// PART_EXTRACT_LAYOUT: how the blocks of a part by extracts are set on the page (model/extracts.js › extractLayoutOf): { columns 1-4, gap (staff spaces between columns), flow 'grid' | 'free', perPage (0 = as many as fit), numbers }; only what differs from the defaults is stored
def('PART_EXTRACT_LAYOUT', 'partExtractLayout', 'object', null, { group: 'metadata', nullable: true });
// « Lyrics by strophes » (model/lyricstrophes.js): { columns, size, cards, strophes: null (automatic) | list }; absent = a normal part
def('PART_LYRICS_PAGE', 'partLyricsPage', 'object', null, { group: 'metadata', nullable: true });
def('SHEET_DIVIDERS', 'sheetDividers', 'object', null, { group: 'metadata', nullable: true });
def('PART_TEXT_STYLES', 'partTextStyles', 'object', null, { group: 'metadata', nullable: true });
def('PART_MEASURE_NUMBERS', 'partMeasureNumbers', 'list', null, { group: 'metadata', nullable: true });
// Measure numbering (document, shared by every part): a measure that is not counted (MuseScore `irregular`; absent = automatic: a pickup measure) and an offset added from this measure on
def('MEASURE_NUMBER_EXCLUDE', 'measureNumberExclude', 'bool', false, { group: 'measure', explicit: true });
def('MEASURE_NUMBER_OFFSET', 'measureNumberOffset', 'int', 0, { group: 'measure' });
def('GROUP_ORDER', 'groupOrder', 'string', 'custom', { group: 'metadata' });
// Named views of a movement (screen only): [{ id, name, tracks: [{ id (track), staves?: [staff ids] }] }]; applying one writes PID.VISIBLE, see model/viewedit.js
def('VIEWS', 'views', 'list', null, { group: 'metadata', nullable: true });
// The band of BLOCKS of a movement (text now, images later), above its first system, on every screen that shows the movement: BLOCKS = [{ id, kind, x, y, w, h, … }] with
// every coordinate in percent of the WIDTH of the band; BLOCK_ASPECT = height of the band / its width (0.3 by default). See model/blocks.js.
def('BLOCKS', 'blocks', 'list', null, { group: 'metadata', nullable: true });
def('BLOCK_ASPECT', 'blockAspect', 'real', 0.3, { group: 'metadata' });
// the height of what a box on the video shows of a movement that has no staff, as a fraction of the width (null = follows the content, the default)
def('BLOCK_FIT', 'blockFit', 'real', null, { group: 'metadata', nullable: true });
def('VOLTA_NUMBERS', 'voltaNumbers', 'list', [1], { group: 'volta' });
def('VOLTA_OPEN', 'voltaOpen', 'bool', false, { group: 'volta' });
def('VOLTA_TEXT', 'voltaText', 'string', '', { group: 'volta' }); // text written instead of the numbers ("1.", "2."): empty = the numbers
def('VOLTA_TEXT_SIZE', 'voltaTextSize', 'real', null, { group: 'volta', sid: SID.VOLTA_TEXT_SIZE });
def('VOLTA_LINE_WIDTH', 'voltaLineWidth', 'real', null, { group: 'volta', sid: SID.VOLTA_LINE_WIDTH });
def('VOLTA_CORNER', 'voltaCorner', 'real', null, { group: 'volta', sid: SID.VOLTA_CORNER_RADIUS });
// ---------- sauts (D.C., D.S., …) et marqueurs (segno, coda, fine…) — tranche « sauts », MuseScore `Jump` / `Marker` ----------
// Éléments de MASTERBAR (ancrés par measureId, comme les voltas). Le type fixe les trois étiquettes d'un saut (tables dans
// repeats.js) ; le type 'user' les prend des propriétés JUMP_TO / PLAY_UNTIL / CONTINUE_AT. PID.TEXT remplace le texte du type.
def('JUMP_TYPE', 'jumpType', 'enum', 'ds', {
  group: 'jump',
  values: ['dc', 'dcAlFine', 'dcAlCoda', 'dsAlCoda', 'dsAlFine', 'ds', 'dcAlDblCoda', 'dsAlDblCoda', 'dss', 'dssAlCoda', 'dssAlDblCoda', 'dssAlFine', 'user'],
});
def('JUMP_TO', 'jumpTo', 'string', null, { group: 'jump', nullable: true });
def('PLAY_UNTIL', 'playUntil', 'string', null, { group: 'jump', nullable: true });
def('CONTINUE_AT', 'continueAt', 'string', null, { group: 'jump', nullable: true });
// Vrai : la partie rejouée refait ses reprises ; faux (défaut MuseScore) : dernière passe seulement.
def('PLAY_REPEATS', 'playRepeats', 'bool', false, { group: 'jump' });
def('MARKER_TYPE', 'markerType', 'enum', 'fine', {
  group: 'jump',
  values: ['segno', 'varsegno', 'coda', 'varcoda', 'codetta', 'fine', 'toCoda', 'toCodaSym', 'daCoda', 'daDblCoda', 'user'],
});
// Pause (secondes) après la fin d'un Mouvement, avant le suivant (MuseScore : pause du saut de section, `sectionPause` = 3).
def('PAUSE', 'pause', 'real', 3, { group: 'metadata' });
// ---------- tempo (piste système, tranche « tempo ») — éléments `tempo` et `tempoChange` du Mouvement ----------
// Ancrés par `measureId` (masterbar) + fraction exacte `position` depuis le début de la mesure (comme voltas et changements de clé),
// jamais par un accord. Port de MuseScore 4.7.5 `TempoText` / `GradualTempoChange` (voir src/model/tempo.js).
def('TEMPO_KIND', 'tempoKind', 'enum', 'normal', { group: 'tempo', values: ['normal', 'relative', 'aTempo', 'tempoPrimo'] });
def('TEMPO_BPM', 'bpm', 'real', 120, { group: 'tempo' }); // battements par minute, dans l'unité BEAT_UNIT (tempo « écrit », jamais converti)
def('BEAT_UNIT', 'beatUnit', 'object', { base: 'quarter', dots: 0 }, { group: 'tempo' }); // unité de battement : valeur de note + points
def('TEMPO_FACTOR', 'tempoFactor', 'real', 1, { group: 'tempo' }); // 'relative' : tempo précédent × facteur (modulation métrique)
def('TEMPO_FOLLOW_TEXT', 'tempoFollowText', 'bool', false, { group: 'tempo' }); // vrai : bpm / unité relus du texte (« ♩ = 92 »)
def('PLAY', 'play', 'bool', true, { group: 'tempo', explicit: true }); // faux : affiché, ignoré à la lecture ; sur symbole d'accord / accord / note : valeur LOCALE seulement, absente = réglage global (voir play.js)
// Vélocité imposée à UNE note (port de `Note::m_userVelocity`, MuseScore 4.7.5, `Pid::USER_VELOCITY`, tag « velocity ») : entier 0-127 (validé dans
// validate.js, comme le champ « Velocity » 0-127 de l'inspecteur), 0 = AUTOMATIQUE (nuance, soufflet, articulation) ; > 0 = vélocité absolue qui remplace
// tout cela à la lecture (voir src/audio/sequence.js et claude/tranche-uservelocity-fait.md). 0 = défaut : `doc.set(note, pid, 0)` stocke un 0 local
// (équivalent à « automatique »), `doc.reset(note, pid)` retire la valeur locale.
def('USER_VELOCITY', 'userVelocity', 'int', 0, { group: 'tempo' });
def('END_MEASURE_ID', 'endMeasureId', 'id', null, { group: 'anchor', nullable: true });
def('END_POSITION', 'endPosition', 'fraction', null, { group: 'anchor', nullable: true });
// Point d'orgue de la piste système (élément `fermata` du Mouvement) : sorte = type d'articulation SMuFL (glyphes `fermata*Above/Below`) ;
// étirement du temps facultatif (sinon la table de tempo.js). Chez MuseScore un point d'orgue est un élément du segment ; ici c'est un signe de
// STRUCTURE (comme le tempo), ancré par mesure + fraction, qui ne dépend d'aucun contenu de portée.
def('FERMATA_TYPE', 'fermataType', 'enum', 'fermata', { group: 'tempo', values: ['fermataVeryShort', 'fermataShort', 'fermataShortHenze', 'fermata', 'fermataLong', 'fermataLongHenze', 'fermataVeryLong'] });
def('TIME_STRETCH', 'timeStretch', 'real', null, { group: 'tempo', nullable: true });
// Swing (MuseScore : texte système ou de portée avec `swing` + SwingParameters ; ici élément `swing` du Mouvement, ancré comme le tempo).
// `swingUnit` : 'none' (swing désactivé = « Straight »), 'eighth' ou '16th' ; `swingRatio` : % de l'unité (50 = binaire, 60 = swing par défaut,
// 66 = triolet, 75 = pointé, 25 = écossais). `swingKind` : sorte affichée (préréglage de la palette). `staffId` : portée visée (null = toutes).
def('SWING_KIND', 'swingKind', 'enum', 'swing', { group: 'tempo', values: ['swing', 'straight', 'tripletEighth', 'tripletSixteenth', 'dottedEighth', 'dottedSixteenth', 'scottishEighth', 'scottishSixteenth', 'none', 'custom'] });
def('SWING_UNIT', 'swingUnit', 'enum', 'eighth', { group: 'tempo', values: ['none', 'eighth', '16th'] });
def('SWING_RATIO', 'swingRatio', 'int', 60, { group: 'tempo' });
def('TARGET_STAFF_ID', 'staffId', 'id', null, { group: 'anchor', nullable: true });
// Cue of the automatic players (model/cueedit.js): a sign on a measure that says what a drum player does there. `cueKind` 'groove' = from this measure on, play the version `cueValue` of the groove
// ('main' or the id of a variant); 'break' = on this measure only, play the fill `cueValue` ('none' = no fill); 'alt' = on this measure only, a chord / bass player plays its alternative phrase `cueValue` ('none' = the main pattern). `cueTrack` = the drum track it is for (null = all of them). The text is what is shown.
def('CUE_KIND', 'cueKind', 'enum', 'groove', { group: 'tempo', values: ['groove', 'break', 'alt'] });
def('CUE_VALUE', 'cueValue', 'string', 'main', { group: 'tempo' });
def('CUE_TRACK', 'cueTrack', 'id', null, { group: 'anchor', nullable: true });
def('CHANGE_TYPE', 'changeType', 'enum', 'ritardando', {
  group: 'tempo',
  values: ['accelerando', 'allargando', 'calando', 'lentando', 'morendo', 'precipitando', 'rallentando', 'ritardando', 'smorzando', 'sostenuto', 'stringendo', 'user'],
});
def('TARGET_BPM', 'targetBpm', 'real', null, { group: 'tempo', nullable: true }); // tempo d'arrivée explicite (sinon départ × facteur)
def('TARGET_BEAT_UNIT', 'targetBeatUnit', 'object', null, { group: 'tempo', nullable: true }); // unité du tempo d'arrivée (défaut : celle du départ)
def('CHANGE_FACTOR', 'changeFactor', 'real', null, { group: 'tempo', nullable: true }); // facteur d'arrivée (défaut : celui du type, table MuseScore)
// Courbe : -1 (concave : démarre vite) … 0 (linéaire) … +1 (convexe : démarre lentement) ; progression = x^(4^courbe).
def('CHANGE_CURVE', 'changeCurve', 'real', 0, { group: 'tempo' });
// Résolution des marches du graduel : dénominateur de la valeur de note d'une marche (8 = croche, 16, 32 = triple croche).
def('CHANGE_RESOLUTION', 'changeResolution', 'int', 8, { group: 'tempo' });
def('SYNC_SOURCE', 'syncSource', 'object', null, { group: 'sync', nullable: true });
def('SYNC_ANCHORS', 'syncAnchors', 'list', [], { group: 'sync' });
def('SYNC_OFFSET', 'syncOffset', 'real', 0, { group: 'sync' });

// ---------- validation des valeurs ----------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPosInt = (v) => Number.isInteger(v) && v > 0;

const CHECKS = {
  bool: (v) => typeof v === 'boolean',
  int: (v) => Number.isInteger(v),
  real: (v) => typeof v === 'number' && Number.isFinite(v),
  string: (v) => typeof v === 'string',
  color: (v) => typeof v === 'string',
  id: (v) => typeof v === 'string' && v.length > 0,
  list: (v) => Array.isArray(v),
  object: isObj,
  tremolo: (v) => isObj(v) && ((Number.isInteger(v.strokes) && v.strokes >= 1 && v.strokes <= 6 && v.buzz === undefined)
    || (v.buzz === true && v.strokes === undefined)),
  interval: (v) => isObj(v) && Number.isInteger(v.diatonic) && Number.isInteger(v.chromatic),
  spelling: (v) => isObj(v) && 'CDEFGAB'.includes(v.step) && v.step.length === 1
    && Number.isInteger(v.alter ?? 0) && Number.isInteger(v.octave),
  duration: (v) => isObj(v) && (DURATION_BASES.includes(v.base) || v.base === MEASURE_DURATION) && Number.isInteger(v.dots ?? 0) && (v.dots ?? 0) >= 0,
  fraction: (v) => isFraction(v) && v[0] >= 0,
  sfraction: (v) => isFraction(v), // signed fraction (play offsets)
  timesig: (v) => Array.isArray(v) && v.length === 2 && isPosInt(v[0]) && isPosInt(v[1]),
  // n-olet : { id, ratio: [num, den], base: { base, dots } } — `base` = unité du groupe (sert à connaître son étendue)
  tuplet: (v) => isObj(v) && typeof v.id === 'string' && Array.isArray(v.ratio) && v.ratio.length === 2
    && isPosInt(v.ratio[0]) && isPosInt(v.ratio[1])
    && isObj(v.base) && DURATION_BASES.includes(v.base.base) && Number.isInteger(v.base.dots ?? 0) && (v.base.dots ?? 0) >= 0,
};

export function isPid(name) {
  return Object.hasOwn(PID_TABLE, name);
}

/** Lève une erreur claire si `value` n'est pas admissible pour cette propriété. */
export function validatePropertyValue(pid, value) {
  const d = PID_TABLE[pid];
  if (!d) throw new Error(`Propriété inconnue : ${pid}`);
  if (value === null && d.nullable) return;
  const ok = d.type === 'enum' ? d.values.includes(value) : CHECKS[d.type](value);
  if (!ok) throw new Error(`Valeur invalide pour la propriété « ${pid} » (${d.type}) : ${JSON.stringify(value)}`);
}

// ---------- sheet (screen 3: how the work is presented to a reader) ----------
def('SHEET_LAYOUT', 'sheetLayout', 'string', 'column', { group: 'metadata', nullable: true });
def('SHEET_COLUMNS', 'sheetColumns', 'int', 2, { group: 'metadata', nullable: true });
def('SHEET_CELLS', 'sheetCells', 'list', null, { group: 'metadata', nullable: true });
def('SHEET_READER', 'sheetReader', 'object', null, { group: 'metadata', nullable: true });
