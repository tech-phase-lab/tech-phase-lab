import { emptyFinancials, extractFinancials } from "./comparison.ts";
import { financialFilings, inlineFinancialFacts, mergeFinancialFacts, tsmQuarterFacts, tsmStatementFacts } from "./comparison-filings.ts";
import type { FinancialFiling, SecFacts } from "./comparison-filings.ts";
import type { Financials } from "./comparison.ts";
import { parse } from "node-html-parser";

type FetchText = (url: string, limit: number) => Promise<string>;
const annualForm = /^(?:10-K|20-F|40-F)(?:\/A)?$/;
const warning = (ja: string, en: string) => ({ ja, en });
/** The largest filing document read (reviewer, Nov 26: RERE's 20-F is 26.2 MB; at the old 20 MB it was never read and the company was shown
 *  as having no revenue). */
const FILING_LIMIT = 60_000_000;
/** One path for every SEC-listed issuer, independent of the monitored news list.
 * Check submissions first: companyfacts alone is not proof of freshness.
 */
export async function loadSecComparison(ticker: string, cik: string, fetchText: FetchText, now = Date.now()): Promise<Financials> {
  const out = await readSecComparison(ticker, cik, fetchText, now);
  return out;
}
async function readSecComparison(ticker: string, cik: string, fetchText: FetchText, now: number): Promise<Financials> {
  // Size limits: the largest filers passed the old ones (JPMorgan's submissions list is about 4.6 MB, a few companyfacts files pass 20 MB),
  // which left them with "New filings could not be checked" or no figures at all.
  const [factsResponse, submissionsResponse] = await Promise.allSettled([
    fetchText(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10,"0")}.json`, 40_000_000).then(JSON.parse),
    fetchText(`https://data.sec.gov/submissions/CIK${cik.padStart(10,"0")}.json`, 12_000_000).then(JSON.parse),
  ]);
  const currency = ticker === "TSM" && Number(cik) === 1046179 ? "TWD" : undefined;
  const sic = submissionsResponse.status === "fulfilled" ? String((submissionsResponse.value as { sic?: unknown })?.sic ?? "") : undefined;
  const initial = factsResponse.status === "fulfilled" ? extractFinancials(ticker,cik,factsResponse.value,now,currency,undefined,undefined,sic) : emptyFinancials(ticker,"unavailable",new Date(now).toISOString());
  if (submissionsResponse.status !== "fulfilled") return { ...initial, dataWarnings: [warning("新しい提出書類を確認できませんでした。", "New filings could not be checked.")] };
  const filings = financialFilings(submissionsResponse.value,cik,now);
  // Why a company has no figures, for the screen (owner, Nov 26: never a bare dash): no periodic report filed yet (a new listing), reports
  // without XBRL figures, or reports that stopped. Set on every answer below; the scorecard shows it only when nothing current is read.
  const periodic = filings.filter(f => /^(?:10-K|10-Q|20-F|40-F)(?:\/A)?$/.test(f.form));
  const taxonomies = factsResponse.status === "fulfilled" ? Object.keys((factsResponse.value as { facts?: Record<string, unknown> })?.facts ?? {}) : [];
  const lastReport = periodic.map(f => f.filed).sort().at(-1);
  const foreign = periodic.some(f => /^(?:20-F|40-F)/.test(f.form));
  const gapReason: Financials["gapReason"] = !periodic.length ? { kind: "no-report" }
    : !taxonomies.some(t => t === "us-gaap" || t === "ifrs-full") ? { kind: "no-xbrl" }
    : lastReport && (now - Date.parse(lastReport)) / 86400000 > (foreign ? 560 : 200) ? { kind: "stale", date: lastReport }
    : { kind: "unreadable" };
  // An amendment that only adds Part III or exhibits (MO's 10-K/A of May 2026) carries no figures: the original report anchors freshness,
  // and figures an amendment restates arrive in companyfacts under it anyway. Before, MO's amendment was read on every load and flagged.
  const annual = filings.find(f => annualForm.test(f.form) && !f.form.endsWith("/A")) ?? filings.find(f => annualForm.test(f.form));
  // An amendment that only adds exhibits (BETA's and AZZ's 10-Q/A) carries no figures: the original report of that quarter is read.
  const quarterly = (f: FinancialFiling) => (/^(?:10-Q)(?:\/A)?$/.test(f.form) || (/^6-K(?:\/A)?$/.test(f.form) && fiscalQuarterEnd(f.end, annual?.end))) && f.inline && (!annual || f.end > annual.end);
  const newestQuarterly = filings.find(quarterly);
  const quarter = newestQuarterly && /\/A$/.test(newestQuarterly.form) ? filings.find(f => quarterly(f) && !/\/A$/.test(f.form) && f.end === newestQuarterly.end) ?? newestQuarterly : newestQuarterly;
  // TSM's untagged earnings exhibits have a separate, verified actuals parser.
  const tsmRelease = ticker === "TSM" && Number(cik) === 1046179 ? filings.find(f => f.form.startsWith("6-K") && /\/tsm-\d{8}x6k\.htm$/.test(f.url) && ["03-31","06-30","09-30","12-31"].includes(f.end.slice(5)) && (!annual || f.end > annual.end)) : undefined;
  const tsmStatement = ticker === "TSM" && Number(cik) === 1046179 ? filings.find(f => f.form.startsWith("6-K") && /\/tsm-fsx\d{8}x6k\.htm$/.test(f.url) && (!annual || f.end > annual.end)) : undefined;
  const wanted = [annual && (!initial.revenue || initial.revenue.end < annual.end || (initial.revenue.filed ?? "") < annual.filed) ? annual : undefined,
    quarter && (!initial.quarterRevenue || initial.quarterRevenue.end < quarter.end || (initial.quarterRevenue.filed ?? "") < quarter.filed) ? quarter : undefined,
    tsmRelease && (!initial.quarterRevenue || initial.quarterRevenue.end < tsmRelease.end) ? tsmRelease : undefined,
    tsmStatement && (!initial.quarterRevenue || initial.quarterRevenue.end < tsmStatement.end || (initial.quarterRevenue.filed ?? "") < tsmStatement.filed) ? tsmStatement : undefined,
  ].filter((f): f is FinancialFiling => !!f);
  // The SEC's company facts sometimes leave out whole periodic reports (Nov 26 audit: 342 listed companies, e.g. AEP's July and October 2026
  // 10-Qs, AAT's July 10-Q), which broke the four-quarter series and the year-to-date cash flows. The reports of the last fifteen months
  // that company facts lack are read from their own inline XBRL, oldest needed first (at most GAP_FILINGS documents).
  const known = factsResponse.status === "fulfilled" ? factsAccessions(factsResponse.value) : null;
  if (known) {
    const since = new Date(now - 460 * 86400000).toISOString().slice(0, 10);
    const gaps = filings.filter(f => /^(?:10-K|10-Q|20-F|40-F)$/.test(f.form) && f.inline && f.filed >= since && !known.has(f.accession) && !wanted.includes(f)).slice(0, GAP_FILINGS);
    wanted.push(...gaps);
  }
  const additions: SecFacts[] = [];
  let primaryRevenueTag: string | undefined, quarterRevenueTag: string | undefined;
  await Promise.all(wanted.map(async filing => {
    try {
      const html = await fetchText(filing.url, FILING_LIMIT);
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
        const exhibit = await fetchText(new URL(hrefs[0],root).href,FILING_LIMIT);
        const facts = tsmStatementFacts(exhibit,cik,filing);
        if (facts) additions.push(facts);
      }
    } catch { /* Keep retrieved figures with an explicit freshness warning below. */ }
  }));
  let result = extractFinancials(ticker,cik,mergeFinancialFacts(factsResponse.status === "fulfilled" ? factsResponse.value : null, additions,cik),now,currency,primaryRevenueTag,quarterRevenueTag,sic);
  // Capital spending under the company's own line only (UFPT, reviewer Nov 26): company facts leave extension lines out, so the latest
  // annual report and the two latest quarterly reports not read yet are read for it, and the figures built again. Only for a company whose
  // capital spending is otherwise not found.
  if (result.status === "ready" && (result.capexNotReported || (!result.capex && !!result.operatingCash))) {
    const read = new Set(wanted.map(f => f.accession));
    const more = [annual, ...filings.filter(quarterly).slice(0, 2)].filter((f): f is FinancialFiling => !!f && f.inline && !read.has(f.accession));
    const extra = (await Promise.all(more.map(f => fetchText(f.url, FILING_LIMIT).then(html => inlineFinancialFacts(html, cik, f)).catch(() => null)))).filter((f): f is SecFacts => !!f);
    if (extra.some(f => f.facts["us-gaap"]?.TechPhaseExtensionCapex)) {
      additions.push(...extra);
      result = extractFinancials(ticker,cik,mergeFinancialFacts(factsResponse.status === "fulfilled" ? factsResponse.value : null, additions,cik),now,currency,primaryRevenueTag,quarterRevenueTag,sic);
    }
  }
  // No revenue yet: only the balance sheet is read, so freshness is the balance sheet's against the newest periodic report.
  const newest = [annual, quarter].filter((f): f is FinancialFiling => !!f).sort((a, b) => b.end.localeCompare(a.end))[0];
  if (result.preRevenue) {
    // "No revenue yet" must be true. A company that tags its revenue only under its own (extension) names, which the SEC's company facts
    // leave out (APA Corporation's oil and gas revenues), has a positive revenue fact in its newest report: it is left without a current
    // period ("comparable data unavailable") rather than shown as pre-revenue.
    // Fail closed (reviewer, Nov 26): a newest report that cannot be read leaves the company "unreadable", never "no revenue yet".
    let revenueFiled = false;
    if (newest?.inline) {
      try {
        const html = await fetchText(newest.url, FILING_LIMIT).catch(error => { revenueFiled = true; throw error; });
        if (companyRevenueTagged(html, newest.end)) {
          revenueFiled = true;
          // Its standard revenue lines are read from the filing itself (APA: us-gaap Revenues in the 10-Q, absent from company facts).
          const inline = inlineFinancialFacts(html, cik, newest);
          const again = extractFinancials(ticker,cik,mergeFinancialFacts(factsResponse.status === "fulfilled" ? factsResponse.value : null, [...additions, inline],cik),now,currency,
            newest === annual ? inline.primaryRevenueTag : primaryRevenueTag, newest === quarter ? inline.primaryRevenueTag : quarterRevenueTag, sic);
          if (!again.preRevenue) result = again;
        }
      } catch { /* the facts read stand */ }
    }
    if (revenueFiled && result.preRevenue) return { ...emptyFinancials(ticker, "unsupported", new Date(now).toISOString()), ...(result.financeSic ? { financeSic: true as const } : {}), gapReason };
  }
  if (result.preRevenue) {
    return { ...result, gapReason, dataWarnings: newest && (!result.balance || result.balance.end < newest.end)
      ? [warning(`${newest.end}期の四半期提出書類から数値を取得できていません。`, `Figures from the quarterly filing for ${newest.end} are unavailable.`)] : [] };
  }
  const dataWarnings = [];
  if (annual && result.revenue?.accession !== annual.accession && (!result.revenue || result.revenue.end < annual.end || (result.revenue.filed ?? "") < annual.filed)) dataWarnings.push(warning(`${annual.end}期の年次提出書類から数値を取得できていません。`, `Figures from the annual filing for ${annual.end} are unavailable.`));
  const latestQuarter = [quarter,tsmRelease,tsmStatement].filter((f): f is FinancialFiling=>!!f).sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed))[0];
  // The figures read from that very filing are current, whatever period date the SEC's index gives it (SAH: its 10-Q for the quarter to
  // Sep 30 is indexed as Oct 29).
  if (latestQuarter && result.quarterRevenue?.accession !== latestQuarter.accession && (!result.quarterRevenue || result.quarterRevenue.end < latestQuarter.end || (result.quarterRevenue.filed ?? "") < latestQuarter.filed)) dataWarnings.push(warning(`${latestQuarter.end}期の四半期提出書類から数値を取得できていません。`, `Figures from the quarterly filing for ${latestQuarter.end} are unavailable.`));
  const earnings=filings.filter(f=>f.earnings).sort((a,b)=>b.filed.localeCompare(a.filed))[0];
  const newestFigures=[result.revenue?.filed,result.quarterRevenue?.filed].filter((d):d is string=>!!d).sort().at(-1);
  if(earnings && (!newestFigures || earnings.filed>newestFigures)) dataWarnings.push(warning(`${earnings.filed}の新しい決算発表は数値の反映が未確認です。`, `Figures from the newer earnings release on ${earnings.filed} are not verified.`));
  // An untagged foreign quarterly report cannot be inferred from monthly 6-Ks.
  // Make the limitation visible rather than presenting annual data as latest.
  if (annual && /^(?:20-F|40-F)/.test(annual.form) && (!result.quarterRevenue || result.periodMonths === 12) && filings.some(f => f.form.startsWith("6-K") && f.end > annual.end)) dataWarnings.push(warning("年次決算後の四半期数値は未取得です。", "Quarterly figures after the annual report are unavailable."));
  return { ...result, gapReason, dataWarnings };
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

