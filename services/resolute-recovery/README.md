# Isolated recovery coordinator (not deployed)

`handler.mjs` is the authenticated execution gate for the preview transport.
It is not a runnable acceptance service yet. There is deliberately no default
executor, database connection, infrastructure configuration or enabled entrypoint.
Do not deploy it with a synthetic executor that simply returns true checks.

The coordinator verifies the service credential and Clerk signature/issuer/party,
then the exact owner. It accepts only a version-4 UUID nonce, no operation, SQL,
URL, command or user selector. It claims one permit per prepared sandbox before
execution. Concurrent requests, repeats after failure and a reconstructed process
with the same permit file cannot execute again. The private permit contains only
the nonce. Never delete it to retry an uncertain outcome; inspect actual logs and
prepare a fresh isolated sandbox. A redeployment with ephemeral disk is a fresh
sandbox, not durable deduplication across arbitrary deployments.

The fixed `execute` adapter still needs to join the actual scoped plan/settings
API, separate encrypted writer and PostgreSQL dump/restore harness. It must:

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
process lifecycle behavior only. The actual PG/API/writer executor, deployed
owner-session acceptance and production key custody are still required; this
helper does not enable any service or establish recovery acceptance by itself.
