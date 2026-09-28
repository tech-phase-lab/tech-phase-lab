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

Drafts allow incomplete translations. Publication requires titles, public intros
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
