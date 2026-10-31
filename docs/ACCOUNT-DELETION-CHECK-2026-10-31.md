# Account deletion: all-contract check — 2026-10-31

Display verification is delegated to Claude by the owner. No browser sign-in, UI/CSS changes, Clerk settings, environment variables, payment actions or real user deletions are part of this change.

## Implemented

The existing account card selects one subscription. It is unsuitable as the final authority for deleting an identity. Added a separate read-only billing action that examines historical subscriptions as well as current subscriptions and verifies their provider binding with the existing PayPal client.

- Billing service: `GET /live/deletion-check`.
- Authentication: existing `TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN` bearer header, plus the server-selected `X-Tech-Phase-User`. No new secret or database migration.
- Next.js: existing `GET /api/research/account/deletion` uses the new check with existing Clerk authentication. Owner identities are rejected before requesting billing evidence.
- Response: `verification` (`verified` / `unavailable`), `autoRenew` (`true` / `false` / `null`), `reason` (`auto-renew-active` / `no-renewing-contract` / `contract-unverified`), `proAccessLostAtDeletion` (existing verified entitlement expiry or null).
- No provider IDs, keys, raw errors, email addresses or tokens in the response or logs.
- Active provider subscription anywhere blocks deletion. Pending/suspended/unbound contracts, unexpected provider status, mismatched binding and provider failures remain unknown.
- Read the subscription inventory again after provider checks. New or changed local contracts invalidate the check. This is NOT a concurrency fence: a future deletion executor must block new checkout and recheck under that fence.
- Bounded to 20 contracts (21st row detects overflow) with at most five provider reads in parallel. Larger histories remain unavailable, never silently truncated into an approval.
- Old billing deployments returning 404, timeout or malformed evidence remain unavailable. No fallback to the single-contract card.
- Existing GET response retains `canDelete:false`. DELETE remains 409. This step does not activate deletion.

## Remaining deletion work (not completed)

| Data | Existing storage / behavior | Required deletion integration |
| --- | --- | --- |
| Identity and sessions | Clerk | Verify provider self-delete policy; final deletion/session revocation only after durable cleanup; settings were not changed |
| Saved research | Monitor SQLite `member_saved_research` | Server-derived HMAC owner; purge with tombstone to prevent stale client re-upload |
| Watchlists | Monitor SQLite `member_favorite_lists` | Same purge/tombstone requirement using its distinct owner-key namespace |
| Questions and Desk reactions | Monitor records keyed with `question:` / `desk-reaction:` HMAC namespaces | Include personal attribution/reactions in the cleanup scope; preserve unrelated operator answers |
| Push devices | Monitor SQLite `push_devices`, preferences, deliveries, test attempts | Stop delivery first, purge subscriber endpoint/key material and dependent rows |
| RESOLUTE personal data | Separate PostgreSQL plans/settings/outbox and protected backups | Stop delivery and use the existing deletion/protection event conventions; do not discard backup tombstones or payment evidence |
| Billing evidence | Existing PRO and RESOLUTE ledgers | Retain required audit records; prevent new checkout while deletion is pending; remove remaining service access |
| Client copies | Browser storage and cloud sync | Remove personal local copies and prevent stale restore/re-upload |

HMAC-keyed records also need a strategy for previously rotated monitor keys; the current key alone cannot prove removal of historical records.

A durable deletion job must record each completed step and resume after failure. The all-contract check is only one prerequisite. Do not wire a direct Clerk delete button as a workaround.

## Handoff to Claude

No visual change is needed for this addition. The existing account-deletion API shape and disabled button remain compatible. Continue to respect `canDelete:false` and show its reason; `no-renewing-contract` alone is not deletion permission. Deploy the billing backend before relying on the richer deletion reason. Display verification of PR #274 is assigned to Claude.

## Tests

Regression cases cover historical active contracts, terminal/empty histories, pending/suspended states, missing provider bindings, foreign identities, provider failures, review holds, oversized histories, concurrent local changes, database scoping, service authentication, GET-only routing, old backend compatibility and sanitized responses. No live payment or deletion is used by these tests.
