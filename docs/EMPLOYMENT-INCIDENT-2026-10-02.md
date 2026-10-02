# Employment release delivery failure — October 2, 2026

The September release was scheduled for 12:30 UTC / 21:30 JST. This event
failed timely delivery. Do not reset or pass the existing acceptance window.

The bounded sampler was armed at 12:27:24.415 UTC, sampled the readonly DB
and authenticated news API every five seconds from 12:29:30 to 12:40 UTC,
and recorded no ECON event or result publication through 12:37:23 UTC.
Eight heartbeats and no sampler errors were present at that observation.
Read-only live inspection also found no new signal event since 12:29 UTC.
The API returned HTTP 200; an empty result was not evidence of no source post.

An independent, budget-reserved X recent search found one post with no next
page in the checked 12:29 UTC to audit-time-minus-20-seconds interval:
https://x.com/wallstengine/status/2105998888536846505
Source publication: **2026-10-02T12:30:07.000Z**. It reported payrolls +29K,
unemployment 4.2% and average hourly earnings YoY 3.0%, with separately
labelled estimates. The old parser returned None because it required Actual
or a colon; it also did not recognize AVG. and retained only one metric.
The adapter discarded the post before storing an event. There is consequently
no first-ingestion/translation/publication timestamp for the failed path.

The independently retrieved source body is retained privately under
`/data/audits/employment-x-independent-20261002.json`; do not copy its prose
into public documentation. This is diagnostic retrieval, not successful service
delivery. The post lacks hourly earnings MoM and prior-month revisions.

The calendar had the correct `jobs-2026-10-02` event at 08:30 EDT. Its default
upcoming-only filter hid it after the scheduled clock. The repair defaults to
today-and-upcoming in the chosen display timezone and keeps same-day events
visible after their scheduled time, without asserting that results arrived.

The repair recognizes separator-free labelled numbers, keeps each metric's
actual separate from estimates, supports AVG. hourly earnings and both wage
periods, and publishes supported metrics from a combined post. Source-to-DB
and DB-to-public clocks remain separate. Numeric bilingual generation is
deterministic, not an LLM translation. A query fingerprint change enables a
bounded ordinary recovery backfill; recovery is not an on-time success.

Official comparison source:
https://www.bls.gov/news.release/archives/empsit_10022026.htm
The archived September release reports +29,000 payrolls, unemployment 4.2%,
wages +0.1% MoM/+3.0% YoY; July +21,000 revised to -10,000 and August +162,000
to +133,000. The generic nr0 search representation was still August when read;
it must not be used as September evidence. Official actual HTTP publication
time and browser first-render time were not continuously observed.

Pre-ref-update gates: 209 Node and 602 Python tests, lint, build, compileall
and diff checks. Deployment/recovery evidence must be appended after observation.
