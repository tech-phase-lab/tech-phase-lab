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

## 2026-10-20 14:03 JST — Production store preparation and read-only preflight

Created a separate production-history bucket resolute-protection-live
(ae4437b5-24f9-43dd-9fe0-475676821f1b, sjc;
S3 name resolute-protection-live-vpdsti). Existing synthetic protection objects
remain in resolute-protection, unchanged. Backup bucket remains separate.
No provider object lock/versioning/non-delete credential guarantee is claimed.

Prepared five bucket-variable references on the disabled protection writer
(RESOLUTE_WRITER_*), and five RESOLUTE_RESTORE_PROTECTION_* references on
restore-check. Both used skipDeploys=true: stored configuration is ready, but
these connections are NOT claimed loaded by the existing runtime. Writer
ENABLED=false; no production key/token installed and no customer-save activation.

Reused the retired protection-acceptance one-shot function for a bounded
read-only preflight, with the existing API reader URL and temporary new-bucket
references. No admin DB credentials used. Deployment
53810a91-3d09-41f8-ba79-e1b243e47dc5 actually logged
RESOLUTE_STORAGE_PREFLIGHT_OK at2026-10-20T05:02:14.561884781Z:
current database/role/transaction checked as resolute/resolute_api_reader/read-only;
plans, notification_settings and protection_outbox absent; both pre-existing
plan/notification roles NOLOGIN and without elevated role attributes;
all three writer identities had0 pg_stat_activity sessions; whole bucket
ListObjectsV2(MaxKeys=1) returned no objects and no truncation. Writes0.
This is a point-in-time observation, NOT a durable write fence, ACL audit,
complete recovery manifest, production-key replay, or customer-saving acceptance.

After inspection, replaced the function with an idle no-I/O body and blanked
all six temporary DB/storage references. Final deployment
94c52848-29b6-452d-b7af-80a5df086f9c actually logged
RESOLUTE_STORAGE_PREFLIGHT_IDLE, reads0/writes0 at05:02:50.103278093Z.
No cron or public domain added. Previous synthetic acceptance remains historical.

Remaining owner-only prerequisite: install the ALREADY GENERATED 32-byte online
protection key into the disabled writer's RESOLUTE_WRITER_KEY_HEX using the
owner's PC and Railway's private Variables UI. Do not install the AGE-SECRET-KEY
recovery identity, regenerate custody material, upload any secret to chat, or
repeat Google/Evernote verification. The assistant cannot retrieve the PC-only
key. Keep ENABLED=false. Downstream key references, token provisioning, manifest
fencing and migrations/ACLs must be completed before explicit save activation.
Morning/daily/weekly schedules, main, live payments, mail and AI untouched.

## 2026-10-20 14:11–14:18 JST — Owner key installed; runtime checks and migration rehearsal

Owner reported completing the private WSL-to-Railway copy into the disabled
writer's RESOLUTE_WRITER_KEY_HEX. No key/age identity was read into chat.
Actual deployment87a06fc6-695f-41b9-aafb-f03e5dd943f8 logged
RESOLUTE_PRODUCTION_KEY_RUNTIME_OK at05:12:11.000843832Z:64-hex key loaded,
AES-GCM memory round trip passed, writerDisabled=true, DB/storage writes0.
Non-secret fingerprint697d2470b736420ac32ff258e9c17f7939b82da4cfa0a44f75856ee72e395de6.
This runtime fingerprint was not independently compared by the assistant with
Google's notes; owner-side copy command checked the previously verified pins.
Writer deploymentef0a1382-2304-409c-807f-d1399b376136 actually logged
RESOLUTE_WRITER_DISABLED at05:12:24.998591597Z. Module-type warning is nonfatal.

Initialized the empty production manifest only while the writer was disabled,
application storage tables absent, both existing writer roles NOLOGIN and with
no elevated attributes, and writer sessions0. These catalog checks ran before
and after the bounded S3 operation. Whole bucket inventory allowed only the
expected manifest on retry, no event/other objects. Conditional PUT prevented
replacement; exact GET readback and post-inventory passed. This operational
bootstrap fence relies on absent application schemas and stopped known writers;
it is not provider object lock or a reusable concurrent-live-write fence.
Canonical bytes match protection_events.seal_manifest empty serialization:
{"objects":[],"version":1}
SHA2563ccbe11b60a4fa4f0d024f7c22cba06b70ca3ff7d9eead4c8a3a5aa4ca8d2b73.
Deployment6b51220a-25e4-4d12-a307-63ba7bdf61ea logged
RESOLUTE_INITIAL_MANIFEST_OK at05:13:36.817215270Z, events0, bootstrapOnly=true.
The pin is retained here outside the DB dump.

