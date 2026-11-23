/*
 * Percmap (percussion, tranches 5 et 6b ; UNIFIÉE le 05/10/2026 sur demande de Jean) — correspondance « son → apparence sur la portée » de
 * TOUTE portée de percussion à son indéterminé : batterie, percussions à main, percussions d'orchestre… Un seul type de portée (`percussion`)
 * et une seule propriété (`PID.PERCMAP`) ; ce qui change d'un instrument à l'autre, c'est la carte choisie (préréglages : `percmapPresets`).
 * (Avant : `PID.DRUMMAP` pour la batterie, `PID.PERCMAP` + type `handPercussion` pour les percussions à main — fichiers migrés en v13.)
 *
 * Décisions de Jean (04/10/2026) : tout est défini par un NOM ANGLAIS (identifiants et noms de sons) ; les menus seulement sont traduits
 * (catalogue i18n, clé `drum.sound.<id>`). La note ne stocke que l'IDENTIFIANT du son (`PID.SOUND`, ex. `closedHiHat`) ; la percmap de sa portée
 * (`PID.PERCMAP`, objet complet, auto-suffisant dans le fichier) donne tête, ligne, voix, sens de hampe et n° MIDI. Renommer un son
 * n'affecte aucune note (le nom est une étiquette). `PID.PERCMAP` nul = percmap par défaut de Scorsaire (`DEFAULT_PERCMAP`).
 *
 * Un son : { id, name, midi, head, line, voice, stemDirection }
 *   id             identifiant stable (camelCase, unique dans la percmap)
 *   name           nom anglais affiché
 *   midi           n° MIDI 0–127 (import/export MuseScore, entrée MIDI) ou null (son sans numéro)
 *   head           groupe de têtes (`drumheads.js` : normal, cross, xcircle…) ou glyphe SMuFL personnalisé
 *   line           position en DEMI-INTERLIGNES depuis la ligne du HAUT (convention MuseScore `DrumInstrument::line` : 0 = ligne du haut
 *                  d'une portée, 8 = ligne du bas d'une portée à 5 lignes, négatif = au-dessus) — indépendante du nombre de lignes
 *   voice          voix par défaut du son (0 = voix 1) : sert au geste de saisie (étape 5) ; la voix d'une note est celle de son accord
 *   stemDirection  'up' | 'down' | 'auto' : sens de hampe imposé par défaut à l'accord de ce son (réglable par l'utilisateur, et par accord
 *                  via PID.STEM_DIRECTION). 'auto' = suit la parité de la voix (voix 1, 3 en haut ; 2, 4 en bas).
 *
 * Les kits de MuseScore 4.7.5 (107 kits, dont « Drum Kit (large) » et Bongos) sont proposés comme modèles (`drumKitCatalog`, extrait de
 * `instruments.xml` par tools/extract-drumkits.py) ; le kit par défaut de Scorsaire en diffère (ordre, sens de hampe explicites).
 * Éditeur de percmap personnalisée : opérations pures ci-dessous + import/export JSON (`exportPercMap` / `importPercMap`).
 */
import catalog from './drumkit-catalog.json' with { type: 'json' };
import standards from './drummap-standards.json' with { type: 'json' };
import { isDrumHead } from './drumheads.js';

export const DRUM_STEM_DIRECTIONS = ['auto', 'up', 'down'];
export const PERCMAP_FORMAT = 'scorsaire-percmap';
/** Ancien format (avant l'unification) : toujours LU à l'import ({ format, version, drummap }), jamais écrit. */
export const LEGACY_DRUMMAP_FORMAT = 'scorsaire-drummap';
export const PERCMAP_VERSION = 1;

export function createDrumSound({ id, name, midi = null, midiAlso, head = 'normal', line, voice = 0, stemDirection = 'auto', names }) {
  const sound = { id, name, midi, head, line, voice, stemDirection };
  // autres n° MIDI du même son (le nom du son est son identité ; un même son peut avoir plusieurs numéros selon les banques) : facultatif
  if (Array.isArray(midiAlso) && midiAlso.length) sound.midiAlso = [...midiAlso];
  if (names && Object.keys(names).length) sound.names = { ...names }; // noms PERSONNALISÉS par langue (stockés, exportés, importés avec la carte)
  return sound;
}

