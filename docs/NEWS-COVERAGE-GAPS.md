# News coverage: missed-event investigation

Checked: 2026-09-24 UTC. The initial investigation is followed by a local
implementation and real-source verification below. The isolated staging deployment is now running; publication remains off.
See MONITOR-ISOLATION-AND-COVERAGE.md for the current deployment evidence.

## Confirmed gaps

`lib/research/providers.json` configures NBIS newsroom and SEC submissions.
The NBIS allowlist does not include `docs.nebius.com`, SemiAnalysis, or X.
`lib/research/data.ts` already contains manually authored spot-pricing and
ClusterMAX notes. Those notes do not demonstrate automatic acquisition.

The existing monitor retains revisions of known source bodies. It does not
currently discover these external research articles or watch the relevant
product documentation as first-class change events. Reuse the revision machinery
where possible rather than building a second article store.

## Concrete acceptance cases

### NBIS: preemptible VM spot pricing

- Existing note cites https://x.com/nebiusai/status/2102398298833190969
  and https://docs.nebius.com/compute/virtual-machines/preemptible.
- The documentation was fetched directly with Python urllib: HTTP 200,
  488,137 bytes, and spot-pricing text present. A separate rendered web read
  confirmed the pricing-policy and follow-spot-price passages.
- The X post was not retrievable through the web tool in this investigation.
  Do not infer the announcement date or October 8 launch date from the current
  documentation alone.
- Needed: authorized X account stream plus targeted document-body change
  monitoring; preserve the old/new relevant passages and first-observed time.
- New-URL discovery alone cannot detect an update to this same URL. Initial
  baseline acquisition must not be presented as a newly published announcement.
- https://docs.nebius.com/changelog is an additional product-update source;
  its latest visible section was September 14–20. Do not assume it carries each
  X announcement immediately.

### NBIS: ClusterMAX Platinum assessment

- Feed: https://newsletter.semianalysis.com/feed
- Article: https://newsletter.semianalysis.com/p/clustermax-30-the-industry-standard
- A Python streaming XML probe located the article in the live RSS response.
  Its title was `ClusterMAX 3.0: The Industry Standard GPU Cloud Rating System Returns`.
- Feed publication time: `Wed, 23 Sep 2026 21:20:29 GMT` (publisher-supplied;
  not an observed original delivery time).
- Title contains neither Nebius nor NBIS. Feed body contains Nebius and
  Platinum. The target item completed after 589,824 bytes in this probe.
- A first probe cut the full feed at 2,000,000 bytes and failed XML parsing.
  This was our truncation, not evidence of a broken publisher feed. Stream
  complete items within explicit resource limits; do not parse truncated XML
  as a complete document or silently mark an oversized feed healthy.
- Needed: discover publisher articles before ticker filtering, match names in
  accessible article/feed bodies, and route one event to multiple relevant
  tickers. A title-only filter or X rule requiring NBIS would miss this case.
- Treat this as the research publisher's assessment, not an issuer announcement.
  Public access does not establish commercial reuse rights. ClusterMAX's public
  site includes commercial-use restrictions; resolve permitted uses before
  exposing publisher-derived material to end users.

## Acquisition design

1. Issuer IR, product blogs, change logs, pricing/docs, partner announcements,
   and research-publisher feeds are registered by source identity and type.
2. For selected high-value X authors, receive all their original posts before
   stock matching; use official API access. Broader keyword rules supplement
   rather than replace these author rules. Store account IDs to avoid relying
   only on mutable handles.
3. Follow permitted public source links with validated destinations, redirect
   checks, time/size limits, and no credentials or access-control bypass.
4. Resolve company names, aliases and products in bodies, not only tickers in
   titles. Preserve ambiguous matches for review. Deduplicate the same event
   across issuer, publisher and X paths, with evidence for each association.
5. Automatically prepare source-linked factual drafts. Separate publisher
   claims, independently corroborated facts, and interpretation. A reputable
   author alone does not prove every post. Keep existing publication gates until
   a reviewed automatic-publication policy and quality evaluation are approved.
6. Periodic broader discovery can find sources outside the curated set, but
   search indexing and polling cannot guarantee second-level freshness.

## Verification required before claiming coverage

- Replay both cases through acquisition, stock association, event deduplication,
  and private review intake, with production delivery and paid calls disabled.
- Include a title without a ticker, a same-URL update, an irrelevant post,
  an old repost, a correction/deletion, duplicate independent paths, and an
  interrupted stream followed by recovery.
