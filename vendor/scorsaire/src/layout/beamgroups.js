/*
 * Groupement des ligatures — port de MuseScore : `dom/groups.cpp` (`Groups`, `baseBeamMode`, `actualBeamMode`, tables `noteGroups`)
 * et `rendering/score/beamlayout.cpp` (`createBeams`, `calcBeamBreaks`, `calcIsBeamletBefore`). Lus dans le dépôt cloné, jamais devinés.
 *
 * Temps en « ticks » de MuseScore (DIVISION = 480 par noire, donc 1920 par ronde) UNIQUEMENT ici, pour lire les tables `Groups`
 * (positions en 32es, mode par valeur de note) : les fractions du modèle sont converties à l'entrée (règle du projet : jamais de
 * flottants ; les ticks entiers ne servent ici qu'à indexer la table).
 *
 * Un accord dont le partenaire est dans un autre groupe, les silences ligaturés (`beamThroughRest`), les ligatures entre mesures
 * et les notes d'ornement ne sont pas portés.
 */
import { PID, getProperty, writtenDuration, frac, fAdd } from '../model/index.js';

const TPW = 1920; // ticks par ronde
export const DIVISION = 480; // ticks par noire
const ticksOf = ([n, d]) => Math.trunc((n * TPW) / d);

// DurationType de MuseScore (ordre de l'énumération : plus grand = plus court) ; V_INVALID à part
const TYPE_INDEX = { breve: 1, whole: 2, half: 3, quarter: 4, eighth: 5, sixteenth: 6, thirtysecond: 7, sixtyfourth: 8 };
const V_QUARTER = 4;
const V_EIGHTH = 5;
const V_16TH = 6;
const V_32ND = 7;
const V_64TH = 8;
const V_INVALID = 15;
const TYPE_BASE_TICKS = { 1: 3840, 2: 1920, 3: 960, 4: 480, 5: 240, 6: 120, 7: 60, 8: 30, 9: 15 };
export const hooksOfType = (t) => (t >= V_EIGHTH && t <= 12 ? t - 4 : 0);
/** Nombre de crochets de la valeur qui a cette durée (`TDuration(ticks).hooks()`). */
export const hooksOfTicks = (ticks) => hooksOfType(typeOfTicks(ticks));

/** `TDuration::ticks` : valeur ÉCRITE (points compris) ; -1 pour V_INVALID. */
export function durTicks(d) {
  if (d.val === V_INVALID) return -1;
  let t = TYPE_BASE_TICKS[d.val];
  let add = t;
  for (let i = 0; i < d.dots; i++) {
    add /= 2;
    t += add;
  }
  return t;
}

/** Type de valeur d'une durée en ticks (`TDuration(Fraction)`, valeurs exactes ou pointées ; sinon la plus grande valeur qui tient). */
function typeOfTicks(ticks) {
  for (let v = 1; v <= 9; v++) {
    const b = TYPE_BASE_TICKS[v];
    let t = b;
    let add = b;
    for (let dots = 0; dots <= 3; dots++) {
      if (t === ticks) return v;
      add /= 2;
      t += add;
    }
  }
  for (let v = 1; v <= 9; v++) if (TYPE_BASE_TICKS[v] <= ticks) return v;
  return V_INVALID;
}

/** `TDuration::operator<` : « plus court » (plus grande valeur d'énumération ; à valeur égale, moins de points). */
const durLess = (a, b) => (b.val < a.val ? true : b.val === a.val && a.dots < b.dots);
const durMin = (a, b) => (durLess(b, a) ? b : a);

