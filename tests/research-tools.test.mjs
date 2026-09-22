import test from "node:test";
import assert from "node:assert/strict";
import { parseFavoriteStocks, toggleFavoriteStock } from "../lib/research/favorites.ts";
import { calendarEvents, calendarDateKey, selectCalendarEvents } from "../lib/research/calendar.ts";

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
  assert.equal(selectCalendarEvents(calendarEvents, "earnings", "2026-10", now).length, 1);
  assert.equal(selectCalendarEvents(calendarEvents, "earnings", "2026-09", now).length, 0);
  assert.equal(selectCalendarEvents(calendarEvents, "earnings", "upcoming", now).length, 0);
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
    assert.ok(["www.bls.gov", "www.federalreserve.gov", "investors.micron.com"].includes(new URL(event.sourceUrl).hostname));
    if (event.sourceName === "BLS") {
      assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: event.sourceTimezone, hour: "2-digit", minute: "2-digit" }).format(new Date(event.startsAt)), "08:30");
    }
  }
});
