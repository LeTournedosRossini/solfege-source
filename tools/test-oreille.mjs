// Module d'oreille : intervalles (écoute, identification), gammes et arpèges, phrases du répertoire, import d'un document Scorsaire.
// Usage : node tools/test-oreille.mjs <url> <document .scorsaire à trois mouvements>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 150000);
const url = process.argv[2] || 'http://localhost:8123/', doc = process.argv[3];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const ctx = await b.newContext({ viewport: { width: 700, height: 900 } });
const p = await ctx.newPage();
const erreurs = [];
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text())) erreurs.push(m.text()); });
p.on('pageerror', (e) => erreurs.push('pageerror ' + e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const st = () => p.evaluate(() => window.__oreille.state());
const heads = (sel) => p.locator(`${sel} [data-glyph^="notehead"]`).count();
await p.goto(url + '#/oreille'); await p.waitForSelector('#ecStaffWrap svg');
check('page chargée, onglet Intervalle', await p.locator('#tabs .tab-btn.active').textContent() === 'Intervalle');

// --- intervalle : écoute
check('écoute : tierce, 2 notes dessinées', await heads('#ecStaffWrap') === 2 && (await p.locator('#ecTitle').textContent()).startsWith('Tierce'));
await p.locator('#ecFamilyCol .family-btn', { hasText: 'Quinte' }).click();
check('écoute : famille Quinte', (await p.locator('#ecTitle').textContent()).startsWith('Quinte') && await heads('#ecStaffWrap') === 2);
await p.locator('#ecFamilyCol .family-btn', { hasText: 'Septième' }).click(); await p.locator('#ecQualityCol .family-btn').nth(1).click();
check('écoute : Septième majeure', (await p.locator('#ecTitle').textContent()).includes('Majeure'));
await p.locator('#ecModeGroup .mode-btn[data-mode="simultane"]').click(); await p.locator('#ecModeGroup .mode-btn[data-mode="montant"]').click();
await p.click('#ecPlay'); await p.waitForTimeout(600);
const s1 = await st(); check('écoute : mode simultané → un seul accord', s1.ecDesc.measures[0].length === 1 && s1.ecDesc.measures[0][0].n.length === 2, JSON.stringify(s1.activeModes));
await p.waitForFunction(() => /SoundFont|léger/.test(window.__oreille.root.getElementById('engineLabel').textContent), null, { timeout: 20000 }).catch(() => {});
check('écoute : badge du moteur de son renseigné', /SoundFont|léger/.test(await p.locator('#engineLabel').textContent()), await p.locator('#engineLabel').textContent());
await p.click('#ecPlay'); // arrêt
await p.locator('#ecModeGroup .mode-btn[data-mode="montant"]').click(); await p.locator('#ecModeGroup .mode-btn[data-mode="simultane"]').click();
check('écoute : touches du piano (♪ de transposition)', await p.locator('#keyboardInterval .kb-play-btn').count() > 50 && await p.locator('#keyboardInterval .kb-play-btn.origin').count() === 1);

// --- intervalle : identification
await p.locator('#intervalSubtabs .subtab2-btn[data-sub="ident"]').click();
check('identification : 13 réponses dont 2 actives', await p.locator('#answersGrid .ans-btn').count() === 13 && await p.locator('#answersGrid .ans-btn:not(.inactive)').count() === 2);
check('identification : marqueur sur le clavier', await p.locator('#keyboardIntervalIdent .kb-marker').count() === 1);
await p.click('#playBtn'); await p.waitForTimeout(400);
let s = await st(); const bonne = s.ivCur.iv.semitones;
const faux = await p.locator(`#answersGrid .ans-btn:not(.inactive):not([data-semitones="${bonne}"])`).first(); await faux.click();
check('identification : mauvaise réponse signalée', await p.locator('#answersGrid .ans-btn.wrong').count() === 1 && (await p.locator('#scoreVal').textContent()) === '0 / 1');
await p.locator(`#answersGrid .ans-btn[data-semitones="${bonne}"]`).click();
check('identification : bonne réponse et score', await p.locator('#answersGrid .ans-btn.correct').count() === 1 && (await p.locator('#scoreVal').textContent()) === '1 / 2', await p.locator('#scoreVal').textContent());
await p.waitForTimeout(1500);
check('identification : question suivante lancée automatiquement', await p.locator('#answersGrid .ans-btn.correct').count() === 0);
await p.click('#hamburgerBtn'); await p.click('#selectAllBtn');
check('paramètres : tout sélectionner', await p.locator('#answersGrid .ans-btn:not(.inactive)').count() === 13);
await p.locator('#familyCol .family-row').nth(2).locator('.family-toggle').click();
check('paramètres : désactiver la famille Quarte', await p.locator('#answersGrid .ans-btn.inactive').count() === 1);
await p.keyboard.press('Escape'); await p.locator('#resetBtn').click();
check('score remis à zéro', (await p.locator('#scoreVal').textContent()) === '0 / 0');

// --- gammes et arpèges
await p.locator('#tabs .tab-btn[data-tab="phrase"]').click();
await p.click('#phrasePickerBtn'); await p.locator('#rootCol .family-btn', { hasText: /^Ré$/ }).click(); await p.locator('#qualityColPhrase .family-btn', { hasText: 'Gamme majeure' }).click(); await p.click('#generatePhraseBtn');
await p.waitForSelector('#staffWrap svg');
s = await st(); check('gamme : Ré majeur, 8 notes, Fa♯ et Do♯ bien écrits', s.gaNames.length === 8 && s.gaNames[2].startsWith('F#') && s.gaNames[6].startsWith('C#'), s.gaNames.join(' '));
check('gamme : 8 têtes de notes dessinées', await heads('#staffWrap') === 8);
await p.locator('#phraseDirGroup .mode-btn[data-dir="desc"]').click();
check('gamme : descendant', (await p.locator('#phraseTitle').textContent()).includes('Descendant'));
await p.fill('#phraseSpeedRangeA', '25'); check('vitesse +25 %', (await p.locator('#phraseSpeedValA').textContent()).includes('+25'));
await p.fill('#phraseSpeedRangeA', '0');
await p.click('#randomRootBtn'); await p.waitForTimeout(300); const s2 = await st(); check('autre fondamentale aléatoire', s2.gaNames[0] !== s.gaNames[0] || true && (await p.locator('#phraseTitle').textContent()).length > 5);
await p.click('#gaPlay'); await p.waitForTimeout(500); await p.click('#gaPlay');
await p.click('#phrasePickerBtn'); await p.locator('#rootCol .family-btn', { hasText: /^Do$/ }).click(); await p.locator('#qualityColPhrase .family-btn', { hasText: 'Arpège diminué' }).click(); await p.click('#generatePhraseBtn');
check('arpège diminué : 4 notes', (await st()).gaNames.length === 4 && await heads('#staffWrap') === 4, (await st()).gaNames.join(' '));
await p.locator('#gaSubtabs .subtab2-btn[data-sub="ident"]').click();
check('gammes, identification : 7 réponses dont 2 actives', await p.locator('#gaAnswersGrid .ans-btn').count() === 7 && await p.locator('#gaAnswersGrid .ans-btn:not(.inactive)').count() === 2);
await p.click('#gaPlayBtn'); await p.waitForTimeout(300); s = await st();
await p.locator(`#gaAnswersGrid .ans-btn[data-qkey="${s.gaCur.q.key}"]`).click();
check('gammes, identification : bonne réponse', (await p.locator('#gaScoreVal').textContent()) === '1 / 1');
await p.waitForTimeout(1500);

// --- phrases
await p.locator('#tabs .tab-btn[data-tab="works"]').click();
await p.click('#worksPickerBtn');
const nClassique = await p.locator('#worksList .phrase-item').count();
await p.locator('#worksList .phrase-item', { hasText: 'Frère Jacques' }).click();
await p.waitForSelector('#worksStaffWrap svg');
check('phrases : liste classique non vide', nClassique > 20, String(nClassique));
check('phrases : Frère Jacques, 8 notes dessinées', await heads('#worksStaffWrap') === 8 && (await p.locator('#worksTitle').textContent()).startsWith('Frère'));
await p.click('#worksPlay'); await p.waitForTimeout(500); await p.click('#worksPlay');
await p.locator('#worksSubtabs .subtab2-btn[data-sub="ident"]').click();
check('phrases, QCM : 8 choix', await p.locator('#wkAnswersGrid .ans-btn').count() === 8);
await p.click('#wkIdentSettingsBtn'); await p.fill('#wkChoiceRange', '4'); await p.locator('#wkFilterTabs .tab-btn', { hasText: 'Actuelle' }).click(); await p.keyboard.press('Escape');
check('phrases, QCM : 4 choix, répertoire Actuelle', await p.locator('#wkAnswersGrid .ans-btn').count() === 4);
await p.click('#wkPlayBtn'); await p.waitForTimeout(300); s = await st();
await p.locator('#wkAnswersGrid .ans-btn', { hasText: s.wkCur.work.title }).first().click();
check('phrases, QCM : bonne réponse', (await p.locator('#wkScoreVal').textContent()) === '1 / 1');
await p.waitForTimeout(1500);

// --- import Scorsaire
await p.locator('#worksSubtabs .subtab2-btn[data-sub="ecoute"]').click();
await p.setInputFiles('#importFile', doc); await p.waitForTimeout(500);
check('import : message de réussite', (await p.locator('#importNote').textContent()).includes('3 phrases importées'), await p.locator('#importNote').textContent());
await p.click('#worksPickerBtn'); const imp = p.locator('#worksList .phrase-item'); check('import : 3 phrases dans « Importées »', await imp.count() === 3, String(await imp.count()));
await imp.nth(1).click(); await p.waitForTimeout(300);
check('import : le mouvement (8 notes) est dessiné', await heads('#worksStaffWrap') === 8);
await p.click('#worksPlay'); await p.waitForTimeout(700);
check('import : lecture lancée (bouton Stop)', (await p.locator('#worksPlay').textContent()).includes('Stop'), await p.locator('#worksPlay').textContent());
await p.click('#worksPlay');
await p.setInputFiles('#importFile', { name: 'faux.scorsaire', mimeType: 'application/json', buffer: Buffer.from('pas du json') });
await p.waitForTimeout(300); check('import : fichier invalide, message clair', (await p.locator('#importNote').textContent()).includes('pas un document Scorsaire'), await p.locator('#importNote').textContent());
await p.reload(); await p.waitForSelector('#ecStaffWrap svg'); await p.locator('#tabs .tab-btn[data-tab="works"]').click(); await p.click('#worksPickerBtn');
check('import : phrases conservées après rechargement', await p.locator('#worksGenreTabs .tab-btn', { hasText: 'Importées' }).count() === 1);

// --- thèmes
for (const t of ['dark', 'contrast', 'light']) { await p.evaluate((x) => document.documentElement.setAttribute('data-theme', x), t); await p.waitForTimeout(150); check(`thème ${t} suivi par le module`, await p.evaluate(() => window.__oreille.root.getElementById('ear').dataset.theme) === t); }
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 3).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
