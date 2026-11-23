/*
 * Dictionnaire de qualités d'accord (portée d'accords, lecture) : identifiant de qualité → notes de l'accord, en demi-tons au-dessus de la fondamentale.
 * Même principe que la percmap : donnée pure, modifiable par l'utilisateur, exportable / importable (`scorsaire-chord-qualities`, et section
 * `chordQualities` du fichier de préférences). La qualité d'un symbole (`PID.CHORD_QUALITY`) reste un simple identifiant ; ce dictionnaire dit quelles
 * notes il joue. Une qualité ABSENTE du dictionnaire n'est pas comprise : la lecture ne joue alors que la fondamentale (ou la basse), comme MuseScore
 * pour un symbole qu'il ne comprend pas (`RealizedHarmony::generateNotes`, AUTO : « just render the root if the harmony isn't understandable »).
 *
 * Contenu par défaut = la table `CHORD_INTERVALS` de CCE (chord-chart-editor, utilisée pour l'affichage clavier), mêmes identifiants que la popup de CCE,
 * avec deux corrections validées avec Jean (10/10/2026) : `alt` = ♭9 ♯9 ♭5 ♯5 ♭7 (CCE n'avait pas le ♯5 ; MuseScore, `getIntervals`, ajoute ♭5 et ♯5) ; `7#11` garde
 * la 9e de CCE (MuseScore, lecture littérale : sans 9e). Les 26 autres qualités donnent les mêmes classes de hauteur que `RealizedHarmony::getIntervals` de
 * MuseScore 4.7.5 (vérifié une à une, lecture littérale). Les intervalles au-delà de l'octave (9e = 14…) sont conservés ; la lecture n'en utilise que la
 * classe de hauteur (voicing « close » de MuseScore).
 *
 *   qualité = { id, intervals: [demi-tons ≥ 0], aliases?: [autres écritures du même accord],
 *               variants?: [écritures AFFICHABLES proposées : '-7', 'm7', 'min7'], shown?: écriture choisie (∈ variants ; absente = affichage dérivé de l'identifiant),
 *               enharmonic?: [intervalles (de `intervals`) notés par leur écriture énharmonique : ♯4 au lieu de ♭5…],
 *               gaps?: [espace SUPPLÉMENTAIRE (em du corps de la qualité, −0,5 à 1) après chaque pièce de l'écriture affichée, sauf la dernière] }
 * Le NOM D'AFFICHAGE est séparé de l'identifiant : un variant est un texte composé de boutons (chiffres, lettres, ° ø Δ + - ♭ ♯ ( ) /), jamais une saisie libre ;
 * le majeur (identifiant '') reste stocké comme majeur et s'affiche sans signe tant qu'aucun variant n'est choisi.
 */
export const CHORD_QUALITIES_FORMAT = 'scorsaire-chord-qualities';
export const CHORD_QUALITIES_VERSION = 3; // v2 : `variants`, `shown`, `enharmonic` ; v3 : `gaps` (les fichiers v1 et v2 restent lisibles)

/** Écriture affichable : suite de « boutons » (chiffres, lettres, ° ø Δ + - ♭ ♯ ( ) /) — jamais un texte libre. */
export const VARIANT_MAX = 12;
/** Bornes (em) de l'espace supplémentaire entre deux pièces d'une écriture. */
export const GAP_MIN = -0.5;
export const GAP_MAX = 1;
export const MAX_VARIANTS = 8;
export const VARIANT_BUTTONS = Object.freeze(['°', 'ø', 'Δ', '+', '-', '♭', '♯', '(', ')', '/', 'm', 'M', 'maj', 'min', 'dim', 'aug', 'sus', 'add', 'alt', '2', '3', '4', '5', '6', '7', '9', '11', '13']);
const DISPLAY_VARIANT_RE = /^[0-9A-Za-z°øΔ+\-♭♯()/]+$/;
export const isDisplayVariant = (text) => typeof text === 'string' && text.length > 0 && text.length <= VARIANT_MAX && DISPLAY_VARIANT_RE.test(text);

