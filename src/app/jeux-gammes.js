// Données des jeux « Altérations » et « Gammes mineures » (CON-02). Pur (sans navigateur), testable sous Node.
const LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], NAT = [0, 2, 4, 5, 7, 9, 11], ACC = { '-1': 'b', 0: '', 1: '#' };

/* ---------------------------------------------------------------- altérations */
export const ALTERATIONS = ['Dièse', 'Bémol', 'Bécarre'];
/** Deux notes de même nom : la question porte sur le signe placé devant la SECONDE note (dièse, bémol, ou bécarre qui annule le signe de la première). */
export const POOL_ALTERATIONS = [
  ...['C', 'D', 'F', 'G', 'A'].flatMap((l) => [4, 5].map((o) => ({ label: 'Dièse', notes: [`${l}${o}`, `${l}#${o}`] }))),
  ...['D', 'E', 'G', 'A', 'B'].flatMap((l) => [4, 5].filter((o) => !(l === 'B' && o === 5)).map((o) => ({ label: 'Bémol', notes: [`${l}${o}`, `${l}b${o}`] }))),
  ...['C', 'D', 'F', 'G', 'A'].map((l) => ({ label: 'Bécarre', notes: [`${l}#5`, `${l}5`] })),
  ...['D', 'E', 'G', 'A', 'B'].map((l) => ({ label: 'Bécarre', notes: [`${l}b4`, `${l}4`] })),
];

/* ---------------------------------------------------------------- gammes */
export const GAMMES_LABELS = ['Majeure', 'Mineure naturelle', 'Mineure harmonique', 'Mineure mélodique'];
export const CLE_GAMME = { 'Majeure': 'maj', 'Mineure naturelle': 'min', 'Mineure harmonique': 'harmin', 'Mineure mélodique': 'melmin' };
const FORMULES = { maj: [0, 2, 4, 5, 7, 9, 11, 12], min: [0, 2, 3, 5, 7, 8, 10, 12], harmin: [0, 2, 3, 5, 7, 8, 11, 12], melmin: [0, 2, 3, 5, 7, 9, 11, 12] };
// tonique (lettre, altération) et armure (nombre de dièses > 0 / de bémols < 0) ; l'armure de la gamme mineure est celle de sa relative majeure
const MAJEURES = [['C', 0, 0], ['G', 0, 1], ['D', 0, 2], ['A', 0, 3], ['E', 0, 4], ['B', 0, 5], ['F', 0, -1], ['B', -1, -2], ['E', -1, -3]];
const MINEURES = [['A', 0, 0], ['E', 0, 1], ['B', 0, 2], ['F', 1, 3], ['D', 0, -1], ['G', 0, -2], ['C', 0, -3], ['F', 0, -4], ['C', 1, 4]];

/** Noms des 8 notes d'une gamme de formule `semis` à partir de la tonique (lettre, altération) en octave 4 ; null si une double altération serait nécessaire. */
export function notesDeGamme(lettre, alter, semis) {
  const li = LET.indexOf(lettre), m0 = 5 * 12 + NAT[li] + alter, noms = [];
  for (let i = 0; i < 8; i++) {
    const l = (li + i) % 7, o = 4 + Math.floor((li + i) / 7), a = m0 + semis[i] - ((o + 1) * 12 + NAT[l]);
    if (a < -1 || a > 1) return null;
    noms.push(`${LET[l]}${ACC[a]}${o}`);
  }
  return noms;
}

export const POOL_GAMMES = (() => {
  const p = [];
  const ajoute = (label, lettre, alter, n) => { const notes = notesDeGamme(lettre, alter, FORMULES[CLE_GAMME[label]]); if (notes) p.push({ label, notes, key: n, tonique: `${lettre}${ACC[alter]}` }); };
  for (const [l, a, n] of MAJEURES) ajoute('Majeure', l, a, n);
  for (const [l, a, n] of MINEURES) for (const t of ['Mineure naturelle', 'Mineure harmonique', 'Mineure mélodique']) ajoute(t, l, a, n);
  return p;
})();
