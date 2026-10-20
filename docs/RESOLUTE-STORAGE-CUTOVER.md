# RESOLUTE storage cutover — prepared, not activated

## Evidence as of 2026-10-20

Owner production custody/readback passed at13:13 JST; see KEY-ESCROW record.
Live Clerk -> isolated real PostgreSQL/API/encrypted store -> stale restore and
both replays passed with synthetic data earlier. Neither installs production keys.

A subsequent read-only Railway inspection found no staged changes on the API,
backup or restore service. API remains pinned bb45d9d0, deployment
5e22dac8-cf4c-42d4-a545-20a1e374a169 SLEEPING, without plan/settings/protection
configuration names. Backup04440b43 uses the older single-module job variable;
restorec0eec3c0 uses RESOLUTE_PROTECTED_JOB_B64 with the three-module launcher.
Backup deploymenta36d180a and restore deployment1c8654a4 report SUCCESS; this is
configuration evidence, not a new successful backup/restore execution.
Existing schedules remain daily0 0 * * * and weekly0 0 * * 1 (UTC).

## Correct the independent-store read path before schema installation

Previously backup.py loaded online protection manifests using the DB dump S3
client and bucket. The isolated writer uses a separate bucket, so that would not
read the intended independent history. The revised online restore path requires
its own configuration and never falls back to dump credentials on missing
configuration, missing objects, checksum failure or authentication failure.

Restore-service-only configuration:

| Name | Source/purpose |
| --- | --- |
| RESOLUTE_RESTORE_PROTECTION_ENDPOINT | HTTPS endpoint of the independent history bucket |
| RESOLUTE_RESTORE_PROTECTION_BUCKET | Independent history bucket, not the dump bucket |
| RESOLUTE_RESTORE_PROTECTION_REGION | Region for that bucket |
| RESOLUTE_RESTORE_PROTECTION_ACCESS_KEY_ID | Dedicated recovery access; do not put in the application |
| RESOLUTE_RESTORE_PROTECTION_SECRET_ACCESS_KEY | Matching recovery credential; never log |
| RESOLUTE_PROTECTION_KEY_HEX | Online protection key recovered on the owner's device, not the private age identity |
| RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256 | Independently retained pin of a complete write-fenced inventory |

The live-store restore path now requires GET plus LIST of the protection-event
prefix. It compares the pinned manifest with the complete inventory and checks
the inventory again after authenticated reads; missing LIST permission fails
closed. This supersedes the original GET-only runtime behavior. These read
operations do not prove provider-enforced read-only credentials; inspect the
actual provider permission boundary separately. The
existing BACKUP_* settings still read/decrypt the DB dump and the legacy offline
checkpoint. Google recovery identity must never be installed into application
services. The previously verified owner key must not be regenerated for convenience.

## Ordered cutover work

1. Keep plan/settings writes, retry worker and mail delivery disabled. Obtain
   a current DB catalog audit: required migrations, NOLOGIN role attributes,
   effective table/column rights and absence of active writer sessions. A previous
   config snapshot or NOLOGIN alone is not an effective write fence.
2. Prepare the intended production history namespace and recovery credentials.
   Install the online key through a private owner-controlled channel only after
   the concrete destination is ready. No chat upload of the Google identity/key.
3. Package backup.py, protection.py and protection_events.py together, check the
   module bundle digest/compilation, and prepare restore-only independent settings.
   Do not replace the daily single-file payload with backup.py alone: imports
   require its siblings. Preserve both existing cron schedules.
4. Establish a complete fenced manifest using protection_events.seal_manifest;
   retain its checksum outside the DB dump and read back/authenticate its objects.
   Confirm the source outbox has no unacknowledged protection events. An empty
   initial manifest is valid only with independent evidence that no history exists.
   Do not substitute a timestamp, latest pointer or old test namespace for this.
5. Only with that recovery path ready, apply the reviewed schema sequence and run
   the transactional provision-storage-permissions.mjs audit (019 must not run
   standalone). Keep all three roles NOLOGIN. Include002–005/016–018 dependencies;
   inspect migration history rather than blindly rerunning production SQL.
