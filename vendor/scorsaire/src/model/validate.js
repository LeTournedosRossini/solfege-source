/*
 * Invariants du modèle. `validateWork` renvoie la liste des problèmes (vide = valide) ; elle sert aux tests,
 * au chargement de fichier (un fichier invalide est refusé) et plus tard à l'éditeur.
 *
 * Décision d'étape 2 : les conteneurs, voltas et synchronisations sont ancrés par l'IDENTIFIANT du masterbar
 * (`measureId`), pas par un numéro de mesure — insérer ou supprimer une mesure ne décale donc aucun ancrage
 * (règle du projet : jamais se fier à la position). Les mesures des voix restent, elles, alignées par index
 * sur les masterbars du mouvement (invariant vérifié ici).
 */
import { validateDynamics } from '../audio/velocity.js';
import { validateCompressor } from '../audio/compressor.js';
import { validateEq } from '../audio/eq.js';
import { validateLeslie } from '../audio/leslie.js';
import { blockProblems } from './blocks.js';
import { isAllowedPlayOffset } from './chordoffset.js';
import { validateStickingSystem } from './sticking.js';
import { validateTrackDisplay } from './trackdisplay.js';
import { chordTrackProblems } from './chordtrack.js';
import { validateFingerings } from './elements.js';
import { validateFingeringMap } from './fingeringmap.js';
import { validateBreaths } from './breath.js';
import { validateAutomation, PITCH_BEND_RANGES } from './automation.js';
import { validateLyricLinks, validateLyricTexts } from './lyrics.js';
import { validateTrills } from './trill.js';
import { validateGlissandos } from './glissando.js';
import { validateBendPlayback } from './bend.js';
import { validateWheels } from './wheel.js';
import { linkedStaffProblems } from './linkedstaff.js';
import { validatePedals } from './pedal.js';
import { validateStaffTexts } from './stafftextedit.js';
import { validateHiddenDecor } from './decor.js';
import { PID, PID_TABLE } from './pid.js';
import { SID_TABLE } from './sid.js';
import { STAFF_TYPES, elementSchema } from './schema.js';
import { walk } from './store.js';
import { buildListEntryIndex } from './listindex.js';
import { fEq, fLt, fLe, fAdd, fSum, ZERO } from './fraction.js';
import { CHANGE_RESOLUTIONS } from './tempo.js';
import { measureLayout, absolutePosition } from './tempomap.js';
import { MEASURE_DURATION, DURATION_BASES, actualDuration, tupletSpan, timeSigDuration } from './pitch.js';
import { measureLengthOf, isIrregularMeasure, voiceMeasureDuration } from './timing.js';
import { isApplicable } from './schema.js';
import { validateChordQualities } from './chordquality.js';
import { validateDiagram, validateSymbolDiagram, validateChordDiagram } from './fretdiagram.js';
import { validateVoicing } from './fretvoicing.js';
import { buttonBadge } from './accordion.js';
import { validatePools } from './voicingpools.js';
import { validatePartStaffTexts } from './partstafftext.js';
import { inputGridError } from './inputgrid.js';
import { staffSoundMap, isPercussionType, drumIndex, validatePercMap } from './percmap.js';

const v = (el, pid) => (Object.hasOwn(el.props, pid) ? el.props[pid] : PID_TABLE[pid].default);

