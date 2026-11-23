/*
 * Contrat du synthé — interface abstraite stable (roadmap §5, « Lecture audio »), décisions de Jean du 08/10/2026.
 * Le reste de l'application n'appelle jamais une bibliothèque audio directement : V1 (petite sous-fonte légère, via Web Audio) puis V2 (le
 * sampleur de Jean, qui prend en charge le mixeur et veut le tempo) implémentent le même contrat sans toucher au lecteur ni au curseur.
 *
 * Trois couches :
 *  A. PARTITION → SÉQUENCE (`sequence.js`, pur) : événements DATÉS en secondes depuis le début de la lecture (le moteur les planifie lui-même
 *     sur sa propre horloge audio, p. ex. `AudioContext.currentTime` en V1 ; ce n'est pas Scorsaire qui appelle `noteOn` à chaque instant).
 *  B. CE CONTRAT : un moteur reçoit une séquence, puis des ordres de transport.
 *  C. TRANSPORT (lecteur) : lecture, pause, arrêt, déplacement, boucle, curseur (`cursor.js`).
 *
 * Séquence (donnée simple, voir `sequence.js`) : { format, version, speed, duration, tracks[], notes[], messages[], tempo, slots[], movements[] }.
 *  - note : { id, track, staff, voice, movement, measure, chord, pitch (MIDI, ou null), sound? (percussion), velocity 1-127 FINALE, t, duration } ;
 *    la vélocité est déjà mise en forme par Scorsaire (règles → profil → piste) : le moteur ne la remappe pas.
 *    Champs facultatifs : `roll` (roulement), `pitchCurve` = [{ t, semitones }] (glissando CONTINU / portamento : dates en secondes de lecture, dans la
 *    même base que `t`, vitesse d'écoute incluse ; `semitones` relatifs à `pitch`, interpolation linéaire ; avant le 1er point = 1er point ; après le
 *    dernier = dernier point jusqu'à la fin de la note). Un moteur qui ne sait pas moduler la hauteur joue la note à `pitch` (ignorer le champ).
 *    Un glissando DISCRET (chromatique, touches blanches / noires, diatonique) n'a pas de champ : ce sont des notes ordinaires, une par pas.
 *  - message libre : { t, track, staff, kind, data, source } — `kind` : 'program' (data: { program }), 'controller' (data: { number, value }),
 *    'keyswitch' (data: { note }), 'sample' (data: { name }), ou toute autre chaîne ; `data` est libre (JSON). Un moteur ignore ce qu'il ne comprend pas.
 *  - tempo : { version, steps: [{ t, wps, bpm }] } — table de tempo en temps JOUÉ (vitesse d'écoute incluse ; `wps` = rondes par seconde, 0 pendant une
 *    pause ; `bpm` = noires par minute). Les notes sont déjà datées en secondes : la table est de l'INFORMATION (synchronisation de modulations,
 *    délais…), pas nécessaire pour jouer.
 *  - tracks : { id, name, instrumentId, family, kind: 'pitched'|'percussion', mixer: { volume, mute, solo } } — réglages transmis tels quels ;
 *    le mixeur lui-même appartient au synthé.
 *
 *  - automation : [{ track, param: 'volume'|'mute', steps: [{ t, value, ramp }] }] — courbes d'automation du mixeur en temps JOUÉ (voir automation.js) : `value` null =
 *    « suivre le curseur », `ramp` 'step' | 'linear' = comment on va de ce pas au suivant ; `mixer[track]` porte `volume` (déjà multiplié par le volume général),
 *    `fader`, `masterFactor`, `mute`, `solo`. Un moteur qui gère lui-même l'automation (un sampleur) lit ces courbes telles quelles ; les moteurs léger et SoundFont
 *    les compilent en une courbe de gain (`compileGain`). Un paramètre inconnu d'un moteur est ignoré.
 *
 * Mises à jour en direct : `updateTempo(table)` et `setMixer(mixer)` sont IDEMPOTENTS et portent leur état complet. Une table de tempo porte un
 * numéro de version : le moteur ignore toute table dont la version n'est pas strictement supérieure à celle qu'il détient (message perdu, doublé
 * ou arrivé dans le désordre sans conséquence) ; Scorsaire renvoie la table entière à chaque `load`.
 *
 * Changer la VITESSE d'écoute (p. ex. 75 %) : Scorsaire reconstruit la séquence avec `speed` et la recharge à la même position musicale
 * (`load(sequence, { position })`) ; le contrat n'a donc pas de « vitesse ».
 *
 * Méthodes :
 *  load(sequence, { position = 0 })  charge (remplace) la séquence ; position de lecture en secondes ; arrête les notes en cours
 *  play()                           démarre ou reprend à la position courante
 *  pause()                          suspend (coupe les notes en cours) ; la position est conservée
 *  stop()                           arrête et revient à 0
 *  seek(seconds)                    déplace la position (lecture en cours ou non) ; coupe les notes en cours
 *  position()                       position de lecture en secondes (horloge du moteur)
 *  isPlaying()                      booléen
 *  updateTempo(table)               voir ci-dessus
 *  setMixer(mixer)                  { [trackId]: { volume, mute, solo } }
 *  sendMessage(message)             message libre immédiat (même forme que ceux de la séquence, sans `t`)
 *  allNotesOff()                    coupe tout
 *  audition(sequence)               joue MAINTENANT les notes d'une mini-séquence `{ tracks, notes }` (les `t` sont ignorés : tout part ensemble, accord compris ; sauf `timed: true`, où chaque note garde son `t`)
 *                                   SANS toucher à la séquence chargée ni au transport (écouter la note qu'on vient de poser, `audition.js`) ; la
 *                                   précédente audition est coupée ; optionnel : un moteur qui ne sait pas le faire l'ignore
 *  liveNoteOn({ pitch, velocity, track }) / liveNoteOff(pitch)
 *                                   une touche tenue au doigt (clavier à l'écran) : la note sonne de `liveNoteOn` à `liveNoteOff`, sans toucher à la séquence
 *                                   chargée ni au transport ; plusieurs touches à la fois ; `track` décrit le timbre ; optionnels (ignorés par un moteur qui ne sait pas)
 *  setLoop(range)                   `{ start, end }` (secondes de lecture, dans la base de la séquence chargée) ou `null` : le MOTEUR reboucle de
 *                                   `end` à `start` sur sa propre horloge, sans trou ni coupure (le lecteur ne fait plus de `seek` à chaque tour).
 *                                   Les notes qui sonnent à la fin ne sont PAS coupées : elles s'éteignent d'elles-mêmes par-dessus le tour
 *                                   suivant (choix de Jean, 11/10/2026 ; MuseScore, lui, vide le synthé au rebouclage : `Clock::forward` →
 *                                   `seekAllTracks(flushSound = true)`). Aucune note datée à `end` ou après n'est jouée dans le tour ;
 *                                   `position()` reste dans [start, end[ pendant la boucle. Sans effet si la lecture commence après `end`.
 *                                   Changer ou retirer la boucle en cours de lecture ne coupe aucun son en cours ; `load` efface la boucle
 *                                   (les dates changent avec la séquence : le lecteur la renvoie après chaque `load`).
 *
 * Vigilance : dessiner le contrat d'après le vocabulaire du MODÈLE (articulations, techniques, percmap…), pas d'après les seules capacités de la
 * bibliothèque V1 — une implémentation ignore ce qu'elle ne sait pas rendre.
 */