Restore key now references the writer's online key; restore manifest pin is set.
A GET-only probe using references THROUGH restore-check configuration matched
the writer fingerprint and authenticated the pinned manifest bytes:
deploymentd0d59a1a-b313-4144-9b75-6110f52e6f3f logged
RESOLUTE_RESTORE_CONNECTION_OK at05:15:17.208177859Z; writes0/events0.
This checks rendered restore credentials, key equality and manifest readback.
It is NOT a new Python pg_restore run or a non-empty production-event replay.
Existing successful V2 full restore remains the earlier13:51 execution.
Forced a fresh restore configuration deployment using
RESOLUTE_STORAGE_CONFIG_REV=20261020-production-bootstrap-v1; cron unchanged.
Check the latest deployment/runtime before claiming this configuration executed.

Rehearsed002–005/017–019 plus the existing verifyStoragePermissions catalog audit
in one real production DB transaction, with advisory lock, bounded statement/
lock/idle timeouts and mandatory ROLLBACK (no COMMIT). Existing016 prerequisites
were retained. Initial attempt764675f7 stopped before DB connection because the
retired SETUP URL was blank; no SQL ran. Corrected using a temporary Postgres URL
reference constrained to the internal host and /resolute, with redacted errors.
Deploymentb83651af-7455-4eba-8575-81f443b10fed logged
RESOLUTE_STORAGE_MIGRATION_REHEARSAL_OK at05:16:05.054196096Z:
migrations7, rolesVerified3, loginsEnabled=false, rawPaymentAccess=false,
deliveryAccess=false, rolledBack=true, persistedChanges0, activation=false.
Post-rollback checks confirmed new storage tables and third writer role absent.
This validates the migration sequence against the actual existing catalog;
production schemas/ACLs are NOT installed.

Cleanup verified by real idle logs:
- probe c9c6a6e0-9617-49b4-8b1c-d1b54360c966 at05:16:11.933550092Z;
  all nine temporary DB/key/storage/pin/flag references blanked.
- provision6ad4a6c6-4a49-4cd8-8e2a-33b90289d47f at05:16:58.784232949Z;
  temporary admin URL blanked. Both read/write counts0, no scheduled work.

Next: package daily backup dependencies, finish controlled schema/ACL cutover and
actual post-cutover backup/restore acceptance. BEFORE any customer-save/writer
activation, replace or invalidate this EMPTY BOOTSTRAP pin and establish the
fresh, complete write-fenced manifest procedure; never retain an empty pin as
evidence of complete history after writes begin. Customer saving, retry/delivery,
live payments and AI remain off. No morning/daily/weekly cron or reservations
changed. No further owner key/custody step needed for this milestone.

Restore configuration deployment2322edf1-fc79-498b-b1f2-69a1f570d349 reached SUCCESS at14:18 JST observation, cron0 0 * * 1 unchanged, no staged changes. No new cron execution claimed.

## 2026-10-20 14:20–14:29 JST — Storage schema committed and real post-cutover restore passed

Updated daily backup04440b43 to the same checked c792d51d three-module bundle;
backup-only launcher SHA256ad00b01f3c3d4726d37f01a9b3fdefb94f0691db75820e8f9316a76bf41b3640.
All three embedded modules exactly matched checked repository sources and compiled.
New variable RESOLUTE_PROTECTED_JOB_V2_B64; old job retained. Added cryptography
package to startup dependencies. Daily cron0 0 * * * unchanged.
Configuration deployment93fa80cb-a1c2-4e26-8e14-38f90b6a9f7c SUCCESS.
Actual one-shot execution of the SAME daily payload used temporary service
db300300-b491-44d5-b34a-a0f770626096 (no cron/domain/volume,0.5CPU/0.5GB,NEVER):
pre-cutover deployment7bea8912-9b95-48d7-ae4d-57951b564d9a logged
RESOLUTE_BACKUP_OK at05:22:22.983922558Z,69247 encrypted bytes/69031 dump bytes,
retained8,1.635s. Monitor ping deliberately disabled in test jobs.

