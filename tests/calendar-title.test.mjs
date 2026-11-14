import test from "node:test";
import assert from "node:assert/strict";
import { calendarEvents } from "../lib/research/calendar.ts";
import { shortCalendarTitle } from "../lib/research/calendar-title.ts";

test("calendar earnings rows read '会社名 Q3決算' (owner, Nov 14); a release-and-call pair stays distinct; English is unchanged", () => {
  const find = id => calendarEvents.find(e => e.id === id);
  const nvda = calendarEvents.find(e => e.ticker === "NVDA" && e.kind === "earnings");
  assert.match(shortCalendarTitle(nvda, calendarEvents, "ja"), /^NVIDIA Q\d決算$/);
  assert.equal(shortCalendarTitle(nvda, calendarEvents, "en"), nvda.title.en);
  const titles = calendarEvents.filter(e => e.kind === "earnings").map(e => shortCalendarTitle(e, calendarEvents, "ja"));
  assert.ok(titles.every(t => !t.includes("決算説明会（") && t.length <= 32), titles.find(t => t.length > 32));
  assert.ok(titles.includes("ASML Q3決算") && titles.includes("ASML Q3決算説明会"));
  assert.ok(titles.includes("Alphabet（Google）Q3決算"));
  const indicator = calendarEvents.find(e => e.kind === "economic");
  assert.equal(shortCalendarTitle(indicator, calendarEvents, "ja"), indicator.title.ja);
  assert.ok(find);
});
