/*
 * Systèmes : largeurs des mesures, retour à la ligne glouton, justification.
 *
 * Toute la justification est calculée UNE fois par système, pour TOUTES les portées à la fois (roadmap §6) : la largeur
 * naturelle d'une mesure est le maximum, sur toutes les portées, de ce que demande chacune de ses colonnes de temps.
 * Les barres de mesure tombent donc au même x sur toutes les portées, quel que soit leur type.
 *
 * Deux parts, comme dans le prototype : `fixed` = jamais étirée (marge, en-tête de système, empreinte des barres) ;
 * `flex` = étirée par le facteur de justification (colonnes de temps, espace après la barre).
 */
import { PID, SID, getProperty, isDecorHidden, sectionSpans } from '../model/index.js';
import { planGrid } from './measuregrid.js';
import { respaceColumns } from './columns.js';
import { LEFT_PAD, TIMESIG_PAD, GLYPH_PAD, KEY_SIG_GAP, KEY_SIG_END_PAD, ABSOLUTE_MIN_HEADER_DISTANCE, BARLINE_GAP, EXTRA_NO_ACC_GAP, KEYSIG_LEFT_MARGIN, KEYSIG_TRAILER_MARGIN, TIMESIG_LEFT_MARGIN, TIMESIG_BARLINE_MARGIN, KEYSIG_ACCIDENTAL_MARGIN } from './constants.js';
const CHORD_MIN_LEFT_PAD = 0.45; // sp: room kept at the left edge for the opening bar of a chord staff (it sits 0.25 before the first column, and has a width of its own)
import { keySigOf, keySigWidth, timeSigWidth, clefWidth, courtesyClefExtraWidth, effectiveTimeSigStyle } from './header.js';
import { barlineFootprint } from './barlines.js';
import { columnsWidth } from './columns.js';

/**
 * Type de barre en fin de mesure, tel qu'on le prévoit quand la mesure suivante reste sur la même ligne : les drapeaux de
 * reprise l'emportent (fin de reprise, début de reprise de la mesure suivante, ou les deux) ; sinon le type du masterbar ; la
 * dernière mesure du mouvement est finale par défaut.
 */
/** Élément de décor masqué sur la portée `s` (rang de `ctx.staves`) à la mesure `mi` ? Un élément masqué ne prend plus de place (voir model/decor.js). */
export const decorHiddenOn = (ctx, s, kind, mi) => isDecorHidden(s.staff, kind, ctx.movement.masterbars[mi].id);

export function endBarType(ctx, mi) {
  const mbs = ctx.movement.masterbars;
  const end = getProperty(mbs[mi], PID.REPEAT_END);
  const startNext = mi + 1 < mbs.length && getProperty(mbs[mi + 1], PID.REPEAT_START);
  if (end && startNext) return 'endStartRepeat';
  if (end) return 'endRepeat';
  if (startNext) return 'startRepeat';
  const type = getProperty(mbs[mi], PID.BAR_TYPE);
  return mi === mbs.length - 1 && type === 'simple' && ctx.style(SID.END_BAR_FINAL) !== false ? 'final' : type;
}

/**
 * Convention de MuseScore (`MeasureLayout::createSystemBeginBarLine`), reprise du prototype : l'ouverture de reprise ne reste
 * jamais en fin de ligne, elle est redessinée en tête du système suivant. Ce qui reste en fin de ligne : une barre simple, ou
 * seulement la moitié « fin de reprise » d'une barre fin+début.
 * @returns { endType, splitsRepeat }
 */
export function endBarTypeAtBreak(ctx, mi) {
  const type = endBarType(ctx, mi);
  if (type === 'startRepeat') return { endType: getProperty(ctx.movement.masterbars[mi], PID.BAR_TYPE), splitsRepeat: true };
  if (type === 'endStartRepeat') return { endType: 'endRepeat', splitsRepeat: true };
  return { endType: type, splitsRepeat: false };
}

/**
 * En-tête de système : trois colonnes (clé, armure, chiffrage) dont chacune a la largeur maximale parmi les portées.
 * @param mi          mesure qui ouvre le système (son armure et son chiffrage)
 * @param showTimeSig le chiffrage n'apparaît que sur le 1er système et là où il change (`changeSpec`)
 */
