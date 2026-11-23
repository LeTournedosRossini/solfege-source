/*
 * Déroulé des reprises, voltas et sauts — ordre dans lequel les mesures d'un Mouvement sont JOUÉES.
 * Port de `RepeatList::unwind` / `collectRepeatListElements` / `findMarker` / `performJump` de MuseScore 4.7.5
 * (`src/engraving/dom/repeatlist.cpp`, relu en entier ; les commentaires `test::repeatNN` renvoient aux jeux d'essai de MuseScore).
 * Fonction pure : lit le Mouvement (masterbars, voltas, sauts, marqueurs), n'écrit rien, ne connaît ni le temps ni l'audio.
 *
 * Règles reprises de MuseScore :
 *  - une reprise est jouée `repeatCount` fois (PID.REPEAT_COUNT du masterbar de la barre de fin, 2 par défaut) ;
 *  - une volta n'est jouée qu'aux passages qu'elle numérote ;
 *  - un saut n'est honoré qu'à la DERNIÈRE passe (de la reprise en cours, ou de la dernière alternative d'une volta), et une
 *    seule fois par numéro de passe ;
 *  - après le saut, les reprises de la partie rejouée ne sont jouées qu'à leur dernière passe, sauf `playRepeats` ;
 *  - atteindre le marqueur `playUntil` à sa dernière passe arrête la lecture ou la reprend à `continueAt`.
 *
 * Écarts assumés avec MuseScore : (1) un Mouvement = UNE section (pas de saut de section : décision de Jean, 08/10/2026) ;
 * la pause entre Mouvements est PID.PAUSE du Mouvement (voir `unwindWork`) ; (2) dans une même mesure, les marqueurs sont
 * traités avant les sauts (MuseScore en dépend de l'ordre des éléments de la mesure puis les replace de la même façon).
 */
import { PID, PID_TABLE } from './pid.js';
import { jumpLabels, jumpPlaysRepeats, markerLabel, isRightMarker } from './repeats.js';

const v = (el, pid) => (Object.hasOwn(el.props, pid) ? el.props[pid] : PID_TABLE[pid].default);

// Types d'éléments de la liste de déroulé (RepeatListElementType)
const SECTION_BREAK = 'sectionBreak';
const VOLTA_START = 'voltaStart';
const VOLTA_END = 'voltaEnd';
const REPEAT_START = 'repeatStart';
const REPEAT_END = 'repeatEnd';
const JUMP = 'jump';
const MARKER = 'marker';

/** RepeatListElement : `count` démarre à 1 pour un début de reprise, 0 sinon. */
function rle(type, element, mi) {
  return { type, element, mi, count: type === REPEAT_START ? 1 : 0 };
}

/** RepeatSegment : suite CONTIGUË de mesures (indices), jouée `playbackCount`-ième fois. */
class Segment {
  constructor(playbackCount) {
    this.playbackCount = playbackCount;
    this.measures = [];
    this.pause = 0;
  }
  isEmpty() { return this.measures.length === 0; }
  addMeasure(mi) {
    if (this.measures.length === 0 || this.measures[this.measures.length - 1] !== mi) this.measures.push(mi);
  }
  /** Étend ou raccourcit la liste jusqu'à `mi` inclus. */
  addMeasures(mi) {
    if (this.measures.length) {
      let next = this.measures[this.measures.length - 1] + 1;
      if (next < mi) {
        while (next !== mi) this.measures.push(next++);
      }
      while (this.measures.length && this.measures[this.measures.length - 1] >= mi) this.measures.pop();
    }
    this.addMeasure(mi);
  }
  popMeasure() { this.measures.pop(); }
}

const lastEnding = (volta) => (volta.endings.length ? volta.endings[volta.endings.length - 1] : 0);
const firstEnding = (volta) => (volta.endings.length ? volta.endings[0] : 0);
const hasEnding = (volta, n) => volta.endings.includes(n);

