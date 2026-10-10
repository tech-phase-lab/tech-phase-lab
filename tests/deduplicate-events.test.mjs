import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateResearchEvents, normalizedEarningsPeriod } from "../lib/research/deduplicate-events.ts";
import { officialResultEvents } from "../lib/research/official-result-events.ts";
import { muLatest } from "../lib/research/mu-latest.ts";
import { events } from "../lib/research/content.ts";
import { evidenceIssues } from "../lib/research/quality.ts";
import recovery from "../scripts/research/mu_fq4_recovery.json" with { type: "json" };

const copy = { ja: "要約", en: "Summary" };
function event(id, kind = "earnings", publishedOn = "2026-09-30") {
  return {
    id,
    ticker: "MU",
    company: "Micron",
    category: "memory",
    kind,
    earningsPeriod: "Q4 2026",
    publishedOn,
    reviewedOn: "2026-10-01",
    title: copy,
    summary: copy,
    change: copy,
    interpretation: copy,
    facts: [{ text: copy, sourceIds: [id] }],
    unknown: copy,
    next: copy,
    sources: [{ id, url: `https://investors.micron.com/${id}`, title: id, publisher: "Micron", publishedOn }],
    metrics: [],
  };
}

test("issuer-backed earnings retain same-release secondary and fallback evidence", () => {
  const issuer = event("ir-result-1126");
  const flash = event("x-result-1126");
  const fallback = event("mu-q4-2026");
  const original = structuredClone([issuer, flash, fallback]);
  const [merged] = deduplicateResearchEvents([issuer, flash, fallback]);
  assert.equal(merged.id, issuer.id);
  assert.deepEqual(merged.sources.map(source => source.id), original.map(item => item.id));
  assert.deepEqual(merged.facts[0].sourceIds, original.map(item => item.id));
  assert.deepEqual([issuer, flash, fallback], original);
  assert.deepEqual(deduplicateResearchEvents([merged, flash, fallback]), [merged]);
});

test("different earnings dates and same-day non-earnings updates remain visible", () => {
  const items = [event("ir-result-1126"), event("mu-q3-2026", "earnings", "2026-06-24"), event("mu-product-a", "product"), event("mu-product-b", "product")];
  assert.deepEqual(deduplicateResearchEvents(items).map((item) => item.id), items.map((item) => item.id));
});


test("distinct fiscal periods and unknown-period earnings are never merged by ticker/day", () => {
  const q3 = { ...event("q3"), earningsPeriod: "Q3 2026" };
  const q4 = event("q4");
  const unknown = { ...event("unknown"), earningsPeriod: undefined };
  assert.deepEqual(deduplicateResearchEvents([q3, q4, unknown]).map(item => item.id), ["q3", "q4", "unknown"]);
});

test("a genuine corrected release stays distinct even for the same quarter/day", () => {
  const release = event("first");
  const corrected = { ...event("correction"), title: { ja: "決算訂正", en: "Corrected earnings release" } };
  assert.equal(deduplicateResearchEvents([release, corrected]).length, 2);
});

test("conflicting values survive as separately attributed facts, never averaged metrics", () => {
  const first = event("a"), other = event("b");
  first.facts[0].text = { ja: "売上高：$54.23B", en: "Revenue: $54.23B" };
  other.facts[0].text = { ja: "売上高：$54.24B", en: "Revenue: $54.24B" };
  const [merged] = deduplicateResearchEvents([first, other]);
  assert.deepEqual(merged.facts.map(fact => fact.sourceIds), [["a"], ["b"]]);
  assert.deepEqual(merged.facts.map(fact => fact.text.en), ["Revenue: $54.23B", "Revenue: $54.24B"]);
  assert.deepEqual(merged.metrics, []);
});

