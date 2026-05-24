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

  const title = payload.notification?.title || payload.data?.title || '은평교회 사역스케줄러';
  const body  = payload.notification?.body  || payload.data?.body  || '';
  const data  = payload.data || {};
  const tab   = data.tab || 'feed';

  if ('setAppBadge' in self.navigator) {
    self.navigator.setAppBadge(1).catch(() => {});
  }

  // 채팅 알림은 메시지마다 진동하도록 별도 tag, 나머지는 같은 tag로 중복 방지
  const isChat = tab === 'feed' && data.action === 'openChat';
  const tag = isChat ? 'epch-chat-' + Date.now() : 'epch-' + tab;

  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    renotify: false,
    data: {
      tab,
      action:      data.action      || '',
      chatUserId:  data.chatUserId  || '',
      noticeId:    data.noticeId    || '',
      year:        data.year        || '',
      month:       data.month       || '',
      day:         data.day         || '',
      url:         data.url         || '/?tab=' + tab,
    },
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if ('clearAppBadge' in self.navigator) {
    self.navigator.clearAppBadge().catch(() => {});
  }

  const d = event.notification.data || {};
  const tab        = d.tab        || 'feed';
  const action     = d.action     || '';
  const chatUserId = d.chatUserId || '';
  const noticeId   = d.noticeId   || '';
  const year       = d.year       || '';
  const month      = d.month      || '';
  const day        = d.day        || '';

  const params = new URLSearchParams({ tab });
  if(action)     params.set('action', action);
  if(chatUserId) params.set('chatUserId', chatUserId);
  if(noticeId)   params.set('noticeId', noticeId);
  if(year)       params.set('year', year);
  if(month)      params.set('month', month);
  if(day)        params.set('day', day);

  const targetUrl = new URL('/?' + params.toString(), self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.focus();
          client.postMessage({
            type: 'NOTIF_CLICK',
            tab, action, chatUserId, noticeId, year, month, day
          });
          return;
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
