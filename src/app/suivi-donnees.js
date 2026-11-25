// Données de l'élève : export et import de la progression sous forme de fichier (DON-01), remise à zéro (DON-02). Pur (le stockage est passé en paramètre), testable sous Node.
import { CLE, VERSION, charger, MAX_EVENEMENTS } from './suivi.js';

export const FORMAT = 'solfege-progression';
const CLE_SCORES = 'solfege_progress';          // meilleurs scores par jeu (ancienne clé, conservée)
const PREFIXES_REGLAGES = ['solfege_mode_', 'solfege_rythme'];   // choix des questions par jeu, niveaux de rythme
const lireJson = (s, cle) => { try { return JSON.parse(s.getItem(cle) || 'null'); } catch { return null; } };

/** Texte du fichier d'export : le journal, les leçons, les scores par jeu et les réglages de jeu. Aucune donnée personnelle. */
export function exporter(stockage, maintenant = Date.now()) {
  const reglages = {};
  for (let i = 0; i < (stockage.length ?? 0); i++) { const k = stockage.key(i); if (PREFIXES_REGLAGES.some((p) => k.startsWith(p))) reglages[k] = stockage.getItem(k); }
  return JSON.stringify({ format: FORMAT, version: VERSION, exporte: new Date(maintenant).toISOString(), suivi: charger(stockage), scores: lireJson(stockage, CLE_SCORES) ?? {}, reglages }, null, 1);
}

const evtValide = (e) => e && Number.isFinite(e.t) && typeof e.j === 'string' && typeof e.e === 'string' && (e.m === 'L' || e.m === 'O') && (e.ok === 0 || e.ok === 1) && e.j.length < 60 && e.e.length < 120;

/** Lit un fichier d'export : { ok: true, donnees } ou { ok: false, erreur } (message lisible). Les événements invalides sont écartés, jamais exécutés. */
export function analyser(texte) {
  let d;
  try { d = JSON.parse(texte); } catch { return { ok: false, erreur: 'Ce fichier n’est pas une sauvegarde de progression (texte illisible).' }; }
  if (!d || d.format !== FORMAT) return { ok: false, erreur: 'Ce fichier n’est pas une sauvegarde de progression Solfège.' };
  if (!Number.isInteger(d.version) || d.version > VERSION) return { ok: false, erreur: 'Cette sauvegarde vient d’une version plus récente de l’application : mettez l’application à jour.' };
  const evts = (Array.isArray(d.suivi?.evts) ? d.suivi.evts : []).filter(evtValide).slice(-MAX_EVENEMENTS).map((e) => ({ t: e.t, j: e.j, e: e.e, m: e.m, ok: e.ok, ...(e.r != null ? { r: String(e.r).slice(0, 60) } : {}), ...(e.c != null ? { c: String(e.c).slice(0, 40) } : {}) }));
  const lecons = {};
  for (const [id, l] of Object.entries(d.suivi?.lecons && typeof d.suivi.lecons === 'object' ? d.suivi.lecons : {})) if (id.length < 60 && l && (Number.isFinite(l.debut) || Number.isFinite(l.fin))) lecons[id] = { ...(Number.isFinite(l.debut) ? { debut: l.debut } : {}), ...(Number.isFinite(l.fin) ? { fin: l.fin } : {}) };
  const scores = {};
  for (const [id, g] of Object.entries(d.scores?.games && typeof d.scores.games === 'object' ? d.scores.games : {})) if (id.length < 60 && g && Number.isFinite(g.played) && Number.isFinite(g.best)) scores[id] = { best: g.best, played: g.played, ...(Number.isFinite(g.last) ? { last: g.last } : {}), ...(Number.isFinite(g.lastTotal) ? { lastTotal: g.lastTotal } : {}) };
  const reglages = {};
  for (const [k, v] of Object.entries(d.reglages && typeof d.reglages === 'object' ? d.reglages : {})) if (PREFIXES_REGLAGES.some((p) => k.startsWith(p)) && typeof v === 'string' && v.length < 20) reglages[k] = v;
  return { ok: true, donnees: { evts, lecons, scores, reglages }, resume: { reponses: evts.length, lecons: Object.keys(lecons).length, jeux: Object.keys(scores).length } };
}

/** Applique des données importées. `mode` : 'fusion' (on garde ce qui est déjà là et on ajoute le reste, sans doublon) ou 'remplace'. */
export function appliquer(stockage, donnees, mode = 'fusion') {
  const local = mode === 'remplace' ? { evts: [], lecons: {} } : charger(stockage);
  const vus = new Set(local.evts.map((e) => `${e.t}|${e.j}|${e.e}|${e.m}`));
  const evts = [...local.evts, ...donnees.evts.filter((e) => !vus.has(`${e.t}|${e.j}|${e.e}|${e.m}`))].sort((a, b) => a.t - b.t).slice(-MAX_EVENEMENTS);
  const lecons = { ...local.lecons };
  for (const [id, l] of Object.entries(donnees.lecons)) {
    const a = lecons[id] || {};
    const debut = Math.min(...[a.debut, l.debut].filter(Number.isFinite)), fin = Math.max(...[a.fin, l.fin].filter(Number.isFinite));
    lecons[id] = { ...(Number.isFinite(debut) ? { debut } : {}), ...(Number.isFinite(fin) ? { fin } : {}) };
  }
  stockage.setItem(CLE, JSON.stringify({ v: VERSION, evts, lecons }));
  const sc = mode === 'remplace' ? {} : (lireJson(stockage, CLE_SCORES)?.games ?? {});
  for (const [id, g] of Object.entries(donnees.scores)) { const a = sc[id]; sc[id] = !a ? g : { best: Math.max(a.best, g.best), played: Math.max(a.played, g.played), last: (a.played >= g.played ? a : g).last, lastTotal: (a.played >= g.played ? a : g).lastTotal }; }
  stockage.setItem(CLE_SCORES, JSON.stringify({ ...(lireJson(stockage, CLE_SCORES) ?? {}), games: sc }));
  for (const [k, v] of Object.entries(donnees.reglages)) if (mode === 'remplace' || stockage.getItem(k) == null) stockage.setItem(k, v);
  return { reponses: evts.length, lecons: Object.keys(lecons).length };
}

/** Efface toute la progression (journal, leçons, scores, réglages de jeu). Les phrases créées ou importées, le thème et le reste ne sont pas touchés. */
export function remettreAZero(stockage) {
  const aEffacer = [CLE, CLE_SCORES];
  for (let i = 0; i < (stockage.length ?? 0); i++) { const k = stockage.key(i); if (PREFIXES_REGLAGES.some((p) => k.startsWith(p))) aEffacer.push(k); }
  aEffacer.forEach((k) => stockage.removeItem(k));
  return aEffacer.length;
}
