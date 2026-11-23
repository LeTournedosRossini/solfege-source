// Prototype : une partition dessinée par le moteur de Scorsaire (copie figée), sans abcjs.
// 1) un exemple de leçon (deux mesures)  2) un jeu de lecture de notes en clé de Sol.
import { createScore } from '../vendor/scorsaire/src/model/newscore.js';
import { createNoteChord } from '../vendor/scorsaire/src/model/elements.js';
import { createDocument } from '../vendor/scorsaire/src/model/document.js';
import { placeChord } from '../vendor/scorsaire/src/model/noteedit.js';
import { frac } from '../vendor/scorsaire/src/model/fraction.js';
import { createNoteDocument } from '../vendor/scorsaire/src/note/document.js';
import { parseNoteDocument } from '../vendor/scorsaire/src/note/document.js';
import { buildSequence } from '../vendor/scorsaire/src/audio/sequence.js';
import { createWebAudioEngine, prepareAudioSession, webAudioAvailable } from '../vendor/scorsaire/src/audio/webaudio.js';
import { NullAudioEngine } from '../vendor/scorsaire/src/audio/engine.js';
import { renderScore } from './render.js';

// Les SoundFonts restent hébergées sur GitHub (décision du 21 novembre). ?sounds=… permet de simuler un autre emplacement (ou une panne).
const SOUNDS = new URLSearchParams(location.search).get('sounds') || 'https://letournedosrossini.github.io/scorsaire-lecteur/bloc-notes/sounds/';
let ctx = null, sound = null, light = null, active = null;
const status = (t) => { const el = document.getElementById('sndstatus'); if (el) el.textContent = t; };

/** Curseur de lecture : une barre verticale qui suit la position de lecture sur la partition (seulement s'il y a plusieurs notes).
 *  Les têtes de notes du SVG, triées par système puis par x, sont associées aux notes de la séquence, triées par temps (valable pour une seule voix). */
function makeCursor(host, sequence) {
  const svg = host.querySelector('svg');
  if (!svg) return null;
  const notes = [...sequence.notes].sort((a, b) => a.t - b.t);
  const heads = [...svg.querySelectorAll('[data-glyph^="notehead"]')];
  if (heads.length < 2 || heads.length !== notes.length) return null;
  const hr = host.getBoundingClientRect();
  const pts = heads.map((h) => {
    const sys = h.closest('[data-system]'), r = h.getBoundingClientRect(), sr = sys.getBoundingClientRect();
    return { sys: Number(sys.dataset.system), x: r.left - hr.left + r.width / 2, top: sr.top - hr.top - 4, h: sr.height + 8, right: sr.right - hr.left };
  }).sort((p, q) => p.sys - q.sys || p.x - q.x).map((p, i) => ({ ...p, t: notes[i].t, d: notes[i].duration }));
  const bar = document.createElement('div');
  bar.setAttribute('aria-hidden', 'true');
  bar.style.cssText = 'position:absolute;width:3px;border-radius:2px;background:var(--accent);opacity:.85;pointer-events:none;display:none';
  host.style.position = 'relative';
  host.append(bar);
  return {
    update(time) {
      let i = pts.length - 1;
      while (i > 0 && pts[i].t > time) i--;
      const p = pts[i], q = pts[i + 1];
      let x = p.x;
      if (q && q.sys === p.sys) x += (q.x - p.x) * Math.min(1, Math.max(0, (time - p.t) / (q.t - p.t)));
      else if (!q) x += Math.max(0, p.right - 6 - p.x) * Math.min(1, Math.max(0, (time - p.t) / p.d));
      bar.style.display = 'block'; bar.style.left = `${x - 1}px`; bar.style.top = `${p.top}px`; bar.style.height = `${p.h}px`;
    },
    remove() { bar.remove(); },
  };
}

