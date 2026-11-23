/*
 * "New part" dialog (screen 2): choose which EXISTING staves the part shows, give it a name, press OK. Two shortcuts: "Each" creates one part per track (named after
 * the track); a two-state button beside it puts the chord track first in every one of those parts. Nothing is written here: `onCreate(parts)` receives
 * `[{ name, staffIds }]` and the caller writes them in ONE transaction. A bottom sheet on phones / tablets, a centred window on a computer.
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); }
  n.append(...kids.flat().filter((x) => x != null && x !== false).map((x) => (x.nodeType ? x : document.createTextNode(String(x)))));
  return n;
};

/** Pure: the parts "Each" creates from the outline of the tracks (`includeChord`: the chord track's staves first in every part but its own). */
export function eachTrackParts(outline, { includeChord = false } = {}) {
  const tracks = outline.flatMap((mv) => mv.tracks);
  const chord = tracks.find((t) => t.chord);
  return tracks.map((t, i) => ({
    name: t.name || `${i + 1}`,
    staffIds: [...(includeChord && chord && chord !== t ? chord.staves.map((s) => s.id) : []), ...t.staves.map((s) => s.id)],
  }));
}

/** Pure: one part PER chosen staff (named after its track), the chord track's staves first when asked (not in the part of the chord track itself). */
export function splitParts(outline, pickedIds, { includeChord = false } = {}) {
  const tracks = outline.flatMap((mv) => mv.tracks);
  const chord = tracks.find((t) => t.chord);
  const out = [];
  tracks.forEach((t, i) => {
    for (const st of t.staves) {
      if (!pickedIds.has(st.id)) continue;
      out.push({ name: (t.name || `${i + 1}`) + (t.staves.length > 1 ? ` · ${t.staves.indexOf(st) + 1}` : ''), staffIds: [...(includeChord && chord && chord !== t ? chord.staves.map((x) => x.id) : []), st.id] });
    }
  });
  return out;
}

