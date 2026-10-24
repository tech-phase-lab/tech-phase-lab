# Employment-release measurement

Owner requested measurement for the September 2026 U.S. Employment Situation,
scheduled by BLS for 2026-10-02 08:30 EDT / 12:30 UTC / 21:30 JST.
Official schedule: https://www.bls.gov/schedule/news_release/empsit.htm
Official report: https://www.bls.gov/news.release/empsit.nr0.htm

Preflight found two scope gaps: the reporter query lacked standalone
unemployment-rate and hourly-earnings posts, and the result parser lacked average
hourly earnings and separator-labelled results without an explicit Actual word.
The query now includes payrolls, unemployment rate and hourly earnings, within
512 characters (474 total). The parser keeps signed results and source units,
distinguishes MoM/YoY wages and requires percent units for rates/wage changes.
Estimate/previous labels and malformed digit grouping are not actual results.
Intake uses the same projection as publication. Do not associate a later metric's
Actual with an earlier metric label. A combined post's unsupported fields or
revisions must still be audited; this change does not promise every narrative
format is recognized or that every reporter will post all required fields.

Numerical flashes use deterministic JA/EN field labels, not an LLM. There is no
separate AI translation start/end clock; market_result_publications.published_at
and processing_ms record bilingual backend generation. Source published_at,
signal_events.observed_at, publicAt, API observation and browser observation are
distinct clocks. Measure each against the actual official release when known,
and preserve the scheduled-release comparison separately.

A one-time report is scheduled in the owner's current chat for 21:35 JST.
Automation 6abfa01aaa6c8191bc49ee7873944e96 does not replace or pause hourly
development or the separate 24-hour report. It must report missing employment,
unemployment, wage MoM/YoY and revisions, not hide them behind an overall count.
No live success is established by preflight tests. Do not reset the acceptance
window or erase the earlier ASTS publication failure.

If /data/audits/employment-20261002.jsonl exists, inspect its bounded one-time
sampler output alongside DB records. Its API first-seen clock is an observation
bound, not the first possible screen appearance. An absent observation is not
zero latency. Credentials must never enter an audit file or report.
