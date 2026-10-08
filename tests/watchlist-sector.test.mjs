import test from "node:test";
import assert from "node:assert/strict";
import { watchlistSector } from "../lib/research/watchlist-sector.ts";

test("saved ALAB has a bilingual semiconductor label without a search response", () => {
  assert.deepEqual(watchlistSector("ALAB"), { ja: "半導体", en: "Semiconductors" });
});
test("registered labels remain intact and unknown tickers have no invented classification", () => {
  const networking = { ja: "ネットワーク", en: "Networking" };
  assert.equal(watchlistSector("ANET", networking), networking);
  for (const ticker of ["AAPL", "LITE", "NASDAQ", "NYSE", "toString"]) {
    assert.equal(watchlistSector(ticker), undefined);
  }
});
