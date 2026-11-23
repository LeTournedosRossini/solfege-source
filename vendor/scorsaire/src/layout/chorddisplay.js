/*
 * Symboles d'accord — mise en forme (étape 5, tranche 3). FONCTIONS PURES, sans DOM : la police est à chasse fixe (JetBrains Mono, avance 0,6 em),
 * donc la largeur d'un symbole se calcule sans navigateur.
 *
 * La mise en forme est celle de CCE (`LeTournedosRossini/cce-editor`, index.html : `chordHTML`, `formatChord`, CSS `.chord-text`), PAS celle de `harmonylayout` de
 * MuseScore (décision de Jean, cadrage 11/10/2026) : fondamentale (+ altération) à gauche, puis une PILE verticale hauteur 1 em, la qualité dans la moitié haute
 * (corps 0,47), la basse dans la moitié basse (corps 0,45). Valeurs par défaut de CCE, en styles (`SID.CHORD_*`). Différences voulues avec CCE :
 *   - ♯ ♭ ° ø Δ + et le tiret du mineur sont des glyphes BRAVURA (`csymAccidentalSharp`, `csymDiminished`, `csymHalfDiminished`, `csymMajorSeventh`,
 *     `csymAugmented`, `csymMinor`), pas des caractères de texte ; `%` et `%%` sont les glyphes SMuFL `repeat1Bar` / `repeat2Bars` (dessin à la main de CCE) ;
 *   - la qualité reste un IDENTIFIANT du dictionnaire (`model/chordquality.js`), jamais un texte saisi : CCE reformate une chaîne brute par expressions régulières,
 *     ici on applique la même logique à l'identifiant (`qualityTokens`) ;
 *   - la fondamentale est un couple { step, alter } indépendant de l'affichage.
 * Géométrie (repère de CCE, 1 em = `SID.CHORD_FONT_SIZE`) : la pile occupe la hauteur de la boîte de la fondamentale (ligne de hauteur 1 em, police d'ascendante 1,02 et
 * de descendante 0,3 : ligne de base à 0,86 em du haut) ; la qualité est centrée à 0,32 em du haut, la basse commence à 0,5 em ; l'altération de la fondamentale est
 * alignée sur le bas de la boîte. La boîte est centrée sur le milieu de la hauteur des barres (décision de Jean : le texte est centré verticalement sur la portée).
 */
import { SID, FIRST_SIGNS } from '../model/index.js';
import { BARLOW_ADVANCES } from './fontmetrics.js';
import { BARLOW_INK, INK_STEP } from './fontink.js';

export const MONO_ADVANCE = 0.6; // JetBrains Mono : avance 600 / 1000 em (vérifié sur la police)
/**
 * Metrics of the chord font: advance of a text (em), capital height, and where the baseline of a 1 em line sits (line height 1 em).
 * Barlow Condensed (proportional: advances read from the font) is the default; any other family is laid out as the monospace font it replaced.
 */
