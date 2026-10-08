import test from "node:test";
import assert from "node:assert/strict";
import { watchlistSector, sectorFromProfile } from "../lib/research/watchlist-sector.ts";

test("saved ALAB has a bilingual networking label without a search response", () => {
  assert.deepEqual(watchlistSector("ALAB"), { ja: "ネットワーク", en: "Networking" });
});
test("registered labels remain intact and unknown tickers have no invented classification", () => {
  const networking = { ja: "ネットワーク", en: "Networking" };
  assert.equal(watchlistSector("ANET", networking), networking);
  for (const ticker of ["GS", "IBM", "NASDAQ", "NYSE", "toString"]) {
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

test("reviewed investment themes override coarse registry sectors after reload", () => {
  const broad = { ja: "半導体", en: "Semiconductors" };
  assert.equal(watchlistSector("APH")?.ja, "ネットワーク");
  assert.deepEqual(watchlistSector("AEHR"), { ja: "半導体検査装置", en: "Semiconductor test equipment" });
  for (const ticker of ["MSTR", "CAN", "COIN", "HUT", "CRCL", "BTBT", "BTGO", "HOOD", "RIOT", "CLSK", "MARA", "HIVE", "BTDR", "GLXY", "GEMI", "BLSH", "CNCK", "BMNR"]) assert.deepEqual(watchlistSector(ticker, broad), { ja: "クリプト関連", en: "Crypto-related" });
  for (const ticker of ["AAOI", "LITE", "COHR", "POET"]) assert.equal(watchlistSector(ticker)?.ja, "光・フォトニクス");
  for (const ticker of ["MU", "SKHY", "SNDK"]) assert.equal(watchlistSector(ticker, broad)?.ja, "メモリ");
  for (const ticker of ["ASML", "AMAT"]) assert.equal(watchlistSector(ticker, broad)?.ja, "半導体製造装置");
  assert.equal(watchlistSector("TSM", broad)?.ja, "半導体受託製造");
});

const profile = (ticker, sic, sicDescription = "Reported industry") => ({ ok: true, profile: { ticker, sic, sicDescription } });
test("SEC fallback uses the matching issuer and retains the reported source", () => {
  assert.deepEqual(sectorFromProfile("BANK", profile("BANK", "6021")), {
    ja: "銀行", en: "Banking", sic: "6021", description: "Reported industry",
  });
  assert.equal(sectorFromProfile("TECH", profile("TECH", "7372"))?.ja, "ソフトウェア");
  assert.equal(sectorFromProfile("POWER", profile("POWER", "4911"))?.ja, "電力");
  assert.equal(sectorFromProfile("REIT", profile("REIT", "6798"))?.en, "REIT");
  assert.equal(sectorFromProfile("FOOD", profile("FOOD", "2030"))?.ja, "食品");
  assert.equal(sectorFromProfile("FARM", profile("FARM", "100"))?.sic, "0100");
});
test("missing, unclassified, malformed and wrong-issuer SIC responses stay unclassified", () => {
  for (const sic of [null, undefined, "", 3674, "Nasdaq", "0000", "9995", "9999", "abc", "3674oops", "12345"]) {
    assert.equal(sectorFromProfile("TEST", profile("TEST", sic)), undefined);
  }
  assert.equal(sectorFromProfile("TEST", profile("OTHER", "3674")), undefined);
  assert.equal(sectorFromProfile("TEST", { ...profile("TEST", "3674"), ok: false }), undefined);
  assert.equal(sectorFromProfile("TEST", null), undefined);
  assert.equal(sectorFromProfile("TEST", { ok: true }), undefined);
});
