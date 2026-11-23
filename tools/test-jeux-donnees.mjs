// Vérifie les données des jeux de lecture : chaque étiquette correspond bien à ses notes (intervalle en demi-tons, nature de l'accord, degré), et l'étendue des clés.
import { TREBLE_POOL, BASS_POOL, INTERVAL_POOL, INTERVAL_START, CHORD_POOL, DEGREE_POOL, noteRange, FR_NOTE, SHARP_KEYS, FLAT_KEYS } from '../src/app/jeux-donnees.js';
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (n) => { const m = /^([A-G])(#|b)?(\d)$/.exec(n); return (Number(m[3]) + 1) * 12 + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
let ko = 0; const check = (c, msg) => { if (!c) { ko++; console.log('ECHEC', msg); } };
const NOMS = { 1: ['2de mineure'], 2: ['2de majeure'], 3: ['3ce mineure'], 4: ['3ce majeure'], 5: ['4te juste'], 6: ['4te augmentée'], 7: ['5te juste'], 8: ['6te mineure'], 9: ['6te majeure'], 10: ['7me mineure'], 11: ['7me majeure'], 12: ['8ve juste'] };
for (const it of INTERVAL_POOL) check(NOMS[midi(it.note) - midi(INTERVAL_START)]?.includes(it.label), `intervalle ${it.label} : ${it.note} est à ${midi(it.note) - midi(INTERVAL_START)} demi-tons`);
check(INTERVAL_POOL.length === 12, '12 intervalles');
const PATTERNS = { Majeur: '0,4,7', Mineur: '0,3,7', 'Septième de dominante': '0,4,7,10', 'Septième majeure': '0,4,7,11', 'Septième mineure': '0,3,7,10' };
for (const c of CHORD_POOL) { const r = midi(c.notes[0]); check(c.notes.map((n) => midi(n) - r).join(',') === PATTERNS[c.label], `accord ${c.label} : ${c.notes.join(' ')}`); }
check(CHORD_POOL.length === 13, '13 accords');
const DEG = ['Tonique', 'Sus-tonique', 'Médiante', 'Sous-dominante', 'Dominante', 'Sus-dominante', 'Sensible'];
DEGREE_POOL.forEach((d, i) => check(d.label === DEG[i] && d.note === 'CDEFGAB'[i] + '5', `degré ${d.label}`));
check(TREBLE_POOL[0] === 'F3' && TREBLE_POOL.at(-1) === 'E6' && TREBLE_POOL.length === 21, `clé de Sol F3..E6 (21 notes) : ${TREBLE_POOL.length}`);
check(BASS_POOL[0] === 'A1' && BASS_POOL.at(-1) === 'G4' && BASS_POOL.length === 21, `clé de Fa A1..G4 (21 notes) : ${BASS_POOL.length}`);
check(noteRange('C4', 'B4').join() === 'C4,D4,E4,F4,G4,A4,B4', 'noteRange');
check(SHARP_KEYS.length === 8 && FLAT_KEYS.length === 8, 'armures');
console.log(ko ? `${ko} ECHEC(S)` : 'Données des jeux : tout est cohérent', `(${INTERVAL_POOL.length} intervalles, ${CHORD_POOL.length} accords, ${DEGREE_POOL.length} degrés, ${TREBLE_POOL.length}+${BASS_POOL.length} notes)`);
process.exit(ko ? 1 : 0);
