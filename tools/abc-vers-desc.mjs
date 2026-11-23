// Convertisseur ABC → description (sous-ensemble utilisé par l'ancienne application). OUTIL DE MIGRATION : sert à reprendre les exemples des leçons
// et, plus tard, les 83 phrases du répertoire ; l'application finale ne lit plus d'ABC.
// Usage en bibliothèque : import { parseAbc } from './abc-vers-desc.mjs'
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const NAMES = [['breve', 2, 1], ['whole', 1, 1], ['half', 1, 2], ['quarter', 1, 4], ['eighth', 1, 8], ['sixteenth', 1, 16], ['thirtysecond', 1, 32]];
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const red = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };

function keyAlters(fifths) {
  const m = {};
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => { m[l] = 1; });
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((l) => { m[l] = -1; });
  return m;
}
/** fraction de ronde → { d, dots } */
function toDuration([n, d]) {
  for (const [name, bn, bd] of NAMES) for (const [dots, mn, md] of [[0, 1, 1], [1, 3, 2], [2, 7, 4]]) {
    const [rn, rd] = red(bn * mn, bd * md);
    if (rn === n && rd === d) return { d: name, dots };
  }
  throw new Error(`Durée non prise en charge : ${n}/${d} de ronde`);
}
const ACC = (a) => (a === 1 ? '#' : a === -1 ? 'b' : a === 2 ? 'x' : a === -2 ? 'bb' : '');

