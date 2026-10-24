# News and target delivery repair — October 2, 2026

This change repairs reproduced ingestion, publication and browser-delivery
defects against preview base `885df189c6cf3ea15e8a48d0b1c3776482d476bf`.
It does not erase the MU, ASTS or employment delivery failures recorded in the
existing incident documents, reset an acceptance interval, or establish a
source-to-browser seconds-level SLA.

## Reproduced failures repaired

- Whole-batch supplemental polling waited for the slowest publisher. The
  scheduler now reuses completed slots, prevents duplicate in-flight requests,
  fairly revisits due sources and preserves the three-worker cap. When X is
  enabled, one slot is reserved for X and two for other supplemental sources.
  The persistent X request cap and pacing checks remain in force.
- Newly committed source events now wake the independent publication workers;
  a new event need not wait for their five-second idle poll. Revision, retry,
  translation approval and spending checks remain unchanged.
- Arbitrary pre-parser pages of 300 target candidates or 200 mixed result
  candidates could permanently hide eligible retained events. Indexed source
  and time windows replace those pages. Public display limits still apply
  after validation.
- Target admission accepts PT increased/reduced/from/of forms already supported
  by the strict public parser. Unknown firms, ambiguous subjects, contradictory
  direction and unsupported numbers remain withheld, with aggregate reasons.
- Corrected target revisions supersede old numbers. A newer acquired original
  also invalidates old source evidence when a withdrawal itself does not match
  any supported news grammar. It remains private rather than being invented
  into a new public story.
- Startup reprocessing of retained, previously unselected X originals makes no
  provider calls. It preserves original source and first-observation clocks,
  records recovery as baseline, rejects corrupt/future/truncated evidence and
  does not overwrite a newer source document. It does not rewrite route timing,
  query cursors or billing records.
- Syndicated target actions retain their source URLs/times and canonical broker
  identities. Different brokers and changed price pairs remain separate.
- Earnings/results consolidation retains all attributed facts and sources.
  Different fiscal periods, dates and explicitly corrected releases stay
  distinct. Disagreeing values remain attributed and are not averaged or silently
  chosen as consensus. Unknown-period cases are conservatively not merged.
- A long issuer-note headline or one malformed note cannot invalidate all news.
  Monitor failure returns uncached 503, rather than HTTP 200 with only a static
  fallback. The pre-existing fail-closed unavailable display is preserved.
- Stalled news requests have a 15-second full-load deadline. Old HTTP responses
  and cancelled SSE sessions cannot overwrite a newer snapshot. The news refresh
  label now reflects the existing five-second cadence.

## Recovery checks

The reviewed MU SEC-derived artifact is replayed through the bilingual public
news validator: FQ4 2026 revenue 54,229 million USD, adjusted EPS 33.42, next-quarter
revenue midpoint 61.5 billion USD plus/minus 1.5 billion. This is a saved reviewed
input, not a fresh live-model translation or on-time arrival measurement.

The recorded September employment post format is replayed through retained
acquisition, private admission and durable bilingual publication. It preserves
+29K payrolls, 4.2% unemployment and 3.0% YoY wages; estimates and absent MoM
values are not substituted. Its original 1,115.663-second acquisition delay is
preserved. Synthetic fixtures also test multiple publishers, conflicting values,
repeated requests, unsupported withdrawals, malformed evidence and stale revisions.

Before rollout, the existing Vercel API was observed at 16:20:58 UTC returning MU
and the employment result in both languages. At 16:26 UTC its Japanese home UI
also visibly contained the employment result. These are recovery observations,
not proof that either historical release arrived on time.

## Verification and limits

Final local integrated gates passed including withdrawal regressions: 241 Node
and 642 Python tests, lint (zero errors, one existing unused-variable warning),
production build/type checking, compileall and whitespace checks. Deployment/CI
and live-browser verification are separate evidence and must be recorded after
observation.

At 16:22:28 UTC, old-deployment diagnostics still showed 23/24 supplemental routes
fresh, one articlePartial route with one invalidResponse article, and three
pending issuer research notes. The public response did not identify the article
URL. These are not resolved merely because local tests pass.

The current X request ceiling is 4,400 per day with 20-second common pacing and
four query routes. The reported 80-second route spacing is a planning estimate,
not a measured or hard minimum per source. Search queries, source accounts,
paid-service settings and request limits are unchanged by this rollout. Pure
PT shorthand outside the existing search query can still be absent upstream;
query expansion requires a separate usage/cost decision. Filtered Stream is not
activated.

