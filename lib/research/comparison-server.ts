import "server-only";
import { unstable_cache } from "next/cache";
import { comparisonCatalog } from "./comparison-catalog";
import providers from "./providers.json";
import { parseSecDirectory } from "./stock-directory";
import { emptyFinancials } from "./comparison";
import { prepareComparisonAnalysis, currentComparisonAnalysis } from "./comparison-analysis";
import { loadSecComparison } from "./comparison-loader";
import { loadMarketInputs, loadTwelveComparisonState } from "./twelve-data-collector";
import { freshEnough } from "./fresh-enough";
import { buildSecMarketEvidence } from "./sec-market-evidence";
import { appendMarketItems } from "./twelve-data-financials";
import { comparisonScores, hasRecentQuarter } from "./comparison-scorecard";
import { fillFromProvider } from "./comparison-fill";
import type { Financials } from "./comparison";
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
async function readFinancials(ticker: string, cik: string) {
  const data = await loadSecComparison(ticker,cik,secText);
  return { ...data, preparedAnalysis: prepareComparisonAnalysis(data) };
}
// v7: second- and third-quarter cash flow from the year-to-date figures (Nov 14).
const cachedFinancials = unstable_cache(readFinancials, ["comparison-financials-v7-quarter-cash"], { revalidate: 300 });
/** Results matter most right after they are filed: an entry older than 15 minutes is read again from the SEC now, not served stale. */
const financials = (ticker: string, cik: string) => freshEnough(() => cachedFinancials(ticker, cik), () => readFinancials(ticker, cik), 15 * 60_000);
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
  // A newer earnings release is out but its quarterly report is not filed yet: the provider's statements are used when they already have
  // the newer quarter; otherwise the filing's previous quarter is shown, said on screen, rather than leaving every figure empty (owner, Nov 14).
  const pendingRelease = sec.status === "ready" && !hasRecentQuarter(sec, now) && onlyReleasePending(sec)
    && hasRecentQuarter({ ...sec, dataWarnings: [] }, now);
  if (pendingRelease) {
    const { data: twelve } = await loadTwelveComparisonState(ticker);
    if (twelve && twelve.financials.quarterRevenue && Date.parse(twelve.financials.quarterRevenue.end) > Date.parse(sec.quarterRevenue!.end) + 10 * 86400000) return twelve.financials;
    const shown = { ...sec, dataWarnings: [], previousQuarterShown: sec.dataWarnings!.map(w => /^(\d{4}-\d{2}-\d{2})/.exec(w.ja)?.[1]).find(Boolean) ?? "" };
    return completeFromProvider(ticker, await withMarketFactors(ticker, shown, now), now, twelve?.financials);
  }
  if (sec.status === "ready" && hasRecentQuarter(sec, now)) return completeFromProvider(ticker, await withMarketFactors(ticker, sec, now), now);
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

/** True when the only reason the filing is not current is a newer earnings release whose quarterly report is not filed yet. */
function onlyReleasePending(c: Financials) {
  const warnings = c.dataWarnings ?? [];
  return warnings.length > 0 && warnings.every(w => w.en.includes("earnings release"));
}

/** The price series, forward P/E and price-to-sales from the provider beside the filing's figures (no change to the filing's own numbers). */
async function withMarketFactors(ticker: string, sec: Financials, now: number): Promise<Financials> {
  const { series, statistics } = await loadMarketInputs(ticker);
  const evidence = buildSecMarketEvidence(sec, series, statistics, now);
  if (!evidence || !(evidence.margins.length === 4 || evidence.statistics || evidence.momentum)) return sec;
  return rebuildAnalysis({ ...sec, twelveData: evidence }, now);
}

function rebuildAnalysis(c: Financials, now: number): Financials {
  const prepared = prepareComparisonAnalysis(c, now);
  if (prepared && c.twelveData) appendMarketItems(prepared, c.twelveData, c.quarterRevenue!.end, c.quarterRevenue!.unit, now);
  return { ...c, preparedAnalysis: prepared };
}

/** Any factor still empty is taken from the provider's statements for the same quarter (read only when something is missing). */
async function completeFromProvider(ticker: string, c: Financials, now: number, provider?: Financials): Promise<Financials> {
  const scores = comparisonScores(c, now);
  if (scores.every(score => score.value !== null)) return c;
  const other = provider ?? (await loadTwelveComparisonState(ticker)).data?.financials;
  if (!other) return c;
  const ownFinancial = scores.find(score => score.id === "financial")?.value !== null;
  const filled = fillFromProvider({ ...c, supplementedFinancialAllowed: ownFinancial ? false : undefined }, other, now);
  return filled === c || !filled.supplemented?.length ? c : rebuildAnalysis(filled, now);
}
