// Convertit l'extraction brute des leçons (ABC) en données de l'application : src/app/data/lecons.json
// Usage : node tools/convertir-lecons.mjs <brute.json>
import fs from 'node:fs';
import { parseAbc } from './abc-vers-desc.mjs';
import { renderDesc } from '../src/music/describe.js';
const brut = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const PROGRAMS = { 41: 'violin' }; // General MIDI (1 = piano) → identifiant d'instrument de Scorsaire
// Corrections de contenu décidées après la reprise (le texte de l'ancienne application est sinon repris tel quel). Chaque correction doit s'appliquer, sinon la conversion échoue.
const CORRECTIONS = [
  { id: 'substitution-accords',
    find: "ce qui préserve l'essentiel de la tension tout en créant une basse chromatique.",
    replace: "ce qui préserve l'essentiel de la tension tout en créant une basse chromatique. Le triton est justement l'intervalle compris entre la tierce et la septième de l'accord : Si–Fa dans Sol 7, Fa–Dob (qui sonne comme Si) dans Réb 7 ; les deux accords contiennent donc le même triton. Et comme Réb se trouve un demi-ton au-dessus de la tonique Do, la basse descend d'un demi-ton (Réb → Do) au lieu de la quinte habituelle (Sol → Do)." },
];
let ko = 0, n = 0;
for (const c of CORRECTIONS) { const l = brut.find((x) => x.id === c.id); if (!l || !l.html.includes(c.find)) throw new Error(`Correction non applicable : ${c.id}`); l.html = l.html.replace(c.find, c.replace); }
const lecons = brut.map((l) => ({
  id: l.id, html: l.html.replace(/ style="overflow: hidden; height: [\d.]+px;"/g, ''), // le HTML est repris tel quel, sans les styles que posait abcjs sur ses conteneurs
  scores: l.scores.map((s) => {
    n++;
    try {
      const desc = parseAbc(s.abc, { staffwidth: s.staffwidth });
      desc.bpm = s.qpm ?? 120; // l'ancien lecteur jouait la partition au tempo par défaut d'abcjs (120 à la noire) ou au tempo demandé
      if (s.scale && s.scale !== 1) { desc.scale = s.scale; if (desc.width) desc.width = Math.round(desc.width * s.scale); }
      if (s.program && PROGRAMS[s.program]) desc.instrument = PROGRAMS[s.program];
      // le moteur de Scorsaire demande un peu plus de place qu'abcjs : on élargit jusqu'à ce que le dessin tienne sur une seule ligne, comme avant
      let w = desc.width ?? 320; let svg = renderDesc(desc, { width: w });
      for (let k = 0; k < 12 && (svg.match(/data-system=/g) ?? []).length > 1; k++) { w = Math.round(w * 1.1); desc.width = w; svg = renderDesc(desc, { width: w }); }
      if (desc.measures.some((m) => (Array.isArray(m) ? m : m.events).some((e) => e.tuplet)) && !desc.scale) { desc.scale = 1.6; desc.width = Math.round((desc.width ?? 200) * 1.6); } // un triolet isolé est sinon dessiné trop serré
      const reprise = desc.measures.some((m) => !Array.isArray(m) && (m.repeatStart || m.repeatEnd || m.volta));
      return { desc, play: !!s.play || reprise };
    } catch (e) { ko++; console.log('ECHEC', l.id, e.message.slice(0, 120)); return { erreur: e.message, abc: s.abc, play: !!s.play }; }
  }),
}));
fs.writeFileSync(new URL('../src/app/data/lecons.json', import.meta.url), JSON.stringify(lecons));
console.log(`${lecons.length} leçons, ${n} partitions, ${ko} en échec, ${(fs.statSync(new URL('../src/app/data/lecons.json', import.meta.url)).size / 1024).toFixed(0)} Ko`);
