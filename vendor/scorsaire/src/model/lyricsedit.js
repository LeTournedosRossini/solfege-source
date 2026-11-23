/*
 * Saisie des paroles depuis la mélodie. PUR (aucun DOM). À APPELER DANS `doc.transaction`.
 *
 * Le texte du couplet (`PID.LYRIC_TEXTS`) reste la source de vérité ; un lien (`PID.LYRIC_LINKS`) désigne la syllabe de rang `index`.
 * Règles décidées avec Jean (14/10/2026), sur le modèle de MuseScore 4.7.5 (`navigateToLyrics`, `lyricsTab`, `lyricsMinus`,
 * `lyricsUnderscore`, `extractSyllable`, lus) :
 *  - écrire sur une note qui porte déjà une syllabe du couplet REMPLACE la syllabe de ce rang (les suivantes ne bougent pas) ;
 *  - écrire sur une note sans syllabe INSÈRE un mot juste après celui de l'accord précédent qui en porte un (au début s'il n'y en a pas) :
 *    les rangs suivants sont décalés de +1 dans TOUTES les portées qui lient ce texte ;
 *  - le séparateur tapé (espace, tiret, souligné) est écrit APRÈS la syllabe ; il n'est jamais dans la syllabe ;
 *  - écrire sur une note couverte par un mélisme arrête ce mélisme à l'accord précédent ; écrire sur le départ d'un mélisme le retire ;
 *  - le tiret et le souligné n'agissent que sur l'accord immédiatement voisin (même voix).
 * Les mots du texte qui ne sont posés sur aucune note (orphelins) restent dans le texte : aucune opération ici n'en crée.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { EditError } from './noteedit.js';
import { createLyricText, createLyricLink, parseLyricsText, isGridText, gridSegmentMap, gridTextFromMap, gridSyllables } from './lyrics.js';

/* ---------- découpage du texte en jetons (syllabes + séparateur qui les suit) ---------- */

/** [{ kind:'syl', text, join:'-'|' ' } | { kind:'raw', text }] — `join` = séparateur APRÈS le jeton (ignoré pour le dernier). */
export function parseTokens(text) {
  const out = [];
  for (const word of String(text ?? '').split(/\s+/)) {
    if (!word) continue;
    if (word === '_' || word === '-' || word === '|') { out.push({ kind: 'raw', text: word, join: ' ' }); continue; }
    const pieces = word.split(/(?<=[^-])-(?=[^-])/);
    pieces.forEach((p, i) => out.push({ kind: 'syl', text: p, join: i === pieces.length - 1 ? ' ' : '-' }));
  }
  return out;
}

export function formatTokens(tokens) {
  let s = '';
  tokens.forEach((t, i) => {
    s += t.text;
    if (i === tokens.length - 1) return;
    s += t.kind === 'syl' && t.join === '-' && tokens[i + 1].kind === 'syl' ? '-' : ' ';
  });
  return s;
}

const sylIndices = (tokens) => tokens.flatMap((t, i) => (t.kind === 'syl' ? [i] : []));
const cleanSyllable = (text) => String(text ?? '').replace(/\s+/g, '');

/* ---------- accès au Document ---------- */

const staffOf = (doc, staffId) => {
  const s = doc.find(staffId);
  if (!s || s.type !== 'staff') throw new EditError('Portée introuvable');
  return s;
};

/** Identifiants des accords d'une voix, dans l'ordre (les silences sont ignorés ; les notes liées ne sont PAS sautées). */
export function staffChords(staff, voice) {
  const out = [];
  for (const m of staff.voices?.[voice]?.measures ?? []) for (const it of m.items) if (it.type === 'chord') out.push(it.id);
  return out;
}

export function voiceOfChord(staff, chordId) {
  for (let v = 0; v < (staff.voices?.length ?? 0); v++) if (staffChords(staff, v).includes(chordId)) return v;
  return -1;
}

const allStaves = (doc) => (doc.work?.movements ?? []).flatMap((mv) => mv.tracks.flatMap((t) => t.staves));
const textsOf = (doc) => getProperty(doc.work, PID.LYRIC_TEXTS) ?? [];

/** Accord voisin (+1 / −1) dans la même voix ; null au bord de la partition. */
export function neighbourChord(doc, staffId, chordId, dir) {
  const staff = staffOf(doc, staffId);
  const v = voiceOfChord(staff, chordId);
  if (v < 0) return null;
  const order = staffChords(staff, v);
  return order[order.indexOf(chordId) + dir] ?? null;
}

