# Production payment ledger preparation

2026-10-19. Implementation is dormant, not a live-sale activation.

## Prepared boundary

- Explicit migration `014_payments_live.sql` creates a separate production ledger.
  It is not applied automatically and never imports Sandbox purchases.
- The server-side store accepts only `sandbox` (default) or `live`. HTTP request
  data cannot select the ledger. Existing runtime and PayPal adapter remain
  Sandbox-only. Live writes use a distinct audit code.
- Live purchase and adverse-event transactions use the same per-member lock as
  plan/settings operations. Verified payment recording, grant and audit stay in
  one transaction. Duplicate completion cannot grant twice; late completion
  cannot undo revocation or suspension.
- `createLiveEntitlementReader` reads a single SQL snapshot from the production
  ledger. It verifies matching member/product/kind and recorded capture/payment
  before trusting a grant. This is a prepared adapter, not wired to runtime.
- Consecutive notification periods merge; refunds leave gaps. A current period
  wins over future periods; otherwise the next period is scheduled or the last
  period is expired. Revoking the initial purchase blocks both capabilities.
  Direct ledger reads avoid stale asynchronously copied entitlement flags.

## Verification scope

Disposable local PostgreSQL-compatible tests exercise the real SQL/store and
reader, duplicate recording, cross-member denial, missing payment evidence,
refunds, late completion and Sandbox isolation. They do not call PayPal or prove
real signed-event delivery. Fixture payment inputs stand in for the existing
verified-payment boundary, not an alternative way to confirm real payments.

## Remaining before enabling

1. Review and explicitly apply the production migration and scoped writer/reader
   grants. Do not grant the payment writer access to unrelated schemas.
2. Connect all entitlement consumers consistently: the ordinary entitlement API,
   plans, notification settings and notification outbox checks. Do not switch
   just one reader while the others still use the old entitlement table.
3. Keep restore checks, refund/dispute reconciliation and operator alerts aligned
   with the production ledger. Verify a real isolated backup restore.
4. Configure and validate live PayPal credentials, receiving merchant, webhooks,
   allowed return origin and legacy-link retirement with the owner. Live charging
   is still explicitly rejected by the existing PayPal adapter.
5. Verify real payments/approval flow separately before opening sales. Customer
   email and RIZEL publication remain independently disabled until authorized.

No migration, credential setting, real payment, email, new contract or customer
publication is performed by this implementation batch.

## Shared consumer connection (prepared, still disabled)

The entitlement API, plan store, notification settings and notification outbox
now use the same server-only `RESOLUTE_ENTITLEMENT_SOURCE` selection. Unset or
`legacy` preserves the current reader; `live` selects the verified production
ledger. Invalid configuration is rejected. No environment setting was changed.

A narrow `entitlement_periods` view exposes only the member/product, purchase kind
and periods from matching paid orders. Entitlement consumers require SELECT only
on this view, not raw orders, payment IDs, quotes or audit records. The migration
remains unapplied; the view is included in that not-yet-applied migration.

The SQL merges adjacent periods, selects the current interval or next scheduled
interval (otherwise the last expired interval), and never fills refund gaps.
All readers use this same logic. Plan deletion remains available after access loss.
The dedicated live adapter delegates to the same reader instead of maintaining a
second production interpretation of access.

Before activation, apply the migration and scoped view permissions, deploy all
consumers together, verify isolated restore and actual production configuration,
and then change the source only after the release gates pass. Existing legacy
admin/test entitlements are deliberately not merged into live purchases. Verify
which operator/test access must remain available before switching the setting.

## Empty-ledger provisioning and restore acceptance

`scripts/resolute/provision-live-ledger.mjs` is an explicit operator-only job.
It applies migration 014 atomically to the dedicated database, checks that all
five tables and the entitlement view are empty, and verifies that the existing
API reader and Sandbox writer have no schema access. It creates no credentials,
imports no Sandbox records, and does not activate payments or entitlement reads.
An existing schema stops the job; inspect it before considering a retry.

