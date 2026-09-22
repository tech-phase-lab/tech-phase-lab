import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateAnnualFilingBrief } from "../lib/research/annual-filing-briefs.ts";
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

function filingBriefFixture() {
  const shared = { ticker: "NVDA", cik: 1045810, form: "10-K", filingDate: "2026-02-25", reportDate: "2026-01-25", accessionNumber: "0001045810-26-000021", documentUrl: "https://www.sec.gov/Archives/example.htm", filingIndexUrl: "https://www.sec.gov/Archives/example-index.html", retrievedAt: "2026-09-20T08:00:00Z", sourceSha256: "a".repeat(64), sectionCharacters: 1000, truncated: false };
  const source = {
    business: { ...shared, heading: "Item 1. Business", extractionMethod: "form-item", excerpt: "NVIDIA designs accelerated computing platforms and software for data centers and other markets." },
    risks: { ...shared, heading: "Item 1A. Risk Factors", extractionMethod: "form-item", overview: null, excerpt: "Demand can change rapidly, and dependence on third-party suppliers could disrupt product delivery." },
  };
  const record = {
    id: "nvda-2026-annual-ja", status: "approved", ticker: "NVDA", accessionNumber: shared.accessionNumber, sourceSha256: shared.sourceSha256,
    summaryJa: "データセンターなどに向けて、アクセラレーテッド・コンピューティング基盤とソフトウェアを提供する企業です。",
    businessModelJa: "計算基盤と関連ソフトウェアをデータセンターなどの市場へ提供します。",
    riskPointsJa: [{ text: "需要の急変や第三者サプライヤーへの依存により、製品供給が滞る可能性があります。", evidenceIds: ["risk-1"] }],
    summaryEvidenceIds: ["business-1"], businessModelEvidenceIds: ["business-1"],
    evidence: [{ id: "business-1", section: "business", quote: source.business.excerpt }, { id: "risk-1", section: "risk", quote: source.risks.excerpt }],
    confidence: "high", generationMethod: "human", generatedAt: "2026-09-20T08:05:00Z", reviewedAt: "2026-09-20T08:10:00Z", reviewer: "editor-1", reviewReason: "原文と根拠引用を照合済み",
  };
  return { source, record };
}

test("annual-filing Japanese briefs require approval, current source identity, and exact evidence", () => {
  const { source, record } = filingBriefFixture();
  const valid = validateAnnualFilingBrief(record, source);
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.brief?.ticker, "NVDA");
  assert.equal("reviewer" in valid.brief, false);

  assert.ok(validateAnnualFilingBrief({ ...record, status: "draft" }, source).issues.includes("not-approved"));
  assert.ok(validateAnnualFilingBrief({ ...record, sourceSha256: "b".repeat(64) }, source).issues.includes("source-sha-mismatch"));
  assert.ok(validateAnnualFilingBrief({ ...record, evidence: record.evidence.map((item, index) => index ? item : { ...item, quote: "A plausible sentence that is absent from the source filing." }) }, source).issues.includes("evidence-not-in-source:business-1"));
  assert.ok(validateAnnualFilingBrief({ ...record, reviewedAt: "2026-09-20T08:01:00Z" }, source).issues.includes("review-before-generation"));
  const publicRecord = { ...record };
  delete publicRecord.reviewer;
  delete publicRecord.reviewReason;
  assert.equal(validateAnnualFilingBrief(publicRecord, source).brief, null);
  assert.equal(validateAnnualFilingBrief(publicRecord, source, true).brief?.ticker, "NVDA");
});

test("annual-filing Japanese briefs reject numbers absent from their cited evidence", () => {
  const { source, record } = filingBriefFixture();
  const result = validateAnnualFilingBrief({ ...record, summaryJa: `${record.summaryJa} 売上は100億ドルです。` }, source);
  assert.ok(result.issues.includes("number-not-grounded"));
  assert.equal(result.brief, null);
});

