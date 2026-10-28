# Live billing backup verification — 2026-10-28

Source: `e7d411fb815cfef734b764488779984fc69d7f7c`, `codex/research-preview`.

## Verified

- Dedicated SELECT-only database reader provisioned by owner; TLS backup connection succeeded.
- Backup service `3aae1c03-a9ca-45c0-a316-eff01bc149f1`: deployment `8018bc08-cbcf-4a84-afe2-f2caf6cfe1d6` emitted `TECH_PHASE_LIVE_BACKUP_OK` at 06:58:15 UTC. Encrypted object: 16,839 bytes; one retained snapshot. Upload, authenticated readback and decryption comparison passed.
- Restore service `ad93e625-e890-41b2-b55d-54f2b7d36d4c`: deployment `ecba73d6-fc2c-48bf-bbd7-f4860b255b4b` emitted `TECH_PHASE_RESTORE_CHECK_OK` at 06:59:54 UTC. Authenticated decryption, pg_restore, ledger and entitlement view checks passed in an isolated temporary database. No promotion to production.
- All seven Live billing tables currently contain zero rows. This verifies restoration of the present empty ledger, not recovery of real paid subscriptions.
- Railway configuration reads daily backup cron `30 0 * * *` (09:30 JST) and weekly restore cron `0 1 * * 1` (Monday 10:00 JST), with no staged changes. First scheduled executions have not yet been observed. Reconnecting the identical source produced SKIPPED deployment `d80864f4-76a6-4e78-9b99-ae7f786dfb1b`; it is not a second successful backup.
- Temporary provisioning service was deleted. No existing account, billing, news or database service was redeployed by this backup setup.

## Remaining

- Independent missed-run/failure notifications are not configured; both monitor fields report disabled.
- Owner must securely retain `TECH_PHASE_LIVE_BACKUP_KEY_HEX` outside Railway. Do not put its value in chat, repository or logs.
- Storage uses the existing PRO backup bucket with a distinct Live prefix and encryption key; this is not separate-account or bucket-level isolation.
- Live purchase/webhook/entitlement acceptance and post-payment recovery remain separate tasks. No real purchase was performed; sales and entitlement flags were not enabled.

## Follow-up — 18:43 JST

- Owner confirmed independent key storage before this follow-up.
- Created Healthchecks checks `Tech Phase PRO Live daily backup` and `Tech Phase PRO Live weekly restore`, UTC cron as above, 30-minute grace. Both inherit the existing operator email integration (down only); no existing checks or recipients were changed. Nine checks in use, within the displayed twenty-check capacity.
- Set dedicated `TECH_PHASE_LIVE_BACKUP_MONITOR_PING_URL` on each Live service. No ping URL is stored in this document.
- Backup deployment `7a3c429f-ecbe-404d-a152-2afe33140dfa` SUCCESS; finite run at 09:43:08 UTC emitted backup OK (16,839 bytes) and monitor_start/monitor_finish both sent.
- Restore deployment `e8ce5dfa-47f8-4882-8fbf-990d74878c04` SUCCESS; finite run at 09:41:58 UTC emitted restore OK (all seven tables empty) and both monitoring signals sent. Healthchecks visibly showed both new checks green with two-/three-second run durations. First scheduled runs and new Live failure/missed-run email delivery remain unverified; no synthetic failure email was sent.
- Existing Sandbox and RESOLUTE weekly restore checks were already down in the monitoring overview; their last pings were Monday. No investigation or edits to those services were included in this Live task.
- Created empty `tech-phase-billing-recovery-live` service `d74d5c49-f34e-45f1-9bd2-4c26b2e21d6b` in production. Prepared Docker root, TLS-verifying start command and batch limit 10, with recovery disabled. No source, deployment, cron, database or PayPal credential reference is attached.
- Automatic approval review rejected giving this new service the Live database and PayPal credential references: general recovery authorization was considered insufficient for this persistent production access grant. No alternate path was attempted. Explicit owner approval is needed to reference the existing Live writer database URL/CA and Live PayPal application credentials, perform a bounded reconciliation-only run and then enable a five-minute schedule. This does not authorize checkout, capture, cancellation, refund or public sales.
- Existing recovery implementation already has limits, five-minute leases, stale-worker fencing and capped retry backoff. Existing passing tests were inspected; unchanged suites were not rerun. No application code changed.

## Recovery activation — owner approval, 19:14 JST

- Owner explicitly approved granting the new Live recovery service existing Live database/PayPal references and enabling reconciliation. The retry was accepted by automatic review.
- Set the eight scoped references to `tech-phase-billing-live` (writer database URL, TLS CA, origin, Live client ID/secret, webhook ID, JPY/USD plans). No service token or database administrator credential was provided.
- Enabled recovery with limit 10 and deployed the already tested source `e7d411fb815cfef734b764488779984fc69d7f7c`, pinned to `codex/research-preview`. First deployment `dacd0ddb-d0da-4fbf-b8f0-258659b4a362` succeeded. At 10:13:53 UTC, `TECH_PHASE_LIVE_RECOVERY` reported completed, checked=0, failed=0, reviewRequired=0, leaseLost=0, bounded=false. This proves the worker's TLS DB connection and empty queue processing, not paid-subscription PayPal reconciliation.
- Set cron `*/5 * * * *`, then applied it through deployment `2626867f-3318-43a1-b3cb-2bd2f7916730` (SUCCESS). At 10:14:49 UTC the same completed/zero-error result was logged.
- First scheduled run observed at 10:15:09 UTC (19:15 JST), completed with checked=0 and failed=0. No manual restart was issued for this run.
- No new checkout, capture, cancellation, refund, or sales/entitlement flag change. The worker uses existing reconciliation code and can update ledger/payment periods only from provider evidence. Its own external missed-run notification is not configured; backup/restore monitoring is separate.

## Validation before source publication (original implementation)

Lint passed (nine existing warnings), 1,633 Node tests and 2,667 Python tests passed; Next build, compileall and diff checks passed. This operational record is documentation only.
