// Turns the PRO feature tour's sample data into a complete, made-up snapshot on the samples' own timeline (owner, Nov 16: 「サンプルなので
// すべて埋めてください。割安性とモメンタムは基準を決めて計算するか、架空にしてください。多少ずれていても構いません。正確であるべきは本番です」).
//
//  - Dates move onto the fictional timeline of the frame (「2035/03/12 09:00 時点」): every calendar date by the same 99 months, so the latest
//    quarters end in late 2034 and every filing, release and source date stays before the sample moment; fiscal-year labels move by 8 years
//    (FY2027 -> FY2035, a fiscal year that now ends in April) and calendar-quarter labels by one quarter (Q2 2026 -> Q3 2034).
//  - What the real screen leaves as 「—」 is given a made-up input that the real scoring code then scores: forward P/E (valuation), a three-month
//    price change (momentum), Arm's last four quarterly operating margins (stability) and its quarterly free cash flow margin (cash generation).
//
// Run by hand: node --experimental-strip-types scripts/pro-experience/fictional-samples.mjs   (converts the committed files once; a file that
// already says "fictional": true is left alone). build-samples.mjs applies the same steps to what it builds. No network, no paid service.
import { readFileSync, writeFileSync } from "node:fs";
import { prepareComparisonAnalysis } from "../../lib/research/comparison-analysis.ts";
import { appendMarketItems } from "../../lib/research/twelve-data-financials.ts";

/** The sample moment in UTC (2035/03/12 09:00 in Japan). Every "retrieved / prepared at" time becomes this moment. */
export const SAMPLE_NOW = "2035-03-12T00:00:00.000Z";
/** The last U.S. close before the sample moment, and the close about three months (13 weeks) earlier. */
export const LAST_CLOSE = "2035-03-09", MOMENTUM_FROM = "2034-12-08";
const MONTHS = 99, YEARS = 8;
const FICTIONAL_NOTE = "All figures and dates are fictional sample values on the sample's own timeline (as of 2035/03/12 09:00 JST); they are not real data.";

const pad = n => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** One calendar date moved by 99 months; a month-end stays a month-end, a day past the new month's end becomes its last day. */
export function shiftDate(y, m, d) {
  const total = y * 12 + (m - 1) + MONTHS, ny = Math.floor(total / 12), nm = total % 12 + 1;
  const day = d === lastDay(y, m) ? lastDay(ny, nm) : Math.min(d, lastDay(ny, nm));
  return [ny, nm, day];
}
const shiftIso = iso => { const [y, m, d] = iso.split("-").map(Number); const [a, b, c] = shiftDate(y, m, d); return `${a}-${pad(b)}-${pad(c)}`; };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORDINALS = ["First", "Second", "Third", "Fourth"];
const shiftQuarter = (q, y) => { const n = (y * 4 + q - 1) + 4 * YEARS + 1; return [n % 4 + 1, Math.floor(n / 4)]; };

/** The dates and period labels inside one display text, moved onto the sample timeline. */
export function shiftText(text) {
  return text
    .replace(/\b(20\d\d)-(\d\d)-(\d\d)T[\d:.]+Z\b/g, () => SAMPLE_NOW)
    .replace(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, iso => shiftIso(iso))
    .replace(/(20\d\d)年(\d{1,2})月(\d{1,2})日/g, (_, y, m, d) => { const [a, b, c] = shiftDate(+y, +m, +d); return `${a}年${b}月${c}日`; })
    .replace(/(20\d\d)年(\d{1,2})月(?!\d)/g, (_, y, m) => { const [a, b] = shiftDate(+y, +m, 1); return `${a}年${b}月`; })
    .replace(new RegExp(`\\b(${MONTH_NAMES.join("|")}) (\\d{1,2}), (20\\d\\d)\\b`, "g"), (_, mo, d, y) => { const [a, b, c] = shiftDate(+y, MONTH_NAMES.indexOf(mo) + 1, +d); return `${MONTH_NAMES[b - 1]} ${c}, ${a}`; })
    .replace(new RegExp(`\\b(${MONTH_NAMES.join("|")}) (20\\d\\d)\\b`, "g"), (_, mo, y) => { const [a, b] = shiftDate(+y, MONTH_NAMES.indexOf(mo) + 1, 1); return `${MONTH_NAMES[b - 1]} ${a}`; })
    .replace(/\bFY ?(20\d\d)\b/g, (all, y) => all.replace(y, String(+y + YEARS)))
    .replace(/\bFiscal (20\d\d)\b/g, (_, y) => `Fiscal ${+y + YEARS}`)
    .replace(/\bQ([1-4]) (20\d\d)\b/g, (_, q, y) => { const [a, b] = shiftQuarter(+q, +y); return `Q${a} ${b}`; })
    .replace(new RegExp(`\\b(${ORDINALS.join("|")}) Quarter (20\\d\\d)\\b`, "g"), (_, o, y) => { const [a, b] = shiftQuarter(ORDINALS.indexOf(o) + 1, +y); return `${ORDINALS[a - 1]} Quarter ${b}`; })
    .replace(/\bby (20\d\d)\b/g, (_, y) => `by ${+y + YEARS}`);
}
/** Addresses and filing numbers are not display text (a sample never follows a link): they are left as they are. */
const KEEP = new Set(["url", "sourceUrl", "quarterSourceUrl", "href", "accession", "sourceRevision", "_source"]);
export function shiftDates(value, key = "") {
  if (typeof value === "string") return KEEP.has(key) ? value : shiftText(value);
  if (Array.isArray(value)) return value.map(item => shiftDates(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, k)]));
  return value;
}