export function parseAbc(abc, { staffwidth } = {}) {
  const lines = abc.split('\n');
  let unit = [1, 8], time = null, key = 0, clef = 'treble', body = [], lyricLine = null;
  for (const l of lines) {
    const h = /^([A-Z]):(.*)$/.exec(l);
    if (h) {
      const [, k, v] = h;
      if (k === 'L') { const [n, d] = v.trim().split('/').map(Number); unit = red(n, d ?? 1); }
      else if (k === 'M') { const [n, d] = v.trim().split('/').map(Number); time = [n, d]; }
      else if (k === 'K') {
        const m = /^\s*([A-G][#b]?)/.exec(v); if (!m || !(m[1] in FIFTHS)) throw new Error(`Armure non reconnue : ${v}`);
        key = FIFTHS[m[1]]; const c = /clef=(\w+)/.exec(v); if (c) clef = c[1];
      }
    } else if (/^w:/.test(l)) lyricLine = l.slice(2).trim().split(/\s+/).filter((w) => w && w !== '-');
    else if (l.trim()) body.push(l);
  }
  const keyAlt = keyAlters(key);
  const text = body.join(' ');
  const measures = [{ events: [] }]; let mem = {}; let pendSlur = false; let pend = { art: [], grace: null }; let tupletLeft = 0, tupletMeta = null, tupletN = 0;
  const cur = () => measures.at(-1).events;
  const mult = (i) => { // multiplicateur de durée : 2, /2, 3/2, /, //
    let m = /^(\d+)?(\/+)?(\d+)?/.exec(text.slice(i)); let num = 1, den = 1, len = 0;
    if (m && m[0]) {
      len = m[0].length; if (m[1]) num = Number(m[1]);
      if (m[2]) den = m[3] ? Number(m[3]) : 2 ** m[2].length;
    }
    return { num, den, len };
  };
  const pitch = (i) => { // [^_=]* lettre [,']* → { name, len }
    let j = i, acc = null;
    const a = /^(\^\^|__|\^|_|=)/.exec(text.slice(j)); if (a) { acc = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }[a[1]]; j += a[1].length; }
    const L = text[j]; if (!/[A-Ga-g]/.test(L)) throw new Error(`Note attendue en position ${j} : « ${text.slice(i, i + 12)} »`); j++;
    let oct = L === L.toUpperCase() ? 4 : 5; const up = L.toUpperCase();
    while (text[j] === "'" || text[j] === ',') { oct += text[j] === "'" ? 1 : -1; j++; }
    const k = up + oct;
    let alter; if (acc != null) { alter = acc; mem[k] = acc; } else alter = k in mem ? mem[k] : (keyAlt[up] ?? 0);
    return { name: `${up}${ACC(alter)}${oct}`, len: j - i };
  };
  const push = (ev, num, den) => {
    const v = red(unit[0] * num, unit[1] * den);
    Object.assign(ev, toDuration(v));
    if (tupletLeft > 0) { ev.tuplet = { ratio: [tupletMeta.n, tupletMeta.q], base: tupletMeta.base ?? ev.d, id: `t${tupletN}` }; tupletMeta.base ??= ev.d; ev.tuplet.base = tupletMeta.base; tupletLeft--; }
    if (pend.art.length) ev.art = pend.art; if (pend.grace) ev.grace = pend.grace; if (pendSlur) { ev.slurStart = true; pendSlur = false; } pend = { art: [], grace: null };
    cur().push(ev);
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ') { i++; continue; }
    if (c === '|' || c === ':') { // barres, reprises, volta
      let j = i; while (j < text.length && '|:]'.includes(text[j])) j++;
      const run = text.slice(i, j); i = j;
      if (run.includes(':|')) { (cur().length ? measures.at(-1) : measures.at(-2)).repeatEnd = true; }
      if (cur().length) { measures.push({ events: [] }); mem = {}; }
      if (run.includes('|:') || run === ':' ) measures.at(-1).repeatStart = true;
      if (text[i] === '[' && /\d/.test(text[i + 1])) { measures.at(-1).volta = [Number(text[i + 1])]; i += 2; }
      continue;
    }
    if (c === '!') { const e = text.indexOf('!', i + 1); const n = text.slice(i + 1, e); i = e + 1;
      const MAP = { trill: 'trill', mordent: 'mordent', pralltriller: 'mordentInverted', tenuto: 'tenuto', accent: 'accent', staccato: 'staccato', segno: null, coda: null };
      if (!(n in MAP)) throw new Error(`Décoration non prise en charge : ${n}`);
      if (MAP[n]) pend.art.push(MAP[n]); else pend.sign = n; continue; }
    if (c === '.') { pend.art.push('staccato'); i++; continue; }
    if (c === '{') { const e = text.indexOf('}', i); const g = []; let j = i + 1; while (j < e) { const p = pitch(j); g.push(p.name); j += p.len; } pend.grace = g; i = e + 1; continue; }
    if (c === '(' && !/\d/.test(text[i + 1])) { pendSlur = true; i++; continue; }
    if (c === ')') { const last = cur().at(-1) ?? measures.at(-2)?.events.at(-1); if (last) last.slurEnd = true; i++; continue; }
    if (c === '(' && /\d/.test(text[i + 1])) { const n = Number(text[i + 1]); tupletLeft = n; tupletMeta = { n, q: n === 3 ? 2 : n === 2 ? 3 : 2, base: null }; tupletN++; i += 2; continue; }
    if (c === '-') { const last = cur().at(-1) ?? measures.at(-2)?.events.at(-1); if (last) last.tie = true; i++; continue; }
    if (c === '[') { const e = text.indexOf(']', i); const ns = []; let j = i + 1; while (j < e) { const p = pitch(j); ns.push(p.name); j += p.len; } const m = mult(e + 1); const ev = { n: ns }; push(ev, m.num, m.den); i = e + 1 + m.len; continue; }
    if (c === 'z' || c === 'y') { const m = mult(i + 1); const ev = c === 'z' ? { rest: true } : { gap: true }; push(ev, m.num, m.den); i += 1 + m.len; continue; }
    const p = pitch(i); const m = mult(i + p.len); const ev = { n: [p.name] };
    const sign = pend.sign; delete pend.sign; push(ev, m.num, m.den); if (sign) ev.sign = sign; i += p.len + m.len;
  }
  if (!measures.at(-1).events.length) measures.pop();
  if (lyricLine) { let k = 0; for (const m of measures) for (const e of m.events) if (e.n && lyricLine[k] !== undefined) e.lyric = lyricLine[k++]; }
  const simple = measures.map((m) => (Object.keys(m).length === 1 ? m.events : m));
  const desc = { clef, key, time, measures: simple };
  if (staffwidth) desc.width = Number(staffwidth) + 8; // largeur totale du dessin d'abcjs : staffwidth + marges
  if (!time) desc.time = null;
  return desc;
}
