import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// market-data.ts imports server-only modules; the rule is read from its source and run on its own (owner, Nov 14: every non-stock 5/15-minute chart was empty).
const source = readFileSync(new URL("../lib/research/market-data.ts", import.meta.url), "utf8");
const body = /export function intradayParams\(symbol: string, interval: string\): \{ prepost\?: "true" \} \{\n([\s\S]*?)\n\}/.exec(source)[1];
const intradayParams = new Function("symbol", "interval", body);

test("pre/post bars are asked only for stocks and ETFs; currencies, crypto and metals are asked without them", () => {
  assert.deepEqual(intradayParams("SPY", "15min"), { prepost: "true" });
  assert.deepEqual(intradayParams("NVDA", "5min"), { prepost: "true" });
  for (const id of ["USD/JPY", "EUR/USD", "BTC/USD", "XAU/USD", "XCU/USD"]) assert.deepEqual(intradayParams(id, "15min"), {}, id);
  assert.deepEqual(intradayParams("SPY", "1day"), {});
  assert.equal((source.match(/prepost: "true" \} : \{\}\)/g) || []).length, 0, "no time_series call adds prepost on its own");
});
