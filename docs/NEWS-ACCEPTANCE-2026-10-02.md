# New-information acceptance observation

## Current status — confirmed in-window price-target publication miss

At 18:41–18:46 JST the owner reported no visible updates. Read-only live
inspection confirmed that X event 1170 (ASTS / B. Riley, USD 85 → USD 65),
published 08:43:48 UTC and acquired 08:44:16.476 UTC, was omitted by the public
target parser. This is a real delivery failure despite zero current fetch
errors and empty translation queues. See `NEWS-TARGET-INCIDENT-2026-10-02.md`
for evidence, repair scope and regression coverage. Preserve this miss and
the original observation window; do not mark the interval passed after repair.

## Earlier status — publication recovered; new window observing

New acceptance observation: **2026-10-02T04:43:12.282254+00:00 → 2026-10-03T04:43:12.282254+00:00**
(UTC; JST is UTC+9). This is a new 24-hour observation, not a pass.

Code `198317bac576ceebf887eb6599bc3e1ddace7f7b` passed Actions 36965517076,
201 Node and 575 Python tests, lint, build, compileall and diff checks. Vercel
preview and Railway staging deployments succeeded. At 04:41:10.749617 UTC,
24/24 enabled official routes were fresh; route/article errors and pending
article/headline/market queues were zero. Sandisk was 15/15 and PR Newswire 34/34.
Two previously suspended sources remain outside coverage; do not count them as
successful. The full measured baseline is in `recoveredPublicationBaseline`.

Event 1119 auto-published at 04:33:03.958 UTC after retry recovery and bilingual
fidelity fixes. Both language details were observed in the actual preview UI;
brand spelling correction was confirmed at 04:41 UTC. Recovery of this old item
is not evidence that a new announcement was delivered quickly. Preserve the
previous invalid copy and retry history described in NEWS-ARTICLE-RECOVERY-2026-10-02.md.
The shared 200 calls/24h cap remains; no new paid plan or higher cap was enabled.

All earlier windows below are diagnostic history only. Measure newly published
eligible items, independently reconcile source inventories, and distinguish backend
publication timestamps from observed frontend delivery. Unobserved sources and
zero-event categories remain unverified. Report any in-window errors and repairs;
do not silently erase or restart a failed window to claim success.

Owner instruction, October 2 11:55 JST: acceptance requires a full day of newly
published information arriving promptly, correct Japanese and English, no missed
eligible news, and no errors. Repeated retrieval of old stories is not evidence
of acceptance. The owner makes the acceptance decision from measured results.

Owner correction, October 2 12:24 JST: the interval recorded as `windowStart`
through `windowEnd` in `NEWS-ACCEPTANCE-2026-10-02-baseline.json` is diagnostic
only because two known source failures were active at its start. It cannot be
used for an acceptance decision. The baseline is a point-in-time public health
response, not a completed audit.

The prior repaired-route diagnostic interval began at
**2026-10-02 04:00:13.253461 UTC** (13:00:13.253461 JST). It established that
commit `871c4d7` was live on Vercel preview and Railway staging, both repaired
routes had completed real article retrieval, and several normal PR Newswire
listing cycles had succeeded. It was superseded before acceptance by the
publication-recovery work through `198317b`; it is not the current acceptance
window and must not be combined with it. Its failures and observations remain
diagnostic evidence.
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

## Prior repaired-route diagnostic start evidence

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

### Prior diagnostic interim snapshot — 2026-10-02 04:05 UTC

- No `signal_events` row had `observed_at` at or after the window start. There
  were consequently zero new headline translations, X market publications or
  deterministic result publications to review. This is **untested**, not passed.
- Public health remained ready: 24/24 configured routes were fresh, the ordinary
  source fetch error count was zero, and article retrieval had zero errors or
  pending retries. The latest successful X check was 04:04:55.233 UTC.
