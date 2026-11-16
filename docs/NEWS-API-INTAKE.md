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
its own pace (75 s and 300 s at first; since Nov 15 120 s and 360 s, plus the `tickers` stream, see below). Articles are written
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
limit, last result, last translation, last Stock News success per stream), and the incident watch sends a critical phone alert when
headlines wait 30 minutes on the budget (pacing below), every call fails for 15 minutes, Stock News stories wait more than 20 minutes for 30 minutes while new ones arrive,
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
  of backlog, paced by the token bucket below (Nov 16); the daily counts show how the calls were spent.

## Filtering before translating and pacing calls (owner, 2026-11-16)

- **Filter before translating.** About half of the headlines sent to the model came back not news, off topic or rejected (Sunday
  Nov 15: 402 of about 740). Before a headline is queued, every cheap local check the site applies anyway is run on it:
  `truncated()`, the monitor's `NOISE` regex, the Stock News publisher filter, and `NOT_NEWS_EN`, a Python port of the patterns of
  `NOT_NEWS` in `lib/research/wire-stories.ts` that read English titles (questions, "Why ..." and "here's why" teasers, "stocks to
  buy" lists, earnings previews and call transcripts, law-firm solicitations, bare SEC form notices, movers round-ups, weekly
  digests and the like). Only the conservative ones are ported: the "Wall Street rallies / following earnings", exchange-code, PC
  how-to, data-calendar and company-video patterns stay with the model, because a real news headline can match them. An article whose
  every copy fails these checks is marked in `company_wire_article_attempts` with the reason `prefilter` and is never sent; it is
  counted in the day's `prefiltered`. `/company-wire` hides these titles by the same checks, which the site's `wireStories` already
  hid, so nothing the site showed changes.
- **Pacing (token bucket).** `COMPANY_WIRE_TRANSLATION_DAILY_LIMIT` (default 400) stays a hard ceiling on model calls in any 24
  hours. Instead of calling until the ceiling and then stopping for hours, a call needs a token from a bucket of 12 (a burst after a
  quiet spell) refilled at the limit less the burst per 24 hours (400: 388 a day, one token every 222.7 s, about 3.7 minutes), so a
  burst plus a day of refills is never more than the limit and a busy day is paced evenly rather than pausing at the ceiling. With a
  token, new headlines are sent at once (up to 30 per call, several calls while tokens last, Stock News first, newest first; due
  retries ride along). Without one they stay queued, and the translator wakes when the next token arrives (`next_wake`), with or
  without a new intake. The bucket is replayed from the call times in `company_wire_calls`, so a restart or deploy grants no fresh
  burst, and the rolling 24-hour count is checked as well.
- **Health.** `companyWireTranslation.pacing` shows `tokensAvailable`, `tokens`, `capacity`, `secondsPerToken` and `nextTokenAt`;
  `queue` shows the articles waiting now (`count`, `new` never sent yet) and `oldestWaitMinutes` of the oldest never-sent one.
  `daily.today` / `daily.yesterday` add `prefiltered`, `maxWaitMinutes` and `averageWaitMinutes` (arrival to first call).
- **Alert.** The budget alert (`company-wire-translation-budget`) no longer fires because the bucket is empty or the ceiling is
  reached; it fires when a never-sent headline has waited 30 minutes while no call may be made, and stays open until it is sent.
  The failure, stall and intake alerts are unchanged.
- **Estimate** (simulation with the intake paces above: 'tech' every 75 s, 'market' every 300 s, one roster pass about every 132 s,
  70 % of articles in the US session). Quiet day (about 500 articles after the prefilter): about 320 calls, typical wait under half a
  minute, at most about 3.7 minutes. Busy weekday (about 2,000 articles): 388 calls, typical wait about 1.8 minutes, at most about
  3.7 minutes; even at 3,400 articles a day the wait stays under 4 minutes, since one call carries up to 30 articles.

## Stock News API publishers (owner, 2026-11-15)

Only news organisations' reporting, and the companies' own releases through the press-release wires, are taken from the Stock News
API into the home table (`company_wire.KEEP_PUBLISHERS`); opinion, analysis, stock-picking and promotion outlets
(`DROP_PUBLISHERS`: Seeking Alpha, The Motley Fool, Zacks, InvestorPlace, Benzinga and others) are not, so they are never translated or
shown. A publisher in neither list is dropped, and appears under `stockNewsPublishers.dropped` on `/health`, so a news organisation
that should be kept can be added. Rows already stored from a dropped publisher are neither translated nor shown. The intake queue
(`news_articles`, `/admin/news`) still keeps every article. `STOCK_NEWS_PUBLISHER_FILTER=false` takes every publisher again.

## Wider Stock News intake for 注目トピック (owner, 2026-11-15)

- **Publisher names.** The provider names one outlet several ways: on Nov 15 `WSJ` was dropped while `Wall Street Journal` was
  kept. Names are now compared without case, spaces, punctuation, a leading "The" or a "(video)" / "(articles)" suffix, and
  `company_wire.PUBLISHER_ALIASES` maps the other spellings to the listed outlet (WSJ / The Wall Street Journal, FT / The Financial
  Times, AP / The Associated Press, Barron's, MarketWatch, NYT, Reuters.com). Every Bloomberg outlet (Bloomberg News, Bloomberg
  Television, ...) is one outlet, except Bloomberg Opinion. The /health counters use the listed spelling.
- **A third stream, `tickers`.** The Company Ticker News endpoint (`/api/v1?tickers=...`, up to 50 symbols per request) asked for the
  22 watched companies, the rest of the first 22 of the earnings watch list (DELL, AMZN, ORCL) and the big tech companies outside the
  provider's Technology sector, which the `tech` stream never sees (GOOGL, GOOG, META, AMZN, NFLX, TSLA): 29 symbols. Only the
  symbols it asked for are kept and filed (up to three, watched first). ANT (Anthropic) is not included by default: it has no
  listing yet and the provider's answer for it is unverified. `STOCK_NEWS_EXTRA_TICKERS=ANT` adds it after a probe.
  Turn it on with `STOCK_NEWS_STREAMS=tech,tickers,market`.
- **Calls** (plan 50,000 a month, hard ceiling `STOCK_NEWS_MONTHLY_CALL_LIMIT` 48,000, unchanged). New default paces:

  | Stream | Every | 31-day month | 30-day month |
  | --- | --- | --- | --- |
  | `tech` | 120 s (was 75 s) | 22,320 | 21,600 |
  | `tickers` | 240 s (new) | 11,160 | 10,800 |
  | `market` | 360 s (was 300 s) | 7,440 | 7,200 |
  | Total, one page a round | | 40,920 | 39,600 |

  A second or third page in a round is now taken only while the month's calls are under an even pace to 44,000
  (`stock_news.MONTHLY_TARGET`), so a busy feed cannot carry the month past about 44,000; the 48,000 ceiling still stops every call.
  `STOCK_NEWS_TECH_SECONDS`, `STOCK_NEWS_TICKERS_SECONDS` and `STOCK_NEWS_MARKET_SECONDS` still override a pace (never below 30 s).
- **Translation cost unchanged.** More headlines ride in the same calls (at most 30 articles per call, each article once whatever
  tickers or streams it came under), under the same 400 calls a day and the token-bucket pacing above.
- **/health.** `companyWireTranslation.daily.today.stockNewsStreams` shows the new articles per stream (the stream that found the
  article first), `kept` / `dropped` by the publisher filter.
