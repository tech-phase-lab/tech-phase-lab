# Owner-absent continuation — September 29, 17:42 JST

Owner approved continuing unblocked work without their operation. Existing hourly Tech Phase automation stays active; do not create duplicate tasks. Preserve accepted UI (FAQ, guide, compact news/PRO hint, market macro-first layout and chart/theme switch). Follow AGENTS gates, concurrent branch integration and exact Git tree matching. Preview only; no billing, paid activation, main, secrets exposure or outreach.

## This checkpoint

- Public official feed now preserves optional timezone-bearing publishedAt and date-only publishedOn separately from observedAt. Naive times are not promoted to exact timestamps. Old backend payloads still work with explicit acquisition labels.
- Frontend prefers source publication time, then publication date, then labelled acquisition time. Date-only stories never acquire midnight on screen. NEW requires an actual recent publication timestamp, not a recent scrape. Old stories discovered again cannot get NEW solely from discovery.
- Synthetic tests cover precision, source timezone conversion, invalid dates, old/future events and legacy payloads. Backend deployment readiness must be checked separately from code/test completion.

## Finite next priorities

1. Verify staging backend publication fields and source→discovery→screen latency. Do not equate poll interval with measured latency.
2. Build opt-in official headline translation worker: source/revision-bound durable cache, deduplication, retry/backoff, bounded attempts and cost caps, fake-provider tests, disabled until OpenAI credentials/model are approved in December. Publish only translated factual headlines automatically; keep evidence-based impact analysis behind its existing review workflow. Never turn on paid calls just because code exists.
3. Diagnostics: count untranslated items, oldest pending age, failures and retries; owner-only aggregate UI, no source bodies or secrets in public payloads.
4. Test missing/duplicate stories, stale feed and reconnect recovery. Streaming delivery must preserve auth and public payload boundaries.

Stock News API and OpenAI remain uncontracted/unconfigured by owner choice. Seconds-level Japanese display is a target, not verified. Affiliate links await replies to the three emails the owner already sent. No invented personal posts, recommendations or affiliate approvals. At finite backlog completion stop extra product edits; separately authorized calendar maintenance continues.
