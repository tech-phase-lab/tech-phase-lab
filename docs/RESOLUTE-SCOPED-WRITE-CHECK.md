# RESOLUTE in-container rollback-only storage check

Prepared 2026-10-20. Run with psql inside the existing Postgres container,
using its existing local authentication. Do not export credentials, change the
Postgres start command, restart the database, enable LOGIN, or run migrations.
No new service receives an administrator connection. No customer-save gate opens.
Use the guarded runner below; it disconnects on SQL error so the transaction
rolls back. A local rehearsal does not constitute production success.

The fixed synthetic identity in the SQL must be absent in all five tables before execution.
All writes use SET LOCAL ROLE and a single rollback-only transaction. No
entitlement is created, no notification delivery table is written, and no
external protection receipt is claimed. The zero receipt is synthetic and is
rolled back. Gateway durability and isolated restore remain separate gates.

The executable SQL is maintained in
`scripts/resolute/check-storage-write.sql`; the guarded runner is
`scripts/resolute/check-storage-write.sh`. Copy both reviewed files into the same
private directory inside the existing Postgres container and execute:

```sh
RESOLUTE_CHECK_STORAGE_WRITE=true sh ./check-storage-write.sh
```

The runner requires the exact Railway project, environment and Postgres service
IDs. It accepts no arguments, uses only `/var/run/postgresql` and the existing
local postgres role, and clears inherited connection/service/options variables.
It never prompts for a password. If local authentication or the socket is
unavailable, it fails; do not add remote credentials or restart the database.
`psql -X --set=ON_ERROR_STOP=1` exits on the first SQL error, disconnecting and
rolling back any open transaction. Success is emitted only after rollback and
an absence check across all five tables. A successful run still does not prove
external durability, recovery or maintained fencing.


Follow-up: independently audit the full effective ACL; establish a fresh complete
write-fenced history inventory; exercise actual HTTPS publish/readback/receipt;
restore into an isolated database and assert deletion/both stops and replay
idempotence. Do not interpret this rollback check as persistent customer saving.

## Execution status — 2026-10-20 16:08 JST

Local PGlite rehearsal of the SQL now in check-storage-write.sql passed twice, returning
RESOLUTE_SCOPED_ROLLBACK_OK / committed_rows0 / activation=false both times.
A third run with a storage role set LOGIN was correctly rejected as
STORAGE_NOT_DORMANT. Initial synthetic plan payload was corrected to satisfy the
existing plans_answers_fx_v1 constraint before these passing runs. This is SQL
mechanism evidence, not production access or authenticated application saving.

Existing resolute-db-provision inspectionc4ce3332-9348-400f-a45a-fd3814b63292
actually logged at07:03:41Z: configured=false, neutralized=true,
usableForResolute=false, networkCalls0, writes0. The old setup DB credential
is absent; no admin credential was installed or copied. Its current code only
reports these booleans and performs no network/database operation.

Railway CLI5.71.0 was installed in /tmp/resolute-railway-cli. The owner completed
the one-click device authorization at approximately16:08 JST. The subsequent
login-process poll was rejected by the execution environment:
Network access to https://backboard.railway.com:443 was blocked by policy.
This is not evidence of bad credentials, and the CLI login completion/SSH
connection has not been verified. Do not request another login or code just to
retry this policy block. Do not tunnel or reroute around the denied endpoint.
The connected Railway app remains available for its supported operations, but
currently exposes no SQL/SSH/remote-exec operation.

Production execution remains pending on an allowed in-container command path.
No source data, customer-save flags, writer logins, schedule, payment, email or AI
setting changed. The owner authorization to perform the scoped rollback-only
check persists; the blocker is execution access, not missing approval.


## 2026-10-20 — Guarded executable and regression coverage

Moved the previously rehearsed SQL unchanged from this document into the reviewed
.sql file, with the separate local-socket-only shell runner. No production DB
connection, role change, service deployment or activation occurred in this step.
The exact runner and SQL are covered by five automated tests:
- Two successful SQL passes leave zero synthetic rows and all writer roles NOLOGIN.
- Revoking notification INSERT causes a failure after plan/deletion writes;
  rollback removes both those writes and their queued protection event.
- LOGIN and a pre-existing probe identity reject; the existing row stays intact.
- The wrong database rejects before touching any application schema.
- The shell gate rejects a wrong project/environment/service or extra arguments,
  strips inherited PG connection variables, selects the local socket only,
  disables password prompts, and propagates a failing psql exit status.