6. Run an actual backup and isolated restore with the intended recovery path;
   inspect runtime logs AND restored assertions. Confirm plan deletion, both
   notification stops, empty pending queue, and repeated replay. Previously
   completed synthetic acceptance is evidence for the mechanism, not this cutover.
7. Review final activation separately. Do not enable customer saves on deployment
   SUCCESS alone. On failure retain disabled writers and original recovery inputs;
   do not drop tables, reset credentials or regenerate keys as a rollback shortcut.

No production mutation or deployment was performed for this repair. The new
connection path has local synthetic cryptographic coverage; actual provider reads
with production credentials and the production migration remain unverified.

Local three-module packaging was also exercised without secrets or deployment:
canonical JSON SHA256
0d3c10c14440ede9be4bc862a90fcd991c2d59a2386f7bf9034d9fd01215424d,
gzip/base6412980 bytes, all three modules compiled, decompressed mapping exactly
matched source. This checks the payload, not the currently deployed launcher or
an actual Railway execution. Regenerate from the final reviewed source if changed.

Final integrated local validation on base86a329d4: Node1207/1207, Python2520/2520 (278.110s), lint0 errors/5 existing warnings, Next build, compileall and diff check passed. No production deployment or new live recovery pass is claimed.


## 2026-10-20 13:26–13:29 JST — Restore V2 deployed, execution still unverified

Installed the c792d51d three-module bundle in restore-check service
c0eec3c0-cdd2-47da-bd48-fef21e30934b as new
RESOLUTE_PROTECTED_JOB_V2_B64; retained both older job variables. Changed only
startCommand to select V2, then redeployed3aaa54dc-91e4-40db-8547-7f19fc77a99a.
The launcher requires restore mode, verifies bundle digest and exact module set,
compiles/extracts the three files, runs backup.py and removes the temporary files.
Local extraction/source equality/cleanup checks passed. Bundle SHA256 remains
0d3c10c14440ede9be4bc862a90fcd991c2d59a2386f7bf9034d9fd01215424d;
launcher SHA256 df78d35f2309dab2161f82c8145ae9c0a59f16e99c41957825d876f24e8f382f.

Readback: deployment SUCCESS, state cronReady, no staged changes, domains or
volumes; weekly cron remains0 0 * * 1. No runtime result was returned by bounded
log reads, including an explicit time window. One restart also left cronReady
with no execution result. Therefore neither an actual restore nor online-history
provider reads are claimed successful. Do not repeat deploy/restart to substitute
for a cron run. Official Railway docs distinguish railway cron run from redeploy;
the installed remote connector does not expose cron run, and this workspace has
no Railway CLI or token authentication. A dashboard manual Run or an authorized
browser fallback is still needed; never alter the schedule to force a run.

Morning service006aea7e was read back unchanged: pin20a3069e, deploymentb43e335e,
cron0 22 * * 0-4, no staged changes. No customer-save flag, production key,
DB schema/privilege, mail, payment, AI invocation or reservation changed.
GitHub CI39369328863: payment concurrency passed; main validation still running
at this observation. Do not report overall CI success yet.


## 2026-10-20 13:47–13:49 JST — Actual old-version restore passed; V2 redeployed

Owner clicked Run now. Deployment3aaa54dc's actual04:47:38Z structured logs
show RESOLUTE_RESTORE_OK:69247 encrypted bytes, probe_rows2, Sandbox
orders11/grants7/events8/audit32/alert_outbox7, live ledger verified with all
five counts0. Download/decryption/checksums/pg_restore/probe/PK/both payment
integrity checks passed in2.355s; monitor_ping_sent=true. Cron execution status
succeeded, no running replica afterward. data_protection=not_installed is
expected while application storage schemas are absent, not a protection pass.

Crucially, the same execution logged bundle commitdb418e7 and digest
aab5c9ca86efbf2bc1af5ca7cd6d25c783aee9a9cbc0499b41c4ae555bc3c151.
Thus the earlier c792 V2 deployment claim established configuration only:
redeploy reused the old execution configuration despite describe-service showing
the V2 start command. The actual run is NOT evidence of executing c792d51d.

