// Strengths and weaknesses the filing itself supports, added for companies that showed none (owner, Nov 20: 「長所・短所出てない銘柄は全チェック
// して追加してください」, then 「完全にないと判断したなら無理に書かなくていいですよ」): negative shareholders' equity, and revenue against the
// previous quarter when there is no year-ago quarter. No point is made up for a company the thresholds give none.
import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials, emptyFinancials, comparisonAccess } from "../lib/research/comparison.ts";
import { prepareComparisonAnalysis } from "../lib/research/comparison-analysis.ts";
import { cautionClause } from "../lib/research/comparison-scorecard.ts";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const fact = (val, end, accn, form, filed, start) => ({ val, end, accn, form, filed, ...(start ? { start } : {}) });

// MO's 10-Q for the quarter to 2026-09-30, as companyfacts gives it (figures in USD).
const MO_Q = "0000764180-26-000114";
const q = (val, start, end) => fact(val, end, MO_Q, "10-Q", "2026-10-29", start);
const b = val => fact(val, "2026-09-30", MO_Q, "10-Q", "2026-10-29");
const moFacts = (equity = -2225e6, parentOnly = true) => ({ cik: 764180, facts: { "us-gaap": {
  RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [fact(23279e6, "2025-12-31", "0000764180-26-000017", "10-K", "2026-02-25", "2025-01-01"), q(6132e6, "2026-07-01", "2026-09-30"), q(6069e6, "2025-07-01", "2025-09-30")] } },
  OperatingIncomeLoss: { units: { USD: [q(3313e6, "2026-07-01", "2026-09-30")] } },
  NetCashProvidedByUsedInOperatingActivities: { units: { USD: [q(3050e6, "2026-07-01", "2026-09-30")] } },
  PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [q(51e6, "2026-07-01", "2026-09-30")] } },
  CashAndCashEquivalentsAtCarryingValue: { units: { USD: [b(2697e6)] } },
  AssetsCurrent: { units: { USD: [b(4798e6)] } },
  LiabilitiesCurrent: { units: { USD: [b(8290e6)] } },
  ...(equity === null ? {} : parentOnly ? { StockholdersEquity: { units: { USD: [b(equity), fact(-2668e6, "2026-06-30", "0000764180-26-000094", "10-Q", "2026-07-30")] } } }
    : { StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: { units: { USD: [b(equity)] } } }),
} } });
const jaCopy = text => { assert.doesNotMatch(text, /[)）][。、]/, text); assert.doesNotMatch(text, /\d米ドル/, text); };

test("negative shareholders' equity from the filing's own balance is a weakness (MO: -2,225 million at 2026-09-30)", () => {
  const mo = extractFinancials("MO", "764180", moFacts(), NOW);
  assert.equal(mo.balance.end, "2026-09-30");
  assert.equal(mo.balance.equity.value, -2225e6);
  const items = prepareComparisonAnalysis(mo, NOW).items;
  const equity = items.find(i => i.id === "negative-equity");
  assert.equal(equity.kind, "weakness");
  assert.deepEqual(equity.short, { ja: "株主資本がマイナス", en: "Negative shareholders' equity" });
  assert.match(equity.detail.ja, /^2026-09-30時点の株主資本は-2,225,000,000 USDで、負債が資産を上回っています。/);
  jaCopy(equity.detail.ja);
  // The total with minority interests stands in when the parent's own line is not tagged.
  assert.equal(extractFinancials("MO", "764180", moFacts(-2173e6, false), NOW).balance.equity.value, -2173e6);
  // Positive or unreported equity says nothing.
  assert.equal(prepareComparisonAnalysis(extractFinancials("MO", "764180", moFacts(1e9), NOW), NOW).items.some(i => i.id === "negative-equity"), false);
  assert.equal(extractFinancials("MO", "764180", moFacts(null), NOW).balance.equity, null);
  // Equity of another date than the period shown says nothing either.
  const other = { ...mo, balance: { ...mo.balance, equity: { ...mo.balance.equity, end: "2026-06-30" } } };
  assert.equal(prepareComparisonAnalysis(other, NOW).items.some(i => i.id === "negative-equity"), false);
  assert.equal(cautionClause(equity, "ja"), "株主資本がマイナスです");
});

