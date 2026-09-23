# Calendar verification handoff

Last updated: 2026-09-23

This file records the latest manual official-source review. A pending entry must
keep `lastCheckedOn` null in `calendar-coverage.json`; an empty or
JavaScript-only IR page is not evidence that no event exists.

## Daily economic-source review

- BLS: the 2026 annual release schedule was rechecked on 2026-09-23. The October through
  December Employment Situation, CPI and PPI dates and 08:30 Eastern times in
  `calendar.ts` still match the official schedule.
- Federal Reserve: the FOMC calendar was rechecked on 2026-09-23. October 27-28 and December
  8-9 are confirmed meeting dates. The page does not yet publish policy
  announcement or press-conference times for those meetings, so only the final
  dates are stored and no clock time is inferred.

## Company batch reviewed on 2026-09-23

| Ticker | Result | Official source / blocker |
| --- | --- | --- |
| AAPL | Pending | The IR page exposed Quarterly Earnings Reports and Investor Updates headings but no dated upcoming item or explicit “no upcoming events” statement. |
| ADBE | Confirmed | Adobe IR lists the fiscal Q4 and FY2026 earnings call for December 9, 2026 at 2:00 p.m. Pacific. The call time is stored separately from any release time. |
| AMAT | Checked; omitted | The official fiscal calendar labels the November 12 Q4 earnings call date “Projected”. It remains excluded because estimates are not confirmed dates. |
| AMD | Checked; no event added | The official IR calendar explicitly states that no upcoming events are scheduled. |
| AMZN | Pending | The official Events page exposed an Upcoming Events heading with no item and no explicit absence statement. |
| ANET | Pending | The first-party RSS endpoint is public XML, but the web reader rejected its content type and a direct public GET timed out at the execution proxy. No conclusive schedule was available. |
| ARM | Pending | The first-party newsroom feed is public RSS, but the web reader rejected its content type and a direct public GET timed out at the execution proxy. No conclusive schedule was available. |
| AVGO | Pending | The official financial-news page showed past Q3 results but no future scheduling announcement; no accessible first-party earnings calendar or explicit absence statement was found. |
| BE | Pending | The official event calendar's Upcoming Events section was empty without an explicit absence statement. |
| COHR | Pending | The official financial-releases page showed the August FY2026 results and timing announcement but no future earnings schedule or explicit absence statement. |

## Second company batch reviewed on 2026-09-23

| Ticker | Result | Official source / blocker |
| --- | --- | --- |
| CRDO | Pending | The official IR events page exposed Upcoming & Recent Events and Archived Events headings, but no dated item or explicit absence statement. |
| CRM | Pending | The official events page exposed an Upcoming & Recent Events heading, but no dated item or explicit absence statement. |
| CRWD | Pending | The official events page returned HTTP 403 to the reviewer. The accessible first-party search result only identified the past August 26 fiscal Q2 2027 call, not a future event. |
| CRWV | Pending | The official events page exposed an Upcoming & Recent Events heading with no item or explicit absence statement; the IR overview only showed the past Q2 2026 results. |
| DELL | Checked; no event added | The official Upcoming Events page explicitly states that more events are coming soon and lists no current event. |
| GEV | Confirmed | GE Vernova IR lists its Q3 2026 earnings webcast for October 28, 2026 from 7:30 to 8:30 a.m. EDT. The webcast start is stored separately from any release time. |
| GOOGL | Pending | The official Alphabet events page exposed the IR shell without a dated item or explicit absence statement. |
| INTC | Checked; no event added | The official IR calendar explicitly states that no upcoming events are scheduled at this time. |
| KLAC | Pending | The official events URL returned an internal access error, so its schedule could not be inspected conclusively. |
| LITE | Pending | The official Events & Presentations page exposed a Latest Events heading, but no dated item or explicit absence statement. |

Next company batch starts with LRCX, then META, MRVL, MSFT, NBIS, NOW, NVDA,
ORCL, PANW and PLTR. Pending rows above should be retried when their official
pages become inspectable or provide an explicit schedule state.