/** Voltas du Mouvement → { start, end, endings (triés), open } en indices de mesure, puis fusion des chevauchements (comme MuseScore). */
function preprocessVoltas(mv, barIndex) {
  const raw = [];
  for (const vo of mv.voltas) {
    const start = barIndex(v(vo, PID.MEASURE_ID));
    const span = v(vo, PID.SPAN);
    if (start < 0 || span < 1) continue;
    raw.push({ start, end: start + span - 1, endings: [...v(vo, PID.VOLTA_NUMBERS)].sort((a, b) => a - b), open: v(vo, PID.VOLTA_OPEN) });
  }
  raw.sort((a, b) => a.start - b.start); // MuseScore suppose les spanners triés du premier au dernier

  const pre = [];
  for (const src of raw) {
    let volta = { ...src, endings: [...src.endings] };
    if (!pre.length) {
      pre.push(volta);
      continue;
    }
    const toMerge = [];
    while (pre.length && volta.start <= pre[pre.length - 1].end) toMerge.push(pre.pop());
    while (toMerge.length) {
      const back = toMerge[toMerge.length - 1];
      let remainder = { ...back, endings: [...back.endings] };
      if (volta.start !== remainder.start) {
        // la partie qui précède reste telle quelle, le reste est fusionné
        back.end = volta.start - 1;
        remainder.start = volta.start;
        pre.push(back);
      }
      toMerge.pop();
      // remainder et volta commencent au même endroit : celle qui finit en premier passe en `remainder`
      if (volta.end < remainder.end) [volta, remainder] = [remainder, volta];
      remainder.endings = remainder.endings.filter((e) => hasEnding(volta, e));
      pre.push(remainder);
      if (volta.end !== remainder.end) {
        volta.start = remainder.end + 1; // le reste de la volta commence après `remainder`
      } else {
        pre.push(...toMerge);
        toMerge.length = 0;
        volta = null;
      }
    }
    if (volta) pre.push(volta);
  }
  return pre;
}

/** Liste des éléments qui influencent l'ordre de lecture (`collectRepeatListElements`), pour UNE section. */
function collectElements(mv, barIndex) {
  const bars = mv.masterbars;
  const list = [];
  let startRef = rle(REPEAT_START, bars[0], 0);
  list.push(startRef);

  const pre = preprocessVoltas(mv, barIndex);
  const markersAt = new Map();
  const jumpsAt = new Map();
  for (const m of mv.markers) {
    const i = barIndex(v(m, PID.MEASURE_ID));
    if (i >= 0) (markersAt.get(i) ?? markersAt.set(i, []).get(i)).push(m);
  }
  for (const j of mv.jumps) {
    const i = barIndex(v(j, PID.MEASURE_ID));
    if (i >= 0) (jumpsAt.get(i) ?? jumpsAt.set(i, []).get(i)).push(j);
  }

  let volta = null;
  for (let mi = 0; mi < bars.length; mi++) {
    const bar = bars[mi];
    // Volta qui commence
    if (pre.length && pre[0].start === mi) {
      if (volta) list.push(rle(VOLTA_END, volta, mi - 1)); // volta ouverte qui devait finir avant nous
      volta = pre.shift();
      list.push(rle(VOLTA_START, volta, mi));
    }
    // Début de reprise
    if (v(bar, PID.REPEAT_START)) {
      if (volta && volta.start !== mi) {
        list.push(rle(VOLTA_END, volta, mi - 1));
        volta = null;
      }
      startRef = rle(REPEAT_START, bar, mi);
      list.push(startRef);
    }
    // Marqueurs (insérés avant les sauts, marqueurs à droite après les marqueurs à gauche), puis sauts
    for (const m of markersAt.get(mi) ?? []) {
      const entry = rle(MARKER, m, mi);
      const right = isRightMarker(m);
      let at = list.length - 1;
      while (list[at].mi === mi) {
        let goBefore = false;
        if (list[at].type === MARKER && !right) goBefore = isRightMarker(list[at].element);
        if (goBefore || list[at].type === JUMP) {
          if (at === 0) break; // la liste commence toujours par un REPEAT_START
          at--;
        } else break;
      }
      list.splice(at + 1, 0, entry);
    }
    for (const j of jumpsAt.get(mi) ?? []) {
      list.push(rle(JUMP, j, mi));
      if (volta) {
        if (volta.end < mi || (volta.end === mi && volta.open)) {
          // la volta devait finir avant nous, ou une volta ouverte finit avec nous
          if (!v(bar, PID.REPEAT_END)) { // sinon la barre de reprise de fin l'inclut (#327681)
            list.push(rle(VOLTA_END, volta, mi));
            volta = null;
          }
        }
      }
    }
    // Fin de reprise
    if (v(bar, PID.REPEAT_END)) {
      list.push(rle(REPEAT_END, bar, mi));
      startRef.count += v(bar, PID.REPEAT_COUNT) - 1;
      if (volta) {
        list.push(rle(VOLTA_END, volta, mi));
        volta = null;
      }
    }
    // Fin de volta fermée
    if (volta && volta.end === mi && !volta.open) {
      list.push(rle(VOLTA_END, volta, mi));
      volta = null;
    }
  }
  // Fin du Mouvement (= fin de section)
  if (volta) list.push(rle(VOLTA_END, volta, bars.length - 1));
  list.push(rle(SECTION_BREAK, null, bars.length - 1));
  return list;
}

