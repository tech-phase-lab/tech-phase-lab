import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeTicker, parseSecDirectory, parseSecProfile, searchDirectory, stockDirectoryIssues } from "../lib/research/stock-directory.ts";

function payload() {
  const data = Array.from({ length: 120 }, (_, index) => [1000000 + index, `Example Company ${index}`, `X${index}`, index % 2 ? "Nasdaq" : "NYSE"]);
  data.push([1045810, "NVIDIA CORP", "NVDA", "Nasdaq"], [723125, "MICRON TECHNOLOGY INC", "MU", "Nasdaq"], [1321655, "Palantir Technologies Inc.", "PLTR", "Nasdaq"]);
  return { fields: ["cik", "name", "ticker", "exchange"], data };
}

test("SEC directory parsing validates fields, normalizes records, and marks monitored companies", () => {
  const entries = parseSecDirectory(payload());
  assert.deepEqual(stockDirectoryIssues(entries), []);
  assert.equal(entries.find((entry) => entry.ticker === "NVDA")?.tracked, true);
  assert.equal(entries.find((entry) => entry.ticker === "X1")?.tracked, false);
  assert.throws(() => parseSecDirectory({ fields: ["cik"], data: [] }), /invalid-sec-directory-fields/);
});

test("directory search ranks exact ticker before company-name matches", () => {
  const entries = parseSecDirectory(payload());
  assert.equal(searchDirectory(entries, "MU")[0].ticker, "MU");
  assert.equal(searchDirectory(entries, "micron")[0].ticker, "MU");
  assert.equal(searchDirectory(entries, "Palantir Technologies")[0].ticker, "PLTR");
  assert.equal(searchDirectory(entries, "").length, 0);
});

test("profile parsing keeps only bounded SEC identity fields and official links", () => {
  const entry = parseSecDirectory(payload()).find((item) => item.ticker === "NVDA");
  const profile = parseSecProfile(entry, { cik: 1045810, entityType: "operating", sic: "3674", sicDescription: "Semiconductors & Related Devices", fiscalYearEnd: "0125", stateOfIncorporation: "DE", formerNames: [{ name: "Old Name", from: "1990", to: "1999" }] });
  assert.equal(profile.sicDescription, "Semiconductors & Related Devices");
  assert.equal(profile.secProfileUrl, "https://www.sec.gov/edgar/browse/?CIK=1045810");
  assert.throws(() => parseSecProfile(entry, { cik: 1 }), /sec-profile-cik-mismatch/);
  assert.equal(normalizeTicker(" brk-b "), "BRK-B");
  assert.equal(normalizeTicker("../../bad"), null);
});

test("stock search UI separates free identity data from licensed prices and news", async () => {
  const [page, route, dashboard] = await Promise.all([
    readFile(new URL("../app/research/stocks/stock-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/research/stocks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /SEC公式データ使用/);
  assert.match(page, /株価は未接続/);
  assert.match(page, /ニュース権利と分離/);
  assert.match(page, /SECは名簿の正確性・網羅性を保証していません/);
  assert.match(route, /company_tickers_exchange\.json/);
  assert.match(route, /secJson\(directoryUrl, 86_400\)/);
  assert.match(route, /AbortSignal\.timeout\(8_000\)/);
  assert.match(dashboard, /\/research\/stocks/);
});