Configured normal transport is news polling every five seconds plus request
time, and price-target SSE sampling every second plus processing/network time.
Reconnects, provider delays and translation retries can take longer. A future
acceptance claim requires newly published eligible items, independent source
reconciliation, accurate JA/EN output, and separately measured source,
acquisition, backend-publication and actual browser clocks.

## First rollout and live follow-through

Commit `33c0ad7a3a567109070d6c51ce17c83374281cf4` was verified on the remote
preview branch. Its uploaded tree matched the checked local Git tree exactly.
Actions run `37035662812`, Vercel deployment `dpl_5reEnqqcehPB4XdBUHZPNARQn19B`
and Railway deployment `bfe5c396-5640-405f-8435-8132baed419f` succeeded.
The existing branch alias points to that preview; no production promotion was
performed.

By 16:49 UTC the live alias home page showed the employment result in English,
including the expanded +29K/4.2%/YoY 3.0% details, and live target cards with source
attribution. At 16:54 UTC the home news list's fourth page showed MU's $54.23B
revenue, $33.42 adjusted EPS and $61.5B plus/minus $1.5B revenue guidance in both
English and Japanese. These later observations do not improve the historical
arrival times.

Authenticated inspection identified the remaining article failure as the
PR Newswire release:
https://www.prnewswire.com/news-releases/green-water-and-power-partners-with-goodwill-socal-to-offer-on-the-job-training-in-electrical-trades-302897221.html

An ordinary fetch returned HTTP 200. Three gallery tiles use non-void `<div/>`
elements with subsequent closing tags; the old parser incorrectly synthesized
an immediate close and retained only 62 characters. HTML-correct self-closing
handling and matching-tag scopes recover 4,170 characters through the final
source line. The release matches none of the 22 tracked companies. Its valid
extraction must not create an unrelated company-news event. The stored live
retry/error still requires post-deployment verification; it is not silently
cleared or reclassified as a missing tracked-stock story.

The same inspection found the explicit Wells Fargo MSFT $700 to $725 action at
https://x.com/TipRanks/status/2105612496354545795 withheld by the unsupported
`price target on Company to` grammar. A narrow directional adapter requires
that the named company exactly match the resolved ticker's known alias; the
existing source, firm, subject, value, multiple-action and revision gates remain.

Live UI checks also caught MU issuer/SEC duplication because the original source
title spelled out “Fourth Quarter and Full Year 2026”. Explicit adjacent fiscal
quarter/year recognition now merges that Q4 release while retaining the Q3
event separately. Exact repeated summary/fact paragraphs are displayed once.
Separate same-publisher follow-up URLs retain their own facts rather than an
EPS-only post removing the earlier revenue. Same-URL corrections still supersede
old revisions, and different-URL disagreements remain attributed.

The integrated follow-through changes passed 243 Node and 653 Python tests,
lint (zero errors, the same existing warning), production build/type checking,
compileall and whitespace checks before their subsequent rollout.

## Preserved-publication corpus and protected diagnostics

Follow-through commit `f5a81aa97e54b351c57f38273d53c3034181103e` passed Actions
`37038068367` and both linked deployments. Subsequent actual UI checks found a
regression: a normal target heading followed by an identical named-company body
statement was counted as two conflicting actions. AMZN/Rosenblatt $335 to $360
and MSFT/Piper Sandler $550 to $610 disappeared, while the newly supported
MSFT/Wells Fargo $700 to $725 appeared. This temporary omission is preserved as
a failure, not described as an error-free rollout.

A representative grammar replay now compares the same five observed fact
patterns against both earlier commits and the repaired candidate: `33c0ad7`
returns four, `f5a81aa` returns three, and the repaired candidate returns all five.
The replay uses observed facts/grammar with synthetic surrounding prose; it is
not a complete export of the retained production originals. Identical echoes
require the same price pair, direction, explicit subject and broker actor.
Different firms, companies, additional actions and contradictory directions
remain withheld.

The explicit B. Riley opening/cashtag/action construction is also supported.
These two originals normalize to ASTS / B. Riley / 85 to 65 / 2026-10-02 UTC:

- https://x.com/TipRanks/status/2105941809176162413 — source 08:43:48 UTC;
  first observed 08:44:16.476 UTC.
