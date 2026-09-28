# Private bilingual news generation and review

Implemented on September 28, 2026. This is an editor-only backend checkpoint;
there is no public news feed or editor screen for these actions yet.

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
Failures and interrupted requests retain the reservation. A source revision is
attempted at most once, across restarts and simultaneous editors. There is no
automatic retry/release workflow; failed revisions need a future explicit recovery
tool. Existing current drafts are never overwritten by generation.

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
