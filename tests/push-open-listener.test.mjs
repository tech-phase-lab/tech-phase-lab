import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { browserPushOpenSources, createPushOpener, handlePushOpenMessage, pushOpenPath, pushRecord, PUSH_OPENABLE, PENDING_OPEN_MAX_AGE_MS } from "../lib/research/push-open.ts";
import targets from "../lib/research/push-targets.json" with { type: "json" };

const here = { origin: "https://techphase.app", pathname: "/research/compare", hash: "" };
function receive(data, location = here, extra = {}) {
  const moves = [], answers = [];
  const result = handlePushOpenMessage({ data, origin: location.origin, ports: [{ postMessage: m => answers.push(m) }], ...extra }, location,
    { push: href => moves.push(["push", href]), setHash: hash => moves.push(["hash", hash]) });
  return { result, moves, answers };
}

test("the app accepts the same pages as the service worker", () => {
  assert.deepEqual([...PUSH_OPENABLE].sort(), [...targets.openable].sort());
  for (const path of targets.openable) assert.equal(pushOpenPath({ type: "open", url: path }), path);
  assert.equal(pushOpenPath({ type: "open", url: "/research#what-changed" }), "/research#what-changed");
});

test("Nov 15: an open message moves the app from its last page to the notice's page and confirms", () => {
  const { result, moves, answers } = receive({ type: "open", url: "/research/notebook" });
  assert.equal(result, "/research/notebook");
  assert.deepEqual(moves, [["push", "/research/notebook"]]);
  assert.deepEqual(answers, [{ type: "opened" }]);
});

test("a fragment on the page already shown changes only the hash, so the page's own view switch runs", () => {
  assert.deepEqual(receive({ type: "open", url: "/research#what-changed" }, { ...here, pathname: "/research" }).moves, [["hash", "#what-changed"]]);
  assert.deepEqual(receive({ type: "open", url: "/research#what-changed" }, { ...here, pathname: "/research", hash: "#what-changed" }).moves, []);
  assert.deepEqual(receive({ type: "open", url: "/research/qa#q-0123456789abcdef0123456789abcdef" }).moves, [["push", "/research/qa#q-0123456789abcdef0123456789abcdef"]]);
});

test("anything off the list, of another kind or from another origin is ignored and not confirmed", () => {
  for (const data of [null, "open", { type: "other", url: "/research/news" }, { type: "open" }, { type: "open", url: "/admin" },
    { type: "open", url: "javascript:alert(1)" }, { type: "open", url: "//evil.example/research" }, { type: "open", url: "https://evil.example/research" },
    { type: "open", url: "/research/calendar?x=1" }, { type: "open", url: "/research#<x>" }, { type: "open", url: "/" }]) {
    const { result, moves, answers } = receive(data);
    assert.equal(result, null, JSON.stringify(data));
    assert.deepEqual(moves, []); assert.deepEqual(answers, []);
  }
  assert.equal(receive({ type: "open", url: "/research/news" }, here, { origin: "https://evil.example" }).result, null);
});

