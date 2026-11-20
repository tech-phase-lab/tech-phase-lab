// Every company with prepared points shows a strength and a weakness (owner, Nov 20: 「長所・短所出てない銘柄は全チェックして追加してください」).
// First the points the filing itself supports (negative shareholders' equity, revenue against the previous quarter), then, only when the
// thresholds still give no weakness (strength), the company's own lowest (highest) scored factor, said to be relative, with its real figure.
import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials, emptyFinancials, comparisonAccess } from "../lib/research/comparison.ts";
import { prepareComparisonAnalysis } from "../lib/research/comparison-analysis.ts";
import { comparisonScores, comparisonMetric, withRelativeItems, overallComparison, cautionClause } from "../lib/research/comparison-scorecard.ts";
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
const card = c => { const prepared = prepareComparisonAnalysis(c, NOW); return withRelativeItems({ ...c, preparedAnalysis: prepared }, NOW); };
const of = (c, kind) => c.preparedAnalysis.items.filter(i => i.kind === kind);

test("no threshold weakness: the lowest scored factor that is not a strength becomes a relative weakness with its own figure", () => {
  // Growth +5.3% (strength), margin 20% (strength), FCF 12% (strength); financial strength 6.5 (current ratio 0.6, cash above debt): no weakness.
  const c = card(company());
  assert.deepEqual(of(c, "strength").map(i => i.short.ja), ["売上成長 +5.3%", "営業利益率 20.0%", "簡易FCF率 12.0%"]);
  const [weak] = of(c, "weakness");
  assert.equal(weak.relative, true);
  assert.equal(weak.id, "relative-financial");
  assert.equal(weak.short.ja, `財務健全性は他の項目より低め（${comparisonMetric(c, "financial", "ja", NOW)}）`);
  assert.equal(weak.short.ja, "財務健全性は他の項目より低め（流動比率 0.60倍）");
  assert.equal(weak.short.en, "Financial strength is its weakest area: current ratio 0.60×");
  assert.match(weak.detail.ja, /^財務健全性は10点中\d+\.\d点で、この会社のほかの採点項目より低い水準です。/);
  for (const text of [weak.short.ja, weak.detail.ja]) jaCopy(text);
  assert.doesNotMatch(weak.short.en + weak.detail.en, /[ぁ-んァ-ン一-龥]/);
  // The same call again changes nothing (an earlier relative point is replaced, never added twice).
  assert.deepEqual(withRelativeItems(c, NOW).preparedAnalysis.items, c.preparedAnalysis.items);
  // A threshold weakness, when there is one, leaves no relative point: a 30% fall in revenue.
  const falling = card(company({ prev: 1430e6 }));
  assert.deepEqual(of(falling, "weakness").map(i => i.id), ["revenue-growth"]);
});

test("no threshold strength: the highest scored factor that is not a weakness becomes a relative strength", () => {
  // Revenue -2% (weakness), margin 5% (no point), FCF -3% (weakness), financial 6.5 (no point): profitability 1.0 and financial 6.5 are left.
  const c = card(company({ prev: 1020.4e6, op: 50e6, fcf: -3 }));
  const [strong] = of(c, "strength");
  assert.equal(strong.relative, true);
  assert.equal(strong.id, "relative-financial");
  assert.equal(strong.short.ja, "財務健全性は他の項目より高め（流動比率 0.60倍）");
  assert.equal(strong.short.en, "Financial strength is its strongest area: current ratio 0.60×");
  assert.ok(of(c, "weakness").every(i => !i.relative));
});

test("only one scored factor, or no factor that is not already a strength: nothing is invented", () => {
  // Growth alone (no operating income, no cash flow, no balance): one factor, its revenue growth is a strength, no weakness is made up.
  const alone = card(company({ op: null, fcf: null, cash: null }));
  assert.deepEqual(comparisonScores(alone, NOW).filter(s => s.value !== null).map(s => s.id), ["growth"]);
  assert.deepEqual(of(alone, "weakness"), []);
  // Two factors, both already strengths: no candidate for a weakness.
  const strong = card(company({ cash: null, fcf: null }));
  assert.deepEqual(of(strong, "weakness"), []);
});

test("a reviewed (reference) analysis or a company without prepared points is left as it is", () => {
  const c = card(company());
  const reviewed = { ...c, preparedAnalysis: { ...c.preparedAnalysis, method: "reviewed", items: c.preparedAnalysis.items.filter(i => !i.relative) } };
  assert.equal(withRelativeItems(reviewed, NOW), reviewed);
  const none = { ...company(), preparedAnalysis: undefined };
  assert.equal(withRelativeItems(none, NOW), none);
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

test("the comparison's caution prefers a threshold weakness; a relative one only when no company has a threshold weakness", () => {
  const named = (c, ticker) => ({ ...c, ticker, name: ticker, peer: ticker, caution: { ja: "", en: "" } });
  // AAA leads clearly; BBB has only a relative weakness, AAA a threshold one (debt above cash).
  const aaa = named(card(company({ rev: 1300e6, op: 400e6, fcf: 30, debt: 500e6 })), "AAA");
  const bbb = named(card(company()), "BBB");
  assert.ok(of(aaa, "weakness").every(i => !i.relative));
  assert.ok(of(bbb, "weakness").every(i => i.relative));
  const genuine = overallComparison([aaa, bbb], "ja", NOW);
  assert.equal(genuine.leader, "AAA");
  assert.match(genuine.description, /有利子負債が現金を上回っています/);
  assert.doesNotMatch(genuine.description, /他の項目より低め/);
  // Neither has a threshold weakness: the relative one is said, in plain words with its figure, without 「）。」.
  const ccc = named(card(company({ rev: 1300e6, op: 400e6, fcf: 30 })), "CCC");
  assert.ok(of(ccc, "weakness").every(i => i.relative));
  const relative = overallComparison([ccc, bbb], "ja", NOW);
  assert.match(relative.description, /財務健全性|財務の余力/);
  assert.match(relative.description, /流動比率 0\.60倍と他の項目より低めです。/);
  jaCopy(relative.description);
  const en = overallComparison([ccc, bbb], "en", NOW);
  assert.match(en.description, /weakest area is financial strength: current ratio 0\.60×/);
});

test("the owner accounts keep the comparison", () => {
  for (const id of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) assert.equal(comparisonAccess({ status: "signed-in", plan: "free", userId: id, ownerAccount: true }, NOW), 200);
});
