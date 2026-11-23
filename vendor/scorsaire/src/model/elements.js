/*
 * Constructeurs d'éléments. Un élément est une donnée pure :
 *
 *   { id, type, props: { pid: valeur… }, <listes d'enfants>, style? }
 *
 * - `props` ne contient que les valeurs LOCALES (écarts aux défauts) : c'est aussi ce qui est sauvegardé.
 * - Les listes d'enfants (movements, tracks, notes…) ne se modifient que par les commandes AddElement/RemoveElement.
 * - Des accesseurs de LECTURE non énumérables (`note.pitch`, `staff.clef`…) gardent la compatibilité avec le
 *   squelette de l'étape 1 (mise en page, rendu) sans rien ajouter au fichier sauvegardé.
 */
import { newId } from './ids.js';
import { PID } from './pid.js';
import { SWING_PRESETS } from './swingpresets.js';
import { elementSchema, childTypeAllowed, STAFF_TYPES } from './schema.js';
import { prepareValue, getProperty } from './props.js';
import { midiFromSpelling as midi, MEASURE_DURATION } from './pitch.js';
import { validateStyleValue } from './sid.js';
import { guard, frozenClone } from './guard.js';

/**
 * Constructeur générique (utilisé aussi par le chargement de fichier).
 * @param props     valeurs locales { pid: valeur } (validées, copiées, gelées)
 * @param children  { clé: [éléments] }
 * @param style     (Mouvement) styles surchargés { sid: valeur }
 */
export function createElement(type, { id, props = {}, children = {}, style } = {}) {
  const schema = elementSchema(type);
  const el = {};
  Object.defineProperty(el, 'id', { value: id ?? newId(schema.prefix), enumerable: true });
  Object.defineProperty(el, 'type', { value: type, enumerable: true });

  const own = {};
  for (const [pid, value] of Object.entries(props)) own[pid] = prepareValue({ type }, pid, value);
  el.props = guard(own);

  for (const key of Object.keys(children)) {
    if (!schema.children[key]) throw new Error(`« ${type} » n'a pas de liste d'enfants « ${key} »`);
  }
  for (const key of Object.keys(schema.children)) {
    const list = children[key] ?? [];
    for (const child of list) {
      if (!childTypeAllowed(type, key, child.type)) {
        throw new Error(`Un élément « ${child.type} » n'est pas admis dans « ${type}.${key} »`);
      }
    }
    el[key] = guard([...list]);
  }

  if (schema.hasStyle) {
    const styles = {};
    for (const [sid, value] of Object.entries(style ?? {})) {
      validateStyleValue(sid, value);
      styles[sid] = frozenClone(value);
    }
    el.style = guard(styles);
  } else if (style && Object.keys(style).length) {
    throw new Error(`« ${type} » ne porte pas de styles`);
  }

  // Accesseurs de lecture (compatibilité) — non énumérables : absents de JSON et des comparaisons.
  for (const [name, pid] of Object.entries(schema.readers)) {
    Object.defineProperty(el, name, { get: () => getProperty(el, pid), enumerable: false });
  }
  return el;
}

const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// ---------- notes et silences ----------

/** Une note (hauteur). Sa durée est celle de l'accord qui la contient (voir createChord / createNoteChord). */
export function createNote({ step, alter = 0, octave, props = {} }) {
  const spelling = { step, alter, octave };
  return createElement('note', {
    props: { [PID.SPELLING]: spelling, [PID.PITCH]: midi(spelling), ...props },
  });
}

/**
 * Accord de notes : une ou plusieurs notes attaquées ensemble, sur une même hampe. Porte la durée, le n-olet,
 * la ligature, la hampe, les notes d'ornement et les articulations (MuseScore : Chord → Note).
 */
export function createChord({ duration = 'quarter', dots = 0, notes = [], graceNotes = [], props = {} } = {}) {
  return createElement('chord', {
    props: { [PID.DURATION]: { base: duration, dots }, ...props },
    children: { notes, graceNotes },
  });
}

/** Raccourci : accord de notes de portée « score » à partir de spécifications { step, alter, octave }. */
export function createNoteChord(specs, { duration = 'quarter', dots = 0, graceNotes = [], props = {} } = {}) {
  return createChord({ duration, dots, notes: specs.map((spec) => createNote(spec)), graceNotes, props });
}

