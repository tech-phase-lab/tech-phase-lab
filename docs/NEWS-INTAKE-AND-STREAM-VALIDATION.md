# News intake and sustained delivery validation — 2026-09-26

## Deployment and gates

Commit `3a8705b2a01a5b7748ae8ce2bd02da46fd02cb9e` on
`codex/research-preview`: Vercel and Railway staging checks both succeeded.
Local gates: lint, 100 JavaScript tests, 298 Python tests, build, compileall and
whitespace checks passed. No main-branch update or paid-provider activation.
Railway health returned ready=true and the new `/admin/news` returned 401
without editor authorization. Stock News intake was not enabled.

## Stock News scope

Completed: one server-side intake worker, persisted call ceiling, saved articles,
URL-level deduplication and correction handling, publication/detection timestamps,
revision-bound Japanese/English draft storage, and a private authenticated queue.

Not completed: live provider authentication/schema/entitlement verification,
actual bilingual generation, cross-source event-level merging, and public display.
No live Stock News request or source-to-screen delay measurement was made.
The provider key must be entered as `STOCK_NEWS_API_KEY` in Railway when available,
with `STOCK_NEWS_ENABLED=true` only for the intended monitor deployment. Details
are in `NEWS-API-INTAKE.md`. Do not ask the user to paste the key into a chat.

## Sustained synthetic delivery test

Command: `python3 scripts/research/soak_stream.py --clients 3000 --seconds 840`

One real-time 14-minute run, 3,000 synthetic consumers, 30 synthetic items per
snapshot, new snapshot roughly every 20 seconds, real 780-second ticket expiry.
No production data, credentials, external provider calls or Railway traffic.
Server and clients share one local process; results do not include internet,
TLS, proxies, production database cost, browser rendering or device suspension.
This is not a six-and-a-half-hour market-session test.

## Traffic model (not a monthly invoice estimate)

A complete 30-item synthetic snapshot is approximately 18.8 KB. With all users
watching 6.5 hours/day for 22 days and a complete snapshot every 20 seconds:

| Concurrent viewers | Approximate monthly snapshot payload |
| --- | --- |
| 100 | 48.5 GB |
| 1,000 | 484.8 GB |
| 3,000 | 1,454.3 GB |

This deliberately frequent-update model is not the observed production target
frequency. With no new data, there are only small keepalives; snapshots are not
sent periodically. Table excludes transport overhead, reconnect snapshots,
initial loads, other APIs and website assets. Delivery still costs bandwidth.
At Railway's published $0.05/GB, this component alone is roughly $2.42/$24.24/
$72.71 respectively. It excludes compute, storage, Vercel, X, AI and news APIs;
Hobby's included usage must not be double-counted as an additional resource fee.
Pricing reference: https://docs.railway.com/pricing/plans

Vercel ticket requests at 780-second renewal are approximately 30 per continuously
active 6.5-hour session per viewer, plus initial loads/retries. These remain
billable and are not eliminated by direct Railway delivery.

## Remaining live verification / newswire blockers

The protected Vercel preview could not be opened through the currently authorized
connector. Do not create an authentication-bypass URL to work around that denial.
Live Railway stream counters were zero after deployment: this is waiting, not
proof of a fault or successful screen delivery. Actual browser receipt remains
unverified; deployment success and local load tests do not substitute for it.

RSS catalogs/availability descriptions were confirmed on the official websites
of GlobeNewswire, PR Newswire and Business Wire. Working XML endpoints were not
validated from this environment and were not added. Existing corporate IR
coverage remains separate. See `NEWS-API-INTAKE.md` for sources and limitations.

## Completed sustained-run result

```json
{
  "phase": "complete",
  "clients": 3000,
  "seconds": 840.0,
  "versions": 40,
  "latestDelivered": 3000,
  "ticketRenewals": 3000,
  "errors": 0,
  "errorTypes": [],
  "p95Ms": 1233.8,
  "maxMs": 1381.6,
  "sseBytes": 2315649000,
  "sharedReads": 837,
  "combinedPeakRssKiB": 450912
}
```

All 3,000 connections renewed after the actual 780-second expiry. All 40
versions reached every consumer, including after renewal. The 837 shared reads
in 840 seconds were shared across all clients, not multiplied by 3,000.
The 2.316 GB figure includes replacement snapshots after renewal. RSS was
450,912 KiB for the combined server and all synthetic clients, not Railway
server-only memory. p95 1.234 seconds and maximum 1.382 seconds are local
change-to-receipt times, not upstream news-publication delays.
