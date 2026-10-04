# Twelve Data comparison preparation — 2026-10-04

Status: offline ingestion, seven-factor scoring, production display adapter and cache implemented; **no live Twelve Data
request, subscription change, or comparison-route activation**. Existing comparison
UI, SEC loader, authorization and news paths are unchanged.

## Implemented

- Standard `income_statement` / `cash_flow` quarterly responses become a typed,
  per-symbol snapshot. Validate symbol, quarterly period, currency and fiscal date.
- Keep fiscal period end and retrieval time separately. Release date stays `null`
  because these statement responses do not establish it. Never label fiscal_date
  as an earnings announcement or invent a quarter start.
- Select the latest quarter even if it has missing figures; compare revenue with
  the same fiscal quarter a year earlier. Never substitute a sequential quarter.
- Null/blank/invalid values remain missing. Conflicting duplicate values do not
  become valid figures. Signed operating losses remain negative.
- FCF is calculated as operating cash flow plus signed negative capex, for the same
  quarter/currency. Do not trust a contradictory provider free_cash_flow field.
  Positive capex requires verification rather than silently taking its absolute value.
- PER utility requires positive EPS and price, matching currency and explicitly
  verified share basis. Losses/zero EPS are not meaningful PER, not cheap stocks.
  Forward and TTM are separate inputs. Quarterly EPS is never annualized implicitly.
- Generate short JA/EN points deterministically (no LLM call) with period-specific
  detail; cache by ticker and evidence hash. New retrieval timestamps do not
  regenerate unchanged copy; corrected facts produce a different cache entry.

The server preparation entry point is `prepareTwelveComparisonPayload`. It accepts
already-fetched response objects; it is not a public endpoint. Cache lifetime is
one day for prepared text only, **not** a one-day financial-data polling interval.
The existing SEC loader remains active. `prepareTwelveComparisonForDisplay` now
returns the same Financials contract used by the production comparison screen,
including bilingual points and scores. The live comparison route has not yet been
switched to a Twelve Data collector. No synthetic data is shown to subscribers.

## Remaining activation work

1. With the authorized plan/key, obtain real responses for MU, SNDK, TSM, AAOI,
   POET, LITE and COHR. Confirm entitlement, periods, native currency and ADR/split
   handling. Current tests use synthetic fixtures, not evidence of live coverage.
2. Add the licensed background collector and persistent raw/latest snapshot store,
   with shared credit/rate limits, timeout/retry policy and per-symbol in-flight
   deduplication. Do not fetch full statements independently for every comparison.
   Framework preparation caching alone is not a durable audit store or scheduler.
3. Verify actual statistics/time_series responses against the documented schemas
   now mapped. Balance-sheet/quote/earnings mapping remains outstanding. Prices and
   forecasts need independent timestamps, units and share basis.
   Do not assume Entry Venture includes every endpoint from a public symbol page.
4. Connect the licensed collector to `prepareTwelveComparisonForDisplay` and the
   route. The Financials bridge now preserves unknown filing/release dates as null,
   and the screen labels the source Twelve Data rather than SEC. Financials from
   unknown accounting standards use a provider-standardized label, not US GAAP.
   Check known newer releases before describing the received quarter as “latest.”
5. Test real API → stored snapshot → JA/EN comparison → browser, including
   three-company comparisons. Record actual latency and costs. Schema fixtures and
   server-rendered production components pass, but do not establish live coverage.

## Seven-factor reference model (version 1)

The radar, bars and leader highlights share `comparisonScores`. These are explicit
reference bands, not trained investment forecasts or peer percentiles. Missing
values remain null. A full composite is not produced from incomplete factors.

| Factor | Input | Scale |
| --- | --- | --- |
| Growth | latest-quarter revenue YoY | 5 + growth percentage / 10 |
| Profitability | latest-quarter operating margin | margin percentage / 5 |
| Cash | same-quarter simple FCF margin | 5 + margin percentage / 5 |
| Financial | statistics for matching most_recent_quarter | up to 5 at current ratio 2, plus up to 5 at cash/total debt 1 |
| Valuation | positive provider forward_pe | 11 − forward P/E / 5 |
| Stability | four complete consecutive quarterly operating margins | profitable fraction × (5 + 5 × max(0, 1 − margin standard deviation / 20)) |
| Momentum | split-adjusted completed daily closes roughly 90 days apart | 5 + price return percentage / 10 |

All scores are clamped to 0–10 and rounded to one decimal. The prior-quarter
start date is never invented. Unknown debt is not zero. Positive forward P/E can
coexist with current losses (future estimates), but it never substitutes trailing
P/E or claims the business is currently profitable. The valuation scale does not
normalize cyclical peak earnings; that limitation is shown in the collapsed method.

Statistics retrieval time expires after 36 hours; it is not mislabelled as the
provider's update date. Momentum requires a completed close within seven calendar
days and split-adjustment provenance. Incomplete current-day candles are excluded.
Cached copy loses expired market-factor bullets when read; quarter-based factors
can remain usable. Each card shows up to four points per side; all prepared points
remain in the evidence disclosure. The existing compact layout is preserved.

Official schema reference: https://twelvedata.com/docs (standard financial statements).
No live speed, freshness, licensing or complete-symbol coverage is claimed here.

## Comparison presentation update (2026-10-04)

- Company identity colors are coral, mint and blue; gold is reserved for factor leaders.
- The sample and non-trial production view share the seven-factor overall assessment and score-method disclosure. Overall is an equal-weight average, requires all seven factors for every comparable company, and treats a gap below 0.3 as close. It is not a return forecast.
- Evidence-based weaknesses now include sequential operating-margin contraction, debt exceeding cash, and negative three-month price return. These do not imply an unverified cause or liquidity crisis. The fictitious sample includes such weaknesses; no insider or geopolitical claims are fabricated.
- Insider transactions, geographic exposure and litigation still require separate sourced data; this implementation does not claim to collect them.
- The sample remains visibly identified as fictional at its top. Its scoring disclosure is the production disclosure, without sample-specific filler.
