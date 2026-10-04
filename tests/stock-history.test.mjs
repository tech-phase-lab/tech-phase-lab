import test from "node:test";
import assert from "node:assert/strict";
import { parseStockHistory, rememberStock, stockHistoryKey } from "../lib/research/stock-history.ts";

test("history rejects corrupt or invalid browser data", () => {
  for (const raw of [null, "{", "null", "{}", '"MU"', " ".repeat(10001)]) assert.deepEqual(parseStockHistory(raw), []);
  assert.deepEqual(parseStockHistory('["NVDA","NVDA","MU",null,3,"<script>","BRK.B"]'), ["NVDA", "MU", "BRK.B"]);
  assert.notEqual(stockHistoryKey, "tech-phase:favorite-stocks:v1");
});

test("revisits move to the front without duplicates and retain only eight tickers", () => {
  const initial = ["NVDA", "MU", "NBIS", "VRT", "BE", "TSM", "ARM", "DELL"];
  assert.deepEqual(rememberStock(initial, "MU"), ["MU", "NVDA", "NBIS", "VRT", "BE", "TSM", "ARM", "DELL"]);
  const next = rememberStock(initial, "CRWV");
  assert.deepEqual(next, ["CRWV", "NVDA", "MU", "NBIS", "VRT", "BE", "TSM", "ARM"]);
  assert.deepEqual(parseStockHistory(JSON.stringify(next)), next);
  assert.equal(initial[0], "NVDA");
  assert.deepEqual(rememberStock(initial, "../bad"), initial);
});
