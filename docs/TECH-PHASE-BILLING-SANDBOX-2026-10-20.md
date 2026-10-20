# Tech Phase PRO recurring billing foundation — 2026-10-20

Current status: the dedicated PRO database and backend are deployed. Following
explicit owner approval at 14:47 JST, PRO now references the existing Sandbox app
credentials and has its own product, two monthly plans and webhook. Owner-only Sandbox checkout is now enabled for acceptance; public customer checkout
and production membership projection remain disabled. See the latest dated entries
below for IDs and acceptance evidence.
Earlier sections record implementation stages; their "not provisioned" statements
describe those earlier stages, not the current infrastructure.

## Implemented locally

`services/tech-phase-billing` is separate from RESOLUTE payment services.
It includes a Sandbox-only PayPal subscriptions adapter, internal checkout/cancellation
service, PostgreSQL ledger repository and dedicated database configuration.

- Server offers: JPY 2,980 / USD 20.00, one monthly regular cycle, no trial/setup fee.
- Read the configured plan before creating; reject different prices, currency,
  interval, additional tax, quantity pricing or automatic outstanding-balance billing.
  Pin the subscription's fixed price with a server-supplied plan override as well.
- Persist an opaque checkout UUID and accepted terms version before calling PayPal;
  reuse the UUID as PayPal-Request-Id. A unique open-member index prevents a second
  local pending contract even with a different client request.
- Recover provider-create response loss by reusing that UUID; stop automatic creation
  retries after 71 hours (PayPal documents a 72-hour create-key retention window).
- Validate Sandbox approval URL host/path/token. Return URLs are fixed on the server.
- Cancel only a subscription owned by the authenticated member. Query provider state
  before retrying cancellation so an interrupted successful response can be recovered.
- Accept empty HTTP 204 cancellation responses; bound API timeouts and JSON response size;
  share concurrent token refresh; mask provider errors and payer details.
- Verify webhooks via PayPal's signature verification endpoint using the configured
  webhook ID. Reject unexpected certificate hosts without fetching the supplied URL.
- Persist payments and processed-event metadata transactionally. Unique transaction IDs
  stop duplicate renewal records; conflicting transaction details roll back the event.
  Cancellation preserves the payment history.

## Settlement and owner-only HTTP continuation

`settlement.mjs` now reconciles the server-fetched subscription with its completed
transaction history. It requires the stored custom ID and configured plan, exact
amount/currency, a single regular cycle, no outstanding balance or consecutive
failure, and consistent monthly boundaries. It reads the subscription again after
fetching transactions to reject mixed snapshots. Calendar boundaries retain the
original day across short months (Jan 31 -> Feb 28 -> Mar 31).

Migration 002 adds immutable periods keyed by verified transaction, review holds,
and a narrow Sandbox entitlement view. A duplicate transaction cannot extend its
period; a crash between payment and period insertion is repaired by retry. Current
access is read from the period containing the current time, never a future period
across a gap. Cancellation does not erase paid access. Refund/reversal tombstones
survive notifications arriving before the corresponding local payment; a later
completion cannot revive that period. Sandbox review holds do not define the
production refund policy and cannot be automatically cleared by completion events.

Dormant route: `/api/research/billing/sandbox/[action]`.
- GET `status`: authenticated exact owner, Sandbox entitlement only, no writes.
- POST `create`, `reconcile`, `cancel`: authenticated exact owner, same-origin JSON,
  bounded bodies and exact allowed fields; identity comes from Clerk, not the body.
- POST `webhook`: bounded JSON and PayPal signature verification; lifecycle/sale
  completion triggers a fresh reconciliation instead of trusting event status.
  Sale refund/reversal persists adverse evidence; unrelated events are ignored.

Requires **all** of `VERCEL_ENV=preview`,
`TECH_PHASE_BILLING_SANDBOX_ENABLED=true`, `TECH_PHASE_PAYPAL_ENV=sandbox` plus the
separate credentials/database settings. Defaults remain disabled. The server
factory performs no migrations. `sandbox-v1` is the test-only acceptance version.

The API returns `{environment:'sandbox', plan, proExpiresAt}` using the same field
meaning as membership, but never writes Clerk `plan`/`proExpiresAt`. Existing
Tech Phase PRO access and RESOLUTE discount readers remain unchanged. Production
projection/synchronization must be integrated separately after Sandbox acceptance.

## Deliberately not activated

The new owner-only routes are disabled and there is no purchase UI button. No deployment environment,
PayPal plan, webhook registration, database or secret was changed. The SQL migration has
only been applied to disposable PGlite test databases. No real or Sandbox charge was made.

The repository's `recordPayment` remains an internal persistence boundary; the
new reconciler owns verification before calling it. ACTIVE and return URLs are not
proof of payment. `next_billing_time` alone never grants access. Automatic period
assignment is intentionally conservative: unexpected provider scheduling, arrears,
missing/multiple matching transactions or inconsistent cycle counts require review.
The month-end/date convention is covered by synthetic tests but must still be
confirmed against actual Sandbox subscription snapshots. Dispute workflows,
missed-webhook background sweeps and production entitlement sync are still open.

