/*
 * Page decorations of a printed part: header, footer and title block as text items in millimetres on the paper (origin top left, y down).
 * Pure. The music itself comes from layout/partlayout.js; this module decides how much room the decorations take (`limits`) and where the texts go.
 * Rules (MuseScore `HeaderFooterLayout`): the header text sits `PAGE_HEADER_MARGIN` below the top edge of the paper and the footer text
 * `PAGE_FOOTER_MARGIN` above the bottom edge; the music starts at max(margin, bottom of the header + 1 staff space) — so a small header fits in the
 * margin and moves nothing — and likewise at the bottom. The title block is the first thing on the first page, in the printable area.
 *
 * Every text is an item with a `key` (title, subtitle, composer…, `header:odd:r`, `line:<id>`) and an `id` (`chrome|<key>`): the part's text styles
 * (family, size, bold, italic, underline, colour, alignment) and its element overrides (colour, offset, hidden) are looked up by them.
 */
import { SID, PID } from '../model/index.js';
import { headerFooterOf, templateFor, templateKeyFor, expandTokens, parseRuns, titleBlockOf, layoutTitleRows, textStyleOf, AREAS } from '../model/pagetext.js';

const PT_MM = 25.4 / 72;
const LINE = 1.2; // line height / font size

/** Tags available to the tokens of a part: the metadata of the work, plus `instrument`, `movement`, `part`. */
export function partTags(work, part, { partName = '', movementIndex = 0 } = {}) {
  const w = work.props;
  const names = [];
  const ids = part.props[PID.PART_STAVES] ? new Set(part.props[PID.PART_STAVES]) : null;
  for (const mv of work.movements) for (const t of mv.tracks) {
    if (ids && !t.staves.some((s) => ids.has(s.id))) continue;
    const n = t.props[PID.NAME]; if (n && !names.includes(n)) names.push(n);
  }
  const mv = work.movements[movementIndex];
  return {
    title: w[PID.TITLE] ?? '', subtitle: w[PID.SUBTITLE] ?? '', composer: w[PID.COMPOSER] ?? '', arranger: w[PID.ARRANGER] ?? '', lyricist: w[PID.LYRICIST] ?? '',
    album: w[PID.ALBUM] ?? '', copyright: w[PID.COPYRIGHT] ?? '', date: w[PID.DATE] ?? '', description: w[PID.DESCRIPTION] ?? '',
    instrument: names.length && names.length <= 3 ? names.join(', ') : partName, movement: mv?.props[PID.TITLE] ?? '', part: partName,
  };
}

const sizeMm = (pt) => pt * PT_MM;

/** Lines of text of each area of a template for a page, tokens replaced: { l: [runs…], c, r } with empty areas removed. */
function areaLines(template, ctx) {
  const out = {};
  if (!template) return out;
  for (const a of AREAS) {
    const text = expandTokens(template[a] ?? '', ctx);
    if (!text.trim()) continue;
    out[a] = parseRuns(text);
  }
  return out;
}

/**
 * @param o  { work, part, geometry, getStyle (part style), partName, today, pageBase }
 * @returns { limits(pageIndex, movementIndex) → { top, bottom } in staff spaces (room above / below the music), items(pageIndex, total, movementIndex) → text items,
 *            titleRows }
 */
