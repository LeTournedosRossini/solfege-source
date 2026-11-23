/*
 * Presse-papiers de plage — COPIE seulement (PURE, lecture seule du modèle). Étape 5, « sélection de plage », livraison 3.
 * (Couper / coller : livraison 4.)
 *
 * Reprend `Selection::staffMimeData` / `Score::cmdPaste` de MuseScore 4.7.5 (lus : select.cpp, paste.cpp, read460.cpp, twrite.cpp
 * `writeSegments`, connectorinfowriter.cpp) :
 *   - le contenu d'une plage est copié PAR PORTÉE, voix par voix ; les éléments qui COMMENCENT dans la plage sont copiés en entier ;
 *   - un trait (liaison, tie, soufflet, trille, hopo, bend, glissando, ligne de technique, pédale, trémolo à deux notes) n'est copié que si
 *     SES DEUX BOUTS sont dans la plage (`ConnectorInfo::finished`) ; un tie dont la fin sort de la plage n'est pas copié ;
 *   - clés (changements) et respirations sont copiées ; armures, chiffrages, barres de mesure, reprises et voltas ne le sont JAMAIS ;
 *   - les éléments de SYSTÈME (tempos, points d'orgue, swings, sauts, marqueurs) ne sont écrits que pour la première portée du Mouvement :
 *     ils sont copiés seulement si la plage contient cette portée ;
 *   - un n-olet ou un trémolo coupé par la plage est déjà étendu au groupe entier par `normalizeRange` (décision de Jean, écart voulu).
 * Paroles (décision de Jean) : les syllabes copiées forment un NOUVEAU texte indépendant (un couplet), relié aux accords collés.
 *
 * Format JSON (« scorsaire-staff-list ») : positions = fractions exactes depuis le DÉBUT DE LA PLAGE ; tous les identifiants (éléments,
 * entrées de listes, n-olets) sont remplacés par des étiquettes locales « #0, #1… » (les références suivent) : au collage, de NOUVEAUX
 * identifiants sont créés. Rien ici n'écrit dans le document.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { STAFF_TYPES } from './schema.js';
import { fAdd, fSub, fCmp, fEq, isFraction, ZERO } from './fraction.js';
import { EditError } from './noteedit.js';
import { isRunEntry } from './glissando.js';
import { resolveStaves, rangeMeasureSpan, rangeItems, contentLength, flatStaves } from './range.js';
import { parseLyricsText, SYLLABIC } from './lyrics.js';
import { FILE_VERSION } from './serialize.js';
import { createRest } from './elements.js';
import {
  canVoice, canCategory, splitChordNotes, containsMultiNoteChords, articulationCategory, LIST_CATEGORY, CHORD_MARK_CATEGORY, isDefaultFilter,
} from './selectionfilter.js';

export const CLIPBOARD_FORMAT = 'scorsaire-staff-list';
export const CLIPBOARD_VERSION = 1;

const isSequential = (staff) => STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.sequential !== false;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Listes de la portée copiées avec leurs références : [pid, champs d'identifiants — tous doivent être dans la copie]. */
const CHORD_REF_LISTS = [
  [PID.HAIRPINS, ['startChordId', 'endChordId']], [PID.TRILLS, ['startChordId', 'endChordId']], [PID.SLURS, ['startChordId', 'endChordId']],
  [PID.HOPOS, ['startChordId', 'endChordId']], [PID.TECH_LINES, ['startChordId', 'endChordId']], [PID.TREMOLOS, ['startChordId', 'endChordId']],
  [PID.TIES, ['startNoteId', 'endNoteId']], [PID.GLISSANDOS, ['startNoteId', 'endNoteId']], [PID.BENDS, ['startNoteId', 'endNoteId']], [PID.WHEELS, ['startNoteId', 'endNoteId']],
  [PID.BREATHS, ['afterId']], [PID.CAPOS, ['itemId']], [PID.STRING_TUNINGS, ['itemId']],
];

