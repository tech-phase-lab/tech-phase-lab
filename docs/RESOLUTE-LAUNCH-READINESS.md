# RESOLUTE launch readiness — reconstructed record

Reconstructed 2026-10-19 after workspace maintenance removed the former scratch
checkout and the uncommitted operational record. This is NOT the recovered
original and is not a complete historical log. Evidence below comes from the
conversation handoff and committed project records; unverified items stay open.

## Latest decision point — 2026-10-20 11:32 JST

Supersedes the dated status below. Code fafbf53c: Node1193/Python2508 (3701),
lint/build/compileall/diff passed. Actual isolated authenticated synthetic-session
API -> PostgreSQL18 -> encrypted external storage -> stale dump/restore -> two
replays passed all nine checks at11:30 JST. See authenticated recovery flow doc.
The test service was disabled and all five storage references cleared; actual
DISABLED log verified at11:32 JST. Live Clerk owner-session acceptance and
production recovery-key custody remain open; production saving remains disabled.

October20 morning news did NOT produce a successful saved article:07:02 readback
confirmed zero candidates/saved rows. Morning preflight later passed, but that
is not generation success. Current publication-date guard is live on20a3069e;
cron/reservations unchanged. Stock News API and Twelve Data remain uncontracted
until planned mid-November. Prior-day/delayed news cannot be relabeled as today.

## Historical decision point — 2026-10-20 JST

This section supersedes older pending statements below; historical evidence is
retained. Latest implementation:0399659f (HTTP API bridge),86ae9c53 (capsule verify).
Local integrated gates passed: Node1155, Python2508, lint/build/compileall/diff.
GitHub run39279609804 was QUEUED at this check; no CI success is claimed.

| Gate | Current evidence | What remains |
| --- | --- | --- |
| Durable deletion/notification stops | Transactional journals/outbox, independent encrypted events, completion barrier and retry implemented | Apply reviewed schemas/ACLs only after recovery inputs are available |
| Independent writer | Actual HTTPS/S3 synthetic write/readback/conflict checks passed | Production key/token provisioning and activation review |
| Stale backup replay | Real isolated PostgreSQL18 dump/restore and two replays passed | Join real authenticated API, real DB and independent storage in one isolated deployed run |
| Authenticated path | Synthetic signed JWT through actual loopback HTTP API/writer, scoped PGlite stores and Python replay passed | Live Clerk-issued session and isolated real infrastructure; local tests do not close this gate |
| Recovery key custody | Real age synthetic seal/verify/recover and tamper rejection passed | Owner-managed custody location, separate identity/integrity-pin custody and actual retrieval; no production key created |
| Production saving | API has no plan/settings/protection configuration names; writers not activated | Explicit activation only after all preceding gates; do not call saving operational |

Read-only infrastructure recheck: API7108edd6 remains pinned bb45d9d0 and SLEEPING;
no plan/settings/protection variables are listed. This is configuration evidence,
not a database privilege query. Writer9d9728c1 retains deployment4892f476 and actual
RESOLUTE_WRITER_DISABLED log. Restore acceptance058b8f14 retains deploymenta2305d23
and actual RESOLUTE_RESTORE_ACCEPTANCE_DISABLED log. All three report no staged
changes. No credentials were read or changed in this recheck.

Morning service006aea7e remains pinned693c170b, cron0 22 * * 0-4, deployment93dc0258.
The October20 07:00 JST execution is still in the future at this check; its actual
logs AND saved results remain pending. No schedule or reservation was modified.

### Ordered completion work (no more substitute local-only tests)

1. Establish owner-controlled recovery custody: identify the actual capsule,
   recovery identity and integrity-pin locations; demonstrate retrieval with a
   disposable capsule first. Do not generate/install a production protection key
   before this is established. Ask only for the storage choice, not a key/token.
2. Prepare one isolated deployed acceptance flow using the existing tested
   components, separate synthetic database/namespace and a live authorized Clerk
   session. Readiness must explicitly prohibit production DB credentials, mail,
   payments and AI calls. Use a real dump created before deletion/OFF; verify
   old state, independent receipts, first replay and second replay. Return the
   disposable services to disabled state and inspect the actual disabled logs.
3. Review the production migration/ACL and recovery cutover package. Confirm an
   independently complete fenced checkpoint and custody retrieval before any
   schema application that makes restore require those inputs. Production save
   activation is a separate decision, never implied by acceptance SUCCESS.

Planning estimate for these remaining recovery-protection tasks, once custody
and authentication are available: roughly2–4 hours, not a guaranteed completion
or estimate for the whole product launch. Missing access/owner custody decisions,
provider failures and new defects may extend this. Purchases on a real mobile
browser, live sales readiness and the scheduled morning check are separate gates.

## Preserved constraints

Work only on codex/research-preview; main untouched. RIZEL's90 approved Japanese/
English items remain hidden from ordinary screens pending publication approval.
No live payment activation, actual charge, mail, extra AI calls or billing changes.
Twelve Data is not contracted (planned mid-November). Preserve approved navy/gold
UI, copy and star animation. Preserve the 7AM job and confirmation reservation;
October20 morning execution still requires actual log and saved-result checks.

