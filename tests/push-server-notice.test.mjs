// Nov 16 (owner's iPhone, 15:31 and 15:33 JST): Apple accepted two test notices (201) but the worker wrote nothing down and a tap left
// the app on the home page. The app now asks the server for the newest notice it sent this device and shows its own banner, or opens
// the page when the app came up within PUSH_SERVER_TAP_MS of the send. These tests run the opener with the worker silent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPushOpener, PUSH_BANNER_RECENT_MS, PUSH_TEST_TAG } from "../lib/research/push-open.ts";
import { browserPushServerNotices, cleanPushServerNotice, createVisiblePoller, PUSH_NOTICE_ACTIONS, PUSH_NOTICE_DEVICE_LIMIT, PUSH_NOTICE_MEMBER_LIMIT,
  PUSH_NOTICE_WINDOW_MS, PUSH_SERVER_LOOK_MS, PUSH_SERVER_POLL_MS, PUSH_SERVER_RECENT_MS, PUSH_SERVER_TAP_MS, pushServerNoticeRows, serverNoticeAction, serverNoticeRecord } from "../lib/research/push-server-notice.ts";

const NOW = 1_800_000_000_000;
const ID = "0123456789abcdef0123456789abcdef";
const raw = (extra = {}) => ({ id: ID, kind: "earnings", page: "/research/notifications", title: "NVDA · 決算速報", sentAt: NOW / 1000 - 5, ageMs: 5000,
  state: "new", openedAt: null, dismissedAt: null, ...extra });

function opener({ answers = [raw()], worker = {}, clock = { now: NOW }, at = { pathname: "/research", hash: "" } } = {}) {
  const moves = [], banners = [], marks = [], notes = [], cleared = [];
  let asked = 0;
  const store = { pending: null, delivered: null, ...worker };
  const o = createPushOpener({
    // The worker says nothing (the iOS case), unless a test gives it something.
    sources: { read: async () => ({ ...store, source: "worker" }), clear: async id => { cleared.push(id); }, shown: async () => null },
    location: () => ({ origin: "https://techphase.app", ...at }),
    navigation: { push: href => moves.push(["push", href]), setHash: hash => moves.push(["hash", hash]) },
    banner: notice => banners.push(notice),
    diagnostics: { note: (patch, id) => notes.push([patch, id]), fromWorker: () => {} },
    server: {
      recent: async () => { asked += 1; const value = answers.length > 1 ? answers.shift() : answers[0]; return cleanPushServerNotice(value); },
      mark: async (id, state) => { marks.push([id, state]); },
    },
    now: () => clock.now,
  });
  return { o, moves, banners, marks, notes, cleared, clock, asked: () => asked };
}

test("the tap threshold is 15 seconds and the server offers a notice for 30 minutes, like the worker's banner", () => {
  assert.equal(PUSH_SERVER_TAP_MS, 15_000);
  assert.equal(PUSH_SERVER_RECENT_MS, PUSH_BANNER_RECENT_MS);
  const sent = { at: NOW };
  assert.equal(serverNoticeAction(sent, NOW), "open");
  assert.equal(serverNoticeAction(sent, NOW + PUSH_SERVER_TAP_MS), "open");
  assert.equal(serverNoticeAction(sent, NOW + PUSH_SERVER_TAP_MS + 1), "banner");
  assert.equal(serverNoticeAction(sent, NOW - 1), "banner", "already in front when it was sent");
  assert.equal(serverNoticeAction(sent, null), "banner");
});

test("a notice is placed on the phone's own clock from its age, so a phone clock that is off does not matter", () => {
  const notice = cleanPushServerNotice(raw({ sentAt: 1, ageMs: 4000 }));
  assert.deepEqual(serverNoticeRecord(notice, NOW), { id: ID, path: "/research/notifications", title: "NVDA · 決算速報", at: NOW - 4000, test: false });
  assert.equal(serverNoticeRecord(cleanPushServerNotice(raw({ state: "opened" })), NOW), null);
  assert.equal(serverNoticeRecord(cleanPushServerNotice(raw({ ageMs: PUSH_SERVER_RECENT_MS + 1 })), NOW), null);
  assert.equal(serverNoticeRecord(null, NOW), null);
});

