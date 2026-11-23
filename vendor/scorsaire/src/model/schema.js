/*
 * Schéma du modèle : types d'éléments, listes d'enfants autorisées, propriétés (Pid) applicables,
 * accesseurs de lecture historiques, et catalogue des types de portée (roadmap §2 et §2.1, annexe A).
 *
 * Les types de portée sont des DESCRIPTEURS (données), pas des classes : un type de portée = quels éléments
 * elle accepte + ses attributs par défaut. Ajouter un type = ajouter une entrée ici.
 */
import { PID } from './pid.js';

const COMMON = [PID.VISIBLE, PID.COLOR];

/**
 * Pour chaque type d'élément :
 *  - prefix   : préfixe des identifiants
 *  - children : clé de liste → types d'enfants admis
 *  - pids     : propriétés applicables
 *  - readers  : accesseurs de LECTURE non énumérables (compatibilité avec le squelette : `note.pitch`, `staff.clef`…)
 *  - hasStyle : porte un dictionnaire de styles surchargés (le Mouvement)
 */
export const ELEMENT_TYPES = {
  work: {
    prefix: 'w',
    children: { movements: ['movement'], parts: ['part'], sheets: ['sheet'] },
    pids: [PID.CANVASES, PID.TITLE, PID.SUBTITLE, PID.COMPOSER, PID.ARRANGER, PID.LYRICIST, PID.COPYRIGHT, PID.DATE, PID.ALBUM, PID.CHORD_QUALITIES, PID.PREFERRED_VOICINGS, PID.VOICING_POOLS, PID.STRUM_CARDS, PID.CHORD_PATTERNS, PID.GROOVES, PID.STYLES, PID.LYRIC_TEXTS, PID.MASTER_VOLUME, PID.MASTER_PAN, PID.CARD_NUMBER_FORMAT],
    readers: { title: PID.TITLE },
  },
  // a SHEET = how the work is presented to a reader (screen 3): cells (one movement each, with the tracks shown), a layout, and the options offered to the reader
  sheet: { prefix: 'sh', children: {}, pids: [PID.NAME, PID.SHEET_LAYOUT, PID.SHEET_COLUMNS, PID.SHEET_CELLS, PID.SHEET_READER, PID.SHEET_DIVIDERS], readers: { name: PID.NAME } },
  // a PART = a print layout of the work (screen 2): own page, staves shown, style layer (`style`: PAGE_* and any style of the movement)
  part: { prefix: 'pt', children: { containers: ['staffContainer'] }, pids: [PID.PART_STAFF_TEXTS, PID.PART_VOICING_POOL, PID.PART_CANVAS, PID.PART_ROLE, PID.PART_READER, PID.PART_STAFF_GAP, PID.PART_STAFF_GAPS, PID.PART_TRACK_ORDER, PID.PART_TRANSPOSITIONS, PID.PART_TRANSPOSE_ALL, PID.PART_CHORD_VIEW, PID.PART_TRACK_DISPLAY, PID.NAME, PID.PART_STAVES, PID.PART_BREAKS, PID.PART_LOCKS, PID.PART_HEADER, PID.PART_FOOTER, PID.PART_TITLE, PID.PART_MEASURE_NUMBERS, PID.PART_OVERRIDES, PID.PART_TEXT_STYLES, PID.PART_DIVIDERS, PID.PART_EXTRACTS, PID.PART_EXTRACT_LAYOUT, PID.PART_LYRICS_PAGE], readers: { name: PID.NAME }, hasStyle: true },
  movement: {
    prefix: 'mv',
    children: {
      masterbars: ['masterbar'],
      tracks: ['track'],
      systemContainers: ['systemContainer'],
      groups: ['group'],
      voltas: ['volta'],
      jumps: ['jump'],
      markers: ['marker'],
      rehearsalMarks: ['rehearsal'],
      tempos: ['tempo'],
      tempoChanges: ['tempoChange'],
      fermatas: ['fermata'],
      swings: ['swing'],
      cues: ['cue'],
      syncs: ['sync'],
    },
    pids: [PID.TITLE, PID.DESCRIPTION, PID.CARD_NUMBER, PID.PAUSE, PID.GROUP_ORDER, PID.OFFSETS, PID.VIEWS, PID.BLOCKS, PID.BLOCK_ASPECT, PID.BLOCK_FIT, PID.MASTER_AUTOMATION, PID.SCALE_RECIPE],
    readers: { title: PID.TITLE },
    hasStyle: true,
  },
  masterbar: {
    prefix: 'b',
    children: {},
    pids: [PID.TIME_SIG, PID.TIME_SIG_STYLE, PID.KEY_SIG, PID.BAR_TYPE, PID.REPEAT_START, PID.REPEAT_END, PID.REPEAT_COUNT, PID.REPEAT_TEXT, PID.MEASURE_LENGTH, PID.MEASURE_OFFSET,
      PID.BEAM_GROUPING, PID.INPUT_GRID, PID.MEASURE_NUMBER_EXCLUDE, PID.MEASURE_NUMBER_OFFSET],
    readers: { timeSig: PID.TIME_SIG, keySig: PID.KEY_SIG, barType: PID.BAR_TYPE },
  },
  track: {
    prefix: 't',
    children: { staves: ['staff'] },
    pids: [PID.NAME, PID.ABBREVIATION, PID.TRANSPOSITION, PID.PREFER_SHARP_FLAT, PID.INSTRUMENT_ID, PID.ICON, PID.VISIBLE, PID.TRACK_VARIANT, PID.STYLE_OVERRIDES, PID.TRACK_DISPLAY, PID.COMPOSITES, PID.MIXER_VOLUME, PID.MIXER_PAN, PID.MUTE, PID.SF_PRESET, PID.MIDI_DYNAMICS, PID.COMPRESSOR, PID.EQUALIZER, PID.LESLIE, PID.AUTOMATION, PID.PITCH_BEND_RANGE,
      PID.PLAYER_PATTERN, PID.PLAYER_CARD, PID.PLAYER_INSTRUMENT, PID.PLAYER_ACTIVE, PID.PLAYER_SEED, PID.PLAYER_RULES],
    readers: { name: PID.NAME, abbreviation: PID.ABBREVIATION, transposition: PID.TRANSPOSITION },
  },
  staff: {
    prefix: 's',
    children: { voices: ['voice'], containers: ['staffContainer'] },
    pids: [PID.DIAGRAM_TAB_STAFF, PID.CHORD_DIAGRAMS, PID.TAB_DIAGRAMS, PID.TAB_DIAGRAMS_MIN, PID.DIAGRAM_STAFF_SCALE, PID.LYRIC_RESERVE, PID.STAFF_TYPE, PID.CLEF, PID.CONCERT_CLEF, PID.CLEF_CHANGES, PID.PAGE_HINTS, PID.HAIRPINS, PID.TRILLS, PID.BREATHS, PID.STAFF_TEXTS, PID.LYRIC_LINKS, PID.TIES, PID.SLURS, PID.HOPOS, PID.BENDS, PID.WHEELS, PID.TECH_LINES, PID.TREMOLOS, PID.GLISSANDOS, PID.PEDALS, PID.HIDDEN_DECOR, PID.LINE_COUNT, PID.LINE_COUNT_CHANGES, PID.RHYTHM_HEAD, PID.RHYTHM_STEM, PID.RHYTHM_SOUND, PID.STRUM, PID.STRUM_CARD, PID.STRUM_PATTERN, PID.STRUM_DELAY, PID.STRUM_PATH, PID.GRID_LYRICS, PID.STRUM_DIAGRAMS, PID.STRUM_INSTRUMENT,
      PID.STAFF_LINE_THICKNESS, PID.TUNING, PID.CAPO, PID.CAPOS, PID.CHORD_VIEWS, PID.CHORD_STAFF_VIEW, PID.CHORD_STAFF_SHIFT, PID.CHORD_CAPO_STAFF, PID.STRING_TUNINGS, PID.TAB_STYLE, PID.PERCMAP, PID.STICKING_SYSTEM, PID.FINGERING_MAP, PID.ACCORDION_SYSTEM, PID.ACCORDION_LAYOUT, PID.SHOW_BASS_BADGES, PID.CHORD_SPELLING,
      PID.INSTRUMENT_PROFILE, PID.LOCKS, PID.VISIBLE, PID.LINKED_TO],
    readers: { staffType: PID.STAFF_TYPE, clef: PID.CLEF },
  },
  voice: { prefix: 'v', children: { measures: ['measure'] }, pids: [PID.VISIBLE], readers: {} },
  measure: {
    prefix: 'm',
    // Contenu d'une mesure : accords de notes, silences, symboles d'accord, (selon le type de portée)
    children: { items: ['chord', 'rest', 'chordsymbol', 'lyricevent'] },
    pids: [],
    readers: {},
  },
  // Accord de notes (au sens musical : plusieurs hauteurs sur une même hampe — MuseScore : Chord → Note).
  // Porte ce qui est commun à toutes ses notes : durée, n-olet, ligature, hampe, ornements, articulations, paroles.
  chord: {
    prefix: 'ch',
    children: { notes: ['note', 'tabnote', 'percnote', 'accnote', 'rhythmnote'], graceNotes: ['chord'] },
    pids: [PID.DURATION, PID.TUPLET, PID.BEAM_BREAK, PID.GRACE_TYPE, PID.SHOW_STEM_SLASH, PID.ARTICULATIONS, PID.CHORD_LINE, PID.TAPPING, PID.ARPEGGIO, PID.TREMOLO, PID.DYNAMIC, PID.DYNAMIC_TEXT, PID.VOICE_ASSIGNMENT,
      PID.STEM_DIRECTION, PID.NO_STEM, PID.COMBINE_VOICE, PID.STEM_LENGTH, PID.STEM_THICKNESS, PID.PLAY, PID.STAFF_MOVE, PID.DIAGRAM_SHOWN, PID.DIAGRAM_HIDDEN, PID.DIAGRAM_INSTRUMENT, PID.DIAGRAM_SCALE, PID.DIAGRAM_LIFT, PID.DIAGRAM_GAUGE, PID.DIAGRAM_ORIENTATION, ...COMMON],
    readers: { duration: PID.DURATION },
  },
  note: {
    prefix: 'n',
    children: {},
    pids: [PID.PITCH, PID.SPELLING, PID.TAB_STRING, PID.FINGERINGS, PID.GHOST, PID.MUTED, PID.PARENTHESES, PID.HARMONIC, PID.DISPLAY_FRET, PID.HARMONIC_FRET, PID.PLAY, PID.USER_VELOCITY, ...COMMON],
    readers: { pitch: PID.PITCH, spelling: PID.SPELLING },
  },
  // note de portée rythmique / neutre : AUCUNE hauteur (position fixe sur la ligne du milieu), un seul par accord
  rhythmnote: {
    prefix: 'rn',
    children: {},
    pids: [PID.GHOST, PID.PARENTHESES, PID.PLAY, PID.USER_VELOCITY, ...COMMON],
    readers: {},
  },
  rest: {
    prefix: 'r',
    children: {},
    pids: [PID.DURATION, PID.TUPLET, PID.EXPLICIT, PID.GAP, PID.BEAM_THROUGH, PID.STAFF_MOVE, ...COMMON],
    readers: { duration: PID.DURATION },
  },
  tabnote: {
    prefix: 'tn',
    children: {},
    pids: [PID.PITCH, PID.STRING, PID.TECHNIQUES, PID.FINGERINGS, PID.GHOST, PID.MUTED, PID.PARENTHESES, PID.HARMONIC, PID.DISPLAY_FRET, PID.HARMONIC_FRET, PID.PLAY, PID.USER_VELOCITY, ...COMMON],
    readers: { pitch: PID.PITCH },
  },
  percnote: {
    prefix: 'pn',
    children: {},
    pids: [PID.SOUND, PID.GHOST, PID.PARENTHESES, PID.ACCIDENTAL_DISPLAY, PID.STICKING, PID.FINGERINGS, PID.ARTICULATIONS, PID.PLAY, PID.USER_VELOCITY, ...COMMON],
    readers: {},
  },
  chordsymbol: {
    prefix: 'cs',
    children: {},
    pids: [PID.CHORD_ROOT, PID.CHORD_QUALITY, PID.CHORD_BASS, PID.CHORD_SPECIAL, PID.PLAY_OFFSET, PID.POSITION, PID.DURATION, PID.PLAY, PID.VOICING, PID.DIAGRAM_INSTRUMENT, PID.DIAGRAM_SUGGESTION, PID.DIAGRAM_SOLVER, PID.DIAGRAM_SHOWN, PID.DIAGRAM_LIFT, PID.DIAGRAM_SCALE, PID.DIAGRAM_GAUGE, PID.DIAGRAM_ORIENTATION, ...COMMON],
    readers: { duration: PID.DURATION },
  },
  // Syllabe d'une piste « Paroles » : texte, instant exact dans la mesure, ligne, lien facultatif vers un accord / une note (voir model/lyricevents.js)
  lyricevent: {
    prefix: 'le',
    children: {},
    pids: [PID.TEXT, PID.POSITION, PID.LYRIC_LINE, PID.LYRIC_TARGET, PID.LYRIC_HOLD],
    readers: {},
  },
  accnote: {
    prefix: 'an',
    children: {},
    pids: [PID.ACC_ROW, PID.PITCH, PID.SPELLING, PID.GHOST, PID.PARENTHESES, PID.ACCIDENTAL_DISPLAY, PID.ARTICULATIONS, PID.PLAY, PID.USER_VELOCITY, ...COMMON],
    readers: { pitch: PID.PITCH, spelling: PID.SPELLING },
  },
  systemContainer: {
    prefix: 'sc',
    children: {},
    pids: [PID.MEASURE_ID, PID.CONTAINER_KIND, PID.LABEL, PID.SECTION_CATEGORY, PID.SYMBOL, PID.TEXT, ...COMMON],
    readers: {},
  },
  staffContainer: {
    prefix: 'c',
    // staves: nested notation aligned on the measures covered (above); fragments: a short MOVEMENT with its own measures, shown in a slot between
    // measures (the same view can edit it on its own)
    children: { staves: ['staff'], fragments: ['movement'] },
    pids: [PID.MEASURE_ID, PID.SPAN, PID.CONTAINER_KIND, PID.LABEL, PID.TEXT, PID.SYMBOL, PID.STORAGE, PID.TAB_ID,
      PID.CONTENT, PID.MIRROR_REF, PID.DIAGRAM_LIST_VARIANTS, PID.DIAGRAM_LIST_GROUPS, PID.DIAGRAM_LIST_LABEL_SIZE, PID.CONTAINER_PLACEMENT, PID.CONTAINER_BLOCK_ID, PID.CONTAINER_SIDE, PID.CONTAINER_WIDTH, PID.CONTAINER_SEPARATOR, PID.CONTAINER_SHOW_TIMESIG, PID.CONTAINER_SHOW_KEYSIG, PID.CONTAINER_LAYOUT, PID.CONTAINER_TRANSPOSE_FOLLOW, PID.CONTAINER_PLAY, PID.SCALE_RECIPE, PID.CONTAINER_SCALE, PID.CONTAINER_ALIGN, PID.CONTAINER_SPACING, PID.CONTAINER_WIDEN, PID.CONTAINER_ZONE_COLUMN, PID.CONTAINER_ZONE_ROW, PID.CONTAINER_ZONE_HEIGHT, PID.CONTAINER_STAFF_ID, PID.VOICING, PID.DIAGRAM_CHORD, PID.DIAGRAM_INSTRUMENT, PID.DIAGRAM_SUGGESTION, PID.DIAGRAM_FOLLOW, PID.DIAGRAM_OVERRIDES, PID.DIAGRAM_GAUGE, PID.DIAGRAM_ORIENTATION, PID.CONTAINER_GAP, PID.DIAGRAM_LIST_UNIQUE, PID.DIAGRAM_LIST_SCOPE, PID.DIAGRAM_LIST_SOURCE, PID.DIAGRAM_LIST_ALIGN, PID.DIAGRAM_LIST_POOL, PID.DIAGRAM_LIST_STAFF, PID.RANGE_STAFF_ID, PID.RANGE_FROM, PID.RANGE_TO, ...COMMON],
    readers: {},
  },
  group: {
    prefix: 'g',
    children: { groups: ['group'] },
    pids: [PID.START_TRACK_ID, PID.END_TRACK_ID, PID.LABEL, PID.BRACKET_STYLE, PID.GROUP_BARLINES],
    readers: {},
  },
  volta: {
    prefix: 'vl',
    children: {},
    pids: [PID.MEASURE_ID, PID.SPAN, PID.VOLTA_NUMBERS, PID.VOLTA_OPEN, PID.VOLTA_TEXT, PID.VOLTA_TEXT_SIZE, PID.VOLTA_LINE_WIDTH, PID.VOLTA_CORNER],
    readers: {},
  },
  jump: {
    prefix: 'jp',
    children: {},
    pids: [PID.MEASURE_ID, PID.JUMP_TYPE, PID.JUMP_TO, PID.PLAY_UNTIL, PID.CONTINUE_AT, PID.PLAY_REPEATS, PID.TEXT],
    readers: {},
  },
  rehearsal: {
    prefix: 'rm',
    children: {},
    pids: [PID.MEASURE_ID, PID.TEXT],
    readers: {},
  },
  marker: {
    prefix: 'mk',
    children: {},
    pids: [PID.MEASURE_ID, PID.MARKER_TYPE, PID.LABEL, PID.TEXT],
    readers: {},
  },
  tempo: {
    prefix: 'tp',
    children: {},
    pids: [PID.MEASURE_ID, PID.POSITION, PID.TEMPO_KIND, PID.TEMPO_BPM, PID.BEAT_UNIT, PID.TEMPO_FACTOR, PID.TEMPO_FOLLOW_TEXT, PID.PLAY, PID.TEXT],
    readers: {},
  },
  tempoChange: {
    prefix: 'tc',
    children: {},
    pids: [PID.MEASURE_ID, PID.POSITION, PID.END_MEASURE_ID, PID.END_POSITION, PID.CHANGE_TYPE, PID.TARGET_BPM, PID.TARGET_BEAT_UNIT, PID.CHANGE_FACTOR,
      PID.CHANGE_CURVE, PID.CHANGE_RESOLUTION, PID.PLAY, PID.TEXT],
    readers: {},
  },
  fermata: {
    prefix: 'fm',
    children: {},
    pids: [PID.MEASURE_ID, PID.POSITION, PID.FERMATA_TYPE, PID.TIME_STRETCH, PID.PLAY],
    readers: {},
  },
  swing: {
    prefix: 'sw',
    children: {},
    pids: [PID.MEASURE_ID, PID.POSITION, PID.SWING_KIND, PID.SWING_UNIT, PID.SWING_RATIO, PID.TARGET_STAFF_ID, PID.TEXT],
    readers: {},
  },
  cue: {
    prefix: 'cu',
    children: {},
    pids: [PID.MEASURE_ID, PID.CUE_KIND, PID.CUE_VALUE, PID.CUE_TRACK, PID.TEXT],
    readers: {},
  },
  sync: {
    prefix: 'sy',
    children: {},
    pids: [PID.SYNC_SOURCE, PID.SYNC_ANCHORS, PID.SYNC_OFFSET],
    readers: {},
  },
};