The existing account and membership implementation continues to operate as before.
Sandbox state must never update production PRO metadata.

## Configuration for the next integration step

All values are dedicated to Tech Phase Sandbox, with no RESOLUTE or generic fallback:

- `TECH_PHASE_PAYPAL_ENV=sandbox`
- `TECH_PHASE_PAYPAL_CLIENT_ID`, `TECH_PHASE_PAYPAL_CLIENT_SECRET`
- `TECH_PHASE_PAYPAL_WEBHOOK_ID`
- `TECH_PHASE_PAYPAL_PLAN_JPY`, `TECH_PHASE_PAYPAL_PLAN_USD`
- `TECH_PHASE_BILLING_SANDBOX_DATABASE_URL`: database `tech_phase_billing_sandbox`,
  role `tech_phase_billing_sandbox_writer`; verified TLS outside the private Railway host.

Provision with a separate migration administrator and grant the runtime role only the
required schema/table permissions. Do not run this migration against news or RESOLUTE DBs.
The HTTP layer now enforces identity/origin/size and exact-owner access. The server-fixed
`sandbox-v1` version is a fixture, not approved production terms.

Next: provision isolated Sandbox credentials/database, verify real monthly and month-end
subscription snapshots, finish dispute/background reconciliation, then implement the
production entitlement projection and retry strategy shared with RESOLUTE discount reads.
Do not advertise the checkout as available before those steps pass.

## References checked

- https://developer.paypal.com/api/subscriptions/v1/subscriptions-create/
- https://developer.paypal.com/api/subscriptions/v1/
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://developer.paypal.com/platforms/subscriptions/integrate/

Tests exercise fake HTTP responses and the real PostgreSQL schema through PGlite.
They do not establish PayPal account eligibility or real provider acceptance.

## RESOLUTE coordination checked on this continuation

Remote preview HEAD was still 53fb0e46. Read RESOLUTE-LAUNCH-READINESS.md,
RESOLUTE-LIVE-LEDGER.md and RESOLUTE-PAYMENT-VERIFICATION-2026-10-15.md.
Recorded actual Sandbox observations include JPY/USD initial and JPY FREE annual
renewal, with refund/replay behavior. Live payment routes and UI are prepared but
sales remain disabled in those records; unfinished tests are not treated as passed.
`services/resolute-api/payments/policy.mjs` reads verified Clerk privateMetadata
`plan` and `proExpiresAt` for discounts and excludes owner/test preview flags.
This batch does not modify that policy, RESOLUTE tables, deployment settings or keys.
Unpublished work in the other chat is not represented by this repository check.

Additional references: https://developer.paypal.com/api/subscriptions/v1/definitions/transaction/
and https://developer.paypal.com/api/subscriptions/v1/definitions/subscription/.

## Local verification of the continuation

- `npm test`: 1,228 passed; includes 8 new settlement/HTTP behavior tests.
- `npm run test:python`: 2,515 passed in 218.435 seconds.
- `npm run build`: passed, including the new Sandbox route.
- `npm run lint`: zero errors, five pre-existing warnings. The initial parallel
  attempt encountered a disappearing test temporary directory; the sequential
  rerun after Node tests finished passed.
- `python3 -m compileall -q scripts/research tests` and diff whitespace checks passed.

All changes remain local and staged. No commit, push, deployment, infrastructure
provisioning, credentials, real payment or Clerk entitlement mutation in this batch.
# Existing infrastructure inventory and PRO preflight (2026-10-20)

Read-only Railway inventory confirmed the existing RESOLUTE API, PostgreSQL,
backup and recovery services. No staged Railway changes were present. The
RESOLUTE API already has its PayPal app, webhook, payment database and Clerk
configuration. Those settings were not decrypted, changed or recreated.
`CURRENT-HANDOFF.md` explicitly says connection setup and the six Sandbox price
purchases need not be repeated. Recovery acceptance is also already recorded.

Vercel project `prj_CCegV1VWucYpppYuMCDbBOAGF9s4` environment-name inventory
contained no `TECH_PHASE_PAYPAL_*` or `TECH_PHASE_BILLING_SANDBOX_*` settings.
This proves the PRO runtime is not configured there; it does not prove that no
PRO plan exists in PayPal or that another chat has no unpublished work.
Do not create duplicate PayPal apps/plans or PostgreSQL services on that basis.

The preview-only, owner-authenticated GET endpoint
`/api/research/billing/sandbox/readiness` now reports missing configuration names
and safe problem codes even while sales are disabled. It never initializes the
payment services, queries PayPal, connects to a database or reveals values.
`configurationReady` is separate from `enabled`; `connectionVerified` remains
false. It detects a RESOLUTE database/role supplied by mistake, a Railway-private
hostname unreachable from Vercel, and one plan assigned to both currencies.
Existing RESOLUTE names are never treated as PRO configuration fallbacks.

External connection and real PRO Sandbox subscription verification remain
outstanding. The existing database is private; do not expose it publicly or
modify RESOLUTE routing to accommodate the new Vercel runtime. Resolve PRO's
private-network service placement before provisioning. No infrastructure,
credentials, migrations, purchases, notifications or production membership were
changed by this inventory/preflight work. Changes remain local and unpublished.