Retained a checksum-verified pre-schema dump outside normal daily retention:
resolute/cutover/20261020-pre-storage/20261020T052217058456Z.dump.age
(and .json metadata), SHA256035439b63a197690678885c9eae774df231cc0516c67805ecda31c5e80ee77d0.
Same-day regular backup retention keeps the latest daily dump, so this separate
copy is intentional. Deployment1807047f-c783-4dad-b1e0-9370eaf054e8 logged
RESOLUTE_PRE_CUTOVER_BACKUP_RETAINED at05:23:13.832065823Z after exact readback.

Applied the previously rehearsed002–005/017–019 sequence atomically, with the
same catalog audit before COMMIT, then a second audit after COMMIT. Existing016
was NOT rerun. Scope internal Postgres/resolute only; guarded by absent storage
tables, dormant existing roles, no writer sessions, disabled writer flag and
expected bootstrap pin; bounded lock/statement/idle timeouts and advisory lock.
Deployment726fe709-5fbd-4d19-a760-a7e26c3cd1b7 logged
RESOLUTE_STORAGE_SCHEMA_PREPARED at05:23:55.607325433Z:
migrations7,rolesVerified3,loginsEnabled=false,rawPaymentAccess=false,
deliveryAccess=false,committed=true,activation=false;
plans/settings/protection/delivery counts all0.
This supersedes earlier statements that the schemas and permissions were absent.
No writer login, API save capability, retry worker or notification delivery enabled.

Post-schema actual backup63acb54a-bd7e-462f-a087-20fc0e1a24ea passed
at05:24:52.991172122Z:84933 encrypted bytes/84717 dump bytes,retained8,1.338s.
Both actual backup runs logged the expected c792d51d bundle marker and SHA256
0d3c10c14440ede9be4bc862a90fcd991c2d59a2386f7bf9034d9fd01215424d.

Two attempts to reuse that source-backup service for restore stopped SAFELY
before restore at backup.py:229: production connection variables remained nonempty.
Deployment591e01ad failed; diagnostic8ff18ffb identified the guard without exposing
values, arguments, stderr or row data. A no-I/O shell check36ee6dfd confirmed
PGHOST and PGPASSWORD were nonempty despite the prior empty-string updates.
Do NOT infer that set_variables(value="") removes/neutralizes a reference.
Earlier "blanked" claims mean an update was requested, not verified credential
retirement. Never bypass the restore guard or silently pop production variables.

Created a separate restore-only temporary service
be5c0abe-3fe8-4991-ac27-bcbc1426a953, which NEVER received production DB credentials;
no cron/domain/volume, same limits/restart policy. Uses the unmodified verified
restore launcher and references restore-check's backup key/storage/online key/pin.
RESOLUTE_REQUIRE_PROTECTION=true and RESOLUTE_REQUIRE_LIVE_LEDGER=true.
Deploymentc9a74bcd-6f47-4fb1-be76-36ab483a93da actually logged RESOLUTE_RESTORE_OK
at05:28:53.932496508Z:84933 bytes,probe_rows2, Sandbox orders11/grants7/events8/
audit32/alert_outbox7, live ledger verified with all five counts0;
data_protection={state:verified,source:independent_online_manifest,deletions:0,
suppressions:0}; download/decrypt/checksums/pg_restore/probe/PK/both payment
integrities passed,5.727s,monitor_ping_sent=false.
This is a REAL post-schema restore and independent-manifest replay of the empty
production baseline. It is not a non-empty customer-deletion event acceptance.
Earlier non-empty isolated replay acceptance remains separate evidence.
Weekly restore also now explicitly requires protection; schedule unchanged.

Cleanup correction: temporary function references are replaced with literal
DISABLED (not empty), followed by runtime checks allowing only absent/DISABLED.
Provisionc988eb2e-16de-4e36-a13c-2f181b05f7e3 logged temporaryReferencesNeutralized
true,checked3,reads0/writes0 at05:28:54.264126221Z.
The storage probe checks14 temporary backup/DB/key/pin/flag references similarly.
Temporary backup/restore-only service retirement is recorded below after completion.

Remaining activation gates: latest complete manifest must be rebuilt under a
real write fence after any writes; the empty BOOTSTRAP pin must never be reused
as evidence for future history. Configure/verify isolated writer token, receipt
retry and final API/save activation separately. No user action needed for this
cutover milestone. No morning schedule/reservation, UI/RIZEL visibility, main,
live payment, email, billing setting or additional AI call changed.

