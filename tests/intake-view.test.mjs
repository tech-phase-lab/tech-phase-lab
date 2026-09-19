import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchState, filterSources, intakeCounts, snapshotIssues } from "../lib/research/intake.ts";
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
