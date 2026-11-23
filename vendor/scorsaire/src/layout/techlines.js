/*
 * Lignes de technique de jeu en plage (tranche 4d-c) : palm mute, let ring, marque d'harmonique, barre de whammy, vibrato.
 * `PID.TECH_LINES` (portée) : [{ id, type, startChordId, endChordId, text?, vibratoType?, placement? }] — ancrage par IDENTITÉ des accords
 * de bornes. Port de MuseScore v4.7.5 (`palmmute.cpp`, `letring.cpp`, `harmonicmark.cpp`, `whammybar.cpp`, `vibrato.cpp`,
 * `ChordTextLineBase`, `TLayout::layoutSystemSLine` / `layoutTextLineBaseSegment` / `layoutVibratoSegment`, `TDraw::drawTextLineBaseSegment`).
 *
 *  - Les quatre lignes de texte sont des `TextLineBase` : texte (« P.M. », « let ring », « w/bar », ou texte propre à la marque d'harmonique)
 *    aligné à gauche, VCENTER, 10 pt ; ligne POINTILLÉE (0,11 sp, tiret 5 / blanc 5 en largeurs de trait, blanc redistribué pour finir par un
 *    tiret : `distributedDashPattern`) qui démarre `0,5 sp` après le texte ; crochet de fin en T (± 0,6 sp) sur le dernier segment seulement ;
 *    le texte se répète sur chaque segment (texte de continuation = texte de début). Côté : dessous (palm mute, let ring, whammy), dessus
 *    (marque d'harmonique : `ottava8VAPlacement`), vibrato dessus (décalage de style (0, −1 sp)).
 *  - Étendue : départ = x de la colonne de l'accord de début ; fin = x de la colonne SUIVANTE de la portée − 1 sp (`SLine::linePos`). Retour à
 *    la ligne : DÉPART → dernière barre − 0,25 sp ; MILIEU / ARRIVÉE → début de système (`firstNoteRestSegmentX`).
 *  - Vibrato : rangée de glyphes `guitarVibratoStroke` / `guitarWideVibratoStroke` / `wiggleSawtooth` / `wiggleSawtoothWide`, 1 + round((l − a) / a)
 *    glyphes (`VibratoSegment::symbolLine`), origine de chaque glyphe à x1 + i × avance, sur la ligne de base du segment.
 *  - Autoplace (`autoplaceSpannerSegment`) : la ligne reste à sa position de style tant qu'elle ne touche rien ; sinon elle est repoussée juste
 *    assez pour que sa boîte reste à `minDistance` (0,7 sp ; vibrato 1,0) des éléments de la portée dessous / dessus. Ici : « skyline » = boîtes
 *    des éléments déjà dessinés de la portée (comme `bounds.js`) ; les lignes se rangent dans l'ordre de leur début.
 *  - Visibilité sur tablature : palm mute / let ring / marque d'harmonique masqués par `*_SHOW_TAB_COMMON/SIMPLE` (jamais en Full) ; vibrato
 *    toujours dessiné.
 *
 *  NON VÉRIFIÉ sur export (aucun export de référence) : boîte du texte (police Edwin absente : hauteur 1,2 × corps, ligne de base à 0,3 × corps
 *  sous le centre, largeur ≈ 0,5 × corps × caractères) ; fin de ligne quand l'accord de fin est le dernier d'un système (MuseScore y calcule x dans
 *  le repère du système suivant : ici on termine à la dernière barre − 0,25 sp) ; arrêt avant un ornement de la colonne suivante (`trillLinePos`)
 *  non porté.
 */
import { PID, SID, getProperty } from '../model/index.js';
import { itemMeasureIndexMap } from './hairpins.js';
import { systemSpan } from './painters/systemspan.js';
import { rectsOf } from './bounds.js';
import { staffTechLines } from './painters/resolved.js';

export function resolveStaffTechLines(staff) {
  const idx = itemMeasureIndexMap(staff);
  const raw = getProperty(staff, PID.TECH_LINES) || [];
  return raw
    .map((s) => ({ ...s, startMi: idx.get(s.startChordId), endMi: idx.get(s.endChordId) }))
    .filter((s) => s.startMi !== undefined && s.endMi !== undefined && s.startMi <= s.endMi);
}

