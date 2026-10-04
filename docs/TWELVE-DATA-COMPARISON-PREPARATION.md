# Twelve Data comparison preparation — 2026-10-04

Status: offline ingestion boundary and cache implemented; **no live Twelve Data
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
The existing SEC analysis/scoring remains active. This adapter does not yet feed
its values or scores into the comparison screen.

## Remaining activation work

1. With the authorized plan/key, obtain real responses for MU, SNDK, TSM, AAOI,
   POET, LITE and COHR. Confirm entitlement, periods, native currency and ADR/split
   handling. Current tests use synthetic fixtures, not evidence of live coverage.
2. Add the licensed background collector and persistent raw/latest snapshot store,
   with shared credit/rate limits, timeout/retry policy and per-symbol in-flight
   deduplication. Do not fetch full statements independently for every comparison.
   Framework preparation caching alone is not a durable audit store or scheduler.
3. Verify balance-sheet/statistics/quote/earnings response schemas before mapping
   them. Prices and forecasts need independent timestamps, units and share basis.
   Do not assume Entry Venture includes every endpoint from a public symbol page.
4. Connect provider-neutral snapshots to the existing Financials/scoring contract;
   preserve unknown release/filing dates and source names. Do not forge SEC
   accessions or label Twelve Data figures as SEC filings. Check known newer releases
   against the returned reporting period before calling anything “latest.”
5. Save scores alongside prepared bilingual points using a versioned scoring rule;
   recompute on evidence/rule changes and recheck freshness when serving. Current
   adapter computes financial metrics, **not seven complete investment scores**.
6. Verify real API → stored snapshot → JA/EN comparison → browser, including
   three-company comparisons and missing data. Record actual latency and costs.

Official schema reference: https://twelvedata.com/docs (standard financial statements).
No live speed, freshness, licensing or complete-symbol coverage is claimed here.
