/* Push only: no fetch handler and no cached private/API responses. */
// Version 2026-11-15 (open the notice's page): changing this file is what makes installed phones pick up the new worker.
const VERSION = "2026-11-15-open-target";
// Where a notification tap may go (Nov 13: every tap used to open the price-target page, whatever the notice was about).
// Only a same-origin path on this list is opened; anything else falls back to /research.
// Keep in step with lib/research/push-targets.json (tests/research-sw-click-target.test.mjs checks they match).
const OPENABLE = new Set([
  "/research", "/research/calendar", "/research/news", "/research/notebook", "/research/notes",
  "/research/notifications", "/research/price-targets", "/research/qa", "/research/questions", "/research/weekly",
]);
const FRAGMENT = /^#[a-z0-9-]{1,40}$/;
const LEGACY_TARGET = "/research/price-targets"; // notices sent before the payload carried a url
const SAFE_TARGET = "/research";
// How long an open app page has to confirm it moved to the notice's page before a window is opened for it instead.
const ACK_TIMEOUT_MS = 1500;
function destination(value) {
  if (value === undefined || value === null) return LEGACY_TARGET;
  if (typeof value !== "string" || value.length > 200 || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return SAFE_TARGET;
  const hash = value.indexOf("#");
  const path = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? "" : value.slice(hash);
  if (!OPENABLE.has(path) || (fragment && !FRAGMENT.test(fragment))) return SAFE_TARGET;
  return path + fragment;
}
// A new version takes over at once instead of waiting until every Tech Phase window is closed (iOS rarely closes the home-screen app).
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string") return;
  event.waitUntil(self.registration.showNotification(payload.title.slice(0, 100), {
    body: payload.body.slice(0, 300), tag: String(payload.tag || "tech-phase").slice(0, 100),
    renotify: false, data: { url: destination(payload.url) },
  }));
});
function researchWindow(client) {
  try {
    const url = new URL(client.url);
    return url.origin === self.location.origin && url.pathname.startsWith("/research");
  } catch { return false; }
}
// Ask an open app page to go to the notice's page itself (research layout: PushOpenListener). It answers on the port once it has.
function askToOpen(client, path) {
  return new Promise((resolve) => {
    let channel;
    try { channel = new MessageChannel(); } catch { resolve(false); return; }
    const timer = setTimeout(() => { channel.port1.onmessage = null; resolve(false); }, ACK_TIMEOUT_MS);
    channel.port1.onmessage = (message) => {
      if (message.data?.type !== "opened") return;
      clearTimeout(timer); channel.port1.onmessage = null; resolve(true);
    };
    try { client.postMessage({ type: "open", url: path, version: VERSION }, [channel.port2]); } catch { clearTimeout(timer); resolve(false); }
  });
}
async function focus(client) { try { await client.focus(); } catch { /* already in front, or not allowed: the page is shown either way */ } }
// Nov 15: a 銘柄手帳 tap showed the page the app was last on. navigate() rejects for a window this worker does not control
// (matchAll includes those) and is unreliable in the iOS home-screen app; the rejection ended the handler before anything was opened.
// Now each step may fail without stopping the next: navigate, then a message to the page, then a new window.
async function openTarget(path) {
  const target = new URL(path, self.location.origin).href;
  let windows = [];
  try { windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); } catch { windows = []; }
  const candidates = windows.filter(researchWindow).sort((a, b) => Number(Boolean(b.focused)) - Number(Boolean(a.focused)));
  for (const client of candidates) {
    if (typeof client.navigate === "function") {
      try {
        const navigated = await client.navigate(target);
        if (navigated) { await focus(navigated); return; }
      } catch { /* not controlled by this worker, or not supported here: ask the page instead */ }
    }
    await focus(client);
    if (await askToOpen(client, path)) return;
  }
  await self.clients.openWindow(target);
}
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTarget(destination(event.notification.data?.url)));
});
