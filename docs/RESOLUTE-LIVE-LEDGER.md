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
