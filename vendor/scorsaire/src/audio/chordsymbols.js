/*
 * Portée d'accords (lecture) — port de MuseScore 4.7.5 : `PlaybackEventsRenderer::renderChordSymbol`, `Harmony::getRealizedHarmony` / `ticksTillNext`,
 * `RealizedHarmony::generateNotes` (voicing AUTO = CLOSE) et `getIntervals` (ici remplacé par le dictionnaire de qualités, `model/chordquality.js`).
 * Fonctions PURES : la séquence (`sequence.js`) s'en sert pour dater les notes.
 *
 * Règles de MuseScore reprises :
 *  - un événement par note, vélocité = nuance de l'instant, articulation « standard » du profil, ni swing ni arpège ;
 *  - voicing AUTO = CLOSE (`generateNotes`) : la BASSE (sinon la fondamentale) à sa classe de hauteur + 36 (MIDI 36 à 47 sans capo), puis la fondamentale
 *    et chaque note de l'accord repliées dans l'octave 60-71 (`(fondamentale + intervalle) mod 12 + 60`) ; un symbole dont la qualité n'est pas comprise
 *    (absente du dictionnaire) ne joue que cette note grave ;
 *  - hauteur : le décalage est le capo STATIQUE de la portée d'accords (`PID.CAPO`, forme à jouer → hauteur sonnante = forme + capo, sans transposition
 *    d'instrument : les hauteurs de Scorsaire sont de concert), réduit à une octave comme `transposeOffset %= 12` ;
 *  - durée (`RealizedHarmony::getActualDuration`) : « jusqu'au symbole suivant » (`UNTIL_NEXT_CHORD_SYMBOL`, `ticksTillNext(utick, false)` : le symbole
 *    suivant DANS L'ORDRE DE LECTURE — reprises et sauts compris — ou la fin du Mouvement) ou « jusqu'à la fin de la mesure » (`STOP_AT_MEASURE_END`) ;
 *  - un symbole sans fondamentale (N.C.) n'est pas jouable (`isRealizable`) mais reste un symbole : il arrête l'accord précédent (`findAnnotation(HARMONY)`).
 * Ajouts de Scorsaire (hors MuseScore, décisions de Jean du 10/10/2026) : durée « écrite » (la durée propre du symbole) ; `%` et `%%` (`CHORD_SPECIAL`
 * `repeat1` / `repeat2`) rejouent ce qui précède (voir `expandChordSymbols`).
 * Non porté : voicings autres que close (drop 2, 3/4/6 notes : ils classent les notes par degré, que le dictionnaire ne garde pas), interprétation « jazz »
 * (9e / ♭9 selon l'accord suivant), transposition d'instrument.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { chordQualityIntervals } from '../model/chordquality.js';
import { itemDuration, measureLengthOf } from '../model/timing.js';
import { fAdd, fSub, fCmp, fEq } from '../model/fraction.js';
import { soundingPosition } from '../model/chordoffset.js';

const STEP_PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const OCTAVE = 12;
const BODY_OCTAVE = 5 * OCTAVE; // `DEFAULT_OCTAVE` 5 : octave au-dessus du do central
const BASS_OCTAVE = 3 * OCTAVE; // `DEFAULT_OCTAVE - 2` : deuxième octave sous le do central

export const CHORD_SYMBOL_DURATIONS = Object.freeze(['untilNext', 'measureEnd', 'written']);
export const CHORD_SYMBOL_VOICINGS = Object.freeze(['auto', 'rootOnly']);

const mod = (n, m) => ((n % m) + m) % m;

/** Classe de hauteur (0-11) d'une note { step, alter } ; null si absente ou invalide. */
export function spellingPitchClass(spelling) {
  if (!spelling || STEP_PITCH[spelling.step] === undefined) return null;
  return mod(STEP_PITCH[spelling.step] + (spelling.alter ?? 0), OCTAVE);
}

