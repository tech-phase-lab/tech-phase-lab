import { test } from "node:test";
import assert from "node:assert/strict";
import { searchStocks } from "../lib/research/stock-search.ts";
import { searchDirectory } from "../lib/research/stock-directory.ts";

const entries = [
  { ticker: "MU", name: "MICRON TECHNOLOGY INC", tracked: true },
  { ticker: "SNDK", name: "SANDISK CORP", tracked: true },
  { ticker: "MSFT", name: "MICROSOFT CORP", tracked: true },
  { ticker: "NVDA", name: "NVIDIA CORP", tracked: true },
  { ticker: "MUL", name: "Example", tracked: false },
];

test("local suggestions and SEC directory agree on Japanese issuer names", () => {
  const directory = entries.map((entry, index) => ({ ...entry, cik: index + 1, exchange: "Nasdaq" }));
  for (const [query, ticker] of [["マイクロン", "MU"], ["サンディスク", "SNDK"], ["ｻﾝﾃﾞｨｽｸ", "SNDK"], ["まいくろん", "MU"], ["マイクロンテクノロジー", "MU"], ["エヌビディア", "NVDA"], ["マイクロソフト", "MSFT"], [" ＭＵ ", "MU"], ["Micron Technology", "MU"]]) {
    assert.equal(searchStocks(entries, query)[0]?.ticker, ticker, query);
    assert.equal(searchDirectory(directory, query)[0]?.ticker, ticker, query);
  }
});

test("partial Japanese names work without turning unknown names into unrelated matches", () => {
  assert.deepEqual(searchStocks(entries, "サンディ").map(entry => entry.ticker), ["SNDK"]);
  assert.deepEqual(searchStocks(entries, "未登録 MU"), []);
  assert.deepEqual(searchStocks(entries, "知らない企業"), []);
  assert.deepEqual(searchStocks(entries, ""), []);
  assert.equal(searchStocks(entries, "MU")[0].ticker, "MU");
  assert.equal(searchStocks(entries, "マイクロ", 1).length, 1);
});

test("Japanese issuer directory extends beyond monitored companies using SEC identity", () => {
  const directory = [
    { ticker: "TSLA", name: "Tesla, Inc.", cik: 1318605, tracked: false, exchange: "Nasdaq" },
    { ticker: "SBUX", name: "STARBUCKS CORP", cik: 829224, tracked: false, exchange: "Nasdaq" },
    { ticker: "OTHER", name: "Unrelated company", cik: 99999999, tracked: false, exchange: "Nasdaq" },
  ];
  assert.equal(searchDirectory(directory, "テスラ")[0]?.ticker, "TSLA");
  assert.equal(searchDirectory(directory, "スターバックス")[0]?.ticker, "SBUX");
  assert.equal(searchDirectory(directory, "ｽﾀｰﾊﾞｯｸｽ")[0]?.ticker, "SBUX");
  assert.deepEqual(searchDirectory(directory.filter(entry => entry.ticker !== "TSLA"), "テスラ"), []);
  assert.deepEqual(searchDirectory([{ ...directory[0], cik: 99999999 }], "テスラ"), []);
});
