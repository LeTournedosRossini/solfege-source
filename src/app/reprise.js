// « Reprendre là où tu en étais » (NAV-01) : la dernière activité et la prochaine leçon suggérée, d'après le journal. Rien n'est affiché tant que rien n'a été fait.
import { CATALOGUE } from './data/catalogue.js';
import { donnees } from './suivi-local.js';
import { activite, titreLecon } from './liens.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** HTML de la zone « Reprendre » ('' s'il n'y a encore aucune activité). */
export function htmlReprise() {
  const d = donnees(), lecons = CATALOGUE.lessons;
  const dernierEvt = d.evts.length ? d.evts.reduce((a, b) => (b.t > a.t ? b : a)) : null;
  let derLecon = null;
  for (const [id, l] of Object.entries(d.lecons)) { const t = Math.max(l.debut || 0, l.fin || 0); if (t && (!derLecon || t > derLecon.t)) derLecon = { id, t, fin: !!l.fin }; }
  if (!dernierEvt && !derLecon) return '';
  const liens = []; let affichee = '';
  if (derLecon && (!dernierEvt || derLecon.t >= dernierEvt.t)) { if (!derLecon.fin) { affichee = derLecon.id; liens.push(`<a class="btn btn-accent" href="#/cours/${derLecon.id}">Reprendre la leçon : ${esc(titreLecon(derLecon.id))}</a>`); } }
  else if (dernierEvt) { const a = activite(dernierEvt.j); liens.push(`<a class="btn btn-accent" href="${a.route}">Reprendre : ${esc(a.titre)}</a>`); }
  const prochaine = lecons.find((l) => !d.lecons[l.id]?.fin && l.id !== affichee);
  if (prochaine) liens.push(`<a class="btn btn-ghost" href="#/cours/${prochaine.id}">Prochaine leçon : ${esc(prochaine.title)}</a>`);
  if (!liens.length) return '';
  return `<section class="reprise" aria-labelledby="reprise-t"><h2 id="reprise-t" style="margin:0 0 10px;font-size:1.25rem">Reprendre là où tu en étais</h2><div class="reprise-liens" style="display:flex;flex-wrap:wrap;gap:10px">${liens.join('')}</div></section>`;
}
