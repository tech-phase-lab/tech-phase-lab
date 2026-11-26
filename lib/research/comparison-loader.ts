import { emptyFinancials, extractFinancials } from "./comparison.ts";
import { financialFilings, inlineFinancialFacts, mergeFinancialFacts, tsmQuarterFacts, tsmStatementFacts } from "./comparison-filings.ts";
import type { FinancialFiling, SecFacts } from "./comparison-filings.ts";
import { parse } from "node-html-parser";

type FetchText = (url: string, limit: number) => Promise<string>;
const annualForm = /^(?:10-K|20-F|40-F)(?:\/A)?$/;
const warning = (ja: string, en: string) => ({ ja, en });
/** One path for every SEC-listed issuer, independent of the monitored news list.
 * Check submissions first: companyfacts alone is not proof of freshness.
 */
export async function loadSecComparison(ticker: string, cik: string, fetchText: FetchText, now = Date.now()) {
  // Size limits: the largest filers passed the old ones (JPMorgan's submissions list is about 4.6 MB, a few companyfacts files pass 20 MB),
  // which left them with "New filings could not be checked" or no figures at all.
  const [factsResponse, submissionsResponse] = await Promise.allSettled([
    fetchText(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10,"0")}.json`, 40_000_000).then(JSON.parse),
    fetchText(`https://data.sec.gov/submissions/CIK${cik.padStart(10,"0")}.json`, 12_000_000).then(JSON.parse),
  ]);
  const currency = ticker === "TSM" && Number(cik) === 1046179 ? "TWD" : undefined;
  const initial = factsResponse.status === "fulfilled" ? extractFinancials(ticker,cik,factsResponse.value,now,currency) : emptyFinancials(ticker,"unavailable",new Date(now).toISOString());
  if (submissionsResponse.status !== "fulfilled") return { ...initial, dataWarnings: [warning("新しい提出書類を確認できませんでした。", "New filings could not be checked.")] };
  const filings = financialFilings(submissionsResponse.value,cik,now);
  // An amendment that only adds Part III or exhibits (MO's 10-K/A of May 2026) carries no figures: the original report anchors freshness,
  // and figures an amendment restates arrive in companyfacts under it anyway. Before, MO's amendment was read on every load and flagged.
  const annual = filings.find(f => annualForm.test(f.form) && !f.form.endsWith("/A")) ?? filings.find(f => annualForm.test(f.form));
  const quarter = filings.find(f => (/^(?:10-Q)(?:\/A)?$/.test(f.form) || (/^6-K(?:\/A)?$/.test(f.form) && fiscalQuarterEnd(f.end, annual?.end))) && f.inline && (!annual || f.end > annual.end));
  // TSM's untagged earnings exhibits have a separate, verified actuals parser.
  const tsmRelease = ticker === "TSM" && Number(cik) === 1046179 ? filings.find(f => f.form.startsWith("6-K") && /\/tsm-\d{8}x6k\.htm$/.test(f.url) && ["03-31","06-30","09-30","12-31"].includes(f.end.slice(5)) && (!annual || f.end > annual.end)) : undefined;
  const tsmStatement = ticker === "TSM" && Number(cik) === 1046179 ? filings.find(f => f.form.startsWith("6-K") && /\/tsm-fsx\d{8}x6k\.htm$/.test(f.url) && (!annual || f.end > annual.end)) : undefined;
  const wanted = [annual && (!initial.revenue || initial.revenue.end < annual.end || (initial.revenue.filed ?? "") < annual.filed) ? annual : undefined,
    quarter && (!initial.quarterRevenue || initial.quarterRevenue.end < quarter.end || (initial.quarterRevenue.filed ?? "") < quarter.filed) ? quarter : undefined,
    tsmRelease && (!initial.quarterRevenue || initial.quarterRevenue.end < tsmRelease.end) ? tsmRelease : undefined,
    tsmStatement && (!initial.quarterRevenue || initial.quarterRevenue.end < tsmStatement.end || (initial.quarterRevenue.filed ?? "") < tsmStatement.filed) ? tsmStatement : undefined,
  ].filter((f): f is FinancialFiling => !!f);
  const additions: SecFacts[] = [];
  let primaryRevenueTag: string | undefined, quarterRevenueTag: string | undefined;
  await Promise.all(wanted.map(async filing => {
    try {
      const html = await fetchText(filing.url, 20_000_000);
      let inline = inlineFinancialFacts(html,cik,filing);
      // A foreign filer's 6-K is often a cover page with the tagged statements in another document of the same filing (BTI's half-year
      // report: bti-20260630_d2.htm is the cover, bti-20260630.htm the statements). The largest other inline document is then read.
      if (!hasRevenue(inline)) inline = await statementDocument(filing, cik, fetchText, html) ?? inline;
      additions.push(inline);
      if (filing === annual) primaryRevenueTag = inline.primaryRevenueTag;
      if (filing === quarter) quarterRevenueTag = inline.primaryRevenueTag;
      if (filing === tsmRelease) {
        const root = new URL(".",filing.url).href;
        const hrefs = parse(html).querySelectorAll("a").map(a => a.getAttribute("href")).filter((h): h is string => !!h && /^a[1-4]q\d{2}e[a-z0-9_]*\.htm$/i.test(h));
        if (new Set(hrefs).size !== 1) return;
        const exhibit = await fetchText(new URL(hrefs[0],root).href, 2_000_000);
        const facts = tsmQuarterFacts(exhibit,cik,filing);
        if (facts) additions.push(facts);
      }
      if (filing === tsmStatement) {
        const root = new URL(".",filing.url).href;
        const hrefs = parse(html).querySelectorAll("a").map(a => a.getAttribute("href")).filter((h): h is string => !!h && /^[a-z0-9_-]*(?:consolidatedreport|consolidatedfina)[a-z0-9_-]*\.htm$/i.test(h));
        if (new Set(hrefs).size !== 1) return;
        const exhibit = await fetchText(new URL(hrefs[0],root).href,20_000_000);
        const facts = tsmStatementFacts(exhibit,cik,filing);
        if (facts) additions.push(facts);
      }
    } catch { /* Keep retrieved figures with an explicit freshness warning below. */ }
  }));
  const result = extractFinancials(ticker,cik,mergeFinancialFacts(factsResponse.status === "fulfilled" ? factsResponse.value : null, additions,cik),now,currency,primaryRevenueTag,quarterRevenueTag);
  // No revenue yet: only the balance sheet is read, so freshness is the balance sheet's against the newest periodic report.
  if (result.preRevenue) {
    const newest = [annual, quarter].filter((f): f is FinancialFiling => !!f).sort((a, b) => b.end.localeCompare(a.end))[0];
    return { ...result, dataWarnings: newest && (!result.balance || result.balance.end < newest.end)
      ? [warning(`${newest.end}期の四半期提出書類から数値を取得できていません。`, `Figures from the quarterly filing for ${newest.end} are unavailable.`)] : [] };
  }
  const dataWarnings = [];
  if (annual && (!result.revenue || result.revenue.end < annual.end || (result.revenue.filed ?? "") < annual.filed)) dataWarnings.push(warning(`${annual.end}期の年次提出書類から数値を取得できていません。`, `Figures from the annual filing for ${annual.end} are unavailable.`));
  const latestQuarter = [quarter,tsmRelease,tsmStatement].filter((f): f is FinancialFiling=>!!f).sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed))[0];
  if (latestQuarter && (!result.quarterRevenue || result.quarterRevenue.end < latestQuarter.end || (result.quarterRevenue.filed ?? "") < latestQuarter.filed)) dataWarnings.push(warning(`${latestQuarter.end}期の四半期提出書類から数値を取得できていません。`, `Figures from the quarterly filing for ${latestQuarter.end} are unavailable.`));
  const earnings=filings.filter(f=>f.earnings).sort((a,b)=>b.filed.localeCompare(a.filed))[0];
  const newestFigures=[result.revenue?.filed,result.quarterRevenue?.filed].filter((d):d is string=>!!d).sort().at(-1);
  if(earnings && (!newestFigures || earnings.filed>newestFigures)) dataWarnings.push(warning(`${earnings.filed}の新しい決算発表は数値の反映が未確認です。`, `Figures from the newer earnings release on ${earnings.filed} are not verified.`));
  // An untagged foreign quarterly report cannot be inferred from monthly 6-Ks.
  // Make the limitation visible rather than presenting annual data as latest.
  if (annual && /^(?:20-F|40-F)/.test(annual.form) && (!result.quarterRevenue || result.periodMonths === 12) && filings.some(f => f.form.startsWith("6-K") && f.end > annual.end)) dataWarnings.push(warning("年次決算後の四半期数値は未取得です。", "Quarterly figures after the annual report are unavailable."));
  return { ...result, dataWarnings };
}

