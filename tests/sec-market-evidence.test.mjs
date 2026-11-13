import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractFinancials } from "../lib/research/comparison.ts";
import { buildSecMarketEvidence } from "../lib/research/sec-market-evidence.ts";
import { twelveExtraFactors, twelveFactorMetric } from "../lib/research/twelve-data-factors.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const mu = () => extractFinancials("MU", "723125", JSON.parse(readFileSync(new URL("./fixtures/sec-companyfacts-MU.json", import.meta.url), "utf8")), NOW);
// 100 trading-day-ish bars ending 2026-11-12, closing 10 → 12 over the last ~3 months.
const series = (symbol = "MU", currency = "USD") => ({ adjust: "splits", retrievedAt: "2026-11-13T11:00:00Z", payload: { meta: { symbol, interval: "1day", currency }, status: "ok",
  values: [{ datetime: "2026-11-12", close: "120" }, { datetime: "2026-08-12", close: "100" }, { datetime: "2026-08-10", close: "99" }] } });
const stats = (symbol = "MU", currency = "USD", pe = "11.5") => ({ retrievedAt: "2026-11-13T09:00:00Z", payload: { meta: { symbol, currency }, statistics: { valuations_metrics: { forward_pe: pe } } } });

test("stability comes from the SEC's four quarters, momentum from the live series, valuation from the forward P/E alone", () => {
  const e = buildSecMarketEvidence(mu(), series(), stats(), NOW);
  assert.equal(e.periodEnd, "2026-09-03");
  assert.equal(e.margins.length, 4);
  assert.ok(Math.abs(e.momentum.changePct - 20) < 1e-9);
  assert.equal(e.statistics.forwardPE, 11.5);
  const f = twelveExtraFactors(e, NOW);
  assert.equal(f.valuation, 8.7);               // 11 - 11.5/5
  assert.equal(f.momentum, 7);                  // 5 + 20/10
  assert.ok(f.stability > 0 && f.stability <= 10); // four profitable quarters; the spread of margins (45% to 81%) lowers it
  assert.equal(f.financial, null);              // balance-sheet items are the SEC balance's, not the provider's
  assert.equal(twelveFactorMetric(e, "valuation", "en", NOW), "Forward P/E 11.5×");
});

test("nothing unverified is used: wrong symbol, wrong currency, no/negative P/E or no series leave the factor out", () => {
  const f = mu();
  assert.equal(buildSecMarketEvidence(f, series("NVDA"), stats("NVDA"), NOW).momentum, null);
  assert.equal(buildSecMarketEvidence(f, series(), stats("MU", "JPY"), NOW).statistics, null);
  assert.equal(buildSecMarketEvidence(f, series(), stats("MU", "USD", "-3"), NOW).statistics, null);
  assert.equal(buildSecMarketEvidence(f, undefined, undefined, NOW).momentum, null);
  assert.equal(buildSecMarketEvidence({ ...f, status: "unavailable" }, series(), stats(), NOW), null);
});

test("without four SEC quarters stability stays empty (not shortened)", () => {
  const f = { ...mu(), quarterMargins: null };
  assert.deepEqual(buildSecMarketEvidence(f, series(), stats(), NOW).margins, []);
  assert.equal(twelveExtraFactors(buildSecMarketEvidence(f, series(), stats(), NOW), NOW).stability, null);
});
