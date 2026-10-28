# Isolated recovery acceptance

`handler.mjs` is the authenticated execution gate for the preview transport.
The fixed executor and disabled-by-default one-shot CLI now accompany it.
No production database connection or enabled public entrypoint is supplied.
Do not deploy it with a synthetic executor that simply returns true checks.

The coordinator verifies the service credential and Clerk signature/issuer/party,
then the exact owner. It accepts only a version-4 UUID nonce, no operation, SQL,
URL, command or user selector. It claims one permit per prepared sandbox before
execution. Concurrent requests, repeats after failure and a reconstructed process
with the same permit file cannot execute again. The private permit contains only
the nonce. Never delete it to retry an uncertain outcome; inspect actual logs and
prepare a fresh isolated sandbox. A redeployment with ephemeral disk is a fresh
sandbox, not durable deduplication across arbitrary deployments.

The fixed `execute` adapter joins the actual scoped plan/settings API, encrypted
HTTP writer and disposable PostgreSQL dump/restore harness. Required properties:

- Reject inherited production DB credentials before opening any connection.
- Use a fresh disposable local PostgreSQL cluster and dedicated test storage
  namespace, with no production keys or customer records.
- Exercise authenticated plan deletion and both notification stops through the
  API and require independent durable readback before successful responses.
- Restore the stale dump; prove the pre-replay fixture exists; check deletion,
  both stops and empty pending queue after each of two replays.
- Honor the supplied abort signal by terminating and awaiting its subprocesses;
  produce no success after timeout. An abort does not release the permit.
- Return the eight checked booleans plus explicit false values for
  `productionTouched`, `mailSent`, `livePayment`, and `aiCalled`, only after
  observing those results. No raw logs, tokens or keys in responses.

Startup must validate the independent deployment, credentials and owner-controlled
configuration. The window is at most one hour, execution at most fifty seconds,
and no retries are allowed. The containing private permit directory must survive
process restart for the lifetime of that sandbox. No public route may choose
this path. The runner must have one instance; multi-instance deployment requires
a shared atomic permit before activation. Existing app destinations stay unchanged.

Tests verify real ephemeral RSA signatures, rejection, concurrent/failed/restarted
requests and evidence filtering. Their executor returns synthetic reports; they
are not evidence of live PostgreSQL/S3 acceptance. Full deployed acceptance remains
an explicit launch blocker.

## Bounded subprocess execution

`process.mjs` supplies `runIsolatedProcess` for the fixed executor's Linux CLI
steps. It requires an explicit environment, rejects inherited PostgreSQL/database
connection and runtime-injection variables, uses no shell or stdin, and bounds
total stdout/stderr. Abort/timeout/overflow sends TERM to the process group then
KILL after a bounded grace period. It waits for close, discards output on failure,
and never returns stderr. Descendants in the group are killed even if the leader
exits first. Child code must not deliberately create an unrelated process group;
this runs trusted fixed commands, not arbitrary user code or a security sandbox.

Real-child tests cover a TERM-resistant descendant, caller abort with exit0,
output overflow, missing executable and environment separation. These prove
process lifecycle behavior only. Deployed owner-session acceptance and production key custody are still required; this
helper does not enable any service or establish recovery acceptance by itself.

## One-shot container run

`Dockerfile` uses PostgreSQL18 and Node24 as an unprivileged postgres user.
`cli.mjs` is inert unless RESOLUTE_RECOVERY_SYNTHETIC_ENABLED=true and
RESOLUTE_RECOVERY_ACCEPTANCE_ONLY=true. The synthetic session is signed by a
fresh test key, verified by the coordinator and the actual API. It is not a live
Clerk owner-session acceptance. The normal preview transport remains disabled.

Storage uses RECOVERY_STORAGE_ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY
with a fresh acceptance-only object prefix, conditional writes and bounded GETs.
No production event/key namespace is used. A fresh encryption key lives only in
process memory for synthetic fixtures and is wiped afterward; it is not production
key custody. No arbitrary command, URL or DB address comes from an HTTP request.
The original bearer token stays in process memory for forwarding to the loopback
API; it is never passed to children, files, logs or object storage.

The executor creates a private Unix-socket-only cluster, installs schemas, uses
scoped DB roles and actual authenticated API mutations, dumps the pre-deletion
state, requires three durable receipts, fences the API/writer, reads encrypted
events independently and matches receipt checksums, then restores and checks the
stale fixture and both replays. Cleanup stops the cluster and removes local files.
Real-container results must be recorded separately; unit tests do not prove them.
