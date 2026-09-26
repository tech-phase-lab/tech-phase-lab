# Research home tools

The home quick tools use two columns on desktop and mobile: stock search,
favorite companies, calendar, and What Changed. Existing research remains
available through What Changed; the old report-count tile is removed.

## Favorites

`/research/watchlist` supports the current provider registry. Company pages also
have a favorite toggle. Favorites use browser local storage under
`tech-phase:favorite-stocks:v1`, separately from saved articles. Changes sync
across open tabs, not across devices. Failed writes show an error. Tickers
removed from coverage remain removable without linking to nonexistent pages.

## Calendar

`lib/research/calendar.ts` contains manually verified, selected official events.
Every item has an official source link, explicit UTC offset, source timezone,
and Japanese/English labels. Keep `calendarReviewedOn` current only after source
verification. This is not an exhaustive earnings or economic calendar.

Japanese defaults to JST and English to U.S. Eastern Time (ET); the other zone
is shown alongside. A selector overrides the default, with language changes
resetting it. Date and month filters follow the selected zone, including DST. Upcoming events exclude past timestamps; monthly views retain
them with a past-time label. A notice appears after seven days without review.
Micron's earnings call time must not be labeled as its release publication time.

No paid data subscription, automatic ingestion, external notification, or
membership feature is enabled by these tools.

X recent-search ingestion is separately fail-closed: the explicit enable flag
and bearer token are both required. Before each network request the monitor
persists a URL-, query- and token-free attempt record and enforces a configurable
rolling 24-hour request ceiling. The private review screen exposes only this
aggregate usage and next available time. This local guard does not replace the
provider-side spending cap, and X-derived items remain private and unreviewed
until a human verifies them; they are never auto-published.
The review screen also derives a conservative 24-hour request ceiling from the
configured polling intervals and shows it beside the enforced local cap. This
is a request-count bound, not a currency estimate or delivery-latency promise;
provider billing and provider-side caps remain authoritative. X queries and the
post filter are restricted to analyst price-target or earnings language.
When configured demand exceeds the rolling daily allowance, the monitor spaces
billable X requests instead of consuming that allowance at the nominal polling
rate. With a 100-request cap this is one request no more often than every 864
seconds globally; due publishers rotate by rolling attempt count so one
publisher cannot consume the shared budget. When configured demand fits below
the cap, the declared source intervals and bounded event windows remain in
effect. The private preview shows an aggregate next request slot only while
pacing applies, without exposing queries, URLs or tokens. This is an internal
request schedule, not a subscriber-delivery latency commitment.

AI-assisted news drafts retain their AI provenance after human edits and
require a separate human-verification acknowledgement before approval. The
reviewer must compare the official source, evidence quotes, factual summary,
impact interpretation, and numbers. The private audit history retains that
acknowledgement; public data excludes AI-assisted drafts whose matching
approval lacks it.
If the AI input was shortened by the configured source-character limit,
approval also requires a separate acknowledgement that the reviewer checked
the full stored source and official link, including the range not sent to the
model. The private audit history retains this second acknowledgement, and the
public snapshot fails closed when the matching approval does not contain it.
The private news-review header shows the official publication date exactly as
stored, without manufacturing a clock time, plus the source discovery and most
recent successful body-check timestamps converted to JST. The AI generation
record also shows its saved timestamp in JST. These are separate observations:
discovery or body-check time must not be presented as the issuer's publication
time or as subscriber-delivery latency.
The operations preview also partitions the current body-fetch reservation into
detected releases, baseline history, extraction retries and periodic rechecks.
Each partition also reports successful non-304 extraction, extracted evidence
that was newly acquired or changed, failed selections and HTTP 304 validator
reuse when non-zero, so operators can distinguish fair scheduling, completed
evidence extraction, an evidence update and a lawful conditional-cache hit without
exposing a URL, hostname, validator or response detail. A non-304 response is not
proof that the issuer changed the article or that delivery occurred. These URL-free counts describe only the work selected for the
current internal batch; they do not promise retrieval or subscriber-delivery
timing.
The operations preview also shows whether automatic AI drafting is off,
misconfigured or enabled, plus URL-free queue totals, rolling request and token
budgets and the earliest aggregate retry time. A provider `Retry-After` can
therefore be distinguished from an immediate retry without exposing a source
URL, response header or response body. Generated drafts remain private and
still require human approval.

