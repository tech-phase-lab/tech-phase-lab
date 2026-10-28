# Tech Phase PRO Live encrypted backup

Separate deployment from `tech-phase-backup` (Sandbox). No serving-database
restore operation exists. Source is fixed to `tech_phase_billing_live`, schema
of the same name, and SELECT-only login `tech_phase_billing_live_backup`.
Includes seven tables including `recovery_queue`, functions, triggers and the
entitlement view. Reader identity/privileges and schema inventory are checked
before pg_dump. TLS uses verify-full with the Postgres root CA.

Archive uses AES-256-GCM, random nonce and object-path associated data. Only
ciphertext and a checksum/size pointer are uploaded. Readback and decryption
must match before latest is updated. Retention: seven distinct days and four
ISO weeks, exclusively under `tech-phase/live/v1/`; Sandbox keys are untouched.
Maximum unencrypted archive 64 MiB. Snapshots can lose up to 24 hours of data.

Required variables (no values in source/logs):
- TECH_PHASE_PAYPAL_ENV=live
- TECH_PHASE_LIVE_BACKUP_ENABLED=true
- TECH_PHASE_LIVE_BACKUP_BRANCH=codex/research-preview
- RAILWAY_GIT_BRANCH must match (provided by Railway)
- TECH_PHASE_LIVE_BACKUP_MODE=backup or restore-check
- TECH_PHASE_LIVE_BACKUP_KEY_HEX: independent 32-byte random hex key
- TECH_PHASE_LIVE_BACKUP_ENDPOINT, BUCKET, REGION, ACCESS_KEY_ID, SECRET_ACCESS_KEY
- Backup only: TECH_PHASE_LIVE_BACKUP_DB_PASSWORD (64 hex), TECH_PHASE_LIVE_BACKUP_DB_CA (PEM)
- Optional: TECH_PHASE_LIVE_BACKUP_MONITOR_PING_URL (independent Healthchecks URL)

Use the dedicated existing PRO object store with separate Live prefix and key,
or a separate bucket. Never use RESOLUTE credentials. A shared object-store
credential means bucket-wide permissions: prefix isolation in code does not
replace storage IAM. Keep a copy of the Live encryption key and storage recovery
credentials outside Railway, under operator control. Railway-managed storage
alone does not prove recovery from loss of the Railway account.

One-shot reader provisioning: run `/opt/backup/bin/python /app/provision.py` in
an isolated service with TECH_PHASE_LIVE_BACKUP_PROVISION=true, branch guard,
Live reader password/CA, and TECH_PHASE_LIVE_BACKUP_ADMIN_PASSWORD. Refuses an
existing role rather than rotating it. SQL receives a SCRAM verifier, not the
plaintext password. It grants only CONNECT/USAGE/SELECT and future SELECT for
current table owners. Remove this temporary service and its administrative
reference immediately after success. No existing table or role is changed.

Backup job: daily `30 0 * * *` UTC (09:30 JST). Restore job: weekly `0 1 * * 1`
UTC (Monday 10:00 JST). Both restart NEVER. Restore job must have no source DB,
PayPal or service-token credentials; clear image metadata PG_MAJOR, PG_VERSION,
PGDATA to empty strings. It decrypts into a temporary directory and restores
into disposable PostgreSQL 18 with TCP disabled, then checks table inventory,
payment/period consistency and the entitlement view in both directions.

A successful deployment is not proof of a completed backup. Require
TECH_PHASE_LIVE_BACKUP_OK and TECH_PHASE_RESTORE_CHECK_OK (promotion=false)
from finite runs. Empty-ledger restore does not prove paid-member recovery.
Production restoration requires a separate reconciliation of cancellations,
refunds, disputes and deletions before entitlements or recovery workers run.
The restored recovery queue can contain stale leases; do not run it blindly.

External failure/missed-run monitoring and operator key custody must be verified
separately. No new email/notification recipient is configured by this code.