export function fontProfile(family, weight = 400) {
  if (/barlow/i.test(String(family))) {
    const w = weight < 450 ? 400 : weight < 550 ? 500 : weight < 650 ? 600 : 700;
    const table = BARLOW_ADVANCES[w];
    // ascent 1,0 em, descent 0,2 em: half-leading (1 − 1,2) / 2 = −0,1 → baseline 0,9 em below the top of a 1 em line
    const ink = BARLOW_INK[w];
    return {
      textEm: (t) => { let a = 0; for (const ch of String(t)) a += table[ch] ?? table[ch === 'é' ? 'e' : ''] ?? 0.5; return a; }, cap: 0.7, baselineFromTop: 0.9, centerToBaseline: 0.4,
      /** Rightmost ink of the capital `letter` between two heights (em above its baseline), in em from its origin; null when the shape is unknown. */
      inkRight: (letter, y0, y1) => {
        const rows = ink[String(letter).toUpperCase()];
        if (!rows) return null;
        let best = null;
        for (let k = Math.max(0, Math.ceil(y0 / INK_STEP - 1e-9)); k <= Math.min(rows.length - 1, Math.floor(y1 / INK_STEP + 1e-9)); k++) if (rows[k] !== null && (best === null || rows[k] > best)) best = rows[k];
        return best;
      },
    };
  }
  return { textEm: (t) => String(t).length * MONO_ADVANCE, cap: 0.73, baselineFromTop: 0.86, centerToBaseline: 0.36, inkRight: () => null };
}
const BASELINE_FROM_TOP = 0.86; // (ascendante 1,02 − demi-interligne négatif 0,16) pour une ligne de hauteur 1 em
const CENTER_TO_BASELINE = 0.36; // ligne de base − centre de la ligne, en em
const QUAL_CENTER = 0.32; // centre de la ligne de la qualité depuis le haut de la pile (CCE : padding-top 0,3 em du corps .q dans une moitié de pile)
const BASS_TOP = 0.5;
const CAP_HEIGHT = 0.73; // hauteur de capitale de la police (OS/2 sCapHeight 730)
// Glyphes de la plage « chord symbols » de SMuFL : leur hauteur (1,908 sp pour csymMajorSeventh) vaut la capitale du texte voisin ; altérations (hauteur 3 sp) : 0,75 em
const CSYM_REF_HEIGHT = 1.908;
const ACCIDENTAL_GLYPH_HEIGHT = 3.0;
const ACCIDENTAL_EM = 0.75;
const BASS_ACCID_MARGIN = 0.04; // CCE : marge à gauche de l'altération de la basse, en em du corps de la basse
const SMALL_PART = 0.85; // CCE : sus / alt / add à 0,85 em du corps de la qualité
const REPEAT_WIDTH = { repeat1Bar: 0.84, repeat2Bars: 0.88 }; // largeur du signe en em (CCE : svg 0,8 em × corps 1,05, deux barres un peu plus larges)
const NC_SCALE = 0.8;
const NC_LETTER_SPACING = -0.05;

const SPECIALS = new Set(['repeat1', 'repeat2']);

