# Prepared comparison analysis

Implemented on the research preview branch, 2026-10-04 JST.

- Financial cache refresh now builds short JA/EN points and supporting details together, and stores them in the same Next.js Data Cache value as the financials.
- Reads reuse this payload. The browser does not invoke an LLM, translate, or regenerate company highlights.
- Each payload records its method (`deterministic`), preparation timestamp, local preparation duration in milliseconds, quarter end, filing URL, and SHA-256 evidence revision.
- The revision covers the ticker, source figures, derived metrics, currency/period/accession metadata and freshness warnings. Changed or expired evidence invalidates saved points. Missing metrics remain missing.
- The API still enforces PRO authorization before fetching any comparison data and rechecks entitlement expiry before returning it. Public market facts may be shared in the server cache; authenticated responses remain private/no-store.
- The new collapsed evidence section appears below the comparison snapshot when prepared points exist. It cites quarterly figures; no business-strategy claims or market forecasts are generated.

## Exact operational boundary

The existing `unstable_cache` revalidation interval is 300 seconds. This is request-triggered revalidation, **not an independent five-minute polling job**. The first cache miss still fetches SEC data and may take seconds. A request after expiry may receive the prior cache value while refresh runs. If revalidation fails, the platform may retain older cache data; the existing 180-day quarter eligibility is not a guarantee of the newest filing.

This change does not provide universal background collection, an earnings-publication event trigger, or complete latest-quarter coverage. In particular it does not repair MU/SNDK missing quarterly inputs. It does not add paid providers, change translation budgets, touch news monitoring, or manufacture valuation/PEG data.

A separate authorized upstream update trigger or scheduled financial worker is needed to keep analyses warm before the first viewer. Until that is connected and acquisition-to-publication times are measured, do not claim instant current results or full ticker coverage.

## Validation

Tests cover bilingual amounts and signs, all-negative inputs, missing/old/future/superseded quarters, corrected evidence, and repeated reads/refreshes through the actual server-loader code with a deterministic cache test double. Cache tests verify reuse semantics, not production latency or provider uptime.
