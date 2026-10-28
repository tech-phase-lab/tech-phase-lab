# Offline protection-key escrow

`protection_keys.py` prepares an age-encrypted recovery capsule for the existing
32-byte online protection key. Its explicit `prepare` command generates a fresh
key on the owner's device; `seal` accepts an existing key. Neither contacts
storage, enables writes, or changes services. Requires the `age` executable.

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

## Operator-local preparation — 2026-10-20

`prepare` now creates a fresh native age identity and random 32-byte protection
key on the operator's own device, seals and authenticates the capsule, and emits
only a non-secret status. It does not install the key or contact any service.
Never run it in a chat-hosted workspace to create production custody material.
Local preparation is not proof of Google/Evernote retrieval.

Prerequisites: Python 3 and trusted `age`/`age-keygen` on PATH. This operation
supports owner-only POSIX filesystems. Native Windows is deliberately rejected
because chmod does not establish Windows ACLs. On Windows, use an existing WSL
Linux home directory, never a Windows-mounted `/mnt/c` directory. WSL itself has
not been acceptance-tested here; do not infer native Windows support. If this
workstation setup is unavailable, resolve that before asking the owner to run it.

In a local terminal, from the checked repository, create a private parent outside
any repository, shared/synced folder or application credentials directory:

```sh
mkdir -m 700 "$HOME/resolute-key-custody"
python3 scripts/resolute/protection_keys.py prepare \
  --directory "$HOME/resolute-key-custody/production-20261020"
```

An existing output directory (including a symlink) is rejected without changes.
A failed preparation removes only its newly created partial directory. This is
cleanup, not a promise of secure erasure from disk snapshots. Do not delete an
older key set to retry; select a new directory after understanding the error.

Save the generated items in separate destinations:

| Local file | Destination |
| --- | --- |
| google-recovery-identity.txt | New Google Password Manager entry, private identity as password; never overwrite the rehearsal entry |
| google-integrity-pins.json | Notes in that same Google entry; retain both named pins exactly |
| evernote-recovery-capsule.age | New Evernote production recovery note, encrypted attachment only |
| local-preparation.json | Local status only; remoteCustodyVerified and activated remain false |

Never upload the entire directory, the private identity, or Google screenshots
to chat, Evernote or the repository. No plaintext online protection key is
written. File permissions are 0600 and the new directory is 0700.

Close both apps, reopen the new Google entry, redisplay the private identity and
both pins, and download the actual attachment again from Evernote. Use the
existing `verify` command above with that downloaded capsule and an identity
file reconstructed locally from the Google entry, using the pins redisplayed
from Google. Do not use the original local identity as evidence of Google
retrieval. A successful command prints only `{"state":"verified"}`; that
non-secret result may be shared. Record the actual custody entry identifiers
without passwords. Keep the original private set until retrieval is confirmed;
retention/cleanup and installation are separate operator actions.

Validation: all 18 key-escrow unit tests passed. With actual age 1.3.2 and
fresh disposable identities, prepare + verify passed; wrong identity, modified
ciphertext and repeated preparation were rejected; existing bytes were retained
and permissions checked. Disposable test directories were removed. No production
identity/key was generated, installed, remotely retrieved or activated.


## Production custody readback — 2026-10-20 13:13 JST

This supersedes earlier statements that a production key has not been created
or that owner custody is still pending. Evidence is owner-reported terminal
results on the owner's WSL Ubuntu PC, not direct assistant access to that PC or
a programmatic Google/Evernote retrieval. Reported tools: age/age-keygen1.2.1,
Python3.14.4. Preparation used the pinned6f9c0ab9 script and returned
locally-verified. No production secret was transferred to the chat environment.

Custody locations: Google Password Manager entry RESOLUTE本番復旧鍵-20261020
(identity in password; both integrity pins in notes), and Evernote note
RESOLUTE 本番復旧用 20261020 (encrypted capsule attachment only).
The downloaded attachment was initially named return instead of returned;
correcting the name produced FILE_OK. No key was regenerated.

The temporary interactive verifier subsequently returned VERIFY failure.
Its exact cause remains unconfirmed; do not attribute it to a bad password or
corrupt file. Follow-up checks separately established:
- FILE_MATCH: returned Evernote ciphertext exactly equals the original capsule.
- PASSWORD_MATCH: hidden input copied from Google equals the original identity.
- MEMO_MATCH: parsed Google notes equal both original named integrity pins.
- RESOLUTE_CUSTODY_VERIFIED: recover() authenticated the returned ciphertext
  with the locally retained identity/pins, validated its strict payload and
  matched the recovered protection-key fingerprint. No plaintext key was written.

Together these checks establish owner-attested custody/readback and recovery:
the Google-retrieved inputs matched those used in the successful recovery.
The successful final command alone, without the preceding Google comparisons,
would not establish independent Google retrieval. The temporary-identity-file
variant is not claimed successful. The original preparation marker still says
remoteCustodyVerified=false and activated=false; it is a preparation-time marker,
not an updated custody record. Retain the original private files for now.

Production service provisioning, migrations/ACLs, the independently complete
fenced recovery manifest and customer-save activation remain separate pending
work. No service variables, DB grants, schedules, reservations, mail, payments,
AI calls or RIZEL visibility changed. Prior live Clerk isolated recovery
acceptance remains synthetic; it does not prove production-key installation.
