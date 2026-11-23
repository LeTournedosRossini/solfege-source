/*
 * Nuances — vocabulaire complet de MuseScore 4.7.5 (`dom/dynamic.cpp` DYN_LIST, `types/typesconv.cpp`, `playback/utils/expressionutils.h`;
 * tous lus, voir le doc du projet `claude/tranche-nuances-hauteur-sonnante.md`).
 *
 * `PID.DYNAMIC` d'un accord = l'une des 32 étiquettes de MuseScore (`DYNAMIC_TYPES`) ou 'other' (texte libre, `PID.DYNAMIC_TEXT`).
 * AFFICHAGE : `DYNAMIC_DISPLAY` (généré par `tools/extract-dynamics.py` : suite de symboles de MuseScore mise en forme par la police Bravura
 * avec ses ligatures — `pf` a un glyphe unique ; `sff`, `sfff`, `sfffz` en ont plusieurs, la police n'a pas de ligature pour eux).
 * LECTURE : `DEFAULT_DYNAMIC_PLAYBACK` = règle PAR DÉFAUT de chaque nuance (celle de MuseScore) ; ce n'est qu'une table de données, que
 * l'utilisateur pourra remplacer (décision de Jean, 08/10/2026) — voir `dynamicPlayback`.
 */
import { DYNAMIC_DISPLAY, DYNAMIC_SYMBOLS } from './dynamics-data.js';

export { DYNAMIC_DISPLAY, DYNAMIC_SYMBOLS };

/** Les 32 types de MuseScore (ordre de `DYN_LIST`), puis 'other' (texte libre). */
export const DYNAMIC_TYPES = Object.freeze([...Object.keys(DYNAMIC_DISPLAY), 'other']);

/** Portée d'application d'une nuance ou d'un soufflet (MuseScore `VoiceAssignment`, `types.h`) : tout l'instrument (défaut de MuseScore,
 * `Pid::VOICE_ASSIGNMENT` de `Dynamic` et `Hairpin`), les voix de la portée, ou la voix seule. */
export const VOICE_ASSIGNMENTS = Object.freeze(['instrument', 'staff', 'voice']);

/** Glyphes Bravura d'une nuance ([] pour 'other' et un type inconnu). */
export const dynamicGlyphs = (type) => DYNAMIC_DISPLAY[type] ?? [];

/*
 * Règles de lecture par défaut = `expressionutils.h` : niveaux nommés par le type MPE (`mpetypes.h`) ; la valeur numérique (0-10000) est
 * l'affaire du code de lecture. kind : 'level' (ordinaire : fixe le niveau jusqu'à la nuance suivante), 'single' (une seule note),
 * 'compound' (de `from` à `to`), 'none' (aucun effet : m, r, s, z, fz, other). Vérifié : `Dynamic::velocity()` / `changeInVelocity()` ne
 * sont pas lus par la chaîne MPE de lecture.
 */
const level = (l) => ({ kind: 'level', level: l });
const single = (l) => ({ kind: 'single', level: l });
const compound = (from, to) => ({ kind: 'compound', from, to });
const none = { kind: 'none' };

export const DEFAULT_DYNAMIC_PLAYBACK = Object.freeze({
  n: level('ppppppppp'), pppppp: level('pppppp'), ppppp: level('ppppp'), pppp: level('pppp'), ppp: level('ppp'), pp: level('pp'), p: level('p'),
  mp: level('mp'), mf: level('mf'), f: level('f'), ff: level('ff'), fff: level('fff'), ffff: level('ffff'), fffff: level('fffff'), ffffff: level('ffffff'),
  sf: single('f'), sfz: single('f'), sff: single('ff'), sffz: single('ff'), sfff: single('fff'), sfffz: single('fff'), rfz: single('f'), rf: single('f'),
  fp: compound('f', 'p'), pf: compound('p', 'f'), sfp: compound('f', 'p'), sfpp: compound('f', 'pp'),
  m: none, r: none, s: none, z: none, fz: none, other: none,
});

/** Règle de lecture d'une nuance : `overrides[type]` (table de l'utilisateur) sinon la règle par défaut ; 'none' pour un type inconnu. */
export function dynamicPlayback(type, overrides = null) {
  return overrides?.[type] ?? DEFAULT_DYNAMIC_PLAYBACK[type] ?? none;
}