/** @param opts.onlyMeasures  (optional) Set of measure elements: the per-measure checks run only on these (the transaction that wrote only inside them) */
export function validateWork(work, { onlyMeasures = null } = {}) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  const seen = new Set();

  // (a transaction that only wrote inside some measures cannot have created a duplicate identifier — `Document.add` refuses them — nor touched a list: skip both scans)
  if (!onlyMeasures) {
    walk(work, (el) => {
      if (seen.has(el.id)) err(`identifiant en double : ${el.id}`);
      seen.add(el.id);
    });
    // Entrées de listes (liaisons, soufflets, doigtés…) : leur identifiant sert à les sélectionner, il doit être unique dans toute l'œuvre
    for (const id of buildListEntryIndex(work, (x) => seen.has(x)).duplicates) err(`identifiant d'entrée de liste en double : ${id}`);
  }

  if (Object.hasOwn(work.props, PID.CHORD_QUALITIES) && work.props[PID.CHORD_QUALITIES] !== null) for (const e of validateChordQualities(work.props[PID.CHORD_QUALITIES])) err(e);
  for (const e of validateLyricTexts(v(work, PID.LYRIC_TEXTS))) err(e);
  { const mv0 = v(work, PID.MASTER_VOLUME); if (!(mv0 >= 0 && mv0 <= 1)) err(`master volume ${mv0} outside 0..1`); }
  { const mp = v(work, PID.MASTER_PAN); if (!(mp >= -1 && mp <= 1)) err(`master pan ${mp} outside -1..1`); }
  for (const [key, voicing] of Object.entries(v(work, PID.PREFERRED_VOICINGS) ?? {})) for (const p of validateVoicing(voicing)) err(`doigté préféré ${key} : ${p}`);
  for (const e of validatePools(work)) err(e);
  for (const part of work.parts ?? []) for (const e of validatePartStaffTexts(part)) err(e);
  for (const mv of work.movements) validateMovement(mv, err, v(work, PID.LYRIC_TEXTS), onlyMeasures);
  // parts: the measures of their breaks and fixed systems must exist, a fixed system lives in one movement
  const bars = new Map(); work.movements.forEach((mv, mi) => mv.masterbars.forEach((b, i) => bars.set(b.id, { mi, i })));
  const staffIds = new Set(work.movements.flatMap((mv) => mv.tracks.flatMap((t) => t.staves.map((s) => s.id))));
  for (const sheet of work.sheets ?? []) {
    const layout = sheet.props[PID.SHEET_LAYOUT];
    if (layout != null && !['column', 'matrix'].includes(layout)) err(`feuille ${sheet.id} : disposition « ${layout} » inconnue`);
    const columns = sheet.props[PID.SHEET_COLUMNS];
    if (columns != null && !(Number.isInteger(columns) && columns >= 1 && columns <= 16)) err(`feuille ${sheet.id} : nombre de colonnes invalide`);
    const seen = new Set();
    for (const c of sheet.props[PID.SHEET_CELLS] ?? []) {
      if (!c || typeof c.id !== 'string' || seen.has(c.id)) { err(`feuille ${sheet.id} : case sans identifiant ou en double`); continue; }
      seen.add(c.id);
      const mv = work.movements.find((m) => m.id === c.movementId);
      if (!mv) { err(`feuille ${sheet.id}, case ${c.id} : mouvement inexistant (${c.movementId})`); continue; }
      if (c.tracks != null && (!Array.isArray(c.tracks) || !c.tracks.length || c.tracks.some((id) => !mv.tracks.some((t) => t.id === id)))) err(`feuille ${sheet.id}, case ${c.id} : pistes invalides`);
      if (c.loop != null) {
        const a = mv.masterbars.findIndex((b) => b.id === c.loop.from); const b = mv.masterbars.findIndex((x) => x.id === c.loop.to);
        if (!(a >= 0 && b >= a)) err(`feuille ${sheet.id}, case ${c.id} : boucle invalide`);
      }
      for (const [tid, ts] of Object.entries(c.trackSettings ?? {})) {
        if (!mv.tracks.some((t) => t.id === tid)) err(`feuille ${sheet.id}, case ${c.id} : réglage d'une piste inexistante (${tid})`);
        for (const m of validateTrackDisplay({ showBars: ts.showBars, sizePct: ts.sizePct, slashes: ts.slashes, show: ts.show, colors: ts.colors }, `feuille ${sheet.id}, case ${c.id}, piste ${tid}`)) err(m);
        if (ts.volume != null && !(ts.volume >= 0 && ts.volume <= 1)) err(`feuille ${sheet.id}, case ${c.id} : volume de piste invalide`);
        for (const k of ['transposeDisplay', 'transposePlay']) if (ts[k] != null && !Number.isInteger(ts[k])) err(`feuille ${sheet.id}, case ${c.id} : transposition de piste invalide`);
      }
      if (c.settings?.speed != null && !(c.settings.speed >= 25 && c.settings.speed <= 200)) err(`feuille ${sheet.id}, case ${c.id} : vitesse invalide`);
    }
    const reader = sheet.props[PID.SHEET_READER];
    if (reader != null) {
      if (reader.transposeDisplay != null && !Number.isInteger(reader.transposeDisplay)) err(`feuille ${sheet.id} : transposition d'affichage invalide`);
      if (reader.transposePlay != null && !Number.isInteger(reader.transposePlay)) err(`feuille ${sheet.id} : transposition de lecture invalide`);
      if (reader.speed != null && !(reader.speed >= 25 && reader.speed <= 200)) err(`feuille ${sheet.id} : vitesse invalide`);
      if (reader.playerMode != null && !['auto', 'global', 'cases'].includes(reader.playerMode)) err(`feuille ${sheet.id} : mode de lecture invalide`);
      if (reader.carousel != null && !['auto', 'always', 'never'].includes(reader.carousel)) err(`feuille ${sheet.id} : carrousel invalide`);
    }
  }
  for (const part of work.parts ?? []) {
    const hungOnStaff = [];
    for (const [tid, layer] of Object.entries(part.props[PID.PART_TRACK_DISPLAY] ?? {})) for (const m of validateTrackDisplay(layer, `partie ${part.id}, piste ${tid}`)) err(m);
    for (const id of part.props[PID.PART_STAVES] ?? []) if (!staffIds.has(id)) err(`partie ${part.id} : portée inexistante (${id})`);
    for (const c of part.containers ?? []) {
      if (v(c, PID.CONTAINER_PLACEMENT) !== 'zone') { hungOnStaff.push(c); continue; } // above / between the measures of a staff: checked below with the rules of the staves
      if (!bars.has(v(c, PID.MEASURE_ID))) err(`partie ${part.id} : zone sur une mesure inexistante (${v(c, PID.MEASURE_ID)})`);
      const col = v(c, PID.CONTAINER_ZONE_COLUMN);
      if (!Number.isInteger(col) || col < 0 || col > 3) err(`conteneur ${c.id} : colonne ${col} hors de 0 à 3`);
      const row = v(c, PID.CONTAINER_ZONE_ROW);
      if (!(Number.isInteger(row) && ((row >= 0 && row <= 5) || (row >= 10 && row <= 15)))) err(`conteneur ${c.id} : rangée de zone ${row} hors de 0 à 5 / 10 à 15`);
      else if (row >= 10 && !v(c, PID.CONTAINER_BLOCK_ID) && bars.get(v(c, PID.MEASURE_ID))?.i !== 0) err(`conteneur ${c.id} : une zone avant le système se pose sur la 1re mesure d'un Mouvement`);
      const h = v(c, PID.CONTAINER_ZONE_HEIGHT);
      if (h != null && !(h >= 0 && h <= 200)) err(`conteneur ${c.id} : hauteur de zone invalide`);
      const kind = v(c, PID.CONTAINER_KIND);
      if (kind === 'nestedNotation') {
        if (c.fragments.length !== 1) err(`conteneur ${c.id} : une partition de zone contient exactement un fragment`);
        for (const f of c.fragments) { if (!f.masterbars.length || !f.tracks.some((t) => t.staves.length)) err(`conteneur ${c.id} : fragment vide`); validateMovement(f, err, v(work, PID.LYRIC_TEXTS), null, true); }
      } else if (kind === 'syncRange') {
        if (!bars.has(v(c, PID.RANGE_FROM)) || !bars.has(v(c, PID.RANGE_TO))) err(`conteneur ${c.id} : plage de mesures inexistante`);
      } else if (kind === 'chordDiagram') { for (const p of validateDiagram(c)) err(`conteneur ${c.id} : ${p}`); }
      else if (kind !== 'text' && kind !== 'structure' && kind !== 'chordDiagramList') err(`conteneur ${c.id} : genre « ${kind} » non pris en charge dans une zone`);
    }
    for (const c of hungOnStaff) {
      const staffId = v(c, PID.CONTAINER_STAFF_ID);
      const mv = work.movements.find((m) => m.tracks.some((t) => t.staves.some((s) => s.id === staffId)));
      if (!mv) { err(`conteneur ${c.id} : portée d'ancrage inexistante (${staffId})`); continue; }
      if (!['text', 'nestedNotation', 'chordDiagram'].includes(v(c, PID.CONTAINER_KIND))) err(`conteneur ${c.id} : genre « ${v(c, PID.CONTAINER_KIND)} » non pris en charge dans une partie`);
      if (v(c, PID.CONTAINER_PLAY) !== 'none') err(`conteneur ${c.id} : un conteneur de partie n'est jamais joué`);
      const ids = mv.masterbars.map((b) => b.id);
      validateStaffContainers([c], { ids, index: (id) => ids.indexOf(id), elements: mv.masterbars, tupletIds: new Map(), lyricTexts: v(work, PID.LYRIC_TEXTS), only: null }, err);
    }
    const gap = part.props[PID.PART_STAFF_GAP];
    if (gap != null && !(gap >= -2 && gap <= 40)) err(`partie ${part.id} : écart entre portées invalide`);
    for (const br of part.props[PID.PART_BREAKS] ?? []) {
      if (!bars.has(br.measureId)) err(`partie ${part.id} : saut sur une mesure inexistante (${br.measureId})`);
      if (br.breakKind !== 'system' && br.breakKind !== 'page') err(`partie ${part.id} : genre de saut inconnu (${br.breakKind})`);
    }
    for (const o of part.props[PID.PART_MEASURE_NUMBERS] ?? []) {
      if (!bars.has(o.measureId)) err(`partie ${part.id} : numéro de mesure sur une mesure inexistante (${o.measureId})`);
      if (o.mode !== 'show' && o.mode !== 'hide') err(`partie ${part.id} : mode de numéro inconnu (${o.mode})`);
    }
    const spans = [];
    for (const l of part.props[PID.PART_LOCKS] ?? []) {
      const a = bars.get(l.from); const b = bars.get(l.to);
      if (!a || !b) { err(`partie ${part.id} : système fixe sur une mesure inexistante`); continue; }
      if (a.mi !== b.mi || a.i > b.i) { err(`partie ${part.id} : système fixe invalide (${l.id})`); continue; }
      if (spans.some((s) => s.mi === a.mi && !(b.i < s.from || a.i > s.to))) err(`partie ${part.id} : systèmes fixes qui se chevauchent`);
      spans.push({ mi: a.mi, from: a.i, to: b.i });
    }
  }
  return errors;
}