/** Valeurs de style lues une fois : { F, ls, … }. */
export function chordStyleOf(style) {
  return {
    notation: style(SID.CHORD_NOTATION), size: style(SID.CHORD_FONT_SIZE), family: style(SID.CHORD_FONT_FAMILY), weight: style(SID.CHORD_FONT_WEIGHT),
    letterSpacing: style(SID.CHORD_LETTER_SPACING), accidScale: style(SID.CHORD_ACCID_SCALE), accidGap: style(SID.CHORD_ACCID_GAP),
    accidStackOffset: style(SID.CHORD_ACCID_STACK_OFFSET), qualOffset: style(SID.CHORD_QUAL_OFFSET), qualOffsetAccid: style(SID.CHORD_QUAL_OFFSET_ACCID),
    bassOffset: style(SID.CHORD_BASS_OFFSET), qualScale: style(SID.CHORD_QUAL_SCALE), bassScale: style(SID.CHORD_BASS_SCALE),
    minor: style(SID.CHORD_MINOR_STYLE), halfDim: style(SID.CHORD_HALF_DIM_STYLE), delta: style(SID.CHORD_DELTA_STYLE), dash: style(SID.CHORD_DASH_STYLE),
    /** Décalage fin de la qualité (em du corps) pour une fondamentale : lettre + altération. */
    qualShift: (step, alter) => {
      const L = String(step).toUpperCase();
      const k = alter > 0 ? 'SHARP' : alter < 0 ? 'FLAT' : null;
      const get = (axis, key) => (SID[`CHORD_QUAL_${axis}_${key}`] ? style(SID[`CHORD_QUAL_${axis}_${key}`]) : 0);
      return { dx: get('DX', L) + (k ? get('DX', k) : 0), dy: get('DY', L) + (k ? get('DY', k) : 0) };
    },
    autoPlace: style(SID.CHORD_AUTO_PLACE), inkGap: style(SID.CHORD_INK_GAP),
    bassAccidGap: style(SID.CHORD_BASS_ACCID_GAP), slashGap: style(SID.CHORD_BASS_SLASH_GAP),
    /** Shift of the quality by (root letter, first sign), em. */
    qualPairShift: (rootKey, key) => { const dx = SID[`CHORD_QUAL_PAIR_DX_${rootKey}_${key}`]; return key && dx ? { dx: style(dx), dy: style(SID[`CHORD_QUAL_PAIR_DY_${rootKey}_${key}`]) } : { dx: 0, dy: 0 }; },
    /** Shift of the accidental glyph of a root by (letter, kind 's' | 'f'), em. */
    accidShift: (letter, kind) => { const dx = SID[`CHORD_ACCID_PAIR_DX_${String(letter).toUpperCase()}_${kind}`]; return dx ? { dx: style(dx), dy: style(SID[`CHORD_ACCID_PAIR_DY_${String(letter).toUpperCase()}_${kind}`]) } : { dx: 0, dy: 0 }; },
    sharpScale: style(SID.CHORD_SHARP_SCALE), flatScale: style(SID.CHORD_FLAT_SCALE),
    /** Shift of the letter of the bass (against the slash) by (root letter, bass letter), em. */
    bassPairShift: (rootKey, bass) => { const dx = SID[`CHORD_BASS_PAIR_DX_${rootKey}_${String(bass).toUpperCase()}`]; return dx ? { dx: style(dx), dy: style(SID[`CHORD_BASS_PAIR_DY_${rootKey}_${String(bass).toUpperCase()}`]) } : { dx: 0, dy: 0 }; },
    /** Shift of the whole "/bass" block by the root letter, em. */
    bassRootShift: (rootKey) => (SID[`CHORD_BASS_ROOT_DX_${rootKey}`] ? { dx: style(SID[`CHORD_BASS_ROOT_DX_${rootKey}`]), dy: style(SID[`CHORD_BASS_ROOT_DY_${rootKey}`]) } : { dx: 0, dy: 0 }),
    fit: style(SID.CHORD_FIT), fitMin: style(SID.CHORD_FIT_MIN), barHeight: style(SID.CHORD_BAR_HEIGHT),
  };
}

