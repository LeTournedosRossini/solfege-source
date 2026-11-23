/*
 * Colonnes cliquables pour la saisie de notes dans une voix. PUR : aucun DOM, aucune écriture.
 *
 * Port de `getNextValidInputSegment` + de la boucle de `Score::getPosition` (MuseScore 4.7.5, `dom/score.cpp`, lus) : les « segments » sont
 * les instants de TOUTE la mesure (toutes portées, toutes voix) ; pour une voix donnée un instant est valable s'il porte un élément de CETTE
 * voix (silence « trou » compris), ou — voix 2 à 4 seulement — s'il tombe exactement à la FIN du dernier élément de la voix qui le précède
 * (début de mesure si la voix n'a encore rien) : on peut ainsi prolonger une voix, ou la commencer, mais pas se poser n'importe où.
 */
import { fCmp, fEq, fLt } from '../model/fraction.js';

/**
 * @param instants   début de chaque segment de la mesure, toutes portées confondues (fractions, dans n'importe quel ordre, doublons permis)
 * @param voiceItems éléments de la voix choisie dans la portée : [{ start, end }]
 * @param voice      index de voix (0 à 3)
 * @returns {Array} positions valables, triées
 */
export function inputColumns(instants, voiceItems, voice) {
  const segs = [];
  for (const t of instants) if (!segs.some((s) => fEq(s, t))) segs.push(t);
  segs.sort(fCmp);
  if (!segs.length) return [];
  const has = (t) => voiceItems.some((e) => fEq(e.start, t));
  const nextValid = (i) => {
    if (i >= segs.length) return -1;
    let nextTick = segs[0]; // début de mesure
    for (let k = i; k >= 0; k -= 1) {
      const e = voiceItems.find((it) => fEq(it.start, segs[k]));
      if (e) { nextTick = e.end; break; }
    }
    for (let j = i; j < segs.length; j += 1) if (has(segs[j]) || (voice > 0 && fEq(segs[j], nextTick))) return j;
    return -1;
  };
  const out = [];
  for (let s = nextValid(0); s >= 0; s = nextValid(s + 1)) out.push(segs[s]);
  return out;
}

/** Début le plus proche à gauche : utile aux tests. */
export const lastBefore = (list, t) => list.filter((p) => !fLt(t, p)).pop() ?? null;
