import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGACY_SPLITS, adjustForSplits, chooseReading, fresh, knownSplits, parseSplits } from "../lib/portfolio/splits.ts";
import { aggregate, valueHoldings } from "../lib/portfolio/calc.ts";
import { parseStored, serialize } from "../lib/portfolio/store.ts";
import { knownThroughDay } from "../lib/research/stock-splits.ts";

// Lots written by the split-aware screen carry basis: 2; lots without it were last written by the old screen.
const lot = (extra = {}) => ({ ticker: "APH", shares: 100, avgCostUsd: 149.97, source: "A", basis: 2, ...extra });
const APH = { APH: [{ ticker: "APH", date: "2026-10-05", ratio: 2 }] };
const SNDK = knownSplits(["SNDK"]);
const PRICE = { SNDK: 79.24 };
const L = extra => ({ ticker: "SNDK", source: "SBI", ...extra });

test("a 2-for-1 split doubles the shares and halves the average cost when read; the yen rate stays", () => {
  const { holdings, applied } = adjustForSplits([lot({ avgCostFx: 150, checkedAt: "2026-10-01" })], APH, "2026-10-01", "2026-11-11");
  assert.equal(holdings[0].shares, 200); assert.equal(holdings[0].avgCostUsd, 74.985); assert.equal(holdings[0].avgCostFx, 150);
  assert.equal(holdings[0].checkedAt, "2026-11-11"); assert.equal(holdings[0].basis, 2); assert.deepEqual(applied, [{ ticker: "APH", date: "2026-10-05", ratio: 2 }]);
});
test("a lot checked after the split is not adjusted again; saving the shown lots never applies a split twice", () => {
  assert.equal(adjustForSplits([lot({ checkedAt: "2026-10-20" })], APH, "2026-10-01", "2026-11-11").holdings[0].shares, 100);
  const once = adjustForSplits([lot({ checkedAt: "2026-10-01" })], APH, "2026-10-01", "2026-11-11").holdings;
  assert.equal(adjustForSplits(once, APH, "2026-10-01", "2026-12-01").holdings[0].shares, 200);
});
test("a reverse split and a 3-for-2 are handled", () => {
  const reverse = adjustForSplits([lot({ shares: 100, avgCostUsd: 2, checkedAt: "2026-10-01" })], { APH: [{ ticker: "APH", date: "2026-10-05", ratio: 0.1 }] }, "2026-10-01", "2026-11-11").holdings[0];
  assert.equal(reverse.shares, 10); assert.equal(reverse.avgCostUsd, 20);
  const three = adjustForSplits([lot({ shares: 10, checkedAt: "2026-10-01" })], { APH: [{ ticker: "APH", date: "2026-10-05", ratio: 1.5 }] }, "2026-10-01", "2026-11-11").holdings[0];
  assert.equal(three.shares, 15);
});
test("B3 (review M): a ticker the provider failed for is left exactly as it is, and its date is never advanced, so a later answer still applies", () => {
  const lots = [{ ticker: "XYZ", shares: 100, avgCostUsd: 200, source: "SBI", checkedAt: "2026-11-01" }];
  const shown = adjustForSplits(lots, {}, "2026-11-01", "2026-11-21").holdings;
  assert.equal(shown[0], lots[0]);
  const stored = parseStored(serialize([...shown, fresh({ ticker: "MU", shares: 1, avgCostUsd: 100, source: "手入力" }, "2026-11-21")]));
  assert.equal(adjustForSplits(stored, { XYZ: [{ ticker: "XYZ", date: "2026-11-10", ratio: 4 }] }, "2026-11-21", "2026-11-22").holdings[0].shares, 400);
});
test("B3: with only the manual list (provider failed) the date moves to the last split applied, never to today", () => {
  const r = adjustForSplits([L({ shares: 10, avgCostUsd: 755, checkedAt: "2026-11-01", basis: 2 })], SNDK, "2026-11-01", "2026-11-30", { through: {} });
  assert.deepEqual([r.holdings[0].shares, r.holdings[0].avgCostUsd, r.holdings[0].checkedAt], [80, 94.375, "2026-11-20"]);
});
test("review v2 #4: a cached complete answer never dates a lot past the day before it was read, so a split it could not list is found later", () => {
  const XYZ = { ticker: "XYZ", shares: 100, avgCostUsd: 200, source: "SBI", checkedAt: "2027-01-05", basis: 2 };
  // Answer read on the split day (2027-02-01, still without the row), shown on Feb 2: the lot is dated Jan 31 at most.
  const shown = adjustForSplits([XYZ], { XYZ: [] }, "2027-01-05", "2027-02-02", { through: { XYZ: knownThroughDay("2027-02-01T15:00:00Z") } }).holdings[0];
  assert.equal(shown.checkedAt, "2027-01-31");
  const fresher = { XYZ: [{ ticker: "XYZ", date: "2027-02-01", ratio: 2 }] };
  assert.equal(adjustForSplits([shown], fresher, "2027-01-31", "2027-02-10").holdings[0].shares, 200);
});
test("the provider's rows: from_factor is the NEW share count (NVDA 10-for-1 = from 10, to 1; GE 1-for-8 = from 1, to 8); an error answer throws", () => {
  assert.deepEqual(parseSplits({ meta: { symbol: "SNDK" }, splits: [{ date: "2026-11-20", description: "8-for-1 split", ratio: 0.125, from_factor: 8, to_factor: 1 }] }, "SNDK"),
    [{ ticker: "SNDK", date: "2026-11-20", ratio: 8 }]);
  assert.deepEqual(parseSplits({ meta: { symbol: "GE" }, splits: [{ date: "2021-08-02", from_factor: 1, to_factor: 8 }] }, "GE"), [{ ticker: "GE", date: "2021-08-02", ratio: 0.125 }]);
  assert.deepEqual(parseSplits({ meta: { symbol: "APH" }, splits: [{ date: "2026-11-05", from_factor: 2, to_factor: 1 }, { date: "bad", from_factor: 2, to_factor: 1 }, { date: "2026-01-01", from_factor: 1, to_factor: 1 }] }, "APH"), [{ ticker: "APH", date: "2026-11-05", ratio: 2 }]);
  assert.deepEqual(parseSplits({ meta: { symbol: "APH" }, splits: [] }, "APH"), []);
  assert.throws(() => parseSplits({ meta: { symbol: "XYZ" }, splits: [] }, "APH"));
  assert.throws(() => parseSplits({ status: "error", code: 429 }, "APH"));
});
test("SNDK 8-for-1 (2026-11-20): a lot entered before shows ×8 shares and ÷8 cost with the same total; a lot entered well after is left alone", () => {
  assert.deepEqual(SNDK.SNDK.map(s => [s.date, s.ratio]), [["2026-11-20", 8]]);
  const before = L({ shares: 10, avgCostUsd: 400, checkedAt: "2026-11-19", basis: 2 });
  const after = L({ shares: 80, avgCostUsd: 50, source: "楽天", checkedAt: "2026-11-25", basis: 2 });
  const { holdings, applied, ambiguous } = adjustForSplits([before, after], SNDK, "2026-11-01", "2026-11-26");
  assert.deepEqual(holdings.map(h => [h.source, h.shares, h.avgCostUsd]), [["SBI", 80, 50], ["楽天", 80, 50]]);
  assert.deepEqual(applied, [{ ticker: "SNDK", date: "2026-11-20", ratio: 8 }]); assert.deepEqual(ambiguous, []);
  const { totals } = valueHoldings(aggregate(holdings), { SNDK: { ticker: "SNDK", close: 79.24, asOf: "2026-11-25" } }, 155);
  assert.equal(totals.costUsd, 8000); assert.ok(Math.abs(totals.valueUsd - 160 * 79.24) < 1e-9);
  assert.equal(adjustForSplits([before], SNDK, "2026-11-01", "2026-11-19").holdings[0].shares, 10);
});

