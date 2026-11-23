/*
 * Bends / dives de guitare (tranche 4d-b) — logique de modèle : résolution des entrées `PID.BENDS`, montant, texte, chaînage, ligne de maintien,
 * visibilité des notes. Port de `guitarbend.cpp` (`computeBendAmount`, `totBendAmountIncludingPrecedingBends`, `computeBendText`,
 * `findPrecedingBend`, `findFollowingPreBendOrDive`, `updateHoldLine`, `overlappingBendOrDive`) et de `GuitarBendLayout::startOnEndNote`
 * (MuseScore v4.7.5). Pur ; la géométrie (tablature) est dans `tabspanners.js: tabBendItems`.
 *
 * Écarts assumés, documentés : pas de `slack` (dive « mou »), pas de barre de whammy dans la recherche des bends précédents / suivants
 * (`findOverlappingWhammyBar` : modèle pas encore posé), pas de décalage de hauteur en cents (les hauteurs sont entières : un quart de ton ne vient que du
 * slight bend), pas de `overrideBendVisibilityRules` (choix utilisateur de masquer/afficher une note).
 */
import { PID, getProperty } from '../model/index.js';
import { resolveStaffTies } from './ties.js';

const str = (n) => (n.type === 'tabnote' ? getProperty(n, PID.STRING) : -1); // portée de notation : pas de corde (tout égal)
export const isDiveType = (t) => t === 'dive' || t === 'preDive' || t === 'dip' || t === 'scoop';
const isPreType = (t) => t === 'preBend' || t === 'preDive';

/** « ¼ ½ ¾ » ou « 1/4 … » (`bendAmountToString`). */
export function bendAmountToString(fulls, quarts, useFractions = true) {
  let s = fulls !== 0 ? String(fulls) : '';
  const q = Math.abs(quarts);
  if (useFractions) {
    s += q === 1 ? '¼' : q === 2 ? '½' : q === 3 ? '¾' : '';
  } else {
    if (s && quarts !== 0) s += ' ';
    s += q === 1 ? '1/4' : q === 2 ? '1/2' : q === 3 ? '3/4' : '';
  }
  return s;
}

/**
 * Résout `PID.BENDS`. Renvoie `{ list, ...fonctions }` : chaque élément de `list` = { id, type, entry, start, end, isDive } où `start`/`end` =
 * { note, chord, voice, mi, seq (index dans la suite de la voix), grace }. Les entrées dont une note a disparu sont ignorées.
 * @param style (sid) => valeur — pour `useFractionCharacters`, `guitarBendUseFull`, `alignPreBendAndPreDiveToGraceNote`, `showFretOnFullBendRelease`
 */
