# PCE missing-calendar and missing-news correction

The owner pointed out that PCE was absent from both the economic calendar and
news. The prior implementation had BLS/FOMC schedules and a single manually
verified ADP result; BEA was not configured. This checkpoint corrects that
specific defect without widening stock coverage or enabling a paid provider.

## Official evidence checked

- [BEA August release](https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026):
  September 30, 2026, 08:30 EDT / 21:30 JST. Headline price index +0.3% MoM,
  +3.4% YoY; core +0.2% MoM, +3.0% YoY. Spending growth is a different measure.
- [BEA full schedule](https://www.bea.gov/news/schedule/full): September-period
  release October 29 at 08:30 EDT; October-period release November 25 at 08:30
  EST; November-period release December 23 at 08:30 EST. Japanese times are
  respectively 21:30, 22:30 and 22:30. These are scheduled release times.
- [BLS October calendar](https://www.bls.gov/schedule/2026/10_sched.htm): October
  2 employment, October 14 CPI and October 15 PPI remain 08:30 Eastern.
- [Federal Reserve](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm):
  October 27–28 and December 8–9 remain meeting dates. No future statement/call
  clock time was added; date-only records are unchanged.

## Implementation

- Calendar includes the four official PCE schedules and the confirmed August
  actuals. Source labels are now per result (ADP or BEA), with a PCE guide.
- A free first-party `bea-pce` route discovers the current official release
  from BEA's current-releases index. It uses the existing bounded HTML intake,
  redirect allowlist, 20-second requests, child ETag/Last-Modified conditions,
  deduplication, revision storage and failure/backoff handling. Discovery polls
  every 120 seconds; successfully fetched child articles recheck hourly.
- `bea_pce.py` checks the exact release URL, period heading, embargo clock,
  Eastern timezone abbreviation and weekday, then independently extracts
  headline/core monthly/annual price changes. It builds factual bilingual
  headlines with no AI call, forecast, consensus or investment-impact claim.
- BEA's first H1 is `News Release`; the actual heading is bound to the BEA
  release identifier. Missing/ambiguous/truncated/unsupported evidence stays
  pending, with no guessed numeric result. Existing generic HTML path-pattern
  discovery also had a locally shadowed regex import; that defect is fixed.
- Public news projects only the current exact document SHA and valid released
  evidence from the latest seven days. Private bodies, excerpts and diffs stay
  private. A narrow BEA PCE URL allowlist is enforced again at the frontend.
- News/home accept this ticker-free official economic item. The calendar reads
  the same public feed every 30 seconds and merges by economic period; automatic
  revisions replace that period once. Failed reads return to saved verified
  results with a visible connection warning and normal retry/reconnect logic.

## Verification and limits

The actual lawful local probe fetched the BEA index and release successfully:
one matched item, one event, zero pending articles. Its public projection
matched all four source figures and 08:30 EDT. Observation was September 30 at
15:04:47.603 UTC; this was a late initial import, not a publication-time speed
test. Do not turn it into an SLA or describe polling as end-to-end latency.

Offline cases cover spending-vs-price separation, negative values, EDT/EST,
weekday/period errors, private-evidence redaction, URL restrictions, duplicate
anchors, 304 requests, exact revision binding, future/old release exclusion and
parser-failure backoff. The live deployment and browser checks are recorded
below after the final integrated-tree gates pass.

Final integrated-tree checks passed: Node 171/171, Python 467/467, production
build, compileall and diff whitespace checks. ESLint has zero errors and the
existing unused-variable warning in `tests/comparison.test.mjs` only.

Limits: combined-month releases and changed BEA prose such as unsupported
unchanged/less-than wording intentionally fail closed pending a tested parser
update. Automatic news retains seven days; saved August actuals remain available
as a verified snapshot, not a complete historical macro database. Other macro
results (including ADP) remain manually verified. No automatic subscriber
notification, paid provider, production setting or billing change was enabled.

## Standing company-calendar review

Rechecked ten oldest/pending companies on September 30. All remain pending;
their existing same-day attempt dates are preserved and `lastCheckedOn` does
not advance from an inconclusive shell, historical list or tentative proposal.

| Company | Official source and exact blocker |
| --- | --- |
| AAPL | https://investor.apple.com/investor-relations/default.aspx exposes investor/quarterly-report section headings without an inspectable current event. |
| AMZN | https://ir.aboutamazon.com/events/default.aspx exposes empty upcoming/past event shells. |
| ANET | https://investors.arista.com/events-and-presentations/default.aspx was inaccessible through the lawful read endpoint. |
| ARM | https://investors.arm.com/news-events/investor-events-presentations lists November 4 FY27 Q2 only as tentatively proposed; no confirmed future earnings event. |
| AVGO | https://investors.broadcom.com/financial-information/financial-news-releases lists the completed September 2 results; no later announcement. |
| BE | https://investor.bloomenergy.com/events-and-presentations/events-calendar/ exposes empty upcoming/archive sections. |
| CRDO | https://investors.credosemi.com/news-events/events/default.aspx exposes empty upcoming/recent/archive sections. |
| CRWV | https://investors.coreweave.com/events-and-presentations/default.aspx exposes section shells and presentations, without a confirmed earnings event. |
| GOOGL | https://abc.xyz/investor/events/default.aspx exposes only navigation/page shell. |
| KLAC | https://ir.kla.com/events-presentations/ was inaccessible through the lawful read endpoint. |

Next: verify preview/staging PCE rendering after deployment, then preserve the
standing calendar rotation and MU measurement checkpoint. The existing finite
news-readiness backlog remains complete; avoid discretionary redesign. Expand
other macro result adapters only against official evidence and meaningful tests.
