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

Initial local read-only-storage tests passed, including wrong key, wrong size,
wrong tree and separate opt-in gate. Actual independent R2 execution is pending
until the implementation is published and its execution log is reviewed.
