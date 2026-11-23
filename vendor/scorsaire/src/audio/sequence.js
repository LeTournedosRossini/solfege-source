/*
 * Partition → SÉQUENCE D'ÉVÉNEMENTS DATÉS (couche A du contrat audio, voir `engine.js`). Fonction PURE, sans DOM ni audio.
 *
 * La séquence est une donnée simple (copiable, envoyable à un autre contexte) : notes datées en SECONDES depuis le début de la lecture, tracks,
 * messages libres, table de tempo, et « créneaux » (un par mesure jouée, dans l'ordre de lecture : sert au curseur). Les positions musicales
 * restent des fractions exactes jusqu'ici ; les secondes n'apparaissent qu'à la sortie (`tempomap.js`).
 *
 * Ce qui est joué (portées score, tablature, percussion, accordéon main gauche) :
 *  - ordre de lecture : reprises, voltas, sauts, codas (`repeatlist.js`) ; pauses entre Mouvements (`PID.PAUSE`) ;
 *  - tempo, graduels, points d'orgue, respirations (`tempomap.js`) ; vitesse d'écoute `speed` (1 = tempo écrit, 0,5 = deux fois plus lent) : TOUT
 *    est mis à l'échelle (notes, pauses, table de tempo), la position musicale ne change pas ;
 *  - swing (`swing.js`, comme `NoteRenderer::applySwingIfNeed` : retard d'attaque et durée sur la durée nominale de l'accord, sans la partie liée) ;
 *  - liaisons de prolongation (`PID.TIES`) : une seule note longue ; une liaison coupée par un saut ou une reprise est jouée en deux notes (MuseScore
 *    sait « lier » à travers une reprise, `renderPartialTie` : non porté) ;
 *  - hauteurs : `PID.PITCH` = hauteur de CONCERT (rien à transposer) ; tablature : + capo en mode « playback » (`soundingPitch`) ; percussion :
 *    n° MIDI du son de la percmap (`pitch` null si le son n'en a pas ; `sound` donne toujours l'identifiant) ; accordéon : rangs 1-2 = hauteur écrite,
 *    rangs 3-6 = table Stradella (`stradella.js`) ;
 *  - nuances : niveaux de MuseScore (`dynamics.js` règles par défaut, remplaçables par `options.dynamicRules`), valables pour toutes les portées de la
 *    piste jusqu'à la nuance suivante ; vélocité = règle de MuseScore, puis décalage d'articulation, puis étages de mise en forme (`velocity.js`), sauf
 *    vélocité imposée d'une note (voir plus bas) ;
 *  - articulations et durée : profils de MuseScore par famille d'instrument (`profiles.js` : facteur de durée moyen, accent = niveau de dynamique relevé) ; règles d'articulation de l'utilisateur (`options.articulationRules`) :
 *    { mode: 'performance', durationFactor?, velocityOffset? } ou { mode: 'message', message: { kind, data } } (message libre daté à l'attaque).
 *
 * Soufflets : port de `PlaybackContext::handleHairpin` (courbe en marches de 1/4 de noire, 24 pas minimum, ± 500 sans nuance d'arrivée) ; portée
 * d'application `voiceAssignment` respectée ; niveau pris au DÉBUT de chaque note (pas de variation en cours de note).
 *
 * Trilles : signe (`trill`, articulation ; `ornamentStyle: 'baroque'` → TrillBaroque) et ligne (`PID.TRILLS`, chaque accord de la plage trille sur sa durée) rendus par la même table que les mordants.
 * Notes d'ornement, ornements (mordants, gruppetti) et arpèges : voir `ornaments.js` (port de MuseScore). Les ornements « avant » / « après » prennent leur durée à
 * l'accord principal ; ils héritent de la carte d'articulations de l'accord (accent, arpège…), comme MuseScore. Un mordant / gruppetto remplace la note par ses
 * sous-notes (aucun swing) ; un arpège décale les attaques ; avec les deux, seul l'ornement se joue. Liaisons : la note d'un ornement n'est jamais liée.
 *
 * Trémolos : voir `ornaments.js` (`tremoloPlan`). Glissandos (`PID.GLISSANDOS`, portées score et tablature) : voir `glissandos.js` — style de lecture
 * `glissandoStyle` (chromatique, touches blanches / noires, diatonique : UN événement par pas, la note d'arrivée jouée par son propre accord ; portamento :
 * un événement avec `pitchCurve`). Ignoré sur un accord à ornement ou à trémolo (ces rendus n'appellent pas `NoteRenderer::render`), appliqué avec un arpège.
 *
 * Pédale (`PID.PEDALS`) et let ring (`PID.TECH_LINES`) : messages `controller` CC64 (127 au début, 0 à la fin) + durée « Pedal » des profils ; voir `pedal.js`.
 *
 * Portée d'accords (`options.chordSymbols` : `play` (défaut FAUX : muets ; un PID.PLAY local de symbole l’emporte), `duration` 'untilNext' (défaut) | 'measureEnd' | 'written', `voicing` 'auto' | 'rootOnly' ;
 * `options.chordQualities` : dictionnaire de qualités, `model/chordquality.js` ; absent, celui de l'œuvre `PID.CHORD_QUALITIES` quand `source` est une œuvre) : voir `chordsymbols.js`.
 *
 * Vélocité imposée d'une note (`PID.USER_VELOCITY`, `Note::userVelocityFraction`) : > 0, elle remplace nuance, soufflets, accent et règles utilisateur ; les étages
 * de mise en forme s'appliquent ensuite (`finalVelocity`, `velocity.js`). Elle est portée par l'événement de la note qui ATTAQUE (note liée : la première ; glissando
 * discret, bend, sous-notes d'ornement : la note de départ ; trémolo, arpège, notes d'ornement : la note de chaque événement), comme `NominalNoteCtx` de MuseScore.
 *
 * Non fait (limites assumées) : nuances composées au-delà de « de/vers ».
 * Articulations jouées : accent, marcato, staccato, staccatissimo, tenuto et leurs combinaisons, laissez vibrer (durée) — voir `profiles.js`.
 */
import { staffListWithNested } from './nestedplay.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { TRILL_TYPES, ornamentIntervalOf } from '../model/trill.js';
import { getProperty, resolveStyle } from '../model/props.js';
import { glissandoStyleOf, glissandoPlays, isRunEntry } from '../model/glissando.js';
import { runTiming } from '../model/glissandorun.js';
import { STAFF_TYPES, isApplicable } from '../model/schema.js';
import { tempoTimeline } from '../model/tempomap.js';
import { unwindMovement } from '../model/repeatlist.js';
import { staffSwing, staffSwingTimeline, playerSwingDelay } from '../model/swing.js';
import { itemDuration, measureLengthOf, measureOffsetOf } from '../model/timing.js';
import { fAdd, fSub, fCmp, fEq, frac, fToNumber, ZERO } from '../model/fraction.js';
import { capoTimeline, capoAt, soundingPitch, staffTimeline, tuningPitches, tuningChanges, tuningAt } from '../model/capo.js';
import { linkedStavesOf, projectLinkedStaff } from '../model/linkedstaff.js';
import { dynamicPlayback } from '../model/dynamics.js';
import { drumSound, staffSoundMap } from '../model/percmap.js';
import { instrumentInfo, maxFretOf } from '../model/instruments.js';
import { ACC_ROW_QUALITY, isChordRow } from '../model/accordion.js';
import { resolveStradellaTable, stradellaChordPitches } from '../model/stradella.js';
import { DYNAMIC_LEVELS, NATURAL_LEVEL, dynamicsStage, finalVelocity, velocityFromLevel } from './velocity.js';
import { planRhythmStaff, planPlayerTrack } from './rhythmplay.js';
import { planDrumTrack } from './drumplay.js';
import { resolveGroove } from '../model/grooves.js';
import { playerOf, playerIsSilent, playerKindOf } from '../model/player.js';
import { resolveChordPattern } from '../model/chordpatterns.js';
import { defaultSpelling, writtenDuration } from '../model/pitch.js';
import { bendCurveOf, sampleBendCurve } from '../model/bend.js';
import { wheelCurveOf } from '../model/wheel.js';
import { addWheelCurve } from './wheel.js';
import { PITCH_LEVEL_STEP, bendLookup, isMultibendPart, isChainArrival, planMultibend, buildBendEvent } from './bends.js';
import { profileFor, mpeTypesOf, articulationEffect, averageDurationFactor, ORNAMENT_TYPES, GRACE_TYPE_TO_MPE, ARPEGGIO_TYPE_TO_MPE, tremoloTypeOfStrokes, profileHas, glissandoPitchPattern } from './profiles.js';
import { glissandoArticulationType, glissandoPitchSteps, discreteGlissandoSteps, discreteStepDuration, continuousGlissandoCurve } from './glissandos.js';
import { pedalLines, pedalForChord, makeUtime, palmMuteChords } from './pedal.js';
import { collectMuted, localPlay } from '../model/play.js';
import { secondsOf } from './cursor.js';
import { savedMixer, masterVolumeOf } from './mixer.js';
import { passageSteps, compileLane, curveAt as laneCurveAt } from './automation.js';
import { LESLIE_TECHNIQUE_MODE } from './leslie.js';
import { automationLanes, sortedEntries, pitchBendRangeOf, pitchBendSemitones } from '../model/automation.js';
import { CHORD_SYMBOL_DURATIONS, CHORD_SYMBOL_VOICINGS, expandChordSymbols, playedChordSymbols, chordSymbolPitches } from './chordsymbols.js';
import { TICKS_PER_QUARTER, isCompoundTimeSig, graceNotesPlan, arpeggioPlan, ornamentEvents, ornamentSideSemitones, tremoloStepTicks, tremoloPlan } from './ornaments.js';

// Barres d'une durée écrite (`Chord::beams`) et durée écrite d'un accord de trémolo à deux notes (le double de la durée réelle).
const BEAMS_OF = { eighth: 1, sixteenth: 2, thirtysecond: 3, sixtyfourth: 4 };
const DOUBLE_OF = { whole: 'breve', half: 'whole', quarter: 'half', eighth: 'quarter', sixteenth: 'eighth', thirtysecond: 'sixteenth', sixtyfourth: 'thirtysecond' };

export const SEQUENCE_FORMAT = 'scorsaire-sequence';
export const SEQUENCE_VERSION = 1;

/**
 * Default rules of Scorsaire for marks of a NOTE (they replace the MuseScore profile effect, like any user rule): a MUTED (dead) note is a
 * short, softer percussive sound — in MuseScore's strings profile its pattern is the same as an ordinary note's (99 %, natural peak), so a
 * dead note would sound like a normal one. Override with `options.articulationRules.muted` (any rule), or set it to `null` to get MuseScore's.
 */
export const DEFAULT_NOTE_RULES = Object.freeze({
  muted: Object.freeze({ mode: 'performance', durationFactor: 0.2, velocityOffset: -20 }),
});

