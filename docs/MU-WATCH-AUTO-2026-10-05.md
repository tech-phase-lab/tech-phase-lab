# MU earnings watch automatic update — 2026-10-05

## Flow

The independent `watch_earnings` worker reads current MU issuer release revisions
already retained in the monitor database. It does not fetch pages, call an LLM,
change news admission or use a paid-provider budget. Every five seconds it checks
for a new source/body revision. The source row, revision hash and parsed quarterly
period bind the result; older fiscal quarters cannot replace newer ones.

Each revision saves numeric facts, equivalent JA/EN cards and tiles in
`watch_earnings_versions`. Recognized optional metrics can be absent without
blocking revenue. The supported input is Micron's fiscal quarterly highlights
and next-quarter revenue outlook; it is not a universal issuer parser. Unknown
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
revenue, non-GAAP EPS, operating cash flow and revenue guidance. Segment analysis,
gross-margin tables and prose business risks still need additional source-bound
adapters. No Twelve Data connection, consensus, buy/sell ratings or invented risks.

Validation includes annual/quarter separation, negative EPS/cash, unit conversion,
missing optional values, revised/withdrawn source bodies, older backfills,
guidance quarter rollover, timing nullability and PRO response boundaries.
