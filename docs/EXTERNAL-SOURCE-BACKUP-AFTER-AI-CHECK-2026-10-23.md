# Actual encrypted source recovery receipt after AI verification

Verified 2026-10-23 16:05:28 JST (07:05:28 UTC).
Run: https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39915525618
Job: 120288127250, completed SUCCESS. Actual log event:

```json
{
  "event": "SOURCE_EXTERNAL_UPLOAD_VERIFIED",
  "key": "tech-phase/source/v1/427c71dd6283717d230e058dec1910be08f88f26/d220bc378c28aa01a4b25593cb7c3bf9e8bd08468fb877c95700a91a705af3ce.aesgcm",
  "sha256": "d220bc378c28aa01a4b25593cb7c3bf9e8bd08468fb877c95700a91a705af3ce",
  "bytes": 19527708,
  "commit": "427c71dd6283717d230e058dec1910be08f88f26",
  "tree": "3cdc0e1856cdc4c69d330601604f84372bb542e7",
  "source_restore_verified": true,
  "external_storage_verified": true,
  "runtime_restore_verified": false
}
```

The source package includes 1,686 tracked files and a names-only inventory of
207 configuration names. It includes the one-attempt AI diagnostic implementation,
its SQL and the observed live success receipt, plus coworkers' intervening changes.
It does not include runtime environment values or the live diagnostic DB record.
Existing bucket resolute-backup-external and configured secrets were reused.
Authenticated encryption precedes upload; complete ciphertext readback, SHA256,
authenticated decryption and isolated Git commit/tree verification all succeeded.
The manifest was published/read back last. Older objects were retained.
This is an upload/readback restore drill, not a separate later retrieval job.

## Remaining recovery boundaries

- Live DB backup freshness after password rotations has not been independently
  inspected in this continuation. Neither a dashboard success badge nor this
  source receipt proves live DB recovery.
- Existing DB backup code uses full-database pg_dump without a table exclusion,
  so a successful future dump should include ai_connection_checks; inclusion in
  an actual new dump and restore is still unverified. Preserve the consumed claim
  across restores; never repeat the single authorized AI call after older restore.
- Before enabling customer saves, maintain a write fence, obtain and independently
  retain a fresh COMPLETE deletion/suppression inventory, require pending queue0,
  verify actual history storage receipts/readback and isolated replay/idempotence.
  Do not reuse initial empty manifests or synthetic events as production inventory.
- Local node_modules tar, Node runtime and Python dependencies are not included
  in this source object; dependency offsite custody remains outstanding.
- No Railway connector calls, cron/reservation edits, email, payment, additional
  model call, runtime promotion or customer-saving flag change was made here.

Only documentation/request files changed; git diff --check passed. The backup
workflow's real recovery checks passed. Application CI39915525738 is separate
and was still running when this receipt was prepared; no new full-suite pass is
claimed. Source-trigger file is unchanged by this receipt to avoid backup loops.