/**
 * Nom affiché d'un son (légende, menus). Ordre : nom personnalisé de la carte dans la langue demandée (`names[lang]`) > pour l'anglais, le nom
 * anglais de la carte (`name`) > traduction du catalogue de l'interface (`translate(id)`, peut renvoyer undefined) > nom anglais.
 */
export function soundDisplayName(sound, { lang = 'en', translate } = {}) {
  const custom = sound.names?.[lang];
  if (custom) return custom;
  if (lang === 'en') return sound.name;
  return translate?.(sound.id) ?? sound.name;
}

export function createPercMap({ name = 'Custom drum map', sounds = [], switches } = {}) {
  const map = { name, sounds: sounds.map(createDrumSound) };
  if (Array.isArray(switches)) map.switches = switches.map((g) => ({ id: g.id, sounds: [...g.sounds] }));
  return map;
}

// ---------- catalogue MuseScore ----------

/** Les kits de MuseScore (modèles) : [{ id, name, family, lines, clef, sounds: [{ id, name, midi, head, line, voice, stem }] }]. */
export function drumKitCatalog() {
  return catalog.kits;
}

export function drumKitInfo(id) {
  return catalog.kits.find((k) => k.id === id) ?? null;
}

/**
 * Percmap (copie indépendante) d'un kit de MuseScore, dans l'ordre de MuseScore (n° MIDI croissant). `stem` de MuseScore (haut / bas / absent)
 * devient `stemDirection`. Renvoie aussi le nombre de lignes conseillé par le kit (`lines`) via `drumKitInfo`.
 */
export function percMapFromKit(kitId) {
  const kit = drumKitInfo(kitId);
  if (!kit) throw new Error(`Kit de percussion inconnu : ${kitId}`);
  return createPercMap({
    name: kit.name,
    sounds: kit.sounds.map((s) => ({ id: s.id, name: s.name, midi: s.midi, head: s.head, line: s.line, voice: s.voice, stemDirection: s.stem })),
  });
}

// ---------- percmap par défaut de Scorsaire ----------

const S = (id, name, midi, head, line, voice, stemDirection) => ({ id, name, midi, head, line, voice, stemDirection });

/**
 * Percmap par défaut (portée à 5 lignes). Même jeu de 23 sons que « Drum Kit (large) » de MuseScore, mais classé comme Scorsaire le veut :
 * sur chaque ligne le son d'accès direct (clic) est le PREMIER de la liste — la ride (ligne du haut) avant le high tom ; le sens de hampe est
 * explicite pour chaque son. Remplacé le 21/10/2026 par le kit exporté par Jean (`ScorsaireDrumkit.json`), puis le 23/10/2026 par `carte-percussion-Scorsaire-defaut.json` (side stick = croix, cymbales et lignes révisées).
 */
export const DEFAULT_PERCMAP = createPercMap({
  name: 'Scorsaire Drum Kit',
  sounds: [
    S('splashCymbal', 'Splash Cymbal', 55, 'ti', -2, 0, 'up'),
    S('crashCymbal1', 'Crash Cymbal 1', 49, 'diamond', -2, 0, 'up'),
    S('crashCymbal2', 'Crash Cymbal 2', 57, 'la', -3, 0, 'up'),
    S('chinaCymbal', 'China Cymbal', 52, 'noteheadHeavyXHat', -3, 0, 'up'),
    S('closedHiHat', 'Closed Hi-Hat', 42, 'cross', -1, 0, 'up'),
    S('openHiHat', 'Open Hi-Hat', 46, 'xcircle', -1, 0, 'up'),
    S('rideCymbal1', 'Ride Cymbal 1', 51, 'cross', -2, 0, 'up'),
    S('rideBell', 'Ride Bell', 53, 'triangle-down', -2, 0, 'up'),
    S('highTom', 'High Tom', 50, 'circle-dot', 1, 1, 'down'),
    S('hiMidTom', 'Hi-Mid Tom', 48, 'circle-dot', 3, 1, 'down'),
    S('tambourine', 'Tambourine', 54, 'diamond', 1, 0, 'up'),
    S('cowbell', 'Cowbell', 56, 'triangle-down', 1, 0, 'up'),
    S('lowMidTom', 'Low-Mid Tom', 47, 'circle-dot', 5, 1, 'down'),
    S('rideCymbal2', 'Ride Cymbal 2', 59, 'cross', -2, 0, 'up'),
    S('acousticSnare', 'Acoustic Snare', 38, 'normal', 4, 1, 'down'),
    S('sideStick', 'Side Stick', 37, 'cross', 4, 1, 'down'),
    S('electricSnare', 'Electric Snare', 40, 'normal', 4, 1, 'down'),
    S('lowTom', 'Low Tom', 45, 'circle-dot', 9, 1, 'down'),
    S('highFloorTom', 'High Floor Tom', 43, 'circle-dot', 7, 0, 'up'),
    S('lowFloorTom', 'Low Floor Tom', 41, 'circle-dot', 6, 0, 'up'),
    S('bassDrum1', 'Bass Drum 1', 36, 'normal', 9, 1, 'down'),
    S('bassDrum2', 'Bass Drum 2', 35, 'normal', 10, 1, 'down'),
    S('pedalHiHat', 'Pedal Hi-Hat', 44, 'cross', 9, 1, 'down'),
  ],
});