export function headerSpec(ctx, mi, showTimeSig, columns = null, squeeze = 1) {
  const { glyphs } = ctx;
  const masterbar = ctx.movement.masterbars[mi];
  // armure PAR PORTÉE (hauteur sonnante : l'armure écrite d'un instrument transpositeur diffère de celle de concert, `PID.KEY_SIG`)
  const ksByStaff = ctx.staves.map((s) => keySigOf(s.ctx.keySigs[mi]));
  const ks = ksByStaff[0] ?? keySigOf(getProperty(masterbar, PID.KEY_SIG));
  const ts = getProperty(masterbar, PID.TIME_SIG);
  const tsStyle = effectiveTimeSigStyle(ts, getProperty(masterbar, PID.TIME_SIG_STYLE));
  let clefW = 0;
  let ksW = 0;
  let tsW = 0;
  let clefTail = 0; // espace entre le bord visible de la clé et la fin de sa largeur réservée
  let lettersW = 0; // lettres des cordes (tablature) devant la clé, communes à toutes les portées pour garder les mêmes x
  for (const [si, s] of ctx.staves.entries()) {
    const letters = s.painter.stringLetters ? s.painter.stringLetters(s.staff, s.ctx) : null;
    if (letters) lettersW = Math.max(lettersW, letters.width);
    const clef = s.painter.clef(s.staff, s.ctx, mi);
    if (clef && !decorHiddenOn(ctx, s, 'clef', mi)) {
      const cw = clefWidth(glyphs, clef);
      if (cw > clefW) { clefW = cw; clefTail = clef.width !== undefined ? 0 : GLYPH_PAD; }
    }
    if (ctx.style(SID.HEADER_SHOW_KEYSIG) !== false && s.painter.keySig(s.staff, s.ctx) && !decorHiddenOn(ctx, s, 'keySig', mi)) ksW = Math.max(ksW, keySigWidth(glyphs, ksByStaff[si], ksByStaff[si]));
    if (showTimeSig && ctx.style(SID.HEADER_SHOW_TIMESIG) !== false && s.painter.timeSig(s.staff, s.ctx) && !decorHiddenOn(ctx, s, 'timeSig', mi)) tsW = Math.max(tsW, timeSigWidth(glyphs, ts, tsStyle));
  }
  // Compression (`squeezeSystemToFit`, `squeezeFactor` < 1) : MuseScore multiplie par `squeezeFactor` la marge gauche de la clé (`getFirstSegmentXPos`,
  // `clefLeftMargin`), les remplissages clé → armure et armure → chiffrage (`PaddingTable`) et les distances d'en-tête (`minHorizontalDistance`).
  // Sans effet à 1 ; l'intérieur d'une armure (écart entre altérations) ne change pas (vérifié sur export, page de 40 sp).
  const shape = Boolean(columns && ctx.style(SID.SHAPE_SPACING));
  // (a squeezed system takes the left margin down to nothing, as MuseScore does for a clef; a chord staff opens with a measure bar a little before its first chord,
  // which would then lie outside the page and not be seen: that room stays)
  const leftPad = Math.max(LEFT_PAD * squeeze, ctx.staves.some((s) => s.type === 'chord') ? CHORD_MIN_LEFT_PAD : 0);
  if (squeeze < 1) {
    if (clefW > 0 && clefTail > 0) clefW -= GLYPH_PAD * (1 - squeeze);
    if (ksW > 0) ksW -= KEY_SIG_END_PAD * (1 - squeeze);
  }
  let fixed = lettersW + clefW + ksW + TIMESIG_PAD + tsW;
  if (shape) {
    // MuseScore `minHorizontalDistance`, exceptions d'en-tête : la 1re colonne est à `systemHeaderDistance` (2,5 sp ; 2,0 après un chiffrage,
    // `systemHeaderTimeSigDistance`) du bord droit du dernier élément d'en-tête, et son élément le plus à gauche (altération...) à 1,5 sp au moins.
    const tail = tsW > 0 ? 0 : ksW > 0 ? KEY_SIG_END_PAD * squeeze + KEY_SIG_GAP : clefTail * squeeze;
    const dist = ctx.style(tsW > 0 ? SID.SYSTEM_HEADER_TIME_SIG_DISTANCE : SID.SYSTEM_HEADER_DISTANCE) * squeeze;
    const lead0 = columns.length ? columns[0].lead : 0; // réserve à gauche de l'origine déjà comprise dans la 1re colonne
    const shapeLeft = columns.length ? columns[0].shapeLeft ?? lead0 : 0; // point le plus à gauche de ses formes
    const gap = Math.max(dist, ABSOLUTE_MIN_HEADER_DISTANCE * squeeze + shapeLeft) - lead0;
    fixed = lettersW + clefW + ksW + tsW - tail + gap;
  }
  return { lettersW, clefW, ksW, tsW, ks, ksByStaff, ts, tsStyle, fixed, leftPad, showTs: showTimeSig };
}

