/*
 * Page of the reader (read only). The work comes from, in this order: the file embedded in the page (`<script type="application/json" id="scorsaire-work">`), the
 * address in `?file=` or `#file=` (a `.scorsaire` served by any server that allows it), or a file the person opens. Nothing is ever sent anywhere.
 */
import { mountReader } from './reader.js';
import { parseStartParams } from './startparams.js';
import { pageParams, authFetch } from './access.js';
import { mountThemeToggle } from './theme-toggle.js';
import { createI18n } from '../i18n/index.js';
import { registerAsset } from '../model/assets.js';
import { isScorsaireArchive, readScorsaireArchive } from '../model/container.js';

const lang = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2);
const t = createI18n(['fr', 'en'].includes(lang) ? lang : 'fr');
const safeStorage = () => { try { const s = window.localStorage; s.getItem('x'); return s; } catch { return null; } };

function boot() {
  const host = document.getElementById('app');
  mountThemeToggle({ storage: safeStorage(), label: (next) => t(next === 'dark' ? 'reader.themeDark' : next === 'hc' ? 'reader.themeHc' : 'reader.themeLight') });
  const reader = mountReader(host, { storage: safeStorage() });
  const message = (text) => { host.querySelector('[data-rd-msg]')?.remove(); if (text) { const p = document.createElement('p'); p.setAttribute('data-rd-msg', ''); p.style.cssText = 'padding:40px;text-align:center;font:15px sans-serif;color:#555'; p.textContent = text; host.prepend(p); } };
  const params = pageParams();
  const start = parseStartParams(params); // m = one movement (its id, stable in the file), v = speed, tr = transposition, loop = two measure ids
  const show = (text) => { try { message(''); reader.open(text, start); } catch (e) { message(e?.code === 'movement' ? t('reader.noMovement') : `${t('reader.loadError')} ${e?.message ?? ''}`); } };
  /** The bytes of a `.scorsaire` file: plain text, or the ZIP form (the score and its pictures; the synchronised audio of screen 4 is not played here). */
  const showBytes = async (bytes) => {
    try {
      if (isScorsaireArchive(bytes)) {
        const r = await readScorsaireArchive(bytes);
        for (const im of r.images) registerAsset(im);
        show(r.scoreText);
      } else show(new TextDecoder().decode(bytes));
    } catch (e) { message(`${t('reader.loadError')} ${e?.message ?? ''}`); }
  };
  const picker = () => {
    const wrap = document.createElement('div'); wrap.style.cssText = 'padding:40px;text-align:center;font:15px var(--ui-font,sans-serif)';
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.scorsaire,.json,application/json'; input.setAttribute('aria-label', t('reader.openFile'));
    input.addEventListener('change', async () => { const f = input.files?.[0]; if (f) { wrap.remove(); showBytes(new Uint8Array(await f.arrayBuffer())); } });
    wrap.append(t('reader.openFile'), document.createElement('br'), input); host.prepend(wrap);
  };
  try { // the pictures of the blocks, embedded as data: URIs
    const pics = JSON.parse(document.getElementById('scorsaire-images')?.textContent ?? '{}');
    for (const [id, p] of Object.entries(pics)) {
      const raw = atob(String(p.data).split(',')[1] ?? '');
      registerAsset({ id, mime: p.mime, bytes: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    }
  } catch { /* a damaged block of pictures: the frames stay empty */ }
  const embedded = document.getElementById('scorsaire-work');
  if (embedded) { show(embedded.textContent); return; }
  const url = params.get('file');
  if (!url) { picker(); return; }
  message(t('reader.loading'));
  authFetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }).then((b) => showBytes(new Uint8Array(b))).catch((e) => message(`${t('reader.loadError')} (${e.message})`));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
