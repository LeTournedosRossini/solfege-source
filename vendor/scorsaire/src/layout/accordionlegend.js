/*
 * Légende de la main gauche d'accordéon — tranche 6 (AJOUT Scorsaire, demande de Jean : l'utilisateur qui ne connaît pas ce système de
 * rendu doit pouvoir le lire sur la partition). Une liste de lignes « signe + explication », dessinée avec les MÊMES éléments que le peintre
 * (têtes Bravura, boutons, badges) pour ne jamais diverger de la partition. Fonction pure ; sortie rendable par `renderSvgString`.
 * Largeur du texte approchée (police absente : 0,5 × corps × caractères).
 */
import { buttonItems, badgeItems, BUTTON_R, BLUE } from './painters/accordion.js';
import { chordButtonName } from '../model/accordion.js';

const TEXT = {
  fr: {
    title: 'Main gauche d\'accordéon',
    bass: 'Basse (rang 2) : hauteur réelle, clé de fa. Badge = rang / colonne du bouton.',
    counter: 'Contre-basse (rang 1) : en bleu, « 8 » sous la tête.',
    chord: 'Bouton d\'accord : son nom. Rang 3 majeur, 4 mineur, 5 septième, 6 diminué.',
    ring1: 'Anneau simple : noire ou plus court.',
    ring2: 'Double anneau : blanche.',
    ring3: 'Anneau plein : ronde.',
    stems: 'Une hampe commune relie la basse et son bouton ; plusieurs boutons = accord étendu.',
  },
  en: {
    title: 'Accordion left hand',
    bass: 'Bass (row 2): real pitch, bass clef. Badge = row / column of the button.',
    counter: 'Counter-bass (row 1): blue, "8" below the head.',
    chord: 'Chord button: its name. Row 3 major, 4 minor, 5 seventh, 6 diminished.',
    ring1: 'Single ring: quarter note or shorter.',
    ring2: 'Double ring: half note.',
    ring3: 'Filled ring: whole note.',
    stems: 'One shared stem joins the bass and its button; several buttons = extended chord.',
  },
};

const SIZE = 1.1; // corps du texte
const ROW_H = 3.9;
const SIGN_W = 5.2; // largeur de la colonne des signes
const PAD = 0.8;

/** @param options { lang ('fr' | 'en'), width (espaces, défaut : 52) } */
export function layoutAccordionLegend(glyphs, { lang = 'fr', width = 52 } = {}) {
  const T = TEXT[lang] ?? TEXT.fr;
  const head = (x, y, extra = {}) => ({ kind: 'glyph', name: 'noteheadBlack', x, y, role: 'legend-head', ...extra });
  const rows = [
    { sign: (cx, cy) => [head(cx - 0.59, cy), ...badgeItems(cx, cy + 1.73, 0.75, '2/7')], label: T.bass },
    { sign: (cx, cy) => [head(cx - 0.59, cy, { color: BLUE }), { kind: 'text', role: 'legend-mark', x: cx, y: cy - 1.1, text: '8', size: 0.95, family: 'serif', italic: true, weight: 600, anchor: 'middle' }, ...badgeItems(cx, cy + 1.73, 0.75, '1/4')], label: T.counter },
    { sign: (cx, cy) => [...buttonItems(cx, cy, BUTTON_R, 'single', chordButtonName(3, { step: 'C', alter: 0 }), glyphs), ...buttonItems(cx + 3.2, cy, BUTTON_R, 'single', chordButtonName(4, { step: 'C', alter: 0 }), glyphs)], label: T.chord },
    { sign: (cx, cy) => buttonItems(cx, cy, BUTTON_R, 'single', chordButtonName(3, { step: 'G', alter: 0 }), glyphs), label: T.ring1 },
    { sign: (cx, cy) => buttonItems(cx, cy, BUTTON_R + 0.24, 'double', chordButtonName(3, { step: 'G', alter: 0 }), glyphs), label: T.ring2 },
    { sign: (cx, cy) => buttonItems(cx, cy, BUTTON_R + 0.24, 'filled', chordButtonName(3, { step: 'G', alter: 0 }), glyphs), label: T.ring3 },
    { sign: null, label: T.stems },
  ];
  const items = [];
  const titleH = 2.6;
  items.push({ kind: 'text', role: 'legend-title', x: PAD, y: -(titleH - 0.5), text: T.title, size: 1.3, weight: 700, anchor: 'start' });
  let textW = 0;
  rows.forEach((r, i) => {
    const cy = -(titleH + 0.8 + i * ROW_H + ROW_H / 2); // y vers le haut : négatif sous l'origine
    if (r.sign) items.push(...r.sign(PAD + SIGN_W / 2 - (i === 2 ? 1.6 : 0), cy));
    const x = r.sign ? PAD + SIGN_W + 0.8 : PAD;
    items.push({ kind: 'text', role: 'legend-label', x, y: cy, text: r.label, size: SIZE, anchor: 'start', central: true });
    textW = Math.max(textW, x + 0.5 * SIZE * r.label.length);
  });
  const w = Math.max(width, textW + PAD);
  const height = titleH + 0.8 + rows.length * ROW_H + 0.5;
  const frame = [[0, 0, w, 0], [w, 0, w, -height], [w, -height, 0, -height], [0, -height, 0, 0]]
    .map(([x1, y1, x2, y2]) => ({ kind: 'line', role: 'legend-frame', x1, y1, x2, y2, width: 0.08 }));
  items.unshift(...frame);
  return { width: w, height, systems: [{ index: 0, x0: 0, top: 0, overlays: [], staves: [{ ref: 'accordion-legend', type: 'accordion-left', originY: 0, items }] }], warnings: [] };
}