/** Durée ÉCRITE d'un ornement selon son type (MuseScore `Score::setGraceNote`, editing/cmd.cpp : acciaccature et
 * appoggiature = croche, GRACE4 = noire, GRACE16 = double croche, GRACE32 = triple croche ; les trois « après » =
 * croche / double / triple). Stockée sur l'ornement à la création (elle reste modifiable comme dans MuseScore). */
export const GRACE_TYPES = {
  acciaccatura: { duration: 'eighth', after: false },
  appoggiatura: { duration: 'eighth', after: false },
  grace4: { duration: 'quarter', after: false },
  grace16: { duration: 'sixteenth', after: false },
  grace32: { duration: 'thirtysecond', after: false },
  grace8after: { duration: 'eighth', after: true },
  grace16after: { duration: 'sixteenth', after: true },
  grace32after: { duration: 'thirtysecond', after: true },
};

/**
 * Ornement (note d'ornement) : un ACCORD sans durée dans la mesure, à ajouter dans `chord.graceNotes` de l'accord
 * principal par `doc.add`. `specs` : spécifications de notes { step, alter, octave }. Un ornement avant précède l'accord
 * principal, un « après » le suit ; l'ordre de la liste est l'ordre temporel.
 */
export function createGraceNote(graceType, specs, { duration, dots = 0, props = {} } = {}) {
  const info = GRACE_TYPES[graceType];
  if (!info) throw new Error(`Type d'ornement inconnu : ${graceType}`);
  return createChord({
    duration: duration ?? info.duration,
    dots,
    notes: specs.map((spec) => createNote(spec)),
    props: { [PID.GRACE_TYPE]: graceType, ...props },
  });
}

/** Ornement d'une portée de percussion (flam : acciaccature sur un son) : comme `createGraceNote`, avec des notes de percussion (sons de la percmap). */
export function createPercGraceNote(graceType, sounds, { duration, dots = 0, props = {} } = {}) {
  const info = GRACE_TYPES[graceType];
  if (!info) throw new Error(`Type d'ornement inconnu : ${graceType}`);
  return createChord({
    duration: duration ?? info.duration,
    dots,
    notes: sounds.map((sound) => createPercNote({ sound })),
    props: { [PID.GRACE_TYPE]: graceType, ...props },
  });
}

/** Types de doigté (PID.FINGERINGS) : style de texte MuseScore correspondant (`TextStyleType`). */
export const FINGERING_KINDS = ['fingering', 'lhGuitar', 'rhGuitar', 'stringNumber'];

/** Entrée de PID.FINGERINGS (note) : doigté — texte libre, type, côté facultatif ('above' | 'below', sinon automatique), `offset` [dx, dy] facultatif
 * = déplacement manuel en espaces, convention MuseScore (x vers la droite, y vers le BAS), ajouté APRÈS le placement automatique. */
export function createFingering(text, { kind = 'fingering', placement, offset } = {}) {
  return defined({ id: newId('fg'), text: String(text), kind, placement, offset });
}

/** Erreurs d'une liste PID.FINGERINGS (vide si valide). */
export function validateFingerings(list) {
  const errors = [];
  const seen = new Set();
  for (const f of list ?? []) {
    if (!f || typeof f !== 'object') { errors.push('doigté : entrée invalide'); continue; }
    if (typeof f.id !== 'string' || seen.has(f.id)) errors.push(`doigté « ${f.text} » : identifiant manquant ou en double`);
    seen.add(f.id);
    if (typeof f.text !== 'string' || f.text.length === 0 || f.text.length > 12) errors.push(`doigté ${f.id} : texte vide ou de plus de 12 caractères`);
    if (!FINGERING_KINDS.includes(f.kind)) errors.push(`doigté ${f.id} : type inconnu (${f.kind})`);
    if (f.placement !== undefined && f.placement !== 'above' && f.placement !== 'below') errors.push(`doigté ${f.id} : côté inconnu (${f.placement})`);
    if (f.offset !== undefined && !(Array.isArray(f.offset) && f.offset.length === 2 && f.offset.every((v) => Number.isFinite(v)))) errors.push(`doigté ${f.id} : déplacement invalide (attendu [dx, dy])`);
  }
  return errors;
}

