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
