// Texts of the note component (kept apart from the editor's catalogs: the component ships alone). Language = `lang` attribute, then French.
const TEXTS = {
  fr: {
    play: 'Écouter', stop: 'Arrêter', loop: 'Boucle', transpose: 'Transposition', speed: 'Vitesse', size: 'Taille',
    less: 'Moins', more: 'Plus', error: 'Cette partition ne peut pas être affichée.', empty: 'Aucune partition.', semitones: 'demi-tons', score: 'Partition',
  },
  en: {
    play: 'Play', stop: 'Stop', loop: 'Loop', transpose: 'Transposition', speed: 'Speed', size: 'Size',
    less: 'Less', more: 'More', error: 'This score cannot be shown.', empty: 'No score.', semitones: 'semitones', score: 'Score',
  },
};
export const noteText = (lang, key) => (TEXTS[lang] ?? TEXTS.fr)[key] ?? key;

// editor texts (merged into the same tables)
Object.assign(TEXTS.fr, {
  undo: 'Annuler', redo: 'Rétablir', addMeasure: 'Ajouter une mesure', removeMeasure: 'Retirer la dernière mesure', measures: 'Mesures', rest: 'Silence', dot: 'Pointée',
  whole: 'Ronde', half: 'Blanche', quarter: 'Noire', eighth: 'Croche', '16th': 'Double croche', settings: 'Réglages de la portée', clef: 'Clé', clefG: 'Sol', clefF: 'Fa', timeSig: 'Chiffrage', key: 'Armure',
  confirmReset: 'Changer ceci efface la partition écrite.', confirm: 'Effacer et changer', cancel: 'Annuler', tapHint: 'Touchez la portée pour poser une note.', placed: 'Note posée', cannot: 'Impossible ici', done: 'Terminé',
});
Object.assign(TEXTS.en, {
  undo: 'Undo', redo: 'Redo', addMeasure: 'Add a measure', removeMeasure: 'Remove the last measure', measures: 'Measures', rest: 'Rest', dot: 'Dotted',
  whole: 'Whole', half: 'Half', quarter: 'Quarter', eighth: 'Eighth', '16th': 'Sixteenth', settings: 'Staff settings', clef: 'Clef', clefG: 'Treble', clefF: 'Bass', timeSig: 'Time signature', key: 'Key',
  confirmReset: 'Changing this erases what is written.', confirm: 'Erase and change', cancel: 'Cancel', tapHint: 'Tap the staff to place a note.', placed: 'Note placed', cannot: 'Not possible here', done: 'Done',
});

Object.assign(TEXTS.fr, { textPlaceholder: 'Titre ou consigne (facultatif)', textLabel: 'Texte au-dessus de la partition', textCount: 'caractères' });
Object.assign(TEXTS.en, { textPlaceholder: 'Title or instructions (optional)', textLabel: 'Text above the score', textCount: 'characters' });
Object.assign(TEXTS.fr, {
  setup: 'Type de portée et mesure', close: 'Fermer', type: 'Type de portée', kindScore: 'Notation', kindPiano: 'Piano', kindGuitar: 'Guitare (tablature)', kindBass: 'Basse (tablature)', kindDrums: 'Batterie',
  sound: 'Son', soundElectric: 'Électrique', soundAcoustic: 'Acoustique', soundNylon: 'Nylon', strings: 'Cordes', tuning: 'Accordage', capo: 'Capodastre', fret: 'Case',
  tuningStandard: 'Standard', tuningDropD: 'Drop D', tuningHalfDown: 'Un demi-ton plus bas', tuningDadgad: 'DADGAD', tuningOpenG: 'Sol ouvert', none: 'Aucun',
});
Object.assign(TEXTS.en, {
  setup: 'Staff type and meter', close: 'Close', type: 'Staff type', kindScore: 'Notation', kindPiano: 'Piano', kindGuitar: 'Guitar (tab)', kindBass: 'Bass (tab)', kindDrums: 'Drums',
  sound: 'Sound', soundElectric: 'Electric', soundAcoustic: 'Acoustic', soundNylon: 'Nylon', strings: 'Strings', tuning: 'Tuning', capo: 'Capo', fret: 'Fret',
  tuningStandard: 'Standard', tuningDropD: 'Drop D', tuningHalfDown: 'Half step down', tuningDadgad: 'DADGAD', tuningOpenG: 'Open G', none: 'None',
});

