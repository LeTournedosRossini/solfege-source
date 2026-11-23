// Couche musicale : décrire une partition simplement (objet JSON), la construire dans le modèle de Scorsaire, la dessiner.
//
//   { clef: 'treble' | 'bass' | 'none', key: 0 (nombre d'altérations, -7..7), time: [4,4] | null (null = pas de chiffrage affiché),
//     bpm: 90, width: 300 (largeur de dessin en px, facultatif), scale: 1.1 (agrandissement), instrument: 'violin' (instrument de Scorsaire, facultatif),
//     measures: [ [ événement, … ] ou { events: [ … ], repeatStart, repeatEnd, volta: [1] }, … ] }
//   événement : { n: ['C4', 'E4'] (notes jouées ensemble ; absent pour un silence), d: 'whole'|'half'|'quarter'|'eighth'|'sixteenth'|…, dots: 0..2,
//                 rest: true (silence), gap: true (espace invisible), tie: true (liée à l'événement suivant),
//                 art: ['staccato', 'tenuto', 'accent', 'trill', 'mordent', 'mordentInverted'],
//                 lyric: 'I' (texte sous la note), slurStart / slurEnd: true (liaison de phrasé),
//                 grace: ['A4'] (note d'ornement avant), tuplet: { ratio: [3,2], base: 'eighth', id: 'a' }, sign: 'segno' | 'coda' }
//   note : lettre (A-G), altération facultative (# b x bb), octave scientifique (Do central = C4).
import { createScore } from '../../vendor/scorsaire/src/model/newscore.js';
import { createDocument } from '../../vendor/scorsaire/src/model/document.js';
import { createNoteChord, createRest, createArticulation, createGraceNote, createMarker, createSlur, createVolta } from '../../vendor/scorsaire/src/model/elements.js';
import { replaceVoiceMeasure, tieChords } from '../../vendor/scorsaire/src/model/noteedit.js';
import { writtenDuration, timeSigDuration } from '../../vendor/scorsaire/src/model/pitch.js';
import { frac, fAdd, fMul, fCmp, ZERO } from '../../vendor/scorsaire/src/model/fraction.js';
import { PID } from '../../vendor/scorsaire/src/model/pid.js';
import { getProperty } from '../../vendor/scorsaire/src/model/props.js';
import { createNoteDocument } from '../../vendor/scorsaire/src/note/document.js';
import { renderScore } from '../render.js';

const ALTER = { '': 0, '#': 1, b: -1, x: 2, bb: -2, '##': 2 };
const CLEF = { treble: 'G', bass: 'F', none: 'G' };

