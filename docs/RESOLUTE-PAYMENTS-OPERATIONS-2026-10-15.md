# RESOLUTE Sandbox operations — 2026-10-15

## Verified state

At the initial connection-check checkpoint, purchases were disabled
(`RESOLUTE_PAYMENTS_ENABLED=false`), Sandbox only,
operator only. No real payment, production entitlement grant, customer email or
paid-service subscription was performed. Do not ask the owner to repeat the
successful PayPal/Clerk credential setup. Secret values were not printed or saved
in source. All timestamps below are UTC.

Railway project `0872be15-db75-4e5a-ae0f-881911fb442d`, environment
`3a80776d-15a3-4ca1-bd0c-e0c915ccf73b` (named production, but payment code is Sandbox).
Existing entitlement data and unrelated research services were preserved.

| Check | Deployment | Evidence |
| --- | --- | --- |
| Pre-migration encrypted backup | `cd30fdad-2018-45ac-8a61-b18e5be6bba3` | 11:44:16, `RESOLUTE_BACKUP_OK`, encrypted 5,179 bytes; checksum/readback passed |
| Isolated restore | `eb72cccd-038d-467f-8861-da31a0deb5b4` | 11:45:21, `RESOLUTE_RESTORE_OK`; decrypt, checksums, restore, two probe rows and primary key passed |
| Sandbox schema and writer | `772e5388-ba4e-4763-8ffa-3450ea363fd5` | 11:59:53, `RESOLUTE_PAYMENT_SCHEMA_OK`; isolated privileges, writer login and rolled-back fixture passed |
| Original reader recheck | `99430233-dbfc-4e36-847c-7c85032c9c68` | 12:01:32, `RESOLUTE_READER_VERIFIED`, writes 0 |
| PayPal and Clerk connections | `b67d2cf0-14bf-45b6-b0ad-d578612991e3` | 12:07:54, `RESOLUTE_PAYMENT_CONNECTION_CHECK`, all checks true, writes 0 |
| Verification function restored | `6b046e7c-ab98-44bd-bcbc-1c6f70a6eb82` | 12:09:53, `RESOLUTE_READER_VERIFIED`, writes 0; source equals original |

## Database operation

Applied `db/resolute/010_payments_sandbox.sql` in an explicit transaction with an
advisory lock. The migration refused an existing schema/role rather than overwriting
it. Created `resolute_payments_sandbox` with orders, grants, events, audit and
alert_outbox, and a random-password login `resolute_payment_sandbox_writer`.

Writer has CONNECT and schema USAGE; SELECT/INSERT/UPDATE on orders, grants and
alert_outbox; SELECT/INSERT on events and audit; sequence USAGE/SELECT. It has no
superuser, inheritance, role/database creation, replication or RLS bypass, no schema
CREATE, no DELETE/TRUNCATE and no table privileges outside the sandbox schema
(system catalog schemas excluded). A real writer connection and rolled-back event
insert passed. Production entitlement rows were not changed.

Added `RESOLUTE_PAYMENT_DB_URL` to resolute-api, using this role over private
Railway networking. Kept `ENTITLEMENT_DB_URL` unchanged. The provisioning helper
was returned to its original read-only verification function. The writer password
remains an operator-managed provisioning variable, never in this repository.

## Connection checks

A one-off read-only job used Railway variable references to the existing API
credentials. It required Sandbox and purchases disabled before any request.

- PayPal Sandbox OAuth authentication succeeded.
- GET of the configured webhook using that same app's token succeeded; ID and
  URL matched `https://resolute-api-production.up.railway.app/webhooks/paypal`.
- Exactly six subscribed events matched: PAYMENT.CAPTURE.COMPLETED/REFUNDED/REVERSED
  and CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED; none missing.
- Clerk fetched the configured owner account; ID matched, primary email verified,
  account neither banned nor locked. No email address or metadata was logged.

The job did not create/capture/refund an order or change Clerk users. Its temporary
credential references were replaced with empty values and original function source
restored. No staged Railway changes remained after restoration.

Public HTTP checks after DB setup: healthz 200; internal create while disabled 503
PAYMENT_DISABLED; unsigned webhook 400 INVALID_SIGNATURE. The last check proves
unsigned rejection, not successful signed-event processing. It may create the
implemented security audit/outbox entry; no email delivery adapter is enabled.

## Next required work

1. Build the owner-only Sandbox approval/return experience and verify authenticated
   browser-to-Vercel-to-Railway calls. Do not open public sales.
2. Exercise actual Sandbox approval/capture, all server price cases, receiving
   merchant match, duplicate notifications, refunds/disputes, rejection paths and
   concurrent PostgreSQL transactions. OAuth success does not prove payee matching.
3. Take and restore a post-migration backup that explicitly verifies the new payment
   tables. The successful backup above predates their creation.
4. Complete alert delivery/retry and audited reinstatement design; email delivery,
   verified sender and live customer mail remain unconfigured. No new paid services.
5. Finish production ledger/entitlement projection and reconciliation before launch;
   deactivate and directly verify all eight legacy PayPal fixed links before live
   sales. No fixed link was disabled in this operation.

Do not describe the purchase or entitlement flow as complete based on these checks.
Application implementation and safety gates remain documented in RESOLUTE-PAYMENTS.md.


## 12:38 UTC — owner Sandbox checkout enabled

Implementation commit `716aace43d20db98c9cbf71f24c3e488add8b172` adds
`/resolute/checkout` and the owner-review link. It fixes callback URLs on the server,
validates PayPal approval URLs, and requires explicit POST confirmation after return.
Local final integrated gates: lint 0 errors (2 pre-existing warnings), Node 905/905,
Python 2439/2439, build, compileall and diff checks passed. Remote tree SHA exactly
matched staged local tree `09fedec9b669f8724834a7e403e6c381702dbe2f`.

Vercel deployment `dpl_8aNKWjY4EvsTgZNikHqcSdVD7gtr` READY. Railway API pinned to
that commit, deployment `55ac97d0-925a-4467-abdc-eaac6197c884` SUCCESS with
RESOLUTE_API_READY. `RESOLUTE_PAYMENTS_ENABLED=true` now permits ONLY the existing
owner allowlist and ONLY Sandbox. Live is still rejected in code. Anonymous create
returns 401 AUTH_REQUIRED. No production entitlement or email delivery was enabled.

Actual authenticated browser checks: owner-review link opens checkout; Japanese
initial order displays JPY 7,980, English initial order displays USD 59.00; both
orders are created by PayPal Sandbox. Japanese approval link reaches the real
PayPal Sandbox login, and its cancel link points back to the correct internal order.
Both orders remain unapproved/unpaid at this checkpoint. No grant or capture was
performed. Continue with the owner's Sandbox Personal buyer login through secure
browser authentication, never credentials in chat. The business seller account is
not the buyer account. Desktop layout was inspected; narrow mobile layout remains
unverified (this browser did not change viewport using keyboard controls).

GitHub run `38735400659` was cancelled when a separate newer branch commit landed;
this is not a passing CI result. Subsequent `313ce03` only changes research notebook
PDF controls and docs; it was fast-forwarded without altering checkout. Verify the
latest descendant CI result. The external PayPal login initially chose French from
its browser location; switching its visible English link worked. Add explicit
PayPal experience locale in a future checked change if needed.

Next gates remain actual buyer approval/capture, signed completion delivery,
refund/dispute/concurrent-DB tests and post-migration backup restore. API success
and correct order amounts do not complete those gates.