- Stored transitions contained 13 X-route `failed`/`recovered` pairs after the
  start: Barchart 3, Nebius official 2, TrendSpider 3 and Wall St Engine 5. They
  match the service's intentional budget-pacing pattern, and current health
  exposed one `x-api-paced` deferral. However, `signal_route_transitions` stores
  these as generic `other` and does not retain the raw cause, so the cause of
  every historical pair cannot be independently proven from that table alone.
  These records are preserved and are not counted as upstream HTTP failures or
  new-event successes. Explicit pacing classification remains an observability
  risk to address after this finite window unless a real retrieval failure
  appears first.
- Commit `45fc182597cf8319126467cd78c7247d7a380540` saved the window start and
  evidence. Vercel reported a successful preview deployment; Railway correctly
  skipped a worker redeploy because this follow-up changed documentation only.

### Current-window interim snapshot — 2026-10-02 05:50 UTC

- The sanitized health response was ready at 05:50:04.331621 UTC. Its latest
  cycle was 05:50:07.158 UTC: 24/24 enabled official routes were fresh with
  zero route errors or pending routes; article errors and retries were zero.
  Sandisk remained 15/15 and PR Newswire 34/34 with no child error. Headline
  translation was 49/49 with no pending, running, retrying or exhausted job;
  official research was 4 published/0 pending and X market news 1/1.
- Read-only stored-stage reconciliation found three new `signal_events` rows
  after the current window start, all from SK hynix. Their source publication
  times were 00:00:20–00:00:41 UTC, before the 04:43:12.282254 UTC start, while
  first observations were 05:06:55.153–05:08:58.621 UTC. They are three URLs in
  one AI-ecosystem series and are delayed backfills, not current-window delivery
  successes. No in-window headline translation, official-research publication,
  X market publication or deterministic result publication was stored.
- The Japanese preview observation was recorded by 05:55:46 UTC with data fetched at
  05:45:24 UTC. Its newest displayed story still predated the current window;
  none of the three backfills appeared in the delivery list. With zero eligible
  newly published item, source-to-browser latency and JA/EN accuracy remain
  **untested**, not passed. The English view was not used as a substitute for a
  missing eligible item.
- Independent checks of the SK hynix official newsroom found the two October 2
  story groups already present in stored evidence; no later item was found.
  The PR Newswire All News Releases index had entries through 00:22 ET
  (04:22 UTC), before the window start, and the Sandisk investor newsroom still
  showed its August 5 release as latest. These checks cover only those three
  inventories; the remaining configured source inventories are unverified in
  this snapshot.
- Stored X-route transitions through 05:50:04 UTC contained 149 `failed` and
  150 `recovered` transitions: Barchart 30/30, Nebius official 30/30,
  TrendSpider 29/30 and Wall St Engine 60/60. All stored failure kinds were the
  generic `other`; recoveries averaged about 13.5–21.1 seconds by route and the
  current health had zero X route error. Timing and code paths are consistent
  with intentional shared-budget pacing, including one recovery whose failure
  began before the window, but the transition table does not preserve the raw
  cause. Preserve this as observability noise/risk; do not misreport it as 149
  independently proven upstream failures or erase it from the acceptance record.

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

## X pacing bookkeeping repair during observation — October 2

The reservation path raises `XApiPacing` before any network request. The old
`signals.check` handler stored it as a route error and created failed/recovered
transitions even though its exponential failure count did not increase. The
worker also overwrote the previous real request duration with the local wait.

The repair records `status=deferred`, changes only `next_check_at`, and writes
`signal_route_deferrals(source_id,deferred_at,retry_at,reason)` separately
(retention: eight days, at most 100,000 records). It preserves checked/succeeded
clocks, validators, cursor, duration, active real errors and outage attempts.
A pacing deferral is not a retry attempt or a recovery. HTTP 429, timeout and
local daily-budget exhaustion still follow the existing error path. Request
budget, polling configuration, source filters and translation rules are unchanged.

