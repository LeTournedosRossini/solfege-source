/*
 * Préférences de l'utilisateur, exportables / importables TOUTES D'UN COUP (fichier `scorsaire-preferences`).
 * Chaque système de préférences s'inscrit dans `PREFERENCE_SECTIONS` avec son export (objet JSON) et sa validation ; le fichier global
 * est { format, version, sections: { <nom>: <valeur> } } et une section absente n'est pas touchée à l'import.
 * Sections actuelles : `sticking` (système de sticking, ./sticking.js), `percmap` (percmap personnalisée : jeu de sons de toute portée de percussion, ./percmap.js ; l'ancienne section `drummap` est lue comme `percmap`), `fingeringMap` (carte de doigtés, ./fingeringmap.js) `chordQualities` (dictionnaire de qualités d'accord, ./chordquality.js) `chordDisplay` (affichage des symboles d'accord, ./chordstyle.js) et `chordEntry` (fenêtre de saisie des accords : ♯/♭, noms latins/anglo-saxons, ./chordentry.js).
 * Ajouter un système de préférences = une entrée ici (pas de nouveau format de fichier).
 */
import { validateStickingSystem, createStickingSystem } from './sticking.js';
import { validatePercMap, createPercMap } from './percmap.js';
import { validateAccordionLayout, createAccordionLayout } from './accordion.js';
import { validateFingeringMap, createFingeringMap } from './fingeringmap.js';
import { validateChordQualities, createChordQualities } from './chordquality.js';
import { validateChordDisplay, createChordDisplay } from './chordstyle.js';
import { validateChordEntry, createChordEntry } from './chordentry.js';
import { reposSection } from '../export/githubrepos.js';
import { validateTemplateList } from './templateedit.js';
import { validateBoxStyleList } from '../audio/banner-styles.js';
import { validateStrumCardPref, createStrumCardPref } from './strumcards.js';
import { validateChordPatternPref, createChordPatternPref } from './chordpatterns.js';
import { validateGroovePref, createGroovePref } from './grooves.js';
import { validateStylePref, createStylePref } from './styles.js';
import { validateDiagramLibrary, createDiagramLibrary } from './diagramlibrary.js';

export const PREFERENCES_FORMAT = 'scorsaire-preferences';
export const PREFERENCES_VERSION = 1;

