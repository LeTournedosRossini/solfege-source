/*
 * Pédale (CC64) et let ring — port de la chaîne de MuseScore 4.7.5 (voir claude/tranche-pedale-lecture-fait.md) :
 *  - `SpannersMetaParser::doParse` : PEDAL et LET_RING → articulation `Pedal` ; sans motif « Pedal » dans le profil (vents / général) → rien ;
 *  - `ChordArticulationsParser::parseSpanners` : une pédale vaut pour TOUS les accords de la PISTE (`isMultiStaffSpanner`), un let ring pour sa portée ;
 *    `SpannerFilter::isPlayable` (durée réelle ≠ 0, la ligne recouvre l'accord, bornes strictes) ; UNE seule articulation Pedal par accord (la 1re) ;
 *  - `SpannerMap::collectIntervals` : par piste et par type, quand la ligne précédente finit à ou après le début de la suivante, elle est RACCOURCIE à
 *    1 tick (1/1920 de ronde) avant ce début ; l'accord est cherché dans les intervalles raccourcis (test inclusif) ;
 *  - `FluidSequencer::addPedalEvent` : CC64 = 127 au début de la ligne, CC64 = 0 à sa fin (moins la pause posée à cette fin) ;
 *  - reprises : `positionTickOffset` du passage joué, sans coupure à la frontière (une pédale à cheval sur un saut est datée avec le décalage du
 *    passage où se trouve l'accord).
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { absolutePosition } from '../model/tempomap.js';
import { itemDuration, measureLengthOf } from '../model/timing.js';
import { pedalPlays } from '../model/pedal.js';
import { fAdd, fSub, fCmp, frac, ZERO } from '../model/fraction.js';

/** Un tick de MuseScore (`DIVISION` 480 par noire) en fraction de ronde. */
export const PEDAL_TICK = frac(1, 1920);

/** Position de chaque accord ET silence d'une portée (toutes voix) : Map(id → { start, end }), en fractions absolues du Mouvement. */
export function chordRanges(staff, mv, layout) {
  const range = new Map();
  for (const voice of staff.voices) {
    voice.measures.forEach((measure, mi) => {
      if (!measure || mi >= layout.ids.length) return;
      const length = measureLengthOf(mv.masterbars[mi]);
      let t = ZERO;
      for (const it of measure.items) {
        const d = itemDuration(it, length);
        if (it.type === 'chord' || it.type === 'rest') range.set(it.id, { start: fAdd(layout.starts[mi], t), end: fAdd(layout.starts[mi], fAdd(t, d)) });
        t = fAdd(t, d);
      }
    });
  }
  return range;
}

/** Ids des accords couverts par une ligne de palm mute jouable (`PID.TECH_LINES`, type `palmMute`, du début de l'accord de départ à la fin de l'accord d'arrivée). */
export function palmMuteChords(staves, mv, layout) {
  const out = new Set();
  for (const staff of staves) {
    const lines = (getProperty(staff, PID.TECH_LINES) ?? []).filter((l) => l.type === 'palmMute' && l.play !== false);
    if (!lines.length) continue;
    const range = chordRanges(staff, mv, layout);
    for (const l of lines) {
      const a = range.get(l.startChordId);
      const b = range.get(l.endChordId);
      if (!a || !b || fCmp(b.end, a.start) < 0) continue;
      for (const [id, r] of range) if (fCmp(r.start, a.start) >= 0 && fCmp(r.start, b.end) < 0) out.add(id);
    }
  }
  return out;
}

/**
 * Lignes de type pédale d'une piste dans un Mouvement, avec leur intervalle raccourci.
 * @returns {{ id, kind: 'pedal'|'letRing', staffId, start, end, stop, play }[]} triées par début réel (égalité : pédale avant let ring, puis portée, puis liste)
 */
export function pedalLines(staves, mv, layout) {
  const lines = [];
  let seq = 0;
  staves.forEach((staff, staffOrder) => {
    for (const p of getProperty(staff, PID.PEDALS) ?? []) {
      const start = absolutePosition(layout, p.startMeasureId, p.startPosition);
      const end = absolutePosition(layout, p.endMeasureId, p.endPosition);
      if (!start || !end) continue;
      lines.push({ id: p.id, kind: 'pedal', staffId: staff.id, start, end, stop: end, play: pedalPlays(p), staffOrder, seq: seq++ });
    }
    const rings = (getProperty(staff, PID.TECH_LINES) ?? []).filter((l) => l.type === 'letRing');
    if (!rings.length) return;
    const range = chordRanges(staff, mv, layout);
    for (const l of rings) {
      const a = range.get(l.startChordId);
      const b = range.get(l.endChordId);
      if (!a || !b || fCmp(b.end, a.start) < 0) continue;
      lines.push({ id: l.id, kind: 'letRing', staffId: staff.id, start: a.start, end: b.end, stop: b.end, play: l.play !== false, staffOrder, seq: seq++ });
    }
  });
  // raccourcissement (collectIntervals) : par type, dans l'ordre des débuts ; seule la dernière ligne du groupe est comparée
  const order = (a, b) => fCmp(a.start, b.start) || a.staffOrder - b.staffOrder || a.seq - b.seq;
  for (const kind of ['pedal', 'letRing']) {
    let prev = null;
    for (const line of lines.filter((l) => l.kind === kind).sort(order)) {
      if (prev && fCmp(prev.stop, line.start) >= 0) prev.stop = fSub(line.start, PEDAL_TICK);
      prev = line;
    }
  }
  return lines.sort((a, b) => fCmp(a.start, b.start) || (a.kind === b.kind ? 0 : a.kind === 'pedal' ? -1 : 1) || a.staffOrder - b.staffOrder || a.seq - b.seq);
}

/** Ligne qui s'applique à un accord de la portée `staffId` occupant [start, end[ (la 1re), ou null. */
export function pedalForChord(lines, staffId, start, end) {
  for (const l of lines) {
    if (!l.play || (l.kind === 'letRing' && l.staffId !== staffId)) continue;
    if (fCmp(l.end, l.start) === 0 || !(fCmp(l.end, start) > 0 && fCmp(l.start, end) < 0)) continue; // isPlayable
    if (fCmp(l.stop, start) >= 0 && fCmp(l.start, end) <= 0) return l; // IntervalTree::findOverlapping (bornes incluses)
  }
  return null;
}

/**
 * Passages joués d'un Mouvement → fonction `utime(u)` (`RepeatList::utick2utime`) : `u` = position « jouée » (fraction : position de la partition +
 * décalage du passage), résultat en secondes depuis le début du Mouvement (pauses des sauts comprises) ; u < 0 → 0 ; le dernier passage est ouvert.
 * @param segs  [{ u (début joué), tick (début dans la partition), t (secondes du début du passage) }]
 */
export function makeUtime(segs, secondsAt) {
  return (u) => {
    if (fCmp(u, ZERO) < 0 || !segs.length) return 0;
    let j = 0;
    for (let i = 0; i < segs.length; i++) { if (fCmp(segs[i].u, u) <= 0) j = i; else break; }
    const s = segs[j];
    return s.t + secondsAt(fAdd(fSub(u, s.u), s.tick)) - secondsAt(s.tick);
  };
}