Corrective operation: added a fixed c792d51d/bundle-digest marker to the V2
launcher, then set RESOLUTE_PROTECTED_JOB_V2_B64 with skipDeploys=false so a
fresh deployment is generated from current settings. New deployment
c6ef3efc-604c-4133-8a4d-91c319f5b0f0 reached SUCCESS at13:49 JST with V2 start
command and unchanged weekly cron; no staged changes. New launcher digest
259c9cadbb0811358ac9bee290bf32bf48a9c76cdf9af65e887cc0eb64224672.
Old variables retained. A fresh manual Run now is still required; verify the
c792d51d marker AND RESOLUTE_RESTORE_OK before accepting this deployment.
No runtime success for c6ef3efc is claimed yet. No production storage/key/DB
activation, schedule modification, mail, payment or AI call occurred.

GitHub CI39369328863 for c792d51d is now completed/success. Local3727 tests,
lint/build/compileall passed as previously recorded. Owner custody stays complete;
no need to repeat Google/Evernote setup or regenerate keys.


## 2026-10-20 13:54 JST observation — V2 actual restore verified

Owner reported pressing Run now; subsequent inspection found the completed V2
execution at13:51:43 JST (log time, not inferred from the report time).
Deploymentc6ef3efc-604c-4133-8a4d-91c319f5b0f0 logged both:
- RESOLUTE_PROTECTED_BUNDLE_READY: commitc792d51d06437a27748f03ee2714a8c23ce7409e,
  digest0d3c10c14440ede9be4bc862a90fcd991c2d59a2386f7bf9034d9fd01215424d,
  modules3, timestamp2026-10-20T04:51:43.084940930Z.
- RESOLUTE_RESTORE_OK at04:51:43.084946050Z:69247 encrypted bytes, probe_rows2,
  Sandbox orders11/grants7/events8/audit32/alert_outbox7; live ledger verified
  with all five counts0; download/decrypt/checksums/pg_restore/probe/primary-key/
  both payment-integrity assertions passed,2.67s, monitor_ping_sent=true.

Environment status confirms cronSucceeded, lastExecutionStatus=succeeded,
lastExecutionAt04:51:41.853Z, running replicas0, no pending work or recent
failures. This closes the pending V2 execution gate and the stale-build confusion.
Do not ask for another Run now or repeat owner key custody verification.

The result data_protection.state=not_installed correctly reflects the existing
backup without application storage schemas. This is NOT an actual production
online-history replay acceptance. Production protection key and independent
store connection provisioning, fenced complete manifest and schema/ACL cutover
remain pending; customer saving stays off. The successful synthetic live-Clerk
replay remains separate evidence. Existing daily/weekly/morning schedules and
reservations were not modified. The apt-utils debconf notice did not prevent
the verified execution. Main, billing, live payments, email and AI were untouched.

## 2026-10-20 14:03 JST — Production store preparation and read-only preflight

Created a separate production-history bucket resolute-protection-live
(ae4437b5-24f9-43dd-9fe0-475676821f1b, sjc;
S3 name resolute-protection-live-vpdsti). Existing synthetic protection objects
remain in resolute-protection, unchanged. Backup bucket remains separate.
No provider object lock/versioning/non-delete credential guarantee is claimed.

Prepared five bucket-variable references on the disabled protection writer
(RESOLUTE_WRITER_*), and five RESOLUTE_RESTORE_PROTECTION_* references on
restore-check. Both used skipDeploys=true: stored configuration is ready, but
these connections are NOT claimed loaded by the existing runtime. Writer
ENABLED=false; no production key/token installed and no customer-save activation.

Reused the retired protection-acceptance one-shot function for a bounded
read-only preflight, with the existing API reader URL and temporary new-bucket
references. No admin DB credentials used. Deployment
53810a91-3d09-41f8-ba79-e1b243e47dc5 actually logged
RESOLUTE_STORAGE_PREFLIGHT_OK at2026-10-20T05:02:14.561884781Z:
current database/role/transaction checked as resolute/resolute_api_reader/read-only;
plans, notification_settings and protection_outbox absent; both pre-existing
plan/notification roles NOLOGIN and without elevated role attributes;
all three writer identities had0 pg_stat_activity sessions; whole bucket
ListObjectsV2(MaxKeys=1) returned no objects and no truncation. Writes0.
This is a point-in-time observation, NOT a durable write fence, ACL audit,
complete recovery manifest, production-key replay, or customer-saving acceptance.