- Record publisher time (nullable), first observation, body acquisition, draft
  completion and display time separately. Never label historical imports as live.
- Measure live delivery only after approved connections are active. The current
  successful read-only probes establish accessible routes, not historical
  latency or uninterrupted monitoring.

## Implemented locally after the investigation

- `scripts/research/signals.py` and `signal_sources.json`: shared publisher feed
  intake, body-based company-name/cashtag association for the current 22-company
  roster, and same-URL document revisions. Reuses existing HTML extraction,
  SQLite connections and error normalization; independent private tables keep
  external publisher claims out of the issuer-only approval/publication path.
- Six verified routes: SemiAnalysis RSS, NVIDIA Developer Atom, SK hynix RSS,
  Microsoft Blog RSS, Nebius preemptible-VM docs, and Nebius product changelog.
- One-off real-source run: all six succeeded; 141 baseline records (19, 100, 10,
  10, 1, 1 respectively); mentions associated with 12 of the 22 configured
  companies. This is not proof of complete coverage for those companies.
- ClusterMAX 3.0 reached the private queue from RSS without manually registering
  its article URL. Associated company mentions: AMD, AVGO, CRWV, GOOGL, MSFT,
  NBIS, NVDA, ORCL, PLTR. Mention matching is not an impact assessment.
- Default confirmation intervals: 60 seconds for SemiAnalysis, 120 seconds for
  other added sources, plus request/processing time. Conditional HTTP, persisted
  baselines, retry/backoff, capped bodies/retention, and publisher-once fetching.
- `service.py` can run a dedicated three-worker source loop with
  `RESEARCH_SIGNALS_ENABLED=1`; it defaults off. Network and parsing happen
  outside the shared database lock. Existing official-source intervals remain
  independent. No AI call, X API charge, notification or publication is made.
- `/admin/signals` requires the editor token even when no general API token is
  configured. The existing Next editor proxy and review page expose the private
  queue with company/type filters, publisher and observation timestamps,
  original excerpts, revision diffs and source health. Tokens stay in memory.
- Baselines are visibly distinguished from later observations. `new` means first
  seen after baseline, not a guarantee of newly published news. Missing publisher
  timestamps are left null. First acquisition cannot reconstruct past latency.

## Verification results

- Python suite: 178 passed, including 11 new ingestion/service tests.
- JavaScript suite: 94 passed, including authenticated signal-proxy forwarding.
- ESLint, production Next build and `git diff --check`: passed.
- Tests cover persisted baselines/validators across reopen, same-URL revisions,
  body-only company matches, invalid XML, failed first fetch and recovery,
  unapproved destinations, opt-in worker shutdown, and editor authentication.
- Real HTTP handler authentication and proxy forwarding were checked separately.
  Historical local verification limitation (resolved for staging below): this environment had
  no browser binary and the browser download failed. The later staging browser check is recorded under Deployment state.

## Still required

- Dedicated product/document sources for remaining issuers; current shared
  feeds do not establish comprehensive per-company coverage.
- **Priority next: X target-price signals.** Use the official Filtered Stream API
  with `from:<account>` rules for a reviewed list of analyst/news accounts, then
  apply target-price and rating-action checks to incoming posts. The X docs say
  matching posts arrive near real time (about 4–5 seconds P99), and the
  pay-per-use price table lists $0.005 per Post read. At that listed rate, 1,000
  returned Posts in a month would cost about $5; this is an estimate, and the
  Developer Console is authoritative for current rates and actual usage. Reading
  other accounts' Posts is billed separately from creating Posts, so an existing
  posting integration does not by itself establish read access or read pricing.
  Keep this opt-in until an authorized app/token and a spending limit are set.
- Separate technical ingestion from permission to publish X-derived material.
  X's developer policy restricts redistribution of X Content and says commercial
  use requires an appropriate paid tier. Before showing target-price values or
  copied excerpts in the subscriber-facing news feed, review the current terms
  for that exact use. Until resolved, route candidate Post IDs and source links
  to the private review queue; verify the analyst action against an accessible
  primary source where possible. Do not use scraping or browser automation.
- Broader search, semantic cross-publisher deduplication, X deletion/correction
  handling, and source-bound AI drafts for this queue.
- Permissions for commercial publisher material, a reviewed publication policy,
  and real live end-to-end latency measurement.

## Deployment state (updated 2026-09-24)

