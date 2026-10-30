# Live payment reconciliation monitoring

The finite `live-recovery-entry.mjs` job runs every five minutes, with batches of ten.
`TECH_PHASE_BILLING_LIVE_RECOVERY_MONITOR_PING_URL` is an optional, dedicated
Healthchecks HTTPS UUID URL, stored only in Railway variables. Do not share a
heartbeat with backup, restore, Sandbox or RESOLUTE.

Healthchecks: `Tech Phase PRO Live payment reconciliation`, UTC cron
`*/5 * * * *`, grace ten minutes, existing operator email (down only).
The entry point sends empty POSTs for start, success, or failure. No member data,
payment data, tokens, exception messages or logs are transmitted. Redirects are
rejected and each request times out after ten seconds. Disabled or mismatched
deployments do not refresh the heartbeat. Partial processing failures, interrupted
runs and database cleanup failures send failure. A monitor outage does not prevent
reconciliation or cleanup, but makes the process exit unsuccessfully.

This is job availability monitoring, not evidence of real payment acceptance or
an alert for every individual review-required subscription. Bounded successful
batches remain successful; queue capacity must be assessed as membership grows.
Purchase, renewal, refund and dispute acceptance are separate checks. No checkout,
capture, cancellation, refund or public sales are enabled by monitoring.

Validate a deployment using the `TECH_PHASE_LIVE_RECOVERY` completed result,
`TECH_PHASE_LIVE_RECOVERY_MONITOR` sent/sent, and the corresponding check's
received start and success. Cron deployment success alone does not prove a run.

## Verified 2026-10-28, 19:30 JST

- Source `f76cec90d984575a0cda1588efad2513bec4aaae`; deployment
  `22f66077-eac4-4856-a07c-ac697005c946` SUCCESS, no staged changes.
- Scheduled run at 10:30:36 UTC: completed, checked=0, failed=0,
  reviewRequired=0, leaseLost=0; monitor_start=sent, monitor_finish=sent.
- Healthchecks visibly green, received signal and duration 0.29 seconds.
  Existing operator email assigned; ten checks in the twenty-check capacity.
- No real paid-subscription reconciliation or new failure-email delivery test.
- Validation: lint zero errors/nine existing warnings, Node 1,638 passed,
  Python 2,667 passed, Next build passed, compileall/diff checks passed.
- Live purchase acceptance remains pending. The current sales switch opens
  checkout to all authenticated members, not a single test account. Before
  enabling it, obtain approval for that scope and the real JPY 2,980 charge;
  the owner performs PayPal approval. Do not treat a mock or empty-queue run
  as evidence of payment, PRO activation, cancellation or refund acceptance.
