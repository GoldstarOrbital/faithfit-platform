/**
 * Service worker — push plus a small, versioned shell cache. Navigation is
 * network-first so deployments arrive immediately; versioned assets are
 * cache-first so repeat visits do not redownload the app bundle.
 */
'use strict';

const SHELL_CACHE = 'functioning-faith-shell-v19';
const SHELL = [
  '/',
  '/styles.css?v=ff-delete-22',
  '/sensors.js?v=rider-v1',
  '/journey3d.js?v=rider-v1',
  '/e2e-crypto.js?v=v2',
  '/app.js?v=ff-delete-22',
  '/journey-live.js?v=rider-v1',
  '/easter-eggs.js?v=ff-polish-20',
  '/intro-sound.js?v=ff-polish-20',
  '/app-intro.js?v=ff-polish-20',
  '/native.js?v=ff-polish-20',
  '/farewell.js?v=ff-polish-20',
  '/pause-moment.js?v=ff-polish-20',
  '/visual-polish.js?v=ff-polish-20',
  '/fouc-safety.js?v=ff-polish-20',
];

self.addEventListener('install', (e) => e.waitUntil(
  caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api') || url.pathname === '/sw.js') return;

  // Never store an error or opaque response. A cached 500 would be served back
  // as the offline page, and on the cache-first path below it would outlive the
  // outage entirely — the site would stay broken for that visitor until the
  // cache name changed. Only a real, same-origin 200 is worth keeping.
  const cacheable = (response) => response && response.ok && response.type === 'basic';
  const store = (response) => {
    if (!cacheable(response)) return;
    const copy = response.clone();
    caches.open(SHELL_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
  };

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      store(response);
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('/'))));
    return;
  }

  // Only explicitly versioned assets are cache-first. Unversioned files keep
  // the browser's normal behavior and can never trap a newly deployed build.
  if (!url.searchParams.has('v')) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    store(response);
    return response;
  })));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  // A push that arrives malformed still has to show something, because on some
  // platforms a push event with no notification shown is a policy violation
  // that costs the site its permission.
  const title = data.title || 'Functioning Faith';
  const options = {
    body: data.body || '',
    tag: data.tag || 'functioning-faith',
    data: { url: data.url || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = '/';
  try {
    const candidate = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
    if (candidate.origin === self.location.origin) url = candidate.pathname + candidate.search + candidate.hash;
  } catch { /* malformed or external notification targets stay on the app home */ }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an open tab rather than stacking up new ones.
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
