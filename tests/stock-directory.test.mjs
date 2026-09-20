import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractBusinessSection, normalizeTicker, parseLatestAnnualFiling, parseRecentFilings, parseSecDirectory, parseSecProfile, searchDirectory, stockDirectoryIssues } from "../lib/research/stock-directory.ts";

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
  assert.deepEqual(profile.recentFilings, []);
  assert.equal(profile.latestAnnualFiling, null);
  assert.throws(() => parseSecProfile(entry, { cik: 1 }), /sec-profile-cik-mismatch/);
  assert.equal(normalizeTicker(" brk-b "), "BRK-B");
  assert.equal(normalizeTicker("../../bad"), null);
});

test("recent SEC filings include material forms and construct only bounded archive links", () => {
  const filings = parseRecentFilings(1045810, { recent: {
    accessionNumber: ["0001045810-26-000123", "0001045810-26-000122", "../../bad", "0001045810-26-000121"],
    form: ["8-K", "4", "10-Q", "10-Q"],
    filingDate: ["2026-09-18", "2026-09-17", "2026-09-16", "2026-08-20"],
    reportDate: ["2026-09-18", "", "2026-07-30", "2026-07-30"],
    acceptanceDateTime: ["2026-09-18T12:34:56.000Z", "", "", "2026-08-20T08:10:00"],
    items: ["2.02,9.01", "", "", ""],
    primaryDocDescription: ["Current report", "Ownership", "Quarterly report", "Quarterly report"],
    primaryDocument: ["nvda-20260918.htm", "xslF345X05/form4.xml", "../escape.htm", "nvda-20260730.htm"],
  } });
  assert.equal(filings.length, 2);
  assert.equal(filings[0].form, "8-K");
  assert.equal(filings[0].items, "2.02,9.01");
  assert.equal(filings[0].documentUrl, "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000123/nvda-20260918.htm");
  assert.equal(filings[1].form, "10-Q");
  assert.match(filings[1].filingIndexUrl, /0001045810-26-000121-index\.html$/);
});

test("latest annual filing selects an original 10-K or 20-F and skips amendments", () => {
  const filing = parseLatestAnnualFiling(1045810, { recent: {
    accessionNumber: ["0001045810-26-000125", "0001045810-26-000124", "0001045810-26-000123"],
    form: ["10-K/A", "8-K", "10-K"],
    filingDate: ["2026-03-03", "2026-03-02", "2026-02-28"],
    reportDate: ["2026-01-25", "2026-03-02", "2026-01-25"],
    acceptanceDateTime: ["", "", ""], items: ["", "", ""], primaryDocDescription: ["", "", "Annual report"],
    primaryDocument: ["amendment.htm", "current.htm", "annual.htm"],
  } });
  assert.equal(filing?.form, "10-K");
  assert.equal(filing?.documentUrl, "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000123/annual.htm");
});

test("business-section extraction ignores a table of contents and returns bounded 10-K evidence", () => {
  const paragraph = "NVIDIA designs accelerated computing platforms and related software for data center and other markets. ".repeat(18);
  const html = `<html><head><style>.hidden{display:none}</style><script>ITEM 1. BUSINESS fake script</script></head><body>
    <p>Table of contents</p><p>ITEM 1. BUSINESS</p><p>3</p><p>ITEM 1A. RISK FACTORS</p>
    <h1>ITEM 1. BUSINESS</h1><p>${paragraph}</p><h1>ITEM 1A. RISK FACTORS</h1><p>Risks</p></body></html>`;
  const section = extractBusinessSection(html, "10-K", 900);
  assert.ok(section);
  assert.equal(section.heading, "Item 1. Business");
  assert.equal(section.extractionMethod, "form-item");
  assert.match(section.excerpt, /^NVIDIA designs accelerated computing/);
  assert.equal(section.excerpt.includes("fake script"), false);
  assert.equal(section.truncated, true);
  assert.ok(section.sectionCharacters > 1_000);
});

test("business-section extraction supports 20-F and withholds unverifiable text", () => {
  const paragraph = "The company develops semiconductor manufacturing systems and serves customers around the world. ".repeat(16);
  const html = `<html><body><h2>ITEM 4. INFORMATION ON THE COMPANY</h2><p>${paragraph}</p><h2>ITEM 4A. UNRESOLVED STAFF COMMENTS</h2></body></html>`;
  const section = extractBusinessSection(html, "20-F");
  assert.equal(section?.heading, "Item 4. Information on the Company");
  assert.equal(section?.extractionMethod, "form-item");
  assert.match(section?.excerpt ?? "", /^The company develops semiconductor/);
  assert.equal(extractBusinessSection(`<html><body>${"Unstructured prose. ".repeat(80)}</body></html>`, "10-K"), null);
  assert.equal(extractBusinessSection(html, "40-F"), null);
});

test("20-F extraction resolves a verified overview referenced by Item 4 without returning the reference table", () => {
  const overview = "ASML is a leading innovator in the global semiconductor ecosystem. We provide hardware, software and services that help chipmakers create advanced microchips. Our customers use these systems in high-volume manufacturing around the world. We invest in research and work closely with suppliers and customers. ".repeat(5);
  const html = `<html><body>
    <h2>At a glance – 2025 overview</h2><p>${overview}</p><h2>STRATEGIC REPORT</h2>
    <h2>ITEM 4. INFORMATION ON THE COMPANY</h2><p>FORM 20-F CAPTION</p><p>LOCATION IN THIS DOCUMENT</p><p>B. Business Overview</p><p>At a glance / Our business, page 13</p><p>C. Organizational Structure</p><h2>ITEM 4A. UNRESOLVED STAFF COMMENTS</h2>
  </body></html>`;
  const section = extractBusinessSection(html, "20-F", 1_200);
  assert.ok(section);
  assert.equal(section.extractionMethod, "cross-referenced-overview");
  assert.equal(section.heading, "At a glance — official annual report overview");
  assert.match(section.excerpt, /^ASML is a leading innovator/);
  assert.equal(section.excerpt.includes("FORM 20-F CAPTION"), false);
});

test("20-F extraction withholds an unresolved cross-reference instead of publishing a table", () => {
  const html = `<html><body>${"Background information. ".repeat(50)}<h2>ITEM 4. INFORMATION ON THE COMPANY</h2><p>FORM 20-F CAPTION</p><p>LOCATION IN THIS DOCUMENT</p><p>B. Business Overview</p><p>See another document</p><h2>ITEM 4A. UNRESOLVED STAFF COMMENTS</h2></body></html>`;
  assert.equal(extractBusinessSection(html, "20-F"), null);
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
  assert.match(page, /最新の重要提出書類/);
  assert.match(page, /どんな企業か — 年次報告書の原文/);
  assert.match(page, /Tech Phaseによる日本語要約・評価ではありません/);
  assert.match(page, /20-F参照先を検証/);
  assert.match(page, /businessRequest\.current \+= 1/);
  assert.match(page, /リアルタイム通知ではありません/);
  assert.match(page, /profileRequest\.current \+= 1/);
  assert.match(page, /SECは名簿の正確性・網羅性を保証していません/);
  assert.match(route, /company_tickers_exchange\.json/);
  assert.match(route, /secJson\(directoryUrl, 86_400\)/);
  assert.match(route, /AbortSignal\.timeout\(8_000\)/);
  assert.match(route, /AbortSignal\.timeout\(12_000\)/);
  assert.match(route, /maxFilingBytes = 30_000_000/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /cache: "no-store"/);
  assert.match(route, /s-maxage=86400/);
  assert.match(dashboard, /\/research\/stocks/);
});
