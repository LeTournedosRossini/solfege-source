// Page de contrôle de la notation (lot 2) : tous les cas de partition utilisés par les leçons et les jeux de l'application actuelle,
// dessinés par le moteur de Scorsaire, chacun avec son bouton ▶. Adresse : #/controle (non liée à la navigation).
import CAS from '../music/cas.json';
import { mountScore, configurePlayer, stopAll } from '../music/player.js';

export function renderControle($view) {
  const params = new URLSearchParams(location.search);
  configurePlayer({ sounds: params.get('sounds') || undefined, onStatus: (t) => { const el = document.getElementById('sndstatus'); if (el) el.textContent = t; } });
  const groups = {};
  for (const c of CAS) { const g = c.routes[0].replace('#/', '').split('/')[0] + ' · ' + c.routes[0].split('/').pop(); (groups[g] ??= []).push(c); }
  $view.innerHTML = `
    <a class="crumb" href="#/">← Accueil</a>
    <div class="section-head"><h2>Contrôle de la notation</h2><p>${CAS.length} partitions de l'application actuelle, dessinées par le nouveau moteur. Appuyez sur ▶ pour les écouter.</p></div>
    <p id="sndstatus" role="status" style="font-size:.85rem;opacity:.8"></p>
    <div id="cas"></div>`;
  const box = document.getElementById('cas');
  for (const [name, list] of Object.entries(groups)) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3 style="margin:22px 0 8px">${name}</h3>`;
    for (const c of list) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;padding:8px 0;border-bottom:1px solid var(--rule)';
      row.innerHTML = `<code style="flex:0 0 190px;font-size:.72rem;opacity:.7;word-break:break-all">${c.id} · ${c.abc.replace(/L:[^\n]*\n|K:C clef=treble\n?/g, '').replace(/\n/g, ' ⏎ ')}</code><div class="sc" style="min-width:0;overflow-x:auto"></div>`;
      sec.append(row);
      mountScore(row.querySelector('.sc'), c.desc, { ink: 'currentColor', label: `Partition ${c.id}` });
      const b = row.querySelector('.sc').nextElementSibling; if (b) row.append(b);
    }
    box.append(sec);
  }
  return () => stopAll();
}
