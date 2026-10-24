# Source recovery runtime drill — 2026-10-23 JST

## Scope and evidence chain

Archived source: `80ced07153eac0eddac060ebd3b2dcd82a3d06b3`.
Expected tree: `a5567a7c40b984806be2e21de838f4c20a80a2df`.
The previous R2 run39822227387 verified encrypted upload, complete readback,
authenticated decryption and exact Git restoration; see
[LATEST-SOURCE-BACKUP-2026-10-23.md](LATEST-SOURCE-BACKUP-2026-10-23.md).

This drill did NOT retrieve the R2 object again. It rebuilt a local full-history
bundle from the identical pinned commit using prepare_source_recovery.py, cloned
that bundle into a separate directory, and verified the same commit/tree and a
clean tracked worktree. It contained1660 tracked files and206 configuration names.
No production environment files or keys were copied. Existing installed,
lockfile-compatible dependencies were copied separately; this is NOT a clean
internet-free dependency installation or proof that dependencies are archived.

Current development branch includes coworker PR175 (509c2a90), which is newer than
this archived version. It was preserved; runtime findings apply to80ced071 only.

## Build findings and bounded workaround

- A node_modules symlink outside the restored root failed Turbopack's filesystem
  boundary check. Copying the dependency directory resolved that setup issue.
- Default build without internet access failed fetching Geist/Geist Mono from
  Google Fonts. The source archive alone cannot guarantee an offline rebuild.
- For the drill only, NEXT_FONT_GOOGLE_MOCKED_RESPONSES supplied CSS referencing
  the existing Next16.2.4 devtools Geist/Geist Mono Latin WOFF2 files. Turbopack
  could not resolve these mocked local font URLs. `npm run build -- --webpack`
  with the same fixture succeeded, including TypeScript and static generation.
- No tracked application, approved wording, colors, animation, or font
  configuration was edited. This is a diagnostic build, NOT release validation
  of the default Turbopack pipeline or browser visual equivalence.
- The build/start subprocess received an allowlisted environment with no provider
  credentials and NEXT_TELEMETRY_DISABLED=1. A temporary Node preloader rejected
  non-loopback fetch/socket connections. This is a Node-level guard, not a claim
  of operating-system isolation for every native dependency. The sandbox network
  policy remained in place. No production service was contacted by the drill.

## Production-mode local HTTP acceptance

`next start --hostname 127.0.0.1 --port 3188` became ready. The HTTP client ran in
the same execution sandbox as the server; separate exec calls have separate
network namespaces. Both were stopped at completion. No public service created.

| Request | Observed result |
| --- | --- |
| GET /research | 200, HTML returned |
| GET /resolute | 200, HTML returned |
| GET /research/news | 200, HTML returned |
| GET /api/research/news | 503, ok=false, enabled=false, empty items, no-store |
| GET /api/research/freshness | 200, status=unreachable, no-store; ok=true is endpoint response validity, not feed health |
| GET and PUT /api/resolute/plan | 503 PLAN_UNAVAILABLE, private/no-store |
| PUT /api/resolute/notification-settings | 503 NOTIFICATION_UNAVAILABLE, private/no-store |
| POST /api/research/saved | 503 ok=false, private/no-store |
| POST /api/research/favorites | 503 ok=false, private/no-store |
| GET /api/resolute/rizel-preview | 503 empty object, private/no-store |

Write probes used empty synthetic JSON and matching Host/Origin localhost:3188,
so rejection was not merely an Origin mismatch. An earlier mismatched-Origin
probe returned403. No DB credentials or membership credentials were present.
These checks establish unavailable-state rejection, not authenticated successful
saving. RIZEL private content remained unavailable.

## Remaining acceptance

- Default offline build needs an approved reproducible font/dependency strategy;
  the diagnostic font fixture is not a production change.
- Browser hydration, actual font rendering and Clerk-authenticated read/write
  flows were not exercised by these HTTP probes.
- No live DB was restored. Railway access is still required to obtain research
  SQLite, RESOLUTE PostgreSQL and complete current protection history.
- Before live restoration: fence actual writers, drain pending queues, capture a
  fresh complete pinned deletion/suppression inventory, restore in isolation and
  apply history before permitting user access or notification dispatch.
- Source restore, fixture DB restore and whole-site live recovery are distinct.
  Do not use this result to enable storage, notifications, sales or cron jobs.

## Completed tests on restored80ced071

- `npm test -- --test-concurrency=2`:1328 passed,0 failed/skipped/cancelled;
  164.1 seconds. Includes freshness, notification consent/dispatch/idempotency,
  durable pending protection events and actual isolated PGlite restore tests.
- Targeted Python:26 passed in four files, using the same research_test_clock
  import as the project runner, not an unpinned calendar. The full Python suite
  was NOT rerun. Files: test_tech_phase_external_research.py,
  test_external_protection_copy.py, test_resolute_restore_storage.py,
  test_resolute_protection_acceptance.py.
- Python fixtures exercised real SQLite WAL snapshot, AES-GCM encryption and
  isolated decryption; saved memo bytes matched. Store operations were in-memory
  test doubles, NOT another live Cloudflare transfer. Wrong keys, tampering,
  corrupted readback, old empty inventories and incomplete replay were rejected.
- PGlite fixtures applied deletion and both notification-stop histories before
  exposing restored records, removed stale outbox entries, and preserved later
  valid recreation/reconsent. These synthetic results do not establish the
  completeness of production deletion history.
- The restored checkout remained unchanged after build/tests (`git diff` empty).
  Server process terminated after HTTP checks. No new external service,
  schedule, notification delivery, AI call, payment or deployment was performed.
- Publication is documentation only; `git diff --check` passed. These results
  are not new full-suite gates on coworker PR175/current branch HEAD.