test("only known fields and listed pages from the monitor reach the page", () => {
  const clean = cleanPushServerNotice({ ...raw({ title: " MU\n· ニュース ", page: "/research/news" }), endpoint: "https://web.push.apple.com/x", keys: { auth: "k" } });
  assert.deepEqual(Object.keys(clean).sort(), ["ageMs", "dismissedAt", "id", "kind", "openedAt", "page", "sentAt", "state", "title"]);
  assert.equal(clean.title, "MU · ニュース");
  for (const bad of [null, "x", raw({ id: "short" }), raw({ page: "/admin" }), raw({ page: "https://evil.example/research" }), raw({ title: "" }),
    raw({ ageMs: -1 }), raw({ sentAt: "soon" })]) assert.equal(cleanPushServerNotice(bad), null, JSON.stringify(bad));
  assert.equal(cleanPushServerNotice(raw({ page: "/research/qa#q-0123456789abcdef0123456789abcdef" })).page, "/research/qa#q-0123456789abcdef0123456789abcdef");
});

test("came to the front 5 seconds after the send with the worker silent: the page opens directly and the notice is marked opened", async () => {
  const { o, moves, banners, marks, notes } = opener();
  o.foreground(NOW);
  assert.equal(await o.check(), "/research/notifications");
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
  assert.deepEqual(banners.filter(Boolean), []);
  assert.deepEqual(marks, [[ID, "opened"]]);
  assert.ok(notes.some(([patch, id]) => patch.via === "server-tap" && id === ID));
  assert.equal(await o.check(), null, "opened once");
  assert.equal(moves.length, 1);
});

test("came to the front 20 seconds after the send: the banner 「新しい通知」 is shown instead; 開く opens and marks it opened", async () => {
  const { o, moves, banners, marks } = opener({ answers: [raw({ ageMs: 20_000 })] });
  o.foreground(NOW);
  assert.equal(await o.check(), null);
  assert.deepEqual(moves, []);
  assert.deepEqual(banners.at(-1), { id: ID, path: "/research/notifications", title: "NVDA · 決算速報" });
  assert.equal(o.openBanner(), "/research/notifications");
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
  assert.deepEqual(marks, [[ID, "opened"]]);
  assert.equal(banners.at(-1), null);
});

test("a notice that arrives while the app is already in front gets the banner, and ✕ marks it dismissed", async () => {
  const { o, moves, banners, marks, clock } = opener({ answers: [null, raw({ ageMs: 1000 })] });
  o.foreground(NOW - 60_000);
  await o.check();
  clock.now = NOW + PUSH_SERVER_LOOK_MS;
  await o.check();
  assert.deepEqual(moves, []);
  assert.equal(banners.at(-1).id, ID);
  o.dismissBanner("close");
  assert.deepEqual(marks, [[ID, "dismissed"]]);
  assert.equal(banners.at(-1), null);
  clock.now += PUSH_SERVER_LOOK_MS;
  await o.check();
  assert.equal(banners.at(-1), null, "not shown again");
});

test("the 15-second timer only hides the banner here; the server notice is left for the next start", async () => {
  const { o, marks, banners } = opener({ answers: [raw({ ageMs: 60_000 })] });
  o.foreground(NOW);
  await o.check();
  o.dismissBanner("timeout");
  assert.deepEqual(marks, []);
  assert.equal(banners.at(-1), null);
});

