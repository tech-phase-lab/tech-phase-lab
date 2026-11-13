/* Push only: no fetch handler and no cached private/API responses. */
// Where a notification tap may go (Nov 13: every tap used to open the price-target page, whatever the notice was about).
// Only a same-origin path on this list is opened; anything else falls back to /research.
const OPENABLE = new Set([
  "/research", "/research/calendar", "/research/news", "/research/weekly", "/research/notebook", "/research/notes",
  "/research/notifications", "/research/price-targets", "/research/questions",
]);
const LEGACY_TARGET = "/research/price-targets"; // notices sent before the payload carried a url
const SAFE_TARGET = "/research";
function destination(value) {
  if (value === undefined || value === null) return LEGACY_TARGET;
  if (typeof value !== "string" || value.length > 200 || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return SAFE_TARGET;
  const hash = value.indexOf("#");
  const path = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? "" : value.slice(hash);
  if (!OPENABLE.has(path) || (fragment && !/^#[a-z0-9-]{1,40}$/.test(fragment))) return SAFE_TARGET;
  return path + fragment;
}
self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string") return;
  event.waitUntil(self.registration.showNotification(payload.title.slice(0, 100), {
    body: payload.body.slice(0, 300), tag: String(payload.tag || "tech-phase").slice(0, 100),
    renotify: false, data: { url: destination(payload.url) },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(destination(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith("/research")) {
        await client.navigate(target); return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
