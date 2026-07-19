// sw.js — must stay at the site root (the same folder as index.html, e.g.
// alongside it in your Work-Order/ folder), so its scope covers the whole
// site. Handles two things:
//  1. "push" — a push arrived from the server; show a real OS notification.
//  2. "notificationclick" — user tapped the notification; focus/open the app.
//
// Every path in this file is RELATIVE (no leading "/") on purpose — that
// makes it resolve correctly whether the site lives at the root of a
// domain or under a subpath like yourname.github.io/Work-Order/.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'E-Office', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'E-Office';
  const options = {
    body: data.body || '',
    icon: 'favicon-512.png',       // the small app icon shown next to the notification
    badge: 'favicon-32.png',       // monochrome status-bar icon (Android)
    image: 'notif-banner.png',     // big banner shown when the notification expands
    vibrate: [200, 100, 200],      // short buzz pattern to help it catch attention on mobile
    requireInteraction: false,
    data: { url: data.url || null },
    tag: data.tag || undefined
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // self.registration.scope is the actual URL this service worker controls
  // (e.g. https://yourname.github.io/Work-Order/) — always correct,
  // regardless of whether the site is at a domain root or a subpath.
  const targetUrl = (event.notification.data && event.notification.data.url) || self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