Object.assign(TEXTS.fr, { measure: 'Mesure', previous: 'Mesure précédente', next: 'Mesure suivante', modeWrite: 'Écrire', modeSelect: 'Choisir', delete: 'Supprimer', selected: 'Note choisie', nothing: 'Rien de choisi' });
Object.assign(TEXTS.en, { measure: 'Measure', previous: 'Previous measure', next: 'Next measure', modeWrite: 'Write', modeSelect: 'Select', delete: 'Delete', selected: 'Note selected', nothing: 'Nothing selected' });

// names of the drum sounds (by sound id of Scorsaire's drum map, plus the ids of the small kit older notes were written with); English falls back to the map's own name
const DRUMS_FR = {
  splashCymbal: 'Cymbale splash', crashCymbal1: 'Cymbale crash 1', crashCymbal2: 'Cymbale crash 2', chinaCymbal: 'Cymbale china', closedHiHat: 'Charleston fermé', openHiHat: 'Charleston ouvert',
  rideCymbal1: 'Cymbale ride 1', rideBell: 'Cloche de ride', highTom: 'Tom aigu', hiMidTom: 'Tom medium aigu', tambourine: 'Tambourin', cowbell: 'Cloche à vache', lowMidTom: 'Tom medium grave',
  rideCymbal2: 'Cymbale ride 2', acousticSnare: 'Caisse claire', sideStick: 'Cross-stick', electricSnare: 'Caisse claire électrique', lowTom: 'Tom grave', highFloorTom: 'Tom basse aigu',
  lowFloorTom: 'Tom basse grave', bassDrum1: 'Grosse caisse 1', bassDrum2: 'Grosse caisse 2', pedalHiHat: 'Charleston pédale',
  bassDrum: 'Grosse caisse', snare: 'Caisse claire', crossStick: 'Cross-stick', rideCymbal: 'Ride', crashCymbal: 'Crash', floorTom: 'Tom basse',
};
export const drumName = (lang, id, fallback) => (lang === 'en' ? fallback : DRUMS_FR[id]) ?? fallback ?? id;
Object.assign(TEXTS.fr, { sounds: 'Sons de batterie' });
Object.assign(TEXTS.en, { sounds: 'Drum sounds' });

Object.assign(TEXTS.fr, { chords: 'Accords', chord: 'Accord', root: 'Fondamentale', quality: 'Qualité', cells: 'Cases', erase: 'Effacer', sharps: 'Dièses', flats: 'Bémols', chooseRoot: 'Choisissez d’abord une fondamentale.', maj: 'maj' });
Object.assign(TEXTS.en, { chords: 'Chords', chord: 'Chord', root: 'Root', quality: 'Quality', cells: 'Slots', erase: 'Clear', sharps: 'Sharps', flats: 'Flats', chooseRoot: 'Pick a root first.', maj: 'maj' });

Object.assign(TEXTS.fr, { namesLetters: 'Écrire en lettres (C D E)', namesSolfege: 'Écrire en do ré mi' });
Object.assign(TEXTS.en, { namesLetters: 'Write as letters (C D E)', namesSolfege: 'Write as do re mi' });

Object.assign(TEXTS.fr, {
  instrument: 'Instrument', inst_none: 'Aucun', inst_flute: 'Flûte', inst_violin: 'Violon', inst_cello: 'Violoncelle', inst_trombone: 'Trombone', inst_sopranoSax: 'Sax soprano', inst_altoSax: 'Sax alto', inst_tenorSax: 'Sax ténor',
  inst_baritoneSax: 'Sax baryton', inst_clarinet: 'Clarinette si♭', inst_trumpet: 'Trompette si♭', inst_horn: 'Cor en fa', writing: 'Écriture', written: 'Transposée', concertPitch: 'Son réel', display: 'Affichage',
});
Object.assign(TEXTS.en, {
  instrument: 'Instrument', inst_none: 'None', inst_flute: 'Flute', inst_violin: 'Violin', inst_cello: 'Cello', inst_trombone: 'Trombone', inst_sopranoSax: 'Soprano sax', inst_altoSax: 'Alto sax', inst_tenorSax: 'Tenor sax',
  inst_baritoneSax: 'Baritone sax', inst_clarinet: 'B♭ clarinet', inst_trumpet: 'B♭ trumpet', inst_horn: 'Horn in F', writing: 'Written', written: 'Transposed', concertPitch: 'Concert pitch', display: 'Display',
});

