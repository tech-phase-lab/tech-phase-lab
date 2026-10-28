# External source recovery evidence — 2026-10-23 JST

Actual R2 upload, full readback and isolated decrypted source restore succeeded.
This supersedes the previous source-upload pending status, not DB readiness.

- Repository: tech-phase-lab/tech-phase-lab; branch: codex/research-preview
- Backed-up commit: 719ec8cd462a82cf8d3a756c4ed69aae5bf2555d
- Restored tree: 483815e71d316d86f18616cd254fb7fdf0a303fb
- Files in committed source: 1650; configuration names only: 207
- R2 bucket: resolute-backup-external
- Cipher bytes: 18155548
- SHA-256: 272f094bb33e9f6c1567dbf3160e110b256edeb612d894e41b6162e7302bcbc9
- Object: tech-phase/source/v1/719ec8cd462a82cf8d3a756c4ed69aae5bf2555d/272f094bb33e9f6c1567dbf3160e110b256edeb612d894e41b6162e7302bcbc9.aesgcm
- Non-secret manifest: same object key plus .json
- Workflow run: 39815593175; successful retry job: 119961269313
- Log timestamp: 2026-10-22T16:54:26.3370580Z (2026-10-23 01:54:26 JST)
- Event: SOURCE_EXTERNAL_UPLOAD_VERIFIED
- source_restore_verified=true; external_storage_verified=true
- runtime_restore_verified=false

## Verified operation

Owner reported four GitHub Secrets registered. The assistant re-ran only the
failed backup job. Secret presence passed, and the code sealed locally before
conditional upload. It downloaded all ciphertext, compared size/hash, verified
AES-GCM authentication, restored the bundle in an empty repository and compared
commit/tree. Only then did it upload/read back the manifest. The logged event,
not merely workflow success, is the evidence. No production key values read.

## Security scope and limitations

- Source/package content is encrypted. The small JSON manifest is plaintext
  metadata (commit/tree/hash/size/format), not a database or secret export.
- No actual .env file or private-key filename was found in reachable history.
  .env.example secret fields were blank or explicit placeholders (a token-limit
  field was numeric configuration). Source configuration inventory contains
  names only. Known private-key/OpenAI/GitHub/AWS token signatures had zero hits
  across 8577 reachable blobs; this is bounded screening, not proof that every
  conceivable credential format can be detected.
- Two historical fixture-never-opened.sqlite blobs were checked read-only: all
  tables had zero rows. They are test fixtures in source history, not live DB
  snapshots. Their bytes remain inside the encrypted bundle.
- R2 token was originally created with the existing bucket scope. Successful
  upload/readback does not independently prove denial on every other bucket;
  no attempt was made to access other buckets or widen permissions.
- The external key is held in GitHub Secrets outside Railway. Independent
  owner custody was instructed before registration; never regenerate existing
  RESOLUTE recovery keys or request plaintext credentials in chat.

## Remaining

Live research SQLite, RESOLUTE PostgreSQL and current deletion/suppression
history are not included. Railway-dependent acquisition and fresh write-fenced
recovery inventory remain pending. Clerk/PayPal/provider settings and external
assets are not covered by source recovery. No scheduled backup was enabled.

This receipt itself is newer than the archived source commit. Do not call an
older source archive the latest commit after later documentation/code changes.

Run: https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39815593175
