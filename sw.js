// sw.js — must stay at the site root (not in a subfolder) so its scope
// covers the whole site. Handles two things:
//  1. "push" — a push arrived from the server; show a real OS notification.
//  2. "notificationclick" — user tapped the notification; focus/open the app.

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
    icon: data.icon || '/favicon-192.png',
    badge: data.badge || '/favicon-32.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