export const PREFERENCE_SECTIONS = {
  sticking: { validate: validateStickingSystem, create: (v) => createStickingSystem(v) },
  percmap: { validate: validatePercMap, create: (v) => createPercMap(v) },
  accordion: { validate: validateAccordionLayout, create: (v) => createAccordionLayout(v) },
  fingeringMap: { validate: validateFingeringMap, create: (v) => createFingeringMap(v) },
  chordQualities: { validate: validateChordQualities, create: (v) => createChordQualities(v) },
  chordDisplay: { validate: validateChordDisplay, create: (v) => createChordDisplay(v) },
  chordEntry: { validate: validateChordEntry, create: (v) => createChordEntry(v) },
  // the user's personal repertoire of chord fingerings, per chord (model/diagramlibrary.js)
  // the user's own strum cards, shared by every project (model/strumcards.js)
  strumCards: { validate: validateStrumCardPref, create: (v) => createStrumCardPref(v) },
  // height factor of the automation strips on screen: { scale: 0.5 … 8 }
  automationScale: {
    validate: (v) => (v && typeof v === 'object' && v.scale >= 0.5 && v.scale <= 8 ? [] : ['automationScale: { scale: 0.5 … 8 } expected']),
    create: (v) => ({ scale: v.scale }),
  },
  // the user's own chord patterns (piano accompaniment of a chord staff, written in chord degrees), shared by every project (model/chordpatterns.js)
  chordPatterns: { validate: validateChordPatternPref, create: (v) => createChordPatternPref(v) },
  grooves: { validate: validateGroovePref, create: (v) => createGroovePref(v) },
  styles: { validate: validateStylePref, create: (v) => createStylePref(v) },
  diagramLibrary: { validate: validateDiagramLibrary, create: (v) => createDiagramLibrary(v) },
  // audio engine choice and the SoundFonts the user added (metadata only: the bytes live in the browser cache, see audio/fonts.js)
  audio: {
    validate: (v) => {
      if (!v || typeof v !== 'object') return ['audio: object expected'];
      if (v.engine !== 'light' && v.engine !== 'soundfont') return ['audio: engine must be light or soundfont'];
      if (v.fontId != null && typeof v.fontId !== 'string') return ['audio: fontId must be a string'];
      if (!Array.isArray(v.fonts ?? [])) return ['audio: fonts must be a list'];
      if (v.outputDb != null && !(v.outputDb >= -24 && v.outputDb <= 12)) return ['audio: outputDb must be between -24 and 12'];
      for (const f of v.fonts ?? []) if (!f || typeof f.id !== 'string' || typeof f.name !== 'string' || (f.url != null && typeof f.url !== 'string')) return ['audio: malformed font entry'];
      return [];
    },
    create: (v) => ({ engine: v.engine, fontId: v.fontId ?? null, outputDb: v.outputDb ?? 2, fonts: (v.fonts ?? []).map((f) => ({ id: f.id, name: f.name, url: f.url ?? null, size: Number(f.size) || 0 })) }),
  },
  // options of the note entry: { tabKeyboard: bool, tabKeyStyle?: 'musescore' | 'guitarpro' } — fret keys / string keys on a tablature staff, off by default; the style is the set of keys (MuseScore's, or Guitar Pro's), MuseScore's when missing
  inputOptions: {
    validate: (v) => (v && typeof v === 'object' && typeof v.tabKeyboard === 'boolean' && (v.tabKeyStyle === undefined || ['musescore', 'guitarpro'].includes(v.tabKeyStyle)) ? [] : ["inputOptions: { tabKeyboard: boolean, tabKeyStyle?: 'musescore' | 'guitarpro' } expected"]),
    create: (v) => ({ tabKeyboard: v.tabKeyboard, ...(v.tabKeyStyle ? { tabKeyStyle: v.tabKeyStyle } : {}) }),
  },
  // « Publish on GitHub » (page with a YouTube video): the repository and the folder of the person, kept so they are typed once: { repo: 'owner/name', folder?: 'a/b' }
  githubPublish: {
    validate: (v) => (v && typeof v === 'object' && typeof v.repo === 'string' && v.repo.length <= 200 && (v.folder === undefined || (typeof v.folder === 'string' && v.folder.length <= 200)) ? [] : ['githubPublish: { repo: string, folder?: string } expected']),
    create: (v) => ({ repo: v.repo, folder: v.folder ?? '' }),
  },
  // the GitHub repositories of the person (« Publish on GitHub », « Send to another teacher »), most recent first: { repos: [{ repo: 'owner/name', folder, name? }] }
  githubRepos: reposSection,
  // options of the exports: { linkedStaves: 'twoStaves' | 'separateParts' | 'notationOnly' } — what a linked tablature becomes in a MusicXML file
  exportOptions: {
    validate: (v) => (v && typeof v === 'object' && ['twoStaves', 'separateParts', 'notationOnly'].includes(v.linkedStaves) ? [] : ["exportOptions: { linkedStaves: 'twoStaves' | 'separateParts' | 'notationOnly' } expected"]),
    create: (v) => ({ linkedStaves: v.linkedStaves }),
  },
  // hearing the notes: { notes?: bool (when placed or retouched), select?: bool (when selected by a tap) } — each on by default (a missing key means on)
  audition: {
    validate: (v) => (v && typeof v === 'object' && ['notes', 'select'].every((k) => v[k] === undefined || typeof v[k] === 'boolean') && (v.notes !== undefined || v.select !== undefined) ? [] : ['audition: { notes?: boolean, select?: boolean } expected']),
    create: (v) => ({ ...(v.notes !== undefined ? { notes: v.notes } : {}), ...(v.select !== undefined ? { select: v.select } : {}) }),
  },
  // playback: { chordSymbols?: bool } — do chord symbols sound? (a missing key means yes; a local PID.PLAY on a symbol always wins)
  playback: {
    validate: (v) => (v && typeof v === 'object' && typeof v.chordSymbols === 'boolean' ? [] : ['playback: { chordSymbols: boolean } expected']),
    create: (v) => ({ chordSymbols: v.chordSymbols }),
  },
  // the tracks panel: { openMode: 'closeAll' | 'remember' } — closed tracks each time the panel opens, or keep what the user opened
  tracksPanel: {
    validate: (v) => (v && typeof v === 'object' && ['closeAll', 'remember'].includes(v.openMode) ? [] : ["tracksPanel: { openMode: 'closeAll' | 'remember' } expected"]),
    create: (v) => ({ openMode: v.openMode }),
  },
  // the settings panel: { open: [section ids] } — which sections are unfolded (all folded by default)
  settingsFold: {
    validate: (v) => (v && typeof v === 'object' && Array.isArray(v.open) && v.open.every((x) => typeof x === 'string') ? [] : ['settingsFold: { open: string[] } expected']),
    create: (v) => ({ open: v.open.slice(0, 60) }),
  },
  // instrument icons: { sopranoPhoto: bool } — the soprano saxophone shows a photograph (a joke) unless switched off; off = the clarinet icon
  instrumentIcons: {
    validate: (v) => (v && typeof v === 'object' && typeof v.sopranoPhoto === 'boolean' ? [] : ['instrumentIcons: { sopranoPhoto: boolean } expected']),
    create: (v) => ({ sopranoPhoto: v.sopranoPhoto }),
  },
  // how a selected note looks: { mode: 'colored' | 'halo' | 'classic' } — colored (default) = the note itself turns blue, halo = soft halo plus a light box, classic = the plain blue box
  selectionStyle: {
    validate: (v) => (v && typeof v === 'object' && ['colored', 'halo', 'classic'].includes(v.mode) ? [] : ["selectionStyle: { mode: 'colored' | 'halo' | 'classic' } expected"]),
    create: (v) => ({ mode: v.mode }),
  },
  // the named looks of the cards and annotations of the banner (audio/banner-styles.js): { items: [{ id, name, color?, ink?, … }] } — the producer's own, whatever the file
  boxStyles: { validate: validateBoxStyleList, create: (v) => structuredClone(v) },
  // user templates (model/templates.js): { items: [template] }
  templates: { validate: validateTemplateList, create: (v) => structuredClone(v) },
};

