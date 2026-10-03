# Comparison acceptance — 2026-10-03

## Evidence and scope

- Read-only SEC companyfacts/submissions and original filings; 22 configured companies plus SIMO, AAOI, POET, QUIK and CAN (27 total).
- 26 companies yielded annual figures; 19 yielded standalone quarterly figures. This is extraction coverage, not a claim that every published earnings release is reflected.
- All coverage calls use one CIK per ticker and preserve filing, period and reporting currency. Only TSM annual/quarterly and BE total-revenue handling have exact-source regression excerpts in this change. Other rows are not a complete numeric audit.
- SEC aggregate financials can lag original filings: TSM annual revenue stopped at 2024 in companyfacts, while the original 2025 20-F and 2026 Q2 statements are available.
- Non-financial 8-K dates are not quarterly report dates. New Item 2.02 releases newer than extracted figures are explicitly flagged; old data cannot receive a quarterly score while that remains unresolved.

## Extraction coverage

| Ticker | Annual end | Quarter end | Currency | Missing / unverified |
|---|---|---|---|---|
| AAOI | 2025-12-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |
| AMD | 2025-12-27 | 2026-06-27 | USD | No extraction warning; latest earnings not independently certified |
| ANET | 2025-12-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |
| ARM | 2026-03-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |
| ASML | 2025-12-31 | — | EUR | Quarterly figures after the annual report are unavailable. |
| AVGO | 2025-11-02 | 2026-08-02 | USD | No extraction warning; latest earnings not independently certified |
| BE | 2025-12-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |
| CAN | 2025-12-31 | — | USD | Quarterly figures after the annual report are unavailable. |
| CRDO | 2026-05-02 | 2026-08-01 | USD | No extraction warning; latest earnings not independently certified |
| CRWV | 2025-12-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |
| DELL | 2026-01-30 | 2026-07-31 | USD | No extraction warning; latest earnings not independently certified |
| GEV | 2025-12-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |
| GOOGL | 2025-12-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |
| MRVL | 2026-01-31 | 2026-08-01 | USD | No extraction warning; latest earnings not independently certified |
| MSFT | 2026-06-30 | — | USD | No extraction warning; latest earnings not independently certified |
| MU | 2025-08-28 | 2026-05-28 | USD | Figures from the newer earnings release on 2026-09-30 are not verified. |
| NBIS | 2025-12-31 | — | USD | Figures from the annual filing for 2025-12-31 are unavailable.; Quarterly figures after the annual report are unavailable. |
| NVDA | 2026-01-25 | 2026-07-26 | USD | No extraction warning; latest earnings not independently certified |
| ORCL | 2026-05-31 | 2026-08-31 | USD | No extraction warning; latest earnings not independently certified |
| PLTR | 2025-12-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |
| POET | 2025-12-31 | — | USD | Quarterly figures after the annual report are unavailable. |
| QUIK | 2025-12-28 | 2026-06-28 | USD | No extraction warning; latest earnings not independently certified |
| SIMO | 2025-12-31 | — | USD | Quarterly figures after the annual report are unavailable. |
| SKHY | — | — | — | No qualifying annual statements |
| SNDK | 2026-07-03 | — | USD | No extraction warning; latest earnings not independently certified |
| TSM | 2025-12-31 | 2026-06-30 | TWD | No extraction warning; latest earnings not independently certified |
| VRT | 2025-12-31 | 2026-06-30 | USD | No extraction warning; latest earnings not independently certified |

## Implemented

- Compare SEC filing metadata with extracted periods; read original inline XBRL if aggregate facts lack a new annual/quarterly filing.
- Accept standard 40-F annual and directly reported standalone 6-K/8-K quarter facts; reject YTD, segments, wrong CIKs, per-share units, unknown transforms and currency conflicts.
- TSM 2025 revenue TWD 3,809,054,300,000; operating profit TWD 1,936,091,700,000.
- TSM reviewed Q2 2026 revenue TWD 1,270,380,250,000; prior-year quarter TWD 933,791,869,000; operating profit TWD 766,602,651,000. The August 14 statements supersede July 16 rounded release values.
- BE consolidated income statement establishes total revenue (including financing revenue), rather than treating customer-contract revenue as the total.
- Compare view: concise quarterly takeaway, strengths/weaknesses, seven horizontal reference-score bars, methodology and detailed figures folded by default.
- No annual substitutes in quarterly scores. PER/PEG valuation is unavailable while price and forecast feeds are unconnected. Reference-score scales are heuristic, not industry-adjusted ratings or investment advice.

## Still required before claiming launch readiness

- A commercially permitted feed for current quotes, latest reported quarterly financials, ADR/share basis, and timestamped analyst EPS estimates. No provider credentials or commercial display permissions were added by this change.
- Full latest-quarter coverage for NBIS, ASML, SIMO, POET, CAN and SKHY; standalone fourth-quarter extraction where annual figures are all that have been obtained.
- Newest earnings releases before their 10-Q filings, including MU where the September 30 Item 2.02 release is newer than extracted June filing data.
- PER/PEG calculation must distinguish trailing/forward EPS, fiscal horizon, negative earnings, estimate freshness and ADR ratios; no proxy using realized revenue growth.
- Generic small/micro-cap coverage and bank/REIT/ETF-specific metrics cannot be inferred from this 27-company run.
- Vendor update latency, numeric quality and missing estimates must be tested on actual current responses.

## Reference layout (latest request)
- Company overview table; individual factor score / industry average / industry rank tables; gold horizontal bars and radar points; concise strengths and weaknesses.
- Seven factors: financial strength, profitability, valuation, stability, price momentum, growth and cash generation. Valuation/stability/momentum remain unknown until required quote/estimate/history inputs are available.
- Industry universe and classification are not connected. Average and rank are unknown, never inferred from the compared 2–3 companies. No third-party rating or industry classification is copied.
- Overall rating is unknown whenever any factor is unknown. Radar plots omit missing factors and do not join an incomplete polygon. These absolute reference scales are not industry percentiles.