Historical generic `other` transitions are preserved and remain ambiguous;
do not retroactively reclassify all of them as pacing or subtract them as if
proven. The existing acceptance window and reporting time are unchanged. Record
the deployment time and split pre/post-repair observations; this is not proof
of a clean full-day run or improved delivery latency. The read-only acceptance
audit predates the new table, so additionally query `signal_route_deferrals`
by `deferred_at` in the observation interval and report these as local scheduling
waits separately from network failures. The absence of new transitions alone
does not establish freshness; verify actual successful request clocks per route.

Deployment evidence: repair `6108cb63403e7d5e5b449f0a46df611b170125cc`,
Actions `36973123148` succeeded; 201 Node + 591 Python tests, lint, build,
compileall and diff checks passed. Vercel preview and Railway staging succeeded.
Railway deployment `1f4f8afa-40c7-43ac-8a16-43af86391051`; new worker start
**2026-10-02T06:21:31.882+00:00**. This restart is part of the observation history.

Read-only live observation at **06:23:16.800258 UTC (15:23:16 JST)**:
health ready, issue list empty; official route/article errors 0/0 and pending
headline/research/market queues 0/0/0. All four enabled X routes had a genuine
successful fetch after restart (UTC): TrendSpider 06:21:57.650, WallStEngine
06:22:17.941, Barchart 06:22:38.659, Nebius official 06:23:01.915. All errors null.
Six pacing deferrals were recorded separately (1/3/1/1 respectively), with no
failed/recovered transitions after restart. WallStEngine was deferred again at
06:23:01.780 while its success clock remained 06:22:17.941 and last real duration
108 ms: waiting did not fake a fresh successful fetch. The observation-window
transition count remained **439**, retained from before deployment. This is a
short runtime check, not 24-hour acceptance or new-story translation evidence.

### Current-window interim snapshot — 2026-10-02 06:58 UTC

- The sanitized health response was ready with an empty issue list. The worker
  still had the X pacing repair start time `06:21:31.882 UTC`; the latest observed
  cycle was `06:51:48.938 UTC`. All 24 enabled official routes were fresh with
  zero route error or pending route, article errors/retries were zero, headline
  translation was 49/49 with no pending/running/retrying/exhausted job, official
  research was 4 published/0 pending and X market news was 1/1.
- A read-only query found **91** explicitly classified pacing deferrals after the
  repaired worker start: Barchart 15, Nebius official 15, TrendSpider 15 and
  WallStEngine 46. No new `signal_route_transitions` row was created after the
  restart. Each enabled X route also completed a real fetch after those waits:
  Barchart `06:53:50.487`, Nebius official `06:54:11.057`, TrendSpider
  `06:55:22.565` and WallStEngine `06:55:02.527` UTC. The earlier **439** ambiguous
  transitions remain preserved; the repair does not relabel them.
- The inspected, pinned offline audit (`c5b62e9`, SHA-256
  `eccbdc01deab444c7f169b693bbb97f7e9eda01b41e16987b0d33983f6739143`)
  was rerun against the live database at a fixed `06:58:56.431466 UTC` cutoff.
  It reported three historical backfills, one new-source-publication candidate
  and one revision. The only new candidate was PR Newswire event 1167, source
  time `06:00:00 UTC`, first observed `06:01:13.581 UTC`: a MIMARU Osaka hotel
  opening release, independently reviewed as outside Tech Phase scope. Its
  **73.581 seconds** is retained only in the raw intake diagnostic and is not a
  service-latency success. It had no eligible Japanese/English delivery to review.
- Nebius Blog event 1168 (`Introducing spot pricing for preemptible VMs`) was a
  changed revision first observed at `06:18:47.857 UTC`; the official article is
  dated September 22, 2026. It is not a new publication in this window.
- The reviewed audit therefore reported `excluded: 1`, zero independently
  reviewed eligible new publications, and a zero-sample/null service-latency
  distribution. Its exact-window history still retained 439 route transitions,
  zero incident event, zero new research attempt failure, zero translation-call
  failure and 21 carry-in incidents. These records are not recategorized as
  current upstream errors.
