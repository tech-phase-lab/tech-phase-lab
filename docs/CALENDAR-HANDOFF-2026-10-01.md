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

## Oldest-source rotation (03:47 JST)

Reviewed the next ten oldest company attempts against current first-party
investor pages. Sandisk newly confirmed its fiscal Q1 2027 earnings call for
October 29, 2026 at 4:30 p.m. EDT; the calendar now records that call start and
does not treat it as the results publication time. The other nine sources
either reconfirmed an existing event or made the absence of a new earnings
date conclusive.

| Ticker | Result | Official source / evidence |
| --- | --- | --- |
| INTC | Checked | [IR calendar](https://www.intc.com/news-events/ir-calendar) explicitly says there are no upcoming events. |
| LRCX | Checked | [Events](https://investor.lamresearch.com/events) lists only the November 3 annual meeting as upcoming, not an earnings release or call. |
| META | Checked | [Investor events](https://investor.atmeta.com/investor-events/) explicitly says to stay tuned for upcoming events. |
| MSFT | Checked | [Investor Relations](https://www.microsoft.com/en-us/investor/default) says the next earnings release will be announced soon. |
| MU | Checked | [Micron's announcement](https://investors.micron.com/news/press-release/2026/Micron-Technology-to-Report-Fiscal-Fourth-Quarter-Results-on-September-30-2026/default.aspx) still confirms the September 30 call at 2:30 p.m. Mountain; this is not a release-publication time. |
| NBIS | Checked | [Investor events](https://nebius.com/investor-events) explicitly says there are no upcoming events. |
| NFLX | Checked | [Netflix's announcement](https://ir.netflix.net/investor-news-and-events/financial-releases/press-release-details/2026/Netflix-to-Announce-Third-Quarter-2026-Financial-Results/default.aspx) still confirms the October 20 approximate 1:01 p.m. Pacific results release and 1:45 p.m. interview. |
| SNDK | Added | [Events](https://investor.sandisk.com/news-events/events) confirms the fiscal Q1 2027 earnings call on October 29 at 4:30 p.m. EDT. |
| TSLA | Checked | [Investor Relations](https://ir.tesla.com/) has a 2026 Q3 row but still leaves its earnings date blank. |
| TSM | Checked | [Financial calendar](https://investor.tsmc.com/english/financial-calendar) still confirms the October 15 Q3 call at 2:00 p.m. Asia/Taipei. |

All 40 roster companies now have an October 1 review attempt. The BLS and
Federal Reserve daily checks were already completed earlier on October 1, so
they were not redundantly advanced or altered. The next rotation can restart
with AAPL, AMZN, ANET, ARM, AVGO, BE, CRDO, CRWV, GOOGL and KLAC, preserving
their exact pending blockers unless new first-party evidence appears.

Verification for this tree: ESLint completed with zero errors and one
pre-existing warning; Node passed 172/172, Python passed 469/469, the Next.js
production build completed, and `compileall` plus `git diff --check` passed.

## Pending-first company review (04:43 JST)

Rechecked AAPL, AMZN, ANET, ARM, AVGO, BE, CRDO, CRWV, GOOGL and KLAC through
their current first-party pages and indexed first-party announcements. No new
confirmed earnings release or call was found. Arm's official page now exposes
November 4, 2026 for fiscal Q2 2027, but labels the entire list "Tentatively
proposed earnings dates"; it remains pending and was not promoted into the
calendar. Empty, historical-only, inaccessible and shell-only sources remain
pending under the exact blockers already recorded above. Because all ten had
already received an October 1 attempt, no coverage timestamp was rewritten.

The October 1 BLS and Federal Reserve daily checks were already complete. Their
stored October 2/14/15 releases and October 27–28/December 8–9 meetings were not
reinterpreted or assigned new clock times. The next rotation starts with LITE,
MRVL, NOW, NVDA, PANW, PLTR, SKHY, SNOW, VRT and QCOM.

## Pending-first company review (05:44 JST)

Rechecked LITE, MRVL, NOW, NVDA, PANW, PLTR, SKHY, SNOW, VRT and QCOM through
their configured first-party investor pages. No new confirmed earnings release
or call was found. Lumentum, Snowflake, Vertiv and Qualcomm exposed empty
upcoming-event sections; Marvell's October 6 item is Investor Day rather than an
earnings event; ServiceNow showed archived sections only; Palantir exposed no
inspectable event; and SK hynix's latest earnings announcement remained its
July 29 Q2 release. The configured NVIDIA and Palo Alto Networks pages remained
inaccessible through the lawful retrieval path. Those two sources therefore
remain pending rather than being marked checked or replaced with an estimate.

All ten already had an October 1 attempt, so no coverage timestamp was
rewritten. The October 1 BLS and Federal Reserve daily reviews were also already
complete; no economic release or FOMC time was changed or inferred.

## Official-source rotation (20:49 JST)

Rechecked AMAT, CRM, ORCL, ASML, ADBE, AMD, COHR, CRWD, DELL and GEV against
their current first-party investor pages and announcements. No new earnings
event or clock time was added. ASML's first-party quarterly-results page
conclusively reconfirms the already registered October 14, 2026 Q3 results
date, so only ASML's `lastCheckedOn` advanced. Every other stored event and
coverage timestamp already matched the evidence or remained pending.

| Ticker | Result | Official source / exact blocker |
| --- | --- | --- |
| AMAT | Pending | [Events](https://ir.appliedmaterials.com/events?tab=upcoming) still exposes only the completed Q3 2026 earnings call; no future earnings event is announced. |
| CRM | Pending | [Investor events](https://investor.salesforce.com/events-and-presentations/default.aspx) lists Dreamforce investor programming and the completed August 26 earnings event, not a future earnings release or call. |
| ORCL | Pending | The latest first-party earnings announcement is the completed September 10 fiscal Q1 2027 release; [events and presentations](https://investor.oracle.com/events-and-presentations/default.aspx) does not confirm a later earnings event. |
| ASML | Checked | [Quarterly results](https://www.asml.com/en/investors/financial-results/quarterly-results) reconfirms Q3 2026 results on Wednesday, October 14, 2026. The stored date-only record remains unchanged. |
| ADBE | Checked | [Events and presentations](https://www.adobe.com/investor-relations/events-presentations.html) still confirms the December 9, 2026 Q4/FY2026 call at 2:00 p.m. Pacific. |
| AMD | Checked | [IR calendar](https://ir.amd.com/news-events/ir-calendar) explicitly says there are no upcoming events. |
| COHR | Checked | [Events](https://ir.coherent.com/news-events/events) says more events are coming soon and lists only past events. |
| CRWD | Checked | [Events and presentations](https://ir.crowdstrike.com/events-and-presentations/) lists presentations and past events through September 10, with no future earnings event. |
| DELL | Checked | [Upcoming events](https://investors.delltechnologies.com/news-events/upcoming-events) says more events are coming soon; its latest earnings result remains the completed September 1 release. |
| GEV | Checked | [Investor events](https://www.gevernova.com/investors/events) reconfirms the October 28, 2026 Q3 webcast from 7:30 to 8:30 a.m. Eastern. |

The BLS and Federal Reserve daily reviews were already completed on October 1
and were not redundantly advanced. Existing October 2/14/15 BLS releases and
October 27–28/December 8–9 FOMC meetings remain unchanged, with no inferred
time. The next oldest-source rotation begins with INTC, LRCX, META, MSFT, MU,
NBIS, NFLX, SNDK, TSLA and TSM.

## Official-source rotation (21:45 JST)

Rechecked INTC, LRCX, META, MSFT, MU, NBIS, NFLX, SNDK, TSLA and TSM against
current first-party investor pages and announcements. Lam Research's September
30 first-party announcement newly confirms its September 2026 quarter financial
conference call for October 21, 2026 at 2:00 p.m. Pacific / 5:00 p.m. Eastern.
The calendar now stores the Pacific call start, fiscal period and exact source
URL; it does not treat the call time as the earnings-release publication time.

| Ticker | Result | Official source / evidence |
| --- | --- | --- |
| INTC | Checked | [IR calendar](https://www.intc.com/news-events/ir-calendar) explicitly says there are no upcoming events. |
| LRCX | Added | [September-quarter call announcement](https://investor.lamresearch.com/2026-09-30-Lam-Research-Corporation-Announces-September-Quarter-Financial-Conference-Call) confirms October 21 at 2:00 p.m. PDT / 5:00 p.m. EDT. |
| META | Checked | [Investor events](https://investor.atmeta.com/investor-events/) still exposes no later earnings announcement after the completed July 29 event. |
| MSFT | Checked | [Investor Relations](https://www.microsoft.com/en-us/investor/default) still does not publish a specific future earnings event. |
| MU | Checked | [Events](https://investors.micron.com/events-and-presentations) contains the completed September 30 fiscal Q4 event and no later earnings announcement. |
| NBIS | Checked | [Investor events](https://nebius.com/investor-events) contains completed investor-conference and Q2 items, with no future earnings announcement. |
| NFLX | Checked | [Netflix's announcement](https://ir.netflix.net/investor-news-and-events/financial-releases/press-release-details/2026/Netflix-to-Announce-Third-Quarter-2026-Financial-Results/default.aspx) still confirms the stored October 20 approximate 1:01 p.m. Pacific release and 1:45 p.m. interview. |
| SNDK | Checked | [Events](https://investor.sandisk.com/news-events/events) still confirms the stored October 29 fiscal Q1 2027 call at 4:30 p.m. Eastern. |
| TSLA | Checked | [Investor Relations](https://ir.tesla.com/) still provides no first-party Q3 earnings date. |
| TSM | Checked | [Financial calendar](https://investor.tsmc.com/english/financial-calendar) still confirms the stored October 15 Q3 call at 2:00 p.m. Asia/Taipei. |

All ten companies already had October 1 attempt and completed-check dates, so
the coverage ledger was not rewritten. The October 1 BLS and Federal Reserve
daily checks were already complete; no economic date or clock time changed.
