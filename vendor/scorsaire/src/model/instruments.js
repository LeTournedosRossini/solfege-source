/*
 * Catalogue d'instruments — port de la classification MuseScore (`share/instruments/instruments.xml`, dépôt cloné),
 * pas une liste inventée (demande de Jean, 27/09/2026 : « je te proposerai plutôt de regarder la classification
 * des instruments qu'utilise musescore qui est très bonne »). Généré par `tools/extract-instruments.py` en
 * `src/model/instrument-catalog.json` — jamais édité à la main, jamais committé sous sa forme XML brute (règle du
 * projet : pas de source MuseScore GPLv3 dans le dépôt, voir CLAUDE.md). 644 instruments, 12 groupes
 * (`InstrumentGroup`, ex. `vocals`, `strings`, `plucked-strings`), 120 familles fines (`Family`, ex. `voices`,
 * `clarinets`, `classical-guitars`) — la famille est l'unité de classification MuseScore la plus fine (« qui se
 * ressemble se groupe »), le groupe une catégorie large pour l'UI (menu « ajouter un instrument »).
 *
 * **Question de licence NON TRANCHÉE, comme pour le reste du dépôt MuseScore (voir CLAUDE.md, dépôt privé) :**
 * `instrument-catalog.json` est un sous-ensemble FACTUEL réduit d'`instruments.xml` (identifiants, classification,
 * noms d'instrument, clé par défaut, transposition, genres) — pas le fichier XML lui-même, pas les champs de mise
 * en œuvre MuseScore (patchs MIDI, jeux de percussion, réglages d'expression, descriptions en prose longue, tous
 * exclus par le script d'extraction). Peut nécessiter d'être revu selon ce qui sera décidé pour la licence globale
 * du dépôt.
 *
 * `isVocalInstrument(track)` : port DIRECT de `Instrument::isVocalInstrument()` (MuseScore, `instrument.cpp`) —
 * `family === 'voices' || family === 'voice-groups'` — condition consommée par `Sid::dynamicsHairpinsAboveForVocalStaves`
 * (`engravingitem.cpp`, `EngravingItem::setPlacementBasedOnVoiceAssignment`), utilisée par les nuances et les
 * soufflets (`src/layout/dynamics.js`/`hairpins.js`, via `staffAbove` dans `painters/score.js`).
 *
 * Autres champs du catalogue exposés ici (`instrumentInfo`) mais PAS ENCORE consommés ailleurs dans le moteur
 * (aucun affichage de nom d'instrument, aucune clé par défaut à la création d'une piste construits à ce jour) :
 * gardés tels quels dans le JSON généré, prêts pour quand ces fonctionnalités du roadmap seront construites — pas
 * de donnée morte ajoutée ICI (le fichier généré, lui, garde tout le catalogue : le réduire au sous-ensemble
 * consommé aujourd'hui obligerait à régénérer à chaque nouvel usage, pour un fichier qui reste petit, ~160 Ko).
 *
 * Limites assumées et DOCUMENTÉES :
 * - Noms d'affichage (`trackName`/`longName`/`shortName`) : `null` quand absents de la source, JAMAIS devinés — une
 *   poignée d'instruments (ex. `clarinet`, le clarinette en si♭ « de base ») les omettent dans le XML MuseScore,
 *   qui a probablement une logique de repli (nom dérivé d'ailleurs) non identifiée avec certitude et donc non
 *   portée ici plutôt que supposée.
 * - `<init>` (quelques variantes de cordes pincées qui héritent d'un autre id dans MuseScore) : préservé tel quel
 *   dans `initFrom`, JAMAIS résolu/fusionné — un id avec `initFrom` peut donc avoir des champs incomplets par
 *   rapport à ce que MuseScore afficherait réellement (hérités de l'instrument référencé).
 * - Descriptions en prose (`<description>`) volontairement EXCLUES de l'extraction (contenu rédactionnel, pas une
 *   donnée factuelle comme un id ou une classification — prudence de licence, voir plus haut).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import catalog from './instrument-catalog.json' with { type: 'json' };
import translations from './instrument-names.json' with { type: 'json' };

const VOCAL_FAMILIES = new Set(['voices', 'voice-groups']);

/** Fiche complète d'un id de catalogue (voir `instrument-catalog.json`), ou `null` si l'id est inconnu/absent. */
export function instrumentInfo(instrumentId) {
  if (!instrumentId) return null;
  return catalog.instruments[instrumentId] ?? null;
}

/** `track.props[PID.INSTRUMENT_ID]` désigne-t-il un instrument de famille MuseScore `voices`/`voice-groups` ?
 * `false` si absent/inconnu (catalogue pas encore renseigné pour cet id) — jamais deviné à partir du nom de la
 * piste ou d'autre chose. Port direct de `Instrument::isVocalInstrument()` (voir en-tête). */
export function isVocalInstrument(track) {
  const info = instrumentInfo(getProperty(track, PID.INSTRUMENT_ID));
  return Boolean(info) && VOCAL_FAMILIES.has(info.family);
}