const SYSTEM_BARLINE_WIDTH = 0.18; // comme tabspanners.js (barre de début de système = en-tête d'une tablature sans clé)
const LINE_TEXT_SIZE = 10 / ((1.75 * 72) / 25.4); // 10 pt (police Edwin) en espaces
const TEXT_HALF_HEIGHT = 0.6 * LINE_TEXT_SIZE;
const TEXT_BASELINE = 0.3 * LINE_TEXT_SIZE; // ligne de base sous le centre (VCENTER)
const LINE_WIDTH = 0.11;
const DASH = 5; const GAP = 5; // en largeurs de trait
const HOOK_HEIGHT = 0.6;
const TEXT_LINE_GAP = 0.5; // gapBetweenTextAndLine
const MIN_DISTANCE = 0.7; // letRingMinDistance / palmMuteMinDistance
const VIBRATO_MIN_DISTANCE = 1.0;
const VIBRATO_OFFSET = -1; // vibratoPosAbove (0, −1) : y vers le bas
const VIBRATO_GLYPH = { guitarVibrato: 'guitarVibratoStroke', guitarVibratoWide: 'guitarWideVibratoStroke', sawtooth: 'wiggleSawtooth', sawtoothWide: 'wiggleSawtoothWide' };
const SHOW_FLAGS = { palmMute: ['PALM_MUTE_SHOW_TAB_COMMON', 'PALM_MUTE_SHOW_TAB_SIMPLE'], letRing: ['LET_RING_SHOW_TAB_COMMON', 'LET_RING_SHOW_TAB_SIMPLE'], harmonicMark: ['HARMONIC_MARK_SHOW_TAB_COMMON', 'HARMONIC_MARK_SHOW_TAB_SIMPLE'] };
const DEFAULT_BELOW = { palmMute: true, letRing: true, whammyBar: true, harmonicMark: false, vibrato: false };

/** Motif de pointillé redistribué (`distributedDashPattern`) en espaces ; null = trait plein (trop court). */
export function distributedDash(length, lw = LINE_WIDTH, dash = DASH, gap = GAP) {
  const l = length / lw;
  const pairs = Math.max(1, Math.trunc(l / (dash + gap)));
  const newGap = (l - dash * (pairs + 1)) / pairs;
  if (!(newGap > 0)) return null;
  return [dash * lw, newGap * lw];
}

const textWidth = (text) => 0.5 * LINE_TEXT_SIZE * text.length;