After inspection, replaced the function with an idle no-I/O body and blanked
all six temporary DB/storage references. Final deployment
94c52848-29b6-452d-b7af-80a5df086f9c actually logged
RESOLUTE_STORAGE_PREFLIGHT_IDLE, reads0/writes0 at05:02:50.103278093Z.
No cron or public domain added. Previous synthetic acceptance remains historical.

Remaining owner-only prerequisite: install the ALREADY GENERATED 32-byte online
protection key into the disabled writer's RESOLUTE_WRITER_KEY_HEX using the
owner's PC and Railway's private Variables UI. Do not install the AGE-SECRET-KEY
recovery identity, regenerate custody material, upload any secret to chat, or
repeat Google/Evernote verification. The assistant cannot retrieve the PC-only
key. Keep ENABLED=false. Downstream key references, token provisioning, manifest
fencing and migrations/ACLs must be completed before explicit save activation.
Morning/daily/weekly schedules, main, live payments, mail and AI untouched.

## 2026-10-20 14:11–14:18 JST — Owner key installed; runtime checks and migration rehearsal

Owner reported completing the private WSL-to-Railway copy into the disabled
writer's RESOLUTE_WRITER_KEY_HEX. No key/age identity was read into chat.
Actual deployment87a06fc6-695f-41b9-aafb-f03e5dd943f8 logged
RESOLUTE_PRODUCTION_KEY_RUNTIME_OK at05:12:11.000843832Z:64-hex key loaded,
AES-GCM memory round trip passed, writerDisabled=true, DB/storage writes0.
Non-secret fingerprint697d2470b736420ac32ff258e9c17f7939b82da4cfa0a44f75856ee72e395de6.
This runtime fingerprint was not independently compared by the assistant with
Google's notes; owner-side copy command checked the previously verified pins.
Writer deploymentef0a1382-2304-409c-807f-d1399b376136 actually logged
RESOLUTE_WRITER_DISABLED at05:12:24.998591597Z. Module-type warning is nonfatal.

Initialized the empty production manifest only while the writer was disabled,
application storage tables absent, both existing writer roles NOLOGIN and with
no elevated attributes, and writer sessions0. These catalog checks ran before
and after the bounded S3 operation. Whole bucket inventory allowed only the
expected manifest on retry, no event/other objects. Conditional PUT prevented
replacement; exact GET readback and post-inventory passed. This operational
bootstrap fence relies on absent application schemas and stopped known writers;
it is not provider object lock or a reusable concurrent-live-write fence.
Canonical bytes match protection_events.seal_manifest empty serialization:
{"objects":[],"version":1}
SHA2563ccbe11b60a4fa4f0d024f7c22cba06b70ca3ff7d9eead4c8a3a5aa4ca8d2b73.
Deployment6b51220a-25e4-4d12-a307-63ba7bdf61ea logged
RESOLUTE_INITIAL_MANIFEST_OK at05:13:36.817215270Z, events0, bootstrapOnly=true.
The pin is retained here outside the DB dump.

Restore key now references the writer's online key; restore manifest pin is set.
A GET-only probe using references THROUGH restore-check configuration matched
the writer fingerprint and authenticated the pinned manifest bytes:
deploymentd0d59a1a-b313-4144-9b75-6110f52e6f3f logged
RESOLUTE_RESTORE_CONNECTION_OK at05:15:17.208177859Z; writes0/events0.
This checks rendered restore credentials, key equality and manifest readback.
It is NOT a new Python pg_restore run or a non-empty production-event replay.
Existing successful V2 full restore remains the earlier13:51 execution.
Forced a fresh restore configuration deployment using
RESOLUTE_STORAGE_CONFIG_REV=20261020-production-bootstrap-v1; cron unchanged.
Check the latest deployment/runtime before claiming this configuration executed.

