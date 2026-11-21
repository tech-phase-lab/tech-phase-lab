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
  // Review v3 ordering: always as stored first, then pre-split, then wrong-way; never ordered by price.
  for (const avg of [755, 40]) {
    const ordered = adjustForSplits([L({ shares: 10, avgCostUsd: avg, checkedAt: "2026-11-21" })], SNDK, "2026-11-21", "2026-11-22", { prices: PRICE }).ambiguous[0];
    assert.deepEqual(ordered.readings.map(x => [x.kind, x.shares]), [["as-stored", 10], ["pre-split", 80], ["wrong-way", 640]]);
  }
});
test("review v3 P (blocker): a lot saved by the paused screen (no date, filled from the previous save) in a file saved after the split is asked, never ×8 silently", () => {
  const previous = JSON.stringify({ version: 2, savedAt: "2026-11-15T01:00:00.000Z", holdings: [] });
  const raw = serialize([L({ shares: 80, avgCostUsd: 94 })], previous); // the paused screen's lot has no checkedAt and no basis
  const stored = parseStored(raw);
  assert.equal(stored[0].checkedAt, "2026-11-15");
  const savedDay = JSON.parse(raw).savedAt.slice(0, 10);
  const r = adjustForSplits(stored, SNDK, savedDay, "2026-11-22", { through: { SNDK: "2026-11-21" }, savedDay: "2026-11-21" });
  assert.equal(r.holdings[0], stored[0]);
  assert.deepEqual(r.ambiguous[0].readings.map(x => [x.kind, x.shares, x.avgCostUsd]), [["as-stored", 80, 94], ["pre-split", 640, 11.75], ["wrong-way", 5120, 1.46875]]);
  // The same old lot in a file last saved before the split is on the old basis and adjusted as usual.
  assert.equal(adjustForSplits(stored, SNDK, "2026-11-15", "2026-11-22", { savedDay: "2026-11-15" }).holdings[0].shares, 640);
});
test("review v3 Q: a lot this screen adjusted itself is confirmed against that split and never asked about again", () => {
  const r = adjustForSplits([L({ shares: 10, avgCostUsd: 755, checkedAt: "2026-11-10", basis: 2 })], SNDK, "2026-11-01", "2026-11-22", { through: { SNDK: "2026-11-21" } });
  assert.deepEqual(r.holdings.map(h => [h.shares, h.avgCostUsd, h.checkedAt, h.confirmedSplit]), [[80, 94.375, "2026-11-21", "2026-11-20"]]);
  const again = adjustForSplits(parseStored(serialize(r.holdings)), SNDK, "2026-11-21", "2026-11-23", { through: { SNDK: "2026-11-22" }, savedDay: "2026-11-22" });
  assert.deepEqual([again.ambiguous.length, again.holdings[0].shares], [0, 80]);
});
test("review v3 R: a lot typed or read on 11/23 is asked once (broker lag); one on 11/26 is not", () => {
  assert.deepEqual(adjustForSplits([fresh(L({ shares: 80, avgCostUsd: 94 }), "2026-11-23")], SNDK, "2026-11-01", "2026-11-23").ambiguous[0].readings.map(x => x.kind), ["as-stored", "pre-split"]);
  assert.equal(adjustForSplits([fresh(L({ shares: 80, avgCostUsd: 94 }), "2026-11-26")], SNDK, "2026-11-01", "2026-11-26").ambiguous.length, 0);
});
test("review v3 C: choosing twice (a stale screen) gives the same numbers; the choice is not asked again a week later", () => {
  const lot = L({ shares: 1.25, avgCostUsd: 6040, checkedAt: "2026-11-21" });
  const a = adjustForSplits([lot], SNDK, "2026-11-01", "2026-11-22").ambiguous[0];
  const w = a.readings.find(x => x.kind === "wrong-way");
  const once = parseStored(serialize(chooseReading([lot], a, w)));
  const twice = parseStored(serialize(chooseReading(once, a, w)));
  assert.deepEqual(twice.map(l => [l.shares, l.avgCostUsd]), [[80, 94.375]]);
  const later = adjustForSplits(twice, SNDK, "2026-11-22", "2026-12-01", { through: { SNDK: "2026-11-30" }, savedDay: "2026-11-22" });
  assert.deepEqual([later.ambiguous.length, later.holdings[0].shares], [0, 80]);
});
test("review v3 M: two open splits offer cumulative readings, and the choice (today's numbers) settles both", () => {
  const two = { SNDK: [...SNDK.SNDK, { ticker: "SNDK", date: "2026-12-10", ratio: 2 }] };
  const lot = L({ shares: 10, avgCostUsd: 755, checkedAt: "2026-12-10" });
  const r = adjustForSplits([lot], two, "2026-11-01", "2026-12-12", { through: { SNDK: "2026-12-11" } });
  assert.equal(r.holdings[0], lot);
  assert.deepEqual(r.ambiguous[0].readings.map(x => [x.kind, x.splits, x.factor]), [["as-stored", 0, 1], ["pre-split", 1, 2], ["pre-split", 2, 16], ["wrong-way", 1, 4], ["wrong-way", 2, 256]]);
  const picked = chooseReading([lot], r.ambiguous[0], r.ambiguous[0].readings[2]);
  assert.deepEqual(picked.map(l => [l.shares, l.confirmedSplit]), [[160, "2026-12-10"]]);
  assert.equal(adjustForSplits(picked, two, "2026-12-12", "2026-12-20").ambiguous.length, 0);
  // "As stored" settles both too: neither split is applied later.
  assert.equal(adjustForSplits(chooseReading([lot], r.ambiguous[0], r.ambiguous[0].readings[0]), two, "2026-12-12", "2026-12-20").holdings[0].shares, 10);
});
test("review v4 (1): a split after the one the choice settles (even one while the choice was pending) is still applied", () => {
  const later = { SNDK: [...SNDK.SNDK, { ticker: "SNDK", date: "2026-12-10", ratio: 2 }] };
  const lot = L({ shares: 1.25, avgCostUsd: 6040, checkedAt: "2026-11-21" });
  // The file was last saved on 11/21: only the 11/20 split is open for this old lot; the 12/10 one is ordinary.
  const r = adjustForSplits([lot], later, "2026-11-21", "2026-12-20", { savedDay: "2026-11-21" });
  assert.deepEqual(r.ambiguous[0].splits.map(s => s.date), ["2026-11-20"]);
  const picked = chooseReading([lot], r.ambiguous[0], r.ambiguous[0].readings.find(x => x.kind === "wrong-way"));
  assert.deepEqual(picked.map(l => [l.shares, l.checkedAt, l.confirmedSplit]), [[80, "2026-11-20", "2026-11-20"]]);
  const shown = adjustForSplits(picked, later, "2026-11-21", "2026-12-20", { savedDay: "2026-12-20" });
  assert.deepEqual([shown.ambiguous.length, shown.holdings[0].shares, shown.holdings[0].avgCostUsd], [0, 160, 47.1875]);
});
test("review v3 APH: lots of any date are not asked about APH 2026-09-03 (older than the portfolio)", () => {
  const aph = knownSplits(["APH"]);
  for (const checkedAt of ["2026-11-01", "2026-11-02", "2026-11-21", undefined]) {
    const r = adjustForSplits([{ ticker: "APH", shares: 100, avgCostUsd: 150, source: "SBI", ...(checkedAt ? { checkedAt } : {}) }], aph, "2026-11-01", "2026-11-22", { through: { APH: "2026-11-21" }, savedDay: "2026-11-21" });
    assert.deepEqual([r.ambiguous.length, r.holdings[0].shares], [0, 100]);
  }
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
test("the reader's choice is written once, dated and confirmed at the split it settles; a correct lot is never touched", () => {
  const wrong = L({ shares: 1.25, avgCostUsd: 6040, checkedAt: "2026-11-21" });
  const right = L({ shares: 80, avgCostUsd: 94, source: "楽天", checkedAt: "2026-11-28", basis: 2 });
  const r = adjustForSplits([wrong, right], SNDK, "2026-11-21", "2026-11-30", { prices: PRICE });
  assert.deepEqual(r.ambiguous.map(a => a.source), ["SBI"]);
  const picked = chooseReading([wrong, right], r.ambiguous[0], r.ambiguous[0].readings.find(x => x.kind === "wrong-way"));
  assert.deepEqual(picked.map(l => [l.shares, l.avgCostUsd, l.checkedAt, l.basis ?? null, l.confirmedSplit ?? null]), [[80, 94.375, "2026-11-20", 2, "2026-11-20"], [80, 94, "2026-11-28", 2, null]]);
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
test("owner wording (Nov 21): the split check says what happened in plain Japanese, with ドル and one line per choice", async () => {
  const C = await import("../lib/portfolio/split-copy.ts");
  const lots = [L({ source: "楽天証券", shares: 80, avgCostUsd: 94, checkedAt: "2026-11-15" }), L({ source: "SBI証券", shares: 1.25, avgCostUsd: 6040, checkedAt: "2026-11-21" })];
  const r = adjustForSplits(lots, SNDK, "2026-11-15", "2026-11-22", { savedDay: "2026-11-21" });
  assert.deepEqual(C.splitSentences(r.ambiguous, true), ["SNDK は 11/20 に、1株が8株に分割されました。"]);
  assert.deepEqual(r.ambiguous.map(a => [C.lotTitle(a, true), ...a.readings.map(x => C.readingLabel(x, true))]), [
    ["SNDK（楽天証券）", "80株・平均取得 94.00ドル（登録したまま）", "640株・平均取得 11.75ドル（分割前の数字として8倍にする）", "5,120株・平均取得 1.47ドル（誤って8分の1になった数字を直す）"],
    ["SNDK（SBI証券）", "1.25株・平均取得 6,040.00ドル（登録したまま）", "10株・平均取得 755.00ドル（分割前の数字として8倍にする）", "80株・平均取得 94.38ドル（誤って8分の1になった数字を直す）"],
  ]);
  assert.equal(C.splitPhrase({ ticker: "X", date: "2026-12-01", ratio: 0.125 }, true), "8株が1株に併合されました");
  assert.equal(C.readingLabel({ kind: "wrong-way", factor: 4, splits: 1, shares: 40, avgCostUsd: 25 }, true), "40株・平均取得 25.00ドル（誤って2分の1になった数字を直す）");
  assert.equal(C.readingLabel({ kind: "pre-split", factor: 2, splits: 1, shares: 20, avgCostUsd: 50 }, true), "20株・平均取得 50.00ドル（分割前の数字として2倍にする）");
  assert.equal(C.adjustedNote([{ ticker: "SNDK", date: "2026-11-20", ratio: 8 }], true), "SNDK（11/20 に1株が8株に分割）より前に登録した株数と平均取得は、分割後の数字で表示しています。取得額の合計は変わりません。");
  const screen = readFileSync(new URL("../app/research/portfolio/screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /株式分割の確認をお願いします/); assert.doesNotMatch(screen, /splitLabel/);
});
