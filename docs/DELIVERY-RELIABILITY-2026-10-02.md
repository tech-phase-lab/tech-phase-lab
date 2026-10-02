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

## First rollout and live follow-through

Commit `33c0ad7a3a567109070d6c51ce17c83374281cf4` was verified on the remote
preview branch. Its uploaded tree matched the checked local Git tree exactly.
Actions run `37035662812`, Vercel deployment `dpl_5reEnqqcehPB4XdBUHZPNARQn19B`
and Railway deployment `bfe5c396-5640-405f-8435-8132baed419f` succeeded.
The existing branch alias points to that preview; no production promotion was
performed.

By 16:49 UTC the live alias home page showed the employment result in English,
including the expanded +29K/4.2%/YoY 3.0% details, and live target cards with source
attribution. At 16:54 UTC the home news list's fourth page showed MU's $54.23B
revenue, $33.42 adjusted EPS and $61.5B plus/minus $1.5B revenue guidance in both
English and Japanese. These later observations do not improve the historical
arrival times.

Authenticated inspection identified the remaining article failure as the
PR Newswire release:
https://www.prnewswire.com/news-releases/green-water-and-power-partners-with-goodwill-socal-to-offer-on-the-job-training-in-electrical-trades-302897221.html

An ordinary fetch returned HTTP 200. Three gallery tiles use non-void `<div/>`
elements with subsequent closing tags; the old parser incorrectly synthesized
an immediate close and retained only 62 characters. HTML-correct self-closing
handling and matching-tag scopes recover 4,170 characters through the final
source line. The release matches none of the 22 tracked companies. Its valid
extraction must not create an unrelated company-news event. The stored live
retry/error still requires post-deployment verification; it is not silently
cleared or reclassified as a missing tracked-stock story.

The same inspection found the explicit Wells Fargo MSFT $700 to $725 action at
https://x.com/TipRanks/status/2105612496354545795 withheld by the unsupported
`price target on Company to` grammar. A narrow directional adapter requires
that the named company exactly match the resolved ticker's known alias; the
existing source, firm, subject, value, multiple-action and revision gates remain.

Live UI checks also caught MU issuer/SEC duplication because the original source
title spelled out “Fourth Quarter and Full Year 2026”. Explicit adjacent fiscal
quarter/year recognition now merges that Q4 release while retaining the Q3
event separately. Exact repeated summary/fact paragraphs are displayed once.
Separate same-publisher follow-up URLs retain their own facts rather than an
EPS-only post removing the earlier revenue. Same-URL corrections still supersede
old revisions, and different-URL disagreements remain attributed.

The integrated follow-through changes passed 243 Node and 653 Python tests,
lint (zero errors, the same existing warning), production build/type checking,
compileall and whitespace checks before their subsequent rollout.
