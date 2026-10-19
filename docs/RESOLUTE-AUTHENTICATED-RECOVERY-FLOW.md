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