// ---------- tables `noteGroups` (positions en 32es ; action = un quartet par valeur : croche, double, 32e et plus courtes) ----------
const N = (pairs) => pairs.map(([pos, action]) => ({ pos, action }));
const T = {
  '2/2': N([[4, 0x200], [8, 0x110], [12, 0x200], [16, 0x111], [20, 0x200], [24, 0x110], [28, 0x200]]),
  '3/2': N([[4, 0x200], [8, 0x110], [12, 0x200], [16, 0x111], [20, 0x200], [24, 0x110], [28, 0x200], [32, 0x111], [36, 0x200], [40, 0x110], [44, 0x200]]),
  '4/2': N([[4, 0x200], [8, 0x110], [12, 0x200], [16, 0x111], [20, 0x200], [24, 0x110], [28, 0x200], [32, 0x111], [36, 0x200], [40, 0x110], [44, 0x200], [48, 0x111], [52, 0x200], [56, 0x110], [60, 0x200]]),
  '2/4': N([[4, 0x200], [8, 0x111], [12, 0x200]]),
  '3/4': N([[4, 0x200], [8, 0x111], [12, 0x200], [16, 0x111], [20, 0x200]]),
  '4/4': N([[4, 0x200], [8, 0x110], [12, 0x200], [16, 0x111], [20, 0x200], [24, 0x110], [28, 0x200]]),
  '5/4': N([[4, 0x200], [8, 0x110], [12, 0x200], [16, 0x110], [20, 0x200], [24, 0x111], [28, 0x200], [32, 0x110], [36, 0x200]]),
  '6/4': N([[4, 0x200], [8, 0x110], [12, 0x200], [16, 0x110], [20, 0x200], [24, 0x111], [28, 0x200], [32, 0x110], [36, 0x200], [40, 0x110], [44, 0x200]]),
  '3/8': N([[4, 0x200], [8, 0x200]]),
  '5/8': N([[4, 0x200], [8, 0x200], [12, 0x111], [16, 0x200]]),
  '6/8': N([[4, 0x200], [8, 0x200], [12, 0x111], [16, 0x200], [20, 0x200]]),
  '7/8': N([[4, 0x200], [8, 0x200], [12, 0x111], [16, 0x200], [20, 0x111], [24, 0x200]]),
  '9/8': N([[4, 0x200], [8, 0x200], [12, 0x111], [16, 0x200], [20, 0x200], [24, 0x111], [28, 0x200], [32, 0x200]]),
  '12/8': N([[4, 0x200], [8, 0x200], [12, 0x111], [16, 0x200], [20, 0x200], [24, 0x111], [28, 0x200], [32, 0x200], [36, 0x111], [40, 0x200], [44, 0x200]]),
};

/**
 * Nœuds de groupement d'un chiffrage (`Groups::endings`) : table de MuseScore si le chiffrage y figure, sinon un arrêt total (0x111)
 * à chaque unité du dénominateur ; `beamGrouping` (propriété du masterbar : longueurs en unités du dénominateur) impose des arrêts
 * totaux aux limites de ses groupes.
 */
export function groupNodes([num, den], beamGrouping = null, byBeat = false) {
  if (beamGrouping && beamGrouping.length) {
    const unit = 32 / den;
    let at = 0;
    const nodes = [];
    for (const n of beamGrouping.slice(0, -1)) {
      at += n * unit;
      nodes.push({ pos: at, action: 0x111 });
    }
    return nodes;
  }
  const key = `${num}/${den}`;
  if (T[key] && !(byBeat && (den === 4 || den === 2))) return T[key];
  const pos = { 2: 16, 4: 8, 8: 4, 16: 2, 32: 1 }[den] ?? 0;
  const nodes = [];
  for (let i = 1; i < num; i++) nodes.push({ pos: pos * i, action: 0x111 });
  return nodes;
}

/** `Groups::beamMode(tick, d)` : 'auto' | 'begin' | 'begin16' | 'begin32'. */
function nodeMode(nodes, tick, type) {
  let shift;
  if (type === V_EIGHTH) shift = 0;
  else if (type === V_16TH) shift = 4;
  else if (type >= V_32ND && type <= 12) shift = 8;
  else return 'auto';
  for (const e of nodes) {
    if (e.pos * 60 < tick) continue;
    if (e.pos * 60 > tick) break;
    const action = (e.action >> shift) & 0xf;
    return ['auto', 'begin', 'begin16', 'begin32'][action] ?? 'auto';
  }
  return 'auto';
}

/**
 * Description d'un élément pour le groupement : { rest, dur: {val, dots}, rtick (ticks), actual (ticks), tupletId, tupletSpan (ticks),
 * tupletStart (ticks), tupletOdd, voice, begin }.
 * @param entry  { item, position, duration, tremoloPair? } ; `tremoloPair.writtenBase` = valeur écrite (doublée) d'un couple de trémolo
 */