Rehearsed002–005/017–019 plus the existing verifyStoragePermissions catalog audit
in one real production DB transaction, with advisory lock, bounded statement/
lock/idle timeouts and mandatory ROLLBACK (no COMMIT). Existing016 prerequisites
were retained. Initial attempt764675f7 stopped before DB connection because the
retired SETUP URL was blank; no SQL ran. Corrected using a temporary Postgres URL
reference constrained to the internal host and /resolute, with redacted errors.
Deploymentb83651af-7455-4eba-8575-81f443b10fed logged
RESOLUTE_STORAGE_MIGRATION_REHEARSAL_OK at05:16:05.054196096Z:
migrations7, rolesVerified3, loginsEnabled=false, rawPaymentAccess=false,
deliveryAccess=false, rolledBack=true, persistedChanges0, activation=false.
Post-rollback checks confirmed new storage tables and third writer role absent.
This validates the migration sequence against the actual existing catalog;
production schemas/ACLs are NOT installed.

Cleanup verified by real idle logs:
- probe c9c6a6e0-9617-49b4-8b1c-d1b54360c966 at05:16:11.933550092Z;
  all nine temporary DB/key/storage/pin/flag references blanked.
- provision6ad4a6c6-4a49-4cd8-8e2a-33b90289d47f at05:16:58.784232949Z;
  temporary admin URL blanked. Both read/write counts0, no scheduled work.

Next: package daily backup dependencies, finish controlled schema/ACL cutover and
actual post-cutover backup/restore acceptance. BEFORE any customer-save/writer
activation, replace or invalidate this EMPTY BOOTSTRAP pin and establish the
fresh, complete write-fenced manifest procedure; never retain an empty pin as
evidence of complete history after writes begin. Customer saving, retry/delivery,
live payments and AI remain off. No morning/daily/weekly cron or reservations
changed. No further owner key/custody step needed for this milestone.

Restore configuration deployment2322edf1-fc79-498b-b1f2-69a1f570d349 reached SUCCESS at14:18 JST observation, cron0 0 * * 1 unchanged, no staged changes. No new cron execution claimed.

## 2026-10-20 14:20–14:29 JST — Storage schema committed and real post-cutover restore passed

Updated daily backup04440b43 to the same checked c792d51d three-module bundle;
backup-only launcher SHA256ad00b01f3c3d4726d37f01a9b3fdefb94f0691db75820e8f9316a76bf41b3640.
All three embedded modules exactly matched checked repository sources and compiled.
New variable RESOLUTE_PROTECTED_JOB_V2_B64; old job retained. Added cryptography
package to startup dependencies. Daily cron0 0 * * * unchanged.
Configuration deployment93fa80cb-a1c2-4e26-8e14-38f90b6a9f7c SUCCESS.
Actual one-shot execution of the SAME daily payload used temporary service
db300300-b491-44d5-b34a-a0f770626096 (no cron/domain/volume,0.5CPU/0.5GB,NEVER):
pre-cutover deployment7bea8912-9b95-48d7-ae4d-57951b564d9a logged
RESOLUTE_BACKUP_OK at05:22:22.983922558Z,69247 encrypted bytes/69031 dump bytes,
retained8,1.635s. Monitor ping deliberately disabled in test jobs.

Retained a checksum-verified pre-schema dump outside normal daily retention:
resolute/cutover/20261020-pre-storage/20261020T052217058456Z.dump.age
(and .json metadata), SHA256035439b63a197690678885c9eae774df231cc0516c67805ecda31c5e80ee77d0.
Same-day regular backup retention keeps the latest daily dump, so this separate
copy is intentional. Deployment1807047f-c783-4dad-b1e0-9370eaf054e8 logged
RESOLUTE_PRE_CUTOVER_BACKUP_RETAINED at05:23:13.832065823Z after exact readback.

