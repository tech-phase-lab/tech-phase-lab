# Account follow-up — 2026-10-31

## Scope and audit
Existing account UI and API were already implemented. This follow-up corrects specific integration errors; it does not recreate billing, redesign Claude’s UI, or claim all account work complete. News and Claude-owned features are untouched.

| Area | Existing implementation | Follow-up |
| --- | --- | --- |
| Name and icon | Profile GET/PATCH; initial + 23 approved IDs; invalid legacy IDs become initial; owner icon fixed | Retained |
| Email/password/MFA | Clerk verified UserProfile flow | Reject incomplete security flags; unavailable profile must not display MFA off; refresh after returning to the page |
| Membership | Existing membership resolver | Reject unavailable or mismatched session instead of returning a false FREE profile |
| Owner paid contract | Existing contract API | UI now calls it for owners too; no hardcoded “no paid contract” or fabricated dates |
| RESOLUTE | Existing self-entitlement API | Display unavailable result explicitly, with retry |
| Owner FREE/PRO viewing | Already implemented in 8f55 / 7f704 | Retained; prior handoff corrected |
| Member search/CSV | Existing admin endpoint and UI | Retained; CSV API is paginated |
| Delivery status | Existing admin endpoint | Some source metrics remain unavailable; do not report fabricated zeroes |
| Deletion | Guarded GET; DELETE returns 409 | Still blocked; see below |

## Deletion remains incomplete
The existing endpoint deliberately cannot delete. Auto-renew must stop first, but stopping renewal alone does not make deletion safe. There is no unified cleanup/retry workflow for Clerk, saved research, watchlists, push devices and RESOLUTE. Required work includes a durable deletion ledger, new-checkout fence, all-contract recheck, data-retention handling and final session revocation. No partial user deletion was added.

Clerk’s production `delete_self` capability has not been verified. The security page embeds Clerk UserProfile; do not claim deletion restrictions are enforced globally until provider self-deletion is checked. Hiding a UI button is insufficient.

## Verification
- Added regression coverage for membership failure/identity mismatch, missing MFA flags, real owner contract states and unavailable RESOLUTE display.
- Production logged-out HTTP probes: profile/contract/deletion 401; admin members/delivery 403. The earlier unauthenticated 503 was not reproduced.
- Production account page opens the login screen in the available browser; no authenticated session was available. No real user, contract, password, email or MFA state was changed.
- Full local gates passed: lint (0 errors, 11 existing warnings), Node suite (0 failures), Python suite (2,678 tests), production build, Python compileall and git diff check. Passing mocked tests is not a claim of signed-in production acceptance.

## Release boundary
Publish on codex/research-preview only. Main is unchanged. Confirm signed-in display on the preview before production promotion, per the owner’s prior instruction. This follow-up changes data handling and reuses existing visual styles; no CSS or theme replacement.