function validateMovement(mv, err, lyricTexts = [], only = null, fragment = false) {
  const where = `mouvement ${mv.id}`;
  if (!fragment) for (const problem of chordTrackProblems(mv)) err(problem);
  const barIds = mv.masterbars.map((b) => b.id);
  const barIndex = (id) => barIds.indexOf(id);

  for (const sid of Object.keys(mv.style)) {
    if (!SID_TABLE[sid]) err(`${where} : style inconnu « ${sid} »`);
  }
  if (mv.props[PID.BLOCK_FIT] != null && !(mv.props[PID.BLOCK_FIT] >= 0.03 && mv.props[PID.BLOCK_FIT] <= 2)) err(`${where} : hauteur de la boîte sur la vidéo hors limites`);
  for (const problem of blockProblems(mv.props[PID.BLOCKS] ?? [], mv.props[PID.BLOCK_ASPECT] ?? 0.3)) err(`${where} : bloc : ${problem}`);
  {
    const seen = new Set();
    for (const view of mv.props[PID.VIEWS] ?? []) {
      if (!view || typeof view.id !== 'string' || typeof view.name !== 'string' || !Array.isArray(view.tracks)) { err(`${where} : vue mal formée`); continue; }
      if (seen.has(view.id)) err(`${where} : vue ${view.id} en double`);
      seen.add(view.id);
      for (const vt of view.tracks) {
        const track = mv.tracks.find((t) => t.id === vt.id);
        if (!track) { err(`${where} : vue ${view.id} : piste inconnue ${vt.id}`); continue; }
        for (const sid of vt.staves ?? []) if (!track.staves.some((s) => s.id === sid)) err(`${where} : vue ${view.id} : portée ${sid} hors de la piste ${vt.id}`);
      }
    }
  }

  const checkAnchor = (el, label, { needSpan }) => {
    const id = v(el, PID.MEASURE_ID);
    const i = barIndex(id);
    if (i < 0) return err(`${label} ${el.id} : ancrage sur une mesure inexistante (${id})`);
    if (needSpan) {
      const span = v(el, PID.SPAN);
      if (span < 1 || i + span > barIds.length) err(`${label} ${el.id} : span ${span} dépasse la fin du mouvement`);
    }
  };

  for (const c of mv.systemContainers) checkAnchor(c, 'conteneur système', { needSpan: false });
  for (const vo of mv.voltas) checkAnchor(vo, 'volta', { needSpan: true });
  for (const j of mv.jumps) checkAnchor(j, 'saut', { needSpan: false });
  for (const r of mv.rehearsalMarks) {
    checkAnchor(r, 'repère de répétition', { needSpan: false });
    if (typeof v(r, PID.TEXT) !== 'string' || !v(r, PID.TEXT).trim()) err(`repère de répétition ${r.id} : texte vide`);
  }
  for (const m of mv.markers) {
    checkAnchor(m, 'marqueur', { needSpan: false });
    if (v(m, PID.MARKER_TYPE) === 'user' && !v(m, PID.LABEL)) err(`marqueur ${m.id} : un marqueur de type « user » exige une étiquette`);
  }
  for (const t of mv.tempos) {
    checkAnchor(t, 'tempo', { needSpan: false });
    const i = barIndex(v(t, PID.MEASURE_ID));
    const pos = v(t, PID.POSITION);
    if (i >= 0 && !(pos && fLe(ZERO, pos) && fLt(pos, measureLengthOf(mv.masterbars[i])))) err(`tempo ${t.id} : position hors de la mesure`);
    if (!(v(t, PID.TEMPO_BPM) > 0)) err(`tempo ${t.id} : tempo nul ou négatif`);
    if (!(v(t, PID.TEMPO_FACTOR) > 0)) err(`tempo ${t.id} : facteur nul ou négatif`);
    if (!DURATION_BASES.includes(v(t, PID.BEAT_UNIT)?.base)) err(`tempo ${t.id} : unité de battement inconnue`);
  }
  for (const f of mv.fermatas) {
    checkAnchor(f, 'point d\'orgue', { needSpan: false });
    const i = barIndex(v(f, PID.MEASURE_ID));
    const pos = v(f, PID.POSITION);
    if (i >= 0 && !(pos && fLe(ZERO, pos) && fLt(pos, measureLengthOf(mv.masterbars[i])))) err(`point d'orgue ${f.id} : position hors de la mesure`);
    if (v(f, PID.TIME_STRETCH) !== null && !(v(f, PID.TIME_STRETCH) > 0)) err(`point d'orgue ${f.id} : étirement nul ou négatif`);
  }
  const staffIds = new Set(mv.tracks.flatMap((t) => t.staves.map((st) => st.id)));
  for (const sw of mv.swings) {
    checkAnchor(sw, 'swing', { needSpan: false });
    const i = barIndex(v(sw, PID.MEASURE_ID));
    const pos = v(sw, PID.POSITION);
    if (i >= 0 && !(pos && fLe(ZERO, pos) && fLt(pos, measureLengthOf(mv.masterbars[i])))) err(`swing ${sw.id} : position hors de la mesure`);
    const ratio = v(sw, PID.SWING_RATIO);
    if (!(Number.isInteger(ratio) && ratio >= 0 && ratio <= 100)) err(`swing ${sw.id} : ratio ${ratio} hors de 0..100`);
    const target = v(sw, PID.TARGET_STAFF_ID);
    if (target !== null && !staffIds.has(target)) err(`swing ${sw.id} : portée visée inexistante (${target})`);
  }
  const cueTrackIds = new Set(mv.tracks.map((t) => t.id));
  for (const cue of mv.cues ?? []) {
    checkAnchor(cue, 'repère', { needSpan: false });
    if (!['groove', 'break', 'alt'].includes(v(cue, PID.CUE_KIND))) err(`repère ${cue.id} : genre inconnu`);
    if (typeof v(cue, PID.CUE_VALUE) !== 'string' || !v(cue, PID.CUE_VALUE)) err(`repère ${cue.id} : valeur attendue`);
    const track = v(cue, PID.CUE_TRACK);
    if (track !== null && !cueTrackIds.has(track)) err(`repère ${cue.id} : piste visée inexistante (${track})`);
  }
  for (const c of mv.tempoChanges) {
    checkAnchor(c, 'changement de tempo', { needSpan: false });
    const i = barIndex(v(c, PID.MEASURE_ID));
    const j = barIndex(v(c, PID.END_MEASURE_ID));
    if (j < 0) { err(`changement de tempo ${c.id} : fin sur une mesure inexistante (${v(c, PID.END_MEASURE_ID)})`); continue; }
    const layout = measureLayout(mv);
    const start = absolutePosition(layout, v(c, PID.MEASURE_ID), v(c, PID.POSITION));
    const end = absolutePosition(layout, v(c, PID.END_MEASURE_ID), v(c, PID.END_POSITION));
    if (i >= 0 && !fLt(start, end)) err(`changement de tempo ${c.id} : la fin doit suivre le début`);
    if (!fLe(end, layout.end)) err(`changement de tempo ${c.id} : la fin dépasse le Mouvement`);
    const curve = v(c, PID.CHANGE_CURVE);
    if (!(curve >= -1 && curve <= 1)) err(`changement de tempo ${c.id} : courbe hors de [-1, 1]`);
    if (!CHANGE_RESOLUTIONS.includes(v(c, PID.CHANGE_RESOLUTION))) err(`changement de tempo ${c.id} : résolution ${v(c, PID.CHANGE_RESOLUTION)} (8, 16 ou 32)`);
    if (v(c, PID.TARGET_BPM) !== null && !(v(c, PID.TARGET_BPM) > 0)) err(`changement de tempo ${c.id} : tempo d'arrivée nul ou négatif`);
    if (v(c, PID.CHANGE_FACTOR) !== null && !(v(c, PID.CHANGE_FACTOR) > 0)) err(`changement de tempo ${c.id} : facteur nul ou négatif`);
  }
  if (!(v(mv, PID.PAUSE) >= 0)) err(`${where} : pause négative`);
  const offsets = v(mv, PID.OFFSETS);
  if (offsets !== null && offsets !== undefined) {
    if (typeof offsets !== 'object' || Array.isArray(offsets)) err(`${where} : déplacements manuels : objet attendu`);
    else {
      for (const [id, o] of Object.entries(offsets)) {
        if (!Array.isArray(o) || o.length !== 2 || !o.every((n) => Number.isFinite(n) && Math.abs(n) <= 200)) err(`${where} : déplacement manuel de ${id} invalide`);
      }
    }
  }
  for (const bar of mv.masterbars) {
    if (v(bar, PID.REPEAT_COUNT) < 1) err(`masterbar ${bar.id} : nombre de passages < 1`);
  }
  for (const sy of mv.syncs) {
    for (const a of v(sy, PID.SYNC_ANCHORS)) {
      if (barIndex(a.measureId) < 0) err(`synchronisation ${sy.id} : point d'ancrage sur une mesure inexistante (${a.measureId})`);
    }
  }

  const trackIds = mv.tracks.map((t) => t.id);
  const checkGroup = (g, range) => {
    const a = trackIds.indexOf(v(g, PID.START_TRACK_ID));
    const b = trackIds.indexOf(v(g, PID.END_TRACK_ID));
    if (a < 0 || b < 0) return err(`groupe ${g.id} : piste inconnue`);
    if (a > b) return err(`groupe ${g.id} : début après la fin`);
    if (range && (a < range[0] || b > range[1])) err(`groupe ${g.id} : sort de la plage de son groupe parent`);
    for (const child of g.groups) checkGroup(child, [a, b]);
  };
  for (const g of mv.groups) checkGroup(g, null);
  // groups of the same level are disjoint (nested groups are children, never partial overlaps)
  const checkSiblings = (list) => {
    const spans = list.map((g) => [trackIds.indexOf(v(g, PID.START_TRACK_ID)), trackIds.indexOf(v(g, PID.END_TRACK_ID)), g]);
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        if (spans[i][0] <= spans[j][1] && spans[j][0] <= spans[i][1]) err(`groupes ${spans[i][2].id} et ${spans[j][2].id} : se chevauchent sans s'imbriquer`);
      }
      checkSiblings(spans[i][2].groups);
    }
  };
  checkSiblings(mv.groups);

  for (const bar of mv.masterbars) validateMeasureOffset(bar, err);
  for (const bar of mv.masterbars) {
    const grid = v(bar, PID.INPUT_GRID);
    const problem = grid === null ? null : inputGridError(grid, measureLengthOf(bar));
    if (problem) err(`mesure ${bar.id} : grille de saisie invalide (${problem})`);
  }

  // `tupletIds` : identifiant de n-olet → mesure qui le contient (un n-olet ne peut être qu'à un seul endroit)
  for (const e of validateAutomation(v(mv, PID.MASTER_AUTOMATION), barIds, 'master volume')) err(e);
  const bars = { ids: barIds, index: barIndex, elements: mv.masterbars, tupletIds: new Map(), lyricTexts, only };
  for (const track of mv.tracks) {
    for (const e of validateAutomation(v(track, PID.AUTOMATION), barIds, `track ${track.id}`)) err(e);
    { const sp = v(track, PID.SF_PRESET); if (sp != null && !(Number.isInteger(sp.program) && sp.program >= 0 && sp.program <= 127 && Number.isInteger(sp.bankMSB ?? 0) && Number.isInteger(sp.bankLSB ?? 0) && typeof sp.name === 'string')) err(`track ${track.id}: invalid SoundFont preset`); }
    { const vol = v(track, PID.MIXER_VOLUME); if (!(vol >= 0 && vol <= 1)) err(`track ${track.id}: volume ${vol} outside 0..1`); }
    { const r = v(track, PID.PITCH_BEND_RANGE); if (!PITCH_BEND_RANGES.includes(r)) err(`track ${track.id}: pitch-bend range ${r} not allowed`); }
    { const pan = v(track, PID.MIXER_PAN); if (!(pan >= -1 && pan <= 1)) err(`track ${track.id}: pan ${pan} outside -1..1`); }
    for (const e of validateDynamics(v(track, PID.MIDI_DYNAMICS))) err(`track ${track.id}: ${e}`);
    for (const e of validateCompressor(v(track, PID.COMPRESSOR))) err(`track ${track.id}: ${e}`);
    for (const e of validateEq(v(track, PID.EQUALIZER))) err(`track ${track.id}: ${e}`);
    for (const e of validateLeslie(v(track, PID.LESLIE))) err(`track ${track.id}: ${e}`);
    for (const staff of track.staves) { for (const e of linkedStaffProblems(mv, track, staff)) err(e); validateStaff(staff, bars, 0, barIds.length, err); }
    validateStaffMoves(track, err);
  }
}

