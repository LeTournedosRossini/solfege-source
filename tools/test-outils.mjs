// Les 3 outils : métronome (clics, tap tempo, mesure), piano (touches, clavier, octaves), accordeur (micro simulé : un la à 440 Hz).
// Usage : node tools/test-outils.mjs <url> <fichier .wav de 440 Hz>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 90000);
const url = process.argv[2] || 'http://localhost:8123/', wav = process.argv[3];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
const ctx = await b.newContext({ viewport: { width: 900, height: 800 }, permissions: ['microphone'] });
const p = await ctx.newPage();
const externes = [], erreurs = [];
p.on('request', (r) => { if (!r.url().startsWith(new URL(url).origin) && !r.url().startsWith('data:')) externes.push(r.url()); });
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) erreurs.push(m.text()); });
p.on('pageerror', (e) => erreurs.push('pageerror ' + e.message));
await p.addInitScript(() => { window.__osc = 0; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; });
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const osc = () => p.evaluate(() => window.__osc);
// métronome
await p.goto(url + '#/outils/metronome'); await p.waitForSelector('#play-btn');
check('métronome : tempo initial 100', (await p.locator('#bpm-val').textContent()) === '100');
await p.fill('#bpm-range', '120'); check('métronome : curseur de tempo', (await p.locator('#bpm-val').textContent()) === '120');
await p.locator('#sig-row .chip[data-n="3"]').click(); check('métronome : mesure 3/4 choisie', await p.locator('#sig-row .chip[data-n="3"].active').count() === 1);
const o0 = await osc(); await p.click('#play-btn'); check('métronome : bouton devient « Arrêter »', (await p.locator('#play-btn').textContent()).includes('Arrêter'));
await p.waitForTimeout(3100); const clics = (await osc()) - o0; check('métronome : environ 6 clics en 3 s à 120 bpm', clics >= 5 && clics <= 8, String(clics));
await p.click('#play-btn'); await p.waitForTimeout(300); const o1 = await osc(); await p.waitForTimeout(800); check('métronome : plus de clic après l\'arrêt', (await osc()) === o1);
for (let i = 0; i < 4; i++) { await p.click('#tap-btn'); await p.waitForTimeout(500); }
const tap = Number(await p.locator('#bpm-val').textContent()); check('métronome : tap tempo (frappes espacées d\'environ 500 ms → environ 120 bpm)', tap >= 100 && tap <= 130, String(tap)); // la marge couvre le délai propre au pilotage du navigateur
// piano
await p.goto(url + '#/outils/piano'); await p.waitForSelector('.pkey.white');
const blancs = await p.locator('.pkey.white').count(), noirs = await p.locator('.pkey.black').count(); check('piano : clavier affiché', blancs >= 14 && noirs >= 8, `${blancs} blanches, ${noirs} noires`);
const lab0 = await p.locator('#oct-label').textContent(); const op = await osc();
await p.locator('.pkey.white').nth(2).dispatchEvent('pointerdown'); check('piano : une touche joue un son et s\'allume', (await osc()) === op + 1 && await p.locator('.pkey.active').count() >= 1);
await p.keyboard.press('a'); await p.keyboard.press('w'); check('piano : touches du clavier (A et W)', (await osc()) === op + 3);
await p.click('#oct-up'); check('piano : octave +', (await p.locator('#oct-label').textContent()) !== lab0, lab0 + ' → ' + (await p.locator('#oct-label').textContent()));
// accordeur
await p.goto(url + '#/outils/accordeur'); await p.waitForSelector('#mic-btn'); await p.click('#mic-btn');
await p.waitForFunction(() => document.getElementById('t-note').textContent !== '—', null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(1500);
const note = await p.locator('#t-note').textContent(), cents = await p.locator('#t-cents').textContent();
check('accordeur : un la à 440 Hz est reconnu', note === 'La4', `${note} · ${cents}`);
const c = parseInt(cents); check('accordeur : écart inférieur à 10 centièmes', Math.abs(c) <= 10, cents);
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(300);
check('accordeur : onglet masqué → micro coupé, bouton de réactivation', await p.locator('#mic-btn').isVisible() && (await p.locator('#t-cents').textContent()).includes('micro coupé'), await p.locator('#t-cents').textContent());
check('aucune ressource externe', externes.length === 0, externes.join(' '));
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 3).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
