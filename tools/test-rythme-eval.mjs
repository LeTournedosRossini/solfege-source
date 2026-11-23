// Vérifie l'évaluation du rythme (sans navigateur) : tempo libre, démarrage quelconque, régularité, motifs irréguliers, frappes manquantes.
import { evaluateRhythm } from '../src/app/rythme-eval.js';
let ko = 0; const check = (c, m) => { if (!c) { ko++; console.log('ECHEC', m); } };
const beat = 60 / 88;
const q4 = [0, 1, 2, 3].map((i) => i * beat);
const at = (tempo, start, jitter = []) => q4.map((t, i) => start + t / tempo + (jitter[i] ?? 0));
let r = evaluateRhythm(q4, at(1, 12.3), beat); check(r.pct === 100 && r.complete, 'à l\'identique : 100 %');
r = evaluateRhythm(q4, at(0.7, 0.4), beat); check(r.pct === 100 && Math.abs(r.tempo - 0.7) < 0.01, `plus lent de 30 % mais régulier : 100 % (${r.pct}, tempo ${r.tempo?.toFixed(2)})`);
r = evaluateRhythm(q4, at(1.6, 100), beat); check(r.pct === 100 && r.tempo > 1.5, 'plus rapide mais régulier : 100 %');
r = evaluateRhythm(q4, at(1, 0, [0, 0.03, -0.03, 0]), beat); check(r.pct === 100, `petite imprécision (30 ms) : 100 % (${r.pct})`);
r = evaluateRhythm(q4, [0, 0.4, 1.4, 2.0], beat); check(r.pct <= 50 && r.regularity > 0.2, `frappes irrégulières : pct bas (${r.pct}, régularité ${r.regularity?.toFixed(2)})`);
r = evaluateRhythm(q4, [0, 0.7, 1.4], beat); check(!r.complete && r.pct < 100, `motif incomplet : non complet (${r.pct})`);
r = evaluateRhythm(q4, [], beat); check(r.pct === 0 && r.intervals.length === 3, 'aucune frappe : 0 %');
const mixed = [0, beat / 2, beat, beat * 2, beat * 2.5]; // croches puis noire
r = evaluateRhythm(mixed, mixed.map((t) => 5 + t * 1.3), beat); check(r.pct === 100, `motif avec croches rejoué à 77 % du tempo : 100 % (${r.pct})`);
r = evaluateRhythm(mixed, [5, 5.5, 6, 6.5, 7], beat); check(r.pct < 100, `forme fausse (tout à intervalles égaux) : pas 100 % (${r.pct})`);
console.log(ko ? `${ko} ECHEC(S)` : 'Évaluation du rythme : tout est cohérent'); process.exit(ko ? 1 : 0);
