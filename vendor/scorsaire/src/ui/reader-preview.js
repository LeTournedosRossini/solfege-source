/*
 * PREVIEW of the Lecteur beside screen 2 (tablet mode): the layout being edited shown as a tablet would show it. Two ways, the two the Lecteur has:
 *  - « Fixed pages »: the pages of the layout itself (layoutPart + pageSvg, as the Lecteur draws them when a canvas suits the screen);
 *  - « Automatic »: the Lecteur's own pagination (lecteur/autopages.js, the same code) with the reader settings of the layout and the tracks it shows.
 * The device is a logical screen (the long side is 1180 px, like a tablet) shown reduced to fit the panel. Nothing here changes the work.
 */
import { layoutPart } from '../layout/index.js';
import { pageSvg } from '../render/pagesvg.js';
import { drawAutoPages, showAutoPage } from '../lecteur/autopages.js';
import { partTracksIn, partRatio } from '../lecteur/canvaspick.js';
import { shownNames } from '../lecteur/content.js';
import { readerSettingsOf } from '../model/partreader.js';
import { PID } from '../model/pid.js';
import { ZOOM_MIN, ZOOM_MAX, TRANSPOSE_MIN, TRANSPOSE_MAX } from '../model/recueil.js';
import { KINDS, resolveShown } from '../lecteur/content.js';
import { readerTweak } from '../lecteur/autopages.js';
import { CONTAINER_CATEGORIES, DEFAULT_CONTAINERS, CARD_MODES, SPACING_MIN, SPACING_MAX, PER_ROW_MAX, CARD_SCALE_MIN, CARD_SCALE_MAX, CARD_GAP_MIN, CARD_GAP_MAX } from '../model/partreader.js';
import { getProperty } from '../model/props.js';

