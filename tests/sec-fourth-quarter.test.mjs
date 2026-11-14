import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractFinancials } from "../lib/research/comparison.ts";

const facts = t => JSON.parse(readFileSync(new URL(`./fixtures/sec-companyfacts-${t}.json`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-13T00:00:00Z"); // real filings (MU 10-K 2026-10-09, QCOM 10-K 2026-11-04)

test("MU right after its 10-K: the fourth quarter is the fiscal year minus the nine months, marked derived", () => {
  const f = extractFinancials("MU", "723125", facts("MU"), NOW);
  assert.equal(f.status, "ready");
  assert.equal(f.quarterRevenue.value, 133_188_000_000 - 78_959_000_000);
  assert.equal(f.quarterRevenue.derived, "fy-minus-9m");
  assert.equal(f.quarterRevenue.end, "2026-09-03"); assert.equal(f.quarterRevenue.start, "2026-05-29");
  assert.equal(f.previousQuarterRevenue.value, 37_378_000_000 - 26_063_000_000);
  assert.equal(f.previousQuarterRevenue.derived, "fy-minus-9m");
  assert.equal(f.quarterOperatingIncome.value, 99_340_000_000 - 55_589_000_000);
  assert.ok(Math.abs(f.quarterRevenueGrowth - (54_229 / 11_315 - 1) * 100) < 1e-6);
  assert.ok(Math.abs(f.quarterOperatingMargin - 43_751 / 54_229 * 100) < 1e-6);
  // The annual figures stay exactly as reported (never marked derived).
  assert.equal(f.revenue.value, 133_188_000_000); assert.equal(f.revenue.derived, undefined);
});

test("QCOM right after its 10-K (September year end) is handled the same way", () => {
  const f = extractFinancials("QCOM", "804328", facts("QCOM"), NOW);
  assert.equal(f.quarterRevenue.value, 43_120_000_000 - 32_798_000_000);
  assert.equal(f.quarterRevenue.derived, "fy-minus-9m");
  assert.equal(f.quarterOperatingIncome.value, 8_658_000_000 - 7_302_000_000);
  assert.equal(f.previousQuarterRevenue.value, 44_284_000_000 - 33_013_000_000);
});

test("without the nine-month figure nothing is derived (no guess)", () => {
  const data = facts("MU");
  for (const tag of Object.values(data.facts["us-gaap"])) tag.units.USD = tag.units.USD.filter(x => !(x.form === "10-Q" && x.start === "2025-08-29" && x.end === "2026-05-28"));
  const f = extractFinancials("MU", "723125", data, NOW);
  assert.equal(f.quarterRevenue, null); assert.equal(f.quarterOperatingIncome, null);
});

test("a directly reported later quarter always wins over a derived one", () => {
  const data = facts("MU");
  data.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push({ start: "2026-09-04", end: "2026-12-03", val: 1, form: "10-Q", filed: "2026-12-18", accn: "0000723125-26-000099" });
  const f = extractFinancials("MU", "723125", data, Date.parse("2026-12-30T00:00:00Z"));
  assert.equal(f.quarterRevenue.derived, undefined);
});

test("LITE: a 10-Q that tags revenue 'including assessed tax' is read as the quarter (it used to be missed)", () => {
  const f = extractFinancials("LITE", "1633978", facts("LITE"), NOW);
  assert.equal(f.quarterRevenue.value, 1_262_600_000); assert.equal(f.quarterRevenue.end, "2026-09-26");
  assert.equal(f.quarterRevenue.derived, undefined);
  assert.equal(f.previousQuarterRevenue.value, 533_800_000);
  assert.equal(f.quarterOperatingIncome.value, 359_800_000);
});

test("the last four quarters' operating margins (stability factor) include the derived fourth quarter and come out newest first", () => {
  const f = extractFinancials("MU", "723125", facts("MU"), NOW);
  const expected = [[ "2026-09-03", 43_751 / 54_229 ], ["2026-05-28", 33_318 / 41_456], ["2026-02-26", 16_135 / 23_860], ["2025-11-27", 6_136 / 13_643]];
  assert.deepEqual(f.quarterMargins.map(m => m.periodEnd), expected.map(e => e[0]));
  f.quarterMargins.forEach((m, i) => assert.ok(Math.abs(m.value - expected[i][1] * 100) < 1e-9));
});

test("a missing quarter (no operating income for one of the four) leaves the series empty rather than shorter", () => {
  const data = facts("MU");
  const op = data.facts["us-gaap"].OperatingIncomeLoss.units.USD;
  data.facts["us-gaap"].OperatingIncomeLoss.units.USD = op.filter(x => !(x.end === "2026-02-26" && x.start === "2025-11-28"));
  assert.equal(extractFinancials("MU", "723125", data, NOW).quarterMargins, null);
});