// ---------- percmap par défaut (percussion à main) ----------

// ids anglais propres pour quelques sons dont l'extraction du catalogue MuseScore a perdu un caractère accentué (Agogô, Güiro)
const PERC_ID_FIXES = { hiAgog: 'hiAgogo', loAgog: 'loAgogo', shortGIro: 'shortGuiro', longGIro: 'longGuiro' };
const HAND_EXCLUDED = new Set(['closedHiHat', 'pedalHiHat', 'openHiHat', 'rideCymbal', 'stickClick', 'bassDrum', 'snareRim', 'snare', 'splashCymbal', 'suspendedCymbal', 'handCymbals', 'vibraslap']);
/** Percmap par défaut (portée de percussion à main, 5 lignes) : les sons à main du kit « Mixed Percussion » de MuseScore (congas, bongos, timbales,
 * agogôs, cloche, claves, woodblocks, tambourin, shakers, triangle…), positions et têtes de MuseScore, ordonnés de haut en bas. À affiner avec Jean. */
export const HAND_PERCUSSION_PERCMAP = (() => {
  const kit = drumKitInfo('percussion');
  const sounds = kit.sounds.filter((s) => !HAND_EXCLUDED.has(s.id))
    .map((s) => ({ id: PERC_ID_FIXES[s.id] ?? s.id, name: s.name, midi: s.midi, head: s.head, line: s.line, voice: s.voice, stemDirection: s.stem }))
    .sort((a, b) => a.line - b.line);
  return createPercMap({ name: 'Scorsaire Hand Percussion', sounds });
})();

/**
 * Entry switches of the drum kit (Jean, 21/10/2026): several sounds that share one place of the staff are chosen by a cyclic button of the entry bar. The
 * first sound of a switch is the default. Tapping a staff line whose sound belongs to a switch writes the switch's CURRENT sound (which may sit on another line:
 * the side stick is not on the snare line). A switch is offered only when the staff's map has at least two of its sounds.
 */
export const MAX_SWITCHES = 8;
export const MAX_SWITCH_SOUNDS = 6;
export const DRUM_SWITCHES = Object.freeze([
  { id: 'bass', sounds: ['bassDrum1', 'pedalHiHat', 'lowTom'] },
  { id: 'snare', sounds: ['acousticSnare', 'sideStick'] },
  { id: 'ride', sounds: ['rideCymbal1', 'crashCymbal1'] },
  { id: 'hat', sounds: ['closedHiHat', 'openHiHat'] },
]);

/** The switches usable with `percmap` : [{ id, sounds (those present in the map, switch order) }]. */
export function drumSwitchesFor(percmap) {
  const ids = new Set(percmap.sounds.map((x) => x.id));
  return (percmap.switches ?? DRUM_SWITCHES).map((g) => ({ id: g.id, sounds: g.sounds.filter((x) => ids.has(x)) })).filter((g) => g.sounds.length >= 2);
}