export function makePageChrome({ work, part, geometry, getStyle, partName = '', today = '', pageBase = 0 }) {
  const scoreOnly = getStyle(SID.PAGE_SCORE_ONLY);
  const header = headerFooterOf(part, 'header');
  const footer = headerFooterOf(part, 'footer');
  const block = titleBlockOf(part);
  const textStyles = part.props[PID.PART_TEXT_STYLES] ?? {};
  const overrides = part.props[PID.PART_OVERRIDES] ?? {};
  const space = geometry.spaceMm;
  const offset = getStyle(SID.PAGE_NUMBER_OFFSET);
  const sizes = { title: getStyle(SID.TITLE_SIZE), subtitle: getStyle(SID.SUBTITLE_SIZE), credits: getStyle(SID.CREDITS_SIZE) };
  const { margins } = geometry;
  const pageCtx = (pageIndex, total, movementIndex) => ({ pageNumber: 1 + offset + pageBase + pageIndex, pageIndex: pageBase + pageIndex, total, tags: partTags(work, part, { partName, movementIndex }), today, partName });
  const title = scoreOnly || !block.show ? { rows: [], height: 0 } : layoutTitleRows(block, partTags(work, part, { partName }), sizes, today, { partName }, textStyles);
  const titleHeight = title.height ? Math.max(0, title.height + getStyle(SID.TITLE_FRAME_DISTANCE) * space) : 0; // (a negative distance pulls the first system up under the title: it cancels the room kept above the first staff)
  const baseSize = { header: getStyle(SID.HEADER_SIZE), footer: getStyle(SID.FOOTER_SIZE) };

  /** The text areas of the header / footer of a page: [{ key, style, lines (runs) }]. */
  const areasOf = (kind, cfg, ctx) => {
    if (scoreOnly) return [];
    const tpl = templateFor(cfg, ctx.pageIndex, ctx.pageNumber);
    const tplKey = templateKeyFor(cfg, ctx.pageIndex, ctx.pageNumber);
    const lines = areaLines(tpl, ctx);
    return AREAS.filter((a) => lines[a]).map((a) => {
      const key = `${kind}:${tplKey}:${a}`;
      return { area: a, key, style: textStyleOf(textStyles, key, { size: baseSize[kind] }), lines: lines[a] };
    });
  };
  const heightOf = (areas) => Math.max(0, ...areas.map((a) => a.lines.length * sizeMm(a.style.size) * LINE));

  const bands = (pageIndex, movementIndex) => {
    const ctx = pageCtx(pageIndex, 99, movementIndex);
    return { hh: heightOf(areasOf('header', header, ctx)), fh: heightOf(areasOf('footer', footer, ctx)) };
  };

  /** Finishes an item: id, the style, the overrides of the part (offset in staff spaces, colour, hidden). */
  const finish = (item, key, style) => {
    const id = `chrome|${key}`;
    const o = overrides[id];
    const out = { ...item, key, id, family: style.family, bold: style.bold, italic: style.italic, underline: style.underline, color: style.color };
    if (o?.offset) { out.x += o.offset[0] * space; out.y += o.offset[1] * space; }
    if (o?.color) out.color = o.color;
    if (o?.hidden) out.hidden = true;
    return out;
  };

  return {
    titleRows: title,
    limits(pageIndex, movementIndex = 0) {
      const { hh, fh } = bands(pageIndex, movementIndex);
      const topUsed = hh ? getStyle(SID.PAGE_HEADER_MARGIN) + hh + space : 0;
      const bottomUsed = fh ? getStyle(SID.PAGE_FOOTER_MARGIN) + fh + space : 0;
      const first = pageBase + pageIndex === 0 ? titleHeight : 0;
      return { top: (Math.max(0, topUsed - margins.top) + first) / space, bottom: Math.max(0, bottomUsed - margins.bottom) / space };
    },
    items(pageIndex, total, movementIndex = 0) {
      const ctx = pageCtx(pageIndex, total, movementIndex);
      const out = [];
      const left = margins.left; const right = geometry.widthMm - margins.right; const mid = (left + right) / 2;
      const xOf = { l: [left, 'start'], c: [mid, 'middle'], r: [right, 'end'] };
      const place = (areas, top, up, role) => {
        for (const a of areas) {
          const lh = sizeMm(a.style.size) * LINE;
          const n = a.lines.length;
          a.lines.forEach((runs, j) => {
            const y = up ? top - (n - j - 1) * lh - lh * 0.22 : top + (j + 0.85) * lh;
            out.push(finish({ x: xOf[a.area][0], y, size: a.style.size, anchor: xOf[a.area][1], runs, role }, a.key, a.style));
          });
        }
      };
      place(areasOf('header', header, ctx), getStyle(SID.PAGE_HEADER_MARGIN), false, 'header');
      place(areasOf('footer', footer, ctx), geometry.heightMm - getStyle(SID.PAGE_FOOTER_MARGIN), true, 'footer');
      if (ctx.pageIndex === 0 && title.rows.length) {
        const { hh } = bands(pageIndex, movementIndex);
        let y = Math.max(margins.top, hh ? getStyle(SID.PAGE_HEADER_MARGIN) + hh + space : 0);
        for (const row of title.rows) {
          for (const cell of row.cells) {
            // several cells on a row (lyricist left, composer right) are bottom aligned
            let top = y + row.height - cell.height;
            for (const ln of cell.lines) {
              const lh = sizeMm(ln.style.size) * LINE;
              const align = ln.style.align ?? cell.align;
              const x = align === 'left' ? left : align === 'right' ? right : mid;
              const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
              out.push(finish({ x, y: top + 0.85 * lh, size: ln.style.size, anchor, runs: [{ text: ln.text, bold: false, italic: false }], role: 'title' }, ln.key, ln.style));
              top += lh;
            }
          }
          y += row.height;
        }
      }
      return out;
    },
  };
}