## Third company batch reviewed on 2026-09-23

| Ticker | Result | Official source / blocker |
| --- | --- | --- |
| LRCX | Checked; no event added | The official Events & Presentations page explicitly states “No events to display” under Upcoming Events. |
| META | Checked; no event added | The official Upcoming Events page explicitly states “Stay tuned for upcoming events.” |
| MRVL | Pending | The official Events & Presentations URL was not accessible to the reviewer, so no current schedule state could be verified. |
| MSFT | Checked; no earnings event added | The official Upcoming Events page lists the December 8, 2026 annual shareholders meeting, but no earnings release or call. The non-earnings event is outside this selected calendar. |
| NBIS | Pending | The official Investor Hub shows two recent September investor conferences and the newsroom shows the past Q2 results, but neither publishes a future earnings event or an explicit absence statement. |
| NOW | Pending | The official Events & Presentations page exposed archived-event sections without a current item or explicit absence statement. |
| NVDA | Pending | The official events endpoint was inaccessible. The latest accessible first-party event announcement concerned the already-past September 10 investor conference and does not establish the current future schedule. |
| ORCL | Pending | The official page exposed Featured Event and Upcoming Events headings without an item or explicit absence statement. |
| PANW | Pending | The official Events & Presentations URL was not accessible to the reviewer, so no current schedule state could be verified. |
| PLTR | Pending | The official Events page exposed only its navigation shell, with no dated item or explicit absence statement. |

Next company batch starts with QCOM, then SKHY, SNDK, SNOW, TSLA and VRT,
followed by pending retries for AAPL, AMZN, ANET and ARM. Other pending rows
remain queued for another first-party check.

## Fourth company batch reviewed on 2026-09-23

| Ticker | Result | Official source / blocker |
| --- | --- | --- |
| QCOM | Checked; no earnings event added | The official Investor Events page had no upcoming item, while the IR overview listed the September 22-24 Snapdragon Summit and the past June Investor Day. Neither source published a future earnings release or call. |
| SKHY | Pending | The official English IR newsroom showed the past Q2 results and July 28 conference-call invitation as its latest earnings items, but it is not a forward schedule and did not explicitly state that no future event is announced. |
| SNDK | Checked; no earnings event added | The official IR overview explicitly says more events are coming soon and lists only past events. The full Events page also contained no future entry. |
| SNOW | Pending | The official Events & Presentations page exposed an empty Upcoming Events section without an item or explicit absence statement. |
| TSLA | Checked; no earnings event added | Tesla's official Documents and Events table currently ends with Q2 2026 on July 22; it does not list a Q3 2026 earnings date. No date was inferred from prior years. |
| VRT | Pending | The official Events & Presentations page exposed empty Latest Events and Latest Presentation sections without an item or explicit absence statement. |
| AAPL | Pending | The official IR page again exposed Investor Updates and Quarterly Earnings Reports headings without a future item or explicit absence statement. |
| AMZN | Pending | The official Events page again exposed an empty Upcoming Events section without an item or explicit absence statement. |
| ANET | Pending | The first-party press-release RSS endpoint still returned an unsupported XML content type to the reviewer, so no conclusive current schedule could be verified. |
| ARM | Pending | The first-party newsroom RSS endpoint still returned an unsupported RSS content type to the reviewer, so no conclusive current schedule could be verified. |

The daily BLS and Federal Reserve review was also repeated on 2026-09-23. The
October through December BLS dates and 08:30 Eastern times remain unchanged;
the FOMC page still publishes only the October 27-28 and December 8-9 meeting
dates, without future statement or press-conference clock times.

Next company batch starts with AVGO, then BE, COHR, CRDO, CRM, CRWD, CRWV,
GOOGL, KLAC and LITE. Other pending rows remain queued for another first-party
check when their pages become inspectable or publish an explicit schedule state.

## Fifth company batch reviewed on 2026-09-23

