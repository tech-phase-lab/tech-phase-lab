import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCoverageCompanies, coverageCompanyIssues, fetchState, filterSources, intakeCounts, snapshotIssues, coverageCounts, providers, providerByTicker } from "../lib/research/intake.ts";
const snapshot = JSON.parse(readFileSync(new URL("../lib/research/intake-snapshot.json", import.meta.url)));
const source = snapshot.sources.find(s => s.sha256);

test("snapshot has valid source references and no private review details", () => {
  assert.deepEqual(snapshotIssues(snapshot), []);
  for (const h of snapshot.history) {
    assert.equal("reviewer" in h, false);
    assert.equal("reason" in h, false);
  }
});

test("latest failure wins over a previously successful fetch or editorial approval", () => {
  const errored = { ...source, error: "http-403", status: "approved" };
  assert.equal(fetchState(errored), "error");
  assert.equal(fetchState({ ...source, status: "pending" }), "fetched");
  assert.equal(fetchState({ ...source, sha256: null, checked_at: null }), "unfetched");
  assert.deepEqual(intakeCounts([errored]), { total: 1, error: 1, fetched: 0, unfetched: 0, pending: 0 });
});

test("combined filters search displayed titles without changing source records", () => {
  const titles = { [source.url]: "Quarterly results" };
  assert.equal(filterSources([source], " RESULTS ", source.ticker, "fetched", "pending", titles).length, 1);
  assert.equal(filterSources([source], "results", "all", "error", "all", titles).length, 0);
  assert.equal(filterSources([source], "", "all", "all", "held").length, 0);
});

test("unsafe links, duplicate records and broken history references fail validation", () => {
  assert.ok(snapshotIssues({ ...snapshot, sources: [...snapshot.sources, source] }).includes("duplicate-source"));
  assert.ok(snapshotIssues({ ...snapshot, sources: [{ ...source, url: "javascript:alert(1)" }] }).includes("unsafe-url"));
  assert.ok(snapshotIssues({ ...snapshot, history: [{ url: "missing", at: "2026-09-19" }] }).includes("invalid-history"));
});

test("sector and company filters use the shared registry", () => {
  assert.equal(providers.length, 22);
  const sector = providerByTicker[source.ticker].sector;
  assert.equal(filterSources([source], providerByTicker[source.ticker].name, "all", "all", "all", {}, sector).length, 1);
  assert.equal(filterSources([source], "", "all", "all", "all", {}, "not-a-sector").length, 0);
});

test("coverage uses the latest run and never counts untested companies as failures", () => {
  const counts = coverageCounts({ ...snapshot, discoveryRuns: [
    { id: 1, ticker: "NVDA", status: "ok" },
    { id: 3, ticker: "NVDA", status: "degraded" },
    { id: 2, ticker: "AMD", status: "ok" },
    { id: 4, ticker: "TSM", status: "fallback" },
  ] });
  assert.deepEqual(counts, { registered: 22, discovered: 2, needsCheck: 1, untested: 19 });
});

test("every registered company has a valid company coverage page model", () => {
  const companies = buildCoverageCompanies(snapshot);
  assert.equal(companies.length, 22);
  assert.deepEqual(coverageCompanyIssues(companies), []);
  assert.equal(companies.find((company) => company.ticker === "NVDA").counts.total, 20);
  assert.equal(companies.find((company) => company.ticker === "CRWV").counts.fetched, 1);
  assert.ok(["fallback", "degraded"].includes(companies.find((company) => company.ticker === "ORCL").discovery.status));
});
