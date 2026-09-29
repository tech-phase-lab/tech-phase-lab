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
