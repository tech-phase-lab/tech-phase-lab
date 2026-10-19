# RESOLUTE recovery protection — preparation, not activated

## Implemented boundaries

Migration 017 records every explicitly OFF channel in the same transaction as
notification settings. The scoped settings writer cannot edit the journal. A
journal insert failure rolls back the settings change. Existing plan deletion
journaling remains unchanged. Migration 017 has NOT been applied to Railway.

`scripts/resolute/protection.py` exports only user IDs, revisions, timestamps and
stop kinds, encrypted with age, into `resolute/protection/v1/` in the existing
private backup bucket. This namespace is outside dump rotation. The ciphertext
SHA256 is the immutable lookup key; upload must pass exact readback verification.
There is no plaintext manifest or mutable latest pointer. No new bucket or paid
service is provisioned. Actual age/Bucket readback has not yet been exercised.

The explicit backup mode `protection-export` requires the dedicated source DB,
both plan/settings roles NOLOGIN and no other source connections. Export locks
the four application/journal tables during one consistent SQL export. It makes
no role changes itself. An active application cannot use this maintenance mode.
The returned digest is meaningful only while the write fence is maintained.

Restore detects plans/settings in the dump independently of environment flags.
Their presence requires `RESOLUTE_PROTECTION_CHECKPOINT_SHA256` from the separate
write-fenced export; a dump's own journal, timestamp or latest pointer is never
accepted as proof of a complete independent history. Missing, malformed,
corrupted, undecryptable or incomplete-schema inputs fail the restore. Setting
`RESOLUTE_REQUIRE_PROTECTION=true` also requires the protection for empty/schema
acceptance runs. No `RESOLUTE_RESTORE_OK` can be emitted after a protection error.

Replay runs in `resolute_restore_test` only, in one transaction. It clears old
plans/answers/fx and restores missing tombstones without reducing revisions.
Recreated plans newer than the deletion survive. Notification channel stops are
compared against the original restored revision, together, so an alerts stop
cannot be skipped merely because a morning stop raised the revision first.
Explicit newer re-consent survives. Missing settings are recreated OFF.
Independent journals are merged back so future exports retain their history.
Unaccepted restored notification outbox rows are cleared, never blindly resent.
The restore function is not a production database cutover tool.

## Outstanding activation gates (must not be inferred complete)

- Apply application migrations 002–005 and 017 with reviewed scoped permissions.
- Deploy backup code **with its sibling protection.py**; the historical standalone
  function bundle must not deploy backup.py alone. Preserve daily/weekly schedules.
- Verify actual encrypted export and isolated pg_restore using synthetic rows and
  source connections fenced. No production DB overwrite or email.
- Online deletion/stop completion still needs independent durable per-mutation
  publication, failure/retry handling and a verified latest-head protocol. A
  periodic export alone loses acknowledged changes after the last export. This
  maintenance checkpoint deliberately does NOT solve or claim online durability.
- Therefore keep plan/settings APIs, writer logins and mail delivery disabled.
  Do not activate storage on the strength of local replay or backup SUCCESS.
- Before any customer reopening, establish an independently complete checkpoint,
  reconcile provider acceptance for restored mail, verify post-replay data and
  re-establish least-privilege ACLs. This code never re-enables application access.

No payment setting, sales flag, morning cron, confirmation reservation, private
RIZEL publication, frontend design or approved wording is changed by this batch.
