/*
 * MusicXML export, tranche X2: the marks of a staff (dynamics, hairpins, slurs, articulations, ornaments, tremolos, glissandos, breaths,
 * pedals, lyrics, fingerings, arpeggios, chord symbols) as MusicXML fragments. PURE: strings only.
 * Everything is looked up by element IDENTITY (chord id, note id) in a per-staff index built once.
 */
import { lyricEventsOf } from '../model/lyricevents.js';
import { fToNumber } from '../model/fraction.js';
import { diagramWindow, voicingBarres } from '../model/fretvoicing.js';
import { PID } from '../model/pid.js';
import { isRunEntry } from '../model/glissando.js';
import { getProperty } from '../model/props.js';
import { resolveLyricLinks } from '../model/lyrics.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** MusicXML dynamics elements that exist as such; every other Scorsaire / MuseScore type goes to <other-dynamics>. */
const DYNAMIC_ELEMENTS = new Set(['ppppp', 'pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'fffff', 'fp', 'fz', 'pf', 'rf', 'rfz', 'sf', 'sfp', 'sfpp', 'sfz', 'sffz', 'n']);
const ARTICULATION_ELEMENT = {
  staccato: ['staccato'], tenuto: ['tenuto'], accent: ['accent'], marcato: ['strong-accent'], staccatissimo: ['staccatissimo'],
  portato: ['detached-legato'], tenutoAccent: ['tenuto', 'accent'], accentStaccato: ['accent', 'staccato'],
};
// Scorsaire "mordent" is the glyph WITHOUT stroke (upper mordent) = MusicXML inverted-mordent; "mordentInverted" has the stroke = mordent
const ORNAMENT_ELEMENT = { mordent: 'inverted-mordent', mordentInverted: 'mordent', turn: 'turn', turnInverted: 'inverted-turn', trill: 'trill-mark' };
const FERMATA_SHAPE = { fermata: 'normal' };
const KIND_OF_QUALITY = {
  '': 'major', 5: 'power', m: 'minor', 7: 'dominant', M7: 'major-seventh', m7: 'minor-seventh', m7b5: 'half-diminished', o7: 'diminished-seventh', o: 'diminished',
  9: 'dominant-ninth', M9: 'major-ninth', m9: 'minor-ninth', 11: 'dominant-11th', 13: 'dominant-13th', 6: 'major-sixth', m6: 'minor-sixth',
  sus4: 'suspended-fourth', sus2: 'suspended-second', aug: 'augmented',
};
const ALTER = (a) => (a ? `<root-alter>${a}</root-alter>` : '');

/** A <direction> element: `inner` goes in <direction-type>; `offset` in divisions (0 = none); `staff` number (or null). */
export function direction(inner, { offset = 0, staff = null, sound = '', placement = 'below' } = {}) {
  return `<direction placement="${placement}"><direction-type>${inner}</direction-type>${offset ? `<offset>${offset}</offset>` : ''}${staff ? `<staff>${staff}</staff>` : ''}${sound}</direction>`;
}

/** The harmony element of a chord symbol (`offset` in divisions from the current position). */
/**
 * The `<frame>` of a chord diagram of a fretted instrument (`voicing`: model/fretvoicing.js). MusicXML numbers the strings from the HIGHEST (1) and gives the absolute fret of each
 * note plus the first fret of the window when it is not the nut; a muted string is simply absent, an open string is fret 0; a barre is marked on its two end strings.
 * Returns '' for a voicing that is not a fretted one (a piano has no frame).
 */
export function frameXml(voicing) {
  if (!voicing?.frets) return '';
  const n = voicing.frets.length;
  const win = diagramWindow(voicing.frets);
  const hi = Math.max(...voicing.frets);
  const barre = voicingBarres(voicing)[0] ?? null;
  const notes = [];
  for (let s = 1; s <= n; s++) { // string 1 = the highest = the last of the diagram order
    const i = n - s;
    const fret = voicing.frets[i];
    if (fret < 0) continue;
    const finger = voicing.fingers?.[i];
    const inBarre = barre && fret === barre.fret && i >= barre.from && i <= barre.to;
    notes.push({ s, i, fret, finger, inBarre });
  }
  const barred = notes.filter((e) => e.inBarre);
  const mark = (e) => (barred.length > 1 && e === barred[0] ? '<barre type="start"/>' : barred.length > 1 && e === barred[barred.length - 1] ? '<barre type="stop"/>' : '');
  return `<frame><frame-strings>${n}</frame-strings><frame-frets>${Math.max(4, win.nut ? hi : hi - win.first + 1)}</frame-frets>${win.nut ? '' : `<first-fret>${win.first}</first-fret>`}`
    + notes.map((e) => `<frame-note><string>${e.s}</string><fret>${e.fret}</fret>${e.finger ? `<fingering>${e.finger}</fingering>` : ''}${mark(e)}</frame-note>`).join('')
    + '</frame>';
}

export function harmonyXml(symbol, opts = {}) {
  return harmonyXmlOf({ special: getProperty(symbol, PID.CHORD_SPECIAL), root: getProperty(symbol, PID.CHORD_ROOT), quality: getProperty(symbol, PID.CHORD_QUALITY) ?? '', bass: getProperty(symbol, PID.CHORD_BASS) }, opts);
}

/** The same from the chord itself { root, quality, bass, special? } (a diagram container has a chord but no symbol). */
export function harmonyXmlOf({ special, root, quality = '', bass = null }, { offset = 0, staff = null, frame = '' } = {}) {
  if (special === 'repeat1' || special === 'repeat2') return '';
  const tail = `${offset ? `<offset>${offset}</offset>` : ''}${staff ? `<staff>${staff}</staff>` : ''}`;
  if (!root || special === 'noChord') return `<harmony><root><root-step>C</root-step></root><kind text="N.C.">none</kind>${tail}</harmony>`;
  const kind = KIND_OF_QUALITY[quality];
  const kindXml = kind ? `<kind text="${esc(quality)}">${kind}</kind>` : `<kind text="${esc(quality)}">other</kind>`;
  const bassXml = bass ? `<bass><bass-step>${bass.step}</bass-step>${bass.alter ? `<bass-alter>${bass.alter}</bass-alter>` : ''}</bass>` : '';
  return `<harmony><root><root-step>${root.step}</root-step>${ALTER(root.alter)}</root>${kindXml}${bassXml}${frame}${tail}</harmony>`;
}

const TECH_LINE_TEXT = { palmMute: 'P.M.', letRing: 'let ring', harmonicMark: 'Harm.', whammyBar: 'w/bar', vibrato: 'vib.' };
const CHORD_LINE_ELEMENT = { fall: 'falloff', doit: 'doit', plop: 'plop', scoop: 'scoop' };
const PICK_TECHNICAL = { pickDown: 'down-bow', pickUp: 'up-bow' }; // sens du médiator : <down-bow/> / <up-bow/>
const GUITAR_ARTICULATION = { golpe: 'golpe', golpeThumb: 'golpe (thumb)', slap: 'slap', pop: 'pop' };

/** Pitch of every note of the staff (grace notes included) and the first pitch of every chord, by identity. */
function pitchTables(staff) {
  const notePitch = new Map(); const chordPitch = new Map();
  for (const voice of staff.voices) for (const measure of voice.measures) for (const item of measure.items) {
    if (item.type !== 'chord') continue;
    for (const chord of [item, ...(item.graceNotes ?? [])]) {
      chord.notes.forEach((n, i) => {
        const p = n.props?.[PID.PITCH];
        if (p !== undefined) { notePitch.set(n.id, p); if (i === 0) chordPitch.set(chord.id, p); }
      });
    }
  }
  return { notePitch, chordPitch };
}

/**
 * Index of the marks of one staff. `chordIds` = the chords of the staff (for slurs: only those inside the exported movement).
 * @returns object of lookups used by the exporter (all keyed by element identity).
 */
export function staffMarkIndex(staff, { lyricTexts = [], measureIndexOf = () => -1 } = {}) {
  const wedgeStart = new Map(); const wedgeStop = new Map();
  (getProperty(staff, PID.HAIRPINS) ?? []).forEach((h, i) => {
    const number = (i % 6) + 1;
    wedgeStart.set(h.startChordId, [...(wedgeStart.get(h.startChordId) ?? []), { number, type: h.hairpinType === 'decresc' ? 'diminuendo' : 'crescendo' }]);
    wedgeStop.set(h.endChordId, [...(wedgeStop.get(h.endChordId) ?? []), { number }]);
  });
  const slurStart = new Map(); const slurStop = new Map();
  (getProperty(staff, PID.SLURS) ?? []).forEach((s, i) => {
    const number = (i % 6) + 1;
    slurStart.set(s.startChordId, [...(slurStart.get(s.startChordId) ?? []), number]);
    slurStop.set(s.endChordId, [...(slurStop.get(s.endChordId) ?? []), number]);
  });
  const glissStart = new Map(); const glissStop = new Map();
  (getProperty(staff, PID.GLISSANDOS) ?? []).forEach((g, i) => {
    if (isRunEntry(g)) return; // an organ run starts on a grace note, which is written without notations: a lone stop would be unbalanced
    const number = (i % 6) + 1;
    const wavy = g.glissandoType === 'wavy';
    glissStart.set(g.startNoteId, [...(glissStart.get(g.startNoteId) ?? []), { number, wavy }]);
    glissStop.set(g.endNoteId, [...(glissStop.get(g.endNoteId) ?? []), { number, wavy }]);
  });
  const trillStart = new Map(); const trillStop = new Map();
  (getProperty(staff, PID.TRILLS) ?? []).forEach((t, i) => {
    const number = (i % 6) + 1;
    trillStart.set(t.startChordId, [...(trillStart.get(t.startChordId) ?? []), number]);
    trillStop.set(t.endChordId, [...(trillStop.get(t.endChordId) ?? []), number]);
  });
  const tremoloStart = new Map(); const tremoloStop = new Map();
  for (const t of getProperty(staff, PID.TREMOLOS) ?? []) { tremoloStart.set(t.startChordId, t.strokes); tremoloStop.set(t.endChordId, t.strokes); }
  // hammer-ons / pull-offs between chords (direction from the pitches of their first notes), bends by note, technique lines by chord
  const { notePitch, chordPitch } = pitchTables(staff);
  const hopos = new Map();
  (getProperty(staff, PID.HOPOS) ?? []).forEach((h, i) => {
    const number = (i % 6) + 1;
    const kind = (chordPitch.get(h.endChordId) ?? 0) >= (chordPitch.get(h.startChordId) ?? 0) ? 'hammer-on' : 'pull-off';
    const add = (id, piece) => hopos.set(id, [...(hopos.get(id) ?? []), piece]);
    add(h.startChordId, `<${kind} type="start" number="${number}">${kind === 'hammer-on' ? 'H' : 'P'}</${kind}>`);
    add(h.endChordId, `<${kind} type="stop" number="${number}"/>`);
  });
  const bends = new Map(); // note id → <technical> / <articulations> pieces
  for (const b of getProperty(staff, PID.BENDS) ?? []) {
    const a = notePitch.get(b.startNoteId); const z = notePitch.get(b.endNoteId);
    const diff = a !== undefined && z !== undefined ? z - a : 0;
    const amount = Math.abs(b.amount !== undefined ? b.amount / 2 : diff);
    const add = (id, piece) => bends.set(id, [...(bends.get(id) ?? []), piece]);
    const alter = (x) => `<bend-alter>${x}</bend-alter>`;
    switch (b.type) {
      case 'bend': add(b.startNoteId, diff < 0 ? `<bend>${alter(amount)}<release/></bend>` : `<bend>${alter(amount || 1)}</bend>`); break;
      case 'slightBend': add(b.startNoteId, `<bend>${alter(0.5)}</bend>`); break;
      // MuseScore writes the pre-bend on the END note with bend-alter = start pitch − end pitch (negative when the grace note is lower)
      case 'preBend': case 'graceNoteBend': add(b.endNoteId, `<bend>${alter(diff !== 0 ? -diff : -(amount || 1))}<pre-bend/></bend>`); break;
      case 'dive': case 'dip': case 'preDive': add(b.type === 'preDive' ? b.endNoteId : b.startNoteId, `<bend>${alter(-(amount || 1))}<with-bar/></bend>`); break;
      case 'scoop': add(b.startNoteId, '<scoop-articulation/>'); break;
      default: break;
    }
  }
  const techStart = new Map(); const techStop = new Map();
  (getProperty(staff, PID.TECH_LINES) ?? []).forEach((t, i) => {
    const number = (i % 6) + 1;
    const text = t.text || TECH_LINE_TEXT[t.type] || '';
    techStart.set(t.startChordId, [...(techStart.get(t.startChordId) ?? []), { number, text, placement: t.placement ?? (t.type === 'harmonicMark' || t.type === 'vibrato' ? 'above' : 'below') }]);
    techStop.set(t.endChordId, [...(techStop.get(t.endChordId) ?? []), { number }]);
  });
  const breaths = new Map();
  for (const b of getProperty(staff, PID.BREATHS) ?? []) breaths.set(b.afterId, b.breathType);
  const lyrics = new Map();
  for (const r of resolveLyricLinks(getProperty(staff, PID.LYRIC_LINKS) ?? [], lyricTexts)) {
    lyrics.set(r.chordId, [...(lyrics.get(r.chordId) ?? []), { verse: r.verse, text: r.syllable.text, syllabic: r.syllable.syllabic, extend: r.endChordId !== undefined && r.endChordId !== r.chordId }]);
  }
  const pedals = (getProperty(staff, PID.PEDALS) ?? []).map((p) => ({
    start: { mi: measureIndexOf(p.startMeasureId), position: p.startPosition }, end: { mi: measureIndexOf(p.endMeasureId), position: p.endPosition },
  }));
  return { hopos, bends, techStart, techStop, wedgeStart, wedgeStop, slurStart, slurStop, glissStart, glissStop, trillStart, trillStop, tremoloStart, tremoloStop, breaths, lyrics, pedals };
}

/** Directions to write BEFORE a chord: its dynamic and the hairpins starting / ending there. */
export function chordDirections(chord, index, { staff = null } = {}) {
  const out = [];
  for (const s of index.wedgeStop.get(chord.id) ?? []) out.push(direction(`<wedge type="stop" number="${s.number}"/>`, { staff }));
  const dynamic = getProperty(chord, PID.DYNAMIC);
  if (dynamic) {
    if (DYNAMIC_ELEMENTS.has(dynamic)) out.push(direction(`<dynamics><${dynamic}/></dynamics>`, { staff }));
    else out.push(direction(`<dynamics><other-dynamics>${esc(dynamic === 'other' ? (getProperty(chord, PID.DYNAMIC_TEXT) ?? '') : dynamic)}</other-dynamics></dynamics>`, { staff }));
  }
  for (const s of index.wedgeStart.get(chord.id) ?? []) out.push(direction(`<wedge type="${s.type}" number="${s.number}"/>`, { staff }));
  for (const t of index.techStop.get(chord.id) ?? []) out.push(direction(`<dashes type="stop" number="${t.number}"/>`, { staff }));
  for (const t of index.techStart.get(chord.id) ?? []) {
    out.push(`<direction placement="${t.placement}"><direction-type><words>${esc(t.text)}</words></direction-type><direction-type><dashes type="start" number="${t.number}"/></direction-type>${staff ? `<staff>${staff}</staff>` : ''}</direction>`);
  }
  return out;
}

/** <notations> content pieces of a NOTE (`first` = first note of its chord: the chord's marks are written there only). */
export function noteNotations(chord, note, index, { first }) {
  const art = []; const orn = []; const tech = []; const other = [];
  if (first) {
    for (const a of getProperty(chord, PID.ARTICULATIONS) ?? []) {
      if (ARTICULATION_ELEMENT[a.type]) for (const e of ARTICULATION_ELEMENT[a.type]) art.push(`<${e}/>`);
      else if (ORNAMENT_ELEMENT[a.type]) orn.push(`<${ORNAMENT_ELEMENT[a.type]}/>`);
      else if (FERMATA_SHAPE[a.type]) other.push(`<fermata type="upright">${FERMATA_SHAPE[a.type]}</fermata>`);
    }
    const breath = index.breaths.get(chord.id);
    if (breath) art.push(/^breath/.test(breath) ? '<breath-mark/>' : '<caesura/>');
    const tremolo = getProperty(chord, PID.TREMOLO);
    if (tremolo) orn.push(`<tremolo type="single">${tremolo.buzz ? 3 : Math.min(8, tremolo.strokes ?? 3)}</tremolo>`);
    if (index.tremoloStart.has(chord.id)) orn.push(`<tremolo type="start">${Math.min(8, index.tremoloStart.get(chord.id))}</tremolo>`);
    if (index.tremoloStop.has(chord.id)) orn.push(`<tremolo type="stop">${Math.min(8, index.tremoloStop.get(chord.id))}</tremolo>`);
    for (const n of index.trillStart.get(chord.id) ?? []) orn.push(`<wavy-line type="start" number="${n}"/>`);
    for (const n of index.trillStop.get(chord.id) ?? []) orn.push(`<wavy-line type="stop" number="${n}"/>`);
    const arp = getProperty(chord, PID.ARPEGGIO);
    if (arp) other.push(`<arpeggiate${arp.type === 'down' || arp.type === 'downStraight' ? ' direction="down"' : arp.type === 'up' || arp.type === 'upStraight' ? ' direction="up"' : ''}/>`);
    for (const n of index.slurStop.get(chord.id) ?? []) other.push(`<slur type="stop" number="${n}"/>`);
    for (const n of index.slurStart.get(chord.id) ?? []) other.push(`<slur type="start" number="${n}"/>`);
  }
  // guitar techniques
  const flag = (pid) => note.props?.[pid] === true;
  if (flag(PID.HARMONIC)) tech.push(note.props?.[PID.DISPLAY_FRET] === 'artificial' ? '<harmonic><artificial/></harmonic>' : '<harmonic><natural/></harmonic>');
  for (const piece of index.bends.get(note.id) ?? []) { if (piece === '<scoop-articulation/>') art.push('<scoop/>'); else tech.push(piece); }
  if (first) {
    for (const piece of index.hopos.get(chord.id) ?? []) tech.push(piece);
    const tap = getProperty(chord, PID.TAPPING);
    if (tap) tech.push(`<tap hand="${tap.hand === 'right' ? 'right' : 'left'}">T</tap>`);
    const line = getProperty(chord, PID.CHORD_LINE);
    if (line && CHORD_LINE_ELEMENT[line.type]) art.push(`<${CHORD_LINE_ELEMENT[line.type]}/>`);
    for (const a of getProperty(chord, PID.ARTICULATIONS) ?? []) {
      if (GUITAR_ARTICULATION[a.type]) tech.push(`<other-technical>${esc(GUITAR_ARTICULATION[a.type])}</other-technical>`);
      else if (PICK_TECHNICAL[a.type]) tech.push(`<${PICK_TECHNICAL[a.type]}/>`);
    }
  }
  for (const g of index.glissStop.get(note.id) ?? []) other.push(`<glissando type="stop" number="${g.number}" line-type="${g.wavy ? 'wavy' : 'solid'}"/>`);
  for (const g of index.glissStart.get(note.id) ?? []) other.push(`<glissando type="start" number="${g.number}" line-type="${g.wavy ? 'wavy' : 'solid'}"/>`);
  for (const f of note.props?.[PID.FINGERINGS] ?? []) {
    if (!f.text) continue;
    if (f.kind === 'stringNumber') tech.push(`<string>${esc(f.text)}</string>`);
    else if (f.kind === 'rhGuitar') tech.push(`<pluck>${esc(f.text)}</pluck>`);
    else tech.push(`<fingering>${esc(f.text)}</fingering>`);
  }
  const pieces = [];
  if (art.length) pieces.push(`<articulations>${art.join('')}</articulations>`);
  if (orn.length) pieces.push(`<ornaments>${orn.join('')}</ornaments>`);
  if (tech.length) pieces.push(`<technical>${tech.join('')}</technical>`);
  return [...other, ...pieces];
}

/** <lyric> elements of a chord (written on its first note). */
export function chordLyrics(chord, index) {
  return (index.lyrics.get(chord.id) ?? []).map((l) => `<lyric number="${l.verse + 1}"><syllabic>${l.syllabic}</syllabic><text>${esc(l.text)}</text>${l.extend ? '<extend/>' : ''}</lyric>`).join('');
}

/** <notehead> override of a note: muted = x, ghost = parenthesised ordinary head. Empty when the note is ordinary. */
export function noteheadOverride(note) {
  if (note.props?.[PID.MUTED] === true) return '<notehead>x</notehead>';
  if (note.props?.[PID.GHOST] === true) return '<notehead parentheses="yes">normal</notehead>';
  return '';
}

/**
 * The syllables of the lyrics TRACKS (staff type 'lyrics', events) of a movement, for the exporter:
 *   byChord  chord id → [{ verse, syllabic, text, extend }]  the syllables LINKED to a chord: written as <lyric> on its note (the line is the verse number − 1 ; a trailing hyphen
 *            makes a syllable the beginning / middle of its word)
 *   loose    [{ measure, position, text }]  the syllables linked to nothing: written as <words> at their instant (the text as it is, hyphen included)
 */
export function lyricEventMarks(movement) {
  const byChord = new Map(); const loose = [];
  for (const track of movement.tracks) for (const staff of track.staves) {
    if (getProperty(staff, PID.STAFF_TYPE) !== 'lyrics') continue;
    const events = lyricEventsOf(staff).sort((a, b) => a.line - b.line || a.measure - b.measure || fToNumber(a.position) - fToNumber(b.position));
    const open = new Map(); // line → the previous syllable of that line ends with a hyphen
    for (const e of events) {
      if (!e.text) continue;
      if (!e.target) { loose.push({ measure: e.measure, position: e.position, text: e.text }); continue; }
      const hyphen = /-$/.test(e.text); const was = open.get(e.line) ?? false;
      const syllabic = !was ? (hyphen ? 'begin' : 'single') : (hyphen ? 'middle' : 'end');
      open.set(e.line, hyphen);
      byChord.set(e.target, [...(byChord.get(e.target) ?? []), { verse: e.line, syllabic, text: e.text.replace(/-+$/, ''), extend: false }]);
    }
  }
  return { byChord, loose };
}
