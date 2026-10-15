'use strict';
/* Memory Lane Category Challenge - service worker (BUILD-SPEC 4.2).
 *
 * Two caches:
 *   mlcc-shell-<version>-<build>   the app itself: page, manifest, icons, fonts, sound effects, licences.
 *                                  Saved when this worker installs, so the cache name changes with every release and old ones are removed.
 *   mlcc-content-us                questions and Heart's voice clips. The page saves these (first-open download, "Download everything again"),
 *                                  because it can show progress and carry on after an interruption. This worker only reads from it.
 * Cache-first for everything saved, so the game opens and plays with no connection.
 * A new worker waits until the person taps "A new version is ready" (message SKIP_WAITING). It never takes over mid-game by itself.
 *
 * APP_VERSION and BUILD are written by tools/build_offline.py (BUILD is a fingerprint of the shell files), so any change to the app changes this file.
 */
const APP_VERSION = '0.5.1';
const BUILD = '498aa6909b';
const SHELL_CACHE = `mlcc-shell-${APP_VERSION}-${BUILD}`;
const CONTENT_CACHE = 'mlcc-content-us';
const MANIFEST_FILE = 'offline-manifest.json';

const SHELL = [
  'index.html',
  'manifest.webmanifest',
  'offline-manifest.json',
  'LICENSES.txt',
  'icon-180.png', 'icon-192.png', 'icon-512.png',
  'fonts/alfa-slab-one-400.woff2', 'fonts/atkinson-hyperlegible-400.woff2', 'fonts/atkinson-hyperlegible-700.woff2', 'fonts/yellowtail-400.woff2',
  'sfx/open.mp3', 'sfx/correct.mp3', 'sfx/wrong.mp3', 'sfx/lucky.mp3', 'sfx/points.mp3', 'sfx/finale.mp3'
];
const scoped = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // fetched fresh (not from the browser's own HTTP cache) and all-or-nothing: if any file fails, this worker is not installed and the old one keeps working
    await Promise.all(SHELL.map(async (p) => {
      const r = await fetch(scoped(p), { cache: 'reload' });
      if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
      await cache.put(scoped(p), r);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if ((name.startsWith('mlcc-shell-') && name !== SHELL_CACHE) || (name.startsWith('mlcc-content-') && name !== CONTENT_CACHE)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function lookup(request) {
  for (const name of [SHELL_CACHE, CONTENT_CACHE]) {
    const hit = await (await caches.open(name)).match(request, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // nothing the game needs lives anywhere else
  if (url.href === self.location.href) return;                     // the worker file itself always comes straight from the network
  if (req.cache === 'reload') return;                              // the page's downloader asks for the freshest copy from the network
  event.respondWith(respond(req, url));
});

async function respond(req, url) {
  // the file list is fresh when online, and the last saved copy when offline
  if (url.pathname.endsWith('/' + MANIFEST_FILE)) {
    try {
      const r = await fetch(url.href, { cache: 'no-store' });
      if (r.ok) (await caches.open(SHELL_CACHE)).put(scoped(MANIFEST_FILE), r.clone()).catch(() => {});
      return r;
    } catch (err) {
      const old = await lookup(req);
      if (old) return old;
      throw err;
    }
  }
  const isPage = req.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  const hit = await lookup(isPage ? scoped('index.html') : req);
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch (err) {
    if (req.mode === 'navigate') {
      const page = await lookup(scoped('index.html'));
      if (page) return page;
    }
    throw err;
  }
}