/**
 * Décalage (par rapport à la fin de l'espace qui suit la barre) du 1er bloc d'un changement d'armure ou de chiffrage :
 * l'écart total barre → bloc vaut la MOITIÉ de (espace après barre + marge gauche du bloc) — demande de Jean : le prototype
 * laissait trop d'air. Négatif : le bloc rentre dans l'espace qui suit la barre.
 */
export const changeLeftGap = (margin) => (margin - BARLINE_GAP) / 2;

const SQUEEZE_STEP = 0.2; // `squeezeSystemToFit` : pas de réduction des distances entre formes
const STRETCH_REDUCTION_STEP = 0.33; // pas de réduction de l'étirement par durée

const sameTimeSig = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Changements d'armure et de chiffrage à l'ouverture de la mesure `mi` par rapport à la précédente :
 * { ks: { new, prev, w } | null, ts: { ts, w } | null } (w = largeur des glyphes, maximum sur les portées qui les affichent).
 * Mis en cache dans le contexte (les portées et les masterbars ne changent pas pendant une mise en page).
 */
export function changeSpec(ctx, mi) {
  if (!ctx.changeCache) ctx.changeCache = new Map();
  if (ctx.changeCache.has(mi)) return ctx.changeCache.get(mi);
  const result = { ks: null, ts: null };
  if (mi > 0) {
    const mbs = ctx.movement.masterbars;
    const newKs = getProperty(mbs[mi], PID.KEY_SIG);
    const prevKs = getProperty(mbs[mi - 1], PID.KEY_SIG);
    const changed = ctx.staves.length ? ctx.staves.some((s) => s.ctx.keySigs[mi] !== s.ctx.keySigs[mi - 1]) : newKs !== prevKs;
    if (changed) result.ks = keyChange(ctx, mi, newKs, prevKs);
    const newTs = getProperty(mbs[mi], PID.TIME_SIG);
    const prevTs = getProperty(mbs[mi - 1], PID.TIME_SIG);
    const newStyle = effectiveTimeSigStyle(newTs, getProperty(mbs[mi], PID.TIME_SIG_STYLE));
    const prevStyle = effectiveTimeSigStyle(prevTs, getProperty(mbs[mi - 1], PID.TIME_SIG_STYLE));
    if (!sameTimeSig(newTs, prevTs) || newStyle !== prevStyle) {
      let w = 0;
      for (const s of ctx.staves) if (s.painter.timeSig(s.staff, s.ctx) && !decorHiddenOn(ctx, s, 'timeSig', mi)) w = Math.max(w, timeSigWidth(ctx.glyphs, newTs, newStyle));
      result.ts = { ts: newTs, w, style: newStyle };
    }
  }
  ctx.changeCache.set(mi, result);
  return result;
}

function keyChange(ctx, mi, newKs, prevKs) {
  // armures PAR PORTÉE (voir headerSpec) ; `new` / `prev` = celles de la 1re portée (cas d'une armure commune à toutes)
  const byStaff = ctx.staves.map((s) => ({ new: keySigOf(s.ctx.keySigs[mi]), prev: keySigOf(s.ctx.keySigs[mi - 1]) }));
  let w = 0;
  ctx.staves.forEach((s, si) => { if (s.painter.keySig(s.staff, s.ctx) && !decorHiddenOn(ctx, s, 'keySig', mi)) w = Math.max(w, keySigWidth(ctx.glyphs, byStaff[si].new, byStaff[si].prev)); });
  return { new: byStaff[0]?.new ?? keySigOf(newKs), prev: byStaff[0]?.prev ?? keySigOf(prevKs), byStaff, w };
}

