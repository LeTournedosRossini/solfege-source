/*
 * Display controls of one track, shared by the three screens: a button that opens the DISPLAY MENU (show / hide and recolour the lines, bars, clefs, signatures,
 * notes, rests, automatic rests, dynamics, articulations, slurs, and colour the whole track) and the size in %.
 * The caller says which layer it edits: `own` = what that layer stores ({ showBars?, sizePct?, show?, colors? } or null), `base` = what applies when it stores
 * nothing (the layer below, resolved). `onSet(patch)` receives { showBars?, sizePct?, show?, colors? } (null = back to the layer below; `show` / `colors` are
 * the WHOLE sub-object).
 */
import { SIZE_MIN, SIZE_MAX, DISPLAY_CATEGORIES } from '../model/trackdisplay.js';
import { icon } from './icons.js';
import { createScrubPill } from './scrub-pill.js';
import { dismissOnOutside } from './outside-dismiss.js';

const STEP = 10;
/** Quick colours (red, green, blue); "normal" removes the colour. A free colour is one press away. */
export const QUICK_COLORS = Object.freeze(['#d32f2f', '#2e7d32', '#1565c0']);

const mk = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; n.setAttribute(k, v === true ? '' : String(v)); } n.append(...kids.flat().filter((c) => c != null)); return n; };
const isEmptyLayer = (own) => !own || (own.showBars == null && own.sizePct == null && own.slashes == null && !Object.keys(own.show ?? {}).length && !Object.keys(own.colors ?? {}).length);

/**
 * Opens the menu under `anchor`. `getLayers()` returns the CURRENT { own, base } (the menu redraws itself after each change, the panel behind it may be rebuilt).
 * Returns { close }.
 */
