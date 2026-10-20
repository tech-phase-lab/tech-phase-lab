# Controlled nonempty history acceptance

This is a test procedure, not customer-save activation. Use the existing writer
container with its current key and bucket; no production DB/admin URL is copied.
`protection-maintenance.mjs` stays inert unless the explicit maintenance gate is
true, requires exact Railway service/project/environment and WRITER_ENABLED=false,
and requires a future deadline no more than15 minutes away.

Before launch, inspect current API save/retry gates and missing storage DB URLs,
all3 NOLOGIN roles/no active scoped sessions and source histories/outbox. Hold a
bounded transaction with SHARE ROW EXCLUSIVE locks on plans, plan_deletions,
notification_settings, notification_suppressions and protection_outbox throughout
publication/sealing. Record the backend PID and confirm locks remain held before
and after the API probe. This lock is independent of the publisher service.
Do not infer a maintained fence from old NOLOGIN/config observations alone.

The maintenance writer obtains a fresh fully paginated inventory, insists it is
empty for this first acceptance, authenticates every object, checks stable repeated
listing, writes a canonical manifest and reads it back. The digest may equal the
old empty digest because contents are equal; the new listing/lock observations
are required and must be recorded. Never simply reuse the old pin as evidence.

The public server accepts only three exact events for one synthetic acceptance ID:
delete revision1, alerts_off revision2, morning_off revision3 at one fixed time.
All other identities, timestamps and revisions are rejected before storage.
Serialized conditional puts prevent sealing races. After the third distinct put,
the gate closes before the final complete inventory/readback/seal. GET/retry can
reconcile stored receipts but no later PUT reaches the bucket. The deadline closes
all connections and releases its client even if the operator disconnects.
A receipt alone never proves the final seal succeeded: require both event sets and
final seal log, retain the new pin outside the source DB, and retire the publisher.

Then restore the real encrypted backup into a disposable socket-only cluster with
no source DB credentials. `nonempty_restore_acceptance.py` wraps the unchanged
backup/restore modules: after pg_restore it inserts only stale synthetic rows into
the disposable DB, proves they are present, requires the exact independent3-event
ledger and checks deletion/both notification stops/pending queue clearance. Replay
runs twice and full synthetic row snapshots must match. The real backup is not
modified and no entitlement, mail, payment or AI operation is invoked.

Update independent scheduled restore/backup pins only after the complete seal,
without editing schedules. Restore the original writer start and disabled flag;
verify actual DISABLED log and removal of the temporary listening deployment.
Release DB locks after publication stops. Retain immutable synthetic objects and
their pin as evidence; do not purge them as cleanup. Customer saving stays OFF.

## Validation status

Actual bounded synthetic HTTPS publication and isolated nonempty restore passed
on2026-10-20 (runtime evidence below). Customer saving is still disabled. The Node npm script now
places --test-concurrency=2 before test filenames: trailing npm arguments did not
apply the limit on the observed Node runtime. Existing tests are not removed or
skipped. See the dated handoff for final gate results.

## 2026-10-20 execution evidence (in progress)

- API runtime14:47:39.746Z: RESOLUTE_RUNTIME_DORMANT, four gates OFF,
  three storage DB URLs absent. No credentials were exported. An initial
  shell double-quote check hit bash history expansion before Node execution;
  the quoted heredoc check above succeeded without configuration changes.
- Existing production Postgres socket:14:47:56.78961Z, backend45509,
  RESOLUTE_MAINTENANCE_FENCE with5 granted ShareRowExclusiveLocks.
  Exact three roles NOLOGIN/minimum privilege/no sessions; source histories and
  outbox empty; synthetic ID absent. No source rows were inserted/updated.
  Fence SQL SHA256 edf3d2f320af824907bc86db7a6cd011affa44652f3137dcd5e599c78a5143cd.
- Synthetic ID user_acceptance13b58a5c3660c48ad34ffd4fc7e48088;
  event time2026-10-20T14:48:39.059Z; deadline15:00:39.060Z.
  Writer source remains4b3bdd8e with exact tested maintenance script SHA256
  0e96a46a84c3c3d5f990918576b28ead8b594c7bab249817c7c04993ca8664dd.
  Deployment97cf7786-f0c8-44d8-829f-881b96902cd2 requested; no success inferred.
- Other contributors' de5ea3c9 and2c056205 updates preserved. Latest integrated
  Node suite passed1,294/1,294; remaining integrated gates are still running.