Applied the previously rehearsed002–005/017–019 sequence atomically, with the
same catalog audit before COMMIT, then a second audit after COMMIT. Existing016
was NOT rerun. Scope internal Postgres/resolute only; guarded by absent storage
tables, dormant existing roles, no writer sessions, disabled writer flag and
expected bootstrap pin; bounded lock/statement/idle timeouts and advisory lock.
Deployment726fe709-5fbd-4d19-a760-a7e26c3cd1b7 logged
RESOLUTE_STORAGE_SCHEMA_PREPARED at05:23:55.607325433Z:
migrations7,rolesVerified3,loginsEnabled=false,rawPaymentAccess=false,
deliveryAccess=false,committed=true,activation=false;
plans/settings/protection/delivery counts all0.
This supersedes earlier statements that the schemas and permissions were absent.
No writer login, API save capability, retry worker or notification delivery enabled.

Post-schema actual backup63acb54a-bd7e-462f-a087-20fc0e1a24ea passed
at05:24:52.991172122Z:84933 encrypted bytes/84717 dump bytes,retained8,1.338s.
Both actual backup runs logged the expected c792d51d bundle marker and SHA256
0d3c10c14440ede9be4bc862a90fcd991c2d59a2386f7bf9034d9fd01215424d.

Two attempts to reuse that source-backup service for restore stopped SAFELY
before restore at backup.py:229: production connection variables remained nonempty.
Deployment591e01ad failed; diagnostic8ff18ffb identified the guard without exposing
values, arguments, stderr or row data. A no-I/O shell check36ee6dfd confirmed
PGHOST and PGPASSWORD were nonempty despite the prior empty-string updates.
Do NOT infer that set_variables(value="") removes/neutralizes a reference.
Earlier "blanked" claims mean an update was requested, not verified credential
retirement. Never bypass the restore guard or silently pop production variables.

Created a separate restore-only temporary service
be5c0abe-3fe8-4991-ac27-bcbc1426a953, which NEVER received production DB credentials;
no cron/domain/volume, same limits/restart policy. Uses the unmodified verified
restore launcher and references restore-check's backup key/storage/online key/pin.
RESOLUTE_REQUIRE_PROTECTION=true and RESOLUTE_REQUIRE_LIVE_LEDGER=true.
Deploymentc9a74bcd-6f47-4fb1-be76-36ab483a93da actually logged RESOLUTE_RESTORE_OK
at05:28:53.932496508Z:84933 bytes,probe_rows2, Sandbox orders11/grants7/events8/
audit32/alert_outbox7, live ledger verified with all five counts0;
data_protection={state:verified,source:independent_online_manifest,deletions:0,
suppressions:0}; download/decrypt/checksums/pg_restore/probe/PK/both payment
integrities passed,5.727s,monitor_ping_sent=false.
This is a REAL post-schema restore and independent-manifest replay of the empty
production baseline. It is not a non-empty customer-deletion event acceptance.
Earlier non-empty isolated replay acceptance remains separate evidence.
Weekly restore also now explicitly requires protection; schedule unchanged.

Cleanup correction: temporary function references are replaced with literal
DISABLED (not empty), followed by runtime checks allowing only absent/DISABLED.
Provisionc988eb2e-16de-4e36-a13c-2f181b05f7e3 logged temporaryReferencesNeutralized
true,checked3,reads0/writes0 at05:28:54.264126221Z.
The storage probe checks14 temporary backup/DB/key/pin/flag references similarly.
Temporary backup/restore-only service retirement is recorded below after completion.

Remaining activation gates: latest complete manifest must be rebuilt under a
real write fence after any writes; the empty BOOTSTRAP pin must never be reused
as evidence for future history. Configure/verify isolated writer token, receipt
retry and final API/save activation separately. No user action needed for this
cutover milestone. No morning schedule/reservation, UI/RIZEL visibility, main,
live payment, email, billing setting or additional AI call changed.

Final cleanup/readback14:33 JST: both temporary services db300300 and be5c0abe
were deleted from this environment; no attached volumes. Environment inventory
confirms they are absent and has no staged patch. Exact pre/post/restore results
above were recorded before deletion. Existing helper functions remain idle.
Storage probe730b8062-4fad-4a43-a33d-b74f03c55a0b actually logged
RESOLUTE_STORAGE_PREFLIGHT_IDLE at05:32:38.761696263Z with
 temporaryReferencesNeutralized=true,checked14,reads0,writes0.
