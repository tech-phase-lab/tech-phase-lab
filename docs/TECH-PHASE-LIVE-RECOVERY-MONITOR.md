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