The operations preview exposes a URL-free aggregate for first-party
supplemental routes. It separates recently successful, stale, failed and
never-successful routes, and counts publication evidence with an issuer
timestamp separately from date-only evidence and missing publication time.
Failed routes are grouped into access restriction, rate limit, timeout,
first-party 5xx, invalid response, partial article retrieval and other fixed
categories.
The first failure time and bounded attempt count for each route persist until
recovery. The private operations aggregate reports only the 24-hour sample
count, average and maximum failure-to-recovery time, average and maximum total
attempts, and latest recovery time. Route identity, URL, status code and raw
error remain private. Existing historical recoveries are not estimated.
For a route that is already failed, the monitor also persists the bounded
interval from its valid retry-eligibility timestamp to the next actual request
start. The preview exposes only the latest 24-hour sample count, average and
maximum wait and last attempt time. Pre-migration retries remain unmeasured;
invalid, early, timezone-free or over-seven-day intervals are discarded. This
is internal worker-scheduling evidence, not source detection or delivery
latency, and it contains no route identifier, URL or raw error.
While an outage is still active, the same view reports only the number with a
valid measurement, the number that predates measurement, the longest current
age, average and maximum bounded attempts, and the oldest measured start time.
The same measurements are split by the fixed safe error categories so a short
timeout is not confused with a long access-control restriction.
Invalid, future, timezone-free or over-seven-day values are excluded instead of
estimating missing history. These are processing observations, not a recovery
or delivery-time guarantee.
Top-level supplemental checks and their bounded article-body children share
the same retry policy. Access restrictions back off from six hours to at most
seven days, while ordinary transient failures retain the shorter retry path
and six-hour ceiling. A valid `Retry-After` is honored up to the applicable
ceiling. Only the fixed error class and next-check time are retained; response
headers and bodies are not stored in retry state.
The same aggregate separates retries that are due, deferred or missing a valid
schedule, both overall and by fixed error category, and exposes only the
earliest bounded retry time for each aggregate. This keeps a long access-control
backoff visible even when a shorter timeout retry is due first. It excludes
invalid or more-than-seven-day future values and never exposes which route
failed.
For HTML indexes, currently failed child articles are also counted separately
by the same fixed error categories. Their due, deferred and unscheduled retry
counts and earliest bounded retry time are reported overall and by category.
The first observed failure time and consecutive attempts remain private until
that child recovers. Recovery creates a bounded, URL-free measurement with the
failure/recovery timestamps, total attempts including the successful request,
and a fixed error category. The preview aggregates only the latest 24 hours:
sample count, average and maximum recovery time, average and maximum attempts,
and latest recovery time. Invalid, timezone-free, future or over-seven-day
measurements are excluded. These are observations, not retry or delivery
guarantees.
Successful children are excluded, stored state is bounded before aggregation,
and no child URL, title, HTTP status, validator or raw error reaches this
operational summary. When a child retry becomes due, one bounded maintenance
slot prioritizes it ahead of untouched historical imports; up to two new-story
slots remain available, and remaining capacity continues the history queue.
After any due hostname recovery probes reserve their slots, one remaining body
batch slot is reserved for the oldest valid unfetched release. The first slot
normally follows new-release priority. If the newest and oldest candidates
share a hostname, the oldest replaces the newer candidate for that hostname in
the maintenance batch instead of violating the one-request-per-host limit; the
newer item remains eligible for the next cycle. The private preview reports
only whether this URL-free fairness slot was scheduled, its validated wait age,
and whether a same-host replacement was required. Continuous arrivals therefore
cannot indefinitely starve an older detected release.
Route state transitions are retained privately across worker restarts and the
preview exposes only rolling 24-hour totals for recovery, renewed failure and
error-category change, plus the most recent transition kind and time. A
repeated failure in the same category does not create another transition, so a
persistently blocked route cannot inflate the failure total. Transition
retention is capped by age and row count.
The aggregate excludes external-research and opt-in X API routes and never
contains route names, URLs, titles or raw errors. A recently successful route
is an operational observation only; it does not prove complete coverage or
subscriber-delivery latency.

