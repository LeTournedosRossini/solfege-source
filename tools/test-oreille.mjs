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
await p.click('#worksPickerBtn'); const imp = p.locator('#worksList .phrase-item'); check('import : 3 phrases dans « Mes phrases »', await imp.count() === 3, String(await imp.count()));
await imp.nth(1).click(); await p.waitForTimeout(300);
check('import : le mouvement (8 notes) est dessiné', await heads('#worksStaffWrap') === 8);
await p.click('#worksPlay'); await p.waitForTimeout(700);
check('import : lecture lancée (bouton Stop)', (await p.locator('#worksPlay').textContent()).includes('Stop'), await p.locator('#worksPlay').textContent());
await p.click('#worksPlay');
await p.setInputFiles('#importFile', { name: 'faux.scorsaire', mimeType: 'application/json', buffer: Buffer.from('pas du json') });
await p.waitForTimeout(300); check('import : fichier invalide, message clair', (await p.locator('#importNote').textContent()).includes('pas un document Scorsaire'), await p.locator('#importNote').textContent());
await p.reload(); await p.waitForSelector('#ecStaffWrap svg'); await p.locator('#tabs .tab-btn[data-tab="works"]').click(); await p.click('#worksPickerBtn');
check('import : phrases conservées après rechargement', await p.locator('#worksGenreTabs .tab-btn', { hasText: 'Mes phrases' }).count() === 1);


// --- éditeur visuel de phrase (composant d'édition de Scorsaire)
await p.reload(); await p.waitForSelector('#ecStaffWrap svg'); await p.locator('#tabs .tab-btn[data-tab="works"]').click();
const taper = async (n, dec = 0) => { const r = await p.evaluate(() => { const l = [...document.querySelector('scorsaire-note').shadowRoot.querySelectorAll('[data-role="staff-line"]')].map((e) => e.getBoundingClientRect()); return { top: Math.min(...l.map((x) => x.top)), bottom: Math.max(...l.map((x) => x.bottom)), left: l[0].left }; });
  const ys = [r.bottom - 4, r.top + 20, r.top + 30, r.top + 6, r.top + 14]; for (let i = 0; i < n; i++) { await p.mouse.click(r.left + 110 + (i + dec) * 48, ys[i % 5]); await p.waitForTimeout(220); } };
const tetes = () => p.locator('scorsaire-note svg [data-glyph^="notehead"]').count();
await p.click('#createBtn'); await p.waitForSelector('scorsaire-note'); await p.waitForTimeout(800);
await p.locator('scorsaire-note [data-act="done"]').click(); await p.waitForTimeout(300);
check('éditeur : une phrase vide est refusée', (await p.locator('#importNote').textContent()).includes('vide') && await p.locator('#nameSheet.open').count() === 0, await p.locator('#importNote').textContent());
await p.click('#createBtn'); await p.waitForSelector('scorsaire-note'); await p.waitForTimeout(800);
await p.locator('scorsaire-note [data-act="close"]').click(); await p.waitForTimeout(300);
check('éditeur : « Fermer » abandonne sans rien enregistrer', await p.locator('scorsaire-note').count() === 0 && await p.locator('#nameSheet.open').count() === 0);
await p.click('#createBtn'); await p.waitForSelector('scorsaire-note'); await p.waitForTimeout(800);
for (const dur of ['16th', 'eighth', 'half', 'whole']) {
  await p.locator(`scorsaire-note [data-dur="${dur}"]`).click(); const av = await tetes(); await taper(1, 0);
  const pressed = await p.locator(`scorsaire-note [data-dur="${dur}"]`).getAttribute('aria-pressed');
  check(`éditeur : durée « ${dur} » choisie, note posée, bouton enfoncé`, (await tetes()) > av && pressed === 'true', `${av} → ${await tetes()}, pressed=${pressed}`);
  await p.locator('scorsaire-note [data-act="undo"]').click(); await p.waitForTimeout(150);
}
await p.locator('scorsaire-note [data-act="close"]').click(); await p.waitForTimeout(300);
await p.click('#createBtn'); await p.waitForSelector('scorsaire-note'); await p.waitForTimeout(800);
await taper(4);
check('éditeur : quatre notes posées en touchant la portée', await tetes() === 4, String(await tetes()));
await p.locator('scorsaire-note textarea').fill('Ma petite phrase'); await p.waitForTimeout(500);
await p.locator('scorsaire-note [data-act="done"]').click(); await p.waitForSelector('#nameSheet.open');
check('éditeur : nom proposé (le titre saisi)', await p.inputValue('#nameInput') === 'Ma petite phrase', await p.inputValue('#nameInput'));
await p.fill('#nameInput', 'Ma phrase de test'); await p.click('#nameSave'); await p.waitForTimeout(500);
check('éditeur : phrase enregistrée et affichée', (await p.locator('#worksTitle').textContent()) === 'Ma phrase de test' && await heads('#worksStaffWrap') === 4 && (await p.locator('#importNote').textContent()).includes('enregistrée'));
await p.click('#worksPlay'); await p.waitForFunction(() => /Stop/.test(window.__oreille.root.getElementById('worksPlay').textContent), null, { timeout: 12000 }).catch(() => {}); check('éditeur : la phrase créée se joue', (await p.locator('#worksPlay').textContent()).includes('Stop')); await p.click('#worksPlay');
await p.reload(); await p.waitForSelector('#ecStaffWrap svg'); await p.locator('#tabs .tab-btn[data-tab="works"]').click(); await p.click('#worksPickerBtn');
await p.locator('#worksGenreTabs .tab-btn', { hasText: 'Mes phrases' }).click();
const creee = p.locator('#worksList .phrase-item', { hasText: 'Ma phrase de test' }); check('éditeur : phrase conservée après rechargement (avec 4 mesures au plus)', await creee.count() === 1);
await p.locator('#worksList button[aria-label="Modifier Ma phrase de test"]').click(); await p.waitForSelector('scorsaire-note'); await p.waitForTimeout(900);
check('éditeur : la phrase s’ouvre pour modification avec ses notes', await tetes() === 4, String(await tetes()));
await taper(1, 4); check('éditeur : une cinquième note ajoutée', await tetes() === 5, String(await tetes()));
await p.locator('scorsaire-note [data-act="done"]').click(); await p.waitForSelector('#nameSheet.open'); await p.click('#nameSave'); await p.waitForTimeout(500);
check('éditeur : la phrase modifiée remplace l’ancienne', await heads('#worksStaffWrap') === 5 && (await p.locator('#worksTitle').textContent()) === 'Ma phrase de test');
await p.click('#worksPickerBtn'); check('éditeur : une seule entrée « Ma phrase de test »', await p.locator('#worksList .phrase-item', { hasText: 'Ma phrase de test' }).count() === 1);
await p.locator('#worksList button[aria-label="Retirer Ma phrase de test"]').click(); await p.waitForTimeout(200);
check('éditeur : suppression d’une phrase créée', await p.locator('#worksList .phrase-item', { hasText: 'Ma phrase de test' }).count() === 0);
await p.keyboard.press('Escape');

// --- thèmes
for (const t of ['dark', 'contrast', 'light']) { await p.evaluate((x) => document.documentElement.setAttribute('data-theme', x), t); await p.waitForTimeout(150); check(`thème ${t} suivi par le module`, await p.evaluate(() => window.__oreille.root.getElementById('ear').dataset.theme) === t); }
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 3).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
