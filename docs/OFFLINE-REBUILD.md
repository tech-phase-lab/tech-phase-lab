# Offline rebuild preparation

The root layout now uses locally committed Geist/Geist Mono font files. All11
WOFF2 files are byte-for-byte copies from the previous successful next/font
build. The original font faces, Unicode coverage,100–900 weights, swap behavior,
fallback metrics, CSS variables and two Latin preloads are preserved. The font
license and file hashes are in public/fonts/geist. No Google Fonts build fetch,
mock font response or webpack-only diagnostic switch is required.

## Frontend installed dependency recovery package

Run only on a trusted, known-good checkout with installed dependencies:

```sh
python3 scripts/tech-phase/prepare_offline_dependencies.py \
  --repo /absolute/trusted/repo --output /private/new-dependency-package
```

The helper packages only node_modules, rejects credential-like filenames and
external/broken symlinks, compares installed package versions with package-lock,
and fully reads the generated tar to verify every file hash, size and symlink.
It records the package-lock hash, Node version/ABI, OS/architecture and libc.
These constraints matter for native modules. Copying this package to a different
platform is not supported. Missing optional platform packages are not a claim of
cross-platform readiness; the subsequent clean build is the acceptance gate.

This covers the Node frontend dependencies only, not the Python monitor or DB tooling.
This is local preparation, NOT encrypted offsite backup. Do not upload this tar
as plaintext to R2. Before offsite custody it needs authenticated encryption,
complete readback and a separate restore check, just like the source package.
It excludes application source, runtime databases, provider settings and the
Node executable. Keep the source revision and matching Node runtime separately.
A different lock hash requires a new dependency package. Installed dependencies
are not the same as an npm cache: this does not claim npm ci --offline succeeded.

Extract only the freshly generated, trusted archive into a new empty directory,
after comparing its SHA256 and lock hash with the recorded manifest. Do not use
this procedure for an untrusted archive. Keep npm/Clerk/Railway/provider secrets
out of the recovery build environment. First compile and probe locally with all
live saving, delivery and sales flags absent. Actual runtime data acceptance
still requires fresh deletion/suppression inventory and isolated DB restore.

## Validation record (2026-10-23 JST)

Dependency archive creation and full readback passed:32,242 entries,359,641,471 bytes.
SHA256: `f7485ba96fdd40c1301593a6d3ab1bdb0c5f3dd59918ed5ae371762d09d72b2f`.
Lock SHA256: `4a2bec98efc6e84a65f9a5a89d95fbb09df6882942af6c2809e1e5f76ac6aac0`.
Build environment: Linux x64, glibc2.39, Node24.19.0/ABI137. This records the
local test runtime, not a recommendation to downgrade production Node.

The first archive correctly failed validation because tar represented shared
inodes as hard links. The writer now stores each regular file independently;
the repeated full readback passed. Regression checks cover hard links, internal
symlinks, credential filenames, outside links, lock mismatch and existing output.

All11 font hashes and all13 font-face declarations matched the earlier build.
The local dependency tar is private temporary staging and is NOT yet encrypted
or stored in Cloudflare. It does not include a Node executable or Python wheels.
The committed preparation tool can recreate it; do not treat temporary staging
as durable disaster-recovery custody. Production services remain unchanged.

Before the next source backup,38 newly reachable blobs since80ced071 were
screened for known key signatures. Matches were limited to public news.skhynix.com
article URL slugs beginning sk-hynix-, not credentials. This remains bounded
screening, not proof that every possible secret format is detectable.

Validation in a separate source directory with dependencies extracted from the
verified tar (no existing node_modules symlink, no npm download/install):
- Final changed code/assets:17 files matched the proposed source tree exactly.
- Lint:0 errors,5 pre-existing warnings.
- Node:1328 passed,0 failed/skipped; npm test -- --test-concurrency=2.
- Python:2588 passed, including3 new offline-dependency regression tests;
  npm run test:python retained the repository's pinned clock.
- Provider credentials were absent. Node fetch/socket access outside loopback
  was rejected and telemetry disabled. No mock Google font response was set.
- Normal npm run build (Next16.2.4 Turbopack):passed without Google font mocks
  or webpack fallback. This supersedes the font-fetch limitation of the earlier
  runtime drill for this changed source. TypeScript/static generation passed.
- compileall and git diff --check:passed.
- Production-mode local HTTP: /research and /resolute returned200. All11 font
  files fetched over HTTP matched their pinned SHA256. Server stopped afterward.
- Total:3916 automated tests passed. No live data recovery or authenticated
  production API acceptance is claimed. Normal CI result is separate.

## Actual external source backup receipt

2026-10-23 10:58:26 JST (2026-10-23T01:58:26.3683583Z).
Run39886950983 / job120197233624 succeeded. Actual logged event:

```json
{
  "event": "SOURCE_EXTERNAL_UPLOAD_VERIFIED",
  "key": "tech-phase/source/v1/658001656cd894186994cf2697b98b548e668306/0bb275d2e9baa282d0b719aae708c9cc309888043a47c7719aa130200718f7f5.aesgcm",
  "sha256": "0bb275d2e9baa282d0b719aae708c9cc309888043a47c7719aa130200718f7f5",
  "bytes": 18739228,
  "commit": "658001656cd894186994cf2697b98b548e668306",
  "tree": "610e7cad64c361a80512ccadb1e18bfcfcaceee0",
  "source_restore_verified": true,
  "external_storage_verified": true,
  "runtime_restore_verified": false
}
```

The encrypted source object was uploaded, fully downloaded, hash checked,
authenticated and restored in an isolated Git repository. Commit/tree matched
this implementation. The non-secret manifest was published/read back last.
Bucket: resolute-backup-external. Existing objects retained.
https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39886950983

This includes committed fonts and the preparation tool, NOT the local359MB
node_modules tar or any live database. Dependency-archive encryption/offsite
custody, the matching runtime distribution and Python dependencies remain next
steps. No request-file change is made for this receipt, avoiding a backup loop.

Implementation CI39886950926 completed successfully on65800165: both the
PostgreSQL concurrency/signed-storage recovery job and lint/test/build job passed.
https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39886950926
This receipt is a later documentation-only change; diff-check passed. It does
not claim that a subsequent receipt-only CI run has already completed.
