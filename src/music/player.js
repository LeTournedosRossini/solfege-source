// Lecteur unique : lit une description de partition (voir describe.js) avec le moteur de Scorsaire.
//   - SoundFont (hébergées sur GitHub, mises en cache par le service worker) si le navigateur le permet ; sinon moteur léger intégré.
//   - curseur de lecture sur la partition (une barre qui suit les notes) quand l'hôte est fourni et qu'il y a plusieurs notes ;
//   - un seul son à la fois : lancer une lecture arrête la précédente ; un second appui sur le même bouton l'arrête.
import { transposeSequence } from '../../vendor/scorsaire/src/note/transpose.js';
import { readNote } from '../render.js';
import { buildSequence } from '../../vendor/scorsaire/src/audio/sequence.js';
import { createWebAudioEngine, prepareAudioSession, webAudioAvailable } from '../../vendor/scorsaire/src/audio/webaudio.js';
import { NullAudioEngine } from '../../vendor/scorsaire/src/audio/engine.js';
import { buildScore, renderDesc } from './describe.js';

export const SOUNDS_URL = 'https://letournedosrossini.github.io/scorsaire-lecteur/bloc-notes/sounds/';
let ctx = null, sound = null, light = null, active = null;
let sounds = SOUNDS_URL;
let onStatus = () => {};
/** Réglages : adresse des SoundFonts (ou autre emplacement / panne simulée) et fonction qui reçoit les messages d'état. */
export function configurePlayer(o = {}) { if (o.sounds) sounds = o.sounds; if (o.onStatus) onStatus = o.onStatus; }
export const stopAll = () => active?.stop();
if (typeof window !== 'undefined') window.addEventListener('solfege-pause', () => stopAll()); // onglet masqué : la lecture s'arrête

/** Barre verticale qui suit la position de lecture. Les colonnes de têtes de notes du SVG (triées par système puis par x) sont associées aux accords du document
 *  (triés par mesure puis par premier instant) ; la séquence jouée peut repasser plusieurs fois sur le même accord (reprises, deuxièmes fins) : on retrouve
 *  la colonne par l'identité de l'accord. Le curseur ne glisse que vers la droite ; à un saut en arrière, il se place directement. */
function makeCursor(host, sequence) {
  const svg = host.querySelector('svg');
  if (!svg) return null;
  const notes = [...sequence.notes].sort((a, b) => a.t - b.t);
  const first = new Map(); // accord → { measure, t, duration }
  for (const n of notes) if (!first.has(n.chord)) first.set(n.chord, { id: n.chord, measure: n.measure, t: n.t });
  const chords = [...first.values()].sort((a, b) => a.measure - b.measure || a.t - b.t);
  const heads = [...svg.querySelectorAll('[data-glyph^="notehead"]')];
  const hr = host.getBoundingClientRect();
  const raw = heads.map((h) => {
    const sys = h.closest('[data-system]'), r = h.getBoundingClientRect(), sr = sys.getBoundingClientRect();
    return { sys: Number(sys.dataset.system), x: Math.round(r.left - hr.left + r.width / 2), top: sr.top - hr.top - 4, h: sr.height + 8, right: sr.right - hr.left };
  });
  const cols = [];
  for (const p of raw.sort((a, b) => a.sys - b.sys || a.x - b.x)) if (!cols.length || cols.at(-1).sys !== p.sys || Math.abs(cols.at(-1).x - p.x) > 2) cols.push(p);
  if (cols.length < 2 || cols.length !== chords.length) return null;
  const colOf = new Map(chords.map((c, i) => [c.id, i]));
  // un événement par instant d'attaque de la séquence : { t, col, d }
  const events = [];
  for (const n of notes) if (!events.length || Math.abs(events.at(-1).t - n.t) > 1e-6) events.push({ t: n.t, col: colOf.get(n.chord), d: n.duration });
  const bar = document.createElement('div');
  bar.setAttribute('aria-hidden', 'true');
  bar.style.cssText = 'position:absolute;width:3px;border-radius:2px;background:var(--accent);opacity:.85;pointer-events:none;display:none';
  host.style.position = 'relative';
  host.append(bar);
  return {
    update(time) {
      let i = events.length - 1;
      while (i > 0 && events[i].t > time) i--;
      const e = events[i], p = cols[e.col], nx = events[i + 1], q = nx ? cols[nx.col] : null;
      let x = p.x;
      if (q && nx.col > e.col && q.sys === p.sys) x += (q.x - p.x) * Math.min(1, Math.max(0, (time - e.t) / (nx.t - e.t)));
      else if (!q) x += Math.max(0, p.right - 6 - p.x) * Math.min(1, Math.max(0, (time - e.t) / e.d));
      bar.style.display = 'block'; bar.style.left = `${x - 1}px`; bar.style.top = `${p.top}px`; bar.style.height = `${p.h}px`;
    },
    remove() { bar.remove(); },
  };
}

