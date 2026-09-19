import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedChanges, verifiedChangeIssues } from "../lib/research/verified-changes.ts";

test("verified WHAT CHANGED records retain valid primary evidence", () => {
  assert.equal(verifiedChanges.length, 7);
  assert.deepEqual(verifiedChanges.map((item) => item.ticker), ["NVDA", "AMD", "AVGO", "CRWV", "ARM", "TSM", "ASML"]);
  for (const item of verifiedChanges) assert.deepEqual(verifiedChangeIssues(item), []);
});

test("NVIDIA quarter-on-quarter changes match the filed values", () => {
  const nvda = verifiedChanges.find((item) => item.ticker === "NVDA");
  const revenue = nvda.metrics.find((metric) => metric.id === "revenue");
  const margin = nvda.metrics.find((metric) => metric.id === "gross-margin");
  assert.equal((((revenue.current / revenue.previous) - 1) * 100).toFixed(1), "17.9");
  assert.equal((margin.current - margin.previous).toFixed(1), "0.1");
  assert.equal(nvda.source.publishedOn, "2026-08-26");
});

test("AMD and Broadcom quarter-on-quarter changes match official values", () => {
  const amd = verifiedChanges.find((item) => item.ticker === "AMD");
  const avgo = verifiedChanges.find((item) => item.ticker === "AVGO");
  const amdRevenue = amd.metrics.find((metric) => metric.id === "revenue");
  const avgoOperatingIncome = avgo.metrics.find((metric) => metric.id === "operating-income");
  assert.equal((((amdRevenue.current / amdRevenue.previous) - 1) * 100).toFixed(1), "12.5");
  assert.equal((((avgoOperatingIncome.current / avgoOperatingIncome.previous) - 1) * 100).toFixed(1), "47.9");
});

test("CoreWeave keeps growth and margin contraction separate", () => {
  const crwv = verifiedChanges.find((item) => item.ticker === "CRWV");
  const revenue = crwv.metrics.find((metric) => metric.id === "revenue");
  const margin = crwv.metrics.find((metric) => metric.id === "operating-margin");
  assert.equal((((revenue.current / revenue.previous) - 1) * 100).toFixed(1), "112.5");
  assert.equal((margin.current - margin.previous).toFixed(1), "-4.0");
  assert.match(crwv.unknown.ja, /バックログ/);
});

test("Arm retains company-reported year-on-year changes without reverse-derived priors", () => {
  const arm = verifiedChanges.find((item) => item.ticker === "ARM");
  assert.equal(arm.metrics.every((metric) => metric.previous === null && metric.change.companyReported), true);
  assert.equal(arm.metrics.find((metric) => metric.id === "revenue").current, 1.29);
});

test("TSMC quarter-on-quarter revenue and margins match official releases", () => {
  const tsm = verifiedChanges.find((item) => item.ticker === "TSM");
  const revenue = tsm.metrics.find((metric) => metric.id === "revenue");
  const grossMargin = tsm.metrics.find((metric) => metric.id === "gross-margin");
  assert.equal((((revenue.current / revenue.previous) - 1) * 100).toFixed(1), "12.0");
  assert.equal((grossMargin.current - grossMargin.previous).toFixed(1), "1.5");
  assert.equal(tsm.additionalSources.length, 1);
});

test("ASML euro-denominated comparisons remain distinct from USD", () => {
  const asml = verifiedChanges.find((item) => item.ticker === "ASML");
  const sales = asml.metrics.find((metric) => metric.id === "sales");
  const margin = asml.metrics.find((metric) => metric.id === "gross-margin");
  assert.equal(sales.unit, "eur-billion");
  assert.equal((((sales.current / sales.previous) - 1) * 100).toFixed(1), "6.4");
  assert.equal((margin.current - margin.previous).toFixed(1), "1.0");
});
