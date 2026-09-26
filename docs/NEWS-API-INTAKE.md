# Shared news intake preparation — 2026-09-26

Stock News API official documentation: https://stocknewsapi.com/documentation

## Implemented

- `stock_news.py` reads the Company Ticker News endpoint centrally, at most once
  per minute, with up to 50 symbols in one request and up to 100 items per page.
- The existing Railway service starts one optional worker. It exits without
  network activity if either the key or explicit enable flag is absent.
- SQLite retains a normalized article URL, publisher, source timestamp, first
  detection time and content revision. Tracking parameters do not create a
  duplicate. Changed text updates the existing row and invalidates old drafts.
- Additional pages are fetched when the first 100 results contain no known
  article, up to five pages per cycle. Saturation is explicitly reported as
  `historyIncomplete`; a long outage or busy feed is not silently called complete.
- First fetch / watchlist changes establish a baseline. The private queue is
  not a notification or public news feed.
- Monthly calls are durably reserved before requests, including failures and
  pagination. Default ceiling: 48,000, configurable from 1 to 50,000. One regular
  minute-level request takes 44,640 calls in 31 days; pagination/retries use the
  remaining allowance. This ceiling is shared only by workers using this DB.
- Private `/admin/news` uses the existing editor authorization. It shows source
  publication and detection times, intake delay, current bilingual draft fields,
  and calls used. It never reveals the API key. The article/image URLs are never
  fetched by this connector. No per-viewer source requests are made.
- `save_draft` stores Japanese and English together against a content revision;
  stale drafts are hidden after a correction. No model calls are enabled here.

## Activation after contract/key are available

In the existing Railway monitor service, set these environment variables:

| Key | Value |
| --- | --- |
| `STOCK_NEWS_API_KEY` | Provider-issued API key; server secret only |
| `STOCK_NEWS_ENABLED` | `true` when ready for measured intake |
| `STOCK_NEWS_MONTHLY_CALL_LIMIT` | `48000` initial ceiling |
| `STOCK_NEWS_TICKERS` | Optional comma-separated roster, maximum 50 |

Without an explicit roster, use the configured official-source roster plus the
existing X extra-ticker roster. Provider ticker availability is unverified.
Enable only one deployment initially; distinct databases have separate counters.
No contract, charge, environment change, or live API request was made as part of
preparing this connector. Leave the flag unset/false until the user has a key.

## Still required before public news delivery

Live schema/entitlement and provider latency verification with a real key;
bilingual generation and editorial checks; event-level deduplication across X,
IR and newswire URLs; display integration and actual displayed-at measurement.
URL deduplication is not a claim that different articles about the same event
are already merged. Do not publish from this queue until that path is finished.
The previously discussed under-five-minute total is a target, not a measurement.

## Newswire investigation

Official RSS catalogs were confirmed for GlobeNewswire and PR Newswire, and
Business Wire documents headline RSS and separately licensed feed options.
Current environment attempts could not validate usable XML responses: PR
Newswire returned an HTTP error; GlobeNewswire catalog retrieval was incomplete
or unavailable. No unverified feed URL was added to the running configuration.
No claims of seconds-level delivery or completed three-provider coverage.

- https://www.globenewswire.com/rss/list
- https://www.prnewswire.com/rss/
- https://www.businesswire.com/help/feed-options

## Follow-up: verified GlobeNewswire route

The official catalog was fetched successfully on September 26. Its public-company
RSS URL was extracted from the actual catalog, then validated through the
existing monitor HTTP fetch and XML parser (36,518 bytes, 20 items, 0 matching
current official-source tickers in that snapshot). `globenewswire-public` is now
configured at 30-second intervals with conditional requests and existing retry
backoff. Initial results are a private baseline, not public notifications.
Only the latest 20 releases were present; fast bursts may overflow this window.
This is not complete archival coverage or proof of seconds-level delivery.
Business Wire and PR Newswire live feed validation remain outstanding.

### Runtime follow-up (September 26, late evening JST)

The exact configured GlobeNewswire feed was rechecked with `signals.fetch` from
this development environment: 36,518 bytes in 7.33 seconds. Railway's aggregate
signal health remained 19 fresh / 4 failed, with two timeouts and two access
restrictions. This does not establish a DNS, TLS, or remote-server root cause;
no production network bypass or blind timeout increase was applied. GlobeNewswire
must not yet be described as reliably operational on Railway.

Business Wire's official feed-options page documents a legitimate headline RSS
and licensed full-text feed route, but no usable endpoint was established here.
PR Newswire's public RSS catalog is confirmed; live XML validation is outstanding.
These two integrations remain blocked on obtaining/validating an authorized feed.