Preflight validation: `npm test` passed all 1,231 tests and `npm run build` passed.

## Private-network service implementation (2026-10-20, local only)

The Vercel route now uses an authenticated gateway instead of constructing a pg
pool. `services/tech-phase-billing/server.mjs` is the standalone PRO Sandbox
service, with its own Dockerfile and pinned pg dependency lock. The intended
placement is the existing Railway project/environment alongside the private
Postgres, using a separate logical database and writer role. No RESOLUTE process,
route, credential, database role or backup job is changed. No additional physical
Postgres instance is needed for this design.

Vercel needs only `TECH_PHASE_BILLING_SERVICE_URL` (the PRO service's exact HTTPS
Railway domain), `TECH_PHASE_BILLING_SERVICE_TOKEN` (a fresh PRO-only random token,
43–128 URL-safe characters), and the existing preview/Sandbox enable switches.
PayPal credentials and the PRO database URL belong only to the PRO service.
The gateway requires Clerk owner authentication and same-origin mutations; it
replaces caller-supplied identity, strips cookies/Authorization, bounds payloads,
rejects redirects and never falls back to a RESOLUTE URL or key.

The Railway service requires `TECH_PHASE_BILLING_RUNTIME=railway-sandbox`,
`RAILWAY_GIT_BRANCH=codex/research-preview`, the matching service token,
`TECH_PHASE_BILLING_OWNER_ID` matching the existing application's owner ID,
`TECH_PHASE_PAYPAL_ENV=sandbox`, and the dedicated PRO settings above. The runtime
requires the enable switch for payment operations, but authenticated owner
readiness remains available while disabled. The backend verifies the service
credential before using the identity asserted by the Clerk-authenticated gateway.
PayPal webhook payloads and signature headers pass through the same gateway;
PayPal signature verification still runs in the billing service before DB writes.
Only `/healthz` is public; its result means the process is up, not that payment or
DB acceptance has passed. No request payloads or credentials are logged.

Deployment recipe (not executed): use service root `services/tech-phase-billing`,
Dockerfile in that root, health path `/healthz`, preview branch only, and initially
leave `TECH_PHASE_BILLING_SANDBOX_ENABLED` unset. First inventory PayPal resources
and dedicated DB roles to avoid duplicates, then provision only missing PRO
resources. Never reuse RESOLUTE's deployment/provisioning service or change its
webhook. The PRO DB must be backed up separately; existing RESOLUTE backup success
is not evidence of PRO coverage. Real connection/permission/concurrency checks,
PRO Sandbox purchase acceptance and backup/restore acceptance remain outstanding.

Validation for the private-network implementation: Node 1,235 passed; Next build
passed; lint 0 errors (5 existing warnings); isolated service `npm ci --omit=dev
--ignore-scripts` installed 14 packages successfully. Standalone Node smoke check
passed `/healthz`, unauthorized direct access rejection, and authenticated
readiness with no provider/DB settings. This does not replace real Railway or
PayPal acceptance. No commit, push or deployment was performed.

## 2026-10-20 14:11 JST — Actual PRO database preparation

Owner authorized deployment/connection work. Integrated RESOLUTE updates through
`76fdf9455cab2f228be3e72d03709dc9f39b8468`, preserving all seven changed files.
Final integrated checks: Node 1,235; Python 2,520; build passed; lint 0 errors
(5 existing warnings); compileall and staged diff check passed.

New PRO runtime service: `430ca5db-6ec5-48ec-b16f-cfb03fd70972`, domain
`https://tech-phase-billing-sandbox-production.up.railway.app`. Runtime deployment
is still pending at this entry. Preview-only Vercel gateway variables were added;
both purchase enable switches remain false. No production Clerk fields changed.

PRO-only one-shot provisioning helper: `d6d32277-2a77-4548-a875-8188e59966f4`.
Read-only inventory confirmed no pre-existing PRO DB or roles. Actual deployment
`d50e1637-d1ea-471d-8320-48de1925052d` logged `TECH_PHASE_DB_PROVISION_OK`:
new logical database `tech_phase_billing_sandbox`, separate NOLOGIN owner and
non-admin writer, migrations 001/002, real writer insert/rollback successful.
No new physical Postgres service and no RESOLUTE schema/role changes.

Deployment `e1a8943a-c739-4975-87a2-ab6318eb7190` executed the current billingStore
reserve logic against real PostgreSQL with 12 concurrent requests and 4 pool
connections: exactly one subscription ID; FREE entitlement; writer cannot update
payments, delete subscriptions or create schema objects. Its single test fixture
was removed (`TECH_PHASE_DB_FIXTURE_CLEANED`). Writer can update subscriptions;
other billing tables allow only SELECT/INSERT. Temporary provision credentials
must be cleared after finishing this operation; do not rerun provisioning.

## 2026-10-20 14:15 JST — Runtime deployed; PayPal authorization boundary

Published implementation `33dbd91884a7125c290bc392ae1beabb8215c466`.
Railway deployment `4d36b885-09f8-4787-ac9a-66ebde2f4d77` is SUCCESS and pinned
to that exact commit. Vercel deployment `dpl_285dzAd1WryY9xQv4o4NpgSs7r1J` is
READY for the same commit. Neither status alone proves complete checkout.