/** Entrée de PID.ARTICULATIONS (accord ou percnote) : signe de jeu (tranche 3). `pos` (espaces) : position forcée à la
 * main, court-circuite le calcul automatique (futur geste d'édition « déplacer un signe »). */
export function createArticulation(type, { pos, timeStretch, play, ornamentStyle, intervalAbove, intervalBelow } = {}) {
  // `ornamentStyle` ('baroque') : trille baroque (`ArticulationType::TrillBaroque`), lecture seulement.
  // `intervalAbove` / `intervalBelow` : intervalles d'ornement `{ step, type }` (voir trill.js), défaut seconde automatique.
  return defined({ id: newId('at'), type, pos, timeStretch, play, ornamentStyle, intervalAbove, intervalBelow });
}

/** Entrée de PID.HAIRPINS (portée) : soufflet ancré par IDENTITÉ de ses deux accords de bornes (tranche 3, marquage
 * en plage — voir claude/etape-3-suivi-et-decisions.md). `hairpinType` : 'cresc'|'decresc'. */
export function createHairpin(startChordId, endChordId, hairpinType = 'cresc', { voiceAssignment } = {}) {
  // `voiceAssignment` ('instrument' par défaut | 'staff' | 'voice') : portée d'application à la lecture (MuseScore `Hairpin`, VOICE_ASSIGNMENT).
  return defined({ id: newId('hp'), startChordId, endChordId, hairpinType, voiceAssignment });
}

/** Entrée de PID.BREATHS (portée) : respiration ou césure posée APRÈS l'accord ou le silence `afterId` (voir model/breath.js).
 * `pause` (secondes) remplace celle du type. */
export function createBreath(afterId, breathType = 'breathMarkComma', { pause } = {}) {
  return defined({ id: newId('br'), afterId, breathType, pause });
}

/** Entrée de PID.TIES (portée) : liaison de PROLONGATION (même hauteur), ancrée par IDENTITÉ des deux NOTES de
 * bornes (pas des accords : un accord peut porter plusieurs ties simultanés vers des notes différentes de l'accord
 * suivant) — voir claude/etape-3-suivi-et-decisions.md. */
export function createTie(startNoteId, endNoteId) {
  return { id: newId('ti'), startNoteId, endNoteId };
}

/** Entrée de PID.SLURS (portée) : liaison D'EXPRESSION (plage sur accords, distincte du tie), ancrée par IDENTITÉ des
 * deux accords de bornes — même mécanisme que PID.HAIRPINS. */
export function createSlur(startChordId, endChordId) {
  return { id: newId('sl'), startChordId, endChordId };
}

/** Entrée de PID.TREMOLOS (portée) : trémolo entre DEUX accords consécutifs (MuseScore TremoloTwoChord), ancré par
 * IDENTITÉ des deux accords. `strokes` : nombre de barres, 1 (C8) à 6 (C256). */
export function createTwoChordTremolo(startChordId, endChordId, strokes = 1) {
  return { id: newId('tm'), startChordId, endChordId, strokes };
}

/** Entrée de PID.GLISSANDOS (portée) : glissando entre DEUX NOTES (MuseScore `Glissando`, SLine ancré sur Note → Note), ancré
 * par IDENTITÉ. `opts` facultatif : `glissandoType` ('straight'|'wavy'), `showText` (booléen), `text` — absent = style ;
 * LECTURE : `glissandoStyle` ('chromatic'|'whiteKeys'|'blackKeys'|'diatonic'|'portamento', absent = `SID.GLISSANDO_STYLE`),
 * `play` (faux = affiché, non joué ; absent = joué, comme `Spanner::playSpanner`). */
export function createGlissando(startNoteId, endNoteId, { glissandoType, showText, text, glissandoStyle, play } = {}) {
  return defined({ id: newId('gl'), startNoteId, endNoteId, glissandoType, showText, text, glissandoStyle, play });
}

/** Entrée de PID.HOPOS (portée) : hammer-on / pull-off, ancré par IDENTITÉ des deux accords de bornes (chaîne de 3 accords ou plus = une seule entrée). */
export function createHopo(startChordId, endChordId) {
  return { id: newId('ho'), startChordId, endChordId };
}

