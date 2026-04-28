// ══════════════════════════════════════════════════
//  Service Worker (sw.js) v12
//  index.html은 항상 네트워크에서 가져옴 (캐시 안 함)
// ══════════════════════════════════════════════════
const CACHE_NAME = 'epc-v12';

// ── 설치: 캐시 초기화만 ─────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// ── 활성화: 이전 캐시 전부 삭제 ─────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── fetch: index.html은 항상 네트워크, 나머지는 Network First ──
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // API 요청은 캐시 안 함
  if (
    url.includes('supabase.co') ||
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com') ||
    url.includes('anthropic.com') ||
    url.includes('generativelanguage') ||
    event.request.method !== 'GET'
  ) return;

  // ★ index.html은 항상 네트워크에서 가져옴 (절대 캐시 안 함)
  if (url.endsWith('/') || url.includes('index.html')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 나머지: Network First
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
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
