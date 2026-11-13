import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { extractFinancials, emptyFinancials } from "../lib/research/comparison.ts";
import { prepareComparisonAnalysis, currentComparisonAnalysis } from "../lib/research/comparison-analysis.ts";
import { buildSecMarketEvidence } from "../lib/research/sec-market-evidence.ts";
import { appendMarketItems } from "../lib/research/twelve-data-financials.ts";
import { hasRecentQuarter, comparisonAvailability, comparisonScores } from "../lib/research/comparison-scorecard.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const fixture = t => JSON.parse(readFileSync(new URL(`./fixtures/sec-companyfacts-${t}.json`, import.meta.url), "utf8"));
const series = { adjust: "splits", retrievedAt: "2026-11-13T11:00:00Z", payload: { meta: { symbol: "MU", interval: "1day", currency: "USD" }, status: "ok", values: [{ datetime: "2026-11-12", close: "120" }, { datetime: "2026-08-12", close: "100" }] } };
const statistics = { retrievedAt: "2026-11-13T09:00:00Z", payload: { meta: { symbol: "MU", currency: "USD" }, statistics: { valuations_metrics: { forward_pe: "11.5" } } } };

async function server(stubs) {
  let text = readFileSync(new URL("../lib/research/comparison-server.ts", import.meta.url), "utf8")
    .replace('import "server-only";', "")
    .replace('import { unstable_cache } from "next/cache";', "const unstable_cache = fn => async (...a) => fn(...a);")
    .replace(/import \{ comparisonCatalog \}[^;]*;/, "const comparisonCatalog = [];")
    .replace(/import providers from[^;]*;/, 'const providers = [{ ticker: "MU", supplementalSources: [{ cik: "723125" }] }, { ticker: "ASML", supplementalSources: [{ cik: "937966" }] }];')
    .replace(/import \{ parseSecDirectory \}[^;]*;/, "const parseSecDirectory = () => [];")
    .replace(/import \{ emptyFinancials \}[^;]*;/, "const emptyFinancials = globalThis.__t.emptyFinancials;")
    .replace(/import \{ prepareComparisonAnalysis, currentComparisonAnalysis \}[^;]*;/, "const { prepareComparisonAnalysis, currentComparisonAnalysis } = globalThis.__t;")
    .replace(/import \{ loadSecComparison \}[^;]*;/, "const loadSecComparison = globalThis.__t.loadSecComparison;")
    .replace(/import \{ loadMarketInputs, loadTwelveComparisonState \}[^;]*;/, "const { loadMarketInputs, loadTwelveComparisonState } = globalThis.__t;")
    .replace(/import \{ buildSecMarketEvidence \}[^;]*;/, "const buildSecMarketEvidence = globalThis.__t.buildSecMarketEvidence;")
    .replace(/import \{ appendMarketItems \}[^;]*;/, "const appendMarketItems = globalThis.__t.appendMarketItems;")
    .replace(/import \{ hasRecentQuarter \}[^;]*;/, "const hasRecentQuarter = globalThis.__t.hasRecentQuarter;");
  globalThis.__t = { emptyFinancials, prepareComparisonAnalysis, currentComparisonAnalysis, buildSecMarketEvidence, appendMarketItems, hasRecentQuarter, ...stubs };
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(text)).toString("base64") + `#${Math.random()}`);
}
const withClock = async fn => { const real = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = real; } };
const mu = () => extractFinancials("MU", "723125", fixture("MU"), NOW);

test("SEC first: a US filer is served from the filing; the provider is asked only for the price series and forward P/E", () => withClock(async () => {
  let twelveStatements = 0, marketAsked = 0;
  const { loadComparisonFinancials } = await server({
    loadSecComparison: async () => mu(),
    loadMarketInputs: async () => { marketAsked++; return { series, statistics }; },
    loadTwelveComparisonState: async () => { twelveStatements++; return { data: null, busy: false }; },
  });
  const c = await loadComparisonFinancials("MU");
  assert.equal(twelveStatements, 0); assert.equal(marketAsked, 1);
  assert.equal(c.quarterRevenue.basis, "us-gaap"); assert.equal(c.quarterRevenue.end, "2026-09-03");
  assert.equal(c.twelveData.margins.length, 4);
  const scores = Object.fromEntries(comparisonScores(c, NOW).map(s => [s.id, s.value]));
  assert.equal(scores.valuation, 8.7); assert.equal(scores.momentum, 7); assert.ok(scores.stability > 0);
  assert.ok(c.preparedAnalysis.items.some(i => i.id === "valuation"));
  assert.ok(currentComparisonAnalysis(c, NOW)); // the saved text matches this exact evidence
}));

test("SEC first: if the provider's price inputs are missing the filing's numbers still show, only the market factors are left out", () => withClock(async () => {
  const { loadComparisonFinancials } = await server({ loadSecComparison: async () => mu(), loadMarketInputs: async () => ({}), loadTwelveComparisonState: async () => ({ data: null, busy: false }) });
  const c = await loadComparisonFinancials("MU");
  const scores = Object.fromEntries(comparisonScores(c, NOW).map(s => [s.id, s.value]));
  assert.equal(scores.valuation, null); assert.equal(scores.momentum, null);
  assert.ok(scores.growth !== null && scores.profitability !== null);
}));

test("a company the SEC cannot serve falls back to the provider's statements; busy is said only when nothing else has it", () => withClock(async () => {
  const twelveFinancials = { ...emptyFinancials("ASML", "unavailable"), status: "ready", quarterRevenue: { value: 1, unit: "EUR", start: null, end: "2026-09-30", filed: null, accession: null, tag: "sales", basis: "twelve-standardized" } };
  const unsupported = async () => emptyFinancials("ASML", "unsupported");
  let result = await (await server({ loadSecComparison: unsupported, loadMarketInputs: async () => ({}), loadTwelveComparisonState: async () => ({ data: { financials: twelveFinancials, scores: [{ id: "financial", value: 5 }] }, busy: false }) })).loadComparisonFinancials("ASML");
  assert.equal(result.quarterRevenue.basis, "twelve-standardized");
  result = await (await server({ loadSecComparison: unsupported, loadMarketInputs: async () => ({}), loadTwelveComparisonState: async () => ({ data: null, busy: true }) })).loadComparisonFinancials("ASML");
  assert.equal(result.busy, true);
  assert.match(comparisonAvailability(result, "ja", NOW), /混み合っています/);
  assert.match(comparisonAvailability(result, "en", NOW), /busy/);
  result = await (await server({ loadSecComparison: unsupported, loadMarketInputs: async () => ({}), loadTwelveComparisonState: async () => ({ data: null, busy: false }) })).loadComparisonFinancials("ASML");
  assert.equal(result.busy, undefined);
}));
