import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFavoriteStocks, toggleFavoriteStock } from "../lib/research/favorites.ts";
import { calendarEvents, dateOnlyEvents, selectDateOnlyEarnings, selectDateOnlyEvents, calendarDateKey, selectCalendarEvents } from "../lib/research/calendar.ts";

const coverage = JSON.parse(readFileSync(new URL("../lib/research/calendar-coverage.json", import.meta.url), "utf8"));
const eventCalendarSource = readFileSync(new URL("../app/research/calendar/event-calendar.tsx", import.meta.url), "utf8");

test("favorite storage tolerates invalid JSON and rejects non-ticker values", () => {
  for (const raw of [null, "{", "null", "{}", '"MU"']) assert.deepEqual(parseFavoriteStocks(raw), []);
  assert.deepEqual(parseFavoriteStocks(JSON.stringify(["MU", "MU", "NVDA", 1, null, "<script>", "mu", "BRK.B"])), ["MU", "NVDA", "BRK.B"]);
  assert.deepEqual(parseFavoriteStocks(" ".repeat(10001)), []);
});

test("favorite toggles preserve other choices and survive serialization", () => {
  const initial = ["MU", "NBIS"];
  const added = toggleFavoriteStock(initial, "BE");
  assert.deepEqual(initial, ["MU", "NBIS"]);
  assert.deepEqual(parseFavoriteStocks(JSON.stringify(added)), ["MU", "NBIS", "BE"]);
  assert.deepEqual(toggleFavoriteStock(added, "NBIS"), ["MU", "BE"]);
  assert.deepEqual(toggleFavoriteStock(added, "../invalid"), added);
});

test("Japan calendar dates account for midnight and US daylight saving", () => {
  const call = calendarEvents.find((event) => event.id === "mu-fq4-2026-call");
  assert.equal(calendarDateKey(call.startsAt), "2026-10-01");
  const time = (date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
  assert.equal(time(call.startsAt), "05:30");
  assert.equal(time("2026-10-02T08:30:00-04:00"), "21:30");
  assert.equal(time("2026-11-06T08:30:00-05:00"), "22:30");
  assert.equal(calendarDateKey("2026-12-09T14:00:00-05:00"), "2026-12-10");
});

test("calendar filters use Japan months and exclude past events from upcoming", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const muEvents = calendarEvents.filter((event) => event.ticker === "MU");
  assert.equal(selectCalendarEvents(muEvents, "earnings", "2026-10", now).length, 1);
  assert.equal(selectCalendarEvents(muEvents, "earnings", "2026-09", now).length, 0);
  assert.equal(selectCalendarEvents(muEvents, "earnings", "upcoming", now).length, 0);
  assert.ok(selectCalendarEvents(calendarEvents, "economic", "upcoming", now).every((event) => Date.parse(event.startsAt) >= now && event.kind === "economic"));
});

test("registered schedules are ordered, unique and linked to official sources", () => {
  assert.equal(new Set(calendarEvents.map((event) => event.id)).size, calendarEvents.length);
  let previous = 0;
  for (const event of calendarEvents) {
    const timestamp = Date.parse(event.startsAt);
    assert.ok(Number.isFinite(timestamp) && timestamp >= previous);
    previous = timestamp;
    assert.ok(event.title.ja && event.title.en);
    assert.ok(["www.bls.gov", "investors.micron.com", "ir.netflix.net", "investor.tsmc.com", "www.gevernova.com", "www.adobe.com"].includes(new URL(event.sourceUrl).hostname));
    if (event.sourceName === "BLS") {
      assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: event.sourceTimezone, hour: "2-digit", minute: "2-digit" }).format(new Date(event.startsAt)), "08:30");
    }
  }
});

