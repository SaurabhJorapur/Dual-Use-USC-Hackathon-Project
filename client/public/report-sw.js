// Service worker for the crisis report page (/report/). Progressive enhancement only:
//  1. keeps the page and its assets cached so it opens with no connection;
//  2. where Background Sync exists (Chromium browsers), sends queued reports once the
//     browser regains a connection, even if the page was closed. Timing is up to the
//     browser and not guaranteed; the page itself retries whenever it is open.
// Reads the outbox written by src/lib/idbStore.js and applies the same acknowledgement
// rule as src/lib/reportQueue.js (drop a report only when the server confirms its id):
// keep all three in sync.
const CACHE = 'crisis-report-v1';
const SHELL = '/report/';
const DB_NAME = 'civicline-reports';
const STORE = 'outbox';
const API = new URL(self.location.href).searchParams.get('api') || '';

const assetUrls = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch(SHELL, { cache: 'no-cache' });
      if (!res.ok) return;
      await cache.put(SHELL, res.clone());
      await cache.addAll(assetUrls(await res.text()));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      await cache.put(SHELL, res.clone());
      cache.addAll(assetUrls(await res.clone().text())).catch(() => {});
    }
    return res;
  } catch {
    return (await cache.match(SHELL)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;
  if (request.mode === 'navigate' && url.pathname.startsWith('/report')) event.respondWith(networkFirstShell(request));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request)); // content-hashed, immutable
});

// ---------- Background Sync ----------

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

async function sendQueued() {
  const items = (await idb('readonly', (s) => s.getAll())).filter((i) => i.state !== 'rejected');
  for (const item of items) {
    const res = await fetch(`${API}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.payload),
    });
    const body = await res.json().catch(() => null);
    // Throwing makes the browser retry this sync later with its own backoff.
    if (!res.ok || body?.received !== true || body.report_id !== item.payload.id) throw new Error(`Report ${item.id} not confirmed`);
    await idb('readwrite', (s) => s.delete(item.id));
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag !== 'send-reports') return;
  event.waitUntil(
    (async () => {
      // An open report page runs the full queue logic (backoff, statuses); let it do the work.
      const pages = await self.clients.matchAll({ type: 'window' });
      if (pages.length) pages.forEach((page) => page.postMessage({ type: 'flush-reports' }));
      else await sendQueued();
    })(),
  );
});
