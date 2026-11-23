/*
 * Peintre « lyrics » : la piste PAROLES à événements. Une portée SANS LIGNES ni barres dont seul le TEXTE est dessiné : chaque événement (`lyricevent`, model/lyricevents.js)
 * est une syllabe posée à un INSTANT exact de la mesure (POSITION, fraction), sur une ligne (LYRIC_LINE : 0 = la première) ; les lignes sont EMPILÉES sous la même ligne de
 * base (la ligne 0 en haut). Le texte COMMENCE à l'instant de la syllabe (l'attaque du chant), il n'est pas centré sous une tête de note.
 * Comme un symbole d'accord, un événement est une ANNOTATION : il crée une colonne à son instant (les autres portées s'y alignent) mais ne compte ni dans la plus courte
 * durée ni dans l'étirement ; la colonne réserve la largeur du texte (+ un petit écart) pour que deux syllabes voisines ne se recouvrent pas.
 * La portée se superpose à une autre en se plaçant juste dessous (ou dessus) : sa hauteur est celle de ses lignes de texte, rien d'autre.
 */
import { PID, SID, getProperty } from '../../model/index.js';
import { fAdd, fCmp } from '../../model/fraction.js';
import { lyricTextWidth } from '../lyrics.js';

const PT = (1.75 * 72) / 25.4; // points par espace
const GAP = 0.4; // espaces gardés après une syllabe
const LEADING = 1.25; // interligne / corps
const DESCENT = 0.25; // part du corps sous la ligne de base

const sizeOf = (ctx) => ctx.style(SID.LYRICS_FONT_SIZE) / PT;
const lineHeightOf = (ctx) => sizeOf(ctx) * LEADING * ctx.style(SID.LYRICS_LINE_HEIGHT);

/** Nombre de lignes de texte d'une portée : la plus haute ligne utilisée + 1 (au moins 1). */
export function lyricLinesOf(staff) {
  let max = 0;
  for (const voice of staff.voices ?? []) for (const measure of voice.measures ?? []) for (const item of measure.items ?? []) if (item.type === 'lyricevent') max = Math.max(max, getProperty(item, PID.LYRIC_LINE) ?? 0);
  return max + 1;
}

export const lyricsPainter = {
  name: 'lyrics',
  lines: () => [],
  /** Étendue verticale de la portée sans lignes (y local, 0 = bas) : la hauteur de ses lignes de texte. */
  barSpan: (staff, ctx) => ({ lo: 0, hi: lyricLinesOf(staff) * lineHeightOf(ctx) }),
  clef: () => null,
  keySig: () => null,
  timeSig: () => null,
  entries(staff, mi, ctx) {
    const entries = [];
    const offset = ctx.offsets?.[mi] ?? [0, 1];
    staff.voices.forEach((voice, v) => {
      const measure = voice.measures[mi];
      if (!measure) return;
      for (const item of measure.items) {
        if (item.type !== 'lyricevent') continue;
        const position = getProperty(item, PID.POSITION);
        if (!position) continue;
        entries.push({ position: fAdd(offset, position), duration: null, item, voice: v, annotation: true });
      }
    });
    // an empty measure keeps the room of a measure that holds a syllable: a ghost annotation at its start (nothing is drawn for it)
    if (!entries.length) entries.push({ position: offset, duration: null, item: null, voice: 0, annotation: true, ghost: true });
    return entries.sort((a, b) => fCmp(a.position, b.position));
  },
  itemWidth: (entry, ctx) => (entry.ghost ? 0 : lyricTextWidth(String(getProperty(entry.item, PID.TEXT) ?? ''), sizeOf(ctx)) + GAP),
  /** What the spacing sees: a syllable reserves the width of its text (the same kind of shape as a chord symbol, which is also an annotation). */
  spacingItems(entry, ctx) {
    if (entry.ghost) return [{ kind: 'shape', type: 'HARMONY', l: 0, r: 0.01, t: -1, b: 1 }];
    return [{ kind: 'shape', type: 'HARMONY', l: 0, r: lyricTextWidth(String(getProperty(entry.item, PID.TEXT) ?? ''), sizeOf(ctx)) + GAP, t: -1, b: 1 }];
  },
  paintEntry(entry, x, ctx) {
    if (entry.ghost) return [];
    const size = sizeOf(ctx); const height = lineHeightOf(ctx);
    const text = String(getProperty(entry.item, PID.TEXT) ?? '');
    const line = getProperty(entry.item, PID.LYRIC_LINE) ?? 0;
    const top = lyricLinesOf(ctx.staff) * height; // the lines hang from the top of the band, the first one highest
    const y = top - (line + 1) * height + DESCENT * size + (height - size) / 2;
    return [{ kind: 'text', role: 'lyric-event', ref: entry.item.id, text, x, y, size, anchor: 'start', box: { x1: 0, x2: lyricTextWidth(text, size), y1: -DESCENT * size, y2: 0.8 * size } }];
  },
};