An earlier cleanup deployment4e623bb3 exposed only Starting Container; it was
not counted as verification. A new non-secret revision variable forced a fresh
execution, and its explicit runtime check supplied the evidence.
Weekly restore configea3e6818-0d75-47bf-a570-b13ff8d1af62 SUCCESS, protection
required, weekly cron unchanged; its scheduled execution is not claimed.
Morning b43e335e/cron0 22 * * 0-4, API5e22dac8 sleeping, writer ef0a1382
unchanged. Daily cron0 0 * * * and weekly0 0 * * 1 both unchanged.
This turn changed infrastructure and operation records only; no application code
or dependencies changed. Prior checked code reused; diff check passed. Coworker
commit2a78993d fast-forwarded and preserved without editing its PRO/UI work.

## 2026-10-20 — Restore freshness and retry queue hardening

The production restore entry point now requires a complete event-prefix LIST
before reading the pinned manifest's events and another LIST after authenticated
reads. The manifest's event names must exactly equal the inventory and the
inventory (including size/ETag) must stay unchanged. An authentic old empty
bootstrap manifest therefore fails once any event appears. Missing LIST access
also fails closed; the application/writer permissions are not broadened.
GET-only load_manifest remains available for already-isolated pinned inputs,
but backup.load_online_protection always requests the complete inventory check.
This does NOT replace fencing all writers before real recovery or sealing a new
manifest. An event can arrive after the final observation unless writes are stopped.
No user-save activation is authorized by these checks alone.

Retry batches now report whole-queue pending and dueRemaining event counts,
including users outside the per-batch limit and delayed backoff entries. CLI
completion exits nonzero while pending remains, even if every selected user
succeeded. Counts are not user identifiers. No scheduler/login/retry service was
activated. A real SQL fixture covers a successful limited batch followed by a
delayed-only queue. Cryptographic tests cover stale empty manifests, inventory
changes during reading, complete replay and unavailable LIST permission.

Validation and deployment evidence follow below when completed.

Full gates: Node1236/Python2523 passed (3759 total), lint0 errors/5 existing warnings, build/compileall/diff check passed. Stale generated build cache was preserved outside the repository and build repeated successfully. Runtime verification follows separately.


## 2026-10-20 14:53 JST — complete inventory runtime accepted

Code commit fafde179fec86ae861469591e0c2839b64b92e4e rejects incomplete or
changing live protection inventories and reports whole retry queue backlog.
Three-module bundle SHA256:
730cf53f6408a171539a4a899d1dc092941acb5fa44f018ce9e338550af032de.

Fresh restore-only service4e993fbe-e5d6-49a8-93ab-e805282f740c was never given
production DB connection variables. Deploymentf70b1204-0a1e-40ac-a61a-e8925fd8092f
logged the matching RESOLUTE_PROTECTED_BUNDLE_READY and RESOLUTE_RESTORE_OK at
2026-10-20T05:51:24.351987561Z. Encrypted bytes84933, probe_rows2; Sandbox
orders11/grants7/events8/audit32/alert_outbox7; live ledger verified with all five
counts0; data_protection verified, source independent_online_manifest,
deletions0/suppressions0; download/decrypt/checksums/pg_restore/probe/primary-key/
Sandbox/live payment integrity passed,2.591s,monitor_ping_sent=false.
This proves the stricter GET+LIST runtime works against the actual empty baseline;
it does not claim nonempty production deletion acceptance. Writers still must
be fenced and the complete manifest resealed before recovery after writes begin.

Daily backup deployment89161667-8504-498e-b417-b00f8af18a7c and weekly restore
f0f20b52-cc18-4367-b127-b910bf280533 now select RESOLUTE_PROTECTED_JOB_V3_B64.
Previous V2 payloads retained for rollback. Both config deployments SUCCESS;
this is not evidence of a scheduled V3 execution. Daily0 0 * * *,weekly0 0 * * 1,
morning0 22 * * 0-4 unchanged. Morning service not modified.
The fresh verification service was deleted after evidence capture; no volumes.
Customer saving, role logins, writer and retry scheduling remain disabled.
No payments, email, AI calls, key regeneration or owner Run now required.