PRO-only runtime acceptance deployment `50760c46-b48b-4392-b97f-c61038c6a4bd`
logged `TECH_PHASE_RUNTIME_ACCEPTANCE_OK`: health 200, no service credential 401,
owner readiness 200, wrong owner 403, sales-disabled 503; dedicated writer
connected successfully and subscriptions count was zero. Readiness has no DB
configuration problems and reports five missing PayPal settings. No PayPal
payments, production entitlement writes, notifications or RESOLUTE changes made.

Automatic approval review rejected referencing RESOLUTE's PayPal client ID/secret
in the PRO discovery helper, then rejected the proposed read-only discovery
code, because it expands existing credentials' access beyond PRO-only scope.
Those actions did not execute. No retry or indirect workaround is authorized.
Need explicit owner approval for shared Sandbox-app credential use, or distinct
PRO app credentials, before PayPal inventory/plan/webhook work. Do not ask for
secrets to be pasted into chat. Never change RESOLUTE's existing webhook/plans.

All four temporary PRO helper variables (admin DB URL, writer password, PRO
check token and PRO check DB URL) were blanked. Source was replaced by a no-op;
deployment `cc1249df-ab45-4897-af33-d8ba6c3aee63` logged
`TECH_PHASE_PROVISION_RETIRED`. No schedule or HTTP domain on the helper.

Post-deploy Vercel probe found readiness returning 503 because the new billing
path was missing from the Clerk proxy matcher. Added `/api/research/billing/:path*`
and extended the existing real-Next-matcher test. Full gates are being rerun;
verify the fixed preview endpoint returns unauthenticated 401 before considering
this issue resolved. Authenticated gateway-to-backend with a real Clerk session
and PayPal end-to-end acceptance remain distinct, unverified gates.

## 2026-10-20 — Authentication fix verified on deployed preview

Fix commit `fd5babcf677d02096ee87d3e944f23434f0518fc` passed local Node 1,235,
Python 2,520, build, lint (0 errors/5 existing warnings), compileall and diff check.
Preserved parallel RESOLUTE documentation commit `deef9349` before publishing.
Vercel `dpl_6M87kNVY2raFde5wKa4asSv6s2y3` reached READY on the fix SHA.

The generic Vercel web-fetch tool classified the application's 401 as deployment
protection and hid the body. Used the connector's approved temporary share URL
with a cookie-aware HTTP client against that exact deployment; readiness returned
`401 application/json {"error":"sign-in"}`. This verifies the original 503 is
resolved and the deployed unauthenticated route fails correctly. No Vercel
protection settings were disabled. Real Clerk-owner gateway session still needs
its separate acceptance check; backend owner/service authentication was verified.

Another contributor published `2a78993df8263334b343e68f2ce4e13ca08fa2c8` (news/UI)
after the fix. Fast-forwarded locally and preserved it. Our earlier workflow runs
were cancelled by subsequent branch pushes, not reported as passed. Latest shared
branch CI `39374487817` was still running at the last observation. Do not claim
full remote CI success yet. PRO Railway runtime remains pinned to `33dbd918`;
only the Vercel proxy changed in the later fix, so it needs no backend redeploy.

Remaining blocker: automatic approval review requires explicit owner approval
before expanding RESOLUTE Sandbox-app credential use to PRO. No discovery
credential variables were created; existing RESOLUTE app settings untouched.
Ask whether the existing Sandbox app credentials may be used by the PRO-only
service, then inventory existing resources before adding dedicated PRO plans
and webhook. Keep both purchase switches false until checks are complete.
This final evidence entry is local/staged for the next publication batch.

## 2026-10-20 14:47 JST — Shared Sandbox app explicitly approved

Owner explicitly approved using the existing Sandbox app credentials in PRO
(「使っていいですよ」), resolving the previous automatic-review boundary.
Only PRO services receive references to the existing client ID/secret; no source
RESOLUTE variables or settings are changed.

Discovery deployment `e8284c25-8875-4ef1-9a20-ad337f324caf` authenticated against
the fixed Sandbox API: zero recurring plans and one RESOLUTE webhook.
Provision deployment `e6d060a3-f26d-4812-aa01-cc7d64687e1f` completed successfully:

- Product: `PROD-8X64325433408084T` (Tech Phase PRO Sandbox).
- JPY monthly 2,980: `P-03V83272JR2001350NLLQDHA`.
- USD monthly 20: `P-1HN77466YK762545WNLLQDHI`.
- PRO webhook: `8RC86242WT392843H`.
- URL: `https://tech-phase-billing-sandbox-production.up.railway.app/webhooks/paypal/sandbox`.

Both plans are ACTIVE, one infinite monthly REGULAR cycle, zero setup fee,
no trial, quantity pricing or outstanding-balance auto-billing. Read back actual
provider plan details. Existing RESOLUTE webhook `24H44192YT965133R` retained
its original URL and all six event subscriptions, checked after creation.
No buyer subscription or payment created.

