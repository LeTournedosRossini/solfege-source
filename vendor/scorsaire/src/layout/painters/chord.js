/*
 * Peintre « chord » : portée d'accords (étape 5, tranche 3). Une portée SANS LIGNES dont seules les barres de mesure sont dessinées (hauteur
 * `SID.CHORD_BAR_HEIGHT` = 4 sp, comme une portée à 5 lignes) ; le texte des symboles est centré verticalement sur le milieu de ces barres.
 * Mise en forme des symboles : ../chorddisplay.js (celle de CCE, glyphes Bravura).
 *
 * Largeur et compression (décision de Jean, 11/10/2026), pilotées par `SID.CHORD_FIT` (CCE : « fit chords ») :
 *  - ÉDITION (`CHORD_FIT` faux) : la colonne d'un symbole réserve sa largeur RÉELLE (forme `HARMONY` de l'espacement par formes) : rien ne se recouvre.
 *  - RENDU (écran partition, lecteur ; `CHORD_FIT` vrai, défaut) : le symbole ne prend aucune largeur dans la colonne ; il est comprimé horizontalement
 *    (scaleX, jamais sous `CHORD_FIT_MIN`) pour tenir dans sa CASE = de son origine au symbole suivant de la voix (moins l'écart de MuseScore entre deux
 *    symboles, `harmonyHarmonyDistance`) ou à la barre de fin de mesure. `%` et `%%` ne se comprime pas ; `%` est centré dans sa case, `%%` à cheval sur la
 *    barre qui termine sa case (comme CCE) en mode rendu.
 * Les symboles d'accord sont des ANNOTATIONS (`entry.annotation`) : ils ne comptent ni dans la plus courte durée ni dans l'étirement des colonnes (MuseScore :
 * un `Harmony` n'est pas un `ChordRest`).
 */
import { PID, SID, getProperty, chordQualityDisplay, chordQualityGaps } from '../../model/index.js';
import { fAdd, fCmp } from '../../model/fraction.js';
import { BARLINE_THIN_W } from '../constants.js';
import { chordSymbolLayout, chordSymbolItems, chordFitScale, chordStyleOf, fontProfile } from '../chorddisplay.js';
import { staffTextEntryItems } from '../stafftextentries.js';

const HARMONY_GAP = 0.5; // `PaddingTable` HARMONY → HARMONY (harmonyHarmonyDistance) : écart entre deux symboles voisins dans la compression
const BAR_GAP = 0.25; // BAR_LINE → HARMONY (0,5 × harmonyHarmonyDistance), pris symétriquement avant la barre de fin
const PHANTOM_WIDTH = 0.01;

function symbolSpec(item, ctx) {
  const quality = getProperty(item, PID.CHORD_QUALITY) ?? '';
  return {
    root: getProperty(item, PID.CHORD_ROOT) ?? null,
    quality,
    display: ctx.chordQualities ? chordQualityDisplay(ctx.chordQualities, quality) : null, // écriture choisie dans le dictionnaire du document
    gaps: ctx.chordQualities ? chordQualityGaps(ctx.chordQualities, quality) : [],
    bass: getProperty(item, PID.CHORD_BASS) ?? null,
    special: getProperty(item, PID.CHORD_SPECIAL) ?? 'none',
  };
}

/** Mise en forme d'une entrée, mémoïsée dans le contexte (jamais de mémo global : voir `layout/memo.js`). */
function layoutOf(entry, ctx) {
  const cache = ctx.memo.chordLayouts ?? (ctx.memo.chordLayouts = new Map());
  let l = cache.get(entry.item);
  if (!l) {
    l = chordSymbolLayout(symbolSpec(entry.item, ctx), ctx.style, ctx.glyphs);
    cache.set(entry.item, l);
  }
  return l;
}

// the root's baseline sits 0.05 bar-heights above the bottom of the bars (its capitals then end ~0.075 below the top): mid = baseline + the font's centre-to-baseline distance
const midOf = (ctx) => ctx.style(SID.CHORD_BAR_HEIGHT) * 0.05 + fontProfile(ctx.style(SID.CHORD_FONT_FAMILY), ctx.style(SID.CHORD_FONT_WEIGHT)).centerToBaseline * ctx.style(SID.CHORD_FONT_SIZE);
const fitting = (ctx) => Boolean(ctx.style(SID.CHORD_FIT));

