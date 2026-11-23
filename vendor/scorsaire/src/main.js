/*
 * Point d'entrée : assemble modèle → mise en page → rendu dans la page.
 * Seul module (avec ui/) autorisé à toucher au DOM.
 *
 * Page de démonstration de la tranche 1 du moteur : un mouvement multi-portées (piano en grand staff, guitare score +
 * tablature, accordéon) dont on peut faire varier la largeur du canevas et la taille de la portée, pour vérifier à
 * l'œil le retour à la ligne, la justification et l'alignement des barres de mesure entre toutes les portées.
 */
import { normalizeReader, readerToFile } from './reader/options.js';
import { createScrubPill } from './ui/scrub-pill.js';
import { confirmDialog } from './ui/confirm-dialog.js';
import glyphs from './glyphs/bravura-subset.json';
import { sampleArchitectureWork, sampleTablatureWork, sampleTablatureMarksWork, sampleTablatureTechniquesWork, sampleScoreTechniquesWork, sampleCapoWork, sampleVerificationWork, samplePercussionWork, samplePercussionLinesWork, samplePercussionPresetsWork, samplePercussionRestsWork, samplePercussionStickingWork, sampleFingeringWork, sampleFingeringAdvancedWork, sampleAccordionWork, sampleJumpsWork, sampleBreathsWork, sampleTrillsWork, sampleTempoWork, samplePedalWork, sampleDynamicsWork, sampleTransposeWork, sampleCClefsWork, sampleDoClefsWork, sampleDoTransposeWork, sampleChordSymbolsWork, sampleCrossStaffWork, sampleRhythmWork, sampleLyricsWork, sampleNoteEntryWork, sampleStaffTextWork, sampleContainersWork, sampleStressWork, sampleLinkedWork, SID, resolveStyle, DEFAULT_PERCMAP, sampleChordPatternsWork } from './model/index.js';
import { layoutMovement, layoutDrumLegend, layoutAccordionLegend } from './layout/index.js';
import { renderSvgString } from './render/svg.js';
import { createI18n, CATALOGS, DEFAULT_LANG } from './i18n/index.js';
import { LANG_CHOICES, readLangChoice, saveLangChoice, resolveLanguage } from './i18n/lang.js';
import { FILE_VERSION } from './model/index.js';
import { foreignDrumStaves, convertDrumsToScorsaire } from './model/percvoices.js';
import { createDocument, sheetCells, setUserStyleLayer, chordDisplayLayer, createRecueil, addEntry, parseRecueil, serializeRecueil, replaceEntryWork, isRecueilText, renameRecueil, entryTitle } from './model/index.js';
import { mountChordPlacementEditor, exportFile as exportPlacementFile, importFile as importPlacementFile } from './ui/chordplacement-editor.js';
import { createScoreView } from './view/score-view.js';
import { createApplication } from './ui/application.js';
import { mountScoreView } from './ui/dom.js';
import { mountPercMapEditor } from './ui/percmap-editor.js';
import { mountStaffProperties } from './ui/staffprops-dom.js';
import { createChoiceMenu } from './ui/choice-menu.js';
import { mountTracksPanel } from './ui/tracks-dom.js';
import { openLyricEvents } from './ui/lyric-events-dom.js';
import { mountHeaderTabs } from './ui/header-tabs.js';
import { mountSidebarWorkPanels, createWorkPanels } from './ui/work-panels.js';
import { mountSidebar } from './ui/sidebar-dom.js';
import { mountSettingsPanel } from './ui/settings-dom.js';
import { mountBendGraph } from './ui/bendgraph-dom.js';
import { mountPanelResize } from './ui/panel-resize.js';
import { installZoomLock } from './ui/zoom-lock.js';
import { installIconify } from './ui/icons.js';
import { mountChordEntry } from './ui/chordentry-modal.js';
import { mountChordQualityEditor } from './ui/chordquality-editor.js';
import { createPlayer } from './ui/player.js';
import { mountPlayer } from './ui/player-dom.js';
import { mountMiniTransport } from './ui/mini-transport.js';
import { mountSpaceKey } from './ui/space-key.js';
import { perf, enableFromAddress } from './perf/probe.js';
import { mountPerfPanel } from './perf/panel.js';
import { SHEET_QUERY } from './ui/panel-mode.js';
import { mountDock } from './ui/dock-dom.js';
import { mountFileDrawer } from './ui/file-drawer.js';
import { mountViewsDrawer } from './ui/views-drawer.js';
import { mountPianoDrawer } from './ui/piano-drawer.js';
import { drawnById } from './ui/mark-icons.js';
import { mountRecordWindow } from './ui/record-dom.js';
import { mountMeasurePill } from './ui/measure-pill.js';
import { openImportIntoDialog } from './ui/import-into-dialog.js';
import { importableStaves, importPayload, chordPayloadOf, timeSignatureDifference } from './import/into-staff.js';
import { flatStaves } from './model/range.js';
import { isLinkedStaff } from './model/linkedstaff.js';
import { createMidiInput } from './ui/midi-input.js';
import { mountMixerPanel } from './ui/mixer-dom.js';
import { mountViewsBar } from './ui/views-dom.js';
import { mountNoteEntryBar } from './ui/noteentry-dom.js';
import { mountFragmentEditor } from './ui/fragment-editor.js';
import { mountDiagramEditor } from './ui/diagram-editor.js';
import { mountPartsScreen } from './ui/parts-dom.js';
import { mountSheetsScreen } from './ui/sheets-dom.js';
import { mountGridMode } from './ui/grid-dom.js';
import { buildSequence } from './audio/sequence.js';
import { playOrder } from './model/repeatlist.js';
import { NullAudioEngine } from './audio/engine.js';
import { createWebAudioEngine, webAudioAvailable, createLatencyContext } from './audio/webaudio.js';
import { SoundFontEngine } from './audio/soundfont-engine.js';
import { createEngineManager } from './audio/engine-manager.js';
import { createIndexedDbFontStore, createLazyFontStore } from './audio/fonts.js';
import { mountAudioSection } from './ui/audio-dom.js';
import { installSlotResize } from './ui/slot-resize.js';
import { mountStrumCardsSection, openStrumCardsDialog } from './ui/strumcards-dom.js';
import { openChordPatternEditor } from './ui/chordpattern-editor.js';
import { openGrooveEditor } from './ui/groove-editor.js';
import { openStylesDialog } from './ui/styles-dialog.js';
import { openCuesDialog } from './ui/cues-dialog.js';
import { openGridsDialog } from './ui/grids-dialog.js';
import { openRealizeDialog } from './ui/realize-dialog.js';
import { patternAuditionSequence, grooveAuditionSequence, styleAuditionSequence } from './audio/patternaudition.js';
import { openBakeDialog } from './ui/bake-dialog.js';
import { openLyricsAdjust } from './ui/lyrics-adjust-dom.js';
import { openLyricsSheet } from './ui/lyrics-sheet-dom.js';
import { mountSyncIdle } from './ui/sync-idle.js';
import { openSyncTap } from './ui/sync-tap.js';
import { tapPlan, openTapPlan } from './audio/synctap.js';
import { buildAuditionSequence, buildTabPreviewSequence, createAuditioner } from './audio/audition.js';
import { inputOptionsOf, hasFinePointer } from './ui/input-options.js';
import { buildContainerSequence } from './audio/containerplay.js';
import { createContainerPlayback } from './ui/container-playback.js';
import { buildCellSequence } from './audio/sheetplay.js';
import { synchroPageHtml, embeddedSynchroTemplate } from './export/synchropage.js';
import { youtubePageHtml, embeddedYoutubeTemplate } from './export/youtubepage.js';
import { openGithubPublish } from './ui/github-publish-dialog.js';
import { openShareDialog } from './ui/share-dialog.js';
import { linksPageUrl } from './links/links.js';
import { chooseExportTracks } from './ui/export-tracks-dialog.js';
import { trackChoices, workTextWithTracks } from './export/trackvisibility.js';
import { readerPageHtml, readerOnlyHtml, embeddedReaderTemplate } from './export/readerpage.js';
import { buildExtraSections } from './ui/settings-extra.js';
import { applyLooks } from './ui/looks.js';
import { mountAppearance } from './ui/appearance-popover.js';
import { mountColorProbe } from './ui/color-probe.js';
import { applyTheme, applyContrast, applyStaffLines, STAFF_CHOICES, applyLean, LEAN_CHOICES, LIGHT_LEAN, applyGlyphWeight, GLYPH_CHOICES, applyUiFont, FONT_CHOICES } from './ui/theme.js';
import { LOGO_DATA_URI } from './ui/logo-data.js';
import { LOGO_DARK_DATA_URI } from './ui/logo-data-dark.js';
import { LOGO_HC_DATA_URI } from './ui/logo-data-hc.js';
import { buildColorSection, loadColors, applyColors } from './ui/theme-colors.js';
import { createPageSettings } from './ui/page-settings.js';
import { WorkletSynthesizer } from 'spessasynth_lib';
import { SpessaSynthProcessor, SoundBankLoader } from 'spessasynth_core';
import { renderBacking } from './audio/prerender.js';
import { runAudioExport } from './audio/audioexport.js';
import { encodeOpus, canEncodeOpus } from './audio/oggopus.js';
import { openAudioExportDialog } from './ui/audio-export-dialog.js';
import { zip as zipFiles } from './export/zip.js';
import { listeningExcerpts } from './model/samples-listening.js';
import { createPreferencesStore } from './ui/preferences-store.js';
import { initialList, remember as rememberRepo, forget as forgetRepo } from './export/githubrepos.js';
import { setChordSymbolsSound } from './ui/play-intents.js';
import { applyButtonSize, BUTTON_SIZE_CHOICES } from './ui/button-size.js';
import { applyDisplayMode, DISPLAY_MODES } from './ui/display-mode.js';
import { isPhone } from './ui/device-class.js';
import { createNewScoreAssistant } from './ui/newscore-dom.js';
import { installPanScroll } from './ui/pan-scroll.js';
import { createScore, createStarterScore, applyTapSections } from './model/index.js';
import { templateCatalog, findTemplate } from './ui/template-intents.js';
import { suggestFileName, workToFileText, workFromFileText, downloadBlob, pickFile, pickFiles, pickImageFile, isMusicXmlFile, sanitizeFileStem } from './ui/file-io.js';
import { openRecueilDialog } from './ui/recueil-dialog.js';
import { importMusicXmlBytes } from './import/musicxml.js';
import { importMidi, importMidiBytes, describeMidi } from './import/midi.js';
import { isMidiFile } from './import/midi-read.js';
import { openMidiImportDialog } from './ui/import-midi-dialog.js';
import { exportGuitarPro } from './export/guitarpro.js';
import { serializeChordTrack } from './export/chordtrack.js';
import { importGuitarProBytes, isGuitarProFile } from './import/guitarpro.js';
import { openImportReport } from './ui/import-report.js';
import { irealSongs, irealPlaylistName, mergeIrealSongs, importIrealSong, looksLikeIreal } from './import/ireal.js';
import { pickSong } from './ui/song-picker.js';
import { isMixerOnly } from './ui/mixer-intents.js';
import { isAutomationOnly } from './ui/automation-intents.js';
import { isAllInOneArchive, readAllInOneArchive } from './import/allinone-archive.js';
import { isSongsterrArchive, importSongsterrBytes } from './import/songsterr.js';
import { importAllInOne, parseKey } from './import/allinone.js';
import { createStemPlayer } from './audio/stemplayer.js';
import { usedAssets, assetHref, clearAssets, registerAsset } from './model/assets.js';
import { buildScorsaireArchive, isScorsaireArchive, readScorsaireArchive } from './model/container.js';
import { externalizeMedia, referenceMedia } from './model/externalmedia.js';
import { pageParams, authFetch } from './reader/access.js';
import { bytesFromParams, READER_URL } from './share/sharelink.js';
import { readPortalAddress, createPortalSession, cleanAddress } from './ui/portal-session.js';
import { mountPwaUpdate } from './ui/pwa-update.js';
import { mountThemeColor } from './ui/theme-color.js';
import { createDraftStore, createAutosave } from './ui/work-draft.js';
import { describeDraftChange } from './ui/draft-diff.js';
import { mediaBase, resolveExternalMedia } from './reader/externalmedia.js';
import { expandCandidates, matchExternalMedia } from './model/externalmatch.js';
import { friendlyImportError } from './import/errormessage.js';
import { loadStretch } from './audio/stretch-loader.js';
import { createSyncMap } from './audio/syncmap.js';
import { movePoint, shiftPointsFrom, moveMeasureStart, shiftMeasuresFrom, createMapHistory } from './audio/mapedit.js';
import { createAnchorClicker } from './audio/anchorclick.js';
import { mountSyncEditBar } from './ui/sync-edit-bar.js';
import { syncStructureMatches, syncStructureDiff, scoreOnlyName } from './audio/syncguard.js';
import { createYouTubePlayer, parseYouTubeId } from './audio/youtubeplayer.js';
import { createClockPlayer } from './audio/clockplayer.js';
import { createSwitchPlayer } from './audio/switchplayer.js';
import { placementAt, placementMap, placementProblems, retimePlacements, normalizeDisplay, viewOf } from './audio/placements.js';
import { sanitizeItems, sanitizeStyles, usedStylesOf } from './audio/banner.js';
import { mountPlacementPanel } from './ui/placement-panel.js';
import { mountYoutubeViewer } from './ui/yt-viewer.js';
import { mountVideoViewer } from './ui/video-sync-viewer.js';
import { usableVideos, videoMeasures, sectionSegments, audioToVideoTime, followableVideos } from './audio/videosync.js';
import { planPartsMerge, mergeAnalysis, pourParts, sectionsOf, shiftSections, combineSections, chordTrackFor, lyricsTrackFrom } from './import/merge-parts.js';
import { replaceSections } from './model/systemedit.js';
import { PID } from './model/pid.js';
import { allPoolsOf } from './model/voicingpools.js';
import { getProperty } from './model/props.js';
import { mountMergePanel } from './ui/merge-panel.js';
import { mountYtLayout } from './ui/yt-layout.js';
import { mountYtNavigator } from './ui/yt-navigator.js';
import { mountYtFragmentEditor } from './ui/yt-fragment-editor.js';
import { saveDraft, loadDraft } from './ui/yt-draft.js';
import { createStage, overlayOptions } from './ytreader/stage.js';
import { createSessionHistory } from './ui/session-history.js';
import { askText } from './ui/text-dialog.js';
import { retimeSequence } from './audio/syncscore.js';
import { mountSyncPanel } from './ui/sync-panel.js';
import { askStemTracks } from './ui/sync-tracks-dialog.js';
import { tracksToCreate } from './ui/sync-tracks.js';
import { measureLengthOf } from './model/timing.js';
import { frac, fMul, fToNumber } from './model/fraction.js';

export const VERSION = '0.0.2';

