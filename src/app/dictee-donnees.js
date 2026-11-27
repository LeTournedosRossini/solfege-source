// Dictées simples (CON-04) : on écoute un court motif, puis on retrouve celui qui a été joué parmi trois partitions. Générateurs purs (sans navigateur), testables sous Node.

/** Mélange uniforme (Fisher-Yates). Trier avec un comparateur aléatoire n'est PAS uniforme : la première proposition sortait presque une fois sur deux. */
export function melange(liste, rnd = Math.random) { const a = liste.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** Place de la bonne proposition (0, 1 ou 2) : au hasard, mais jamais plus de deux fois de suite à la même place, et les places les moins sorties récemment sont favorisées. `historique` : places des dernières questions. */
export function placeBonne(historique = [], rnd = Math.random) {
  const h = historique.slice(-2), interdite = h.length === 2 && h[0] === h[1] ? h[0] : -1;
  const recents = historique.slice(-9), poids = [0, 1, 2].map((p) => (p === interdite ? 0 : 1 / (1 + recents.filter((x) => x === p).length)));
  let r = rnd() * poids.reduce((t, w) => t + w, 0);
  for (let p = 0; p < 3; p++) { if (r < poids[p]) return p; r -= poids[p]; }
  return [0, 1, 2].find((p) => p !== interdite);
}

/* ---------------------------------------------------------------- rythme */
// Cellules rythmiques d'une mesure à 4 temps : id → { temps, événements }. Tous les sons sont joués sur la même note (Si4) : seul le rythme compte.
const N = 'B4';
const ev = (d, extra = {}) => ({ n: [N], d, dots: 0, ...extra });
export const CELLULES = {
  Q: { temps: 1, events: [ev('quarter')] },
  EE: { temps: 1, events: [ev('eighth'), ev('eighth')] },
  H: { temps: 2, events: [ev('half')] },
  R: { temps: 1, events: [{ rest: true, d: 'quarter', dots: 0 }] },
  SSSS: { temps: 1, events: [ev('sixteenth'), ev('sixteenth'), ev('sixteenth'), ev('sixteenth')] },
  ESS: { temps: 1, events: [ev('eighth'), ev('sixteenth'), ev('sixteenth')] },
  SSE: { temps: 1, events: [ev('sixteenth'), ev('sixteenth'), ev('eighth')] },
  QPE: { temps: 2, events: [{ ...ev('quarter'), dots: 1 }, ev('eighth')] },   // noire pointée + croche : 2 temps
};
export const NIVEAUX_RYTHME = {
  1: { label: 'Niveau 1 : noires et croches', cellules: ['Q', 'EE'] },
  2: { label: 'Niveau 2 : avec blanches et soupirs', cellules: ['Q', 'EE', 'H', 'R'] },
  3: { label: 'Niveau 3 : avec doubles-croches et noire pointée', cellules: ['Q', 'EE', 'H', 'R', 'SSSS', 'ESS', 'SSE', 'QPE'] },
};
const dureeCell = (c) => CELLULES[c].temps;
const cle = (cells) => cells.join(' ');

/** Suite de cellules qui remplit exactement `mesures` × 4 temps (tirée au hasard parmi `autorises`, avec au moins deux cellules différentes). */
export function suiteRythme(autorises, rnd = Math.random, temps = 4) {
  for (let essai = 0; essai < 200; essai++) {
    const out = []; let reste = temps;
    while (reste > 0) { const ok = autorises.filter((c) => dureeCell(c) <= reste); const c = ok[Math.floor(rnd() * ok.length)]; out.push(c); reste -= dureeCell(c); }
    if (new Set(out).size >= 2 && out.some((c) => c !== 'R') && out[0] !== 'R') return out;
  }
  return ['Q', 'EE', 'Q', 'Q'];
}
/** Variante : une cellule est remplacée par une autre de même durée (et le premier son reste un son). */
function varianteRythme(cells, autorises, rnd) {
  const idx = melange(cells.map((_, i) => i), rnd);
  for (const i of idx) {
    const alt = autorises.filter((c) => c !== cells[i] && dureeCell(c) === dureeCell(cells[i]) && !(i === 0 && c === 'R'));
    if (alt.length) { const r = cells.slice(); r[i] = alt[Math.floor(rnd() * alt.length)]; return r; }
  }
  return null;
}
/** Description à JOUER au piano (non dessinée) : le motif précédé, si `precompte`, d'une mesure de quatre silences ; les quatre clics du métronome (voir clic.js) sont joués pendant ce temps. */
const SILENCES = { events: [0, 1, 2, 3].map(() => ({ rest: true, d: 'quarter', dots: 0 })) };
export function descEcoute(genre, motif, bpm, precompte = false) {
  const d = descOption(genre, motif, bpm);
  return genre === 'rythme' && precompte ? { ...d, measures: [SILENCES.events.map((e) => ({ ...e })), ...d.measures] } : d;
}
const NOIRES = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };
/** Positions des attaques d'un rythme, en noires depuis son début (les silences n'ont pas d'attaque) : sert à jouer le rythme en clics. */
export function battements(cells) {
  const out = []; let t = 0;
  for (const c of cells) for (const e of CELLULES[c].events) { if (!e.rest) out.push(t); t += NOIRES[e.d] * (e.dots ? 1.5 : 1); }
  return out;
}
export const descRythme = (cells, bpm = 80) => ({ clef: 'treble', key: 0, time: [4, 4], bpm, measures: [cells.flatMap((c) => CELLULES[c].events.map((e) => ({ ...e })))], width: 300, scale: 1.05 });

