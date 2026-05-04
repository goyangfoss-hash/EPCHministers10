// Firebase Messaging Service Worker
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

// ─── 백그라운드 메시지 수신 ───────────────────────
messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};
  const tab = data.tab || 'feed';

  self.registration.showNotification(title || '은평교회 사역스케줄러', {
    body: body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'epch-' + tab,          // 같은 탭 알림은 덮어쓰기 (중복 방지)
    renotify: false,
    data: { tab, url: data.url || '/?tab=' + tab },
  });
});

// ─── 알림 클릭 처리 ──────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const tab = event.notification.data?.tab || 'feed';
  const targetUrl = new URL('/?tab=' + tab, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // 이미 열린 앱 창이 있으면 포커스 + 메시지 전송
      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          client.focus();
          client.postMessage({ type: 'NOTIF_CLICK', tab });
          return;
        }
      }
      // 없으면 새 창 열기
      return clients.openWindow(targetUrl);
    })
  );
});
