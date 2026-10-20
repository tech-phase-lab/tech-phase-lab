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
