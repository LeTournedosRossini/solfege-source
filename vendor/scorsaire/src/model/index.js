/*
 * Modèle de données — données pures, aucune dépendance au DOM ni aux autres couches (model ← layout ← render ← ui).
 *
 * Hiérarchie (roadmap §2) : Work → Movement → { masterbars[], tracks[], systemContainers[], groups[], voltas[], syncs[] }
 *   Track → staves[] → voices[] → measures[] (alignées sur les masterbars) → items[] (accords de notes, silences, symboles d'accord…)
 *   Chord → notes[] (une ou plusieurs notes attaquées ensemble)
 *   Staff → containers[] (conteneurs « portée », dont la notation imbriquée qui porte elle-même des staves)
 *
 * Étape 2 du plan :
 *   - ids.js / pitch.js  : identifiants stables, hauteurs et durées (fonctions pures) ; fraction.js : temps exact
 *   - sid.js / pid.js    : styles (Sid) et propriétés (Pid) à la MuseScore
 *   - schema.js          : types d'éléments, propriétés applicables, catalogue des types de portée
 *   - elements.js        : constructeurs ; props.js : lecture des propriétés et résolution des styles
 *   - history.js         : commandes, transactions, annuler/refaire
 *   - document.js        : Document = œuvre + index + historique (SEULE porte d'écriture)
 *   - serialize.js       : fichier de sauvegarde JSON versionné ; validate.js : invariants
 */
