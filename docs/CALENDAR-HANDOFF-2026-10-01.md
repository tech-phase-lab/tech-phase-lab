# Calendar handoff — 2026-10-01

## Pending-first company review (00:58 JST)

Reviewed the ten oldest pending company sources against current first-party
investor pages. No source supplied a new confirmed future earnings release or
call. `lastAttemptedOn` advances only for these ten companies; every
inconclusive `lastCheckedOn` remains unchanged.

| Ticker | Result | Official source / exact blocker |
| --- | --- | --- |
| AAPL | Pending | [Investor Relations](https://investor.apple.com/investor-relations/default.aspx) exposes Investor Updates and Quarterly Earnings Reports headings without an inspectable current item. |
| AMZN | Pending | [Events](https://ir.aboutamazon.com/events/default.aspx) exposes empty Upcoming Events and Past Events sections without an explicit current no-events statement. |
| ANET | Pending | [Events and presentations](https://investors.arista.com/events-and-presentations/default.aspx) remained inaccessible through the available lawful endpoint. No access control was bypassed. |
| ARM | Pending | [Investor Relations](https://investors.arm.com/) still shows the completed July 29 fiscal Q1 event and result as its latest investor entries; it provides no confirmed future earnings item. |
| AVGO | Pending | [Financial news](https://investors.broadcom.com/financial-information/financial-news-releases) still ends with the completed September 2 fiscal Q3 result and contains no future earnings announcement. |
| BE | Pending | [Events calendar](https://investor.bloomenergy.com/events-and-presentations/events-calendar/) exposes an empty Upcoming Events section without an explicit current no-events statement. |
| CRDO | Pending | [Events](https://investors.credosemi.com/news-events/events/default.aspx) exposes Upcoming & Recent Events and Archived Events headings without an inspectable future item. |
| CRWV | Pending | [Events and presentations](https://investors.coreweave.com/events-and-presentations/default.aspx) exposes Upcoming & Recent Events and Archived Events headings without an inspectable future item. |
| GOOGL | Pending | [Events and presentations](https://abc.xyz/investor/events/default.aspx) exposes only the page shell without an inspectable current event. |
| KLAC | Pending | [Events and presentations](https://ir.kla.com/events-presentations/) remained inaccessible through the available lawful endpoint. No access control was bypassed. |

The [BLS October schedule](https://www.bls.gov/schedule/2026/10_sched.htm)
still lists the October 2 Employment Situation, October 14 CPI and October 15
PPI at 08:30 Eastern. The [Federal Reserve calendar](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)
still lists October 27–28 and December 8–9 without future statement or press
conference clock times. No economic-calendar record changed and no time was
inferred.

Next: LITE, MRVL, NOW, NVDA, PANW, PLTR, SKHY, SNOW, VRT and QCOM. Preserve
inaccessible, empty, historical-only and shell-only sources as pending unless
first-party evidence becomes conclusive.

## MU timing-readiness improvement

The operations preview now renders the bounded MU rehearsal diagnostics already
present in public health: release-wait/configuration state, first detection,
body-ready time, detection-to-body, headline-translation API time, factual
summary API time, body-to-summary, detection-to-summary and total model-request
time. It never renders the generated translation or summary, and labels the
summary as a private draft. Publication-to-detection remains uncalculated when
the official source provides only a date rather than a precise publication
clock.

X usage was also checked before changing any budget. Its 24-hour cap is a
rolling window with persisted global pacing, so older attempts expire while new
ones are admitted; the observed near-cap total does not by itself imply that the
MU window will run out. No paid limit, query cadence, provider activation,
subscriber delivery or production setting changed.
