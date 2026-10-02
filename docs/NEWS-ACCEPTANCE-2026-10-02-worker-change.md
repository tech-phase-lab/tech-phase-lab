# Publication worker isolation during the observation window

October 2, approximately 12:12 JST, before this change:
- Official headlines: 49 eligible, 49 translated, zero pending.
- Scoped market posts: one eligible, one published, zero pending.
- Active official supplemental routes: 24; 22 fresh, two errors (one timeout,
  one other). Two separately suspended routes are not recovered coverage.
- Official substantive research: three published, one pending (`invalid-copy`).
  These counts are point-in-time evidence and do not prove a clean full day.

Code review found that official-headline translation ran before scoped X-market
translation in the same worker. A slow or failed official translation could delay
the market worker. A slow market model request could also delay a newly arriving
supported index-membership post that needed no model call.

This change gives market model requests their own worker and lets the existing
five-second numerical-facts worker publish exact supported membership facts.
Both model workers retain the transaction-protected shared call budget. The
direct path rechecks source revision and existing publication under the writer
lock, retaining first publication time and invalidating obsolete model leases.
Numerical results failure is isolated from the direct membership path.

Synthetic tests hold both translation workers in-flight and verify direct work
continues; another injects a new original while a real market worker waits on a
fake provider, checks immediate bilingual publication without another paid call,
then verifies the earlier translation completes normally. Existing numerical,
sign, status and source-revision validation tests remain required.

Record deployment completion/first live process start in the next acceptance
observation. This is a pipeline change within the original 24-hour window. Keep
the original window and pre-change evidence; do not present it as 24 hours on
the new implementation or silently reset the owner's scheduled report.
No real new-source-to-browser latency has yet been measured for this change.

## Deployment observation

- Application commit: `583e80271d1998acd18cac6332d6799bab657794`.
- Vercel preview and Railway staging deployment statuses both succeeded.
- New live process `startedAt`: `2026-10-02T03:19:19.620+00:00`
  (October 2 12:19:19 JST).
- Health observed at `2026-10-02T03:19:39.224898+00:00`: ready; last completed
  cycle `03:19:33.170+00:00`; official headline translations 49/49, pending 0;
  scoped market posts 1/1, pending 0. These remain point-in-time queue counts.
- Official supplemental routes still show 22 fresh / 24 active, with one timeout
  and one `other` error. The change does not claim to repair those sources.
- Local validation passed: 201 Node tests, 561 Python tests, production build,
  lint (one pre-existing warning), compileall, and diff check.
