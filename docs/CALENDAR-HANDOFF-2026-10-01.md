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

## Pending-first company review (02:06 JST)

Reviewed the next ten oldest pending company sources. No first-party source
confirmed a new future earnings release or call, so only `lastAttemptedOn`
advanced and every inconclusive `lastCheckedOn` remained unchanged.

| Ticker | Result | Official source / exact blocker |
| --- | --- | --- |
| LITE | Pending | [Events](https://investor.lumentum.com/events-and-presentations/default.aspx) exposes Latest Events and archive headings without an inspectable current item. |
| MRVL | Pending | The configured events page remained inaccessible. The [official IR calendar](https://investor.marvell.com/news-events/ir-calendar) exposes an October 6 Investor Day, not a future earnings release or call. |
| NOW | Pending | [Events](https://investor.servicenow.com/events-and-presentations/default.aspx) exposes archived sections without an inspectable current earnings item. |
| NVDA | Pending | The configured first-party events endpoint remained inaccessible. No access control was bypassed. |
| PANW | Pending | The configured first-party events endpoint remained inaccessible. No access control was bypassed. |
| PLTR | Pending | [Events](https://investors.palantir.com/events) exposes only the investor page shell without an inspectable event. |
| SKHY | Pending | [IR newsroom](https://news.skhynix.com/en/category/ir/) still ends its earnings entries with the completed July 29 Q2 result and provides no future earnings announcement. |
| SNOW | Pending | [Events and presentations](https://investors.snowflake.com/events-and-presentations/default.aspx) exposes an empty Upcoming Events heading without an explicit no-events statement. |
| VRT | Pending | The configured first-party events URL returned 404. Searchable official results expose completed investor conferences, not a future earnings announcement. |
| QCOM | Pending | [Investor events](https://investor.qualcomm.com/news-events/investor-events/default.aspx) exposes navigation without an inspectable future earnings item; official search results still end with the completed fiscal Q3 release. |

The BLS October schedule remains October 2 Employment Situation, October 14 CPI
and October 15 PPI at 08:30 Eastern. The Federal Reserve calendar remains
October 27–28 and December 8–9 without future statement or press-conference
clock times. No calendar event or inferred time was added.

## Exact MU publication-time evidence

The finite MU worker can now bind a same-URL, timezone-bearing publication
timestamp from the already validated official-signal evidence to the measured
release. Only a non-future timestamp no more than seven days before detection is
accepted. Naive timestamps, another URL, reversed time and date-only evidence
remain unmeasured. This lets `publicationToDetectionMs` become exact when the
official feed supplies a clock time while preserving the existing null/date-only
fallback. Existing measurement rows are backfilled safely on a later worker pass;
no generated body, model output or credential enters public diagnostics.

## Oldest-source rotation (02:46 JST)

Reviewed the ten oldest company attempts against current first-party investor
pages. No source confirmed a new earnings date or changed an existing calendar
record. The daily BLS and Federal Reserve check had already been completed
earlier on October 1, so no second inferred update was added.

| Ticker | Result | Official source / exact blocker |
| --- | --- | --- |
| AMAT | Pending | The configured [events page](https://ir.appliedmaterials.com/events?tab=upcoming) remained inaccessible through the available lawful endpoint. No access control was bypassed. |
| CRM | Pending | [Investor events](https://investor.salesforce.com/events-and-presentations/default.aspx) exposes Upcoming & Recent Events and Archived Events headings without an inspectable current item. |
| ORCL | Pending | [Events and presentations](https://investor.oracle.com/events-and-presentations/default.aspx) exposes Featured Event, Upcoming Events and Archived Events headings without an inspectable item. |
| ASML | Pending | The configured calendar now redirects to [financial events](https://investor.asml.com/financial-events), which exposes only a general events description and an external widget; the already registered October 14 date remains unchanged. |
| ADBE | Checked | [Events and presentations](https://www.adobe.com/investor-relations/events-presentations.html) still confirms the December 9, 2026 Q4/FY2026 call at 2:00 p.m. Pacific. |
| AMD | Checked | [IR calendar](https://ir.amd.com/news-events/ir-calendar) explicitly says there are no upcoming events; the latest earnings call remains August 4. |
| COHR | Checked | [Events](https://ir.coherent.com/news-events/events) explicitly says more events are coming soon and lists only past events, with no future earnings item. |
| CRWD | Checked | [Events and presentations](https://ir.crowdstrike.com/events-and-presentations/) lists presentations and past events through September 10, with no future earnings event. |
| DELL | Checked | [Upcoming events](https://investors.delltechnologies.com/news-events/upcoming-events) explicitly says more events are coming soon and supplies no scheduled item. |
| GEV | Checked | [Investor events](https://www.gevernova.com/investors/events) still confirms the October 28, 2026 Q3 webcast at 7:30 a.m. Eastern. |

Only the ten reviewed companies advanced `lastAttemptedOn`; the six conclusive
pages advanced `lastCheckedOn`. Empty, inaccessible or widget-only sources
remain pending with their prior completed-check dates. Next rotation begins with
INTC, LRCX, META, MSFT, MU, NBIS, NFLX, SNDK, TSLA and TSM.
