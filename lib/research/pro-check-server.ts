import "server-only";
import { buildComparison } from "./comparison";
import { loadComparisonFinancials, resolveComparisonCompany } from "./comparison-server";
import { applyValueCheck } from "./comparison-value";
import { loadValueSnapshot } from "./value-check-server";
import { PRO_CHECK_PAIRS, summarizeComparison, type ProCheckPair } from "./pro-check";

/** The fixed pairs' real comparisons (lib/research/pro-check.ts), built the way /api/research/compare builds a member's: the same shared
 *  stores (the provider is never called from a request, comparison-server.ts), the same valuation copy, the same buildComparison. Read-only:
 *  unlike a member's read it does not ask the monitor for missing valuation figures. One pair at a time, as a member's comparison loads. */
export async function runProCheck(now = Date.now()): Promise<ProCheckPair[]> {
  const values = await loadValueSnapshot().catch(() => null);
  const pairs: ProCheckPair[] = [];
  for (const tickers of PRO_CHECK_PAIRS) {
    try {
      const selected = await Promise.all(tickers.map(resolveComparisonCompany));
      if (selected.some(c => !c)) { pairs.push({ tickers: [...tickers], ok: false, error: "unknown-company" }); continue; }
      const companies = applyValueCheck(await Promise.all(selected.map(async company => ({ ...company!, ...await loadComparisonFinancials(company!.ticker) }))), values, now);
      pairs.push(summarizeComparison(buildComparison(companies, now), now));
    } catch { pairs.push({ tickers: [...tickers], ok: false, error: "unavailable" }); }
  }
  return pairs;
}
