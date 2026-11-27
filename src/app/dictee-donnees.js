// Dictées simples (CON-04) : on écoute un court motif, puis on retrouve celui qui a été joué parmi trois partitions. Générateurs purs (sans navigateur), testables sous Node.

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
  const idx = cells.map((_, i) => i).sort(() => rnd() - 0.5);
  for (const i of idx) {
    const alt = autorises.filter((c) => c !== cells[i] && dureeCell(c) === dureeCell(cells[i]) && !(i === 0 && c === 'R'));
    if (alt.length) { const r = cells.slice(); r[i] = alt[Math.floor(rnd() * alt.length)]; return r; }
  }
  return null;
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
  const idx = m.map((_, i) => i).filter((i) => !(cfg.fixePremiere && i === 0)).sort(() => rnd() - 0.5);
  for (const i of idx) {
    const deltas = [-2, -1, 1, 2].sort(() => rnd() - 0.5);
    for (const d of deltas) { const n = m[i] + d; if (n >= 0 && n < cfg.ambitus) { const r = m.slice(); r[i] = n; return r; } }
  }
  return null;
}
export const descMelodie = (m, bpm = 80) => ({ clef: 'treble', key: 0, time: null, bpm, measures: [m.map((i) => ({ n: [GAMME[i]], d: 'quarter', dots: 0 }))], width: 240, scale: 1.05 });

/* ---------------------------------------------------------------- question : trois propositions, une seule est celle qui a été jouée */
/** `genre` : 'rythme' | 'melodie' ; renvoie { genre, niveau, options: [motif, motif, motif], bonne (indice), id (élément suivi) }. */
export function question(genre, niveau, rnd = Math.random) {
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
  // la bonne réponse est la première générée ; on mélange les propositions
  const ordre = [0, 1, 2].sort(() => rnd() - 0.5); const mel = ordre.map((i) => options[i]); bonne = ordre.indexOf(0);
  return { genre, niveau, options: mel, bonne, id: `dictee:${genre}-${niveau}` };
}
export const descOption = (genre, motif, bpm) => (genre === 'rythme' ? descRythme(motif, bpm) : descMelodie(motif, bpm));