export function beamInfoOf(entry) {
  const { item } = entry;
  const isChord = item.type === 'chord';
  const d = getProperty(item, PID.DURATION);
  const base = entry.tremoloPair ? entry.tremoloPair.writtenBase : d.base;
  const tuplet = getProperty(item, PID.TUPLET);
  return {
    rest: !isChord,
    beamThrough: Boolean(!isChord && getProperty(item, PID.BEAM_THROUGH)),
    dur: { val: TYPE_INDEX[base] ?? V_INVALID, dots: d.dots ?? 0 },
    rtick: ticksOf(entry.position),
    actual: ticksOf(entry.duration),
    tupletId: tuplet ? tuplet.id : null,
    tupletSpan: tuplet ? ticksOf(writtenDuration(tuplet.base)) * tuplet.ratio[1] : 0,
    tupletRatio: tuplet ? tuplet.ratio : null,
    tupletStart: 0, // posé par `buildBeamGroups` (début du n-olet)
    voice: entry.voice ?? 0,
    begin: Boolean(isChord && getProperty(item, PID.BEAM_BREAK)),
  };
}

/** `Groups::baseBeamMode`. `cr`, `prev` : descriptions (`beamInfoOf`) ; `override` : durée à la place de celle de `cr` (sous-division du temps). */
function baseBeamMode(nodes, cr, prev, anacrusis, override = null) {
  if (cr.begin) return 'begin';
  const crDur = override ?? cr.dur;
  const crTicks = durTicks(crDur);
  const maxTickLen = Math.max(crTicks, prev ? durTicks(prev.dur) : 0);
  let smallest = 240;
  while (smallest > maxTickLen || cr.rtick % smallest !== 0) {
    smallest /= 2;
    if (smallest < 60) {
      smallest = crTicks;
      break;
    }
  }
  const bigBeat = typeOfTicks(smallest);
  const tick = cr.rtick + anacrusis;
  const byType = nodeMode(nodes, tick, crDur.val);
  const byPos = nodeMode(nodes, tick, bigBeat);
  let val = byType === 'auto' ? byPos : byType;
  if (val === 'auto' && tick !== 0) {
    // ni l'un ni l'autre dans le même n-olet, et même valeur : on considère la valeur suivante plus courte
    if (prev && cr.tupletId !== prev.tupletId && crDur.val === prev.dur.val && crDur.dots === prev.dur.dots) {
      if (crDur.val <= V_EIGHTH) val = nodeMode(nodes, tick, V_16TH);
      else if (crDur.val === V_16TH) val = nodeMode(nodes, tick, V_32ND);
      else val = nodeMode(nodes, tick, V_64TH);
    }
    // trou entre l'élément précédent et celui-ci (voix supérieures à la première) : on coupe
    if (cr.voice && prev && !prev.tupletId && prev.rtick + prev.actual < cr.rtick) val = 'begin';
  }
  return val;
}

/** `Groups::actualBeamMode` : 'none' | 'begin' | 'begin16' | 'begin32' | 'mid'. */
function actualBeamMode(nodes, cr, prev, den, anacrusis, beatSub) {
  // un silence coupe la ligature, sauf s'il est « ligaturé » (mode MID de MuseScore : renvoyé tel quel par `baseBeamMode`)
  if (cr.rest) return cr.beamThrough ? 'mid' : 'none';
  if (cr.dur.val <= V_QUARTER) return 'none'; // pas de crochet : jamais ligaturé
  let bm = baseBeamMode(nodes, cr, prev, anacrusis);
  if (bm === 'auto') {
    if (cr.rtick === 0) return 'begin';
    if (den === 4 && cr.rtick % DIVISION === 0) {
      const beat = cr.rtick / DIVISION;
      const cur = beatSub.get(beat) ?? { val: V_INVALID, dots: 0 };
      const prv = beatSub.get(beat - 1) ?? { val: V_INVALID, dots: 0 };
      bm = baseBeamMode(nodes, cr, prev, anacrusis, durMin(cur, prv));
    }
  }
  return bm === 'auto' ? 'mid' : bm;
}

const isMidMode = (m) => m === 'mid' || m === 'begin16' || m === 'begin32';

/**
 * Groupes de ligature d'une voix (`BeamLayout::createBeams`).
 * @param entries  éléments de la voix dans l'ordre : { position, duration, item, voice, tremoloPair? }
 * @returns tableaux d'indices dans `entries` (deux éléments au moins) ; chacun porte `infos` (descriptions `beamInfoOf`, par membre)
 *          et `defaults` (`baseBeamMode` du membre par rapport au précédent du groupe : 'begin16' / 'begin32' coupent les barres
 *          secondaires ; null pour le 1er)
 */