/**
 * Portées croisées (`PID.STAFF_MOVE`, MuseScore `ChordRest::checkStaffMoveValidity`) : la portée cible existe, appartient à la MÊME piste et
 * est du même groupe que la portée d'origine (ici : portées de notation `score` toutes deux). Un déplacement invalide est refusé.
 */
function validateStaffMoves(track, err) {
  track.staves.forEach((staff, k) => {
    for (const voice of staff.voices) {
      for (const measure of voice.measures) {
        for (const item of measure.items) {
          if (item.type !== 'chord' && item.type !== 'rest') continue;
          const move = v(item, PID.STAFF_MOVE);
          if (move === 0) continue;
          const where = `${item.type === 'chord' ? 'accord' : 'silence'} ${item.id} : portée croisée`;
          if (!Number.isInteger(move) || Math.abs(move) !== 1) { err(`${where} (staffMove ${move}) : −1, 0 ou +1 attendu`); continue; }
          const target = track.staves[k + move];
          if (!target) err(`${where} : aucune portée ${move < 0 ? 'au-dessus' : 'en dessous'} dans la piste`);
          else if (v(staff, PID.STAFF_TYPE) !== 'score' || v(target, PID.STAFF_TYPE) !== 'score') err(`${where} : seulement entre deux portées de notation`);
        }
      }
    }
  });
}

