// ══════════════════════════════════════════════════
//  Service Worker (sw.js)
//  PWA 캐시 + 오프라인 지원
// ══════════════════════════════════════════════════
const CACHE_NAME = 'epc-v11';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── 설치: 정적 파일 캐시 ────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
});

// ── 활성화: 이전 캐시 삭제 ──────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── 네트워크 요청: Network First 전략 ──────────────
self.addEventListener('fetch', (event) => {
  // API/Supabase 요청은 캐시 안 함
  if (
    event.request.url.includes('supabase.co') ||
    event.request.url.includes('firebaseio.com') ||
    event.request.url.includes('googleapis.com') ||
    event.request.url.includes('anthropic.com') ||
    event.request.method !== 'GET'
  ) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // 성공하면 캐시 업데이트
        if (res && res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return res;
      })
      .catch(() => {
        // 오프라인이면 캐시에서
        return caches.match(event.request).then((cached) => cached || caches.match('/index.html'));
      })
  );
});

// ── 알림 클릭 ───────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