export const CAPO_MODES = ['playback', 'standard', 'tab'];
/**
 * Entrée de PID.CAPOS (portée) : capo daté (MuseScore `Capo`), ancré par IDENTITÉ d'un accord ou d'un silence ; il vaut jusqu'au capo suivant de la portée.
 * `fret` : position (1 par défaut comme MuseScore) ; `ignoredStrings` : numéros de cordes (1 = la plus aiguë) que le capo ne touche pas (capo partiel) ;
 * `mode` : 'tab' (DÉFAUT de Scorsaire, décision de Jean 08/10/2026 : la hauteur de concert ne change jamais, la tablature affiche les frettes relatives au capo),
 * 'playback' (défaut de MuseScore : frettes et hauteurs écrites inchangées, seul le son monte ; `soundingPitch` ajoute alors le capo à la hauteur stockée), 'standard' (la notation écrit la hauteur sonnante) ; `text` : texte personnalisé (absent = texte généré).
 */
export function createCapo(itemId, { fret = 1, ignoredStrings = [], active = true, mode = 'tab', text } = {}) {
  return defined({ id: newId('cp'), itemId, fret, ignoredStrings: [...ignoredStrings], active, mode, text });
}

/** Entrée de PID.STRING_TUNINGS (portée) : texte d'accordage (MuseScore `StringTunings`) ancré par IDENTITÉ d'un accord ou d'un silence. */
export function createStringTunings(itemId, { visibleStrings, tuning } = {}) {
  return defined({ id: newId('st'), itemId, visibleStrings, tuning });
}

export const BEND_TYPES = ['bend', 'preBend', 'graceNoteBend', 'slightBend', 'dive', 'preDive', 'dip', 'scoop'];
/**
 * Entrée de PID.BENDS (portée) : bend / dive de guitare, ancré par IDENTITÉ de deux NOTES RÉELLES (comme MuseScore `GuitarBend`).
 * `type` : bend, preBend (début = note d'ornement), graceNoteBend, slightBend / dip / scoop (début = fin = la note), dive, preDive.
 * Le montant (quarts de ton) est DÉRIVÉ des hauteurs (note d'arrivée − note de départ) ; `amount` ne sert que pour dip/dive superposé.
 * `showHoldLine` : 'auto' | 'show' | 'hide' ; `dipVibrato` : null | 'guitarVibrato' | 'guitarVibratoWide' ; `diveTabPos` : 'auto' | 'up' | 'down'.
 */
export function createBend(type, startNoteId, endNoteId = startNoteId, opts = {}) {
  return { id: newId('bd'), type, startNoteId, endNoteId, showHoldLine: 'auto', ...opts };
}

/**
 * Entry of PID.WHEELS (staff): a written pitch-wheel movement on a note ("Molette"), for every instrument but the guitar bends above. No arrival note:
 * the note keeps its pitch, `curve` = [{ t, s, h? }] (fraction of the note's length, semitones, optional Bézier handle) is how the wheel moves while it sounds.
 * `scope` 'chord' = every note of the chord, 'note' = only `startNoteId`. Anchored on a real note like a bend (`endNoteId` = `startNoteId`).
 */
export function createWheel(noteId, opts = {}) {
  return { id: newId('wh'), type: 'wheel', startNoteId: noteId, endNoteId: noteId, scope: 'chord', ...opts };
}

export const TECH_LINE_TYPES = ['palmMute', 'letRing', 'harmonicMark', 'whammyBar', 'vibrato'];
export const VIBRATO_TYPES = ['guitarVibrato', 'guitarVibratoWide', 'sawtooth', 'sawtoothWide'];
/**
 * Entrée de PID.TECH_LINES (portée) : ligne de technique de jeu en plage, ancrée par IDENTITÉ des accords de bornes (comme les soufflets).
 * `text` : texte de la ligne (défaut de style pour palmMute « P.M. », letRing « let ring », whammyBar « w/bar » ; marque d'harmonique : à fournir) ;
 * `vibratoType` (vibrato) : VIBRATO_TYPES ; `placement` : 'above' | 'below' (défaut MuseScore : palmMute/letRing/whammyBar dessous, harmonicMark/vibrato dessus).
 */
