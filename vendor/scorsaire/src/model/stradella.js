/*
 * Table des accords Stradella (accordéon, main gauche) : hauteurs jouées par un bouton d'accord (rangs 3 à 6 de `accordion.js`).
 * Décision de Jean (08/10/2026) : « une table simple où chaque bouton d'accord joue l'accord en position fondamentale proche de C3 ;
 * pour les septièmes et les diminuées, les quatre notes » ; d'autres tables viendront s'ajouter (registre `STRADELLA_TABLES`).
 *
 * Table = donnée pure : { id, name, center, voicings } — `center` = hauteur MIDI de référence (C3 = 48, do central = 60), `voicings` = pour chaque
 * qualité (M, m, 7, dim) la liste des intervalles en demi-tons au-dessus de la fondamentale (position fondamentale). La fondamentale est la
 * hauteur de sa classe de hauteur la plus PROCHE de `center` ; à égale distance (triton) on prend la plus grave : de fa♯2 (42) à fa3 (53).
 * Les rangs 1 et 2 (contre-basse, basse) jouent leur hauteur écrite réelle : pas de table.
 */
export const STRADELLA_QUALITIES = Object.freeze(['M', 'm', '7', 'dim']);

export const DEFAULT_STRADELLA_TABLE = Object.freeze({
  id: 'root-position-c3',
  name: 'Position fondamentale proche de C3',
  center: 48,
  voicings: Object.freeze({
    M: Object.freeze([0, 4, 7]),
    m: Object.freeze([0, 3, 7]),
    7: Object.freeze([0, 4, 7, 10]),
    dim: Object.freeze([0, 3, 6, 9]),
  }),
});

/** Tables disponibles (identifiant → table) ; les alternatives futures s'y ajoutent. */
export const STRADELLA_TABLES = { [DEFAULT_STRADELLA_TABLE.id]: DEFAULT_STRADELLA_TABLE };

/** Table désignée par un identifiant ou un objet table ; la table par défaut sinon. */
export function resolveStradellaTable(value) {
  if (value && typeof value === 'object') return value;
  return STRADELLA_TABLES[value] ?? DEFAULT_STRADELLA_TABLE;
}

/** Erreurs de validation d'une table (liste vide = valide). */
export function validateStradellaTable(table) {
  const errors = [];
  if (!table || typeof table !== 'object') return ['table Stradella : objet attendu'];
  if (typeof table.id !== 'string' || !table.id) errors.push('table Stradella : identifiant manquant');
  if (!Number.isInteger(table.center)) errors.push('table Stradella : « center » doit être un entier MIDI');
  for (const q of STRADELLA_QUALITIES) {
    const v = table.voicings?.[q];
    if (!Array.isArray(v) || v.length === 0 || !v.every((n) => Number.isInteger(n))) errors.push(`table Stradella : intervalles manquants pour « ${q} »`);
  }
  return errors;
}

/** Hauteur MIDI de la fondamentale la plus proche de `center` (égalité : la plus grave). */
export function stradellaRoot(table, pitchClassOrPitch) {
  const offset = ((((pitchClassOrPitch - table.center) % 12) + 12) % 12);
  return table.center + (offset >= 6 ? offset - 12 : offset);
}

/**
 * Hauteurs MIDI jouées par un bouton d'accord.
 * @param quality  'M' | 'm' | '7' | 'dim'
 * @param rootPitch  hauteur MIDI de la fondamentale (toute octave : seule la classe de hauteur compte)
 */
export function stradellaChordPitches(table, quality, rootPitch) {
  const intervals = table.voicings[quality];
  if (!intervals) return [];
  const root = stradellaRoot(table, rootPitch);
  return intervals.map((i) => root + i);
}
