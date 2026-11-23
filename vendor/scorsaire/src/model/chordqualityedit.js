/*
 * Dictionnaire de qualités d'accord DU DOCUMENT (étape 5, tranche 5) — lecture et écriture sur le Document. Les opérations sur le dictionnaire lui-même sont
 * pures (`chordquality.js`) ; ici : quelle valeur est en vigueur, combien de symboles d'accord utilisent une qualité, et les écritures (À APPELER DANS UNE
 * TRANSACTION : `doc.set` / `doc.reset` seulement).
 *
 * Le dictionnaire est une propriété FACULTATIVE de l'œuvre (`PID.CHORD_QUALITIES`) : absente, ce sont les 28 qualités intégrées. On ne stocke jamais un
 * dictionnaire égal à l'intégré (le fichier reste identique à celui d'avant la tranche, et reproductible).
 * La qualité d'un symbole (`PID.CHORD_QUALITY`) est un TEXTE (identifiant ou alias) ; l'absence de propriété vaut '' (accord majeur).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { walk } from './store.js';
import { DEFAULT_CHORD_QUALITY_DICTIONARY, createChordQualities, isDefaultChordQualities, chordQualityNames } from './chordquality.js';

/** Dictionnaire en vigueur pour l'œuvre : sa propriété, sinon les qualités intégrées. */
export function workChordQualities(work) {
  return getProperty(work, PID.CHORD_QUALITIES) ?? DEFAULT_CHORD_QUALITY_DICTIONARY;
}

/** Tous les symboles d'accord de l'œuvre. */
export function chordSymbolsOf(work) {
  const out = [];
  walk(work, (el) => { if (el.type === 'chordsymbol') out.push(el); });
  return out;
}

const qualityText = (symbol) => getProperty(symbol, PID.CHORD_QUALITY) ?? '';

/** Nombre de symboles d'accord par texte de qualité (Map ; '' = qualité absente). */
export function chordQualityTextCounts(work) {
  const counts = new Map();
  for (const symbol of chordSymbolsOf(work)) counts.set(qualityText(symbol), (counts.get(qualityText(symbol)) ?? 0) + 1);
  return counts;
}

/** Nombre de symboles qui utilisent la qualité, sous son identifiant OU l'un de ses alias. */
export function chordQualityUsage(work, quality, counts = chordQualityTextCounts(work)) {
  return chordQualityNames(quality).reduce((n, name) => n + (counts.get(name) ?? 0), 0);
}

/** Nombre de symboles dont le texte de qualité est exactement `text`. */
export function chordSymbolsWithQuality(work, text) {
  return chordQualityTextCounts(work).get(text) ?? 0;
}

/** Symboles dont la qualité n'est plus reconnue par `dictionary` (identifiant ni alias) : [{ text, count }]. */
export function unknownChordQualities(work, dictionary) {
  const known = new Set(dictionary.qualities.flatMap(chordQualityNames));
  return [...chordQualityTextCounts(work)].filter(([text]) => !known.has(text)).map(([text, count]) => ({ text, count }));
}

// ---------- écritures (dans une transaction) ----------

/** Range le dictionnaire dans l'œuvre ; égal à l'intégré → la propriété est retirée. Renvoie vrai si quelque chose a changé. */
export function storeChordQualities(doc, dictionary) {
  const work = doc.work;
  if (isDefaultChordQualities(dictionary)) return doc.reset(work, PID.CHORD_QUALITIES);
  return doc.set(work, PID.CHORD_QUALITIES, createChordQualities(dictionary));
}

/** Change le texte de qualité de tous les symboles dont la qualité est dans `fromTexts` (même résultat qu'un `createChordSymbol`). Renvoie le nombre de symboles changés. */
export function migrateChordSymbolQualities(doc, fromTexts, toText) {
  const from = new Set(fromTexts);
  let changed = 0;
  for (const symbol of chordSymbolsOf(doc.work)) {
    if (!from.has(qualityText(symbol)) || qualityText(symbol) === toText) continue;
    if (toText === '') doc.reset(symbol, PID.CHORD_QUALITY); else doc.set(symbol, PID.CHORD_QUALITY, toText);
    changed++;
  }
  return changed;
}
