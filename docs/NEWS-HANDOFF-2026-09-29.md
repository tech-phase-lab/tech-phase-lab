# News display and translation status

Official Japanese headlines are still an editorial URL map, not automatic translation. Added the Sep 29 Nebius/Shopify GTC Berlin headline from the fetched English excerpt, without claiming full article analysis. OpenAI credentials remain deferred by user until December. Seconds-level production delivery is a target, not verified functionality.

Home pulse now consumes the same validated public feed as the news list, avoiding a second poll. New leading IDs restart at the latest item. Mobile shows date and time in JST. Official times remain explicitly labelled Found/取得 because the current public feed exposes observedAt only. Do not present observedAt as publication time. NEW expires after one hour relative to the feed check; stale feed errors clear the pulse. The poll remains 30 seconds, including when the price-target tab is selected; reduced-motion and pause controls remain.

Before launch: connect automatic headline translation, persist translations server-side by source/revision, carry publisher timestamps separately, measure source→discovery→translation→browser timings, add streaming updates, retry/timeout monitoring. Do not put private excerpts or credentials in client payloads. No promise of seconds from publication until measured against the source's own latency.

FAQ local navigation now matches guide navigation. Removed requested preview banner and ambiguous question-form warning; Ask RIZEL is the PRO public Q&A, not a support form.
