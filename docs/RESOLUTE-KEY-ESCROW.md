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
