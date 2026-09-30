# News display and translation status

Official Japanese headlines are still an editorial URL map, not automatic translation. Added the Sep 29 Nebius/Shopify GTC Berlin headline from the fetched English excerpt, without claiming full article analysis. No translation provider credential or model is configured. The newest owner checkpoint authorizes automatic translation setup and timing once that secure configuration is available, but does not authorize a new paid contract. Seconds-level production delivery is a target, not verified functionality.

Home pulse now consumes the same validated public feed as the news list, avoiding a second poll. New leading IDs restart at the latest item. Mobile shows date and time in JST. Official times remain explicitly labelled Found/取得 because the current public feed exposes observedAt only. Do not present observedAt as publication time. NEW expires after one hour relative to the feed check; stale feed errors clear the pulse. The poll remains 30 seconds, including when the price-target tab is selected; reduced-motion and pause controls remain.

Before launch: securely configure and live-verify automatic headline translation, carry publisher timestamps separately, measure source→discovery→translation→browser timings, and preserve retry/timeout monitoring. Source/revision persistence and the dormant worker are implemented. Do not put private excerpts or credentials in client payloads. No promise of seconds from publication until measured against the source's own latency.

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

The owner has now authorized activation and timing once a provider credential
and explicit model can be configured securely. Neither is currently available,
and no new paid contract, API call or environment change was made.

## Aggregate translation diagnostics — 19:48 JST

The operations state now reports a bounded, evidence-free headline-translation
summary. It distinguishes OFF, incomplete configuration and enabled states;
counts eligible, translated and untranslated current items; records the oldest
pending timestamp; and exposes only aggregate running, retrying, exhausted and
24-hour completion/failure/stale-output counts. A valid daily limit and the
nearest bounded retry time are shown only when available.

The payload intentionally contains no headline, URL, publisher/company ID,
source body, diff, model name, provider response or error string. The owner
operations UI labels the dormant worker as OFF with no external transmission.
Offline tests cover enabled retry state, disabled state, incomplete
configuration, redaction and the authenticated health projection. Translation
remains disabled pending the December provider/model/credential decision.

Deployment checks for commit `73b0040` completed successfully on both Vercel
preview and Railway staging. The preview intake page loaded without application
console errors, but `/research/intake` continued to show its saved-snapshot
fallback rather than a connected automatic-monitor state after Railway became
green. Vercel runtime logs showed successful HTTP responses and no runtime error
or warning entries in the checked window. Therefore the aggregate diagnostics
are code-, type-, build- and offline-test-verified, but their live rendered
values remain pending until the preview-to-monitor connection resumes. Do not
report this as a translation-worker or provider failure; the worker remains
deliberately disabled.

## Duplicate, missing-feed and reconnect recovery — 20:41 JST

The public news boundary now validates every candidate and then keeps only the
first current item for each official URL and each reviewed article ID/URL. This
is defense in depth for a duplicated monitor row or repeated revision; it does
not widen allowed hosts or reveal discarded source evidence. A monitor payload
that legitimately omits the optional official-update list remains compatible.

The client poller now retries a failed read after 5 seconds with bounded
exponential backoff to the normal 30-second polling interval. Browser `online`
and visible-page recovery request an immediate read, while overlapping wakeups
coalesce into one follow-up. Unmount aborts the active request and schedules no
retry. A failed check clears both the shared home pulse and the module cache, so
stale items cannot reappear after remount; the next successful read restores the
feed and regular interval.

Offline tests cover duplicate official/reviewed items, an absent optional
official list, source records without publication evidence, exclusion of a
publication-free baseline, failure-to-success reconnect, coalesced wakeups and
abort cleanup. No streaming, paid provider, delivery path or production setting
was enabled. These tests verify recovery logic, not live source-to-screen
latency.

## Live operations connection verified — 21:46 JST

The latest Vercel preview `/research/intake` transitioned from its bundled
snapshot fallback to the authenticated Railway automatic-monitor state on its
normal client refresh. The rendered page showed a last poll at 21:46:43 JST,
22/22 companies with successful list intake, current body-fetch and SSE
activity, and the headline translation worker explicitly OFF with no external
transmission. No credential or private evidence value was displayed or logged.

The rendered acquisition aggregate contained three valid 24-hour samples with
an average of 22,588 seconds and a maximum of 67,549 seconds. These are
source-publication to first-monitor-observation samples only; they are not the
poll interval, browser rendering time, subscriber delivery latency or an SLA.
The earlier live-rendering blocker is therefore closed. Remaining operational
limits are the source-specific lawful access/retry states shown in aggregate
and the missing secure provider credential/model configuration for the
deliberately disabled translation worker.

## Fail-closed December approval gate — October 1 04:43 JST

The live preview later exposed an unexpected configuration drift: general
official-headline translation was enabled and had made four logical calls in
the preceding 24 hours. The owner instruction still holds general activation
until a December-or-later credential/model decision. Code now requires a
separate `OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON` date on or after
2026-12-01, rejects a future-dated approval, and reports `approval-required`
without calling the provider. The existing enable flag, key and model are no
longer sufficient by themselves. This safeguard does not alter the separately
authorized, finite MU earnings measurement path.

Offline coverage verifies missing, pre-December and future approval dates never
call the provider, while a valid December-or-later approval preserves the
existing source/SHA binding, lease, deduplication, retry and budget behavior.
