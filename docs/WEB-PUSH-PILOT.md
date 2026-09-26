# Web Push pilot — 2026-09-26

Implemented: per-device ticker selection, Japanese/English price-target alerts,
registration/removal, durable same-action deduplication across monitored X accounts,
no historical backfill, five-minute maximum detection age, and expired endpoint
removal. Push uses the existing shared price-target snapshot; it never reads X per
subscriber. The service worker caches no pages or API responses.

This is a **private pilot**, capped at 20 devices. It is disabled by default and
is not the paid membership entitlement system. Ordinary news and earnings alerts,
quiet hours, cross-device preference sync, production authentication, and a
3,000-device fanout worker remain separate work. The current worker sends serially.

Delivery ledger claims are committed before sending. Ambiguous network failures
are recorded as uncertain and not retried, favoring no duplicate alerts over
reliable retries. Provider acceptance is not proof a phone displayed a notification.
Same-action identity includes ticker, firm, old/new prices and UTC publication date;
it cannot resolve every correction or conflicting-source case automatically.

## Enable a measured private trial

1. Generate a dedicated VAPID key pair using the installed py-vapid library.
   Keep its private key on Railway only; persist and back it up as a secret.
2. Railway monitor variables: `WEB_PUSH_PRIVATE_KEY` (VAPID private key),
   `WEB_PUSH_PUBLIC_KEY` (URL-safe public key), `WEB_PUSH_SUBJECT` (operator contact
   mailto URL), and `WEB_PUSH_ENABLED=true`. Restart only the trial monitor.
3. Vercel preview variable: `WEB_PUSH_PILOT_CODE`, at least 24 random characters.
   Store it as a secret. Rebuild the preview. The UI never receives this code.
4. Open the price-target panel's phone notification settings. On iPhone first add
   the site to Home Screen from Safari, then open that icon. Enter the pilot code,
   choose tickers and allow notifications. Saving preferences starts a new baseline.
5. Verify a new real event on both iPhone and Android. Do not label synthetic
   market news as real. Record source time, detection, provider acceptance and
   observed phone arrival separately.
6. Stop from the same device's settings, or revoke website notification permission
   in the browser/OS. Turning off `WEB_PUSH_ENABLED` stops the worker globally.

No keys were generated, no new subscription registered, and no phone notification
sent during this implementation. Deployment alone does not activate sending.

## Browser verification of existing live price-target display

On September 26 at 23:52 JST the protected research preview rendered successfully.
After opening “何が変わった？” it showed “新着を自動表示” and a successful snapshot
sync at 23:52:26 JST. The current list was empty. This verifies a real browser
received the SSE snapshot, not a new price-target event or phone push delivery.

## September 27 follow-up

The operator authorized secret storage and pilot activation. Dedicated VAPID keys
were stored in Railway research-staging, the key pair validated, and a branch-only
Vercel enrollment code saved. No device was registered at activation.

The default registration now requests all detected price-target changes (`allTargets`).
The durable wildcard subscription also covers newly encountered tickers. Existing
explicit-ticker subscriptions remain scoped until the owner saves again. The UI
removes the long checklist. Research/earnings monitoring remains separately scoped;
the three X search queries now accept target changes without a fixed ticker roster.
Only explicit cashtags extend identification beyond known company aliases. Ambiguous
multi-ticker posts are not automatically published as one target action.

Price-target display retains seven days, still requiring a supported broker/old/new
price extraction and initial detection within fifteen minutes. Historical display
does not re-notify old records. X search still caps each response at 30 posts and
uses the existing request budget; this is not guaranteed complete market coverage.

GlobeNewswire: the same Railway server timed out with the old monitor identification,
but a transparent `TechPhaseResearch/1.0` identification with the project website
returned HTTP 200 / 36,518 bytes in 0.26 seconds. Apply this only to the Globe feed;
do not bypass the access denials affecting other providers.
