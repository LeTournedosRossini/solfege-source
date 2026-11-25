// Choix adapté des questions (règles 7.2) : tests sous Node, sur des milliers de tirages. Usage : node tools/test-tirage.mjs
import { choisir, apresReponse, nouvelleSeance, MAX_NOUVEAUX } from '../src/app/suivi-tirage.js';
import { etats, JOUR } from '../src/app/suivi.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
let graine = 42; const rnd = () => { graine = (graine * 1664525 + 1013904223) % 4294967296; return graine / 4294967296; };
const T0 = Date.UTC(2026, 10, 20, 10), maintenant = T0 + 10 * JOUR;
const jour = (d, e, oks) => oks.map((o, i) => ({ t: T0 + d * JOUR + i * 1000, j: 'g', e, m: 'L', ok: o ? 1 : 0 }));
const cands = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
// A maîtrisé (6/6 sur deux jours), B à retravailler (2 erreurs sur 5), C et D en apprentissage, E à H nouveaux
const evts = [...jour(1, 'A', [1, 1, 1]), ...jour(5, 'A', [1, 1, 1]), ...jour(8, 'B', [1, 1, 0, 1, 0]), ...jour(8, 'C', [1, 0]), ...jour(9, 'D', [1])];
const et = etats(evts, maintenant);
// --- séance de 4000 questions où l'élève répond toujours juste : on observe la répartition
const seance = nouvelleSeance(); const cpt = {}; let prec = null, deuxFois = 0;
for (let i = 0; i < 4000; i++) { const c = choisir({ candidats: cands, etats: et, m: 'L', seance, maintenant, rnd }); cpt[c] = (cpt[c] || 0) + 1; if (c === prec) deuxFois++; prec = c; }
const trav = (cpt.B + cpt.C + cpt.D) / 4000, nouv = ((cpt.E || 0) + (cpt.F || 0) + (cpt.G || 0) + (cpt.H || 0)) / 4000, maitr = cpt.A / 4000;
check('un élément n\'est jamais reposé deux fois d\'affilée', deuxFois === 0, String(deuxFois));
check('l\'élément à retravailler revient plus souvent que les autres éléments en cours', cpt.B > cpt.C && cpt.B > cpt.D, JSON.stringify(cpt));
check('deux éléments (C, D) sont encore en introduction : aucun nouvel élément n\'est posé', (cpt.E || 0) + (cpt.F || 0) + (cpt.G || 0) + (cpt.H || 0) === 0, JSON.stringify(cpt));
check('le maîtrisé apparaît, mais moins que ce qui est en cours', maitr > 0.05 && maitr < trav, `maîtrisé ${(maitr * 100).toFixed(0)} %, à travailler ${(trav * 100).toFixed(0)} %, nouveaux ${(nouv * 100).toFixed(0)} %`);
// --- introduction progressive : élève qui débute (rien rencontré)
const vierge = etats([], maintenant), s2 = nouvelleSeance(), vus = new Set(); const evt2 = [];
let maxEnCours = 0;
for (let i = 0; i < 60; i++) {
  const e2 = etats(evt2, maintenant + i), c = choisir({ candidats: cands, etats: e2, m: 'L', seance: s2, maintenant: maintenant + i, rnd });
  const enCours = cands.filter((x) => { const s = e2.get('L|' + x); return s && s.essais < 3; }).length; maxEnCours = Math.max(maxEnCours, enCours);
  vus.add(c); evt2.push({ t: maintenant + i * 1000, j: 'g', e: c, m: 'L', ok: 1 });
}
check(`débutant : jamais plus de ${MAX_NOUVEAUX} éléments en cours d'introduction`, maxEnCours <= MAX_NOUVEAUX, String(maxEnCours));
check('débutant : les éléments s\'ajoutent peu à peu (il y en a plus de 2 après 60 questions)', vus.size > 2 && vus.size < cands.length + 1, String(vus.size));
// --- retour après une erreur
const s3 = nouvelleSeance(); const suite = [];
const premier = choisir({ candidats: cands, etats: et, m: 'L', seance: s3, maintenant, rnd }); apresReponse(s3, premier, false);
for (let i = 0; i < 5; i++) { const c = choisir({ candidats: cands, etats: et, m: 'L', seance: s3, maintenant, rnd }); suite.push(c); }
check('après une erreur, l\'élément revient dans les quelques questions suivantes (pas tout de suite)', suite[0] !== premier && suite.slice(0, 5).includes(premier), `${premier} puis ${suite.join('')}`);
// --- mode erreurs
const s4 = nouvelleSeance(); const vusE = new Set();
for (let i = 0; i < 300; i++) vusE.add(choisir({ candidats: cands, etats: et, m: 'L', seance: s4, maintenant, rnd, mode: 'erreurs' }));
check('mode « Mes erreurs » : seulement les éléments ratés (B, C avec une erreur)', [...vusE].every((x) => ['B', 'C'].includes(x)) && vusE.has('B'), [...vusE].join(''));
check('mode « Mes erreurs » sans erreur : rien à poser', choisir({ candidats: cands, etats: vierge, m: 'L', seance: nouvelleSeance(), maintenant, rnd, mode: 'erreurs' }) === null);
// --- un seul candidat
check('un seul élément possible : il est posé même deux fois de suite', choisir({ candidats: ['Z'], etats: vierge, m: 'L', seance: { dernier: 'Z', rappels: [] }, maintenant, rnd }) === 'Z');
check('la modalité oreille ne tient pas compte de la lecture', (() => { const s = nouvelleSeance(); const e = etats(jour(1, 'A', [0, 0, 0]), maintenant); return choisir({ candidats: ['A', 'B'], etats: e, m: 'O', seance: s, maintenant, rnd, mode: 'erreurs' }) === null; })());
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