Added exact public notification route on PRO Railway backend: runtime/branch
guards, JSON/body limit, POST only, and PayPal signature validation before ledger
access. Other service paths still require the private gateway credential.
A separate `TECH_PHASE_BILLING_SANDBOX_WEBHOOK_ENABLED` switch permits receiving
notifications while both purchase switches remain false. Do not point PayPal
to the deployment-protected Vercel preview. Configuration is staged live for
the next PRO backend deployment; deployed acceptance is still pending.

## 2026-10-20 14:59 JST — PayPal connection and public route accepted

Published `d10c04f87404fc3d76485eebbd486660529e8b45` after integrating latest
parallel changes through `af8af67`. Local final-tree gates passed: Node 1,237,
Python 2,523, build, lint (0 errors/5 existing warnings), compileall and diff check.
GitHub tree exactly matched local `98ebb38e260de857bd6c18494f9fa5a2c652684c`.
Both actual provider plan responses passed the application's `assertPlan`.

PRO runtime deployment `c10d6881-0848-4dc2-9364-5aa628ddb815` is SUCCESS, pinned
to `d10c04f`. Acceptance deployment `320ff34d-d871-4600-bd20-7071db125c1a`
logged `TECH_PHASE_PAYPAL_RUNTIME_OK`: owner readiness 200/configurationReady true,
unsigned public notification 401/signature, private service without token 401,
authenticated purchase 503/billing-disabled. These are real deployed HTTP checks,
not a claim of a completed purchase or valid signed payment delivery.

The helper's temporary Sandbox client ID/secret/env references and service token
were blanked; helper source returned to the retired no-op. Runtime retains the
approved credential references. RESOLUTE webhook URL/event subscriptions were
verified unchanged; no RESOLUTE service settings, database or schedules modified.

Still open: real Sandbox buyer approval/payment and signed delivery, real Clerk
owner gateway session, month-end provider snapshots, PRO backup/restore acceptance,
disputes and missed-webhook reconciliation, purchase UI and production membership
projection. Both purchase switches remain false; production metadata untouched.

Retirement deployment `c57acb12-eeb0-484a-b695-23c6f3a496ff` is SUCCESS and
logged `TECH_PHASE_PROVISION_RETIRED`. GitHub Actions `39377657564` is still
in progress; its PostgreSQL concurrency job passed. Do not yet claim full
remote CI success. This final operational evidence is staged locally for the
next publication batch; implementation and provider setup are already deployed.

## Owner checkout screen continuation

Added `/research/account/billing`, guarded on the server by preview environment
and exact Clerk owner ID, with an account-screen link for preview testing. The
public PRO offer remains Coming soon. Bilingual checkout supports JPY/USD,
explicit Sandbox recurring consent, resuming an existing approval, manual fresh
payment reconciliation and confirmed cancellation. Return query parameters never
grant access or automatically create/cancel subscriptions. Approval navigation
accepts only the exact Sandbox host/path and a single BA token.

GET status now returns the owner's most recent/open subscription (only UUID,
currency and local state) plus separately verified Sandbox access. This allows
reload/recovery without storing contracts in browser storage. Provider IDs, user
IDs, terms/audit data and credentials stay server-side. Contract ACTIVE and paid
PRO access are shown separately. The return URL now points to the dedicated page.

Planned activation is restricted to this one owner in Sandbox for buyer acceptance;
it is not customer checkout or production launch. PRO backup/restore and production
projection remain launch gates. No real-money purchase is authorized by this switch.

## 2026-10-20 15:18 JST — Owner checkout deployed and provider create verified

Published `accf4368803ab8dbe302bb759f90733be79aa93d`, preserving parallel
RESOLUTE documentation through `fb27c78`. Final Node 1,243, Python 2,523, build,
lint (0 errors/5 existing warnings), compileall and diff check passed. Initial
concurrent build exited 137; rerun after Node tests completed succeeded.
GitHub tree matched local `a3fd9ace055e045abce3956c3872e6072caf5214`.

Railway `cd64d770-71ef-44a6-9aff-1d085693bda3` SUCCESS, pinned to `accf436`.
Vercel `dpl_76WYprEUMqBoep3WXhrQyuFLnJHN` READY on the same commit.
Only the exact-owner Sandbox purchase switches were enabled, on the existing
preview branch and dedicated Sandbox runtime. Production settings unchanged.

Actual acceptance helper `7c6b466c-2dbd-4698-af14-e780fa66dfe8` SUCCESS logged
`TECH_PHASE_CHECKOUT_ACCEPTANCE_OK`: wrong owner status 403; empty owner status
read before creation; JPY create 200 and repeated create 200 returned the same
contract; reloaded status is approval_pending and FREE. Local contract UUID
`1608c7d4-cc97-4ccc-a4f5-d7eb920dfbf8`. Leave this contract for buyer approval;
do not create another one or delete it. Both returned approval URLs were Sandbox.
Runtime HTTP logs also show POST `/webhooks/paypal/sandbox` 200 after creation;
this is not yet a completed-payment notification or a verified paid period.

