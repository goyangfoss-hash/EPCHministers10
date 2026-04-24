const CACHE = 'ws-v10';
const ASSETS = ['/', '/index.html', '/app.js', '/manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => { if (e.request.method !== 'GET') return; e.respondWith(caches.match(e.request).then(c => c || fetch(e.request))); });
self.addEventListener('push', e => { const d = e.data?.json() || {}; e.waitUntil(self.registration.showNotification(d.title || '근무표 알림', { body: d.body || '새 알림', icon: '/icon-192.png', badge: '/icon-192.png', vibrate: [200, 100, 200], tag: d.tag || 'ws', renotify: true })); });
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => x.url.includes(self.location.origin)); return c ? c.focus() : clients.openWindow('/'); })); });