/**
 * Lecture : ce que porte l'accord pour ce couplet — { text, syllabic, rank, melismaEnd, covered } ou null si rien.
 * `covered` = id du lien dont le mélisme couvre cet accord (sans en être le départ).
 */
export function lyricAt(doc, staffId, chordId, verse) {
  const staff = staffOf(doc, staffId);
  const lt = textsOf(doc).find((t) => t.verse === verse);
  if (!lt) return null;
  const v = voiceOfChord(staff, chordId);
  const order = v < 0 ? [] : staffChords(staff, v);
  const idx = order.indexOf(chordId);
  const links = (getProperty(staff, PID.LYRIC_LINKS) ?? []).filter((l) => l.textId === lt.id);
  const syllables = parseLyricsText(lt.text);
  const own = links.find((l) => l.chordId === chordId && syllables[l.index]);
  if (own) return { text: syllables[own.index].text, syllabic: syllables[own.index].syllabic, rank: own.index, melismaEnd: own.endChordId ?? null, covered: null };
  const cover = links.find((l) => l.endChordId && idx >= 0 && order.indexOf(l.chordId) < idx && idx <= order.indexOf(l.endChordId));
  return cover ? { text: '', syllabic: null, rank: -1, melismaEnd: null, covered: cover.id } : null;
}

/** Couplets existants (0-based, triés) ; le prochain à créer vient après. */
export const verseList = (doc) => textsOf(doc).map((t) => t.verse).sort((a, b) => a - b);

/* ---------- écriture ---------- */

function shiftLinks(doc, textId, from, delta, localStaff, localLinks) {
  for (const st of allStaves(doc)) {
    const list = st === localStaff ? localLinks : getProperty(st, PID.LYRIC_LINKS) ?? [];
    if (!list.some((l) => l.textId === textId && l.index >= from)) continue;
    const next = list.map((l) => (l.textId === textId && l.index >= from ? { ...l, index: l.index + delta } : l));
    if (st === localStaff) { for (let i = 0; i < next.length; i++) localLinks[i] = next[i]; } else doc.set(st, PID.LYRIC_LINKS, next);
  }
}

/**
 * Écrit une syllabe sur un accord. `join` : 'space' | 'dash' | 'melisma' (le mélisme couvre l'accord voisin suivant) | 'keep' (ne touche pas
 * au séparateur existant ; un nouveau mot reçoit 'space'). `text` vide : retire la syllabe de l'accord (rien s'il n'en porte pas).
 * `prevJoin` ('dash' | 'space') : séparateur à écrire APRÈS la syllabe qui précède celle-ci dans le texte (un tiret tapé sur la dernière syllabe
 * d'un texte ne peut pas être stocké « dans le vide » : l'interface le garde et le transmet à l'écriture suivante).
 * Retourne { rank, melismaEnd, removed }.
 */