/** Lance ou arrête la lecture d'un document (à appeler dans un clic). SoundFont si possible, sinon moteur léger. */
async function play(json, btn, host) {
  if (active) { const same = active.btn === btn; active.stop(); if (same) return; }
  prepareAudioSession();
  if (!ctx && webAudioAvailable()) ctx = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
  ctx?.resume?.();
  const label = '▶ Écouter'; btn.disabled = true; btn.textContent = '…';
  const sequence = buildSequence(parseNoteDocument(json).movement, { speed: 1 });
  let engine, kind = 'léger';
  try {
    if (!ctx || typeof AudioWorkletNode === 'undefined') throw new Error('pas de worklet');
    sound = await (await import('../vendor/scorsaire/src/note/sound.js')).soundEngineFor({ context: ctx, base: new URL(SOUNDS, document.baseURI), mode: 'family', sequence, previous: sound });
    engine = sound.engine; kind = 'SoundFont';
  } catch (e) {
    status('SoundFont indisponible (' + (e?.message ?? e) + ') : moteur léger.');
    light ??= webAudioAvailable() ? createWebAudioEngine({ context: ctx }) : new NullAudioEngine();
    engine = light;
  }
  const end = sequence.notes.reduce((m, n) => Math.max(m, n.t + n.duration), 0);
  engine.load(sequence); engine.play();
  window.__dbg = { engine, ctx, sequence, end, kind };
  if (kind === 'SoundFont') status('Son : SoundFont (GitHub).');
  btn.textContent = '■ Stop'; btn.disabled = false;
  const cursor = makeCursor(host, sequence);
  let raf = 0;
  const done = (why = 'arrêt demandé') => { status(`Lecture finie : ${why} (position ${engine.position().toFixed(1)} s sur ${end.toFixed(1)} s ; son : ${kind}).`); cancelAnimationFrame(raf); clearInterval(timer); engine.stop?.(); engine.allNotesOff?.(); cursor?.remove(); btn.textContent = label; active = null; };
  const timer = setInterval(() => { if (!engine.isPlaying()) done('le moteur s’est arrêté'); else if (engine.position() >= end + 0.3) done('fin de la séquence'); }, 150);
  const frame = () => { cursor?.update(engine.position()); raf = requestAnimationFrame(frame); };
  if (cursor) frame();
  active = { stop: () => done(), btn };
}
const addPlay = (host, getJson) => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = '▶ Écouter';
  b.onclick = () => play(getJson(), b, host);
  host.after(b); return b;
};

const FR = { C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

/** rows = tableau de mesures, chacune une liste de [lettre, altération, octave] ; base = durée de chaque note. */
function noteDoc(rows, { clef = 'G', base = 'quarter' } = {}) {
  const work = createScore({ measures: rows.length, parts: [{ staffType: 'score', clef }], tempo: { bpm: 90 }, lang: 'fr' });
  const staff = work.movements[0].tracks[0].staves[0];
  const doc = createDocument(work);
  const per = base === 'whole' ? 1 : 4;
  doc.transaction('proto', () => rows.forEach((row, measure) => row.forEach(([step, alter, octave], k) => placeChord(doc, {
    staff, measure, position: frac(k, per), duration: { base, dots: 0 },
    makeChord: (d) => createNoteChord([{ step, alter, octave }], { duration: d.base, dots: d.dots }),
  }))));
  return createNoteDocument(doc.work);
}

const ink = () => (matchMedia('(prefers-color-scheme: dark)').matches ? '#f4f1ea' : '#1c1b1f');
function draw(el, json, width) {
  el.innerHTML = renderScore(json, { width, ink: ink() });
}

// 1) Leçon
const lesson = document.getElementById('lesson');
const gamme = [['C', 0, 4], ['D', 0, 4], ['E', 0, 4], ['F', 0, 4]];
const gamme2 = [['G', 0, 4], ['A', 0, 4], ['B', 0, 4], ['C', 0, 5]];
const lessonDoc = noteDoc([gamme, gamme2]);
draw(lesson, lessonDoc, Math.min(560, innerWidth - 32));
addPlay(lesson, () => lessonDoc);

// 2) Jeu : lecture de notes, clé de Sol, de Fa 3 à Mi 6
const L = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const pool = [];
for (let i = 3 * 7 + 3; i <= 6 * 7 + 2; i++) pool.push([L[i % 7], 0, Math.floor(i / 7)]);
const stage = document.getElementById('stage');
const answers = document.getElementById('answers');
const result = document.getElementById('result');
const scoreEl = document.getElementById('score');
let current, currentDoc, good = 0, tries = 0;
addPlay(stage, () => currentDoc);
function next() {
  current = pool[Math.floor(Math.random() * pool.length)];
  currentDoc = noteDoc([[current]], { base: 'whole' });
  draw(stage, currentDoc, Math.min(260, innerWidth - 32));
  result.textContent = '';
}
L.forEach((l) => {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = FR[l];
  b.onclick = () => {
    tries++;
    const ok = l === current[0];
    if (ok) good++;
    result.textContent = ok ? 'Exact.' : `C’était ${FR[current[0]]}.`;
    scoreEl.textContent = `${good} / ${tries}`;
    setTimeout(next, 700);
  };
  answers.append(b);
});
next();
window.__proto = { noteDoc };
