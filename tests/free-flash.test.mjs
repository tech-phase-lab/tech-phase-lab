import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freeFlashRows, FREE_FLASH_DELAY_MS, FREE_FLASH_LIMIT } from "../lib/research/free-flash.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const row = (id, minutesAgo, extra = {}) => ({ id, kind: "news", tickers: ["MU"], title: `headline ${id}`, body: `summary ${id}`, url: `https://example.com/${id}`, at: new Date(NOW - minutesAgo * 60_000).toISOString(), timeKind: "published", ...extra });

test("FREE sees headlines at least 30 minutes old, newest first, at most five, with no summary or link", () => {
  assert.equal(FREE_FLASH_DELAY_MS, 30 * 60_000);
  assert.equal(FREE_FLASH_LIMIT, 5);
  const rows = [row("a", 5), row("b", 29), row("c", 30), row("d", 45), row("e", 90), row("f", 120), row("g", 150), row("h", 600), row("i", 900)];
  const shown = freeFlashRows(rows, NOW);
  assert.deepEqual(shown.map(item => item.id), ["c", "d", "e", "f", "g"]); // a and b are still inside the delay
  assert.ok(shown.every(item => !("body" in item) && !("url" in item) && item.title));
});

test("rows without a stated time of day sit at the start of their day and obey the same delay", () => {
  const dated = row("x", 0, { at: "2026-10-25", timeKind: "date" });
  assert.deepEqual(freeFlashRows([dated], NOW).map(item => item.id), ["x"]); // 00:00 UTC is 12 h old
  assert.deepEqual(freeFlashRows([dated], Date.parse("2026-10-25T00:10:00Z")), []);
});

test("the limit applies to the 速報 page only: the home news and the news API are untouched", () => {
  const page = readFileSync(new URL("../app/research/news/flash-page.tsx", import.meta.url), "utf8");
  assert.match(page, /const rows = full \? allRows : freeFlashRows\(allRows/);
  assert.match(page, /body=\{full \? row\.body : undefined\}/);
  for (const file of ["../app/api/research/news/route.ts", "../app/research/research-pulse.tsx", "../app/research/news/general-news-panel.tsx", "../lib/research/news-pulse-items.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /free-flash|freeFlashRows/, file);
  }
});

test("the company page's monitor is the same FREE window, retitled so the name stays honest", async () => {
  const { freeWindow } = await import("../lib/research/free-flash.ts");
  const items = [{ id: "a", t: NOW - 10 * 60_000 }, { id: "b", t: NOW - 40 * 60_000 }, { id: "c", t: NOW - 50 * 60_000 }];
  assert.deepEqual(freeWindow(items, item => item.t, NOW).map(item => item.id), ["b", "c"]);
  const source = readFileSync(new URL("../app/research/companies/company-activity.tsx", import.meta.url), "utf8");
  assert.match(source, /const rows = full \? allRows : freeWindow\(allRows, rowInstant, clockNow\)/);
  assert.match(source, /full \? \(ja \? 'リアルタイム監視' : 'Live monitor'\) : \(ja \? 'ニュース監視' : 'News monitor'\)/); // only PRO/owner read "real-time"
  assert.match(source, /\{full \? <a href=\{row\.wire\.url\}/); // no outbound link for FREE
});