export function createTechLine(type, startChordId, endChordId = startChordId, opts = {}) {
  return { id: newId('tl'), type, startChordId, endChordId, ...(type === 'vibrato' ? { vibratoType: 'guitarVibrato' } : {}), ...opts };
}

/** Entrée de PID.PEDALS (portée) : pédale ancrée par INSTANT (identifiant de masterbar + fraction depuis le début de la mesure), plage [début, fin[. */
export function createPedal(startMeasureId, startPosition, endMeasureId, endPosition, opts = {}) {
  return { id: newId('pd'), startMeasureId, startPosition, endMeasureId, endPosition, ...opts };
}

/** Valeur de PID.CHORD_LINE : `type` 'fall'|'doit'|'plop'|'scoop' ; `straight` (trait droit : « Slide … ») ; `wavy` (ondulé : « (rough) »). */
export function createChordLine(type, { straight = false, wavy = false } = {}) {
  return { type, straight: straight || wavy, wavy };
}

export function createRest({ duration = 'quarter', dots = 0, explicit = false, gap = false, props = {} } = {}) {
  return createElement('rest', {
    props: { [PID.DURATION]: { base: duration, dots }, ...(explicit ? { [PID.EXPLICIT]: true } : {}), ...(gap ? { [PID.GAP]: true } : {}), ...props },
  });
}

export function createTabNote({ pitch, string, props = {} }) {
  return createElement('tabnote', { props: { [PID.PITCH]: pitch, [PID.STRING]: string, ...props } });
}

export function createPercNote({ sound, props = {} }) {
  return createElement('percnote', { props: { [PID.SOUND]: sound, ...props } });
}

export function createRhythmNote({ props = {} } = {}) {
  return createElement('rhythmnote', { props: { ...props } });
}

/** Accord d'une portée rythmique / neutre : UNE note sans hauteur. `props` = propriétés de l'accord (durée écrite, articulations, hampe…). */
export function createRhythmChord(duration = 'quarter', { dots = 0, props = {}, noteProps = {} } = {}) {
  return createChord({ duration, dots, notes: [createRhythmNote({ props: noteProps })], props });
}

/** Syllabe d'une piste « Paroles » : `text` à `position` (fraction exacte depuis le début de la mesure) sur la ligne `line` (0 = la première) ; `target` : accord / note liés. */
export function createLyricEvent({ text, position, line = 0, target = null, props = {} }) {
  return createElement('lyricevent', { props: defined({ [PID.TEXT]: String(text), [PID.POSITION]: position, [PID.LYRIC_LINE]: line || undefined, [PID.LYRIC_TARGET]: target ?? undefined, ...props }) });
}

export function createChordSymbol({ root, quality = '', bass = null, special, position, duration = 'whole', dots = 0, props = {} }) {
  return createElement('chordsymbol', {
    props: defined({
      [PID.CHORD_ROOT]: root ?? undefined,
      [PID.CHORD_QUALITY]: quality || undefined,
      [PID.CHORD_BASS]: bass ?? undefined,
      [PID.CHORD_SPECIAL]: special,
      [PID.POSITION]: position,
      [PID.DURATION]: { base: duration, dots },
      ...props,
    }),
  });
}

/**
 * Note de portée « accordéon main gauche » : un bouton (rang 1 à 6, voir accordion.js). Rangs 1-2 : hauteur réelle écrite ; rangs 3-6 : l'épellation
 * est la fondamentale de l'accord (octave sans effet, 3 par défaut).
 */
export function createAccNote({ row, step, alter = 0, octave = row <= 2 ? 2 : 3, props = {} }) {
  const spelling = { step, alter, octave };
  return createElement('accnote', {
    props: { [PID.ACC_ROW]: row, [PID.SPELLING]: spelling, [PID.PITCH]: midi(spelling), ...props },
  });
}

// ---------- structure ----------

export function createMeasure(items = []) {
  return createElement('measure', { children: { items } });
}

/**
 * Mesure « vide » valide pour un type de portée : un silence de mesure (portées à contenu séquentiel), un événement
 * d'accordéon « silence » (accordéon), ou aucun élément (portée accord). MuseScore : `Score::setRests` avec silence de mesure.
 */