const q = (id, intervals, aliases, variants) => Object.freeze({
  id, intervals: Object.freeze(intervals),
  ...(aliases ? { aliases: Object.freeze(aliases) } : {}),
  ...(variants ? { variants: Object.freeze(variants) } : {}),
});

/** Qualités de CCE (`QUALITIES` + `CHORD_INTERVALS`) ; `''` = accord majeur. */
export const DEFAULT_CHORD_QUALITIES = Object.freeze([
  q('', [0, 4, 7], ['maj', 'major', 'majeur']),
  q('5', [0, 7]),
  q('m', [0, 3, 7], ['min', 'mi', '-', 'minor', 'mineur'], ['-', 'm', 'min']),
  q('7', [0, 4, 7, 10]),
  q('M7', [0, 4, 7, 11], ['maj7', 'ma7', 'Δ', 'Δ7', '△', '△7'], ['Δ7', 'maj7', 'M7']),
  q('m7', [0, 3, 7, 10], ['-7', 'min7', 'mi7'], ['-7', 'm7', 'min7']),
  q('mMaj7', [0, 3, 7, 11], ['mM7', 'm(maj7)', 'm(M7)', 'min(maj7)'], ['m(maj7)', 'mM7', '-Δ7']),
  q('m7b5', [0, 3, 6, 10], ['ø7', 'ø', 'min7b5', 'm7-5'], ['ø', 'ø7', 'm7♭5']),
  q('o7', [0, 3, 6, 9], ['°7', 'dim7'], ['°7', 'dim7']),
  q('o', [0, 3, 6], ['°', 'dim'], ['°', 'dim']),
  q('9', [0, 4, 7, 10, 14]),
  q('M9', [0, 4, 7, 11, 14], ['maj9'], ['Δ9', 'maj9', 'M9']),
  q('m9', [0, 3, 7, 10, 14], ['min9'], ['-9', 'm9', 'min9']),
  q('11', [0, 4, 7, 10, 14, 17]),
  q('13', [0, 4, 7, 10, 14, 17, 21]),
  q('6', [0, 4, 7, 9]),
  q('m6', [0, 3, 7, 9], ['min6'], ['-6', 'm6', 'min6']),
  q('69', [0, 4, 7, 9, 14], ['6/9']),
  q('sus4', [0, 5, 7], ['sus']),
  q('sus2', [0, 2, 7]),
  q('7sus4', [0, 5, 7, 10], ['7sus']),
  q('aug', [0, 4, 8], ['+'], ['+', 'aug']),
  q('7b9', [0, 4, 7, 10, 13]),
  q('7#9', [0, 4, 7, 10, 15]),
  q('7#11', [0, 4, 7, 10, 14, 18]),
  q('7b5', [0, 4, 6, 10]),
  q('7b13', [0, 4, 7, 10, 20]),
  q('alt', [0, 4, 6, 8, 10, 13, 15]),
  q('add9', [0, 4, 7, 14], ['(add9)']),
  q('madd9', [0, 3, 7, 14], ['m(add9)', '-add9']),
  q('7#5', [0, 4, 8, 10], ['+7', 'aug7', '7+'], ['7+', '+7', '7♯5']),
]);

/** Crée un dictionnaire (copie indépendante) ; sans argument, le dictionnaire par défaut. */
export function createChordQualities({ qualities = DEFAULT_CHORD_QUALITIES } = {}) {
  return { qualities: qualities.map(cloneQuality) };
}

/** Copie indépendante d'une qualité (champs facultatifs gardés seulement s'ils sont non vides). */
function cloneQuality(x) {
  const out = { id: x.id, intervals: [...x.intervals] };
  if (x.aliases?.length) out.aliases = [...x.aliases];
  if (x.variants?.length) out.variants = [...x.variants];
  if (x.shown !== undefined) out.shown = x.shown;
  if (x.enharmonic?.length) out.enharmonic = [...x.enharmonic];
  if (x.gaps?.length) out.gaps = [...x.gaps];
  return out;
}

export const DEFAULT_CHORD_QUALITY_DICTIONARY = Object.freeze({ qualities: DEFAULT_CHORD_QUALITIES });

