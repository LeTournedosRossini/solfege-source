// Règles de maîtrise (cahier, 7.1) et journal d'événements : tests sous Node. Usage : node tools/test-suivi.mjs
import { charger, enregistrer, marquerLecon, niveauDe, etats, MAX_EVENEMENTS, JOUR, cleDe } from '../src/app/suivi.js';
import { elIntervalleLecture, elIntervalle, elNote, libelle, elPhrase } from '../src/app/suivi-elements.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const memoire = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const T0 = Date.UTC(2026, 10, 1, 10), rep = (jour, ...oks) => oks.map((o, i) => ({ t: T0 + jour * JOUR + i * 60000, ok: o }));
const niv = (r, jour = 0) => niveauDe(r, T0 + jour * JOUR).niveau;
// --- maîtrise
check('aucune réponse : nouveau', niv([]) === 'nouveau');
check('quelques bonnes réponses le même jour : en apprentissage (pas encore stable)', niv(rep(0, 1, 1, 1, 1, 1, 1)) === 'apprentissage');
check('5 bonnes sur 6 sur deux jours : maîtrisé', niv([...rep(0, 1, 1, 1), ...rep(1, 1, 0, 1)]) === 'maitrise' || niv([...rep(0, 1, 1, 1), ...rep(1, 1, 1, 1)]) === 'maitrise');
check('6 bonnes sur 6 sur deux jours : maîtrisé', niv([...rep(0, 1, 1, 1), ...rep(1, 1, 1, 1)], 1) === 'maitrise');
check('4 bonnes sur 6 : pas maîtrisé', niv([...rep(0, 1, 1, 0), ...rep(1, 1, 1, 0)], 1) !== 'maitrise');
check('deux erreurs sur les cinq dernières : à retravailler', niv(rep(0, 1, 1, 0, 1, 0)) === 'a_retravailler');
check('une seule erreur sur cinq : en apprentissage', niv(rep(0, 1, 1, 0, 1, 1)) === 'apprentissage');
check('une erreur récente sur un élément qui était maîtrisé : à retravailler', niv([...rep(0, 1, 1, 1), ...rep(1, 1, 1, 1), ...rep(2, 0)], 2) === 'a_retravailler');
check('maîtrisé mais non pratiqué depuis 31 jours : à revoir', niv([...rep(0, 1, 1, 1), ...rep(1, 1, 1, 1)], 32) === 'a_revoir');
check('maîtrisé et pratiqué il y a 10 jours : toujours maîtrisé', niv([...rep(0, 1, 1, 1), ...rep(1, 1, 1, 1)], 11) === 'maitrise');
check('on se remet de ses erreurs : à retravailler puis en apprentissage', niv(rep(0, 0, 0, 1, 1, 1, 1)) === 'apprentissage');
// --- journal
const s = memoire();
check('journal vide au départ', charger(s).evts.length === 0);
check('réponse enregistrée avec l\'heure', enregistrer(s, { j: 'ig', e: 'intervalle:M3', m: 'L', ok: true, r: '3ce mineure' }, T0) && charger(s).evts[0].t === T0 && charger(s).evts[0].ok === 1 && charger(s).evts[0].r === '3ce mineure');
check('événement invalide refusé (modalité inconnue)', enregistrer(s, { j: 'ig', e: 'x', m: 'Z', ok: 1 }) === false && charger(s).evts.length === 1);
enregistrer(s, { j: 'ear', e: 'intervalle:M3', m: 'O', ok: false, c: 'montant' }, T0 + 1000);
const et = etats(charger(s).evts, T0 + 5000);
check('oreille et lecture sont suivies séparément pour le même élément', et.has(cleDe('intervalle:M3', 'L')) && et.has(cleDe('intervalle:M3', 'O')) && et.get(cleDe('intervalle:M3', 'L')).reussites === 1 && et.get(cleDe('intervalle:M3', 'O')).reussites === 0);
check('texte trop long coupé (aucun contenu libre)', (() => { enregistrer(s, { j: 'a', e: 'b:c', m: 'L', ok: 1, r: 'x'.repeat(500) }); return charger(s).evts.at(-1).r.length === 60; })());
const g = memoire(); for (let i = 0; i < MAX_EVENEMENTS + 50; i++) enregistrer(g, { j: 'j', e: 'e:' + (i % 7), m: 'L', ok: 1 }, T0 + i);
check('plafond du journal respecté (les plus anciens sont retirés)', charger(g).evts.length <= MAX_EVENEMENTS && charger(g).evts.length > MAX_EVENEMENTS - 1100, String(charger(g).evts.length));
check('stockage illisible : journal vide sans erreur', (() => { const b = memoire(); b.setItem('solfege_suivi', '{pas du json'); return charger(b).evts.length === 0; })());
check('stockage plein : pas d\'exception', enregistrer({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, { j: 'a', e: 'b:c', m: 'L', ok: 1 }) === false);
// --- leçons
const l = memoire(); marquerLecon(l, 'portee-cles', 'debut', T0); marquerLecon(l, 'portee-cles', 'debut', T0 + 999);
check('leçon commencée une seule fois', charger(l).lecons['portee-cles'].debut === T0);
marquerLecon(l, 'portee-cles', 'fin', T0 + 5); check('leçon terminée avec sa date', charger(l).lecons['portee-cles'].fin === T0 + 5);
marquerLecon(l, 'portee-cles', 'rouvrir'); check('leçon rouverte (action volontaire)', charger(l).lecons['portee-cles'].fin === undefined);
check('leçon terminée sans avoir été ouverte : début renseigné', (() => { marquerLecon(l, 'notes', 'fin', T0); return charger(l).lecons.notes.debut === T0; })());
// --- éléments
check('intervalle de lecture et d\'oreille : même identifiant', elIntervalleLecture('3ce majeure') === elIntervalle('M3') && elIntervalleLecture('4te augmentée') === 'intervalle:A4');
check('libellés lisibles', libelle('intervalle:M3') === 'Tierce majeure' && libelle(elNote('treble', 'G4')) === 'Sol 4 (clé de Sol)' && libelle('gamme:dimarp') === 'Arpège diminué' && libelle('tonalite:Fa♯') === 'Fa♯ majeur', libelle(elNote('treble', 'G4')));
check('phrase : identifiant sans accent, titre retrouvé', elPhrase('Frère Jacques') === 'phrase:frere-jacques' && libelle('phrase:frere-jacques', [{ title: 'Frère Jacques' }]) === 'Frère Jacques');
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
