/*
 * Silences contre accords et silences entre eux (autres voix, même portée) — port de `RestLayout::resolveRestVSChord` et
 * `resolveRestVSRest` (`restlayout.cpp` 4.7.5, appelés après le décalage de voix de `computeVoiceOffset`, par `measurelayout.cpp`).
 * Fonction pure sur des « formes » en rectangles. Repère de portée : y vers le HAUT (0 = ligne du bas) ; les tests de MuseScore,
 * en y vers le bas, sont retraduits sans changer leur sens.
 *
 * Éléments (une portée, une mesure) :
 *   chord : { kind:'chord', voice, pos, end, rects:[{l,r,b,t}], top:{t,b}, bottom:{t,b} }   (top/bottom = tête la plus haute / basse)
 *   rest  : { kind:'rest', id, voice, pos, y, box:{l,r,b,t} (boîte du glyphe relativement à son origine, x absolu), wholeOrHalf, full }
 * `pos`, `end` : fractions exactes (`[n, d]`). Résultat : Map id du silence → décalage vertical total (espaces, + = vers le haut).
 *
 * Limites : formes d'accord réduites aux têtes, lignes supplémentaires et hampe (pas d'altérations, de points, de crochet, de trémolo) ;
 * hampe SANS ligature (comme à l'étape de MuseScore où ces conflits sont résolus, avant `BeamLayout`) ; pas de ligature de silences
 * (`considerBeams`, faux par défaut chez MuseScore) ; pas de variante « avec ligne supplémentaire » des silences de ronde / blanche.
 */
import { fCmp, fLt } from '../model/fraction.js';

const MIN_CLEAR_WHOLE_HALF = 0.55;
const MIN_CLEAR_OTHER = 0.35;
const MIN_REST_TO_REST = 0.55;
const FAR = 1000;

const overlapsX = (a, b) => a.l < b.r && a.r > b.l;

/** Dégagement vertical entre une forme `upper` située au-dessus et `lower` en dessous (négatif = recouvrement) ; 0 si l'une est vide. */
function verticalClearance(upper, lower) {
  if (!upper.length || !lower.length) return 0;
  let dist = Infinity;
  for (const r2 of lower) {
    if (r2.t - r2.b <= 0) continue;
    for (const r1 of upper) {
      if (r1.t - r1.b <= 0) continue;
      if (overlapsX(r1, r2)) dist = Math.min(dist, r1.b - r2.t);
    }
  }
  return dist === Infinity ? 0 : dist;
}

// boîte du glyphe à la hauteur y : `boxAt` (silence de ronde / blanche dont le glyphe change avec la ligne, `updateSymbol`) ou boîte fixe
const restRect = (r, y) => { const bx = r.boxAt ? r.boxAt(y) : r.box; return { l: bx.l, r: bx.r, b: y + bx.b, t: y + bx.t }; };

/**
 * `groups` (facultatif) : groupes d'alignement (`RestLayout::computeRestGroups` : silences d'une même voix entre deux points d'interruption),
 * tableaux d'identifiants dans l'ordre ; `alignRests` les ramène à la même hauteur une fois les conflits résolus.
 */
