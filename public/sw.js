// Motko service worker — push delivery only. Deliberately minimal: no offline
// caching or asset interception (the app is server-rendered and the App Store
// is the install path), just the two handlers a browser needs to receive a web
// push and route the tap. Payloads are the JSON shape sendWebPush serialises:
// { event, title, body, url }.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Motko";
  const options = {
    body: payload.body || "",
    // Group a job's alerts so repeated updates collapse rather than stack.
    tag: payload.url || "motko",
    data: { url: payload.url || "/dashboard" },
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab on the target if one is already open.
        for (const client of clientList) {
          if (client.url.includes(url) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
        return undefined;
      }),
  );
});
