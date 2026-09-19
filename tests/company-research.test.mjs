import { test } from "node:test";
import assert from "node:assert/strict";
import { events } from "../lib/research/data.ts";
import { buildCompanyProfiles, companyProfileIssues } from "../lib/research/companies.ts";
import { compareMetrics } from "../lib/research/quality.ts";

const profiles = buildCompanyProfiles(events);
const nbis = profiles.find((profile) => profile.ticker === "NBIS");

test("company history, metric periods, and evidence references remain consistent", () => {
  for (const profile of profiles) {
    assert.deepEqual(companyProfileIssues(profile), []);
    for (const row of profile.comparisons) {
      const comparison = compareMetrics(row.current, row.previous);
      assert.ok(comparison.ok || comparison.reason === "non-positive-base");
    }
    assert.deepEqual(profile.events.map((event) => event.publishedOn), profile.events.map((event) => event.publishedOn).toSorted().reverse());
  }
});

test("quarter-on-quarter and year-on-year revenue changes stay distinct", () => {
  const row = nbis.comparisons.find((item) => item.id === "revenue");
  assert.equal(compareMetrics(row.current, row.previous).value.toFixed(1), "45.9");
  const event = events.find((item) => item.id === "nbis-q2-2026");
  assert.equal(compareMetrics(event.metrics[0], event.previous[0]).value.toFixed(1), "454.0");
});

test("ARR growth uses the more precise published Q1 value and remains approximate", () => {
  const row = nbis.comparisons.find((item) => item.id === "arr");
  assert.equal(compareMetrics(row.current, row.previous).value.toFixed(1), "56.3");
  assert.equal(row.approximate, true);
});

test("a widening operating loss cannot be labeled positive percentage growth", () => {
  const row = nbis.comparisons.find((item) => item.id === "operating-income");
  assert.deepEqual(compareMetrics(row.current, row.previous), { ok: false, reason: "non-positive-base" });
  assert.equal((row.current.value - row.previous.value).toFixed(1), "-47.9");
});

test("missing evidence, future actuals, and wrong-company records block a profile", () => {
  assert.ok(companyProfileIssues({ ...nbis, sources: [] }).includes("unsupported-company-evidence"));
  const modified = structuredClone(nbis);
  modified.comparisons[0].current.periodEnd = "2027-01-01";
  assert.ok(companyProfileIssues(modified).includes("actual-before-period-end"));
  assert.ok(companyProfileIssues({ ...nbis, events: [events.find((event) => event.ticker === "MU")] }).includes("wrong-company-event"));
});

test("a guidance history cannot silently rewrite publication order or review cutoff", () => {
  const modified = structuredClone(nbis);
  modified.target.disclosures.reverse();
  assert.ok(companyProfileIssues(modified).includes("unordered-target-history"));
  modified.target.disclosures[0].announcedOn = "2026-09-19";
  assert.ok(companyProfileIssues(modified).includes("target-publication-mismatch"));
  assert.ok(companyProfileIssues({ ...nbis, reviewedOn: "2026-01-01" }).includes("unreviewed-source"));
});