/** `findMarker` pour une section unique : indice de l'élément trouvé, ou -1. « start » / « end » : début / fin de la section. */
function findMarker(list, label, refIndex) {
  if (label === 'start') return 0;
  if (label === 'end') return list.length - 1;
  const isIt = (i) => list[i].type === MARKER && markerLabel(list[i].element) === label;
  for (let i = refIndex - 1; i >= 0; i--) if (isIt(i)) return i; // d'abord vers l'arrière…
  for (let i = refIndex + 1; i < list.length; i++) if (isIt(i)) return i; // …puis vers l'avant
  return -1;
}

/** `performJump` : état du déroulé quand on arrive sur l'élément `target`. */
function performJump(list, target, withRepeats) {
  let activeVolta = null;
  let startRef = list[0];
  for (let i = 0; i < target; i++) {
    const e = list[i];
    if (e.type === VOLTA_START) activeVolta = e.element;
    else if (e.type === VOLTA_END) activeVolta = null;
    else if (e.type === REPEAT_START) startRef = e;
  }
  let playbackCount;
  if (withRepeats) {
    playbackCount = activeVolta ? firstEnding(activeVolta) || 1 : 1;
  } else if (activeVolta) {
    playbackCount = lastEnding(activeVolta) || startRef.count;
  } else {
    playbackCount = startRef.count;
  }
  return { playbackCount, activeVolta, startRef };
}

/**
 * Déroule un Mouvement.
 * @returns {{ measures: number[], playbackCount: number, pause: number }[]}  segments de lecture dans l'ordre ; `measures` = indices
 *          de masterbar consécutifs ; `pause` = 0 (la pause entre Mouvements est ajoutée par `unwindWork`).
 */
