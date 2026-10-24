# Independent existing-object source restore drill

Owner requests an additional real retrieval after the earlier upload/readback.
The new Existing source restore drill workflow retrieves the previously stored
ciphertext, using the receipt's independently pinned commit/tree/size/SHA-256.
It never seals/uploads a new backup, deletes objects or changes live data.

Target: source commit719ec8cd462a82cf8d3a756c4ed69aae5bf2555d, 18155548 bytes,
SHA-256272f094bb33e9f6c1567dbf3160e110b256edeb612d894e41b6162e7302bcbc9.
Same existing bucket and four configured GitHub Secrets. No new user setup.

The read-only runner downloads the entire encrypted object, checks size/hash,
authenticates AES-GCM before parsing, extracts the three allowed package files
in a disposable directory, restores the Git bundle into an empty repository,
and checks the independently pinned commit/tree. It removes temporary plaintext
on completion. Success event: EXISTING_SOURCE_EXTERNAL_RESTORE_OK.

This is a source recovery drill, not an application startup or live database
restore. runtime_restore_verified remains false and promotion is false.
The workflow has no schedule, deployment or notification action; it runs only
on explicit changes to its own workflow or docs/source-restore-request.txt.

Independent real execution SUCCESS (2026-10-23 02:10:57 JST):
- Workflow run39820351545; job119969679972, conclusion success.
- Runner commit83f692e4245189cbc49c62d2b435f06bc792ce91.
- Logged event EXISTING_SOURCE_EXTERNAL_RESTORE_OK.
- Downloaded18155548bytes from the existing object above; SHA-256 matched.
- AES-GCM authentication and isolated Git restore passed.
- Restored commit719ec8cd462a82cf8d3a756c4ed69aae5bf2555d,
  tree483815e71d316d86f18616cd254fb7fdf0a303fb.
- source_restore_verified=true; runtime_restore_verified=false;
  new_upload=false; promotion=false.
- This used the previous upload's existing object in a separate fresh job.
  No new backup was substituted, no existing object overwritten.
- Local gates before publication: Node1328 + Python2585 =3913 passed,
  lint0errors/5existingwarnings, build/compileall/diff-check passed.

Raw success timestamp2026-10-22T17:10:57.1054721Z.
https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39820351545

Source recovery is confirmed; app startup and live DB recovery are not.
The archived revision remains719ec8cd, not later development commits.
No further user action is needed for this drill.
