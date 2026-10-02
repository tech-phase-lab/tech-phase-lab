# New-information acceptance observation

Owner instruction, October 2 11:55 JST: acceptance requires a full day of newly
published information arriving promptly, correct Japanese and English, no missed
eligible news, and no errors. Repeated retrieval of old stories is not evidence
of acceptance. The owner makes the acceptance decision from measured results.

Owner correction, October 2 12:24 JST: the interval recorded as `windowStart`
through `windowEnd` in `NEWS-ACCEPTANCE-2026-10-02-baseline.json` is diagnostic
only because two known source failures were active at its start. It cannot be
used for an acceptance decision. The baseline is a point-in-time public health
response, not a completed audit.

The repaired observation window began at **2026-10-02 04:00:13.253461 UTC**
(13:00:13.253461 JST) and ends at **2026-10-03 04:00:13.253461 UTC**
(13:00:13.253461 JST). This is an in-progress observation window, not an
acceptance result. Its start was recorded only after commit `871c4d7` was live
on Vercel preview and Railway staging, both repaired routes had completed real
article retrieval, and several normal PR Newswire listing cycles had succeeded.
Any relevant failure during this interval invalidates a clean-window claim and
must remain in the evidence.
Use first source publication and first detection times. Keep updates/revisions
separate. Do not count old backfills, reruns or duplicate URLs as new successes.

## Evidence to collect

- For every eligible new story, retain source URL/ID/revision, source publication
  time, first detection, Japanese and English ready times, backend publication,
  and actual frontend observation when available. Translation completion is not
  proof of frontend delivery. Do not substitute a poll time for first publication.
- Report per-story durations and sample counts, median, p95 and maximum; list
  every delayed or unpublished story. No seconds-level SLA is established.
  A source without an exact publication clock is unmeasurable for that segment.
- Compare originals against both published languages: entity/metric association,
  sign, digits, decimal, magnitude, currency, period, actual versus forecast,
  increase versus decrease, proposed versus completed, uncertainty and negation.
  Automated validation passing is not proof that all wording is accurate.
- Independently reconcile eligible posts/releases from each configured source
  with ingested events and public stories. Ingested counts alone cannot reveal
  misses. Record unavailable source inventories as unverified, never zero misses.
- Include recoverable errors, retries, timeouts, budget/rate exhaustion, restarts,
  queue backlog, duplicate publication, stale translations and UI omissions.
  A healthy ending does not erase earlier failures. Rolling 24-hour counters
  cannot be subtracted as if cumulative; use timestamped records and snapshots.

## Scope and continuation

Use the currently approved official sources, news and price-target X accounts;
The Fly is excluded. TrendSpider is only index membership/rebalancing; Barchart
only government bonds/yields and crude oil. Preserve the source inventory and
record changes. Disabled Marvell blog and TSMC press-center are not recovered
coverage; compare available alternate official sources and disclose gaps.

The existing hourly Tech Phase task takes interim observations. At the end,
produce a Japanese report of checked, failed and unverified items, with source
and time evidence. If there are no new events for a category, it is untested.
If a fix changes the relevant pipeline, record its commit/time and distinguish
the pre-fix failure; do not retroactively call the window clean. Resume a full
clean window for any acceptance claim affected by that failure.

Do not overwrite or reinterpret the diagnostic interval after a repair. Record
the repair commit and its historical failures, then put the exact new continuous
24-hour start and end in both this document and the baseline JSON. Until those
fields are present, scheduled reports must say that no valid acceptance window
has started.

## Repaired-window start evidence

- Repair commit: `871c4d77bd79ef3247d8251bc4b09e148dd59a00`.
- Vercel deployment `dpl_BmCN6dksRQRcQrTddo113QADxYsJ` and Railway deployment
  `26cedbf0-4a57-45d6-95f0-73553c1c90e5` both completed successfully. The
  Railway worker started at 2026-10-02 03:54:43.999 UTC.
- Sandisk completed 15 of 15 bounded newsroom article bodies with zero child
  errors (107,631 stored characters). This followed the preserved timeout
  recovery at 03:42:10.107 UTC after 58 measured attempts.
- PR Newswire used its official All News Releases HTML index rather than the
  unstable RSS representation. At 03:59:41.390 UTC it had completed 28 of 28
  discovered article bodies with zero errors or pending children. Route checks
  advanced normally after deployment and no PR Newswire failure transition was
  recorded after the 03:54:43.999 UTC worker start.
- The sanitized public snapshot immediately before the start was ready with
  24/24 routes fresh, zero route errors, zero article errors, zero pending route
  retries, and a 04:00:07.274 UTC last cycle. These aggregate values do not prove
  translation accuracy, frontend delivery, source completeness, or a clean day.
- Publication-to-detection counters in that snapshot covered seven older events
  and therefore are not repaired-window results. New eligible items must be
  measured individually from this start; zero arrivals remain untested.

## Access and stored evidence

- Repo: `tech-phase-lab/tech-phase-lab`, `codex/research-preview` only.
- Public aggregate health:
  `https://research-monitor-staging-research-staging.up.railway.app/health`.
  Translation and publication diagnostics are nested under `signalIntake`.
  This endpoint alone cannot establish misses, exact frontend delivery or
  translation correctness.
- Railway service `research-monitor-staging`, project
  `0872be15-db75-4e5a-ae0f-881911fb442d`, service
  `f6f11a91-137e-4670-ab62-bfde9706abd8`; use existing authorized console if needed.
  DB: `RESEARCH_DB_PATH` or `RESEARCH_DATA_DIR/automatic.sqlite` (currently
  `/data/automatic.sqlite`). Read-only SQLite for inspection; never print keys.
- `signal_events` preserves `observed_at` and source `published_at` per revision;
  `signal_documents.first_seen_at` records initial retrieval. Full originals are
  private: inspect for comparison, do not publish source bodies into repo/docs.
- `signal_headline_translations.created_at`, `x_market_publications.published_at`
  and `market_result_publications.published_at` support stored stage timing.
  Match source ID, URL and SHA; current document joins alone omit historical
  revisions and cannot prove the entire window error-free.
- `signal_route_transitions`, `signal_route_recoveries`,
  `signal_route_retry_attempts`, translation calls/jobs and publication jobs
  retain failure evidence. Inspect current schemas before querying.
- Save interim sanitized aggregate observations in dated repo documentation.
  Do not expose credentials, private questions, user details or raw licensed text.
  If access is unavailable, report the missing evidence and do not mark it passed.

This observation does not authorize billing changes, uncapped paid backfills,
subscriber messages or a main/production deployment. Existing preview fixes
remain authorized, with AGENTS.md checks and concurrent-work preservation.
