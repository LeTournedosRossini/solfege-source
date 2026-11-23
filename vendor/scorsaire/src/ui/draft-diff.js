/*
 * What a DRAFT (the automatic copy of a work with unsaved changes, `ui/work-draft.js`) differs from the last clean state of the same work (the text of the file when it was opened or last
 * saved, kept with the draft as `base`): `identical` true when nothing that matters changed (the editor then drops the draft without asking), else how many measures differ and whether
 * something other than measures does (a setting, a track, the mixer…). `identical` is null when there is nothing to compare with (an old draft, an unreadable text). PURE.
 */

/** The measures of a parsed file by place, and the file with its measures emptied (and without its id counter, which grows with every id ever made, undone or not). */
function split(file) {
  const measures = new Map();
  const copy = JSON.parse(JSON.stringify(file));
  delete copy.idCounter;
  (copy.work?.movements ?? []).forEach((mv, mi) => {
    for (const tr of mv.tracks ?? []) for (const st of tr.staves ?? []) (st.voices ?? []).forEach((voice, vi) => {
      (voice.measures ?? []).forEach((m, k) => { measures.set(`${mi}/${tr.id}/${st.id}/${vi}/${k}`, JSON.stringify(m)); });
      voice.measures = (voice.measures ?? []).length;
    });
  });
  return { measures, rest: JSON.stringify(copy) };
}

/** @returns { identical: boolean | null, measures: number, other: boolean } */
export function describeDraftChange(baseText, text) {
  if (typeof baseText !== 'string' || typeof text !== 'string') return { identical: null, measures: 0, other: false };
  if (baseText === text) return { identical: true, measures: 0, other: false };
  try {
    const a = split(JSON.parse(baseText)); const b = split(JSON.parse(text));
    let measures = 0;
    for (const [k, v] of b.measures) if (a.measures.get(k) !== v) measures += 1;
    for (const k of a.measures.keys()) if (!b.measures.has(k)) measures += 1;
    const other = a.rest !== b.rest;
    return { identical: measures === 0 && !other, measures, other };
  } catch {
    return { identical: null, measures: 0, other: false };
  }
}
