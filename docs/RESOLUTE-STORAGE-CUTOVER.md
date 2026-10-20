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

The read path performs GET only. That does not prove provider-enforced read-only
credentials; inspect the actual provider permission boundary separately. The
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
