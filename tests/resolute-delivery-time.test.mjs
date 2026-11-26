import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deliveryClock, deliveryLabel, deliveryZone, nextDeliveryInstant } from "../lib/resolute/delivery-time.ts";
import { DELIVERY_HOURS } from "../lib/resolute/notification-settings.ts";

// Owner decision (Nov 17, 案A): alerts are still sent at 7/8/9/10 Japan time; the English
// screens show those moments in U.S. Eastern time (EST/EDT by the calendar), the Japanese ones in 日本時間.
const winter = Date.parse("2026-12-03T12:00:00Z"); // Dec 3 21:00 JST
const summer = Date.parse("2026-07-09T12:00:00Z"); // Jul 9 21:00 JST

test("the next delivery instant is the next time that hour comes round in Japan", () => {
  assert.equal(nextDeliveryInstant(7, winter).toISOString(), "2026-12-03T22:00:00.000Z"); // Dec 4 07:00 JST
  assert.equal(nextDeliveryInstant(7, Date.parse("2026-12-03T21:30:00Z")).toISOString(), "2026-12-03T22:00:00.000Z");
  assert.equal(nextDeliveryInstant(7, Date.parse("2026-12-03T22:00:00Z")).toISOString(), "2026-12-03T22:00:00.000Z");
  assert.equal(nextDeliveryInstant(7, Date.parse("2026-12-03T22:00:01Z")).toISOString(), "2026-12-04T22:00:00.000Z");
  assert.equal(nextDeliveryInstant(10, Date.parse("2026-12-03T23:00:00Z")).toISOString(), "2026-12-04T01:00:00.000Z");
});

test("English labels: Eastern Standard Time in winter", () => {
  assert.deepEqual(DELIVERY_HOURS.map(h => deliveryClock(h, "en", winter)), ["5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM"]);
  assert.equal(deliveryLabel(7, "en", winter), "5:00 PM ET");
  assert.equal(deliveryZone("en"), "ET");
});

test("English labels: Eastern Daylight Time in summer", () => {
  assert.deepEqual(DELIVERY_HOURS.map(h => deliveryClock(h, "en", summer)), ["6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM"]);
  assert.equal(deliveryLabel(7, "en", summer), "6:00 PM ET");
});

test("English labels follow the next delivery across a DST change", () => {
  // Sat Mar 7 2026 23:00 UTC = Sun Mar 8 08:00 JST: 7:00 JST has passed, the next is Mon Mar 9 07:00 JST = Sun Mar 8 18:00 EDT.
  assert.equal(deliveryLabel(7, "en", Date.parse("2026-03-07T23:00:00Z")), "6:00 PM ET");
  // Before it: Sun Mar 8 07:00 JST = Sat Mar 7 17:00 EST.
  assert.equal(deliveryLabel(7, "en", Date.parse("2026-03-07T21:00:00Z")), "5:00 PM ET");
});

test("Japanese labels are unchanged: the hour in 日本時間, whatever the season", () => {
  for (const now of [winter, summer]) {
    assert.deepEqual(DELIVERY_HOURS.map(h => deliveryClock(h, "ja", now)), ["7:00", "8:00", "9:00", "10:00"]);
    assert.equal(deliveryLabel(7, "ja", now), "7:00 日本時間");
  }
});

test("screens show the delivery hour through the helper and still save the same deliveryHourJst values", () => {
  const screen = readFileSync(new URL("../app/resolute/notifications-screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /DELIVERY_HOURS\.map\(h=><button type="button" key=\{h\} aria-pressed=\{draft\.deliveryHourJst===h\} onClick=\{\(\)=>update\(\{deliveryHourJst:h\}\)\}>\{deliveryClock\(h,locale\)\}<\/button>\)/);
  // ④ (11/25 PC and phone): the four times are always shown under 「届く時間」 with the zone, and the example notification
  // carries the chosen time.
  assert.match(screen, /\{t\("届く時間","Delivery time"\)\}<small>\{deliveryZone\(locale\)\}<\/small><\/h3>\{timeButtons\}/);
  assert.match(screen, /<time>\{deliveryClock\(draft\.deliveryHourJst,locale\)\}<\/time>/);
  assert.ok(screen.includes("We check the U.S. closing prices and send alerts at this time (ET)."));
  assert.ok(screen.includes("前の夜の終値をもとに、この時間にお知らせします(日本時間)"));
  assert.ok(!/\bJST\b/.test(screen));
  const notebook = readFileSync(new URL("../app/resolute/notebook/screen.tsx", import.meta.url), "utf8");
  assert.ok(notebook.includes("{deliveryLabel(settings.deliveryHourJst,locale)}"));
  assert.ok(!/deliveryHourJst\}:00/.test(notebook));
});
