// Builds the fixed sample data of the PRO feature tour (app/research/pro-experience) into lib/research/pro-experience-samples/.
// The tour pages never fetch anything: they read only these committed files. Run by hand when a sample should be refreshed:
//
//   node --experimental-strip-types scripts/pro-experience/build-samples.mjs          (repo data only)
//   node --experimental-strip-types scripts/pro-experience/build-samples.mjs --sec    (also re-reads the free SEC EDGAR data)
//
// No paid service is called (no OpenAI, Twelve Data or Stock News). Where each sample comes from is written into its file (_source).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadSecComparison } from "../../lib/research/comparison-loader.ts";
import { buildSecMarketEvidence } from "../../lib/research/sec-market-evidence.ts";
import { prepareComparisonAnalysis } from "../../lib/research/comparison-analysis.ts";
import { appendMarketItems } from "../../lib/research/twelve-data-financials.ts";
import { comparisonCatalog } from "../../lib/research/comparison-catalog.ts";
import { radarFacts } from "../../lib/research/radar-facts.ts";
import { buildRadar } from "../../lib/research/radar.ts";
import { THEME_TICKERS } from "../../lib/research/theme-definitions.ts";
import { sampleStockReturns } from "../../lib/research/theme-ranking.ts";
import { providers, sectorNames, sectorNamesEn } from "../../lib/research/intake.ts";
import { companyWatches } from "../../lib/research/company-watch.ts";

const root = new URL("../../", import.meta.url);
const out = new URL("lib/research/pro-experience-samples/", root);
mkdirSync(out, { recursive: true });
const save = (name, value) => writeFileSync(new URL(name, out), `${JSON.stringify(value, null, 1)}\n`);
const STOCKS = [["NVDA", "1045810"], ["AMD", "2488"], ["INTC", "50863"], ["ARM", "1973239"]];

// 1. Relationship map: the reviewed NVDA map exactly as the PRO screen serves it (data/chain/NVDA.json; NVDA is already the free sample).
save("relation-map-nvda.json", { _source: "data/chain/NVDA.json (copied unchanged; the map /api/research/chain-map serves for NVDA)", data: JSON.parse(readFileSync(new URL("data/chain/NVDA.json", root), "utf8")) });

// 3. Theme Ranking: the repository's own preview returns (lib/research/theme-ranking.ts sampleStockReturns), one set for every theme ticker.
save("themes.json", { _source: "lib/research/theme-ranking.ts sampleStockReturns(THEME_TICKERS): the repository's seeded preview numbers, not real prices (no price data is committed and Twelve Data is paid)", asOf: "2035-03-09", stocks: sampleStockReturns(THEME_TICKERS).map(stock => ({ ticker: stock.ticker, returns: Object.fromEntries(Object.entries(stock.returns).map(([period, value]) => [period, Math.round(value * 100) / 100])) })) });

// 4. 22 tracked stocks: the list as lib/research/intake.ts gives it, and the saved post-earnings summaries of NVDA and AMD (lib/research/company-watch.ts).
const OPEN = ["NVDA", "AMD"];
const watched = new Set(companyWatches.map(item => item.ticker));
save("watch22.json", {
  _source: "lib/research/intake.ts providers (the 22 tracked stocks) and lib/research/company-watch.ts (NVDA, AMD saved earnings summaries); only these two summaries are copied",
  companies: providers.map(p => ({ ticker: p.ticker, name: p.name, sector: { ja: sectorNames[p.sector], en: sectorNamesEn[p.sector] }, verified: watched.has(p.ticker) })),
  summaries: OPEN.map(ticker => companyWatches.find(item => item.ticker === ticker)),
});

if (process.argv.includes("--sec")) {
  const agent = "TechPhaseResearch/1.0 research-preview";
  const secText = async (url, limit) => {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": agent } });
    if (!response.ok) throw Error(`${url} ${response.status}`);
    const text = await response.text();
    if (text.length > limit) throw Error("too large");
    return text;
  };
  const now = Date.now(), snapshotAt = new Date(now).toISOString();
  // 2. Stock Comparison: the SEC-first path of lib/research/comparison-server.ts (filing figures and the four-quarter margin series). The
  // provider's price series and forward P/E (Twelve Data, paid) are not read, so momentum and valuation stay "—" as the real screen shows them.
  const companies = {};
  for (const [ticker, cik] of STOCKS) {
    const sec = await loadSecComparison(ticker, cik, secText, now);
    const evidence = buildSecMarketEvidence(sec, undefined, undefined, now);
    const c = evidence ? { ...sec, twelveData: evidence } : sec;
    const prepared = prepareComparisonAnalysis(c, now);
    if (prepared && c.twelveData) appendMarketItems(prepared, c.twelveData, c.quarterRevenue.end, c.quarterRevenue.unit, now);
    const company = comparisonCatalog.find(item => item.ticker === ticker);
    companies[ticker] = { ...company, ...c, preparedAnalysis: prepared };
  }
  save("compare.json", { _source: "SEC EDGAR companyfacts, submissions and the latest 10-Q/10-K filings (free public data), read through lib/research/comparison-loader.ts as the PRO comparison does; no Twelve Data, so valuation and momentum are not scored", snapshotAt, companies });
  // 5. Financial Radar: SEC companyfacts through lib/research/radar-facts.ts and buildRadar, as /api/research/radar does for PRO.
  const entries = [];
  for (const [ticker, cik] of STOCKS) entries.push({ ticker, facts: radarFacts(JSON.parse(await secText(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`, 25_000_000)), now) });
  save("radar.json", { _source: "SEC EDGAR companyfacts (free public data) through lib/research/radar-facts.ts radarFacts and lib/research/radar.ts buildRadar(tier pro)", snapshotAt, radar: buildRadar("semis", entries, "pro") });
}
