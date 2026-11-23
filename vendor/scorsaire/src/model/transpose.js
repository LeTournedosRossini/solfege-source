/*
 * Transposition — hauteur sonnante (de concert) et notation écrite des instruments transpositeurs.
 *
 * Port de MuseScore v4.7.5 (lus en entier, jamais devinés) : `dom/interval.{h,cpp}` (`Interval::flip`, `isZero`),
 * `dom/pitchspelling.{h,cpp}` (`tpc2step`, `tpc2pitch`, `clampEnharmonic`, `clampKey`, `key2Tpc`, `tpc2Key`, `tpcIsValid`),
 * `editing/transpose.cpp` (`Transpose::transposeTpc`, `Transpose::transposeKey`), `dom/staff.cpp` (`Staff::transpose`),
 * `dom/keysig.cpp` (`KeySig::setKey`), `dom/note.cpp` (`Note::setTpcFromPitch`, `Note::epitch`, `Note::transposition`),
 * `dom/utils.cpp` (`absStep`).
 *
 * Convention de MuseScore (conservée) : l'intervalle d'un INSTRUMENT va de l'écrit vers le SONNANT (clarinette si♭ =
 * { diatonic: −1, chromatic: −2 }). Pour passer du concert à l'écrit il faut donc le RETOURNER (`flipInterval`).
 *
 * Modèle de Scorsaire : `PID.PITCH` d'une note = hauteur de CONCERT (sonnante) ; son orthographe stockée est celle de
 * concert (`PID.SPELLING`) ; l'orthographe ÉCRITE et l'armure écrite sont DÉRIVÉES ici (jamais stockées). `PID.KEY_SIG`
 * du masterbar = armure de concert, commune à toutes les portées.
 *
 * TPC (« tonal pitch class », ligne des quintes) : −8..40, do = 14, +7 par demi-ton chromatique, +12 par enharmonie.
 */

export const TPC_MIN = -8;
export const TPC_MAX = 40;
export const TPC_C = 14;
export const TPC_B_SHARP = 26; // `Tpc::TPC_B_S` : dernier tpc sans double dièse (si♯)
export const TPC_F_FLAT = 6; //   `Tpc::TPC_F_B` : premier tpc sans double bémol
export const TPC_DELTA_SEMITONE = 7;
export const TPC_DELTA_ENHARMONIC = 12;

/** Plage des armures (`Key::MIN` = Do♭ (−7) … `Key::MAX` = Do♯ (+7)) et écart enharmonique entre armures. */
export const KEY_MIN = -7;
export const KEY_MAX = 7;
export const KEY_DELTA_ENHARMONIC = 12;

/** `PreferSharpFlat` : préférence d'armure d'une partie (`Part::preferSharpFlat`, AUTO par défaut). */
export const PREFER = Object.freeze({ NONE: 'none', SHARPS: 'sharps', FLATS: 'flats', AUTO: 'auto' });

/** Rang dans la ligne des quintes de chaque nom de note naturel (tpc naturel = 14 + rang). */
const STEP_TPC = { C: 0, D: 2, E: 4, F: -1, G: 1, A: 3, B: 5 };
/** Demi-tons de chaque nom de note naturel (do = 0). */
const STEP_PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Ordre des noms de note par numéro de degré (0 = do). */
const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** `tpc2step` : degré (0 = do … 6 = si) de chaque tpc, indexé par `(tpc − TPC_MIN) % 7` — ordre F C G D A E B. */
const TPC_STEPS = [3, 0, 4, 1, 5, 2, 6];

// ───────────────────────── intervalles ─────────────────────────

/** `Interval(diatonic, chromatic)` : `diatonic` en degrés, `chromatic` en demi-tons (signés). */
export const interval = (diatonic = 0, chromatic = 0) => ({ diatonic, chromatic });

/** `Interval::isZero`. */
export const intervalIsZero = (iv) => !iv || (iv.diatonic === 0 && iv.chromatic === 0);

/** `Interval::flip` (copie). */
export const flipInterval = (iv) => ({ diatonic: -iv.diatonic, chromatic: -iv.chromatic });

// ───────────────────────── tpc ─────────────────────────

/** `tpcIsValid`. */
export const tpcIsValid = (tpc) => Number.isInteger(tpc) && tpc >= TPC_MIN && tpc <= TPC_MAX;

