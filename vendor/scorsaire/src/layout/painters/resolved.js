/*
 * Résolutions MÉMOÏSÉES par portée, communes aux peintres `score` et `tab` (tranches 3 et 4c) : paroles (côté par défaut des
 * nuances), soufflets, ties, slurs, glissandos, bends, trémolos à deux accords… Une résolution coûte un parcours de toute la portée ;
 * le résultat ne change pas au cours d'une même mise en page.
 *
 * Le mémo est rattaché au CONTEXTE de mise en page (`ctx.memo`, voir `../memo.js`) : chaque fonction prend `ctx` en 1er argument.
 * Aucun état de module (étape 5, tranche 1).
 */
import { PID, SID, getProperty, isVocalInstrument, resolveLyricLinks } from '../../model/index.js';
import { resolveStaffHairpins } from '../hairpins.js';
import { resolveStaffTies } from '../ties.js';
import { resolveStaffSlurs } from '../slurs.js';
import { resolveStaffGlissandos, resolveRunGlissandos } from '../glissandos.js';
import { resolveStaffHopos } from '../hopos.js';
import { resolveStaffBends } from '../bends.js';
import { resolveStaffTechLines } from '../techlines.js';
import { resolveStaffTrills } from '../trilllines.js';
import { resolveStaffTwoChordTremolos } from '../tremolotwo.js';

const memoOf = (kind, resolve) => (ctx, staff) => ctx.memo.of(kind, staff, resolve);

/**
 * Paroles d'une portée (model/lyrics.js) : { list: [{ link, verse, placement, syllable, chordId, endChordId }], byChord: Map(id d'accord → [paroles]) }.
 * Les textes de couplet viennent de l'œuvre (`ctx.lyricTexts`, option de `layoutMovement`).
 */
export const staffLyrics = (ctx, staff) => ctx.memo.of('lyrics', staff, (st) => {
  const list = resolveLyricLinks(getProperty(st, PID.LYRIC_LINKS), ctx.lyricTexts);
  const byChord = new Map();
  for (const r of list) { if (!byChord.has(r.chordId)) byChord.set(r.chordId, []); byChord.get(r.chordId).push(r); }
  return { list, byChord };
});

/** Une portée porte-t-elle des paroles (au moins un lien résolu) ? */
export const staffHasLyrics = (ctx, staff) => staffLyrics(ctx, staff).list.length > 0;

/**
 * Côté par défaut (nuances ET soufflets) : au-dessus si la portée porte des paroles OU si son instrument est catalogué vocal
 * (`Sid::dynamicsHairpinsAboveForVocalStaves`, engravingitem.cpp — les DEUX conditions MuseScore). `track` peut être absent.
 */
export function staffAbove(ctx, staff, track) {
  return staffHasLyrics(ctx, staff) || (track ? isVocalInstrument(track) : false);
}

export const staffHairpins = memoOf('hairpins', resolveStaffHairpins);
export const staffTrills = memoOf('trills', resolveStaffTrills);
export const staffTies = memoOf('ties', resolveStaffTies);
export const staffSlurs = memoOf('slurs', resolveStaffSlurs);
export const staffGlissandos = memoOf('glissandos', resolveStaffGlissandos);
/** Glissando runs (grace-note start, see ../glissandos.js › resolveRunGlissandos): apart from the ordinary glissandos. */
export const staffRunGlissandos = memoOf('runGlissandos', resolveRunGlissandos);
/** Ids of the chords that are the ARRIVAL of a glissando run (they keep room on their left for its line). */
export const staffRunArrivalIds = (ctx, staff) => ctx.memo.of('runArrivalIds', staff, (st) => new Set(resolveRunGlissandos(st).filter((g) => g.start.stub).map((g) => g.end.chordId ?? g.start.chordId)));
export const staffHopos = memoOf('hopos', resolveStaffHopos);
export const staffTechLines = memoOf('techLines', resolveStaffTechLines);
/** Trémolos à deux accords (PID.TREMOLOS, voir ../tremolotwo.js) : indexés par accord de début. Communs aux peintres `score` et `tab`. */
export const staffTwoChordTremolos = memoOf('twoChordTremolos', resolveStaffTwoChordTremolos);
/**
 * Bends / dives de la portée (4d-b) ; le style est celui de la mise en page (`ctx.style`, constant pendant un rendu : le mémo vit
 * avec le contexte, donc avec ce style). Null s'il n'y en a pas.
 */
export const staffBends = (ctx, staff) => ctx.memo.of('bends', staff, (st) => resolveStaffBends(st, (k) => ctx.style(SID[k])));
/** Sens (up/down) d'un slur calculé une fois, réutilisé pour les segments suivants du même slur (voir slurs.js). */
export const staffSlurDirections = memoOf('slurDirections', () => new Map());

/** Notes qui reçoivent un tie (fin de tie) / qui en démarrent un / qui démarrent un glissando — pour les frettes liées en tablature. */
export const staffTieBackIds = (ctx, staff) => ctx.memo.of('tieBackIds', staff, (st) => new Set(staffTies(ctx, st).map((t) => t.endNoteId)));
export const staffTieForIds = (ctx, staff) => ctx.memo.of('tieForIds', staff, (st) => new Set(staffTies(ctx, st).map((t) => t.startNoteId)));
export const staffGlissandoStartIds = (ctx, staff) => ctx.memo.of('glissandoStartIds', staff, (st) => new Set(staffGlissandos(ctx, st).map((g) => g.startNoteId)));
/** Accords qui TERMINENT un glissando (`Chord::endsNoteAnchoredLine`) : la tablature leur réserve de la place à gauche. */
export const staffGlissandoEndChordIds = (ctx, staff) => ctx.memo.of('glissandoEndChordIds', staff, (st) => new Set(staffGlissandos(ctx, st).map((g) => g.end.chordId)));
