/*
 * Texts of a printed page (screen 2): header, footer, title block, and the numbering of measures. Pure (no DOM).
 * Port of the rules of MuseScore 4.7.5 (`headerfooterlayout.cpp`: three areas, first page / odd / even templates, tokens; `Measure::showMeasureNumberInAutoMode`,
 * `MeasureLayout::adjustMeasureNo`: numbering and which numbers are shown).
 *
 * Header / footer of a part (`PID.PART_HEADER`, `PID.PART_FOOTER`): { enabled, twoSided, first: {l,c,r} | null (no header on the first page), odd: {l,c,r}, even: {l,c,r} }.
 * `even` is used on even page numbers only when `twoSided` (recto / verso). Texts may contain tokens and the tags <b> <i>.
 */
import { PID } from './pid.js';
import { SID } from './sid.js';
import { parseCardText } from './sections.js';

export const AREAS = ['l', 'c', 'r'];
const EMPTY = () => ({ l: '', c: '', r: '' });

export const DEFAULT_HEADER = () => ({ enabled: true, twoSided: true, first: null, odd: { l: '', c: '', r: '$p' }, even: { l: '$p', c: '', r: '' } });
export const DEFAULT_FOOTER = () => ({ enabled: true, twoSided: true, first: { l: '', c: '$C', r: '' }, odd: EMPTY(), even: EMPTY() });

const cleanAreas = (v, fallback) => {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return fallback;
  return Object.fromEntries(AREAS.map((a) => [a, typeof v[a] === 'string' ? v[a].slice(0, 200) : '']));
};

/** Header or footer of a part with the defaults filled in. `kind` 'header' | 'footer'. */
export function headerFooterOf(part, kind) {
  const base = kind === 'header' ? DEFAULT_HEADER() : DEFAULT_FOOTER();
  const own = part.props[kind === 'header' ? PID.PART_HEADER : PID.PART_FOOTER];
  if (!own || typeof own !== 'object') return base;
  return {
    enabled: own.enabled !== undefined ? Boolean(own.enabled) : base.enabled,
    twoSided: own.twoSided !== undefined ? Boolean(own.twoSided) : base.twoSided,
    first: own.first !== undefined ? cleanAreas(own.first, base.first) : base.first,
    odd: cleanAreas(own.odd, base.odd) ?? base.odd,
    even: cleanAreas(own.even, base.even) ?? base.even,
  };
}

/** Which template a page uses: 'first' | 'odd' | 'even' | null (none). */
export function templateKeyFor(cfg, pageIndex, pageNumber) {
  if (!cfg.enabled) return null;
  if (pageIndex === 0) return cfg.first ? 'first' : null;
  return ((pageNumber & 1) === 1 || !cfg.twoSided) ? 'odd' : 'even';
}

/** Template ({l,c,r}) of a page, or null when the page has none. `pageNumber` = the number printed (1 + offset + index). */
export function templateFor(cfg, pageIndex, pageNumber) {
  if (!cfg.enabled) return null;
  if (pageIndex === 0) return cfg.first;
  const odd = (pageNumber & 1) === 1 || !cfg.twoSided;
  return odd ? cfg.odd : cfg.even;
}

export const TOKEN_HELP = ['$p', '$P', '$N', '$n', '$i', '$I', '$d', '$D', '$C', '$c', '$$', '$:title:', '$:subtitle:', '$:composer:', '$:arranger:', '$:lyricist:', '$:album:', '$:copyright:', '$:instrument:', '$:movement:'];

/**
 * Replaces the tokens of a text (MuseScore `replaceTextMacros`): $p page number except on the first page, $P on every page, $N page number if there is
 * more than one page, $n number of pages, $i part name except on the first page, $I part name, $d today, $D creation date of the work, $C copyright on the
 * first page only, $c copyright, $$ a dollar sign, $:tag: a metadata tag (title, subtitle, composer, arranger, lyricist, album, copyright, date,
 * description, instrument, movement, part).
 * @param ctx  { pageNumber, pageIndex, total, tags: { title, subtitle, … }, today (ISO string), partName }
 */
