# Restore environment isolation — 2026-10-21

## Finding and change

The restore entry point rejected only PGHOST, PGPASSWORD, DATABASE_URL and
ENTITLEMENT_DB_URL, after constructing the object-storage client. Newly introduced
scoped database URLs and libpq service/password-file options were not covered.
There is no evidence that production credentials entered the deployed restore
service: its declared variable names contain none of these connection settings.

Restore now rejects nonempty PG variables (except image metadata PG_MAJOR,
PG_VERSION, PG_SHA256 and PGDATA), *_DB_URL, *DATABASE_URL, DATABASE_* and POSTGRES_*
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

## Deployment preflight correction

The PostgreSQL18 image also supplies PG_SHA256. The image-metadata exception
now includes that checksum; connection variables are still rejected.
The executable entry point now validates restore credentials before either
/start or /fail monitoring requests. Calling main directly was already guarded,
but the previous __main__ wrapper could send /start first. Regression tests
cover blocked entry without any heartbeat and valid execution with preserved
start/failure reporting. No secret values enter the failure message.

The prepared restore-only V4 launcher is intended to preserve the prior V3 variable for rollback,
verifies the three-module payload digest and exact filenames, compiles modules,
and logs the checked source commit/digest. Six local launcher checks verify
byte-for-byte extraction, four rejected modes and checksum failure. They intercept
runpy and do not perform network or database operations.

## Provider deployment blocker — 2026-10-21 20:09 JST

The attempt to create an empty isolated verification service returned
`Deploys have been paused temporarily` (INVALID_ARGUMENT). Subsequent project
inventory contains no resolute-restore-guard-check-20261021 service and no pending
changes. No credential reference, start command, schedule or deployed code was
changed. The prepared candidate module digest is
2f872384be957be82b4537c7e2a6a616a90ac326d1033d41e56f147a3f2fc2ce;
local extraction tests are not runtime acceptance.

Railway's official status at https://status.railway.com/ reports
"Dashboard and API unavailable, builds paused"; October21 09:28UTC update says
new builds remain paused in every region. The separate October20 incident is
resolved and must not be substituted for this current incident. Browser access
also remained on a site-served browser-check screen; no login, challenge bypass,
CLI/network workaround, billing change or repeated deployment was attempted.

Next: after provider recovery, verify service inventory and no pending changes,
pin the final CI-verified source in the three-module V4 bundle, and run a bounded
isolated restore with existing backup/independent-history references only. Do not
pass source DB credentials, a monitor ping URL, cron, public domain or volume.
Require actual bundle digest plus RESOLUTE_RESTORE_OK, then roll the same checked
code into the weekly service with its existing cron and V3 rollback retained.
The old manifest is dated restore evidence, never a fresh activation inventory.
Customer storage stays OFF. No owner re-login, password/key re-entry or Run now
is required for the completed work. Runtime rollout remains incomplete.

Final integrated local gates on b492c1c5: lint0 errors/five existing warnings,
Node1,317/1,317, Python2,554/2,554, build, compileall and diff check passed.
Both company-introduction batches bf31a270 and b492c1c5 are preserved.
