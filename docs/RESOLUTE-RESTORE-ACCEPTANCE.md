# Isolated restore acceptance — 2026-10-19

The strengthened harness from commit2ce61a69 passed against real PostgreSQL18 and
Railway object storage with synthetic data. This is not authenticated customer
API acceptance or production key custody. Customer saving remains disabled.

## Actual result

Deployment0d2e0a94-3696-4e5d-8353-8bb68a8872da reached SUCCESS and logged
RESOLUTE_PROTECTION_ACCEPTANCE_OK at2026-10-19T14:47:05.014635889Z.
The restored stale dump was checked BEFORE replay: original plan present at
revision1, both notification choices ON, one pending notification. The first
replay erased the plan, set both choices OFF at revision2 and removed the pending
queue. The second replay independently passed the same assertions.

Three synthetic events occupied408 encrypted bytes. All three conditional
replacement attempts were rejected. The complete isolated event inventory was
sealed, read back and authenticated before real pg_restore and both replays.
No source DB connection, email, payment or AI call occurred. Exact structured
results are in RESOLUTE-RESTORE-ACCEPTANCE-2026-10-19.json.

## Isolation and reproducibility

- Project0872be15-db75-4e5a-ae0f-881911fb442d,
  environment3a80776d-15a3-4ca1-bd0c-e0c915ccf73b.
- New dedicated service058b8f14-3cb5-45d8-a3f8-c73dc55adaec,
  resolute-restore-acceptance. No public domain, TCP proxy, volume or cron;
  restart NEVER, memory0.5GB, CPU0.5. Existing writer probe remains unchanged.
- Image docker.io/library/postgres:18-bookworm. Install python3, python3-boto3
  and python3-cryptography. Use a non-login shell and explicitly export
  PATH=/usr/lib/postgresql/18/bin:$PATH before launching Python.
- Package exactly backup.py, protection.py, protection_events.py and
  protection_acceptance.py from2ce61a69 as a JSON filename-to-source mapping
  (sort_keys=True, separators=(',',':')), gzip/base64 in
  RESOLUTE_ACCEPTANCE_BUNDLE_B64. Verify SHA256 of the decompressed JSON:
  299112d7d5ed839eafcddbc60216acf80e7eda9fa107f56b4ec8f7b617568867.
  Check the exact filename set, compile each source and execute from a temporary
  directory. RESOLUTE_ACCEPTANCE_MIGRATIONS_B64 is base64 JSON of full migrations
  001,002,003,004,005,017,018 in that order. Migration019 is NOT covered here.
- Remove only image metadata PG_MAJOR, PG_VERSION, PG_SHA256 and PGDATA from the
  launcher environment before the guard. Do not remove database connection,
  service or password variables to get past the guard. It rejects inherited
  connection settings before clients or processes start. All SQL targets a fresh
  Unix-socket-only local cluster in the disposable container.
- Supply the dedicated resolute-protection bucket references only on this
  recovery-test service, never on the customer API. The harness writes only a
  fresh UUID acceptance namespace; it does not delete objects. Its fresh32-byte
  key exists only in process memory. No production recovery key was generated.
  This exercises the recovery operator's bucket access, not the narrow writer
  gateway or provider-enforced retention.
- Require RESOLUTE_PROTECTION_ACCEPTANCE_ONLY=true. The launcher exits with
  RESOLUTE_RESTORE_ACCEPTANCE_DISABLED before installing packages or opening a
  DB when this flag is false. This disabled path was checked locally and remotely.

## Failed attempts and correction

Initial deploymente112ceea and diagnostic deployment69505fd6 crashed before
PostgreSQL initialization completed. Secret-free traceback frames located the
failure at main:62 (initdb via runuser). The login-shell launch did not preserve
the PostgreSQL executable path. Changing only the launcher to a non-login shell
with explicit PostgreSQL18 PATH fixed the run. The same bundle SHA and assertions
were retained; failed attempts are not counted as successful tests.

## Retirement and remaining work

The test flag was set false and all five BACKUP_* bucket references set empty on
this service. These staged writes were acknowledged and committed; OAuth does
not disclose variable values for independent readback. Retirement deployment
a2305d23-8790-4b48-b437-e65acf70c328 reached SUCCESS and logged
RESOLUTE_RESTORE_ACCEPTANCE_DISABLED at2026-10-19T14:48:56.418078027Z.
No staged changes remain. Old deployment snapshots must never be reactivated for
customer traffic. Synthetic encrypted objects remain; the ephemeral key is gone.

Morning service93dc0258, daily backupa36d180a, weekly restore1c8654a4 and API5e22dac8
retain their deployment IDs and schedules. October20 morning actual execution
and saved-result verification are still pending. No confirmation reservation was
changed. GitHub CI39268699563 passed both jobs for the harness commit.

Remaining: independently stored/retrievable production recovery key, exact
production DB permissions/schema gates, and authenticated API mutation through
the narrow writer to isolated restore. This direct-SQL synthetic run does not
close those gates and does not enable saving, sales or notifications.
