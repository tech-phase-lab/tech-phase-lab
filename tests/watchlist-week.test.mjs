import test from "node:test";
import assert from "node:assert/strict";
import { weekSummary, cleanTickers, signedPercent, WEEK_TICKER_LIMIT } from "../lib/research/watchlist-week.ts";

const stock = (ticker, week) => ({ ticker, returns: week === undefined ? {} : { "1w": week } });

test("every priced stock is ranked by its week, news or no news; unpriced ones are counted as missing", () => {
  const summary = weekSummary([stock("A", 3.2), stock("B", -4.5), stock("C", 0), stock("D", 11), stock("X", 50), stock("E")], ["A", "B", "C", "D", "E", "F"]);
  assert.deepEqual(summary.ranked.map(item => item.ticker), ["D", "A", "C", "B"]); // X is not on the list
  assert.deepEqual([summary.up, summary.down, summary.flat, summary.covered, summary.missing], [2, 1, 1, 4, 2]);
});

test("the ticker query is validated, unique, sorted and capped", () => {
  assert.deepEqual(cleanTickers("nvda, AMD,NVDA,<script>,BRK.B,,"), ["AMD", "BRK.B", "NVDA"]);
  assert.deepEqual(cleanTickers(null), []);
  assert.equal(cleanTickers(Array.from({ length: 300 }, (_, i) => `T${String(i).padStart(3, "A")}`).join(",")).length <= WEEK_TICKER_LIMIT, true);
  assert.equal(signedPercent(-1.234), "−1.23%");
  assert.equal(signedPercent(5), "+5.00%");
});

test("FREE gets counts only: the route never sends the ranking unless PRO (source check)", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../app/api/research/notebook-week/route.ts", import.meta.url), "utf8");
  assert.match(route, /\.\.\.\(full \? \{ ranked \} : \{\}\)/);
  assert.match(route, /access === 401/);
});
