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
Railway acceptance service, never the production database. Actual synthetic-session results follow below.

Validation: Node1193/1193, Python2508/2508 (296.062s), lint0 errors with5
existing warnings, Next build, compileall and diff check passed. Initial
concurrent lint/build and one Node process were OOM-killed; complete Node suite
and lint/build reruns passed. A pre-existing random corruption test could leave
its byte unchanged when it was already zero; it now flips a bit deterministically.
No failure was waived. A bounded owner-only server entrypoint is prepared but
not activated; it requires a separate token, one instance and <=1h window.


## 2026-10-20 11:30 JST — Actual isolated API-to-restore acceptance passed

Code fafbf53c796337f0be8257549d8eaa99bb1bb2e6 ran on the existing isolated
resolute-restore-acceptance service058b8f14-3cb5-45d8-a3f8-c73dc55adaec.
Deployment6f822e7a-4d76-4662-bf1f-5cae7bd37c16 logged
RESOLUTE_RECOVERY_ACCEPTANCE_OK at2026-10-20T02:30:24.691560493Z.
All nine returned checks were true: authenticatedSession, isolatedDatabase,
staleBackupVerified, independentReadback, firstReplay, secondReplay, planErased,
notificationsStopped and pendingQueueEmpty. These checks come from actual API
writes, three encrypted object readbacks, pg_dump/pg_restore, and SQL assertions
after each replay, not deployment status. Actual PostgreSQL18 and external object
storage were used; session signing was synthetic, liveOwnerSession=false.
ProductionTouched/mailSent/livePayment/aiCalled were all false.

Retirement deploymenta382d959-1e16-4025-9076-91cd8c27bd26 logged
RESOLUTE_RECOVERY_ACCEPTANCE_DISABLED at2026-10-20T02:32:35.735082075Z.
The enable flag is false and all five RECOVERY_STORAGE references were cleared.
No cron, public domain, volume, resource limit or production service changed.
Encrypted acceptance objects use a unique test prefix; the temporary encryption
key was discarded. They are not production recovery material.

Remaining gate: a live Clerk owner session through the preview transport and
bounded runner, plus independently retrievable production recovery-key custody.
The successful synthetic run does not close either gate. Ordinary customer
saving, notifications, payments and public RIZEL content remain disabled.


## 2026-10-20 — Live-session continuation prepared; exposure approval blocked

The preview browser still displayed an authenticated owner account. Added an
owner-only preview page at /resolute/recovery-check with an explicit one-shot
button, no mount-time request/retry, a synchronous double-click latch and
allowlisted evidence display. Both page and API remain disabled. No session
token was read from the browser. The existing server-side transport owns JWT
forwarding; ordinary plan/settings destinations are unchanged.

Automatic approval review rejected generating a public Railway domain for the
isolated runner because this would widen exposure without specific owner
approval. The service inspection confirmed no domain, no staged changes and
the disabled retirement deployment. Do not bypass that rejection or activate
credentials before approval. Required approval: a temporary HTTPS endpoint for
the isolated runner, with a separate service token, exact-owner signed-session
check, one execution and <=1h expiry, removed after verification. Synthetic
DB/storage only; no production DB, mail, payments or AI. No Vercel recovery
variables or live runner credentials were installed.

Validation of the owner-page tree: Node1193/1193, Python2508/2508 (258.697s),
lint0 errors/5 existing warnings, Next build, compileall and diff check passed.
The earlier executor commit fafbf53c GitHub CI39358938320 completed successfully.


## 2026-10-20 11:53–11:59 JST — Live Clerk recovery acceptance completed

Owner explicitly approved temporary HTTPS exposure for the isolated acceptance.
Preview024aea9e (Vercel dpl_CDKSdeVyksEsdhqdMiibSBERwbiC) forwarded the real
signed-in owner session server-side to runner fafbf53c on Railway deployment
59a94566-9b0a-4cdc-b7bb-9537b81ccc55. No browser JWT was extracted. Authorized browser automation
invoked the prepared UI exactly once. Browser
verifiedAt=2026-10-20T02:53:13.793Z, all nine checks true: authenticatedSession,
isolatedDatabase, staleBackupVerified, independentReadback, firstReplay,
secondReplay, planErased, notificationsStopped, pendingQueueEmpty.

Actual runtime logs show cluster, migrations, API save, stale backup, API
DELETE/both OFF, independent readback, restore, stale-state check, two replay
assertions and cleanup; RESOLUTE_RECOVERY_HTTP status200 at02:53:13.825169938Z.
This closes the previously pending live Clerk -> preview transport -> isolated
real PostgreSQL18/API/encrypted external storage -> pg_dump/pg_restore -> twice
replayed protection acceptance. It does not activate or mutate production data.

Retirement was verified, not inferred from deployment status:
- Temporary domain0a627f6b-135a-4a72-8baa-17038b9232bb was removed; service has no
  public domains/TCP proxies and no staged changes.
- Check flag false; token/until, three Clerk refs and five storage refs cleared.
- Railway retirement69a9adea-8db4-4b33-a4ff-aa423716aa04 logged
  RESOLUTE_RECOVERY_SERVER_DISABLED at2026-10-20T02:59:45.660319374Z.
- Four preview-only recovery envs retired (false/empty); Vercel retirement
  dpl_AQYviULTPxtvwS2SfKBMJef6ekCj READY. Browser reload showed disabled button
  and confirmation that the check is disabled.
- GitHub CI39360248328 for024aea9e completed both jobs successfully; local3701
  tests/lint/build/compileall were previously passed on that code tree.

No main change, production DB/schema/writer activation, mail, live payment,
additional AI call, RIZEL publication, cron or reservation modification.
Google Password Manager/Evernote disposable custody rehearsal is complete as
previously documented; actual production key creation/custody/readback and
production activation remain pending. Do not call customer saving operational.
Other contributor commit d1a76eaa was fast-forwarded before this docs-only record;
its account navigation/recovery changes were preserved unchanged.
