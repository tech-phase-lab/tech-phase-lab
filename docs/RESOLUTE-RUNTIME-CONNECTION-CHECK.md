# Read-only scoped runtime connection acceptance

Customer saving stays disabled. This check never provisions a role, changes a
password, creates grants, publishes history or writes application rows.

The existing preparation/readiness audit still requires all three roles NOLOGIN
by default. The new check requires an explicit exact list of expected LOGIN roles
and verifies the same table/column/schema/function/role-membership permissions.
An unexpected LOGIN role is a failure, just like a missing required LOGIN role.
It checks both session_user and current_user: SET ROLE under an administrator
must not be reported as a successful scoped runtime connection.

Run only after the dedicated scoped credentials have been provisioned through an
approved operator path, in the existing service that owns that connection. Never
copy the source DB administrator URL into a helper. Provide:

- RESOLUTE_CHECK_STORAGE_RUNTIME=true
- RESOLUTE_STORAGE_CHECK_DB_URL: the intended existing scoped connection
- RESOLUTE_STORAGE_EXPECTED_LOGIN_ROLES: exact JSON list of provisioned storage roles

The host must be postgres.railway.internal and the database must be resolute.
The user must be resolute_plan_writer, resolute_notification_writer or
resolute_protection_writer; administrator and unrelated roles are rejected before
connecting. Values are never printed. CLI failure output is a fixed error event.
All catalog queries execute in a bounded read-only transaction and ROLLBACK on
success or failure. Connection termination runs in finally.

A successful RESOLUTE_STORAGE_RUNTIME_VERIFIED is only identity/ACL evidence.
It is not ordinary authenticated route acceptance, a maintained write fence,
a complete fresh restore inventory, storage durability or permission to activate.
The prior nonempty-manifest evidence remains dated; acquire a fresh write-fenced
manifest before any future customer-save activation.

Production execution is pending: the three production storage roles remain
NOLOGIN, and no customer-save flag or credential was changed for this work.

## Validation boundary

The regression fixture uses isolated PGlite PostgreSQL sessions, not production
credentials. It covers exact expected LOGIN sets, preserved default NOLOGIN
rejection, administrator SET ROLE rejection and column-only payment access leaks.
Separate fixtures are used because the observed PGlite RESET SESSION AUTHORIZATION
does not restore its initial session identity. This local session simulation is
not proof that a real password or production network connection works.

Use the existing API service for a later runtime check; do not attach credentials
to a newly created helper. Keep PLAN_API, NOTIFICATION_API, PROTECTION and
PROTECTION_RETRY disabled while collecting scoped connection evidence. A later
activation must separately address durable receipt retries and complete fresh
recovery inventory. No cron is added by this checker.

## 2026-10-21 local continuation

Prior production synthetic-storage/recovery commit c5eb09e8 passed GitHub Actions
39446888627: both preview verification and PostgreSQL payment concurrency jobs
completed successfully. This is CI evidence for that commit, not activation.
New runtime audit focused cases passed; full Node suite1,296/1,296 passed with
concurrency2. Python2,549/2,549, lint0errors/5existing warnings, production build, compileall
and diff check also passed. No production connection check has run.

The current API Docker image does not bundle these operator scripts. For a later
operator run, transfer the reviewed checker and storage-permissions.mjs into the
existing container with their repository-relative layout and verify file digests
before invocation. Reuse the installed pg module and database-config.ts. Do not
change the API start command or import the checker into normal request handling.