/**
 * Notes d'un symbole d'accord (`RealizedHarmony::generateNotes`, `transposeOffset` = capo) : liste de hauteurs MIDI (une par note jouée).
 * @param root, bass  { step, alter } (bass facultatif)
 * @param intervals  intervalles de la qualité (dictionnaire) ou null si la qualité n'est pas comprise
 * @param capo       décalage en demi-tons (capo statique de la portée d'accords)
 * @param voicing    'auto' (close) | 'rootOnly'
 */
export function realizeChordSymbol({ root, bass = null, intervals, capo = 0, voicing = 'auto' }) {
  const rootClass = spellingPitchClass(root);
  if (rootClass === null) return [];
  const offset = capo % OCTAVE;
  const rootPitch = mod(rootClass + offset, OCTAVE);
  const bassClass = voicing === 'rootOnly' ? null : spellingPitchClass(bass);
  const out = [bassClass === null ? rootPitch + BASS_OCTAVE : bassClass + offset + BASS_OCTAVE];
  if (voicing === 'rootOnly' || !intervals) return out;
  out.push(rootPitch + BODY_OCTAVE);
  const seen = new Set([0]);
  for (const interval of intervals) {
    const pitchClass = interval % OCTAVE;
    if (seen.has(pitchClass)) continue; // la fondamentale est déjà posée ; un doublon de dictionnaire ne double pas la note
    seen.add(pitchClass);
    out.push(((rootPitch + interval) % OCTAVE) + BODY_OCTAVE);
  }
  return out;
}

/** Notes d'un symbole du modèle, avec le dictionnaire de qualités ; [] pour un symbole sans fondamentale. */
export function chordSymbolPitches(item, dictionary, { capo = 0, voicing = 'auto' } = {}) {
  const root = getProperty(item, PID.CHORD_ROOT);
  if (!root) return [];
  return realizeChordSymbol({
    root, bass: getProperty(item, PID.CHORD_BASS), intervals: chordQualityIntervals(dictionary, getProperty(item, PID.CHORD_QUALITY) ?? ''), capo, voicing,
  });
}

/** Indice de la mesure qui contient l'instant `abs` (null hors du Mouvement). */
function measureIndexAt(layout, abs) {
  if (fCmp(abs, layout.end) >= 0 || fCmp(abs, layout.starts[0]) < 0) return null;
  let found = 0;
  for (let i = 0; i < layout.starts.length; i++) {
    if (fCmp(layout.starts[i], abs) <= 0) found = i; else break;
  }
  return found;
}

const REPEAT_BARS = { repeat1: 1, repeat2: 2 };

/**
 * Symboles d'une voix de la portée d'accords, dans l'ordre de la partition, `%` et `%%` développés.
 * @returns {{ abs, kind: 'chord'|'stop', item, owner?, virtual }[]}  `owner` (copies de `%` seulement) = le symbole `%` qui les produit  `stop` = symbole sans accord à jouer (N.C., `%` sans modèle…) : il arrête l'accord précédent.
 *
 * `%` / `%%` (ajout de Scorsaire) : le symbole posé à l'instant P rejoue ce qui s'est joué pendant les 1 ou 2 mesures qui le précèdent — la fenêtre
 * [P − N mesures, P[, N mesures = distance entre le début de sa mesure et celui de la mesure N rangs plus tôt — décalé de cette distance. Si un accord
 * était déjà en cours au début de la fenêtre sans que rien ne l'y attaque, il est rejoué à P. Les symboles répétés dans la fenêtre sont déjà développés
 * (un `%` après un `%` rejoue le résultat). Ce qui dépasse le symbole réel suivant n'est pas rejoué ; sans mesure précédente, le symbole ne joue rien.
 */
