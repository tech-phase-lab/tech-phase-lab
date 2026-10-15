# RESOLUTE payments — Sandbox implementation

## Status and boundary

This is an operator-only Sandbox implementation, not a launch of sales. The runtime
rejects every environment other than `sandbox`. It writes only to
`resolute_payments_sandbox`; it never grants access through `resolute.entitlements`.
The existing entitlement reader remains read-only. Existing screens and approved
Japanese/English copy are unchanged. No fixed PayPal links are used by this code.

User approved per-member orders, server prices and PRO checks, verified completion,
idempotency, refunds/disputes, revocation history and owner alerting. Full refunds and
reversals revoke that purchase; partial refunds and disputes suspend it for review.
A dispute resolution does not automatically restore access. A late completion cannot
revive revoked/suspended access. The customer's verified Clerk account owns the order;
PayPal email equality is not used to select an account.

## Implemented

- Server price table: initial JPY 7,980/9,800, USD 59/69; renewal FREE JPY 5,980 /
  USD 39, PRO JPY 3,980 / USD 29. Launch ends at 2027-02-28T15:00:00Z worldwide.
- Strict input rejects client amount, currency, userId and plan fields.
- Real server-fetched Clerk private metadata only; no owner/preview discount.
  Check verified primary email and banned/locked status. Recheck before capture.
- Internal UUID and buyer binding; durable create/capture idempotency keys; at most
  one capturing order per member. Fifteen-minute order expiry. Changed prices need
  a new order and buyer approval; no automatic amount increase.
- PayPal signature postback verification and fixed-host API reads. Match order,
  internal reference/custom/invoice IDs, SKU, quantity, payee, amount, currency,
  completed state, final capture and time bounds before adding a grant.
- PostgreSQL per-member locks, unique capture and grant identifiers, transactional
  grants/audit records. Lost capture responses reconcile via GET without a second
  capture. Sandbox grants model calendar years, with Feb 29 clamped to Feb 28.
- Audit records and durable alert outbox. Duplicate deliveries cannot grant twice.
  Invalid-signature alerts coalesce per minute; logs contain no tokens or raw payloads.

## Routes

Railway:
- POST `/internal/v1/payments/orders`: `{kind:"initial"|"renewal",language:"ja"|"en",requestKey:UUIDv4}`
- POST `/internal/v1/payments/capture`: `{orderId:UUIDv4}`
- GET `/internal/v1/payments/orders/:id`: owner-scoped reconciliation/status
- GET `/internal/v1/payments/audit`: last 100 events, operator only
- POST `/webhooks/paypal`: public HTTPS entry point, signature required before processing

Vercel proxies the internal routes under `/api/resolute/payments/`. It requires the
approved owner session and checks Origin on POST. Railway independently verifies
both the service credential and Clerk JWT. GET and return pages never authorize a
capture; status may reconcile a previously authorized, PayPal-completed capture.
The owner-only `/resolute/checkout` page is linked from owner review. It supports
Japanese and English, shows the server quote, and redirects only to the validated
Sandbox approval link for that order. PayPal return/cancel URLs are fixed to the
preview branch checkout page on the server. Return query parameters cannot trigger
a capture: the owner must explicitly confirm via POST after approval. Returning or
refreshing only reads status (or reconciles an already authorized completed capture).
The UI retains the create request key for retries and prevents overlapping clicks;
a lost capture response directs the owner to refresh status first. No public sales
link or live purchase is activated.

## Configuration

2026-10-15 update: Sandbox schema/role provisioning and live read-only PayPal/Clerk
authentication checks have passed. See `RESOLUTE-PAYMENTS-OPERATIONS-2026-10-15.md`
for deployment evidence and the remaining rollout gates. The later 12:38 UTC
checkpoint enables owner-only Sandbox checkout; public/live sales remain disabled.
The setup instructions below are retained for reproducibility.

User has added these to Railway resolute-api, with a successful configuration deploy:
`RESOLUTE_PAYPAL_ENV=sandbox`, `RESOLUTE_PAYPAL_CLIENT_ID`,
`RESOLUTE_PAYPAL_CLIENT_SECRET`, `RESOLUTE_PAYMENT_ALERT_EMAIL`,
`RESOLUTE_PAYMENTS_ENABLED=false`.
Values were not fetched. Presence/deployment is not proof of successful API auth.
Do not embed the owner email or any credential in the repository.

Before enabling Sandbox, additionally prepare:
- `RESOLUTE_PAYPAL_MERCHANT_ID`: receiving Sandbox business account's merchant ID.
- `RESOLUTE_PAYPAL_WEBHOOK_ID`: the ID of the webhook registered on this same Sandbox app.
- `RESOLUTE_PAYMENT_CLERK_SECRET_KEY`: server-only key for the existing Clerk instance,
  to fetch real membership metadata. Never use a client-supplied plan.
- `RESOLUTE_PAYMENT_DB_URL`: dedicated resolute database connection as
  `resolute_payment_sandbox_writer`. Never replace `ENTITLEMENT_DB_URL`.

Apply `db/resolute/010_payments_sandbox.sql` explicitly after a verified backup.
Provision a non-admin login role out of band with USAGE on the sandbox schema,
SELECT/INSERT/UPDATE on its orders and grants, SELECT/INSERT on its events and audit,
SELECT/INSERT/UPDATE on its alert_outbox and USAGE/SELECT on its identity sequence.
No access to production entitlement tables, DDL, DELETE, role creation or other DBs.
No migration runs from HTTP or application startup. Existing records are not altered.

The planned listener URL is
`https://resolute-api-production.up.railway.app/webhooks/paypal`.
Register only against the deployed route. Subscribe to PAYMENT.CAPTURE.COMPLETED,
PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED and
CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED. Sandbox simulator events cannot use
PayPal postback signature verification; exercise real Sandbox orders and events.

## Not completed / rollout gates

- Real PayPal approval/capture/refund/dispute tests and multi-session PostgreSQL
  concurrency. Credential authentication, schema/role provisioning and the registered
  webhook URL plus all six event types were verified on 2026-10-15. This does not
  prove delivery/processing of a real signed payment event or the receiving payee.
- Live browser acceptance of the owner-only checkout and PayPal approval/return flow.
  UI and fixed server callbacks are implemented; actual payment completion is not
  proven by unit tests or a successful build.
- Email delivery adapter, verified sender, delivery/retry worker and owner dashboard.
  Outbox creation is implemented, email delivery is NOT implemented or enabled.
- Reviewed reinstatement operation with audit reason and operator identity.
- Production ledger/entitlement projection and launch activation. Sandbox enablement
  must not be described as a production purchase granting actual tool access.
- Deactivate all eight legacy fixed links in PayPal and verify direct access cannot pay;
  removing links from a page or rejecting a webhook does not prevent discounted charges.
  No PayPal dashboard link was disabled in this change.
- Recover stalled captures without relying on receipt of a webhook; status currently
  supports owner-requested reconciliation but there is no scheduled reconciler.

Do not switch to live, open sales, change billing plans or claim the alert mailer is
running until these gates have been completed. Alert destination approval is not
approval to subscribe to a paid email provider or send customer marketing mail.
