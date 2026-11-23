/*
 * COLLER une charge `scorsaire-staff-list` (voir `clipboard.js`). Étape 5, « sélection de plage », livraison 4.
 * À APPELER DANS `doc.transaction` : rien n'est écrit hors d'une transaction, et une erreur (`EditError`) annule tout.
 *
 * Port de MuseScore 4.7.5 (lu : `Score::cmdPasteStaffList`, `Read460::pasteStaff`, `Score::pasteChordRest`, `Score::makeGap1` /
 * `makeGapVoice`, `deleteAnnotationsFromRange`, `deleteOrShortenOutSpannersFromRange`, `NotationInteraction::pasteSelection`) :
 *   - le collage ÉCRASE la zone [début, début + longueur[ de la destination, il n'insère pas ; la zone vient du DÉBUT de la sélection ;
 *   - un accord qui déborde de la mesure est coupé aux barres et lié (`pasteChordRest`) ; un accord qui dépasse la fin de la zone est
 *     raccourci ; un accord de la destination qui dépasse la zone est conservé en clone ; l'accord qui commençait avant est raccourci ;
 *   - destination dans un n-olet (hors son début) : refusé ; n-olet qui ne tient pas dans une mesure de la destination : refusé ;
 *   - au-delà de la dernière mesure, des mesures vides sont AJOUTÉES (`makeGapVoice` : « EOS reached » → `insertMeasure`) ;
 *   - les armures, chiffrages, barres, reprises et voltas ne sont jamais collés ; clés et respirations oui ;
 *   - les éléments de structure (tempos, points d'orgue, swings, sauts, marqueurs) sont posés à l'endroit du collage MÊME si la
 *     destination n'est pas la première portée (ils sont des éléments de système) ; DÉCISION de Jean (13/10/2026) : ceux de la zone sont
 *     REMPLACÉS (jamais de doublon), alors que MuseScore ajoute sans rien retirer.
 * Décisions de Jean (13/10/2026) : portées de destination insuffisantes ou de type différent → on colle les portées COMPATIBLES (même
 * type) et on signale les autres ; paroles = nouveau texte indépendant.
 *
 * Écarts / limites : un accord d'une AUTRE voix qui commence avant la zone et la traverse est raccourci par `placePieces` seulement pour
 * les voix présentes dans la charge ; les voix absentes de la charge ne sont pas touchées (MuseScore : `voiceOffset` par voix écrite) ;
 * une liaison dont un bout tombe sur un accord coupé par une barre de la destination s'accroche au 1er morceau (les ties, à la fin du
 * 1er / au début du dernier) ; transposition d'instrument sans objet (hauteurs de concert) ; non vérifié sur un export MuseScore.
 */
import { pasteLane } from './automation.js';
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { STAFF_TYPES, elementSchema, isApplicable } from './schema.js';
import { createElement } from './elements.js';
import { newId } from './ids.js';
import { createLyricText, createLyricLink, parseLyricsText } from './lyrics.js';
import { fAdd, fSub, fCmp, fEq, fLt, fMin, ZERO } from './fraction.js';
import { actualDuration } from './pitch.js';
import { durationValue } from './rhythmsplit.js';
import {
  EditError, durationPieces, placePieces, cloneChord, tieChords, measureTimeline,
} from './noteedit.js';
import { insertMeasures } from './measureedit.js';
import { clearRange } from './rangeedit.js';
import { contentLength, flatStaves } from './range.js';
import { isLinkedStaff, contentStaff } from './linkedstaff.js';

const isLabel = (v) => typeof v === 'string' && /^#\d+$/.test(v);
const isSequential = (staff) => STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.sequential !== false;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Champs d'identifiants des entrées de listes, avec leur règle d'accroche sur un accord coupé (premier / dernier morceau). */
const REF_FIELDS = ['startChordId', 'endChordId', 'startNoteId', 'endNoteId', 'itemId', 'afterId'];

/** Copie profonde d'une valeur de propriété : tout objet qui porte une étiquette `#n` comme `id` reçoit un identifiant neuf (même étiquette = même identifiant). */
function freshValue(value, idFor) {
  if (Array.isArray(value)) return value.map((v) => freshValue(v, idFor));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = k === 'id' && isLabel(v) ? idFor(v) : freshValue(v, idFor);
  return out;
}

