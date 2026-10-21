# Restore environment isolation — 2026-10-21

## Finding and change

The restore entry point rejected only PGHOST, PGPASSWORD, DATABASE_URL and
ENTITLEMENT_DB_URL, after constructing the object-storage client. Newly introduced
scoped database URLs and libpq service/password-file options were not covered.
There is no evidence that production credentials entered the deployed restore
service: its declared variable names contain none of these connection settings.

Restore now rejects nonempty PG variables (except image metadata PG_MAJOR,
PG_VERSION and PGDATA), *_DB_URL, *DATABASE_URL, DATABASE_* and POSTGRES_*
before optional client imports, temporary directories or subprocesses. Error text
contains no values. Backup mode retains its required source connection.
Regression tests cover all three scoped URLs, libpq alternate configuration,
PostgreSQL password-file settings, metadata compatibility and unchanged backup mode.

## Observed production evidence

Daily deployment e17289ff-1cf3-41ff-b576-c5a11bc587a8 logged:

- 2026-10-21T00:04:24.461788046Z: RESOLUTE_PROTECTED_BUNDLE_READY,
  source fb7c4eda6b9462931e817a6052ffe8eb086a5911,
  SHA256 8e9cae071117da8b293ea3d6c3c529b29b6ef8a7b57e3cabadecd82330590063.
- 2026-10-21T00:04:24.461791686Z: RESOLUTE_BACKUP_OK, encrypted bytes84963,
  dump bytes84747, retained8, duration1.832 seconds. The success path uploads,
  downloads and compares the encrypted object checksum before reporting success.

This proves the scheduled backup ran with that bundle, not the new guard above.
Weekly deployment 3d4ebec2-ed49-4ad8-ac9e-0eba9d261d02 is SUCCESS, but no new
weekly execution was observed after its creation2026-10-20T14:53:53.815Z.
The earlier service log at04:51:43Z used c792d51d and is not new-bundle evidence.
The separately verified nonempty isolated restore is documented in
[the cutover evidence](RESOLUTE-NONEMPTY-CUTOVER-CHECK.md).

## Scope and remaining work

This source change has not been rolled into the pinned Railway job bundle.
No deployment, schedule, credential, saving flag or Vercel setting was changed.
Daily cron remains0 0 * * *; weekly cron remains0 0 * * 1 (UTC).
Storage remains OFF. Before activation, collect a new complete inventory while
writes are fenced; neither the old empty inventory nor the dated three-event
manifest is a new activation check. Live owner/browser acceptance remains pending
while Vercel is paused. Do not repeat completed password, key or login steps.

## Verification

Integrated coworker commit60163ee4206365c841b0a36f9e86765cd0948249 without
overwriting its billing changes. Final local gates passed: lint0 errors (five
existing warnings), Node1,317/1,317 with test-concurrency2, Python2,552/2,552,
production build, compileall and diff check. Focused restore tests8/8 passed.
These are code verification results, not a production restore execution.