Object.assign(TEXTS.fr, { viewSettings: 'Réglages' });
Object.assign(TEXTS.en, { viewSettings: 'Settings' });
Object.assign(TEXTS.fr, { loadingSound: 'Chargement du son…', playChords: 'Lire les accords', soundFailed: 'Le son complet n’a pas pu être chargé : son simple utilisé.' });
Object.assign(TEXTS.en, { loadingSound: 'Loading the sound…', playChords: 'Play the chords', soundFailed: 'The full sound could not be loaded: plain sound used.' });

Object.assign(TEXTS.fr, { clefC3: 'Alto', clefC4: 'Ténor', inst_viola: 'Alto (violon alto)', shortGuitar: 'Guitare', shortBass: 'Basse', shortDrums: 'Batterie', cycleKind: 'Type de portée : touchez pour changer' });
Object.assign(TEXTS.en, { clefC3: 'Alto', clefC4: 'Tenor', inst_viola: 'Viola', shortGuitar: 'Guitar', shortBass: 'Bass', shortDrums: 'Drums', cycleKind: 'Staff type: tap to change' });

Object.assign(TEXTS.fr, {"abbrPiano": "Pno", "abbrGuitar": "Gtr (tab)", "abbrBass": "Bss (tab)", "abbrDrums": "Drms", "shortGuitar": "Gtr", "shortBass": "Bss", "shortDrums": "Drms", "kindPiano": "Pno", "modeSelectShort": "Sél", "deleteShort": "Sup", "chordsShort": "C7", "zoomTwice": "Agrandir ×2", "zoomBack": "Taille normale", "back": "Retour", "pickInstrument": "Instrument", "pickTimeSig": "Chiffrage", "sectionStrings": "Cordes", "sectionWoodwinds": "Bois", "sectionBrass": "Cuivres", "abbr_none": "Aucun", "abbr_violin": "Vln", "abbr_viola": "Vla", "abbr_cello": "Vc", "abbr_flute": "Fl", "abbr_clarinet": "Cl", "abbr_sopranoSax": "Sax S", "abbr_altoSax": "Sax A", "abbr_tenorSax": "Sax T", "abbr_baritoneSax": "Sax B", "abbr_trumpet": "Tpt", "abbr_horn": "Cor", "abbr_trombone": "Tbn"});
Object.assign(TEXTS.en, {"abbrPiano": "Pno", "abbrGuitar": "Gtr (tab)", "abbrBass": "Bss (tab)", "abbrDrums": "Drms", "shortGuitar": "Gtr", "shortBass": "Bss", "shortDrums": "Drms", "kindPiano": "Pno", "modeSelectShort": "Sel", "deleteShort": "Del", "chordsShort": "C7", "zoomTwice": "Zoom ×2", "zoomBack": "Normal size", "back": "Back", "pickInstrument": "Instrument", "pickTimeSig": "Time signature", "sectionStrings": "Strings", "sectionWoodwinds": "Woodwinds", "sectionBrass": "Brass", "abbr_none": "None", "abbr_violin": "Vln", "abbr_viola": "Vla", "abbr_cello": "Vc", "abbr_flute": "Fl", "abbr_clarinet": "Cl", "abbr_sopranoSax": "Sax S", "abbr_altoSax": "Sax A", "abbr_tenorSax": "Sax T", "abbr_baritoneSax": "Sax B", "abbr_trumpet": "Tpt", "abbr_horn": "Hn", "abbr_trombone": "Tbn"});

Object.assign(TEXTS.fr, { semitoneUp: 'Un demi-ton plus haut', semitoneDown: 'Un demi-ton plus bas' });
Object.assign(TEXTS.en, { semitoneUp: 'A semitone higher', semitoneDown: 'A semitone lower' });

Object.assign(TEXTS.fr, { bass: 'Basse', noBass: 'Sans basse' });
Object.assign(TEXTS.en, { bass: 'Bass', noBass: 'No bass note' });

Object.assign(TEXTS.fr, {"theme": "Thème", "theme_auto": "Auto", "theme_light": "Clair", "theme_dark": "Sombre"});
Object.assign(TEXTS.en, {"theme": "Theme", "theme_auto": "Auto", "theme_light": "Light", "theme_dark": "Dark"});

