import "server-only";
import { unstable_cache } from "next/cache";
import providers from "./providers.json";
import { parseSecDirectory } from "./stock-directory";
import { extractFinancials, emptyFinancials } from "./comparison";
async function secJson(url: string, limit: number) {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json", "User-Agent": process.env.RESEARCH_USER_AGENT || "TechPhaseResearch/1.0 research-preview" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok || !response.body) throw Error("sec-unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let text = "", bytes = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) throw Error("sec-too-large"); text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally { await reader.cancel(); }
}
const directory = unstable_cache(async () => parseSecDirectory(await secJson("https://www.sec.gov/files/company_tickers_exchange.json", 2_000_000)), ["comparison-sec-directory-v1"], { revalidate: 86400 });
const financials = unstable_cache(async (ticker: string, cik: string) => {
  const data = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10,"0")}.json`, 15_000_000);
  return extractFinancials(ticker, cik, data);
}, ["comparison-annual-v1"], { revalidate: 3600 });
export async function loadComparisonFinancials(ticker: string) {
  try {
    const provider = providers.find(p => p.ticker === ticker);
    if (!provider) return emptyFinancials(ticker, "unsupported");
    let cik: string | undefined = provider.supplementalSources?.find(s => "cik" in s && s.cik)?.cik;
    if (!cik) cik = (await directory()).find(c => c.ticker === ticker)?.cik.toString();
    if (!cik || !/^\d{1,10}$/.test(cik)) return emptyFinancials(ticker, "unsupported");
    return await financials(ticker, cik);
  } catch { return emptyFinancials(ticker, "unavailable"); }
}
