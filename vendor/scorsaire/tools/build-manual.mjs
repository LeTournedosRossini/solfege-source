#!/usr/bin/env node
/*
 * Builds the user manual: `docs/manuel/fr.md` and `en.md` (the same plan in two languages) + the icon glossary `docs/manuel/glossaire.json` (read from the real interface by
 * `tools/manual-icons.mjs`) + the pictures in `docs/manuel/img/` (taken by `tools/manual-shots.mjs`) → ONE page, `dist/manuel/index.html`, and its `img/` folder.
 * The page shows the language of the browser (a button changes it, the choice is kept on the device), follows the light / dark setting, and works on a phone.
 * `node tools/build-manual.mjs` — no browser needed: the pictures and the glossary are kept in the repository and refreshed on demand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'docs', 'manuel');
const out = path.join(root, 'dist', 'manuel');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Inline: `code`, **bold**, *italic*, [text](link), picture. The text is escaped first. */
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);

/** A small Markdown: ## chapters, ### sections, paragraphs, - and 1. lists, > notes, | tables, ![caption](img/x.png), {{glossaire}}. Returns { html, chapters: [{ id, title }] }. */
export function markdown(text, { glossary = () => '', imageSize = () => null } = {}) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const html = []; const chapters = [];
  let para = []; let list = null; let table = null; let quote = [];
  const flush = () => {
    if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list) { html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
    if (table) {
      const [head, ...rows] = table; html.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); table = null;
    }
    if (quote.length) { html.push(`<aside class="note">${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</aside>`); quote = []; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flush(); const level = m[1].length; const id = slug(m[2]);
      if (level === 2) chapters.push({ id, title: m[2] });
      html.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`); continue;
    }
    if (line.trim() === '{{glossaire}}') { flush(); html.push(glossary()); continue; }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line.trim()))) { flush(); const size = imageSize(m[2]); const dims = size ? ` width="${size.w}" height="${size.h}"${size.h > size.w ? ' class="portrait"' : ''}` : ''; html.push(`<figure><img src="${esc(m[2])}" alt="${esc(m[1])}"${dims} loading="lazy"><figcaption>${inline(m[1])}</figcaption></figure>`); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { if (!quote.length) flush(); quote.push(m[1]); continue; }
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!table) { flush(); table = []; } table.push(cells); continue;
    }
    if ((m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line))) {
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list && list.tag !== tag) flush();
      if (!list) { flush(); list = { tag, items: [] }; } list.items.push(m[2]); continue;
    }
    if (list && /^\s+\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; } // a list line that goes on
    if (line === '---') { flush(); html.push('<hr>'); continue; }
    para.push(line.trim());
  }
  flush();
  return { html: html.join('\n'), chapters };
}

const ZONES = {
  fr: { top: 'En haut de l’écran', dock: 'Barre de lecture et barre du bas', transport: 'Tiroir de lecture', trackcontrols: 'Contrôles flottants d’une piste', sidebar: 'Panneau latéral', tracks: 'Liste des pistes', entry: 'Barre de saisie des notes', context: 'Barre qui apparaît sur une mesure choisie', sheet: 'Feuilles du bas', screen2: 'Écran 2 : parties', screen3: 'Écran 3 : feuilles', screen4: 'Écran 4 : synchro', screen5: 'Écran 5 : YouTube', other: 'Autres' },
  en: { top: 'At the top of the screen', dock: 'Playback bar and bottom bar', transport: 'Playback drawer', trackcontrols: 'Floating controls of a track', sidebar: 'Side panel', tracks: 'Track list', entry: 'Note entry bar', context: 'Bar that appears on a chosen measure', sheet: 'Bottom sheets', screen2: 'Screen 2: parts', screen3: 'Screen 3: sheets', screen4: 'Screen 4: sync', screen5: 'Screen 5: YouTube', other: 'Other' },
};
const ZONE_ORDER = ['top', 'dock', 'transport', 'entry', 'context', 'sidebar', 'tracks', 'trackcontrols', 'sheet', 'screen2', 'screen3', 'screen4', 'screen5', 'other'];

/** The glossary of one language: the icons grouped by place, each with what its tooltip says. */
export function glossaryHtml(items, lang) {
  const by = new Map();
  for (const it of items) { if (!by.has(it.zone)) by.set(it.zone, []); by.get(it.zone).push(it); }
  const sections = ZONE_ORDER.filter((z) => by.has(z)).map((z) => {
    const rows = by.get(z).map((it) => `<li><span class="ico" aria-hidden="true">${it.svg}</span><span class="tip">${esc(it[lang] ?? it.fr)}</span></li>`).join('');
    return `<section class="glossary-zone"><h3>${esc(ZONES[lang][z] ?? z)}</h3><ul class="glossary">${rows}</ul></section>`;
  });
  return sections.join('\n');
}

const UI = {
  fr: { title: 'Scorsaire : manuel', toc: 'Sommaire', top: 'Haut de page', lang: 'English', langTitle: 'Switch to English', updated: 'Manuel du logiciel' },
  en: { title: 'Scorsaire: manual', toc: 'Contents', top: 'Back to top', lang: 'Français', langTitle: 'Passer en français', updated: 'Software manual' },
};

const CSS = `
:root{--bg:#faf8f4;--ink:#1c1b1a;--soft:#5d5a53;--edge:#d7d2c6;--card:#fff;--accent:#8a5a00;--code:#efeadf;--note:#fff6dc}
@media (prefers-color-scheme:dark){:root{--bg:#131313;--ink:#f2f1ee;--soft:#b5b2aa;--edge:#34322e;--card:#1b1b1c;--accent:#caa457;--code:#242321;--note:#2a2415}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:64px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--edge)}
header.bar strong{flex:1;font-size:17px}
button.lang{min-height:40px;padding:0 14px;border-radius:8px;border:1px solid var(--edge);background:var(--card);color:inherit;font:600 14px inherit;cursor:pointer}
main{max-width:920px;margin:0 auto;padding:16px}
html[data-lang="fr"] [lang="en"],html[data-lang="en"] [lang="fr"]{display:none}
nav.toc{border:1px solid var(--edge);background:var(--card);border-radius:10px;padding:8px 16px;margin:16px 0 24px}
nav.toc ol{margin:6px 0;padding-left:22px;columns:2;column-gap:28px}nav.toc a{color:var(--accent);text-decoration:none}
@media (max-width:640px){nav.toc ol{columns:1}}
h1{font-size:30px;line-height:1.2;margin:.4em 0}h2{font-size:23px;margin:2em 0 .5em;padding-top:.6em;border-top:1px solid var(--edge)}h3{font-size:18px;margin:1.4em 0 .4em}
p,li{max-width:70ch}code{background:var(--code);padding:1px 6px;border-radius:5px;font-size:.92em}
figure{margin:16px 0}figure img{max-width:100%;height:auto;border:1px solid var(--edge);border-radius:8px;display:block}figure img.portrait{max-width:min(100%,380px)}figcaption{font-size:14px;color:var(--soft);margin-top:6px}
aside.note{background:var(--note);border-left:4px solid var(--accent);border-radius:6px;padding:2px 14px;margin:14px 0}
.table{overflow-x:auto}table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid var(--edge);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--code)}
ul.glossary{list-style:none;padding:0;margin:8px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px}
ul.glossary li{display:flex;align-items:center;gap:12px;border:1px solid var(--edge);background:var(--card);border-radius:8px;padding:6px 10px}
.ico{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:42px;border:1px solid var(--edge);border-radius:8px;background:var(--bg);color:var(--ink)}
.ico svg{height:24px;width:auto;max-width:56px;stroke-width:1.6}.tip{font-size:14px;line-height:1.35}
a.up{display:inline-block;margin:24px 0;color:var(--accent)}
`;

const JS = `(function(){var h=document.documentElement,k='scorsaire.manual.lang';function pick(){try{var s=localStorage.getItem(k);if(s==='fr'||s==='en')return s}catch(e){}return(navigator.language||'fr').slice(0,2)==='en'?'en':'fr'}
function set(l){h.setAttribute('data-lang',l);h.setAttribute('lang',l);document.title=document.querySelector('div[lang="'+l+'"] h1').textContent;try{localStorage.setItem(k,l)}catch(e){}}
set(pick());document.getElementById('lang').addEventListener('click',function(){set(h.getAttribute('data-lang')==='fr'?'en':'fr')})})();`;

/** The size of a PNG of `docs/manuel/img/` (read from its header), so that the page keeps its place while the pictures load; null when the file is missing. */
const imageSize = (rel) => {
  try { const b = fs.readFileSync(path.join(src, rel)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; } catch { return null; }
};

export function buildManual() {
  const glossary = JSON.parse(fs.readFileSync(path.join(src, 'glossaire.json'), 'utf8'));
  const parts = {};
  for (const lang of ['fr', 'en']) {
    const text = fs.readFileSync(path.join(src, `${lang}.md`), 'utf8');
    parts[lang] = markdown(text, { glossary: () => glossaryHtml(glossary, lang), imageSize });
  }
  const section = (lang) => {
    const { html, chapters } = parts[lang];
    const toc = `<nav class="toc" aria-label="${UI[lang].toc}"><strong>${UI[lang].toc}</strong><ol>${chapters.map((c) => `<li><a href="#${c.id}">${esc(c.title)}</a></li>`).join('')}</ol></nav>`;
    const [h1, ...rest] = html.split('\n');
    return `<div lang="${lang}">${h1}\n${toc}\n${rest.join('\n')}<a class="up" href="#top">${UI[lang].top}</a></div>`;
  };
  const page = `<!doctype html>
<html lang="fr" data-lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${UI.fr.title}</title>
<meta name="description" content="Scorsaire : manuel du logiciel / software manual"><style>${CSS}</style></head>
<body id="top"><header class="bar"><strong><span lang="fr">${UI.fr.updated}</span><span lang="en">${UI.en.updated}</span></strong><button class="lang" id="lang" type="button"><span lang="fr" title="${UI.fr.langTitle}">${UI.fr.lang}</span><span lang="en" title="${UI.en.langTitle}">${UI.en.lang}</span></button></header>
<main>${section('fr')}\n${section('en')}</main><script>${JS}</script></body></html>
`;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'img'), { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), page);
  const img = path.join(src, 'img');
  if (fs.existsSync(img)) for (const f of fs.readdirSync(img)) fs.copyFileSync(path.join(img, f), path.join(out, 'img', f));
  return { bytes: page.length, chapters: { fr: parts.fr.chapters.length, en: parts.en.chapters.length } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = buildManual();
  console.log(`Manuel construit : dist/manuel/index.html (${Math.round(r.bytes / 1024)} Ko, ${r.chapters.fr} chapitres en français, ${r.chapters.en} en anglais)`);
}
