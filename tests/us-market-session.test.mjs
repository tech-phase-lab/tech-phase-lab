import test from "node:test";
import assert from "node:assert/strict";
import { marketBanner, marketPhase, usMarketSession } from "../lib/research/us-market-session.ts";

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
