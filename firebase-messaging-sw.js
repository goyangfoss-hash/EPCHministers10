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

messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || '근무표 알림', {
    body: body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    tag: 'epch-push',
    renotify: true,
    data: { url: '/' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const c = cs.find(x => x.url.includes(self.location.origin));
      return c ? c.focus() : clients.openWindow('/');
    })
  );
});