export function openDisplayMenu({ anchor, label, getLayers, onSet, slashes = null }) {
  let open = true;
  const box = mk('div', { role: 'dialog', 'aria-label': label('trackDisplay.menu'), 'data-display-menu': '', 'data-zoom-lock': '' });
  box.style.cssText = 'position:fixed;z-index:3000;background:var(--paper,#faf8f4);color:var(--ink,#111);border:1px solid var(--edge,#888);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.35);padding:8px;font:14px var(--ui-font,sans-serif);display:flex;flex-direction:column;gap:var(--btn-gap,2px);max-height:80vh;overflow:auto;max-width:min(94vw,420px)';
  const eff = (cat) => {
    const { own, base } = getLayers();
    if (cat === 'bars') return (own?.showBars ?? base.showBars ?? true) !== false;
    return (own?.show?.[cat] ?? base.show?.[cat] ?? true) !== false;
  };
  const colorOf = (key) => { const { own, base } = getLayers(); return own?.colors?.[key] ?? base.colors?.[key] ?? null; };
  const own = () => getLayers().own ?? {};
  const setShow = (cat, v) => {
    if (cat === 'bars') { onSet({ showBars: v }); return; }
    const next = { ...(own().show ?? {}), [cat]: v };
    onSet({ show: next });
  };
  const setColor = (key, c) => {
    const next = { ...(own().colors ?? {}) };
    if (c) next[key] = c; else delete next[key];
    onSet({ colors: Object.keys(next).length ? next : null });
  };
  const swatch = (key, c) => {
    const b = mk('button', { type: 'button', 'data-color': c ?? 'none', 'aria-label': c ?? label('trackDisplay.colorNormal'), title: c ? c : label('trackDisplay.colorNormal'), 'data-no-icon': '', 'aria-pressed': String((colorOf(key) ?? null) === c) });
    b.style.cssText = `width:24px;height:24px;min-width:24px;min-height:24px;padding:0;border-radius:50%;border:2px solid ${colorOf(key) === c ? '#111' : '#aaa'};background:${c ?? 'linear-gradient(135deg,#fff 45%,#d33 45%,#d33 55%,#fff 55%)'}`;
    b.addEventListener('click', () => { setColor(key, c); redraw(); });
    return b;
  };
  const free = (key) => {
    const cur = colorOf(key);
    const input = mk('input', { type: 'color', 'data-color-free': key, 'aria-label': label('trackDisplay.colorFree'), title: label('trackDisplay.colorFree'), value: cur && !QUICK_COLORS.includes(cur) ? cur : '#808080' });
    input.style.cssText = 'width:24px;height:24px;min-width:24px;padding:0;border:2px solid #aaa;border-radius:50%;background:none';
    input.addEventListener('change', () => { setColor(key, input.value); redraw(); });
    return input;
  };
  const colors = (key) => mk('span', { style: 'display:inline-flex;gap:4px;align-items:center' }, swatch(key, null), ...QUICK_COLORS.map((c) => swatch(key, c)), free(key));
  const row = (cat) => {
    const on = eff(cat);
    const eye = mk('button', { type: 'button', 'data-cat': cat, 'data-no-icon': '', 'aria-pressed': String(on), title: label(on ? 'trackDisplay.hide' : 'trackDisplay.show'), 'aria-label': label(on ? 'trackDisplay.hide' : 'trackDisplay.show') });
    eye.append(icon(on ? 'eye' : 'eye-off'));
    eye.addEventListener('click', () => { setShow(cat, !on); redraw(); });
    return mk('div', { style: 'display:flex;align-items:center;gap:6px;opacity:' + (on ? '1' : '.6') }, eye, mk('span', { style: 'flex:1;min-width:6em' }, label(`trackDisplay.cat.${cat}`)), colors(cat));
  };
  // slashes: one slash per beat instead of the notes of chosen measures. `slashes` = { ids (measure ids), staves [{ id, type, index }], ranges (the measures can be chosen here: screens 1 and 2),
  // explicitEmpty (the layer is above another one: "none" must be stored to override it) }. A sheet (screen 3) only follows screen 1 or hides them.
  const slashList = () => { const { own: o, base } = getLayers(); return o?.slashes ?? base.slashes ?? []; };
  const setSlashes = (list) => { const { base } = getLayers(); onSet({ slashes: list.length ? list : (slashes.explicitEmpty && base.slashes?.length ? [] : null) }); };
  const slashState = { staff: null, from: 0, to: 0 };
  function slashSection() {
    const list = slashList();
    const wrap = mk('div', { 'data-slashes': '', style: 'display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--edge,#c9c4b8);padding-top:6px;margin-top:2px' });
    wrap.append(mk('div', { style: 'font-weight:var(--w-semi,600)' }, label('trackDisplay.slashes')));
    if (!slashes.ranges) { // a sheet: follows screen 1 (nothing stored) or shows no slashes
      const none = getLayers().own?.slashes != null;
      const sw = mk('button', { type: 'button', 'data-act': 'slashes-follow', 'data-no-icon': '', 'aria-pressed': String(none), title: label('trackDisplay.slashesSheetHint') }, none ? label('trackDisplay.slashesNone') : label('trackDisplay.slashesFollow'));
      sw.addEventListener('click', () => { onSet({ slashes: none ? null : [] }); redraw(); });
      wrap.append(sw);
      return wrap;
    }
    const numberOf = (id) => slashes.ids.indexOf(id) + 1;
    const nameOf = (st) => `${label(`staffType.${st.type}`)}${slashes.staves.length > 1 ? ` ${st.index + 1}` : ''}`;
    list.forEach((r, k) => {
      const st = slashes.staves.find((x) => x.id === r.staff);
      const line = mk('div', { style: 'display:flex;align-items:center;gap:6px', 'data-slash-range': String(k) });
      const rm = mk('button', { type: 'button', 'data-act': 'slash-remove', 'data-no-icon': '', 'aria-label': label('trackDisplay.slashRemove'), title: label('trackDisplay.slashRemove') }, '✕');
      rm.addEventListener('click', () => { setSlashes(list.filter((_, i) => i !== k)); redraw(); });
      line.append(mk('span', { style: 'flex:1' }, `${st ? nameOf(st) : '—'} · ${label('trackDisplay.slashMeasures', { a: numberOf(r.from), b: numberOf(r.to) })}`), rm);
      wrap.append(line);
    });
    if (!list.length) wrap.append(mk('div', { style: 'font-size:12px;color:var(--ink-soft,#555)' }, label('trackDisplay.slashesEmpty')));
    if (!slashState.staff || !slashes.staves.some((x) => x.id === slashState.staff)) slashState.staff = slashes.staves[0]?.id ?? null;
    slashState.from = Math.min(Math.max(slashState.from, 0), slashes.ids.length - 1); slashState.to = Math.min(Math.max(slashState.to, slashState.from), slashes.ids.length - 1);
    const stepper = (text, value, set) => {
      const minus = mk('button', { type: 'button', 'data-no-icon': '', 'aria-label': '−' }, '−'); minus.addEventListener('click', () => { set(value - 1); redraw(); });
      const plus = mk('button', { type: 'button', 'data-no-icon': '', 'aria-label': '+' }, '+'); plus.addEventListener('click', () => { set(value + 1); redraw(); });
      return mk('span', { style: 'display:inline-flex;align-items:center;gap:4px' }, mk('span', {}, text), minus, mk('span', { style: 'min-width:2.4em;text-align:center' }, String(value + 1)), plus);
    };
    const add = mk('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:8px' });
    if (slashes.staves.length > 1) {
      const pick = mk('button', { type: 'button', 'data-act': 'slash-staff', 'data-no-icon': '' }, nameOf(slashes.staves.find((x) => x.id === slashState.staff) ?? slashes.staves[0]));
      pick.addEventListener('click', () => { const at = slashes.staves.findIndex((x) => x.id === slashState.staff); slashState.staff = slashes.staves[(at + 1) % slashes.staves.length].id; redraw(); });
      add.append(pick);
    }
    add.append(stepper(label('trackDisplay.slashFrom'), slashState.from, (v) => { slashState.from = Math.max(0, Math.min(slashes.ids.length - 1, v)); slashState.to = Math.max(slashState.to, slashState.from); }),
      stepper(label('trackDisplay.slashTo'), slashState.to, (v) => { slashState.to = Math.max(slashState.from, Math.min(slashes.ids.length - 1, v)); }));
    const addBtn = mk('button', { type: 'button', 'data-act': 'slash-add', 'data-no-icon': '', disabled: !slashState.staff }, `＋ ${label('trackDisplay.slashAdd')}`);
    addBtn.addEventListener('click', () => { setSlashes([...slashList(), { staff: slashState.staff, from: slashes.ids[slashState.from], to: slashes.ids[slashState.to] }]); redraw(); });
    add.append(addBtn);
    wrap.append(add);
    return wrap;
  }
  function redraw() {
    box.replaceChildren(
      mk('div', { style: 'display:flex;align-items:center;gap:6px;font-weight:var(--w-semi,600)' }, mk('span', { style: 'flex:1' }, label('trackDisplay.allTrack')), colors('all')),
      ...DISPLAY_CATEGORIES.map(row),
      ...(slashes ? [slashSection()] : []),
      (() => {
        const bar = mk('div', { style: 'display:flex;gap:var(--btn-gap,2px);justify-content:flex-end;margin-top:4px' });
        const reset = mk('button', { type: 'button', 'data-act': 'display-reset-all', 'data-no-icon': '', disabled: isEmptyLayer(getLayers().own) }, label('trackDisplay.resetAll'));
        reset.addEventListener('click', () => { onSet({ showBars: null, sizePct: null, show: null, colors: null, ...(slashes ? { slashes: null } : {}) }); redraw(); });
        const close = mk('button', { type: 'button', 'data-act': 'display-close', 'data-no-icon': '' }, label('trackDisplay.close'));
        close.addEventListener('click', () => api.close());
        bar.append(reset, close);
        return bar;
      })(),
    );
  }
  const api = {
    close() { if (!open) return; open = false; off(); document.removeEventListener('keydown', onKey, true); box.remove(); },
    box,
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } };
  redraw();
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth; const h = box.offsetHeight;
  box.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, r.left))}px`;
  box.style.top = `${Math.max(6, Math.min(window.innerHeight - h - 6, r.bottom + 4))}px`;
  // the button that opened it, and the colour picker the browser draws, are not "outside"
  const off = dismissOnOutside(() => box, () => api.close());
  document.addEventListener('keydown', onKey, true);
  return api;
}

export function trackDisplayRow({ label, own, base, sizeable, onSet, slashes = null, className = 'tp-row tp-meta' }) {
  const size = own?.sizePct ?? base.sizePct;
  const btn = (text, title, act, handler, attrs = {}) => { const b = mk('button', { type: 'button', title, 'aria-label': title, 'data-act': act, 'data-no-icon': '', ...attrs }, text); b.addEventListener('click', handler); return b; };
  const row = mk('div', { class: className, 'data-track-display': '' });
  row.append(mk('span', { class: 'tp-meta-label' }, label('trackDisplay.label')));
  // the menu keeps its own copy of the layer: the panel behind may be rebuilt after every change
  let current = { own: own ?? null, base };
  const menuBtn = btn('', label('trackDisplay.menu'), 'display-menu', () => {
    openDisplayMenu({
      anchor: menuBtn, label, getLayers: () => current, slashes,
      onSet: (patch) => {
        const next = { ...(current.own ?? {}) };
        for (const [k, v] of Object.entries(patch)) { if (v == null) delete next[k]; else next[k] = v; }
        current = { own: Object.keys(next).length ? next : null, base };
        onSet(patch);
      },
    });
  });
  menuBtn.append(icon('eye'));
  row.append(menuBtn);
  const mouse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;
  if (sizeable && mouse) {
    // computers: a pill to drag (up / down) or press for a stepper, the value in % (decided with Jean, 25/10/2026)
    const pill = createScrubPill({ min: SIZE_MIN, max: SIZE_MAX, value: size, step: 5, pxPerStep: 3, format: (v) => `${v} %`, title: label('trackDisplay.size'), onCommit: (v) => onSet({ sizePct: v }) });
    pill.el.setAttribute('data-display-size', String(size)); pill.el.style.minWidth = '4.2em'; pill.el.style.fontSize = '13px';
    row.append(pill.el);
  } else if (sizeable) {
    row.append(btn('−', label('trackDisplay.smaller'), 'display-smaller', () => onSet({ sizePct: Math.max(SIZE_MIN, size - STEP) }), size <= SIZE_MIN ? { disabled: '' } : {}));
    row.append(mk('span', { class: 'tp-meta-label', 'data-display-size': String(size), style: 'min-width:3.5em;text-align:center' }, `${size} %`));
    row.append(btn('+', label('trackDisplay.larger'), 'display-larger', () => onSet({ sizePct: Math.min(SIZE_MAX, size + STEP) }), size >= SIZE_MAX ? { disabled: '' } : {}));
  }
  if (!isEmptyLayer(own)) row.append(btn('↺', label('trackDisplay.reset'), 'display-reset', () => onSet({ showBars: null, sizePct: null, show: null, colors: null, ...(slashes ? { slashes: null } : {}) })));
  return row;
}
