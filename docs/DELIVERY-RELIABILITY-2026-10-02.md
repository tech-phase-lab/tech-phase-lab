# News and target delivery repair — October 2, 2026

This change repairs reproduced ingestion, publication and browser-delivery
defects against preview base `885df189c6cf3ea15e8a48d0b1c3776482d476bf`.
It does not erase the MU, ASTS or employment delivery failures recorded in the
existing incident documents, reset an acceptance interval, or establish a
source-to-browser seconds-level SLA.

## Reproduced failures repaired

- Whole-batch supplemental polling waited for the slowest publisher. The
  scheduler now reuses completed slots, prevents duplicate in-flight requests,
  fairly revisits due sources and preserves the three-worker cap. When X is
  enabled, one slot is reserved for X and two for other supplemental sources.
  The persistent X request cap and pacing checks remain in force.
- Newly committed source events now wake the independent publication workers;
  a new event need not wait for their five-second idle poll. Revision, retry,
  translation approval and spending checks remain unchanged.
- Arbitrary pre-parser pages of 300 target candidates or 200 mixed result
  candidates could permanently hide eligible retained events. Indexed source
  and time windows replace those pages. Public display limits still apply
  after validation.
- Target admission accepts PT increased/reduced/from/of forms already supported
  by the strict public parser. Unknown firms, ambiguous subjects, contradictory
  direction and unsupported numbers remain withheld, with aggregate reasons.
- Corrected target revisions supersede old numbers. A newer acquired original
  also invalidates old source evidence when a withdrawal itself does not match
  any supported news grammar. It remains private rather than being invented
  into a new public story.
- Startup reprocessing of retained, previously unselected X originals makes no
  provider calls. It preserves original source and first-observation clocks,
  records recovery as baseline, rejects corrupt/future/truncated evidence and
  does not overwrite a newer source document. It does not rewrite route timing,
  query cursors or billing records.
- Syndicated target actions retain their source URLs/times and canonical broker
  identities. Different brokers and changed price pairs remain separate.
- Earnings/results consolidation retains all attributed facts and sources.
  Different fiscal periods, dates and explicitly corrected releases stay
  distinct. Disagreeing values remain attributed and are not averaged or silently
  chosen as consensus. Unknown-period cases are conservatively not merged.
- A long issuer-note headline or one malformed note cannot invalidate all news.
  Monitor failure returns uncached 503, rather than HTTP 200 with only a static
  fallback. The pre-existing fail-closed unavailable display is preserved.
- Stalled news requests have a 15-second full-load deadline. Old HTTP responses
  and cancelled SSE sessions cannot overwrite a newer snapshot. The news refresh
  label now reflects the existing five-second cadence.

## Recovery checks

The reviewed MU SEC-derived artifact is replayed through the bilingual public
news validator: FQ4 2026 revenue 54,229 million USD, adjusted EPS 33.42, next-quarter
revenue midpoint 61.5 billion USD plus/minus 1.5 billion. This is a saved reviewed
input, not a fresh live-model translation or on-time arrival measurement.

The recorded September employment post format is replayed through retained
acquisition, private admission and durable bilingual publication. It preserves
+29K payrolls, 4.2% unemployment and 3.0% YoY wages; estimates and absent MoM
values are not substituted. Its original 1,115.663-second acquisition delay is
preserved. Synthetic fixtures also test multiple publishers, conflicting values,
repeated requests, unsupported withdrawals, malformed evidence and stale revisions.

Before rollout, the existing Vercel API was observed at 16:20:58 UTC returning MU
and the employment result in both languages. At 16:26 UTC its Japanese home UI
also visibly contained the employment result. These are recovery observations,
not proof that either historical release arrived on time.

## Verification and limits

Final local integrated gates passed including withdrawal regressions: 241 Node
and 642 Python tests, lint (zero errors, one existing unused-variable warning),
production build/type checking, compileall and whitespace checks. Deployment/CI
and live-browser verification are separate evidence and must be recorded after
observation.

At 16:22:28 UTC, old-deployment diagnostics still showed 23/24 supplemental routes
fresh, one articlePartial route with one invalidResponse article, and three
pending issuer research notes. The public response did not identify the article
URL. These are not resolved merely because local tests pass.

The current X request ceiling is 4,400 per day with 20-second common pacing and
four query routes. The reported 80-second route spacing is a planning estimate,
not a measured or hard minimum per source. Search queries, source accounts,
paid-service settings and request limits are unchanged by this rollout. Pure
PT shorthand outside the existing search query can still be absent upstream;
query expansion requires a separate usage/cost decision. Filtered Stream is not
activated.

Configured normal transport is news polling every five seconds plus request
time, and price-target SSE sampling every second plus processing/network time.
Reconnects, provider delays and translation retries can take longer. A future
acceptance claim requires newly published eligible items, independent source
reconciliation, accurate JA/EN output, and separately measured source,
acquisition, backend-publication and actual browser clocks.