const SOLFEGE = Object.freeze({ C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' });
/** The written name of a note letter: the letter itself (C D E…) or, with `notation: 'latin'`, its French name (Do Ré Mi…). The placement tables stay keyed by the letter. */
export const noteName = (step, st) => (st?.notation === 'latin' ? SOLFEGE[String(step).toUpperCase()] ?? step : step);
const T = (text, extra = {}) => ({ text, ...extra });
const G = (glyph, extra = {}) => ({ glyph, ...extra });

/**
 * Pièces de la qualité d'un identifiant du dictionnaire : [{ text } | { glyph }] (+ `small` pour sus / alt / add). Même logique que `formatChord` de CCE appliquée
 * à l'identifiant (qui suit la fondamentale), avec des glyphes Bravura. `b` et `#` suivis d'un chiffre sont des altérations ; `m` en tête (hors `maj`) est le tiret
 * du mineur ; `m7b5` → ø ; `M7` → Δ ; `o7` → °7 ; `aug` → +. `o` seul → ° (l'identifiant `o` du dictionnaire est le « ° » de la popup de CCE).
 */
/** The triangle of the major seventh: rounded by default, the pointed Bravura one on request. */
const deltaGlyph = (st) => (st.delta === 'sym' ? 'csymMajorSeventh' : 'csymMajorSeventhRound');
export function qualityTokens(id, st) {
  if (!id) return [];
  let rest = id.replace(/b(\d)/g, '♭$1').replace(/#(\d)/g, '♯$1');
  const out = [];
  if (st.halfDim === 'sym' && rest.startsWith('m7♭5')) { out.push(G('csymHalfDiminished')); rest = rest.slice(4); }
  else if (st.delta !== 'text' && rest.startsWith('M7')) { out.push(G(deltaGlyph(st))); rest = rest.slice(2); }
  else if (rest.startsWith('aug')) { out.push(G('csymAugmented')); rest = rest.slice(3); }
  else if (rest === 'o' || rest.startsWith('o7')) { out.push(G('csymDiminished')); rest = rest.slice(1); }
  else if (rest.startsWith('m') && !rest.startsWith('maj')) {
    if (st.minor !== 'dash') out.push(T('m'));
    else if (st.dash === 'glyph') out.push(G('csymMinor'));
    else out.push(T({ std: '-', em: '–', eml: '—' }[st.dash] ?? '–'));
    rest = rest.slice(1);
  }
  const re = /(sus[24]?|alt|add\d*)|♭|♯|./g;
  let m;
  while ((m = re.exec(rest))) {
    if (m[1]) out.push(T(m[1], { small: true }));
    else if (m[0] === '♭') out.push(G('csymAccidentalFlat', { accidental: true }));
    else if (m[0] === '♯') out.push(G('csymAccidentalSharp', { accidental: true }));
    else out.push(T(m[0]));
  }
  return out;
}

/**
 * Pièces d'une ÉCRITURE AFFICHABLE choisie (`quality.shown`, voir `model/chordquality.js`), rendue LITTÉRALEMENT : chaque bouton garde son sens — `-` = tiret du
 * mineur (style `dash`), `°` ø Δ + = glyphes Bravura, ♭ ♯ = altérations, sus / alt / add = petit corps, le reste en texte. Les préférences `minor` / `halfDim` / `delta`
 * ne s'appliquent qu'à l'affichage dérivé de l'identifiant (aucune écriture choisie).
 */
export function variantTokens(text, st) {
  const out = [];
  const re = /(sus[24]?|alt|add\d*)|./g;
  let m;
  while ((m = re.exec(text))) {
    const c = m[0];
    if (m[1]) out.push(T(m[1], { small: true }));
    else if (c === '-') {
      if (st.dash === 'glyph') out.push(G('csymMinor'));
      else out.push(T({ std: '-', em: '–', eml: '—' }[st.dash] ?? '–'));
    }
    else if (c === '°') out.push(G('csymDiminished'));
    else if (c === 'ø') out.push(G('csymHalfDiminished'));
    else if (c === 'Δ') out.push(G(deltaGlyph(st)));
    else if (c === '+') out.push(G('csymAugmented'));
    else if (c === '♭') out.push(G('csymAccidentalFlat', { accidental: true }));
    else if (c === '♯') out.push(G('csymAccidentalSharp', { accidental: true }));
    else out.push(T(c));
  }
  return out;
}

const PIECE_CHARS = { csymMinor: '-', csymHalfDiminished: 'ø', csymMajorSeventh: 'Δ', csymMajorSeventhRound: 'Δ', csymAugmented: '+', csymDiminished: '°', csymAccidentalFlat: '♭', csymAccidentalSharp: '♯' };
const DEFAULT_PIECE_STYLE = { minor: 'dash', halfDim: 'sym', delta: 'sym', dash: 'std' };

/** Pièces (étiquettes) de l'écriture affichée d'une qualité du dictionnaire : celles entre lesquelles se règlent les espacements `gaps`. */
export function qualityPieceLabels(quality) {
  const tokens = quality.shown != null ? variantTokens(quality.shown, DEFAULT_PIECE_STYLE) : qualityTokens(quality.id, DEFAULT_PIECE_STYLE);
  return tokens.map((t) => t.text ?? PIECE_CHARS[t.glyph] ?? '?');
}

/** Class of the first sign of a quality (for the fine shift by first sign): a digit or letter of the text, or the name of the glyph; null when it has none. */
const FIRST_GLYPH = { csymMinor: 'MINOR', csymMajorSeventh: 'DELTA', csymMajorSeventhRound: 'DELTA', csymHalfDiminished: 'HALFDIM', csymDiminished: 'DIM', csymAugmented: 'AUG' };
export function firstSignOf(token) {
  if (!token) return null;
  if (token.glyph !== undefined) return FIRST_GLYPH[token.glyph] ?? null;
  const c = String(token.text ?? '')[0];
  return c && FIRST_SIGNS.includes(c) ? c : null;
}
/** Nom de la note de basse : ['/', lettre, altérations…] (la basse est une note { step, alter }). */
function bassTokens(bass, st) {
  const out = [T('/'), T(noteName(bass.step, st))];
  for (let i = 0; i < Math.abs(bass.alter ?? 0); i++) out.push(G(bass.alter > 0 ? 'csymAccidentalSharp' : 'csymAccidentalFlat', { accidental: true, bassAccid: i === 0 }));
  return out;
}

/** Mise en pile d'une rangée de pièces : avances (sp) et positions relatives au début de la rangée. */
function layRow(tokens, { sizeSp, spacingSp, glyphs, font, startX = 0, gaps = [], bassAccidGap = BASS_ACCID_MARGIN }) {
  const runs = [];
  let x = startX;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (i > 0) x += (gaps[i - 1] ?? 0) * sizeSp; // espace réglé par qualité, après la pièce précédente
    const size = sizeSp * (tk.small ? SMALL_PART : 1);
    if (tk.text !== undefined) {
      // texte à chasse fixe : un espacement de lettres absolu hérité du parent (CCE : `letter-spacing` calculé en longueur)
      const advance = font.textEm(tk.text) * size + tk.text.length * spacingSp;
      runs.push({ type: 'text', text: tk.text, x, size, spacingSp, width: advance });
      x += advance;
    } else {
      const g = glyphs.glyphs[tk.glyph];
      if (!g) throw new Error(`Glyphe inconnu : ${tk.glyph}`);
      const mag = tk.accidental ? (ACCIDENTAL_EM * size) / ACCIDENTAL_GLYPH_HEIGHT : (font.cap * size) / CSYM_REF_HEIGHT;
      if (tk.bassAccid) x += bassAccidGap * sizeSp;
      const advance = g.advance * mag;
      runs.push({ type: 'glyph', name: tk.glyph, x, mag, size, width: advance });
      x += advance;
    }
  }
  return { runs, end: x };
}

/**
 * Mise en forme d'un symbole.
 * @param sym     { root: {step, alter}|null, quality: string, display?: écriture choisie (sinon dérivée de `quality`), bass: {step, alter}|null, special: 'none'|'noChord'|'repeat1'|'repeat2' }
 * @returns { kind: 'chord'|'nc'|'repeat', special?, width (sp, taille réelle), runs: [{ type, x (relatif à l'origine), baseline (relatif au milieu des barres), … }] }
 */
export function chordSymbolLayout(sym, style, glyphs) {
  const st = chordStyleOf(style);
  const F = st.size;
  const special = sym.special ?? 'none';
  if (SPECIALS.has(special)) {
    const name = special === 'repeat1' ? 'repeat1Bar' : 'repeat2Bars';
    const g = glyphs.glyphs[name];
    const w = g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0];
    const mag = (REPEAT_WIDTH[name] * F) / w;
    return repeatLayout(name, g, mag, special);
  }
  if (special === 'noChord' || !sym.root) {
    // N.C. : texte italique à 0,8 em (CCE : `.chord-text.nc`)
    const size = F * NC_SCALE;
    const spacing = NC_LETTER_SPACING * size;
    const text = 'N.C.';
    const width = fontProfile(st.family, st.weight).textEm(text) * size + text.length * spacing;
    return {
      kind: 'nc', width, st,
      runs: [{ type: 'text', text, x: 0, size, spacingSp: spacing, width, italic: true, baseline: -fontProfile(st.family, st.weight).centerToBaseline * size }],
    };
  }

  const font = fontProfile(st.family, st.weight);
  const auto = st.autoPlace !== false;
  const rootBase = F / 2 - font.baselineFromTop * F;
  const spacing = st.letterSpacing * F;
  const runs = [];
  // 1. fondamentale
  const rootText = noteName(sym.root.step, st);
  const letters = st.notation !== 'latin'; // the ink tables only know the capital letters: a French name is followed by the plain gap
  const rootAdvance = font.textEm(rootText) * F + spacing;
  runs.push({ type: 'text', text: rootText, x: 0, size: F, spacingSp: spacing, width: rootAdvance, baseline: F / 2 - font.baselineFromTop * F });
  let x = rootAdvance;
  // altération(s) de la fondamentale : alignées sur le bas de la boîte, corps `accidScale`
  const alter = sym.root.alter ?? 0;
  const accidScale = alter > 0 ? st.sharpScale : st.flatScale;
  const accidSize = F * accidScale;
  const accidBaseline = F / 2 - ((1 - accidScale) * F + font.baselineFromTop * accidSize);
  const rootKey = `${sym.root.step}${alter > 0 ? 's' : alter < 0 ? 'f' : ''}`;
  const accidShift = alter ? st.accidShift(sym.root.step, alter > 0 ? 's' : 'f') : { dx: 0, dy: 0 };
  for (let i = 0; i < Math.abs(alter); i++) {
    const name = alter > 0 ? 'csymAccidentalSharp' : 'csymAccidentalFlat';
    const g = glyphs.glyphs[name];
    const mag = (ACCIDENTAL_EM * accidSize) / ACCIDENTAL_GLYPH_HEIGHT;
    if (i === 0) {
      // placed against the real ink of the root letter, at the height of the accidental (auto placement); else after its advance
      const edge = auto && letters ? font.inkRight(sym.root.step, (accidBaseline + g.bbox.bBoxSW[1] * mag - rootBase) / F, (accidBaseline + g.bbox.bBoxNE[1] * mag - rootBase) / F) : null;
      if (edge !== null) x = edge * F + st.inkGap * F; else x += st.accidGap * accidSize;
      x += accidShift.dx * F; // the user's shift of the accidental also pushes what follows it
    }
    runs.push({ type: 'glyph', name, x, mag, size: accidSize, width: g.advance * mag, baseline: accidBaseline + accidShift.dy * F });
    x += g.advance * mag;
  }
  const hasAccid = alter !== 0;

  // 2. pile : qualité (moitié haute) et basse (moitié basse)
  const qTokens = typeof sym.display === 'string' ? variantTokens(sym.display, st) : qualityTokens(sym.quality, st);
  const bTokens = sym.bass ? bassTokens(sym.bass, st) : [];
  let end = x;
  if (qTokens.length || bTokens.length) {
    const stackX = x + (hasAccid ? st.accidStackOffset * F : 0);
    end = stackX;
    const qSize = F * st.qualScale;
    const bSize = F * st.bassScale;
    if (qTokens.length) {
      const shift = st.qualShift(sym.root.step, alter);
      const first = st.qualPairShift(rootKey, firstSignOf(qTokens[0]));
      shift.dx += first.dx; shift.dy += first.dy;
      const base = F / 2 - (QUAL_CENTER * F + font.centerToBaseline * qSize) + shift.dy * F;
      // without an accidental: against the real ink of the root letter, at the height of the quality (auto placement)
      const edge = auto && letters && !hasAccid ? font.inkRight(sym.root.step, (base - rootBase) / F, (base + font.cap * qSize - rootBase) / F) : null;
      const startX = edge !== null ? edge * F + st.inkGap * F + shift.dx * F : stackX + (hasAccid ? st.qualOffsetAccid : st.qualOffset) * qSize + shift.dx * F;
      const row = layRow(qTokens, { sizeSp: qSize, spacingSp: st.letterSpacing * qSize, glyphs, font, startX, gaps: sym.gaps ?? [] });
      for (const r of row.runs) runs.push({ ...r, baseline: base });
      end = Math.max(end, row.end);
    }
    if (bTokens.length) {
      const rootShift = st.bassRootShift(rootKey);
      const letterShift = st.bassPairShift(rootKey, sym.bass.step);
      const base = F / 2 - (BASS_TOP * F + font.baselineFromTop * bSize) + rootShift.dy * F;
      const edge = auto && letters && !hasAccid ? font.inkRight(sym.root.step, (base - rootBase) / F, (base + font.cap * bSize - rootBase) / F) : null;
      const startX = (edge !== null ? edge * F + st.inkGap * F : stackX + st.bassOffset * bSize) + rootShift.dx * F;
      // CCE : `.b` a `letter-spacing: -0.12em` de SON corps ; the gap between the slash and the letter (index 0) is the user's slash gap + the shift of that bass letter
      const row = layRow(bTokens, { sizeSp: bSize, spacingSp: -0.12 * bSize, glyphs, font, startX, gaps: [((st.slashGap + letterShift.dx) * F) / bSize], bassAccidGap: st.bassAccidGap });
      row.runs.forEach((r, i) => runs.push({ ...r, baseline: i === 0 ? base : base + letterShift.dy * F }));
      end = Math.max(end, row.end);
    }
  }
  return { kind: 'chord', width: end, runs, st };
}

function repeatLayout(name, g, mag, special) {
  const w = (g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0]) * mag;
  const h = (g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1]) * mag;
  // centré sur le milieu des barres : origine du glyphe = coin bas-gauche de sa boîte
  return {
    kind: 'repeat', special, width: w,
    runs: [{ type: 'glyph', name, x: -g.bbox.bBoxSW[0] * mag, mag, size: h, width: w, baseline: -(g.bbox.bBoxNE[1] + g.bbox.bBoxSW[1]) / 2 * mag }],
  };
}

