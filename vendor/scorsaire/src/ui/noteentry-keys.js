/*
 * Saisie de notes AU CLAVIER — correspondance touche → action. PUR (aucun DOM) : testé sous Node ; `ui/dom.js` ne fait que brancher l'écouteur.
 *
 * Table de MuseScore 4.7.5 (`src/app/configs/data/shortcuts.xml` et `shortcuts_azerty.xml`, lus) :
 *  A-G (B aussi sur H) : note · Maj + lettre : ajoute à l'accord sélectionné · 0 : silence · 1 à 7 : 64e, 32e, 16e, croche, noire, blanche, ronde ·
 *  . : point · Q / W : durée moitié / double · + = - : dièse, bécarre, bémol · ↑ ↓ : demi-ton · Ctrl + ↑ ↓ : octave · ← → : accord précédent /
 *  suivant · Ctrl + ← → : mesure précédente / suivante · Suppr / Retour arrière : supprimer · Ctrl + Alt + 1-4 : voix · N : mode saisie · Échap : sortir.
 * On lit `event.key`, JAMAIS `event.code` : sur un clavier AZERTY les chiffres demandent Maj ; on accepte donc aussi les caractères de la rangée
 * du haut sans Maj (& é " ' ( è à pour 1 2 3 4 5 7 0 ; `-` reste le bémol, comme dans la table AZERTY de MuseScore où il est en conflit avec 6).
 * Tablature (option `tabKeyboard`, comme MuseScore `fret-0..9` / `string-above` / `string-below`) : 0-9 et A-K (A = 0 … K = 9, sans I) = frette sur la corde
 * COURANTE, ↑ ↓ = corde au-dessus / en dessous, ; = silence ; Maj + lettre : ajoute à l'accord sélectionné ; la durée se règle avec Q / W, le point et la barre.
 * T : liaison de prolongation.
 * STYLE « Guitar Pro » (`tabStyle: 'guitarpro'`, réglage d'appareil `inputOptions.tabKeyStyle`, 12/11/2026, d'après la documentation de Guitar Pro 8) : sur une tablature les chiffres sont des frettes
 * SANS avancer (le curseur reste : une autre corde + une frette = un accord, → avance) et deux chiffres de suite tapés assez vite font une frette à deux chiffres (`guitarPro: true`,
 * assemblés par `ui/dom.js`) ; R = silence, L = liaison, + / - = durée plus courte / plus longue (`-` lu par `event.code` : sur un clavier AZERTY la touche `-` non décalée est le 6) ;
 * Tab / Maj + Tab = portée suivante / précédente, Début = début de mesure, Ctrl + Début = première mesure (sur toute portée, la saisie étant active). Les lettres A-K ne sont plus des frettes.
 * Percussion : W X C V Q S D = sons de batterie (`DRUM_KEYS`). Non faits : mode insertion, Maj + Q/W (pointée), saisie de la hauteur par le piano.
 */
import { isTextEditingTarget } from './undoredo.js';

const LETTERS = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6, h: 6 };
const DURATIONS = { 1: 'sixtyfourth', 2: 'thirtysecond', 3: 'sixteenth', 4: 'eighth', 5: 'quarter', 6: 'half', 7: 'whole' };
/**
 * Touches de batterie (choix de Jean, 12/10/2026, clavier AZERTY) : identifiants de la carte « Scorsaire Drum Kit ». Une carte qui n'a pas le son
 * donne le message « son absent » (rien n'est posé). Les trois toms (Q S D) = tom aigu, tom médium, tom basse : À CONFIRMER avec Jean.
 */
export const DRUM_KEYS = { w: 'bassDrum1', x: 'acousticSnare', c: 'closedHiHat', v: 'crashCymbal1', q: 'highTom', s: 'hiMidTom', d: 'highFloorTom' };
// rangée de chiffres d'un clavier AZERTY, sans Maj
const AZERTY_DIGITS = { '&': '1', 'é': '2', '"': '3', "'": '4', '(': '5', 'è': '7', 'à': '0' };

/** Action de saisie pour un événement clavier, ou null (la touche n'est pas pour nous). */
const TAB_LETTERS = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, j: 8, k: 9 };
// rangée de chiffres AZERTY (sans Maj) pour la tablature : & é " ' ( - è _ ç à = 1 2 3 4 5 6 7 8 9 0
const TAB_AZERTY = { '&': 1, 'é': 2, '"': 3, "'": 4, '(': 5, '-': 6, 'è': 7, '_': 8, 'ç': 9, 'à': 0 };