function itemsAt(entry, ctx, x, scale = 1, centerX = null) {
  const layout = layoutOf(entry, ctx);
  const st = layout.st ?? chordStyleOf(ctx.style);
  return chordSymbolItems(layout, { x, mid: midOf(ctx), scale, ref: entry.item.id, family: st.family, weight: st.weight, centerX });
}

export const chordPainter = {
  name: 'chord',
  lines: () => [],
  /** Étendue des barres de mesure d'une portée sans lignes (y local, 0 = bas des barres). */
  barSpan: (staff, ctx) => ({ lo: 0, hi: ctx.style(SID.CHORD_BAR_HEIGHT) }),
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
        if (item.type !== 'chordsymbol') continue;
        const position = getProperty(item, PID.POSITION);
        if (!position) continue;
        entries.push({ position: fAdd(offset, position), duration: null, item, voice: v, annotation: true });
      }
    });
    // an empty measure keeps the room of a measure that holds a symbol: a ghost annotation at its start (nothing is drawn for it)
    if (!entries.length) entries.push({ position: offset, duration: null, item: null, voice: 0, annotation: true, ghost: true });
    return entries.sort((a, b) => fCmp(a.position, b.position));
  },
  itemWidth: (entry, ctx) => (entry.ghost || fitting(ctx) ? 0 : layoutOf(entry, ctx).width),
  /** Taille réelle, sans compression (édition ; forme d'espacement). */
  paintEntry: (entry, x, ctx) => (entry.ghost ? [] : itemsAt(entry, ctx, x)),
  /** Ce que l'espacement par formes voit : en rendu, un symbole ne réserve rien (forme fantôme) ; en édition, sa largeur réelle. */
  spacingItems(entry, ctx) {
    if (entry.ghost) return [{ kind: 'shape', type: 'HARMONY', l: 0, r: PHANTOM_WIDTH, t: -1, b: 1 }];
    if (!fitting(ctx)) return itemsAt(entry, ctx, 0);
    return [{ kind: 'shape', type: 'HARMONY', l: 0, r: PHANTOM_WIDTH, t: -1, b: 1 }];
  },
  /**
   * The free texts of the staff (`PID.STAFF_TEXTS`, and those of a printed part) with their lines: a chord staff has no lines, its bars are as high as a 5-line staff, so the texts
   * are laid out as above / below such a staff. They cross the line breaks, hence one call for all the systems.
   */
  paintSpanners(perSystem, staff, movement, ctx, existing = []) {
    const result = perSystem.map(() => []);
    staffTextEntryItems({ perSystem, staff, movement, ctx: { ...ctx, staff }, result, lines: 5, lineDist: ctx.style(SID.CHORD_BAR_HEIGHT) / 4, existing });
    return result;
  },
  paintMeasure(placed, mctx) {
    const items = [];
    const fit = fitting(mctx);
    const st = chordStyleOf(mctx.style);
    placed.forEach((p, i) => {
      if (p.entry.ghost) return;
      const layout = layoutOf(p.entry, mctx);
      if (!fit) { items.push(...itemsAt(p.entry, mctx, p.x)); return; }
      // case : jusqu'au symbole suivant de la même voix, sinon jusqu'à la barre de fin de mesure
      const next = placed.slice(i + 1).find((q) => q.entry.voice === p.entry.voice && q.x > p.x + 1e-9);
      const end = next ? next.x : mctx.measure.barX;
      if (layout.kind === 'repeat') {
        if (layout.special === 'repeat2') items.push(...itemsAt(p.entry, mctx, p.x, 1, next ? end : end + BARLINE_THIN_W / 2)); // la barre est dessinée de barX à barX + épaisseur : on centre sur son axe
        else items.push(...itemsAt(p.entry, mctx, p.x, 1, p.x + (end - p.x) / 2));
        return;
      }
      const available = end - p.x - (next ? HARMONY_GAP : BAR_GAP);
      items.push(...itemsAt(p.entry, mctx, p.x, chordFitScale(layout.width, available, st.fitMin)));
    });
    return items;
  },
};
