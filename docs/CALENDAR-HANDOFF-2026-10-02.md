# Calendar handoff — 2026-10-02 JST

`lib/research/calendar.ts`, `lib/research/calendar-coverage.json`, and
`docs/RESEARCH-TOOLS.md` were reviewed before other development. This pass
checked the 10 oldest unreviewed companies plus the daily BLS and Federal
Reserve schedules. No company event was added: none of the official sources
published a firm future earnings release or call date and time.

## Company review

| Ticker | Official source reviewed | Result / exact blocker |
| --- | --- | --- |
| AAPL | https://investor.apple.com/investor-relations/default.aspx | Current IR material reaches FY2026 Q3 results; no future earnings announcement was published. |
| AMZN | https://ir.aboutamazon.com/events/default.aspx | Events and quarterly-results pages reach the 2026 Q2 release; no future earnings event was published. |
| ANET | https://investors.arista.com/events-and-presentations/default.aspx | Direct page remained inaccessible to the checker; the official indexed page showed no upcoming event and only prior Q2 results. Pending. |
| ARM | https://investors.arm.com/ | Direct page returned 403. The official indexed result labels November 4 as a tentatively proposed date, so it is not calendar evidence. Pending. |
| AVGO | https://investors.broadcom.com/financial-information/financial-news-releases | Official news reaches the September 2026 Q3 result; no Q4 date was published. |
| BE | https://investor.bloomenergy.com/events-and-presentations/events-calendar/ | Official calendar exposed no future event; the latest indexed earnings announcement remained Q2. |
| CRDO | https://investors.credosemi.com/news-events/events/default.aspx | Official events reach the September 1 FY2027 Q1 result and later conferences; no future earnings event was published. |
| CRWV | https://investors.coreweave.com/events-and-presentations/default.aspx | Events page exposed no future earnings event; official results remain at 2026 Q2. |
| GOOGL | https://abc.xyz/investor/events/default.aspx | Official events exposed no future earnings event; indexed official results showed only prior events/results. |
| LITE | https://investor.lumentum.com/events-and-presentations/default.aspx | Page exposed a September 2026 shell without usable event details; official quarterly results remain at FY2026 Q4. Pending. |

`lastAttemptedOn` advanced to `2026-10-02` for these 10 entries. Their
`lastCheckedOn` values were deliberately left unchanged/null because no firm
future schedule was confirmed.

## Macro review

- BLS official schedule still lists September 2026 Employment Situation on
  October 2 at 08:30 ET, CPI on October 14 at 08:30 ET, and PPI on October 15
  at 08:30 ET: https://www.bls.gov/schedule/2026/10_sched.htm
- Federal Reserve official calendar still lists FOMC meetings on October
  27–28 and December 8–9, 2026, without publishing future statement or press
  conference clock times: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm

The existing date-only FOMC records remain date-only; no midnight or estimated
time was introduced. `calendarReviewedOn` advanced only after both schedules
were checked.

## Second company batch

The next 10 oldest company records were reviewed against first-party investor
pages. ASML's official quarterly-results page now supplies both clock times, so
the former date-only record was replaced by a 07:00 Amsterdam results release
and a separate 15:00 investor call on October 14. Adobe and GE Vernova were
reconfirmed without changing their stored schedules. No estimated date was
added.

| Ticker | Official source reviewed | Result / exact blocker |
| --- | --- | --- |
| ADBE | https://www.adobe.com/investor-relations/events-presentations.html | Reconfirmed the existing December 9 fiscal Q4/FY2026 call at 14:00 Pacific. |
| AMAT | https://ir.appliedmaterials.com/events?tab=upcoming | The page labels November 12 only as projected, so the earnings date remains pending and `lastCheckedOn` did not advance. |
| AMD | https://ir.amd.com/news-events/ir-calendar | The official calendar explicitly showed no upcoming events; no future earnings announcement was published. |
| ASML | https://investor.asml.com/quarterly-results | Confirmed October 14 results release at 07:00 and investor call at 15:00 Amsterdam time; recorded as separate events. |
| COHR | https://ir.coherent.com/news-events/events | Official events still end with the August 12 FY2026 Q4 call; no future earnings event was published. |
| CRM | https://investor.salesforce.com/events-and-presentations/default.aspx | Upcoming events contain no earnings event; official earnings material remains at FY2027 Q2. |
| CRWD | https://ir.crowdstrike.com/events-and-presentations/ | The official page says more events are coming soon and lists no future earnings event. |
| DELL | https://investors.delltechnologies.com/news-events/upcoming-events | The official page says more events are coming soon; no future earnings event was published. |
| GEV | https://www.gevernova.com/investors/events/3rd-quarter-2026-earnings-webcast | Reconfirmed the existing October 28 Q3 webcast at 07:30 Eastern. |
| INTC | https://www.intc.com/news-events/ir-calendar | The official calendar explicitly showed no upcoming events; no future earnings announcement was published. |

`lastAttemptedOn` advanced to `2026-10-02` for all 10 entries. The nine
conclusive/reconfirmed checks advanced `lastCheckedOn`; AMAT remains pending on
its explicitly projected date. The BLS and Federal Reserve schedules had
already been checked earlier on the same date and were not rewritten.