export function entryKeyAction(event, { active = false, staffType = null, tabKeyboard = false, tabStyle = 'musescore' } = {}) {
  const guitarPro = tabStyle === 'guitarpro';
  if (!event || event.defaultPrevented || event.isComposing) return null;
  if (isTextEditingTarget(event.target)) return null;
  const raw = String(event.key ?? '');
  const key = raw.length === 1 ? raw.toLowerCase() : raw;
  if (event.metaKey) return null;

  // Ctrl + Alt + 1-4 : voix (AZERTY : & é " ')
  if (event.ctrlKey && event.altKey) {
    const d = AZERTY_DIGITS[key] ?? key;
    return active && /^[1-4]$/.test(d) ? { type: 'voice', voice: Number(d) - 1 } : null;
  }
  if (event.altKey) return null;
  if (event.ctrlKey) {
    if (!active) return null;
    if (key === 'ArrowUp') return { type: 'up', octave: true };
    if (key === 'ArrowDown') return { type: 'down', octave: true };
    if (key === 'ArrowLeft') return { type: 'prevMeasure' };
    if (key === 'ArrowRight') return { type: 'nextMeasure' };
    if (key === 'Home' && guitarPro) return { type: 'firstBar' };
    return null;
  }
  if (key === 'n' && !event.shiftKey) return { type: 'toggle' };
  if (key === 't' && !event.shiftKey) return { type: 'tie' }; // liaison de prolongation (hors saisie : bascule sur la sélection)
  if (!active) return null;
  if (key === 'Escape') return { type: 'exit' };
  if (guitarPro) { // moving about, as in Guitar Pro: on every staff while the entry is on
    if (key === 'Tab') return { type: event.shiftKey ? 'prevStaff' : 'nextStaff' };
    if (key === 'Home') return { type: 'barStart' };
  }
  // portée de tablature, saisie au clavier activée : les lettres A-K et les chiffres sont des frettes, ↑ ↓ changent de corde
  if (staffType === 'tab' && tabKeyboard) {
    if (key === 'ArrowUp' && !event.shiftKey) return { type: 'string', delta: -1 };
    if (key === 'ArrowDown' && !event.shiftKey) return { type: 'string', delta: 1 };
    if (guitarPro) {
      if (key === 'r') return { type: 'rest' };
      if (key === 'l') return { type: 'tie' };
      if (key === '+' || (key === '=' && event.code === 'Equal')) return { type: 'longer', shorter: true };
      if ((key === '-' && (event.code === 'Minus' || event.code === 'NumpadSubtract')) || (key === '_' && event.code === 'Minus')) return { type: 'longer' };
      const g = key in TAB_AZERTY ? TAB_AZERTY[key] : (/^[0-9]$/.test(key) ? Number(key) : null);
      if (g !== null) return { type: 'fret', fret: g, add: false, guitarPro: true };
    }
    if (key === ';') return { type: 'rest' };
    if (!guitarPro && key in TAB_LETTERS) return { type: 'fret', fret: TAB_LETTERS[key], add: !!event.shiftKey };
    const f = key in TAB_AZERTY ? TAB_AZERTY[key] : (/^[0-9]$/.test(key) ? Number(key) : null);
    if (f !== null) return { type: 'fret', fret: f, add: false };
  }
  if (key === 'ArrowUp') return event.shiftKey ? null : { type: 'up' };
  if (key === 'ArrowDown') return event.shiftKey ? null : { type: 'down' };
  if (key === 'ArrowLeft') return event.shiftKey ? null : { type: 'left' };
  if (key === 'ArrowRight') return event.shiftKey ? null : { type: 'right' };
  if (key === 'Delete' || key === 'Backspace') return { type: 'delete' };
  // portée de percussion : W X C V Q S D posent un son de batterie (Maj : ajoute à l'accord) ; Q / W ne règlent alors plus la durée
  if (staffType === 'percussion' && key in DRUM_KEYS) return { type: 'drum', sound: DRUM_KEYS[key], add: !!event.shiftKey };
  if (key in LETTERS) return { type: 'letter', note: LETTERS[key], add: !!event.shiftKey };
  if (event.shiftKey && !(key in AZERTY_DIGITS) && !/^[0-9]$/.test(key)) {
    if (key === '+') return { type: 'accidental', value: 'sharp' };
    return null;
  }
  if (key === 'q') return { type: 'longer', shorter: true };
  if (key === 'w') return { type: 'longer' };
  if (key === '+') return { type: 'accidental', value: 'sharp' };
  if (key === '=') return { type: 'accidental', value: 'natural' };
  if (key === '-') return { type: 'accidental', value: 'flat' };
  if (key === '.' || key === ',') return key === '.' || event.code === 'NumpadDecimal' ? { type: 'dot' } : null;
  const digit = AZERTY_DIGITS[key] ?? (/^[0-9]$/.test(key) ? key : null);
  if (digit === '0') return { type: 'rest' };
  if (digit && DURATIONS[digit]) return { type: 'duration', base: DURATIONS[digit] };
  return null;
}

/** Hold time (ms) from which an arrow press on a selection means "octave" (same delay as `bindShortLong` in button-behavior.js). */
export const ARROW_LONG_PRESS_MS = 450;

/**
 * Arrow keys on a SELECTION while the note entry is off (the caller checks that; pure, no DOM):
 *  Ctrl + Up/Down -> { kind: 'octave-now', up } at once ; plain Up/Down -> { kind: 'press-start', up } (auto-repeat: { kind: 'press-repeat', up },
 *  to be swallowed). The release then decides, see `arrowPressOutcome`. Anything else (Shift, Alt, Meta, other keys, text fields) -> null.
 */
export function selectionKeyAction(event) {
  if (!event || event.defaultPrevented || event.isComposing) return null;
  if (isTextEditingTarget(event.target)) return null;
  const key = String(event.key ?? '');
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;
  if (event.metaKey || event.altKey || event.shiftKey) return null;
  const up = key === 'ArrowUp';
  if (event.ctrlKey) return event.repeat ? { kind: 'press-repeat', up } : { kind: 'octave-now', up };
  return { kind: event.repeat ? 'press-repeat' : 'press-start', up };
}

/** What a released plain arrow does, from how long it was held. */
export const arrowPressOutcome = (heldMs) => (heldMs >= ARROW_LONG_PRESS_MS ? 'octave' : 'semitone');
