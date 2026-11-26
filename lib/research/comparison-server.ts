import "server-only";
import { unstable_cache } from "next/cache";
import { comparisonCatalog } from "./comparison-catalog";
import providers from "./providers.json";
import { COMPARISON_EXCLUSIONS, comparableEntries, comparisonExclusion, tickersByCik } from "./comparison-exclusions";
import { parseSecDirectory } from "./stock-directory";
import { emptyFinancials } from "./comparison";
import { prepareComparisonAnalysis, currentComparisonAnalysis, preparePreRevenueAnalysis } from "./comparison-analysis";
import { appendEquityItem, appendFilingFinancialItems } from "./comparison-analysis";
import { loadSecComparison } from "./comparison-loader";
import { loadMarketInputs, loadTwelveComparisonState } from "./twelve-data-collector";
import { releaseStatements } from "./twelve-store";
import { freshEnough } from "./fresh-enough";
import { buildSecMarketEvidence } from "./sec-market-evidence";
import { appendMarketItems } from "./twelve-data-financials";
import { comparisonScores, hasRecentBalance, hasRecentQuarter } from "./comparison-scorecard";
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
// v8: the quarter's diluted shares, for price-to-sales from the filing when no statistics are stored (Nov 15).
// v9: a foreign filer's half-year or annual period, IFRS borrowings, the statements document of a 6-K (Nov 18).
// v10: a Canadian bank's quarterly 6-K, an inline XBRL document set, an IFRS bank's operating income, a half-year's twelve months (Nov 19).
// v11: financial strength read from the filing's own balance becomes a strength or weakness point (Nov 19: MO and BTI showed no weakness).
// v12: "debt exceeds cash" from the filing whenever its balance is scored, as from the provider's figures (Nov 19, all-ticker audit).
// v13: shareholders' equity in the balance (negative equity is a weakness) and revenue against the previous quarter as a point (Nov 20).
const cachedFinancials = unstable_cache(readFinancials, ["comparison-financials-v13-items-fill"], { revalidate: 900 });
/** Speed (owner, Nov 18: a comparison took about 20 seconds). A stored reading up to a day old is answered at once; once it is older than 15
 * minutes the cache reads the SEC again in the background (Next's own refresh of a stale entry), so the next viewer has the new figures. The
 * background job reads every listed company once a day (prewarmComparison), so only a company nobody has opened for a day waits for the SEC. */
const financials = (ticker: string, cik: string) => freshEnough(() => cachedFinancials(ticker, cik), () => readFinancials(ticker, cik), 24 * 3600_000);
/** The SEC identifier of a listed company, from the provider list or the SEC's own directory. */
export async function secCik(ticker: string): Promise<string | null> {
  const provider = providers.find(p => p.ticker === ticker);
  const cik = provider?.supplementalSources?.map(s => ("cik" in s ? s.cik : undefined)).find(Boolean) ?? (await directory()).find(c => c.ticker === ticker)?.cik.toString();
  return cik && /^\d{1,10}$/.test(cik) ? cik : null;
}

/** The SEC filing first: it is free, instant for any listed company and newer than the provider's statements (a full quarter newer for
 * 16 of 27 companies checked on Nov 13). The provider then supplies only what a filing cannot: the live price series and forward P/E for
 * the market factors. A company the SEC cannot serve (foreign 20-F filers, missing quarter) falls back to the provider's statements.
 * A missing item stays "—": it is never scored as zero. */
export async function loadComparisonFinancials(ticker: string) {
  // Only shared stores are read here (owner, Nov 26: the provider is never called from a user's request, so its cost never grows with users
  // or page views). Whatever the store lacks is filled by the background job (comparison-warm.ts) in the company's own minute of the day.
  return loadFinancials(ticker);
}

