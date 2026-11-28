import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { buildTwelveFinancials } from "../lib/research/twelve-data-financials.ts";
import { applyValueCheck } from "../lib/research/comparison-value.ts";
import { buildComparison } from "../lib/research/comparison.ts";
import { FACTOR_IDS, PRO_CHECK_PAIRS, cardTraits, invalidNumbers, proCheckAuthorized, summarizeComparison, summarizeCompany } from "../lib/research/pro-check.ts";

const now = Date.parse("2026-10-04T10:00:00Z"), at = new Date(now).toISOString();
const SECRET = "s".repeat(40);
function bundle(ticker) {
  const periods = ["2026-08-31", "2026-05-31", "2026-02-28", "2025-11-30", "2025-08-31"];
  return { ticker, retrievedAt: at, accountingBasis: "us-gaap",
    income: { meta: { symbol: ticker, currency: "USD", period: "Quarterly" }, income_statement: periods.map((fiscal_date, i) => ({ fiscal_date, quarter: [4, 3, 2, 1, 4][i], year: i < 4 ? 2026 : 2025, sales: i === 4 ? 100 : 120, operating_income: i === 4 ? 20 : 24, eps_diluted: 2 })) },
    cashFlow: { meta: { symbol: ticker, currency: "USD", period: "Quarterly" }, cash_flow: [{ fiscal_date: periods[0], quarter: 4, year: 2026, operating_activities: { operating_cash_flow: 30 }, investing_activities: { capital_expenditures: -12 } }] },
    statistics: { retrievedAt: at, payload: { meta: { symbol: ticker, currency: "USD" }, statistics: { valuations_metrics: { forward_pe: 20, trailing_pe: 24 }, financials: { most_recent_quarter: periods[0], income_statement: { diluted_eps_ttm: 5 }, balance_sheet: { current_ratio_mrq: 2, total_cash_mrq: 100, total_debt_mrq: 50 } } } } },
    series: { retrievedAt: at, adjust: "splits", payload: { meta: { symbol: ticker, currency: "USD", interval: "1day" }, values: [{ datetime: "2026-10-02", close: "120" }, { datetime: "2026-07-03", close: "100" }] } } };
}
const figure = score => ({ score, exact: score, pe: score, ps: score, peNow: 20, psNow: 4, basis: "pe-ps", period: null, asOf: "2026-10-02" });
const company = ticker => ({ ...buildTwelveFinancials(bundle(ticker), now), ticker, name: `Example ${ticker}`, peer: "example", caution: { ja: "", en: "" } });
const pair = (values = { AAA: figure(20), BBB: figure(-40) }) => applyValueCheck([company("AAA"), company("BBB")], { values }, now);

test("the fixed pairs are the six large-cap pairs HQ asked for, and the seven factors are the scorecard's", () => {
  assert.deepEqual(PRO_CHECK_PAIRS.map(p => p.join("/")), ["BRK-B/ORCL", "NVDA/AMD", "JPM/GS", "PG/KO", "MET/PRU", "AAPL/MSFT"]);
  assert.deepEqual([...FACTOR_IDS].sort(), ["cash", "financial", "growth", "momentum", "profitability", "stability", "valuation"]);
});

test("a complete comparison: every factor present, the card's strengths and weaknesses, no invalid figure", () => {
  const result = summarizeComparison(buildComparison(pair(), now), now);
  assert.equal(result.ok, true); assert.deepEqual(result.tickers, ["AAA", "BBB"]); assert.equal(typeof result.comparable, "boolean");
  for (const c of result.companies) {
    assert.deepEqual(c.factors.missing, [], c.ticker); assert.equal(c.factors.present.length, 7);
    assert.deepEqual(c.invalid, [], c.ticker); assert.equal(c.status, "ready");
    for (const line of [...c.strengths, ...c.weaknesses]) assert.ok(line.id && line.ja && line.en);
    assert.ok(c.strengths.length <= 4 && c.weaknesses.length <= 4);
  }
  const [a, b] = result.companies;
  assert.equal(a.strengths.length, 4, "the card shows at most four strengths; the fifth (valuation) is cut there too");
  assert.ok(b.weaknesses.some(l => l.id === "valuation"), "40% above its average is a weakness");
  // The same bullets as the card (CompanyScoreCard) picks.
  const traits = cardTraits(pair()[0], now);
  assert.deepEqual(a.strengths.map(l => l.id), traits.strengths.map(i => i.id));
});

test("a factor without data is listed as missing, never as zero", () => {
  const [c] = applyValueCheck([company("AAA")], { values: {} }, now);
  const summary = summarizeCompany(c, now);
  assert.deepEqual(summary.factors.missing, ["valuation"]);
  assert.ok(!summary.factors.present.includes("valuation"));
});

test("invalid figures are named by field, never by value", () => {
  const [base] = pair();
  assert.deepEqual(invalidNumbers(base, now), []);
  const broken = { ...base, quarterOperatingMargin: 250, quarterFcfMargin: NaN, quarterRevenueGrowth: Infinity,
    balance: { ...base.balance, end: base.balance?.end ?? "2026-08-31", cash: { ...base.quarterRevenue, value: -5 }, debtTotal: { value: -10, source: "total" } } };
  const codes = invalidNumbers(broken, now);
  for (const code of ["absurd:quarterOperatingMargin", "nonFinite:quarterFcfMargin", "nonFinite:quarterRevenueGrowth", "negative:cash", "negative:debtTotal"])
    assert.ok(codes.includes(code), `${code} in ${codes}`);
  assert.ok(codes.every(code => !/\d{2,}/.test(code.split(":")[0])));
  assert.ok(invalidNumbers({ ...base, status: "unavailable" }, now).includes("status:unavailable"));
  assert.ok(invalidNumbers({ ...base, quarterRevenue: null }, now).includes("missing:quarterRevenue"));
  assert.ok(invalidNumbers({ ...base, quarterRevenue: { ...base.quarterRevenue, value: 0 } }, now).includes("nonPositive:quarterRevenue"));
});

