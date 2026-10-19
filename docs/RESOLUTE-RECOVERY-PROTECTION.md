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
- Deploy backup code **with protection.py and protection_events.py**, plus Python cryptography; the historical standalone
  function bundle must not deploy backup.py alone. Preserve daily/weekly schedules.
- Verify actual encrypted export and isolated pg_restore using synthetic rows and
  source connections fenced. No production DB overwrite or email.
- Online deletion/stop code is now prepared as described below. Production
  migration, credentials/key custody, and actual API-to-bucket acceptance remain
  gated. A periodic export alone is still insufficient.
- Therefore keep plan/settings APIs, writer logins and mail delivery disabled.
  Do not activate storage on the strength of local replay or backup SUCCESS.
- Before any customer reopening, establish an independently complete checkpoint,
  reconcile provider acceptance for restored mail, verify post-replay data and
  re-establish least-privilege ACLs. This code never re-enables application access.

No payment setting, sales flag, morning cron, confirmation reservation, private
RIZEL publication, frontend design or approved wording is changed by this batch.


## 2026-10-19 — online deletion/stop durability

Migration018 inserts an immutable-identity retry record in the same SQL transaction
as each deletion/explicit OFF journal entry. If insertion fails, the user's change
rolls back. Existing history is backfilled. Application writers can only read the
outbox and update receipts/retry metadata; they cannot change/delete event content.
The dedicated retry role is NOLOGIN and can access only this outbox.

The API commits the user change and retry record, then publishes the minimal event
before returning success. Failure returns the existing generic 503, never a success
claim or an upstream URL. GET and revision-conflict responses also drain outstanding
records before exposing completion. If the DB commits but the process dies, the
outbox survives. A stale retry does not repeat the deletion: it uploads the original
record, then preserves normal revision-conflict behavior.

Immutable object names are HMACs of user/kind/revision. Payloads use AES-256-GCM with
fresh random nonces and the object key as associated data. Only minimal identity,
revision, time and kind are included, never answers, plan content or addresses.
If-None-Match:* prevents replacing an existing event. A lost PUT response is
reconciled by downloading, authenticating and comparing the original event before
acknowledging; DB receipts are ciphertext SHA256 values. Conflicting content fails.
SDK calls have bounded timeouts and no implicit retry; durable retry backoff is
5 seconds up to 15 minutes. Per-request draining is bounded to 16 events. Excess
backlog remains unavailable until drained; it is not ignored.

services/resolute-api/protection-retry.mjs is a separately gated, bounded one-shot
worker. It continues past individual failures and emits aggregate counts only.
No scheduler is connected. The existing 7AM review worker is not used for retries.

All production factory paths require RESOLUTE_PROTECTION_ENABLED=true in addition
to the existing storage flags, a separate 256-bit key, and explicitly scoped S3
configuration. None was installed. Retain the original key separately from the
source DB for recovery; do not rotate/replace it without a reviewed migration.
Application credentials must not delete protection objects or touch dump rotation.
Scoped credential capabilities and custody still need production verification.

Python protection_events.py can authenticate/decrypt Node envelopes, enumerate a
fenced object inventory and seal a readback-verified SHA256-pinned manifest. It
fails on changing inventory, missing/altered objects or malformed records. When
migration018 exists in a restored dump, backup.py requires this independent online
manifest and key; the older maintenance checkpoint cannot silently substitute.
Replay then follows the existing isolated-DB, completeness and outbox rules.
Sealing must occur after independently fencing writers. Never infer a latest or
complete catalog from a stale manifest. Source loss does not authorize reopening
without independently verifying the fence and complete object enumeration.

Object writes follow AWS's documented conditional-write contract:
https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
Railway compatibility is a separate acceptance gate, not assumed from AWS docs.

## Real isolated acceptance evidence

Railway restore deployment594765aa-cc2c-4718-9e77-5b622e8305cd emitted
RESOLUTE_PROTECTION_ACCEPTANCE_OK at2026-10-19T10:33:25.944305424Z.
Three synthetic events (408 encrypted bytes) were stored in a unique acceptance
namespace of the existing private bucket. All three attempted overwrites returned
HTTP412 and the original bytes read back intact. Authenticated decryption and a
sealed manifest passed. A real pg_dump before deletion/OFF was restored into an
independent local PostgreSQL18 database and replayed twice: plan erased, both
channels OFF, pending notification queue zero. No production DB credentials were
present; source_db_connected=false, mail_sent=false. Synthetic encrypted fixtures
are retained in their separate acceptance namespace; the ephemeral key was not
exported. This test does not install production schemas, enable writers, exercise
the real authenticated API, or activate a retry scheduler.

Local integrated checks: Node1128, Python2490, lint zero errors/five existing
warnings, Next build, compileall and diff checks passed. Runtime store tests use
PGlite; Node-to-Python encryption compatibility uses real AES-GCM. The remote
fixture used the migration018 event core before the dormant retry-role grant was
added; the final role grant is covered by local SQL tests, not a production apply.