/**
 * @param bars   { ids, index, elements } du mouvement
 * @param first  position (dans le mouvement) de la première mesure de la portée : 0, ou l'ancrage d'une notation imbriquée
 * @param count  nombre de mesures attendues dans chaque voix
 */
function validateStaff(staff, bars, first, count, err) {
  const type = v(staff, PID.STAFF_TYPE);
  const descriptor = STAFF_TYPES[type];
  if (!descriptor) return err(`portée ${staff.id} : type inconnu (${type})`);

  if (v(staff, PID.FINGERING_MAP)) for (const e of validateFingeringMap(v(staff, PID.FINGERING_MAP))) err(`portée ${staff.id} : ${e}`);

  // respirations : chacune est posée après un accord ou un silence de CETTE portée
  if (v(staff, PID.BREATHS).length) {
    const ids = new Set(staff.voices.flatMap((vo) => vo.measures.flatMap((m) => (m?.items ?? []).filter((i) => i.type === 'chord' || i.type === 'rest').map((i) => i.id))));
    for (const e of validateBreaths(v(staff, PID.BREATHS), (id) => ids.has(id))) err(`portée ${staff.id} : ${e}`);
  }

  // paroles : chaque lien vise un accord de CETTE portée et un texte de l'œuvre (`ctx.lyricTexts`)
  if (v(staff, PID.LYRIC_LINKS).length) {
    const ids = new Set(staff.voices.flatMap((vo) => vo.measures.flatMap((m) => (m?.items ?? []).filter((i) => i.type === 'chord').map((i) => i.id))));
    for (const e of validateLyricLinks(v(staff, PID.LYRIC_LINKS), bars.lyricTexts, (id) => ids.has(id))) err(`portée ${staff.id} : ${e}`);
  }

  // glissandos : propriétés de lecture
  for (const e of validateGlissandos(v(staff, PID.GLISSANDOS) || [])) err(`portée ${staff.id} : ${e}`);

  // pédales : bornes = instants de mesures existantes
  for (const e of validatePedals(v(staff, PID.PEDALS) || [], bars.ids, bars.elements)) err(`portée ${staff.id} : ${e}`);

  // textes de portée : mesure existante, position dans la mesure, texte non vide
  for (const e of validateStaffTexts(v(staff, PID.STAFF_TEXTS) || [], bars)) err(`portée ${staff.id} : ${e}`);

  // décor masqué : mesures existantes, pas de doublon
  for (const e of validateHiddenDecor(v(staff, PID.HIDDEN_DECOR) || [], bars.ids)) err(`portée ${staff.id} : ${e}`);

  // bends : propriétés de lecture
  for (const e of validateBendPlayback(v(staff, PID.BENDS) || [])) err(`portée ${staff.id} : ${e}`);
  // bends: both ends are notes of THIS staff and of the same voice (a landing note may sit in a grace chord, "before" or "after")
  if (v(staff, PID.BENDS).length) {
    const voiceOf = new Map();
    staff.voices.forEach((vo, vi) => vo.measures.forEach((m) => (m?.items ?? []).forEach((it) => {
      if (it.type !== 'chord') return;
      for (const c of [it, ...(it.graceNotes ?? [])]) for (const n of c.notes) voiceOf.set(n.id, vi);
    })));
    for (const b of v(staff, PID.BENDS)) {
      const a = voiceOf.get(b.startNoteId); const z = voiceOf.get(b.endNoteId ?? b.startNoteId);
      if (a === undefined || z === undefined) err(`portée ${staff.id} : bend ${b.id} : note de départ ou d'arrivée absente de la portée`);
      else if (a !== z) err(`portée ${staff.id} : bend ${b.id} : les deux notes ne sont pas de la même voix`);
    }
  }

  // molettes : la note d'ancrage appartient à la portée
  if (v(staff, PID.WHEELS).length) {
    const noteIds = new Set(staff.voices.flatMap((vo) => vo.measures.flatMap((m) => (m?.items ?? []).flatMap((it) => (it.type === 'chord' ? it.notes.map((n) => n.id) : [])))));
    for (const e of validateWheels(v(staff, PID.WHEELS), noteIds)) err(`portée ${staff.id} : ${e}`);
  }

  // lignes de trille : les deux bornes sont des accords ou des silences de CETTE portée (la fin devient un silence quand on supprime
  // son accord, comme MuseScore qui garde le spanner par temps)
  if (v(staff, PID.TRILLS).length) {
    const ids = new Set(staff.voices.flatMap((vo) => vo.measures.flatMap((m) => (m?.items ?? []).filter((i) => i.type === 'chord' || i.type === 'rest').map((i) => i.id))));
    for (const e of validateTrills(v(staff, PID.TRILLS), (id) => ids.has(id))) err(`portée ${staff.id} : ${e}`);
  }

  // percussion : la percmap de la portée doit être valide et définir le son de chaque note (tranche 5)
  let drums = null;
  if (isPercussionType(type)) {
    const dm = staffSoundMap(v(staff, PID.PERCMAP));
    for (const e of validatePercMap(dm)) err(`portée ${staff.id} : ${e}`);
    drums = drumIndex(dm);
    for (const e of validateStickingSystem(v(staff, PID.STICKING_SYSTEM))) err(`portée ${staff.id} : ${e}`);
  }

  staff.voices.forEach((voice, voiceIndex) => {
    if (voice.measures.length !== count) {
      err(`voix ${voice.id} : ${voice.measures.length} mesure(s) au lieu de ${count}`);
    }
    voice.measures.forEach((measure, m) => {
      const masterbar = bars.elements[first + m]; // alignement par index (invariant vérifié ci-dessus)
      if (bars.only && !bars.only.has(measure)) { // not written by this transaction: only note where its tuplets are (an id must live in ONE measure)
        for (const item of measure.items) { const t = isApplicable(item.type, PID.TUPLET) ? v(item, PID.TUPLET) : null; if (t && !bars.tupletIds.has(t.id)) bars.tupletIds.set(t.id, measure.id); }
        return;
      }
      for (const item of measure.items) {
        if (!descriptor.items.includes(item.type)) {
          err(`mesure ${measure.id} : « ${item.type} » n'est pas admis dans une portée « ${type} »`);
        } else if (item.type === 'chord') {
          validateChord(item, type, descriptor, err, drums);
          validateGraceNotes(item, type, descriptor, err, drums);
          for (const p of validateChordDiagram(item)) err(`accord ${item.id} : ${p}`);
        } else if (item.type === 'chordsymbol') {
          for (const p of validateSymbolDiagram(item)) err(`symbole d'accord ${item.id} : ${p}`);
          if (!isAllowedPlayOffset(v(item, PID.PLAY_OFFSET))) err(`symbole d'accord ${item.id} : décalage de jeu non admis`);
        }
      }
      if (descriptor.sequential && masterbar) {
        validateCoverage(measure, masterbar, voiceIndex, err);
        validateTuplets(measure, `mesure ${measure.id} (voix ${voiceIndex + 1})`, bars.tupletIds, err);
      }
    });
  });

  validateStaffContainers(staff.containers, bars, err);
}

