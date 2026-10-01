import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateResearchEvents } from "../lib/research/deduplicate-events.ts";

const copy = { ja: "要約", en: "Summary" };
function event(id, kind = "earnings", publishedOn = "2026-09-30") {
  return {
    id,
    ticker: "MU",
    company: "Micron",
    category: "memory",
    kind,
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

test("issuer-backed earnings replace same-day secondary and fallback copies", () => {
  const issuer = event("ir-result-1126");
  const flash = event("x-result-1126");
  const fallback = event("mu-q4-2026");
  assert.deepEqual(deduplicateResearchEvents([issuer, flash, fallback]).map((item) => item.id), [issuer.id]);
});

test("different earnings dates and same-day non-earnings updates remain visible", () => {
  const items = [event("ir-result-1126"), event("mu-q3-2026", "earnings", "2026-06-24"), event("mu-product-a", "product"), event("mu-product-b", "product")];
  assert.deepEqual(deduplicateResearchEvents(items).map((item) => item.id), items.map((item) => item.id));
});