Isolated Railway `research-staging` is running with its own volume and newly
issued read/editor credentials. The old monitor's automatic deployment was
disabled before pushing. Vercel Preview variables are restricted to
`codex/research-preview` and now point to the staging monitor. Main and Vercel
Production were not changed. Paid AI and external delivery remain disabled.

Browser verification succeeded through the Preview editor proxy: the private
queue showed 174 imported records at 03:09 UTC, including the Nebius Platinum
and spot-pricing blog posts and the SemiAnalysis ClusterMAX article. These are
baseline imports, not measured real-time detections. Individual failures and
pending article bodies remain visible; 24-hour continuity is not yet verified.


## Anthropic expansion — 2026-09-24

Anthropic Newsroom is now registered as a seventh supplementary source. It is
an HTML index, not an assumed RSS endpoint. Initial connection probes to its newsroom, RSS candidate and sitemap returned
HTTP 403. A later read using the existing monitor transport succeeded: the
newsroom exposed 11 approved article links and the first batch imported three
article bodies as baselines. Earlier failures were not treated as successful
coverage; no access restriction was bypassed. This does not establish ongoing
availability or complete archive coverage. The specific NBIS-related article
mentioned by the user has not yet been identified/verified here.

Implemented a reusable HTML-index adapter: exact-host/path article discovery,
main/article body extraction, company association from the body, and private
retention of unassigned articles. Anthropic is not assigned to NBIS by default.
Unknown or indirect links remain an editorial question. Up to 100 discovered
URLs are retained; at most three article requests occur per index check. The
index is checked every 120 seconds; successful article bodies are revisited
after one hour using conditional HTTP. This is not a 120-second full-archive
or same-URL revision guarantee. Initial backlog items remain baselines even if
acquired across later checks or restarts. Failed article fetches and outstanding
bodies are visible; empty/client-only index shells fail rather than silently
reporting zero news. Public display, AI processing, X access and remote operation
remain disabled for this intake.

## Quality goals and order of work

1. **Operational isolation:** separate preview and production monitor deployment
   triggers, then validate a persistent private worker, restart recovery and
   failure visibility before describing the system as continuously operating.
2. **Per-company coverage register:** for each of the 22 companies, record issuer
   IR/SEC, product/docs, significant customers and suppliers, and relevant
   independent research. Each route needs URL, association reason, source type,
   expected freshness, permissions, last successful check and a concrete example.
   An unverified/blocked route is a coverage gap, never a green coverage badge.
3. **Discovery beyond the company:** collect partner/publisher originals before
   ticker filtering. Curated X authors and licensed streaming feeds can supplement
   these routes only after access and terms are confirmed. Periodic broader
   searches should audit omissions; they cannot promise instant indexing.
4. **Evidence-bound association:** distinguish explicit company mentions from
   supported customer/supplier relationships and inferred industry impact. Keep
   the supporting passage and relationship source/date. Never automatically label
   every Anthropic announcement as NBIS news or positive stock impact.
5. **Measured recall:** maintain an independently compiled important-event sample
   across companies and source types. Record discovered/missed events and causes,
   false matches, publication-to-observation latency (when publication time is
   reliable), observation-to-draft latency, duplicate and correction handling.
   Current unit tests validate mechanisms, not real-world news recall.
6. **Release gate:** propose 95% important-event recall on a reviewed sample as a
   goal, not an achieved score or universal guarantee. Require no silent source
   failures, linked evidence for every factual summary, and clear differentiation
   of news, publisher opinion and inferred impact before paid launch.

Validation for the Anthropic change: Python 183 tests passed (five new HTML-index
cases); ESLint and TypeScript checks passed. Browser rendering remains unverified.

Follow-up live checks acquired all 11 ordinary index articles, then identified
featured links outside `/news/`. The adapter now also accepts the newsroom's
configured featured-link class pattern (still restricted to the approved host).
Three featured article bodies were acquired, bringing the private Anthropic
baseline total to 14. Mentions included GOOGL, MSFT and NVDA; no NBIS match was
established in this sample. A configuration change schedules baseline validation
again, so outstanding work must not be presented as complete archive coverage.

## 2026-09-24: analyst rating and price-target changes

The current company and publisher monitors have no dedicated analyst-action
source. The user's example is a TipRanks X post stating that BNP Paribas moved
Nebius from Neutral to Outperform and raised its target from $260 to $399. Treat
the screenshot as a lead, not independently verified source evidence.