/** Erreurs de validation (liste vide = valide) : identifiants et alias uniques, intervalles entiers de 0 à 127, au moins une note. */
export function validateChordQualities(dict) {
  const errors = [];
  if (!dict || typeof dict !== 'object' || !Array.isArray(dict.qualities)) return ['dictionnaire de qualités : « qualities » (liste) manquant'];
  const seen = new Set();
  for (const quality of dict.qualities) {
    if (!quality || typeof quality !== 'object') { errors.push('dictionnaire de qualités : entrée invalide'); continue; }
    if (typeof quality.id !== 'string' || quality.id.length > 16) { errors.push('dictionnaire de qualités : identifiant invalide (texte de 16 caractères au plus)'); continue; }
    const names = [quality.id, ...(quality.aliases ?? [])];
    if (quality.aliases !== undefined && (!Array.isArray(quality.aliases) || !quality.aliases.every((a) => typeof a === 'string' && a.length > 0 && a.length <= 16))) {
      errors.push(`dictionnaire de qualités : alias invalides pour « ${quality.id} »`);
    }
    for (const name of names) {
      if (seen.has(name)) errors.push(`dictionnaire de qualités : « ${name} » apparaît deux fois`);
      seen.add(name);
    }
    if (!Array.isArray(quality.intervals) || quality.intervals.length === 0 || !quality.intervals.every((n) => Number.isInteger(n) && n >= 0 && n <= 127)) {
      errors.push(`dictionnaire de qualités : intervalles invalides pour « ${quality.id} » (entiers de 0 à 127, au moins un)`);
    }
    if (quality.variants !== undefined && (!Array.isArray(quality.variants) || quality.variants.length > MAX_VARIANTS || new Set(quality.variants).size !== quality.variants.length || !quality.variants.every(isDisplayVariant))) {
      errors.push(`dictionnaire de qualités : écritures affichables invalides pour « ${quality.id} » (${MAX_VARIANTS} au plus, distinctes, ${VARIANT_MAX} caractères au plus, boutons autorisés seulement)`);
    }
    if (quality.shown !== undefined && !(Array.isArray(quality.variants) && quality.variants.includes(quality.shown))) {
      errors.push(`dictionnaire de qualités : l'écriture choisie de « ${quality.id} » n'est pas dans ses écritures affichables`);
    }
    if (quality.enharmonic !== undefined && (!Array.isArray(quality.enharmonic) || !quality.enharmonic.every((n) => Array.isArray(quality.intervals) && quality.intervals.includes(n) && chordIntervalHasAlternative(n)))) {
      errors.push(`dictionnaire de qualités : énharmonie invalide pour « ${quality.id} » (intervalles de la qualité qui ont une autre écriture)`);
    }
    if (quality.gaps !== undefined && (!Array.isArray(quality.gaps) || quality.gaps.length > VARIANT_MAX || !quality.gaps.every((g) => Number.isFinite(g) && g >= GAP_MIN && g <= GAP_MAX))) {
      errors.push(`dictionnaire de qualités : espacements invalides pour « ${quality.id} » (${VARIANT_MAX} au plus, de ${GAP_MIN} à ${GAP_MAX} em)`);
    }
  }
  return errors;
}

/** Entrée du dictionnaire désignée par un identifiant ou un alias (null si absente). */
export function findChordQuality(dict, id) {
  const text = id ?? '';
  for (const quality of (dict ?? DEFAULT_CHORD_QUALITY_DICTIONARY).qualities) {
    if (quality.id === text || quality.aliases?.includes(text)) return quality;
  }
  return null;
}

/** Intervalles (demi-tons au-dessus de la fondamentale) d'une qualité, ou null si elle n'est pas dans le dictionnaire. */
export function chordQualityIntervals(dict, id) {
  return findChordQuality(dict, id)?.intervals ?? null;
}

// Opérations d'édition : PURES (renvoient un nouveau dictionnaire) ; l'appelant les range avec le reste des préférences.
export function addChordQuality(dict, quality) {
  const next = createChordQualities({ qualities: [...dict.qualities, quality] });
  const errors = validateChordQualities(next);
  if (errors.length) throw new Error(errors[0]);
  return next;
}

