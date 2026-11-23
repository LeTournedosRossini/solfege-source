// Évaluation du jeu de rythme : on compare la FORME de ce que le joueur a tapé à celle du motif, sans horloge de référence.
// Le joueur peut démarrer quand il veut et jouer plus vite ou plus lentement que le motif ; la latence de l'appareil, constante, ne change pas les écarts entre frappes.
//   expected : instants des notes du motif (secondes, à partir de la première) ; taps : instants des frappes du joueur (même unité, quelconque origine) ; beat : durée d'un temps du motif.
// Résultat : { complete, tempo, intervals: [{ ratio, error, grade }], regularity, pct }
//   - on met les frappes à l'échelle du motif : facteur k = (dernière − première frappe) / (dernière − première note du motif) ;
//   - pour chaque intervalle entre deux notes, écart = |intervalle joué / k − intervalle du motif|, en temps du motif :
//     bon < 0,12 temps, moyen < 0,25 temps, sinon raté ; un intervalle absent (frappes manquantes) est raté ;
//   - tempo = durée du motif joué / durée du motif écouté (information, non pénalisée) ;
//   - régularité = dispersion (écart-type relatif) des rapports intervalle joué / intervalle du motif.
export const GOOD = 0.12, MID = 0.25;
export function evaluateRhythm(expected, taps, beat) {
  const n = expected.length;
  const intervalsExp = expected.slice(1).map((t, i) => t - expected[i]);
  const m = Math.min(taps.length, n);
  const out = { complete: taps.length >= n, tempo: null, intervals: [], regularity: null, pct: 0 };
  if (m >= 2) {
    const spanExp = expected[m - 1] - expected[0], spanTap = taps[m - 1] - taps[0];
    const k = spanTap / spanExp;
    if (m === n) out.tempo = 1 / k; // vitesse relative du joueur : > 1 = plus rapide que le motif
    const ratios = [];
    for (let i = 0; i < m - 1; i++) {
      const played = taps[i + 1] - taps[i], target = intervalsExp[i];
      const err = Math.abs(played / k - target) / beat;
      ratios.push(played / k / target);
      out.intervals.push({ ratio: played / k / target, error: err, grade: err < GOOD ? 'good' : err < MID ? 'mid' : 'bad' });
    }
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    out.regularity = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length) / mean;
  }
  while (out.intervals.length < n - 1) out.intervals.push({ ratio: null, error: null, grade: 'bad' }); // intervalles non joués
  const good = out.intervals.filter((i) => i.grade === 'good').length, mid = out.intervals.filter((i) => i.grade === 'mid').length;
  out.pct = n < 2 ? 0 : Math.round(((good + mid * 0.5) / (n - 1)) * 100);
  return out;
}