export function expandTokens(text, ctx) {
  const tag = (name) => String(ctx.tags?.[name] ?? '');
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '$' || i === text.length - 1) { out += c; continue; }
    const n = text[i + 1];
    switch (n) {
      case 'p': if (ctx.pageIndex > 0) out += String(ctx.pageNumber); i++; break;
      case 'P': out += String(ctx.pageNumber); i++; break;
      case 'N': if (ctx.total > 1) out += String(ctx.pageNumber); i++; break;
      case 'n': out += String(ctx.total + (ctx.pageNumber - ctx.pageIndex - 1)); i++; break;
      case 'i': if (ctx.pageIndex > 0) out += ctx.partName ?? ''; i++; break;
      case 'I': out += ctx.partName ?? ''; i++; break;
      case 'd': out += ctx.today ?? ''; i++; break;
      case 'D': out += tag('date'); i++; break;
      case 'C': if (ctx.pageIndex === 0) out += tag('copyright'); i++; break;
      case 'c': out += tag('copyright'); i++; break;
      case '$': out += '$'; i++; break;
      case ':': {
        const end = text.indexOf(':', i + 2);
        if (end < 0) { out += c; break; }
        out += tag(text.slice(i + 2, end));
        i = end;
        break;
      }
      default: out += c;
    }
  }
  return out;
}

/** Splits a text with <b>, <i> and <u> tags into lines of runs: [[{ text, bold, italic, underline? }]]. Anything else stays plain text. */
export function parseRuns(text) {
  const lines = [[]];
  let bold = false; let italic = false; let underline = false; let buf = '';
  const flush = () => { if (buf) { lines[lines.length - 1].push({ text: buf, bold, italic, ...(underline ? { underline } : {}) }); buf = ''; } };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '<') {
      const m = /^<(\/?)([biu])>/.exec(text.slice(i));
      if (m) { flush(); if (m[2] === 'b') bold = m[1] === ''; else if (m[2] === 'i') italic = m[1] === ''; else underline = m[1] === ''; i += m[0].length - 1; continue; }
    }
    if (text[i] === '\n') { flush(); lines.push([]); continue; }
    buf += text[i];
  }
  flush();
  return lines.filter((l, k) => l.length || k < lines.length - 1 || lines.length === 1);
}

/**
 * The text of a zone cell as lines of items: `{ text, bold, italic, underline }` or `{ card: { label, category?, color? } }` (a `{{Label}}` section
 * card). The tags <b> <i> <u> carry over cards and lines. Page tokens ($p $P $N $n) are dropped (the page of a zone is not known when it is laid
 * out); the other tokens ($d $D $c $C $I $i $:tag: $$) are expanded with `ctx` ({ tags, today, partName }).
 */
export function richLines(text, ctx = {}) {
  const src = expandTokens(String(text ?? '').replace(/\$[pPNn]/g, ''), { pageNumber: 1, pageIndex: 1, total: 1, ...ctx });
  const lines = [];
  let bold = false; let italic = false; let underline = false;
  for (const raw of src.split('\n')) {
    const line = [];
    for (const piece of parseCardText(raw)) {
      if (piece.card) { line.push({ card: piece.card, bold, italic, underline }); continue; }
      let buf = '';
      const flush = () => { if (buf) { line.push({ text: buf, bold, italic, underline }); buf = ''; } };
      const t = piece.text;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '<') {
          const m = /^<(\/?)([biu])>/.exec(t.slice(i));
          if (m) { flush(); if (m[2] === 'b') bold = m[1] === ''; else if (m[2] === 'i') italic = m[1] === ''; else underline = m[1] === ''; i += m[0].length - 1; continue; }
        }
        buf += t[i];
      }
      flush();
    }
    lines.push(line);
  }
  return lines;
}

// ---------- text styles of the printed texts (MuseScore text properties: font, size, bold, italic, underline, alignment, colour) ----------

export const TEXT_FAMILIES = ['serif', 'sans-serif', 'monospace'];
export const TEXT_ALIGNS = ['left', 'center', 'right'];
/** Keys of the printed texts: title, subtitle, album, composer, arranger, lyricist, line:<id>, header|footer:<first|odd|even>:<l|c|r>, measureNumber. */
export const TEXT_KEY = /^[A-Za-z0-9_:|.-]{1,80}$/;