/**
 * Petite clé de courtoisie avant la barre de `mi`, si une portée quelconque change de clé au tout début de `mi + 1` : la
 * plus large sur les portées concernées (chaque portée a son propre horaire — `PID.CLEF_CHANGES` lui appartient).
 */
function clefTrailingWidth(ctx, mi) {
  let w = 0;
  for (const s of ctx.staves) {
    const clef = s.ctx.clefChangeEndingMeasure ? s.ctx.clefChangeEndingMeasure(mi) : null;
    if (clef) w = Math.max(w, courtesyClefExtraWidth(ctx.glyphs, clef));
  }
  return w;
}

/** Largeur naturelle d'une mesure : { fixed, flex, content } (content = colonnes seules, sans l'espace après la barre). */
export function measureWidth(ctx, columns, mi, header) {
  const content = columnsWidth(columns);
  let fixed = (header ? header.fixed : 0) + barlineFootprint(endBarType(ctx, mi));
  // espace APRÈS la barre précédente, compté au début de la mesure (rien en tête de système)
  let flex = content + (header ? 0 : barGap(ctx, columns, mi) + leadGap(ctx, columns, mi, header)) + clefTrailingWidth(ctx, mi);
  if (!header) {
    // armure et chiffrage qui changent à l'ouverture de la mesure : dessinés après la barre (glyphes = largeur fixe, marges étirables)
    const ch = changeSpec(ctx, mi);
    const hasKs = ch.ks && ch.ks.w > 0;
    if (hasKs) {
      fixed += ch.ks.w;
      flex += changeLeftGap(KEYSIG_LEFT_MARGIN);
      if (firstNoteHasAccidental(columns)) flex += KEYSIG_ACCIDENTAL_MARGIN;
    }
    if (ch.ts && ch.ts.w > 0) { fixed += ch.ts.w; flex += (hasKs ? TIMESIG_LEFT_MARGIN : changeLeftGap(TIMESIG_LEFT_MARGIN)) + TIMESIG_PAD; }
  }
  return { fixed, flex, content };
}

/** La mesure s'ouvre-t-elle sur un changement d'armure / de chiffrage (dessiné après la barre, avec ses propres marges) ? */
function opensWithChange(ctx, mi) {
  const ch = changeSpec(ctx, mi);
  return !!((ch.ks && ch.ks.w > 0) || (ch.ts && ch.ts.w > 0));
}

/**
 * Espace entre le bord droit de la barre précédente et le début de la mesure (avant un éventuel changement d'armure / de chiffrage).
 * Espacement par formes : `BAR_LINE → NOTE` / `BAR_LINE → ACCIDENTAL` de MuseScore (`columns.barGap`) ; sinon (ou si la mesure s'ouvre
 * sur un changement, dont les marges sont celles du prototype) : `BARLINE_GAP`.
 */
export function barGap(ctx, columns, mi) {
  if (ctx.style(SID.SHAPE_SPACING) && columns.length && columns.barGap !== undefined && !opensWithChange(ctx, mi)) return columns.barGap;
  return BARLINE_GAP;
}

/** Espace de plus (prototype `EXTRA_NO_ACC_GAP`) en tête d'une mesure qui n'ouvre pas un système et dont la 1re colonne n'a pas d'altération. */
export function leadGap(ctx, columns, mi, header) {
  if (header || !columns.length) return 0;
  if (ctx.style(SID.SHAPE_SPACING) && columns.barGap !== undefined && !opensWithChange(ctx, mi)) return 0;
  return columns[0].lead === 0 ? EXTRA_NO_ACC_GAP : 0;
}

/** La 1re colonne de la mesure réserve-t-elle de la place pour une altération visible (`col.lead > 0`) ? */
function firstNoteHasAccidental(columns) {
  return columns.length > 0 && columns[0].lead > 0;
}