export function createEmptyMeasure(staffType = 'score') {
  const descriptor = STAFF_TYPES[staffType];
  if (!descriptor) throw new Error(`Type de portée inconnu : ${staffType}`);
  if (descriptor.items.includes('rest')) return createMeasure([createRest({ duration: MEASURE_DURATION })]);
  return createMeasure([]);
}

export function createVoice(measures = []) {
  return createElement('voice', { children: { measures } });
}

export function createStaff({ type = 'score', clef = 'G', voices = [], containers = [], props = {} } = {}) {
  const descriptor = STAFF_TYPES[type];
  if (!descriptor) throw new Error(`Type de portée inconnu : ${type}`);
  return createElement('staff', {
    props: { ...descriptor.defaults(), [PID.STAFF_TYPE]: type, [PID.CLEF]: clef, ...props },
    children: { voices, containers },
  });
}

export function createTrack({ name = '', abbreviation = '', transposition = null, staves = [], props = {} } = {}) {
  return createElement('track', {
    props: { [PID.NAME]: name, [PID.ABBREVIATION]: abbreviation, [PID.TRANSPOSITION]: transposition, ...props },
    children: { staves },
  });
}

export function createMasterbar({ timeSig = [4, 4], keySig = 0, barType = 'simple', props = {} } = {}) {
  return createElement('masterbar', {
    props: { [PID.TIME_SIG]: timeSig, [PID.KEY_SIG]: keySig, [PID.BAR_TYPE]: barType, ...props },
  });
}

export function createMovement({
  title = '', masterbars = [], tracks = [], systemContainers = [], groups = [], voltas = [], jumps = [], markers = [], rehearsalMarks = [], tempos = [], tempoChanges = [], fermatas = [], swings = [], cues = [], syncs = [], style, props = {},
} = {}) {
  return createElement('movement', {
    props: { [PID.TITLE]: title, ...props },
    children: { masterbars, tracks, systemContainers, groups, voltas, jumps, markers, rehearsalMarks, tempos, tempoChanges, fermatas, swings, cues, syncs },
    style,
  });
}

/** A part (print layout, screen 2). `style` = its own style layer (page format, margins, staff size…). */
export function createPart({ id, name = '', staffIds = null, style } = {}) {
  const props = {};
  if (name) props[PID.NAME] = name;
  if (staffIds) props[PID.PART_STAVES] = staffIds;
  return createElement('part', { id, props, style });
}

/** A sheet (screen 3). Cells and reader options are set by `sheetedit.js`. */
export function createSheet({ id, name = '' } = {}) {
  return createElement('sheet', { id, props: name ? { [PID.NAME]: name } : {} });
}

/** Every work starts with the default part (the whole score, A4); its id is fixed so that creating it never moves the id counter. */
export function createWork({ title = '', movements = [], parts, props = {} } = {}) {
  return createElement('work', { props: { [PID.TITLE]: title, ...props }, children: { movements, parts: parts ?? [createPart({ id: 'pt0' })] } });
}

// ---------- conteneurs, groupes, voltas, synchronisation ----------

/** Conteneur « système » : ancré à UNE mesure (identifiant du masterbar), pas de span (§2). */
export function createSystemContainer({ measureId, kind = 'section', label, category, symbol, text, props = {} }) {
  return createElement('systemContainer', {
    props: defined({
      [PID.MEASURE_ID]: measureId,
      [PID.CONTAINER_KIND]: kind,
      [PID.LABEL]: label,
      [PID.SECTION_CATEGORY]: category,
      [PID.SYMBOL]: symbol,
      [PID.TEXT]: text,
      ...props,
    }),
  });
}

/** Conteneur « portée » : ancré à (portée, mesure), avec un span ; une notation imbriquée porte des sous-portées. */
export function createStaffContainer({ measureId, span = 1, kind = 'text', text, staves = [], fragments = [], placement, side, width, props = {} }) {
  return createElement('staffContainer', {
    props: defined({
      [PID.MEASURE_ID]: measureId, [PID.SPAN]: span, [PID.CONTAINER_KIND]: kind, [PID.TEXT]: text,
      [PID.CONTAINER_PLACEMENT]: placement, [PID.CONTAINER_SIDE]: side, [PID.CONTAINER_WIDTH]: width, ...props,
    }),
    children: { staves, fragments },
  });
}