/** Jeu de sons d'une portée de percussion : sa percmap, ou celle par défaut de Scorsaire (`DEFAULT_PERCMAP`). */
export function staffSoundMap(percmapProp) {
  return percmapProp ?? DEFAULT_PERCMAP;
}
export const isPercussionType = (t) => t === 'percussion';

/** A GHOST note of the drum grid is a hit whose sound id carries this suffix (`acousticSnare~ghost`): the sound of the map, written with parentheses (`PID.GHOST`). */
export const GHOST_SUFFIX = '~ghost';
export const isGhostSound = (id) => typeof id === 'string' && id.endsWith(GHOST_SUFFIX);
export const baseSoundOf = (id) => (isGhostSound(id) ? id.slice(0, -GHOST_SUFFIX.length) : id);

// ---------- préréglages ----------

/**
 * Préréglages proposés à l'utilisateur pour une portée de percussion (menu « jeu de sons » : une percmap = un préréglage choisi, puis modifiable).
 * Ordre : les cartes de Scorsaire (batterie, percussions à main), puis TOUS les kits de MuseScore 4.7.5 (batterie, percussions d'orchestre : caisse
 * claire, grosse caisse, toms de concert, timbales, cymbales, triangle, blocs de bois…, percussions du monde, corps), classés par `family`.
 * Chaque entrée : { id, name, family, lines (nombre de lignes conseillé), source: 'scorsaire'|'musescore', create() → percmap indépendante }.
 */
export function percmapPresets() {
  const own = [
    { id: 'scorsaire-drum-kit', name: DEFAULT_PERCMAP.name, family: 'drums', lines: 5, source: 'scorsaire', create: () => createPercMap(DEFAULT_PERCMAP) },
    { id: 'scorsaire-hand-percussion', name: HAND_PERCUSSION_PERCMAP.name, family: 'drums', lines: 5, source: 'scorsaire', create: () => createPercMap(HAND_PERCUSSION_PERCMAP) },
  ];
  // carte standard d'échange : celle que MuseScore applique à l'import de Guitar Pro (numéros General MIDI → tête et ligne), voir `tools/extract-gp-drumset.py`
  const gp = { id: 'standard:guitar-pro', name: 'Guitar Pro / General MIDI', family: 'drums', lines: 5, source: 'standard',
    create: () => createPercMap({ name: 'Guitar Pro / General MIDI', sounds: standards.gpDrumset.map((s) => ({ id: s.id, name: s.name, midi: s.midi, head: s.head, line: s.line, voice: s.voice, stemDirection: s.stem })) }) };
  return [...own, gp, ...catalog.kits.map((k) => ({ id: `musescore:${k.id}`, name: k.name, family: k.family, lines: k.lines, source: 'musescore', create: () => percMapFromKit(k.id) }))];
}

/** Un préréglage par identifiant (voir `percmapPresets`), ou null. */
export function percmapPreset(id) {
  return percmapPresets().find((p) => p.id === id) ?? null;
}

// ---------- lecture ----------

const indexCache = new WeakMap();

/** Percmap d'une portée (la sienne, ou celle par défaut de Scorsaire). `staff.props.percmap` lu sans styles : objet complet ou absent. */
export function resolvePercmapOf(percmapProp) {
  return percmapProp ?? DEFAULT_PERCMAP;
}

/** Index id → son d'une percmap (mémoïsé par objet : une modification remplace l'objet, jamais de mutation en place). */
export function drumIndex(percmap) {
  let idx = indexCache.get(percmap);
  if (!idx) {
    idx = new Map();
    for (const s of percmap.sounds) if (!idx.has(s.id)) idx.set(s.id, s);
    indexCache.set(percmap, idx);
  }
  return idx;
}

export function drumSound(percmap, id) {
  return drumIndex(percmap).get(id) ?? null;
}

/** Premier son de la percmap portant ce n° MIDI (entrée MIDI, import MuseScore), ou null. */
export function drumSoundForMidi(percmap, midi) {
  return percmap.sounds.find((s) => s.midi === midi) ?? percmap.sounds.find((s) => s.midiAlso?.includes(midi)) ?? null;
}