/** Largeur (sp) qu'un symbole réserve dans sa colonne en édition (taille réelle). */
export const chordSymbolWidth = (layout) => layout.width;

/**
 * Éléments d'affichage d'un symbole posé en `x` (repère de portée : y vers le haut, `mid` = milieu des barres).
 * @param scale  compression horizontale (1 = taille réelle) : positions ET largeur des pièces ; les glyphes gardent leur taille et ont `sx`
 */
export function chordSymbolItems(layout, { x, mid, scale = 1, ref, family, weight, centerX = null }) {
  const items = [];
  const dx = centerX === null ? x : centerX - (layout.width * scale) / 2;
  for (const r of layout.runs) {
    const px = dx + r.x * scale;
    const py = mid + r.baseline;
    if (r.type === 'text') {
      items.push({
        kind: 'text', role: 'harmony', ref, x: px, y: py, size: r.size, text: r.text, family, weight: weight === 400 ? undefined : weight,
        italic: r.italic, letterSpacing: r.spacingSp, sx: scale === 1 ? undefined : scale,
        box: { x1: 0, x2: r.width * scale, y1: -0.25 * r.size, y2: fontProfile(family, weight).cap * r.size },
      });
    } else {
      items.push({ kind: 'glyph', role: 'harmony', ref, name: r.name, x: px, y: py, mag: r.mag, sx: scale === 1 ? undefined : scale });
    }
  }
  return items;
}

/** Facteur de compression pour tenir dans `available` (sp) : 1 si ça tient, jamais en dessous de `fitMin` (CCE : Math.max(0.3, case / texte)). */
export function chordFitScale(width, available, fitMin) {
  if (!(width > 0) || !(available > 0) || width <= available) return 1;
  return Math.max(fitMin, available / width);
}
