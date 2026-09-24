# News coverage: missed-event investigation

Checked: 2026-09-24 UTC. The initial investigation is followed by a local
implementation and real-source verification below. Remote deployment and
publication remain off.

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
  Full browser-to-service verification remains incomplete: this environment had
  no browser binary and the browser download failed. Mobile/desktop appearance
  has not been visually verified. Do not present the build as deployed or as a
  successful complete live browser check.

## Still required

- Dedicated product/document sources for remaining issuers; current shared
  feeds do not establish comprehensive per-company coverage.
- Authorized X stream, broader search, semantic cross-publisher deduplication,
  X deletion/correction handling, and source-bound AI drafts for this queue.
- Permissions for commercial publisher material, a reviewed publication policy,
  and real live end-to-end latency measurement.

## Deployment state

Local read-only ingestion was executed. No paid API, external notification or
remote recurring job/deployment was enabled. Preview push remains blocked pending
confirmation that the preview branch cannot update the Railway production
monitor identified in the previous deployment review.

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