FMP's current TipRanks-powered Analyst Ratings Search API is a technically
relevant candidate: its official documentation says records include the analyst,
firm, recommendation, action (including upgrade/downgrade), price target, source
article headline/site/link, and date filters. Results are newest-first and are
explicitly described as suitable for activity feeds. This is closer to the
desired event feed than scraping social posts or inferring changes from aggregate
consensus snapshots.

Before use, obtain written confirmation of commercial display/redistribution
rights, access to this specific TipRanks endpoint, update latency, symbol coverage,
rate limits, retention, attribution requirements, and price. FMP's public pricing
page lists individual tiers but states that displaying or redistributing FMP data
requires a separate Data Display and Licensing Agreement. The public individual
prices therefore do not establish a usable Tech Phase commercial price or grant
display rights. No account, trial, API key, paid plan, or external contact was
initiated in this work.

### Existing vendor inquiries: relevant public API evidence

| Provider | Publicly documented fit | What the current quote still needs to confirm |
|---|---|---|
| Stock News API | Its examples include an `All latest Upgrades/Downgrades` request with price targets, backed by a ratings endpoint. | Whether the quoted Premium/Business plan and all-ticker coverage include that endpoint, its update delay, and commercial display rights. The public example does not settle those terms. |
| Benzinga | A dedicated Analyst Ratings API documents old/new rating and target, analyst/firm, action, timestamp, and importance. Overnight changes are posted before market open and intraday changes during the session. | Whether the current news quote includes the ratings product or prices it separately, and the licensed display, latency, watchlist and retention terms. |
| Intrinio | Its public catalog lists Price Targets under Enterprise and describes consensus high/low/mean targets. | Whether the requested NewsEdge/news package includes individual analyst-action events or only news stories, and the separate cost/licensing terms for analyst data. |
| finlight | Its public REST API documents searchable financial articles with ticker/entity metadata. | Whether analyst PT-change coverage is sufficiently complete and timely. No dedicated structured ratings endpoint was confirmed in the public docs reviewed. |
| Alpaca | Its public news endpoint returns articles and supports ticker/date filtering. | Whether syndicated articles reliably include PT revisions. No structured analyst-rating fields were documented in this endpoint. |

Therefore, a separate *vendor* is not automatically required. A news subscription may carry stories about target changes, while structured action fields often sit behind a distinct endpoint, dataset, or entitlement from the same vendor. Ask each vendor to include both the ordinary news feed and ratings actions in one quote, with an explicit line-item price and customer-display license. Do not treat aggregate consensus snapshots as a timely event feed.

If licensed, add analyst changes as a distinct event class in the private review
queue, then show the analyst/firm, previous and new rating, previous and new
target with currency, publication and first-seen timestamps, and a link to the
attributed source. Keep analyst opinion separate from issuer facts, do not infer
an investment recommendation, deduplicate repeated records, and require editorial
review before public display. The existing generic publisher monitor is not yet
connected to this structured API and the user-facing live news feed is not yet
enabled.

### X source scan: analyst target-price changes — 2026-09-24

Initial scan identified these candidate public sources. X account streams should
be limited to a reviewed set of accounts and the current 22-company roster;
these accounts post about the wider market, not only Tech Phase tickers.

| Candidate | Evidence and fit | Initial priority |
|---|---|---|
| Wall St Engine `@wallstengine` | The user regularly uses its target-price posts. Indexed examples include analyst, firm, old/new target and sometimes reasoning. Its source verification, update delay, and completeness have not been established; some posts include substantial report excerpts. | **High: include in the first comparison.** User relevance is strong; verify facts independently and do not reuse its report excerpts. |
| TipRanks `@TipRanks` | The user's example is from this account. Search-indexed X posts also show Microsoft and Oracle target changes with old/new values and rating context. TipRanks' site has a daily analyst-ratings section, and its enterprise API is separately marketed for structured ratings data. | **High: include in the first comparison.** Best match to the example post format; check coverage and arrival delay for our watchlist. |
| The Fly `@theflynews` | The Fly's public feed displays timestamped analyst actions, including upgrades and target-price changes, alongside broader company news. Its X account links to ticker pages; sampled posts include analyst calls and target changes. Feed access prompts for a trial, so public visibility is not a commercial reuse grant. | **High: include in the first comparison.** Strong newsroom candidate; high volume and broader scope need filtering. |
| Benzinga | The public Ratings pages expose structured analyst/firm, action, rating and target-price changes. Benzinga's API page says overnight changes are displayed three hours before the US market open and intraday changes are posted during the session. A systematic target-change X stream was not confirmed in this scan. | **Strong data/API fallback, not yet an X-first source.** Continue the existing vendor inquiry for price and display rights. |
| MarketBeat | Its public ratings pages describe newly published upgrades and price-target changes across US, UK and Canadian stocks. A systematic X account feed for the same events was not confirmed here. | **Discovery candidate.** Evaluate only if the first X accounts miss material events. |