test("the server is asked on every return to the front, and otherwise at most every 10 seconds", async () => {
  const { o, asked, clock } = opener({ answers: [null] });
  o.foreground(NOW);
  await o.check(); await o.check(); await o.check();
  assert.equal(asked(), 1);
  clock.now = NOW + PUSH_SERVER_LOOK_MS;
  await o.check();
  assert.equal(asked(), 2);
  o.message({ data: { type: "delivered", id: "w-1", url: "/research/news", at: clock.now, tag: "t", title: "x" }, origin: "https://techphase.app" });
  await o.check();
  assert.equal(asked(), 3, "a notice the worker reports makes the app ask the server at once");
});

test("the worker's banner and the server's record of the same notice give one banner, and ✕ closes both", async () => {
  const worker = { delivered: { id: "w-1", url: "/research/notifications", at: NOW - 30_000, tag: "earnings-NVDA", title: "NVDA · 決算速報" } };
  const { o, banners, marks, cleared } = opener({ worker, answers: [raw({ ageMs: 31_000 })] });
  o.foreground(NOW);
  await o.check();
  assert.equal(banners.filter(Boolean).length, 1);
  o.dismissBanner("close");
  assert.deepEqual(marks, [[ID, "dismissed"]]);
  assert.ok(cleared.includes("w-1"));
  await o.check();
  assert.equal(banners.filter(Boolean).length, 1);
});

test("a tap the worker did write down opens the page once and marks the server's record opened too", async () => {
  const worker = { pending: { id: "w-2", url: "/research/notifications", at: NOW - 3000, tag: "earnings-NVDA", title: "NVDA · 決算速報" } };
  const { o, moves, marks } = opener({ worker, answers: [raw({ ageMs: 3000 })] });
  o.foreground(NOW);
  assert.equal(await o.check(), "/research/notifications");
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
  assert.deepEqual(marks, [[ID, "opened"]]);
});

test("a server that fails or has nothing changes nothing", async () => {
  const failing = createPushOpener({
    sources: { read: async () => null, clear: async () => {}, shown: async () => null },
    location: () => ({ origin: "https://techphase.app", pathname: "/research", hash: "" }),
    navigation: { push: () => assert.fail("moved"), setHash: () => assert.fail("moved") },
    server: { recent: async () => { throw new Error("offline"); }, mark: async () => {} },
    now: () => NOW,
  });
  failing.foreground(NOW);
  assert.equal(await failing.check(), null);
  const old = opener({ answers: [raw({ ageMs: PUSH_SERVER_RECENT_MS + 1000 })] });
  old.o.foreground(NOW);
  assert.equal(await old.o.check(), null);
  assert.deepEqual(old.banners.filter(Boolean), []);
});

test("the browser source sends this device's subscription, asks nothing without one, and ignores odd ids", async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, JSON.parse(init.body), init.credentials]); return Response.json({ ok: true, notice: raw() }); };
  const sub = { toJSON: () => ({ endpoint: "https://web.push.apple.com/x", keys: { p256dh: "p", auth: "a" } }) };
  const source = browserPushServerNotices(async () => sub, fetcher);
  assert.equal((await source.recent()).id, ID);
  await source.mark(ID, "dismissed");
  await source.mark("../x", "opened");
  assert.deepEqual(calls.map(([url, body, credentials]) => [url, body.action, body.noticeId, body.subscription.endpoint, credentials]), [
    ["/api/research/notifications", "recent-notice", undefined, "https://web.push.apple.com/x", "same-origin"],
    ["/api/research/notifications", "notice-dismissed", ID, "https://web.push.apple.com/x", "same-origin"],
  ]);
  const none = browserPushServerNotices(async () => null, async () => assert.fail("asked without a subscription"));
  assert.equal(await none.recent(), null);
  const refused = browserPushServerNotices(async () => sub, async () => new Response("{}", { status: 401 }));
  assert.equal(await refused.recent(), null);
  assert.deepEqual([...PUSH_NOTICE_ACTIONS], ["recent-notice", "notice-opened", "notice-dismissed", "notice-status"]);
});