/** Groupe de pistes contiguës (crochet) : bornes désignées par identifiant de piste ; imbricable. */
export function createGroup({ startTrackId, endTrackId, label, bracketStyle = 'normal', groupBarlines, groups = [] }) {
  return createElement('group', {
    props: defined({
      [PID.START_TRACK_ID]: startTrackId,
      [PID.END_TRACK_ID]: endTrackId,
      [PID.LABEL]: label,
      [PID.BRACKET_STYLE]: bracketStyle,
      [PID.GROUP_BARLINES]: groupBarlines,
    }),
    children: { groups },
  });
}

export function createVolta({ measureId, span = 1, numbers = [1], open = false, text, textSize, lineWidth, corner }) {
  const props = { [PID.MEASURE_ID]: measureId, [PID.SPAN]: span, [PID.VOLTA_NUMBERS]: numbers, [PID.VOLTA_OPEN]: open };
  if (text) props[PID.VOLTA_TEXT] = text;
  if (textSize != null) props[PID.VOLTA_TEXT_SIZE] = textSize;
  if (lineWidth != null) props[PID.VOLTA_LINE_WIDTH] = lineWidth;
  if (corner != null) props[PID.VOLTA_CORNER] = corner;
  return createElement('volta', { props });
}

/**
 * Saut (D.C., D.S., al Fine, al Coda…) ancré à UNE mesure (identifiant du masterbar). Les types prédéfinis fixent les étiquettes
 * (repeats.js) ; le type 'user' prend `jumpTo` / `playUntil` / `continueAt`. `text` remplace le texte du type.
 */
export function createJump({ measureId, jumpType = 'ds', jumpTo, playUntil, continueAt, playRepeats = false, text }) {
  return createElement('jump', {
    props: defined({
      [PID.MEASURE_ID]: measureId, [PID.JUMP_TYPE]: jumpType, [PID.JUMP_TO]: jumpTo, [PID.PLAY_UNTIL]: playUntil,
      [PID.CONTINUE_AT]: continueAt, [PID.PLAY_REPEATS]: playRepeats, [PID.TEXT]: text,
    }),
  });
}

/** Marqueur (segno, coda, fine, To Coda…) ancré à UNE mesure. `label` remplace l'étiquette du type ; `text` son texte. */
/**
 * Rehearsal mark (A, B, C… / 1, 2, 3…; MuseScore `RehearsalMark`): a framed text above the top staff, anchored to the START of a measure
 * (masterbar id). The text is chosen when the mark is placed (next in the sequence of the previous one) and may be changed freely.
 */
export function createRehearsalMark({ measureId, text = 'A' }) {
  return createElement('rehearsal', { props: { [PID.MEASURE_ID]: measureId, [PID.TEXT]: text } });
}

export function createMarker({ measureId, markerType = 'fine', label, text }) {
  return createElement('marker', {
    props: defined({ [PID.MEASURE_ID]: measureId, [PID.MARKER_TYPE]: markerType, [PID.LABEL]: label, [PID.TEXT]: text }),
  });
}

/**
 * Tempo de la piste système (MuseScore `TempoText`), ancré par `measureId` + fraction exacte `position` depuis le début de la mesure.
 * `tempoKind` : 'normal' (tempo absolu : `bpm` dans l'unité `beatUnit`), 'relative' (tempo précédent × `factor`, modulation métrique),
 * 'aTempo' (retour au tempo d'avant un graduel), 'tempoPrimo' (retour au premier tempo normal). `text` : texte affiché (« Allegro »,
 * « ♩ = 92 ») ; `followText` : bpm et unité relus du texte. `play: false` : affiché mais ignoré à la lecture.
 */
export function createTempo({
  measureId, position = [0, 1], tempoKind = 'normal', bpm = 120, beatUnit = { base: 'quarter', dots: 0 }, factor, followText, play, text,
}) {
  return createElement('tempo', {
    props: defined({
      [PID.MEASURE_ID]: measureId, [PID.POSITION]: position, [PID.TEMPO_KIND]: tempoKind, [PID.TEMPO_BPM]: bpm, [PID.BEAT_UNIT]: beatUnit,
      [PID.TEMPO_FACTOR]: factor, [PID.TEMPO_FOLLOW_TEXT]: followText, [PID.PLAY]: play, [PID.TEXT]: text,
    }),
  });
}