The individual-influencer search did not identify a broad-coverage analyst who
consistently posts every target change. Influencer posts are useful as leads but
are selective opinions; the account's reach or reputation is not evidence that
the underlying broker action has been checked. Prefer a traceable news desk or
ratings feed for automatic coverage, with influencers as supplemental sources.

### First comparison run: three X sources × current 22-company list

Compare the three accounts above against the current 22-company Tech Phase
watchlist. This is three *source accounts*, not a decision to expand the ticker
universe. Do not add more accounts until this group shows a material coverage
gap.

The intended comparison window is 14 days, with a weekly review and extension
to 30 days if too few distinct analyst actions arrive. Use the official Filtered
Stream, not browser collection. Resolve stable X user IDs first. Match analyst
action phrases and company names/tickers; avoid ticker-only rules because a
post may name a company without its cashtag. Keep post-to-event links so the
same broker action found by two accounts is counted once, while each account's
arrival is measured separately.

For every candidate, record source account, Post ID, Post-created time, API
first-seen time, ticker, analyst/firm, rating and target before/after, currency,
independent confirmation URL/time, review outcome, duplicate/correction/deletion
status, and billable unique Post count. Compare:

- Useful signal rate: confirmed target/rating actions divided by matched Posts.
- Observed coverage: unique confirmed actions found by each source and by the
  union of all three, checked against independently observed rating feeds/news.
- Arrival delay: Post-created to API first-seen; and earliest independently
  known announcement time to API first-seen when that earlier timestamp exists.
- Misses, wrong values, stale/reposted items, duplicates, and edits/deletions.

The X stream's documented 4–5 second P99 describes X delivery after a matching
Post is published; it does not measure how quickly TipRanks, The Fly, or Wall St
Engine publishes the underlying analyst action. Report those two intervals
separately. Public search results and existing indexed examples do not provide
a reliable per-account daily volume or historical miss rate; those remain
unmeasured until the authorized stream runs.

Current listed read pricing is $0.005 per returned Post. Cost scenarios are
therefore $0.50 / 100 Posts, $2.50 / 500, $5 / 1,000, $15 / 3,000, and $50 /
10,000. X says repeated reads of the same Post are usually deduplicated inside
one 24-hour UTC window, but describes this as a soft guarantee. For the pilot,
configure a hard project spend cap (recommended ceiling: $20 total, equivalent
to 4,000 unique reads at the listed rate), leave auto-recharge off, and check
actual X Developer Console usage. This ceiling is a proposed guardrail, not a
claim that the three accounts will generate that many matches. Broad author
rules cost more; ticker/action phrase rules reduce volume but can miss unusual
wording, so report their filter-induced misses as well.

Keep all X candidates in the private editor queue during the comparison. Do not
publish them to Research/PRO or send alerts until both data-use terms and
editorial checks are approved.

### Rewriting and republication boundary

Japanese Agency for Cultural Affairs guidance says bare facts, data and ideas
are not, by themselves, copyright works. That supports writing an original,
fact-focused Tech Phase notice instead of copying an account's prose. It does
not by itself settle X API contract terms, source licensing, or whether a
subscriber-facing product may present X-derived values. X's current developer
policy separately restricts redistribution of X Content and requires commercial
use to be on an appropriate paid tier; changing the wording alone does not
remove those platform obligations.

Preferred editorial form after source/terms review:

> **目標株価変更｜MU** — 〇〇証券の△△氏が目標株価を **$X → $Y** に引き上げ。評価は **Buyを維持**。発表時刻: 9月24日 08:10 ET。出典: [元情報]・[X投稿]

Independently verify the action from the analyst firm, an authorized news feed,
or another permitted source. State ticker, firm, analyst (when known), rating
change, old/new target, currency, publication time and source link in Tech
Phase's own concise wording; add only Tech Phase's independently prepared
context (for example, how the target compares with a separately sourced
consensus). Do not import an influencer's commentary, distinctive explanation,
images, or long report excerpts. Attribution is good editorial practice but is
not a license. Keep an X-only signal private until X-derived data display terms
are confirmed. Store source IDs and honor edits/deletions and current-content
requirements.