/** Intervalle nul. */
const NO_TRANSPOSITION = Object.freeze({ diatonic: 0, chromatic: 0 });

/**
 * Transposition d'instrument d'une piste (`Instrument::transpose()`), écrit → sonnant : la propriété `PID.TRANSPOSITION` de la piste si elle est
 * posée, sinon celle du catalogue MuseScore pour son `PID.INSTRUMENT_ID`, sinon aucune. Voir `transpose.js` pour la convention de signe.
 */
export function trackTransposition(track) {
  const own = getProperty(track, PID.TRANSPOSITION);
  if (own) return own;
  const info = instrumentInfo(getProperty(track, PID.INSTRUMENT_ID));
  return info?.transpose ?? NO_TRANSPOSITION;
}

/** Repli de MuseScore quand l'instrument n'indique pas de nombre de cases (`StringData::frets()`, stringdata.cpp). */
export const DEFAULT_MAX_FRET = 24;

/** Nombre de cases (frette maximale) de l'instrument d'une piste, d'après le catalogue MuseScore (`<StringData><frets>`) ; 24 sans information. */
export function maxFretOf(track) {
  const n = instrumentInfo(getProperty(track, PID.INSTRUMENT_ID))?.frets;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_FRET;
}

const KIND_KEY = { trackName: 't', longName: 'l', shortName: 's' };
const tr = (lang) => translations[lang] ?? null;

/**
 * Display name of a catalogue instrument in `lang` ('fr'; any other language = the English catalogue name). `kind`: trackName | longName | shortName.
 * Translations come from MuseScore's own translation files (`tools/extract-instrument-names.py`); a missing one falls back to the English name.
 */
export function instrumentDisplayName(instrumentId, lang = 'en', kind = 'trackName') {
  const info = instrumentInfo(instrumentId);
  if (!info) return null;
  const own = tr(lang)?.instruments[instrumentId]?.[KIND_KEY[kind]];
  if (own) return own;
  return info[kind] ?? (kind === 'trackName' ? info.longName : null) ?? null;
}

/** Group name ('woodwinds' → "Woodwinds" / « Bois »). */
export function groupDisplayName(groupId, lang = 'en') {
  const en = catalog.groups[groupId] ?? groupId;
  return tr(lang)?.groups[en] ?? en;
}
/** Family name ('flutes' → "Flutes" / « Flûtes »). */
export function familyDisplayName(familyId, lang = 'en') {
  const en = catalog.families[familyId] ?? familyId;
  return tr(lang)?.families[en] ?? en;
}
/** Translated name of a score order from its English name (`orders.xml`); English when untranslated. */
export function translatedOrderName(englishName, lang = 'en') {
  return tr(lang)?.orders[englishName] ?? englishName;
}

/** Catalogue groups ({ id, name }) for the "add an instrument" menu, named in `lang` and sorted by that name. */
export function instrumentGroups(lang = 'en') {
  return Object.keys(catalog.groups).map((id) => ({ id, name: groupDisplayName(id, lang) })).sort((a, b) => a.name.localeCompare(b.name, lang));
}

/** Genre ids of the catalogue ('common' first: the list MuseScore shows by default), with their display names in `lang`. */
export function instrumentGenres(lang = 'en') {
  const names = tr(lang)?.genres ?? {};
  const ids = Object.keys(catalog.genres);
  return [...ids.filter((g) => g === 'common'), ...ids.filter((g) => g !== 'common').sort()].map((id) => ({ id, name: names[catalog.genres[id]] ?? catalog.genres[id] }));
}

const fold = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Catalogue search for the "add a track" picker: every word of `query` must appear in the instrument name (in `lang` OR in English), its
 * family or its id (accents and case ignored); `group` limits to one catalogue group. Sorted by displayed name.
 * Entries: { id, name, shortName, group, family, staves }.
 */
export function searchInstruments({ query = '', group = '', genre = '', lang = 'en' } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const out = [];
  for (const [id, info] of Object.entries(catalog.instruments)) {
    if (group && info.group !== group) continue;
    if (genre && !(info.genres ?? []).includes(genre)) continue;
    const name = instrumentDisplayName(id, lang, 'trackName') ?? id;
    const hay = fold(`${name} ${instrumentDisplayName(id, lang, 'longName') ?? ''} ${info.trackName ?? ''} ${info.longName ?? ''} ${familyDisplayName(info.family, lang)} ${catalog.families[info.family] ?? ''} ${id}`);
    if (words.every((w) => hay.includes(w))) out.push({ id, name, shortName: instrumentDisplayName(id, lang, 'shortName') ?? '', group: info.group, family: info.family, staves: info.staves, seq: info.seq ?? 0 });
  }
  // no words typed: the order of MuseScore's instruments.xml (groups, then families of an orchestra); with words: alphabetical
  if (!words.length) return out.sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
  return out.sort((a, b) => a.name.localeCompare(b.name, lang) || a.id.localeCompare(b.id));
}

/** Number of catalogue instruments (`InstrumentIndex::templateCount`, factor of the sorting index of a score order). */
export const INSTRUMENT_COUNT = Object.keys(catalog.instruments).length;
