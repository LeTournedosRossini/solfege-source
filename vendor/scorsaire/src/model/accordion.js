/*
 * Accordéon main gauche (basses standards, système Stradella « 2+4 ») — tranche 6c.
 * Modèle de la note de portée « accordéon » (`accnote`) : un BOUTON identifié par son rang (`PID.ACC_ROW`) et son épellation.
 *   rang 1 contre-basse · 2 basse fondamentale · 3 accord majeur · 4 mineur · 5 septième de dominante · 6 diminué.
 * Rangs 1-2 : note de basse à sa hauteur réelle écrite (clé de fa). Rangs 3-6 : l'épellation donne la FONDAMENTALE de l'accord (l'octave n'a pas
 * de sens : le bouton est posé à une position neutre, voir layout/painters/accordion.js).
 * Tout ce qui se déduit n'est jamais stocké : nom de l'accord, rang/position du badge, couleur, repère « 8 », style d'anneau.
 *
 * Position (colonne du clavier). Dans un rang les boutons sont espacés d'une quinte ; la colonne d'un bouton est celle de sa fondamentale. La
 * contre-basse (rang 1) est la TIERCE MAJEURE au-dessus de la basse de sa colonne (Do → Mi : exemple de Jean, `3/7 4/7 2/7 1/7` pour Do, Do mineur,
 * basse Do et contre-basse Mi). Numérotation : Do = colonne 7 (`positionOfC` du système, à confirmer par Jean sur un clavier réel), les
 * colonnes montent en quintes vers le bas du clavier (Fa 6, Do 7, Sol 8, Ré 9…), repliées sur 12 (Fa♯ = Sol♭ = 1).
 */
export const ACC_ROW_COUNTER_BASS = 1;
export const ACC_ROW_BASS = 2;
export const ACC_CHORD_ROWS = [3, 4, 5, 6];
/** Qualité de l'accord d'un rang (rangs 3-6) et suffixe écrit dans le bouton. */
export const ACC_ROW_QUALITY = { 3: 'M', 4: 'm', 5: '7', 6: 'dim' };
export const ACC_ROW_SUFFIX = { 3: '', 4: 'm', 5: '7', 6: 'dim' };

export const ACCORDION_SYSTEMS = {
  'stradella-2-4-italian': { name: 'Stradella 2+4, système italien', rows: 6, positionOfC: 7 },
};
export const DEFAULT_ACCORDION_SYSTEM = 'stradella-2-4-italian';

const STEP_FIFTHS = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };
const FIFTHS_STEPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B']; // index = fifths + 1 (modulo 7)

/** Position de l'épellation sur le cycle des quintes (Do = 0, Sol = 1, Fa = −1, Do♯ = 7, Si♭ = −2). */
export function spellingFifths(spelling) {
  return STEP_FIFTHS[spelling.step] + 7 * (spelling.alter ?? 0);
}

/** Épellation { step, alter } d'une position sur le cycle des quintes. */
export function fifthsSpelling(fifths) {
  const k = fifths + 1;
  return { step: FIFTHS_STEPS[((k % 7) + 7) % 7], alter: Math.floor(k / 7) };
}

export const isBassRow = (row) => row === ACC_ROW_COUNTER_BASS || row === ACC_ROW_BASS;
export const isChordRow = (row) => row >= 3 && row <= 6;

/** Fondamentale de la COLONNE du bouton : l'épellation, sauf contre-basse (tierce majeure au-dessus : on redescend de 4 quintes). */
export function columnRoot(row, spelling) {
  return row === ACC_ROW_COUNTER_BASS ? fifthsSpelling(spellingFifths(spelling) - 4) : { step: spelling.step, alter: spelling.alter ?? 0 };
}

/** Numéro de colonne (1 à 12) du bouton dans le système donné. */
export function buttonPosition(row, spelling, systemId = DEFAULT_ACCORDION_SYSTEM) {
  const sys = ACCORDION_SYSTEMS[systemId] ?? ACCORDION_SYSTEMS[DEFAULT_ACCORDION_SYSTEM];
  const f = spellingFifths(columnRoot(row, spelling));
  return ((((sys.positionOfC - 1 + f) % 12) + 12) % 12) + 1;
}

/** Texte du badge « rang/position » (`3/7`). */
export function buttonBadge(row, spelling, systemId) {
  return `${row}/${buttonPosition(row, spelling, systemId)}`;
}

