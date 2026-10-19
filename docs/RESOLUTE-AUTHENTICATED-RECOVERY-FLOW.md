# Authenticated recovery flow regression

`tests/resolute-protection-flow.test.mjs` joins the previously separate contracts:

1. Browser-facing plan/settings routes obtain a synthetic signed session and use
   the normal forwarding transports. The actual API handler and Clerk verifier
   check its RSA signature, issuer, authorized party, session and service token.
   Invalid signatures and an identity without entitlement are rejected.
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
key, not issued by a customer's live Clerk session. API forwarding uses a
Request/Response adapter; the writer uses real local HTTP. PGlite implements
PostgreSQL behavior but this fixture transfer is not pg_dump/pg_restore. Object
storage and inventory are in memory. The separate real PostgreSQL18/S3 acceptance
in RESOLUTE-RESTORE-ACCEPTANCE.md remains the evidence for actual dump/restore.
Do not combine those two tests into a claim that a deployed customer session has
passed the entire flow. No production service, key, flag, schedule or UI changes.

Remaining deployment gate: run the complete authenticated API/store/writer/replay
path on isolated real infrastructure with reviewed production-like credentials,
then separately establish independent production recovery-key custody. Customer
saving, payment activation and notification delivery remain disabled.
