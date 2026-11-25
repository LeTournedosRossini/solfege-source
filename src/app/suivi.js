// Suivi de l'apprentissage (phase 1b) : journal d'événements sur l'appareil + niveau de maîtrise calculé à partir de ce journal (cahier, sections 6 et 7).
// Principes : un événement est un fait daté qu'on ne modifie jamais ; la progression affichée se CALCULE depuis les événements (on peut changer les règles sans perdre l'historique) ;
// un élément est désigné par sa nature musicale (« intervalle:M3 », « note:treble:G4 »), pas par son rendu ; aucun texte libre ni contenu personnel n'est enregistré.
// Sans dépendance au navigateur : le stockage est passé en paramètre (testable sous Node).

export const CLE = 'solfege_suivi';
export const VERSION = 1;
export const MAX_EVENEMENTS = 8000;       // au-delà, les plus anciens sont retirés (la maîtrise ne regarde que les dernières réponses)
export const JOUR = 86400000;

/** Un événement de réponse : { t (ms), j (jeu), e (élément), m ('L' lecture | 'O' oreille), ok (0|1), r (réponse donnée, facultatif), c (contexte : sens, tonalité…, facultatif) }. */
const vide = () => ({ v: VERSION, evts: [], lecons: {} });

export function charger(stockage) {
  try {
    const brut = stockage.getItem(CLE);
    if (!brut) return vide();
    const d = JSON.parse(brut);
    if (!d || d.v !== VERSION || !Array.isArray(d.evts)) return vide();
    return { v: VERSION, evts: d.evts, lecons: d.lecons && typeof d.lecons === 'object' ? d.lecons : {} };
  } catch { return vide(); }
}

function ecrire(stockage, d) {
  if (d.evts.length > MAX_EVENEMENTS) d.evts = d.evts.slice(d.evts.length - MAX_EVENEMENTS + 1000);
  try { stockage.setItem(CLE, JSON.stringify(d)); return true; } catch { return false; } // stockage plein ou indisponible : le suivi est simplement perdu, jamais d'erreur visible
}

/** Ajoute une réponse. `ev` : { j, e, m, ok, r?, c? } ; l'heure est ajoutée. Renvoie vrai si c'est enregistré. */
export function enregistrer(stockage, ev, maintenant = Date.now()) {
  if (!ev || !ev.j || !ev.e || (ev.m !== 'L' && ev.m !== 'O')) return false;
  const d = charger(stockage);
  const e = { t: maintenant, j: ev.j, e: ev.e, m: ev.m, ok: ev.ok ? 1 : 0 };
  if (ev.r != null) e.r = String(ev.r).slice(0, 60);
  if (ev.c != null) e.c = String(ev.c).slice(0, 40);
  d.evts.push(e);
  return ecrire(stockage, d);
}

/** Leçon commencée (à l'ouverture) ou terminée (par une action volontaire de l'élève). « commencée » n'est enregistrée qu'une fois ; « terminée » peut être annulée. */
export function marquerLecon(stockage, id, etat, maintenant = Date.now()) {
  const d = charger(stockage), l = d.lecons[id] || {};
  if (etat === 'debut' && !l.debut) l.debut = maintenant;
  else if (etat === 'fin') { l.fin = maintenant; l.debut = l.debut || maintenant; }
  else if (etat === 'rouvrir') delete l.fin;
  else return false;
  d.lecons[id] = l;
  return ecrire(stockage, d);
}

/* ---------------------------------------------------------------- maîtrise (section 7.1) */
export const NIVEAUX = ['nouveau', 'apprentissage', 'a_retravailler', 'maitrise', 'a_revoir'];
export const LIBELLES = { nouveau: 'Nouveau', apprentissage: 'En apprentissage', a_retravailler: 'À retravailler', maitrise: 'Maîtrisé', a_revoir: 'À revoir' };
export const SEUILS = { fenetreMaitrise: 6, bonnesMaitrise: 5, joursMaitrise: 2, fenetreErreurs: 5, erreursRetravail: 2, oubliJours: 30 };

const jourDe = (t) => Math.floor(t / JOUR);

/** Niveau d'un élément à partir de ses réponses (dans l'ordre chronologique) : { niveau, essais, reussites, dernier, recents }. */
export function niveauDe(reponses, maintenant = Date.now(), S = SEUILS) {
  let etaitMaitrise = false, retravail = false, maitrise = false;
  reponses.forEach((r, i) => {
    const fen = reponses.slice(Math.max(0, i + 1 - S.fenetreMaitrise), i + 1);
    const bonnes = fen.filter((x) => x.ok).length;
    maitrise = fen.length >= S.bonnesMaitrise && bonnes >= S.bonnesMaitrise && new Set(fen.map((x) => jourDe(x.t))).size >= S.joursMaitrise;
    const rec = reponses.slice(Math.max(0, i + 1 - S.fenetreErreurs), i + 1);
    retravail = rec.filter((x) => !x.ok).length >= S.erreursRetravail || (!r.ok && etaitMaitrise);
    etaitMaitrise = maitrise;
  });
  const dernier = reponses.length ? reponses[reponses.length - 1].t : null;
  let niveau = 'nouveau';
  if (reponses.length) {
    if (retravail) niveau = 'a_retravailler';
    else if (maitrise) niveau = maintenant - dernier > S.oubliJours * JOUR ? 'a_revoir' : 'maitrise';
    else niveau = 'apprentissage';
  }
  return { niveau, essais: reponses.length, reussites: reponses.filter((x) => x.ok).length, dernier, recents: reponses.slice(-5).map((x) => x.ok) };
}

/** Tous les éléments rencontrés : Map « modalité|élément » → { e, m, jeux: Set, niveau, essais, reussites, dernier, recents }. Les modalités oreille (O) et lecture (L) sont indépendantes (EXO-02). */
export function etats(evts, maintenant = Date.now()) {
  const groupes = new Map();
  for (const ev of [...evts].sort((a, b) => a.t - b.t)) {
    const cle = `${ev.m}|${ev.e}`;
    if (!groupes.has(cle)) groupes.set(cle, { e: ev.e, m: ev.m, jeux: new Set(), reponses: [] });
    const g = groupes.get(cle); g.jeux.add(ev.j); g.reponses.push(ev);
  }
  const out = new Map();
  for (const [cle, g] of groupes) out.set(cle, { e: g.e, m: g.m, jeux: g.jeux, ...niveauDe(g.reponses, maintenant) });
  return out;
}

export const cleDe = (e, m) => `${m}|${e}`;