test("annual-filing Japanese briefs preserve multiple separately cited risks", () => {
  const { source, record } = filingBriefFixture();
  const secondRisk = "Cybersecurity incidents could interrupt services and harm the company reputation.";
  const candidate = {
    ...record,
    riskPointsJa: [
      ...record.riskPointsJa,
      { text: "サイバー攻撃により、サービスが中断し信用が損なわれる可能性があります。", evidenceIds: ["risk-2-1"] },
    ],
    evidence: [...record.evidence, { id: "risk-2-1", section: "risk", quote: secondRisk }],
  };
  const result = validateAnnualFilingBrief(candidate, {
    ...source,
    risks: { ...source.risks, excerpt: `${source.risks.excerpt}\n${secondRisk}` },
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.brief?.riskPointsJa.length, 2);
  assert.deepEqual(result.brief?.riskPointsJa[1].evidenceIds, ["risk-2-1"]);
});

test("stock search UI separates free identity data from licensed prices and news", async () => {
  const [page, market, marketStyles, widget, styles, polish, chartStyles, chartPolish, route, editorRoute, dashboard, review, researchStyles, home, lab] = await Promise.all([
    readFile(new URL("../app/research/stocks/stock-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/research/stocks/market-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/research/stocks/market-workspace.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/research/stocks/tradingview-chart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/research/stocks/stocks.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/research/stocks/stock-polish.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/research/stocks/tradingview-chart.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/research/stocks/tradingview-polish.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/research/stocks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/research/editor/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/research/review/review-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/research/research.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lab/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /redirect\("\/research"\)/);
  assert.doesNotMatch(home, /LIVE INTELLIGENCE/);
  assert.match(lab, /LIVE INTELLIGENCE/);
  assert.match(lab, /Internal delivery and market-feed laboratory/);
  assert.match(page, /SEC公式データ使用/);
  assert.match(page, /メインメニュー/);
  assert.match(page, /何が変わった？/);
  assert.match(page, /TradingView株価・12か月チャート/);
  assert.match(page, /ニュース権利と分離/);
  assert.match(page, /MarketWorkspace/);
  assert.match(market, /株価カードと12か月チャート/);
  assert.match(market, /未契約の数値や推定値は表示しません/);
  assert.match(market, /参考株価を表示/);
  assert.match(market, /<TradingViewChart ticker=\{ticker\}/);
  assert.doesNotMatch(market, /referenceOpen|<details/);
  assert.match(market, /独自価格フィード/);
  assert.match(market, /外部通知/);
  assert.doesNotMatch(market, /api_key|secret_key|alpaca\.markets|twelvedata\.com/i);
  assert.match(marketStyles, /background:linear-gradient\(145deg,#101a24,#090f16 70%\)/);
  assert.doesNotMatch(marketStyles, /background:#fff/);
  assert.match(marketStyles, /@media\(max-width:520px\)/);
  assert.match(widget, /TradingView data delayed by 15 minutes/);
  assert.match(widget, /Tech Phaseの速報判定には使用しません/);
  assert.match(page, /最新の重要提出書類/);
  assert.match(page, /どんな企業か — 年次報告書の原文/);
  assert.match(page, /長い英語原文は証拠資料として収納しました/);
  assert.match(page, /sourceDetails/);
  assert.match(page, /必要なときだけ開く/);
  assert.match(page, /Tech Phaseによる日本語要約・評価ではありません/);
  assert.match(page, /20-F参照先を検証/);
  assert.match(page, /主要リスク — 年次報告書の原文/);
  assert.match(page, /リスク見出しを検証/);
  assert.match(page, /20-Fリスク参照先を検証/);
  assert.match(page, /リスク早見表（英語原文）/);
  assert.match(page, /企業が年次報告書で要約・一覧として明示した項目だけ/);
  assert.match(page, /根拠付き日本語要点/);
  assert.match(page, /evidenceIds\.map\(\(id\) => brief\.evidence\.find\(\(item\) => item\.id === id\)\)/);
  assert.match(page, /evidenceIds=\{brief.summaryEvidenceIds\}/);
  assert.match(page, /evidenceIds=\{brief.businessModelEvidenceIds\}/);
  assert.match(page, /evidenceIds=\{point.evidenceIds\}/);
  assert.match(page, /提出後の決算・ニュースは含みません/);
  assert.match(page, /提出番号・原文SHA・根拠引用・数値を照合/);
  assert.match(page, /以前の承認は自動的に無効/);
  assert.match(page, /リスクを推測で補完しません/);
  assert.match(page, /businessRequest\.current \+= 1/);
  assert.match(page, /リアルタイム通知ではありません/);
  assert.match(page, /profileRequest\.current \+= 1/);
  assert.match(page, /SECは名簿の正確性・網羅性を保証していません/);
  const widgetDocument = await readFile(new URL("../app/research/stocks/widget/route.ts", import.meta.url), "utf8");
  assert.match(widgetDocument, /symbol-info/);
  assert.match(widgetDocument, /advanced-chart/);
  assert.match(widget, /12か月チャート/);
  assert.match(widget, /view, setView/);
  assert.match(widgetDocument, /range: "12M"/);
  assert.doesNotMatch(widget, /key=\{`\$\{symbol\}:\$\{lang\}:\$\{view\}`\}/);
  assert.match(widget, /TradingViewPanels key=\{`\$\{symbol\}:\$\{lang\}`\}/);
  assert.match(widget, /<TradingViewEmbed kind="compact"/);
  assert.match(widget, /chartOpened && <TradingViewEmbed kind="chart"/);
  assert.match(widget, /inert=\{view !== "compact"\}/);
  assert.match(widget, /チャートを再読み込み/);
  assert.match(chartStyles, /\.panel\[data-active=false\]\{[^}]*width:100%;visibility:hidden/);
  assert.match(widgetDocument, /ResizeObserver/);
  assert.match(widget, /event.source !== frameRef.current\?\.contentWindow/);
  assert.match(widget, /event.origin !== window.location.origin/);
  assert.match(widget, /iframe key=\{src\}/);
  assert.doesNotMatch(widget, /createElement\("script"\)|replaceChildren/);
  assert.match(widget, /株価・指標を再読み込み/);
  assert.doesNotMatch(widget, /hidden=\{failed\}/);
  assert.match(widget, /setAttempts\(\(current\) => \(\{ \.\.\.current, \[view\]: current\[view\] \+ 1 \}\)\)/);
  assert.match(widget, /attempt=\{attempts.compact\}/);
  assert.match(widget, /attempt=\{attempts.chart\}/);
  assert.doesNotMatch(widget, /表示が欠ける場合|Missing data\?/);
  assert.match(widget, /aria-hidden="true">▶<\/span>/);
  assert.match(widget, /株価・指標を再読み込みする/);
  assert.match(widget, /TradingViewの15分遅延データです。/);
  assert.match(widget, /<br \/>\{lang === "ja" \? "Tech Phaseの速報判定には使用しません。"/);
  assert.match(chartStyles, /\.reloadControl button\{[^}]*border:0;[^}]*background:transparent/);
  assert.equal((widget.match(/className=\{styles.reloadControl\}/g) ?? []).length, 1);
  assert.match(chartStyles, /\.reloadControl\{grid-column:2;grid-row:2/);
  assert.match(chartStyles, /@media\(max-width:650px\)\{[\s\S]*\.reloadControl\{grid-column:1 \/ -1;grid-row:4/);
  assert.doesNotMatch(widget, /無料ウィジェットによる参考表示/);
  assert.match(widget, /Tech Phaseの速報判定には使用しません/);
  assert.match(styles, /\.hero h1\{[^}]*font-weight:650/);
  assert.match(styles, /\.main \.search input:focus-visible\{outline:0\}/);
  assert.match(page, /米国株リサーチ/);
  assert.match(page, /銘柄を選ぶと株価と公式情報を表示します/);
  assert.match(page, /詳細を見る/);
  assert.match(page, /ほかの検索結果を見る/);
  assert.match(page, /visibleResults/);
  assert.match(page, /marketTarget\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(page, /株価とSEC企業情報を確認中/);
  assert.match(page, /profileDetails/);
  assert.match(polish, /\.mobileTitle\{display:block/);
  assert.match(polish, /\.resultButton/);
  assert.doesNotMatch(widget, /COMPANY EVENTS|データ接続準備中/);
  assert.doesNotMatch(widget, /viewportRef|quoteNavigation|横にスワイプ|scrollTo/);
  assert.match(widgetDocument, /width: "100%"/);
  assert.match(widgetDocument, /colorTheme: "dark"/);
  assert.match(chartStyles, /\.compactEmbed\{min-height:220px\}/);
  assert.doesNotMatch(chartStyles, /min-width:760px|quoteViewport|quoteNavigation/);
  assert.doesNotMatch(chartStyles, /scaleY|scale\(|translateX|\.compactEmbed::after|height:122%/);
  assert.match(polish, /\.profileDetails/);
  assert.match(chartPolish, /\.heading h2/);
  assert.match(route, /company_tickers_exchange\.json/);
  assert.match(route, /secJson\(directoryUrl, 86_400\)/);
  assert.match(route, /AbortSignal\.timeout\(8_000\)/);
  assert.match(route, /AbortSignal\.timeout\(12_000\)/);
  assert.match(route, /maxFilingBytes = 30_000_000/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /extractRiskSection/);
  assert.match(route, /approvedAnnualFilingBrief/);
  assert.match(route, /approvedMonitorBrief/);
  assert.match(route, /RESEARCH_MONITOR_TOKEN/);
  assert.match(route, /validateAnnualFilingBrief\(remoteCandidate, source, true\)/);
  assert.match(route, /briefStatus: brief \? "approved" : "pending"/);
  assert.match(route, /annual-sections-not-found/);
  assert.match(route, /BusinessSection \| null/);
  assert.match(route, /business, risks/);
  assert.match(route, /cache: "no-store"/);
  assert.match(route, /s-maxage=300, stale-while-revalidate=3600/);
  assert.match(dashboard, /\/research\/stocks/);
  assert.match(dashboard, /\/lab/);
  assert.match(dashboard, /ホーム \/ リサーチデスク/);
  assert.match(dashboard, /サイドメニュー/);
  assert.match(dashboard, /検証済み銘柄/);
  assert.match(dashboard, /根拠照合済みのレポートがある銘柄だけ/);
  assert.match(dashboard, /coveredCompanies/);
  assert.match(dashboard, /監視対象 \$\{monitoredCompanies\.length\}社/);
  assert.match(dashboard, /数値比較を公開済み/);
  assert.match(dashboard, /速報配信や全資料の分析完了を示すものではありません/);
  assert.match(dashboard, /\/research\/companies\/\$\{company\.ticker\}/);
  assert.match(researchStyles, /\.companyGroups \{/);
  assert.match(researchStyles, /@media\(max-width:760px\)[\s\S]*\.companyGroups \{\s*grid-template-columns:1fr/);
  assert.match(researchStyles, /\.primaryNav \{\s*display:none/);
  assert.match(researchStyles, /@media\(max-width:760px\)[\s\S]*\.primaryNav \{\s*display:flex/);
  assert.match(researchStyles, /\.sideMenu \{/);
  assert.match(dashboard, /何が変わった？/);
  assert.match(dashboard, /米国株を探す/);
  assert.match(dashboard, /Tech Phase PRO/);
  assert.doesNotMatch(dashboard, /変化を追う/);
  assert.match(dashboard, /無料で調べる。PROなら変化を見逃さない。/);
  assert.match(dashboard, /課金・会員公開は未開始/);
  assert.match(dashboard, /原文照合済みの日本語要点・影響分類/);
  assert.match(dashboard, /未承認の要約、契約未確認のニュースや価格は配信しません/);
  assert.match(dashboard, /自動監視は運営検証中、会員配信・課金・外部通知は停止したまま/);
  assert.match(review, /根拠付きリサーチレビュー/);
  assert.match(review, /params\.set\("kind", "annual"\)/);
  assert.match(review, /action: "annual-draft"/);
  assert.match(review, /action: "annual-review"/);
  assert.match(review, /sourceBusiness: business\.excerpt/);
  assert.match(review, /sourceRisks: riskCorpus\(risks\)/);
  assert.match(review, /existing\?\.sourceSha256 === source\.business\.sourceSha256/);
  assert.match(review, /年次報告書の下書きを保存/);
  assert.match(review, /年次報告書レビューキュー/);
  assert.match(review, /annualCounts\.actionable/);
  assert.match(review, /annualCounts\.integrity_invalid/);
  assert.match(review, /item\.integrityValid/);
  assert.match(review, /loadAnnual\(undefined, item\.ticker\)/);
  assert.match(review, /Promise\.allSettled\(\[/);
  assert.match(review, /type AnnualReviewFilter = "all" \| "actionable" \| "invalid"/);
  assert.match(review, /loadAnnualQueue\(filter\.value\)/);
  assert.match(review, /該当する年次報告書はありません/);
  assert.match(editorRoute, /"actionable", "invalid", "draft", "held", "approved", "rejected"/);
  assert.match(editorRoute, /url\.searchParams\.set\("view", view\)/);
  assert.match(review, /速報レビューキュー/);
  assert.match(review, /reviewCounts\.awaiting_review/);
  assert.match(review, /reviewCounts\.machine_ready/);
  assert.match(review, /reviewCounts\.machine_blocked/);
  assert.match(review, /type ReviewFilter = "all" \| "ready" \| "blocked" \| "needs-draft"/);
  assert.match(review, /params\.set\("view", filter\)/);
  assert.match(review, /load\(undefined, filter\.value\)/);
  assert.match(review, /該当する資料はありません/);
  assert.match(review, /機械検証通過は、人間が内容を確認できる状態の件数です/);
  assert.match(review, /対応優先順/);
  assert.match(review, /selected\.brief_status === "stale" && !selected\.brief_current/);
  assert.match(review, /旧要約と旧根拠はフォームへ読み戻していません/);
  assert.match(review, /失効した以前の下書き（参考・再利用不可）/);
  assert.match(review, /selected\.previous_brief/);
  assert.match(review, /編集フォームには転記していません/);
  assert.match(review, /新しい下書き保存後に判断できます/);
  assert.match(review, /selected\.review_preflight\.ready/);
  assert.match(review, /承認前の機械検証：通過/);
  assert.match(review, /これは人間による内容確認の代わりではありません/);
  assert.match(review, /draft-fingerprint-mismatch/);
  assert.match(review, /source-check-stale/);
  assert.match(review, /validationSha256: selected\.draft_validation_sha256/);
  assert.match(review, /validationSha256: annualRecord\.validationSha256/);
  assert.match(review, /code === "draft-revision-mismatch"/);
  assert.match(review, /code === "annual-draft-revision-mismatch"/);
  assert.match(review, /annualReviewPreflight/);
  assert.match(review, /sourceBusiness: annualSource\.business\.excerpt/);
  assert.match(review, /sourceRisks: riskCorpus\(annualSource\.risks\)/);
  assert.match(review, /!annualPreflight\.ready/);
  assert.match(review, /selected\.sha256.*selected\.generated_at/);
  assert.match(review, /selected\?\.review_history \?\? \[\]/);
  assert.match(review, /annualRecord\?\.reviewHistory \?\? \[\]/);
  assert.match(review, /判断履歴（直近/);
  assert.match(review, /年次報告書の判断履歴（直近/);
  assert.match(review, /現在の下書き.*過去の下書き/);
  assert.match(review, /draftValidationSha256/);
  assert.match(review, /draft_validation_sha256/);
  assert.match(review, /人間が承認するまで公開されません/);
  assert.match(review, /annualRisks\.map/);
  assert.match(review, /リスクを追加/);
  assert.match(review, /根拠引用を追加/);
  assert.match(review, /annualRisks\.length >= 6/);
  assert.match(review, /risk-\$\{riskIndex \+ 1\}-\$\{evidenceIndex \+ 1\}/);
});