/** The staff containers of a staff, or those a PART hangs on a staff (same rules): `bars` describes the movement of that staff. */
function validateStaffContainers(containers, bars, err) {
  for (const c of containers) {
    const id = v(c, PID.MEASURE_ID);
    const i = bars.index(id);
    const span = v(c, PID.SPAN);
    if (i < 0) err(`conteneur ${c.id} : ancrage sur une mesure inexistante (${id})`);
    else if (span < 1 || i + span > bars.ids.length) err(`conteneur ${c.id} : span ${span} dépasse la fin du mouvement`);
    const placement = v(c, PID.CONTAINER_PLACEMENT);
    if (v(c, PID.CONTAINER_KIND) === 'chordDiagram') for (const p of validateDiagram(c)) err(`conteneur ${c.id} : ${p}`);
    const layoutMode = v(c, PID.CONTAINER_LAYOUT);
    const playMode = v(c, PID.CONTAINER_PLAY);
    const scale = v(c, PID.CONTAINER_SCALE);
    const maxScale = ['text', 'chordDiagram', 'chordDiagramList'].includes(v(c, PID.CONTAINER_KIND)) ? 3 : 1; // a text or a diagram can be enlarged, a nested score only reduced
    if (!(scale >= 0.4 && scale <= maxScale)) err(`conteneur ${c.id} : échelle ${scale} hors de 0,4 à ${maxScale}`);
    const gapUp = v(c, PID.CONTAINER_GAP);
    if (!(gapUp >= 0 && gapUp <= 40)) err(`conteneur ${c.id} : distance ${gapUp} hors de 0 à 40`);
    if (layoutMode === 'free' && (placement === 'between' || v(c, PID.CONTAINER_KIND) !== 'nestedNotation')) err(`conteneur ${c.id} : le placement libre ne concerne qu'une partition empilée au-dessus des mesures`);
    if (playMode !== 'none') {
      if (v(c, PID.CONTAINER_KIND) !== 'nestedNotation' || placement === 'between') err(`conteneur ${c.id} : seule une partition empilée au-dessus des mesures peut être jouée`);
      else if (layoutMode === 'free') err(`conteneur ${c.id} : une partition en placement libre n'est jamais jouée`);
    }
    if (placement === 'between') {
      // slot between two measures: a text for now (a nested notation will need its own width rules); 'after' only on the last measure (canonical form)
      const kindOf = v(c, PID.CONTAINER_KIND);
      if (kindOf !== 'text' && kindOf !== 'nestedNotation' && kindOf !== 'chordDiagram') err(`conteneur ${c.id} : un conteneur intercalé contient du texte, une partition ou un diagramme d'accord (genre « ${kindOf} » non pris en charge)`);
      if (kindOf === 'nestedNotation') {
        if (c.fragments.length !== 1) err(`conteneur ${c.id} : une partition intercalée contient exactement un fragment (${c.fragments.length})`);
        for (const f of c.fragments) {
          if (!f.masterbars.length) err(`conteneur ${c.id} : le fragment n'a aucune mesure`);
          if (!f.tracks.some((t) => t.staves.length)) err(`conteneur ${c.id} : le fragment n'a aucune portée`);
          validateMovement(f, err, bars.lyricTexts, null, true);
        }
      } else if (c.fragments.length) err(`conteneur ${c.id} : un fragment n'a de sens que dans une partition intercalée`);
      if (v(c, PID.CONTAINER_SIDE) === 'after' && i >= 0 && i !== bars.ids.length - 1) err(`conteneur ${c.id} : « après » n'est permis que sur la dernière mesure (utiliser « avant » la suivante)`);
      const width = v(c, PID.CONTAINER_WIDTH);
      if (width !== null && width !== undefined && !(width > 0)) err(`conteneur ${c.id} : largeur invalide`);
    }
    if (v(c, PID.CONTAINER_PLACEMENT) !== 'between' && c.fragments.length) {
      // stacked notation in a fragment: as many measures as the container covers, each as long as the main measure it sits on
      if (v(c, PID.CONTAINER_KIND) !== 'nestedNotation' || c.fragments.length !== 1) err(`conteneur ${c.id} : un fragment n'a de sens que dans une notation imbriquée (un seul)`);
      else {
        const f = c.fragments[0];
        if (layoutMode === 'free') {
          // free layout: independent of the measures of the piece (any number of measures, any time signature)
          if (!f.masterbars.length) err(`conteneur ${c.id} : le fragment n'a aucune mesure`);
        } else if (f.masterbars.length !== span) err(`conteneur ${c.id} : le fragment a ${f.masterbars.length} mesure(s), le conteneur en couvre ${span}`);
        else if (i >= 0) f.masterbars.forEach((fb, k) => { if (!fEq(measureLengthOf(fb), measureLengthOf(bars.elements[i + k]))) err(`conteneur ${c.id} : la mesure ${k + 1} du fragment n'a pas la longueur de la mesure de la pièce qu'elle recouvre (un chiffrage propre doit garder la même longueur : 3/4 et 6/8, 2/2 et 4/4)`); });
        if (!f.tracks.some((t) => t.staves.length)) err(`conteneur ${c.id} : le fragment n'a aucune portée`);
        validateMovement(f, err, bars.lyricTexts, null, true);
      }
    }
    // notation imbriquée : autant de mesures que le span du conteneur, alignées sur les masterbars à partir de l'ancrage
    for (const nested of c.staves) validateStaff(nested, bars, Math.max(i, 0), span, err);
  }
}