export function expandChordSymbols(voice, mv, layout) {
  const real = [];
  voice.measures.forEach((measure, mi) => {
    if (!measure || mi >= layout.ids.length) return;
    for (const item of measure.items) {
      if (item.type !== 'chordsymbol') continue;
      const position = getProperty(item, PID.POSITION);
      if (!position) continue;
      const written = fAdd(layout.starts[mi], position);
      if (measureIndexAt(layout, written) === null) continue;
      // play offset: the symbol sounds earlier / later than written (kept at the written place when the sounding point leaves the movement)
      const sounding = fAdd(layout.starts[mi], soundingPosition(position, getProperty(item, PID.PLAY_OFFSET)));
      const abs = measureIndexAt(layout, sounding) === null ? written : sounding;
      real.push({ abs, mi: measureIndexAt(layout, abs), item });
    }
  });
  real.sort((a, b) => fCmp(a.abs, b.abs));

  const mat = [];
  real.forEach((s, index) => {
    const bars = REPEAT_BARS[getProperty(s.item, PID.CHORD_SPECIAL)];
    if (!bars) {
      const playable = getProperty(s.item, PID.CHORD_ROOT) && getProperty(s.item, PID.CHORD_SPECIAL) !== 'noChord';
      mat.push({ abs: s.abs, kind: playable ? 'chord' : 'stop', item: s.item, virtual: false });
      return;
    }
    const copies = [];
    if (s.mi - bars >= 0) {
      const shift = fSub(layout.starts[s.mi], layout.starts[s.mi - bars]);
      const lo = fSub(s.abs, shift);
      const limit = real[index + 1]?.abs ?? null;
      const inside = mat.filter((e) => fCmp(e.abs, lo) >= 0 && fCmp(e.abs, s.abs) < 0);
      let before = null;
      for (const e of mat) if (fCmp(e.abs, lo) < 0) before = e;
      const sources = !inside.some((e) => fEq(e.abs, lo)) && before?.kind === 'chord' ? [{ ...before, abs: lo }, ...inside] : inside;
      for (const e of sources) {
        const abs = fAdd(e.abs, shift);
        if ((limit && fCmp(abs, limit) >= 0) || measureIndexAt(layout, abs) === null) continue;
        copies.push({ abs, kind: e.kind, item: e.item, owner: s.item, virtual: true });
      }
    }
    if (!copies.some((c) => fEq(c.abs, s.abs))) mat.push({ abs: s.abs, kind: 'stop', item: s.item, virtual: false });
    mat.push(...copies);
    mat.sort((a, b) => fCmp(a.abs, b.abs));
  });
  return mat;
}

/**
 * Accords de la portée dans l'ordre de LECTURE, datés (secondes depuis le début du Mouvement, vitesse d'écoute non appliquée).
 * @param stream   résultat de `expandChordSymbols`
 * @param slots    créneaux joués { measure, t, end } dans l'ordre de lecture
 * @param tl       table de tempo (`secondsAt`, `secondsEndAt`)
 * @param duration 'untilNext' | 'measureEnd' | 'written'
 * @returns {{ item, abs, start, nominal, slot }[]}  `slot` = indice du créneau
 */
export function playedChordSymbols(stream, { slots, layout, tl, mv, duration = 'untilNext' }) {
  const buckets = new Map();
  for (const entry of stream) {
    const mi = measureIndexAt(layout, entry.abs);
    if (mi === null) continue;
    if (!buckets.has(mi)) buckets.set(mi, []);
    buckets.get(mi).push(entry);
  }
  const played = [];
  slots.forEach((slot, k) => {
    const base = tl.secondsAt(layout.starts[slot.measure]);
    for (const entry of buckets.get(slot.measure) ?? []) played.push({ ...entry, slot: k, start: slot.t + (tl.secondsAt(entry.abs) - base) });
  });
  const out = [];
  played.forEach((entry, i) => {
    if (entry.kind !== 'chord') return;
    const next = played[i + 1];
    const slot = slots[entry.slot];
    let end;
    if (duration === 'written') {
      const length = measureLengthOf(mv.masterbars[slot.measure]);
      end = entry.start + (tl.secondsEndAt(fAdd(entry.abs, itemDuration(entry.item, length))) - tl.secondsAt(entry.abs));
    } else if (duration === 'measureEnd') {
      end = next && next.slot === entry.slot ? next.start : slot.end;
    } else {
      end = next ? next.start : slots[slots.length - 1].end;
    }
    const nominal = end - entry.start;
    if (nominal > 0) out.push({ item: entry.item, owner: entry.owner ?? entry.item, abs: entry.abs, start: entry.start, nominal, slot: entry.slot });
  });
  return out;
}