- https://x.com/wallstengine/status/2105958528741785966 — source 09:50:14 UTC;
  first observed 09:51:21 UTC.

The combined item retains both origins and the earliest observation. The two
MSFT actions remain separate because their firms, dates and price pairs differ.

An editor-token-protected, GET-only issuer diagnostic view was added to inspect
the outstanding generation candidates. It uses SQLite `mode=ro` and
`query_only`, bypasses schema/metadata synchronization, and does not generate,
retry or publish anything. It returns current revision/job metadata and bounded
numeric/quarter/date validation differences, never rejected prose, source bodies
or evidence quotations. No cookie bridge, new credential or permission is added.
The existing ratings filter is forwarded consistently with its UI and backend.

The live three issuer-note failures are not classified merely by building this
view. Historical failure rows do not record body SHA; replay against the current
body is explicitly distinguished from reproducing the historical validation.
Machine rejection alone is not evidence of fabricated facts. Actual editor
authentication is still required for live diagnosis.

Anthropic's newly indexed academy article briefly returned HTTP 404, then
recovered on the normal retry at 17:11:19.706 UTC. Its future publication clock
from the publisher is left unchanged. This source-side incident is distinct
from the PR Newswire parser repair, whose pre-deployment failed attempt remains
scheduled for 18:06:45.389 UTC verification.

## Third rollout: restored publications verified on the live home page

Commit `8a0f1eeb54e5ebf73dc53848a626e1e7b7cea7b3` passed the final integrated
245 Node / 670 Python tests, lint, production build/type checking, compileall
and whitespace checks. Its uploaded Git tree exactly matched
`9c2ae5d15323f04b7b9784012f75ddb9a880c755` before the non-forced branch update.
Actions `37041649910`, Vercel `dpl_BwSZH91RY2K7RmYL3Rj2btxHdarR` and Railway
`df856682-2a1a-44de-a14d-54b369996159` all succeeded for that commit.

At 17:36:37 UTC the existing preview's target API simultaneously returned:
ASTS / B. Riley / 85 to 65 (two sources), MSFT / Wells Fargo / 700 to 725,
AMZN / Rosenblatt / 335 to 360, MSFT / Piper Sandler / 550 to 610, and
MRNA / Citi / 60 to 80. At 17:38 UTC the already-open live home reflected the
restored records without a manual reload. Japanese and English views and the
second target page were checked. The ASTS origins stayed on one card; the two
MSFT brokers stayed separate. These are recovery observations, not new-source
latency samples.

The protected issuer diagnostic endpoint rejected an unauthenticated request
with HTTP 401. The authorized browser remains on an older immutable preview,
so its current editor-token session does not expose the new diagnostic view.
No token was extracted or persisted and no authentication bridge was added.
The three pending issuer notes therefore remain unclassified until the latest
view can be used with normal editor authentication.

## Newly acquired older article: source-date reconciliation

Passive observation began at 17:41:40 UTC. Microsoft article event 1210 was
first seen in the news API between 17:45:12.053 and 17:46:11.898 UTC, with
`observedAt=2026-10-02T17:45:51.992+00:00` and `publishedOn=2026-10-02`.
The original article visibly states October 1:
https://www.microsoft.com/en-us/security/blog/2026/10/01/insights-from-the-2026-microsoft-digital-defense-report/

This is older-source acquisition and a publication-date mismatch, not a
successful new-event latency sample. Exact raw feed/article schema access
returned HTTP 403 during the investigation. Visible text establishes the
mismatch, but does not establish the precise relisting/schema cause.

Code inspection identified an independent, reproducible defect: article
collection discarded original-publication metadata and could never correct a
non-null feed date. Standards-based, same-article original metadata can now
reconcile that date on ordinary direct rechecks, without changing observation
or detection clocks. Modified dates and conflicting/unrelated metadata are not
original-publication evidence. Cross-host first-party aggregator entries use
the approved remote-article queue rather than promoting the aggregator's
summary/date as original article evidence. Existing cache/extractor versions
are invalidated for normal rechecks; schedules, source scopes and X budgets
are unchanged.

