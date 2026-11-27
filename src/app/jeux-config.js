// Réglages d'un exercice qui se partagent dans son adresse (tonalités choisies, série de 10, mode de questions) : un enseignant peut envoyer le lien, l'élève ouvre l'exercice déjà réglé.
// C'est aussi le format que l'attribution d'exercices du portail reprendra plus tard (phase 4). Rien de personnel n'y figure. Pur, testable sous Node.

/** Les 15 tonalités majeures (armure : n dièses > 0, n bémols < 0). `id` est ASCII pour l'adresse, `label` l'affichage. */
export const TONALITES = [
  { id: 'C', label: 'Do', n: 0 }, { id: 'G', label: 'Sol', n: 1 }, { id: 'D', label: 'Ré', n: 2 }, { id: 'A', label: 'La', n: 3 }, { id: 'E', label: 'Mi', n: 4 }, { id: 'B', label: 'Si', n: 5 }, { id: 'F#', label: 'Fa♯', n: 6 }, { id: 'C#', label: 'Do♯', n: 7 },
  { id: 'F', label: 'Fa', n: -1 }, { id: 'Bb', label: 'Si♭', n: -2 }, { id: 'Eb', label: 'Mi♭', n: -3 }, { id: 'Ab', label: 'La♭', n: -4 }, { id: 'Db', label: 'Ré♭', n: -5 }, { id: 'Gb', label: 'Sol♭', n: -6 }, { id: 'Cb', label: 'Do♭', n: -7 },
];
/** Notes de départ possibles pour le jeu des intervalles (numéros MIDI). */
export const DEPARTS_NOTES = [
  { id: 'G', label: 'Sol', midi: 67 }, { id: 'A', label: 'La', midi: 69 }, { id: 'Bb', label: 'Si♭', midi: 70 }, { id: 'B', label: 'Si', midi: 71 }, { id: 'C', label: 'Do', midi: 72 },
  { id: 'D', label: 'Ré', midi: 74 }, { id: 'Eb', label: 'Mi♭', midi: 75 }, { id: 'E', label: 'Mi', midi: 76 }, { id: 'F', label: 'Fa', midi: 77 }, { id: 'F#', label: 'Fa♯', midi: 78 },
];

/** Raccourcis proposés dans la fenêtre de choix, par type d'univers. */
export const RACCOURCIS = {
  tonalites: [{ label: 'Tout', ids: TONALITES.map((t) => t.id) }, { label: 'Dièses', ids: ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'] }, { label: 'Bémols', ids: ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'] }, { label: 'Faciles (0 à 2 altérations)', ids: ['C', 'G', 'D', 'F', 'Bb'] }, { label: 'Do seul', ids: ['C'] }],
  departs: [{ label: 'Tout', ids: DEPARTS_NOTES.map((t) => t.id) }, { label: 'Notes naturelles', ids: ['G', 'A', 'B', 'C', 'D', 'E', 'F'] }, { label: 'Do seul', ids: ['C'] }],
};

/** Ne garde que les identifiants connus de `univers` (liste d'objets { id }), sans doublon, dans l'ordre de l'univers ; renvoie null si la liste est vide ou si `ids` n'est pas une liste. */
export function filtrer(ids, univers) {
  if (!Array.isArray(ids)) return null;
  const garde = univers.filter((u) => ids.includes(u.id)).map((u) => u.id);
  return garde.length ? garde : null;
}

/** Lit les réglages d'une adresse (« tonalites=C,G,F&serie=1&mode=adapte ») : { tonalites: [ids] | null, serie: bool, mode: 'adapte' | 'erreurs' | null }. */
export function lireConfig(query, univers = TONALITES) {
  const q = new URLSearchParams(query || '');
  const t = q.get('tonalites');
  const mode = q.get('mode');
  const niveau = q.get('niveau');
  return { tonalites: t ? filtrer(t.split(','), univers) : null, serie: q.get('serie') === '1', mode: mode === 'adapte' || mode === 'erreurs' ? mode : null, niveau: niveau === '1' || niveau === '2' ? niveau : null };
}

/** Fabrique la partie « requête » d'une adresse d'exercice ; `tonalites` : ids choisis (null = ne rien préciser). Renvoie '' si rien n'est réglé. */
export function requeteConfig({ tonalites = null, serie = false, mode = null, niveau = null } = {}) {
  const q = [];
  if (tonalites && tonalites.length) q.push(`tonalites=${tonalites.map(encodeURIComponent).join(',')}`);
  if (serie) q.push('serie=1');
  if (mode === 'adapte' || mode === 'erreurs') q.push(`mode=${mode}`);
  if (niveau === '1' || niveau === '2') q.push(`niveau=${niveau}`);
  return q.join('&');
}
