# Manual PRO columns — September 28, 2026

## Scope

The owner deferred Stock News API and OpenAI API/model setup. Priority 2 remains
incomplete: no live paid-provider bilingual generation/timing claim. Proceed with
priority 3 independently. Recommended launch preparation: connect providers 3–4
weeks before starting, leaving at least two weeks for continuous observation;
this is a project planning recommendation, not a delivery guarantee.

`/research/editorial` provides one manual editor for 週刊 Tech Phase PRO,
リサーチQ&A, and リゼルのひとりごと. It links from the existing private review page.
The existing editor token protects list, save and publication endpoints; the UI
keeps the token only in memory and never calls an AI provider. Changing tokens
resets the workspace; unsaved reload/close receives the browser warning. Save before following another
page link. Switching records requires saving or explicitly discarding changes.

Drafts allow incomplete translations. Weekly and Q&A publication requires titles, public intros
and bodies in both languages, private evidence/owner notes, a named reviewer,
a reason and an explicit verification checkbox. Weekly and Q&A also require
at least one HTTPS source. RIZEL notes must originate in the owner's actual
statements; the UI reminds editors not to invent opinions or transactions.
Q&A is curated editorial content, not an inbox or a promise of individual answers.

## Persistence and revision rules

SQLite `editorial_posts` stores current content; `editorial_post_history` retains
snapshots and publication/withdrawal reasons. Every save/review increments a
version, checked inside `BEGIN IMMEDIATE`. Stale saves and stale approval requests
fail without overwriting current content. Client-generated IDs make retries of
creation conflict instead of producing duplicate posts.

An existing record's kind is immutable. The owner-note endpoint also binds review
and withdrawal requests to `notes`, so a crafted weekly or Q&A ID cannot be
converted, published or withdrawn through the simpler owner workflow.

Saving any published article puts it back in draft and removes it from the member
list until explicitly republished. The UI states this before saving. Withdrawal
retains data and history; there is no destructive delete, scheduler or push send.
The editor loads 20 records per page, with older records accessible via pagination.

## Member display

`/research/columns` shows the newest 20 published columns, with category filters
and JP/EN selection. It is linked from My Account. Anonymous and Free visitors
receive only public titles/intros. PRO bodies are projected only after verified
server-side membership/expiry checks; neither private evidence notes nor reviewer
identity is in this response, even for PRO. Route responses are private/no-store.
Bodies use plain text React rendering, never raw HTML.

A premium response lease is at most 60 seconds and bounded by membership expiry.
The browser clears content at the deadline and refetches; focus and membership
changes also recheck. Withdrawal reaches an already open page at the next refresh,
not instantaneously. Browser suspension and already-read/copied content are not
revocable. Unavailable membership or service fails closed without retaining bodies.

## Verification

Isolated SQLite and HTTP tests cover persistence, publication/withdrawal, stale
writes, re-review after editing, required translations/evidence, unsafe links,
archive pagination, and separate editor/reader authentication. Node tests exercise
the actual editor proxy and member route, covering Free/anonymous/expired PRO,
active PRO, identity failure, expiry during upstream fetch and private-field
projection. All test content is synthetic and local. Do not seed live member
content or claim a real editor save/account transition from these tests.

## Live preview verification follow-up

### September 28 afternoon — publication lifecycle and simpler writing

- Saved an explicitly synthetic notes record `verification-note-20260928` through
  the staging admin HTTP API (version 1), published it (version 2), and observed
  its title/intro in the signed-out notes page. The body remained behind the PRO
  requirement. No personal opinion or investment advice was attributed to RIZEL.
- Withdrew it (version 3), then saved it as draft (version 4). This tests the live
  backend publication lifecycle, not a browser editor save interaction. The prior
  private weekly sample was untouched. No push notification was sent.
- The editor now starts with Japanese writing, with an English toggle, a sticky
  draft-save bar, character count, and collapsed source/memo fields. Existing
  bilingual publication requirements and editor-token authentication remain.
  Account navigation exposes an authoring link only to a verified admin.
- Remaining live checks: a signed-in PRO viewing this editorial body; browser
  editing/saving with the editor credential; phone delivery rejection at expiry.
  The prior signed-in historical-research check does not prove editorial-body
  display. These are explicit launch gates, not completed tests.

