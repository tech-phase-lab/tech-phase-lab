# News display and translation status

Official Japanese headlines are still an editorial URL map, not automatic translation. Added the Sep 29 Nebius/Shopify GTC Berlin headline from the fetched English excerpt, without claiming full article analysis. OpenAI credentials remain deferred by user until December. Seconds-level production delivery is a target, not verified functionality.

Home pulse now consumes the same validated public feed as the news list, avoiding a second poll. New leading IDs restart at the latest item. Mobile shows date and time in JST. Official times remain explicitly labelled Found/取得 because the current public feed exposes observedAt only. Do not present observedAt as publication time. NEW expires after one hour relative to the feed check; stale feed errors clear the pulse. The poll remains 30 seconds, including when the price-target tab is selected; reduced-motion and pause controls remain.

Before launch: connect automatic headline translation, persist translations server-side by source/revision, carry publisher timestamps separately, measure source→discovery→translation→browser timings, add streaming updates, retry/timeout monitoring. Do not put private excerpts or credentials in client payloads. No promise of seconds from publication until measured against the source's own latency.

FAQ local navigation now matches guide navigation. Removed requested preview banner and ambiguous question-form warning; Ask RIZEL is the PRO public Q&A, not a support form.

## Acquisition measurement and dormant headline translation — 18:48 JST

The URL-free operations summary now measures exact source-publication to first
monitor-observation latency for official update events observed in the latest
24 hours. It accepts only timezone-bearing source timestamps, excludes date-only,
future, reversed, over-seven-day and later-revision rows, and reports count,
average, maximum and latest observation. This is acquisition evidence, not the
poll interval, browser display time, subscriber delivery time or an SLA.

An opt-in official-headline translation worker is implemented but remains off.
It requires `OFFICIAL_HEADLINE_TRANSLATION_ENABLED=true`, an API key and an
explicit `OFFICIAL_HEADLINE_TRANSLATION_MODEL`; there is no default model.
Translations are persisted against source ID, canonical URL and exact source
SHA, so a changed headline cannot inherit stale Japanese. Durable leases,
three-attempt bounds, retry/backoff, a rolling daily logical-call limit and
bounded token output are covered by offline fake-provider tests. Only the
headline is sent; source bodies, diffs, owner identity and evidence are not.
Existing editorial URL translations remain authoritative. Automatic factual
headline translation does not approve or publish investment-impact analysis.

December owner approval of the provider/model and credentials remains the exact
activation blocker. No paid API call or environment change was made.
