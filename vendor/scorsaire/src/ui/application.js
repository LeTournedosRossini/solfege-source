/*
 * Application — registre des vues vivantes et porte d'édition. AUCUN DOM.
 *
 * `edit(nom, fn)` : ramasse l'état « avant » de CHAQUE vue vivante, exécute `doc.transaction(nom, fn, { before })`, puis range
 * l'état « après » (`doc.setViewAfter`). Charge utile : `{ views: { <idVue>: <état de la vue> } }`. Le Document n'en connaît pas le
 * contenu ; undo/redo la renvoient dans `event.view` et chaque vue y reprend sa part.
 */
import { addLyricsTrackIntent } from '../model/lyricevents.js';
import { sheetDividers } from '../model/dividers.js';
import * as creationIntents from './creation-intents.js';
import { deletableIds, deleteElements } from './delete-intents.js';
import { restTargets, rangeRestTargets, nextRestsHidden, toggleRestsHidden } from './rest-intents.js';
import { toggleDecorHidden, nextDecorHidden, toggleDecorHiddenEverywhere, nextDecorHiddenEverywhere } from './decor-intents.js';
import { togglePlay, setPlayScope, nextPlayValue, nextScopeValue, ownerOf } from './play-intents.js';
import * as marks from './marks-intents.js';
import { systemTarget, systemState, sys, staffOfTarget } from './system-intents.js';
import { capoStaves } from '../model/chordview.js';
import { profileFor } from '../audio/profiles.js';
import { instrumentInfo } from '../model/instruments.js';
import { addStaffText, updateStaffText, removeStaffText } from '../model/stafftextedit.js';
import { setContainerGap, CONTAINER_ZOOM_STEPS, setContainerScale, setContainerOwnSignature, setFragmentSignature, setContainerLayout, setContainerTransposeFollow, setContainerPlay, setContainerSpacing, addFragmentContainer, addSlotContainersEveryStaff, setFragmentMeasures, setFragmentHeader, addTextContainer, addSlotContainer, setSlotWidth, setSlotSeparator, addNestedContainer, setContainerSpan, setContainerText, moveContainer } from '../model/containeredit.js';
import { hasGrips } from '../model/grips.js';
import { addDiagramContainer } from '../model/containeredit.js';
import { resolveElementDiagram, chordPathFor, setSymbolSolver, followedDiagrams, chordSymbolsInSpan, setDiagramVoicing, resetDiagramVoicing, setDiagramSuggestion, setDiagramChord, setDiagramInstrument, setPreferredVoicing, clearPreferredVoicing, setDiagramGauge, setDiagramLift, setDiagramOrientation, setDiagramScale, diagramLook, styleLookup, diagramHostsIn, applyDiagramLook, LOOK_KEYS, tuningOfInstrument, setSymbolDiagramShown, resolveDiagram, chordKey, diagramChordOf, chordDiagramVoicing } from '../model/fretdiagram.js';
import { suggestVoicings, chordSpecFromSymbol } from '../model/fretsuggest.js';
import { INSTRUMENT_PRESETS } from '../model/fretvoicing.js';
import { libraryFor, addToLibrary, removeFromLibrary, inLibrary } from '../model/diagramlibrary.js';
import * as voicingPools from '../model/voicingpools.js';
import * as poolFrom from '../model/voicingpoolfrom.js';
import { suggestChordName } from '../model/chordrecognize.js';
import * as slashEdit from '../model/slashedit.js';
import { sameVoicing } from '../model/fretvoicing.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { setGrip, setAperture, resetGrips, reanchorSpanner, spannerVoiceChords } from '../model/gripedit.js';
import { addWheel, wheelInfo, setWheelCurve, resetWheelCurve, setWheelScope } from '../model/wheel.js';
import { glissandoRunInfo, addGlissandoRun, removeGlissandoRun } from '../model/glissandorun.js';
import { addBend, bendSemitones, setBendSemitones, bendCurveInfo, setBendCurve, resetBendCurve } from '../model/bendedit.js';
import * as settingsIntents from './settings-intents.js';
import { addPartContainer, removePartContainer, pastePartContainer, pasteStaffContainer, copyContainerToPart, movePartContainer, partContainersOf } from '../model/partcontainers.js';
import { setZoneDiagramList, addZoneCell, removeZoneCell, setZoneHeight, setZoneColumns, setZoneCellText, detachZoneCell, replaceZoneCell, setPartStaffGap, setStaffGap, setStaffGapAt, zonesOf } from '../model/partzones.js';
import * as sheetEdit from '../model/sheetedit.js';
import { canvasesOf, addCanvas, setCanvas, removeCanvas } from '../model/partedit.js';
import { planTimeSignature, changeTimeSignature, signatureSpanFrom } from '../model/timesigedit.js';
import { planKeySignature, changeKeySignature, keySignatureSpanFrom } from '../model/keysigedit.js';
import { lyricsSettings, lyricsPageValue, autoStrophes, freeTextStrophes, lyricsSource, setLyricsPage, LYRICS_PAGE_DEFAULTS } from '../model/lyricstrophes.js';
import { inlineCardColor } from '../model/sections.js';
import { setExtractLayout, addBlockPerMovement, addExtractBlock, updateExtractBlock, removeExtractBlock, moveExtractBlock, addBlockZone, addBlockContainer } from '../model/extracts.js';
import { addPart, removePart, movePart, renamePart, setPartRole, setPartReader, setPartStaves, setPartTrackOrder, setPartTransposition, setPartTransposeAll, setPartChordView, setPartPage, applyPageToAllParts, copyPartSettings, partStaffChoices, toggleBreak, lockSystem, unlockSystem, extendLock, setBreaksEvery, setHeaderFooter, setTitleBlock, setMeasureNumberMode, setMeasureCounting, setWorkMeta, setElementOverride, setTextStyle, setTextContent, textSourceOf } from '../model/partedit.js';
import { buildSequence } from '../audio/sequence.js';
import { perf } from '../perf/probe.js';
import { sequenceToMidi } from '../audio/midi.js';
import { exportMusicXml } from '../export/musicxml.js';
import { buildMxl } from '../export/zip.js';
import { velocityState, velocityTargets, setVelocity, stepVelocity } from './velocity-intents.js';
import * as entry from './chordentry-intents.js';
import { slotOptions as gridSlotOptions } from '../model/inputgrid.js';
import * as qualityIntents from './chordquality-intents.js';
import * as staffProps from './staffprops-intents.js';
import { bakeRhythmStaff, emptyBakeTargets, BakeError } from '../model/bakeplay.js';
import { allChordPatterns, createChordPattern, resolveChordPattern, setProjectChordPatterns, validateChordPattern } from '../model/chordpatterns.js';
import { allStrumCards, createStrumCard, resolveStrumCard, setProjectStrumCards, validateStrumCard, strumOptionsFor } from '../model/strumcards.js';
import * as guitarIntents from './guitar-intents.js';
import * as tracksIntents from './tracks-intents.js';
import { parseHooktheory, hooktheoryPayload } from '../import/hooktheory.js';
import { CLEF_DEFS } from '../layout/constants.js';
import { midiFromSpelling } from '../model/pitch.js';
import { contentStaff, isLinkedStaff } from '../model/linkedstaff.js';
import { playerOf, playerInstrumentOf, isAccompanimentTrack } from '../model/player.js';
import { removeTrack as removeTrackModel } from '../model/trackedit.js';
import { withRule, withoutRule } from '../model/variation.js';
import { allGrooves, createGroove, validateGroove, setProjectGrooves } from '../model/grooves.js';
import { allStyles, createStyle, validateStyle, setProjectStyles, roleOfTrack, addStylePlayer, setStylePlayer, STYLE_ROLES } from '../model/styles.js';
import { patternFromNotes } from '../model/patternfromnotes.js';
import { applyStyle as applyStyleToMovement, styleFromMovement, refreshStyleLibrary } from '../model/styleedit.js';
import { setCue as setCueModel, removeCue as removeCueModel, cueEntries } from '../model/cueedit.js';
import { applyGrid as applyGridModel, gridConflicts } from '../model/chordgridedit.js';
import { writeScale as writeScaleModel, createScaleMovement, addScaleContainer as addScaleContainerModel } from '../scales/write.js';
import { transposeMovement } from '../model/transposeedit.js';
import { splitMovement } from '../model/movementsplit.js';
import { intervalOfSemitones } from '../model/transpose.js';
import { gridById } from '../model/gridtemplates.js';
import { isChordTrack } from '../model/chordtrack.js';
import { addImageFile } from '../model/assets.js';
import * as blockEdit from '../model/blockedit.js';
import * as mixerIntents from './mixer-intents.js';
import * as automationIntents from './automation-intents.js';
import { createTake, takeSpan } from './automation-record.js';
import { locate } from '../audio/cursor.js';
import { measureLayout } from '../model/tempomap.js';
import { pasteLane, AUTOMATION_LANE_ORDER, faderOf, setPitchBendRange } from '../model/automation.js';
import { fAdd } from '../model/fraction.js';
import { playbackMixer, effectiveVolume, masterFactor } from '../audio/mixer.js';
import * as templateIntents from './template-intents.js';
import { parseDecorId } from '../model/decor.js';
import * as noteEntry from './noteentry-intents.js';
import * as keyboard from './noteentry-keyboard.js';
import * as recordingIntents from './recording-intents.js';
import { tieAction } from './noteentry-tie.js';
import * as lyrics from './lyrics-intents.js';
import { normalizeCursor, cursorOfElement, startOfStaff, moveByChord, moveByMeasure, nextInputPos } from './noteentry-cursor.js';
import { defaultFilter, normalizeFilter } from '../model/selectionfilter.js';
import { nextRangePlayValue, toggleRangePlay, nextRangeDecorHidden, toggleRangeDecorHidden } from './range-intents.js';
import { rangeChordSymbols, rangeItems } from '../model/range.js';
import { strumInstrumentOf } from '../model/fretdiagram.js';
import { hasPageHint, togglePageHint } from '../model/pagehints.js';
import { duplicatePart } from '../model/partedit.js';
import { addPartStaffText, updatePartStaffText, removePartStaffText, partStaffTextsOf } from '../model/partstafftext.js';
import { partStaffIds } from '../model/index.js';
import { setPartDividers, setSheetDividers, setCompositeJunction, setCompositeJunctionClef, compositesOf, addComposite, removeComposite, renameComposite, setCompositeBase, setCompositeEqual, setCompositeRange, setTrackDisplay, setPartTrackDisplay, trackLayer, resolveDisplay, movableIds, moveElements, resetOffsets, offsetOf, getProperty, resolveStyle, SID, PID, ZERO, tuningPitches, drumSwitchesFor, staffSoundMap, insertMeasures, deleteMeasures, clearRange, removeRangeMeasures, rangeMeasureSpan, rangeIsWholeMeasures, rangeFromMeasures, flatStaves, copyRange, serializeClipboard, clipboardSummary, pasteClipboard, canPaste, parseClipboard } from '../model/index.js';
import { createPreferencesStore } from './preferences-store.js';
import * as percEdit from '../model/percmapedit.js';
import * as percVoices from '../model/percvoices.js';
import * as voiceMove from '../model/voicemove.js';
import { EditError } from '../model/noteedit.js';
import { percmapPresets, percmapPreset, exportPercMap, importPercMap } from '../model/percmap.js';
import { viewsOf, activeViewId, applyView, saveCurrentView, renameView, removeView, moveView, setViewTracks, createView } from '../model/viewedit.js';
import { createChordQualities, exportChordQualities } from '../model/chordquality.js';
import { serializeChordPatterns, parseChordPatterns } from '../model/patternfile.js';

/** A chord written out for a list: letter, accidental, quality, bass ("Cmaj7/E"). */
const chordName = (chord) => {
  const note = (n) => `${n.step}${n.alter > 0 ? '♯'.repeat(n.alter) : n.alter < 0 ? '♭'.repeat(-n.alter) : ''}`;
  return `${note(chord.root)}${chord.quality ?? ''}${chord.bass ? `/${note(chord.bass)}` : ''}`;
};