export function writeSyllable(doc, { staffId, chordId, verse, text, join = 'space', prevJoin }) {
  const staff = staffOf(doc, staffId);
  const word = cleanSyllable(text);
  if (!word) return { ...removeSyllable(doc, { staffId, chordId, verse }), rank: -1, melismaEnd: null };
  const voice = voiceOfChord(staff, chordId);
  if (voice < 0) throw new EditError('Accord introuvable dans la portée');
  const order = staffChords(staff, voice);
  const idx = order.indexOf(chordId);
  const work = doc.work;
  let texts = textsOf(doc);
  let lt = texts.find((t) => t.verse === verse);
  if (!lt) { lt = createLyricText(verse, ''); texts = [...texts, lt]; }
  const tokens = parseTokens(lt.text);
  const syl = sylIndices(tokens);
  const links = [...(getProperty(staff, PID.LYRIC_LINKS) ?? [])];
  const sepOf = (j) => (j === 'dash' ? '-' : ' ');
  let mineAt = links.findIndex((l) => l.textId === lt.id && l.chordId === chordId);
  if (mineAt >= 0 && links[mineAt].index >= syl.length) { links.splice(mineAt, 1); mineAt = -1; } // lien orphelin : on repart d'une insertion
  let rank;
  if (mineAt >= 0) {
    rank = links[mineAt].index;
    const tok = tokens[syl[rank]];
    tok.text = word;
    if (join !== 'keep') tok.join = sepOf(join);
    if (prevJoin && syl[rank] > 0 && tokens[syl[rank] - 1].kind === 'syl') tokens[syl[rank] - 1].join = sepOf(prevJoin);
    const { endChordId, ...rest } = links[mineAt]; // écrire sur le départ d'un mélisme le retire
    links[mineAt] = rest;
  } else {
    let prev = -1;
    for (const l of links) {
      if (l.textId !== lt.id) continue;
      const i = order.indexOf(l.chordId);
      if (i >= 0 && i < idx && (prev < 0 || i > order.indexOf(links[prev].chordId))) prev = links.indexOf(l);
    }
    rank = prev >= 0 ? Math.min(links[prev].index + 1, syl.length) : 0;
    const at = rank === 0 ? 0 : syl[rank - 1] + 1;
    shiftLinks(doc, lt.id, rank, 1, staff, links);
    tokens.splice(at, 0, { kind: 'syl', text: word, join: join === 'keep' ? ' ' : sepOf(join) });
    if (prevJoin && at > 0 && tokens[at - 1].kind === 'syl') tokens[at - 1].join = sepOf(prevJoin);
    links.push(createLyricLink(lt.id, rank, chordId));
    mineAt = links.length - 1;
  }
  // une note couverte par un mélisme (du même couplet) l'arrête à l'accord précédent
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (i === mineAt || l.textId !== lt.id || !l.endChordId) continue;
    const s = order.indexOf(l.chordId);
    const e = order.indexOf(l.endChordId);
    if (s >= 0 && s < idx && idx <= e) {
      const { endChordId, ...rest } = l;
      links[i] = idx - 1 > s ? { ...rest, endChordId: order[idx - 1] } : rest;
    }
  }
  let melismaEnd = null;
  if (join === 'melisma') {
    const next = order[idx + 1];
    if (next && !links.some((l) => l.textId === lt.id && l.chordId === next)) { melismaEnd = next; links[mineAt] = { ...links[mineAt], endChordId: next }; }
  }
  doc.set(work, PID.LYRIC_TEXTS, texts.map((t) => (t.id === lt.id ? { ...t, text: formatTokens(tokens) } : t)));
  doc.set(staff, PID.LYRIC_LINKS, links);
  return { rank, melismaEnd, removed: false };
}

/** Retire la syllabe de l'accord (mot et lien) ; les rangs suivants reculent de 1. Retourne { removed }. */
export function removeSyllable(doc, { staffId, chordId, verse }) {
  const staff = staffOf(doc, staffId);
  const lt = textsOf(doc).find((t) => t.verse === verse);
  if (!lt) return { removed: false };
  const links = [...(getProperty(staff, PID.LYRIC_LINKS) ?? [])];
  const at = links.findIndex((l) => l.textId === lt.id && l.chordId === chordId);
  if (at < 0) return { removed: false };
  const tokens = parseTokens(lt.text);
  const syl = sylIndices(tokens);
  const rank = links[at].index;
  if (rank < syl.length) {
    const i = syl[rank];
    if (i > 0 && tokens[i - 1].kind === 'syl' && tokens[i - 1].join === '-' && tokens[i].join !== '-') tokens[i - 1].join = ' ';
    tokens.splice(i, 1);
    links.splice(at, 1);
    shiftLinks(doc, lt.id, rank + 1, -1, staff, links);
    doc.set(doc.work, PID.LYRIC_TEXTS, textsOf(doc).map((t) => (t.id === lt.id ? { ...t, text: formatTokens(tokens) } : t)));
  } else links.splice(at, 1);
  if (links.length) doc.set(staff, PID.LYRIC_LINKS, links); else doc.reset(staff, PID.LYRIC_LINKS);
  return { removed: true };
}

/**
 * Souligné : prolonge d'un accord le mélisme dont `chordId` est le dernier accord couvert (ou la syllabe de `chordId` si elle n'en a pas).
 * Retourne { ok, target } — `target` = accord nouvellement couvert (où va le curseur).
 */
