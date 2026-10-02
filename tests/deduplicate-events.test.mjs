import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateResearchEvents, normalizedEarningsPeriod } from "../lib/research/deduplicate-events.ts";

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
