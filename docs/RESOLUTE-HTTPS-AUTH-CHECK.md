# Production HTTPS authentication preflight — 2026-10-20 23:16 JST

This check proves transport/authentication between the deployed API and existing
public writer domain. It deliberately cannot access S3 or persist any object.
It does not satisfy durable receipt, complete inventory or nonempty restore gates.

## API runtime

The existing API was sleeping. A read-only /healthz browser request returned
status ok and woke it; Console then connected without a new login or deployment.
Inside the existing API container, exact project/environment/service assertions
passed. The existing production protectionGatewayConfig function validated the
runtime token/key/HTTPS endpoint with a copied environment for parsing only;
process.env and application saving flags were never enabled. It also rejected
coexisting direct bucket credential configuration. No secret value was printed.
RESOLUTE_API_RUNTIME_CONFIG_OK reported protectionEnabled=false, valid formats,
bucketCredentialsAbsent=true, networkCalls0 and writes0.

At14:12:12.837Z, RESOLUTE_API_SAVE_GATES_CLOSED confirmed plan API, notification
API, protection publisher and retry worker all not enabled, and all three storage
DB URL variables absent. No payment/email/AI operation was called.

## Bounded no-storage listener

Only the existing writer service startCommand was temporarily changed. Its
RESOLUTE_WRITER_ENABLED stayed false and the wrapper required that exact value.
It imported the unchanged production createWriter/writerConfig functions, but
substituted both object operations with unconditional errors (no S3 client).
An outer HTTP server rejected every non-GET request with405 before dispatch.
Existing token/key stayed in the same existing services; no new service,
credential transfer, domain, volume, cron or role was introduced.

The first redeploy0575e7e2 reused the old deployment start command and emitted
RESOLUTE_WRITER_DISABLED. It was not counted as successful preflight. Reconnecting
the same pinned source4b3bdd8e created3dd5d74d-ae71-49ac-be19-589d54992f02,
which emitted RESOLUTE_HTTPS_AUTH_PREFLIGHT_READY at14:14:06.520046190Z,
storageAccess=false, writes=false. Its writer Dockerfile/server/ledger match the
previous build76fdf945 and testedfb7c4eda. No application source changed.

From the existing API container, native fetch used its existing token and fixed
HTTPS origin, redirect:error and15-second timeout. Bodies were cancelled. At
14:14:43.379Z, RESOLUTE_PUBLIC_HTTPS_AUTH_OK / HTTPS_CHECK_EXIT=0 recorded:

| Request | Expected and observed |
| --- | --- |
| GET /v1/events, correct existing token |404 (authenticated route rejection) |
| Same GET, no token |401 |
| Same GET, wrong token |401 |
| PUT fixed all-zero synthetic event filename |405 before storage dispatch |
| GET same filename with correct token |503 from deliberate no-storage adapter |

The404 versus401 establishes real token/reference agreement over public HTTPS.
The503 is intentional and is NOT a successful object read. No event was generated,
encrypted, uploaded or acknowledged; no production manifest or pin was modified.

## Verified cleanup

Restored the exact original start command and reconnected the same fixed source
so the new configuration actually deployed. Deployment
ab018522-2571-4302-9b4d-c59106741715 reached SUCCESS and emitted
RESOLUTE_WRITER_DISABLED at14:15:44.656774840Z. Readback confirmed original start,
NEVER restart, existing limits/region/sleep configuration. The preflight deployment
3dd5d74d was subsequently REMOVED, not merely superseded while still listening.
API save gates and all3 NOLOGIN roles remain unchanged.

Next: maintain a fence across DB writers and object publishers, seal a fresh full
inventory with independent pin, exercise actual immutable objects/receipts, then
independent nonempty deletion/both-stop restore and repeat replay. Do not call the
no-storage listener a durability test, or reuse a bootstrap empty manifest.
No owner login, key entry or Run now is needed. Documentation-only change;
git diff --check is the applicable gate, not a new full-suite test claim.
