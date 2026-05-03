// sw.js
// 캐시 관리 + 자동 업데이트 — 은평교회 사역스케줄러
// 버전은 index.html이 ?v=타임스탬프 로 자동 전달 — 수동으로 올릴 필요 없음
const CACHE_VERSION = new URL(location.href).searchParams.get('v') || 'v1';
const CACHE_NAME = `epch-minister-${CACHE_VERSION}`;

// 오프라인에서도 동작할 핵심 파일들
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── 설치: 핵심 파일 캐시 ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())  // 즉시 활성화 (대기 없이)
  );
});

// ── 활성화: 이전 버전 캐시 삭제 ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('epch-minister-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())  // 모든 탭에 즉시 적용
  );
});

// ── fetch: 네트워크 우선, 실패 시 캐시 ──
self.addEventListener('fetch', event => {
  // POST 요청, Supabase API, Firebase, CDN은 캐시 안 함
  const url = event.request.url;
  if (
    event.request.method !== 'GET' ||
    url.includes('supabase.co') ||
    url.includes('firebase') ||
    url.includes('gstatic.com') ||
    url.includes('cdn.jsdelivr') ||
    url.includes('googleapis')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 유효한 응답이면 캐시 업데이트
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))  // 오프라인 시 캐시 제공
  );
});

// ── 새 버전 감지 시 클라이언트에 알림 ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
