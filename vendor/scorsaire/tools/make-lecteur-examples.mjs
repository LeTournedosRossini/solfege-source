#!/usr/bin/env node
/*
 * Writes the example recueils of the Lecteur into the public repository (`../scorsaire-lecteur/exemples/`, or the folder given): `node tools/make-lecteur-examples.mjs [folder]`.
 *   - paroles.scorsaire-recueil : one original song (16 measures, C G Am F | C G F G | C G Am F | C G F C) with its melody, its chord track and two verses of lyrics,
 *     to try the songbook view (the "Paroles" button of the menu).
 *     The recueil also holds the same kind of song written ON THE GRID: no melody at all, only the chord track and a text with « | » between the measures.
 *     And a third song that is only text: a free text sheet, the chords written by hand in brackets (« [Am]lève »), no notes, no measures.
 * The works are made here, in code: nothing copyrighted, and the files can always be written again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDocument, createWork, createMovement, createMasterbar, createTrack, createStaff, createVoice, createMeasure, createNoteChord, createChordSymbol, createLyricText, createLyricLink,
  createRecueil, addEntry, serializeRecueil, serializeWork, parseLyricsText, PID, frac, setStrict,
} from '../src/model/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, '..', 'scorsaire-lecteur', 'exemples'));
fs.mkdirSync(out, { recursive: true });

function song() {
  setStrict(true);
  const C = { step: 'C', alter: 0 }; const G = { step: 'G', alter: 0 }; const A = { step: 'A', alter: 0 }; const F = { step: 'F', alter: 0 };
  const grid = [[C, ''], [G, ''], [A, 'm'], [F, ''], [C, ''], [G, ''], [F, ''], [G, '7'], [C, ''], [G, ''], [A, 'm'], [F, ''], [C, ''], [G, ''], [F, ''], [C, '']];
  const steps = ['E', 'G', 'A', 'G'];
  const notes = grid.map(() => steps.map((step) => createNoteChord([{ step, alter: 0, octave: 5 }], { duration: 'quarter' })));
  const symbols = grid.map(([root, quality]) => createChordSymbol({ root, quality, position: frac(0, 1), duration: 'whole' }));
  const verses = [
    "Le so-leil se lè-ve sur la col-li-ne\nLe vent chan-te bas dans les blés do-rés\nOn mar-che en-sem-ble sans savoir où va la route\nEt le ciel nous suit où que l'on aille",
    "La nuit tom-be dou-ce sur le vieux vil-la-ge\nLes lam-pes s'al-lu-ment l'une a-près l'au-tre\nOn chan-te en-co-re quand tout le monde s'en-dort\nEt la mu-si-que veille jus-qu'au ma-tin",
  ];
  const texts = verses.map((t, i) => createLyricText(i, t));
  const flat = notes.flat();
  const links = [];
  texts.forEach((t) => {
    t.text.split('\n').forEach((line, l) => parseLyricsText(line).forEach((_, k) => links.push(createLyricLink(t.id, links.filter((x) => x.textId === t.id).length, flat[l * 16 + k].id))));
  });
  const melody = createStaff({ type: 'score', voices: [createVoice(notes.map((m) => createMeasure(m)))], props: { [PID.LYRIC_LINKS]: links } });
  const chords = createStaff({ type: 'chord', voices: [createVoice(symbols.map((s) => createMeasure([s])))] });
  const work = createWork({ title: 'Chanson d\'essai', movements: [createMovement({ masterbars: grid.map(() => createMasterbar()), tracks: [createTrack({ name: 'Accords', staves: [chords] }), createTrack({ name: 'Mélodie', staves: [melody] })] })], props: { [PID.LYRIC_TEXTS]: texts } });
  return createDocument(work).work;
}

/** Same chords, no melody: the verse is written on the measures (« | » between them), the chord symbols come above the syllables by themselves. */
function gridSong() {
  setStrict(true);
  const C = { step: 'C', alter: 0 }; const G = { step: 'G', alter: 0 }; const A = { step: 'A', alter: 0 }; const F = { step: 'F', alter: 0 };
  const grid = [[C, ''], [G, ''], [A, 'm'], [F, ''], [C, ''], [G, ''], [F, ''], [C, '']];
  const symbols = grid.map(([root, quality]) => createChordSymbol({ root, quality, position: frac(0, 1), duration: 'whole' }));
  const chords = createStaff({ type: 'chord', voices: [createVoice(symbols.map((s) => createMeasure([s])))] });
  const masterbars = grid.map(() => createMasterbar());
  const text = createLyricText(0, "| Sur la rou-te | on s'en va | sans se re-tour-ner |\n| Le vent nous | pousse un peu | là-bas |", { measureId: masterbars[0].id });
  const work = createWork({ title: 'Chanson sur la grille', movements: [createMovement({ masterbars, tracks: [createTrack({ name: 'Accords', staves: [chords] })] })], props: { [PID.LYRIC_TEXTS]: [text] } });
  return createDocument(work).work;
}

/** Only words and chords: the verse is a free text sheet (ChordPro-like brackets), the work holds one empty measure. */
function sheetSong() {
  setStrict(true);
  const text = createLyricText(0, "[C]Dans la vallée [G]tout est [Am]calme\n[F]Le vent s'endort [C]doucement\n\n[Am]Chante encore [F]un peu\n[G]Avant que le [C]jour se lève");
  const work = createWork({ title: 'Chanson en texte libre', movements: [createMovement({ masterbars: [createMasterbar()], tracks: [] })], props: { [PID.LYRIC_TEXTS]: [text] } });
  return createDocument(work).work;
}

let recueil = addEntry(createRecueil({ title: 'Exemple avec paroles' }), { title: 'Chanson d\'essai', workText: serializeWork(song()) }).recueil;
recueil = addEntry(recueil, { title: 'Chanson sur la grille (sans mélodie)', workText: serializeWork(gridSong()) }).recueil;
recueil = addEntry(recueil, { title: 'Chanson en texte libre', workText: serializeWork(sheetSong()) }).recueil;
fs.writeFileSync(path.join(out, 'paroles.scorsaire-recueil'), serializeRecueil(recueil));
console.log(`écrit : ${path.join(out, 'paroles.scorsaire-recueil')}`);