export const AUDIO_ENGINE_METHODS = [
  'load', 'play', 'pause', 'stop', 'seek', 'position', 'isPlaying', 'updateTempo', 'setMixer', 'sendMessage', 'allNotesOff', 'setLoop',
];

/** Vérifie qu'un objet respecte le contrat. Lève une erreur sinon. */
export function assertAudioEngine(engine) {
  for (const m of AUDIO_ENGINE_METHODS) {
    if (typeof engine?.[m] !== 'function') throw new Error(`AudioEngine : méthode manquante « ${m} »`);
  }
  return engine;
}

/**
 * Moteur muet à HORLOGE VIRTUELLE (tests, mode sans son) : `advance(secondes)` fait avancer le temps et journalise, dans l'ordre, ce qu'un vrai
 * moteur aurait déclenché (`calls`). Une note qui sonne au moment d'un `seek` n'est pas redémarrée.
 */
export class NullAudioEngine {
  constructor() {
    this.calls = [];
    this.sequence = null;
    this.tempo = null;
    this.mixer = {};
    this._position = 0;
    this._playing = false;
    this._sounding = new Map(); // clé -> { track, pitch, sound, offAt }
    this._loop = null;
  }

  load(sequence, { position = 0 } = {}) {
    this.allNotesOff();
    this.sequence = sequence;
    this.tempo = sequence.tempo;
    this.mixer = Object.fromEntries(sequence.tracks.map((t) => [t.id, { ...t.mixer }]));
    this._position = position;
    this._playing = false;
    this._loop = null;
    this.calls.push({ type: 'load', notes: sequence.notes.length, position });
  }