/** Étiquettes locales : id → « #n » (même id = même étiquette). */
function makeLabeler() {
  const map = new Map();
  const label = (id) => { if (!map.has(id)) map.set(id, `#${map.size}`); return map.get(id); };
  /** Remplace récursivement tout champ `id` d'un arbre déjà cloné. */
  const relabelTree = (node) => {
    if (Array.isArray(node)) { node.forEach(relabelTree); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string') node.id = label(node.id);
    for (const v of Object.values(node)) relabelTree(v);
  };
  return { map, label, relabelTree };
}

function movementOf(doc, range) {
  const bar = doc.find(range?.from?.measureId);
  if (!bar || bar.type !== 'masterbar') throw new EditError('Plage introuvable');
  return doc.movementOf(bar);
}


/**
 * Copie filtrée d'un accord ou d'un silence (voir `copyRange`). Les silences passent tels quels. Un accord garde les notes admises ;
 * sans note admise c'est un silence posé de même durée et même n-olet (MuseScore : « silence factice »).
 */
function filterItem(src, filter, hasMulti, runStarts = null) {
  if (src.type !== 'chord') return clone(src);
  const { kept, dropped } = splitChordNotes(filter, src, hasMulti);
  if (!kept.length) {
    const rest = clone(createRest({ duration: getProperty(src, PID.DURATION).base, dots: getProperty(src, PID.DURATION).dots ?? 0, explicit: true }));
    const tuplet = getProperty(src, PID.TUPLET);
    if (tuplet) rest.props[PID.TUPLET] = clone(tuplet);
    return rest;
  }
  const item = clone(src);
  const drop = new Set(dropped.map((n) => n.id));
  item.notes = item.notes.filter((n) => !drop.has(n.id));
  if (!canCategory(filter, 'fingering')) for (const n of item.notes) if (n.props) delete n.props[PID.FINGERINGS];
  for (const [pid, category] of CHORD_MARK_CATEGORY) if (!canCategory(filter, category)) delete item.props[pid];
  if (Array.isArray(item.props[PID.ARTICULATIONS])) {
    item.props[PID.ARTICULATIONS] = item.props[PID.ARTICULATIONS].filter((a) => canCategory(filter, articulationCategory(a.type)));
    if (!item.props[PID.ARTICULATIONS].length) delete item.props[PID.ARTICULATIONS];
  }
  if (!canCategory(filter, 'graceNote')) item.graceNotes = [];
  // the start of an organ glissando run is a grace note: without its glissando entry it would become an ordinary ornament
  else if (runStarts?.size && item.graceNotes?.length) item.graceNotes = item.graceNotes.filter((g) => !g.notes?.some((n) => runStarts.has(n.id)));
  return item;
}

/** Peut-on copier cette plage ? (plage valable, au moins un élément ou une portée d'accords non vide). */
export function canCopyRange(doc, range) {
  try { return !!movementOf(doc, range) && !!rangeMeasureSpan(movementOf(doc, range), range); } catch { return false; }
}

/**
 * Copie une plage : renvoie la charge JSON (objet pur). Ne modifie rien.
 * `filter` (facultatif, voir selectionfilter.js) : comme `Selection::staffMimeData` de MuseScore — une voix exclue n'est pas écrite ; un
 * accord dont toutes les notes sont exclues devient un silence de même durée et même n-olet ; une catégorie exclue n'est pas écrite
 * (marques d'accord, traits entiers, paroles, symboles d'accord, éléments de système).
 * @returns {{ format, version, fileVersion, length: [n,d], measures: number, staves: object[], system?: object }}
 */
export function copyRange(doc, range, filter = null) {
  const filtered = !isDefaultFilter(filter);
  const cat = (c) => !filtered || canCategory(filter, c);
  const mv = movementOf(doc, range);
  const span = rangeMeasureSpan(mv, range);
  const staves = resolveStaves(mv, range.staffIds);
  if (!span || !staves) throw new EditError('Plage introuvable');
  // décalage (depuis le début du Mouvement) du début de chaque mesure
  const cum = [];
  let acc = ZERO;
  for (let mi = 0; mi < mv.masterbars.length; mi++) { cum.push(acc); acc = fAdd(acc, contentLength(mv, mi)); }
  const indexOfBar = (id) => mv.masterbars.findIndex((b) => b.id === id);
  const abs = (mi, pos) => fAdd(cum[mi], pos);
  const absFrom = abs(span.first, range.from.position);
  const absTo = abs(indexOfBar(range.to.measureId), range.to.position);
  const rel = (mi, pos) => fSub(abs(mi, pos), absFrom);
  const insideStart = (a) => fCmp(a, absFrom) >= 0 && fCmp(a, absTo) < 0;
  const { map, label, relabelTree } = makeLabeler();

  // 1) contenu des portées (étiquettes attribuées dans l'ordre : portée, voix, temps)
  const staffPayloads = staves.map((staff) => {
    const items = [];
    if (isSequential(staff)) {
      const entries = rangeItems(mv, { ...range, staffIds: [staff.id] });
      // grace notes that start a glissando run (entries with a run length / step length), when the glissando category is NOT copied
      const runStarts = filtered && !cat('glissando') ? new Set((getProperty(staff, PID.GLISSANDOS) ?? []).filter((g) => g.runDuration !== undefined || g.stepDuration !== undefined).map((g) => g.startNoteId).filter(Boolean)) : null;
      const hasMulti = filtered && containsMultiNoteChords(entries.filter((e) => e.item.type === 'chord').map((e) => e.item));
      for (const e of entries) {
        if (filtered && !canVoice(filter, e.voiceIndex)) continue;
        const item = filtered ? filterItem(e.item, filter, hasMulti, runStarts) : clone(e.item);
        relabelTree(item);
        items.push({ voice: e.voiceIndex, at: rel(e.mi, e.start), item });
      }
    } else {
      (staff.voices ?? []).forEach((voice, voiceIndex) => {
        for (let mi = span.first; mi <= indexOfBar(range.to.measureId); mi++) {
          for (const it of voice.measures?.[mi]?.items ?? []) {
            if (it.type !== 'chordsymbol' && it.type !== 'lyricevent') continue; // the symbols of a chord staff, the syllables of a lyrics staff
            if (filtered && (!canVoice(filter, voiceIndex) || !cat(it.type === 'lyricevent' ? 'lyrics' : 'chordSymbol'))) continue;
            const a = abs(mi, getProperty(it, PID.POSITION));
            if (!insideStart(a)) continue;
            const item = clone(it);
            delete item.props[PID.POSITION];
            if (it.type === 'lyricevent') delete item.props[PID.LYRIC_TARGET]; // the chord it was linked to stays where it is: the copy is not linked
            relabelTree(item);
            items.push({ voice: voiceIndex, at: fSub(a, absFrom), item });
          }
        }
      });
    }
    return { type: getProperty(staff, PID.STAFF_TYPE), items, lists: {}, lyrics: [] };
  });

  // 2) traits et listes ancrées (seulement si tous leurs bouts sont dans la copie)
  staves.forEach((staff, k) => {
    const out = staffPayloads[k].lists;
    for (const [pid, fields] of CHORD_REF_LISTS) {
      if (!cat(LIST_CATEGORY[pid])) continue;
      const kept = [];
      for (const entry of getProperty(staff, pid) ?? []) {
        // a glissando run has no start note (it hangs on its arrival note only)
        if (!fields.every((f) => (entry[f] === undefined && isRunEntry(entry) && f === 'startNoteId') || map.has(entry[f]))) continue;
        const copy = clone(entry);
        for (const f of fields) if (entry[f] !== undefined) copy[f] = map.get(entry[f]);
        copy.id = label(entry.id);
        kept.push(copy);
      }
      if (kept.length) out[pid] = kept;
    }
    // pédales : début ET fin dans la plage (fin incluse : la plage est [début, fin[)
    const pedals = [];
    for (const p of cat('pedal') ? getProperty(staff, PID.PEDALS) ?? [] : []) {
      const si = indexOfBar(p.startMeasureId), ei = indexOfBar(p.endMeasureId);
      if (si < 0 || ei < 0) continue;
      const a = abs(si, p.startPosition), b = abs(ei, p.endPosition);
      if (!insideStart(a) || fCmp(b, absTo) > 0) continue;
      const copy = clone(p);
      for (const f of ['startMeasureId', 'startPosition', 'endMeasureId', 'endPosition']) delete copy[f];
      copy.at = fSub(a, absFrom); copy.endAt = fSub(b, absFrom); copy.id = label(p.id);
      pedals.push(copy);
    }
    if (pedals.length) out[PID.PEDALS] = pedals;
    // changements de clé : instant dans la plage
    const clefs = [];
    for (const c of getProperty(staff, PID.CLEF_CHANGES) ?? []) {
      const mi = indexOfBar(c.measureId);
      if (mi < 0) continue;
      const a = abs(mi, c.position);
      if (!insideStart(a)) continue;
      clefs.push({ id: label(c.id), at: fSub(a, absFrom), clef: c.clef });
    }
    if (clefs.length) out[PID.CLEF_CHANGES] = clefs;
    // textes de portée : instant dans la plage (copiés comme les changements de clé, par instant relatif)
    const staffTexts = [];
    for (const t of cat('staffText') ? getProperty(staff, PID.STAFF_TEXTS) ?? [] : []) {
      const mi = indexOfBar(t.measureId);
      if (mi < 0) continue;
      const a = abs(mi, t.position);
      if (!insideStart(a)) continue;
      const copy = clone(t);
      delete copy.measureId; delete copy.position;
      copy.id = label(t.id); copy.at = fSub(a, absFrom);
      staffTexts.push(copy);
    }
    if (staffTexts.length) out[PID.STAFF_TEXTS] = staffTexts;
    // mixer automation of the track, carried by the first staff of the track in the range: the points inside the range, by instant relative to its start
    {
      const track = doc.parentOf(staff.id);
      if (track && staves.findIndex((s) => doc.parentOf(s.id) === track) === k) {
        const lanes = [];
        for (const lane of getProperty(track, PID.AUTOMATION) ?? []) {
          const points = [];
          for (const p of lane.points) {
            const mi = indexOfBar(p.measureId);
            if (mi < 0) continue;
            const a = abs(mi, p.position);
            if (insideStart(a)) points.push({ at: fSub(a, absFrom), value: p.value, ramp: p.ramp });
          }
          if (points.length) lanes.push({ param: lane.param, points });
        }
        if (lanes.length) out[PID.AUTOMATION] = lanes;
      }
    }
    // paroles : un texte indépendant par couplet copié
    const texts = new Map((doc.work ? getProperty(doc.work, PID.LYRIC_TEXTS) : null)?.map((t) => [t.id, t]) ?? []);
    const byText = new Map();
    for (const link of cat('lyrics') ? getProperty(staff, PID.LYRIC_LINKS) ?? [] : []) {
      if (!map.has(link.chordId) || !texts.has(link.textId)) continue;
      if (!byText.has(link.textId)) byText.set(link.textId, []);
      byText.get(link.textId).push(link);
    }
    for (const [textId, links] of byText) {
      const text = texts.get(textId);
      const syllables = parseLyricsText(text.text);
      const used = [...new Set(links.map((l) => l.index))].filter((i) => syllables[i]).sort((a, b) => a - b);
      const lyric = {
        verse: text.verse,
        syllables: used.map((i) => ({ text: syllables[i].text, syllabic: syllables[i].syllabic })),
        links: links.filter((l) => syllables[l.index]).map((l) => ({
          syllable: used.indexOf(l.index), chordId: map.get(l.chordId),
          ...(l.endChordId && map.has(l.endChordId) ? { endChordId: map.get(l.endChordId) } : {}),
        })),
      };
      if (text.placement) lyric.placement = text.placement;
      staffPayloads[k].lyrics.push(lyric);
    }
  });

  // 3) système (MuseScore : écrit pour la première portée seulement)
  const payload = {
    format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, fileVersion: FILE_VERSION,
    length: fSub(absTo, absFrom), measures: indexOfBar(range.to.measureId) - span.first + 1, staves: staffPayloads,
  };
  // découpage lisible de la longueur : mesures entières depuis le début de la plage + reste (en temps du chiffrage)
  {
    let whole = 0;
    let at = absFrom;
    const startsOnBar = fEq(range.from.position, ZERO);
    for (let mi = span.first; startsOnBar && mi < mv.masterbars.length; mi++) {
      const end = fAdd(cum[mi], contentLength(mv, mi));
      if (fCmp(end, absTo) > 0) break;
      whole++; at = end;
    }
    const extra = fSub(absTo, at);
    let extraBeats = null;
    if (!fEq(extra, ZERO)) {
      const mi = Math.min(span.first + whole, mv.masterbars.length - 1);
      const den = getProperty(mv.masterbars[mi], PID.TIME_SIG)?.[1] ?? 4;
      const n = extra[0] * den / extra[1];
      if (Number.isInteger(n)) extraBeats = n;
    }
    payload.span = { whole, extra, extraBeats };
  }
  const first = flatStaves(mv)[0];
  if (first && range.staffIds.includes(first.id) && cat('system')) {
    const system = {};
    const atOf = (el) => { const mi = indexOfBar(getProperty(el, PID.MEASURE_ID)); return mi < 0 ? null : abs(mi, getProperty(el, PID.POSITION) ?? ZERO); };
    const strip = (el, extra = []) => {
      const copy = clone(el);
      for (const pid of [PID.MEASURE_ID, PID.POSITION, ...extra]) delete copy.props[pid];
      relabelTree(copy);
      return copy;
    };
    const timedKinds = [['tempos', 'tempos'], ['fermatas', 'fermatas'], ['swings', 'swings']];
    for (const [key, listKey] of timedKinds) {
      const list = [];
      for (const el of mv[listKey] ?? []) {
        const a = atOf(el);
        if (a === null || !insideStart(a)) continue;
        const staffId = key === "swings" ? getProperty(el, PID.TARGET_STAFF_ID) : null;
        if (staffId) { // swing d'une portée : gardé si la portée est dans la plage (rang relatif)
          const k = staves.findIndex((s) => s.id === staffId);
          if (k < 0) continue;
          const copy = strip(el, [PID.TARGET_STAFF_ID]);
          list.push({ at: fSub(a, absFrom), staff: k, item: copy });
        } else list.push({ at: fSub(a, absFrom), item: strip(el) });
      }
      if (list.length) system[key] = list;
    }
    const changes = [];
    for (const el of mv.tempoChanges ?? []) {
      const a = atOf(el);
      const ei = indexOfBar(getProperty(el, PID.END_MEASURE_ID));
      if (a === null || ei < 0 || !insideStart(a)) continue;
      const b = abs(ei, getProperty(el, PID.END_POSITION) ?? ZERO);
      if (fCmp(b, absTo) > 0) continue;
      changes.push({ at: fSub(a, absFrom), endAt: fSub(b, absFrom), item: strip(el, [PID.END_MEASURE_ID, PID.END_POSITION]) });
    }
    if (changes.length) system.tempoChanges = changes;
    // sauts et marqueurs (ancrés à une mesure) : copiés si la mesure est ENTIÈREMENT dans la plage
    // (the sections of the form — intro, verse, chorus… — are system containers of kind 'section': same rule, they begin at a measure)
    for (const key of ['jumps', 'markers', 'rehearsalMarks', 'cues', 'systemContainers']) {
      const list = [];
      for (const el of mv[key] ?? []) {
        if (key === 'systemContainers' && getProperty(el, PID.CONTAINER_KIND) !== 'section') continue;
        const mi = indexOfBar(getProperty(el, PID.MEASURE_ID));
        if (mi < 0) continue;
        if (fCmp(cum[mi], absFrom) < 0 || fCmp(abs(mi, contentLength(mv, mi)), absTo) > 0) continue;
        const copy = clone(el);
        delete copy.props[PID.MEASURE_ID];
        relabelTree(copy);
        list.push({ at: fSub(cum[mi], absFrom), item: copy });
      }
      if (list.length) system[key] = list;
    }
    if (Object.keys(system).length) payload.system = system;
  }
  return payload;
}

/** Texte d'un couplet recopié (syllabes copiées → chaîne que `parseLyricsText` redécoupe à l'identique). */
export function lyricSyllablesToText(syllables) {
  let out = '';
  for (const s of syllables) out += s.text + (s.syllabic === SYLLABIC.BEGIN || s.syllabic === SYLLABIC.MIDDLE ? '-' : ' ');
  return out.trim();
}

/** Nombre de portées et de mesures d'une charge (message « Copié : 4 mesures × 2 portées »). */
export function clipboardSummary(payload) {
  return { measures: payload.measures, staves: payload.staves.length, whole: payload.span?.whole ?? payload.measures, extraBeats: payload.span?.extraBeats ?? null, partial: !!payload.span && !fEq(payload.span.extra, ZERO) };
}

export function serializeClipboard(payload) {
  return JSON.stringify(payload);
}

/** Lit un texte du presse-papiers : la charge, ou null si ce n'est pas du « scorsaire-staff-list » valable. */
export function parseClipboard(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || data.format !== CLIPBOARD_FORMAT || data.version !== CLIPBOARD_VERSION) return null;
  if (!isFraction(data.length) || !Array.isArray(data.staves) || !data.staves.length) return null;
  for (const s of data.staves) {
    if (!s || typeof s.type !== 'string' || !Array.isArray(s.items) || !s.lists || typeof s.lists !== 'object') return null;
    for (const it of s.items) {
      if (!it || !isFraction(it.at) || !Number.isInteger(it.voice) || !it.item || typeof it.item.type !== 'string') return null;
    }
  }
  return data;
}

export { fEq };