/**
 * Vue « par position » (ligne par ligne, de haut en bas) : les sons d'une même ligne dans l'ordre de la liste ; le premier est l'accès
 * direct (clic), les suivants passent par le bouton cyclique (roadmap). `rule: 'musescore'` applique plutôt `Drumset::defaultPitchForLine`
 * (1er son à tête « normal » par n° MIDI croissant, sinon le 1er) pour proposer les kits de MuseScore tels que MuseScore les ordonne.
 */
export function drumPositions(percmap, { rule = 'list' } = {}) {
  const byLine = new Map();
  for (const s of percmap.sounds) {
    if (!byLine.has(s.line)) byLine.set(s.line, []);
    byLine.get(s.line).push(s);
  }
  return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([line, sounds]) => {
    if (rule === 'musescore') {
      const byMidi = [...sounds].sort((a, b) => (a.midi ?? 1e9) - (b.midi ?? 1e9));
      const firstNormal = byMidi.find((s) => s.head === 'normal');
      return { line, sounds: firstNormal ? [firstNormal, ...byMidi.filter((s) => s !== firstNormal)] : byMidi };
    }
    return { line, sounds };
  });
}

/** Position verticale (repère de portée : 0 = ligne du bas, y vers le haut) d'une ligne de percmap sur une portée à `lineCount` lignes. */
export function drumLineToY(line, lineCount = 5) {
  return (lineCount - 1) - line / 2;
}

// ---------- validation, édition, import / export ----------

/** Liste des problèmes d'une percmap (vide = valide). */
export function validatePercMap(map) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['percmap : objet attendu'];
  if (typeof map.name !== 'string' || !map.name) errors.push('percmap : nom manquant');
  if (!Array.isArray(map.sounds)) return [...errors, 'percmap : liste de sons manquante'];
  const ids = new Set();
  map.sounds.forEach((s, i) => {
    const where = `son ${i + 1}${s && typeof s.id === 'string' ? ` (« ${s.id} »)` : ''}`;
    if (!s || typeof s !== 'object') { errors.push(`${where} : objet attendu`); return; }
    if (typeof s.id !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(s.id)) errors.push(`${where} : identifiant invalide (lettres et chiffres, commence par une lettre)`);
    else if (ids.has(s.id)) errors.push(`${where} : identifiant en double`);
    else ids.add(s.id);
    if (typeof s.name !== 'string' || !s.name) errors.push(`${where} : nom manquant`);
    if (s.names !== undefined && (!s.names || typeof s.names !== 'object' || Array.isArray(s.names)
      || Object.entries(s.names).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9-]{0,15}$/.test(k) || typeof v !== 'string' || !v.trim() || v.length > 60))) errors.push(`${where} : noms personnalisés invalides (objet langue → texte de 1 à 60 caractères)`);
    if (s.midi !== null && !(Number.isInteger(s.midi) && s.midi >= 0 && s.midi <= 127)) errors.push(`${where} : n° MIDI invalide (0–127 ou null)`);
    if (s.midiAlso !== undefined && (!Array.isArray(s.midiAlso) || s.midiAlso.some((m) => !(Number.isInteger(m) && m >= 0 && m <= 127))
      || new Set(s.midiAlso).size !== s.midiAlso.length || s.midiAlso.includes(s.midi))) errors.push(`${where} : autres n° MIDI invalides (liste d'entiers 0–127, sans doublon, sans le n° principal)`);
    if (!isDrumHead(s.head)) errors.push(`${where} : tête inconnue « ${s.head} »`);
    if (!Number.isInteger(s.line) || s.line < -20 || s.line > 30) errors.push(`${where} : ligne invalide (entier de −20 à 30)`);
    if (!Number.isInteger(s.voice) || s.voice < 0 || s.voice > 3) errors.push(`${where} : voix invalide (0 à 3)`);
    if (!DRUM_STEM_DIRECTIONS.includes(s.stemDirection)) errors.push(`${where} : sens de hampe invalide (auto, up, down)`);
  });
  if (map.switches !== undefined) {
    const groups = map.switches;
    if (!Array.isArray(groups) || groups.length > MAX_SWITCHES) errors.push(`boutons de saisie : liste de ${MAX_SWITCHES} groupes au plus attendue`);
    else {
      const seen = new Set();
      groups.forEach((g, i) => {
        const where = `bouton de saisie ${i + 1}`;
        if (!g || typeof g.id !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(g.id) || seen.has(g.id)) { errors.push(`${where} : identifiant invalide ou en double`); return; }
        seen.add(g.id);
        if (!Array.isArray(g.sounds) || g.sounds.length < 2 || g.sounds.length > MAX_SWITCH_SOUNDS || new Set(g.sounds).size !== g.sounds.length || g.sounds.some((x) => !ids.has(x))) errors.push(`${where} : 2 à ${MAX_SWITCH_SOUNDS} sons distincts de la carte attendus`);
      });
    }
  }
  return errors;
}