export function resolveRests(elements, { lines = 5, lineDist = 1, groups = [] } = {}) {
  const shifts = new Map();
  const staffTop = (lines - 1) * lineDist;
  const rests = elements.filter((e) => e.kind === 'rest' && !e.full);
  if (!rests.length) return shifts;
  const chords = elements.filter((e) => e.kind === 'chord');
  const state = new Map(); // id → { y, above, below, locked }
  for (const r of rests) state.set(r.id, { y: r.y, above: FAR, below: FAR, locked: false });
  const setAbove = (s, v) => { s.above = Math.max(Math.min(s.above, v), 0); };
  const setBelow = (s, v) => { s.below = Math.max(Math.min(s.below, v), 0); };

  // regroupement par instant (segment)
  const byPos = [];
  for (const r of rests) {
    let g = byPos.find((x) => fCmp(x.pos, r.pos) === 0);
    if (!g) byPos.push((g = { pos: r.pos, rests: [] }));
    g.rests.push(r);
  }

  for (const g of byPos) {
    // accords du même instant (toutes voix) + accords des instants précédents d'une voix sans silence ici dont la durée recouvre l'instant
    const here = chords.filter((c) => fCmp(c.pos, g.pos) === 0);
    const restVoices = new Set(g.rests.map((r) => r.voice));
    const overlapping = chords.filter((c) => fLt(c.pos, g.pos) && !restVoices.has(c.voice) && fLt(g.pos, c.end));
    const all = [...here, ...overlapping];

    for (const rest of g.rests) {
      const s = state.get(rest.id);
      const minClear = rest.wholeOrHalf ? MIN_CLEAR_WHOLE_HALF : MIN_CLEAR_OTHER;
      for (const chord of all) {
        const restAbove = rest.voice < chord.voice;
        const sameSegment = fCmp(chord.pos, rest.pos) === 0;
        const rr = restRect(rest, s.y);
        let clearance;
        let minC = minClear;
        if (sameSegment) {
          if (!chord.rects.length) continue;
          clearance = restAbove ? verticalClearance([rr], chord.rects) : verticalClearance(chord.rects, [rr]);
        } else {
          const note = restAbove ? chord.top : chord.bottom;
          clearance = restAbove ? rr.b - note.t : note.b - rr.t;
          minC = 0;
        }
        const margin = clearance - minC;
        const steps = Math.floor(margin / lineDist);
        if (restAbove) setBelow(s, steps); else setAbove(s, steps);
        if (margin > 0) continue;
        s.locked = true;
        // port : `outAboveStaff` / `outBelowStaff` (y vers le bas chez MuseScore, retraduits)
        const outAbove = restAbove && (staffTop - rr.b) + margin < minC;
        const outBelow = !restAbove && rr.t + margin < minC;
        const half = (outAbove || outBelow) && !rest.wholeOrHalf;
        const unit = half ? lineDist / 2 : lineDist;
        const move = Math.ceil(Math.abs(margin) / unit) * unit * (restAbove ? 1 : -1);
        s.y += move;
      }
    }

    if (g.rests.length < 2) continue;
    // silences contre silences : voisins par ordre de voix
    for (let i = 0; i < g.rests.length - 1; i++) {
      const r1 = g.rests[i];
      const r2 = g.rests[i + 1];
      const s1 = state.get(r1.id);
      const s2 = state.get(r2.id);
      const firstAbove = r1.voice < r2.voice;
      const a = restRect(r1, s1.y);
      const b = restRect(r2, s2.y);
      const clearance = firstAbove ? verticalClearance([a], [b]) : verticalClearance([b], [a]);
      const margin = clearance - MIN_REST_TO_REST;
      const steps = Math.floor(margin / lineDist);
      if (firstAbove) { setBelow(s1, steps); setAbove(s2, steps); } else { setAbove(s1, steps); setBelow(s2, steps); }
      if (margin > 0) continue;
      const total = Math.ceil(Math.abs(margin) / lineDist);
      let step1 = Math.floor(total / 2);
      let step2 = Math.ceil(total / 2);
      let max1 = Math.max(firstAbove ? s1.above : s1.below, 0);
      let max2 = Math.max(firstAbove ? s2.below : s2.above, 0);
      if (step1 > max1) step2 += step1 - max1;
      if (step2 > max2) step1 += step2 - max2;
      step1 = Math.min(step1, max1);
      step2 = Math.min(step2, max2);
      s1.y += step1 * lineDist * (firstAbove ? 1 : -1);
      s2.y += step2 * lineDist * (firstAbove ? -1 : 1);
    }
  }
  // `RestLayout::alignRests` : voix 0 → alignée sur le silence le plus HAUT du groupe, autres voix → sur le plus BAS ; le déplacement
  // d'un silence est borné par son dégagement vertical (en pas de lignes, moins un pas de marge)
  for (const ids of groups) {
    const members = ids.map((id) => ({ r: rests.find((x) => x.id === id), s: state.get(id) })).filter((m) => m.r);
    if (members.length <= 1) continue;
    const up = members[0].r.voice === 0;
    const yOuter = up ? Math.max(...members.map((m) => m.s.y)) : Math.min(...members.map((m) => m.s.y));
    for (const { s } of members) {
      const clear = Math.max(0, lineDist * (up ? s.above : s.below) - lineDist);
      const required = yOuter - s.y;
      s.y = Math.abs(required) > clear ? (up ? s.y + clear : s.y - clear) : yOuter;
    }
  }
  for (const r of rests) shifts.set(r.id, state.get(r.id).y - r.y);
  return shifts;
}
