// sw.js - 캐시 비활성화 버전
// 서비스워커가 구버전을 캐시하는 문제를 방지하기 위해 캐시를 사용하지 않습니다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// 모든 요청을 네트워크에서 직접 가져옴 (캐시 사용 안 함)
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request));
});
