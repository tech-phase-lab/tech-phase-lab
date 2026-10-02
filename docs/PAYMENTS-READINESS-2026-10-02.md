# Overseas subscription readiness — 2026-10-02

Owner priority: resolve whether Tech Phase can accept overseas membership
payments before spending more time on cosmetic improvements. No provider
application, external inquiry, contract or live payment activation was made.

## Existing implementation

`lib/membership/server.ts` resolves Free/PRO from server-fetched Clerk private
metadata and expiration. `app/research/account/screen.tsx` displays membership;
preview testing is explicitly without billing. No checkout, payment webhook,
subscription ledger or customer billing portal exists in app/api or lib.
The FAQ already describes monthly billing from the join date and continued
access through the paid period after cancellation. These are intended product
terms, not evidence that payment or cancellation is implemented.

## Provider shortlist, subject to actual underwriting

1. **Stripe: first inquiry candidate.** Its restricted-business rules require
   additional diligence for restricted categories, including financial services;
   approval is not guaranteed. The rules do not by themselves establish that this
   publication is either permitted or prohibited. Submit representative material
   and ask for an explicit assessment of this exact membership offering.
2. **PayPal: backup inquiry candidate.** Its AUP requires prior approval for
   specified investment transactions, such as buying, selling or brokering
   securities. This is not a blanket determination about financial publications.
   Confirm this publication's eligibility and recurring overseas billing.
3. **Paddle: low priority.** Its AUP explicitly lists investment/financial advice,
   trading signals and strategies among prohibited offerings. Do not assume that
   a software interface or merchant-of-record arrangement makes Tech Phase eligible.

Official sources checked on 2026-10-02:
- https://stripe.com/jp/legal/restricted-businesses (updated 2026-09-22)
- https://stripe.com/jp/billing
- https://www.paypal.com/jp/legalhub/paypal/acceptableuse-full
- https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle

## Material to prepare for the provider

Describe the paid offering completely: bilingual company/news research,
earnings analysis, valuation scenarios, third-party analyst target-price
information and notifications, weekly research, author's notes, and selected
answers on the shared member question board. Include actual sample pages.
The FAQ says buy/sell recommendations and promises of returns are not offered;
this statement must agree with the actual content. Do not omit analysis/Q&A
or relabel the product to evade underwriting.

Confirm operator identity and country/entity type (not established by this
inspection), launch sales countries, the intended domestic ¥2,980 and overseas
$20 monthly prices, and whether prices include applicable taxes. Ask about:

- Eligibility of this exact content, any additional review or documentation,
  and which changes to the offering require reassessment.
- Recurring USD customer charges and supported settlement currency/bank account
  for the actual operator, conversion and cross-border costs, payout timing,
  reserves/holds and dispute handling. No rate or payout option is promised here.
- Cancellation, refund, receipt/invoice and customer-service requirements.
- Restrictions by buyer country and responsibility for applicable indirect taxes.

Provider approval does not itself determine financial-services registration or
other legal obligations; obtain an assessment of the actual content and selling
jurisdictions where needed before launch.

## Site work in order

1. Prepare accurate JA/EN service and pricing pages plus operator/contact,
   commercial disclosures, terms, privacy, refund/cancellation details. Obtain
   missing operator facts and policy decisions before publishing them.
2. Confirm provider eligibility and the launch-country/currency scope.
3. Implement test-mode checkout, server-side signed/idempotent webhook handling,
   persistent subscription records, billing portal, and Clerk entitlement sync.
   Never grant PRO solely from a return URL or a browser-supplied plan.
4. Verify initial purchase, renewal, duplicate/out-of-order webhooks, declined
   renewal, cancellation at period end, refund and account mismatch. Ensure paid
   access and the user-visible expiry agree. Then arrange live activation.

Commercial permission for displayed market/news data remains a separate launch
dependency. The owner's Alpaca/FMP correspondence does not authorize commercial
redistribution. This inspection did not change providers or their subscriptions.
