# Calendar handoff — 2026-09-30

## Company review (00:49 JST)

Rechecked the queued ten first-party investor calendars, events pages and
official indexed announcements. No source supplied a new confirmed future
earnings release or call, and no explicit current no-events statement was
found. `lastAttemptedOn` was advanced only for these ten reviewed companies;
no pending `lastCheckedOn` value or calendar event changed.

| Ticker | Result | Official source / exact blocker |
| --- | --- | --- |
| LITE | Pending | [Events & Presentations](https://investor.lumentum.com/events-and-presentations/default.aspx) exposes Latest Events, Latest Presentation and Archived Events headings without an inspectable future item. |
| MRVL | Pending | [IR Calendar](https://investor.marvell.com/news-events/ir-calendar) lists an October 6, 2026 Investor Day, not an earnings event. The latest earnings item is the completed August 27 fiscal Q2 call. |
| SKHY | Pending | [IR news](https://news.skhynix.com/en/category/ir/) ends with the August 19 shareholder-return update and completed July 29 Q2 results; it has no future earnings announcement. |
| SNOW | Pending | [Events & Presentations](https://investors.snowflake.com/events-and-presentations/default.aspx) exposes empty Upcoming Events, Featured Presentation and Archived Events headings without an explicit no-events statement. |
| VRT | Pending | [Events & Presentations](https://investors.vertiv.com/events-presentations/events-presentations/default.aspx) exposes empty Latest Events, Latest Presentation and Archived Events headings without an explicit no-events statement. |
| AMAT | Pending | [Events](https://ir.appliedmaterials.com/events?tab=upcoming) remained inaccessible through the official endpoint. The retrievable first-party investor page exposes completed fiscal Q3 results but no future earnings announcement. No access control was bypassed. |
| QCOM | Pending | [Investor Events](https://investor.qualcomm.com/news-events/investor-events/default.aspx) exposes empty Upcoming Events, Featured Presentation and Archived Events headings. First-party announcements end with the completed July 29 fiscal Q3 call. |
| CRM | Pending | [Investor Events](https://investor.salesforce.com/events-and-presentations/default.aspx) exposes an empty Upcoming & Recent Events heading without an explicit no-events statement. |
| ORCL | Pending | [Events and Presentations](https://investor.oracle.com/events-and-presentations/default.aspx) exposes empty Featured Event and Upcoming events headings. Indexed first-party earnings announcements expose completed fiscal 2026 events only. |
| NOW | Pending | [Events and Presentations](https://investor.servicenow.com/events-and-presentations/default.aspx) exposes archived sections and general update prompts but no inspectable current earnings event or explicit no-events statement. Indexed first-party results expose completed Q1 and Q2 events only. |

The [BLS October schedule](https://www.bls.gov/schedule/2026/10_sched.htm)
still lists the October 2 Employment Situation, October 14 CPI and October 15
PPI releases at 08:30 Eastern. The [Federal Reserve calendar](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm),
last updated September 16, still lists October 27–28 and December 8–9 without
future statement or press-conference clock times. Existing date-only records
remain date-only. `calendarReviewedOn` was advanced to September 30 only after
these two schedules were checked.

Next: AAPL, AMZN, ANET, ARM, AVGO, BE, CRDO, CRWV, GOOGL and KLAC. Keep empty,
historical-only, inaccessible and tentative sources pending unless a
first-party source supplies a confirmed date or an explicit current no-events
state.

## Verification and deployment

The complete local gate passed after the September 30 rollover: ESLint had zero
errors and one pre-existing warning, Node tests passed 159/159, Python tests
passed 451/451, Next.js built all 55 pages, and `compileall` plus
`git diff --check` passed. Calendar commit `835ccd3` deployed Ready to the
Vercel branch preview. Railway staging reported success without redeploying
because no watched monitor path changed. The Git Data tree exactly matched the
locally staged tree (`8bf37c9`). A post-deployment canonical-page browser
refresh was attempted, but the existing Chrome DevTools connection timed out;
record this as an unverified visual check rather than inferring success from the
deployment alone.

## Follow-up company review (01:43 JST)

Reviewed the next ten oldest pending company sources. No first-party source
supplied a new confirmed future earnings release or call, so only
`lastAttemptedOn` advanced for these companies. Every `lastCheckedOn` remains
unchanged.

| Ticker | Result | Official source / exact blocker |
| --- | --- | --- |
| AAPL | Pending | [Investor Relations](https://investor.apple.com/investor-relations/default.aspx) exposes the completed July 30 fiscal Q3 call but no future earnings announcement. |
| AMZN | Pending | [Events](https://ir.aboutamazon.com/events/default.aspx) has an empty Upcoming Events section; the latest indexed first-party earnings call is the completed July 30 Q2 event. |
| ANET | Pending | [Events and Presentations](https://investors.arista.com/events-and-presentations/default.aspx) remained inaccessible through the official endpoint. Indexed first-party results expose completed Q2 results only. No access control was bypassed. |
| ARM | Pending | [Investor Relations](https://investors.arm.com/) labels November 4, 2026 as a tentatively proposed earnings date and says upcoming investor events are to be announced. A tentative date is not registered. |
| AVGO | Pending | [Financial News](https://investors.broadcom.com/financial-information/financial-news-releases) exposes the completed September 2 fiscal Q3 release but no future earnings announcement. |
| BE | Pending | [Events Calendar](https://investor.bloomenergy.com/events-and-presentations/events-calendar/) exposes an empty Upcoming Events section without an explicit current no-events statement. |
| CRDO | Pending | [Events](https://investors.credosemi.com/news-events/events/default.aspx) exposes empty Upcoming & Recent Events and Archived Events sections. |
| CRWV | Pending | [Events and Presentations](https://investors.coreweave.com/events-and-presentations/default.aspx) exposes empty Upcoming & Recent Events and Archived Events sections. |
| GOOGL | Pending | [Events](https://abc.xyz/investor/events/default.aspx) exposes only the page shell; indexed first-party material ends with the completed July 22 Q2 event. |
| KLAC | Pending | [Events and Presentations](https://ir.kla.com/events-presentations/) remained inaccessible through the official endpoint. Indexed first-party material exposes completed July 28 fiscal Q4 results only. No access control was bypassed. |

The BLS October schedule still lists the October 2 Employment Situation,
October 14 CPI and October 15 PPI releases at 08:30 Eastern. The Federal
Reserve calendar still lists October 27–28 and December 8–9 without future
statement or press-conference clock times. No event or date-only record
changed.

Next: ADBE, AMD, ASML, COHR, CRWD, DELL, GEV, INTC, LRCX and META. Continue
rotating through the full roster; retain tentative, empty, historical-only and
inaccessible sources as pending unless first-party evidence becomes
conclusive.

Calendar commit `9240613` used the exact locally staged tree
(`ecf4aa5`). Vercel deployed it Ready to the branch preview and Railway staging
reported success without redeploying because no watched monitor path changed.
The canonical Japanese calendar loaded in the browser with 17 schedules,
including the unchanged October BLS releases and date-only October 28 and
December 9 FOMC entries.

## Midday company review (13:49 JST)

Reviewed the next ten oldest company sources. Nine checks were conclusive and
advance both `lastAttemptedOn` and `lastCheckedOn`; ASML's official redirect
remained inaccessible, so only its attempt date advances. No new calendar event
was added because the two confirmed calls already match the registered records.

| Ticker | Result | Official source / evidence |
| --- | --- | --- |
| ADBE | Confirmed unchanged | [Events and presentations](https://www.adobe.com/investor-relations/events-presentations.html) still lists the fiscal Q4 and FY2026 earnings call on December 9 at 2:00 p.m. Pacific, matching the registered call. |
| AMD | Confirmed no current event | [IR calendar](https://ir.amd.com/news-events/ir-calendar) explicitly says there are no upcoming events scheduled. |
| ASML | Pending | The former [official financial calendar](https://www.asml.com/en/investors/financial-calendar) redirects to `investor.asml.com/financial-events`, which remained inaccessible through the available lawful endpoint. The existing October 14 date-only record is unchanged and no access control was bypassed. |
| COHR | Confirmed no current event | [Events](https://ir.coherent.com/news-events/events) says more events are coming soon and shows only completed events. |
| CRWD | Confirmed no future earnings item | [Events and presentations](https://ir.crowdstrike.com/events-and-presentations/) lists presentations and past events only; no future earnings event is shown. |
| DELL | Confirmed no current event | [Upcoming events](https://investors.delltechnologies.com/news-events/upcoming-events) says more events are coming soon. |
| GEV | Confirmed unchanged | [Investor events](https://www.gevernova.com/investors/events) still lists the October 28 fiscal Q3 webcast at 7:30 a.m. Eastern, matching the registered webcast. |
| INTC | Confirmed no current event | [IR calendar](https://www.intc.com/news-events/ir-calendar) explicitly says there are no upcoming events scheduled. |
| LRCX | Confirmed no future earnings item | [Events](https://investor.lamresearch.com/events) lists a November 3 annual meeting, not an earnings release or call. |
| META | Confirmed no current event | [Investor events](https://investor.atmeta.com/investor-events/) says to stay tuned for upcoming events and shows no current item. |

The BLS October schedule remains unchanged: Employment Situation on October 2,
CPI on October 14 and PPI on October 15, each at 08:30 Eastern. The Federal
Reserve still lists its October 27–28 and December 8–9 meetings without future
statement or press-conference clock times. Existing date-only records remain
date-only.

Next: MSFT, MU, NBIS, NFLX, NVDA, PANW, PLTR, SNDK, TSLA and TSM. This will
finish the September 30 rotation through all 40 companies. Continue to retain
inaccessible or inconclusive sources as pending.

Calendar commit `e784e87` used the exact locally staged and connector-created
tree (`1bf3130`). The complete local gate passed: ESLint had zero errors and one
pre-existing warning, Node tests passed 163/163, Python tests passed 451/451,
Next.js built all 55 routes, and `compileall` plus `git diff --check` passed.
Vercel deployment `dpl_EwZRZucxgH9zkM9fNtqVeaUQK2JY` reached Ready; Railway
staging reported success without redeploying because no watched monitor path
changed. The canonical Japanese calendar loaded with the September 30 official
confirmation date, 17 schedules, and unchanged date-only ASML/FOMC entries.

## Final company review (14:47 JST)

Reviewed the final ten company sources in the September 30 rotation. Seven
checks were conclusive and advance both `lastAttemptedOn` and `lastCheckedOn`;
three inaccessible or uninspectable sources advance only `lastAttemptedOn`.
No new calendar event was added because the confirmed calls already match the
registered records and the remaining conclusive sources publish no date.

| Ticker | Result | Official source / evidence |
| --- | --- | --- |
| MSFT | Confirmed no announced date | [Investor Relations](https://www.microsoft.com/en-us/investor/default) says the next earnings release will be announced soon. This current-status page replaces the empty upcoming-events URL as the tracked source. |
| MU | Confirmed unchanged | [Fiscal Q4 announcement](https://investors.micron.com/news/press-release/2026/Micron-Technology-to-Report-Fiscal-Fourth-Quarter-Results-on-September-30-2026/default.aspx) still lists September 30 at 2:30 p.m. Mountain, matching the registered call. |
| NBIS | Confirmed no current event | [Investor events](https://nebius.com/investor-events) explicitly says there are no upcoming events yet. |
| NFLX | Confirmed unchanged | [Q3 announcement](https://ir.netflix.net/investor-news-and-events/financial-releases/press-release-details/2026/Netflix-to-Announce-Third-Quarter-2026-Financial-Results/default.aspx) still lists October 20 at approximately 1:01 p.m. Pacific, matching the registered release. |
| NVDA | Pending | [Events and presentations](https://investor.nvidia.com/events-and-presentations/default.aspx) remained inaccessible through the available lawful endpoint. No access control was bypassed. |
| PANW | Pending | [Events and presentations](https://investors.paloaltonetworks.com/events-and-presentations/default.aspx) remained inaccessible through the available lawful endpoint. No access control was bypassed. |
| PLTR | Pending | [Events](https://investors.palantir.com/events) exposed only the page shell without an inspectable event list or explicit no-events statement. |
| SNDK | Confirmed no future earnings item | [Events](https://investor.sandisk.com/news-events/events) shows past events only; its latest listed earnings event is the completed August 5 call. |
| TSLA | Confirmed no announced date | [Investor Relations](https://ir.tesla.com/) lists a 2026 Q3 row with the earnings-date field still blank. |
| TSM | Confirmed unchanged | [Financial calendar](https://investor.tsmc.com/english/financial-calendar) still lists the October 15 results conference and call at 14:00 Asia/Taipei, matching the registered call. |

The BLS October schedule remains unchanged: Employment Situation on October 2,
CPI on October 14 and PPI on October 15, each at 08:30 Eastern. The Federal
Reserve still lists its October 27–28 and December 8–9 meetings without future
statement or press-conference clock times. Existing date-only records remain
date-only.

All 40 roster companies now have a September 30 attempt. Restart the next
rotation from the oldest or still-unreviewed sources; retain inaccessible and
uninspectable sources as pending until first-party evidence becomes conclusive.

The complete local gate passed after the final batch: ESLint reported zero
errors and one pre-existing warning, Node tests passed 163/163, Python tests
passed 451/451, the Next.js production build succeeded, and `compileall` plus
`git diff --check` passed.

Calendar commit `f335fcc` used the exact locally staged and connector-created
tree (`83cc89d`). Vercel deployment
`dpl_EvkzCRjKyP76fZ6MX4VUvLLZgMcL` reached Ready. The canonical Japanese
calendar loaded with the September 30 official confirmation date, 17 schedules,
the unchanged Micron/TSMC/Netflix calls, and date-only ASML/FOMC entries.

## Second rotation, pending-first review (17:49 JST)

Rechecked the first ten still-unreviewed company sources after completing the
40-company daily rotation. No source supplied a new confirmed earnings date.
Because every company already has a September 30 attempt, no duplicate
`lastAttemptedOn` value was written; pending `lastCheckedOn` values remain
unchanged.

| Ticker | Result | Official source / evidence |
| --- | --- | --- |
| AAPL | Pending | [Investor Relations](https://investor.apple.com/investor-relations/default.aspx) exposed the Investor Updates and Quarterly Earnings Reports headings without an inspectable current item. |
| AMZN | Pending | [Events](https://ir.aboutamazon.com/events/default.aspx) exposed empty Upcoming and Past Events sections without an explicit current-status statement. |
| ANET | Pending | [Events and presentations](https://investors.arista.com/events-and-presentations/default.aspx) remained inaccessible through the available lawful endpoint. No access control was bypassed. |
| ARM | Pending | [Investor Relations](https://investors.arm.com/) still showed the completed July 29 quarter as its latest investor event; no confirmed future earnings item was present. |
| AVGO | Pending | [Financial news](https://investors.broadcom.com/financial-information/financial-news-releases) still ended with the completed September 2 fiscal Q3 result and contained no future earnings announcement. |
| BE | Pending | [Events calendar](https://investor.bloomenergy.com/events-and-presentations/events-calendar/) exposed an empty Upcoming Events section without an explicit no-events statement. |
| CRDO | Pending | [Events](https://investors.credosemi.com/news-events/events/default.aspx) exposed section headings without an inspectable future item. |
| CRWV | Pending | [Events and presentations](https://investors.coreweave.com/events-and-presentations/default.aspx) exposed section headings without an inspectable future item. |
| GOOGL | Pending | [Events and presentations](https://abc.xyz/investor/events/default.aspx) exposed the page shell without an inspectable current event. |
| KLAC | Pending | [Events and presentations](https://ir.kla.com/events-presentations/) remained inaccessible through the available lawful endpoint. No access control was bypassed. |

The BLS October schedule remains October 2 for the Employment Situation,
October 14 for CPI and October 15 for PPI, each at 08:30 Eastern. The Federal
Reserve still lists October 27–28 and December 8–9 without future statement or
press-conference clock times. No calendar record changed.

Next: LITE, MRVL, NOW, NVDA, PANW, PLTR, SKHY, SNOW, VRT and QCOM. Preserve
all pending blockers until first-party evidence becomes conclusive.

## Second rotation, remaining pending sources (18:44 JST)

Rechecked the remaining pending-first batch against current first-party pages.
No source supplied a new confirmed earnings date. Because each company already
has a September 30 attempt, no duplicate `lastAttemptedOn` value was written;
inconclusive `lastCheckedOn` values remain unchanged.

| Ticker | Result | Official source / evidence |
| --- | --- | --- |
| LITE | Pending | [Events and presentations](https://investor.lumentum.com/events-and-presentations/default.aspx) exposed Latest Events and archived-section headings without an inspectable current item or explicit no-events statement. |
| MRVL | Pending | [Events and presentations](https://investor.marvell.com/events-and-presentations/default.aspx) remained inaccessible through the available lawful endpoint. No access control was bypassed. |
| NOW | Pending | [Events and presentations](https://investor.servicenow.com/events-and-presentations/default.aspx) exposed archived sections but no inspectable current event or explicit no-events statement. |
| NVDA | Pending | [Events and presentations](https://investor.nvidia.com/events-and-presentations/default.aspx) remained inaccessible through the available lawful endpoint. No access control was bypassed. |
| PANW | Pending | [Events and presentations](https://investors.paloaltonetworks.com/events-and-presentations/default.aspx) remained inaccessible through the available lawful endpoint. No access control was bypassed. |
| PLTR | Pending | [Events](https://investors.palantir.com/events) again exposed only the page shell without an inspectable event list or explicit no-events statement. |
| SKHY | Pending | [Official IR newsroom](https://news.skhynix.com/en/category/ir/) still ended with the completed July 29 Q2 result and contained no confirmed future earnings announcement. |
| SNOW | Pending | [Events and presentations](https://investors.snowflake.com/events-and-presentations/default.aspx) exposed an empty Upcoming Events section without an explicit no-events statement. |
| VRT | Pending | [Events and presentations](https://investors.vertiv.com/events-presentations/events-presentations/default.aspx) exposed the investor navigation and a 2026 Investor Conference link but no confirmed future earnings event. |
| QCOM | Pending | [Investor events](https://investor.qualcomm.com/news-events/investor-events/default.aspx) exposed an empty Upcoming Events section without an explicit no-events statement. |

The BLS schedule still lists the October 2 Employment Situation, October 14
CPI and October 15 PPI at 08:30 Eastern. The Federal Reserve still lists the
October 27–28 and December 8–9 meetings without future statement or
press-conference clock times. No economic-calendar record changed and no time
was inferred.

The full pending-first pass is complete for September 30. On the next date
rotation, restart with AAPL, AMZN, ANET, ARM, AVGO, BE, CRDO, CRWV, GOOGL and
KLAC unless a newer first-party announcement makes another company higher
priority.
