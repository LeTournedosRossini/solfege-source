/*
 * The panel that stays above the media panel of screen 4 while an analysis song and a Songsterr score have just been put together: what was decided (the shift of
 * the measures, how well the video agrees), the choice of the SECTIONS (those of the audio, those of the score, both: the two bands are drawn on the timeline of the
 * media panel to compare, and the song plays as usual), the shift of the parts by one measure, and « Validate » (the sources are let go, the panel goes).
 * It never writes the session: it asks the callbacks.
 */
function el(tag, css = '', attrs = {}) { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
const button = (text, title, fn) => {
  const b = el('button', 'min-height:var(--ui-target,40px);min-width:var(--ui-target,40px);padding:0 10px;font:inherit', { type: 'button', title, 'aria-label': title });
  b.textContent = text; b.addEventListener('click', fn); return b;
};

/**
 * @param o.getState() → { shift, noShift (bool), pickup (beats or 0), trimmed (bool), videoMean (s or null), mode: 'audio' | 'part' | 'both', audioCount, partCount }
 * @param o.onSections(mode) / o.onShift(delta) / o.onValidate()
 */
export function mountMergePanel(host, { label, getState, onSections, onShift, onValidate }) {
  const root = el('div', 'border:1px solid var(--line,#d8d3c8);border-radius:10px;background:var(--module,#fcfbf8);padding:8px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px', { 'data-merge-panel': '' });
  const title = el('div', 'font:var(--w-bold,700) 14px var(--ui-font,sans-serif)'); title.textContent = label('merge.title');
  const summary = el('div', 'font:13px var(--ui-font,sans-serif);color:var(--ink-soft,#555)', { 'data-merge-summary': '' });
  const legend = el('div', 'font:12px var(--ui-font,sans-serif);color:var(--ink-soft,#555)'); legend.textContent = label('merge.legend');

  const secRow = el('div', 'display:flex;align-items:center;flex-wrap:wrap;gap:var(--btn-gap,2px)', { 'data-merge-sections': '' });
  const secLabel = el('span', 'font:var(--w-semi,600) 13px var(--ui-font,sans-serif);margin-right:6px'); secLabel.textContent = label('merge.sections');
  const modes = [['audio', 'merge.fromAudio'], ['part', 'merge.fromScore'], ['both', 'merge.both']].map(([id, key]) => {
    const b = button(label(key), label(`${key}Hint`), () => onSections(id)); b.setAttribute('data-merge-mode', id); return [id, b];
  });
  secRow.append(secLabel, ...modes.map(([, b]) => b));

  const shiftRow = el('div', 'display:flex;align-items:center;flex-wrap:wrap;gap:var(--btn-gap,2px)', { 'data-merge-shift': '' });
  const shiftLabel = el('span', 'font:var(--w-semi,600) 13px var(--ui-font,sans-serif);margin-right:6px'); shiftLabel.textContent = label('merge.shift');
  const shiftVal = el('span', 'min-width:150px;text-align:center;font:13px var(--ui-font,sans-serif)', { 'data-merge-shift-value': '' });
  shiftRow.append(shiftLabel, button('◂', label('merge.shiftEarlier'), () => onShift(-1)), shiftVal, button('▸', label('merge.shiftLater'), () => onShift(1)));

  const ok = button(label('merge.validate'), label('merge.validateHint'), () => onValidate()); ok.setAttribute('data-merge-validate', ''); ok.style.fontWeight = '700'; ok.style.alignSelf = 'flex-start';
  root.append(title, summary, secRow, shiftRow, legend, ok); host.append(root);

  function refresh() {
    const s = getState();
    const bits = [];
    if (s.pickup) bits.push(label('merge.pickupAdded', { n: String(s.pickup) }));
    if (s.trimmed) bits.push(label('merge.endCut'));
    bits.push(s.videoMean == null ? label('merge.noVideo') : label('merge.videoAgrees', { mean: s.videoMean.toFixed(2) }));
    summary.textContent = bits.join(' · ');
    shiftRow.style.display = s.noShift ? 'none' : ''; // the other direction (the audio added to a score) is not rebuilt: to change the correspondence, start again
    shiftVal.textContent = s.shift === 0 ? label('merge.shiftNone') : label('merge.shiftN', { n: `${s.shift > 0 ? '+' : ''}${s.shift}` });
    for (const [id, b] of modes) { b.setAttribute('aria-pressed', String(s.mode === id)); b.style.background = s.mode === id ? 'var(--btn-on,#e2e0da)' : ''; b.style.fontWeight = s.mode === id ? '700' : ''; }
    modes.find(([id]) => id === 'audio')[1].disabled = false;
    modes.find(([id]) => id === 'part')[1].disabled = !s.partCount;
    modes.find(([id]) => id === 'both')[1].disabled = !s.partCount || !s.audioCount;
  }
  refresh();
  return { refresh, root, destroy() { root.remove(); } };
}