// A company card as the comparison builds it: filing figures in USD for a quarter to 2026-09-30.
function company(change = {}) {
  const f = { rev: 1000e6, prev: 950e6, op: 200e6, fcf: 12, shares: 0.5, cash: 400e6, ca: 600e6, cl: 1000e6, debt: 300e6, qoq: null, ...change };
  const factOf = (value, end = "2026-09-30", start = "2026-07-01") => value === null ? null : ({ value, unit: "USD", start, end, filed: "2026-10-30", accession: "0000000001-26-000001", tag: "Revenues", basis: "us-gaap" });
  return { ...emptyFinancials("TEST", "unavailable", new Date(NOW).toISOString()), status: "ready",
    quarterRevenue: factOf(f.rev), previousQuarterRevenue: factOf(f.prev, "2025-09-30", "2025-07-01"), quarterOperatingIncome: f.op === null ? null : { ...factOf(f.op), tag: "OperatingIncomeLoss" },
    quarterRevenueGrowth: f.prev === null ? null : (f.rev / f.prev - 1) * 100, quarterRevenueQoq: f.qoq, quarterOperatingMargin: f.op === null ? null : f.op / f.rev * 100,
    quarterFcfMargin: f.fcf, quarterDilutedSharesGrowth: f.shares, quarterSourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/0000000001-26-000001-index.htm", dataWarnings: [],
    balance: f.cash === null ? null : { end: "2026-09-30", filed: "2026-10-30", sourceUrl: "https://www.sec.gov/", cash: { ...factOf(f.cash), start: null }, currentAssets: { ...factOf(f.ca), start: null },
      currentLiabilities: { ...factOf(f.cl), start: null }, currentRatio: f.ca / f.cl, debtCurrent: null, debtNoncurrent: null, shortBorrowings: null, leaseCurrent: null, leaseNoncurrent: null,
      debtTotal: { value: f.debt, source: "total" } } };
}
const card = c => ({ ...c, preparedAnalysis: prepareComparisonAnalysis(c, NOW) });
const of = (c, kind) => c.preparedAnalysis.items.filter(i => i.kind === kind);

test("a company the thresholds give no weakness keeps none: nothing is made up", () => {
  // Growth +5.3%, margin 20%, FCF 12% (strengths); financial strength 6.5 (current ratio 0.6, cash above debt): no weakness, none invented.
  const c = card(company());
  assert.deepEqual(of(c, "strength").map(i => i.short.ja), ["売上成長 +5.3%", "営業利益率 20.0%", "簡易FCF率 12.0%"]);
  assert.deepEqual(of(c, "weakness"), []);
});

test("no revenue a year earlier: revenue against the previous quarter is the growth point, as the growth score uses it", () => {
  const c = card(company({ prev: null, qoq: -8.4 }));
  const item = c.preparedAnalysis.items.find(i => i.id === "revenue-qoq");
  assert.equal(item.kind, "weakness");
  assert.deepEqual(item.short, { ja: "売上前四半期比 -8.4%", en: "Revenue -8.4% QoQ" });
  jaCopy(item.detail.ja);
  assert.equal(cautionClause(item, "ja"), "売上が前の四半期より8.4%減っています");
  // With a year-ago quarter the year-on-year point stands alone.
  assert.equal(card(company({ qoq: -8.4 })).preparedAnalysis.items.some(i => i.id === "revenue-qoq"), false);
});

test("the owner accounts keep the comparison", () => {
  for (const id of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) assert.equal(comparisonAccess({ status: "signed-in", plan: "free", userId: id, ownerAccount: true }, NOW), 200);
});