const ACCIDENTAL_GLYPH = { '-2': 'accidentalDoubleFlat', '-1': 'accidentalFlat', 1: 'accidentalSharp', 2: 'accidentalDoubleSharp' };

/**
 * Nom d'un bouton d'accord, en morceaux à dessiner : { letter, accidental (glyphe Bravura ou null), suffix ('' | 'm' | '7'), diminished (glyphe °) }.
 * Lettres et suffixes sont du texte ; dièse / bémol et « ° » sont des glyphes (choix de Jean, 06/10/2026).
 */
export function chordButtonName(row, spelling) {
  const alter = spelling.alter ?? 0;
  return {
    letter: spelling.step,
    accidental: ACCIDENTAL_GLYPH[alter] ?? null,
    suffix: ACC_ROW_SUFFIX[row] === 'dim' ? '' : ACC_ROW_SUFFIX[row] ?? '',
    diminished: row === 6,
  };
}

/** Nom écrit en clair du bouton (tests, export textuel) : « C », « F♯m », « B♭7 », « D° ». */
export function chordButtonText(row, spelling) {
  const n = chordButtonName(row, spelling);
  const acc = { accidentalDoubleFlat: '𝄫', accidentalFlat: '♭', accidentalSharp: '♯', accidentalDoubleSharp: '𝄪' }[n.accidental] ?? '';
  return `${n.letter}${acc}${n.suffix}${n.diminished ? '°' : ''}`;
}

// ---------- réglages de la portée (comme la percmap : par portée, exportables) ----------
export const ACCORDION_LAYOUT_FORMAT = 'scorsaire-accordion';
export const ACCORDION_LAYOUT_VERSION = 1;
export const BUTTON_PLACEMENTS = ['above', 'below'];
/** Valeurs par défaut : boutons d'accord au-dessus de la portée, centre à 2,5 sp au-dessus de la ligne du haut (choix de Jean 07/10/2026 ; le prototype : 1,2). */
export const DEFAULT_ACCORDION_LAYOUT = { buttonPlacement: 'above', buttonOffset: 2.5 };

export function createAccordionLayout({ buttonPlacement = 'above', buttonOffset = 2.5 } = {}) {
  return { buttonPlacement, buttonOffset };
}

/** Problèmes de réglages (vide = valide). `null` / absent = valeurs par défaut. */
export function validateAccordionLayout(layout) {
  if (layout == null) return [];
  if (typeof layout !== 'object' || Array.isArray(layout)) return ['accordéon : objet attendu'];
  const errors = [];
  if (!BUTTON_PLACEMENTS.includes(layout.buttonPlacement)) errors.push(`accordéon : côté des boutons invalide « ${layout.buttonPlacement} » (above, below)`);
  if (typeof layout.buttonOffset !== 'number' || !Number.isFinite(layout.buttonOffset) || layout.buttonOffset < -3 || layout.buttonOffset > 12) {
    errors.push('accordéon : hauteur des boutons invalide (nombre d\'espaces entre −3 et 12)');
  }
  return errors;
}

/** Réglages résolus d'une portée (valeur de PID.ACCORDION_LAYOUT, éventuellement partielle ou absente). */
export function resolveAccordionLayout(value) {
  return { ...DEFAULT_ACCORDION_LAYOUT, ...(value ?? {}) };
}

export function exportAccordionLayout(layout) {
  const l = layout ?? createAccordionLayout();
  const errors = validateAccordionLayout(l);
  if (errors.length) throw new Error(`Accordéon invalide : ${errors[0]}`);
  return JSON.stringify({ format: ACCORDION_LAYOUT_FORMAT, version: ACCORDION_LAYOUT_VERSION, accordion: l }, null, 2);
}

export function importAccordionLayout(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error('Fichier d\'accordéon illisible (JSON invalide)'); }
  }
  if (!data || data.format !== ACCORDION_LAYOUT_FORMAT) throw new Error('Ce fichier n\'est pas un réglage d\'accordéon Scorsaire');
  if (data.version > ACCORDION_LAYOUT_VERSION) throw new Error(`Réglage d'accordéon de version ${data.version}, plus récente que celle supportée (${ACCORDION_LAYOUT_VERSION})`);
  const errors = validateAccordionLayout(data.accordion);
  if (errors.length) throw new Error(errors[0]);
  return createAccordionLayout(data.accordion);
}