The isolated restore job validates both payment ledgers when the live schema is
present. It requires a matching paid/captured order and exactly one grant audit
record, checks refund/suspension state consistency, and checks that the narrow
entitlement view survived restoration. A missing live schema is explicitly
reported as `not_installed`, never as a successful production-ledger check.
After provisioning, set `RESOLUTE_REQUIRE_LIVE_LEDGER=true` on the isolated
restore service so an older backup without that schema fails acceptance.
A verified empty ledger is a schema/restore result, not proof of live payment
processing. Database roles and ACLs are excluded from these data backups and
must be provisioned separately before activation.

## Live PayPal boundary (prepared, not routed)

The existing HTTP runtime remains Sandbox-only. `live-services.mjs` is a dormant
factory, not imported by API startup and not exposed as an HTTP endpoint. It uses
a distinct live database URL and exact writer role, dedicated live PayPal keys,
and the shared live entitlement source. The Sandbox credential names are never
fallbacks. `RESOLUTE_PAYPAL_LIVE_ENABLED` prepares provider connectivity;
`RESOLUTE_LIVE_SALES_ENABLED` separately permits creating/capturing orders.
Neither flag is configured by this code. With sales disabled, verified adverse
notifications can still stop existing grants. Check the sales flag again directly
before the capture API call, even if a request began while sales were open.

PayPal API, approval and certificate hosts use fixed environment-specific lists.
The return URL is derived from a server-only HTTPS site origin and the fixed
checkout path. No browser amount, API host or callback URL is accepted. Live
responses do not claim to be Sandbox responses. Refund-link parsing is restricted
to the selected provider environment and never fetches the supplied URL.

Migration 015 and `provision-live-role.mjs` prepare a NOLOGIN role with no password.
It may read/insert/update live orders and grants, append events/audit/alert entries,
and read the entitlement view. It cannot delete/truncate, rewrite audit or event
history, mark email delivery, or change schema. Before committing, the operator job
rejects access to unrelated application tables. Role and ACL definitions are not
inside the existing no-owner/no-ACL data backups; replay the reviewed role migration
separately when restoring infrastructure. A future credential step is still needed.

Remaining release work includes live credentials and merchant/webhook verification,
permission readback on actual authenticated connections, frontend/HTTP wiring,
explicit owner approval to open sales, and retirement of the old fixed links.
No live API calls or real payments are implied by the local provider doubles.
PayPal references: https://developer.paypal.com/api/rest/production/ and
https://developer.paypal.com/api/rest/webhooks/rest/ (reviewed 2026-10-19).

## Authenticated live HTTP preparation (2026-10-19)

The API now has a separate `/internal/v1/live-payments` namespace and
`/webhooks/paypal-live`. The website proxy is `/api/resolute/live-payments`.
All are dormant unless server-only `RESOLUTE_PAYPAL_LIVE_ENABLED=true`.
No request field or URL query switches a Sandbox transaction into live mode.
The proxy requires Clerk identity and a same-origin JSON POST; the API verifies
both the service token and the member JWT. Audit is owner-only. The live access
route uses the verified live entitlement reader rather than Sandbox access.

Order creation and capture additionally require `RESOLUTE_LIVE_SALES_ENABLED`
on both hosts (the API engine rechecks immediately before capture). Order status,
access and verified webhook processing remain available if sales alone are stopped.
Keep provider credentials enabled after launch when stopping sales, so refunds and
disputes can still revoke rights. Turning off provider configuration disables the
whole live integration, including webhooks.

No live settings, credential, database-login permission or entitlement source is
activated by this code change. The existing checkout UI remains Sandbox-only;
its live presentation and real provider end-to-end validation are still pending.

## Live checkout UI preparation (2026-10-19)

`/resolute/checkout` now selects the live screen only from the server's
`RESOLUTE_PAYPAL_LIVE_ENABLED` flag. While disabled, preview keeps the existing
owner/tester Sandbox screen; non-preview shows closed checkout. Missing membership
configuration also fails closed. No query parameter selects live payments.

The live screen requires signed-in membership, uses only `/api/resolute/live-payments`,
and disables create, approval and capture controls when sales are closed. Changing
JA/EN only changes display once an order exists: its ID, purchase type, currency
and amount remain server-owned. Retry after an unknown create failure reuses the
same request key. Live order readback restores the same PayPal approval link;
viewing the return page does not invoke capture. Account-session changes remount
checkout so one member's state is not retained for another.

No live settings or keys have been enabled. Real member-to-PayPal live checkout
and smartphone browser rendering remain unverified until explicitly recorded.
