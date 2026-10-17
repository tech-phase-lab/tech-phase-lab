# Publisher category routing and durable history

## Scope and activation

This candidate activates only the existing SK hynix STORY publication route in
`signal_sources.json`. Aggregate gates, deployment and normal-poll readback remain
separate verification steps. Existing source cadence,
model, approval and shared budgets are unchanged; there is no new source, provider,
query or independent request loop.

Reviewed SK hynix source configuration included in this candidate:

- `officialUpdates: true`
- `requireCurrentDocument: true`
- `publisherArticleCategories: {version: 1, allowAny: ["STORY"], denyAny: ["Media"], maxAgeSeconds: 900}`

Only the independently observed STORY taxonomy is allowed. Media denies even
when STORY is also present. Source-level fail-closed scope prevents removing the
policy from downgrading SK hynix into legacy headline-only admission. No article
IDs, URL suffixes, title prefixes or body-length heuristics admit an article.

## Evidence and normal polling

Existing RSS acquisition atomically stores bounded complete-feed snapshots and
ordinary evidence. Snapshots bind source/config/alias fingerprint, configured and
actual effective feed URLs, parser version, response-byte hash, categories and
exact document/title/publication/truncation identity. Current heads retain a
monotonic generation and actual observation time; semantic changes append history.

Durable per-URL feed and article evidence each retain their latest explicit
classification, raw-evidence hash and verification time. Their semantic history
is append-only. An authorization epoch changes for denial, source revision or body
changes and reversions; unrelated new feed entries and agreeing same-body refresh
cannot waste an in-flight claim. Positive article evidence is revision/config
bound. A negative article response remains a URL-bound restriction across RSS
revisions and configuration migrations until a valid current article clears it.
A repeated positive feed or matching 304 cannot erase an article Media/invalid/
HTTP404/410 result, and an article STORY cannot erase explicit feed Media.

Parser version 2 requires a normal full-response migration. Missing/incompatible
category state, policy/parser changes or unknown effective URL removes conditional
validators on the next scheduled poll. Only an actual HTTP304 with the exact
outgoing ETag/Last-Modified, same effective URL, source fingerprint, route/head and
existing durable evidence can renew current-feed observations. No category state
is created from304. Omitted articles are never freshened by an unrelated feed304.
Slow responses and slow HTTP/XML failures cannot replace a newer route/category
head. HTTP/parsing runs before the acquisition writer lock; commits compare the
captured source, route and head under `BEGIN IMMEDIATE`.

Ordinary acquisition remains intact when category metadata exceeds its bounds.
Category lists are not truncated into an allowed prefix. Oversized category URL
metadata is explicitly held, while the ordinary full URL/document is retained.
Read contexts use bounded batched SQL and never migrate or write category state.

## Omission, display and fresh claims

Rolling-feed omission changes current membership, not the last verified category
fact. Historical headline metadata and validated saved copy remain visible for
unchanged retained revisions under all existing seven-day, primary ownership,
source-policy, body hash and content gates. No publication, source or acquisition
clock is relabeled as newly published because evidence was refreshed.

Public category evidence reports its real `verifiedAt`, feed/article kind,
`currentFeedMember`, `freshForGeneration` and `current`/`last-verified` status.
The900-second requirement applies separately before new paid headline/research
claims and their result saves. Expired historical rows cannot reserve budget.
Pending diagnostics exclude them and optionally count `awaitingSourceRefresh`.

The existing article-body worker can refresh an omitted known STORY, including a
previously denied article awaiting a publisher correction. It does not fetch
explicit feed Media/invalid entries or add a new polling timer. A newly validated
article category/body refresh can satisfy the existing fresh-claim gate. Identical
body refresh preserves the first body timestamp and original body proof; separate
category evidence records the new response's raw hash and verification time.

Missing/ambiguous article categories and actual HTTP404/410 responses withhold
publication without deleting source or saved-copy history. A revised body cannot
reuse old saved copy or an in-flight old-body claim. Original event and publisher
clocks remain unchanged. Private model-attempt/cost records are preserved normally.

## Independently verified article template

The publisher has an empty logo H1, one exact `h2.post-title`, matching canonical/
Open Graph URLs, and independently declared “SK hynix Newsroom” branding. Only the
category-configured supplemental reader opts into this host-scoped heading rule;
primary article validation and other publishers retain their existing behavior.

Category refresh reads only the unique current article header chain:
`main#main-content > div.post-wrap > article.post > header.post-header > div.post-inner > div.post-category-wrap > a.post-category`.
The exact source title must be in that header. `post-inner` alone is not unique;
menus, summaries and related cards never supply proof. STORY binds the observed
`/en/category/story/` taxonomy; Media binds `/en/category/media-library/media/`.
Unknown paths, label/URL disagreement, duplicate attributes or nested ambiguity
are explicit invalid evidence states.

A unique, unambiguous, closed `div.post-contents` is required. Missing, duplicate,
void or empty selection cannot fall back to related cards/main. The publisher
fixture reproduces retained event1139's11,036-character body exactly, SHA-256
`77a533eee6d9d8e6a10ff4775c4404a42989f1b4f2623ded227d4de8c252f954`.
No article publication date is inferred from related cards or HTTP metadata.

## Offline acceptance

Focused tests cover published STORY→feed omission→900-second expiry→same-revision
article refresh→explicit Media→STORY recovery→revised body; readonly history,
shared-budget admission, denial across source-policy/RSS revisions, unexpected
article304 and feed304 races, stale article success/failure, primary ownership and
template ambiguity. The exact retained event1139 replay preserves original source,
acquisition and publication clocks through same-body refresh. It uses one mocked
publication response and no real provider/network/runtime action. Runtime deployment and live publication readback remain unperformed.