- The audit declared all 51 required source IDs. The two targeted source checks
  above were deliberately partial, so all 51 complete independent inventories
  remain unverified. No eligible new item existed for a revision-bound bilingual
  browser observation. Separately, the preview loaded successfully in Japanese
  and English; the home carousel included the previously published TrendSpider
  Nasdaq-100 update in Japanese and the equivalent English headline. That check
  verifies the home-market-news integration, not in-window news acceptance.
- Acceptance remains **observing / untested for new eligible delivery**. The
  original `04:43:12.282254 UTC` start is unchanged; no clean-window reset was
  made and no zero-event category is treated as passed.

## October 2 optional future headline display change

Owner approved short headlines for future news, with ellipsis when shortening
would distort meaning. The next deployment adds optional JA/EN compact copy to
the existing official-headline and X market translation requests. Invalid compact
copy falls back to the full headline and does not suppress news or retry the job.
The original call cap, source acquisition schedule, acceptance start/end and
October 3 13:50 JST report remain unchanged. Official output-token allowance is
600 (previously 300), with the existing 1200-token limit retry. Keep deployment
and worker restart timestamps in the report and split before/after observations.
Synthetic unknown-URL tests cover the new display pipeline; do not describe them
as evidence of actual new live news arrival. Translation latency and omissions
still require the ongoing live observation.

## Current-window observation — October 2 22:49 UTC

- The continuous window remains `2026-10-02T04:43:12.282254Z` through
  `2026-10-03T04:43:12.282254Z`. It was not reset. This is still an observation,
  and the in-window failures below mean it is not a clean 24-hour pass.
- Sanitized health at 22:49:17 UTC was ready, but not clean: 23/24 enabled
  routes were fresh, one route had `articlePartial`, and one article retrieval
  remained deferred for retry. Headline translation was 47/47 with no current
  queue, official research was 20 published/3 pending, and X market news was
  2/2 published. The 153 translation calls/110 failed calls and 21 article
  recoveries are rolling 24-hour counters; they are preserved as diagnostics
  and are not subtracted or presented as window totals.
- Read-only stored evidence identified the active route as `coreweave-blog`.
  Its retained September 10 JOTA article began returning HTTP 404 at
  22:31:39.436 UTC. A direct request at 22:44 UTC also returned HTTP 404, while
  an older search-engine copy still retained the article. The route continues
  normal retries; it was not disabled or marked successful to improve the
  acceptance result. A separate `prnewswire-public` article-partial transition
  began at 22:43:34.338 and recovered at 22:47:47.715 UTC. Both transitions
  remain part of the acceptance evidence.
- Barchart event 1221 is the one independently reviewed eligible new-delivery
  sample so far. Source publication was 19:07:25, first detection
  19:08:01.778, and backend publication 19:08:05.017936 UTC: 36.778 seconds
  source-to-detection, 3.240 seconds detection-to-backend and 40.018 seconds
  source-to-backend. English was observed by 19:09:13 and Japanese by 19:10:18,
  giving a 108-second source-to-first-observation upper bound rather than an
  exact first-render measurement or latency SLA.
- The protected preview news API returned HTTP 200 at 22:36:53 UTC with two
  market updates, 20 official updates and one result brief. Event 1221 now
  exercises the optional live compact titles: `米国10年物国債利回り急上昇` and
  `U.S. 10-Year Treasury Yield Rising`. Both retain the 10-year tenor and upward
  direction. This is the first real compact-title observation; it does not
  replace the full bilingual headline or prove current browser delivery.
- Current reader delivery could not be newly timed in this snapshot because the
  cloud browser blocked its direct API request at the client. The protected API
  success and earlier 19:09–19:10 UI observations remain separate evidence.
  The original Barchart post was not independently retrievable in a public X
  reader, so its source clock remains attributed to authorized stored metadata.
- Official-research jobs 1226 and 1214 remained in retry after three and five
  attempts respectively with `unsupported-number`; public health reported one
  additional pending job outside its bounded sample. Complete independent
  inventories for every required source also remain unverified. These gaps and
  the active CoreWeave 404 preclude an acceptance claim.
