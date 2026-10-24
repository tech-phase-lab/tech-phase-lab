# Isolated writer deployment — 2026-10-19

Scope: synthetic acceptance only. No production customer saving, payment, mail,
AI call, DB migration or morning schedule activation/change is authorized by this
record. Production key custody and end-to-end restore replay remain open.

## Resource identity

- Project: 0872be15-db75-4e5a-ae0f-881911fb442d
- Environment: 3a80776d-15a3-4ca1-bd0c-e0c915ccf73b
- Dedicated writer: 9d9728c1-aeae-4b33-9654-fe869f42e928
- Dedicated bucket: 978cea1c-440a-42c2-b98c-0c8fe6a22626 (resolute-protection, sjc)
- Domain: resolute-protection-writer-production.up.railway.app
- Pinned code: 4b3bdd8ebe94b1afdc779e1f81af1f3fe4ca65fb
- Initial deployment: 4799da00-a807-4094-b82e-4cc07a48b850

The application has no writer or bucket credentials. The writer has only its
bucket references, synthetic key/token and PORT. No shared variables, database,
mail or payment credentials were added. Resource limits:250MB/0.5CPU, one replica,
restart NEVER, sleep enabled. The image runs as node, not root, and copies only
the writer and encryption module plus locked runtime dependencies.

Integrated colleague cbb8310 without changing their navigation work. Checked
Node1154, Python2498, lint0 errors/5 existing warnings, Next build, compileall and
diff check. Both Git Data trees exactly matched local staged trees before ref
updates. main, existing API/backup/restore/morning services remain untouched.

## Synthetic key handling

A new disposable key/token was used. The key was age-encrypted, decrypted and
compared before configuring the acceptance client with the recovered key. This
was a local synthetic capsule, NOT independent production custody. No production
recovery identity or production data was accessed. Keys and tokens are never
included in this record.

## Acceptance and retirement evidence

Writer deployment4799da00 reached SUCCESS and logged RESOLUTE_WRITER_LISTENING.
An independent one-shot Railway Function (310e0e6e-1a55-4a20-88fb-412a86d1d860)
ran the bundled, committed acceptance script without bucket/DB credentials.
Deployment10e5e196-03d9-437a-84b7-c89d23dba267 reached SUCCESS and logged
RESOLUTE_WRITER_ACCEPTANCE_OK at2026-10-19T14:06:01.212509145Z. All three
synthetic event kinds were saved and authenticated on readback. Idempotent retry,
conflict/overwrite refusal, DELETE/list/unauthenticated/query rejection and missing
conditional-header rejection passed. Exact object names/checksums are in
RESOLUTE-PROTECTION-ACCEPTANCE-2026-10-19.json. No production user records.

The external Work executor's first attempts failed at the4-second client timeout;
its proxy path took5–7 seconds even for unauthorized requests while Railway
reported milliseconds inside the service. Those attempts are NOT passes. The
independent Railway probe succeeded using the unchanged4-second client timeout.
It ran the bundled protocol client on Bun; actual customer API/DB-to-restore
acceptance remains open. No production timeout was loosened to pass this check.

Retirement was applied to only these two new services. Both enable flags are false
and both synthetic keys/tokens are blank in the current configuration. Writer
retirement4892f476-4159-4440-9016-609b30e4f240 reached SUCCESS and logged
RESOLUTE_WRITER_DISABLED at2026-10-19T14:08:02.709762846Z. Probe retirement
5187ad7b-0356-43d4-a035-6a5795717334 reached SUCCESS and logged
RESOLUTE_WRITER_ACCEPTANCE_DISABLED at2026-10-19T14:07:38.197551548Z.
Neither service has a cron. Retained resources are dormant, not deleted; encrypted
synthetic objects remain. Never reactivate an old synthetic deployment for users.
The SYNTHETIC_ONLY variable was a descriptive marker, not an access-control gate.

## Reproducing the probe

Bundle scripts/resolute/check-protection-writer.mjs through an entry importing
checkWriter and top-level awaiting checkWriter(process.env). Use esbuild with
--bundle --platform=node --format=esm and --define:process.argv=[] so the imported
CLI guard does not run a second copy. Validate that default invocation emits one
DISABLED result. The function has no external dependencies and receives only
RESOLUTE_PROTECTION_ENABLED, RESOLUTE_WRITER_ACCEPTANCE_ONLY, gateway URL/token
and the recovered synthetic key. Do not grant it bucket, DB or provider tokens.

## Remaining gates

Independent production key custody/readback, production DB privilege/schema
installation, fenced full inventory and actual API-to-isolated-restore replay are
not completed by this synthetic acceptance. Provider object lock is not supplied
by this software boundary. Do not enable customer saves, notifications or sales
until the applicable gates have evidence.
