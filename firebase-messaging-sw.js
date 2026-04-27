// ══════════════════════════════════════════════════
//  Firebase Messaging Service Worker
//  백그라운드 푸시 알림 처리 (앱이 닫혀있을 때도 동작)
// ══════════════════════════════════════════════════
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAQLc0H_AoD7E2JF8Tji3ZgMWAiJxQ2SPY",
  authDomain: "epchminister.firebaseapp.com",
  projectId: "epchminister",
  storageBucket: "epchminister.firebasestorage.app",
  messagingSenderId: "110307544897",
  appId: "1:110307544897:web:12e73220454bba67aedbc0"
});

const messaging = firebase.messaging();

// ── 백그라운드 메시지 수신 ──────────────────────────
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] 백그라운드 메시지 수신:', payload);

  const title = payload.notification?.title
    || payload.data?.title
    || '은평교회 근무관리';

  const body = payload.notification?.body
    || payload.data?.body
    || '새 알림이 있습니다.';

  const icon = payload.data?.icon || '/icon-192.png';
  const badge = payload.data?.badge || '/icon-192.png';
  const type = payload.data?.type || '';
  const url = payload.data?.url || '/';

  const options = {
    body,
    icon,
    badge,
    tag: `epc-${type}-${Date.now()}`,
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url, type },
    actions: type === 'chat'
      ? [{ action: 'reply', title: '앱 열기' }]
      : []
  };

  return self.registration.showNotification(title, options);
});

// ── 알림 클릭 → 앱 열기 ────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 이미 열려있는 탭이 있으면 포커스
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // 없으면 새 탭 열기
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