/** Types de portée qui produisent du son. */
export const PLAYABLE_STAFF_TYPES = Object.freeze(['score', 'tab', 'percussion', 'accordion-left']);
/** Portée rythmique (`rhythm`, `neutral`) : muette tant que `PID.RHYTHM_SOUND` (n° MIDI de percussion, décision de Jean 12/10/2026) n'est pas choisi. */
const isRhythmType = (t) => t === 'rhythm' || t === 'neutral';
/** Rhythm staff played as a strum of the chords of the movement's chord staff (`PID.STRUM`); it has no sound of its own, see `strum.js`. */
const isStrumStaff = (staff) => isRhythmType(getProperty(staff, PID.STAFF_TYPE)) && getProperty(staff, PID.STRUM) === true;
const isPlayableStaff = (staff) => {
  const t = getProperty(staff, PID.STAFF_TYPE);
  if (isStrumStaff(staff)) return false;
  return PLAYABLE_STAFF_TYPES.includes(t) || (isRhythmType(t) && getProperty(staff, PID.RHYTHM_SOUND) != null);
};

const EPS = 1e-9;

/** Table de tempo « pas de marche constante » : un pas par changement de vitesse (wps = rondes par seconde, 0 pendant une pause). */
function movementSlots(mv, tl, segments) {
  const { layout } = tl;
  const slots = [];
  let cursor = 0;
  for (const segment of segments) {
    for (const mi of segment.measures) {
      const next = mi + 1 < layout.starts.length ? layout.starts[mi + 1] : layout.end;
      const length = tl.secondsAt(next) - tl.secondsAt(layout.starts[mi]);
      slots.push({ measure: mi, t: cursor, end: cursor + length });
      cursor += length;
    }
    cursor += segment.pause ?? 0;
  }
  return { slots, duration: cursor };
}

function tempoSteps(tl, slots, layout) {
  const steps = [];
  for (const slot of slots) {
    const start = layout.starts[slot.measure];
    const next = slot.measure + 1 < layout.starts.length ? layout.starts[slot.measure + 1] : layout.end;
    const base = tl.secondsAt(start);
    steps.push({ t: slot.t, wps: tl.tempoAt(start) });
    for (const e of tl.events) {
      if (fCmp(e.at, start) <= 0 || fCmp(e.at, next) > 0) continue;
      if (e.pause > 0) steps.push({ t: slot.t + (e.arrive - base), wps: 0 });
      if (fCmp(e.at, next) < 0) steps.push({ t: slot.t + (e.time - base), wps: e.wps });
    }
  }
  return steps;
}

const HAIRPIN_TICKS_PER_WHOLE = 1920; // DIVISION de MuseScore : 480 par noire
const DYNAMIC_LEVEL_STEP = 500;       // mpe::DYNAMIC_LEVEL_STEP

/** Facteur d'adoucissement d'une courbe de changement (port de `easingFactor`, `typesconv.cpp`) ; x dans [0, 1]. */
export function easingFactor(x, method = 'normal') {
  switch (method) {
    case 'ease-in': return 1 - Math.sqrt(1 - x * x);
    case 'ease-out': return Math.sqrt(1 - (x - 1) * (x - 1));
    case 'ease-in-out':
      return x < 0.5 ? (1 - Math.sqrt(1 - (2 * x) * (2 * x))) / 2 : (Math.sqrt(1 - (-2 * x + 2) * (-2 * x + 2)) + 1) / 2;
    case 'exponential': return x === 1 ? x : 1 - 2 ** (-10 * x);
    default: return x;
  }
}

/**
 * Points d'un soufflet : port de `PlaybackContext::handleHairpin` (4.7.5). `levelFrom` = niveau en vigueur au début ; `endLevel` = niveau de la
 * nuance d'arrivée du soufflet (ou null) ; `levelAtEnd` = niveau posé à l'instant exact d'arrivée par n'importe quoi (ou null). Un point = { tick (depuis le début), level } ; `ticks` = durée en ticks de 480 par noire.
 */
export function hairpinCurve({ ticks, levelFrom, endLevel, crescendo, method = 'normal', levelAtEnd = null }) {
  const useEnd = endLevel !== null && (crescendo ? endLevel > levelFrom : endLevel < levelFrom);
  const levelTo = useEnd ? endLevel : levelFrom + (crescendo ? DYNAMIC_LEVEL_STEP : -DYNAMIC_LEVEL_STEP);
  // une nuance différente à l'arrivée : on s'arrête un tick avant pour ne pas la recouvrir
  const duration = levelAtEnd !== null && levelAtEnd !== NATURAL_LEVEL && levelAtEnd !== levelTo ? ticks - 1 : ticks;
  if (duration <= 0) return [];
  const steps = Math.max(Math.trunc(duration / (480 / 4)), 24);
  const step = duration / steps;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    points.push({ tick: Math.trunc(i * step), level: levelFrom + Math.trunc(easingFactor(i / steps, method) * (levelTo - levelFrom)) });
  }
  return points;
}

const tickFraction = (n) => frac(n, HAIRPIN_TICKS_PER_WHOLE);
const wholeTicks = (f) => Math.round(fToNumber(f) * HAIRPIN_TICKS_PER_WHOLE);

const PRIORITY = { instrument: 0, staff: 1, voice: 2 }; // VoiceAssignment de MuseScore : priorité = valeur de l'énumération

/**
 * Chronologie des nuances d'une piste → fonction `levelAt(abs, chordId, staffId, voice)` = niveau (0-10000) valable pour un accord (voir l'en-tête).
 * Portée d'application (`PID.VOICE_ASSIGNMENT`, défaut tout l'instrument) : une nuance ou un soufflet 'staff' ne vaut que pour les voix de sa
 * portée, 'voice' que pour sa voix ; à un même instant, la portée la plus étroite l'emporte (`PlaybackContext::applyDynamic`).
 * Les soufflets sont traités après toutes les nuances, dans l'ordre de leur début, et l'emportent à égalité (comme MuseScore).
 */
function dynamicsOfTrack(track, mv, layout, rules) {
  const events = [];
  const spans = new Map(); // id d'accord -> { start, end, staffId, voice }
  const hairpins = [];
  for (const staff of track.staves) {
    if (!isPlayableStaff(staff)) continue;
    for (const h of getProperty(staff, PID.HAIRPINS) ?? []) hairpins.push({ h, staffId: staff.id });
    staff.voices.forEach((voice, voiceIndex) => {
      voice.measures.forEach((measure, mi) => {
        if (mi >= layout.ids.length || !measure) return;
        const length = measureLengthOf(mv.masterbars[mi]);
        let t = ZERO;
        for (const item of measure.items) {
          const d = itemDuration(item, length);
          // un soufflet peut finir (ou commencer) sur un silence : celui qui remplace l'accord supprimé, comme le spanner de MuseScore ancré par temps
          if (item.type === 'rest') spans.set(item.id, { start: fAdd(layout.starts[mi], t), end: fAdd(layout.starts[mi], fAdd(t, d)), staffId: staff.id, voice: voiceIndex });
          if (item.type === 'chord') {
            const start = fAdd(layout.starts[mi], t);
            spans.set(item.id, { start, end: fAdd(start, d), staffId: staff.id, voice: voiceIndex });
            const type = getProperty(item, PID.DYNAMIC);
            const rule = type ? dynamicPlayback(type, rules) : null;
            if (rule && rule.kind !== 'none') {
              events.push({ abs: start, chordId: item.id, rule, assignment: getProperty(item, PID.VOICE_ASSIGNMENT) ?? 'instrument', staffId: staff.id, voice: voiceIndex });
            }
          }
          t = fAdd(t, d);
        }
      });
    });
  }
  events.sort((a, b) => fCmp(a.abs, b.abs));
  const levelOf = (name) => DYNAMIC_LEVELS[name] ?? null;

  /** Événements qui s'appliquent à (portée, voix), un seul par instant (le plus prioritaire, à égalité le dernier). */
  // (memoised per staff and voice: it is asked for every note; one pass per instant — the highest priority wins, the LAST of equal priority)
  const applicableCache = new Map();
  const applicable = (staffId, voice) => {
    const key = `${staffId}|${voice}`;
    let out = applicableCache.get(key);
    if (out) return out;
    const best = new Map(); // instant → { e, i }
    events.forEach((e, i) => {
      if (!(e.assignment === 'instrument' || (e.staffId === staffId && (e.assignment === 'staff' || e.voice === voice)))) return;
      const at = `${e.abs[0]}/${e.abs[1]}`;
      const cur = best.get(at);
      if (!cur || PRIORITY[e.assignment] >= PRIORITY[cur.e.assignment]) best.set(at, { e, i });
    });
    out = [...best.values()].sort((x, y) => x.i - y.i).map((x) => x.e);
    applicableCache.set(key, out);
    return out;
  };
  const levelIn = (list, abs, chordId) => {
    let current = NATURAL_LEVEL;
    let own = null;
    for (const e of list) {
      const c = fCmp(e.abs, abs);
      if (c > 0) break;
      if (e.point !== undefined) { current = e.point; continue; }
      const { rule } = e;
      if (c < 0) {
        if (rule.kind === 'level') current = levelOf(rule.level) ?? current;
        else if (rule.kind === 'compound') current = levelOf(rule.to) ?? current;
      } else if (rule.kind === 'level') current = levelOf(rule.level) ?? current;
      else if (rule.kind === 'compound') current = levelOf(rule.from) ?? current;
      else if (rule.kind === 'single' && e.chordId === chordId) own = levelOf(rule.level);
    }
    return own ?? current;
  };

  // Soufflets : nuance de départ = niveau en vigueur au début (le soufflet n'a pas de nuance propre dans le modèle) ; nuance d'arrivée = nuance
  // de la MÊME voix et de la même portée d'application posée sur l'accord qui commence à l'instant où finit le soufflet, si elle va dans le sens
  // du soufflet ; sinon ± un pas (500).
  const resolved = hairpins
    .map(({ h }) => ({ h, from: spans.get(h.startChordId), to: spans.get(h.endChordId) }))
    .filter((x) => x.from && x.to && fCmp(x.from.start, x.to.end) < 0)
    .sort((a, b) => fCmp(a.from.start, b.from.start));
  for (const { h, from, to } of resolved) {
    const assignment = h.voiceAssignment ?? 'instrument';
    const startTick = wholeTicks(from.start);
    const ticks = wholeTicks(to.end) - startTick;
    const mine = applicable(from.staffId, from.voice);
    const levelFrom = levelIn(mine, from.start, h.startChordId);
    let endLevel = null;
    for (const e of events) {
      if (!fEq(e.abs, to.end) || e.point !== undefined || e.staffId !== from.staffId || e.voice !== from.voice || e.assignment !== assignment) continue;
      const level = e.rule.kind === 'compound' ? levelOf(e.rule.from) : levelOf(e.rule.level);
      if (level !== null && level !== undefined) { endLevel = level; break; }
    }
    const atEnd = mine.find((e) => fEq(e.abs, to.end));
    const levelAtEnd = !atEnd ? null : atEnd.point !== undefined ? atEnd.point : levelOf(atEnd.rule.kind === 'compound' ? atEnd.rule.from : atEnd.rule.level);
    const points = hairpinCurve({
      ticks, levelFrom, endLevel, crescendo: h.hairpinType === 'cresc', method: h.veloChangeMethod ?? 'normal', levelAtEnd,
    });
    for (const p of points) {
      events.push({ abs: fAdd(from.start, tickFraction(p.tick)), point: p.level, assignment, staffId: from.staffId, voice: from.voice });
    }
    events.sort((a, b) => fCmp(a.abs, b.abs)); // tri stable : un point posé plus tard l'emporte à égalité
    applicableCache.clear(); // the event list changed: what applies to a staff / voice must be recomputed
  }
  return (abs, chordId, staffId, voice) => levelIn(applicable(staffId, voice), abs, chordId);
}

