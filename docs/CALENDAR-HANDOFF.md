# Calendar verification handoff

Last updated: 2026-09-23

This file records the latest manual official-source review. A pending entry must
keep `lastCheckedOn` null in `calendar-coverage.json`; an empty or
JavaScript-only IR page is not evidence that no event exists.

## Daily economic-source review

- BLS: the 2026 annual release schedule was checked. The October through
  December Employment Situation, CPI and PPI dates and 08:30 Eastern times in
  `calendar.ts` still match the official schedule.
- Federal Reserve: the FOMC calendar was checked. October 27-28 and December
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

Next company batch starts with CRDO, then CRM, CRWD, CRWV, DELL, GEV, GOOGL,
INTC, KLAC and LITE. Pending rows above should be retried when their official
pages or feeds become inspectable.