for (const [type, s] of Object.entries(ELEMENT_TYPES)) {
  s.type = type;
  s.pidSet = new Set(s.pids);
}

export function elementSchema(type) {
  const s = ELEMENT_TYPES[type];
  if (!s) throw new Error(`Type d'élément inconnu : ${type}`);
  return s;
}

export function isApplicable(type, pid) {
  return elementSchema(type).pidSet.has(pid);
}

export function childTypeAllowed(parentType, key, childType) {
  const allowed = elementSchema(parentType).children[key];
  return Boolean(allowed) && allowed.includes(childType);
}

/**
 * Catalogue des types de portée (§2.1 + annexe A). `items` : types d'éléments admis dans les mesures ;
 * `noteType` : type des notes que peuvent contenir ses accords (null : pas d'accords de notes) ;
 * `sequential` : le contenu d'une voix se suit dans le temps et remplit exactement chaque mesure (faux pour la portée
 * accord, dont les symboles ont une position explicite).
 * `defaults()` : propriétés initiales (valeurs propres au type). Retourne des objets neufs (jamais partagés).
 */
export const STAFF_TYPES = {
  score: { items: ['chord', 'rest'], noteType: 'note', sequential: true, defaults: () => ({}) },
  tab: {
    items: ['chord', 'rest'],
    noteType: 'tabnote',
    sequential: true,
    defaults: () => ({ [PID.TUNING]: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], [PID.CAPO]: 0 }),
  },
  percussion: { items: ['chord', 'rest'], noteType: 'percnote', sequential: true, defaults: () => ({ [PID.LINE_COUNT]: 5 }) },
  chord: { items: ['chordsymbol'], noteType: null, sequential: false, defaults: () => ({ [PID.CAPO]: 0 }) },
  // paroles à ÉVÉNEMENTS : des syllabes à un instant exact, sur une ou plusieurs lignes, sans lignes de portée (texte seul)
  lyrics: { items: ['lyricevent'], noteType: null, sequential: false, defaults: () => ({}) },
  // rythmique pure : barres obliques (ou têtes ordinaires), aucune hauteur, aucune ligne par défaut (0 ou 1 au choix)
  rhythm: { items: ['chord', 'rest'], noteType: 'rhythmnote', sequential: true, defaults: () => ({ [PID.LINE_COUNT]: 0, [PID.RHYTHM_HEAD]: 'slash' }) },
  // accordéon main gauche : notes `accnote` (boutons, voir accordion.js) dans des accords ordinaires ; mesures remplies comme toute portée séquentielle
  'accordion-left': {
    items: ['chord', 'rest'],
    noteType: 'accnote',
    sequential: true,
    defaults: () => ({ [PID.ACCORDION_SYSTEM]: 'stradella-2-4-italian', [PID.SHOW_BASS_BADGES]: true }),
  },
  numbered: { items: ['chord', 'rest'], noteType: 'note', sequential: true, defaults: () => ({}) }, // jianpu : réservé, à détailler plus tard
  // portée neutre à une ligne (rythme générique) : mêmes notes que `rhythm`, têtes ordinaires par défaut, clé de percussion
  neutral: { items: ['chord', 'rest'], noteType: 'rhythmnote', sequential: true, defaults: () => ({ [PID.LINE_COUNT]: 1, [PID.RHYTHM_HEAD]: 'normal' }) },
};