export { newId, resetIds, idCounter } from './ids.js';
export {
  midiFromSpelling, defaultSpelling, diatonicIndex, DURATION_VALUE, DURATION_BASES, MEASURE_DURATION, writtenDuration, actualDuration, tupletSpan, timeSigDuration,
} from './pitch.js';
export {
  PPQ, ZERO, frac, isFraction, fAdd, fSub, fMul, fDiv, fCmp, fEq, fLt, fLe, fMin, fMax, fSum, fToNumber, fToTicks,
  fFromTicks,
} from './fraction.js';
export { SID, SID_TABLE, isSid } from './sid.js';
export { PID, PID_TABLE, isPid, validatePropertyValue } from './pid.js';
export { ELEMENT_TYPES, STAFF_TYPES, elementSchema, isApplicable } from './schema.js';
export { getProperty, propertyFlags, propertyDefault, hasLocalValue, resolveStyle, setUserStyleLayer, userStyleEpoch } from './props.js';
export {
  createElement, createNote, createChord, createNoteChord, createRest, createTabNote, createPercNote, createRhythmNote, createRhythmChord, createChordSymbol, createLyricEvent, createAccNote,
  createArticulation, createFingering, validateFingerings, FINGERING_KINDS, createGraceNote, createPercGraceNote, GRACE_TYPES, createHairpin, createTie, createGlissando, createHopo, createBend, createWheel, BEND_TYPES, createCapo, CAPO_MODES, createStringTunings, createTechLine, createPedal, TECH_LINE_TYPES, VIBRATO_TYPES, createChordLine, createSlur, createTwoChordTremolo,
  createMeasure, createEmptyMeasure, createVoice, createStaff, createTrack, createMasterbar, createMovement, createWork, createPart, createSheet,
  createSystemContainer, createStaffContainer, createGroup, createVolta, createJump, createMarker, createRehearsalMark, createTempo, createTempoChange, createFermata, createSwing, createCue, createBreath, createSync,
} from './elements.js';
export { validateWork } from './validate.js';
export { DYNAMIC_TYPES, DYNAMIC_DISPLAY, DYNAMIC_SYMBOLS, VOICE_ASSIGNMENTS, DEFAULT_DYNAMIC_PLAYBACK, dynamicGlyphs, dynamicPlayback } from './dynamics.js';
export { JUMP_TYPES, MARKER_TYPES, jumpLabels, jumpText, jumpPlaysRepeats, markerLabel, markerParts, isRightMarker } from './repeats.js';
export { unwindMovement, unwindWork, playOrder } from './repeatlist.js';
export { PLAYABLE_TYPES, localPlay, setPlay, setPlayAll, collectMuted } from './play.js';
export {
  TEMPO_KINDS, TEMPO_WORDS, GRADUAL_TYPES, CHANGE_RESOLUTIONS, FERMATA_STRETCH, fermataStretch, beatUnitFraction, wpsFromBpm, bpmFromWps,
  beatUnitText, parseTempoText, DEFAULT_WPS,
} from './tempo.js';
export { GLISSANDO_STYLES, glissandoStyleOf, glissandoPlays, validateGlissandos, isRunEntry } from './glissando.js';
export { RUN_MODES, DEFAULT_RUN, defaultRunStart, isWhiteKey, whiteKeyRun, runTiming, glissandoRunInfo, addGlissandoRun, removeGlissandoRun } from './glissandorun.js';
export { DECOR_KINDS, decorId, parseDecorId, hiddenDecorList, isDecorHidden, validateHiddenDecor } from './decor.js';
export { pedalPlays, validatePedals, PEDAL_TYPES, DEFAULT_PEDAL_TYPE, pedalSpec } from './pedal.js';
export { bendTimeFactorDefaults, bendTimeFactors, bendPlays, validateBendPlayback } from './bend.js';
export { TRILL_TYPES, createTrillLine, validateTrills, ORNAMENT_INTERVAL_TYPES, DEFAULT_ORNAMENT_INTERVAL, ornamentIntervalOf, ornamentChromatic, validateOrnamentInterval } from './trill.js';
export { writeSyllable, removeSyllable, extendMelisma, writeLyricsBlock, lyricAt, neighbourChord, staffChords, verseList, parseTokens, formatTokens, parseBlock, blockToText } from './lyricsedit.js';
export { SYLLABIC, LYRICS_PLACEMENTS, createLyricText, createLyricLink, parseLyricsText, resolveLyricLinks, validateLyricTexts, validateLyricLinks } from './lyrics.js';
export { BREATH_TYPES, breathPause, validateBreaths } from './breath.js';
export { SWING_PRESETS } from './swingpresets.js';
export { staffSwing, staffSwingTimeline, SWING_UNIT_TICKS } from './swing.js';
export { tempoTimeline, measureLayout, absolutePosition, fermataIntervals, breathPauses, curveProgress, secondsBetween } from './tempomap.js';
export {
  measureLengthOf, isIrregularMeasure, isMeasureRest, itemDuration, voiceMeasureDuration, measureOffsetOf, isAnacrusis,
} from './timing.js';
export { walk, buildIndex } from './store.js';
export { buildListEntryIndex, LIST_ENTRY_KINDS, STAFF_LIST_KINDS, NOTE_LIST_KINDS, MARK_KINDS, CHORD_PROPERTY_MARKS, CHORD_ARTICULATION_KIND } from './listindex.js';
export { setStrict, isStrict } from './guard.js';
export { createDocument, ModelInvariantError } from './document.js';
export { serializeWork, loadWork, ScoreFileError, FILE_FORMAT, FILE_VERSION, MIGRATIONS } from './serialize.js';
export { sampleWork, sampleFullWork, sampleArchitectureWork, sampleTablatureWork, sampleTablatureMarksWork, sampleTablatureTechniquesWork, sampleScoreTechniquesWork, sampleCapoWork, sampleVerificationWork, samplePercussionWork, samplePercussionLinesWork, samplePercussionRestsWork, samplePercussionPresetsWork, samplePercussionStickingWork, sampleFingeringWork, sampleFingeringAdvancedWork, sampleAccordionWork, sampleJumpsWork, sampleBreathsWork, sampleTrillsWork, sampleTempoWork, samplePedalWork, sampleDynamicsWork, sampleTransposeWork, sampleCClefsWork, sampleDoClefsWork, sampleDoTransposeWork, sampleChordSymbolsWork, sampleChordPatternsWork, sampleCrossStaffWork, sampleRhythmWork, sampleLyricsWork, sampleNoteEntryWork, sampleStaffTextWork, sampleContainersWork, sampleStressWork, sampleLinkedWork } from './samples.js';
export {
  NO_CAPO, capoParams, capoTimeline, capoAt, staffTimeline, capoText, capoFretShift, derivedFret, storedPitchOfFret, soundingPitch, convertPitch,
  tuningPitches, tuningPitchesAt, tuningChanges, tuningAt, insertCapo, changeCapo, removeCapo, updateNotationForCapoChange,
} from './capo.js';
export { isVocalInstrument, instrumentInfo, trackTransposition, instrumentGroups, searchInstruments, instrumentDisplayName, groupDisplayName, familyDisplayName, translatedOrderName } from './instruments.js';
export {
  PREFER, interval, intervalIsZero, flipInterval, transposeTpc, transposeKey, clampKey, writtenKey, staffInterval, writtenSpelling, writtenPitch,
} from './transpose.js';
export { transposeMovement } from './transposeedit.js';
export { insertMeasures, deleteMeasures } from './measureedit.js';
export { nestedStaves } from './containerstaves.js';
export { setContainerScale, setContainerOwnSignature, setFragmentSignature, setFragmentBarSignature, setContainerLayout, setContainerTransposeFollow, setContainerPlay, createFragment, syncFragmentBars, setContainerSpacing, addFragmentContainer, addSlotContainersEveryStaff, setFragmentMeasures, setFragmentHeader, FRAGMENT_MAX_MEASURES, FRAGMENT_STAFF_TYPES, addTextContainer, addSlotContainer, setSlotWidth, addNestedContainer, setContainerSpan, setContainerText, moveContainer, CONTAINER_TEXT_MAX } from './containeredit.js';
export { createScore, createStarterScore, createNewScoreDocument, normalizeNewScoreOptions, NewScoreError, NEW_SCORE_DEFAULTS, NEW_SCORE_LIMITS, QUICK_START_PARTS, applyTapSections } from './newscore.js';
export { addTrack, addTrackFromInstrument, addStaff, removeTrack, removeStaff, moveTrack, moveStaff, moveTrackTo, moveStaffTo, renameTrack, setTrackAbbreviation, setTrackIcon, trackOfStaff, trackActions, staffActions, CREATABLE_STAFF_TYPES } from './trackedit.js';
export { ICONS, isTrackIcon } from './icons.js';
export { movableIds, moveElements, resetOffsets, offsetOf } from './offsetedit.js';
export { BUILTIN_TEMPLATES, builtinTemplate, templateCategories, templateTitle } from './templates.js';
export { templateFromMovement, validateTemplate, validateTemplateList, applyTemplate, removeAllTracks, templatePartNames } from './templateedit.js';
export { groupTracks, ungroup, setGroupStyle, setGroupLabel, setGroupBarlines, clearGroups, barlinesConnect, walkGroups, parentOfGroup, BRACKET_STYLES } from './groupedit.js';
export { SCORE_ORDERS, hasScoreOrder, planScoreOrder, applyScoreOrder, refreshAutoGroups, instrumentSortIndex, tracksFollowOrder, sortTracksByOrder, scoreOrderName } from './scoreorder.js';
export { LINKABLE, canLink, linkTypesFor, SHARED_LISTS, sharedListsFor, isLinkedStaff, primaryOf, contentStaff, projectedStrings, linkedStavesOf, linkedStaffProblems, projectLinkedStaff, addLinkedStaff, linkCandidates, planLink, linkStaff, unlinkStaff } from './linkedstaff.js';
export { CONVERTIBLE_STAFF_TYPES, staffTypeChoices, planStaffTypeChange, changeStaffType, clefMiddleLinePitch } from './stafftypeedit.js';
export { placeChordInTuplet, placeChord, deleteItem, placeRest, addNoteToChord, removeNoteFromChord, recomputeAutoRests, replaceVoiceMeasure, measureTimeline, EditError } from './noteedit.js';
export { toRhythmicDurationList, toDurationList } from './rhythmsplit.js';
export { GridError, beatsOf, beatGrid, fitBeatCells, cellStart, cellIndexAt, cellCountCandidates, planVoiceMeasure, applyVoiceMeasurePlan } from './gridedit.js';
export {
  DRUM_STEM_DIRECTIONS, PERCMAP_FORMAT, PERCMAP_VERSION, DEFAULT_PERCMAP, createDrumSound, createPercMap, drumKitCatalog, drumKitInfo, percMapFromKit,
  resolvePercmapOf, HAND_PERCUSSION_PERCMAP, LEGACY_DRUMMAP_FORMAT, percmapPresets, percmapPreset, soundDisplayName, staffSoundMap, drumSwitchesFor, DRUM_SWITCHES, isPercussionType, drumIndex, drumSound, drumSoundForMidi, drumPositions, drumLineToY, validatePercMap, exportPercMap, importPercMap,
  addDrumSound, updateDrumSound, removeDrumSound, moveDrumSound, withDrumSwitches, DRUM_SWITCHES as DEFAULT_DRUM_SWITCHES, MAX_SWITCHES, MAX_SWITCH_SOUNDS,
} from './percmap.js';
export * from './percmapedit.js';
export * from './percvoices.js';
export * from './voicemove.js';
export * from './voicingpools.js';
export * from './slashedit.js';
export * from './partstafftext.js';
export * from './wheel.js';
export {
  STICKING_HANDS, STICKING_PRESETS, STICKING_PLACEMENTS, STICKING_FORMAT, STICKING_VERSION, DEFAULT_STICKING_PRESET, STICKING_PRESET_SYMBOLS,
  isStickingSymbol, createStickingSystem, validateStickingSystem, resolveStickingSystem, stickingSymbol, exportStickingSystem, importStickingSystem,
} from './sticking.js';
export {
  FINGERING_MAP_PRESETS, FINGERING_MAP_FORMAT, createFingeringMap, validateFingeringMap, fingeringPieces, presetGlyph, exportFingeringMap, importFingeringMap,
} from './fingeringmap.js';
export { PREFERENCES_FORMAT, PREFERENCES_VERSION, PREFERENCE_SECTIONS, exportPreferences, importPreferences } from './preferences.js';
export { HEAD_GROUPS, HEAD_GROUP_IDS, isDrumHead, isCustomHead, drumHeadGlyph, headColumn } from './drumheads.js';

