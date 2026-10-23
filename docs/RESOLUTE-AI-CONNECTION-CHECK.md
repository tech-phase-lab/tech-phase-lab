## Live verification update — 2026-10-23 JST

The preparation-only statements below are historical. Owner reports schema COMMIT
and enabled/deployed the check. Authenticated browser status was not-started;
exactly one explicit execute returned RESOLUTE_OK. A separate read-status request
read the saved success back; execute remained disabled. The one-call allowance is
consumed. No more key test, reset, ledger deletion or replay after an old restore.
This verifies deployed key/model access plus diagnostic storage only. Customer
saving, external history and whole-product recovery remain separate acceptance gates.

---

# Owner-only, one-attempt AI connection check

Prepared 2026-10-23. This is implementation preparation, not a live key verification.
The owner has already replaced `RESOLUTE_OPENAI_API_KEY` and redeployed the API.
Do not ask for another key change, expose the key, or retry the Railway connector:
the owner explicitly prohibits connector retries and reconnection prompts.

The existing web owner review screen loaded six pending reviews. Reading existing
reviews is not evidence of a new model response. Prior healthz returned HTTP 200;
it does not verify OpenAI authentication.

## Prepared path

- `/resolute/ai-check`: owner-only page. No call on load; explicit read-status and
  execute buttons. Existing RESOLUTE navigation and approved content are unchanged.
- `/api/resolute/ai-check`: same-origin, verified owner/session proxy.
- `/internal/v1/ai-check`: existing service-token + signed Clerk authentication,
  then explicit owner authorization. GET reads only; POST accepts only
  `{"action":"check"}`. No arbitrary prompt/model/URL/reset.
- Fixed short prompt, `gpt-5.4-mini`, 128 output tokens, `store:false`, no tools,
  redirects or retries. Uses the deployed `RESOLUTE_OPENAI_API_KEY` exclusively.
- Requires `RESOLUTE_AI_CHECK_ENABLED=true` and the existing shared monthly budget.
  Default disabled. No runtime variable or production schema has been changed.
- `scripts/resolute/ai-check-schema.sql` creates a separate minimal ledger and
  grants the existing risk writer SELECT/INSERT and column-specific UPDATE only.
  No migration on startup. No customer saving or history gates are enabled.
- A fixed primary key claims the attempt in an autocommitted insert before budget
  reservation and external I/O. Concurrent/repeated requests and container restarts
  cannot initiate a second request. Unknown outcomes retain the claim. Never delete
  this record, change its ID, or restore an older ledger and rerun to bypass this
  restriction. This check is not reusable after later key rotation.
- Only sanitized classifications and the exact expected `RESOLUTE_OK` are retained;
  no key hash, provider error body, arbitrary model output or prompt from users.
- Failure to reserve budget makes zero model calls but still consumes the attempt.
  A missing ledger fails closed. A failure recording the result after the model
  call is reported as uncertain, never automatically repeated.

## Runtime prerequisites still outstanding

Both backend and frontend code must be deployed; the reviewed ledger SQL must be
applied and the explicit check gate enabled before the button can run. Existing
API redeploy occurred before this implementation and cannot include it. Do not
claim this route is live based on local tests or a GitHub push. Vercel's paused
state must not be changed without the owner's instruction.

After the prerequisites are independently verified, open the owner page, read
status, execute exactly once and read the recorded outcome. An exact completed
response establishes only this deployment's key/model access at that time, not
all news/selection/saving paths. The user authorized one call, not a recurring job.
No payment, email, publishing, morning schedule, backup or restore is involved.

## Local validation

- Node full suite: 1,335 passed; final probe adjustment: all 7 focused tests passed.
- Python: 2,588 passed using the repository's pinned-clock runner.
- Production Next.js 16.2.4 Turbopack build passed, including TypeScript.
- Lint: zero errors (five pre-existing warnings); compileall and diff checks passed.
- Probe tests use PostgreSQL-compatible PGlite with the actual ledger SQL and
  mocked provider replies: concurrency, authorization, disabled/missing config,
  missing ledger/budget, provider rejection, uncertain network outcome and
  unexpected output. They do not validate the production OpenAI key.
- No production AI request, schema migration, runtime gate or deployment was run.
