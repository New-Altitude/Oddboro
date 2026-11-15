// The phone desk's service worker. It does one thing: when the office sends a
// push, which is always empty, it shows a fixed line, and a tap opens the
// desk. It keeps nothing and handles no requests, so nothing of the desk is
// ever kept on the phone. The phone desk (`src/routes/desk/`) registers it
// for /desk only, once the owner turns the buzz on.
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Oddboro', {
      body: 'Something is waiting on your desk.',
      icon: '/desk-256.png',
      // One at a time: a new buzz replaces the last.
      tag: 'desk'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((open) => {
      const desk = open.find((c) => new URL(c.url).pathname === '/desk');
      return desk ? desk.focus() : self.clients.openWindow('/desk#desk');
    })
  );
});
