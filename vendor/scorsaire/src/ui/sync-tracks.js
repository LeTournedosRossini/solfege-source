// Which staves to create for the stems of an analysed song (screen 4): a default kind per stem name, and what each kind creates. PURE.
// The kinds reuse the quick picks of the instrument picker (`POP_QUICK`): a guitar or a bass is a tablature with a notation staff LINKED above it.

export const STEM_KINDS = Object.freeze({
  none: null,
  voice: { id: 'voice' },
  guitar: { id: 'electric-guitar-tablature', options: { linkedNotation: { clef: 'G' } } },
  guitarAcoustic: { id: 'guitar-steel-tablature', options: { linkedNotation: { clef: 'G' } } },
  bass: { id: 'electric-bass-4-str-tab', options: { linkedNotation: { clef: 'F' } } },
  drums: { id: 'drumset', options: { scorsaireKit: true } },
  piano: { id: 'piano' },
});

/** Default kind of a stem from its file name (vocals → voice, acoustic → acoustic guitar, electric / guitar / lead / rhythm → guitar, bass, drums, other / piano / keys → piano). */
export function defaultKind(name) {
  const n = String(name ?? '').toLowerCase();
  if (/vocal|voice|vox|chant|voix/.test(n)) return 'voice';
  if (/acoustic|acoust/.test(n)) return 'guitarAcoustic';
  if (/guitar|electric|elec|lead|rhythm|rythm/.test(n)) return 'guitar'; // the stems of a six-stem separation: « lead » and « rhythm » are the two guitars
  if (/bass|basse/.test(n)) return 'bass';
  if (/drum|perc|batter/.test(n)) return 'drums';
  if (/piano|key|other|autre|synth/.test(n)) return 'piano';
  return 'none';
}

const NAMES = {
  fr: { voice: 'Voix', guitar: 'Guitare électrique', guitarAcoustic: 'Guitare acoustique', bass: 'Basse', drums: 'Batterie', piano: 'Piano' },
  en: { voice: 'Vocals', guitar: 'Electric guitar', guitarAcoustic: 'Acoustic guitar', bass: 'Bass', drums: 'Drums', piano: 'Piano' },
};
/** Name of the track made for a stem: the stem tells what it holds (« Guitare acoustique »), whatever the file is called. */
export const trackNameFor = (kind, lang = 'fr') => (NAMES[lang] ?? NAMES.en)[kind] ?? '';

/** Plan of the dialog result: [{ stem, kind }] (kinds other than `none`) → the calls to make: [{ id, options, name }]. */
export function tracksToCreate(choices, lang = 'fr') {
  return choices.filter((c) => STEM_KINDS[c.kind]).map((c) => ({ ...STEM_KINDS[c.kind], options: { ...(STEM_KINDS[c.kind].options ?? {}) }, name: trackNameFor(c.kind, lang), stem: c.stem }));
}