/** Tpc d'une orthographe `{ step, alter }` (table `step2tpc` : 14 + rang de la note + 7 × altération). */
export function tpcOfSpelling({ step, alter = 0 }) {
  if (!(step in STEP_TPC)) throw new Error(`Nom de note inconnu : ${step}`);
  return TPC_C + STEP_TPC[step] + TPC_DELTA_SEMITONE * alter;
}

/** `tpc2step` : degré 0..6 (0 = do) d'un tpc valide. */
export function tpcStep(tpc) {
  return TPC_STEPS[(tpc - TPC_MIN) % 7];
}

/** `tpc2alter` : altération (−3..+3) d'un tpc valide. */
export function tpcAlter(tpc) {
  return Math.floor((tpc - TPC_MIN) / TPC_DELTA_SEMITONE) - 3;
}

/** `tpc2pitch` : demi-tons (−3..15) du tpc par rapport au do, altération comprise. */
export function tpcPitch(tpc) {
  return STEP_PITCH[STEP_NAMES[tpcStep(tpc)]] + tpcAlter(tpc);
}

/** `clampEnharmonic` : ramène un tpc dans la plage valide par pas d'une enharmonie (sans double altération si demandé). */
export function clampEnharmonic(tpc, useDoubleSharpsFlats = true) {
  const max = useDoubleSharpsFlats ? TPC_MAX : TPC_B_SHARP;
  const min = useDoubleSharpsFlats ? TPC_MIN : TPC_F_FLAT;
  while (tpc > max) tpc -= TPC_DELTA_ENHARMONIC;
  while (tpc < min) tpc += TPC_DELTA_ENHARMONIC;
  return tpc;
}

/** `Transpose::transposeTpc` : transpose une orthographe (tpc) d'un intervalle. */
export function transposeTpc(tpc, iv, useDoubleSharpsFlats = true) {
  const delta = iv.chromatic * TPC_DELTA_SEMITONE - iv.diatonic * TPC_DELTA_ENHARMONIC;
  if (!tpcIsValid(tpc) || delta === 0) return tpc; // unisson ou octave justes
  return clampEnharmonic(tpc + delta, useDoubleSharpsFlats);
}

// ───────────────────────── armures ─────────────────────────

/** `key2Tpc` / `tpc2Key` : une armure (−7..+7) est le tpc de sa tonique majeure − 14. */
export const keyToTpc = (key) => key + TPC_C;
export const tpcToKey = (tpc) => tpc - TPC_C;

/**
 * `clampKey` : ramène une armure dans la plage permise par la préférence. AUTO : Sol♭..Fa♯ (−6..6) ; SHARPS : La♭..Do♯ (−3..7) ;
 * FLATS : Do♭..Mi (−7..4) ; NONE : Do♭..Do♯ (−7..7). Par pas d'une enharmonie (12).
 */
export function clampKey(key, prefer = PREFER.NONE) {
  let smallest = -6;
  let largest = 6;
  if (prefer !== PREFER.AUTO) {
    smallest = prefer === PREFER.SHARPS ? -3 : KEY_MIN;
    largest = prefer === PREFER.FLATS ? 4 : KEY_MAX;
  }
  while (key < smallest) key += KEY_DELTA_ENHARMONIC;
  while (key > largest) key -= KEY_DELTA_ENHARMONIC;
  return key;
}

/**
 * `Transpose::transposeKey` : armure transposée d'un intervalle. Pour un intervalle d'octave pur (instrument à l'octave),
 * la préférence est ignorée (NONE).
 */
export function transposeKey(key, iv, prefer = PREFER.NONE) {
  const newKey = tpcToKey(transposeTpc(keyToTpc(key), iv, false));
  if (iv.chromatic % 12 === 0 && iv.diatonic % 7 === 0) prefer = PREFER.NONE;
  return clampKey(newKey, prefer);
}

// ───────────────────────── portée transposée ─────────────────────────

/**
 * Armure ÉCRITE d'une portée d'instrument transpositeur : `KeySig::setKey` (`transposeKey(concert, flip(instrument), prefer)`).
 * `iv` = intervalle de l'INSTRUMENT (écrit → sonnant). Intervalle nul : armure de concert.
 */
