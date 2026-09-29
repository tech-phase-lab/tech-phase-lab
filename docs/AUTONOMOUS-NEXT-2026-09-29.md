# Owner-absent continuation — September 29, 17:42 JST

Owner approved continuing unblocked work without their operation. Existing hourly Tech Phase automation stays active; do not create duplicate tasks. Preserve accepted UI (FAQ, guide, compact news/PRO hint, market macro-first layout and direct market navigation). Follow AGENTS gates, concurrent branch integration and exact Git tree matching. Preview only; no billing, paid activation, main, secrets exposure or outreach.

## This checkpoint

- Public official feed now preserves optional timezone-bearing publishedAt and date-only publishedOn separately from observedAt. Naive times are not promoted to exact timestamps. Old backend payloads still work with explicit acquisition labels.
- Frontend prefers source publication time, then publication date, then labelled acquisition time. Date-only stories never acquire midnight on screen. NEW requires an actual recent publication timestamp, not a recent scrape. Old stories discovered again cannot get NEW solely from discovery.
- Synthetic tests cover precision, source timezone conversion, invalid dates, old/future events and legacy payloads. Backend deployment readiness must be checked separately from code/test completion.

## Finite next priorities

1. Verify staging backend publication fields and source→discovery→screen latency. Do not equate poll interval with measured latency.
2. Build opt-in official headline translation worker: source/revision-bound durable cache, deduplication, retry/backoff, bounded attempts and cost caps, fake-provider tests, disabled until OpenAI credentials/model are approved in December. Publish only translated factual headlines automatically; keep evidence-based impact analysis behind its existing review workflow. Never turn on paid calls just because code exists.
3. Diagnostics: count untranslated items, oldest pending age, failures and retries; owner-only aggregate UI, no source bodies or secrets in public payloads.
4. Test missing/duplicate stories, stale feed and reconnect recovery. Streaming delivery must preserve auth and public payload boundaries.

## 18:48 JST progress

- Priority 1 acquisition measurement is implemented as a bounded, URL-free
  24-hour `source publication → first monitor observation` aggregate. It does
  not claim browser or delivery latency. The previously observed 111-second
  Nebius item remains a single observation, not an SLA.
- Priority 2's dormant worker foundation is implemented: exact source/revision
  cache binding, deduplication, leases, three logical attempts, retry/backoff,
  daily limit and offline fake-provider tests. It remains disabled pending the
  December key/model decision; no paid request was made.
- Next: expose aggregate untranslated/pending/failure diagnostics without
  source text, then add missing/duplicate/stale/reconnect recovery coverage.

## 19:48 JST progress

- Finite priority 3 is implemented: the owner operations view now distinguishes
  disabled, misconfigured and enabled headline translation, and shows only
  bounded aggregate counts/timestamps for untranslated backlog, oldest pending,
  retries, exhausted jobs and 24-hour outcomes.
- Diagnostics never include URLs, headlines, publisher IDs, source evidence,
  model names, provider responses or error details. Disabled mode explicitly
  says no external transmission; no credential or paid-provider change was made.
- Next finite priority: add duplicate/missing official-news and stale/reconnect
  recovery coverage, preserving auth and public payload boundaries.

Stock News API and OpenAI remain uncontracted/unconfigured by owner choice. Seconds-level Japanese display is a target, not verified. Affiliate links await replies to the three emails the owner already sent. No invented personal posts, recommendations or affiliate approvals. At finite backlog completion stop extra product edits; separately authorized calendar maintenance continues.

## Owner market revision, September 29 evening

- Supersedes the nested chart/theme switch: indices, bond ETFs, FX, sector performance and heatmap are directly visible; sector performance opens by default. Mobile navigation wraps into two rows.
- Removed the promotional theme heading and intro; added cybersecurity, gold miners, software and space constituent groups. The display remains selected stock returns, not an aggregate sector index.

## 20:41 JST finite news-readiness completion

- Duplicate current official URLs and reviewed article IDs/URLs are removed at
  the public validation boundary after every item passes the existing allowlist
  and field checks. Optional missing official-update lists remain compatible.
- Failed news reads clear both the home pulse and stale module cache, retry from
  5 seconds with a 30-second cap, and wake immediately on browser online/visible
  recovery. Concurrent wakeups coalesce and unmount aborts cleanly.
- Offline regressions cover duplicate/missing records and failure-to-success,
  wakeup and abort paths. This completes finite priority 4 without enabling
  streaming or claiming measured end-to-end delivery latency.
- The finite news-readiness backlog is now code-complete. Stop discretionary
  product edits; continue only the separately authorized calendar maintenance,
  deployment verification and exact blockers. Automatic headline translation
  remains OFF pending the December provider/model/credential decision, and live
  preview monitor connectivity remains the outstanding verification blocker.

## Owner revision 20:44 JST

- Market starts with indices again. Three chart categories show compact familiar examples (S&P/NASDAQ, SHY/IEF/TLT, USD/JPY/EUR). Sector themes use one compact dropdown instead of wrapping chips, removing duplicate headings/constituents and extra explanatory/source paragraphs. Original widget attribution stays intact.
- Home news supports horizontal touch swipes and keyboard left/right navigation, preserves vertical scrolling, suppresses link activation after a swipe and pauses automatic rotation while touching.

## Owner revision 20:58 JST

- Home rotating news shows its full available headline/summary with wrapping and no external link. Swipes remain supported. This does not imply the full source article is available.
- Market labels reverted to plain indices / bond ETFs / forex; compact theme dropdown retained.
- Changes view now explains earnings / partnerships / business plans, removes duplicate title, derives review date from stored records, and shortens attribution/footer. It is still curated stored research, not automatically updated from the official-news feed. Do not claim live analysis or refresh old article dates without reviewing sources.