const ticksOf = (chord) => Math.round(fToNumber(writtenDuration(getProperty(chord, PID.DURATION))) * HAIRPIN_TICKS_PER_WHOLE);
/** Vélocité imposée d'une note (0 = automatique ; `Note::userVelocity`, voir `finalVelocity`). */
const userVelocityOf = (note) => getProperty(note, PID.USER_VELOCITY) ?? 0;

/**
 * Notes d'ornement jouables d'un accord, par côté (`Chord::graceNotesBefore/After(filterUnplayable)`) : la note d'un pre-bend / pre-dive (début d'un bend
 * fait avant le temps) ne se joue pas (`Chord::isChordPlayable`). Le côté vient du type d'ornement (acciaccature, appoggiature et 4/16/32 = avant ; 8/16/32 après).
 */
function playableGraces(item, bendStarts) {
  const out = { before: [], after: [] };
  for (const g of item.graceNotes ?? []) {
    if (!g.notes.length || bendStarts.has(g.notes[0].id)) continue;
    const type = GRACE_TYPE_TO_MPE[getProperty(g, PID.GRACE_TYPE)];
    if (type === 'PostAppoggiatura') out.after.push(g);
    else if (type) out.before.push(g);
  }
  return out;
}

/** Hauteurs (et son de percussion) jouées par une note de portée. `null` : rien à jouer. */
/** What the fretboard viewer needs beyond the pitch: { capo: { fret, ignored (strings 1 = highest) }, tuning (MIDI, lowest first) } — only the parts in force, null when none. */
function boardState(capoParams, tunes, key) {
  const out = {};
  if (capoParams?.active && capoParams.fret > 0) out.capo = { fret: capoParams.fret, ignored: [...capoParams.ignoredStrings] };
  const tuning = tunes?.length ? tuningAt(tunes, key) : null;
  if (tuning) out.tuning = tuning.slice().reverse();
  return out.capo || out.tuning ? out : null;
}

/** { tuning, frets } of the first tablature staff among `staves` (tuning lowest string first), or null. */
function tabTuning(track, staves) {
  const tab = staves.find((st) => getProperty(st, PID.STAFF_TYPE) === 'tab');
  return tab ? { tuning: tuningPitches(tab).slice().reverse(), frets: maxFretOf(track) } : null;
}

/** The string a note sits on when the score says so (1 = highest string): a tablature note, or a notation note whose string was hinted. null = unknown. */
function stringHintOf(note, staffType) {
  const pid = staffType === 'tab' ? PID.STRING : PID.TAB_STRING;
  if (!isApplicable(note.type, pid)) return null;
  const v = getProperty(note, pid);
  return Number.isInteger(v) && v > 0 ? v : null;
}

export function notePitches({ note, staffType, staff, capoParams, soundMap, stradella, noteStrings = null }) {
  if (isRhythmType(staffType)) { // pas de hauteur : le son de percussion choisi pour la portée
    const midi = getProperty(staff, PID.RHYTHM_SOUND);
    return [{ pitch: midi, sound: String(midi) }];
  }
  if (staffType === 'percussion') {
    const id = getProperty(note, PID.SOUND);
    const sound = drumSound(soundMap, id);
    return [{ pitch: sound?.midi ?? null, sound: id }];
  }
  const pitch = getProperty(note, PID.PITCH);
  if (staffType === 'tab') return [{ pitch: soundingPitch(pitch, capoParams, getProperty(note, PID.STRING)) }];
  if (staffType === 'accordion-left') {
    const row = getProperty(note, PID.ACC_ROW);
    if (isChordRow(row)) return stradellaChordPitches(stradella, ACC_ROW_QUALITY[row], pitch).map((p) => ({ pitch: p }));
    return [{ pitch }];
  }
  if (staffType === 'score' && capoParams) return [{ pitch: soundingPitch(pitch, capoParams, stringHintOf(note, 'score') ?? noteStrings?.get(note.id) ?? null) }];
  return [{ pitch }];
}

/**
 * Séquence d'événements d'un Mouvement ou d'une Œuvre.
 * @param source   Œuvre (`movements`) ou Mouvement
 * @param options  {
 *   speed = 1,                      vitesse d'écoute (> 0) ; 1 = tempo écrit
 *   tempoVersion = 1,               version de la table de tempo (voir `engine.js`)
 *   layers,                         couches de style (swing) ; défaut : le style du Mouvement
 *   dynamicRules,                   règles de lecture des nuances remplaçant celles de MuseScore
 *   articulationRules,              règles d'articulation de l'utilisateur
 *   profiles,                       { [trackId]: nom de profil de PLAYBACK_PROFILES }
 *   velocity: { global, profiles: { [instrumentId]: étage }, tracks: { [trackId]: étage } }   étages de mise en forme, appliqués dans cet ordre
 *   bendsWithArpeggio = false,      bends / dives joués sur un accord arpégé (MuseScore : ignorés) ; l'attaque décalée de l'arpège est conservée
 *   stradellaTable,                 table ou identifiant (défaut : `DEFAULT_STRADELLA_TABLE`)
 *   mixer: { [trackId]: { volume, mute, solo } }   réglages transmis tels quels
 * }
 */
// Signes d'ornement de l'accord (articulations dont les intervalles s'appliquent : `Chord::findOrnament`).
const ORNAMENT_SIGNS = new Set(['trill', 'mordent', 'mordentInverted', 'turn', 'turnInverted']);

