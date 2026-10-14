import test from "node:test";
import assert from "node:assert/strict";
import { usMarketSession } from "../lib/research/us-market-session.ts";

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
