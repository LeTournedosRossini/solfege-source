/*
 * Portées croisées (`ChordRest::staffMove` de MuseScore) : un accord ou un silence d'une portée est DESSINÉ sur la portée voisine de la même piste.
 *
 * Ce module décide, pour une mesure, ce qui est « relocalisé » : un accord (ou silence) dont `PID.STAFF_MOVE` ≠ 0 et dont le groupe de ligature
 * (`buildBeamGroups`) est homogène — tous ses membres vont du même côté, ou il n'est dans aucune ligature. Il est alors dessiné comme un accord de
 * la portée cible (clé, lignes, armure et altérations de CETTE portée) ; son entrée reste dans la portée d'origine (colonnes, voix, durée), seul
 * son DESSIN change de portée (le peintre le range dans `items.relocated`, `index.js` le verse dans la portée cible).
 *
 * Un groupe de ligature dont les membres ne vont pas tous du même côté est une ligature CROISÉE (`BeamBase::cross`). Quand elle porte sur
 * exactement DEUX portées voisines, ses membres déplacés sont relocalisés (têtes, clé, armure, altérations de la portée cible) SANS « voie » :
 * ils restent dans la liste de leur voix, et la ligature, les hampes et leur allongement sont posés dans un second passage, une fois la distance
 * entre les deux portées connue (`crossbeam.js`, `layout/index.js`). Ces groupes sont décrits par `crossMembers` (par identifiant d'élément) et
 * `crossGroups` (`supported: true`). Un groupe sur trois portées (ou plus) n'est pas porté : ses membres restent dans leur portée d'origine,
 * ligaturés sans croisement (`supported: false`).
 *
 * Tout est dérivé du modèle, mesure par mesure (aucun état conservé) ; `crossRoutes` renvoie null quand la mesure n'a aucune portée croisée,
 * ce qui laisse le chemin habituel strictement inchangé.
 */
import { PID, SID, getProperty } from '../model/index.js';
import { sequentialEntries } from './painters/common.js';
import { buildBeamGroups } from './beaming.js';
import { resolveAccidentals } from './accidentals.js';
import { gracesOf } from './gracenotes.js';
import { writtenChord } from './transposed.js';

export const staffMoveOf = (item) => (item && (item.type === 'chord' || item.type === 'rest') ? getProperty(item, PID.STAFF_MOVE) : 0);

/**
 * @param ctx    contexte d'une portée (porte `siblingsOf`, `memo`, `timeSigs`, …)
 * @param staff  portée dont on construit les entrées
 * @returns null (aucune portée croisée dans la mesure de cette piste) ou
 *   { relocated: Map(idÉlément → { move, lane, target, from, cross? }),
 *     crossMembers: Map(idÉlément → { group, move, staffK (rang de la portée où il est dessiné), lower (portée du bas de la paire) }),
 *     crossGroups: [{ id, staff, voice, members: [idÉlément], moves, supported }],
 *     shown: Map(idPortée → altérations affichées), sibling(index) }
 */
export function crossRoutes(ctx, staff, mi) {
  const sibs = ctx.siblingsOf ? ctx.siblingsOf(staff) : null;
  if (!sibs || sibs.length < 2) return null;
  const cache = ctx.memo.of('crossRoutes', sibs[0].staff, () => new Map());
  if (!cache.has(mi)) cache.set(mi, computeRoutes(ctx, sibs, mi));
  return cache.get(mi);
}

