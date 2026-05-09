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

// ★ 포그라운드 상태 추적 (앱에서 postMessage로 전달)
let _isForeground = false;
let _foregroundTimer = null;

self.addEventListener('message', event => {
  if(event.data?.type === 'FOREGROUND'){
    _isForeground = true;
    clearTimeout(_foregroundTimer);
    _foregroundTimer = setTimeout(() => { _isForeground = false; }, 5000);
  }
});

// data 전용 메시지 처리
messaging.onBackgroundMessage(payload => {
  // ★ 포그라운드면 배너 표시 안 함 (앱이 토스트로 처리)
  if(_isForeground) return;

  const data = payload.data || {};
  const title = data.title || '은평교회 사역스케줄러';
  const body  = data.body  || '';
  const tab   = data.tab   || 'feed';

  if ('setAppBadge' in self.navigator) {
    self.navigator.setAppBadge(1).catch(() => {});
  }

  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'epch-' + tab,
    renotify: false,
    data: { tab, url: data.url || '/?tab=' + tab },
  });
});

// 알림 클릭 → 앱 열고 해당 탭 이동
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