PGlite tests exercise the SQL engine but cannot prove a real psql disconnect;
that test explicitly rolls back its still-open embedded session. The shell test
uses a psql stub to verify invocation/environment/status propagation. Production
socket authentication and the actual disconnect behavior are still unverified.
The test-only migration fixture initially lacked the two dormant writer roles;
that fixture was corrected and the full Node suite then passed1257/1257,
0 failed/skipped/cancelled (73.312s).

Final validation: Node1257 + Python2523 =3780 passing tests. Python used the
pinned-clock npm runner (257.494s); Next.js production build succeeded.
compileall, shell syntax and diff checks passed. SQL relocation was also checked
byte-for-byte against the prior approved document. No production execution is
claimed; saving remains disabled and no schedule or live integration changed.

## 2026-10-20 21:50 JST — real psql disconnect rehearsal passed

Owner explicitly approved transferring only SQL/test code into a temporary
service in the same Railway project after automatic review rejected the first
transfer. The first empty service295a2b56 was deleted and verified absent;
no alternate route was used to bypass the rejection. No production credentials,
customer data, backup keys or application connection URLs were transferred.

Approved service30f9cb1c-bde7-4032-a107-1e4b5aa63dad received only two code
variables CHECK_SCRIPT_B64 and CHECK_FIXTURE_B64. Before image attachment,
readback confirmed exactly these variables, no volume and no cron. It used
postgres:18-bookworm,0.5CPU/0.5GB,NEVER restart and a300-second outer timeout.
The harness initialized a disposable Unix-socket-only cluster (listen_addresses
empty), with synthetic data and the same eight migration fixtures as the
existing PGlite test. The production shell guard was not bypassed or spoofed:
the exact SQL was invoked directly with real psql -XAt --no-password and
ON_ERROR_STOP=1 against that disposable cluster.

Deployment a324bbeb-e4c4-4bab-92c0-f5e2cb706f42 reached SUCCESS. Actual log at
2026-10-20T12:50:48.550404455Z emitted RESOLUTE_REAL_PSQL_ROLLBACK_OK with:
- SQL SHA25614abb5cb35417c878cd666a8393d3e696b862f70d8e650a9a7d26bb7cdcf9f81,
  byte-for-byte equal to scripts/resolute/check-storage-write.sql.
- Two successful passes, each leaving zero probe rows across all five tables.
- A deliberately revoked notification INSERT failed after earlier writes;
  psql exited3, and independent connections found zero probe rows without
  issuing an explicit ROLLBACK to the failed session. Exclusive lock reacquisition
  with a1-second lock timeout succeeded.
- LOGIN role state rejected; pre-existing probe revision9 preserved on collision;
  wrong database rejected; all three scoped roles ended NOLOGIN.
- production_connected=false.

The cluster was stopped in finally and the temporary service deleted after
evidence capture; deletion returned no detached volumes. This replaces only the
earlier simulated-disconnect evidence. It does not verify production socket
authentication, actual production ACLs, the maintained write fence, external
history durability or customer saving. The in-container production execution
path remains unavailable; no repeated login or owner Run now is requested.


## 2026-10-20 18:36 JST — Integrated CI and execution access

GitHub Actions39388517701 completed successfully for e847d03a, which includes
30faefae and the subsequent coworker backup work. The earlier run39387842953
was cancelled by the newer branch push; it is not recorded as passing.

The transient checkout was removed by workspace maintenance and recovered from
GitHub; no user-authored change was lost. The connected Railway app still exposes
no SQL/SSH operation. A standard Railway dashboard path was inspected separately:
the target Postgres page currently shows Login/404 in this browser, so its Data
screen cannot yet be inspected. Existing CLI authorization does not establish a
signed-in dashboard session. No CLI policy-denied endpoint was retried, no admin
credential was transferred, and no production write or save activation occurred.


## 2026-10-20 evening JST — Browser access is not a pending owner task

The owner supplied account settings matching the connected Railway profile and
showing GitHub linked as tech-phase-lab but GitHub login disabled. The earlier
instruction to authenticate through GitHub confused repository integration with
a login method. Do not repeat it or enable/change the integration to work around
it. The owner reported successful email login at20:09 JST. Browser-control calls
and the reset subsequently timed out; the agent has not verified the final
signed-in dashboard or an available SQL interface. This is an execution-access
blocker, not evidence of bad credentials, deleted projects or a completed probe.

The connected app separately confirmed the original radiant-magic project
0872be15-db75-4e5a-ae0f-881911fb442d in workspace わたがし's Projects. Its connection
does not establish the browser's account/session. No logout, account linkage
change, production SQL, save activation or credential transfer was performed
during the browser troubleshooting. Existing approval for the narrowly scoped
in-container rollback check remains valid. Do not retry denied CLI endpoints or
copy Postgres admin credentials into another service.
