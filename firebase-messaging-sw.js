// firebase-messaging-sw.js
// FCM 백그라운드 푸시 알림 처리 — 은평교회 사역스케줄러

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

// 백그라운드 메시지 수신 (앱이 닫혀있거나 백그라운드일 때)
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  const notificationTitle = title || '사역스케줄러';
  const notificationOptions = {
    body: body || '',
    icon: icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.data?.type || 'default',   // 같은 tag면 덮어씌움 (중복 방지)
    renotify: true,
    data: payload.data || {},
  };
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// 알림 클릭 시 앱 포커스 또는 열기
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // 이미 열려있는 탭 있으면 포커스
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // 없으면 새 탭 열기
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