/** A positive revenue or sales fact (or cost of revenue, or gross profit) in a filing's inline XBRL, in any context, under a standard or the company's own
 *  name (company facts leave extension names out, and can lag the filing). */
/** Axes that split the company's own revenue (segment, product or service, geography, consolidation, sales channel, timing). */
const OWN_REVENUE_AXES = ["us-gaap:StatementBusinessSegmentsAxis", "srt:ProductOrServiceAxis", "srt:StatementGeographicalAxis", "srt:ConsolidationItemsAxis",
  "us-gaap:ContractWithCustomerSalesChannelAxis", "us-gaap:TimingOfTransferOfGoodOrServiceAxis", "srt:SegmentGeographicalAxis", "ifrs-full:SegmentsAxis", "ifrs-full:ProductsAndServicesAxis", "ifrs-full:GeographicalAreasAxis"];
export function companyRevenueTagged(html: string, periodEnd: string): boolean {
  // Only the filing's own latest twelve months count: a revenue column for an earlier year (a drug developer's comparative period from
  // before its sales stopped) is not current revenue.
  // Only the report's own latest period counts (its quarter, or its fiscal year): an earlier column or a year-to-date that still holds an
  // earlier quarter's sales (a drug developer whose payments ended) is not current revenue.
  const recent = new Set<string>(), dimensional = new Set<string>(), endAt = Date.parse(periodEnd);
  for (const m of html.matchAll(/<xbrli:context[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/gi)) {
    // A dimensional context counts for revenue too, when it splits the company's own revenue by segment, product, geography or channel
    // (reviewer, Nov 26: MTH's homebuilding and financial services revenue). Not a related party's, an officer's, an equity-method investee's
    // (LAR's Minera Exar) or a discontinued operation's (TMCR) figures, nor any other axis.
    const end = /<xbrli:endDate>\s*([0-9-]{10})/i.exec(m[2])?.[1], start = /<xbrli:startDate>\s*([0-9-]{10})/i.exec(m[2])?.[1];
    if (!end || !start || Math.abs(Date.parse(end) - endAt) > 10 * 86400000) continue;
    const members = [...m[2].matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>([^<]*)</gi)];
    if (/<xbrli:segment/i.test(m[2])) {
      const own = members.length > 0 && members.every(([, axis, member]) => OWN_REVENUE_AXES.includes(axis) && !/Discontinued|RelatedParty|EquityMethod|Investee|Officer|Director|Affiliate|JointVenture/i.test(member));
      if (!own) continue;
      dimensional.add(m[1]);
    }
    const days = (Date.parse(end) - Date.parse(start)) / 86400000;
    if ((days >= 75 && days <= 120) || (days >= 165 && days <= 200) || (days >= 350 && days <= 380)) recent.add(m[1]);
  }
  for (const m of html.matchAll(/<ix:nonFraction([^>]*)>([^<]*)</gi)) {
    const attrs = m[1], name = /name="([^"]+)"/i.exec(attrs)?.[1] ?? "", context = /contextRef="([^"]+)"/i.exec(attrs)?.[1] ?? "";
    const [prefix, local] = name.split(":");
    if (!local || prefix === "dei" || !recent.has(context)) continue;
    // A revenue or sales line itself (Revenues, RevenuesAndOther, OilAndGasRevenue, NetSales, RevenueFromContractWithCustomer...), not a
    // share sales agreement, a milestone or any other figure that merely names sales.
    // A cost of revenue or a gross profit above zero is proof of revenue as well (AUC files them with no revenue line).
    const costLine = /^(?:CostOfRevenue|CostOfGoodsAndServicesSold|CostOfGoodsSold|CostOfServices|CostOfSales|GrossProfit)$/.test(local);
    // Cost and gross profit only outside any dimension: a segment's expense disclosure (PRAX) or a related party's cost (BCTX) is no proof.
    if (costLine && !dimensional.has(context) && !/sign="-"/.test(attrs) && Number(m[2].replace(/&#?\w+;/g, "").replace(/[^0-9.]/g, "")) > 0) return true;
    // "…ExcludingAssessedTax" is the standard contract-revenue line itself, not a tax (it was skipped before: RERE).
    const plain = local.replace(/(?:Excluding|Including)AssessedTax$/, "");
    if (!/(?:Revenues?|Sales)(?:Net|Total)?$|^Revenues?(?:And|From|Net)|^(?:Net|Total)(?:Revenues?|Sales)/.test(plain)
      || /Cost|Deferred|Unearned|Receivable|Tax|Percent|Expense|Gain|Loss|Proceeds|Investment|Interest|ProForma|Remaining|Liabilit|Unbilled|Share|Stock|Agreement|Milestone|Payment|Arrangement|Commission/.test(plain)) continue;
    if (/sign="-"/.test(attrs)) continue;
    // The displayed figure without HTML entities (a nil revenue is shown as "&#8212;", a dash).
    if (Number(m[2].replace(/&#?\w+;/g, "").replace(/[^0-9.]/g, "")) > 0) return true;
  }
  return false;
}
/** At most this many extra periodic reports are read when company facts lack them (four quarters back from the newest). */
const GAP_FILINGS = 4;
/** The accession numbers company facts already holds (every standard-taxonomy fact names the filing it came from). */
function factsAccessions(payload: unknown): Set<string> {
  const out = new Set<string>();
  const facts = (payload as { facts?: Record<string, Record<string, { units?: Record<string, { accn?: string }[]> }>> })?.facts ?? {};
  for (const basis of ["us-gaap", "ifrs-full"]) for (const tag of Object.values(facts[basis] ?? {})) for (const values of Object.values(tag?.units ?? {})) if (Array.isArray(values)) for (const v of values) if (typeof v?.accn === "string") out.add(v.accn);
  return out;
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
    && item.name !== primary && !/^R\d+\.htm$/.test(item.name) && !item.name.includes("index") && Number(item.size) > 0 && Number(item.size) <= FILING_LIMIT ? [{ name: item.name, size: Number(item.size) }] : [])
    .sort((a, b) => b.size - a.size);
  if (!candidates.length) return null;
  const facts = inlineFinancialFacts(await fetchText(new URL(candidates[0].name, folder).href, FILING_LIMIT), cik, filing, primaryHtml);
  return hasRevenue(facts) ? facts : null;
}
