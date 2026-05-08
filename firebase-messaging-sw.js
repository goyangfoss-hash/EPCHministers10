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

// ★ push 이벤트를 FCM SDK보다 먼저 가로채서 중복 방지
self.addEventListener('push', event => {
  event.waitUntil(Promise.resolve());
}, true); // capture:true → FCM SDK보다 먼저 실행

// FCM 백그라운드 메시지 처리
messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};
  const tab = data.tab || 'feed';

  if ('setAppBadge' in self.navigator) {
    self.navigator.setAppBadge(1).catch(() => {});
  }

  self.registration.showNotification(title || '은평교회 사역스케줄러', {
    body: body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'epch-' + tab,
    renotify: true,
    data: { tab, url: data.url || '/?tab=' + tab },
  });
});

// 알림 클릭 처리
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if ('clearAppBadge' in self.navigator) {
    self.navigator.clearAppBadge().catch(() => {});
  }
  const tab = event.notification.data?.tab || 'feed';
  const targetUrl = new URL('/?tab=' + tab, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.focus();
          client.postMessage({ type: 'NOTIF_CLICK', tab });
          return;
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
