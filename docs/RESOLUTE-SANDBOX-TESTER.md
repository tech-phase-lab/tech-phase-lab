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

## Owner-only PRO preparation — October 16

The user cannot edit Clerk Private metadata in the dashboard; repeated attempts
in other chats failed. Do not ask them to repeat that procedure.
`/resolute/checkout/setup` now provides a Japanese owner-only button. Its POST
handler uses the existing server Clerk client to deep-merge a temporary PRO plan
onto the single configured tester, never onto the caller or a request-supplied ID.
Preview, exact owner session, same origin and a custom request header are required.
The tester must have a verified primary email, must not be banned/locked/admin,
and must not have an existing paid membership. Expiry is server configured, must
be within seven days, and is never extended by retry. Both frontend and backend
continue to enforce the existing Sandbox tester expiry. The write records its
actor/date in private metadata, emits a sanitized operation log, and is read back
before success is shown. Other metadata is preserved. No new credential copy,
payment, product grant, notification or charge is performed by preparation.

This is a real, temporary PRO qualification on the dedicated test identity; it
is separate from the owner's presentation-only membership preview. After expiry,
the plan resolves to FREE. Actual PRO-price payment acceptance remains pending.
The latest supplied initial order was independently checked: JPY 7,980 paid at
2026-10-16 05:27:42 UTC, one active initial grant and one grant audit entry.
The read-only ledger report did not expose its member ID, so the order-to-tester
identity match has not yet been independently verified.
