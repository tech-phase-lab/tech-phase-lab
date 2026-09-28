# Private bilingual news generation and review

## Live connection checkpoint — September 28, 13:34 JST

Read-only Railway console inspection of the running research staging service
confirmed `STOCK_NEWS_API_KEY` absent, `OPENAI_API_KEY` absent, and
`RESEARCH_SUMMARY_MODEL` absent. Only presence booleans were printed for secrets;
no credentials were displayed or copied. `RESEARCH_AUTO_DRAFTS` is `0`.
`STOCK_NEWS_ENABLED`, `STOCK_NEWS_DRAFTS_ENABLED`,
`STOCK_NEWS_PUBLICATION_ENABLED`, and the three Stock News budget variables were
unset, so the implementation's disabled defaults and default ceilings apply.

No live Stock News or model request was made. Provider connection, actual model
quality and generation latency remain unmeasured; offline tests and deployment
success are not substitutes. Do not enable publication or invent credentials.

To resume, the owner must enter provider-issued credentials in Railway service
Variables (never in chat), choose the generation model, and settle the intended
test spending ceiling and provider distribution permission. Set only the needed
intake/draft switches for the bounded trial; keep public distribution OFF until
the content and permission checks are complete. No paid plan was purchased or
activated in this checkpoint. Connection work is blocked on configuration, not a
reported provider outage.

## Current checkpoint — editor UI and gated public display

Implemented September 28, 2026. `/research/review` now includes an ordinary-news
panel using the existing editor token (kept only in component memory). Editors
can load the latest 50 articles, inspect saved source text, edit Japanese/English
summaries, bilingual business-impact rationales and up to four exact excerpts,
save, and approve/hold/reject. Impact direction uses the fixed
positive/negative/mixed/neutral/uncertain labels plus high/medium/low confidence;
uncertain is accepted only with low confidence. Approval requires a reviewer,
reason and five explicit checks in the UI: official source
and saved body, claim-to-evidence support, Japanese/English equivalence, and
numbers/units/periods/attribution, plus impact direction/confidence. The server
requires the canonical five-key object, stores it on the append-only review row
and excludes legacy, partial or
malformed approval records from the public feed. The checkbox state alone can no
longer authorize publication through a direct API call.

`POST /admin/news/draft` accepts the existing article/revision plus `editVersion`,
`summaryJa`, `summaryEn`, `impactJa`, `impactEn`, `impactLabel`, `confidence`,
and `evidence`. The compare-and-save version prevents
overwriting a newer edit or decision. Every manual save, even identical text,
records a draft event and requires fresh approval. Evidence matching now compares
whole numeric tokens rather than accepting a substring such as 99 inside 199.
All numeric claims in either summary or impact rationale must occur in an exact
saved excerpt. Stock-price predictions, targets and buy/sell recommendations are
rejected. The draft fingerprint covers the complete impact assessment, so a
database-side label or confidence change invalidates the review and public item.
Existing evidence rows migrate with an empty assessment and therefore fail
closed until an editor saves and reviews the new impact fields; an older approval
cannot silently authorize the expanded public payload.

`GET /news` is a monitor-token endpoint. It selects only the latest approved
decision for the current source/draft, then revalidates both summaries and the
fingerprint within one SQLite read snapshot. It returns explicitly selected public
fields only, excluding source text, excerpts, review reasons and identities.
`/api/research/news` uses a server-held monitor credential and applies a second
public-field allowlist. Both API and browser requests use no-store.
The public-news and editor proxies reject monitor base URLs containing embedded
usernames or passwords, so a configuration mistake cannot forward URL credentials.

`/research/news` displays the selected-language summary and impact rationale,
impact direction, confidence, publisher link, original publication time and
review time. It refreshes every 30 seconds, clears old items
on read failure, and has distinct preparing/empty/error states. Review withdrawal
is effective on the next successful refresh (browser suspension can delay this).
The browser's fetch time is not phone-receipt or first-display telemetry.

Public distribution requires `STOCK_NEWS_PUBLICATION_ENABLED=true` on the monitor.
It remains OFF: no provider entitlement has been verified and no article has
been approved or published by this development work. Paid generation also remains
OFF. No new paywall or membership policy was introduced.

Tests exercise the actual local HTTP handler: editor save → approval → public
read → hold/withdrawal, with synthetic articles, temporary SQLite and no external
calls. Additional tests cover stale edits, identical-save invalidation, source
corrections, altered translations, public-field redaction, proxy authentication
and disabled publication. Live model quality/provider access remain unverified.

Failed-generation recovery is now explicit and bounded. A failed current source
revision exposes one editor-only retry button. The request carries the current
`editVersion` and an explicit confirmation flag; the server accepts it only when
the first attempt is durably `failed`, no current draft exists and the source/edit
version is unchanged. A transaction prevents simultaneous editors from reserving
the same retry. The retry receives its own immutable attempt number and full
conservative token reservation, counts toward the same UTC-day attempt/token
ceilings, and cannot be attempted a third time. Reserved/interrupted attempts are
not automatically retried. The queue exposes only bounded state, attempt count and
retry eligibility—never provider errors, prompts, credentials or raw usage detail.
Legacy one-row attempt records migrate idempotently as attempt 1.

