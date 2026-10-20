# RESOLUTE launch readiness — reconstructed record

Reconstructed 2026-10-19 after workspace maintenance removed the former scratch
checkout and the uncommitted operational record. This is NOT the recovered
original and is not a complete historical log. Evidence below comes from the
conversation handoff and committed project records; unverified items stay open.

## Latest decision point — 2026-10-20 13:13 JST

Owner-reported production recovery custody/readback is now complete. Fresh keys
were prepared on the owner's WSL Ubuntu device, not in the chat workspace.
Google-retrieved identity and pins matched the originals; the Evernote-downloaded
capsule matched byte-for-byte; authenticated recovery and key fingerprint checks
then returned RESOLUTE_CUSTODY_VERIFIED. See RESOLUTE-KEY-ESCROW.md for the precise
evidence boundary and the earlier unresolved temporary-verifier failure.
No production secret was received by the assistant or installed into a service.
Production saving remains disabled. Next: prepare the backup/restore manifest
and key provisioning path before applying production schemas/ACLs; schema
installation alone would make protected restore require independent inputs.

## Previous decision point — 2026-10-20 11:59 JST

Supersedes the dated status below. Code fafbf53c: Node1193/Python2508 (3701),
lint/build/compileall/diff passed. Actual isolated authenticated synthetic-session
API -> PostgreSQL18 -> encrypted external storage -> stale dump/restore -> two
replays passed all nine checks at11:30 JST. See authenticated recovery flow doc.
The test service was disabled and all five storage references cleared; actual
DISABLED log verified at11:32 JST. The subsequent live Clerk owner-session run
also passed at11:53 JST and was retired by11:59 JST (evidence at end of record).
Production recovery-key custody remains open; production saving remains disabled.

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

## 2026-10-20 — Operator-local key preparation implemented

Added protection_keys.py prepare: fresh native age identity plus random 32-byte
key, authenticated local round trip, separate Google identity/pins and Evernote
capsule, no plaintext online key file, exclusive private directory, redacted
errors and partial-output cleanup. The final marker explicitly says remote
custody is unverified and activation is false. Existing directories/symlinks are
never overwritten. Owner-only POSIX parent required; native Windows fails closed
because chmod does not establish ACLs. WSL Linux home is documented but has not
been tested here. See RESOLUTE-KEY-ESCROW.md for exact commands and destinations.

All 18 escrow tests passed, including seven new preparation regressions. Actual
age1.3.2 disposable prepare/verify, wrong identity, tampering, repeat execution
and permission checks passed; disposable secrets removed. No production key was
created or installed. Google/Evernote production custody/readback remains an
owner operation; the earlier disposable rehearsal does not close that gate.
No service, domain, environment flag, DB privilege/schema, mail, payment, AI,
cron or reservation was changed by this work.

Final integrated local gates on base9035f632: Node1198/1198, Python2515/2515
(254.752s), lint0 errors/5 existing warnings, Next build, compileall and diff
check passed. Owner-facing Japanese instructions: RESOLUTE-KEY-CUSTODY-OWNER.md.


## 2026-10-20 — Separate online-history reads from DB dump storage

Found and fixed a cutover blocker in scripts/resolute/backup.py: online manifest
recovery was using the DB dump S3 client/bucket despite the isolated writer's
separate history bucket. Online recovery now requires the five explicit
RESOLUTE_RESTORE_PROTECTION_* connection settings and independently pinned
key/manifest, rejects the dump bucket and unsafe endpoint forms, and never falls
back to dump credentials. The legacy checkpoint path is unchanged. No production
key was read, no schema/grants/flags were changed and no service was deployed.

New regression coverage decrypts an actual synthetic AES-GCM event through the
manifest loader, verifies independent GETs only, and rejects missing config,
invalid pins, tampering, missing history and unsafe/same-store configuration.
See RESOLUTE-STORAGE-CUTOVER.md for read-only Railway evidence, payload packaging
check and ordered production steps. The actual new provider read path remains
unverified; production saving stays disabled. Owner custody remains completed,
not a reason to request another key or repeat the owner setup.

Final integrated local validation on base86a329d4: Node1207/1207, Python2520/2520 (278.110s), lint0 errors/5 existing warnings, Next build, compileall and diff check passed. No production deployment or new live recovery pass is claimed.


## 2026-10-20 13:26–13:29 JST — Restore V2 deployed, execution still unverified

Installed the c792d51d three-module bundle in restore-check service
c0eec3c0-cdd2-47da-bd48-fef21e30934b as new
RESOLUTE_PROTECTED_JOB_V2_B64; retained both older job variables. Changed only
startCommand to select V2, then redeployed3aaa54dc-91e4-40db-8547-7f19fc77a99a.
The launcher requires restore mode, verifies bundle digest and exact module set,
compiles/extracts the three files, runs backup.py and removes the temporary files.
Local extraction/source equality/cleanup checks passed. Bundle SHA256 remains
0d3c10c14440ede9be4bc862a90fcd991c2d59a2386f7bf9034d9fd01215424d;
launcher SHA256 df78d35f2309dab2161f82c8145ae9c0a59f16e99c41957825d876f24e8f382f.