/**
 * Remplissage d'une voix dans une mesure (MuseScore : `Measure::checkMeasure`, qui comble les trous avec des silences).
 * - la voix 1 remplit TOUJOURS exactement la longueur de la mesure (jamais vide, ni trop courte, ni trop longue) ;
 * - une voix suivante peut être absente (aucun élément) ; si elle contient quelque chose, elle remplit la mesure aussi ;
 * - un silence de mesure est seul dans sa mesure, et seulement dans une mesure régulière (pas d'anacrouse).
 */
function validateCoverage(measure, masterbar, voiceIndex, err) {
  const where = `mesure ${measure.id} (voix ${voiceIndex + 1})`;
  if (measure.items.length === 0) {
    if (voiceIndex === 0) err(`${where} : la voix 1 ne peut pas être vide`);
    return;
  }
  const gaps = measure.items.filter((item) => item.type === 'rest' && v(item, PID.GAP) === true);
  if (gaps.length && voiceIndex === 0) err(`${where} : un silence « trou » n'existe qu'en voix 2 à 4`);
  if (gaps.length === measure.items.length) err(`${where} : une voix qui ne contient que des silences « trou » doit rester vide`);
  if (gaps.some((r) => r.props[PID.DURATION]?.base === MEASURE_DURATION)) err(`${where} : pas de silence de mesure « trou »`);
  const measureRests = measure.items.filter((item) => item.type !== 'chord' && item.props[PID.DURATION]?.base === MEASURE_DURATION);
  if (measureRests.length) {
    if (measure.items.length > 1) err(`${where} : un silence de mesure doit être seul dans la mesure`);
    if (isIrregularMeasure(masterbar)) err(`${where} : pas de silence de mesure dans une mesure irrégulière`);
    for (const item of measureRests) {
      if (item.type !== 'rest') err(`${where} : la durée « measure » est réservée aux silences`);
      if (isApplicable(item.type, PID.TUPLET) && v(item, PID.TUPLET) !== null) err(`${where} : pas de silence de mesure dans un n-olet`);
    }
  }
  if (measure.items.some((item) => item.type === 'chord' && item.props[PID.DURATION]?.base === MEASURE_DURATION)) {
    err(`${where} : la durée « measure » est réservée aux silences`);
    return;
  }
  const length = measureLengthOf(masterbar);
  const content = voiceMeasureDuration(measure, length);
  if (!fEq(content, length)) {
    err(`${where} : contenu de ${fmt(content)} au lieu de ${fmt(length)} (en fraction de ronde)`);
  }
}

const fmt = (f) => `${f[0]}/${f[1]}`;

/**
 * Le décalage explicite doit tomber DANS la mesure nominale, et le contenu ne doit pas en dépasser la fin (une anacrouse
 * finit la mesure complète). Sans décalage explicite, rien à vérifier.
 */
function validateMeasureOffset(masterbar, err) {
  const explicit = v(masterbar, PID.MEASURE_OFFSET);
  if (explicit === null) return;
  const nominal = timeSigDuration(v(masterbar, PID.TIME_SIG));
  if (!fLt(explicit, nominal)) {
    err(`masterbar ${masterbar.id} : décalage ${fmt(explicit)} hors de la mesure nominale (${fmt(nominal)})`);
  } else if (explicit[0] > 0 && fLt(nominal, fAdd(explicit, measureLengthOf(masterbar)))) {
    err(`masterbar ${masterbar.id} : décalage ${fmt(explicit)} + longueur ${fmt(measureLengthOf(masterbar))} dépassent la mesure nominale`);
  }
}