/** The style of one printed text: the defaults of its place, overridden by the part's text style (`PID.PART_TEXT_STYLES`). */
export function textStyleOf(styles, key, defaults = {}) {
  const own = styles?.[key] ?? {};
  const out = { family: 'serif', ...defaults };
  for (const k of ['family', 'size', 'bold', 'italic', 'underline', 'align', 'color']) if (own[k] !== undefined) out[k] = own[k];
  return out;
}

/**
 * The style a printed text has before the part says anything (what the editor shows): { family, size, bold, italic, underline, align, color }.
 * @param getStyle  (sid) → value, the part's style layer
 */
export function defaultTextStyle(key, getStyle, part) {
  const base = { family: 'serif', bold: false, italic: false, underline: false, align: null, color: null };
  const free = key.startsWith('line:') ? titleBlockOf(part).lines.find((l) => l.id === key.slice(5)) : null;
  if (key === 'title') return { ...base, size: getStyle(SID.TITLE_SIZE), bold: true, align: 'center' };
  if (key === 'subtitle') return { ...base, size: getStyle(SID.SUBTITLE_SIZE), align: 'center' };
  if (key === 'album') return { ...base, size: getStyle(SID.CREDITS_SIZE), italic: true, align: 'center' };
  if (key === 'lyricist') return { ...base, size: getStyle(SID.CREDITS_SIZE), align: 'left' };
  if (key === 'composer' || key === 'arranger') return { ...base, size: getStyle(SID.CREDITS_SIZE), align: 'right' };
  if (free) return { ...base, size: getStyle(SID.CREDITS_SIZE), bold: free.bold, italic: free.italic, align: free.align };
  if (key.startsWith('header:')) return { ...base, size: getStyle(SID.HEADER_SIZE) };
  if (key.startsWith('footer:')) return { ...base, size: getStyle(SID.FOOTER_SIZE) };
  if (key === 'measureNumber') return { ...base, size: getStyle(SID.MEASURE_NUMBER_SIZE), italic: true };
  if (key.startsWith('cell:')) return { ...base, size: 10, align: 'left' };
  return { ...base, size: 10 };
}

// ---------- title block ----------

/** What the title block of a part shows; `PID.PART_TITLE` = { show?, fields?: { subtitle, composer, arranger, lyricist, album }, lines?: [{ id, text, align, bold, italic }] }. */
export function titleBlockOf(part) {
  const own = part.props[PID.PART_TITLE] ?? {};
  const f = own.fields ?? {};
  return {
    show: own.show !== undefined ? Boolean(own.show) : true,
    fields: { subtitle: f.subtitle !== false, composer: f.composer !== false, arranger: f.arranger !== false, lyricist: f.lyricist !== false, album: f.album !== false },
    lines: Array.isArray(own.lines) ? own.lines.filter((l) => l && typeof l.text === 'string').map((l) => ({ id: l.id, text: l.text.slice(0, 200), align: ['left', 'center', 'right'].includes(l.align) ? l.align : 'center', bold: Boolean(l.bold), italic: Boolean(l.italic) })) : [],
  };
}

/**
 * Rows of the title block, top to bottom (MuseScore frame: title centred, subtitle centred, composer right and lyricist left on the same row).
 * A field with no text takes no room. Heights in mm (`lineHeight` = 1.2 × the size).
 * @returns { rows: [{ cells: [{ lines: [text], align, size (pt), bold, italic }], height (mm) }], height (mm) }
 */
