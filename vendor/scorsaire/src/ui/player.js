/*
 * Lecteur (couche C du contrat audio, `engine.js`) : transport, vitesse d'écoute, boucle sur une plage de mesures, position dans la partition.
 * SANS DOM et sans Web Audio : il reçoit un moteur conforme au contrat (V1 `webaudio.js`, `NullAudioEngine` en test, V2 plus tard) et une
 * fonction `build(speed)` qui produit la séquence (`buildSequence`). Le lecteur ne modifie JAMAIS le Document.
 *
 * Décisions (Jean, 11/10/2026) : vitesse par paliers (boutons − / +), appliquée à TOUT (la séquence est reconstruite avec `speed` et rechargée à la
 * même position musicale : toutes les dates se mettent à l'échelle, donc nouvelle position = ancienne × vitesse ancienne / vitesse nouvelle) ;
 * boucle = plage de mesures A–B d'un Mouvement ; curseur = position issue de `cursor.js` (`locate`).
 * BOUCLE : le lecteur ne fait plus de `seek` à chaque tour (trou de 50 à 70 ms, gigue d'une image, début de la mesure suivante entendu en
 * « fantôme ») ; il transmet la plage en secondes au MOTEUR (`engine.setLoop`), qui reboucle sur sa propre horloge, sans trou ni coupure.
 * L'horloge de consultation (`schedule`) est injectée : requestAnimationFrame côté page, manuelle en test.
 */
import { locate, secondsOf } from '../audio/cursor.js';
import { ZERO } from '../model/fraction.js';
import { perf } from '../perf/probe.js';

export const SPEEDS = Object.freeze([25, 50, 75, 100, 125, 150, 200]);

/**
 * @param order  optional `(movement, repeats) → [measure index…]`: the measures in PLAYING order (model/repeatlist.js, cheap and pure). With it, asking
 *               whether a measure is played, or where the loop can start, never builds the audio sequence (which is built only by Play and by the exports).
 */
