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

function worker(windows = []) {
  const listeners = {}, shown = [], log = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    skipWaiting: () => log.push(["skipWaiting"]),
    registration: { showNotification: (title, options) => { shown.push({ title, options }); return Promise.resolve(); } },
    clients: {
      matchAll: async options => { assert.equal(JSON.stringify(options), JSON.stringify({ type: "window", includeUncontrolled: true })); return windows.map(([url, options]) => windowClient(url, options, log)); },
      openWindow: async target => { log.push(["open", target]); },
      claim: async () => log.push(["claim"]),
    },
  };
  // The acknowledgement wait is shortened to 50 ms in tests; a page that answers does so well within it.
  const shortTimeout = fn => setTimeout(fn, 50);
  vm.runInNewContext(source, { self, URL, Set, Promise, String, Number, Boolean, MessageChannel, setTimeout: shortTimeout, clearTimeout, queueMicrotask });
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
  return { push, click, shown, log, listeners };
}

const sent = async url => (await worker().push({ title: "t", body: "b", ...(url === undefined ? {} : { url }) })).options.data.url;
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
  assert.deepEqual(w.log, [["navigate", `${ORIGIN}/research/notebook`], ["focus", `${ORIGIN}/research/notebook`]]);
});

test("Nov 15: navigate() failing no longer leaves the app on its last page; the page is asked to move", async () => {
  for (const navigate of ["reject", "missing"]) {
    const w = worker([[`${ORIGIN}/research/compare`, { navigate }]]);
    await w.click({ url: "/research/notebook" });
    assert.deepEqual(w.log.filter(([kind]) => kind !== "navigate-failed"),
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
  assert.deepEqual(other.log, [["open", `${ORIGIN}/research/weekly`]]);
});

test("a new worker takes over at once so installed phones get this version", async () => {
  const w = worker();
  assert.match(source, /const VERSION = "2026-11-15-open-target"/);
  w.listeners.install({});
  let waiting;
  w.listeners.activate({ waitUntil: p => { waiting = p; } });
  await waiting;
  assert.deepEqual(w.log, [["skipWaiting"], ["claim"]]);
});