  play() {
    if (!this.sequence) throw new Error('NullAudioEngine : aucune séquence chargée');
    this._playing = true;
    this.calls.push({ type: 'play', position: this._position });
  }

  pause() {
    this._playing = false;
    this.allNotesOff();
    this.calls.push({ type: 'pause', position: this._position });
  }

  stop() {
    this._playing = false;
    this.allNotesOff();
    this._position = 0;
    this.calls.push({ type: 'stop' });
  }

  seek(seconds) {
    this.allNotesOff();
    this._position = Math.max(0, seconds);
    this.calls.push({ type: 'seek', position: this._position });
  }

  position() { return this._position; }

  isPlaying() { return this._playing; }

  updateTempo(table) {
    const accepted = !this.tempo || table.version > this.tempo.version;
    if (accepted) this.tempo = table;
    this.calls.push({ type: 'updateTempo', version: table.version, accepted });
    return accepted;
  }

  setMixer(mixer) {
    this.mixer = mixer;
    this.calls.push({ type: 'setMixer' });
  }

  sendMessage(message) {
    this.calls.push({ type: 'message', t: this._position, ...message });
  }

  /** Records the audition (nothing sounds). */
  audition(sequence) { this.calls.push({ type: 'audition', notes: sequence.notes.length }); }
  stopAudition() { this.calls.push({ type: 'stopAudition' }); }

  allNotesOff() {
    if (this._sounding.size) this.calls.push({ type: 'allNotesOff', count: this._sounding.size });
    this._sounding.clear();
  }

  setLoop(range) {
    this._loop = range && range.end > range.start ? { start: range.start, end: range.end } : null;
    this.calls.push({ type: 'setLoop', loop: this._loop });
  }

  /** Fait avancer l'horloge virtuelle de `seconds` (si la lecture est en cours) et journalise les déclenchements ; fenêtre [début, fin[ : un événement daté exactement à la position courante part au prochain `advance`. */
  advance(seconds) {
    if (!this._playing || !this.sequence) return;
    let left = seconds;
    // Boucle : on traite la fenêtre jusqu'à la fin, on revient au début SANS couper (les notes en cours sonnent par-dessus), puis on continue.
    while (this._loop && this._position < this._loop.end && this._position + left >= this._loop.end) {
      const used = this._loop.end - this._position;
      this._advanceWindow(used, this._loop.end);
      left -= used;
      this.calls.push({ type: 'loop', from: this._loop.end, to: this._loop.start });
      for (const [key, s] of this._sounding) {
        this.calls.push({ type: 'noteOff', t: s.offAt, track: s.track, pitch: s.pitch, sound: s.sound, tail: true });
        this._sounding.delete(key);
      }
      this._position = this._loop.start;
    }
    this._advanceWindow(left);
  }

  _advanceWindow(seconds, cap = Infinity) {
    const from = this._position;
    const to = from + seconds;
    const inWindow = (x) => x >= from && x < to && x < cap;
    const due = [];
    this.sequence.notes.forEach((n, i) => {
      const key = `${i}`;
      const offAt = n.t + n.duration;
      const starts = inWindow(n.t);
      if (starts) due.push({ at: n.t, order: 1, n, key });
      if (inWindow(offAt) && (starts || this._sounding.has(key))) due.push({ at: offAt, order: 0, off: key, n });
    });
    for (const m of this.sequence.messages) if (inWindow(m.t)) due.push({ at: m.t, order: 1, m });
    due.sort((a, b) => a.at - b.at || a.order - b.order);
    for (const d of due) {
      if (d.off !== undefined) {
        this._sounding.delete(d.off);
        this.calls.push({ type: 'noteOff', t: d.at, track: d.n.track, pitch: d.n.pitch, sound: d.n.sound });
      } else if (d.m) {
        this.calls.push({ type: 'message', t: d.at, track: d.m.track, kind: d.m.kind, data: d.m.data });
      } else {
        const { n } = d;
        this._sounding.set(d.key, { track: n.track, pitch: n.pitch, sound: n.sound, offAt: n.t + n.duration });
        this.calls.push({ type: 'noteOn', t: n.t, track: n.track, pitch: n.pitch, sound: n.sound, velocity: n.velocity });
      }
    }
    this._position = to;
  }
}