Final cleanup/readback14:33 JST: both temporary services db300300 and be5c0abe
were deleted from this environment; no attached volumes. Environment inventory
confirms they are absent and has no staged patch. Exact pre/post/restore results
above were recorded before deletion. Existing helper functions remain idle.
Storage probe730b8062-4fad-4a43-a33d-b74f03c55a0b actually logged
RESOLUTE_STORAGE_PREFLIGHT_IDLE at05:32:38.761696263Z with
 temporaryReferencesNeutralized=true,checked14,reads0,writes0.
An earlier cleanup deployment4e623bb3 exposed only Starting Container; it was
not counted as verification. A new non-secret revision variable forced a fresh
execution, and its explicit runtime check supplied the evidence.
Weekly restore configea3e6818-0d75-47bf-a570-b13ff8d1af62 SUCCESS, protection
required, weekly cron unchanged; its scheduled execution is not claimed.
Morning b43e335e/cron0 22 * * 0-4, API5e22dac8 sleeping, writer ef0a1382
unchanged. Daily cron0 0 * * * and weekly0 0 * * 1 both unchanged.
This turn changed infrastructure and operation records only; no application code
or dependencies changed. Prior checked code reused; diff check passed. Coworker
commit2a78993d fast-forwarded and preserved without editing its PRO/UI work.

## 2026-10-20 — Restore freshness and retry queue hardening

The production restore entry point now requires a complete event-prefix LIST
before reading the pinned manifest's events and another LIST after authenticated
reads. The manifest's event names must exactly equal the inventory and the
inventory (including size/ETag) must stay unchanged. An authentic old empty
bootstrap manifest therefore fails once any event appears. Missing LIST access
also fails closed; the application/writer permissions are not broadened.
GET-only load_manifest remains available for already-isolated pinned inputs,
but backup.load_online_protection always requests the complete inventory check.
This does NOT replace fencing all writers before real recovery or sealing a new
manifest. An event can arrive after the final observation unless writes are stopped.
No user-save activation is authorized by these checks alone.

Retry batches now report whole-queue pending and dueRemaining event counts,
including users outside the per-batch limit and delayed backoff entries. CLI
completion exits nonzero while pending remains, even if every selected user
succeeded. Counts are not user identifiers. No scheduler/login/retry service was
activated. A real SQL fixture covers a successful limited batch followed by a
delayed-only queue. Cryptographic tests cover stale empty manifests, inventory
changes during reading, complete replay and unavailable LIST permission.

Validation and deployment evidence follow below when completed.

Full gates: Node1236/Python2523 passed (3759 total), lint0 errors/5 existing warnings, build/compileall/diff check passed. Stale generated build cache was preserved outside the repository and build repeated successfully. Runtime verification follows separately.


## 2026-10-20 14:53 JST — complete inventory runtime accepted

Code commit fafde179fec86ae861469591e0c2839b64b92e4e rejects incomplete or
changing live protection inventories and reports whole retry queue backlog.
Three-module bundle SHA256:
730cf53f6408a171539a4a899d1dc092941acb5fa44f018ce9e338550af032de.

Fresh restore-only service4e993fbe-e5d6-49a8-93ab-e805282f740c was never given
production DB connection variables. Deploymentf70b1204-0a1e-40ac-a61a-e8925fd8092f
logged the matching RESOLUTE_PROTECTED_BUNDLE_READY and RESOLUTE_RESTORE_OK at
2026-10-20T05:51:24.351987561Z. Encrypted bytes84933, probe_rows2; Sandbox
orders11/grants7/events8/audit32/alert_outbox7; live ledger verified with all five
counts0; data_protection verified, source independent_online_manifest,
deletions0/suppressions0; download/decrypt/checksums/pg_restore/probe/primary-key/
Sandbox/live payment integrity passed,2.591s,monitor_ping_sent=false.
This proves the stricter GET+LIST runtime works against the actual empty baseline;
it does not claim nonempty production deletion acceptance. Writers still must
be fenced and the complete manifest resealed before recovery after writes begin.

Daily backup deployment89161667-8504-498e-b417-b00f8af18a7c and weekly restore
f0f20b52-cc18-4367-b127-b910bf280533 now select RESOLUTE_PROTECTED_JOB_V3_B64.
Previous V2 payloads retained for rollback. Both config deployments SUCCESS;
this is not evidence of a scheduled V3 execution. Daily0 0 * * *,weekly0 0 * * 1,
morning0 22 * * 0-4 unchanged. Morning service not modified.
The fresh verification service was deleted after evidence capture; no volumes.
Customer saving, role logins, writer and retry scheduling remain disabled.
No payments, email, AI calls, key regeneration or owner Run now required.

