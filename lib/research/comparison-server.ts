import "server-only";
import { unstable_cache } from "next/cache";
import { comparisonCatalog } from "./comparison-catalog";
import providers from "./providers.json";
import { parseSecDirectory } from "./stock-directory";
import { emptyFinancials } from "./comparison";
import { prepareComparisonAnalysis, currentComparisonAnalysis } from "./comparison-analysis";
import { loadSecComparison } from "./comparison-loader";
import { loadMarketInputs, loadTwelveComparisonState } from "./twelve-data-collector";
import { buildSecMarketEvidence } from "./sec-market-evidence";
import { appendMarketItems } from "./twelve-data-financials";
import { hasRecentQuarter } from "./comparison-scorecard";
export async function secText(url: string, limit: number) {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json", "User-Agent": process.env.RESEARCH_USER_AGENT || "TechPhaseResearch/1.0 research-preview" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok || !response.body) throw Error("sec-unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let text = "", bytes = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) throw Error("sec-too-large"); text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    return text;
  } finally { await reader.cancel(); }
}
async function secJson(url: string, limit: number) { return JSON.parse(await secText(url,limit)) as unknown; }
const directory = unstable_cache(async () => parseSecDirectory(await secJson("https://www.sec.gov/files/company_tickers_exchange.json", 2_000_000)), ["comparison-sec-directory-v1"], { revalidate: 86400 });
const financials = unstable_cache(async (ticker: string, cik: string) => {
  const data = await loadSecComparison(ticker,cik,secText);
  return { ...data, preparedAnalysis: prepareComparisonAnalysis(data) };
}, ["comparison-financials-v6-prepared-analysis"], { revalidate: 300 });
/** The SEC identifier of a listed company, from the provider list or the SEC's own directory. */
export async function secCik(ticker: string): Promise<string | null> {
  const provider = providers.find(p => p.ticker === ticker);
  const cik = provider?.supplementalSources?.find(s => "cik" in s && s.cik)?.cik ?? (await directory()).find(c => c.ticker === ticker)?.cik.toString();
  return cik && /^\d{1,10}$/.test(cik) ? cik : null;
}

/** The SEC filing first: it is free, instant for any listed company and newer than the provider's statements (a full quarter newer for
 * 16 of 27 companies checked on Nov 13). The provider then supplies only what a filing cannot: the live price series and forward P/E for
 * the market factors. A company the SEC cannot serve (foreign 20-F filers, missing quarter) falls back to the provider's statements.
 * A missing item stays "—": it is never scored as zero. */
export async function loadComparisonFinancials(ticker: string) {
  const sec = await loadSecFinancials(ticker);
  const now = Date.now();
  // An IFRS filer (TSM, ...) keeps the provider's standardized statements, which compare with US GAAP companies as they do today; the SEC
  // figures are used only if the provider cannot serve it.
  const ifrs = sec.quarterRevenue?.basis === "ifrs-full";
  if (ifrs) {
    const { data: twelve } = await loadTwelveComparisonState(ticker);
    if (twelve) return twelve.financials;
  }
  if (sec.status === "ready" && hasRecentQuarter(sec, now)) {
    const { series, statistics } = await loadMarketInputs(ticker);
    const evidence = buildSecMarketEvidence(sec, series, statistics, now);
    // No SEC-based market factor at all (no four quarters, no price series, no P/E): the saved analysis stays as prepared.
    if (!evidence || !(evidence.margins.length === 4 || evidence.statistics || evidence.momentum)) return sec;
    const withEvidence = { ...sec, twelveData: evidence };
    const prepared = prepareComparisonAnalysis(withEvidence, now);
    if (prepared) appendMarketItems(prepared, evidence, sec.quarterRevenue!.end, sec.quarterRevenue!.unit, now);
    return { ...withEvidence, preparedAnalysis: prepared };
  }
  const { data: twelve, busy } = await loadTwelveComparisonState(ticker);
  if (!twelve) return busy ? { ...sec, busy: true as const } : sec;
  const base = twelve.financials;
  if (twelve.scores.find(score => score.id === "financial")?.value != null) return base;
  // Balance-sheet figures are only borrowed when they describe the same quarter as Twelve Data's.
  return sec.status === "ready" && sec.balance && sec.balance.end === base.quarterRevenue?.end ? { ...base, balance: sec.balance } : base;
}

async function loadSecFinancials(ticker: string) {
  try {
    const provider = providers.find(p => p.ticker === ticker);
    let cik: string | undefined = provider?.supplementalSources?.find(s => "cik" in s && s.cik)?.cik;
    if (!cik) cik = (await directory()).find(c => c.ticker === ticker)?.cik.toString();
    if (!cik || !/^\d{1,10}$/.test(cik)) return emptyFinancials(ticker, "unsupported");
    const data = await financials(ticker, cik);
    return { ...data, preparedAnalysis: currentComparisonAnalysis(data) };
  } catch { return emptyFinancials(ticker, "unavailable"); }
}

export async function resolveComparisonCompany(ticker: string) {
  const known = comparisonCatalog.find(c => c.ticker === ticker);
  if (known) return known;
  const entry = (await directory()).find(c => c.ticker === ticker);
  return entry ? { ticker, name: entry.name, peer: ticker, caution: { ja: "事業構成や決算期間の違いを確認してください。", en: "Review differences in business mix and reporting periods." } } : null;
}