function computeRoutes(ctx, sibs, mi) {
  const isScore = (s) => getProperty(s.staff, PID.STAFF_TYPE) === 'score';
  const raws = sibs.map((s) => (isScore(s) ? sequentialEntries(s.staff, mi, ctx) : []));
  if (!raws.some((raw) => raw.some((e) => staffMoveOf(e.item) !== 0))) return null;
  const byBeat = ctx.style(SID.BEAM_BY_BEAT);
  const relocated = new Map();
  const crossGroups = [];
  const crossMembers = new Map();
  const validTarget = (k, move) => move !== 0 && sibs[k + move] && isScore(sibs[k + move]);

  raws.forEach((raw, k) => {
    for (const voice of new Set(raw.map((e) => e.voice))) {
      const list = raw.filter((e) => e.voice === voice);
      const groups = buildBeamGroups(list, ctx.timeSigs[mi], ctx.beamGroupings[mi], ctx.offsets[mi], byBeat);
      const groupOf = new Map();
      for (const g of groups) for (const i of g) groupOf.set(i, g);
      const moveAt = list.map((e) => (validTarget(k, staffMoveOf(e.item)) ? staffMoveOf(e.item) : 0));
      // groupes croisés PORTÉS : membres sur exactement deux portées voisines (`crossbeam.js`)
      const crossOf = new Map(); // indice → { group, lower }
      groups.forEach((g, gi) => {
        const moves = g.map((j) => moveAt[j]);
        if (moves.every((m) => m === moves[0])) return;
        const gid = `c${k}v${voice}g${gi}m${mi}`;
        const staffsOf = new Set(g.map((j) => k + moveAt[j]));
        const lowerK = Math.max(...staffsOf);
        const supported = staffsOf.size === 2 && lowerK - Math.min(...staffsOf) === 1;
        crossGroups.push({ id: gid, staff: sibs[k].staff, staffIndex: k, voice, members: g.map((j) => list[j].item.id), moves, supported });
        if (supported) for (const j of g) crossOf.set(j, { group: gid, lower: k + moveAt[j] === lowerK, move: moveAt[j], staffK: k + moveAt[j] });
      });
      // mouvement de chaque élément après décision : 0 = reste, ±1 = relocalisé (groupe homogène ou croisé porté)
      const decided = list.map((_, i) => {
        if (crossOf.has(i)) return moveAt[i];
        const g = groupOf.get(i);
        if (!g) return moveAt[i];
        const moves = g.map((j) => moveAt[j]);
        return moves.every((m) => m === moves[0]) ? moves[0] : 0;
      });
      let lane = null;
      list.forEach((e, i) => {
        const m = decided[i];
        const cross = crossOf.get(i);
        if (cross) {
          // membre d'une ligature croisée : relocalisé s'il est déplacé, mais sans « voie » (il reste dans la liste de sa voix)
          crossMembers.set(e.item.id, cross);
          if (m !== 0) relocated.set(e.item.id, { move: m, lane: null, target: k + m, from: k, cross: cross.group });
          lane = null;
          return;
        }
        if (m === 0) { lane = null; return; }
        // un « pas » de relocalisation = série d'éléments consécutifs de la voix qui vont du même côté : ils (et eux seuls) se ligaturent sur la cible
        if (lane === null || lane.move !== m) lane = { move: m, id: `x${k}v${voice}i${i}` };
        relocated.set(e.item.id, { move: m, lane: lane.id, target: k + m, from: k });
      });
    }
  });

  // altérations : l'état d'une portée est commun à toutes ses voix ET aux accords qui y sont relocalisés (`Measure::findAccidental`, portée cible)
  const shown = new Map();
  sibs.forEach((s, t) => {
    if (!isScore(s)) return;
    const own = raws[t].filter((e) => !relocated.has(e.item.id));
    const incoming = raws.flatMap((raw) => raw.filter((e) => relocated.get(e.item.id)?.target === t));
    const conv = s.ctx.transposition ? { iv: s.ctx.transposition.iv, prefer: s.ctx.transposition.prefer, concertKey: s.ctx.transposition.concertKeys[mi] } : null;
    const entries = [...own, ...incoming].map((e) => {
      const item = conv && e.item.type === 'chord' ? writtenChord(e.item, conv) : e.item;
      return { ...e, item, graces: item.type === 'chord' ? gracesOf(item) : undefined };
    });
    shown.set(s.staff.id, resolveAccidentals(entries, s.ctx.keySigs[mi]));
  });
  return { relocated, crossMembers, crossGroups, shown, sibling: (k) => sibs[k] };
}
