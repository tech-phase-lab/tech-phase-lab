# Source recovery before acceptance — October 2

Owner correction at approximately 03:24 UTC: the window beginning at
02:57:53.058536 UTC is diagnostic evidence, not acceptance. Known failures must
be repaired and actual retrieval verified before a new continuous 24-hour window.
Both the continuing task and dedicated-chat report task were updated accordingly;
the old report remains disabled. No new acceptance start has yet been declared.

## Two failing official routes

- `sandisk-news`: old investor listing timed out, with no successful baseline,
  57 attempts since September 25. Its next old-endpoint retry was 05:49:01 UTC.
  Do not force retries to that endpoint. Replace it with the public JSON endpoint
  used by Sandisk's own corporate newsroom, discovered from its shipped page
  scripts. Keep the source ID and failure history. The new host/path can be
  validated independently without retrying the old failing endpoint.
- `prnewswire-public`: alternating successes and HTTP 404. Railway console
  reproduced a successful ordinary fetch followed immediately by HTTP 404 with
  the freshly returned conditional validators. A stale conditional request can
  succeed, so one successful request did not prove recovery. Disable conditional
  headers for this source only, retaining its 30-second polling interval,
  ordinary error reporting/backoff and document deduplication. Do not hide 404s
  or return cached success after a failed request.

## Implementation and evidence

- Bounded JSON listing extraction uses only configured `docs[*].url`, approved
  hosts and press-release paths. Full HTML articles use the `para-text` body.
- Decode gzip responses even when the publisher ignores `Accept-Encoding:
  identity`, limiting both compressed and expanded bytes to 12 MiB.
- Article publication metadata takes precedence: Sandisk's listing and article
  timestamps differ. No publication time is inferred from observation time.
- New discoveries remain distinct from initial history. An offline test inserts
  a new release after a baseline and verifies a new event with the full body.
- Local real-network acquisition at approximately 03:38 UTC returned the latest
  three Sandisk releases, with 962, 8,712 and 1,294 characters, no truncation and
  no retrieval errors; 12 older baseline articles still awaited retrieval.
- 201 Node tests and 566 Python tests passed. Lint: zero errors and one existing
  unrelated warning. Build, compileall and diff checks passed.

## Deployment follow-up required

Verify the deployed configuration and actual Railway retrieval, including several
normal PR Newswire cycles, then all Sandisk baseline children. Record commit and
times below. Local tests alone do not close these incidents. Historical failure
measurements must remain visible. Acceptance must not start on a transient zero
error count, with unresolved article failures, or without evidence of retrieval.
The previous worker change and all earlier observations remain diagnostic.

## Deployed result and RSS relapse

Commit `f24c20a` deployed successfully to Railway at 03:41:04 UTC. Sandisk
recovered from the preserved timeout incident at 03:42:10.107 UTC after 58
measured attempts. By 03:46:13 UTC, the route had stored nine of 15 bounded
baseline articles (74,059 characters total; 962 minimum and 29,963 maximum),
with zero child errors and six historical articles still pending.

The conditional-header change did not repair PR Newswire. Its RSS route recovered
at 03:44:44.216 UTC, then an ordinary request with conditional headers disabled
returned HTTP 404 at 03:45:45.460 UTC. This relapse is preserved in
`signal_route_transitions`; the transient recovery and the temporary 24/24
snapshot are not acceptance evidence.

The replacement under test uses PR Newswire's own public All News Releases HTML
listing instead of the unstable RSS representation. A normal Railway request at
approximately 03:50 UTC returned 25 strictly matched release links. A bounded
article request returned 1,149 extracted characters and an exact issuer
`datePublished` value from the page's JSON-LD. The configured path expression
accepts only numbered `/news-releases/...html` articles on the approved host.
Initial HTML history remains baseline; a newly listed URL becomes a new event.
This replacement must pass the complete repository gates and live deployment
verification before the new acceptance window can start.

## Verified replacement and new observation start

Commit `871c4d77bd79ef3247d8251bc4b09e148dd59a00` replaced the failing RSS
representation with PR Newswire's official All News Releases HTML index. Link
discovery is restricted to numbered release article paths on the approved host,
and exact article publication time is read from the bounded JSON-LD
`datePublished` field. The source ID, 30-second check interval, error reporting,
retry behavior and deduplication remain intact; the route was not disabled.

The full repository gates passed before deployment: lint had zero errors and one
pre-existing warning, 201 Node tests and 567 Python tests passed, and the Next
build, Python compile check and diff check completed. Vercel deployment
`dpl_BmCN6dksRQRcQrTddo113QADxYsJ` and Railway deployment
`26cedbf0-4a57-45d6-95f0-73553c1c90e5` both succeeded. The Railway worker
started at 03:54:43.999 UTC.

Live stored evidence then showed Sandisk at 15/15 completed article bodies with
zero child errors (107,631 characters), and PR Newswire advancing across several
normal listing cycles. At 03:59:41.390 UTC PR Newswire had 28/28 discovered
article bodies completed, zero child errors and zero pending children, with no
failure transition after the repaired deployment. The public health snapshot at
04:00:13 UTC reported 24/24 routes fresh, zero route errors, zero article errors
and no pending retries.

The replacement is therefore sufficiently verified to begin, but not complete,
a new continuous observation. The new window is 2026-10-02 04:00:13.253461 UTC
through 2026-10-03 04:00:13.253461 UTC. The earlier 02:57:53 UTC interval and all
Sandisk/RSS failures remain diagnostic evidence. No acceptance conclusion may be
drawn until the new window ends and per-item source, bilingual, publication,
frontend and miss reconciliation is complete.