The API also now applies source timestamp, then source calendar date, then
observation time before limiting its top 20. Previously, date-only older items
could crowd newer items out by their recent acquisition clock even though the
UI sorted the received subset correctly. Regression fixtures cover the API
limit and Japanese/English pulse ordering. The article-markup fixture around
the observed Microsoft URL/date pair is explicitly synthetic, not a captured
copy of the inaccessible page. Live correction still requires verification;
no publication date is inferred or patched from the URL alone.

Date/order commit `43c29817a8da61171c4f243ad4c90251b9017bd6` passed 247 Node
and 676 Python tests plus all required gates. Tree
`4e99c8c5c1a60ec810b37d27a4c6d3b96f186363` matched the checked staged tree.
Actions `37044925007`, Vercel `dpl_3DhmXGCBm9vSomSoEXyW4v1fdekP` and Railway
`2984ac6a-8e38-4402-b203-69c6508e0df5` succeeded. A single diagnostic `/live`
timeout at 18:00 UTC recovered to automatic mode by 18:06:39; news and target
endpoints continued returning HTTP 200. MSFT's displayed date remained October
2 at 18:05 UTC, before its next ordinary article recheck. Other existing NVIDIA
URLs acquired new date-inclusive revision IDs while retaining their original
observation clocks. These are revisions, not fresh-delivery samples.

## Retained article retries versus disappearing errors

By 18:05 UTC the private PR Newswire article error had disappeared, before its
recorded 18:06:45 retry. At 18:06:39 the supplemental aggregate showed zero
article errors, but its most recent measured article recovery was still the
Anthropic recovery at 17:11:19. This is not evidence that PR Newswire's live
retry succeeded. Its corrected local parser extraction remains verified
separately; the exact live article result is unconfirmed.

A deterministic reproduction exposed coverage loss in the rolling index cache:
one stored failed URL with a future retry, followed by 100 newly listed URLs,
removed the failed URL without requesting it. It returned zero errors and no
recovery. The replacement separates current-index admission from retained work:
non-sitemap indexes retain at most 200 child records, sitemap indexes keep their
existing 1,000-record bound. Existing unresolved children take precedence over
evictable completed history. Deferred access-control retries keep their exact
schedules; a due rotated failure can use the existing third request slot rather
than starving behind continuously arriving current links. At most three article
requests are still made per route cycle.

A saturated queue continues processing retained work and explicitly reports
unadmitted current links with `article-queue-overflow`. Bounded aggregate
observation count, maximum unadmitted count and last-overflow time survive later
healthy cycles; these are observations, not unique lost-story counts. No article
recovery is fabricated. Synthetic tests cover successive rotations and reloads,
full unresolved capacity, progress under overflow, HTTP 403 backoff preservation,
completed-history eviction and public-safe overflow diagnostics. Already-evicted
historical entries cannot be reconstructed from these aggregate diagnostics.

The retention candidate passed 247 Node and 681 Python tests, lint, build/type
checking, compileall and whitespace checks, plus independent review.

## Retention rollout and remaining primary-source classification

Retention commit `54eac6cf6ad1778a620cd6f2bf0561bb267226e2` passed Actions
`37046631379`, Vercel `dpl_GDiFhixdQnqZoTqX8uyaVvHyta9Y` and Railway
`f9152619-eba2-426d-8c45-eb3111270f86`. Tree
`1aae1e35b020b0d6cd76f3a2c21d7d66c2810bcc` matched the tested local tree.
MSFT's ordinary recheck corrected its original date to October 1 by the API
observation at 18:16:58.403 UTC, preserving acquisition at 17:45:51.992. Both
Japanese and English date/detail views were checked onscreen at 18:23 UTC.

One news HTTP 503 was observed at 18:20:13 during replacement of the monitor
(worker start 18:20:01); it recovered to HTTP 200 by 18:21:32 and an independent
18:22:10 check. A target warning in an offscreen panel cleared without reload
when normal scrolling resumed its intentionally suspended connection. At
18:21:27 the panel showed live updates. Neither observation establishes a
new-source latency result.

At 18:24 UTC supplemental routes were 24/24 fresh, with zero current article
errors/admission overflow and zero SSE read failures. This does not describe
all primary issuer records. The primary backlog still had 92 detected records
without bodies: 83 SEC documents and nine TSMC articles. The latter were
explicitly dated June 4–September 10 in original titles, then discovered as a
historical group on September 29. Large BE/CRDO SEC groups were historical
imports; generic 6-K/8-K titles alone do not prove they are irrelevant.

