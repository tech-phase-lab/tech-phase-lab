/* Push only: no fetch handler and no cached private/API responses. */
// Version 2026-11-15 (iPhone: in-app banner for a new notice, step record): changing this file is what makes installed phones pick up the new worker.
const VERSION = "2026-11-15-inapp-banner";
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
// Nov 15 (iPhone home-screen app): navigate(), a message to a suspended page and openWindow() may each return without the app
// moving, and a tap on an app that is already open may not reach this worker at all (WebKit bugs 252544, 259212, 263687, 282935).
// So the tap is written down FIRST and the app reads it when it is shown again (lib/research/push-open.ts). The latest notice shown
// is written down too (with its title), so an app that is never told about the tap shows an in-app banner for it. Only a page path,
// an id, a tag, the title and a time are kept: never a response, a member or a key. Keep these names in step with lib/research/push-open.ts.
const STORE = "tech-phase-push-open";
const PENDING_KEY = "/research-sw/pending-open";
const DELIVERED_KEY = "/research-sw/delivered";
// Nov 15: the steps this worker saw for the latest notice (times, yes/no answers, VERSION and the notice's random id only, never its
// title or page), so the owner's app can say which step failed (lib/research/push-diagnostic.ts).
const DIAG_KEY = "/research-sw/diagnostic";
const ID = /^[A-Za-z0-9-]{1,64}$/;
function destination(value) {
  if (value === undefined || value === null) return LEGACY_TARGET;
  if (typeof value !== "string" || value.length > 200 || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return SAFE_TARGET;
  const hash = value.indexOf("#");
  const path = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? "" : value.slice(hash);
  if (!OPENABLE.has(path) || (fragment && !FRAGMENT.test(fragment))) return SAFE_TARGET;
  return path + fragment;
}
function noticeId() {
  try { if (self.crypto && typeof self.crypto.randomUUID === "function") return self.crypto.randomUUID(); } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const keyRequest = key => new Request(new URL(key, self.location.origin).href);
async function remember(key, record) {
  try {
    const store = await self.caches.open(STORE);
    await store.put(keyRequest(key), new Response(JSON.stringify(record), { headers: { "Content-Type": "application/json" } }));
  } catch { /* storage unavailable: the other ways of opening the page still run */ }
}
async function recall(key) {
  try {
    const found = await (await self.caches.open(STORE)).match(keyRequest(key));
    return found ? await found.json() : null;
  } catch { return null; }
}
// Forget a record; with an id, only when it is still that record (a newer tap must not be lost).
async function forget(key, id) {
  try {
    const store = await self.caches.open(STORE);
    if (id !== undefined) {
      const found = await store.match(keyRequest(key));
      const record = found ? await found.json().catch(() => null) : null;
      if (!record || record.id !== id) return;
    }
    await store.delete(keyRequest(key));
  } catch { /* nothing to forget */ }
}
function researchWindow(client) {
  try {
    const url = new URL(client.url);
    return url.origin === self.location.origin && url.pathname.startsWith("/research");
  } catch { return false; }
}
async function researchClients() {
  try { return (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(researchWindow); } catch { return []; }
}
// A new version takes over at once instead of waiting until every Tech Phase window is closed (iOS rarely closes the home-screen app).
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
async function deliver(payload) {
  const url = destination(payload.url);
  const id = noticeId();
  const tag = String(payload.tag || "tech-phase").slice(0, 100);
  const title = payload.title.slice(0, 100);
  const diag = { v: VERSION, id, push: Date.now() };
  await remember(DIAG_KEY, diag);
  await self.registration.showNotification(title, {
    body: payload.body.slice(0, 300), tag, renotify: false, data: { url, id },
  });
  diag.shown = Date.now();
  // Whether this phone lists shown notices. Kept for the step record only: a notice gone from the list is no longer taken for a tap
  // (a notice swiped away would have opened its page too); the app shows an in-app banner instead.
  let listed = null;
  if (typeof self.registration.getNotifications === "function") {
    try { listed = (await self.registration.getNotifications({ tag })).some(notice => notice.data?.id === id); } catch { listed = null; }
  }
  diag.listApi = listed !== null; diag.listed = listed;
  await remember(DIAG_KEY, diag);
  // The title stays on this device, for the app's banner (「新しい通知：…」) when the app is shown within 2 minutes.
  const record = { id, url, tag, title, at: Date.now(), listed: listed === true };
  await remember(DELIVERED_KEY, record);
  for (const client of await researchClients()) { try { client.postMessage({ type: "delivered", ...record, version: VERSION }); } catch { /* page gone */ } }
}
self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string") return;
  event.waitUntil(deliver(payload));
});
// Ask an open app page to go to the notice's page itself (research layout: PushOpenListener). It answers on the port once it has.
function askToOpen(client, path, id) {
  return new Promise((resolve) => {
    let channel;
    try { channel = new MessageChannel(); } catch { resolve(false); return; }
    const timer = setTimeout(() => { channel.port1.onmessage = null; resolve(false); }, ACK_TIMEOUT_MS);
    channel.port1.onmessage = (message) => {
      if (message.data?.type !== "opened") return;
      clearTimeout(timer); channel.port1.onmessage = null; resolve(true);
    };
    try { client.postMessage({ type: "open", url: path, id, version: VERSION }, [channel.port2]); } catch { clearTimeout(timer); resolve(false); }
  });
}
async function focus(client) { try { await client.focus(); } catch { /* already in front, or not allowed: the page is shown either way */ } }
// Nov 15: a 銘柄手帳 tap showed the page the app was last on. navigate() rejects for a window this worker does not control
// (matchAll includes those) and is unreliable in the iOS home-screen app; the rejection ended the handler before anything was opened.
// Now each step may fail without stopping the next: navigate, then a message to the page, then a new window.
async function openTarget(path, id) {
  const target = new URL(path, self.location.origin).href;
  const candidates = (await researchClients()).sort((a, b) => Number(Boolean(b.focused)) - Number(Boolean(a.focused)));
  for (const client of candidates) {
    if (typeof client.navigate === "function") {
      try {
        const navigated = await client.navigate(target);
        if (navigated) { await focus(navigated); return; }
      } catch { /* not controlled by this worker, or not supported here: ask the page instead */ }
    }
    await focus(client);
    if (await askToOpen(client, path, id)) return;
  }
  await self.clients.openWindow(target);
}
async function tapped(notification) {
  const path = destination(notification.data?.url);
  const given = notification.data?.id;
  const id = typeof given === "string" && ID.test(given) ? given : noticeId();
  // Write the tap down before anything else: on iOS each step below can return without the app having moved.
  await remember(PENDING_KEY, { id, url: path, at: Date.now() });
  await forget(DELIVERED_KEY);
  const diag = await recall(DIAG_KEY);
  await remember(DIAG_KEY, diag && diag.id === id ? { ...diag, click: Date.now() } : { v: VERSION, id, click: Date.now() });
  try { await openTarget(path, id); } catch { /* the app reads the written tap when it is shown */ }
}
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(tapped(event.notification));
});
// The app asks this worker for the written tap (also from a page it does not control, through registration.active): on iOS the
// page may not see what the worker just wrote until it reloads. The app says which tap it has opened, and that one is forgotten.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const port = event.ports?.[0];
  if (data.type === "pending-query" && port) {
    event.waitUntil((async () => {
      const [pending, delivered, diag] = await Promise.all([recall(PENDING_KEY), recall(DELIVERED_KEY), recall(DIAG_KEY)]);
      try { port.postMessage({ type: "pending", pending, delivered, diag, version: VERSION }); } catch { /* page gone */ }
    })());
  } else if (data.type === "pending-clear" && typeof data.id === "string" && ID.test(data.id)) {
    event.waitUntil(Promise.all([forget(PENDING_KEY, data.id), forget(DELIVERED_KEY, data.id)]));
  }
});