Local code gates passed3759 tests (Node1236/Python2523),lint/build/compileall.
CI39376987144 was cancelled by the next branch push, not reported as passed.
Coworker af8af671/d10c04f8 changes fast-forward integrated; final combined gates
and successor CI are being verified separately.

Final combined d10c04f8 gates: Node1237/Python2523 (3760 total) passed;
lint0 errors/5 existing warnings, build, compileall and diff check passed.
Deployed three-module payload verified byte-for-byte against integrated source.


## Dormant storage readiness command — 2026-10-20

`scripts/resolute/check-storage-readiness.mjs` performs no I/O by default.
Explicit RESOLUTE_CHECK_STORAGE_READINESS=true and a reviewed
RESOLUTE_SETUP_DB_URL scoped to postgres.railway.internal/resolute are required.
Use an operator connection with catalog visibility; never install this credential
into the application or retry service. Do not put a connection URL on a command line.
The command opens BEGIN READ ONLY, audits the three dormant role ACLs, counts
existing scoped-role sessions and all unpublished protection records (including
future retry backoff), then ROLLBACKs. It returns only counts/booleans. Nonzero
sessions or pending records make the CLI fail; query/ACL errors are redacted.
NOLOGIN alone does not end old sessions. This command neither terminates them nor
publishes queued events, changes grants, enables saving or sends notifications.

`dormantChecksPassed` is only a point-in-time preflight. It does not fence
privileged writers, infrastructure or object storage and deliberately always
reports recoveryFenceVerified=false and activation=false. Continue to require
an actual maintained write fence and complete independently pinned manifest.
PGlite regression verifies a delayed pending receipt remains unchanged, a
simulated pre-existing role session prevents readiness, and ACL failure closes
the read-only transaction. Real production execution is recorded separately.

Previous integrated CI39377657564 (d10c04f8, including fafde179 recovery fix)
completed successfully; the documentation-only fb27c783 did not replace that
code validation with a new code tree.


2026-10-20 15:11 JST actual read-only production readiness passed:
deployment445bb4fa-51ce-44c5-9185-2e431986d0f3 logged
RESOLUTE_STORAGE_READINESS at2026-10-20T06:11:34.131154785Z.
rolesVerified3,loginsEnabled=false,rawPaymentAccess=false,deliveryAccess=false,
activeScopedSessions0,pendingProtection0,dueProtection0,dormantChecksPassed=true.
recoveryFenceVerified=false and activation=false intentionally remain explicit.
The dedicated one-shot service8ab66cf5-afab-4c09-bf65-61c16d707f85 used the
reviewed read-only transaction and the source ACL audit, with no public domain,
cron or volume. It was deleted after the evidence was captured. No application
credentials, role attributes, stored customer data or existing schedules changed.

Deployed one-file Bun source SHA256:
b0ef14068bc866a92912f9207cb3708616f43d3f8a5f032890066d383fd33bcd.
It concatenates the unchanged ACL auditor and new readiness command, pins
pg8.23.1 and substitutes only the script entry point/imports.

Validation note: overlapping local gates exhausted container memory. Two lint
attempts exited137 and an initial Node run lost two test-file processes while
the cgroup OOM-kill counter increased. They are not passing evidence. Build
passed; standalone lint subsequently passed with0 errors/5 existing warnings.
Complete Node rerun and the original Python suite results follow.

Final readiness gates: Node1239/1239 (89.614s), Python2523/2523
(376.676s), total3762 passed. Lint0 errors/5 existing warnings; build,
compileall and diff check passed. Node rerun completed with no additional
OOM kills (counter stayed9). No test skipped or removed.

Coworker accf4368 arrived during publication; ref update did not overwrite it.
Integrated PRO checkout changes and repeated all gates: Node1245/Python2523
(total3768) passed, lint0 errors/5 existing warnings, build/compileall/diff check
passed. Sequential heavy gates avoided further OOM kills.