async function loadFinancials(ticker: string) {
  // The price inputs (stored statistics, the price series) are read beside the filing, not after it (speed, owner Nov 18).
  const market = loadMarketInputs(ticker);
  market.catch(() => undefined);
  const sec = await loadSecFinancials(ticker);
  const now = Date.now();
  // An IFRS filer (TSM, ...) keeps the provider's standardized statements, which compare with US GAAP companies as they do today, when they
  // have a current quarter; the SEC figures are used when the provider cannot serve it or only has an old period (before, a stored but stale
  // provider record left a half-year filer such as BTI with no figures at all while its own 6-K had them).
  const ifrs = sec.quarterRevenue?.basis === "ifrs-full";
  if (ifrs) {
    const { data: twelve } = await loadTwelveComparisonState(ticker);
    if (twelve && (hasRecentQuarter(twelve.financials, now) || !hasRecentQuarter(sec, now))) return twelve.financials;
  }
  // A newer earnings release is out but its quarterly report is not filed yet (NVDA, Nov 26: released Nov 17, no 10-Q nine days later):
  // the provider's statements read after the release (the background job reads them once the release is out, comparison-warm.ts), or the
  // weekly copy, are used when they have the newer quarter (revenue, operating and net income, EPS); otherwise the filing's previous quarter
  // is shown. No sentence about the pending report is shown in either case (owner, Nov 26).
  const released = releaseDay(sec, now);
  if (released) {
    const [weekly, afterRelease] = await Promise.all([loadTwelveComparisonState(ticker).then(r => r.data),
      releaseStatements(ticker, released).then(stored => stored ? loadTwelveComparisonState(ticker, stored).then(r => r.data) : null)]);
    const newer = [afterRelease, weekly].find(t => t?.financials.quarterRevenue && Date.parse(t.financials.quarterRevenue.end) > Date.parse(sec.quarterRevenue!.end) + 10 * 86400000);
    if (newer) {
      // The provider's statistics can still describe the old quarter for a few days (twelve-data-factors.ts reads them only for the same
      // quarter): financial strength then comes from the filing's balance sheet, said on screen as the previous quarter's (reviewer, Nov 26).
      const own = comparisonScores(newer.financials, now).find(s => s.id === "financial")?.value;
      if (own != null || !sec.balance || comparisonScores({ ...sec, dataWarnings: [] }, now).find(s => s.id === "financial")?.value == null) return newer.financials;
      return { ...newer.financials, balance: sec.balance, balanceFromQuarter: sec.balance.end,
        supplemented: [...new Set([...(newer.financials.supplemented ?? []), "financial"])], supplementedFromQuarter: sec.balance.end };
    }
    return completeFromProvider(ticker, await withMarketFactors(ticker, { ...sec, dataWarnings: [] }, now, market), now, weekly?.financials ?? null);
  }
  if (sec.status === "ready" && hasRecentQuarter(sec, now)) return completeFromProvider(ticker, await withMarketFactors(ticker, sec, now, market), now);
  // No revenue yet (owner, Nov 26): the filing's latest balance sheet and the share price, never the provider's statements (no sales either).
  if (hasRecentBalance(sec, now)) return withMarketFactors(ticker, { ...sec, preparedAnalysis: sec.preparedAnalysis ?? preparePreRevenueAnalysis(sec, now) }, now, market);
  const { data: twelve } = await loadTwelveComparisonState(ticker);
  // No current figures from either source: the share price still gives momentum (the radar showed no point at all for such a company).
  if (!twelve) return withMarketFactors(ticker, sec, now, market);
  const base = twelve.financials;
  if (twelve.scores.find(score => score.id === "financial")?.value != null) return base;
  // Balance-sheet figures are only borrowed when they describe the same quarter as Twelve Data's. The balance they score becomes a strength
  // or weakness point in the same words as for a filing (before, it scored the factor but never became a point).
  if (!(sec.status === "ready" && sec.balance && sec.balance.end === base.quarterRevenue?.end)) return base;
  const borrowed: Financials = { ...base, balance: sec.balance };
  const prepared = borrowed.preparedAnalysis;
  return prepared ? { ...borrowed, preparedAnalysis: { ...prepared, items: appendEquityItem(appendFilingFinancialItems([...prepared.items], borrowed, now), borrowed) } } : borrowed;
}

