# September employment report: delivery failure and recovery

The October 2, 2026 U.S. September employment release failed timely delivery.
The existing acceptance observation remains failed; it has not been reset.

## Observed timing (JST)

- Scheduled official release: 21:30:00. Actual first official HTTP publication
  was not continuously observed.
- Wall St Engine source post: 21:30:37.000.
- First recovered service acquisition: 21:49:12.663.
- Japanese/English backend publication: 21:49:15.319.
- Source-to-acquisition: 1115.663 seconds (18 minutes 35.663 seconds).
- Acquisition-to-publication: 2.656 seconds.
- Source-to-publication: 1118.319 seconds (18 minutes 38.319 seconds).
- Numeric bilingual generation: deterministic labels, rounded processing time
  0 ms; this does not prove literally zero elapsed time or an LLM translation.
- Five-second observation through 21:40 found no delivered employment result,
  with no measurement errors. Later recovery is not an on-time success.
- Final API observation at 21:59:57.899727 showed the recovered result.
- Calendar Japanese/English results and same-day schedule were observed by
  21:59:34. Home Japanese/English news and Japanese top carousel were observed
  by 22:02. These are observation upper bounds, not exact first-render clocks.

The source clock was rechecked as 21:30:37. An earlier commentary misread the
seconds as 07 and overstated acquisition latency by 30 seconds. The corrected
measurements above are authoritative.

## Failure and repair

The source post existed. Intake discarded separator-free labels such as
NONFARM PAYROLLS +29K; it also did not recognize AVG. hourly earnings or retain
all supported fields from a combined post. The repair preserves metric/value
association, signs, units and monthly/annual wage periods, with estimates kept
separate. The recovered post reports +29K payrolls, unemployment 4.2% and wage
 growth 3.0% YoY; it does not contain wages MoM or prior-month revisions.

The calendar already contained the correct October 2 schedule, but the default
upcoming-only filter hid it after 21:30. Today-and-upcoming now retains it in
both selected display timezones, without claiming that scheduled events arrived.

The first repair also exposed two invalid historical projections: a scheduled
08:30 clock was interpreted as payrolls 08, and Eurozone CPI was presented as
unqualified CPI. Both were observed in the public backend feed and are part of
the accuracy failure. The final repair rejects schedule/date numbers and
explicit non-U.S. indicators. Final public API observation confirmed both
invalid projections were absent. Historical diagnostic evidence is preserved.

## Official results and limitations

Official September values: payrolls +29,000; unemployment 4.2%; average hourly
earnings +0.1% MoM and +3.0% YoY. July payrolls were revised from +21,000 to
-10,000; August from +162,000 to +133,000, a combined 60,000 downward revision.

The calendar's complete official result was separately verified and saved.
This is reviewed recovery, not automated official-source ingestion. Direct
server access to the official release returned HTTP 403. The calendar shows
source-post and verified official result entries separately for one release.
No claim of complete automatic coverage, full-day accuracy or future no-miss
performance is justified.

Final integrated validation passed: 209 Node tests, 602 Python tests, lint,
production build, source compilation and whitespace checks. Application checks
and both preview deployments succeeded. Main and billing caps were unchanged.

## Public source references

- https://x.com/wallstengine/status/2105998888536846505
- https://www.bls.gov/news.release/archives/empsit_10022026.htm
- https://www.bls.gov/schedule/news_release/empsit.htm
