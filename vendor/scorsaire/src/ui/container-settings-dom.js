/*
 * Settings panel of a nested score (container), shown at the top of its full-screen editor. Every control is ONE undoable transaction through the
 * Application; nothing here keeps state of the Document (the panel is redrawn from it after every change). Sections depend on the placement:
 * stacked over the measures ('above': aligned or free) or between measures ('between').
 */
import { confirmDialog } from './confirm-dialog.js';
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { createChoiceMenu } from './choice-menu.js';

const TIME_SIGS = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [2, 2], [3, 2], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8]];
const STAFF_TYPES = ['score', 'rhythm', 'tab', 'percussion', 'neutral'];
const LOSS = ['pitchLost', 'chordsCollapsed', 'outOfRange', 'unmapped'];
const keyText = (n) => (n === 0 ? '0' : n > 0 ? `${n} ♯` : `${-n} ♭`);

/**
 * @param {HTMLElement} host
 * @param {object} o  { app, containerId, label, viewId }
 * @returns {{ refresh(): void, destroy(): void }}
 */
export function mountContainerSettings(host, { app, containerId, label, viewId = 'fragment', startOpen = false, onPercmap = null }) {
  const doc = app.doc;
  let open = startOpen;
  let message = '';
  let off = () => {};

  const btn = (text, title, fn, { pressed = null, disabled = false, act = '' } = {}) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
    if (act) b.setAttribute('data-cs', act);
    b.disabled = disabled;
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);padding:0 10px;font:inherit;cursor:pointer;border:1px solid var(--edge,#bbb);border-radius:8px;background:var(--field,#fff)';
    if (pressed !== null) { b.setAttribute('aria-pressed', String(pressed)); if (pressed) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)'; }
    b.addEventListener('click', () => run(fn));
    return b;
  };
  const row = (parent, key) => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center';
    const l = document.createElement('span');
    l.textContent = label(key); l.style.cssText = 'min-width:9em;font-size:13px';
    r.append(l); parent.append(r);
    return r;
  };
  const run = (fn) => {
    try { fn(); message = ''; } catch (e) { message = String(e?.message ?? e); }
    draw();
  };

  const draw = () => {
    const c = doc.find(containerId);
    const fragment = c?.fragments?.[0];
    host.replaceChildren();
    if (!c || !fragment) return;
    const mv = doc.movementOf(c);
    const zone = getProperty(c, PID.CONTAINER_PLACEMENT) === 'zone'; // a cell of a zone of a printed part: like a slot between measures, without width
    const between = zone || getProperty(c, PID.CONTAINER_PLACEMENT) === 'between';
    const free = !between && getProperty(c, PID.CONTAINER_LAYOUT) === 'free';
    const span = getProperty(c, PID.SPAN) ?? 1;
    const n = fragment.masterbars.length;

    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.setAttribute('data-cs', 'toggle'); toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = `${open ? '▾' : '▸'} ${label('cs.title')}`;
    toggle.style.cssText = 'min-height:var(--ui-target,44px);padding:0 12px;font:inherit;font-weight:var(--w-bold,700);cursor:pointer;border:0;background:transparent;text-align:left;width:100%';
    toggle.addEventListener('click', () => { open = !open; draw(); });
    host.append(toggle);
    if (!open) return;

    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:var(--btn-gap,2px);padding:4px 12px 10px';
    host.append(body);

    // staff type of the first staff of the score
    const staff = fragment.tracks[0]?.staves[0];
    if (staff) {
      const r = row(body, 'cs.staffType');
      const current = getProperty(staff, PID.STAFF_TYPE);
      const options = STAFF_TYPES.filter((t) => t === current || (() => { try { app.planStaffType(staff.id, t); return true; } catch { return false; } })()).map((t) => [t, label(`staffType.${t}`)]);
      r.append(createChoiceMenu({ options, value: current, label: label('cs.staffType'), act: 'cs-staff-type', onPick: (t) => changeType(staff.id, t).then(() => { message = ''; draw(); }, (e) => { message = String(e?.message ?? e); draw(); }) }));
    }
    // the percussion map of the score (the sounds, their lines, heads and voices): the same editor as the piece's, opened on the staff of this container
    const percStaff = onPercmap ? fragment.tracks.flatMap((t) => t.staves).find((st) => getProperty(st, PID.STAFF_TYPE) === 'percussion') : null;
    if (percStaff) {
      const r = row(body, 'cs.percmap');
      r.append(btn(label('cs.percmapOpen'), label('cs.percmapOpen'), () => onPercmap(percStaff.id), { act: 'cs-percmap' }));
    }
    // number of staves of the score (a piano = 2): one track, the next staff takes the opposite clef
    if (fragment.tracks.length === 1) {
      const track = fragment.tracks[0];
      const r = row(body, 'cs.staves');
      const count = document.createElement('span'); count.textContent = String(track.staves.length); count.style.cssText = 'min-width:2em;text-align:center';
      const lastClef = getProperty(track.staves[track.staves.length - 1], PID.CLEF) ?? 'G';
      r.append(btn('−', label('cs.stavesLess'), () => app.removeStaff(track.staves[track.staves.length - 1].id), { disabled: track.staves.length <= 1, act: 'cs-staves-less' }), count,
        btn('+', label('cs.stavesMore'), () => app.addStaff(track.id, { type: 'score', clef: lastClef === 'F' ? 'G' : 'F' }), { disabled: track.staves.length >= 4, act: 'cs-staves-more' }));
    }
    // measures
    {
      const r = row(body, 'cs.measures');
      const setN = (k) => (between || free ? app.setFragmentMeasures(containerId, k, viewId) : app.setContainerSpan(containerId, k, viewId));
      const shown = between || free ? n : span;
      const count = document.createElement('span'); count.textContent = String(shown); count.style.cssText = 'min-width:2em;text-align:center';
      r.append(btn('−', label('cs.measuresLess'), () => setN(shown - 1), { disabled: shown <= 1, act: 'cs-measures-less' }), count, btn('+', label('cs.measuresMore'), () => setN(shown + 1), { act: 'cs-measures-more' }));
    }
    if (zone) { /* the width of a zone cell comes from its column */ } else if (between) {
      const width = getProperty(c, PID.CONTAINER_WIDTH) ?? null;
      const w = Math.round((width ?? 6) * 2) / 2;
      const r = row(body, 'cs.width');
      r.append(btn('−', label('container.widthLess'), () => app.setSlotWidth(containerId, Math.max(1, w - 1), viewId), { act: 'cs-width-less' }),
        btn('+', label('container.widthMore'), () => app.setSlotWidth(containerId, w + 1, viewId), { act: 'cs-width-more' }),
        btn('A', label('container.widthAuto'), () => app.setSlotWidth(containerId, null, viewId), { pressed: width === null, act: 'cs-width-auto' }));
    } else {
      const r = row(body, 'cs.layout');
      r.append(btn(label('cs.layout.aligned'), label('cs.layout.aligned'), () => app.setContainerLayout(containerId, 'aligned', viewId), { pressed: !free, act: 'cs-layout-aligned' }),
        btn(label('cs.layout.free'), label('cs.layout.free'), () => app.setContainerLayout(containerId, 'free', viewId), { pressed: free, act: 'cs-layout-free' }));
      if (!free) {
        const own = getProperty(c, PID.CONTAINER_SPACING) === 'document';
        const widen = !!getProperty(c, PID.CONTAINER_WIDEN);
        const rs = row(body, 'cs.spacing');
        rs.append(btn(label('container.spacing.short.chords'), label('container.spacingDocument'), () => app.setContainerSpacing(containerId, { spacing: 'chords' }, viewId), { pressed: !own, act: 'cs-spacing-chords' }),
          btn(label('container.spacing.short.document'), label('container.spacingDocument'), () => app.setContainerSpacing(containerId, { spacing: 'document' }, viewId), { pressed: own, act: 'cs-spacing-document' }),
          btn(label('container.widen.short'), label('container.widen'), () => app.setContainerSpacing(containerId, { widen: !widen }, viewId), { pressed: widen, disabled: own, act: 'cs-widen' }));
      }
    }
    // own signatures
    {
      const showTs = !!getProperty(c, PID.CONTAINER_SHOW_TIMESIG);
      const showKs = !!getProperty(c, PID.CONTAINER_SHOW_KEYSIG);
      const setOwn = (which, on) => (between ? app.setFragmentHeader(containerId, which === 'key' ? { keySig: on } : { timeSig: on }, viewId) : app.setContainerOwnSignature(containerId, which, on, viewId));
      const rt = row(body, 'cs.timeSig');
      rt.append(btn(label(showTs ? 'cs.own' : 'cs.follow'), label('cs.timeSig'), () => setOwn('time', !showTs), { pressed: showTs, act: 'cs-timesig-own' }));
      if (showTs) {
        const cur = getProperty(fragment.masterbars[0], PID.TIME_SIG) ?? [4, 4];
        rt.append(createChoiceMenu({ options: TIME_SIGS.map((t) => [t.join('/'), t.join('/')]), value: cur.join('/'), label: label('cs.timeSig'), act: 'cs-timesig',
          onPick: (v) => run(() => app.setFragmentSignature(containerId, { timeSig: v.split('/').map(Number) }, viewId)) }));
      }
      const rk = row(body, 'cs.keySig');
      rk.append(btn(label(showKs ? 'cs.own' : 'cs.follow'), label('cs.keySig'), () => setOwn('key', !showKs), { pressed: showKs, act: 'cs-keysig-own' }));
      if (showKs) {
        const cur = getProperty(fragment.masterbars[0], PID.KEY_SIG) ?? 0;
        const val = document.createElement('span'); val.textContent = keyText(cur); val.style.cssText = 'min-width:3em;text-align:center'; val.setAttribute('data-cs', 'keysig-value');
        rk.append(btn('−', label('cs.keyLess'), () => app.setFragmentSignature(containerId, { keySig: Math.max(-7, cur - 1) }, viewId), { disabled: cur <= -7, act: 'cs-key-less' }), val,
          btn('+', label('cs.keyMore'), () => app.setFragmentSignature(containerId, { keySig: Math.min(7, cur + 1) }, viewId), { disabled: cur >= 7, act: 'cs-key-more' }));
      }
    }
    {
      const scale = getProperty(c, PID.CONTAINER_SCALE) ?? 1;
      const r = row(body, 'cs.scale');
      const options = [1, 0.85, 0.75, 0.65, 0.5].map((v) => [String(v), `${Math.round(v * 100)} %`]);
      if (!options.some(([v]) => Number(v) === scale)) options.push([String(scale), `${Math.round(scale * 100)} %`]);
      r.append(createChoiceMenu({ options, value: String(scale), label: label('cs.scale'), act: 'cs-scale', onPick: (v) => run(() => app.setContainerScale(containerId, Number(v), viewId)) }));
    }
    if (!between) {
      const follow = getProperty(c, PID.CONTAINER_TRANSPOSE_FOLLOW) !== false;
      const rf = row(body, 'cs.transpose');
      rf.append(btn(label(follow ? 'cs.transpose.follow' : 'cs.transpose.asEntered'), label('cs.transpose'), () => app.setContainerTransposeFollow(containerId, !follow, viewId), { pressed: follow, act: 'cs-transpose' }));
      if (doc.parentOf(c.id)?.type === 'part') { /* a container of a part (screen 2) is only an indication for the player: never played */ } else {
      const mode = getProperty(c, PID.CONTAINER_PLAY) ?? 'none';
      const rp = row(body, 'cs.play');
      rp.append(createChoiceMenu({ options: ['none', 'replace', 'add'].map((m) => [m, label(`cs.play.${m}`)]), value: mode, label: label('cs.play'), act: 'cs-play',
        onPick: (m) => run(() => app.setContainerPlay(containerId, m, viewId)) }));
      if (free) rp.append(Object.assign(document.createElement('span'), { textContent: label('cs.play.freeHint'), style: 'font-size:12px;opacity:.7' }));
      }
    }
    if (message) {
      const m = document.createElement('div');
      m.setAttribute('data-cs', 'message'); m.setAttribute('role', 'alert');
      m.textContent = message; m.style.cssText = 'color:var(--danger-ink,#a00);font-size:13px';
      body.append(m);
    }
  };

  const changeType = async (staffId, to) => {
    const plan = app.planStaffType(staffId, to);
    const options = {};
    if (plan.notes > 0 && plan.confirm.some((k) => LOSS.includes(k))) {
      if (typeof window !== 'undefined' && !(await confirmDialog({ message: label('cs.typeLoss', { n: plan.notes }), label }))) return;
      options.outOfRange = 'remove'; options.unmapped = 'remove';
    }
    app.changeStaffType(staffId, to, options);
  };

  off = doc.subscribe(() => queueMicrotask(draw));
  draw();
  return { refresh: draw, destroy: () => off() };
}