const CALENDAR_QUARTER_ENDS = ["03-31","06-30","09-30","12-31"];
/** A 6-K dated at the end of one of the company's fiscal quarters: a calendar quarter end, or a month end three, six or nine months after the
 *  annual report's year end (a Canadian bank's fiscal year ends October 31: its quarterly reports end January 31, April 30 and July 31). */
export function fiscalQuarterEnd(end: string, annualEnd?: string): boolean {
  if (CALENDAR_QUARTER_ENDS.includes(end.slice(5))) return true;
  if (!annualEnd || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(annualEnd)) return false;
  const monthEnd = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10) === d;
  if (!monthEnd(end) || !monthEnd(annualEnd)) return false;
  const months = (Number(end.slice(0, 4)) - Number(annualEnd.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(annualEnd.slice(5, 7));
  return months > 0 && months % 3 === 0;
}

const REVENUE_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue", "Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods", "InterestIncomeExpenseNet", "GrossInvestmentIncomeOperating", "RevenueAndOperatingIncome"];
const hasRevenue = (facts: SecFacts) => Object.values(facts.facts).some(tags => REVENUE_TAGS.some(tag => tag in tags));
/** The filing's other inline document with the statements: the largest .htm in its folder besides the primary one (not the rendered R pages
 *  or the index), read only when the primary document has no revenue fact. */
async function statementDocument(filing: FinancialFiling, cik: string, fetchText: FetchText, primaryHtml: string): Promise<SecFacts | null> {
  if (!filing.inline) return null;
  const folder = new URL(".", filing.url).href, primary = filing.url.slice(folder.length);
  const listing = JSON.parse(await fetchText(`${folder}index.json`, 2_000_000)) as { directory?: { item?: { name?: unknown; size?: unknown }[] } };
  const candidates = (listing.directory?.item ?? []).flatMap(item => typeof item.name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.htm$/.test(item.name)
    && item.name !== primary && !/^R\d+\.htm$/.test(item.name) && !item.name.includes("index") && Number(item.size) > 0 && Number(item.size) <= 20_000_000 ? [{ name: item.name, size: Number(item.size) }] : [])
    .sort((a, b) => b.size - a.size);
  if (!candidates.length) return null;
  const facts = inlineFinancialFacts(await fetchText(new URL(candidates[0].name, folder).href, 20_000_000), cik, filing, primaryHtml);
  return hasRevenue(facts) ? facts : null;
}
