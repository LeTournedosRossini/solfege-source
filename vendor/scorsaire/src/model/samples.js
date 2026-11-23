/*
 * Œuvres d'exemple : `sampleWork` (« hello score » du squelette) et `sampleFullWork` (morceau de test qui
 * exerce toute la hiérarchie du §2 : tous les types de portée, conteneurs, groupes, voltas, synchronisation).
 */
import { createFragment } from './containeredit.js';
import { resetIds, newId } from './ids.js';
import { PID } from './pid.js';
import { DYNAMIC_TYPES } from './dynamics.js';
import {
  createChord, createNote, createNoteChord, createRest, createEmptyMeasure, createTabNote, createPercNote, createRhythmChord, createChordSymbol, createAccNote,
  createMeasure, createVoice, createStaff, createTrack, createMasterbar, createMovement, createWork,
  createSystemContainer, createStaffContainer, createGroup, createVolta, createJump, createMarker, createTempo, createTempoChange, createFermata, createSwing, createSync,
  createTie, createSlur, createTwoChordTremolo, createGlissando, createHairpin, createArticulation, createGraceNote, GRACE_TYPES,
  createHopo, createFingering, createChordLine, createBend, createWheel, createTechLine, createCapo, createStringTunings, createPercGraceNote, createBreath, createPedal,
} from './elements.js';
import { DEFAULT_PERCMAP, HAND_PERCUSSION_PERCMAP, createPercMap, percMapFromKit, percmapPreset } from './percmap.js';
import { pitchFromName } from './capo.js';
import { frac } from './fraction.js';
import { createTrillLine } from './trill.js';
import { createLyricText, createLyricLink } from './lyrics.js';
import { createChordPattern } from './chordpatterns.js';
import { createStrumCard } from './strumcards.js';

/** Œuvre de démonstration : une portée en clé de sol, une mesure à 4/4, quatre noires. */
export function sampleWork() {
  resetIds();
  const notes = [
    createNoteChord([{ step: 'E', octave: 4 }]),
    createNoteChord([{ step: 'G', octave: 4 }]),
    createNoteChord([{ step: 'B', octave: 4 }]),
    createNoteChord([{ step: 'D', octave: 5 }]),
  ];
  const staff = createStaff({
    clef: 'G',
    voices: [createVoice([createMeasure(notes)])],
  });
  const bar = createMasterbar({ timeSig: [4, 4], keySig: 0 });
  const movement = createMovement({
    title: 'Hello score',
    masterbars: [bar],
    tempos: [createTempo({ measureId: bar.id, bpm: 120 })],
    tracks: [createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [staff] })],
  });
  return createWork({ title: 'Hello score', movements: [movement] });
}

const BARS = 4;
const TRIPLET = { id: 'tuplet-demo', ratio: [3, 2], base: { base: 'eighth', dots: 0 } }; // 3 croches dans la place de 2

/**
 * Une voix de `BARS` mesures ; `first` : éléments de la 1re mesure (qui doit remplir exactement la mesure, sauf portée
 * accord). Les autres mesures sont vides : un silence de mesure (ou ce que prévoit le type de portée).
 */
function voiceWith(first, staffType = 'score') {
  const measures = [createMeasure(first)];
  for (let i = 1; i < BARS; i++) measures.push(createEmptyMeasure(staffType));
  return createVoice(measures);
}

/** Morceau de test : 4 mesures, 5 pistes (piano grand staff, guitare score+tab, batterie, accords, accordéon). */
export function sampleFullWork() {
  resetIds();
  const masterbars = [
    createMasterbar({ timeSig: [4, 4], keySig: 0 }),
    createMasterbar({ props: { [PID.REPEAT_END]: true } }),
    createMasterbar({ props: { [PID.REPEAT_START]: true } }),
    createMasterbar({ barType: 'final' }),
  ];
  const [b1, b2, b3, b4] = masterbars.map((b) => b.id);

  const nestedRhythm = createStaff({
    type: 'rhythm',
    voices: [createVoice([createMeasure([createRhythmChord('quarter'), createRest({ duration: 'half', dots: 1 })]), // 1/4 + 3/4
      createEmptyMeasure('rhythm')])],
  });

  const pianoRight = createStaff({
    clef: 'G',
    voices: [voiceWith([
      createNoteChord([{ step: 'C', octave: 5 }, { step: 'E', octave: 5 }, { step: 'G', octave: 5 }]), // accord de 3 notes
      createNoteChord([{ step: 'E', octave: 5 }], { duration: 'half' }),
      createRest({ duration: 'quarter' }),
    ])],
    containers: [
      createStaffContainer({ measureId: b1, span: 2, kind: 'text', text: 'dolce' }),
      createStaffContainer({ measureId: b1, span: 2, kind: 'nestedNotation', fragments: [createFragment({ bars: masterbars.slice(0, 2), staves: [nestedRhythm] })] }),
    ],
  });
  const pianoLeft = createStaff({
    clef: 'F',
    voices: [voiceWith([createNoteChord([{ step: 'C', octave: 3 }, { step: 'G', octave: 3 }], { duration: 'whole' })])],
  });
  const piano = createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [pianoRight, pianoLeft] });

  const guitarScore = createStaff({
    voices: [voiceWith([
      // triolet de croches (3 accords = une noire), puis une noire, puis un silence de blanche
      ...['E', 'G', 'B'].map((step) => createNoteChord([{ step, octave: 4 }], { duration: 'eighth', props: { [PID.TUPLET]: TRIPLET } })),
      createNoteChord([{ step: 'E', octave: 5 }]),
      createRest({ duration: 'half' }),
    ])],
  });
  const guitarTab = createStaff({
    type: 'tab',
    voices: [voiceWith([createChord({
      duration: 'half',
      notes: [createTabNote({ pitch: 64, string: 1 }), createTabNote({ pitch: 59, string: 2 })],
    }), createRest({ duration: 'half' })], 'tab')],
  });
  const guitar = createTrack({ name: 'Guitare', abbreviation: 'Gt', staves: [guitarScore, guitarTab] });

  const kit = createStaff({
    type: 'percussion',
    voices: [voiceWith([
      // grosse caisse + charleston frappés ensemble : un seul accord de deux sons
      createChord({ notes: [createPercNote({ sound: 'bassDrum1' }), createPercNote({ sound: 'closedHiHat' })] }),
      createChord({ notes: [createPercNote({ sound: 'acousticSnare', props: { [PID.GHOST]: true } })] }),
      createChord({ duration: 'half', notes: [createPercNote({ sound: 'closedHiHat' })] }),
    ], 'percussion')],
  });
  const drums = createTrack({ name: 'Batterie', abbreviation: 'Bat', staves: [kit] });

  const chords = createStaff({
    type: 'chord',
    voices: [voiceWith([
      createChordSymbol({ root: { step: 'C', alter: 0 }, quality: 'M7', position: [0, 1], duration: 'half' }),
      createChordSymbol({ root: { step: 'G', alter: 0 }, quality: '7', bass: { step: 'B', alter: 0 }, position: [1, 2], duration: 'half' }),
    ], 'chord')],
  });
  const chordTrack = createTrack({ name: 'Accords', abbreviation: 'Ch', staves: [chords] });

  const accRight = createStaff({ voices: [voiceWith([createNoteChord([{ step: 'A', octave: 4 }], { duration: 'whole' })])] });
  const accLeft = createStaff({
    type: 'accordion-left',
    voices: [voiceWith([
      createChord({ duration: 'quarter', notes: [createAccNote({ row: 2, step: 'A', octave: 2 })] }),
      createChord({ duration: 'quarter', notes: [createAccNote({ row: 3, step: 'A' })] }),
      createChord({ duration: 'half', notes: [createAccNote({ row: 1, step: 'G', alter: 1, octave: 2 }), createAccNote({ row: 5, step: 'E' })] }),
    ], 'accordion-left')],
  });
  const accordion = createTrack({ name: 'Accordéon', abbreviation: 'Acc', staves: [accRight, accLeft] });

  const movement = createMovement({
    title: 'Morceau de test',
    masterbars,
    tempos: [createTempo({ measureId: b1, bpm: 96 })],
    tracks: [chordTrack, piano, guitar, drums, accordion], // the chord track is always the first track
    systemContainers: [
      createSystemContainer({ measureId: b1, kind: 'section', label: 'Couplet', category: 'verse' }),
      createSystemContainer({ measureId: b3, kind: 'symbol', symbol: 'coda' }),
    ],
    groups: [
      createGroup({
        startTrackId: piano.id,
        endTrackId: guitar.id,
        label: 'Harmonie',
        groups: [createGroup({ startTrackId: piano.id, endTrackId: piano.id, bracketStyle: 'normal' })],
      }),
    ],
    voltas: [
      createVolta({ measureId: b3, span: 1, numbers: [1] }),
      createVolta({ measureId: b4, span: 1, numbers: [2], open: true }),
    ],
    syncs: [
      createSync({
        source: { kind: 'file', ref: 'enregistrement.ogg' },
        anchors: [{ measureId: b1, timestamp: 0 }, { measureId: b2, timestamp: 2.5 }, { measureId: b4, timestamp: 7.4 }],
      }),
    ],
  });

  return createWork({
    title: 'Morceau de test',
    props: { [PID.COMPOSER]: 'J. E. L\'Hoste' },
    movements: [movement],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Œuvre de démonstration de la tranche 1 du moteur de rendu : trois pistes multi-portées (piano en grand staff,
// guitare score + tablature, accordéon main droite + main gauche), armure de La majeur, 4/4, barre double tous les
// 4 mesures, barre finale. Mini-langage : « A4/4 » = la noire (durée = dénominateur de la ronde, « . » = pointée),
// « r/4 » = silence, « C#5/8 », « Bb3/2. ». Événements d'accordéon : « bass/4 », « chord/4 », « both/2 ».

const DURATION_BY_DENOMINATOR = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: 'sixteenth' };

function parseDuration(code) {
  const dotted = code.endsWith('.');
  return { duration: DURATION_BY_DENOMINATOR[Number(dotted ? code.slice(0, -1) : code)], dots: dotted ? 1 : 0 };
}

function parseNote(text) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(text);
  if (!m) throw new Error(`Note invalide : ${text}`);
  return { step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) };
}

/** Portée score : « A4/4 r/8 C#5/8 … » → éléments de mesure. */
function scoreItems(text) {
  return text.trim().split(/\s+/).map((token) => {
    const [what, code] = token.split('/');
    const d = parseDuration(code);
    return what === 'r' ? createRest(d) : createNoteChord([parseNote(what)], d);
  });
}

// cordes à vide de la guitare standard (mi aigu → mi grave), en hauteurs MIDI
const OPEN_STRINGS = [64, 59, 55, 50, 45, 40];

