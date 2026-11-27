// Sons de métronome (claquement de bois) pour les dictées rythmiques : le précompte de 4 temps et, au choix, le rythme joué en clics plutôt qu'au piano.
// Fabriqués à la volée par l'API audio du navigateur (rien à charger) : un court bruit filtré, plus aigu sur le premier temps du précompte.
let ctx = null, bruit = null;
const contexte = () => { ctx ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(); ctx.resume?.(); return ctx; };
const tampon = (c) => { if (!bruit) { bruit = c.createBuffer(1, Math.floor(c.sampleRate * 0.08), c.sampleRate); const d = bruit.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return bruit; };

/** Un claquement à l'instant `t` (secondes du contexte audio) ; `freq` règle la hauteur du claquement. Renvoie le noeud, pour pouvoir l'arrêter. */
function claquer(c, t, freq, volume, sources) {
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = tampon(c); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 4;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(volume, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  s.connect(f); f.connect(g); g.connect(c.destination); s.start(t); s.stop(t + 0.08); sources.push(s);
}

/**
 * Joue le précompte (4 clics) et/ou les attaques d'un rythme.
 *   bpm : battements par minute (un battement = une noire) ; precompte : vrai pour 4 clics avant ; battements : positions des attaques du rythme, en noires depuis son début ; decalage : secondes avant le premier clic.
 * Renvoie { duree (secondes), stop() }.
 */
export function jouerClics({ bpm, precompte = false, battements = [], decalage = 0.05 }) {
  const c = contexte(), noire = 60 / bpm, sources = [], t0 = c.currentTime + decalage;
  const debut = precompte ? 4 : 0;
  if (precompte) for (let i = 0; i < 4; i++) claquer(c, t0 + i * noire, i === 0 ? 3000 : 2200, i === 0 ? 0.9 : 0.6, sources);   // le premier temps est plus aigu
  for (const b of battements) claquer(c, t0 + (debut + b) * noire, 900, 1, sources);                                          // le rythme : un claquement plus grave à chaque attaque
  const fin = battements.length ? debut + Math.max(...battements) + 1 : debut;
  return { duree: decalage + fin * noire, stop() { for (const s of sources) { try { s.stop(); } catch (e) { /* déjà arrêté */ } } } };
}