export function extendMelisma(doc, { staffId, chordId, verse }) {
  const staff = staffOf(doc, staffId);
  const lt = textsOf(doc).find((t) => t.verse === verse);
  const voice = voiceOfChord(staff, chordId);
  if (!lt || voice < 0) return { ok: false, target: null };
  const order = staffChords(staff, voice);
  const idx = order.indexOf(chordId);
  const target = order[idx + 1];
  if (!target) return { ok: false, target: null };
  const links = [...(getProperty(staff, PID.LYRIC_LINKS) ?? [])];
  if (links.some((l) => l.textId === lt.id && l.chordId === target)) return { ok: false, target: null };
  const at = links.findIndex((l) => l.textId === lt.id && order.indexOf(l.endChordId ?? l.chordId) === idx);
  if (at < 0) return { ok: false, target: null };
  links[at] = { ...links[at], endChordId: target };
  doc.set(staff, PID.LYRIC_LINKS, links);
  return { ok: true, target };
}

/* ---------- geste A : un bloc de texte posé sur une suite d'accords ---------- */

/** Éléments d'un texte saisi : [{ kind:'syl', text, join:'dash'|'space' } | { kind:'ext' }]. */
export function parseBlock(text) {
  const out = [];
  for (const word of String(text ?? '').split(/\s+/)) {
    if (!word || word === '-' || word === '|') continue;
    if (word === '_') { out.push({ kind: 'ext' }); continue; }
    const lead = /^-+/.test(word);
    const trail = /-+$/.test(word);
    const core = word.replace(/^-+|-+$/g, '');
    const pieces = core.split(/-+/).filter(Boolean);
    if (!pieces.length) continue;
    if (lead) { const prev = [...out].reverse().find((e) => e.kind === 'syl'); if (prev) prev.join = 'dash'; }
    pieces.forEach((p, i) => out.push({ kind: 'syl', text: p, join: i < pieces.length - 1 || trail ? 'dash' : 'space' }));
  }
  return out;
}

/** Texte restant (éléments non posés) remis en chaîne. */
export function blockToText(items) {
  let s = '';
  for (const e of items) s += e.kind === 'ext' ? '_ ' : e.text + (e.join === 'dash' ? '-' : ' ');
  return s.trim();
}

/**
 * Pose `text` sur `chordIds` (une syllabe par accord ; « _ » prolonge le mélisme d'un accord). Le séparateur de la dernière syllabe posée
 * reste celui du texte existant (les bords de la zone ne changent pas). Retourne { placed, left, lastChordId }.
 */
export function writeLyricsBlock(doc, { staffId, verse, text, chordIds }) {
  const items = parseBlock(text);
  let i = 0; // accord courant
  let k = 0; // élément courant
  let covered = null; // dernier accord couvert par la syllabe précédente
  let lastSyl = -1;
  items.forEach((e, n) => { if (e.kind === 'syl') lastSyl = n; });
  for (; k < items.length && i < chordIds.length; k++) {
    const e = items[k];
    if (e.kind === 'ext') {
      if (!covered) { i++; continue; }
      const r = extendMelisma(doc, { staffId, chordId: covered, verse });
      if (!r.ok) break;
      covered = r.target;
      i++;
      continue;
    }
    const before = k > 0 && items[k - 1].kind === 'syl' ? items[k - 1].join : undefined;
    writeSyllable(doc, { staffId, chordId: chordIds[i], verse, text: e.text, join: k === lastSyl ? 'keep' : e.join, prevJoin: before });
    covered = chordIds[i];
    i++;
  }
  return { placed: k, left: blockToText(items.slice(k)), lastChordId: covered };
}

/* ---------- geste C : un texte posé sur la GRILLE des mesures (sans mélodie) ---------- */

/** Number of words of a text written on the grid (bar lines and extension marks do not count). */
export const gridWordCount = (text) => String(text ?? '').split(/\s+/).filter((w) => w && w !== '|' && w !== '_' && w !== '-').length;

const linkedTo = (doc, textId) => allStaves(doc).some((st) => (getProperty(st, PID.LYRIC_LINKS) ?? []).some((l) => l.textId === textId));

/** What a verse writes in each measure of a movement: Map(masterbar index → string). Empty for a verse that is not written on the grid. */
export function gridTextOf(doc, movement, verse) {
  const lt = textsOf(doc).find((t) => t.verse === verse);
  if (!lt || !isGridText(lt.text)) return new Map();
  return gridSegmentMap(lt.text, Math.max(0, movement.masterbars.findIndex((m) => m.id === lt.measureId)));
}

/**
 * Writes what a verse says in some measures (`measures`: [{ id (masterbar), text }]); the other measures keep what they had. The verse is written on the grid from its first
 * non-empty measure (no bar line to type); when nothing is left the verse text is removed. A verse already linked to notes is refused (its links name syllables by rank).
 * Returns { empty } (the verse has no text any more).
 */