export function createPlayer({ engine: initialEngine, build, order = null, schedule = null, cancel = null, scope = null } = {}) {
  let engine = initialEngine;
  let sequence = null;
  let speed = 100;
  let repeats = true; // session-wide: false = the music is played straight through, repeats / voltas / jumps ignored (nothing in the Document)
  let loop = null; // { movement, from, to } (indices de mesure, inclus), ou null
  let loopOn = false;
  let dirty = true;
  let timer = null;
  let playLimit = null; // seconds of the sequence where this playback stops (the end of the movement that started it when the movements are not chained)
  const listeners = new Set();

  const emit = () => { const s = state(); for (const l of listeners) l(s); };

  function ensure() {
    if (sequence && !dirty) return sequence;
    const position = sequence ? engine.position() : 0;
    const was = engine.isPlaying();
    sequence = perf.span('sequence:build', () => build(speed / 100, { repeats }));
    dirty = false;
    perf.span('sequence:load', () => engine.load(sequence, { position: Math.min(position, sequence.duration) }));
    syncLoop();
    if (was) engine.play();
    return sequence;
  }

  function loopRange() {
    if (!loop || !loopOn || !sequence) return null;
    // a loop given as SLOTS (the played measures of a recording with repeats): exactly those, whatever the written bars are
    if (Number.isInteger(loop.slotFrom) && Number.isInteger(loop.slotTo) && sequence.slots[loop.slotFrom] && sequence.slots[loop.slotTo]) return { start: sequence.slots[loop.slotFrom].t, end: sequence.slots[loop.slotTo].end };
    const startSlot = sequence.slots.findIndex((s) => s.movement === loop.movement && s.measure === loop.from);
    if (startSlot < 0) return null;
    let endSlot = -1;
    for (let i = startSlot; i < sequence.slots.length; i++) {
      const s = sequence.slots[i];
      if (s.movement === loop.movement && s.measure === loop.to) { endSlot = i; break; }
    }
    if (endSlot < 0) return null;
    return { start: sequence.slots[startSlot].t, end: sequence.slots[endSlot].end };
  }

  /** Transmet au moteur la plage de boucle courante (en secondes de la séquence chargée), ou l'efface. */
  function syncLoop() { engine.setLoop(loopRange()); }

  function poll() {
    if (!sequence) return;
    // La boucle est du ressort du moteur ; ici seulement la fin de séquence (hors boucle).
    if (engine.isPlaying() && (engine.position() >= sequence.duration || (playLimit != null && engine.position() >= playLimit))) { playLimit = null; engine.stop(); }
    perf.span('play:poll', emit); // position → every listener (playhead, follow scroll)
    if (engine.isPlaying()) arm(); else timer = null;
  }

  function arm() { if (schedule && timer == null) timer = schedule(() => { timer = null; poll(); }); }
  function disarm() { if (timer != null && cancel) cancel(timer); timer = null; }

  function state() {
    const position = engine.position();
    return {
      playing: engine.isPlaying(), position, duration: sequence?.duration ?? 0, speed, repeats, loop: loop ? { ...loop } : null, loopOn,
      where: sequence ? locate(sequence, position) : null,
    };
  }

  const api = {
    SPEEDS,
    state,
    /** The sequence being played (read only; null until the first play). */
    sequence: () => sequence,
    /** Abonnement aux changements d'état (position comprise) ; renvoie la fonction de désabonnement. */
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /**
     * À appeler quand le Document a changé : la séquence est reconstruite à la prochaine action (ou tout de suite si la lecture est en cours).
     * La boucle (indices de mesure) est EFFACÉE : après une modification de la musique ou du nombre de mesures elle ne désignerait plus la même chose.
     */
    /**
     * Swaps the audio engine (the user picked another one). What sounds is stopped; the loaded sequence is handed to the new engine at the same
     * position, paused (an engine that needs a user gesture to start would stay silent anyway). The old engine is returned so the caller can free it.
     */
    setEngine(next) {
      if (!next || next === engine) return null;
      const old = engine;
      const position = sequence ? old.position() : 0;
      old.pause?.();
      old.stop?.();
      engine = next;
      if (sequence) { engine.load(sequence, { position: Math.min(position, sequence.duration) }); syncLoop(); }
      emit();
      return old;
    },
    /** Live mixer change (volume, mute, solo): updates the held sequence and the engine, rebuilds nothing and keeps the loop. */
    updateMixer(mixer) {
      if (sequence) for (const t of sequence.tracks ?? []) if (mixer[t.id]) t.mixer = { ...mixer[t.id] };
      engine.setMixer?.(mixer);
    },
    /** The automation changed: the sequence is rebuilt (now if playing, else at the next play) and the loop stays. */
    refresh() {
      dirty = true;
      if (engine.isPlaying()) ensure();
      emit();
    },
    /**
     * Builds the sequence now when the music changed since it was built and nothing is playing, so that the next click on a measure or Play does not wait for it
     * (on a large score it takes 150 to 350 ms). Only once a sequence exists: the very first build stays lazy (it is tied to the first play or seek).
     */
    prepare() {
      if (sequence && dirty && !engine.isPlaying()) ensure();
    },
    invalidate() {
      dirty = true;
      loop = null; loopOn = false;
      if (engine.isPlaying()) { ensure(); }
      if (sequence) syncLoop();
      emit();
    },
    /**
     * Plays. `scope()` (option) tells which movement is the active one (the one the score shows) and whether the movements are chained: a playback
     * that starts outside the active movement goes to its start; when not chained it stops at the end of the movement it started in. `keepPosition`
     * (play from a measure) never moves the playhead.
     */
    play({ keepPosition = false } = {}) {
      ensure();
      const sc = !keepPosition && scope ? scope() : null;
      const moves = sequence.movements ?? [];
      const active = sc ? moves.find((m) => m.index === sc.movement) : null;
      let pos = engine.position();
      if (sequence.duration > 0 && pos >= sequence.duration) { engine.seek(active ? active.t : 0); pos = engine.position(); }
      else if (active && !engine.isPlaying() && !(pos >= active.t && pos < active.end)) { engine.seek(active.t); pos = engine.position(); }
      const here = moves.find((m) => pos >= m.t && pos < m.end);
      playLimit = scope && !(scope()?.chain ?? true) && here ? here.end : null;
      engine.play();
      arm();
      emit();
    },
    /** Plays the stretch [start, end] (seconds of the sequence) and stops there: to hear one bend in its surroundings. Call it straight from the gesture. */
    playSpan(start, end) {
      ensure();
      engine.seek(Math.min(Math.max(0, start), sequence.duration));
      playLimit = Math.min(end, sequence.duration);
      engine.play();
      arm();
      emit();
    },
    /** Plays the stretch `spanOf(sequence)` returns ({ start, end }); false (nothing plays) when it returns null. */
    playWhere(spanOf) {
      ensure();
      const span = spanOf(sequence);
      if (!span) return false;
      api.playSpan(span.start, span.end);
      return true;
    },
    pause() { engine.pause(); disarm(); emit(); },
    stop() { if (!sequence) return; engine.stop(); disarm(); emit(); },
    toggle() { if (engine.isPlaying()) api.pause(); else api.play(); },
    seek(seconds) { ensure(); engine.seek(Math.min(Math.max(0, seconds), sequence.duration)); emit(); },
    /** Place la lecture au début de la `occurrence`-ième exécution d'une mesure (0 = la première). */
    seekToMeasure(movement, measure, occurrence = 0) {
      ensure();
      const s = secondsOf(sequence, movement, measure, ZERO, occurrence);
      if (s != null) api.seek(s);
      return s;
    },
    /** Vitesse d'écoute en %, appliquée à toute la séquence ; la position musicale est conservée. */
    setSpeed(percent) {
      const next = Math.min(300, Math.max(10, Math.round(percent)));
      if (next === speed) return speed;
      const ratio = speed / next;
      const position = sequence ? engine.position() * ratio : 0;
      speed = next;
      if (!sequence) { emit(); return speed; }
      const was = engine.isPlaying();
      if (was) engine.pause();
      sequence = build(speed / 100, { repeats });
      dirty = false;
      engine.load(sequence, { position: Math.min(position, sequence.duration) });
      syncLoop();
      if (was) { engine.play(); arm(); }
      emit();
      return speed;
    },
    /** Repeats on / off for this session (MuseScore "Play repeats"): off = the music as written, once, in order. Keeps the measure under the playhead. */
    setRepeats(on) {
      const next = Boolean(on);
      if (next === repeats) return repeats;
      repeats = next;
      if (!sequence) { emit(); return repeats; }
      const where = locate(sequence, engine.position());
      const was = engine.isPlaying();
      if (was) engine.pause();
      sequence = build(speed / 100, { repeats });
      dirty = false;
      const t = where ? secondsOf(sequence, where.movement, where.measure, where.position, 0) : null;
      engine.load(sequence, { position: Math.min(t ?? 0, sequence.duration) });
      syncLoop();
      if (was) { engine.play(); arm(); }
      emit();
      return repeats;
    },
    repeats: () => repeats,
    /** Palier suivant (+1) ou précédent (−1) de `SPEEDS`. */
    stepSpeed(direction) {
      const i = SPEEDS.findIndex((v) => v >= speed);
      const at = SPEEDS[i] === speed ? i : (direction > 0 ? i - 1 : i);
      const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + direction))];
      return api.setSpeed(next);
    },
    /** Boucle : `setLoop({ movement, from, to })` (indices de mesure, inclus), `null` pour l'effacer ; `toggleLoop` l'active / la coupe. */
    setLoop(range) {
      loop = range ? { movement: range.movement, from: Math.min(range.from, range.to), to: Math.max(range.from, range.to), ...(Number.isInteger(range.slotFrom) && Number.isInteger(range.slotTo) ? { slotFrom: Math.min(range.slotFrom, range.slotTo), slotTo: Math.max(range.slotFrom, range.slotTo) } : {}) } : null;
      if (!loop) loopOn = false; else loopOn = true;
      if (sequence) syncLoop();
      emit();
    },
    toggleLoop(on = !loopOn) { loopOn = Boolean(on) && Boolean(loop); if (sequence) syncLoop(); emit(); },
    /** true si la mesure est jouée au moins une fois (un créneau de la séquence) ; fausse pour une mesure sautée ou hors Mouvement. */
    isPlayed(movement, measure) {
      const list = order?.(movement, repeats);
      if (list) return list.includes(measure);
      ensure();
      return sequence.slots.some((s) => s.movement === movement && s.measure === measure);
    },
    /**
     * Pose le début (`'from'`) ou la fin (`'to'`) de la boucle sur une mesure donnée d'un Mouvement (indice de mesure) — règle de MuseScore 4.7.5
     * (`NotationPlayback::addLoopBoundary`) : le début posé après la fin fait de la fin la DERNIÈRE mesure jouée du Mouvement ; la fin posée avant
     * le début fait du début la PREMIÈRE mesure jouée ; sans boucle (ou boucle d'un autre Mouvement : elle est remplacée), l'autre bord prend ces
     * valeurs par défaut. Une mesure jamais jouée est refusée (null). La boucle est activée.
     */
    markLoopAt(edge, movement, measure) {
      if (!api.isPlayed(movement, measure)) return null;
      const list = order?.(movement, repeats);
      const mine = list ? null : (ensure(), sequence.slots.filter((s) => s.movement === movement));
      const firstPlayed = list ? list[0] : mine[0].measure;
      const lastPlayed = list ? list[list.length - 1] : mine[mine.length - 1].measure;
      const base = loop && loop.movement === movement ? loop : null;
      let next;
      if (edge === 'from') {
        const to = base && measure <= base.to ? base.to : Math.max(measure, lastPlayed);
        next = { movement, from: measure, to };
      } else {
        const from = base && measure >= base.from ? base.from : Math.min(measure, firstPlayed);
        next = { movement, from, to: measure };
      }
      api.setLoop(next);
      return loop;
    },
    /**
     * « Lire d'ici » : place la lecture au début de la mesure (1re passe) et la lance. À appeler SYNCHRONE depuis le geste (AudioContext iPad).
     * Comme `playFromSelection` de MuseScore : si une boucle est active et que le point est hors d'elle, la lecture commence au début de la boucle.
     */
    playFrom(movement, measure, position = ZERO) {
      ensure();
      let s = secondsOf(sequence, movement, measure, position, 0);
      if (s == null) return null;
      const range = loopRange();
      if (range && (s < range.start || s >= range.end)) s = range.start;
      api.seek(s);
      api.play({ keepPosition: true });
      return s;
    },
    sequence: () => sequence,
    destroy() { disarm(); engine.stop(); listeners.clear(); },
    /** Un tour de consultation (public : le minuteur de la page et les tests l'appellent). */
    poll,
  };
  return api;
}
