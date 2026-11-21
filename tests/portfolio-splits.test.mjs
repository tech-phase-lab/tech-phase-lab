import test from "node:test";
import assert from "node:assert/strict";
import { adjustForSplits, applyRepairs, invertedLots, knownSplits, parseSplits } from "../lib/portfolio/splits.ts";
import { aggregate, valueHoldings } from "../lib/portfolio/calc.ts";
import { parseStored, serialize } from "../lib/portfolio/store.ts";

const lot = (extra = {}) => ({ ticker: "APH", shares: 100, avgCostUsd: 149.97, source: "A", ...extra });
const APH = { APH: [{ ticker: "APH", date: "2026-11-05", ratio: 2 }] };
const SNDK = knownSplits(["SNDK"]);
const PRICE = { SNDK: 79.24 };
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
test("a reverse split and a 3-for-2 are handled", () => {
  const reverse = adjustForSplits([lot({ shares: 100, avgCostUsd: 2 })], { APH: [{ ticker: "APH", date: "2026-11-05", ratio: 0.1 }] }, "2026-10-01", "2026-11-11").holdings[0];
  assert.equal(reverse.shares, 10); assert.equal(reverse.avgCostUsd, 20);
  const three = adjustForSplits([lot({ shares: 10 })], { APH: [{ ticker: "APH", date: "2026-11-05", ratio: 1.5 }] }, "2026-10-01", "2026-11-11").holdings[0];
  assert.equal(three.shares, 15);
});
test("B3 (review M): a ticker the provider failed for is left exactly as it is, and its date is never advanced, so a later answer still applies", () => {
  const lots = [{ ticker: "XYZ", shares: 100, avgCostUsd: 200, source: "SBI", checkedAt: "2026-11-01" }];
  const shown = adjustForSplits(lots, {}, "2026-11-01", "2026-11-21").holdings;
  assert.equal(shown[0], lots[0]);
  const stored = parseStored(serialize([...shown, { ticker: "MU", shares: 1, avgCostUsd: 100, source: "手入力", checkedAt: "2026-11-21" }]));
  assert.equal(adjustForSplits(stored, { XYZ: [{ ticker: "XYZ", date: "2026-11-10", ratio: 4 }] }, "2026-11-21", "2026-11-22").holdings[0].shares, 400);
});
test("B3: with only the manual list (provider failed) the date moves to the last split applied, never to today", () => {
  const r = adjustForSplits([{ ticker: "SNDK", shares: 10, avgCostUsd: 755, source: "SBI", checkedAt: "2026-11-01" }], SNDK, "2026-11-01", "2026-11-25", { complete: new Set() });
  assert.deepEqual([r.holdings[0].shares, r.holdings[0].avgCostUsd, r.holdings[0].checkedAt], [80, 94.375, "2026-11-20"]);
  const full = adjustForSplits([{ ticker: "SNDK", shares: 10, avgCostUsd: 755, source: "SBI", checkedAt: "2026-11-01" }], SNDK, "2026-11-01", "2026-11-25", { complete: new Set(["SNDK"]) });
  assert.equal(full.holdings[0].checkedAt, "2026-11-25");
});
test("the provider's rows: from_factor is the NEW share count (NVDA 10-for-1 = from 10, to 1; GE 1-for-8 = from 1, to 8); an error answer throws", () => {
  assert.deepEqual(parseSplits({ meta: { symbol: "SNDK" }, splits: [{ date: "2026-11-20", description: "8-for-1 split", ratio: 0.125, from_factor: 8, to_factor: 1 }] }, "SNDK"),
    [{ ticker: "SNDK", date: "2026-11-20", ratio: 8 }]);
  assert.deepEqual(parseSplits({ meta: { symbol: "GE" }, splits: [{ date: "2021-08-02", from_factor: 1, to_factor: 8 }] }, "GE"), [{ ticker: "GE", date: "2021-08-02", ratio: 0.125 }]);
  const rows = parseSplits({ meta: { symbol: "APH" }, splits: [{ date: "2026-11-05", from_factor: 2, to_factor: 1 }, { date: "bad", from_factor: 2, to_factor: 1 }, { date: "2026-01-01", from_factor: 1, to_factor: 1 }] }, "APH");
  assert.deepEqual(rows, [{ ticker: "APH", date: "2026-11-05", ratio: 2 }]);
  assert.deepEqual(parseSplits({ meta: { symbol: "APH" }, splits: [] }, "APH"), []);
  assert.throws(() => parseSplits({ meta: { symbol: "XYZ" }, splits: [] }, "APH"));
  assert.throws(() => parseSplits({ status: "error", code: 429 }, "APH"));
});
test("SNDK 8-for-1 (2026-11-20): a lot entered before shows ×8 shares and ÷8 cost, the total cost and value are unchanged; a lot entered after is left alone", () => {
  assert.deepEqual(SNDK.SNDK.map(s => [s.date, s.ratio]), [["2026-11-20", 8]]);
  const before = { ticker: "SNDK", shares: 10, avgCostUsd: 400, source: "SBI", checkedAt: "2026-11-19" };
  const after = { ticker: "SNDK", shares: 80, avgCostUsd: 50, source: "楽天", checkedAt: "2026-11-21" };
  const { holdings, applied } = adjustForSplits([before, after], SNDK, "2026-11-01", "2026-11-21");
  assert.deepEqual(holdings.map(h => [h.source, h.shares, h.avgCostUsd]), [["SBI", 80, 50], ["楽天", 80, 50]]);
  assert.deepEqual(applied, [{ ticker: "SNDK", date: "2026-11-20", ratio: 8 }]);
  const { totals } = valueHoldings(aggregate(holdings), { SNDK: { ticker: "SNDK", close: 79.24, asOf: "2026-11-20" } }, 155);
  assert.equal(totals.costUsd, 8000); assert.ok(Math.abs(totals.valueUsd - 160 * 79.24) < 1e-9);
  assert.equal(adjustForSplits([before], SNDK, "2026-11-01", "2026-11-19").holdings[0].shares, 10);
});
test("review D/E: a lot checked on the split day itself is decided by today's price (old UTC stamp, or a broker screen read before the open)", () => {
  const old = { ticker: "SNDK", shares: 10, avgCostUsd: 755, source: "SBI", checkedAt: "2026-11-20" };
  const fresh = { ticker: "SNDK", shares: 80, avgCostUsd: 94, source: "楽天", checkedAt: "2026-11-20" };
  const r = adjustForSplits([old, fresh], SNDK, "2026-11-20", "2026-11-21", { prices: PRICE });
  assert.deepEqual(r.holdings.map(h => [h.shares, h.avgCostUsd]), [[80, 94.375], [80, 94]]);
  assert.equal(adjustForSplits([old], SNDK, "2026-11-20", "2026-11-25", { prices: PRICE }).holdings[0].shares, 80);
  // No price yet: the lot is left exactly as it is (nothing stamped).
  assert.equal(adjustForSplits([old], SNDK, "2026-11-20", "2026-11-21").holdings[0], old);
});
test("review L: a check date later than today is kept", () => {
  const r = adjustForSplits([{ ticker: "SNDK", shares: 10, avgCostUsd: 755, source: "SBI", checkedAt: "2026-11-20" }], SNDK, "2026-11-01", "2026-11-19");
  assert.equal(r.holdings[0].checkedAt, "2026-11-20");
});

