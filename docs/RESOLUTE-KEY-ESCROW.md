# Offline protection-key escrow

`protection_keys.py` prepares an age-encrypted recovery capsule for the existing
32-byte online protection key. It does not generate a production key, contact
storage, enable writes, or change services. Requires the `age` executable.

## Operator procedure

1. Use a restricted operator machine and private directory. Provision the recovery
   age identity separately from the application and database backup. Never place
   that identity in application variables or this repository.
2. Feed the existing lowercase 64-hex protection key through stdin to
   `python3 scripts/resolute/protection_keys.py seal --recipient <public-age-recipient>
   --identity <private-identity-file> --output <new-capsule.age>`.
   Do not put the key in shell arguments/history or diagnostic logs. The tool
   encrypts in memory, decrypts using the supplied identity and compares the key
   before creating the capsule. No plaintext temporary key file is created.
3. Retain the encrypted capsule in independent recovery custody and retain its
   returned `capsuleSha256` and `keyFingerprint` in a separately protected operator
   record. These hashes are integrity pins, not the encryption key. A successful
   local seal is not evidence of remote custody or deletion-resistant storage.
4. After retrieving the capsule from its actual custody location, use
   `python3 scripts/resolute/protection_keys.py recover --capsule <download.age>
   --capsule-sha256 <independent-pin> --key-fingerprint <independent-fingerprint>
   --identity <private-identity-file> --output <new-private-key-file>`.
   This checks both pins and age authentication before writing. Output is a
   lowercase hex key plus newline, mode0600, exclusively created. Existing files
   and symlinks are rejected. Supply it only to the authorized isolated recovery
   process, then remove according to the operator's key handling procedure.

On any error the CLI emits only `RESOLUTE_KEY_ESCROW_FAILED`, never subprocess
stderr or the secret. Use a private trusted parent directory; file permissions
alone do not secure an untrusted machine. This tool does not promise memory
zeroization. No application automatically reads or installs a recovered key.

## Verification, 2026-10-19

Eight regression tests cover round trip, checksum-before-decrypt, wrong key,
wrong identity, malformed/duplicate payload fields, missing pins/size limit,
invalid input and exclusive mode0600 output including symlink refusal.
A separate real age v1.3.2 execution with freshly generated disposable identities
and a random synthetic key verified encryption/decryption, wrong identity,
authenticated tampering rejection, CLI behavior, no overwrite and no secret in
stdout/stderr. The normal test suite uses an injected transport and does not
require installing age in CI. No production key or existing recovery identity
was used in that acceptance check.

## Remaining activation gates

- Establish and demonstrate independent remote custody, download and recovery.
- Demonstrate provider-enforced writer permissions that cannot delete/replace
  protection history, or implement and review an isolated writer boundary.
- Railway currently documents no object versioning or object lock support:
  https://docs.railway.com/storage-buckets . Conditional PUT protects against
  collisions only; bucket-wide credentials must not be treated as non-delete.
- Only after those gates, review production migrations and minimum privileges,
  recovery write fencing, replay and explicit activation. Storage is still off.

## Readback verification without plaintext output — 2026-10-20 JST

Use `verify` for a capsule retrieved from its independent custody location:

```sh
python3 scripts/resolute/protection_keys.py verify \
  --capsule /private/retrieved-capsule.age \
  --capsule-sha256 <independently-retained-checksum> \
  --key-fingerprint <independently-retained-fingerprint> \
  --identity /private/recovery-identity
```

The command verifies the pinned capsule checksum BEFORE decryption, authenticates
and validates the payload and checks the recovered key fingerprint. It prints
only `{"state":"verified"}`. It has no output-file argument and never calls the
plaintext writer. Failure prints only RESOLUTE_KEY_ESCROW_FAILED with nonzero
exit. `recover` remains the explicit operation for an authorized recovery process
that needs a mode0600 plaintext file. Neither command activates application saves.

Local acceptance with real age1.3.2 and disposable identities passed: verify wrote
no plaintext file, wrong checksum/fingerprint/identity and authenticated tampering
all failed, and existing recover mode0600 output still matched the synthetic key.
Temporary identities and recovered plaintext were removed. Three CLI regression
tests cover no-write verification, redacted failure and rejection of --output.

A verified local capsule does NOT establish remote custody. Before generating or
installing the production protection key, record the actual independent custody
location, who can retrieve the age identity, where integrity pins are kept, and
perform a retrieval using those exact locations. Do not put the identity together
with application credentials. Do not label a synthetic local copy as a successful
remote retrieval. The production custody gate remains open.

## Owner custody rehearsal — 2026-10-20 00:58 JST

The owner reported redisplaying and comparing the disposable identity and pins
in Google Password Manager, and returned the capsule downloaded from Evernote.
Returned file RESOLUTE-TEST-ONLY-20261020(1).age (323 bytes) matched the original
byte for byte and its independently retained SHA256. Authenticated age decryption
and the recovered key fingerprint both passed using the retained disposable
test identity. This verifies the returned ciphertext; Google retrieval is
owner-attested, not a programmatic retrieval of the identity from Google.

The selected custody workflow is Google Password Manager for the private
recovery identity/integrity pins and Evernote for the encrypted capsule. The
rehearsal is complete with the stated evidence boundary. No production key was
created, installed or verified. Never reuse the disposable identity or key in
production. Actual production custody/readback and live Clerk authenticated
isolated acceptance remain open; saving stays disabled.


Update 2026-10-20 11:59 JST: live Clerk authenticated isolated recovery acceptance
now passed, followed by verified service/domain/credential retirement. See
RESOLUTE-AUTHENTICATED-RECOVERY-FLOW.md for actual logs and browser evidence.
Production key custody remains pending; the disposable rehearsal is not a
production key. No key, migration, saving flag or mail capability was activated.