export function buildSequence(source, options = {}) {
  const speed = options.speed ?? 1;
  if (!(speed > 0)) throw new Error('buildSequence : « speed » doit être positif');
  const scale = 1 / speed;
  const movements = source.movements ?? [source];
  const stradella = resolveStradellaTable(options.stradellaTable);
  const chordOptions = options.chordSymbols ?? {};
  // dictionnaire de qualités : l'option l'emporte ; sinon celui de l'œuvre (propriété du document) quand on passe une œuvre ; sinon les qualités intégrées
  const chordQualities = options.chordQualities ?? (source.type === 'work' ? workChordQualities(source) : undefined);
  if (chordOptions.duration !== undefined && !CHORD_SYMBOL_DURATIONS.includes(chordOptions.duration)) throw new Error(`buildSequence : durée d'accord inconnue (${chordOptions.duration})`);
  if (chordOptions.voicing !== undefined && !CHORD_SYMBOL_VOICINGS.includes(chordOptions.voicing)) throw new Error(`buildSequence : voicing inconnu (${chordOptions.voicing})`);

  const muted = collectMuted(movements); // accords et notes à PID.PLAY local faux (muets)
  const notes = [];
  const wheelByNote = new Map(); const wheelByChord = new Map(); // wheel curves (model/wheel.js) by note id / by chord id
  const messages = [];
  const chordModes = new Map(); // chord id → 'slap' | 'pop' | 'mute' (see where it is filled)
  const automationByKey = new Map(); // `${track}|${param}` → { track, param, steps } (mixer automation in played time, see automation.js)
  const pedalMsgs = new Map(); // CC64 (pédale, let ring) : clé -> message, dédoublonnés comme `addControlChange`
  const steps = [];
  const slots = [];
  const moves = [];
  const trackById = new Map();
  const firstTracks = movements[0].tracks;
  let offset = 0; // secondes (échelle réelle, non mises à l'échelle) depuis le début

  movements.forEach((mv, movementIndex) => {
    const segments = unwindMovement(mv, { expand: options.playRepeats !== false });
    if (movementIndex < movements.length - 1 && segments.length) segments[segments.length - 1].pause = getProperty(mv, PID.PAUSE) ?? 0;
    if (!mv.masterbars.length) { moves.push({ index: movementIndex, t: offset * scale, end: offset * scale }); return; }
    const tl = tempoTimeline(mv);
    const { layout } = tl;
    const { slots: mvSlots, duration } = movementSlots(mv, tl, segments);
    const layers = options.layers ?? (mv.style ? [mv.style] : []);
    for (const s of mvSlots) slots.push({ movement: movementIndex, measure: s.measure, t: (offset + s.t) * scale, end: (offset + s.end) * scale });
    for (const s of tempoSteps(tl, mvSlots, layout)) steps.push({ t: (offset + s.t) * scale, wps: s.wps * speed });
    moves.push({ index: movementIndex, t: offset * scale, end: (offset + duration) * scale });

    mvSlots.forEach((s, k) => { s.k = k; });
    // Passages joués (pédale : `positionTickOffset` = début joué - début dans la partition, `RepeatList::utick2utime`).
    const segInfo = [];
    {
      let played = ZERO;
      let k = 0;
      segments.forEach((seg, si) => {
        if (!seg.measures.length) return;
        const lastMi = seg.measures[seg.measures.length - 1];
        segInfo.push({ u: played, tick: layout.starts[seg.measures[0]], t: mvSlots[k].t, off: fSub(played, layout.starts[seg.measures[0]]), start: layout.starts[seg.measures[0]], end: fAdd(layout.starts[lastMi], layout.lengths[lastMi]) });
        for (const mi of seg.measures) { mvSlots[k].seg = segInfo.length - 1; k++; played = fAdd(played, layout.lengths[mi]); }
      });
    }
    const utime = makeUtime(segInfo, tl.secondsAt);

    // the lane of the master volume (a lane of the movement): `track: '*'`, with the master fader as its rest value
    for (const lane of automationLanes(mv)) {
      const entries = sortedEntries(lane, layout);
      if (!entries.length || !segInfo.length) continue;
      const steps = passageSteps(entries, segInfo, (abs, p) => utime(fAdd(abs, p.off)), offset, scale);
      const slot = automationByKey.get('*|master') ?? { track: '*', param: 'master', steps: [], rest: masterVolumeOf(source) };
      slot.steps.push(...steps);
      automationByKey.set('*|master', slot);
    }
    mv.tracks.forEach((track, trackIndex) => {
      const trackId = firstTracks[trackIndex]?.id ?? track.id;
      for (const lane of automationLanes(track)) {
        const entries = sortedEntries(lane, layout);
        if (!entries.length || !segInfo.length) continue;
        const steps = passageSteps(entries, segInfo, (abs, p) => utime(fAdd(abs, p.off)), offset, scale);
        const key = `${trackId}|${lane.param}`;
        const slot = automationByKey.get(key) ?? { track: trackId, param: lane.param, steps: [] };
        slot.steps.push(...steps);
        if (lane.param === 'pitchbend') slot.range = pitchBendRangeOf(track);
        automationByKey.set(key, slot);
      }
      const instrumentId = getProperty(track, PID.INSTRUMENT_ID);
      const staves = staffListWithNested(track, mv).filter(isPlayableStaff);
      if (!trackById.has(trackId)) {
        const kind = staves.length && staves.every((s) => ['percussion', 'rhythm', 'neutral'].includes(getProperty(s, PID.STAFF_TYPE))) ? 'percussion' : 'pitched';
        trackById.set(trackId, {
          id: trackId,
          name: getProperty(track, PID.NAME),
          instrumentId: instrumentId ?? null,
          family: instrumentInfo(instrumentId)?.family ?? null,
          kind,
          // open strings (MIDI, LOWEST first) and number of frets of the tablature staff, when the track has one: the fretboard viewer shows what the tablature says
          ...(tabTuning(track, staves) ?? {}),
          mixer: { ...savedMixer(firstTracks[trackIndex] ?? track, source.movements ? source : null), ...(options.mixer?.[trackId] ?? {}) },
        });
      }
      const chordStaves = track.staves.filter((s) => getProperty(s, PID.STAFF_TYPE) === 'chord');
      const strumStaves = track.staves.filter(isStrumStaff);
      const player = playerOf(track);
      const playing = !!player && !playerIsSilent(track);
      if (!staves.length && !chordStaves.length && !strumStaves.length && !player) return;
      const pedals = pedalLines(track.staves.filter(isPlayableStaff), mv, layout);
      const palmMutes = palmMuteChords(track.staves.filter(isPlayableStaff), mv, layout);
      const levelAt = dynamicsOfTrack(track, mv, layout, options.dynamicRules);
      const stages = [
        options.velocity?.global,
        instrumentId ? options.velocity?.profiles?.[instrumentId] : null,
        options.velocity?.tracks?.[trackId],
        dynamicsStage(getProperty(track, PID.MIDI_DYNAMICS)), // the transfer curve of the track (mixer window), last
      ];

      for (const staff of staves) {
        const staffType = getProperty(staff, PID.STAFF_TYPE);
        if (!STAFF_TYPES[staffType]?.sequential) continue;
        const swing = staffSwing(mv, staff, { layers, layout });
        const soundMap = staffType === 'percussion' ? staffSoundMap(getProperty(staff, PID.PERCMAP)) : null;
        // A capo written on a tablature linked to this notation staff also reaches the notation notes (the linked staff holds no content of its own).
        const linkedCapo = staffType === 'score' ? linkedStavesOf(mv, staff).find((l) => getProperty(l, PID.STAFF_TYPE) === 'tab' && (getProperty(l, PID.CAPOS) ?? []).length) : null;
        const capos = staffType === 'tab' ? capoTimeline(mv, staff) : (linkedCapo ? capoTimeline(mv, linkedCapo, staffTimeline(mv, staff)) : null);
        const noteStrings = linkedCapo && capos.some((c) => c.params.ignoredStrings.length)
          ? new Map(projectLinkedStaff(mv, linkedCapo, staff).voices.flatMap((v) => v.measures.flatMap((m) => m.items.flatMap((it) => (it.type === 'chord' ? it.notes.map((n) => [n.id, getProperty(n, PID.STRING)]) : [])))))
          : null;
        const tunes = staffType === 'tab' ? tuningChanges(mv, staff) : null;
        const profile = profileFor({ trackId, staffType, group: instrumentInfo(instrumentId)?.group ?? null }, options.profiles);
        const ties = getProperty(staff, PID.TIES) ?? [];
        const tieNext = new Map(ties.map((t) => [t.startNoteId, t.endNoteId]));
        const tieEnds = new Set(ties.map((t) => t.endNoteId));
        // Bends / dives (`BendsRenderer`) : seul le profil à motif « Multibend » (cordes) les joue ; ailleurs les notes sont ordinaires. Voir `bends.js`.
        const bendLk = (staffType === 'score' || staffType === 'tab') && profileHas(profile, 'Multibend') ? bendLookup(getProperty(staff, PID.BENDS) ?? []) : null;
        const tieBackOf = new Map(ties.map((t) => [t.endNoteId, t.startNoteId]));
        // Wheels (written pitch bends, any pitched instrument): the curve of a note, or of every note of a chord
        for (const w of getProperty(staff, PID.WHEELS) ?? []) {
          if ((staffType !== 'score' && staffType !== 'tab') || w.play === false) continue;
          const curve = wheelCurveOf(w);
          if (w.scope === 'note') { wheelByNote.set(w.startNoteId, curve); continue; }
          for (const vo of staff.voices) for (const m of vo.measures) for (const it of m.items) if (it.type === 'chord' && it.notes.some((n) => n.id === w.startNoteId)) wheelByChord.set(it.id, curve);
        }
        const tieApi = { next: (id) => tieNext.get(id) ?? null, back: (id) => tieBackOf.get(id) ?? null };
        const bendPart = new Map();
        const inBendChain = (id) => {
          if (!bendLk || !bendLk.hasAny(id) && !tieApi.next(id) && !tieApi.back(id)) return false;
          if (!bendPart.has(id)) bendPart.set(id, isMultibendPart(id, bendLk, tieApi));
          return bendPart.get(id);
        };
        const noteInfo = new Map(); // id de note -> { start, nominal, pitch } : contexte de l'accord (secondes de créneau, avant `offset`)
        const bendSliceStart = notes.length;
        const bendStarts = new Set((getProperty(staff, PID.BENDS) ?? []).filter((b) => b.type === 'preBend' || b.type === 'preDive').map((b) => b.startNoteId));
        // Altérations posées dans la mesure AVANT un instant (`Measure::findAccidental` : état par degré — nom + octave —, toutes voix de la portée, ornements
        // compris, notes liées sans altération ignorées), pour l'intervalle voisin des ornements.
        const measureEntries = new Map();
        const accidentalsBefore = (mi, abs) => {
          if (!measureEntries.has(mi)) {
            const length = measureLengthOf(mv.masterbars[mi]);
            const list = [];
            staff.voices.forEach((v, vi) => {
              let pos = layout.starts[mi];
              for (const it of v.measures[mi]?.items ?? []) {
                if (it.type === 'chord') list.push({ abs: pos, vi, item: it });
                pos = fAdd(pos, itemDuration(it, length));
              }
            });
            list.sort((a, b) => fCmp(a.abs, b.abs) || a.vi - b.vi);
            measureEntries.set(mi, list);
          }
          const key = getProperty(mv.masterbars[mi], PID.KEY_SIG) ?? 0;
          const state = new Map();
          for (const e of measureEntries.get(mi)) {
            if (fCmp(e.abs, abs) >= 0) break;
            for (const chord of [...(e.item.graceNotes ?? []), e.item]) {
              for (const n of chord.notes) {
                if (tieEnds.has(n.id)) continue;
                const pitch = getProperty(n, PID.PITCH);
                if (pitch == null) continue;
                const sp = getProperty(n, PID.SPELLING) ?? defaultSpelling(pitch, key);
                state.set(`${sp.step}${sp.octave}`, sp.alter ?? 0);
              }
            }
          }
          return state;
        };

        // Lignes de trille (`SpannersMetaParser::parseTrill`) : chaque accord de la voix de l'accord de début, du début à la fin INCLUS, trille sur sa propre durée.
        const trillLineOf = new Map(); // id d'accord -> { mpe (type d'articulation), line, start, end }
        // Accords qui TERMINENT une ligne jouable : une liaison qui y démarre ne fusionne pas (exception de `NoteRenderer::shouldRender`).
        const trillEndChords = new Set();
        for (const line of getProperty(staff, PID.TRILLS) ?? []) if (TRILL_TYPES[line.trillType] && line.play !== false) trillEndChords.add(line.endChordId);
        for (const line of getProperty(staff, PID.TRILLS) ?? []) {
          const mpe = TRILL_TYPES[line.trillType];
          if (!mpe || line.play === false) continue;
          for (const voice of staff.voices) {
            const ids = voice.measures.flatMap((m) => (m?.items ?? []).filter((i) => i.type === 'chord' || i.type === 'rest').map((i) => i.id)); // la fin peut être un silence
            const a = ids.indexOf(line.startChordId);
            const b = ids.indexOf(line.endChordId);
            if (a < 0 || b < a) continue;
            for (const id of ids.slice(a, b + 1)) if (!trillLineOf.has(id)) trillLineOf.set(id, { mpe, line, start: id === line.startChordId, end: id === line.endChordId });
          }
        }

        // Trémolos à deux notes de la portée : accord de début -> { strokes, endChordId }.
        const twoTremolos = new Map();
        for (const tr of getProperty(staff, PID.TREMOLOS) ?? []) {
          if (Number.isInteger(tr.strokes) && tr.strokes >= 1 && tr.strokes <= 6 && tr.startChordId !== tr.endChordId && !twoTremolos.has(tr.startChordId)) twoTremolos.set(tr.startChordId, tr);
        }


        // Glissandos (`PID.GLISSANDOS`, portées score et tablature) : par NOTE de départ -> { type, steps | range+pc, span, … } (voir `glissandos.js`).
        // Un glissando relie une note à une note de l'accord qui SUIT immédiatement dans la même voix ; une entrée invalide, `play: false` ou un profil sans motif
        // n'a aucun effet (la note se joue normalement).
        const glissOf = new Map();
        const runOf = new Map(); // arrival note id -> { graceNote, pitchStart, steps, total } (glissando RUN: played BEFORE the arrival's beat)
        const runStarts = new Set(); // ornament notes that start a run: not played as ordinary ornaments
        const glissEntries = staffType === 'score' || staffType === 'tab' ? getProperty(staff, PID.GLISSANDOS) ?? [] : [];
        if (glissEntries.length) {
          const noteAt = new Map(); // id de note -> { note, chord, mi, abs, rel, voiceIndex }
          const nextOf = new Map(); // id d'accord -> élément suivant (accord ou silence) de la voix
          staff.voices.forEach((voice, voiceIndex) => {
            let prev = null;
            voice.measures.forEach((measure, mi) => {
              if (mi >= layout.ids.length || !measure) return;
              const length = measureLengthOf(mv.masterbars[mi]);
              let rel = ZERO;
              for (const it of measure.items) {
                if (prev && (prev.mi === mi || prev.mi === mi - 1)) nextOf.set(prev.id, it);
                prev = { id: it.id, mi };
                if (it.type === 'chord') for (const note of it.notes) noteAt.set(note.id, { note, chord: it, mi, abs: fAdd(layout.starts[mi], rel), rel, voiceIndex });
                rel = fAdd(rel, itemDuration(it, length));
              }
            });
          });
          const styleValue = resolveStyle(SID.GLISSANDO_STYLE, layers);
          const soundingOf = (info) => {
            const capoParams = capos ? capoAt(capos, [info.mi, fAdd(measureOffsetOf(mv.masterbars[info.mi], info.mi === 0), info.rel)]) : null;
            return notePitches({ note: info.note, staffType, staff, capoParams, soundMap, stradella, noteStrings })[0]?.pitch ?? null;
          };
          for (const g of glissEntries) {
            if (isRunEntry(g)) {
              // Glissando RUN (organ, model/glissandorun.js): the start is a before-ornament of the arrival chord; it is never played as an ordinary ornament
              // (the arrival keeps its beat), and the run itself is rendered where the arrival chord is (`runOf`).
              const arrival = noteAt.get(g.endNoteId);
              if (!arrival) continue;
              // older files: the start is a grace note; current files: only the interval (start minus arrival) is stored
              const graceNote = g.startNoteId ? arrival.chord.graceNotes?.flatMap((gc) => gc.notes).find((n) => n.id === g.startNoteId) : null;
              if (graceNote) runStarts.add(graceNote.id);
              else if (!Number.isInteger(g.startInterval)) continue;
              if (!glissandoPlays(g) || runOf.has(g.endNoteId)) continue;
              const pitchEnd = soundingOf(arrival);
              const pitchStart = graceNote ? soundingOf({ note: graceNote, mi: arrival.mi, rel: arrival.rel }) : (Number.isInteger(pitchEnd) ? pitchEnd + g.startInterval : null);
              if (!Number.isInteger(pitchStart) || !Number.isInteger(pitchEnd)) continue;
              const style = glissandoStyleOf(g, styleValue);
              const steps = glissandoPitchSteps({ style: style === 'portamento' ? 'whiteKeys' : style, pitchStart, pitchEnd });
              const timing = runTiming({ count: steps.length, runDuration: g.runDuration, stepDuration: g.stepDuration });
              if (timing) runOf.set(g.endNoteId, { id: graceNote?.id ?? `${arrival.note.id}~run`, graceNote: graceNote ?? arrival.note, pitchStart, steps, total: timing.total });
              continue;
            }
            if (glissOf.has(g.startNoteId) || !glissandoPlays(g)) continue;
            const a = noteAt.get(g.startNoteId);
            const b = noteAt.get(g.endNoteId);
            if (!a || !b || a.voiceIndex !== b.voiceIndex || nextOf.get(a.chord.id)?.id !== b.chord.id) continue;
            const pitchStart = soundingOf(a);
            const pitchEnd = soundingOf(b);
            if (!Number.isInteger(pitchStart) || !Number.isInteger(pitchEnd)) continue;
            const style = glissandoStyleOf(g, styleValue);
            const type = glissandoArticulationType(style);
            if (!profileHas(profile, type)) continue;
            const info = { type, pitchStart, pitchEnd, span: tl.secondsAt(b.abs) - tl.secondsAt(a.abs) };
            if (type === 'ContinuousGlissando') {
              info.pc = glissandoPitchPattern(profile);
            } else {
              const rawStart = getProperty(a.note, PID.PITCH);
              info.steps = glissandoPitchSteps({
                style, pitchStart, pitchEnd,
                diatonic: style === 'diatonic' ? {
                  spelling: getProperty(a.note, PID.SPELLING) ?? defaultSpelling(rawStart, getProperty(mv.masterbars[a.mi], PID.KEY_SIG) ?? 0),
                  keySig: getProperty(mv.masterbars[b.mi], PID.KEY_SIG) ?? 0,
                  state: accidentalsBefore(b.mi, b.abs),
                  pitched: staffType === 'score',
                } : undefined,
              });
            }
            glissOf.set(g.startNoteId, info);
          }
        }

        staff.voices.forEach((voice, voiceIndex) => {
          const pending = new Map(); // note liée attendue -> { event, slotK, end (fraction absolue) }
          // créneaux dans l'ordre de lecture
          for (const slot of mvSlots) {
            const mi = slot.measure;
            const measure = voice.measures[mi];
            if (!measure) continue;
            const length = measureLengthOf(mv.masterbars[mi]);
            const nominalOffset = measureOffsetOf(mv.masterbars[mi], mi === 0);
            const base = tl.secondsAt(layout.starts[mi]);
            // 2e accord d'un trémolo à deux notes : l'accord SUIVANT, dans la même mesure (il n'est pas rendu seul, `TremoloTwoMetaParser`).
            const secondOf = new Map();
            measure.items.forEach((it, i) => {
              const next = measure.items[i + 1];
              const tr = it.type === 'chord' ? twoTremolos.get(it.id) : null;
              if (tr && next?.type === 'chord' && next.id === tr.endChordId && DOUBLE_OF[getProperty(it, PID.DURATION)?.base]) secondOf.set(it.id, { tr, chord2: next });
            });
            const secondIds = new Set([...secondOf.values()].map((v) => v.chord2.id));
            let t = ZERO;
            for (const item of measure.items) {
              const d = itemDuration(item, length);
              const startAbs = fAdd(layout.starts[mi], t);
              const endAbs = fAdd(startAbs, d);
              const nextT = fAdd(t, d);
              if (item.type !== 'chord' || secondIds.has(item.id)) { t = nextT; continue; }
              const start = slot.t + (tl.secondsAt(startAbs) - base);
              const nominal = tl.secondsEndAt(endAbs) - tl.secondsAt(startAbs);
              const adjust = swing.get(item.id);
              const articulations = (getProperty(item, PID.ARTICULATIONS) ?? []).map((a) => (a.type === 'trill' && a.ornamentStyle === 'baroque' ? 'trillBaroque' : a.type));
              // playing mode of the chord (a SoundFont engine may switch to the channel of that name of the instrument: slap / pop of a bass, muted guitar under a palm mute line)
              const chordMode = articulations.includes('slap') ? 'slap' : articulations.includes('pop') ? 'pop' : palmMutes.has(item.id) ? 'mute' : null;
              if (chordMode) chordModes.set(item.id, chordMode);
              // the muted-note rule follows the settings of the movement (`SID.MUTED_NOTE_DURATION` / `MUTED_NOTE_VELOCITY`); the user's rules win
              const rules = {
                ...DEFAULT_NOTE_RULES,
                muted: { mode: 'performance', durationFactor: resolveStyle(SID.MUTED_NOTE_DURATION, [mv.style]), velocityOffset: resolveStyle(SID.MUTED_NOTE_VELOCITY, [mv.style]) },
                ...(options.articulationRules ?? {}),
              };
              let velocityOffset = 0;
              let userFactor = null;
              for (const type of articulations) {
                const rule = rules[type];
                if (rule?.mode === 'performance') {
                  if (typeof rule.velocityOffset === 'number') velocityOffset += rule.velocityOffset;
                  if (userFactor === null && typeof rule.durationFactor === 'number') userFactor = rule.durationFactor;
                }
                if (rule?.mode === 'message' && rule.message) {
                  messages.push({ t: (offset + start) * scale, track: trackId, staff: staff.id, kind: rule.message.kind, data: rule.message.data ?? null, source: item.id });
                }
              }
              // Un signe qui a une règle de l'utilisateur n'a plus l'effet de MuseScore (la règle le remplace).
              const types = mpeTypesOf(articulations.filter((a) => !rules[a]));
              // Un signe d'ornement posé sur l'accord l'emporte sur une ligne de trille (MuseScore : indéterminé, choix de Scorsaire).
              const lineInfo = trillLineOf.get(item.id);
              const lineMpe = lineInfo?.mpe;
              if (lineMpe && !types.some((ty) => ORNAMENT_TYPES.includes(ty))) types.push(lineMpe);
              // Pédale / let ring (`SpannersMetaParser`, profil à motif « Pedal » seulement) : articulation Pedal de l'accord + CC64 daté (voir `pedal.js`).
              const pedalLine = pedals.length && item.notes.length && profileHas(profile, 'Pedal') ? pedalForChord(pedals, staff.id, startAbs, endAbs) : null;
              if (pedalLine) {
                types.push('Pedal');
                const off = segInfo[slot.seg].off;
                const onAt = utime(fAdd(pedalLine.start, off));
                const offAt = utime(fAdd(pedalLine.stop, off)) - (tl.secondsAt(pedalLine.stop) - tl.secondsEndAt(pedalLine.stop));
                for (const [at, value] of offAt - onAt > 0 ? [[onAt, 127], [offAt, 0]] : [[offAt, 0]]) {
                  const when = (offset + at) * scale;
                  const key = `${when.toFixed(9)}|${trackId}|${value}`;
                  const attack = offset + start;
                  const known = pedalMsgs.get(key);
                  if (!known || attack < known.attack) {
                    pedalMsgs.set(key, { t: when, track: trackId, staff: pedalLine.staffId, kind: 'controller', data: { number: 64, value }, source: pedalLine.id, attack, seq: known?.seq ?? pedalMsgs.size });
                  }
                }
              }
              const level = levelAt(startAbs, item.id, staff.id, voiceIndex);
              // Marques propres à une NOTE (fantôme, étouffée, harmonique) : `NoteArticulationsParser` (GhostNote, CrossNote, DiamondNote) ; règles
              // utilisateur « ghost » / « muted » / « harmonic » (même forme que celles des articulations ; une règle remplace l'effet de MuseScore).
              // Fantôme = propriété ou parenthèses EXPLICITES (les parenthèses générées par la mise en page sont ignorées) ; la croix l'emporte sur le losange.
              const marksOf = (note) => {
                const out = { types: [], velocityOffset: 0, userFactor: null };
                const kinds = [];
                const flag = (pid) => isApplicable(note.type, pid) && getProperty(note, pid); // la note de percussion n'a ni « étouffée » ni « harmonique »
                if (flag(PID.GHOST) || flag(PID.PARENTHESES)) kinds.push(['ghost', 'GhostNote']);
                if (flag(PID.MUTED)) kinds.push(['muted', 'CrossNote']);
                else if (flag(PID.HARMONIC)) kinds.push(['harmonic', 'DiamondNote']);
                for (const [name, type] of kinds) {
                  const rule = rules[name];
                  if (rule?.mode === 'performance') {
                    if (typeof rule.velocityOffset === 'number') out.velocityOffset += rule.velocityOffset;
                    if (out.userFactor === null && typeof rule.durationFactor === 'number') out.userFactor = rule.durationFactor;
                  } else if (rule?.mode === 'message' && rule.message) {
                    messages.push({ t: (offset + start) * scale, track: trackId, staff: staff.id, kind: rule.message.kind, data: rule.message.data ?? null, source: note.id });
                  } else if (!rule && profileHas(profile, type)) out.types.push(type);
                }
                return out;
              };
              const withMarks = (event, note, baseTypes) => {
                const m = marksOf(note);
                event.types = [...baseTypes, ...m.types.filter((ty) => !baseTypes.includes(ty))];
                event.velocityOffset = velocityOffset + m.velocityOffset;
                event.userFactor = userFactor ?? m.userFactor;
                return event;
              };
              const capoParams = capos ? capoAt(capos, [mi, fAdd(nominalOffset, t)]) : null;
              const board = boardState(capoParams, tunes, [mi, fAdd(nominalOffset, t)]);

              // Carte d'articulations de l'accord (`ChordArticulationsParser`) : signes, arpège, types des notes d'ornement jouables.
              const bps = tl.tempoAt(startAbs) * 4; // noires par seconde
              const graces = playableGraces(item, runStarts.size ? new Set([...bendStarts, ...runStarts]) : bendStarts);
              const arpMpe = ARPEGGIO_TYPE_TO_MPE[getProperty(item, PID.ARPEGGIO)?.type] ?? null;
              const ornamentMpe = types.find((ty) => ORNAMENT_TYPES.includes(ty)) ?? null; // plusieurs : le premier ; avec un arpège, l'ornement l'emporte
              // Trémolo (`TremoloRenderer`) : une note (`PID.TREMOLO`) ou deux (`PID.TREMOLOS`). Priorité (choix de Scorsaire, MuseScore : indéterminé) : ornement > trémolo > arpège.
              const single = getProperty(item, PID.TREMOLO);
              const pair = secondOf.get(item.id) ?? null;
              const tremolo = ornamentMpe ? null
                : single?.buzz ? { buzz: true, strokes: 0 }
                : Number.isInteger(single?.strokes) && single.strokes >= 1 && single.strokes <= 6 ? { strokes: single.strokes }
                : pair ? { strokes: pair.tr.strokes, chord2: pair.chord2 } : null;
              const arpeggio = !ornamentMpe && !tremolo && arpMpe ? arpMpe : null;
              const graceTypeOf = (list) => GRACE_TYPE_TO_MPE[getProperty(list[0], PID.GRACE_TYPE)];
              const allTypes = [...types];
              if (arpMpe) allTypes.push(arpMpe);
              for (const g of [...graces.before, ...graces.after]) {
                const ty = GRACE_TYPE_TO_MPE[getProperty(g, PID.GRACE_TYPE)];
                if (!allTypes.includes(ty)) allTypes.push(ty);
              }
              const chordTicks = Math.round(fToNumber(d) * HAIRPIN_TICKS_PER_WHOLE);
              const compound = isCompoundTimeSig(getProperty(mv.masterbars[mi], PID.TIME_SIG));
              const keySig = getProperty(mv.masterbars[mi], PID.KEY_SIG) ?? 0;

              // Notes d'ornement (`GraceChordCtx::buildCtx`) : prises sur l'accord principal, qui commence après les « avant » et finit avant les « après ».
              let pStart = start;
              let pNominal = nominal;
              const renderedGraceTypes = [];
              for (const side of ['before', 'after']) {
                const list = graces[side];
                if (!list.length) continue;
                const type = graceTypeOf(list);
                renderedGraceTypes.push(type);
                const plan = graceNotesPlan({ side, type, graceTicks: list.map(ticksOf), start, nominal, bps, compound, nominalTicks: chordTicks });
                list.forEach((g, i) => {
                  for (const note of g.notes) {
                    for (const p of notePitches({ note, staffType, staff, capoParams, soundMap, stradella, noteStrings })) {
                      const event = {
                        id: note.id, track: trackId, staff: staff.id, voice: voiceIndex, movement: movementIndex, measure: mi, chord: g.id, pitch: p.pitch,
                        profile, types: [], level, velocityOffset, userVelocity: userVelocityOf(note), userFactor, t: plan.graces[i].start, offset, nominal: plan.graces[i].duration,
                        swingDuration: 1, extra: 0, stages,
                      };
                      withMarks(event, note, allTypes);
                      if (p.sound !== undefined) event.sound = p.sound;
                      // `BendsRenderer::buildRenderingContext` : le contexte d'une note d'ornement est celui de l'accord principal.
                      noteInfo.set(note.id, { start, nominal, pitch: p.pitch });
                      if (!ornamentMpe && !tremolo && (!arpeggio || options.bendsWithArpeggio) && inBendChain(note.id)) event.bendable = true;
                      notes.push(event);
                    }
                  }
                });
                if (side === 'before') pStart += plan.actual;
                pNominal -= plan.actual;
              }
              // Glissando RUN (organ): the white keys are played one after the other and the LAST one ends exactly where the arrival chord REALLY sounds
              // (after its own before-graces, plus its swing delay), which is not moved. The run steals the time that precedes it (the previous note is not
              // rewritten); the steps tile that time exactly (no articulation gap). The room is measured in PLAYBACK time, so the first chord of a repeated
              // section still has its run on later passes; where there is less room (start of the playback) the run is compressed to it.
              for (const note of runOf.size ? item.notes : []) {
                const run = runOf.get(note.id);
                if (!run) continue;
                const arrivalAt = pStart + (adjust && !ornamentMpe ? pNominal * adjust.remaining : 0);
                const wanted = fCmp(startAbs, run.total) > 0 ? tl.secondsAt(startAbs) - tl.secondsAt(fSub(startAbs, run.total)) : fToNumber(run.total) / (tl.tempoAt(startAbs) || 1);
                const span = Math.min(wanted, offset + arrivalAt);
                if (!(span > 0)) continue;
                const step = span / run.steps.length;
                run.steps.forEach((semis, i) => {
                  notes.push({
                    id: run.id, track: trackId, staff: staff.id, voice: voiceIndex, movement: movementIndex, measure: mi, chord: item.id, pitch: run.pitchStart + semis,
                    profile, types: [], level, velocityOffset, userVelocity: userVelocityOf(run.graceNote), userFactor: 1, t: arrivalAt - span + i * step, offset, nominal: step,
                    swingDuration: 1, extra: 0, stages,
                  });
                });
              }

              const principalTypes = allTypes.filter((ty) => !renderedGraceTypes.includes(ty));
              const principalTicks = pNominal === nominal ? chordTicks : Math.round((chordTicks * pNominal) / nominal);

              // Arpège (`ArpeggioRenderer`) : attaques décalées, la durée restante raccourcie d'autant.
              const principalNotes = item.notes.map((note) => ({ note, pitches: notePitches({ note, staffType, staff, capoParams, soundMap, stradella, noteStrings }) }));
              let arpOffsets = null;
              let renderOrder = principalNotes;
              if (arpeggio) {
                const stepMs = getProperty(item, PID.ARPEGGIO)?.stepMs ?? getProperty(track, PID.STYLE_OVERRIDES)?.[SID.ARPEGGIO_STEP_MS] ?? resolveStyle(SID.ARPEGGIO_STEP_MS, layers); // the chord, then the track, then the movement
                const plan = arpeggioPlan({ type: arpeggio, nominal: pNominal, stepMs, notes: principalNotes.map((n) => ({ key: n.note.id, pitch: n.pitches[0]?.pitch ?? 0 })) });
                arpOffsets = new Map(plan.map((p) => [p.key, p.offset]));
                const byId = new Map(principalNotes.map((n) => [n.note.id, n]));
                renderOrder = plan.map((p) => byId.get(p.key));
              }

              if (tremolo) {
                const writtenBase = getProperty(item, PID.DURATION)?.base;
                const written = tremolo.chord2 ? DOUBLE_OF[writtenBase] : writtenBase;
                const ratio = getProperty(item, PID.TUPLET)?.ratio;
                const stepTicks = tremoloStepTicks({ beams: BEAMS_OF[written] ?? 0, strokes: tremolo.strokes, stretch: !tremolo.chord2 && ratio ? ratio[1] / ratio[0] : 1 });
                const chord2Ticks = tremolo.chord2 ? Math.round(fToNumber(itemDuration(tremolo.chord2, length)) * HAIRPIN_TICKS_PER_WHOLE) : 0;
                const steps2 = tremoloPlan({ overallTicks: principalTicks + chord2Ticks, stepTicks, buzz: !!tremolo.buzz, two: !!tremolo.chord2 });
                const typeName = tremolo.buzz ? 'TremoloBuzz' : tremoloTypeOfStrokes(tremolo.strokes);
                const stepTypes = [...principalTypes, ...(profileHas(profile, typeName) ? [typeName] : [])];
                const shiftTicks = Math.round((pStart - start) * bps * TICKS_PER_QUARTER);
                const chordsOf = [item, tremolo.chord2];
                for (const st of steps2) {
                  const from = fAdd(startAbs, tickFraction(shiftTicks + st.start));
                  const to = fAdd(startAbs, tickFraction(shiftTicks + st.start + st.ticks));
                  const owner = chordsOf[st.which];
                  const stepLevel = levelAt(from, owner.id, staff.id, voiceIndex);
                  for (const n of owner.notes) {
                    for (const p of notePitches({ note: n, staffType, staff, capoParams, soundMap, stradella, noteStrings })) {
                      const event = {
                        id: n.id, track: trackId, staff: staff.id, voice: voiceIndex, movement: movementIndex, measure: mi, chord: owner.id, pitch: p.pitch,
                        profile, types: [], level: stepLevel, velocityOffset, userVelocity: userVelocityOf(n), userFactor,
                        t: slot.t + (tl.secondsAt(from) - base), offset, nominal: tl.secondsEndAt(to) - tl.secondsAt(from), swingDuration: 1, extra: 0, stages,
                      };
                      withMarks(event, n, stepTypes);
                      if (tremolo.buzz) event.roll = true;
                      if (p.sound !== undefined) event.sound = p.sound;
                      notes.push(event);
                    }
                  }
                }
                // Une note liée à un accord à trémolo n'est jamais fusionnée : chaque accord rend ses propres pas.
                for (const [owner, endT] of [[item, endAbs], ...(tremolo.chord2 ? [[tremolo.chord2, fAdd(endAbs, itemDuration(tremolo.chord2, length))]] : [])]) {
                  for (const n of owner.notes) {
                    pending.delete(n.id);
                    if (tieNext.has(n.id)) pending.set(tieNext.get(n.id), { event: null, slotK: slot.k, end: endT, arp: false, chord: owner.id, tremolo: true });
                  }
                }
                t = nextT;
                continue;
              }

              for (const { note, pitches } of renderOrder) {
                const noteId = note.id;
                const arpOffset = arpOffsets ? arpOffsets.get(noteId) : 0;
                const ctxStart = pStart + arpOffset;
                const ctxNominal = pNominal - arpOffset;
                if (pitches[0]?.pitch != null) noteInfo.set(noteId, { start: ctxStart, nominal: ctxNominal, pitch: pitches[0].pitch });
                // Bend (ignoré avec un ornement ou un trémolo, et avec un arpège sauf option `bendsWithArpeggio`) ; il l'emporte sur un glissando.
                const bendHere = !ornamentMpe && (!arpeggio || options.bendsWithArpeggio) && inBendChain(noteId);
                const link = tieEnds.has(noteId) ? pending.get(noteId) : null;
                // Glissando de la note (ignoré avec un ornement ; le trémolo a déjà quitté la boucle) : voir `glissandos.js`.
                const gl = ornamentMpe || bendHere ? undefined : glissOf.get(noteId);
                const noteTypes = gl ? [...principalTypes, gl.type] : principalTypes;
                const curveSpec = () => ({ pc: gl.pc, range: gl.pitchEnd - gl.pitchStart, start, span: gl.span });
                // `NoteRenderer::shouldRender` : une note liée n'est pas rejouée, sauf si sa carte a une articulation « multi-notes » (arpège) alors que celle
                // de départ n'en a pas ; entre deux arpèges, rien non plus.
                // Exception : la note de départ appartient à un accord qui termine une ligne de trille jouable (l'ornement est alors rendu sur la note liée).
                // Un glissando DISCRET (« multi-notes ») rend aussi la note à part.
                const separate = link && (link.tremolo || (arpMpe && !link.arp) || trillEndChords.has(link.chord) || gl?.type === 'DiscreteGlissando');
                const linked = link && (link.slotK === slot.k || link.slotK === slot.k - 1) && fEq(link.end, startAbs);
                if (linked && separate && gl?.type === 'DiscreteGlissando' && link.event && !link.event.ornament) {
                  // `renderNormalTie` : la note précédente est prolongée d'UN pas du glissando de cette note (le 1er pas de celle-ci est sauté).
                  link.event.extra += discreteStepDuration(gl.steps ?? [], nominal);
                }
                if (linked && !separate) {
                  if (link.event.ornament) {
                    // Ornement : `applyTiedNotesDuration` prolonge l'ornement jusqu'à la fin de la chaîne, durée brute, sans fusion d'articulations.
                    link.event.extra += nominal;
                    link.event.extraTicks += chordTicks;
                  } else {
                    // Note liée (NoteRenderer::addTiedNote) : durée ajoutée telle quelle si la note liée n'a que « Standard », sinon × son facteur ;
                    // ses articulations (sauf staccato / staccatissimo) s'ajoutent à celles de la première note.
                    const mergeTypes = [...(gl ? [...allTypes, gl.type] : allTypes), ...marksOf(note).types];
                    link.event.extra += nominal * (mergeTypes.length ? averageDurationFactor(link.event.profile, mergeTypes) : 1);
                    for (const m of mergeTypes) if (m !== 'Staccato' && m !== 'Staccatissimo' && !link.event.types.includes(m)) link.event.types.push(m);
                    // glissando continu sur la note liée : la courbe (datée en absolu) s'applique à la note longue (la 1re courbe l'emporte, comme `insert` d'une carte)
                    if (gl?.type === 'ContinuousGlissando' && !link.event.pitchCurve) link.event.pitchCurve = curveSpec();
                  }
                  link.event.nominalEnd = start + nominal;
                  pending.delete(noteId);
                  if (tieNext.has(noteId)) pending.set(tieNext.get(noteId), { event: link.event, slotK: slot.k, end: endAbs, arp: !!arpMpe, chord: link.chord });
                  continue;
                }
                for (const p of pitches) {
                  const event = {
                    id: noteId,
                    track: trackId,
                    staff: staff.id,
                    voice: voiceIndex,
                    movement: movementIndex,
                    measure: mi,
                    chord: item.id,
                    pitch: p.pitch,
                    string: stringHintOf(note, staffType),
                    board,
                    profile,
                    types: [],
                    level,
                    velocityOffset,
                    userVelocity: userVelocityOf(note),
                    userFactor,
                    // l'ornement n'est pas swingué (`OrnamentsRenderer` n'appelle pas `applySwingIfNeed`)
                    t: ctxStart + (adjust && !ornamentMpe ? ctxNominal * adjust.remaining : 0),
                    offset,
                    nominal: ctxNominal,
                    swingDuration: adjust && !ornamentMpe ? adjust.duration : 1,
                    extra: 0,
                    stages,
                  };
                  withMarks(event, note, noteTypes);
                  if (p.sound !== undefined) event.sound = p.sound;
                  if (gl?.type === 'ContinuousGlissando') event.pitchCurve = curveSpec();
                  else if (gl?.steps.length) {
                    // pas du glissando discret : datés à la fin (la durée totale dépend des liaisons) ; chaque pas prend le niveau de nuance de son instant
                    event.glissando = {
                      steps: gl.steps,
                      tiedBack: tieEnds.has(noteId),
                      levelAt: (sec) => (nominal > 0 ? levelAt(fAdd(startAbs, tickFraction(Math.round(((sec - start) * chordTicks) / nominal))), item.id, staff.id, voiceIndex) : level),
                    };
                  }
                  if (ornamentMpe) {
                    const spelling = staffType === 'score' || staffType === 'accordion-left' ? getProperty(note, PID.SPELLING) ?? defaultSpelling(p.pitch, keySig) : null;
                    const state = spelling ? accidentalsBefore(mi, startAbs) : null;
                    // `Chord::findOrnament(true)` : signe d'ornement de l'accord, sinon ligne qui y COMMENCE, sinon ligne qui s'y TERMINE ; accord au milieu d'une ligne : défaut.
                    const signEntry = (getProperty(item, PID.ARTICULATIONS) ?? []).find((a) => ORNAMENT_SIGNS.has(a.type));
                    const source = signEntry ?? (lineInfo && (lineInfo.start || lineInfo.end) ? lineInfo.line : null);
                    const semis = (direction) => ornamentSideSemitones(ornamentIntervalOf(source, direction > 0), { pitch: p.pitch, spelling, keySig, state, direction, pitched: !!spelling });
                    const shiftTicks = Math.round((pStart - start) * bps * TICKS_PER_QUARTER);
                    event.ornament = {
                      type: ornamentMpe, ticks: principalTicks, bps, semisUp: semis(1), semisDown: semis(-1),
                      levelAt: (ratio, total) => levelAt(fAdd(startAbs, tickFraction(shiftTicks + Math.round(ratio * total))), item.id, staff.id, voiceIndex),
                    };
                    event.extraTicks = 0;
                  }
                  if (bendHere) event.bendable = true;
                  notes.push(event);
                  if (tieNext.has(noteId)) pending.set(tieNext.get(noteId), { event, slotK: slot.k, end: endAbs, arp: !!arpMpe, chord: item.id });
                }
              }
              t = nextT;
            }
          }
        });

        // Chaînes de bends : la note de départ porte la courbe, les notes d'arrivée ne sont pas rejouées seules (`BendsRenderer::render`).
        if (bendLk) {
          const bendable = notes.slice(bendSliceStart).filter((e) => e.bendable);
          const eventOf = new Map(bendable.map((e) => [e.id, e]));
          for (const e of bendable) {
            if (isChainArrival(e.id, bendLk)) e.bendMember = true;
            else e.bend = { lookup: bendLk, tie: tieApi, noteInfo, eventOf };
          }
        }
      }

      // Portée d'accords (`renderChordSymbol`) : un événement par note de l'accord réalisé, nuance de l'instant, articulation « standard » du profil.
      {
        // Muet par défaut (`chordOptions.play` vrai pour les activer) ; un PID.PLAY local, sur le symbole (ou sur le `%` qui le répète), l'emporte.
        for (const staff of chordStaves) {
          const capo = getProperty(staff, PID.CAPO) ?? 0;
          const profile = profileFor({ trackId, staffType: 'chord', group: instrumentInfo(instrumentId)?.group ?? null }, options.profiles);
          if (playing) continue; // a track whose player plays does not hold each chord as well
          staff.voices.forEach((voice, voiceIndex) => {
            const stream = expandChordSymbols(voice, mv, layout);
            for (const c of playedChordSymbols(stream, { slots: mvSlots, layout, tl, mv, duration: chordOptions.duration })) {
              if (!(localPlay(c.owner) ?? localPlay(c.item) ?? chordOptions.play === true)) continue;
              const level = levelAt(c.abs, null, staff.id, voiceIndex);
              chordSymbolPitches(c.item, chordQualities, { capo, voicing: chordOptions.voicing }).forEach((pitch, i) => {
                notes.push({
                  id: `${c.item.id}#${i}`, track: trackId, staff: staff.id, voice: voiceIndex, movement: movementIndex, measure: mvSlots[c.slot].measure, chord: c.item.id,
                  pitch, profile, types: [], level, velocityOffset: 0, userFactor: null, t: c.start, offset, nominal: c.nominal, swingDuration: 1, extra: 0, stages,
                });
              });
            }
          });
        }
      }

      // The player of the track (`model/player.js`): a pattern and a card play the chords of the movement's FIRST chord staff on the instrument of the track; the same planner as the "what this track plays" window
      if (playing) {
        const cards = { project: source.type === 'work' ? getProperty(source, PID.STRUM_CARDS) : [], user: options.strumCards ?? [] };
        const drums = playerKindOf(track) === 'drums';
        let plan = null; let staff = track.staves[0];
        if (drums) {
          // a drum track: the groove of the player, played with the sounds of the track's percussion map
          const groove = resolveGroove(player.pattern, { project: source.type === 'work' ? getProperty(source, PID.GROOVES) : [], user: options.grooves ?? [] });
          staff = track.staves.find((st) => getProperty(st, PID.STAFF_TYPE) === 'percussion') ?? staff;
          plan = groove ? planDrumTrack({ track, mv, layout, tl, slots: mvSlots, groove, percmap: staffSoundMap(getProperty(staff, PID.PERCMAP)), cards, ...(options.drumVersionPhrase ? { versionPhrase: options.drumVersionPhrase } : {}) }) : null;
        } else {
          const pattern = resolveChordPattern(player.pattern, { project: source.type === 'work' ? getProperty(source, PID.CHORD_PATTERNS) : [], user: options.chordPatterns ?? [] });
          plan = pattern ? planPlayerTrack({
            track, mv, layout, tl, slots: mvSlots, chordQualities, pattern, voicing: chordOptions.voicing,
            preferred: options.preferredVoicings ?? (source.type === 'work' ? getProperty(source, PID.PREFERRED_VOICINGS) : null), cards,
          }) : null;
        }
        if (plan) {
          const profile = profileFor({ trackId, staffType: drums ? 'percussion' : 'chord', group: instrumentInfo(instrumentId)?.group ?? null }, options.profiles);
          // the swing of the movement acts on the hits of the player as on written chords: the second half of a swing beat is delayed
          const swingTimeline = staffSwingTimeline(mv, track.staves[0], { layers, layout });
          const swung = new Map();
          const delayOf = (ev) => {
            if (!swung.has(ev.id)) {
              const d = playerSwingDelay(swingTimeline, mv.masterbars[ev.slot.measure], ev.slot.measure, ev.abs, layout.starts[ev.slot.measure]);
              swung.set(ev.id, d ? tl.secondsAt(fAdd(ev.abs, d)) - tl.secondsAt(ev.abs) : 0);
            }
            return swung.get(ev.id);
          };
          for (const n of plan.notes) {
            const ev = plan.items.find((e) => e.id === n.event);
            const level = levelAt(ev.abs, null, staff.id, 0);
            notes.push({
              id: `${n.event}#p${n.pitch}${n.string != null ? `s${n.string}` : ''}${n.sound ? `:${n.sound}` : ''}`, track: trackId, staff: staff.id, voice: 0, movement: movementIndex, measure: ev.slot.measure, chord: n.event,
              pitch: n.pitch, ...(n.sound !== undefined ? { sound: n.sound } : {}), profile, types: [], level, velocityOffset: velocityFromLevel(level) * (n.velocity - 1), userFactor: null,
              t: n.t + delayOf(ev), offset, nominal: n.duration, swingDuration: 1, extra: 0, stages,
            });
          }
        }
      }

      // Strum / piano comping of a rhythm staff (`rhythmplay.js`): the rhythm staff plays the chords of the movement's FIRST chord staff
      for (const staff of strumStaves) {
        const plan = planRhythmStaff({
          staff, mv, layout, tl, slots: mvSlots, chordQualities, voicing: chordOptions.voicing,
          preferred: options.preferredVoicings ?? (source.type === 'work' ? getProperty(source, PID.PREFERRED_VOICINGS) : null),
          cards: { project: source.type === 'work' ? getProperty(source, PID.STRUM_CARDS) : [], user: options.strumCards ?? [] },
        });
        if (!plan) continue;
        const profile = profileFor({ trackId, staffType: 'chord', group: instrumentInfo(instrumentId)?.group ?? null }, options.profiles);
        for (const n of plan.notes) {
          const ev = plan.items.find((e) => e.id === n.event);
          const level = levelAt(ev.abs, null, staff.id, ev.voiceIndex);
          notes.push({
            id: plan.kind === 'piano' ? `${n.event}#p${n.pitch}` : `${n.event}#s${n.string}`, track: trackId, staff: staff.id, voice: ev.voiceIndex, movement: movementIndex, measure: ev.slot.measure, chord: n.event,
            pitch: n.pitch, profile, types: [], level, velocityOffset: velocityFromLevel(level) * (n.velocity - 1), userFactor: null,
            t: n.t, offset, nominal: n.duration, swingDuration: 1, extra: 0, stages,
          });
        }
      }
    });
    offset += duration;
  });

  // durées finales + mise à l'échelle de la vitesse + abandon des champs de travail
  // Rendu d'UNE note (dates en secondes, vitesse d'écoute non appliquée) : `t` attaque nominale, `nominal` durée nominale du contexte, `extraDuration` durée
  // ajoutée (liaisons), `nominalLevel` niveau de nuance. Une attaque avant le début de la partition est ramenée à 0 (`NoteRenderer::render`).
  const renderRaw = (e, t, nominal, swingDuration, extraDuration, nominalLevel) => {
    const effect = articulationEffect(e.profile, e.types, nominalLevel);
    const factor = e.userFactor ?? effect.durationFactor;
    let duration = (nominal * swingDuration + extraDuration) * factor;
    let attack = t + nominal * effect.timestampFactor + e.offset;
    if (attack < 0) { duration += attack; attack = 0; }
    return { effect, factor, attack, duration };
  };
  const finalNotes = notes.flatMap((e) => {
    if (muted.chords.has(e.chord) || muted.notes.has(e.id)) return []; // PID.PLAY local faux : affiché, non joué
    if (e.bendMember) return []; // note d'arrivée d'un bend : portée par la courbe de la note de départ
    const base = { id: e.id, track: e.track, staff: e.staff, voice: e.voice, movement: e.movement, measure: e.measure, chord: e.chord };
    if (e.board) Object.assign(base, e.board); // capo and tuning in force at the note (only when there is one): the fretboard viewer shows them
    if (e.string != null) base.string = e.string; // string of the note (1 = highest) when the score knows it: tablature note, or a notation note with a string hint
    // playing mode: slap / pop / mute (palm mute line) of the chord, or harmonics (a harmonic note); only informs engines that switch sounds by mode
    const mode = chordModes.get(e.chord) ?? (e.types?.includes('DiamondNote') ? 'harmonics' : null);
    if (mode) base.mode = mode;
    const render = (pitch, t, nominal, swingDuration, extraDuration, nominalLevel) => {
      const r = renderRaw(e, t, nominal, swingDuration, extraDuration, nominalLevel);
      const out = { ...base, pitch, velocity: finalVelocity({ level: r.effect.level, velocityOffset: e.velocityOffset, userVelocity: e.userVelocity, stages: e.stages }), t: r.attack * scale, duration: r.duration * scale };
      if (e.sound !== undefined) out.sound = e.sound;
      if (e.roll) out.roll = true;
      return out;
    };
    if (e.bend) {
      // Bend / dive (`BendsRenderer::renderMultibend` + `buildBendEvent`) : UNE note fusionnée dont la durée couvre la chaîne, avec sa courbe de hauteur.
      const b = e.bend;
      const rawOf = (ev) => renderRaw(ev, ev.t, ev.nominal, ev.swingDuration, ev.extra, ev.level);
      const plan = planMultibend({
        startId: e.id, lookup: b.lookup, tie: b.tie,
        member: (id) => {
          const ev = b.eventOf.get(id);
          if (!ev || ev.pitch == null) return null;
          const r = rawOf(ev);
          return { ts: r.attack, dur: r.duration, level: ev.pitch * PITCH_LEVEL_STEP };
        },
        noteCtx: (id) => {
          const c = b.noteInfo.get(id);
          return c ? { start: c.start + e.offset, nominal: c.nominal, level: c.pitch * PITCH_LEVEL_STEP } : null;
        },
      });
      if (plan.events.length && plan.events[0].note === e.id) {
        const merged = buildBendEvent(plan.events, plan.factors);
        const r = rawOf(e);
        // `buildNoteEvent` applique une SECONDE fois les facteurs d'articulation du profil à la note fusionnée.
        const out = {
          ...base, pitch: e.pitch, velocity: finalVelocity({ level: r.effect.level, velocityOffset: e.velocityOffset, userVelocity: e.userVelocity, stages: e.stages }),
          t: (merged.ts + merged.dur * r.effect.timestampFactor) * scale, duration: merged.dur * r.factor * scale,
        };
        // user curve (bend graph) of the head bend of the chain: replaces the curve built from the time factors
        // the curve lives on the HEAD of the chain: the bend that starts at the note, or the pre-bend / pre-dive that ends on it
        const back = b.lookup.bendBack(e.id);
        const own = b.lookup.bendFor(e.id);
        const head = back && (back.type === 'preBend' || back.type === 'preDive' || back.type === 'graceNoteBend') ? back
          : own ?? (b.lookup.diveBack(e.id)?.type === 'scoop' ? b.lookup.diveBack(e.id) : null);
        const userCurve = bendCurveOf(head);
        if (userCurve) out.pitchCurve = sampleBendCurve(userCurve).map((pt) => ({ t: (merged.ts + merged.dur * pt.t) * scale, semitones: pt.s }));
        else if (merged.curve.some(([, lv]) => lv !== 0)) out.pitchCurve = merged.curve.map(([pct, lv]) => ({ t: (merged.ts + (merged.dur * pct) / 10000) * scale, semitones: lv / PITCH_LEVEL_STEP }));
        return [out];
      }
    }
    if (e.glissando) {
      // Glissando discret (`GlissandosRenderer::renderDiscreteGlissando`) : durée du pas = durée de la note (liaisons et swing compris) / nombre de pas.
      const total = e.nominal * e.swingDuration + e.extra;
      return discreteGlissandoSteps({ steps: e.glissando.steps, total, tiedBack: e.glissando.tiedBack })
        .map((st) => render(e.pitch + e.glissando.steps[st.index], e.t + st.offset, st.duration, 1, 0, e.glissando.levelAt(e.t + st.offset)));
    }
    if (!e.ornament) {
      const out = render(e.pitch, e.t, e.nominal, e.swingDuration, e.extra, e.level);
      if (e.pitchCurve) {
        // Glissando continu : courbe de hauteur datée en absolu (demi-tons relatifs à la note), de l'accord de départ à l'accord d'arrivée.
        out.pitchCurve = continuousGlissandoCurve(e.pitchCurve).map((pt) => ({ t: (pt.t + e.offset) * scale, semitones: pt.semitones }));
      }
      return [out];
    }
    // Ornement (mordant, gruppetto) : sous-notes datées ; chacune prend le niveau de nuance de SON instant (`OrnamentsRenderer::createEvents`).
    const total = e.nominal + e.extra;
    const ticks = e.ornament.ticks + e.extraTicks;
    const subs = ornamentEvents({ ...e.ornament, ticks, start: e.t, duration: total }) ?? [];
    return subs.map((sub) => render(e.pitch === null ? null : e.pitch + sub.semitones, sub.t, sub.duration, 1, 0, e.ornament.levelAt((sub.t - e.t) / total, ticks)));
  });
  // A wheel moves the pitch of the note(s) it is written on over their whole sounding length; on a note that already bends, the two add up
  if (wheelByNote.size || wheelByChord.size) {
    for (const n of finalNotes) {
      const curve = wheelByNote.get(n.id) ?? wheelByChord.get(n.chord);
      if (!curve || n.pitch == null) continue;
      n.pitchCurve = addWheelCurve(n.pitchCurve, sampleBendCurve(curve).map((pt) => ({ t: n.t + n.duration * pt.t, semitones: pt.s })));
    }
  }
  // The pitch-bend lane of a track (automation, ± its range) moves every note that sounds under it: folded into the notes' own pitch curve, which adds up with a wheel or a guitar bend
  for (const lane of automationByKey.values()) {
    if (lane.param !== 'pitchbend') continue;
    const curve = compileLane(lane.steps, 0.5);
    if (!curve.length) continue;
    const bendAt = (t) => pitchBendSemitones(laneCurveAt(curve, t, 0.5), lane.range);
    for (const n of finalNotes) {
      if (n.track !== lane.track || n.pitch == null || trackById.get(n.track)?.kind === 'percussion') continue;
      const end = n.t + n.duration;
      const times = new Set([n.t, end]);
      for (const p of curve) for (const t of [p.t, p.to?.t]) if (t !== undefined && t > n.t && t < end) times.add(t);
      const points = [];
      for (const t of [...times].sort((a, b) => a - b)) {
        if (t > n.t && t < end) points.push({ t: t - 1e-4, semitones: bendAt(t - 1e-4) }); // a step: the value before, then the value after
        points.push({ t, semitones: bendAt(t) });
      }
      if (points.every((q) => Math.abs(q.semitones) < 1e-9)) continue;
      n.pitchCurve = addWheelCurve(n.pitchCurve, points);
    }
  }
  if (options.transpose) for (const n of finalNotes) { const k = options.transpose[n.track]; if (k && n.pitch != null) n.pitch += k; } // playback transposition per track (semitones), e.g. for a sheet
  finalNotes.sort((a, b) => a.t - b.t || (a.pitch ?? -1) - (b.pitch ?? -1));
  steps.sort((a, b) => a.t - b.t);
  const dedup = [];
  for (const s of steps) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.t - s.t) < EPS) { dedup[dedup.length - 1] = s; continue; }
    if (last && last.wps === s.wps) continue;
    dedup.push(s);
  }
  const lastMove = moves[moves.length - 1];
  // technique texts (`PID.STAFF_TEXTS` with a `technique`): a free message to the player at their instant, in every played occurrence of the measure
  // (`options.techniqueRules[id]` = { kind, data } replaces the default `{ kind: 'technique', data: { technique } }`, e.g. a sampler key switch)
  const techniqueMessages = [];
  const tempoSteps2 = dedup.map((s) => ({ t: s.t, wps: s.wps, bpm: s.wps * 240 }));
  movements.forEach((mv, movementIndex) => {
    mv.tracks.forEach((track, trackIndex) => {
      const trackId = firstTracks[trackIndex]?.id ?? track.id;
      for (const staff of track.staves) {
        for (const e of getProperty(staff, PID.STAFF_TEXTS) ?? []) {
          if (!e.technique) continue;
          const mi = mv.masterbars.findIndex((b) => b.id === e.measureId);
          if (mi < 0) continue;
          const leslieMode = LESLIE_TECHNIQUE_MODE[e.technique]; // a Leslie sign is a rotor state change, not a technique message
          const rule = leslieMode ? null : options.techniqueRules?.[e.technique];
          const message = leslieMode ? { kind: 'leslie', data: { mode: leslieMode } } : rule ?? { kind: 'technique', data: { technique: e.technique } };
          for (let occurrence = 0; ; occurrence += 1) {
            const t = secondsOf({ slots, tempo: { steps: tempoSteps2 } }, movementIndex, mi, e.position, occurrence);
            if (t === null || t === undefined) break;
            techniqueMessages.push({ t, track: trackId, staff: staff.id, kind: message.kind, data: message.data, source: e.id });
          }
        }
      }
    });
  });
  return {
    format: SEQUENCE_FORMAT,
    version: SEQUENCE_VERSION,
    speed,
    duration: lastMove ? lastMove.end : 0,
    tracks: [...trackById.values()],
    notes: finalNotes,
    messages: [...messages, ...techniqueMessages, ...[...pedalMsgs.values()].sort((a, b) => a.t - b.t || a.attack - b.attack || a.seq - b.seq).map(({ attack, seq, ...m }) => m)].sort((a, b) => a.t - b.t),
    automation: [...automationByKey.values()].map((l) => ({ ...l, steps: l.steps.slice().sort((a, b) => a.t - b.t) })),
    tempo: { version: options.tempoVersion ?? 1, steps: dedup.map((s) => ({ t: s.t, wps: s.wps, bpm: s.wps * 240 })) },
    slots,
    movements: moves,
  };
}