export function writeGridMeasures(doc, { verse, measures }) {
  if (!measures.length) throw new EditError('Aucune mesure');
  const mv = doc.movementOf(doc.find(measures[0].id));
  if (!mv) throw new EditError('Mesure introuvable');
  const ids = mv.masterbars.map((m) => m.id);
  const texts = textsOf(doc);
  const old = texts.find((t) => t.verse === verse);
  if (old && linkedTo(doc, old.id)) throw new EditError('Ce couplet est déjà posé sur des notes');
  const map = gridTextOf(doc, mv, verse);
  for (const m of measures) {
    const at = ids.indexOf(m.id);
    if (at < 0) throw new EditError('Mesure introuvable');
    map.set(at, String(m.text ?? '').trim());
  }
  const made = gridTextFromMap(map);
  if (!made) { if (old) doc.set(doc.work, PID.LYRIC_TEXTS, texts.filter((t) => t.id !== old.id)); return { empty: true }; }
  const lt = createLyricText(verse, made.text, { placement: old?.placement, measureId: ids[made.first] });
  doc.set(doc.work, PID.LYRIC_TEXTS, old ? texts.map((t) => (t.id === old.id ? { ...lt, id: old.id } : t)) : [...texts, lt]);
  return { empty: false };
}

/**
 * « Attacher aux notes » : the verse written on the grid is put on the notes of a staff, measure by measure: the k-th syllable of a measure goes on the k-th chord of that
 * measure of the staff (the rhythm entered afterwards for these words). The verse stops being a grid text (no bar line, no start measure) and becomes an ordinary linked verse,
 * adjusted afterwards with the usual lyric entry. Syllables beyond the chords of their measure stay in the text without a link; chords beyond the syllables stay bare.
 * Returns { linked, unlinked }.
 */
export function attachGridToStaff(doc, { verse, staffId }) {
  const staff = staffOf(doc, staffId);
  const mv = doc.movementOf(staff);
  const texts = textsOf(doc);
  const lt = texts.find((t) => t.verse === verse);
  if (!lt || !isGridText(lt.text)) throw new EditError('Ce couplet n\'est pas écrit sur la grille');
  const from = Math.max(0, mv.masterbars.findIndex((m) => m.id === lt.measureId));
  const syls = gridSyllables(lt.text);
  const chordsOf = (mi) => (staff.voices?.[0]?.measures?.[mi]?.items ?? []).filter((it) => it.type === 'chord');
  const links = [];
  const seen = new Map();
  for (const sy of syls) {
    const k = seen.get(sy.bar) ?? 0; seen.set(sy.bar, k + 1);
    const chord = chordsOf(from + sy.bar)[k];
    if (chord) links.push(createLyricLink(lt.id, sy.index, chord.id));
  }
  const text = syls.map((sy) => `${sy.text}${sy.join === '-' ? '-' : ' '}`).join('').trim();
  const { measureId, ...rest } = lt;
  doc.set(doc.work, PID.LYRIC_TEXTS, texts.map((t) => (t.id === lt.id ? { ...rest, text } : t)));
  doc.set(staff, PID.LYRIC_LINKS, [...(getProperty(staff, PID.LYRIC_LINKS) ?? []), ...links]);
  return { linked: links.length, unlinked: syls.length - links.length };
}

/* ---------- geste D : déplacer une syllabe posée sur une autre note ---------- */

/**
 * Moves the syllable `linkId` of a staff onto the chord `chordId` (same staff, same voice). The order of the syllables of the text never changes: a syllable cannot jump
 * in front of the one before it (refused), and the ones after it are pushed on to the next free notes only where they would collide with it. A syllable held over
 * several notes (melisma) keeps its length. Everything or nothing: when the notes run out nothing is written.
 * Returns { moved } (false when it was already there).
 */
