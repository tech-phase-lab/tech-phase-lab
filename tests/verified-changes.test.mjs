import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedChanges, verifiedChangeIssues } from "../lib/research/verified-changes.ts";

test("verified WHAT CHANGED records retain valid primary evidence", () => {
  assert.equal(verifiedChanges.length, 1);
  assert.deepEqual(verifiedChangeIssues(verifiedChanges[0]), []);
});

test("NVIDIA quarter-on-quarter changes match the filed values", () => {
  const nvda = verifiedChanges.find((item) => item.ticker === "NVDA");
  const revenue = nvda.metrics.find((metric) => metric.id === "revenue");
  const margin = nvda.metrics.find((metric) => metric.id === "gross-margin");
  assert.equal((((revenue.current / revenue.previous) - 1) * 100).toFixed(1), "17.9");
  assert.equal((margin.current - margin.previous).toFixed(1), "0.1");
  assert.equal(nvda.source.publishedOn, "2026-08-26");
});