test("a shared URL remaps evidence IDs, while colliding IDs for different URLs stay valid", () => {
  const first = event("a"), sameUrl = event("b"), collision = event("a");
  sameUrl.sources[0].url = first.sources[0].url;
  collision.sources[0].url += "-different";
  const [merged] = deduplicateResearchEvents([first, sameUrl, collision]);
  assert.equal(merged.sources.length, 2);
  assert.equal(new Set(merged.sources.map(source => source.id)).size, 2);
  assert.deepEqual(merged.facts[0].sourceIds, ["a", "a-2"]);
});

test("source/actual-metric fiscal periods match explicit normalized metadata", () => {
  for (const period of ["FQ4 2026", "Q4 FY2026", "2026 Q4", "Fiscal Q4 2026"]) {
    assert.equal(normalizedEarningsPeriod(period), "Q4 2026");
  }
  const issuer = { ...event("issuer"), earningsPeriod: undefined };
  issuer.sources[0].title = "Micron FQ4 2026 earnings release";
  assert.equal(deduplicateResearchEvents([issuer, event("flash")]).length, 1);
});


test("reviewed MU issuer title and SEC recovery yield one Q4 event, keeping Q3 separate", () => {
  // Reuse reviewed release evidence; this replay does not claim live delivery.
  const [issuer] = officialResultEvents([{
    id: "ir-result-1126", ticker: "MU", kind: "earnings", title: muLatest.title,
    summary: muLatest.summary, facts: muLatest.facts.map(fact => fact.text), purpose: copy,
    url: recovery.releaseUrl, sourceTitle: recovery.title, publishedOn: recovery.publishedOn,
    dateBasis: "publication", publicAt: `${recovery.reviewedOn}T00:00:00Z`,
  }]);
  const q3 = events.find(item => item.id === "mu-q3-2026");
  assert.ok(q3);
  assert.equal(normalizedEarningsPeriod(recovery.title), "Q4 2026");
  const merged = deduplicateResearchEvents([issuer, muLatest, q3]);
  assert.deepEqual(merged.map(item => item.id), [issuer.id, q3.id]);
  assert.deepEqual(new Set(merged[0].sources.map(source => source.url)), new Set([recovery.releaseUrl, recovery.evidenceUrl]));
  assert.deepEqual(evidenceIssues(merged[0]), []);
  assert.ok(merged[0].facts.every(fact => fact.sourceIds.includes(issuer.id) && fact.sourceIds.includes("mu-q4-sec")));
});

test("spelled quarters require an explicit nearby four-digit fiscal year", () => {
  const ordinals = ["First", "Second", "Third", "Fourth"];
  for (const [index, ordinal] of ordinals.entries()) {
    for (const title of [
      `Company Reports Fiscal ${ordinal} Quarter 2026 Results`,
      `Company Reports ${ordinal} Quarter of Fiscal Year 2026 Results`,
      `Company Reports ${ordinal} Quarter Fiscal 2026 Results`,
      `Company Reports ${ordinal}-Quarter FY2026 Results`,
      `Company Reports Fiscal 2026 ${ordinal} Quarter Results`,
      `Company Reports 2026 Fiscal ${ordinal} Quarter Results`,
    ]) assert.equal(normalizedEarningsPeriod(title), `Q${index + 1} 2026`, title);
  }
  for (const title of [
    "Company Reports Fiscal Fourth Quarter and Full Year 2026 Results",
    "Company Reports Fourth Quarter & Full Fiscal Year 2026 Results",
  ]) assert.equal(normalizedEarningsPeriod(title), "Q4 2026", title);
  for (const title of [
    "Company Reports Fiscal Fourth Quarter Results",
    "Company Reports Fourth Quarter Results on September 30, 2026",
    "Company Reports Fiscal Fourth Quarter 26 Results",
    "Company Reports Third Quarter 2026 and Fourth Quarter 2026 Results",
    "Company Reports Fourth Quarter 2025 and Q4 2026 Results",
    "Company Reports Fiscal 2025 Fourth Quarter 2026 Results",
  ]) assert.equal(normalizedEarningsPeriod(title), null, title);
});
