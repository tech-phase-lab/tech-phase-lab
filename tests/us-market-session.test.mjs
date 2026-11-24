import test from "node:test";
import assert from "node:assert/strict";
import { BOARD_STALE_MS, bannerLine, closedDayClose, freshnessNote, closedDayLine, marketBanner, marketPhase, usMarketSession } from "../lib/research/us-market-session.ts";

const at = iso => usMarketSession(new Date(iso));

test("regular hours follow New York time across daylight saving", () => {
  assert.equal(at("2026-10-14T14:00:00Z"), "regular"); // 10:00 EDT
  assert.equal(at("2026-10-14T13:29:00Z"), "pre");     // 09:29 EDT
  assert.equal(at("2026-10-14T20:00:00Z"), "post");    // 16:00 EDT
  assert.equal(at("2026-12-02T15:00:00Z"), "regular"); // 10:00 EST
  assert.equal(at("2026-10-15T01:00:00Z"), "closed");
});

test("weekends and listed holidays are not trading days; early closes end at 13:00", () => {
  assert.equal(at("2026-10-17T15:00:00Z"), "closed");
  assert.equal(at("2026-11-26T15:00:00Z"), "holiday"); // Thanksgiving
  assert.equal(at("2027-06-18T15:00:00Z"), "holiday"); // Juneteenth observed
  assert.equal(at("2026-11-27T17:30:00Z"), "regular"); // 12:30 EST, early-close day
  assert.equal(at("2026-11-27T18:30:00Z"), "post");    // 13:30 EST, after the early close
});

test("years outside the calendar are unknown, never guessed", () => {
  assert.equal(at("2025-10-14T14:00:00Z"), null);
  assert.equal(at("2028-10-13T14:00:00Z"), null);
});

const phase = iso => marketPhase(new Date(iso));

test("banner phase: pre 4:00, regular 9:30, after-hours 16:00, closed 20:00 New York time, in summer time", () => {
  assert.equal(phase("2026-10-14T07:59:00Z"), "closed"); // 03:59 EDT
  assert.equal(phase("2026-10-14T08:00:00Z"), "pre");    // 04:00 EDT = 17:00 JST
  assert.equal(phase("2026-10-14T13:29:00Z"), "pre");
  assert.equal(phase("2026-10-14T13:30:00Z"), "regular"); // 09:30 EDT = 22:30 JST
  assert.equal(phase("2026-10-14T19:59:00Z"), "regular");
  assert.equal(phase("2026-10-14T20:00:00Z"), "post");    // 16:00 EDT = 05:00 JST
  assert.equal(phase("2026-10-14T23:59:00Z"), "post");
  assert.equal(phase("2026-10-15T00:00:00Z"), "closed");  // 20:00 EDT
});

test("banner phase: the same New York hours in winter time shift by one hour in Tokyo", () => {
  assert.equal(phase("2026-12-02T08:59:00Z"), "closed"); // 03:59 EST
  assert.equal(phase("2026-12-02T09:00:00Z"), "pre");    // 04:00 EST = 18:00 JST
  assert.equal(phase("2026-12-02T14:29:00Z"), "pre");
  assert.equal(phase("2026-12-02T14:30:00Z"), "regular"); // 09:30 EST = 23:30 JST
  assert.equal(phase("2026-12-02T20:59:00Z"), "regular");
  assert.equal(phase("2026-12-02T21:00:00Z"), "post");    // 16:00 EST = 06:00 JST
  assert.equal(phase("2026-11-12T21:20:00Z"), "post");    // 06:20 JST on Nov 13
  assert.equal(phase("2026-12-03T01:00:00Z"), "closed");  // 20:00 EST
});

test("banner phase: weekends and market holidays read as closed all day", () => {
  assert.equal(phase("2026-10-17T15:00:00Z"), "closed"); // Saturday midday
  assert.equal(phase("2026-10-18T09:00:00Z"), "closed"); // Sunday pre-market hour
  assert.equal(phase("2026-11-26T15:00:00Z"), "closed"); // Thanksgiving
  assert.equal(phase("2026-11-26T22:00:00Z"), "closed");
  assert.equal(phase("2026-12-25T15:00:00Z"), "closed"); // Christmas
});

