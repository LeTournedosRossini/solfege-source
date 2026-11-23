// Service worker de l'application Solfège. Le numéro de version et la liste des fichiers sont ajoutés par tools/build-app.mjs.
//  - le code, la feuille de style, les polices et l'icône sont pré-chargés : l'application s'ouvre sans réseau ;
//  - les SoundFonts (hébergées sur GitHub) sont gardées dans un cache à part, conservé d'une version à l'autre : après le premier ▶, le son riche marche aussi hors-ligne.
const VERSION = '__VERSION__';
const CACHE = `solfege-${VERSION}`;
const SONS = 'solfege-sons';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  // `cache: 'reload'` : chaque fichier est demandé au serveur, jamais lu dans le cache HTTP du navigateur (sinon une nouvelle version pourrait se retrouver avec d'anciens fichiers)
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' }))))));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('solfege-') && k !== CACHE && k !== SONS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // SoundFonts : cache d'abord, puis réseau (et on garde la copie). Elles sont sur le même domaine que le site (autre dépôt GitHub Pages) : on les reconnaît à leur extension,
  // pas à leur origine ; hors-ligne et jamais téléchargées, la requête échoue franchement (le lecteur bascule alors sur le moteur léger) au lieu de recevoir la page d'accueil.
  if (/\.sf[23]$/i.test(url.pathname)) {
    event.respondWith(caches.open(SONS).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: false }).then((hit) => hit || caches.match(req, { ignoreSearch: true })).then((hit) => hit || fetch(req)).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