/** Lit une description. `button` : bouton ▶ (devient ■ pendant la lecture) ; `host` : élément qui contient la partition (pour le curseur). */
export async function play(desc, { button = null, host = null } = {}) {
  if (active) { const same = button && active.button === button; active.stop(); if (same) return; }
  prepareAudioSession();
  if (!ctx && webAudioAvailable()) ctx = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
  ctx?.resume?.();
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '…'; }
  // desc.noteDoc : mouvement importé de Scorsaire ; desc.speed : facteur de vitesse ; desc.transpose : demi-tons (le son seulement)
  const sequence = transposeSequence(buildSequence(readNote(desc.noteDoc ?? buildScore(desc)).movement, { speed: desc.speed ?? 1 }), desc.transpose ?? 0);
  let engine, kind = 'léger';
  try {
    if (!ctx || typeof AudioWorkletNode === 'undefined') throw new Error('moteur audio avancé indisponible sur cette page');
    sound = await (await import('../../vendor/scorsaire/src/note/sound.js')).soundEngineFor({ context: ctx, base: new URL(sounds, document.baseURI), mode: 'family', sequence, previous: sound });
    engine = sound.engine; kind = 'SoundFont';
  } catch (e) {
    onStatus(`SoundFont indisponible (${e?.message ?? e}) : moteur léger.`);
    light ??= webAudioAvailable() ? createWebAudioEngine({ context: ctx }) : new NullAudioEngine();
    engine = light;
  }
  const end = sequence.notes.reduce((m, n) => Math.max(m, n.t + n.duration), 0);
  engine.load(sequence); engine.play();
  if (kind === 'SoundFont') onStatus('Son : SoundFont (GitHub).');
  if (button) { button.textContent = '■ Stop'; button.disabled = false; }
  const cursor = host ? makeCursor(host, sequence) : null;
  let raf = 0, timer = 0;
  const done = (why = 'arrêt demandé') => {
    cancelAnimationFrame(raf); clearInterval(timer);
    engine.stop?.(); engine.allNotesOff?.(); cursor?.remove();
    if (button) button.textContent = label;
    active = null; onStatus(`Lecture finie : ${why} (son : ${kind}).`);
  };
  timer = setInterval(() => { if (!engine.isPlaying()) done('le moteur s’est arrêté'); else if (engine.position() >= end + 0.3) done('fin de la séquence'); }, 150);
  const frame = () => { cursor?.update(engine.position()); raf = requestAnimationFrame(frame); };
  if (cursor) frame();
  active = { stop: () => done(), button };
}

/** Partition + bouton ▶ dans un conteneur : dessine `desc` dans `host` et ajoute le bouton juste après. Renvoie le bouton. */
export function mountScore(host, desc, { width, ink, label, withPlay = true } = {}) {
  // le bouton ▶ d'un affichage précédent de ce même conteneur (jeux : une nouvelle question à chaque manche) est retiré
  if (host.nextElementSibling?.classList.contains('abc-play-btn')) { if (active?.button === host.nextElementSibling) active.stop(); host.nextElementSibling.remove(); }
  host.innerHTML = renderDesc(desc, { width, ink, label });
  const svg = host.querySelector('svg');
  if (svg) svg.style.setProperty('--w', `${svg.getAttribute('width')}px`);
  if (!withPlay) return null;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'abc-play-btn'; b.textContent = '▶ Écouter';
  b.onclick = () => play(desc, { button: b, host });
  host.after(b); return b;
}