The editor page deployed successfully. The first member-list browser check
exposed a missing Clerk proxy matcher for `/api/research/posts`; identity lookup
failed closed with no content. Added that route to the existing identity proxy
and a regression using the installed Next matcher utility for every membership
API. No identity-provider configuration or actual membership was changed.

## Japanese-first owner notes — September 28 evening

`/research/write` is the simple owner composer: Japanese title and body, save,
publish and withdraw. `/api/research/author` requires verified signed-in admin
membership, same-origin JSON writes and a server-only RESEARCH_EDITOR_TOKEN.
The key must match the backend editor key; missing configuration fails closed.
Owners never enter this key in the composer. Reader credentials are not editors.

Notes can publish Japanese without English, sources or a manual English review.
Changing Japanese invalidates the previous English translation. The English
reader view marks these notes as pending rather than displaying stale English.
Automatic translation and retry processing were added in the evening follow-up.
Provider configuration and real-model evaluation remain deferred to December;
no live translation is enabled yet.

Approved translation policy: natural conversational English a native speaker
would use in a personal investing note. Prefer contractions and direct, friendly
phrasing; avoid formal analyst-report language, forced slang and hype. Preserve
uncertainty, numbers, ticker symbols, personal voice and paragraph meaning. Never
add opinions, trades, recommendations or certainty. No mandatory human English
approval step. Planned flow: Japanese publishes immediately, English publishes
automatically after successful translation of the same revision. Failed jobs
remain pending and must never restore an obsolete revision.

### Translation worker follow-up

The Railway worker polls every 30 seconds only when NOTE_TRANSLATION_ENABLED=true,
OPENAI_API_KEY and NOTE_TRANSLATION_MODEL are explicitly configured. No model
is selected silently. The default NOTE_TRANSLATION_DAILY_LIMIT is 20 logical
attempts per rolling 24 hours (accepted range 1–100). Each transport may retry
up to three HTTP requests; this is not a dollar spending cap. Output is bounded
to 6,000 tokens. Jobs use persistent five-minute leases and at most three
logical attempts per post revision, respecting longer provider Retry-After.
After exhaustion, Japanese remains public and English pending; owner republishing
a new revision permits another attempt. Model and numeric token usage are audited.
The provider receives only Japanese title/intro/body, not source notes or owner
identity. Successful output updates the same published revision atomically and
retains its original publication timestamp. Withdrawal or editing during a call
invalidates its output. Synthetic tests do not establish natural-language accuracy.

Owner composer setup remains blocked: Vercel Preview lacks RESEARCH_EDITOR_TOKEN
(last inspected September 28). It must match Railway's existing editor secret,
be scoped to codex/research-preview and stay server-only. Never use the reader
token as an editor credential; never put the value in chat, logs or git.

## Official update links — September 28 evening

The news page now exposes compact official headline/link cards independently of
paid-provider AI summaries. The allowlist includes Nebius blog and @nebiusai,
NVIDIA developer blog, plus the existing first-party TSMC, Marvell, Arista,
Vertiv and Palantir routes. Private excerpts, diffs, model analysis and reviewer
data are excluded. URLs are restricted to the configured official hosts/accounts,
and each displayed ticker must belong to that source's configured company set.
Latest revision per URL is shown once, capped at 20; old-dated baseline content
is excluded. The seven-day window and release order use absolute instants rather
than raw ISO text, including mixed UTC offsets. Times are explicitly discovery
times, never guessed release times.
The existing news UI refreshes every 30 seconds; this is not a seconds-level
source-to-screen guarantee. X @nebiusai adds a fourth route under the existing
shared daily request cap, without raising that cap. Fair pacing can lengthen
per-account latency; actual coverage and cost must be measured before launch.
The first successful X request is a baseline, not proof of live event latency.

Live read-only finding at about 18:44 JST: matching signal_events contained
NVIDIA Open Agent Safety Platform via GlobeNewswire at 18:02 JST and NVIDIA
developer posts at 17:56–17:58 JST. No corresponding Nebius X event was found.
This proves intake of related source material, not the publication or receipt
of Nebius's exact post. The uploaded screenshot is not used as publishable
source evidence. The official X route must retrieve the actual post first.
