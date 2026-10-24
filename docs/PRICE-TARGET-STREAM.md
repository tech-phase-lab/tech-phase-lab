# Price-target streaming pilot — 2026-09-26

The research price-target panel uses one SSE connection directly to the Railway
monitor. Vercel issues an origin-bound HMAC ticket valid for 780 seconds. The
server API token is never sent to the browser. Tickets only authorize the same
public price-target fields already exposed by the preview API; this is not yet
paid-member authentication. The gateway does not log access headers/tickets.

One shared worker reads the saved database once per second while at least one
viewer is connected. It never fetches X or other sources on behalf of a viewer.
It hashes only the item list, so generation timestamps don't trigger broadcasts.
Every change replaces the full bounded list (up to 30), including expiry/removal.
Each connection has a one-item queue. Slow connections time out rather than
accumulating an unbounded backlog. SSE uses asyncio, not a thread per viewer.

## Recovery and limits

- Every reconnect receives the current list; items are replaced, not appended.
- Heartbeat every 30 seconds; browser detects silence after 45 seconds.
- Ticket rotation at 13 minutes precedes Railway's documented 15-minute HTTP cap.
- Failed streams fall back to 15-second HTTP checks, with stream retries backed
  off to approximately 60 seconds. Hidden tabs and offscreen panels disconnect.
- Maximum 3,500 concurrent stream clients; excess clients receive 503 and fall
  back. This is a pilot resource guard, not a demonstrated production capacity.
- `/price-targets/stream-status` reports aggregate active/accepted/rejected/
  disconnected clients, shared read attempts, successful reads, failures,
  recoveries, changes and SSE application bytes. It
  requires the existing RESEARCH_API_TOKEN. The gateway also adds the same
  public-safe aggregate to `/health` and the private operations preview's live
  monitor state. A gateway with no active client is reported as waiting, not
  actively healthy; whether it has a prior read is shown separately. Neither
  surface exposes exceptions, tickets, origins, IPs, URLs or tokens.
- Set Railway `RESEARCH_STREAM_ENABLED=false` and redeploy to return to the
  original HTTP server. The browser's fallback remains usable.
- Existing authenticated APIs are proxied to a loopback-only HTTP server;
  authentication, POST bodies and gzip were regression-tested.

## Local verification

`python3 scripts/research/benchmark_stream.py --clients 3000` uses synthetic data,
no real API calls, and no production credentials. Short local trials:

| Connections | Delivered update | Shared DB reads in 3 idle seconds | Idle SSE bytes | Local change receive p95 |
| --- | --- | --- | --- | --- |
| 100 | 100 | 2 | 0 | 6.9 ms |
| 1,000 | 1,000 | 2 | 0 | 60.6 ms |
| 3,000 | 3,000 | 2 | 6,600 (heartbeats) | 315.1 ms |

These are single-update, same-machine trials, not network latency guarantees.
The update's position within the one-second sampling cycle affects the result.
Peak combined server + simulated-client RSS at 3,000 was 131,664 KiB; this is not
a server-only production memory estimate. The initial 3,000-client trial failed
because the test read timeout (15s) was shorter than the 30s heartbeat during
connection ramp-up; the harness was corrected to 60s and rerun successfully.

Without disconnects, 13-minute ticket renewal replaces roughly 52 fifteen-second
checks with one Vercel request. Initial loads, fallback, visibility changes,
other pages, direct Railway traffic, CPU and memory remain billable. No monthly
total or full-market-session stability claim has been verified yet.

Upstream news ingestion, editorial approval, richer cross-source deduplication
and paid-member access controls are separate work. Existing structured-target
deduplication remains in the saved-data reader.
