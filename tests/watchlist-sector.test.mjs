import test from "node:test";
import assert from "node:assert/strict";
import { watchlistSector } from "../lib/research/watchlist-sector.ts";

test("saved ALAB has a bilingual networking label without a search response", () => {
  assert.deepEqual(watchlistSector("ALAB"), { ja: "ネットワーク", en: "Networking" });
});
test("registered labels remain intact and unknown tickers have no invented classification", () => {
  const networking = { ja: "ネットワーク", en: "Networking" };
  assert.equal(watchlistSector("ANET", networking), networking);
  for (const ticker of ["AAPL", "LITE", "NASDAQ", "NYSE", "toString"]) {
    assert.equal(watchlistSector(ticker), undefined);
  }
});

test("networking theme is consistent for ALAB and the existing MRVL/CRDO sample labels", async () => {
  const { readFile } = await import("node:fs/promises");
  const providers = JSON.parse(await readFile(new URL("../lib/research/providers.json", import.meta.url), "utf8"));
  const sample = await readFile(new URL("../app/research/watchlist/sample/sample.tsx", import.meta.url), "utf8");
  for (const ticker of ["MRVL", "CRDO", "ANET"]) {
    assert.equal(providers.find(item => item.ticker === ticker).sector, "networking");
    const row = sample.split("\n").find(line => line.includes('ticker: "' + ticker + '"'));
    assert.ok(row.includes('sector: { ja: "ネットワーク", en: "Networking" }'));
  }
  assert.deepEqual(watchlistSector("ALAB"), { ja: "ネットワーク", en: "Networking" });
});
