# Authenticated recovery flow regression

`tests/resolute-protection-flow.test.mjs` joins the previously separate contracts:

1. Browser-facing plan/settings routes obtain a synthetic signed session and use
   the normal forwarding transports over a real loopback HTTP socket and the
   same Node HTTP bridge used by the deployed entry point. The API handler and Clerk verifier
   check its RSA signature, issuer, authorized party, session and service token.
   Missing service credentials, invalid signatures and an identity without entitlement
   are rejected.
2. The real plan/settings stores write to PGlite under separate dormant roles
   granted by migrations001–005/017–019. A stale fixture copies the actual
   API-written plan/settings rows and one pending notification before deletion.
3. The real protection barrier publishes through the gateway client to an actual
   loopback HTTP writer. Its object backing is an in-memory conditional store.
   With storage unavailable, deletion returns503 after committing its durable
   retry record. GET also returns503, and settings cannot overtake the pending
   protection record. After storage recovers, GET drains the deletion and the
   subsequent stop records both notification channels. All three receipts persist.
4. Python seals and authenticates the independently retained encrypted records,
   generates the production replay SQL and applies it to a separate restored
   fixture. The stale plan/ON consent/pending queue are checked first. Both the
   first and second replay must leave plan absent, both notifications OFF and
   queue empty. Corrupted ciphertext prevents recovery SQL generation.

## Evidence boundaries

This is a local integration regression. The JWT is signed by an ephemeral test
key, not issued by a customer's live Clerk session. The API and writer both use real local HTTP. A test-only fetch adapter remaps
the already validated Railway HTTPS origin to the loopback listener; it does not
call the handler directly or relax production HTTPS/hostname checks. This is not
remote TLS or a deployed Railway network test. PGlite implements
PostgreSQL behavior but this fixture transfer is not pg_dump/pg_restore. Object
storage and inventory are in memory. The separate real PostgreSQL18/S3 acceptance
in RESOLUTE-RESTORE-ACCEPTANCE.md remains the evidence for actual dump/restore.
Do not combine those two tests into a claim that a deployed customer session has
passed the entire flow. No production service, key, flag, schedule or UI changes.

Remaining deployment gate: run the complete authenticated API/store/writer/replay
path on isolated real infrastructure with reviewed production-like credentials,
then separately establish independent production recovery-key custody. Customer
saving, payment activation and notification delivery remain disabled.

## Shared HTTP entry point — 2026-10-20 JST

The production Node HTTP bridge now lives in `services/resolute-api/http-server.mjs`.
The entry point retains the same payment-handler precedence, header/body streaming,
connection limits and timeouts. Extracting the bridge lets this regression exercise
the deployed HTTP parsing and response serialization without loading credentials,
starting payments or opening production saving. The fixture still uses synthetic
JWTs and PGlite; live Clerk, real PostgreSQL dump/restore and external storage in
one deployed flow remain unverified.

Validation: Node1155/Python2508 passed, lint had zero errors (five existing
warnings), production build, compileall and diff checks passed. The first default
parallel Node run lost three unrelated test processes while the container recorded
OOM kills; the complete suite passed with `npm test -- --test-concurrency=2`
without new OOM kills. Initial build font downloads returned HTTP503; unchanged
`npm run build` succeeded on retry. No tests were removed or skipped.

## 2026-10-20 JST — Live owner session and disabled acceptance transport

The owner completed secure browser sign-in on the preview deployment. The account
page identified the owner and PRO membership. A direct authenticated browser read
of `/api/resolute/entitlements` returned `resolute_v1`, `asOf`
`2026-10-19T16:23:50.048Z`, both grants `missing`, and both capability booleans
false. PRO membership alone does not grant RESOLUTE access. Direct plan and
notification-settings reads returned `PLAN_UNAVAILABLE` and
`NOTIFICATION_UNAVAILABLE`. No browser token was extracted and no saving was
activated. This verifies live authenticated reads, not a deployed recovery run.

Added POST `/api/resolute/recovery-check` as an inactive server-side transport.
It requires the preview environment, ENABLED=true and an UNTIL time no more than
one hour ahead; missing configuration keeps it disabled. It accepts only an
empty same-origin request with `X-Resolute-Recovery-Check: 1`, authenticates the
exact owner, and obtains the session token server-side. It forwards one nonce
to a separately configured Railway origin with a separate service token; it
never changes normal plan/settings destinations or retries a lost response.
Responses have a size limit and must contain fresh nonce-matched checks for
isolation, independent readback and both replays. Only allowlisted evidence is
returned; logs and credentials are not relayed.

Configuration names: `RESOLUTE_RECOVERY_CHECK_ENABLED`,
`RESOLUTE_RECOVERY_CHECK_UNTIL`, `RESOLUTE_RECOVERY_CHECK_URL`, and
`RESOLUTE_RECOVERY_CHECK_SERVICE_TOKEN`. None were installed in this step.
The dedicated `/internal/v1/recovery-check` runner is NOT yet implemented or
deployed. Before any activation, verify ownership of its deployment, actual
isolated database/storage wiring, server-side JWT verification, operation
fencing and single-run behavior. A different hostname or an upstream JSON report
alone does not establish isolation or prove execution; correlate actual runner
logs and saved results. Tests currently use synthetic response reports solely
to verify transport rejection/redaction. Production custody, DB gates and the
complete authenticated real PostgreSQL/S3 dump/restore acceptance remain open.

## 2026-10-20 — Bounded subprocess prerequisite

Added a Linux process-group runner for the pending fixed isolated executor.
Explicit environment only, no shell/stdin, bounded combined output, redacted
failures, abort/timeout TERM then KILL, and close awaited before completion.
Actual child-process tests cover resistant descendants and abort with exit0;
no synthetic report is substituted for a real recovery result. This is not yet
the full authenticated PostgreSQL/API/writer executor. No service, production
key, migration, saving gate, schedule, mail or provider was activated.

Validation: Node1188/1188 and Python2508/2508 (242.753s), total3696;
lint0 errors/5 existing warnings, Next build, compileall and diff check passed.
These results include actual local child processes but not live PostgreSQL/S3
or owner-session restore acceptance. Do not enable saving from these results.

## 2026-10-20 — Fixed real PostgreSQL/API executor connected

Added executor.mjs, acceptance-only S3 adapter, replay-SQL bridge, one-shot CLI
and PostgreSQL18/Node24 container. The coordinator forwards the already verified
bearer token in memory to the isolated loopback API; it never leaves through a
child environment, object, file or log. The synthetic CLI uses a fresh signed
fixture session and explicitly labels liveOwnerSession=false.

The executor uses real scoped API saves/deletion/both notification stops and
actual pg_dump/pg_restore. It requires three independent encrypted receipts,
fences the API/writer, compares readback checksums, proves stale backup contents,
and checks each of two replays. No caller-selected command/DB/path. Storage writes
are restricted to a fresh acceptance prefix outside production events. Cleanup
stops the temporary cluster. Local PostgreSQL package installation is blocked by
runtime setgroups/setuid restrictions; real execution uses the existing isolated
Railway acceptance service, never the production database. Live results pending.

Validation: Node1193/1193, Python2508/2508 (296.062s), lint0 errors with5
existing warnings, Next build, compileall and diff check passed. Initial
concurrent lint/build and one Node process were OOM-killed; complete Node suite
and lint/build reruns passed. A pre-existing random corruption test could leave
its byte unchanged when it was already zero; it now flips a bit deterministically.
No failure was waived. A bounded owner-only server entrypoint is prepared but
not activated; it requires a separate token, one instance and <=1h window.
