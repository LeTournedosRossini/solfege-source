/*
 * Boîte de dialogue « Insérer des mesures » (étape 5) — DOM. Choix avant / après la mesure choisie et nombre de mesures (stepper − [champ] +).
 * Tablette d'abord : boutons ≥ 44 px, champ numérique. N'écrit rien dans le Document : le résultat est renvoyé à `onConfirm({ where, count })`.
 */
export const MAX_INSERT_COUNT = 999;

/** Nombre de mesures lu dans le champ : entier borné à 1..MAX_INSERT_COUNT (repli sur `fallback`). Pur, testé. */
export function parseCount(text, fallback = 1) {
  const n = Number.parseInt(String(text).trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_INSERT_COUNT, Math.max(1, n));
}

export function openInsertMeasuresDialog({ label = (k) => k, where = 'after', count = 1, onConfirm = () => {} } = {}) {
  const veil = document.createElement('div');
  veil.setAttribute('data-insert-measures', '');
  veil.setAttribute('data-zoom-lock', '');
  veil.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', label('measure.insertMany'));
  box.style.cssText = 'background:var(--field,#fff);color:var(--ink,#111);border-radius:8px;padding:16px;min-width:260px;max-width:calc(100vw - 24px);font:15px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4)';
  const title = document.createElement('div'); title.textContent = label('measure.insertMany'); title.style.cssText = 'font-weight:var(--w-semi,600);margin-bottom:10px';

  let current = where;
  const radios = [['before', 'measure.insertBefore'], ['after', 'measure.insertAfter']].map(([value, key]) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:var(--btn-gap,2px);min-height:var(--ui-target,44px)';
    const r = document.createElement('input');
    r.type = 'radio'; r.name = 'insert-where'; r.value = value; r.checked = value === where; r.style.cssText = 'width:22px;height:22px';
    r.addEventListener('change', () => { current = value; });
    row.append(r, document.createTextNode(label(key)));
    return row;
  });

  const field = document.createElement('input');
  field.type = 'text'; field.inputMode = 'numeric'; field.value = String(count);
  field.setAttribute('aria-label', label('measure.count')); field.classList.add('stepper-field', 'stp-val');
  field.style.cssText = 'box-sizing:border-box';
  const step = (text, delta) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'stp-b'; b.textContent = text;
    b.setAttribute('aria-label', delta < 0 ? label('measure.fewer') : label('measure.more'));
    b.addEventListener('click', () => { field.value = String(parseCount(field.value) + delta > MAX_INSERT_COUNT ? MAX_INSERT_COUNT : Math.max(1, parseCount(field.value) + delta)); });
    return b;
  };
  const stepper = document.createElement('div'); stepper.style.cssText = 'display:flex;align-items:center;gap:var(--btn-gap,2px);margin:10px 0';
  const countLabel = document.createElement('span'); countLabel.textContent = label('measure.count');
  stepper.append(countLabel, step('−', -1), field, step('+', 1));
  field.addEventListener('blur', () => { field.value = String(parseCount(field.value)); });

  const close = () => { document.removeEventListener('keydown', onKey, true); veil.remove(); };
  const ok = () => { const result = { where: current, count: parseCount(field.value) }; close(); onConfirm(result); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); ok(); }
  };
  const mk = (text, fn, action, primary) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('data-action', action);
    b.style.cssText = `min-width:96px;min-height:var(--ui-target,44px);${primary ? 'background:#2878ff;color:#fff;border:0;border-radius:6px' : ''}`;
    b.addEventListener('click', fn);
    return b;
  };
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:var(--btn-gap,2px);margin-top:6px';
  actions.append(mk(label('measure.cancel'), close, 'insert-cancel', false), mk(label('measure.insertOk'), ok, 'insert-ok', true));
  box.append(title, ...radios, stepper, actions);
  veil.append(box);
  veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  field.focus(); field.select();
  return { close };
}