/** Texte JSON d'une percmap (fichier à échanger entre partitions). */
export function exportPercMap(map) {
  const errors = validatePercMap(map);
  if (errors.length) throw new Error(`Percmap invalide : ${errors[0]}`);
  return JSON.stringify({ format: PERCMAP_FORMAT, version: PERCMAP_VERSION, percmap: map }, null, 2);
}

/**
 * Lit un fichier de percmap (texte ou objet) ; refuse tout ce qui n'est pas valide (jamais de réparation silencieuse).
 * Accepte aussi l'ANCIEN format `scorsaire-drummap` (carte sous la clé `drummap`) : même structure, lue telle quelle.
 */
export function importPercMap(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error('Fichier de percmap illisible (JSON invalide)'); }
  }
  const legacy = data?.format === LEGACY_DRUMMAP_FORMAT;
  if (!data || (data.format !== PERCMAP_FORMAT && !legacy)) throw new Error('Ce fichier n\'est pas une percmap Scorsaire');
  if (data.version > PERCMAP_VERSION) throw new Error(`Percmap de version ${data.version}, plus récente que celle supportée (${PERCMAP_VERSION})`);
  const map = legacy ? data.drummap : data.percmap;
  const errors = validatePercMap(map);
  if (errors.length) throw new Error(`Percmap invalide : ${errors[0]}`);
  return createPercMap(map);
}

// Opérations d'édition : PURES (renvoient une nouvelle percmap) ; l'appelant les range avec
// `doc.transaction('…', () => doc.set(staff, PID.PERCMAP, nouvelle))`.

export function addDrumSound(map, sound) {
  return { ...map, sounds: [...map.sounds, createDrumSound(sound)] };
}

export function updateDrumSound(map, id, changes) {
  if (!drumSound(map, id)) throw new Error(`Son inconnu : ${id}`);
  const next = { ...map, sounds: map.sounds.map((s) => (s.id === id ? { ...s, ...changes, id: changes.id ?? s.id } : s)) };
  if (changes.id && changes.id !== id && map.switches) next.switches = map.switches.map((g) => ({ ...g, sounds: g.sounds.map((x) => (x === id ? changes.id : x)) }));
  return next;
}

export function removeDrumSound(map, id) {
  const next = { ...map, sounds: map.sounds.filter((s) => s.id !== id) };
  if (map.switches) next.switches = map.switches.map((g) => ({ ...g, sounds: g.sounds.filter((x) => x !== id) })).filter((g) => g.sounds.length >= 2);
  return next;
}

/** The map with its entry buttons set (`null` = back to the default groups). Groups with fewer than two sounds are dropped. */
export function withDrumSwitches(map, switches) {
  const { switches: _old, ...rest } = map;
  if (switches == null) return rest;
  return { ...rest, switches: switches.map((g) => ({ id: g.id, sounds: [...g.sounds] })).filter((g) => g.sounds.length >= 2) };
}

/** Déplace un son dans la liste (ordre = priorité d'accès direct sur sa ligne). */
export function moveDrumSound(map, id, toIndex) {
  const from = map.sounds.findIndex((s) => s.id === id);
  if (from < 0) throw new Error(`Son inconnu : ${id}`);
  const sounds = [...map.sounds];
  const [s] = sounds.splice(from, 1);
  sounds.splice(Math.max(0, Math.min(toIndex, sounds.length)), 0, s);
  return { ...map, sounds };
}