/** Reconstruit un élément du modèle depuis sa copie JSON (identifiants neufs) ; `labels` reçoit étiquette → identifiant neuf. */
function rebuild(node, labels, { duration = null, tuplet = null, dropMarkings = false } = {}) {
  const idFor = (label) => { if (!labels.has(label)) labels.set(label, newId('e')); return labels.get(label); };
  const props = freshValue(node.props ?? {}, idFor);
  if (duration) props[PID.DURATION] = { base: duration.base, dots: duration.dots ?? 0 };
  if (tuplet) props[PID.TUPLET] = tuplet;
  const schema = elementSchema(node.type);
  const children = {};
  for (const key of Object.keys(schema.children)) {
    if (dropMarkings && key === 'graceNotes') continue;
    if (Array.isArray(node[key])) children[key] = node[key].map((c) => rebuild(c, labels, { dropMarkings }));
  }
  const el = createElement(node.type, { props, children });
  if (isLabel(node.id)) labels.set(node.id, el.id);
  return el;
}

function movementOfBar(doc, measureId) {
  const bar = doc.find(measureId);
  if (!bar || bar.type !== 'masterbar') throw new EditError('Destination introuvable');
  return doc.movementOf(bar);
}

/** Décalage (depuis le début du Mouvement) du début de chaque mesure. */
function offsets(mv) {
  const cum = [];
  let acc = ZERO;
  for (let mi = 0; mi < mv.masterbars.length; mi++) { cum.push(acc); acc = fAdd(acc, contentLength(mv, mi)); }
  return { cum, total: acc };
}

/** Mesure et position d'un instant absolu ; `end` = vrai pour une borne de fin (peut tomber sur la barre de fin de mesure). */
function makeLocator(mv) {
  const { cum, total } = offsets(mv);
  return (abs, end = false) => {
    for (let mi = 0; mi < cum.length; mi++) {
      const len = contentLength(mv, mi);
      const rel = fSub(abs, cum[mi]);
      if (fCmp(rel, ZERO) >= 0 && (fLt(rel, len) || (end && fEq(rel, len) && (fCmp(abs, total) === 0 || false)))) return { mi, measureId: mv.masterbars[mi].id, position: rel };
    }
    if (end && cum.length && fEq(abs, total)) {
      const mi = cum.length - 1;
      return { mi, measureId: mv.masterbars[mi].id, position: contentLength(mv, mi) };
    }
    return null;
  };
}

/** Vrai si la charge peut être collée (forme minimale). */
export function canPaste(payload) {
  return !!payload && Array.isArray(payload.staves) && payload.staves.length > 0;
}

/**
 * Colle `payload` à la destination `target`.
 * @param {object} target `{ staffId, measureId, position }` : début de la zone (portée du haut de la destination)
 * @returns {{ staffIds: string[], from: object, to: object, skipped: number[], addedMeasures: number }}
 *   la plage collée (toutes les portées de destination effectivement collées), les rangs des portées de la charge ignorées
 */
