/* Push only: no fetch handler and no cached private/API responses. */
self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string") return;
  event.waitUntil(self.registration.showNotification(payload.title.slice(0, 100), {
    body: payload.body.slice(0, 300), tag: String(payload.tag || "tech-phase").slice(0, 100),
    renotify: false, data: { url: "/research#what-changed" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/research#what-changed", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith("/research")) {
        await client.navigate(target); return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