/* ---------------------------------------------------------------- mélodie */
const GAMME = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'];
export const NIVEAUX_MELODIE = {
  1: { label: 'Niveau 1 : trois notes par degrés conjoints', notes: 3, sauts: [1], ambitus: 5, fixePremiere: true },
  2: { label: 'Niveau 2 : quatre notes, avec des tierces', notes: 4, sauts: [1, 2], ambitus: 6, fixePremiere: true },
  3: { label: 'Niveau 3 : cinq notes, avec des sauts', notes: 5, sauts: [1, 2, 3], ambitus: 8, fixePremiere: false },
};
/** Mélodie : indices dans GAMME (0 = Do5). */
export function melodie(niveau, rnd = Math.random) {
  const cfg = NIVEAUX_MELODIE[niveau];
  for (let essai = 0; essai < 200; essai++) {
    const m = [Math.floor(rnd() * Math.min(4, cfg.ambitus))];
    while (m.length < cfg.notes) {
      const pas = cfg.sauts[Math.floor(rnd() * cfg.sauts.length)] * (rnd() < 0.5 ? -1 : 1), n = m[m.length - 1] + pas;
      if (n >= 0 && n < cfg.ambitus) m.push(n);
    }
    if (new Set(m).size >= 2) return m;
  }
  return [0, 1, 2].slice(0, cfg.notes);
}
function varianteMelodie(m, niveau, rnd) {
  const cfg = NIVEAUX_MELODIE[niveau];
  const idx = melange(m.map((_, i) => i).filter((i) => !(cfg.fixePremiere && i === 0)), rnd);
  for (const i of idx) {
    const deltas = melange([-2, -1, 1, 2], rnd);
    for (const d of deltas) { const n = m[i] + d; if (n >= 0 && n < cfg.ambitus) { const r = m.slice(); r[i] = n; return r; } }
  }
  return null;
}
export const descMelodie = (m, bpm = 80) => ({ clef: 'treble', key: 0, time: null, bpm, measures: [m.map((i) => ({ n: [GAMME[i]], d: 'quarter', dots: 0 }))], width: 240, scale: 1.05 });

/* ---------------------------------------------------------------- question : trois propositions, une seule est celle qui a été jouée */
/** `genre` : 'rythme' | 'melodie' ; renvoie { genre, niveau, options: [motif, motif, motif], bonne (indice), id (élément suivi) }. */
export function question(genre, niveau, rnd = Math.random, historique = []) {
  const options = []; let bonne;
  if (genre === 'rythme') {
    const autorises = NIVEAUX_RYTHME[niveau].cellules, base = suiteRythme(autorises, rnd), vus = new Set([cle(base)]), liste = [base];
    for (let essai = 0; essai < 60 && liste.length < 3; essai++) { const v = varianteRythme(rnd() < 0.5 ? base : liste[liste.length - 1], autorises, rnd); if (v && !vus.has(cle(v))) { vus.add(cle(v)); liste.push(v); } }
    while (liste.length < 3) { const s = suiteRythme(autorises, rnd); if (!vus.has(cle(s))) { vus.add(cle(s)); liste.push(s); } }
    options.push(...liste);
  } else {
    const base = melodie(niveau, rnd), vus = new Set([base.join()]), liste = [base];
    for (let essai = 0; essai < 60 && liste.length < 3; essai++) { const v = varianteMelodie(rnd() < 0.5 ? base : liste[liste.length - 1], niveau, rnd); if (v && !vus.has(v.join())) { vus.add(v.join()); liste.push(v); } }
    while (liste.length < 3) { const s = melodie(niveau, rnd); if (!vus.has(s.join())) { vus.add(s.join()); liste.push(s); } }
    options.push(...liste);
  }
  // la bonne réponse est la première générée ; elle est placée selon `placeBonne`, les deux autres propositions dans un ordre aléatoire
  bonne = placeBonne(historique, rnd); const autres = melange([1, 2], rnd), mel = [];
  for (let p = 0, k = 0; p < 3; p++) mel.push(p === bonne ? options[0] : options[autres[k++]]);
  return { genre, niveau, options: mel, bonne, id: `dictee:${genre}-${niveau}` };
}
export const descOption = (genre, motif, bpm) => (genre === 'rythme' ? descRythme(motif, bpm) : descMelodie(motif, bpm));
