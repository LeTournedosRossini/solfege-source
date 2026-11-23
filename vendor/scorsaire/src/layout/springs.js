/*
 * Justification à ressorts d'une mesure (MuseScore `HorizontalSpacing::stretchSegmentsToWidth`) : distribue l'espace
 * supplémentaire entre les colonnes de temps selon leur RAIDEUR (`1 / étirement` de leur durée, `spacing.js`), pas
 * uniformément — une colonne de note courte (raide) absorbe moins que sa part uniforme de l'étirement, une colonne de
 * note longue (souple) absorbe plus. Résultat : des notes de même durée restent visuellement régulières même quand la
 * mesure a besoin d'être élargie pour tenir la ligne.
 *
 * Algorithme (une seule passe, pas de relaxation itérative) : les colonnes sont triées par « pré-tension » croissante
 * (largeur naturelle × raideur = la force à partir de laquelle un ressort commence à s'étirer au-delà de sa largeur
 * naturelle). On avance dans cet ordre en cumulant `1 / raideur` et largeur naturelle, recalculant à chaque étape la
 * force commune qui donnerait exactement la largeur cible avec les colonnes vues jusqu'ici — et on s'arrête dès que
 * cette force tomberait sous la pré-tension de la colonne suivante (elle et les plus raides après elle, triées après,
 * n'ont alors droit à aucun supplément). Les colonnes qui ne dépassent jamais leur pré-tension gardent leur largeur
 * naturelle ; la somme des largeurs finales vaut TOUJOURS exactement `target` (propriété de la construction).
 *
 * Cas où il n'y a rien à distribuer par ressort (compression d'un système trop plein, ou pas d'étirement du tout) :
 * un facteur uniforme, comme l'ancienne loi — les ressorts ne servent qu'à GRANDIR, jamais à réduire (comme MuseScore :
 * réduire une ligne trop pleine est un mécanisme séparé, `squeezeSystemToFit`, non porté ici).
 *
 * @param columns  colonnes d'une mesure (`columns.js`), chacune avec `.width` (largeur naturelle) et `.stretchFactor`
 * @param target   largeur totale voulue pour l'ensemble des colonnes
 * @returns Map(colonne → largeur finale), dont la somme vaut exactement `target`
 */
export function stretchColumns(columns, target) {
  const natural = columns.reduce((sum, c) => sum + c.width, 0);
  const widths = new Map();

  if (columns.length === 0) return widths;
  if (!(target > natural) || !(natural > 0)) {
    // compression, ou rien à étirer : facteur uniforme (les ressorts ne rétrécissent jamais)
    const ratio = natural > 0 ? target / natural : 1;
    for (const c of columns) widths.set(c, c.width * ratio);
    return widths;
  }

  const springs = columns
    .map((column) => {
      const springConst = 1 / Math.max(column.stretchFactor || 1e-6, 1e-6);
      const width = column.width;
      return { column, springConst, width, preTension: width * springConst };
    })
    .sort((a, b) => a.preTension - b.preTension);

  const extra = target - natural;
  let inverseSpringConst = 0;
  let widthPool = extra;
  let force = 0;
  let i = 0;
  do {
    inverseSpringConst += 1 / springs[i].springConst;
    widthPool += springs[i].width;
    force = widthPool / inverseSpringConst;
    i++;
  } while (i < springs.length && !(force < springs[i].preTension));

  for (const spring of springs) {
    widths.set(spring.column, force > spring.preTension ? force / spring.springConst : spring.width);
  }
  return widths;
}
