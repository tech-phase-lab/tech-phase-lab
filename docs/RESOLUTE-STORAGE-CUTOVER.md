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