/** The made-up market inputs the real scorecard turns into 割安性 and 株価モメンタム (forward P/E: 10x = 9 points ... 55x+ = 0;
 * three-month change: 0% = 5 points, +50% = 10, -50% = 0), and the price-to-sales figure kept beside them. */
export const MARKET = {
  NVDA: { forwardPE: 42.5, priceToSales: 18.2, changePct: 14.6 },
  AMD: { forwardPE: 31.0, priceToSales: 9.4, changePct: -8.6 },
  INTC: { forwardPE: 19.5, priceToSales: 3.1, changePct: 18.4 },
  ARM: { forwardPE: 48.0, priceToSales: 32.5, changePct: -12.5 },
};
/** Arm files as a foreign private issuer: its quarters carry no cash flow statement or earlier quarterly margins in the saved data. Made up:
 * the three quarters before the latest one (newest first) and the quarter's free cash flow margin and four-quarter revenue. */
const ARM_FILL = { earlierMargins: [16.8, 18.1, 20.4], fcfMargin: 17.6, revenueTtm: 5_236_000_000 };

/** AMD's quarter carried no weakness once the price fall was no longer listed (owner, Nov 27: a 3-month price move is not a business weakness).
 * Made up: a larger diluted average share count for the latest quarter (an acquisition paid partly in stock), so its one weakness is a
 * fundamentals point the real code writes from the figure (平均株式数 +6.3%). The year-earlier count is the one the saved growth implies. */
const AMD_FILL = { quarterDilutedShares: 1_745_000_000 };

