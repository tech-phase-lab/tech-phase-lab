import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { quarterlyRevenue, barsBefore } from "../lib/research/earnings-history.ts";

// A real capture of Micron's company facts (revenue only), Nov 6 2026.
const facts = JSON.parse(readFileSync(new URL("./fixtures/sec-mu-revenue-facts.json", import.meta.url), "utf8"));

test("quarterly revenue: three quarters from the 10-Qs and the fourth from the 10-K year minus them", () => {
  const series = quarterlyRevenue(facts, 20);
  const byEnd = Object.fromEntries(series.map(q => [q.end, q]));
  assert.equal(byEnd["2026-05-28"].value, 41456);
  assert.equal(byEnd["2026-05-28"].label, "Q3");
  // FY2026 Q4 = 133,188 - (13,643 + 23,860 + 41,456) = 54,229, the figure in the release
  assert.equal(byEnd["2026-09-03"].value, 54229);
  assert.equal(byEnd["2026-09-03"].label, "Q4");
  assert.equal(byEnd["2025-08-28"].value, 37378 - (8709 + 8053 + 9301));
  assert.deepEqual(series.map(q => q.end), [...series.map(q => q.end)].sort());
});

test("the bars before the reported quarter exclude it and everything later", () => {
  const series = quarterlyRevenue(facts, 20);
  const bars = barsBefore(series, 2026, 4, 7);
  assert.equal(bars.length, 7);
  assert.equal(bars[bars.length - 1].end, "2026-05-28");
  assert.ok(bars.every(q => q.end < "2026-09-03"));
  assert.equal(barsBefore(series, 2026, 4, 3).length, 3);
});

test("a company without a clean series gets no bars", () => {
  assert.deepEqual(quarterlyRevenue({}), []);
  assert.deepEqual(quarterlyRevenue(null), []);
  assert.deepEqual(quarterlyRevenue({ facts: { "us-gaap": { Revenues: { units: { USD: [{ start: "2025-01-01", end: "2025-03-31", val: 5, form: "10-Q", filed: "2025-05-01" }] } } } } }), []);
});