export function moveSyllable(doc, { staffId, linkId, chordId }) {
  const staff = staffOf(doc, staffId);
  const links = [...(getProperty(staff, PID.LYRIC_LINKS) ?? [])];
  const me = links.find((l) => l.id === linkId);
  if (!me) throw new EditError('Syllabe introuvable');
  const voice = voiceOfChord(staff, me.chordId);
  if (voice < 0 || voiceOfChord(staff, chordId) !== voice) throw new EditError('Une syllabe reste sur la même voix de la même portée');
  const order = staffChords(staff, voice);
  const to = order.indexOf(chordId);
  if (to === order.indexOf(me.chordId)) return { moved: false };
  const mine = links.filter((l) => l.textId === me.textId && order.includes(l.chordId)).sort((a, b) => a.index - b.index);
  const k = mine.findIndex((l) => l.id === linkId);
  if (k > 0 && order.indexOf(mine[k - 1].chordId) >= to) throw new EditError('Une syllabe ne peut pas passer devant la précédente');
  const length = (l) => (l.endChordId ? Math.max(0, order.indexOf(l.endChordId) - order.indexOf(l.chordId)) : 0);
  const placed = new Map([[me.id, to]]);
  for (let j = k + 1; j < mine.length; j += 1) {
    const before = mine[j - 1];
    const need = Math.max(order.indexOf(mine[j].chordId), placed.get(before.id) + length(before) + 1);
    if (need >= order.length) throw new EditError('Plus assez de notes pour décaler les syllabes suivantes');
    placed.set(mine[j].id, need);
  }
  const next = links.map((l) => {
    if (!placed.has(l.id)) return l;
    const at = placed.get(l.id);
    const { endChordId, ...rest } = l;
    const end = Math.min(at + length(l), order.length - 1);
    return { ...rest, chordId: order[at], ...(end > at ? { endChordId: order[end] } : {}) };
  });
  doc.set(staff, PID.LYRIC_LINKS, next);
  return { moved: true };
}

/* ---------- geste E : la fenêtre d'ajustement (mots ↔ notes d'une portée) ---------- */

/**
 * The words of a verse and the notes of voice 1 of a staff, for the adjustment window:
 * { textId, syllables: [{ index, text, join }], chords: [{ id, mi }], assign: (chord rank | null)[] (one per syllable), spans: number[] (notes held beyond the first), grid }.
 * A verse written on the grid is offered with the default placement of « Sur les notes du rythme » (the k-th syllable of a measure on the k-th note of that measure).
 */
export function lyricAssignmentOf(doc, staffId, verse) {
  const staff = staffOf(doc, staffId);
  const mv = doc.movementOf(staff);
  const lt = textsOf(doc).find((t) => t.verse === verse);
  if (!lt) return null;
  const grid = isGridText(lt.text);
  const syllables = grid ? gridSyllables(lt.text) : parseTokens(lt.text).filter((t) => t.kind === 'syl').map((t, index) => ({ index, text: t.text, join: t.join }));
  const chords = [];
  (staff.voices?.[0]?.measures ?? []).forEach((m, mi) => { for (const it of m?.items ?? []) if (it.type === 'chord') chords.push({ id: it.id, mi }); });
  const rank = new Map(chords.map((c, i) => [c.id, i]));
  const assign = syllables.map(() => null); const spans = syllables.map(() => 0);
  if (grid) {
    const from = Math.max(0, mv.masterbars.findIndex((m) => m.id === lt.measureId));
    const seen = new Map();
    syllables.forEach((sy, i) => {
      const k = seen.get(sy.bar) ?? 0; seen.set(sy.bar, k + 1);
      const at = chords.findIndex((c, ci) => c.mi === from + sy.bar && chords.slice(0, ci).filter((x) => x.mi === c.mi).length === k);
      if (at >= 0) assign[i] = at;
    });
  } else {
    for (const l of getProperty(staff, PID.LYRIC_LINKS) ?? []) {
      if (l.textId !== lt.id || !rank.has(l.chordId) || l.index >= syllables.length) continue;
      assign[l.index] = rank.get(l.chordId);
      if (l.endChordId && rank.has(l.endChordId)) spans[l.index] = Math.max(0, rank.get(l.endChordId) - rank.get(l.chordId));
    }
  }
  return { textId: lt.id, syllables, chords, assign, spans, grid };
}

/**
 * Puts syllable `i` on chord rank `p` (or takes it off the notes when `p` is null) in an assignment: the order of the placed syllables never changes — a syllable cannot go in front of
 * the placed one before it (throws), the placed ones after it are pushed on only where they would collide. `spans` = notes each syllable holds beyond its first. Returns a new array.
 */