function start() {
  installZoomLock(); // panels keep their screen size under pinch zoom on tablets and phones
  installIconify(document.body, { glyphs }); // symbol-only buttons of every panel become one-colour icons
  // device storage first: the language preference is read before anything is translated
  const browserStorage = (() => { try { return window.localStorage ?? null; } catch { return null; } })();
  const displayMode = applyDisplayMode({ storage: browserStorage }); // « Display type »: phone / tablet forced on this device (ui/device-class.js), applied before anything reads `isPhone()`
  const theme = applyTheme(browserStorage); // light / dark / system, before anything is drawn
  const logoUri = () => (document.documentElement.hasAttribute('data-hc') ? LOGO_HC_DATA_URI : document.documentElement.hasAttribute('data-dark') ? LOGO_DARK_DATA_URI : LOGO_DATA_URI);
  const contrast = applyContrast(browserStorage); // contrast level of text and lines (light and dark themes)
  const staffLines = applyStaffLines(browserStorage); // strength of the staff lines, any theme
  const darkText = applyLean(browserStorage); // lighter text on the dark themes
  const lightText = applyLean(browserStorage, undefined, LIGHT_LEAN); // and on the light theme
  const uiFont = applyUiFont(browserStorage); // Inter / system fonts
  const glyphWeight = applyGlyphWeight(browserStorage); // thinner clefs, time signatures and notes
  const syncLogo = () => { for (const img of document.querySelectorAll('img[data-logo]')) img.src = logoUri(); };
  new MutationObserver(syncLogo).observe(document.documentElement, { attributes: true, attributeFilter: ['data-dark', 'data-hc'] }); // the header logo follows the theme
  applyColors(loadColors(browserStorage)); // the colours chosen on this device
  // interface language: stored choice > browser language > fallback (French)
  // PORTAL MODE (the school portal opened this page to modify one score of its library): the token is read once, kept in memory, and wiped from the address bar
  const portal = (() => {
    const address = readPortalAddress(pageParams());
    if (!address) return null;
    const session = createPortalSession({ address, fileVersion: FILE_VERSION });
    try { history.replaceState(null, '', cleanAddress()); } catch { /* the address stays as it is: nothing else reads it */ }
    return session;
  })();
  const langChoice = portal?.address.lang ?? readLangChoice(browserStorage); // the portal's language for this visit (not remembered)
  const lang = resolveLanguage({ choice: langChoice, preferred: (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [], supported: Object.keys(CATALOGS), fallback: DEFAULT_LANG });
  document.documentElement.lang = lang;
  const t = createI18n(lang);
  const works = { architecture: sampleArchitectureWork(), stress: sampleStressWork(), stress27: sampleStressWork({ measures: 100, copies: 3 }), tablature: sampleTablatureWork(), marks: sampleTablatureMarksWork(), techniques: sampleTablatureTechniquesWork(), scoretech: sampleScoreTechniquesWork(), capo: sampleCapoWork(), verif: sampleVerificationWork(), perc: samplePercussionWork(), percLines: samplePercussionLinesWork(), percRests: samplePercussionRestsWork(), percPresets: samplePercussionPresetsWork(), percSticking: samplePercussionStickingWork(), fingering: sampleFingeringWork(), fingering2: sampleFingeringAdvancedWork(), accordion: sampleAccordionWork(), jumps: sampleJumpsWork(), breaths: sampleBreathsWork(), trills: sampleTrillsWork(), tempo: sampleTempoWork(), pedal: samplePedalWork(), dynamics: sampleDynamicsWork(), transpose: sampleTransposeWork(), cclefs: sampleCClefsWork(), doClefs: sampleDoClefsWork(), doTranspose: sampleDoTransposeWork(), chords: sampleChordSymbolsWork(), chordPatterns: sampleChordPatternsWork(), crossStaff: sampleCrossStaffWork(), rhythm: sampleRhythmWork(), lyrics: sampleLyricsWork(), staffText: sampleStaffTextWork(), containers: sampleContainersWork(), noteEntry: sampleNoteEntryWork(), linked: sampleLinkedWork() };
  // the heaviest stress work (150 measures × 36 staves) is built when it is chosen, not at every start of the page
  let stress33Work = null;
  Object.defineProperty(works, 'stress33', { enumerable: true, get: () => (stress33Work ??= sampleStressWork({ measures: 150, copies: 4 })) });
  let current = createStarterScore({ lang }); // œuvre affichée (ou 'legend') : une partition de départ vierge (accords, 2 guitares, basse, batterie) ; les démos restent au menu
  let app5 = null; let percEditor = null; let staffPropsPanel = null; let tracksPanel = null; let settingsPanel = null; let mixerPanel = null; let bendGraph = null; let diagramEditor = null; let recordWindow = null; let measurePill = null; let fragmentEditor = null; let mounted = null; let entryModal = null; // Application (tranche 2) et vue montée
  installSlotResize({ app: { setSlotWidth: (...a) => app5?.setSlotWidth(...a) } }); // the corner that pulls the width of a container between two measures (screens 1 and 2; the application is made later)
  // préférences de l'application, partagées par les œuvres successives et PERSISTANTES (localStorage si le navigateur l'autorise ; sinon en mémoire, export / import de fichier)
  const preferences = createPreferencesStore({}, { storage: browserStorage });
  // the GitHub repositories of the person, shared by « Publish on GitHub » and « Send to another teacher » (the older single memory is read as the first entry until a list is kept)
  const githubRepoList = () => initialList(preferences.get('githubRepos')?.repos, preferences.get('githubPublish'));
  const setGithubRepos = (repos) => { try { preferences.set('githubRepos', { repos }); } catch { /* kept for this window only */ } return repos; };
  const githubRepoActions = () => ({ repos: githubRepoList(), save: (e) => setGithubRepos(rememberRepo(githubRepoList(), e)), forget: (e) => setGithubRepos(forgetRepo(githubRepoList(), e)) });
  // the chord display chosen by the user on this device is a style layer seen by every layout (below the project's own values, above the Scorsaire defaults)
  const userChordLayer = () => { try { return chordDisplayLayer(preferences.get('chordDisplay') ?? {}); } catch { return {}; } };
  setUserStyleLayer(userChordLayer());
  // lecteur (moteur audio V1) : UN moteur pour la page (le contexte audio est créé au premier clic sur ▶), un lecteur par œuvre affichée
  const soundAvailable = webAudioAvailable();
  let engine = soundAvailable ? createWebAudioEngine() : new NullAudioEngine();
  const activityListeners = new Set(); let offActivity = null; // the LEDs of the mixer: a note of a track reached the engine
  let offFx = null; // what the compressors report goes to the page as window events (the window of the track listens: reduction meter, limit note)
  const hookFx = (e) => { offFx?.(); offFx = e.onCompressor?.((ev) => window.dispatchEvent(new CustomEvent(ev.type === 'limit' ? 'scorsaire:comp-limit' : ev.type === 'unavailable' ? 'scorsaire:comp-unavailable' : 'scorsaire:comp-reduction', { detail: ev }))) ?? null; };
  const hookActivity = (e) => { hookFx(e); offActivity?.(); offActivity = e.onActivity?.((id, played) => { for (const fn of activityListeners) fn(id, played); }) ?? null; };
  hookActivity(engine);
  // hearing the notes as they are placed (the setting is a device preference, on by default)
  const auditioner = createAuditioner({ getEngine: () => engine, isPlaying: () => !!player?.state().playing, enabled: () => true });
  // engine choice (light oscillators / SoundFont synth in an AudioWorklet): a device preference; the light engine plays until the SoundFont one is ready
  // The worklet processor is embedded by tools/build.js (`__SPESSA_PROCESSOR__`) and started from a Blob URL (a data: URL is tried if the Blob is refused)
  const processorUrls = () => {
    if (typeof __SPESSA_PROCESSOR__ === 'undefined') return ['spessasynth_processor.min.js'];
    const urls = [];
    try { urls.push(URL.createObjectURL(new Blob([__SPESSA_PROCESSOR__], { type: 'text/javascript' }))); } catch { /* no Blob URL */ }
    urls.push(`data:text/javascript;charset=utf-8,${encodeURIComponent(__SPESSA_PROCESSOR__)}`);
    return urls;
  };
  const engineManager = soundAvailable ? createEngineManager({
    preferences, store: createLazyFontStore(createIndexedDbFontStore()),
    makeLight: () => engine, makeSoundFont: () => new SoundFontEngine(),
    loadLibrary: async () => ({ WorkletSynthesizer, processorUrl: processorUrls() }),
    onEngine: (next) => { engine = next; hookActivity(next); player?.setEngine(next); },
    soundFontAvailable: () => typeof AudioWorkletNode !== 'undefined',
  }) : null;
  // the SoundFont instruments the mixer offers (the loaded SoundFont's presets); picking one is saved on the track and heard at once
  const soundPresets = () => (engineManager ? {
    list: () => engine.presets?.() ?? [],
    subscribe: (fn) => engineManager.subscribe(fn),
    pick: (trackId, preset) => {
      app5?.setTrackPreset(trackId, preset);
      try {
        if (!engine.audition || player?.state().playing) return;
        const mix = app5?.playbackMixer?.()[trackId] ?? { volume: 1, mute: false, solo: false };
        engine.audition({ tracks: [{ id: 'audition-preview', kind: 'pitched', instrumentId: null, mixer: { ...mix, mute: false, solo: false, preset: preset ?? null } }],
          notes: [60, 64, 67].map((pitch, i) => ({ id: `pv${i}`, track: 'audition-preview', pitch, velocity: 80, t: 0, duration: 0.9 })) });
      } catch { /* hearing the instrument is never worth an error */ }
    },
  } : null);
  // the pattern editor: hear a pattern on a reference chord (a small throw-away work through the real planner, played with the engine's audition)
  const listenToPattern = ({ pattern, root, quality, instrument, cardId }) => {
    try {
      if (!engine.audition || player?.state().playing) return;
      const seq = patternAuditionSequence({ pattern, root, quality, instrument, cardId, cards: app5?.preferences.get('strumCards')?.items });
      engine.audition({ tracks: seq.tracks, notes: seq.notes, timed: true });
    } catch { /* hearing a pattern is never worth an error */ }
  };
  // the groove editor: hear a groove alone or with its variations (a small throw-away work through the real planner)
  const listenToGroove = ({ groove, variations }) => {
    try {
      if (!engine.audition || player?.state().playing) return;
      const seq = grooveAuditionSequence({ groove, variations, bars: variations ? Math.max(8, 4 * (groove.variants?.length ?? 0) + 4) : 4, seed: 1 + Math.floor(Math.random() * 1000) });
      engine.audition({ tracks: seq.tracks, notes: seq.notes, timed: true });
    } catch { /* hearing a groove is never worth an error */ }
  };
  const stopListening = () => { try { engine.stopAudition?.(); } catch { /* nothing to stop */ } };
  // the styles window: hear a style on a progression (a small throw-away work to which the style is applied, through the real planner)
  const listenToStyle = ({ style, skip }) => {
    try {
      if (!engine.audition || player?.state().playing) return;
      const seq = styleAuditionSequence({ style, skip, user: app5.userPlayLists(), seed: 1 + Math.floor(Math.random() * 1000), lang });
      engine.audition({ tracks: seq.tracks, notes: seq.notes, timed: true });
    } catch { /* hearing a style is never worth an error */ }
  };
  let audioSection = null;
  let strumSection = null;
  const excerpts = listeningExcerpts();
  let viewsBar = null; let stopSoloLive = null; let excerpt = null; let player = null; let playerUi = null; let entryBar = null; let gridMode = null; // barre de saisie de notes
  let openedName = null; // name of the file the current work was opened from
  let scrollMaxMeasures = (() => { try { const n = Number(browserStorage?.getItem('scorsaire.scrollMaxMeasures')); return Number.isInteger(n) && n >= 8 ? n : 150; } catch { return 150; } })();
  let viewMode = (() => { try { return browserStorage?.getItem('scorsaire.viewMode') === 'wrap' ? 'wrap' : 'scroll'; } catch { return 'scroll'; } })(); // scrolling view by default (decision of Jean, 2026-10-16)
  // performance probe (off unless the address has `?perf`, see perf/probe.js): the numbers of a real score, and a small panel to read them
  if (enableFromAddress(browserStorage)) {
    const mountPanel = () => mountPerfPanel({ probe: perf, label: (k) => t(k), describe: () => {
      const movements = app5?.doc?.work?.movements ?? [];
      return { measures: movements.map((m) => m.masterbars.length), staves: movements.map((m) => m.tracks.reduce((n, tr) => n + tr.staves.length, 0)), viewMode, domElements: document.getElementsByTagName('*').length, svgElements: document.querySelectorAll('svg *').length };
    } });
    if (document.body) mountPanel(); else window.addEventListener('DOMContentLoaded', mountPanel, { once: true });
  }
  const dock = mountDock({ label: (k, p) => t(k, p) });
  const appearanceButton = mountAppearance({ theme, contrast, text: { get: () => (document.documentElement.hasAttribute('data-dark') ? darkText : lightText).get(), set: (v) => (document.documentElement.hasAttribute('data-dark') ? darkText : lightText).set(v) }, label: (k, p) => t(k, p) });
  dock.topRight.append(appearanceButton); // theme and contrast: a popover (computer) or a sheet (tablet, phone) // the bottom dock: transport (top row), note entry and file drawer (bottom row)
  let fileDrawer = null; // created once the file actions exist (below)
  // the sidebar of screen 1 (computers only): tabs for the tracks, the diagram editor, the vertical piano and guitar. Its element is put in the page once the page exists.
  let screen = 'one';
  let syncLeftOut = null; // the work of a file whose synchronisation could not be loaded (its audio was not found): saving it would write the score alone
  let syncSession = null; // screen 4: { work, player (stems), session: { key, offsetMs }, map, analysis, imp, panel, off }
  const sideHost = document.createElement('aside'); sideHost.id = 'side-host';
  const sidebar = mountSidebar(sideHost, { label: (k, p) => t(k, p), storage: browserStorage });
  sidebar.addTab('work', t('sidebar.tab.work'), { hint: t('headerTabs.work') }); // order of the tabs: Work, Movement (abbreviated), Tracks
  sidebar.addTab('movement', t('sidebar.tab.movement'), { hint: t('headerTabs.movement') });
  sidebar.addTab('tracks', t('sidebar.tab.tracks'));
  const viewsDrawer = mountViewsDrawer({ dock, sidebar, label: (k, p) => t(k, p) }); // on a computer the views bar is the 'Views' tab of the sidebar
  let liveEngine = null; // while a take is recorded with a pre-rendered backing, the keys sound on the fast engine (see `backingApi`)
  const pianoDrawer = mountPianoDrawer({ sidebar, dock, label: (k, p) => t(k, p), getEngine: () => liveEngine ?? engine, isPlaying: () => !!player?.state().playing, storage: browserStorage }); // on-screen keyboard above the dock rows
  const midiInput = createMidiInput(); // MIDI keyboards (Chrome / Edge / Android): enabled from the recording window
  midiInput.onNote((ev) => pianoDrawer.midiNote(ev));
  let sideWork = null; // the Work / Movement tabs of the sidebar (computers)
  let headerTabs = null; // header tabs « Work » / « Movement » (computers only)
  let sheetsScreen = null; let sheetsApp = null; // screen 3 (sheets for the reader)
  let partsScreen = null; let partsApp = null; // screen 2 (parts and page layout): UI state, never in the document
  let cqEditor = null; let cqApp = null; // éditeur du dictionnaire de qualités d'accord (tranche 5)

  // the display options of the page (UI state: never in the document)
  const ui = createPageSettings({ playChain: true, concertPitch: false, chordFit: true, showMuted: true, showHidden: true, showCells: true, showChordQualities: false, tabKeyboard: hasFinePointer(), staffSpace: 8, scrollMax: scrollMaxMeasures, trackControls: (() => { try { return browserStorage?.getItem('scorsaire.trackControls') !== '0'; } catch { return true; } })(), visualSoloAudio: (() => { try { return browserStorage?.getItem('scorsaire.visualSoloAudio') === '1'; } catch { return false; } })() });
  document.title = t('app.title');
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="titlebar" data-status-line style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px">
      <h1 style="margin:0"><img src="${logoUri()}" alt="${t('app.title')}" data-logo style="display:block;height:38px;width:auto"></h1>
      <span id="base-slot" style="display:flex;align-items:center"></span>
      <span id="header-tabs-slot"></span>
      <span id="top-slot" style="display:flex;flex:1 1 auto;min-width:0"></span>
      <span id="views-slot" style="display:none;align-items:center;min-width:0;max-width:100%;border:1px solid var(--line,#d8d3c8);border-radius:10px;padding:2px 4px;box-sizing:border-box"></span>
    </div>
    <div id="status-overlay" aria-live="polite" style="position:fixed;right:calc(var(--sb-right,0px) + 10px);bottom:calc(var(--dock-h,0px) + 8px);z-index:6;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;justify-content:flex-end;max-width:60vw;pointer-events:none;background:var(--paper-veil,rgba(250,248,244,.82));border-radius:6px;padding:2px 8px">
      <span id="fileInfo" class="caption" style="white-space:nowrap;color:var(--danger-ink,#c0392b)"></span>
      <span id="viewInfo" class="caption"></span>
      <span id="stats" class="caption" style="white-space:nowrap;color:var(--ink-faint,#777)"></span>
      <span id="layoutTime" class="caption" style="white-space:nowrap;color:var(--ink-faint,#777)"></span>
    </div>
    <div id="sync-warning" data-sync-warning role="alert" style="display:none"></div>
    <div id="sync-host" style="display:none"></div>
    <div id="player-host"></div>
    <div id="entry-host"></div>
    <div id="work-row" style="display:flex;gap:12px;align-items:flex-start">
      <div id="score-host" style="flex:1 1 0;min-width:0;order:2"><div id="view-host"></div><div id="legend-host"></div></div>
      <span id="side-slot"></span>
    </div>
    <div id="page-row" style="display:none;gap:12px;align-items:flex-start"><div id="page-host" style="flex:1 1 0;min-width:0;order:1"></div></div>
    <div id="cq-host" class="controls" style="display:none;margin-top:18px;align-items:flex-start"></div>`;

  const $ = (id) => document.getElementById(id);
  $('side-slot').replaceWith(sideHost);
  /** A choice held in memory (the settings panel draws its own menu): get / set (no callback) / pick (set + callback). */
  const choice = (initial, onPick) => {
    let value = initial;
    return { get: () => value, set: (v) => { value = v; }, pick: (v) => { value = v; onPick(v); } };
  };
  /** Panneau du dictionnaire de qualités : monté sur l'Application courante quand la case est cochée, remonté si l'œuvre change. */
  const syncChordQualityEditor = () => {
    const open = ui.get('showChordQualities') && app5;
    $('cq-host').style.display = open ? 'block' : 'none';
    if (cqEditor && (!open || cqApp !== app5)) { cqEditor.destroy(); cqEditor = null; cqApp = null; }
    if (open && !cqEditor) { cqApp = app5; cqEditor = mountChordQualityEditor($('cq-host'), app5, { glyphs, label: (k, p) => t(k, p), staffSpace: 20 }); }
  };
  /** Screen 1 (writing) or screen 2 (parts, page layout): the other one is hidden, not destroyed; screen 2 follows the current work. */
  let wasTwo = false;
  let idleEl = null; // the placeholder of screens 4 / 5 while nothing is loaded (ui/sync-idle.js)
  const isFour = () => screen === 'four' || screen === 'yt'; // 'yt' = the YouTube editor (screen 5): same structure as screen 4, with the real reader as viewer
  const syncScreen = () => {
    const three = screen === 'three' && app5 && current !== 'legend';
    const two = screen === 'two' && app5 && current !== 'legend';
    if (syncSession && (syncSession.work !== current || !app5)) stopSync();
    // screen 4 = screen 1 with the media panel above the score, for an AUDIO session; screen 5 = the same with the YouTube editor, for a YouTube session
    const four = isFour() && !!syncSession && (screen === 'yt' ? syncSession.mode === 'placements' : syncSession.mode !== 'placements') && app5 && current !== 'legend';
    const idleKind = isFour() && !four ? (screen === 'yt' ? 'youtube' : 'audio') : null; // nothing (suitable) loaded: an empty page with a button to load, screen 1 hidden like on screens 2 and 3
    if (idleKind && idleEl?.kind !== idleKind) { idleEl?.destroy(); idleEl = mountSyncIdle({ kind: idleKind, label: (k, p) => t(k, p), onCreate: idleKind === 'audio' ? () => syncCreation() : null, onFromMusic: idleKind === 'audio' ? () => startFromMusic() : null, onLoad: () => (idleKind === 'audio' ? openFile() : newYouTube()) }); $('page-host').append(idleEl.el); }
    if (!idleKind && idleEl) { idleEl.destroy(); idleEl = null; }
    $('sync-host').style.display = four ? '' : 'none';
    if (four && syncSession?.layout) syncSession.layout.refresh(); // the display style was cleared above: the two columns again
    queueMicrotask(updateSyncWarning);
    document.documentElement.toggleAttribute('data-yt', screen === 'yt');
    if (syncSession?.layout) syncSession.layout.timelineHost.style.display = four && screen === 'yt' ? '' : 'none'; // the fixed timeline band belongs to screen 5 only
    if (four && screen === 'yt' && syncSession.layout) { syncSession.layout.adoptWorkRow(); sidebar.setHidden(true); } // coming back to screen 5: the score canvas and the hidden sidebar again
    if (syncSession?.layout && screen !== 'yt') { syncSession.layout.restoreWorkRow(); sidebar.setHidden(false); } // the score canvas goes back to screen 1
    if (four && !syncSession.panel) mountSyncSession();
    if (!four) syncSession?.player.pause();
    const off = two || three || !!idleKind; // screen 1 is hidden on screens 2 and 3, and on screens 4 and 5 while nothing is loaded
    for (const id of ['work-row', 'player-host', 'entry-host']) $(id).style.display = off ? 'none' : (id === 'work-row' ? 'flex' : '');
    $('page-row').style.display = off ? 'flex' : 'none';
    const sideParent = off ? $('page-row') : $('work-row'); // the sidebar sits beside whichever screen is shown
    if (sideHost.parentElement !== sideParent) sideParent.append(sideHost);
    dock.setScreen(three || idleKind ? 'three' : two ? 'two' : 'one'); // the empty screens 4 / 5 have the bar of screen 3 (no entry, views, piano…)
    if (off) tracksPanel?.close(); // the structural panel is a screen-1 tool
    if (off && app5?.noteEntry?.().active) app5.setNoteEntry({ active: false });
    if (!off && wasTwo) { const v = app5?.view('main'); if (v) $('stats').textContent = t('demo.stats', { systems: v.layout().systems.length, measures: v.movement().masterbars.length }); }
    if (!off && wasTwo) mounted?.refresh(); // screen 1 does not follow the edits made while it was hidden: it catches up now (its layout is rebuilt only from what changed)
    if (partsScreen && (!two || partsApp !== app5)) { partsScreen.destroy(); partsScreen = null; partsApp = null; }
    wasTwo = off;
    sidebar.setScreen(three ? 'three' : two ? 'two' : 'one');
    sidebar.setHidden(!!idleKind || (four && screen === 'yt')); // no column beside an empty page, nor beside the YouTube editor (it has its own)
    if (idleKind) $('stats').textContent = '';
    if (three || idleKind) player?.pause?.(); else app5?.stopCell?.(); // one thing sounds at a time: the piece on screens 1-2, a cell on screen 3
    queueMicrotask(() => playerUi?.refresh?.()); // the ▶ ■ of the dock follow the screen // the tabs of the screen shown, and the column's place at the edge of the window
    if (sheetsScreen && (!three || sheetsApp !== app5)) { sheetsScreen.destroy(); sheetsScreen = null; sheetsApp = null; }
    if (three && !sheetsScreen) { sheetsApp = app5; sheetsScreen = mountSheetsScreen($('page-host'), { app: app5, glyphs, label: (k, p) => t(k, p), sidebar, onSelect: () => playerUi?.refresh?.(), onExport: (v) => exportReaderFile(v), previewHtml: (sheetId) => readerPageFor(sheetId) }); $('stats').textContent = ''; }
    if (two && !partsScreen) { partsApp = app5; partsScreen = mountPartsScreen($('page-host'), { app: app5, glyphs, label: (k, p) => t(k, p), sidebar, onStatus: (text) => { if (screen === 'two') $('stats').textContent = text; }, openFragment: (id, hint) => fragmentEditor?.open(id, hint ? { screen2: hint } : { mode: 'full' }), openDiagram: (id) => diagramEditor?.open(id), onMeasurePick: (mi, i) => { if (player && !player.state?.().playing) { try { player.seekToMeasure(mi, i); } catch { /* a measure that is never played */ } } } }); }
    if (two && partsScreen && player) { const st = player.state(); partsScreen.setPlayCursor(st.where && st.playing ? st.where : null); }
  };
  const render = () => {
    // the width of a system = the real width of the score area (the page is re-laid out when it changes, see below)
    const scoreHost = $('score-host'); const hostPad = scoreHost ? (parseFloat(getComputedStyle(scoreHost).paddingLeft) || 0) + (parseFloat(getComputedStyle(scoreHost).paddingRight) || 0) : 0;
    const canvasWidth = Math.max(360, Math.round((scoreHost.clientWidth || 538) - hostPad)); // what the drawing may use: the padding of the host is not
    const staffSpace = ui.get('staffSpace');
    // largeur disponible pour un système, en espaces (marges de 10 px de chaque côté)
    if (current === 'legend') {
      if (mounted) { pianoDrawer.setEntry(null); recordWindow?.destroy(); recordWindow = null; measurePill?.destroy(); measurePill = null; playerUi?.destroy(); player?.destroy(); playerUi = null; player = null; entryBar?.destroy(); entryBar = null; gridMode?.destroy(); gridMode = null; mounted.destroy(); viewsBar?.destroy(); viewsBar = null; stopSoloLive?.(); stopSoloLive = null; percEditor?.destroy(); percEditor = null; staffPropsPanel?.destroy(); staffPropsPanel = null; tracksPanel?.destroy(); tracksPanel = null; settingsPanel?.destroy(); settingsPanel = null; pianoDrawer.setMixer(null); pianoDrawer.setPercmap(null); mixerPanel?.destroy(); mixerPanel = null; bendGraph?.destroy(); bendGraph = null; diagramEditor?.destroy(); diagramEditor = null; fragmentEditor?.destroy(); fragmentEditor = null; entryModal?.destroy(); entryModal = null; mounted = null; app5 = null; }
      $('player-host').replaceChildren();
      syncChordQualityEditor();
      // légende de percussion (5c) : tous les sons de la percmap, puis une sélection (choix à l'intégration)
      const width = (canvasWidth - 20) / staffSpace;
      const translate = (id) => { const k = `drum.sound.${id}`; const v = t(k); return v === k ? undefined : v; };
      const some = ['bassDrum1', 'acousticSnare', 'closedHiHat', 'openHiHat', 'crashCymbal1'];
      // noms personnalisés stockés dans la carte (ici en français : « names.fr »)
      const custom = { ...DEFAULT_PERCMAP, sounds: DEFAULT_PERCMAP.sounds.map((s) => (s.id === 'bassDrum1' ? { ...s, names: { [lang]: 'GC' } } : s.id === 'acousticSnare' ? { ...s, names: { [lang]: 'Caisse' } } : s)) };
      const parts = [
        layoutDrumLegend(null, glyphs, { width, lang, translate }), // noms du catalogue dans la langue de l'interface
        layoutDrumLegend(null, glyphs, { width, lang: 'en', sounds: some }), // noms anglais de la carte
        layoutDrumLegend(custom, glyphs, { width, lang, translate, sounds: some }), // noms personnalisés (GC, Caisse) puis catalogue
      ];
      $('legend-host').innerHTML = parts.map((l) => renderSvgString(l, glyphs, { staffSpace, canvasWidth })).join('');
      $('stats').textContent = '';
      document.documentElement.dataset.systems = String(parts[0].systems.length);
      syncScreen();
      return;
    }
    // hauteur de concert (hauteur sonnante) : style forcé par la page, sans toucher au modèle
    const concert = ui.get('concertPitch');
    // accords : compression dans la case (rendu, écran partition / lecteur) ou largeur réelle réservée (édition) ; réglage de la page, sans toucher au modèle
    const chordFit = ui.get('chordFit');
    // the soprano saxophone photograph (a device setting): off = the clarinet icon
    const sopranoPhoto = preferences.get('instrumentIcons')?.sopranoPhoto !== false;
    const forced = { ...(concert ? { [SID.CONCERT_PITCH]: true } : {}), ...(chordFit ? {} : { [SID.CHORD_FIT]: false }), ...(sopranoPhoto ? { [SID.SOPRANO_PHOTO]: true } : {}) };
    const getStyle = Object.keys(forced).length ? (sid) => (Object.hasOwn(forced, sid) ? forced[sid] : resolveStyle(sid, [current.movements[0].style])) : undefined;
    // view mode: 'wrap' = systems under each other (the width of the page); 'scroll' = ONE system, as long as the music, scrolled sideways
    // a very long piece is too heavy / too long to cross sideways: past the limit (a global preference of this device; 150 measures by default, 120 before 30/10/2026) the lines view is used instead
    const tooLong = viewMode === 'scroll' && current !== 'legend' && current.movements[0].masterbars.length > scrollMaxMeasures;
    const scrolling = viewMode === 'scroll' && !tooLong;
    const effective = scrolling ? 'scroll' : 'wrap';
    const viewParams = scrolling ? { width: 100000, bandWidth: (canvasWidth - 20) / staffSpace, staffSpace, canvasWidth: undefined, getStyle } : { width: (canvasWidth - 20) / staffSpace, bandWidth: (canvasWidth - 20) / staffSpace, staffSpace, canvasWidth, getStyle };
    $('score-host').style.overflowX = scrolling ? 'auto' : '';
    $('score-host').style.minHeight = scrolling ? '72vh' : ''; // room for the floating bars and drawers, which the scroller would clip
    $('score-host').dataset.viewMode = effective;
    $('viewInfo').textContent = tooLong ? t('view.tooLong', { max: scrollMaxMeasures }) : '';
    if (!app5 || app5.doc.work !== current) {
      // tranche 2 : une vue 'main' sur le Document de l'œuvre affichée ; clic = sélection (aucun geste d'édition encore)
      playerUi?.destroy(); player?.destroy(); playerUi = null; player = null;
      entryBar?.destroy(); entryBar = null;
      gridMode?.destroy(); gridMode = null;
      if (mounted) mounted.destroy();
      entryModal?.destroy();
      staffPropsPanel?.destroy(); staffPropsPanel = null; tracksPanel?.destroy(); tracksPanel = null; settingsPanel?.destroy(); settingsPanel = null; pianoDrawer.setMixer(null); mixerPanel?.destroy(); mixerPanel = null; bendGraph?.destroy(); bendGraph = null; diagramEditor?.destroy(); diagramEditor = null; fragmentEditor?.destroy(); fragmentEditor = null; headerTabs?.destroy(); headerTabs = null; sideWork?.destroy(); sideWork = null;
      const doc = createDocument(current);
      // presse-papiers système (texte) : seulement si le navigateur le fournit ; l'écriture est tentée dans le geste de copie (try/catch côté Application)
      const systemClipboard = typeof navigator !== 'undefined' && navigator.clipboard?.writeText ? { writeText: (t) => navigator.clipboard.writeText(t) } : null;
      app5 = createApplication({ doc, preferences, systemClipboard, lang });
      ui.set('tabKeyboard', inputOptionsOf(app5.preferences).tabKeyboard);
      app5.setVisualSoloAudio(ui.get('visualSoloAudio'));
      const view = app5.addView(createScoreView({ id: 'main', doc, glyphs, ...viewParams }));
      // lecteur : la séquence est reconstruite à la demande (vitesse, modification du Document) ; il ne modifie jamais le Document.
      // Créé AVANT la vue montée : celle-ci l'interroge (mesures jouées) à chaque changement du Document, après son invalidation.
      const work = current; const options = excerpt?.options ?? {};
      player = createPlayer({ engine, scope: () => ({ movement: app5?.view('main')?.movementIndex?.() ?? 0, chain: ui.get('playChain') }), order: (mi, repeats) => { const mv = work.movements[mi]; return mv ? playOrder(mv, repeats ? {} : { expand: false }) : []; }, build: (speed, { repeats = true } = {}) => { /* synced with a played order (a recording with repeats): the score is built as it is PLAYED, its slots are the played measures */ const sy = syncSession; const synced = sy && sy.work === work && isFour(); const seq = buildSequence(work, { ...options, mixer: { ...options.mixer, ...app5?.playbackMixer() }, speed: synced ? 1 : speed, playRepeats: synced ? !!sy.map.order : repeats, strumCards: app5?.preferences.get('strumCards')?.items, chordPatterns: app5?.preferences.get('chordPatterns')?.items, chordSymbols: { ...options.chordSymbols, play: synced || app5?.preferences.get('playback')?.chordSymbols !== false } }); return synced ? retimeScore(seq, sy, work) : seq; }, schedule: (fn) => requestAnimationFrame(fn), cancel: (h) => cancelAnimationFrame(h) });
      // the keys of the on-screen keyboard (and the fretboard) light up with the playback; the fretboard lists the document's tracks that have pitches
      pianoDrawer.follow(player, { tracks: () => (app5?.tracksOutline()[0]?.tracks ?? []).filter((tr) => tr.staves.some((st) => st.type === 'score' || st.type === 'tab')).map((tr) => ({ id: tr.id, name: tr.name || tr.id })) });
      openedName = (current === works.opened) ? openedName : null;
      const showFileState = () => { const f = $('fileInfo'); f.textContent = doc.isClean() ? '' : '●'; f.title = doc.isClean() ? '' : t('file.modified'); };
      showFileState();
      rememberBase(); // (the work as it is now is the last clean state, when it is clean: what a draft is compared with)
      // the audio sequence is rebuilt in the background once the edits stop (1.2 s of quiet), not at the next click (see Player.prepare)
      let prepareTimer = null;
      const preparePlayerLater = () => { if (prepareTimer !== null) clearTimeout(prepareTimer); prepareTimer = setTimeout(() => { prepareTimer = null; player?.prepare?.(); }, 1200); };
      doc.subscribe((e) => { showFileState(); autosave?.touch(); updateSyncWarning(); if (isAutomationOnly(e.changes)) player?.refresh(); else if (!isMixerOnly(e.changes)) { player?.invalidate(); preparePlayerLater(); } queueMicrotask(() => { const v = app5?.view('main'); if (!v || screen === 'two') return; $('stats').textContent = t('demo.stats', { systems: v.layout().systems.length, measures: v.movement().masterbars.length }); }); });
      app5.onCompositePreview?.(() => mounted?.refresh());
      mounted = mountScoreView($('view-host'), view, { scroller: $('score-host'), app: app5, player, label: (k, p) => t(k, p), entryMessage: (m) => entryBar?.message(m), glyphs, onPercmap: (id) => percEditor?.open(id), onStaffProps: (id) => staffPropsPanel?.open(id), onBendGraph: (id) => bendGraph?.open(id), onFragmentEdit: (id) => fragmentEditor?.open(id), onDiagramEdit: (id, viewId) => diagramEditor?.open(id, viewId), onLyricEventEdit: (id) => openLyricEventOf(id), onRecord: () => recordWindow?.open(), onImportHere: (target, viewId) => importHere(target, viewId) });
      const showMovement = (id) => { const v = app5.view('main'); if (v?.setMovementId(id)) { mounted.refresh(); $('stats').textContent = t('demo.stats', { systems: v.layout().systems.length, measures: v.movement().masterbars.length }); } };
      headerTabs = mountHeaderTabs($('header-tabs-slot'), { app: app5, label: (k, p) => t(k, p), onShow: showMovement, chain: { get: () => ui.get('playChain'), set: (on) => ui.set('playChain', on) }, shownId: () => app5.view('main')?.movementId?.(), headerEl: document.querySelector('.titlebar') });
      sideWork = mountSidebarWorkPanels({ sidebar, app: app5, label: (k, p) => t(k, p), onShow: showMovement, chain: { get: () => ui.get('playChain'), set: (on) => ui.set('playChain', on) }, shownId: () => app5.view('main')?.movementId?.() });
      percEditor = mountPercMapEditor({ app: app5, glyphs, label: (k, p) => t(k, p), translate: (id) => { const k = `drum.sound.${id}`; const v = t(k); return v === k ? null : v; }, lang });
      staffPropsPanel = mountStaffProperties({ app: app5, label: (k, p) => t(k, p), onPercmap: (id) => percEditor?.open(id), onBake: (id) => openBakeDialog({ app: app5, glyphs, label: (k, p) => t(k, p), staffId: id }), onCards: (id) => openStrumCardsDialog({ app: app5, label: (k, p) => t(k, p), startId: id }), onPatterns: (id) => openChordPatternEditor({ app: app5, glyphs, label: (k, p) => t(k, p), onListen: listenToPattern, staffId: id }) });
      window.addEventListener('scorsaire:lyrics-sheet', (e) => openLyricsSheet({ app: app5, label: (k, p) => t(k, p), verse: e.detail.verse }));
      window.addEventListener('scorsaire:lyrics-adjust', (e) => openLyricsAdjust({ app: app5, glyphs, label: (k, p) => t(k, p), staffId: e.detail.staffId, verse: e.detail.verse }));
      bendGraph = mountBendGraph({ app: app5, player, label: (k, p) => t(k, p) });
      diagramEditor = mountDiagramEditor({ app: app5, glyphs, label: (k, p) => t(k, p), sidebar });
      fragmentEditor = mountFragmentEditor({ app: app5, glyphs, getStage: () => document.querySelector('#view-host > [data-score-stage]'), mainEntryMessage: (m) => entryBar?.message(m), label: (k, p) => t(k, p), callbacks: { onPercmap: (id) => percEditor?.open(id), onStaffProps: (id) => staffPropsPanel?.open(id), onBendGraph: (id) => bendGraph?.open(id) }, onClose: () => { mounted?.refresh(); entryBar?.refresh(); } });
      app5.attachPlayer(player);
      app5.attachContainerPlayback(createContainerPlayback({ getEngine: () => engine, player, build: (id) => buildContainerSequence(app5.doc, id) }));
      app5.attachCellPlayback(createContainerPlayback({ getEngine: () => engine, player, build: (key) => { const [sid, cid] = key.split('|'); const sh = app5.doc.work.sheets.find((x) => x.id === sid); const cell = sh && sheetCells(app5.doc.work, sh).find((c) => c.id === cid); const r = cell && buildCellSequence(app5.doc.work, sh, cell); if (!r) return null; if (r.loop) r.sequence.cellLoop = r.loop; return r.sequence; } }));
      setChordSymbolsSound(app5.preferences.get('playback')?.chordSymbols !== false);
      app5.onAudition((ids, kind) => { if (app5.preferences.get('audition')?.[kind === 'select' ? 'select' : 'notes'] === false) return; try { auditioner.play(buildAuditionSequence(app5.doc, ids)); } catch { /* hearing a note is never worth an error */ } });
      app5.onPreview((staffId, notes) => { if (app5.preferences.get('audition')?.notes === false) return; try { auditioner.play(buildTabPreviewSequence(app5.doc, staffId, notes)); } catch { /* hearing a note is never worth an error */ } });
      mixerPanel = mountMixerPanel({ app: app5, label: (k, p) => t(k, p), output: engineManager, presets: soundPresets(), playhead: { subscribe: (fn) => player.subscribe(fn), sequence: () => player.sequence() }, activity: { subscribe: (fn) => { activityListeners.add(fn); return () => activityListeners.delete(fn); } } });
      pianoDrawer.setMixer(mixerPanel);
      pianoDrawer.setPercmap({ staffId: () => app5?.percussionStaffId() ?? null, open: (id) => { mixerPanel?.close(); percEditor?.open(id); }, subscribe: (fn) => { const a = app5.onNoteEntryChange(fn); const b = app5.doc.subscribe(fn); return () => { a?.(); b?.(); }; } });
      settingsPanel = mountSettingsPanel({ app: app5, label: (k, p) => t(k, p), onChordPlacement: () => openChordPlacement(), chordPlacementFiles: { export: () => exportPlacementFile(app5), import: () => importPlacementFile(app5, 'user', (k, p) => t(k, p)) }, movementIndex: () => app5.view('main')?.movementIndex?.() ?? 0, extraSections: () => buildExtra() });
      viewsBar?.destroy(); stopSoloLive?.();
      viewsBar = mountViewsBar(dock.viewsHost, { app: app5, label: (k, p) => t(k, p), movementIndex: () => app5.view('main')?.movementIndex?.() ?? 0 });
      engineManager?.setMasterPan(app5.masterPan()); // the balance of the whole mix, at once and at every change (a drag included)
      stopSoloLive = app5.onMixerChange(() => { engineManager?.setMasterPan(app5.masterPan()); player?.updateMixer(playbackMixerWithClick()); });
      tracksPanel = mountTracksPanel({
        app: app5, lang, label: (k, p) => t(k, p), onStaffProps: (id) => staffPropsPanel?.open(id), sidebar,
        onLyricEvents: (trackId) => openLyricEvents({ app: app5, label: (k, p) => t(k, p), trackId, glyphs }),
        onStyles: (movement) => openStylesDialog({
          app: app5, label: (k, p) => t(k, p), movement, lang, onListen: listenToStyle, onStop: stopListening,
          onEditGroove: (startId, onClose) => openGrooveEditor({ app: app5, glyphs, label: (k, p) => t(k, p), onListen: listenToGroove, onStop: stopListening, startId, onClose }),
          onEditPattern: (startId, onClose, { role, card } = {}) => openChordPatternEditor({ app: app5, glyphs, label: (k, p) => t(k, p), onListen: listenToPattern, onStop: stopListening, startId, onClose, forInstrument: role === 'bass' ? 'bass' : role === 'guitar' ? 'guitar' : 'piano', forCard: card }),
          onEditCard: (startId, onClose) => openStrumCardsDialog({ app: app5, label: (k, p) => t(k, p), startId, onClose }),
        }),
        onCues: (movement) => openCuesDialog({ app: app5, label: (k, p) => t(k, p), movement }),
        onGrids: (movement) => openGridsDialog({ app: app5, label: (k, p) => t(k, p), movement }),
        onRealize: (movement) => openRealizeDialog({ app: app5, label: (k, p) => t(k, p), movement }),
        // the automatic player of a track: its pattern editor, its card editor and the window that shows what it plays
        onPlayer: {
          onGrooves: (trackId) => openGrooveEditor({ app: app5, glyphs, label: (k, p) => t(k, p), onListen: listenToGroove, onStop: stopListening, trackId }),
          onPatterns: (trackId) => openChordPatternEditor({ app: app5, glyphs, label: (k, p) => t(k, p), onListen: listenToPattern, onStop: stopListening, trackId }),
          onCards: (cardId) => openStrumCardsDialog({ app: app5, label: (k, p) => t(k, p), startId: cardId }),
          onBake: (staffId) => openBakeDialog({ app: app5, glyphs, label: (k, p) => t(k, p), staffId }),
        },
      });
      gridMode = mountGridMode({ app: app5, glyphs, label: (k, p) => t(k, p), scoreHost: $('view-host'), staffSpace: Math.max(staffSpace, 18), onChange: () => { mounted?.refresh(); entryBar?.refresh(); } });
      entryBar = mountNoteEntryBar($('entry-host'), { app: app5, glyphs, label: (k, p) => t(k, p), grid: gridMode, dock });
      recordWindow?.destroy(); measurePill?.destroy();
      // pre-rendered backing for takes (needs the SoundFont engine: the light engine is already as fast as a key can be): the music of the measures around the take is
      // rendered once by the SoundFont engine on a virtual clock (`audio/prerender.js`), then played as a plain buffer by a light engine that also plays the clicks and the keys
      let recordEngine = null;
      const backingApi = {
        available: () => !!engineManager && engineManager.state().active === 'soundfont' && typeof createWebAudioEngine === 'function',
        engine: () => { if (!recordEngine) { recordEngine = createWebAudioEngine(); } recordEngine.setOutputGain?.(engineManager.outputDb()); recordEngine.unlock?.(); return recordEngine; },
        setLive: (e) => { liveEngine = e; },
        async prepare({ target, signal, onProgress, before = 2, after = 2 }) {
          const fonts = await engineManager.activeFontData();
          if (!fonts.length) throw Object.assign(new Error('no font'), { code: 'nofont' });
          const mi = work.movements.indexOf(target.movement);
          const seq = buildSequence(work, { ...options, mixer: { ...options.mixer, ...app5?.playbackMixer() }, speed: 1, playRepeats: false, strumCards: app5?.preferences.get('strumCards')?.items, chordPatterns: app5?.preferences.get('chordPatterns')?.items, chordSymbols: { ...options.chordSymbols, play: app5?.preferences.get('playback')?.chordSymbols !== false } });
          const trackId = app5.doc.parentOf(target.staffId)?.id;
          for (const tr of seq.tracks) if (tr.id === trackId) tr.mixer = { ...tr.mixer, mute: true }; // the part being recorded is not heard: it is about to be rewritten
          const slot = (m) => seq.slots.find((x) => x.movement === mi && x.measure === m);
          const first = slot(Math.max(0, target.fromMeasure - before)); const last = slot(Math.min(target.movement.masterbars.length - 1, target.toMeasure - 1 + after));
          const at = slot(target.fromMeasure);
          if (!first || !last || !at) throw Object.assign(new Error('no timing'), { code: 'notiming' });
          const out = await renderBacking({ sequence: seq, from: first.t, to: last.end, Core: { SpessaSynthProcessor, SoundBankLoader }, fonts, sampleRate: 44100, onProgress, signal, yieldToUi: () => new Promise((r) => setTimeout(r, 0)) });
          return { buffer: { left: out.left, right: out.right, sampleRate: out.sampleRate }, lead: at.t - first.t };
        },
      };
      recordWindow = mountRecordWindow({ app: app5, getEngine: () => engine, backing: backingApi, pianoDrawer, midi: midiInput, dock, label: (k, p) => t(k, p), storage: browserStorage, onMessage: (m) => entryBar?.message(m) });
      measurePill = mountMeasurePill({ app: app5, player, label: (k, p) => t(k, p) }); // the number of the measure on a tablet / phone, where the top bar has no room for it
      // a key of the on-screen piano / a position of the fretboard also writes the note while notes are being entered (the fretboard shows the staff written to)
      const entryApp = app5; const entryMounted = mounted;
      pianoDrawer.setEntry({
        press: (played) => {
          try { entryApp.playedNoteOn(played); entryBar?.message(''); } catch (err) { const text = entryMounted.describeError(err); if (text === null) throw err; entryBar?.message(text); }
        },
        release: (d) => entryApp.playedNoteOff(d.midi),
        context: () => entryApp.fretboardContext(),
        subscribe: (fn) => entryApp.onNoteEntryChange(fn),
      });
      mounted.setShowMuted(ui.get('showMuted'));
      mounted.setShowHidden(ui.get('showHidden'));
      mounted.setShowCells(ui.get('showCells'));
      mounted.setShowTrackControls(ui.get('trackControls'));
      entryModal = mountChordEntry(view, app5, { label: (k, p) => t(k, p), glyphs, onSettings: () => settingsPanel?.open('chords') });
      playerUi = mountPlayer($('player-host'), { dock, notify: (m) => say(m), onMovement: (i) => { const id = work.movements[i]?.id; if (id) showMovement(id); }, player, view, mounted, label: (k, p) => t(k, p), available: soundAvailable, onMixer: () => { pianoDrawer.closePiano(); mixerPanel?.toggle(); }, concertPitch: dock.inHeader() ? null : { get: () => ui.get('concertPitch'), set: (on) => ui.set('concertPitch', on) },
        route: { active: () => screen === 'three' || isFour(), hideButtons: () => screen === 'three' || isFour(), play: () => { if (isFour()) { syncSession?.player.play(); return; } const sel = sheetsScreen?.selection(); if (sel?.cellId) app5.playCell(sel.sheetId, sel.cellId); }, stop: () => { if (isFour()) syncSession?.player.stop(); else app5.stopCell(); }, state: () => { if (isFour()) return { enabled: !!syncSession, playing: !!syncSession?.player.state().playing }; const sel = sheetsScreen?.selection(); return { enabled: !!sel?.cellId, playing: !!(sel?.cellId && app5.cellPlaying(sel.sheetId, sel.cellId)) }; } } });
      app5.onCellPlay(() => playerUi?.refresh?.());
      // play / stop within reach when a long score is followed and the page header scrolls away (screens 1, 2 and the sync panel of screen 4)
      mountMiniTransport({ label: (k) => t(k), anchors: () => {
        if (isFour()) { const play = document.querySelector('[data-sync-play]'); return play ? { play, stop: document.querySelector('[data-sync-stop]') } : null; }
        if (screen === 'three') return null; // the sheets have a play button in each cell
        const play = document.querySelector('[data-action="play"]');
        return play ? { play, stop: document.querySelector('[data-action="stop"]'), entry: screen === 'one' ? document.querySelector('[data-action="entry-toggle"]') : null } : null;
      } });
      // the space bar: start / stop (screen 4: the play button of the panel, which is play / pause; the sheets of screen 3 have their own buttons)
      mountSpaceKey({ toggle: () => {
        if (isFour()) { document.querySelector('[data-sync-play]')?.click(); return; }
        if (screen === 'three') return;
        document.querySelector(player.state().playing ? '[data-action="stop"]' : '[data-action="play"]')?.click();
      } });
      player.subscribe((st) => { partsScreen?.setPlayCursor(st.where && st.playing ? st.where : null, { follow: st.playing }); }); // the cursor of screen 2 (a no-op while it is not shown)
      if (excerpt?.loop) { player.setLoop(excerpt.loop); player.seekToMeasure(excerpt.loop.movement, excerpt.loop.from); }
    } else {
      const view = app5.view('main');
      view.setParams(viewParams);
      mounted.refresh();
    }
    syncChordQualityEditor();
    const view5 = app5.view('main');
    const layout = view5.isCold() ? null : view5.layout(); // a long score still being laid out (see `mountScoreView`): its statistics come with the first refresh
    const movement = current.movements[0];
    // main gauche d'accordéon (tranche 6) : la légende du système de rendu suit la partition
    $('legend-host').innerHTML = current === works.accordion ? renderSvgString(layoutAccordionLegend(glyphs, { lang }), glyphs, { staffSpace, canvasWidth }) : '';
    if (layout) { $('stats').textContent = t('demo.stats', { systems: layout.systems.length, measures: movement.masterbars.length }); document.documentElement.dataset.systems = String(layout.systems.length); } else $('stats').textContent = '';
    syncScreen();
  };

  { // the lines of a wrapped score follow the real width of the score area (rotating a tablet, resizing the window)
    let lastWidth = Math.round($('score-host').clientWidth); let timer = null;
    const onWidth = () => {
      const w = Math.round($('score-host').clientWidth);
      if (!w || Math.abs(w - lastWidth) < 8) return;
      lastWidth = w;
      if (viewMode !== 'wrap') return;
      clearTimeout(timer); timer = setTimeout(() => render(), 120);
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onWidth).observe($('score-host')); else window.addEventListener('resize', onWidth);
  }
  ui.subscribe((key, value) => {
    if (key === 'staffSpace' || key === 'concertPitch' || key === 'chordFit') render();
    else if (key === 'showChordQualities') syncChordQualityEditor();
    else if (key === 'showCells') mounted?.setShowCells(value);
    else if (key === 'showMuted') mounted?.setShowMuted(value);
    else if (key === 'trackControls') { mounted?.setShowTrackControls(value); try { browserStorage?.setItem('scorsaire.trackControls', value ? '1' : '0'); } catch { /* kept for this page only */ } }
    else if (key === 'showHidden') mounted?.setShowHidden(value);
    else if (key === 'tabKeyboard') app5?.preferences.set('inputOptions', { ...(app5.preferences.get('inputOptions') ?? {}), tabKeyboard: value });
    else if (key === 'visualSoloAudio') { app5?.setVisualSoloAudio(value); try { browserStorage?.setItem('scorsaire.visualSoloAudio', value ? '1' : '0'); } catch { /* kept for this page only */ } }
    else if (key === 'scrollMax') { scrollMaxMeasures = value; try { browserStorage?.setItem('scorsaire.scrollMaxMeasures', String(value)); } catch { /* kept for this page only */ } render(); }
  });
  { // the user's chord display: a change starts every layout again
    let last = JSON.stringify(preferences.get('chordDisplay') ?? null);
    preferences.subscribe(() => { const now = JSON.stringify(preferences.get('chordDisplay') ?? null); if (now !== last) { last = now; setUserStyleLayer(userChordLayer()); render(); partsScreen?.refresh?.(); } });
  }
  { // the soprano saxophone photograph is a device setting: a change redraws the score
    let lastPhoto = preferences.get('instrumentIcons')?.sopranoPhoto !== false;
    preferences.subscribe(() => { const now = preferences.get('instrumentIcons')?.sopranoPhoto !== false; if (now !== lastPhoto) { lastPhoto = now; render(); } });
  }
  // the editor of the placement of the quality / bass against the root letter (opened from Settings › Chords)
  let cpEditor = null; let cpApp = null;
  const openChordPlacement = () => {
    if (!app5) return;
    if (!cpEditor || cpApp !== app5) { cpEditor?.destroy(); cpEditor = mountChordPlacementEditor(app5, { glyphs, label: (k, p) => t(k, p) }); cpApp = app5; }
    cpEditor.open();
  };
  // file: open / save a .scorsaire file (JSON); the work is replaced as a whole, history and view state restart
  const say = (text) => { const f = $('fileInfo'); f.title = ''; f.textContent = text; };
  /** True when an audio synchronisation is open for the current work and its map no longer fits the measures. */
  const syncBroken = () => !!syncSession && syncSession.mode !== 'placements' && syncSession.work === current && !!app5 && !syncStructureMatches(app5.doc.work, syncSession.measureIds);
  const updateSyncWarning = () => {
    const el = $('sync-warning'); if (!el) return;
    const broken = syncBroken();
    el.style.display = broken && isFour() ? '' : 'none';
    if (broken) { const d = syncStructureDiff(app5.doc.work, syncSession.measureIds); el.textContent = t('sync.warning', { added: String(d.added), removed: String(d.removed) }); }
  };
  /** The `.scorsaire` file of the score alone: a ZIP with `score.json` (and `images/` when the score uses pictures). Reading still accepts the plain JSON text of older files. */
  const scoreArchive = () => buildScorsaireArchive({ scoreText: workToFileText(app5.doc.work), images: usedAssets(app5.doc.work) });
  let portalExternals = new Map(); // portal mode: id of an audio track → the reference the portal gave it
  let portalSaving = false;
  /** PORTAL MODE: writes the score back on the server (same score, a new version). Every refusal is explained; nothing is lost (a copy can always be saved to the device). */
  const portalSave = async () => {
    if (!app5 || current === 'legend' || portalSaving) return;
    if (portal.formatTooNew()) { say(t('portal.formatTooNew', { v: String(FILE_VERSION), max: String(portal.address.fmax) })); return; }
    if (syncBroken()) { say(t('portal.syncBroken')); return; } // writing the file now would lose the audio map
    portalSaving = true;
    try {
      say(t('portal.saving'));
      let archive;
      try { archive = (await buildSyncArchive(null, { keepExternals: portalExternals })) ?? (await scoreArchive()); } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); return; }
      let res = await portal.save(archive);
      if (!res.ok && res.status === 409 && res.code === 'passages_cites') { // passages quoted by students' notes would disappear: the teacher decides
        const list = res.movements.map((m) => `${m.titre ?? m.id} (${m.nbNotes ?? '?'})`).join(', ');
        const go = await confirmDialog({ message: `${res.error || t('portal.citedDefault')}${list ? `\n${list}` : ''}`, label: (k, p) => t(k, p), confirmText: t('portal.saveAnyway'), cancelText: t('dialog.cancel') });
        if (!go) { say(t('portal.notSaved')); return; }
        res = await portal.save(archive, { confirm: true });
      }
      if (res.ok) { app5.doc.markClean(); say(t('portal.saved', { version: res.version == null ? '' : String(res.version) })); return; }
      const message = res.network ? t('portal.network') : res.code === 'noEtag' ? t('portal.noEtag') : res.error || t('portal.refused', { status: String(res.status) });
      if (res.network || res.status === 401 || (res.status === 409 && res.code === 'modifiee_ailleurs')) { // work to keep: a copy of the file is offered
        const copy = await confirmDialog({ message: `${message}\n${t(res.status === 401 ? 'portal.reopen' : res.network ? 'portal.tryAgain' : 'portal.reloadAfter')}`, label: (k, p) => t(k, p), confirmText: t('portal.saveCopy'), cancelText: t('portal.close') });
        if (copy) await saveToDisk();
        else say(message);
      } else say(message);
    } finally { portalSaving = false; }
  };
  /** Save: to the portal in portal mode, else a file. */
  const saveFile = async () => (portal ? portalSave() : saveToDisk());
  /** PORTAL MODE: back to the portal (the page asked for `return`), asking first when there are changes. */
  const backToPortal = async () => {
    if (!(await confirmReplace())) return;
    if (portal.address.returnTo) { window.removeEventListener('beforeunload', onBeforeUnload); location.assign(portal.address.returnTo); return; }
    try { window.close(); } catch { /* the page was not opened by the portal */ }
    say(t('portal.closeTab'));
  };
  // closing the page (or the installed app) with unsaved changes: the browser asks first (its own wording), and the work is also copied to a DRAFT that the next launch offers to take back
  const onBeforeUnload = (e) => { if (app5 && !app5.doc.isClean()) { autosave?.flush(); e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBeforeUnload);
  const draftStore = createDraftStore();
  // the text of the last CLEAN state of the work (as opened or as last saved): kept with the draft, so that the next launch can tell what the draft changes, and drop one that changes nothing
  let baseText = null;
  function rememberBase() { if (!app5 || current === 'legend' || !app5.doc.isClean()) return; try { baseText = workToFileText(app5.doc.work); } catch { baseText = null; } }
  const autosave = portal ? null : createAutosave({ // (never in portal mode: the score belongs to the portal's library)
    store: draftStore,
    isDirty: () => !!app5 && current !== 'legend' && !app5.doc.isClean(),
    snapshot: () => (app5 && current !== 'legend' ? { name: openedName ?? suggestFileName(app5.doc.work, null), text: workToFileText(app5.doc.work), base: baseText } : null),
  });
  window.addEventListener('pagehide', () => autosave?.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave?.flush(); });
  /** At launch: a draft left by a closed tab or a crash is offered back (once the person answers, it is taken back or forgotten). */
  /** Puts the work of a draft back on screen (the last clean state stays the reference: the restored work is not saved anywhere yet). */
  const restoreDraft = (draft) => {
    try {
      const work = workFromFileText(draft.text);
      works.opened = work; openedName = draft.name || null; excerpt = null; excerptMenu.set('');
      workMenu.set('opened'); current = work;
      render();
      baseText = draft.base ?? null;
      app5?.doc.markDirty(); const f = $('fileInfo'); f.textContent = '●'; f.title = t('file.modified'); // it is not saved anywhere yet: closing still asks
      say(t('draft.restored'));
    } catch { autosave.clear(); say(t('draft.unreadable')); }
  };
  /**
   * Before a piece is opened FROM AN ADDRESS (a link sent by someone, `#file=`) when the page has just started: an unsaved draft of the person's own work would be overwritten by the next autosave.
   * They choose: take their draft back (the link stays in the address, a reload opens it later), open the piece and give the draft up, or do nothing. Returns true when the piece may be opened.
   */
  const guardDraftBeforeOpening = async () => {
    if (!autosave) return true;
    const draft = await draftStore.get(); if (!draft) return true;
    if (describeDraftChange(draft.base, draft.text).identical === true) { await autosave.clear(); return true; }
    const answer = await confirmDialog({ message: t('draft.beforeOpening', { name: draft.name || t('draft.untitled'), when: new Date(draft.savedAt).toLocaleString(lang) }), label: (k, p) => t(k, p), confirmText: t('draft.beforeOpening.keep'), secondaryText: t('draft.beforeOpening.open'), cancelText: t('dialog.cancel') });
    if (answer === 'secondary') { autosave.clear(); return true; }
    if (answer) restoreDraft(draft);
    return false;
  };
  const offerDraft = async () => {
    if (!autosave) return;
    const draft = await draftStore.get();
    if (!draft) return;
    const when = new Date(draft.savedAt).toLocaleString(lang);
    const change = describeDraftChange(draft.base, draft.text);
    if (change.identical === true) { await autosave.clear(); return; } // the draft changes nothing compared with the last clean state: no use asking
    const changes = change.identical === false ? [change.measures ? t('draft.diff.measures', { n: change.measures }) : null, change.other ? t('draft.diff.other') : null].filter(Boolean).join(', ') : '';
    const yes = await confirmDialog({ message: changes ? t('draft.foundWith', { name: draft.name || t('draft.untitled'), when, changes }) : t('draft.found', { name: draft.name || t('draft.untitled'), when }), label: (k, p) => t(k, p), confirmText: t('draft.restore'), cancelText: t('draft.discard') });
    if (!yes) { autosave.clear(); return; }
    restoreDraft(draft);
  };
  const saveToDisk = async () => {
    if (!app5 || current === 'legend') return;
    if (syncLeftOut && syncLeftOut === current && !(syncSession && syncSession.work === current)) { // the file had a synchronisation whose audio was not loaded: what is written would be the score alone
      const ok = await confirmDialog({ message: t('sync.leftOut'), label: (k, p) => t(k, p), confirmText: t('sync.saveScoreOnly'), cancelText: t('sync.saveCancel') });
      if (!ok) { say(t('sync.leftOutRefused')); return; }
    }
    let name = suggestFileName(app5.doc.work, openedName);
    let archive = null;
    if (syncBroken()) { // the map no longer fits the measures: writing the ZIP would lose the audio, so nothing is written unless the user chooses to save the score alone
      const diff = syncStructureDiff(app5.doc.work, syncSession.measureIds);
      const ok = await confirmDialog({ message: t('sync.saveBlocked', { added: String(diff.added), removed: String(diff.removed) }), label: (k, p) => t(k, p), confirmText: t('sync.saveScoreOnly'), cancelText: t('sync.saveCancel') });
      if (!ok) { say(t('sync.saveRefused')); return; }
      name = scoreOnlyName(name);
      archive = await scoreArchive();
      downloadBlob(name, new Blob([archive], { type: 'application/zip' }));
      app5.doc.markClean(); rememberBase(); autosave?.clear(); say(t('sync.savedScoreOnly', { name })); return;
    }
    try { archive = await buildSyncArchive(); } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); return; }
    if (!archive) archive = await scoreArchive(); // a score alone is a ZIP too (`score.json` + the pictures it uses): ONE format, the one the school portal reads
    downloadBlob(name, new Blob([archive], { type: 'application/zip' }));
    app5.doc.markClean(); rememberBase(); autosave?.clear();
    say(t('file.saved', { name }));
  };
  // new score: the assistant builds a whole work; it replaces the document like an opened file
  const newScoreAssistant = createNewScoreAssistant({
    label: (k, p) => t(k, p), lang,
    templates: () => templateCatalog(preferences, lang),
    findTemplate: (id) => findTemplate(preferences, id),
    onCreate: (options) => {
      const work = createScore(options); // throws NewScoreError(code) on invalid options: the assistant shows it
      works.opened = work; openedName = null; excerpt = null; excerptMenu.set('');
      workMenu.set('opened'); current = work;
      render();
      say(t('file.created'));
    },
  });
  /** True when the work that is open may be replaced: nothing to lose, or the user chose to save it, or not to. */
  const confirmReplace = async () => {
    if (!app5 || current === 'legend' || app5.doc.isClean()) return true;
    const answer = await confirmDialog({ message: t('file.saveFirst'), label: (k, p) => t(k, p), confirmText: t('file.saveAndContinue'), secondaryText: t('file.dontSave') });
    if (answer === 'secondary') { autosave?.clear(); return true; } // given up on purpose: no draft to take back
    if (!answer) return false;
    await saveFile();
    return app5.doc.isClean(); // the save may have been refused (e.g. a map that no longer fits): then nothing is replaced
  };
  const newFile = async () => {
    if (portal) { say(t('portal.notHere')); return; } // portal mode: the score belongs to the portal's library
    if (!(await confirmReplace())) return;
    newScoreAssistant.open();
  };
  // exports: the score as an SVG file, the music as a Standard MIDI File (nothing is written in the Document)
  const exportOptions = [['', t('file.export')], ['svg', t('file.exportSvg')], ['midi', t('file.exportMidi')], ['musicxml', t('file.exportMusicXml')], ['mxl', t('file.exportMxl')], ['gp', t('file.exportGp')], ['audio', t('file.exportAudio')], ['chords', t('file.exportChords')], ['syncvideo', t('file.exportSyncVideo')], ['syncvideosound', t('file.exportSyncVideoSound')], ['syncportal', t('file.exportSyncPortal')], ['youtubevideo', t('file.exportYoutubeVideo')], ['youtubepage', t('file.exportYoutubePage')], ['github', t('file.exportGithub')], ['recueil-new', t('file.exportRecueilNew')], ['recueil-add', t('file.exportRecueilAdd')]];
  /** The page of the reader for the current work, as the HTML export writes it (`sheetId`: the sheet it opens on, used by the preview of screen 3). */
  const readerPageFor = (sheetId = null, { preview = !!sheetId } = {}) => {
    const template = embeddedReaderTemplate(); if (!template || !app5) return null;
    const page = readerPageHtml(template, workToFileText(app5.doc.work), { title: app5.doc.work.props?.title ?? '', images: Object.fromEntries(usedAssets(app5.doc.work).map((a) => [a.id, { mime: a.mime, data: assetHref(a.id, { inline: true }) }])), theme: preview ? document.documentElement.getAttribute('data-theme') : null }); // the preview follows the editor's theme, the exported file stays light
    return sheetId ? page.replace('</head>', () => `<script>window.__scorsaireSheet=${JSON.stringify(sheetId)}</script></head>`) : page;
  };
  const exportReaderFile = (v) => {
    if (!app5 || current === 'legend') return;
    const stem = suggestFileName(app5.doc.work, openedName).replace(/\.scorsaire$/, '');
    const template = embeddedReaderTemplate();
    if (v === 'reader') downloadBlob(`${stem}.html`, new Blob([readerPageHtml(template, workToFileText(app5.doc.work), { title: app5.doc.work.props?.title ?? '', images: Object.fromEntries(usedAssets(app5.doc.work).map((a) => [a.id, { mime: a.mime, data: assetHref(a.id, { inline: true }) }])) })], { type: 'text/html' }));
    else downloadBlob('scorsaire-lecteur.html', new Blob([readerOnlyHtml(template)], { type: 'text/html' }));
    say(t('file.exported', { name: v === 'reader' ? `${stem}.html` : 'scorsaire-lecteur.html' }));
  };
  /** The current work as an entry of a recueil (songbook): its text and its pictures. */
  const workAsEntry = () => ({
    title: app5.doc.work.props?.title ?? '', workText: workToFileText(app5.doc.work),
    images: Object.fromEntries(usedAssets(app5.doc.work).map((a) => [a.id, { mime: a.mime, data: assetHref(a.id, { inline: true }) }])),
  });
  /** `recueil-new`: a recueil holding this work; `recueil-add`: this work added to a recueil file the person picks (written back under the same name). */
  const exportRecueil = async (v) => {
    try {
      let recueil; let name;
      if (v === 'recueil-add') {
        const file = await pickFile(); if (!file) return;
        recueil = parseRecueil(new TextDecoder().decode(file.bytes)); name = file.name;
      } else {
        recueil = createRecueil({ title: app5.doc.work.props?.title ?? '' }); name = `${suggestFileName(app5.doc.work, openedName).replace(/\.scorsaire$/, '')}.scorsaire-recueil`;
      }
      recueil = addEntry(recueil, workAsEntry()).recueil;
      downloadBlob(name, new Blob([serializeRecueil(recueil)], { type: 'application/json' }));
      say(t('file.recueilWritten', { name, n: recueil.entries.length }));
    } catch (e) { say(t('file.exportError', { message: e?.message ?? String(e) })); }
  };
  // ---- the RECUEIL window (setlist): the recueil lives in the memory of the page; the window edits it (order, titles, reading adjustments) and writes the file
  const recueilState = { recueil: null, name: null, dirty: false };
  const dataUriBytes = (uri) => Uint8Array.from(atob(String(uri).split(',')[1] ?? ''), (c) => c.charCodeAt(0));
  /** A work file picked from the disk (a `.scorsaire` text or ZIP) as the parts of a recueil entry. */
  const entryFromBytes = async (file) => {
    if (isScorsaireArchive(file.bytes)) {
      const r = await readScorsaireArchive(file.bytes);
      return { title: '', workText: r.scoreText, images: Object.fromEntries(r.images.map((im) => [im.id, { mime: im.mime, data: `data:${im.mime};base64,${btoa(String.fromCharCode(...im.bytes))}` }])) };
    }
    const text = new TextDecoder().decode(file.bytes);
    workFromFileText(text); // refuses what is not a Scorsaire work
    return { title: '', workText: text, images: {} };
  };
  const recueilActions = {
    openRecueil: async () => {
      const file = await pickFile(); if (!file) return '';
      recueilState.recueil = parseRecueil(new TextDecoder().decode(file.bytes)); recueilState.name = file.name; recueilState.dirty = false;
      return t('recueil.opened', { name: file.name, n: recueilState.recueil.entries.length });
    },
    addFiles: async () => { // Scorsaire works, iReal Pro files (a setlist: the songs are ticked in a list) and other recueils (their works are added): all in one gesture, the recueil is made if there is none
      const files = await pickFiles({ accept: '.scorsaire,.scorsaire-recueil,.json,.html,.htm,.txt,application/json,text/html' }); if (!files.length) return '';
      let r = recueilState.recueil ?? createRecueil(); const wasEmpty = !r.entries.length; let added = 0; const failed = []; let setlist = '';
      const known = new Set(r.entries.map((e, i) => entryTitle(e, i).trim().toLowerCase())); const duplicates = new Set();
      const put = (entry) => { const k = (entry.title || '').trim().toLowerCase(); if (k && known.has(k)) duplicates.add(entry.title); if (k) known.add(k); r = addEntry(r, entry).recueil; added += 1; };
      for (const f of files) {
        try {
          const textLike = !(f.bytes[0] === 0x50 && f.bytes[1] === 0x4b);
          const text = textLike ? new TextDecoder().decode(f.bytes) : null;
          if (text && isRecueilText(text)) { for (const e of parseRecueil(text).entries) put({ title: e.title, workText: e.work, images: e.images, settings: e.settings }); continue; } // another recueil: its works join this one
          if (text && looksLikeIreal(text)) {
            const songs = irealSongs(text);
            const picked = songs.length === 1 ? { songs, merge: false } : await pickSong({ songs, label: (k, p) => t(k, p), multiple: true });
            if (!picked) continue; // the user gave up the choice
            const chosen = picked.merge && picked.songs.length > 1 ? [mergeIrealSongs(picked.songs)] : picked.songs; // « Merge »: the parts of one long song (iReal Pro has no two-page chart) become ONE work
            if (!setlist) setlist = irealPlaylistName(text);
            for (const song of chosen) {
              try { const imp = importIrealSong(song, { lang }); if (imp.errors.length) throw new Error(imp.errors[0]); put({ title: song.title ?? '', workText: workToFileText(imp.work), images: {} }); } catch { failed.push(song.title || f.name); }
            }
            continue;
          }
          put(await entryFromBytes(f));
        } catch { failed.push(f.name); }
      }
      if (wasEmpty && !r.title && setlist) r = renameRecueil(r, setlist); // a setlist of iReal Pro gives its name to the new recueil
      recueilState.recueil = r; if (added) recueilState.dirty = true;
      const tail = duplicates.size ? ` ${t('recueil.duplicates', { names: [...duplicates].slice(0, 5).join(', ') })}` : '';
      return (failed.length ? t('recueil.addedSome', { n: added, failed: failed.join(', ') }) : t('recueil.added', { n: added })) + tail;
    },
    addCurrent: async () => {
      if (!app5) return t('recueil.nothingOpen');
      recueilState.recueil = addEntry(recueilState.recueil, { ...workAsEntry(), title: '' }).recueil; recueilState.dirty = true;
      return t('recueil.added', { n: 1 });
    },
    replaceWith: async (entryId) => {
      if (!app5) return t('recueil.nothingOpen');
      const { workText, images } = workAsEntry();
      recueilState.recueil = replaceEntryWork(recueilState.recueil, entryId, { workText, images }); recueilState.dirty = true;
      return t('recueil.replaced');
    },
    openEntry: async (entry) => {
      if (!(await confirmReplace())) return false;
      const work = workFromFileText(entry.work);
      clearAssets(); for (const [id, im] of Object.entries(entry.images ?? {})) registerAsset({ id, mime: im.mime, bytes: dataUriBytes(im.data) });
      works.opened = work; openedName = `${sanitizeFileStem(entry.title || work.props?.title || 'recueil')}.scorsaire`; excerpt = null; excerptMenu.set(''); workMenu.set('opened'); current = work;
      render(); say(t('recueil.openedEntry', { name: openedName }));
      return true;
    },
    save: async (r) => {
      const name = recueilState.name ?? `${sanitizeFileStem(r.title || 'recueil', 'recueil')}.scorsaire-recueil`;
      downloadBlob(name, new Blob([serializeRecueil(r)], { type: 'application/json' }));
      recueilState.name = name; recueilState.dirty = false;
      return t('file.recueilWritten', { name, n: r.entries.length });
    },
  };
  /** « Send to another teacher »: the piece as a link (the editor or the Lecteur) or as a file put online; see ui/share-dialog.js. */
  const openShare = () => {
    if (portal) { say(t('portal.notHere')); return; }
    if (!app5 || current === 'legend') return;
    const videoSync = !!(syncSession?.video && syncSession.work === current);
    const audioSync = !!(syncSession && !syncSession.video && !syncSession.mode && syncSession.work === current);
    const contents = [{ id: 'score', text: t('share.contentScore'), hasAudio: false }, ...(videoSync ? [{ id: 'sync', text: t('share.contentSyncVideo'), hasAudio: false }] : []), ...(audioSync ? [{ id: 'syncaudio', text: t('share.contentSyncAudio'), hasAudio: true }] : [])];
    const bytesOf = async (blobOrBytes) => new Uint8Array(await new Blob([blobOrBytes]).arrayBuffer());
    openShareDialog({
      label: (k, p) => t(k, p), contents, title: String(getProperty(app5.doc.work, PID.TITLE) ?? ''),
      build: async (id) => bytesOf(id === 'score' ? await scoreArchive() : (await buildSyncArchive()) ?? (await scoreArchive())),
      ...githubRepoActions(),
      download: (name, blob) => downloadBlob(name, blob),
      open: (url) => { window.open(url, '_blank', 'noopener'); },
      copy: async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } },
      share: typeof navigator !== 'undefined' && typeof navigator.share === 'function' ? (data) => navigator.share(data) : null,
    });
  };
  /** « Links for pupils »: the page of the public Lecteur site that writes the links to send (`liens/`), handed the repositories kept on this device (names only, in the fragment of the address). */
  const openPupilLinks = () => {
    if (portal) { say(t('portal.notHere')); return; }
    window.open(linksPageUrl(READER_URL, githubRepoList().map((e) => e.repo)), '_blank', 'noopener');
  };
  const openRecueil = () => {
    if (portal) { say(t('portal.notHere')); return; } // portal mode: the score belongs to the portal's library
    if (!recueilState.recueil) recueilState.recueil = createRecueil({ title: '' });
    openRecueilDialog({ state: recueilState, actions: recueilActions, label: (k, p) => t(k, p) });
  };
  /** The audio export: the movement on the screen played by the SoundFont engine on a virtual clock and written as WAV or Opus (the full mix, tracks apart, groups; several files in one zip). */
  const exportAudio = async (stem) => {
    if (!engineManager || engineManager.state().active !== 'soundfont') { say(t('audioExport.noEngine')); return; }
    const mi = app5.view('main')?.movementIndex?.() ?? 0;
    const options = excerpt?.options ?? {};
    const build = () => buildSequence(app5.doc.work, { ...options, mixer: { ...options.mixer, ...app5?.playbackMixer() }, speed: 1, playRepeats: true, strumCards: app5?.preferences.get('strumCards')?.items, chordPatterns: app5?.preferences.get('chordPatterns')?.items, chordSymbols: { ...options.chordSymbols, play: app5?.preferences.get('playback')?.chordSymbols !== false } });
    const mvTracks = new Set(app5.doc.work.movements[mi]?.tracks.map((tr) => tr.id));
    const tracks = build().tracks.filter((tr) => mvTracks.has(tr.id)).map((tr) => ({ id: tr.id, name: tr.name || tr.id }));
    const canOpus = await canEncodeOpus();
    openAudioExportDialog({
      tracks, canOpus, label: (k, p) => t(k, p),
      run: async ({ targets, format, signal, onProgress }) => {
        const fonts = await engineManager.activeFontData();
        if (!fonts.length) throw new Error(t('audioExport.noEngine'));
        const sequence = build();
        const span = sequence.movements.find((m) => m.index === mi) ?? { t: 0, end: sequence.duration };
        const render = (seq, { onProgress: progress }) => renderBacking({ sequence: seq, from: span.t, to: span.end, Core: { SpessaSynthProcessor, SoundBankLoader }, fonts, sampleRate: format.rate, onProgress: progress, signal, yieldToUi: () => new Promise((r) => setTimeout(r, 0)) });
        const encode = (buffer, fmt, { onProgress: progress }) => encodeOpus({ left: buffer.left, right: buffer.right, bitrate: fmt.bitrate, onProgress: progress, signal });
        const files = await runAudioExport({ sequence, targets, format, render, encode, signal, onProgress });
        if (files.length === 1) {
          const f = files[0]; const ext = f.name.split('.').pop();
          const name = targets[0].trackIds ? `${stem} - ${f.name}` : `${stem}.${ext}`;
          downloadBlob(name, new Blob([f.data], { type: ext === 'wav' ? 'audio/wav' : 'audio/ogg' }));
          say(t('file.exported', { name }));
        } else {
          const name = `${stem}-audio.zip`;
          downloadBlob(name, new Blob([await zipFiles(files.map((f) => ({ name: f.name, data: f.data, store: true })))], { type: 'application/zip' }));
          say(t('file.exported', { name }));
        }
      },
    });
  };
  /**
   * The page of one of the exports that hold a YouTube video, as a file: { name, blob } — for the download and for « Publish on GitHub ». The pages with audio are never made here
   * (too heavy for a web page). A refusal is an Error with `plain: true`: its message is shown as it is.
   */
  const youtubePageFile = async (v, stem, { trackIds = null, instruments = false, chords = null } = {}) => {
    const plain = (message) => Object.assign(new Error(message), { plain: true });
    const title = app5.doc.work.props?.title ?? '';
    if (v === 'syncvideo' || v === 'syncvideosound') { // a song synchronised with a YouTube video (screen 4) as ONE read-only page; the author decides whether the reader may add the sound of the score
      if (!syncSession?.video || syncSession.work !== current) throw plain(t('file.exportSyncVideoNeeds'));
      const bytes = await buildSyncArchive(null, { scoreSound: v === 'syncvideosound', trackIds, instruments, chords });
      if (!bytes) throw plain(t('sync.mismatch'));
      return { name: `${stem}-synchro.html`, blob: new Blob([synchroPageHtml(embeddedSynchroTemplate(), bytes, { title })], { type: 'text/html' }) };
    }
    if (syncSession?.mode !== 'placements' || syncSession.work !== current) throw plain(t('file.exportYoutubeNeeds'));
    const videoOnly = v === 'youtubevideo'; // two files from the same session: the video alone (fragments on it) or the full page (fragments under the video too)
    const bytes = await buildSyncArchive({ videoOnly }, { trackIds });
    return { name: `${stem}-${videoOnly ? 'video' : 'page'}.html`, blob: new Blob([youtubePageHtml(embeddedYoutubeTemplate(), bytes, { title })], { type: 'text/html' }) };
  };
  const sayExportError = (e) => say(e?.plain ? e.message : t('file.exportError', { message: e?.message ?? String(e) }));
  /** The tracks the exported page opens on: a window (nothing to ask with a single track). Resolves { ids } (ids null = the work as it is) or null when the person cancels. */
  const askExportTracks = async ({ offerInstruments = false } = {}) => {
    const tracks = trackChoices(app5.doc.work);
    if (tracks.length < 2 && !offerInstruments) return { ids: null, instruments: false, chords: null };
    const pools = allPoolsOf(app5.doc.work).map((p) => ({ id: p.id, name: p.name }));
    const r = await chooseExportTracks({ tracks, chosen: syncSession?.exportTracks ?? null, label: (k, p) => t(k, p),
      instruments: offerInstruments ? syncSession?.exportInstruments === true : null,
      chords: offerInstruments ? { on: !!syncSession?.exportChords, pool: syncSession?.exportChords?.pool ?? 'reader', variants: syncSession?.exportChords?.variants, groups: syncSession?.exportChords?.groups, pools: [{ id: 'main', name: t('syncreader.chordsMainPool') }, ...pools] } : null });
    if (!r) return null;
    if (syncSession) { syncSession.exportTracks = r.ids; if (offerInstruments) { syncSession.exportInstruments = r.instruments; syncSession.exportChords = r.chords; } } // kept for this session: the next export and « Publish on GitHub » start from it
    return { ids: r.ids, instruments: offerInstruments && r.instruments, chords: offerInstruments ? r.chords : null };
  };
  /** « Publish on GitHub » (no token): the person downloads the page, drops it on their repository, copies its address. */
  const publishOnGithub = (stem) => {
    // the first kind is the one the window starts on: for a video synchro, the page where the reader may add the sound of the score
    const video = syncSession?.video && syncSession.work === current ? [['syncvideosound', t('githubPublish.kind.syncvideosound')], ['syncvideo', t('githubPublish.kind.syncvideo')]]
      : syncSession?.mode === 'placements' && syncSession.work === current ? [['youtubepage', t('githubPublish.kind.youtubepage')], ['youtubevideo', t('githubPublish.kind.youtubevideo')]] : [];
    // the sheets of screen 3: the whole reader page, which opens on the sheet chosen here (the other sheets stay in it)
    const sheets = app5.doc.work.sheets ?? [];
    const sheetKinds = !embeddedReaderTemplate() ? [] : sheets.length ? sheets.map((sh, i) => [`sheet:${sh.id}`, t('githubPublish.kind.sheet', { name: sh.props?.[PID.NAME] || t('reader.sheetN', { n: i + 1 }) })]) : [['reader', t('githubPublish.kind.reader')]];
    const kinds = [...video, ...sheetKinds];
    if (!kinds.length) { say(t('file.exportGithubNeeds')); return; }
    const sheetName = (kind) => { const sh = sheets.find((x) => `sheet:${x.id}` === kind); return sh?.props?.[PID.NAME] || (sh ? `${t('reader.sheetN', { n: sheets.indexOf(sh) + 1 })}` : ''); };
    const suffix = { syncvideo: 'synchro', syncvideosound: 'synchro', youtubepage: 'page', youtubevideo: 'video', reader: 'lecteur' };
    const fileOf = (kind) => `${stem}-${kind.startsWith('sheet:') ? sheetName(kind) : suffix[kind]}.html`;
    openGithubPublish({
      label: (k, p) => t(k, p), lang, kinds, nameOf: fileOf,
      build: async (kind) => (kind === 'reader' || kind.startsWith('sheet:') ? { blob: new Blob([readerPageFor(kind === 'reader' ? null : kind.slice(6), { preview: false })], { type: 'text/html' }) } : await youtubePageFile(kind, stem, { trackIds: syncSession?.exportTracks ?? null, instruments: syncSession?.exportInstruments === true && (kind === 'syncvideo' || kind === 'syncvideosound'), chords: kind === 'syncvideo' || kind === 'syncvideosound' ? syncSession?.exportChords ?? null : null })).blob,
      tracks: video.length && (app5.doc.work.movements[0].tracks.length > 1 || syncSession?.video) ? { appliesTo: (kind) => !(kind === 'reader' || kind.startsWith('sheet:')), summary: () => { const all = trackChoices(app5.doc.work); const ids = syncSession?.exportTracks; const base = t('exportTracks.summary', { shown: ids ? ids.length : all.filter((x) => x.shown).length, total: all.length }); const more = [syncSession?.video && syncSession.exportInstruments === true ? t('exportTracks.instrumentsOn') : null, syncSession?.video && syncSession.exportChords ? t('exportTracks.chordsOn') : null].filter(Boolean); return more.length ? `${base} · ${more.join(' · ')}` : base; }, choose: async () => { await askExportTracks({ offerInstruments: !!syncSession?.video }); } } : null,
      ...githubRepoActions(),
      download: (name, blob) => downloadBlob(name, blob),
      open: (url) => { window.open(url, '_blank', 'noopener'); },
      copy: async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } },
    });
  };
  const exportHandler = (v) => {
    if (!v || !app5 || current === 'legend') return;
    if (v === 'recueil-new' || v === 'recueil-add') { exportRecueil(v); return; }
    const stem = suggestFileName(app5.doc.work, openedName).replace(/\.scorsaire$/, '');
    if (v === 'audio') { exportAudio(stem); return; }
    try {
      if (v === 'svg') {
        const svg = app5.exportSvg();
        if (!svg) return;
        downloadBlob(`${stem}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
      } else if (v === 'github') {
        publishOnGithub(stem);
        return;
      } else if (v === 'syncvideo' || v === 'syncvideosound' || v === 'youtubepage' || v === 'youtubevideo') {
        askExportTracks({ offerInstruments: v === 'syncvideo' || v === 'syncvideosound' }).then((r) => (r ? youtubePageFile(v, stem, { trackIds: r.ids, instruments: r.instruments, chords: r.chords }).then(({ name, blob }) => { downloadBlob(name, blob); say(t('file.exported', { name })); }) : undefined)).catch(sayExportError);
        return;
      } else if (v === 'syncportal') {
        // the synchronised song WITHOUT its audio, for the school portal: each track is kept as a reference (name + SHA-256) to the audio the portal already has
        const ss = syncSession;
        if (!ss || ss.mode === 'placements' || ss.video || ss.work !== current || !ss.media?.length) { say(t('file.exportSyncPortalNeeds')); return; }
        if (syncBroken()) { say(t('sync.mismatch')); return; }
        const name = `${stem}-leger.scorsaire`; const n = ss.media.length;
        buildSyncArchive(null, { external: true }).then((bytes) => {
          if (!bytes) { say(t('sync.mismatch')); return; }
          downloadBlob(name, new Blob([bytes], { type: 'application/zip' }));
          say(t('file.exportedPortal', { name, n }));
        }).catch((e) => say(t('file.exportError', { message: e?.message ?? String(e) })));
        return;
      } else if (v === 'mxl') {
        app5.exportMxl().then(({ bytes, warnings }) => {
          downloadBlob(`${stem}.mxl`, new Blob([bytes], { type: 'application/vnd.recordare.musicxml' }));
          say(warnings.length ? t('file.exportedWarnings', { name: `${stem}.mxl`, n: warnings.length }) : t('file.exported', { name: `${stem}.mxl` }));
        }).catch((e) => say(t('file.exportError', { message: e?.message ?? String(e) })));
        return;
      } else if (v === 'gp') {
        exportGuitarPro(app5.doc.work, { movement: app5.view?.('main')?.movementIndex?.() ?? 0 }).then(async ({ bytes, report }) => {
          downloadBlob(`${stem}.gp`, new Blob([bytes], { type: 'application/octet-stream' }));
          say(t('file.exported', { name: `${stem}.gp` }));
          const check = await importGuitarProBytes(bytes).then((r) => r.errors, () => ['unreadable']); // the file is read back with our own import
          if (report.items.length || check.length) openImportReport({ report, problems: check, title: t('file.exportGp'), label: (k, p) => t(k, p), summaryKey: 'import.summaryExport' });
        }).catch((e) => say(t('file.exportError', { message: e?.message ?? String(e) })));
        return;
      } else if (v === 'chords') {
        downloadBlob(`${stem}-accords.json`, new Blob([serializeChordTrack(app5.doc.work, { movement: app5.view?.('main')?.movementIndex?.() ?? 0 })], { type: 'application/json' }));
        say(t('file.exported', { name: `${stem}-accords.json` }));
        return;
      } else if (v === 'musicxml') {
        const { xml, warnings } = app5.exportMusicXml();
        downloadBlob(`${stem}.musicxml`, new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
        say(warnings.length ? t('file.exportedWarnings', { name: `${stem}.musicxml`, n: warnings.length }) : t('file.exported', { name: `${stem}.musicxml` }));
        return;
      } else {
        downloadBlob(`${stem}.mid`, new Blob([app5.exportMidi()], { type: 'audio/midi' }));
      }
      say(t('file.exported', { name: `${stem}.${v === 'svg' ? 'svg' : 'mid'}` }));
    } catch (e) { say(t('file.exportError', { message: e?.message ?? String(e) })); }
  };

  // ---- screen 4: a recording (stems + analysis) synchronised with the score built from its beat map
  const stopSync = ({ keepPlayer = false } = {}) => {
    if (!syncSession) return;
    syncSession.mapEdit?.close(); app5?.setExtraHistory?.(null); syncSession.off?.(); syncSession.panel?.destroy(); if (!keepPlayer) syncSession.player.destroy(); syncSession = null; updateSyncWarning();
    $('sync-host').replaceChildren();
    const v = app5?.view?.('main'); if (v) { v.setParams({ displayShift: 0 }); mounted?.refresh(); }
  };
  const applyDisplayShift = () => {
    const v = app5?.view?.('main'); if (!v || !syncSession) return;
    v.setParams({ displayShift: syncSession.player.state().semitones, displayFifths: parseKey(syncSession.session.key)?.fifths ?? 0 });
    mounted?.refresh();
  };
  /** The score of screen 4 re-timed on the recording (listening speed and pitch shift of the stems included). */
  // on screen 4 the chord symbols SOUND (the score is there to be compared with the recording): see the `build` of the player
  // for the end-to-end checks (Playwright): read only access to what the screens hold
  Object.defineProperty(globalThis, '__scorsaire', { configurable: true, value: { get app() { return app5; }, get player() { return player; }, get engine() { return engine; }, get sync() { return syncSession; } } });
  /** The mixer the engine gets: the one of the document and, in mode B with the check metronome on, the volume of the metronome track. */
  const playbackMixerWithClick = () => ({ ...app5.playbackMixer(), ...(syncSession?.mode === 'placements' && syncSession.session.metronome ? { metronome: { volume: syncSession.session.metronomeVolume ?? 0.6, mute: false, solo: false } } : {}) });
  const retimeScore = (seq, sy, work) => {
    const st = sy.player.state();
    if (sy.mode === 'placements') return retimePlacements(seq, sy.placements, { indexOf: (id) => work.movements.findIndex((m) => m.id === id), rate: st.rate, metronome: !!sy.session.metronome, metronomeVolume: sy.session.metronomeVolume ?? 0.6, beatsOf: (mv, mi) => { const b = work.movements[mv]?.masterbars[mi]; return b ? fToNumber(measureLengthOf(b)) * 4 : 0; } });
    const lengths = work.movements[0].masterbars.map((b) => fToNumber(measureLengthOf(b)));
    return retimeSequence(seq, sy.map, { rate: st.rate, semitones: st.semitones, lengths });
  };
  /** The score follows the recording: same position, same loop; the recording leads. */
  const slaveScore = (ss) => {
    const at = (st) => st.position / st.rate;
    const realign = (st) => { player?.refresh(); player?.seek(at(st)); };
    // the two audio clocks (stems and score) are made to agree on what is HEARD: the engine is moved to the position the stems will have when it starts
    // (its start latency included). Measured before: the score was heard 45-75 ms after the recording.
    const heardOffsetMs = () => {
      const st = ss.player.state(); const clock = engine.audioClock?.(); if (!clock || !st.playing || !engine.isPlaying()) return null;
      const ce = engine.ctxTimeOf?.(st.position / st.rate); const ps = ss.player.perfOfMedia(st.position);
      return ce == null || ps == null ? null : clock.perfOf(ce) - ps;
    };
    const alignClocks = () => {
      const st = ss.player.state(); const clock = engine.audioClock?.(); if (!clock || !st.playing || !engine.isPlaying()) return;
      const when = clock.now() + (engine.options?.startLatency ?? 0.05);
      const media = ss.player.mediaAtPerf(clock.perfOf(when));
      if (media != null) engine.seek(media / st.rate);
    };
    ss.heardOffsetMs = heardOffsetMs;
    ss.align = () => { if (ss.player.state().playing) { alignClocks(); tune(0); } };
    let tuner = null;
    const tune = (round = 0) => { // right after a start or a jump (twice), then now and then: the score moves only when it is farther away than the threshold (a move cuts the notes that sound)
      clearTimeout(tuner);
      tuner = setTimeout(() => { const off = heardOffsetMs(); if (off !== null && Math.abs(off) > (round < 2 ? 8 : 20)) alignClocks(); if (ss.player.state().playing) tune(round + 1); }, round === 0 ? 400 : round === 1 ? 800 : 6000);
    };
    ss.rateKey = ''; ss.loopKey = ''; ss.was = false;
    const offs = [
      ss.player.onSeek(() => { const st = ss.player.state(); player?.seek(at(st)); if (st.playing) { alignClocks(); tune(0); } }),
      ss.player.subscribe((st) => {
        if (!player) return;
        const rateKey = `${st.rate}|${st.semitones}|${ss.session.offsetMs}`;
        if (rateKey !== ss.rateKey) { ss.rateKey = rateKey; realign(st); if (st.playing) { alignClocks(); tune(0); } }
        const loopKey = st.loop ? `${st.loop.start}|${st.loop.end}` : '';
        if (loopKey !== ss.loopKey) {
          ss.loopKey = loopKey;
          if (st.loop) { const a = ss.map.locatePlayed(st.loop.start + 1e-3).measure; const b = ss.map.locatePlayed(st.loop.end - 1e-3).measure; player.setLoop({ movement: 0, from: ss.map.writtenOf(a), to: ss.map.writtenOf(b), ...(ss.map.order ? { slotFrom: a, slotTo: b } : {}) }); } else player.setLoop(null);
        }
        if (st.playing !== ss.was) { ss.was = st.playing; if (st.playing) { realign(st); player.play({ keepPosition: true }); alignClocks(); tune(0); } else { clearTimeout(tuner); player.pause(); } }
      }),
    ];
    return () => { for (const off of offs) off(); clearTimeout(tuner); player?.pause(); };
  };
  const updateSyncCursor = (st) => {
    const v = app5?.view?.('main'); if (!v || !syncSession || !isFour()) return;
    if (syncSession.mode === 'placements') { updatePlacementCursor(st); return; }
    const map = syncSession.getMap();
    if (!st.playing && st.position <= 0) { mounted?.setCursor(null); return; }
    const at = map.locate(st.position);
    const mb = v.movement().masterbars[at.measure];
    const position = fMul(measureLengthOf(mb), frac(Math.round(at.ratio * 1920), 1920));
    mounted?.setCursor(v.playCursor({ movement: v.movementIndex(), measure: at.measure, position }), { follow: st.playing && screen !== 'yt' }); // the YouTube editor edits the video: the page is not recentered on the fragment
  };
  /** « Video / Score alone » above the video of screen 4: in « score alone » the video is paused and a clock leads the score (exact loops and speed); the position, speed and loop pass from one to the other. */
  const mountScoreAloneBar = (ss) => {
    const bar = document.createElement('div'); bar.setAttribute('data-sync-mode-bar', ''); bar.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;font:13px var(--ui-font,sans-serif);flex:1 0 100%';
    const lab = document.createElement('span'); lab.textContent = t('syncreader.modeLabel');
    const mk = (id, text, tip) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = tip; b.setAttribute('aria-label', tip); b.setAttribute('data-sync-mode', id); b.style.cssText = 'min-height:34px;padding:0 12px;font:inherit;font-weight:var(--w-semi,600)'; b.addEventListener('click', () => set(id === 'score')); return b; };
    const bVideo = mk('video', t('syncreader.modeVideo'), t('syncreader.modeVideoTip')); const bScore = mk('score', t('syncreader.modeScore'), t('syncreader.modeScoreTip'));
    const paint = () => {
      for (const [b, on] of [[bVideo, !ss.scoreMode], [bScore, ss.scoreMode]]) { b.setAttribute('aria-pressed', String(on)); b.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; b.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : ''; }
      ss.viewer.root.style.opacity = ss.scoreMode ? '.4' : ''; ss.viewer.root.style.pointerEvents = ss.scoreMode ? 'none' : '';
      ss.viewer.setMessage?.(ss.scoreMode ? t('syncreader.modeScoreNote') : '');
    };
    function set(on) {
      if (on === ss.scoreMode) return;
      ss.scoreMode = on;
      ss.player.use(on ? 'clock' : 'video'); // the other player takes over at the same place, speed and loop
      player?.toggleLoop(ss.loopOn && on); // the video loops by itself; the clock leaves the loop to the score
      paint(); updateSyncCursor(ss.player.state());
    }
    bar.append(lab, bVideo, bScore); ss.viewer.root.before(bar); ss.scoreModeBar = bar; paint();
  };
  const mountSyncSession = () => {
    const ss = syncSession;
    if (ss.mode === 'placements') { mountPlacementSession(); return; }
    let panelHost = $('sync-host');
    if (ss.merge && !ss.merge.validated) ss.mergePanel = mountMergePanel(panelHost, { label: (k, p) => t(k, p), getState: () => mergeState(ss), onSections: (mode) => setMergeSections(ss, mode), onShift: (d) => shiftMerge(ss, d), onValidate: () => validateMerge(ss) });
    if (ss.video || ss.videoFollow) { // a song synchronised with a video (or a recording that a muted video follows): the small video on the left, the panel on the right (they stack on a narrow window)
      const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px'; row.setAttribute('data-video-row', '');
      const right = document.createElement('div'); right.style.cssText = 'flex:1 1 420px;min-width:0'; row.append(right);
      panelHost.append(row);
      const follower = !!ss.videoFollow;
      ss.viewer = mountVideoViewer(row, {
        player: follower ? ss.videoPlayer : ss.ytPlayer ?? ss.player, videos: ss.videos, videoId: follower ? ss.followVideoId : ss.session.videoId, label: (k, p) => t(k, p),
        onLoaded: () => { say(t(follower ? 'video.following' : 'video.ready')); ss.panel?.refresh(); ss.followApply?.(); }, onError: () => say(t('video.blocked')),
        onChoose: (id) => (follower ? switchFollowerVideo(ss, id) : switchVideo(ss, id)),
        ...(follower ? { playerOptions: { nativeControls: false, nativeFullscreen: false }, soundToggle: { get: () => !ss.videoPlayer.state().muted, set: (on) => ss.videoPlayer.setMuted(!on) } } : {}),
      });
      row.insertBefore(ss.viewer.root, right);
      if (ss.clock) mountScoreAloneBar(ss);
      panelHost = right;
    }
    ss.panel = mountSyncPanel(panelHost, {
      player: ss.player, getMap: ss.getMap, analysis: ss.analysis, session: ss.session, label: (k, p) => t(k, p),
      onOffset: (ms) => { ss.map = createSyncMap(ss.imp.sync.measures, { offset: ms / 1000, order: ss.imp.sync.order ?? null }); ss.panel?.retarget(); updateSyncCursor(ss.player.state()); player?.refresh(); player?.seek(ss.player.state().position / ss.player.state().rate); ss.align?.(); },
      onPitch: () => applyDisplayShift(), onKey: () => applyDisplayShift(),
      onSelection: (sel, on) => { // the score shows the markers (and the loop band, dashed while the loop is off) as soon as they are put
        if (!player) return;
        if (!sel) { player.setLoop(null); return; }
        player.setLoop({ movement: 0, from: ss.map.writtenOf(sel.a), to: ss.map.writtenOf(sel.b), ...(ss.map.order ? { slotFrom: sel.a, slotTo: sel.b } : {}) }); ss.loopOn = on; player.toggleLoop(ss.video && !ss.scoreMode ? false : on); // a video loops by itself (the score only shows the band): two loops would fight; the clock does not seek, so the score loops by itself
      },
      onPending: (m) => mounted?.setPendingMark?.(m == null ? m : ss.map.writtenOf(m)),
      onPreRoll: (sess) => { try { localStorage.setItem('scorsaire.syncPreRoll', JSON.stringify({ preRoll: sess.preRoll ?? 0, preClick: sess.preClick ?? true })); } catch { /* storage unavailable */ } },
    });
    // pre-roll: a start from rest begins N measures before the position, with a click on each beat of the lead-in (position of the measure kept)
    ss.player.setPreRoll((pos) => {
      const n = ss.session.preRoll ?? 0; if (!n) return null;
      const at = ss.map.locatePlayed(pos); if (at.before) return null; // (in PLAYED measures: a repeat's lead-in is the measures heard just before)
      const first = Math.max(0, at.measure - n);
      const from = ss.map.timeOfPlayed(first, at.ratio);
      if (!(from < pos - 1e-3)) return null;
      const clicks = [];
      if (ss.session.preClick ?? true) {
        for (let i = first; i <= at.measure; i += 1) {
          const beats = ss.imp.sync.measures[i].beats.length;
          for (let k = 0; k < beats; k += 1) { const t = ss.map.timeOfPlayed(i, k / beats); if (t >= from - 1e-6 && t < pos - 1e-3) clicks.push({ t, accent: k === 0 }); }
        }
      }
      return { from, clicks };
    });
    // a tap on a measure (it becomes the selection) also puts the recording at the start of that measure; a play then starts from there
    const v = app5.view('main'); let lastMeasure = null;
    const seekMeasure = (id) => { if (!id || id === lastMeasure) return; lastMeasure = id; const idx = v.measureIndexOf(id); if (idx >= 0) ss.player.seek(ss.map.timeOfPlayed(ss.map.playedNear(idx, ss.player.state().position), 0)); }; // a bar played twice: the pass the recording is at, or nearest to
    // choosing a RANGE of measures on the score puts the markers A (start of the first) and B (end of the last); the loop is switched on only by its button
    const markFromScore = (fromId, toId = fromId) => {
      const wa = v.measureIndexOf(fromId); const wb = v.measureIndexOf(toId); if (wa < 0 || wb < 0) return;
      const lo = Math.min(wa, wb); const hi = Math.max(wa, wb);
      const a = ss.map.playedNear(lo, ss.player.state().position); // the pass the recording is at, or nearest to; the end is its bar's first pass from there on
      ss.panel?.setSelection(a, Math.max(a, ss.map.playedFrom(hi, a)));
    };
    const offView = [v.onRangeChange((r) => { if (!r) { lastMeasure = null; return; } if (r.to && r.to.measureId !== r.from.measureId) markFromScore(r.from.measureId, r.to.measureId); seekMeasure(r.from.measureId); }), v.onMeasureChange((id) => { if (!id) { lastMeasure = null; return; } seekMeasure(id); })];
    const offScore = ss.video ? slavePlacements(ss) : slaveScore(ss);
    const offFollow = ss.videoFollow ? slaveVideoToAudio(ss) : null;
    const offCursor = ss.player.subscribe((st) => { updateSyncCursor(st); playerUi?.refresh?.(); });
    ss.off = () => { offScore(); offFollow?.(); offCursor(); for (const o of offView) o(); ss.viewer?.destroy(); ss.viewer = null; ss.scoreModeBar?.remove(); ss.scoreModeBar = null; ss.mergePanel?.destroy(); ss.mergePanel = null; };
    applyDisplayShift();
    ss.viewer?.load();
  };
  /** What a recording session needs to show a video that follows it: the videos that fit (the main one first), a muted player and the measures of the chosen one. `{}` when there is none (or the page is a file). */
  const followerExtra = (work, videos, { videoId = null, shift = 0 } = {}) => {
    if (location.protocol === 'file:') return {};
    const count = work.movements[0].masterbars.length;
    const list = followableVideos(videos, count, shift);
    if (!list.length) return {};
    const chosen = list.find((v) => v.videoId === videoId) ?? list[0];
    const lengths = work.movements[0].masterbars.map((b) => fToNumber(measureLengthOf(b)));
    const videoPlayer = createYouTubePlayer(); videoPlayer.setMuted(true); // the recording is what is heard
    return { videoFollow: true, videos: list, videoPlayer, followVideoId: chosen.videoId, videoShift: shift, vmeasures: videoMeasures(chosen.points, lengths.slice(shift, shift + chosen.points.length)) };
  };
  /** Another video of the list follows the recording (its own measure times make the correspondence). */
  const switchFollowerVideo = (ss, id) => {
    const video = ss.videos.find((v) => v.videoId === id); if (!video) return;
    const lengths = ss.work.movements[0].masterbars.map((b) => fToNumber(measureLengthOf(b)));
    ss.followVideoId = id;
    ss.vmeasures = videoMeasures(video.points, lengths.slice(ss.videoShift, ss.videoShift + video.points.length));
    ss.viewer?.load(id);
  };
  /** The muted video follows the recording: it plays, pauses, jumps and changes speed with it, at the time the measures say; a gap of more than 0.4 s is closed. */
  const slaveVideoToAudio = (ss) => {
    const vp = ss.videoPlayer; let lastSeek = 0; let lastCheck = 0;
    const target = (time) => Math.max(0, audioToVideoTime(ss.map, ss.vmeasures, ss.videoShift, time));
    const goto = (time) => { lastSeek = performance.now(); vp.seek(target(time)); };
    const apply = (st) => {
      const v = vp.state(); if (!v.loaded) return;
      if (Math.abs(v.rate - st.rate) > 0.001) vp.setRate(st.rate);
      if (st.playing && !v.playing) { goto(st.position); vp.play(); return; }
      if (!st.playing && v.playing) { vp.pause(); return; }
      const now = performance.now();
      if (st.playing && now - lastCheck > 1000) { lastCheck = now; if (Math.abs(v.position - target(st.position)) > 0.4 && now - lastSeek > 1500) goto(st.position); }
    };
    ss.followApply = () => { const st = ss.player.state(); if (vp.state().loaded) { goto(st.position); apply(st); } };
    const offs = [ss.player.subscribe(apply), ss.player.onSeek((time) => { if (vp.state().loaded) goto(time); })];
    return () => { for (const o of offs) o?.(); ss.followApply = null; try { vp.pause(); } catch { /* the player may be gone */ } };
  };
  /**
   * « Correct the map » (screen 4): move the start of ONE measure of a map that is already made (nothing is tapped again). A video keeps the start of each measure (`points` of the chosen video),
   * a recording keeps its measures; the map is rebuilt after each move. The bar (`ui/sync-edit-bar.js`) is not a window: a tap on a measure of the score chooses it (the session also puts the
   * recording at its start), and a click on every measure start can play while the recording does, so the ear judges. One undo history; « original » goes back to the map as it was opened.
   */
  const mapEditAvailable = () => { const ss = syncSession; return !!ss && ss.mode !== 'placements' && ss.work === current && (ss.video ? !!ss.videos?.length : !!ss.imp?.sync?.measures?.length); };
  const startMapEdit = () => {
    const ss = syncSession; if (!mapEditAvailable() || ss.mapEdit) return;
    const isVideo = !!ss.video; const order = ss.imp.sync.order ?? null; const v = app5.view('main');
    const video = () => ss.videos.find((x) => x.videoId === ss.session.videoId);
    const snapshot = () => (isVideo ? [...video().points] : ss.imp.sync.measures.map((m) => ({ ...m, beats: [...m.beats] })));
    const history = createMapHistory(snapshot());
    const edit = { k: null, follow: false, click: true, message: '' };
    const offset = () => (ss.session.offsetMs ?? 0) / 1000;
    const apply = (state) => { // the map is rebuilt from the new starts (a video) or measures (a recording)
      if (isVideo) {
        video().points = [...state];
        const measures = videoMeasures(video().points, playedLengthsOf(ss.work, order));
        ss.imp.sync = { ...ss.imp.sync, measures, duration: measures[measures.length - 1].end };
        ss.map = createSyncMap(measures, { offset: offset(), order });
        ss.analysis.segments = sectionSegments(ss.sections ?? [], measures);
      } else {
        const measures = state.map((m) => ({ ...m, beats: [...m.beats] }));
        ss.imp.sync = { ...ss.imp.sync, measures, duration: Math.max(ss.imp.sync.duration ?? 0, measures[measures.length - 1].end) };
        ss.map = createSyncMap(measures, { offset: offset(), order });
      }
      ss.panel?.retarget(); ss.panel?.refresh(); player?.refresh(); updateSyncCursor(ss.player.state());
    };
    const count = () => ss.map.playedCount;
    const here = () => { const at = ss.map.locatePlayed(ss.player.state().position); return at.before ? 0 : at.measure; };
    const current = () => Math.min(count() - 1, Math.max(0, edit.k ?? here()));
    const startNow = (k) => (isVideo ? video().points[k] : ss.imp.sync.measures[k].start); // raw start (the offset of the map is not in it)
    const put = (at) => { // the chosen measure starts at the raw time `at` (seconds, the offset of the map not included)
      const k = current(); const cur = startNow(k); edit.message = '';
      const next = isVideo
        ? (edit.follow ? shiftPointsFrom(video().points, k, at - cur) : movePoint(video().points, k, at).points)
        : (edit.follow ? shiftMeasuresFrom(ss.imp.sync.measures, k, at - cur) : moveMeasureStart(ss.imp.sync.measures, k, at).measures);
      const moved = isVideo ? next.some((p, i) => p !== video().points[i]) : JSON.stringify(next) !== JSON.stringify(ss.imp.sync.measures);
      if (!moved) { edit.message = t(Math.abs(at - cur) > 1e-6 ? 'syncEdit.limit' : 'syncEdit.same'); bar.refresh(); return; }
      history.push(next); apply(next); bar.refresh();
    };
    const clicker = createAnchorClicker({
      player: ss.player, times: () => ss.imp.sync.measures.map((_, i) => ss.map.timeOfPlayed(i, 0)), enabled: () => edit.click,
      getCtx: () => { edit.ctx ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(); if (edit.ctx.state === 'suspended') edit.ctx.resume?.(); return edit.ctx; },
    });
    const api = {
      info: () => {
        const k = current(); const written = ss.map.writtenOf(k);
        return { count: count(), written: written + 1, pass: ss.map.passOf(k) + 1, passes: ss.map.passesOf(written), time: ss.map.timeOfPlayed(k, 0), canUndo: history.canUndo(), changed: history.changed(), follow: edit.follow, click: edit.click, message: edit.message };
      },
      move: (ms) => put(startNow(current()) + ms / 1000),
      place: () => put(ss.player.state().position - offset()),
      listen: () => { const k = current(); ss.player.seek(Math.max(0, ss.map.timeOfPlayed(k, 0) - 1.5)); ss.player.play(); },
      step: (d) => { edit.k = Math.min(count() - 1, Math.max(0, current() + d)); edit.message = ''; ss.player.seek(ss.map.timeOfPlayed(edit.k, 0)); bar.refresh(); },
      undo: () => { if (!history.canUndo()) return; apply(history.undo()); edit.message = ''; bar.refresh(); },
      original: () => { if (!history.changed()) return; apply(history.reset()); edit.message = t('syncEdit.restored'); bar.refresh(); },
      setFollow: (on) => { edit.follow = !!on; },
      setClick: (on) => { edit.click = !!on; },
      close: () => ss.mapEdit?.close(),
    };
    const bar = mountSyncEditBar({ label: (k, p) => t(k, p), api });
    // a tap on a measure of the score chooses it (the session has already put the recording at its start)
    const choose = (id) => { const w = id ? v.measureIndexOf(id) : -1; if (w >= 0) { edit.k = ss.map.playedNear(w, ss.player.state().position); edit.message = ''; bar.refresh(); } };
    const offViews = [v.onMeasureChange(choose), v.onRangeChange((r) => { if (r?.from) choose(r.from.measureId); })]; // a tap on a measure chooses it (as a measure or as a range of one)
    const offPlayer = ss.player.subscribe(() => { if (edit.k === null) bar.refresh(); });
    clicker.start();
    ss.mapEdit = {
      close() { clicker.stop(); try { edit.ctx?.close?.(); } catch { /* already closed */ } for (const o of offViews) o?.(); offPlayer?.(); bar.destroy(); ss.mapEdit = null; if (history.changed()) say(t('syncEdit.finished')); },
    };
  };
  /** The song is synchronised with another video of its list: the map is built again from that video's measure times (its offset starts again at 0). */
  const switchVideo = (ss, id) => {
    const video = ss.videos.find((v) => v.videoId === id); if (!video) return;
    const order = ss.imp.sync.order ?? null;
    const measures = videoMeasures(video.points, playedLengthsOf(ss.work, order));
    ss.session.videoId = id; ss.session.offsetMs = 0;
    ss.imp.sync = { ...ss.imp.sync, measures, duration: measures[measures.length - 1].end };
    ss.map = createSyncMap(measures, { order });
    ss.clock?.setDuration(ss.map.end());
    ss.analysis.segments = sectionSegments(ss.sections ?? [], measures);
    ss.panel?.retarget(); ss.panel?.refresh(); player?.refresh();
    ss.viewer?.load(id);
  };
  /** Starts screen 4 for `work` synchronised with a YouTube video: `videos` = [{ videoId, feature, points }] (those that fit the measures, the main one first). Needs a page served over http(s). */
  /** The length of every PLAYED measure (in whole notes): those of the bars of the score, in the order a recording with repeats plays them (`order`), else the bars themselves. */
  const playedLengthsOf = (work, order = null) => { const lengths = work.movements[0].masterbars.map((b) => fToNumber(measureLengthOf(b))); return order ? order.map((w) => lengths[w] ?? 1) : lengths; };
  const startVideoSession = ({ work, videos, videoId = null, offsetMs = 0, key = 'C major', sections = [], measures = null, order = null }) => {
    const bars = work.movements[0].masterbars;
    const chosen = videos.find((v) => v.videoId === videoId) ?? videos[0];
    const list = measures ?? videoMeasures(chosen.points, playedLengthsOf(work, order));
    stopSync();
    const ytPlayer = createYouTubePlayer(); const clock = createClockPlayer(); // « score alone »: a clock can lead the score instead of the video (the same switch as the page of the synchro reader)
    syncSession = {
      video: true, work, ytPlayer, clock, scoreMode: false, loopOn: false, player: createSwitchPlayer({ video: ytPlayer, clock }), videos, sections, session: { key, offsetMs, preRoll: 0, preClick: false, videoId: chosen.videoId },
      map: createSyncMap(list, { offset: offsetMs / 1000, order }), analysis: { segments: sectionSegments(sections, list) }, imp: { sync: { measures: list, order, key, duration: list[list.length - 1].end, bpm: null } },
      media: [], playable: [], measureIds: bars.map((b) => b.id), panel: null, off: null, getMap: null,
    };
    syncSession.getMap = () => syncSession.map;
    clock.setDuration(syncSession.map.end());
    screen = 'four'; screenMenu.set('four'); dockScreen.setValue?.('four'); fileDrawer?.setScreen('four');
    syncScreen();
  };
  // ---- mode B: a video (YouTube) with fragments of score (movements) placed on its timeline
  const slotsOfMovement = (ss, index) => {
    ss.slots ??= buildSequence(ss.work, { speed: 1, playRepeats: false }).slots;
    return ss.slots.filter((s) => s.movement === index);
  };
  const showPlacementMovement = (ss, movementId) => {
    const v = app5?.view?.('main'); if (!v || v.movementId() === movementId) return false;
    if (v.setMovementId(movementId)) { mounted?.refresh(); return true; }
    return false;
  };
  const updatePlacementCursor = (st) => {
    const ss = syncSession; const v = app5?.view?.('main'); if (!ss || !v) return;
    const p = placementAt(ss.placements, st.position);
    if (!p) { mounted?.setCursor(null); return; }
    if (st.playing) showPlacementMovement(ss, p.movementId); // while it plays the score shows the fragment that is on the video
    if (v.movementId() !== p.movementId) { mounted?.setCursor(null); return; }
    const index = v.movementIndex();
    const map = placementMap(slotsOfMovement(ss, index), p); if (!map) return;
    const at = map.locate(st.position);
    const mb = v.movement().masterbars[at.measure];
    const position = fMul(measureLengthOf(mb), frac(Math.round(at.ratio * 1920), 1920));
    mounted?.setCursor(v.playCursor({ movement: index, measure: at.measure, position }), { follow: st.playing && screen !== 'yt' }); // the YouTube editor edits the video: no recentering on the fragment
  };
  /** The score of mode B follows the video: the same position (minus the delay of the sound), the speed, play / pause (a video that waits for its data stops it). */
  const slavePlacements = (ss) => {
    // the engine starts (or jumps) `startLatency` after it is asked: it is asked to go there ahead, so that it is where the video is when it starts
    const ahead = () => engine.options?.startLatency ?? 0.05;
    const at = (st) => (st.position - (ss.video ? 0 : (ss.session.offsetMs ?? 0) / 1000)) / st.rate; // a song synchronised with a video has its offset in its map
    const goto = (st) => player?.seek(at(st) + ahead());
    let was = false; let rateKey = null; let off = 0; let startedAt = 0; let phase = 2;
    const run = (st) => st.playing && !st.buffering;
    const offs = [
      ss.player.onSeek(() => { const st = ss.player.state(); if (run(st)) goto(st); else player?.seek(at(st)); }),
      ss.player.subscribe((st) => {
        if (!player) return;
        if (rateKey !== null && st.rate !== rateKey) { player.refresh(); goto(st); }
        rateKey = st.rate;
        if (run(st) !== was) { was = run(st); off = 0; if (was) { player.refresh(); goto(st); player.play({ keepPosition: true }); startedAt = performance.now(); phase = 0; } else player.pause(); return; }
        // two finer checks just after a start (the engine and the video do not start at exactly the same instant): a gap of more than 25 ms is closed at once
        if (was && phase < 2 && performance.now() - startedAt > (phase === 0 ? 500 : 1500)) { phase += 1; if (Math.abs(player.state().position - at(st)) > 0.025) { goto(st); return; } }
        // the two clocks are checked while it plays: a gap of more than 100 ms seen twice in a row is corrected (one reading of the video can be a little off)
        if (was) { if (Math.abs(player.state().position - at(st)) > 0.1) { off += 1; if (off >= 2) { off = 0; goto(st); } } else off = 0; }
      }),
    ];
    return () => { for (const o of offs) o(); player?.pause(); };
  };
  const mountPlacementSession = () => {
    const ss = syncSession;
    const movements = () => (app5?.tracksOutline() ?? []).map((m) => ({ id: m.id, title: m.title, number: m.cardNumber }));
    const prune = () => { const ids = movements().map((m) => m.id); const kept = ss.placements.filter((p) => ids.includes(p.movementId)); if (kept.length !== ss.placements.length) { ss.placements = kept; ss.panel?.refresh(); } ss.slots = null; };
    // undo / redo of the session (placements, banner, options): the same buttons and Ctrl+Z as the Document's
    ss.history = createSessionHistory({
      read: () => ({ placements: ss.placements, notes: ss.session.notes ?? [], display: ss.session.display ?? null, reader: ss.session.reader ?? null, styles: ss.session.styles ?? null, offsetMs: ss.session.offsetMs ?? 0 }),
      write: (v) => { ss.placements = v.placements; ss.session.notes = v.notes; ss.session.display = v.display ?? undefined; ss.session.reader = v.reader ?? undefined; ss.session.styles = v.styles ?? undefined; ss.session.offsetMs = v.offsetMs; player?.refresh(); ss.panel?.refresh(); ss.panel?.redrawPreview(); },
    });
    app5.setExtraHistory(ss.history);
    // on a computer: left = preview, timeline (as wide as the preview), score canvas; right = fragments navigator and options
    $('sync-host').replaceChildren();
    const ytLayout = mountYtLayout($('sync-host'), { workRow: $('work-row'), label: (k) => t(k), onVideoHeight: (px) => ss.viewer?.setMaxHeight(px) });
    ss.layout = ytLayout; const viewerHost = ytLayout.viewerHost; const panelHost = ytLayout.timelineHost;
    ytLayout.adoptWorkRow(); sidebar.setHidden(true);
    const selectionHost = document.createElement('div'); selectionHost.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const settingsHost = document.createElement('div'); settingsHost.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    ytLayout.tabs.settings.append(settingsHost);
    const workHost = document.createElement('div'); workHost.className = 'ht-content'; workHost.style.cssText = 'border:1px solid var(--line,#d8d3c8);border-radius:8px;background:var(--module,#fcfbf8);padding:6px 10px 10px;margin-top:6px'; ytLayout.tabs.settings.append(workHost);
    ss.panel = mountPlacementPanel(panelHost, {
      layout: { selection: selectionHost, settings: settingsHost },
      onState: () => { ss.history?.capture(); ss.fragEdRefresh?.(); },
      mountOverlay: ({ layer, frame }) => {
        const frameW = () => Math.max(160, frame.clientWidth || 360);
        const stage = createStage({ host: layer, player: ss.player, getWork: () => app5.doc.work, getPlacements: () => ss.placements, getDisplay: () => ss.session.display, ...overlayOptions(frameW, () => 1, (p) => viewOf(p), { selected: () => ss.selectedId }) });
        // the boxes follow the music of the document (a text made bigger, a block moved…) at once, without choosing the fragment again
        let timer = 0; const later = () => { clearTimeout(timer); timer = setTimeout(() => { stage.redraw(); ss.panel?.refresh(); }, 60); };
        const offDoc = app5.doc.subscribe(later);
        return { update: (st) => stage.update(st), redraw: () => stage.redraw(), destroy: () => { clearTimeout(timer); offDoc(); stage.destroy(); } };
      },
      styleLibrary: { get: () => app5.preferences.get('boxStyles'), set: (lib) => app5.preferences.set('boxStyles', lib) },
      onMetronomeVolume: () => player?.updateMixer(playbackMixerWithClick()),
      onMetronome: () => { player?.refresh(); const st = ss.player.state(); if (st.playing && !st.buffering) player?.seek((st.position - (ss.session.offsetMs ?? 0) / 1000) / st.rate + (engine.options?.startLatency ?? 0.05)); }, // the check metronome is part of the score that is heard: the sequence is built again and the engine put back on the video
      player: ss.player, label: (k, p) => t(k, p), movements,
      onAddText: () => { app5.addTextBlock({}); app5.setBlocksEditing(true); },
      onAddImage: async () => { try { const f = await pickImageFile(); if (!f) return; app5.addPictureBlock(f); app5.setBlocksEditing(true); } catch (e) { say(e?.message ?? String(e)); } },
      getPlacements: () => ss.placements, setPlacements: (list) => { ss.placements = list; player?.refresh(); },
      session: ss.session, onSoundOffset: () => { player?.refresh(); const st = ss.player.state(); if (st.playing && !st.buffering) player?.seek((st.position - (ss.session.offsetMs ?? 0) / 1000) / st.rate + (engine.options?.startLatency ?? 0.05)); },
      marks: (p) => { const index = app5.doc.work.movements.findIndex((m) => m.id === p.movementId); const slots = index < 0 ? [] : slotsOfMovement(ss, index); if (!slots.length) return []; const t0 = slots[0].t; const total = slots[slots.length - 1].end - t0; return total > 0 ? slots.map((x) => (x.t - t0) / total) : []; },
      selected: () => ss.selectedId,
      onSelect: (p) => { ss.selectedId = p?.id ?? null; if (p) showPlacementMovement(ss, p.movementId); ss.panel?.refresh(); },
      onAdd: () => { try { const list = movements(); return app5.addMovement({ from: list[list.length - 1]?.id, measures: 4 }); } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); return null; } },
    });
    const offDoc = app5.doc.subscribe(prune);
    const offSeek = ss.player.onSeek((time) => { const p = placementAt(ss.placements, time); if (p) { showPlacementMovement(ss, p.movementId); updatePlacementCursor(ss.player.state()); } });
    const offCursor = ss.player.subscribe((st) => { updatePlacementCursor(st); playerUi?.refresh?.(); });
    const offScore = slavePlacements(ss);
    ss.off = () => { offDoc(); offSeek(); offCursor(); offScore(); };
    const afterLoad = () => {
      if (!ss.placements.length) { const first = movements()[0]; if (first) { ss.placements = [{ id: 'pl0', movementId: first.id, start: 0, end: Math.min(10, ss.player.state().duration) }]; ss.selectedId = 'pl0'; } }
      ss.panel.refresh(); ss.viewer?.changed(); say(t('youtube.ready'));
    };
    const done = busy(t('youtube.loading'));
    ss.viewer = mountYoutubeViewer(viewerHost, {
      getWork: () => app5.doc.work, ss, label: (k, p) => t(k, p),
      setPlacements: (list) => { ss.placements = list; player?.refresh(); ss.panel?.refresh(); ss.history?.capture(); },
      onSelect: (p) => { ss.selectedId = p?.id ?? null; if (p) showPlacementMovement(ss, p.movementId); ss.panel?.refresh(); ss.viewer?.changed(); },
      items: { get: () => ss.session.notes ?? [], set: (l) => { ss.session.notes = l; ss.history?.capture(); }, selected: () => ss.panel?.selectedItemId?.() ?? null, select: (id) => ss.panel?.selectItem?.(id) },
      onFit: (w) => ytLayout.setTimelineWidth(w), maxHeight: ytLayout.videoHeight(),
      onLoaded: () => { done(); afterLoad(); }, onError: (e) => { done(); say(`${t('youtube.error')} ${e?.message ?? ''}`); },
    });
    ss.viewer.start();
    const fail = (e) => say(t('file.error', { message: friendlyImportError(e, t) }));
    const chosenMovement = () => ss.placements.find((p) => p.id === ss.selectedId)?.movementId ?? app5.view('main')?.movementId?.() ?? null;
    const nav = mountYtNavigator(ytLayout.tabs.fragments, {
      label: (k) => t(k),
      movements: () => (app5.tracksOutline() ?? []).map((m) => ({ id: m.id, title: m.title, cardNumber: m.cardForced ? m.cardNumber : null, description: m.description })),
      placements: () => ss.placements, selectedId: () => ss.selectedId, shownId: () => app5.view('main')?.movementId?.() ?? null,
      onChoose: (id) => { const p = ss.placements.find((x) => x.movementId === id); ss.selectedId = p?.id ?? null; showPlacementMovement(ss, id); ss.panel?.refresh(); ss.viewer?.changed(); nav.redraw(); fragEd.redraw(); ytLayout.show('editor'); },
      onAdd: () => { ss.panel?.addFragment(); nav.redraw(); fragEd.redraw(); },
    });
    const fragEd = mountYtFragmentEditor(ytLayout.tabs.editor, {
      app: app5, label: (k, p) => t(k, p), lang, chosenId: chosenMovement, displayHost: selectionHost,
      onPlace: (id) => { ss.panel?.placeMovement(id); nav.redraw(); },
      onDuplicate: (id) => { try { app5.duplicateMovement(id); } catch (e) { fail(e); } nav.redraw(); },
      onRemove: (id) => { try { app5.removeMovement(id); } catch (e) { fail(e); } nav.redraw(); },
      say, itemSelected: () => !!ss.panel?.itemSelected?.(), itemKind: () => ss.panel?.selectedItemKind?.() ?? null,
    });
    ss.fragEdRefresh = () => fragEd.refresh();
    const work = createWorkPanels({ app: app5, label: (k, p) => t(k, p), onShow: () => {}, shownId: () => chosenMovement() });
    const drawWork = () => { const nodes = work.build('work', drawWork); const title = document.createElement('div'); title.style.cssText = 'font:var(--w-bold,700) 14px var(--ui-font,sans-serif);padding:8px 0 4px'; title.textContent = t('ytEditor.secWork'); workHost.replaceChildren(title, ...nodes); const g = workHost.querySelector('.ht-grid'); if (g) g.style.gridTemplateColumns = 'auto minmax(0,1fr) auto minmax(0,1fr)'; /* two columns */ };
    drawWork();
    const refreshAll = () => { nav.refresh(); fragEd.refresh(); }; const offNav = app5.doc.subscribe(refreshAll); const offNavH = ss.history.onChange?.(refreshAll); const offWork = app5.doc.subscribe(() => { if (!workHost.contains(document.activeElement)) drawWork(); });
    const offViewerDoc = app5.doc.subscribe(() => ss.viewer?.redraw());
    const offOpt = ss.history.onChange?.(() => { ss.viewer?.changed(); saveDraft(ss.session.videoId, { placements: ss.placements, notes: ss.session.notes ?? [], display: ss.session.display ?? null, reader: ss.session.reader ?? null, styles: ss.session.styles ?? null, offsetMs: ss.session.offsetMs ?? 0 }); });
    const prevOff = ss.off; ss.off = () => { prevOff?.(); offViewerDoc(); offOpt?.(); offNav(); offNavH?.(); offWork(); nav.destroy(); fragEd.destroy(); ytLayout.restoreWorkRow(); ytLayout.destroy(); sidebar.setHidden(false); };
  };
  /** Starts mode B for `work`: the video `videoId` and the placements of its movements. Needs a page served over http(s) (YouTube refuses `file://`). */
  const startPlacementSession = ({ work, videoId, placements = [], selectedId = null, offsetMs = 0, display = null, notes = [], reader = null, styles = {} }) => {
    stopSync();
    syncSession = { mode: 'placements', work, player: createYouTubePlayer(), session: { videoId, offsetMs, display: display ? normalizeDisplay(display) : undefined, notes, styles, reader: normalizeReader(reader, 'youtube') }, placements, selectedId, slots: null, panel: null, off: null, measureIds: [], media: [] };
    screen = 'yt'; screenMenu.set('yt'); dockScreen.setValue?.('yt'); fileDrawer?.setScreen('yt'); // a YouTube session lives on screen 5; screen 4 is for audio files
    syncScreen();
  };
  const newYouTube = async () => {
    if (portal) { say(t('portal.notHere')); return; } // portal mode: the score belongs to the portal's library
    if (!(await confirmReplace())) return;
    if (location.protocol === 'file:') { say(t('youtube.needsHttp')); await confirmDialog({ message: t('youtube.needsHttp'), label: (k, p) => t(k, p), confirmText: t('dialog.ok'), cancelText: t('dialog.cancel') }); return; }
    const text = await askText({ title: t('youtube.title'), help: t('youtube.help'), placeholder: 'https://www.youtube.com/watch?v=…', label: (k, p) => t(k, p) });
    if (!text) return;
    const id = parseYouTubeId(text); if (!id) { say(t('youtube.badUrl')); return; }
    const work = createScore({ title: '', measures: 4, parts: [{ instrumentId: 'voice' }], lang });
    works.opened = work; openedName = null; excerpt = null; excerptMenu.set(''); workMenu.set('opened'); current = work;
    render();
    const draft = loadDraft(id);
    if (draft && await confirmDialog({ message: t('ytEditor.restoreDraft'), label: (k, p) => t(k, p) })) startPlacementSession({ work, videoId: id, placements: draft.placements, notes: draft.notes, display: draft.display, reader: draft.reader, styles: draft.styles ?? {}, offsetMs: draft.offsetMs ?? 0 });
    else startPlacementSession({ work, videoId: id });
  };
  /** The name of the key of the first bar (the key the recording is read in: only the label of the transposition menu). */
  const keyNameOf = (work) => {
    const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
    return `${MAJOR[Math.max(0, Math.min(14, 7 + (getProperty(work.movements[0].masterbars[0], PID.KEY_SIG) ?? 0)))]} major`;
  };
  /** « Choose on the score » for the tapping window: a function that waits for the person to touch a measure of the score (null when the score is not on the screen). */
  const scorePicker = () => {
    const v = app5?.view?.('main'); const host = $('view-host');
    if (!v || !host || !host.getClientRects().length) return null;
    return () => {
      let offs = []; let finish = null;
      const promise = new Promise((resolve) => {
        finish = (idx) => { for (const o of offs) o?.(); offs = []; resolve(idx); };
        offs = [v.onMeasureChange((id) => { if (id) finish(v.measureIndexOf(id)); }), v.onRangeChange((r) => { if (r) finish(v.measureIndexOf(r.from.measureId)); })];
      });
      return { promise, cancel: () => finish?.(null) };
    };
  };
  /** The tapping window over a RECORDING (a stem player, loaded once): the measures tapped become the map of screen 4. `keepOnCancel`: the player belongs to the session that is open (a redo). */
  const tapOverAudio = ({ work, player, media, analysis, session, keepOnCancel = false }) => {
    const plan = tapPlan(work.movements[0]);
    openSyncTap({
      label: (k, p) => t(k, p), plan, player, pickMeasure: scorePicker(),
      onCancel: () => { if (!keepOnCancel) player.destroy(); },
      onDone: async (r) => {
        const sess = session ?? (() => { let saved = {}; try { saved = JSON.parse(localStorage.getItem('scorsaire.syncPreRoll') ?? '{}'); } catch { /* none */ } return { key: keyNameOf(work), offsetMs: 0, preRoll: [0, 1, 2].includes(saved.preRoll) ? saved.preRoll : 0, preClick: saved.preClick !== false }; })();
        sess.offsetMs = 0; // the new map is made on the recording itself
        if (await startSyncSession({ work, sync: { measures: r.measures, order: r.order, key: sess.key, duration: r.duration, bpm: r.bpm }, analysis: analysis ?? { infos: {}, beats: [], chords: [], segments: [], source: null }, media, session: sess, reuse: player })) {
          say(t('sync.create.done', { tapped: String(r.tapped), total: String(r.times.length) }));
        }
      },
    });
  };
  /** The tapping window over a YouTube VIDEO (watched while tapping, a page served over http(s)): the instants become `points` of the video of screen 4. */
  const tapOverYouTube = async ({ work, id = null }) => {
    if (location.protocol === 'file:') { say(t('youtube.needsHttp')); await confirmDialog({ message: t('youtube.needsHttp'), label: (k, p) => t(k, p), confirmText: t('dialog.ok'), cancelText: t('dialog.cancel') }); return; }
    if (!id) {
      const text = await askText({ title: t('youtube.title'), help: t('youtube.help'), placeholder: 'https://www.youtube.com/watch?v=…', label: (k, p) => t(k, p) });
      if (!text) return;
      id = parseYouTubeId(text); if (!id) { say(t('youtube.badUrl')); return; }
    }
    const videoPlayer = createYouTubePlayer();
    openSyncTap({
      label: (k, p) => t(k, p), plan: tapPlan(work.movements[0]), player: videoPlayer, pickMeasure: scorePicker(),
      mountMedia: (box) => { const inner = document.createElement('div'); inner.style.cssText = 'position:absolute;inset:0'; box.replaceChildren(inner); return videoPlayer.load(id, inner, {}); },
      onCancel: () => videoPlayer.destroy(),
      onDone: (r) => {
        videoPlayer.destroy();
        startVideoSession({ work, videos: [{ videoId: id, feature: null, points: r.times }], videoId: id, key: keyNameOf(work), order: r.order, measures: r.measures });
        say(t('sync.create.done', { tapped: String(r.tapped), total: String(r.times.length) }));
      },
    });
  };
  /**
   * Screen 4 made by hand: the score that is open + a recording (an audio file, or a YouTube video) the person watches; they tap the start of every measure (as the recording plays
   * the score, repeats included) and the instants become the time map. `redo`: the recording of the session that is open is tapped over again (nothing changes unless they finish).
   */
  const startSyncCreation = async ({ redo = false } = {}) => {
    if (portal) { say(t('portal.notHere')); return; }
    if (!app5 || current === 'legend' || !current?.movements?.length) { say(t('sync.create.noScore')); return; }
    const work = app5.doc.work;
    const ss = syncSession;
    if (redo) {
      if (!ss || ss.work !== work || ss.mode === 'placements') { say(t('sync.create.noScore')); return; }
      if (!(await confirmDialog({ message: t('sync.redo.ask'), label: (k, p) => t(k, p), confirmText: t('dialog.ok'), cancelText: t('dialog.cancel') }))) return;
      if (ss.video) { await tapOverYouTube({ work, id: ss.session.videoId }); return; }
      tapOverAudio({ work, player: ss.player, media: ss.media, analysis: ss.analysis, session: { ...ss.session }, keepOnCancel: true });
      return;
    }
    const kind = await confirmDialog({ message: t('sync.create.askKind'), label: (k, p) => t(k, p), confirmText: t('sync.create.kindAudio'), secondaryText: t('sync.create.kindYoutube'), cancelText: t('dialog.cancel') }); // a click here also gives the picker the gesture it needs
    if (!kind) return;
    if (kind === 'secondary') { await tapOverYouTube({ work }); return; }
    const files = await pickFiles({ accept: 'audio/*,.opus,.ogg,.oga,.wav,.mp3,.flac,.m4a,.aac,.webm', multiple: false });
    if (!files.length) { say(t('sync.create.pickAudio')); return; }
    const file = files[0];
    const bytes = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength);
    const done = busy(t('sync.loading'));
    const player = createStemPlayer({ createContext: () => createLatencyContext(), loadStretch });
    try { await player.load([{ name: file.name, bytes: bytes.slice(0) }]); } catch (e) { done(); player.destroy(); say(t('file.error', { message: friendlyImportError(e, t) })); return; }
    done();
    tapOverAudio({ work, player, media: [{ id: 'm0', name: file.name, role: 'original', bytes }] });
  };
  /** Making the synchronisation by hand, with a failure shown instead of lost (a click that does nothing tells the person nothing). */
  const syncCreation = (options) => startSyncCreation(options).catch((e) => { console.error(e); say(t('file.error', { message: String(e?.message ?? e) })); });
  /**
   * A score made FROM THE MUSIC (screen 4, nothing loaded): the person chooses the tracks and the time signature, loads a recording (or a YouTube video) and taps the start of every measure
   * (the signature may change from any measure); the score is then created with as many measures as were tapped and the taps become its time map. Repeats are not written: the taps follow what is played.
   */
  const musicScoreAssistant = createNewScoreAssistant({
    music: true, label: (k, p) => t(k, p), lang,
    templates: () => templateCatalog(preferences, lang), findTemplate: (id) => findTemplate(preferences, id),
    onCreate: (options) => { createFromMusic(options); },
  });
  const startFromMusic = async () => {
    if (portal) { say(t('portal.notHere')); return; }
    if (!(await confirmReplace())) return;
    musicScoreAssistant.open();
  };
  const createFromMusic = async (options) => {
    const kind = await confirmDialog({ message: t('sync.create.askKind'), label: (k, p) => t(k, p), confirmText: t('sync.create.kindAudio'), secondaryText: t('sync.create.kindYoutube'), cancelText: t('dialog.cancel') });
    if (!kind) return;
    const plan = openTapPlan({ timeSig: options.timeSig });
    /** The score at last: as many measures as were tapped, each with its signature, the tempo of the taps. */
    const build = (r) => {
      const work = createScore({ ...options, measures: r.times.length, timeSigs: r.timeSigs, timeSig: r.timeSigs[0], pickup: null, tempo: r.bpm >= 5 && r.bpm <= 999 ? { bpm: r.bpm } : null });
      applyTapSections(work, r.sections); // the sections marked while tapping
      works.opened = work; openedName = null; excerpt = null; excerptMenu.set(''); workMenu.set('opened'); current = work;
      render();
      return app5.doc.work;
    };
    if (kind === 'secondary') {
      if (location.protocol === 'file:') { say(t('youtube.needsHttp')); await confirmDialog({ message: t('youtube.needsHttp'), label: (k, p) => t(k, p), confirmText: t('dialog.ok'), cancelText: t('dialog.cancel') }); return; }
      const text = await askText({ title: t('youtube.title'), help: t('youtube.help'), placeholder: 'https://www.youtube.com/watch?v=…', label: (k, p) => t(k, p) });
      if (!text) return;
      const id = parseYouTubeId(text); if (!id) { say(t('youtube.badUrl')); return; }
      const videoPlayer = createYouTubePlayer();
      openSyncTap({
        label: (k, p) => t(k, p), plan, player: videoPlayer, open: true,
        mountMedia: (box) => { const inner = document.createElement('div'); inner.style.cssText = 'position:absolute;inset:0'; box.replaceChildren(inner); return videoPlayer.load(id, inner, {}); },
        onCancel: () => videoPlayer.destroy(),
        onDone: (r) => {
          videoPlayer.destroy();
          const work = build(r);
          startVideoSession({ work, videos: [{ videoId: id, feature: null, points: r.times }], videoId: id, key: keyNameOf(work), order: r.order, measures: r.measures, sections: (r.sections ?? []).map((x) => ({ measure: x.measure, label: x.label })) });
          say(t('sync.create.done', { tapped: String(r.tapped), total: String(r.times.length) }));
        },
      });
      return;
    }
    const files = await pickFiles({ accept: 'audio/*,.opus,.ogg,.oga,.wav,.mp3,.flac,.m4a,.aac,.webm', multiple: false });
    if (!files.length) { say(t('sync.create.pickAudio')); return; }
    const file = files[0];
    const bytes = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength);
    const done = busy(t('sync.loading'));
    const player = createStemPlayer({ createContext: () => createLatencyContext(), loadStretch });
    try { await player.load([{ name: file.name, bytes: bytes.slice(0) }]); } catch (e) { done(); player.destroy(); say(t('file.error', { message: friendlyImportError(e, t) })); return; }
    done();
    openSyncTap({
      label: (k, p) => t(k, p), plan, player, open: true,
      onCancel: () => player.destroy(),
      onDone: async (r) => {
        const work = build(r);
        let saved = {}; try { saved = JSON.parse(localStorage.getItem('scorsaire.syncPreRoll') ?? '{}'); } catch { /* none */ }
        const sess = { key: keyNameOf(work), offsetMs: 0, preRoll: [0, 1, 2].includes(saved.preRoll) ? saved.preRoll : 0, preClick: saved.preClick !== false };
        if (await startSyncSession({ work, sync: { measures: r.measures, order: r.order, key: sess.key, duration: r.duration, bpm: r.bpm }, analysis: { infos: {}, beats: [], chords: [], segments: sectionSegments((r.sections ?? []).map((x) => ({ measure: x.measure, label: x.label })), r.measures), source: null }, media: [{ id: 'm0', name: file.name, role: 'original', bytes }], session: sess, reuse: player })) {
          say(t('sync.create.done', { tapped: String(r.tapped), total: String(r.times.length) }));
        }
      },
    });
  };
  /** Opens the archive of an analysed song: builds the score from the beat map, loads the audio, goes to screen 4. */
  /**
   * Starts screen 4 for `work`: loads the audio (the stems, or the original mix when there is none) and shows the media panel.
   * `media` = [{ id, name, role: 'stem' | 'original', bytes }] (all of them are kept for the file; only the playable ones are decoded);
   * `state` = what a saved file remembers { stems: [{ id, volume, mute }], master }.
   */
  /** A small spinner over the page while a long file loads (the recording is decoded and prepared before it shows): `const done = busy(text); … done()`. */
  const busy = (text) => {
    if (!document.getElementById('busy-style')) { const st = document.createElement('style'); st.id = 'busy-style'; st.textContent = '@keyframes scorsaire-spin { to { transform: rotate(360deg); } }'; document.head.append(st); }
    const box = document.createElement('div');
    box.setAttribute('data-busy', ''); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:4000;display:flex;align-items:center;gap:12px;padding:14px 20px;background:var(--paper,#fff);color:var(--ink,#222);border:1px solid var(--edge,#bbb);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:15px var(--ui-font,sans-serif)';
    const ring = document.createElement('span');
    ring.style.cssText = 'width:22px;height:22px;border-radius:50%;border:3px solid var(--edge,#cfc8b8);border-top-color:var(--info-ink,#2b6cff);animation:scorsaire-spin .8s linear infinite;flex:none';
    const label = document.createElement('span'); label.textContent = text;
    box.append(ring, label); document.body.append(box);
    return () => box.remove();
  };
  const startSyncSession = async ({ work, sync, analysis, media, session, state = null, reuse = null, extra = {} }) => {
    const playable = media.some((m) => m.role === 'stem') ? media.filter((m) => m.role === 'stem') : media.filter((m) => m.role === 'original').slice(0, 1);
    if (!playable.length) { say(t('sync.noAudio')); return false; }
    const player = reuse ?? createStemPlayer({ createContext: () => createLatencyContext(), loadStretch }); // `reuse`: the recording stays loaded (the song is built again around it)
    if (!reuse) await player.load(playable.map((m) => ({ name: m.name, bytes: m.bytes })));
    stopSync({ keepPlayer: !!reuse });
    for (const [i, m] of playable.entries()) { const saved = state?.stems?.find((x) => x.id === m.id); if (saved) player.setStem(i, { volume: saved.volume ?? 1, mute: !!saved.mute }); }
    if (state?.master != null) player.setMasterVolume(state.master);
    syncSession = { work, player, session, map: createSyncMap(sync.measures, { offset: (session.offsetMs ?? 0) / 1000, order: sync.order ?? null }), analysis, imp: { sync }, media, playable, measureIds: work.movements[0].masterbars.map((b) => b.id), panel: null, off: null, getMap: null, ...extra };
    syncSession.getMap = () => syncSession.map;
    screen = 'four'; screenMenu.set('four'); dockScreen.setValue?.('four'); fileDrawer?.setScreen('four');
    syncScreen();
    return true;
  };
  /** Opens the archive of an analysed song: builds the score from the beat map, loads the audio, goes to screen 4. */
  const openAnalysedSong = async (file) => {
    say(t('sync.loading'));
    const done = busy(t('sync.loading'));
    try { await openAnalysedSongInner(file, done); } finally { done(); }
  };
  const openAnalysedSongInner = async (file, done) => {
    const archive = await readAllInOneArchive(file.bytes);
    const imp = importAllInOne(archive.analysis, { lang });
    if (imp.errors.length) { say(t('import.error', { message: imp.errors[0] })); return; }
    works.opened = imp.work; openedName = file.name; excerpt = null; excerptMenu.set(''); workMenu.set('opened'); current = imp.work;
    render();
    const media = [...archive.stems.map((s, i) => ({ id: `m${i}`, name: s.name, role: 'stem', bytes: s.bytes })), ...(archive.original ? [{ id: `m${archive.stems.length}`, name: archive.original.name, role: 'original', bytes: archive.original.bytes }] : [])];
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('scorsaire.syncPreRoll') ?? '{}'); } catch { /* none */ }
    const session = { key: imp.sync.key ?? 'C major', offsetMs: 0, preRoll: [0, 1, 2].includes(saved.preRoll) ? saved.preRoll : 0, preClick: saved.preClick !== false };
    if (!(await startSyncSession({ work: imp.work, sync: imp.sync, analysis: archive.analysis, media, session }))) return;
    done(); // the spinner goes away before the question
    // one staff per stem, if the person wants them (vocals → a voice track, guitars → score + tab, bass → score + tab, drums → a drum staff, other → piano)
    if (archive.stems.length) {
      const picks = await askStemTracks({ stems: archive.stems, label: (k, p) => t(k, p) });
      if (picks) { try { for (const spec of tracksToCreate(picks, lang)) app5.addInstrumentTrack(spec.id, { ...spec.options, name: spec.name }); } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); } }
    }
    say(t('sync.loaded', { name: file.name, stems: String(archive.stems.length || 1) }));
    if (imp.report.items.length) openImportReport({ report: imp.report, title: t('import.title', { name: file.name }), label: (k, p) => t(k, p) });
  };
  /** The text that names why two files do not fit over each other. */
  const mergeIssueText = (i) => {
    if (i.code === 'length') return t('merge.issue.length', { measure: String(i.source + 1), sourceBeats: String(i.sourceBeats), target: String(i.target + 1), targetBeats: String(i.targetBeats) });
    if (i.code === 'longer') return t('merge.issue.longer', { sourceMeasures: String(i.sourceMeasures), targetMeasures: String(i.targetMeasures) });
    if (i.code === 'video') return t('merge.issue.video', { mean: i.mean.toFixed(1) });
    return t('merge.issue.leading', { beats: String(i.beats) });
  };
  /**
   * Builds the song of the analysis `base` with the parts of `src` (a Songsterr import) and starts screen 4 on it, around the recording that is already loaded.
   * `shift` forces the correspondence of the measures (the person moved it); `mode`: which sections the song has ('audio' | 'part' | 'both'). False (and a dialog that names
   * the measure) when the two files do not fit: nothing is changed then.
   */
  const buildMergedSong = async (ss, src, { base, shift = null, mode = 'part' }) => {
    const plan = planPartsMerge(base, src.work, { videos: src.videos, shift });
    if (!plan.ok) { await confirmDialog({ message: `${t('merge.refused')}\n\n${plan.issues.slice(0, 4).map(mergeIssueText).join('\n')}`, label: (k, p) => t(k, p), confirmText: t('dialog.ok'), cancelText: t('dialog.cancel') }); return false; }
    const analysis = { ...base, ...mergeAnalysis(base, plan) };
    const imp = importAllInOne(analysis, { lang });
    if (imp.errors.length) { say(t('import.error', { message: imp.errors[0] })); return false; }
    const audioList = sectionsOf(imp.work);
    const effective = Math.max(0, plan.shift); // a pick-up the analysis lacked was added to it: the measures then line up from the first one
    const partList = shiftSections(sectionsOf(src.work), effective, imp.work.movements[0].masterbars.length);
    const poured = pourParts(imp.work, src.work, { shift: effective, sections: mode === 'audio' ? 'target' : mode === 'both' ? 'both' : 'source' });
    analysis.partSegments = sectionSegments(partList, imp.sync.measures); // the second band of the timeline, while the two files are being put together
    const st = ss.player.state();
    const state = { stems: ss.playable.map((m, i) => ({ id: m.id, volume: st.stems[i]?.volume ?? 1, mute: !!st.stems[i]?.mute })), master: st.masterVolume };
    stopSync({ keepPlayer: true }); // the old session goes (its panels, its video) but the recording stays loaded: `render()` below would otherwise close it with the session
    works.opened = imp.work; current = imp.work; render();
    const merge = { base, src, plan, mode, audioList, partList, validated: false };
    if (!(await startSyncSession({ work: imp.work, sync: imp.sync, analysis, media: ss.media, session: { ...ss.session }, state, reuse: ss.player, extra: { merge, ...followerExtra(imp.work, src.videos, { shift: effective }) } }))) return false;
    return poured;
  };
  /** The state shown by the panel of the merge. */
  const mergeState = (ss) => ({ shift: ss.merge.plan.shift, noShift: !!ss.merge.reverse, pickup: ss.merge.plan.pickup?.beats ?? 0, trimmed: !!ss.merge.plan.trimLast, videoMean: ss.merge.plan.video?.mean ?? null, mode: ss.merge.mode, audioCount: ss.merge.audioList.length, partCount: ss.merge.partList.length });
  /** Sections of the audio, of the score or both: replaced in the document (one edit that can be undone). */
  const setMergeSections = (ss, mode) => {
    if (!ss.merge || ss.merge.mode === mode || !app5) return;
    ss.merge.mode = mode;
    const list = combineSections(ss.merge.audioList, ss.merge.partList, mode);
    const clean = app5.doc.isClean(); // choosing the sections is part of putting the files together, not an edit of the person: it does not make the document « modified »
    app5.edit('Sections', () => replaceSections(app5.doc, app5.doc.work.movements[0], list));
    if (clean) app5.doc.markClean();
    ss.mergePanel?.refresh(); mounted?.refresh();
  };
  /** The parts move by one measure: the song is built again (the recording stays loaded). */
  const shiftMerge = async (ss, delta) => {
    const m = ss.merge; if (!m || m.reverse || !app5) return;
    if (!app5.doc.isClean() && !(await confirmDialog({ message: t('merge.loseEdits'), label: (k, p) => t(k, p), confirmText: t('merge.continue'), cancelText: t('dialog.cancel') }))) return;
    const done = busy(t('sync.loading'));
    try { await buildMergedSong(ss, m.src, { base: m.base, shift: m.plan.shift + delta, mode: m.mode }); } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); } finally { done(); }
  };
  /** The two files stay together: the sources are let go and the panel goes. */
  const validateMerge = (ss) => {
    if (!ss.merge) return;
    ss.merge.videos = ss.merge.src?.videos ?? ss.merge.videos; ss.merge.src = null; ss.merge.base = null; ss.merge.validated = true;
    ss.analysis.partSegments = null; ss.mergePanel?.destroy(); ss.mergePanel = null; ss.panel?.refresh();
    say(t('merge.validated'));
  };
  /** Screen 4 (an analysis archive is open): the parts (staves) of a Songsterr archive are poured onto its measures; the chords, the time map and the audio stay. */
  const addSongsterrParts = async () => {
    if (portal) { say(t('portal.notHere')); return; } // portal mode: the score belongs to the portal's library
    const ss = syncSession;
    if (!ss || ss.mode === 'placements' || ss.video || ss.work !== current || !app5) { say(t('merge.needsAudio')); return; }
    try {
      const file = await pickFile(); if (!file) return;
      if (!isSongsterrArchive(file.bytes)) { say(t('merge.notSongsterr')); return; }
      const src = await importSongsterrBytes(file.bytes, { lang });
      if (src.errors.length) { say(t('import.error', { message: src.errors[0] })); return; }
      if (!app5.doc.isClean() && !(await confirmDialog({ message: t('merge.loseEdits'), label: (k, p) => t(k, p), confirmText: t('merge.continue'), cancelText: t('dialog.cancel') }))) return;
      const done = busy(t('sync.loading'));
      try {
        const poured = await buildMergedSong(ss, src, { base: ss.merge?.base ?? ss.analysis });
        if (poured) say(t('merge.done', { tracks: String(poured.tracks), sections: String(poured.sections) }));
      } finally { done(); }
    } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); }
  };
  /**
   * The other direction: a score is open (a Songsterr one, with or without its video) and the AUDIO of an analysis archive is added to it: the stems, the time map (the beats
   * of the analysis grouped on the measures of the score) and, if wanted, the chords in a chord track. The score is not rebuilt: it stays as it is, edits included.
   */
  const addAnalysisAudio = async () => {
    if (portal) { say(t('portal.notHere')); return; } // portal mode: the score belongs to the portal's library
    const ss = syncSession;
    if ((ss && !ss.video) || !app5 || current === 'legend') { say(t('merge.needsScore')); return; }
    try {
      const file = await pickFile(); if (!file) return;
      if (!isAllInOneArchive(file.bytes)) { say(t('merge.notAnalysis')); return; }
      const archive = await readAllInOneArchive(file.bytes);
      const work = app5.doc.work; const count = work.movements[0].masterbars.length;
      const plan = planPartsMerge(archive.analysis, work, { videos: ss?.videos ?? [] });
      if (!plan.ok) { await confirmDialog({ message: `${t('merge.refused')}\n\n${plan.issues.slice(0, 4).map(mergeIssueText).join('\n')}`, label: (k, p) => t(k, p), confirmText: t('dialog.ok'), cancelText: t('dialog.cancel') }); return; }
      const answer = await confirmDialog({ message: t('merge.chordsQuestion'), label: (k, p) => t(k, p), confirmText: t('merge.withChords'), secondaryText: t('merge.audioOnly'), cancelText: t('dialog.cancel') });
      if (!answer) return;
      const done = busy(t('sync.loading'));
      try {
        const analysis = { ...archive.analysis, ...mergeAnalysis(archive.analysis, plan) };
        const imp = importAllInOne(analysis, { lang });
        if (imp.errors.length) { say(t('import.error', { message: imp.errors[0] })); return; }
        const eff = Math.max(0, plan.shift); // the analysis measures before the music (`eff`) have no measure in the score
        const measures = imp.sync.measures.slice(eff, eff + count);
        if (measures.length !== count) { say(t('merge.refused')); return; }
        let placed = 0;
        if (answer === true) {
          const chords = chordTrackFor(imp.work, { shift: eff, count });
          const words = lyricsTrackFrom(imp.work, { shift: eff, count, name: lang === 'fr' ? 'Paroles' : 'Lyrics' });
          if (chords || words) {
            app5.edit('Accords', () => {
              const mv = app5.doc.work.movements[0];
              if (chords?.qualities) app5.doc.set(app5.doc.work, PID.CHORD_QUALITIES, chords.qualities);
              for (const g of chords?.grids ?? []) app5.doc.set(mv.masterbars[g.measure], PID.INPUT_GRID, g.value);
              if (chords) app5.doc.add(mv, 'tracks', chords.track, 0);
              if (words) app5.doc.add(mv, 'tracks', words, chords ? 1 : 0); // the lyrics come right after the chords
            });
            placed = imp.report.stats?.chords ?? 0;
          }
        }
        const audioList = shiftSections(sectionsOf(imp.work), -eff, count); const partList = sectionsOf(app5.doc.work);
        analysis.partSegments = sectionSegments(partList, measures);
        const media = [...archive.stems.map((x, i) => ({ id: `m${i}`, name: x.name, role: 'stem', bytes: x.bytes })), ...(archive.original ? [{ id: `m${archive.stems.length}`, name: archive.original.name, role: 'original', bytes: archive.original.bytes }] : [])];
        let saved = {}; try { saved = JSON.parse(localStorage.getItem('scorsaire.syncPreRoll') ?? '{}'); } catch { /* none */ }
        const session = { key: imp.sync.key ?? 'C major', offsetMs: 0, preRoll: [0, 1, 2].includes(saved.preRoll) ? saved.preRoll : 0, preClick: saved.preClick !== false };
        const merge = { reverse: true, plan, mode: 'part', audioList, partList, validated: false };
        if (await startSyncSession({ work: current, sync: { measures, key: imp.sync.key, duration: imp.sync.duration, bpm: imp.sync.bpm }, analysis, media, session, extra: { merge, ...followerExtra(current, ss?.videos ?? [], { shift: 0 }) } })) {
          say(t('merge.audioAdded', { stems: String(archive.stems.length || 1), chords: String(placed) }));
        }
      } finally { done(); }
    } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); }
  };
  /** Opens a `.scorsaire` ZIP: the score and, when it holds one, the synchronised recording (screen 4). */
  const openScorsaireZip = async (file) => {
    say(t('sync.loading'));
    const done = busy(t('sync.loading'));
    try { await openScorsaireZipInner(file); } finally { done(); }
  };
  /** The audio of a light file, picked on the disk: the files of the piece or its ZIP, recognised by fingerprint (by name as a second chance, with a warning). → { media, warning } or null (a message is said). */
  const chooseLocalAudio = async (media) => {
    const lt = (k, p) => t(k, p);
    const count = media.filter((m) => m.external && !m.bytes).length;
    const go = await confirmDialog({ message: lt('sync.localAudio.ask', { n: String(count) }), label: lt, confirmText: lt('sync.localAudio.choose'), cancelText: lt('dialog.cancel') }); // a click here gives the picker the gesture it needs
    if (!go) { say(t('sync.externalAudio')); return null; }
    const files = await pickFiles({ accept: 'audio/*,.opus,.ogg,.oga,.wav,.mp3,.flac,.m4a,.aac,.webm,.zip,application/zip' });
    if (!files.length) { say(t('sync.externalAudio')); return null; }
    say(t('sync.localAudio.checking'));
    const res = await matchExternalMedia(media, await expandCandidates(files));
    if (res.missing.length) { say(t('sync.localAudio.missing', { names: res.missing.map((m) => m.name).join(', ') })); return null; }
    const plain = media.map((m) => {
      const hit = res.found.get(m.id); if (!hit) return m;
      const { external, ...track } = m;
      return { ...track, bytes: hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength) };
    });
    return { media: plain, warning: [...res.found.values()].some((v) => v.how === 'name') };
  };
  const openScorsaireZipInner = async (file) => {
    const r = await readScorsaireArchive(file.bytes);
    const work = workFromFileText(r.scoreText);
    clearAssets(); for (const im of r.images) registerAsset(im);
    works.opened = work; openedName = file.name; excerpt = null; excerptMenu.set(''); workMenu.set('opened'); current = work;
    render();
    if (!r.sync) { say(t('file.loaded', { name: file.name })); return; }
    const { info } = r.sync;
    let audioWarning = false;
    if (r.sync.media.some((m) => m.external && !m.bytes)) { // the audio is kept on the portal: fetched from `media=` of the page address, with the token, and checked against its fingerprint
      if (portal) portalExternals = new Map(r.sync.media.filter((m) => m.external).map((m) => [m.id, m.external])); // saved back as the SAME references (the portal only accepts the audio it already holds)
      const base = portal ? portal.mediaBase() : mediaBase(pageParams());
      if (!base) { // no address to fetch from: the audio is looked for among files picked on the disk (recognised by their fingerprint)
        const got = await chooseLocalAudio(r.sync.media);
        if (!got) { syncLeftOut = work; return; }
        r.sync.media = got.media; audioWarning = got.warning;
      } else {
      const KEYS = { noBase: 'syncreader.audioNeedsBase', denied: 'syncreader.audioDenied', missing: 'syncreader.audioMissing' };
      try {
        const res = await resolveExternalMedia(r.sync.media, { base, fetchFn: portal ? (u) => portal.fetch(u) : undefined, onProgress: ({ done, total }) => say(t('syncreader.audioLoading', { done, total })) });
        r.sync.media = res.media.map(({ external, ...track }) => track); // plain tracks: a save then writes the audio into the file (the light file is its own export)
        audioWarning = res.warnings.length > 0;
      } catch (e) { say(t(KEYS[e.code] ?? 'syncreader.audioError')); syncLeftOut = work; return; }
      }
    }
    if (info.source === 'youtube') { // mode B: the video and the placements (no audio inside the file)
      const ids = work.movements.map((m) => m.id);
      const list = (info.placements ?? []).filter((p) => ids.includes(p.movementId));
      if (placementProblems(list, ids).length) { say(t('sync.mismatch')); return; }
      if (location.protocol === 'file:') { say(t('youtube.needsHttp')); return; }
      startPlacementSession({ work, videoId: info.youtube?.videoId, placements: list, selectedId: list[0]?.id ?? null, offsetMs: info.offsetMs ?? 0, display: info.display ?? null, notes: sanitizeItems(info.notes), reader: info.reader ?? null, styles: sanitizeStyles(info.styles) });
      say(t('file.loaded', { name: file.name }));
      return;
    }
    if (info.source === 'video') { // a song synchronised with a video: nothing to load but the list of videos (the map is in the file)
      const ids = work.movements[0].masterbars.map((b) => b.id);
      if (ids.length !== info.measureIds.length || ids.some((x, i) => x !== info.measureIds[i])) { say(t('sync.mismatch')); return; }
      if (location.protocol === 'file:') { say(t('youtube.needsHttp')); return; }
      const videos = usableVideos(info.youtube?.videos, Array.isArray(info.order) ? info.order.length : ids.length); // a video of a song with repeats has one point per PLAYED measure
      if (!videos.length) { say(t('video.noneUsable')); return; }
      startVideoSession({ work, videos, videoId: info.youtube?.videoId ?? null, offsetMs: info.offsetMs ?? 0, key: info.key ?? 'C major', sections: info.youtube?.sections ?? [], measures: videos.find((v) => v.videoId === info.youtube?.videoId) ? info.measures : null, order: Array.isArray(info.order) ? info.order : null });
      say(t('file.loaded', { name: file.name }));
      return;
    }
    const ids = work.movements[0].masterbars.map((b) => b.id);
    if (ids.length !== info.measureIds.length || ids.some((x, i) => x !== info.measureIds[i])) { say(t('sync.mismatch')); return; }
    const session = { reader: normalizeReader(info.reader), key: info.key ?? 'C major', offsetMs: info.offsetMs ?? 0, preRoll: [0, 1, 2].includes(info.preRoll) ? info.preRoll : 0, preClick: info.preClick !== false };
    const sync = { measures: info.measures, order: info.order ?? null, key: info.key, duration: info.duration, bpm: info.bpm };
    const analysis = { ...r.sync.analysis, segments: info.segments ?? r.sync.analysis.segments ?? [] };
    if (await startSyncSession({ work, sync, analysis, media: r.sync.media, session, state: { stems: info.stems, master: info.master }, extra: followerExtra(work, info.youtube?.videos, { videoId: info.youtube?.videoId, shift: info.youtube?.shift ?? 0 }) })) { say(t('sync.loaded', { name: file.name, stems: String(r.sync.media.filter((m) => m.role === 'stem').length || 1) }) + (audioWarning ? ` ${t('syncreader.audioMismatch')}` : '')); }
  };
  /** The bytes of the ZIP form of the file (score + synchronisation + media), or null when nothing is synchronised for the current work. */
  const buildSyncArchive = async (readerOverride = null, extra = {}) => {
    const scoreTextOf = () => workTextWithTracks(app5.doc.work, extra.trackIds ?? null); // `trackIds`: the tracks the exported page opens on (the others hidden in the copy)
    const ss = syncSession; if (!ss || ss.work !== current || !app5) return null;
    if (ss.mode === 'placements') {
      return buildScorsaireArchive({ scoreText: scoreTextOf(), sync: { source: 'youtube', youtube: { videoId: ss.session.videoId }, offsetMs: ss.session.offsetMs ?? 0, placements: ss.placements, display: ss.session.display ? normalizeDisplay(ss.session.display) : null, notes: ss.session.notes?.length ? ss.session.notes : null, reader: readerToFile(readerOverride ? { ...ss.session.reader, ...readerOverride } : ss.session.reader, 'youtube'), styles: usedStylesOf(ss.session.notes, ss.session.styles), duration: ss.player.state().duration, key: null, media: [] }, images: usedAssets(app5.doc.work) });
    }
    if (!syncStructureMatches(app5.doc.work, ss.measureIds)) return null; // callers check syncBroken() first; never write a wrong map
    if (ss.video) { // a song synchronised with a video: the map, the video and the other videos of the list (no media inside the file)
      return buildScorsaireArchive({
        scoreText: scoreTextOf(), images: usedAssets(app5.doc.work),
        sync: { source: 'video', scoreSound: extra.scoreSound === true, ...(extra.instruments === true ? { instruments: true } : {}), ...(extra.chords ? { chords: extra.chords } : {}), key: ss.session.key, offsetMs: ss.session.offsetMs ?? 0, duration: ss.imp.sync.duration, bpm: null, measureIds: ss.measureIds, measures: ss.imp.sync.measures, order: ss.imp.sync.order ?? null, segments: ss.analysis.segments ?? [], youtube: { videoId: ss.session.videoId, videos: ss.videos.map((v) => ({ videoId: v.videoId, feature: v.feature ?? null, points: v.points })), sections: ss.sections ?? [] }, media: [] },
      });
    }
    const st = ss.player.state();
    const media = extra.keepExternals ? await referenceMedia(ss.media, extra.keepExternals) : extra.external ? await externalizeMedia(ss.media) : ss.media; // external: references (name + SHA-256) instead of the audio bytes; keepExternals (portal mode): the references the portal gave
    return buildScorsaireArchive({
      scoreText: workToFileText(app5.doc.work), images: usedAssets(app5.doc.work),
      sync: {
        source: 'audio', reader: readerToFile(ss.session.reader), key: ss.session.key, offsetMs: ss.session.offsetMs, preRoll: ss.session.preRoll ?? 0, preClick: ss.session.preClick !== false, duration: ss.imp.sync.duration, bpm: ss.imp.sync.bpm,
        measureIds: ss.measureIds, measures: ss.imp.sync.measures, order: ss.imp.sync.order ?? null, segments: ss.analysis.segments ?? [], master: st.masterVolume,
        stems: ss.playable.map((m, i) => ({ id: m.id, volume: st.stems[i]?.volume ?? 1, mute: !!st.stems[i]?.mute })),
        youtube: ss.videoFollow ? { videoId: ss.followVideoId, shift: ss.videoShift, videos: ss.videos.map((v) => ({ videoId: v.videoId, feature: v.feature ?? null, points: v.points })) } : null, // the videos that follow the recording (no media inside)
        media, analysis: { infos: ss.analysis.infos, beats: ss.analysis.beats, chords: ss.analysis.chords, segments: ss.analysis.segments, source: ss.analysis.source }, // `source`: the single-file JSON as it came (kept untouched in the file)
      },
    });
  };
  /** A tap on a syllable of a lyrics track: the window of that track, on that syllable. */
  const openLyricEventOf = (itemId) => {
    if (!app5) return;
    for (const mv of app5.doc.work.movements) for (const track of mv.tracks) for (const staff of track.staves) {
      if (staff.voices?.some((v) => v.measures?.some((m) => m.items?.some((it) => it.id === itemId)))) { openLyricEvents({ app: app5, label: (k, p) => t(k, p), trackId: track.id, focusId: itemId, glyphs }); return; }
    }
  };
  /** A MIDI file: the window (smallest value, triplets, durations, parts, with a preview), then the import, with a message of progress. null when the user gave up. */
  const midiStem = (file) => String(file.name).replace(/\.[a-z0-9]+$/i, '');
  /** The MIDI window alone: the options chosen (with `mode`: 'open' | 'insert'), or null when the user gave up. */
  const askMidi = (file, insert = null) => {
    const info = describeMidi(file.bytes);
    return openMidiImportDialog({
      label: (k, p) => t(k, p), info, name: file.name, insert: insert?.(info) ?? null,
      preview: (o) => importMidi(file.bytes, { ...o, title: info.title || midiStem(file), maxMeasures: 6 }),
    });
  };
  /** Reads the file with the chosen options, with a message of progress. */
  const runMidi = async (file, options) => {
    const info = describeMidi(file.bytes);
    say(t('midi.reading'));
    return importMidiBytes(file.bytes, { ...options, title: info.title || midiStem(file) }, (p) => { if (p.stage === 'part') say(t('midi.progress', { name: p.name, done: p.done + 1, total: p.total })); });
  };
  /** A MIDI file: the window (smallest value, triplets, durations, parts, with a preview), then the import. `preset` = options already chosen. null when the user gave up. */
  const importMidiFile = async (file, { preset = null } = {}) => {
    const options = preset ?? await askMidi(file);
    return options ? runMidi(file, options) : null;
  };
  const openFile = async () => {
    if (portal) { say(t('portal.notHere')); return; } // portal mode: the score belongs to the portal's library
    if (!(await confirmReplace())) return;
    let file;
    try { file = await pickFile(); } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); return; }
    if (file) await openFileObject(file);
  };
  /** Opens a file already in memory ({ name, bytes }): what the picker gave, or what the address of the page asked for. */
  const openFileObject = async (file, midiPreset = null) => {
    try {
      if (isScorsaireArchive(file.bytes)) { await openScorsaireZip(file); return; }
      if (isAllInOneArchive(file.bytes)) { await openAnalysedSong(file); return; }
      let work; let imported = null;
      const songsterr = isSongsterrArchive(file.bytes);
      const midi = !songsterr && isMidiFile(file.bytes);
      const guitarPro = !songsterr && !midi && isGuitarProFile(file.name, file.bytes);
      const textLike = !guitarPro && !midi && !(file.bytes[0] === 0x50 && file.bytes[1] === 0x4b) && (/\.(html?|txt)$/i.test(file.name) || file.bytes[0] === 0x3c);
      const irealText = textLike ? new TextDecoder().decode(file.bytes) : null;
      if (midi || songsterr || guitarPro || isMusicXmlFile(file.name, file.bytes) || (irealText && looksLikeIreal(irealText))) {
        if (midi) {
          imported = await importMidiFile(file, { preset: midiPreset });
          if (!imported) return; // the user gave up the window
        } else if (irealText && looksLikeIreal(irealText)) {
          const songs = irealSongs(irealText);
          const picked = songs.length === 1 ? songs[0] : await pickSong({ songs, label: (k, p) => t(k, p), allowMerge: true }); const song = picked?.merge ? mergeIrealSongs(picked.songs) : picked; // « Merge parts »: the parts of one long song become one work
          if (!song) return; // the user gave up the choice
          imported = importIrealSong(song, { lang });
        } else imported = songsterr ? await importSongsterrBytes(file.bytes, { lang }) : guitarPro ? await importGuitarProBytes(file.bytes) : await importMusicXmlBytes(file.bytes);
        if (imported.errors.length) { // the file would give an invalid work: nothing is loaded
          openImportReport({ report: imported.report, problems: imported.errors, title: t('import.title', { name: file.name }), label: (k, p) => t(k, p) });
          say(t('import.error', { message: imported.errors[0] }));
          return;
        }
        work = imported.work;
        if (guitarPro) await offerDrumConversion(work);
      } else work = workFromFileText(new TextDecoder().decode(file.bytes));
      clearAssets();
      works.opened = work; openedName = file.name; excerpt = null; excerptMenu.set('');
      workMenu.set('opened'); current = work;
      render();
      const sheetHint = imported && !imported.videos?.length && work.movements.length === 1 && work.movements[0].masterbars.length >= 4 ? ` ${t('split.importHint')}` : ''; // one long movement: perhaps a sheet of exercises
      say(`${t('file.loaded', { name: file.name })}${sheetHint}`);
      if (imported && imported.report.items.length) openImportReport({ report: imported.report, title: t('import.title', { name: file.name }), label: (k, p) => t(k, p) });
      if (imported?.videos?.length) { // a Songsterr song: the video (the main one first) with the score under it, as on the site
        const videos = usableVideos(imported.videos, work.movements[0].masterbars.length);
        if (!videos.length) say(t('video.noneUsable'));
        else if (location.protocol === 'file:') say(t('youtube.needsHttp'));
        else startVideoSession({ work, videos, sections: imported.sections ?? [] });
      }
    } catch (e) {
      say(t('file.error', { message: friendlyImportError(e, t) }));
    }
  };
  /** A Guitar Pro drum track has its own map (every sound in voice 1): offers to give it the Scorsaire drum map and voices (kick in voice 2, stems down). The work is changed in place. */
  const offerDrumConversion = async (imported) => {
    const staves = foreignDrumStaves(imported);
    if (!staves.length) return;
    const yes = await confirmDialog({ message: t('import.drumConvert'), label: (k, p) => t(k, p), confirmText: t('import.drumConvertYes'), cancelText: t('import.drumConvertNo') });
    if (!yes) return;
    const temp = createDocument(imported);
    const res = temp.transaction('drums', () => convertDrumsToScorsaire(temp, staves));
    if (res.failed) say(t('import.drumConvertFailed', { count: String(res.failed) }));
  };
  /** The work a file gives through the importer of its format (MusicXML, Guitar Pro, iReal, Songsterr, a Scorsaire file) WITHOUT opening it: what "Import a file here…" reads. Throws on an unreadable file. */
  const readWorkOnly = async (file) => {
    if (isScorsaireArchive(file.bytes) || isAllInOneArchive(file.bytes)) throw Object.assign(new Error(t('importHere.archive')), { friendly: true });
    const songsterr = isSongsterrArchive(file.bytes);
    const midi = !songsterr && isMidiFile(file.bytes);
    const guitarPro = !songsterr && !midi && isGuitarProFile(file.name, file.bytes);
    const textLike = !guitarPro && !midi && !(file.bytes[0] === 0x50 && file.bytes[1] === 0x4b) && (/\.(html?|txt)$/i.test(file.name) || file.bytes[0] === 0x3c);
    const irealText = textLike ? new TextDecoder().decode(file.bytes) : null;
    if (midi || songsterr || guitarPro || isMusicXmlFile(file.name, file.bytes) || (irealText && looksLikeIreal(irealText))) {
      let imported;
      if (midi) {
        imported = await importMidiFile(file);
        if (!imported) return null; // the user gave up the window
      } else if (irealText && looksLikeIreal(irealText)) {
        const songs = irealSongs(irealText);
        const picked = songs.length === 1 ? songs[0] : await pickSong({ songs, label: (k, p) => t(k, p), allowMerge: true }); const song = picked?.merge ? mergeIrealSongs(picked.songs) : picked; // « Merge parts »: the parts of one long song become one work
        if (!song) return null; // the user gave up the choice
        imported = importIrealSong(song, { lang });
      } else imported = songsterr ? await importSongsterrBytes(file.bytes, { lang }) : guitarPro ? await importGuitarProBytes(file.bytes) : await importMusicXmlBytes(file.bytes);
      if (imported.errors.length) throw new Error(imported.errors[0]);
      return imported.work;
    }
    return workFromFileText(new TextDecoder().decode(file.bytes));
  };
  /**
   * "Import a file here…" with a MIDI file: ONE window (the MIDI one) with « Insert » (the chosen parts go on the staff of `target` and on the staves after it, from its measure)
   * or « Open as a new piece ». An insertion that cannot be complete (not enough staves, another time signature) is warned about, never refused.
   */
  const importMidiHere = async (file, target, viewId) => {
    try {
      const doc = app5.doc;
      const bar = doc.find(target.measureId); const mv = bar && doc.movementOf(bar);
      if (!mv) return;
      const at = mv.masterbars.indexOf(bar);
      const staves = flatStaves(mv).filter((st) => !isLinkedStaff(st));
      const track = mv.tracks.find((tr) => tr.staves.some((st) => st.id === target.staffId));
      // the search starts at the first own staff of the clicked track (a clicked tab staff is a projection: the notes go on the notation staff of its track)
      const from = Math.max(0, staves.findIndex((st) => track?.staves.some((x) => x.id === st.id)));
      const typeOfStaff = (st) => st.props?.[PID.STAFF_TYPE];
      /** The staff each part lands on: the first staff of the right kind from the clicked track on, one staff per part (null = no room). */
      const placeParts = (list) => {
        const used = new Set();
        return list.map((p) => {
          const st = staves.slice(from).find((s) => !used.has(s.id) && typeOfStaff(s) === (p.drums ? 'percussion' : 'score'));
          if (st) used.add(st.id);
          return st ?? null;
        });
      };
      const where = `${t('midi.insert.measure', { measure: at + 1 })}${track?.props?.[PID.NAME] ? ` · ${track.props[PID.NAME]}` : ''}`;
      const lyricsStaff = flatStaves(mv).filter((st) => !isLinkedStaff(st)).find((st) => typeOfStaff(st) === 'lyrics') ?? null;
      const options = await askMidi(file, (info) => ({
        where,
        lyrics: !!lyricsStaff,
        check: (ids) => {
          const list = info.parts.filter((p) => ids.includes(p.id));
          const missing = placeParts(list).filter((x) => !x).length;
          const here = getProperty(bar, PID.TIME_SIG);
          const other = here && (here[0] !== info.timeSig[0] || here[1] !== info.timeSig[1]);
          return [missing ? t('midi.insert.short', { n: missing }) : '', info.lyrics && !lyricsStaff ? t('midi.insert.noLyrics') : '', info.markers ? t('midi.insert.noMarkers') : '', other ? t('midi.insert.timeSig', { source: `${info.timeSig[0]}/${info.timeSig[1]}`, target: `${here[0]}/${here[1]}` }) : ''].filter(Boolean).join(' ');
        },
      }));
      if (!options) return;
      if (options.mode === 'open') {
        if (!(await confirmReplace())) return;
        await openFileObject(file, options);
        return;
      }
      const imported = await runMidi(file, { ...options, markers: 'off', lyrics: lyricsStaff ? options.lyrics : 'off' });
      if (imported.errors.length) { openImportReport({ report: imported.report, problems: imported.errors, title: t('import.title', { name: file.name }), label: (k, p) => t(k, p) }); say(t('import.error', { message: imported.errors[0] })); return; }
      const info = describeMidi(file.bytes);
      const list = info.parts.filter((p) => options.parts.includes(p.id));
      const slots = placeParts(list);
      const sources = importableStaves(imported.work).filter((s) => s.notes);
      const items = []; let skippedParts = 0;
      slots.forEach((st, i) => {
        if (!st || !sources[i]) { skippedParts += 1; return; }
        const payload = importPayload(imported.work, sources[i].id, { lyrics: false });
        items.push({ payload, target: { staffId: st.id, measureId: target.measureId, position: target.position } });
      });
      if (!items.length) { say(t('midi.insert.none')); return; }
      const placed = items.length;
      const lyricsFrom = imported.work.movements[0] && flatStaves(imported.work.movements[0]).find((st) => typeOfStaff(st) === 'lyrics');
      if (lyricsFrom && lyricsStaff) items.push({ payload: importPayload(imported.work, lyricsFrom.id, { lyrics: true }), target: { staffId: lyricsStaff.id, measureId: target.measureId, position: target.position } });
      const r = app5.importPayloads(target, items, viewId);
      say([t('importHere.done', { measure: at + 1 }), skippedParts ? t('midi.insert.left', { n: skippedParts }) : '', r.addedMeasures ? t('importHere.added', { n: r.addedMeasures }) : '', r.skipped ? t('importHere.skipped', { n: r.skipped }) : ''].filter(Boolean).join(' '));
      // the report says what REALLY went into the piece
      const report = { ...imported.report, stats: { ...imported.report.stats, tracks: placed } };
      if (skippedParts) report.items = [{ level: 'warning', code: 'midi.insert.left', message: 'Some parts of the file were not inserted', count: skippedParts }, ...report.items];
      openImportReport({ report, title: t('import.title', { name: file.name }), label: (k, p) => t(k, p), summaryKey: 'midi.insert.summary' });
    } catch (e) {
      say(e?.friendly ? e.message : t('file.error', { message: friendlyImportError(e, t) }));
    }
  };
  /** "Import a file here…" (a button of the range bar and of the chosen-measure bar): the file is read, one of its staves is chosen in a window, and it is pasted on the staff of `target` from its measure. */
  const importHere = async (target, viewId = 'main') => {
    let file;
    try { file = await pickFile(); } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); return; } // (picking first: the gesture of the button)
    if (!file || !app5) return;
    if (isMidiFile(file.bytes)) { await importMidiHere(file, target, viewId); return; }
    if (file.bytes[0] === 0x7b || /\.(txt|json)$/i.test(file.name)) { // a melody copied from Hookpad (Hooktheory) and saved as text: pasted on the staff of `target`
      let payload = null;
      try { payload = app5.parseClipboardText(new TextDecoder().decode(file.bytes), target); } catch (e) {
        if (e?.hooktheory) { say(t(`hooktheory.${e.hooktheory}`)); return; }
        say(t('file.error', { message: friendlyImportError(e, t) })); return;
      }
      if (payload?.hooktheory) {
        try {
          const r = app5.paste(target, viewId, payload);
          const h = payload.hooktheory;
          say([t('hooktheory.pasted', { n: h.notes, key: `${h.key.tonic} ${h.key.scale}` }), r.addedMeasures ? t('importHere.added', { n: r.addedMeasures }) : '', h.quantized ? t('hooktheory.quantized', { n: h.quantized }) : '', h.chords ? t('hooktheory.chordsIgnored') : ''].filter(Boolean).join(' — '));
        } catch (e) { say(t('file.error', { message: friendlyImportError(e, t) })); }
        return;
      }
    }
    try {
      const work = await readWorkOnly(file);
      if (!work) return;
      const doc = app5.doc;
      const bar = doc.find(target.measureId); const mv = bar && doc.movementOf(bar);
      if (!mv) return;
      const at = mv.masterbars.indexOf(bar);
      const track = mv.tracks.find((tr) => tr.staves.some((st) => st.id === target.staffId));
      const pieceChordStaff = flatStaves(mv).filter((st) => !isLinkedStaff(st)).find((st) => st.props?.[PID.STAFF_TYPE] === 'chord') ?? null;
      const fileChords = chordPayloadOf(work);
      openImportIntoDialog({
        label: (k, p) => t(k, p), staves: importableStaves(work), where: { staffName: track?.props?.[PID.NAME] ?? '', measure: at + 1 },
        fileHasChords: !!fileChords, pieceHasChords: !!pieceChordStaff, timeSig: timeSignatureDifference(work, mv, at),
        onImport: ({ staffId, lyrics, chords }) => {
          const items = [{ payload: importPayload(work, staffId, { lyrics }) }];
          if (chords && fileChords && pieceChordStaff) items.push({ payload: fileChords, target: { staffId: pieceChordStaff.id, measureId: target.measureId, position: target.position } });
          const r = app5.importPayloads(target, items, viewId);
          say([t('importHere.done', { measure: at + 1 }), r.addedMeasures ? t('importHere.added', { n: r.addedMeasures }) : '', r.skipped ? t('importHere.skipped', { n: r.skipped }) : ''].filter(Boolean).join(' '));
        },
      });
    } catch (e) {
      say(e?.friendly ? e.message : t('file.error', { message: friendlyImportError(e, t) }));
    }
  };
  /** The page address `#file=<address>&t=<token>[&media=<base>]` (the school portal's "Modify" button): the file is fetched with the token and opened as if it had been picked. */
  const openShared = async (bytes) => {
    try {
      if (!(await guardDraftBeforeOpening())) { say(t('share.waiting')); return; }
      say(t('share.opening'));
      await openFileObject({ name: 'envoi.scorsaire', bytes });
      try { history.replaceState(null, '', location.pathname); } catch { /* the address stays */ }
      say(t('share.opened'));
    } catch (e) { say(t('share.badLink', { message: friendlyImportError(e, t) })); }
  };
  const openFromAddress = async (url) => {
    try {
      if (!portal && !(await guardDraftBeforeOpening())) return; // (the address stays: a reload opens it later)
      say(t('portal.loading'));
      let bytes;
      if (portal) bytes = (await portal.fetchFile()).bytes; // portal mode: the token comes from memory, the ETag is kept for the save
      else {
        const r = await authFetch(url);
        if (!r.ok) throw Object.assign(new Error(String(r.status)), { status: r.status });
        bytes = new Uint8Array(await r.arrayBuffer());
      }
      const tail = decodeURIComponent((url.split('?')[0].split('/').filter(Boolean).pop() ?? '')) || 'fichier';
      await openFileObject({ name: /\.[a-z0-9]+$/i.test(tail) ? tail : `${tail}.scorsaire`, bytes });
      const first = portal?.address.movement;
      if (first && app5?.view('main')?.setMovementId(first)) mounted?.refresh?.(); // the passage the portal asked to show first
    } catch (e) {
      say([401, 403, 410].includes(e.status) ? t('portal.noAccess') : t('file.error', { message: friendlyImportError(e, t) }));
    }
  };
  if (engineManager) { audioSection = mountAudioSection({ manager: engineManager, label: (k, p) => t(k, p) }); engineManager.init(); }
  const screenOptions = [['one', t('screen.one')], ['two', t('screen.two')], ['three', t('screen.three')], ['four', t('screen.four')], ['yt', t('screen.yt')]];
  const screenMenu = choice(screen, (v) => { screen = v; fileDrawer?.setScreen(v); syncScreen(); });
  // the screen choice sits in the top row of the dock, next to play (on every screen)
  const dockScreen = createChoiceMenu({ options: screenOptions, value: screen, label: t('screen.label'), act: 'dock-screen', follow: true, onPick: (v) => { screen = v; screenMenu.set(v); fileDrawer?.setScreen(v); syncScreen(); } });
  dockScreen.style.flex = 'none'; dock.topLeft.append(dockScreen);
  // staff display size: a scrub pill left of the Back button; the view follows the drag (throttled), the final value is committed at release
  {
    let last = 0; let timer = null;
    const apply = (v) => { clearTimeout(timer); timer = null; last = Date.now(); if (ui.get('staffSpace') !== v) ui.set('staffSpace', v); };
    const live = (v) => { const wait = 90 - (Date.now() - last); if (wait <= 0) apply(v); else { clearTimeout(timer); timer = setTimeout(() => apply(v), wait); } };
    const sizeLabel = t('dock.staffSize');
    const sizePill = createScrubPill({ min: 4, max: 22, value: ui.get('staffSpace'), step: 1, pxPerStep: 6, format: (v) => `${v} px`, title: sizeLabel, label: { down: sizeLabel, up: sizeLabel }, onPreview: live, onCommit: apply });
    sizePill.el.style.flex = 'none'; sizePill.el.style.whiteSpace = 'nowrap'; sizePill.el.setAttribute('data-staff-size', '');
    dock.topRight.insertBefore(sizePill.el, dock.back);
    // a phone (≤ 600 px) has no room for them in the top row: both live in the settings, "This device" (undo / redo stay); the screen choice shows only "Écran N" (its list shows the full names)
    const phoneRow = document.createElement('style');
    phoneRow.textContent = 'html[data-phone] [data-dock] [data-staff-size],html[data-phone] [data-dock] [data-action="appearance"]{display:none !important}html[data-phone] [data-dock] [data-act="dock-screen"] span{display:block;max-width:3.7em;overflow:hidden;text-overflow:clip;white-space:nowrap}html[data-phone] [data-sys-menu="keysig"]{display:none !important}';
    document.head.append(phoneRow);
    ui.subscribe((key, value) => { if (key === 'staffSpace') sizePill.setValue(value); });
  }
  { // computers: the play / stop / options / screen row lives in the page header, on the line of the Work and Movement tabs
    const mq = window.matchMedia(SHEET_QUERY); const place = () => { dock.setTopHost(mq.matches ? null : $('top-slot')); dockScreen.style.order = mq.matches ? '' : '-1'; };
    place(); mq.addEventListener?.('change', place);
    const placeBase = () => dock.setBaseHost(mq.matches ? null : $('base-slot'));
    placeBase(); mq.addEventListener?.('change', placeBase);
  }
  let dockLogoEl = null;
  { // a tablet or a phone: no logo band at the top (the room goes to the score); the logo is small at the right of the bottom row on a tablet, and at the head of the file sheet on a phone
    const mq = window.matchMedia(SHEET_QUERY);
    const bandLogo = document.querySelector('.titlebar h1');
    const dockLogo = document.createElement('img');
    dockLogo.src = logoUri(); dockLogo.alt = t('app.title'); dockLogo.setAttribute('data-logo', '');
    dockLogo.style.cssText = 'height:24px;width:auto;margin-left:auto;align-self:center;flex:none;padding:0 4px;pointer-events:none';
    dockLogoEl = dockLogo;
    const phone = () => isPhone();
    const placeLogo = () => { const touch = mq.matches; if (bandLogo) bandLogo.style.display = touch ? 'none' : ''; dockLogo.style.display = touch && !phone() && !dock.bottomMode() ? '' : 'none'; /* (another drawer takes the row: the logo steps aside) */ };
    placeLogo(); mq.addEventListener?.('change', placeLogo); window.addEventListener('resize', placeLogo); dock.onMode(placeLogo);
  }
  // the file drawer of the dock: the same actions as the page header (which will go away), reached through it
  fileDrawer = mountFileDrawer({ dock, label: (k, p) => t(k, p), actions: {
    portal: portal ? { saveCopy: saveToDisk, back: backToPortal, canBack: () => !!portal.address.returnTo || !!window.opener } : null,
    open: openFile, save: saveFile, newScore: newFile, newYouTube, addParts: addSongsterrParts, canAddParts: () => !!syncSession && !syncSession.mode && !syncSession.video, createSync: () => syncCreation(), canCreateSync: () => !portal && !!app5 && current !== 'legend', redoSync: () => syncCreation({ redo: true }), canRedoSync: () => !portal && !!syncSession && syncSession.mode !== 'placements' && syncSession.work === current, editSync: () => startMapEdit(), canEditSync: () => !portal && mapEditAvailable(), addAudio: addAnalysisAudio, canAddAudio: () => !syncSession || !!syncSession.video,
    exportOptions: exportOptions.filter(([v]) => v), onExport: (v) => exportHandler(v), recueil: openRecueil, share: openShare, pupilLinks: openPupilLinks,
    sheetLogo: () => { if (!isPhone()) return null; const i = document.createElement('img'); i.src = logoUri(); i.alt = t('app.title'); i.setAttribute('data-logo', ''); i.style.cssText = 'height:26px;width:auto;display:block'; return i; }, // phone: the logo is not in the bars, it heads the file sheet
    beforeOpen: () => { if (app5?.noteEntry?.().active) app5.setNoteEntry({ active: false }); },
    workPanel: (id) => { if (sidebar.isEnabled()) sidebar.show(id); else headerTabs?.toggle(id); },
    tracks: () => { if (screen === 'two') partsScreen?.toggleTracks(); else if (screen !== 'three') tracksPanel?.toggle(); }, settings: () => settingsPanel?.toggle(),
    staffSize: { get: () => ui.get('staffSpace'), set: (v) => ui.set('staffSpace', v) },
    screenOptions, screenValue: () => screen, onScreen: (v) => { screen = v; screenMenu.set(v); syncScreen(); },
  } });
  (dock.bottomBase.parentElement ?? dock.bottomBase).append(dockLogoEl); // the logo is the LAST thing of the bottom row, pushed to its right end
  // view mode: remembered on this device, never in the document
  const viewModeMenu = choice(viewMode, (m) => {
    viewMode = m;
    try { browserStorage?.setItem('scorsaire.viewMode', m); } catch { /* the choice is kept for this page only */ }
    render();
  });
  $('view-host').addEventListener('scorsaire:layout', (e) => {
    $('layoutTime').textContent = t('view.layoutTime', { ms: Math.round(e.detail.ms) });
    if (!$('stats').textContent && app5 && current !== 'legend') { const v = app5.view('main'); const layout = v?.isCold() ? null : v?.layout(); if (layout) { $('stats').textContent = t('demo.stats', { systems: layout.systems.length, measures: v.movement().masterbars.length }); document.documentElement.dataset.systems = String(layout.systems.length); } }
  }); // cost of the last full recomputation
  pianoDrawer.setExtras([
    { id: 'view', title: t('view.toggle'), icon: () => drawnById(viewMode === 'scroll' ? 'view:scroll' : 'view:wrap'), isOn: () => viewMode === 'scroll', toggle: () => viewModeMenu.pick(viewMode === 'scroll' ? 'wrap' : 'scroll'), subscribe: () => () => {} },
    { id: 'concert', title: t('view.concertToggle'), icon: () => { const s = document.createElement('span'); s.textContent = 'C'; s.style.cssText = 'font:var(--w-bold,700) 15px var(--ui-font,sans-serif);line-height:1'; return s; }, isOn: () => ui.get('concertPitch'), toggle: () => ui.set('concertPitch', !ui.get('concertPitch')), subscribe: (fn) => ui.subscribe((k) => { if (k === 'concertPitch') fn(); }) },
  ]);
  installPanScroll($('score-host'), { enabled: () => $('score-host').dataset.viewMode === 'scroll' }); // mouse drag scrolls the one-system view
  const buttonSize = applyButtonSize({ storage: browserStorage });
  const looks = applyLooks(browserStorage);
  const onOff = (k) => choice(looks.get(k) ? 'on' : 'off', (c) => looks.set(k, c === 'on'));
  const scrollMenu = onOff('scroll');
  const reliefMenu = onOff('relief');
  const buttonSizeMenu = choice(buttonSize.choice(), (c) => buttonSize.set(c));
  const displayModeMenu = choice(displayMode.choice(), (c) => displayMode.set(c));
  // language: the choice is kept on this device; the page is rebuilt in the new language by a reload
  // (the demo documents are recreated, so edits made in the demo are not kept)
  const langMenu = choice(langChoice, (c) => {
    saveLangChoice(browserStorage, c);
    if (readLangChoice(browserStorage) === c && c !== langChoice) window.location.reload();
  });
  // keyboard entry of frets on a tablature (like MuseScore): an option, off by default, kept in the preferences of this device
  const workOptions = [['linked', 'demo.workLinked'], ['noteEntry', 'demo.workNoteEntry'], ['tablature', 'demo.workTablature'], ['marks', 'demo.workTablatureMarks'], ['techniques', 'demo.workTablatureTechniques'], ['scoretech', 'demo.workScoreTechniques'], ['capo', 'demo.workCapo'], ['perc', 'demo.workPercussion'], ['percLines', 'demo.workPercussionLines'], ['percPresets', 'demo.workPercussionPresets'], ['percRests', 'demo.workPercussionRests'], ['percSticking', 'demo.workPercussionSticking'], ['fingering', 'demo.workFingering'], ['fingering2', 'demo.workFingering2'], ['accordion', 'demo.workAccordion'], ['jumps', 'demo.workJumps'], ['breaths', 'demo.workBreaths'], ['trills', 'demo.workTrills'], ['dynamics', 'demo.workDynamics'], ['transpose', 'demo.workTranspose'], ['doClefs', 'demo.workDoClefs'], ['doTranspose', 'demo.workDoTranspose'], ['cclefs', 'demo.workCClefs'], ['tempo', 'demo.workTempo'], ['pedal', 'demo.workPedal'], ['crossStaff', 'demo.workCrossStaff'], ['rhythm', 'demo.workRhythm'], ['lyrics', 'demo.workLyrics'], ['staffText', 'demo.workStaffText'], ['containers', 'demo.workContainers'], ['chords', 'demo.workChordSymbols'], ['chordPatterns', 'demo.workChordPatterns'], ['legend', 'demo.workDrumLegend'], ['verif', 'demo.workVerification'], ['architecture', 'demo.workArchitecture'], ['stress', 'demo.workStress'], ['stress27', 'demo.workStress27'], ['stress33', 'demo.workStress33'], ['opened', 'file.opened']];
  const workMenu = choice('noteEntry', (v) => { excerpt = null; excerptMenu.set(''); current = v === 'legend' ? 'legend' : (works[v] ?? current); render(); });
  const excerptMenu = choice('', (id) => {
    excerpt = excerpts.find((e) => e.id === id) ?? null;
    if (excerpt) current = excerpt.work; else current = works[workMenu.get()] ?? current;
    render();
  });

  // settings panel sections: display, interface, audio, demonstrations: display, interface, audio, demonstrations
  const colorProbe = mountColorProbe({ label: (k, p) => t(k, p) }); // debugging tool: which colour does the screen show here?
  // on a phone the two settings that decide how everything is laid out come FIRST in the settings (the staff size is not in the page header there): the size of the writing, then the display type
  const onPhone = () => isPhone();
  const staffSizeRow = { id: 'staff-size', titleKey: 'dock.staffSize', ctl: { get: () => String(ui.get('staffSpace')), pick: (v) => ui.set('staffSpace', Number(v)) }, options: Array.from({ length: 19 }, (_, i) => [String(i + 4), `${i + 4} px`]) };
  const displayModeRow = { id: 'display-mode', titleKey: 'displayMode.label', ctl: displayModeMenu, options: DISPLAY_MODES.map((c) => [c, t('displayMode.' + c)]) };
  const buildExtra = () => buildExtraSections({
    label: (k, p) => t(k, p),
    github: { get: githubRepoList, save: setGithubRepos, copy: async (text) => { try { await navigator.clipboard.writeText(text); say(t('githubPublish.copied')); } catch { say(t('githubPublish.copyFailed')); } }, open: (url) => { window.open(url, '_blank', 'noopener'); } },
    display: {
      menus: [...(onPhone() ? [staffSizeRow, displayModeRow] : []), { id: 'view-mode', titleKey: 'view.mode', ctl: viewModeMenu, options: [['wrap', t('view.wrap')], ['scroll', t('view.scroll')]] },
        { id: 'tab-key-style', titleKey: 'settings.tabKeyStyle', ctl: { get: () => inputOptionsOf(app5?.preferences).tabKeyStyle, pick: (v) => app5?.preferences.set('inputOptions', { tabKeyboard: inputOptionsOf(app5.preferences).tabKeyboard, tabKeyStyle: v }) }, options: [['musescore', t('settings.tabKeyStyle.musescore')], ['guitarpro', t('settings.tabKeyStyle.guitarpro')]] },
        { id: 'selection-style', titleKey: 'settings.selectionStyle', ctl: { get: () => app5?.preferences.get('selectionStyle')?.mode ?? 'colored', pick: (v) => app5?.preferences.set('selectionStyle', { mode: v }) }, options: [['colored', t('settings.selectionColored')], ['halo', t('settings.selectionHalo')], ['classic', t('settings.selectionClassic')]] }],
      numbers: [{ id: 'scroll-max', labelKey: 'view.maxMeasures', min: 8, max: 2000, step: 8, get: () => ui.get('scrollMax'), set: (n) => { const v = Math.round(n); if (Number.isFinite(v) && v >= 8) ui.set('scrollMax', Math.min(2000, v)); } }],
      toggles: [
        { id: 'show-muted', labelKey: 'demo.showMuted', get: () => ui.get('showMuted'), set: (v) => ui.set('showMuted', v) }, { id: 'show-hidden', labelKey: 'demo.showHidden', get: () => ui.get('showHidden'), set: (v) => ui.set('showHidden', v) },
        { id: 'visual-solo-audio', labelKey: 'settings.visualSoloAudio', get: () => ui.get('visualSoloAudio'), set: (v) => ui.set('visualSoloAudio', v) },
        { id: 'track-controls', labelKey: 'settings.trackControls', get: () => ui.get('trackControls'), set: (v) => ui.set('trackControls', v) },
        { id: 'show-cells', labelKey: 'chordEntry.showCells', get: () => ui.get('showCells'), set: (v) => ui.set('showCells', v) }, { id: 'chord-fit', labelKey: 'demo.chordFit', get: () => ui.get('chordFit'), set: (v) => ui.set('chordFit', v) },
        { id: 'chord-under', labelKey: 'chordEntry.underStaff', get: () => (app5?.preferences.get('chordEntry')?.placement ?? 'under') !== 'bottom', set: (v) => { app5?.preferences.set('chordEntry', { ...app5.preferences.get('chordEntry'), placement: v ? 'under' : 'bottom' }); } },
        { id: 'tab-keyboard', labelKey: 'settings.tabKeyboard', get: () => ui.get('tabKeyboard'), set: (v) => ui.set('tabKeyboard', v) }, { id: 'chord-qualities', labelKey: 'chordQuality.show', get: () => ui.get('showChordQualities'), set: (v) => ui.set('showChordQualities', v) },
      ],
    },
    device: { buttons: !isPhone() ? [] : [{ id: 'appearance', titleKey: 'appearance.title', textKey: 'settings.open', run: () => appearanceButton.click() }], menus: [
      ...(onPhone() ? [] : [displayModeRow]),
      { id: 'button-size', titleKey: 'buttonSize.label', ctl: buttonSizeMenu, options: BUTTON_SIZE_CHOICES.map((c) => [c, t('buttonSize.' + c)]) },
      { id: 'slim-scroll', titleKey: 'looks.scroll', ctl: scrollMenu, options: [['on', t('looks.on')], ['off', t('looks.off')]] },
      { id: 'btn-relief', titleKey: 'looks.relief', ctl: reliefMenu, options: [['on', t('looks.on')], ['off', t('looks.off')]] },
      { id: 'staff-lines', titleKey: 'staffLines.label', ctl: { get: () => staffLines.get(), pick: (v) => staffLines.set(v) }, options: STAFF_CHOICES.map((c) => [c, t('staffLines.' + c)]) },
      { id: 'ui-font', titleKey: 'uiFont.label', ctl: { get: () => uiFont.get(), pick: (v) => uiFont.set(v) }, options: FONT_CHOICES.map((c) => [c, t('uiFont.' + c)]) },
      { id: 'glyph-weight', titleKey: 'glyphWeight.label', ctl: { get: () => glyphWeight.get(), pick: (v) => glyphWeight.set(v) }, options: GLYPH_CHOICES.map((c) => [c, t('glyphWeight.' + c)]) },
      { id: 'lang', titleKey: 'lang.label', ctl: langMenu, options: LANG_CHOICES.map((c) => [c, t('lang.' + c)]) },
    ] },
    demos: { menus: [
      { id: 'work', titleKey: 'demo.work', ctl: workMenu, options: workOptions.map(([v, k]) => [v, t(k)]) },
      { id: 'excerpt', titleKey: 'listen.title', ctl: excerptMenu, options: [['', '—'], ...excerpts.map((e) => [e.id, t(e.label)])] },
    ] },
    debug: { probe: colorProbe },
    audioEl: audioSection?.el ?? null,
    strumEl: app5 ? (strumSection ??= mountStrumCardsSection({ app: app5, label: (k, p) => t(k, p) })).el : null,
    colorsEl: buildColorSection({ label: (k, p) => t(k, p), storage: browserStorage }),
    audition: [
      { id: 'chord-sound', labelKey: 'audio.chordSymbols', get: () => app5?.preferences.get('playback')?.chordSymbols !== false, set: (on) => { app5?.preferences.set('playback', { chordSymbols: on }); setChordSymbolsSound(on); player?.invalidate(); } },
      { id: 'audition', labelKey: 'audio.audition', get: () => app5?.preferences.get('audition')?.notes !== false, set: (on) => { app5?.preferences.set('audition', { ...app5.preferences.get('audition'), notes: on }); } },
      { id: 'audition-select', labelKey: 'audio.auditionSelect', get: () => app5?.preferences.get('audition')?.select !== false, set: (on) => { app5?.preferences.set('audition', { ...app5.preferences.get('audition'), select: on }); } },
    ],
  });

  const addressFile = portal ? portal.address.file : pageParams().get('file');
  const sharedBytes = portal ? null : bytesFromParams(pageParams()); // a piece sent by link (`#z=`): it opens at once; the long address is then taken off so that a reload does not open it again over the work
  if (addressFile) openFromAddress(addressFile);
  else if (sharedBytes) openShared(sharedBytes);
  else offerDraft();
  mountPanelResize(); // editing windows (bend graph, staff properties, drum cards…) can be resized by their corner
  mountThemeColor(); // the title bar of the installed window follows the theme (only where the page has a theme-color tag: the installed build)
  if (!portal) mountPwaUpdate({ t: (k, p) => t(k, p), confirmReplace }); // the installed editor (a page with a manifest): its service worker and the offer of a new version; NEVER in portal mode
  render();
  document.documentElement.dataset.ready = 'true';
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