test("the owner's panel says when the server sent the newest notice and whether it was opened or dismissed", () => {
  const sent = NOW / 1000;
  const opened = pushServerNoticeRows(cleanPushServerNotice(raw({ sentAt: sent, state: "opened", openedAt: sent + 4 })), "ja");
  assert.deepEqual(opened.map(row => row.label), ["サーバーが送った通知", "送信時刻", "状態"]);
  assert.equal(opened[0].value, "NVDA · 決算速報 · /research/notifications");
  assert.match(opened[2].value, /^開いた /);
  assert.match(pushServerNoticeRows(cleanPushServerNotice(raw({ state: "dismissed", dismissedAt: sent })), "ja")[2].value, /^閉じた（✕）/);
  assert.match(pushServerNoticeRows(cleanPushServerNotice(raw()), "ja")[2].value, /^未読/);
  assert.deepEqual(pushServerNoticeRows(null, "en"), [{ label: "Server notice (this device)", value: "none in the last 7 days" }]);
});

test("the listener gives the opener the server source with this device's subscription; the panel reads notice-status", () => {
  const listener = fs.readFileSync(new URL("../app/research/push-open-listener.tsx", import.meta.url), "utf8");
  assert.match(listener, /server: browserPushServerNotices\(async \(\) => \(await container\.getRegistration\("\/research"\)\)\?\.pushManager\?\.getSubscription\(\)\)/);
  const panel = fs.readFileSync(new URL("../app/research/push-diagnostic-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /action: "notice-status"/);
  // The SW-based path stays as an extra signal.
  assert.match(listener, /browserPushOpenSources\(container/);
});

// Owner, Nov 16: the banner 「新しい通知：<title>」 is for real notices only, never the test notice; a tap on the test notice (the app up
// within 15 s of the send) still opens its page. While the app is visible it asks the server every 20 s; the route limits each device.
const testRaw = (extra = {}) => raw({ kind: "test", title: "テスト通知", ...extra });

test("a test notice from the server never gets the banner, whether the app came up later or was already in front", async () => {
  const later = opener({ answers: [testRaw({ ageMs: 20_000 })] });
  later.o.foreground(NOW);
  assert.equal(await later.o.check(), null);
  assert.deepEqual(later.banners.filter(Boolean), []);
  assert.deepEqual(later.moves, []);
  assert.equal(later.o.banner(), null);
  const inFront = opener({ answers: [null, testRaw({ ageMs: 1000 })] });
  inFront.o.foreground(NOW - 60_000);
  await inFront.o.check();
  inFront.clock.now = NOW + PUSH_SERVER_LOOK_MS;
  await inFront.o.check();
  assert.deepEqual(inFront.banners.filter(Boolean), []);
  assert.deepEqual(inFront.marks, [], "left alone on the server");
  assert.equal(serverNoticeRecord(cleanPushServerNotice(testRaw()), NOW).test, true);
});

test("a test notice opened within 15 s of the send still opens its page directly (taps keep working)", async () => {
  const { o, moves, banners, marks } = opener({ answers: [testRaw({ ageMs: 5000 })] });
  o.foreground(NOW);
  assert.equal(await o.check(), "/research/notifications");
  assert.deepEqual(moves, [["push", "/research/notifications"]]);
  assert.deepEqual(banners.filter(Boolean), []);
  assert.deepEqual(marks, [[ID, "opened"]]);
});

test("the worker's record of a test notice (tag tech-phase-test) gets no banner either; a real one does", async () => {
  const testWorker = { delivered: { id: "w-1", url: "/research/notifications", at: NOW - 30_000, tag: PUSH_TEST_TAG, title: "テスト通知" } };
  const quiet = opener({ worker: testWorker, answers: [null] });
  quiet.o.foreground(NOW);
  await quiet.o.check();
  quiet.o.message({ data: { type: "delivered", id: "w-3", url: "/research/notifications", at: NOW, tag: PUSH_TEST_TAG, title: "テスト通知" },
    origin: "https://techphase.app" });
  assert.deepEqual(quiet.banners.filter(Boolean), []);
  const real = opener({ answers: [null] });
  real.o.message({ data: { type: "delivered", id: "w-4", url: "/research/news", at: NOW, tag: "news-NVDA", title: "NVDA · ニュース" },
    origin: "https://techphase.app" });
  assert.deepEqual(real.banners.at(-1), { id: "w-4", path: "/research/news", title: "NVDA · ニュース" });
});

test("a test notice sent after a real notice the worker still holds does not hide the real one's banner", async () => {
  const worker = { delivered: { id: "w-5", url: "/research/news", at: NOW - 60_000, tag: "news-NVDA", title: "NVDA · ニュース" } };
  const { o, banners } = opener({ worker, answers: [testRaw({ ageMs: 20_000 })] });
  o.foreground(NOW);
  await o.check();
  assert.deepEqual(banners.filter(Boolean), [{ id: "w-5", path: "/research/news", title: "NVDA · ニュース" }]);
});

test("real kinds (news, earnings flash, price targets, notebook, notes, weekly, answers, economic) all get the banner with their title", async () => {
  for (const [kind, title] of [["news", "NVDA · ニュース"], ["notifications", "NVDA · 決算速報"], ["compare", "AMD · 目標株価の変更"],
    ["notebook", "銘柄手帳"], ["notes", "リゼルのひとりごと"], ["weekly", "週刊 Tech Phase PRO"], ["qa", "リゼルに聞く"], ["economic", "米 CPI"]]) {
    const { o, banners } = opener({ answers: [raw({ kind, title, ageMs: 40_000 })] });
    o.foreground(NOW);
    await o.check();
    assert.deepEqual(banners.at(-1), { id: ID, path: "/research/notifications", title }, kind);
  }
});

test("the poller asks every 20 s while the app is visible, pauses while hidden and stops on unmount", () => {
  assert.equal(PUSH_SERVER_POLL_MS, 20_000);
  const timers = new Map(); let next = 0; let ticks = 0; let visible = true;
  const poller = createVisiblePoller({ visible: () => visible, tick: () => { ticks += 1; },
    timers: { set: (fn, ms) => { next += 1; timers.set(next, { fn, ms }); return next; }, clear: id => { timers.delete(id); } } });
  const only = () => [...timers.values()][0];
  poller.sync(); poller.sync();
  assert.equal(timers.size, 1, "one interval, however many visibility events");
  assert.equal(only().ms, 20_000);
  only().fn(); only().fn();
  assert.equal(ticks, 2);
  visible = false; poller.sync();
  assert.equal(timers.size, 0, "paused while hidden");
  assert.equal(poller.running(), false);
  visible = true; poller.sync();
  assert.equal(timers.size, 1, "resumes when visible again");
  visible = false; only().fn();
  assert.equal(ticks, 2, "a tick that finds the page hidden asks nothing and pauses");
  assert.equal(timers.size, 0);
  visible = true; poller.sync(); poller.stop();
  assert.equal(timers.size, 0);
  const listener = fs.readFileSync(new URL("../app/research/push-open-listener.tsx", import.meta.url), "utf8");
  assert.match(listener, /createVisiblePoller\(\{ visible: shown, tick: \(\) => \{ void opener\.check\(\); \} \}\)/);
  assert.match(listener, /function look\(\) \{\n\s+poller\.sync\(\);/);
  assert.match(listener, /poller\.stop\(\);/);
});

test("polling every 20 s stays inside the route's per-device limit, with room for looks on each return to the front", () => {
  assert.ok(PUSH_SERVER_POLL_MS >= PUSH_SERVER_LOOK_MS);
  assert.ok(PUSH_NOTICE_WINDOW_MS / PUSH_SERVER_POLL_MS * 2 <= PUSH_NOTICE_DEVICE_LIMIT, "twice the polling rate still fits");
  assert.ok(PUSH_NOTICE_MEMBER_LIMIT >= PUSH_NOTICE_DEVICE_LIMIT * 2);
});
