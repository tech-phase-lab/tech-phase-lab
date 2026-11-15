import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import targets from "../lib/research/push-targets.json" with { type: "json" };

const source = fs.readFileSync(new URL("../public/research-sw.js", import.meta.url), "utf8");
const ORIGIN = "https://techphase.app";

// A window the worker sees. navigate: "ok" (moves and resolves), "reject" (not controlled / unsupported on iOS), "missing" (no method).
// answer: whether the page's PushOpenListener confirms the message.
function windowClient(url, { navigate = "ok", answer = true, focused = false } = {}, log) {
  const client = { url, focused, focus: async () => { log.push(["focus", url]); return client; },
    postMessage: (message, ports) => {
      log.push(["message", url, message.url]);
      if (answer) queueMicrotask(() => ports[0].postMessage({ type: "opened" }));
    } };
  if (navigate !== "missing") client.navigate = async target => {
    if (navigate === "reject") { log.push(["navigate-failed", url]); throw new TypeError("not controlled"); }
    log.push(["navigate", target]); return windowClient(target, {}, log);
  };
  return client;
}

// Cache Storage as the worker sees it: one store, records kept as JSON text. Writes are logged so their order can be checked.
function cacheStorage(log) {
  const stores = new Map();
  return { stores, open: async name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      put: async (request, response) => { const text = await response.text(); log.push(["store", new URL(request.url).pathname]); store.set(request.url, text); },
      match: async request => store.has(request.url) ? new Response(store.get(request.url)) : undefined,
      delete: async request => { log.push(["forget", new URL(request.url).pathname]); return store.delete(request.url); },
    };
  } };
}

function worker(windows = [], { listed = true } = {}) {
  const listeners = {}, shown = [], log = [];
  const caches = cacheStorage(log);
  let ids = 0;
  const self = {
    location: { origin: ORIGIN },
    caches,
    crypto: { randomUUID: () => `id-${++ids}` },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    skipWaiting: () => log.push(["skipWaiting"]),
    registration: {
      showNotification: (title, options) => { shown.push({ title, options }); return Promise.resolve(); },
      getNotifications: async () => listed ? shown.map(({ options }) => ({ data: options.data })) : [],
    },
    clients: {
      matchAll: async options => { assert.equal(JSON.stringify(options), JSON.stringify({ type: "window", includeUncontrolled: true })); return windows.map(([url, options]) => windowClient(url, options, log)); },
      openWindow: async target => { log.push(["open", target]); },
      claim: async () => log.push(["claim"]),
    },
  };
  // The acknowledgement wait is shortened to 50 ms in tests; a page that answers does so well within it.
  const shortTimeout = fn => setTimeout(fn, 50);
  vm.runInNewContext(source, { self, URL, Set, Promise, String, Number, Boolean, MessageChannel, Request, Response, JSON, Date, Math, setTimeout: shortTimeout, clearTimeout, queueMicrotask });
  const push = async data => {
    let waiting;
    await listeners.push({ data: { json: () => data }, waitUntil: p => { waiting = p; } });
    await waiting;
    return shown.at(-1);
  };
  const click = async data => {
    let waiting;
    listeners.notificationclick({ notification: { data, close() {} }, waitUntil: p => { waiting = p; } });
    await waiting;
  };
  const record = async key => {
    const store = caches.stores.get("tech-phase-push-open");
    const text = store?.get(`${ORIGIN}${key}`);
    return text === undefined ? null : JSON.parse(text);
  };
  const ask = async data => {
    const channel = new MessageChannel();
    const answer = new Promise(resolve => { channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); }; });
    let waiting;
    listeners.message({ data, ports: [channel.port2], waitUntil: p => { waiting = p; } });
    await waiting;
    if (data?.type === "pending-query") return answer;
    channel.port1.close();
    return undefined;
  };
  return { push, click, shown, log, listeners, record, ask };
}

const sent = async url => (await worker().push({ title: "t", body: "b", ...(url === undefined ? {} : { url }) })).options.data.url;
const moves = log => log.filter(([kind]) => kind !== "store" && kind !== "forget");
const opened = log => log.filter(([kind]) => kind === "open").map(([, url]) => url);

