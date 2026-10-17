# Checkout language continuity

The language links previously navigated to a new page using only the order ID
received on initial page load. An order created in the current screen therefore
lost its ID when switching languages, and renewal selection reset to initial.

Language controls now change client display state without navigating. They keep
the selected purchase type, current order, approval URL, payment state and retry
key. The URL retains the current order ID. An already-started create request keeps
its original pricing language when retried; translating the screen cannot change
its amount or currency. Controls are disabled while a payment request is running.
Server pricing, eligibility and capture verification remain unchanged.

The owner reported completing the USD FREE renewal on October 16. Existing HTTP
logs show capture and order-status requests succeeding at 12:13 JST, followed by
a successful PayPal webhook response. These HTTP responses alone do not establish
the exact paid amount, grant count or extended expiry. Those ledger checks remain
unverified for this transaction. No temporary Railway verifier deployment was
performed to inspect it.

Validation: Node 925/925, Python 2,465/2,465, lint zero errors (two existing
warnings), production build, compileall and whitespace checks passed. A Chromium
component harness using the actual checkout component/CSS and bundled fonts,
with mocked payment API responses, passed at 320/390/430px. Renewal selection,
created order ID, USD 39 quote, PayPal link and confirmed-payment state survived
language switching with one document load, one create and one capture request.
No horizontal overflow was detected. This is not a real PayPal payment test or
an authenticated deployed-page browser test.