export function unwindMovement(mv, { expand = true } = {}) {
  const out = [];
  const bars = mv.masterbars;
  if (!bars.length) return out;
  // repeats off (MuseScore `RepeatList::flatten`): the measures once each, in written order — no repeat, no volta choice, no jump
  if (!expand) {
    const seg = new Segment(1);
    bars.forEach((_, i) => seg.addMeasure(i));
    return [seg];
  }
  const ids = bars.map((b) => b.id);
  const barIndex = (id) => ids.indexOf(id);
  const list = collectElements(mv, barIndex);

  const jumpsTaken = new Set();
  let playbackCount = 1;
  let ri = 0; // indice dans la liste (« repeatListElementIt »)
  let startRef = list[0];
  let activeVolta = null;
  let playUntil = -1;
  let continueAt = -1;
  let activeJump = null;
  let forceFinalRepeat = false;

  let rs = new Segment(playbackCount);
  rs.addMeasure(list[ri].mi);
  ri++;

  while (ri < list.length) {
    const e = list[ri];
    if (rs) rs.addMeasures(e.mi);
    switch (e.type) {
      case SECTION_BREAK:
        if (rs && !rs.isEmpty()) out.push(rs);
        break;
      case VOLTA_START:
        activeVolta = e.element;
        if (!hasEnding(activeVolta, playbackCount)) {
          // cette volta ne se joue pas à ce passage : on retire sa mesure et on la saute
          rs.popMeasure();
          if (!rs.isEmpty()) out.push(rs);
          do { ri++; } while (ri < list.length - 1 && list[ri].type !== VOLTA_END);
          activeVolta = null;
          const next = list[ri].mi + 1;
          if (next >= bars.length) {
            rs = null; // fin du Mouvement : le SECTION_BREAK le saura
          } else {
            rs = new Segment(playbackCount);
            rs.addMeasure(next);
          }
        }
        break;
      case VOLTA_END:
        activeVolta = null;
        break;
      case REPEAT_START:
        if (rs === null) { // envoyé ici par une barre de reprise de fin
          rs = new Segment(playbackCount);
          rs.addMeasure(e.mi);
        } else {
          const desired = forceFinalRepeat ? e.count : 1;
          if (rs.playbackCount !== desired) {
            // nouveau passage de référence : on redémarre un segment
            rs.popMeasure();
            if (!rs.isEmpty()) out.push(rs);
            playbackCount = desired;
            rs = new Segment(playbackCount);
            rs.addMeasure(e.mi);
          }
          startRef = e;
        }
        break;
      case REPEAT_END:
        e.count += 1;
        if (playbackCount < startRef.count && e.count < v(e.element, PID.REPEAT_COUNT)) {
          // honorer la reprise : retour au début
          if (rs && !rs.isEmpty()) out.push(rs);
          rs = null;
          do {
            ri--;
            if (list[ri].type === VOLTA_START) activeVolta = null;
            else if (list[ri].type === VOLTA_END) activeVolta = list[ri].element;
          } while (list[ri] !== startRef);
          playbackCount++;
          continue; // force l'évaluation du début de reprise
        }
        break;
      case JUMP: {
        if (activeJump === e.element) forceFinalRepeat = false; // on revient sur ce saut juste après l'avoir pris (test::repeat23)
        // Un saut n'est honoré qu'à la dernière passe, et une fois par numéro de passe
        if (playbackCount >= startRef.count || (activeVolta && playbackCount === lastEnding(activeVolta))) {
          const key = `${e.element.id}:${playbackCount}`;
          if (!jumpsTaken.has(key)) {
            jumpsTaken.add(key);
            const labels = jumpLabels(e.element);
            const jumpTo = findMarker(list, labels.jumpTo, ri);
            playUntil = findMarker(list, labels.playUntil, ri);
            continueAt = findMarker(list, labels.continueAt, ri);
            if (jumpTo >= 0) {
              if (rs && !rs.isEmpty()) out.push(rs);
              rs = null;
              activeJump = e.element;
              const st = performJump(list, jumpTo, jumpPlaysRepeats(activeJump));
              playbackCount = st.playbackCount;
              activeVolta = st.activeVolta;
              startRef = st.startRef;
              ri = jumpTo;
              forceFinalRepeat = !jumpPlaysRepeats(activeJump);

              // Recalculer le compteur des barres de reprise de fin (seulement s'il y a une cible de fin)
              if (playUntil >= 0) {
                for (let k = ri + 1; k < list.length; k++) {
                  if (list[k].type === REPEAT_END && list[k].count !== 0) { // déjà jouée : test::repeat22
                    list[k].count = forceFinalRepeat ? v(list[k].element, PID.REPEAT_COUNT) : 0;
                  }
                }
              }
              if (activeVolta && playbackCount < startRef.count) {
                // On a sauté dans une volta qui n'est pas la seule de ce début de reprise (test::repeat52 et 53)
                let f = ri;
                do { f--; } while (list[f] !== startRef);
                f++;
                let voltaRef = null;
                let processed = 1;
                while (f < list.length && list[f].type !== REPEAT_START && processed < startRef.count) {
                  if (list[f].type === VOLTA_START) {
                    voltaRef = list[f].element;
                    if (lastEnding(voltaRef) < playbackCount) voltaRef = null; // on ne passera plus ici
                  } else if (list[f].type === REPEAT_END) {
                    if (voltaRef) {
                      let remaining = 0;
                      for (const ending of voltaRef.endings) if (ending >= playbackCount) remaining++;
                      list[f].count = v(list[f].element, PID.REPEAT_COUNT) - remaining - 1;
                    }
                    processed += v(list[f].element, PID.REPEAT_COUNT) - 1;
                  }
                  f++;
                }
              }
              // arrivés sur le marqueur cible
              rs = new Segment(playbackCount);
              rs.addMeasure(list[ri].mi);
            }
          }
        }
        break;
      }
      case MARKER:
        if (ri === playUntil
          && (playbackCount === startRef.count || (activeVolta && playbackCount === lastEnding(activeVolta)))) {
          // dernière passe de ce marqueur
          if (rs && !rs.isEmpty()) out.push(rs);
          rs = null;
          playUntil = -1;
          forceFinalRepeat = false;
          if (continueAt >= 0) {
            const st = performJump(list, continueAt, true);
            playbackCount = st.playbackCount;
            activeVolta = st.activeVolta;
            startRef = st.startRef;
            ri = continueAt;
            if (startRef.mi !== list[ri].mi) startRef = list[ri]; // test::repeat23 m12
            rs = new Segment(playbackCount);
            rs.addMeasure(list[ri].mi);
            continueAt = -1;
          } else {
            ri = list.length; // nulle part où aller : fin du Mouvement
            continue;
          }
        }
        break;
      default:
        break;
    }
    ri++;
  }
  return out;
}

/** Liste plate des indices de mesure dans l'ordre de lecture d'un Mouvement. */
export function playOrder(mv, options) {
  return unwindMovement(mv, options).flatMap((s) => s.measures);
}

/**
 * Déroule une Œuvre : un résultat par Mouvement, dans l'ordre. `pause` du dernier segment d'un Mouvement = PID.PAUSE du Mouvement
 * (secondes), sauf pour le dernier Mouvement de l'œuvre.
 */
export function unwindWork(work) {
  return work.movements.map((mv, i) => {
    const segments = unwindMovement(mv);
    if (segments.length && i < work.movements.length - 1) segments[segments.length - 1].pause = v(mv, PID.PAUSE);
    return { movement: mv, segments };
  });
}
