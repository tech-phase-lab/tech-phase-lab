// Nov 17 (owner's iPhone, filming the PRO video): the demo price-target notice was sent at 06:06:11.32 UTC, the app came back to the
// front at about 06:06:20.6 (a tap, 9 s later), yet it stayed on the notifications page. The app's 20-second poll had asked the
// server for the newest notice at 06:06:11.32, the very moment the notice was written down, so the answer was "sent 0 s ago"; iOS
// suspended the app before that answer was handled and handed it over only when the app came back. The app placed the notice at
// "answer handled minus age" = after the return to the front, took the return for "already in front" and showed the banner; the fresh
// answer asked at 06:06:20.7 (age 9.4 s) was then ignored because the notice id was already known. These tests replay that.
import test from "node:test";
import assert from "node:assert/strict";
import { createPushOpener } from "../lib/research/push-open.ts";
import { cleanPushServerNotice, PUSH_SERVER_TAP_MS, serverNoticeAction, serverNoticeRecord } from "../lib/research/push-server-notice.ts";

const ID = "4f3c2b1a00112233445566778899aabb";
const PAGE = "/research/price-targets?demo=nvda";
// Device clock: deliberately 7 minutes ahead of the server's, which must not matter.
const SKEW = 7 * 60_000;
const SERVER_SEND = Date.UTC(2026, 10, 17, 6, 6, 11, 320);
const device = serverTime => serverTime + SKEW;
const notice = ageMs => ({ id: ID, kind: "price-targets", page: PAGE, title: "NVDA · 目標株価の変更", sentAt: SERVER_SEND / 1000,
  ageMs, state: "new", openedAt: null, dismissedAt: null });

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

function harness() {
  const clock = { now: device(SERVER_SEND - 60_000) };
  const moves = [], banners = [], marks = [];
  const answers = [];
  const o = createPushOpener({
    sources: { read: async () => ({ pending: null, delivered: null, source: "worker" }), clear: async () => {}, shown: async () => null },
    location: () => ({ origin: "https://techphase.app", pathname: "/research/notifications", search: "", hash: "" }),
    navigation: { push: href => moves.push(href), setHash: hash => moves.push(hash) },
    banner: value => banners.push(value),
    server: {
      recent: () => { const next = answers.shift(); return next ? next.promise : Promise.resolve(null); },
      mark: async (id, state) => { marks.push([id, state]); },
    },
    now: () => clock.now,
  });
  return { o, clock, moves, banners, marks, answers };
}

test("the owner's take, replayed: an answer handed over late by iOS no longer turns the tap into a banner", async () => {
  const { o, clock, moves, banners, marks, answers } = harness();
  // 06:05:27: the app is on the notifications page, in front; nothing sent yet.
  clock.now = device(SERVER_SEND - 44_000);
  o.foreground(clock.now);
  await o.check();
  // 06:06:11.32: the 20-second poll asks; the server answers "sent 0 s ago", but the app is suspended before it handles the answer.
  clock.now = device(SERVER_SEND);
  const late = deferred();
  answers.push(late);
  const stale = o.check();
  // 06:06:20.6: the tap brings the app to the front; the late answer is handled only now (and after the return).
  clock.now = device(SERVER_SEND + 9_300);
  o.foreground(clock.now);
  const fresh = deferred();
  answers.push(fresh);
  const look = o.check();
  clock.now = device(SERVER_SEND + 9_350);
  late.resolve(cleanPushServerNotice(notice(0)));
  await stale;
  // 06:06:20.7: the fresh question reaches the server: sent 9.4 s ago.
  clock.now = device(SERVER_SEND + 9_700);
  fresh.resolve(cleanPushServerNotice(notice(9_400)));
  await look;
  assert.deepEqual(moves, [PAGE], "the tap lands on the notice's page, with its query");
  assert.deepEqual(banners.filter(Boolean), [], "no banner for a tap");
  assert.deepEqual(marks, [[ID, "opened"]]);
});

test("opened later than 15 s after the send (by the server's own clock), the banner shows instead and 開く still opens the page", async () => {
  const { o, clock, moves, banners, answers } = harness();
  clock.now = device(SERVER_SEND + 40_000);
  o.foreground(clock.now);
  const answer = deferred();
  answers.push(answer);
  const look = o.check();
  answer.resolve(cleanPushServerNotice(notice(40_000)));
  await look;
  assert.deepEqual(moves, []);
  assert.equal(banners.at(-1)?.path, PAGE);
  assert.equal(o.openBanner(), PAGE);
  assert.deepEqual(moves, [PAGE]);
});

test("a notice that arrives while the app is in front still gets the banner, not a jump", async () => {
  const { o, clock, moves, banners, answers } = harness();
  clock.now = device(SERVER_SEND - 5_000);
  o.foreground(clock.now);
  await o.check();
  clock.now = device(SERVER_SEND + 11_000);
  const answer = deferred();
  answers.push(answer);
  const look = o.check();
  answer.resolve(cleanPushServerNotice(notice(1_000)));
  await look;
  assert.deepEqual(moves, []);
  assert.equal(banners.at(-1)?.id, ID);
});

test("the window is measured from the server's age at a question asked after the return, never across the two clocks", () => {
  const record = serverNoticeRecord(cleanPushServerNotice(notice(9_400)), 1_000_000);
  assert.equal(record.at, 1_000_000 - 9_400);
  assert.equal(record.askedAt, 1_000_000);
  assert.equal(serverNoticeAction(record, 1_000_000 - 100), "open");
  assert.equal(serverNoticeAction({ at: 0 }, PUSH_SERVER_TAP_MS + 1), "banner");
});