export function layoutTitleRows(config, tags, sizes, today, ctx = {}, styles = {}) {
  const PT = 25.4 / 72;
  const rows = [];
  const plain = (s) => (s ?? '').trim();
  // a line = { text, key, style } (style: the defaults of the place under the part's text style); a cell = lines with the same default alignment
  const line = (key, text, base) => ({ text, key, style: textStyleOf(styles, key, base) });
  const add = (cells) => {
    const live = cells.filter((c) => c.lines.length);
    if (!live.length) return;
    for (const c of live) c.height = c.lines.reduce((h, l) => h + l.style.size * PT * 1.2, 0);
    rows.push({ cells: live, height: Math.max(...live.map((c) => c.height)) });
  };
  const title = plain(tags.title);
  if (title) add([{ lines: [line('title', title, { size: sizes.title, bold: true })], align: 'center' }]);
  if (config.fields.subtitle && plain(tags.subtitle)) add([{ lines: [line('subtitle', plain(tags.subtitle), { size: sizes.subtitle })], align: 'center' }]);
  if (config.fields.album && plain(tags.album)) add([{ lines: [line('album', plain(tags.album), { size: sizes.credits, italic: true })], align: 'center' }]);
  const left = []; const right = [];
  const credit = (key, on) => (on && plain(tags[key]) ? line(key, plain(tags[key]), { size: sizes.credits }) : null);
  const l1 = credit('lyricist', config.fields.lyricist); if (l1) left.push(l1);
  for (const k of ['composer', 'arranger']) { const c = credit(k, config.fields[k]); if (c) right.push(c); }
  add([{ lines: left, align: 'left' }, { lines: right, align: 'right' }]);
  for (const free of config.lines) {
    const text = expandTokens(free.text, { pageNumber: 1, pageIndex: 0, total: 1, tags, today, partName: ctx.partName });
    if (text.trim()) add([{ lines: text.split('\n').map((t) => line(`line:${free.id}`, t, { size: sizes.credits, bold: free.bold, italic: free.italic })), align: free.align }]);
  }
  return { rows, height: rows.reduce((s2, r) => s2 + r.height, 0) };
}

// ---------- measure numbering ----------

/**
 * Numbers of the measures of a movement (MuseScore `adjustMeasureNo`): `no` is the zero-based number (displayed no + 1), `excluded` = not counted.
 * A measure is not counted when `PID.MEASURE_NUMBER_EXCLUDE` says so, or, when the property is absent, when it is the first measure and it is a pickup
 * (a measure shorter than the time signature: `PID.MEASURE_LENGTH` set). `PID.MEASURE_NUMBER_OFFSET` is added from that measure on.
 * @param start  number the first measure would get (0 = restart at 1)
 * @returns { no: [int], excluded: [bool], next: int }
 */
export function measureNumbers(movement, start = 0) {
  const no = []; const excluded = [];
  let n = start;
  movement.masterbars.forEach((mb, i) => {
    const own = Object.hasOwn(mb.props, PID.MEASURE_NUMBER_EXCLUDE) ? Boolean(mb.props[PID.MEASURE_NUMBER_EXCLUDE]) : (i === 0 && mb.props[PID.MEASURE_LENGTH] != null);
    n += mb.props[PID.MEASURE_NUMBER_OFFSET] ?? 0;
    no.push(n);
    excluded.push(own);
    if (!own) n += 1;
  });
  return { no, excluded, next: n };
}

/**
 * Whether measure `i` shows its number (MuseScore `showMeasureNumber` / `showMeasureNumberInAutoMode`).
 * @param o  { mode: 'system' | 'interval' | 'every', interval, showOne, override: 'show' | 'hide' | undefined, firstInSystem (fn index → bool) }
 */
export function showsMeasureNumber(numbering, i, o) {
  if (o.override === 'show') return true;
  if (o.override === 'hide') return false;
  if (numbering.excluded[i]) return false; // numbers are not shown on measures that are not counted
  const prevExcludedFirst = i === 1 && numbering.excluded[0];
  const interval = o.mode === 'every' ? 1 : o.interval;
  // the first measure of a movement is numbered only on request (also the one after a pickup, unless every measure is numbered)
  if (i === 0 || (prevExcludedFirst && interval !== 1)) return Boolean(o.showOne);
  if (o.mode === 'system') return o.firstInSystem(i) || (i > 0 && numbering.excluded[i - 1] && o.firstInSystem(i - 1));
  if (interval === 1) return true;
  return ((numbering.no[i] + 1) % interval) === (o.showOne ? 1 : 0);
}
