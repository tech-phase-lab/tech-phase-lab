# Membership recovery and launch display — 2026-10-06

Scope: membership presentation/session recovery and launch decoration only. News,
price targets, intake, translation and their display components belong to the other
ongoing work and were not edited in this change.

## Changes

- Account screen now renews the identity session before reading membership, using
  the same bounded recovery path as the header. A stale signed-out response gets
  one forced refresh before it is accepted.
- Session renewal deduplication is keyed by session ID, preventing a new login
  from reusing a pending refresh belonging to another session.
- Membership presentation retries transient failures after two seconds, up to
  three retries; network recovery triggers another verification. Unverified states
  remain unverified and do not grant PRO. Server entitlements remain authoritative.
- New documents and reloads display the brand for at most 1.2 seconds after first
  becoming visible. The former standalone-only, sessionStorage and 1.8-second
  navigation-time conditions were removed. History restoration and background
  resume do not replay the decoration. No API response is needed to dismiss it.

## Verification scope

Behavioral tests cover retry recovery to PRO, confirmed FREE, bounded persistent
failure, launch/reload, denied storage, slow server response, background launch,
and dismissal without replay. Existing entitlement and signed display-token tests
remain in place. The account navigation test only gained mocks for new imports;
its existing owner-only assertions were preserved.

No live member plan/private metadata was changed. These tests do not establish
that the user's exact prior FREE transition has been reproduced. Actual iPhone
standalone lifecycle and signed-in owner/PRO sessions still require device-level
observation. A new browser/document load is distinct from returning to an already
open app: the latter intentionally keeps the home screen immediately available.