test("Eastern month filters follow the displayed date across the Japan midnight boundary", () => {
  const events = calendarEvents.filter((event) => event.ticker === "MU");
  assert.equal(calendarDateKey(events[0].startsAt, "America/New_York"), "2026-09-30");
  assert.equal(selectCalendarEvents(events, "earnings", "2026-09", 0, "America/New_York").length, 1);
  assert.equal(selectCalendarEvents(events, "earnings", "2026-10", 0, "America/New_York").length, 0);
});
test("Taiwan and Pacific timestamps convert to the right Eastern and Japan dates", () => {
  const tsm = calendarEvents.find((event) => event.id === "tsm-q3-2026-call");
  const netflix = calendarEvents.find((event) => event.ticker === "NFLX");
  const time = (date, zone) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date(date));
  assert.equal(time(tsm.startsAt, "America/New_York"), "02:00");
  assert.equal(time(tsm.startsAt, "Asia/Tokyo"), "15:00");
  assert.equal(calendarDateKey(tsm.startsAt, "Asia/Taipei"), "2026-10-15");
  assert.match(tsm.note.en, /conference start.*not the publication time/i);
  assert.equal(time(netflix.startsAt, "America/New_York"), "16:01");
  assert.equal(calendarDateKey(netflix.startsAt), "2026-10-21");
});

test("date-only earnings keep the official date without fabricating a time", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");
  assert.equal(selectDateOnlyEarnings("2026-09", now).length, 0);
  assert.equal(selectDateOnlyEarnings("2026-10", now)[0].date, "2026-10-14");
  assert.equal(selectDateOnlyEarnings("upcoming", Date.parse("2026-10-14T21:59:00Z")).length, 1);
  assert.equal(selectDateOnlyEarnings("upcoming", Date.parse("2026-10-14T22:00:00Z")).length, 0);
});

test("Adobe call keeps the official Pacific time and release/call distinction", () => {
  const adobe = calendarEvents.find((event) => event.id === "adbe-fq4-2026-call");
  assert.equal(adobe.startsAt, "2026-12-09T14:00:00-08:00");
  assert.equal(adobe.sourceTimezone, "America/Los_Angeles");
  assert.match(adobe.note.en, /call start, not the publication time/i);
  assert.equal(calendarDateKey(adobe.startsAt, "America/New_York"), "2026-12-09");
  assert.equal(calendarDateKey(adobe.startsAt, "Asia/Tokyo"), "2026-12-10");
});

test("GE Vernova webcast keeps the official Eastern time and release/call distinction", () => {
  const gev = calendarEvents.find((event) => event.id === "gev-q3-2026-webcast");
  assert.equal(gev.startsAt, "2026-10-28T07:30:00-04:00");
  assert.equal(gev.sourceTimezone, "America/New_York");
  assert.match(gev.note.en, /webcast start, not the publication time/i);
  assert.equal(calendarDateKey(gev.startsAt, "America/New_York"), "2026-10-28");
  assert.equal(calendarDateKey(gev.startsAt, "Asia/Tokyo"), "2026-10-28");
});

test("FOMC meetings stay date-only until the Federal Reserve publishes clock times", () => {
  const fomc = dateOnlyEvents.filter((event) => event.id.startsWith("fomc-"));
  assert.deepEqual(fomc.map((event) => event.date), ["2026-10-28", "2026-12-09"]);
  assert.ok(fomc.every((event) => event.kind === "economic" && !("startsAt" in event)));
  assert.equal(selectDateOnlyEvents(dateOnlyEvents, "economic", "upcoming", Date.parse("2026-09-23T00:00:00Z")).length, 2);
  assert.equal(selectDateOnlyEvents(dateOnlyEvents, "earnings", "2026-10", 0).length, 1);
});

