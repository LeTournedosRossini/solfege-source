/*
 * The lyrics of an analysed song as DATED syllables: [{ text, time (s) }], whatever file they come from (PURE: parsed JSON in).
 *   lyrics_new_format.json  lines → words → syllables, each with a start (the old multi-file archive): the best source, a word cut in syllables shows « wait- » « ing »
 *   lyrics.json             a flat list of words (`<SOL>` markers and the like are dropped)
 *   paroles                 lines → `mots` (the single-file archive): words, no syllables
 * A syllable that does not end its word keeps a trailing hyphen, as lyrics are written (the lyrics track shows the text as it is).
 */
const clean = (text) => String(text ?? '').trim();
const dated = (text, time) => ({ text: clean(text), time: time == null ? Number.NaN : Number(time) });
const usable = (s) => s.text && !/^<.*>$/.test(s.text) && Number.isFinite(s.time);

/** `lyrics_new_format.json` → dated syllables (null when the list has none). */
export function syllablesFromNewFormat(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const line of list) {
    for (const word of line?.words ?? []) {
      const parts = Array.isArray(word.syllables) && word.syllables.length ? word.syllables : [{ syllable: word.word, start: word.start }];
      parts.forEach((p, i) => out.push(dated(`${clean(p.syllable ?? word.word)}${i < parts.length - 1 ? '-' : ''}`, p.start ?? word.start)));
    }
  }
  const result = out.filter(usable);
  return result.length ? result : null;
}

/** `lyrics.json` (flat words) → dated words (null when there are none). */
export function wordsFromFlat(list) {
  if (!Array.isArray(list)) return null;
  const result = list.map((w) => dated(w?.text, w?.start)).filter(usable);
  return result.length ? result : null;
}

/** `paroles` of the single-file archive (lines of `mots`, or lines that only have a `texte` and times) → dated words. */
export function wordsFromParoles(paroles) {
  if (!Array.isArray(paroles)) return null;
  const out = [];
  for (const line of paroles) {
    const words = line?.mots ?? line?.words;
    if (Array.isArray(words) && words.length) for (const w of words) out.push(dated(w?.texte ?? w?.text ?? w?.word, w?.start));
  }
  const result = out.filter(usable);
  return result.length ? result : null;
}