Readback: deployment SUCCESS, state cronReady, no staged changes, domains or
volumes; weekly cron remains0 0 * * 1. No runtime result was returned by bounded
log reads, including an explicit time window. One restart also left cronReady
with no execution result. Therefore neither an actual restore nor online-history
provider reads are claimed successful. Do not repeat deploy/restart to substitute
for a cron run. Official Railway docs distinguish railway cron run from redeploy;
the installed remote connector does not expose cron run, and this workspace has
no Railway CLI or token authentication. A dashboard manual Run or an authorized
browser fallback is still needed; never alter the schedule to force a run.

Morning service006aea7e was read back unchanged: pin20a3069e, deploymentb43e335e,
cron0 22 * * 0-4, no staged changes. No customer-save flag, production key,
DB schema/privilege, mail, payment, AI invocation or reservation changed.
GitHub CI39369328863: payment concurrency passed; main validation still running
at this observation. Do not report overall CI success yet.


## 2026-10-20 13:47–13:49 JST — Actual old-version restore passed; V2 redeployed

Owner clicked Run now. Deployment3aaa54dc's actual04:47:38Z structured logs
show RESOLUTE_RESTORE_OK:69247 encrypted bytes, probe_rows2, Sandbox
orders11/grants7/events8/audit32/alert_outbox7, live ledger verified with all
five counts0. Download/decryption/checksums/pg_restore/probe/PK/both payment
integrity checks passed in2.355s; monitor_ping_sent=true. Cron execution status
succeeded, no running replica afterward. data_protection=not_installed is
expected while application storage schemas are absent, not a protection pass.

Crucially, the same execution logged bundle commitdb418e7 and digest
aab5c9ca86efbf2bc1af5ca7cd6d25c783aee9a9cbc0499b41c4ae555bc3c151.
Thus the earlier c792 V2 deployment claim established configuration only:
redeploy reused the old execution configuration despite describe-service showing
the V2 start command. The actual run is NOT evidence of executing c792d51d.

Corrective operation: added a fixed c792d51d/bundle-digest marker to the V2
launcher, then set RESOLUTE_PROTECTED_JOB_V2_B64 with skipDeploys=false so a
fresh deployment is generated from current settings. New deployment
c6ef3efc-604c-4133-8a4d-91c319f5b0f0 reached SUCCESS at13:49 JST with V2 start
command and unchanged weekly cron; no staged changes. New launcher digest
259c9cadbb0811358ac9bee290bf32bf48a9c76cdf9af65e887cc0eb64224672.
Old variables retained. A fresh manual Run now is still required; verify the
c792d51d marker AND RESOLUTE_RESTORE_OK before accepting this deployment.
No runtime success for c6ef3efc is claimed yet. No production storage/key/DB
activation, schedule modification, mail, payment or AI call occurred.

GitHub CI39369328863 for c792d51d is now completed/success. Local3727 tests,
lint/build/compileall passed as previously recorded. Owner custody stays complete;
no need to repeat Google/Evernote setup or regenerate keys.


## 2026-10-20 13:54 JST observation — V2 actual restore verified

Owner reported pressing Run now; subsequent inspection found the completed V2
execution at13:51:43 JST (log time, not inferred from the report time).
Deploymentc6ef3efc-604c-4133-8a4d-91c319f5b0f0 logged both:
- RESOLUTE_PROTECTED_BUNDLE_READY: commitc792d51d06437a27748f03ee2714a8c23ce7409e,
  digest0d3c10c14440ede9be4bc862a90fcd991c2d59a2386f7bf9034d9fd01215424d,
  modules3, timestamp2026-10-20T04:51:43.084940930Z.
- RESOLUTE_RESTORE_OK at04:51:43.084946050Z:69247 encrypted bytes, probe_rows2,
  Sandbox orders11/grants7/events8/audit32/alert_outbox7; live ledger verified
  with all five counts0; download/decrypt/checksums/pg_restore/probe/primary-key/
  both payment-integrity assertions passed,2.67s, monitor_ping_sent=true.

Environment status confirms cronSucceeded, lastExecutionStatus=succeeded,
lastExecutionAt04:51:41.853Z, running replicas0, no pending work or recent
failures. This closes the pending V2 execution gate and the stale-build confusion.
Do not ask for another Run now or repeat owner key custody verification.

The result data_protection.state=not_installed correctly reflects the existing
backup without application storage schemas. This is NOT an actual production
online-history replay acceptance. Production protection key and independent
store connection provisioning, fenced complete manifest and schema/ACL cutover
remain pending; customer saving stays off. The successful synthetic live-Clerk
replay remains separate evidence. Existing daily/weekly/morning schedules and
reservations were not modified. The apt-utils debconf notice did not prevent
the verified execution. Main, billing, live payments, email and AI were untouched.