## Evidence carried forward

- d445d16323fb6fc7f0802568f8e42f62a0c6918c is the recovered branch base.
  GitHub Actions run39243536669 completed successfully, rechecked October19.
- Independent synthetic protection-object and isolated PostgreSQL18 restore
  acceptance previously passed on deployment594765aa-cc2c-4718-9e77-5b622e8305cd.
- Protected restore deployment1c8654a4-7e53-4b90-ad82-1161c3a727dd logged actual
  RESOLUTE_RESTORE_OK with data_protection=not_installed: existing payment restore
  passed, but production plan/settings protection replay was NOT demonstrated.
- Migrations017–019 and plan/settings schema activation remain unapplied.
  Plan/settings roles remain NOLOGIN; runtime saving is NOT active.
- Payment purchase screen/API/ledger and entitlement read preparation exist;
  production sales/connection remain disabled. Smartphone real-browser purchase
  verification remains open after the earlier browser installation failure.

## Stable infrastructure references

Railway project0872be15-db75-4e5a-ae0f-881911fb442d,
environment3a80776d-15a3-4ca1-bd0c-e0c915ccf73b,
morning service006aea7e-072b-475c-ad88-3adb41ae42f4.
No current-turn change to these services, schedules or reservations.

## Current continuation

Offline age key escrow now has readback/decrypt checks and exclusive private
output; see RESOLUTE-KEY-ESCROW.md. Synthetic verification does not establish
production custody. Remaining blockers: non-delete protection-writer permission
boundary, independent key custody/readback, production isolated replay and final
storage activation review. Continue these before enabling saves or notification
settings. Keep secrets out of this git-backed reconstruction.

### Isolated writer continuation

Prepared a separate encrypted-event PUT/GET writer and removed direct S3 access
from application/retry runtime. See RESOLUTE-PROTECTION-WRITER.md. No deployment
or credential provisioning was performed; local synthetic HTTP acceptance alone
is not proof of production isolation or provider-enforced retention.

### Actual isolated writer acceptance

Dedicated writer/bucket and a separate probe were installed for synthetic data.
Actual HTTPS/S3 acceptance passed with a recovered synthetic key; deployment/log
IDs and limitations are in RESOLUTE-PROTECTION-DEPLOYMENT.md. Both new services
are disabled afterward and test keys/tokens cleared. Production saving is still
off; independent production custody and DB-to-restore acceptance remain open.

### Restore acceptance evidence strengthened

Synthetic acceptance now rejects inherited PostgreSQL and database connection
variables before loading clients or starting processes. It verifies the restored
stale fixture (plan present, both notifications ON, one pending item) before
replay, then verifies deletion/OFF/empty queue after EACH of two replays. This
prevents an already-clean fixture or a repair only on the second replay from
being reported as successful first-pass recovery. Regression tests cover partial
replay, stale fixture absence and credential variants. This revised harness has
not yet been rerun in Railway; earlier deployment evidence remains for its
original revision. No production key, DB, service or schedule was changed.

### Strengthened harness actual run completed

The previously pending real run now passed with synthetic data in a dedicated
unscheduled service. Stale dump state and each of two replays were verified in
actual PostgreSQL18; independent encrypted storage readback and all three
conditional-write refusals passed. The launcher PATH initialization failure was
corrected without changing the tested module bundle or assertions. The service
was then disabled and bucket references cleared; actual DISABLED log confirmed.
See RESOLUTE-RESTORE-ACCEPTANCE.md for IDs, evidence and limitations. Production
key custody and authenticated customer API-to-restore acceptance remain open.

### Live owner authentication and inactive recovery transport

Live preview owner sign-in and read-only entitlements succeeded; no RESOLUTE
purchase grants were present. Plan/settings remained unavailable. Prepared an
owner-only, time-limited recovery-check forwarding route, disabled by default.
No environment variables, production keys, migrations, services or schedules
were changed. The dedicated runner and complete authenticated real-PG/S3 recovery
acceptance remain pending; transport unit tests must not be reported as that
acceptance. See RESOLUTE-AUTHENTICATED-RECOVERY-FLOW.md and CURRENT-HANDOFF.md.

### Recovery coordinator prepared; actual execution still pending

The isolated-side authenticated coordinator now enforces exact owner identity,
UUID-only requests, expiration, and one execution per private sandbox permit.
It rejects incomplete evidence and does not retry failed/uncertain runs. It has
no runnable entrypoint or real executor yet. Production remains disabled; the
remaining integration is the fixed real PostgreSQL/API/writer acceptance adapter,
followed by actual logs and saved-result verification. See the recovery service
README. Existing morning job and reservations were not touched.

## 2026-10-20 — Confirmed subscription plan and publication-date guard

Stock News API is uncontracted, planned for mid-November (owner reconfirmed).
Twelve Data is separately uncontracted with the same planned timing. Do not ask
again or enable paid intake now. Today-only RESOLUTE selection replaces96h with
explicit publication timestamps in the current JST day, never acquisition dates.
Date-only/previous-day/future articles stay out; the scheduled job remains unchanged.
Validation and deployment evidence will follow; no live verification claimed here.


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
