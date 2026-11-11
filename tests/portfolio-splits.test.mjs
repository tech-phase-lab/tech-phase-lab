import test from "node:test";
import assert from "node:assert/strict";
import { applySplits, parseSplits } from "../lib/portfolio/splits.ts";
import { parseStored, serialize } from "../lib/portfolio/store.ts";

const lot = (extra = {}) => ({ ticker: "APH", shares: 100, avgCostUsd: 149.97, source: "A", ...extra });
test("a 2-for-1 split doubles the shares and halves the average cost; the yen rate stays", () => {
  const { holdings, applied } = applySplits([lot({ avgCostFx: 150 })], { APH: [{ date: "2026-11-05", from: 1, to: 2 }] }, "2026-10-01", "2026-11-11");
  assert.equal(holdings[0].shares, 200); assert.equal(holdings[0].avgCostUsd, 74.985); assert.equal(holdings[0].avgCostFx, 150);
  assert.equal(holdings[0].checkedAt, "2026-11-11"); assert.deepEqual(applied, [{ ticker: "APH", date: "2026-11-05", from: 1, to: 2 }]);
});
test("a lot checked after the split, or typed in after it, is not adjusted again", () => {
  const split = { APH: [{ date: "2026-11-05", from: 1, to: 2 }] };
  assert.equal(applySplits([lot({ checkedAt: "2026-11-08" })], split, "2026-10-01", "2026-11-11").holdings[0].shares, 100);
  assert.equal(applySplits([lot()], split, "2026-11-08", "2026-11-11").holdings[0].shares, 100);
});
test("a failed read leaves the lot unchecked; a reverse split and a 3-for-2 are handled", () => {
  assert.equal(applySplits([lot()], {}, "2026-10-01", "2026-11-11").holdings[0].checkedAt, undefined);
  const reverse = applySplits([lot({ shares: 100, avgCostUsd: 2 })], { APH: [{ date: "2026-11-05", from: 10, to: 1 }] }, "2026-10-01", "2026-11-11").holdings[0];
  assert.equal(reverse.shares, 10); assert.equal(reverse.avgCostUsd, 20);
  const three = applySplits([lot({ shares: 10 })], { APH: [{ date: "2026-11-05", from: 2, to: 3 }] }, "2026-10-01", "2026-11-11").holdings[0];
  assert.equal(three.shares, 15);
});
test("the provider's rows: only real splits with a date and positive factors", () => {
  const rows = parseSplits({ meta: { symbol: "APH" }, splits: [{ date: "2026-11-05", from_factor: 1, to_factor: 2 }, { date: "bad", from_factor: 1, to_factor: 2 }, { date: "2026-01-01", from_factor: 1, to_factor: 1 }] }, "APH");
  assert.deepEqual(rows, [{ date: "2026-11-05", from: 1, to: 2 }]);
  assert.deepEqual(parseSplits({ meta: { symbol: "XYZ" }, splits: [] }, "APH"), []);
  assert.deepEqual(parseSplits({ status: "error" }, "APH"), []);
});
test("saving keeps a lot's check date, and a lot without one takes the previous save's day", () => {
  const previous = JSON.stringify({ version: 2, savedAt: "2026-10-20T01:00:00.000Z", holdings: [] });
  const stored = JSON.parse(serialize([lot(), lot({ ticker: "MU", checkedAt: "2026-11-01" })], previous));
  assert.equal(stored.holdings[0].checkedAt, "2026-10-20"); assert.equal(stored.holdings[1].checkedAt, "2026-11-01");
  assert.equal(parseStored(JSON.stringify(stored))[0].checkedAt, "2026-10-20");
});