export function pasteClipboard(doc, payload, target) {
  if (!canPaste(payload)) throw new EditError('Presse-papiers vide ou illisible');
  const mv = movementOfBar(doc, target.measureId);
  const flat = flatStaves(mv).filter((s) => !isLinkedStaff(s)); // a linked staff holds no content: only the staves that do receive the paste
  const targetStaff = flatStaves(mv).find((s) => s.id === target.staffId);
  const targetId = targetStaff ? contentStaff(mv, targetStaff).id : target.staffId;
  const di = flat.findIndex((s) => s.id === targetId);
  if (di < 0) throw new EditError('Portée de destination introuvable');
  const startIndex = mv.masterbars.findIndex((b) => b.id === target.measureId);
  if (!fLt(target.position, contentLength(mv, startIndex))) throw new EditError('Position hors de la mesure');

  // 1) portées de destination : consécutives, de même type que la portée copiée
  const dest = payload.staves.map((p, k) => {
    const staff = flat[di + k];
    return staff && getProperty(staff, PID.STAFF_TYPE) === p.type ? staff : null;
  });
  const skipped = dest.map((s, k) => (s ? -1 : k)).filter((k) => k >= 0);
  if (!dest.some(Boolean)) {
    throw new EditError(`Aucune portée de destination compatible (type « ${payload.staves[0].type} » attendu)`);
  }

  // 2) place : des mesures vides sont ajoutées au besoin
  const A = fAdd(offsets(mv).cum[startIndex], target.position);
  const B = fAdd(A, payload.length);
  let added = 0;
  while (fLt(offsets(mv).total, B)) {
    insertMeasures(doc, mv, { at: mv.masterbars.length, count: 1, moveSignatures: false });
    added++;
    if (added > 10000) throw new EditError('Collage trop long');
  }
  const locate = makeLocator(mv);
  const { cum } = offsets(mv);

  // 3) destination dans un n-olet : refusée (MuseScore `DEST_TUPLET`)
  const here = locate(A);
  for (const staff of dest.filter(Boolean)) {
    if (!isSequential(staff)) continue;
    for (const voice of staff.voices ?? []) {
      const timeline = measureTimeline(voice.measures[here.mi], contentLength(mv, here.mi));
      const unit = timeline.find((u) => !fLt(here.position, u.start) && fLt(here.position, u.end));
      const t = unit && isApplicable(unit.item.type, PID.TUPLET) ? getProperty(unit.item, PID.TUPLET) : null;
      if (t) {
        const first = timeline.find((u) => isApplicable(u.item.type, PID.TUPLET) && getProperty(u.item, PID.TUPLET)?.id === t.id);
        if (!fEq(first.start, here.position)) throw new EditError("Collage à l'intérieur d'un n-olet");
      }
    }
  }

  const labels = new Map(); // étiquette → identifiant neuf (accords, notes, entrées)
  const lastNote = new Map(); // étiquette de note → identifiant de la note du DERNIER morceau (ties sortants)
  const pasted = [];

  dest.forEach((staff, k) => {
    if (!staff) return;
    const sp = payload.staves[k];
    if (isSequential(staff)) pasteSequential(doc, mv, staff, sp, { A, B, cum, locate, labels, lastNote });
    else pasteChordStaff(doc, mv, staff, sp, { A, B, locate });
    pasteLists(doc, mv, staff, sp, { A, B, locate, labels, lastNote });
    pasted.push(staff.id);
  });
  pasteLyrics(doc, dest, payload, labels);
  if (payload.system) pasteSystem(doc, mv, payload.system, dest, { A, B, locate, cum });

  const to = locate(B, true);
  return { staffIds: pasted, from: { measureId: here.measureId, position: here.position }, to: { measureId: to.measureId, position: to.position }, skipped, addedMeasures: added };
}

