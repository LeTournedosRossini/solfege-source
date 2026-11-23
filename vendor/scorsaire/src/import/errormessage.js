/*
 * The error messages of the importers are written in English (they come from the readers of the archives); what the person sees is translated here, by recognising the
 * message: `friendlyImportError(error, t)` → the translated text for a known message, else the message as it is. PURE (the translator is given).
 * The most useful ones say what to suspect: an archive that is cut or corrupt (an interrupted download), not an error of the program.
 */
const KNOWN = [
  [/^Not a ZIP archive$/, 'importError.notZip'],
  [/^Corrupt ZIP (entry|directory)$/, 'importError.corruptZip'],
  [/^Unsupported ZIP compression method (\d+)$/, 'importError.zipMethod', ['n']],
  [/^No score found in the archive$/, 'importError.noScore'],
  [/^The archive holds no Songsterr song/, 'importError.noSongsterr'],
  [/^A track of the archive holds no measures$/, 'importError.noMeasures'],
  [/^The archive holds no beat map/, 'importError.noBeats'],
  [/^The analysis file of the archive holds no beat map/, 'importError.noBeatsAnalysis'],
  [/^The file (.+) of the archive cannot be read$/, 'importError.fileUnreadable', ['name']],
  [/^The analysis file of the archive cannot be read$/, 'importError.analysisUnreadable'],
];

/** A MIDI error has a code (and numbers) of its own: `importError.midi.<code>`. */
function midiError(error, t) {
  const d = error.data ?? {};
  const mb = (n) => (n / 1048576).toFixed(1);
  const params = { size: d.bytes != null ? mb(d.bytes) : '', max: d.max != null && d.bytes != null ? mb(d.max) : d.max ?? '', notes: d.notes ?? '', measures: d.measures ?? '' };
  return t(`importError.midi.${error.code}`, params);
}

export function friendlyImportError(error, t) {
  if (error?.name === 'MidiError' && typeof error.code === 'string') { const text = midiError(error, t); if (text && !text.startsWith('importError.midi.')) return text; }
  const message = typeof error === 'string' ? error : (error?.message ?? String(error));
  for (const [re, key, names = []] of KNOWN) {
    const m = re.exec(message);
    if (m) return t(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return message;
}