The helper's temporary service token was blanked and source retired. Retirement
deployment `bd5bab4a-08f9-4697-881c-3051d35bfe27` SUCCESS logged the retired marker.
No Sandbox buyer approval, actual charge, renewal, cancellation, production Clerk
write or PRO backup/restore acceptance has occurred. Next user action: open
`/research/account/billing` as the owner and resume the JPY Sandbox approval.
Use a Sandbox buyer account; then Verify payment. The user's production PRO
status is deliberately independent. GitHub Actions `39379392059` was in progress
at last observation; do not mark unobserved CI or buyer acceptance as passed.

Post-deploy Vercel check with an approved temporary share cookie: unsigned API
readiness returned 401/sign-in. The owner page streamed a Next redirect to the
account login (HTTP 200 shell containing redirect, no checkout heading). Do not
interpret that streaming status as an unauthenticated checkout render. Actual
owner browser session and buyer approval remain user-interactive checks. Final
operational evidence is staged locally for the next publication batch.

## 2026-10-20 — First buyer approval exposed provider billing-clock mismatch

Buyer approved the existing JPY contract; do not create another checkout.
Read-only diagnostic `162b82a1-f6fa-414a-9eff-199905eb06f6` found ACTIVE,
matching contract/custom/plan IDs, one COMPLETED JPY 2,980 transaction at
2026-10-20T06:38:15Z, zero outstanding balance and zero failed payments.
Only whitelisted non-PII comparison flags, amounts, dates and statuses were logged.
The broader diagnostic was rejected by automatic review before execution; it was
replaced with the minimal-field diagnostic. Temporary provider/DB references were
blanked and the helper retired afterward.

Root cause: start_time was 2026-10-20T06:17:10Z, while PayPal's next_billing_time
was 2026-11-20T10:00:00Z. The original exact-clock monthly comparison rejected a
valid completed payment (409 for both webhook and manual reconciliation).
PayPal documents next_billing_time as the next billing date/time; it does not
promise the creation clock is retained:
https://developer.paypal.com/api/subscriptions/v1/definitions/subscription/

Correction uses the provider clock only on the expected monthly calendar date;
transaction, amount, currency, cycle, outstanding balance, subscription identity
and double-read consistency checks remain required. Other calendar dates remain
manual review. Month-end dates still derive from the original anchor. Cancelled
contracts without a next billing date retain only a previously verified immutable
period for the exact transaction, never a guessed new expiry. Migration 003
replaces the old elapsed-duration check (28–31 days) with a bounded 27–<32 day
window because the first monthly period can exceed 31 days by the clock shift.
Exact monthly calendar validation stays in the application. No rows or privileges
are changed; both existing-row preservation and invalid-duration rejection are tested.
UI errors now read contract status once without retrying a mutation, so a failed
payment check does not leave an old approval-pending state displayed.

Regression fixtures cover the observed provider clock, repeated reconciliation,
cancellation without next billing date, exact transaction/owner lookup isolation,
renewal at month-end and continued rejection of wrong amounts/currencies/statuses
or an unexpected billing date. Deployment and live recovery are still pending.

Local final gates on integrated remote `7875e99`: Node 1,247 passed, Python 2,523
passed, production build passed, lint 0 errors/5 existing warnings, compileall and
diff check passed. Migration helper `b9bdf46d-07a6-4180-a15c-0d9e6d347258` SUCCESS
confirmed `PRO_BILLING_CLOCK_MIGRATION_OK` with rows preserved, using SET LOCAL ROLE
to the PRO-only NOLOGIN owner in the explicitly selected PRO Sandbox database.
The temporary administrator reference was blanked immediately afterward.

## Paid-period writer permission correction

Published clock fix `a4643daad5f89cd9abd239dcfc6fe3d8d3bc8c0f`; runtime
`cd039e96-8a9e-4700-abef-680e0645247c` SUCCESS and Vercel
`dpl_EhmQcFAFAiLYVDN2uB8ejQScqjmx` READY. Live reconciliation now recorded the
single verified payment, but stopped before the period insert (503).
Read-only diagnostic `52f26c85-8169-4f9e-8a7f-0bf4c0c7b5b0` confirmed 1 payment,
0 periods, no payment UPDATE privilege, subscription UPDATE allowed, and the
subscription-row lock succeeded while the payment-row lock failed.

The immutable payment table intentionally lacks UPDATE permission, required by
SELECT FOR UPDATE. Period grants now lock the parent subscription, using the
existing allowed privilege and serializing grants for that contract. No role
privileges were broadened. The real billing-clock test now runs as a matching
least-privilege role and proves payment UPDATE/period DELETE remain forbidden.
The existing payment is retained; the normal idempotent reconciliation repairs
its missing period. Do not create or approve another subscription.

Final permission-fix gates: Node 1,247 passed (including the least-privilege
real-clock fixture), Python 2,523 passed, build passed, lint 0 errors/5 existing
warnings, compileall and diff check passed. Integrated parallel RESOLUTE docs-only
commit `b23dd6385f8fe3e0196254bb9c29031210a59c16`; no application changes in that
merge, and reran the applicable diff check. Helper retirement
`d533c6ed-135a-4b30-b4a8-21a587389b41` SUCCESS logged the retired marker; temporary
writer/service-token references blanked. Runtime recovery still to be verified.