test("banner phase: outside the holiday calendar the weekday and the clock still decide", () => {
  assert.equal(phase("2028-10-13T14:00:00Z"), "regular"); // Friday 10:00 EDT
  assert.equal(phase("2028-10-14T14:00:00Z"), "closed");  // Saturday
});

test("banner words and the point: lit for pre, regular and after-hours only", () => {
  assert.deepEqual(marketBanner("pre"), { ja: "プレ取引中", en: "Pre-market", lit: true });
  assert.deepEqual(marketBanner("regular"), { ja: "取引中", en: "Open", lit: true });
  assert.deepEqual(marketBanner("post"), { ja: "アフター取引中", en: "After-hours", lit: true });
  assert.deepEqual(marketBanner("closed"), { ja: "取引終了", en: "Closed", lit: false });
});

test("banner line: the state word and the running clock, to the second, in Japan time (U.S. Eastern in English)", () => {
  const at = Date.parse("2026-11-12T21:20:35Z"); // 06:20:35 on Nov 13 in Tokyo
  assert.equal(bannerLine("post", true, at), "アフター取引中 ・ 06:20:35 JST");
  assert.equal(bannerLine("pre", true, at), "プレ取引中 ・ 06:20:35 JST");
  assert.equal(bannerLine("regular", true, at), "取引中 ・ 06:20:35 JST");
  assert.equal(bannerLine("closed", true, at), "取引終了 ・ 06:20:35 JST");
  assert.equal(bannerLine("closed", false, at), "Closed · 16:20:35 ET", "16:20:35 EST on Nov 12 in New York (owner, Nov 17)");
  assert.equal(bannerLine("regular", false, Date.parse("2026-07-10T14:05:09Z")), "Open · 10:05:09 ET", "EDT in July");
  assert.equal(bannerLine("regular", true, Date.parse("2026-07-10T14:05:09Z")), "取引中 ・ 23:05:09 JST");
  assert.equal(bannerLine("regular", true, null), "取引中");
});

const closed = iso => closedDayClose(new Date(iso));

test("closed day: Saturday and Sunday show Friday's close, until Monday's pre-market starts", () => {
  const friday = { month: 11, day: 13, weekday: 5 };
  assert.deepEqual(closed("2026-11-14T05:00:00Z"), friday);   // Sat 00:00 EST = Sat 14:00 JST
  assert.deepEqual(closed("2026-11-14T15:00:00Z"), friday);   // Saturday midday
  assert.deepEqual(closed("2026-11-15T23:00:00Z"), friday);   // Sunday evening
  assert.deepEqual(closed("2026-11-16T08:59:00Z"), friday);   // Mon 03:59 EST
  assert.equal(closed("2026-11-16T09:00:00Z"), null);         // Mon 04:00 EST: pre-market, the usual banner again
  assert.equal(closed("2026-11-16T15:00:00Z"), null);         // Monday regular hours
});

test("closed day: a weekday evening after the after-hours session keeps the usual banner", () => {
  assert.equal(closed("2026-11-14T01:30:00Z"), null); // Fri 20:30 EST, after the after-hours session
  assert.equal(closed("2026-11-14T04:59:00Z"), null); // Fri 23:59 EST
  assert.equal(closed("2026-11-18T07:00:00Z"), null); // Wed 02:00 EST, before the pre-market
  assert.equal(closed("2026-11-19T02:00:00Z"), null); // Wed 21:00 EST
});

