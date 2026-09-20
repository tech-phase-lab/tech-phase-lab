import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractBusinessSection, extractRiskSection, normalizeTicker, parseLatestAnnualFiling, parseRecentFilings, parseSecDirectory, parseSecProfile, searchDirectory, stockDirectoryIssues } from "../lib/research/stock-directory.ts";

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

test("10-K risk extraction preserves an explicit issuer summary and its filing order", () => {
  const detailedRisk = "Our operations depend on complex technology and suppliers, which may materially affect our business and financial results. ".repeat(20);
  const html = `<html><body><h1>ITEM 1A. RISK FACTORS</h1>
    <p>Risk Factors Summary</p><h2>Risks Related to Our Industry and Markets</h2>
    <p>• Failure to meet changing customer needs could adversely affect our financial results.</p>
    <p>• Competition may reduce our market share and operating margins.</p>
    <h2>Risks Related to Operations</h2><p>• Dependence on third-party suppliers could disrupt product delivery.</p>
    <h2>Risk Factors</h2><p>${detailedRisk}</p><h1>ITEM 1B. UNRESOLVED STAFF COMMENTS</h1>
  </body></html>`;
  const section = extractRiskSection(html, "10-K");
  assert.ok(section?.overview);
  assert.equal(section.overview.extractionMethod, "issuer-risk-summary");
  assert.equal(section.overview.itemCount, 3);
  assert.equal(section.overview.groups.length, 2);
  assert.equal(section.overview.groups[0].heading, "Risks Related to Our Industry and Markets");
  assert.match(section.overview.groups[1].items[0], /^Dependence on third-party suppliers/);
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

test("risk extraction ignores a table of contents and returns bounded 10-K Item 1A evidence", () => {
  const risk = "Our business is exposed to supply constraints, customer concentration and rapid technology changes that could materially affect results. ".repeat(18);
  const html = `<html><body><p>Read Item 1A. Risk Factors, our financial statements and other cautionary disclosures before investing.</p><p>Table of contents</p><p>ITEM 1A. RISK FACTORS</p><p>12</p><p>ITEM 1B. UNRESOLVED STAFF COMMENTS</p><h1>ITEM 1A. RISK FACTORS</h1><p>${risk}</p><h1>ITEM 1B. UNRESOLVED STAFF COMMENTS</h1></body></html>`;
  const section = extractRiskSection(html, "10-K", 1_000);
  assert.ok(section);
  assert.equal(section.heading, "Item 1A. Risk Factors");
  assert.equal(section.extractionMethod, "form-item");
  assert.match(section.excerpt, /^Our business is exposed to supply constraints/);
  assert.equal(section.truncated, true);
  assert.ok(section.sectionCharacters > 1_000);
  assert.equal(section.overview, null);
});

test("risk extraction supports direct 20-F Item 3.D and withholds reference tables", () => {
  const risk = "We face geopolitical, supply-chain and customer-demand risks that may adversely affect our operations and financial results. ".repeat(18);
  const html = `<html><body><h2>ITEM 3. KEY INFORMATION</h2><h3>D. RISK FACTORS</h3><p>${risk}</p><h2>ITEM 4. INFORMATION ON THE COMPANY</h2></body></html>`;
  const section = extractRiskSection(html, "20-F");
  assert.equal(section?.heading, "Item 3.D. Risk Factors");
  assert.equal(section?.extractionMethod, "form-item");
  assert.match(section?.excerpt ?? "", /^We face geopolitical/);
  const reference = `<html><body>${"Background. ".repeat(80)}<h3>D. RISK FACTORS</h3><p>FORM 20-F CAPTION</p><p>LOCATION IN THIS DOCUMENT</p><p>Risk factors, page 48</p><h2>ITEM 4. INFORMATION ON THE COMPANY</h2></body></html>`;
  assert.equal(extractRiskSection(reference, "20-F"), null);
  assert.equal(extractRiskSection(html, "40-F"), null);
});

test("20-F risk extraction resolves a verified annual-report section without starting on a continued page", () => {
  const overview = "The company faces risks that could materially affect operations, financial results and reputation. Customers may delay orders and suppliers may be unable to deliver critical components. Geopolitical controls may limit sales in important markets. Technology transitions may reduce demand for existing products. Cybersecurity incidents could disrupt systems and manufacturing. ".repeat(12);
  const html = `<html><body>
    <h2>Risk factors</h2><p>${overview}</p>
    <h2>Risk factors (continued)</h2><p>${"Continued risk text remains part of the verified risk section. ".repeat(80)}</p><h2>Information security</h2>
    <h2>APPENDIX – REFERENCE TABLE 20-F</h2><p>FORM 20-F CAPTION</p><p>LOCATION IN THIS DOCUMENT</p><p>D. Risk Factors</p><p>Risk – Risk factors</p><p>66</p><p>ITEM 4. INFORMATION ON THE COMPANY</p>
  </body></html>`;
  const section = extractRiskSection(html, "20-F", 1_200);
  assert.ok(section);
  assert.equal(section.heading, "Risk factors — official annual report section");
  assert.equal(section.extractionMethod, "cross-referenced-risk-factors");
  assert.match(section.excerpt, /^The company faces risks/);
  assert.equal(section.excerpt.includes("FORM 20-F CAPTION"), false);
});

test("20-F risk extraction exposes only a verified issuer overview list", () => {
  const overview = [
    "Our future success depends on responding to technological developments in our industry",
    "The success of new product introductions is uncertain and depends on our research programs",
    "We face intense competition that could adversely affect our business",
    "We are exposed to financial risks including liquidity and foreign exchange risk",
  ];
  const narrative = "We face risks that could materially affect operations, financial results and reputation. Customers may delay orders and suppliers may not deliver critical components. ".repeat(20);
  const html = `<html><body><h2>Overview of risk factors</h2><p>Risk type</p><p>Risk factor</p>${overview.map((item) => `<p>${item}</p>`).join("")}<h2>STRATEGIC REPORT</h2>
    <h2>ITEM 3. KEY INFORMATION</h2><h3>D. RISK FACTORS</h3><p>${narrative}</p><h2>ITEM 4. INFORMATION ON THE COMPANY</h2></body></html>`;
  const section = extractRiskSection(html, "20-F");
  assert.ok(section?.overview);
  assert.equal(section.overview.extractionMethod, "issuer-risk-overview");
  assert.deepEqual(section.overview.groups[0].items, overview);
  assert.equal(section.overview.itemCount, 4);
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
  assert.match(page, /主要リスク — 年次報告書の原文/);
  assert.match(page, /リスク見出しを検証/);
  assert.match(page, /20-Fリスク参照先を検証/);
  assert.match(page, /リスク早見表（英語原文）/);
  assert.match(page, /企業が年次報告書で要約・一覧として明示した項目だけ/);
  assert.match(page, /リスクを推測で補完しません/);
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
  assert.match(route, /extractRiskSection/);
  assert.match(route, /annual-sections-not-found/);
  assert.match(route, /BusinessSection \| null/);
  assert.match(route, /business, risks/);
  assert.match(route, /cache: "no-store"/);
  assert.match(route, /s-maxage=86400/);
  assert.match(dashboard, /\/research\/stocks/);
});
