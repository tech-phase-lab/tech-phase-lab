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

Production runtime acceptance completed on 2026-10-21; see the dated evidence
below. The three scoped roles now LOGIN. Customer saving remains OFF.

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
and diff check also passed. Production evidence is recorded separately below.

The current API Docker image does not bundle these operator scripts. For a later
operator run, transfer the reviewed checker and storage-permissions.mjs into the
existing container with their repository-relative layout and verify file digests
before invocation. Reuse the installed pg module and database-config.ts. Do not
change the API start command or import the checker into normal request handling.

## Production evidence — 2026-10-21 16:00 JST

The owner completed dedicated password entry, API password-variable entry and
initial deployment44ec2037-c2ea-455f-94c7-14736a510d8e. Do not repeat these steps.
Exactly the three existing scoped roles were enabled for LOGIN; no additional
grants were added. The reviewed checker files from7ab9e72e were digest-verified
inside the existing API container. All three actual password-authenticated
connections passed session identity and full ACL checks at06:56:19–26Z.

The three RESOLUTE_{PLAN,NOTIFICATION,PROTECTION}_DB_URL variables now reference
existing same-service password variables, scoped users and private host
postgres.railway.internal:5432/resolute. Secret values were not printed/exported.
Deployment46d3e773-eacc-4f51-8c83-e69e7431a065 reached SUCCESS and emitted
RESOLUTE_API_READY at06:57:25.349Z. Source remains pinned to7875e998.

Using the actual deployed URL variables, all three checks passed again:
plan06:58:25.779Z, notification06:58:29.341Z, protection06:58:33.274Z.
Each result reported persistentUrl/storageOff/readOnly=true, rolesVerified=3,
rawPaymentAccess/deliveryAccess/recoveryFenceVerified/activation=false.
The URL passwords matched the corresponding existing password variables in memory.
The final marker was RESOLUTE_PERSISTENT_CONNECTIONS_VERIFIED.
All four API storage/protection/retry flags remain explicitly false.

Post-check DB inspection at06:59:11.784Z found scoped connections0,
plan_deletions0, notification_settings0 and protection_outbox0.
Actual API HTTP reads returned healthz200 and unauthenticated plan/notification401.
These are health/authentication-boundary checks, not authenticated save acceptance.

Remaining: normal authenticated save/delete/notification-route acceptance,
durable receipts/retry acceptance and a freshly collected complete write-fenced
restore inventory before customer-save activation. The prior three-event manifest
is dated evidence only and must not be reused as a new activation inventory.
Writer remains disabled. No scheduler, Vercel, billing, mail or AI operation changed.