The recent MU cover document is accession `000072312526000018`, matching the
already-reviewed Ex99.1 recovery evidence and independently accessible issuer
Q4 release. Earnings-content coverage is established separately; the blocked
cover-document route is not called recovered. NBIS's October 1 accession
`000110465926112824` remains unread. Its independently accessible October 1
Inferize acquisition is already acquired/displayed, but exact overlap with the
6-K cannot be established from the generic filing title.

Three primary access-restricted retries, three invalid-response retries and
three active host circuits remain distinct from supplemental zeros. Exact
per-host retry schedules are not available in the public payload; its earliest
advertised host probe was October 2 22:34:30.153 UTC. No protected host schedule
was reset, and no bulk historical backfill was requested. Three pending issuer
notes still require the existing editor authentication on the latest diagnostic
view for classification.

## ASML verified issuer-domain migration

ASML's own old press-release listing and original release URLs now redirect to
`investor.asml.com`. An ordinary source check reproduced the old failure as
`URL outside approved official hosts`. The provider registry now permits only
that exact additional issuer host and its observed single-release path, retaining
the old article paths and SEC routes. The canonical monitor listing is
`https://investor.asml.com/news/press-releases-and-announcements`; using that
origin is necessary for its root-relative article links.

With the registry change the same original Eindhoven URL fetched successfully
(59,963 HTML bytes, 6,291 extracted characters), and the canonical index yielded
ten release URLs. Captured original metadata uses `datePublished` with a basic
ISO numeric timezone offset (`+0200`) and `sc:publication_date`. Both identify
September 8. The parser now accepts these explicit original-publication forms,
rejects invalid numeric offsets and conflicting dates, and ignores modification
dates. The actual captured HTML yields September 8 for both original and
canonical identities. No date is inferred from the URL or acquisition clock.
Normal source retries, existing identity/observation clocks and public source
validation remain in place. Runtime retrieval of the old failed records still
requires post-deployment verification.

The integrated ASML/date candidate passed 250 Node and 688 Python tests (938
total), lint, production build/type checking, compileall and whitespace checks,
plus independent review including the actual captured issuer metadata.

## Primary discovery and body completion barriers

ASML migration commit `6e6e2b99394147b93b26a72c738b2da602ac9115` passed Actions
`37049490748`, Vercel `dpl_F9ggG3SsQFHLLdCVb45BP5NKiUs8` and Railway
`410d8f1f-fe3b-4f6a-acbe-8a1e97ed376f`; the uploaded tree exactly matched
`0addfc28272b0de2396578c695da5a133fcdb4ca`. Its first runtime canonical-index
attempt and an ordinary repeat at 18:50:55 both timed out after about 20 seconds.
The configured SEC metadata fallback continued working, but no new canonical
ASML articles were acquired. Local success is not claimed as runtime recovery;
the old failed rechecks retain their normal schedules.

This exposed a separate correctable latency defect: primary discovery waited
for all ticker futures before saving any completed result. Body fetching also
waited for every body before saving its completed peers. The replacement uses
one bounded shared pool with the existing configured worker ceiling, commits
completed evidence immediately, wakes publication workers only after commit,
and reschedules issuers fairly at their existing completion-based cadence.
Pending/active ticker and body identities cannot be dispatched twice.

Body admission continues at the existing body interval and outstanding
body-batch capacity while an older peer remains slow. Non-SEC host exclusions
preserve issuer courtesy. Merely having a configured SEC fallback does not
reserve that host while a different issuer is being contacted. The actual
initial/redirect SEC requests share a thread-safe process-wide rolling ceiling
of 10 requests/second across `www.sec.gov` and `data.sec.gov`, consistent with
https://www.sec.gov/files/about/webmaster-faq.htm . This does not reset an
access-control circuit or authorize blocked requests, and does not claim a
cross-process/account-wide limiter. X request/billing settings are unchanged.

Evidence and per-source state updates are immediate; discovery batch metrics
alone aggregate on a five-second interval with a 1,000-check bound. This avoids
truncating the existing 100,000-row telemetry history in less than a day after
restoring the intended issuer cadence. Normal shutdown discards late results;
a failed loop drains its old network pool before a supervised restart.

An existing test fixture stubbed the old body method; it was corrected for the
new asynchronous entry point before further validation. The final Python test
harness explicitly denies and audits external DNS/socket attempts, permits only
local loopback fixture servers, and fails even if application code catches an
attempt. Regression tests never request real provider data.

