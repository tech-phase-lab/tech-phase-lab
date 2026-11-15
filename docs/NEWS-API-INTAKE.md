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

## Home news on the Stock News API (owner, 2026-11-10)

Scope (owner): US high-tech news across all tickers, plus market news that moves stocks (indices, oil, bonds and rates, politics, wars and
geopolitics such as the Strait of Hormuz, statements by Trump or Musk). Not a watch list. Everything else is dropped.

How: the monitor reads two provider feeds, "tech" (all tickers, sector Technology) and "market" (general market news), each at
its own pace (75 s and 300 s: about 44,500 calls a month, inside the plan's 50,000 and the 48,000 ceiling). Articles are written
into the company headline table (`company_wire`): a "tech" article under up to three tickers it names (watched companies first), a
"market" article under `MKT` (shown as 市場 / Market). The existing translation then judges each headline: `news` / `not-news`
and, new, `off-topic` (outside the scope above), writes the Japanese and one-line headline, and only kept headlines reach the home
band and list. Watched companies are translated first. Unwatched companies and market news are shown only once translated.
The 22-company alert list (ハイテク速報) is unchanged.

| Key | Value | Effect |
| --- | --- | --- |
| `STOCK_NEWS_ENABLED` | `true` | The intake runs. |
| `STOCK_NEWS_STREAMS` | `tech,market` | Use the two home streams instead of the watch list (unset: the old watch-list intake). |
| `STOCK_NEWS_ITEMS` | `3` during the trial | Articles per request, 1 to 100 (default 100). A trial account refused 10 on 2026-11-10. Paging follows it (at most three pages a round). |
| `STOCK_NEWS_TO_HOME` | `true` | Also write the articles into the home headline table. Off by default, so the intake can be measured alone. |
| `STOCK_NEWS_TECH_SECONDS`, `STOCK_NEWS_MARKET_SECONDS` | optional | Pace of each stream (never below 30 s). |
| `COMPANY_WIRE_FEEDS` | `none` | Stop reading the Yahoo / Google News feeds, so the home runs on the Stock News API alone. `gnews` or `yahoo` keeps one. Unset keeps both. |

The review page has buttons to test each feed once ("ハイテク全銘柄の取得テスト", "市場ニュースの取得テスト") before they are switched on.
Old rows age out of the home within 24 hours. The intake result (`stockNewsIntake` in the monitor state) carries `delay` per stream:
how long after publication newly found articles reached the monitor (count, min, median, max, in seconds). That is the intake delay;
the translation and display delay are separate. One request cannot measure the provider's delay, so run it for a day.
Translation volume is bounded by `COMPANY_WIRE_TRANSLATION_DAILY_LIMIT` (model calls in any 24 hours, default 400; see the
calculation in `scripts/research/company_wire.py`). `/health` shows `companyWireTranslation` (waiting stories, call count against the
limit, last result, last translation, last Stock News success per stream), and the incident watch sends a critical phone alert when the
budget is reached, every call fails for 15 minutes, Stock News stories wait more than 20 minutes for 30 minutes while new ones arrive,
or the 'tech' stream has had no successful poll for 30 minutes.

## Translating each article once (owner, 2026-11-15)

- **One article, one translation.** Each headline row now carries `article`, a ticker-independent identity (sha256 of the
  normalized headline: case and punctuation ignored). The Japanese headline, the one-line headline and the attempt record are stored
  per article (`company_wire_article_ja`, `company_wire_article_attempts`) and shared by every row of it, so a Stock News article
  filed under three tickers, or the same headline from Yahoo / Google News, is sent to the model once. Rows and their public `id`
  (the per-ticker key) are unchanged, so `/company-wire` keeps its per-ticker shape. On the first start the earlier per-ticker
  translations and attempts (`company_wire_ja`, `company_wire_attempts`, now no longer written but kept for a rollback) are
  carried over to their articles, so nothing already translated, judged not news or given up on is sent again.
- **Translate right after each intake round, without waiting.** A Stock News poll round that wrote new rows, or one full pass over
  the roster's Yahoo / Google News feeds that stored something, wakes the translator, which sends everything then waiting in calls of
  at most 30 (back to back while a call is full; at most 20 calls a round). The 20-second wait from #578 is gone. No call is made
  when nothing is waiting. With no intake round for ten minutes the translator still looks for retries that came due.
- **Retries unchanged.** A rejected headline is retried at most three attempts, ten minutes apart; due retries ride along in the
  next call.
- **Daily counts.** `companyWireTranslation.daily` on `/health` shows today and yesterday (Japan time, `Asia/Tokyo`; stored in the
  `company_wire_daily` table so a restart does not reset them, kept 30 days): `articlesArrived` (new articles, each once whatever
  tickers or feeds it came under; `articlesBySource` by the feed that brought it first), `translated` (articles whose Japanese was
  accepted), `calls` (model calls), `retries` (headlines sent again after a rejected or failed attempt), `headlinesSent`,
  `judgedNotNews` and `notAccepted`, and `stockNewsPublishers` (new Stock News API articles per publisher, `kept` / `dropped`).
- The daily limit stays 400 (owner). Calls are about one per intake round that brought at least one new article (the 'tech' stream
  is read every 75 s, the 'market' stream every 300 s, the roster feeds about every 2 to 3 minutes per pass), plus one per 30 articles
  of backlog. On a busy day this can still reach 400; the daily counts show how the calls were spent.

## Stock News API publishers (owner, 2026-11-15)

Only news organisations' reporting, and the companies' own releases through the press-release wires, are taken from the Stock News
API into the home table (`company_wire.KEEP_PUBLISHERS`); opinion, analysis, stock-picking and promotion outlets
(`DROP_PUBLISHERS`: Seeking Alpha, The Motley Fool, Zacks, InvestorPlace, Benzinga and others) are not, so they are never translated or
shown. A publisher in neither list is dropped, and appears under `stockNewsPublishers.dropped` on `/health`, so a news organisation
that should be kept can be added. Rows already stored from a dropped publisher are neither translated nor shown. The intake queue
(`news_articles`, `/admin/news`) still keeps every article. `STOCK_NEWS_PUBLISHER_FILTER=false` takes every publisher again.