Local code gates passed3759 tests (Node1236/Python2523),lint/build/compileall.
CI39376987144 was cancelled by the next branch push, not reported as passed.
Coworker af8af671/d10c04f8 changes fast-forward integrated; final combined gates
and successor CI are being verified separately.

Final combined d10c04f8 gates: Node1237/Python2523 (3760 total) passed;
lint0 errors/5 existing warnings, build, compileall and diff check passed.
Deployed three-module payload verified byte-for-byte against integrated source.


2026-10-20 15:11 JST actual read-only production readiness passed:
deployment445bb4fa-51ce-44c5-9185-2e431986d0f3 logged
RESOLUTE_STORAGE_READINESS at2026-10-20T06:11:34.131154785Z.
rolesVerified3,loginsEnabled=false,rawPaymentAccess=false,deliveryAccess=false,
activeScopedSessions0,pendingProtection0,dueProtection0,dormantChecksPassed=true.
recoveryFenceVerified=false and activation=false intentionally remain explicit.
The dedicated one-shot service8ab66cf5-afab-4c09-bf65-61c16d707f85 used the
reviewed read-only transaction and the source ACL audit, with no public domain,
cron or volume. It was deleted after the evidence was captured. No application
credentials, role attributes, stored customer data or existing schedules changed.

Final readiness gates: Node1239/1239 (89.614s), Python2523/2523
(376.676s), total3762 passed. Lint0 errors/5 existing warnings; build,
compileall and diff check passed. Node rerun completed with no additional
OOM kills (counter stayed9). No test skipped or removed.

Coworker accf4368 arrived during publication; ref update did not overwrite it.
Integrated PRO checkout changes and repeated all gates: Node1245/Python2523
(total3768) passed, lint0 errors/5 existing warnings, build/compileall/diff check
passed. Sequential heavy gates avoided further OOM kills.


## 2026-10-20 15:34 JST — dormant gateway configuration prepared

CI39379931568 for163a2e5c completed SUCCESS. No application source changed in
this operation; the previous integrated3768 tests/build remain its code gates.

The existing writer token failed the production format check (not sealed);
provisioned a fresh48-random-byte base64url service-authentication token on
resolute-protection-writer, skipDeploys=true. It is NOT a recovery/encryption key.
The owner-installed encryption key and Google/Evernote custody were unchanged.
Initial probe used raw SHA256 for the key comparison by mistake; corrected it
to the existing protection_keys.fingerprint formula with
resolute-online-protection-key-v1 + NUL + key bytes. Corrected runtime confirmed
the previous installed-key fingerprint. This is continuity with earlier runtime
evidence, not a new independent read of the owner's offline custody files.

Writer-only confirmationd490af66-2f9b-41a9-83ce-6a341eefa95e at06:33:23Z passed.
API now has RESOLUTE_PROTECTION_ENABLED=false, fixed writer HTTPS URL, and token/
key references to the writer service. API receives NO bucket credentials and NO
plan/settings/protection DB login. All four variables were set skipDeploys=true;
API deployment5e22dac8 and source pinbb45d9d0 remained unchanged. Writer remains
ENABLED=false, deploymentef0a1382/source4b3bdd8e unchanged. No API/writer restart.

One-shot verificationea42bc94-8f01-4f7a-b010-521acbe64d8a logged
RESOLUTE_CONNECTION_CONFIG_VERIFIED at2026-10-20T06:33:55.282118957Z:
tokenValid=true,ownerKeyMatches=true,writerDisabled=true,
applicationReferencesChecked=true,networkCalls0,writes0,activation=false.
This checks Railway's rendered reference equality, format, fixed URL, disabled
flags and installed-key continuity. It does NOT prove API runtime adoption,
HTTPS reachability, a writer receipt, customer saving or recovery fencing.
The legacy SYNTHETIC_ONLY variable is not used by the pinned writer code; do not
rely on it as an isolation boundary. Actual safety here is disabled writer/API,
NOLOGIN storage roles, no storage DB credentials and no data writes.

Temporary verification servicec2190fbd-8371-45e0-beaf-6ece8e423b8f was deleted
with no volumes after evidence capture. Its token/key references are removed
with the service, not blanked. No secrets were printed to logs or committed.
Schedules/reservations, UI/RIZEL visibility, production payments, mail and AI
were untouched. Next: reviewed API/runtime and scoped storage connections,
controlled receipt/recovery verification before customer-save activation.
No repeat owner key-custody, token paste or Run now is needed for this milestone.
