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
