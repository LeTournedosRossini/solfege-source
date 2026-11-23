/*
 * The installed editor (a PWA): registers its service worker and offers a new version WITHOUT forcing it. Only active when the page carries a web app manifest (the
 * `dist/editeur/` build, served by http(s)); the standalone `scorsaire.html` opened from a file, and the page the school portal serves, have none and never register a worker.
 * A new version waits in the background; the person taps "Update", the usual question about unsaved changes is asked, and only then does the page reload.
 */
export const isInstalledBuild = (doc = globalThis.document, loc = globalThis.location) =>
  !!doc?.querySelector?.('link[rel="manifest"]') && /^https?:$/.test(loc?.protocol ?? '') && !/[?#&]t=/.test(`${loc?.search ?? ''}${loc?.hash ?? ''}`); // (a portal address carries its token as t=…: never here)

/** @param o.confirmReplace async () => boolean: asks about unsaved changes (false = the person cancelled) */
export function mountPwaUpdate({ t, confirmReplace, nav = globalThis.navigator, doc = globalThis.document, loc = globalThis.location }) {
  if (!isInstalledBuild(doc, loc) || !nav?.serviceWorker) return null;
  let banner = null; let reloading = false;
  const show = (worker) => {
    if (banner) return;
    banner = doc.createElement('div');
    banner.setAttribute('data-pwa-update', ''); banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:3400;display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:calc(100vw - 16px);padding:8px 10px;border-radius:10px;background:var(--bar,#fff);color:var(--ink,#1c1b1a);border:1px solid var(--edge,#b9b4a8);box-shadow:0 4px 16px rgba(0,0,0,.3);font:14px var(--ui-font,sans-serif)';
    const text = doc.createElement('span'); text.textContent = t('pwa.updateReady');
    const mk = (label, act, fn) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('data-act', act); b.style.cssText = 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:8px;border:1px solid var(--edge,#b9b4a8);background:var(--btn,#fff);color:inherit;font:inherit;cursor:pointer'; b.addEventListener('click', fn); return b; };
    const update = mk(t('pwa.update'), 'pwa-update', async () => {
      banner.style.display = 'none'; // the question about unsaved changes opens at the bottom of a tablet / phone: the banner must not sit over its buttons
      let ok = false;
      try { ok = await confirmReplace(); } finally { if (!ok && banner) banner.style.display = 'flex'; }
      if (ok) worker.postMessage('SKIP_WAITING');
    }); // (the page reloads when the new worker takes over)
    const later = mk(t('pwa.later'), 'pwa-later', () => { banner.remove(); banner = null; });
    banner.append(text, update, later); doc.body.append(banner);
  };
  nav.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; loc.reload(); });
  nav.serviceWorker.register('sw.js').then((reg) => {
    const watch = (worker) => worker.addEventListener('statechange', () => { if (worker.state === 'installed' && nav.serviceWorker.controller) show(worker); });
    if (reg.waiting && nav.serviceWorker.controller) show(reg.waiting);
    reg.addEventListener('updatefound', () => { if (reg.installing) watch(reg.installing); });
    // an installed app stays open for days: look for a new version when the person comes back to it
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') reg.update().catch(() => {}); });
    try { nav.storage?.persist?.(); } catch { /* best effort: the browser decides */ }
  }).catch(() => { /* no worker (a private window, a refused policy): the editor works as a plain page */ });
  return { dispose() { banner?.remove(); banner = null; } };
}
