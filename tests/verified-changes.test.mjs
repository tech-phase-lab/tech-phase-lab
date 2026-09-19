import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedChanges, verifiedChangeIssues } from "../lib/research/verified-changes.ts";

test("verified WHAT CHANGED records retain valid primary evidence", () => {
  assert.equal(verifiedChanges.length, 4);
  assert.deepEqual(verifiedChanges.map((item) => item.ticker), ["NVDA", "AMD", "AVGO", "CRWV"]);
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