export function updateChordQuality(dict, id, changes) {
  if (!dict.qualities.some((x) => x.id === id)) throw new Error(`dictionnaire de qualités : « ${id} » n'existe pas`);
  const next = createChordQualities({ qualities: dict.qualities.map((x) => (x.id === id ? { ...x, ...changes } : x)) });
  const errors = validateChordQualities(next);
  if (errors.length) throw new Error(errors[0]);
  return next;
}

export function removeChordQuality(dict, id) {
  return createChordQualities({ qualities: dict.qualities.filter((x) => x.id !== id) });
}

export function exportChordQualities(dict) {
  const errors = validateChordQualities(dict);
  if (errors.length) throw new Error(`Dictionnaire de qualités invalide : ${errors[0]}`);
  return JSON.stringify({ format: CHORD_QUALITIES_FORMAT, version: CHORD_QUALITIES_VERSION, chordQualities: dict }, null, 2);
}

/** Lit un fichier de dictionnaire (texte ou objet) ; refuse tout ce qui est invalide (jamais de réparation silencieuse). */
export function importChordQualities(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error('Fichier de dictionnaire de qualités illisible (JSON invalide)'); }
  }
  if (!data || data.format !== CHORD_QUALITIES_FORMAT) throw new Error('Ce fichier n\'est pas un dictionnaire de qualités d\'accord Scorsaire');
  if (data.version > CHORD_QUALITIES_VERSION) throw new Error(`Dictionnaire de version ${data.version}, plus récente que celle supportée (${CHORD_QUALITIES_VERSION})`);
  const errors = validateChordQualities(data.chordQualities);
  if (errors.length) throw new Error(`Dictionnaire de qualités invalide : ${errors[0]}`);
  return createChordQualities(data.chordQualities);
}

// ---------- éditeur du dictionnaire (étape 5, tranche 5) : aides PURES, sans Document ----------

/** Erreur typée des opérations d'édition : `code` (voir ci-dessous) et `data` (nombre de symboles concernés, noms en conflit…) pour que l'interface la formule. */
export class ChordQualityError extends Error {
  constructor(code, message, data = {}) { super(message); this.name = 'ChordQualityError'; this.code = code; this.data = data; }
}
// codes : 'invalid' (dictionnaire ou valeur invalide) | 'unknown' (qualité absente) | 'conflict' (nom déjà pris) | 'in-use' (des symboles utilisent la qualité) | 'not-default' (pas une qualité intégrée)

/** Tous les noms sous lesquels une qualité est reconnue : son identifiant puis ses alias. */
export const chordQualityNames = (quality) => [quality.id, ...(quality.aliases ?? [])];

/** Qualité intégrée portant cet identifiant PAR DÉFAUT (l'identité d'une qualité intégrée est son identifiant d'origine), ou null. */
export const defaultChordQuality = (id) => DEFAULT_CHORD_QUALITIES.find((x) => x.id === id) ?? null;

const sameList = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Vrai si deux qualités ont mêmes identifiant, intervalles (dans l'ordre) et alias (dans l'ordre). */
export const sameChordQuality = (a, b) => a.id === b.id && sameList(a.intervals, b.intervals) && sameList(a.aliases, b.aliases)
  && sameList(a.variants, b.variants) && (a.shown ?? null) === (b.shown ?? null) && sameList(a.enharmonic, b.enharmonic) && sameList(a.gaps, b.gaps);

/** Vrai si le dictionnaire est exactement le dictionnaire intégré (même qualités, même ordre) : le document n'a alors rien à stocker. */
export function isDefaultChordQualities(dict) {
  const list = dict?.qualities ?? [];
  return list.length === DEFAULT_CHORD_QUALITIES.length && list.every((x, i) => sameChordQuality(x, DEFAULT_CHORD_QUALITIES[i]));
}

/** Qualités intégrées dont l'identifiant d'origine n'est plus dans le dictionnaire (supprimées ou renommées) : restaurables. */
export function missingDefaultChordQualities(dict) {
  const ids = new Set(dict.qualities.map((x) => x.id));
  return DEFAULT_CHORD_QUALITIES.filter((x) => !ids.has(x.id));
}

