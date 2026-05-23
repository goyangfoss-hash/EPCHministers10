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

let _isForeground = false;
let _foregroundTimer = null;

self.addEventListener('message', event => {
  if(event.data?.type === 'FOREGROUND'){
    _isForeground = true;
    clearTimeout(_foregroundTimer);
    _foregroundTimer = setTimeout(() => { _isForeground = false; }, 5000);
  }
});

messaging.onBackgroundMessage(payload => {
  if(_isForeground) return;

  // notification 필드가 있으면 FCM이 자동으로 배너 표시 → SW에서 중복 표시 안 함
  if(payload.notification) return;

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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if ('clearAppBadge' in self.navigator) {
    self.navigator.clearAppBadge().catch(() => {});
  }
  const tab = event.notification.data?.tab || 'feed';
  const chatUserId = event.notification.data?.chatUserId || '';
  const targetUrl = new URL('/?tab=' + tab + (chatUserId ? '&chat=' + chatUserId : ''), self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.focus();
          client.postMessage({ type: 'NOTIF_CLICK', tab, chatUserId });
          return;
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