test("the listener is mounted in the research layout and listens to the service worker", () => {
  const layout = fs.readFileSync(new URL("../app/research/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /import PushOpenListener from "\.\/push-open-listener";/);
  assert.match(layout, /<PushOpenListener \/>/);
  const listener = fs.readFileSync(new URL("../app/research/push-open-listener.tsx", import.meta.url), "utf8");
  assert.match(listener, /^"use client";/);
  assert.match(listener, /navigator\.serviceWorker[\s\S]*addEventListener\("message", onMessage\)/);
  assert.match(listener, /opener\.message\(event\)/);
  for (const name of ["pageshow", "focus"]) assert.match(listener, new RegExp(`window\\.addEventListener\\("${name}", look\\)`));
  assert.match(listener, /document\.addEventListener\("visibilitychange", look\)/);
  assert.match(listener, /browserPushOpenSources\(container/);
  assert.match(listener, /removeEventListener\("message", onMessage\)/);
  assert.match(listener, /registration\?\.update\(\)/);
});

// Nov 15 (iPhone home-screen app): the tap the worker wrote down is read when the app is shown again, and opened once.
const NOW = 1_800_000_000_000;
function opener({ pending = null, delivered = null, shown = null, at = { pathname: "/research", hash: "" } } = {}) {
  const moves = [], cleared = [];
  const store = { pending, delivered };
  const o = createPushOpener({
    sources: {
      read: async () => ({ ...store }),
      clear: async id => { cleared.push(id); if (store.pending?.id === id) store.pending = null; if (store.delivered?.id === id) store.delivered = null; },
      shown: async () => typeof shown === "function" ? shown() : shown,
    },
    location: () => ({ origin: here.origin, ...at }),
    navigation: { push: href => moves.push(["push", href]), setHash: hash => moves.push(["hash", hash]) },
    now: () => NOW,
  });
  return { o, moves, cleared, store };
}
const tap = (url, extra = {}) => ({ id: "tap-1", url, at: NOW - 5_000, ...extra });

test("Nov 15: a written tap is opened when the app is shown again, once, and then forgotten", async () => {
  const { o, moves, cleared } = opener({ pending: tap("/research/notifications") });
  assert.equal(await o.check(), "/research/notifications");
  assert.equal(await o.check(), null);
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
  assert.deepEqual(cleared, ["tap-1"]);
});

test("looks made at the same moment (focus, pageshow, visibilitychange) share one read and move the app once", async () => {
  const { o, moves } = opener({ pending: tap("/research/notebook") });
  await Promise.all([o.check(), o.check(), o.check()]);
  assert.deepEqual(moves, [["push", "/research/notebook"]]);
});

test("the worker's message and the written tap for the same notice move the app once, whichever comes first", async () => {
  const first = opener({ pending: tap("/research/notebook") });
  const answers = [];
  assert.equal(first.o.message({ data: { type: "open", url: "/research/notebook", id: "tap-1" }, origin: here.origin, ports: [{ postMessage: m => answers.push(m) }] }), "/research/notebook");
  assert.equal(await first.o.check(), null);
  assert.deepEqual(first.moves, [["push", "/research/notebook"]]);
  assert.deepEqual(answers, [{ type: "opened" }]);
  const second = opener({ pending: tap("/research/notebook") });
  await second.o.check();
  const late = [];
  assert.equal(second.o.message({ data: { type: "open", url: "/research/notebook", id: "tap-1" }, origin: here.origin, ports: [{ postMessage: m => late.push(m) }] }), null);
  assert.deepEqual(second.moves, [["push", "/research/notebook"]]);
  assert.deepEqual(late, [{ type: "opened" }], "the worker still hears that the page is there");
});

test("an old, off-list or odd tap is never opened, and is forgotten when it has a usable id", async () => {
  for (const pending of [tap("/research/news", { at: NOW - PENDING_OPEN_MAX_AGE_MS - 1 }), tap("/admin"), tap("https://evil.example/"), tap("/research/news", { id: "<x>" }), tap("/research/news", { at: "soon" }), "x"]) {
    const { o, moves } = opener({ pending });
    assert.equal(await o.check(), null, JSON.stringify(pending));
    assert.deepEqual(moves, []);
  }
  const { o, cleared } = opener({ pending: tap("/research/news", { at: NOW - PENDING_OPEN_MAX_AGE_MS - 1 }) });
  await o.check();
  assert.deepEqual(cleared, ["tap-1"]);
});

test("a tap for the page already shown does not reload it; a fragment still switches the view", async () => {
  const same = opener({ pending: tap("/research/notifications"), at: { pathname: "/research/notifications", hash: "" } });
  await same.o.check();
  assert.deepEqual(same.moves, []);
  assert.deepEqual(same.cleared, ["tap-1"]);
  const fragment = opener({ pending: tap("/research#what-changed") });
  await fragment.o.check();
  assert.deepEqual(fragment.moves, [["hash", "#what-changed"]]);
  const elsewhere = opener({ pending: tap("/research/qa#q-0123456789abcdef0123456789abcdef"), at: { pathname: "/research/compare", hash: "" } });
  await elsewhere.o.check();
  assert.deepEqual(elsewhere.moves, [["push", "/research/qa#q-0123456789abcdef0123456789abcdef"]]);
});

test("WebKit 282935: when iOS never tells the worker about a tap, a listed notice that has gone from the phone opens its page", async () => {
  let ids = ["n-1"];
  const notice = { id: "n-1", url: "/research/notifications", at: NOW - 3_000, tag: "tech-phase-test", listed: true };
  const { o, moves } = opener({ shown: () => ids });
  o.message({ data: { type: "delivered", ...notice }, origin: here.origin });
  assert.equal(o.watching(), true);
  assert.equal(await o.check(), null, "still on the phone: not tapped");
  ids = [];
  assert.equal(await o.check(), "/research/notifications");
  assert.equal(await o.check(), null);
  assert.equal(o.watching(), false);
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
});

test("a vanished notice is not taken for a tap when the phone never listed it, cannot say, or it is old", async () => {
  const base = { id: "n-1", url: "/research/news", at: NOW - 3_000, tag: "t", listed: true };
  for (const [delivered, shown] of [[{ ...base, listed: false }, []], [base, null], [{ ...base, at: NOW - PENDING_OPEN_MAX_AGE_MS - 1 }, []]]) {
    const { o, moves } = opener({ delivered, shown });
    assert.equal(await o.check(), null, JSON.stringify(delivered));
    assert.deepEqual(moves, []);
  }
});

test("a delivered message from another origin, or a malformed one, is ignored", async () => {
  const { o } = opener({ shown: [] });
  o.message({ data: { type: "delivered", id: "n-1", url: "/research/news", at: NOW, tag: "t", listed: true }, origin: "https://evil.example" });
  o.message({ data: { type: "delivered", id: "n-2", url: "/admin", at: NOW, tag: "t", listed: true }, origin: here.origin });
  assert.equal(o.watching(), false);
  assert.equal(await o.check(), null);
  assert.equal(pushRecord({ id: "a", url: "/research", at: NOW + 60_000 }, NOW), null, "a time from the future is refused");
});

// The browser side: the worker is asked first (controller, or registration.active when the page is not controlled), then Cache Storage.
function browser({ controlled = true, answer = true, records = {} } = {}) {
  const posted = [];
  const worker = { postMessage: (message, ports) => {
    posted.push(message);
    if (message.type === "pending-query" && answer) queueMicrotask(() => ports[0].onmessage?.({ data: { type: "pending", pending: records.pending ?? null, delivered: records.delivered ?? null } }));
  } };
  const registration = { active: worker, getNotifications: async ({ tag } = {}) => [{ data: { id: "n-1", url: "/research" }, tag }] };
  const container = { controller: controlled ? worker : null, getRegistration: async () => registration };
  const files = new Map(Object.entries(records.store ?? {}).map(([key, value]) => [`${here.origin}${key}`, JSON.stringify(value)]));
  const caches = { open: async () => ({
    match: async url => files.has(url) ? { json: async () => JSON.parse(files.get(url)) } : undefined,
    delete: async url => files.delete(url),
  }) };
  const channel = () => { const port1 = { onmessage: null, close() {} }; return { port1, port2: port1 }; };
  const timers = [];
  const sources = browserPushOpenSources(container, caches, here.origin, channel, fn => timers.push(fn));
  return { sources, posted, files, timers };
}

test("the app asks the worker for the tap even before the worker controls the page", async () => {
  for (const controlled of [true, false]) {
    const b = browser({ controlled, records: { pending: tap("/research/notebook") } });
    const read = await b.sources.read();
    assert.equal(read.pending.id, "tap-1", String(controlled));
    assert.deepEqual(b.posted, [{ type: "pending-query" }]);
  }
});

test("when the worker does not answer, the app reads Cache Storage itself; clearing removes only the opened tap", async () => {
  const b = browser({ answer: false, records: { store: { "/research-sw/pending-open": tap("/research/news"), "/research-sw/delivered": { id: "n-9", url: "/research", at: NOW } } } });
  const reading = b.sources.read();
  await new Promise(resolve => setImmediate(resolve));
  for (const fn of b.timers) fn();
  const read = await reading;
  assert.equal(read.pending.id, "tap-1"); assert.equal(read.delivered.id, "n-9");
  await b.sources.clear("tap-1");
  assert.deepEqual([...b.files.keys()], [`${here.origin}/research-sw/delivered`]);
  assert.deepEqual(b.posted.at(-1), { type: "pending-clear", id: "tap-1" });
  assert.deepEqual(await b.sources.shown("t"), ["n-1"]);
});