Palantir has two separate first-party discovery paths. The investor-news
pipeline retains the official press-release sitemap filter; the supplemental
signal pipeline also checks the public Palantir sitemap for English shareholder
letters matching the strict `/qN-YYYY-letter/en/` shape. The latter extracts
only Contentful rich-text leaves from the page's public `__NEXT_DATA__` payload,
without executing JavaScript or treating metadata and navigation as evidence.
Other languages, landing pages, media entries and off-domain URLs are ignored.
When that extracted shareholder-letter body contains its English publication
date, the monitor stores it as a date-only value. It does not invent midnight,
convert that date to JST or treat Contentful creation metadata as publication
evidence. The review screen labels the clock time as unpublished.
The first pass is historical baseline evidence, not a new-news claim, and all
items remain private and human-review required.

Article-body batch metrics are persisted separately from the in-memory worker
state. The operations preview can therefore show the last completed batch and
24-hour checks, errors and HTTP 304 reuse after a service restart. For newly
detected release URLs, it also records the measured interval from discovery to
the first completed body extraction as an average, maximum and sample count.
An independent singleton heartbeat records the most recent worker poll and
pending count even when no article is due. This prevents an old successful
batch from looking like current worker activity after a restart or stalled
loop; an overdue heartbeat degrades health without exposing queued URLs.
This is processing evidence after detection, not a subscriber-delivery SLA. These
metrics contain no source URLs, validators or article text and retain at most
20,000 batches, enough to preserve a full 24-hour window even at the minimum
five-second worker interval. Future-dated batch rows are excluded from both the
latest result and the 24-hour aggregate. Rows with invalid numeric types,
out-of-range counts, impossible latency totals or reversed timestamps are also
excluded, as are malformed heartbeat pending counts. Clock or database
corruption therefore cannot replace observed processing evidence. The
configured batch size is capped at 100.
Access-control responses (HTTP 401, 403 and 451, plus verification pages) also
open a private, persistent hostname circuit. While that circuit is active,
other queued URLs on the same official hostname are deferred without another
request; at most one URL per hostname is attempted in a batch. Only a
successful direct body check closes the circuit. Inline RSS or Atom evidence
can satisfy a source without a body request, but it does not prove that the
linked article host has recovered. The preview exposes only the number of
host-deferred bodies, not hostnames, URLs or errors. Timeouts and other
transient failures remain URL-scoped. This reduces repeated traffic without
bypassing an official site's access controls.
HTTP 429 rate limits use the same conservative circuit. A valid server
`Retry-After` is honored up to the circuit's seven-day ceiling instead of
being shortened to the six-hour transient-failure ceiling. When a short SEC
primary filing requires its same-accession index or EX-99.1, transport errors
from that official follow-up request retain their bounded error class instead
of being flattened into a missing-exhibit error. A 403 or verification page can
therefore pause the SEC hostname without publishing the accession or URL.
The operations health view groups SEC evidence failures into fixed aggregate
counts for access control, rate limiting, timeout, official 5xx, missing
exhibit evidence and other failures. It never returns the raw HTTP code, URL,
accession number or exception text. This lets operators verify that a due SEC
record moved into conservative backoff without exposing source identifiers.
When a hostname circuit reaches its retry time, the worker admits only one
URL from that hostname as a recovery probe. Another access-control response
immediately reopens the circuit before any second URL on that host is tried.
Recovery-probe outcomes are persisted as URL-free aggregates. The operations
preview shows the latest recovery, renewed restriction or transient failure and
24-hour counts after a restart, without returning the hostname, URL, HTTP code
or exception text.
Each new probe also persists the circuit's validated eligibility timestamp and
measures eligibility-to-attempt wait time. The preview exposes the latest wait
and bounded 24-hour sample count, average and maximum only. Pre-migration probe
rows remain unmeasured rather than receiving an inferred due time. This is
internal worker scheduling evidence, not article-detection or subscriber-
delivery latency.
The 24-hour reservation breakdown also derives an outcome-unmeasured count for
each queue partition. It is the bounded difference between selected work and
the persisted extraction, failure and 304 outcomes. This makes partially
migrated historical rows explicit instead of silently treating them as success
or failure; newly recorded complete batches have zero unmeasured outcomes.
The same view also reports how many expired circuits have an eligible queued
body and how many single probes were admitted to the current batch. These are
aggregate counts only: a due circuit with no eligible body is not presented as
ready, and no hostname or URL is returned.
For selected article bodies with a valid `next_fetch_at`, each completed batch
also persists the bounded interval from eligibility to the batch's actual
request start. The preview exposes only the latest and 24-hour sample counts,
average and maximum wait; legacy batches remain zero-sample instead of receiving
inferred timestamps. Invalid, future or over-31-day waits are discarded. This
is internal worker-scheduling evidence, not article-detection or subscriber-
delivery latency, and it contains no URL, hostname or error detail.
Each completed article-body attempt also records its bounded processing time
from worker start through response handling and text extraction. The preview
exposes only latest and 24-hour sample counts, average and maximum duration;
legacy batches remain zero-sample and invalid or over-one-hour values are
discarded. This isolates fetch/extraction work from the eligibility wait and
from the detection-to-first-body metric. It is internal processing evidence,
not a polling interval or subscriber-delivery guarantee, and contains no URL,
hostname, body text, HTTP detail or exception.
New batches additionally partition the same processing-time samples into
successful responses (including validator reuse) and failed attempts. The
partition must cover every newly measured attempt and match the batch error
count; inconsistent rows are excluded. Legacy batches remain unpartitioned
rather than being inferred, so operators can tell whether a high aggregate is
normal extraction work or failure handling without exposing source identity.
After a restricted recovery probe reopens the circuit, subsequent worker cycles
perform no request to that hostname until the new retry deadline; those idle
cycles also do not increment the recovery-probe counters.
The body backlog reports rate-limited retries separately from other
access-control retries. Older backends that do not provide this aggregate stay
display-compatible and are treated as having no observed rate limits.
It also partitions every remote-body row into never fetched, fetched but still
missing extracted evidence, or successfully extracted. The three URL-free
counts must sum to the reported total. This distinguishes missing evidence from
routine rechecks without exposing source URLs, article text or error details.
The never-fetched count is further divided into newly detected release URLs and
historical baseline imports. Only durable `release_events` evidence qualifies a
URL as newly detected; baseline imports never create those events and are not
retroactively inferred. These aggregates describe evidence state, not complete
source coverage or a delivery-time guarantee. Older backends omit the detail
and remain display-compatible.
For unfetched newly detected releases, the preview also reports the oldest
validated detection timestamp and maximum measured wait. Future, timezone-free,
invalid or over-31-day intervals are excluded and counted as unmeasured. This is
a queue-age observation, not a promised fetch or subscriber-delivery time.
When inline first-party evidence replaces the last failed remote body for a
ticker, its stale body incident is resolved even though the hostname circuit
remains in force. Another failed remote body keeps the ticker incident open.

