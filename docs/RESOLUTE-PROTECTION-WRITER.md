# Isolated protection writer — implemented, not deployed

The application and retry worker now use a narrow HTTPS gateway instead of S3
credentials. `services/resolute-protection/server.mjs` is a separate dormant
process, not a route in the customer application. Nothing provisions a service,
changes an existing schedule or turns on customer storage.

## Boundary

Only authenticated `PUT /v1/events/<64-lowercase-hex>.bin` and `GET` on the same
exact path exist. Query strings, other paths, deletion/list/copy methods and
missing or duplicate authorization are rejected before object access. Tokens
must contain48–128 URL-safe characters; provision a random high-entropy value.
Authentication is compared in constant time. Never use the test token.

PUT requires `If-None-Match: *`, octet-stream content and at most2048 bytes. The
writer decrypts/authenticates the RPE1 event and verifies the HMAC object binding.
Its S3 adapter always supplies its own bucket and conditional create-only PUT.
Existing objects cannot be replaced through this interface. GET authenticates
stored ciphertext before returning it. The application independently verifies
readback before acknowledging completion. Lost PUT responses/repeated writes
still reconcile through GET; a conflicting event never becomes success.

There is no generic S3 proxy, object inventory API or plaintext event response.
Both directions bound object bytes. Storage calls have4-second aborts, requests
have5-second timeouts and at most16 concurrent storage operations (hard cap32).
Errors emit no request, credential or upstream exception text. Responses are not
cacheable. The application refuses the old direct bucket configuration, uses
HTTPS only on an explicit Railway service URL, and refuses redirects.

## Configuration and deployment prerequisites

Writer-only variables: RESOLUTE_WRITER_ENABLED=true, RESOLUTE_WRITER_ENDPOINT,
RESOLUTE_WRITER_BUCKET, RESOLUTE_WRITER_REGION, RESOLUTE_WRITER_ACCESS_KEY_ID,
RESOLUTE_WRITER_SECRET_ACCESS_KEY, RESOLUTE_WRITER_KEY_HEX, RESOLUTE_WRITER_TOKEN.
PORT defaults to3000. Start with Node supporting TypeScript stripping:
`node --experimental-strip-types services/resolute-protection/server.mjs`.
Without its explicit enabled flag, the executable exits without opening a socket
or contacting S3. No scheduler is needed or added.

Application/retry variables: RESOLUTE_PROTECTION_ENABLED=true,
RESOLUTE_PROTECTION_WRITER_URL=https://<separate-service>.up.railway.app,
RESOLUTE_PROTECTION_WRITER_TOKEN, RESOLUTE_PROTECTION_KEY_HEX. No S3 credentials.
These remain absent/disabled in production. This intentionally breaks the dormant
old direct-S3 configuration; install matched application/writer versions before
any activation. Never place these variables in NEXT_PUBLIC_* or browser code.

Use a dedicated protection bucket and separately deployed writer identity. Do
not copy backup-service credentials or deploy the writer in the application
process. Application/retry services must have no bucket credentials, DB owner
credentials, deployment-management token or ability to obtain writer secrets.
The writer must not have source-DB, payment, mail or recovery-identity credentials.
Recovery inventory credentials belong only to the separately fenced restore path.
Actual service variable/identity separation must be checked before acceptance.

## Scope of the guarantee and pending evidence

This software boundary prevents application callers from issuing deletes or
replacing existing protection objects. It is NOT provider object lock: a writer
process compromise or holder of the underlying broad bucket credentials can
still delete objects. Railway documents no versioning/object lock support. Keep
that residual risk explicit; do not mark provider-enforced retention complete.

Local HTTP tests cover publish/readback/retry/conflict, unauthorized access,
method/path restrictions, ciphertext binding, size limits, damaged stored objects,
redirect refusal, configuration separation, dormant startup, fixed S3 commands
and concurrent-request bounds. The storage adapter in those tests is synthetic.
Real deployed credential isolation, negative HTTP acceptance against the separate
service, actual private-bucket readback and isolated restore replay remain open.
Independent production key custody/readback remains open as documented in
RESOLUTE-KEY-ESCROW.md. No production key, service, role or saving flag changed.