/** Tablature : mêmes rythmes et hauteurs que la portée score, sur la 1re corde qui donne une frette de 0 à 12. */
function tabItems(text) {
  return text.trim().split(/\s+/).map((token) => {
    const [what, code] = token.split('/');
    const d = parseDuration(code);
    if (what === 'r') return createRest(d);
    const n = parseNote(what);
    const pitch = 12 * (n.octave + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[n.step] + n.alter;
    const string = OPEN_STRINGS.findIndex((open) => pitch >= open && pitch - open <= 12) + 1;
    return createChord({ ...d, notes: [createTabNote({ pitch, string })] });
  });
}

/**
 * Portée accordéon : « 2:A2/4 3:A/4 1:G#2+5:E/2 r/4 » → éléments de mesure. Chaque bouton s'écrit `rang:note` (rangs 1-2 : note réelle avec octave ;
 * rangs 3-6 : fondamentale sans octave), plusieurs boutons simultanés se joignent par « + ».
 */
export function accordionItems(text) {
  return text.trim().split(/\s+/).map((token) => {
    const [what, code] = token.split('/');
    const d = parseDuration(code);
    if (what === 'r') return createRest(d);
    const notes = what.split('+').map((b) => {
      const [row, name] = b.split(':');
      const r = Number(row);
      const n = parseNote(r <= 2 ? name : `${name}3`);
      return createAccNote({ row: r, step: n.step, alter: n.alter, octave: n.octave });
    });
    return createChord({ ...d, notes });
  });
}

const DEMO_CYCLE = {
  rightHand: ['A4/4 B4/4 C#5/4 D5/4', 'E5/8 D5/8 C#5/8 B4/8 A4/2', 'F#5/4. E5/8 D5/2', 'r/4 A4/4 C#5/4 E5/4'],
  leftHand: ['A2/2 E3/2', 'A2/4 E3/4 A2/4 E3/4', 'D3/2 A2/2', 'E3/1'],
  guitar: ['E4/4 F#4/4 G#4/4 A4/4', 'A4/2 E4/2', 'F#4/8 G#4/8 A4/8 G#4/8 F#4/8 E4/8 F#4/8 G#4/8', 'E4/1'],
  accordionRight: ['A4/2 C#5/2', 'E5/4 D5/4 C#5/2', 'B4/4 A4/4 B4/4 C#5/4', 'A4/1'],
  accordionLeft: ['2:A2/4 3:A/4 2:A2/4 3:A/4', '2:A2/2 3:A/2', '2:D3/4 3:D/4 3:D/4 3:D/4', '2:E3+5:E/1'],
};

/**
 * @param cycles  nombre de fois que le cycle de 4 mesures est répété (défaut 3 : 12 mesures)
 */
export function sampleArchitectureWork({ cycles = 3 } = {}) {
  resetIds();
  const total = cycles * 4;
  const masterbars = Array.from({ length: total }, (_, i) => createMasterbar({
    keySig: 3,
    barType: i === total - 1 ? 'final' : (i + 1) % 4 === 0 ? 'double' : 'simple',
  }));
  const voice = (key, toItems) => createVoice(
    Array.from({ length: total }, (_, i) => createMeasure(toItems(DEMO_CYCLE[key][i % 4])))
  );

  const piano = createTrack({
    name: 'Piano', abbreviation: 'Pno',
    staves: [
      createStaff({ clef: 'G', voices: [voice('rightHand', scoreItems)] }),
      createStaff({ clef: 'F', voices: [voice('leftHand', scoreItems)] }),
    ],
  });
  const guitar = createTrack({
    name: 'Guitare', abbreviation: 'Gt',
    staves: [
      createStaff({ voices: [voice('guitar', scoreItems)] }),
      createStaff({ type: 'tab', voices: [voice('guitar', tabItems)] }),
    ],
  });
  const accordion = createTrack({
    name: 'Accordéon', abbreviation: 'Acc',
    staves: [
      createStaff({ voices: [voice('accordionRight', scoreItems)] }),
      createStaff({ type: 'accordion-left', voices: [voice('accordionLeft', accordionItems)] }),
    ],
  });
  const movement = createMovement({ title: 'Architecture', masterbars, tracks: [piano, guitar, accordion] });
  return createWork({ title: 'Architecture du moteur — tranche 1', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Démonstration de la main gauche d'accordéon (tranche 6) : 3 portées — boutons au-dessus (défaut), en dessous, et plus près de la portée.

const ACCORDION_DEMO = [
  '2:C3/4 3:C/4 2:G2/4 3:C/4',
  '2:G2/4 5:G/4 2:G2/4 4:G/4',
  '2:F2/4 3:F+5:F/4 2:C3/4 3:F+4:A/4',
  '2:Bb2/4 3:Bb/4 2:F2/4 6:F#/4',
  '1:E2/4 3:C/4 1:G2/4 4:C/4',
  '2:C3/8 2:G2/8 3:C/4 2:C3/2',
  '2:F#2/4 3:F#/4 2:Eb3/4 4:Eb/4',
  '2:C3/2 3:C/2',
];

export function sampleAccordionWork() {
  resetIds();
  const total = ACCORDION_DEMO.length;
  const masterbars = Array.from({ length: total }, (_, i) => createMasterbar({ keySig: 0, barType: i === total - 1 ? 'final' : 'simple' }));
  const staff = (props = {}) => createStaff({
    type: 'accordion-left', props,
    voices: [createVoice(ACCORDION_DEMO.map((t) => createMeasure(accordionItems(t))))],
  });
  const track = createTrack({
    name: 'Accordéon', abbreviation: 'Acc',
    staves: [
      staff(),
      staff({ [PID.ACCORDION_LAYOUT]: { buttonPlacement: 'below', buttonOffset: 1.2 } }),
      staff({ [PID.ACCORDION_LAYOUT]: { buttonPlacement: 'above', buttonOffset: 1.2 } }),
    ],
  });
  const movement = createMovement({ title: 'Accordéon', masterbars, tracks: [track] });
  return createWork({ title: 'Accordéon — tranche 6', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Œuvre de démonstration de la tablature (tranche 4b) : la même guitare en trois réglages — Full (défaut de Scorsaire), Common et
// Simple — avec points, triolets, parenthèses, note fantôme, ligature à travers un silence, deux voix, blanche barrée.
// Une note = [corde, frette, propriétés] ; la portée score en dessous est dérivée de la tablature (hauteur + 12, une octave plus haut).

const SHARP_SPELLING = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const spellPitch = (pitch) => ({ step: SHARP_SPELLING[pitch % 12][0], alter: SHARP_SPELLING[pitch % 12][1], octave: Math.floor(pitch / 12) - 1 });

/** d : durée ; dots ; n : notes [[corde, frette, props?]] (absent = silence) ; t : id de triolet ; through : silence ligaturé. */
let showcaseTupletCounter = 0;
function showcaseItems(spec, kind) {
  const tuplets = new Map(); // identifiants de n-olet uniques dans tout le mouvement : un groupe n'existe que dans une mesure
  return spec.map((s) => {
    const props = {};
    if (s.t) {
      if (!tuplets.has(s.t)) tuplets.set(s.t, { id: `${s.t}${++showcaseTupletCounter}`, ratio: [3, 2], base: { base: 'eighth', dots: 0 } });
      props[PID.TUPLET] = tuplets.get(s.t);
    }
    if (!s.n) return createRest({ duration: s.d, dots: s.dots ?? 0, props: { ...props, ...(s.through ? { [PID.BEAM_THROUGH]: true } : {}) } });
    const notes = s.n.map(([string, fret, p = {}]) => (kind === 'tab'
      ? createTabNote({ pitch: OPEN_STRINGS[string - 1] + fret, string, props: p })
      : createNote({ ...spellPitch(OPEN_STRINGS[string - 1] + fret + 12), props: p })));
    return createChord({ duration: s.d, dots: s.dots ?? 0, notes, props });
  });
}

const PAR = { [PID.PARENTHESES]: true };
const GHOST = { [PID.GHOST]: true };
const SHOWCASE = [
  // 1 : noire pointée + croche (points), blanche pointée... accords, note entre parenthèses, note fantôme
  { v1: [{ d: 'quarter', dots: 1, n: [[3, 0]] }, { d: 'eighth', n: [[2, 1]] }, { d: 'quarter', n: [[2, 3, PAR]] }, { d: 'quarter', n: [[1, 0], [3, 2]] }] },
  // 2 : deux triolets de croches, une noire, une noire fantôme
  { v1: [
    { d: 'eighth', t: 'a', n: [[2, 0]] }, { d: 'eighth', t: 'a', n: [[2, 1]] }, { d: 'eighth', t: 'a', n: [[2, 3]] },
    { d: 'eighth', t: 'b', n: [[3, 0]] }, { d: 'eighth', t: 'b', n: [[3, 2]] }, { d: 'eighth', t: 'b', n: [[3, 0]] },
    { d: 'quarter', n: [[1, 0]] }, { d: 'quarter', n: [[2, 3, GHOST]] }] },
  // 3 : ligatures à travers un silence (croches puis doubles)
  { v1: [
    { d: 'eighth', n: [[2, 0]] }, { d: 'eighth', through: true }, { d: 'eighth', n: [[2, 3]] }, { d: 'eighth', n: [[2, 1]] },
    { d: 'sixteenth', n: [[3, 0]] }, { d: 'sixteenth', through: true }, { d: 'sixteenth', n: [[3, 2]] }, { d: 'sixteenth', n: [[3, 0]] },
    { d: 'quarter', n: [[1, 0]] }] },
  // 4 : deux voix (hampes en haut pour la voix 1, en bas pour la voix 2, blanche barrée en Full)
  {
    v1: [{ d: 'eighth', n: [[1, 0]] }, { d: 'eighth', n: [[2, 3]] }, { d: 'quarter', n: [[1, 1]] }, { d: 'quarter', n: [[1, 0]] }, { d: 'quarter', n: [[1, 3]] }],
    v2: [{ d: 'quarter', n: [[4, 0]] }, { d: 'half', n: [[4, 3]] }, { d: 'eighth', n: [[2, 3]] }, { d: 'eighth', n: [[2, 0]] }],
  },
];

/** Le même contenu en trois tablatures (Full, Common, Simple), plus la portée score pour la première guitare. */
export function sampleTablatureWork() {
  resetIds();
  const masterbars = SHOWCASE.map((_, i) => createMasterbar({ barType: i === SHOWCASE.length - 1 ? 'final' : 'simple' }));
  const voicesOf = (kind) => {
    const voices = [createVoice(SHOWCASE.map((m) => createMeasure(showcaseItems(m.v1, kind))))];
    if (SHOWCASE.some((m) => m.v2)) {
      voices.push(createVoice(SHOWCASE.map((m) => createMeasure(m.v2
        ? showcaseItems(m.v2, kind)
        // voix 2 absente de cette mesure (permis : seule la voix 1 doit remplir la mesure)
        : []))));
    }
    return voices;
  };
  const tab = (style) => createStaff({ type: 'tab', props: { [PID.TAB_STYLE]: style }, voices: voicesOf('tab') });
  const tracks = [
    createTrack({ name: 'Guitare — Full', abbreviation: 'Full', staves: [createStaff({ voices: voicesOf('score') }), tab('full')] }),
    createTrack({ name: 'Common', abbreviation: 'Com', staves: [tab('common')] }),
    createTrack({ name: 'Simple', abbreviation: 'Sim', staves: [tab('simple')] }),
  ];
  const movement = createMovement({ title: 'Tablature', masterbars, tracks });
  return createWork({ title: 'Tablature — tranche 4b', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Œuvre de démonstration de la tranche 4c : les marques de la tranche 3 en tablature (Full, Common, Simple), une famille par mesure —
// liaisons de prolongation et d'expression, glissandos (droit et ondulé), articulations et point d'orgue, nuances et soufflet,
// trémolos sur une note, notes d'ornement (acciaccature, deux croches ligaturées, trois doubles croches).

/** Une portée de tablature « marques » : fabrique de nouveaux accords à chaque appel (les identifiants sont ceux de CE réglage). */
function marksStaff(style) {
  const tab = (string, fret) => createTabNote({ pitch: OPEN_STRINGS[string - 1] + fret, string });
  const chord = (duration, notes, props = {}, graceNotes = []) => createChord({ duration, notes: notes.map(([s, f]) => tab(s, f)), props, graceNotes });
  const grace = (type, string, fret) => createChord({ duration: GRACE_TYPES[type].duration, notes: [tab(string, fret)], props: { [PID.GRACE_TYPE]: type } });
  const art = (...types) => ({ [PID.ARTICULATIONS]: types.map((t) => createArticulation(t)) });
  const ties = []; const slurs = []; const glissandos = []; const hairpins = [];

  // 1 : liaison de prolongation (corde 3, frette 5) puis liaison d'expression (cordes 2)
  const t1 = chord('quarter', [[3, 5]]); const t2 = chord('quarter', [[3, 5]]);
  const s1 = chord('quarter', [[2, 3]]); const s2 = chord('quarter', [[2, 5]]);
  ties.push(createTie(t1.notes[0].id, t2.notes[0].id)); slurs.push(createSlur(s1.id, s2.id));
  // 2 : glissando droit puis glissando ondulé
  const g1 = chord('quarter', [[3, 2]]); const g2 = chord('quarter', [[3, 7]]);
  const w1 = chord('quarter', [[4, 2]]); const w2 = chord('quarter', [[4, 5]]);
  glissandos.push(createGlissando(g1.notes[0].id, g2.notes[0].id), createGlissando(w1.notes[0].id, w2.notes[0].id, { glissandoType: 'wavy' }));
  // 3 : staccato + accent, tenuto, marcato, point d'orgue
  const a1 = chord('quarter', [[3, 0]], art('staccato', 'accent')); const a2 = chord('quarter', [[2, 1]], art('tenuto'));
  const a3 = chord('quarter', [[1, 0]], art('marcato')); const a4 = chord('quarter', [[3, 2]], art('fermata'));
  // 4 : nuances p … f et soufflet crescendo
  const d1 = chord('quarter', [[3, 0]], { [PID.DYNAMIC]: 'p' }); const d2 = chord('quarter', [[3, 2]]);
  const d3 = chord('quarter', [[3, 3]]); const d4 = chord('quarter', [[3, 5]], { [PID.DYNAMIC]: 'f' });
  hairpins.push(createHairpin(d1.id, d4.id, 'cresc'));
  // 5 : trémolos sur une note — trois barres sur une blanche, deux sur une noire, une sur une croche
  const r1 = chord('half', [[3, 0]], { [PID.TREMOLO]: { strokes: 3 } }); const r2 = chord('quarter', [[4, 2]], { [PID.TREMOLO]: { strokes: 2 } });
  const r3 = chord('eighth', [[2, 3]], { [PID.TREMOLO]: { strokes: 1 } }); const r4 = chord('eighth', [[2, 5]]);
  // 6 : notes d'ornement
  const o1 = chord('quarter', [[2, 3]], {}, [grace('acciaccatura', 2, 1)]);
  const o2 = chord('quarter', [[4, 2]], {}, [grace('appoggiatura', 4, 0), grace('appoggiatura', 4, 2)]);
  const o3 = chord('quarter', [[3, 5]], {}, [grace('grace16', 3, 2), grace('grace16', 2, 1), grace('grace16', 4, 0)]);
  const o4 = chord('quarter', [[3, 0]]);

  const measures = [
    [t1, t2, s1, s2], [g1, g2, w1, w2], [a1, a2, a3, a4], [d1, d2, d3, d4], [r1, r2, r3, r4], [o1, o2, o3, o4],
  ].map((items) => createMeasure(items));
  return createStaff({
    type: 'tab',
    props: { [PID.TAB_STYLE]: style, [PID.TIES]: ties, [PID.SLURS]: slurs, [PID.GLISSANDOS]: glissandos, [PID.HAIRPINS]: hairpins },
    voices: [createVoice(measures)],
  });
}

/** Les marques de la tranche 3 en tablature, dans les trois préréglages. */
export function sampleTablatureMarksWork() {
  resetIds();
  const masterbars = Array.from({ length: 6 }, (_, i) => createMasterbar({ barType: i === 5 ? 'final' : 'simple' }));
  const track = (name, abbreviation, style) => createTrack({ name, abbreviation, staves: [marksStaff(style)] });
  const movement = createMovement({
    title: 'Marques en tablature',
    masterbars,
    tracks: [track('Guitare — Full', 'Full', 'full'), track('Common', 'Com', 'common'), track('Simple', 'Sim', 'simple')],
  });
  return createWork({ title: 'Tablature — tranche 4c', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Tablature : techniques de jeu (tranche 4d), une famille par mesure, trois préréglages (Full / Common / Simple).
// 4d-a : 1 marteau (H) puis arraché (P) ; 2 chaîne de trois accords ; 3-5 slides (fall, doit, plop, scoop) droites, courbes, ondulées.
function techniquesStaff(style) {
  const tab = (string, fret) => createTabNote({ pitch: OPEN_STRINGS[string - 1] + fret, string });
  const chord = (notes, props = {}, duration = 'quarter') => createChord({ duration, notes: notes.map(([s, f]) => tab(s, f)), props });
  const hopos = [];
  const m1 = [chord([[3, 2]]), chord([[3, 5]]), chord([[2, 5]]), chord([[2, 3]])];
  hopos.push(createHopo(m1[0].id, m1[1].id), createHopo(m1[2].id, m1[3].id));
  const m2 = [chord([[1, 2]]), chord([[1, 5]]), chord([[1, 3]]), chord([[3, 0]])];
  hopos.push(createHopo(m2[0].id, m2[2].id));
  const line = (opts) => ['fall', 'doit', 'plop', 'scoop'].map((type, i) => chord([[2 + (i % 2), 3]], { [PID.CHORD_LINE]: createChordLine(type, opts) }));
  const m3 = line({ straight: true }); const m4 = line({}); const m5 = line({ wavy: true });
  // 4d-b : 6 bend standard (1 ton), puis bend & release ; 7 bend d'un ton et demi, slight bend, bend de demi-ton
  const bends = [];
  const m6 = [chord([[2, 5]]), chord([[2, 7]]), chord([[3, 7]]), chord([[3, 7]])];
  bends.push(createBend('bend', m6[0].notes[0].id, m6[1].notes[0].id), createBend('slightBend', m6[2].notes[0].id, m6[3].notes[0].id));
  const m7 = [chord([[2, 5]]), chord([[2, 7]]), chord([[2, 5]]), chord([[1, 0]])];
  bends.push(createBend('bend', m7[0].notes[0].id, m7[1].notes[0].id), createBend('bend', m7[1].notes[0].id, m7[2].notes[0].id));
  // 8 : pre-bend (ornement 5 → principale 7) puis pre-bend & release ; 9 : grace-note bend, puis bend avec maintien (hold) vers une note
  const gtab = (string, fret) => createChord({ duration: 'eighth', notes: [tab(string, fret)], props: { [PID.GRACE_TYPE]: 'appoggiatura' } });
  const withGrace = (string, fret, g) => createChord({ duration: 'quarter', notes: [tab(string, fret)], graceNotes: [g] });
  const g8a = gtab(2, 5); const m8a = withGrace(2, 7, g8a);
  const g8b = gtab(3, 5); const m8b = withGrace(3, 7, g8b);
  const m8 = [m8a, chord([[2, 5]]), m8b, chord([[3, 5]])];
  bends.push(createBend('preBend', g8a.notes[0].id, m8a.notes[0].id), createBend('preBend', g8b.notes[0].id, m8b.notes[0].id),
    createBend('bend', m8b.notes[0].id, m8[3].notes[0].id));
  const g9 = gtab(2, 5); const m9a = withGrace(2, 7, g9);
  const m9 = [m9a, chord([[2, 7]]), chord([[1, 0]]), chord([[1, 0]])];
  bends.push(createBend('graceNoteBend', g9.notes[0].id, m9a.notes[0].id));
  // 10 : dive (−1) puis retour complet ; 11 : dip puis scoop ; 12 : pre-dive (ornement 7 → principale 5), puis dive vers le haut
  const m10 = [chord([[1, 5]]), chord([[1, 3]]), chord([[1, 5]]), chord([[2, 0]])];
  bends.push(createBend('dive', m10[0].notes[0].id, m10[1].notes[0].id), createBend('dive', m10[1].notes[0].id, m10[2].notes[0].id));
  const m11 = [chord([[1, 5]]), chord([[2, 3]]), chord([[1, 5]]), chord([[2, 0]])];
  bends.push(createBend('dip', m11[0].notes[0].id, m11[0].notes[0].id, { dipVibrato: true }), createBend('scoop', m11[2].notes[0].id));
  const g12 = gtab(1, 7); const m12a = withGrace(1, 5, g12);
  const m12 = [m12a, chord([[2, 0]]), chord([[1, 5]]), chord([[1, 7]])];
  bends.push(createBend('preDive', g12.notes[0].id, m12a.notes[0].id), createBend('dive', m12[2].notes[0].id, m12[3].notes[0].id));
  // 4d-c : 13 palm mute (1-3) puis let ring (4) ; 14 vibratos (guitare, large, dents de scie, dents de scie large) ; 15 marques d'harmonique (dessus) + barre de whammy (dessous) ;
  // 16-17 palm mute et let ring qui se chevauchent sur deux mesures (rangés l'un sous l'autre)
  const tech = [];
  const m13 = [chord([[3, 0]]), chord([[3, 0]]), chord([[3, 0]]), chord([[2, 3]])];
  tech.push(createTechLine('palmMute', m13[0].id, m13[2].id), createTechLine('letRing', m13[3].id, m13[3].id));
  const m14 = [chord([[2, 5]]), chord([[2, 7]]), chord([[2, 5]]), chord([[2, 3]])];
  ['guitarVibrato', 'guitarVibratoWide', 'sawtooth', 'sawtoothWide'].forEach((vibratoType, i) => tech.push(createTechLine('vibrato', m14[i].id, m14[i].id, { vibratoType })));
  // harmoniques : propriétés de NOTE (naturel « <12> », artificiel « 5 <17> »)
  const harm = (string, fret, display, hf) => createChord({ duration: 'quarter', notes: [createTabNote({ pitch: OPEN_STRINGS[string - 1] + fret, string, props: { [PID.HARMONIC]: true, [PID.DISPLAY_FRET]: display, [PID.HARMONIC_FRET]: hf } })] });
  const m15 = [harm(1, 12, 'natural', 12), harm(1, 12, 'natural', 12), harm(2, 5, 'artificial', 17), harm(2, 5, 'artificial', 17)];
  tech.push(createTechLine('harmonicMark', m15[0].id, m15[1].id, { text: 'N.H.' }), createTechLine('harmonicMark', m15[2].id, m15[3].id, { text: 'A.H.' }),
    createTechLine('whammyBar', m15[0].id, m15[3].id));
  const m16 = [chord([[3, 0]]), chord([[3, 2]]), chord([[3, 0]]), chord([[3, 2]])];
  const m17 = [chord([[3, 0]]), chord([[3, 2]]), chord([[3, 0]]), chord([[3, 2]])];
  tech.push(createTechLine('palmMute', m16[0].id, m17[1].id), createTechLine('letRing', m16[2].id, m17[3].id));
  // 4d-d : 18 golpe, golpe pouce, slap, pop (articulations : « non vérifié sur export », portées depuis les sources) ; 19 tapping main gauche (une note, accord de 2 notes) ;
  // 20 tapping main droite ; 21 arpèges (normal, vers le haut, vers le bas, crochet), 22 arpèges droits (vers le haut / vers le bas) sur accords de 3-4 notes
  const art = (type, notes) => chord(notes, { [PID.ARTICULATIONS]: [createArticulation(type)] });
  const m18 = [art('golpe', [[3, 0]]), art('golpeThumb', [[3, 2]]), art('slap', [[4, 0]]), art('pop', [[1, 2]])];
  const tap = (hand, notes) => chord(notes, { [PID.TAPPING]: { hand } });
  const m19 = [tap('left', [[2, 5]]), tap('left', [[3, 7], [2, 5]]), tap('left', [[1, 8]]), tap('left', [[4, 7], [3, 7], [1, 5]])];
  const m20 = [tap('right', [[2, 12]]), tap('right', [[2, 12], [1, 12]]), tap('right', [[3, 12]]), tap('right', [[1, 12]])];
  const arp = (type) => chord([[4, 2], [3, 2], [2, 1], [1, 0]], { [PID.ARPEGGIO]: { type } });
  const m21 = ['normal', 'up', 'down', 'bracket'].map(arp);
  const m22 = ['upStraight', 'downStraight'].flatMap((t) => [arp(t), chord([[3, 0]])]);
  const measures = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22].map((items) => createMeasure(items));
  return createStaff({ type: 'tab', props: { [PID.TAB_STYLE]: style, [PID.HOPOS]: hopos, [PID.BENDS]: bends, [PID.TECH_LINES]: tech }, voices: [createVoice(measures)] });
}

export function sampleTablatureTechniquesWork() {
  resetIds();
  const masterbars = Array.from({ length: 22 }, (_, i) => createMasterbar({ barType: i === 21 ? 'final' : 'simple' }));
  const track = (name, abbreviation, style) => createTrack({ name, abbreviation, staves: [techniquesStaff(style)] });
  const movement = createMovement({
    title: 'Techniques de jeu en tablature', masterbars,
    tracks: [track('Guitare — Full', 'Full', 'full'), track('Common', 'Com', 'common'), track('Simple', 'Sim', 'simple')],
  });
  return createWork({ title: 'Tablature — tranche 4d', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Démonstration de vérification visuelle (03/10/2026) : les cas vérifiés avec les exports de Jean, vus « pour un humain ».
// Mesure 1 (3/4) : trémolo à deux notes inséré dans une ligature + accent/staccato ; 2 : liaisons à deux voix (noires) ;
// 3 : liaisons à deux voix (croches ligaturées) ; 4-5 : liaison d'une acciaccature puis d'une appoggiature vers leur note ;
// 6 : trois doubles croches d'ornement ligaturées (si4 : hampes en haut ; do6 : hampes forcées en bas — voir la portée score).
function verificationTab(style) {
  const tab = (string, fret = 0) => createTabNote({ pitch: OPEN_STRINGS[string - 1] + fret, string });
  const c = (strings, duration, extra = {}) => createChord({ duration, notes: [].concat(strings).map((x) => tab(x)), ...extra });
  const R = (duration) => createRest({ duration });
  const art = (...types) => ({ props: { [PID.ARTICULATIONS]: types.map((t) => createArticulation(t)) } });
  // 1
  const ta = c(3, 'sixteenth', art('accent', 'staccato')), tb = c(3, 'sixteenth', art('staccato', 'accent'));
  const m1 = createMeasure([ta, tb, R('sixteenth'), R('sixteenth'), R('half')]);
  // 2
  const q1 = [1, 3, 2, 1].map((x) => c(x, 'quarter')), q2 = [6, 5, 6, 4].map((x) => c(x, 'quarter'));
  // 3
  const e1 = [1, 3, 2, 1].map((x) => c(x, 'eighth')), e2 = [6, 5, 6, 4].map((x) => c(x, 'eighth'));
  const rest2 = (n) => Array.from({ length: n }, () => R('half'));
  // 4-5
  const grace = (type) => createChord({ duration: GRACE_TYPES[type].duration, notes: [tab(2)], props: { [PID.GRACE_TYPE]: type } });
  const g1 = grace('acciaccatura'), g2 = grace('appoggiatura');
  const n1 = createChord({ duration: 'quarter', notes: [tab(3)], graceNotes: [g1] });
  const n2 = createChord({ duration: 'quarter', notes: [tab(3)], graceNotes: [g2] });
  const m4 = createMeasure([n1, R('quarter'), R('half')]), m5 = createMeasure([n2, R('quarter'), R('half')]);
  // 6 : mesure vide (silence de mesure)
  const voice1 = createVoice([m1, createMeasure([...q1, ]), createMeasure([...e1, ...rest2(1)]), m4, m5, createEmptyMeasure('tab')]);
  const voice2 = createVoice([createMeasure([]), createMeasure(q2), createMeasure([...e2, ...rest2(1)]), createMeasure([]), createMeasure([]), createMeasure([])]);
  return createStaff({
    type: 'tab',
    props: {
      [PID.TAB_STYLE]: style,
      [PID.TREMOLOS]: [createTwoChordTremolo(ta.id, tb.id, 2)],
      [PID.SLURS]: [
        createSlur(q1[0].id, q1[3].id), createSlur(q2[0].id, q2[3].id),
        createSlur(e1[0].id, e1[3].id), createSlur(e2[0].id, e2[3].id),
        createSlur(g1.id, n1.id), createSlur(g2.id, n2.id),
      ],
    },
    voices: [voice1, voice2],
  });
}

/** Portée score : groupes de trois doubles croches d'ornement ligaturées (si4 par défaut, do6 aux hampes forcées en bas). */
function verificationScore() {
  const n = (step, octave) => ({ step, octave });
  const Q = () => createNoteChord([n('C', 5)], { duration: 'quarter' });
  const main = (step, octave, forceDown) => createNoteChord([n(step, octave)], {
    duration: 'quarter',
    graceNotes: [1, 2, 3].map(() => createGraceNote('grace16', [n(step, octave)], forceDown ? { props: { [PID.STEM_DIRECTION]: 'down' } } : {})),
  });
  return createStaff({
    voices: [createVoice([
      createMeasure([createRest({ duration: 'half' }), createRest({ duration: 'quarter' })]),
      createEmptyMeasure('score'), createEmptyMeasure('score'), createEmptyMeasure('score'),
      createMeasure([main('B', 4, false), Q(), Q(), Q()]), createMeasure([main('C', 6, true), Q(), Q(), Q()]),
    ])],
  });
}

/** Les cas vérifiés le 03/10/2026, en Full / Common / Simple, plus la portée score des ornements ligaturés. */
export function sampleVerificationWork() {
  resetIds();
  const masterbars = [createMasterbar({ timeSig: [3, 4] }), ...Array.from({ length: 5 }, (_, i) => createMasterbar({ barType: i === 4 ? 'final' : 'simple' }))];
  const movement = createMovement({
    title: 'Vérification visuelle',
    masterbars,
    tracks: [
      createTrack({ name: 'Guitare — Full', abbreviation: 'Full', staves: [verificationScore(), verificationTab('full')] }),
      createTrack({ name: 'Common', abbreviation: 'Com', staves: [verificationTab('common')] }),
      createTrack({ name: 'Simple', abbreviation: 'Sim', staves: [verificationTab('simple')] }),
    ],
  });
  return createWork({ title: 'Vérification visuelle', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Démonstration « techniques de jeu sur portée score » (04/10/2026, passe d'affichage score de la tranche 4d).
// Mesure 1 : tapping main droite (+) ; 2 : tapping main gauche (demi-liaisons) ; 3 : mêmes accords avec hampes vers le bas.
function techniquesScoreStaff() {
  const n = (step, octave) => ({ step, octave });
  const tap = (hand, notes, duration = 'quarter') => createNoteChord(notes, { duration, props: { [PID.TAPPING]: { hand } } });
  const m1 = createMeasure([tap('right', [n('E', 5)]), tap('right', [n('A', 4)]), tap('right', [n('C', 6)]), tap('right', [n('G', 4), n('B', 4)])]);
  const m2 = createMeasure([tap('left', [n('E', 5)]), tap('left', [n('A', 4)]), tap('left', [n('C', 6)]), tap('left', [n('G', 4), n('B', 4)])]);
  const m3 = createMeasure([tap('left', [n('B', 4)]), tap('left', [n('D', 5)]), tap('left', [n('F', 4)]), tap('right', [n('A', 3)])]);
  // 4-5 : arpèges (6 types) sur accords sans / avec altération / avec lignes supplémentaires
  const arp = (type, notes, duration = 'quarter') => createNoteChord(notes, { duration, props: { [PID.ARPEGGIO]: { type } } });
  const types = ['normal', 'up', 'down', 'upStraight', 'downStraight', 'bracket'];
  const triad = [n('C', 4), n('E', 4), n('G', 4)];
  const m4 = createMeasure(types.slice(0, 4).map((t) => arp(t, triad)));
  const m5 = createMeasure(types.slice(2, 6).map((t) => arp(t, [n('C', 4), n('E', 4), n('G', 4)])));
  const sharp = (st, o) => ({ step: st, octave: o, alter: 1 });
  const m6 = createMeasure(types.slice(0, 4).map((t) => arp(t, [n('C', 4), sharp('E', 4), n('G', 4), sharp('C', 5)])));
  const m7 = createMeasure(types.slice(2, 6).map((t) => arp(t, [n('A', 3), n('C', 5), n('E', 5), n('A', 5)])));
  const m8 = createMeasure(types.slice(0, 4).map((t) => arp(t, [n('D', 5), n('F', 5), n('A', 5)])));
  // 9-10 : slides (fall, doit, plop, scoop ; droits / courbes / ondulés)
  const cline = (type, extra, notes, duration = 'quarter') => createNoteChord(notes, { duration, props: { [PID.CHORD_LINE]: { type, ...extra } } });
  const m9 = createMeasure(['fall', 'doit', 'plop', 'scoop'].map((t) => cline(t, {}, [n('E', 5)])));
  const m10 = createMeasure(['fall', 'doit', 'plop', 'scoop'].map((t) => cline(t, { straight: true }, [n('G', 4), n('B', 4)])));
  const m11 = createMeasure(['fall', 'doit', 'plop', 'scoop'].map((t) => cline(t, { wavy: true }, [n('D', 5)])));
  // 12-14 : points d'augmentation (ligne / interligne, accords, croche pointée à crochet, silences pointés)
  const dn = (notes, duration, dots = 0) => createNoteChord(notes, { duration, dots });
  const dr = (duration, dots = 0) => createRest({ duration, dots });
  const m12 = createMeasure([dn([n('E', 4)], 'quarter', 1), dn([n('F', 4)], 'eighth'), dn([n('C', 4), n('E', 4), n('G', 4)], 'quarter', 1), dn([n('B', 4)], 'eighth')]);
  const m13 = createMeasure([dn([n('E', 4), n('F', 4)], 'quarter', 1), dn([n('A', 4)], 'eighth'), dn([n('G', 5)], 'eighth', 1), dn([n('G', 5)], 'sixteenth'), dn([n('C', 5)], 'quarter')]);
  const m14 = createMeasure([dr('quarter', 1), dr('eighth'), dr('eighth', 1), dr('sixteenth'), dr('quarter')]);
  // 15-16 : marteaux / arrachés (hammer-on H, pull-off P, chaîne de trois, accord montant puis descendant)
  const q = (notes) => dn(notes, 'quarter');
  const c15 = [q([n('E', 4)]), q([n('G', 4)]), q([n('B', 4)]), q([n('A', 4)])];
  const c16 = [q([n('C', 5)]), q([n('E', 5)]), q([n('D', 5)]), q([n('G', 4), n('B', 4)])];
  const hopos = [createHopo(c15[0].id, c15[1].id), createHopo(c15[2].id, c15[3].id), createHopo(c16[0].id, c16[2].id)];
  const m15 = createMeasure(c15); const m16 = createMeasure(c16);
  // 17-18 : lignes techniques (palm mute, let ring ; marque d'harmonique, whammy, vibrato)
  const c17 = [q([n('E', 4)]), q([n('G', 4)]), q([n('B', 4)]), q([n('E', 5)])];
  const c18 = [q([n('A', 4)]), q([n('C', 5)]), q([n('E', 5)]), q([n('G', 5)])];
  const m17 = createMeasure(c17); const m18 = createMeasure(c18);
  // 19-20 : harmoniques (losange) et notes étouffées (croix) : noires, blanches, ronde, accord mixte
  const hn = (step, octave, flag) => ({ step, octave, props: { [flag]: true } });
  // 21-23 : bends sur portée (bend, slight, release, pre-bend, grace-note bend, dip, scoop, dive, accord à plusieurs notes)
  const gb = (step, octave) => createGraceNote('appoggiatura', [n(step, octave)]);
  const c21 = [q([n('G', 4)]), q([n('A', 4)]), q([n('B', 4)]), q([n('B', 4)])];
  const g22a = gb('G', 4); const g22b = gb('A', 4);
  const c22 = [q([n('B', 4)]), q([n('G', 4)]), dn([n('A', 4)], 'quarter'), dn([n('B', 4)], 'quarter')];
  c22[2].graceNotes = [g22a]; c22[3].graceNotes = [g22b];
  const c23 = [dn([n('E', 5)], 'half'), q([n('E', 5)]), q([n('C', 5)])]; // dip avec vibrato sur une blanche (place pour la ligne de maintien)
  const c24 = [q([n('G', 4), n('B', 4), n('D', 5)]), q([n('G', 4), n('C', 5), n('D', 5)]), q([n('E', 4)]), q([n('E', 5)])];
  const bends = [
    createBend('bend', c21[0].notes[0].id, c21[1].notes[0].id), createBend('slightBend', c21[2].notes[0].id), createBend('bend', c22[0].notes[0].id, c22[1].notes[0].id),
    createBend('preBend', g22a.notes[0].id, c22[2].notes[0].id), createBend('graceNoteBend', g22b.notes[0].id, c22[3].notes[0].id),
    createBend('dip', c23[0].notes[0].id, c23[0].notes[0].id, { dipVibrato: true }), createBend('scoop', c23[1].notes[0].id), createBend('dive', c23[1].notes[0].id, c23[2].notes[0].id),
    createBend('bend', c24[0].notes[1].id, c24[1].notes[1].id),
  ];
  const m21 = createMeasure(c21); const m22 = createMeasure(c22); const m23 = createMeasure(c23); const m24 = createMeasure(c24);
  const m19 = createMeasure([q([hn('E', 5, PID.HARMONIC)]), q([hn('B', 4, PID.MUTED)]), q([n('G', 4), hn('B', 4, PID.HARMONIC)]), q([hn('D', 5, PID.MUTED), n('A', 4)])]);
  const m20 = createMeasure([dn([hn('A', 4, PID.HARMONIC)], 'half'), dn([hn('C', 5, PID.MUTED)], 'half')]);
  const tech = [
    createTechLine('palmMute', c17[0].id, c17[1].id), createTechLine('letRing', c17[2].id, c18[0].id),
    createTechLine('harmonicMark', c18[0].id, c18[2].id, { text: 'N.H.' }), createTechLine('whammyBar', c18[1].id, c18[3].id),
    createTechLine('vibrato', c18[2].id, c18[3].id),
  ];
  return createStaff({ props: { [PID.HOPOS]: hopos, [PID.TECH_LINES]: tech, [PID.BENDS]: bends }, voices: [createVoice([m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22, m23, m24])] });
}

export function sampleScoreTechniquesWork() {
  resetIds();
  const masterbars = Array.from({ length: 24 }, (_, i) => createMasterbar({ barType: i === 23 ? 'final' : 'simple' }));
  const movement = createMovement({
    title: 'Techniques de jeu sur portée score', masterbars,
    tracks: [createTrack({ name: 'Guitare — score', abbreviation: 'Gt', staves: [techniquesScoreStaff()] })],
  });
  return createWork({ title: 'Score — tranche 4d', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Œuvre de démonstration de la tranche 4e (capo) : texte du capo (aucun capo → capo → partiel → playback) et texte d'accordage (StringTunings),
// sur une tablature en accordage standard et une en « drop D ». Les hauteurs sont STOCKÉES (frette = hauteur − corde à vide − capo en mode tablature).
function capoStaff({ tuning, preset = 'full' }) {
  const open = (tuning ?? ['E4', 'B3', 'G3', 'D3', 'A2', 'E2']).map(pitchFromName);
  const tab = (s, f, k) => createTabNote({ pitch: open[s - 1] + f + k, string: s });
  const chord = (k, ...notes) => createChord({ duration: 'quarter', notes: notes.map(([s, f]) => tab(s, f, k)) });
  const bar = (f1, f2, k) => [chord(k, [3, f1]), chord(k, [2, f2]), chord(k, [4, f1]), chord(k, [1, f2])];
  // m5 (mode « standard », capo 2) : hauteur stockée = hauteur écrite (frette + capo), donc les frettes affichées restent celles voulues
  const m = Array.from({ length: 6 }, (_, i) => bar(5 + i % 2, 6 + i % 3, i === 4 ? 2 : 0));
  const capos = [
    createCapo(m[0][0].id, { fret: 2, mode: 'tab' }),
    createCapo(m[1][0].id, { fret: 2, mode: 'tab', active: false }),
    createCapo(m[2][0].id, { fret: 3, mode: 'tab', ignoredStrings: [1, 6] }),
    createCapo(m[3][0].id, { fret: 5, mode: 'playback' }),
    createCapo(m[4][0].id, { fret: 2, mode: 'standard' }),
  ];
  const props = { [PID.TAB_STYLE]: preset, [PID.CAPOS]: capos };
  if (tuning) props[PID.TUNING] = tuning;
  const tunings = [createStringTunings(m[0][0].id), createStringTunings(m[5][0].id, { visibleStrings: [4, 5, 6] })];
  props[PID.STRING_TUNINGS] = tunings;
  return createStaff({ type: 'tab', props, voices: [createVoice(m.map((items) => createMeasure(items)))] });
}

export function sampleCapoWork() {
  resetIds();
  const masterbars = Array.from({ length: 6 }, (_, i) => createMasterbar({ barType: i === 5 ? 'final' : 'simple' }));
  const movement = createMovement({
    title: 'Capo et accordage',
    masterbars,
    tracks: [
      createTrack({ name: 'Guitare — standard', abbreviation: 'Std', staves: [capoStaff({})] }),
      createTrack({ name: 'Guitare — drop D', abbreviation: 'Drop', staves: [capoStaff({ tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'D2'] })] }),
    ],
  });
  return createWork({ title: 'Capo — tranche 4e', movements: [movement] });
}

/**
 * Percussion (tranche 5a) : portée à 5 lignes, percmap par défaut de Scorsaire (batterie). 1-2 : groove rock à deux voix ; 3-8 : un tour du kit (chaque son une fois,
 * toutes les têtes et lignes supplémentaires) ; 9 : charleston seul (voix 1, hampes en haut malgré l'absence de la voix 2) ; 10 : grosse caisse seule
 * (voix 2, silence de mesure en voix 1) ; 11 : notes fantômes (parenthèses) et flam ; 12 : roulement, accent ; 13 : triolets de toms ; 14 : sens de hampe
 * imposé (accord, ligature) ; 15 : doubles croches, crash + grosse caisse.
 */
export function samplePercussionWork() {
  resetIds();
  const hit = (sounds, duration = 'quarter', props = {}) => createChord({ duration, notes: sounds.map((id) => createPercNote({ sound: id })), props });
  const rest = (duration = 'quarter') => createRest({ duration });
  const tuplet = (id) => ({ id, ratio: [3, 2], base: { base: 'eighth', dots: 0 } });
  const eighths = (list) => list.map((sounds) => hit(sounds, 'eighth'));
  const hats = (snareBeats, extra = {}) => eighths(Array.from({ length: 8 }, (_, i) => (snareBeats.includes(i) ? ['closedHiHat', 'acousticSnare'] : [extra[i] ?? 'closedHiHat'])));
  const v1 = [];
  const v2 = [];
  const add = (a, b = null) => { v1.push(createMeasure(a)); v2.push(b ? createMeasure(b) : createEmptyMeasure('percussion')); };
  // 1-2 : groove
  add(hats([2, 6]), [hit(['bassDrum1']), rest(), hit(['bassDrum1']), rest()]);
  add(hats([2, 6], { 7: 'openHiHat' }), [hit(['bassDrum1'], 'eighth'), rest('eighth'), hit(['bassDrum1'], 'eighth'), hit(['bassDrum1'], 'eighth'), rest('half')]);
  // 3-8 : un tour du kit
  const tour = [...DEFAULT_PERCMAP.sounds.map((s) => s.id), 'closedHiHat'];
  for (let m = 0; m < 6; m++) add(tour.slice(m * 4, m * 4 + 4).map((id) => hit([id])));
  // 9 : charleston seul ; 10 : grosse caisse seule
  add(eighths(Array.from({ length: 8 }, () => ['closedHiHat'])));
  add([createRest({ duration: 'measure' })], [hit(['bassDrum1']), hit(['bassDrum1']), hit(['bassDrum1']), hit(['bassDrum1'])]);
  // 11 : fantômes et flam
  const ghost = (id) => createChord({ duration: 'eighth', notes: [createPercNote({ sound: id, props: { [PID.GHOST]: true } })] });
  const flam = hit(['acousticSnare']);
  flam.graceNotes = [createPercGraceNote('acciaccatura', ['acousticSnare'])];
  add([hit(['acousticSnare'], 'eighth'), ghost('acousticSnare'), ghost('acousticSnare'), hit(['acousticSnare'], 'eighth'), flam, hit(['acousticSnare'])]);
  // 12 : roulement (trémolo à 3 barres sur une blanche), accent
  const accent = hit(['acousticSnare']);
  accent.props[PID.ARTICULATIONS] = [createArticulation('accent')];
  add([hit(['acousticSnare'], 'half', { [PID.TREMOLO]: { strokes: 3 } }), accent, hit(['acousticSnare'])]);
  // 13 : triolets de toms
  const trip = (id, a, b, c) => [a, b, c].map((s) => hit([s], 'eighth', { [PID.TUPLET]: tuplet(id) }));
  add([...trip('t1', 'highTom', 'lowMidTom', 'lowTom'), ...trip('t2', 'highTom', 'lowMidTom', 'lowTom'), ...trip('t3', 'highTom', 'lowMidTom', 'lowFloorTom'), ...trip('t4', 'highTom', 'lowTom', 'lowFloorTom')]);
  // 14 : sens de hampe imposé (hampes vers le bas sur un groupe ligaturé et sur une noire), le reste automatique
  const down = { [PID.STEM_DIRECTION]: 'down' };
  add([
    ...['closedHiHat', 'closedHiHat'].map((id) => hit([id], 'eighth', down)),
    ...['closedHiHat', 'closedHiHat'].map((id) => hit([id], 'eighth')),
    hit(['acousticSnare'], 'quarter', down), hit(['acousticSnare']),
  ]);
  // 15 : doubles croches, crash + grosse caisse
  add([hit(['crashCymbal1', 'bassDrum1']), ...Array.from({ length: 4 }, () => hit(['acousticSnare'], 'sixteenth')), hit(['closedHiHat'], 'eighth'), hit(['acousticSnare'], 'eighth'), hit(['highTom'], 'eighth'), hit(['lowFloorTom'], 'eighth')]);
  const kit = createStaff({ type: 'percussion', clef: 'G', voices: [createVoice(v1), createVoice(v2)] });
  const masterbars = v1.map((_, i) => createMasterbar({ barType: i === v1.length - 1 ? 'final' : 'simple' }));
  const movement = createMovement({
    title: 'Percussion', masterbars,
    tracks: [createTrack({ name: 'Batterie', abbreviation: 'Bat', staves: [kit] })],
  });
  return createWork({ title: 'Percussion — tranche 5a', movements: [movement] });
}

/**
 * Percussion sur portées de 1, 2, 3 et 5 lignes (tranche 5b) : les MÊMES notes sur 4 portées d'un set de batterie, plus une portée de bongos
 * à 1 ligne (kit « Bongos » de MuseScore). Les positions sont celles de la percmap, comptées depuis la ligne du HAUT : les lignes
 * supplémentaires et les hampes dépendent seulement du nombre de lignes (export `perc_1a5_ligne_bongos.svg`).
 */
export function samplePercussionLinesWork() {
  resetIds();
  const hit = (sounds, duration = 'quarter') => createChord({ duration, notes: sounds.map((id) => createPercNote({ sound: id })) });
  const m1 = () => [hit(['lowMidTom', 'lowFloorTom']), hit(['closedHiHat']), hit(['splashCymbal']), hit(['chinaCymbal'])];
  const m2 = () => ['closedHiHat', 'closedHiHat', 'closedHiHat', 'closedHiHat', 'closedHiHat', 'closedHiHat', 'openHiHat', 'closedHiHat'].map((id) => hit([id], 'eighth'));
  // mesure 3 (12/10/2026) : articulations près de la tête sur têtes intérieures / extrêmes, pour juger les portées de moins de 5 lignes
  const hitA = (sound, arts, duration = 'quarter') => createChord({ duration, notes: [createPercNote({ sound })], props: { [PID.ARTICULATIONS]: arts.map((t) => createArticulation(t)) } });
  const m3 = () => [hitA('acousticSnare', ['staccato']), hitA('closedHiHat', ['tenuto']), hitA('acousticSnare', ['staccato', 'tenuto']), hitA('lowFloorTom', ['accent', 'staccato'])];
  const kitStaff = (lines) => createStaff({
    type: 'percussion', clef: 'G', props: { [PID.LINE_COUNT]: lines },
    voices: [createVoice([createMeasure(m1()), createMeasure(m2()), createMeasure(m3())])],
  });
  const bongoStaff = createStaff({
    type: 'percussion', clef: 'G', props: { [PID.LINE_COUNT]: 1, [PID.PERCMAP]: percMapFromKit('bongos') },
    voices: [createVoice([
      createMeasure([hit(['lowBongo']), hit(['highBongo']), createRest({ duration: 'half' })]),
      createMeasure(['lowBongo', 'lowBongo', 'highBongo', 'highBongo', 'lowBongo', 'highBongo', 'lowBongo', 'highBongo'].map((id) => hit([id], 'eighth'))),
      createMeasure([hitA('lowBongo', ['staccato']), hitA('highBongo', ['tenuto']), hitA('lowBongo', ['staccato', 'tenuto']), hitA('highBongo', ['accent'])]),
    ])],
  });
  const movement = createMovement({
    title: 'Percussion 1 à 5 lignes',
    masterbars: [createMasterbar({ barType: 'simple' }), createMasterbar({ barType: 'simple' }), createMasterbar({ barType: 'final' })],
    tracks: [
      createTrack({ name: 'Bongos', abbreviation: 'Bgs', staves: [bongoStaff] }),
      createTrack({ name: 'Set de batterie', abbreviation: 'Bat', staves: [kitStaff(5), kitStaff(3), kitStaff(2), kitStaff(1)] }),
    ],
  });
  return createWork({ title: 'Percussion — portées de 1 à 5 lignes (tranche 5b ; mesure 3 : articulations)', movements: [movement] });
}

/**
 * Percmap UNIQUE (05/10/2026) : le MÊME type de portée `percussion` pour tous les instruments à son indéterminé ; seule la carte (`PID.PERCMAP`)
 * change — batterie (carte par défaut, sans propriété), percussions à main, puis des préréglages MuseScore d'orchestre (caisse claire, grosse caisse,
 * timbales, toms de concert, triangle, cymbale suspendue). 2 mesures de noires.
 */
export function samplePercussionPresetsWork() {
  resetIds();
  const hit = (sound, duration = 'quarter') => createChord({ duration, notes: [createPercNote({ sound })] });
  const staff = (presetId, lines, sounds) => createStaff({
    type: 'percussion', clef: 'G',
    props: { [PID.LINE_COUNT]: lines, ...(presetId ? { [PID.PERCMAP]: percmapPreset(presetId).create() } : {}) },
    voices: [createVoice([createMeasure(sounds.slice(0, 4).map((s) => hit(s))), createMeasure(sounds.slice(4, 8).map((s) => hit(s)))])],
  });
  const track = (name, abbreviation, s) => createTrack({ name, abbreviation, staves: [s] });
  const movement = createMovement({
    title: 'Percussion : jeux de sons',
    masterbars: [createMasterbar({ barType: 'simple' }), createMasterbar({ barType: 'final' })],
    tracks: [
      track('Batterie (carte par défaut)', 'Bat', staff(null, 5, ['closedHiHat', 'acousticSnare', 'openHiHat', 'bassDrum1', 'crashCymbal1', 'highTom', 'lowFloorTom', 'pedalHiHat'])),
      track('Percussion à main', 'Prc', staff('scorsaire-hand-percussion', 5, ['hiConga', 'loConga', 'hiBongo', 'loBongo', 'hiConga', 'hiConga', 'loConga', 'loBongo'])),
      track('Caisse claire', 'Cc', staff('musescore:snare-drum', 1, ['snare', 'snare', 'sideStick', 'snare', 'snare', 'sideStick', 'snare', 'snare'])),
      track('Grosse caisse', 'Gc', staff('musescore:bass-drum', 1, Array(8).fill('concertBassDrum'))),
      track('Timbales', 'Tbl', staff('musescore:timbales', 1, ['highTimbale', 'lowTimbale', 'highTimbale', 'lowTimbale', 'lowTimbale', 'highTimbale', 'lowTimbale', 'highTimbale'])),
      track('Toms de concert', 'Tom', staff('musescore:tom-toms', 5, ['tom1', 'tom2', 'tom3', 'tom4', 'tom5', 'tom6', 'tom3', 'tom1'])),
      track('Triangle', 'Tri', staff('musescore:triangle', 1, ['openTriangle', 'muteTriangle', 'openTriangle', 'muteTriangle', 'openTriangle', 'openTriangle', 'muteTriangle', 'openTriangle'])),
    ],
  });
  return createWork({ title: 'Percussion — un seul type de portée, des jeux de sons (percmap)', movements: [movement] });
}

/**
 * Démo de la tranche 5b (suite) : reproduit l'export MuseScore `perc_silences_2_vx_slur_et_tie.svg` de Jean — une portée bongos
 * (1 ligne) et un set de batterie à 5, 3, 2 et 1 lignes, 3 mesures, 2 voix, silences de la croche à la double-triple croche,
 * liaison de prolongation (tie) et liaison de phrasé (slur) — plus (mesure 3) des altérations posées à la main (PID.ACCIDENTAL_DISPLAY).
 */
export function samplePercussionRestsWork() {
  resetIds();
  const hit = (sound, duration = 'quarter', props = {}, dots = 0) => createChord({ duration, dots, notes: [createPercNote({ sound })], props });
  const rest = (duration) => createRest({ duration });
  const down = { [PID.STEM_DIRECTION]: 'down' };
  // Bongos : voix 1 = bongo aigu (hampe haute), voix 2 = bongo grave (hampe basse), mêmes silences aux deux mesures
  const bongoMeasure = () => [
    [hit('highBongo'), rest('quarter'), rest('half')],
    [hit('lowBongo'), rest('quarter'), rest('eighth'), rest('sixteenth'), rest('sixteenth'), rest('quarter')],
  ];
  const bm = [bongoMeasure(), bongoMeasure(), bongoMeasure()];
  const bongoStaff = createStaff({
    type: 'percussion', clef: 'G', props: { [PID.LINE_COUNT]: 1, [PID.PERCMAP]: percMapFromKit('bongos') },
    voices: [createVoice(bm.map((m) => createMeasure(m[0]))), createVoice(bm.map((m) => createMeasure(m[1])))],
  });
  const kitStaff = (lines) => {
    // mesure 1
    const a1 = hit('lowMidTom', 'sixteenth'); const a2 = hit('lowMidTom', 'sixteenth'); const a3 = hit('lowMidTom', 'eighth'); const a4 = hit('lowMidTom', 'eighth');
    const v1m1 = [a1, a2, a3, a4, rest('eighth'), rest('eighth'), rest('sixteenth'), rest('thirtysecond'), rest('sixtyfourth'), rest('sixtyfourth'), hit('chinaCymbal')];
    const b1 = hit('lowFloorTom', 'eighth', down); const b2 = hit('pedalHiHat', 'eighth', down);
    const v2m1 = [b1, b2, rest('quarter'), rest('half')];
    // mesure 2
    const c1 = hit('lowMidTom', 'eighth', {}, 1); const c2 = hit('openHiHat', 'sixteenth');
    const v1m2 = [c1, c2, rest('quarter'), rest('eighth'), rest('sixteenth'), rest('thirtysecond'), rest('sixtyfourth'), rest('sixtyfourth'), hit('chinaCymbal')];
    const d1 = hit('bassDrum1', 'sixteenth'); const d2 = hit('bassDrum1', 'eighth'); const d3 = hit('bassDrum1', 'sixteenth'); const d4 = hit('bassDrum1', 'sixteenth');
    const v2m2 = [d1, d2, d3, d4, rest('sixteenth'), rest('eighth'), rest('half')];
    // mesure 3 : altérations posées à la main sur des notes de percussion (rien n'est dérivé de la hauteur)
    const acc = (sound, accidental) => createChord({ duration: 'quarter', notes: [createPercNote({ sound, props: { [PID.ACCIDENTAL_DISPLAY]: accidental } })] });
    const v1m3 = [acc('lowMidTom', 'sharp'), acc('openHiHat', 'flat'), acc('bassDrum1', 'natural'), acc('chinaCymbal', 'doubleSharp')];
    return createStaff({
      type: 'percussion', clef: 'G',
      props: {
        [PID.LINE_COUNT]: lines,
        [PID.TIES]: [createTie(a3.notes[0].id, a4.notes[0].id), createTie(d3.notes[0].id, d4.notes[0].id)],
        [PID.SLURS]: [createSlur(b1.id, b2.id), createSlur(c1.id, c2.id)],
      },
      voices: [createVoice([createMeasure(v1m1), createMeasure(v1m2), createMeasure(v1m3)]), createVoice([createMeasure(v2m1), createMeasure(v2m2), createMeasure([])])],
    });
  };
  const movement = createMovement({
    title: 'Percussion 1 à 5 lignes avec silences',
    masterbars: [createMasterbar({ barType: 'simple' }), createMasterbar({ barType: 'simple' }), createMasterbar({ barType: 'final' })],
    tracks: [
      createTrack({ name: 'Bongos', abbreviation: 'Bon.', staves: [bongoStaff] }),
      createTrack({ name: 'Set de batterie', abbreviation: 'Bat.', staves: [kitStaff(5), kitStaff(3), kitStaff(2), kitStaff(1)] }),
    ],
  });
  return createWork({ title: 'Percussion — silences, liaisons, 2 voix (tranche 5b)', movements: [movement] });
}

/**
 * Démo de la tranche 5c : sticking (mains) sur 4 portées de percussion identiques, une par système de symboles :
 * lettres R / L (au-dessus, défaut), lettres D / G (en dessous), carré blanc / rond noir (au-dessus), système libre (triangle / « g », en dessous).
 * Mesures : 1 paradiddle de croches ; 2 charleston (main droite) + caisse claire (main gauche) NOTÉS ENSEMBLE sur le même accord (deux mains
 * empilées) avec grosse caisse en voix 2 ; 3 noires avec accent et un flam (le sticking monte au-dessus de l'accent : alignement du système) ;
 * 4 tour de toms.
 */
export function samplePercussionStickingWork() {
  resetIds();
  const H = { R: 'right', L: 'left' };
  const hit = (sounds, hands, duration = 'quarter', props = {}) => createChord({
    duration, notes: sounds.map((id, i) => createPercNote({ sound: id, props: hands[i] ? { [PID.STICKING]: H[hands[i]] } : {} })), props,
  });
  const rest = (duration = 'quarter') => createRest({ duration });
  const staffOf = (system) => {
    const m1 = 'RLRRLRLL'.split('').map((h) => hit(['acousticSnare'], [h], 'eighth'));
    const m2 = Array.from({ length: 8 }, (_, i) => (i % 2 ? hit(['closedHiHat'], ['R'], 'eighth') : hit(['closedHiHat', 'acousticSnare'], ['R', 'L'], 'eighth')));
    const kick = [hit(['bassDrum1'], [null]), rest(), hit(['bassDrum1'], [null]), rest()];
    const accent = hit(['acousticSnare'], ['R']);
    accent.props[PID.ARTICULATIONS] = [createArticulation('accent')];
    const flam = hit(['acousticSnare'], ['L']);
    flam.graceNotes = [createPercGraceNote('acciaccatura', ['acousticSnare'])];
    const m3 = [accent, flam, hit(['acousticSnare'], ['R']), hit(['acousticSnare'], ['L'])];
    const m4 = ['highTom', 'lowMidTom', 'lowTom', 'lowFloorTom'].map((s, i) => hit([s], [i % 2 ? 'L' : 'R']));
    const v1 = [m1, m2, m3, m4].map((m) => createMeasure(m));
    const v2 = [createEmptyMeasure('percussion'), createMeasure(kick), createEmptyMeasure('percussion'), createEmptyMeasure('percussion')];
    return createStaff({ type: 'percussion', clef: 'G', props: system ? { [PID.STICKING_SYSTEM]: system } : {}, voices: [createVoice(v1), createVoice(v2)] });
  };
  const track = (name, system) => createTrack({ name, abbreviation: name.slice(0, 3), staves: [staffOf(system)] });
  const tracks = [
    track('Lettres R/L', null),
    track('Lettres D/G', { preset: 'letters-dg', placement: 'below' }),
    track('Symboles', { preset: 'shapes' }),
    track('Libre', { preset: 'custom', placement: 'below', right: { glyph: 'noteheadTriangleUpBlack' }, left: { text: 'g' } }),
  ];
  const movement = createMovement({ title: 'Sticking', masterbars: [0, 1, 2, 3].map((i) => createMasterbar({ barType: i === 3 ? 'final' : 'simple' })), tracks });
  return createWork({ title: 'Percussion — sticking (tranche 5c)', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Œuvre de démonstration de la tranche 6 : doigtés — piano (main droite au-dessus, main gauche en dessous), accords empilés, alternative
// « 2-3 » et substitution « 3-1 », deux voix, notes hors portée ; violon (numéros de corde cerclés, côté forcé) ; guitare : portée + tablature
// (main droite p i m a c, main gauche 0-5 et T à gauche de la note, numéros de corde), puis tablature Common et Simple (aucun doigté).

/** Pose des doigtés sur les notes d'une liste d'éléments : `specs[i]` = liste de doigtés par note de l'élément i (ou null). */
function withFingerings(items, specs) {
  items.forEach((item, i) => {
    const perNote = specs[i];
    if (!perNote || item.type !== 'chord') return;
    item.notes.forEach((note, j) => {
      const list = perNote[j];
      if (list) note.props[PID.FINGERINGS] = list.map(([text, kind, placement]) => createFingering(text, { kind, placement }));
    });
  });
  return items;
}
const FG = (text, kind = 'fingering', placement) => [text, kind, placement];

export function sampleFingeringWork() {
  resetIds();
  const eighths = (names, extra = 'r/2') => scoreItems(`${names.map((n) => `${n}/8`).join(' ')} ${extra}`);
  const chordOf = (names, duration = 'quarter') => createNoteChord(names.map(parseNote), { duration });
  const m = (items) => createMeasure(items);
  const empty = (type = 'score') => createEmptyMeasure(type);

  // piano — main droite
  const rh1 = withFingerings(eighths(['D4', 'E4', 'F4', 'B4']), [[[FG('0')]], [[FG('1')]], [[FG('2')]], [[FG('3')]]]);
  const rh2 = withFingerings([chordOf(['C4', 'E4', 'G4']), chordOf(['D4', 'F4', 'A4']), chordOf(['E4']), chordOf(['F4'])],
    [[[FG('1')], [FG('3')], [FG('5')]], [[FG('1')], [FG('2')], [FG('4')]], [[FG('2-3')]], [[FG('3-1')]]]);
  const rhV1 = withFingerings(scoreItems('C5/4 D5/4 E5/4 F5/4'), [[[FG('1')]], [[FG('2')]], [[FG('3')]], [[FG('4')]]]);
  const rhV2 = withFingerings(scoreItems('E4/2 G4/2'), [[[FG('5')]], [[FG('4')]]]);
  const rh4 = withFingerings(scoreItems('A5/4 G5/4 C4/4 B3/4'), [[[FG('5')]], [[FG('4')]], [[FG('1')]], [[FG('2')]]]);
  // piano — main gauche (clé de fa) : doigtés en dessous
  const lh1 = withFingerings(eighths(['G2', 'E2', 'F2', 'G2']), [[[FG('0')]], [[FG('2')]], [[FG('4')]], [[FG('5')]]]);
  const lh2 = withFingerings([chordOf(['C3', 'E3', 'G3']), chordOf(['D3', 'F3', 'A3']), chordOf(['E2']), chordOf(['F2'])],
    [[[FG('5')], [FG('3')], [FG('1')]], [[FG('5')], [FG('2')], [FG('1')]], [[FG('5')]], [[FG('4-5')]]]);
  const piano = createTrack({
    name: 'Piano', abbreviation: 'Pno',
    staves: [
      createStaff({ clef: 'G', voices: [createVoice([m(rh1), m(rh2), m(rhV1), m(rh4)]), createVoice([m([]), m([]), m(rhV2), m([])])] }),
      createStaff({ clef: 'F', voices: [createVoice([m(lh1), m(lh2), empty(), empty()])] }),
    ],
  });

  // violon
  const vn1 = withFingerings(eighths(['B4', 'A4', 'G4', 'D5']), [[[FG('0')]], [[FG('1')]], [[FG('2')]], [[FG('3')]]]);
  const vn2 = withFingerings(scoreItems('D5/4 A4/4 E5/4 B4/4'), [[[FG('1'), FG('1', 'stringNumber')]], [[FG('2'), FG('2', 'stringNumber')]], [[FG('4'), FG('1', 'stringNumber')]], [[FG('3'), FG('2', 'stringNumber')]]]);
  const vn3 = withFingerings(scoreItems('B4/4 B4/4 B4/4 B4/4'), [[[FG('1', 'fingering', 'below')]], [[FG('2')]], [[FG('3', 'fingering', 'below')]], [[FG('4')]]]);
  const violin = createTrack({ name: 'Violon', abbreviation: 'Vln', staves: [createStaff({ clef: 'G', voices: [createVoice([m(vn1), m(vn2), m(vn3), empty()])] })] });

  // guitare : mêmes rythmes sur la portée et la tablature
  const base1 = 'G3/8 D4/8 C4/8 A3/8 A3/8 r/8 r/4';
  const base2 = 'G3/8 D4/8 C4/8 A3/8 A3/8 A3/8 A3/8 r/8';
  const base3 = 'G3/4 D4/4 C4/4 A3/4';
  const rh = (letters) => letters.map((l) => (l ? [[FG(l, 'rhGuitar')]] : null));
  const lh = [['0'], ['1'], ['2'], ['3'], ['4'], ['5'], ['T']].map(([t]) => [[FG(t, 'lhGuitar')]]);
  const strings = ['3', '4', '5', '6'].map((s, i) => [[FG('pima'[i], 'rhGuitar'), FG(s, 'stringNumber')]]);
  const guitarStaff = (kind) => {
    const make = kind === 'tab' ? tabItems : scoreItems;
    const clef = kind === 'tab' ? undefined : 'G';
    return createStaff({
      type: kind, ...(clef ? { clef } : {}),
      props: kind === 'tab' ? { [PID.TAB_STYLE]: 'full' } : {},
      voices: [createVoice([
        m(withFingerings(make(base1), rh(['p', 'i', 'm', 'a', 'c']))),
        m(withFingerings(make(base2), lh)),
        m(withFingerings(make(base3), strings)),
        empty(kind),
      ])],
    });
  };
  const commonTab = createStaff({ type: 'tab', props: { [PID.TAB_STYLE]: 'common' }, voices: [createVoice([
    m(withFingerings(tabItems(base1), rh(['p', 'i', 'm', 'a', 'c']))), m(withFingerings(tabItems(base2), lh)), m(withFingerings(tabItems(base3), strings)), empty('tab')]) ] });
  const simpleTab = createStaff({ type: 'tab', props: { [PID.TAB_STYLE]: 'simple' }, voices: [createVoice([
    m(withFingerings(tabItems(base1), rh(['p', 'i', 'm', 'a', 'c']))), m(withFingerings(tabItems(base2), lh)), m(withFingerings(tabItems(base3), strings)), empty('tab')]) ] });
  const guitar = createTrack({ name: 'Guitare', abbreviation: 'Gtr', staves: [guitarStaff('score'), guitarStaff('tab')] });
  const guitarCommon = createTrack({ name: 'Tab Common', abbreviation: 'Com', staves: [commonTab] });
  const guitarSimple = createTrack({ name: 'Tab Simple', abbreviation: 'Sim', staves: [simpleTab] });

  const movement = createMovement({
    title: 'Doigtés',
    masterbars: [0, 1, 2, 3].map((i) => createMasterbar({ barType: i === 3 ? 'final' : 'simple' })),
    tracks: [piano, violin, guitar, guitarCommon, guitarSimple],
  });
  return createWork({ title: 'Doigtés (tranche 6)', movements: [movement] });
}

// ---------------------------------------------------------------------------------------------------------------
// Démo de la tranche 6b : doigtés évitant liaisons et nuances, doigtés d'ornement, déplacement manuel, carte de doigtés en glyphes Bravura,
// doigtés sur une portée de percussion (carte personnalisée : p / t / s en glyphes).
export function sampleFingeringAdvancedWork() {
  resetIds();
  const m = (items) => createMeasure(items);
  const empty = (type = 'score') => createEmptyMeasure(type);
  const chordOf = (names, duration = 'quarter', props = {}) => { const c = createNoteChord(names.map(parseNote), { duration }); Object.assign(c.props, props); return c; };

  // mesure 1 : liaison au-dessus des doigtés, nuance sous la main gauche ; mesure 2 : ornement doigté, déplacement manuel
  const a = withFingerings(scoreItems('C5/4 D5/4 E5/4 F5/4'), [[[FG('1')]], [[FG('2')]], [[FG('3')]], [[FG('4')]]]);
  const slurs = [createSlur(a[0].id, a[3].id)];
  const b = withFingerings(scoreItems('G4/4 A4/4 B4/4 C5/4'), [[[FG('1')]], [[FG('2')]], [[FG('3')]], [[FG('5')]]]);
  b[1].graceNotes = [createGraceNote('acciaccatura', [parseNote('G4')])];
  withFingerings(b[1].graceNotes, [[[FG('1')]]]);
  b[2].notes[0].props[PID.FINGERINGS].push(createFingering('x', { kind: 'fingering', offset: [0.8, -1.2] })); // déplacé de 0,8 sp à droite et 1,2 sp vers le HAUT
  const rh = createStaff({ clef: 'G', props: { [PID.SLURS]: slurs }, voices: [createVoice([m(a), m(b), empty(), empty()])] });
  const l1 = withFingerings(scoreItems('C3/4 E3/4 G3/4 E3/4'), [[[FG('5')]], [[FG('3')]], [[FG('1')]], [[FG('3')]]]);
  l1[0].props[PID.DYNAMIC] = 'mf';
  const lh = createStaff({ clef: 'F', voices: [createVoice([m(l1), empty(), empty(), empty()])] });
  const piano = createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [rh, lh] });

  // guitare, carte « glyphes » : chiffres Bravura (italiques à la main droite), lettres, tiret de substitution
  const g1 = withFingerings(scoreItems('G3/8 D4/8 C4/8 A3/8 A3/8 A3/8 A3/8 A3/8'),
    [[[FG('p', 'rhGuitar'), FG('0', 'lhGuitar')]], [[FG('i', 'rhGuitar'), FG('1', 'lhGuitar')]], [[FG('m', 'rhGuitar'), FG('2', 'lhGuitar')]], [[FG('a', 'rhGuitar'), FG('3', 'lhGuitar')]],
      [[FG('2-3')]], [[FG('4')]], [[FG('T', 'lhGuitar')]], [[FG('1', 'stringNumber')]]]);
  const gtr = createTrack({ name: 'Guitare (glyphes)', abbreviation: 'Gtr', staves: [createStaff({ clef: 'G', props: { [PID.FINGERING_MAP]: { preset: 'glyphs' } }, voices: [createVoice([m(g1), empty(), empty(), empty()])] })] });

  // percussion à main : portée de percussion avec la percmap « percussion à main » (congas, bongos…), carte perso (p = paume, t = bout des doigts, s = slap)
  const hit = (sound, f) => { const c = createChord({ duration: 'quarter', notes: [createPercNote({ sound })] }); if (f) c.notes[0].props[PID.FINGERINGS] = [createFingering(f)]; return c; };
  const perc = createStaff({
    type: 'percussion', clef: 'G',
    props: { [PID.PERCMAP]: createPercMap(HAND_PERCUSSION_PERCMAP), [PID.FINGERING_MAP]: { preset: 'custom', map: { p: { glyph: 'fingeringPLower' }, t: { glyph: 'fingeringTLower' }, s: { glyph: 'fingeringSLower' } } } },
    voices: [createVoice([m([hit('hiConga', 'p'), hit('hiConga', 't'), hit('loConga', 's'), hit('hiBongo', 'p-t')]), empty('percussion'), empty('percussion'), empty('percussion')])],
  });
  const handPerc = createTrack({ name: 'Percussion', abbreviation: 'Prc', staves: [perc] });

  const movement = createMovement({ title: 'Doigtés 6b', masterbars: [0, 1, 2, 3].map((i) => createMasterbar({ barType: i === 3 ? 'final' : 'simple' })), tracks: [piano, gtr, handPerc] });
  return createWork({ title: 'Doigtés — évitement, ornements, glyphes (tranche 6b)', movements: [movement] });
}

/** Sauts et marqueurs (tranche « sauts ») : douze mesures qui montrent chaque marqueur et plusieurs sauts, avec reprise et voltas. */
export function sampleJumpsWork() {
  resetIds();
  const bar = (i, props = {}) => createMasterbar({ barType: i === 11 ? 'final' : 'simple', props });
  const bars = [
    bar(0, { [PID.REPEAT_START]: true }), bar(1, { [PID.REPEAT_END]: true }), bar(2), bar(3), bar(4), bar(5), bar(6), bar(7), bar(8), bar(9), bar(10), bar(11),
  ];
  const at = (i) => bars[i].id;
  const measures = bars.map(() => createMeasure(scoreItems('C5/4 D5/4 E5/4 F5/4')));
  const staff = createStaff({ clef: 'G', voices: [createVoice(measures)] });
  const movement = createMovement({
    title: 'Sauts et marqueurs',
    masterbars: bars,
    tracks: [createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [staff] })],
    voltas: [createVolta({ measureId: at(1), numbers: [1] }), createVolta({ measureId: at(2), numbers: [2], open: true })],
    markers: [
      createMarker({ measureId: at(0), markerType: 'segno' }),
      createMarker({ measureId: at(2), markerType: 'fine' }),
      createMarker({ measureId: at(3), markerType: 'toCodaSym' }),
      createMarker({ measureId: at(4), markerType: 'varsegno' }),
      createMarker({ measureId: at(6), markerType: 'coda' }),
      createMarker({ measureId: at(7), markerType: 'codetta' }),
      createMarker({ measureId: at(8), markerType: 'varcoda' }),
      createMarker({ measureId: at(9), markerType: 'toCoda' }),
      createMarker({ measureId: at(10), markerType: 'daCoda' }),
      createMarker({ measureId: at(11), markerType: 'daDblCoda' }),
    ],
    jumps: [
      createJump({ measureId: at(5), jumpType: 'dsAlCoda' }),
      createJump({ measureId: at(8), jumpType: 'dcAlFine' }),
      createJump({ measureId: at(11), jumpType: 'dss' }),
    ],
  });
  return createWork({ title: 'Sauts et marqueurs', movements: [movement] });
}

/**
 * Respirations et césures (affichage) : une mesure par type (les 10 de `Breath::BREATH_LIST`) après la 2e noire de la voix 1 ; puis une respiration
 * de la voix 2 (en dessous), une respiration et une césure en fin de mesure ; la tablature reprend les mêmes mesures.
 */
export function sampleBreathsWork() {
  resetIds();
  const TYPES = ['breathMarkComma', 'breathMarkTick', 'breathMarkSalzedo', 'breathMarkUpbow', 'caesura', 'caesuraThick', 'caesuraShort', 'caesuraCurved', 'caesuraSingleStroke', 'chantCaesura'];
  const N = TYPES.length + 3;
  const upper = Array.from({ length: N }, () => scoreItems('E5/4 G5/4 B4/4 D5/4'));
  const lower = Array.from({ length: N }, () => scoreItems('C4/4 E4/4 G3/4 B3/4'));
  const tab = Array.from({ length: N }, () => tabItems('E4/4 G4/4 B3/4 D4/4'));
  const breaths = TYPES.map((t, i) => createBreath(upper[i][1].id, t));
  breaths.push(createBreath(lower[TYPES.length][1].id, 'breathMarkComma'));            // voix 2 : en dessous
  breaths.push(createBreath(upper[TYPES.length + 1][3].id, 'breathMarkComma'));        // fin de mesure
  breaths.push(createBreath(upper[TYPES.length + 2][3].id, 'caesura'));                // césure en fin de mesure
  const tabBreaths = [createBreath(tab[4][1].id, 'caesura'), createBreath(tab[0][1].id, 'breathMarkComma'), createBreath(tab[N - 1][3].id, 'caesuraThick')];
  const piano = createStaff({ clef: 'G', props: { [PID.BREATHS]: breaths }, voices: [createVoice(upper.map((c) => createMeasure(c))), createVoice(lower.map((c) => createMeasure(c)))] });
  const guitar = createStaff({ type: 'tab', props: { [PID.BREATHS]: tabBreaths }, voices: [createVoice(tab.map((c) => createMeasure(c)))] });
  const movement = createMovement({
    title: 'Respirations et césures',
    masterbars: Array.from({ length: N }, (_, i) => createMasterbar({ barType: i === N - 1 ? 'final' : 'simple' })),
    tracks: [createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [piano] }), createTrack({ name: 'Guitare', abbreviation: 'Gtr', staves: [guitar] })],
  });
  return createWork({ title: 'Respirations et césures', movements: [movement] });
}

/** Démo des nuances : les 32 types de MuseScore (une par mesure, sur la première note) + un texte libre, sur une portée et sa tablature. */
export function sampleDynamicsWork() {
  resetIds();
  const types = DYNAMIC_TYPES;
  const N = types.length;
  const upper = Array.from({ length: N }, () => scoreItems('E5/4 G5/4 B4/4 D5/4'));
  const tab = Array.from({ length: N }, () => tabItems('E4/4 G4/4 B3/4 D4/4'));
  types.forEach((t, i) => {
    upper[i][0].props[PID.DYNAMIC] = t;
    tab[i][0].props[PID.DYNAMIC] = t;
    if (t === 'other') { upper[i][0].props[PID.DYNAMIC_TEXT] = 'dolce'; tab[i][0].props[PID.DYNAMIC_TEXT] = 'dolce'; }
  });
  const piano = createStaff({ clef: 'G', voices: [createVoice(upper.map((c) => createMeasure(c)))] });
  const guitar = createStaff({ type: 'tab', voices: [createVoice(tab.map((c) => createMeasure(c)))] });
  const movement = createMovement({
    title: 'Nuances complètes',
    masterbars: Array.from({ length: N }, (_, i) => createMasterbar({ barType: i === N - 1 ? 'final' : 'simple' })),
    tracks: [createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [piano] }), createTrack({ name: 'Guitare', abbreviation: 'Gtr', staves: [guitar] })],
  });
  return createWork({ title: 'Nuances complètes', movements: [movement] });
}

/** Demo of the staff texts: free texts (normal / italic / bold, above / below) and predefined playing techniques on two staves. */
export function sampleStaffTextWork() {
  resetIds();
  const N = 8;
  const upper = Array.from({ length: N }, () => scoreItems('E5/4 G5/4 B4/4 D5/4'));
  const lower = Array.from({ length: N }, () => scoreItems('C3/4 E3/4 G3/4 B3/4'));
  const masterbars = Array.from({ length: N }, (_, i) => createMasterbar({ barType: i === N - 1 ? 'final' : 'simple' }));
  const id = (i) => masterbars[i].id;
  const text = (i, pos, t, extra = {}) => ({ id: newId('st'), measureId: id(i), position: pos, text: t, style: 'normal', placement: 'above', ...extra });
  const top = createStaff({
    clef: 'G', voices: [createVoice(upper.map((c) => createMeasure(c)))],
    props: { [PID.STAFF_TEXTS]: [text(0, frac(0, 1), 'dolce', { style: 'italic' }), text(2, frac(1, 4), 'solo', { style: 'bold' }), text(4, frac(0, 1), 'con sord.', { style: 'italic', technique: 'conSord' }), text(6, frac(0, 1), 'senza sord.', { style: 'italic', technique: 'senzaSord' })] },
  });
  const bass = createStaff({
    clef: 'F', voices: [createVoice(lower.map((c) => createMeasure(c)))],
    props: { [PID.STAFF_TEXTS]: [text(1, frac(0, 1), 'pizz.', { style: 'italic', placement: 'below', technique: 'pizz' }), text(5, frac(0, 1), 'arco', { style: 'italic', placement: 'below', technique: 'arco' })] },
  });
  const movement = createMovement({
    title: 'Textes de portée', masterbars,
    tracks: [createTrack({ name: 'Violon', abbreviation: 'Vln', staves: [top], props: { [PID.INSTRUMENT_ID]: 'violin' } }), createTrack({ name: 'Violoncelle', abbreviation: 'Vc', staves: [bass], props: { [PID.INSTRUMENT_ID]: 'violoncello' } })], // instruments of the catalogue: pizz. / arco switch the SoundFont program
  });
  return createWork({ title: 'Textes de portée', movements: [movement] });
}

/**
 * Demo of the staff containers: a simplified rhythm written in a container over the chord symbols (spanning two measures, across a
 * barline), a text container and a nested rhythm between the chord staff and the melody staff.
 */
export function sampleContainersWork() {
  resetIds();
  const N = 6;
  const note = (step) => ({ step, alter: 0 });
  const roots = [['C', ''], ['A', 'm7'], ['D', 'm7'], ['G', '7'], ['C', 'M7'], ['F', '']];
  const symbols = roots.map(([r, q]) => [
    createChordSymbol({ root: note(r), quality: q, position: [0, 1], duration: 'half' }),
    createChordSymbol({ root: note(r), quality: q, position: [1, 2], duration: 'half' }),
  ]);
  const masterbars = Array.from({ length: N }, (_, i) => createMasterbar({ barType: i === N - 1 ? 'final' : 'simple' }));
  const nested = (items) => createStaff({ type: 'rhythm', voices: [createVoice(items.map((m) => createMeasure(m)))] });
  const chords = createStaff({
    type: 'chord',
    voices: [createVoice(symbols.map((items) => createMeasure(items)))],
    containers: [
      createStaffContainer({
        measureId: masterbars[0].id, span: 2, kind: 'nestedNotation',
        fragments: [createFragment({ bars: masterbars.slice(0, 2), staves: [nested([
          [createRhythmChord('quarter'), createRhythmChord('eighth'), createRhythmChord('eighth'), createRhythmChord('quarter'), createRhythmChord('quarter')],
          [createRhythmChord('half'), createRhythmChord('quarter'), createRhythmChord('quarter')],
        ])] })],
      }),
    ],
  });
  const melody = createStaff({
    clef: 'G',
    voices: [createVoice(Array.from({ length: N }, () => createMeasure(scoreItems('E5/4 G5/4 B4/4 D5/4'))))],
    containers: [
      createStaffContainer({ measureId: masterbars[2].id, span: 2, kind: 'text', text: 'dolce' }),
      createStaffContainer({ measureId: masterbars[4].id, span: 1, kind: 'nestedNotation', fragments: [createFragment({ bars: masterbars.slice(4, 5), staves: [nested([[createRhythmChord('half'), createRhythmChord('half')]])] })] }),
    ],
  });
  const movement = createMovement({
    title: 'Conteneurs', masterbars,
    tracks: [createTrack({ name: 'Accords', abbreviation: 'Ch', staves: [chords] }), createTrack({ name: 'Mélodie', abbreviation: 'Mel', staves: [melody] })],
  });
  return createWork({ title: 'Conteneurs', movements: [movement] });
}

/** Démo des textes de tempo et des lignes rit. / accel. : tempo écrit, mot italien, rit. sur plusieurs mesures, a tempo, modulation métrique, tempo primo. */
export function sampleTempoWork() {
  resetIds();
  const N = 14;
  const chords = Array.from({ length: N }, () => scoreItems('E5/4 G5/4 B4/4 D5/4'));
  const bass = Array.from({ length: N }, () => scoreItems('C3/4 E3/4 G3/4 B3/4'));
  const masterbars = Array.from({ length: N }, (_, i) => createMasterbar({ barType: i === N - 1 ? 'final' : 'simple' }));
  const id = (i) => masterbars[i].id;
  const NOTE = '\uECA5', DOT = '\uECB7';
  const piano = createStaff({ clef: 'G', voices: [createVoice(chords.map((c) => createMeasure(c)))] });
  const left = createStaff({ clef: 'F', voices: [createVoice(bass.map((c) => createMeasure(c)))] });
  const movement = createMovement({
    title: 'Tempos',
    masterbars,
    tracks: [createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [piano, left] })],
    tempos: [
      createTempo({ measureId: id(0), bpm: 92 }),
      createTempo({ measureId: id(2), bpm: 144, text: 'Allegro' }),
      createTempo({ measureId: id(7), tempoKind: 'aTempo' }),
      createTempo({ measureId: id(8), position: [1, 2], tempoKind: 'relative', factor: 1.5, text: `${NOTE} = ${NOTE} ${DOT}` }),
      createTempo({ measureId: id(12), tempoKind: 'tempoPrimo' }),
    ],
    tempoChanges: [
      createTempoChange({ measureId: id(4), endMeasureId: id(7), changeType: 'ritardando' }),
      createTempoChange({ measureId: id(9), position: [1, 4], endMeasureId: id(11), endPosition: [1, 2], changeType: 'accelerando' }),
    ],
    fermatas: [
      createFermata({ measureId: id(3), position: [3, 4] }),
      createFermata({ measureId: id(7), fermataType: 'fermataLong' }),
    ],
    swings: [
      createSwing({ measureId: id(1), kind: 'swing' }),
      createSwing({ measureId: id(5), position: [1, 2], kind: 'straight' }),
    ],
  });
  return createWork({ title: 'Tempos', movements: [movement] });
}

/**
 * Démo de l'affichage de la pédale : piano (deux portées), les pédales sont portées par la portée du BAS et dessinées dessous. Chaque mesure
 * montre un préréglage de MuseScore (« Ped. » + ligne, « Ped. … * », crochets droits / obliques), des changements de pédale (deux lignes qui se
 * touchent, en ligne, en rosette et avec crochets obliques) et une pédale longue qui traverse les retours à la ligne (continuation « (Ped.) »).
 */
export function samplePedalWork() {
  resetIds();
  const N = 14;
  const chords = Array.from({ length: N }, () => scoreItems('E5/4 G5/4 B4/4 D5/4'));
  const bass = Array.from({ length: N }, () => scoreItems('C3/4 E3/4 G3/4 B3/4'));
  const masterbars = Array.from({ length: N }, (_, i) => createMasterbar({ barType: i === N - 1 ? 'final' : 'simple' }));
  const id = (i) => masterbars[i].id;
  const pedals = [
    createPedal(id(0), frac(0), id(1), frac(0)), // « Ped. » + ligne, fin à l'instant 0 de la mesure suivante (s'arrête à la barre)
    createPedal(id(1), frac(1, 4), id(2), frac(1, 2)),
    createPedal(id(2), frac(1, 2), id(3), frac(0), { pedalType: 'pedStar' }), // changement : « Ped. * » enchaîné
    createPedal(id(3), frac(0), id(3), frac(3, 4), { pedalType: 'pedStar' }),
    createPedal(id(4), frac(0), id(4), frac(3, 4), { pedalType: 'hooks' }),
    createPedal(id(5), frac(0), id(5), frac(3, 4), { pedalType: 'hooksEnd45' }),
    createPedal(id(6), frac(0), id(6), frac(1, 2), { pedalType: 'hooks45' }),
    createPedal(id(6), frac(1, 2), id(6), frac(3, 4), { pedalType: 'hooks45' }), // deux crochets obliques qui se rejoignent
    createPedal(id(7), frac(0), id(7), frac(3, 4), { pedalType: 'hooksStart45' }),
    createPedal(id(8), frac(1, 4), id(12), frac(1, 2)), // longue : traverse les retours à la ligne
  ];
  const piano = createStaff({ clef: 'G', voices: [createVoice(chords.map((c) => createMeasure(c)))] });
  const left = createStaff({ clef: 'F', voices: [createVoice(bass.map((c) => createMeasure(c)))], props: { [PID.PEDALS]: pedals } });
  const movement = createMovement({ title: 'Pédale', masterbars, tracks: [createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [piano, left] })] });
  return createWork({ title: 'Pédale', movements: [movement] });
}

/**
 * Démo de la hauteur sonnante : cinq pistes (flûte, clarinette si♭, cor en fa, saxophone alto mi♭, piccolo) jouent les MÊMES notes de
 * concert, dans quatre armures de concert (0, 3 dièses, 6 dièses, 3 bémols). L'affichage écrit montre à chacune sa notation ; le
 * style `CONCERT_PITCH` (case « Hauteur de concert » de la page) ramène tout à la hauteur de concert (le piccolo prend alors sa clé de concert).
 */
export function sampleTransposeWork() {
  resetIds();
  const phrases = [
    'C4/4 E4/4 G4/4 C5/4', //   do majeur
    'A4/4 C#5/4 E5/4 A5/4', //  la majeur (3 dièses)
    'F#4/4 A#4/4 C#5/4 F#5/4', // fa♯ majeur (6 dièses)
    'Eb4/4 G4/4 Bb4/4 Eb5/4', // mi♭ majeur (3 bémols)
  ];
  const keys = [0, 3, 6, -3];
  const masterbars = keys.map((keySig, i) => createMasterbar({ keySig, barType: i === keys.length - 1 ? 'final' : 'simple' }));
  const track = (name, abbreviation, instrumentId, staffProps = {}) => createTrack({
    name,
    abbreviation,
    props: instrumentId ? { [PID.INSTRUMENT_ID]: instrumentId } : {},
    staves: [createStaff({ clef: 'G', props: staffProps, voices: [createVoice(phrases.map((p) => createMeasure(scoreItems(p))))] })],
  });
  const movement = createMovement({
    title: 'Hauteur sonnante',
    masterbars,
    tracks: [
      track('Flûte', 'Fl.', 'flute'),
      track('Clarinette si♭', 'Cl.', 'clarinet'),
      track('Cor en fa', 'Cor', 'horn'),
      track('Saxophone alto', 'Sax', 'alto-saxophone'),
      track('Piccolo', 'Picc.', 'piccolo', { [PID.CONCERT_CLEF]: 'G8va' }),
    ],
  });
  return createWork({ title: 'Hauteur sonnante', movements: [movement] });
}

/** Démo des cinq clés d'ut (C1 à C5) : mêmes notes, armures 0, 3 dièses, 3 bémols, 7 dièses ; une clé de sol et une clé de fa en repère. */
export function sampleCClefsWork() {
  resetIds();
  const phrases = ['C4/4 E4/4 G4/4 C5/4', 'A3/4 C#4/4 E4/4 A4/4', 'Eb3/4 G3/4 Bb3/4 Eb4/4', 'F#4/4 A#4/4 C#5/4 F#5/4'];
  const keys = [0, 3, -3, 7];
  const masterbars = keys.map((keySig, i) => createMasterbar({ keySig, barType: i === keys.length - 1 ? 'final' : 'simple' }));
  const names = { G: 'Sol', C1: 'Ut 1', C2: 'Ut 2', C3: 'Ut 3', C4: 'Ut 4', C5: 'Ut 5', F: 'Fa' };
  const movement = createMovement({
    title: 'Clés d\'ut',
    masterbars,
    tracks: Object.keys(names).map((clef) => createTrack({
      name: names[clef],
      staves: [createStaff({ clef, voices: [createVoice(phrases.map((p) => createMeasure(scoreItems(p))))] })],
    })),
  });
  return createWork({ title: 'Clés d\'ut', movements: [movement] });
}

/** Démo « notes do » : les mêmes do (do3, do4, do5, do6) sur chaque clé, pour vérifier à l'œil la position de chaque clé. */
export function sampleDoClefsWork() {
  resetIds();
  const names = {
    G: 'Sol', F: 'Fa', C1: 'Ut 1', C2: 'Ut 2', C3: 'Ut 3', C4: 'Ut 4', C5: 'Ut 5',
    G8va: 'Sol 8va', G8vb: 'Sol 8vb', G15ma: 'Sol 15ma', G15mb: 'Sol 15mb', F8va: 'Fa 8va', F8vb: 'Fa 8vb', F15mb: 'Fa 15mb', F15ma: 'Fa 15ma',
  };
  const movement = createMovement({
    title: 'Notes do sur chaque clé',
    masterbars: [createMasterbar({ barType: 'final' })],
    tracks: Object.keys(names).map((clef) => createTrack({
      name: names[clef],
      staves: [createStaff({ clef, voices: [createVoice([createMeasure(scoreItems('C3/4 C4/4 C5/4 C6/4'))])] })],
    })),
  });
  return createWork({ title: 'Notes do sur chaque clé', movements: [movement] });
}

/** Démo « notes do » transposeurs : quatre do de concert (do4 do4 do5 do5) pour chaque instrument ; la case « Hauteur de concert » les ramène au concert. */
export function sampleDoTransposeWork() {
  resetIds();
  const track = (name, instrumentId, staffProps = {}) => createTrack({
    name,
    props: instrumentId ? { [PID.INSTRUMENT_ID]: instrumentId } : {},
    staves: [createStaff({ clef: 'G', props: staffProps, voices: [createVoice([createMeasure(scoreItems('C4/4 C4/4 C5/4 C5/4'))])] })],
  });
  const movement = createMovement({
    title: 'Notes do transposeurs',
    masterbars: [createMasterbar({ barType: 'final' })],
    tracks: [
      track('Flûte (concert)', 'flute'),
      track('Clarinette si♭', 'clarinet'),
      track('Cor en fa', 'horn'),
      track('Sax alto mi♭', 'alto-saxophone'),
      track('Piccolo', 'piccolo', { [PID.CONCERT_CLEF]: 'G8va' }),
    ],
  });
  return createWork({ title: 'Notes do transposeurs', movements: [movement] });
}

/** Démo des lignes de trille : les 4 types, intervalle personnalisé (altération), dessous, ligne sur deux mesures, sur une portée et sa tablature. */
export function sampleTrillsWork() {
  resetIds();
  const N = 8;
  const upper = Array.from({ length: N }, () => scoreItems('C5/4 E5/4 G5/4 C6/4'));
  const tab = Array.from({ length: N }, () => tabItems('E4/4 G4/4 B3/4 D4/4'));
  // Signes isolés avec altération (mesures sans ligne sur leur dernier accord) : trille, mordant supérieur, gruppetto à deux altérations
  const sign = (m, type, opts) => { upper[m][3].props[PID.ARTICULATIONS] = [createArticulation(type, opts)]; };
  sign(0, 'trill', { intervalAbove: { step: 1, type: 'minor' } });
  sign(1, 'mordent', { intervalAbove: { step: 1, type: 'minor' } });
  sign(2, 'turn', { intervalAbove: { step: 1, type: 'minor' }, intervalBelow: { step: 1, type: 'major' } });
  // intervalle ≠ seconde : note d'aide entre parenthèses (tierce majeure, quarte automatique), à la place des altérations
  sign(3, 'trill', { intervalAbove: { step: 2, type: 'minor' } });
  sign(7, 'mordent', { intervalAbove: { step: 3, type: 'auto' } });
  const line = (m, a, b, type, opts) => createTrillLine(upper[m][a].id, upper[m][b].id, type, opts);
  const lines = [
    line(0, 0, 2, 'trill'),
    line(1, 0, 2, 'upPrall'),
    line(2, 0, 2, 'downPrall'),
    line(3, 0, 2, 'prallPrall'),
    line(4, 0, 2, 'trill', { intervalAbove: { step: 1, type: 'minor' } }),   // seconde mineure : bémol
    line(5, 0, 2, 'trill', { placement: 'below' }),
    createTrillLine(upper[6][1].id, upper[7][1].id, 'trill'),                  // sur deux mesures
  ];
  const tabLines = [createTrillLine(tab[0][0].id, tab[0][2].id, 'trill'), createTrillLine(tab[6][1].id, tab[7][1].id, 'prallPrall')];
  // Molette (written pitch wheel, any instrument but the guitar): one on a whole chord, one on a single note with its own curve
  const wheels = [createWheel(upper[5][3].notes[0].id), createWheel(upper[6][3].notes[0].id, { scope: 'note', curve: [{ t: 0, s: 0 }, { t: 0.4, s: -1 }, { t: 1, s: 0, h: [0.2, 0] }] })];
  const piano = createStaff({ clef: 'G', props: { [PID.TRILLS]: lines, [PID.WHEELS]: wheels }, voices: [createVoice(upper.map((c) => createMeasure(c)))] });
  const guitar = createStaff({ type: 'tab', props: { [PID.TRILLS]: tabLines }, voices: [createVoice(tab.map((c) => createMeasure(c)))] });
  const movement = createMovement({
    title: 'Lignes de trille',
    masterbars: Array.from({ length: N }, (_, i) => createMasterbar({ barType: i === N - 1 ? 'final' : 'simple' })),
    tracks: [createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [piano] }), createTrack({ name: 'Guitare', abbreviation: 'Gtr', staves: [guitar] })],
  });
  return createWork({ title: 'Lignes de trille', movements: [movement] });
}

/**
 * Symboles d'accord (peintre `chord`, étape 5 tranche 3) : portée d'accords sans lignes au-dessus d'une mélodie. Mesures 1-4 : un accord par temps, altérations
 * de la fondamentale, accords sur basse, qualités longues (compression dans la case) ; 5 : deux accords par mesure à nom long ; 6-12 : accord d'une mesure, `%`,
 * `%%` et N.C. ; 13-19 : les 28 qualités du dictionnaire.
 */
export function sampleChordSymbolsWork() {
  resetIds();
  const note = (s) => { const m = /^([A-G])([#b]?)$/.exec(s); return { step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0 }; };
  const sym = (root, quality, pos, bass = null, duration = 'quarter') => createChordSymbol({ root: note(root), quality, bass: bass ? note(bass) : null, position: pos, duration });
  const special = (kind, duration = 'whole') => createChordSymbol({ special: kind, position: [0, 1], duration });
  const beats = [[0, 1], [1, 4], [1, 2], [3, 4]];
  const four = (list) => list.map(([r, q, b], i) => sym(r, q, beats[i], b ?? null));
  const rows = [
    four([['C', ''], ['D', 'm7'], ['G', '7'], ['C', 'M7']]),
    four([['F#', 'm7b5'], ['B', '7b9'], ['E', 'm7'], ['A', '7#9']]),
    four([['C', '', 'E'], ['G', '', 'B'], ['D', 'm', 'F'], ['Ab', '', 'C']]),
    four([['Bb', '7#11'], ['E', '7b13'], ['A', 'm7b5'], ['G', '7sus4']]),
    [sym('C#', 'm7b5', [0, 1], 'G#', 'half'), sym('F', '7#9', [1, 2], 'Ab', 'half')],
    [sym('C', 'm7', [0, 1], null, 'whole')],
    [special('repeat1')],
    [sym('D', 'm7', [0, 1], null, 'whole')],
    [sym('G', '7', [0, 1], null, 'whole')],
    [special('repeat2')],
    [special('repeat2')],
    [special('noChord', 'half'), sym('C', '', [1, 2], null, 'half')],
  ];
  // les 28 qualités du dictionnaire par groupes de quatre
  const ids = ['5', '', 'm', '7', 'M7', 'm7', 'm7b5', 'o7', 'o', '9', 'M9', 'm9', '11', '13', '6', 'm6', '69', 'sus4', 'sus2', '7sus4', 'aug', '7b9', '7#9', '7#11', '7b5', '7b13', 'alt', 'add9'];
  for (let i = 0; i < ids.length; i += 4) rows.push(ids.slice(i, i + 4).map((q, k) => sym('C', q, beats[k])));
  const N = rows.length;
  const chords = createStaff({ type: 'chord', voices: [createVoice(rows.map((items) => createMeasure(items)))] });
  const melody = createStaff({ clef: 'G', voices: [createVoice(Array.from({ length: N }, () => createMeasure(scoreItems('C5/4 D5/4 E5/4 F5/4'))))] });
  const movement = createMovement({
    title: "Symboles d'accord",
    masterbars: Array.from({ length: N }, (_, i) => createMasterbar({ barType: i === N - 1 ? 'final' : 'simple' })),
    tracks: [createTrack({ name: 'Accords', abbreviation: 'Ch', staves: [chords] }), createTrack({ name: 'Mélodie', abbreviation: 'Mel', staves: [melody] })],
  });
  return createWork({ title: "Symboles d'accord", movements: [movement] });
}

/**
 * Démo d'écoute des TIMBRES de la V1 (moteur audio, 11/10/2026) : six pistes, chacune joue son arpège dans SA mesure (les autres pistes
 * ont un silence de mesure) : piano, guitare classique, violon, flûte, trompette, voix. Sert à juger les timbres à l'oreille.
 */
export function sampleTimbresWork() {
  resetIds();
  const phrase = 'C4/4 E4/4 G4/4 C5/4';
  const instruments = [['Piano', 'Pno', 'piano'], ['Guitare classique', 'Gt', 'guitar-nylon'], ['Violon', 'Vl.', 'violin'], ['Flûte', 'Fl.', 'flute'], ['Trompette', 'Tpt', 'trumpet'], ['Voix', 'Voix', 'soprano']];
  const masterbars = instruments.map((_, i) => createMasterbar({ barType: i === instruments.length - 1 ? 'final' : 'simple' }));
  const tracks = instruments.map(([name, abbreviation, instrumentId], k) => createTrack({
    name,
    abbreviation,
    props: { [PID.INSTRUMENT_ID]: instrumentId },
    staves: [createStaff({ clef: 'G', voices: [createVoice(instruments.map((_, i) => (i === k ? createMeasure(scoreItems(phrase)) : createEmptyMeasure('score'))))] })],
  }));
  const movement = createMovement({ title: 'Timbres', masterbars, tracks });
  return createWork({ title: 'Timbres', movements: [movement] });
}

/** Donne un instrument du catalogue aux pistes qui n'en ont pas (démos d'écoute : sans instrument, les profils d'articulation n'ont pas d'effet). */
export function withInstrument(work, instrumentId) {
  for (const mv of work.movements) for (const t of mv.tracks) if (!t.props[PID.INSTRUMENT_ID]) t.props[PID.INSTRUMENT_ID] = instrumentId;
  return work;
}

/**
 * Démo des portées croisées (`PID.STAFF_MOVE`) : un piano (main droite en clé de sol, main gauche en clé de fa). Mesure 1 : deux notes de la
 * main droite dessinées sur la portée du bas ; mesure 2 : un accord de la main gauche dessiné sur la portée du haut ; mesure 3 : une série de
 * croches de la main droite entièrement sur la portée du bas (ligature ordinaire, sur cette portée) ; mesure 4 : silence déplacé ; mesures 5 à 8 : ligatures croisées (croches, doubles croches, silence dans le groupe, groupe de deux notes).
 */
export function sampleCrossStaffWork() {
  resetIds();
  const mv = (items, indices, move) => { for (const i of indices) items[i].props[PID.STAFF_MOVE] = move; return items; };
  const right = [
    mv(scoreItems('E5/4 G3/4 B4/4 C3/4'), [1, 3], 1),
    scoreItems('E5/2 G5/2'),
    mv(scoreItems('C4/8 E4/8 G3/8 B3/8 C4/8 E4/8 D4/8 F4/8'), [0, 1, 2, 3, 4, 5, 6, 7], 1),
    mv(scoreItems('G5/4 r/4 E5/2'), [1], 1),
    // ligatures CROISÉES (membres des deux côtés) : croches, doubles croches, silence dans le groupe, groupe de deux notes
    mv(scoreItems('G4/8 C3/8 E4/8 G3/8 C5/8 E3/8 G4/8 C3/8'), [1, 3, 5, 7], 1),
    mv(scoreItems('C5/16 G3/16 E5/16 B3/16 G4/16 C3/16 E5/16 G3/16 E5/2'), [1, 3, 5, 7], 1),
    mv(scoreItems('C5/8 r/8 E5/8 G3/8 G5/2'), [1, 3], 1),
    mv(scoreItems('E5/8 C3/8 r/4 E5/2'), [1], 1),
  ];
  const left = [
    scoreItems('C3/4 E3/4 G2/4 C3/4'),
    mv(scoreItems('C3/2 C5/2'), [1], -1),
    scoreItems('C2/2 G2/2'),
    scoreItems('C2/1'),
    scoreItems('C3/2 G2/2'),
    scoreItems('C2/2 G2/2'),
    scoreItems('F2/2 C3/2'),
    scoreItems('C2/1'),
  ];
  const masterbars = right.map((_, i) => createMasterbar({ barType: i === right.length - 1 ? 'final' : 'simple' }));
  const rh = createStaff({ clef: 'G', voices: [createVoice(right.map((c) => createMeasure(c)))] });
  const lh = createStaff({ clef: 'F', voices: [createVoice(left.map((c) => createMeasure(c)))] });
  const movement = createMovement({ title: 'Portées croisées', masterbars, tracks: [createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [rh, lh] })] });
  return createWork({ title: 'Portées croisées', movements: [movement] });
}

/**
 * Portées rythmiques (12/10/2026) : `rhythm` à 0 ligne (têtes de barre oblique, hampes vers le bas = MuseScore), `rhythm` à 1 ligne (hampes vers
 * le haut), `rhythm` à têtes ordinaires, `neutral` (une ligne, clé de percussion, têtes ordinaires). 4 mesures : noires, croches ligaturées,
 * valeurs variées (pointée, silence, triolet, accent), ronde + blanche.
 */
export function sampleRhythmWork() {
  resetIds();
  const R = (d, o) => createRhythmChord(d, o);
  const trip = (id) => ({ id, ratio: [3, 2], base: { base: 'eighth', dots: 0 } });
  const measures = (tag) => [
    createMeasure([R('quarter'), R('quarter'), R('quarter'), R('quarter')]),
    createMeasure(Array.from({ length: 8 }, () => R('eighth'))),
    createMeasure([
      R('quarter', { dots: 1 }), R('eighth'), createRest({ duration: 'quarter' }),
      ...[0, 1, 2].map(() => R('eighth', { props: { [PID.TUPLET]: trip(`t${tag}`) } })),
    ]),
    createMeasure([R('half', { props: { [PID.ARTICULATIONS]: [createArticulation('accent')] } }), R('half')]),
  ];
  const staff = (props) => createStaff({ type: props.type, props: props.props, voices: [createVoice(measures(props.tag))] });
  const movement = createMovement({
    title: 'Portées rythmiques',
    masterbars: [createMasterbar({ timeSig: [4, 4] }), createMasterbar(), createMasterbar(), createMasterbar({ barType: 'final' })],
    tracks: [
      createTrack({ name: 'Rythme (0 ligne)', abbreviation: 'Ry0', staves: [staff({ type: 'rhythm', tag: 'a' })] }),
      createTrack({ name: 'Rythme (1 ligne, hampes en haut)', abbreviation: 'Ry1', staves: [staff({ type: 'rhythm', tag: 'b', props: { [PID.LINE_COUNT]: 1, [PID.RHYTHM_STEM]: 'up' } })] }),
      createTrack({ name: 'Rythme (têtes ordinaires)', abbreviation: 'Ryn', staves: [staff({ type: 'rhythm', tag: 'c', props: { [PID.RHYTHM_HEAD]: 'normal' } })] }),
      createTrack({ name: 'Neutre', abbreviation: 'Neu', staves: [staff({ type: 'neutral', tag: 'd' })] }),
    ],
  });
  return createWork({ title: 'Portées rythmiques', movements: [movement] });
}

/**
 * Démo des paroles : trois couplets sous une voix (« 1. » aligné à gauche, tirets, mélisme sur deux mesures, accord de deux notes portant une
 * syllabe, ponctuation), un couplet AU-DESSUS sur une seconde portée, et une tablature sans paroles. Les textes sont sur l'œuvre, les liens sur les portées.
 */
export function sampleLyricsWork() {
  resetIds();
  const MEASURES = 8;
  const pitches = ['E4', 'G4', 'A4', 'B4', 'C5', 'B4', 'A4', 'G4'];
  const chords = Array.from({ length: MEASURES * 4 }, (_, i) => {
    const n = parseNote(pitches[i % pitches.length]);
    const notes = [n];
    if (i === 6 || i === 20) notes.push({ ...n, step: 'C', octave: n.octave + 1 }); // accord de deux notes
    return createNoteChord(notes, { duration: 'quarter' });
  });
  const upper = Array.from({ length: MEASURES }, (_, m) => chords.slice(m * 4, m * 4 + 4));
  const verses = [
    createLyricText(0, '1.Al-le-lu-ia, chan-tons le ma-tin, le so-leil se lè-ve (ô joie !) puis dort.'),
    createLyricText(1, '2.Ô mon cœur est en fê-te, voi-ci le jour nou-veau.'),
  ];
  const high = createLyricText(2, 'la la la la la la', { placement: 'above' });
  // couplet 1 : chaque syllabe sur l'accord de même rang, avec des mélismes ; (accord, accord de fin du mélisme)
  const links0 = [[0], [1], [2], [3, 5], [6], [7], [8], [9], [10], [11], [12], [13, 17], [18], [19], [20], [21], [22], [23]];
  const links1 = [[0], [1], [2], [3], [4], [5], [6, 7], [8], [9], [10], [11], [12], [13], [14], [15]];
  const make = (text, list) => list.map(([c, e], i) => createLyricLink(text.id, i, chords[c].id, e === undefined ? {} : { endChordId: chords[e].id }));
  const staffLinks = [...make(verses[0], links0), ...make(verses[1], links1)];
  const lower = Array.from({ length: MEASURES }, () => scoreItems('C4/4 E4/4 G3/4 B3/4'));
  const high2 = Array.from({ length: MEASURES }, () => scoreItems('G4/4 A4/4 B4/4 C5/4'));
  const highLinks = high2.flat().slice(0, 6).map((c, i) => createLyricLink(high.id, i, c.id));
  const tab = Array.from({ length: MEASURES }, () => tabItems('E4/4 G4/4 B3/4 D4/4'));
  const voice = createStaff({ clef: 'G', props: { [PID.LYRIC_LINKS]: staffLinks }, voices: [createVoice(upper.map((c) => createMeasure(c)))] });
  const second = createStaff({ clef: 'G', props: { [PID.LYRIC_LINKS]: highLinks }, voices: [createVoice(high2.map((c) => createMeasure(c)))] });
  const bass = createStaff({ clef: 'F', voices: [createVoice(lower.map((c) => createMeasure(c)))] });
  const guitar = createStaff({ type: 'tab', voices: [createVoice(tab.map((c) => createMeasure(c)))] });
  const movement = createMovement({
    title: 'Paroles',
    masterbars: Array.from({ length: MEASURES }, (_, i) => createMasterbar({ barType: i === MEASURES - 1 ? 'final' : 'simple' })),
    tracks: [createTrack({ name: 'Chant', abbreviation: 'Ch.', staves: [voice] }), createTrack({ name: 'Seconde voix', abbreviation: '2e', staves: [second] }), createTrack({ name: 'Piano', abbreviation: 'Pno', staves: [bass] }), createTrack({ name: 'Guitare', abbreviation: 'Gtr', staves: [guitar] })],
  });
  return createWork({ title: 'Paroles', movements: [movement], props: { [PID.LYRIC_TEXTS]: [...verses, high] } });
}

/**
 * Démo de la saisie de notes à la souris / au doigt (tranche « saisie de notes, interface ») : six portées de types différents, presque vides, pour
 * essayer chaque geste. Armure : do (mesures 1-2), sol (3-4), fa (5-6), do (7-8). Clés : sol, fa, ut 3 ; tablature standard ; batterie (percmap par
 * défaut) ; portée rythmique. La 1re mesure de la portée en sol contient déjà do-mi-sol (noire, noire, blanche) pour essayer remplacer / ajouter à un accord.
 */
export function sampleNoteEntryWork() {
  resetIds();
  const MEASURES = 8;
  const empties = (type, first) => createVoice(Array.from({ length: MEASURES }, (_, i) => (i === 0 && first ? createMeasure(first) : createEmptyMeasure(type))));
  const keys = [0, 0, 1, 1, -1, -1, 0, 0];
  const treble = createStaff({
    type: 'score', clef: 'G',
    voices: [empties('score', [createNoteChord([{ step: 'C', octave: 5 }]), createNoteChord([{ step: 'E', octave: 5 }]), createNoteChord([{ step: 'G', octave: 5 }], { duration: 'half' })])],
  });
  const movement = createMovement({
    title: 'Saisie de notes',
    masterbars: keys.map((keySig, i) => createMasterbar({ timeSig: [4, 4], keySig, barType: i === MEASURES - 1 ? 'final' : 'simple' })),
    tracks: [
      createTrack({ name: 'Mélodie (sol)', abbreviation: 'Mél', staves: [treble] }),
      createTrack({ name: 'Basse (fa)', abbreviation: 'Bas', staves: [createStaff({ type: 'score', clef: 'F', voices: [empties('score')] })] }),
      createTrack({ name: 'Alto (ut 3)', abbreviation: 'Alt', staves: [createStaff({ type: 'score', clef: 'C3', voices: [empties('score')] })] }),
      createTrack({ name: 'Guitare (tablature)', abbreviation: 'Gtr', staves: [createStaff({ type: 'tab', voices: [empties('tab')] })] }),
      createTrack({ name: 'Batterie', abbreviation: 'Bat', staves: [createStaff({ type: 'percussion', clef: 'PERC', voices: [empties('percussion')] })] }),
      createTrack({ name: 'Rythme', abbreviation: 'Ryt', staves: [createStaff({ type: 'rhythm', voices: [empties('rhythm')] })] }),
      // grand staff d'accordéon : main droite en clé de sol (saisie possible), main gauche = clé spéciale à boutons (affichage ; saisie à venir)
      createTrack({
        name: 'Accordéon (grand staff)', abbreviation: 'Acc',
        staves: [
          createStaff({ type: 'score', clef: 'G', voices: [empties('score')] }),
          createStaff({ type: 'accordion-left', voices: [createVoice(Array.from({ length: MEASURES }, (_, i) => createMeasure(accordionItems(ACCORDION_DEMO[i % ACCORDION_DEMO.length]))))] }),
        ],
      }),
    ],
  });
  return createWork({ title: 'Saisie de notes', movements: [movement] });
}

/**
 * STRESS work (17/10/2026): a long, dense piece made on purpose to feel and measure what a re-layout costs after an edit (is a layout cache worth it?).
 * 96 measures (default) × 9 staves of every kind that costs something to lay out: piano (2 staves), guitar (notation + tablature), accordion
 * (right hand + Stradella left hand), violin in sixteenths (beams), drum kit (2 voices), chord symbols; dynamics, hairpins, slurs, articulations on
 * most measures, sections of the form, tempos. Nothing here is musical: it is a load.
 */
export function sampleStressWork({ measures = 96, copies = 1 } = {}) {
  resetIds();
  const N = measures;
  const masterbars = Array.from({ length: N }, (_, i) => createMasterbar({ keySig: 3, barType: i === N - 1 ? 'final' : (i + 1) % 8 === 0 ? 'double' : 'simple' }));
  const dynamics = ['mp', 'mf', 'f', 'p', 'ff', 'pp'];
  // marks on the chords of one staff measure: dynamic, articulations, a slur and a hairpin (the lists are those of the staff)
  const marked = (items, m, lists) => {
    const chords = items.filter((it) => it.type === 'chord');
    if (!chords.length) return items;
    if (m % 4 === 0) chords[0].props[PID.DYNAMIC] = dynamics[(m / 4) % dynamics.length];
    if (m % 3 === 0 && chords[1]) chords[1].props[PID.ARTICULATIONS] = [createArticulation('staccato')];
    if (m % 5 === 0 && chords[2]) chords[2].props[PID.ARTICULATIONS] = [createArticulation('accent')];
    if (m % 2 === 1 && chords.length >= 3) lists.slurs.push(createSlur(chords[0].id, chords[2].id));
    if (m % 4 === 1 && chords.length >= 2) lists.hairpins.push(createHairpin(chords[0].id, chords[chords.length - 1].id, (m >> 2) % 2 ? 'decresc' : 'cresc'));
    return items;
  };
  const scoreStaff = (key, clef) => {
    const lists = { slurs: [], hairpins: [] };
    const bars = Array.from({ length: N }, (_, m) => createMeasure(marked(scoreItems(DEMO_CYCLE[key][m % 4]), m, lists)));
    return createStaff({ clef, props: { [PID.SLURS]: lists.slurs, [PID.HAIRPINS]: lists.hairpins }, voices: [createVoice(bars)] });
  };
  const plainVoice = (key, toItems) => createVoice(Array.from({ length: N }, (_, m) => createMeasure(toItems(DEMO_CYCLE[key][m % 4]))));
  const run = ['A4', 'B4', 'C#5', 'D5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5', 'E5', 'D5', 'C#5', 'B4', 'A4'];
  const violinStaff = () => {
    const lists = { slurs: [], hairpins: [] };
    const bars = Array.from({ length: N }, (_, m) => createMeasure(marked(scoreItems(run.map((n) => `${m % 2 ? n.replace(/(\d)$/, (d) => String(Number(d) + 1)) : n}/16`).join(' ')), m, lists)));
    return createStaff({ clef: 'G', props: { [PID.SLURS]: lists.slurs, [PID.HAIRPINS]: lists.hairpins }, voices: [createVoice(bars)] });
  };
  const hit = (sounds, duration) => createChord({ duration, notes: sounds.map((id) => createPercNote({ sound: id })) });
  const drumVoices = () => {
    const hat = []; const kick = [];
    for (let m = 0; m < N; m++) {
      if (m % 4 === 3) hat.push(createMeasure([hit(['crashCymbal1', 'bassDrum1'], 'quarter'), ...Array.from({ length: 4 }, () => hit(['acousticSnare'], 'sixteenth')), hit(['closedHiHat'], 'eighth'), hit(['acousticSnare'], 'eighth'), hit(['highTom'], 'eighth'), hit(['lowFloorTom'], 'eighth')]));
      else hat.push(createMeasure(Array.from({ length: 8 }, (_, i) => hit(i === 2 || i === 6 ? ['closedHiHat', 'acousticSnare'] : [m % 2 && i === 7 ? 'openHiHat' : 'closedHiHat'], 'eighth'))));
      kick.push(m % 4 === 3 ? createEmptyMeasure('percussion') : createMeasure([hit(['bassDrum1'], 'quarter'), createRest({ duration: 'quarter' }), hit(['bassDrum1'], 'quarter'), createRest({ duration: 'quarter' })]));
    }
    return [createVoice(hat), createVoice(kick)];
  };
  const note = (s) => { const mm = /^([A-G])([#b]?)$/.exec(s); return { step: mm[1], alter: mm[2] === '#' ? 1 : mm[2] === 'b' ? -1 : 0 }; };
  const progression = [['A', ''], ['F#', 'm7'], ['D', 'M7'], ['E', '7'], ['B', 'm7'], ['E', '7b9'], ['C#', 'm7b5'], ['F#', '7#9']];
  const beats = [[0, 1], [1, 4], [1, 2], [3, 4]];
  // only ONE chord track per movement, and it is the first track (decided with Jean, 18/10/2026)
  const chordBars = Array.from({ length: N }, (_, m) => createMeasure(beats.map((pos, k) => { const [r, q] = progression[(m * 4 + k) % progression.length]; return createChordSymbol({ root: note(r), quality: q, position: pos, duration: 'quarter' }); })));
  const makeTracks = (c) => {
    const sfx = c ? ` ${c + 1}` : '';
    return [
    createTrack({ name: `Piano${sfx}`, abbreviation: 'Pno', staves: [scoreStaff('rightHand', 'G'), scoreStaff('leftHand', 'F')] }),
    createTrack({ name: `Guitare${sfx}`, abbreviation: 'Gt', staves: [scoreStaff('guitar', 'G'), createStaff({ type: 'tab', voices: [plainVoice('guitar', tabItems)] })] }),
    createTrack({ name: `Accordéon${sfx}`, abbreviation: 'Acc', staves: [scoreStaff('accordionRight', 'G'), createStaff({ type: 'accordion-left', voices: [plainVoice('accordionLeft', accordionItems)] })] }),
    createTrack({ name: `Violon${sfx}`, abbreviation: 'Vl', staves: [violinStaff()] }),
    createTrack({ name: `Batterie${sfx}`, abbreviation: 'Bat', staves: [createStaff({ type: 'percussion', clef: 'G', voices: drumVoices() })] }),
  ];
  };
  const tracks = [createTrack({ name: 'Accords', abbreviation: 'Ch', staves: [createStaff({ type: 'chord', voices: [createVoice(chordBars)] })] }), ...Array.from({ length: copies }, (_, c) => makeTracks(c)).flat()];
  const sections = []; const tempos = [];
  for (let m = 0; m < N; m += 8) {
    const chorus = (m / 8) % 2 === 1;
    sections.push(createSystemContainer({ measureId: masterbars[m].id, kind: 'section', label: chorus ? 'Refrain' : 'Couplet', category: chorus ? 'chorus' : 'verse' }));
  }
  for (let m = 0; m < N; m += 32) tempos.push(createTempo({ measureId: masterbars[m].id, bpm: m % 64 ? 132 : 108 }));
  const movement = createMovement({ title: 'Charge', masterbars, tracks, tempos, systemContainers: sections });
  return createWork({ title: `Œuvre de charge — ${N} mesures × ${tracks.flatMap((t) => t.staves).length} portées`, movements: [movement] });
}

/** Linked staves: a guitar notation staff with a linked tablature and a linked rhythm staff (they store no content: they show the notation staff). One note asks for a string. */
export function sampleLinkedWork() {
  resetIds();
  const n = (step, octave, alter = 0, props = {}) => createNote({ step, alter, octave, props });
  const q = (notes, duration = 'quarter') => createChord({ duration, notes });
  const hinted = n('C', 4, 0, { [PID.TAB_STRING]: 3 }); // C4 on the third string (fret 5) instead of the second (fret 1)
  const a = q([n('E', 3)]); const b = q([n('G', 3)]); const c = q([hinted]); const d = q([n('E', 4), n('G', 4)]);
  const e = q([n('A', 3)], 'half'); const f = q([n('E', 3)], 'half');
  const g = q([n('G', 3)], 'half'); const h = q([n('B', 3)], 'half');
  const tied = q([n('E', 3)], 'whole');
  const lists = { [PID.SLURS]: [createSlur(a.id, d.id)], [PID.TIES]: [createTie(f.notes[0].id, tied.notes[0].id)], [PID.HAIRPINS]: [createHairpin(e.id, h.id, 'cresc')] };
  const notation = createStaff({
    type: 'score', props: lists,
    voices: [createVoice([createMeasure([a, b, c, d]), createMeasure([e, f]), createMeasure([g, h]), createMeasure([tied])])],
  });
  const tab = createStaff({ type: 'tab', voices: [], props: { [PID.LINKED_TO]: notation.id, [PID.TUNING]: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'] } });
  const rhythm = createStaff({ type: 'rhythm', voices: [], props: { [PID.LINKED_TO]: notation.id } }); // a rhythm staff linked to the notation: only its rhythm
  const track = createTrack({ name: 'Guitare', abbreviation: 'Gt', staves: [notation, tab, rhythm], props: { [PID.INSTRUMENT_ID]: 'guitar-nylon' } });
  const masterbars = Array.from({ length: 4 }, (_, i) => createMasterbar({ barType: i === 3 ? 'final' : 'simple' }));
  return createWork({ title: 'Portées liées', movements: [createMovement({ title: 'Portée de notation et tablature liée', masterbars, tracks: [track] })] });
}

/**
 * Démo des MOTIFS D'ACCORDS (29/10/2026) : la même grille de huit mesures, jouée par sept « scènes » (un mouvement chacune) pour comparer à l'oreille les cartes et les motifs :
 * piano serré / drop 2 / sans basse (avec une basse électrique), guitare grattée (ballade, carte Folk), guitare en arpège sur le doigté, le même arpège avec la tierce à la basse, basse marchée, puis une scène de batterie (16 mesures, deux sections : breaks, coups en plus, crash au refrain).
 * La piste d'accords joue avec son propre joueur ; une autre piste (la basse de la scène 3) a le sien ; le son des symboles d'accord doit être actif pour entendre le résultat.
 * Les motifs et les cartes qui ne sont pas intégrés sont ceux du PROJET (`PID.CHORD_PATTERNS`, `PID.STRUM_CARDS`).
 */
export function sampleChordPatternsWork() {
  resetIds();
  const note = (s) => ({ step: s[0], alter: s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0 });
  const grid = [['C', ''], ['A', 'm'], ['D', 'm7'], ['G', '7'], ['C', 'M7'], ['F', 'M7'], ['C', '', 'E'], ['F', '']];
  const f = (n, d) => [n, d];
  const arpeggio = createChordPattern({
    id: 'demo-arpeggio', name: 'Arpège 1 – 5 – 3 – 5', length: f(1, 1),
    hits: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ at: f(k, 8), dur: f(1, 8), parts: [['B', '5', '3', '5', 'B', '5', '3', '5'][k]] })),
  });
  const cards = [
    createStrumCard({ id: 'demo-drop2', name: 'Piano : drop 2', kind: 'piano', spacing: 'drop2' }),
    createStrumCard({ id: 'demo-rootless', name: 'Piano : sans basse', kind: 'piano', skipBass: 1 }),
    createStrumCard({ id: 'demo-third', name: 'Standard : tierce à la basse', bassDegree: '3' }),
  ];
  // `main` = the instrument the CHORD track plays with its own player; `extra` = other tracks, each with its own player (the chords always come from the chord track)
  const scenes = [
    { title: 'Piano : carte Piano (voix serrées)', main: { sound: 'piano', pattern: 'ballad' } },
    { title: 'Piano : écartement drop 2', main: { sound: 'piano', pattern: 'ballad', card: 'demo-drop2' } },
    { title: 'Piano sans basse + basse électrique', main: { sound: 'piano', pattern: 'ballad', card: 'demo-rootless' },
      extra: [{ name: 'Basse électrique', abbreviation: 'Bs', sound: 'bass-guitar', clef: 'F', pattern: 'bass-root-fifth', card: 'bass' }] },
    { title: 'Guitare : ballade grattée (carte Folk)', main: { sound: 'guitar-steel', pattern: 'ballad', card: 'folk' } },
    { title: 'Guitare : arpège sur le doigté', main: { sound: 'guitar-steel', pattern: 'demo-arpeggio', card: 'standard' } },
    { title: 'Guitare : arpège, tierce à la basse', main: { sound: 'guitar-steel', pattern: 'demo-arpeggio', card: 'demo-third' } },
    { title: 'Basse électrique : fondamentale et quinte', main: { sound: 'bass-guitar', pattern: 'bass-root-fifth', card: 'bass' } },
    { title: 'Basse électrique : marche simple', main: { sound: 'bass-guitar', pattern: 'bass-walking', card: 'bass' } },
    // sixteen bars, two sections: the drums break more at the end of a section, crash at the start of the chorus, and not twice at the same place from one verse to the next
    { title: 'Batterie : rock en croches, breaks et crash de section', main: { sound: 'piano', pattern: 'ballad' }, repeat: 2, sections: [[0, 'Couplet', 'verse'], [8, 'Refrain', 'chorus']],
      extra: [{ name: 'Batterie', abbreviation: 'Dr', sound: 'drum-kit-5', drums: true, pattern: 'rock8', card: 'drums' }] },
  ];
  const player = (t) => ({ [PID.PLAYER_PATTERN]: t.pattern, ...(t.card ? { [PID.PLAYER_CARD]: t.card } : {}) });
  const movements = scenes.map((scene) => {
    const bars = Array.from({ length: grid.length * (scene.repeat ?? 1) }, (_, i) => grid[i % grid.length]);
    const masterbars = bars.map((_, i) => createMasterbar({ barType: i === bars.length - 1 ? 'final' : 'simple' }));
    const chordStaff = createStaff({
      type: 'chord',
      voices: [createVoice(bars.map(([root, quality, bass]) => createMeasure([createChordSymbol({ root: note(root), quality, bass: bass ? note(bass) : null, position: [0, 1], duration: 'whole' })])))],
    });
    const tracks = [
      createTrack({ name: 'Accords', abbreviation: 'Ch', props: { [PID.INSTRUMENT_ID]: scene.main.sound, ...player(scene.main) }, staves: [chordStaff] }),
      ...(scene.extra ?? []).map((t) => createTrack({
        name: t.name, abbreviation: t.abbreviation, props: { [PID.INSTRUMENT_ID]: t.sound, ...player(t) },
        staves: [t.drums ? createStaff({ type: 'percussion', voices: [createVoice(bars.map(() => createEmptyMeasure('percussion')))] }) : createStaff({ clef: t.clef ?? 'G', voices: [createVoice(bars.map(() => createEmptyMeasure('score')))] })], // an empty staff: the player plays by itself
      })),
    ];
    const systemContainers = (scene.sections ?? []).map(([at, label, category]) => createSystemContainer({ measureId: masterbars[at].id, kind: 'section', label, category }));
    return createMovement({ title: scene.title, masterbars, systemContainers, tempos: [createTempo({ measureId: masterbars[0].id, bpm: 96 })], tracks });
  });
  return createWork({ title: "Motifs d'accords : piano, guitare, basse", movements, props: { [PID.CHORD_PATTERNS]: [arpeggio], [PID.STRUM_CARDS]: cards } });
}