export function moveInAssignment(assign, i, p, chordCount, spans = []) {
  const next = [...assign];
  if (p === null) { next[i] = null; return next; }
  if (p < 0 || p >= chordCount) throw new EditError('Note introuvable');
  for (let j = i - 1; j >= 0; j -= 1) if (next[j] !== null) { if (next[j] >= p) throw new EditError('Une syllabe ne peut pas passer devant la précédente'); break; }
  next[i] = p;
  let last = p + (spans[i] ?? 0);
  for (let j = i + 1; j < next.length; j += 1) {
    if (next[j] === null) continue;
    if (next[j] > last) break; // nothing collides any more, the ones after keep their notes
    next[j] = last + 1;
    if (next[j] >= chordCount) throw new EditError('Plus assez de notes pour décaler les syllabes suivantes');
    last = next[j] + (spans[j] ?? 0);
  }
  return next;
}

/** Writes an assignment (see `lyricAssignmentOf`): the links of the verse on this staff become exactly `assign`; a grid verse becomes an ordinary verse. Returns { linked }. */
export function setLyricAssignment(doc, { staffId, verse, assign }) {
  const staff = staffOf(doc, staffId);
  const info = lyricAssignmentOf(doc, staffId, verse);
  if (!info) throw new EditError('Couplet introuvable');
  if (assign.length !== info.syllables.length) throw new EditError('Placement incohérent');
  let prev = -1;
  assign.forEach((p) => { if (p === null) return; if (!(p > prev) || p >= info.chords.length) throw new EditError('Placement incohérent'); prev = p; });
  const texts = textsOf(doc);
  const lt = texts.find((t) => t.id === info.textId);
  const old = new Map((getProperty(staff, PID.LYRIC_LINKS) ?? []).filter((l) => l.textId === lt.id).map((l) => [l.index, l]));
  const kept = (getProperty(staff, PID.LYRIC_LINKS) ?? []).filter((l) => l.textId !== lt.id);
  const added = [];
  assign.forEach((p, i) => {
    if (p === null) return;
    const end = Math.min(p + info.spans[i], info.chords.length - 1);
    const base = old.get(i);
    const link = base ? { ...base, chordId: info.chords[p].id } : createLyricLink(lt.id, i, info.chords[p].id);
    delete link.endChordId;
    added.push(end > p ? { ...link, endChordId: info.chords[end].id } : link);
  });
  if (info.grid) {
    const text = info.syllables.map((sy) => `${sy.text}${sy.join === '-' ? '-' : ' '}`).join('').trim();
    const { measureId, ...rest } = lt;
    doc.set(doc.work, PID.LYRIC_TEXTS, texts.map((t) => (t.id === lt.id ? { ...rest, text } : t)));
  }
  doc.set(staff, PID.LYRIC_LINKS, [...kept, ...added]);
  return { linked: added.length };
}

/* ---------- geste F : la feuille de texte libre (texte seul, accords entre crochets) ---------- */

/** What a verse is: 'empty' (no text), 'free' (a free text sheet), 'grid' (written on the measures) or 'linked' (placed on notes). */
export function verseState(doc, verse) {
  const lt = textsOf(doc).find((t) => t.verse === verse);
  if (!lt) return 'empty';
  if (linkedTo(doc, lt.id)) return 'linked';
  return isGridText(lt.text) ? 'grid' : 'free';
}

/** Writes the free text sheet of a verse (blank = the verse text is removed). Refused when the verse is already placed on notes or on the grid. */
export function writeFreeText(doc, { verse, text }) {
  const texts = textsOf(doc);
  const old = texts.find((t) => t.verse === verse);
  const state = verseState(doc, verse);
  if (state === 'linked') throw new EditError('Ce couplet est déjà posé sur des notes');
  if (state === 'grid') throw new EditError('Ce couplet est écrit sur la grille des mesures');
  const clean = String(text ?? '').replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();
  if (isGridText(clean)) throw new EditError('Le signe « | » est réservé à la grille des mesures');
  if (!clean) { if (old) doc.set(doc.work, PID.LYRIC_TEXTS, texts.filter((t) => t.id !== old.id)); return { empty: true }; }
  const lt = createLyricText(verse, clean, { placement: old?.placement, label: old?.label, category: old?.category }); // (a stanza keeps its name when its words are edited)
  doc.set(doc.work, PID.LYRIC_TEXTS, old ? texts.map((t) => (t.id === old.id ? { ...lt, id: old.id } : t)) : [...texts, lt]);
  return { empty: false };
}
