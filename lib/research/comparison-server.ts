import "server-only";
import { unstable_cache } from "next/cache";
import { comparisonCatalog } from "./comparison-catalog";
import providers from "./providers.json";
import { parseSecDirectory } from "./stock-directory";
import { emptyFinancials } from "./comparison";
import { prepareComparisonAnalysis, currentComparisonAnalysis } from "./comparison-analysis";
import { loadSecComparison } from "./comparison-loader";
async function secText(url: string, limit: number) {
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
export async function loadComparisonFinancials(ticker: string) {
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