test("calendar coverage tracks 40 unique companies and only conclusive checks advance", () => {
  assert.equal(coverage.length, 40);
  assert.equal(new Set(coverage.map((company) => company.ticker)).size, 40);
  const byTicker = Object.fromEntries(coverage.map((company) => [company.ticker, company]));
  const checked = Object.fromEntries(coverage.map((company) => [company.ticker, company.lastCheckedOn]));
  assert.ok(coverage.every((company) => /^2026-09-2[3456]$/.test(company.lastAttemptedOn)));
  for (const ticker of ["ADBE", "AMAT", "AMD", "ASML", "CRWD", "DELL", "GEV", "INTC", "LRCX", "META"]) assert.equal(checked[ticker], "2026-09-25");
  for (const ticker of ["MSFT", "QCOM"]) assert.equal(checked[ticker], "2026-09-23");
  for (const ticker of ["MU", "NFLX", "SNDK", "TSLA", "TSM"]) assert.equal(checked[ticker], "2026-09-25");
  for (const ticker of ["AAPL", "AMZN", "ANET", "ARM", "AVGO", "BE", "COHR", "CRDO", "CRM", "CRWV", "GOOGL", "KLAC", "LITE", "MRVL", "NBIS", "NOW", "NVDA", "ORCL", "PANW", "PLTR", "SKHY", "SNOW", "VRT"]) assert.equal(checked[ticker], null);
  for (const ticker of ["AAPL", "AMZN", "ANET", "ARM", "AVGO", "BE", "COHR", "CRDO", "CRM", "CRWV", "GOOGL", "KLAC", "LITE", "MRVL", "NBIS", "NOW", "NVDA", "ORCL", "PANW", "PLTR", "SKHY", "SNOW", "VRT"]) assert.equal(byTicker[ticker].lastAttemptedOn, "2026-09-26");
  assert.equal(coverage.filter((company) => company.lastCheckedOn !== null).length, 17);
  assert.equal(coverage.filter((company) => company.lastCheckedOn === null).length, 23);
  for (const ticker of ["MRVL", "NBIS", "NOW", "NVDA", "ORCL", "PANW", "PLTR", "SKHY", "SNOW", "VRT"]) {
    assert.match(byTicker[ticker].sourceUrl, /(?:events|investor-hub|category\/ir)/i);
  }
  assert.equal(byTicker.AMZN.sourceUrl, "https://ir.aboutamazon.com/events/default.aspx");
  assert.equal(byTicker.ANET.sourceUrl, "https://investors.arista.com/events-and-presentations/default.aspx");
  assert.equal(byTicker.ARM.sourceUrl, "https://investors.arm.com/");
  assert.equal(byTicker.TSM.lastCheckedOn, "2026-09-25");
  assert.equal(calendarEvents.some((event) => event.ticker === "TSM"), true);
});

test("calendar UI distinguishes a completed source check from an inconclusive review", () => {
  assert.match(eventCalendarSource, /公式確認済み・確定日なし/);
  assert.match(eventCalendarSource, /公式確認試行済み・確認継続/);
  assert.match(eventCalendarSource, /company\.lastCheckedOn !== null/);
  assert.match(eventCalendarSource, /company\.lastAttemptedOn/);
});

test("favorite calendar includes only followed earnings while retaining economic releases", async () => {
  const { filterFavoriteEvents } = await import("../lib/research/favorites.ts");
  const sample = [{ kind: "earnings", ticker: "MU" }, { kind: "earnings", ticker: "NVDA" }, { kind: "economic" }, { kind: "earnings" }];
  assert.deepEqual(filterFavoriteEvents(sample, ["MU"]), [sample[0], sample[2]]);
  assert.deepEqual(filterFavoriteEvents(sample, []), [sample[2]]);
  assert.deepEqual(filterFavoriteEvents(sample, ["MU"], false), [sample[0]]);
  assert.deepEqual(filterFavoriteEvents(sample, [], false), []);
});

test("favorite schedules drop expired calls and preserve date-only announcements", async () => {
  const { filterFavoriteEvents } = await import("../lib/research/favorites.ts");
  const now = Date.parse("2026-10-01T00:00:00Z");
  assert.equal(selectCalendarEvents(filterFavoriteEvents(calendarEvents, ["MU"], false), "earnings", "upcoming", now).length, 0);
  const asml = selectDateOnlyEvents(filterFavoriteEvents(dateOnlyEvents, ["ASML"], false), "earnings", "upcoming", now);
  assert.equal(asml.length, 1);
  assert.equal(asml[0].date, "2026-10-14");
  assert.equal(asml[0].startsAt, undefined);
  assert.equal(selectDateOnlyEvents(asml, "earnings", "upcoming", Date.parse("2026-10-15T12:00:00Z")).length, 0);
});