export function createApplication({ doc, preferences = createPreferencesStore(), systemClipboard = null, lang = 'en' }) {
  let containerClipId = null; // the container copied (see containerClip)
  let extraHistory = null; let offExtra = null; let lastDocChange = 0; const historyListeners = new Set(); // see `setExtraHistory`
  const notifyHistory = () => { const st = { canUndo: doc.canUndo() || !!extraHistory?.canUndo(), canRedo: doc.canRedo() || !!extraHistory?.canRedo() }; for (const f of historyListeners) f(st); };
  doc.subscribe((e) => { if (e?.type === 'commit') lastDocChange = Date.now(); notifyHistory(); });
  const views = new Map();
  const compositePreview = new Map(); // track id → composite id: the screen 1 preview (session only)
  const previewListeners = new Set();
  // `systemClipboard` = { writeText(texte) } fourni par la page (aucun DOM ici) ou null
  // presse-papiers de plage : copie INTERNE (charge JSON « scorsaire-staff-list ») + texte dans le presse-papiers système si permis
  let clipboard = null;
  // filtre de sélection (voix, notes d'un accord, catégories) : état de l'APPLICATION, jamais dans le Document ; défaut = tout inclus
  let rangeFilter = defaultFilter();
  const filterListeners = new Set();
  // vélocités calculées par la lecture (id de note → 1-127), vidé à chaque changement du Document
  let velocityCache = null;
  doc.subscribe(() => { velocityCache = null; });
  const velocityTargetsOf = (ids) => velocityTargets(doc, ids ?? []).map((n) => n.id);
  const clipboardListeners = new Set();
  let viewSolo = false;
  const viewSoloListeners = new Set();
  // mixer session state (never in the Document): manual solo, live volume preview while a slider is dragged
  const soloIds = new Set();
  let blocksEditing = false; const blocksListeners = new Set();
  let visualSoloMemory = null; let visualSoloAudioOn = false; // the visual solo of screen 1 (what was shown before) and the option « it is also an audio solo »
  const mixerPreview = new Map();
  const panPreview = new Map(); // track id → pan being dragged (live, not saved until released)
  const mixerListeners = new Set();
  // recording a fader move into the automation (session state, see automation-record.js): armed tracks, the take of each touched track, the player
  const recordArmed = new Set();
  const takes = new Map(); // track id → take
  let playerRef = null;
  const automationShown = new Set(); // tracks whose automation strip is drawn (screen option)
  const automationViewListeners = new Set();
  let masterAutomationShown = false; // the strip of the master volume above the top staff (a screen option of this session)
  const automationLanes = new Map(); // track id → the lanes its strips show, in this order: ['volume'], ['pan'] or ['volume', 'pan'] (a screen option of this session)
  let automationScale = preferences?.get('automationScale')?.scale ?? 1; // height factor of the automation strips (a device preference)
  const notifyMixer = () => { for (const fn of [...mixerListeners]) fn(); };
  doc.subscribe((e) => { if ((e.changes ?? []).some((c) => c && c.kind === 'property' && [PID.MIXER_VOLUME, PID.MIXER_PAN, PID.MUTE, PID.MASTER_VOLUME, PID.MASTER_PAN].includes(c.pid))) { mixerPreview.clear(); panPreview.clear(); notifyMixer(); } });
  // état de la saisie de notes (mode, durée choisie, silence, frette, son) : état de l'APPLICATION, jamais dans le Document ni annulable
  let entryState = { ...noteEntry.DEFAULT_ENTRY };
  const entryListeners = new Set();
  const deferListeners = new Set();
  // saisie des paroles depuis la mélodie : état de l'APPLICATION (jamais dans le Document), rangé avec chaque transaction (annuler / refaire le restaurent)
  let lyricsState = { active: false, cursor: null, pending: null };
  const lyricsListeners = new Set();
  const notifyLyrics = () => { for (const fn of [...lyricsListeners]) fn({ ...lyricsState }); };
  const setLyrics = (patch) => { lyricsState = { ...lyricsState, ...patch }; notifyLyrics(); };
  const snapshot = () => ({ views: Object.fromEntries([...views].map(([id, v]) => [id, v.viewState()])), noteEntry: { cursor: entryState.cursor }, lyrics: { cursor: lyricsState.cursor, pending: lyricsState.pending } });
  const notifyEntry = () => { for (const fn of [...entryListeners]) fn({ ...entryState, duration: { ...entryState.duration } }); };
  const setEntry = (patch) => { entryState = { ...entryState, ...patch }; notifyEntry(); };
  // portée de départ du curseur : première portée de notation du premier Mouvement (MuseScore : la portée de la sélection ou de la page visible)
  // portée de départ du curseur de « N » : notation en priorité, sinon la 1re portée où l'on peut saisir (MuseScore ne filtre pas par type)
  const firstEntryStaff = () => {
    let other = null;
    for (const mv of doc.work.movements) for (const track of mv.tracks) for (const staff of track.staves) {
      const type = getProperty(staff, PID.STAFF_TYPE);
      if (type === 'score') return staff;
      if (!other && noteEntry.ENTRY_STAFF_TYPES.includes(type)) other = staff;
    }
    return other;
  };
  // note(s) just created by an entry gesture (interface state, never in the Document): the creation bar is shown while exactly these stay selected
  let creation = null; const creationListeners = new Set();
  const sameIds = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  // hearing what was just entered or retouched: listeners get the ids of the notes (the page plays the whole chord, see audio/audition.js)
  const auditionListeners = new Set();
  let cellPlayback = null; let cellPlaybackOff = null; const cellPlayListeners = new Set(); // see attachCellPlayback
  let containerPlayback = null; let containerPlaybackOff = null; const containerPlayListeners = new Set(); // see attachContainerPlayback
  // kind: 'create' = a note was placed or retouched, 'select' = a note was selected by a tap
  /** Keys pressed less than this apart (ms) are one chord even when the first is already released. */
  const CHORD_WINDOW_MS = 40;
  const played = { held: new Map(), last: null, lastAt: -Infinity }; // held: midi → time of the press; // keys held on the on-screen keyboard / fretboard and the note put by the previous key (MuseScore: `activeMidiPitches`)
  const emitAudition = (ids, kind = 'create') => { if (ids?.length) for (const fn of [...auditionListeners]) fn([...ids], kind); };
  const tabPreviewListeners = new Set(); // hearing the strings and frets of the sequential pad before anything is written: fn(staffId, [{ string, fret }])
  const clearCreation = () => { if (creation) { creation = null; for (const fn of [...creationListeners]) fn(); } };
  const markCreation = (viewId) => { const v = views.get(viewId); const ids = v?.selection() ?? []; creation = ids.length ? { ids: [...ids], viewId } : null; for (const fn of [...creationListeners]) fn(); };
  const selectedElements = (viewId) => (views.get(viewId)?.selection() ?? []).map((id) => doc.find(id)).filter(Boolean);
  const selectIds = (viewId, ids) => { const v = views.get(viewId); if (v && ids?.length) v.select(ids); };
  const idsOfCr = (cr) => (cr.type === 'chord' ? [cr.notes[0].id] : [cr.id]);
  // annuler / refaire : le curseur de saisie est rangé avec chaque transaction ; sinon il est simplement remis dans un état valable
  doc.subscribe((event) => {
    if (lyricsState.active && lyricsState.cursor) {
      const undoRedo = event.type === 'undo' || event.type === 'redo';
      const saved = undoRedo && event.view?.lyrics ? event.view.lyrics : lyricsState;
      const cursor = lyrics.normalizeLyricsCursor(doc, saved.cursor);
      const pending = lyrics.normalizePending(doc, saved, cursor);
      if (JSON.stringify([cursor, pending]) !== JSON.stringify([lyricsState.cursor, lyricsState.pending])) setLyrics({ cursor, pending, active: !!cursor });
    }
    if (!entryState.cursor) return;
    const saved = (event.type === 'undo' || event.type === 'redo') && event.view?.noteEntry && 'cursor' in event.view.noteEntry ? event.view.noteEntry.cursor : entryState.cursor;
    const next = normalizeCursor(doc, saved);
    if (JSON.stringify(next) !== JSON.stringify(entryState.cursor)) setEntry({ cursor: next });
  });
  return {
    doc,
    addView(view) {
      if (views.has(view.id)) throw new Error(`Une vue porte déjà l'identifiant « ${view.id} »`);
      views.set(view.id, view);
      // the creation bar belongs to the selection it was opened for: any other selection closes it
      view.onSelectionChange?.(() => {
        if (creation && creation.viewId === view.id && !sameIds(view.selection(), creation.ids)) clearCreation();
        // note entry: selecting existing notes shows their written value in the entry bar (when they all share it)
        if ((view.id === 'main' || view.id === 'fragment') && entryState.active && !creation) { // (the editor of a container has its own view)
          const chords = creationIntents.creationChords(doc, view.selection());
          const ds = chords.map((c) => getProperty(c, PID.DURATION));
          if (ds.length && ds.every((d) => d && d.base === ds[0].base && (d.dots ?? 0) === (ds[0].dots ?? 0)) && (entryState.duration.base !== ds[0].base || (entryState.duration.dots ?? 0) !== (ds[0].dots ?? 0))) setEntry({ duration: { base: ds[0].base, dots: ds[0].dots ?? 0 } });
        }
      });
      view.setAutomationScale?.(automationScale);
      view.setAutomationParams?.(automationLanes);
      view.setMasterAutomation?.(masterAutomationShown);
      if (automationShown.size) view.setAutomationTracks?.(automationShown);
      return view;
    },
    removeView(id) { const v = views.get(id); if (v) { views.delete(id); v.dispose(); } },
    view: (id) => views.get(id),
    viewIds: () => [...views.keys()],
    /** Transaction d'édition avec mémoire des sélections (avant / après) de toutes les vues. */
    edit(name, fn, { select, viewId = 'main', cursor, measure, range, lyrics: lyricsAfter, deferView = false, creation: creates = false } = {}) {
      // `deferView`: the views may postpone their refresh (burst of keyboard entry); they hear 'begin' before the transaction and 'end' after everything.
      // `'always'` (a click on the staff): the view postpones even when no burst is going on, so the note shows at once as a ghost
      if (deferView) for (const l of [...deferListeners]) l('begin', { always: deferView === 'always' });
      try {
      const result = perf.span('edit:transaction', () => doc.transaction(name, fn, { before: snapshot() })); // the model write + everything that listens to it (views refresh here unless deferred)
      // `select(result)` → identifiants à sélectionner APRÈS la transaction (la vue a déjà purgé les éléments disparus) : l'état « après » les contient
      if (select) { const ids = select(result); const v = views.get(viewId); if (v && ids?.length) v.select(ids); }
      if (creates) markCreation(viewId);
      if (measure) { const id = measure(result); const v = views.get(viewId); if (v) v.setChosenMeasure(id ?? null); }
      if (range) { const r = range(result); const v = views.get(viewId); if (v && r) v.setRange(r); }
      if (cursor) { const c = cursor(result); if (c) entryState = { ...entryState, cursor: c }; }
      if (lyricsAfter) { const l = lyricsAfter(result); if (l) lyricsState = { ...lyricsState, ...l }; }
      try { doc.setViewAfter(snapshot()); } catch { /* transaction vide : rien à compléter */ }
      if (cursor) notifyEntry();
      if (lyricsAfter) notifyLyrics();
      return result;
      } finally { if (deferView) for (const l of [...deferListeners]) l('end'); }
    },
    /** `fn('begin' | 'end')` around every edit made with `deferView`; returns the unsubscribe function. */
    onDeferredEdit(fn) { deferListeners.add(fn); return () => deferListeners.delete(fn); },
    // ---------- saisie de notes (interface) : état de saisie et geste « clic sur la portée » ----------
    /** État de saisie courant { active, duration: { base, dots }, rest, fret, sound, replace } (copie). */
    noteEntry: () => ({ ...entryState, duration: { ...entryState.duration } }),
    /** Modifie l'état de saisie (fusion superficielle ; `duration` est remplacée en entier). Prévient les abonnés ; n'écrit rien dans le Document. */
    setNoteEntry(patch) {
      if (patch.active === false) patch = { ...patch, accArmed: null, voice: 0 }; // sortir du mode saisie désarme la main gauche de l'accordéon et revient à la voix 1
      if (patch.sequential === true && this.tabStaffFor(entryState.cursor) === null) patch = { ...patch, sequential: false }; // no tablature staff to write on: the switch stays off
      entryState = { ...entryState, ...patch, duration: patch.duration ? { base: patch.duration.base, dots: patch.duration.dots ?? 0 } : entryState.duration };
      // entrée en mode saisie : le curseur part de la sélection (accord, note, silence), sinon du début de la première portée de notation
      // sequential entry switched on while the cursor is on another kind of staff: it goes to the tablature of the same track (else the first tablature) at the same place
      if (patch.sequential === true && entryState.cursor) {
        const here = doc.find(entryState.cursor.staffId);
        if (here && getProperty(here, PID.STAFF_TYPE) !== 'tab') {
          const target = this.tabStaffFor(entryState.cursor);
          const moved = target ? normalizeCursor(doc, { staffId: target.id, measureIndex: entryState.cursor.measureIndex, position: entryState.cursor.position, voice: 0 }) : null;
          if (moved) entryState = { ...entryState, cursor: moved };
        }
      }
      if (patch.active === true && !normalizeCursor(doc, entryState.cursor)) {
        const picked = selectedElements('main').map((e) => cursorOfElement(doc, e.id)).find(Boolean);
        const staff = firstEntryStaff();
        entryState = { ...entryState, cursor: picked ?? (staff ? startOfStaff(staff.id) : null) };
      }
      // entering note entry with measures selected (a range, or a chosen measure): the selection is let go and the cursor goes to the START of its first measure
      if (patch.active === true) {
        const v = views.get('main');
        const range = v?.range?.() ?? null;
        const chosen = !range ? v?.chosenMeasure?.() ?? null : null;
        const firstId = range ? range.from.measureId : chosen;
        if (v && firstId) {
          const mi = v.measureIndexOf(firstId);
          const staffId = (range?.staffIds ?? []).find((id) => noteEntry.ENTRY_STAFF_TYPES.includes(getProperty(doc.find(id), PID.STAFF_TYPE))) ?? firstEntryStaff()?.id;
          const cursor = mi >= 0 && staffId ? normalizeCursor(doc, { staffId, measureIndex: mi, position: ZERO, voice: 0 }) : null;
          if (cursor) entryState = { ...entryState, cursor };
          if (range) v.setRange(null);
          if (chosen) v.setChosenMeasure(null);
        }
      }
      if (patch.active === false) { entryState = { ...entryState, accidental: null }; clearCreation(); played.held.clear(); played.last = null; played.lastAt = -Infinity; }
      if (Number.isInteger(patch.voice) && entryState.cursor && entryState.cursor.voice !== patch.voice) entryState = { ...entryState, cursor: normalizeCursor(doc, { ...entryState.cursor, voice: patch.voice }) };
      notifyEntry();
      return this.noteEntry();
    },
    /** Switches the note entry on with the cursor at the start of a staff (the editor of a nested score uses it). */
    startEntryOn(staffId) { return this.setNoteEntry({ active: true, cursor: startOfStaff(staffId) }); },
    onNoteEntryChange(fn) { entryListeners.add(fn); return () => entryListeners.delete(fn); },
    /**
     * Pose la note d'un clic (résultat de `ScoreView.staffHit`) avec l'état de saisie courant : UNE transaction annulable, puis sélection de la
     * nouvelle note (ou du silence). Retourne le résultat de `enterNote` ; lève `NoteEntryError` / `EditError` (rien n'est alors modifié).
     */
    enterNoteAt(hit, viewId = 'main', override = null, { defer = false } = {}) {
      // `override` : valeurs valables pour CE geste seulement (ex. frette et durée choisies dans la barre flottante de tablature)
      const entry = override ? { ...entryState, ...override, duration: { ...(override.duration ?? entryState.duration) } } : entryState;
      const result = this.edit('Saisie de note', () => noteEntry.enterNote(doc, hit, entry), {
        select: (r) => r?.select, viewId, creation: true, deferView: defer ? 'always' : false,
        // le curseur suit la pose (MuseScore : `putNote` avance l'entrée, sauf en tablature)
        cursor: () => {
          const type = getProperty(doc.find(hit.staffId), PID.STAFF_TYPE);
          const c = { staffId: hit.staffId, measureIndex: hit.measureIndex, position: hit.position, voice: noteEntry.voiceForEntry(doc, hit, entry) };
          // MuseScore `putNote` : l'entrée se place sur la position cliquée ; elle avance ensuite, sauf en tablature
          return type === 'tab' ? c : nextInputPos(doc, c).cursor;
        },
      });
      if (entryState.accidental) setEntry({ accidental: null });
      if (['placed', 'added', 'refret'].includes(result?.action)) emitAudition(result.select);
      return result;
    },
    /** `fn(noteIds)` after a note is placed or retouched (placed, added to a chord, re-fretted, transposed, altered); returns the unsubscribe function. */
    /** The page asks to hear what the user just selected by a tap (it decides, from the settings, whether to play). */
    auditionSelected(ids) { emitAudition(ids, 'select'); },
    onAudition(fn) { auditionListeners.add(fn); return () => auditionListeners.delete(fn); },
    /** Plays the strings and frets (`notes` = [{ string, fret }], string 1 = highest) of the tablature staff under the cursor, nothing is written. */
    seqPreview(notes) {
      const staffId = entryState.cursor?.staffId;
      if (staffId && notes?.length) for (const fn of [...tabPreviewListeners]) fn(staffId, notes.map((n) => ({ ...n })));
    },
    onPreview(fn) { tabPreviewListeners.add(fn); return () => tabPreviewListeners.delete(fn); },
    /** The voice (0-3) a gesture at `hit` writes into with the current entry state: the voice of the SOUND on a percussion staff, else the chosen voice. */
    entryVoiceFor(hit) { return noteEntry.voiceForEntry(doc, hit, entryState); },
    /** Entry switches of the drum staff under the entry cursor: [{ id, sounds, heads (head of each sound), index }] (empty when the cursor is not on a percussion staff). */
    drumSwitches() {
      let staff = entryState.cursor && doc.find(entryState.cursor.staffId);
      // the drum special mode shows the switches whatever staff the cursor is on: they use the first percussion staff of the work
      if ((!staff || staff.type !== 'staff' || getProperty(staff, PID.STAFF_TYPE) !== 'percussion') && entryState.specialMode === 'drum') staff = doc.find(this.percussionStaffId());
      if (!staff || staff.type !== 'staff' || getProperty(staff, PID.STAFF_TYPE) !== 'percussion') return [];
      const map = staffSoundMap(getProperty(staff, PID.PERCMAP));
      return drumSwitchesFor(map).map((g) => ({ ...g, heads: g.sounds.map((id) => map.sounds.find((x) => x.id === id)?.head ?? 'normal'), index: (entryState.drumSwitch?.[g.id] ?? 0) % g.sounds.length }));
    },
    /** Entry switches of ANY percussion staff (same shape as `drumSwitches`, current sound from the shared entry state): the grid editor uses them for its defaults. */
    drumSwitchGroups(staffId) {
      const staff = doc.find(staffId);
      if (!staff || staff.type !== 'staff' || getProperty(staff, PID.STAFF_TYPE) !== 'percussion') return [];
      const map = staffSoundMap(getProperty(staff, PID.PERCMAP));
      return drumSwitchesFor(map).map((g) => ({ ...g, heads: g.sounds.map((id) => map.sounds.find((x) => x.id === id)?.head ?? 'normal'), index: (entryState.drumSwitch?.[g.id] ?? 0) % g.sounds.length }));
    },
    /** Makes `soundId` the current sound of its entry switch (if it belongs to one), so the grid editor and the normal entry keep the same choice. */
    pickDrumSound(staffId, soundId) {
      const g = this.drumSwitchGroups(staffId).find((x) => x.sounds.includes(soundId));
      if (g) setEntry({ drumSwitch: { ...(entryState.drumSwitch ?? {}), [g.id]: g.sounds.indexOf(soundId) } });
    },
    /** Moves a switch to its next sound (cyclic). */
    cycleDrumSwitch(id) {
      const g = this.drumSwitches().find((x) => x.id === id);
      if (!g) return null;
      const next = (g.index + 1) % g.sounds.length;
      setEntry({ drumSwitch: { ...(entryState.drumSwitch ?? {}), [id]: next } });
      return g.sounds[next];
    },
    /** Curseur de saisie { staffId, measureIndex, position, voice } ou null. */
    /** Type de la portée où est le curseur de saisie (ex. 'percussion'), ou null. */
    /** The percussion staff to edit the drum map of: the one under the entry cursor, else the first percussion staff of the work (null if none). */
    percussionStaffId() {
      const cur = entryState.cursor && doc.find(entryState.cursor.staffId);
      if (cur && cur.type === 'staff' && getProperty(cur, PID.STAFF_TYPE) === 'percussion') return cur.id;
      for (const mv of doc.work.movements) for (const tr of mv.tracks) for (const st of tr.staves) if (getProperty(st, PID.STAFF_TYPE) === 'percussion') return st.id;
      return null;
    },
    entryStaffTypeAtCursor() {
      const staff = entryState.cursor && doc.find(entryState.cursor.staffId);
      return staff && staff.type === 'staff' ? getProperty(staff, PID.STAFF_TYPE) : null;
    },

    // ---------- saisie des paroles depuis la mélodie ----------
    /** État { active, cursor: { staffId, voice, verse, chordId }, pending } (copie). */
    lyricsEntry: () => ({ ...lyricsState }),
    onLyricsChange(fn) { lyricsListeners.add(fn); return () => lyricsListeners.delete(fn); },
    /** Active la saisie des paroles sur l'accord désigné (accord, note, silence), sinon sur le premier accord ; false si impossible. */
    startLyrics(id = null, verse = lyricsState.cursor?.verse ?? 0) {
      const cursor = (id ? lyrics.cursorAt(doc, id, verse) : null) ?? lyrics.defaultCursor(doc, verse);
      if (!cursor) return false;
      if (entryState.active) this.setNoteEntry({ active: false });
      setLyrics({ active: true, cursor, pending: null });
      return true;
    },
    /** Vrai si les paroles peuvent commencer sur cet élément (accord, note ou silence d'une portée de notation, tablature, percussion, rythmique). */
    lyricsCanStart: (id) => !!lyrics.cursorAt(doc, id, 0),
    stopLyrics() { setLyrics({ active: false, pending: null }); },
    /** Ce que porte l'accord du curseur pour le couplet courant : { text, covered, exists, melismaEnd }. */
    lyricsCurrent: () => (lyricsState.cursor ? lyrics.current(doc, lyricsState) : { text: '', covered: false, exists: false, melismaEnd: null }),
    /** Valide la syllabe tapée ('space' | 'dash' | 'melisma') : UNE transaction annulable, le curseur passe à l'accord voisin. Lève `LyricsError`. */
    commitLyrics(text, join) {
      if (!lyricsState.cursor) throw new lyrics.LyricsError('inactive', 'Saisie des paroles inactive');
      const before = lyricsState;
      return this.edit('Paroles : saisie', () => lyrics.commit(doc, before, text, join), { lyrics: (s) => s });
    },
    /** Accord voisin SANS rien écrire (pas de transaction) ; false au bord de la partition. */
    stepLyrics(dir) {
      const next = lyricsState.cursor && lyrics.step(doc, lyricsState, dir);
      if (!next) return false;
      setLyrics(next);
      return true;
    },
    /** Le curseur de paroles saute sur un élément cliqué (accord, note, silence) ; false si ce n'est pas possible. */
    moveLyricsTo(id) {
      const cursor = lyrics.cursorAt(doc, id, lyricsState.cursor?.verse ?? 0);
      if (!cursor) return false;
      setLyrics({ cursor, pending: null });
      return true;
    },
    /** Couplet voisin sur le même accord (`create` : le couplet suivant même s'il n'existe pas encore). */
    changeLyricsVerse(delta, create = false) {
      const next = lyricsState.cursor && lyrics.changeVerse(doc, lyricsState, delta, create);
      if (!next) return false;
      setLyrics(next);
      return true;
    },
    /** Texte à plusieurs syllabes tapé/collé dans le champ : posé à partir de l'accord courant (une transaction). Retourne { left }. */
    pasteLyricsAtCursor(text) {
      const before = lyricsState;
      const r = this.edit('Paroles : coller', () => lyrics.writeFromCursor(doc, before, text), { lyrics: (x) => x.state });
      return { left: r.left };
    },
    /** Panneau « Paroles… » : accords de la plage et pose d'un bloc de texte (UNE transaction pour tout le bloc). */
    lyricsRangeInfo: (range, text = '') => ({ ...lyrics.rangeChords(doc, range), ...lyrics.blockCounts(doc, range, text) }),
    verseCount: () => Math.max(1, ...doc.work ? (getProperty(doc.work, PID.LYRIC_TEXTS) ?? []).map((t) => t.verse + 1) : [1]),
    writeLyricsBlock(range, verse, text, viewId = 'main') {
      return this.edit('Paroles : poser un texte', () => lyrics.writeBlock(doc, range, verse, text), { viewId });
    },
    /** « Sur la grille » : one field per measure of the range, with what the verse already says there. */
    lyricsGridMeasures: (range, verse) => lyrics.gridMeasures(doc, range, verse),
    /** The free text sheet of a verse (for its window): { state, text, chords }. */
    freeSheetOf: (verse) => lyrics.freeSheetOf(doc, verse),
    /** Writes the free text sheet of a verse (one transaction). */
    writeFreeSheet(verse, text) { return this.edit('Paroles : feuille de texte libre', () => lyrics.writeFreeSheet(doc, verse, text)); },
    /** The adjustment window: writes the placement of a verse on the notes of a staff (one transaction). */
    setLyricAssignment(staffId, verse, assign) {
      return this.edit('Paroles : ajuster', () => lyrics.setAssignment(doc, staffId, verse, assign));
    },
    /** A dragged syllable: the chord under an element, for the drop marker and the drop ({ staffId, chordId } or null). */
    lyricDropTarget: (id) => lyrics.dropTarget(doc, id),
    /** Moves the syllable `linkId` onto the chord under `targetId` (one transaction; the following syllables are pushed on when they would collide). */
    moveLyric(linkId, targetId, viewId = 'main') {
      return this.edit('Paroles : déplacer une syllabe', () => lyrics.moveLyric(doc, linkId, targetId), { viewId });
    },
    /** « Attacher aux notes » : the grid verse is put on the notes of the staff of the range (one transaction). */
    attachLyricsGrid(range, verse, viewId = 'main') {
      return this.edit('Paroles : attacher aux notes', () => lyrics.attachGrid(doc, range, verse), { viewId });
    },
    /** Writes the fields of the grid panel (one transaction): [{ id, text }]. */
    writeLyricsGrid(verse, measures, viewId = 'main') {
      return this.edit('Paroles : sur la grille', () => lyrics.writeGrid(doc, verse, measures), { viewId });
    },
    /**
     * A key of the on-screen piano or a position of the fretboard is pressed while a note is being entered: the pitch is written at the entry cursor
     * (`enterPlayedNote`, one undoable transaction) and the cursor advances; while another key is still held the note joins the chord of the previous
     * one instead (MuseScore's MIDI input). `played` = { midi, string?, fret?, stringCount? }; Shift adds to the previous chord too. The key already
     * sounds by itself, so no audition is made. Returns { action } ('none' when no note entry is running); throws like `keyboardEntry`.
     */
    playedNoteOn(played_, { viewId = 'main', shift = false, now = Date.now() } = {}) {
      if (!entryState.active || !entryState.cursor) return { action: 'none' };
      const midi = played_.midi;
      for (const [m, at] of [...played.held]) if (now - at > 8000) played.held.delete(m); // a release that never came must not turn every later note into a chord
      const already = played.held.has(midi);
      // another key held, Shift, or the previous key pressed a moment ago (fingers rarely land together: the first may already be lifted)
      const chord = (played.held.size > 0 || shift || now - played.lastAt <= CHORD_WINDOW_MS) && !!played.last && !!doc.find(played.last);
      played.held.set(midi, now); played.lastAt = now;
      if (already) return { action: 'none' };
      const entry = this.noteEntry();
      const cursor = entryState.cursor;
      const r = this.edit('Saisie de note (jouée)', () => keyboard.enterPlayedNote(doc, entry, cursor, played_, { add: chord, previous: chord ? doc.find(played.last) : null }), { select: (x) => x.select, cursor: (x) => x.cursor, viewId, deferView: true, creation: true });
      if (r.select?.[0]) played.last = r.select[0];
      if (entryState.accidental) setEntry({ accidental: null });
      return { action: r.action };
    },
    /** The key is released: it no longer counts as held (the next key starts a new chord once all are up). */
    playedNoteOff(midi) { played.held.delete(midi); },
    /** The tuning, highest fret and capo the fretboard must show for the entry cursor (null when it is not on a tablature, nor a notation staff with a linked one). */
    fretboardContext() { return entryState.active && entryState.cursor ? keyboard.fretboardContextAt(doc, entryState.cursor) : null; },
    // ---------- recording a take against a metronome (the recording window, `recorder.js`) ----------
    /** What a recording can be made on from the range selected in the view: { staffId, movement, fromMeasure, toMeasure } or null. */
    recordTarget(viewId = 'main') { return recordingIntents.recordTarget(doc, views.get(viewId)?.range?.() ?? null); },
    /** Writes the chords of a take over the measures of `target`: ONE undoable transaction. Returns { placed, ties, skipped }. */
    commitTake(target, chords, viewId = 'main') {
      return this.edit('Enregistrement', () => recordingIntents.commitTake(doc, { staffId: target.staffId, fromMeasure: target.fromMeasure, toMeasure: target.toMeasure, chords }), { viewId });
    },
    entryCursor: () => (entryState.cursor ? { ...entryState.cursor } : null),
    /** The tablature staff sequential entry writes on for a cursor: the cursor's own staff, else the tablature of its track, else the first tablature of the movement; null when there is none. */
    tabStaffFor(cursor) {
      const here = cursor && doc.find(cursor.staffId);
      if (here && here.type === 'staff' && getProperty(here, PID.STAFF_TYPE) === 'tab') return here;
      const track = here ? doc.parentOf(here.id) : null;
      const inTrack = track?.staves?.find((st) => getProperty(st, PID.STAFF_TYPE) === 'tab');
      if (inTrack) return inTrack;
      const mv = here ? doc.movementOf(here) : doc.work.movements[0];
      for (const tr of mv?.tracks ?? []) for (const st of tr.staves) if (getProperty(st, PID.STAFF_TYPE) === 'tab') return st;
      return null;
    },
    /**
     * Sequential entry: writes a whole chord at the cursor — `notes` = [{ string, fret }] (string 1 = highest), the chosen duration — as ONE undoable step; the cursor moves on and the
     * chord is heard. Returns { action: 'chord', count }. Throws like `keyboardEntry` (nothing is then written).
     */
    seqWriteChord(notes, viewId = 'main') {
      const cursor = entryState.cursor;
      if (!cursor) throw new noteEntry.NoteEntryError('noCursor', 'Pas de curseur de saisie');
      if (!notes?.length) throw new noteEntry.NoteEntryError('unsupportedKeyboard', 'Saisie séquentielle : aucune corde à écrire');
      const entry = this.noteEntry();
      const r = this.edit('Saisie séquentielle (accord)', () => {
        let first = null; let last = null;
        notes.forEach(({ string, fret }, i) => {
          last = keyboard.enterFret(doc, entry, cursor, fret, { string, add: i > 0, selected: i > 0 ? doc.find(first.select[0]) : null });
          if (i === 0) first = last;
        });
        return { select: last.select, cursor: first.cursor };
      }, { select: (x) => x.select, cursor: (x) => x.cursor, viewId, deferView: true });
      emitAudition(r.select);
      return { action: 'chord', count: notes.length };
    },
    /** Sequential entry: « Back » — the chord just written is removed whole and the cursor returns to its place (one undoable step). */
    seqBack(viewId = 'main') {
      const cursor = entryState.cursor;
      if (!cursor) throw new noteEntry.NoteEntryError('noCursor', 'Pas de curseur de saisie');
      const selected = selectedElements(viewId)[0] ?? null;
      this.edit('Revenir (saisie séquentielle)', () => keyboard.backOverLast(doc, cursor, selected), { select: (x) => x.select, cursor: (x) => x.cursor, viewId });
      return { action: 'back' };
    },
    /**
     * Sequential entry: a tap on the tablature moves the cursor there (no note is written) and makes the string touched the current one.
     * `hit` = a result of `ScoreView.staffHit` ({ staffId, measureIndex, position, line }).
     */
    moveEntryCursorTo(hit) {
      const cursor = normalizeCursor(doc, { staffId: hit.staffId, measureIndex: hit.measureIndex, position: hit.position, voice: noteEntry.voiceForEntry(doc, hit, entryState) });
      if (!cursor) return null;
      const count = tuningPitches(doc.find(hit.staffId)).length;
      setEntry({ cursor, ...(Number.isInteger(hit.line) && count ? { tabString: Math.min(count, Math.max(1, hit.line + 1)) } : {}) });
      return cursor;
    },
    /** The strings of the tablature staff under the cursor, in the order the staff shows them (1 = highest): [{ string, name }] with the note of the open string (capo not counted). */
    tabStrings() {
      const staff = entryState.cursor && doc.find(entryState.cursor.staffId);
      if (!staff || staff.type !== 'staff') return [];
      const open = tuningPitches(staff); // highest string first (string 1 = index 0)
      const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
      return open.map((_, i) => ({ string: i + 1, name: NAMES[((open[i] % 12) + 12) % 12] }));
    },
    /**
     * Saisie au clavier. `action` : { type: 'letter', note: 0-6, add } | 'rest' | 'delete' | 'up' | 'down' (+ octave) | 'left' | 'right' |
     * 'prevMeasure' | 'nextMeasure' | 'duration' (base) | 'dot' | 'accidental' (value) | 'voice' (voice 0-3).
     * Retourne { action } ; lève `NoteEntryError` / `EditError` (rien n'est alors modifié).
     */
    keyboardEntry(action, viewId = 'main') {
      const cursor = entryState.cursor;
      const need = () => { if (!cursor) throw new noteEntry.NoteEntryError('noCursor', 'Pas de curseur de saisie'); return cursor; };
      const entry = this.noteEntry();
      const selected = selectedElements(viewId);
      const crOfSelection = () => { const e = selected[0]; if (!e) return null; return e.type === 'chord' || e.type === 'rest' ? e : (doc.parentOf(e.id)?.type === 'chord' ? doc.parentOf(e.id) : null); };
      const done = (r) => { if (entryState.accidental) setEntry({ accidental: null }); return r; };
      switch (action.type) {
        case 'letter': {
          const r = this.edit('Saisie de note (clavier)', () => keyboard.enterLetter(doc, entry, need(), action.note, { add: !!action.add, selected: selected[0] ?? null }), { select: (x) => x.select, cursor: (x) => x.cursor, viewId, deferView: true, creation: true });
          if (['placed', 'added'].includes(r.action)) emitAudition(r.select);
          return done({ action: r.action });
        }
        case 'fret': {
          const r = this.edit('Saisie de frette (clavier)', () => (action.guitarPro ? keyboard.enterFretStay(doc, entry, need(), action.fret, { string: entryState.tabString ?? 1 }) : keyboard.enterFret(doc, entry, need(), action.fret, { string: entryState.tabString ?? 1, add: !!action.add, selected: selected[0] ?? null })), { select: (x) => x.select, cursor: (x) => x.cursor, viewId, deferView: true });
          if (['placed', 'added', 'refret'].includes(r.action)) emitAudition(r.select);
          return done({ action: r.action });
        }
        case 'string': {
          const staff = doc.find(need().staffId);
          const count = tuningPitches(staff).length;
          const next = Math.min(count, Math.max(1, (entryState.tabString ?? 1) + action.delta));
          setEntry({ tabString: next });
          return { action: 'string', string: next };
        }
        case 'nextStaff': case 'prevStaff': { // style Guitar Pro: Tab / Maj + Tab — the cursor goes to the next / previous staff that can be written on, same measure and place
          const here = doc.find(need().staffId);
          const written = (list) => list.filter((s) => ['score', 'tab', 'percussion', 'accordion-left'].includes(getProperty(s, PID.STAFF_TYPE))); // not the rhythm / neutral staves: nothing to write there
          const own = written(doc.parentOf(here.id)?.staves ?? []); // the notation and the tablature of the track first, as the double staff of Guitar Pro
          const staves = own.length > 1 ? own : written((doc.movementOf(here)?.tracks ?? []).flatMap((t) => t.staves));
          const at = staves.findIndex((s) => s.id === here.id);
          if (staves.length < 2 || at < 0) return { action: 'none' };
          const target = staves[(at + (action.type === 'nextStaff' ? 1 : staves.length - 1)) % staves.length];
          const moved = normalizeCursor(doc, { ...cursor, staffId: target.id, voice: 0 });
          if (!moved) return { action: 'none' };
          const strings = getProperty(target, PID.STAFF_TYPE) === 'tab' ? tuningPitches(target).length : 0;
          setEntry({ cursor: moved, ...(strings ? { tabString: Math.min(strings, entryState.tabString ?? 1) } : {}) });
          return { action: 'moved' };
        }
        case 'barStart': case 'firstBar': { // style Guitar Pro: Home / Ctrl + Home
          const moved = normalizeCursor(doc, { ...need(), measureIndex: action.type === 'firstBar' ? 0 : need().measureIndex, position: [0, 1] });
          if (!moved) return { action: 'none' };
          setEntry({ cursor: moved });
          return { action: 'moved' };
        }
        case 'drum': {
          const r = this.edit('Saisie de batterie (clavier)', () => keyboard.enterDrumSound(doc, entry, need(), action.sound, { add: !!action.add, selected: selected[0] ?? null }), { select: (x) => x.select, cursor: (x) => x.cursor, viewId, deferView: true });
          setEntry({ sound: action.sound });
          if (['placed', 'added'].includes(r.action)) emitAudition(r.select);
          return { action: r.action };
        }
        case 'tie': {
          const r = this.edit('Liaison de prolongation (clavier)', () => tieAction(doc, entry, selected, !!entry.active), { select: (x) => x.select, cursor: (x) => x.cursor ?? null, viewId });
          return { action: r.action };
        }
        case 'rest': {
          const r = this.edit('Saisie de silence (clavier)', () => keyboard.enterRestAtCursor(doc, entry, need()), { select: (x) => x.select, cursor: (x) => x.cursor, viewId, deferView: true });
          return done({ action: r.action });
        }
        case 'delete': {
          this.edit('Supprimer (clavier)', () => keyboard.deleteAtCursor(doc, need(), selected[0] ?? null), { select: (x) => x.select, cursor: (x) => x.cursor, viewId });
          return { action: 'deleted' };
        }
        case 'up': case 'down': {
          const notes = selected.filter((e) => e.type === 'note');
          const n = this.edit('Hauteur (clavier)', () => keyboard.shiftNotes(doc, notes, action.type === 'up', !!action.octave), { select: () => notes.map((x) => x.id), viewId });
          return { action: 'pitch', changed: n };
        }
        case 'left': case 'right': {
          const moved = moveByChord(doc, need(), crOfSelection(), action.type === 'right' ? 1 : -1);
          if (!moved) return { action: 'none' };
          setEntry({ cursor: moved.cursor });
          if (moved.select) selectIds(viewId, idsOfCr(moved.select));
          return { action: 'moved' };
        }
        case 'prevMeasure': case 'nextMeasure': {
          const moved = moveByMeasure(doc, need(), action.type === 'nextMeasure' ? 1 : -1);
          if (!moved) return { action: 'none' };
          setEntry({ cursor: moved.cursor });
          if (moved.select) selectIds(viewId, idsOfCr(moved.select));
          return { action: 'moved' };
        }
        case 'longer': {
          const bases = ['breve', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtysecond', 'sixtyfourth'];
          const i = Math.min(bases.length - 1, Math.max(0, bases.indexOf(entry.duration.base) + (action.shorter ? 1 : -1)));
          setEntry({ duration: { base: bases[i], dots: 0 }, rest: false });
          return { action: 'duration' };
        }
        case 'duration': setEntry({ duration: { base: action.base, dots: 0 }, rest: false }); return { action: 'duration' };
        case 'dot': setEntry({ duration: { base: entry.duration.base, dots: ((entry.duration.dots ?? 0) + 1) % 4 } }); return { action: 'duration' };
        case 'accidental': setEntry({ accidental: entry.accidental === action.value ? null : action.value }); return { action: 'accidental' };
        case 'voice': {
          const c = need();
          setEntry({ voice: action.voice, cursor: normalizeCursor(doc, { ...c, voice: action.voice }) });
          return { action: 'voice' };
        }
        default: throw new noteEntry.NoteEntryError('unsupportedKeyboard', `Action « ${action.type} » inconnue`);
      }
    },
    // ---------- déplacement manuel (poignée de la barre contextuelle) ----------
    /** Identifiants de `ids` (défaut : sélection) qui peuvent être déplacés. */
    movable: (ids, viewId = 'main') => movableIds(doc, ids ?? views.get(viewId)?.selection() ?? []),
    /** Décalage manuel [dx, dy] (espaces, y vers le bas) d'un élément déplaçable ; [0, 0] sinon. */
    offsetOf: (id) => offsetOf(doc, id),
    /** Déplace de `delta` ([dx, dy] en espaces) ; UNE transaction annulable (la sélection reste). Retourne le nombre d'éléments déplacés. */
    moveElements(ids, delta, viewId = 'main') {
      const list = movableIds(doc, ids ?? views.get(viewId)?.selection() ?? []);
      if (!list.length) return 0;
      return this.edit('Déplacer', () => moveElements(doc, list, delta), { viewId }) ?? 0;
    },
    /** Remet les éléments à leur place automatique. */
    resetPositions(ids, viewId = 'main') {
      const list = movableIds(doc, ids ?? views.get(viewId)?.selection() ?? []);
      if (!list.length) return 0;
      return this.edit('Remettre en place', () => resetOffsets(doc, list), { viewId }) ?? 0;
    },
    // ---------- grips of slurs, ties, hairpins (end points, control points, aperture) ----------
    /** Handles (SVG pixels) of the selected slur / tie / hairpin entry, or null. See ScoreView.gripHandles. */
    gripHandles: (id, viewId = 'main') => views.get(viewId)?.gripHandles?.(id) ?? null,
    /** True when the entry carries user grips (for the reset button). */
    hasGrips: (id) => { const f = doc.findListEntry(id); return !!f && hasGrips(f.entry); },
    setGrip(id, seg, key, offset, viewId = 'main') {
      return this.edit('Poignée', () => setGrip(doc, id, seg, key, offset), { viewId });
    },
    /** Chords a slur / hairpin can be anchored on (its voice), with their pixel columns: { startChordId, endChordId, chords: [{ id, x, y1, y2 }] } or null. */
    gripAnchors(id, viewId = 'main') {
      const info = spannerVoiceChords(doc, id);
      const view = views.get(viewId);
      if (!info || !view) return null;
      const chords = [];
      for (const chordId of info.ids) {
        const c = cursorOfElement(doc, chordId);
        const r = c && view.entryCursorRect(c);
        if (r) chords.push({ id: chordId, x: r.x + r.w / 2, y1: r.y1, y2: r.y2, systemIndex: r.systemIndex });
      }
      return { startChordId: info.entry.startChordId, endChordId: info.entry.endChordId, chords };
    },
    /** Move the start or the end of a slur / hairpin to another chord of its voice (what playback follows). One undoable transaction. */
    reanchorSpanner(id, which, chordId, viewId = 'main') {
      return this.edit(which === 'start' ? 'Ancrage : début' : 'Ancrage : fin', () => reanchorSpanner(doc, id, which, chordId), { viewId });
    },
    setAperture(id, value, viewId = 'main') {
      return this.edit('Ouverture du soufflet', () => setAperture(doc, id, value), { viewId });
    },
    resetGrips(id, opts = {}, viewId = 'main') {
      return this.edit('Poignées : remettre en place', () => resetGrips(doc, id, opts), { viewId });
    },
    // ---------- suppression (barre contextuelle, clic droit) ----------
    /** Éléments de `ids` (défaut : sélection) qui peuvent être supprimés. */
    deletable: (ids, viewId = 'main') => deletableIds(doc, ids ?? views.get(viewId)?.selection() ?? []),
    /** Supprime accords / notes / silences (défaut : la sélection de la vue) en UNE transaction annulable. Retourne le nombre d'éléments supprimés. */
    deleteElements(ids, viewId = 'main') {
      const list = ids ?? views.get(viewId)?.selection() ?? [];
      if (!deletableIds(doc, list).length) return 0;
      const r = this.edit('Supprimer', () => deleteElements(doc, list), { select: (x) => x.select, viewId });
      return r?.count ?? 0;
    },
    // ---------- insertion / suppression de mesures (barre contextuelle de mesure) ----------
    /**
     * Insère `count` mesures vides AVANT ou APRÈS la mesure `measureId` (UNE transaction annulable, toutes portées, toutes voix).
     * « avant » déplace chiffrage / armure / début de reprise sur la 1re nouvelle mesure ; « après » déplace la barre de fin et la fin de
     * reprise sur la dernière (MuseScore `addBoxes`). La 1re nouvelle mesure devient la mesure choisie de la vue. Retourne les identifiants créés.
     */
    insertMeasures({ measureId, movement: movementIndex = 0, movementElement = null, where = 'after', count = 1 }, viewId = 'main') {
      let mv;
      let at;
      if (measureId) {
        const bar = doc.find(measureId);
        if (!bar || bar.type !== 'masterbar') throw new Error('Mesure introuvable');
        mv = doc.movementOf(bar);
        const index = mv.masterbars.findIndex((b) => b.id === measureId);
        at = where === 'before' ? index : index + 1;
      } else { // Mouvement sans aucune mesure : on repart de 4/4 (MuseScore `restoreInitialKeySigAndTimeSig`)
        mv = movementElement ?? doc.work.movements[movementIndex];
        if (!mv || mv.masterbars.length) throw new Error('Mesure introuvable');
        at = 0;
      }
      return this.edit(count > 1 ? `Insérer ${count} mesures` : 'Insérer une mesure',
        () => insertMeasures(doc, mv, { at, count, moveSignatures: where === 'before' }),
        { measure: (ids) => ids[0], viewId });
    },
    /** Supprime la mesure `measureId` (UNE transaction annulable). La mesure choisie devient la précédente (ou la 1re). */
    deleteMeasure(measureId, viewId = 'main') {
      const bar = doc.find(measureId);
      if (!bar || bar.type !== 'masterbar') throw new Error('Mesure introuvable');
      const mv = doc.movementOf(bar);
      const index = mv.masterbars.findIndex((b) => b.id === measureId);
      const focusId = (mv.masterbars[index - 1] ?? mv.masterbars[index + 1] ?? null)?.id ?? null;
      return this.edit('Supprimer une mesure', () => deleteMeasures(doc, mv, { from: index, to: index }), { measure: () => focusId, viewId });
    },
    // ---------- plage : vider, retirer les mesures ----------
    /** Vide la plage (équivalent de « Suppr » sur une plage de MuseScore) : UNE transaction annulable ; la plage reste en place. */
    clearRange(range, viewId = 'main', { filter = rangeFilter } = {}) {
      return this.edit('Vider la plage', () => clearRange(doc, range, filter), { viewId });
    },
    /** Vide UNE mesure (toutes les portées du système, voix 2-4 comprises) ; la mesure reste choisie (UNE transaction annulable). */
    clearMeasure(measureId, viewId = 'main') {
      const bar = doc.find(measureId);
      if (!bar || bar.type !== 'masterbar') throw new Error('Mesure introuvable');
      const mv = doc.movementOf(bar);
      const index = mv.masterbars.indexOf(bar);
      const range = rangeFromMeasures(doc, mv, flatStaves(mv).map((s) => s.id), index, index);
      return this.edit('Vider la mesure', () => clearRange(doc, range, null), { measure: () => measureId, viewId });
    },
    /** Vrai si la plage est faite de mesures entières (retirer des mesures a un sens). */
    canRemoveRangeMeasures(range) {
      const bar = doc.find(range?.from?.measureId);
      return !!bar && bar.type === 'masterbar' && rangeIsWholeMeasures(doc.movementOf(bar), range);
    },
    /** Retire les mesures de la plage de TOUTES les portées (UNE transaction annulable) ; la mesure choisie devient la précédente (ou la suivante). */
    removeRangeMeasures(range, viewId = 'main') {
      const bar = doc.find(range.from.measureId);
      if (!bar || bar.type !== 'masterbar') throw new Error('Mesure introuvable');
      const mv = doc.movementOf(bar);
      const span = rangeMeasureSpan(mv, range);
      const focusId = (mv.masterbars[span.first - 1] ?? mv.masterbars[span.last + 1] ?? null)?.id ?? null;
      return this.edit('Retirer les mesures', () => removeRangeMeasures(doc, range), { measure: () => focusId, viewId });
    },
    // ---------- plage : copier (le presse-papiers n'est PAS le Document : rien n'est annulable ni écrit) ----------
    /**
     * Copie la plage dans le presse-papiers interne et, si le navigateur le permet, dans le presse-papiers système (texte JSON).
     * À appeler dans le geste de l'utilisateur (iPad). Retourne { measures, staves, system } ; `system` = promesse (vrai si le
     * texte a pu être écrit dans le presse-papiers système, jamais rejetée).
     */
    copyRange(range, { filter = rangeFilter } = {}) {
      return this.storeClipboard(copyRange(doc, range, filter));
    },
    /** Range la charge dans le presse-papiers interne et système (texte JSON) ; prévient les abonnés. */
    storeClipboard(payload) {
      clipboard = payload;
      let system = Promise.resolve(false);
      try { if (systemClipboard) system = Promise.resolve(systemClipboard.writeText(serializeClipboard(payload))).then(() => true, () => false); } catch { /* refus du navigateur */ }
      for (const fn of [...clipboardListeners]) fn(payload);
      return { ...clipboardSummary(payload), system };
    },
    /** Coupe = copie puis vide la plage (les mesures restent, remplies de silences) : UNE transaction annulable. */
    cutRange(range, viewId = 'main', { filter = rangeFilter } = {}) {
      const summary = this.copyRange(range, { filter });
      this.edit('Couper', () => clearRange(doc, range, filter), { viewId });
      return summary;
    },
    cutMeasure(measureId, staffId, viewId = 'main') {
      const bar = doc.find(measureId);
      if (!bar || bar.type !== 'masterbar') throw new Error('Mesure introuvable');
      const mv = doc.movementOf(bar);
      const index = mv.masterbars.indexOf(bar);
      return this.cutRange(rangeFromMeasures(doc, mv, [staffId], index, index), viewId, { filter: null });
    },
    /**
     * Colle la charge (`payload` ou presse-papiers interne) à `target` { staffId, measureId, position } : UNE transaction annulable ;
     * la zone collée devient la plage sélectionnée. Retourne { skipped, addedMeasures }. Lève `EditError` (rien n'est modifié).
     */
    paste(target, viewId = 'main', payload = clipboard) {
      if (!payload || !canPaste(payload)) throw new Error('Presse-papiers vide');
      const r = this.edit('Coller', () => pasteClipboard(doc, payload, target), { viewId, range: (x) => ({ staffIds: x.staffIds, from: x.from, to: x.to }) });
      return { skipped: r.skipped, addedMeasures: r.addedMeasures };
    },
    /**
     * Pastes the payloads of an imported file on the piece, from `target` { staffId, measureId, position }: `items` = [{ payload, target? }] (a payload without its own target goes on `target`; the chord
     * payload goes on the chord staff). ONE undoable transaction; the pasted zone of the first becomes the chosen range. Returns { skipped, addedMeasures } (the sums). Throws (nothing is written) when
     * one of the pastes is refused.
     */
    importPayloads(target, items, viewId = 'main') {
      const done = this.edit('Importer', () => items.map((it) => pasteClipboard(doc, it.payload, it.target ?? target)), { viewId, range: (rs) => ({ staffIds: rs[0].staffIds, from: rs[0].from, to: rs[0].to }) });
      return { skipped: done.reduce((n, r) => n + (r.skipped?.length ?? 0), 0), addedMeasures: Math.max(...done.map((r) => r.addedMeasures ?? 0)) };
    },
    /**
     * Duplique ce qui est sélectionné : la plage est copiée puis collée juste APRÈS elle, sur les mêmes portées seulement (un copier-coller automatique) ;
     * rien n'est inséré, la copie écrase les mesures qui suivent (si la plage touche la fin du Mouvement, des mesures vides sont ajoutées pour la recevoir).
     * UNE transaction annulable ; le presse-papiers n'est pas touché ; la copie devient la plage sélectionnée.
     */
    duplicateRange(range, viewId = 'main', count = 1) {
      const bar = doc.find(range?.from?.measureId);
      if (!bar || bar.type !== 'masterbar') throw new Error('Mesure introuvable');
      const mv = doc.movementOf(bar);
      if (!rangeMeasureSpan(mv, range)) throw new Error('Mesure introuvable');
      const copies = Math.max(1, Math.min(64, Math.round(count) || 1));
      const payload = copyRange(doc, range, null);
      return this.edit('Dupliquer', () => { // `copies` copies, each pasted right after the previous one: ONE undo step
        let current = range; let made;
        for (let k = 0; k < copies; k += 1) {
          const span = rangeMeasureSpan(mv, current);
          let target;
          if (rangeIsWholeMeasures(mv, current)) {
            let nextBar = mv.masterbars[span.last + 1];
            if (!nextBar) nextBar = doc.find(insertMeasures(doc, mv, { at: span.last + 1, count: 1, moveSignatures: false })[0]);
            target = { staffId: current.staffIds[0], measureId: nextBar.id, position: ZERO };
          } else target = { staffId: current.staffIds[0], measureId: current.to.measureId, position: current.to.position };
          made = pasteClipboard(doc, payload, target);
          current = { staffIds: made.staffIds, from: made.from, to: made.to };
        }
        return made;
      }, { viewId, range: (x) => ({ staffIds: x.staffIds, from: x.from, to: x.to }) });
    },
    /** Duplique UNE mesure d'une portée (mesure choisie). */
    duplicateMeasure(measureId, staffId, viewId = 'main', count = 1) {
      const bar = doc.find(measureId);
      if (!bar || bar.type !== 'masterbar') throw new Error('Mesure introuvable');
      const mv = doc.movementOf(bar);
      const index = mv.masterbars.indexOf(bar);
      return this.duplicateRange(rangeFromMeasures(doc, mv, [staffId], index, index), viewId, count);
    },
    /** Lit un texte du presse-papiers système : charge valide ou null. */
    parseClipboardText: (text, target = null) => {
      const own = parseClipboard(text);
      if (own) return own;
      // a melody copied from Hookpad (Hooktheory): degrees of the scale, written on the notation staff of `target` in the octave of its clef
      const hook = parseHooktheory(text);
      if (!hook) return null;
      const err = (code, message) => Object.assign(new Error(message), { hooktheory: code });
      if (!target) throw err('noTarget', 'No destination');
      const bar = doc.find(target.measureId); const mv = bar && doc.movementOf(bar);
      const staff0 = mv && flatStaves(mv).find((s) => s.id === target.staffId);
      const staff = staff0 && isLinkedStaff(staff0) ? contentStaff(mv, staff0) : staff0;
      if (!staff || getProperty(staff, PID.STAFF_TYPE) !== 'score') throw err('staffType', 'A Hooktheory melody is written on a notation staff');
      // the middle line of the clef, an octave clef (guitar G8vb) counted as its plain clef: a Hookpad melody lies around middle C in SOUNDING pitch
      const bottom = CLEF_DEFS[String(getProperty(staff, PID.CLEF)).replace(/(8|15)(vb|va)$/i, '')]?.bottomLine;
      const centerMidi = bottom ? midiFromSpelling({ step: bottom.step, octave: bottom.octave }) + 7 : 71; // the middle line of the clef
      const { payload, summary } = hooktheoryPayload(hook, { centerMidi });
      payload.hooktheory = { ...summary, chords: hook.hasChords };
      return payload;
    },
    /** Copie UNE mesure sur UNE portée (mesure choisie). */
    copyMeasure(measureId, staffId) {
      const bar = doc.find(measureId);
      if (!bar || bar.type !== 'masterbar') throw new Error('Mesure introuvable');
      const mv = doc.movementOf(bar);
      const index = mv.masterbars.indexOf(bar);
      return this.copyRange(rangeFromMeasures(doc, mv, [staffId], index, index), { filter: null });
    },
    // ---------- filtre de sélection (voix, notes d'un accord, catégories d'éléments) ----------
    /** Filtre en vigueur (copie) ; il conditionne copier, couper, vider, jouer/muet et masquer sur une PLAGE (pas sur une mesure choisie). */
    filter: () => normalizeFilter(rangeFilter),
    setFilter(next) {
      rangeFilter = normalizeFilter(next);
      for (const fn of [...filterListeners]) fn(normalizeFilter(rangeFilter));
    },
    onFilterChange(fn) { filterListeners.add(fn); return () => filterListeners.delete(fn); },
    /** Valeur que donnerait la bascule jouer/muet de la plage (false = couper, true = jouer, null = rien de jouable). */
    nextRangePlayValue: (range) => nextRangePlayValue(doc, range, rangeFilter),
    /** Jouer / couper ce que le filtre vise dans la plage : UNE transaction annulable. */
    toggleRangePlay(range, viewId = 'main') {
      return this.edit('Jouer / couper la plage', () => toggleRangePlay(doc, range, rangeFilter), { viewId });
    },
    /** Masquée (vrai) ou ré-affichée (faux) à la prochaine bascule ; null si le filtre exclut le décor. */
    nextRangeDecorHidden: (range) => nextRangeDecorHidden(doc, range, rangeFilter),
    toggleRangeDecorHidden(range, viewId = 'main') {
      return this.edit('Masquer le décor de la plage', () => toggleRangeDecorHidden(doc, range, rangeFilter), { viewId });
    },
    /** Charge copiée (copie profonde non faite : à traiter en lecture seule), ou null. */
    clipboard: () => clipboard,
    onClipboardChange(fn) { clipboardListeners.add(fn); return () => clipboardListeners.delete(fn); },
    // ---------- masquer / afficher le décor (barres, clés, armures, chiffrages) ----------
    /** Bascule le masquage du décor de `ids` (défaut : la sélection) en UNE transaction annulable. Retourne le nombre d'éléments changés. */
    toggleDecorHidden(ids, viewId = 'main') {
      const list = ids ?? views.get(viewId)?.selection() ?? [];
      return this.edit('Masquer / afficher', () => toggleDecorHidden(doc, list)) ?? 0;
    },
    /** true = la bascule masquerait, false = elle ré-afficherait, null = aucun décor dans `ids`. */
    nextDecorHidden: (ids) => nextDecorHidden(doc, ids),
    /** Idem pour TOUTE la portée (tous les systèmes) : masque / ré-affiche chaque élément du même genre sur les portées visées. */
    toggleDecorHiddenEverywhere(ids, viewId = 'main') {
      const list = ids ?? views.get(viewId)?.selection() ?? [];
      return this.edit('Masquer / afficher (toute la portée)', () => toggleDecorHiddenEverywhere(doc, list)) ?? 0;
    },
    nextDecorHiddenEverywhere: (ids) => nextDecorHiddenEverywhere(doc, ids),
    // ---------- silences non imprimables (PID.VISIBLE faux sur le silence : pour tout, écrans 1, 2 et 3) ----------
    /** true = la bascule masquerait les silences visés, false = elle les ré-afficherait, null = aucun silence dans `ids`. */
    nextRestsHidden: (ids) => nextRestsHidden(restTargets(doc, ids)),
    toggleRestsHidden(ids, viewId = 'main') {
      const list = ids ?? views.get(viewId)?.selection() ?? [];
      return this.edit('Masquer / afficher les silences', () => toggleRestsHidden(doc, restTargets(doc, list)), { viewId }) ?? 0;
    },
    /** Idem pour les silences d'une plage (voix retenues par le filtre). */
    nextRangeRestsHidden: (range) => nextRestsHidden(rangeRestTargets(doc, range, rangeFilter)),
    toggleRangeRestsHidden(range, viewId = 'main') {
      return this.edit('Masquer / afficher les silences de la plage', () => toggleRestsHidden(doc, rangeRestTargets(doc, range, rangeFilter)), { viewId }) ?? 0;
    },
    // ---------- vélocité imposée d'une note ----------
    /** État de la vélocité des notes visées (défaut : sélection de la vue 'main') : { count, auto, value, mixed } ou null. */
    velocityState(ids, { lazy = false } = {}) {
      const st = velocityState(doc, ids);
      // lazy: never build the audio sequence just to draw the bar (it costs a fraction of a second after every edit); the value is shown on request
      if (st && st.auto) {
        if (lazy && !velocityCache) { st.lazy = true; return st; }
        const c = this.computedVelocity(velocityTargetsOf(ids)[0]); if (c != null) st.value = c; st.computed = c ?? null;
      }
      return st;
    },
    /** Vélocité que la lecture donne à une note (nuances, soufflets, accents, étages par défaut) ; null si la note n'est pas jouée. Séquence mémorisée jusqu'au prochain changement du Document. */
    computedVelocity(noteId) {
      if (!noteId) return null;
      if (!velocityCache) {
        velocityCache = new Map();
        try {
          for (const n of perf.span('sequence:velocity', () => buildSequence(doc.work)).notes) if (n.id && !velocityCache.has(n.id)) velocityCache.set(n.id, n.velocity);
        } catch { /* séquence impossible : pas de valeur calculée */ }
      }
      return velocityCache.get(noteId) ?? null;
    },
    /** Impose une vélocité 1-127 (ou null = automatique) : UNE transaction annulable. */
    setVelocity(value, ids, viewId = 'main') {
      const list = ids ?? views.get(viewId)?.selection() ?? [];
      return this.edit(value === null ? 'Vélocité : automatique' : 'Vélocité', () => setVelocity(doc, list, value)) ?? 0;
    },
    stepVelocity(delta, ids, viewId = 'main') {
      const list = ids ?? views.get(viewId)?.selection() ?? [];
      return this.edit('Vélocité', () => stepVelocity(doc, list, delta)) ?? 0;
    },
    // ---------- marks on chords: articulations, dynamics, hairpins, slurs (context bar drawer) ----------
    /** Chord elements aimed at by `ids` (default: the view selection) or by a range. */
    markTargets: (ids, range = null, viewId = 'main') => marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range }),
    /** What the targets already carry: { articulations: { all, some }, dynamic, spans: { cresc, decresc, slur } } for the drawer buttons. */
    marksState(ids, range = null, viewId = 'main') {
      const chords = marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range });
      const spans = {};
      for (const k of marks.SPANNER_KINDS) spans[k] = marks.spannerState(doc, chords, k);
      const techLines = {};
      for (const t of marks.TECH_LINE_CHOICES) techLines[t] = marks.techLineState(doc, chords, t);
      return {
        count: chords.length, articulations: marks.articulationState(chords), dynamic: marks.dynamicState(chords), spans,
        techLines, hasArpeggio: marks.hasArpeggio(chords), chordProps: marks.chordPropState(chords), noteFlags: marks.noteFlagState(chords),
      };
    },
    toggleArticulation(type, { ids, range = null } = {}, viewId = 'main') {
      const chords = marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range });
      return this.edit('Articulation', () => marks.toggleArticulation(doc, chords, type), { viewId }) ?? 0;
    },
    setDynamic(type, { ids, range = null } = {}, viewId = 'main') {
      const chords = marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range });
      return this.edit(type === null ? 'Nuance : effacer' : 'Nuance', () => marks.setDynamic(doc, chords, type), { viewId }) ?? 0;
    },
    toggleSpanner(kind, { ids, range = null } = {}, viewId = 'main') {
      const chords = marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range });
      return this.edit(kind === 'slur' ? 'Liaison' : 'Soufflet', () => marks.toggleSpanner(doc, chords, kind), { viewId }) ?? false;
    },
    // ---------- exports (nothing is written in the Document) ----------
    /** Standalone SVG text of the score as drawn by the view. */
    exportSvg: (viewId = 'main') => views.get(viewId)?.exportSvg?.() ?? null,
    /** Standard MIDI File (Uint8Array) of the work at the written tempo. */
    exportMidi(options = {}) {
      const seq = buildSequence(doc.work, { speed: 1, strumCards: preferences.get('strumCards')?.items, chordPatterns: preferences.get('chordPatterns')?.items, grooves: preferences.get('grooves')?.items, ...options });
      // time and key signatures at the start of each played measure where they change (the sequence has the slots, not the signatures)
      const timeSignatures = []; const keySignatures = [];
      let lastTs = null; let lastKey = null;
      for (const slot of seq.slots ?? []) {
        const bar = doc.work.movements[slot.movement]?.masterbars[slot.measure];
        if (!bar) continue;
        const ts = getProperty(bar, PID.TIME_SIG); const key = getProperty(bar, PID.KEY_SIG);
        if (!lastTs || ts[0] !== lastTs[0] || ts[1] !== lastTs[1]) { timeSignatures.push({ t: slot.t, num: ts[0], den: ts[1] }); lastTs = ts; }
        if (key !== lastKey) { keySignatures.push({ t: slot.t, fifths: key }); lastKey = key; }
      }
      return sequenceToMidi(seq, { title: doc.get(doc.work, PID.TITLE) ?? '', timeSignatures, keySignatures });
    },
    /** MusicXML text of the movement shown by the view: { xml, warnings } (throws when nothing can be exported). */
    /** Compressed MusicXML (.mxl): { bytes: Uint8Array, warnings } (asynchronous: compression). */
    async exportMxl(viewId = 'main') {
      const { xml, warnings } = exportMusicXml(doc.work, { movement: views.get(viewId)?.movementIndex?.() ?? 0, linkedStaves: preferences.get('exportOptions')?.linkedStaves });
      return { bytes: await buildMxl(xml), warnings };
    },
    exportMusicXml: (viewId = 'main') => exportMusicXml(doc.work, { movement: views.get(viewId)?.movementIndex?.() ?? 0, linkedStaves: preferences.get('exportOptions')?.linkedStaves }),
    // ---------- system ("masterbar") objects: tempo, swing, fermata, jumps, markers, repeats, voltas ----------
    /** Where a gesture places a system object: from a range, a selected note / chord / rest, or a chosen measure. Null when nothing is aimed at. */
    systemTarget(ids = null, range = null, measureId = null, viewId = 'main') {
      const v = views.get(viewId);
      const mv = v?.movement?.() ?? doc.work.movements[0];
      return mv ? systemTarget(doc, mv, { ids: ids ?? v?.selection() ?? [], range, measureId }) : null;
    },
    /** What is already at the target: { tempo, gradual, swing, fermata, jump, marker, repeatStart, repeatEnd, volta }. */
    systemState(target, viewId = 'main') {
      const mv = views.get(viewId)?.movement?.() ?? doc.work.movements[0];
      return mv ? systemState(mv, target) : null;
    },
    /** The staff a gesture comes from (null for a chosen measure: no staff). */
    gestureStaff: (ids = null, range = null, viewId = 'main') => staffOfTarget(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range }),
    /** Free text / technique text of one staff at the instant of the target: `spec` { text?, technique?, style?, placement? }; one undoable transaction. */
    addStaffText(target, staffId, spec, viewId = 'main') {
      const staff = doc.find(staffId);
      const mv = staff && doc.movementOf(staff);
      if (!mv) throw new Error(`Unknown staff: ${staffId}`);
      return this.edit('Texte de portée', () => addStaffText(doc, mv, staff, { measureId: target.measureId, position: target.position, ...spec }), { viewId });
    },
    updateStaffText(staffId, id, patch, viewId = 'main') {
      const staff = doc.find(staffId);
      return this.edit('Texte de portée', () => updateStaffText(doc, staff, id, patch), { viewId });
    },
    removeStaffText(staffId, id, viewId = 'main') {
      const staff = doc.find(staffId);
      return this.edit('Texte de portée', () => removeStaffText(doc, staff, id), { viewId });
    },
    /** Staff container above a staff, from a target ({ measureId, span }): kind 'text' (spec.text) or 'rhythm' (nested simplified rhythm). One undoable transaction. */
    addContainer(target, staffId, spec, viewId = 'main') {
      const staff = doc.find(staffId);
      const mv = staff && doc.movementOf(staff);
      if (!mv) throw new Error(`Unknown staff: ${staffId}`);
      const base = { measureId: target.measureId, span: target.span ?? 1 };
      // 'score': a notation staff with the clef of the anchor staff (time and key signature follow the piece, hidden); 'rhythm': simplified rhythm
      const nested = spec.kind === 'score' ? { staffType: 'score', clef: staff.props?.clef ?? 'G' } : { staffType: spec.staffType ?? 'rhythm' };
      return this.edit('Conteneur', () => (spec.kind === 'text' ? addTextContainer(doc, mv, staff, { ...base, text: spec.text }) : addNestedContainer(doc, mv, staff, { ...base, ...nested })), { viewId });
    },
    /**
     * Text container BETWEEN measures, from a target ({ measureId, span }): `side` 'before' = just before the first measure of the target,
     * 'after' = just after its last measure. One undoable transaction.
     */
    /**
     * One container BETWEEN measures on EVERY visible staff, each in the row of its staff (they share one column). `spec.kind`: 'text' (spec.text)
     * | 'fragment' (a nested score per staff; spec.staffType 'rhythm' forces rhythm). One undoable transaction.
     */
    addSlotContainersEveryStaff(target, { side = 'before', kind = 'fragment', text, staffType, measures = 1, gap = false } = {}, viewId = 'main') {
      const any = doc.find(target.measureId);
      const mv = any && doc.movementOf(any);
      if (!mv) throw new Error(`Unknown measure: ${target.measureId}`);
      const at = mv.masterbars.findIndex((b) => b.id === target.measureId);
      const lastIndex = Math.min(mv.masterbars.length - 1, at + Math.max(1, target.span ?? 1) - 1);
      const measureId = side === 'after' ? mv.masterbars[lastIndex]?.id : target.measureId;
      return this.edit('Conteneurs sur chaque portée', () => addSlotContainersEveryStaff(doc, mv, { measureId, side, kind, text, staffType, measures, gap }), { viewId });
    },
    addSlotContainer(target, staffId, { side = 'before', text, width, gap = false } = {}, viewId = 'main') {
      const staff = doc.find(staffId);
      const mv = staff && doc.movementOf(staff);
      if (!mv) throw new Error(`Unknown staff: ${staffId}`);
      const at = mv.masterbars.findIndex((b) => b.id === target.measureId);
      const lastIndex = Math.min(mv.masterbars.length - 1, at + Math.max(1, target.span ?? 1) - 1);
      const measureId = side === 'after' ? mv.masterbars[lastIndex]?.id : target.measureId;
      return this.edit('Conteneur intercalé', () => addSlotContainer(doc, mv, staff, { measureId, side, text, width, gap }), { viewId });
    },
    /** Short score BETWEEN measures (a fragment = a small movement of its own); `side` as `addSlotContainer`, `staffType` 'score' | 'rhythm' | … */
    addFragmentContainer(target, staffId, { side = 'before', staffType = 'score', measures = 1, grand = false } = {}, viewId = 'main') {
      const staff = doc.find(staffId);
      const mv = staff && doc.movementOf(staff);
      if (!mv) throw new Error(`Unknown staff: ${staffId}`);
      const at = mv.masterbars.findIndex((b) => b.id === target.measureId);
      const lastIndex = Math.min(mv.masterbars.length - 1, at + Math.max(1, target.span ?? 1) - 1);
      const measureId = side === 'after' ? mv.masterbars[lastIndex]?.id : target.measureId;
      return this.edit('Partition intercalée', () => addFragmentContainer(doc, mv, staff, { measureId, side, staffType, measures, grand }), { viewId });
    },
    setFragmentMeasures(containerId, count, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Mesures de la partition', () => setFragmentMeasures(doc, c, count, doc.movementOf(c)), { viewId });
    },
    setFragmentHeader(containerId, flags, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Chiffrage et armure de la partition', () => setFragmentHeader(doc, c, flags), { viewId });
    },
    /** Spacing of the nested notes of a stacked container: `{ spacing: 'chords' | 'document', widen: boolean }`. One undoable transaction. */
    setContainerSpacing(containerId, flags, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Espacement du conteneur', () => setContainerSpacing(doc, c, flags), { viewId });
    },
    /** Settings of a nested score (container), one undoable transaction each. */
    setContainerLayout(containerId, layout, viewId = 'main') {
      const c = doc.find(containerId);
      const mv = c && doc.movementOf(c);
      if (!mv) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Placement de la partition', () => setContainerLayout(doc, mv, c, layout), { viewId });
    },
    setContainerTransposeFollow(containerId, follow, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Transposition de la partition', () => setContainerTransposeFollow(doc, c, follow), { viewId });
    },
    setContainerPlay(containerId, mode, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Lecture de la partition', () => setContainerPlay(doc, c, mode), { viewId });
    },
    setContainerScale(containerId, scale, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Taille de la partition', () => setContainerScale(doc, c, scale), { viewId });
    },
    /** `which` 'key' | 'time': own signature on / off. */
    setContainerOwnSignature(containerId, which, on, viewId = 'main') {
      const c = doc.find(containerId);
      const mv = c && doc.movementOf(c);
      if (!mv) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Signature de la partition', () => setContainerOwnSignature(doc, mv, c, which, on), { viewId });
    },
    /** Sets the key (integer, sharps > 0) and / or time signature ([num, den]) of every measure of the nested score. */
    setFragmentSignature(containerId, values, viewId = 'main') {
      const c = doc.find(containerId);
      const mv = c && doc.movementOf(c);
      if (!mv) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Signature de la partition', () => setFragmentSignature(doc, mv, c, values), { viewId });
    },
    setSlotSeparator(containerId, on, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Trait de séparation', () => setSlotSeparator(doc, c, on), { viewId });
    },
    setSlotWidth(containerId, width, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Largeur du conteneur', () => setSlotWidth(doc, c, width), { viewId });
    },
    setContainerSpan(containerId, span, viewId = 'main') {
      const c = doc.find(containerId);
      const mv = c && doc.movementOf(c);
      if (!mv) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Étendue du conteneur', () => setContainerSpan(doc, mv, c, span), { viewId });
    },
    setContainerText(containerId, text, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Texte du conteneur', () => setContainerText(doc, c, text), { viewId });
    },
    // ---------- chord diagrams (fretted instruments) ----------
    /**
     * The chord a new diagram should be for at a measure: the first chord symbol written in it on a chord staff of the movement, else C major.
     * Returns { root, quality, bass }.
     */
    diagramChordAt(measureId) {
      const any = doc.find(measureId);
      const mv = any && doc.movementOf(any);
      const at = mv ? mv.masterbars.findIndex((b) => b.id === measureId) : -1;
      if (at >= 0) {
        for (const track of mv.tracks) for (const staff of track.staves) {
          if (getProperty(staff, PID.STAFF_TYPE) !== 'chord') continue;
          for (const voice of staff.voices) {
            const found = (voice.measures[at]?.items ?? []).find((it) => it.type === 'chordsymbol' && !(getProperty(it, PID.CHORD_SPECIAL) ?? 'none').match(/repeat|noChord/) && getProperty(it, PID.CHORD_ROOT));
            if (found) return diagramChordOf(found);
          }
        }
      }
      return { root: { step: 'C', alter: 0 }, quality: '', bass: null };
    },
    /**
     * A chord-diagram container on a staff, from a target ({ measureId, span }): `where` 'above' (over the measures) | 'before' | 'after' (between measures).
     * The chord is the one written at the measure (see `diagramChordAt`) unless `spec.chord` is given. One undoable transaction.
     */
    addDiagramContainer(target, staffId, spec = {}, viewId = 'main') {
      const staff = doc.find(staffId);
      const mv = staff && doc.movementOf(staff);
      if (!mv) throw new Error(`Unknown staff: ${staffId}`);
      const where = spec.where ?? 'above';
      const at = mv.masterbars.findIndex((b) => b.id === target.measureId);
      const lastIndex = Math.min(mv.masterbars.length - 1, at + Math.max(1, target.span ?? 1) - 1);
      const measureId = where === 'after' ? mv.masterbars[lastIndex]?.id : target.measureId;
      // over measures that carry chord symbols the diagram FOLLOWS them (one per symbol); elsewhere it is for one chord
      const follow = spec.follow ?? (where === 'above' && !spec.chord && chordSymbolsInSpan(mv, target.measureId, target.span ?? 1).length > 0);
      return this.edit('Diagramme d\'accord', () => addDiagramContainer(doc, mv, staff, {
        measureId, span: target.span ?? 1, placement: where === 'above' ? 'above' : 'between', side: where === 'after' ? 'after' : 'before',
        chord: follow ? null : spec.chord ?? this.diagramChordAt(target.measureId), instrument: spec.instrument ?? 'guitar', follow,
      }), { viewId });
    },
    /**
     * What the diagram editor shows for a diagram container: { chord, instrument, voicing, source, suggestions: [voicing…], index, hasPreferred, qualities, follow, entries?, key? } or null.
     * A container in follow mode has one entry per chord symbol (`entries` [{ key, chord }]); `key` picks the one to show (default: the first).
     */
    diagramInfo(id, { suggestions = 8, key = null } = {}) {
      const c = doc.find(id);
      const isSymbol = c?.type === 'chordsymbol'; // a chord symbol that carries its own diagram
      const isChord = c?.type === 'chord'; // a chord of notes: the diagram is derived from its notes
      if (!c || (!isSymbol && !isChord && getProperty(c, PID.CONTAINER_KIND) !== 'chordDiagram')) return null;
      if (isChord) {
        const staff = doc.parentOf(doc.parentOf(doc.parentOf(c.id)?.id)?.id);
        const instrument = getProperty(c, PID.DIAGRAM_INSTRUMENT);
        const voicing = staff ? chordDiagramVoicing(staff, c, instrument) : null;
        const look = diagramLook(c, styleLookup(doc.movementOf(c)?.style));
        return {
          chord: null, instrument, tuning: voicing ? (voicing.tuning ?? INSTRUMENT_PRESETS[voicing.instrument]?.tuning ?? null) : null, voicing, source: voicing ? 'notes' : null, spec: null, index: 0, follow: false, key: null, entries: null,
          derived: true, onTab: getProperty(staff, PID.STAFF_TYPE) === 'tab', suggestions: [], library: [], inLibrary: false, hasPreferred: false, qualities: [],
          lift: getProperty(c, PID.DIAGRAM_LIFT), liftDefault: resolveStyle(SID.DIAGRAM_LIFT, [doc.movementOf(c)?.style]), color: look.color, symbol: false,
          gauge: look.gauge, zoom: look.scale, orientation: look.orientation,
        };
      }
      const dict = workChordQualities(doc.work);
      const preferred = getProperty(doc.work, PID.PREFERRED_VOICINGS);
      const instrument = getProperty(c, PID.DIAGRAM_INSTRUMENT);
      const tuning = tuningOfInstrument(instrument);
      const follow = !isSymbol && Boolean(getProperty(c, PID.DIAGRAM_FOLLOW));
      let chord = isSymbol ? null : getProperty(c, PID.DIAGRAM_CHORD);
      let res;
      let index = getProperty(c, PID.DIAGRAM_SUGGESTION);
      let entries = null;
      let chosen = null;
      if (follow) {
        const mv = doc.movementOf(c);
        entries = mv ? followedDiagrams(mv, c, { preferred, dict }) : [];
        const found = entries.find((e) => e.key === key) ?? entries[0] ?? null;
        chosen = found?.key ?? null;
        chord = found?.chord ?? null;
        res = found?.res ?? null;
        index = getProperty(c, PID.DIAGRAM_OVERRIDES)?.[chosen]?.suggestion ?? 0;
      } else if (isSymbol) {
        chord = diagramChordOf(c);
        const mvOf = doc.movementOf(c);
        res = resolveDiagram({ voicing: getProperty(c, PID.VOICING), chord, instrument, index, preferred, dict, pathVoicing: mvOf ? chordPathFor(mvOf, instrument, { preferred, dict }).get(c.id) ?? null : null });
      } else res = resolveElementDiagram(c, { preferred, dict });
      const spec = chord ? chordSpecFromSymbol(chord, dict) : null;
      const look = isSymbol ? diagramLook(c, styleLookup(doc.movementOf(c)?.style)) : null; // a symbol: its own look, else the movement's default
      return {
        lift: isSymbol ? getProperty(c, PID.DIAGRAM_LIFT) : null, liftDefault: resolveStyle(SID.DIAGRAM_LIFT, [doc.movementOf(c)?.style]), orientation: look ? look.orientation : getProperty(c, PID.DIAGRAM_ORIENTATION), color: look ? look.color : getProperty(c, PID.COLOR) ?? null, symbol: isSymbol, gauge: look ? look.gauge : getProperty(c, PID.DIAGRAM_GAUGE) !== false, zoom: look ? look.scale : getProperty(c, PID.CONTAINER_SCALE) ?? 1,
        chord, instrument, tuning, voicing: res?.voicing ?? null, source: res?.path ? 'path' : res?.source ?? null, spec, index, follow, key: chosen,
        canSolve: Boolean((isSymbol || follow) && tuning && instrument !== 'piano' && chord), solver: (isSymbol ? c : doc.find(chosen))?.props?.[PID.DIAGRAM_SOLVER] !== false,
        entries: entries ? entries.map((e) => ({ key: e.key, chord: e.chord })) : null,
        suggestions: spec ? suggestVoicings(spec, { instrument, limit: suggestions }).map((r) => r.voicing) : [],
        library: spec ? libraryFor(preferences.get('diagramLibrary'), chordKey(spec, instrument, tuning)) : [], // the user's own fingerings of this chord (the editor offers them first)
        inLibrary: Boolean(spec && res?.voicing && inLibrary(preferences.get('diagramLibrary'), chordKey(spec, instrument, tuning), res.voicing)),
        hasPreferred: Boolean(spec && preferred?.[chordKey(spec, instrument, tuning)]),
        qualities: dict.qualities.map((q) => q.id),
      };
    },
    // `key` (last parameter): the chord symbol a diagram in follow mode is edited for
    /** Keeps / drops the fingering shown by a diagram in the user's personal repertoire (a device preference, never written in the document). */
    saveDiagramToLibrary(id, { key = null, remove = false } = {}) {
      const info = this.diagramInfo(id, { key });
      if (!info?.voicing || !info.spec) throw new Error('Nothing to keep');
      const k = chordKey(info.spec, info.instrument, info.tuning);
      const lib = preferences.get('diagramLibrary');
      preferences.set('diagramLibrary', remove ? removeFromLibrary(lib, k, info.voicing) : addToLibrary(lib, k, info.voicing));
    },
    /** The path of least movement on / off for the chord symbol of a diagram (`key` in follow mode): off = the fingering the chord has on its own. */
    setDiagramSolver(id, on, viewId = 'main', key = null) { return this.edit('Diagramme : enchaînement', () => setSymbolSolver(doc, doc.find(key ?? id), on), { viewId }); },
    setDiagramVoicing(id, voicing, viewId = 'main', key = null) { return this.edit('Doigté du diagramme', () => setDiagramVoicing(doc, doc.find(id), voicing, key), { viewId }); },
    resetDiagramVoicing(id, viewId = 'main', key = null) { return this.edit('Diagramme : retour à la suggestion', () => resetDiagramVoicing(doc, doc.find(id), key), { viewId }); },
    setDiagramSuggestion(id, index, viewId = 'main', key = null) { return this.edit('Diagramme : autre suggestion', () => setDiagramSuggestion(doc, doc.find(id), index, key), { viewId }); },
    setDiagramChord(id, chord, viewId = 'main') { return this.edit('Diagramme : accord', () => setDiagramChord(doc, doc.find(id), chord), { viewId }); },
    setDiagramInstrument(id, instrument, viewId = 'main') { return this.edit('Diagramme : instrument', () => setDiagramInstrument(doc, doc.find(id), instrument), { viewId }); },
    /** "Use this fingering everywhere this chord is shown": the work's preferred fingering for the chord and instrument. */
    useDiagramEverywhere(id, viewId = 'main', key = null) {
      const info = this.diagramInfo(id, { key });
      if (!info?.voicing || !info.chord) throw new Error('Nothing to use');
      return this.edit('Diagramme : doigté préféré', () => setPreferredVoicing(doc, doc.work, info.chord, info.voicing, workChordQualities(doc.work)), { viewId });
    },
    forgetPreferredDiagram(id, viewId = 'main', key = null) {
      const info = this.diagramInfo(id, { key });
      if (!info?.chord) return null;
      return this.edit('Diagramme : oublier le doigté préféré', () => clearPreferredVoicing(doc, doc.work, info.chord, info.instrument, workChordQualities(doc.work)), { viewId });
    },
    // ---------- layers ("pools") of preferred fingerings, shown by the "Chords of the piece" window ----------
    /** The layers of the work: [{ id, name, rule, count }], the main pool first (id 'main', name null: the interface names it). */
    voicingPools() {
      const main = getProperty(doc.work, PID.PREFERRED_VOICINGS) ?? {};
      return [{ id: 'main', name: null, rule: null, count: Object.keys(main).length }, ...voicingPools.allPoolsOf(doc.work).map((p) => ({ id: p.id, name: p.name, rule: p.rule ?? null, ...(p.builtin ? { builtin: true } : {}), unnamed: p.unnamed ?? [], labelOrder: p.labelOrder ?? [], count: Object.keys(p.voicings ?? {}).length }))];
    },
    /**
     * The distinct chords of the work for an instrument, in order of appearance, with the fingering a layer shows for each:
     * [{ id (chord key), chord, name, count, ownCount (occurrences with a fingering of their own), voicing, from: 'pool' | 'main' | 'rule' | 'suggestion', spec }].
     */
    workChords(poolId = 'main', instrument = 'guitar') {
      const dict = workChordQualities(doc.work);
      const tuning = tuningOfInstrument(instrument);
      if (!tuning) return [];
      const preferred = voicingPools.effectivePreferred(doc.work, poolId);
      const layer = poolId && poolId !== 'main' ? voicingPools.allPoolsOf(doc.work).find((p) => p.id === poolId) : null;
      const main = getProperty(doc.work, PID.PREFERRED_VOICINGS) ?? {};
      const own = layer ? layer.voicings ?? {} : main;
      const seen = new Map();
      for (const mv of doc.work.movements) {
        if (!mv.masterbars.length) continue;
        for (const e of chordSymbolsInSpan(mv, mv.masterbars[0].id, mv.masterbars.length)) {
          const spec = chordSpecFromSymbol(e.chord, dict);
          if (!spec) continue;
          const key = chordKey(spec, instrument, tuning);
          let row = seen.get(key);
          if (!row) { row = { id: key, chord: e.chord, name: chordName(e.chord), count: 0, ownCount: 0, spec }; seen.set(key, row); }
          row.count += 1;
          if (getProperty(e.sym, PID.VOICING) && getProperty(e.sym, PID.DIAGRAM_INSTRUMENT) === instrument) row.ownCount += 1;
        }
      }
      // the chords the layer holds that the piece does not write (named from the tablature): listed after the others, so that they can be seen and changed
      if (layer && !layer.builtin) for (const [key, voicing] of Object.entries(layer.voicings ?? {})) {
        if (seen.has(key) || !key.startsWith(`${instrument}|`)) continue;
        const chord = layer.names?.[key] ?? suggestChordName(voicing, dict);
        if (!chord || !chordSpecFromSymbol(chord, dict)) continue;
        seen.set(key, { id: key, chord, name: chordName(chord), count: 0, ownCount: 0, spec: chordSpecFromSymbol(chord, dict) });
      }
      return [...seen.values()].map((row) => {
        const res = resolveDiagram({ chord: row.chord, instrument, preferred, dict });
        const from = row.id in own ? 'pool' : layer?.rule && res?.rule ? 'rule' : row.id in main ? 'main' : 'suggestion';
        return { ...row, voicing: res?.voicing ?? null, from, alternatives: layer?.alternatives?.[row.id] ?? [], hidden: layer?.hidden?.[row.id] ?? [], tags: layer?.tags?.[row.id] ?? {} };
      });
    },
    /** The fingerings one can pick for a chord: the user's repertoire first, then the computed suggestions. */
    chordVariants(chord, instrument = 'guitar', limit = 24) {
      const dict = workChordQualities(doc.work);
      const spec = chordSpecFromSymbol(chord, dict);
      const tuning = tuningOfInstrument(instrument);
      if (!spec || !tuning) return [];
      const mine = libraryFor(preferences.get('diagramLibrary'), chordKey(spec, instrument, tuning));
      const list = [...mine, ...suggestVoicings(spec, { instrument, limit }).map((r) => r.voicing)];
      return list.filter((v, i) => list.findIndex((w) => sameVoicing(v, w)) === i);
    },
    /** The tablatures and chord staves a layer can be made from: { tabs, chordStaves } = [{ id, name, movementIndex }]. */
    poolSources() { return poolFrom.poolSources(doc.work); },
    /** What a layer made from a tablature (`source` 'tab') or from the diagrams shown on a chord staff ('chordStaff') would hold: { chords, withAlternatives } (nothing is written). `staffId` null = the staff each chord staff reads / the first chord staff. */
    poolFromPreview({ source, staffId = null }) {
      const found = this._poolFound(source, staffId);
      return { chords: found.entries.length, withAlternatives: found.entries.filter((e) => e.voicings.length > 1).length, unnamed: found.unnamed.length };
    },
    _poolFound(source, staffId) {
      if (source === 'tab') return poolFrom.chordsFromTabAll(doc.work, { tabStaffId: staffId }); // the fingerings under a chord symbol, and the others (to be named)
      if (source === 'tabDiagrams') return poolFrom.chordsFromTabDiagrams(doc.work, { tabStaffId: staffId }); // the diagrams shown on a tablature staff
      return { entries: poolFrom.chordsFromChordStaff(doc.work, { chordStaffId: staffId }), unnamed: [] };
    },
    /** Makes a layer from a tablature / the diagrams of a chord staff. `target`: { mode: 'new', name } | { mode: 'replace' | 'complete', poolId }. One undo step; returns { poolId, written, kept, waiting }. */
    makePoolFrom({ source, staffId = null, target }) {
      const { entries, unnamed } = this._poolFound(source, staffId);
      let out;
      this.edit('Couche de doigtés : créée depuis la partition', () => {
        if (target.mode === 'new') { const made = poolFrom.createPoolFrom(doc, doc.work, target.name, entries, { unnamed }); out = { poolId: made.pool.id, written: made.written, kept: 0, waiting: made.waiting }; }
        else { const r = poolFrom.fillPool(doc, doc.work, target.poolId, entries, { mode: target.mode, unnamed }); out = { poolId: target.poolId, ...r }; }
      });
      return out;
    },
    /** A fingering waiting for a name in a layer gets one: `chord` = { root, quality, bass }. Joins the layer under that chord. */
    nameUnnamedVoicing(poolId, fkey, chord) { return this.edit('Couche de doigtés : nommer un doigté', () => poolFrom.nameUnnamed(doc, doc.work, poolId, fkey, chord, workChordQualities(doc.work))); },
    discardUnnamedVoicing(poolId, fkey) { return this.edit('Couche de doigtés : retirer un doigté', () => poolFrom.discardUnnamed(doc, doc.work, poolId, fkey)); },
    /** The name a fingering most probably has ({ root, quality, bass } or null): a PROPOSAL for the naming of a fingering that has none. */
    suggestChordName(voicing) { return suggestChordName(voicing, workChordQualities(doc.work)); },
    /** What the naming menus offer: the roots and the qualities of the work's dictionary ({ id, text }). */
    nameChoices() {
      const dict = workChordQualities(doc.work);
      return { qualities: dict.qualities.map((q) => ({ id: q.id, text: q.shown ?? q.id })) };
    },
    addVoicingPool(name) { let made; this.edit('Couche de doigtés : nouvelle', () => { made = voicingPools.addPool(doc, doc.work, name); }); return made; },
    renameVoicingPool(id, name) { return this.edit('Couche de doigtés : renommer', () => voicingPools.renamePool(doc, doc.work, id, name)); },
    removeVoicingPool(id) { return this.edit('Couche de doigtés : supprimer', () => voicingPools.removePool(doc, doc.work, id)); },
    setVoicingPoolRule(id, rule) { return this.edit('Couche de doigtés : règle', () => voicingPools.setPoolRule(doc, doc.work, id, rule)); },
    /** Sets the fingering of a chord in a layer (the main pool = 'main'). */
    setPoolVoicing(poolId, chord, voicing) { return this.edit('Doigté de la couche', () => voicingPools.setPoolVoicing(doc, doc.work, poolId, chord, voicing, workChordQualities(doc.work))); },
    /** Switches an alternative fingering of a chord on / off in a layer (off: kept, not shown by the diagram lists); makes one the main fingering. `key` = the chord key of the card. */
    setVariantActive(poolId, key, fkey, on) { return this.edit('Couche de doigtés : variante', () => voicingPools.setVariantActive(doc, doc.work, poolId, key, fkey, on)); },
    /** The labels of one fingering of a chord in a layer (free names: Verse, Chorus…), used by the diagram lists grouped by label. `vid` = the fingering's id (its frets). */
    setVariantLabels(poolId, key, vid, labels) { return this.edit('Couche de doigtés : étiquettes', () => voicingPools.setVariantLabels(doc, doc.work, poolId, key, vid, labels)); },
    /** The fingerings of a group (a label) of a layer, in the order a list shows them: [{ ref, key, vid, voicing, main }]; and moving one earlier / later (`delta` -1 / +1). */
    groupMembers(poolId, labelText) { const pool = voicingPools.poolsOf(doc.work).find((p) => p.id === poolId); return pool ? voicingPools.groupMembers(pool, labelText) : []; },
    moveInGroup(poolId, labelText, ref, delta) { return this.edit('Couche de doigtés : classement', () => voicingPools.moveInGroup(doc, doc.work, poolId, labelText, ref, delta)); },
    setPoolMain(poolId, key, fkey) { return this.edit('Couche de doigtés : doigté principal', () => voicingPools.setPoolMain(doc, doc.work, poolId, key, fkey)); },
    clearPoolVoicing(poolId, chord, instrument) { return this.edit('Couche de doigtés : oublier un doigté', () => voicingPools.clearPoolVoicing(doc, doc.work, poolId, chord, instrument, workChordQualities(doc.work))); },
    /** The layer a printed part shows (null = the main pool). */
    setPartPool(partId, poolId) {
      const part = doc.find(partId);
      return this.edit('Partie : couche de doigtés', () => { if (poolId) doc.set(part, PID.PART_VOICING_POOL, poolId); else doc.reset(part, PID.PART_VOICING_POOL); });
    },
    /** The layer a diagram-list zone cell shows (null = the part's). */
    setZonePool(partId, cellId, poolId) {
      const cell = (doc.find(partId)?.containers ?? []).find((x) => x.id === cellId);
      if (!cell) throw new Error('Unknown zone cell');
      return this.edit('Zone : couche de doigtés', () => { if (poolId) doc.set(cell, PID.DIAGRAM_LIST_POOL, poolId); else doc.reset(cell, PID.DIAGRAM_LIST_POOL); });
    },
    /** Moves a stacked container away from (+) or toward (−) its staff by `delta` staff spaces (never closer than the default place). */
    moveContainerAway(containerId, delta, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Distance du conteneur', () => setContainerGap(doc, c, Math.max(0, Math.round(((getProperty(c, PID.CONTAINER_GAP) ?? 0) + delta) * 100) / 100)), { viewId });
    },
    /** Zoom of a text or a diagram container: `direction` +1 / −1 moves to the next / previous step (a nested score only reduces: 1 at most). */
    zoomContainer(containerId, direction, viewId = 'main') {
      const c = doc.find(containerId);
      if (!c) throw new Error(`Unknown container: ${containerId}`);
      const isSymbol = c.type === 'chordsymbol' || c.type === 'chord'; // the diagram of a chord symbol or of a chord of notes: its own size
      const max = isSymbol || ['text', 'chordDiagram', 'chordDiagramList'].includes(getProperty(c, PID.CONTAINER_KIND)) ? 3 : 1;
      const steps = CONTAINER_ZOOM_STEPS.filter((s) => s <= max);
      const now = isSymbol ? diagramLook(c, styleLookup(doc.movementOf(c)?.style)).scale : getProperty(c, PID.CONTAINER_SCALE) ?? 1;
      const at = steps.reduce((best, s, i) => (Math.abs(s - now) < Math.abs(steps[best] - now) ? i : best), 0);
      const next = steps[Math.min(steps.length - 1, Math.max(0, at + direction))];
      if (isSymbol) return this.edit('Zoom du diagramme', () => setDiagramScale(doc, c, next), { viewId });
      return this.edit('Zoom du conteneur', () => setContainerScale(doc, c, next), { viewId });
    },
    /** Shows / hides the diagram of the chord symbols among `ids` (all shown → hidden, otherwise all shown). Returns the symbol ids it applied to. */
    /** The elements that can carry a diagram among `ids`: chord symbols, and the chords of notes (a selected note stands for its chord) of notation and tablature staves. */
    diagramHosts(ids) {
      const out = [];
      for (const id of ids) {
        let el = doc.find(id);
        if (el && ['note', 'tabnote'].includes(el.type)) el = doc.parentOf(el.id);
        if (!el) continue;
        if (el.type === 'chordsymbol') { if ((getProperty(el, PID.CHORD_SPECIAL) ?? 'none') === 'none') out.push(el); continue; }
        if (el.type !== 'chord') continue;
        const measure = doc.parentOf(el.id);
        if (measure?.type !== 'measure') continue; // a grace note carries none
        const staff = doc.parentOf(doc.parentOf(measure.id)?.id);
        if (['score', 'tab'].includes(getProperty(staff, PID.STAFF_TYPE))) out.push(el);
      }
      return [...new Set(out)];
    },
    /**
     * The elements of a range that can carry a diagram: the chord symbols of the chord staves it covers; if it covers none, the chords of notes of its notation / tablature
     * staves. One gesture can then show (or hide) all their diagrams.
     */
    rangeDiagramHosts(range) {
      const mv = doc.movementOf(doc.find(range.staffIds[0]));
      if (!mv) return [];
      const symbols = rangeChordSymbols(mv, range).filter((e) => (getProperty(e.item, PID.CHORD_SPECIAL) ?? 'none') === 'none').map((e) => e.item);
      if (symbols.length) return symbols;
      return this.diagramHosts(rangeItems(mv, range).filter((e) => e.item.type === 'chord' && ['score', 'tab'].includes(getProperty(e.staff, PID.STAFF_TYPE))).map((e) => e.item.id));
    },
    /** All the hosts of the range show their diagram? (null: none can carry one) */
    rangeDiagramsShown(range) {
      const hosts = this.rangeDiagramHosts(range);
      return hosts.length ? hosts.every((h) => getProperty(h, PID.DIAGRAM_SHOWN)) : null;
    },
    /** One gesture: every host of the range shows its diagram (or, when they all do, none). Returns how many were touched. */
    // ---------- advised page turns (model/pagehints.js): set on screen 2, for ONE track, after a measure ----------
    /** The staves of the track that holds `staffId`, and the measure after `measureId` (where the advised page starts); null when there is none (last measure). */
    pageHintTarget(staffId, measureId) {
      const staff = doc.find(staffId); const mv = staff && doc.movementOf(staff);
      const track = mv?.tracks.find((t) => t.staves.some((s) => s.id === staffId));
      const next = mv?.masterbars[mv.masterbars.findIndex((b) => b.id === measureId) + 1];
      return track && next && mv.masterbars.some((b) => b.id === measureId) ? { staves: track.staves, measureId: next.id } : null;
    },
    /** Is a page turn advised after this measure for the track of the staff? (null: not possible here) */
    pageHintAfterState(staffId, measureId) {
      const t = this.pageHintTarget(staffId, measureId);
      return t ? t.staves.every((s) => hasPageHint(s, t.measureId)) : null;
    },
    /** Puts the advised page turn after the measure on (or takes it off), for the track of the staff only. One undoable step. */
    togglePageHintAfter(staffId, measureId) {
      const t = this.pageHintTarget(staffId, measureId);
      if (!t) return null;
      let on = null;
      this.edit('Saut de page conseillé', () => { on = togglePageHint(doc, t.staves, t.measureId); });
      return on;
    },
    toggleRangeDiagrams(range, viewId = 'main') {
      const hosts = this.rangeDiagramHosts(range);
      if (!hosts.length) return 0;
      const on = !hosts.every((h) => getProperty(h, PID.DIAGRAM_SHOWN));
      this.edit(on ? 'Diagrammes sur la plage' : 'Retirer les diagrammes de la plage', () => { for (const h of hosts) setSymbolDiagramShown(doc, h, on); }, { viewId });
      return hosts.length;
    },
    toggleSymbolDiagram(ids, viewId = 'main') {
      const symbols = this.diagramHosts(ids);
      if (!symbols.length) return [];
      const on = !symbols.every((s) => getProperty(s, PID.DIAGRAM_SHOWN));
      this.edit(on ? 'Diagramme sur les accords' : 'Retirer les diagrammes des accords', () => { for (const s of symbols) setSymbolDiagramShown(doc, s, on); }, { viewId });
      return symbols.map((s) => s.id);
    },
    /** Removes a diagram: a container is deleted; a chord symbol or a chord of notes just stops showing it (one undoable step). */
    removeDiagram(id, viewId = 'main') {
      const el = doc.find(id);
      if (!el) return false;
      if (el.type === 'chordsymbol' || el.type === 'chord') { this.edit('Retirer le diagramme', () => setSymbolDiagramShown(doc, el, false), { viewId }); return true; }
      return this.deleteElements([id], viewId) > 0;
    },
    /** Are all the chord symbols among `ids` showing their diagram? (null: no chord symbol) */
    symbolDiagramShown(ids) {
      const symbols = this.diagramHosts(ids);
      return symbols.length ? symbols.every((s) => getProperty(s, PID.DIAGRAM_SHOWN)) : null;
    },
    /** Height of the diagram of a chord symbol above it (staff spaces); null = the movement's setting. */
    setDiagramLift(id, lift, viewId = 'main') { return this.edit('Diagramme : hauteur', () => setDiagramLift(doc, doc.find(id), lift), { viewId }); },
    /** Colour of ALL the dots of a diagram (#rrggbb), or null for the ink. */
    setDiagramColor(id, color, viewId = 'main') {
      if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid colour: ${color}`);
      return this.edit('Diagramme : couleur', () => { const el = doc.find(id); if (color === null) { if (getProperty(el, PID.COLOR)) doc.reset(el, PID.COLOR); } else doc.set(el, PID.COLOR, color); }, { viewId });
    },
    /** A piano diagram lies ('horizontal') or stands ('vertical'). */
    setDiagramOrientation(id, orientation, viewId = 'main') { return this.edit('Diagramme : orientation', () => setDiagramOrientation(doc, doc.find(id), orientation), { viewId }); },
    setDiagramGauge(id, on, viewId = 'main') { return this.edit('Diagramme : épaisseur des cordes', () => setDiagramGauge(doc, doc.find(id), on), { viewId }); },
    /**
     * The diagrams "apply to all" would touch for the diagram `id`: { count, staff, instrument } (count = diagrams that show one, the source included).
     * Options as `applyDiagramLookToAll`; `null` when `id` is not a diagram of a chord symbol / chord of notes.
     */
    diagramLookTargets(id, { scope = 'movement', sameInstrument = false } = {}) {
      const src = doc.find(id);
      if (!src || !['chordsymbol', 'chord'].includes(src.type)) return null;
      const mv = doc.movementOf(src);
      const staff = doc.parentOf(doc.parentOf(doc.parentOf(src.id)?.id)?.id);
      const instrument = getProperty(src, PID.DIAGRAM_INSTRUMENT);
      const count = diagramHostsIn(mv, { staffId: scope === 'staff' ? staff?.id : null, instrument: sameInstrument ? instrument : null }).length;
      return { count, staff: staff?.id ?? null, instrument, hasDefault: LOOK_KEYS.some((k) => Object.hasOwn(mv.style, { scale: SID.DIAGRAM_SCALE, lift: SID.DIAGRAM_LIFT, orientation: SID.DIAGRAM_ORIENTATION, gauge: SID.DIAGRAM_GAUGE, color: SID.DIAGRAM_DOT_COLOR }[k])) };
    },
    /**
     * "Apply to all": the look of the diagram `id` (`keys` among scale, lift, orientation, gauge, color) for the other diagrams. scope 'movement' makes it the movement's
     * default (diagrams added later follow it); 'staff' = the chord staff of this diagram; `sameInstrument` keeps the diagrams of this instrument. One undo step.
     */
    applyDiagramLookToAll(id, { keys = LOOK_KEYS, scope = 'movement', sameInstrument = false } = {}, viewId = 'main') {
      const src = doc.find(id);
      if (!src || !['chordsymbol', 'chord'].includes(src.type)) throw new Error('Not a chord diagram');
      const mv = doc.movementOf(src);
      const staff = doc.parentOf(doc.parentOf(doc.parentOf(src.id)?.id)?.id);
      let n = 0;
      this.edit('Diagrammes : appliquer à tous', () => { n = applyDiagramLook(doc, mv, src, { keys, scope, staffId: staff?.id ?? null, sameInstrument }); }, { viewId });
      return n;
    },
    /** Back to the plain look for the whole movement of the diagram `id`: removes the defaults of the diagrams (the ones written on single diagrams stay). */
    resetDiagramDefaults(id, viewId = 'main') {
      const mv = doc.movementOf(doc.find(id));
      return this.edit('Diagrammes : retour aux réglages d\'origine', () => { for (const sid of [SID.DIAGRAM_SCALE, SID.DIAGRAM_LIFT, SID.DIAGRAM_ORIENTATION, SID.DIAGRAM_GAUGE, SID.DIAGRAM_DOT_COLOR]) doc.resetStyle(mv, sid); }, { viewId });
    },
    /** How many stacked containers share the staff of this one (the order buttons only make sense with two or more). */
    containerSiblings(containerId) {
      const c = doc.find(containerId);
      const staff = c && doc.parentOf(c.id);
      return staff?.containers ? staff.containers.filter((x) => getProperty(x, PID.CONTAINER_PLACEMENT) !== 'between').length : 0;
    },
    moveContainer(containerId, delta, viewId = 'main') {
      const c = doc.find(containerId);
      const staff = c && doc.parentOf(c.id);
      if (c && staff?.type === 'part') return this.edit('Ordre des conteneurs', () => movePartContainer(doc, staff.id, c.id, delta), { viewId });
      if (!staff) throw new Error(`Unknown container: ${containerId}`);
      return this.edit('Ordre des conteneurs', () => moveContainer(doc, staff, c, delta), { viewId });
    },
    // ---------- listening to the score of one container (the page attaches the playback: it owns the audio engine) ----------
    attachContainerPlayback(cp) { containerPlaybackOff?.(); containerPlayback = cp; containerPlaybackOff = cp.subscribe((id) => { for (const fn of [...containerPlayListeners]) fn(id); }); },
    /** Plays / stops the nested score of a container; false when there is nothing to hear or no audio. */
    playContainer(containerId) { return containerPlayback ? containerPlayback.play(containerId) : false; },
    stopContainer() { containerPlayback?.stop(); },
    containerPlaying: (containerId) => (containerPlayback ? containerPlayback.isPlaying(containerId) : false),
    onContainerPlay(fn) { containerPlayListeners.add(fn); return () => containerPlayListeners.delete(fn); },
    // ---------- containers hung on a staff of a PART (screen 2): one undoable transaction each ----------
    /** The staff-bound containers of a part (in the order of the list). */
    partContainers(partId) { const part = doc.find(partId); return part ? partContainersOf(part) : []; },
    addPartContainer(partId, staffId, measureId, spec = {}) { return this.edit('Part container: add', () => addPartContainer(doc, partId, staffId, measureId, spec)); },
    removePartContainer(partId, containerId) { return this.edit('Part container: remove', () => removePartContainer(doc, partId, containerId)); },
    /** Pastes a copy of the container `sourceId` (of any part) into `partId`, hung on `staffId` at `measureId`. */
    /** Copies a container of screen 1 into the part, in place (editable there); the original is hidden in that part unless `hideOriginal` is false. */
    /** The container copied (UI state, shared by screen 1 and the parts): its id while it still exists and hangs on a staff, else null. */
    containerClip() { const c = containerClipId && doc.find(containerClipId); return c && c.type === 'staffContainer' ? containerClipId : null; },
    setContainerClip(id) { containerClipId = id; },
    /** Pastes the container copied on a staff of the piece (screen 1) at the measure of `target` ({ measureId }); selects nothing. One undoable transaction. */
    pasteContainer(target, staffId, viewId = 'main') {
      const source = this.containerClip();
      if (!source) throw new Error('Nothing copied');
      return this.edit('Container: paste', () => pasteStaffContainer(doc, source, staffId, target.measureId), { viewId });
    },
    copyContainerToPart(partId, sourceId, options = {}) { return this.edit('Part container: copy from screen 1', () => copyContainerToPart(doc, sourceId, partId, options)); },
    pastePartContainer(sourceId, partId, staffId, measureId) { return this.edit('Part container: paste', () => pastePartContainer(doc, sourceId, partId, staffId, measureId)); },
    /** One system-object edit = one undoable transaction (`name` is the history label). */
    systemEdit(name, fn, viewId = 'main') {
      const mv = views.get(viewId)?.movement?.() ?? doc.work.movements[0];
      return this.edit(name, () => fn(doc, mv, sys), { viewId });
    },
    // ---------- settings of a movement (style options): one undoable transaction each ----------
    settings: (movement = 0) => settingsIntents.settingsSnapshot(doc.work.movements[movement] ?? doc.work.movements[0]),
    setSetting(sid, value, movement = 0) {
      const mv = doc.work.movements[movement] ?? doc.work.movements[0];
      return this.edit('Réglage', () => settingsIntents.setSetting(doc, mv, sid, value));
    },
    resetSetting(sid, movement = 0) {
      const mv = doc.work.movements[movement] ?? doc.work.movements[0];
      return this.edit('Réglage : par défaut', () => settingsIntents.resetSetting(doc, mv, sid));
    },
    resetAllSettings(movement = 0) {
      const mv = doc.work.movements[movement] ?? doc.work.movements[0];
      return this.edit('Réglages : tout par défaut', () => settingsIntents.resetAllSettings(doc, mv));
    },
    /** Per-track overrides of the notation options: [{ id, name, options: [{ sid, value: true | false | null, inherited }] }]. */
    trackSettings: (movement = 0) => settingsIntents.trackSettingsSnapshot(doc.work.movements[movement] ?? doc.work.movements[0]),
    /** `value` true / false overrides the movement for this track; null follows the movement again. */
    setTrackSetting(trackId, sid, value) {
      return this.edit('Réglage de la piste', () => settingsIntents.setTrackSetting(doc, trackId, sid, value));
    },
    // ---------- guitar bends / dives ----------
    /** Note ids a bend can start from: the selected notes of tablature / notation staves, or the notes of the selected chords. */
    bendTargets(ids, viewId = 'main') {
      const out = [];
      for (const id of ids ?? views.get(viewId)?.selection() ?? []) {
        const el = doc.find(id);
        if (!el) continue;
        if (el.type === 'note' || el.type === 'tabnote') out.push(el.id);
        else if (el.type === 'chord' && !marks.isGraceChord(doc, el)) for (const n of el.notes) if (n.type === 'note' || n.type === 'tabnote') out.push(n.id);
      }
      return out;
    },
    /** The targets above whose instrument is a plucked string (guitar bends, with their arrival note, make sense there) or that sit on a tablature. */
    guitarBendTargets(ids, viewId = 'main') {
      return this.bendTargets(ids, viewId).filter((id) => {
        let staff = null; let track = null;
        for (let p = doc.parentOf(id); p; p = doc.parentOf((p.el ?? p).id)) { const el = p.el ?? p; if (el.type === 'staff') staff = el; else if (el.type === 'track') { track = el; break; } }
        if (!staff || !track) return true;
        const type = getProperty(staff, PID.STAFF_TYPE);
        return type === 'tab' || profileFor({ trackId: track.id, staffType: type, group: instrumentInfo(getProperty(track, PID.INSTRUMENT_ID))?.group ?? null }) === 'strings';
      });
    },
    /** Add a bend / dive of `type` on each target note: ONE undoable transaction. Throws `EditError` when impossible. */
    addBend(type, { ids, semitones = 2 } = {}, viewId = 'main') {
      const notes = this.bendTargets(ids, viewId);
      if (!notes.length) throw new Error('Sélectionnez une note');
      const entries = this.edit('Bend', () => notes.map((n) => addBend(doc, n, type, { semitones })), { viewId });
      return entries ?? [];
    },
    /** The note that sounds a bend / wheel entry (and the chord, for a wheel on the whole chord): { noteId, chordId } or null. For hearing it in the score. */
    bendAnchor(entryId) {
      const info = this.bendCurve(entryId);
      const found = info && doc.findListEntry(info.kind === 'wheel' ? entryId : info.headId);
      if (!found) return null;
      const e = found.entry;
      const noteId = found.kind === 'wheel' ? e.startNoteId : (e.type === 'preBend' || e.type === 'preDive' || e.type === 'graceNoteBend') ? e.endNoteId : e.startNoteId;
      const chord = doc.parentOf(noteId);
      return { noteId, chordId: found.kind === 'wheel' && e.scope === 'chord' ? (chord?.el ?? chord)?.id ?? null : null };
    },
    /** Notes of the selection a wheel ("Molette") can be written on: notation and tablature notes. */
    wheelTargets(ids, viewId = 'main') {
      return this.bendTargets(ids, viewId);
    },
    /** Write a wheel on each target note (the chord, by default). ONE undoable transaction. */
    addWheel({ ids, scope = 'chord' } = {}, viewId = 'main') {
      const notes = this.wheelTargets(ids, viewId);
      if (!notes.length) throw new Error('Sélectionnez une note');
      const seen = new Set();
      const once = notes.filter((id) => { const chord = doc.parentOf(id); const key = scope === 'chord' ? (chord?.el ?? chord)?.id : id; if (seen.has(key)) return false; seen.add(key); return true; });
      return this.edit('Molette', () => once.map((n) => addWheel(doc, n, { scope })), { viewId }) ?? [];
    },
    // ---------- glissando run (organ white-key run before an arrival note; model/glissandorun.js) ----------
    /** What the glissando-run dialog needs for the selection (or `ids`): see `glissandoRunInfo`. `options.startPitch` asks for the figures of that start pitch. */
    glissandoRunInfo(ids, options = {}, viewId = 'main') {
      return glissandoRunInfo(doc, ids ?? views.get(viewId)?.selection() ?? [], options);
    },
    /** Write a glissando run before the arrival note (replaces the previous one): ONE undoable transaction. Throws `EditError` (with `code`) when impossible. */
    addGlissandoRun(ids, opts = {}, viewId = 'main') {
      return this.edit('Glissando d\'orgue', () => addGlissandoRun(doc, ids ?? views.get(viewId)?.selection() ?? [], opts), { viewId });
    },
    /** Remove the run of the arrival note (grace note and line): ONE undoable transaction. Returns true when there was one. */
    removeGlissandoRun(ids, viewId = 'main') {
      return this.edit('Glissando d\'orgue : retirer', () => removeGlissandoRun(doc, ids ?? views.get(viewId)?.selection() ?? []), { viewId }) ?? false;
    },
    setWheelScope(entryId, scope, viewId = 'main') {
      return this.edit('Molette : portée', () => setWheelScope(doc, entryId, scope), { viewId });
    },
    /** What the bend graph shows: { points: [{ t, s }], custom, editable, chain, type, semitones } or null (a wheel answers the same way, with `kind: 'wheel'`). */
    bendCurve: (entryId) => wheelInfo(doc, entryId) ?? bendCurveInfo(doc, entryId),
    /** Store the user curve of a bend / dive (the last point is the amount; the end note follows) or of a wheel. One undoable transaction. */
    setBendCurve(entryId, points, viewId = 'main') {
      if (wheelInfo(doc, entryId)) return this.edit('Molette : courbe', () => setWheelCurve(doc, entryId, points), { viewId });
      return this.edit('Bend : courbe', () => setBendCurve(doc, entryId, points), { viewId });
    },
    resetBendCurve(entryId, viewId = 'main') {
      if (wheelInfo(doc, entryId)) return this.edit('Molette : courbe par défaut', () => resetWheelCurve(doc, entryId), { viewId });
      return this.edit('Bend : courbe par défaut', () => resetBendCurve(doc, entryId), { viewId });
    },
    /** Signed size (semitones) of a bend entry, or null. */
    bendSemitones: (entryId) => bendSemitones(doc, entryId),
    setBendSemitones(entryId, semitones, viewId = 'main') {
      return this.edit('Bend : taille', () => setBendSemitones(doc, entryId, semitones), { viewId });
    },
    toggleTechLine(type, { ids, range = null } = {}, viewId = 'main') {
      const chords = marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range });
      return this.edit('Technique de jeu', () => marks.toggleTechLine(doc, chords, type), { viewId }) ?? false;
    },
    toggleChordProp(key, { ids, range = null } = {}, viewId = 'main') {
      const chords = marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range });
      return this.edit('Technique de jeu', () => marks.toggleChordProp(doc, chords, key), { viewId }) ?? 0;
    },
    stepArpeggio(direction, { ids, range = null } = {}, viewId = 'main') {
      const chords = marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range });
      return this.edit('Arpège : vitesse', () => {
        const inherited = (chord) => { const tr = doc.work.movements.flatMap((m) => m.tracks).find((t) => t.staves.some((s) => s.voices.some((v) => v.measures.some((ms) => ms?.items?.includes(chord))))); return (tr ? getProperty(tr, PID.STYLE_OVERRIDES)?.[SID.ARPEGGIO_STEP_MS] : undefined) ?? resolveStyle(SID.ARPEGGIO_STEP_MS, [doc.work.movements[0].style]); };
        return chords.reduce((n, c) => n + marks.stepArpeggio(doc, [c], direction, inherited(c)), 0);
      }, { viewId }) ?? 0;
    },
    toggleNoteFlag(flag, { ids, range = null } = {}, viewId = 'main') {
      const chords = marks.markTargets(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range });
      return this.edit('Note : technique', () => marks.toggleNoteFlag(doc, chords, flag), { viewId }) ?? 0;
    },
    setHairpinType(entryId, kind, viewId = 'main') {
      return this.edit('Soufflet : sens', () => marks.setHairpinType(doc, entryId, kind), { viewId }) ?? false;
    },
    // ---------- transposition de la sélection (demi-ton / octave) ----------
    /** Notes de notation visées par des identifiants (une note, ou toutes les notes d'un accord) : celles que ↑ ↓ peuvent transposer. */
    transposableNotes(ids) {
      const out = new Map();
      for (const id of ids ?? []) {
        const el = doc.find(id);
        if (!el) continue;
        for (const n of el.type === 'note' || el.type === 'tabnote' ? [el] : el.type === 'chord' ? (el.notes ?? []) : []) if (n.type === 'note' || n.type === 'tabnote') out.set(n.id, n);
      }
      return [...out.values()];
    },
    /** Transpose les notes visées d'un demi-ton (ou d'une octave) ; une transaction annulable, la sélection reste. Retourne le nombre de notes changées. */
    transposeNotes(ids, { up, octave = false }, viewId = 'main') {
      const notes = this.transposableNotes(ids);
      if (!notes.length) return 0;
      let changed = 0;
      this.edit(octave ? 'Transposer d\'une octave' : 'Transposer d\'un demi-ton', () => {
        const plain = notes.filter((n) => n.type === 'note'); const tab = notes.filter((n) => n.type === 'tabnote');
        if (plain.length) changed += keyboard.shiftNotes(doc, plain, !!up, !!octave);
        if (tab.length) changed += creationIntents.shiftTabNotes(doc, tab, !!up, !!octave);
      }, { select: () => [...ids], viewId });
      if (changed) emitAudition(ids);
      return changed;
    },
    // ---------- creation bar: retouches of the note(s) just created ----------
    /** `{ ids }` of the note(s) just created (the creation bar is shown while exactly these are selected), or null. */
    creation: () => (creation ? { ids: [...creation.ids], viewId: creation.viewId } : null),
    onCreationChange(fn) { creationListeners.add(fn); return () => creationListeners.delete(fn); },
    /** What the creation bar may offer for the created notes: { accidental: 0|1|2|null (null = not offered), dot: bool, rest: bool, pitched: bool }. */
    creationInfo() {
      if (!creation) return null;
      const chords = creationIntents.creationChords(doc, creation.ids);
      const chord = chords.length === 1 ? chords[0] : null;
      const notes = creationIntents.accidentalNotes(doc, creation.ids);
      return { stem: this.stemInfo(creation.ids), accidental: notes.length ? creationIntents.accidentalState(notes) : null, dot: !!chord && creationIntents.canDot(chord), rest: !!chord && chord.type === 'chord', pitched: this.transposableNotes(creation.ids).length > 0, isRest: chords.length > 0 && chords.every((c) => c.type === 'rest') };
    },
    /** Next state of the cyclic accidental button (natural → sharp → flat) for the created notes; one undoable transaction, the selection stays. */
    creationAccidental(viewId = 'main') { return this.cycleAccidental(creation?.ids ?? [], viewId); },
    /** Same for any selection of notes / chords (the retouch drawer of the selection bar). */
    cycleAccidental(ids, viewId = 'main') {
      const notes = creationIntents.accidentalNotes(doc, ids);
      if (!notes.length) return null;
      const next = (creationIntents.accidentalState(notes) + 1) % 3;
      this.edit('Altération', () => creationIntents.setAccidental(doc, notes, next), { select: () => [...ids], viewId });
      emitAudition(ids);
      return next;
    },
    /** State of the stem-direction button for these ids: 0 automatic, 1 up, 2 down, or null when it is not offered (percussion, chord staves, accordion…). */
    stemInfo(ids) {
      const chords = creationIntents.stemChords(doc, ids);
      return chords.length ? creationIntents.stemState(chords) : null;
    },
    /** Next state of the cyclic stem-direction button (automatic → up → down) for these ids; one undoable transaction, the selection stays. */
    cycleStem(ids, viewId = 'main') {
      const chords = creationIntents.stemChords(doc, ids);
      if (!chords.length) return null;
      const next = (creationIntents.stemState(chords) + 1) % 3;
      this.edit('Sens de la hampe', () => creationIntents.setStemState(doc, chords, next), { select: () => [...ids], viewId });
      return next;
    },
    /** The stem direction (state 0 automatic, 1 up, 2 down) of the chords that are selected on the main view, if any (the entry bar's stem button also acts on them). */
    setSelectionStem(state, viewId = 'main') {
      const ids = views.get(viewId)?.selection() ?? [];
      const chords = creationIntents.stemChords(doc, ids);
      if (!chords.length) return false;
      this.edit('Sens de la hampe', () => creationIntents.setStemState(doc, chords, state), { select: () => [...ids], viewId });
      return true;
    },
    /** Voice (0 to 3) of the chords of these ids for the voice button of the selection bar, or null when there is no chord. */
    voiceInfo(ids) {
      const chords = creationIntents.creationChords(doc, ids).filter((c) => c.type === 'chord');
      return chords.length ? voiceMove.voiceIndexOf(doc, chords[0]) : null;
    },
    /** Sends the chords of these ids to the next voice that can take them (1 → 2 → 3 → 4 → 1); a voice that is busy there is skipped. One undoable transaction, the selection follows the notes. */
    cycleVoice(ids, viewId = 'main') {
      const chords = creationIntents.creationChords(doc, ids).filter((c) => c.type === 'chord');
      if (!chords.length) return null;
      const from = voiceMove.voiceIndexOf(doc, chords[0]);
      let lastError = null;
      for (let k = 1; k < 4; k++) {
        const to = (from + k) % 4;
        const moved = new Map();
        try {
          this.edit('Voix de la note', () => { for (const c of chords) { const r = voiceMove.moveChordToVoice(doc, c, to); if (r) for (const [a, b] of r.noteIds) moved.set(a, b); } }, { select: () => ids.map((i) => moved.get(i) ?? i), viewId });
          return to;
        } catch (e) { if (!(e instanceof EditError)) throw e; lastError = e; }
      }
      throw lastError;
    },
    /** What the retouch drawer of the selection bar offers for these ids: { accidental: 0|1|2|null, length: bool }. */
    retouchInfo(ids) {
      const notes = creationIntents.accidentalNotes(doc, ids);
      const chords = creationIntents.creationChords(doc, ids);
      return { stem: this.stemInfo(ids), accidental: notes.length ? creationIntents.accidentalState(notes) : null, length: chords.length > 0 && chords.every((c) => creationIntents.canChangeLength(c)) };
    },
    /** One written value longer (`longer`) or shorter for every chord of the selection; the new chords are selected. Returns the number of chords changed. */
    /**
     * A duration chosen in the entry bar: it becomes the duration of the next notes AND, when existing notes are selected in entry mode (not the one just placed),
     * it changes the written value of the selected chords (one transaction).
     */
    /** The written value (base) shared by the notes / rests selected in a view, or null when there is none or they differ (the cyclic duration button reads it). */
    selectionDurationBase(viewId = 'main') {
      const v = views.get(viewId);
      if (!v) return null;
      const bases = new Set(creationIntents.creationChords(doc, v.selection()).map((c) => getProperty(c, PID.DURATION)?.base));
      return bases.size === 1 ? [...bases][0] ?? null : null;
    },
    chooseEntryDuration(duration, viewId = 'main') {
      this.setNoteEntry({ duration });
      const v = views.get(viewId) ?? views.get('main'); // the view of the bar that asks (a container's editor has its own view, with its own selection)
      if (creation || !v) return 0; // (a selection of notes or rests follows the chosen value, in entry mode or not)
      const chords = creationIntents.creationChords(doc, v.selection());
      if (!chords.length) return 0;
      const placed = chords.map((c) => ({ c, at: creationIntents.positionOf(doc, c) })).filter((x) => x.at)
        .sort((a, b) => b.at.staffId.localeCompare(a.at.staffId) || b.at.voice - a.at.voice || b.at.measureIndex - a.at.measureIndex || (b.at.position[0] / b.at.position[1]) - (a.at.position[0] / a.at.position[1]));
      const selectIds = [];
      let changed = 0;
      // rests are taken from the first to the last: a longer rest swallows the rests that follow it (they are no longer there when their turn comes)
      const rests = placed.filter((x) => x.c.type === 'rest').reverse();
      this.edit('Changer la durée', () => {
        for (const { c } of placed.filter((x) => x.c.type !== 'rest')) {
          const d = getProperty(c, PID.DURATION);
          if (d.base === duration.base && (d.dots ?? 0) === (duration.dots ?? 0)) { selectIds.push(...c.notes.map((n) => n.id)); continue; }
          selectIds.push(...creationIntents.setChordDuration(doc, c, duration).select); changed += 1;
        }
        for (const { c } of rests) {
          if (!doc.find(c.id)) continue; // already merged into the rest before it
          const d = getProperty(c, PID.DURATION);
          if (d.base === duration.base && (d.dots ?? 0) === (duration.dots ?? 0)) { selectIds.push(c.id); continue; }
          selectIds.push(...creationIntents.setRestDuration(doc, c, duration).select); changed += 1;
        }
      }, { select: () => selectIds, viewId: views.has(viewId) ? viewId : 'main' });
      return changed;
    },
    retouchLength(ids, longer, viewId = 'main') {
      const chords = creationIntents.creationChords(doc, ids);
      if (!chords.length) return 0;
      // from the last chord to the first, so a longer chord never swallows one that is still to be changed
      const placed = chords.map((c) => ({ c, at: creationIntents.positionOf(doc, c) })).filter((x) => x.at)
        .sort((a, b) => b.at.staffId.localeCompare(a.at.staffId) || b.at.voice - a.at.voice || b.at.measureIndex - a.at.measureIndex || (b.at.position[0] / b.at.position[1]) - (a.at.position[0] / a.at.position[1]));
      let selectIds = [];
      const order = [...placed.filter((x) => x.c.type !== 'rest'), ...placed.filter((x) => x.c.type === 'rest').reverse()]; // rests from the first to the last (a longer rest takes the next ones)
      this.edit(longer ? 'Allonger' : 'Raccourcir', () => { for (const { c } of order) { if (!doc.find(c.id)) continue; selectIds.push(...creationIntents.changeLength(doc, c, longer).select); } }, { select: () => selectIds, viewId });
      return placed.length;
    },
    /** Toggles the dot of the created chord; the new chord replaces the old one and stays the creation. */
    creationDot(viewId = 'main') {
      const chord = creationIntents.creationChords(doc, creation?.ids ?? [])[0]; if (!chord) return;
      this.edit('Point', () => creationIntents.toggleDot(doc, chord), { select: (r) => r.select, creation: true, viewId });
    },
    /** Replaces the created chord by a rest of the same duration (the rest is selected: the normal bar takes over). */
    creationRest(viewId = 'main') {
      const chord = creationIntents.creationChords(doc, creation?.ids ?? [])[0]; if (!chord) return;
      this.edit('Silence', () => creationIntents.replaceWithRest(doc, chord), { select: (r) => r.select, viewId });
    },
    // ---------- intentions jouer / muet (tranche 4) ----------
    /** Bascule jouer/muet sur des éléments (défaut : la sélection de la vue 'main'). Retourne le nombre d'éléments changés. */
    togglePlay(ids, viewId = 'main') {
      const list = ids ?? views.get(viewId)?.selection() ?? [];
      return this.edit('Jouer / couper', () => togglePlay(doc, list)) ?? 0;
    },
    /** Valeur que donnerait la bascule (true = jouer, false = couper, null = rien de jouable) : pour l'icône de la barre contextuelle. */
    nextPlayValue: (ids) => nextPlayValue(doc, ids),
    /** « Tout jouer / tout couper / revenir au global » (value true | false | null) sous une portée, une piste, une voix ou une mesure. */
    setPlayScope(rootId, value) {
      const root = doc.find(rootId);
      if (!root) throw new Error(`setPlayScope : élément « ${rootId} » introuvable`);
      return this.edit(value === false ? 'Couper' : value === true ? 'Jouer' : 'Jouer : réglage global', () => setPlayScope(doc, root, value));
    },
    /** Portée ou piste qui contient un élément (pour les entrées de menu contextuel). */
    ownerOf: (id, type) => ownerOf(doc, id, type),
    /** Value the staff / track switch would give (true = play everything, false = mute everything, null = nothing playable). */
    nextScopeValue: (rootId) => { const root = doc.find(rootId); return root ? nextScopeValue(root) : null; },
    /** Switch of a staff / track: mute everything if something is played, otherwise play everything (one undoable transaction). */
    toggleScope(rootId) { const v = this.nextScopeValue(rootId); if (v === null) return 0; return this.setPlayScope(rootId, v); },
    // ---------- dictionnaire de qualités d'accord (tranche 5) : propriété du document, une transaction par intention ----------
    /** Dictionnaire en vigueur pour ce document (sa propriété, sinon les qualités intégrées). */
    chordQualities: () => qualityIntents.getChordQualities(doc),
    /** Nombre de symboles qui utilisent une qualité (identifiant ou alias) / Map(identifiant → nombre). */
    chordQualityUse: (id) => qualityIntents.chordQualityUse(doc, id),
    chordQualityUsage: () => qualityIntents.chordQualityUsageMap(doc),
    addChordQuality(spec) { return this.edit('Qualités d\'accord : ajouter', () => qualityIntents.addQuality(doc, spec)); },
    setChordQualityIntervals(id, intervals) { return this.edit('Qualités d\'accord : intervalles', () => qualityIntents.setIntervals(doc, id, intervals)); },
    setChordQualityAliases(id, aliases) { return this.edit('Qualités d\'accord : alias', () => qualityIntents.setAliases(doc, id, aliases)); },
    /** Écritures affichables d'une qualité / écriture choisie (`null` = dérivée de l'identifiant) / intervalles notés en énharmonie. */
    setChordQualityVariants(id, variants) { return this.edit('Qualités d\'accord : écritures affichables', () => qualityIntents.setVariants(doc, id, variants)); },
    setChordQualityGaps(id, gaps) { return this.edit('Qualités d\'accord : espacement de l\'écriture', () => qualityIntents.setGaps(doc, id, gaps)); },
    setChordQualityShown(id, shown) { return this.edit('Qualités d\'accord : écriture affichée', () => qualityIntents.setShown(doc, id, shown)); },
    setChordQualityEnharmonic(id, list) { return this.edit('Qualités d\'accord : énharmonie', () => qualityIntents.setEnharmonic(doc, id, list)); },
    /** Orthographe des notes de l'accord affichées pour une portée d'accords ('enharmonic' défaut | 'key' selon l'armure). */
    // ---------- carte de percussion d'une portée (éditeur de percmap) ----------
    /** Carte en vigueur de la portée (la sienne, sinon la batterie de Scorsaire). */
    percMap: (staffId) => percEdit.staffPercMap(doc.find(staffId)),
    /** Nombre de notes par son : Map(id → nombre). */
    percMapUsage: (staffId) => percEdit.soundUsageMap(doc.find(staffId)),
    percPresets: () => percmapPresets(),
    updatePercSound(staffId, id, changes) { return this.edit('Percussion : régler un son', () => percEdit.updateSound(doc, doc.find(staffId), id, changes)); },
    renamePercSound(staffId, id, newId) { return this.edit('Percussion : renommer un son', () => percEdit.renameSound(doc, doc.find(staffId), id, newId)); },
    addPercSound(staffId, sound) { return this.edit('Percussion : ajouter un son', () => percEdit.addSound(doc, doc.find(staffId), sound)); },
    removePercSound(staffId, id, options) { return this.edit('Percussion : supprimer un son', () => percEdit.removeSound(doc, doc.find(staffId), id, options)); },
    /** Entry-button groups of the staff's map: [{ id, sounds }] as stored, or null when the default groups are in force. */
    /** Effective entry-button groups of the staff's map (stored or default, only sounds the map has). */
    percSwitchGroups: (staffId) => drumSwitchesFor(percEdit.staffPercMap(doc.find(staffId))),
    percSwitchDefs: (staffId) => percEdit.staffPercMap(doc.find(staffId)).switches ?? null,
    setPercSwitches(staffId, switches) { return this.edit('Percussion : boutons de saisie', () => percEdit.setSwitches(doc, doc.find(staffId), switches)); },
    movePercSound(staffId, id, toIndex) { return this.edit('Percussion : déplacer un son', () => percEdit.moveSound(doc, doc.find(staffId), id, toIndex)); },
    /** Remplace la carte par un préréglage (les notes dont le son manque migrent par n° MIDI si `matchByMidi`). */
    applyPercPreset(staffId, presetId, options = { matchByMidi: true }) {
      const preset = percmapPreset(presetId);
      if (!preset) throw new percEdit.PercMapError('unknown', `Préréglage inconnu : ${presetId}`);
      // the notes follow the new sounds AND the voices the new map gives them (kick in voice 2…): one undo step
      return this.edit('Percussion : choisir un jeu de sons', () => {
        const staff = doc.find(staffId);
        const map = percEdit.replacePercMap(doc, staff, preset.create(), options);
        if (options.matchByMidi) percVoices.reassignPercussionVoices(doc, staff);
        return map;
      });
    },
    /** Notes of a percussion staff that are not in the voice their sound belongs to (the map's `voice`). */
    percMisplaced: (staffId) => percVoices.misplacedPercussionNotes(doc.find(staffId)),
    /** Moves every note of the staff to the voice of its sound; returns { moved, skipped }. */
    reassignPercVoices(staffId) {
      let result;
      this.edit('Percussion : réassigner les voix selon la carte', () => { result = percVoices.reassignPercussionVoices(doc, doc.find(staffId)); });
      return result;
    },
    importPercMapFile(staffId, text, options = { matchByMidi: true }) { return this.edit('Percussion : importer une carte', () => percEdit.replacePercMap(doc, doc.find(staffId), importPercMap(text), options)); },
    exportPercMapFile: (staffId) => exportPercMap(percEdit.staffPercMap(doc.find(staffId))),
    // ---------- tracks and staves panel: a read outline and one undoable intent per gesture ----------
    /** Movements → tracks → staves with the actions each row allows (read only). */
    // ---------- parts (screen 2: print layouts) ----------
    /** The parts of the work, in order (elements: read only). */
    parts: () => [...doc.work.parts],
    /** Staves of the work in reading order: [{ id, trackId, trackName, indexInTrack, movementIndex }]. */
    partStaffChoices: () => partStaffChoices(doc.work),
    // ---------- sheets (screen 3): cells, layout and the options offered to the reader ----------
    /** The sheets with what the screen needs: [{ id, name, layout, columns, cells: [{ id, movementId, tracks }], reader }]. */
    sheets: () => doc.work.sheets.map((sh, i) => ({ id: sh.id, name: sh.props[PID.NAME] ?? '', index: i, ...sheetEdit.sheetShape(sh), cells: sheetEdit.sheetCells(doc.work, sh), reader: sheetEdit.readerOptions(sh), dividers: sheetDividers(sh) })),
    addSheet(options = {}) { return this.edit('Sheets: add a sheet', () => sheetEdit.addSheet(doc, options)); },
    removeSheet(id) { return this.edit('Sheets: remove a sheet', () => sheetEdit.removeSheet(doc, id)); },
    renameSheet(id, name) { return this.edit('Sheets: rename', () => sheetEdit.renameSheet(doc, id, name)); },
    moveSheet(id, index) { return this.edit('Sheets: move', () => sheetEdit.moveSheetTo(doc, id, index)); },
    setSheetColumns(id, columns) { return this.edit('Sheets: columns', () => sheetEdit.setSheetColumns(doc, id, columns)); },
    setSheetLayout(id, layout, columns) { return this.edit('Sheets: layout', () => sheetEdit.setSheetLayout(doc, id, layout, columns)); },
    addSheetCell(id, movementId, options) { return this.edit('Sheets: add a cell', () => sheetEdit.addCell(doc, id, movementId, options)); },
    removeSheetCell(id, cellId) { return this.edit('Sheets: remove a cell', () => sheetEdit.removeCell(doc, id, cellId)); },
    moveSheetCell(id, cellId, index) { return this.edit('Sheets: move a cell', () => sheetEdit.moveCellTo(doc, id, cellId, index)); },
    setSheetCellMovement(id, cellId, movementId) { return this.edit('Sheets: cell movement', () => sheetEdit.setCellMovement(doc, id, cellId, movementId)); },
    /** The tracks a cell shows (ids), or null for all of them. */
    setSheetCellTracks(id, cellId, trackIds) { return this.edit('Sheets: cell tracks', () => sheetEdit.setCellTracks(doc, id, cellId, trackIds)); },
    setReaderOption(id, key, value) { return this.edit('Sheets: reader option', () => sheetEdit.setReaderOption(doc, id, key, value)); },
    /** One option of a cell (`null` = the sheet's value), of one of its tracks, a lock of the cell, or its proposed loop: one undoable transaction each. */
    setCellOption(id, cellId, key, value) { return this.edit('Sheets: cell option', () => sheetEdit.setCellOption(doc, id, cellId, key, value)); },
    setCellUnlock(id, cellId, lock, on) { return this.edit('Sheets: cell lock', () => sheetEdit.setCellUnlock(doc, id, cellId, lock, on)); },
    setCellLoop(id, cellId, loop) { return this.edit('Sheets: cell loop', () => sheetEdit.setCellLoop(doc, id, cellId, loop)); },
    setTrackOption(id, cellId, trackId, key, value) { return this.edit('Sheets: track option', () => sheetEdit.setTrackOption(doc, id, cellId, trackId, key, value)); },
    // ---------- listening to one cell of a sheet (the page attaches the playback: it owns the audio engine) ----------
    attachCellPlayback(cp) { cellPlaybackOff?.(); cellPlayback = cp; cellPlaybackOff = cp.subscribe((k) => { for (const fn of [...cellPlayListeners]) fn(k); }); },
    /** Plays / stops a cell with the settings of the sheet; false when there is nothing to hear. */
    playCell(sheetId, cellId) { return cellPlayback ? cellPlayback.play(`${sheetId}|${cellId}`) : false; },
    stopCell() { cellPlayback?.stop(); },
    /** What a cursor needs while a cell plays: { id: 'sheet|cell', sequence, seconds } or null. */
    cellCursor: () => cellPlayback?.cursor?.() ?? null,
    cellPlaying: (sheetId, cellId) => (cellPlayback ? cellPlayback.isPlaying(`${sheetId}|${cellId}`) : false),
    onCellPlay(fn) { cellPlayListeners.add(fn); return () => cellPlayListeners.delete(fn); },
    setReaderUnlock(id, lock, on) { return this.edit('Sheets: reader lock', () => sheetEdit.setReaderUnlock(doc, id, lock, on)); },
    /** Several parts in ONE undoable step (the "new part" dialog): [{ name, staffIds, copyFrom }] → the new parts. */
    addParts(list) { return this.edit('Parts: add parts', () => list.map((o) => addPart(doc, o))); },
    addPart(options = {}) { return this.edit('Parts: add a part', () => addPart(doc, options)); },
    /** Moves a part to position `index` among the parts (tab order of screen 2). */
    movePart(id, index) { return this.edit('Parts: move', () => movePart(doc, id, index)); },
    // ---------- free texts of a printed part (screen 2): text above / below a staff of the part with an optional line, drawn in this part only ----------
    /** The staves a part shows, as the choices of a text: [{ id, name, ids (the measure ids of its movement) }]. */
    partTextTargets(partId) {
      const part = doc.work.parts.find((p) => p.id === partId);
      if (!part) return [];
      const shown = new Set(partStaffIds(doc.work, part));
      const out = [];
      for (const mv of doc.work.movements) for (const t of mv.tracks) t.staves.forEach((st, i) => {
        if (!shown.has(st.id)) return;
        const base = getProperty(t, PID.NAME) || '—';
        out.push({ id: st.id, name: t.staves.length > 1 ? `${base} · ${i + 1}` : base, type: getProperty(st, PID.STAFF_TYPE), ids: mv.masterbars.map((b) => b.id) });
      });
      return out;
    },
    /** The texts of a part with what the list shows: [{ ...entry, staffName, measure (number, 1-based) }]. */
    partStaffTexts(partId) {
      const part = doc.work.parts.find((p) => p.id === partId);
      const targets = this.partTextTargets(partId);
      return (part ? partStaffTextsOf(part) : []).map((e) => { const t = targets.find((x) => x.id === e.staffId); return { ...e, staffName: t?.name ?? '—', measure: t ? t.ids.indexOf(e.measureId) + 1 : 0 }; });
    },
    addPartStaffText(partId, spec) { let made; this.edit('Partie : texte de portée', () => { made = addPartStaffText(doc, partId, spec); }); return made; },
    updatePartStaffText(partId, id, patch) { return this.edit('Partie : modifier un texte de portée', () => updatePartStaffText(doc, partId, id, patch)); },
    removePartStaffText(partId, id) { return this.edit('Partie : supprimer un texte de portée', () => removePartStaffText(doc, partId, id)); },
    /** Duplicates a part right after the original (all its settings); returns the copy. */
    duplicatePart(id, options = {}) { return this.edit('Parts: duplicate a part', () => duplicatePart(doc, id, options)); },
    removePart(id) { return this.edit('Parts: remove a part', () => removePart(doc, id)); },
    // ---------- canvases (screen 2, « Tablette » tab): the destinations of the work ----------
    canvases: () => [...canvasesOf(doc.work)],
    /** Adds a canvas (a destination: a tablet shape) with a first layout; returns it. */
    addCanvas(spec) { return this.edit('Canvases: add a canvas', () => addCanvas(doc, spec)); },
    setCanvas(id, patch) { return this.edit('Canvases: change a canvas', () => setCanvas(doc, id, patch)); },
    removeCanvas(id) { return this.edit('Canvases: remove a canvas', () => removeCanvas(doc, id)); },
    setPartReader(id, patch) { return this.edit('Parts: reader settings', () => setPartReader(doc, id, patch)); },
    setPartRole(id, role) { return this.edit('Parts: role', () => setPartRole(doc, id, role)); },
    renamePart(id, name) { return this.edit('Parts: rename', () => renamePart(doc, id, name)); },
    /** Moves a track to position `index` among the tracks of its movement, for this part only (`trackId` null = back to the order of the document). */
    setPartTrackOrder(partId, trackId, index) { return this.edit('Parts: track order', () => setPartTrackOrder(doc, partId, trackId, index)); },
    /** Display transposition of a track in this part: a preset id of `TRANSPOSITION_PRESETS`, or null = the track's own. */
    setPartTransposition(partId, trackId, presetId) {
      const interval = presetId == null ? null : tracksIntents.intervalOfChoice(presetId);
      if (presetId != null && !interval) throw new Error(`Unknown transposition: ${presetId}`);
      return this.edit('Parts: transposition', () => setPartTransposition(doc, partId, trackId, interval));
    },
    /** Blocks of a part by extracts (model/extracts.js): add { movementId, source, staffIds }, change a block with a patch, remove, move to an index. Undoable. */
    addExtractBlock(partId, spec, at) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: add an extract', () => addExtractBlock(doc, part, spec, at)); },
    /** How the blocks are set on the page (columns, gap, flow, blocks per page, numbers) and « one block per movement ». Undoable. */
    setExtractLayout(partId, patch) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: layout of the extracts', () => setExtractLayout(doc, part, patch)); },
    addBlockPerMovement(partId) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: one block per movement', () => addBlockPerMovement(doc, part)); },
    updateExtractBlock(partId, blockId, patch) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: change an extract', () => updateExtractBlock(doc, part, blockId, patch)); },
    /** A zone above the first system of a block (`above`) or under its last (`below`), attached to the block. Undoable. */
    addBlockZone(partId, blockId, position, spec) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: add a zone to an extract', () => addBlockZone(doc, part, blockId, position, spec)); },
    /** A container of a staff attached to a block (text or notation above its first measures). Undoable. */
    addBlockContainer(partId, blockId, spec) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: add a container to an extract', () => addBlockContainer(doc, part, blockId, spec)); },
    /** The language of the interface (names of the cards of structure, tracks…). */
    get lang() { return lang; },
    /** « Lyrics by strophes » (model/lyricstrophes.js): what the window and the section of the part need. */
    lyricsPageInfo(partId) {
      const part = doc.work.parts.find((q) => q.id === partId);
      if (!part) return null;
      const settings = lyricsSettings(part);
      const auto = autoStrophes(doc.work, { lang });
      const free = freeTextStrophes(doc.work, { lang });
      return { settings, fixed: !!settings.strophes, strophes: settings.strophes ?? auto, auto, free, hasSource: !!lyricsSource(doc.work), hasFreeText: free.length > 0 };
    },
    /** A colour for the card of a strophe (the colour of a section of the work with the same label, else its category's). */
    strophesCardColor: (card) => inlineCardColor(card, doc.work),
    /** Turns a part into a lyrics part (automatic), or back into a normal part. Undoable. */
    enableLyricsPage(partId) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: lyrics by strophes', () => setLyricsPage(doc, part, { ...LYRICS_PAGE_DEFAULTS, strophes: null })); },
    disableLyricsPage(partId) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: back to a normal part', () => setLyricsPage(doc, part, null)); },
    /** Columns (1 | 2), size (pt) and cards (bool) of a lyrics part; the strophes are kept. */
    setLyricsPageSettings(partId, patch) {
      const part = doc.work.parts.find((q) => q.id === partId);
      return this.edit('Parts: lyrics page settings', () => setLyricsPage(doc, part, { ...lyricsSettings(part), ...patch, strophes: lyricsSettings(part).strophes }));
    },
    /** The strophes edited in the window: automatic again when they are the proposal, else fixed. `null` = back to automatic. */
    setLyricsPageStrophes(partId, strophes) {
      const part = doc.work.parts.find((q) => q.id === partId);
      return this.edit('Parts: lyrics strophes', () => setLyricsPage(doc, part, lyricsPageValue(lyricsSettings(part), strophes, doc.work, { lang })));
    },
    removeExtractBlock(partId, blockId) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: remove an extract', () => removeExtractBlock(doc, part, blockId)); },
    moveExtractBlock(partId, blockId, to) { const part = doc.work.parts.find((q) => q.id === partId); return this.edit('Parts: move an extract', () => moveExtractBlock(doc, part, blockId, to)); },
    /** Display transposition of the WHOLE part, in semitones (positive = written higher), on top of each track's own. */
    setPartChordView(partId, mode) { return this.edit('Parts: how the chords are read', () => setPartChordView(doc, partId, mode)); },
    setPartTransposeAll(partId, semitones) { return this.edit('Parts: transposition of the whole part', () => setPartTransposeAll(doc, partId, semitones)); },
    /** Display of a track on screen 1 (`PID.TRACK_DISPLAY`): patch { showBars?, sizePct? }, a key set to null returns to the default. */
    /** The automatic PLAYER of a track (model/player.js): partial change { pattern?, card?, instrument?, active? }. Undoable. */
    setTrackPlayer(trackId, patch) { return this.edit('Tracks: player', () => tracksIntents.setTrackPlayerIntent(doc, trackId, patch)); },
    /**
     * The user's rules for the variations of a player (approach chords, breaks…): WHERE they may come in this work. On the measures of the selection: mode 'never' | 'always' | 'normal' (= no rule).
     * Rules are kept on the player (anchored by measure id), never in the card.
     */
    setPlayerRulesOnSelection(trackId, mode) {
      const range = this.bakeMeasures();
      if (!range) throw new tracksIntents.TrackEditError('noSelection', 'Select measures first');
      const track = doc.find(trackId);
      const mv = track && doc.movementOf(track);
      if (!mv) throw new Error(`Unknown track: ${trackId}`);
      let rules = playerOf(track)?.rules ?? [];
      for (let i = range.from; i <= range.to; i++) {
        const where = { measureId: mv.masterbars[i].id };
        rules = mode === 'normal' ? withoutRule(rules, where) : withRule(rules, { kind: 'all', where, mode });
      }
      return this.setTrackPlayer(trackId, { rules });
    },
    /** The rule of a section (by its name) for the variations of a player: 'normal' | 'half' (chance × ½) | 'double' (× 2) | 'never'. */
    setPlayerSectionRule(trackId, section, choice) {
      const track = doc.find(trackId);
      const where = { section };
      const base = withoutRule(playerOf(track)?.rules ?? [], where);
      const rule = choice === 'never' ? { kind: 'all', where, mode: 'never' } : choice === 'half' ? { kind: 'all', where, mode: 'factor', factor: 0.5 } : choice === 'double' ? { kind: 'all', where, mode: 'factor', factor: 2 } : null;
      return this.setTrackPlayer(trackId, { rules: rule ? withRule(base, rule) : base });
    },
    /** Adds an accompaniment (role 'piano' | 'guitar' | 'bass'): a track with its own player, staves hidden → the new track id. */
    /** A lyrics track of events (empty), right after the chord track; returns its id. */
    addLyricsTrack({ movement = 0, name } = {}) { return this.edit('Tracks: add lyrics', () => addLyricsTrackIntent(doc, { movement, name: name ?? (lang === 'fr' ? 'Paroles' : 'Lyrics'), at: doc.work.movements[movement].tracks.findIndex((t) => t.staves.some((s) => getProperty(s, PID.STAFF_TYPE) === 'chord')) + 1 }))?.id ?? null; },
    addAccompaniment(role, options) { return this.edit('Tracks: add an accompaniment', () => tracksIntents.addAccompanimentIntent(doc, role, { lang, ...options })); },
    /** What the player of a track is set to, as plain values (the pattern editor reads it): { pattern, card, instrument, auto }. */
    trackPlayer(trackId) { return this.tracksOutline().flatMap((m) => m.tracks).find((t) => t.id === trackId)?.player ?? null; },
    /** Composite staves (model/composite.js): one staff of a track that shows, measure by measure, one of the track's staves. All undoable; `addComposite` returns the new one. */
    addComposite(trackId, opts) { return this.edit('Tracks: composite staff', () => addComposite(doc, trackId, opts)); },
    /** Screen 1 preview (a session setting, never saved): draws a track as one of its composite staves instead of its real staves. `compositeId` null = the real staves. */
    setCompositePreview(trackId, compositeId) {
      if (compositeId) compositePreview.set(trackId, compositeId); else compositePreview.delete(trackId);
      // read at every layout, so an edit of the ranges shows at once
      const current = () => {
        const map = new Map();
        for (const [tid, cid] of compositePreview) { const track = doc.work.movements.flatMap((m) => m.tracks).find((t) => t.id === tid); const c = track && compositesOf(track).find((x) => x.id === cid); if (c) map.set(tid, c); }
        return map.size ? map : null;
      };
      for (const v of views.values()) v.setParams?.({ composites: compositePreview.size ? current : null });
      for (const l of [...previewListeners]) l();
      return true;
    },
    /** `fn()` runs after the preview changed (the main page re-draws the score). Returns the unsubscribe function. */
    onCompositePreview(fn) { previewListeners.add(fn); return () => previewListeners.delete(fn); },
    compositePreviewOf(trackId) { return compositePreview.get(trackId) ?? null; },
    removeComposite(trackId, compositeId) { return this.edit('Tracks: remove composite staff', () => removeComposite(doc, trackId, compositeId)); },
    renameComposite(trackId, compositeId, name) { return this.edit('Tracks: rename composite staff', () => renameComposite(doc, trackId, compositeId, name)); },
    setCompositeBase(trackId, compositeId, staffId) { return this.edit('Tracks: composite base staff', () => setCompositeBase(doc, trackId, compositeId, staffId)); },
    setCompositeEqual(trackId, compositeId, on) { return this.edit('Tracks: composite same height', () => setCompositeEqual(doc, trackId, compositeId, on)); },
    setCompositeJunction(trackId, compositeId, style) { return this.edit('Tracks: composite junction bar', () => setCompositeJunction(doc, trackId, compositeId, style)); },
    setCompositeJunctionClef(trackId, compositeId, on) { return this.edit('Tracks: composite junction clef', () => setCompositeJunctionClef(doc, trackId, compositeId, on)); },
    setCompositeRange(trackId, compositeId, from, to, staffId) { return this.edit('Tracks: composite range', () => setCompositeRange(doc, trackId, compositeId, from, to, staffId)); },
    // ---------- slashes: one slash per beat instead of the notes of chosen measures (display only, layout/slashfill.js) ----------
    /** The staves and measure ids a track's slash ranges are made of (for the display menu). */
    slashInfo(trackId) {
      for (const mv of doc.work.movements) {
        const t = mv.tracks.find((x) => x.id === trackId);
        if (t) return { ids: mv.masterbars.map((b) => b.id), staves: t.staves.map((st, i) => ({ id: st.id, type: getProperty(st, PID.STAFF_TYPE), index: i })) };
      }
      return null;
    },
    /** 'all' | 'some' | 'none' | null: how much of a selected range of measures the staves show as slashes (screen 1 / the track layer). */
    slashesState(range) {
      const first = range?.staffIds?.[0] && doc.find(range.staffIds[0]);
      const mv = first && doc.movementOf(first);
      const span = mv && rangeMeasureSpan(mv, range);
      if (!span) return null;
      const ids = mv.masterbars.map((b) => b.id);
      const states = range.staffIds.map((sid) => { const track = doc.parentOf(sid); return slashEdit.slashCoverage(ids, trackLayer(track)?.slashes ?? [], sid, span.first, span.last); });
      return states.every((x) => x === 'all') ? 'all' : states.every((x) => x === 'none') ? 'none' : 'some';
    },
    /** Shows the selected measures of the selected staves as slashes, or stops (when they all are shown already). One undo step. */
    toggleSlashes(range, viewId = 'main') {
      const first = range?.staffIds?.[0] && doc.find(range.staffIds[0]);
      const mv = first && doc.movementOf(first);
      const span = mv && rangeMeasureSpan(mv, range);
      if (!span) return null;
      const on = this.slashesState(range) !== 'all';
      this.edit(on ? 'Barres obliques' : 'Barres obliques : retirer', () => slashEdit.setSlashMeasures(doc, range.staffIds, mv.masterbars.map((b) => b.id), span.first, span.last, on), { viewId });
      return on;
    },
    setTrackDisplay(trackId, patch) { return this.edit('Tracks: display', () => setTrackDisplay(doc, trackId, patch)); },
    /** Display of a track in ONE part (screen 2), over the track's own. */
    setPartTrackDisplay(partId, trackId, patch) { return this.edit('Parts: track display', () => setPartTrackDisplay(doc, partId, trackId, patch)); },
    /** What the part layer says for a track: { own (the part's layer or null), base (the track's layer), shown (resolved) }. */
    partTrackDisplay(partId, trackId) {
      const part = doc.work.parts.find((p) => p.id === partId);
      const track = doc.work.movements.flatMap((m) => m.tracks).find((t) => t.id === trackId);
      const own = part?.props[PID.PART_TRACK_DISPLAY]?.[trackId] ?? null; const base = trackLayer(track);
      return { own, base, shown: resolveDisplay(own, base) };
    },
    /** `staffIds` null = every staff. */
    setPartStaves(id, staffIds) { return this.edit('Parts: staves shown', () => setPartStaves(doc, id, staffIds)); },
    /** `patch`: { [SID.PAGE_…]: value | null (default) }. */
    setPartDividers(id, patch) { return this.edit('Parts: system dividers', () => setPartDividers(doc, id, patch)); },
    setSheetDividers(id, patch) { return this.edit('Sheets: system dividers', () => setSheetDividers(doc, id, patch)); },
    setPartPage(id, patch) { return this.edit('Parts: page', () => setPartPage(doc, id, patch)); },
    /** Break after a measure (`kind` 'system' | 'page'): toggles it. Returns true when it was added. */
    toggleBreak(partId, measureId, kind) { return this.edit('Parts: break', () => toggleBreak(doc, partId, measureId, kind)); },
    lockSystem(partId, fromId, toId) { return this.edit('Parts: fixed system', () => lockSystem(doc, partId, fromId, toId)); },
    unlockSystem(partId, lockId) { return this.edit('Parts: release the fixed system', () => unlockSystem(doc, partId, lockId)); },
    /** `edge` 'from' | 'to', `delta` +1 (grow) | −1 (shrink). */
    extendLock(partId, lockId, edge, delta) { return this.edit('Parts: fixed system', () => extendLock(doc, partId, lockId, edge, delta)); },
    /** System break after every `n` measures (0 = remove them): returns the number of breaks written. */
    setBreaksEvery(partId, n) { return this.edit('Parts: measures per system', () => setBreaksEvery(doc, partId, n)); },
    /** `kind` 'header' | 'footer'; `patch` = { enabled, twoSided, first, odd, even } (model/partedit.js). */
    setHeaderFooter(partId, kind, patch) { return this.edit('Parts: ' + kind, () => setHeaderFooter(doc, partId, kind, patch)); },
    setTitleBlock(partId, patch) { return this.edit('Parts: title block', () => setTitleBlock(doc, partId, patch)); },
    /** Number of a measure in a part: 'show' | 'hide' | null (automatic). */
    setMeasureNumberMode(partId, measureId, mode) { return this.edit('Parts: measure number', () => setMeasureNumberMode(doc, partId, measureId, mode)); },
    /** Counting of a measure (the document): { exclude: true | false | null, offset: integer }. */
    setMeasureCounting(measureId, patch) { return this.edit('Measure numbering', () => setMeasureCounting(doc, measureId, patch)); },
    /** Colour / offset / visibility of elements in one part: `ids` = identifiers the elements are selected by, `patch` = { color, offset, hidden } (model/partedit.js). */
    setElementOverride(partId, ids, patch, options) { return this.edit('Parts: element', () => setElementOverride(doc, partId, ids, patch, options)); },
    /** Text style of a printed text (see model/partedit.js `setTextStyle`). */
    setTextStyle(partId, key, patch) { return this.edit('Parts: text style', () => setTextStyle(doc, partId, key, patch)); },
    /** Text of a printed text (metadata, free line, header / footer area). */
    setTextContent(partId, key, text) { return this.edit('Parts: text', () => setTextContent(doc, partId, key, text)); },
    textSource(partId, key) { return textSourceOf(doc, doc.find(partId), key); },
    setWorkMeta(patch) { return this.edit('Work: metadata', () => setWorkMeta(doc, patch)); },
    // ---- zones between the systems of a part, room between staves (model/partzones.js) ----
    zones(partId) { const p = doc.find(partId); return p ? zonesOf(p) : []; },
    addZoneCell(partId, measureId, spec) { return this.edit('Zone: add a cell', () => addZoneCell(doc, partId, measureId, spec)); },
    removeZoneCell(partId, cellId) { return this.edit('Zone: remove a cell', () => removeZoneCell(doc, partId, cellId)); },
    setZoneHeight(partId, measureId, height, row = 0) { return this.edit('Zone: height', () => setZoneHeight(doc, partId, measureId, height, row)); },
    setZoneColumns(partId, measureId, count, row = 0) { return this.edit('Zone: columns', () => setZoneColumns(doc, partId, measureId, count, row)); },
    setZoneCellText(partId, cellId, text) { return this.edit('Zone: text', () => setZoneCellText(doc, partId, cellId, text)); },
    /** The tablature staves a diagram list of a part zone can read: [{ id, name }] (the movement of the cell). */
    listTabStaves(partId, cellId) {
      const part = doc.find(partId);
      const c = part?.containers?.find((x) => x.id === cellId);
      const mv = c && doc.work.movements.find((m) => m.masterbars.some((b) => b.id === getProperty(c, PID.MEASURE_ID)));
      if (!mv) return [];
      return mv.tracks.flatMap((t) => t.staves.filter((st) => getProperty(st, PID.STAFF_TYPE) === 'tab').map((st) => ({ id: st.id, name: getProperty(t, PID.NAME) || st.id })));
    },
    setZoneDiagramList(partId, cellId, options) { return this.edit('Zone: diagrammes d\'accords', () => setZoneDiagramList(doc, partId, cellId, options)); },
    replaceZoneCell(partId, cellId, spec) { return this.edit('Zone: change the cell', () => replaceZoneCell(doc, partId, cellId, spec)); },
    detachZoneCell(partId, cellId) { return this.edit('Zone: detach a synchronised copy', () => detachZoneCell(doc, partId, cellId)); },
    setPartStaffGap(partId, value) { return this.edit('Parts: room between staves', () => setPartStaffGap(doc, partId, value)); },
    /** Room above a staff in the system that holds `measureId` only (null = back to the value for every system). */
    setStaffGapAt(partId, staffId, measureId, value) { return this.edit('Parts: room above a staff in a system', () => setStaffGapAt(doc, partId, staffId, measureId, value)); },
    setStaffGap(partId, staffId, value) { return this.edit('Parts: room above a staff', () => setStaffGap(doc, partId, staffId, value)); },
    /** Copies one group of settings of a part to all the other parts (model/partedit.js COPY_GROUPS). */
    copyPartSettings(id, group) { return this.edit('Parts: copy a setting to every part', () => copyPartSettings(doc, id, group)); },
    applyPageToAllParts(id, which) { return this.edit('Parts: apply the margins to every part', () => applyPageToAllParts(doc, id, which)); },
    tracksOutline: () => tracksIntents.tracksOutline(doc),
    /** spec: { movement?, staves: [{ type, clef? }], name?, at? } → new track id. */
    addTrack(spec) { return this.edit('Tracks: add a track', () => tracksIntents.addTrackIntent(doc, spec)); },
    /** Adds a track from a catalogue instrument id: { movement?, at? } → new track id. */
    addInstrumentTrack(instrumentId, options) { return this.edit('Tracks: add an instrument', () => tracksIntents.addInstrumentTrackIntent(doc, instrumentId, { lang, ...options })); },
    addLinkedStaff(trackId, type = 'tab') { return this.edit('Tracks: add a linked staff', () => tracksIntents.addLinkedStaffIntent(doc, trackId, type)); },
    addStaff(trackId, spec) { return this.edit('Tracks: add a staff', () => tracksIntents.addStaffIntent(doc, trackId, spec)); },
    removeTrack(trackId) { return this.edit('Tracks: remove a track', () => tracksIntents.removeTrackIntent(doc, trackId)); },
    removeStaff(staffId) { return this.edit('Tracks: remove a staff', () => tracksIntents.removeStaffIntent(doc, staffId)); },
    moveTrack(trackId, dir) { return this.edit('Tracks: move a track', () => tracksIntents.moveTrackIntent(doc, trackId, dir)); },
    moveStaff(staffId, dir) { return this.edit('Tracks: move a staff', () => tracksIntents.moveStaffIntent(doc, staffId, dir)); },
    /** Drag and drop: `index` = final position (one undoable transaction, however far the track travels). */
    moveTrackTo(trackId, index) { return this.edit('Tracks: move a track', () => tracksIntents.moveTrackToIntent(doc, trackId, index)); },
    /** Movements (cards of a sheet): one undoable transaction each. `spec` of addMovement: { from (id), measures, title, at }. */
    addMovement(spec) { return this.edit('Movements: add a movement', () => tracksIntents.addMovementIntent(doc, spec)); },
    duplicateMovement(id) { return this.edit('Movements: duplicate a movement', () => tracksIntents.duplicateMovementIntent(doc, id)); },
    removeMovement(id) { return this.edit('Movements: remove a movement', () => tracksIntents.removeMovementIntent(doc, id)); },
    moveMovementTo(id, index) { return this.edit('Movements: move a movement', () => tracksIntents.moveMovementToIntent(doc, id, index)); },
    setCardText(id, patch) { return this.edit('Movements: card text', () => tracksIntents.setCardTextIntent(doc, id, patch)); },
    setCardNumber(id, text) { return this.edit('Movements: card number', () => tracksIntents.setCardNumberIntent(doc, id, text)); },
    setCardNumberFormat(format) { return this.edit('Movements: card number format', () => tracksIntents.setCardNumberFormatIntent(doc, format)); },
    moveStaffTo(staffId, index) { return this.edit('Tracks: move a staff', () => tracksIntents.moveStaffToIntent(doc, staffId, index)); },
    /** Read-only plan of converting a staff to another type (what is lost, what must be confirmed). */
    planStaffType: (staffId, to) => tracksIntents.planStaffTypeIntent(doc, staffId, to),
    /** Converts a staff (one undoable transaction); `options` = { outOfRange: 'nearest'|'remove', unmapped: 'remove' }. */
    changeStaffType(staffId, to, options) { return this.edit('Tracks: change the staff type', () => tracksIntents.changeStaffTypeIntent(doc, staffId, to, options)); },
    /** Linked staves: plan (`{ same, mismatches }`), link a tablature to a notation staff (one undoable step), unlink. */
    planLink: (tabId, primaryId) => tracksIntents.planLinkIntent(doc, tabId, primaryId),
    linkStaff(tabId, primaryId, options) { return this.edit('Tracks: link a tablature to a notation staff', () => tracksIntents.linkStaffIntent(doc, tabId, primaryId, options)); },
    unlinkStaff(staffId) { return this.edit('Tracks: unlink a staff', () => tracksIntents.unlinkStaffIntent(doc, staffId)); },
    // ---------- groups (brackets of tracks) ----------
    /** trackIds: contiguous tracks; options { style: 'normal'|'square'|'line'|'brace', label?, barlines? } → new group id. */
    groupTracks(trackIds, options) { return this.edit('Tracks: group tracks', () => tracksIntents.groupTracksIntent(doc, trackIds, options)); },
    ungroup(groupId) { return this.edit('Tracks: ungroup', () => tracksIntents.ungroupIntent(doc, groupId)); },
    setGroupStyle(groupId, style) { return this.edit('Tracks: bracket style', () => tracksIntents.setGroupStyleIntent(doc, groupId, style)); },
    setGroupLabel(groupId, label) { return this.edit('Tracks: group label', () => tracksIntents.setGroupLabelIntent(doc, groupId, label)); },
    setGroupBarlines(groupId, on) { return this.edit('Tracks: bar lines through the group', () => tracksIntents.setGroupBarlinesIntent(doc, groupId, on)); },
    /** 'custom' = by hand; otherwise a score order id (see `scoreOrders`). */
    setGroupOrder(movement, orderId) { return this.edit('Tracks: automatic grouping', () => tracksIntents.setGroupOrderIntent(doc, movement, orderId)); },
    setGroupLabels(movement, on) { return this.edit('Tracks: group labels', () => tracksIntents.setGroupLabelsIntent(doc, movement, on)); },
    scoreOrders: () => tracksIntents.SCORE_ORDERS,
    setTrackAbbreviation(trackId, text) { return this.edit('Tracks: abbreviation', () => tracksIntents.setTrackAbbreviationIntent(doc, trackId, text)); },
    setTrackTransposition(trackId, presetId) { return this.edit('Tracks: display transposition', () => tracksIntents.setTrackTranspositionIntent(doc, trackId, presetId)); },
    setTrackIcon(trackId, icon) { return this.edit('Tracks: icon', () => tracksIntents.setTrackIconIntent(doc, trackId, icon)); },
    /** patch: { show?, first?, next?, hideIfOne? } with modes 'long' | 'short' | 'icon' | 'none'. */
    /** Shows / hides the system objects of a movement on the score (nothing is deleted). */
    setSystemVisible(movement, visible) { return this.edit(visible ? 'System objects: show' : 'System objects: hide', () => tracksIntents.setSystemVisibleIntent(doc, movement, visible)); },
    setNameStyle(movement, patch) { return this.edit('Tracks: track names on the score', () => tracksIntents.setNameStyleIntent(doc, movement, patch)); },
    // ---------- templates (tracks of a kind of score) ----------
    /** { categories: [{ id, title, templates }], user: [...] } — titles in the application language. */
    templateCatalog: () => templateIntents.templateCatalog(preferences, lang),
    /** Loads a template: { mode: 'add' | 'replace', movement? } → { added, skipped } ; one undoable transaction. */
    applyTemplate(id, options = {}) { return this.edit('Tracks: load a template', () => templateIntents.applyTemplateIntent(doc, preferences, id, { lang, ...options })); },
    /** Saves the tracks of a movement as the user's template `name` (preferences, not the document). */
    saveTemplate: (name, options) => templateIntents.saveTemplateIntent(doc, preferences, name, options),
    deleteTemplate: (id) => templateIntents.deleteTemplateIntent(preferences, id),
    exportTemplates: () => templateIntents.exportTemplatesText(preferences),
    importTemplates: (text) => templateIntents.importTemplatesText(preferences, text),
    /** Show / hide a track or a staff on the score (one undoable transaction); the last visible staff cannot be hidden. */
    /** null when the track / staff can be hidden, else 'crossStaff' | 'lastVisible' (the button is greyed). */
    hideRefusal: (id) => tracksIntents.hideRefusal(doc, id),
    // ---------- the band of blocks of the shown movement (free texts above the first system) ----------
    /** The blocks of the movement shown by the view. */
    blocks(viewId = 'main') { return blockEdit.blocksOf(views.get(viewId)?.movement?.() ?? doc.work.movements[0]); },
    blockAspect(viewId = 'main') { return blockEdit.aspectOf(views.get(viewId)?.movement?.() ?? doc.work.movements[0]); },
    /** Adds a text block to the shown movement → its id (it is edited at once). */
    addTextBlock(spec = {}, viewId = 'main') {
      const mv = views.get(viewId)?.movement?.() ?? doc.work.movements[0];
      return this.edit('Blocks: add a text', () => blockEdit.addTextBlock(doc, mv, { text: 'Texte', ...spec }), { viewId });
    },
    /** Takes a picture file ({ name, bytes }), puts it in the registry and adds a block for it, sized to fit the band → its id. Throws for a file that is not a picture. */
    addPictureBlock(file, viewId = 'main') {
      const { id, ratio } = addImageFile(file);
      const H = 100 * this.blockAspect(viewId);
      const w = Math.min(40, 0.8 * H * ratio, 100);
      return this.addImageBlock({ image: id, ratio, w, alt: file.name.replace(/\.[a-z0-9]+$/i, '') }, viewId);
    },
    /** Adds an image block (the picture is in the registry of images already: model/assets.js) to the shown movement → its id. */
    addImageBlock(spec, viewId = 'main') {
      const mv = views.get(viewId)?.movement?.() ?? doc.work.movements[0];
      return this.edit('Blocks: add a picture', () => blockEdit.addImageBlock(doc, mv, spec), { viewId });
    },
    updateBlock(id, patch, viewId = 'main') { const mv = views.get(viewId)?.movement?.() ?? doc.work.movements[0]; return this.edit('Blocks: edit', () => blockEdit.updateBlock(doc, mv, id, patch), { viewId }); },
    removeBlock(id, viewId = 'main') { const mv = views.get(viewId)?.movement?.() ?? doc.work.movements[0]; return this.edit('Blocks: remove', () => blockEdit.removeBlock(doc, mv, id), { viewId }); },
    setBlockFit(fit, viewId = 'main') { const mv = views.get(viewId)?.movement?.() ?? doc.work.movements[0]; return this.edit('Blocks: height of the box on the video', () => blockEdit.setBlockFit(doc, mv, fit), { viewId }); },
    setBlockAspect(aspect, viewId = 'main') { const mv = views.get(viewId)?.movement?.() ?? doc.work.movements[0]; return this.edit('Blocks: height of the band', () => blockEdit.setBlockAspect(doc, mv, aspect), { viewId }); },
    /** The blocks are being edited (boxes, handles on the page): an interface state, never in the document. */
    blocksEditing() { return blocksEditing; },
    setBlocksEditing(on) { const next = !!on; if (next === blocksEditing) return; blocksEditing = next; for (const fn of [...blocksListeners]) fn(next); },
    onBlocksEditing(fn) { blocksListeners.add(fn); return () => blocksListeners.delete(fn); },
    /** The tempo element `id` as the bar edits it: { id, bpm, beatUnit: { base, dots }, text } (null when `id` is not a tempo you can type a number for). */
    tempoInfo(id) {
      const el = doc.find(id);
      if (!el || el.type !== 'tempo' || (getProperty(el, PID.TEMPO_KIND) ?? 'normal') !== 'normal') return null;
      return { id, bpm: getProperty(el, PID.TEMPO_BPM) ?? 120, beatUnit: getProperty(el, PID.BEAT_UNIT) ?? { base: 'quarter', dots: 0 }, text: getProperty(el, PID.TEXT) ?? null };
    },
    /** Edits a tempo (one undoable transaction); the playback reads it at the next play. */
    setTempoValue(id, patch, viewId = 'main') {
      return this.edit('Tempo: edit', () => { const el = doc.find(id); if (!el) return; sys.updateTempo(doc, el, patch); }, { viewId });
    },
    /** Visual solo of a track (screen 1 / 4): only it is shown; again = back. With the option « visual solo = audio solo » the audio solo follows. */
    toggleVisualSolo(trackId) {
      const r = this.edit('Tracks: visual solo', () => tracksIntents.visualSoloIntent(doc, trackId, visualSoloMemory));
      visualSoloMemory = r.memory;
      if (visualSoloAudioOn) { soloIds.clear(); if (r.active) soloIds.add(trackId); notifyMixer(); }
      return r.active;
    },
    visualSoloActive(trackId) { return tracksIntents.visualSoloActive(doc, trackId); },
    setVisualSoloAudio(on) { visualSoloAudioOn = !!on; },
    visualSoloAudio() { return visualSoloAudioOn; },
    /** The M / S button of a track row: normal → muted → solo → normal. */
    cycleTrackAudio(trackId) {
      const t = this.mixerState().tracks.find((x) => x.id === trackId);
      if (!t) return;
      if (t.solo) this.setTrackSolo(trackId, false);
      else if (t.mute) { this.setTrackMute(trackId, false); this.setTrackSolo(trackId, true); }
      else this.setTrackMute(trackId, true);
    },
    setVisible(id, visible) { return this.edit(visible ? 'Tracks: show' : 'Tracks: hide', () => tracksIntents.setVisibleIntent(doc, id, visible)); },
    // ---------- variants of a track (alternatives of the same part; see model/variants.js) ----------
    setVariantOf(trackId, baseId, label) { return this.edit('Tracks: variant', () => tracksIntents.setVariantOfIntent(doc, trackId, baseId, label)); },
    setVariantLabel(trackId, label) { return this.edit('Tracks: variant label', () => tracksIntents.setVariantLabelIntent(doc, trackId, label)); },
    clearVariant(trackId) { return this.edit('Tracks: no variant', () => tracksIntents.clearVariantIntent(doc, trackId)); },
    selectVariant(trackId) { return this.edit('Tracks: select variant', () => tracksIntents.selectVariantIntent(doc, trackId)); },
    nextVariant(trackId) { return this.edit('Tracks: next variant', () => tracksIntents.nextVariantIntent(doc, trackId)); },
    // ---------- named views (screen only): saved choices of the shown tracks / staves; the solo switch is session state ----------
    /** Views of a movement: { views: [{ id, name, tracks, active }], active: id | null (null = a custom state or everything shown) }. */
    namedViews(movement = 0) {
      const mv = doc.work.movements[movement];
      if (!mv) return { views: [], active: null, all: true };
      const active = activeViewId(mv);
      const allShown = mv.tracks.every((t) => getProperty(t, PID.VISIBLE) !== false && t.staves.every((s) => getProperty(s, PID.VISIBLE) !== false));
      return { views: viewsOf(mv).map((v) => ({ id: v.id, name: v.name, tracks: v.tracks, active: v.id === active })), active, all: allShown };
    },
    /** Shows a view (null = everything). */
    applyNamedView(viewId, movement = 0) { const mv = doc.work.movements[movement]; return this.edit('Views: show', () => applyView(doc, mv, viewId)); },
    /** Saves what is shown now as a view → its id. */
    saveNamedView(name, movement = 0) { const mv = doc.work.movements[movement]; return this.edit('Views: save', () => saveCurrentView(doc, mv, name)); },
    createNamedView(name, tracks, movement = 0) { const mv = doc.work.movements[movement]; return this.edit('Views: create', () => createView(doc, mv, { name, tracks })); },
    renameNamedView(viewId, name, movement = 0) { const mv = doc.work.movements[movement]; return this.edit('Views: rename', () => renameView(doc, mv, viewId, name)); },
    /** Moves a view to position `index` among the views (tab order). */
    moveNamedView(viewId, index, movement = 0) { const mv = doc.work.movements[movement]; return this.edit('Views: move', () => moveView(doc, mv, viewId, index)); },
    removeNamedView(viewId, movement = 0) { const mv = doc.work.movements[movement]; return this.edit('Views: remove', () => removeView(doc, mv, viewId)); },
    /** Replaces the track / staff choice of a view and, if it is the active one, shows the new choice. */
    setNamedViewTracks(viewId, tracks, movement = 0) {
      const mv = doc.work.movements[movement];
      return this.edit('Views: change', () => { const was = activeViewId(mv) === viewId; setViewTracks(doc, mv, viewId, tracks); if (was) applyView(doc, mv, viewId); });
    },
    /** Solo of the active view (playback only, session state, never saved): only the shown tracks sound. */
    viewSolo: () => viewSolo,
    setViewSolo(on) { viewSolo = Boolean(on); for (const fn of [...viewSoloListeners]) fn(viewSolo); notifyMixer(); },
    onViewSoloChange(fn) { viewSoloListeners.add(fn); return () => viewSoloListeners.delete(fn); },
    /** Mixer for the player: { [trackId]: { solo: true } } for the tracks of the active view when solo is on, else {}. `full` lists every track. */
    viewSoloMixer({ full = false } = {}) {
      const out = {};
      const on = viewSolo && doc.work.movements.some((mv) => activeViewId(mv));
      for (const mv of doc.work.movements) {
        for (const t of mv.tracks) {
          const solo = on && getProperty(t, PID.VISIBLE) !== false && t.staves.some((s) => getProperty(s, PID.VISIBLE) !== false);
          if (solo) out[t.id] = { solo: true };
          else if (full) out[t.id] = { volume: 1, mute: false, solo: false };
        }
      }
      return out;
    },
    // ---------- mixer: volume and mute are saved in the file, the solo is session state ----------
    /** Ids of the tracks in solo: the manual ones and those of the active named view (when its solo is on). */
    soloTrackIds() { return new Set([...soloIds, ...Object.keys(this.viewSoloMixer())]); },
    /** The full mixer for the engines: { [trackId]: { volume, mute, solo } } (master volume folded in, live previews applied). */
    playbackMixer() {
      const mixer = playbackMixer(doc.work, this.soloTrackIds());
      const master = mixerPreview.has('*') ? mixerPreview.get('*') : mixerIntents.clampVolume(getProperty(doc.work, PID.MASTER_VOLUME));
      for (const [id, m] of Object.entries(mixer)) {
        const trackVol = mixerPreview.has(id) ? mixerPreview.get(id) : mixerIntents.clampVolume(getProperty(doc.work.movements[0].tracks.find((t) => t.id === id), PID.MIXER_VOLUME));
        m.volume = effectiveVolume(trackVol, master); m.fader = trackVol; m.masterFactor = masterFactor(master);
        if (panPreview.has(id)) m.pan = panPreview.get(id);
        if (takes.has(id)) m.override = true; // a fader being recorded: the lane steps aside so that the move is heard
      }
      return mixer;
    },
    // ---------- mixer automation: the quick gesture on a range (volume level or mute over the range, or give the fader back) ----------
    rangeAutomationState: (range) => automationIntents.rangeAutomationState(doc, range),
    /** `param` 'volume' (value 0..1) or 'mute' (value 1 = muted), `value` null = give the fader back; `fade` 'none' | 'beat' | 'measure'. */
    setRangeAutomation(range, options, viewId = 'main') { return this.edit('Automation: range', () => automationIntents.applyRangeAutomation(doc, range, options), { viewId }) ?? false; },
    // ----- the strip of the automation under a track (a screen option of this session) and its points -----
    automationTracks: () => new Set(automationShown),
    automationShown: (trackId) => automationShown.has(trackId),
    setAutomationShown(trackId, on) { this.setAutomationLanes(trackId, on ? (automationLanes.get(trackId) ?? ['volume']) : []); },
    /** The strip of the master volume (above the top staff): shown or not. */
    masterAutomationShown: () => masterAutomationShown,
    setMasterAutomationShown(on) {
      masterAutomationShown = Boolean(on);
      for (const v of views.values()) v.setMasterAutomation?.(masterAutomationShown);
      for (const fn of [...automationViewListeners]) fn();
    },
    /** Where a lane falls back to when it lets go: the fader of a track, the master fader for the master volume lane (`ownerId` = a track or a movement). */
    automationFader(ownerId, param) {
      const owner = doc.find(ownerId);
      if (!owner) return 0;
      return owner.type === 'movement' ? getProperty(doc.work, PID.MASTER_VOLUME) : faderOf(owner, param);
    },
    /** The lanes whose strips are shown under a track, volume first: [] (none), ['volume'], ['pan'] or ['volume', 'pan']. */
    automationLanes: (trackId) => (automationShown.has(trackId) ? [...(automationLanes.get(trackId) ?? ['volume'])] : []),
    /** Shows exactly these lanes under the track (always in the order volume, pan); an empty list hides the strips. */
    setAutomationLanes(trackId, params) {
      const wanted = AUTOMATION_LANE_ORDER.filter((p) => (params ?? []).includes(p));
      if (wanted.length) { automationShown.add(trackId); automationLanes.set(trackId, wanted); } else { automationShown.delete(trackId); automationLanes.delete(trackId); }
      for (const v of views.values()) { v.setAutomationTracks?.(automationShown); v.setAutomationParams?.(automationLanes); }
      for (const fn of [...automationViewListeners]) fn();
    },
    /** Height factor of the automation strips (0.5 … 8; 1 = the first size): a device preference, set by the handle under a strip or by the size button. */
    automationScale: () => automationScale,
    setAutomationScale(k) {
      if (!(k >= 0.5 && k <= 8) || Math.abs(k - automationScale) < 0.005) return;
      automationScale = k; preferences?.set('automationScale', { scale: k });
      for (const v of views.values()) v.setAutomationScale?.(k);
      for (const fn of [...automationViewListeners]) fn();
    },
    onAutomationViewChange(fn) { automationViewListeners.add(fn); return () => automationViewListeners.delete(fn); },
    addAutomationPoint(trackId, point) { return this.edit('Automation: add a point', () => automationIntents.addPointIntent(doc, trackId, point)); },
    moveAutomationPoint(trackId, point) { return this.edit('Automation: move a point', () => automationIntents.movePointIntent(doc, trackId, point)); },
    moveAutomationPoints(trackId, spec) { return this.edit('Automation: move points', () => automationIntents.movePointsIntent(doc, trackId, spec)); },
    shiftAutomationPoints(trackId, spec) { return this.edit('Automation: raise points', () => automationIntents.shiftPointsIntent(doc, trackId, spec)); },
    setAutomationCurve(trackId, spec) { return this.edit('Automation: curve', () => automationIntents.setCurveIntent(doc, trackId, spec)); },
    setAutomationRamp(trackId, spec) { return this.edit('Automation: ramp', () => automationIntents.setRampIntent(doc, trackId, spec)); },
    removeAutomationPoints(trackId, spec) { return this.edit('Automation: remove points', () => automationIntents.removePointsIntent(doc, trackId, spec)); },
    shiftAutomation(trackId, spec) { return this.edit('Automation: raise a stretch', () => automationIntents.shiftIntent(doc, trackId, spec)); },
    /** Range (semitones each way) of the pitch-bend lane of a track. One undoable transaction. */
    setPitchBendRange(trackId, range) { return this.edit('Pitch bend : plage', () => setPitchBendRange(doc, doc.find(trackId), range)); },
    setAutomationSpan(trackId, spec) { return this.edit('Automation: stretch', () => automationIntents.setSpanIntent(doc, trackId, spec)); },
    // ----- recording a fader move (touch mode): arm a track (●), play, touch its fader -----
    /** The player gives the play position and the sequence; a take ends when the song stops. */
    attachPlayer(player) {
      playerRef = player;
      player.subscribe((s) => { if (!s.playing && takes.size) for (const id of [...takes.keys()]) this.recordEnd(id); });
    },
    isRecordArmed: (trackId) => recordArmed.has(trackId),
    setRecordArmed(trackId, on) { if (on) recordArmed.add(trackId); else { recordArmed.delete(trackId); if (takes.has(trackId)) this.recordEnd(trackId); } notifyMixer(); },
    /** True while a take is going on for this track (the fader then overrides the lane). */
    isRecording: (trackId) => takes.has(trackId),
    /**
     * A fader value while the song plays and the track is armed: it goes into the take (and is heard: the lane steps aside while the fader is touched).
     * @returns true when the value was taken by a recording (the caller must not write the fader itself)
     */
    recordSample(trackId, value) {
      if (!recordArmed.has(trackId) || !playerRef) return false;
      const s = playerRef.state();
      const seq = playerRef.sequence();
      if (!s.playing || !seq) return false;
      const where = locate(seq, s.position);
      const mv = doc.work.movements[where?.movement ?? -1];
      if (!where || where.movement !== 0 || !mv) return false;
      const abs = fAdd(measureLayout(mv).starts[where.measure], where.position);
      let take = takes.get(trackId);
      if (!take) { take = createTake(); takes.set(trackId, take); mixerPreview.set(trackId, mixerIntents.clampVolume(value)); notifyMixer(); }
      if (!take.add(abs, mixerIntents.clampVolume(value))) { // the song went back (a loop, a jump): this take ends here, another starts
        this.recordEnd(trackId, { keepTouching: true });
        const next = createTake(); takes.set(trackId, next); next.add(abs, mixerIntents.clampVolume(value));
      }
      mixerPreview.set(trackId, mixerIntents.clampVolume(value));
      notifyMixer();
      return true;
    },
    /** The fader was released (or the song stopped): the take is written as ONE undoable transaction. */
    recordEnd(trackId, { keepTouching = false } = {}) {
      const take = takes.get(trackId);
      takes.delete(trackId);
      mixerPreview.delete(trackId);
      const points = take?.result();
      let written = false;
      if (points) {
        const track = mixerIntents.mixerTracks(doc).find((t) => t.id === trackId);
        const mv = doc.work.movements[0];
        if (track && mv) {
          const { from, to } = takeSpan(points);
          this.edit('Automation: record', () => pasteLane(doc, mv, track, { param: 'volume', from, to, points: points.map((p) => ({ abs: p.abs, value: p.value, ramp: 'linear' })) }));
          written = true;
        }
      }
      if (!keepTouching) notifyMixer();
      return written;
    },
    clearTrackAutomation(trackId, param) { return this.edit('Automation: clear', () => automationIntents.clearTrackAutomation(doc, trackId, param)); },
    mixerState() { return mixerIntents.mixerSnapshot(doc, { solo: soloIds, viewSolo: new Set(Object.keys(this.viewSoloMixer())), preview: mixerPreview, panPreview, automationShown, automationLanes, masterAutomationShown, armed: recordArmed, recording: new Set(takes.keys()) }); },
    onMixerChange(fn) { mixerListeners.add(fn); return () => mixerListeners.delete(fn); },
    /** Live volume while a slider moves (no transaction); id '*' = master. Cleared by the committing write. */
    /** Live pan while the control is dragged (nothing saved); `setTrackPan` writes ONE undoable transaction. */
    previewPan(id, pan) { panPreview.set(id, mixerIntents.clampPan(pan)); notifyMixer(); },
    /** The master pan (the balance of the whole mix): live while dragged, ONE undoable write when released. */
    previewMasterPan(pan) { panPreview.set('*', mixerIntents.clampPan(pan)); notifyMixer(); },
    setMasterPan(pan) { panPreview.delete('*'); const r = this.edit('Mixer: master pan', () => mixerIntents.setMasterPanIntent(doc, pan)); notifyMixer(); return r; },
    masterPan: () => (panPreview.has('*') ? panPreview.get('*') : mixerIntents.clampPan(getProperty(doc.work, PID.MASTER_PAN))),
    setTrackPan(trackId, pan) { panPreview.delete(trackId); const r = this.edit('Mixer: track pan', () => mixerIntents.setTrackPanIntent(doc, trackId, pan)); notifyMixer(); return r; },
    previewVolume(id, volume) { mixerPreview.set(id, mixerIntents.clampVolume(volume)); notifyMixer(); },
    setTrackVolume(trackId, volume) { mixerPreview.delete(trackId); const r = this.edit('Mixer: track volume', () => mixerIntents.setTrackVolumeIntent(doc, trackId, volume)); notifyMixer(); return r; },
    setMasterVolume(volume) { mixerPreview.delete('*'); const r = this.edit('Mixer: master volume', () => mixerIntents.setMasterVolumeIntent(doc, volume)); notifyMixer(); return r; },
    /** The SoundFont instrument of a track (null = the one of its catalogue instrument); live when the SoundFont engine plays. */
    setTrackPreset(trackId, preset) { return this.edit('Mixer: instrument', () => mixerIntents.setTrackPresetIntent(doc, trackId, preset)); },
    /** The MIDI dynamics of a track ({ x0, y0, x1, y1, bend }, the transfer curve of the mixer window) or null when untouched. */
    trackDynamics(trackId) { return getProperty(mixerIntents.mixerTracks(doc).find((t) => t.id === trackId) ?? {}, PID.MIDI_DYNAMICS) ?? null; },
    setTrackDynamics(trackId, dynamics) { const r = this.edit('Mixer: MIDI dynamics', () => mixerIntents.setTrackDynamicsIntent(doc, trackId, dynamics)); notifyMixer(); return r; },
    /** The compressor of a track ({ on, threshold, ratio, knee, attack, release, makeup, mix, detector }) or null when it is the default one. */
    trackCompressor(trackId) { return getProperty(mixerIntents.mixerTracks(doc).find((t) => t.id === trackId) ?? {}, PID.COMPRESSOR) ?? null; },
    setTrackCompressor(trackId, compressor) { const r = this.edit('Mixer: compressor', () => mixerIntents.setTrackCompressorIntent(doc, trackId, compressor)); notifyMixer(); return r; },
    /** The equalizer of a track ({ on, hp, lowF, lowG, m1F, m1G, m1Q, m2F, m2G, m2Q, highF, highG }) or null when it is the default one. */
    trackEq(trackId) { return getProperty(mixerIntents.mixerTracks(doc).find((t) => t.id === trackId) ?? {}, PID.EQUALIZER) ?? null; },
    setTrackEq(trackId, eq) { const r = this.edit('Mixer: equalizer', () => mixerIntents.setTrackEqIntent(doc, trackId, eq)); notifyMixer(); return r; },
    trackLeslie(trackId) { return getProperty(mixerIntents.mixerTracks(doc).find((t) => t.id === trackId) ?? {}, PID.LESLIE) ?? null; },
    setTrackLeslie(trackId, leslie) { const r = this.edit('Mixer: rotary speaker', () => mixerIntents.setTrackLeslieIntent(doc, trackId, leslie)); notifyMixer(); return r; },
    setTrackMute(trackId, mute) { return this.edit('Mixer: mute', () => mixerIntents.setTrackMuteIntent(doc, trackId, mute)); },
    unmuteAll() { return this.edit('Mixer: unmute all', () => mixerIntents.unmuteAllIntent(doc)); },
    setTrackSolo(trackId, on) { if (on) soloIds.add(trackId); else soloIds.delete(trackId); notifyMixer(); },
    clearSolo() { soloIds.clear(); notifyMixer(); },
    renameTrack(trackId, name) { return this.edit('Tracks: rename a track', () => tracksIntents.renameTrackIntent(doc, trackId, name)); },
    // ---------- staff properties panel: a read snapshot and one undoable intent per setting ----------
    /** Snapshot of the properties shown by the panel for a staff (null when the id is not a staff). */
    staffProperties: (staffId) => staffProps.staffProperties(doc, staffId),
    /** True when the staff has at least one section in the panel. */
    hasStaffProperties: (staffId) => { const st = staffProps.staffOf(doc, staffId); return !!st && staffProps.sectionsOf(doc, st).length > 0; },
    /** The staff an element (or a decor id, or a list entry) belongs to, or null. */
    staffIdOf(id) {
      const d = parseDecorId(id);
      if (d) return d.staffId;
      return ownerOf(doc, id, 'staff')?.id ?? null;
    },
    /** patch: { preset?, placement?, right?, left? } — see staffprops-intents.js. */
    setStickingSystem(staffId, patch) { return this.edit('Staff properties: sticking system', () => staffProps.setStickingSystem(doc, staffId, patch)); },
    /** patch: { buttonPlacement?, buttonOffset? } */
    /** Capo at the selected chord (guitar-intents.js): state for the drawer, set / change, remove. One undoable transaction each. */
    capoState: (ids, range = null, viewId = 'main') => guitarIntents.capoState(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range }),
    tuningChangeState: (ids, range = null, viewId = 'main') => guitarIntents.tuningChangeState(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range }),
    setTuningChange(presetId, ids, range = null, viewId = 'main') { return this.edit('Guitar: tuning change', () => guitarIntents.setTuningChange(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range }, presetId)); },
    setCapo(patch, ids, range = null, viewId = 'main') { return this.edit('Guitar: capo', () => guitarIntents.setCapo(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range }, patch)); },
    removeCapo(ids, range = null, viewId = 'main') { return this.edit('Guitar: remove the capo', () => guitarIntents.removeCapoHere(doc, { ids: ids ?? views.get(viewId)?.selection() ?? [], range })); },
    /** Tuning of a tablature staff (names, highest string first); the notes keep their pitch and get their strings again. Returns { changed, failed }. */
    setStaffTuning(staffId, names) { let out = null; this.edit('Staff properties: tuning', () => { out = guitarIntents.writeStaffTuning(doc, staffId, names); }); return out; },
    // ---- strum cards (model/strumcards.js): built in + the user's (device preference) + the project's (saved in the file) ----
    /** Every card offered by a menu: [{ ...card, source: 'builtin' | 'user' | 'project' }]. */
    strumCards() { return allStrumCards({ project: doc.get(doc.work, PID.STRUM_CARDS) ?? [], user: preferences.get('strumCards')?.items ?? [] }); },
    /** Adds or replaces a card at a level ('user' = this device, 'project' = this file); returns the saved card. */
    saveStrumCard(level, input) {
      const card = createStrumCard({ ...input, id: input.id || `sc${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}` });
      const errors = validateStrumCard(card);
      if (errors.length) throw new Error(errors[0]);
      const put = (list) => (list.some((c) => c.id === card.id) ? list.map((c) => (c.id === card.id ? card : c)) : [...list, card]);
      if (level === 'user') preferences.set('strumCards', { items: put(preferences.get('strumCards')?.items ?? []) });
      else this.edit('Strum cards: save', () => setProjectStrumCards(doc, doc.work, put(doc.get(doc.work, PID.STRUM_CARDS) ?? [])));
      return card;
    },
    removeStrumCard(level, id) {
      if (level === 'user') preferences.set('strumCards', { items: (preferences.get('strumCards')?.items ?? []).filter((c) => c.id !== id) });
      else this.edit('Strum cards: remove', () => setProjectStrumCards(doc, doc.work, (doc.get(doc.work, PID.STRUM_CARDS) ?? []).filter((c) => c.id !== id)));
    },
    /** Copies a card to the other level (a built-in card becomes an editable copy with a new id). Returns the copy. */
    copyStrumCard(id, to, { fresh = false, name } = {}) {
      const { card, source } = resolveStrumCard(id, { project: doc.get(doc.work, PID.STRUM_CARDS) ?? [], user: preferences.get('strumCards')?.items ?? [] });
      return this.saveStrumCard(to, { ...card, id: fresh || source === 'builtin' ? '' : card.id, name: name ?? card.name });
    },
    /** Measures [from, to] (indices) of the main view's selection (a range, or the chosen measure), or null: the part of a rhythm staff written out as notes. */
    bakeMeasures() {
      const v = views.get('main');
      const range = v?.range?.() ?? null;
      if (range) { const from = v.measureIndexOf(range.from.measureId); const to = v.measureIndexOf(range.to.measureId); return from >= 0 && to >= from ? { from, to } : null; }
      const chosen = v?.chosenMeasure?.() ?? v?.activeCell?.()?.measureId ?? null; // the measure of the active chord cell counts as chosen
      const i = chosen ? v.measureIndexOf(chosen) : -1;
      return i >= 0 ? { from: i, to: i } : null;
    },
    /**
     * The measures the user is pointing at in the main view, for tools that work on measures (typical grids, cues, transposition): a range, a chosen measure, the measure of the active chord cell
     * (a chord slot) or of a selected note → { from, to } (indices in the movement `movement`), or null when nothing is selected (or the view shows another movement).
     */
    selectedMeasures({ movement = 0 } = {}) {
      const v = views.get('main');
      if (v && v.movementIndex?.() !== undefined && v.movementIndex() !== movement) return null;
      const range = this.bakeMeasures();
      if (range) return range;
      const mv = doc.work.movements[movement];
      if (!mv) return null;
      const ids = v?.selection?.() ?? [];
      // a selected note, chord, rest… (of any staff): the measure that holds it
      const indexOfMeasure = (id) => {
        let el = doc.find(id);
        for (let guard = 0; el && guard < 8; guard += 1) {
          const parent = doc.parentOf(el.id);
          if (el.type === 'measure' && parent?.measures) return parent.measures.indexOf(el);
          el = parent;
        }
        return -1;
      };
      for (const id of ids) { const at = indexOfMeasure(id); if (at >= 0 && at < mv.masterbars.length) return { from: at, to: at }; }
      // the orange caret of the writing mode (where the next note would go) is what the user sees as chosen
      const caret = entryState.cursor;
      if (caret && Number.isInteger(caret.measureIndex)) {
        const staff = doc.find(caret.staffId);
        if (staff && doc.movementOf(staff) === mv && caret.measureIndex >= 0 && caret.measureIndex < mv.masterbars.length) return { from: caret.measureIndex, to: caret.measureIndex };
      }
      const target = this.systemTarget(); // what else points at a measure (a staff text, a sign…)
      const at = target ? mv.masterbars.findIndex((b) => b.id === target.measureId) : -1;
      return at >= 0 ? { from: at, to: at } : null;
    },
    /** The automatic player of the track a staff belongs to ({ pattern, card, instrument, active }), or null. */
    playerOfStaff(staffId) {
      const staff = doc.find(staffId);
      const track = staff && doc.movementOf(staff)?.tracks.find((t) => t.staves.includes(staff));
      return track ? playerOf(track) : null;
    },
    /** Empty tracks a rhythm staff's result can be written into: [{ id, name }]. */
    bakeTargets(staffId) {
      const staff = doc.find(staffId);
      const mv = staff && doc.movementOf(staff);
      if (!mv) return [];
      const track = mv.tracks.find((t) => t.staves.includes(staff));
      // the notes of a player are for its instrument (a guitar player is written in a tablature); a chord staff without one is written as piano
      const kind = track && playerOf(track)
        ? ((inst) => (inst === 'piano' ? 'piano' : inst === 'drums' ? 'drums' : 'strings'))(playerInstrumentOf(track, { project: doc.get(doc.work, PID.STRUM_CARDS) ?? [], user: preferences.get('strumCards')?.items ?? [] }))
        : doc.get(staff, PID.STAFF_TYPE) === 'chord' || strumInstrumentOf(track, staff) === 'piano' ? 'piano' : 'strings';
      return emptyBakeTargets(mv, kind).map((t) => ({ id: t.id, name: doc.get(t, PID.NAME) || t.id }));
    },
    /** The empty tracks of yours an accompaniment track can be written into: [{ id, name }] (the right kind of track, no written notes, not an accompaniment track itself). */
    realizeTargets(trackId) {
      const track = doc.find(trackId);
      const staff = track?.staves.find((st) => doc.get(st, PID.STAFF_TYPE) !== 'rhythm') ?? track?.staves[0];
      if (!staff) return [];
      return this.bakeTargets(staff.id).filter((t) => { const other = doc.find(t.id); return other && other.id !== trackId && !isAccompanimentTrack(other); });
    },
    /** Writes what the rhythm staff plays, over the measures, as real notes (new track or an empty one). One transaction. */
    bakeRhythm(staffId, options) {
      const staff = doc.find(staffId);
      const mv = staff && doc.movementOf(staff);
      if (!mv) throw new BakeError('staff', 'Unknown staff');
      let result = null;
      this.edit('Write what the staff plays', () => { result = bakeRhythmStaff(doc, mv, staff, { lang, user: this.userPlayLists(), ...options }); });
      return result;
    },
    // ---- chord patterns (model/chordpatterns.js): built in + the user's (device preference) + the project's (saved in the file) ----
    /** Every pattern a menu offers, complete: [{ ...pattern, source: 'builtin' | 'user' | 'project' }]. */
    chordPatterns() { return allChordPatterns({ project: doc.get(doc.work, PID.CHORD_PATTERNS) ?? [], user: preferences.get('chordPatterns')?.items ?? [] }); },
    /** Adds or replaces a pattern at a level ('user' = this device, 'project' = this file); returns the saved pattern. */
    saveChordPattern(level, input) {
      const pattern = createChordPattern({ ...input, id: input.id || `cp${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}` });
      if (!pattern) throw new Error('A pattern needs at least one hit');
      const errors = validateChordPattern(pattern);
      if (errors.length) throw new Error(errors[0]);
      const put = (list) => (list.some((c) => c.id === pattern.id) ? list.map((c) => (c.id === pattern.id ? pattern : c)) : [...list, pattern]);
      if (level === 'user') preferences.set('chordPatterns', { items: put(preferences.get('chordPatterns')?.items ?? []) });
      else this.edit('Chord patterns: save', () => setProjectChordPatterns(doc, doc.work, put(doc.get(doc.work, PID.CHORD_PATTERNS) ?? [])));
      return pattern;
    },
    removeChordPattern(level, id) {
      if (level === 'user') preferences.set('chordPatterns', { items: (preferences.get('chordPatterns')?.items ?? []).filter((c) => c.id !== id) });
      else this.edit('Chord patterns: remove', () => setProjectChordPatterns(doc, doc.work, (doc.get(doc.work, PID.CHORD_PATTERNS) ?? []).filter((c) => c.id !== id)));
    },
    /** Copies a pattern to a level (a built-in pattern becomes an editable copy with a new id). Returns the copy. */
    copyChordPattern(id, to, { fresh = false, name } = {}) {
      const found = this.chordPatterns().find((p) => p.id === id);
      if (!found) throw new Error('Unknown pattern');
      return this.saveChordPattern(to, { ...found, id: fresh || found.source === 'builtin' ? '' : found.id, name: name ?? found.name });
    },
    /** The text of a file of chord patterns (model/patternfile.js): the one pattern `id`, or every pattern of the user and of the project (not the built-in ones). */
    exportChordPatterns({ id = null } = {}) {
      const all = this.chordPatterns();
      return serializeChordPatterns(id ? all.filter((p) => p.id === id) : all.filter((p) => p.source !== 'builtin'));
    },
    /** Adds the patterns of a file to this device (a pattern of the same id is replaced, one with the id of a built-in pattern gets another id). Returns { added, skipped, ids }. */
    importChordPatterns(text) {
      const { patterns, skipped } = parseChordPatterns(text);
      const builtin = new Set(this.chordPatterns().filter((p) => p.source === 'builtin').map((p) => p.id));
      const ids = patterns.map((p) => this.saveChordPattern('user', { ...p, id: builtin.has(p.id) ? `${p.id}-import` : p.id }).id);
      return { added: ids.length, skipped, ids };
    },
    /** User-level lists the planners need to resolve what a staff picked: { cards, patterns }. */
    userPlayLists() { return { cards: preferences.get('strumCards')?.items ?? [], patterns: preferences.get('chordPatterns')?.items ?? [], grooves: preferences.get('grooves')?.items ?? [] }; },
    /** The drum grooves a menu offers (model/grooves.js): built in, the user's (device) and the project's. */
    grooves() { return allGrooves({ project: doc.get(doc.work, PID.GROOVES) ?? [], user: preferences.get('grooves')?.items ?? [] }); },
    // ---- styles (model/styles.js): sets of players by role, with a swing; built in + the user's (device) + the project's
    styles() { return allStyles({ project: doc.get(doc.work, PID.STYLES) ?? [], user: preferences.get('styles')?.items ?? [] }); },
    saveStyle(level, input) {
      const draft = createStyle({ ...input, id: input.id || `st${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}` });
      if (!draft) throw new Error('A style needs at least one player');
      // what the style uses travels with it, as the lists have it NOW (a pattern edited since is up to date)
      const style = refreshStyleLibrary(draft, { patterns: this.chordPatterns(), grooves: this.grooves(), cards: this.strumCards() });
      const errors = validateStyle(style);
      if (errors.length) throw new Error(errors[0]);
      const put = (list) => (list.some((x) => x.id === style.id) ? list.map((x) => (x.id === style.id ? style : x)) : [...list, style]);
      if (level === 'user') preferences.set('styles', { items: put(preferences.get('styles')?.items ?? []) });
      else this.edit('Styles: save', () => setProjectStyles(doc, doc.work, put(doc.get(doc.work, PID.STYLES) ?? [])));
      return style;
    },
    removeStyle(level, id) {
      if (level === 'user') preferences.set('styles', { items: (preferences.get('styles')?.items ?? []).filter((x) => x.id !== id) });
      else this.edit('Styles: remove', () => setProjectStyles(doc, doc.work, (doc.get(doc.work, PID.STYLES) ?? []).filter((x) => x.id !== id)));
    },
    /** Copies a style to a level (a built-in style becomes an editable copy with a new id). Returns the copy. */
    copyStyle(id, to, { fresh = false, name } = {}) {
      const found = this.styles().find((x) => x.id === id);
      if (!found) throw new Error('Unknown style');
      return this.saveStyle(to, { ...found, id: fresh || found.source === 'builtin' ? '' : found.id, name: name ?? found.name });
    },
    /** Applies a style to a movement (one undo step): sets the players of the tracks of each role (making the tracks that are missing) and the swing → { players: [{ role, trackId, created }], swing }. */
    applyStyle(styleId, { movement = 0 } = {}) {
      const style = this.styles().find((x) => x.id === styleId);
      const mv = doc.work.movements[movement];
      if (!style || !mv) throw new Error('Unknown style or movement');
      let result = null;
      this.edit('Style: apply', () => { result = applyStyleToMovement(doc, mv, style, { lang, user: this.userPlayLists() }); });
      return result;
    },
    /**
     * Writes what the accompaniment tracks play as REAL tracks (notes you can edit): for each track of `trackIds` (default: every accompaniment track of the movement) a new track of its instrument is
     * written over `measures` (default: the whole movement) and its player is switched off. `removeAfter` removes the accompaniment tracks that were written. One undo step.
     * `targets` = { accompanimentTrackId: id of an EMPTY track of yours to write into } (see `realizeTargets`); without an entry a new track is made.
     * → { written: [{ trackId, writtenTrackId, hits }], failed: [{ trackId, code }] }
     */
    realizeAccompaniment({ movement = 0, trackIds = null, measures = null, removeAfter = false, targets = {} } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      const ids = trackIds ?? mv.tracks.filter(isAccompanimentTrack).map((t) => t.id);
      const range = measures ?? { from: 0, to: mv.masterbars.length - 1 };
      const written = []; const failed = [];
      this.edit('Accompaniment: write as tracks', () => {
        for (const id of ids) {
          const track = doc.find(id);
          const staff = track?.staves.find((st) => doc.get(st, PID.STAFF_TYPE) !== 'rhythm') ?? track?.staves[0];
          if (!staff) { failed.push({ trackId: id, code: 'track' }); continue; }
          try {
            const r = bakeRhythmStaff(doc, mv, staff, { measures: range, target: targets[id] ? { kind: 'track', trackId: targets[id] } : { kind: 'new' }, lang, deactivate: true, user: this.userPlayLists() });
            written.push({ trackId: id, writtenTrackId: r.trackId, hits: r.hits });
          } catch (e) {
            if (!(e instanceof BakeError)) throw e;
            failed.push({ trackId: id, code: e.code });
          }
        }
        if (removeAfter) for (const w of written) removeTrackModel(doc, mv, doc.find(w.trackId));
      });
      return { written, failed };
    },
    /** Saves the arrangement of a movement (the players of its tracks and its swing) as a style at a level. */
    saveArrangementAsStyle(level, name, { movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      const style = mv ? styleFromMovement(doc, mv, { name, user: this.userPlayLists() }) : null;
      if (!style) throw new Error('This movement has no automatic player to keep as a style');
      return this.saveStyle(level, style);
    },
    // ---- a pattern (and a style) made from what has been WRITTEN (model/patternfromnotes.js): the reverse of "write as real tracks"
    /**
     * What the window "Make a pattern" shows: `selection` { from, to } (the measures of the range chosen on the score) and `staves` = the written staves of that range
     * [{ id, name (the track's), role (of the track: drums, bass, guitar, keys, strings, brass, or null), instrument (catalogue id or null) }], or `selection: null` when no range is chosen.
     */
    patternFromNotesInfo({ movement = 0 } = {}) {
      const v = views.get('main');
      const mv = doc.work.movements[movement];
      const range = v?.range?.() ?? null;
      const sel = mv && range ? this.bakeMeasures() : null;
      if (!mv || !range || !sel) return { selection: null, staves: [] };
      const staves = (range.staffIds ?? []).map((id) => doc.find(id)).filter(Boolean).map((staff) => {
        const track = mv.tracks.find((t) => t.staves.includes(staff));
        return { id: staff.id, name: (track && getProperty(track, PID.NAME)) || staff.id, role: track ? roleOfTrack(track) : null, instrument: track ? getProperty(track, PID.INSTRUMENT_ID) ?? null : null };
      });
      return { selection: sel, staves };
    },
    /**
     * Makes a chord pattern from the written notes of the range chosen on the score and saves it (`level` 'user' = this device, 'project' = this file). `exact` keeps the octaves (off by default: the
     * solver of the player chooses the voicing). → { pattern (saved, with its id), hits, skipped, role, instrument } ; throws a `BakeError` when there is nothing to make it from.
     */
    makePatternFromNotes(level, { name = null, exact = false, movement = 0 } = {}) {
      const info = this.patternFromNotesInfo({ movement });
      if (!info.selection || !info.staves.length) throw new Error('Choose measures of a staff with written notes first');
      const mv = doc.work.movements[movement];
      const lead = info.staves.find((s) => s.role) ?? info.staves[0];
      // the card this role will be played with in a style: an exact voicing counts its octaves from that card's compass
      const cardId = { drums: 'drums', bass: 'bass', guitar: 'standard', strings: 'strings', brass: 'brass', keys: 'piano' }[lead.role] ?? 'piano';
      const card = resolveStrumCard(cardId, { project: doc.get(doc.work, PID.STRUM_CARDS) ?? [], user: preferences.get('strumCards')?.items ?? [], kind: 'piano' }).card;
      const made = patternFromNotes(doc, mv, { staffIds: info.staves.map((s) => s.id), from: info.selection.from, to: info.selection.to, exact, bass: lead.role === 'bass', name, options: strumOptionsFor(card) });
      const pattern = this.saveChordPattern(level, made.pattern);
      return { pattern, hits: made.hits, skipped: made.skipped, role: lead.role, instrument: lead.instrument };
    },
    /**
     * Puts a pattern in a style of yours as a new player (`styleId` of a style of the device or of the project, not a built-in one), or in a NEW style (`styleId` null, named `name`, at `level`).
     * `role` and `instrument` come from the staff the pattern was made from. → the saved style
     */
    addPatternToStyle(styleId, patternId, { role = 'keys', instrument = null, name = null, level = 'user' } = {}) {
      const r = STYLE_ROLES.includes(role) ? role : 'keys';
      const card = { drums: 'drums', bass: 'bass', guitar: 'standard', strings: 'strings', brass: 'brass', keys: null }[r];
      const add = (style) => {
        const grown = addStylePlayer(style, r);
        const index = grown.players.length - 1;
        return setStylePlayer(grown, index, { pattern: patternId, card, ...(instrument ? { instrument } : {}) });
      };
      if (styleId) {
        const found = this.styles().find((x) => x.id === styleId);
        if (!found || found.source === 'builtin') throw new Error('Choose a style of your own (a built-in style is changed by duplicating it)');
        return this.saveStyle(found.source, { ...add(found), id: found.id });
      }
      // a new style: this player alone, the swing of the movement left as it is
      return this.saveStyle(level, { id: '', name, swing: null, players: [{ role: r, pattern: patternId, card, ...(instrument ? { instrument } : {}) }] });
    },
    // ---- transposing the music (model/transposeedit.js): the notes, the chord symbols and the key signatures of a movement, or of the measures chosen on the score
    /**
     * Cuts the movement at index `movement` into several, one per range of measures { from, to } (indices); ONE undo step. `titles[k]` = the title of the k-th new movement; `keepOriginal` keeps
     * the movement that was cut; `sheets` puts a cell per new movement where the sheets showed the original. → { ids (of the new movements), warnings: [{ code: 'tie', range, count }] }
     */
    splitMovement(ranges, { movement = 0, titles = [], keepOriginal = false, sheets = true } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      let result = null;
      this.edit('Découper en mouvements', () => { result = splitMovement(doc, mv, ranges, { titles, keepOriginal, sheets }); });
      return { ids: result.movements.map((m) => m.id), warnings: result.warnings };
    },
    /** What the transposition window needs: `measures` (count) and `selection` { from, to } (the measures chosen on the score: a range, a measure, a chord slot, a note) or null = the whole movement. */
    /** What the time signature window needs: the measures chosen on screen 1 (or null), the signature of a measure, and where “from this measure” stops. */
    timeSigInfo({ movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      return { measures: mv.masterbars.length, selection: this.selectedMeasures({ movement }), current: (i) => getProperty(mv.masterbars[Math.min(Math.max(i, 0), mv.masterbars.length - 1)], PID.TIME_SIG), currentStyle: (i) => getProperty(mv.masterbars[Math.min(Math.max(i, 0), mv.masterbars.length - 1)], PID.TIME_SIG_STYLE) ?? 'normal', spanEnd: (i) => signatureSpanFrom(mv, i) };
    },
    /** What a change of time signature over measures from…to would cost (counts only; nothing is written). */
    timeSigPlan({ movement = 0, from, to, timeSig }) { return planTimeSignature(doc.work.movements[movement], { from, to, timeSig }); },
    /** Changes the time signature of measures from…to ([num, den]): the notes stay, rests fill, a shorter measure is cut. One undo step; returns what was cut. */
    changeTimeSignature({ movement = 0, from, to, timeSig, style }) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      return this.edit('Measures: time signature', () => changeTimeSignature(doc, mv, { from, to, timeSig, style }));
    },
    /** What the key signature window needs: the measures chosen on screen 1 (or null), the key of a measure (fifths), and where “from this measure” stops. */
    keySigInfo({ movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      return { measures: mv.masterbars.length, selection: this.selectedMeasures({ movement }), current: (i) => getProperty(mv.masterbars[Math.min(Math.max(i, 0), mv.masterbars.length - 1)], PID.KEY_SIG), spanEnd: (i) => keySignatureSpanFrom(mv, i) };
    },
    /** What a change of key over measures from…to would do (counts only; nothing is written). */
    keySigPlan({ movement = 0, from, to, keySig, chordSymbols = false }) { return planKeySignature(doc.work.movements[movement], { from, to, keySig, chordSymbols }); },
    /** Changes the key signature of measures from…to (fifths, −7…7): the sound stays, the notes are written for the new key. One undo step; returns the counts. */
    changeKeySignature({ movement = 0, from, to, keySig, chordSymbols = false }) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      return this.edit('Measures: key signature', () => changeKeySignature(doc, mv, { from, to, keySig, chordSymbols }));
    },
    transposeInfo({ movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      return { measures: mv.masterbars.length, selection: this.selectedMeasures({ movement }) };
    },
    /**
     * Transposes the music by `semitones` (positive = up, ±1 … ±24), over the whole movement or over `measures` { from, to } (indices); one undo step. The chords of the accompaniment follow the chord
     * symbols. Percussion is never transposed. → { notes, failed (ids of the notes that could not be moved), keys, chordSymbols }
     */
    transposeMusic(semitones, { movement = 0, measures = null, keys = true, chordNames = true } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      if (!Number.isInteger(semitones) || semitones === 0 || Math.abs(semitones) > 24) throw new Error('Choose an interval of 1 to 24 semitones');
      if (measures && !(Number.isInteger(measures.from) && Number.isInteger(measures.to) && measures.from >= 0 && measures.to >= measures.from && measures.to < mv.masterbars.length)) throw new Error('Unknown measures');
      let result = null;
      this.edit('Transposer la musique', () => { result = transposeMovement(doc, mv, intervalOfSemitones(semitones), { measures, keys, chordNames }); });
      return result;
    },
    // ---- chord grids (model/gridtemplates.js, model/chordgridedit.js): typical grids written in the chord track
    /** What the grid window needs: `measures` (count), `target` (index of the measure the selection points at, or null = no measure chosen), `hasChordTrack`. */
    gridInfo({ movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      const sel = this.selectedMeasures({ movement }); // a chosen measure, a chord slot, a range or a note: the grid starts at its first measure
      return { measures: mv.masterbars.length, target: sel ? sel.from : null, hasChordTrack: mv.tracks.some(isChordTrack) };
    },
    /** What a grid of `count` measures would replace: `{ chords, sections }` — from measure `start`, or the whole chord track (`start` null). */
    gridConflicts(count, { movement = 0, start = null } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      return gridConflicts(mv, { start: start ?? 0, count, wholeTrack: start === null });
    },
    /**
     * Writes a grid in the chord track (one undo step): `start` = index of the first measure, null = it REPLACES the whole chord track and its sections. `tonicPc` 0–11, `choruses` = grids in a row,
     * `labelOf(section)` = the text of a section of the form. → { from, count, added }
     */
    applyGrid(gridId, { movement = 0, start = null, tonicPc = 0, choruses = 1, labelOf = null } = {}) {
      const mv = doc.work.movements[movement];
      const grid = gridById(gridId);
      if (!mv || !grid) throw new Error('Unknown grid or movement');
      let result = null;
      this.edit('Grid: apply', () => { result = applyGridModel(doc, mv, grid, { tonicPc, choruses, start: start ?? 0, wholeTrack: start === null, labelOf }); });
      return result;
    },
    // ---- scales (scales/): a scale written in the score, or as a scale movement
    /** What the scales window needs: `measures`, `target` (first measure of the selection, or null), `staves` = the notation and tablature staves [{ id, name, type }], `selected` = the staff the selection points at (or null). */
    scaleInfo({ movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      const staves = mv.tracks.flatMap((t) => t.staves.filter((s) => ['score', 'tab'].includes(getProperty(s, PID.STAFF_TYPE))).map((s) => ({ id: s.id, name: `${t.name || ''}`.trim(), type: getProperty(s, PID.STAFF_TYPE) })));
      const sel = this.selectedMeasures({ movement });
      let selected = null;
      for (const id of this.view('main')?.selection?.() ?? []) { let el = doc.find(id); while (el && el.type !== 'staff') el = doc.parentOf(el.id); if (el && staves.some((s) => s.id === el.id)) { selected = el.id; break; } }
      const hosts = mv.tracks.flatMap((t) => t.staves.map((s) => ({ id: s.id, name: `${t.name || ''}`.trim(), type: getProperty(s, PID.STAFF_TYPE) })));
      let host = null;
      for (const id of this.view('main')?.selection?.() ?? []) { let el = doc.find(id); while (el && el.type !== 'staff') el = doc.parentOf(el.id); if (el && hosts.some((s) => s.id === el.id)) { host = el.id; break; } }
      return { measures: mv.masterbars.length, target: sel ? sel.from : null, targetTo: sel ? sel.to : null, staves, selected, hosts, host };
    },
    /** Writes a scale (a recipe) in a staff from a measure (one undo step). → { from, measures, added } */
    writeScale(recipe, { movement = 0, staffId, start = 0 } = {}) {
      const mv = doc.work.movements[movement]; const staff = staffId && doc.find(staffId);
      if (!mv || !staff || staff.type !== 'staff') throw new Error('Unknown staff or movement');
      let result = null;
      this.edit('Scales: write a scale', () => { result = writeScaleModel(doc, mv, staff, { recipe, start }); });
      return result;
    },
    /** A scale container above a staff (one undo step): over `span` measures from measure `start`, written for the instrument of the track of the staff. */
    addScaleContainer(recipe, { movement = 0, staffId, start = 0, span = 4 } = {}) {
      const mv = doc.work.movements[movement]; const staff = staffId && doc.find(staffId);
      if (!mv || !staff || staff.type !== 'staff' || !mv.masterbars[start]) throw new Error('Unknown staff, measure or movement');
      const n = Math.max(1, Math.min(span, mv.masterbars.length - start));
      let c = null; this.edit('Scales: scale panel above a staff', () => { c = addScaleContainerModel(doc, mv, staff, { recipe, measureId: mv.masterbars[start].id, span: n }); });
      return { id: c.id, from: start, span: n };
    },
    /** A new scale movement at the end of the work (one undo step). → the id of the movement */
    addScaleMovement(recipe, { title = '' } = {}) { return this.edit('Scales: new scale movement', () => createScaleMovement(doc, { recipe, title }).id); },
    // ---- cues of the automatic players (model/cueedit.js): signs on the score that say which version of a groove, or which break, a drum player plays there
    /**
     * What the cue window shows: `measures` (count), `target` (index of the measure the selection points at, or null), `players` = the other players whose pattern has alternative phrases [{ id, name, alts: [{ value, name | null, index }] }], `tracks` = the drum tracks with a player
     * [{ id, name, versions: [{ value, name | null, index }], fills: [{ value, name | null, index }] }] and `cues` = [{ id, measureIndex, kind, value, text, trackId, trackName | null }].
     */
    cueInfo({ movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      const grooves = this.grooves();
      const tracks = (this.tracksOutline()[movement]?.tracks ?? []).map((t) => ({ t, g: grooves.find((x) => x.id === t.player?.pattern) })).filter((x) => x.g).map(({ t, g }) => ({
        id: t.id, name: t.name || t.id,
        versions: [{ value: 'main', name: g.mainName ?? null, index: 0 }, ...(g.variants ?? []).map((v, i) => ({ value: v.id, name: v.name ?? null, index: i + 1 }))],
        fills: (g.fills ?? []).map((f, i) => ({ value: f.id, name: f.name ?? null, index: i + 1 })),
      }));
      // the other players (a bass, a guitar, a keyboard) whose pattern has alternative phrases: a cue of kind 'alt' picks one of them
      const patterns = this.chordPatterns();
      const players = (this.tracksOutline()[movement]?.tracks ?? []).map((t) => ({ t, p: patterns.find((x) => x.id === t.player?.pattern) })).filter((x) => x.p?.alts?.length).map(({ t, p }) => ({
        id: t.id, name: t.name || t.id, alts: p.alts.map((alt, i) => ({ value: alt.id, name: alt.name ?? null, index: i + 1 })),
      }));
      const sel = this.selectedMeasures({ movement });
      const at = sel ? sel.from : -1;
      const names = new Map([...tracks, ...players].map((t) => [t.id, t.name]));
      return { shown: doc.getStyle(mv, SID.SHOW_CUES) !== false, measures: mv.masterbars.length, target: at >= 0 ? at : null, tracks, players, cues: cueEntries(mv).map((c) => ({ ...c, trackName: c.trackId ? names.get(c.trackId) ?? c.trackId : null })) };
    },
    /** Puts a cue on a measure (by index or by id): `spec` { kind: 'groove' | 'break', value, text, trackId? }; one undo step. */
    setCue(measure, spec, { movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      const bar = typeof measure === 'string' ? mv?.masterbars.find((b) => b.id === measure) : mv?.masterbars[measure]; // a measure index or a measure id
      if (!bar) throw new Error('Unknown measure');
      return this.edit('Cue: set', () => setCueModel(doc, mv, bar.id, spec));
    },
    /** Shows or hides the cues on the score (nothing is deleted); one undo step. */
    setCuesShown(visible, { movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      return this.edit('Cues: show or hide', () => doc.setStyle(mv, SID.SHOW_CUES, Boolean(visible)));
    },
    removeCue(id, { movement = 0 } = {}) {
      const mv = doc.work.movements[movement];
      if (!mv) throw new Error(`Unknown movement: ${movement}`);
      return this.edit('Cue: remove', () => removeCueModel(doc, mv, id));
    },
    /** Adds or replaces a groove at a level ('user' = this device, 'project' = this file); returns the saved groove. */
    saveGroove(level, input) {
      const groove = createGroove({ ...input, id: input.id || `gr${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}` });
      if (!groove) throw new Error('A groove needs at least one hit');
      const errors = validateGroove(groove);
      if (errors.length) throw new Error(errors[0]);
      const put = (list) => (list.some((g) => g.id === groove.id) ? list.map((g) => (g.id === groove.id ? groove : g)) : [...list, groove]);
      if (level === 'user') preferences.set('grooves', { items: put(preferences.get('grooves')?.items ?? []) });
      else this.edit('Grooves: save', () => setProjectGrooves(doc, doc.work, put(doc.get(doc.work, PID.GROOVES) ?? [])));
      return groove;
    },
    removeGroove(level, id) {
      if (level === 'user') preferences.set('grooves', { items: (preferences.get('grooves')?.items ?? []).filter((g) => g.id !== id) });
      else this.edit('Grooves: remove', () => setProjectGrooves(doc, doc.work, (doc.get(doc.work, PID.GROOVES) ?? []).filter((g) => g.id !== id)));
    },
    /** Copies a groove to a level (a built-in groove becomes an editable copy with a new id). Returns the copy. */
    copyGroove(id, to, { fresh = false, name } = {}) {
      const found = this.grooves().find((g) => g.id === id);
      if (!found) throw new Error('Unknown groove');
      return this.saveGroove(to, { ...found, id: fresh || found.source === 'builtin' ? '' : found.id, name: name ?? found.name });
    },
    setChordPattern(staffId, patch) { return this.edit('Staff properties: chord pattern', () => staffProps.setChordPattern(doc, staffId, patch)); },
    setTabDiagrams(staffId, options) { return this.edit('Staff properties: diagrams of a tablature', () => staffProps.setTabDiagrams(doc, staffId, options)); },
    /** Which guitar gives the « capo shapes » of the chords: { chordStaffId, staves: [{ id, name }] (those that have capos), chosen (id | null = automatic), used (the name of the staff that counts, or null when no capo is written) } or null without a chord track. */
    chordCapoInfo({ movement = 0 } = {}) {
      const mv = doc.work.movements[movement]; const chord = mv && sys.chordViewStaff(mv); if (!chord) return null;
      const staves = capoStaves(mv); const chosen = doc.get(chord, PID.CHORD_CAPO_STAFF) ?? null;
      const picked = staves.find((x) => x.id === chosen) ?? staves[0] ?? null;
      return { chordStaffId: chord.id, staves, chosen: picked && chosen === picked.id ? chosen : null, used: picked?.name ?? null };
    },
    setChordCapoStaff(staffId, capoStaffId) { return this.edit('Staff properties: staff that gives the capo', () => staffProps.setChordCapoStaff(doc, staffId, capoStaffId)); },
    setChordReading(staffId, patch) { return this.edit('Staff properties: how the chords are read', () => staffProps.setChordReading(doc, staffId, patch)); },
    setChordDiagramsMode(staffId, mode) { return this.edit('Staff properties: automatic chord diagrams', () => staffProps.setChordDiagramsMode(doc, staffId, mode)); },
    setDiagramTabStaff(staffId, tabStaffId) { return this.edit('Staff properties: diagram fingering', () => staffProps.setDiagramTabStaff(doc, staffId, tabStaffId)); },
    setGridLyrics(staffId, mode) { return this.edit('Staff properties: grid lyrics', () => staffProps.setGridLyrics(doc, staffId, mode)); },
    setStrum(staffId, patch) { return this.edit('Staff properties: strum', () => staffProps.setStrum(doc, staffId, patch)); },
    setAccordionLayout(staffId, patch) { return this.edit('Staff properties: accordion buttons', () => staffProps.setAccordionLayout(doc, staffId, patch)); },
    setChordSpelling(staffId, mode) { return this.edit('Portée d\'accords : orthographe des notes', () => qualityIntents.setSpelling(doc, doc.find(staffId), mode)); },
    /** Renomme une qualité et migre ses symboles ; renvoie le nombre de symboles migrés. */
    renameChordQuality(id, newId) { return this.edit('Qualités d\'accord : renommer', () => qualityIntents.renameQuality(doc, id, newId)) ?? 0; },
    /** Supprime une qualité (`{ replaceWith }` = identifiant du remplaçant si des symboles l'utilisent) ; renvoie le nombre de symboles migrés. */
    removeChordQuality(id, options) { return this.edit('Qualités d\'accord : supprimer', () => qualityIntents.removeQuality(doc, id, options)) ?? 0; },
    resetChordQuality(id) { return this.edit('Qualités d\'accord : revenir à l\'intégré', () => qualityIntents.resetQuality(doc, id)); },
    restoreChordQuality(id) { return this.edit('Qualités d\'accord : restaurer', () => qualityIntents.restoreQuality(doc, id)); },
    resetAllChordQualities() { return this.edit('Qualités d\'accord : tout réinitialiser', () => qualityIntents.resetAll(doc)); },
    /** Texte du fichier `scorsaire-chord-qualities` du dictionnaire en vigueur. */
    exportChordQualities: () => exportChordQualities(qualityIntents.getChordQualities(doc)),
    importChordQualities(input) { return this.edit('Qualités d\'accord : importer', () => qualityIntents.importDictionary(doc, input)); },
    // préférences de l'application (en mémoire) : dictionnaire proposé aux nouveaux documents
    preferences,
    /** Dictionnaire choisi comme défaut des nouveaux documents, ou undefined (= les qualités intégrées). */
    defaultChordQualities: () => preferences.get('chordQualities'),
    /** Range le dictionnaire de ce document comme défaut des nouveaux documents. */
    useChordQualitiesAsDefault() { preferences.set('chordQualities', createChordQualities(qualityIntents.getChordQualities(doc))); },
    clearDefaultChordQualities() { preferences.clear('chordQualities'); },
    /** Applique à CE document le défaut de l'application (ou les qualités intégrées s'il n'y en a pas). */
    applyDefaultChordQualities() { return this.edit('Qualités d\'accord : appliquer le défaut', () => qualityIntents.replaceDictionary(doc, preferences.get('chordQualities') ?? createChordQualities())); },
    // ---------- saisie des symboles d'accord en grille (tranche 6) : adresse de case { staffId, measureId, cell } ----------
    /** Pose / modifie fondamentale, qualité (identifiant du dictionnaire) et basse d'une case. patch : { root, quality, bass }. */
    setCellChord(address, patch) { return this.edit('Accord : saisie', () => entry.setCellChord(doc, address, patch)); },
    /** Play offset (advance / delay) of the symbol of a cell; `offset` = signed fraction or null. */
    setPlayOffset(address, offset) { return this.edit('Accord : décalage de jeu', () => entry.setPlayOffset(doc, address, offset)); },
    setCellNoChord(address) { return this.edit('Accord : N.C.', () => entry.setCellNoChord(doc, address)); },
    setMeasureRepeat(address) { return this.edit('Accord : %', () => entry.setMeasureRepeat(doc, address)); },
    setTwoMeasureRepeat(address) { return this.edit('Accord : %%', () => entry.setTwoMeasureRepeat(doc, address)); },
    eraseCell(address) { return this.edit('Accord : effacer', () => entry.eraseCell(doc, address)) ?? false; },
    subdivideCell(address) { return this.edit('Accord : subdiviser la case', () => entry.subdivideCell(doc, address)); },
    setMeasureSlots(address, count) { return this.edit('Accord : nombre de cases de la mesure', () => entry.setMeasureSlots(doc, address, count)); },
    setAllSlots(address, count) { return this.edit('Accord : nombre de cases de toutes les mesures', () => entry.setAllSlots(doc, address, count)); },
    restoreGrid(address) { return this.edit('Accord : rétablir la grille', () => entry.restoreGrid(doc, address)) ?? false; },
    /** Cases d'une mesure (lecture) et case voisine ; null au bout du Mouvement. */
    slotOptions: (address) => { const c = entry.resolveCell(doc, { ...address, cell: null }); return gridSlotOptions(c.masterbar, c.first); },
    cellsOf: (address) => entry.resolveCell(doc, { ...address, cell: null }).cells,
    neighbourCell: (address, direction) => entry.neighbourCell(doc, address, direction),
    // ---------- annuler / refaire (le moteur est dans le Document ; la sélection des vues est restaurée par `event.view`) ----------
    // a second history may sit beside the Document's (the session of mode B: placements, banner…, see ui/session-history.js): the one changed last answers first
    undo() { if (extraHistory?.canUndo() && (!doc.canUndo() || extraHistory.at() >= lastDocChange)) return extraHistory.undo(); return doc.undo(); },
    redo() { if (extraHistory?.canRedo()) return extraHistory.redo(); return doc.redo(); },
    canUndo: () => doc.canUndo() || !!extraHistory?.canUndo(),
    canRedo: () => doc.canRedo() || !!extraHistory?.canRedo(),
    /** { canUndo, canRedo } : pour griser les boutons. */
    historyState: () => ({ canUndo: doc.canUndo() || !!extraHistory?.canUndo(), canRedo: doc.canRedo() || !!extraHistory?.canRedo() }),
    /** Prévient (avec `historyState()`) après chaque validation, annulation ou rétablissement. Renvoie la fonction de désabonnement. */
    onHistoryChange(fn) { historyListeners.add(fn); return () => historyListeners.delete(fn); },
    /** Plugs a second history ({ canUndo, canRedo, undo, redo, at, onChange }) beside the Document's; null unplugs it. */
    setExtraHistory(h) { offExtra?.(); extraHistory = h ?? null; offExtra = h?.onChange?.(notifyHistory) ?? null; notifyHistory(); },
  };
}