/**
 * Groupes n-olets d'une voix dans une mesure : tous les membres d'un même identifiant ont le même rapport et la même
 * unité de base, se suivent sans élément étranger entre eux, remplissent exactement l'étendue du groupe (`tupletSpan`),
 * et le groupe n'existe qu'à un seul endroit du mouvement. Un groupe incomplet est refusé.
 */
function validateTuplets(measure, where, tupletIds, err) {
  const groups = new Map(); // id → { first, indexes, sum, tuplet }
  measure.items.forEach((item, index) => {
    if (!isApplicable(item.type, PID.TUPLET)) return;
    const tuplet = v(item, PID.TUPLET);
    if (tuplet === null) return;
    const duration = v(item, PID.DURATION);
    if (duration.base === MEASURE_DURATION) return; // déjà signalé par validateCoverage
    let g = groups.get(tuplet.id);
    if (!g) {
      g = { tuplet, indexes: [], parts: [] };
      groups.set(tuplet.id, g);
      const elsewhere = tupletIds.get(tuplet.id);
      if (elsewhere && elsewhere !== measure.id) err(`${where} : le n-olet ${tuplet.id} existe aussi dans la mesure ${elsewhere}`);
      tupletIds.set(tuplet.id, measure.id);
    } else if (JSON.stringify([g.tuplet.ratio, g.tuplet.base]) !== JSON.stringify([tuplet.ratio, tuplet.base])) {
      err(`${where} : les éléments du n-olet ${tuplet.id} n'ont pas le même rapport ou la même unité de base`);
    }
    g.indexes.push(index);
    g.parts.push(actualDuration(duration, tuplet));
  });
  for (const [id, g] of groups) {
    const contiguous = g.indexes.every((idx, k) => k === 0 || idx === g.indexes[k - 1] + 1);
    if (!contiguous) err(`${where} : les éléments du n-olet ${id} doivent se suivre`);
    const sum = fSum(g.parts);
    const span = tupletSpan(g.tuplet);
    if (!fEq(sum, span)) err(`${where} : n-olet ${id} incomplet ou trop long (${fmt(sum)} au lieu de ${fmt(span)})`);
  }
}

/** Un accord contient au moins une note, du type propre à la portée ; pas deux fois la même corde ou le même son. */
function validateChord(chord, staffType, descriptor, err, drums = null) {
  if (chord.notes.length === 0) err(`accord ${chord.id} : aucune note`);
  const used = new Set();
  for (const note of chord.notes) {
    if (note.type !== descriptor.noteType) {
      err(`accord ${chord.id} : « ${note.type} » n'est pas admis dans une portée « ${staffType} »`);
      continue;
    }
    for (const e of validateFingerings(v(note, PID.FINGERINGS))) err(`accord ${chord.id} : ${e}`);
    // Vélocité imposée : 0 (automatique) à 127 (champ « Velocity » de l'inspecteur de MuseScore 4.7.5 : 0-127).
    const userVelocity = v(note, PID.USER_VELOCITY);
    if (userVelocity < 0 || userVelocity > 127) err(`accord ${chord.id} : vélocité imposée hors de 0-127 (${userVelocity})`);
    if (note.type === 'percnote' && drums && !drums.has(v(note, PID.SOUND))) err(`accord ${chord.id} : le son « ${v(note, PID.SOUND)} » n'existe pas dans la percmap de la portée`);
    if (note.type === 'rhythmnote' && chord.notes.length > 1) err(`accord ${chord.id} : un accord rythmique ne porte qu'une note (sans hauteur)`);
    if (note.type === 'accnote') {
      const row = v(note, PID.ACC_ROW);
      if (!Number.isInteger(row) || row < 1 || row > 6) err(`accord ${chord.id} : rang de bouton invalide (${row}), 1 à 6 attendu`);
      else if (!note.props[PID.SPELLING]) err(`accord ${chord.id} : un bouton d'accordéon porte une épellation`);
    }
    const key = note.type === 'tabnote' ? `la corde ${v(note, PID.STRING)}` : note.type === 'percnote' ? `le son « ${v(note, PID.SOUND)} »`
      : note.type === 'accnote' && note.props[PID.SPELLING] ? `le bouton ${buttonBadge(v(note, PID.ACC_ROW), note.props[PID.SPELLING])}` : null;
    if (key === null) continue;
    if (used.has(key)) err(`accord ${chord.id} : deux notes sur ${key}`);
    used.add(key);
  }
}

/**
 * Ornements d'un accord (`chord.graceNotes`) : chaque ornement est un accord valide, porte un `graceType`, n'a ni n-olet
 * ni ornements propres ; les ornements « avant » précèdent les « après » dans la liste (ordre temporel).
 * Un ornement ne consomme aucun temps : il n'entre pas dans le remplissage de la mesure.
 */
function validateGraceNotes(chord, staffType, descriptor, err, drums = null) {
  if (v(chord, PID.GRACE_TYPE) !== null && chord.graceNotes.length) err(`ornement ${chord.id} : un ornement ne porte pas d'ornements`);
  let seenAfter = false;
  for (const grace of chord.graceNotes) {
    const gt = v(grace, PID.GRACE_TYPE);
    if (gt === null) { err(`ornement ${grace.id} : « graceType » manquant`); continue; }
    if (v(grace, PID.TUPLET) !== null) err(`ornement ${grace.id} : pas de n-olet sur un ornement`);
    if (grace.graceNotes?.length) err(`ornement ${grace.id} : un ornement ne porte pas d'ornements`);
    validateChord(grace, staffType, descriptor, err, drums);
    const after = gt.endsWith('after');
    if (seenAfter && !after) err(`accord ${chord.id} : un ornement « avant » ne peut pas suivre un ornement « après »`);
    if (after) seenAfter = true;
  }
}

/** Vérifie qu'une clé de liste et un type d'enfant sont cohérents avec le schéma (utilisé par les commandes). */
export function assertCanContain(parent, key, child) {
  const allowed = elementSchema(parent.type).children[key];
  if (!allowed) throw new Error(`« ${parent.type} » n'a pas de liste « ${key} »`);
  if (!allowed.includes(child.type)) throw new Error(`« ${child.type} » n'est pas admis dans « ${parent.type}.${key} »`);
}
