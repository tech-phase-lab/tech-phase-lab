import assert from "node:assert/strict";
import test from "node:test";
import { healthGenres, healthGenre, healthPoint, quadrant, xPosition, yPosition, isClamped } from "../lib/research/health-map.ts";

const fact = value => ({ value, unit: "USD", start: null, end: "2026-06-30", filed: null, accession: null, tag: "t", basis: "b" });
const base = { ticker: "AAA", status: "ready", retrievedAt: "", revenue: null, previousRevenue: null, operatingIncome: null, operatingCash: null, capex: null, cash: null, revenueGrowth: 40, operatingMargin: null, fcfMargin: 10, stockCompensation: null, stockCompensationRatio: null, dilutedShares: null, previousDilutedShares: null, dilutedSharesGrowth: null, quarterRevenue: null, previousQuarterRevenue: null, quarterOperatingIncome: null, quarterRevenueGrowth: null, quarterOperatingMargin: null, quarterSourceUrl: null, sourceUrl: "https://example.test/f" };
const balance = (cash, debt, lease = null) => ({ end: "2026-06-30", sourceUrl: "https://example.test/b", filed: null, cash: fact(cash), currentAssets: null, currentLiabilities: null, currentRatio: null, debtCurrent: null, debtNoncurrent: debt === null ? null : fact(debt), shortBorrowings: null, leaseCurrent: null, leaseNoncurrent: lease === null ? null : fact(lease) });

test("genres list unique tickers and resolve by id", () => {
  for (const genre of healthGenres) assert.equal(new Set(genre.tickers).size, genre.tickers.length);
  assert.equal(healthGenre("semis")?.ja, "半導体");
  assert.equal(healthGenre("nope"), undefined);
  assert.equal(healthGenres[0].id, "ai-cloud");
});

test("cover divides cash by borrowings plus leases", () => {
  assert.equal(healthPoint({ ...base, balance: balance(300, 100, 200) }).cover, 1);
  assert.equal(healthPoint({ ...base, balance: balance(50, 200) }).cover, 0.25);
});

test("no debt line at all is unknown, not debt-free", () => {
  assert.equal(healthPoint({ ...base, balance: balance(300, null) }).cover, null);
  assert.equal(healthPoint({ ...base, balance: null }).cover, null);
});

test("an unavailable filing gives an empty point", () => {
  const point = healthPoint({ ...base, status: "unavailable", balance: balance(1, 1) });
  assert.deepEqual([point.fcfMargin, point.cover, point.revenueGrowth], [null, null, null]);
});

test("zero debt reported as a line caps at the top", () => {
  assert.equal(healthPoint({ ...base, balance: balance(100, 0) }).cover, 10);
});

test("positions stay inside the chart and mark clamped values", () => {
  assert.equal(xPosition(-500), 0);
  assert.equal(xPosition(500), 1);
  assert.equal(xPosition(-25), 0.5);
  assert.equal(yPosition(0.001), 0);
  assert.equal(yPosition(1000), 1);
  assert.ok(Math.abs(yPosition(1) - 0.5) < 1e-9);
  assert.equal(isClamped({ ticker: "A", fcfMargin: -300, cover: 1, revenueGrowth: null, asOf: null, sourceUrl: null }), true);
  assert.equal(isClamped({ ticker: "A", fcfMargin: 5, cover: 1, revenueGrowth: null, asOf: null, sourceUrl: null }), false);
});

test("quadrants follow positive cash flow and cover of 1 or more", () => {
  const p = (fcfMargin, cover) => ({ ticker: "A", fcfMargin, cover, revenueGrowth: null, asOf: null, sourceUrl: null });
  assert.equal(quadrant(p(5, 2)), "strong");
  assert.equal(quadrant(p(-5, 2)), "cushion");
  assert.equal(quadrant(p(5, 0.5)), "earning");
  assert.equal(quadrant(p(-5, 0.5)), "watch");
  assert.equal(quadrant(p(null, 2)), null);
});