Official-list polling batches are also persisted as bounded, URL-free
operational evidence. The preview retains the last completed batch and
24-hour counts for checked routes, degraded results and newly discovered
sources, plus measured average and maximum request time across checked routes.
This evidence survives a service restart, retains at most 100,000 batches, and
contains no source URL, title, response validator, article body or exception
message. Future-dated rows are excluded from the latest result and 24-hour
aggregate. Invalid types, bounds, request-time totals and reversed timestamps
are excluded from both views as well. The latest durable completion also
carries a bounded age and overdue state, so an old pre-restart result cannot be
presented as current worker activity. Once a completed durable poll exists, an
overdue completion independently degrades service health and opens a redacted
`discovery-poll-stale` incident; a fresh completion resolves the same incident.
An empty database remains a startup state rather than a fabricated failure.
The API also compares the latest durable discovery completion and body-worker
heartbeat with the current process start time. The preview can therefore label
restored pre-restart evidence separately from activity observed by the current
deployment, without publishing a process identifier or source details.
For TSM, MRVL, ANET, VRT and PLTR it also reports an aggregate count of
configured, post-start checked, healthy, degraded and pending companies. This
shows whether every priority route has actually run after a deployment without
publishing per-source URLs, timestamps or error details.
Future-dated or malformed company observations do not count as post-start
checks. Once every configured priority company has run, the preview reports the
measured interval from process start to the final priority check without
publishing any individual company timestamp. This is startup-processing
evidence, not publication or subscriber-delivery latency.
The first complete result for each service process is also persisted without
tickers, URLs, validators, exceptions or process identifiers. A later healthy
recheck can update the aggregate healthy/degraded counts while preserving the
original completion latency. Unchanged coverage is refreshed every five
minutes by default, while a healthy/degraded transition is written on the next
completed poll; failed telemetry writes remain isolated and retry on the next
poll. This keeps the durable last-observed time useful without creating a new
row for every discovery cycle. The operations preview can therefore distinguish
the current process's pending checks from the last durable completed run after
a restart. Future-dated, malformed and internally inconsistent rows are
excluded, and at most 10,000 process results are retained.
Polling configuration and observed request time are not delivery latency
guarantees.
Issuer-specific discovery timeouts keep a slow first-party index from holding
the complete concurrent polling batch. The timeout only advances that issuer
to its configured official RSS or SEC route; it does not retry around an
access control or turn the polling interval into a delivery guarantee.