const quarterBefore = (iso, n) => { const [y, m] = iso.split("-").map(Number); const t = y * 12 + (m - 1) - 3 * n; return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}-${pad(lastDay(Math.floor(t / 12), t % 12 + 1))}`; };

/** One comparison company, already on the sample timeline: every one of the seven factors gets a value, then the strengths and weaknesses
 * are prepared again by the real code at the sample moment. */
export function fillCompany(company) {
  const c = structuredClone(company), now = Date.parse(SAMPLE_NOW), q = c.quarterRevenue;
  if (c.ticker === "ARM") {
    c.quarterMargins = [{ periodEnd: q.end, value: c.quarterOperatingMargin }, ...ARM_FILL.earlierMargins.map((value, i) => ({ periodEnd: quarterBefore(q.end, i + 1), value }))];
    c.quarterFcfMargin = ARM_FILL.fcfMargin;
    c.quarterRevenueTtm = ARM_FILL.revenueTtm;
  }
  if (c.ticker === "AMD" && c.quarterDilutedShares !== AMD_FILL.quarterDilutedShares) {
    const yearEarlier = c.quarterDilutedShares / (1 + c.quarterDilutedSharesGrowth / 100);
    c.quarterDilutedShares = AMD_FILL.quarterDilutedShares;
    c.quarterDilutedSharesGrowth = (AMD_FILL.quarterDilutedShares / yearEarlier - 1) * 100;
  }
  const market = MARKET[c.ticker];
  c.retrievedAt = SAMPLE_NOW;
  c.twelveData = {
    version: 1, periodEnd: q.end, retrievedAt: SAMPLE_NOW,
    statistics: { retrievedAt: SAMPLE_NOW, quarterEnd: q.end, forwardPE: market.forwardPE, trailingPE: null, currentRatio: null, totalCash: null, totalDebt: null, priceToSales: market.priceToSales },
    margins: c.quarterMargins ?? [],
    momentum: { from: MOMENTUM_FROM, to: LAST_CLOSE, changePct: market.changePct },
  };
  delete c.preparedAnalysis;
  const prepared = prepareComparisonAnalysis(c, now);
  if (!prepared) throw Error(`${c.ticker}: no analysis at the sample moment`);
  appendMarketItems(prepared, c.twelveData, q.end, q.unit, now);
  prepared.processingMs = 0.3;
  c.preparedAnalysis = prepared;
  return c;
}

/** The whole sample file, by name. Theme Ranking (already dated 2035-03-09) and the portfolio (made up by hand) are not changed here. */
export function fictionalize(name, file) {
  if (file.fictional) return file;
  const shifted = shiftDates(file);
  const out = { _source: "", fictional: true, ...shifted };
  out._source = `${file._source}. ${FICTIONAL_NOTE}`;
  if ("snapshotAt" in out) out.snapshotAt = SAMPLE_NOW;
  if (name === "compare.json") {
    out._source = `${file._source.replace(/; no Twelve Data, so valuation and momentum are not scored$/, "")}. ${FICTIONAL_NOTE} Forward P/E, the three-month price change and Arm's quarterly margins and free cash flow are made up (scripts/pro-experience/fictional-samples.mjs MARKET, ARM_FILL) and scored by the real scorecard.`;
    out.companies = Object.fromEntries(Object.entries(out.companies).map(([ticker, company]) => [ticker, fillCompany(company)]));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL("../../lib/research/pro-experience-samples/", import.meta.url);
  for (const name of ["compare.json", "relation-map-nvda.json", "watch22.json"]) {
    const path = new URL(name, dir), file = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, `${JSON.stringify(fictionalize(name, file), null, 1)}\n`);
  }
}

/** Financial Radar: one genre (semiconductors, the radar's own six tickers) with made-up latest and previous earnings, so the PRO
 * 体力ランキング shows six ranked companies with every figure filled (owner, Nov 16: 「1つのジャンルで5〜6社を体力ランキングに入れて」).
 * buildRadar (the real code) turns them into the dots, the scores and the order. Revenue in million USD; margins and growth in percent. */
const snap = (end, basis, revenue, ocfMargin, fcfMargin, cover, revenueGrowth) => ({ end, basis, revenue, ocfMargin, fcfMargin, cover, revenueGrowth });
export const RADAR_SEMIS = {
  NVDA: { latest: snap("2034-10-26", "ttm", 408_000, 52.4, 49.1, 3.6, 68.2), previous: snap("2034-07-27", "ttm", 352_000, 54.0, 50.6, 3.1, 79.5) },
  AMD: { latest: snap("2034-12-27", "annual", 44_200, 21.5, 17.8, 1.9, 34.6), previous: snap("2034-09-27", "ttm", 40_100, 19.8, 15.9, 1.7, 30.2) },
  INTC: { latest: snap("2034-12-27", "annual", 56_800, 18.2, -6.4, 0.78, 4.1), previous: snap("2034-09-27", "ttm", 55_900, 15.6, -9.8, 0.71, 2.2) },
  QCOM: { latest: snap("2034-12-24", "ttm", 46_900, 31.8, 28.9, 1.45, 9.3), previous: snap("2034-09-24", "annual", 45_300, 33.0, 30.1, 1.38, 8.1) },
  AMAT: { latest: snap("2034-10-26", "annual", 31_400, 29.6, 25.1, 1.62, 7.8), previous: snap("2034-07-27", "ttm", 30_700, 27.9, 23.6, 1.70, 6.4) },
  LRCX: { latest: snap("2034-12-28", "ttm", 21_700, 33.4, 30.2, 1.35, 15.2), previous: snap("2034-09-28", "ttm", 20_600, 30.1, 27.0, 1.20, 12.9) },
};