export function tabTechLineItems({ perSystem, staff, ctx, where, result, lines, lineDist, existing = [] }) {
  const model = staffTechLines(ctx, staff);
  if (!model.length) return;
  const H = (lines - 1) * lineDist;
  const U = (y) => H - y; // y bas → y haut (repère des éléments d'affichage)
  const st = (k) => ctx.style(SID[k]);
  const presetKey = getProperty(staff, PID.TAB_STYLE) ?? 'full';
  const glyphs = ctx.glyphs;
  const spanOf = (k) => systemSpan(perSystem, k, { headerMin: SYSTEM_BARLINE_WIDTH });

  // « skyline » par système : boîtes (repère y BAS) des éléments déjà dessinés de la portée, corps de la portée compris
  const pool = perSystem.map((_, k) => {
    const rs = rectsOf([...(existing[k] ?? []), ...(result[k] ?? [])], glyphs).map((r) => ({ x1: r.x1, x2: r.x2, top: H - r.y2, bottom: H - r.y1 }));
    rs.push({ x1: -Infinity, x2: Infinity, top: -0.05, bottom: H + 0.05 });
    return rs;
  });

  const nextColumnX = (k, afterX) => {
    let best = null;
    for (const p of perSystem[k].placed) if (p.x > afterX + 1e-6 && (best === null || p.x < best)) best = p.x;
    return best;
  };

  const order = model
    .map((ln) => ({ ln, s: where.get(ln.startChordId), e: where.get(ln.endChordId) }))
    .filter((r) => r.s && r.e && (r.s.k < r.e.k || (r.s.k === r.e.k && r.s.p.x <= r.e.p.x)))
    .sort((a, b) => a.s.k - b.s.k || a.s.p.x - b.s.p.x);

  for (const { ln, s, e } of order) {
    const flags = SHOW_FLAGS[ln.type];
    if (flags && presetKey !== 'full' && !st(presetKey === 'common' ? flags[0] : flags[1])) continue;
    const below = ln.placement ? ln.placement === 'below' : DEFAULT_BELOW[ln.type];
    const isVibrato = ln.type === 'vibrato';
    const text = isVibrato ? '' : (ln.text ?? (ln.type === 'palmMute' ? st('PALM_MUTE_TEXT') : ln.type === 'letRing' ? st('LET_RING_TEXT') : ln.type === 'whammyBar' ? st('WHAMMY_BAR_TEXT') : ''));
    const minDist = isVibrato ? VIBRATO_MIN_DISTANCE : MIN_DISTANCE;
    const nextX = nextColumnX(e.k, e.p.x);
    const endX = nextX === null ? spanOf(e.k).right : nextX - 1;
    for (let k = s.k; k <= e.k; k++) {
      const single = s.k === e.k;
      const isBegin = k === s.k; const isEnd = k === e.k;
      const span = spanOf(k);
      const x1 = isBegin ? s.p.x : span.left;
      const x2 = isEnd ? endX : span.right;
      const base0 = (below ? H : 0) + (isVibrato && !below ? VIBRATO_OFFSET : 0); // ligne de base du segment (y bas)
      const out = [];
      let shape; // boîte relative à la ligne de base (y bas) : { x1, x2, top, bottom }
      if (isVibrato) {
        const name = VIBRATO_GLYPH[ln.vibratoType ?? 'guitarVibrato'];
        const g = glyphs.glyphs[name];
        if (!g) continue;
        const adv = g.advance;
        const n = Math.max(0, Math.round((x2 - x1 - adv) / adv));
        const count = 1 + n;
        for (let i = 0; i < count; i++) out.push({ glyph: name, dx: i * adv });
        shape = { x1: x1 + g.bbox.bBoxSW[0], x2: x1 + (count - 1) * adv + g.bbox.bBoxNE[0], top: -g.bbox.bBoxNE[1], bottom: -g.bbox.bBoxSW[1] };
      } else {
        const tw = text ? textWidth(text) : 0;
        shape = { x1, x2: x1 + tw, top: text ? -TEXT_HALF_HEIGHT : -LINE_WIDTH / 2, bottom: text ? TEXT_HALF_HEIGHT : LINE_WIDTH / 2 };
        const lx1 = x1 + (text ? tw + TEXT_LINE_GAP : 0);
        const hook = isEnd && ln.type !== 'vibrato';
        if (lx1 <= x2) { // pas de ligne « à l'envers » si le texte dépasse la longueur nominale
          shape.x2 = Math.max(shape.x2, x2);
          if (hook) { shape.top = Math.min(shape.top, -HOOK_HEIGHT); shape.bottom = Math.max(shape.bottom, HOOK_HEIGHT); }
        }
      }

      // autoplace : repousser juste assez pour garder `minDist` du « skyline » de la portée
      let yd = 0;
      const overl = pool[k].filter((r) => r.x2 > shape.x1 && r.x1 < shape.x2);
      if (overl.length) {
        if (below) {
          const sky = Math.max(...overl.map((r) => r.bottom));
          yd = Math.max(0, sky + minDist - (base0 + shape.top));
        } else {
          const sky = Math.min(...overl.map((r) => r.top));
          yd = Math.min(0, sky - minDist - (base0 + shape.bottom));
        }
      }
      const base = base0 + yd;

      if (isVibrato) {
        for (const o of out) result[k].push({ kind: 'glyph', name: o.glyph, x: x1 + o.dx, y: U(base), role: 'vibrato', ref: ln.id });
      } else {
        if (text) result[k].push({ kind: 'text', role: 'techline-text', text, x: x1, y: U(base + TEXT_BASELINE), size: LINE_TEXT_SIZE, anchor: 'start', ref: ln.id });
        const lx1 = x1 + (text ? textWidth(text) + TEXT_LINE_GAP : 0);
        if (lx1 <= x2) {
          const dash = distributedDash(x2 - lx1);
          result[k].push({ kind: 'line', role: 'techline', x1: lx1, y1: U(base), x2, y2: U(base), width: LINE_WIDTH, cap: 'butt', ...(dash ? { dash } : {}), ref: ln.id });
          if (isEnd) result[k].push({ kind: 'line', role: 'techline-hook', x1: x2, y1: U(base - HOOK_HEIGHT), x2, y2: U(base + HOOK_HEIGHT), width: LINE_WIDTH, cap: 'butt', ref: ln.id });
        }
      }
      pool[k].push({ x1: shape.x1, x2: shape.x2, top: base + shape.top, bottom: base + shape.bottom });
      void single;
    }
  }
}
