# Account API audit before implementation — 2026-10-31
Base: codex/research-preview 289ee9df. No UI or checkout rewrite.

| Requirement | Existing | Gap |
|---|---|---|
| Membership | GET /api/research/member | Missing profile/security flags/avatar |
| Profile mutations | Clerk UserProfile at /research/account/security | Add constrained display name/avatar endpoint |
| Email/password/MFA | Clerk authenticated UserProfile | Reuse verification flows, never admin-reset passwords or bypass email/MFA verification |
| PRO | /api/research/billing/live/status, cancel, reconcile | Status lacks PayPal amount/next billing; owner access separate from paid contract |
| RESOLUTE | GET /api/resolute/entitlements | use.status, alerts.expiresAt already available; failure returns 503, not missing purchase |
| Deletion | No cross-service account deletion orchestration found | Must fence new checkout, cancel/verify all contracts, purge cloud/local saved data, revoke sessions, retain necessary billing ledger. Do not delete Clerk alone |
| Member search/export | /api/research/member/export uses old Clerk metadata | Add owner-only search with current billing evidence; replace export source |
| Delivery | Monitor state webPush / existing operational endpoints | Whitelist aggregate fields only; worker success != notification delivery; unknown never zero |

News collection/processing is Claude-owned and is not modified. Existing user/password/token/endpoint values must not be logged.
