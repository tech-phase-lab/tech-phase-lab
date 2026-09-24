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

AI-assisted news drafts retain their AI provenance after human edits and
require a separate human-verification acknowledgement before approval. The
reviewer must compare the official source, evidence quotes, factual summary,
impact interpretation, and numbers. The private audit history retains that
acknowledgement; public data excludes AI-assisted drafts whose matching
approval lacks it.

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
HTTP 429 rate limits use the same conservative circuit. When a short SEC
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