/** Colle le contenu d'une portée à contenu séquentiel, voix par voix, mesure par mesure. */
function pasteSequential(doc, mv, staff, sp, { A, B, cum, locate, labels, lastNote }) {
  const voices = new Set([0, ...sp.items.map((i) => i.voice)]);
  const first = locate(A);
  const last = locate(B, true);
  for (const voice of [...voices].sort((a, b) => a - b)) {
    // éléments de la charge pour cette voix, découpés aux barres de la destination
    const perMeasure = new Map(); // mi → [{ el, start, end }]
    const push = (mi, piece) => { if (!perMeasure.has(mi)) perMeasure.set(mi, []); perMeasure.get(mi).push(piece); };
    const items = sp.items.filter((i) => i.voice === voice).sort((a, b) => fCmp(a.at, b.at));
    // n-olets : un groupe garde ses membres tels quels (jamais coupés)
    const tupletLabel = (node) => node.props?.[PID.TUPLET]?.id ?? null;
    const tupletMap = new Map(); // étiquette de n-olet → identifiant neuf (par collage)
    for (const { at, item } of items) {
      const absStart = fAdd(A, at);
      const len0 = node0Length(item);
      if (len0 === null) continue; // silence automatique / silence de mesure : recalculé à la destination
      let end = fAdd(absStart, len0);
      if (fLt(B, end)) end = B; // le dernier élément est raccourci à la zone
      if (!fLt(absStart, end)) continue;
      const tl = tupletLabel(item);
      const loc = locate(absStart);
      if (!loc) continue;
      const room = fSub(contentLength(mv, loc.mi), loc.position);
      if (tl) {
        if (fLt(room, fSub(end, absStart)) || !fEq(fSub(end, absStart), len0)) throw new EditError('Un n-olet ne tient pas dans la mesure de destination');
        if (!tupletMap.has(tl)) tupletMap.set(tl, newId('tu'));
        const el = rebuild(item, labels, { tuplet: { ...item.props[PID.TUPLET], id: tupletMap.get(tl) } });
        push(loc.mi, { el, start: loc.position, end: fAdd(loc.position, len0) });
        continue;
      }
      // coupé aux barres de la destination
      let remaining = fSub(end, absStart);
      let mi = loc.mi;
      let pos = loc.position;
      let previous = null;
      let sourceChord = null;
      while (fLt(ZERO, remaining)) {
        if (mi >= mv.masterbars.length) break;
        const piece = fMin(remaining, fSub(contentLength(mv, mi), pos));
        const list = durationPieces(doc, staff, voice, mi, pos, piece, { isRest: item.type === 'rest' });
        let t = pos;
        for (const d of list) {
          const e = fAdd(t, durationOf(d));
          let el;
          if (!previous) {
            el = rebuild(item, labels, { duration: d });
            sourceChord = el;
          } else if (item.type === 'chord') {
            el = cloneChord(sourceChord, d);
          } else el = rebuild(item, new Map(), { duration: d });
          push(mi, { el, start: t, end: e, link: previous });
          previous = el;
          t = e;
        }
        remaining = fSub(remaining, piece);
        mi += 1;
        pos = ZERO;
      }
      if (item.type === 'chord' && previous && previous !== sourceChord) {
        // note du dernier morceau, pour les ties qui PARTENT de cet accord
        item.notes.forEach((n, i) => { if (previous.notes[i]) lastNote.set(n.id, previous.notes[i].id); });
      }
    }
    // pose mesure par mesure, zone entière (même sans élément : la zone est vidée)
    for (let mi = first.mi; mi <= last.mi; mi++) {
      const zs = mi === first.mi ? first.position : ZERO;
      const ze = mi === last.mi ? last.position : contentLength(mv, mi);
      if (!fLt(zs, ze)) continue;
      const pieces = (perMeasure.get(mi) ?? []).sort((a, b) => fCmp(a.start, b.start));
      if (!pieces.length && voice > 0) {
        // voix absente de la charge à cet endroit : rien à vider si la voix n'a rien là
        if (!(staff.voices[voice]?.measures[mi]?.items.length)) continue;
      }
      placePieces(doc, { staff, voice, measure: mi, start: zs, end: ze, pieces });
      // liaisons de prolongation entre morceaux d'un même élément coupé
      for (const p of pieces) if (p.link && p.link.type === 'chord' && p.el.type === 'chord') tieChords(doc, staff, p.link, p.el);
    }
  }
}

const durationOf = durationValue;

/** Durée réelle d'un élément copié, ou null s'il doit être recalculé (silence automatique, silence de mesure). */
function node0Length(item) {
  const duration = item.props?.[PID.DURATION];
  if (!duration) return null;
  if (item.type === 'rest') {
    const explicit = item.props?.[PID.EXPLICIT] === true;
    const gap = item.props?.[PID.GAP] === true;
    const tuplet = !!item.props?.[PID.TUPLET];
    if (!explicit && !gap && !tuplet) return null;
  }
  if (duration.base === 'measure') return null;
  return actualDuration(duration, item.props?.[PID.TUPLET] ?? null);
}

/** Portée d'accords : symboles à leur position relative. */
function pasteChordStaff(doc, mv, staff, sp, { A, B, locate }) {
  const from = locate(A);
  const to = locate(B, true);
  clearRange(doc, { staffIds: [staff.id], from: { measureId: from.measureId, position: from.position }, to: { measureId: to.measureId, position: to.position } });
  for (const { voice, at, item } of sp.items) {
    const loc = locate(fAdd(A, at));
    if (!loc) continue;
    while ((staff.voices ?? []).length <= voice) break;
    const v = staff.voices?.[voice];
    if (!v) continue;
    const measure = v.measures[loc.mi];
    const props = { ...(item.props ?? {}), [PID.POSITION]: loc.position };
    const el = createElement(item.type, { props: freshValue(props, () => newId('e')) });
    let index = measure.items.findIndex((s) => s.type === el.type && fLt(loc.position, getProperty(s, PID.POSITION)));
    if (index < 0) index = measure.items.length;
    doc.add(measure, 'items', el, index);
  }
}