const LONG_SIDE = 1180;
/** Screens to try: the shape of the canvas, then the usual ones (width / height). */
/** What the preview takes from the layout, and what the person can try on top of it (like the device of a musician): `sim` wins over the layout's own reader settings. */
const effective = (part, sim) => ({ ...readerSettingsOf(part), ...sim });
const FORMATS = [['canvas', null], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:10', 16 / 10], ['10:16', 10 / 16], ['5:3', 5 / 3], ['3:5', 3 / 5], ['16:9', 16 / 9], ['9:16', 9 / 16]];

export function createReaderPreview({ app, label, glyphs, getPart, isVisible = () => true, cache = null, revision = () => '', mountIn = document.body }) {
  const state = { open: false, tuning: false, sim: {}, zoom: 1, mode: 'fixed', format: 'canvas', movement: 0, page: 0, pages: 0 };
  let panel = null; let body = null; let status = null; let timer = null; let watch = null;
  let laid = null; // the layout of the part last made: { key, res } (a page turn or a change of format does not lay it out again)
  let drawnKey = null; // what the panel shows now: nothing to redo while it stays the same
  const el = (tag, css = '', attrs = {}, ...kids) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
  const btn = (text, act, fn, pressed = null) => { const b = el('button', 'padding:4px 10px;min-height:30px', { type: 'button', 'data-act': act }, text); if (pressed !== null) { b.setAttribute('aria-pressed', String(pressed)); if (pressed) b.style.cssText += ';font-weight:600;outline:2px solid var(--ink,#111)'; } b.addEventListener('click', fn); return b; };

  const device = (part) => {
    const ratio = state.format === 'canvas' || !FORMATS.find(([k]) => k === state.format)?.[1] ? partRatio(part) : FORMATS.find(([k]) => k === state.format)[1];
    return ratio >= 1 ? { w: LONG_SIDE, h: Math.round(LONG_SIDE / ratio) } : { w: Math.round(LONG_SIDE * ratio), h: LONG_SIDE };
  };

  const viewKey = (part) => `${revision()}|${part?.id}|${state.mode}|${state.format}|${state.movement}|${state.page}|${JSON.stringify(state.sim)}|${panel?.clientWidth}x${panel?.clientHeight}`;
  function render() {
    const part = getPart();
    if (!state.open || !panel) return;
    const work = app.doc.work;
    if (!part || !getProperty(part, PID.PART_CANVAS)) { body.replaceChildren(el('p', 'padding:12px;opacity:.7', {}, label('preview.none'))); status.textContent = ''; return; }
    state.movement = Math.min(state.movement, work.movements.length - 1);
    const movement = work.movements[state.movement];
    const dev = device(part);
    const area = body.getBoundingClientRect();
    const k = Math.min((area.width - 8) / dev.w, (area.height - 8) / dev.h, 1);
    const frame = el('div', `position:relative;width:${dev.w * k}px;height:${dev.h * k}px;margin:4px auto;border:1px solid var(--edge,#888);background:var(--score,#fff);overflow:hidden`, { 'data-preview-frame': '' });
    const screen = el('div', `position:absolute;left:0;top:0;width:${dev.w}px;height:${dev.h}px;transform:scale(${k});transform-origin:0 0`);
    frame.append(screen);
    body.replaceChildren(frame);
    let pages = 0;
    try {
      // like the Lecteur: a zoom other than 100 % is never a fixed page (the layout of the author is for the size it was made for)
      const sim = state.sim;
      const eff = effective(part, sim);
      const kinds = sim.kinds ?? [];
      const tracks = kinds.length ? resolveShown(movement, kinds, {}).tracks : partTracksIn(work, part, movement);
      const transpose = sim.transpose ?? 0;
      if (state.mode === 'fixed' && state.zoom === 1 && transpose === 0 && !kinds.length) {
        const tweak = readerTweak({ cards: sim.cards ?? null, spacing: sim.spacing ?? 1, cardScale: sim.cardScale ?? 1, cardGap: sim.cardGap ?? 1, tempo: eff.tempo === true });
        const layKey = `${revision()}|${part.id}|${sim.cards}|${sim.spacing}|${sim.cardScale}|${sim.cardGap}|${eff.tempo}`;
        if (laid?.key !== layKey) laid = { key: layKey, res: layoutPart(work, part, glyphs, { partName: part.props[PID.NAME] ?? '', today: '', cache: tweak ? null : cache, tweak }) };
        const res = laid.res;
        const mine = res.pages.filter((p) => p.movementIndex === state.movement);
        pages = mine.length;
        state.page = Math.max(0, Math.min(state.page, pages - 1));
        const p = mine[state.page];
        if (p) {
          const kk = Math.min(dev.w / res.geometry.widthMm, (dev.h - 6) / res.geometry.heightMm);
          const holder = el('div', `position:relative;margin:6px auto 0;overflow:hidden;width:${res.geometry.widthMm * kk}px;height:${res.geometry.heightMm * kk}px`);
          holder.innerHTML = pageSvg(p, res.geometry, glyphs, { dark: document.documentElement.hasAttribute('data-dark') });
          const svg = holder.firstChild; svg.setAttribute('width', String(res.geometry.widthMm * kk)); svg.setAttribute('height', String(res.geometry.heightMm * kk));
          screen.append(holder);
        }
      } else {
        const holder = el('div', 'overflow:hidden;position:relative;margin-top:6px');
        screen.append(holder);
        const height = dev.h - 6;
        const { shown, pages: list } = drawAutoPages(holder, { work, movement, tracks, transpose, zoom: state.zoom, width: dev.w, height, settings: eff });
        pages = list.length;
        state.page = Math.max(0, Math.min(state.page, pages - 1));
        showAutoPage(holder, shown, list[state.page], height);
      }
    } catch (e) { body.replaceChildren(el('p', 'padding:12px;color:var(--danger-ink,#a33)', {}, e?.message ?? String(e))); }
    state.pages = pages;
    // the small grey line at the very bottom of the screen, over the page (it takes no room): the same as the Lecteur's, so the preview shows what the person will read
    if (pages) {
      const scope = state.mode === 'fixed' && state.zoom === 1 && !(state.sim.transpose) && !(state.sim.kinds?.length) ? [app.canvases().find((c) => c.id === getProperty(part, PID.PART_CANVAS))?.name, part.props[PID.NAME]].filter(Boolean).join(' · ') : shownNames(movement, state.sim.kinds?.length ? resolveShown(movement, state.sim.kinds, {}).tracks : partTracksIn(work, part, movement));
      const title = getProperty(work, PID.TITLE) || '';
      screen.append(el('div', 'position:absolute;left:0;right:0;bottom:1px;z-index:10;text-align:center;font-size:12px;line-height:1.1;opacity:.45;pointer-events:none', { 'data-preview-foot': '' }, [title, scope, label('preview.pageOf', { n: state.page + 1, total: pages })].filter(Boolean).join(' · ')));
    }
    drawnKey = viewKey(part);
    status.textContent = pages ? label('preview.pageOf', { n: state.page + 1, total: pages }) + (state.mode === 'fixed' && (state.zoom !== 1 || state.sim.transpose || state.sim.kinds?.length) ? ` — ${label('preview.zoomAuto')}` : '') : '';
  }

  const refresh = () => { if (!state.open || viewKey(getPart()) === drawnKey) return; clearTimeout(timer); timer = setTimeout(render, 120); }; // (the document changes in bursts; a redraw of screen 2 that changes nothing for the preview costs nothing)
  const go = (d) => { state.page = Math.max(0, Math.min(state.page + d, state.pages - 1)); render(); };

  function buildPanel() {
    const work = () => app.doc.work;
    const head = el('div', 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--edge,#888)');
    const draw = () => {
      const fmt = el('select', 'min-height:30px', { 'data-field': 'preview-format', 'aria-label': label('preview.format') }, ...FORMATS.map(([k]) => { const o = el('option', '', { value: k }, k === 'canvas' ? label('preview.formatCanvas') : k); return o; }));
      fmt.value = state.format; fmt.addEventListener('change', () => { state.format = fmt.value; state.page = 0; render(); });
      const mv = work().movements.length > 1 ? el('select', 'min-height:30px', { 'data-field': 'preview-movement', 'aria-label': label('preview.movement') }, ...work().movements.map((m, i) => el('option', '', { value: String(i) }, getProperty(m, PID.TITLE) || `${i + 1}`))) : null;
      if (mv) { mv.value = String(state.movement); mv.addEventListener('change', () => { state.movement = Number(mv.value); state.page = 0; render(); }); }
      head.replaceChildren(
        el('strong', 'flex:1;font-size:14px', {}, label('preview.title')),
        btn('×', 'preview-close', () => close()),
        el('div', 'flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px;align-items:center', {},
          btn(label('preview.fixed'), 'preview-fixed', () => { state.mode = 'fixed'; state.page = 0; draw(); render(); }, state.mode === 'fixed'),
          btn(label('preview.auto'), 'preview-auto', () => { state.mode = 'auto'; state.page = 0; draw(); render(); }, state.mode === 'auto'), fmt, ...(mv ? [mv] : [])),
        el('div', 'flex-basis:100%;display:flex;gap:6px;align-items:center', { 'data-preview-zoom': '' }, btn(label('preview.tune'), 'preview-tune', () => { state.tuning = !state.tuning; draw(); drawTuning(); render(); }, state.tuning), el('span', '', {}, label('preview.zoom')),
          btn('−', 'preview-zoom-minus', () => zoomTo(state.zoom - 0.1)), el('span', 'min-width:3.5em;text-align:center', { 'data-preview-zoom-value': '' }, `${Math.round(state.zoom * 100)} %`), btn('+', 'preview-zoom-plus', () => zoomTo(state.zoom + 0.1)),
          btn('100 %', 'preview-zoom-reset', () => zoomTo(1))));
    };
    // the settings of the Lecteur to try here: what the musician would change on the device (not the songs: this is one layout)
    const tuning = el('div', 'display:none;max-height:42%;overflow:auto;padding:6px 8px;border-bottom:1px solid var(--edge,#888);gap:8px;flex-direction:column', { 'data-preview-tuning': '' });
    const setSim = (patch) => { for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete state.sim[k]; else state.sim[k] = v; } state.page = 0; drawTuning(); render(); };
    const drawTuning = () => {
      tuning.style.display = state.tuning ? 'flex' : 'none';
      if (!state.tuning) return;
      const part = getPart(); if (!part) return;
      const eff = effective(part, state.sim); const sim = state.sim;
      const row = (title, ...kids) => el('div', 'display:flex;flex-wrap:wrap;gap:6px;align-items:center', {}, el('span', 'font-size:12px;opacity:.7;min-width:6.5em', {}, title), ...kids);
      const step = (act, value, text, onMinus, onPlus, minOff, maxOff) => [btn('−', `${act}-minus`, onMinus), el('span', 'min-width:3.5em;text-align:center', { [`data-${act}-value`]: '' }, text), btn('+', `${act}-plus`, onPlus)];
      const containers = eff.containers ?? DEFAULT_CONTAINERS;
      const sp = eff.spacing ?? 1; const per = eff.perRow ?? 0; const tr = sim.transpose ?? 0;
      tuning.replaceChildren(
        row(label('preview.tune.kinds'), btn(label('lecteur.kind.all'), 'tune-kind-all', () => setSim({ kinds: null }), !(sim.kinds?.length)), ...KINDS.map((k) => btn(label(`lecteur.kind.${k}`), `tune-kind-${k}`, () => { const cur = sim.kinds ?? []; const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]; setSim({ kinds: next.length ? next : null }); }, (sim.kinds ?? []).includes(k)))),
        row(label('lecteur.containers'), ...CONTAINER_CATEGORIES.map((c) => btn(label(`lecteur.container.${c}`), `tune-container-${c}`, () => setSim({ containers: containers.includes(c) ? containers.filter((x) => x !== c) : [...containers, c] }), containers.includes(c)))),
        row(label('lecteur.cards'), btn(label('lecteur.cards.default'), 'tune-cards-default', () => setSim({ cards: null }), sim.cards === undefined), ...CARD_MODES.map((m) => btn(label(`lecteur.cards.${m}`), `tune-cards-${m}`, () => setSim({ cards: m }), sim.cards === m))),
        row(label('lecteur.cardScale'), ...step('tune-cardscale', 1, `${Math.round((eff.cardScale ?? 1) * 100)} %`, () => setSim({ cardScale: Math.max(CARD_SCALE_MIN, Math.round(((eff.cardScale ?? 1) - 0.1) * 100) / 100) }), () => setSim({ cardScale: Math.min(CARD_SCALE_MAX, Math.round(((eff.cardScale ?? 1) + 0.1) * 100) / 100) }))),
        row(label('lecteur.cardGap'), ...step('tune-cardgap', 1, `${Math.round((eff.cardGap ?? 1) * 100)} %`, () => setSim({ cardGap: Math.max(CARD_GAP_MIN, Math.round(((eff.cardGap ?? 1) - 0.1) * 100) / 100) }), () => setSim({ cardGap: Math.min(CARD_GAP_MAX, Math.round(((eff.cardGap ?? 1) + 0.1) * 100) / 100) }))),
        row(label('lecteur.tempo'), btn(label('parts.reader.no'), 'tune-tempo-no', () => setSim({ tempo: false }), eff.tempo !== true), btn(label('parts.reader.yes'), 'tune-tempo-yes', () => setSim({ tempo: true }), eff.tempo === true)),
        row(label('lecteur.regular'), btn(label('preview.tune.layout'), 'tune-regular-default', () => setSim({ regular: null }), sim.regular === undefined), btn(label('parts.reader.yes'), 'tune-regular-yes', () => setSim({ regular: true }), sim.regular === true), btn(label('parts.reader.no'), 'tune-regular-no', () => setSim({ regular: false }), sim.regular === false)),
        row(label('lecteur.perRow'), ...step('tune-perrow', per, per ? String(per) : label('lecteur.auto'), () => setSim({ perRow: per <= 1 ? null : per - 1 }), () => setSim({ perRow: Math.min(PER_ROW_MAX, per + 1) }))),
        row(label('lecteur.spacing'), ...step('tune-spacing', sp, `${Math.round(sp * 100)} %`, () => setSim({ spacing: Math.max(SPACING_MIN, Math.round((sp - 0.1) * 100) / 100) }), () => setSim({ spacing: Math.min(SPACING_MAX, Math.round((sp + 0.1) * 100) / 100) }))),
        row(label('lecteur.transpose'), ...step('tune-transpose', tr, tr > 0 ? `+${tr}` : String(tr), () => setSim({ transpose: Math.max(TRANSPOSE_MIN, tr - 1) || null }), () => setSim({ transpose: Math.min(TRANSPOSE_MAX, tr + 1) || null }))),
        row('', btn(label('preview.tune.reset'), 'tune-reset', () => { state.sim = {}; state.page = 0; drawTuning(); render(); })));
    };
    const zoomTo = (z) => { state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100)); state.page = 0; draw(); render(); };
    draw(); drawTuning();
    body = el('div', 'flex:1;min-height:0;overflow:auto;padding:4px', { 'data-preview-body': '' });
    status = el('span', 'flex:1;text-align:center;font-size:13px', { 'data-preview-status': '' });
    const foot = el('div', 'display:flex;gap:6px;align-items:center;padding:6px 8px;border-top:1px solid var(--edge,#888)', {}, btn('◀', 'preview-prev', () => go(-1)), status, btn('▶', 'preview-next', () => go(1)));
    panel = el('div', 'position:fixed;right:8px;top:56px;bottom:8px;width:min(440px,45vw);z-index:900;display:flex;flex-direction:column;background:var(--paper,#faf8f4);color:var(--ink,#111);border:1px solid var(--edge,#888);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px var(--ui-font,sans-serif)', { 'data-reader-preview': '', role: 'complementary', 'aria-label': label('preview.title') }, head, tuning, body, foot);
    mountIn.append(panel);
  }
  // the panel belongs to screen 2: it hides with it
  const follow = () => { if (panel) { const v = isVisible(); panel.style.display = v ? 'flex' : 'none'; if (v && !panel.dataset.shown) { panel.dataset.shown = '1'; render(); } if (!v) delete panel.dataset.shown; } };
  function open() { if (state.open) return; state.open = true; buildPanel(); render(); watch = setInterval(follow, 400); }
  function close() { state.open = false; clearTimeout(timer); clearInterval(watch); panel?.remove(); panel = null; }
  return { open, close, toggle: () => (state.open ? close() : open()), isOpen: () => state.open, refresh };
}
