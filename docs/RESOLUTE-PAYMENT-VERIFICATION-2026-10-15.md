# RESOLUTE payment verification — 2026-10-15

## Actual Sandbox observations

- Owner approved the JPY 7,980 initial purchase. Capture and signed completion
  notification succeeded; exactly one Sandbox grant was recorded.
- Initial refund attempts failed due to insufficient Sandbox seller funds. After
  the owner increased the Business test balance, the same idempotent refund
  succeeded. The refund notification revoked the order and its grant.
- Replaying completion notifications did not create a second grant or restore
  the refunded grant. Verifier database access was read-only.
- The temporary verification function was restored to its original read-only
  function and temporary PayPal credential references were cleared.
- These observations concern Sandbox only. No production entitlement was granted.
- USD 59 initial purchase: capture and completion notification succeeded. The
  ledger contained exactly one active annual grant.
- JPY 5,980 FREE renewal: capture and completion notification succeeded. Exactly
  one renewal grant extended the existing annual period by one year, without a
  gap or duplicate grant. Database verification was read-only and the temporary
  verifier was restored afterward.

## Local automated coverage

Seven new tests exercise the real payment engine and SQL ledger with simulated
PayPal and member responses. For both Japanese and English they cover initial,
FREE renewal, PRO renewal, consecutive annual periods, idempotent grant creation,
continued access after post-payment PRO downgrade, final identity lookup downgrade
rejection, injected prices/currencies/PRO claims, and renewal without a purchase.
USD capture amount/currency mismatches must not grant access.

The automated tests do not establish actual PRO-price payments. PGlite tests do
not prove multi-session PostgreSQL concurrency safety.

## PostgreSQL concurrency gate

Added a separate CI job using a disposable PostgreSQL 17 service. Five tests
exercise the real SQL store across simultaneous connections: repeated order
creation, repeated completion, competing capture authorization, refund racing
completion, and repeated renewal completion. The refund race also checks that
only one alert is queued and delayed completion cannot revive revoked access.
The test refuses non-loopback databases and databases containing application
tables. It does not contact PayPal or Clerk or use deployment credentials.
Execution result remains pending until the new CI job completes; adding the
tests alone is not a passing concurrency result.

## Next steps and privacy

USD initial and JPY FREE renewal purchases are verified as described above.
Never inspect the owner's PayPal management browser or request login details or
screenshots. Do not alter their real PRO membership to manufacture renewal test
eligibility. Actual PRO-price testing requires an isolated eligible identity and
appropriately restricted test configuration; that setup has not been performed.

Repeated temporary verifier deployments caused repeated Railway approval dialogs.
Avoid this workflow for routine checks. Existing authenticated order-status and
audit routes can support inspection without redeployment; accessing them still
requires normal owner authentication. The status route may reconcile a pending
capture, so it is not a strictly read-only database audit. Current routes do not
replace checks of grant count and grant periods. Do not bypass deployment
approvals or relax authentication to obtain easier access.

Still required before live sales: actual USD FREE and JPY/USD PRO renewals, PostgreSQL
concurrency, dispute delivery, payment-table backup/restore, production entitlement
projection, reconciliation, alert delivery, mobile checkout QA, and deactivation
of legacy fixed payment links. No real-money sales or email dispatch enabled.

## Validation

Final integrated application tree: Node 916/916; Python 2,463/2,463; lint zero
errors (two existing warnings); Next.js production build, Python compileall and
whitespace checks passed. Only tests and handoff documentation changed in this
verification; application behavior was not changed.
