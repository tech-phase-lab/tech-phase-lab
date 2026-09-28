# Delivery verification — September 28, 2026

## Membership follow-up, September 28

- The owner explicitly deferred Stock News API and OpenAI API/model setup.
  Continue work that does not require those services; no paid activation.
- The live preview browser is signed out. The account page renders the login
  form, and the NBIS ClusterMAX research detail withholds premium analysis and
  displays the PRO requirement with the membership link.
- Found a notification-guidance issue: browser permission denial was displayed
  before checking membership, hiding the sign-in/PRO requirement. The client now
  checks the membership response before presenting device permission guidance.
  Existing subscription discovery and the device-off action are retained.
- The 10 focused membership/article/notification tests pass, including anonymous,
  Free, expired, active PRO, unavailable identity, self-only preview changes,
  and authenticated delivery entitlement checks. These use stubbed identities,
  not real account transitions. No push was sent during this follow-up.
- Free/PRO/expiry transitions in an authenticated live browser remain unverified;
  the signed-out check does not establish them. The earlier phone receipt remains
  valid evidence for that specific device test.

## Confirmed phone test

At 12:05 JST the owner confirmed receiving the test push and then pressing
Received. Commit `9eed003` fixed the VAPID contact URL: py_vapid rejected the
configured HTTPS URL with a path; signing its origin succeeded. The deployed
member test returned provider status 201, accepted=true. The owner report is
evidence of actual display on that tested phone, not a measured arrival time.
Free/expiry/other-account browser transitions remain separate live checks.

## Live operations baseline, 12:06 JST

- Official supplementary routes: 22/25 successful; two access restrictions and
  one timeout. Priority five: 5/5 healthy.
- Body evidence: 195 extracted, 731 missing; 730 wait behind a host restriction.
  Preserve the scheduled recovery/backoff; do not force blocked requests.
- Shared price-target SSE: one connected client, 165/165 successful reads,
  no read failures at observation.
- Push worker: two registered devices, no worker failures; zero automatic
  market-event attempts in the last 24 hours. Test sends are a separate flow.
- AI draft generation: OFF. No claim of live automatic bilingual news summaries.
- Existing official items demonstrate detection-to-body intervals of 12 seconds
  for the Marvell dividend, 12 seconds for Bloom Energy's community release,
  and 13 seconds for Vertiv's acquisition announcement. These are historical
  stored observations, not publication-to-phone measurements.

## Target replay regression

Found a concrete timestamp defect in saved observation → public target selection:
string ordering could select a later detection as the first source, misorder
newest actions, and drop an actually newer action from the 300-candidate window
when timezone offsets differ. Future observation timestamps also passed through.
Regression cases reproduced both ordering/window failures before the fix.

Compare absolute instants for the candidate window, first-detection selection and
publication ordering; withhold observations later than the evaluation time.
The isolated replay also exercises saved X observations → structured target →
member entitlement → Japanese/English push payloads → durable delivery ledger.
Two source observations of one action produce one send per language/device;
replaying after reopening the database produces no additional sends.
All replay inputs and transports are synthetic. No live market item or external
notification is created by these tests, and they do not measure network latency.
Integrated checks passed: 113 Node tests, 361 Python tests, lint, production build,
Python compilation and whitespace validation.

## Remaining priority 2 work

1. Observe a real new eligible price-target event through acquisition, browser
   display and phone arrival; retain publication, detection, render and receipt
   times separately. Current zero-event windows cannot prove no upstream misses.
2. Compare the permitted source's captured event set against the selection set,
   accounting for 30-post search response and 300-candidate/30-display limits.
3. Normal news needs enabled, authorized bilingual draft generation and a
   reviewed publication policy before an end-to-end live summary timing claim.
4. Continue the editor priority (weekly PRO, Research Q&A, RIZEL notes) after
   documenting the remaining source/provider and publication dependencies.
