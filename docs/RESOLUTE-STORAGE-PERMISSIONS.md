# Storage permission preparation — not activated

Migration019 and `scripts/resolute/provision-storage-permissions.mjs` prepare the
three existing dormant roles after002–005/016–018. The operator runner wraps the
migration and the effective-privilege audit in one transaction; any mismatch rolls
back the new grants. Do not apply019 alone and assume its grants are an audit.
No role password, LOGIN flag, provider setting, scheduler or API switch is changed.
The default CLI invocation is disabled and does not open a database connection.
Explicit operation requires RESOLUTE_PREPARE_STORAGE_PERMISSIONS=true and a setup
URL restricted to postgresql://…@postgres.railway.internal/resolute. No secret
values or SQL exception details are emitted. Imports have no connection side effect.

| Role | Allowed application access |
| --- | --- |
| resolute_plan_writer | Read legacy entitlements and live entitlement view; read/insert/update plans; read/insert deletion journal; read protection outbox and update receipt/retry columns |
| resolute_notification_writer | Read legacy entitlements and live entitlement view; read/insert/update notification settings; read protection outbox and update receipt/retry columns |
| resolute_protection_writer | Read protection outbox; update receipt/retry columns only |

The audit checks effective table AND column privileges, including PUBLIC grants,
against an exact allowlist. Grant options, ownership, sequence access, schema or
database CREATE, user-defined executable SECURITY DEFINER functions, privileged
role attributes, LOGIN and role membership in either direction are rejected.
PostgreSQL17+ MAINTAIN grants are also checked. User schemas such as pgshadow are
not mistaken for system schemas. Missing required tables/grants fail closed.
No data rows are inspected or logged. Raw payment tables and mail delivery queues
are outside the allowlist. Unexpected existing privileges are not silently revoked;
the operator must investigate them before retrying.

This is a permission-preparation check, NOT the independent write fence required
to seal a recovery manifest. NOLOGIN does not disconnect an existing session.
Recovery still requires stopped writers, verified absence of active connections,
complete independent object inventory and post-replay verification. Re-audit after
schema/ACL changes; a passing catalog snapshot does not constrain future grants.

## Remaining production gates

Nothing in019 has been applied to Railway. The production source still lacks
plan/settings schemas, so this command is not yet runnable there. Before installing
those schemas, prepare a complete independent manifest/key path for weekly restore.
Keep customer storage and protection retry flags disabled until authenticated
API-to-bucket/recovery acceptance passes with the intended real identities.

Railway's current bucket CLI documentation exposes bucket credentials and reset,
but the inspected interface does not establish prefix-scoped, non-deleting writer
credentials: https://docs.railway.com/cli/bucket#show-or-reset-credentials . Absence
from that interface is not proof the provider has no such capability. Do not copy
existing backup credentials to the application or reset them to resolve this gap.
Provider-enforced restriction or an explicitly reviewed isolated writer boundary
must be established and verified before provisioning the application credentials.

The protection key must be recoverable independently of the source database and
runtime service. Do not generate/replace a production key until its protected
escrow, recovery test and custody are defined; rotating it changes HMAC object names
as well as encryption. Never put plaintext keys in git, logs or chat. Key custody
and negative object-permission acceptance are still unverified, not completed by
this SQL work. Existing backup/restore schedules and morning reservations remain
unchanged.
