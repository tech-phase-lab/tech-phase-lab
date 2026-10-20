# PRO Sandbox backup and restore drill

This service handles only `tech_phase_billing_sandbox`. It does not import,
configure, or run any RESOLUTE component. No HTTP listener or persistent volume.

`backup` uses a dedicated SELECT-only PostgreSQL login and `pg_dump` 18 custom
format. The six ledger tables, constraints, indexes and entitlement view are
included in one consistent database snapshot. AES-256-GCM encrypts the archive
with a random nonce and the exact object path as authenticated associated data.
Only encrypted archives and a non-PII pointer enter a dedicated PRO bucket.
Readback, digest and authenticated decryption must pass before updating latest.
Retention keeps seven distinct daily snapshots and four distinct ISO weeks.
Archives larger than 64 MiB fail pending an explicit capacity review.

`restore-check` downloads the latest snapshot (maximum age 48 hours), verifies
and decrypts it, starts a disposable PostgreSQL 18 cluster on a Unix socket with
TCP disabled, and runs `pg_restore --single-transaction --exit-on-error`.
It checks schema inventory, payment amounts and paid timestamps, and compares
the restored entitlement view against the ledger including both refund holds
and adverse-transaction tombstones. Only aggregate counts appear in logs.
Source DB and PayPal credentials are forbidden in this container.

Required common variables:

- `TECH_PHASE_BACKUP_ENABLED=true`
- `TECH_PHASE_BACKUP_BRANCH=codex/research-preview`
- `TECH_PHASE_PAYPAL_ENV=sandbox`
- `TECH_PHASE_BACKUP_MODE=backup` or `restore-check`
- `TECH_PHASE_BACKUP_KEY_HEX`: independently generated PRO-only 32-byte key
- `TECH_PHASE_BACKUP_ENDPOINT`, `BUCKET`, `REGION`, `ACCESS_KEY_ID`,
  `SECRET_ACCESS_KEY` (each prefixed `TECH_PHASE_BACKUP_`)

Backup only: `TECH_PHASE_BACKUP_DB_PASSWORD` for
`tech_phase_billing_sandbox_backup`, at the fixed private PostgreSQL endpoint.
The role needs CONNECT on the PRO database, USAGE on its schema, SELECT on its
tables and default SELECT privileges for future tables owned by the PRO owner.
It must have no write, ownership, CREATE, role membership or superuser privileges.

Run daily backup and a separate weekly restore check. Do not share RESOLUTE
storage or encryption keys. No automatic retries or external/public database
connection is needed. The job exit status and safe event identify failures.

## Limits before production

This is a restore **drill**, never restoration into the serving database. A
snapshot can predate cancellation/refund/dispute or deletion. Do not promote it
or re-enable access until those changes have been independently reconciled.
No command here restores into the source database or writes Clerk metadata.
The shared cluster roles/passwords are intentionally not in the archive and
must be re-provisioned with the documented minimum privileges after a disaster.

The PRO encryption key and bucket access require separately controlled offline
custody before claiming recovery from loss of the Railway account/project.
Platform-local key references alone do not satisfy that launch gate. The bucket
credential may permit writes in the restore container even though the drill code
only reads; use scoped read-only credentials where the storage provider supports
them. Daily backup implies up to one day's data loss without a separate journal.
External missed-job alerts and production recovery acceptance remain launch gates.

## PostgreSQL image metadata in restore jobs

For `restore-check`, override image defaults `PG_MAJOR`, `PG_VERSION` and `PGDATA`
with empty strings. The fail-closed guard forbids nonempty `PG*` variables; these
image metadata/default-directory settings are not source connection credentials,
but are still rejected. PostgreSQL tools use the image PATH and explicit `-D`
cluster directory, so the drill does not need these defaults. Do not clear or
hide a real source credential to pass the guard; it must never be configured in
the restore service in the first place.

The deployed Sandbox jobs are scheduled for daily 09:30 JST backup and Monday
10:00 JST restore-check. An observed MCP `redeploy` path selected Railpack despite
Dockerfile configuration; existing successful Docker deployments remain active.
Use `restart_service` on their explicit IDs for a finite Run Now, and verify the
safe job event, not just a Railway SUCCESS label. For releases, review and deploy
the pinned source commit and verify Docker build selection before execution.