Object.assign(TEXTS.fr, {"edit": "Éditer", "fretPage": "Autres cases", "close": "Fermer", "closeAria": "Fermer sans enregistrer", "err_format": "Ce document n'est pas une phrase musicale du bloc-notes.", "err_version": "La version de ce document n'est pas valide.", "err_newer": "Ce document vient d'une version plus récente du bloc-notes.", "err_work": "La partition de ce document est illisible.", "err_thumb": "L'image d'aperçu de ce document est invalide ou trop lourde.", "err_text": "Le texte au-dessus de la partition doit faire 1000 caractères au plus.", "err_size": "Ce document est trop volumineux (64 Ko au plus).", "err_json": "Ce document est illisible.", "err_movements": "Une phrase musicale ne contient qu'un seul morceau.", "err_measures": "Une phrase musicale compte de 1 à 4 mesures.", "err_sound": "Le son n'a pas pu être chargé : la lecture utilise un son plus simple.", "err_entry": "Cette note n'a pas pu être écrite.", "err_unknown": "Une erreur est survenue dans le bloc-notes."});
Object.assign(TEXTS.en, {"edit": "Edit", "fretPage": "Other frets", "close": "Close", "closeAria": "Close without saving", "err_format": "This document is not a note-pad phrase.", "err_version": "The version of this document is not valid.", "err_newer": "This document comes from a newer version of the note pad.", "err_work": "The score in this document cannot be read.", "err_thumb": "The preview image of this document is invalid or too large.", "err_text": "The text above the score must be 1000 characters at most.", "err_size": "This document is too large (64 KB at most).", "err_json": "This document cannot be read.", "err_movements": "A phrase holds one piece only.", "err_measures": "A phrase holds 1 to 4 measures.", "err_sound": "The sound could not be loaded: playback uses a simpler sound.", "err_entry": "This note could not be written.", "err_unknown": "An error occurred in the note pad."});
/** The detail of an `error` event: a code, a message in the component's language (the portal shows it as it is), and the technical cause apart. */
export const noteError = (lang, code, cause) => { const key = `err_${code}`; const known = (TEXTS[lang] ?? TEXTS.fr)[key]; return { code, message: known ?? noteText(lang, 'err_unknown'), cause: String(cause ?? '') }; };

Object.assign(TEXTS.fr, {"grid.undo": "Annuler (dans la grille)", "grid.redo": "Refaire (dans la grille)", "grid.nudge": "Déplacer la frappe sur la portée", "grid.nudgeUp": "Monter d'une position sur la portée", "grid.nudgeDown": "Descendre d'une position sur la portée", "grid.nudgeClose": "Fermer", "grid.title": "Saisie sur grille", "grid.commit": "Valider", "grid.cancel": "Annuler", "grid.beatCells": "Grille du temps", "grid.beatCells.n": "{n} cases", "grid.chooseBeat": "Touchez le nombre au-dessus d'un temps pour changer sa grille.", "grid.locked": "Ce temps contient des frappes hors grille : choisissez-lui une grille.", "grid.dropped": "{n} frappe(s) hors de la nouvelle grille retirée(s).", "grid.error": "Écriture impossible : {msg}", "gridButton": "Grille", "gridHint": "Saisie sur grille : posez les départs des notes, les durées s'écrivent en validant."});
Object.assign(TEXTS.en, {"grid.undo": "Undo (in the grid)", "grid.redo": "Redo (in the grid)", "grid.nudge": "Move the hit on the staff", "grid.nudgeUp": "Move up one position on the staff", "grid.nudgeDown": "Move down one position on the staff", "grid.nudgeClose": "Close", "grid.title": "Grid entry", "grid.commit": "Apply", "grid.cancel": "Cancel", "grid.beatCells": "Beat grid", "grid.beatCells.n": "{n} cells", "grid.chooseBeat": "Tap the number above a beat to change its grid.", "grid.locked": "This beat has off-grid hits: pick a grid for it.", "grid.dropped": "{n} hit(s) outside the new grid removed.", "grid.error": "Cannot write: {msg}", "gridButton": "Grid", "gridHint": "Grid entry: put the starts of the notes, the durations are written when you apply."});
