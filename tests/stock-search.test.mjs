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
  // The alias is tied to the SEC issuer ID; a different issuer under that ticker gets no alias (the name "Tesla" itself is still found by sound).
  assert.deepEqual(searchDirectory([{ ...directory[0], cik: 99999999, name: "Unrelated company" }], "テスラ"), []);
});

test("small-cap Japanese names and partial searches include the intended issuer", () => {
  const companies = [
    { ticker: "QUIK", name: "QUICKLOGIC Corp", cik: 882508, tracked: false, exchange: "Nasdaq" },
    { ticker: "CAN", name: "Canaan Inc.", cik: 1780652, tracked: false, exchange: "Nasdaq" },
    { ticker: "SIMO", name: "Silicon Motion Technology CORP", cik: 1329394, tracked: false, exchange: "Nasdaq" },
    { ticker: "AAOI", name: "APPLIED OPTOELECTRONICS, INC.", cik: 1158114, tracked: false, exchange: "Nasdaq" },
    { ticker: "AMAT", name: "APPLIED MATERIALS INC /DE", cik: 6951, tracked: false, exchange: "Nasdaq" },
    { ticker: "POET", name: "POET TECHNOLOGIES INC.", cik: 1437424, tracked: false, exchange: "Nasdaq" },
  ];
  for (const [query, ticker] of [["クイックロジック", "QUIK"], ["カナン", "CAN"], ["シリコン", "SIMO"], ["シリコンモーションテクノロジー", "SIMO"], ["シリコン・モーション", "SIMO"], ["アプライド", "AAOI"], ["ポエット", "POET"]]) {
    assert.ok(searchDirectory(companies, query).some(entry => entry.ticker === ticker), query);
  }
  assert.deepEqual(new Set(searchDirectory(companies, "アプライド").map(entry => entry.ticker)), new Set(["AAOI", "AMAT"]));
  assert.deepEqual(searchDirectory(companies, "アプライドオプト").map(entry => entry.ticker), ["AAOI"]);
});

 test("Arista spelling variants resolve to ANET in both search paths", () => {
 const entries = [{ ticker: "ANET", name: "Arista Networks", cik: 1596532, exchange: "NYSE", tracked: true }];
 for (const query of ["アリスター", "アリスタ", "ｱﾘｽﾀｰ", "ありすたー", "アリスターネットワークス"]) {
   assert.equal(searchStocks(entries, query)[0]?.ticker, "ANET");
   assert.equal(searchDirectory(entries, query)[0]?.ticker, "ANET");
 }
 assert.deepEqual(searchStocks(entries, "アリステラ"), []);
});

// Owner, Nov 15: 「アービュータス」 found nothing. Kana is read as romaji and matched by sound against the English names in the directory.
const soundDirectory = [
  [1447028, "Arbutus Biopharma Corp", "ABUS"], [1045810, "NVIDIA CORP", "NVDA"], [1321655, "Palantir Technologies Inc.", "PLTR"],
  [59478, "ELI LILLY & Co", "LLY"], [1730168, "Broadcom Inc.", "AVGO"], [1818874, "SoFi Technologies, Inc.", "SOFI"],
  [1318605, "Tesla, Inc.", "TSLA"], [829224, "STARBUCKS CORP", "SBUX"], [804328, "QUALCOMM INC/DE", "QCOM"], [104169, "Walmart Inc.", "WMT"],
  // Real names that sound close to the queries below or to everyday words, which must not be returned by mistake.
  [1600641, "SURF AIR MOBILITY INC.", "SRFM"], [18926, "Lumen Technologies, Inc.", "LUMN"], [1581280, "Twist Bioscience Corp", "TWST"],
  [1347426, "Macro Bank Inc.", "BMA"], [1418135, "Apple Hospitality REIT, Inc.", "APLE"], [1690080, "Abeona Therapeutics", "ABEO"],
  [1514281, "Rigetti Computing, Inc.", "RGTI"], [1059556, "Moody's Corp", "MCO"], [1001250, "Estee Lauder Companies Inc", "EL"],
  // Offset CIKs keep the hand-written Japanese aliases out of this test: only the sound match is exercised.
].map(([cik, name, ticker]) => ({ cik: cik + 900000000, name, ticker, exchange: "Nasdaq", tracked: false }));
const soundOnly = soundDirectory.map(entry => ({ ...entry, ticker: `${entry.ticker}.X` }));