| Ticker | Result | Official source / blocker |
| --- | --- | --- |
| AVGO | Pending | The current official Financial News page ends with the September 2 fiscal Q3 results and contains no future scheduling announcement. No first-party calendar or explicit absence statement was available. |
| BE | Pending | The official Event Calendar again exposed an empty Upcoming Events section without an item or explicit absence statement. |
| COHR | Pending | The current official Financial Releases page ends with the August 12 fiscal 2026 results and contains no fiscal Q1 2027 timing announcement or explicit absence statement. |
| CRDO | Pending | The official Events page again exposed empty Upcoming & Recent Events and Archived Events sections without a dated item or explicit absence statement. |
| CRM | Pending | The official Events page showed the past September 16 Dreamforce investor session as its latest accessible item, but no future earnings event or explicit absence statement. |
| CRWD | Checked; no earnings event added | The official Events & Presentations page was accessible in this review. It labels every displayed item as a Past Event and ends with the September 10 investor conferences; the latest earnings call shown is the past August 26 fiscal Q2 2027 call. |
| CRWV | Pending | The official Events & Presentations page again exposed an empty Upcoming & Recent Events section without an item or explicit absence statement. |
| GOOGL | Pending | The official Alphabet Events & Presentations page exposed only its page shell without a dated item or explicit absence statement. |
| KLAC | Pending | The official Events & Presentations URL still returned an internal access error, so its schedule could not be inspected. |
| LITE | Pending | The official Events page exposed empty Latest Events and Latest Presentation sections without an item or explicit absence statement. |

The BLS annual schedule was rechecked on 2026-09-23 and the October through
December Employment Situation, CPI and PPI dates and 08:30 Eastern times remain
unchanged. The Federal Reserve calendar was also rechecked; it still publishes
only the October 27-28 and December 8-9 meeting dates for the remaining 2026
meetings, without future statement or press-conference clock times.

Next company batch retries MRVL, NBIS, NOW, NVDA, ORCL, PANW, PLTR, SKHY, SNOW
and VRT. Other pending rows remain queued until an official source becomes
conclusive.

## Sixth company batch reviewed on 2026-09-23

The schedule-specific official URLs below were rechecked. All ten entries remain
pending: an empty upcoming section, a page containing only past items, or an
inaccessible page is not enough evidence to advance `lastCheckedOn`.

| Ticker | Result | Official source / blocker |
| --- | --- | --- |
| MRVL | Pending | The official Marvell Events & Presentations page was not accessible through the review connection, so no current schedule could be established. |
| NBIS | Pending | The investor hub loaded and showed September 2026 investor conferences, but no future earnings announcement or explicit statement that none is scheduled. |
| NOW | Pending | The official page exposed archived events and presentations only; it did not provide a dated upcoming earnings item or an explicit no-events statement. |
| NVDA | Pending | The official NVIDIA events and presentations page was not accessible through the review connection. |
| ORCL | Pending | The official page exposed empty Featured Event and Upcoming events headings without an explicit no-events statement. |
| PANW | Pending | The official Palo Alto Networks events page was not accessible through the review connection. |
| PLTR | Pending | The official events URL returned only the investor-relations navigation shell, with no inspectable schedule state. |
| SKHY | Pending | The official IR newsroom listed past results and invitations through August 2026, but no future earnings announcement or explicit no-events statement. |
| SNOW | Pending | The official page exposed an empty Upcoming Events heading without an explicit no-events statement. |
| VRT | Pending | The official page exposed empty Latest Events and Latest Presentation headings without an explicit no-events statement. |

BLS and Federal Reserve sources were also rechecked on 2026-09-23. The BLS
October releases still show Employment Situation on October 2, CPI on October
14 and PPI on October 15 at 08:30 Eastern. The Federal Reserve still lists the
October 27-28 and December 8-9 FOMC meetings without publishing future statement
or press-conference clock times. No calendar event changed.

Next company batch starts with AAPL, then AMZN, ANET, ARM, AVGO, BE, COHR,
CRDO, CRM and CRWV. These pending entries should be retried through their
schedule-specific URLs when the blockers above change.