/**
 * Changement de tempo graduel (accel., rit.… ; MuseScore `GradualTempoChange`) : part du tempo en cours au début, arrive à `targetBpm`
 * (dans `targetBeatUnit`, défaut : l'unité du départ) ou, à défaut, à départ × `factor` (défaut : celui du type). `curve` ∈ [-1, 1].
 */
export function createTempoChange({
  measureId, position = [0, 1], endMeasureId, endPosition = [0, 1], changeType = 'ritardando', targetBpm, targetBeatUnit, factor,
  curve, resolution, play, text,
}) {
  return createElement('tempoChange', {
    props: defined({
      [PID.MEASURE_ID]: measureId, [PID.POSITION]: position, [PID.END_MEASURE_ID]: endMeasureId, [PID.END_POSITION]: endPosition,
      [PID.CHANGE_TYPE]: changeType, [PID.TARGET_BPM]: targetBpm, [PID.TARGET_BEAT_UNIT]: targetBeatUnit, [PID.CHANGE_FACTOR]: factor,
      [PID.CHANGE_CURVE]: curve, [PID.CHANGE_RESOLUTION]: resolution, [PID.PLAY]: play, [PID.TEXT]: text,
    }),
  });
}

/**
 * Point d'orgue de la piste système, ancré par `measureId` + fraction exacte `position` depuis le début de la mesure. `fermataType` : sorte
 * (étirement par défaut dans `FERMATA_STRETCH`) ; `timeStretch` : étirement réglé à la main ; `play: false` : affiché, ignoré à la lecture.
 * L'étirement s'étend de `position` à l'attaque suivante de n'importe quelle portée (ou la fin de la mesure).
 */
export function createFermata({ measureId, position = [0, 1], fermataType = 'fermata', timeStretch, play }) {
  return createElement('fermata', {
    props: defined({ [PID.MEASURE_ID]: measureId, [PID.POSITION]: position, [PID.FERMATA_TYPE]: fermataType, [PID.TIME_STRETCH]: timeStretch, [PID.PLAY]: play }),
  });
}

/**
 * Swing de la piste système (MuseScore : texte « Swing » / « Straight » / feeling ternaire, `SwingParameters`), ancré par `measureId` +
 * fraction exacte `position`. Vaut pour TOUTES les portées, sauf si `staffId` désigne une portée : ce signe-là ne vaut que pour elle (surcharge).
 * `kind` choisit un préréglage (`SWING_PRESETS`, src/model/swing.js) dont `unit` / `ratio` peuvent être remplacés ; `text` : texte affiché.
 */
export function createSwing({ measureId, position = [0, 1], kind = 'swing', unit, ratio, staffId, text }) {
  const preset = SWING_PRESETS[kind] ?? SWING_PRESETS.swing;
  return createElement('swing', {
    props: defined({
      [PID.MEASURE_ID]: measureId, [PID.POSITION]: position, [PID.SWING_KIND]: kind, [PID.SWING_UNIT]: unit ?? preset.unit,
      [PID.SWING_RATIO]: ratio ?? preset.ratio, [PID.TARGET_STAFF_ID]: staffId, [PID.TEXT]: text ?? preset.text ?? undefined,
    }),
  });
}

/**
 * Cue of the automatic players, anchored on a measure (`measureId`): `kind` 'groove' = from here on the drum player plays the version `value` of its groove ('main' or the id of a variant);
 * 'break' = on this measure only it plays the fill `value` ('none' = no fill). `trackId` = a drum track (null = every drum track). `text` = what is written above the score.
 */
export function createCue({ measureId, kind = 'groove', value = 'main', trackId, text }) {
  return createElement('cue', { props: defined({ [PID.MEASURE_ID]: measureId, [PID.CUE_KIND]: kind, [PID.CUE_VALUE]: value, [PID.CUE_TRACK]: trackId, [PID.TEXT]: text }) });
}

export function createSync({ source, anchors = [], offset = 0 }) {
  return createElement('sync', {
    props: { [PID.SYNC_SOURCE]: source, [PID.SYNC_ANCHORS]: anchors, [PID.SYNC_OFFSET]: offset },
  });
}