import { createDocument } from './document.js';
import { loadWork } from './serialize.js';

/** Ouvre un fichier de sauvegarde (texte ou objet) dans un nouveau Document. */
export function loadDocument(input, options) {
  return createDocument(loadWork(input), options);
}
export {
  ACC_ROW_COUNTER_BASS, ACC_ROW_BASS, ACC_CHORD_ROWS, ACC_ROW_QUALITY, ACC_ROW_SUFFIX, ACCORDION_SYSTEMS, DEFAULT_ACCORDION_SYSTEM, spellingFifths, fifthsSpelling,
  isBassRow, isChordRow, columnRoot, buttonPosition, buttonBadge, chordButtonName, chordButtonText, ACCORDION_LAYOUT_FORMAT, ACCORDION_LAYOUT_VERSION, BUTTON_PLACEMENTS,
  DEFAULT_ACCORDION_LAYOUT, createAccordionLayout, validateAccordionLayout, resolveAccordionLayout, exportAccordionLayout, importAccordionLayout,
} from './accordion.js';
export * from './chordstyle.js';
export * from './chordoffset.js';
export * from './chordquality.js';
export * from './chordqualityedit.js';
export * from './inputgrid.js';
export * from './chordentry.js';

export * from './range.js';
export * from './grips.js';
export * from './gripedit.js';
export * from './bendedit.js';
export { clearRange, removeRangeMeasures } from './rangeedit.js';
export { copyRange, canCopyRange, serializeClipboard, parseClipboard, clipboardSummary, lyricSyllablesToText, CLIPBOARD_FORMAT } from './clipboard.js';
export { pasteClipboard, canPaste } from "./pasteedit.js";
export * from './selectionfilter.js';
export * as systemEdit from './systemedit.js';
export { sectionList, sectionSpans, sectionAtMeasure, sectionColor, defaultSectionColor, parseCardText, inlineCardColor, SECTION_CATEGORIES, SECTION_NAMES, SECTION_LETTERS, SECTION_COLORS, SECTION_PALETTE } from './sections.js';
export { TECHNIQUES, techniqueText, isTechnique } from './techniques.js';
export { createStaffText, addStaffText, updateStaffText, removeStaffText, validateStaffTexts, STAFF_TEXT_STYLES, STAFF_TEXT_PLACEMENTS } from './stafftextedit.js';
export { PAGE_FORMATS, pageFormatIds, pageGeometry } from './page.js';
export { isChordTrack, chordTracksOf, chordTrackOf, chordTrackProblems, ensureChordFirst, chordFirst } from './chordtrack.js';
export { variantOf, variantPeers, activeVariant, setVariantOf, setVariantLabel, clearVariant, selectVariant, nextVariantId, VariantError, VARIANT_LABEL_MAX } from './variants.js';
export { createView, activeViewId, applyView, saveCurrentView, renameView, removeView, moveView, setViewTracks, viewsOf, viewStaffIds, addToActiveView, pruneViews, ViewEditError } from './viewedit.js';
export { AUTOMATION_PARAMS, AutomationError, createAutomationLane, createAutomationPoint, automationLanes, laneOf, sortedEntries, laneAt, setRangeValue, clearLane, validateAutomation, addPoint as addAutomationPoint, movePoint as moveAutomationPoint, setPointRamp as setAutomationRamp, removePoints as removeAutomationPoints, shiftRange as shiftAutomationRange, pasteLane as pasteAutomationLane, movePoints as moveAutomationPoints, shiftPoints as shiftAutomationPoints } from './automation.js';
export { canvasesOf, partsOfCanvas, paperParts, addCanvas, setCanvas, removeCanvas } from './partedit.js';
export { addPart, duplicatePart, removePart, movePart, renamePart, setPartStaves, setPartTrackOrder, setPartTransposition, setPartTransposeAll, partTrackIds, setPartPage, applyPageToAllParts, partStaffChoices, partStaffIds, PartEditError, partBreaks, partLocks, lockContaining, toggleBreak, lockSystem, unlockSystem, extendLock, setBreaksEvery, purgePartLayout, setHeaderFooter, setTitleBlock, setMeasureNumberMode, setMeasureCounting, setWorkMeta, setElementOverride, partOverrideOf, copyPartSettings, COPY_GROUPS, setTextStyle, setTextContent, textSourceOf, MUSIC_TYPES } from './partedit.js';
export { DEFAULT_HEADER, DEFAULT_FOOTER, headerFooterOf, templateFor, templateKeyFor, textStyleOf, defaultTextStyle, TEXT_FAMILIES, TEXT_ALIGNS, TEXT_KEY, expandTokens, parseRuns, titleBlockOf, layoutTitleRows, measureNumbers, showsMeasureNumber, TOKEN_HELP } from './pagetext.js';
export * from './partzones.js';
export * from './partcontainers.js';
export * from './movementedit.js';

export { SheetEditError, SHEET_LAYOUTS, MAX_COLUMNS, setSheetColumns, READER_LOCKS, TRANSPOSE_RANGE, SPEED_RANGE, STAFF_SIZE_RANGE, readerOptions, cellSettings, trackShift, setCellOption, setCellUnlock, setCellLoop, setTrackOption, sheetCells, sheetShape, addSheet, removeSheet, renameSheet, moveSheetTo, setSheetLayout, addCell, removeCell, moveCellTo, setCellMovement, setCellTracks, setReaderOption, setReaderUnlock, pruneSheets } from './sheetedit.js';

export * from './trackdisplay.js';
export * from './composite.js';
export * from './dividers.js';
export * from './recueil.js';
export * from './chordview.js';
export * from './pagehints.js';