/**
 * Retour à la ligne glouton puis justification.
 * @param available  largeur disponible en espaces (Infinity : un seul système, jamais étiré)
 * @param firstReduction  place retirée au 1er système (indentation du premier système), en espaces
 * @returns systèmes { first, last, fixed, flex, stretch, natural, width, header, leadRepeat, repeatX, measures: [{ mi, start, content, barX, endType }] }
 */
export function breakIntoSystems(ctx, allColumns, available, justifyLast = false, firstReduction = 0, plan = {}) {
  // print layout of a part (screen 2): forced breaks AFTER a measure (`breaks`: Map index → 'system' | 'page'), fixed systems (`locks`: [{ from, to }],
  // measure indices) and the fill limit above which the last system is justified (`lastFill`, fraction ; null = never)
  const forced = plan.breaks ?? new Map();
  const locks = plan.locks ?? [];
  const lockOf = (mi) => locks.find((l) => mi >= l.from && mi <= l.to);
  const n = ctx.movement.masterbars.length;
  // the first system can be indented (`firstReduction` spaces less room), the others use the full width
  const availAt = (k) => (k === 0 ? available - firstReduction : available);
  // slots between measures: fixed width, carried by the measure that follows (or, at the end, by the last one)
  const slotSpace = (mi) => ctx.slots.widthBefore(mi) + (mi === n - 1 ? ctx.slots.widthEnd() : 0);
  // REGULAR MEASURES: every measure takes the width of the widest one (the breaking into lines then counts the same number of measures on every line), and the columns of a measure are
  // spread over that width (`stretchColumns`)
  const regular = ctx.style(SID.REGULAR_MEASURES) === true;
  const regularContent = regular ? Math.max(0, ...allColumns.map((c) => columnsWidth(c))) : 0;
  const perSystem = Math.max(0, Math.floor(ctx.style(SID.MEASURES_PER_SYSTEM) ?? 0));
  const widthOf = (mi, header) => {
    const w = measureWidth(ctx, allColumns[mi], mi, header);
    const flex = regular ? w.flex - columnsWidth(allColumns[mi]) + regularContent : w.flex;
    return { ...w, flex, fixed: w.fixed + slotSpace(mi) };
  };
  const headerFor = (mi, isFirstSystem, squeeze = 1) => headerSpec(ctx, mi, isFirstSystem || changeSpec(ctx, mi).ts !== null, allColumns[mi], squeeze);

  // MEASURE GRID (layout/measuregrid.js): equal columns, the bar lines of a line fall under those of the others (not with an unbounded width)
  const gridOn = Number.isFinite(available) && ctx.style(SID.MEASURE_GRID) === 'columns';
  const systems = [];
  let cur = [];
  let curFixed = LEFT_PAD;
  let curFlex = 0;
  let curHeader = null;

  // Compression d'un système plus large que la page (`HorizontalSpacing::squeezeSystemToFit`) : MuseScore ne coupe une ligne que s'il reste
  // au moins deux mesures, donc seul le système d'UNE mesure trop large arrive ici. On réduit d'abord les distances entre formes
  // (`squeezeFactor` 0,8 → 0 par pas de 0,2) et la place naturelle des durées (`stretchReduction` 0,67 → 0,01 → … par pas de 0,33),
  // jusqu'à ce que ça tienne. Sinon le facteur uniforme `sys.stretch` (< 1) prend le relais.
  const squeezeToFit = () => {
    if (!Number.isFinite(available) || !ctx.style(SID.SHAPE_SPACING)) return;
    const total = () => cur.reduce((sum, mi, k) => { const w = widthOf(mi, k === 0 ? curHeader : null); return sum + w.fixed + w.flex; }, curHeader.leftPad);
    let squeeze = 1 - SQUEEZE_STEP;
    let reduction = 1 - STRETCH_REDUCTION_STEP;
    while (total() > availAt(systems.length) && squeeze >= -1e-9) {
      for (const mi of cur) respaceColumns(allColumns[mi], squeeze, reduction);
      curHeader = headerFor(cur[0], systems.length === 0, Math.max(squeeze, 0));
      squeeze -= SQUEEZE_STEP;
      reduction -= STRETCH_REDUCTION_STEP;
    }
    curFixed = curHeader.leftPad;
    curFlex = 0;
    cur.forEach((mi, k) => { const w = widthOf(mi, k === 0 ? curHeader : null); curFixed += w.fixed; curFlex += w.flex; });
  };

  const close = () => {
    squeezeToFit();
    // l'espace après la dernière barre ne compte pas : le système finit pile sur sa barre de fin
    systems.push({ first: cur[0], last: cur[cur.length - 1], fixed: curFixed, flex: curFlex, header: curHeader, ...(forced.get(cur[cur.length - 1]) === 'page' ? { pageBreak: true } : {}) });
  };

  for (let mi = 0; mi < (gridOn ? 0 : n); mi++) {
    const isFirst = cur.length === 0;
    const header = isFirst ? headerFor(mi, systems.length === 0) : null;
    const w = widthOf(mi, header);
    const lock = lockOf(mi);
    const inLock = Boolean(lock) && lock.from < mi; // a measure inside a fixed system never moves to the next line
    const forcedBreak = cur.length > 0 && (forced.has(mi - 1) || (lock && lock.from === mi) || (lockOf(mi - 1) && lockOf(mi - 1).to === mi - 1));
    if (cur.length && !inLock && (forcedBreak || (perSystem > 0 && cur.length >= perSystem) || curFixed + curFlex + w.fixed + w.flex > availAt(systems.length))) {
      close();
      const h = headerFor(mi, false);
      const wf = widthOf(mi, h);
      cur = [mi];
      curHeader = h;
      curFixed = h.leftPad + wf.fixed;
      curFlex = wf.flex;
    } else {
      if (isFirst) curHeader = header;
      cur.push(mi);
      curFixed += w.fixed;
      curFlex += w.flex;
    }
  }
  if (cur.length) close();
  if (gridOn) {
    // the same room for the clef / key / time signature on every line (and for an opening repeat), then the columns; a section begins a line
    const sections = new Set(sectionSpans(ctx.movement).map((sp) => sp.index).filter((i) => i > 0));
    let headerW = 0;
    for (let mi = 0; mi < n; mi++) {
      if (mi === 0 || ctx.staves.some((st) => st.ctx.keySigs[mi] !== st.ctx.keySigs[mi - 1])) { const h = headerFor(mi, mi === 0); headerW = Math.max(headerW, h.leftPad + h.fixed); }
    }
    const left0 = headerW + (ctx.movement.masterbars.some((b) => getProperty(b, PID.REPEAT_START)) ? barlineFootprint('startRepeat') + BARLINE_GAP : 0);
    const need = []; const overhead = []; const natural = []; const slots = [];
    for (let mi = 0; mi < n; mi++) {
      const w = measureWidth(ctx, allColumns[mi], mi, null);
      const total = w.fixed + slotSpace(mi) + w.flex;
      need.push(total); overhead.push(total - w.content); natural.push(w.content); slots.push(allColumns[mi].length);
    }
    // a fixed system (`locks`) is a line of its own, drawn as without a grid: the author fixed it by hand, that wins
    const breaksAfter = new Set(forced.keys());
    for (const l of locks) { if (l.from > 0) breaksAfter.add(l.from - 1); breaksAfter.add(l.to); }
    const g = planGrid({ need, overhead, natural, slots, avail: Math.max(1, available - left0), base: ctx.style(SID.MEASURE_GRID_BASE) ?? 'common', chords: ctx.style(SID.MEASURE_GRID_CHORDS) ?? 2, columns: perSystem, stretch: ctx.style(SID.MEASURE_GRID_STRETCH) ?? 'off', starts: sections, breaksAfter });
    let lockDone = null;
    g.lines.forEach((items) => {
      const first = items[0].mi; const last = items[items.length - 1].mi;
      const lock = lockOf(first);
      if (lock) {
        if (lockDone === lock) return; // the other lines of the same fixed system were taken with the first
        lockDone = lock;
        cur = []; for (let mi = lock.from; mi <= lock.to; mi++) cur.push(mi);
        curHeader = headerFor(lock.from, systems.length === 0);
        curFixed = curHeader.leftPad; curFlex = 0;
        cur.forEach((mi, j) => { const w = widthOf(mi, j === 0 ? curHeader : null); curFixed += w.fixed; curFlex += w.flex; });
        close();
        return;
      }
      systems.push({ first, last, fixed: left0, flex: 0, header: headerFor(first, systems.length === 0), grid: { items, left0, pitch: g.pitch, columns: g.columns }, ...(forced.get(last) === 'page' ? { pageBreak: true } : {}) });
    });
  }

  // reprises coupées par un retour à la ligne : la barre d'ouverture passe en tête du système suivant (largeurs fixes)
  const mbs = ctx.movement.masterbars;
  systems.forEach((sys, i) => {
    const next = systems[i + 1];
    if (next) {
      const { endType, splitsRepeat } = endBarTypeAtBreak(ctx, sys.last);
      sys.lastEndType = endType;
      if (splitsRepeat) {
        sys.fixed -= barlineFootprint(endBarType(ctx, sys.last)) - barlineFootprint(endType);
        next.leadRepeat = true;
      }
    } else sys.lastEndType = endBarType(ctx, sys.last);
    if (sys.first === 0 && getProperty(mbs[0], PID.REPEAT_START)) sys.leadRepeat = true; // ouverture de reprise du tout début
  });
  systems.forEach((sys) => {
    if (sys.leadRepeat) sys.fixed += barlineFootprint('startRepeat') + BARLINE_GAP;
  });

  // armure et chiffrage de précaution en fin de ligne, quand le système suivant s'ouvre sur un changement
  systems.forEach((sys, i) => {
    const next = systems[i + 1];
    if (!next || gridOn) return; // (no courtesy signs on a grid: the columns leave no room at the end of the line)
    const change = changeSpec(ctx, next.first);
    if (change.ks && change.ks.w > 0 && ctx.style(SID.GEN_COURTESY_KEYSIG)) {
      sys.courtesyKs = { ...change.ks };
      sys.fixed += change.ks.w;
      sys.flex += KEYSIG_LEFT_MARGIN + KEYSIG_TRAILER_MARGIN;
      if (sys.lastEndType === 'simple') { // barre double avant l'armure de précaution (keySigCourtesyBarlineMode)
        sys.fixed += barlineFootprint('double') - barlineFootprint('simple');
        sys.lastEndType = 'double';
      }
    }
    if (change.ts && change.ts.w > 0 && ctx.style(SID.GEN_COURTESY_TIMESIG)) {
      sys.courtesyTs = { ...change.ts };
      sys.fixed += change.ts.w;
      sys.flex += TIMESIG_LEFT_MARGIN + TIMESIG_BARLINE_MARGIN;
    }
  });

  systems.forEach((sys, i) => {
    // dernier système justifié seulement sur demande (`justifyLast`), ou s'il remplit assez la largeur (`plan.lastFill`, MuseScore lastSystemFillLimit)
    const fillsEnough = plan.lastFill != null && Number.isFinite(available) && (sys.fixed + sys.flex) / availAt(i) >= plan.lastFill;
    const isLast = i === systems.length - 1 && !justifyLast && !fillsEnough;
    sys.stretch = isLast || !Number.isFinite(available) ? 1 : sys.flex > 0 ? Math.max(0, (availAt(i) - sys.fixed) / sys.flex) : 1;
    sys.natural = sys.fixed + sys.flex;
    sys.width = sys.fixed + sys.flex * sys.stretch;
    if (sys.grid) { const lastItem = sys.grid.items[sys.grid.items.length - 1]; sys.stretch = 1; sys.width = sys.grid.left0 + (lastItem.col + lastItem.span) * sys.grid.pitch; sys.natural = sys.width; } // a grid line ends on its last column

    // positions : chaque mesure commence là où finit la précédente (barre + espace étirable)
    let cursor = sys.header.leftPad + sys.header.fixed;
    if (sys.leadRepeat) {
      sys.repeatX = cursor; // barre d'ouverture de reprise, après clé/armure/chiffrage, avant la 1re note
      cursor += barlineFootprint('startRepeat') + BARLINE_GAP;
    }
    sys.measures = [];
    for (let mi = sys.first; mi <= sys.last; mi++) {
      const gi = sys.grid ? sys.grid.items[mi - sys.first] : null;
      if (gi) cursor = sys.grid.left0 + gi.col * sys.grid.pitch; // every measure of a grid begins in its column
      // slots before this measure: after the bar that ends the previous one (or the header / the opening repeat), before its own content
      const slotsBefore = [];
      for (const col of ctx.slots.before[mi] ?? []) { slotsBefore.push({ x: cursor, width: col.width, entries: col.entries }); cursor += col.width; }
      let content = (regular ? regularContent : columnsWidth(allColumns[mi])) * sys.stretch;
      let cx = cursor + (mi === sys.first ? 0 : barGap(ctx, allColumns[mi], mi) * sys.stretch);
      const change = {};
      let hasKsChange = false;
      if (mi !== sys.first) {
        const ch = changeSpec(ctx, mi);
        const hasKs = ch.ks && ch.ks.w > 0;
        hasKsChange = hasKs;
        if (hasKs) { change.ks = { ...ch.ks, x: cx + changeLeftGap(KEYSIG_LEFT_MARGIN) * sys.stretch }; cx = change.ks.x + ch.ks.w; }
        if (ch.ts && ch.ts.w > 0) {
          change.ts = { ...ch.ts, x: cx + (hasKs ? TIMESIG_LEFT_MARGIN : changeLeftGap(TIMESIG_LEFT_MARGIN)) * sys.stretch };
          cx = change.ts.x + ch.ts.w + TIMESIG_PAD * sys.stretch;
        }
      }
      const accGap = hasKsChange && firstNoteHasAccidental(allColumns[mi]) ? KEYSIG_ACCIDENTAL_MARGIN * sys.stretch : 0;
      const start = cx + accGap + leadGap(ctx, allColumns[mi], mi, mi === sys.first ? sys.header : null) * sys.stretch;
      if (gi) { // the measure ends where its columns end: its notes are spread over what is left after the bar
        const right = sys.grid.left0 + (gi.col + gi.span) * sys.grid.pitch;
        content = Math.max(0.5, right - barlineFootprint(mi === sys.last ? sys.lastEndType : endBarType(ctx, mi)) - clefTrailingWidth(ctx, mi) - start);
      }
      const end = start + content;
      // barre de mesure juste après le contenu ; l'armure/le chiffrage de précaution (MuseScore) se placent APRÈS elle,
      // pas avant : c'est ce qui reste en fin de ligne qui compte pour la justification, la barre ne recule pas pour eux.
      // La clé, elle, fait l'inverse : toujours une petite clé AVANT la barre qui précède la mesure où elle change (que
      // cette barre finisse une ligne ou non — vérifié sur un export MuseScore), donc la barre recule pour lui faire de la place.
      const barX = end + clefTrailingWidth(ctx, mi) * sys.stretch;
      const endType = mi === sys.last ? sys.lastEndType : endBarType(ctx, mi);
      const courtesy = {};
      let after = barX + barlineFootprint(endType);
      if (mi === sys.last) {
        if (sys.courtesyKs) { courtesy.ks = { ...sys.courtesyKs, x: after + KEYSIG_LEFT_MARGIN * sys.stretch }; after = courtesy.ks.x + sys.courtesyKs.w + KEYSIG_TRAILER_MARGIN * sys.stretch; }
        if (sys.courtesyTs) { courtesy.ts = { ...sys.courtesyTs, x: after + TIMESIG_LEFT_MARGIN * sys.stretch }; after = courtesy.ts.x + sys.courtesyTs.w + TIMESIG_BARLINE_MARGIN * sys.stretch; }
      }
      const slotsAfter = [];
      if (mi === ctx.movement.masterbars.length - 1) for (const col of ctx.slots.end) { slotsAfter.push({ x: after, width: col.width, entries: col.entries }); after += col.width; }
      sys.measures.push({ mi, start, content, barX, endType, change, courtesy, slotsBefore, slotsAfter });
      cursor = after;
    }
  });
  return systems;
}
