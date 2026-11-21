import test from "node:test";
import assert from "node:assert/strict";
import { adjustForSplits, applyRepairs, knownSplits, legacyRepairs, parseSplits } from "../lib/portfolio/splits.ts";
import { aggregate, valueHoldings } from "../lib/portfolio/calc.ts";
import { parseStored, serialize } from "../lib/portfolio/store.ts";

const lot = (extra = {}) => ({ ticker: "APH", shares: 100, avgCostUsd: 149.97, source: "A", ...extra });
const APH = { APH: [{ ticker: "APH", date: "2026-11-05", ratio: 2 }] };
test("a 2-for-1 split doubles the shares and halves the average cost when read; the yen rate stays", () => {
  const { holdings, applied } = adjustForSplits([lot({ avgCostFx: 150, checkedAt: "2026-10-01" })], APH, "2026-10-01", "2026-11-11");
  assert.equal(holdings[0].shares, 200); assert.equal(holdings[0].avgCostUsd, 74.985); assert.equal(holdings[0].avgCostFx, 150);
  assert.equal(holdings[0].checkedAt, "2026-11-11"); assert.deepEqual(applied, [{ ticker: "APH", date: "2026-11-05", ratio: 2 }]);
});
test("a lot checked after the split, or typed in after it, is not adjusted again; saving the shown lots never applies a split twice", () => {
  assert.equal(adjustForSplits([lot({ checkedAt: "2026-11-08" })], APH, "2026-10-01", "2026-11-11").holdings[0].shares, 100);
  assert.equal(adjustForSplits([lot()], APH, "2026-11-08", "2026-11-11").holdings[0].shares, 100);
  const once = adjustForSplits([lot({ checkedAt: "2026-10-01" })], APH, "2026-10-01", "2026-11-11").holdings;
  assert.equal(adjustForSplits(once, APH, "2026-10-01", "2026-12-01").holdings[0].shares, 200);
});
test("a failed read leaves the lot as it is; a reverse split and a 3-for-2 are handled", () => {
  assert.equal(adjustForSplits([lot()], {}, "2026-10-01", "2026-11-11").holdings[0].checkedAt, undefined);
  const reverse = adjustForSplits([lot({ shares: 100, avgCostUsd: 2 })], { APH: [{ ticker: "APH", date: "2026-11-05", ratio: 0.1 }] }, "2026-10-01", "2026-11-11").holdings[0];
  assert.equal(reverse.shares, 10); assert.equal(reverse.avgCostUsd, 20);
  const three = adjustForSplits([lot({ shares: 10 })], { APH: [{ ticker: "APH", date: "2026-11-05", ratio: 1.5 }] }, "2026-10-01", "2026-11-11").holdings[0];
  assert.equal(three.shares, 15);
});
test("the provider's rows: from_factor is the NEW share count (NVDA 10-for-1 = from 10, to 1; GE 1-for-8 = from 1, to 8)", () => {
  assert.deepEqual(parseSplits({ meta: { symbol: "SNDK" }, splits: [{ date: "2026-11-20", description: "8-for-1 split", ratio: 0.125, from_factor: 8, to_factor: 1 }] }, "SNDK"),
    [{ ticker: "SNDK", date: "2026-11-20", ratio: 8 }]);
  assert.deepEqual(parseSplits({ meta: { symbol: "GE" }, splits: [{ date: "2021-08-02", from_factor: 1, to_factor: 8 }] }, "GE"), [{ ticker: "GE", date: "2021-08-02", ratio: 0.125 }]);
  const rows = parseSplits({ meta: { symbol: "APH" }, splits: [{ date: "2026-11-05", from_factor: 2, to_factor: 1 }, { date: "bad", from_factor: 2, to_factor: 1 }, { date: "2026-01-01", from_factor: 1, to_factor: 1 }] }, "APH");
  assert.deepEqual(rows, [{ ticker: "APH", date: "2026-11-05", ratio: 2 }]);
  assert.deepEqual(parseSplits({ meta: { symbol: "XYZ" }, splits: [] }, "APH"), []);
  assert.deepEqual(parseSplits({ status: "error" }, "APH"), []);
});
test("SNDK 8-for-1 (2026-11-20): a lot entered before shows ×8 shares and ÷8 cost, the total cost and value are unchanged; a lot entered on or after is left alone", () => {
  const splits = knownSplits(["SNDK"]);
  assert.deepEqual(splits.SNDK.map(s => [s.date, s.ratio]), [["2026-11-20", 8]]);
  const before = { ticker: "SNDK", shares: 10, avgCostUsd: 400, source: "SBI", checkedAt: "2026-11-19" };
  const after = { ticker: "SNDK", shares: 80, avgCostUsd: 50, source: "楽天", checkedAt: "2026-11-20" };
  const { holdings, applied } = adjustForSplits([before, after], splits, "2026-11-01", "2026-11-21");
  assert.deepEqual(holdings.map(h => [h.source, h.shares, h.avgCostUsd]), [["SBI", 80, 50], ["楽天", 80, 50]]);
  assert.deepEqual(applied, [{ ticker: "SNDK", date: "2026-11-20", ratio: 8 }]);
  const { totals } = valueHoldings(aggregate(holdings), { SNDK: { ticker: "SNDK", close: 79.24, asOf: "2026-11-20" } }, 155);
  assert.equal(totals.costUsd, 8000); assert.ok(Math.abs(totals.valueUsd - 160 * 79.24) < 1e-9);
  // The day before the split nothing changes yet.
  assert.equal(adjustForSplits([before], splits, "2026-11-01", "2026-11-19").holdings[0].shares, 10);
});
test("the wrong-way writes of the old screen are found from its note and only fixed on request", () => {
  const at = Date.parse("2026-11-20T23:00:00Z");
  const wrong = { ticker: "SNDK", shares: 1.25, avgCostUsd: 3200, source: "SBI", checkedAt: "2026-11-20" };
  const note = { at, applied: [{ ticker: "SNDK", date: "2026-11-20", from: 8, to: 1 }] };
  const repairs = legacyRepairs([wrong, lot()], note);
  assert.deepEqual(repairs.map(r => [r.ticker, r.fixedShares, r.fixedCost]), [["SNDK", 80, 50]]);
  assert.deepEqual(applyRepairs([wrong, lot()], repairs).map(h => h.shares), [80, 100]);
  assert.deepEqual(legacyRepairs([wrong], { ...note, resolved: true }), []);
  assert.deepEqual(legacyRepairs([wrong], { ...note, version: 2 }), []);
  assert.deepEqual(legacyRepairs([{ ...wrong, checkedAt: "2026-11-25" }], note), []);
});
test("saving keeps a lot's check date, and a lot without one takes the previous save's day", () => {
  const previous = JSON.stringify({ version: 2, savedAt: "2026-10-20T01:00:00.000Z", holdings: [] });
  const stored = JSON.parse(serialize([lot(), lot({ ticker: "MU", checkedAt: "2026-11-01" })], previous));
  assert.equal(stored.holdings[0].checkedAt, "2026-10-20"); assert.equal(stored.holdings[1].checkedAt, "2026-11-01");
  assert.equal(parseStored(JSON.stringify(stored))[0].checkedAt, "2026-10-20");
});