test("auth: only the monitor's bearer secret, compared in constant time, and never a browser request", () => {
  const h = init => new Headers(init);
  assert.equal(proCheckAuthorized(h({}), SECRET), false);
  assert.equal(proCheckAuthorized(h({ authorization: "Bearer wrong" }), SECRET), false);
  assert.equal(proCheckAuthorized(h({ authorization: SECRET }), SECRET), false);
  assert.equal(proCheckAuthorized(h({ authorization: `Bearer ${SECRET}` }), SECRET), true);
  assert.equal(proCheckAuthorized(h({ authorization: `Bearer ${SECRET}` }), undefined), false, "unset secret: closed");
  assert.equal(proCheckAuthorized(h({ authorization: "Bearer short" }), "short"), false, "a short secret is never accepted");
  for (const browser of [{ origin: "https://techphase.app" }, { "sec-fetch-mode": "cors" }, { "sec-fetch-site": "same-origin" }])
    assert.equal(proCheckAuthorized(h({ authorization: `Bearer ${SECRET}`, ...browser }), SECRET), false, JSON.stringify(browser));
  const source = readFileSync(new URL("../lib/membership/sync-auth.ts", import.meta.url), "utf8");
  assert.match(source, /timingSafeEqual/);
});

// The route with its server module replaced by a recorder; the real authorization check.
const routeSource = readFileSync(new URL("../app/api/research/internal/pro-check/route.ts", import.meta.url), "utf8")
  .replace('import { proCheckAuthorized } from "@/lib/research/pro-check";', `import { proCheckAuthorized } from ${JSON.stringify(new URL("../lib/research/pro-check.ts", import.meta.url).href)};`)
  .replace('import { runProCheck } from "@/lib/research/pro-check-server";', "const runProCheck = async () => { globalThis.__proCheck.calls++; return globalThis.__proCheck.pairs; };");
assert.ok(!routeSource.includes("@/"), "every import replaced");
const route = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(routeSource)).toString("base64"));
const call = headers => route.GET(new Request("https://techphase.app/api/research/internal/pro-check", { headers }));

test("route: 404 with an empty body without the token or with a wrong one, before any comparison is read", async () => {
  process.env.COMPARISON_WARM_SECRET = SECRET;
  globalThis.__proCheck = { calls: 0, pairs: [] };
  for (const headers of [{}, { authorization: "Bearer wrong-wrong-wrong-wrong-wrong-wrong" }, { authorization: `Bearer ${SECRET}x` },
    { authorization: `Bearer ${SECRET}`, origin: "https://evil.example" }]) {
    const response = await call(headers);
    assert.equal(response.status, 404, JSON.stringify(headers)); assert.equal(await response.text(), "");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.equal(route[method]().status, 404, method);
  delete process.env.COMPARISON_WARM_SECRET;
  assert.equal((await call({ authorization: `Bearer ${SECRET}` })).status, 404, "no secret configured: closed");
  assert.equal(globalThis.__proCheck.calls, 0);
});

test("route: the token gets the pairs, no-store and no CORS header", async () => {
  process.env.COMPARISON_WARM_SECRET = SECRET;
  const pairs = [summarizeComparison(buildComparison(pair(), now), now), { tickers: ["JPM", "GS"], ok: false, error: "unavailable" }];
  globalThis.__proCheck = { calls: 0, pairs };
  const response = await call({ authorization: `Bearer ${SECRET}` });
  assert.equal(response.status, 200); assert.equal(globalThis.__proCheck.calls, 1);
  assert.match(response.headers.get("cache-control"), /no-store/); assert.equal(response.headers.get("access-control-allow-origin"), null);
  const body = await response.json();
  assert.equal(body.ok, true); assert.equal(typeof body.generatedAt, "string"); assert.equal(body.pairs.length, 2);
  const [first] = body.pairs;
  assert.deepEqual(Object.keys(first.companies[0]).sort(), ["factors", "invalid", "status", "strengths", "ticker", "weaknesses"]);
  assert.deepEqual(Object.keys(first.companies[0].factors).sort(), ["kinds", "missing", "present"]);
  assert.doesNotMatch(JSON.stringify(body), /user_|email|clerk|membership/i, "no member data");
  delete process.env.COMPARISON_WARM_SECRET;
});

test("the patrol (production_watch.py) expects the same pairs, factors and route as the site", () => {
  const py = readFileSync(new URL("../scripts/research/production_watch.py", import.meta.url), "utf8");
  const pairs = [...py.match(/PRO_COMPARE_PAIRS = \((.*)\)\n/)[1].matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map(m => `${m[1]}/${m[2]}`);
  assert.deepEqual(pairs, PRO_CHECK_PAIRS.map(p => p.join("/")));
  const factors = [...py.match(/PRO_FACTORS = \((.*)\)\n/)[1].matchAll(/"([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(factors, [...FACTOR_IDS]);
  assert.match(py, /\/api\/research\/internal\/pro-check/); assert.match(py, /COMPARISON_WARM_SECRET/);
});
