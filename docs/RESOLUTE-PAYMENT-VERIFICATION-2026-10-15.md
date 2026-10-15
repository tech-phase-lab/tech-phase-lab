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

## Local automated coverage

Seven new tests exercise the real payment engine and SQL ledger with simulated
PayPal and member responses. For both Japanese and English they cover initial,
FREE renewal, PRO renewal, consecutive annual periods, idempotent grant creation,
continued access after post-payment PRO downgrade, final identity lookup downgrade
rejection, injected prices/currencies/PRO claims, and renewal without a purchase.
USD capture amount/currency mismatches must not grant access.

This is not evidence of actual USD or renewal payments. PGlite tests do not prove
multi-session PostgreSQL concurrency safety.

## Next steps and privacy

The owner has been asked to approve a USD 59 Sandbox initial purchase in their own
browser. Its capture remains unverified. Never inspect their PayPal management
browser or request login details/screenshots. Do not alter their real PRO membership
to manufacture renewal test eligibility.

Still required before live sales: actual USD and renewal transactions, PostgreSQL
concurrency, dispute delivery, payment-table backup/restore, production entitlement
projection, reconciliation, alert delivery, mobile checkout QA, and deactivation
of legacy fixed payment links. No real-money sales or email dispatch enabled.

## Validation

Final integrated application tree: Node 916/916; Python 2,463/2,463; lint zero
errors (two existing warnings); Next.js production build, Python compileall and
whitespace checks passed. Only tests and handoff documentation changed in this
verification; application behavior was not changed.
