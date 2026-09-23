import { test } from "node:test";
import assert from "node:assert/strict";
import { compareMetrics, evidenceIssues } from "../lib/research/quality.ts";
import { events } from "../lib/research/data.ts";

const current = events.find((event) => event.id === "nbis-q2-2026").metrics[0];
const prior = events.find((event) => event.id === "nbis-q2-2026").previous[0];

test("same-scope revenue compares with the previous year using unrounded source values", () => {
  const result = compareMetrics(current, prior);
  assert.equal(result.ok, true);
  assert.equal(result.value.toFixed(1), "454.0");
});

test("ARR cannot be presented as growth in quarterly revenue", () => {
  assert.equal(compareMetrics(events[1].metrics[1], prior).ok, false);
});

test("GAAP / non-GAAP, scope, currency, guidance, and duration mismatches abstain", () => {
  for (const change of [{ basis: "non-GAAP" }, { scope: "Nebius AI cloud" }, { currency: null }, { kind: "guidance" }, { duration: "annual" }, { unit: "per-share" }]) {
    assert.equal(compareMetrics({ ...current, ...change }, prior).ok, false);
  }
});

test("negative and zero baselines do not produce misleading growth percentages", () => {
  for (const value of [-1, 0]) assert.equal(compareMetrics(current, { ...prior, value }).ok, false);
});

test("gross margin is measured in percentage points, not percent growth", () => {
  const event = events.find((event) => event.id === "mu-q3-2026");
  const result = compareMetrics(event.metrics[1], event.previous[1]);
  assert.equal(result.ok, true);
  assert.equal(result.unit, "pp");
  assert.equal(result.value.toFixed(1), "10.2");
});

test("invalid numbers and reverse or identical periods are rejected", () => {
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(compareMetrics({ ...current, value }, prior).ok, false);
  assert.equal(compareMetrics(prior, current).ok, false);
  assert.equal(compareMetrics(current, current).ok, false);
});

test("all shipped facts and current/comparative metrics have valid source references", () => {
  for (const event of events) assert.deepEqual(evidenceIssues({ ...event, metrics: [...event.metrics, ...(event.previous ?? [])] }), [], event.id);
});

test("external industry ratings are labeled as secondary research and retain their source limits", () => {
  const event = events.find((item) => item.id === "nbis-clustermax-platinum-2026-09-23");
  assert.equal(event.kind, "external-research");
  assert.equal(event.sources[0].publisher, "SemiAnalysis · paid industry research");
  assert.match(event.interpretation.ja, /第三者/);
  assert.match(event.unknown.ja, /有料記事/);
  assert.deepEqual(evidenceIssues(event), []);
});

test("missing evidence, unsafe URLs, invalid dates, and pre-publication reviews fail validation", () => {
  const event = events[1];
  assert.ok(evidenceIssues({ ...event, facts: [{ sourceIds: ["unknown"] }] }).includes("unsupported-fact"));
  assert.ok(evidenceIssues({ ...event, sources: [] }).includes("missing-source"));
  assert.ok(evidenceIssues({ ...event, sources: [{ ...event.sources[0], url: "javascript:alert(1)" }] }).includes("unsafe-source-url"));
  assert.ok(evidenceIssues({ ...event, reviewedOn: "2026-02-30" }).includes("invalid-date"));
  assert.ok(evidenceIssues({ ...event, reviewedOn: "2025-01-01" }).includes("review-before-publication"));
});