/** Vrai si la qualité d'identifiant `id` est une qualité intégrée MODIFIÉE (intervalles ou alias différents de l'origine). */
export function isModifiedDefaultChordQuality(dict, id) {
  const origin = defaultChordQuality(id);
  const current = dict.qualities.find((x) => x.id === id);
  return !!origin && !!current && !sameChordQuality(current, origin);
}

/**
 * Écriture littérale que donne l'affichage dérivé de l'identifiant (réglages par défaut : tiret, ø, Δ, +, °, ♭ ♯) : `m7` → « -7 », `M7` → « Δ7 », `m7b5` → « ø »,
 * `7b9` → « 7♭9 ». `null` si le résultat n'est pas une écriture valide (identifiant vide = majeur, caractères hors alphabet, trop long).
 */
export function identifierDisplayText(id) {
  if (!id) return null;
  let rest = id.replace(/b(\d)/g, '♭$1').replace(/#(\d)/g, '♯$1');
  let head = '';
  if (rest.startsWith('m7♭5')) { head = 'ø'; rest = rest.slice(4); }
  else if (rest.startsWith('M7')) { head = 'Δ'; rest = rest.slice(1); }
  else if (rest.startsWith('aug')) { head = '+'; rest = rest.slice(3); }
  else if (rest === 'o' || rest.startsWith('o7')) { head = '°'; rest = rest.slice(1); }
  else if (rest.startsWith('m') && !rest.startsWith('maj')) { head = '-'; rest = rest.slice(1); }
  const text = head + rest;
  return isDisplayVariant(text) ? text : null;
}

/** Copie de la qualité avec, si elle n'a pas d'écriture choisie, celle de son identifiant (ajoutée aux écritures et choisie). Sans effet si impossible. */
export function withAutoShown(quality) {
  if (quality.shown != null) return quality;
  const text = identifierDisplayText(quality.id);
  if (text == null) return quality;
  const variants = [...(quality.variants ?? [])];
  if (!variants.includes(text)) { if (variants.length >= 8) return quality; variants.push(text); }
  return { ...quality, variants, shown: text };
}

const fail = (code, message, data) => { throw new ChordQualityError(code, message, data); };
const check = (dict) => { const errors = validateChordQualities(dict); if (errors.length) fail('invalid', errors[0]); return dict; };
const need = (dict, id) => { const quality = dict.qualities.find((x) => x.id === id); if (!quality) fail('unknown', `dictionnaire de qualités : « ${id} » n'existe pas`, { id }); return quality; };
const owner = (dict, name) => dict.qualities.find((x) => chordQualityNames(x).includes(name)) ?? null;
const copy = cloneQuality;

/** Ajoute une qualité en fin de liste (noms déjà pris → erreur `conflict`). */
export function addQuality(dict, spec) {
  for (const name of chordQualityNames(spec)) {
    const taken = owner(dict, name);
    if (taken) fail('conflict', `« ${name} » est déjà utilisé par la qualité « ${taken.id || '(aucune)'} »`, { name, by: taken.id });
  }
  return check(createChordQualities({ qualities: [...dict.qualities, copy(spec)] }));
}

/** Remplace les intervalles d'une qualité (triés, sans doublon). */
export function setQualityIntervals(dict, id, intervals) {
  need(dict, id);
  return check(createChordQualities({ qualities: dict.qualities.map((x) => (x.id === id ? { ...copy(x), intervals: [...new Set(intervals)].sort((a, b) => a - b) } : copy(x))) }));
}

/** Remplace les alias d'une qualité (noms déjà pris par une autre → erreur `conflict`). */
export function setQualityAliases(dict, id, aliases) {
  need(dict, id);
  for (const name of aliases) {
    const taken = owner(dict, name);
    if (taken && taken.id !== id) fail('conflict', `« ${name} » est déjà utilisé par la qualité « ${taken.id || '(aucune)'} »`, { name, by: taken.id });
  }
  return check(createChordQualities({ qualities: dict.qualities.map((x) => { const c = copy(x); if (x.id === id) { delete c.aliases; if (aliases.length) c.aliases = [...aliases]; } return c; }) }));
}

/** Change l'identifiant d'une qualité (même place dans la liste, mêmes intervalles et alias). Les symboles sont migrés par l'appelant. */
export function renameQuality(dict, id, newId) {
  need(dict, id);
  if (newId === id) return createChordQualities(dict);
  const taken = owner(dict, newId);
  if (taken) fail('conflict', `« ${newId} » est déjà utilisé par la qualité « ${taken.id || '(aucune)'} »`, { name: newId, by: taken.id });
  return check(createChordQualities({ qualities: dict.qualities.map((x) => (x.id === id ? { ...copy(x), id: newId } : copy(x))) }));
}

/** Retire une qualité. Les symboles qui l'utilisent sont gérés par l'appelant. */
export function removeQuality(dict, id) {
  need(dict, id);
  return createChordQualities({ qualities: dict.qualities.filter((x) => x.id !== id).map(copy) });
}

/** Remet une qualité intégrée telle qu'à l'origine (intervalles ET alias), à sa place dans la liste. Un alias d'origine pris par une autre qualité → `conflict`. */
export function resetQuality(dict, id) {
  const origin = defaultChordQuality(id);
  if (!origin) fail('not-default', `« ${id || '(aucune)'} » n'est pas une qualité intégrée`, { id });
  need(dict, id);
  for (const name of chordQualityNames(origin)) {
    const taken = owner(dict, name);
    if (taken && taken.id !== id) fail('conflict', `« ${name} » est déjà utilisé par la qualité « ${taken.id || '(aucune)'} »`, { name, by: taken.id });
  }
  return check(createChordQualities({ qualities: dict.qualities.map((x) => (x.id === id ? copy(origin) : copy(x))) }));
}

/** Ajoute (en fin de liste) une qualité intégrée absente du dictionnaire, avec sa définition d'origine. Nom déjà pris → `conflict`. */
export function restoreQuality(dict, id) {
  const origin = defaultChordQuality(id);
  if (!origin) fail('not-default', `« ${id || '(aucune)'} » n'est pas une qualité intégrée`, { id });
  if (dict.qualities.some((x) => x.id === id)) fail('conflict', `« ${id || '(aucune)'} » est déjà dans le dictionnaire`, { name: id, by: id });
  return addQuality(dict, origin);
}

// ---------- écriture affichable et énharmonie (compléments de la tranche 5, 11/10/2026) ----------

/** Remplace la liste d'écritures affichables d'une qualité ; l'écriture choisie est retirée si elle n'y est plus. */
export function setQualityVariants(dict, id, variants) {
  need(dict, id);
  return check(createChordQualities({ qualities: dict.qualities.map((x) => {
    const c = copy(x);
    if (x.id !== id) return c;
    delete c.variants;
    if (variants.length) c.variants = [...variants];
    if (c.shown !== undefined && !variants.includes(c.shown)) { delete c.shown; delete c.gaps; }
    return c;
  }) }));
}

/** Choisit l'écriture affichée (`null` = affichage dérivé de l'identifiant, selon les préférences d'affichage). */
export function setQualityShown(dict, id, shown) {
  need(dict, id);
  return check(createChordQualities({ qualities: dict.qualities.map((x) => {
    const c = copy(x);
    if (x.id !== id) return c;
    if ((c.shown ?? null) !== (shown ?? null)) delete c.gaps; // les espacements appartiennent à l'écriture affichée
    delete c.shown;
    if (shown !== null && shown !== undefined) c.shown = shown;
    return c;
  }) }));
}

/** Remplace la liste des intervalles notés par leur écriture énharmonique. */
export function setQualityEnharmonic(dict, id, list) {
  need(dict, id);
  return check(createChordQualities({ qualities: dict.qualities.map((x) => {
    const c = copy(x);
    if (x.id !== id) return c;
    delete c.enharmonic;
    const kept = [...new Set(list)].sort((a, b) => a - b);
    if (kept.length) c.enharmonic = kept;
    return c;
  }) }));
}

/** Remplace les espacements (em) entre les pièces de l'écriture affichée ; les zéros de queue sont retirés, liste vide = aucun réglage. */
export function setQualityGaps(dict, id, gaps) {
  need(dict, id);
  return check(createChordQualities({ qualities: dict.qualities.map((x) => {
    const c = copy(x);
    if (x.id !== id) return c;
    delete c.gaps;
    const list = gaps.map((g) => Math.round(g * 100) / 100);
    while (list.length && list[list.length - 1] === 0) list.pop();
    if (list.length) c.gaps = list;
    return c;
  }) }));
}

/** Espacements (em) de la qualité d'un symbole (texte de qualité, identifiant ou alias) ; liste vide si aucun. */
export function chordQualityGaps(dict, text) {
  return findChordQuality(dict, text ?? '')?.gaps ?? [];
}

/** Écriture à afficher pour le texte de qualité d'un symbole : le variant choisi, ou `null` (affichage dérivé de l'identifiant). */
export function chordQualityDisplay(dict, text) {
  const quality = findChordQuality(dict, text ?? '');
  return quality?.shown ?? null;
}

// ---------- noms de notes et étiquettes de degré (aperçus) ----------
// CHOIX DE SCORSAIRE (MuseScore ne garde que des classes de hauteur : aucune règle d'orthographe à porter) : un intervalle de 0 à 23 demi-tons reçoit un DEGRÉ
// (♭5 plutôt que ♯4, ♯5 plutôt que ♭6, ♭7…) ; la lettre de la note = lettre de la fondamentale + (degré − 1) lettres, l'altération en découle.
// Décision de Jean (11/10/2026) : l'énharmonie est le mode par défaut (noms depuis la fondamentale), et chaque intervalle d'une qualité peut basculer sur l'autre
// écriture (`ALT_DEGREE`) ; le mode « par tonalité » (option de la portée d'accords) garde les noms de l'armure pour les notes de la gamme.
const DEGREE_OF = [1, 2, 2, 3, 3, 4, 5, 5, 5, 6, 7, 7, 8, 9, 9, 9, 10, 11, 11, 12, 13, 13, 14, 14];
// autre écriture usuelle des intervalles qui en ont une : 3 (♭3→♯2), 6 (♭5→♯4), 8 (♯5→♭6), 9 (6→♭♭7), 10 (♭7→♯6), 15 (♯9→♭10), 18 (♯11→♭12), 20 (♭13→♯12), 21 (13→♭♭14), 22 (♭14→♯13)
const ALT_DEGREE = { 3: 2, 6: 4, 8: 6, 9: 7, 10: 6, 15: 10, 18: 12, 20: 12, 21: 14, 22: 13 };
const MAJOR_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const majorSemitones = (degree) => MAJOR_SEMITONES[(degree - 1) % 7] + 12 * Math.floor((degree - 1) / 7);
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL_TEXT = { '-2': '♭♭', '-1': '♭', 0: '', 1: '♯', 2: '♯♯' };

/** Nombre de touches du clavier de l'éditeur (2 octaves, 0 à 23 demi-tons). */
export const KEYBOARD_SEMITONES = 24;

const inRange = (n) => Number.isInteger(n) && n >= 0 && n < KEYBOARD_SEMITONES;
/** Vrai si l'intervalle (0 à 23 demi-tons, ou au-delà : classe de hauteur repliée) a une autre écriture. */
export function chordIntervalHasAlternative(semitones) {
  if (!Number.isInteger(semitones) || semitones < 0) return false;
  return ALT_DEGREE[inRange(semitones) ? semitones : (semitones % 12) + 12] !== undefined;
}
const degreeOf = (semitones, alt) => (alt && ALT_DEGREE[semitones] !== undefined ? ALT_DEGREE[semitones] : DEGREE_OF[semitones]);

/** Étiquette de degré d'un intervalle de 0 à 23 demi-tons : '1', '♭3', '5', '♭7', '♭9', '♯11', '♭13'… ; `alt` : autre écriture ('♯4') ; null au-delà. */
export function chordIntervalLabel(semitones, { alt = false } = {}) {
  if (!inRange(semitones)) return null;
  const degree = degreeOf(semitones, alt);
  const shift = semitones - majorSemitones(degree);
  return `${ACCIDENTAL_TEXT[shift] ?? ''}${degree}`;
}

const rootPitchOf = (root) => LETTER_PITCH[root.step] + (root.alter ?? 0);
function noteFrom(step, pitch) {
  let alter = (((pitch - LETTER_PITCH[step]) % 12) + 12) % 12;
  if (alter > 6) alter -= 12;
  return { step, alter, text: `${step}${ACCIDENTAL_TEXT[alter] ?? ''}` };
}

/** Nom de la note à `semitones` demi-tons (0 à 23) au-dessus de `root` { step, alter } : { step, alter, text } ('B♭', 'A♯', 'E♯'…) ; `alt` : autre écriture ; null au-delà. */
export function chordIntervalNote(root, semitones, { alt = false } = {}) {
  if (!inRange(semitones)) return null;
  const step = LETTERS[(LETTERS.indexOf(root.step) + degreeOf(semitones, alt) - 1) % 7];
  return noteFrom(step, rootPitchOf(root) + semitones);
}

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
/** Altération d'une lettre dans l'armure (`fifths` > 0 dièses, < 0 bémols). */
export function keyAlterOf(step, fifths) {
  if (fifths > 0) return SHARP_ORDER.slice(0, Math.min(fifths, 7)).includes(step) ? 1 : 0;
  if (fifths < 0) return SHARP_ORDER.slice().reverse().slice(0, Math.min(-fifths, 7)).includes(step) ? -1 : 0;
  return 0;
}

/**
 * Nom de la note SELON LA TONALITÉ : une note de la gamme de l'armure (`fifths`) porte son nom de gamme ; sinon (note chromatique) repli sur l'orthographe depuis la
 * fondamentale (avec `alt`). CHOIX de Scorsaire.
 */
export function chordIntervalNoteInKey(root, semitones, fifths, { alt = false } = {}) {
  if (!inRange(semitones)) return null;
  const pitch = rootPitchOf(root) + semitones;
  for (const step of LETTERS) {
    if ((((LETTER_PITCH[step] + keyAlterOf(step, fifths) - pitch) % 12) + 12) % 12 === 0) return noteFrom(step, pitch);
  }
  return chordIntervalNote(root, semitones, { alt });
}

/**
 * Noms des notes d'une qualité pour une fondamentale ; un intervalle au-delà de 23 demi-tons est replié dans l'octave (même degré que sa classe de hauteur).
 * @param options.enharmonic  intervalles (valeurs de `intervals`) notés par leur autre écriture
 * @param options.spelling    'enharmonic' (défaut) | 'key'
 * @param options.fifths      armure (pour 'key')
 */
export function chordQualityNoteNames(root, intervals, { enharmonic = [], spelling = 'enharmonic', fifths = 0 } = {}) {
  return intervals.map((n) => {
    const folded = n < KEYBOARD_SEMITONES ? n : (n % 12) + 12;
    const alt = enharmonic.includes(n);
    const note = spelling === 'key' ? chordIntervalNoteInKey(root, folded, fifths, { alt }) : chordIntervalNote(root, folded, { alt });
    return note?.text ?? '?';
  });
}

/** Fondamentales proposées pour l'aperçu (ordre chromatique, les deux écritures des touches noires usuelles : C♯/D♭, F♯/G♭). */
export const PREVIEW_ROOTS = Object.freeze([
  { step: 'C', alter: 0 }, { step: 'C', alter: 1 }, { step: 'D', alter: -1 }, { step: 'D', alter: 0 }, { step: 'E', alter: -1 }, { step: 'E', alter: 0 }, { step: 'F', alter: 0 },
  { step: 'F', alter: 1 }, { step: 'G', alter: -1 }, { step: 'G', alter: 0 }, { step: 'A', alter: -1 }, { step: 'A', alter: 0 }, { step: 'B', alter: -1 }, { step: 'B', alter: 0 },
].map((x) => Object.freeze(x)));