## 2026-10-20 16:04 JST — Actual paid Sandbox recovery verified

Published permission fix `69e8d80013f96c9fbe82e0d974be235e8940350a`, exact tree
`e579a44d90d42fd88b51e9e244a725c177b61601`; local checkout aligned without losing
parallel RESOLUTE work. Runtime `82b352cf-bf69-45c8-b4d9-5927ff8e5c37` SUCCESS.
Vercel `dpl_9voMvWNRuB8Fe5ShYx1RT5ggrZfc` READY on the same SHA.

Acceptance helper `f5fca7dc-dbe7-4b10-b5bf-e638b1ca7cb5` SUCCESS logged
PRO_PAID_ACCEPTANCE_OK: two sequential reconciliation requests returned verified,
Sandbox PRO and identical expiry 2026-11-20T10:00:00.000Z (19:00 JST). Fresh status
returned active/PRO. Read-only database counts confirmed exactly one payment and
one period for the original contract. No new checkout or charge was created.
No production Clerk membership or RESOLUTE settings/data were modified.

Temporary writer/service-token references blanked and helper source retired.
GitHub Actions run 39384025241 was in progress at this observation; local final
gates passed. Actual cancellation/renewal/refund acceptance and signed completed
payment redelivery after the fix remain unverified. The user can refresh the
existing page to see active/PRO; do not ask them to approve or purchase again.

Final helper retirement `3328b7cb-2fa0-43f9-93cf-de82e2ae6d8d` SUCCESS with
TECH_PHASE_PROVISION_RETIRED marker. Runtime HTTP logs independently confirmed
reconcile 200 twice and fresh status 200 at 07:04 UTC. Operational evidence is
staged locally for the next documentation batch; deployed implementation is current.

## 2026-10-20 16:10 JST — Actual cancellation and expiry boundary accepted

The user authorized continuing the announced cancellation test. Helper
`ab4fb20b-45af-4ba5-b86d-dd0e4b13c6eb` SUCCESS logged
PRO_CANCELLATION_ACCEPTANCE_OK. Starting from the existing paid Sandbox contract,
POST cancel twice returned 200/cancelled; subsequent reconciliation returned
200/verified. Fresh status is cancelled/PRO with unchanged expiry
2026-11-20T10:00:00.000Z. The original paid period is preserved.

Read-only queries against the real entitlement view found one valid period at
09:59:59.999Z and none at 10:00:00Z on November 20. No server clock or stored
expiry was modified to perform this boundary check. This verifies query semantics,
not an elapsed real-time renewal test. No new purchase, charge or refund occurred.
Runtime HTTP logs also show public PayPal notification 200 at 07:10:54 UTC after
cancellation. The transport delegates this exact path to signature verification;
no unsigned notification exemption was introduced. Specific completed-payment
redelivery is still unverified.

Temporary helper references were blanked and its source retired. Remaining live
acceptance: USD buyer approval, actual renewal and refund/dispute scenarios.
Production launch still requires PRO-specific backup/restore, missed-webhook
recovery, production membership projection, and the polished customer checkout.

Final cancellation helper retirement `740f6496-f135-4213-814f-db516640f9e5`
SUCCESS with the retired marker. Public negative checks on the deployed runtime:
unauthenticated GET status and POST cancel each returned 401/service-auth;
unsigned public notification returned 401/signature. No identity or payment data
was exposed. GitHub Actions 39384025241 completed SUCCESS, including both the
preview lint/test/build job and the PostgreSQL concurrency job.

## Owner Sandbox missed-notification recovery

Added `services/tech-phase-billing/recovery.mjs` and a separate one-shot entry in
`scripts/tech-phase/billing-recovery-entry.mjs`. This watchdog reads the exact
owner's current status, reconciles only that existing contract through the same
verified-payment path, then rereads status. It never invokes create/cancel/capture.
An explicit enable switch, Sandbox mode, preview branch setting and service/owner
identity are required. The upstream domain/origin are fixed in code. Responses
are bounded to 16 KiB, redirects rejected, each request times out at 55 seconds,
and an ambiguous failure is not retried within the same run. Logs contain only
outcome/state/plan/change flag, never identifiers, credentials or provider payloads.

Tests cover disabled/live/main/missing-credential rejection before network access,
missed-payment repair, repeat runs, cancelled paid access, pending/manual-review
outcomes, absence of a contract, oversized/malformed status, and no mutation retry.
This is deliberately the existing single-owner Sandbox acceptance path, not a
production multi-customer reconciliation worker. A new dedicated PRO-only hourly
job is planned; no RESOLUTE service/schedule is reused or modified.

Recovery final local gates: Node 1,252 passed, Python 2,523 passed, production
build passed, lint 0 errors/5 existing warnings, compileall and diff check passed.
Railway inventory confirms no existing PRO recovery job; the new job must be
created only in environment 3a80776d-15a3-4ca1-bd0c-e0c915ccf73b, with no domain,
restart NEVER and cron `17 * * * *`. Bundle the checked entry with esbuild
`--bundle --platform=node --format=esm`; credentials are runtime references to the
existing PRO Sandbox service, not embedded in the function source. Deployment
and the initial real recovery run remain pending at this code publication.