Validation: `npm run lint`, `node --experimental-strip-types --test tests/*.test.mjs`,
and `npm run build`. Browser checks cover favorites persistence, company-page
toggles, calendar filters, and the four home destinations.

### Earnings coverage and maintenance

`calendar-coverage.json` tracks 40 companies independently of the 22-company
news monitor. A roster entry is not a confirmed next earnings date. Null
`lastCheckedOn` means a schedule review is still due. Do not interpret an empty
IR page or inaccessible JavaScript calendar as proof no event is announced.
`lastAttemptedOn` records the most recent real review attempt, including an
inaccessible or inconclusive source, without promoting it to a completed check.
Use that field to rotate the oldest attempts first; exact blockers remain in
`docs/CALENDAR-HANDOFF.md`.
The calendar UI distinguishes a conclusive official-source check with no
confirmed date from an inconclusive review that must remain pending; neither
state is promoted to a forecast date.
MU, Adobe and GE Vernova are call or webcast times; Netflix is an approximate release time. ASML's
October 14 official date and FOMC meeting dates with no published clock time are
displayed separately, without manufacturing a timestamp or converting the date
to JST/ET. A date-only item remains date-only for filtering and display.

The existing hourly Tech Phase development task also reviews calendar sources.
Review the oldest/unreviewed companies first in batches of up to 10, aiming to
revisit each within 24 hours; failures remain pending with blockers recorded.
`docs/CALENDAR-HANDOFF.md` records those blockers and the next batch; only a
conclusive schedule check advances `lastCheckedOn`.
Confirm dates and changes from first-party IR announcements, including exact
fiscal quarter, release vs call, timezone/UTC offset, source URL and review date.
Refresh BLS/Federal Reserve schedules as well. Commit verified updates only to
codex/research-preview, preserving concurrent changes. This is scheduled review,
not a live feed, a guaranteed refresh SLA, or a claim that all 40 dates are known.
No inferred/consensus date may be promoted to officially confirmed.

### Favorite earnings workflow (2026-09-23)
- Watchlist shows upcoming official earnings schedules for saved companies, with source links and language-based JST/ET formatting.
- Date-only announcements remain date-only; unlisted schedules are explicitly identified without inferring that no event exists.
- Calendar can filter to favorite-company earnings plus economic events, combined with its existing category/month/time-zone controls.
- Both pages reuse calendar data and a minute/visibility clock; expired calls disappear and stale schedule reviews are flagged.
- Favorites remain browser-local. No notifications, external feeds, subscriptions or production delivery were enabled.
