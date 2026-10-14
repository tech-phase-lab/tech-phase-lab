import test from "node:test";
import assert from "node:assert/strict";
import { freshByCompany, isFreshItem, FRESH_WINDOW_MS } from "../lib/research/company-freshness.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
const wire = (id, minutes, titleJa = "見出し") => ({ id, titleEn: "Headline", titleJa, publisher: "P", origin: "third-party", url: "https://example.com/a", publishedAt: ago(minutes) });

test("an item is new only if published within the window, found promptly and after the last visit", () => {
  assert.equal(isFreshItem(ago(30), "published", ago(29), 0, NOW), true);
  assert.equal(isFreshItem(ago(FRESH_WINDOW_MS / 60_000 + 5), "published", undefined, 0, NOW), false); // too old
  assert.equal(isFreshItem(ago(40), "published", ago(0), 0, NOW), false);                              // found 40 min late
  assert.equal(isFreshItem(ago(30), "published", undefined, NOW - 10 * 60_000, NOW), false);           // seen since
  assert.equal(isFreshItem("2026-10-14", "date", undefined, 0, NOW), false);                            // date only
});

test("counts new wire headlines per company; Japanese view needs a checked translation", () => {
  const rows = { MU: [wire("a", 20), wire("b", 400), wire("c", 10, null)], NVDA: [wire("d", 50)] };
  const ja = freshByCompany(null, rows, "ja", {}, NOW);
  assert.equal(ja.get("MU"), 1); assert.equal(ja.get("NVDA"), 1);
  const en = freshByCompany(null, rows, "en", {}, NOW);
  assert.equal(en.get("MU"), 2);
});

test("opening a company clears only that company", () => {
  const rows = { MU: [wire("a", 20)], NVDA: [wire("d", 50)] };
  const counts = freshByCompany(null, rows, "ja", { MU: NOW - 5 * 60_000 }, NOW);
  assert.equal(counts.has("MU"), false); assert.equal(counts.get("NVDA"), 1);
});