async function loadSecFinancials(ticker: string) {
  try {
    const provider = providers.find(p => p.ticker === ticker);
    let cik: string | undefined = provider?.supplementalSources?.map(s => ("cik" in s ? s.cik : undefined)).find(Boolean);
    if (!cik) cik = (await directory()).find(c => c.ticker === ticker)?.cik.toString();
    if (!cik || !/^\d{1,10}$/.test(cik)) return emptyFinancials(ticker, "unsupported");
    const data = await financials(ticker, cik);
    return { ...data, preparedAnalysis: currentComparisonAnalysis(data) };
  } catch { return emptyFinancials(ticker, "unavailable"); }
}

/** A SPAC, fund, ETN, preferred, warrant, unit or right (lib/research/comparison-exclusions.ts): not offered by the comparison. */
const siblingsOf = new WeakMap<object, ReturnType<typeof tickersByCik>>();
async function excludedEntry(ticker: string) {
  const entries = await directory();
  const entry = entries.find(c => c.ticker === ticker);
  if (!entry) return { entry, excluded: false };
  let siblings = siblingsOf.get(entries);
  if (!siblings) { siblings = tickersByCik(entries); siblingsOf.set(entries, siblings); }
  return { entry, excluded: comparisonExclusion(entry, siblings, COMPARISON_EXCLUSIONS) !== null };
}

export async function resolveComparisonCompany(ticker: string) {
  const known = comparisonCatalog.find(c => c.ticker === ticker);
  if (known) return known;
  // An excluded ticker asked for directly (an old link, the API) is answered as an unknown company, as any ticker the comparison does not know.
  const { entry, excluded } = await excludedEntry(ticker);
  return entry && !excluded ? { ticker, name: entry.name, peer: ticker, caution: { ja: "事業構成や決算期間の違いを確認してください。", en: "Review differences in business mix and reporting periods." } } : null;
}

/** True when the only reason the filing is not current is a newer earnings release whose quarterly report is not filed yet. */
function onlyReleasePending(c: Financials) {
  const warnings = c.dataWarnings ?? [];
  return warnings.length > 0 && warnings.every(w => w.en.includes("earnings release"));
}
/** The day of a newer earnings release whose quarterly report is not filed yet (the loader's warning, comparison-loader.ts), when the filing's
 *  previous quarter is otherwise current; null otherwise. */
export function releaseDay(sec: Financials, now = Date.now()): string | null {
  if (sec.status !== "ready" || hasRecentQuarter(sec, now) || !onlyReleasePending(sec) || !hasRecentQuarter({ ...sec, dataWarnings: [] }, now)) return null;
  return sec.dataWarnings!.map(w => /^(\d{4}-\d{2}-\d{2})/.exec(w.ja)?.[1]).find(Boolean) ?? null;
}
/** For the background job: the pending release of a company (above) and the end of the quarter its filing has, from the cached filing. */
export async function pendingRelease(ticker: string, now = Date.now()): Promise<{ day: string; filedEnd: string } | null> {
  const sec = await loadSecFinancials(ticker);
  const day = releaseDay(sec, now);
  return day && sec.quarterRevenue ? { day, filedEnd: sec.quarterRevenue.end } : null;
}

/** The price series, forward P/E and price-to-sales from the provider beside the filing's figures (no change to the filing's own numbers). */
async function withMarketFactors(ticker: string, sec: Financials, start: number, inputs?: ReturnType<typeof loadMarketInputs>): Promise<Financials> {
  const { series, statistics } = await (inputs ?? loadMarketInputs(ticker));
  // A series read just now is stamped after this request began; the evidence is judged at the time it arrived (a stamp later than "now" is
  // rejected as invalid, which left momentum empty on the first comparison of a company).
  const now = Math.max(start, Date.now());
  const evidence = buildSecMarketEvidence(sec, series, statistics, now);
  // No market evidence: the filing's own points as they are. A filing shown for its previous quarter (a newer release not yet filed) had no
  // points at all, because they were prepared while its newer release still blocked the period ("長所・短所の要点は未作成です", DTE, RJF).
  if (!evidence || !(evidence.margins.length === 4 || evidence.statistics || evidence.momentum)) return sec.preparedAnalysis || !hasRecentQuarter(sec, now) ? sec : rebuildAnalysis(sec, now);
  return rebuildAnalysis({ ...sec, twelveData: evidence }, now);
}