test("katakana and hiragana company names find the issuer by sound across the directory", () => {
  for (const [query, ticker] of [["アービュータス", "ABUS"], ["あーびゅーたす", "ABUS"], ["ｱｰﾋﾞｭｰﾀｽ", "ABUS"], ["エヌビディア", "NVDA"], ["パランティア", "PLTR"],
    ["イーライリリー", "LLY"], ["イーライ・リリー", "LLY"], ["ブロードコム", "AVGO"], ["ソーファイ", "SOFI"], ["クアルコム", "QCOM"], ["ウォルマート", "WMT"]]) {
    assert.equal(searchDirectory(soundDirectory, query)[0]?.ticker, ticker, query);
    assert.equal(searchStocks(soundDirectory, query)[0]?.ticker, ticker, query);
    // Without any alias for the ticker, the sound of the name alone still finds it.
    assert.equal(searchDirectory(soundOnly, query)[0]?.ticker, `${ticker}.X`, query);
  }
});

test("sound matching does not flood results with unrelated companies", () => {
  for (const query of ["ありがとう", "こんにちは", "テスト", "さくら", "アイウエオ", "すし", "アビ", "トヨタ", "ソニー"]) {
    assert.deepEqual(searchDirectory(soundDirectory, query).map(entry => entry.ticker), [], query);
  }
  assert.deepEqual(searchDirectory(soundOnly, "アービュータス").map(entry => entry.ticker), ["ABUS.X"]);
  assert.deepEqual(searchDirectory(soundOnly, "パランティア").map(entry => entry.ticker), ["PLTR.X"]);
  assert.deepEqual(searchDirectory(soundOnly, "イーライリリー").map(entry => entry.ticker), ["LLY.X"]);
  // A close-sounding name may follow, but never ahead of the intended company.
  assert.equal(searchDirectory(soundOnly, "ソーファイ")[0].ticker, "SOFI.X");
});

test("spelled matches outrank sound matches: exact ticker, then exact alias, then prefix, then sound", () => {
  const directory = [
    { cik: 2045, name: "Anthropic, PBC", ticker: "ANT", exchange: "IPO", tracked: false },
    { cik: 2046, name: "Antero Midstream Corp", ticker: "AM", exchange: "NYSE", tracked: false },
    { cik: 1045810, name: "NVIDIA CORP", ticker: "NVDA", exchange: "Nasdaq", tracked: true },
    { cik: 2047, name: "Enubidia Example Corp", ticker: "ENBX", exchange: "Nasdaq", tracked: false },
  ];
  assert.equal(searchDirectory(directory, "ANT")[0].ticker, "ANT");
  assert.equal(searchDirectory(directory, "アンソロピック")[0].ticker, "ANT");
  assert.deepEqual(searchDirectory(directory, "エヌビディア").map(entry => entry.ticker), ["NVDA", "ENBX"]);
});

test("kana is read as Hepburn-like romaji and both spellings share one consonant outline", async () => {
  const { kanaToRomaji, looseKana, looseEnglish, skeleton } = await import("../lib/research/kana-fuzzy.ts");
  assert.equal(kanaToRomaji("ティッカー"), "tika");
  assert.equal(kanaToRomaji("ヴィジョン"), "vijon");
  assert.equal(kanaToRomaji("アービュータス"), "abyutasu");
  assert.equal(kanaToRomaji("Tesla"), null);
  assert.equal(kanaToRomaji("テスラ株"), null);
  for (const [kana, english] of [["アービュータス", "arbutus"], ["パランティア", "palantir"], ["ブロードコム", "broadcom"], ["エヌビディア", "nvidia"]]) {
    assert.equal(skeleton(looseKana(kanaToRomaji(kana))), skeleton(looseEnglish(english)), kana);
  }
});

test("sound search over a full-size directory stays fast", () => {
  const big = Array.from({ length: 12000 }, (_, i) => ({ cik: i + 1, name: `Company ${i.toString(36)} Holdings Inc`, ticker: `T${i}`, exchange: "Nasdaq", tracked: false }));
  big.push({ cik: 99999, name: "Arbutus Biopharma Corp", ticker: "ABUS", exchange: "Nasdaq", tracked: false });
  searchDirectory(big, "アービュータス");
  const started = performance.now();
  for (let i = 0; i < 10; i++) assert.equal(searchDirectory(big, "アービュータス")[0].ticker, "ABUS");
  assert.ok((performance.now() - started) / 10 < 150, "one query on a cached index");
});