## 2026-10-20 16:23 JST — Sandbox watchdog deployed and first run accepted

Published recovery code `d3d723c1b79a6d4e6add688b7ba700d1696eb20d`, exact tree
`9803007cc9be4159502ccef59e950f6047588f32`; local checkout aligned. No changes to
main, the pinned PRO runtime, production membership or RESOLUTE services/schedules.

Created only in environment 3a80776d-15a3-4ca1-bd0c-e0c915ccf73b:
- Service tech-phase-billing-recovery-sandbox,
  `7950fd63-99a9-49f3-9d7a-a7f319620e9e`.
- Bun 1.4 function, no public domain, restart NEVER, cron `17 * * * *`.
- Explicit recovery enabled/preview settings; Sandbox environment, owner ID and
  service-token references point only to tech-phase-billing-sandbox. These are
  persistent scheduled-job references, unlike retired one-shot helper variables.
- Bundled source SHA-256
  `e1d76f044d2b83c8511aa70d210ce3037cb0fecda0780a5b9f86681ddaa447f0`;
  get-function-source-code confirmed deployed code equals the checked bundle.

The initial unconfigured deployment exited disabled without service calls.
After configuration, explicitly ran deployment
`9f761461-925c-4f25-bdf8-e2b13829cd8a`; it completed SUCCESS at 07:22:53 UTC,
logging TECH_PHASE_SANDBOX_RECOVERY outcome verified, plan pro, state cancelled,
changed false. This confirms the deployed job rechecks the existing cancelled
paid contract without changing state/expiry. The future hourly tick is configured
but not yet observed. No new purchase/cancellation occurred in the watchdog.

GitHub Actions 39385967422 was in progress at last observation; all local gates
passed. Keep production multi-user recovery and PRO backup/restore as launch gates.
Operational deployment evidence is staged locally for the next documentation batch
so the running code CI is not displaced by another documentation commit.

## PRO backup implementation prepared; source authorization blocked

Added `services/tech-phase-backup/` with PostgreSQL 18 custom-format snapshots,
AES-256-GCM encryption, bounded authenticated S3 readback, seven daily/four weekly
retention, freshness checks and disposable Unix-socket-only restore drills.
The restore checker verifies all six PRO tables, payment consistency and the
entitlement view including refund holds and adverse-transaction tombstones.
This is not a restore-to-serving-DB or production access-enable operation.

Created only these new, PRO-specific resources in the existing production-named
Railway environment; application mode remains Sandbox:

- Bucket `tech-phase-billing-backups-sandbox`:
  `395e5e7f-5ae2-43f7-8a91-9930dcf9b5aa`.
- Empty backup service `ea8553fe-6495-4b90-b07a-ec89cb1995c4`.
- Empty restore-check service `7938ee41-3d0b-4b0e-a40e-e391f564344d`.

Both services are disabled (`TECH_PHASE_BACKUP_ENABLED=false`), have no source,
cron, public domain, persistent volume or deployed job. A new PRO-only encryption
key and the new bucket references are configured. The unused generated database
password was cleared. No source database credential was added; no snapshot or
real-data restore has occurred. Do not report backup acceptance as passed.

Automatic approval review rejected temporary injection of the shared PostgreSQL
admin connection into the retired PRO provision helper. A safer proposal to use
the existing PRO-scoped writer connection was also rejected because its underlying
INSERT/subscription-UPDATE privileges would be copied to another service. Neither
credential write succeeded. The helper remains retired at deployment
`740f6496-f135-4213-814f-db516640f9e5`; its code/config were not changed.

Prepared, but did not execute, `scripts/tech-phase/provision-backup-reader.mjs`.
The concrete pending operation is to temporarily provide the administrator
connection to that PRO helper, create only `tech_phase_billing_sandbox_backup`
with CONNECT/USAGE/SELECT and future owner-table SELECT, verify no write/CREATE
privilege, then clear the helper credentials and retire its code immediately.
It refuses to rotate/modify an existing role and connects only to the PRO logical
database. Explicit user approval of this temporary administrative credential
exposure is required before retrying the blocked operation. RESOLUTE code,
services, data, credentials, bucket contents and schedules were not changed.

After that approval: configure the new read-only password, publish/pin the checked
backup image, run one backup and one disposable restore, inspect safe aggregate
results, then enable daily backup and weekly restore-check schedules. Project-loss
key custody, production revocation/deletion replay, missed-job alerts and actual
production recovery remain separate launch gates; no automatic promotion exists.

Local verification with RESOLUTE commit `30faefae02ac1462c9cb3709bb9acd792cf698d7`
preserved: Node 1,257 passed; Python 2,533 passed (including ten new PRO backup
cases); Next build passed; lint zero errors/five existing warnings; compileall,
helper syntax and diff checks passed. Node checks were repeated after integrating
the new RESOLUTE shell/SQL tests. These local checks do not constitute a built
backup Docker image, a real PostgreSQL dump/restore or deployment acceptance.
The preceding recovery-watchdog CI run `39385967422` is completed/success.