export function buildBeamGroups(entries, timeSig, beamGrouping, offset, byBeat = false) {
  const den = timeSig[1];
  const nodes = groupNodes(timeSig, beamGrouping, byBeat);
  const anacrusis = ticksOf(offset);
  const infos = entries.map(beamInfoOf);
  const tupletStarts = new Map();
  for (const c of infos) if (c.tupletId && !(tupletStarts.get(c.tupletId) <= c.rtick)) tupletStarts.set(c.tupletId, c.rtick);
  for (const c of infos) if (c.tupletId) c.tupletStart = tupletStarts.get(c.tupletId);
  // sous-division de chaque temps (mesure en X/4) : la plus courte valeur écrite qui y attaque
  const beatSub = new Map();
  if (den === 4) {
    for (const c of infos) {
      const beat = Math.trunc(c.rtick / DIVISION);
      beatSub.set(beat, beatSub.has(beat) ? durMin(beatSub.get(beat), c.dur) : c.dur);
    }
  }
  const groups = [];
  let a1 = null;
  let beam = null;
  let prev = null;
  entries.forEach((entry, i) => {
    const cr = infos[i];
    const bm = actualBeamMode(nodes, cr, prev, den, anacrusis, beatSub);
    prev = cr;
    const canBeBeamed = cr.dur.val > V_QUARTER || cr.rest;
    if (!canBeBeamed || bm === 'none') {
      if (beam) groups.push(beam);
      beam = null;
      a1 = null;
      return;
    }
    let consumed = false;
    if (beam) {
      if (bm !== 'begin') {
        beam.push(i);
        consumed = true;
      } else {
        groups.push(beam);
        beam = null;
      }
    }
    if (consumed) return;
    if (a1 === null) {
      a1 = i;
    } else if (!isMidMode(bm) && (bm === 'begin' || infos[a1].rtick + infos[a1].actual < cr.rtick)) {
      a1 = i;
    } else {
      beam = [a1, i];
      a1 = null;
    }
  });
  if (beam) groups.push(beam);
  const built = groups.filter((g) => g.length >= 2 && g.some((i) => !infos[i].rest)); // `Beam::hasAllRests` : pas de ligature de silences seuls
  // un couple de trémolo n'est ligaturé que si ses DEUX accords sont dans le même groupe (`chord1->beam() == chord2->beam()`)
  const groupOf = new Map();
  built.forEach((g, gi) => g.forEach((i) => groupOf.set(i, gi)));
  const kept = [];
  built.forEach((g, gi) => {
    const f = g.filter((i) => {
      const t = entries[i].tremoloPair;
      return !t || groupOf.get(t.role === 'first' ? i + 1 : i - 1) === gi;
    });
    if (f.length < 2) return;
    f.infos = f.map((i) => infos[i]);
    f.defaults = f.map((i, k) => (k === 0 ? null : baseBeamMode(nodes, infos[i], infos[f[k - 1]], anacrusis)));
    kept.push(f);
  });
  return kept;
}

/**
 * Points d'interruption d'une voix pour l'alignement des silences (`RestLayout::computeInterruptionPoints`, `interruptHere`) :
 * pour chaque élément de la voix, vrai si un groupe de ligature commence là (durée > 1/8, `beamBreak`, ou début de groupe du chiffrage).
 * Un élément ligaturé (`beamThrough`, mode MID) ou qui reprend une ligature (begin16 / begin32) n'interrompt pas.
 * @param entries  éléments de la voix dans l'ordre : { position, duration, item, voice }
 * @returns tableau de booléens, un par élément
 */
export function restInterruptions(entries, timeSig, beamGrouping, offset, byBeat = false) {
  const nodes = groupNodes(timeSig, beamGrouping, byBeat);
  const anacrusis = ticksOf(offset);
  return entries.map((entry) => {
    const cr = beamInfoOf(entry);
    if (cr.actual > DIVISION / 2) return true; // `crTicks > 1/8` (ronde = 4 × DIVISION)
    if (cr.rest && cr.beamThrough) return false; // mode MID
    return baseBeamMode(nodes, cr, null, anacrusis) === 'begin';
  });
}
