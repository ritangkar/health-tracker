// Service worker (D-014). Cache-first for the shell and seed. No runtime caching, no network calls to other origins. (A3)
// install: fetch every WA_PRECACHE file with cache:'reload' into winter-arc-shell-<WA_VERSION>; data/ files are best-effort into winter-arc-seed-<WA_SEED_VERSION>.
// activate: delete every other winter-arc-* cache. No automatic skipWaiting: the page asks via postMessage('SKIP_WAITING').
// message: 'SKIP_WAITING' | {type:'GET_VERSION'} -> reply {type:'VERSION', version, seedVersion, missingSeed[]}
importScripts('version.js');
const SHELL = `winter-arc-shell-${self.WA_VERSION}`;
const SEED = `winter-arc-seed-${self.WA_SEED_VERSION}`;
const SCOPE = self.registration.scope;
const abs = (p) => new URL(p, SCOPE).href;
const isSeed = (p) => p.startsWith('data/');
let missingSeed = [];

async function fetchFresh(url) {
  const res = await fetch(new Request(url, { cache: 'reload' }));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}
async function precache() {
  const shell = await caches.open(SHELL);
  const seed = await caches.open(SEED);
  const shellFiles = self.WA_PRECACHE.filter((p) => !isSeed(p));
  await Promise.all(shellFiles.map(async (p) => { const u = abs(p); await shell.put(u, await fetchFresh(u)); })); // any miss rejects: install fails, old SW stays
  const seedFiles = new Set(self.WA_PRECACHE.filter(isSeed));
  try {
    const mUrl = abs('data/seed-manifest.json');
    const res = await fetchFresh(mUrl);
    const text = await res.clone().text();
    await seed.put(mUrl, res);
    for (const f of JSON.parse(text).files || []) { const path = typeof f === 'string' ? f : f.path; if (path) seedFiles.add('data/' + path.replace(/^\.?\//, '')); }
  } catch { /* seed manifest not available yet: other seed files are still tried */ }
  missingSeed = [];
  await Promise.all([...seedFiles].map(async (p) => {
    const u = abs(p);
    if (await seed.match(u)) return;
    try { await seed.put(u, await fetchFresh(u)); } catch { missingSeed.push(p); }
  }));
}
self.addEventListener('install', (e) => { e.waitUntil(precache()); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('winter-arc-') && k !== SHELL && k !== SEED) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => (await caches.match(abs('index.html'))) || fetch(req))());
    return;
  }
  e.respondWith((async () => (await caches.match(req)) || fetch(req))());
});
self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) { self.skipWaiting(); return; }
  if (d && d.type === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: self.WA_VERSION, seedVersion: self.WA_SEED_VERSION, missingSeed });
});