- Actual writer97cf7786 SUCCESS and FRESH_BASELINE_SEALED at14:50:34.879Z:
  complete0-object inventory, readback pin
  3ccbe11b60a4fa4f0d024f7c22cba06b70ca3ff7d9eead4c8a3a5aa4ca8d2b73.
  This is a new write-fenced observation, not reuse of the bootstrap check.
- Same backend45509 still held5 locks at14:50:58.174892Z and14:52:12.973286Z.
- API actual HTTPS publication/readback/retry checks passed14:51:45.398Z,
  RESOLUTE_LIVE_SYNTHETIC_PUBLISH_OK, exit0, dbWrites0, customerSaving=false.
  Three receipt digests match the complete independent manifest sealed
  14:51:44.997Z. New pin:
  72f819a298d8f5365f0fcb404c80ea3fd48e1b5139ffebbd9830cdad92bace75.
  Exact names/digests retained in resolute-nonempty-manifest-20261020.json.
  Synthetic immutable history is retained; it is not real customer history.
- Original writer start restored; both gates false. Deployment9135f83b-eaa1-4356-ad23-6d7b63b9d225
  SUCCESS with actual RESOLUTE_WRITER_DISABLED at14:53:56.909Z;
  temporary listener97cf7786 verified REMOVED. New pin retained in temporary
  restore and existing daily/weekly services; schedules untouched.
- Production source histories/outbox all0 at14:55:06.069206Z; transaction
  ROLLBACK, same backend locks0 at14:55:10.101100Z. Customer DB rows unchanged.
- Initial isolated restore62954a5e stopped at environment guard (RuntimeError).
  PostgreSQL image metadata must be removed before that strict guard, as already
  documented in RESOLUTE-RESTORE-ACCEPTANCE.md. An intermediate diagnostics command
  had a shell/Python quoting SyntaxError before restore. Corrected start removes
  ONLY PG_MAJOR, PG_VERSION, PG_SHA256 and PGDATA; connection/password variables
  remain subject to the unchanged rejection guard. No source DB access occurred.
- Final integrated tree based on2c056205: Node1,294 and Python2,549 all passed;
  lint0errors/5existing warnings, build, compileall and diff check passed.

- Corrected isolated deployment24c62f31-2ac7-4a6a-9718-04fb7e174cbd SUCCESS,
 14:56:55.385Z: bundle357a32b46dc6ce0af4e92615fc7408dec549189f252880a792f3e85d02a40b5e
 verified; RESOLUTE_RESTORE_OK on actual84,933-byte encrypted backup,2probe rows,
 independent_online_manifest deletion1/suppression2. Live payment ledger0 and
 existing sandbox integrity verified read-only; no payment operation invoked.
 RESOLUTE_NONEMPTY_RESTORE_OK: stale fixture existed only in isolated restoredDB,
 plan erased, both notifications OFF, pending0,2idempotent replay checks,
 production_db_connected=false,mail_sent=false,monitor_ping_sent=false.
- Temporary service3ce4cc9d deletion request was cancelled after an expired
 confirmation form. Readback15:12Z confirms it still exists, no cron/domain/volume,
 NEVER restart. Do not report cleanup complete or ask the owner to repeat login.
- New pin deployments: daily e17289ff-1cf3-41ff-b576-c5a11bc587a8 and weekly
 3d4ebec2-ed49-4ad8-ac9e-0eba9d261d02 SUCCESS. Crons remain0 0 * * * and
 0 0 * * 1. Deployment readiness is not a new scheduled-run success claim.

Remaining before customer saving: dedicated runtime login provisioning/least-right
connections and ordinary authenticated route acceptance, then a newly maintained
write fence and fresh full manifest immediately before activation. Do not use
this dated3-object manifest as timeless activation evidence. No customer activation,
role LOGIN change, key regeneration, owner login or Run now is requested.

- Cleanup fallback15:14:19.347Z: existing temporary service redeployed as inert
 printf-only command, deployment3c240915-d571-4666-967c-2b0ce03c80b5 SUCCESS,
 actual RESOLUTE_NONEMPTY_ACCEPTANCE_RETIRED. Six credential/recovery-key
 references replaced by literal disabled values. No network/DB operation remains
 in its start command. Service deletion remains pending; this is retirement,
 not deletion. No cron/domain/volume was introduced.