export function resolveStaffBends(staff, style) {
  const raw = getProperty(staff, PID.BENDS) || [];
  if (!raw.length) return null;
  const ties = resolveStaffTies(staff);
  // suites par voix : ornements « avant » puis accord (les silences comptent, pour `prevChordRest`)
  const seqs = staff.voices.map(() => []);
  const noteRec = new Map();
  staff.voices.forEach((voice, vi) => {
    voice.measures.forEach((measure, mi) => {
      for (const item of measure.items) {
        if (item.type !== 'chord' && item.type !== 'rest') continue;
        if (item.type === 'chord') {
          for (const g of item.graceNotes ?? []) {
            if (getProperty(g, PID.GRACE_TYPE)?.endsWith('after')) continue;
            const rec = { item: g, grace: true, parent: item, voice: vi, mi };
            seqs[vi].push(rec);
            for (const n of g.notes) noteRec.set(n.id, { note: n, chord: g, voice: vi, mi, rec, grace: true });
          }
        }
        const rec = { item, grace: false, voice: vi, mi };
        seqs[vi].push(rec);
        if (item.type === 'chord') for (const n of item.notes) noteRec.set(n.id, { note: n, chord: item, voice: vi, mi, rec, grace: false });
        // grace notes AFTER the chord: they follow it in the voice and can be the landing note of a bend (GP import: a bend with no tied note)
        if (item.type === 'chord') {
          for (const g of item.graceNotes ?? []) {
            if (!getProperty(g, PID.GRACE_TYPE)?.endsWith('after')) continue;
            const grec = { item: g, grace: true, after: true, parent: item, voice: vi, mi };
            seqs[vi].push(grec);
            for (const n of g.notes) noteRec.set(n.id, { note: n, chord: g, voice: vi, mi, rec: grec, grace: true });
          }
        }
      }
    });
  });
  seqs.forEach((seq) => seq.forEach((r, i) => { r.seq = i; }));
  const tieFor = new Map(ties.map((t) => [t.startNoteId, t]));
  const tieBack = new Map(ties.map((t) => [t.endNoteId, t]));

  const list = raw.map((e) => {
    const s = noteRec.get(e.startNoteId); const en = noteRec.get(e.endNoteId ?? e.startNoteId);
    if (!s || !en) return null;
    const mk = (r) => ({ note: r.note, chord: r.chord, voice: r.voice, mi: r.mi, seq: r.rec.seq, grace: r.grace });
    return { id: e.id, type: e.type, entry: e, start: mk(s), end: mk(en), isDive: isDiveType(e.type) };
  }).filter(Boolean);
  list.sort((a, b) => (a.start.voice - b.start.voice) || (a.start.seq - b.start.seq));
  const byStart = new Map(); const byEnd = new Map();
  for (const b of list) {
    if (!byStart.has(b.start.note.id)) byStart.set(b.start.note.id, []);
    byStart.get(b.start.note.id).push(b);
    if (!byEnd.has(b.end.note.id)) byEnd.set(b.end.note.id, []);
    byEnd.get(b.end.note.id).push(b);
  }
  const A = {
    list, noteRec,
    // `Note::bendFor/bendBack/diveFor/diveBack`
    bendFor(noteId) {
      let dive = null;
      for (const b of byStart.get(noteId) ?? []) { if (b.type === 'scoop') continue; if (!b.isDive) return b; dive = b; }
      return dive;
    },
    bendBack(noteId) {
      let dive = null;
      for (const b of byEnd.get(noteId) ?? []) { if (b.type === 'slightBend' || b.type === 'dip') continue; if (!b.isDive) return b; dive = b; }
      return dive;
    },
    diveFor: (noteId) => (byStart.get(noteId) ?? []).find((b) => b.isDive && b.type !== 'scoop') ?? null,
    diveBack: (noteId) => (byEnd.get(noteId) ?? []).find((b) => b.isDive && b.type !== 'dip') ?? null,
    tieFor: (id) => tieFor.get(id) ?? null,
    tieBack: (id) => tieBack.get(id) ?? null,
    isPreStart: (noteId) => { const r = noteRec.get(noteId); const b = r && r.grace ? A.bendFor(noteId) : null; return Boolean(b && isPreType(b.type)); },
    prevCR: (rec) => seqs[rec.voice][rec.seq - 1] ?? null,
    nextCR: (rec) => seqs[rec.voice][rec.seq + 1] ?? null,
    seqs,
  };
  const memo = new Map();
  const cached = (key, b, f) => { const k = `${key}:${b.id}`; if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };

  A.overlapping = (b) => {
    const o = b.isDive ? A.bendFor(b.start.note.id) : A.diveFor(b.start.note.id);
    return o && o !== b && o.end.note.id === b.end.note.id ? o : null;
  };
  A.amount = (b) => cached('amt', b, () => {
    if (b.type === 'slightBend') return 1;
    if (b.type === 'scoop') return -2;
    if (b.type === 'dip') return b.entry.amount ?? -2;
    if (b.isDive && A.overlapping(b)) return b.entry.amount ?? 0;
    let diff = 2 * (b.end.note.pitch - b.start.note.pitch);
    const ov = A.overlapping(b);
    if (ov) diff -= A.amount(ov);
    return diff;
  });
  A.preceding = (b) => cached('prev', b, () => {
    let startN = b.start.note;
    while (A.tieBack(startN.id) && noteRec.get(A.tieBack(startN.id).startNoteId)) startN = noteRec.get(A.tieBack(startN.id).startNoteId).note;
    const valid = (t) => t !== 'slightBend' && t !== 'dip' && t !== 'scoop';
    const backOf = (n) => (b.isDive ? A.bendBack(n.id) : A.diveBack(n.id));
    let back = backOf(startN);
    while (back && back.isDive !== b.isDive && valid(back.type) && !A.overlapping(back)) {
      startN = back.start.note;
      back = backOf(startN);
    }
    const pb = b.isDive ? A.diveBack(startN.id) : A.bendBack(startN.id);
    if (pb && pb.isDive === b.isDive && valid(pb.type)) return pb;
    if (isPreType(b.type)) {
      const rec = noteRec.get(startN.id);
      const prev = A.prevCR(rec.rec);
      if (!prev || prev.item.type !== 'chord') return null;
      for (let note of prev.item.notes) {
        while (A.tieBack(note.id) && noteRec.get(A.tieBack(note.id).startNoteId)) note = noteRec.get(A.tieBack(note.id).startNoteId).note;
        const pbend = A.bendBack(note.id);
        let ok = Boolean(pbend && pbend.isDive === b.isDive && valid(pbend.type) && A.tot(pbend) === A.amount(b));
        if (ok && b.type === 'preBend') ok = str(pbend.start.note) === str(b.start.note) && pbend.start.note.pitch === b.start.note.pitch; // même frette, même corde
        if (ok) return pbend;
      }
    }
    return null;
  });
  A.tot = (b) => cached('tot', b, () => {
    let amount = A.amount(b);
    if (b.type === 'preDive' || b.type === 'preBend' || b.type === 'dip' || b.type === 'scoop') return amount;
    let p = A.preceding(b);
    while (p) {
      amount += A.amount(p);
      if (p.type === 'preDive' || p.type === 'preBend') return amount;
      p = A.preceding(p);
    }
    return amount;
  });
  A.isRelease = (b) => A.amount(b) < 0;
  A.isFullRelease = (b) => A.isRelease(b) && A.tot(b) === 0;
  A.isFullReleaseDive = (b) => b.isDive && A.tot(b) === 0;
  /** `angledPreBend` : pre-bend dont la note d'arrivée n'est pas sur la corde du haut de son accord. */
  A.upString = (chord) => Math.min(...chord.notes.map(str));
  A.angledPreBend = (b) => b.type === 'preBend' && str(b.end.note) > A.upString(b.end.chord);
  A.following = (b) => {
    let endN = b.end.note;
    while (A.tieFor(endN.id) && noteRec.get(A.tieFor(endN.id).endNoteId)) endN = noteRec.get(A.tieFor(endN.id).endNoteId).note;
    const rec = noteRec.get(endN.id);
    // l'accord suivant : ses ornements « avant » d'abord (le pre-bend a sa note de départ dans un ornement)
    const next = A.nextCR(rec.rec);
    if (!next || next.item.type !== 'chord') return null;
    for (let note of next.item.notes) {
      while (A.tieFor(note.id) && noteRec.get(A.tieFor(note.id).endNoteId)) note = noteRec.get(A.tieFor(note.id).endNoteId).note;
      const bend = A.bendFor(note.id);
      let ok = Boolean(bend && bend.isDive === b.isDive && isPreType(bend.type) && A.amount(bend) === A.tot(b));
      if (ok && bend.type === 'preBend') ok = str(bend.start.note) === str(b.start.note) && bend.start.note.pitch === b.start.note.pitch;
      if (ok) return bend;
    }
    return null;
  };
  /** Texte du montant (`computeBendText`). */
  A.digit = (b) => cached('digit', b, () => {
    if (isPreType(b.type)) {
      const p = A.preceding(b);
      if (p && A.holdLine(p)) return '';
    }
    const q = A.tot(b);
    const fulls = Math.trunc(q / 4); const quarts = q % 4;
    if (fulls === 0 && q === 0) return '';
    let s = bendAmountToString(fulls, quarts, style('USE_FRACTION_CHARACTERS'));
    if (b.isDive) {
      if (q > 0) s = `+${s}`;
      else if (q < 0 && fulls === 0) s = `-${s}`;
    }
    if (s === '1' && style('GUITAR_BEND_USE_FULL')) s = 'full';
    return s;
  });
  /** `GuitarBendLayout::startOnEndNote` : la ligne part de la note d'arrivée (pre-bend, grace-note bend sous condition, pre-dive). */
  A.startOnEndNote = (b) => {
    if (!(b.type === 'preBend' || b.type === 'graceNoteBend' || b.type === 'preDive')) return false;
    const align = style('ALIGN_PRE_BEND_AND_PRE_DIVE_TO_GRACE_NOTE');
    if (!align && (b.type === 'preBend' || b.type === 'preDive')) return true;
    if (b.type === 'preBend' || b.type === 'graceNoteBend') {
      const count = b.start.chord.notes.filter((n) => A.bendFor(n.id)).length;
      if (count < b.end.chord.notes.length) return true;
    }
    return false;
  };
  /** `updateHoldLine` (tablature) : { startNoteId, endNoteId, endBend } ou null. */
  A.holdLine = (b) => cached('hold', b, () => {
    const dipVibrato = b.type === 'dip' && b.entry.dipVibrato;
    let can = Boolean(dipVibrato) || (!A.isFullRelease(b) && b.type !== 'scoop' && b.type !== 'dip');
    if (b.isDive) can = can && str(b.start.note) === A.upString(b.start.chord);
    if (!can) return null;
    const startOfHold = b.end.note;
    let endOfHold = startOfHold;
    const follow = A.following(b);
    if (follow) endOfHold = follow.start.note;
    if (endOfHold === startOfHold) {
      while (A.tieFor(endOfHold.id) && noteRec.get(A.tieFor(endOfHold.id).endNoteId)) endOfHold = noteRec.get(A.tieFor(endOfHold.id).endNoteId).note;
    }
    if (b.isDive) {
      let bf = A.bendFor(endOfHold.id);
      while (bf && !bf.isDive && !A.overlapping(bf) && bf.end.note !== endOfHold) { endOfHold = bf.end.note; bf = A.bendFor(endOfHold.id); }
    } else {
      let df = A.diveFor(endOfHold.id);
      while (df && !A.overlapping(df) && df.end.note !== endOfHold) { endOfHold = df.end.note; df = A.diveFor(endOfHold.id); }
    }
    const mode = b.entry.showHoldLine ?? 'auto';
    let needs = mode === 'auto' ? endOfHold !== startOfHold : mode === 'show';
    needs = needs || Boolean(dipVibrato);
    if (!needs) return null;
    return { startNote: startOfHold, endNote: endOfHold, endBend: follow };
  });

  // visibilité des notes (`layoutBendTabStaff` / `layoutDiveTabStaff`), dans l'ordre de mise en page
  const states = new Map(); // noteId → { hidden?, ghost? }
  const st = (n) => { if (!states.has(n.id)) states.set(n.id, {}); return states.get(n.id); };
  for (const b of list) {
    if (b.isDive) {
      if (b.type === 'dip' || b.type === 'scoop') continue;
      // un seul dive sur la tablature : depuis la note du haut
      if (str(b.start.note) !== A.upString(b.start.chord) || str(b.end.note) !== A.upString(b.end.chord)) continue;
      if (b.type === 'preDive') {
        const align = style('ALIGN_PRE_BEND_AND_PRE_DIVE_TO_GRACE_NOTE');
        for (const n of b.start.chord.notes) st(n).hidden = !align;
        for (const n of b.end.chord.notes) st(n).hidden = align;
      } else if (A.isFullReleaseDive(b)) {
        for (const n of b.end.chord.notes) { st(n).hidden = false; st(n).ghost = true; }
      } else {
        for (const n of b.end.chord.notes) st(n).hidden = true; // `!isFullReleaseDive() || !showFretOnFullBendRelease` : un dive non complet cache l'arrivée
      }
      continue;
    }
    if (A.isRelease(b)) st(b.end.note).ghost = true;
    if (b.type === 'preBend') st(b.start.note).ghost = true; // `layoutAngularBend` : la note de départ d'un pre-bend devient fantôme
    if (A.startOnEndNote(b)) {
      st(b.start.note).hidden = true;
      st(b.end.note).hidden = false;
    } else if (b.type !== 'slightBend' && (!style('SHOW_FRET_ON_FULL_BEND_RELEASE') || !A.isFullRelease(b))) {
      if (b.type === 'graceNoteBend' || b.type === 'preBend') st(b.start.note).hidden = false;
      st(b.end.note).hidden = true;
    }
  }
  A.noteStates = states;
  return A;
}
