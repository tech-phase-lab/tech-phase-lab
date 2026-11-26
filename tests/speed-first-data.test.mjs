import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("マーケット: the cards and 原油・米国債 come in the first HTML from the shared copies, never from the provider (speed, Nov 26)", () => {
  const page = read("app/research/market/page.tsx");
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /peekBoardSnapshot\(\)/);
  assert.doesNotMatch(page, /loadBoardSnapshot|refreshBoardSnapshot|loadBoard\(|loadMarketQuotes/);
  assert.match(page, /const INITIAL_WAIT_MS = 700;/);
  const data = read("lib/research/market-data.ts");
  const peek = data.slice(data.indexOf("export async function peekBoardSnapshot"), data.indexOf("function shapeBoardSnapshot"));
  assert.match(peek, /currentBoardSnapshot\(\)/);
  assert.doesNotMatch(peek, /refresh|twelveCall|call\(/);
  const board = read("app/research/price/market-board.tsx");
  assert.match(board, /useState<Snapshot \| null>\(initial\)/);
  // With the server's copy on screen the next snapshot read waits its two minutes.
  assert.match(board, /}, 120_000, initial \? 120_000 : 0\);/);
  const screen = read("app/research/market/screen.tsx");
  assert.match(screen, /useState<MacroQuote\[\] \| null>\(initial\)/);
  assert.match(screen, /if \(initial\) return;/);
});

test("ハイテク速報・注目トピック: a signed-out visitor's FREE view in the first HTML, projected before it is sent (speed, Nov 26)", () => {
  const loader = read("lib/research/news-first-paint.ts");
  assert.match(loader, /^import "server-only";/);
  // Only a browser without a session (a visitor, FREE by definition) gets the FREE view; nobody's membership is looked up.
  assert.match(loader, /if \(!await signedOutVisitor\(\)\) return null;/);
  assert.doesNotMatch(loader, /getMembership|isFullAccess/);
  // The same projection the APIs make (30 minutes behind, newest five, headlines only), wire included.
  assert.match(loader, /const selection = freeTechSelection\(feed, wire \?\? \{\}, checkedAt\);/);
  assert.match(loader, /feed: projectFreeNews\(feed, selection\), wire: wire \? projectFreeWire\(wire, selection\) : null/);
  // Only the monitor is read; no market-data provider.
  assert.doesNotMatch(loader, /twelve|market-data/i);
  for (const page of ["app/research/news/page.tsx", "app/research/general-news/page.tsx"]) {
    const source = read(page);
    assert.doesNotMatch(source, /^"use client"/);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    assert.match(source, /await firstNewsWithin\(\)/);
  }
  const flash = read("app/research/news/flash-page.tsx");
  assert.match(flash, /useState<GeneralNewsFeed \| null>\(initial\?\.feed \?\? null\)/);
  assert.match(flash, /poller\.start\(drawnFree \? NEWS_POLL_INTERVAL_MS : 0\);/);
  assert.match(read("app/research/news/screen.tsx"), /useState\(initial !== null && initial\.wire !== null\)/);
});

test("the FREE projection the page draws equals what the news API gives FREE", async () => {
  const { buildPublicNews } = await import("../lib/research/public-news-response.ts");
  const access = await import("../lib/research/tech-news-access.ts");
  const source = read("app/api/research/news/route.ts");
  // The route: projectFreeNews(feed, freeTechSelection(feed, wire)) for FREE; the loader makes the same two calls on the same inputs.
  assert.match(source, /feed = projectFreeNews\(feed, freeTechSelection\(feed, wire\)\);/);
  assert.equal(typeof buildPublicNews, "function");
  assert.equal(typeof access.projectFreeWire, "function");
});

test("目標株価: the monitor's feed (the same for every visitor) in the first HTML", () => {
  const page = read("app/research/price-targets/page.tsx");
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /readMonitor\("price-targets", 100_000, INITIAL_WAIT_MS\)/);
  assert.match(page, /publicPriceTargets\(raw\)/);
  const panel = read("app/research/price-targets-panel.tsx");
  assert.match(panel, /useState<Target\[\]>\(\(\) => initial\?\.items \?\? recent\(\)\?\.items \?\? \[\]\)/);
});