/** Anciens noms de sections, toujours LUS à l'import (jamais écrits) : l'ancienne `drummap` a la structure de la `percmap` (unification du 05/10/2026). */
const LEGACY_SECTIONS = { drummap: 'percmap' };

/** @param prefs { sticking?, percmap?, fingeringMap? } : seules les sections présentes sont écrites */
export function exportPreferences(prefs = {}) {
  const sections = {};
  for (const [name, value] of Object.entries(prefs)) {
    const sec = PREFERENCE_SECTIONS[name];
    if (!sec) throw new Error(`Préférences : section inconnue « ${name} »`);
    if (value === undefined) continue;
    const errors = sec.validate(value);
    if (errors.length) throw new Error(`Préférences invalides (${name}) : ${errors[0]}`);
    sections[name] = value;
  }
  return JSON.stringify({ format: PREFERENCES_FORMAT, version: PREFERENCES_VERSION, sections }, null, 2);
}

/** Lit un fichier de préférences ; refuse tout ce qui est invalide (jamais de réparation silencieuse). Retourne { <section>: valeur }. */
export function importPreferences(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error('Fichier de préférences illisible (JSON invalide)'); }
  }
  if (!data || data.format !== PREFERENCES_FORMAT) throw new Error('Ce fichier n\'est pas un fichier de préférences Scorsaire');
  if (data.version > PREFERENCES_VERSION) throw new Error(`Préférences de version ${data.version}, plus récente que celle supportée (${PREFERENCES_VERSION})`);
  const out = {};
  // une section sous son ancien nom est lue sous le nouveau (si les deux sont présentes, la nouvelle l'emporte)
  const entries = Object.entries(data.sections ?? {}).map(([n, v]) => [LEGACY_SECTIONS[n] ?? n, v, n in LEGACY_SECTIONS]);
  entries.sort((a, b) => Number(b[2]) - Number(a[2])); // les anciens noms d'abord : une section au nom actuel les écrase
  for (const [name, value] of entries) {
    const sec = PREFERENCE_SECTIONS[name];
    if (!sec) throw new Error(`Préférences : section inconnue « ${name} »`);
    const errors = sec.validate(value);
    if (errors.length) throw new Error(`Préférences invalides (${name}) : ${errors[0]}`);
    out[name] = sec.create(value);
  }
  return out;
}
