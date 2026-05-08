// sw.js — 은평교회 사역스케줄러
// 버전은 index.html이 ?v=타임스탬프로 자동 전달 — 수동으로 올릴 필요 없음
const CACHE_VERSION = new URL(location.href).searchParams.get('v') || 'v1';
const CACHE_NAME = `epch-minister-${CACHE_VERSION}`;

const PRECACHE_URLS = ['/', '/index.html', '/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('epch-minister-') && k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  // 이 조건에 해당하면 respondWith 호출 안 함 → 브라우저가 직접 처리
  if (
    event.request.method !== 'GET' ||
    url.includes('supabase.co') ||
    url.includes('firebase') ||
    url.includes('gstatic.com') ||
    url.includes('cdn.jsdelivr') ||
    url.includes('googleapis') ||
    url.includes('chrome-extension') ||
    !url.startsWith('http')
  ) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match('/index.html'))
      )
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ★ FCM 푸시는 firebase-messaging-sw.js 전담
// sw.js는 push/notificationclick 완전 차단
self.addEventListener('push', event => {
  event.waitUntil(Promise.resolve());
});
self.addEventListener('notificationclick', event => {
  // firebase-messaging-sw.js가 처리
});