Remaining: live provider entitlement and schema verification, offline bilingual
model-output evaluation corpus expansion, then actual
publication-to-screen timing. Manual evidence-backed correction is now available.

Preview verification: the September 28 deployment of `b4d9db4` passed GitHub
Actions, Vercel and Railway checks. The live review page shows the new panel and
disables loading without an editor token; the live news page shows distribution
preparing, as intended while disabled. No real article/editor submission was
performed in the live browser. Local gates passed 116 Node and 380 Python tests,
lint, build, compileall and diff checks. A subsequent copy correction makes the
top-level review warning consistent with the opt-in approved-news display.

The bounded-retry update was published later on September 28 as `d2d3ee7`, with
calendar handoff commit `6f271ed`. After rebasing over concurrent PRO-column work,
the combined suite passed 122 Node and 394 Python tests plus lint, production
build, compileall and diff checks. Vercel and isolated Railway staging checks both
succeeded. The protected review page rendered without application console errors;
the only observed console entry came from the browser automation extension. No
editor token was entered and no live generation, retry, approval or publication
was performed.

The auditable-approval update was published later on September 28 as `a7f7361`,
with calendar handoff commit `84d9164`. The final combined suite passed 122 Node
and 396 Python tests plus lint, production build, compileall and diff checks.
Vercel and isolated Railway staging both succeeded, and the protected review page
rendered with its ordinary-news panel. No editor token was entered; live
generation, approval and publication remain off. The only browser console error
was emitted by the automation extension, not the application.

## Original backend checkpoint (historical)

The following describes the earlier backend-only stage; the current UI/public
selection above supersedes its not-yet-implemented statements.

## Flow

1. Existing Stock News intake saves a provider article and its revision.
2. `POST /admin/news/generate` accepts `articleId` and `revision`. The server
   generates Japanese and English together from the saved provider text. It does
   not fetch the article URL, assume full-text access, or call it an official source.
3. `/admin/news` returns both summaries, exact evidence excerpts, a fingerprint,
   and review status. Model output remains private.
4. `POST /admin/news/review` accepts `articleId`, `revision`, `fingerprint`,
   `decision` (`approved`, `held`, `rejected`), `reviewer`, and `reason`.
   The existing editor bearer token protects all three endpoints.

Approval binds both languages and evidence to the current source revision.
Source corrections, including a later return to the old text, invalidate approval.
Manual draft saves remove generated evidence and require evidence to be established
again before review. Review history remains append-only. A later hold/rejection
supersedes approval. Approval does not enable publication or set `displayedAt`.
The private review queue orders intake timestamps as absolute instants, including
when valid persisted rows use different UTC offsets.

## Activation and budget

Generation is disabled unless `STOCK_NEWS_DRAFTS_ENABLED=true` and existing
`OPENAI_API_KEY` / `RESEARCH_SUMMARY_MODEL` configuration is valid. No settings were
enabled as part of this change, and no live model/provider requests were made.

`STOCK_NEWS_DRAFT_DAILY_LIMIT` defaults to 20 and cannot exceed 20;
`STOCK_NEWS_DRAFT_TOKEN_LIMIT` defaults to 100000 and cannot exceed 100000.
These are separate from official-source draft budgets. Limits use UTC days and
count attempts before network I/O. The token ceiling is a conservative reservation,
not actual billed usage: three times the UTF-8 input size plus 8000 per request,
covering the existing transport's maximum three attempts and 2400 output tokens.
UTC-day membership is calculated from the absolute instant, so persisted timestamps
with different valid UTC offsets cannot move an attempt into or out of the budget.
Failures and interrupted requests retain the reservation. A source revision gets
one initial attempt and, only after a durable failure, one explicit confirmed retry
across restarts and simultaneous editors. There is no automatic retry or budget
release workflow. Existing current drafts are never overwritten by generation.

## Verification and remaining work

Offline tests cover generation → evidence → approval → hold, persistent review
state, correction/revert invalidation, language edits, stale fingerprints, missing
reviewers, disabled generation, daily/token budgets, failure sanitization,
concurrent duplicate prevention, source changes during generation, and invalid
evidence/languages/numbers/incomplete output. HTTP tests cover editor authorization
and routing. Tests use synthetic local transport only.

Exact excerpts and numeric checks are mechanical safeguards; they do not establish
semantic accuracy, unit equivalence or faithful translation. Human review must
check both languages against the saved source and retain uncertainty/attribution.

Remaining: editor UI, safe manual edit/retry workflow, reviewed public-feed
selection, provider entitlement/live schema verification, actual bilingual model
output evaluation, and publication-to-screen timing. No public news or push
notification is emitted by these endpoints.