/** @returns { close() } */
export function openNewPartDialog({ outline, label = (k) => k, defaultName = '', onCreate }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const picked = new Set();
  let includeChord = false;
  let split = false; // false = ONE part with every chosen staff; true = one part PER chosen staff
  let message = '';
  const veil = el('div', { 'data-new-part': '', 'data-zoom-lock': '', style: `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}` });
  const box = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('parts.newDialog.title'), style: `background:var(--paper,#fff);color:var(--ink,#111);padding:14px;font:15px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;display:flex;flex-direction:column;gap:8px;max-height:${sheet ? '88vh' : '80vh'};overflow:auto;${sheet ? 'width:100%;border-radius:12px 12px 0 0' : 'width:min(480px,94vw);border-radius:10px'}` });
  veil.append(box);
  const name = el('input', { type: 'text', 'data-key': 'new-part-name', value: defaultName, placeholder: label('parts.newDialog.name'), 'aria-label': label('parts.newDialog.name'), autocomplete: 'off', spellcheck: 'false', style: 'min-height:var(--ui-target,30px);font:16px var(--ui-font,sans-serif);padding:0 8px;border:1px solid var(--edge,#bbb);border-radius:6px;box-sizing:border-box;width:100%' });
  const done = (parts) => { close(); onCreate(parts); };
  const staffButton = (track, staff, k) => {
    const text = track.staves.length > 1 ? `${track.name || label('tracks.defaultName', { n: track.index + 1 })} · ${label(`staffType.${staff.type}`).replace(/\s*\(.*\)\s*$/, '')}` : (track.name || label('tracks.defaultName', { n: track.index + 1 }));
    const b = el('button', { type: 'button', 'data-staff': staff.id, 'aria-pressed': String(picked.has(staff.id)), style: `text-align:left;min-height:var(--ui-target,30px);padding:0 10px;font:inherit;border:1px solid ${picked.has(staff.id) ? '#2a2723' : '#ccc'};border-radius:8px;background:${picked.has(staff.id) ? '#3a3733' : 'var(--btn,#fdfcfa)'};color:${picked.has(staff.id) ? '#fff' : 'inherit'};font-weight:${picked.has(staff.id) ? '600' : 'normal'};cursor:pointer`,
      onclick: () => { if (picked.has(staff.id)) picked.delete(staff.id); else picked.add(staff.id); message = ''; draw(); } }, text);
    void k;
    return b;
  };
  function draw() {
    const rows = [];
    outline.forEach((mv, mi) => {
      if (outline.length > 1) rows.push(el('div', { style: 'font-weight:var(--w-semi,600);color:var(--ink-soft,#555);padding-top:4px' }, mv.title || label('tracks.movement', { n: mi + 1 })));
      for (const track of mv.tracks) for (const [k, staff] of track.staves.entries()) rows.push(staffButton(track, staff, k));
    });
    const each = el('button', { type: 'button', 'data-act': 'new-part-each', title: label('parts.newDialog.eachHint'), style: 'min-height:var(--ui-target,30px);padding:0 12px;font:inherit;border:1px solid var(--edge,#888);border-radius:8px;background:var(--btn,#fdfcfa);cursor:pointer',
      onclick: () => done(eachTrackParts(outline, { includeChord })) }, label('parts.newDialog.each'));
    const chord = el('button', { type: 'button', 'data-act': 'new-part-chord', 'aria-pressed': String(includeChord), title: label('parts.newDialog.withChordHint'), style: 'min-height:var(--ui-target,30px);padding:0 12px;font:inherit;border:1px solid var(--edge,#bbb);border-radius:8px;background:var(--btn,#fdfcfa);cursor:pointer',
      onclick: () => { includeChord = !includeChord; draw(); } }, label('parts.newDialog.withChord'));
    const mode = el('button', { type: 'button', 'data-act': 'new-part-split', 'aria-pressed': String(split), title: label('parts.newDialog.splitHint'), style: 'min-height:var(--ui-target,30px);padding:0 12px;font:inherit;border:1px solid var(--edge,#bbb);border-radius:8px;background:var(--btn,#fdfcfa);cursor:pointer',
      onclick: () => { split = !split; draw(); } }, label(split ? 'parts.newDialog.splitOn' : 'parts.newDialog.splitOff'));
    const ok = el('button', { type: 'button', 'data-act': 'new-part-ok', style: 'min-height:var(--ui-target,30px);padding:0 18px;font:var(--w-semi,600) 15px var(--ui-font,sans-serif);border:1px solid var(--edge,#888);border-radius:8px;background:var(--btn-on,#e2e0da);cursor:pointer',
      onclick: () => { if (!picked.size) { message = label('parts.newDialog.none'); draw(); return; } if (split) { done(splitParts(outline, picked, { includeChord })); return; } done([{ name: name.value.trim(), staffIds: outline.flatMap((mv) => mv.tracks.flatMap((t) => t.staves.map((s) => s.id))).filter((id) => picked.has(id)) }]); } }, label('parts.newDialog.ok'));
    const cancel = el('button', { type: 'button', 'data-act': 'new-part-cancel', style: 'min-height:var(--ui-target,30px);padding:0 14px;font:inherit;border:1px solid var(--edge,#bbb);border-radius:8px;background:var(--btn,#fdfcfa);cursor:pointer', onclick: close }, label('parts.newDialog.cancel'));
    const keep = name.value;
    box.replaceChildren(
      el('div', { style: 'font-weight:var(--w-bold,700)' }, label('parts.newDialog.title')), name,
      el('div', { style: 'font-size:13px;color:var(--ink-soft,#555)' }, label('parts.newDialog.pick')),
      el('div', { style: 'display:flex;flex-direction:column;gap:var(--btn-gap,2px)' }, ...rows),
      el('div', { role: 'status', style: 'color:var(--danger-ink,#a02020);min-height:1.2em;font-size:13px' }, message),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center' }, each, mode, chord, el('span', { style: 'flex:1' }), cancel, ok));
    name.value = keep;
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  function close() { window.removeEventListener('keydown', onKey, true); veil.remove(); }
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  draw();
  name.focus({ preventScroll: true });
  return { close };
}
