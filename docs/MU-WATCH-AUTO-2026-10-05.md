# MU earnings watch automatic update — 2026-10-05

## Flow

The independent `watch_earnings` worker reads current MU issuer release revisions
already retained in the monitor database. It does not fetch pages, call an LLM,
change news admission or use a paid-provider budget. Every five seconds it checks
for a new source/body revision. The source row, revision hash and parsed quarterly
period bind the result; older fiscal quarters cannot replace newer ones.

Each revision saves numeric facts, equivalent JA/EN cards and tiles in
`watch_earnings_versions`. Recognized optional metrics can be absent without
blocking revenue. The supported input is Micron's fiscal quarterly highlights, quarterly financial
and business-unit tables, and next-quarter outlook; it is not a universal issuer parser. Unknown
layouts remain in diagnostics. Withdrawn/currently replaced source revisions are
not served. No prior-quarter value is copied into a missing current field.

The authenticated monitor `/watch-earnings` route is read-only. The Next.js route
rechecks membership and strips paid cards before serialization for FREE,
signed-out, unavailable or expired users. Private/no-store responses prevent
shared caching. The MU page polls while visible and cancels on hiding/unmount.
The other 21 company pages are unchanged.

## Timing

- Source publication timestamp: only an exact, timezone-bearing primary-IR
  timestamp for the same URL/date, otherwise null (date alone is not midnight).
- First detected: retained discovery/release event clock.
- Body ready: retained current body revision clock.
- Prepared/public: deterministic generation clocks, persisted once per revision.
- Processing milliseconds: numeric extraction and bilingual template generation.
- View observed: local browser session's post-render callback; not a global
  first paint or a persisted historical latency claim.

Source-to-detection and detection-to-public are separate. Reprocessing an old
release is a backfill, not proof of live earnings performance.

## Limits and next work

No new source acquisition was added. Failure to retain an issuer body still
blocks this pipeline. The current adapter extracts revenue, prior-quarter/year
revenue, non-GAAP EPS, operating cash flow and revenue guidance. The v3 adapter also extracts non-GAAP gross margin and its prior-quarter
comparison, next-quarter non-GAAP gross margin guidance, and four business units.
Table column periods and units are checked separately from quarterly highlights.
Six-column GAAP/non-GAAP revenue cells must agree; rounded highlight values
are replaced only when the precise table matches within half the last digit.
Unknown optional layouts omit those fields without blocking the core snapshot.

The largest absolute segment revenue change is selected deterministically, not
hard-coded to Core Data Center. Contribution is calculated against the company
revenue change, omitted for zero/opposite-sign changes. All four units must be
present; residual revenue must be nonnegative and no more than 0.1% of company
revenue. Residuals remain in stored facts and are disclosed in the card detail.
The reviewed release has $6M current/$8M prior residuals; these are not labeled
rounding. Source table numbers are never scaled to force reconciliation.
Quarterly/annual and GAAP/non-GAAP boundaries are tested independently.

Revenue, EPS, cash flow, actual margin and guidance checks produce factual
risks, including declining segment operating margins. Visible risk bullets
are limited to two; additional checks remain in the detail. Business prose,
product stage changes and comprehensive risk analysis are not yet automated. No Twelve Data connection, consensus, buy/sell ratings or invented risks.

Validation includes annual/quarter separation, negative EPS/cash, unit conversion,
missing optional values, revised/withdrawn source bodies, older backfills,
guidance quarter rollover, timing nullability and PRO response boundaries.

Numeric-table fixture source: Micron issuer release linked by the MU page,
Quarterly Financial Results and Quarterly Business Unit Financial Results.
Fixture contains numeric rows only; it is a parser regression, not a live
release-speed measurement.
