// Export, import (fusion ou remplacement) et remise à zéro de la progression : tests sous Node. Usage : node tools/test-donnees.mjs
import { exporter, analyser, appliquer, remettreAZero, FORMAT } from '../src/app/suivi-donnees.js';
import { charger, enregistrer, marquerLecon } from '../src/app/suivi.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const memoire = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } }; };
const T0 = Date.UTC(2026, 10, 1, 10);
const a = memoire();
enregistrer(a, { j: 'ig', e: 'intervalle:M3', m: 'L', ok: 1, r: '3ce majeure' }, T0); enregistrer(a, { j: 'oreille-gammes', e: 'gamme:maj', m: 'O', ok: 0, c: 'montant' }, T0 + 1000);
marquerLecon(a, 'portee-cles', 'debut', T0); marquerLecon(a, 'portee-cles', 'fin', T0 + 5);
a.setItem('solfege_progress', JSON.stringify({ games: { ig: { best: 4, played: 2, last: 3, lastTotal: 4 } } })); a.setItem('solfege_mode_ig', 'adapte'); a.setItem('solfege_theme', 'dark'); a.setItem('solfege_oreille_import', '[{"x":1}]');
const texte = exporter(a, T0);
const d = JSON.parse(texte);
check('export : format, version, date et contenu', d.format === FORMAT && d.version === 1 && d.exporte.startsWith('2026-11-01') && d.suivi.evts.length === 2 && d.scores.games.ig.best === 4 && d.reglages.solfege_mode_ig === 'adapte');
check('export : ni le thème ni les phrases de l\'élève (hors progression)', !texte.includes('solfege_theme') && !texte.includes('solfege_oreille_import'));
// import
const r = analyser(texte);
check('import : fichier relu, résumé', r.ok && r.resume.reponses === 2 && r.resume.lecons === 1 && r.resume.jeux === 1);
const b = memoire(); appliquer(b, r.donnees, 'fusion');
check('import dans un appareil vide : tout est repris', charger(b).evts.length === 2 && charger(b).lecons['portee-cles'].fin === T0 + 5 && JSON.parse(b.getItem('solfege_progress')).games.ig.best === 4 && b.getItem('solfege_mode_ig') === 'adapte');
// fusion sans doublon
enregistrer(b, { j: 'ig', e: 'intervalle:P5', m: 'L', ok: 1 }, T0 + 9000);
appliquer(b, r.donnees, 'fusion'); appliquer(b, r.donnees, 'fusion');
check('fusion : relue deux fois, aucun doublon, l\'existant est gardé', charger(b).evts.length === 3);
const c = memoire(); enregistrer(c, { j: 'dg', e: 'duree:Ronde', m: 'L', ok: 1 }, T0 + 100); appliquer(c, r.donnees, 'remplace');
check('remplacement : l\'ancien journal est remplacé', charger(c).evts.length === 2 && !charger(c).evts.some((e) => e.j === 'dg'));
check('fusion des leçons : première ouverture et dernière fin conservées', (() => { const m = memoire(); marquerLecon(m, 'portee-cles', 'debut', T0 - 500); appliquer(m, r.donnees, 'fusion'); const l = charger(m).lecons['portee-cles']; return l.debut === T0 - 500 && l.fin === T0 + 5; })());
check('fusion des scores : le meilleur score est gardé', (() => { const m = memoire(); m.setItem('solfege_progress', JSON.stringify({ games: { ig: { best: 9, played: 1, last: 9, lastTotal: 9 } } })); appliquer(m, r.donnees, 'fusion'); const g = JSON.parse(m.getItem('solfege_progress')).games.ig; return g.best === 9 && g.played === 2; })());
// fichiers invalides ou hostiles
check('refus : texte qui n\'est pas du JSON', !analyser('pas du json').ok && analyser('pas du json').erreur.includes('illisible'));
check('refus : autre format', !analyser('{"format":"autre"}').ok);
check('refus : version plus récente', !analyser(JSON.stringify({ format: FORMAT, version: 99 })).ok && analyser(JSON.stringify({ format: FORMAT, version: 99 })).erreur.includes('plus récente'));
const sale = analyser(JSON.stringify({ format: FORMAT, version: 1, suivi: { evts: [{ t: 1, j: 'ig', e: 'a:b', m: 'L', ok: 1 }, { t: 'x', j: 'ig', e: 'a:b', m: 'L', ok: 1 }, { t: 2, j: 'ig', e: 'a:b', m: 'Z', ok: 1 }, { t: 3, j: '<script>'.repeat(20), e: 'x', m: 'L', ok: 1 }, null, 'texte'], lecons: { ok: { fin: 5 }, mauvais: { fin: 'x' } } }, reglages: { solfege_theme: 'dark', solfege_mode_ig: 'adapte', solfege_mode_x: 'x'.repeat(50) } }));
check('événements invalides écartés, réglages étrangers au suivi ignorés', sale.ok && sale.donnees.evts.length === 1 && Object.keys(sale.donnees.lecons).join() === 'ok' && Object.keys(sale.donnees.reglages).join() === 'solfege_mode_ig', JSON.stringify(sale.resume));
check('fichier vide de contenu : accepté, rien à reprendre', (() => { const e = analyser(JSON.stringify({ format: FORMAT, version: 1 })); return e.ok && e.resume.reponses === 0; })());
// remise à zéro
const z = remettreAZero(a);
check('remise à zéro : journal, scores et réglages de jeu effacés', charger(a).evts.length === 0 && a.getItem('solfege_progress') === null && a.getItem('solfege_mode_ig') === null && z >= 3);
check('remise à zéro : thème et phrases personnelles intacts', a.getItem('solfege_theme') === 'dark' && a.getItem('solfege_oreille_import') === '[{"x":1}]');
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
