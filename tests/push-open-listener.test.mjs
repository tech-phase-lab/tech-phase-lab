import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { browserPushOpenSources, createPushOpener, handlePushOpenMessage, pushOpenPath, pushRecord, PUSH_BANNER_MS, PUSH_OPENABLE, PENDING_OPEN_MAX_AGE_MS } from "../lib/research/push-open.ts";
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
function opener({ pending = null, delivered = null, shown = null, at = { pathname: "/research", hash: "" }, diag = null, source = "worker" } = {}) {
  const moves = [], cleared = [], banners = [], notes = [], merged = [];
  const store = { pending, delivered };
  const o = createPushOpener({
    sources: {
      read: async () => ({ ...store, diag, source }),
      clear: async id => { cleared.push(id); if (store.pending?.id === id) store.pending = null; if (store.delivered?.id === id) store.delivered = null; },
      shown: async () => typeof shown === "function" ? shown() : shown,
    },
    location: () => ({ origin: here.origin, ...at }),
    navigation: { push: href => moves.push(["push", href]), setHash: hash => moves.push(["hash", hash]) },
    banner: notice => banners.push(notice),
    diagnostics: { note: (patch, id) => notes.push([patch, id]), fromWorker: value => merged.push(value) },
    now: () => NOW,
  });
  return { o, moves, cleared, store, banners, notes, merged };
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

// Nov 15, after #597: on the owner's iPhone a tap on a notice for an app already open still left it on the home page (WebKit 282935:
// notificationclick never fires). A notice that arrives while the app is shown, or within 2 minutes before it comes back, gets a banner.
const notice = (extra = {}) => ({ id: "n-1", url: "/research/notifications", at: NOW - 3_000, tag: "tech-phase-test", title: "Tech Phase · テスト通知", ...extra });

test("a notice that arrives while the app is shown puts up the banner at once; 開く goes to its page once", async () => {
  const { o, moves, banners, cleared, notes } = opener();
  o.message({ data: { type: "delivered", ...notice() }, origin: here.origin });
  assert.deepEqual(banners, [{ id: "n-1", path: "/research/notifications", title: "Tech Phase · テスト通知" }]);
  assert.deepEqual(o.banner(), banners[0]);
  assert.deepEqual(moves, [], "the banner never moves the app by itself");
  assert.equal(o.openBanner(), "/research/notifications");
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
  assert.equal(banners.at(-1), null, "hidden after 開く");
  assert.deepEqual(cleared, ["n-1"]);
  assert.equal(o.openBanner(), null);
  assert.equal(await o.check(), null);
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
  assert.ok(notes.some(([patch, id]) => id === "n-1" && patch.via === "banner" && patch.navigated === NOW));
  assert.ok(notes.some(([patch, id]) => id === "n-1" && patch.bannerOpen === NOW));
});

test("the app coming to the front within 2 minutes of a notice shows the banner from the worker's record; never after", async () => {
  const recent = opener({ delivered: notice() });
  assert.equal(await recent.o.check(), null);
  assert.deepEqual(recent.banners, [{ id: "n-1", path: "/research/notifications", title: "Tech Phase · テスト通知" }]);
  await recent.o.check();
  assert.equal(recent.banners.length, 1, "a second look does not put it up again");
  assert.deepEqual(recent.moves, []);
  const old = opener({ delivered: notice({ at: NOW - PENDING_OPEN_MAX_AGE_MS - 1 }) });
  await old.o.check();
  assert.deepEqual(old.banners, []);
});

test("✕ and the 15-second timer hide the banner for good and forget the notice; nothing moves", async () => {
  for (const reason of ["close", "timeout"]) {
    const { o, moves, banners, cleared, notes } = opener({ delivered: notice() });
    await o.check();
    o.dismissBanner(reason);
    assert.equal(banners.at(-1), null);
    assert.deepEqual(cleared, ["n-1"]);
    assert.equal(await o.check(), null);
    o.message({ data: { type: "delivered", ...notice() }, origin: here.origin });
    assert.equal(banners.length, 2, "the same notice is not shown again");
    assert.deepEqual(moves, []);
    assert.ok(notes.some(([patch]) => (reason === "close" ? patch.bannerClose : patch.bannerTimeout) === NOW), reason);
  }
  assert.equal(PUSH_BANNER_MS, 15_000);
});

test("a notice gone from the phone's list is no longer taken for a tap (a swiped-away notice must not move the app)", async () => {
  let ids = ["n-1"];
  const { o, moves, banners, notes } = opener({ delivered: notice(), shown: () => ids });
  await o.check();
  ids = [];
  await o.check();
  assert.deepEqual(moves, []);
  assert.equal(banners.length, 1);
  assert.deepEqual(notes.filter(([patch]) => "stillListed" in patch).map(([patch]) => patch.stillListed), [true, false], "recorded only");
  const unknown = opener({ delivered: notice(), shown: null });
  await unknown.o.check();
  assert.equal(unknown.notes.find(([patch]) => "stillListed" in patch)[0].stillListed, null);
});

test("a written tap still opens its page and takes down the banner for that notice", async () => {
  const { o, moves, banners } = opener();
  o.message({ data: { type: "delivered", ...notice({ id: "tap-1" }) }, origin: here.origin });
  const both = opener({ pending: tap("/research/notebook"), delivered: notice({ id: "tap-1", url: "/research/notebook" }) });
  assert.equal(await both.o.check(), "/research/notebook");
  assert.deepEqual(both.banners, []);
  assert.deepEqual(both.notes.filter(([patch]) => patch.via).map(([patch, id]) => [patch.via, id]), [["pending", "tap-1"]]);
  // A worker "open" message for the shown notice hides its banner too.
  o.message({ data: { type: "open", url: "/research/notifications", id: "tap-1" }, origin: here.origin, ports: [{ postMessage() {} }] });
  assert.equal(banners.at(-1), null);
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
});

test("each look hands the worker's step record on and notes whether the worker answered", async () => {
  const answered = opener({ diag: { v: "x", id: "n-1", push: NOW - 1000 } });
  await answered.o.check();
  assert.deepEqual(answered.merged, [{ v: "x", id: "n-1", push: NOW - 1000 }]);
  assert.deepEqual(answered.notes[0], [{ query: NOW }, undefined]);
  const silent = opener({ source: "store" });
  await silent.o.check();
  assert.deepEqual(silent.notes[0], [{ queryTimeout: NOW, store: NOW }, undefined]);
});

test("a delivered message from another origin, or a malformed one, is ignored", async () => {
  const { o, banners } = opener({ shown: [] });
  o.message({ data: { type: "delivered", id: "n-1", url: "/research/news", at: NOW, tag: "t" }, origin: "https://evil.example" });
  o.message({ data: { type: "delivered", id: "n-2", url: "/admin", at: NOW, tag: "t" }, origin: here.origin });
  assert.equal(o.banner(), null);
  assert.equal(await o.check(), null);
  assert.deepEqual(banners, []);
  assert.equal(pushRecord({ id: "a", url: "/research", at: NOW + 60_000 }, NOW), null, "a time from the future is refused");
  assert.equal(pushRecord({ id: "a", url: "/research", at: NOW, title: "a\u0000b\nc".padEnd(300, "x") }, NOW).title.length, 100);
  assert.equal(pushRecord({ id: "a", url: "/research", at: NOW, title: "a\u0000b\nc" }, NOW).title, "a b c");
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
    assert.equal(read.source, "worker");
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
  assert.equal(read.source, "store"); assert.equal(read.diag, null);
  await b.sources.clear("tap-1");
  assert.deepEqual([...b.files.keys()], [`${here.origin}/research-sw/delivered`]);
  assert.deepEqual(b.posted.at(-1), { type: "pending-clear", id: "tap-1" });
  assert.deepEqual(await b.sources.shown("t"), ["n-1"]);
});

test("the banner reads 「新しい通知：<title>」 with 開く and ✕ (English: New notification / Open / Dismiss), and nothing when there is none", async () => {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const ts = (await import("typescript")).default;
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(fs.readFileSync(new URL("../app/research/push-open-listener.tsx", import.meta.url), "utf8"),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const render = (banner, lang) => {
    const target = { exports: {} };
    new Function("require", "module", "exports", source)(id => {
      if (id === "react") return { ...React, useState: () => [banner, () => {}], useEffect: () => {}, useRef: initial => ({ current: initial }) };
      if (id === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (id === "./member-display-provider") return { useOwnerAccount: () => false };
      if (id === "./use-research-language") return { useResearchLanguage: () => [lang, () => {}] };
      if (id.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (id.startsWith("@/lib/")) return {};
      return require(id);
    }, target, target.exports);
    return renderToStaticMarkup(React.createElement(target.exports.default));
  };
  assert.equal(render(null, "ja"), "");
  const ja = render({ id: "n-1", path: "/research/notifications", title: "Tech Phase · テスト通知" }, "ja");
  assert.equal(ja, '<div class="banner" role="status" aria-live="polite"><p class="text">新しい通知：Tech Phase · テスト通知</p>'
    + '<button type="button" class="open">開く</button><button type="button" class="close" aria-label="閉じる">✕</button></div>');
  const en = render({ id: "n-1", path: "/research", title: "" }, "en");
  assert.match(en, /<p class="text">New notification<\/p><button type="button" class="open">Open<\/button><button type="button" class="close" aria-label="Dismiss">/);
});

test("the listener puts up the banner, hides it after 15 s, keeps the step record and sends it for the owner account only", () => {
  const listener = fs.readFileSync(new URL("../app/research/push-open-listener.tsx", import.meta.url), "utf8");
  assert.match(listener, /banner: notice => \{ setBanner\(notice\);/);
  assert.match(listener, /setTimeout\(\(\) => opener\.dismissBanner\("timeout"\), PUSH_BANNER_MS\)/);
  assert.match(listener, /if \(!owner\.current \|\| signature === lastSent \|\| !recentPushDiagnostic\(record, Date\.now\(\)\)\) return;/);
  assert.match(listener, /JSON\.stringify\(\{ action: "diagnostic", record \}\)/);
  assert.match(listener, /const ownerAccount = useOwnerAccount\(\);/);
  assert.doesNotMatch(listener, /watching\(\)/, "the vanished-from-the-list guess is gone");
});

test("the banner fits a 360 / 390 / 430 px phone: fixed inside the gutters, the title clamps instead of pushing the buttons out", () => {
  const css = fs.readFileSync(new URL("../app/research/push-open-banner.module.css", import.meta.url), "utf8");
  const rule = name => new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)[1];
  const banner = rule("banner");
  assert.match(banner, /position: fixed/);
  assert.match(banner, /left: max\(12px, env\(safe-area-inset-left\)\); right: max\(12px, env\(safe-area-inset-right\)\)/);
  assert.match(banner, /max-width: 520px/); assert.match(banner, /box-sizing: border-box/);
  assert.match(banner, /top: calc\(env\(safe-area-inset-top\) \+ 8px\)/);
  const text = rule("text");
  assert.match(text, /min-width: 0/); assert.match(text, /-webkit-line-clamp: 2/); assert.match(text, /overflow-wrap: anywhere/);
  // Fixed parts: 14 + 8 padding, two 8 px gaps, 開く (min 56) and ✕ (36). The rest is for the title at each width.
  const open = /\.open \{ min-width: (\d+)px/.exec(css)[1], close = /\.close \{ width: (\d+)px/.exec(css)[1];
  for (const width of [360, 390, 430]) {
    const room = Math.min(width - 24, 520) - 22 - 16 - Number(open) - Number(close);
    assert.ok(room >= 180, `${width}: ${room}px for the title`);
  }
});