// The old screen (before Nov 21) applied Twelve Data's 8-for-1 as ÷8 and saved it, then re-stamped the date on every visit.
const wrong = { ticker: "SNDK", shares: 1.25, avgCostUsd: 6040, source: "SBI", checkedAt: "2026-11-21" };
test("B1 (review N): a wrong-way lot is found by its numbers against today's price, whatever its date or note", () => {
  for (const checkedAt of ["2026-11-20", "2026-11-21", "2026-12-15"]) {
    const repairs = invertedLots([{ ...wrong, checkedAt }], SNDK, PRICE);
    assert.deepEqual(repairs.map(r => [r.ticker, r.shares, r.fixedShares, r.fixedCost]), [["SNDK", 1.25, 80, 94.375]]);
  }
  // A whole-share wrong lot (64 shares ÷ 64 = 1) is found only when the cost is far past the ratio.
  assert.equal(invertedLots([{ ...wrong, shares: 1, avgCostUsd: 6400 }], SNDK, PRICE).length, 1);
  assert.equal(invertedLots([{ ...wrong, shares: 1, avgCostUsd: 700 }], SNDK, PRICE).length, 0);
});
test("B2 (review C/C2): lots consistent with post-split prices are never listed; one row per lot; each lot fixed on its own", () => {
  const right = { ticker: "SNDK", shares: 80, avgCostUsd: 94, source: "楽天", checkedAt: "2026-11-21" };
  const loser = { ticker: "SNDK", shares: 80, avgCostUsd: 300, source: "松井", checkedAt: "2026-11-21" }; // down 74%: still a real lot
  const other = { ...wrong, shares: 2.5, source: "楽天2" };
  const repairs = invertedLots([wrong, right, loser, other, lot()], SNDK, PRICE);
  assert.deepEqual(repairs.map(r => r.source), ["SBI", "楽天2"]);
  const fixed = applyRepairs([wrong, right, loser, other], [repairs[0]], "2026-11-21");
  assert.deepEqual(fixed.map(l => l.shares), [80, 80, 80, 2.5]);
  assert.equal(fixed[0].checkedAt, "2026-11-21");
  // A lot the reader chose to keep is not offered again; no price, no offer.
  assert.equal(invertedLots([wrong], SNDK, PRICE, new Set([repairs[0].key])).length, 0);
  assert.equal(invertedLots([wrong], SNDK, {}).length, 0);
  // A lot from before the split (not yet adjusted) is not a wrong-way lot.
  assert.equal(invertedLots([{ ...wrong, checkedAt: "2026-11-10" }], SNDK, PRICE).length, 0);
});
test("saving keeps a lot's check date, and a lot without one takes the previous save's day", () => {
  const previous = JSON.stringify({ version: 2, savedAt: "2026-10-20T01:00:00.000Z", holdings: [] });
  const stored = JSON.parse(serialize([lot(), lot({ ticker: "MU", checkedAt: "2026-11-01" })], previous));
  assert.equal(stored.holdings[0].checkedAt, "2026-10-20"); assert.equal(stored.holdings[1].checkedAt, "2026-11-01");
  assert.equal(parseStored(JSON.stringify(stored))[0].checkedAt, "2026-10-20");
});

test("the portfolio screen never rewrites saved holdings for a split by itself (replaces the Nov 21 pause, #735)", async () => {
  const { readFileSync } = await import("node:fs");
  const screen = readFileSync(new URL("../app/research/portfolio/screen.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /applySplits|SPLIT_ADJUSTMENT_PAUSED/);
  // The only writes are the reader's own actions: manual add, saving a read screenshot, a chosen repair, deleting everything.
  const writes = screen.split("\n").filter(line => line.includes("writeHoldings("));
  assert.equal(writes.length, 4);
  for (const [i, word] of ["applyRepairs(lots, [repair]", "onAdd={h =>", "onClear={", "replaceSource(existing"].entries()) assert.ok(writes[i].includes(word), word);
  assert.match(screen, /const current = useMemo\(\(\) => adjustForSplits\(/);
});
