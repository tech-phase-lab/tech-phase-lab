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
24-hour checks, errors and HTTP 304 reuse after a service restart. These
metrics contain no source URLs, validators or article text and retain at most
20,000 batches, enough to preserve a full 24-hour window even at the minimum
five-second worker interval. The configured batch size is capped at 100.

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