export function writtenKey(concertKey, iv, prefer = PREFER.AUTO) {
  if (intervalIsZero(iv)) return concertKey;
  return transposeKey(concertKey, flipInterval(iv), prefer);
}

/**
 * `Staff::transpose(tick)` : intervalle écrit → sonnant EFFECTIF à une position donnée. Il diffère de celui de l'instrument de
 * l'écart enharmonique que `clampKey` impose à l'armure écrite (ex. clarinette si♭ en Fa♯ majeur de concert : l'armure
 * écrite, Sol♯ majeur = 8 dièses, est ramenée à La♭ majeur ; l'intervalle devient une tierce diminuée).
 */
export function staffInterval(iv, concertKey, prefer = PREFER.AUTO) {
  if (intervalIsZero(iv)) return { diatonic: 0, chromatic: 0 };
  const cKey = concertKey;
  const tKey = transposeKey(cKey, flipInterval(iv), prefer);
  let chromatic = (7 * (cKey - tKey)) % 12;
  if (chromatic < 0) chromatic += 12;
  let diatonic = (4 * (cKey - tKey)) % 7;
  if (diatonic < 0) diatonic += 7;
  if (iv.chromatic < 0 || iv.diatonic < 0) {
    chromatic -= 12;
    diatonic -= 7;
  }
  return {
    chromatic: iv.chromatic - (iv.chromatic % 12) + (chromatic % 12),
    diatonic: iv.diatonic - (iv.diatonic % 7) + (diatonic % 7),
  };
}

// ───────────────────────── notes ─────────────────────────

/** `absStep(tpc, pitch)` : numéro de ligne absolu (do de la hauteur MIDI 0 = 0, ré = 1, … do suivant = 7). */
export function absStep(tpc, pitch) {
  let line = tpcStep(tpc) + Math.trunc(pitch / 12) * 7;
  const tp = tpcPitch(tpc);
  if (tp < 0) line += 7;
  else line -= Math.trunc(tp / 12) * 7;
  return line;
}

/** Orthographe `{ step, alter, octave }` (do central = C4) d'un tpc pour une hauteur MIDI donnée (celle qu'il orthographie). */
export function spellingFromTpc(tpc, pitch) {
  const line = absStep(tpc, pitch);
  return { step: STEP_NAMES[((line % 7) + 7) % 7], alter: tpcAlter(tpc), octave: Math.floor(line / 7) - 1 };
}

/**
 * Orthographe ÉCRITE d'une note de concert (`pitch`, `spelling` de concert) sur une portée d'instrument d'intervalle `iv`.
 * Port de `Note::setTpcFromPitch` (tpc2 = `transposeTpc(tpc1, flip(Staff::transpose), true)`) et de `Note::epitch`
 * (hauteur écrite = hauteur de concert − demi-tons BRUTS de l'instrument, `Note::transposition`).
 * Intervalle nul, ou orthographe de concert invalide : orthographe de concert.
 */
export function writtenSpelling(pitch, spelling, iv, concertKey, prefer = PREFER.AUTO) {
  if (intervalIsZero(iv)) return spelling;
  const tpc1 = tpcOfSpelling(spelling);
  if (!tpcIsValid(tpc1)) return spelling;
  const effective = staffInterval(iv, concertKey, prefer);
  const tpc2 = transposeTpc(tpc1, flipInterval(effective), true);
  return spellingFromTpc(tpc2, pitch - iv.chromatic);
}

/** Hauteur MIDI ÉCRITE d'une note de concert (`Note::epitch`) : sert à la placer sur la portée. */
export function writtenPitch(pitch, iv) {
  return intervalIsZero(iv) ? pitch : pitch - iv.chromatic;
}

const DIATONIC_OF_SEMITONES = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6]; // minor second 1, major second 1, minor third 2…, tritone as a diminished fifth, major seventh 6
/** The interval { diatonic, chromatic } of a transposition by `n` semitones (positive = up): every semitone has one, the usual intervals match the presets. */
export function intervalOfSemitones(n) {
  const a = Math.abs(n);
  const steps = Math.floor(a / 12) * 7 + DIATONIC_OF_SEMITONES[a % 12];
  return { diatonic: n < 0 ? -steps : steps, chromatic: n };
}