/** 'F#4' → { step: 'F', alter: 1, octave: 4 } */
export function parseNote(name) {
  const m = /^([A-G])(##|bb|x|#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Note invalide : ${name}`);
  return { step: m[1], alter: ALTER[m[2] ?? ''], octave: Number(m[3]) };
}

/** Durée réelle d'un événement (n-olet compris), en fraction de ronde. */
export function realDuration(e) {
  const w = writtenDuration({ base: e.d, dots: e.dots ?? 0 });
  return e.tuplet ? fMul(w, frac(e.tuplet.ratio[1], e.tuplet.ratio[0])) : w;
}

/** Construit le document Scorsaire de la description ; renvoie la chaîne JSON d'une « note » Scorsaire. */
export function buildScore(desc) {
  const measures = desc.measures.map((m) => (Array.isArray(m) ? { events: m } : m));
  const work = createScore({
    measures: measures.length, parts: [desc.instrument ? { instrumentId: desc.instrument } : { staffType: 'score', clef: CLEF[desc.clef ?? 'treble'] }],
    timeSig: desc.time ?? [4, 4], keySig: desc.key ?? 0, tempo: { bpm: desc.bpm ?? 90 }, lang: 'fr',
  });
  const mv = work.movements[0];
  const staff = mv.tracks[0].staves[0];
  const doc = createDocument(work);
  doc.transaction('description', () => {
    const chordsOf = [];
    measures.forEach((meas, mi) => {
      const events = meas.events;
      const masterbar = mv.masterbars[mi];
      if (meas.repeatStart) doc.set(masterbar, PID.REPEAT_START, true);
      if (meas.repeatEnd) doc.set(masterbar, PID.REPEAT_END, true);
      if (meas.volta) doc.add(mv, 'voltas', createVolta({ measureId: masterbar.id, span: 1, numbers: meas.volta, open: !!meas.voltaOpen }));
      const sum = events.reduce((t, e) => fAdd(t, realDuration(e)), ZERO);
      if (!desc.time || fCmp(sum, timeSigDuration(desc.time)) !== 0) doc.set(masterbar, PID.MEASURE_LENGTH, sum);
      let pos = ZERO;
      const occupants = [];
      const els = [];
      events.forEach((e, k) => {
        const tuplet = e.tuplet ? { id: e.tuplet.id ?? `t${mi}`, ratio: [...e.tuplet.ratio], base: { base: e.tuplet.base, dots: 0 } } : null;
        const props = tuplet ? { [PID.TUPLET]: tuplet } : {};
        let el;
        if (e.rest || e.gap || !e.n) el = createRest({ duration: e.d, dots: e.dots ?? 0, explicit: true, props });
        else {
          if (e.art?.length) props[PID.ARTICULATIONS] = e.art.map((a) => createArticulation(a));
          const graceNotes = e.grace?.length ? [createGraceNote('appoggiatura', e.grace.map(parseNote))] : [];
          el = createNoteChord(e.n.map(parseNote), { duration: e.d, dots: e.dots ?? 0, graceNotes, props });
        }
        const end = fAdd(pos, realDuration(e));
        occupants.push({ el, start: pos, end });
        els.push(el);
        pos = end;
        if (e.sign) doc.add(mv, 'markers', createMarker({ measureId: masterbar.id, markerType: e.sign }));
      });
      replaceVoiceMeasure(doc, { staff, measure: mi, occupants });
      chordsOf.push({ events, els });
    });
    // liaisons : un événement « tie » est lié à l'événement suivant (même mesure ou mesure suivante)
    const flat = chordsOf.flatMap((m) => m.events.map((e, i) => ({ e, el: m.els[i] })));
    // liaisons de phrasé : de l'événement « slurStart » au prochain « slurEnd »
    let open = null;
    flat.forEach((x) => {
      if (x.e.slurStart && x.el.notes) open = x.el;
      if (x.e.slurEnd && open && x.el.notes) { doc.set(staff, PID.SLURS, [...getProperty(staff, PID.SLURS), createSlur(open.id, x.el.id)]); open = null; }
    });
    flat.forEach((x, i) => { if (x.e.tie && flat[i + 1] && x.el.notes && flat[i + 1].el.notes) tieChords(doc, staff, x.el, flat[i + 1].el); });
  });
  return createNoteDocument(doc.work);
}

/** Dessine une description en SVG (chaîne). Options : width (px), ink (couleur), label (texte accessible). */
export function renderDesc(desc, { width = desc.width ?? 320, ink = '#000', label } = {}) {
  if (desc.noteDoc) return renderScore(desc.noteDoc, { width, ink, label, showTime: true });
  if (desc.clef === 'none') return emptyStaffSvg(width, ink, label);
  const ss = Math.max(7, Math.min(12, Math.round(Math.max(100, Math.floor(width)) / 46))) * (desc.scale ?? 1);
  const svg = renderScore(buildScore(desc), { width, ink, showTime: desc.time != null, label, staffSpace: ss });
  // « gap » : espace invisible (portée montrant seulement la clé et l'armure) : on retire le silence dessiné
  const events = desc.measures.flatMap((m) => (Array.isArray(m) ? m : m.events));
  let out = events.some((e) => e.gap) ? svg.replace(/<g data-glyph="rest[A-Za-z0-9]*"[^>]*>.*?<\/g>/gs, '') : svg;
  if (events.some((e) => e.lyric)) out = addLyrics(out, events.filter((e) => e.n).map((e) => e.lyric ?? ''), ink);
  return out;
}

/** Portée vide (cinq lignes, sans clé) pour les leçons qui montrent la portée seule. */
export function emptyStaffSvg(width, ink, label = 'Portée de cinq lignes') {
  const h = 60, step = 10, y0 = 10;
  const lines = [0, 1, 2, 3, 4].map((i) => `<line x1="0" y1="${y0 + i * step}" x2="${width}" y2="${y0 + i * step}" stroke="${ink}" stroke-width="1.2"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="${label}">${lines}</svg>`;
}

/** Écrit un texte sous chaque note (une colonne de notes = un texte), à la hauteur du bas de la portée : degrés, syllabes… */
function addLyrics(svg, texts, ink) {
  const staff = /<g data-staff="[^"]*"[^>]*transform="translate\(([-\d.]+),([-\d.]+)\)"/.exec(svg);
  const sys = /<g data-system="[^"]*" transform="translate\(([-\d.]+),([-\d.]+)\)"/.exec(svg);
  if (!staff) return svg;
  const ys = [...svg.matchAll(/data-role="staff-line"[^>]*? y1="([-\d.]+)"/g)].map((m) => Number(m[1]));
  if (ys.length < 2) return svg;
  const top = Math.min(...ys), bottom = Math.max(...ys), ss = (bottom - top) / 4;
  const baseY = Number(staff[2]) + (sys ? Number(sys[2]) : 0) + bottom + 3.4 * ss;
  const xs = [...new Set([...svg.matchAll(/<g data-glyph="notehead[A-Za-z0-9]*"[^>]*transform="translate\(([-\d.]+),/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const label = xs.map((x, i) => (texts[i] ? `<text x="${(x + 0.6 * ss).toFixed(1)}" y="${baseY.toFixed(1)}" text-anchor="middle" font-family="Fraunces,serif" font-weight="700" font-size="${(1.6 * ss).toFixed(1)}" fill="${ink}">${texts[i]}</text>` : '')).join('');
  const extra = Math.ceil(baseY + 1.2 * ss);
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const h = Math.max(Number(vb[2]), extra);
  return svg.replace(/width="([\d.]+)" height="[\d.]+" viewBox="0 0 ([\d.]+) [\d.]+"/, `width="$1" height="${h}" viewBox="0 0 $2 ${h}"`).replace('</svg>', `${label}</svg>`);
}