function rebuildAnalysis(c: Financials, now: number): Financials {
  const prepared = c.preRevenue ? preparePreRevenueAnalysis(c, now) : prepareComparisonAnalysis(c, now);
  const period = c.quarterRevenue ?? (c.preRevenue && c.balance ? { end: c.balance.end, unit: c.balance.cash?.unit ?? "USD" } : null);
  if (prepared && c.twelveData && period) appendMarketItems(prepared, c.twelveData, period.end, period.unit, now);
  return { ...c, preparedAnalysis: prepared };
}

/** Any factor still empty is taken from the provider's statements for the same quarter (read only when something is missing). */
async function completeFromProvider(ticker: string, c: Financials, now: number, provider?: Financials | null): Promise<Financials> {
  // Valuation comes from Treasure Hunt's list (applyValueCheck), never from the provider.
  const scores = comparisonScores(c, now).filter(score => score.id !== "valuation");
  if (scores.every(score => score.value !== null)) return c;
  const other = provider === undefined ? (await loadTwelveComparisonState(ticker)).data?.financials : provider;
  if (!other) return c;
  const ownFinancial = scores.find(score => score.id === "financial")?.value !== null;
  const filled = fillFromProvider({ ...c, supplementedFinancialAllowed: ownFinancial ? false : undefined }, other, now);
  return filled === c || !filled.supplemented?.length ? c : rebuildAnalysis(filled, now);
}

/** For the background job (once a day per company): read the company's filing figures into the cache, so a user's first comparison of the day
 *  is answered from it rather than waiting for the SEC. False when the SEC could not be read. */
export async function prewarmComparison(ticker: string): Promise<boolean> {
  return (await loadSecFinancials(ticker)).status !== "unavailable";
}

/** The SEC's list of listed companies (cached for a day), for the background job's universe: only the tickers the comparison offers
 * (comparison-exclusions.ts). Production log, Nov 25: the job spent 51 credits a day on each of ~910 funds, preferreds, notes and ETNs
 * that no member can compare (CFTR-PA, BHFAP, GOOGN, PDI, ...), many of them answered 404 by the provider; leaving them out takes the job
 * from five companies a minute to four and gives those credits to members. */
export const comparisonDirectory = async () => comparableEntries(await directory(), COMPARISON_EXCLUSIONS);

const STATEMENT_FACTORS = ["growth", "profitability", "cash", "financial", "stability"] as const;
/** For the background job, about once a week per company: does this company's filing leave a figure that only the provider's statements can
 * give (an IFRS or 20-F/6-K filer, no recent quarter, or a statement factor still empty)? A filing that cannot be read now is not judged. */
export async function statementsNeeded(ticker: string): Promise<{ needs: boolean; checkedAt: string }> {
  const now = Date.now(), checkedAt = new Date(now).toISOString();
  // Never compared, so never worth the statements' credits (owner, Nov 19).
  if (!comparisonCatalog.some(c => c.ticker === ticker) && (await excludedEntry(ticker)).excluded) return { needs: false, checkedAt };
  const sec = await loadSecFinancials(ticker);
  if (sec.status === "unavailable") throw new Error("sec-unavailable");
  if (hasRecentBalance(sec, now)) return { needs: false, checkedAt }; // no revenue yet: the provider has no sales either
  if (sec.quarterRevenue?.basis === "ifrs-full" || sec.status !== "ready" || !hasRecentQuarter(sec, now)) return { needs: true, checkedAt };
  const evidence = buildSecMarketEvidence(sec, undefined, undefined, now);
  const scores = comparisonScores(evidence ? { ...sec, twelveData: evidence } : sec, now);
  return { needs: scores.some(s => (STATEMENT_FACTORS as readonly string[]).includes(s.id) && s.value === null), checkedAt };
}
