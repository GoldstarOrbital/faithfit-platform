/**
 * Service worker — the part of Functioning Faith that runs when the app is not
 * open. Its only job is push: receive a message, show it, and take the member
 * where it points.
 *
 * Deliberately not a cache/offline worker. Caching this app properly is a real
 * piece of work, and a half-done cache that serves stale scripture or a stale
 * build is worse than none.
 */
'use strict';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