test("the worker's page list is the shared list in lib/research/push-targets.json", () => {
  const block = /const OPENABLE = new Set\(\[([\s\S]*?)\]\)/.exec(source)[1];
  assert.deepEqual([...block.matchAll(/"([^"]+)"/g)].map(m => m[1]).sort(), [...targets.openable].sort());
  assert.equal(/const FRAGMENT = \/(.+)\/;/.exec(source)[1], targets.fragment);
  for (const path of targets.openable) assert.ok(fs.existsSync(new URL(`../app${path}/page.tsx`, import.meta.url)), path);
});

test("known research pages are kept, with or without a hash", async () => {
  for (const url of [...targets.openable, "/research#what-changed", "/research/qa#q-0123456789abcdef0123456789abcdef"]) {
    assert.equal(await sent(url), url);
  }
});

test("unknown paths, queries, other origins and tricks fall back to /research", async () => {
  for (const url of ["/", "/admin", "/research/other", "/research/calendar/x", "/research/calendar?x=1", "/research/calendar#a b", "/research#<x>",
    "https://evil.example/research/calendar", "https://techphase.app/research/calendar", "//evil.example/research/calendar",
    "/\\evil.example", "javascript:alert(1)", "research/calendar", "", 5, {}, "/research/" + "a".repeat(300)]) {
    assert.equal(await sent(url), "/research", String(url));
  }
});

test("an old notice without a url still opens price targets", async () => {
  assert.equal(await sent(undefined), "/research/price-targets");
  const w = worker();
  await w.click({});
  await w.click(undefined);
  assert.deepEqual(opened(w.log), [`${ORIGIN}/research/price-targets`, `${ORIGIN}/research/price-targets`]);
});

test("with no app window open, a tap opens the notice's page and never an external URL", async () => {
  const w = worker();
  await w.click({ url: "/research/notebook" });
  await w.click({ url: "/research#what-changed" });
  await w.click({ url: "https://evil.example/" });
  assert.deepEqual(opened(w.log), [`${ORIGIN}/research/notebook`, `${ORIGIN}/research#what-changed`, `${ORIGIN}/research`]);
});

test("an open research window that this worker controls is navigated and focused", async () => {
  const w = worker([[`${ORIGIN}/research/compare`]]);
  await w.click({ url: "/research/notebook" });
  assert.deepEqual(moves(w.log), [["navigate", `${ORIGIN}/research/notebook`], ["focus", `${ORIGIN}/research/notebook`]]);
});

test("Nov 15: navigate() failing no longer leaves the app on its last page; the page is asked to move", async () => {
  for (const navigate of ["reject", "missing"]) {
    const w = worker([[`${ORIGIN}/research/compare`, { navigate }]]);
    await w.click({ url: "/research/notebook" });
    assert.deepEqual(moves(w.log).filter(([kind]) => kind !== "navigate-failed"),
      [["focus", `${ORIGIN}/research/compare`], ["message", `${ORIGIN}/research/compare`, "/research/notebook"]], navigate);
  }
});

test("when the page does not confirm, a window is opened at the notice's page", async () => {
  const w = worker([[`${ORIGIN}/research/compare`, { navigate: "reject", answer: false }]]);
  await w.click({ url: "/research/qa#q-0123456789abcdef0123456789abcdef" });
  assert.deepEqual(w.log.at(-1), ["open", `${ORIGIN}/research/qa#q-0123456789abcdef0123456789abcdef`]);
  assert.ok(w.log.some(([kind]) => kind === "message"));
});

test("the focused window is tried first; other sites and non-research pages are left alone", async () => {
  const w = worker([[`${ORIGIN}/research/news`, { navigate: "reject" }], [`${ORIGIN}/research/compare`, { navigate: "reject", focused: true }]]);
  await w.click({ url: "/research/calendar" });
  assert.deepEqual(w.log.filter(([kind]) => kind === "message"), [["message", `${ORIGIN}/research/compare`, "/research/calendar"]]);
  const other = worker([["https://evil.example/research"], [`${ORIGIN}/resolute`]]);
  await other.click({ url: "/research/weekly" });
  assert.deepEqual(moves(other.log), [["open", `${ORIGIN}/research/weekly`]]);
});

test("a new worker takes over at once so installed phones get this version", async () => {
  const w = worker();
  assert.match(source, /const VERSION = "2026-11-15-pending-open"/);
  w.listeners.install({});
  let waiting;
  w.listeners.activate({ waitUntil: p => { waiting = p; } });
  await waiting;
  assert.deepEqual(w.log, [["skipWaiting"], ["claim"]]);
});

// Nov 15 (iPhone home-screen app): navigate(), a message to the page and openWindow() can each return without the app moving
// (WebKit bugs 252544, 259212, 263687, 282935), so the tap is written down before any of them and the app reads it when shown.
test("a tap is written down before the worker tries to move the app, with the notice's id and the time", async () => {
  const w = worker([[`${ORIGIN}/research`]]);
  const before = Date.now();
  await w.click({ url: "/research/notifications", id: "abc-123" });
  assert.deepEqual(w.log.slice(0, 2), [["store", "/research-sw/pending-open"], ["forget", "/research-sw/delivered"]]);
  assert.deepEqual(w.log[2], ["navigate", `${ORIGIN}/research/notifications`]);
  const pending = await w.record("/research-sw/pending-open");
  assert.equal(pending.id, "abc-123"); assert.equal(pending.url, "/research/notifications");
  assert.ok(pending.at >= before && pending.at <= Date.now());
  assert.deepEqual(Object.keys(pending).sort(), ["at", "id", "url"]);
});

test("the written tap is checked like the notice url, and an odd id is replaced", async () => {
  const w = worker();
  await w.click({ url: "https://evil.example/", id: "<script>" });
  const pending = await w.record("/research-sw/pending-open");
  assert.equal(pending.url, "/research"); assert.match(pending.id, /^[A-Za-z0-9-]{1,64}$/); assert.notEqual(pending.id, "<script>");
});

test("the message to an open page carries the tap's id, and a page that answers still leaves the written tap for the app", async () => {
  const w = worker([[`${ORIGIN}/research`, { navigate: "reject" }]]);
  await w.click({ url: "/research/notebook", id: "n-1" });
  assert.ok(w.log.some(([kind, , url]) => kind === "message" && url === "/research/notebook"));
  assert.equal((await w.record("/research-sw/pending-open")).id, "n-1");
});

test("a shown notice is written down with an id, its tag and whether the phone lists it, and open research pages are told", async () => {
  const w = worker([[`${ORIGIN}/research`, { answer: false }], ["https://evil.example/research", { answer: false }]]);
  const shown = await w.push({ title: "t", body: "b", url: "/research/notifications", tag: "tech-phase-test" });
  assert.deepEqual(JSON.parse(JSON.stringify(shown.options.data)), { url: "/research/notifications", id: "id-1" });
  const delivered = await w.record("/research-sw/delivered");
  assert.deepEqual({ ...delivered, at: 0 }, { id: "id-1", url: "/research/notifications", tag: "tech-phase-test", at: 0, listed: true });
  assert.deepEqual(w.log.filter(([kind]) => kind === "message"), [["message", `${ORIGIN}/research`, "/research/notifications"]]);
  const unlisted = worker([], { listed: false });
  await unlisted.push({ title: "t", body: "b" });
  assert.equal((await unlisted.record("/research-sw/delivered")).listed, false);
});

test("the app can ask the worker for the written tap (also when not controlled) and clear only the one it opened", async () => {
  const w = worker();
  await w.push({ title: "t", body: "b", url: "/research/news" });
  await w.click({ url: "/research/notifications", id: "tap-1" });
  const answer = await w.ask({ type: "pending-query" });
  assert.equal(answer.type, "pending"); assert.equal(answer.pending.id, "tap-1"); assert.equal(answer.delivered, null);
  await w.ask({ type: "pending-clear", id: "other" });
  assert.equal((await w.record("/research-sw/pending-open")).id, "tap-1");
  await w.ask({ type: "pending-clear", id: "tap-1" });
  assert.equal(await w.record("/research-sw/pending-open"), null);
  await w.ask({ type: "pending-clear", id: "<bad>" });
  await w.ask(null);
});
