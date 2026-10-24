# RESOLUTE coverage gap: October 19 news, checked October 20 JST

This is a missing-coverage investigation, not a quiet-market report or a claim
that these stories were generated/saved by RESOLUTE.

## Independently located reporting

- Reuters, October19, “AI stocks bounce back after bruising selloff, CoreWeave gets Goldman upgrade”:
  https://www.reuters.com/world/asia-pacific/us-chip-stocks-rise-after-steepest-weekly-selloff-months-2026-10-19/
  The article discusses persistent AI financing concerns despite the rebound.
  Its positive/mixed title does not prove the body contains no downside.
- Taipei Times/Bloomberg, October19, “AI trade reversal pierces star stocks across Asia”:
  https://www.taipeitimes.com/News/biz/archives/2026/10/19/2003866193
  The reporting connects financing costs to infrastructure spending and suppliers.
  Date shown is the publication date; several underlying developments are from
  the preceding week. Do not rewrite them as new October19 announcements.

No full article was copied to the repository, no web-search result was inserted
into the customer feed, and no publication timestamp was invented. Synthetic
paraphrases in tests reproduce the selection failure; they are not live news.

## Two separate failures

1. Intake coverage: authenticated `/internal/resolute/news` calls only
   `public_news()`. Its general lane is disabled. Company RSS headlines live in
   a separate `company_wire` feed with no article body. The public analyst shape
   intentionally removes provenance. Neither can be silently treated as a full,
   sourced risk article. The existing news-reader token grants no editor or
   company-wire route access.
2. Selection: downside terms in the headline were mandatory even when the body
   explicitly described current AI financing pressure. Added a bounded body
   fallback for a concrete financing-cost or debt-distress mechanism. The same
   passage must identify AI/chips/data centers/neoclouds; negation and common
   forward-looking boilerplate are excluded. No inferred star score or duration.

## Read-only upstream health evidence

`/health/news` on research-monitor-staging was read October20 around10:05 JST.
It reported company headline arrivals (CRWV244 and NBIS81 in24h), but these are
counts of headline records, NOT distinct verified risk articles or proof that
one of the above exact URLs was captured. Official public feed70; general items0;
market published0/failed1; original-preview waiting29/published0. Research jobs
include validation holds. These holds must not be released without correcting
and verifying their underlying evidence. No retry/model request was triggered.

A direct Yahoo CRWV RSS request from the local executor returned HTTP404. This
single observation does not prove that the monitor's independent polling failed,
and does not establish a dependable replacement acquisition path.

## Required source integration acceptance (not yet satisfied)

Keep the home feed and other developer's acquisition/translation pipeline intact.
A RESOLUTE-specific private source contract needs already authorized, complete
article/summary text, original HTTPS URL, publisher, actual publication clock,
revision, and validation/publication provenance. It must exclude held drafts,
retracted records, headline-only records and unverified translations. It must
not require enabling the home's general-news publication or bypassing source
validation. Record each expected example as upstream-missing, withheld,
body-missing, date-invalid, selected, generation-rejected, or stored; unknown
must remain unknown. Confirm at least one real sourced candidate end to end
before declaring the morning news service recovered. Live AI generation remains
outside the authorization for this diagnostic and must not be silently invoked.

## Prepared private reporting adapter (disabled)

The actual staging monitor service f6f11a91 (environment58438f44) has no
STOCK_NEWS variable names configured; no values were retrieved. This is evidence
of missing connection configuration, not evidence about the owner's contract.

Added `rizel-report-source.mjs` using the existing repository's Stock News API
endpoint/field contract. It fetches only one page of up to100 provider summaries
per invocation, never article URLs, without retries or redirects. It preserves
publisher, original HTTPS URL and zoned publication date; malformed/failed
responses fail the run instead of becoming a quiet zero. Source text remains
untrusted input subject to downstream evidence validation. A full page is marked
possiblyTruncated; the adapter does not promise exhaustive coverage.

The daily worker and read-only diagnostic both support these server-only settings:
- RESOLUTE_REPORT_SOURCE_ENABLED=true
- RESOLUTE_REPORT_SOURCE_TOKEN (configured privately, never pasted into chat)
- RESOLUTE_REPORT_SOURCE_TICKERS (explicit uppercase comma-separated roster)

