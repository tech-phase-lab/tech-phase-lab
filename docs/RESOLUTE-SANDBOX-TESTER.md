# Restricted Sandbox tester

The owner requested a separate test account for PRO-price acceptance, keeping
their everyday membership unchanged. A single server-configured Clerk ID may
enter Sandbox checkout until an explicit UTC expiry. Missing or malformed
configuration denies access. Vercel admission is Preview-only; the backend also
requires the existing Sandbox PayPal configuration. Admission is rechecked per
API request and never grants PRO status or product rights. Audit access remains
owner-only; existing per-order ownership and payment verification remain intact.

Configuration: `RESOLUTE_SANDBOX_TEST_USER_ID` and
`RESOLUTE_SANDBOX_TEST_UNTIL` (ISO UTC with `.000Z`). Set only on the requested
preview branch and the dedicated Sandbox payment backend. Do not commit identity
values or emails. Remove the configuration after acceptance.

The USD FREE renewal reported on October 16 was checked against the actual
Sandbox ledger by a read-only transaction: USD 39.00, renewal/free, paid,
one active grant and one grant audit entry. Its period starts at the preceding
expiry, October 15, 2028 15:18:51 UTC, and ends October 15, 2029 15:18:51 UTC.
No payment, grant or membership was modified by that inspection.

PRO-price PayPal payments remain unverified. The new tester still needs an
appropriate server-side PRO qualification and a verified Sandbox initial
purchase before testing renewal. No actual membership upgrade, email dispatch,
live payment, or production entitlement is performed by this change.