/** Listes de la portée (traits, respirations, capos…), pédales et changements de clé. */
function pasteLists(doc, mv, staff, sp, { A, B, locate, labels, lastNote }) {
  for (const [key, entries] of Object.entries(sp.lists ?? {})) {
    if (key === PID.PEDALS || key === PID.CLEF_CHANGES || key === PID.STAFF_TEXTS || key === PID.AUTOMATION) continue;
    const add = [];
    for (const entry of entries) {
      const next = clone(entry);
      let ok = true;
      for (const f of REF_FIELDS) {
        if (next[f] === undefined) continue;
        let id = f === 'startNoteId' && key === PID.TIES ? (lastNote.get(entry[f]) ?? labels.get(entry[f])) : labels.get(entry[f]);
        if (!id) { ok = false; break; }
        next[f] = id;
      }
      if (!ok) continue;
      next.id = newId(String(entry.id).replace(/[0-9#]+$/, '') || 'e');
      add.push(next);
    }
    if (add.length) doc.set(staff, key, [...(getProperty(staff, key) ?? []), ...add]);
  }
  // pédales : instants absolus → mesure + position
  const pedals = sp.lists?.[PID.PEDALS] ?? [];
  if (pedals.length) {
    const add = [];
    for (const p of pedals) {
      const a = locate(fAdd(A, p.at));
      const b = locate(fAdd(A, p.endAt), true);
      if (!a || !b) continue;
      const { at, endAt, ...rest } = p;
      void at; void endAt;
      add.push({ ...rest, id: newId('pd'), startMeasureId: a.measureId, startPosition: a.position, endMeasureId: b.measureId, endPosition: b.position });
    }
    if (add.length) doc.set(staff, PID.PEDALS, [...(getProperty(staff, PID.PEDALS) ?? []), ...add]);
  }
  // mixer automation: the lanes of the copied measures replace those of the zone [A, B[ on the track of this staff
  for (const lane of sp.lists?.[PID.AUTOMATION] ?? []) {
    const track = doc.parentOf(staff.id);
    if (track) pasteLane(doc, mv, track, { param: lane.param, from: A, to: B, points: lane.points.map((p) => ({ abs: fAdd(A, p.at), value: p.value, ramp: p.ramp })) });
  }
  // textes de portée : ceux de la zone [A, B[ sont remplacés (comme MuseScore efface les annotations de la zone)
  const texts = sp.lists?.[PID.STAFF_TEXTS] ?? [];
  if (texts.length) {
    const wanted = texts.map((t) => ({ t, loc: locate(fAdd(A, t.at)) })).filter((x) => x.loc);
    const { cum } = offsets(mv);
    const inZone = (e) => { const mi = mv.masterbars.findIndex((m) => m.id === e.measureId); if (mi < 0) return false; const a = fAdd(cum[mi], e.position); return fCmp(a, A) >= 0 && fCmp(a, B) < 0; };
    const kept = (getProperty(staff, PID.STAFF_TEXTS) ?? []).filter((e) => !inZone(e));
    const add = wanted.map(({ t, loc }) => {
      const { at, ...rest } = t; void at;
      return { ...rest, id: newId('st'), measureId: loc.measureId, position: loc.position };
    });
    doc.set(staff, PID.STAFF_TEXTS, [...kept, ...add]);
  }
  // changements de clé : celui du même instant est remplacé
  const clefs = sp.lists?.[PID.CLEF_CHANGES] ?? [];
  if (clefs.length) {
    const wanted = clefs.map((c) => ({ c, loc: locate(fAdd(A, c.at)) })).filter((x) => x.loc);
    const same = (e, loc) => e.measureId === loc.measureId && fEq(e.position, loc.position);
    const kept = (getProperty(staff, PID.CLEF_CHANGES) ?? []).filter((e) => !wanted.some((w) => same(e, w.loc)));
    doc.set(staff, PID.CLEF_CHANGES, [...kept, ...wanted.map((w) => ({ id: newId('cc'), measureId: w.loc.measureId, position: w.loc.position, clef: w.c.clef }))]);
  }
}

/** Paroles : un NOUVEAU texte indépendant par couplet copié, relié aux accords collés. */
function pasteLyrics(doc, dest, payload, labels) {
  dest.forEach((staff, k) => {
    if (!staff) return;
    for (const lyric of payload.staves[k].lyrics ?? []) {
      const links = lyric.links.filter((l) => labels.has(l.chordId));
      if (!links.length) continue;
      let text = '';
      for (const s of lyric.syllables) text += s.text + (s.syllabic === 'begin' || s.syllabic === 'middle' ? '-' : ' ');
      text = text.trim();
      const parsed = parseLyricsText(text);
      // un seul texte par couplet dans l'œuvre : s'il existe déjà, les syllabes copiées sont AJOUTÉES à sa suite (les liens de cette
      // portée les désignent par leur rang) ; sinon un nouveau texte est créé
      const work = doc.work;
      const texts = getProperty(work, PID.LYRIC_TEXTS) ?? [];
      const existing = texts.find((t) => t.verse === lyric.verse);
      let textId;
      let offset = 0;
      if (existing) {
        offset = parseLyricsText(existing.text).length;
        textId = existing.id;
        doc.set(work, PID.LYRIC_TEXTS, texts.map((t) => (t === existing ? { ...t, text: `${t.text.trimEnd()} ${text}` } : t)));
      } else {
        const created = createLyricText(lyric.verse, text, { placement: lyric.placement });
        textId = created.id;
        doc.set(work, PID.LYRIC_TEXTS, [...texts, created]);
      }
      const add = links.filter((l) => parsed[l.syllable]).map((l) => createLyricLink(textId, offset + l.syllable, labels.get(l.chordId), {
        endChordId: l.endChordId && labels.has(l.endChordId) ? labels.get(l.endChordId) : undefined,
      }));
      if (add.length) doc.set(staff, PID.LYRIC_LINKS, [...(getProperty(staff, PID.LYRIC_LINKS) ?? []), ...add]);
    }
  });
}

/** Éléments de structure : ceux de la zone sont remplacés. */
function pasteSystem(doc, mv, system, dest, { A, B, locate, cum }) {
  const absOf = (el) => {
    const mi = mv.masterbars.findIndex((b) => b.id === getProperty(el, PID.MEASURE_ID));
    return mi < 0 ? null : fAdd(cum[mi], getProperty(el, PID.POSITION) ?? ZERO);
  };
  const inZone = (a) => a !== null && fCmp(a, A) >= 0 && fLt(a, B);
  const make = (item, loc, extra = {}) => {
    const props = { ...(item.props ?? {}), [PID.MEASURE_ID]: loc.measureId, ...extra };
    if (isApplicable(item.type, PID.POSITION)) props[PID.POSITION] = loc.position;
    return createElement(item.type, { props: freshValue(props, () => newId('e')) });
  };
  for (const key of ['tempos', 'fermatas', 'swings']) {
    const list = system[key];
    if (!list?.length) continue;
    for (const el of [...(mv[key] ?? [])]) if (inZone(absOf(el))) doc.remove(el);
    for (const { at, item, staff } of list) {
      const loc = locate(fAdd(A, at));
      if (!loc) continue;
      let extra = {};
      if (staff !== undefined) {
        const target = dest[staff];
        if (!target) continue;
        extra = { [PID.TARGET_STAFF_ID]: target.id };
      }
      doc.add(mv, key, make(item, loc, extra));
    }
  }
  if (system.tempoChanges?.length) {
    for (const el of [...(mv.tempoChanges ?? [])]) if (inZone(absOf(el))) doc.remove(el);
    for (const { at, endAt, item } of system.tempoChanges) {
      const a = locate(fAdd(A, at));
      const b = locate(fAdd(A, endAt), true);
      if (!a || !b) continue;
      doc.add(mv, 'tempoChanges', make(item, a, { [PID.END_MEASURE_ID]: b.measureId, [PID.END_POSITION]: b.position }));
    }
  }
  for (const key of ['jumps', 'markers', 'rehearsalMarks', 'cues', 'systemContainers']) {
    const list = system[key];
    if (!list?.length) continue;
    const zoneMeasures = new Set();
    for (let mi = 0; mi < mv.masterbars.length; mi++) {
      const s = cum[mi];
      if (fCmp(s, A) >= 0 && fCmp(fAdd(s, contentLength(mv, mi)), B) <= 0) zoneMeasures.add(mv.masterbars[mi].id);
    }
    for (const el of [...(mv[key] ?? [])]) if (zoneMeasures.has(getProperty(el, PID.MEASURE_ID)) && (key !== 'systemContainers' || getProperty(el, PID.CONTAINER_KIND) === 'section')) doc.remove(el);
    for (const { at, item } of list) {
      const loc = locate(fAdd(A, at));
      if (!loc) continue;
      const props = { ...(item.props ?? {}), [PID.MEASURE_ID]: loc.measureId };
      if (key === 'cues' && props[PID.CUE_TRACK] && !mv.tracks.some((t) => t.id === props[PID.CUE_TRACK])) delete props[PID.CUE_TRACK]; // a cue for a track of another movement is for every drum player here
      doc.add(mv, key, createElement(item.type, { props: freshValue(props, () => newId('e')) }));
    }
  }
}