// The old screen (Nov 11 #396 to this change) applied Twelve Data's 8-for-1 as ÷8, saved it, and re-dated the lot on every visit.
test("review v2 #1/#2 (B1/B1b/N): every old-screen lot dated on or after the split is shown as stored, never adjusted, re-dated or saved, whatever its cost", () => {
  for (const avg of [755, 400, 100, 50, 30]) for (const checkedAt of ["2026-11-20", "2026-11-21", "2026-12-15"]) {
    const stored = L({ shares: 1.25, avgCostUsd: avg * 8, checkedAt });
    const r = adjustForSplits([stored], SNDK, checkedAt, "2026-12-20", { prices: PRICE });
    assert.equal(r.holdings[0], stored);
    assert.deepEqual(r.ambiguous[0].readings.map(x => x.kind).sort(), ["as-stored", "pre-split", "wrong-way"]);
    const wrongWay = r.ambiguous[0].readings.find(x => x.kind === "wrong-way");
    assert.deepEqual([wrongWay.shares, wrongWay.avgCostUsd], [80, avg / 8]);
  }
  // A lot the old screen never re-dated past the split (dated before it) is on the old basis: adjusted as usual.
  assert.equal(adjustForSplits([L({ shares: 10, avgCostUsd: 400, checkedAt: "2026-11-15" })], SNDK, "2026-11-15", "2026-11-30").holdings[0].shares, 80);
});
test("review v2 #2/#3: lots dated on a split's own days are never classified by price; only the reader's choice writes them", () => {
  for (const avg of [755, 400, 224, 200, 100, 40]) {
    const stored = L({ shares: 10, avgCostUsd: avg, checkedAt: "2026-11-20", basis: 2 });
    const r = adjustForSplits([stored], SNDK, "2026-11-20", "2026-11-21", { prices: PRICE });
    assert.equal(r.holdings[0], stored);
    assert.deepEqual(r.ambiguous[0].readings.map(x => x.kind).sort(), ["as-stored", "pre-split"]);
  }
  // Broker lag: read on Nov 23, still asked; on Nov 25 (more than four days after) it is not.
  assert.equal(adjustForSplits([L({ shares: 10, avgCostUsd: 400, checkedAt: "2026-11-23", basis: 2 })], SNDK, "2026-11-23", "2026-11-24").ambiguous.length, 1);
  assert.equal(adjustForSplits([L({ shares: 80, avgCostUsd: 50, checkedAt: "2026-11-25", basis: 2 })], SNDK, "2026-11-25", "2026-11-26").ambiguous.length, 0);
  // The price only orders the readings: the closest to today's price comes first.
  const ordered = adjustForSplits([L({ shares: 10, avgCostUsd: 755, checkedAt: "2026-11-20", basis: 2 })], SNDK, "2026-11-20", "2026-11-21", { prices: PRICE }).ambiguous[0];
  assert.equal(ordered.readings[0].kind, "pre-split");
});
test("review v2 #3: only splits the old screen could have applied make an old lot ambiguous (NVDA 2007/2021/2024, GE 2021 never do)", () => {
  assert.deepEqual(LEGACY_SPLITS, { after: "2026-11-01", through: "2026-12-31" });
  const NV = { NVDA: [{ ticker: "NVDA", date: "2007-09-11", ratio: 1.5 }, { ticker: "NVDA", date: "2021-07-20", ratio: 4 }, { ticker: "NVDA", date: "2024-06-10", ratio: 10 }] };
  for (const [shares, avg] of [[4, 200], [0.4, 180]]) {
    const r = adjustForSplits([{ ticker: "NVDA", source: "SBI", shares, avgCostUsd: avg, checkedAt: "2026-11-01" }], NV, "2026-11-01", "2026-11-21", { prices: { NVDA: 100 } });
    assert.deepEqual([r.ambiguous.length, r.holdings[0].shares], [0, shares]);
  }
  const GE = { GE: [{ ticker: "GE", date: "2021-08-02", ratio: 0.125 }] };
  assert.equal(adjustForSplits([{ ticker: "GE", source: "SBI", shares: 128, avgCostUsd: 12, checkedAt: "2026-11-01" }], GE, "2026-11-01", "2026-11-21", { prices: { GE: 300 } }).ambiguous.length, 0);
  // APH 2026-09-03 is older than the portfolio itself (2026-11-01): no saved lot can predate it.
  assert.equal(adjustForSplits([{ ticker: "APH", source: "SBI", shares: 50, avgCostUsd: 140, checkedAt: "2026-11-12" }], knownSplits(["APH"]), "2026-11-12", "2026-11-21").ambiguous.length, 0);
});
test("the reader's choice is written once, on today's basis, confirmed against that split; a correct lot is never touched", () => {
  const wrong = L({ shares: 1.25, avgCostUsd: 6040, checkedAt: "2026-11-21" });
  const right = L({ shares: 80, avgCostUsd: 94, source: "楽天", checkedAt: "2026-11-28", basis: 2 });
  const r = adjustForSplits([wrong, right], SNDK, "2026-11-21", "2026-11-30", { prices: PRICE });
  assert.deepEqual(r.ambiguous.map(a => a.source), ["SBI"]);
  const picked = chooseReading([wrong, right], r.ambiguous[0], r.ambiguous[0].readings.find(x => x.kind === "wrong-way"), "2026-11-30");
  assert.deepEqual(picked.map(l => [l.shares, l.avgCostUsd, l.checkedAt, l.basis ?? null, l.confirmedSplit ?? null]), [[80, 94.375, "2026-11-30", 2, "2026-11-20"], [80, 94, "2026-11-28", 2, null]]);
  const again = adjustForSplits(parseStored(serialize(picked)), SNDK, "2026-11-30", "2026-12-01", { prices: PRICE });
  assert.deepEqual([again.ambiguous.length, again.holdings[0].shares], [0, 80]);
});
test("review L: a check date later than today is kept", () => {
  assert.equal(adjustForSplits([L({ shares: 10, avgCostUsd: 755, checkedAt: "2026-11-20", basis: 2 })], SNDK, "2026-11-01", "2026-11-19").holdings[0].checkedAt, "2026-11-20");
});
test("saving keeps a lot's check date and marks, and a lot without a date takes the previous save's day", () => {
  const previous = JSON.stringify({ version: 2, savedAt: "2026-10-20T01:00:00.000Z", holdings: [] });
  const stored = JSON.parse(serialize([lot({ basis: undefined }), lot({ ticker: "MU", checkedAt: "2026-11-01", confirmedSplit: "2026-10-05" })], previous));
  assert.equal(stored.holdings[0].checkedAt, "2026-10-20"); assert.equal(stored.holdings[1].checkedAt, "2026-11-01");
  const read = parseStored(JSON.stringify(stored));
  assert.equal(read[0].checkedAt, "2026-10-20"); assert.equal(read[0].basis, undefined);
  assert.deepEqual([read[1].basis, read[1].confirmedSplit], [2, "2026-10-05"]);
});
test("the portfolio screen never rewrites saved holdings for a split by itself (replaces the Nov 21 pause, #735)", () => {
  const screen = readFileSync(new URL("../app/research/portfolio/screen.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /applySplits|SPLIT_ADJUSTMENT_PAUSED/);
  const writes = screen.split("\n").filter(line => line.includes("writeHoldings("));
  assert.equal(writes.length, 4);
  for (const [i, word] of ["chooseReading(lots, lot, reading", "onAdd={h =>", "onClear={", "replaceSource(existing"].entries()) assert.ok(writes[i].includes(word), word);
  assert.match(screen, /const current = useMemo\(\(\) => adjustForSplits\(/);
});