## First genuinely new post observed during this repair

Barchart item `1221`, https://x.com/Barchart/status/2106098746266136677,
reported the U.S. 10-year Treasury yield rising sharply again. Stored source
time is 19:07:25 UTC and acquisition is 19:08:01.778 UTC (36.778 seconds).
The item was absent in the 19:08:01.356 API observation and present at
19:08:58.199. The untouched live English home contained it by 19:09:13, and
Japanese was checked by 19:10:18 with a settled screenshot at 19:10:42. Both
versions preserve the 10-year tenor and show 04:07:25 JST on October 3; neither
invents a numeric yield percentage.

The observation establishes delivery of a new eligible post, not a five-second
source-to-screen SLA. Acquisition-to-English-observation upper bound is 71.222
seconds; stored-source-to-observation upper bound is 108 seconds. A public X
reader could not independently retrieve the original, so the source clock is
attributed to authorized ingestion metadata. Historical corrections/backfills
remain excluded. Exact first render is not known from one-minute sampling.

The existing market-publication table retains the actual original publication
clock. Bounded diagnostics now expose that clock only for currently valid
public items (latest five within 24 hours), alongside source/acquisition clocks
and calculated intervals. Unreleased private, invalid, superseded or invalidly
timed rows are excluded. Reading these metrics never rewrites a publication
time or substitutes a replay/poll time. Runtime measurement of item 1221 will
be recorded separately after this diagnostic change is deployed.

The final integrated queue/courtesy/timing candidate passed 250 Node and 713
Python tests (963 total), all required lint/build/type/compile/whitespace gates,
and independent review. The Python gate recorded zero external DNS/socket
attempts. The existing authenticated editorial view also corroborated the
retained Barchart original, its 10-year tenor and source/acquisition clocks;
this is retained ingestion evidence, not independent public-web verification.

## Seventh rollout and closed observation window

Commit `daf9d51787c4ae21bacd5de8b94a7f66c508db6f` passed Actions
`37053950995`, Vercel `dpl_BGoCB23FBmnPQYYS82wpaSnzDbEB` and Railway
`b58b000d-06c6-4827-a3ef-6f24521145ce`. Tree
`141318259376a25993e222f39f7b8bcb3ab339ad` matched the checked staged tree.
The worker started at 19:25:31.946 UTC. One news 503 at 19:25:38.876 overlapped
replacement and recovered on the next ordinary probe at 19:26:12.669.

Item 1221's original stored backend-publication clock is
`2026-10-02T19:08:05.017936+00:00`: acquisition-to-publication 3.239936 seconds,
and stored-source-to-publication 40.017936 seconds. It was not replaced with the
later diagnostic rollout time. The fresh-observation window closed at 20:00 UTC
with one genuinely new eligible item, no new price-target sample, 342 successful
polling responses and two recovered replacement-overlap news 503s. Exact browser
first-render timing remains unknown. This is not a few-second end-to-end SLA.

## BEA routing variant discovered during the final check

A new BEA `signal-no-article-links` failure began at 20:01:19 UTC, after its
19:59:18 success. An ordinary capture of the current official listing contained
104 links, including `/index.php/news/2026/personal-income-and-outlays-august-2026`.
The configured exact clean `/news/...` pattern consequently found none. The
same original release is available at the existing clean URL. The repair
normalizes only this observed BEA front-controller prefix and only when the
result passes the existing strict PCE URL validator. It applies before article
selection and retained-child lookup, preserving the same URL/revision identity,
HTTP validators and source dates rather than creating a newly dated duplicate.
No broader government paths, other hosts, query-bearing release URLs or numeric
publication gates are admitted.

Independently, a new PR Newswire CME article returned HTTP 404 at 20:02:18 and
recovered at the scheduled attempt at 20:06:32.319 (measured article recovery
count increased from 15 to 16). A different Allison article returned 404 at
20:06:02 with a normal 20:10:02 retry. These are newly observed upstream article
incidents, not evidence that the earlier evicted Green Water record recovered.
The 20:00 fresh-delivery observation window is not extended or rewritten by
this separate error follow-through.

The BEA routing candidate passed 250 Node and 715 Python tests (965 total),
all required gates and independent review. External DNS/socket audit: zero
attempts. The separate fresh-event timing window remains closed at 20:00 UTC.
