import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOARD_PER_RUN, BOARD_SNAPSHOT_CHARTS, BOARD_SNAPSHOT_QUOTES, boardCreditsPerMinute, boardDue, boardJobKey } from "../lib/research/market-snapshot.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the snapshot holds every マーケット card and each tab's first chart (owner, Nov 25: a tab not opened yet showed nothing for seconds)", () => {
  const data = read("lib/research/market-data.ts");
  const symbols = [...data.match(/export const MARKET_SYMBOLS[^]*?\n};/)[0].matchAll(/(?:^|[\s{,])"?([A-Z]{2,4}(?:\/[A-Z]{3})?)"?: \{ variants/g)].map(m => m[1]);
  assert.deepEqual([...BOARD_SNAPSHOT_QUOTES].sort(), [...symbols].sort());
  const board = read("app/research/price/market-board.tsx");
  const categories = board.match(/const CATEGORIES[^]*?\n\];/)[0];
  const firsts = [...categories.matchAll(/items: \[\s*\{ id: "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(firsts, [...BOARD_SNAPSHOT_CHARTS]);
  assert.match(read("lib/research/market-snapshot.ts"), /BOARD_SNAPSHOT_PERIOD = "15m"/);
  assert.match(read("lib/research/market-board-periods.ts"), /DEFAULT_PERIOD: BoardPeriod = "15m"/);
});

test("the minute job reads never-read entries first, then what is two minutes old (fifteen for U.S. ETFs while stocks do not trade), at most 25", () => {
  const all = BOARD_SNAPSHOT_QUOTES.length + BOARD_SNAPSHOT_CHARTS.length;
  assert.equal(boardDue({}, true).length, Math.min(all, BOARD_PER_RUN));
  const ages = Object.fromEntries([...BOARD_SNAPSHOT_QUOTES.map(id => boardJobKey({ kind: "quote", id })), ...BOARD_SNAPSHOT_CHARTS.map(id => boardJobKey({ kind: "chart", id }))].map(key => [key, 60_000]));
  assert.deepEqual(boardDue(ages, true), [], "read a minute ago: not yet");
  const twoMinutes = Object.fromEntries(Object.keys(ages).map(key => [key, 120_000]));
  assert.equal(boardDue(twoMinutes, true).length, all);
  const closed = boardDue(twoMinutes, false).map(boardJobKey);
  assert.ok(closed.includes("quote:BTC/USD") && closed.includes("chart:USD/JPY"), "currency pairs, crypto and metals trade around the clock");
  assert.ok(!closed.includes("quote:SPY") && !closed.includes("chart:SMH"), "U.S. ETFs wait fifteen minutes while stocks do not trade");
  assert.deepEqual(boardDue({ ...twoMinutes, "quote:SPY": 30 * 60_000 }, false)[0], { kind: "quote", id: "SPY" }, "oldest first");
  const credits = boardCreditsPerMinute();
  assert.equal(credits.trading, 12.5);
  assert.ok(credits.closed < 9 && credits.peak === 25);
});

test("members only read the snapshot; the warm job refreshes it on the warm tier through the allocator, and the comparison yields those credits", () => {
  const route = read("app/api/research/market/snapshot/route.ts");
  assert.match(route, /await loadBoardSnapshot\(\)/);
  assert.doesNotMatch(route, /loadBoard\(|readMany|resolveFresh|getMembership|isPro/);
  const data = read("lib/research/market-data.ts");
  assert.match(data, /sharedReader\.read<Board>\(boardSpec\(false\), job\.id, \(\) => \{ spent\+\+; return resolveFresh\(job\.id, "warm"\); \}\)/);
  assert.match(data, /bars\(job\.id, series\.interval, series\.size, \{ fetch: \(\) => \{ spent\+\+; return true; \}, tier: "warm" \}\)/);
  assert.match(data, /if \(!snapshot\) \{ await refreshBoardSnapshot\(\); snapshot = await currentBoardSnapshot\(\); filled = true; \}/);
  const warm = read("app/api/research/compare/warm/route.ts");
  assert.ok(warm.indexOf("await refreshBoardSnapshot()") < warm.indexOf("await warmMinute(Date.now(), lev.spent + board.spent"));
});

test("the page draws every tab from the snapshot until its own read arrives, and a read series is never replaced by it", () => {
  const board = read("app/research/price/market-board.tsx");
  assert.match(board, /fetch\("\/api\/research\/market\/snapshot", \{ cache: "no-store" \}\)/);
  assert.match(board, /const indexQuotes = withSnapshot\(INDEX_ETFS\.map\(item => item\.id\), board\.items, snapshot\), itemQuotes = withSnapshot\(current\.items\.map\(item => item\.id\), rows\.items, snapshot\);/);
  assert.match(board, /if \(!fresh\(`\$\{id\}:\$\{DEFAULT_PERIOD\}`\)\) put\(`\$\{id\}:\$\{DEFAULT_PERIOD\}`, series\);/);
  assert.match(board, /setSnapshot\(old => old \?\? kept\)/, "the copy this browser received last draws the page until the server answers");
  assert.match(board, /localStorage\.setItem\(SNAPSHOT_STORE, JSON\.stringify\(next\)\)/);
  assert.match(board, /if \(!have && !fresh\(key\)\) put\(key, \{ bars: \[\], before: \[\], failed: true \}\);/);
  // The existing reads are unchanged: same endpoints, same intervals.
  assert.match(board, /const board = useBoard\(INDEX_ETFS\.map\(item => item\.id\), FAST_MS, true\);/);
  assert.match(board, /const rows = useBoard\(current\.items\.map\(item => item\.id\), SLOW_MS, false\);/);
});