test("closed day: an NYSE holiday shows the previous trading day's close, the day after until 04:00 too", () => {
  const wednesday = { month: 11, day: 25, weekday: 3 };
  assert.deepEqual(closed("2026-11-26T05:00:00Z"), wednesday); // Thanksgiving 00:00 EST
  assert.deepEqual(closed("2026-11-26T15:00:00Z"), wednesday); // Thanksgiving midday
  assert.deepEqual(closed("2026-11-27T08:30:00Z"), wednesday); // Fri 03:30 EST
  assert.equal(closed("2026-11-27T09:00:00Z"), null);          // Fri 04:00 EST: pre-market of the early-close day
  assert.deepEqual(closed("2026-11-28T15:00:00Z"), { month: 11, day: 27, weekday: 5 }); // the Saturday after: the early-close Friday
  assert.deepEqual(closed("2027-01-18T15:00:00Z"), { month: 1, day: 15, weekday: 5 });  // MLK Day after a weekend
  assert.deepEqual(closed("2027-01-02T15:00:00Z"), { month: 12, day: 31, weekday: 4 }); // across the year end
  assert.deepEqual(closed("2026-04-05T15:00:00Z"), { month: 4, day: 2, weekday: 4 });   // Sunday after Good Friday
});

test("closed day: outside the holiday calendar only weekends count", () => {
  assert.deepEqual(closed("2028-10-14T14:00:00Z"), { month: 10, day: 13, weekday: 5 });
  assert.equal(closed("2028-10-13T14:00:00Z"), null);
});

test("closed-day line: the trading day of the close shown, in Japanese and English, with no read time", () => {
  assert.equal(closedDayLine({ month: 11, day: 13, weekday: 5 }, true), "休場 ・ 米国 11/13(金) の終値");
  assert.equal(closedDayLine({ month: 11, day: 13, weekday: 5 }, false), "Closed · U.S. close of Fri 11/13");
  assert.equal(closedDayLine({ month: 11, day: 25, weekday: 3 }, true), "休場 ・ 米国 11/25(水) の終値");
});

test("the status clock ticks every second, and stale prices are said separately (owner, Nov 24: プレ取引中 ・ 22:23:50 JST stood still)", async () => {
  const { readFileSync } = await import("node:fs");
  // 08:23:50 ET on Tue Nov 24 = 22:23:50 JST: pre-market. Each second gives the next second.
  const start = Date.parse("2026-11-24T13:23:50Z");
  assert.equal(marketPhase(new Date(start)), "pre");
  assert.equal(bannerLine("pre", true, start), "プレ取引中 ・ 22:23:50 JST");
  assert.equal(bannerLine("pre", true, start + 1000), "プレ取引中 ・ 22:23:51 JST");
  assert.equal(bannerLine("pre", false, start + 10_000), "Pre-market · 08:24:00 ET");
  // Prices read 15 seconds ago are current: nothing beside the clock.
  assert.equal(freshnessNote(true, start - 15_000, start), null);
  assert.equal(freshnessNote(true, null, start), null);
  assert.equal(freshnessNote(true, start, null), null);
  // Reads stopped for a minute or more: the clock keeps running and the note gives the prices' own time.
  assert.equal(freshnessNote(true, start - BOARD_STALE_MS, start), "株価は 22:22:50 時点（更新が止まっています）");
  assert.equal(freshnessNote(false, start - 5 * 60_000, start), "prices as of 08:18:50 (updates paused)");
  // The board's status line uses the per-second clock, not the time of the last read, and is not a live region that would read the clock aloud.
  const board = readFileSync(new URL("../app/research/price/market-board.tsx", import.meta.url), "utf8");
  assert.match(board, /function StatusClock[\s\S]*?const now = useSecond\(\);[\s\S]*?, ja, now\)\}<\/span>/);
  assert.doesNotMatch(board, /bannerLine\(phase, ja, board\.at\)/);
  assert.doesNotMatch(board, /className=\{styles\.state\} role="status"/);
  const hook = readFileSync(new URL("../app/research/price/use-minute.ts", import.meta.url), "utf8");
  assert.match(hook, /export function useSecond\(\)[\s\S]*?1000 - \(at % 1000\)/);
});
