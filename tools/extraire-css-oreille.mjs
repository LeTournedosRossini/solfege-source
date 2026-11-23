// Extrait la feuille de style de l'ancien module d'oreille (reprise telle quelle, sauf adaptations) → src/app/oreille-style.txt
// Le module vit dans un « shadow DOM » : ses styles ne touchent pas le reste de l'application. Usage : node tools/extraire-css-oreille.mjs <ear.html décodé>
import fs from 'node:fs';
const html = fs.readFileSync(process.argv[2], 'utf8');
let css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const cut = (re) => { const n = css.length; css = css.replace(re, ''); if (css.length === n) throw new Error('motif introuvable : ' + re); };
cut(/\/\* Intégration thématique de la partition rendue par abcjs[\s\S]*?\.abcjs-note\.playing-highlight path \{[\s\S]*?\}\n/);
cut(/\/\* ══+\n   ÉDITEUR VISUEL DE PHRASE[\s\S]*$/);                      // l'éditeur visuel est reporté (phase ultérieure)
cut(/html, body \{[^}]*\}\nbody \{[^}]*\}\n/);
css = css.replace(':root, [data-theme="dark"] {', '.ear, .ear[data-theme="dark"] {').replace(/:root \{ --radius/, '.ear { --radius')
  .replace(/\*, \*::before, \*::after \{[^}]*\}/, '.ear *, .ear *::before, .ear *::after { box-sizing: border-box; margin: 0; padding: 0; }')
  .replace(/'DM Sans',\s*sans-serif/g, 'inherit').replace(/'Libre Baskerville',\s*serif/g, "'Fraunces', Georgia, serif");
css += `
.ear { --accent: var(--gold); background: var(--bg); color: var(--text); font-family: inherit; border-radius: 14px; padding: 18px 12px 28px; display: block; }
.ear .app { margin: 0 auto; }
.ear [hidden] { display: none !important; }
.ear .score-host { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; overflow-x: auto; position: relative; }
.ear .score-host .abc-play-btn { align-self: center; }
.ear .abc-play-btn { padding: 8px 18px; border: 1.5px solid var(--gold); border-radius: 8px; background: transparent; color: var(--gold); font: inherit; font-weight: 600; cursor: pointer; }
.ear .abc-play-btn:hover { background: var(--gold-a12); }
.ear button:focus-visible, .ear select:focus-visible, .ear input:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.ear .kb-inner { height: 168px; }
.ear .kb-buttons { height: 48px; }
.ear .kb-play-btn { top: 12px; }
.ear .kb-scroll { padding-top: 2px; }
.ear[data-theme="dark"] { --muted: #a9a2b8; }
.ear[data-theme="light"] { --gold: #86610a; --gold-dim: #6e500a; --green: #1d7142; --muted: #665c4e; }
.ear .quality-btn .qs { opacity: 1; }
.ear .quality-btn.active .qs { color: inherit; }
.ear .name-input { width: 100%; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); font: inherit; }
.ear .name-input:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.ear .import-note { font-size: .74rem; color: var(--muted); }
`;
fs.writeFileSync(new URL('../src/app/oreille-style.txt', import.meta.url), css);
console.log(css.length, 'octets');
