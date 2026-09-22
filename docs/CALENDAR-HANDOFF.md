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