All are currently unconfigured. Defaults perform no provider call. This adapter
is separate from the home general-news lane: disabled general items stay excluded.
It does not release held drafts or add editor access. Normal daily calls occur
after the existing durable day claim, at most one request for that day's attempt.
The separate diagnostic also consumes one provider request when explicitly run
with the integration enabled. Confirm existing subscription/allowed use and
request allowance before activation. No subscription, API key or paid setting
was created or changed. Provider's real response and live positive-candidate
AI/storage acceptance remain unverified. Mocked provider tests are not that proof.

## 10:19 JST deployment and real read-only verification

Code d31c686e93cb047ed1cc48b61dccfa668c90354f passed final local Node1179,
Python2508 (254.840s), lint (0 errors/5 existing warnings), build, compileall
and diff check. Git Data tree matched c6ebb98a6c8dad37f0e930238cf64db09c9a2ea5
before the non-force update. CI39352416381 was still in progress at the check;
this is not a CI pass claim.

Morning deployment1d640818-32c5-4d1e-a66c-0b886913064c reached SUCCESS. Actual
01:19:23.076Z preflight: ready, approvedPairs90, withheld, aiCalls0/writes0.
Report variable names remain absent; cron stays `0 22 * * 0-4`. No staged patch.
No full daily generation/storage run was started.

Dedicated diagnostic30186467-5854-4728-a93a-6c6636904094 at01:19:21.940Z used
the same new intake code against the currently connected monitor:
reportConfigured=false, reportCount0; generalEnabled=false, generalCount0;
officialCount72; rejected body28/unrelated16/noDownsideHeadline28; all other
rejection/daily counters0; candidateCount0; unconsumedAnalystCount2; aiCalls0,
writes0, publication withheld, historicalReplay=false. This confirms the current
connection gap persists; candidate/generation/storage recovery is NOT established.

After this one GET-only diagnostic, its flag was set false and all temporary
news/DB references cleared. Retirement717caebe-b8b3-4169-8833-09d5b707cbfe
reached SUCCESS and logged RIZEL_INTAKE_DIAGNOSTIC_DISABLED at01:19:57.804Z.
No public domain, cron, mail, payment, provider call or additional model call.

Owner-confirmed October20: Stock News API is NOT contracted; acquisition is
planned for mid-November. Twelve Data is separately uncontracted and planned
for mid-November. No further contract-status question is needed. Keep the
report adapter disabled until that planned connection and acceptance.

Owner freshness requirement: today's RESOLUTE candidates must have an explicit
source publication timestamp within the current JST calendar day and not after
execution time. The former96h window is superseded. Date-only, missing/unzoned,
previous-day and future publications cannot be promoted using receipt/update
clocks. US-calendar previous-day articles can qualify only when their actual
publication instant is today in JST. This checks article publication, not proof
that every event described happened today; historical context must stay historical.

Implementation covers both private daily selection and the dormant public
publisher SQL/defensive filtering. Late prior-day rows can remain in historical
source/storage responses but never become today's candidates. Generation receives
the unchanged publication timestamp and is instructed to preserve historical
event dates; this instruction is not a factual correctness guarantee. Private
review also refuses a generated article that changes the source timestamp.
New tests cover JST midnight, US offsets, future/unzoned/date-only timestamps,
calendar overflow, delayed receipt, no-model exclusion, storage results and
generated timestamp substitution. All reports remain withheld.

Validation: Node1183/1183, Python2508/2508 (266.840s), lint0 errors
(5 existing warnings), Next build, compileall and diff check passed.
Total3691 tests. No actual provider/model calls were made. Live rollout and
next scheduled generation/storage remain separate verification steps.

### Freshness rollout evidence (10:55 JST)

Code20a3069e479eca51ca71d9ac9671bcdb0246bc68 / tree
e644dddc3b2666a823e329b290cae300af03037c was published after all gates.
Morning deployment b43e335e-918e-48a2-9779-433cf47b0738 reached SUCCESS.
Actual01:55:26.358Z preflight: ready, approvedPairs90, publication withheld,
aiCalls0/writes0. Cron and seven existing variables unchanged; no staged changes.
This is deployment/preflight evidence, NOT new news generation or stored-output
acceptance. No daily claim reset, provider request, new model invocation, email,
public release, billing change or reservation change. CI39355975366 was still
in progress when inspected, so CI success is not yet claimed.
